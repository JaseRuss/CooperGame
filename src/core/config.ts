/** World is a square of this size in meters, centered on the origin. */
export const WORLD_SIZE = 3000;
export const WORLD_HALF = WORLD_SIZE / 2;

/** Heightfield resolution (samples per side). */
export const TERRAIN_SEGMENTS = 256;

/** Max terrain height variation in meters. */
export const TERRAIN_HEIGHT = 18;

export const WORLD_SEED = 1337;

/** Home base sits near the world edge; player starts here. */
export const BASE_POSITION = { x: 0, z: WORLD_HALF - 220 };
export const BASE_RADIUS = 60;

export const PLAYER_MAX_HEALTH = 100;
export const ENEMY_MAX_HEALTH = 100;

export const PLAYER_MAX_SPEED = 22; // m/s, ~2-2.5 min to cross the map
export const ENEMY_MAX_SPEED = 15;

export const MAX_ENEMIES = 14;
