import * as THREE from 'three';
import { mulberry32 } from '../utils/rng';
import { MOON_GREY } from '../world/MoonBase';
import { openness, valleyQ, canyonX, CANYON, VALLEY } from './Layout';

/** The drivable plain reaches this far from the centre on each axis; beyond it the ground rises into mountains. */
export const PLAY_HALF = 610;
/** The terrain mesh reaches further than the plain so the mountains fill the horizon (east, west and south)... */
const EXTENT = 820;
/** ...and much further north, over the mountains to the Weird Side's valley. */
export const NORTH_EXTENT = 1640;
const CELL = 5;
const NX = (EXTENT * 2) / CELL + 1;
const NZ = (EXTENT + NORTH_EXTENT) / CELL + 1;
const X0 = -EXTENT;
const Z0 = -NORTH_EXTENT;
/** How far inside the plain's edge, the canyon's walls and the valley's rim the buggy is held. */
const EDGE_MARGIN = 6;
const ROAD_WIDTH = 7.5;
const ROAD_FLAT_FROM = 6;
const ROAD_FLAT_TO = 28;
const DIRT = 0x8c7a62;

/** A flat circle of ground (the base, a camp) that blends into the plain beyond `r`. */
export interface FlatZone {
  x: number;
  z: number;
  r: number;
}

const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);

/** A scatter of boulders you can bump into (or jump over) but that don't block anything big. */
export interface Solid {
  x: number;
  z: number;
  r: number;
  /** Height of its top above the ground, so a buggy that is high enough sails over it. */
  h: number;
}

/**
 * A straight ramp laid on flat ground: it climbs `rise` metres over `len` metres from (x, z) in the
 * direction `yaw` (like the buggy's), `halfW` either side of its middle, then stops dead.
 */
export interface Ramp {
  x: number;
  z: number;
  yaw: number;
  len: number;
  halfW: number;
  rise: number;
}

/** A ramp's height `u` metres along it: a gentle start curving up into a kicker at the lip. */
export function rampHeight(r: Ramp, u: number): number {
  const t = u / r.len;
  return r.rise * (0.55 * t + 0.45 * t * t);
}

const BUCKET = 48;

/** Round obstacles in a coarse grid, so a buggy only checks the few near it. */
export class Solids {
  private readonly buckets = new Map<number, Solid[]>();
  readonly all: Solid[] = [];

  private key(cx: number, cz: number): number {
    return cx * 4096 + cz;
  }

  add(s: Solid): void {
    this.all.push(s);
    const x0 = Math.floor((s.x - s.r) / BUCKET);
    const x1 = Math.floor((s.x + s.r) / BUCKET);
    const z0 = Math.floor((s.z - s.r) / BUCKET);
    const z1 = Math.floor((s.z + s.r) / BUCKET);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        const list = this.buckets.get(k);
        if (list) list.push(s);
        else this.buckets.set(k, [s]);
      }
    }
  }

  near(x: number, z: number): Solid[] {
    return this.buckets.get(this.key(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) ?? [];
  }
}

