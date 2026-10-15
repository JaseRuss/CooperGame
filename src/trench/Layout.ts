import * as THREE from 'three';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';
import type { Solids } from '../jungle/Props';
import type { Clearing } from '../jungle/Forest';
import { mulberry32 } from '../utils/rng';
import { createFigureMesh, createPoseFigure, CARRY_CRATE_AT } from '../entities/Soldier';

/*
 * The trench level's ground plan. Our trench line runs across the map (along X) on the south (+Z)
 * side, facing theirs across no man's land. Each line, from no man's land back: a sandbagged
 * parapet too tall to see over from the floor, a wooden fire step to stand on to shoot over it, a
 * duckboarded walkway, and a taller parados behind. Everything is built up on flat ground, so the
 * soldiers (who always stand on y 0, or on a step) need no terrain. Our parapet has no gaps: the
 * only way over is a ladder, after the whistle. Theirs has breaches blown in it, which is how the
 * assault gets in.
 *
 * Theirs is a proper trench system: the front line, a support line behind it and a reserve line
 * behind that, all facing us, joined by doglegged communication trenches. The ground between their
 * lines is shut in by the banks (jungle grows there) so the only way back through their lines is
 * along the communication trenches. Their dugouts open off the back of the support and reserve
 * lines, and a gap in the reserve line's parados leads out to their big gun.
 */

/** The fighting is across x in [-X_HALF, X_HALF]; barbed wire just beyond closes the ends. */
export const X_HALF = 72;
export const SIDE_WALL = X_HALF + 2;
/** The map's back edges (wire again). */
export const Z_HALF = 132;
/**
 * The trenches, the wire and no man's land carry on this far either side, beyond the wire, so the
 * front looks like it goes on for miles (the jungle carries on all round too).
 */
export const SCENERY_HALF = 190;
/** The middle of each front parapet (ours at +PARAPET_Z, theirs at -PARAPET_Z), and its size. */
export const PARAPET_Z = 34;
const PARAPET_HALF_T = 0.5;
export const PARAPET_H = 1.6;
/** The fire step runs along the back of the parapet: this tall, from 34.5 to 35.5 out. */
export const STEP_H = 0.6;
export const STEP_Z = 35;
/** The middle of the walkway, and where it ends at the parados. */
export const FLOOR_Z = 37.2;
const PARADOS_Z = 39.6;
const PARADOS_HALF_T = 0.6;
const PARADOS_H = 1.9;
/** How far each of their lines' parapets is from the middle: front, support, reserve. */
export const ENEMY_LINES = [PARAPET_Z, 58, 82];
/** A line's parapet, fire step, walkway and parados, measured out from the middle of the map. */
export function lineAt(line: number): { parapet: number; step: number; floor: number; parados: number; back: number } {
  const b = ENEMY_LINES[line];
  return { parapet: b, step: b + STEP_Z - PARAPET_Z, floor: b + FLOOR_Z - PARAPET_Z, parados: b + PARADOS_Z - PARAPET_Z, back: b + PARADOS_Z - PARAPET_Z + PARADOS_HALF_T };
}
/** Gaps through our parados to the back. */
export const OUR_GAPS = [-40, 0, 40];
const GAP_HALF = 1.6;
export const BREACHES = [-52, -18, 18, 52];
const BREACH_HALF = 2.2;
/** Our ladders up the parapet, for going over the top. */
export const LADDERS = [-54, -27, 0, 27, 54];
/** Our big gun at the back (it fires north, along the cleared lane), and theirs. */
export const GUN = new THREE.Vector3(0, 0, 102);
export const ENEMY_GUN = new THREE.Vector3(0, 0, -104);
/** Where the medics patch you up: the aid post by our gun. */
export const AID_POST = new THREE.Vector3(9, 0, 107);
export const RESPAWN = { x: -3, z: 110, yaw: 0 };
/** A dugout's walls: this wide (x) and deep (z), outside measurements roughly. */
const DUG_W = 7;
const DUG_D = 5.4;
const DUG_DOOR = 2.6;
/** Our ammo dump, in a dugout behind the right-hand parados gap. */
export const AMMO_DUMP = new THREE.Vector3(40, 0, 46);
/** Their officers' dugouts, dug in behind the parados of their support line and of their reserve line (the headquarters). */
export const DUGOUTS = [
  { at: new THREE.Vector3(50, 0, -(lineAt(1).back + DUG_D / 2 - 0.3)), line: 1 },
  { at: new THREE.Vector3(-45, 0, -(lineAt(2).back + DUG_D / 2 - 0.3)), line: 2 },
];
/** The gap through their reserve line's parados out to their gun. */
const REAR_GAP = 0;
/** The machine gun on our fire step, and the rack with the sniper rifle. */
export const MG_AT = new THREE.Vector3(20, STEP_H, STEP_Z);
export const SNIPER_RACK = new THREE.Vector3(-20, STEP_H, STEP_Z + 0.2);

/**
 * Their communication trenches, each a centreline from the parados of one line back to the
 * parapet of the next, with a dogleg halfway so you can't see (or shoot) straight down it.
 */
interface Comm {
  /** The zone it's in (4: front to support, 6: support to reserve). */
  zone: Zone;
  pts: THREE.Vector2[];
}
/** A communication trench's clear width is twice this, less the wall's half thickness. */
const COMM_HALF = 1.6;
const COMM_WALL_HALF_T = 0.4;
const COMM_H = 1.9;
function comm(zone: Zone, from: number, to: number, x0: number, x1: number): Comm {
  const z0 = -lineAt(from).back;
  const z1 = -(ENEMY_LINES[to] - PARAPET_HALF_T);
  const zj = (z0 + z1) / 2;
  return { zone, pts: [new THREE.Vector2(x0, z0), new THREE.Vector2(x0, zj), new THREE.Vector2(x1, zj), new THREE.Vector2(x1, z1)] };
}
export const COMMS: Comm[] = [
  comm(4, 0, 1, -40, -35),
  comm(4, 0, 1, 0, 5),
  comm(4, 0, 1, 40, 35),
  comm(6, 1, 2, -20, -26),
  comm(6, 1, 2, 20, 26),
];

/**
 * 0 our rear, 1 our trench, 2 no man's land, 3 their front line, 4 the communication trenches
 * back to their support line, 5 their support line, 6 the communication trenches back to their
 * reserve line, 7 their reserve line, 8 behind it (their gun). Their dugouts count as part of the
 * line they open off.
 */
export type Zone = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export function zoneOf(x: number, z: number): Zone {
  if (z > PARADOS_Z + PARADOS_HALF_T) return 0;
  if (z >= PARAPET_Z + PARAPET_HALF_T) return 1;
  if (z > -(PARAPET_Z + PARAPET_HALF_T)) return 2;
  const dug = dugoutAt(x, z);
  if (dug) return (3 + dug.line * 2) as Zone;
  const d = -z;
  for (let i = 0; i < ENEMY_LINES.length; i++) {
    if (d <= lineAt(i).back) return (3 + i * 2) as Zone;
    if (i + 1 < ENEMY_LINES.length && d < ENEMY_LINES[i + 1] + PARAPET_HALF_T) return (4 + i * 2) as Zone;
  }
  return 8;
}

