import * as THREE from 'three';
import { PartBuilder, loftGeometry, tubeX, tubeZ } from '../utils/modelKit';
import { plastic, shade, ARMY_RED } from '../utils/plastic';

/**
 * The toy sports bike, laid out at real motorbike size (metres) and scaled up to the toy army's
 * scale: about 3.3 m long, so it fills the same collider as the tank. Ground at y = 0, facing -Z.
 */
export const BIKE_SCALE = 1.55;
/** Tyre radius before BIKE_SCALE, for rolling the wheels at the right speed. */
export const BIKE_WHEEL_RADIUS = 0.31;

const FRONT_AXLE = new THREE.Vector3(0, BIKE_WHEEL_RADIUS, -0.72);
const REAR_AXLE = new THREE.Vector3(0, BIKE_WHEEL_RADIUS, 0.72);
/** Top of the steering head; the forks run from here down to the front axle. */
const HEAD = new THREE.Vector3(0, 0.95, -0.47);
const SWINGARM_PIVOT = new THREE.Vector3(0, 0.48, 0.16);
/** The rider's hands on the grips (bike space). */
const GRIP_Y = 0.9;
/** The two booster rockets run along each side of the tail. */
const BOOSTER_X = 0.3;
const BOOSTER_Y = 0.6;
const BOOSTER_FRONT = 0.03;
const BOOSTER_BACK = 0.73;
const BOOSTER_RADIUS = 0.085;

export interface MotorbikeParts {
  /** Ground at y = 0 under the middle of the bike, facing -Z, already scaled. */
  group: THREE.Group;
  frontWheel: THREE.Group;
  rearWheel: THREE.Group;
  /** Turns on its Y axis to steer the forks, front wheel and bars. */
  steer: THREE.Group;
  /** The booster exhaust flames (shown while they fire), one per booster. */
  flames: THREE.Object3D[];
  /** The six missiles in the booster racks, three a side: where each launches from, and hidden once fired. */
  missiles: THREE.Object3D[];
  /** The twin machine guns' muzzles, left and right; the gun fires from them in turn. */
  muzzles: THREE.Object3D[];
}

function starShape(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

/** A spoked sports wheel on its axle (along X): tyre, rim, five spokes, hub and brake discs. */
function buildWheel(front: boolean, mats: Record<'tyre' | 'rim' | 'steel' | 'dark', THREE.Material>): THREE.Group {
  const r = BIKE_WHEEL_RADIUS;
  const tyre = front ? 0.062 : 0.08;
  const rimR = r - tyre - 0.02;
  const b = new PartBuilder();
  b.add(new THREE.TorusGeometry(r - tyre, tyre, 10, 40).rotateY(Math.PI / 2), mats.tyre);
  b.add(new THREE.TorusGeometry(rimR, 0.018, 6, 36).rotateY(Math.PI / 2), mats.rim, 0.035);
  b.add(new THREE.TorusGeometry(rimR, 0.018, 6, 36).rotateY(Math.PI / 2), mats.rim, -0.035);
  b.add(tubeX(0.05, front ? 0.13 : 0.18, 14), mats.steel);
  const spoke = new THREE.BoxGeometry(0.03, rimR - 0.04, 0.045);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const mid = (rimR + 0.04) / 2;
    b.add(spoke, mats.rim, 0, Math.cos(a) * mid, Math.sin(a) * mid, a);
  }
  if (front) {
    for (const x of [-0.078, 0.078]) b.add(tubeX(0.15, 0.008, 28), mats.steel, x);
  } else {
    b.add(tubeX(0.11, 0.008, 24), mats.steel, 0.075);
    // The rear sprocket, on the chain side (left).
    b.add(tubeX(0.1, 0.012, 20), mats.dark, -0.085);
  }
  const wheel = new THREE.Group();
  b.buildInto(wheel);
  return wheel;
}

/**
 * The rider: leaning over the tank in a ribbed jacket and helmet with a dark visor, hands on the
 * grips and boots on the pegs, in the same two plastic shades as the tank commander.
 */
