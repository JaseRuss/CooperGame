import * as THREE from 'three';
import { WORLD_HALF } from '../core/config';
import { isOnRoad } from './RoadNetwork';
import { heightAt } from './Terrain';

const CELL = 12;
const MARGIN = 40;
const OFF_ROAD_COST = 2.6;
const SLOPE_COST = 0.35;
/** How far round a building's edge the rig keeps, metres. */
const BUILDING_CLEARANCE = 9;
const SPACING = 3;

export interface RouteObstacles {
  /** Ground the rig can't cross: lakes, the moat, bases, the airfield. */
  blocked: (x: number, z: number) => boolean;
  /** Footprints of the houses and sheds it has to steer round. */
  buildings: { x: number; z: number; hx: number; hz: number }[];
}

/** A little binary heap keyed on cost, for the search. */
class Heap {
  private readonly items: { key: number; cell: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(cell: number, key: number): void {
    const a = this.items;
    a.push({ cell, key });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].key <= a[i].key) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  pop(): number {
    const a = this.items;
    const top = a[0].cell;
    const last = a.pop() as { key: number; cell: number };
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Finds a way across the map for the bomb tanker: the cheapest route over a coarse grid that
 * sticks to roads where it can and keeps clear of houses, lakes, bases and the moat. Returns an
 * evenly spaced, smoothed line of points (x, z) from `start` to `goal`.
 */
export function planTankerRoute(start: THREE.Vector2, goal: THREE.Vector2, obstacles: RouteObstacles): THREE.Vector2[] {
  const min = -WORLD_HALF + MARGIN;
  const n = Math.floor((WORLD_HALF * 2 - MARGIN * 2) / CELL);
  const cellX = (i: number) => min + (i % n) * CELL + CELL / 2;
  const cellZ = (i: number) => min + Math.floor(i / n) * CELL + CELL / 2;
  const indexOf = (x: number, z: number) => {
    const cx = Math.max(0, Math.min(n - 1, Math.floor((x - min) / CELL)));
    const cz = Math.max(0, Math.min(n - 1, Math.floor((z - min) / CELL)));
    return cz * n + cx;
  };

  const blocked = new Uint8Array(n * n);
  const road = new Uint8Array(n * n);
  const height = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const x = cellX(i);
    const z = cellZ(i);
    height[i] = heightAt(x, z);
    if (obstacles.blocked(x, z)) blocked[i] = 1;
    else if (isOnRoad(x, z)) road[i] = 1;
  }
  for (const b of obstacles.buildings) {
    const x0 = Math.floor((b.x - b.hx - BUILDING_CLEARANCE - min) / CELL);
    const x1 = Math.floor((b.x + b.hx + BUILDING_CLEARANCE - min) / CELL);
    const z0 = Math.floor((b.z - b.hz - BUILDING_CLEARANCE - min) / CELL);
    const z1 = Math.floor((b.z + b.hz + BUILDING_CLEARANCE - min) / CELL);
    for (let cz = Math.max(0, z0); cz <= Math.min(n - 1, z1); cz++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(n - 1, x1); cx++) blocked[cz * n + cx] = 1;
    }
  }

  /** The nearest open cell to a point (the start or goal may sit just inside a margin). */
  const open = (x: number, z: number): number => {
    const home = indexOf(x, z);
    if (!blocked[home]) return home;
    for (let r = 1; r < 12; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = (home % n) + dx;
          const cz = Math.floor(home / n) + dz;
          if (cx < 0 || cz < 0 || cx >= n || cz >= n || blocked[cz * n + cx]) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = cz * n + cx;
          }
        }
      }
      if (best >= 0) return best;
    }
    return home;
  };

  const from = open(start.x, start.y);
  const to = open(goal.x, goal.y);
  const cost = new Float32Array(n * n).fill(Infinity);
  const came = new Int32Array(n * n).fill(-1);
  const heap = new Heap();
  cost[from] = 0;
  heap.push(from, 0);
  const goalX = to % n;
  const goalZ = Math.floor(to / n);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === to) break;
    const cx = cur % n;
    const cz = Math.floor(cur / n);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const next = nz * n + nx;
        if (blocked[next]) continue;
        // No squeezing diagonally between two blocked corners.
        if (dx !== 0 && dz !== 0 && (blocked[cz * n + nx] || blocked[nz * n + cx])) continue;
        const step = dx !== 0 && dz !== 0 ? 1.414 : 1;
        const ground = road[next] ? 1 : OFF_ROAD_COST;
        const slope = Math.abs(height[next] - height[cur]) * SLOPE_COST;
        const total = cost[cur] + step * ground + slope;
        if (total >= cost[next]) continue;
        cost[next] = total;
        came[next] = cur;
        const h = Math.hypot(nx - goalX, nz - goalZ);
        heap.push(next, total + h);
      }
    }
  }

  let cells: THREE.Vector2[] = [];
  for (let c = to; c !== -1; c = came[c]) {
    cells.push(new THREE.Vector2(cellX(c), cellZ(c)));
    if (c === from) break;
  }
  cells.reverse();
  cells = [start.clone(), ...cells, goal.clone()];

  // Round off the corners of the grid walk.
  for (let pass = 0; pass < 3; pass++) {
    const smooth: THREE.Vector2[] = [cells[0]];
    for (let i = 0; i + 1 < cells.length; i++) {
      smooth.push(cells[i].clone().lerp(cells[i + 1], 0.25), cells[i].clone().lerp(cells[i + 1], 0.75));
    }
    smooth.push(cells[cells.length - 1]);
    cells = smooth;
  }

  // Evenly spaced points along the line.
  const out: THREE.Vector2[] = [cells[0].clone()];
  let carry = 0;
  for (let i = 0; i + 1 < cells.length; i++) {
    const a = cells[i];
    const b = cells[i + 1];
    const len = a.distanceTo(b);
    let t = SPACING - carry;
    while (t <= len) {
      out.push(a.clone().lerp(b, t / len));
      t += SPACING;
    }
    carry = len - (t - SPACING);
  }
  out.push(cells[cells.length - 1].clone());
  return out;
}
