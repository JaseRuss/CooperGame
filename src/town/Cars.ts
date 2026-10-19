import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loftGeometry, type LoftSection } from '../utils/modelKit';

/**
 * The cars parked round the town: a hatchback, an estate and an SUV, each lofted from cross
 * sections (a bonnet sloping up to the windscreen, a glasshouse with its pillars in body colour,
 * a roof) with tyres in wheel arches, alloy hubs, lights, bumpers, grille, mirrors and UK number
 * plates (white at the front, yellow at the back). Each car is three parts: the paint (coloured
 * per car), the glass, and the trim (vertex-coloured). They're drawn as three batches with every
 * car culled on its own, so the ones out of sight cost nothing. The front of each model is -z.
 */

export interface CarType {
  /** Length, width and roof height, for the collider. */
  L: number;
  W: number;
  roof: number;
  /** Wheel radius and the two axles (front, rear). */
  R: number;
  axles: [number, number];
  /** Underside of the body, the window line, the bonnet's front and the boot's top. */
  sill: number;
  belt: number;
  bonnet: number;
  tail: number;
  /** Along the car: the foot of the windscreen, the roof's front and back, and the foot of the rear window. */
  ws: number;
  rf: number;
  rr: number;
  rg: number;
  rails?: true;
}

export const CAR_TYPES: CarType[] = [
  // Hatchback: short, with a steep tailgate.
  { L: 4.0, W: 1.76, roof: 1.46, R: 0.31, axles: [-1.3, 1.22], sill: 0.3, belt: 0.92, bonnet: 0.8, tail: 0.95, ws: -0.78, rf: 0.02, rr: 1.48, rg: 1.86 },
  // Estate: long, the roof running right to the back.
  { L: 4.65, W: 1.8, roof: 1.47, R: 0.32, axles: [-1.48, 1.36], sill: 0.3, belt: 0.9, bonnet: 0.78, tail: 0.94, ws: -0.82, rf: 0.08, rr: 2.0, rg: 2.22, rails: true },
  // SUV: taller, on bigger wheels.
  { L: 4.5, W: 1.86, roof: 1.72, R: 0.37, axles: [-1.38, 1.32], sill: 0.42, belt: 1.08, bonnet: 1.0, tail: 1.1, ws: -0.82, rf: 0.0, rr: 1.86, rg: 2.12, rails: true },
];

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));

/** Position and normal only, unindexed, with an optional flat colour: so every part merges and batches. */
function part(geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, color?: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m) g.applyMatrix4(m);
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (color !== undefined) {
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  g.clearGroups();
  return g;
}

const at = (x: number, y: number, z: number, rz = 0) => new THREE.Matrix4().makeRotationZ(rz).setPosition(x, y, z);

interface CarModel {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
}

