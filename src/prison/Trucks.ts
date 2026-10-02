import * as THREE from 'three';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';
import { mulberry32 } from '../utils/rng';
import { plastic, shade, ARMY_TAN, ARMY_GREEN } from '../utils/plastic';
import { createFigureMesh, createCheeringFigure } from '../entities/Soldier';

/** A truck's length (nose at -Z), and how far apart along the tank's tracks they drive. */
const LENGTH = 6.4;
const FIRST_GAP = 9;
const GAP = 8.5;
/** The tank's tracks: a crumb every this far. */
const CRUMB = 0.5;
const WHEEL_RADIUS = 0.5;
/** Seats in the back: two benches facing in. */
const SEATS = 8;

let truckGeos: Map<THREE.Material, THREE.BufferGeometry> | null = null;

/** Which way a face points, for laying a decal flat on it. */
type Face = 'left' | 'right' | 'top' | 'front' | 'back';

/** Turns a flat decal (made in the XY plane, facing +Z) to lie on `face`. */
function onFace(geo: THREE.BufferGeometry, face: Face): THREE.BufferGeometry {
  if (face === 'left') return geo.rotateY(-Math.PI / 2);
  if (face === 'right') return geo.rotateY(Math.PI / 2);
  if (face === 'top') return geo.rotateX(-Math.PI / 2);
  if (face === 'front') return geo.rotateY(Math.PI);
  return geo;
}

/**
 * A slap of green paint where the escaped prisoners daubed over the tan army's markings: a rough
 * blob with spatters round it and, on an upright face, a run or two dripping down.
 */
function splash(b: PartBuilder, paint: THREE.Material, rng: () => number, face: Face, x: number, y: number, z: number, size: number): void {
  const blob = (r: number, dx: number, dy: number) => {
    // Squashed a little each way, so no two blobs are perfect circles.
    const g = new THREE.CircleGeometry(r, 9).scale(0.8 + rng() * 0.4, 0.8 + rng() * 0.4, 1).rotateZ(rng() * Math.PI);
    const at = onFace(g.translate(dx, dy, 0), face);
    b.add(at, paint, x, y, z);
  };
  blob(size, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    blob(size * (0.45 + rng() * 0.25), Math.cos(a) * size * 0.7, Math.sin(a) * size * 0.6);
  }
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const r = size * (1.25 + rng() * 0.6);
    blob(size * (0.06 + rng() * 0.08), Math.cos(a) * r, Math.sin(a) * r);
  }
  if (face === 'top') return;
  for (let i = 0; i < 2; i++) {
    const dx = (rng() - 0.5) * size * 1.2;
    const len = size * (0.6 + rng() * 0.9);
    const run = new THREE.PlaneGeometry(size * 0.12, len).translate(dx, -len / 2 - size * 0.4, 0);
    b.add(onFace(run, face), paint, x, y, z);
    blob(size * 0.09, dx, -len - size * 0.4);
  }
}

/**
 * A tan army truck, facing -Z with its wheels on y = 0, detailed like the tanks: a snub-nosed cab
 * with a louvred bonnet, split windscreen, mirrors and a ring mount on the roof; ladder chassis on
 * leaf springs with three axles and chunky treaded wheels; an open back with slatted drop sides,
 * stake posts, bare tilt hoops and a bench down each side. Captured from the tan army's motor
 * pool, so the prisoners have slapped green paint over its markings.
 */
