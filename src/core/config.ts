/** World is a square of this size in meters, centered on the origin. */
export const WORLD_SIZE = 3000;
export const WORLD_HALF = WORLD_SIZE / 2;
/** Nothing drives or flies further than this from the centre on either axis. */
export const EDGE_LIMIT = WORLD_HALF - 30;
/** The barrier round the edge of the map stands along this line, just outside EDGE_LIMIT. */
export const EDGE_WALL = WORLD_HALF - 26;

/** Heightfield resolution (samples per side). */
export const TERRAIN_SEGMENTS = 256;

/** Max terrain height variation in meters. */
export const TERRAIN_HEIGHT = 18;

/**
 * Which mission is playing, from the page's `?mission=` parameter. Mission 1 is the big battle:
 * it starts in sunshine and the day darkens as enemy bases fall, until the Fortress is stormed
 * at night under flares, tracer and explosions; mission 2 is a steamy jungle of thick trees and
 * villages of wooden huts; mission 3 is a land of knights and castles; mission 4 is the last
 * stand, every army together against waves of zombies. Mission 5 is a bonus level: a prison
 * break on foot (see `src/prison/`).
 */
export type Mission = 1 | 2 | 3 | 4 | 5;

/** Every mission in play order, as the level select lists them. */
export const MISSIONS: { mission: Mission; title: string; blurb: string; bonus?: true }[] = [
  { mission: 1, title: 'Day to Night', blurb: 'Starts in sunny fields and towns, but the sun sets as each of the five enemy bases falls. Then storm the Fortress in a night raid.' },
  { mission: 2, title: 'Jungle Strike', blurb: 'Thick jungle and wooden hut villages. Smash through the trees to find the enemy bases.' },
  { mission: 3, title: 'Castle Siege', blurb: 'Knights, cannons and dragons! Knock down five enemy castles, then the Great Castle.' },
  { mission: 4, title: 'Zombie Attack', blurb: 'Every army together at the Fortress against wave after wave of zombies. How long can you hold out?' },
  { mission: 5, title: 'Bonus: Prison Break', blurb: "On foot! The tan army has locked you up and taken your tank. Break out, free your buddies and drive home.", bonus: true },
];

const missionParam = Number(new URLSearchParams(window.location.search).get('mission'));
export const MISSION: Mission = MISSIONS.find((m) => m.mission === missionParam)?.mission ?? 1;
/** The day darkens into night as bases fall (it starts in full daylight). */
export const NIGHT = MISSION === 1;
export const JUNGLE = MISSION === 2;
export const KNIGHTS = MISSION === 3;
export const ZOMBIES = MISSION === 4;
/** The bonus level: on foot, breaking out of the tan army's prison. */
export const PRISON = MISSION === 5;

const SEEDS: Record<Mission, number> = { 1: 1337, 2: 3579, 3: 4680, 4: 5791, 5: 6802 };
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
  { x: 0, z: -EDGE, name: "Innes' Base", keepsake: 'dinosaur' },
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

/** The zombie mission has no enemy bases: the zombies come from outside. */
export const ENEMY_BASE_COUNT = ZOMBIES ? 0 : 5;

/**
 * Where the Fortress stands: the middle of the map, except on the first mission, where the bomb
 * tanker has to drive to it from Cooper's Base (bottom of the map), so it's in the far top-left corner.
 */
export const FORTRESS_CENTER = MISSION === 1 ? { x: -900, z: -900 } : { x: 0, z: 0 };

/** Half-size of the Fortress in the middle of the map: the final objective, locked until every enemy base falls. */
export const FORTRESS_HALF = 110;

export const PLAYER_MAX_HEALTH = 100;
export const ENEMY_MAX_HEALTH = 100;

export const PLAYER_MAX_SPEED = 22; // m/s, ~2-2.5 min to cross the map
export const ENEMY_MAX_SPEED = 15;

export const MAX_ENEMIES = 14;
