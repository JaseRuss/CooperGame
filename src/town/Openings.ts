import * as THREE from 'three';

/**
 * The town's windows and doors: painted once into a texture atlas (white uPVC frames with glazing
 * bars, opening lights, reflections and what's behind the glass; panelled front doors in their
 * colours with a glazed panel, letterbox and handle; up-and-over garage doors) and laid on thin
 * quads just out from the walls. A matching roughness map keeps the glass glossy and the frames matte.
 */

/** A cell of the atlas, in texture coordinates (v up). */
export interface Cell {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const W = 2048, H = 1024;
/** Pixels trimmed off each side of a cell so mipmaps don't bleed in the neighbours. */
const INSET = 3;

function cell(x: number, y: number, w: number, h: number): Cell {
  return { u0: (x + INSET) / W, u1: (x + w - INSET) / W, v0: 1 - (y + h - INSET) / H, v1: 1 - (y + INSET) / H };
}

/** House windows (1.2 m square): pick one per house. */
export const WINDOWS: Cell[] = [cell(0, 0, 256, 256), cell(256, 0, 256, 256), cell(512, 0, 256, 256), cell(768, 0, 256, 256), cell(0, 256, 256, 256), cell(256, 256, 256, 256)];
/** The school's: a wide aluminium grid. */
export const SCHOOL_WINDOW = cell(512, 256, 256, 256);
/** A double glazed door (the flats' and the school's entrances, 1.9 m wide). */
export const DOUBLE_DOOR = cell(768, 256, 256, 256);
/** Front doors, one per colour in `DOORS` (1 m by 2.05 m). */
export const DOOR_CELLS: Cell[] = [cell(1024, 0, 256, 512), cell(1280, 0, 256, 512), cell(1536, 0, 256, 512), cell(1792, 0, 256, 512), cell(0, 512, 256, 512), cell(256, 512, 256, 512)];
/** Up-and-over garage doors: white, and anthracite grey. */
export const GARAGE_DOORS: Cell[] = [cell(512, 512, 512, 448), cell(1024, 512, 512, 448)];

type G = CanvasRenderingContext2D;

function rnd(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Glass: the sky reflected at the top fading to a dark room, a soft diagonal sheen, and sometimes curtains or a blind. */
function glass(g: G, r: G, x: number, y: number, w: number, h: number, behind: 'none' | 'curtains' | 'blind' | 'nets', seed: number): void {
  const rand = rnd(seed);
  const grad = g.createLinearGradient(x, y, x + w * 0.3, y + h);
  grad.addColorStop(0, '#9fb6c8');
  grad.addColorStop(0.35, '#55697a');
  grad.addColorStop(1, '#1f2a33');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  if (behind === 'curtains') {
    const cw = w * (0.18 + rand() * 0.12);
    const col = ['#8a5a4a', '#5a6a8a', '#b8a47a', '#6a7a5a'][Math.floor(rand() * 4)];
    for (const cx of [x, x + w - cw]) {
      g.fillStyle = col;
      g.globalAlpha = 0.75;
      g.fillRect(cx, y, cw, h);
      g.globalAlpha = 0.25;
      g.fillStyle = '#000';
      for (let k = 1; k < 4; k++) g.fillRect(cx + (cw * k) / 4, y, 2, h);
      g.globalAlpha = 1;
    }
  } else if (behind === 'blind') {
    const bh = h * (0.25 + rand() * 0.35);
    g.fillStyle = 'rgba(225,220,205,0.85)';
    g.fillRect(x, y, w, bh);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let k = 6; k < bh; k += 7) g.fillRect(x, y + k, w, 1);
  } else if (behind === 'nets') {
    g.fillStyle = 'rgba(235,235,230,0.45)';
    g.fillRect(x, y + h * 0.45, w, h * 0.55);
  }
  // A sheen across it.
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.13)';
  g.beginPath();
  g.moveTo(x + w * 0.15, y + h);
  g.lineTo(x + w * 0.45, y + h);
  g.lineTo(x + w * 0.95, y);
  g.lineTo(x + w * 0.65, y);
  g.fill();
  g.restore();
  // The frame's shadow on the glass along the top and left.
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x, y, w, 4);
  g.fillRect(x, y, 3, h);
  r.fillStyle = '#262626';
  r.fillRect(x, y, w, h);
}

