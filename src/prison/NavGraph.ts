import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { WALLS_ONLY } from './groups';

/** Walk-straight checks run two rays this far either side of the middle, at knee height. */
const SIDE = 0.25;
const KNEE = 0.5;
/** How many of the nearest waypoints are tried as the way on to (and off) the graph. */
const ENDS = 6;
/** Waypoints further apart than this aren't linked directly (there's always one in between), which keeps building the graph quick. */
const MAX_LINK = 24;

type XZ = { x: number; z: number };

/**
 * Hand-placed waypoints round the compound (doorways, the corridor in front of each cell, inside
 * each cell, open spots in the yard), linked wherever one can walk straight to another. Used to
 * send someone somewhere specific: a medic to a casualty, a captured guard to a cell. (The squad
 * following the player walks his trail instead; see Followers.)
 *
 * Links ignore the cell doors (`ignore`), since anyone sent into a cell has it opened for them.
 */
export class NavGraph {
  private readonly nodes: THREE.Vector2[];
  private readonly links: number[][];

  constructor(private readonly world: RAPIER.World, points: XZ[], private readonly ignore: (c: RAPIER.Collider) => boolean) {
    this.nodes = points.map((p) => new THREE.Vector2(p.x, p.z));
    this.links = this.nodes.map(() => []);
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        if (a.distanceTo(b) < MAX_LINK && this.clear({ x: a.x, z: a.y }, { x: b.x, z: b.y })) {
          this.links[i].push(j);
          this.links[j].push(i);
        }
      }
    }
  }

  /** Can someone walk straight from `a` to `b` (doors aside)? */
  clear(a: XZ, b: XZ): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const dir = { x: dx / d, y: 0, z: dz / d };
    const keep = (c: RAPIER.Collider) => !this.ignore(c);
    for (const side of [-SIDE, SIDE]) {
      const origin = { x: a.x - dir.z * side, y: KNEE, z: a.z + dir.x * side };
      if (this.world.castRay(new RAPIER.Ray(origin, dir), d, true, undefined, WALLS_ONLY, undefined, undefined, keep)) return false;
    }
    return true;
  }

  /**
   * The way from `from` to `to`: waypoints to walk in turn, ending at `to`. Straight there if
   * nothing's in the way; null if there's no way at all.
   */
  path(from: XZ, to: XZ): THREE.Vector2[] | null {
    const goal = new THREE.Vector2(to.x, to.z);
    if (this.clear(from, to)) return [goal];
    const starts = this.reachable(from);
    const ends = new Set(this.reachable(to));
    if (!starts.length || !ends.size) return null;

    // Dijkstra (there are only a few dozen waypoints).
    const n = this.nodes.length;
    const dist = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    for (const s of starts) dist[s] = Math.hypot(this.nodes[s].x - from.x, this.nodes[s].y - from.z);
    let best = -1;
    let bestCost = Infinity;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] >= bestCost) break;
      done[u] = true;
      if (ends.has(u)) {
        const cost = dist[u] + Math.hypot(this.nodes[u].x - to.x, this.nodes[u].y - to.z);
        if (cost < bestCost) {
          bestCost = cost;
          best = u;
        }
      }
      for (const v of this.links[u]) {
        const d = dist[u] + this.nodes[u].distanceTo(this.nodes[v]);
        if (d < dist[v]) {
          dist[v] = d;
          prev[v] = u;
        }
      }
    }
    if (best < 0) return null;
    const route: THREE.Vector2[] = [goal];
    for (let u = best; u >= 0; u = prev[u]) route.unshift(this.nodes[u].clone());
    return route;
  }

  /** The nearest few waypoints that can be walked to straight from `p`. */
  private reachable(p: XZ): number[] {
    const order = this.nodes.map((_, i) => i).sort((a, b) => this.dist2(a, p) - this.dist2(b, p));
    const out: number[] = [];
    for (const i of order) {
      if (out.length >= ENDS || this.dist2(i, p) > 60 * 60) break;
      if (this.clear(p, { x: this.nodes[i].x, z: this.nodes[i].y })) out.push(i);
    }
    return out;
  }

  private dist2(i: number, p: XZ): number {
    return (this.nodes[i].x - p.x) ** 2 + (this.nodes[i].y - p.z) ** 2;
  }
}
