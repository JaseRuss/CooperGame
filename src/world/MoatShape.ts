import { SITES } from './Landmarks';

/**
 * The shape of the moat round the Fortress: a square ring of water outside the walls, crossed by
 * a solid causeway at the north and south gates. Pure geometry, in the Fortress's frame (its site
 * is square to the world and never rotated), so the terrain, roads, vehicles and zombies can all
 * ask about it without building anything.
 */

const FORTRESS = SITES.find((s) => s.kind === 'fortress');

/** Inner and outer edge of the water, in metres out from the middle (the walls stand at 100). */
export const MOAT_INNER = 106;
export const MOAT_OUTER = 130;
/**
 * Half-width of the causeways to the gates: the road (11 m wide) with room either side, since a
 * gate road can start to curve away before it's off the causeway.
 */
export const CAUSEWAY_HALF = 15;
/** How deep the moat is dug below the Fortress's ground, and how far below that the water sits. */
export const MOAT_DEPTH = 3.5;
export const MOAT_WATER_DROP = 1;
/** Past the outer edge, the ground eases back from the Fortress's level to its own over this far. */
const MOAT_BANK = 20;
/** Where the causeway meets the dug moat, the digging eases in over this far. */
const CAUSEWAY_EASE = 6;
/** Routes round the moat go by corners this far out, clear of the water. */
const CORNER = MOAT_OUTER + 17;
/** A route segment is blocked if it comes within this square (the water, plus a little). */
const ROUTE_SQUARE = MOAT_OUTER + 2;

export interface Point2 {
  x: number;
  z: number;
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function local(x: number, z: number): [number, number] {
  return FORTRESS ? [x - FORTRESS.cx, z - FORTRESS.cz] : [Infinity, Infinity];
}

/** Distance out from the middle, square-wise (the walls and moat are square). */
function ring(lx: number, lz: number): number {
  return Math.max(Math.abs(lx), Math.abs(lz));
}

/** On a causeway: the north or south side, within `CAUSEWAY_HALF - shrink` of the middle line. */
function onCauseway(lx: number, lz: number, shrink: number): boolean {
  return Math.abs(lz) >= Math.abs(lx) && Math.abs(lx) < CAUSEWAY_HALF - shrink;
}

/**
 * True over the moat's water, grown by `margin` metres (the causeways shrink by it): a tank's
 * middle can't come within `margin` of the water, nor a tree be planted there.
 */
export function inMoat(x: number, z: number, margin = 0): boolean {
  const [lx, lz] = local(x, z);
  const m = ring(lx, lz);
  return m >= MOAT_INNER - margin && m <= MOAT_OUTER + margin && !onCauseway(lx, lz, margin);
}

/** How much of the moat's depth is dug at (x, z): 0 on dry ground and the causeways, 1 mid-channel. */
export function moatDig(x: number, z: number): number {
  const [lx, lz] = local(x, z);
  const t = (ring(lx, lz) - MOAT_INNER) / (MOAT_OUTER - MOAT_INNER);
  if (t <= 0 || t >= 1) return 0;
  const across = Math.sin(Math.PI * t) ** 0.6;
  const causeway = Math.abs(lz) >= Math.abs(lx) ? smoothstep((Math.abs(lx) - CAUSEWAY_HALF) / CAUSEWAY_EASE) : 1;
  return across * causeway;
}

/** How strongly the ground is levelled to the Fortress's height: fully under the moat, easing out past it. */
export function moatLevelling(x: number, z: number): number {
  const [lx, lz] = local(x, z);
  const m = ring(lx, lz);
  if (m < MOAT_INNER || !FORTRESS) return 0;
  if (m <= MOAT_OUTER) return 1;
  return 1 - smoothstep((m - MOAT_OUTER) / MOAT_BANK);
}

/** True when the straight line from `a` to `b` would cut across the moat (Liang-Barsky against its square). */
function crossesMoat(a: Point2, b: Point2): boolean {
  const [ax, az] = local(a.x, a.z);
  const [bx, bz] = local(b.x, b.z);
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  const s = ROUTE_SQUARE;
  return clip(-dx, ax + s) && clip(dx, s - ax) && clip(-dz, az + s) && clip(dz, s - az);
}

const CORNERS: Point2[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
].map(([sx, sz]) => ({ x: (FORTRESS?.cx ?? 0) + sx * CORNER, z: (FORTRESS?.cz ?? 0) + sz * CORNER }));

/**
 * The shortest way from `from` to `to` (both outside the moat) that goes round it by its corners:
 * the waypoints to drive through, ending with `to`. Just [to] when the straight line is clear.
 */
export function routeRoundMoat(from: Point2, to: Point2): Point2[] {
  if (!FORTRESS || !crossesMoat(from, to)) return [to];
  // A tiny graph: from, the four corners, to. Dijkstra over it (edges wherever the line is clear).
  const nodes = [from, ...CORNERS, to];
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || crossesMoat(nodes[u], nodes[v])) continue;
      const d = dist[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  const last = nodes.length - 1;
  if (dist[last] === Infinity) return [to];
  const path: Point2[] = [];
  for (let v = last; v > 0; v = prev[v]) path.unshift(nodes[v]);
  return path;
}

/** Length of a route from `from` through `path`. */
function routeLength(from: Point2, path: Point2[]): number {
  let d = 0;
  let at = from;
  for (const p of path) {
    d += Math.hypot(p.x - at.x, p.z - at.z);
    at = p;
  }
  return d;
}

/**
 * Where a zombie at `p` should head next to get at the Fortress without wading the moat: round
 * the moat to the nearer causeway, then straight down it to the gate. Null once it's past the
 * moat (or somehow in it), when it can make straight for its goal on the wall.
 */
export function zombieWaypoint(p: Point2): Point2 | null {
  if (!FORTRESS) return null;
  const [lx, lz] = local(p.x, p.z);
  const m = ring(lx, lz);
  if (m < MOAT_INNER) return null;
  if (onCauseway(lx, lz, 2)) {
    // Down the middle of the causeway to the gate.
    return { x: FORTRESS.cx + Math.max(-4, Math.min(4, lx)), z: FORTRESS.cz + Math.sign(lz) * (MOAT_INNER - 5) };
  }
  if (m <= MOAT_OUTER + 2) return null;
  let best: Point2[] | null = null;
  let bestLength = Infinity;
  for (const side of [1, -1]) {
    const entry = { x: FORTRESS.cx, z: FORTRESS.cz + side * (MOAT_OUTER + 8) };
    const route = routeRoundMoat(p, entry);
    const length = routeLength(p, route);
    if (length < bestLength) {
      bestLength = length;
      best = route;
    }
  }
  return best ? best[0] : null;
}
