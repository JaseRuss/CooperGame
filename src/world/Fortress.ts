import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { AssetLibrary } from './AssetLibrary';
import type { Building } from './Building';
import { Bunker } from './Bunker';
import type { HitRegistry } from '../combat/HitRegistry';
import type { Objective } from './EnemyBase';
import { heightAt } from './Terrain';
import { siteToWorld, siteYaw, type Site } from './Landmarks';
import { plantBuilding } from './placeModel';
import { buildJeep, buildTruck } from './Vehicles';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';
import { plastic, shade, ARMY_TAN, ARMY_BLUE, ENEMY_ARMY_COLOR, type EnemyArmy } from '../utils/plastic';
import { KNIGHTS, ZOMBIES } from '../core/config';
import { buildKeep, buildGreatHall, buildPowderStore, buildBombard, buildWizardTower, buildHayCart, STONE, STONE_DARK, WOOD } from './Medieval';

const WALL = 100; // wall line, local
const WALL_HEIGHT = 7;
const WALL_THICK = 3;
const GATE_HALF = 12;
const DOOR_OPEN_TIME = 5;
const CONCRETE = KNIGHTS ? STONE : 0xa99f86;
/** The Great Castle's royal purple (its keep's roofs and flag on the HUD). */
const ROYAL = 0x7a4aa8;
/** Kenney colormap textures multiplied by these give tan and blue buildings. */
const TINT: Record<EnemyArmy, number> = { tan: 0xf0d7a6, blue: 0xa9c4f5 };

const sideArmy = (s: number): EnemyArmy => (s < 0 ? 'tan' : 'blue');

function flagTexture(army: EnemyArmy): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#' + ENEMY_ARMY_COLOR[army].toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 128, 80);
  ctx.fillStyle = '#2a2016';
  ctx.beginPath();
  ctx.arc(64, 40, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#' + ENEMY_ARMY_COLOR[army].toString(16).padStart(6, '0');
  ctx.fillRect(42, 36, 44, 8);
  ctx.fillRect(60, 18, 8, 44);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function signTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#8a7447');
  grad.addColorStop(0.5, '#3a3f4a');
  grad.addColorStop(1, '#2f4f86');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#f4ecd0';
  ctx.font = '900 58px "Black Ops One", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Recolours a cloned Kenney model by multiplying its texture with `tint`. */
function tint(model: THREE.Object3D, color: number): THREE.Object3D {
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
      const c = (m as THREE.MeshStandardMaterial).clone();
      c.color.setHex(color);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  });
  return model;
}

/** The joint tan/blue command headquarters: a long two-winged block with a central tower. */
function buildHQ(): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const tan = plastic(ARMY_TAN);
  const blue = plastic(ARMY_BLUE);
  const dark = plastic(0x2e3036);
  const trim = plastic(0xd8d2bd);
  for (const s of [-1, 1]) {
    const wing = s < 0 ? tan : blue;
    p.add(new THREE.BoxGeometry(18, 10, 18), wing, s * 9, 5, 0);
    p.add(new THREE.BoxGeometry(18.4, 0.6, 18.4), trim, s * 9, 10.2, 0);
    // Two rows of windows front and back.
    for (let i = 0; i < 5; i++) {
      for (const y of [3.2, 7]) {
        for (const z of [-9.05, 9.05]) p.add(new THREE.BoxGeometry(2, 1.6, 0.1), dark, s * (2.5 + i * 3.2), y, z);
      }
    }
    // Rooftop air units and a flag on each wing.
    p.add(new THREE.BoxGeometry(3, 1.4, 2.4), trim, s * 12, 11.2, -4);
    p.add(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), trim, s * 15, 13.8, 5);
  }
  // Central tower spanning the join, with a radar dish and antennas.
  p.add(new THREE.BoxGeometry(9, 8, 9), tan, -2.25, 14, 0, 0, 0, 0, 0.5, 1, 1);
  p.add(new THREE.BoxGeometry(4.5, 8, 9), blue, 2.25, 14, 0);
  p.add(new THREE.BoxGeometry(4.5, 8, 9), tan, -2.25, 14, 0);
  p.add(new THREE.BoxGeometry(9.6, 0.6, 9.6), trim, 0, 18.2, 0);
  for (const z of [-4.55, 4.55]) for (const x of [-3, 0, 3]) p.add(new THREE.BoxGeometry(1.6, 2.2, 0.1), dark, x, 14.5, z);
  p.add(new THREE.CylinderGeometry(0.15, 0.2, 6, 8), dark, 2.5, 21.5, 2.5);
  p.add(new THREE.CylinderGeometry(0.08, 0.1, 4, 6), dark, -2.5, 20.5, 2.5);
  p.add(new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), trim, -1.5, 20, -2, -1.1);
  // Grand entrance: columns, canopy, steps and sandbagged guard posts.
  p.add(new THREE.BoxGeometry(10, 0.6, 4), trim, 0, 5.2, 11);
  for (const x of [-4, -1.3, 1.3, 4]) p.add(new THREE.CylinderGeometry(0.35, 0.4, 5, 10), trim, x, 2.5, 12.5);
  p.add(new THREE.BoxGeometry(5, 3.6, 0.2), dark, 0, 1.8, 9.1);
  for (let i = 0; i < 3; i++) p.add(new THREE.BoxGeometry(10 - i, 0.25, 1.2), trim, 0, 0.12 + i * 0.25, 14.2 - i * 0.6);
  p.buildInto(g);
  for (const [s, army] of [[-1, 'tan'], [1, 'blue']] as const) {
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.9).translate(1.5, 0, 0), new THREE.MeshStandardMaterial({ map: flagTexture(army), side: THREE.DoubleSide }));
    flag.position.set(s * 15, 16.2, 5);
    g.add(flag);
  }
  return g;
}

