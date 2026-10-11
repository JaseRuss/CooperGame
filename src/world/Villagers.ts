import * as THREE from 'three';
import { createFigureMesh } from '../entities/Soldier';
import { heightAt } from './Terrain';
import { siteToWorld } from './Landmarks';
import type { EnemyBase } from './EnemyBase';

/** Peasants wandering the village inside each castle (siege level): scenery with legs, who never shoot and can't be shot. */
const PER_CASTLE = 6;
/** The green between the cottages, in the castle's own frame: across, and along the road in from the gate. */
const GREEN = { x: 10, z0: 12, z1: 46 };
const WALK = 1.5;
/** Villagers further than this from every player stand still. */
const ACTIVE_RANGE = 380;
const COATS = [0xb08a5a, 0x8d6e4a, 0xc9b27a, 0x9a7b55, 0xa5503a, 0x6f7f4a];

interface Villager {
  mesh: THREE.Mesh;
  yaw: number;
  goal: THREE.Vector2;
  pause: number;
  hop: number;
  base: EnemyBase;
}

export class Villagers {
  private readonly people: Villager[] = [];

  constructor(scene: THREE.Scene, bases: EnemyBase[], private readonly rng: () => number) {
    for (const base of bases) {
      for (let i = 0; i < PER_CASTLE; i++) {
        const mesh = createFigureMesh(i % 3 === 0 ? 1 : 0, COATS[i % COATS.length]);
        mesh.scale.setScalar(0.85);
        const goal = this.pick(base);
        const v: Villager = { mesh, yaw: rng() * Math.PI * 2, goal, pause: rng() * 4, hop: rng() * 6, base };
        mesh.position.set(goal.x, heightAt(goal.x, goal.y), goal.y);
        scene.add(mesh);
        this.people.push(v);
      }
    }
  }

  /** Somewhere on the green, in world coordinates. */
  private pick(base: EnemyBase): THREE.Vector2 {
    const lx = (this.rng() * 2 - 1) * GREEN.x;
    const lz = GREEN.z0 + this.rng() * (GREEN.z1 - GREEN.z0);
    const p = siteToWorld(base.site, lx, lz);
    return new THREE.Vector2(p.x, p.z);
  }

  update(dt: number, focus: THREE.Vector3[]): void {
    for (const v of this.people) {
      const m = v.mesh;
      if (!focus.some((f) => Math.hypot(f.x - m.position.x, f.z - m.position.z) < ACTIVE_RANGE)) continue;
      let hop = 0;
      if (v.pause > 0) {
        v.pause -= dt;
      } else {
        const dx = v.goal.x - m.position.x;
        const dz = v.goal.y - m.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) {
          v.pause = 1 + this.rng() * 5;
          v.goal = this.pick(v.base);
        } else {
          const step = Math.min(d, WALK * dt);
          m.position.x += (dx / d) * step;
          m.position.z += (dz / d) * step;
          v.yaw = Math.atan2(-dx, -dz);
          v.hop += dt * 8;
          hop = Math.abs(Math.sin(v.hop)) * 0.16;
        }
      }
      m.position.y = heightAt(m.position.x, m.position.z) + hop;
      m.rotation.y = v.yaw;
    }
  }
}

