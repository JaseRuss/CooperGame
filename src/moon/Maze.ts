import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';
import { mulberry32 } from '../utils/rng';
import { VALLEY, valleyQ } from './Layout';
import type { FlatZone, MoonTerrain } from './MoonTerrain';

/** The maze's squares are this far across, so its lanes are wide enough to tear down in a buggy. */
const CELL = 48;
const COLS = 18;
const ROWS = 11;
/** Walls are laid in pieces this long, each standing on the ground under it. */
const PIECE = 8;
/** Too high to jump: the buggy's best hop is about eight and a half metres. */
export const WALL_HEIGHT = 14;
const WALL_THICK = 2.4;
/** Of the walls a proper maze would have, this many are knocked through so it's never a slog. */
const KNOCKED_THROUGH = 0.14;
const ROAD_CLEAR = 11;
const PASTELS = [0xf4a6c0, 0xa8d8f0, 0xb8e6b0, 0xf6dd9a, 0xcdb4f0, 0xf7c0a0];

/** A straight stretch of wall, for the map. */
export interface WallRun {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color: number;
}

/** A lane that has to stay open however the maze falls: a run-up, a flight path, a landing. */
interface Strip {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  half: number;
}

/** The big jump's run-up and landing, and the cannon's flight to its bullseye. */
const STRIPS: Strip[] = [
  { x1: 310, z1: -1135, x2: 95, z2: -1135, half: 15 },
  { x1: -378, z1: -1150, x2: -105, z2: -1150, half: 13 },
];

