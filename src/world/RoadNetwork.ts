import * as THREE from 'three';
import { TOWNS, ROAD_WIDTH, type Town } from './TownPlan';
import { SITES, LAKES, siteEntries, distanceToSite, type Site } from './Landmarks';
import { inMoat } from './MoatShape';
import { surfaceHeightAt, heightAt } from './Terrain';
import { FRIENDLY_BASES, BASE_RADIUS, JUNGLE, KNIGHTS, MISSION, WORLD_HALF } from '../core/config';

/** Road surface colour: asphalt, packed red-brown earth in the jungle, a dusty cart track for the knights. */
export const ROAD_COLOR = JUNGLE ? 0x7a5634 : KNIGHTS ? 0x9a7c52 : 0x45484d;

export const HIGHWAY_WIDTH = 11;
const SAMPLE_STEP = 5;
const JOIN_OVERLAP = 8; // meters the highway extends back over the road it joins
const LOT_CLEARANCE = 14;
const EXTRA_LOOP_EDGES = 2;
const ASPHALT_COLUMNS = 5; // vertices across the highway, so it can follow a crowned or tilted slope

export type Polyline = THREE.Vector2[];

/** Where a highway may join: the end of a street (or the base pad edge) and its outward direction. */
interface Entry {
  point: THREE.Vector2;
  dir: THREE.Vector2;
}

interface Node {
  x: number;
  z: number;
  entries: Entry[];
}

function townEntries(town: Town): Entry[] {
  return town.roads.flatMap((r) => {
    const axis = r.alongX ? new THREE.Vector2(1, 0) : new THREE.Vector2(0, 1);
    const center = new THREE.Vector2(r.x, r.z);
    return [1, -1].map((s) => ({
      point: center.clone().addScaledVector(axis, (s * r.length) / 2),
      dir: axis.clone().multiplyScalar(s),
    }));
  });
}

function baseEntries(base: { x: number; z: number }): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
    out.push({ point: new THREE.Vector2(base.x, base.z).addScaledVector(dir, BASE_RADIUS * 0.85), dir });
  }
  return out;
}

/**
 * Cubic curve that leaves each entry straight along its street before bending toward the
 * other end, so the highway lines up with the road it joins. Starts and ends a few meters
 * back inside the joined road so the two surfaces overlap with no gap.
 */
function curveBetween(a: Entry, b: Entry): Polyline {
  const len = a.point.distanceTo(b.point);
  const handle = Math.min(len * 0.35, 140);
  const p0 = a.point;
  const p1 = a.point.clone().addScaledVector(a.dir, handle);
  const p2 = b.point.clone().addScaledVector(b.dir, handle);
  const p3 = b.point;
  const steps = Math.max(2, Math.ceil(len / SAMPLE_STEP));
  const pts: Polyline = [a.point.clone().addScaledVector(a.dir, -JOIN_OVERLAP)];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    pts.push(new THREE.Vector2(
      w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
      w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
    ));
  }
  pts.push(b.point.clone().addScaledVector(b.dir, -JOIN_OVERLAP));
  return pts;
}

/** Sort key for an entry pair: distance, plus a penalty when an entry faces away from the other end. */
function pairCost(a: Entry, b: Entry): number {
  const ab = b.point.clone().sub(a.point);
  const d = ab.length();
  ab.divideScalar(d || 1);
  const facing = Math.max(0, -a.dir.dot(ab)) + Math.max(0, b.dir.dot(ab));
  return d + facing * 250;
}

function siteRoadEntries(site: Site): Entry[] {
  return siteEntries(site).map((e) => ({
    point: new THREE.Vector2(e.x, e.z),
    dir: new THREE.Vector2(e.dirX, e.dirZ).normalize(),
  }));
}