function addRider(b: PartBuilder, skin: THREE.Material, kit: THREE.Material, black: THREE.Material, visor: THREE.Material): void {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const hip = v(0, 0.93, 0.24);
  const lean = -0.8; // forward, toward the bars
  const up = v(0, Math.cos(lean), Math.sin(lean));
  const torsoLen = 0.46;
  // Seat of the trousers, then the jacket leaning forward.
  b.add(new THREE.BoxGeometry(0.3, 0.14, 0.24), kit, hip.x, hip.y, hip.z);
  const chest = hip.clone().addScaledVector(up, torsoLen / 2);
  b.add(new THREE.CylinderGeometry(0.13, 0.155, torsoLen, 14), skin, chest.x, chest.y, chest.z, lean, 0, 0, 1, 1, 0.72);
  // Jacket belt and a backpack radio.
  b.add(new THREE.CylinderGeometry(0.158, 0.158, 0.05, 14), kit, hip.x, hip.y + 0.06, hip.z - 0.01, lean, 0, 0, 1, 1, 0.72);
  const back = chest.clone().add(v(0, 0.07, 0.09));
  b.add(new THREE.BoxGeometry(0.2, 0.2, 0.08), kit, back.x, back.y, back.z, lean);
  const neck = hip.clone().addScaledVector(up, torsoLen);
  // Helmet, with a dark visor and a chin guard.
  const head = neck.clone().add(v(0, 0.1, -0.06));
  b.add(new THREE.SphereGeometry(0.125, 16, 12), kit, head.x, head.y, head.z, 0, 0, 0, 1, 0.95, 1.08);
  // (The sphere's phi = -PI/2 faces -Z: the visor wraps round the front, just proud of the helmet.)
  b.add(new THREE.SphereGeometry(0.128, 14, 6, -Math.PI * 0.85, Math.PI * 0.7, Math.PI * 0.34, Math.PI * 0.26), visor, head.x, head.y, head.z - 0.012);
  b.add(new THREE.BoxGeometry(0.16, 0.05, 0.06), kit, head.x, head.y - 0.09, head.z - 0.1);
  b.add(new THREE.BoxGeometry(0.03, 0.05, 0.22), skin, head.x, head.y + 0.1, head.z + 0.02); // a stripe down the middle
  // Arms from the shoulders to the grips, bent at the elbows; gloves on the grips.
  for (const s of [-1, 1]) {
    const shoulder = neck.clone().add(v(s * 0.17, -0.04, 0.02));
    const grip = v(s * 0.36, GRIP_Y, -0.37);
    const elbow = v(s * 0.3, 1.02, -0.18);
    b.beam(shoulder, elbow, 0.1, skin, true);
    b.beam(elbow, grip, 0.085, skin, true);
    b.add(new THREE.SphereGeometry(0.06, 10, 8), skin, shoulder.x, shoulder.y, shoulder.z);
    b.add(new THREE.SphereGeometry(0.052, 10, 8), kit, grip.x, grip.y, grip.z);
    // Legs: thighs along the tank to the knees, shins down to boots on the pegs.
    const hipJoint = v(s * 0.12, 0.92, 0.22);
    const knee = v(s * 0.21, 0.79, -0.06);
    const peg = v(s * 0.18, 0.46, 0.18);
    b.beam(hipJoint, knee, 0.13, kit, true);
    b.beam(knee, peg.clone().add(v(0, 0.06, 0)), 0.11, kit, true);
    b.add(new THREE.SphereGeometry(0.066, 10, 8), kit, knee.x, knee.y, knee.z);
    b.add(new THREE.BoxGeometry(0.09, 0.1, 0.2), black, peg.x, peg.y + 0.02, peg.z - 0.03);
  }
}

