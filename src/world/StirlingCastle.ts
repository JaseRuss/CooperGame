import * as THREE from 'three';
import { PartBuilder, tubeZ } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';
import { model, prism, gableRoof, gableRoofAlongX, merlonRing, pennant, WOOD, WOOD_DARK } from './Medieval';

/**
 * The Great Castle on the siege bonus level, after Stirling Castle: the Palace of James V with its
 * statues in niches and dormered roof, the Great Hall in "Stirling gold" harling with crow-stepped
 * gables, buttresses, tall windows, a polygonal bay and a stair turret, the Chapel Royal with its
 * belfry, the King's Old Building and its stair tower, the Great Kitchens with their chimneys,
 * the Elphinstone Tower, the Grand Battery of guns, and round towers with corbelled bartizans and
 * conical slate roofs round the curtain wall. All made in code from primitives. Models stand on
 * y = 0 with their front on +Z.
 */

/** Stirling's harling is a warm ochre ("Stirling gold"); its dressed stone is a pale buff. */
export const GOLD = 0xf0cf80;
export const BUFF = 0xcdc2a4;
const BUFF_DARK = 0xa99f86;
const SLATE = 0x59636f;
const SLATE_DARK = 0x434b55;
const IRON = 0x4a4d52;
const GLOOM = 0x25211c;
const BRASS = 0xd9a520;
const LION_RED = 0xc0332a;

const buff = () => plastic(BUFF);
const buffDark = () => plastic(BUFF_DARK);
const gold = () => plastic(GOLD);
const slate = () => plastic(SLATE);
const slateDark = () => plastic(SLATE_DARK);
const iron = () => plastic(IRON);
const gloom = () => plastic(GLOOM);
const brass = () => plastic(BRASS);
const wood = () => plastic(WOOD);
const woodDark = () => plastic(WOOD_DARK);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** Places parts in a frame turned by `ry` about Y at (ox, oz): local +Z is the face's outward normal. */
type Put = (geo: THREE.BufferGeometry, mat: THREE.Material, lx: number, ly: number, lz: number, rz?: number) => void;
function frame(p: PartBuilder, ry: number, ox = 0, oz = 0): Put {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return (geo, mat, lx, ly, lz, rz = 0) => p.add(geo, mat, ox + lx * c + lz * s, ly, oz - lx * s + lz * c, 0, ry, rz);
}

// ---------- the royal standard and other flags ----------

let standardTexture: THREE.CanvasTexture | null = null;
let saltireTexture: THREE.CanvasTexture | null = null;