/** Lakes, the Fortress's moat and landmark sites the road must go around (the joined site's own edge is exempt). */
function crossesLandmarks(path: Polyline): boolean {
  for (const p of path.slice(2, -2)) {
    if (LAKES.some((l) => Math.hypot(p.x - l.cx, p.y - l.cz) < l.radius + 15)) return true;
    if (inMoat(p.x, p.y, 2)) return true; // the gate roads run up the causeways, which aren't moat
    if (SITES.some((s) => distanceToSite(s, p.x, p.y) < 3)) return true;
  }
  return false;
}

function crossesHouses(path: Polyline, ignoreHouses = false): boolean {
  if (crossesLandmarks(path)) return true;
  if (ignoreHouses) return false;
  for (const town of TOWNS) {
    // The first/last points sit on the joined street itself, so skip them.
    for (const p of path.slice(1, -1)) {
      if (p.x < town.minX - LOT_CLEARANCE || p.x > town.maxX + LOT_CLEARANCE) continue;
      if (p.y < town.minZ - LOT_CLEARANCE || p.y > town.maxZ + LOT_CLEARANCE) continue;
      for (const lot of town.lots) {
        if (Math.abs(p.x - lot.x) < LOT_CLEARANCE && Math.abs(p.y - lot.z) < LOT_CLEARANCE) return true;
      }
    }
  }
  return false;
}

/** Best (shortest, house-avoiding) road between two nodes, or null if none is clear. */
function connect(a: Node, b: Node, desperate = false): Polyline | null {
  const pairs: [Entry, Entry][] = [];
  for (const ea of a.entries) for (const eb of b.entries) pairs.push([ea, eb]);
  pairs.sort((p, q) => pairCost(p[0], p[1]) - pairCost(q[0], q[1]));
  for (const [ea, eb] of desperate ? pairs : pairs.slice(0, 12)) {
    const path = curveBetween(ea, eb);
    if (!crossesHouses(path, desperate)) return path;
  }
  return null;
}

// ---------- grid roads (mission 1: home to each enemy base) ----------

/** Lattice lines are at least this far apart unless something (a town street, a gate) sits on one. */
const GRID_STEP = 100;
const GRID_SAMPLE = 8;
const GRID_TURN_COST = 45;
/** Metres of extra cost for each sample on ground steeper than this (rise over run). */
const GRID_SLOPE_LIMIT = 0.085;
const GRID_SLOPE_COST = 70;
const GRID_SHARED_DISCOUNT = 0.3;
const GRID_CORNER_RADIUS = 24;
const GRID_CLEAR_LAKE = 28;
const GRID_CLEAR_SITE = 22;
const GRID_CLEAR_MOAT = 32;
const GRID_CLEAR_BASE = BASE_RADIUS + 24;
const GRID_GATE_LEAD = 45;

/** True when (x, z) is in a town (with a little margin) and a road there at this x or z isn't on one of its streets. */
function offStreets(x: number, z: number, vertical: boolean): boolean {
  for (const t of TOWNS) {
    if (x < t.minX - 6 || x > t.maxX + 6 || z < t.minZ - 6 || z > t.maxZ + 6) continue;
    const lines = vertical ? t.crossXs : t.streetZs;
    if (!lines.some((l) => Math.abs((vertical ? x : z) - l) < 1)) return true;
  }
  return false;
}

/** Cost of driving the straight run from (x0, z0) to (x1, z1), or Infinity when it can't be built there. */
function gridRunCost(x0: number, z0: number, x1: number, z1: number): number {
  const vertical = x0 === x1;
  const length = Math.abs(vertical ? z1 - z0 : x1 - x0);
  const n = Math.max(1, Math.ceil(length / GRID_SAMPLE));
  let steep = 0;
  let prev = heightAt(x0, z0);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const z = z0 + ((z1 - z0) * i) / n;
    if (Math.abs(x) > WORLD_HALF - 90 || Math.abs(z) > WORLD_HALF - 90) return Infinity;
    if (LAKES.some((l) => Math.hypot(x - l.cx, z - l.cz) < l.radius + GRID_CLEAR_LAKE)) return Infinity;
    if (SITES.some((s) => distanceToSite(s, x, z) < GRID_CLEAR_SITE)) return Infinity;
    if (inMoat(x, z, GRID_CLEAR_MOAT)) return Infinity;
    if (FRIENDLY_BASES.some((b, k) => k > 0 && Math.hypot(x - b.x, z - b.z) < GRID_CLEAR_BASE)) return Infinity;
    if (offStreets(x, z, vertical)) return Infinity;
    if (i > 0) {
      const h = heightAt(x, z);
      if (Math.abs(h - prev) / (length / n) > GRID_SLOPE_LIMIT) steep++;
      prev = h;
    }
  }
  return length + steep * GRID_SLOPE_COST;
}

