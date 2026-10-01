/**
 * Rapier collision groups for the prison: walls and props are in the default group, the player
 * and the prisoners are "friends" and the tan guards "enemies". Moving, the camera and
 * line-of-sight checks only see walls, so nobody jams up a doorway or yanks the camera in; each
 * side's shots go past its own people.
 */
const WORLD = 0x1;
const FRIEND = 0x2;
const ENEMY = 0x4;
const groups = (membership: number, filter: number) => ((membership << 16) | filter) >>> 0;

/** The player's and the prisoners' capsules. */
export const FRIEND_GROUPS = groups(FRIEND, 0xffff);
/** The guards' capsules. */
export const ENEMY_GROUPS = groups(ENEMY, 0xffff);
/** Queries that only see walls and props: movement, the camera, "can he walk (or see) straight there?". */
export const WALLS_ONLY = groups(WORLD, 0xffff & ~FRIEND & ~ENEMY);
/** The player's and the prisoners' shots (and jam): walls and guards. */
export const FRIEND_SHOTS = groups(WORLD, 0xffff & ~FRIEND);
/** The guards' shots: walls, the player and the prisoners. */
export const ENEMY_SHOTS = groups(WORLD, 0xffff & ~ENEMY);