function truckGeometry(): Map<THREE.Material, THREE.BufferGeometry> {
  const b = new PartBuilder();
  const body = plastic(ARMY_TAN);
  const dark = plastic(shade(ARMY_TAN, 0.72));
  const deep = plastic(shade(ARMY_TAN, 0.45));
  const tyre = plastic(0x2a2a2a);
  const steel = plastic(0x55585a);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fcde0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.7 });
  const lamp = plastic(0xfff3c0);
  const red = plastic(0xc8402a);
  const white = plastic(0xf4f1e4);
  const canvas = plastic(shade(ARMY_TAN, 1.1));
  const paint = plastic(ARMY_GREEN);
  const paintDark = plastic(shade(ARMY_GREEN, 0.8));
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const L = LENGTH;
  const nose = -L / 2;
  const axles = [nose + 1.1, L / 2 - 1.6, L / 2 - 0.5];

  // Ladder chassis: two rails with crossmembers.
  for (const x of [-0.55, 0.55]) b.add(box(0.14, 0.26, L - 0.3), deep, x, 0.82, 0.1);
  for (const z of [nose + 0.4, nose + 2.2, 0.4, 1.5, L / 2 - 0.2]) b.add(box(1.1, 0.12, 0.12), deep, 0, 0.82, z);

  // Axles on leaf springs, differentials on the back two, and the wheels.
  axles.forEach((z, i) => {
    b.add(tubeX(0.07, 2.0, 8), steel, 0, WHEEL_RADIUS, z);
    if (i > 0) b.add(new THREE.SphereGeometry(0.2, 10, 8), steel, 0, WHEEL_RADIUS, z, 0, 0, 0, 1, 0.9, 1.2);
    for (const x of [-0.55, 0.55]) {
      for (let leaf = 0; leaf < 3; leaf++) b.add(box(0.12, 0.04, 1.1 - leaf * 0.25), dark, x, 0.6 + leaf * 0.045, z);
      b.add(box(0.16, 0.14, 0.16), deep, x, WHEEL_RADIUS + 0.08, z); // spring clamp
    }
    for (const s of [-1, 1]) {
      const x = s * 1.05;
      b.add(tubeX(WHEEL_RADIUS, 0.38, 16), tyre, x, WHEEL_RADIUS, z);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        b.add(box(0.36, 0.07, 0.1), tyre, x, WHEEL_RADIUS + Math.cos(a) * WHEEL_RADIUS, z + Math.sin(a) * WHEEL_RADIUS, a);
      }
      b.add(tubeX(0.3, 0.4, 14), dark, x, WHEEL_RADIUS, z); // wheel rim
      b.add(tubeX(0.13, 0.44, 10), deep, x, WHEEL_RADIUS, z); // hub
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        b.add(tubeX(0.03, 0.46, 6), steel, x, WHEEL_RADIUS + Math.cos(a) * 0.2, z + Math.sin(a) * 0.2); // wheel nuts
      }
    }
  });

  // Front mudguards (a flat top and sloped ends), and mudflaps behind the back wheels.
  for (const s of [-1, 1]) {
    const z = axles[0];
    b.add(box(0.5, 0.06, 0.9), body, s * 1.05, 1.13, z);
    b.add(box(0.5, 0.06, 0.5), body, s * 1.05, 1.0, z - 0.62, 0.55);
    b.add(box(0.5, 0.06, 0.5), body, s * 1.05, 1.0, z + 0.62, -0.55);
    b.add(box(0.46, 0.5, 0.04), tyre, s * 1.05, 0.55, L / 2 + 0.1);
  }

  // The bonnet: louvres down each side, a ridge along the top, a filler cap.
  const bonnetZ = nose + 0.75;
  b.add(box(1.8, 0.8, 1.5), body, 0, 1.3, bonnetZ);
  b.add(box(0.12, 0.06, 1.5), dark, 0, 1.72, bonnetZ);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) b.add(box(0.03, 0.05, 0.18), deep, s * 0.91, 1.18 + k * 0.08, bonnetZ + 0.25);
    b.add(box(0.04, 0.04, 1.4), dark, s * 0.6, 1.71, bonnetZ); // hinge lines
  }
  // Grille with slats and a frame, headlights in brush guards, bumper, tow hooks and a winch.
  b.add(box(1.5, 0.66, 0.06), deep, 0, 1.3, nose - 0.02);
  for (let k = 0; k < 9; k++) b.add(box(0.05, 0.56, 0.05), dark, -0.6 + k * 0.15, 1.3, nose - 0.06);
  for (const s of [-1, 1]) {
    b.add(tubeZ(0.15, 0.15, 0.14, 12), dark, s * 0.72, 1.48, nose - 0.08);
    b.add(new THREE.CircleGeometry(0.12, 12).rotateY(Math.PI), lamp, s * 0.72, 1.48, nose - 0.16);
    b.add(new THREE.TorusGeometry(0.17, 0.018, 4, 10, Math.PI), deep, s * 0.72, 1.48, nose - 0.18);
    b.add(box(0.12, 0.2, 0.14), dark, s * 0.75, 0.82, nose - 0.25); // tow hooks
    b.add(box(0.06, 0.06, 0.06), lamp, s * 0.95, 1.05, nose - 0.13); // side lights
  }
  b.add(box(2.2, 0.22, 0.22), deep, 0, 0.95, nose - 0.12);
  b.add(tubeX(0.12, 0.8, 12), steel, 0, 0.95, nose - 0.3); // winch drum
  b.add(box(1.0, 0.24, 0.14), deep, 0, 0.95, nose - 0.32);

  // The cab: doors with panel lines and handles, split windscreen, side and back windows.
  const cabZ = nose + 2.1;
  b.add(box(2.1, 1.5, 1.2), body, 0, 1.7, cabZ);
  b.add(box(2.16, 0.12, 1.26), dark, 0, 2.5, cabZ); // roof
  b.add(box(2.0, 0.08, 0.05), deep, 0, 2.43, cabZ - 0.6);
  for (const s of [-1, 1]) {
    b.add(box(0.85, 0.6, 0.04), glass, s * 0.47, 2.08, cabZ - 0.63, -0.1);
    b.add(box(0.04, 0.48, 0.66), glass, s * 1.06, 2.1, cabZ - 0.05);
    b.add(box(0.03, 0.04, 0.5), deep, s * 0.47, 1.76, cabZ - 0.67, 0, 0, 0.3); // wipers
    // Door outline, handle and a step below it.
    b.add(box(0.03, 1.12, 0.04), deep, s * 1.06, 1.5, cabZ + 0.48);
    b.add(box(0.03, 0.04, 0.9), deep, s * 1.06, 0.98, cabZ + 0.04);
    b.add(box(0.05, 0.05, 0.16), steel, s * 1.08, 1.8, cabZ + 0.35);
    b.add(box(0.4, 0.05, 0.3), dark, s * 1.05, 0.72, cabZ);
    // Mirror on an arm.
    b.beam(v(s * 1.05, 2.2, cabZ - 0.5), v(s * 1.35, 2.25, cabZ - 0.55), 0.04, deep);
    b.add(box(0.06, 0.32, 0.2), dark, s * 1.38, 2.25, cabZ - 0.55);
  }
  b.add(box(0.06, 0.62, 0.06), deep, 0, 2.08, cabZ - 0.63); // windscreen centre post
  b.add(box(1.3, 0.4, 0.04), glass, 0, 2.1, cabZ + 0.61);
  // A ring mount for a machine gun over the passenger's hatch.
  b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 14), dark, 0.45, 2.58, cabZ);
  b.add(new THREE.TorusGeometry(0.42, 0.03, 5, 18), deep, 0.45, 2.75, cabZ, Math.PI / 2);
  for (const a of [0.6, 2.5, 4.4]) b.beam(v(0.45 + Math.cos(a) * 0.42, 2.75, cabZ + Math.sin(a) * 0.42), v(0.45 + Math.cos(a) * 0.3, 2.56, cabZ + Math.sin(a) * 0.3), 0.03, deep);
  // Exhaust stack up the back corner of the cab, and an air intake on the other side.
  b.add(new THREE.CylinderGeometry(0.07, 0.07, 1.7, 8), deep, 1.0, 1.8, cabZ + 0.7);
  b.add(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 8), steel, 1.0, 1.6, cabZ + 0.7); // heat shield
  b.add(new THREE.CylinderGeometry(0.09, 0.07, 0.1, 8), deep, 1.0, 2.68, cabZ + 0.7);
  b.add(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 10), dark, -1.0, 2.0, cabZ + 0.68);
  b.add(new THREE.CylinderGeometry(0.15, 0.12, 0.14, 10), deep, -1.0, 2.46, cabZ + 0.68);

  // Fuel tank down the left, toolbox and jerry cans down the right, under the bed.
  b.add(tubeZ(0.26, 0.26, 1.1, 12), dark, -0.92, 0.82, 0.35);
  for (const z of [-0.1, 0.8]) b.add(box(0.56, 0.04, 0.06), deep, -0.92, 1.08, z); // straps
  b.add(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), steel, -0.92, 1.1, 0.35);
  b.add(box(0.42, 0.34, 0.7), dark, 0.92, 0.8, 0.1);
  b.add(box(0.44, 0.04, 0.72), deep, 0.92, 0.98, 0.1);
  for (const z of [0.66, 0.92]) {
    b.add(box(0.14, 0.4, 0.24), dark, 1.0, 0.82, z);
    b.add(box(0.05, 0.06, 0.12), deep, 1.0, 1.05, z);
  }

  // The open back: floor, slatted drop sides on stake posts, a tall headboard and the tailgate.
  const back0 = nose + 2.8;
  const back1 = L / 2;
  const mid = (back0 + back1) / 2;
  const len = back1 - back0;
  b.add(box(2.3, 0.15, len), body, 0, 1.0, mid);
  b.add(box(2.34, 0.1, len + 0.04), deep, 0, 0.9, mid); // floor bearers' edge
  for (const s of [-1, 1]) {
    const x = s * 1.12;
    for (const y of [1.2, 1.45, 1.7]) b.add(box(0.07, 0.2, len), body, x, y, mid);
    b.add(box(0.1, 0.06, len + 0.04), dark, x, 1.82, mid); // top rail
    for (let z = back0 + 0.15; z < back1; z += 0.85) {
      b.add(box(0.1, 0.8, 0.09), dark, x * 1.02, 1.45, z); // stake posts
      b.add(box(0.14, 0.12, 0.12), deep, x * 1.02, 0.98, z); // stake pockets
    }
    for (const z of [back0 + 1.2, back1 - 1.0]) b.add(box(0.05, 0.08, 0.12), steel, x * 1.04, 1.55, z); // drop-side hinges
    // Benches down each side, on legs.
    b.add(box(0.4, 0.12, len - 0.3), dark, s * 0.84, 1.3, mid);
    for (let z = back0 + 0.4; z < back1 - 0.2; z += 1.0) b.add(box(0.06, 0.24, 0.06), deep, s * 0.84, 1.16, z);
  }
  // Headboard: a frame with bars, high enough to keep the riders off the cab's back window.
  b.add(box(2.3, 0.9, 0.08), body, 0, 1.5, back0);
  b.add(box(2.3, 0.08, 0.1), dark, 0, 2.45, back0);
  for (let k = 0; k < 7; k++) b.add(box(0.05, 0.5, 0.05), deep, -0.9 + k * 0.3, 2.2, back0);
  for (const s of [-1, 1]) b.add(box(0.1, 1.5, 0.1), dark, s * 1.1, 1.8, back0);
  // Tailgate: planks, chains up to the sides, tail lights, reflectors, a number plate and a step.
  for (const y of [1.2, 1.45, 1.7]) b.add(box(2.3, 0.2, 0.07), body, 0, y, back1);
  b.add(box(2.3, 0.06, 0.1), dark, 0, 1.82, back1);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 5; k++) b.add(new THREE.TorusGeometry(0.04, 0.012, 4, 6), steel, s * 1.08, 1.8 - k * 0.06, back1 + 0.05 + k * 0.012, 0, 0, k % 2 ? Math.PI / 2 : 0);
    b.add(box(0.2, 0.12, 0.06), red, s * 0.85, 0.9, back1 + 0.08);
    b.add(new THREE.CircleGeometry(0.05, 8), red, s * 0.55, 0.9, back1 + 0.11);
  }
  b.add(box(0.5, 0.2, 0.03), white, 0, 0.9, back1 + 0.1);
  b.add(box(2.0, 0.08, 0.3), deep, 0, 0.72, back1 + 0.1); // step
  // Bare tilt hoops (the canvas is rolled up behind the cab so everyone can see the riders).
  for (const z of [back0 + 0.5, mid + 0.3, back1 - 0.15]) b.add(new THREE.TorusGeometry(1.1, 0.03, 4, 14, Math.PI), deep, 0, 1.82, z, 0, 0, 0, 1, 0.75, 1);
  b.add(tubeX(0.16, 2.2, 10), canvas, 0, 2.62, back0 + 0.12);
  for (const s of [-1, 1]) b.add(box(0.05, 0.36, 0.05), deep, s * 0.7, 2.62, back0 + 0.12); // tie-downs
  // Spare jerry cans strapped behind the headboard.
  for (const x of [-0.5, -0.2]) b.add(box(0.24, 0.4, 0.14), dark, x, 1.35, back0 + 0.14);

  // The tan army's markings: a white star on each door and on the bonnet.
  const star = (r: number) => new THREE.CircleGeometry(r, 5);
  for (const s of [-1, 1]) b.add(onFace(star(0.3), s < 0 ? 'left' : 'right'), white, s * 1.06, 1.7, cabZ - 0.05);
  b.add(onFace(star(0.32), 'top'), white, 0, 1.708, bonnetZ);

  // And the green paint slapped over them (and anywhere else) by the escapees.
  const rng = mulberry32(4242);
  for (const s of [-1, 1]) {
    const face: Face = s < 0 ? 'left' : 'right';
    splash(b, paint, rng, face, s * 1.075, 1.75, cabZ, 0.32);
    splash(b, s < 0 ? paint : paintDark, rng, face, s * 1.165, 1.5, back0 + 1.0, 0.26);
    splash(b, paint, rng, face, s * 1.165, 1.6, back1 - 0.7, 0.2);
    splash(b, paintDark, rng, face, s * 0.92, 1.35, bonnetZ + 0.3, 0.16);
  }
  splash(b, paint, rng, 'top', 0.1, 1.725, bonnetZ - 0.1, 0.36);
  splash(b, paint, rng, 'back', 0.3, 1.45, back1 + 0.045, 0.3);
  splash(b, paintDark, rng, 'front', -0.5, 1.7, back0 - 0.055, 0.14);
  splash(b, paint, rng, 'top', -0.3, 2.575, cabZ + 0.2, 0.22);
  return b.buildGeometries();
}