function model(t: CarType): CarModel {
  const { L, W, R, sill, belt, bonnet, tail, ws, rf, rr, rg, roof } = t;
  const f = -L / 2, b = L / 2;
  // The lower body: rounded at the nose and tail, the bonnet rising to the window line.
  const top = (z: number) => (z < ws ? lerp(bonnet, belt, (z - (f + 0.3)) / (ws - (f + 0.3))) : z > rg ? lerp(belt, tail, (z - rg) / Math.max(0.1, b - rg)) : belt);
  const lower: LoftSection[] = [];
  const ring = (z: number, shrink: number, drop: number, lift: number) => {
    const y0 = sill + lift, y1 = top(z) - drop;
    lower.push({ z, w: W * shrink, h: y1 - y0, y: (y0 + y1) / 2 });
  };
  ring(f, 0.86, 0.12, 0.12);
  ring(f + 0.07, 0.95, 0.04, 0.05);
  ring(f + 0.3, 1, 0, 0);
  for (const z of [t.axles[0], ws, (ws + rg) / 2, t.axles[1], rg]) ring(z, 1, 0, 0);
  ring(b - 0.3, 1, 0, 0);
  ring(b - 0.07, 0.96, 0.04, 0.05);
  ring(b, 0.88, 0.1, 0.12);
  lower.sort((p, q) => p.z - q.z);
  const paint: THREE.BufferGeometry[] = [part(loftGeometry(lower, 16, 4), null)];

  // The glasshouse, in paint: its sides are the pillars where the glass panels below don't cover it.
  const roofAt = (z: number) => (z < rf ? lerp(belt, roof, (z - ws) / (rf - ws)) : z > rr ? lerp(roof, belt, (z - rr) / (rg - rr)) : roof);
  const gw = (z: number) => W * (0.9 - 0.04 * Math.abs(z - (rf + rr) / 2) / ((rr - rf) / 2 + 1));
  /** A section of it at `z`, `out` metres proud of its surface all round. */
  const house = (z: number, out = 0): LoftSection => {
    const y0 = belt - 0.04, y1 = roofAt(z);
    const h = Math.max(0.02, y1 - y0);
    return { z, w: gw(z) + 2 * out, h: h + 2 * out, y: y0 + h / 2 };
  };
  const zs = [ws, (ws + rf) / 2, rf, rf + 0.12, (rf + rr) / 2, rr - 0.12, rr, (rr + rg) / 2, rg];
  paint.push(part(loftGeometry(zs.map((z) => house(z)), 14, 3), null));

  // Glass panels laid just over it: windscreen, rear window, and the side windows either side of the B pillar.
  const glass: THREE.BufferGeometry[] = [];
  // Its rings at the glasshouse's own (it's straight between them), so the glass never dips into the paint.
  const panel = (z0: number, z1: number, arc: [number, number]) => {
    const at = [z0, ...zs.filter((z) => z > z0 + 0.01 && z < z1 - 0.01), z1];
    glass.push(part(loftGeometry(at.map((z) => house(z, 0.018)), 8, 3, arc), null));
  };
  const bp = (rf + rr) / 2 - 0.05;
  panel(ws + 0.05, rf - 0.02, [0.62, Math.PI - 0.62]);
  panel(rr + 0.03, rg - 0.04, [0.62, Math.PI - 0.62]);
  for (const arc of [[-0.42, 0.42], [Math.PI - 0.42, Math.PI + 0.42]] as [number, number][]) {
    panel(ws + 0.22, bp - 0.07, arc);
    panel(bp + 0.07, rg - (t.rails ? 0.12 : 0.22), arc);
  }

  // Trim: wheels in their arches, lights, bumpers, grille, plates, mirrors and roof rails.
  const trim: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => trim.push(part(new THREE.BoxGeometry(w, h, d), at(x, y, z), color));
  const tyre = new THREE.CylinderGeometry(R, R, 0.21, 16);
  const hub = new THREE.CylinderGeometry(R * 0.58, R * 0.5, 0.03, 10);
  const arch = new THREE.CylinderGeometry(R + 0.07, R + 0.07, 0.02, 10);
  for (const z of t.axles) {
    for (const s of [-1, 1]) {
      trim.push(part(arch, at(s * (W / 2 + 0.004), R, z, Math.PI / 2), 0x151515));
      trim.push(part(tyre, at(s * (W / 2 - 0.09), R, z, Math.PI / 2), 0x1d1d1d));
      trim.push(part(hub, at(s * (W / 2 + 0.025), R, z, Math.PI / 2), 0x8e9398));
    }
  }
  const nose = f + 0.035, rear = b - 0.035;
  for (const s of [-1, 1]) {
    box(0.34, 0.11, 0.08, s * (W / 2 - 0.27), bonnet - 0.15, nose, 0xf2f2ea);
    box(0.3, 0.13, 0.06, s * (W / 2 - 0.22), tail - 0.17, rear, 0xb3201f);
    box(0.08, 0.05, 0.061, s * (W / 2 - 0.22), tail - 0.27, rear, 0xe8a23a);
    // Mirrors on stalks by the windscreen.
    box(0.2, 0.12, 0.09, s * (W / 2 + 0.07), belt + 0.08, ws + 0.25, 0x1f1f1f);
  }
  box(0.66, 0.15, 0.06, 0, bonnet - 0.3, f + 0.02, 0x222426);
  box(W * 0.9, 0.17, 0.12, 0, sill + 0.13, f + 0.03, 0x2b2b2b);
  box(W * 0.9, 0.17, 0.12, 0, sill + 0.13, b - 0.03, 0x2b2b2b);
  box(0.52, 0.11, 0.02, 0, sill + 0.13, f - 0.04, 0xf4f4f0);
  box(0.52, 0.11, 0.02, 0, sill + 0.4, b + 0.01, 0xf2c51c);
  // A dark strip along the sills.
  for (const s of [-1, 1]) box(0.04, 0.1, t.axles[1] - t.axles[0] - 2 * R - 0.2, s * (W / 2 - 0.01), sill + 0.06, (t.axles[0] + t.axles[1]) / 2, 0x2b2b2b);
  if (t.rails) for (const s of [-1, 1]) box(0.05, 0.05, rr - rf - 0.1, s * W * 0.34, roof + 0.02, (rf + rr) / 2, 0x2a2a2a);

  const merge = (list: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(list, false) as THREE.BufferGeometry;
    for (const x of list) x.dispose();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };
  return { paint: merge(paint), glass: merge(glass), trim: merge(trim) };
}

/** One parked car: which model, where (its matrix, front toward -z), and its colour. */
export interface CarPlacement {
  type: number;
  matrix: THREE.Matrix4;
  color: number;
}

/** All the parked cars, as three batched meshes added to `parent`. */
export function parkedCars(parent: THREE.Object3D, cars: CarPlacement[]): void {
  if (!cars.length) return;
  const models = CAR_TYPES.map(model);
  const materials = {
    paint: new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.12 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x27333d, roughness: 0.08, metalness: 0.4 }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
  };
  const col = new THREE.Color();
  for (const key of ['paint', 'glass', 'trim'] as const) {
    let verts = 0;
    for (const m of models) verts += m[key].attributes.position.count;
    const batch = new THREE.BatchedMesh(cars.length, verts, 0, materials[key]);
    const ids = models.map((m) => batch.addGeometry(m[key]));
    for (const c of cars) {
      const id = batch.addInstance(ids[c.type]);
      batch.setMatrixAt(id, c.matrix);
      if (key === 'paint') batch.setColorAt(id, col.setHex(c.color));
    }
    batch.castShadow = key !== 'glass';
    batch.receiveShadow = true;
    parent.add(batch);
  }
  for (const m of models) for (const g of Object.values(m)) g.dispose();
}
