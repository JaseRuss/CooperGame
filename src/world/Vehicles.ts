import * as THREE from 'three';
import { plastic, shade } from '../utils/plastic';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';

const TYRE = 0x2e2f2c;

function wheels(p: PartBuilder, positions: [number, number, number][], radius: number, width: number, color: number): void {
  const tyre = plastic(TYRE);
  const hub = plastic(shade(color, 0.8));
  for (const [x, y, z] of positions) {
    p.add(tubeX(radius, width, 16), tyre, x, y, z);
    p.add(tubeX(radius * 0.55, width + 0.04, 10), hub, x, y, z);
    // Chunky tread blocks round the tyre.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      p.add(new THREE.BoxGeometry(width * 0.9, 0.06, 0.1), tyre, x, y + Math.cos(a) * radius, z + Math.sin(a) * radius, a);
    }
  }
}

export interface JeepOptions {
  /** A machine gun on a post in the back (parked jeeps). */
  mountedGun?: boolean;
  /** White stars on the bonnet and sides: the green army's markings. */
  stars?: boolean;
  /** Wheels and steering wheel as separate parts that can turn (the player's jeep). */
  movingParts?: boolean;
  /** A driver in the left seat with his hands on the wheel. */
  driver?: boolean;
}

export interface JeepParts {
  group: THREE.Group;
  /** Each wheel's spin pivot: turn about its local X to roll. Empty unless `movingParts`. */
  wheels: THREE.Object3D[];
  /** The front wheels' steering pivots: turn about local Y. */
  steerPivots: THREE.Object3D[];
  /** The steering wheel: turn about its local Z (positive turns it left). */
  steeringWheel: THREE.Object3D | null;
}

const JEEP_WHEEL_RADIUS = 0.42;
const JEEP_WHEEL_WIDTH = 0.3;
/** Wheel hubs: x either side, z front and back. */
const JEEP_TRACK = 0.74;
const JEEP_AXLES = [-1.05, 1.05];
/** Where the driver sits (left seat) and where his steering wheel is. */
const DRIVER_X = -0.36;
const WHEEL_AT = new THREE.Vector3(DRIVER_X, 1.36, -0.2);
const WHEEL_TILT = -0.95; // steering wheel's face tipped up toward the driver

function starGeometry(outer: number, inner: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** A chunky off-road tyre with a dished hub, a hub cap and wheel nuts, centred on (x, y, z). */
function jeepWheel(p: PartBuilder, x: number, y: number, z: number, color: number, side: number): void {
  const tyre = plastic(TYRE);
  const hub = plastic(shade(color, 0.8));
  const deep = plastic(shade(color, 0.45));
  const r = JEEP_WHEEL_RADIUS;
  const w = JEEP_WHEEL_WIDTH;
  p.add(tubeX(r, w, 20), tyre, x, y, z);
  p.add(tubeX(r * 0.86, w + 0.02, 20), plastic(shade(TYRE, 1.25)), x, y, z); // sidewall
  p.add(tubeX(r * 0.55, w + 0.05, 14), hub, x, y, z);
  p.add(tubeX(r * 0.24, w + 0.09, 10), deep, x, y, z); // hub cap
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    p.add(tubeX(0.022, w + 0.08, 6), deep, x + side * 0.005, y + Math.cos(a) * r * 0.38, z + Math.sin(a) * r * 0.38);
  }
  // Chevron tread: two staggered rows of blocks round the tyre.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const off = (i % 2 === 0 ? 1 : -1) * w * 0.22;
    p.add(new THREE.BoxGeometry(w * 0.5, 0.07, 0.11), tyre, x + off, y + Math.cos(a) * r, z + Math.sin(a) * r, a);
  }
}

/**
 * The seated driver: a toy soldier in a jacket and helmet with goggles, both hands on the wheel.
 * Model units (the jeep's); his hips are on the left seat.
 */
