import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { AssetLibrary } from '../world/AssetLibrary';
import { HitRegistry } from '../combat/HitRegistry';
import { toppleInstances } from '../world/toppleInstances';
import { TreeManager } from '../world/TreeManager';
import type { Tree, ToppleSize } from '../world/Tree';
import { instanceTemplate, placement } from '../utils/instancing';
import { mulberry32 } from '../utils/rng';

/** A trunk: thin, so you can squeeze between them, and it goes over about a second after a jam hit. */
const TRUNK: ToppleSize = { colliderRadius: 0.5, colliderHalfHeight: 2.4, triggerRadius: 1, fallDuration: 1.15 };
/** Spacing of the planting grid, the share of grid cells that get a tree, and how far each is jostled. */
const CELL = 5.6;
const DENSITY = 0.86;
const JITTER = 0.42;
/** How tall the trees stand, in metres. */
const TREE_HEIGHT: [number, number] = [7.5, 12.5];
const BUSH_COUNT = 1100;

export type Clearing = { x: number; z: number; r: number } | { x0: number; x1: number; z0: number; z1: number };

const inside = (c: Clearing, x: number, z: number, margin: number): boolean =>
  'r' in c ? Math.hypot(x - c.x, z - c.z) < c.r + margin : x > c.x0 - margin && x < c.x1 + margin && z > c.z0 - margin && z < c.z1 + margin;

/**
 * The jungle: thousands of trees close together (every one a trunk you can bump into, and every
 * one a thing a jam glob can knock flat), plus undergrowth you can walk through. Clearings are
 * left for the camp, the airbase, the outposts and the lookout towers.
 */
export class Forest {
  readonly hits = new HitRegistry();
  readonly trees: Tree[] = [];
  private readonly manager: TreeManager;
  private readonly grid = new Map<number, Tree[]>();
  fallen = 0;

  constructor(world: RAPIER.World, scene: THREE.Scene, assets: AssetLibrary, half: number, clearings: Clearing[], seed: number) {
    const rng = mulberry32(seed);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const names = assets.names('jungleTree');
    // One scale per model, so every kind comes out about the same height.
    const baseHeight = new Map<string, number>();
    for (const name of names) baseHeight.set(name, new THREE.Box3().setFromObject(assets.template('jungleTree', name)).getSize(new THREE.Vector3()).y || 1);
    const byModel = new Map<string, { x: number; y: number; z: number; yaw: number; scale: number }[]>();
    for (let gx = -half + CELL; gx < half - CELL; gx += CELL) {
      for (let gz = -half + CELL; gz < half - CELL; gz += CELL) {
        if (rng() > DENSITY) continue;
        const x = gx + (rng() - 0.5) * CELL * 2 * JITTER;
        const z = gz + (rng() - 0.5) * CELL * 2 * JITTER;
        if (clearings.some((c) => inside(c, x, z, 1.2))) continue;
        const name = names[Math.floor(rng() * names.length)];
        const height = TREE_HEIGHT[0] + rng() * (TREE_HEIGHT[1] - TREE_HEIGHT[0]);
        let list = byModel.get(name);
        if (!list) byModel.set(name, (list = []));
        list.push({ x, y: 0, z, yaw: rng() * Math.PI * 2, scale: height / (baseHeight.get(name) as number) });
      }
    }
    for (const [name, placements] of byModel) {
      // No shadows from the trees (there are thousands): the fog and the rain do the moodiness.
      this.trees.push(...toppleInstances(world, scene, this.hits, body, assets.template('jungleTree', name), placements, TRUNK, false));
    }
    this.manager = new TreeManager(this.trees);
    for (const t of this.trees) {
      const k = this.key(t.position.x, t.position.z);
      let cell = this.grid.get(k);
      if (!cell) this.grid.set(k, (cell = []));
      cell.push(t);
      const was = t.onFall;
      t.onFall = () => {
        was?.();
        this.fallen++;
      };
    }

    // Undergrowth: bushes and ferns with no collision, scattered thickly.
    const bushNames = assets.names('undergrowth');
    const per = new Map<string, THREE.Matrix4[]>();
    for (let i = 0; i < BUSH_COUNT; i++) {
      const x = (rng() * 2 - 1) * (half - 4);
      const z = (rng() * 2 - 1) * (half - 4);
      if (clearings.some((c) => inside(c, x, z, 0))) continue;
      const name = bushNames[Math.floor(rng() * bushNames.length)];
      let list = per.get(name);
      if (!list) per.set(name, (list = []));
      list.push(placement(x, 0, z, rng() * Math.PI * 2, 2.6 + rng() * 1.8));
    }
    for (const [name, list] of per) {
      const g = instanceTemplate(assets.template('undergrowth', name), list);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = false;
          o.receiveShadow = false;
        }
      });
      scene.add(g);
    }
  }

  private key(x: number, z: number): number {
    return Math.floor(x / 12) * 4096 + Math.floor(z / 12);
  }

  /** Trees within `r` of (x, z) that are still standing. */
  near(x: number, z: number, r: number): Tree[] {
    const out: Tree[] = [];
    for (let cx = Math.floor((x - r) / 12); cx <= Math.floor((x + r) / 12); cx++) {
      for (let cz = Math.floor((z - r) / 12); cz <= Math.floor((z + r) / 12); cz++) {
        const cell = this.grid.get(cx * 4096 + cz);
        if (!cell) continue;
        for (const t of cell) if (!t.fallen && Math.hypot(t.position.x - x, t.position.z - z) <= r) out.push(t);
      }
    }
    return out;
  }

  /** Knocks flat every standing tree within `radius` of `point`, falling away along `dir`. Returns how many. */
  fell(point: THREE.Vector3, dir: THREE.Vector3, radius: number): number {
    let n = 0;
    for (const t of this.near(point.x, point.z, radius)) {
      // Each falls away from the middle of the blast (or the way the jam was flying, for a hit right on it).
      const away = new THREE.Vector3(t.position.x - point.x, 0, t.position.z - point.z);
      if (away.lengthSq() < 0.25) away.set(dir.x, 0, dir.z);
      t.knockDown(away.normalize());
      n++;
    }
    return n;
  }

  update(dt: number): void {
    this.manager.update(dt, []);
  }
}
