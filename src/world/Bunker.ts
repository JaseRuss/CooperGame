import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Building } from './Building';
import type { HitRegistry } from '../combat/HitRegistry';
import { heightAt } from './Terrain';
import { plastic, shade, ARMY_TAN } from '../utils/plastic';
import type { Shot } from '../entities/Soldier';
import type { Faction } from '../entities/Tank';
import { PartBuilder, sandbagGeometry, tubeZ } from '../utils/modelKit';

const BUNKER_COLOR = 0xa99f86;
const BUNKER_HEALTH = 180;
const GUN_RANGE = 170;
const GUN_ARC = (80 * Math.PI) / 180; // either side of the firing slit
const BURST_SIZE = 6;
const BURST_GAP = 0.09;
const BURST_COOLDOWN = 2.2;
const LOS_INTERVAL = 0.5;
const GUN_TURN_RATE = 1.8;

const shapeCache = new Map<number, Map<THREE.Material, THREE.BufferGeometry>>();
const netMaterials = new Map<number, THREE.Material>();

/** The pillbox's fixed parts for a given sandbag colour, merged once and shared. */
function bunkerShapes(trim: number): Map<THREE.Material, THREE.BufferGeometry> {
  const cached = shapeCache.get(trim);
  if (cached) return cached;
  const concrete = plastic(BUNKER_COLOR);
  const lip = plastic(shade(BUNKER_COLOR, 0.85));
  const dark = plastic(shade(BUNKER_COLOR, 0.35));
  const metal = plastic(0x5b5f58);
  const wood = plastic(0x9a7a4a);
  const sandbag = plastic(shade(trim, 0.85));
  let net = netMaterials.get(trim);
  if (!net) {
    net = new THREE.MeshStandardMaterial({ color: shade(trim, 0.55), roughness: 1, side: THREE.DoubleSide });
    netMaterials.set(trim, net);
  }
  const p = new PartBuilder();
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  // Cast concrete: walls, a thick roof with a bevelled top, and corner buttresses.
  p.add(box(7, 2.4, 6), concrete, 0, 1.2, 0);
  p.add(box(7.8, 0.45, 6.8), concrete, 0, 2.62, 0);
  p.add(box(7.1, 0.25, 6.1), lip, 0, 2.96, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) p.add(box(0.7, 2.3, 0.7), lip, sx * 3.45, 1.15, sz * 2.95, 0, sx * sz * 0.785);
  }
  // Shuttering lines left by the wooden formwork.
  for (const y of [0.6, 1.2, 1.8]) {
    p.add(box(7.04, 0.05, 0.04), lip, 0, y, 3.01);
    p.add(box(0.04, 0.05, 6.04), lip, -3.51, y, 0);
    p.add(box(0.04, 0.05, 6.04), lip, 3.51, y, 0);
  }

  // Firing slit set in a stepped embrasure frame.
  p.add(box(4.2, 0.45, 0.3), dark, 0, 1.6, -2.92);
  p.add(box(4.8, 0.14, 0.4), lip, 0, 1.92, -3.0);
  p.add(box(4.8, 0.14, 0.4), lip, 0, 1.28, -3.0);
  for (const s of [-1, 1]) p.add(box(0.14, 0.78, 0.4), lip, s * 2.4, 1.6, -3.0);

  // Armoured rear door with rivets, a blast wall of sandbags in front of it, and steps.
  p.add(box(1.4, 2.0, 0.12), lip, 1.8, 1.0, 3.04);
  p.add(box(1.2, 1.8, 0.14), metal, 1.8, 0.9, 3.08);
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) p.add(new THREE.SphereGeometry(0.035, 6, 4), dark, 1.8 + s * 0.48, 0.3 + i * 0.44, 3.16);
  }
  p.add(box(0.08, 0.12, 0.06), dark, 2.25, 0.95, 3.17); // handle

  const bag = sandbagGeometry(0.7, 0.28);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3; i++) p.add(bag, sandbag, 1.1 + i * 0.75 + (row % 2) * 0.35, 0.2 + row * 0.38, 4.4);
  }
  for (let row = 0; row < 3; row++) p.add(bag, sandbag, 3.3, 0.2 + row * 0.38, 3.7 + (row % 2) * 0.2, 0, Math.PI / 2);

  // Three rows of sandbags wrapped round the front, and a row along each side.
  for (let row = 0; row < 3; row++) {
    const r = 4.4 - row * 0.12;
    for (let i = -6; i <= 6; i++) {
      const a = (i / 6) * 1.15 + (row % 2) * 0.09;
      p.add(bag, sandbag, Math.sin(a) * r, 0.2 + row * 0.38, -Math.cos(a) * r - 0.3, 0, a);
    }
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) p.add(bag, sandbag, s * 3.95, 0.2, -1.6 + i * 0.8, 0, Math.PI / 2);
  }

  // Ammunition crates and a jerry can stacked by the door.
  for (const [x, y, z, r] of [[-0.3, 0.3, 3.6, 0.1], [-1.1, 0.3, 3.55, -0.05], [-0.7, 0.9, 3.58, 0.3]]) {
    p.add(box(0.8, 0.6, 0.5), wood, x, y, z, 0, r);
    p.add(box(0.82, 0.08, 0.52), dark, x, y + 0.1, z, 0, r);
  }
  p.add(box(0.3, 0.46, 0.18), metal, -1.8, 0.23, 3.45);

  // Roof fittings: periscope, vent pipe with a rain cap, radio aerial.
  p.add(box(0.3, 0.5, 0.3), metal, -1.6, 3.3, -1.8);
  p.add(box(0.34, 0.16, 0.44), dark, -1.6, 3.6, -1.9);
  p.add(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 10), metal, 2.2, 3.5, 1.6);
  p.add(new THREE.ConeGeometry(0.28, 0.2, 10), metal, 2.2, 4.05, 1.6);
  p.add(new THREE.CylinderGeometry(0.025, 0.03, 1.4, 5), dark, 2.9, 3.8, 2.6);

  // Camouflage net thrown over the back half of the roof, lumpy and sagging over one edge.
  const netGeo = new THREE.PlaneGeometry(5.6, 3.8, 12, 8).rotateX(-Math.PI / 2);
  const pos = netGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const lumps = 0.1 * Math.sin(x * 2.3 + z * 1.7) + 0.07 * Math.sin(x * 5.1 - z * 3.3);
    const overhang = Math.max(0, z - 1.3) * 1.4; // drapes down over the rear edge
    pos.setY(i, lumps - overhang);
  }
  netGeo.computeVertexNormals();
  p.add(netGeo, net, -0.6, 3.2, 1.35);

  const shapes = p.buildGeometries();
  shapeCache.set(trim, shapes);
  return shapes;
}

