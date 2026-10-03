import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PartBuilder, sandbagGeometry } from '../utils/modelKit';
import { plastic, ARMY_GREEN, ARMY_TAN } from '../utils/plastic';
import { createFigureMesh, createCheeringFigure } from '../entities/Soldier';
import { buildJeepParts } from '../world/Vehicles';
import type { GuardPost } from './Facility';
import { mulberry32 } from '../utils/rng';
import { FRIENDLY_BASES, BASE_RADIUS as CAMP_RADIUS } from '../core/config';
import { HomeBase } from '../world/Base';
import { versionAssetURL } from '../world/AssetLibrary';
import { toppleInstances } from '../world/WorldGenerator';
import { TreeManager } from '../world/TreeManager';
import { TREE_SIZE, type Tree } from '../world/Tree';
import { HitRegistry } from '../combat/HitRegistry';

/**
 * The far shore: the beach the raft lands on, and a few hundred metres of fields, hedges, woods
 * and a farm north of it, with the tan army's guards out looking for the escapees, and Cooper's
 * Base at the end of the road.
 */
export const SHORE = {
  /** The waterline (the raft beaches here, heading north). */
  waterZ: -1200,
  ground: { minX: -150, maxX: 150, minZ: -1720, maxZ: -1196 },
  /** The road from the beach up to the gate of Cooper's Base (its sandbag wall is 65 m out). */
  road: [
    { x: 0, z: -1246 },
    { x: -22, z: -1320 },
    { x: -28, z: -1400 },
    { x: 14, z: -1480 },
    { x: 8, z: -1550 },
    { x: 0, z: -1598 },
  ] as { x: number; z: number }[],
  home: { x: 0, z: -1660 },
  /** Where the raft grounds, and where he steps ashore. */
  landing: { x: 0, z: -1214 },
};
/** Where he gets back up if he's knocked down: after the beach, the first fields, the roadblock. */
export const SHORE_CHECKPOINTS = [
  { x: 0, z: -1230, yaw: 0 },
  { x: -18, z: -1330, yaw: 0 },
  { x: -6, z: -1470, yaw: 0 },
];
/** Cooper's Base is this close: he's home. */
export const HOME_REACH = 32;

/** The tan guards out on the far shore: pale cones, long beats, a couple standing watch. */
export const SHORE_GUARDS: GuardPost[] = [
  // The beach: two pacing the waterline either side of the landing, one watching the sea from the dunes.
  { zone: 'shore', x: -100, z: -1233, yaw: -Math.PI / 2, sight: 19, patrol: [{ x: -100, z: -1233 }, { x: -28, z: -1233 }] },
  { zone: 'shore', x: 100, z: -1250, yaw: Math.PI / 2, sight: 19, patrol: [{ x: 100, z: -1250 }, { x: 28, z: -1250 }] },
  { zone: 'shore', x: 0, z: -1284, yaw: Math.PI, sight: 21 },
  // The fields: one beating up and down the first lane, a loop round the wood to the east, one on the road, one at the barn, one in the second lane.
  { zone: 'shore', x: -112, z: -1345, yaw: -Math.PI / 2, patrol: [{ x: -112, z: -1345 }, { x: -52, z: -1345 }] },
  { zone: 'shore', x: 52, z: -1343, yaw: Math.PI / 2, patrol: [{ x: 52, z: -1343 }, { x: 98, z: -1343 }, { x: 98, z: -1402 }, { x: 52, z: -1402 }] },
  { zone: 'shore', x: -34, z: -1372, yaw: Math.PI / 2, patrol: [{ x: -34, z: -1372 }, { x: 14, z: -1372 }] },
  { zone: 'shore', x: -64, z: -1412, yaw: -Math.PI / 2, sight: 23 },
  { zone: 'shore', x: -10, z: -1438, yaw: -Math.PI / 2, patrol: [{ x: -10, z: -1438 }, { x: 70, z: -1438 }] },
  // The roadblock across the road, and the perimeter round the base.
  { zone: 'shore', x: -7.5, z: -1512, yaw: Math.PI, sight: 21 },
  { zone: 'shore', x: 8, z: -1514, yaw: Math.PI, sight: 21 },
  { zone: 'shore', x: -55, z: -1566, yaw: Math.PI / 2, sight: 22, patrol: [{ x: -55, z: -1566 }, { x: 55, z: -1566 }] },
  { zone: 'shore', x: -100, z: -1535, yaw: Math.PI, patrol: [{ x: -100, z: -1535 }, { x: -100, z: -1600 }] },
];