/** Soft dirt-track texture: tyre ruts down the middle, ragged edges that fade into the plain. */
function roadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const rng = mulberry32(404);
  const across = ctx.createLinearGradient(0, 0, 256, 0);
  across.addColorStop(0, 'rgba(140,122,98,0)');
  across.addColorStop(0.14, 'rgba(140,122,98,0.85)');
  across.addColorStop(0.86, 'rgba(140,122,98,0.85)');
  across.addColorStop(1, 'rgba(140,122,98,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 256, 256);
  // Darker ruts.
  for (const x of [88, 168]) {
    const g = ctx.createLinearGradient(x - 16, 0, x + 16, 0);
    g.addColorStop(0, 'rgba(70,58,44,0)');
    g.addColorStop(0.5, 'rgba(70,58,44,0.55)');
    g.addColorStop(1, 'rgba(70,58,44,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 16, 0, 32, 256);
  }
  // Pebbles and speckle.
  for (let i = 0; i < 420; i++) {
    const x = 30 + rng() * 196;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(60,50,40,0.35)' : 'rgba(190,172,146,0.35)';
    ctx.fillRect(x, rng() * 256, 1 + rng() * 2.5, 1 + rng() * 2.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** A round patch of packed dirt, ragged at the rim. */
function patchTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const rng = mulberry32(9);
  const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  g.addColorStop(0, 'rgba(140,122,98,0.95)');
  g.addColorStop(0.7, 'rgba(140,122,98,0.85)');
  g.addColorStop(1, 'rgba(140,122,98,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 520; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * 118;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(60,50,40,0.3)' : 'rgba(190,172,146,0.3)';
    ctx.fillRect(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 1 + rng() * 3, 1 + rng() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The Moon: a height grid (rolling hills and craters, flattened round the bases and along the
 * dirt roads, ringed with mountains) that both the mesh and the buggy's wheels read, plus the
 * dirt roads themselves laid on top.
 */
export class MoonTerrain {
  private readonly heights = new Float32Array(NX * NZ);
  private readonly roadDist = new Float32Array(NX * NZ).fill(999);
  /** Like roadDist but only for the roads there from the start, for tinting the ground under them. */
  private readonly shownDist = new Float32Array(NX * NZ).fill(999);
  /** Each road as points about three metres apart: the first `shownRoads` are there from the start, the rest are built later. */
  readonly paths: THREE.Vector2[][] = [];
  readonly shownRoads: number;
  readonly solids = new Solids();
  readonly ramps: Ramp[] = [];
  /** Once the road over the mountains is built, the canyon and the valley beyond are open to drive in. */
  weirdOpen = false;

  constructor(
    roads: [number, number][][],
    private readonly zones: FlatZone[],
    /** Places craters and boulders must keep clear of, besides the roads and zones. */
    keepClear: FlatZone[] = [],
    /** Roads that are built during the game: the ground is flattened for them from the start, but they're drawn later. */
    later: [number, number][][] = [],
  ) {
    this.shownRoads = roads.length;
    for (const way of [...roads, ...later]) {
      const [fx, fz] = way[0];
      const [lx, lz] = way[way.length - 1];
      const closed = way.length > 3 && fx === lx && fz === lz;
      const pts3 = (closed ? way.slice(0, -1) : way).map(([x, z]) => new THREE.Vector3(x, 0, z));
      const curve = new THREE.CatmullRomCurve3(pts3, closed, 'catmullrom', 0.5);
      const pts = curve.getSpacedPoints(Math.max(2, Math.round(curve.getLength() / 3))).map((v) => new THREE.Vector2(v.x, v.z));
      this.paths.push(pts);
    }
    this.paths.forEach((path, i) => this.splatRoad(path, i < this.shownRoads));
    const craters = this.makeCraters(keepClear);
    for (let iz = 0; iz < NZ; iz++) {
      for (let ix = 0; ix < NX; ix++) {
        const x = X0 + ix * CELL;
        const z = Z0 + iz * CELL;
        this.heights[iz * NX + ix] = this.shape(x, z, craters, this.roadDist[iz * NX + ix]);
      }
    }
  }

  /** Marks every grid cell near a road with how far it is from the road's middle. */
  private splatRoad(path: THREE.Vector2[], shown: boolean): void {
    const reach = Math.ceil(ROAD_FLAT_TO / CELL);
    for (const p of path) {
      const cx = Math.round((p.x - X0) / CELL);
      const cz = Math.round((p.y - Z0) / CELL);
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const ix = cx + dx;
          const iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) continue;
          const d = Math.hypot(X0 + ix * CELL - p.x, Z0 + iz * CELL - p.y);
          const i = iz * NX + ix;
          if (d < this.roadDist[i]) this.roadDist[i] = d;
          if (shown && d < this.shownDist[i]) this.shownDist[i] = d;
        }
      }
    }
  }

  private makeCraters(keepClear: FlatZone[]): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    const fits = (x: number, z: number, r: number) => {
      const reach = r * 1.9 + 8;
      if (this.zones.some((s) => Math.hypot(x - s.x, z - s.z) < s.r * 1.9 + reach)) return false;
      if (keepClear.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + reach)) return false;
      return this.roadDistAt(x, z) >= reach + ROAD_WIDTH;
    };
    // The plain's craters.
    let rng = mulberry32(2027);
    let tries = 0;
    while (out.length < 90 && tries++ < 2000) {
      const big = rng() < 0.4;
      const r = big ? 22 + rng() * 40 : 5 + rng() * 11;
      const x = (rng() - 0.5) * 2 * (EXTENT - 40);
      const z = (rng() - 0.5) * 2 * (EXTENT - 40);
      const depth = r * (0.17 + rng() * 0.1);
      if (fits(x, z, r)) out.push([x, z, r, depth]);
    }
    // A few smaller ones dotted about the valley, between the things to find.
    rng = mulberry32(4711);
    tries = 0;
    let made = 0;
    while (made < 22 && tries++ < 1500) {
      const r = 4 + rng() * 14;
      const x = VALLEY.x + (rng() - 0.5) * 2 * VALLEY.rx;
      const z = VALLEY.z + (rng() - 0.5) * 2 * VALLEY.rz;
      const depth = r * (0.15 + rng() * 0.1);
      if (valleyQ(x, z) > 0.85 || !fits(x, z, r)) continue;
      out.push([x, z, r, depth]);
      made++;
    }
    return out;
  }

  /** The raw height of the Moon at (x, z), before the roads and flat zones tame it. */
  private shape(x: number, z: number, craters: [number, number, number, number][], roadD: number): number {
    let h = Math.sin(x * 0.0109) * Math.cos(z * 0.0127) * 5.5 + Math.sin(x * 0.031 + z * 0.023) * 1.9 + Math.sin(x * 0.087 - z * 0.071) * 0.5;
    for (const [cx, cz, r, depth] of craters) {
      const q = Math.hypot(x - cx, z - cz) / r;
      if (q > 1.9) continue;
      if (q < 1) h -= depth * (1 - q * q);
      h += depth * 0.45 * Math.exp(-(((q - 1) / 0.24) ** 2));
    }
    // Mountains round the rim of the world, with the canyon and the Weird Side's valley carved out of them.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const mountains = (smooth(edge, PLAY_HALF - 30, EXTENT) ** 1.4) * (60 + Math.sin(x * 0.05) * 20 + Math.sin(z * 0.045 + 1) * 20);
    if (mountains > 0.01) h += mountains * (1 - openness(x, z));
    let calm = (1 - smooth(roadD, ROAD_FLAT_FROM, ROAD_FLAT_TO)) * 0.82;
    for (const s of this.zones) calm = Math.max(calm, 1 - smooth(Math.hypot(x - s.x, z - s.z), s.r, s.r * 1.9));
    return h * (1 - calm);
  }

  /** The ground's height at (x, z), smoothly between grid points, or the top of a ramp where there is one. */
  heightAt(x: number, z: number): number {
    const fx = THREE.MathUtils.clamp((x - X0) / CELL, 0, NX - 1.001);
    const fz = THREE.MathUtils.clamp((z - Z0) / CELL, 0, NZ - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h = this.heights;
    const a = h[iz * NX + ix];
    const b = h[iz * NX + ix + 1];
    const c = h[(iz + 1) * NX + ix];
    const d = h[(iz + 1) * NX + ix + 1];
    const ground = a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    if (this.ramps.length === 0) return ground;
    let top = ground;
    for (const r of this.ramps) {
      const dx = x - r.x;
      const dz = z - r.z;
      const s = Math.sin(r.yaw);
      const c2 = Math.cos(r.yaw);
      const u = dx * s + dz * c2;
      if (u < 0 || u > r.len) continue;
      if (Math.abs(dx * c2 - dz * s) > r.halfW) continue;
      top = Math.max(top, rampHeight(r, u));
    }
    return top;
  }

  /** How far (x, z) is from the nearest road's middle (999 when it's far from any). */
  roadDistAt(x: number, z: number): number {
    const ix = Math.round((x - X0) / CELL);
    const iz = Math.round((z - Z0) / CELL);
    if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) return 999;
    return this.roadDist[iz * NX + ix];
  }

  /**
   * Holds `p` on the drivable ground: the plain, and once the road over the mountains is built,
   * the canyon and the valley. Returns the outward direction it was pushed back from, or null.
   */
  keepInside(p: THREE.Vector3): THREE.Vector2 | null {
    const lim = PLAY_HALF - EDGE_MARGIN;
    if (Math.abs(p.x) <= lim && Math.abs(p.z) <= lim) return null;
    const half = CANYON.half;
    if (this.weirdOpen) {
      if (p.z <= CANYON.from && p.z >= CANYON.to && Math.abs(p.x - canyonX(p.z)) <= half) return null;
      if (valleyQ(p.x, p.z, EDGE_MARGIN + 4) <= 1) return null;
    }
    const options: [number, number][] = [[THREE.MathUtils.clamp(p.x, -lim, lim), THREE.MathUtils.clamp(p.z, -lim, lim)]];
    if (this.weirdOpen) {
      const cz = THREE.MathUtils.clamp(p.z, CANYON.to, CANYON.from);
      const cx = canyonX(cz);
      options.push([THREE.MathUtils.clamp(p.x, cx - half, cx + half), cz]);
      const q = valleyQ(p.x, p.z, EDGE_MARGIN + 4);
      options.push([VALLEY.x + (p.x - VALLEY.x) / q, VALLEY.z + (p.z - VALLEY.z) / q]);
    }
    let best = options[0];
    let bestD = Infinity;
    for (const o of options) {
      const d = Math.hypot(p.x - o[0], p.z - o[1]);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    const n = new THREE.Vector2(p.x - best[0], p.z - best[1]);
    p.x = best[0];
    p.z = best[1];
    return n.lengthSq() > 1e-9 ? n.normalize() : null;
  }

  /** The slope of the ground: rise per metre toward +X and +Z. */
  gradient(x: number, z: number, out: THREE.Vector2): THREE.Vector2 {
    return out.set((this.heightAt(x + 1.5, z) - this.heightAt(x - 1.5, z)) / 3, (this.heightAt(x, z + 1.5) - this.heightAt(x, z - 1.5)) / 3);
  }

  /** The grey, cratered plain, moulded low-poly like the rest of the toys; the Weird Side's valley is pastel. */
  buildMesh(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(EXTENT * 2, EXTENT + NORTH_EXTENT, NX - 1, NZ - 1).rotateX(-Math.PI / 2).translate(0, 0, (EXTENT - NORTH_EXTENT) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(MOON_GREY);
    const dirt = new THREE.Color(DIRT);
    const tint = new THREE.Color();
    const weird = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const ix = Math.round((x - X0) / CELL);
      const iz = Math.round((z - Z0) / CELL);
      const h = this.heights[iz * NX + ix];
      pos.setY(i, h);
      const k = 0.88 + Math.sin(x * 0.21 + z * 0.17) * 0.04 + Math.sin(x * 0.037 - z * 0.05) * 0.05 + THREE.MathUtils.clamp(h * 0.012, -0.12, 0.1);
      tint.copy(base).multiplyScalar(k);
      // The valley's dust is candy-coloured: soft blotches of pink, lilac, mint and sky blue.
      const pastel = 1 - smooth(valleyQ(x, z), 0.9, 1.08);
      if (pastel > 0) {
        weird.setHSL((0.55 + Math.sin(x * 0.011) * 0.25 + Math.sin(z * 0.013 + x * 0.004) * 0.25 + 1) % 1, 0.62, 0.74);
        weird.multiplyScalar(k * 1.04);
        tint.lerp(weird, pastel * 0.88);
      }
      const road = 1 - smooth(this.shownDist[iz * NX + ix], 3, 14);
      tint.lerp(dirt, road * 0.3);
      colors.set([tint.r, tint.g, tint.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    mesh.receiveShadow = true;
    return mesh;
  }

  /** One road's strip of dirt, following the ground. Six indices per three-metre step, so it can be drawn a bit at a time. */
  private roadMesh(pts: THREE.Vector2[], mat: THREE.Material): THREE.Mesh {
    const lift = 0.14;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let along = 0;
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dir = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
      const nx = -dir.y * (ROAD_WIDTH / 2);
      const nz = dir.x * (ROAD_WIDTH / 2);
      if (i > 0) along += p.distanceTo(pts[i - 1]);
      const lx = p.x + nx;
      const lz = p.y + nz;
      const rx = p.x - nx;
      const rz = p.y - nz;
      pos.push(lx, this.heightAt(lx, lz) + lift, lz, rx, this.heightAt(rx, rz) + lift, rz);
      uv.push(0, along / 12, 1, along / 12);
      if (i > 0) {
        const k = (i - 1) * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    return m;
  }

  private roadMaterial(): THREE.MeshStandardMaterial {
    // Lit like the ground, so the sun's angle and shadows read on it.
    return new THREE.MeshStandardMaterial({ map: roadTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  }

  /** The roads that are built later, each hidden: show `mesh.geometry.setDrawRange(0, steps * 6)` to lay it. */
  buildLaterRoads(): THREE.Mesh[] {
    const lit = this.roadMaterial();
    return this.paths.slice(this.shownRoads).map((pts) => {
      const m = this.roadMesh(pts, lit);
      m.geometry.setDrawRange(0, 0);
      return m;
    });
  }

  /** The dirt roads there from the start, and a round patch of packed dirt at each place in `patches`, laid over the ground. */
  buildRoads(patches: FlatZone[]): THREE.Group {
    const group = new THREE.Group();
    const lift = 0.14;
    const lit = this.roadMaterial();
    for (const pts of this.paths.slice(0, this.shownRoads)) group.add(this.roadMesh(pts, lit));
    const patchMat = new THREE.MeshStandardMaterial({ map: patchTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const patch of patches) {
      const rings = 10;
      const segs = 48;
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (let ring = 0; ring <= rings; ring++) {
        for (let s = 0; s <= segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          const d = (ring / rings) * patch.r;
          const x = patch.x + Math.cos(a) * d;
          const z = patch.z + Math.sin(a) * d;
          pos.push(x, this.heightAt(x, z) + lift, z);
          uv.push(0.5 + (Math.cos(a) * ring) / rings / 2, 0.5 + (Math.sin(a) * ring) / rings / 2);
        }
      }
      for (let ring = 0; ring < rings; ring++) {
        for (let s = 0; s < segs; s++) {
          const a = ring * (segs + 1) + s;
          const b = a + segs + 1;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, patchMat);
      m.receiveShadow = true;
      m.renderOrder = 1;
      group.add(m);
    }
    return group;
  }

  /** Scatters boulders over the plain (an instanced mesh), skipping the roads, zones and anywhere in `keepClear`. */
  buildRocks(keepClear: FlatZone[]): THREE.InstancedMesh {
    const rng = mulberry32(31337);
    const count = 340;
    const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const color = new THREE.Color();
    let placed = 0;
    for (let tries = 0; placed < count && tries < 6000; tries++) {
      const x = (rng() - 0.5) * 2 * (PLAY_HALF + 20);
      const z = (rng() - 0.5) * 2 * (PLAY_HALF + 20);
      if (this.zones.some((s) => Math.hypot(x - s.x, z - s.z) < s.r * 1.1)) continue;
      if (keepClear.some((s) => Math.hypot(x - s.x, z - s.z) < s.r)) continue;
      if (this.roadDistAt(x, z) < ROAD_WIDTH * 0.9 + 3) continue;
      const s = 0.4 + rng() * rng() * 4.2;
      const squash = 0.55 + rng() * 0.4;
      e.set(rng() * 3, rng() * 3, rng() * 3);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, this.heightAt(x, z) + s * squash * 0.35, z), q, new THREE.Vector3(s, s * squash, s));
      mesh.setMatrixAt(placed, m);
      mesh.setColorAt(placed, color.setHex(MOON_GREY).multiplyScalar(0.42 + rng() * 0.3));
      if (s > 1.3) this.solids.add({ x, z, r: s * 0.85, h: s * squash * 1.1 });
      placed++;
    }
    mesh.count = placed;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /** Candy-coloured crystals poking out of the valley floor, where the plain has grey boulders. */
  buildCrystals(keepClear: FlatZone[]): THREE.InstancedMesh {
    const rng = mulberry32(777);
    const count = 260;
    const mesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(1, 0).scale(0.55, 1.6, 0.55),
      new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05, flatShading: true, emissive: 0x3a2a50, emissiveIntensity: 0.8 }),
      count,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const color = new THREE.Color();
    let placed = 0;
    for (let tries = 0; placed < count && tries < 8000; tries++) {
      const x = VALLEY.x + (rng() - 0.5) * 2 * VALLEY.rx;
      const z = VALLEY.z + (rng() - 0.5) * 2 * VALLEY.rz;
      const q0 = valleyQ(x, z);
      if (q0 > 1.05) continue;
      if (this.zones.some((s) => Math.hypot(x - s.x, z - s.z) < s.r * 1.15 + 3)) continue;
      if (keepClear.some((s) => Math.hypot(x - s.x, z - s.z) < s.r)) continue;
      if (this.roadDistAt(x, z) < ROAD_WIDTH * 0.9 + 3) continue;
      // Clusters near the rim, a few loners out in the middle.
      if (q0 < 0.75 && rng() < 0.65) continue;
      const s = 0.7 + rng() * rng() * 3.6;
      e.set((rng() - 0.5) * 0.7, rng() * 3, (rng() - 0.5) * 0.7);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, this.heightAt(x, z) + s * 0.9, z), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(placed, m);
      mesh.setColorAt(placed, color.setHSL(rng(), 0.7, 0.66));
      if (s > 1.4) this.solids.add({ x, z, r: s * 0.6, h: s * 2.2 });
      placed++;
    }
    mesh.count = placed;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }
}