/** The Royal Standard of Scotland: a red lion rampant on gold, inside a red double border. */
export function royalStandard(): THREE.MeshStandardMaterial {
  if (!standardTexture) {
    const c = document.createElement('canvas');
    c.width = 192;
    c.height = 128;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(0, 0, 192, 128);
    ctx.strokeStyle = '#b8271f';
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, 180, 116);
    ctx.lineWidth = 2.5;
    ctx.strokeRect(14, 14, 164, 100);
    ctx.fillStyle = '#b8271f';
    ctx.strokeStyle = '#b8271f';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The lion, rearing to the left: body, haunch, head with a mane, raised paws, and a curled tail.
    ctx.beginPath();
    ctx.ellipse(98, 70, 20, 30, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(112, 92, 16, 14, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(80, 40, 14, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(80 + Math.cos(a) * 15, 40 + Math.sin(a) * 15, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 8;
    ctx.beginPath(); // forelegs reaching up
    ctx.moveTo(86, 64); ctx.lineTo(62, 44); ctx.moveTo(90, 72); ctx.lineTo(66, 62);
    ctx.stroke();
    ctx.beginPath(); // hind legs
    ctx.moveTo(108, 100); ctx.lineTo(96, 116); ctx.moveTo(120, 98); ctx.lineTo(124, 116);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath(); // tail
    ctx.moveTo(122, 88); ctx.bezierCurveTo(150, 84, 156, 50, 138, 36);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(136, 34, 6, 0, Math.PI * 2);
    ctx.fill();
    standardTexture = new THREE.CanvasTexture(c);
    standardTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshStandardMaterial({ map: standardTexture, side: THREE.DoubleSide });
}

/** St Andrew's cross: a white saltire on blue. */
export function saltire(): THREE.MeshStandardMaterial {
  if (!saltireTexture) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 80;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#1f5fae';
    ctx.fillRect(0, 0, 128, 80);
    ctx.strokeStyle = '#f4f4ee';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(128, 80); ctx.moveTo(128, 0); ctx.lineTo(0, 80);
    ctx.stroke();
    saltireTexture = new THREE.CanvasTexture(c);
    saltireTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshStandardMaterial({ map: saltireTexture, side: THREE.DoubleSide });
}

/** A flag on a pole at the top of a model: `material` on a plane `w` by `h`, hung from `y`. */
function addFlag(group: THREE.Group, material: THREE.Material, x: number, y: number, z: number, w = 4, h = 2.6): void {
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(w / 2, 0, 0), material);
  flag.position.set(x + 0.1, y, z);
  group.add(flag);
}

// ---------- pieces used by several buildings ----------

/**
 * A stepped (crow-stepped) gable on top of a gable wall at depth `z`, rising from the eaves at
 * `y0` over width `w` in `n` steps (Scotland's signature roofline), with coping on every step and
 * a finial on the top.
 */
function crowSteps(p: PartBuilder, w: number, y0: number, z: number, n: number, rise: number, thick = 0.9, mat: THREE.Material = buff()): void {
  const stepH = rise / n;
  const cap = buffDark();
  for (let i = 0; i < n; i++) {
    const hw = (w / 2) * (1 - i / n);
    p.add(box(hw * 2, stepH, thick), mat, 0, y0 + i * stepH + stepH / 2, z);
    p.add(box(hw * 2 + 0.2, 0.16, thick + 0.3), cap, 0, y0 + (i + 1) * stepH + 0.05, z);
  }
  p.add(box(0.9, 0.9, thick), mat, 0, y0 + rise + 0.45, z);
  p.add(new THREE.ConeGeometry(0.45, 1.1, 6), cap, 0, y0 + rise + 1.4, z);
}

/** A buttress that steps in toward the top, on a face turned by the frame. */
function buttress(put: Put, x: number, h: number, out = 1.2): void {
  put(box(0.95, h * 0.55, out), buffDark(), x, (h * 0.55) / 2, out / 2);
  put(box(0.8, h * 0.3, out * 0.6), buffDark(), x, h * 0.55 + (h * 0.3) / 2, out * 0.3);
  put(box(0.7, 0.9, 0.7).rotateX(0.0), buffDark(), x, h * 0.85 + 0.45, 0.28);
}

/** A tall round-headed window with a stone surround, mullion and transom, set in a wall face at z. */
function lancet(put: Put, x: number, y: number, z: number, w: number, h: number): void {
  put(box(w, h, 0.2), gloom(), x, y, z);
  put(new THREE.CylinderGeometry(w / 2, w / 2, 0.2, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), gloom(), x, y + h / 2, z);
  put(new THREE.TorusGeometry(w / 2 + 0.12, 0.09, 5, 12, Math.PI), buffDark(), x, y + h / 2, z + 0.08);
  for (const s of [-1, 1]) put(box(0.18, h, 0.28), buffDark(), x + s * (w / 2 + 0.09), y, z + 0.06);
  put(box(w + 0.6, 0.16, 0.42), buffDark(), x, y - h / 2 - 0.05, z + 0.1);
  put(box(0.09, h + w / 2, 0.14), buffDark(), x, y + w / 4, z + 0.05);
  put(box(w, 0.09, 0.14), buffDark(), x, y + h * 0.18, z + 0.05);
}

/** A small square window with a surround and a triangular pediment over it. */
function pedimented(put: Put, x: number, y: number, z: number, w: number, h: number, pedimentH = 0.9): void {
  put(box(w, h, 0.2), gloom(), x, y, z);
  for (const s of [-1, 1]) put(box(0.18, h + 0.1, 0.3), buffDark(), x + s * (w / 2 + 0.09), y, z + 0.06);
  put(box(w + 0.6, 0.18, 0.34), buffDark(), x, y + h / 2 + 0.05, z + 0.08);
  put(box(w + 0.6, 0.16, 0.4), buffDark(), x, y - h / 2 - 0.04, z + 0.1);
  put(prism(w + 0.8, pedimentH, 0.3), buff(), x, y + h / 2 + 0.14, z + 0.04);
  put(box(0.08, h, 0.12), buffDark(), x, y, z + 0.06);
  put(box(w, 0.08, 0.12), buffDark(), x, y + h * 0.2, z + 0.06);
}

/** A round turret hung from a wall (or standing from the ground when `from` is 0), with a corbelled base and a conical roof. */
function turret(p: PartBuilder, x: number, from: number, z: number, r: number, h: number, roofColor: number, roofH = r * 2.3): number {
  if (from > 0) p.add(new THREE.ConeGeometry(r * 0.98, 1.8, 14).rotateX(Math.PI), buff(), x, from - 0.9, z); // corbels, stepping in
  p.add(new THREE.CylinderGeometry(r, r, h, 14), buff(), x, from + h / 2, z);
  p.add(new THREE.CylinderGeometry(r + 0.18, r + 0.18, 0.3, 14), buffDark(), x, from + h, z);
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI;
    p.add(box(0.2, 1.1, 0.2), gloom(), x + Math.cos(a) * (r + 0.01), from + h * 0.55, z + Math.sin(a) * (r + 0.01));
  }
  p.add(new THREE.ConeGeometry(r + 0.45, roofH, 14), plastic(roofColor), x, from + h + 0.15 + roofH / 2, z);
  p.add(new THREE.SphereGeometry(0.22, 8, 6), brass(), x, from + h + 0.3 + roofH, z);
  return from + h + roofH;
}

/** A tall chimney stack with a cornice and clay pots. */
function chimney(p: PartBuilder, x: number, y: number, z: number, w: number, h: number): void {
  p.add(box(w, h, w), buff(), x, y + h / 2, z);
  p.add(box(w + 0.5, 0.3, w + 0.5), buffDark(), x, y + h + 0.1, z);
  for (const s of [-1, 1]) p.add(new THREE.CylinderGeometry(0.28, 0.34, 0.9, 8), plastic(0xa5502e), x + s * w * 0.22, y + h + 0.7, z);
}

/** A dormer window on a roof slope: a little gabled box with a window, standing at (x, y, z) in a frame. */
function dormer(put: Put, x: number, y: number, z: number): void {
  put(box(1.9, 1.9, 1.4), buff(), x, y + 0.95, z);
  put(box(0.9, 1.1, 0.2), gloom(), x, y + 0.95, z + 0.72);
  put(prism(2.4, 1.1, 1.8), slateDark(), x, y + 1.9, z);
  put(box(0.18, 0.18, 0.2), brass(), x, y + 3.1, z + 0.2);
}

/** A row of lead-capped cannon on carriages looking over a parapet. */
function cannon(p: PartBuilder, x: number, y: number, z: number, barrel = 3.6): void {
  p.add(tubeZ(0.4, 0.5, barrel, 10), iron(), x, y + 1.0, z - 0.3);
  p.add(tubeZ(0.52, 0.52, 0.3, 10), plastic(shade(IRON, 0.7)), x, y + 1.0, z + barrel / 2 - 0.7);
  p.add(box(1.2, 0.5, 2.2), wood(), x, y + 0.55, z);
  for (const s of [-1, 1]) p.add(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 12).rotateZ(Math.PI / 2), woodDark(), x + s * 0.75, y + 0.62, z + 0.2);
}

// ---------- the buildings ----------

/**
 * The Palace of James V: a long three-storey block in pale stone, a stringcourse between each
 * floor, small windows below, tall pedimented windows above with statues in niches between them,
 * a carved doorway with a balcony and a royal arms plaque, a gargoyled parapet, a steep slate
 * roof with six dormers and four chimney stacks, and a corbelled turret at each corner. Faces +Z.
 */
export function buildStirlingPalace(): THREE.Group {
  const g = model('stirling-palace', (p) => {
    const W = 38;
    const D = 16;
    const H = 11.5;
    const front = D / 2;
    p.add(box(W + 1.2, 1.1, D + 1.2), buffDark(), 0, 0.55, 0); // plinth
    p.add(box(W, H, D), buff(), 0, H / 2, 0);
    for (const y of [5.5, 10.9]) p.add(box(W + 0.5, 0.4, D + 0.5), buffDark(), 0, y, 0); // stringcourses
    // The front: small windows and a doorway below, tall windows and niches above.
    const put = frame(p, 0);
    for (const x of [-15, -10, -5, 5, 10, 15]) {
      pedimented(put, x, 3.1, front + 0.02, 1.2, 1.9, 0.5);
      for (const b of [-0.35, 0, 0.35]) put(box(0.07, 1.9, 0.1), iron(), x + b, 3.1, front + 0.22);
    }
    for (const x of [-16, -11, -6, 6, 11, 16]) pedimented(put, x, 8.2, front + 0.02, 1.7, 3, 1.1);
    for (const x of [-13.5, -8.5, 8.5, 13.5]) {
      // A niche with a statue standing in it on a bracket.
      put(box(1.5, 3.2, 0.2), gloom(), x, 8.2, front + 0.02);
      put(new THREE.CylinderGeometry(0.75, 0.75, 0.2, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), gloom(), x, 9.8, front + 0.02);
      put(new THREE.TorusGeometry(0.87, 0.09, 5, 10, Math.PI), buffDark(), x, 9.8, front + 0.1);
      put(box(1.1, 0.35, 0.7), buffDark(), x, 6.8, front + 0.35);
      put(new THREE.CylinderGeometry(0.3, 0.42, 1.7, 8), plastic(0xe8dfc6), x, 7.85, front + 0.4);
      put(new THREE.SphereGeometry(0.32, 10, 8), plastic(0xe8dfc6), x, 8.9, front + 0.4);
      put(new THREE.ConeGeometry(0.34, 0.5, 8), plastic(0xe8dfc6), x, 9.35, front + 0.4);
    }
    // The doorway: pilasters, an arch, doors, steps, a balcony above it and the royal arms.
    put(box(4.4, 5.2, 0.5), buffDark(), 0, 2.6, front + 0.12);
    for (const s of [-1, 1]) put(new THREE.CylinderGeometry(0.34, 0.4, 4.6, 10), buff(), s * 2.1, 2.5, front + 0.55);
    put(new THREE.CylinderGeometry(1.7, 1.7, 0.4, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), woodDark(), 0, 3.3, front + 0.4);
    put(box(3.4, 3.3, 0.3), woodDark(), 0, 1.65, front + 0.4);
    for (const y of [0.7, 1.6, 2.6]) put(box(3.5, 0.16, 0.34), iron(), 0, y, front + 0.42);
    for (let i = 0; i < 3; i++) put(box(5.6 - i * 0.4, 0.3, 1.2), buffDark(), 0, 0.15 + i * 0.3, front + 1.4 - i * 0.4);
    put(box(5.4, 0.4, 1.5), buff(), 0, 5.5, front + 0.7); // balcony slab
    for (let i = -5; i <= 5; i++) put(new THREE.CylinderGeometry(0.1, 0.14, 0.8, 6), buff(), i * 0.48, 6.1, front + 1.35);
    put(box(5.4, 0.2, 0.3), buff(), 0, 6.55, front + 1.35);
    put(box(2.6, 3.2, 0.3), buffDark(), 0, 8.4, front + 0.12); // the arms plaque
    put(box(2.1, 2.7, 0.2), plastic(0xf2c230), 0, 8.4, front + 0.3);
    put(new THREE.CylinderGeometry(0.7, 0.7, 0.18, 12).rotateX(Math.PI / 2), plastic(LION_RED), 0, 8.5, front + 0.42);
    put(box(0.5, 0.5, 0.2), plastic(LION_RED), 0.2, 7.7, front + 0.42);
    // The back has windows too.
    const back = frame(p, Math.PI);
    for (const x of [-15, -10, -5, 0, 5, 10, 15]) pedimented(back, x, 3.1, front + 0.02, 1.2, 1.9, 0.5);
    for (const x of [-16, -11, -6, 0, 6, 11, 16]) pedimented(back, x, 8.2, front + 0.02, 1.7, 3, 1.1);
    // End walls: slit windows and a stair of little stones.
    for (const s of [-1, 1]) {
      const end = frame(p, (s * Math.PI) / 2);
      for (const z of [-4, 4]) {
        pedimented(end, z, 3.1, W / 2 + 0.02, 1.2, 1.9, 0.5);
        pedimented(end, z, 8.2, W / 2 + 0.02, 1.7, 3, 1.1);
      }
    }
    // The parapet with gargoyle spouts, and the roof.
    for (const z of [front, -front]) {
      p.add(box(W + 0.4, 0.9, 0.5), buff(), 0, H + 0.45, z);
      for (let x = -W / 2 + 1.5; x < W / 2; x += 3) p.add(box(0.6, 0.6, 1.2), buffDark(), x, H - 0.5, z + Math.sign(z) * 0.5);
    }
    for (const s of [-1, 1]) p.add(box(0.5, 0.9, D), buff(), s * (W / 2), H + 0.45, 0);
    gableRoofAlongX(p, W - 1, D, 6, H + 0.9, slate(), 0.6, 0.4);
    for (const s of [-1, 1]) p.add(prism(D, 6, 0.6).rotateY(Math.PI / 2), buff(), s * (W / 2 - 0.3), H + 0.9, 0);
    // Dormers up the front slope and a few behind.
    for (const x of [-15, -9, -3, 3, 9, 15]) {
      dormer(put, x, H + 1.6, front - 2.6);
      dormer(back, x, H + 1.6, front - 2.6);
    }
    for (const [x, z] of [[-14, 0], [-6, 0], [6, 0], [14, 0]]) chimney(p, x, H + 4.6, z, 1.7, 3.4);
    // Corner turrets.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) turret(p, sx * (W / 2 - 0.2), H - 1.5, sz * (D / 2 - 0.2), 1.75, 5.4, SLATE_DARK, 5);
  });
  addFlag(g, royalStandard(), 0, 22.4, 0, 5.2, 3.4);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 7.5, 6), woodDark());
  pole.position.set(0, 19.2, 0);
  g.add(pole);
  return g;
}

