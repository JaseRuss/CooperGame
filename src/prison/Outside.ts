import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PartBuilder } from '../utils/modelKit';
import { plastic, ARMY_GREEN } from '../utils/plastic';
import { createFigureMesh, createCheeringFigure } from '../entities/Soldier';
import { mulberry32 } from '../utils/rng';
import { FRIENDLY_BASES, BASE_RADIUS as CAMP_RADIUS } from '../core/config';
import { HomeBase } from '../world/Base';
import { versionAssetURL } from '../world/AssetLibrary';
import { toppleInstances } from '../world/WorldGenerator';
import { TreeManager } from '../world/TreeManager';
import { TREE_SIZE, type Tree } from '../world/Tree';
import { HitRegistry } from '../combat/HitRegistry';

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
 * The country north of the prison on the bonus level: the road home through fields, woods and
 * fences, and Cooper's Base at the end of it. The woods are mission 1's trees (they go over when
 * the tank drives into them or shells them) and the base is mission 1's camp, sandbag wall,
 * watchtowers, Chinook and all, with the home team waiting inside the gate.
 */
export class Outside {
  readonly group = new THREE.Group();
  readonly base: HomeBase;
  /** The home team at Cooper's Base: they cheer when the convoy rolls in. */
  private readonly welcome: THREE.Mesh[] = [];
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly hits = new HitRegistry();
  private readonly trees: TreeManager;

  constructor(
    world: RAPIER.World,
    treeModels: THREE.Object3D[],
    road: { x: number; z: number }[],
    home: { x: number; z: number },
    ground: { minX: number; maxX: number; minZ: number },
  ) {
    const b = new PartBuilder();
    this.buildRoad(b, road);
    this.buildScenery(b, road, home, ground);
    b.buildInto(this.group);
    this.box.dispose();
    this.trees = new TreeManager(this.plantTrees(world, treeModels, road, home, ground));
    // The gate faces the road coming up from the prison (+Z: x = cos, z = sin).
    this.base = new HomeBase(world, this.group, { ...FRIENDLY_BASES[0], x: home.x, z: home.z }, Math.PI / 2);
    this.buildWelcome(home);
  }

  /** The tree a shell hit, if it was one. */
  treeAt(collider: RAPIER.Collider | null): Tree | null {
    const hit = collider ? this.hits.lookup(collider) : undefined;
    return hit?.kind === 'tree' ? hit.tree : null;
  }

  /** Trees go over as the tank reaches them; the base's flag flies and its searchlights sweep. */
  update(dt: number, tank: THREE.Vector3 | null): void {
    this.trees.update(dt, tank ? [tank] : []);
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

  /** Haystacks, fences along the road and a signpost, kept off the road. */
  private buildScenery(b: PartBuilder, road: { x: number; z: number }[], home: { x: number; z: number }, ground: { minX: number; maxX: number; minZ: number }): void {
    const rng = mulberry32(5050);
    const hay = plastic(0xd8b45a);
    const clear = (x: number, z: number, room: number) => Outside.distToRoad(road, x, z) > room && Math.hypot(x - home.x, z - home.z) > BASE_WALL + 12;
    for (let i = 0; i < 30; i++) {
      const x = ground.minX + 10 + rng() * (ground.maxX - ground.minX - 20);
      const z = -60 - rng() * 380;
      if (!clear(x, z, ROAD_WIDTH / 2 + 4)) continue;
      b.add(new THREE.CylinderGeometry(0.9, 0.9, 1.3, 12).rotateZ(Math.PI / 2), hay, x, 0.9, z, 0, rng() * Math.PI, 0);
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
    // A signpost by the gate, pointing the way home.
    b.add(this.box, wood, ROAD_WIDTH / 2 + 2, 1.3, -34, 0, 0, 0, 0.16, 2.6, 0.16);
    b.add(this.box, plastic(0xe8dcb4), ROAD_WIDTH / 2 + 2.9, 2.3, -34, 0, 0.3, 0, 2, 0.45, 0.08);
  }

  /**
   * Mission 1's woods: trees dotted over the fields and packed into a few round woods, kept off the
   * road, out of the base and away from the prison wall. One instanced batch per model.
   */
  private plantTrees(
    world: RAPIER.World,
    models: THREE.Object3D[],
    road: { x: number; z: number }[],
    home: { x: number; z: number },
    ground: { minX: number; maxX: number; minZ: number },
  ): Tree[] {
    const rng = mulberry32(5151);
    const placements: { model: number; x: number; y: number; z: number; yaw: number; scale: number }[] = [];
    const minZ = ground.minZ + 8;
    const maxZ = -45; // clear of the prison's front wall
    const clear = (x: number, z: number) =>
      x > ground.minX + 6 && x < ground.maxX - 6 && z > minZ && z < maxZ &&
      Outside.distToRoad(road, x, z) > ROAD_WIDTH / 2 + 7 &&
      Math.hypot(x - home.x, z - home.z) > BASE_WALL + 14 &&
      placements.every((p) => Math.hypot(p.x - x, p.z - z) > 5.5);
    const plant = (x: number, z: number, scale: number) => {
      if (!clear(x, z)) return;
      placements.push({ model: Math.floor(rng() * models.length), x, y: 0, z, yaw: rng() * Math.PI * 2, scale });
    };
    // Woods: packed in the middle, thinning to a ragged edge.
    for (let w = 0; w < 9; w++) {
      const cx = ground.minX + 20 + rng() * (ground.maxX - ground.minX - 40);
      const cz = minZ + 20 + rng() * (maxZ - minZ - 40);
      const radius = 18 + rng() * 22;
      const count = Math.floor((Math.PI * radius * radius) / 90);
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * radius;
        if (r > radius * (0.82 + 0.18 * Math.sin(a * 5 + cx))) continue;
        plant(cx + Math.cos(a) * r, cz + Math.sin(a) * r, (TREE_SCALE_MIN + rng() * (TREE_SCALE_MAX - TREE_SCALE_MIN)) * (1.1 - (0.3 * r) / radius));
      }
    }
    // And single trees scattered over the fields.
    for (let i = 0; i < 90; i++) {
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
