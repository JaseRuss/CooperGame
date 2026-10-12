import * as THREE from 'three';
import { mulberry32 } from '../utils/rng';
import { ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE } from '../utils/plastic';
import type { FlatZone } from './MoonTerrain';

/** Where the buggy starts: on the main base's parade ground, facing the supply bays. */
export const START = { x: 0, z: 8, yaw: 0 };
/** The main base's flat ground. */
export const BASE_ZONE: FlatZone = { x: 0, z: -8, r: 82 };
/** Crates each camp needs before its base can be built, and the most the buggy's bed holds. */
export const CRATES_NEEDED = 3;

export type ArmyId = 'green' | 'red' | 'tan' | 'blue';

export interface Faction {
  id: ArmyId;
  name: string;
  color: number;
  /** The supply bay at the main base where this army's crates are loaded. */
  bay: { x: number; z: number };
  /** The middle of the army's camp, and where it builds. */
  camp: { x: number; z: number };
}

/** Bays line up in front of the main base; each army's camp lies out in its own direction. */
export const FACTIONS: Faction[] = [
  { id: 'blue', name: 'Blue Army', color: ARMY_BLUE, bay: { x: -39, z: 24 }, camp: { x: -470, z: -190 } },
  { id: 'green', name: 'Green Army', color: ARMY_GREEN, bay: { x: -13, z: 24 }, camp: { x: -330, z: 270 } },
  { id: 'red', name: 'Red Army', color: ARMY_RED, bay: { x: 13, z: 24 }, camp: { x: 360, z: 300 } },
  { id: 'tan', name: 'Tan Army', color: ARMY_TAN, bay: { x: 39, z: 24 }, camp: { x: 480, z: -150 } },
];

/** Radius of a camp's flat ground, and how far from the camp's middle (toward the road) its drop-off ring is. */
export const CAMP_R = 46;
export const DROP_DISTANCE = 21;
export const DROP_RADIUS = 8.5;
export const BAY_RADIUS = 8;

/** Unit vector from a camp toward the main base, which is the side its road arrives from. */
export function approach(f: Faction): THREE.Vector2 {
  return new THREE.Vector2(f.bay.x - f.camp.x, 44 - f.camp.z).normalize();
}

/** Where an army's drop-off ring is, in the world. */
export function dropPoint(f: Faction): THREE.Vector2 {
  const u = approach(f);
  return new THREE.Vector2(f.camp.x + u.x * DROP_DISTANCE, f.camp.z + u.y * DROP_DISTANCE);
}

/** The dirt road from an army's bay to its camp: out of the base, a few lazy bends, then straight in to the drop-off ring. */
export function roadTo(f: Faction, index: number): [number, number][] {
  const rng = mulberry32(900 + index * 17);
  const u = approach(f);
  const start = new THREE.Vector2(f.bay.x, 44);
  const camp = new THREE.Vector2(f.camp.x, f.camp.z);
  const drop = dropPoint(f);
  const inbound = camp.clone().addScaledVector(u, 105);
  const pts: [number, number][] = [[start.x, start.y], [start.x + (f.bay.x < 0 ? -10 : 10), start.y + 22]];
  const span = inbound.clone().sub(start);
  const side = new THREE.Vector2(-span.y, span.x).normalize();
  const bends = [0.25, 0.5, 0.75];
  let sign = rng() < 0.5 ? -1 : 1;
  for (const t of bends) {
    const wiggle = sign * (30 + rng() * 45) * Math.sin(t * Math.PI);
    const p = start.clone().addScaledVector(span, t).addScaledVector(side, wiggle);
    pts.push([p.x, p.y]);
    sign = -sign;
  }
  pts.push([inbound.x, inbound.y], [drop.x, drop.y]);
  return pts;
}

/** Flat ground for every camp. */
export function campZones(): FlatZone[] {
  return FACTIONS.map((f) => ({ x: f.camp.x, z: f.camp.z, r: CAMP_R }));
}

// ---------- the Weird Side ----------

/**
 * The valley over the northern mountains that opens once every army has its Moon base: an ellipse
 * of flat-ish, pastel ground ringed by mountains, full of odd things to find.
 */
export const VALLEY = { x: 0, z: -1130, rx: 450, rz: 280 };
/** The canyon road through the mountains: from the plain's north edge (z `from`) into the valley (z `to`). */
export const CANYON = { from: -540, to: -890, half: 15 };
/** The ring road round the middle of the valley. */
export const LOOP = { x: 0, z: -1130, rx: 270, rz: 160 };
/** Where the new road leaves the main base: behind the big dome. */
export const NORTH_START = { x: 0, z: -64 };

/** The canyon's middle line: a lazy S, so you can't see down it into the valley from the plain. */
export function canyonX(z: number): number {
  const t = THREE.MathUtils.clamp((CANYON.from - z) / (CANYON.from - CANYON.to), 0, 1);
  return 30 * Math.sin(t * Math.PI * 2);
}

/** How far out of the valley (x, z) is: under 1 inside, 1 on its rim. */
export function valleyQ(x: number, z: number, shrink = 0): number {
  return Math.hypot((x - VALLEY.x) / (VALLEY.rx - shrink), (z - VALLEY.z) / (VALLEY.rz - shrink));
}

/** 1 where the mountains are carved away for the canyon and the valley, 0 where they stand, in between on their slopes. */
export function openness(x: number, z: number): number {
  const smooth = THREE.MathUtils.smoothstep;
  let open = 1 - smooth((valleyQ(x, z) - 1) * Math.min(VALLEY.rx, VALLEY.rz), 0, 110);
  if (z < CANYON.from + 40 && z > CANYON.to - 60) open = Math.max(open, 1 - smooth(Math.abs(x - canyonX(z)), CANYON.half + 3, CANYON.half + 45));
  return open;
}

/** The new road: out the back of the main base, north across the plain, through the canyon and down to the ring road. */
export function northRoad(): [number, number][] {
  const pts: [number, number][] = [[NORTH_START.x, NORTH_START.z], [0, -110], [-22, -220], [16, -350], [-6, -460]];
  for (let z = CANYON.from; z >= CANYON.to; z -= 35) pts.push([canyonX(z), z]);
  pts.push([0, -930], [0, LOOP.z + LOOP.rz]);
  return pts;
}

/** The ring road round the valley, as a closed loop (its last point is its first). */
export function valleyLoop(): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI / 2 + (i / 24) * Math.PI * 2;
    pts.push([LOOP.x + Math.cos(a) * LOOP.rx, LOOP.z + Math.sin(a) * LOOP.rz]);
  }
  return pts;
}