function jeepDriver(p: PartBuilder, color: number): void {
  const suit = plastic(shade(color, 1.55)); // light plastic, like the tank commander, so he reads
  const kit = plastic(shade(color, 0.8));
  const x = DRIVER_X;
  const v = (dx: number, y: number, z: number) => new THREE.Vector3(x + dx, y, z);
  // Legs: thighs along the seat, shins down into the footwell.
  for (const s of [-1, 1]) {
    p.beam(v(s * 0.1, 1.13, 0.26), v(s * 0.1, 1.13, -0.16), 0.15, suit);
    p.beam(v(s * 0.1, 1.13, -0.16), v(s * 0.1, 0.72, -0.3), 0.13, suit);
    p.add(new THREE.BoxGeometry(0.13, 0.08, 0.2), kit, x + s * 0.1, 0.7, -0.36); // boots
  }
  // Body, leaning back a touch, with a belt, pouches and a strap.
  p.add(new THREE.BoxGeometry(0.36, 0.44, 0.22), suit, x, 1.44, 0.27, 0.12);
  p.add(new THREE.BoxGeometry(0.37, 0.07, 0.23), kit, x, 1.24, 0.25, 0.12);
  for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.1, 0.1, 0.05), kit, x + s * 0.1, 1.28, 0.13, 0.12);
  p.add(new THREE.BoxGeometry(0.05, 0.5, 0.235), kit, x, 1.45, 0.27, 0.12, 0, 0.7);
  // Head and neck, helmet with a brim, goggles pushed up on the front.
  p.add(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), suit, x, 1.7, 0.29);
  p.add(new THREE.SphereGeometry(0.11, 14, 10), suit, x, 1.8, 0.27);
  p.add(new THREE.BoxGeometry(0.04, 0.05, 0.05), suit, x, 1.79, 0.15); // nose
  p.add(new THREE.SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), kit, x, 1.83, 0.27);
  p.add(new THREE.CylinderGeometry(0.15, 0.15, 0.025, 16), kit, x, 1.83, 0.27);
  for (const s of [-1, 1]) p.add(tubeZ(0.035, 0.035, 0.04, 10), plastic(0x9fcde0), x + s * 0.055, 1.9, 0.15);
  p.add(new THREE.BoxGeometry(0.2, 0.02, 0.02), kit, x, 1.9, 0.15);
  // Arms reaching forward to the wheel.
  const hands = [-1, 1].map((s) => new THREE.Vector3(WHEEL_AT.x + s * 0.13, WHEEL_AT.y - 0.03, WHEEL_AT.z + 0.04));
  for (const [i, s] of [-1, 1].entries()) {
    const shoulder = v(s * 0.2, 1.6, 0.3);
    const elbow = v(s * 0.23, 1.38, 0.08);
    p.beam(shoulder, elbow, 0.1, suit, true);
    p.beam(elbow, hands[i], 0.09, suit, true);
    p.add(new THREE.SphereGeometry(0.05, 8, 6), suit, hands[i].x, hands[i].y, hands[i].z);
  }
}

/**
 * A toy army jeep (nose toward -Z), about 3.8 m long in model units: flat fenders, a slotted
 * grille with the headlights in it, fold-down windscreen, bucket seats, a spare wheel and jerry
 * can on the back, tools on the side, and axles and leaf springs underneath.
 */
