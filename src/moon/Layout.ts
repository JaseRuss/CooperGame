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
