import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { heightAt, waterDepthAt } from '../world/Terrain';
import { isOnRoad } from '../world/RoadNetwork';
import { clamp } from '../utils/math';
import { plastic, shade } from '../utils/plastic';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';
import { createJammedTag, createMuzzleGlob } from '../combat/JamCannon';

export const HULL_HALF_EXTENTS = { x: 1.15, y: 0.5, z: 1.9 };
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export type Faction = 'player' | 'enemy';
export type ArmorZone = 'front' | 'side' | 'rear';
/** Thick glacis up front, thin engine deck at the back. */
export const ARMOR_MULTIPLIER: Record<ArmorZone, number> = { front: 0.5, side: 1, rear: 2 };
const FRONT_ARC = (40 * Math.PI) / 180;
const REAR_ARC = (135 * Math.PI) / 180;
const MAX_YAW_RATE = 1.7; // rad/s at full steer
/** Speed multiplier on a road, for tanks with fasterOnRoads. */
const ROAD_SPEED_BOOST = 1.2;
// Ground vehicles can elevate to engage aircraft; airborne subclasses can depress further.
const BARREL_PITCH_MIN = -0.1;
const BARREL_PITCH_MAX = 0.65;
const GROUND_SEEK = 6; // m/s downward search bias fed to the character controller

/** Shared hull+turret+barrel tank rig: visuals, kinematic movement/collision, health, firing. */
/** Stand-in materials marking which shade each part gets; swapped for the army's plastic. */
const SLOT = { body: new THREE.MeshBasicMaterial(), dark: new THREE.MeshBasicMaterial(), deep: new THREE.MeshBasicMaterial() };
type TankShapes = Record<'hull' | 'turret' | 'gun', Map<THREE.Material, THREE.BufferGeometry>>;

export class Tank {
  private static shapes: TankShapes | null = null;
  readonly root = new THREE.Group();
  readonly turretPivot = new THREE.Group();
  readonly barrelPivot = new THREE.Group();
  readonly muzzle = new THREE.Object3D();

  health: number;
  readonly maxHealth: number;
  alive = true;
  /** Green (player + buddies) or tan (enemy). Shells never hurt their own side. */
  readonly faction: Faction;
  /** Can't be hurt or targeted: a Fortress defender while the gates are still locked. */
  shielded = false;
  /** Drives a bit faster on roads (the player and buddies). */
  protected fasterOnRoads = false;
  private roadBoost = 1;

  fireCooldown = 0;
  /** Seconds left with jam gumming up the barrel (friendly fire from the jam cannon). */
  private gunJamTime = 0;
  private gunJamVisuals: THREE.Object3D[] = [];
  /** Seconds left stuck fast in a jam puddle (enemy tanks hit by the jam cannon): the tracks can't move. */
  private stuckTime = 0;
  private stuckVisuals: THREE.Object3D[] = [];
  readonly fireInterval: number = 1.6;
  readonly muzzleSpeed: number = 160;
  readonly shellDamage: number = 26;

  protected barrelYaw = 0;
  protected barrelPitch = 0.04;
  protected barrelPitchMin = BARREL_PITCH_MIN;
  protected barrelPitchMax = BARREL_PITCH_MAX;
  /**
   * Hull heading, kept as its own accumulator. Reading root.rotation.y back is unreliable:
   * once the heading passes ±90° three.js re-decomposes it as (π, π-yaw, π).
   */
  private hullYaw = 0;

  protected body: RAPIER.RigidBody;
  protected controller: RAPIER.KinematicCharacterController;
  protected collider: RAPIER.Collider;