/** Which of their dugouts this spot is inside, if any. */
export function dugoutAt(x: number, z: number): (typeof DUGOUTS)[number] | null {
  return DUGOUTS.find((d) => Math.abs(x - d.at.x) < DUG_W / 2 && Math.abs(z - d.at.z) < DUG_D / 2) ?? null;
}

/** Up on a fire step (ours or their front line's) at this spot. */
export function onStep(x: number, z: number, y: number): boolean {
  return y > STEP_H * 0.6 && Math.abs(Math.abs(z) - STEP_Z) < 0.75 && Math.abs(x) < X_HALF + 1;
}

interface Passage {
  x: number;
  half: number;
  /** The point on the lower-numbered zone's side, and on the higher one's. */
  a: THREE.Vector2;
  b: THREE.Vector2;
}

/** The way into each communication trench from the line in front of it (a), and just inside (b); and out at the far end. */
const commStart = (c: Comm): Passage => {
  const p = c.pts[0];
  return { x: p.x, half: COMM_HALF - COMM_WALL_HALF_T, a: new THREE.Vector2(p.x, p.y + 1.8), b: new THREE.Vector2(p.x, p.y - 1.8) };
};
const commEnd = (c: Comm, line: number): Passage => {
  const p = c.pts[c.pts.length - 1];
  return { x: p.x, half: COMM_HALF - COMM_WALL_HALF_T, a: new THREE.Vector2(p.x, p.y + 2), b: new THREE.Vector2(p.x, -lineAt(line).floor) };
};

/** Ways between neighbouring zones (index i joins zone i and i + 1); none from our trench into no man's land. */
const PASSAGES: Passage[][] = [
  OUR_GAPS.map((x) => ({ x, half: GAP_HALF, a: new THREE.Vector2(x, 41.6), b: new THREE.Vector2(x, 38.2) })),
  [],
  BREACHES.map((x) => ({ x, half: BREACH_HALF, a: new THREE.Vector2(x, -32.4), b: new THREE.Vector2(x, -37.6) })),
  COMMS.filter((c) => c.zone === 4).map(commStart),
  COMMS.filter((c) => c.zone === 4).map((c) => commEnd(c, 1)),
  COMMS.filter((c) => c.zone === 6).map(commStart),
  COMMS.filter((c) => c.zone === 6).map((c) => commEnd(c, 2)),
  [{ x: REAR_GAP, half: GAP_HALF, a: new THREE.Vector2(REAR_GAP, -(lineAt(2).parados - 1.2)), b: new THREE.Vector2(REAR_GAP, -(lineAt(2).back + 1.8)) }],
];

/** Distance from (x, z) to a communication trench's centreline, and how far along it that is. */
function along(c: Comm, x: number, z: number): { d: number; s: number; seg: number } {
  let best = { d: Infinity, s: 0, seg: 0 };
  let s0 = 0;
  for (let i = 0; i + 1 < c.pts.length; i++) {
    const a = c.pts[i];
    const b = c.pts[i + 1];
    const len = a.distanceTo(b);
    const k = THREE.MathUtils.clamp(((x - a.x) * (b.x - a.x) + (z - a.y) * (b.y - a.y)) / (len * len), 0, 1);
    const d = Math.hypot(a.x + (b.x - a.x) * k - x, a.y + (b.y - a.y) * k - z);
    if (d < best.d) best = { d, s: s0 + k * len, seg: i };
    s0 += len;
  }
  return best;
}