/** A big field gun on a turntable, barrel raised toward the gate, ringed with sandbags. */
function buildBigGun(color: number): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const body = plastic(color);
  const dark = plastic(shade(color, 0.55));
  const bag = plastic(shade(color, 0.8));
  p.add(new THREE.CylinderGeometry(3.4, 3.8, 0.8, 24), dark, 0, 0.4, 0);
  p.add(new THREE.BoxGeometry(3.4, 2.2, 3.8), body, 0, 1.9, 0.4);
  p.add(new THREE.BoxGeometry(3.8, 0.4, 4.2), dark, 0, 3.1, 0.4);
  // Barrel raised ~25°, with recoil cylinders and a muzzle brake.
  const up = 0.44;
  const dir = new THREE.Vector3(0, Math.sin(up), -Math.cos(up));
  const at = (d: number) => new THREE.Vector3(0, 2.2, -1).addScaledVector(dir, d);
  const m = at(6);
  p.add(tubeZ(0.34, 0.45, 12, 14), body, m.x, m.y, m.z, up);
  const brake = at(12.2);
  p.add(new THREE.BoxGeometry(1.1, 0.8, 1.2), dark, brake.x, brake.y, brake.z, up);
  for (const s of [-1, 1]) {
    const r = at(2);
    p.add(tubeZ(0.16, 0.16, 3, 10), dark, s * 0.6, r.y - 0.3, r.z, up);
  }
  p.add(tubeX(0.7, 3.6, 16), dark, 0, 2.2, -1); // trunnion
  // Sandbag ring (open at the back) and a stack of shells.
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI * 0.8 + (i / 15) * Math.PI * 1.6 + (row % 2) * 0.05;
      p.add(new THREE.CapsuleGeometry(0.34, 0.9, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.72, 1), bag, Math.sin(a) * 5.4, 0.25 + row * 0.44, -Math.cos(a) * 5.4, 0, a);
    }
  }
  for (let i = 0; i < 6; i++) p.add(new THREE.CylinderGeometry(0.18, 0.18, 1.1, 10), plastic(0xc9a13a), 2.4 + (i % 3) * 0.4, 0.55, 3.6 + Math.floor(i / 3) * 0.4);
  p.buildInto(g);
  return g;
}