/**
 * The Great Hall: a long hall in warm gold harling with pale buttresses between six tall windows
 * a side, quoins at the corners, a steep slate roof between crow-stepped gables, a polygonal bay
 * at the dais end under its own pyramid roof, a stair turret by the entrance and a banner.
 * Front (+Z) is the entrance gable.
 */
export function buildStirlingGreatHall(color: number): THREE.Group {
  const h0 = 11;
  const g = model(`stirling-hall-${color}`, (p) => {
    const w = 15;
    const len = 40;
    const h = 11;
    const rise = 8;
    p.add(box(w + 1, 1.1, len + 1), buffDark(), 0, 0.55, 0);
    p.add(box(w, h, len), gold(), 0, h / 2, 0);
    p.add(box(w + 0.5, 0.35, len + 0.5), buffDark(), 0, 5.2, 0); // string course
    // Quoins at the corners.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let y = 0.9; y < h; y += 1.5) p.add(box(0.8, 0.75, y % 3 < 1.5 ? 1.2 : 0.8), buff(), sx * (w / 2), y + 0.4, sz * (len / 2 - 0.4));
      }
    }
    // Windows and buttresses down both sides.
    for (const s of [-1, 1]) {
      const side = frame(p, (s * Math.PI) / 2);
      for (let z = -len / 2 + 3.4; z <= len / 2 - 3; z += 6.4) {
        lancet(side, z, 6.2, w / 2 + 0.02, 2, 5.6);
        lancet(side, z, 2.2, w / 2 + 0.02, 0.9, 1.7);
      }
      for (let z = -len / 2 + 6.6; z <= len / 2 - 5; z += 6.4) buttress(side, z, h);
    }
    // The roof, and a crow-stepped gable at each end.
    gableRoof(p, w, len, rise, h, gold(), slate(), 0.8, 0.4);
    crowSteps(p, w, h, len / 2, 8, rise);
    crowSteps(p, w, h, -len / 2, 8, rise);
    for (let z = -len / 2 + 2; z < len / 2; z += 4) p.add(box(0.35, 0.3, 1.6), slateDark(), 0, h + rise + 0.45, z); // ridge tiles
    // The entrance gable: a pointed doorway under three tall windows, and steps.
    const front = frame(p, 0);
    front(box(3.4, 4.6, 0.3), woodDark(), 0, 2.5, len / 2 + 0.05);
    front(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), woodDark(), 0, 4.8, len / 2 + 0.05);
    front(new THREE.TorusGeometry(1.9, 0.18, 6, 14, Math.PI), buffDark(), 0, 4.8, len / 2 + 0.2);
    for (const y of [1.2, 2.6, 4.0]) front(box(3.5, 0.18, 0.34), iron(), 0, y, len / 2 + 0.2);
    for (let i = 0; i < 4; i++) front(box(5.2 - i * 0.4, 0.3, 1.4), buffDark(), 0, 0.15 + i * 0.3, len / 2 + 1.1 - i * 0.3);
    for (const x of [-4, 0, 4]) lancet(front, x, 8.6, len / 2 + 0.02, 1.5, 4);
    // The bay at the back: an octagon that stands out of the end wall, with its own windows and roof.
    const bayZ = -len / 2 - 2.2;
    p.add(new THREE.CylinderGeometry(5.1, 5.4, h, 8).rotateY(Math.PI / 8), gold(), 0, h / 2, bayZ);
    p.add(new THREE.CylinderGeometry(5.7, 5.7, 0.4, 8).rotateY(Math.PI / 8), buffDark(), 0, 5.2, bayZ);
    p.add(new THREE.CylinderGeometry(5.7, 5.6, 0.5, 8).rotateY(Math.PI / 8), buffDark(), 0, h, bayZ);
    p.add(new THREE.ConeGeometry(6.2, 6.5, 8).rotateY(Math.PI / 8), slate(), 0, h + 3.4, bayZ);
    p.add(new THREE.SphereGeometry(0.3, 8, 6), brass(), 0, h + 6.9, bayZ);
    for (const f of [-Math.PI / 4, 0, Math.PI / 4]) {
      // Faces of the octagon pointing away from the hall (-Z): rotate about the bay's middle.
      const nx = Math.sin(Math.PI + f);
      const nz = Math.cos(Math.PI + f);
      const fr = frame(p, Math.PI + f, nx * 5.0, bayZ + nz * 5.0);
      lancet(fr, 0, 6.2, 0.1, 1.8, 5.2);
    }
    // A stair turret on the front corner, with a conical roof, and a banner on the gable.
    turret(p, w / 2 + 0.6, 0, len / 2 - 2.4, 2.4, h + 5, SLATE_DARK, 6);
    for (let i = 0; i < 6; i++) p.add(box(0.25, 1, 0.25), gloom(), w / 2 + 3.0, 2 + i * 2.2, len / 2 - 2.4 + Math.sin(i) * 0.3);
    pennant(p, color, 0, h + rise + 2, len / 2, 3.2);
    p.add(new THREE.CylinderGeometry(0.1, 0.13, 5.5, 6), woodDark(), 0, h + rise + 2.2, -len / 2);
  });
  addFlag(g, saltire(), 0, h0 + 8 + 4.6, -20, 3.8, 2.4);
  return g;
}