function commNear(zone: Zone, x: number, z: number): Comm {
  let best = COMMS[0];
  let bestD = Infinity;
  for (const c of COMMS) {
    if (c.zone !== zone) continue;
    const d = along(c, x, z).d;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** The next corner along a communication trench toward its far end (`forward`) or its near end, or null at the end. */
function nextCorner(c: Comm, x: number, z: number, forward: boolean, untilS?: number): { x: number; z: number } | null {
  const here = along(c, x, z);
  let s0 = 0;
  const corners: { s: number; p: THREE.Vector2 }[] = [];
  for (let i = 0; i < c.pts.length; i++) {
    if (i > 0) s0 += c.pts[i - 1].distanceTo(c.pts[i]);
    corners.push({ s: s0, p: c.pts[i] });
  }
  const ahead = forward
    ? corners.filter((k) => k.s > here.s + 0.6 && (untilS === undefined || k.s < untilS))
    : corners.filter((k) => k.s < here.s - 0.6 && (untilS === undefined || k.s > untilS)).reverse();
  return ahead.length ? { x: ahead[0].p.x, z: ahead[0].p.y } : null;
}

/**
 * Where a soldier at (fx, fz) should head to get to (tx, tz): straight there in the same zone, or
 * through the nearest gap, breach or communication trench on the way (round its dogleg). From our
 * trench to no man's land it's the nearest ladder's foot: the game puts them over the top from there.
 */
export function route(fx: number, fz: number, tx: number, tz: number): { x: number; z: number } {
  const from = zoneOf(fx, fz);
  const to = zoneOf(tx, tz);
  if (from === 4 || from === 6) {
    const c = commNear(from, fx, fz);
    if (from === to) {
      // Along the trench, round the corner if there's one in between.
      const t = along(c, tx, tz);
      if (commNear(to, tx, tz) === c) return nextCorner(c, fx, fz, t.s > along(c, fx, fz).s, t.s) ?? { x: tx, z: tz };
      return nextCorner(c, fx, fz, false) ?? passageOut(from, c, false);
    }
    const up = to > from;
    return nextCorner(c, fx, fz, up) ?? passageOut(from, c, up);
  }
  if (from === to) {
    // Into a dugout: by its door from the trench.
    const dug = dugoutAt(tx, tz);
    if (dug && !dugoutAt(fx, fz)) {
      const doorZ = -lineAt(dug.line).floor;
      if (Math.abs(fx - dug.at.x) > DUG_DOOR - 0.6 || Math.abs(fz - doorZ) > 1.2) {
        if (Math.hypot(fx - dug.at.x, fz - doorZ) > 0.8) return { x: dug.at.x, z: doorZ };
      }
    }
    return { x: tx, z: tz };
  }
  const up = to > from;
  // Out of a dugout first, by its door.
  const inDug = dugoutAt(fx, fz);
  if (inDug) return { x: inDug.at.x, z: -lineAt(inDug.line).floor };
  const i = up ? from : from - 1;
  if (i === 1) {
    const lx = LADDERS.reduce((a, b) => (Math.abs(b - fx) < Math.abs(a - fx) ? b : a));
    return up ? { x: lx, z: 36 } : { x: tx, z: tz };
  }
  const list = PASSAGES[i];
  let best = list[0];
  let bestCost = Infinity;
  for (const p of list) {
    const cost = Math.abs(fx - p.x) + Math.abs(p.x - tx);
    if (cost < bestCost) {
      bestCost = cost;
      best = p;
    }
  }
  const near = up ? best.a : best.b;
  const far = up ? best.b : best.a;
  const inGap = Math.abs(fx - best.x) < best.half && (fz - best.a.y) * (fz - best.b.y) <= 0;
  if (!inGap && Math.hypot(fx - near.x, fz - near.y) > 1) return { x: near.x, z: near.y };
  return { x: far.x, z: far.y };
}

/** The point just outside a communication trench's far end (`up`) or near end. */
function passageOut(zone: Zone, c: Comm, up: boolean): { x: number; z: number } {
  const p = up ? commEnd(c, (zone - 2) / 2).b : commStart(c).a;
  return { x: p.x, z: p.y };
}

/** The pieces of [-len, len] left between gaps (each gap: centre, half width). */
function spans(len: number, gaps: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = -len;
  for (const [g, half] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (g - half > at) out.push([at, g - half]);
    at = g + half;
  }
  if (at < len) out.push([at, len]);
  return out;
}

/** The gaps in each of their lines' parapet (front) and parados (back): breaches, communication trenches, dugout doors, the way out to their gun. */
function enemyGaps(line: number): { front: [number, number][]; back: [number, number][] } {
  const into = COMMS.filter((c) => c.zone === 2 + line * 2).map((c): [number, number] => [c.pts[c.pts.length - 1].x, COMM_HALF - COMM_WALL_HALF_T]);
  const outOf = COMMS.filter((c) => c.zone === 4 + line * 2).map((c): [number, number] => [c.pts[0].x, COMM_HALF - COMM_WALL_HALF_T]);
  const doors = DUGOUTS.filter((d) => d.line === line).map((d): [number, number] => [d.at.x, DUG_DOOR]);
  return {
    front: line === 0 ? BREACHES.map((x): [number, number] => [x, BREACH_HALF]) : into,
    back: [...outOf, ...doors, ...(line === 2 ? [[REAR_GAP, GAP_HALF] as [number, number]] : [])],
  };
}

/** Where the forest mustn't grow: no man's land and the trenches, the lanes in front of both guns, the gun pits, the dugouts and the gaps behind the trenches. */
export function clearings(): Clearing[] {
  const commBits: Clearing[] = [];
  for (const c of COMMS) {
    for (let i = 0; i + 1 < c.pts.length; i++) {
      const a = c.pts[i];
      const b = c.pts[i + 1];
      commBits.push({ x0: Math.min(a.x, b.x) - 3.5, x1: Math.max(a.x, b.x) + 3.5, z0: Math.min(a.y, b.y) - 1, z1: Math.max(a.y, b.y) + 1 });
    }
  }
  return [
    { x0: -200, x1: 200, z0: -lineAt(0).back - 1, z1: 46 },
    ...[1, 2].map((i) => ({ x0: -200, x1: 200, z0: -lineAt(i).back - 1.5, z1: -ENEMY_LINES[i] + 1.5 })),
    ...commBits,
    { x0: -9, x1: 9, z0: 40, z1: 126 },
    { x0: -9, x1: 9, z0: -126, z1: -lineAt(2).back },
    { x: GUN.x, z: GUN.z, r: 17 },
    { x: AID_POST.x, z: AID_POST.z, r: 9 },
    { x: ENEMY_GUN.x, z: ENEMY_GUN.z, r: 15 },
    { x: AMMO_DUMP.x, z: AMMO_DUMP.z, r: 8 },
    ...DUGOUTS.map((d) => ({ x: d.at.x, z: d.at.z, r: 6 })),
    ...OUR_GAPS.map((x) => ({ x0: x - 4, x1: x + 4, z0: 40, z1: 52 })),
  ];
}

const EARTH = 0x5b4630;
const SANDBAG = 0xb2a272;
const WOOD = 0x8b5e38;
const WOOD_DARK = 0x5a3b24;
const MUD = 0x4a3b2a;

/** A low-poly sandbag (there are thousands): about 0.9 m long, 0.3 tall and 0.4 deep. */
const BAG = new THREE.CapsuleGeometry(0.2, 0.5, 2, 6).rotateZ(Math.PI / 2).scale(1, 0.72, 1);
/** The same sandbag as a plain block, for the stretches out beyond the wire where nobody gets close. */
const FAR_BAG = new THREE.BoxGeometry(0.86, 0.27, 0.36);
/** The sandbag to use at x. */
const bagAt = (x: number) => (Math.abs(x) > SIDE_WALL + 4 ? FAR_BAG : BAG);

/**
 * Builds both trench lines, no man's land, the guns, dugouts, the ammo dump and the aid post:
 * merged meshes in the scene and fixed colliders in `solids`. Returns the stumps in no man's
 * land (cover) for the map, and the gun groups to aim.
 */
export function buildBattlefield(scene: THREE.Scene, solids: Solids, ourColor: number, theirColor: number): { gun: THREE.Group; barrel: THREE.Object3D; recoil: THREE.Object3D } {
  const rng = mulberry32(1914);
  const earth = plastic(EARTH);
  const bagMat = plastic(SANDBAG);
  const bagDark = plastic(shade(SANDBAG, 0.8));
  const wood = plastic(WOOD);
  const woodDark = plastic(WOOD_DARK);
  const wire = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7, metalness: 0.4 });
  const p = new PartBuilder();
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  // The ground: jungle floor at the back, churned mud between the lines.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3c5a2c, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
  const mud = new THREE.Mesh(new THREE.PlaneGeometry(SCENERY_HALF * 2 + 40, 92).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: MUD, roughness: 1 }));
  mud.position.y = 0.01;
  mud.receiveShadow = true;
  scene.add(mud);
  for (const lane of [1, -1]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(16, 84).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4f4a33, roughness: 1 }));
    strip.position.set(0, 0.012, lane * 84);
    strip.receiveShadow = true;
    scene.add(strip);
  }
  solids.box(0, -0.5, 0, 300, 0.5, 300);
  // The edges, where the barbed wire is: as tall as the wire, so shots fly on over it.
  solids.box(-SIDE_WALL, 1.1, 0, 0.6, 1.1, Z_HALF + 1);
  solids.box(SIDE_WALL, 1.1, 0, 0.6, 1.1, Z_HALF + 1);
  solids.box(0, 1.1, -Z_HALF - 1, SIDE_WALL, 1.1, 0.6);
  solids.box(0, 1.1, Z_HALF + 1, SIDE_WALL, 1.1, 0.6);

  // Shell holes all over no man's land (just dark patches with a lip: nothing to trip on).
  const craterMat = new THREE.MeshStandardMaterial({ color: 0x2e2419, roughness: 1 });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0x5a4733, roughness: 1 });
  for (let i = 0; i < 150; i++) {
    const r = 1.2 + rng() * 2.8;
    const x = i < 60 ? (rng() * 2 - 1) * (X_HALF - 2) : Math.sign(rng() - 0.5) * (SIDE_WALL + 3 + rng() * (SCENERY_HALF - SIDE_WALL - 3));
    const z = (rng() * 2 - 1) * 29;
    p.add(new THREE.CircleGeometry(r, 14).rotateX(-Math.PI / 2), craterMat, x, 0.02 + i * 0.0003, z);
    p.add(new THREE.TorusGeometry(r, 0.22, 4, 14).rotateX(Math.PI / 2).scale(1, 1, 0.5), lipMat, x, 0.04, z);
  }
  // Shattered stumps, the only cover out there.
  for (let i = 0; i < 16; i++) {
    const x = (rng() * 2 - 1) * (X_HALF - 6);
    const z = (rng() * 2 - 1) * 22;
    const h = 1.2 + rng() * 2.6;
    const r = 0.35 + rng() * 0.25;
    p.add(new THREE.CylinderGeometry(r * 0.7, r, h, 7), woodDark, x, h / 2, z, (rng() - 0.5) * 0.15, rng() * 3, (rng() - 0.5) * 0.15);
    p.add(new THREE.ConeGeometry(r * 0.7, 0.5, 5), woodDark, x, h + 0.2, z, 0, rng() * 3, 0.3);
    solids.cylinder(x, z, r, h);
  }
  // More stumps out beyond the wire (scenery only).
  for (let i = 0; i < 26; i++) {
    const x = Math.sign(rng() - 0.5) * (SIDE_WALL + 4 + rng() * (SCENERY_HALF - SIDE_WALL - 6));
    const z = (rng() * 2 - 1) * 24;
    const h = 1.2 + rng() * 3;
    const r = 0.35 + rng() * 0.25;
    p.add(new THREE.CylinderGeometry(r * 0.7, r, h, 7), woodDark, x, h / 2, z, (rng() - 0.5) * 0.15, rng() * 3, (rng() - 0.5) * 0.15);
    p.add(new THREE.ConeGeometry(r * 0.7, 0.5, 5), woodDark, x, h + 0.2, z, 0, rng() * 3, 0.3);
  }

  /**
   * One trench line, `s` 1 for ours (south) and -1 for theirs, its parapet `base` out from the
   * middle, with gaps in the parapet and the parados. The front lines get two rows of sandbags and
   * wire out in front; their support and reserve lines one row and no wire.
   */
  const trenchLine = (s: number, base: number, frontGaps: [number, number][], backGaps: [number, number][], frontLine: boolean) => {
    const ours = s > 0;
    const at = (d: number) => s * (base + d - PARAPET_Z);
    const parapetZ = at(PARAPET_Z);
    const stepZ = at(STEP_Z);
    const paradosZ = at(PARADOS_Z);
    const floorZ = at(FLOOR_Z);
    for (const [x0, x1] of spans(SCENERY_HALF, frontGaps)) {
      const len = x1 - x0;
      const cx = (x0 + x1) / 2;
      solids.box(cx, PARAPET_H / 2, parapetZ, len / 2, PARAPET_H / 2, PARAPET_HALF_T);
      solids.box(cx, STEP_H / 2, stepZ, len / 2, STEP_H / 2, 0.5);
      // An earth bank, two rows of sandbags two deep along the top (one row further back), planks on the inside face.
      p.add(box(len, 1.05, 1.15), earth, cx, 0.52, parapetZ - s * 0.05);
      for (let x = x0 + 0.45; x < x1 - 0.3; x += 0.86) {
        for (let row = 0; row < (frontLine ? 2 : 1); row++) {
          for (const dz of [-0.22, 0.22]) {
            const jx = x + (row ? 0.43 : 0) + (rng() - 0.5) * 0.06;
            if (jx > x1 - 0.3) continue;
            p.add(bagAt(jx), (row + (dz > 0 ? 1 : 0)) % 2 ? bagMat : bagDark, jx, 1.18 + row * 0.27, parapetZ + dz, 0, (rng() - 0.5) * 0.1, 0);
          }
        }
      }
      if (!frontLine) p.add(box(len, 0.27, 0.9), earth, cx, 1.45, parapetZ);
      p.add(box(len, 1.3, 0.06), wood, cx, 0.65 + STEP_H * 0.5, parapetZ + s * (PARAPET_HALF_T + 0.03));
      for (let x = x0 + 1; x < x1; x += 2.4) p.add(box(0.14, PARAPET_H, 0.14), woodDark, x, PARAPET_H / 2, parapetZ + s * (PARAPET_HALF_T + 0.07));
      // The fire step: a plank box.
      p.add(box(len, STEP_H, 1), wood, cx, STEP_H / 2, stepZ);
      p.add(box(len, 0.05, 1.04), woodDark, cx, STEP_H + 0.01, stepZ);
    }
    for (const [x0, x1] of spans(SCENERY_HALF, backGaps)) {
      const len = x1 - x0;
      const cx = (x0 + x1) / 2;
      solids.box(cx, PARADOS_H / 2, paradosZ, len / 2, PARADOS_H / 2, PARADOS_HALF_T);
      p.add(box(len, PARADOS_H - 0.25, 1.3), earth, cx, (PARADOS_H - 0.25) / 2, paradosZ);
      for (let x = x0 + 0.45; x < x1 - 0.3; x += 0.86) p.add(bagAt(x), bagMat, x + (rng() - 0.5) * 0.06, PARADOS_H - 0.12, paradosZ, 0, (rng() - 0.5) * 0.12, 0);
      p.add(box(len, PARADOS_H - 0.3, 0.06), woodDark, cx, (PARADOS_H - 0.3) / 2, paradosZ - s * (PARADOS_HALF_T + 0.03));
    }
    // Mud and duckboards all along the walkway.
    if (!frontLine) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(SCENERY_HALF * 2, 7.4).rotateX(-Math.PI / 2), mudMat);
      strip.position.set(0, 0.011, at(FLOOR_Z - 0.4));
      strip.receiveShadow = true;
      scene.add(strip);
    }
    for (let x = -SCENERY_HALF + 0.6; x < SCENERY_HALF - 0.5; x += 1.25) {
      p.add(box(1.15, 0.06, 1.3), woodDark, x, 0.04, floorZ);
      for (const dz of [-0.45, 0, 0.45]) p.add(box(1.15, 0.03, 0.16), wood, x, 0.085, floorZ + dz);
    }
    if (!frontLine) return;
    // Barbed wire in front: two rows of posts with strands between, cut where they've been breached.
    for (const row of [27.5, 30]) {
      let prev: THREE.Vector3 | null = null;
      for (let x = -SCENERY_HALF + 1; x <= SCENERY_HALF - 1; x += 3.4) {
        const cut = !ours && BREACHES.some((b) => Math.abs(b - x) < 4);
        const post = new THREE.Vector3(x + (rng() - 0.5) * 0.6, 0, s * (row + (rng() - 0.5) * 0.6));
        if (cut) {
          prev = null;
          continue;
        }
        p.add(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 5), woodDark, post.x, 0.65, post.z, (rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2);
        if (prev) {
          for (const h of [0.35, 0.75, 1.15]) p.beam(new THREE.Vector3(prev.x, h, prev.z), new THREE.Vector3(post.x, h + (rng() - 0.5) * 0.2, post.z), 0.025, wire);
          p.beam(new THREE.Vector3(prev.x, 0.2, prev.z), new THREE.Vector3(post.x, 1.2, post.z), 0.022, wire);
        }
        prev = post;
      }
    }
  };
  const mudMat = new THREE.MeshStandardMaterial({ color: MUD, roughness: 1 });
  trenchLine(1, PARAPET_Z, [], OUR_GAPS.map((x): [number, number] => [x, GAP_HALF]), true);
  for (let i = 0; i < ENEMY_LINES.length; i++) {
    const g = enemyGaps(i);
    trenchLine(-1, ENEMY_LINES[i], g.front, g.back, i === 0);
  }

  // Their communication trenches: banks either side (sandbagged, planked inside) with duckboards
  // along the bottom. Each bank is the centreline pushed out to one side, mitred at the dogleg,
  // and run on into the banks of the lines at each end so there's no gap to squeeze through.
  for (const c of COMMS) {
    const n = c.pts.length;
    const dirs = c.pts.slice(1).map((q, i) => q.clone().sub(c.pts[i]).normalize());
    for (const side of [-1, 1]) {
      const bank: THREE.Vector2[] = c.pts.map((q, i) => {
        const nIn = i > 0 ? new THREE.Vector2(-dirs[i - 1].y, dirs[i - 1].x) : null;
        const nOut = i < n - 1 ? new THREE.Vector2(-dirs[i].y, dirs[i].x) : null;
        const off = nIn && nOut ? nIn.add(nOut) : (nIn ?? nOut) as THREE.Vector2;
        return q.clone().addScaledVector(off, side * COMM_HALF);
      });
      bank[0].addScaledVector(dirs[0], -0.9);
      bank[n - 1].addScaledVector(dirs[n - 2], 0.9);
      for (let i = 0; i + 1 < n; i++) {
        const a = bank[i];
        const b = bank[i + 1];
        const len = a.distanceTo(b) + COMM_WALL_HALF_T * 2;
        const along = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
        const cx = (a.x + b.x) / 2;
        const cz = (a.y + b.y) / 2;
        const w = along ? len : COMM_WALL_HALF_T * 2;
        const d = along ? COMM_WALL_HALF_T * 2 : len;
        solids.box(cx, COMM_H / 2, cz, w / 2, COMM_H / 2, d / 2);
        p.add(box(along ? len : 1.1, COMM_H - 0.25, along ? 1.1 : len), earth, cx, (COMM_H - 0.25) / 2, cz);
        // Planks on the inside face, sandbags along the top.
        const inward = new THREE.Vector2(-dirs[i].y, dirs[i].x).multiplyScalar(-side * 0.57);
        p.add(box(along ? len - 0.8 : 0.06, COMM_H - 0.3, along ? 0.06 : len - 0.8), woodDark, cx + inward.x, (COMM_H - 0.3) / 2, cz + inward.y);
        const steps = Math.floor(len / 0.86);
        for (let k = 0; k < steps; k++) {
          const f = (k + 0.5) / steps;
          p.add(BAG, k % 2 ? bagMat : bagDark, a.x + (b.x - a.x) * f, COMM_H - 0.12, a.y + (b.y - a.y) * f, 0, (along ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.12, 0);
        }
      }
    }
    for (let i = 0; i + 1 < n; i++) {
      const a = c.pts[i];
      const b = c.pts[i + 1];
      const len = a.distanceTo(b);
      const along = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(along ? len + 2.4 : 2.6, along ? 2.6 : len + 2.4).rotateX(-Math.PI / 2), mudMat);
      strip.position.set((a.x + b.x) / 2, 0.012, (a.y + b.y) / 2);
      strip.receiveShadow = true;
      scene.add(strip);
      for (let k = 0.6; k < len; k += 1.25) {
        const x = a.x + ((b.x - a.x) * k) / len;
        const z = a.y + ((b.y - a.y) * k) / len;
        p.add(box(along ? 1.15 : 1.3, 0.06, along ? 1.3 : 1.15), woodDark, x, 0.04, z);
      }
    }
  }
  // The edges of the fighting are wired off. Across the trenches and no man's land it's a thick
  // entanglement (three coils of concertina wire stacked on iron pickets); back in the jungle, a
  // fence of posts and strands.
  const ring = new THREE.TorusGeometry(0.46, 0.016, 3, 7);
  const rust = new THREE.MeshStandardMaterial({ color: 0x4d4038, roughness: 0.75, metalness: 0.35 });
  const entanglement = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    const yaw = Math.atan2(dx, dz); // turns a ring's axis (+Z) to point along the line
    for (let s = 0; s < len; s += 0.75) {
      const x = x0 + dx * s;
      const z = z0 + dz * s;
      for (const [side, y] of [[-0.48, 0.46], [0.48, 0.46], [0, 1.2]]) {
        p.add(ring, wire, x - dz * side + (rng() - 0.5) * 0.08, y + (rng() - 0.5) * 0.08, z + dx * side, (rng() - 0.5) * 0.35, yaw + (rng() - 0.5) * 0.35, 0);
      }
    }
    for (let s = 0; s <= len; s += 3) {
      const x = x0 + dx * s;
      const z = z0 + dz * s;
      // A pair of crossed iron pickets, and strands along the top and the bottom.
      for (const lean of [-0.25, 0.25]) p.add(box(0.06, 1.9, 0.06), rust, x - dz * lean, 0.9, z + dx * lean, lean * dx, 0, -lean * dz);
      if (s + 3 <= len) for (const h of [0.15, 1.75]) p.beam(new THREE.Vector3(x, h, z), new THREE.Vector3(x + dx * 3, h, z + dz * 3), 0.02, wire);
    }
  };
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    for (let s = 0; s <= len; s += 3.2) {
      const a = new THREE.Vector3(x0 + dx * s, 0, z0 + dz * s);
      p.add(new THREE.CylinderGeometry(0.06, 0.07, 1.7, 5), woodDark, a.x, 0.85, a.z, (rng() - 0.5) * 0.12, 0, (rng() - 0.5) * 0.12);
      if (s + 3.2 > len) continue;
      const b = new THREE.Vector3(a.x + dx * 3.2, 0, a.z + dz * 3.2);
      for (const h of [0.3, 0.7, 1.1, 1.5]) p.beam(a.clone().setY(h), b.clone().setY(h + (rng() - 0.5) * 0.15), 0.022, wire);
      p.beam(a.clone().setY(0.2), b.clone().setY(1.5), 0.02, wire);
      p.beam(a.clone().setY(1.5), b.clone().setY(0.2), 0.02, wire);
    }
  };
  const OPEN_FROM = -(lineAt(2).back + 18);
  const OPEN_TO = 58;
  for (const sx of [-SIDE_WALL, SIDE_WALL]) {
    entanglement(sx, OPEN_FROM, sx, OPEN_TO);
    fence(sx, OPEN_TO, sx, Z_HALF + 0.6);
    fence(sx, -Z_HALF - 0.6, sx, OPEN_FROM);
  }
  for (const sz of [-Z_HALF - 0.6, Z_HALF + 0.6]) fence(-SIDE_WALL, sz, SIDE_WALL, sz);

  // Our line carries on beyond the wire: men kneeling in the trench, and a few up on the fire step
  // (scenery: one instanced mesh for each pose).
  const kneelers: THREE.Matrix4[] = [];
  const standers: THREE.Matrix4[] = [];
  for (const sx of [-1, 1]) {
    for (let x = SIDE_WALL + 3; x < SCENERY_HALF - 2; x += 6 + rng() * 5) {
      const up = rng() < 0.2;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(sx * x, up ? STEP_H : 0, up ? STEP_Z : STEP_Z + 1.15),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rng() - 0.5) * 0.5),
        new THREE.Vector3(1, 1, 1),
      );
      (up ? standers : kneelers).push(m);
    }
  }
  for (const [pose, list] of [[1, kneelers], [0, standers]] as const) {
    const fig = createFigureMesh(pose, ourColor);
    const mesh = new THREE.InstancedMesh(fig.geometry, fig.material as THREE.Material, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = true;
    scene.add(mesh);
  }

  // Rubble of sandbags in their breaches.
  for (const b of BREACHES) {
    for (let i = 0; i < 9; i++) p.add(BAG, bagDark, b + (rng() - 0.5) * 5, 0.12 + rng() * 0.1, -PARAPET_Z + (rng() - 0.5) * 2.6, rng() * 0.4, rng() * 3, 0);
  }
  // Our ladders, leaning on the parapet.
  for (const x of LADDERS) {
    for (const dx of [-0.32, 0.32]) p.beam(new THREE.Vector3(x + dx, 0, PARAPET_Z + 2.2), new THREE.Vector3(x + dx, PARAPET_H + 0.4, PARAPET_Z + 0.35), 0.09, wood);
    for (let k = 1; k < 7; k++) {
      const f = k / 7;
      p.add(box(0.64, 0.05, 0.06), wood, x, f * (PARAPET_H + 0.4), PARAPET_Z + 2.2 - f * 1.85);
    }
  }

  // Dugouts: sandbag walls on three sides and a plank roof, the open side facing the trench.
  const dugout = (c: THREE.Vector3, face: number) => {
    const w = DUG_W;
    const d = DUG_D;
    const back = c.z + (face > 0 ? -d / 2 : d / 2);
    solids.box(c.x, 1.2, back, w / 2, 1.2, 0.4);
    solids.box(c.x - w / 2, 1.2, c.z, 0.4, 1.2, d / 2);
    solids.box(c.x + w / 2, 1.2, c.z, 0.4, 1.2, d / 2);
    p.add(box(w + 0.8, 2.4, 0.8), earth, c.x, 1.2, back);
    p.add(box(0.8, 2.4, d), earth, c.x - w / 2, 1.2, c.z);
    p.add(box(0.8, 2.4, d), earth, c.x + w / 2, 1.2, c.z);
    for (let x = c.x - w / 2; x <= c.x + w / 2; x += 0.86) p.add(BAG, bagMat, x, 2.55, c.z + (face > 0 ? d / 2 : -d / 2), 0, 0, 0);
    p.add(box(w + 1.2, 0.18, d + 0.6), woodDark, c.x, 2.5, c.z);
    for (let x = c.x - w / 2; x <= c.x + w / 2 + 0.01; x += 1.75) p.add(box(0.2, 2.4, 0.2), wood, x, 1.2, c.z + (face > 0 ? d / 2 : -d / 2));
  };
  dugout(AMMO_DUMP, -1);
  for (const d of DUGOUTS) dugout(d.at, 1);
  // The dump's crates: ammunition boxes and green grenade boxes.
  const crate = plastic(WOOD);
  const green = plastic(0x4d5a2e);
  for (let i = 0; i < 10; i++) {
    const x = AMMO_DUMP.x - 2.4 + (i % 5) * 1.2;
    const z = AMMO_DUMP.z + 1.4 + Math.floor(i / 5) * 0.9;
    p.add(box(1, 0.55, 0.7), i % 3 === 0 ? green : crate, x, 0.28, z, 0, (rng() - 0.5) * 0.2, 0);
    if (i % 2 === 0) p.add(box(0.9, 0.45, 0.6), i % 4 === 0 ? green : crate, x, 0.78, z, 0, (rng() - 0.5) * 0.3, 0);
  }
  // A table and a map in each enemy dugout.
  for (const { at: d } of DUGOUTS) {
    p.add(box(2, 0.08, 1), wood, d.x, 0.8, d.z - 0.6);
    for (const [dx, dz] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]]) p.add(box(0.08, 0.8, 0.08), woodDark, d.x + dx, 0.4, d.z - 0.6 + dz);
    p.add(box(1.2, 0.01, 0.7), plastic(0xd8ceb0), d.x, 0.85, d.z - 0.6);
  }

  // The aid post: a white tent with a red cross, and stretchers.
  const white = plastic(0xe8e4dc);
  const red = plastic(0xc8302a);
  const tent = AID_POST;
  for (const side of [-1, 1]) p.add(box(5, 0.08, 3.2), white, tent.x, 1.25, tent.z + side * 1.1, side * 0.75, 0, 0);
  p.add(box(1.2, 0.3, 0.02), red, tent.x, 2.2, tent.z - 2.03, -0.75, 0, 0);
  p.add(box(0.3, 1.2, 0.02), red, tent.x, 2.2, tent.z - 2.03, -0.75, 0, 0);
  for (let i = 0; i < 3; i++) {
    const x = tent.x - 5 + i * 1.3;
    p.add(box(0.7, 0.06, 2), plastic(0x9a8f6a), x, 0.3, tent.z + 3.4);
    for (const dz of [-0.9, 0.9]) p.add(box(0.06, 0.3, 0.06), woodDark, x, 0.15, tent.z + 3.4 + dz);
  }
  solids.box(tent.x, 1, tent.z, 2.4, 1, 1.6);

  // Sandbag pits round both big guns (open at the back).
  for (const [g, face] of [[GUN, -1], [ENEMY_GUN, 1]] as const) {
    for (let a = -1.9; a <= 1.9; a += 0.13) {
      const x = g.x + Math.sin(a) * 5.2;
      const z = g.z + face * Math.cos(a) * 5.2;
      for (let row = 0; row < 3; row++) p.add(BAG, row % 2 ? bagMat : bagDark, x, 0.15 + row * 0.27, z, 0, a * face, 0);
    }
  }
  // The machine-gun nest: a horseshoe of sandbags up on our parapet either side of the gun.
  for (let a = -1.4; a <= 1.4; a += 0.2) {
    if (Math.abs(a) < 0.45) continue;
    p.add(BAG, bagMat, MG_AT.x + Math.sin(a) * 1.3, PARAPET_H + 0.15, PARAPET_Z - 0.1 - Math.cos(a) * 0.5 + 0.6, 0, a, 0);
  }

  // The sniper's rack.
  p.add(box(0.1, 1.3, 0.1), woodDark, SNIPER_RACK.x - 0.5, STEP_H + 0.65, SNIPER_RACK.z + 0.25);
  p.add(box(0.1, 1.3, 0.1), woodDark, SNIPER_RACK.x + 0.5, STEP_H + 0.65, SNIPER_RACK.z + 0.25);
  p.add(box(1.2, 0.08, 0.12), wood, SNIPER_RACK.x, STEP_H + 1.2, SNIPER_RACK.z + 0.25);
  p.buildInto(scene, false, true);

  // Our field gun (aimed by the player), and theirs (scenery), each with its limber, shells and crew.
  const gun = fieldGun(ourColor);
  gun.position.copy(GUN);
  gun.rotation.y = 0;
  scene.add(gun);
  solids.box(GUN.x, 0.9, GUN.z + 1.3, 1.3, 0.9, 2.3);
  gunPit(scene, solids, GUN, -1, ourColor);
  const theirs = fieldGun(theirColor);
  theirs.position.copy(ENEMY_GUN);
  theirs.rotation.y = Math.PI;
  scene.add(theirs);
  gunPit(scene, solids, ENEMY_GUN, 1, theirColor);
  // The machine gun on its tripod.
  const mg = machineGun();
  mg.position.copy(MG_AT);
  scene.add(mg);
  return { gun, barrel: gun.getObjectByName('barrel') as THREE.Object3D, recoil: gun.getObjectByName('recoil') as THREE.Object3D };
}