/** Where along a bench seat `i` is (local to the truck), and which way he faces. */
function seat(i: number): { x: number; z: number; yaw: number } {
  const side = i % 2 === 0 ? -1 : 1;
  const row = Math.floor(i / 2);
  return { x: side * 0.75, z: -LENGTH / 2 + 3.4 + row * 0.85, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

interface Truck {
  root: THREE.Group;
  /** How far behind the tank (along its tracks) this one drives. */
  gap: number;
  riders: THREE.Mesh[];
}

/**
 * The trucks the prisoners ride out in. They follow the tank nose to tail along its tracks (no
 * steering of their own: the tracks are the road), slowing to a stop when it stops.
 */
export class Convoy {
  readonly group = new THREE.Group();
  private readonly trucks: Truck[] = [];
  /** The tank's tracks, oldest first (seeded with the line they're parked along). */
  private readonly trail: THREE.Vector2[] = [];

  constructor(count: number, parkedAlong: { x: number; z: number }[]) {
    truckGeos ??= truckGeometry();
    // The tracks to start with: along the parked line, a crumb every CRUMB metres.
    for (let i = 0; i + 1 < parkedAlong.length; i++) {
      const a = parkedAlong[i];
      const b = parkedAlong[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / CRUMB));
      for (let k = 0; k < n; k++) this.trail.push(new THREE.Vector2(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n));
    }
    const end = parkedAlong[parkedAlong.length - 1];
    this.trail.push(new THREE.Vector2(end.x, end.z));
    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      for (const [mat, geo] of truckGeos) {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        root.add(m);
      }
      this.group.add(root);
      this.trucks.push({ root, gap: FIRST_GAP + i * GAP, riders: [] });
    }
    this.place();
  }

  get seats(): number {
    return this.trucks.length * SEATS;
  }

  /** Sits `count` prisoners in the backs, filling the trucks in turn. */
  board(count: number): void {
    for (let i = 0; i < Math.min(count, this.seats); i++) {
      const truck = this.trucks[i % this.trucks.length];
      const s = seat(truck.riders.length);
      const man = createFigureMesh(1, ARMY_GREEN);
      man.position.set(s.x, 0.7, s.z);
      man.rotation.y = s.yaw;
      truck.root.add(man);
      truck.riders.push(man);
    }
  }

  /** The tank's moved to `x, z`: drop a crumb if it's gone far enough, and move the trucks up behind it. */
  follow(x: number, z: number): void {
    const last = this.trail[this.trail.length - 1];
    if (Math.hypot(x - last.x, z - last.y) >= CRUMB) this.trail.push(new THREE.Vector2(x, z));
    if (this.trail.length > 4000) this.trail.splice(0, this.trail.length - 4000);
    this.place();
  }

  /** At the end: everyone jumps down beside their truck and cheers. Returns where they're stood. */
  unload(): THREE.Mesh[] {
    const cheering: THREE.Mesh[] = [];
    for (const t of this.trucks) {
      t.riders.forEach((r, i) => {
        t.root.remove(r);
        const man = createCheeringFigure(ARMY_GREEN);
        const side = i % 2 === 0 ? -1 : 1;
        man.position.set(side * 2.2, 0, -LENGTH / 2 + 2.6 + Math.floor(i / 2) * 1.2).applyMatrix4(t.root.matrixWorld);
        man.position.y = 0;
        man.rotation.y = t.root.rotation.y + side * Math.PI / 2;
        this.group.add(man);
        cheering.push(man);
      });
      t.riders.length = 0;
    }
    return cheering;
  }

  /** Each truck at its distance back along the tracks, facing along them. */
  private place(): void {
    for (const t of this.trucks) {
      const at = this.back(t.gap);
      const ahead = this.back(t.gap - 2.5);
      t.root.position.set(at.x, 0, at.y);
      if (ahead.distanceTo(at) > 0.01) t.root.rotation.y = Math.atan2(-(ahead.x - at.x), -(ahead.y - at.y));
      t.root.updateMatrixWorld();
    }
  }

  /** The point `distance` metres back along the tracks from their newest end. */
  private back(distance: number): THREE.Vector2 {
    let left = Math.max(0, distance);
    for (let i = this.trail.length - 1; i > 0; i--) {
      const a = this.trail[i];
      const b = this.trail[i - 1];
      const len = a.distanceTo(b);
      if (left <= len) return a.clone().lerp(b, left / len);
      left -= len;
    }
    return this.trail[0].clone();
  }
}