/**
 * The Chapel Royal: a small classical chapel with a pedimented front and round window, round
 * headed windows down the sides, an apse at the back and a belfry with a bell on the ridge.
 */
export function buildChapelRoyal(color: number): THREE.Group {
  return model(`chapel-${color}`, (p) => {
    const w = 11;
    const len = 20;
    const h = 8.5;
    p.add(box(w + 0.9, 0.9, len + 0.9), buffDark(), 0, 0.45, 0);
    p.add(box(w, h, len), buff(), 0, h / 2, 0);
    p.add(box(w + 0.5, 0.35, len + 0.5), buffDark(), 0, h - 0.3, 0);
    for (const s of [-1, 1]) {
      const side = frame(p, (s * Math.PI) / 2);
      for (let z = -len / 2 + 3.5; z <= len / 2 - 3; z += 4.6) lancet(side, z, 4.4, w / 2 + 0.02, 1.7, 4.6);
      for (let z = -len / 2 + 1.2; z <= len / 2; z += 4.6) side(box(0.7, h - 0.4, 0.45), buffDark(), z, (h - 0.4) / 2, w / 2 + 0.2);
    }
    gableRoof(p, w, len, 5.2, h, buff(), slate(), 0.7, 0.4);
    // A pediment on the front with a round window, columns, and an arched door.
    const front = frame(p, 0);
    front(prism(w + 0.6, 3.4, 0.9), buffDark(), 0, h + 0.3, len / 2 + 0.2);
    front(new THREE.TorusGeometry(0.85, 0.16, 6, 14), buffDark(), 0, h + 1.4, len / 2 + 0.7);
    front(new THREE.CylinderGeometry(0.7, 0.7, 0.2, 14).rotateX(Math.PI / 2), gloom(), 0, h + 1.4, len / 2 + 0.62);
    for (const x of [-4.6, -1.7, 1.7, 4.6]) front(new THREE.CylinderGeometry(0.34, 0.4, h - 0.8, 10), buff(), x, (h - 0.8) / 2 + 0.4, len / 2 + 0.7);
    front(box(3, 4.4, 0.3), woodDark(), 0, 2.6, len / 2 + 0.1);
    front(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), woodDark(), 0, 4.8, len / 2 + 0.1);
    for (let i = 0; i < 3; i++) front(box(5.6 - i * 0.4, 0.3, 1.4), buffDark(), 0, 0.15 + i * 0.3, len / 2 + 1.3 - i * 0.3);
    // The apse.
    p.add(new THREE.CylinderGeometry(w / 2 - 0.2, w / 2 - 0.2, h - 0.6, 12), buff(), 0, (h - 0.6) / 2, -len / 2);
    p.add(new THREE.ConeGeometry(w / 2 + 0.3, 5, 12), slate(), 0, h + 1.9, -len / 2);
    for (const a of [-0.9, 0, 0.9]) {
      const fr = frame(p, Math.PI + a, Math.sin(Math.PI + a) * (w / 2 - 0.3), -len / 2 + Math.cos(Math.PI + a) * (w / 2 - 0.3));
      lancet(fr, 0, 4.2, 0.05, 1.3, 3.6);
    }
    // The belfry on the ridge: four arched openings, a bell, an ogee cap and a golden cock.
    p.add(box(2.4, 3, 2.4), buff(), 0, h + 5.2 + 1.5, 3);
    for (const f of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const fr = frame(p, f, Math.sin(f) * 1.21, 3 + Math.cos(f) * 1.21);
      fr(box(1, 1.8, 0.2), gloom(), 0, h + 6.6, 0.02);
    }
    p.add(new THREE.SphereGeometry(0.55, 10, 8), brass(), 0, h + 6.5, 3);
    p.add(new THREE.ConeGeometry(1.9, 2.8, 8), slateDark(), 0, h + 5.2 + 3 + 1.4, 3);
    p.add(new THREE.SphereGeometry(0.4, 8, 6), brass(), 0, h + 5.2 + 3 + 3, 3);
    pennant(p, color, 0, h + 5.2 + 5.8, 3, 2);
  });
}