/** Builds the bike. `color` is the army's plastic. */
export function buildMotorbike(color: number): MotorbikeParts {
  const body = plastic(shade(color, 1.05));
  const dark = plastic(shade(color, 0.6));
  const black = plastic(0x1e2119);
  const tyre = plastic(0x232521);
  const steel = plastic(0x8f958c);
  const engineMetal = plastic(0x4d524a);
  const white = plastic(0xf4f1e4);
  const red = plastic(ARMY_RED);
  const yellow = plastic(0xe0b83a);
  const skin = plastic(shade(color, 1.55));
  const kit = plastic(shade(color, 0.8));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x2c3a40, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.6 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x1a2226, roughness: 0.05, clearcoat: 1 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff4c8, emissive: 0xffe9a0, emissiveIntensity: 0.9 });
  const tailLamp = new THREE.MeshStandardMaterial({ color: 0xff4030, emissive: 0xc01810, emissiveIntensity: 0.8 });
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  const group = new THREE.Group();
  const bike = new THREE.Group();
  bike.scale.setScalar(BIKE_SCALE);
  group.add(bike);
  const b = new PartBuilder();

  // ---- frame, swingarm and suspension ----
  for (const s of [-1, 1]) {
    b.beam(v(s * 0.1, 0.9, -0.46), v(s * 0.13, 0.55, 0.14), 0.085, dark);
    b.beam(v(s * 0.11, 0.49, 0.15), v(s * 0.11, BIKE_WHEEL_RADIUS, REAR_AXLE.z), 0.065, dark);
    b.add(tubeX(0.035, 0.05, 10), steel, s * 0.14, BIKE_WHEEL_RADIUS, REAR_AXLE.z); // axle nuts
  }
  b.add(tubeX(0.045, 0.3, 12), steel, 0, SWINGARM_PIVOT.y, SWINGARM_PIVOT.z);
  // Rear shock: body and spring.
  b.beam(v(0, 0.44, 0.24), v(0, 0.78, 0.05), 0.04, steel, true);
  for (let i = 0; i < 6; i++) {
    const t = 0.25 + i * 0.1;
    const p = v(0, 0.44, 0.24).lerp(v(0, 0.78, 0.05), t);
    b.add(new THREE.TorusGeometry(0.035, 0.009, 6, 12).rotateX(Math.PI / 2), yellow, p.x, p.y, p.z, -0.51);
  }

  // ---- engine ----
  b.add(new THREE.BoxGeometry(0.3, 0.3, 0.4), engineMetal, 0, 0.42, -0.08);
  for (const s of [-1, 1]) b.add(tubeX(0.13, 0.05, 20), dark, s * 0.16, 0.37, -0.02); // clutch and alternator covers
  // Four cylinders leaning forward under the tank, with cooling fins.
  b.add(new THREE.BoxGeometry(0.28, 0.2, 0.18), engineMetal, 0, 0.64, -0.22, -0.4);
  for (let i = 0; i < 5; i++) b.add(new THREE.BoxGeometry(0.32, 0.014, 0.2), steel, 0, 0.57 + i * 0.035, -0.19 - i * 0.014, -0.4);
  // Radiator with a grille.
  b.add(new THREE.BoxGeometry(0.34, 0.26, 0.04), dark, 0, 0.62, -0.42, 0.2);
  for (let i = 0; i < 5; i++) b.add(new THREE.BoxGeometry(0.3, 0.012, 0.012), black, 0, 0.52 + i * 0.045, -0.445 - i * 0.009, 0.2);
  // Exhaust: headers down under the engine, back to a silencer on the right.
  b.beam(v(0, 0.55, -0.34), v(0.02, 0.2, -0.22), 0.05, steel, true);
  b.beam(v(0.02, 0.2, -0.22), v(0.1, 0.2, 0.18), 0.055, steel, true);
  b.beam(v(0.1, 0.2, 0.18), v(0.17, 0.36, 0.4), 0.055, steel, true);
  b.add(tubeZ(0.07, 0.075, 0.42, 16), steel, 0.19, 0.44, 0.58, 0.35);
  b.add(tubeZ(0.045, 0.045, 0.05, 12), black, 0.19, 0.51, 0.79, 0.35);
  // Chain, on the left, from the gearbox sprocket to the rear one.
  b.add(tubeX(0.05, 0.02, 12), dark, -0.16, 0.36, 0.02);
  b.beam(v(-0.16, 0.41, 0.02), v(-0.09, BIKE_WHEEL_RADIUS + 0.1, REAR_AXLE.z), 0.02, black);
  b.beam(v(-0.16, 0.31, 0.02), v(-0.09, BIKE_WHEEL_RADIUS - 0.1, REAR_AXLE.z), 0.02, black);
  // Belly pan under the engine.
  b.add(
    loftGeometry([
      { z: -0.4, w: 0.34, h: 0.12, y: 0.36 },
      { z: -0.2, w: 0.4, h: 0.12, y: 0.27 },
      { z: 0.08, w: 0.34, h: 0.1, y: 0.24 },
    ], 20, 3),
    body,
  );

  // ---- bodywork: fuel tank, seat, tail, fairing ----
  b.add(
    loftGeometry([
      { z: -0.44, w: 0.2, h: 0.12, y: 0.9 },
      { z: -0.32, w: 0.36, h: 0.24, y: 0.93 },
      { z: -0.1, w: 0.4, h: 0.24, y: 0.94 },
      { z: 0.08, w: 0.26, h: 0.12, y: 0.88 },
    ], 28, 2.6),
    body,
  );
  b.add(tubeX(0.035, 0.1, 12), steel, 0, 1.05, -0.2); // filler cap
  b.add(
    loftGeometry([
      { z: 0.04, w: 0.22, h: 0.05, y: 0.855 },
      { z: 0.2, w: 0.27, h: 0.07, y: 0.865 },
      { z: 0.44, w: 0.18, h: 0.06, y: 0.9 },
    ], 20, 2.4),
    black,
  );
  b.add(
    loftGeometry([
      { z: 0.08, w: 0.3, h: 0.16, y: 0.76 },
      { z: 0.42, w: 0.24, h: 0.16, y: 0.86 },
      { z: 0.8, w: 0.12, h: 0.1, y: 0.95 },
    ], 24, 3),
    body,
  );
  b.add(new THREE.BoxGeometry(0.1, 0.04, 0.02), tailLamp, 0, 0.94, 0.805);
  // Number plate on a hanger over the rear wheel.
  b.beam(v(0, 0.85, 0.7), v(0, 0.72, 0.9), 0.03, dark);
  b.add(new THREE.BoxGeometry(0.2, 0.13, 0.012), white, 0, 0.7, 0.91, 0.3);
  for (const s of [-1, 1]) b.add(new THREE.SphereGeometry(0.022, 8, 6), yellow, s * 0.09, 0.8, 0.86); // indicators
  // Front fairing, windscreen and twin headlights.
  b.add(
    loftGeometry([
      { z: -0.82, w: 0.14, h: 0.16, y: 0.84 },
      { z: -0.7, w: 0.34, h: 0.34, y: 0.82 },
      { z: -0.5, w: 0.46, h: 0.48, y: 0.77 },
      { z: -0.34, w: 0.44, h: 0.44, y: 0.73 },
    ], 28, 2.8),
    body,
  );
  b.add(new THREE.BoxGeometry(0.28, 0.24, 0.012), glass, 0, 1.06, -0.62, 0.95); // leaning back toward the rider
  for (const s of [-1, 1]) {
    b.add(new THREE.SphereGeometry(0.05, 12, 8), lamp, s * 0.075, 0.85, -0.8, 0, 0, 0, 1.2, 0.7, 0.5);
    // Mirrors on stalks.
    b.beam(v(s * 0.17, 0.96, -0.56), v(s * 0.25, 1.02, -0.56), 0.018, dark, true);
    b.add(new THREE.BoxGeometry(0.1, 0.06, 0.03), dark, s * 0.28, 1.03, -0.56);
    // A white army star on each side of the fairing, and one on the tail.
    b.add(new THREE.ShapeGeometry(starShape(0.085, 0.034)), white, s * 0.232, 0.78, -0.5, 0, s * Math.PI / 2);
    b.add(new THREE.ShapeGeometry(starShape(0.05, 0.02)), white, s * 0.123, 0.86, 0.45, 0, s * Math.PI / 2 + s * 0.12);
    // Footpegs and the rider's rearsets.
    b.add(tubeX(0.018, 0.1, 8), steel, s * 0.2, 0.44, 0.18);
    b.beam(v(s * 0.13, 0.52, 0.12), v(s * 0.17, 0.44, 0.2), 0.03, dark);
  }

  // ---- booster rockets, one down each side of the tail, with a three-missile rack on top ----
  const boosterBody = plastic(shade(color, 0.85));
  const boosterLen = BOOSTER_BACK - BOOSTER_FRONT - 0.28;
  for (const s of [-1, 1]) {
    const x = s * BOOSTER_X;
    const bodyZ = BOOSTER_FRONT + 0.14 + boosterLen / 2;
    b.add(tubeZ(BOOSTER_RADIUS, BOOSTER_RADIUS, boosterLen, 18), boosterBody, x, BOOSTER_Y, bodyZ);
    b.add(new THREE.ConeGeometry(BOOSTER_RADIUS, 0.16, 18).rotateX(-Math.PI / 2), red, x, BOOSTER_Y, BOOSTER_FRONT + 0.08);
    b.add(tubeZ(BOOSTER_RADIUS + 0.004, BOOSTER_RADIUS + 0.004, 0.05, 18), yellow, x, BOOSTER_Y, BOOSTER_FRONT + 0.26);
    b.add(tubeZ(BOOSTER_RADIUS + 0.004, BOOSTER_RADIUS + 0.004, 0.03, 18), black, x, BOOSTER_Y, BOOSTER_BACK - 0.2);
    // Nozzle bell, flaring out at the back.
    b.add(tubeZ(0.08, 0.055, 0.12, 18), engineMetal, x, BOOSTER_Y, BOOSTER_BACK - 0.06);
    // Four fins round the back.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      b.add(new THREE.BoxGeometry(0.012, 0.09, 0.14), dark, x + Math.cos(a) * 0.12, BOOSTER_Y + Math.sin(a) * 0.12, BOOSTER_BACK - 0.14, 0, 0, a - Math.PI / 2);
    }
    // Brackets back to the frame and the tail.
    b.beam(v(x - s * 0.06, BOOSTER_Y, 0.25), v(s * 0.12, 0.55, 0.2), 0.035, dark);
    b.beam(v(x - s * 0.05, BOOSTER_Y + 0.05, 0.56), v(s * 0.1, 0.8, 0.5), 0.035, dark);
    b.add(new THREE.ShapeGeometry(starShape(0.045, 0.018)), white, x + s * (BOOSTER_RADIUS + 0.002), BOOSTER_Y, bodyZ + 0.05, 0, s * Math.PI / 2);
    // The missile rack's rail along the top.
    b.add(new THREE.BoxGeometry(0.17, 0.02, 0.34), dark, x, BOOSTER_Y + BOOSTER_RADIUS + 0.01, 0.34);
  }

  addRider(b, skin, kit, black, visor);
  b.buildInto(bike);

  // ---- twin machine guns, one each side of the fairing ----
  const guns = new PartBuilder();
  const muzzles: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const x = s * 0.26;
    guns.add(new THREE.BoxGeometry(0.08, 0.09, 0.26), dark, x, 0.66, -0.56);
    guns.add(new THREE.BoxGeometry(0.06, 0.07, 0.1), yellow, x + s * 0.02, 0.6, -0.5); // ammo box
    guns.add(tubeZ(0.02, 0.02, 0.36, 8), black, x, 0.67, -0.86);
    guns.add(tubeZ(0.032, 0.032, 0.14, 10), dark, x, 0.67, -0.76); // cooling jacket
    guns.beam(v(x, 0.62, -0.5), v(s * 0.18, 0.72, -0.44), 0.03, dark);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(x, 0.67, -1.05);
    bike.add(muzzle);
    muzzles.push(muzzle);
  }
  guns.buildInto(bike);

  // ---- wheels ----
  const wheelMats = { tyre, rim: dark, steel, dark: engineMetal };
  const rearWheel = buildWheel(false, wheelMats);
  rearWheel.position.copy(REAR_AXLE);
  bike.add(rearWheel);

  // ---- steering: forks, front wheel, mudguard, brake calipers, bars and grips, raked back ----
  const toAxle = FRONT_AXLE.clone().sub(HEAD);
  const forkLength = toAxle.length();
  const head = new THREE.Group();
  head.position.copy(HEAD);
  // Tip the head's local -Y onto the line down to the front axle.
  head.rotation.x = Math.atan2(-toAxle.z, -toAxle.y);
  bike.add(head);
  const steer = new THREE.Group();
  head.add(steer);
  const f = new PartBuilder();
  for (const s of [-1, 1]) {
    f.add(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 12), steel, s * 0.088, -0.18, 0);
    f.add(new THREE.CylinderGeometry(0.04, 0.036, 0.34, 12), dark, s * 0.088, -forkLength + 0.17, 0);
    f.add(new THREE.BoxGeometry(0.035, 0.085, 0.06), red, s * 0.085, -forkLength + 0.1, 0.1); // calipers
    // Clip-on bars and grips.
    const grip = v(s * 0.36, -0.02, 0.11);
    f.beam(v(s * 0.1, 0.02, 0.02), grip.clone().add(v(-s * 0.06, 0, -0.01)), 0.03, steel, true);
    f.add(tubeX(0.03, 0.12, 10), black, grip.x, grip.y, grip.z);
    f.beam(v(s * 0.26, 0.0, 0.02), v(s * 0.36, -0.01, -0.04), 0.012, steel); // brake / clutch levers
  }
  f.add(new THREE.BoxGeometry(0.26, 0.04, 0.09), dark, 0, 0.02, 0);
  f.add(new THREE.BoxGeometry(0.24, 0.04, 0.08), dark, 0, -0.14, 0);
  f.add(new THREE.BoxGeometry(0.16, 0.06, 0.1), black, 0, 0.07, 0.04, 0.4); // clocks
  // Front mudguard over the top of the tyre.
  f.add(new THREE.TorusGeometry(BIKE_WHEEL_RADIUS + 0.05, 0.03, 6, 16, Math.PI * 0.6).rotateY(Math.PI / 2), body, 0, -forkLength, 0, -0.35, 0, 0, 2.2, 1, 1);
  f.buildInto(steer);
  const frontWheel = buildWheel(true, wheelMats);
  frontWheel.position.set(0, -forkLength, 0);
  steer.add(frontWheel);

  // ---- missiles (hidden one by one as they're fired) and exhaust flames ----
  const missileShape = new PartBuilder();
  missileShape.add(tubeZ(0.022, 0.022, 0.26, 10), white, 0, 0, 0.02);
  missileShape.add(new THREE.ConeGeometry(0.022, 0.07, 10).rotateX(-Math.PI / 2), red, 0, 0, -0.145);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    missileShape.add(new THREE.BoxGeometry(0.006, 0.05, 0.05), red, Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0.13, 0, 0, a - Math.PI / 2);
  }
  const missileGeo = missileShape.buildGeometries();
  const missiles: THREE.Object3D[] = [];
  const flames: THREE.Object3D[] = [];
  const outer = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const inner = new THREE.MeshBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Group();
      for (const [mat, geo] of missileGeo) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        m.add(mesh);
      }
      m.position.set(s * BOOSTER_X + (k - 1) * 0.055, BOOSTER_Y + BOOSTER_RADIUS + 0.045, 0.34);
      bike.add(m);
      missiles.push(m);
    }
    const flame = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.7, 14).rotateX(Math.PI / 2).translate(0, 0, 0.35), outer);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.42, 12).rotateX(Math.PI / 2).translate(0, 0, 0.21), inner);
    flame.add(cone, core);
    flame.position.set(s * BOOSTER_X, BOOSTER_Y, BOOSTER_BACK);
    flame.visible = false;
    bike.add(flame);
    flames.push(flame);
  }

  return { group, frontWheel, rearWheel, steer, flames, missiles, muzzles };
}
