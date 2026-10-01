/**
 * Rapier collision groups for the prison: walls and props are in the default group, the player
 * and the prisoners are "friends". Moving, the camera and line-of-sight checks only see walls,
 * so the squad never jams up a doorway or yanks the camera in, and the player's shots go past
 * his own side.
 */
const WORLD = 0x1;
const FRIEND = 0x2;
const groups = (membership: number, filter: number) => ((membership << 16) | filter) >>> 0;

/** The player's and the prisoners' capsules. */
export const FRIEND_GROUPS = groups(FRIEND, 0xffff);
/** Queries that only see walls and props: movement, the camera, "can he walk straight there?". */
export const WALLS_ONLY = groups(WORLD, 0xffff & ~FRIEND);
/** The player's rifle: hits anything but his own side. */
export const PLAYER_SHOTS = groups(WORLD, 0xffff & ~FRIEND);
