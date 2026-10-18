/**
 * The real town the Penicuik level is built from: `public/maps/penicuik.json`, made from
 * OpenStreetMap (roads, house footprints, gardens, woods, the school grounds) and real elevation
 * data. Positions are metres from the middle of the map, x east and z south (so north is -z, the
 * way the map and the compass point). Heights are a grid, in decimetres above its lowest point.
 */
export interface TownFile {
  source: string;
  origin: [number, number];
  half: number;
  step: number;
  n: number;
  base: number;
  heights: string;
  start: [number, number];
  school: [number, number];
  schoolGrounds: number[];
  route: number[];
  junctions: number[];
  roads: { k: string; w: number; n: string; p: number[] }[];
  buildings: { k: string; p: number[]; l?: number }[];
  areas: { k: string; p: number[] }[];
  barriers: { k: string; p: number[] }[];
  /** Single trees, traced from aerial photos. */
  trees: [number, number][];
  /** From each house's middle to the edge of the street in front of it, and whether it's block paved (1) or tarmac (0). */
  driveways: [number, number, number, number, number][];
}

export type Pt = { x: number; z: number };

export interface Road {
  kind: string;
  width: number;
  name: string;
  pts: Pt[];
}

export interface Footprint {
  kind: string;
  pts: Pt[];
  levels?: number;
}

export interface Area {
  kind: string;
  pts: Pt[];
}

export interface Line {
  kind: string;
  pts: Pt[];
}

const pairs = (p: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < p.length; i += 2) out.push({ x: p[i], z: p[i + 1] });
  return out;
};

/** The town, ready to build from, with the height of the ground anywhere on it. */
export class TownData {
  readonly half: number;
  readonly source: string;
  readonly start: Pt;
  readonly school: Pt;
  readonly schoolGrounds: Pt[];
  /** The way along the streets from the start to the school, and the junctions on it. */
  readonly route: Pt[];
  readonly junctions: Pt[];
  readonly roads: Road[];
  readonly buildings: Footprint[];
  readonly areas: Area[];
  readonly lines: Line[];
  readonly trees: Pt[];
  readonly driveways: { a: Pt; b: Pt; paved: boolean }[];
  /** Metres above sea level of the map's lowest point (ground height 0). */
  readonly base: number;
  private readonly step: number;
  private readonly n: number;
  private readonly heights: Float32Array;

  constructor(f: TownFile) {
    this.half = f.half;
    this.source = f.source;
    this.step = f.step;
    this.n = f.n;
    this.base = f.base;
    const bytes = Uint8Array.from(atob(f.heights), (c) => c.charCodeAt(0));
    const raw = new Uint16Array(bytes.buffer, 0, f.n * f.n);
    this.heights = Float32Array.from(raw, (v) => v / 10);
    this.start = { x: f.start[0], z: f.start[1] };
    this.school = { x: f.school[0], z: f.school[1] };
    this.schoolGrounds = pairs(f.schoolGrounds);
    this.route = pairs(f.route);
    this.junctions = pairs(f.junctions);
    this.roads = f.roads.map((r) => ({ kind: r.k, width: r.w, name: r.n, pts: pairs(r.p) }));
    this.buildings = f.buildings.map((b) => ({ kind: b.k, pts: pairs(b.p), levels: b.l }));
    this.areas = f.areas.map((a) => ({ kind: a.k, pts: pairs(a.p) }));
    this.lines = f.barriers.map((b) => ({ kind: b.k, pts: pairs(b.p) }));
    this.trees = f.trees.map(([x, z]) => ({ x, z }));
    this.driveways = f.driveways.map(([ax, az, bx, bz, paved]) => ({ a: { x: ax, z: az }, b: { x: bx, z: bz }, paved: paved === 1 }));
  }

  static async load(): Promise<TownData> {
    const res = await fetch(`${import.meta.env.BASE_URL}maps/penicuik.json`);
    if (!res.ok) throw new Error(`Couldn't load the town map (${res.status})`);
    return new TownData((await res.json()) as TownFile);
  }

  /** Grid samples per side, and metres between them. */
  get grid(): { n: number; step: number } {
    return { n: this.n, step: this.step };
  }

  /** The height of grid sample (i, j): i east, j south. */
  sample(i: number, j: number): number {
    return this.heights[Math.max(0, Math.min(this.n - 1, j)) * this.n + Math.max(0, Math.min(this.n - 1, i))];
  }

  /** The height of the ground at (x, z), between the grid samples. */
  heightAt(x: number, z: number): number {
    const gx = (x + this.half) / this.step;
    const gz = (z + this.half) / this.step;
    const i = Math.max(0, Math.min(this.n - 2, Math.floor(gx)));
    const j = Math.max(0, Math.min(this.n - 2, Math.floor(gz)));
    const fx = Math.max(0, Math.min(1, gx - i));
    const fz = Math.max(0, Math.min(1, gz - j));
    // The same two triangles per cell the ground mesh is drawn with, so feet sit right on it.
    const h00 = this.sample(i, j), h10 = this.sample(i + 1, j), h01 = this.sample(i, j + 1), h11 = this.sample(i + 1, j + 1);
    return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
}

/** Whether a point is inside a polygon. */
export function inPolygon(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < a.x + ((p.z - a.z) * (b.x - a.x)) / (b.z - a.z)) c = !c;
  }
  return c;
}

/** The middle of a polygon's corners. */
export function centroid(poly: Pt[]): Pt {
  let x = 0, z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  return { x: x / poly.length, z: z / poly.length };
}
