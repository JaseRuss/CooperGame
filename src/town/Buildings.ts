import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mulberry32 } from '../utils/rng';
import { plastic } from '../utils/plastic';
import { PartBuilder, sandbagGeometry } from '../utils/modelKit';
import { inPolygon, centroid, type TownData, type Pt, type Footprint, type Line } from './TownData';
import { WATER_GROUPS } from '../prison/groups';
import { withDetail } from './Surfaces';
import { CAR_TYPES, parkedCars, type CarPlacement } from './Cars';
import { OpeningWriter, WINDOWS, SCHOOL_WINDOW, DOUBLE_DOOR, DOOR_CELLS, GARAGE_DOORS, type Cell } from './Openings';

/** White and pale grey render on most of the new houses (as in a drone shot of the estate), some buff, a few rows of red brick. */
const WALLS = [0xf4f3ef, 0xefeee9, 0xe9e8e3, 0xf6f4ee, 0xe3e2dd, 0xdcdbd6, 0xece6d8, 0xd9c7a8, 0xf1f0ec, 0xa9654e, 0xb5765c];
/** Blue-grey slate (or slate-look tiles), and now and then a brown one. */
const ROOFS = [0x4e5664, 0x56606e, 0x48505c, 0x5d6672, 0x434a55, 0x515a68, 0x6a5246];
const SOLAR = 0x1e2a46;
const DOORS = [0x7a2a2a, 0x2a4a7a, 0x2f5a35, 0xe8e8e0, 0x3a3a3a, 0x8a6a2a];
const CARS = [0xc0392b, 0x2e5fa8, 0xe8e8e8, 0x2c2c2c, 0x8e9499, 0x3c7a4a, 0xd4a017, 0x6d3b8a];
/** A steady 0..1 from a spot, for choices that mustn't use up the layout's random numbers. */
function hash(x: number, z: number): number {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
}
/** What goes with a window or door: a sill under it, or a step (and maybe a canopy) at a front door. */
type Trim = 'sill' | 'door' | 'porch' | null;
const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'track']);

let penSignTexture: THREE.CanvasTexture | null = null;
/** The board by each pen's gate (one texture, shared). */
function penSign(): THREE.CanvasTexture {
  if (penSignTexture) return penSignTexture;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 110;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#e8e2cf';
  g.fillRect(0, 0, 256, 110);
  g.strokeStyle = '#7a2a22';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 248, 102);
  g.fillStyle = '#7a2a22';
  g.font = '900 34px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('PRISONERS', 128, 48);
  g.font = '700 22px "Segoe UI", system-ui, sans-serif';
  g.fillText('KEEP OUT', 128, 84);
  penSignTexture = new THREE.CanvasTexture(c);
  penSignTexture.colorSpace = THREE.SRGBColorSpace;
  return penSignTexture;
}
/**
 * Mauricewood Primary's blocks, as the aerial photos show them: one storey of flat roofs (light
 * grey with rows of rooflights, one darker block), a taller hall with a hipped roof, and a low
 * annex. The walls are buff brick.
 */
const SCHOOL_STYLE: Record<string, { h: number; roof: number; hip?: true; rooflights?: true }> = {
  hall: { h: 6.6, roof: 0x8d9195, hip: true },
  dark: { h: 4.9, roof: 0x4c5056, rooflights: true },
  light: { h: 4.1, roof: 0xb5b9bb, rooflights: true },
  annex: { h: 3.3, roof: 0x9a7a5c },
};
const SCHOOL_WALL = 0xc49a72;

/** Triangles with a colour at every corner: everything in the town shares a couple of materials. */
class Writer {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly norm: number[] = [];
  private readonly c = new THREE.Color();

  tri(a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, color: number): void {
    this.c.setHex(color);
    const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
    for (const p of [a, b, d]) {
      this.pos.push(p.x, p.y, p.z);
      this.norm.push(n.x, n.y, n.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** A quad a-b-c-d, counter-clockwise seen from the side it faces. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: number): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  build(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

/** The smallest rectangle round a footprint: its middle, the long axis, and half its length and width. */
interface Rect {
  c: Pt;
  ux: number;
  uz: number;
  hl: number;
  hw: number;
}

function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function minRect(pts: Pt[]): Rect {
  const h = hull(pts);
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
    for (const q of h) {
      const s = q.x * ux + q.z * uz;
      const t = -q.x * uz + q.z * ux;
      lo = Math.min(lo, s); hi = Math.max(hi, s); lo2 = Math.min(lo2, t); hi2 = Math.max(hi2, t);
    }
    const area = (hi - lo) * (hi2 - lo2);
    if (area < bestArea) {
      bestArea = area;
      const s = (lo + hi) / 2, t = (lo2 + hi2) / 2;
      const r = { c: { x: s * ux - t * uz, z: s * uz + t * ux }, ux, uz, hl: (hi - lo) / 2, hw: (hi2 - lo2) / 2 };
      best = r.hl >= r.hw ? r : { c: r.c, ux: -uz, uz: ux, hl: r.hw, hw: r.hl };
    }
  }
  return best as Rect;
}

function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].z - p[i].x * p[j].z;
  return a / 2;
}

/** Distance from a point to a segment. */
function segDist(p: Pt, a: Pt, b: Pt): { d: number; at: Pt } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  const at = { x: a.x + dx * t, z: a.z + dz * t };
  return { d: Math.hypot(p.x - at.x, p.z - at.z), at };
}

/** Segments bucketed by 20 m cells, for "how near is the nearest road" questions. */
class SegmentGrid {
  private readonly cells = new Map<number, { a: Pt; b: Pt; w: number }[]>();
  private static readonly CELL = 20;
  private key(cx: number, cz: number): number {
    return (cx + 500) * 1000 + (cz + 500);
  }
  add(a: Pt, b: Pt, w: number): void {
    const C = SegmentGrid.CELL;
    const x0 = Math.floor(Math.min(a.x, b.x) / C) - 1, x1 = Math.floor(Math.max(a.x, b.x) / C) + 1;
    const z0 = Math.floor(Math.min(a.z, b.z) / C) - 1, z1 = Math.floor(Math.max(a.z, b.z) / C) + 1;
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = this.key(cx, cz);
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push({ a, b, w });
    }
  }
  /** The nearest segment within about 20 m: how far its edge is, and the nearest point on its middle line. */
  nearest(p: Pt): { d: number; at: Pt; w: number } | null {
    const list = this.cells.get(this.key(Math.floor(p.x / SegmentGrid.CELL), Math.floor(p.z / SegmentGrid.CELL)));
    let best: { d: number; at: Pt; w: number } | null = null;
    for (const s of list ?? []) {
      const r = segDist(p, s.a, s.b);
      const d = r.d - s.w / 2;
      if (!best || d < best.d) best = { d, at: r.at, w: s.w };
    }
    return best;
  }
}

/** Polygons bucketed the same way, for "is this spot inside a building". */
class PolyGrid {
  private readonly cells = new Map<number, Pt[][]>();
  add(poly: Pt[]): void {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of poly) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    for (let cx = Math.floor(x0 / 20); cx <= Math.floor(x1 / 20); cx++) for (let cz = Math.floor(z0 / 20); cz <= Math.floor(z1 / 20); cz++) {
      const k = (cx + 500) * 1000 + (cz + 500);
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(poly);
    }
  }
  /** Inside one of the polygons, or within `margin` of its middle-ish bulk. */
  hit(p: Pt, margin = 0): boolean {
    const list = this.cells.get((Math.floor(p.x / 20) + 500) * 1000 + (Math.floor(p.z / 20) + 500));
    if (!list) return false;
    for (const poly of list) {
      if (inPolygon(p, poly)) return true;
      if (margin > 0) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segDist(p, poly[j], poly[i]).d < margin) return true;
    }
    return false;
  }
}

/** The school's own building, flagpole and flag (it isn't on the map, so it's built here). */
/** An enemy pen holding two of our squad, away from the route down the hill. */
export interface Pen {
  at: Pt;
  /** Just outside the gate: stand here to let them out. */
  gate: Pt;
  /** Where the two prisoners stand inside. */
  inside: Pt[];
  /** Its guards' posts. */
  guards: Pt[];
  /** Swings the gate open (once). */
  open(): void;
}

export interface School {
  centre: Pt;
  /** The flagpole in front of it, where our flag goes up. */
  pole: THREE.Vector3;
  flag: THREE.Mesh;
  /** The flag's height up the pole: 0 at the bottom, 1 at the top. */
  raise(k: number): void;
  /** Spots round the building and playground for its defenders. */
  posts: Pt[];
}

/** An enemy roadblock on the way down the hill: a curve of sandbags across the street. */
export interface Roadblock {
  at: Pt;
  /** Uphill, the way the attack comes from. */
  facing: Pt;
  flagMaterial: THREE.MeshPhysicalMaterial;
  posts: Pt[];
  /** The machine-gun nest: where its gunner stands, and the gun (it turns to follow his aim). */
  gunner: Pt;
  gun: THREE.Group;
  /** The way through, from the attack side: the wire's gap, the barriers' gap, the gap in the bags, and the clear lane behind. */
  through: Pt[];
}

/**
 * Everything standing in the town: every house, garage and block of flats from the map (with a
 * pitched roof where the footprint is a plain rectangle, textured windows with sills, a front door
 * facing the street with a step and sometimes a canopy), the
 * school (built where its grounds are), trees in the woods and gardens, hedges, walls and fences,
 * and cars parked along the kerbs. Each kind is merged or instanced into a few meshes, and the
 * solid parts become colliders: buildings, trunks, cars, walls and hedges.
 */
export class Buildings {
  readonly group = new THREE.Group();
  readonly count: { buildings: number; trees: number; cars: number; triangles: number; gardens: number; lamps: number } = { buildings: 0, trees: 0, cars: 0, triangles: 0, gardens: 0, lamps: 0 };
  readonly school: School;
  private readonly body: RAPIER.RigidBody;
  private readonly roads = new SegmentGrid();
  private readonly footprints = new PolyGrid();
  private readonly colliderTris: number[] = [];
  /** Each house and the street it faces, for its back garden; and the fences round those gardens. */
  private readonly plots: { r: Rect; street: Pt }[] = [];
  private readonly gardenLines: Line[] = [];
  private readonly gardenGrid = new PolyGrid();
  private readonly openings = new OpeningWriter();