/**
 * The King's Old Building: a long lodging block with crow-stepped gables, two rows of dormers, tall
 * chimneys, and a round stair tower with a conical roof standing against its front. Front (+Z) is
 * the gable; the stair tower is on its east side.
 */
export function buildKingsOldBuilding(color: number): THREE.Group {
  return model(`kings-old-${color}`, (p) => {
    const w = 10;
    const len = 36;
    const h = 9.5;
    const rise = 5.6;
    p.add(box(w + 0.9, 1, len + 0.9), buffDark(), 0, 0.5, 0);
    p.add(box(w, h, len), gold(), 0, h / 2, 0);
    p.add(box(w + 0.4, 0.3, len + 0.4), buffDark(), 0, 4.8, 0);
    for (const s of [-1, 1]) {
      const side = frame(p, (s * Math.PI) / 2);
      for (let z = -len / 2 + 3; z <= len / 2 - 2; z += 4.5) {
        pedimented(side, z, 2.9, w / 2 + 0.02, 1.2, 1.8, 0.4);
        pedimented(side, z, 7.2, w / 2 + 0.02, 1.3, 2, 0.7);
      }
      for (let z = -len / 2 + 5.2; z <= len / 2 - 3; z += 9) dormer(side, z, h + 1.2, w / 2 - 2.4);
    }
    gableRoof(p, w, len, rise, h, gold(), slate(), 0.8, 0.4);
    crowSteps(p, w, h, len / 2, 6, rise);
    crowSteps(p, w, h, -len / 2, 6, rise);
    for (const z of [-10, 10]) chimney(p, 0, h + rise - 0.6, z, 1.8, 3.2);
    // The gable end: a door and windows, and a coat of arms.
    const front = frame(p, 0);
    front(box(2.6, 3.8, 0.3), woodDark(), 0, 2.1, len / 2 + 0.05);
    for (const x of [-2.6, 2.6]) pedimented(front, x, 7.2, len / 2 + 0.02, 1.3, 2, 0.7);
    front(box(1.8, 2.2, 0.2), plastic(0xf2c230), 0, 5.2, len / 2 + 0.1);
    front(new THREE.CylinderGeometry(0.5, 0.5, 0.15, 10).rotateX(Math.PI / 2), plastic(LION_RED), 0, 5.2, len / 2 + 0.22);
    // The stair tower.
    turret(p, w / 2 + 1.6, 0, 6, 3.1, h + 4.5, SLATE_DARK, 7.2);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.7;
      p.add(box(0.25, 1.2, 0.25), gloom(), w / 2 + 1.6 + Math.cos(a) * 3.12, 1.8 + i * 2.4, 6 + Math.sin(a) * 3.12);
    }
    p.add(box(1.8, 2.6, 0.3), woodDark(), w / 2 + 1.6 + 3.05, 1.5, 6);
    pennant(p, color, 0, h + rise + 3, len / 2 - 0.5, 3);
  });
}