/** A window frame `fw` wide round (x, y, w, h), with its panes split into columns and an optional top light. */
function windowCell(g: G, r: G, x: number, y: number, w: number, h: number, o: { frame: string; cols: number[]; transom?: number; bars?: [number, number]; behind: 'none' | 'curtains' | 'blind' | 'nets'; seed: number }): void {
  const fw = 14;
  // A dark reveal round the outside where the window sits back in the wall.
  g.fillStyle = '#3a3a38';
  g.fillRect(x, y, w, h);
  r.fillStyle = '#d0d0d0';
  r.fillRect(x, y, w, h);
  g.fillStyle = o.frame;
  g.fillRect(x + 6, y + 6, w - 12, h - 12);
  const ix = x + 6 + fw, iy = y + 6 + fw, iw = w - 12 - 2 * fw, ih = h - 12 - 2 * fw;
  glass(g, r, ix, iy, iw, ih, o.behind, o.seed);
  // Mullions between the columns (fractions across), and transom bars over the opening lights.
  const bar = 10;
  let left = ix;
  const edges = [...o.cols, 1];
  for (let k = 0; k < edges.length; k++) {
    const right = ix + iw * edges[k];
    if (k < edges.length - 1) {
      g.fillStyle = o.frame;
      g.fillRect(right - bar / 2, iy, bar, ih);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(right + bar / 2, iy, 2, ih);
    }
    // The middle of three panes is fixed: no opening light over it.
    if (o.transom !== undefined && !(edges.length === 3 && k === 1)) {
      const ty = iy + ih * o.transom;
      g.fillStyle = o.frame;
      g.fillRect(left, ty - bar / 2, right - left, bar);
    }
    left = right;
  }
  if (o.bars) {
    // Georgian bars: a thin grid over each pane.
    const [nx, ny] = o.bars;
    g.fillStyle = o.frame;
    for (let i = 1; i < nx; i++) g.fillRect(ix + (iw * i) / nx - 2, iy, 4, ih);
    for (let j = 1; j < ny; j++) g.fillRect(ix, iy + (ih * j) / ny - 2, iw, 4);
  }
  // Highlight on the frame's top edge and shade under it.
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(x + 6, y + 6, w - 12, 3);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x + 6, y + h - 9, w - 12, 3);
}