const ROAD_WIDTH = 8;
const TARMAC = 0x3e3f42;
const VERGE = 0x6b5a3e;
/** Cooper's Base is mission 1's: its sandbag wall stands this far out, with the gate facing the road (south, +Z). */
const BASE_WALL = CAMP_RADIUS + 5;
/** Mission 1's trees (Kenney city kit), and the sizes they're planted at there. */
const TREE_MODELS = ['tree-large', 'tree-small'];
const TREE_SCALE_MIN = 11;
const TREE_SCALE_MAX = 16;

/** Loads mission 1's tree models for the country outside. */
export async function loadTreeModels(): Promise<THREE.Object3D[]> {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(versionAssetURL);
  const loader = new GLTFLoader(manager);
  return Promise.all(TREE_MODELS.map((name) => loader.loadAsync(`${import.meta.env.BASE_URL}models/buildings/${name}.glb`).then((gltf) => gltf.scene)));
}

/**
 * The country on the far shore of the bonus level: the sandy beach the raft lands on, fields
 * split by hedges, woods, a farm with a barn, a roadblock, and the road on up to Cooper's Base.
 * The woods are mission 1's trees and the base is mission 1's camp, sandbag wall, watchtowers,
 * Chinook and all, with the home team waiting inside the gate. Hedges, hay bales and the barn
 * are solid, so they hide you from the guards' vision cones.
 */
export class Outside {
  readonly group = new THREE.Group();
  readonly base: HomeBase;
  /** The home team at Cooper's Base: they cheer when you walk in. */
  private readonly welcome: THREE.Mesh[] = [];
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly hits = new HitRegistry();
  private readonly trees: TreeManager;
  private readonly body: RAPIER.RigidBody;
  private readonly world: RAPIER.World;

  constructor(world: RAPIER.World, treeModels: THREE.Object3D[]) {
    this.world = world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const { road, home, ground } = SHORE;
    this.buildGround();
    const b = new PartBuilder();
    this.buildRoad(b, road);
    this.buildScenery(b, road, home);
    this.buildFarm(b);
    this.buildRoadblock(b);
    this.buildBeach(b);
    b.buildInto(this.group);
    this.box.dispose();
    this.trees = new TreeManager(this.plantTrees(world, treeModels, road, home, ground));
    // The gate faces the road coming up from the beach (+Z: x = cos, z = sin).
    this.base = new HomeBase(world, this.group, { ...FRIENDLY_BASES[0], x: home.x, z: home.z }, Math.PI / 2);
    this.buildWelcome(home);
  }

  /** The tree a shell hit, if it was one. */
  treeAt(collider: RAPIER.Collider | null): Tree | null {
    const hit = collider ? this.hits.lookup(collider) : undefined;
    return hit?.kind === 'tree' ? hit.tree : null;
  }

  /** Trees knocked over keep falling; the base's flag flies and its searchlights sweep. */
  update(dt: number): void {
    this.trees.update(dt, []);
    this.base.update(dt, false);
  }

  /** The base's soldiers throw their arms up. */
  cheer(): void {
    for (const m of this.welcome) {
      const c = createCheeringFigure(ARMY_GREEN);
      c.position.copy(m.position);
      c.rotation.copy(m.rotation);
      this.group.add(c);
      this.group.remove(m);
    }
    this.welcome.length = 0;
  }