/**
 * The Great Kitchens: a low long building of rough stone with two huge chimney stacks on its
 * side, a louvred lantern along the ridge, wide arched doorways and a lean-to larder.
 */
export function buildGreatKitchens(color: number): THREE.Group {
  return model(`kitchens-${color}`, (p) => {
    const w = 11;
    const len = 30;
    const h = 7;
    p.add(box(w + 0.8, 0.9, len + 0.8), buffDark(), 0, 0.45, 0);
    p.add(box(w, h, len), buffDark(), 0, h / 2, 0);
    p.add(box(w + 0.3, 0.3, len + 0.3), buff(), 0, 3.6, 0);
    gableRoof(p, w, len, 4.6, h, buffDark(), slate(), 0.8, 0.4);
    crowSteps(p, w, h, len / 2, 4, 4.6, 0.8, buffDark());
    crowSteps(p, w, h, -len / 2, 4, 4.6, 0.8, buffDark());
    for (const s of [-1, 1]) {
      const side = frame(p, (s * Math.PI) / 2);
      for (let z = -len / 2 + 3; z <= len / 2 - 2; z += 5) {
        // Wide arched doorways and small windows.
        if (Math.round((z + len / 2) / 5) % 2 === 0) {
          side(box(2.4, 3.6, 0.3), gloom(), z, 1.9, w / 2 + 0.02);
          side(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), gloom(), z, 3.7, w / 2 + 0.02);
          side(new THREE.TorusGeometry(1.35, 0.13, 5, 12, Math.PI), buff(), z, 3.7, w / 2 + 0.12);
        } else pedimented(side, z, 4.4, w / 2 + 0.02, 1, 1.4, 0.4);
      }
    }
    // Two tall chimney stacks standing out from one side wall, each with a corbelled top.
    for (const z of [-8, 8]) {
      p.add(box(3, 12, 3.4), buff(), w / 2 + 1.3, 6, z);
      p.add(box(3.8, 0.6, 4.2), buffDark(), w / 2 + 1.3, 12.2, z);
      p.add(box(3.2, 1.6, 3.6), buff(), w / 2 + 1.3, 13.1, z);
      for (const s of [-1, 1]) p.add(new THREE.CylinderGeometry(0.34, 0.4, 1.1, 8), plastic(0xa5502e), w / 2 + 1.3 + s * 0.8, 14.4, z);
    }
    // The louvred lantern on the ridge, to let the steam out.
    p.add(box(2.6, 1.4, 8), woodDark(), 0, h + 5.2, 0);
    for (let z = -3.4; z <= 3.4; z += 0.8) p.add(box(2.7, 0.14, 0.5), gloom(), 0, h + 5.2, z);
    gableRoof(p, 3.2, 8.4, 1.4, h + 5.9, woodDark(), slateDark(), 0.2, 0.15);
    // A lean-to larder on the far side.
    p.add(box(4, 3.6, 12), buffDark(), -w / 2 - 1.7, 1.8, 0);
    p.add(box(4.6, 0.3, 12.6), slateDark(), -w / 2 - 1.7, 3.9, 0, 0, 0, 0.3);
    pennant(p, color, 0, h + 4.6 + 1.2, len / 2, 2.6);
  });
}

/**
 * The Elphinstone Tower: a tall round tower in banded stone, slit windows spiralling up it, a
 * corbelled parapet with a ring of battlements, four little corner turrets and a tall conical roof.
 */
