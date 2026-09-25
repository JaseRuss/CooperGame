import { mulberry32 } from '../utils/rng';
import { randRange } from '../utils/math';
import { WORLD_HALF, WORLD_SEED, distanceToFriendlyBase } from '../core/config';

export const ROAD_WIDTH = 12;
const TOWN_COUNT = 8;
const TOWN_MIN_SPACING = 520;
const TOWN_MIN_DIST_FROM_BASE = 380;
const STREET_SPACING = 72;
const LOT_WIDTH = 26;
const LOT_SETBACK = 20; // road centerline to house center
const TOWN_MARGIN = 34;

export interface Road {
  x: number;
  z: number;
  length: number;
  alongX: boolean;
}

export interface Lot {
  x: number;
  z: number;
  /** rotation.y that turns the model's front (+Z) toward the road */
  facing: number;
  /** Shops line the town's central high street; everything else is houses. */
  kind: 'house' | 'shop';
  /** Z of the street this lot fronts onto. */
  streetZ: number;
}

export interface Town {
  cx: number;
  cz: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  roads: Road[];
  lots: Lot[];
  /** Z of each east-west street, and X of each north-south cross street. */
  streetZs: number[];
  crossXs: number[];
  halfLen: number;
}

function buildTown(cx: number, cz: number, rng: () => number): Town {
  const streetCount = 2 + Math.floor(rng() * 2);
  const length = Math.round(randRange(rng, 170, 270) / LOT_WIDTH) * LOT_WIDTH;
  const halfLen = length / 2;
  const roads: Road[] = [];
  const lots: Lot[] = [];

  const streetZs: number[] = [];
  for (let i = 0; i < streetCount; i++) streetZs.push(cz + (i - (streetCount - 1) / 2) * STREET_SPACING);

  for (const z of streetZs) roads.push({ x: cx, z, length: length + ROAD_WIDTH, alongX: true });

  const crossXs = [cx - halfLen, cx + halfLen];
  if (length > 210) crossXs.push(cx);
  const crossZMin = streetZs[0] - STREET_SPACING / 2;
  const crossZMax = streetZs[streetZs.length - 1] + STREET_SPACING / 2;
  for (const x of crossXs) {
    roads.push({ x, z: (crossZMin + crossZMax) / 2, length: crossZMax - crossZMin, alongX: false });
  }

  const highStreet = Math.floor((streetCount - 1) / 2);
  streetZs.forEach((z, streetIndex) => {
    const kind = streetIndex === highStreet ? 'shop' : 'house';
    for (let x = cx - halfLen + LOT_WIDTH; x <= cx + halfLen - LOT_WIDTH + 0.01; x += LOT_WIDTH) {
      if (crossXs.some((cxRoad) => Math.abs(cxRoad - x) < LOT_WIDTH * 0.75)) continue;
      if (rng() < 0.12) continue; // occasional empty lot
      lots.push({ x, z: z - LOT_SETBACK, facing: 0, kind, streetZ: z });
      if (rng() < 0.12) continue;
      lots.push({ x, z: z + LOT_SETBACK, facing: Math.PI, kind, streetZ: z });
    }
  });

  return {
    cx,
    cz,
    minX: cx - halfLen - TOWN_MARGIN,
    maxX: cx + halfLen + TOWN_MARGIN,
    minZ: crossZMin - TOWN_MARGIN,
    maxZ: crossZMax + TOWN_MARGIN,
    roads,
    lots,
    streetZs,
    crossXs,
    halfLen,
  };
}

function generateTowns(): Town[] {
  const rng = mulberry32(WORLD_SEED + 211);
  const towns: Town[] = [];
  let attempts = 0;

  while (towns.length < TOWN_COUNT && attempts < 500) {
    attempts++;
    const x = randRange(rng, -WORLD_HALF + 260, WORLD_HALF - 260);
    const z = randRange(rng, -WORLD_HALF + 260, WORLD_HALF - 260);
    if (distanceToFriendlyBase(x, z) < TOWN_MIN_DIST_FROM_BASE) continue;
    if (towns.some((t) => Math.hypot(x - t.cx, z - t.cz) < TOWN_MIN_SPACING)) continue;
    towns.push(buildTown(x, z, rng));
  }

  return towns;
}

export const TOWNS: Town[] = generateTowns();

/** Distance from (x, z) to the nearest town footprint; 0 when inside one. */
export function distanceToTown(town: Town, x: number, z: number): number {
  const dx = Math.max(town.minX - x, 0, x - town.maxX);
  const dz = Math.max(town.minZ - z, 0, z - town.maxZ);
  return Math.hypot(dx, dz);
}

export function isInAnyTown(x: number, z: number, padding = 0): boolean {
  return TOWNS.some((t) => distanceToTown(t, x, z) <= padding);
}