/** Sorted lattice lines: an even spacing, with the coordinates that have to be hit (a gate, a town street) kept exactly. */
function gridLines(required: number[], low: number, high: number): number[] {
  const out = required.slice();
  for (let v = Math.ceil(low / GRID_STEP) * GRID_STEP; v <= high; v += GRID_STEP) {
    if (!required.some((r) => Math.abs(r - v) < 28)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/** Min-heap of [cost, state] pairs, enough for one search. */
class SearchQueue {
  private readonly items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(cost: number, state: number): void {
    const a = this.items;
    a.push([cost, state]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop() as [number, number];
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Corners of a polyline with its collinear points dropped. */
function straighten(points: THREE.Vector2[]): THREE.Vector2[] {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) !== 0) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** The corners joined by straights sampled every few metres, with each right angle rounded off. */
function roundedPolyline(corners: THREE.Vector2[]): Polyline {
  const pts: Polyline = [corners[0].clone()];
  const lineTo = (to: THREE.Vector2) => {
    const from = pts[pts.length - 1];
    const steps = Math.max(1, Math.ceil(from.distanceTo(to) / SAMPLE_STEP));
    for (let i = 1; i <= steps; i++) pts.push(from.clone().lerp(to, i / steps));
  };
  for (let i = 1; i < corners.length - 1; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    const c = corners[i + 1];
    const r = Math.min(GRID_CORNER_RADIUS, a.distanceTo(b) / 2, b.distanceTo(c) / 2);
    const p1 = b.clone().addScaledVector(a.clone().sub(b).normalize(), r);
    const p2 = b.clone().addScaledVector(c.clone().sub(b).normalize(), r);
    lineTo(p1);
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      pts.push(new THREE.Vector2(u * u * p1.x + 2 * u * t * b.x + t * t * p2.x, u * u * p1.y + 2 * u * t * b.y + t * t * p2.y));
    }
  }
  lineTo(corners[corners.length - 1]);
  return pts;
}

/**
 * Roads from Cooper's Base to each enemy base's gate that run only north-south and east-west, like
 * a street grid. They keep off lakes, other sites, the moat and steep ground, run along the
 * streets of any town they have to cross (never through its houses), and share stretches of road
 * with each other where they can. Returns the road for each base (by its index in SITES), or null
 * when none could be found.
 */
function planGridRoads(): Map<number, Polyline> {
  const result = new Map<number, Polyline>();
  const home = FRIENDLY_BASES[0];
  const start = new THREE.Vector2(home.x, home.z - (BASE_RADIUS + 22));
  const gates = SITES.flatMap((site, index) => {
    if (site.kind !== 'enemyBase') return [];
    const gate = siteEntries(site)[0];
    const dir = new THREE.Vector2(gate.dirX, gate.dirZ).normalize();
    const point = new THREE.Vector2(gate.x, gate.z);
    return [{ index, point, dir, lead: point.clone().addScaledVector(dir, GRID_GATE_LEAD) }];
  }).filter((g) => Math.abs(g.dir.x) < 1e-6 || Math.abs(g.dir.y) < 1e-6);
  if (gates.length === 0) return result;

  const limit = WORLD_HALF - 120;
  const xs = gridLines([start.x, ...gates.map((g) => g.lead.x), ...TOWNS.flatMap((t) => t.crossXs)], -limit, limit);
  const zs = gridLines([start.y, ...gates.map((g) => g.lead.y), ...TOWNS.flatMap((t) => t.streetZs)], -limit, limit);
  const nearest = (lines: number[], v: number) => lines.reduce((best, l, i) => (Math.abs(l - v) < Math.abs(lines[best] - v) ? i : best), 0);
  const used = new Set<string>();
  const key = (xi: number, zi: number, xj: number, zj: number) => `${Math.min(xi, xj)},${Math.min(zi, zj)},${Math.max(xi, xj)},${Math.max(zi, zj)}`;
  const runCache = new Map<string, number>();
  const runCost = (xi: number, zi: number, xj: number, zj: number) => {
    const k = key(xi, zi, xj, zj);
    let c = runCache.get(k);
    if (c === undefined) {
      c = gridRunCost(xs[xi], zs[zi], xs[xj], zs[zj]);
      runCache.set(k, c);
    }
    return c;
  };

  const nx = xs.length;
  const nz = zs.length;
  const state = (xi: number, zi: number, dir: number) => (zi * nx + xi) * 3 + dir; // dir: 0 east-west, 1 north-south, 2 start
  const startX = nearest(xs, start.x);
  const startZ = nearest(zs, start.y);
  // Nearest bases first, so the later ones can reuse their roads.
  const order = gates.slice().sort((a, b) => a.point.distanceTo(start) - b.point.distanceTo(start));
  for (const gate of order) {
    const goalX = nearest(xs, gate.lead.x);
    const goalZ = nearest(zs, gate.lead.y);
    const cost = new Float64Array(nx * nz * 3).fill(Infinity);
    const from = new Int32Array(nx * nz * 3).fill(-1);
    const queue = new SearchQueue();
    cost[state(startX, startZ, 2)] = 0;
    queue.push(0, state(startX, startZ, 2));
    let goalState = -1;
    while (queue.size > 0) {
      const [c, s] = queue.pop();
      if (c > cost[s]) continue;
      const dir = s % 3;
      const cell = (s - dir) / 3;
      const xi = cell % nx;
      const zi = (cell - xi) / nx;
      if (xi === goalX && zi === goalZ) {
        goalState = s;
        break;
      }
      for (const [dxi, dzi] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xj = xi + dxi;
        const zj = zi + dzi;
        if (xj < 0 || xj >= nx || zj < 0 || zj >= nz) continue;
        const run = runCost(xi, zi, xj, zj);
        if (!isFinite(run)) continue;
        const heading = dxi !== 0 ? 0 : 1;
        const length = Math.abs(xs[xj] - xs[xi]) + Math.abs(zs[zj] - zs[zi]);
        const stepCost = used.has(key(xi, zi, xj, zj)) ? Math.min(run, length * GRID_SHARED_DISCOUNT) : run;
        const next = c + stepCost + (dir !== 2 && dir !== heading ? GRID_TURN_COST : 0);
        const t = state(xj, zj, heading);
        if (next < cost[t]) {
          cost[t] = next;
          from[t] = s;
          queue.push(next, t);
        }
      }
    }
    if (goalState < 0) continue;
    const cells: THREE.Vector2[] = [];
    for (let s = goalState; s >= 0; s = from[s]) {
      const cell = (s - (s % 3)) / 3;
      const xi = cell % nx;
      const zi = (cell - xi) / nx;
      cells.push(new THREE.Vector2(xs[xi], zs[zi]));
      if (from[s] >= 0) {
        const pc = (from[s] - (from[s] % 3)) / 3;
        used.add(key(xi, zi, pc % nx, (pc - (pc % nx)) / nx));
      }
    }
    cells.reverse();
    // From inside home's wall to the lattice, along the lattice, then the straight run into the gate.
    const corners = straighten([
      new THREE.Vector2(start.x, start.y + (BASE_RADIUS + 22) - BASE_RADIUS * 0.85 + JOIN_OVERLAP),
      ...cells,
      gate.lead,
      gate.point.clone().addScaledVector(gate.dir, -JOIN_OVERLAP),
    ]);
    result.set(gate.index, roundedPolyline(corners));
  }
  return result;
}

/** Plans highways linking every town and the home base (Kruskal MST + a couple of loops). */
export function planHighways(): Polyline[] {
  const nodes: Node[] = [
    ...FRIENDLY_BASES.map((b) => ({ x: b.x, z: b.z, entries: baseEntries(b) })),
    ...TOWNS.map((t) => ({ x: t.cx, z: t.cz, entries: townEntries(t) })),
    ...SITES.map((s) => ({ x: s.cx, z: s.cz, entries: siteRoadEntries(s) })),
  ];

  const edges: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      edges.push({ i, j, d: Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z) });
    }
  }
  edges.sort((a, b) => a.d - b.d);

  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  const roads: Polyline[] = [];
  // The first mission is a drive from Cooper's Base to the enemy bases, so each of them gets a
  // gridded road of its own straight from home; the spanning tree only links the rest.
  if (MISSION === 1) {
    for (const [siteIndex, road] of planGridRoads()) {
      roads.push(road);
      parent[find(FRIENDLY_BASES.length + TOWNS.length + siteIndex)] = find(0);
    }
  }

  const unused: typeof edges = [];
  for (const e of edges) {
    const ri = find(e.i);
    const rj = find(e.j);
    if (ri === rj) {
      unused.push(e);
      continue;
    }
    const path = connect(nodes[e.i], nodes[e.j]);
    if (!path) continue;
    parent[ri] = rj;
    roads.push(path);
  }

  // The clear-of-houses search can fail for a base tucked behind a town or lake. Every base must
  // be reachable by road, so link any node still cut off using every entry pair and, failing that,
  // a road that may brush past houses (never a lake, the moat or a landmark).
  for (let i = 0; i < nodes.length; i++) {
    if (find(i) === find(0)) continue;
    const order = nodes.map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.z - nodes[i].z) }))
      .filter(({ j }) => find(j) !== find(i))
      .sort((a, b) => a.d - b.d);
    for (const desperate of [false, true]) {
      let linked = false;
      for (const { j } of order) {
        const path = connect(nodes[i], nodes[j], desperate);
        if (!path) continue;
        roads.push(path);
        parent[find(i)] = find(j);
        linked = true;
        break;
      }
      if (linked) break;
    }
    if (find(i) !== find(0)) console.warn('No road could be planned to node', i);
  }

  let loops = 0;
  for (const e of unused) {
    if (loops >= EXTRA_LOOP_EDGES) break;
    const path = connect(nodes[e.i], nodes[e.j]);
    if (path) {
      roads.push(path);
      loops++;
    }
  }

  return roads;
}