function stripDist(s: Strip, x: number, z: number): number {
  const dx = s.x2 - s.x1;
  const dz = s.z2 - s.z1;
  const t = THREE.MathUtils.clamp(((x - s.x1) * dx + (z - s.z1) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - (s.x1 + dx * t), z - (s.z1 + dz * t));
}

/**
 * The Weird Side's maze: high candy-coloured castle walls that cut the valley floor into winding
 * lanes. It's a real maze (every square can be reached from every other) with a good few walls
 * knocked through, and the walls stop short of the roads and of every odd thing to find, so
 * nothing is ever shut in.
 */
export class Maze {
  readonly group = new THREE.Group();
  readonly runs: WallRun[] = [];

  constructor(terrain: MoonTerrain, keepClear: FlatZone[]) {
    const rng = mulberry32(6464);
    const x0 = VALLEY.x - (COLS * CELL) / 2;
    const z0 = VALLEY.z - (ROWS * CELL) / 2;
    const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < COLS && j < ROWS && valleyQ(x0 + (i + 0.5) * CELL, z0 + (j + 0.5) * CELL) < 0.88;
    const id = (i: number, j: number) => j * COLS + i;
    // Passages: a wandering path that visits every square once, so the whole maze joins up.
    const open = new Set<string>();
    const pass = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
    const seen = new Set<number>();
    const start: [number, number] = [COLS / 2, ROWS - 2];
    const stack: [number, number][] = [start];
    seen.add(id(...start));
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([di, dj]): [number, number] => [i + di, j + dj]).filter(([a, b]) => inside(a, b) && !seen.has(id(a, b)));
      if (next.length === 0) {
        stack.pop();
        continue;
      }
      const to = next[Math.floor(rng() * next.length)];
      seen.add(id(...to));
      open.add(pass(id(i, j), id(...to)));
      stack.push(to);
    }

    const clear = (x: number, z: number) => {
      if (valleyQ(x, z) > 0.93) return false;
      if (terrain.roadDistAt(x, z) < ROAD_CLEAR) return false;
      if (keepClear.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + 6)) return false;
      return !STRIPS.some((s) => stripDist(s, x, z) < s.half);
    };

    const p = new PartBuilder();
    const cap = plastic(0xfff6e6);
    const posts = new Map<string, { x: number; z: number; color: number }>();
    let walls = 0;
    const wall = (ax: number, az: number, bx: number, bz: number) => {
      const color = PASTELS[walls++ % PASTELS.length];
      const body = plastic(color);
      const n = Math.round(Math.hypot(bx - ax, bz - az) / PIECE);
      const at = (k: number): [number, number] => [ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n];
      const kept: boolean[] = [];
      for (let k = 0; k < n; k++) kept.push(clear(...at(k)) && clear(...at(k + 0.5)) && clear(...at(k + 1)));
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      for (let k = 0; k < n; k++) {
        if (!kept[k]) continue;
        let end = k;
        while (end + 1 < n && kept[end + 1]) end++;
        // A lone piece would just be a pillar in the way.
        if (end > k) {
          const [sx, sz] = at(k);
          const [ex, ez] = at(end + 1);
          this.runs.push({ x1: sx, z1: sz, x2: ex, z2: ez, color });
          for (const [px, pz] of [[sx, sz], [ex, ez]]) posts.set(`${Math.round(px)},${Math.round(pz)}`, { x: px, z: pz, color });
          for (let m = k; m <= end; m++) {
            const [mx, mz] = at(m + 0.5);
            const ground = terrain.heightAt(mx, mz);
            const low = Math.min(ground, terrain.heightAt(...at(m)), terrain.heightAt(...at(m + 1))) - 2;
            const top = ground + WALL_HEIGHT;
            const w = alongX ? PIECE : WALL_THICK;
            const d = alongX ? WALL_THICK : PIECE;
            p.add(new THREE.BoxGeometry(w, top - low, d), body, mx, (top + low) / 2, mz);
            p.add(new THREE.BoxGeometry(w + (alongX ? 0 : 0.7), 0.6, d + (alongX ? 0.7 : 0)), cap, mx, top + 0.3, mz);
            // Battlements along the top.
            for (const o of [-PIECE / 4, PIECE / 4]) p.add(new THREE.BoxGeometry(alongX ? 2 : WALL_THICK, 1.3, alongX ? WALL_THICK : 2), body, mx + (alongX ? o : 0), top + 1.25, mz + (alongX ? 0 : o));
          }
          const len = Math.hypot(ex - sx, ez - sz);
          for (let u = 0; u <= len; u += 1.6) {
            const x = sx + ((ex - sx) * u) / len;
            const z = sz + ((ez - sz) * u) / len;
            terrain.solids.add({ x, z, r: 1.2, h: WALL_HEIGHT });
          }
        }
        k = end;
      }
    };

    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        if (!inside(i, j)) continue;
        for (const [di, dj] of [[1, 0], [0, 1]] as const) {
          if (!inside(i + di, j + dj) || open.has(pass(id(i, j), id(i + di, j + dj)))) continue;
          if (rng() < KNOCKED_THROUGH) continue;
          const ax = x0 + (i + 1) * CELL - (dj ? CELL : 0);
          const az = z0 + (j + 1) * CELL - (di ? CELL : 0);
          wall(ax, az, x0 + (i + 1) * CELL, z0 + (j + 1) * CELL);
        }
      }
    }

    // A round tower with a pointed hat wherever a wall ends.
    for (const post of posts.values()) {
      const ground = terrain.heightAt(post.x, post.z);
      const h = WALL_HEIGHT + 2.5;
      p.add(new THREE.CylinderGeometry(2, 2.2, h + 2, 12), plastic(shade(post.color, 0.86)), post.x, ground + h / 2 - 1, post.z);
      p.add(new THREE.CylinderGeometry(2.5, 2.5, 0.7, 12), cap, post.x, ground + h + 0.35, post.z);
      p.add(new THREE.ConeGeometry(2.3, 4, 12), plastic(0xe0503f), post.x, ground + h + 2.7, post.z);
      terrain.solids.add({ x: post.x, z: post.z, r: 2, h });
    }
    p.buildInto(this.group);
  }
}