/** The big gun's barrel pivots this high, and its muzzle is this far out in front of the pivot. */
export const GUN_PIVOT_Y = 1.32;
export const GUN_MUZZLE = 3.45;

/**
 * A toy WWI field gun facing -Z: big spoked wheels with iron tyres on a steel axle, a pair of
 * axle-tree seats, a box trail back to the spade, an armoured shield with a sight window and a
 * barrel slot, and the barrel on its cradle with the recoil buffer under it and the recuperator
 * over it, a breech block, a dial sight and the elevating and traversing handwheels. The cradle
 * group is named "barrel" (it pivots at the trunnions to elevate); inside it, the part named
 * "recoil" (barrel and breech) slides back along +Z when the gun fires.
 */
export function fieldGun(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = plastic(color);
  const dark = plastic(shade(color, 0.62));
  const steel = plastic(0x4a4d50);
  const black = plastic(0x1e2022);
  const p = new PartBuilder();
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const WHEEL_R = 0.85;
  // The wheels: an iron tyre round a wooden rim, fourteen spokes, a hub and its cap.
  for (const x of [-1.08, 1.08]) {
    p.add(new THREE.TorusGeometry(WHEEL_R - 0.03, 0.05, 6, 28), steel, x, WHEEL_R, 0, 0, Math.PI / 2, 0);
    p.add(new THREE.TorusGeometry(WHEEL_R - 0.11, 0.065, 5, 28), dark, x, WHEEL_R, 0, 0, Math.PI / 2, 0);
    for (let k = 0; k < 7; k++) p.add(box(0.05, (WHEEL_R - 0.1) * 2, 0.08), dark, x, WHEEL_R, 0, (k / 7) * Math.PI, 0, 0);
    p.add(tubeX(0.17, 0.34, 12), steel, x, WHEEL_R, 0);
    p.add(tubeX(0.1, 0.46, 10), black, x, WHEEL_R, 0);
  }
  p.add(tubeX(0.075, 2.3, 10), steel, 0, WHEEL_R, 0);
  // Axle-tree seats for two of the crew, either side of the cradle.
  for (const x of [-0.66, 0.66]) {
    p.add(box(0.36, 0.06, 0.32), dark, x, 1.22, 0.3);
    p.add(box(0.36, 0.32, 0.05), dark, x, 1.4, 0.47, -0.15, 0, 0);
    p.beam(new THREE.Vector3(x, WHEEL_R, 0.1), new THREE.Vector3(x, 1.2, 0.3), 0.05, steel);
  }
  // The carriage cheeks under the cradle, then the box trail tapering back to the spade.
  for (const x of [-0.3, 0.3]) p.add(box(0.1, 0.5, 1.3), body, x, 1.0, 0.05);
  for (const x of [-0.24, 0.24]) p.beam(new THREE.Vector3(x, 0.98, 0.5), new THREE.Vector3(x * 0.45, 0.2, 3.55), 0.22, body);
  for (const z of [1.2, 2.2, 3.0]) {
    const k = (z - 0.5) / 3.05;
    p.add(box(0.48 * (1 - k * 0.55), 0.12, 0.12), dark, 0, 0.98 - k * 0.78, z);
  }
  p.add(box(0.95, 0.5, 0.08), steel, 0, 0.2, 3.62, -0.35, 0, 0);
  p.add(new THREE.TorusGeometry(0.11, 0.03, 4, 10), steel, 0, 0.32, 3.45, Math.PI / 2, 0, 0);
  for (const sx of [-1, 1]) p.beam(new THREE.Vector3(sx * 0.12, 0.35, 3.2), new THREE.Vector3(sx * 0.65, 0.45, 3.35), 0.05, dark);
  // The shield: the main plate, a top plate leaned back, an apron between the wheels, rivets.
  p.add(box(2.15, 1.15, 0.06), body, 0, 1.55, -0.62);
  p.add(box(2.15, 0.36, 0.06), body, 0, 2.27, -0.58, -0.25, 0, 0);
  p.add(box(1.75, 0.5, 0.05), body, 0, 0.62, -0.66);
  for (const sx of [-1, 1]) p.add(box(0.35, 1.45, 0.06), body, sx * 1.2, 1.55, -0.5, 0, -sx * 0.5, 0);
  p.add(box(0.42, 0.55, 0.08), black, 0, 1.34, -0.62);
  p.add(box(0.24, 0.12, 0.08), black, -0.5, 1.82, -0.62);
  for (let i = 0; i < 9; i++) {
    for (const y of [1.0, 2.1]) p.add(new THREE.SphereGeometry(0.025, 5, 4), dark, -0.96 + i * 0.24, y, -0.66);
  }
  // Handwheels: elevation on the left, traverse on the right.
  for (const sx of [-1, 1]) {
    p.add(new THREE.TorusGeometry(0.16, 0.022, 4, 12), steel, sx * 0.48, 1.18, 0.55, 0, Math.PI / 2, 0);
    p.add(box(0.03, 0.3, 0.03), steel, sx * 0.48, 1.18, 0.55);
    p.add(box(0.03, 0.03, 0.3), steel, sx * 0.48, 1.18, 0.55);
    p.add(tubeX(0.025, 0.18, 6), steel, sx * 0.4, 1.18, 0.55);
  }
  p.buildInto(g);

  const cradle = new THREE.Group();
  cradle.name = 'barrel';
  cradle.position.set(0, GUN_PIVOT_Y, 0);
  const c = new PartBuilder();
  c.add(box(0.44, 0.3, 2.3), body, 0, -0.17, -0.25);
  c.add(tubeZ(0.11, 0.11, 2.1, 12), dark, 0, -0.36, -0.45);
  c.add(tubeZ(0.095, 0.095, 1.9, 12), body, 0, 0.27, -0.75);
  c.add(box(0.12, 0.08, 1.7), dark, 0, 0.17, -0.75);
  c.add(tubeX(0.08, 0.7, 10), steel, 0, -0.08, 0.05);
  // The dial sight on its bracket, on the left.
  c.add(box(0.06, 0.32, 0.06), steel, -0.3, 0.1, 0.25);
  c.add(tubeZ(0.045, 0.045, 0.22, 8), black, -0.3, 0.3, 0.25);
  c.add(new THREE.SphereGeometry(0.06, 8, 6), steel, -0.3, 0.32, 0.38);
  c.buildInto(cradle);
  const recoil = new THREE.Group();
  recoil.name = 'recoil';
  const r = new PartBuilder();
  r.add(tubeZ(0.12, 0.165, 3.0, 16), steel, 0, 0.05, -1.75);
  r.add(tubeZ(0.185, 0.185, 1.1, 16), steel, 0, 0.05, -0.65);
  r.add(tubeZ(0.15, 0.15, 0.2, 16), steel, 0, 0.05, -GUN_MUZZLE + 0.12);
  r.add(tubeZ(0.08, 0.08, 0.06, 12), black, 0, 0.05, -GUN_MUZZLE);
  r.add(box(0.42, 0.42, 0.5), dark, 0, 0.05, 0.22);
  r.add(box(0.06, 0.06, 0.35), steel, 0.24, 0.12, 0.42, 0, 0, 0.6);
  r.add(new THREE.SphereGeometry(0.05, 6, 4), black, 0.33, 0.18, 0.58);
  r.buildInto(recoil);
  cradle.add(recoil);
  g.add(cradle);
  return g;
}