/** A front door: a white frame, the door in `paint`, raised panels, a glazed panel, letterbox, handle and knocker. */
function doorCell(g: G, r: G, x: number, y: number, w: number, h: number, paint: string, style: number, seed: number): void {
  g.fillStyle = '#2a2a28';
  g.fillRect(x, y, w, h);
  r.fillStyle = '#c8c8c8';
  r.fillRect(x, y, w, h);
  // Frame, with a fanlight over the door.
  g.fillStyle = '#f2f2ee';
  g.fillRect(x + 6, y + 6, w - 12, h - 6);
  const fan = 70;
  glass(g, r, x + 22, y + 20, w - 44, fan - 22, 'none', seed);
  g.fillStyle = '#f2f2ee';
  g.fillRect(x + 6, y + fan, w - 12, 12);
  const dx = x + 22, dy = y + fan + 12, dw = w - 44, dh = h - fan - 12;
  g.fillStyle = paint;
  g.fillRect(dx, dy, dw, dh);
  r.fillStyle = '#909090';
  r.fillRect(dx, dy, dw, dh);
  /** A raised (or sunk) panel. */
  const panel = (px: number, py: number, pw: number, ph: number) => {
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(px, py, pw, 4);
    g.fillRect(px, py, 4, ph);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(px, py + ph - 4, pw, 4);
    g.fillRect(px + pw - 4, py, 4, ph);
  };
  const m = 18;
  if (style === 0) {
    // Two glazed panels at the top, two raised below.
    const pw = (dw - 3 * m) / 2;
    for (const k of [0, 1]) {
      glass(g, r, dx + m + k * (pw + m), dy + m, pw, dh * 0.32, 'nets', seed + k);
      panel(dx + m + k * (pw + m), dy + dh * 0.45, pw, dh * 0.45);
    }
  } else if (style === 1) {
    // A tall narrow strip of glass up one side.
    glass(g, r, dx + dw * 0.62, dy + m, dw * 0.18, dh - 2 * m, 'none', seed);
    panel(dx + m, dy + m, dw * 0.45, dh * 0.42);
    panel(dx + m, dy + dh * 0.52, dw * 0.45, dh * 0.42);
  } else if (style === 2) {
    // A half-moon of glass and three panels.
    g.save();
    g.beginPath();
    g.arc(dx + dw / 2, dy + dh * 0.3, dw * 0.3, Math.PI, 0);
    g.closePath();
    g.clip();
    glass(g, r, dx + dw * 0.2, dy + dh * 0.3 - dw * 0.3, dw * 0.6, dw * 0.3, 'none', seed);
    g.restore();
    for (let k = 0; k < 3; k++) panel(dx + m, dy + dh * 0.36 + k * dh * 0.2, dw - 2 * m, dh * 0.16);
  } else {
    // Six panels, Georgian style.
    const pw = (dw - 3 * m) / 2;
    const ph = [dh * 0.14, dh * 0.3, dh * 0.3];
    let py = dy + m;
    for (const hh of ph) {
      panel(dx + m, py, pw, hh);
      panel(dx + 2 * m + pw, py, pw, hh);
      py += hh + m * 0.8;
    }
  }
  // Letterbox, handle and knocker in brushed steel.
  g.fillStyle = '#c9c9c4';
  g.fillRect(dx + dw * 0.3, dy + dh * 0.5, dw * 0.4, 10);
  g.fillStyle = '#3a3a38';
  g.fillRect(dx + dw * 0.32, dy + dh * 0.5 + 3, dw * 0.36, 4);
  g.fillStyle = '#d8d8d2';
  g.fillRect(dx + dw - 30, dy + dh * 0.44, 8, 46);
  g.beginPath();
  g.arc(dx + dw - 26, dy + dh * 0.44 + 70, 6, 0, Math.PI * 2);
  g.fill();
  // Weather bar at the foot.
  g.fillStyle = '#b8b8b4';
  g.fillRect(dx, dy + dh - 12, dw, 12);
  const rand = rnd(seed + 9);
  if (rand() < 0.5) {
    g.fillStyle = '#c9b46a';
    g.font = '700 20px sans-serif';
    g.textAlign = 'center';
    g.fillText(String(1 + Math.floor(rand() * 90)), dx + dw / 2, dy + dh * 0.27);
  }
}

/** An up-and-over garage door: vertical ribs in a frame, with a handle at the bottom. */
function garageCell(g: G, r: G, x: number, y: number, w: number, h: number, paint: string, rib: string): void {
  g.fillStyle = '#2a2a28';
  g.fillRect(x, y, w, h);
  r.fillStyle = '#b0b0b0';
  r.fillRect(x, y, w, h);
  g.fillStyle = '#e8e8e4';
  g.fillRect(x + 6, y + 6, w - 12, h - 6);
  g.fillStyle = paint;
  g.fillRect(x + 20, y + 20, w - 40, h - 20);
  for (let k = x + 32; k < x + w - 30; k += 18) {
    g.fillStyle = rib;
    g.fillRect(k, y + 20, 3, h - 20);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(k + 3, y + 20, 2, h - 20);
  }
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x + 20, y + 20, w - 40, 6);
  g.fillStyle = '#9a9a96';
  g.fillRect(x + w / 2 - 30, y + h - 70, 60, 14);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(x + 20, y + h - 26, w - 40, 26);
}

