import * as THREE from 'three';
import type { ZombieKind } from '../entities/Soldier';

/**
 * The zombie mission's waves. A new wave starts every minute, from more sides as the waves go on,
 * and each is bigger than the last (it grows faster than the defenders can keep up with). Runners
 * join from wave 3 and brutes from wave 5. A wave is let loose a pack at a time, so a big one
 * doesn't all pop up in a single frame, and there's a cap on how many can be up at once.
 */

const FIRST_WAVE = 25; // seconds after the start
const WAVE_INTERVAL = 60;
/** Zombies appear this far out from the middle of the Fortress. */
const SPAWN_RADIUS = 380;
const PACK_SIZE = 8;
const PACK_GAP = 1.2; // seconds between packs
const MAX_STANDING = 230;

export interface ZombiePack {
  x: number;
  z: number;
  /** Where they head: a spot on the Fortress wall facing them. */
  goal: THREE.Vector2;
  kinds: ZombieKind[];
}

export interface WaveStart {
  wave: number;
  count: number;
  /** Compass directions they're coming from, e.g. ["north", "east"]. */
  from: string[];
}

/** How many zombies are in wave `w` (1, 2, ...). */
export function waveSize(w: number): number {
  return Math.round(9 + 3 * w + 0.27 * w * w);
}

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

export class ZombieWaves {
  wave = 0;
  private timer = FIRST_WAVE;
  private packTimer = 0;
  private readonly queue: ZombiePack[] = [];

  constructor(
    private readonly center: THREE.Vector3,
    private readonly rng: () => number,
  ) {}

  /** Seconds until the next wave. */
  get nextIn(): number {
    return Math.max(0, this.timer);
  }

  /** Zombies of the current wave still waiting to come on. */
  get waiting(): number {
    return this.queue.reduce((n, p) => n + p.kinds.length, 0);
  }

  /**
   * Advances the clock. Returns the wave that just started (if one did) and the packs to put in
   * the world this frame.
   */
  update(dt: number, standing: number): { started: WaveStart | null; packs: ZombiePack[] } {
    let started: WaveStart | null = null;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer += WAVE_INTERVAL;
      started = this.startWave();
    }
    const packs: ZombiePack[] = [];
    this.packTimer -= dt;
    if (this.queue.length > 0 && this.packTimer <= 0 && standing + this.queue[0].kinds.length <= MAX_STANDING) {
      this.packTimer = PACK_GAP;
      packs.push(this.queue.shift() as ZombiePack);
    }
    return { started, packs };
  }

  private startWave(): WaveStart {
    const w = ++this.wave;
    const count = waveSize(w);
    const sides = Math.min(4, 1 + Math.floor((w + 1) / 3));
    const runners = w >= 3 ? Math.min(0.35, 0.06 * (w - 2)) : 0;
    const brutes = w >= 5 ? Math.min(0.22, 0.035 * (w - 4)) : 0;
    const base = this.rng() * Math.PI * 2;
    const angles = Array.from({ length: sides }, (_, i) => base + (i / sides) * Math.PI * 2 + (this.rng() - 0.5) * 0.6);
    let left = count;
    let side = 0;
    while (left > 0) {
      const n = Math.min(PACK_SIZE, left);
      left -= n;
      const a = angles[side++ % sides] + (this.rng() - 0.5) * 0.5;
      const r = SPAWN_RADIUS + (this.rng() - 0.5) * 60;
      const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const across = (this.rng() - 0.5) * 150;
      const goal = new THREE.Vector2(this.center.x + dir.x * 40 - dir.y * across, this.center.z + dir.y * 40 + dir.x * across);
      const kinds: ZombieKind[] = Array.from({ length: n }, () => {
        const roll = this.rng();
        return roll < brutes ? 'brute' : roll < brutes + runners ? 'runner' : 'walker';
      });
      this.queue.push({ x: this.center.x + dir.x * r, z: this.center.z + dir.y * r, goal, kinds });
    }
    // Interleave the sides so they all arrive together rather than one after another.
    this.queue.sort(() => this.rng() - 0.5);
    const from = [...new Set(angles.map((a) => COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]))];
    return { wave: w, count, from };
  }
}