  /** A solid box (drawn with `b`, and something to bump into and to hide behind). */
  private solid(b: PartBuilder, color: number, x: number, z: number, sx: number, sy: number, sz: number, yaw = 0, collide = true): void {
    b.add(this.box, plastic(color), x, sy / 2, z, 0, yaw, 0, sx, sy, sz);
    if (!collide) return;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(x, sy / 2, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
      this.body,
    );
  }

  /** Sand down to the water, grass beyond it, and an invisible wall round the edge of the world. */
  private buildGround(): void {
    const g = SHORE.ground;
    const gw = g.maxX - g.minX;
    const beachEnd = SHORE.waterZ - 44;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(gw, beachEnd - g.minZ).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55703a, roughness: 1 }));
    grass.position.set(0, -0.03, (beachEnd + g.minZ) / 2);
    const sandMaterial = new THREE.MeshStandardMaterial({ color: 0xc2b080, roughness: 1 });
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(gw, g.maxZ - beachEnd).rotateX(-Math.PI / 2), sandMaterial);
    sand.position.set(0, -0.03, (beachEnd + g.maxZ) / 2);
    const shelf = new THREE.Mesh(new THREE.PlaneGeometry(gw, 16).rotateX(-Math.PI / 2 + 0.07), sandMaterial);
    shelf.position.set(0, -0.55, g.maxZ + 7.5);
    grass.receiveShadow = sand.receiveShadow = true;
    this.group.add(grass, sand, shelf);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(gw / 2, 0.5, (g.maxZ - g.minZ) / 2).setTranslation(0, -0.5, (g.minZ + g.maxZ) / 2), this.body);
    for (const [x0, z0, x1, z1] of [
      [g.minX - 1, g.minZ - 1, g.maxX + 1, g.minZ],
      [g.minX - 1, g.maxZ, g.maxX + 1, g.maxZ + 1],
      [g.minX - 1, g.minZ, g.minX, g.maxZ],
      [g.maxX, g.minZ, g.maxX + 1, g.maxZ],
    ]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, 5, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, 5, (z0 + z1) / 2), this.body);
    }
  }

  /** How far a point is from the road (for keeping scenery off it). */
  private static distToRoad(road: { x: number; z: number }[], x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const c = road[i + 1];
      const dx = c.x - a.x;
      const dz = c.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
    }
    return best;
  }

  /** Tarmac strips between the road's points (up to the base's gate), with a dirt verge and white dashes down the middle. */
  private buildRoad(b: PartBuilder, path: { x: number; z: number }[]): void {
    const tarmac = plastic(TARMAC);
    const verge = plastic(VERGE);
    const paint = new THREE.MeshBasicMaterial({ color: 0xe8e4d0 });
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const c = path[i + 1];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const yaw = Math.atan2(c.x - a.x, c.z - a.z);
      const mx = (a.x + c.x) / 2;
      const mz = (a.z + c.z) / 2;
      // A bit longer than the segment so the joins at the bends are covered.
      b.add(this.box, verge, mx, 0.01, mz, 0, yaw, 0, ROAD_WIDTH + 3, 0.02, len + 3);
      b.add(this.box, tarmac, mx, 0.03, mz, 0, yaw, 0, ROAD_WIDTH, 0.02, len + 2);
      for (let t = 2; t < len - 1; t += 6) {
        const f = t / len;
        b.add(this.box, paint, a.x + (c.x - a.x) * f, 0.05, a.z + (c.z - a.z) * f, 0, yaw, 0, 0.25, 0.01, 2.5);
      }
    }
  }

  /** Hedges across the fields (with gaps for the road and a few others), hay bales, and fences along the road. */
  private buildScenery(b: PartBuilder, road: { x: number; z: number }[], home: { x: number; z: number }): void {
    const rng = mulberry32(5050);
    const hay = plastic(0xd8b45a);
    const hedge = 0x35602a;
    // Hedgerows: long lines across the way, each with gaps (the first lets the road through).
    const hedgeLine = (z: number, gaps: [number, number][]) => {
      let x = SHORE.ground.minX + 2;
      for (const [g0, g1] of [...gaps, [SHORE.ground.maxX - 2, SHORE.ground.maxX - 2] as [number, number]]) {
        if (g0 - x > 1) this.solid(b, hedge, (x + g0) / 2, z, g0 - x, 1.9, 1.1, 0);
        x = g1;
      }
    };
    hedgeLine(-1303, [[-40, -6], [62, 80]]);
    hedgeLine(-1395, [[-52, -14], [34, 50]]);
    hedgeLine(-1490, [[-24, 22]]);
    // A few short hedges running the other way, to make lanes and pockets to hide in.
    for (const [x, z0, z1] of [[-60, -1303, -1395], [26, -1303, -1395], [-85, -1395, -1490], [60, -1395, -1490], [100, -1303, -1395]]) {
      this.solid(b, hedge, x, (z0 + z1) / 2, 1.1, 1.9, Math.abs(z1 - z0) * 0.62, 0);
    }
    const clear = (x: number, z: number, room: number) => Outside.distToRoad(road, x, z) > room && Math.hypot(x - home.x, z - home.z) > BASE_WALL + 12;
    for (let i = 0; i < 34; i++) {
      const x = SHORE.ground.minX + 10 + rng() * (SHORE.ground.maxX - SHORE.ground.minX - 20);
      const z = SHORE.waterZ - 70 - rng() * 360;
      if (!clear(x, z, ROAD_WIDTH / 2 + 4)) continue;
      // A round bale on its side, and something solid inside it to hide behind.
      b.add(new THREE.CylinderGeometry(0.9, 0.9, 1.3, 12).rotateZ(Math.PI / 2), hay, x, 0.9, z, 0, rng() * Math.PI, 0);
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.9, 0.9).setTranslation(x, 0.9, z), this.body);
    }
    // Post and rail fences along both sides of the road.
    const wood = plastic(0x8a6a3e);
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const c = road[i + 1];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const nx = -(c.z - a.z) / len;
      const nz = (c.x - a.x) / len;
      for (let t = 4; t < len - 2; t += 3) {
        for (const side of [-1, 1]) {
          if ((Math.floor(t / 30) + (side > 0 ? 1 : 0)) % 3 === 0) continue; // gaps here and there
          const off = ROAD_WIDTH / 2 + 2.2;
          const x = a.x + ((c.x - a.x) * t) / len + nx * side * off;
          const z = a.z + ((c.z - a.z) * t) / len + nz * side * off;
          if (Math.hypot(x - home.x, z - home.z) < BASE_WALL + 8) continue; // stops short of the base's gate towers
          b.add(this.box, wood, x, 0.55, z, 0, 0, 0, 0.14, 1.1, 0.14);
          b.add(this.box, wood, x, 0.8, z, 0, Math.atan2(c.x - a.x, c.z - a.z), 0, 0.08, 0.1, 3.05);
        }
      }
    }
    // A signpost by the road's start, pointing the way home.
    b.add(this.box, wood, ROAD_WIDTH / 2 + 2, 1.3, -1262, 0, 0, 0, 0.16, 2.6, 0.16);
    b.add(this.box, plastic(0xe8dcb4), ROAD_WIDTH / 2 + 2.9, 2.3, -1262, 0, 0.3, 0, 2, 0.45, 0.08);
  }

  /** A barn and a shed with a stack of hay, off the road to the west: somewhere for a guard to stand and plenty to hide behind. */
  private buildFarm(b: PartBuilder): void {
    const wall = 0x9a3a2a;
    const barn = { x: -84, z: -1428 };
    this.solid(b, wall, barn.x, barn.z, 16, 6.5, 10, 0);
    // A pitched roof of two sloping slabs, and white trim and a hayloft door on the front.
    for (const side of [-1, 1]) {
      b.add(this.box, plastic(0x4a4e52), barn.x + side * 4.2, 7.6, barn.z, 0, 0, -side * 0.42, 9.2, 0.35, 10.8);
    }
    b.add(this.box, plastic(0xefe8d8), barn.x, 3, barn.z + 5.02, 0, 0, 0, 4.4, 5, 0.06);
    b.add(this.box, plastic(0x3a2418), barn.x, 3, barn.z + 5.06, 0, 0, 0, 0.2, 5, 0.04);
    b.add(this.box, plastic(0xefe8d8), barn.x, 5.6, barn.z + 5.02, 0, 0, 0, 1.4, 1.2, 0.06);
    this.solid(b, 0x8a6a3e, -62, -1436, 7, 3.6, 5, 0);
    // Square hay bales stacked by the barn.
    for (let i = 0; i < 6; i++) {
      this.solid(b, 0xd8b45a, -74 + (i % 3) * 1.7, -1415 - Math.floor(i / 3) * 1.4, 1.5, 1.2 + (i % 2) * 1.1, 1.2, 0.1 * i);
    }
    // A broken-down tractor-ish wagon in the yard between.
    this.solid(b, 0x6a7a3a, -70, -1396, 3.2, 1.3, 1.8, 0.4);
  }

  /** The roadblock: sandbags either side of the road, a striped barrier pole and a tan jeep, under a floodlight. */
  private buildRoadblock(b: PartBuilder): void {
    const z = -1518;
    const bag = plastic(0xb8a070);
    const geo = sandbagGeometry();
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 5; i++) b.add(geo, bag, side * (ROAD_WIDTH / 2 + 2.2 + i * 0.7) + (row % 2) * 0.3, 0.3 + row * 0.5, z + side * 0.2, 0, 0.1 * side, 0);
      }
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(2.0, 0.75, 0.5).setTranslation(side * (ROAD_WIDTH / 2 + 4.2), 0.75, z + side * 0.2), this.body);
    }
    // The barrier: a red-and-white pole across the road, on a post.
    this.solid(b, 0x3a3e42, -ROAD_WIDTH / 2 - 0.6, z, 0.5, 1.1, 0.5, 0);
    for (let i = 0; i < 8; i++) b.add(this.box, plastic(i % 2 ? 0xf2f2f2 : 0xd0302a), -ROAD_WIDTH / 2 + 0.5 + i * (ROAD_WIDTH / 8), 1.05, z, 0, 0, 0, ROAD_WIDTH / 8, 0.14, 0.14);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(ROAD_WIDTH / 2, 0.1, 0.1).setTranslation(0.5, 1.05, z), this.body);
    // A jeep parked beside it, and the floodlight on a pole.
    const jeep = buildJeepParts(ARMY_TAN, { driver: false, mountedGun: true });
    jeep.group.position.set(ROAD_WIDTH / 2 + 9, 0, z + 3);
    jeep.group.rotation.y = 0.5;
    this.group.add(jeep.group);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 0.9, 2.2).setTranslation(ROAD_WIDTH / 2 + 9, 0.9, z + 3).setRotation({ x: 0, y: Math.sin(0.25), z: 0, w: Math.cos(0.25) }), this.body);
    this.solid(b, 0x3e4246, -ROAD_WIDTH / 2 - 3.2, z - 1.5, 0.2, 5.5, 0.2, 0);
    b.add(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }), -ROAD_WIDTH / 2 - 3.2, 5.6, z - 1.5);
  }

  /** The beach: driftwood logs to hide behind, a few rocks and a beached rowing boat. */
  private buildBeach(b: PartBuilder): void {
    const rng = mulberry32(333);
    const wood = plastic(0x8a7860);
    for (let i = 0; i < 9; i++) {
      const x = -120 + rng() * 240;
      const z = SHORE.waterZ - 14 - rng() * 28;
      if (Math.abs(x) < 7) continue;
      const yaw = rng() * Math.PI;
      b.add(new THREE.CylinderGeometry(0.28, 0.32, 3.4, 8).rotateZ(Math.PI / 2), wood, x, 0.3, z, 0, yaw, 0);
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(1.7, 0.3, 0.3).setTranslation(x, 0.3, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }), this.body);
    }
    const rock = plastic(0x6a6a66);
    for (let i = 0; i < 7; i++) {
      const x = -130 + rng() * 260;
      const z = SHORE.waterZ - 22 - rng() * 22;
      if (Math.abs(x) < 10) continue;
      const r = 0.9 + rng() * 1.2;
      b.add(new THREE.DodecahedronGeometry(r, 0), rock, x, r * 0.5, z, rng(), rng() * 3, rng());
      this.world.createCollider(RAPIER.ColliderDesc.ball(r * 0.8).setTranslation(x, r * 0.5, z), this.body);
    }
  }

  /**
   * Mission 1's woods: trees dotted over the fields and packed into a few round woods, kept off the
   * road, out of the base and well away from the beach. One instanced batch per model.
   */
  private plantTrees(
    world: RAPIER.World,
    models: THREE.Object3D[],
    road: { x: number; z: number }[],
    home: { x: number; z: number },
    ground: { minX: number; maxX: number; minZ: number; maxZ: number },
  ): Tree[] {
    const rng = mulberry32(5151);
    const placements: { model: number; x: number; y: number; z: number; yaw: number; scale: number }[] = [];
    const minZ = ground.minZ + 8;
    const maxZ = SHORE.waterZ - 75; // well back from the beach
    const clear = (x: number, z: number) =>
      x > ground.minX + 6 && x < ground.maxX - 6 && z > minZ && z < maxZ &&
      Outside.distToRoad(road, x, z) > ROAD_WIDTH / 2 + 7 &&
      Math.hypot(x - home.x, z - home.z) > BASE_WALL + 14 &&
      // Not in the barn's yard, nor the roadblock.
      Math.hypot(x + 74, z + 1424) > 22 &&
      !(Math.abs(z + 1518) < 14 && Math.abs(x) < 30) &&
      placements.every((p) => Math.hypot(p.x - x, p.z - z) > 5.5);
    const plant = (x: number, z: number, scale: number) => {
      if (!clear(x, z)) return;
      placements.push({ model: Math.floor(rng() * models.length), x, y: 0, z, yaw: rng() * Math.PI * 2, scale });
    };
    // Woods: packed in the middle, thinning to a ragged edge.
    for (let w = 0; w < 7; w++) {
      const cx = ground.minX + 25 + rng() * (ground.maxX - ground.minX - 50);
      const cz = minZ + 20 + rng() * (maxZ - minZ - 40);
      const radius = 16 + rng() * 18;
      const count = Math.floor((Math.PI * radius * radius) / 90);
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * radius;
        if (r > radius * (0.82 + 0.18 * Math.sin(a * 5 + cx))) continue;
        plant(cx + Math.cos(a) * r, cz + Math.sin(a) * r, (TREE_SCALE_MIN + rng() * (TREE_SCALE_MAX - TREE_SCALE_MIN)) * (1.1 - (0.3 * r) / radius));
      }
    }
    // And single trees scattered over the fields.
    for (let i = 0; i < 70; i++) {
      plant(ground.minX + rng() * (ground.maxX - ground.minX), minZ + rng() * (maxZ - minZ), TREE_SCALE_MIN + rng() * (TREE_SCALE_MAX - TREE_SCALE_MIN));
    }
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    return models.flatMap((model, index) =>
      toppleInstances(world, this.group, this.hits, body, model, placements.filter((p) => p.model === index), TREE_SIZE),
    );
  }

  /** The home team, lined up either side of the way in from the gate. */
  private buildWelcome(home: { x: number; z: number }): void {
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const m = createFigureMesh(0, ARMY_GREEN);
      m.position.set(home.x + side * (11.5 + (row % 2) * 1.2), 0.04, home.z + 42 + row * 2.6);
      m.rotation.y = side * -Math.PI / 2; // facing the lane
      this.group.add(m);
      this.welcome.push(m);
    }
  }
}
