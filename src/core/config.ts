/** World is a square of this size in meters, centered on the origin. */
export const WORLD_SIZE = 3000;
export const WORLD_HALF = WORLD_SIZE / 2;

/** Heightfield resolution (samples per side). */
export const TERRAIN_SEGMENTS = 256;

/** Max terrain height variation in meters. */
export const TERRAIN_HEIGHT = 18;

/**
 * Which mission is playing, from the page's `?mission=` parameter. Mission 1 is the daytime
 * battle; mission 2 is the night raid, on a fresh battlefield (its own seed) under flares;
 * mission 3 is a steamy jungle of thick trees and villages of wooden huts.
 */
export type Mission = 1 | 2 | 3;

/** Every mission in play order, as the level select lists them. */
export const MISSIONS: { mission: Mission; title: string; blurb: string }[] = [
  { mission: 1, title: 'Day Battle', blurb: 'Sunny fields and towns. Knock out five enemy bases, then storm the Fortress.' },
  { mission: 2, title: 'Night Raid', blurb: 'New ground under the moon. Flares light up the enemy and flak guns guard their bases.' },
  { mission: 3, title: 'Jungle Strike', blurb: 'Thick jungle and wooden hut villages. Smash through the trees to find the enemy bases.' },
];

const missionParam = Number(new URLSearchParams(window.location.search).get('mission'));
export const MISSION: Mission = MISSIONS.find((m) => m.mission === missionParam)?.mission ?? 1;
export const NIGHT = MISSION === 2;
export const JUNGLE = MISSION === 3;

const SEEDS: Record<Mission, number> = { 1: 1337, 2: 2468, 3: 3579 };
export const WORLD_SEED = SEEDS[MISSION];

/** Reloads the page into another mission (a fresh world, from the start). */
export function startMission(mission: Mission): void {
  const url = new URL(window.location.href);
  url.searchParams.set('mission', String(mission));
  window.location.href = url.toString();
}

const EDGE = WORLD_HALF - 220;
const CORNER = WORLD_HALF - 300;

/** The toy monument each family base is decorated with. */
export type Keepsake = 'trophy' | 'hearts' | 'barbecue' | 'dinosaur' | 'yarn' | 'golf' | 'cupcake' | 'football';

export interface FriendlyBase {
  x: number;
  z: number;
  name: string;
  keepsake: Keepsake;
}

/** Family bases around the map edge and corners. The first is Cooper's: the player starts there. */
export const FRIENDLY_BASES: FriendlyBase[] = [
  { x: 0, z: EDGE, name: "Cooper's Base", keepsake: 'trophy' },
  { x: -EDGE, z: 0, name: "Mum's Base", keepsake: 'hearts' },
  { x: EDGE, z: 0, name: "Dad's Base", keepsake: 'barbecue' },
  { x: 0, z: -EDGE, name: "Inness's Base", keepsake: 'dinosaur' },
  { x: -CORNER, z: -CORNER, name: "Granny's Base", keepsake: 'yarn' },
  { x: CORNER, z: -CORNER, name: "Grandpa's Base", keepsake: 'golf' },
  { x: -CORNER, z: CORNER, name: "Auntie Claire's Base", keepsake: 'cupcake' },
  { x: CORNER, z: CORNER, name: "Uncle Steven's Base", keepsake: 'football' },
];
export const BASE_POSITION = FRIENDLY_BASES[0];
export const BASE_RADIUS = 60;

export function distanceToFriendlyBase(x: number, z: number): number {
  return Math.min(...FRIENDLY_BASES.map((b) => Math.hypot(x - b.x, z - b.z)));
}

export function nearestFriendlyBase(x: number, z: number): FriendlyBase {
  let best = FRIENDLY_BASES[0];
  let bestD = Infinity;
  for (const b of FRIENDLY_BASES) {
    const d = Math.hypot(x - b.x, z - b.z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

export const ENEMY_BASE_COUNT = 5;

/** Half-size of the Fortress in the middle of the map: the final objective, locked until every enemy base falls. */
export const FORTRESS_HALF = 110;

export const PLAYER_MAX_HEALTH = 100;
export const ENEMY_MAX_HEALTH = 100;

export const PLAYER_MAX_SPEED = 22; // m/s, ~2-2.5 min to cross the map
export const ENEMY_MAX_SPEED = 15;

export const MAX_ENEMIES = 14;