export function buildElphinstoneTower(): THREE.Group {
  const g = model('elphinstone', (p) => {
    const r = 5.6;
    const h = 24;
    p.add(new THREE.CylinderGeometry(r + 1.4, r + 1.9, 2.4, 20), buffDark(), 0, 1.2, 0);
    p.add(new THREE.CylinderGeometry(r, r + 0.5, h, 20), buff(), 0, h / 2, 0);
    for (let y = 5; y < h - 2; y += 5) p.add(new THREE.CylinderGeometry(r + 0.4, r + 0.4, 0.4, 20), buffDark(), 0, y, 0);
    for (let i = 0; i < 12; i++) {
      const a = i * 0.9;
      p.add(box(0.28, 1.5, 0.3), gloom(), Math.cos(a) * (r + 0.01 - i * 0.015), 3.5 + i * 1.5, Math.sin(a) * (r + 0.01 - i * 0.015));
    }
    // A corbel table (stones stepping out) under the parapet.
    for (let ring = 0; ring < 3; ring++) p.add(new THREE.CylinderGeometry(r + 0.6 + ring * 0.4, r + 0.2 + ring * 0.3, 0.5, 20), buffDark(), 0, h - 0.4 + ring * 0.5, 0);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      p.add(new THREE.ConeGeometry(0.3, 1, 5).rotateX(Math.PI), buffDark(), Math.cos(a) * (r + 0.4), h - 0.7, Math.sin(a) * (r + 0.4));
    }
    p.add(new THREE.CylinderGeometry(r + 1.5, r + 1.5, 0.4, 20), buff(), 0, h + 1.2, 0);
    merlonRing(p, buff(), r + 1.3, h + 1.3, 16, 1.3);
    // Four turrets at the diagonals, standing out of the parapet.
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) turret(p, Math.cos(a) * (r + 0.4), h - 1.2, Math.sin(a) * (r + 0.4), 1.1, 3.6, SLATE_DARK, 3.2);
    // The roof: slate cone, a lantern band and a spire.
    p.add(new THREE.ConeGeometry(r + 0.6, 10.5, 20), slate(), 0, h + 1.4 + 5.2, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      p.add(prism(1.8, 1.2, 1.4), slateDark(), Math.cos(a) * 3.3, h + 5.6, Math.sin(a) * 3.3);
      p.add(box(0.7, 0.9, 0.2), gloom(), Math.cos(a) * 3.55, h + 5.1, Math.sin(a) * 3.55);
    }
    p.add(new THREE.CylinderGeometry(0.08, 0.14, 3.2, 6), brass(), 0, h + 1.4 + 11.8, 0);
    p.add(new THREE.SphereGeometry(0.28, 8, 6), brass(), 0, h + 1.4 + 13.4, 0);
  });
  addFlag(g, royalStandard(), 0, 24 + 13.6, 0, 3.4, 2.2);
  return g;
}

/**
 * The Grand Battery: a stone gun platform with a crenellated parapet, three embrasures with a
 * cannon in each pointing out over the gate, and a stair up the back. Guns point toward +Z.
 */
export function buildGrandBattery(color: number): THREE.Group {
  return model(`battery-${color}`, (p) => {
    const w = 28;
    const d = 8;
    const h = 3.6;
    p.add(box(w + 1, 1, d + 1), buffDark(), 0, 0.5, 0);
    p.add(box(w, h, d), buffDark(), 0, h / 2, 0);
    for (let x = -w / 2 + 1; x < w / 2; x += 2) p.add(box(0.12, h - 0.4, 0.1), plastic(BUFF), x, h / 2, d / 2 + 0.01);
    // The parapet, with a gap (embrasure) in front of each gun.
    const gunX = [-8, 0, 8];
    for (let x = -w / 2 + 1; x < w / 2; x += 1.8) {
      if (gunX.some((gx) => Math.abs(x - gx) < 1.6)) continue;
      p.add(box(1.4, 1.5, 1.2), buff(), x, h + 0.75, d / 2 - 0.6);
    }
    p.add(box(w, 0.4, 0.7), buffDark(), 0, h + 0.2, d / 2 - 0.35);
    for (const s of [-1, 1]) p.add(box(1.2, 1.5, d), buff(), s * (w / 2 - 0.6), h + 0.75, 0);
    p.add(box(w, 1.4, 1.2), buff(), 0, h + 0.7, -d / 2 + 0.6);
    for (const x of gunX) {
      cannon(p, x, h, 0.4, 4.4);
      for (let i = 0; i < 4; i++) p.add(new THREE.SphereGeometry(0.34, 8, 6), iron(), x - 1.4 + (i % 2) * 0.7, h + 0.35, -2 + Math.floor(i / 2) * 0.7);
    }
    // Corbelled turrets on the two front corners, and gun loops under the parapet.
    for (const sx of [-1, 1]) turret(p, sx * (w / 2 - 0.4), 1.2, d / 2 - 0.4, 1.3, h + 0.2, SLATE_DARK, 3.2);
    for (let x = -w / 2 + 2; x < w / 2; x += 4) p.add(box(0.25, 1.1, 0.2), gloom(), x + 1, 1.7, d / 2 + 0.01);
    // A stair up the back, and a banner.
    for (let i = 0; i < 6; i++) p.add(box(3, 0.6, 0.9), buffDark(), w / 2 - 3, 0.3 + i * 0.6, -d / 2 - 0.5 - (5 - i) * 0.9);
    pennant(p, color, -w / 2 + 1, h + 1.5, -d / 2 + 0.6, 3.6);
  });
}

/** A knot garden in a hedged square: gravel paths in a cross, four coloured beds and a sundial. */
export function buildKnotGarden(): THREE.Group {
  return model('knot-garden', (p) => {
    const s = 16;
    p.add(box(s, 0.25, s), plastic(0x6f9a4a), 0, 0.12, 0);
    p.add(box(1.6, 0.3, s), plastic(0xcbb98e), 0, 0.14, 0);
    p.add(box(s, 0.3, 1.6), plastic(0xcbb98e), 0, 0.14, 0);
    const bed = [0xd9507a, 0xe8c240, 0x8a5ad1, 0xf08a3a];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
      p.add(box(5.2, 0.45, 5.2), plastic(shade(bed[i], 0.45)), sx * 4.4, 0.3, sz * 4.4);
      for (let k = 0; k < 9; k++) p.add(new THREE.SphereGeometry(0.42, 6, 5), plastic(bed[i]), sx * 4.4 + ((k % 3) - 1) * 1.5, 0.7, sz * 4.4 + (Math.floor(k / 3) - 1) * 1.5);
    });
    for (const sx of [-1, 1]) {
      p.add(box(s, 0.9, 0.7), plastic(0x2f6a32), 0, 0.5, sx * (s / 2));
      p.add(box(0.7, 0.9, s), plastic(0x2f6a32), sx * (s / 2), 0.5, 0);
    }
    p.add(new THREE.CylinderGeometry(0.5, 0.6, 1.3, 8), buffDark(), 0, 0.9, 0); // the sundial
    p.add(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 12), brass(), 0, 1.6, 0);
    p.add(box(0.08, 0.7, 0.9), brass(), 0, 2, 0.1);
  });
}

