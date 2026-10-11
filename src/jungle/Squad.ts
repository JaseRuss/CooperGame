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
/** Catching up when well behind. */
const SPRINT = 9.5;
const CATCH_UP_FROM = 20;
/** Lost: this far from him for this long (or jammed for the second figure), and he's put back out of sight behind him. */
const LOST_DISTANCE = 36;
const LOST_TIME = 2;
const JAMMED_TIME = 3;


interface Brain {
  t: Trooper;
  slot: number;
  scan: number;
  fire: number;
  aim: THREE.Vector3 | null;
  holdAt: THREE.Vector2 | null;
  /** Seconds far behind, and seconds spent not getting anywhere (sampled once a second from `last`). */
  lost: number;
  jammed: number;
  sample: number;
  last: THREE.Vector2;
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
    this.list.push({ t, slot: this.list.length, scan: Math.random() * 0.3, fire: Math.random(), aim: null, holdAt: null, lost: 0, jammed: 0, sample: 0, last: new THREE.Vector2(t.pos.x, t.pos.z) });
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
      if (d > 1.4) t.stepToward(sx, sz, leaderDist > CATCH_UP_FROM ? SPRINT : d > 10 ? RUN : WALK, dt);
      else if (b.aim) t.faceToward(b.aim.x, b.aim.z, dt);
      if (!b.holdAt) this.keepUp(b, d, leaderDist, dt, battle, trail);
    }
  }

  /**
   * If he's fallen a long way behind or is jammed against something, and nobody can see it, he's
   * put back on the player's trail out of sight: the squad always keeps up.
   */
  private keepUp(b: Brain, spotDistance: number, leaderDist: number, dt: number, battle: Battle, trail: THREE.Vector3[]): void {
    const t = b.t;
    b.lost = leaderDist > LOST_DISTANCE ? b.lost + dt : 0;
    b.sample += dt;
    if (b.sample >= 1) {
      b.sample = 0;
      const moved = Math.hypot(t.pos.x - b.last.x, t.pos.z - b.last.y);
      b.jammed = moved < 0.5 && spotDistance > 6 ? b.jammed + 1 : 0;
      b.last.set(t.pos.x, t.pos.z);
    }
    if (b.lost < LOST_TIME && !(b.jammed >= JAMMED_TIME && leaderDist > 12)) return;
    if (!battle.unseen(t.pos.clone().setY(1))) return;
    // Back along the trail, beyond sight of the screen, and not on top of a mate.
    const player = battle.player.pos;
    for (let i = trail.length - 1 - Math.round(((b.slot + 1) * TRAIL_GAP) / 0.7); i >= Math.max(0, trail.length - 90); i--) {
      const p = trail[i];
      const dist = Math.hypot(p.x - player.x, p.z - player.z);
      if (dist < 7 || dist > 34) continue;
      const at = new THREE.Vector3(p.x, 1, p.z);
      if (!battle.unseen(at)) continue;
      if (this.list.some((o) => o !== b && Math.hypot(o.t.pos.x - p.x, o.t.pos.z - p.z) < 1.6)) continue;
      t.warp(p.x, p.z);
      b.lost = 0;
      b.jammed = 0;
      b.last.set(p.x, p.z);
      return;
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
