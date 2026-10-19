import * as THREE from 'three';
import type { TownData, Pt } from './TownData';

const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'track']);
/** Metres of road each repeat of a texture covers, along the road. */
const ASPHALT_TILE = 6;
const PAVE_TILE = 1.7;
const DASH_TILE = 7.5;
const PATH_TILE = 4;
/** Pavement width each side of a street. */
const PAVEMENT = 1.7;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function rnd(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Speckled grey asphalt with the odd darker patch where it's been dug up and filled. */
function asphalt(base: string, seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const r = rnd(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(20,22,24,${0.15 + r() * 0.25})` : `rgba(210,210,205,${0.08 + r() * 0.18})`;
    g.fillRect(r() * 512, r() * 512, 1 + (r() < 0.2 ? 1 : 0), 1 + (r() < 0.2 ? 1 : 0));
  }
  // Repairs: darker rectangles, well inside the tile so its edges still meet.
  for (let i = 0; i < 2; i++) {
    g.fillStyle = `rgba(25,27,30,${0.06 + r() * 0.06})`;
    const w = 40 + r() * 120, h = 30 + r() * 140;
    g.fillRect(40 + r() * (432 - w), 40 + r() * (432 - h), w, h);
  }
  // A few hairline cracks.
  g.strokeStyle = 'rgba(15,16,18,0.45)';
  g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = 30 + r() * 450, y = 30 + r() * 450;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 30;
      y += (r() - 0.5) * 30;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return texture(c);
}

/** Concrete paving slabs, with a kerbstone and the gutter along the road edge (u = 0). */
function pavement(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rnd(77);
  g.fillStyle = '#b5b2aa';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(90,88,82,0.18)' : 'rgba(235,233,225,0.2)';
    g.fillRect(r() * 256, r() * 256, 1, 1);
  }
  // Slabs: 0.6 m squares, a slightly different shade each.
  const slab = 256 / (PAVE_TILE / 0.6);
  for (let y = 0; y < 256; y += slab) for (let x = 30; x < 256; x += slab) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,250' : '60,58,54'},${r() * 0.06})`;
    g.fillRect(x, y, slab, slab);
  }
  g.strokeStyle = 'rgba(80,78,72,0.55)';
  g.lineWidth = 1.5;
  for (let y = 0; y <= 256; y += slab) {
    g.beginPath(); g.moveTo(30, y); g.lineTo(256, y); g.stroke();
  }
  for (let x = 30; x <= 256; x += slab) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke();
  }
  // The kerb: pale stones with joints, and a dark gutter line against the road.
  g.fillStyle = '#d2cfc6';
  g.fillRect(0, 0, 30, 256);
  g.fillStyle = 'rgba(60,60,58,0.5)';
  for (let y = 0; y < 256; y += 128) g.fillRect(0, y, 30, 2);
  g.fillStyle = '#4a4b4d';
  g.fillRect(0, 0, 4, 256);
  g.fillStyle = 'rgba(70,70,66,0.6)';
  g.fillRect(28, 0, 2, 256);
  return texture(c);
}

/** One white dash in each repeat (alpha-tested, so the gaps show the road). */
function dashes(): THREE.CanvasTexture {
  const [c, g] = canvas(32, 256);
  g.clearRect(0, 0, 32, 256);
  g.fillStyle = '#f3f2ea';
  g.fillRect(2, 0, 28, Math.round((256 * 3) / DASH_TILE));
  return texture(c);
}

/** A gravel track: tan grit and pebbles. */
function gravel(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rnd(5);
  g.fillStyle = '#b3a78c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3500; i++) {
    const s = 1 + r() * 2.5;
    g.fillStyle = r() < 0.5 ? `rgba(110,98,76,${0.3 + r() * 0.3})` : `rgba(225,215,195,${0.3 + r() * 0.3})`;
    g.beginPath();
    g.arc(r() * 256, r() * 256, s, 0, Math.PI * 2);
    g.fill();
  }
  return texture(c);
}

/** A strip laid on the ground: `left` and `right` are offsets across the line (metres), `lift` how far above the ground. */
class Strips {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly index: number[] = [];

  constructor(private readonly town: TownData) {}

  add(line: Pt[], left: number, right: number, cols: number, lift: number, tile: number, uWidth = 1): void {
    // Even steps of 2 m or less, so the strip follows the lie of the land.
    const pts: Pt[] = [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    if (pts.length < 2) return;
    const base = this.pos.length / 3;
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
      for (let c = 0; c <= cols; c++) {
        const off = left + ((right - left) * c) / cols;
        const x = p.x + nx * off, z = p.z + nz * off;
        this.pos.push(x, this.town.heightAt(x, z) + lift, z);
        this.uv.push((c / cols) * uWidth, dist / tile);
      }
    }
    const row = cols + 1;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let c = 0; c < cols; c++) {
        const a = base + i * row + c, b = a + 1, d = a + row, e = d + 1;
        // Wound to face up whichever side of the line `left` is.
        if (right > left) this.index.push(a, b, d, b, e, d);
        else this.index.push(a, d, b, b, d, e);
      }
    }
  }

  mesh(material: THREE.Material): THREE.Mesh | null {
    if (!this.index.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.index);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }
}

function surface(map: THREE.Texture, offset: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset * 2, ...extra });
}

/**
 * The town's roads and paths as real strips laid over the ground (the ground's own painted map is
 * too coarse up close): asphalt streets with a dashed white line down the main roads, paving-slab
 * pavements with kerbstones either side, tarmac footpaths and gravel tracks. Each layer sits a
 * little higher than the one under it (pavement, then road, then lines), and the streets are
 * staggered by a few millimetres so where two meet they don't flicker.
 */
export class TownRoads {
  readonly group = new THREE.Group();

  constructor(town: TownData, scene: THREE.Scene) {
    const roads = new Strips(town), paves = new Strips(town), lines = new Strips(town), paths = new Strips(town), tracks = new Strips(town);
    town.roads.forEach((r, i) => {
      const h = r.width / 2;
      const stagger = (i % 9) * 0.004;
      if (FOOT.has(r.kind)) {
        (r.kind === 'track' ? tracks : paths).add(r.pts, -h, h, 2, 0.05 + stagger, PATH_TILE, Math.max(1, r.width / PATH_TILE));
        return;
      }
      roads.add(r.pts, -h, h, 4, 0.1 + stagger, ASPHALT_TILE, Math.max(1, r.width / ASPHALT_TILE));
      if (r.kind !== 'service') {
        // Each pavement runs from the kerb (u = 0) outward.
        paves.add(r.pts, h, h + PAVEMENT, 2, 0.07 + stagger, PAVE_TILE);
        paves.add(r.pts, -h, -h - PAVEMENT, 2, 0.07 + stagger, PAVE_TILE);
      }
      if (r.width >= 6.5) lines.add(r.pts, -0.07, 0.07, 1, 0.13 + stagger, DASH_TILE);
    });
    const layers: [Strips, THREE.Material][] = [
      [tracks, surface(gravel(), -1)],
      [paths, surface(asphalt('#5d5e5f', 31), -1)],
      [paves, surface(pavement(), -2)],
      [roads, surface(asphalt('#4b4e52', 11), -3)],
      [lines, surface(dashes(), -4, { alphaTest: 0.5, transparent: false })],
    ];
    for (const [s, mat] of layers) {
      const m = s.mesh(mat);
      if (m) this.group.add(m);
    }
    scene.add(this.group);
  }
}