/** A gun's ammunition limber (a two-wheeled box on a pole), a stack of shells, and two of its crew, round a gun at `gun` facing `face` (-1: -Z). */
function gunPit(scene: THREE.Scene, solids: Solids, gun: THREE.Vector3, face: number, color: number): void {
  const g = new THREE.Group();
  g.position.copy(gun);
  g.rotation.y = face < 0 ? 0 : Math.PI;
  const body = plastic(color);
  const dark = plastic(shade(color, 0.62));
  const steel = plastic(0x4a4d50);
  const brass = plastic(0xc9a144);
  const p = new PartBuilder();
  // The limber, off to the left behind the gun.
  p.add(new THREE.BoxGeometry(1.5, 0.9, 1), body, -4.6, 1.05, 6.5);
  p.add(new THREE.BoxGeometry(1.56, 0.08, 1.06), dark, -4.6, 1.52, 6.5);
  for (const x of [-5.5, -3.7]) {
    p.add(new THREE.TorusGeometry(0.58, 0.05, 5, 20), steel, x, 0.6, 6.5, 0, Math.PI / 2, 0);
    for (let k = 0; k < 5; k++) p.add(new THREE.BoxGeometry(0.04, 1.05, 0.06), dark, x, 0.6, 6.5, (k / 5) * Math.PI, 0, 0);
  }
  p.add(tubeX(0.05, 2.1, 8), steel, -4.6, 0.6, 6.5);
  p.beam(new THREE.Vector3(-4.6, 0.7, 5.95), new THREE.Vector3(-4.6, 0.12, 3.6), 0.08, dark);
  // Shells stacked on a pallet to the right: brass cases with grey noses.
  p.add(new THREE.BoxGeometry(1.4, 0.12, 0.9), dark, 3.4, 0.06, 3.2);
  for (let i = 0; i < 5; i++) {
    for (const z of [2.95, 3.2, 3.45]) {
      const x = 2.9 + i * 0.25;
      p.add(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 10), brass, x, 0.33, z);
      p.add(new THREE.ConeGeometry(0.075, 0.2, 10), steel, x, 0.64, z);
    }
  }
  p.buildInto(g);
  // Two of the crew: one bringing up a shell, one kneeling by the trail.
  const loader = createPoseFigure(color, 'carry');
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.55, 10).rotateX(Math.PI / 2), brass);
  shell.position.copy(CARRY_CRATE_AT);
  loader.add(shell);
  loader.position.set(1.7, 0, 2.6);
  const kneeler = createPoseFigure(color, 'kneel');
  kneeler.position.set(-1.4, 0, 1.8);
  kneeler.rotation.y = 0.3;
  g.add(loader, kneeler);
  scene.add(g);
  const at = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(gun);
  const limber = at(-4.6, 6.5);
  solids.box(limber.x, 0.75, limber.z, 1.2, 0.75, 0.8);
}

/** A water-cooled machine gun on a tripod, pointing -Z. */
function machineGun(): THREE.Group {
  const g = new THREE.Group();
  const steel = plastic(0x3d4144);
  const drab = plastic(0x5d6a3a);
  const p = new PartBuilder();
  for (const a of [0, 2.1, -2.1]) p.beam(new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(Math.sin(a) * 0.6, 0, Math.cos(a) * 0.5 + 0.2), 0.05, steel);
  p.add(new THREE.BoxGeometry(0.22, 0.24, 0.6), steel, 0, 1.05, 0.05);
  p.add(tubeZ(0.08, 0.08, 0.7), drab, 0, 1.08, -0.6);
  p.add(tubeZ(0.025, 0.025, 0.25), steel, 0, 1.08, -1.05);
  p.add(new THREE.BoxGeometry(0.2, 0.2, 0.3), drab, 0.22, 1.0, 0.05);
  p.add(new THREE.BoxGeometry(0.05, 0.12, 0.25), steel, 0, 1.0, 0.45);
  p.buildInto(g);
  return g;
}