  constructor(
    protected world: RAPIER.World,
    spawnX: number,
    spawnZ: number,
    maxHealth: number,
    plasticColor: number,
    facingRadians = 0,
    faction: Faction = 'enemy',
    /** False for vehicles (the helicopter) that build their own body round the aiming pivots. */
    tankBody = true,
  ) {
    this.faction = faction;
    this.maxHealth = maxHealth;
    this.health = maxHealth;

    const groundY = heightAt(spawnX, spawnZ) + HULL_HALF_EXTENTS.y;
    this.root.position.set(spawnX, groundY, spawnZ);
    this.hullYaw = facingRadians;
    this.root.quaternion.setFromAxisAngle(Y_AXIS, facingRadians);
    if (tankBody) this.buildVisuals(plasticColor);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawnX,
      groundY,
      spawnZ,
    );
    this.body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      HULL_HALF_EXTENTS.x,
      HULL_HALF_EXTENTS.y,
      HULL_HALF_EXTENTS.z,
    );
    this.collider = world.createCollider(colliderDesc, this.body);

    this.controller = world.createCharacterController(0.04);
    this.controller.enableAutostep(0.35, 0.15, true);
    this.controller.enableSnapToGround(1.0);
    this.controller.setMaxSlopeClimbAngle((65 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((75 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(1400);
  }

  /**
   * A one-colour moulded plastic toy tank, like the ones in a bag of army men. Each moving part
   * (hull, turret, gun) is merged into one mesh per shade, so the detail costs few draw calls.
   */
  private buildVisuals(color: number): void {
    // The shapes are the same for every army, so they're built once and shared; only the
    // plastic differs.
    const shapes = (Tank.shapes ??= {
      hull: Tank.buildHull(SLOT.body, SLOT.dark, SLOT.deep).buildGeometries(),
      turret: Tank.buildTurret(SLOT.body, SLOT.dark, SLOT.deep).buildGeometries(),
      gun: Tank.buildGun(SLOT.body, SLOT.dark, SLOT.deep).buildGeometries(),
    });
    const paint = new Map<THREE.Material, THREE.Material>([
      [SLOT.body, plastic(color)],
      [SLOT.dark, plastic(shade(color, 0.72))],
      [SLOT.deep, plastic(shade(color, 0.5))],
    ]);
    const dress = (geos: Map<THREE.Material, THREE.BufferGeometry>, parent: THREE.Object3D) => {
      for (const [slot, geo] of geos) {
        const mesh = new THREE.Mesh(geo, paint.get(slot));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
      }
    };

    dress(shapes.hull, this.root);

    this.turretPivot.position.set(0, HULL_HALF_EXTENTS.y + 0.02, 0.15);
    this.root.add(this.turretPivot);
    dress(shapes.turret, this.turretPivot);

    this.barrelPivot.position.set(0, 0.3, -0.95);
    this.turretPivot.add(this.barrelPivot);
    dress(shapes.gun, this.barrelPivot);

    this.muzzle.position.set(0, 0, -2.4);
    this.barrelPivot.add(this.muzzle);

    this.applyAim();
  }

  private static buildHull(body: THREE.Material, dark: THREE.Material, deep: THREE.Material): PartBuilder {
    const p = new PartBuilder();
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

    // Lower tub, upper hull over the tracks, sloped glacis plates front and a rear plate.
    p.add(box(2.0, 0.6, 3.6), body, 0, -0.12, 0);
    p.add(box(2.36, 0.34, 3.2), body, 0, 0.3, 0.15);
    const glacisTilt = -0.55; // normal points up and forward
    p.add(box(2.1, 0.1, 1.0), body, 0, 0.2, -1.66, glacisTilt);
    p.add(box(2.0, 0.1, 0.62), body, 0, -0.26, -1.95, 0.9);
    p.add(box(2.1, 0.62, 0.1), body, 0, 0.05, 1.8, -0.15);

    // Spare track links bolted across the glacis.
    const up = new THREE.Vector3(0, Math.cos(glacisTilt), Math.sin(glacisTilt));
    const along = new THREE.Vector3(0, -Math.sin(glacisTilt), Math.cos(glacisTilt));
    for (let i = 0; i < 5; i++) {
      const at = new THREE.Vector3(-0.72 + i * 0.36, 0.2, -1.66).addScaledVector(up, 0.07).addScaledVector(along, -0.12);
      p.add(box(0.3, 0.05, 0.36), dark, at.x, at.y, at.z, glacisTilt);
      p.add(box(0.32, 0.03, 0.06), deep, at.x, at.y + 0.03, at.z - 0.06, glacisTilt);
    }

    // Driver's and co-driver's hatches with periscopes, and headlights with brush guards.
    for (const s of [-1, 1]) {
      p.add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 14), dark, s * 0.5, 0.49, -0.95);
      p.add(box(0.2, 0.09, 0.1), deep, s * 0.5, 0.53, -1.16);
      p.add(tubeZ(0.1, 0.11, 0.18), dark, s * 0.82, 0.44, -1.42);
      p.add(new THREE.SphereGeometry(0.085, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), body, s * 0.82, 0.44, -1.51, -Math.PI / 2);
      p.add(new THREE.TorusGeometry(0.14, 0.018, 5, 10, Math.PI), deep, s * 0.82, 0.44, -1.56, 0, 0, 0);
      // Tow hooks front and back.
      p.add(box(0.12, 0.18, 0.16), dark, s * 0.72, -0.1, -2.1);
      p.add(box(0.12, 0.2, 0.2), dark, s * 0.72, -0.2, 1.9);
      // Tail light and exhaust with a muffler.
      p.add(box(0.14, 0.1, 0.05), deep, s * 0.9, 0.28, 1.87);
      p.add(tubeX(0.12, 0.5), dark, s * 0.55, 0.12, 1.93);
      p.add(tubeZ(0.06, 0.06, 0.3), deep, s * 0.55, 0.12, 2.1);
    }

    // Engine deck: raised louvred grille and access hatches.
    p.add(box(1.7, 0.12, 1.1), body, 0, 0.52, 1.12);
    for (let i = 0; i < 7; i++) p.add(box(1.5, 0.05, 0.07), dark, 0, 0.6, 0.7 + i * 0.13);
    for (const s of [-1, 1]) p.add(box(0.5, 0.04, 0.4), dark, s * 0.62, 0.49, 0.3);

    // Running gear, each side: track belt with treads, road wheels, sprocket, idler, rollers.
    for (const s of [-1, 1]) {
      const x = s * 1.28;
      p.add(box(0.46, 0.5, 3.4), deep, x, -0.17, 0); // fills in behind the wheels
      p.add(box(0.54, 0.08, 3.5), dark, x, 0.13, 0); // top run
      p.add(box(0.54, 0.08, 3.5), dark, x, -0.48, 0); // ground run
      p.add(tubeX(0.31, 0.54, 16), dark, x, -0.17, -1.75); // wrap round the idler
      p.add(tubeX(0.31, 0.54, 16), dark, x, -0.17, 1.75); // wrap round the sprocket
      for (let z = -1.7; z <= 1.71; z += 0.2) {
        p.add(box(0.56, 0.05, 0.07), deep, x, 0.19, z);
        p.add(box(0.56, 0.05, 0.07), deep, x, -0.54, z);
      }
      // Treads round the curved ends.
      for (const end of [-1, 1]) {
        for (let k = 1; k < 6; k++) {
          const a = (k / 6) * Math.PI;
          const cz = end * 1.75 + end * Math.sin(a) * 0.34;
          const cy = -0.17 + Math.cos(a) * 0.34;
          p.add(box(0.56, 0.05, 0.07), deep, x, cy, cz, end * a);
        }
      }
      const wx = s * 1.5;
      for (let i = 0; i < 6; i++) {
        const z = -1.35 + i * 0.54;
        p.add(tubeX(0.27, 0.14, 16), body, wx, -0.24, z);
        p.add(tubeX(0.1, 0.18, 10), dark, wx + s * 0.02, -0.24, z);
      }
      for (const z of [-0.8, 0, 0.8]) p.add(tubeX(0.08, 0.12, 8), body, wx, 0.06, z); // return rollers
      // Drive sprocket at the back (with teeth) and idler at the front.
      p.add(tubeX(0.28, 0.16, 16), body, wx, -0.14, 1.72);
      for (let t = 0; t < 10; t++) {
        const a = (t / 10) * Math.PI * 2;
        p.add(box(0.12, 0.08, 0.08), dark, wx, -0.14 + Math.cos(a) * 0.3, 1.72 + Math.sin(a) * 0.3, a);
      }
      p.add(tubeX(0.25, 0.14, 16), body, wx, -0.17, -1.74);
      p.add(tubeX(0.09, 0.18, 10), dark, wx + s * 0.02, -0.17, -1.74);

      // Fenders with sloped mudguards.
      p.add(box(0.62, 0.05, 3.9), body, s * 1.3, 0.24, 0);
      p.add(box(0.62, 0.05, 0.42), body, s * 1.3, 0.14, -2.12, -0.5);
      p.add(box(0.62, 0.05, 0.42), body, s * 1.3, 0.14, 2.12, 0.5);

      // Stowage on the fenders: toolbox and jerry cans.
      p.add(box(0.4, 0.22, 0.7), dark, s * 1.3, 0.38, 0.75);
      p.add(box(0.42, 0.03, 0.72), deep, s * 1.3, 0.5, 0.75);
      for (const z of [1.28, 1.58]) {
        p.add(box(0.26, 0.34, 0.14), dark, s * 1.36, 0.44, z);
        p.add(box(0.04, 0.05, 0.1), deep, s * 1.36, 0.64, z);
      }
    }
    // Pioneer tools: shovel on the left fender, axe on the right.
    p.add(box(0.05, 0.05, 1.1), deep, -1.34, 0.3, -0.55);
    p.add(box(0.18, 0.03, 0.26), dark, -1.34, 0.3, -1.2);
    p.add(box(0.05, 0.05, 0.9), deep, 1.34, 0.3, -0.5);
    p.add(box(0.03, 0.18, 0.16), dark, 1.34, 0.36, -0.98);
    return p;
  }

  private static buildTurret(body: THREE.Material, dark: THREE.Material, deep: THREE.Material): PartBuilder {
    const p = new PartBuilder();
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

    // Cast turret with a chamfered roof, rear bustle and a rounded gun mantlet.
    p.add(new THREE.CylinderGeometry(0.74, 0.94, 0.56, 22), body, 0, 0.28, 0);
    p.add(new THREE.CylinderGeometry(0.62, 0.74, 0.1, 22), body, 0, 0.61, 0);
    p.add(box(1.25, 0.36, 0.72), body, 0, 0.28, 0.78);
    p.add(box(0.74, 0.48, 0.28), body, 0, 0.3, -0.8);
    p.add(tubeX(0.25, 0.78, 16), body, 0, 0.3, -0.9);
    for (const [x, y] of [[-0.28, 0.46], [0.28, 0.46], [-0.28, 0.14], [0.28, 0.14]]) {
      p.add(tubeZ(0.035, 0.035, 0.05, 6), deep, x, y, -1.05);
    }

    // Commander's cupola: vision blocks all round and the hatch flipped open.
    p.add(new THREE.CylinderGeometry(0.26, 0.29, 0.2, 16), dark, 0.3, 0.74, 0.2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      p.add(box(0.09, 0.07, 0.05), deep, 0.3 + Math.sin(a) * 0.28, 0.76, 0.2 + Math.cos(a) * 0.28, 0, a);
    }
    p.add(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16), dark, 0.3, 0.98, 0.44, -1.25);
    // Loader's hatch with a grab handle.
    p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14), dark, -0.32, 0.67, 0.12);
    p.add(new THREE.TorusGeometry(0.06, 0.015, 5, 8, Math.PI), deep, -0.32, 0.7, 0.12);
    p.add(box(0.14, 0.09, 0.16), deep, -0.3, 0.7, -0.38); // gunner's periscope

    // Pintle machine gun on the cupola with its ammo box.
    p.add(box(0.05, 0.3, 0.05), deep, 0.3, 0.97, -0.05);
    p.add(box(0.1, 0.13, 0.42), dark, 0.3, 1.12, -0.17);
    p.add(tubeZ(0.026, 0.026, 0.62, 6), deep, 0.3, 1.14, -0.68);
    p.add(box(0.13, 0.12, 0.17), dark, 0.4, 1.06, -0.1);

    for (const s of [-1, 1]) {
      // Smoke dischargers angled forward and out.
      for (let i = 0; i < 3; i++) p.add(tubeZ(0.05, 0.05, 0.22, 8), dark, s * 0.8, 0.46 + i * 0.07, -0.4, -0.45, s * 0.5);
      // Lifting eyes and turret-side stowage bins.
      p.add(new THREE.TorusGeometry(0.06, 0.016, 5, 10), deep, s * 0.48, 0.68, -0.28, 0, Math.PI / 2);
      p.add(box(0.13, 0.26, 0.52), dark, s * 0.9, 0.26, 0.42, 0, s * 0.18);
    }

    // Rear stowage basket with a rolled tarp and a crate.
    for (const x of [-0.62, -0.2, 0.2, 0.62]) p.add(box(0.035, 0.2, 0.035), deep, x, 0.55, 1.16);
    p.add(box(1.28, 0.035, 0.035), deep, 0, 0.64, 1.16);
    for (const s of [-1, 1]) p.add(box(0.035, 0.035, 0.36), deep, s * 0.62, 0.64, 0.98);
    p.add(tubeX(0.12, 0.9, 10), dark, -0.1, 0.58, 1.0);
    p.add(box(0.3, 0.2, 0.24), dark, 0.42, 0.56, 1.0);

    // Whip antenna.
    p.add(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8), deep, -0.5, 0.66, 0.86);
    p.add(new THREE.CylinderGeometry(0.012, 0.016, 2.2, 5), deep, -0.5, 1.8, 0.86);
    p.add(new THREE.SphereGeometry(0.04, 6, 4), deep, -0.5, 2.92, 0.86);
    return p;
  }

  private static commanderShapes: Map<THREE.Material, THREE.BufferGeometry> | null = null;

  /**
   * Puts a tank commander in the cupola: standing in the open hatch, scanning ahead through a
   * pair of binoculars held up to his eyes. Only the player's side gets one.
   */
  addCommander(color: number): void {
    Tank.commanderShapes ??= Tank.buildCommander().buildGeometries();
    // Much lighter plastic than the tank so he reads at chase-cam distance; kit in a darker shade.
    const shades = new Map<THREE.Material, THREE.Material>([
      [SLOT.body, plastic(shade(color, 1.55))],
      [SLOT.dark, plastic(shade(color, 0.8))],
    ]);
    const figure = new THREE.Group();
    for (const [slot, geo] of Tank.commanderShapes) {
      const mesh = new THREE.Mesh(geo, shades.get(slot));
      mesh.castShadow = true;
      figure.add(mesh);
    }
    const scale = 1.1;
    figure.scale.setScalar(scale);
    figure.position.set(0.3, 0.62 - 0.86 * scale, 0.2); // down in the hatch to mid-chest, in turret space
    this.turretPivot.add(figure);
  }

  /**
   * The commander, facing -Z with his belt at y 0.9: a tanker's jacket with pockets, epaulettes
   * and a cross strap, a ribbed padded helmet with earphones and a throat mic, and both hands
   * holding a pair of binoculars up to his eyes. Kit and binoculars are in the darker slot.
   */
  private static buildCommander(): PartBuilder {
    const skin = SLOT.body;
    const kit = SLOT.dark;
    const p = new PartBuilder();
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const ball = (r: number, at: THREE.Vector3, mat: THREE.Material) => p.add(new THREE.SphereGeometry(r, 10, 8), mat, at.x, at.y, at.z);

    // Jacket: a tapered, slightly flattened torso leaning forward into the view.
    p.add(new THREE.CylinderGeometry(0.2, 0.22, 0.5, 14), skin, 0, 1.1, 0.01, -0.1, 0, 0, 1, 1, 0.68);
    p.add(new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin, 0, 1.32, 0.03, -0.1, 0, 0, 1.12, 0.45, 0.72); // shoulders
    p.add(new THREE.TorusGeometry(0.11, 0.035, 6, 14), skin, 0, 1.39, 0.02, Math.PI / 2 - 0.1); // rolled collar
    for (const s of [-1, 1]) {
      p.add(new THREE.BoxGeometry(0.12, 0.1, 0.03), skin, s * 0.09, 1.2, -0.13, -0.1); // chest pocket
      p.add(new THREE.BoxGeometry(0.13, 0.035, 0.035), skin, s * 0.09, 1.25, -0.14, -0.1); // pocket flap
      p.add(new THREE.BoxGeometry(0.12, 0.025, 0.1), kit, s * 0.2, 1.37, 0.02); // epaulette
    }
    for (const y of [1.02, 1.1, 1.18, 1.3]) ball(0.014, v(0, y, -0.14 + (y - 1.02) * 0.1), kit); // buttons
    // Belt with a buckle, and a map-case strap across the chest.
    p.add(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 14), kit, 0, 0.9, 0.01, 0, 0, 0, 1, 1, 0.7);
    p.add(new THREE.BoxGeometry(0.07, 0.06, 0.02), skin, 0, 0.9, -0.16);
    p.beam(v(0.17, 1.35, -0.1), v(-0.17, 0.93, -0.13), 0.035, kit);

    // Head, chin and ears under a padded tanker's helmet with ribs and earphone cups.
    ball(0.13, v(0, 1.54, -0.01), skin);
    p.add(new THREE.SphereGeometry(0.08, 10, 8), skin, 0, 1.46, -0.06, 0, 0, 0, 1, 0.8, 1); // jaw
    p.add(new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), kit, 0, 1.56, 0.01);
    for (const x of [-0.07, 0, 0.07]) {
      p.add(new THREE.TorusGeometry(0.15, 0.018, 5, 16, Math.PI), kit, x, 1.56, 0.01, 0, Math.PI / 2, 0); // padded ribs
    }
    for (const s of [-1, 1]) {
      p.add(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 12).rotateZ(Math.PI / 2), kit, s * 0.14, 1.53, 0.01); // earphones
      p.beam(v(s * 0.13, 1.5, 0.01), v(s * 0.06, 1.42, -0.06), 0.02, kit); // chin strap
    }
    p.add(new THREE.BoxGeometry(0.2, 0.04, 0.12), kit, 0, 1.43, -0.02); // throat mic band
    ball(0.03, v(0.06, 1.43, -0.09), kit);
    p.add(new THREE.BoxGeometry(0.045, 0.06, 0.05), skin, 0, 1.49, -0.14); // nose, under the binoculars

    // Binoculars up to his eyes: two barrels with a hinge bridge, eyecups and big objective rims.
    const eyeY = 1.56;
    for (const s of [-1, 1]) {
      const x = s * 0.055;
      p.add(tubeZ(0.042, 0.042, 0.16, 12), kit, x, eyeY, -0.24);
      p.add(tubeZ(0.052, 0.042, 0.08, 12), kit, x, eyeY, -0.35); // flared objective end
      p.add(new THREE.TorusGeometry(0.05, 0.01, 6, 14), skin, x, eyeY, -0.39); // lens rim
      p.add(tubeZ(0.035, 0.035, 0.05, 10), kit, x, eyeY, -0.14); // eyecup
    }
    p.add(new THREE.BoxGeometry(0.06, 0.035, 0.12), kit, 0, eyeY + 0.01, -0.25); // hinge bridge
    p.add(tubeX(0.015, 0.07, 8), skin, 0, eyeY + 0.035, -0.22); // focus wheel
    // Neck strap looping down from the binoculars.
    for (const s of [-1, 1]) p.beam(v(s * 0.1, eyeY - 0.02, -0.2), v(s * 0.08, 1.36, -0.12), 0.015, kit);

    // Arms: elbows out to the sides, forearms up so both hands cup the binoculars.
    for (const s of [-1, 1]) {
      const shoulder = v(s * 0.22, 1.32, 0.02);
      const elbow = v(s * 0.3, 1.3, -0.2);
      const wrist = v(s * 0.11, 1.52, -0.28);
      p.beam(shoulder, elbow, 0.12, skin, true);
      p.beam(elbow, wrist, 0.1, skin, true);
      ball(0.065, elbow, skin);
      p.add(new THREE.CylinderGeometry(0.058, 0.058, 0.04, 10), skin, wrist.x * 0.95, wrist.y - 0.02, wrist.z + 0.02, 0.9, 0, s * 0.6); // cuff
      // Hand wrapped round the barrel, thumb underneath.
      p.add(new THREE.BoxGeometry(0.05, 0.1, 0.11), skin, s * 0.1, eyeY, -0.27);
      p.add(new THREE.BoxGeometry(0.1, 0.025, 0.05), skin, s * 0.06, eyeY - 0.05, -0.25); // thumb
    }
    return p;
  }

  private static buildGun(body: THREE.Material, dark: THREE.Material, deep: THREE.Material): PartBuilder {
    const p = new PartBuilder();
    p.add(tubeZ(0.16, 0.16, 0.36, 14), dark, 0, 0, -0.1); // sleeve out of the mantlet
    p.add(tubeZ(0.085, 0.11, 2.3, 14), body, 0, 0, -1.15);
    p.add(tubeZ(0.13, 0.13, 0.34, 14), body, 0, 0, -1.05); // fume extractor
    p.add(tubeZ(0.09, 0.13, 0.08, 14), body, 0, 0, -1.26);
    p.add(tubeZ(0.13, 0.09, 0.08, 14), body, 0, 0, -0.84);
    // Muzzle brake: a block with dark vent slots either side.
    p.add(new THREE.BoxGeometry(0.3, 0.2, 0.36), dark, 0, 0, -2.2);
    for (const z of [-2.12, -2.26]) p.add(new THREE.BoxGeometry(0.31, 0.13, 0.05), deep, 0, 0, z);
    p.add(tubeZ(0.1, 0.1, 0.05, 12), dark, 0, 0, -2.4);
    return p;
  }

  private applyAim(): void {
    this.turretPivot.rotation.y = this.barrelYaw;
    // +X rotation tips the -Z barrel upward, so positive pitch = barrel up.
    this.barrelPivot.rotation.x = this.barrelPitch;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion);
  }

  get muzzleWorldPosition(): THREE.Vector3 {
    const v = new THREE.Vector3();
    this.muzzle.getWorldPosition(v);
    return v;
  }

  get muzzleWorldDirection(): THREE.Vector3 {
    const q = new THREE.Quaternion();
    this.barrelPivot.getWorldQuaternion(q);
    return new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  }

  get turretWorldYaw(): number {
    return this.hullYaw + this.barrelYaw;
  }

  /** Hull heading in radians; 0 faces -Z, positive turns left. */
  get yaw(): number {
    return this.hullYaw;
  }

  /** Set heading for airborne tank variants that don't use ground driving. */
  protected setHullHeading(yaw: number): void {
    this.hullYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    this.root.quaternion.setFromAxisAngle(Y_AXIS, this.hullYaw);
    this.body.setNextKinematicRotation(this.root.quaternion);
  }

  get aimPitch(): number {
    return this.barrelPitch;
  }

  /** Hide the turret body (keeping the barrel) so a first-person camera doesn't clip into it. */
  setTurretHidden(hidden: boolean): void {
    for (const child of this.turretPivot.children) {
      if (child !== this.barrelPivot) child.visible = !hidden;
    }
  }

  get isDestroyed(): boolean {
    return this.health <= 0;
  }

  get physicsCollider(): RAPIER.Collider {
    return this.collider;
  }

  /** Which armour face a world-space hit point lands on, judged from the hull's heading. */
  hitZone(point: THREE.Vector3): ArmorZone {
    const local = point.clone().sub(this.position).applyAxisAngle(Y_AXIS, -this.hullYaw);
    const offNose = Math.abs(Math.atan2(local.x, -local.z)); // 0 = dead ahead, π = dead astern
    if (offNose < FRONT_ARC) return 'front';
    if (offNose > REAR_ARC) return 'rear';
    return 'side';
  }

  /** Applies damage, scaled by armour when the hit point is known. Returns the face that was hit. */
  takeDamage(amount: number, hitPoint?: THREE.Vector3): ArmorZone | null {
    if (!this.alive || this.shielded) return null;
    const zone = hitPoint ? this.hitZone(hitPoint) : null;
    this.health = Math.max(0, this.health - amount * (zone ? ARMOR_MULTIPLIER[zone] : 1));
    return zone;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** Rotate the turret/barrel by the given deltas (radians), clamping barrel pitch. */
  protected aim(yawDelta: number, pitchDelta: number): void {
    this.barrelYaw += yawDelta;
    this.barrelPitch = clamp(this.barrelPitch + pitchDelta, this.barrelPitchMin, this.barrelPitchMax);
    this.applyAim();
  }

  /** Point the turret at a world-space target, at an angular rate limited by radPerSec. */
  protected aimToward(targetWorld: THREE.Vector3, radPerSec: number, dt: number): void {
    const toTarget = new THREE.Vector3().subVectors(targetWorld, this.muzzleWorldPosition);
    const localDir = toTarget.clone().applyQuaternion(this.root.quaternion.clone().invert());
    const desiredYaw = Math.atan2(-localDir.x, -localDir.z);
    const flatDist = Math.sqrt(localDir.x * localDir.x + localDir.z * localDir.z);
    const desiredPitch = clamp(Math.atan2(localDir.y, flatDist), this.barrelPitchMin, this.barrelPitchMax);

    let yawDelta = desiredYaw - this.barrelYaw;
    yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
    const maxStep = radPerSec * dt;
    this.barrelYaw += clamp(yawDelta, -maxStep, maxStep);

    let pitchDelta = desiredPitch - this.barrelPitch;
    pitchDelta = clamp(pitchDelta, -maxStep, maxStep);
    this.barrelPitch = clamp(this.barrelPitch + pitchDelta, this.barrelPitchMin, this.barrelPitchMax);
    this.applyAim();
  }

  /** True once the turret is aimed within `tolerance` radians of the target direction. */
  protected isAimedAt(targetWorld: THREE.Vector3, tolerance: number): boolean {
    const toTarget = new THREE.Vector3().subVectors(targetWorld, this.muzzleWorldPosition).normalize();
    const aimDir = this.muzzleWorldDirection;
    return aimDir.angleTo(toTarget) < tolerance;
  }

  /** Drive the hull for this frame using skid-steer kinematics; handles terrain + obstacle collision. */
  protected drive(throttle: number, steer: number, dt: number, maxSpeed: number): void {
    if (this.stuckTime > 0) {
      throttle = 0;
      steer = 0;
    }
    const turnAuthority = 0.75 + 0.25 * Math.abs(throttle);
    this.hullYaw -= steer * MAX_YAW_RATE * dt * turnAuthority;
    this.hullYaw = Math.atan2(Math.sin(this.hullYaw), Math.cos(this.hullYaw));
    this.root.quaternion.setFromAxisAngle(Y_AXIS, this.hullYaw);

    const wading = waterDepthAt(this.root.position.x, this.root.position.z) > 0.4;
    if (this.fasterOnRoads) {
      // Eases up to the road speed (and back down off it) rather than jumping.
      const goal = isOnRoad(this.root.position.x, this.root.position.z) ? ROAD_SPEED_BOOST : 1;
      this.roadBoost += (goal - this.roadBoost) * Math.min(1, dt * 2.5);
    }
    const speed = throttle * maxSpeed * (wading ? 0.5 : this.roadBoost);
    const fwd = this.forward;
    const desired = new THREE.Vector3(fwd.x * speed * dt, -GROUND_SEEK * dt, fwd.z * speed * dt);

    this.controller.computeColliderMovement(this.collider, desired);
    const corrected = this.controller.computedMovement();
    const t = this.body.translation();
    const newPos = new THREE.Vector3(t.x + corrected.x, t.y + corrected.y, t.z + corrected.z);

    // A kinematic body under the one-sided heightfield can never climb back out, so recover it.
    const floorY = heightAt(newPos.x, newPos.z) + HULL_HALF_EXTENTS.y;
    if (newPos.y < floorY - 1.5) newPos.y = floorY + 0.2;

    this.body.setNextKinematicTranslation(newPos);

    this.body.setNextKinematicRotation(this.root.quaternion);
    this.root.position.copy(newPos);
  }

  teleport(x: number, z: number, facingRadians = this.hullYaw): void {
    const y = heightAt(x, z) + HULL_HALF_EXTENTS.y + 0.2;
    this.hullYaw = facingRadians;
    this.root.quaternion.setFromAxisAngle(Y_AXIS, facingRadians);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(this.root.quaternion, true);
    this.root.position.set(x, y, z);
  }

  /**
  * Jam over the muzzle: the gun can't fire for duration seconds, with a glob on the barrel and
  * a tag overhead. Returns true if it wasn't already jammed.
  */
  jamGun(duration: number): boolean {
    if (!this.alive || this.gunJamTime > 0) return false;
    this.gunJamTime = duration;
    this.fireCooldown = Math.max(this.fireCooldown, duration);
    const glob = createMuzzleGlob(1.3);
    glob.position.set(0, 0, 0.05);
    this.muzzle.add(glob);
    const tag = createJammedTag(3.4);
    tag.position.y = 4.5;
    this.root.add(tag);
    this.gunJamVisuals = [glob, tag];
    return true;
  }

  /**
   * Stuck in jam: the tracks are gummed up for `duration` seconds (the turret still turns), with
   * jam over the running gear and a tag overhead. More jam tops it back up. Returns true if the
   * tank wasn't already stuck.
   */
  stickInJam(duration: number): boolean {
    if (!this.alive || this.isDestroyed) return false;
    const fresh = this.stuckTime <= 0;
    this.stuckTime = Math.max(this.stuckTime, duration);
    if (!fresh) return false;
    for (const s of [-1, 1]) {
      for (const z of [-1.3, 0, 1.3]) {
        const glob = createMuzzleGlob(1.5 + Math.random() * 0.6);
        glob.position.set(s * (HULL_HALF_EXTENTS.x + 0.2), -0.2, z + (Math.random() - 0.5) * 0.4);
        glob.scale.y *= 0.7;
        this.root.add(glob);
        this.stuckVisuals.push(glob);
      }
    }
    const tag = createJammedTag(3.8, 'STUCK IN JAM!');
    tag.position.y = 3.4;
    this.root.add(tag);
    this.stuckVisuals.push(tag);
    return true;
  }

  get isStuck(): boolean {
    return this.stuckTime > 0;
  }

  get isGunJammed(): boolean {
    return this.gunJamTime > 0;
  }

  /** Attempt to fire; returns muzzle world position/direction if a shot was fired. */
  tryFire(): { origin: THREE.Vector3; direction: THREE.Vector3 } | null {
    if (this.fireCooldown > 0 || !this.alive) return null;
    this.fireCooldown = this.fireInterval;
    return { origin: this.muzzleWorldPosition, direction: this.muzzleWorldDirection };
  }

  update(dt: number): void {
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.gunJamTime > 0) {
      this.gunJamTime -= dt;
      if (this.gunJamTime <= 0) {
        this.gunJamTime = 0;
        for (const v of this.gunJamVisuals) v.removeFromParent();
        this.gunJamVisuals = [];
      }
    }
    if (this.stuckTime > 0) {
      this.stuckTime -= dt;
      if (this.stuckTime <= 0) {
        this.stuckTime = 0;
        for (const v of this.stuckVisuals) v.removeFromParent();
        this.stuckVisuals = [];
      }
    }
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