/** Steel lattice tower with dishes and whip antennas. */
function buildCommsTower(): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const steel = plastic(0x6b7166);
  const white = plastic(0xe8e4d8);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    p.beam(v(ax * 2.4, 0, az * 2.4), v(ax * 0.8, 22, az * 0.8), 0.3, steel);
    for (let k = 0; k < 6; k++) {
      const y0 = (k / 6) * 22;
      const y1 = ((k + 1) / 6) * 22;
      const w0 = 2.4 - (1.6 * y0) / 22;
      const w1 = 2.4 - (1.6 * y1) / 22;
      p.beam(v(ax * w0, y0, az * w0), v(bx * w1, y1, bz * w1), 0.12, steel);
      p.beam(v(ax * w1, y1, az * w1), v(bx * w1, y1, bz * w1), 0.14, steel);
    }
  }
  for (const [y, a] of [[15, 0], [18, 2.1], [12, 4.2]]) {
    p.add(new THREE.SphereGeometry(1.4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 3), white, Math.cos(a) * 1.3, y, Math.sin(a) * 1.3, 0, -a, Math.PI / 2);
  }
  p.add(new THREE.CylinderGeometry(0.06, 0.08, 6, 6), steel, 0, 25, 0);
  p.add(new THREE.SphereGeometry(0.3, 8, 6), plastic(0xd0463a), 0, 28.1, 0);
  p.add(new THREE.BoxGeometry(5, 3, 4), plastic(0x8a8f86), 4.5, 1.5, 0); // equipment hut
  p.buildInto(g);
  return g;
}

/**
 * The Fortress: a walled joint tan/blue stronghold in the middle of the map. Its gates stay shut
 * (and everything inside is indestructible) until every enemy base has fallen.
 */
