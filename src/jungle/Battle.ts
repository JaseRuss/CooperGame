import type * as THREE from 'three';
import type { Trooper } from './Trooper';

/** What the soldiers' brains need to know about the world and what they can do in it. */
export interface Battle {
  /** A clear line between two points: trunks, huts and walls block it (people don't). */
  sees(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** How far anyone can see, as a share of normal (the rain cuts it). */
  visibility: number;
  /** The player: where he is, whether he's down, and whether he's creeping. */
  player: { pos: THREE.Vector3; chest: THREE.Vector3; down: boolean; sneaking: boolean };
  players?: { pos: THREE.Vector3; chest: THREE.Vector3; down: boolean; sneaking: boolean }[];
  /** `shooter` fires at `aim` (with scatter); the game works out what it hits. */
  fireAt(shooter: Trooper, aim: THREE.Vector3): void;
  /** Who's about: the squad (standing ones) and the enemy (standing ones). */
  squad(): Trooper[];
  enemies(): Trooper[];
  /** Whether a point is out of the player's view (behind him or off the edge of the screen). */
  unseen(p: THREE.Vector3): boolean;
  /** Where bombs are armed and ticking. */
  bombs(): THREE.Vector3[];
}