  constructor(private readonly world: RAPIER.World, scene: THREE.Scene, private readonly town: TownData) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const r of town.roads) for (let i = 1; i < r.pts.length; i++) this.roads.add(r.pts[i - 1], r.pts[i], FOOT.has(r.kind) ? r.width : r.width + 3.4);
    for (const b of town.buildings) this.footprints.add(b.pts);

    const walls = new Writer();
    const rng = mulberry32(2611);
    for (const b of town.buildings) this.building(b, walls, rng);
    this.school = this.buildSchool();
    const mesh = walls.build(withDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 'building'));
    this.group.add(mesh);
    this.group.add(this.openings.build());
    this.count.buildings = town.buildings.length;
    this.count.triangles = walls.pos.length / 9 + this.openings.triangles;
    // All the buildings are one trimesh to walk into and shoot at.
    const verts = new Float32Array(this.colliderTris);
    const idx = new Uint32Array(verts.length / 3).map((_, i) => i);
    world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx), this.body);

    this.gardens();
    this.trees(rng);
    this.lampPosts();
    this.barriers();
    this.cars(rng);
    scene.add(this.group);
  }

  private ground(p: Pt): number {
    return this.town.heightAt(p.x, p.z);
  }

  /** Walls and a roof for one footprint from the map. */
  private building(b: Footprint, w: Writer, rng: () => number): void {
    let pts = b.pts;
    // Wound so each wall quad faces out (with x east and z south, that's a negative shoelace area).
    if (polyArea(pts) > 0) pts = [...pts].reverse();
    const area = Math.abs(polyArea(pts));
    if (area < 4) return;
    const garage = b.kind === 'garage' || b.kind === 'garages' || b.kind === 'shed' || b.kind === 'carport';
    const flats = b.kind === 'apartments';
    const school = b.kind.startsWith('school-') ? SCHOOL_STYLE[b.kind.slice(7)] : undefined;
    const levels = school ? (school.hip ? 2 : 1) : b.levels ?? (garage ? 1 : flats ? 3 : area < 55 ? 1 : rng() < 0.12 ? 1 : 2);
    const storey = school ? school.h / levels : 2.7;
    const wallH = school ? school.h : garage ? 2.5 : levels * storey + 0.3;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
      const h = this.ground(p);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    const y0 = lo - 0.6;
    const y1 = hi + wallH;
    const wallColor = school ? SCHOOL_WALL : WALLS[Math.floor(rng() * WALLS.length)];
    const roofColor = school ? school.roof : ROOFS[Math.floor(rng() * ROOFS.length)];
    const rect = minRect(pts);
    const fill = area / (4 * rect.hl * rect.hw);
    const street = school ? null : this.roads.nearest(rect.c);
    if (street && !garage && !flats && !school) this.plots.push({ r: rect, street: street.at });
    if (school?.hip || (!school && fill > 0.82 && rect.hw > (garage ? 1.2 : 2))) {
      // Most of the detached houses round here have hipped roofs; terraces and long semis are gabled. Garages get a low pitched roof too.
      const hip = !!school?.hip || rng() < (garage ? 0.5 : rect.hl / rect.hw < 1.7 ? 0.85 : 0.25);
      this.gabled(w, rect, y0, y1, wallColor, roofColor, levels, street?.at ?? null, lo, rng, hip, storey, garage, !school && !garage && rng() < 0.3);
      return;
    }
    // Any other shape: its own walls round the footprint and a flat roof.
    const v = (p: Pt, y: number) => new THREE.Vector3(p.x, y, p.z);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      this.wall(w, v(a, y0), v(c, y0), v(c, y1), v(a, y1), wallColor);
    }
    const shape = pts.map((p) => new THREE.Vector2(p.x, p.z));
    const tris = THREE.ShapeUtils.triangulateShape(shape, []);
    for (const [i, j, k] of tris) {
      const A = v(pts[i], y1), B = v(pts[j], y1), C = v(pts[k], y1);
      // Facing up: wound counter-clockwise seen from above.
      const up = B.clone().sub(A).cross(C.clone().sub(A)).y > 0;
      if (up) this.solid(w, A, B, C, roofColor);
      else this.solid(w, A, C, B, roofColor);
    }
    if (school?.rooflights) this.rooflights(w, pts, y1);
    const look = hash(rect.c.x, rect.c.z);
    if (school) this.windowsAround(w, pts, lo, 1, storey, SCHOOL_WINDOW);
    else if (garage) {
      // An up-and-over door on the side nearest the street.
      const s = street?.at;
      if (s) this.doorOnNearestEdge(w, pts, s, lo, 2.3, 2.0, GARAGE_DOORS[look < 0.75 ? 0 : 1], null);
    } else {
      this.windowsAround(w, pts, lo, levels, storey, WINDOWS[Math.floor(look * WINDOWS.length)]);
      const door = DOOR_CELLS[Math.floor(rng() * DOORS.length)];
      // The flats get a glazed double door; a house its own front door.
      if (street) this.doorOnNearestEdge(w, pts, street.at, lo, flats ? 0.95 : 0.5, 2.05, flats ? DOUBLE_DOOR : door, flats ? 'porch' : 'door');
    }
  }

  /** Rows of little white rooflights on a flat roof (the school's). */
  private rooflights(w: Writer, pts: Pt[], y: number): void {
    const r = minRect(pts);
    for (let s = -r.hl + 2.5; s < r.hl - 1.5; s += 3.6) {
      for (let t = -r.hw + 2.5; t < r.hw - 1.5; t += 4.2) {
        const at = (ds: number, dt: number, h: number) => new THREE.Vector3(r.c.x + r.ux * (s + ds) - r.uz * (t + dt), y + h, r.c.z + r.uz * (s + ds) + r.ux * (t + dt));
        const mid = at(0, 0, 0);
        if (!inPolygon({ x: mid.x, z: mid.z }, pts)) continue;
        const c: [number, number][] = [[-0.7, -0.45], [-0.7, 0.45], [0.7, 0.45], [0.7, -0.45]];
        for (let i = 0; i < 4; i++) {
          const [a0, b0] = c[i], [a1, b1] = c[(i + 1) % 4];
          w.quad(at(a0, b0, 0), at(a1, b1, 0), at(a1, b1, 0.35), at(a0, b0, 0.35), 0xd8dde0);
        }
        w.quad(at(-0.7, -0.45, 0.35), at(-0.7, 0.45, 0.35), at(0.7, 0.45, 0.35), at(0.7, -0.45, 0.35), 0xf4f6f7);
      }
    }
  }

  /** A plain box house with a pitched roof along its length: gabled, or hipped (sloping down at the ends too). */
  private gabled(w: Writer, r: Rect, y0: number, y1: number, wallColor: number, roofColor: number, levels: number, street: Pt | null, floor: number, rng: () => number, hip = false, storey = 2.7, garage = false, solar = false): void {
    const at = (s: number, t: number, y: number) => new THREE.Vector3(r.c.x + r.ux * s - r.uz * t, y, r.c.z + r.uz * s + r.ux * t);
    const L = r.hl, W = r.hw;
    // Corners in the order that makes each wall face out.
    const corners: [number, number][] = [[-L, -W], [-L, W], [L, W], [L, -W]];
    for (let i = 0; i < 4; i++) {
      const [s0, t0] = corners[i], [s1, t1] = corners[(i + 1) % 4];
      this.wall(w, at(s0, t0, y0), at(s1, t1, y0), at(s1, t1, y1), at(s0, t0, y1), wallColor);
    }
    const rise = Math.min(3.2, W * 0.8);
    const o = 0.35;
    const ridge = y1 + rise;
    const eave = y1 - o * (rise / W);
    if (hip) {
      // The ridge stops short of each end, and the ends slope down to the eaves too.
      const rl = Math.max(0, L - W);
      this.roofQuad(w, at(-L - o, W + o, eave), at(L + o, W + o, eave), at(rl, 0, ridge), at(-rl, 0, ridge), roofColor);
      this.roofQuad(w, at(L + o, -W - o, eave), at(-L - o, -W - o, eave), at(-rl, 0, ridge), at(rl, 0, ridge), roofColor);
      this.roofTri(w, at(-L - o, -W - o, eave), at(-L - o, W + o, eave), at(-rl, 0, ridge), roofColor);
      this.roofTri(w, at(L + o, W + o, eave), at(L + o, -W - o, eave), at(rl, 0, ridge), roofColor);
    } else {
      // Gable ends (wall-coloured triangles) and the two roof slopes, with a little overhang.
      this.solid(w, at(-L, -W, y1), at(-L, W, y1), at(-L, 0, ridge), wallColor);
      this.solid(w, at(L, W, y1), at(L, -W, y1), at(L, 0, ridge), wallColor);
      this.roofQuad(w, at(-L - o, W + o, eave), at(L + o, W + o, eave), at(L + o, 0, ridge), at(-L - o, 0, ridge), roofColor);
      this.roofQuad(w, at(L + o, -W - o, eave), at(-L - o, -W - o, eave), at(-L - o, 0, ridge), at(L + o, 0, ridge), roofColor);
    }
    // Solar panels on the slope that faces south (+z), as on many of the new houses.
    if (solar) {
      const sd = Math.sign(r.ux) || 1; // the +t slope faces (-uz, ux): south when ux > 0
      const rl = hip ? Math.max(0, L - W) : L + o;
      const hs = Math.min(2.6, 0.85 * (rl + (L + o - rl) * 0.3));
      const pt = (s: number, f: number) => at(s, sd * (W + o) * (1 - f), eave + (ridge - eave) * f + 0.07);
      if (hs > 0.8) {
        if (sd > 0) w.quad(pt(-hs, 0.2), pt(hs, 0.2), pt(hs, 0.7), pt(-hs, 0.7), SOLAR);
        else w.quad(pt(hs, 0.2), pt(-hs, 0.2), pt(-hs, 0.7), pt(hs, 0.7), SOLAR);
      }
    }
    // A chimney on many of them.
    if (!garage && rng() < 0.45) {
      const cs = (rng() < 0.5 ? -1 : 1) * (L - 0.9);
      const cy = ridge + 0.9;
      const ch = [[-0.4, -0.35], [-0.4, 0.35], [0.4, 0.35], [0.4, -0.35]] as const;
      for (let i = 0; i < 4; i++) {
        const [a0, b0] = ch[i], [a1, b1] = ch[(i + 1) % 4];
        this.wall(w, at(cs + a0, b0, y1), at(cs + a1, b1, y1), at(cs + a1, b1, cy), at(cs + a0, b0, cy), 0x9a8a7a, false);
      }
      w.quad(at(cs - 0.4, -0.35, cy), at(cs - 0.4, 0.35, cy), at(cs + 0.4, 0.35, cy), at(cs + 0.4, -0.35, cy), 0x5a4a40);
    }
    // Windows along both long sides, a storey at a time, and the front door on the street side.
    const n = Math.max(1, Math.floor((2 * L) / 3.1));
    // The front faces the road: a long side, or an end when the road runs past that end instead
    // (the same test the back garden uses, so the garden is always behind).
    const ds = street ? (street.x - r.c.x) * r.ux + (street.z - r.c.z) * r.uz : 0;
    const dt = street ? (street.x - r.c.x) * -r.uz + (street.z - r.c.z) * r.ux : 1;
    const endOn = Math.abs(ds) / L > Math.abs(dt) / W;
    const front = endOn ? 0 : Math.sign(dt) || 1;
    const doorAt = n > 1 ? Math.floor(n / 2) : -1;
    const look = hash(r.c.x, r.c.z);
    // The way each long side faces (+t), and each end (+s).
    const sideN = (side: number) => [-r.uz * side, r.ux * side] as const;
    const endN = (side: number) => [r.ux * side, r.uz * side] as const;
    if (garage) {
      // An up-and-over door on the side facing the road, and nothing else.
      const cell = GARAGE_DOORS[look < 0.75 ? 0 : 1];
      if (endOn) {
        const side = Math.sign(ds) || 1;
        this.opening(w, at(side * (L + 0.03), 0, floor + 0.02), ...endN(side), Math.min(1.15, W - 0.2), 2.0, cell, null);
      } else this.opening(w, at(0, front * (W + 0.03), floor + 0.02), ...sideN(front), Math.min(1.15, L - 0.2), 2.0, cell, null);
      return;
    }
    const win = WINDOWS[Math.floor(look * WINDOWS.length)];
    const porch = look * 7 % 1 < 0.45 ? 'porch' : 'door';
    for (const side of [-1, 1]) {
      const t = side * (W + 0.03);
      for (let lv = 0; lv < levels; lv++) {
        for (let k = 0; k < n; k++) {
          const s = -L + ((k + 0.5) * 2 * L) / n;
          const yb = floor + 0.95 + lv * storey;
          if (lv === 0 && side === front && k === doorAt) {
            this.opening(w, at(s, t, floor + 0.02), ...sideN(side), 0.5, 2.05, DOOR_CELLS[Math.floor(rng() * DOORS.length)], porch);
            continue;
          }
          this.opening(w, at(s, t, yb), ...sideN(side), 0.6, 1.2, win, 'sill');
        }
      }
      if (side === front && doorAt < 0) this.opening(w, at(0, t, floor + 0.02), ...sideN(side), 0.5, 2.05, DOOR_CELLS[Math.floor(rng() * DOORS.length)], porch);
    }
    if (endOn) {
      // The front door in the end wall facing the road, a window beside it if there's room, and one above on each storey.
      const side = Math.sign(ds) || 1;
      const s = side * (L + 0.03);
      const end = (t: number, yb: number, hw: number, h: number, cell: Cell, trim: Trim) => this.opening(w, at(s, t, yb), ...endN(side), hw, h, cell, trim);
      const wide = W > 2.6;
      end(wide ? -W * 0.4 : 0, floor + 0.02, 0.5, 2.05, DOOR_CELLS[Math.floor(rng() * DOORS.length)], porch);
      if (wide) end(W * 0.4, floor + 0.95, 0.6, 1.2, win, 'sill');
      for (let lv = 1; lv < levels; lv++) end(0, floor + 0.95 + lv * storey, 0.6, 1.2, win, 'sill');
    }
  }

  /**
   * A window or door on a wall that faces (nx, nz): `base` is the middle of its foot, just out from
   * the wall, and it's `hw` half wide and `h` tall. A window gets a sill under it; a front door a
   * step, and with 'porch' a little canopy over it on brackets.
   */
  private opening(w: Writer, base: THREE.Vector3, nx: number, nz: number, hw: number, h: number, cell: Cell, trim: Trim): void {
    // Along the wall, left to right seen from outside.
    const ux = nz, uz = -nx;
    const p = (s: number, y: number) => new THREE.Vector3(base.x + ux * s, base.y + y, base.z + uz * s);
    this.openings.quad(p(-hw, 0), p(hw, 0), p(hw, h), p(-hw, h), cell);
    if (!trim) return;
    // Boxes standing out from the wall's face (0.03 behind the window).
    const box = (hl: number, out: number, y0: number, y1: number, color: number, under = false, ends = true) => {
      const q = (s: number, o: number, y: number) => new THREE.Vector3(base.x + ux * s + nx * (o - 0.03), base.y + y, base.z + uz * s + nz * (o - 0.03));
      w.quad(q(-hl, out, y0), q(hl, out, y0), q(hl, out, y1), q(-hl, out, y1), color);
      w.quad(q(-hl, out, y1), q(hl, out, y1), q(hl, 0, y1), q(-hl, 0, y1), color);
      if (ends) {
        w.quad(q(-hl, 0, y0), q(-hl, out, y0), q(-hl, out, y1), q(-hl, 0, y1), color);
        w.quad(q(hl, out, y0), q(hl, 0, y0), q(hl, 0, y1), q(hl, out, y1), color);
      }
      if (under) w.quad(q(-hl, 0, y0), q(hl, 0, y0), q(hl, out, y0), q(-hl, out, y0), color);
    };
    if (trim === 'sill') {
      box(hw + 0.07, 0.11, -0.07, 0, 0xe4e2dc, false, false);
      return;
    }
    // A concrete step at the door.
    box(hw + 0.2, 0.42, -0.3, 0, 0xb0aea6);
    if (trim === 'porch') {
      // A canopy: a sloping slate top on a white fascia, held up by two brackets.
      box(hw + 0.35, 0.75, h + 0.12, h + 0.24, 0xeeeeea, true);
      const q = (s: number, o: number, y: number) => new THREE.Vector3(base.x + ux * s + nx * (o - 0.03), base.y + y, base.z + uz * s + nz * (o - 0.03));
      w.quad(q(-hw - 0.4, 0.8, h + 0.24), q(hw + 0.4, 0.8, h + 0.24), q(hw + 0.4, 0, h + 0.55), q(-hw - 0.4, 0, h + 0.55), 0x4e5664);
      for (const s of [-hw - 0.25, hw + 0.25]) {
        w.tri(q(s - 0.04, 0, h - 0.35), q(s - 0.04, 0.6, h + 0.12), q(s - 0.04, 0, h + 0.12), 0xeeeeea);
        w.tri(q(s + 0.04, 0, h - 0.35), q(s + 0.04, 0, h + 0.12), q(s + 0.04, 0.6, h + 0.12), 0xeeeeea);
      }
    }
  }

  /** A wall quad, and (unless it's a chimney) the same two triangles in the collider. */
  private wall(w: Writer, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: number, solid = true): void {
    w.quad(a, b, c, d, color);
    if (solid) this.colliderTris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }

  private solid(w: Writer, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: number): void {
    w.tri(a, b, c, color);
    this.colliderTris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  private roofQuad(w: Writer, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: number): void {
    w.quad(a, b, c, d, color);
    // The underside too, so the overhang isn't see-through from below.
    w.quad(d, c, b, a, 0x3a3a38);
    this.colliderTris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }

  private roofTri(w: Writer, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: number): void {
    w.tri(a, b, c, color);
    w.tri(c, b, a, 0x3a3a38);
    this.colliderTris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  /** Windows along each wall long enough for them, on every storey. */
  private windowsAround(w: Writer, pts: Pt[], floor: number, levels: number, storey: number, cell: Cell): void {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 2.6) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      // Just out from the wall: the way it faces is (-uz, ux).
      const nx = -uz, nz = ux;
      const n = Math.max(1, Math.floor(len / 3.1));
      for (let lv = 0; lv < levels; lv++) {
        for (let k = 0; k < n; k++) {
          const m = ((k + 0.5) * len) / n;
          const yb = floor + 0.95 + lv * storey;
          this.opening(w, new THREE.Vector3(a.x + ux * m + nx * 0.03, yb, a.z + uz * m + nz * 0.03), nx, nz, 0.6, 1.2, cell, 'sill');
        }
      }
    }
  }

  /** A door in the middle of the wall nearest `street`. */
  private doorOnNearestEdge(w: Writer, pts: Pt[], street: Pt, floor: number, half: number, h: number, cell: Cell, trim: Trim): void {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.hypot(b.x - a.x, b.z - a.z) < half * 2 + 0.4) continue;
      const d = segDist(street, a, b).d;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    const a = pts[best], b = pts[(best + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const m = len / 2;
    this.opening(w, new THREE.Vector3(a.x + ux * m - uz * 0.04, floor + 0.02, a.z + uz * m + ux * 0.04), -uz, ux, half, h, cell, trim);
  }

  /**
   * Mauricewood Primary: its blocks are traced from aerial photos (they aren't on the map) and
   * built with the other buildings (`schoolStyle`). Here go the sign over the side facing Muirhead
   * Place, the flagpole on the playground, and the spots round it all for its defenders.
   */
  private buildSchool(): School {
    const blocks = this.town.buildings.filter((b) => b.kind.startsWith('school-'));
    const all = blocks.flatMap((b) => b.pts);
    const c = centroid(all);
    // The sign: on the longest wall of the main block that faces north-west, toward Muirhead Place.
    const main = blocks.find((b) => b.kind === 'school-dark') ?? blocks[0];
    let pts = main.pts;
    if (polyArea(pts) > 0) pts = [...pts].reverse();
    let best = { score: -Infinity, a: pts[0], b: pts[1], nx: 0, nz: 0 };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      const score = (-nx - nz) * len;
      if (score > best.score) best = { score, a, b, nx, nz };
    }
    const mid = { x: (best.a.x + best.b.x) / 2, z: (best.a.z + best.b.z) / 2 };
    let top = -Infinity;
    for (const p of main.pts) top = Math.max(top, this.ground(p));
    const sign = this.schoolSign();
    sign.position.set(mid.x + best.nx * 0.08, top + SCHOOL_STYLE.dark.h - 1.1, mid.z + best.nz * 0.08);
    sign.lookAt(sign.position.clone().add(new THREE.Vector3(best.nx, 0, best.nz)));
    this.group.add(sign);

    // The flagpole on the playground, toward its corner by the buildings.
    const court = this.town.areas.find((a) => a.kind === 'court');
    const cc = court ? centroid(court.pts) : { x: c.x + 15, z: c.z };
    const poleAt = { x: cc.x + (c.x - cc.x) * 0.25, z: cc.z + (c.z - cc.z) * 0.25 };
    const py = this.ground(poleAt);
    const p = new PartBuilder();
    p.add(new THREE.CylinderGeometry(0.09, 0.12, 11, 10), plastic(0xdedede), poleAt.x, py + 5.5, poleAt.z);
    p.add(new THREE.SphereGeometry(0.18, 10, 8), plastic(0xd4a017), poleAt.x, py + 11.1, poleAt.z);
    p.add(new THREE.CylinderGeometry(0.7, 0.8, 0.4, 12), plastic(0x9a9a92), poleAt.x, py + 0.1, poleAt.z);
    p.buildInto(this.group);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4).translate(1.15, 0, 0), new THREE.MeshStandardMaterial({ color: 0x4b7a2e, side: THREE.DoubleSide }));
    flag.position.set(poleAt.x, py + 1.2, poleAt.z);
    flag.rotation.y = Math.atan2(cc.z - c.z, c.x - cc.x);
    this.group.add(flag);

    // Defenders: on the playground, the lawn and the yard, and a ring round the buildings.
    const posts: Pt[] = [];
    for (const a of this.town.areas) if (a.kind === 'court' || a.kind === 'lawn' || a.kind === 'yard') posts.push(centroid(a.pts));
    if (court) for (const q of court.pts) posts.push({ x: q.x + (cc.x - q.x) * 0.3, z: q.z + (cc.z - q.z) * 0.3 });
    // Two rings of them: one out round the grounds and one in close by the walls.
    for (const [n, r0, r1, turn] of [[24, 26, 45, 0], [14, 14, 26, 0.5]]) {
      for (let i = 0; i < n && posts.length < 34; i++) {
        const ang = ((i + turn) / n) * Math.PI * 2;
        for (let r = r0; r < r1; r += 3) {
          const q = { x: c.x + Math.cos(ang) * r, z: c.z + Math.sin(ang) * r };
          if (this.clear(q, 1)) {
            posts.push(q);
            break;
          }
        }
      }
    }
    return {
      centre: c,
      pole: new THREE.Vector3(poleAt.x, py, poleAt.z),
      flag,
      raise: (k: number) => (flag.position.y = py + 1.2 + Math.max(0, Math.min(1, k)) * 9.4),
      posts: posts.filter((q) => !this.footprints.hit(q, 0.6)),
    };
  }

  private schoolSign(): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 128;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#1f4a8a';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 64px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MAURICEWOOD PRIMARY SCHOOL', 512, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), new THREE.MeshBasicMaterial({ map: tex }));
  }

  /** Whether there's open ground `r` metres round a spot: no buildings, roads, back gardens or trees' worth of crowding (for a prisoner pen). */
  openSpot(p: Pt, r: number): boolean {
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) {
      const q = { x: p.x + dx, z: p.z + dz };
      if (Math.abs(q.x) > this.town.half - 20 || Math.abs(q.z) > this.town.half - 20) return false;
      if (!this.clear(q, 2) || this.gardenGrid.hit(q, 1)) return false;
    }
    return true;
  }

  /**
   * An enemy prisoner pen at `at`, its gate toward `toward` (the nearest road). The cage: bars with
   * spiked tops on a concrete footing, rails at the top, middle and bottom, X-braces between the
   * posts, angled arms carrying coils of barbed wire along the top, and a braced gate with a padlock
   * and chain that swings open. Inside, a corrugated-tin shelter over a bunk, a bucket and a blanket.
   * Outside, a watchtower (legs and braces, a ladder, a boarded platform, a tin roof and a searchlight
   * trained on the cage), a plank guard hut with a door, window and stovepipe, a table and stools by
   * a glowing brazier, sandbags, a lamp post, a sign and the army's flag. The bars stop you walking
   * but not seeing or shooting through them.
   */
  pen(at: Pt, toward: Pt, color: number): Pen {
    const p = new PartBuilder();
    let fx = toward.x - at.x, fz = toward.z - at.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    const yaw = Math.atan2(-fx, -fz);
    // s across the front, t toward the gate (and the road).
    const P = (s: number, t: number): Pt => ({ x: at.x - fz * s + fx * t, z: at.z + fx * s + fz * t });
    const G = (s: number, t: number) => this.ground(P(s, t));
    const W = (s: number, t: number, y: number, ground = G(s, t)) => {
      const q = P(s, t);
      return new THREE.Vector3(q.x, ground + y, q.z);
    };
    const rot = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
    const euler = new THREE.Euler();
    const quat = new THREE.Quaternion();
    const mat4 = new THREE.Matrix4();
    const ONE = new THREE.Vector3(1, 1, 1);
    /** A part at (s, t), `y` above the ground there (or `ground`), turned `ry` from the pen's facing and tilted `rx` (nose up) and `rz`. */
    const put = (geo: THREE.BufferGeometry, m: THREE.Material, s: number, t: number, y: number, ry = 0, rx = 0, rz = 0, ground = G(s, t)) => {
      euler.set(rx, yaw + ry, rz, 'YXZ');
      quat.setFromEuler(euler);
      mat4.compose(W(s, t, y, ground), quat, ONE);
      p.addMatrix(geo, m, mat4);
    };
    /** A part pointed along `dir` (its own +Y), centred at `c`. */
    const along = (geo: THREE.BufferGeometry, m: THREE.Material, c: THREE.Vector3, dir: THREE.Vector3) => {
      quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      mat4.compose(c, quat, ONE);
      p.addMatrix(geo, m, mat4);
    };

    const H = 3.5, GATE = 0.85, BAR_H = 2.5;
    const steel = plastic(0x50555a), post = plastic(0x3a3d40), concrete = plastic(0xa8a59c), wire = plastic(0x5b5f63);
    const wood = plastic(0x6b4a2e), woodLight = plastic(0x7d5a38), woodDark = plastic(0x4f3622), tin = plastic(0x8d9396), tinDark = plastic(0x6f7578);
    const glow = new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff7a20, emissiveIntensity: 1.6 });
    const bar = new THREE.CylinderGeometry(0.035, 0.035, BAR_H, 5);
    const spike = new THREE.ConeGeometry(0.055, 0.16, 5);
    const barb = new THREE.BoxGeometry(0.12, 0.011, 0.011);
    const UP = new THREE.Vector3(0, 1, 0);

    /** A coil of barbed wire from `a` to `b`, `r` across, with barbs. */
    const coil = (a: THREE.Vector3, b: THREE.Vector3, r: number, phase: number) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      dir.normalize();
      const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
      const up2 = new THREE.Vector3().crossVectors(side, dir).normalize();
      const turns = Math.max(3, Math.round(len / 0.3));
      const helix = (u: number) => {
        const th = Math.PI * 2 * turns * u + phase;
        const rr = r * (1 + 0.08 * Math.sin(th * 0.37 + phase));
        return a.clone().addScaledVector(dir, len * u).addScaledVector(side, Math.cos(th) * rr).addScaledVector(up2, Math.sin(th) * rr);
      };
      const steps = turns * 12;
      p.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: steps + 1 }, (_, j) => helix(j / steps))), steps, 0.014, 3, false), wire);
      const n = Math.round((turns * Math.PI * 2 * r) / 0.5);
      for (let j = 0; j < n; j++) {
        const q = helix((j + 0.5) / n);
        p.add(barb, wire, q.x, q.y, q.z, j * 1.3, j * 0.7, 0.8);
        p.add(barb, wire, q.x, q.y, q.z, j * 1.3 + 1.2, j * 0.7 + 1.5, -0.8);
      }
    };

    // ---- the cage ----
    const side = (s0: number, t0: number, s1: number, t1: number, posts: number) => {
      const len = Math.hypot(s1 - s0, t1 - t0);
      const ns = (t1 - t0) / len, nt = -(s1 - s0) / len; // outward
      const at2 = (k: number) => [s0 + (s1 - s0) * k, t0 + (t1 - t0) * k] as const;
      // Bars with spiked tops, on a concrete footing.
      const n = Math.round(len / 0.3);
      for (let j = 0; j <= n; j++) {
        const [s, t] = at2(j / n);
        put(bar, steel, s, t, BAR_H / 2 + 0.1);
        put(spike, steel, s, t, BAR_H + 0.18);
      }
      p.beam(W(s0, t0, 0.12), W(s1, t1, 0.12), 0.3, concrete);
      for (const h of [BAR_H - 0.05, 1.3, 0.38]) p.beam(W(s0, t0, h), W(s1, t1, h), 0.07, post);
      // Posts, X-braces between them on the outside, and the arms and wire along the top.
      const tips: THREE.Vector3[] = [];
      for (let k = 0; k <= posts; k++) {
        const [s, t] = at2(k / posts);
        put(new THREE.BoxGeometry(0.16, BAR_H + 0.35, 0.16), post, s, t, (BAR_H + 0.35) / 2);
        const base = W(s, t, BAR_H + 0.25);
        const tip = W(s + ns * 0.55, t + nt * 0.55, BAR_H + 0.8);
        p.beam(base, tip, 0.06, post);
        tips.push(tip);
        if (k < posts) {
          const [s2, t2] = at2((k + 1) / posts);
          const o = 0.09;
          p.beam(W(s + ns * o, t + nt * o, 0.45), W(s2 + ns * o, t2 + nt * o, BAR_H - 0.15), 0.05, post);
          p.beam(W(s2 + ns * o, t2 + nt * o, 0.45), W(s + ns * o, t + nt * o, BAR_H - 0.15), 0.05, post);
        }
      }
      coil(tips[0], tips[tips.length - 1], 0.3, s0 + t0);
      for (const dy of [-0.15, 0.15]) p.beam(tips[0].clone().setY(tips[0].y + dy), tips[tips.length - 1].clone().setY(tips[tips.length - 1].y + dy), 0.012, wire, true);
      const mid = P((s0 + s1) / 2, (t0 + t1) / 2);
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(len / 2, 1.3, 0.15).setTranslation(mid.x, G((s0 + s1) / 2, (t0 + t1) / 2) + 1.25, mid.z).setRotation(rot(yaw + Math.atan2(t1 - t0, s1 - s0))).setCollisionGroups(WATER_GROUPS),
        this.body,
      );
    };
    side(-H, -H, H, -H, 2);
    side(H, -H, H, H, 2);
    side(-H, H, -H, -H, 2);
    side(H, H, GATE, H, 1);
    side(-GATE, H, -H, H, 1);

    // The ground: trodden dirt, darker where they pace inside.
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x7d6a4e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(H * 1.75, 24).rotateX(-Math.PI / 2), dirtMat);
    dirt.position.set(at.x, this.ground(at) + 0.06, at.z);
    dirt.receiveShadow = true;
    this.group.add(dirt);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(H * 0.95, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5f5038, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    inner.position.set(at.x, this.ground(at) + 0.07, at.z);
    inner.receiveShadow = true;
    this.group.add(inner);

    // ---- inside: a tin shelter over a bunk, a bucket and a blanket ----
    for (const [s, t, h] of [[-2.9, -3.1, 2.2], [2.9, -3.1, 2.2], [-2.9, -0.9, 2.5], [2.9, -0.9, 2.5]]) put(new THREE.BoxGeometry(0.1, h, 0.1), wood, s, t, h / 2);
    const slope = Math.atan2(0.35, 2.75);
    const roofG = G(0, -2);
    put(new THREE.BoxGeometry(6.6, 0.04, 2.95), tin, 0, -1.98, 2.34, 0, slope, 0, roofG);
    const ridge = new THREE.CylinderGeometry(0.035, 0.035, 2.95, 4).rotateX(Math.PI / 2);
    for (let s = -3.2; s <= 3.2; s += 0.24) put(ridge, tinDark, s, -1.98, 2.37, 0, slope, 0, roofG);
    put(new THREE.BoxGeometry(2.0, 0.08, 0.85), wood, -1.5, -2.5, 0.45);
    for (const [ds, dt] of [[-0.95, -0.38], [0.95, -0.38], [-0.95, 0.38], [0.95, 0.38]]) put(new THREE.BoxGeometry(0.07, 0.45, 0.07), woodDark, -1.5 + ds, -2.5 + dt, 0.22);
    put(new THREE.BoxGeometry(1.85, 0.13, 0.72), plastic(0x8a8f6a), -1.5, -2.5, 0.56);
    put(new THREE.BoxGeometry(0.9, 0.06, 0.74), plastic(0x6a4a3a), -1.1, -2.5, 0.65);
    put(new THREE.CylinderGeometry(0.19, 0.15, 0.34, 12), plastic(0x7b8287), 2.2, -2.5, 0.17);
    put(new THREE.TorusGeometry(0.17, 0.012, 4, 12, Math.PI), plastic(0x55595d), 2.2, -2.5, 0.34);
    put(new THREE.BoxGeometry(1.6, 0.16, 0.9), plastic(0xc9b26a), 1.4, -1.6, 0.1, 0.3);

    // ---- the gate: braced, padlocked, with its own bars, and its own collider until it opens ----
    const door = new THREE.Group();
    const dp = new PartBuilder();
    const dn = 6;
    for (let j = 0; j <= dn; j++) {
      dp.add(bar, steel, (j / dn) * GATE * 2, BAR_H / 2 + 0.1, 0);
      dp.add(spike, steel, (j / dn) * GATE * 2, BAR_H + 0.18, 0);
    }
    for (const h of [BAR_H - 0.05, 1.3, 0.38]) dp.beam(new THREE.Vector3(0, h, 0), new THREE.Vector3(GATE * 2, h, 0), 0.08, post);
    dp.beam(new THREE.Vector3(0.05, 0.4, 0), new THREE.Vector3(GATE * 2 - 0.05, BAR_H - 0.1, 0), 0.06, post);
    dp.add(new THREE.BoxGeometry(0.12, 0.14, 0.06), plastic(0xb08d2a), GATE * 2 - 0.1, 1.15, 0.07);
    dp.add(new THREE.TorusGeometry(0.045, 0.012, 4, 10, Math.PI), plastic(0x9a9ea2), GATE * 2 - 0.1, 1.22, 0.07);
    for (let j = 0; j < 5; j++) dp.add(new THREE.TorusGeometry(0.035, 0.01, 4, 8), plastic(0x9a9ea2), GATE * 2 - 0.02, 1.0 + j * 0.06, 0.04, 0, j % 2 ? Math.PI / 2 : 0);
    dp.buildInto(door);
    door.position.copy(W(-GATE, H, 0));
    door.rotation.y = yaw;
    this.group.add(door);
    const gq = P(0, H);
    const gate = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(GATE, 1.3, 0.15).setTranslation(gq.x, G(0, H) + 1.25, gq.z).setRotation(rot(yaw)).setCollisionGroups(WATER_GROUPS),
      this.body,
    );

    // ---- the watchtower, off the back corner ----
    const ts = H + 2.4, tt = -H - 2.4, tg = G(ts, tt);
    const leg = (cs: number, ct: number, h: number) => {
      const o = 1.1 - (0.2 * (h + 0.2)) / 4.4;
      return W(ts + cs * o, tt + ct * o, h, tg);
    };
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [cs, ct] of corners) {
      p.beam(leg(cs, ct, -0.2), leg(cs, ct, 4.2), 0.16, wood);
      const c = leg(cs, ct, 2);
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(2.2, 0.12).setTranslation(c.x, tg + 2, c.z), this.body);
    }
    for (let k = 0; k < 4; k++) {
      const [a0, b0] = corners[k], [a1, b1] = corners[(k + 1) % 4];
      p.beam(leg(a0, b0, 0.5), leg(a1, b1, 3.7), 0.08, woodLight);
      p.beam(leg(a1, b1, 0.5), leg(a0, b0, 3.7), 0.08, woodLight);
      p.beam(leg(a0, b0, 2.1), leg(a1, b1, 2.1), 0.08, woodLight);
    }
    put(new THREE.BoxGeometry(2.4, 0.14, 2.4), woodDark, ts, tt, 4.25, 0, 0, 0, tg);
    for (let j = 0; j < 8; j++) put(new THREE.BoxGeometry(2.4, 0.03, 0.26), j % 2 ? wood : woodLight, ts, tt - 1.05 + j * 0.3, 4.33, 0, 0, 0, tg);
    // Boarded walls round three sides (the ladder side open), corner posts and a tin roof.
    for (let j = 0; j < 3; j++) {
      const y = 4.5 + j * 0.24;
      put(new THREE.BoxGeometry(2.4, 0.2, 0.05), j % 2 ? wood : woodLight, ts, tt - 1.18, y, 0, 0, 0, tg);
      put(new THREE.BoxGeometry(0.05, 0.2, 2.4), j % 2 ? woodLight : wood, ts - 1.18, tt, y, 0, 0, 0, tg);
      put(new THREE.BoxGeometry(0.05, 0.2, 2.4), j % 2 ? woodLight : wood, ts + 1.18, tt, y, 0, 0, 0, tg);
    }
    for (const [cs, ct] of corners) put(new THREE.BoxGeometry(0.1, 2.1, 0.1), wood, ts + cs * 1.12, tt + ct * 1.12, 5.35, 0, 0, 0, tg);
    p.beam(W(ts - 1.12, tt + 1.12, 5.0, tg), W(ts + 1.12, tt + 1.12, 5.0, tg), 0.07, wood);
    put(new THREE.ConeGeometry(1.95, 0.8, 4, 1, true), tin, ts, tt, 6.8, Math.PI / 4, 0, 0, tg);
    put(new THREE.BoxGeometry(2.3, 0.06, 2.3), tinDark, ts, tt, 6.4, 0, 0, 0, tg);
    // The ladder up the side facing the gate.
    const lb = (dx: number, h: number) => W(ts + dx, tt + 1.65 - (0.45 * h) / 4.3, h, tg);
    for (const dx of [-0.3, 0.3]) p.beam(lb(dx, -0.1), lb(dx, 4.4), 0.06, woodLight);
    for (let h = 0.3; h < 4.3; h += 0.34) p.beam(lb(-0.3, h), lb(0.3, h), 0.04, woodLight);
    // The searchlight on the platform corner nearest the cage, trained on it.
    const light = W(ts - 0.9, tt + 0.9, 5.15, tg);
    const aim = W(0, 0, 0.6).sub(light).normalize();
    put(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), post, ts - 0.9, tt + 0.9, 4.75, 0, 0, 0, tg);
    along(new THREE.CylinderGeometry(0.24, 0.2, 0.5, 14), steel, light, aim);
    along(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 14), glow, light.clone().addScaledVector(aim, 0.26), aim);

    // ---- the guard hut, beside the gate ----
    const hs = -H - 3.6, ht = H - 0.6, hg = G(hs, ht);
    put(new THREE.BoxGeometry(2.6, 2.3, 2.2), woodDark, hs, ht, 1.1, 0, 0, 0, hg);
    for (let y = 0.15, k = 0; y < 2.25; y += 0.27, k++) {
      const m = k % 2 ? wood : woodLight;
      put(new THREE.BoxGeometry(2.66, 0.23, 0.04), m, hs, ht + 1.12, y, 0, 0, 0, hg);
      put(new THREE.BoxGeometry(2.66, 0.23, 0.04), m, hs, ht - 1.12, y, 0, 0, 0, hg);
      put(new THREE.BoxGeometry(0.04, 0.23, 2.26), m, hs - 1.32, ht, y, 0, 0, 0, hg);
      put(new THREE.BoxGeometry(0.04, 0.23, 2.26), m, hs + 1.32, ht, y, 0, 0, 0, hg);
    }
    put(new THREE.BoxGeometry(0.85, 1.95, 0.07), plastic(0x3e4a2e), hs + 0.55, ht + 1.16, 0.98, 0, 0, 0, hg);
    put(new THREE.SphereGeometry(0.05, 6, 4), plastic(0xb08d2a), hs + 0.85, ht + 1.21, 1.0, 0, 0, 0, hg);
    put(new THREE.BoxGeometry(0.06, 0.62, 0.86), plastic(0x2a3a48), hs + 1.36, ht - 0.2, 1.45, 0, 0, 0, hg);
    for (const [dy, dt, hgt, wid] of [[0.34, 0, 0.06, 1.0], [-0.34, 0, 0.06, 1.0], [0, 0.46, 0.74, 0.06], [0, -0.46, 0.74, 0.06], [0, 0, 0.74, 0.04]]) {
      put(new THREE.BoxGeometry(0.08, hgt, wid), woodLight, hs + 1.38, ht - 0.2 + dt, 1.45 + dy, 0, 0, 0, hg);
    }
    put(new THREE.BoxGeometry(3.1, 0.06, 2.8), tin, hs, ht, 2.48, 0, 0.12, 0, hg);
    put(new THREE.CylinderGeometry(0.08, 0.08, 1.3, 8), post, hs - 0.8, ht - 0.6, 2.95, 0, 0, 0, hg);
    put(new THREE.ConeGeometry(0.16, 0.18, 8), post, hs - 0.8, ht - 0.6, 3.68, 0, 0, 0, hg);
    {
      const c = P(hs, ht);
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(1.32, 1.2, 1.12).setTranslation(c.x, hg + 1.15, c.z).setRotation(rot(yaw)), this.body);
    }

    // ---- the guards' corner: sandbags, a brazier, a table and stools, a lamp, a sign, the flag ----
    const bag = sandbagGeometry();
    const bagMat = plastic(0xb5a47a), bagDark = plastic(0xa39368);
    for (let j = 0; j < 6; j++) {
      const s = 2.0 + j * 0.85, t = H + 2.4 + (j - 2.5) * (j - 2.5) * 0.07;
      for (let row = 0; row < 3; row++) put(bag, row % 2 ? bagDark : bagMat, s, t, 0.2 + row * 0.38, (j - 2.5) * -0.08 + (row % 2) * 0.05);
    }
    put(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 12), plastic(0x6a3a2a), -2.6, H + 2.2, 0.44);
    for (let j = 0; j < 4; j++) put(new THREE.ConeGeometry(0.1 + (j % 2) * 0.05, 0.4 + j * 0.08, 6), glow, -2.6 + Math.cos(j * 1.7) * 0.1, H + 2.2 + Math.sin(j * 1.7) * 0.1, 1.05, j);
    put(new THREE.BoxGeometry(1.2, 0.06, 0.8), woodLight, -4.3, H + 2.8, 0.76);
    for (const [ds, dt] of [[-0.52, -0.32], [0.52, -0.32], [-0.52, 0.32], [0.52, 0.32]]) put(new THREE.BoxGeometry(0.06, 0.74, 0.06), woodDark, -4.3 + ds, H + 2.8 + dt, 0.37);
    for (const ds of [-0.95, 0.95]) put(new THREE.CylinderGeometry(0.2, 0.18, 0.45, 10), wood, -4.3 + ds, H + 2.8, 0.22);
    for (let j = 0; j < 5; j++) put(new THREE.BoxGeometry(0.09, 0.005, 0.13), plastic(0xf4f2ea), -4.45 + j * 0.08, H + 2.75 + (j % 2) * 0.05, 0.8, j * 0.4);
    for (const [ds, dt] of [[0.35, 0.2], [-0.4, -0.18]]) put(new THREE.CylinderGeometry(0.05, 0.045, 0.11, 8), plastic(0xd8dcd8), -4.3 + ds, H + 2.8 + dt, 0.84);
    // The lamp over the gate.
    put(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 8), post, GATE + 0.7, H + 0.7, 1.7);
    p.beam(W(GATE + 0.7, H + 0.7, 3.3), W(0.5, H + 0.7, 3.3), 0.05, post);
    put(new THREE.ConeGeometry(0.22, 0.18, 10, 1, true), plastic(0x3c4a32), 0.5, H + 0.7, 3.2);
    put(new THREE.SphereGeometry(0.08, 8, 6), glow, 0.5, H + 0.7, 3.12);
    // The sign by the gate.
    put(new THREE.BoxGeometry(0.08, 1.7, 0.08), wood, -GATE - 1.3, H + 0.5, 0.85);
    put(new THREE.BoxGeometry(0.08, 1.7, 0.08), wood, -GATE - 2.5, H + 0.5, 0.85);
    const fq = P(H + 0.8, -H);
    p.add(new THREE.CylinderGeometry(0.06, 0.06, 4.5, 8), plastic(0x6b4a2e), fq.x, G(H + 0.8, -H) + 2.25, fq.z);
    p.buildInto(this.group);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), new THREE.MeshStandardMaterial({ map: penSign(), roughness: 0.8 }));
    sign.position.copy(W(-GATE - 1.9, H + 0.55, 1.35));
    sign.rotation.y = yaw + Math.PI;
    this.group.add(sign);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9).translate(0.72, 0, 0), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
    flag.position.set(fq.x, G(H + 0.8, -H) + 4, fq.z);
    flag.rotation.y = yaw;
    this.group.add(flag);

    let opened = false;
    const guards: Pt[] = [];
    for (const [s, t] of [[3.2, H + 3.6], [-1.6, H + 3.4], [H + 2.4, 0.5], [-H - 2.4, -1.5]]) {
      const q = P(s, t);
      guards.push(this.clear(q, 0.5) ? q : P(0, H + 3));
    }
    return {
      at,
      gate: P(0, H + 1.1),
      inside: [P(-1.2, -0.4), P(1.2, 0.5)],
      guards,
      open: () => {
        if (opened) return;
        opened = true;
        // Swung right back against the bars.
        door.rotation.y = yaw + 1.9;
        this.world.removeCollider(gate, false);
      },
    };
  }

  /** Whether a spot is clear of buildings and roads (for a tree or a soldier's post). */
  clear(p: Pt, margin = 1): boolean {
    const road = this.roads.nearest(p);
    if (road && road.d < margin) return false;
    return !this.footprints.hit(p, margin);
  }

  /** The nearest point on the middle of a road, if one is within about 20 m. */
  nearestRoad(p: Pt): Pt | null {
    return this.roads.nearest(p)?.at ?? null;
  }

  /** Trees in the woods, along tree rows and in about a third of the gardens. */
  private trees(rng: () => number): void {
    const spots: { p: Pt; conifer: boolean; size: number }[] = [];
    for (const a of this.town.areas) {
      if (a.kind === 'wood' || a.kind === 'scrub') {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const p of a.pts) {
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
        }
        const gap = a.kind === 'wood' ? 6.5 : 11;
        for (let x = x0; x < x1; x += gap) for (let z = z0; z < z1; z += gap) {
          const p = { x: x + (rng() - 0.5) * gap * 0.8, z: z + (rng() - 0.5) * gap * 0.8 };
          if (inPolygon(p, a.pts) && this.clear(p, 1.5)) spots.push({ p, conifer: rng() < 0.3, size: a.kind === 'wood' ? 0.9 + rng() * 0.6 : 0.55 + rng() * 0.3 });
        }
      } else if (a.kind === 'garden' && rng() < 0.35) {
        for (let tries = 0; tries < 6; tries++) {
          let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (const p of a.pts) {
            x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
          }
          const p = { x: x0 + rng() * (x1 - x0), z: z0 + rng() * (z1 - z0) };
          if (inPolygon(p, a.pts) && this.clear(p, 2)) {
            spots.push({ p, conifer: rng() < 0.2, size: 0.55 + rng() * 0.35 });
            break;
          }
        }
      }
    }
    // Trees traced from aerial photos round the school.
    for (const t of this.town.trees) spots.push({ p: t, conifer: false, size: 0.9 + rng() * 0.4 });
    for (const l of this.town.lines) {
      if (l.kind !== 'trees') continue;
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1], b = l.pts[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        for (let m = 0; m < len; m += 7) {
          const p = { x: a.x + ((b.x - a.x) * m) / len, z: a.z + ((b.z - a.z) * m) / len };
          if (this.clear(p, 1)) spots.push({ p, conifer: false, size: 0.8 + rng() * 0.4 });
        }
      }
    }
    // Rows of young trees planted either side of the path along the old railway line near the start.
    const gardens = this.gardenGrid;
    for (const g of this.gardenLines) gardens.add(g.pts);
    const rail = this.railwayPath();
    if (rail) {
      for (let i = 1; i < rail.length; i++) {
        const a = rail[i - 1], b = rail[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        for (let m = 0; m < len; m += 3.5) {
          for (const side of [-1, 1]) {
            if (rng() > 0.7) continue;
            const off = side * (4 + rng() * 6);
            const p = { x: a.x + ux * m - uz * off + (rng() - 0.5), z: a.z + uz * m + ux * off + (rng() - 0.5) };
            if (this.clear(p, 1.2) && !gardens.hit(p, 1)) spots.push({ p, conifer: false, size: 0.32 + rng() * 0.15 });
          }
        }
      }
    }
    const n = spots.length;
    this.count.trees = n;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1, 6, 1, true).translate(0, 0.5, 0), withDetail(new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.95 }), 'bark'), n);
    const leafy = spots.filter((s) => !s.conifer);
    const pines = spots.filter((s) => s.conifer);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), withDetail(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 'leaves'), leafy.length);
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0), withDetail(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 'leaves'), pines.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let li = 0, pi = 0;
    spots.forEach((s, i) => {
      const y = this.ground(s.p) - 0.2;
      const h = (s.conifer ? 3 : 2.6) * s.size;
      m.compose(new THREE.Vector3(s.p.x, y, s.p.z), q, new THREE.Vector3(s.size * 1.2, h + 0.4, s.size * 1.2));
      trunk.setMatrixAt(i, m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      if (s.conifer) {
        m.compose(new THREE.Vector3(s.p.x, y + h * 0.5, s.p.z), q, new THREE.Vector3(2.2 * s.size, 7.5 * s.size, 2.2 * s.size));
        cone.setMatrixAt(pi, m);
        cone.setColorAt(pi++, col.setHSL(0.33 + rng() * 0.04, 0.45, 0.2 + rng() * 0.06));
      } else {
        const r = 2.4 * s.size * (0.85 + rng() * 0.3);
        m.compose(new THREE.Vector3(s.p.x, y + h + r * 0.7, s.p.z), q, new THREE.Vector3(r, r * 0.9, r));
        crown.setMatrixAt(li, m);
        crown.setColorAt(li++, col.setHSL(0.24 + rng() * 0.08, 0.5, 0.28 + rng() * 0.1));
      }
      q.identity();
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(2, 0.3 * s.size).setTranslation(s.p.x, y + 2, s.p.z), this.body);
    });
    for (const im of [trunk, crown, cone]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  /**
   * A fenced back garden behind every house: the side away from its street, as wide as the house,
   * running back until just short of the next building or a road (up to 14 m). Gardens less than
   * 3 m deep are left out. Side fences sit a hair inside the house's width, so the fences of two
   * semis back to back don't land on top of each other.
   */
  private gardens(): void {
    for (const { r, street } of this.plots) {
      const dx = street.x - r.c.x, dz = street.z - r.c.z;
      const ds = dx * r.ux + dz * r.uz;
      const dt = -dx * r.uz + dz * r.ux;
      // Out the back (a) and across it (b): the street is off the end, or off a long side.
      const px = -r.uz, pz = r.ux;
      const endOn = Math.abs(ds) / r.hl > Math.abs(dt) / r.hw;
      const sign = -Math.sign(endOn ? ds : dt) || 1;
      const ax = (endOn ? r.ux : px) * sign, az = (endOn ? r.uz : pz) * sign;
      const bx = endOn ? px : r.ux, bz = endOn ? pz : r.uz;
      const e = endOn ? r.hl : r.hw;
      const half = (endOn ? r.hw : r.hl) - 0.06;
      const at = (d: number, k: number): Pt => ({ x: r.c.x + ax * (e + d) + bx * half * k, z: r.c.z + az * (e + d) + bz * half * k });
      let depth = 0;
      for (let d = 1; d <= 14; d += 0.5) {
        const blocked = [-0.9, 0, 0.9].some((k) => {
          const p = at(d, k);
          const road = this.roads.nearest(p);
          return this.footprints.hit(p, 0.4) || (!!road && road.d < 0.6);
        });
        if (blocked) break;
        depth = d;
      }
      if (depth < 3) continue;
      this.gardenLines.push({ kind: 'garden', pts: [at(0, -1), at(depth, -1), at(depth, 1), at(0, 1)] });
    }
    this.count.gardens = this.gardenLines.length;
  }

  /** The tarmac path along the old railway line near the start: the long path nearest the start. */
  private railwayPath(): Pt[] | null {
    let best: Pt[] | null = null, bestD = 80;
    for (const r of this.town.roads) {
      if (r.kind !== 'path' && r.kind !== 'cycleway') continue;
      let len = 0;
      for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].z - r.pts[i - 1].z);
      if (len < 600) continue;
      const d = Math.min(...r.pts.map((p) => Math.hypot(p.x - this.town.start.x, p.z - this.town.start.z)));
      if (d < bestD) {
        bestD = d;
        best = r.pts;
      }
    }
    return best;
  }

  /** Street lamps: along the pavements of the housing streets, and down the railway path. */
  private lampPosts(): void {
    const spots: { p: Pt; yaw: number }[] = [];
    const along = (pts: Pt[], gap: number, off: number) => {
      let carry = gap / 2;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        for (let m = carry; m < len; m += gap) {
          const p = { x: a.x + ux * m - uz * off, z: a.z + uz * m + ux * off };
          // The lamp leans out over the road, toward its middle line.
          if (!this.footprints.hit(p, 0.8)) spots.push({ p, yaw: Math.atan2(ux * off, uz * off) });
          carry = m + gap - len;
        }
        if (carry < 0) carry = 0;
      }
    };
    for (const r of this.town.roads) {
      if (r.kind === 'residential' || r.kind === 'tertiary' || r.kind === 'unclassified' || r.kind === 'primary') along(r.pts, 34, r.width / 2 + 1.1);
    }
    const rail = this.railwayPath();
    if (rail) along(rail, 30, 1.4);
    const n = spots.length;
    this.count.lamps = n;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 6, 6).translate(0, 3, 0), plastic(0x9aa0a4), n);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.12, 0.26).translate(0.32, 6, 0), plastic(0x6f767b), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((s, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      m.compose(new THREE.Vector3(s.p.x, this.ground(s.p) - 0.1, s.p.z), q, new THREE.Vector3(1, 1, 1));
      pole.setMatrixAt(i, m);
      head.setMatrixAt(i, m);
    });
    for (const im of [pole, head]) {
      im.castShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  /** Hedges, garden walls and fences, as runs of short boxes that follow the ground. */
  private barriers(): void {
    const kinds: Record<string, { h: number; t: number; color: number; solid: boolean }> = {
      hedge: { h: 1.5, t: 0.9, color: 0x3d6a2a, solid: true },
      wall: { h: 1.1, t: 0.35, color: 0x9c968a, solid: true },
      retaining_wall: { h: 1.0, t: 0.45, color: 0x8e8a80, solid: true },
      fence: { h: 1.15, t: 0.08, color: 0x7a5a3a, solid: false },
      // The back-garden fences: tall wooden panels you can't see or climb over.
      garden: { h: 1.8, t: 0.08, color: 0xa08566, solid: true },
    };
    for (const [kind, k] of Object.entries(kinds)) {
      const pieces: { a: Pt; b: Pt }[] = [];
      for (const l of kind === 'garden' ? this.gardenLines : this.town.lines) {
        if (l.kind !== kind) continue;
        for (let i = 1; i < l.pts.length; i++) {
          const a = l.pts[i - 1], b = l.pts[i];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const n = Math.max(1, Math.ceil(len / 3));
          for (let j = 0; j < n; j++) {
            pieces.push({ a: { x: a.x + ((b.x - a.x) * j) / n, z: a.z + ((b.z - a.z) * j) / n }, b: { x: a.x + ((b.x - a.x) * (j + 1)) / n, z: a.z + ((b.z - a.z) * (j + 1)) / n } });
          }
        }
      }
      if (!pieces.length) continue;
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), withDetail(new THREE.MeshStandardMaterial({ color: k.color, roughness: kind === 'hedge' ? 1 : 0.9 }), kind === 'hedge' ? 'leaves' : kind === 'fence' || kind === 'garden' ? 'planks' : 'stone'), pieces.length);
      const m = new THREE.Matrix4();
      pieces.forEach((p, i) => {
        const mid = { x: (p.a.x + p.b.x) / 2, z: (p.a.z + p.b.z) / 2 };
        const len = Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z) + (kind === 'fence' || kind === 'garden' ? 0.02 : k.t * 0.5);
        const yaw = Math.atan2(-(p.b.z - p.a.z), p.b.x - p.a.x);
        const y = Math.min(this.ground(p.a), this.ground(p.b)) - 0.25;
        const top = Math.max(this.ground(p.a), this.ground(p.b)) + k.h;
        m.compose(new THREE.Vector3(mid.x, y, mid.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(len, top - y, k.t));
        im.setMatrixAt(i, m);
        if (k.solid) {
          const hy = (top - y) / 2;
          this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(len / 2, hy, k.t / 2).setTranslation(mid.x, y + hy, mid.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
            this.body,
          );
        }
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  /** Cars parked along the kerbs of the housing streets: cover in a street fight. */
  private cars(rng: () => number): void {
    const spots: { p: Pt; yaw: number; color: number }[] = [];
    const start = this.town.start;
    for (const r of this.town.roads) {
      if (r.kind !== 'residential' && r.kind !== 'service' && r.kind !== 'unclassified') continue;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
        for (let m = 6; m < len - 6; m += 9 + rng() * 14) {
          if (rng() > (r.kind === 'service' ? 0.25 : 0.4)) continue;
          const side = rng() < 0.5 ? -1 : 1;
          const off = r.width / 2 - 1.05;
          const p = { x: a.x + ux * m - uz * off * side, z: a.z + uz * m + ux * off * side };
          if (Math.hypot(p.x - start.x, p.z - start.z) < 14) continue;
          if (this.footprints.hit(p, 1.2)) continue;
          spots.push({ p, yaw: Math.atan2(-ux, -uz), color: CARS[Math.floor(rng() * CARS.length)] });
        }
      }
    }
    this.count.cars = spots.length;
    const placed: CarPlacement[] = [];
    for (const s of spots) {
      // Mostly hatchbacks and estates, a few SUVs.
      const k = hash(s.p.x * 3.1, s.p.z * 1.7);
      const type = k < 0.45 ? 0 : k < 0.8 ? 1 : 2;
      const t = CAR_TYPES[type];
      // Tilted to the slope of the street.
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      const hf = this.ground({ x: s.p.x + fx * 1.8, z: s.p.z + fz * 1.8 });
      const hb = this.ground({ x: s.p.x - fx * 1.8, z: s.p.z - fz * 1.8 });
      const y = (hf + hb) / 2;
      const pitch = Math.atan2(hf - hb, 3.6);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, s.yaw, 0, 'YXZ'));
      placed.push({ type, color: s.color, matrix: new THREE.Matrix4().compose(new THREE.Vector3(s.p.x, y, s.p.z), q, new THREE.Vector3(1, 1, 1)) });
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(t.W / 2, t.roof / 2, t.L / 2).setTranslation(s.p.x, y + t.roof / 2, s.p.z).setRotation(q),
        this.body,
      );
    }
    parkedCars(this.group, placed);
  }

  /**
   * A roadblock across the street at `at`, facing back up the route (`facing`), built in layers
   * from the attack side in: a coil of barbed wire on pickets (it stops you walking but not seeing
   * or shooting, with a gap at one side), a staggered row of concrete barriers with hazard stripes
   * (their gap at the other side, so the way through zig-zags), the curve of sandbags with a gap in
   * the middle, a sandbagged machine-gun nest on one flank, and behind the line a sentry box with a
   * raised barrier pole, a floodlight, oil drums, stacked ammo crates, an army truck parked across
   * half the road and the flag. It all fits the width of the street and its pavements.
   */
  roadblock(at: Pt, facing: Pt, color: number): Roadblock {
    const p = new PartBuilder();
    const fl = Math.hypot(facing.x, facing.z) || 1;
    const fx = facing.x / fl, fz = facing.z / fl;
    const yawFacing = Math.atan2(-fx, -fz);
    // s across the street (toward -fz, fx), t toward the attack.
    const P = (s: number, t: number): Pt => ({ x: at.x - fz * s + fx * t, z: at.z + fx * s + fz * t });
    const G = (s: number, t: number) => this.ground(P(s, t));
    const rot = (yaw: number) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    const box = (s: number, t: number, y: number, hx: number, hy: number, hz: number, yaw = yawFacing, groups?: number) => {
      const q = P(s, t);
      const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(q.x, y, q.z).setRotation(rot(yaw));
      if (groups !== undefined) d.setCollisionGroups(groups);
      this.world.createCollider(d, this.body);
    };
    const road = this.roads.nearest(at);
    const hw = Math.max(3.2, Math.min(6.5, (road?.w ?? 9) / 2));
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, s: number, t: number, y: number, ry = yawFacing, rx = 0, rz = 0) => {
      const q = P(s, t);
      p.add(geo, mat, q.x, y, q.z, rx, ry, rz);
    };

    // 1. Barbed wire, twelve metres out, with a gap at the +s side: a triple concertina (two coils
    // side by side on the ground and one on top), barbs along the wire, on angle-iron pickets with
    // straight strands strung between them.
    const wire = plastic(0x5b5f63);
    const w0 = -hw, w1 = hw - 1.9;
    const len = w1 - w0;
    const coil = (tc: number, yc: number, r: number, phase: number) => {
      const turns = Math.max(4, Math.round(len / 0.32));
      const helix = (u: number) => {
        const s = w0 + len * u;
        const th = Math.PI * 2 * turns * u + phase;
        // Each loop a little rounder or flatter than the last, as a real coil sags.
        const rr = r * (1 + 0.08 * Math.sin(th * 0.37 + phase));
        const q = P(s, tc + Math.cos(th) * rr);
        return new THREE.Vector3(q.x, G(s, tc) + yc + Math.sin(th) * rr, q.z);
      };
      const steps = turns * 14;
      const curve = new THREE.CatmullRomCurve3(Array.from({ length: steps + 1 }, (_, j) => helix(j / steps)));
      p.add(new THREE.TubeGeometry(curve, steps, 0.016, 3, false), wire);
      // Barbs: little crossed spikes every half metre or so of wire.
      const barb = new THREE.BoxGeometry(0.13, 0.012, 0.012);
      const n = Math.round((turns * Math.PI * 2 * r) / 0.45);
      for (let j = 0; j < n; j++) {
        const at = helix((j + 0.5) / n);
        p.add(barb, wire, at.x, at.y, at.z, j * 1.3, j * 0.7, 0.8);
        p.add(barb, wire, at.x, at.y, at.z, j * 1.3 + 1.2, j * 0.7 + 1.5, -0.8);
      }
    };
    coil(12.42, 0.42, 0.42, 0);
    coil(11.58, 0.42, 0.42, 1.7);
    coil(12, 1.12, 0.38, 3.1);
    const picket = new THREE.BoxGeometry(0.05, 1.5, 0.05);
    const picketMat = plastic(0x4a4436);
    const pickets: Pt[] = [];
    for (let s = w0; s <= w1 + 0.01; s += len / Math.max(1, Math.round(len / 2.2))) {
      const g = G(s, 12);
      add(picket, picketMat, s, 12, g + 0.7);
      pickets.push({ x: s, z: g });
    }
    for (let j = 1; j < pickets.length; j++) {
      const a = pickets[j - 1], b = pickets[j];
      for (const h of [0.3, 0.75, 1.2]) {
        const qa = P(a.x, 12), qb = P(b.x, 12);
        p.beam(new THREE.Vector3(qa.x, a.z + h, qa.z), new THREE.Vector3(qb.x, b.z + h + 0.02, qb.z), 0.014, wire, true);
      }
    }
    box((w0 + w1) / 2, 12, G((w0 + w1) / 2, 12) + 0.7, len / 2, 0.75, 0.9, yawFacing, WATER_GROUPS);

    // 2. Concrete barriers, seven metres out, staggered; the gap is at the -s side.
    const concrete = plastic(0xb9b7b0);
    const yellow = plastic(0xe0b020);
    const black = plastic(0x232323);
    const base = new THREE.BoxGeometry(1.9, 0.45, 0.72);
    const top = new THREE.BoxGeometry(1.9, 0.55, 0.34);
    const stripe = new THREE.BoxGeometry(0.24, 0.22, 0.36);
    let k = 0;
    for (let s = -hw + 2.9; s <= hw - 0.9; s += 2.0, k++) {
      const t = 7 + (k % 2 ? 0.35 : -0.25);
      const yaw = yawFacing + (k % 3 - 1) * 0.06;
      const g = G(s, t);
      add(base, concrete, s, t, g + 0.22, yaw);
      add(top, concrete, s, t, g + 0.72, yaw);
      for (let j = 0; j < 7; j++) {
        const ds = -0.78 + j * 0.26;
        const q = P(s + ds * Math.cos(yaw - yawFacing), t);
        p.add(stripe, j % 2 ? black : yellow, q.x, g + 0.9, q.z, 0, yaw);
      }
      box(s, t, g + 0.5, 0.95, 0.5, 0.36, yaw);
    }

    // 3. The sandbag line, bowing toward the attack, with a gap just left of the middle (s about -1.1 to 0).
    const bag = sandbagGeometry();
    const bagMat = plastic(0xb5a47a);
    const bagDark = plastic(0xa39368);
    for (let i = -6; i <= 6; i++) {
      if (i === -1 || i === 0) continue;
      const a = i * 0.16, r = 7;
      const s = Math.sin(a) * r, t = Math.cos(a) * r - r + 3;
      if (Math.abs(s) > hw) continue;
      const g = G(s, t);
      for (let row = 0; row < 3; row++) add(bag, row % 2 ? bagDark : bagMat, s, t, g + 0.2 + row * 0.38, yawFacing - a + (row % 2) * 0.05);
      box(s, t, g + 0.6, 0.62, 0.6, 0.35, yawFacing - a);
    }

    // 4. The machine-gun nest on the +s flank: a ring of sandbags open at the back, and the gun.
    // Clear of the lane behind the gap in the bags (s -1.3 to 0.2) however narrow the street.
    const ns = Math.max(hw - 1.7, 1.9), nt = 1.2;
    for (let j = 0; j < 9; j++) {
      const a = -Math.PI * 0.85 + (j / 8) * Math.PI * 1.7; // round the front, open behind
      const s = ns + Math.sin(a) * 1.55, t = nt + Math.cos(a) * 1.55;
      const g = G(s, t);
      for (let row = 0; row < 2; row++) add(bag, row ? bagDark : bagMat, s, t, g + 0.2 + row * 0.38, yawFacing - a);
      box(s, t, g + 0.45, 0.5, 0.45, 0.32, yawFacing - a);
    }
    const gun = new THREE.Group();
    const gp = new PartBuilder();
    const steel = plastic(0x3a3d40);
    const olive = plastic(0x4f5a32);
    gp.add(new THREE.BoxGeometry(0.22, 0.24, 0.7), steel, 0, 0.05, 0);
    gp.add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8).rotateX(Math.PI / 2), steel, 0, 0.08, -0.85);
    gp.add(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8).rotateX(Math.PI / 2), steel, 0, 0.08, -0.5);
    gp.add(new THREE.BoxGeometry(0.3, 0.2, 0.25), olive, 0.24, -0.02, 0.05);
    for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) gp.add(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 5), steel, Math.sin(a) * 0.3, -0.4, Math.cos(a) * 0.3, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
    gp.buildInto(gun);
    const gq = P(ns, nt + 0.6);
    gun.position.set(gq.x, G(ns, nt + 0.6) + 0.95, gq.z);
    gun.rotation.y = yawFacing;
    this.group.add(gun);

    // 5. Behind the line: the sentry box and its barrier pole, a floodlight, drums, crates and a truck.
    const army = plastic(color);
    const hut = plastic(0x5d6640);
    const ss = -hw + 1.0, st = -2.6, sg = G(ss, st);
    add(new THREE.BoxGeometry(1.3, 2.3, 1.3), hut, ss, st, sg + 1.15);
    add(new THREE.BoxGeometry(1.6, 0.14, 1.6), plastic(0x3e4430), ss, st, sg + 2.38);
    add(new THREE.BoxGeometry(0.8, 0.5, 0.04), plastic(0x24303a), ss, st + 0.67, sg + 1.55);
    box(ss, st, sg + 1.15, 0.65, 1.15, 0.65);
    // The barrier pole, raised: red and white bands from a post by the sentry box.
    const red = plastic(0xc0392b), white = plastic(0xf2f2ee);
    const post = P(ss + 1.0, st + 0.9);
    p.add(new THREE.BoxGeometry(0.3, 1.1, 0.3), plastic(0x6f747a), post.x, sg + 0.55, post.z, 0, yawFacing);
    const lift = 1.05; // radians up from flat
    for (let j = 0; j < 8; j++) {
      const r0 = 0.25 + j * 0.5 + 0.25;
      const q = P(ss + 1.0 + Math.cos(lift) * r0, st + 0.9);
      p.add(new THREE.BoxGeometry(0.5, 0.1, 0.1), j % 2 ? red : white, q.x, sg + 1.1 + Math.sin(lift) * r0, q.z, 0, yawFacing, lift);
    }
    // Floodlight on a pole at the -s end of the bags.
    const fs = -hw + 0.4, ft = 2.2, fg = G(fs, ft);
    add(new THREE.CylinderGeometry(0.06, 0.08, 5, 6), steel, fs, ft, fg + 2.5);
    add(new THREE.BoxGeometry(0.6, 0.45, 0.3), steel, fs, ft + 0.15, fg + 5.0, yawFacing, -0.5);
    add(new THREE.BoxGeometry(0.5, 0.36, 0.05), plastic(0xfff4c0), fs, ft + 0.33, fg + 4.92, yawFacing, -0.5);
    // Oil drums.
    const drum = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 12);
    const drums = [plastic(0x2f5f8a), plastic(0x8a3a2a), plastic(0x3d5a3a)];
    [[hw - 0.7, -2.4], [hw - 1.35, -2.6], [hw - 0.95, -3.15], [hw - 0.5, -3.3]].forEach(([s, t], j) => {
      add(drum, drums[j % 3], s, t, G(s, t) + 0.44);
      const q = P(s, t);
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.44, 0.29).setTranslation(q.x, G(s, t) + 0.44, q.z), this.body);
    });
    // Ammo crates, stacked.
    const crate = new THREE.BoxGeometry(0.9, 0.55, 0.6);
    const crateMat = plastic(0x5b6b3a), crateLid = plastic(0x6d7d48);
    // Ammo crates, stacked on the +s side of the lane.
    for (const [s, t, lvl] of [[0.9, -4.4, 0], [1.9, -4.4, 0], [1.4, -4.4, 1], [1.3, -5.2, 0]]) {
      const g = G(s, t);
      add(crate, lvl ? crateLid : crateMat, s, t, g + 0.28 + lvl * 0.56);
    }
    box(1.4, -4.7, G(1.4, -4.7) + 0.55, 1.0, 0.55, 0.7);
    // An army truck parked along the +s side of the road behind it all, where the street is wide enough.
    if (hw >= 4.2) {
      const ts = hw - 1.3, tt = -9.5, tg = G(ts, tt);
      // Its length along the road: in the facing frame local z runs back down the road (-t).
      const truck = (dt: number, y: number, geo: THREE.BufferGeometry, mat: THREE.Material) => add(geo, mat, ts, tt - dt, tg + y);
      truck(-2.1, 1.25, new THREE.BoxGeometry(1.9, 1.9, 2.3), army);
      truck(-2.1, 1.55, new THREE.BoxGeometry(0.9, 0.6, 2.32).translate(0, 0, -0.01), plastic(0x2a3440));
      truck(0.8, 1.05, new THREE.BoxGeometry(2.3, 0.35, 3.9), army);
      truck(0.8, 2.0, new THREE.BoxGeometry(2.25, 1.6, 3.8), plastic(0x8a8060));
      const wheel = new THREE.CylinderGeometry(0.48, 0.48, 0.32, 12).rotateZ(Math.PI / 2);
      for (const dt of [-2.3, 0.0, 1.9]) for (const side of [-1, 1]) {
        const q = P(ts + side * 1.15, tt - dt);
        p.add(wheel, plastic(0x1e1e1e), q.x, tg + 0.48, q.z, 0, yawFacing);
      }
      box(ts, tt - 0.4, tg + 1.4, 1.2, 1.4, 3.3, yawFacing);
    }

    // The flag on a pole behind the bags.
    const px = P(-1.5, -2.5), fgy = G(-1.5, -2.5);
    p.add(new THREE.CylinderGeometry(0.06, 0.06, 4.5, 8), plastic(0x6b4a2e), px.x, fgy + 2.25, px.z);
    p.buildInto(this.group);
    // Its own copy of the army's plastic: it turns green when the roadblock is taken, and the shared
    // one is the soldiers' own colour (recolouring that turned every soldier of that army green).
    const flagMaterial = plastic(color).clone();
    flagMaterial.side = THREE.DoubleSide;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9).translate(0.72, 0, 0), flagMaterial);
    flag.position.set(px.x, fgy + 4, px.z);
    flag.rotation.y = yawFacing;
    this.group.add(flag);

    // Where its men stand: behind the bags either side of the gap, by the sentry box, the crates and the truck.
    const posts: Pt[] = [];
    for (const [s, t] of [[-3.4, 1.7], [-2.0, 1.9], [0.9, 1.9], [ss + 0.4, st + 1.3], [0.9, -3.5], [-2.2, -6.5]]) {
      const q = P(Math.max(-hw + 0.5, Math.min(hw - 0.5, s)), t);
      posts.push(this.footprints.hit(q, 0.6) ? at : q);
    }
    const through = [P(hw - 0.95, 15), P(hw - 0.95, 10.5), P(-hw + 0.95, 9), P(-hw + 0.95, 5), P(-0.55, 4.6), P(-0.55, -12)];
    return { at, facing: { x: fx, z: fz }, flagMaterial, posts, gunner: P(ns, nt - 0.3), gun, through };
  }
}