function buildBunkerMesh(trim: number): { root: THREE.Group; gunPivot: THREE.Group } {
  const root = new THREE.Group();
  for (const [mat, geo] of bunkerShapes(trim)) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // Machine gun on a swivel, with a shield, cooling jacket and ammo belt box.
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, 1.6, -2.7);
  root.add(gunPivot);
  const dark = plastic(shade(BUNKER_COLOR, 0.35));
  const metal = plastic(0x5b5f58);
  const gun = new PartBuilder();
  gun.add(tubeZ(0.07, 0.08, 1.5, 8), dark, 0, 0, -0.75);
  gun.add(tubeZ(0.11, 0.11, 0.6, 10), metal, 0, 0, -0.55);
  gun.add(tubeZ(0.1, 0.07, 0.12, 8), dark, 0, 0, -1.5);
  gun.add(new THREE.BoxGeometry(0.3, 0.25, 0.5), dark, 0, 0, 0);
  gun.add(new THREE.BoxGeometry(0.2, 0.2, 0.26), metal, 0.24, -0.05, 0.05);
  gun.add(new THREE.BoxGeometry(0.9, 0.5, 0.05), metal, 0, 0.05, -0.36);
  gun.buildInto(gunPivot);

  return { root, gunPivot };
}

/** A destructible pillbox whose machine gun fires bursts at the other side within its front arc. */
export class Bunker {
  readonly building: Building;
  private readonly gunPivot: THREE.Group;
  private readonly facing: number;
  private gunYaw = 0;
  private burstLeft = 0;
  private burstTimer = 0;
  private cooldown = Math.random() * BURST_COOLDOWN;
  private losTimer = Math.random() * LOS_INTERVAL;
  private seesTarget = false;
  private readonly root: THREE.Group;

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    hitRegistry: HitRegistry,
    x: number,
    z: number,
    facing: number,
    readonly faction: Faction = 'enemy',
    /** Army colour of the sandbags. */
    trim: number = ARMY_TAN,
  ) {
    const { root, gunPivot } = buildBunkerMesh(trim);
    this.gunPivot = gunPivot;
    this.root = root;
    this.facing = facing;
    root.rotation.y = facing;
    root.position.set(x, heightAt(x, z) - 0.4, z); // sunk a little so slopes don't leave it floating
    scene.add(root);

    const box = new THREE.Box3().setFromObject(root);
    this.building = new Building(
      world,
      scene,
      hitRegistry,
      root,
      box.getSize(new THREE.Vector3()).multiplyScalar(0.5),
      box.getCenter(new THREE.Vector3()),
      BUNKER_HEALTH,
      BUNKER_COLOR,
    );
    this.building.faction = faction;
    // Weak point: a shell through the firing slit (local -Z face, around slit height).
    // The shell has to be travelling into the slit (from the front, not dropping onto the roof).
    const local = new THREE.Vector3();
    const inward = new THREE.Vector3();
    this.building.critSpots.push({
      label: 'Gun slit',
      test: (p, dir) => {
        root.worldToLocal(local.copy(p));
        inward.copy(dir).applyQuaternion(root.quaternion.clone().invert());
        return inward.z > 0.55 && Math.abs(local.x) < 2.6 && local.y > 1.15 && local.y < 2.15 && local.z < -2.5 && local.z > -3.3;
      },
    });
    this.building.critExplosionScale = 1.4;
  }

  /**
   * True when a jam glob that hit the bunker at `point`, flying along `velocity`, splats onto its
   * front wall round the gun slit. Jam gums up the gun for good, so it counts as a critical hit.
   * Much more forgiving than a shell's weak point: anywhere on the front face, from the front.
   */
  jamCritAt(point: THREE.Vector3, velocity: THREE.Vector3): boolean {
    if (!this.alive || this.building.locked) return false;
    const inverse = this.root.quaternion.clone().invert();
    const inward = velocity.clone().normalize().applyQuaternion(inverse);
    if (inward.z < 0.2) return false; // has to be heading into the front, not across or out of it
    const dir = velocity.clone().normalize();
    const local = new THREE.Vector3();
    // The collider is a box round everything (sandbags too), so follow the glob on in.
    for (let k = 0; k <= 18; k++) {
      this.root.worldToLocal(local.copy(point).addScaledVector(dir, k * 0.25));
      if (Math.abs(local.x) < 3.7 && local.y > 0.9 && local.y < 3.1 && local.z < -2.2 && local.z > -3.8) return true;
    }
    return false;
  }

  get alive(): boolean {
    return !this.building.destroyed;
  }

  get position(): THREE.Vector3 {
    return this.building.center;
  }

  /** 	arget: the nearest thing on the other side, or null when there's nothing to shoot at. */
  update(dt: number, world: RAPIER.World, target: THREE.Vector3 | null): Shot | null {
    if (!this.alive || !target) return null;

    const muzzle = this.gunPivot.localToWorld(new THREE.Vector3(0, 0, -1.5));
    const toPlayer = target.clone().setY(target.y + 0.6).sub(muzzle);
    const dist = toPlayer.length();
    if (dist > GUN_RANGE * 1.5) return null;

    // Angle of the player relative to the slit, in the bunker's own frame.
    const worldYaw = Math.atan2(-toPlayer.x, -toPlayer.z);
    let rel = worldYaw - this.facing;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const inArc = Math.abs(rel) < GUN_ARC;

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = LOS_INTERVAL;
      const exclude = this.building.physicsCollider ?? undefined;
      this.seesTarget =
        inArc &&
        dist < GUN_RANGE &&
        world.castRay(new RAPIER.Ray(muzzle, toPlayer.clone().normalize()), Math.max(0, dist - 3), true, undefined, undefined, exclude) === null;
    }

    const targetYaw = this.seesTarget ? THREE.MathUtils.clamp(rel, -GUN_ARC, GUN_ARC) : 0;
    const maxStep = GUN_TURN_RATE * dt;
    this.gunYaw += THREE.MathUtils.clamp(targetYaw - this.gunYaw, -maxStep, maxStep);
    this.gunPivot.rotation.y = this.gunYaw;
    this.gunPivot.rotation.x = this.seesTarget ? Math.atan2(toPlayer.y, Math.hypot(toPlayer.x, toPlayer.z)) : 0;

    this.cooldown -= dt;
    if (this.seesTarget && this.burstLeft === 0 && this.cooldown <= 0 && Math.abs(targetYaw - this.gunYaw) < 0.15) {
      this.burstLeft = BURST_SIZE;
      this.burstTimer = 0;
    }
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = BURST_GAP;
        this.burstLeft--;
        if (this.burstLeft === 0) this.cooldown = BURST_COOLDOWN;
        const dir = toPlayer.normalize();
        dir.x += (Math.random() - 0.5) * 0.05;
        dir.y += (Math.random() - 0.5) * 0.03;
        dir.z += (Math.random() - 0.5) * 0.05;
        return { origin: muzzle, direction: dir.normalize() };
      }
    }
    return null;
  }
}
