import * as THREE from 'three';
import type { Battle } from './Battle';
import type { Trooper } from './Trooper';

const SIGHT = 34;
const FIRE_EVERY = 1.0;
const FIRE_RANGE = 30;
/** Metres of the player's trail between each squad mate, and the first one's gap behind him. */
const TRAIL_GAP = 2.4;
/** Seconds a squad mate lies there before he's back up, and with how many hit points. */
const REVIVE_AFTER = 13;
const REVIVE_HP = 22;
/** Keep this far from an armed bomb. */
const BOMB_CLEAR = 24;
const WALK = 4.4;
const RUN = 6.8;

interface Brain {
  t: Trooper;
  slot: number;
  scan: number;
  fire: number;
  aim: THREE.Vector3 | null;
  holdAt: THREE.Vector2 | null;
}

/**
 * The player's squad. They follow along his trail in single file, stop and shoot at any enemy
 * they can see in range, get knocked down and get back up on their own, and keep well clear of an
 * armed bomb. X tells them to hold where they are, and again to follow.
 */
export class Squad {
  readonly list: Brain[] = [];
  holding = false;

  add(t: Trooper): void {
    this.list.push({ t, slot: this.list.length, scan: Math.random() * 0.3, fire: Math.random(), aim: null, holdAt: null });
  }

  /** Toggles "hold here" / "follow me". */
  toggleHold(): boolean {
    this.holding = !this.holding;
    for (const b of this.list) b.holdAt = this.holding ? new THREE.Vector2(b.t.pos.x, b.t.pos.z) : null;
    return this.holding;
  }

  get standing(): number {
    return this.list.filter((b) => b.t.active).length;
  }

  update(dt: number, battle: Battle, trail: THREE.Vector3[]): void {
    for (const b of this.list) {
      const t = b.t;
      t.update(dt);
      if (t.down) {
        if (t.stateTime > REVIVE_AFTER) t.revive(REVIVE_HP);
        continue;
      }
      if (!t.active) continue;
      // Run from a bomb that's about to go off.
      let fled = false;
      for (const bomb of battle.bombs()) {
        const d = Math.hypot(t.pos.x - bomb.x, t.pos.z - bomb.z);
        if (d < BOMB_CLEAR) {
          const away = new THREE.Vector3(t.pos.x - bomb.x, 0, t.pos.z - bomb.z).normalize();
          t.stepToward(t.pos.x + away.x * 8, t.pos.z + away.z * 8, RUN, dt);
          fled = true;
          break;
        }
      }
      if (fled) continue;
      b.scan -= dt;
      if (b.scan <= 0) {
        b.scan = 0.3 + Math.random() * 0.15;
        b.aim = this.look(b, battle);
      }
      b.fire -= dt;
      const leaderDist = Math.hypot(battle.player.pos.x - t.pos.x, battle.player.pos.z - t.pos.z);
      if (b.aim && (leaderDist < 28 || this.holding)) {
        t.faceToward(b.aim.x, b.aim.z, dt);
        if (b.fire <= 0) {
          b.fire = FIRE_EVERY * (0.8 + Math.random() * 0.6);
          battle.fireAt(t, b.aim);
        }
        continue;
      }
      // Otherwise: his place in the file.
      let sx: number;
      let sz: number;
      if (b.holdAt) {
        sx = b.holdAt.x;
        sz = b.holdAt.y;
      } else {
        const lag = Math.round(((b.slot + 1) * TRAIL_GAP) / 0.7);
        const p = trail[Math.max(0, trail.length - 1 - lag)] ?? battle.player.pos;
        sx = p.x;
        sz = p.z;
      }
      const d = Math.hypot(sx - t.pos.x, sz - t.pos.z);
      if (d > 1.4) t.stepToward(sx, sz, d > 10 ? RUN : WALK, dt);
      else if (b.aim) t.faceToward(b.aim.x, b.aim.z, dt);
    }
  }

  private look(b: Brain, battle: Battle): THREE.Vector3 | null {
    const t = b.t;
    const eye = t.eye();
    const reach = SIGHT * battle.visibility;
    let best: { d: number; at: THREE.Vector3 } | null = null;
    for (const e of battle.enemies()) {
      const d = Math.hypot(e.pos.x - t.pos.x, e.pos.z - t.pos.z);
      if (d > Math.min(reach, FIRE_RANGE) || (best && d >= best.d)) continue;
      const chest = e.chest();
      if (battle.sees(eye, chest)) best = { d, at: chest };
    }
    return best ? (best as { d: number; at: THREE.Vector3 }).at : null;
  }
}