export function buildJeepParts(color: number, opts: JeepOptions = {}): JeepParts {
  const { mountedGun = true, stars = true, movingParts = false, driver = false } = opts;
  const g = new THREE.Group();
  const p = new PartBuilder();
  const body = plastic(color);
  const dark = plastic(shade(color, 0.7));
  const deep = plastic(shade(color, 0.45));
  const white = plastic(0xf4f1e4);
  const steel = plastic(0x6b7166);
  const wood = plastic(0x9a7a4a);
  const lens = plastic(0xfff3c0);
  const red = plastic(0xc0392b);
  const amber = plastic(0xffa020);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fcde0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.45 });
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  // Underneath: frame rails, axles with their diff housings, and leaf springs.
  for (const s of [-1, 1]) p.add(box(0.1, 0.12, 3.3), deep, s * 0.42, 0.5, 0);
  for (const z of JEEP_AXLES) {
    p.add(tubeX(0.06, JEEP_TRACK * 2 - 0.3, 8), deep, 0, JEEP_WHEEL_RADIUS, z);
    p.add(new THREE.SphereGeometry(0.15, 10, 8), deep, 0.12, JEEP_WHEEL_RADIUS, z);
    for (const s of [-1, 1]) {
      p.add(box(0.08, 0.05, 0.85), steel, s * 0.42, 0.44, z);
      p.add(box(0.08, 0.04, 0.6), steel, s * 0.42, 0.4, z);
    }
  }

  // Body tub, with the open "door" cut between the cowl and the rear quarters.
  p.add(box(1.44, 0.42, 2.36), body, 0, 0.76, 0.33);
  for (const s of [-1, 1]) {
    p.add(box(0.07, 0.24, 1.08), body, s * 0.705, 1.08, 0.96); // rear quarter
    p.add(box(0.1, 0.04, 1.08), dark, s * 0.705, 1.21, 0.96); // its top edge
    p.add(new THREE.TorusGeometry(0.07, 0.015, 6, 10, Math.PI), deep, s * 0.745, 1.1, 0.5, 0, Math.PI / 2, 0); // grab handle
    p.add(box(0.06, 0.03, 0.9), dark, s * 0.725, 0.57, 0.33); // sill
  }
  p.add(box(1.44, 0.6, 0.07), body, 0, 0.89, 1.5); // tailgate
  p.add(box(1.44, 0.04, 0.1), dark, 0, 1.2, 1.5);
  // Cowl, and the bonnet with its hinge, latches and louvres.
  p.add(box(1.44, 0.48, 0.34), body, 0, 0.97, -0.7);
  p.add(box(1.3, 0.32, 1.02), body, 0, 1.0, -1.38);
  p.add(box(0.04, 0.03, 1.02), dark, 0, 1.175, -1.38);
  for (const s of [-1, 1]) {
    p.add(box(0.03, 0.12, 0.06), deep, s * 0.66, 1.03, -1.1);
    for (let i = 0; i < 4; i++) p.add(box(0.02, 0.1, 0.03), deep, s * 0.655, 0.97, -1.7 + i * 0.08);
  }
  // Slotted grille with the headlights set into it, and blackout lamps above.
  p.add(box(1.24, 0.52, 0.05), deep, 0, 0.96, -1.9);
  for (let i = 0; i < 7; i++) p.add(box(0.06, 0.44, 0.06), body, -0.33 + i * 0.11, 0.96, -1.93);
  for (const s of [-1, 1]) {
    p.add(tubeZ(0.12, 0.12, 0.07, 14), dark, s * 0.49, 0.98, -1.93);
    p.add(tubeZ(0.09, 0.09, 0.02, 14), lens, s * 0.49, 0.98, -1.97);
    p.add(box(0.08, 0.05, 0.05), amber, s * 0.5, 1.17, -1.9);
  }
  // Flat front fenders dipping down at the front, with side lamps; rear wheel arches.
  for (const s of [-1, 1]) {
    p.add(box(0.3, 0.05, 1.0), body, s * 0.8, 0.9, -1.28);
    p.add(box(0.3, 0.05, 0.3), body, s * 0.8, 0.84, -1.9, -0.6);
    p.add(box(0.04, 0.16, 0.95), dark, s * 0.66, 0.84, -1.28); // splash panel
    p.add(box(0.1, 0.07, 0.12), amber, s * 0.86, 0.96, -1.55);
    p.add(box(0.22, 0.05, 0.95), body, s * 0.79, 0.93, 1.05);
    p.add(box(0.05, 0.12, 0.95), body, s * 0.9, 0.87, 1.05);
  }
  // Bumpers, tow shackles, tail lights and a towing hitch.
  p.add(box(1.76, 0.13, 0.13), deep, 0, 0.55, -1.98);
  for (const s of [-1, 1]) {
    p.add(new THREE.TorusGeometry(0.06, 0.02, 6, 10, Math.PI), steel, s * 0.42, 0.56, -2.06, Math.PI / 2, 0, 0);
    p.add(box(0.2, 0.12, 0.14), deep, s * 0.6, 0.55, 1.58);
    p.add(box(0.12, 0.08, 0.04), red, s * 0.56, 0.99, 1.545);
  }
  p.add(box(0.1, 0.1, 0.16), deep, 0, 0.55, 1.62);

  // Windscreen: frame, two panes, centre bar, wipers and a mirror.
  p.add(box(1.44, 0.07, 0.07), dark, 0, 1.22, -0.55);
  p.add(box(1.44, 0.06, 0.06), dark, 0, 1.73, -0.55);
  for (const s of [-1, 1]) {
    p.add(box(0.06, 0.5, 0.06), dark, s * 0.69, 1.47, -0.55);
    p.add(box(0.64, 0.44, 0.02), glass, s * 0.34, 1.47, -0.55);
    p.add(box(0.02, 0.3, 0.02), deep, s * 0.3, 1.58, -0.575, 0, 0, s * 0.4);
    p.add(tubeX(0.035, 0.1, 8), deep, s * 0.72, 1.22, -0.55); // hinge
  }
  p.add(box(0.04, 0.5, 0.04), dark, 0, 1.47, -0.55);
  p.add(box(0.03, 0.18, 0.03), deep, -0.76, 1.62, -0.55);
  p.add(box(0.15, 0.1, 0.03), steel, -0.8, 1.72, -0.55);

  // Dashboard with gauges and a glovebox; the steering column.
  p.add(box(1.36, 0.22, 0.12), dark, 0, 1.08, -0.48);
  for (const gx of [-0.46, -0.28, 0.08]) {
    p.add(tubeZ(0.055, 0.055, 0.02, 12), deep, gx, 1.1, -0.415);
    p.add(tubeZ(0.04, 0.04, 0.02, 12), white, gx, 1.1, -0.405);
  }
  p.add(box(0.3, 0.12, 0.02), deep, 0.38, 1.08, -0.415);
  const colBase = new THREE.Vector3(DRIVER_X, 1.02, -0.48);
  p.beam(colBase, WHEEL_AT, 0.05, deep, true);

  // Bucket seats in front, a bench across the back.
  for (const s of [-1, 1]) {
    p.add(box(0.46, 0.1, 0.44), dark, s * 0.36, 1.0, 0.14);
    p.add(box(0.46, 0.5, 0.1), dark, s * 0.36, 1.28, 0.38, 0.12);
    p.add(box(0.36, 0.03, 0.35), deep, s * 0.36, 1.06, 0.14); // cushion
  }
  p.add(box(1.2, 0.1, 0.36), dark, 0, 1.0, 1.1);
  p.add(box(1.2, 0.3, 0.07), dark, 0, 1.2, 1.43);

  // Shovel and axe strapped to the driver's side.
  p.add(box(0.04, 0.04, 0.8), wood, -0.75, 0.82, 0.98);
  p.add(box(0.02, 0.16, 0.2), steel, -0.75, 0.82, 1.45);
  p.add(box(0.04, 0.04, 0.6), wood, -0.75, 0.68, 0.9);
  p.add(box(0.02, 0.14, 0.12), steel, -0.75, 0.7, 0.58);
  for (const z of [0.7, 1.2]) p.add(box(0.05, 0.22, 0.04), deep, -0.745, 0.75, z);

  // Jerry can on the back (embossed X, triple handle), and a whip aerial.
  p.add(box(0.26, 0.42, 0.16), dark, -0.45, 0.98, 1.62);
  for (const s of [-1, 1]) p.add(box(0.03, 0.44, 0.02), deep, -0.45, 0.98, 1.705, 0, 0, s * 0.55);
  for (let i = -1; i <= 1; i++) p.add(box(0.03, 0.06, 0.1), deep, -0.45 + i * 0.07, 1.22, 1.62);
  p.add(box(0.1, 0.12, 0.1), deep, 0.66, 1.26, 1.45);
  p.add(new THREE.CylinderGeometry(0.012, 0.016, 2.4, 5), deep, 0.66, 2.5, 1.45);

  if (stars) {
    // White stars on the bonnet and on both sides of the tub.
    p.add(starGeometry(0.26, 0.1), white, 0, 1.168, -1.38, -Math.PI / 2);
    for (const s of [-1, 1]) p.add(starGeometry(0.17, 0.066), white, s * 0.743, 0.76, 0.02, 0, (s * Math.PI) / 2, 0);
  }
  if (mountedGun) {
    // Mounted machine gun on a post in the back.
    p.add(box(0.08, 0.8, 0.08), deep, 0, 1.4, 0.8);
    p.add(box(0.12, 0.14, 0.6), dark, 0, 1.85, 0.65);
    p.add(tubeZ(0.03, 0.03, 0.6, 6), deep, 0, 1.87, 0.1);
  }
  if (driver) jeepDriver(p, color);
  p.buildInto(g);

  // Spare wheel on the tailgate.
  const spare = new PartBuilder();
  jeepWheel(spare, 0, 0, 0, color, 1);
  const spareMount = new THREE.Group();
  spareMount.position.set(0.28, 0.98, 1.72);
  spareMount.rotation.y = Math.PI / 2;
  spare.buildInto(spareMount);
  g.add(spareMount);

  const parts: JeepParts = { group: g, wheels: [], steerPivots: [], steeringWheel: null };
  if (movingParts) {
    for (const z of JEEP_AXLES) {
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group(); // steers (front) or just holds the wheel
        pivot.position.set(s * JEEP_TRACK, JEEP_WHEEL_RADIUS, z);
        const spin = new THREE.Group();
        const w = new PartBuilder();
        jeepWheel(w, 0, 0, 0, color, s);
        w.buildInto(spin);
        pivot.add(spin);
        g.add(pivot);
        parts.wheels.push(spin);
        if (z < 0) parts.steerPivots.push(pivot);
      }
    }
  } else {
    const w = new PartBuilder();
    for (const z of JEEP_AXLES) for (const s of [-1, 1]) jeepWheel(w, s * JEEP_TRACK, JEEP_WHEEL_RADIUS, z, color, s);
    w.buildInto(g);
  }

  // Steering wheel: rim, three spokes and a boss, tipped up toward the driver.
  const steer = new PartBuilder();
  steer.add(new THREE.TorusGeometry(0.17, 0.025, 6, 20), deep, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
    steer.add(box(0.02, 0.17, 0.02), deep, Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0, 0, 0, a - Math.PI / 2);
  }
  steer.add(tubeZ(0.04, 0.04, 0.04, 10), dark, 0, 0, 0);
  const tilt = new THREE.Group();
  tilt.position.copy(WHEEL_AT);
  tilt.rotation.x = WHEEL_TILT;
  const wheelSpin = new THREE.Group();
  steer.buildInto(wheelSpin);
  tilt.add(wheelSpin);
  g.add(tilt);
  if (movingParts) parts.steeringWheel = wheelSpin;
  return parts;
}