// ---------- the curtain wall ----------

/** Wall-head details for a stretch of the wall: a stringcourse and a bartizan hanging off the outer face every so often. */
export function addWallDetail(p: PartBuilder, x0: number, z0: number, x1: number, z1: number, wallHeight: number, wallThick: number, outward: number, roofColor: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const along = Math.atan2(x1 - x0, z1 - z0);
  const nx = Math.cos(along);
  const nz = -Math.sin(along);
  const n = Math.floor(len / 22);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const mx = x0 + (x1 - x0) * t;
    const mz = z0 + (z1 - z0) * t;
    turret(p, mx + nx * outward * (wallThick / 2 + 0.3), wallHeight - 0.4, mz + nz * outward * (wallThick / 2 + 0.3), 1.5, 3, roofColor, 3.4);
  }
  p.add(new THREE.BoxGeometry(wallThick + 0.5, 0.35, len), buffDark(), (x0 + x1) / 2, wallHeight * 0.55, (z0 + z1) / 2, 0, along);
}

/**
 * A big round corner tower: a banded stone drum on a battered base, a corbelled parapet, bartizans
 * round the top and a tall conical slate roof with a spire. Returns the height of the spire's tip.
 */
export function addCornerTower(p: PartBuilder, x: number, z: number): number {
  const r = 7;
  const h = 15;
  p.add(new THREE.CylinderGeometry(r + 1, r + 1.6, 2.2, 22), buffDark(), x, 1.1, z);
  p.add(new THREE.CylinderGeometry(r, r + 0.6, h, 22), buff(), x, h / 2, z);
  for (let y = 4.5; y < h - 1; y += 3.5) p.add(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.3, 22), buffDark(), x, y, z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    p.add(box(0.28, 1.6, 0.3), gloom(), x + Math.cos(a) * (r + 0.02), 8.5, z + Math.sin(a) * (r + 0.02));
  }
  for (let ring = 0; ring < 2; ring++) p.add(new THREE.CylinderGeometry(r + 0.7 + ring * 0.4, r + 0.3 + ring * 0.3, 0.5, 22), buffDark(), x, h - 0.3 + ring * 0.5, z);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    p.add(new THREE.ConeGeometry(0.34, 1.1, 5).rotateX(Math.PI), buffDark(), x + Math.cos(a) * (r + 0.4), h - 0.8, z + Math.sin(a) * (r + 0.4));
  }
  p.add(new THREE.CylinderGeometry(r + 1.3, r + 1.3, 0.4, 22), buff(), x, h + 0.9, z);
  merlonRing(p, buff(), r + 1.1, h + 1, 14, 1.5);
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    turret(p, x + Math.cos(a) * (r + 0.6), h - 1, z + Math.sin(a) * (r + 0.6), 1.2, 3.4, SLATE_DARK, 3.4);
  }
  const roofH = 13;
  p.add(new THREE.ConeGeometry(r + 0.4, roofH, 22), slate(), x, h + 1.1 + roofH / 2, z);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    p.add(prism(1.8, 1.2, 1.4).rotateY(a), slateDark(), x + Math.cos(a) * 4.4, h + 3.4, z - Math.sin(a) * 4.4);
  }
  p.add(new THREE.CylinderGeometry(0.1, 0.15, 4, 6), brass(), x, h + 1.1 + roofH + 1.6, z);
  p.add(new THREE.SphereGeometry(0.3, 8, 6), brass(), x, h + 1.1 + roofH + 3.7, z);
  return h + 1.1 + roofH + 3.7;
}

/** A gatehouse tower on the Forework: a round tower with a battered base and slit windows, and a conical roof. `out` is +1 or -1 (which way is outside). */
export function addGateTower(p: PartBuilder, x: number, z: number, out: number): number {
  const r = 4.6;
  const h = 15;
  p.add(new THREE.CylinderGeometry(r + 0.7, r + 1.2, 2, 18), buffDark(), x, 1, z);
  p.add(new THREE.CylinderGeometry(r, r + 0.4, h, 18), buff(), x, h / 2, z);
  for (let y = 4; y < h - 1; y += 3.5) p.add(new THREE.CylinderGeometry(r + 0.25, r + 0.25, 0.3, 18), buffDark(), x, y, z);
  // Gun loops and slits.
  for (const [a, y] of [[0, 6], [0.5, 9.5], [-0.5, 9.5], [0, 12]] as [number, number][]) {
    const ang = (out > 0 ? Math.PI / 2 : -Math.PI / 2) + a;
    p.add(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 8).rotateZ(Math.PI / 2).rotateY(-ang), gloom(), x + Math.cos(ang) * (r + 0.02), y, z + Math.sin(ang) * (r + 0.02));
  }
  for (let ring = 0; ring < 2; ring++) p.add(new THREE.CylinderGeometry(r + 0.5 + ring * 0.3, r + 0.2 + ring * 0.25, 0.5, 18), buffDark(), x, h - 0.3 + ring * 0.5, z);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    p.add(new THREE.ConeGeometry(0.3, 1, 5).rotateX(Math.PI), buffDark(), x + Math.cos(a) * (r + 0.3), h - 0.8, z + Math.sin(a) * (r + 0.3));
  }
  p.add(new THREE.CylinderGeometry(r + 0.9, r + 0.9, 0.4, 18), buff(), x, h + 0.9, z);
  merlonRing(p, buff(), r + 0.8, h + 1, 10, 1.3);
  const roofH = 9;
  p.add(new THREE.ConeGeometry(r + 0.2, roofH, 18), slate(), x, h + 1.1 + roofH / 2, z);
  p.add(new THREE.CylinderGeometry(0.1, 0.14, 3, 6), brass(), x, h + 1.1 + roofH + 1.2, z);
  p.add(new THREE.SphereGeometry(0.26, 8, 6), brass(), x, h + 1.1 + roofH + 2.8, z);
  return h + 1.1 + roofH + 2.8;
}

