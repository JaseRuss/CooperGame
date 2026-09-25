import * as THREE from 'three';
import { TOWNS, type Town } from './TownPlan';
import { SITES, LAKES, siteEntries, distanceToSite, type Site } from './Landmarks';
import { surfaceHeightAt } from './Terrain';
import { FRIENDLY_BASES, BASE_RADIUS } from '../core/config';

export const HIGHWAY_WIDTH = 11;
const SAMPLE_STEP = 5;
const JOIN_OVERLAP = 8; // meters the highway extends back over the road it joins
const LOT_CLEARANCE = 14;
const EXTRA_LOOP_EDGES = 2;

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

/** Lakes and landmark sites the road must go around (the joined site's own edge is exempt). */
function crossesLandmarks(path: Polyline): boolean {
  for (const p of path.slice(2, -2)) {
    if (LAKES.some((l) => Math.hypot(p.x - l.cx, p.y - l.cz) < l.radius + 15)) return true;
    if (SITES.some((s) => distanceToSite(s, p.x, p.y) < 3)) return true;
  }
  return false;
}

function crossesHouses(path: Polyline): boolean {
  if (crossesLandmarks(path)) return true;
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
function connect(a: Node, b: Node): Polyline | null {
  const pairs: [Entry, Entry][] = [];
  for (const ea of a.entries) for (const eb of b.entries) pairs.push([ea, eb]);
  pairs.sort((p, q) => pairCost(p[0], p[1]) - pairCost(q[0], q[1]));
  for (const [ea, eb] of pairs.slice(0, 12)) {
    const path = curveBetween(ea, eb);
    if (!crossesHouses(path)) return path;
  }
  return null;
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

function pushRibbon(path: Polyline, width: number, lift: number, positions: number[], indices: number[]): void {
  const base = positions.length / 3;
  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const tangent = next.clone().sub(prev).normalize();
    const side = new THREE.Vector2(-tangent.y, tangent.x).multiplyScalar(width / 2);
    for (const s of [1, -1]) {
      const x = path[i].x + side.x * s;
      const z = path[i].y + side.y * s;
      positions.push(x, surfaceHeightAt(x, z) + lift, z);
    }
    if (i > 0) {
      // Quad (L0, R0, L1, R1); wound counter-clockwise seen from above so the faces point up.
      const a = base + (i - 1) * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
}

function ribbonGeometry(paths: Polyline[], width: number, lift: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const p of paths) pushRibbon(p, width, lift, positions, indices);
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
    ribbonGeometry(roads, HIGHWAY_WIDTH, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0x45484d,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  asphalt.receiveShadow = true;
  group.add(asphalt);

  const dashes: Polyline[] = [];
  for (const road of roads) {
    for (let i = 0; i + 1 < road.length; i += 3) dashes.push([road[i], road[i + 1]]);
  }
  group.add(
    new THREE.Mesh(
      ribbonGeometry(dashes, 0.35, 0.18),
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