/** A parked toy jeep (nose toward -Z); see buildJeepParts for the options. */
export function buildJeep(color: number, opts: JeepOptions = {}): THREE.Group {
  return buildJeepParts(color, opts).group;
}

/** A toy army lorry with a canvas-covered load bed (nose toward -Z), about 6.5m long. */
export function buildTruck(color: number): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const body = plastic(color);
  const dark = plastic(shade(color, 0.7));
  const deep = plastic(shade(color, 0.45));
  const canvas = plastic(shade(color, 1.12));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fcde0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.7 });
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  p.add(box(1.8, 0.25, 6.2), deep, 0, 0.85, 0); // chassis rails
  // Cab: bonnet, cab box, windows, grille, bumper, lamps.
  p.add(box(1.9, 0.8, 1.3), body, 0, 1.4, -2.45);
  p.add(box(2.1, 1.2, 1.4), body, 0, 1.85, -1.2);
  p.add(box(1.9, 0.55, 0.04), glass, 0, 2.15, -1.92);
  for (const s of [-1, 1]) {
    p.add(box(0.04, 0.5, 0.8), glass, s * 1.06, 2.15, -1.25);
    p.add(tubeZ(0.14, 0.14, 0.1, 10), deep, s * 0.7, 1.5, -3.12);
    p.add(box(0.5, 0.08, 1.4), body, s * 1.0, 1.1, -2.4, 0.1); // mudguards
    p.add(box(0.08, 0.5, 0.08), deep, s * 1.15, 2.1, -1.95); // mirror arm
    p.add(box(0.06, 0.28, 0.2), deep, s * 1.2, 2.35, -1.95);
    p.add(box(0.36, 0.2, 0.5), dark, s * 0.95, 0.75, -0.5); // fuel tank / step
  }
  p.add(box(1.5, 0.6, 0.06), deep, 0, 1.4, -3.12);
  for (let i = 0; i < 8; i++) p.add(box(0.06, 0.5, 0.04), dark, -0.63 + i * 0.18, 1.4, -3.16);
  p.add(box(2.2, 0.2, 0.2), deep, 0, 0.9, -3.2);
  p.add(box(2.14, 0.12, 1.46), dark, 0, 2.5, -1.2); // cab roof
  // Load bed with drop sides and a canvas tilt over hoops.
  p.add(box(2.3, 0.18, 4.0), body, 0, 1.1, 1.1);
  for (const s of [-1, 1]) p.add(box(0.08, 0.6, 4.0), body, s * 1.12, 1.48, 1.1);
  p.add(box(2.3, 0.6, 0.08), body, 0, 1.48, 3.08);
  // Half-cylinder along Z with the curve on top (thetaStart π/2 puts the arc above the axis).
  const tilt = new THREE.CylinderGeometry(1.15, 1.15, 3.9, 16, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
  p.add(tilt, canvas, 0, 2.4, 1.1, 0, 0, 0, 1, 0.6, 1);
  p.add(box(2.3, 0.9, 3.9), canvas, 0, 1.95, 1.1);
  for (const z of [-0.6, 0.5, 1.6, 2.7]) p.add(new THREE.TorusGeometry(1.17, 0.035, 4, 12, Math.PI), deep, 0, 2.4, z, 0, 0, 0, 1, 0.6, 1);
  p.add(tubeX(0.12, 2.0, 8), dark, 0, 2.8, 3.07); // rolled-up rear flap
  p.buildInto(g);

  const w = new PartBuilder();
  const y = 0.55;
  wheels(w, [[-1.0, y, -2.35], [1.0, y, -2.35], [-1.0, y, 0.6], [1.0, y, 0.6], [-1.0, y, 1.85], [1.0, y, 1.85]], 0.55, 0.36, color);
  w.buildInto(g);
  return g;
}