export class Fortress {
  /** On the knights mission it's the Great Castle. */
  readonly name = KNIGHTS ? 'Great Castle' : 'Fortress';
  readonly title = KNIGHTS ? 'The Great Castle' : 'The Fortress';
  readonly center: THREE.Vector3;
  readonly objectives: Objective[] = [];
  readonly buildings: Building[] = [];
  readonly bunkers: Bunker[] = [];
  locked = true;
  private readonly doors: { mesh: THREE.Object3D; closedX: number; openX: number }[] = [];
  private readonly doorBodies: RAPIER.RigidBody[] = [];
  private readonly padlocks: THREE.Object3D[] = [];
  private doorT = 0;

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    hitRegistry: HitRegistry,
    assets: AssetLibrary,
    readonly site: Site,
  ) {
    const yaw = siteYaw(site);
    const ground = heightAt(site.cx, site.cz);
    this.center = new THREE.Vector3(site.cx, ground, site.cz);
    const at = (lx: number, lz: number) => siteToWorld(site, lx, lz);

    this.buildGround(ground, yaw);
    this.buildWalls(ground, yaw);

    // On the zombie mission the Fortress is ours: the last stand of every army.
    const owner = ZOMBIES ? 'player' : 'enemy';
    const objective = (label: string, b: Building) => {
      b.faction = owner;
      this.buildings.push(b);
      this.objectives.push({ label, position: b.center, isDestroyed: () => b.destroyed });
    };

    if (KNIGHTS) {
      this.buildCastleInside(world, hitRegistry, objective);
    } else {
      const hq = at(0, -50);
      const hqBuilding = plantBuilding(world, scene, hitRegistry, buildHQ(), hq.x, hq.z, yaw, 1, 700, 0x8a8478);
      hqBuilding.explosionSize = 4.5;
      objective('Command HQ', hqBuilding);
      const comms = at(0, 28);
      objective('Comms Tower', plantBuilding(world, scene, hitRegistry, buildCommsTower(), comms.x, comms.z, yaw, 1, 220, 0x6b7166));

      for (const s of [-1, 1]) {
        const army = sideArmy(s);
        const name = army === 'tan' ? 'Tan' : 'Blue';
        const color = ENEMY_ARMY_COLOR[army];
        const place = (model: string, lx: number, lz: number, scale: number, hp: number, turn = 0) => {
          const p = at(lx, lz);
          return plantBuilding(world, scene, hitRegistry, tint(assets.clone('industrial', model), TINT[army]), p.x, p.z, yaw + turn, scale, hp, 0x9c9478);
        };
        objective(`${name} Factory`, place('building-l', s * 64, -62, 11, 320));
        objective(`${name} Warehouse`, place('building-r', s * 66, 0, 10, 260, Math.PI / 2));
        for (const lz of [44, 62]) {
          const tank = place('detail-tank-large', s * 80, lz, 8, 20);
          tank.fuel = true;
          objective(`${name} Fuel Tank`, tank);
        }
        const gp = at(s * 34, 66);
        objective(`${name} Big Gun`, plantBuilding(world, scene, hitRegistry, buildBigGun(color), gp.x, gp.z, yaw, 1, 240, color));
        const bp = at(s * 26, 6);
        const bunker = new Bunker(world, scene, hitRegistry, bp.x, bp.z, yaw + Math.PI, owner, color);
        this.bunkers.push(bunker);
        this.buildings.push(bunker.building);
        this.objectives.push({ label: `${name} Command Bunker`, position: bunker.position, isDestroyed: () => !bunker.alive });
        // Gate bunkers (not objectives) covering the inside of each gatehouse.
        for (const lz of [-80, 80]) {
          const gb = at(s * 26, lz);
          const guard = new Bunker(world, scene, hitRegistry, gb.x, gb.z, yaw + (lz > 0 ? Math.PI : 0), owner, color);
          this.bunkers.push(guard);
          this.buildings.push(guard.building);
        }
        // Parked trucks and jeeps in army colours, and stacks of containers.
        for (const [model, lx, lz, turn] of [
          [buildTruck(color), s * 44, -24, 0],
          [buildTruck(color), s * 50, -24, 0],
          [buildJeep(color, { stars: false }), s * 40, 30, Math.PI / 2],
        ] as [THREE.Group, number, number, number][]) {
          const p = at(lx, lz);
          model.position.set(p.x, heightAt(p.x, p.z), p.z);
          model.rotation.y = yaw + turn;
          scene.add(model);
          this.solidBox(p.x, heightAt(p.x, p.z) + 1.2, p.z, 1.3, 1.2, 3.3, yaw + turn);
        }
        for (const [model, lx, lz] of [['shipping-container-a', s * 86, -20], ['shipping-container-b', s * 86, -30]] as [string, number, number][]) {
          this.buildings.push(place(model, lx, lz, 11, 40));
        }
      }
    }
    for (const b of this.buildings) {
      b.faction = owner;
      b.locked = true;
    }
  }

  /**
   * The Great Castle's courtyard (knights mission): a royal keep, a wizard's tower, and on each
   * side a great hall, barracks, powder stores, a giant bombard and guardhouses, with hay carts.
   * Same places as the Fortress's pieces.
   */
  private buildCastleInside(world: RAPIER.World, hitRegistry: HitRegistry, objective: (label: string, b: Building) => void): void {
    const yaw = siteYaw(this.site);
    const at = (lx: number, lz: number) => siteToWorld(this.site, lx, lz);
    const plant = (model: THREE.Object3D, lx: number, lz: number, turn: number, scale: number, hp: number, debris = STONE_DARK) => {
      const p = at(lx, lz);
      return plantBuilding(world, this.scene, hitRegistry, model, p.x, p.z, yaw + turn, scale, hp, debris);
    };
    const keep = plant(buildKeep(ROYAL), 0, -50, 0, 1.55, 700);
    keep.explosionSize = 4.5;
    objective('Royal Keep', keep);
    objective('Wizard Tower', plant(buildWizardTower(), 0, 28, 0, 1, 220));
    for (const s of [-1, 1]) {
      const army = sideArmy(s);
      const name = army === 'tan' ? 'Tan' : 'Blue';
      const color = ENEMY_ARMY_COLOR[army];
      objective(`${name} Great Hall`, plant(buildGreatHall(color), s * 64, -62, 0, 1, 320));
      objective(`${name} Barracks`, plant(buildGreatHall(color, 18), s * 66, 0, Math.PI / 2, 1, 260));
      for (const lz of [44, 62]) {
        const store = plant(buildPowderStore(), s * 80, lz, 0, 1, 20, 0x5a3b24);
        store.fuel = true;
        objective(`${name} Powder Store`, store);
      }
      objective(`${name} Bombard`, plant(buildBombard(color), s * 34, 66, 0, 1, 240, 0x4a4d52));
      const bp = at(s * 26, 6);
      const bunker = new Bunker(world, this.scene, hitRegistry, bp.x, bp.z, yaw + Math.PI, 'enemy', color);
      this.bunkers.push(bunker);
      this.buildings.push(bunker.building);
      this.objectives.push({ label: `${name} Guardhouse`, position: bunker.position, isDestroyed: () => !bunker.alive });
      for (const lz of [-80, 80]) {
        const gb = at(s * 26, lz);
        const guard = new Bunker(world, this.scene, hitRegistry, gb.x, gb.z, yaw + (lz > 0 ? Math.PI : 0), 'enemy', color);
        this.bunkers.push(guard);
        this.buildings.push(guard.building);
      }
      for (const [lx, lz, turn] of [[s * 44, -24, 0], [s * 50, -24, 0.2], [s * 40, 30, Math.PI / 2], [s * 86, -20, 0], [s * 86, -30, 0.1]]) {
        this.buildings.push(plant(buildHayCart(), lx, lz, turn, 1, 40, 0x8a6a3a));
      }
    }
  }

  private solidBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number): RAPIER.RigidBody {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
    return body;
  }

  private buildGround(ground: number, yaw: number): void {
    const g = new THREE.Group();
    g.position.set(this.site.cx, ground, this.site.cz);
    g.rotation.y = yaw;
    this.scene.add(g);
    const flat = (w: number, d: number, color: number, x: number, z: number, offset: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.05, z);
      m.receiveShadow = true;
      g.add(m);
    };
    // Tan and blue halves of the parade ground, and the road between the two gates.
    flat(WALL, WALL * 2, 0xb8a47c, -WALL / 2, 0, -2);
    flat(WALL, WALL * 2, 0x8e9ab4, WALL / 2, 0, -2);
    flat(16, WALL * 2 + 40, KNIGHTS ? 0x9a7c52 : 0x45484d, 0, 0, -3);
    if (!KNIGHTS) for (let z = -WALL; z < WALL; z += 10) flat(0.4, 5, 0xe8d36a, 0, z + 2.5, -4);
  }

  /** Crenellated walls with corner towers, and a padlocked gatehouse on the north and south sides. */
  private buildWalls(ground: number, yaw: number): void {
    const g = new THREE.Group();
    g.position.set(this.site.cx, ground, this.site.cz);
    g.rotation.y = yaw;
    this.scene.add(g);
    const concrete = plastic(CONCRETE);
    const cap = plastic(shade(CONCRETE, 0.85));
    const tan = plastic(ARMY_TAN);
    const blue = plastic(ARMY_BLUE);
    const dark = plastic(0x2e3036);
    const p = new PartBuilder();
    const world = (lx: number, lz: number) => siteToWorld(this.site, lx, lz);

    // A wall run from a to b along one side (local coords), with merlons, pilasters and a stripe.
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const along = Math.atan2(x1 - x0, z1 - z0); // rotation that turns +Z along the run
      p.add(new THREE.BoxGeometry(WALL_THICK, WALL_HEIGHT, len), concrete, cx, WALL_HEIGHT / 2, cz, 0, along);
      p.add(new THREE.BoxGeometry(WALL_THICK + 0.8, 0.8, len), concrete, cx, 0.4, cz, 0, along); // plinth
      p.add(new THREE.BoxGeometry(WALL_THICK + 0.3, 0.5, len), cap, cx, WALL_HEIGHT + 0.25, cz, 0, along);
      const stripe = cx + (Math.abs(x1 - x0) > 1 ? 0 : 0) < 0 || (Math.abs(x1 - x0) > 1 && cx < 0) ? tan : cx > 0 ? blue : tan;
      p.add(new THREE.BoxGeometry(WALL_THICK + 0.1, 1.1, len), stripe, cx, WALL_HEIGHT - 1.4, cz, 0, along);
      const n = Math.floor(len / 4);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const mx = x0 + (x1 - x0) * t;
        const mz = z0 + (z1 - z0) * t;
        p.add(new THREE.BoxGeometry(WALL_THICK + 0.3, 1.2, 2), cap, mx, WALL_HEIGHT + 1.1, mz, 0, along);
        if (i % 5 === 2) p.add(new THREE.BoxGeometry(WALL_THICK + 1.2, WALL_HEIGHT, 1.6), concrete, mx, WALL_HEIGHT / 2, mz, 0, along);
      }
      // Collider for the run, in world space.
      const c = world(cx, cz);
      this.solidBox(c.x, ground + WALL_HEIGHT / 2, c.z, WALL_THICK / 2, WALL_HEIGHT / 2 + 2, len / 2, yaw + along);
    };
    run(-WALL, -WALL, -WALL, WALL); // west
    run(WALL, -WALL, WALL, WALL); // east
    for (const z of [-WALL, WALL]) {
      run(-WALL, z, -GATE_HALF - 4, z);
      run(GATE_HALF + 4, z, WALL, z);
    }

    // Corner towers flying each army's flag.
    for (const x of [-WALL, WALL]) {
      for (const z of [-WALL, WALL]) {
        p.add(new THREE.CylinderGeometry(6, 6.8, 13, 20), concrete, x, 6.5, z);
        p.add(new THREE.CylinderGeometry(6.6, 6.6, 0.6, 20), cap, x, 13.3, z);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          p.add(new THREE.BoxGeometry(1.6, 1.4, 1.2), cap, x + Math.cos(a) * 6, 14.3, z + Math.sin(a) * 6, 0, -a);
        }
        p.add(new THREE.CylinderGeometry(6.9, 6.9, 1.2, 20), x < 0 ? tan : blue, x, 10.5, z);
        // The Great Castle's towers wear tall pointed roofs.
        const roof = KNIGHTS ? 12 : 0;
        if (KNIGHTS) p.add(new THREE.ConeGeometry(7.4, roof, 20), plastic(ROYAL), x, 14 + roof / 2, z);
        p.add(new THREE.CylinderGeometry(0.12, 0.15, 8, 6), dark, x, 17.6 + roof, z);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5).translate(2, 0, 0), new THREE.MeshStandardMaterial({ map: flagTexture(sideArmy(x)), side: THREE.DoubleSide }));
        flag.position.set(x, 20 + roof, z);
        g.add(flag);
        const c = world(x, z);
        this.solidBox(c.x, ground + 7, c.z, 5.5, 7, 5.5, yaw);
      }
    }

    // Gatehouses: two towers, a bridge with the sign, sliding doors and a big padlock.
    const signMat = new THREE.MeshStandardMaterial({ map: signTexture(KNIGHTS ? 'THE GREAT CASTLE' : 'THE FORTRESS') });
    for (const z of [-WALL, WALL]) {
      const out = Math.sign(z);
      for (const s of [-1, 1]) {
        const tx = s * (GATE_HALF + 4);
        p.add(new THREE.BoxGeometry(8, 12, 8), concrete, tx, 6, z);
        p.add(new THREE.BoxGeometry(8.6, 0.6, 8.6), cap, tx, 12.3, z);
        for (const [mx, mz] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, -3], [0, 3], [-3, 0], [3, 0]]) {
          p.add(new THREE.BoxGeometry(1.4, 1.2, 1.4), cap, tx + mx, 13.2, z + mz);
        }
        p.add(new THREE.BoxGeometry(1.2, 2, 0.2), dark, tx, 8, z + out * 4.05); // arrow slit
        p.add(new THREE.BoxGeometry(8.2, 1.2, 8.2), s < 0 ? tan : blue, tx, 9.5, z);
        const c = world(tx, z);
        this.solidBox(c.x, ground + 6, c.z, 4, 6, 4, yaw);
      }
      p.add(new THREE.BoxGeometry(GATE_HALF * 2, 2.4, 6), concrete, 0, 10.8, z);
      for (const side of [1, -1]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(18, 3.4), signMat);
        sign.position.set(0, 10.8, z + side * 3.05);
        sign.rotation.y = side > 0 ? 0 : Math.PI;
        g.add(sign);
      }

      // Two door leaves meeting in the middle; they slide into the gatehouse towers when unlocked.
      for (const s of [-1, 1]) {
        const leaf = new PartBuilder();
        leaf.add(new THREE.BoxGeometry(GATE_HALF, 8.5, 1), plastic(KNIGHTS ? WOOD : 0x5b5f58), 0, 4.25, 0);
        for (let i = 0; i < 4; i++) leaf.add(new THREE.BoxGeometry(GATE_HALF - 0.4, 0.3, 1.2), dark, 0, 1 + i * 2.2, 0);
        for (let i = 0; i < 5; i++) leaf.add(new THREE.BoxGeometry(0.2, 8.2, 1.15), dark, -GATE_HALF / 2 + 1 + i * 2.5, 4.25, 0);
        leaf.add(new THREE.BoxGeometry(GATE_HALF - 1, 1.4, 1.1), s < 0 ? tan : blue, 0, 6.6, 0);
        const door = new THREE.Group();
        leaf.buildInto(door);
        const closedX = (s * GATE_HALF) / 2;
        door.position.set(closedX, 0, z);
        g.add(door);
        this.doors.push({ mesh: door, closedX, openX: s * (GATE_HALF + GATE_HALF / 2 + 1) });
      }
      const c = world(0, z);
      this.doorBodies.push(this.solidBox(c.x, ground + 5, c.z, GATE_HALF, 5, 0.8, yaw));

      // A giant padlock and chain across the doors, on the outside.
      const lock = new PartBuilder();
      const gold = plastic(0xd9a520);
      lock.add(new THREE.BoxGeometry(3, 3.2, 1.2), gold, 0, 3.4, 0);
      lock.add(new THREE.TorusGeometry(1.1, 0.3, 8, 16, Math.PI), plastic(0xb0b4b8), 0, 5.0, 0);
      lock.add(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12).rotateX(Math.PI / 2), dark, 0, 3.3, 0.65);
      for (let i = 0; i < 12; i++) {
        lock.add(new THREE.TorusGeometry(0.35, 0.1, 5, 10), plastic(0xb0b4b8), -GATE_HALF + 1 + i * 2, 4.4, 0, 0, (i % 2) * (Math.PI / 2));
      }
      const padlock = new THREE.Group();
      lock.buildInto(padlock);
      padlock.position.set(0, 0, z + out * 0.9);
      if (out < 0) padlock.rotation.y = Math.PI;
      g.add(padlock);
      this.padlocks.push(padlock);
    }
    p.buildInto(g);
  }

  /** Opens the gates and makes everything inside destructible. */
  unlock(): void {
    if (!this.locked) return;
    this.locked = false;
    for (const b of this.buildings) b.locked = false;
    for (const body of this.doorBodies) this.world.removeRigidBody(body);
    for (const p of this.padlocks) p.removeFromParent();
  }

  /** True for a point within the walls. */
  contains(x: number, z: number): boolean {
    const yaw = siteYaw(this.site);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const dx = x - this.site.cx;
    const dz = z - this.site.cz;
    // Inverse of siteToWorld.
    return Math.abs(dx * c - dz * s) < WALL + WALL_THICK && Math.abs(dx * s + dz * c) < WALL + WALL_THICK;
  }

  /** True for a point within `margin` metres outside the walls (or anywhere inside). */
  nearWall(x: number, z: number, margin: number): boolean {
    const yaw = siteYaw(this.site);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const dx = x - this.site.cx;
    const dz = z - this.site.cz;
    const reach = WALL + WALL_THICK + margin;
    return Math.abs(dx * c - dz * s) < reach && Math.abs(dx * s + dz * c) < reach;
  }

  /** Staging points just outside each gate, for reinforcements. */
  get rallyPoints(): THREE.Vector3[] {
    return [WALL + 45, -WALL - 45].map((lz) => {
      const p = siteToWorld(this.site, 0, lz);
      return new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z);
    });
  }

  /** A loop of points round the inside of the Fortress, for assault tanks to sweep. */
  get sweepRoute(): THREE.Vector3[] {
    return [[0, 70], [-45, 40], [-45, -30], [0, -80], [45, -30], [45, 40]].map(([lx, lz]) => {
      const p = siteToWorld(this.site, lx, lz);
      return new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z);
    });
  }

  /** The gate nearest a point, just outside it. */
  gateNear(x: number, z: number): THREE.Vector3 {
    let best = this.rallyPoints[0];
    for (const r of this.rallyPoints) if (Math.hypot(r.x - x, r.z - z) < Math.hypot(best.x - x, best.z - z)) best = r;
    return best;
  }

  get remaining(): number {
    return this.objectives.filter((o) => !o.isDestroyed()).length;
  }

  get isDestroyed(): boolean {
    return this.remaining === 0;
  }

  update(dt: number): void {
    if (this.locked || this.doorT >= 1) return;
    this.doorT = Math.min(1, this.doorT + dt / DOOR_OPEN_TIME);
    const t = this.doorT * this.doorT * (3 - 2 * this.doorT);
    for (const d of this.doors) d.mesh.position.x = d.closedX + (d.openX - d.closedX) * t;
  }
}