/** The atlas's own colours for the doors, in the order of `DOORS` in Buildings. */
export const DOOR_PAINT = ['#7a2a2a', '#2a4a7a', '#2f5a35', '#e8e8e0', '#3a3a3a', '#8a6a2a'];

let material: THREE.MeshStandardMaterial | null = null;

/** The one material all the windows and doors share. */
export function openingsMaterial(): THREE.MeshStandardMaterial {
  if (material) return material;
  const make = (fill: string): [HTMLCanvasElement, G] => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d') as G;
    g.fillStyle = fill;
    g.fillRect(0, 0, W, H);
    return [c, g];
  };
  const [cc, g] = make('#808080');
  const [rc, r] = make('#c0c0c0');
  const white = '#f3f3ef', grey = '#3d4145';
  windowCell(g, r, 0, 0, 256, 256, { frame: white, cols: [0.5], transom: 0.3, behind: 'none', seed: 11 });
  windowCell(g, r, 256, 0, 256, 256, { frame: white, cols: [0.5], transom: 0.3, behind: 'curtains', seed: 12 });
  windowCell(g, r, 512, 0, 256, 256, { frame: white, cols: [0.33, 0.67], transom: 0.28, behind: 'nets', seed: 13 });
  windowCell(g, r, 768, 0, 256, 256, { frame: grey, cols: [0.5], behind: 'blind', seed: 14 });
  windowCell(g, r, 0, 256, 256, 256, { frame: white, cols: [0.5], bars: [4, 3], behind: 'none', seed: 15 });
  windowCell(g, r, 256, 256, 256, 256, { frame: grey, cols: [0.4], transom: 0.3, behind: 'curtains', seed: 16 });
  windowCell(g, r, 512, 256, 256, 256, { frame: '#a9aeb2', cols: [0.25, 0.5, 0.75], transom: 0.35, behind: 'blind', seed: 17 });
  // The double door: two glazed leaves in grey aluminium.
  windowCell(g, r, 768, 256, 256, 256, { frame: '#5c6266', cols: [0.5], transom: 0.15, behind: 'none', seed: 18 });
  g.fillStyle = '#c9c9c4';
  g.fillRect(768 + 118, 256 + 120, 6, 50);
  g.fillRect(768 + 132, 256 + 120, 6, 50);
  DOOR_PAINT.forEach((paint, i) => {
    const c = DOOR_CELLS[i];
    doorCell(g, r, Math.round(c.u0 * W) - INSET, Math.round((1 - c.v1) * H) - INSET, 256, 512, paint, i % 4, 30 + i);
  });
  garageCell(g, r, 512, 512, 512, 448, '#ecebe6', 'rgba(0,0,0,0.14)');
  garageCell(g, r, 1024, 512, 512, 448, '#45494d', 'rgba(0,0,0,0.3)');
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.anisotropy = 8;
  material = new THREE.MeshStandardMaterial({ map, roughnessMap, roughness: 1, metalness: 0.05 });
  return material;
}

/** Textured quads for windows and doors, merged into one mesh. */
export class OpeningWriter {
  private readonly pos: number[] = [];
  private readonly norm: number[] = [];
  private readonly uv: number[] = [];

  /** A quad a-b-c-d (bottom left, bottom right, top right, top left seen from outside) showing `c`. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, cl: Cell): void {
    const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
    const put = (p: THREE.Vector3, u: number, v: number) => {
      this.pos.push(p.x, p.y, p.z);
      this.norm.push(n.x, n.y, n.z);
      this.uv.push(u, v);
    };
    put(a, cl.u0, cl.v0);
    put(b, cl.u1, cl.v0);
    put(c, cl.u1, cl.v1);
    put(a, cl.u0, cl.v0);
    put(c, cl.u1, cl.v1);
    put(d, cl.u0, cl.v1);
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  build(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, openingsMaterial());
    m.receiveShadow = true;
    return m;
  }
}