/**
 * Highest point of the rendered ground around (x, z): the road surface spans straight lines
 * between its vertices, so each vertex is lifted clear of any bump in the neighbouring stretch.
 */
function groundUnder(x: number, z: number, tangent: THREE.Vector2, side: THREE.Vector2, reach: number, span: number): number {
  let h = surfaceHeightAt(x, z);
  for (const t of [-reach, -reach / 2, reach / 2, reach]) h = Math.max(h, surfaceHeightAt(x + tangent.x * t, z + tangent.y * t));
  for (const s of [-span, span]) h = Math.max(h, surfaceHeightAt(x + side.x * s, z + side.y * s));
  return h;
}

/** A strip `columns` vertices wide laid along `path`, hugging (never dipping under) the ground. */
function pushRibbon(path: Polyline, width: number, lift: number, positions: number[], indices: number[], columns = 2, sampleSpan?: number): void {
  const base = positions.length / 3;
  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const tangent = next.clone().sub(prev).normalize();
    const side = new THREE.Vector2(-tangent.y, tangent.x);
    const reach = Math.max(prev.distanceTo(path[i]), next.distanceTo(path[i])) / 2;
    const span = sampleSpan ?? width / (columns - 1) / 2;
    for (let c = 0; c < columns; c++) {
      const s = (0.5 - c / (columns - 1)) * width; // +width/2 (left) to -width/2 (right)
      const x = path[i].x + side.x * s;
      const z = path[i].y + side.y * s;
      positions.push(x, groundUnder(x, z, tangent, side, reach, span) + lift, z);
    }
    if (i > 0) {
      // Quads between this row and the last, wound counter-clockwise seen from above (faces up).
      for (let c = 0; c < columns - 1; c++) {
        const a = base + (i - 1) * columns + c;
        const b = a + columns;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
}

function ribbonGeometry(paths: Polyline[], width: number, lift: number, columns = 2, sampleSpan?: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const p of paths) pushRibbon(p, width, lift, positions, indices, columns, sampleSpan);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Builds terrain-hugging highway meshes (asphalt + dashed centre line). */
export function buildHighwayMeshes(roads: Polyline[]): THREE.Object3D {
  const group = new THREE.Group();

  const asphalt = new THREE.Mesh(
    ribbonGeometry(roads, HIGHWAY_WIDTH, 0.14, ASPHALT_COLUMNS),
    new THREE.MeshStandardMaterial({
      color: ROAD_COLOR,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  asphalt.receiveShadow = true;
  group.add(asphalt);

  if (JUNGLE || KNIGHTS) return group; // dirt tracks have no centre line

  const dashes: Polyline[] = [];
  for (const road of roads) {
    for (let i = 0; i + 1 < road.length; i += 3) dashes.push([road[i], road[i + 1]]);
  }
  group.add(
    new THREE.Mesh(
      // Sampled like the asphalt's centre line so the dashes always sit just on top of it.
      ribbonGeometry(dashes, 0.35, 0.18, 2, HIGHWAY_WIDTH / (ASPHALT_COLUMNS - 1) / 2),
      new THREE.MeshBasicMaterial({ color: 0xe8d36a, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    ),
  );

  return group;
}

export function distanceToPolyline(x: number, z: number, path: Polyline): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const abz = b.y - a.y;
    const lenSq = abx * abx + abz * abz;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / lenSq)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.y + abz * t)));
  }
  return best;
}

// ---------- road surface, for the speed boost on roads ----------

const ROAD_EDGE_SLACK = 0.5; // counts as on the road with the tracks just over the edge
const TOWN_ROAD_HALF_WIDTH = ROAD_WIDTH / 2;
let surfaceRoads: { path: Polyline; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];

/** Registers the highways (from world generation) for isOnRoad. */
export function setSurfaceRoads(highways: Polyline[]): void {
  const pad = HIGHWAY_WIDTH;
  surfaceRoads = highways.map((path) => ({
    path,
    minX: Math.min(...path.map((p) => p.x)) - pad,
    maxX: Math.max(...path.map((p) => p.x)) + pad,
    minZ: Math.min(...path.map((p) => p.y)) - pad,
    maxZ: Math.max(...path.map((p) => p.y)) + pad,
  }));
}

/** True on a highway or any town street. */
export function isOnRoad(x: number, z: number): boolean {
  for (const town of TOWNS) {
    for (const r of town.roads) {
      const hx = (r.alongX ? r.length / 2 : TOWN_ROAD_HALF_WIDTH) + ROAD_EDGE_SLACK;
      const hz = (r.alongX ? TOWN_ROAD_HALF_WIDTH : r.length / 2) + ROAD_EDGE_SLACK;
      if (Math.abs(x - r.x) < hx && Math.abs(z - r.z) < hz) return true;
    }
  }
  for (const r of surfaceRoads) {
    if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
    if (distanceToPolyline(x, z, r.path) < HIGHWAY_WIDTH / 2 + ROAD_EDGE_SLACK) return true;
  }
  return false;
}
