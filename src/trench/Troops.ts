import * as THREE from 'three';
import type { Trooper } from '../jungle/Trooper';
import { STEP_H, PARAPET_Z, BREACHES, zoneOf, lineAt } from './Layout';

export type Phase = 'artillery' | 'front' | 'assault' | 'won';
/** Holds the line from the fire step, an officer, or (in the assault) a grenade thrower or a rifleman. */
export type Role = 'line' | 'officer' | 'grenadier' | 'rifleman';
/** `reserve`: one of ours waiting behind the trench for the whistle, out of the fight until then. */
type Mode = 'duck' | 'up' | 'over' | 'support' | 'fight' | 'dugout' | 'reserve';

/** What the soldiers need from the game. */
export interface Front {
  phase: Phase;
  /** Our guns are shelling their trench to cover the assault: they keep their heads down. */
  barrage: boolean;
  sees(a: THREE.Vector3, b: THREE.Vector3): boolean;
  player: { pos: THREE.Vector3; chest: THREE.Vector3; down: boolean };
  players?: { pos: THREE.Vector3; chest: THREE.Vector3; down: boolean }[];
  /** Fires one round at `aim` with this much scatter (radians). */
  fireAt(shooter: Trooper, aim: THREE.Vector3, spread: number): void;
  /** Lobs a grenade from a soldier toward a spot. */
  throwGrenade(from: THREE.Vector3, at: THREE.Vector3): void;
}

export interface Man {
  t: Trooper;
  role: Role;
  mode: Mode;
  /** Which line he holds: ours is 0, theirs 0 (front), 1 (support) or 2 (reserve). */
  line: number;
  /** Ours, in the assault: one of the bombing party that goes on up their trenches with the player. */
  party: boolean;
  /** His place on the fire step (x), or in a dugout. */
  post: THREE.Vector2;
  timer: number;
  fire: number;
  scan: number;
  aim: THREE.Vector3 | null;
  grenades: number;
  /** In the assault: how far across no man's land he goes before he stops to shoot or throw. */
  stopZ: number;
}

/** Ducked down behind the parapet (out of sight, out of the line of fire), this far back from the step. */
const DUCK_BACK = 1.15;
/** How far the line can shoot across no man's land, and the close fighting range. */
const LINE_RANGE = 95;
const CLOSE_RANGE = 24;
const PISTOL_RANGE = 20;
/** A defender gets down off the step to fight once an attacker is this close. */
const DEFEND_CLOSE = 16;
const RUN = 5.2;
const WALK = 2.6;
/** How far a soldier can lob a grenade. */
const THROW_RANGE = 24;
/** Ours in the bombing party that follows the player up their trenches (the rest hold their front line), and the fewest it's let get down to before more join. */
const PARTY_EVERY = 7;
const PARTY_MIN = 6;

const sideOf = (t: Trooper) => (t.side === 'friend' ? 1 : -1);

/**
 * Every soldier in the trench battle but the player and the medics. Before the assault both lines
 * pop up on their fire steps to shoot and duck back down (out of reach of anything but a shell or
 * a grenade); their officers keep down and only look over now and then. During the shelling at the
 * start everyone keeps down. Over the top, our men cross no man's land in two groups (riflemen who
 * stop and shoot, more grenade throwers who get close and lob grenades into their trench), then
 * all charge in through the breaches. Their men get down off the step to fight anyone who's close.
 */
export class Troops {
  readonly men: Man[] = [];

  /** Adds a soldier: on a line at x, in a dugout (their officers), or (ours) waiting in reserve where he stands. */
  add(t: Trooper, role: Role, x: number, dugout?: THREE.Vector3, reserve = false, line = 0): Man {
    const m: Man = {
      t,
      role,
      mode: reserve ? 'reserve' : dugout ? 'dugout' : 'duck',
      line,
      party: false,
      post: dugout ? new THREE.Vector2(dugout.x, dugout.z) : new THREE.Vector2(x, sideOf(t) * lineAt(line).step),
      timer: Math.random() * 6,
      fire: 0.5 + Math.random() * 1.5,
      scan: Math.random() * 0.4,
      aim: null,
      grenades: 0,
      stopZ: 0,
    };
    this.men.push(m);
    if (reserve) {
      // Kneeling behind the parados, out of sight and out of reach of their rifles.
      t.crouch(true, true);
      t.yaw = 0;
    } else if (!dugout) this.duck(m);
    return m;
  }

  friends(): Man[] {
    return this.men.filter((m) => m.t.side === 'friend');
  }

  enemies(): Man[] {
    return this.men.filter((m) => m.t.side === 'enemy');
  }

  officers(): Man[] {
    return this.men.filter((m) => m.role === 'officer');
  }

  private duck(m: Man): void {
    const s = sideOf(m.t);
    if (m.t.lift > 0) m.t.setLift(0);
    m.t.warp(m.post.x, s * (lineAt(m.line).step + DUCK_BACK));
    m.t.crouch(true, true);
    m.t.yaw = s > 0 ? 0 : Math.PI;
    m.mode = 'duck';
  }

  private standUp(m: Man): void {
    const s = sideOf(m.t);
    m.t.setLift(STEP_H);
    m.t.warp(m.post.x, s * lineAt(m.line).step);
    m.t.crouch(false);
    m.t.yaw = s > 0 ? 0 : Math.PI;
    m.mode = 'up';
  }

  /** Off the step and on his feet in the trench, to fight close up. */
  private getDown(m: Man): void {
    if (m.t.lift > 0) {
      m.t.setLift(0);
      m.t.warp(m.t.pos.x, sideOf(m.t) * lineAt(m.line).floor);
    }
    m.t.crouch(false);
    m.mode = 'fight';
  }

  /**
   * The whistle: every one of ours goes over the top, from just in front of our parapet. They're
   * split into riflemen and (more of them) grenade throwers.
   */
  overTheTop(): void {
    let n = 0;
    for (const m of this.friends()) {
      if (m.t.down) continue;
      const t = m.t;
      if (t.lift > 0) t.setLift(0);
      t.crouch(false);
      t.warp(t.pos.x + (Math.random() - 0.5) * 1.5, PARAPET_Z - 1.2 - Math.random() * 1.6);
      m.role = n % 5 < 3 ? 'grenadier' : 'rifleman';
      m.party = n % PARTY_EVERY === 0 || n % PARTY_EVERY === 3;
      // Grenade throwers keep one back for bombing along their trenches.
      m.grenades = m.role === 'grenadier' ? 3 : 0;
      m.stopZ = m.role === 'grenadier' ? -PARAPET_Z + 14 + Math.random() * 4 : -2 + Math.random() * 8;
      m.mode = 'over';
      m.timer = Math.random() * 0.8; // they don't all leave the ladder at once
      n++;
    }
  }

  update(dt: number, front: Front): void {
    if (front.phase === 'assault') this.topUpParty(front);
    for (const m of this.men) {
      m.t.update(dt);
      if (!m.t.active) continue;
      m.scan -= dt;
      m.fire -= dt;
      m.timer -= dt;
      if (m.t.side === 'friend') this.thinkFriend(m, dt, front);
      else this.thinkEnemy(m, dt, front);
    }
  }

  /** Men from their captured front line join the bombing party when it's down to a handful. */
  private topUpParty(front: Front): void {
    let party = 0;
    for (const m of this.men) if (m.party && m.t.active) party++;
    if (party >= PARTY_MIN) return;
    const p = front.player.pos;
    let best: Man | null = null;
    let bestD = Infinity;
    for (const m of this.men) {
      if (m.t.side !== 'friend' || m.party || !m.t.active || m.mode !== 'fight' || zoneOf(m.t.pos.x, m.t.pos.z) < 3) continue;
      const d = Math.hypot(m.t.pos.x - p.x, m.t.pos.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (best) best.party = true;
  }

  private thinkFriend(m: Man, dt: number, front: Front): void {
    if (m.mode === 'reserve') return; // the whistle sends him over (overTheTop)
    if (front.phase === 'artillery' || front.phase === 'front' || front.phase === 'won') {
      if (m.mode === 'over' || m.mode === 'support' || m.mode === 'fight') {
        // Over the top already: in the won trench they just stand about.
        return;
      }
      this.holdTheLine(m, dt, front, front.phase === 'artillery' ? 99 : 4 + Math.random() * 3, 2.5 + Math.random() * 2);
      return;
    }
    const t = m.t;
    if (m.mode === 'duck' || m.mode === 'up') {
      // Still in our trench (he was down when the whistle went): the game puts him over at a ladder.
      if (m.t.lift > 0) m.t.setLift(0);
      m.t.crouch(false);
      m.mode = 'fight';
    }
    if (m.mode === 'over') {
      if (m.timer > 0) return;
      const target = new THREE.Vector3(t.pos.x + (breachNear(t.pos.x) - t.pos.x) * 0.15, 0, m.stopZ);
      if (t.pos.z - m.stopZ > 0.8) {
        // Shooting on the move if someone's right there.
        this.shootIfSeen(m, dt, front, 15, 0.03, 0.0015);
        t.stepToward(target.x, target.z, RUN, dt);
        return;
      }
      m.mode = 'support';
      m.timer = m.role === 'rifleman' ? 9 + Math.random() * 5 : 0.5 + Math.random() * 0.8;
    }
    if (m.mode === 'support') {
      t.faceToward(t.pos.x, t.pos.z - 10, dt);
      if (m.role === 'rifleman') {
        this.shootIfSeen(m, dt, front, 60, 0.012, 0.0004);
        if (m.timer <= 0) m.mode = 'fight';
        return;
      }
      if (m.timer <= 0) {
        const at = this.grenadeTarget(m, front);
        if (!at || m.grenades <= 1) {
          m.mode = 'fight';
          return;
        }
        m.grenades--;
        m.timer = 1.2 + Math.random() * 0.8;
        t.faceToward(at.x, at.z, 1, 99);
        front.throwGrenade(t.chest().setY(1.8), at);
      }
      return;
    }
    // Fight: shoot anyone in sight close by, or lob a grenade round the next corner, otherwise go
    // for the nearest of theirs (in through a breach, then on up the communication trenches to
    // their support and reserve lines). Once it's clear, they hold it near where they are.
    if (this.shootIfSeen(m, dt, front, CLOSE_RANGE, 0.02, 0.001)) return;
    if (m.grenades > 0 && m.timer <= 0) {
      const at = this.grenadeTarget(m, front);
      if (at) {
        m.grenades--;
        m.timer = 2.5 + Math.random() * 2;
        t.faceToward(at.x, at.z, 1, 99);
        front.throwGrenade(t.chest().setY(1.8), at);
        return;
      }
    }
    // They take their front line on their own, but push on into their trench system no further than
    // one step past the player: up the communication trenches with him, not miles ahead of him.
    const p = front.player.pos;
    const reach = m.party && !front.player.down ? Math.max(3, zoneOf(p.x, p.z) + 1) : 3;
    const foe = this.nearestFoe(m, reach);
    if (foe) t.stepToward(foe.t.pos.x, foe.t.pos.z, RUN, dt);
    else if (zoneOf(t.pos.x, t.pos.z) < 3) t.stepToward(m.post.x, -lineAt(0).floor, RUN, dt);
  }

  private thinkEnemy(m: Man, dt: number, front: Front): void {
    const t = m.t;
    if (front.phase === 'won') return;
    if (m.mode === 'dugout') {
      // Their officers in the dugouts: they only fight the player, when he comes for them.
      this.shootIfSeen(m, dt, front, PISTOL_RANGE, 0.025, 0.0012);
      return;
    }
    // His own line, and the communication trenches either side of it: what he defends.
    const home = 3 + m.line * 2;
    const defends = (p: THREE.Vector3) => {
      const z = zoneOf(p.x, p.z);
      return z >= 3 && Math.abs(z - home) <= 1;
    };
    if (front.phase === 'assault') {
      if (front.barrage && m.mode !== 'fight') {
        if (m.mode !== 'duck') this.duck(m);
        m.timer = Math.random() * 2;
        return;
      }
      if (m.mode === 'fight') {
        if (this.shootIfSeen(m, dt, front, m.role === 'officer' ? PISTOL_RANGE : CLOSE_RANGE, 0.02, 0.0012)) return;
        const foe = this.nearestFoe(m);
        // Defend the trench (down the communication trench to meet them, if need be), don't leave it.
        if (foe && defends(foe.pos) && Math.hypot(foe.pos.x - t.pos.x, foe.pos.z - t.pos.z) < 30) t.stepToward(foe.pos.x, foe.pos.z, WALK + 1, dt);
        return;
      }
      const close = this.nearestFoe(m);
      const near = close && (Math.hypot(close.pos.x - t.pos.x, close.pos.z - t.pos.z) < DEFEND_CLOSE || (defends(close.pos) && Math.abs(close.pos.x - t.pos.x) < 26));
      if (near || m.role === 'officer') {
        this.getDown(m);
        return;
      }
      this.holdTheLine(m, dt, front, 2 + Math.random() * 2, 2 + Math.random() * 2);
      return;
    }
    // Their support and reserve lines keep their heads down until we come over.
    if (m.line > 0) {
      if (m.mode !== 'duck') this.duck(m);
      return;
    }
    if (m.role === 'officer') {
      // Keeps his head down; now and then a look over the top through his field glasses.
      if (front.phase === 'artillery') {
        if (m.mode !== 'duck') this.duck(m);
        return;
      }
      if (m.mode === 'duck' && m.timer <= 0) {
        this.standUp(m);
        m.timer = 2.5 + Math.random() * 2;
      } else if (m.mode === 'up' && m.timer <= 0) {
        this.duck(m);
        m.timer = 7 + Math.random() * 8;
      }
      return;
    }
    this.holdTheLine(m, dt, front, front.phase === 'artillery' ? 99 : 3 + Math.random() * 4, 2.5 + Math.random() * 2);
  }

  /** Up on the step to shoot for a while, then down behind the parapet for a while. */
  private holdTheLine(m: Man, dt: number, front: Front, downFor: number, upFor: number): void {
    if (m.mode === 'duck') {
      if (m.timer <= 0) {
        this.standUp(m);
        m.timer = upFor;
      }
      return;
    }
    if (m.mode !== 'up') return;
    // Shooting at men charging them through the smoke, they're far wilder.
    if (front.phase === 'assault') this.shootIfSeen(m, dt, front, LINE_RANGE, 0.016, 0.0003);
    else this.shootIfSeen(m, dt, front, LINE_RANGE, 0.006, 0.00016);
    if (m.timer <= 0 || front.phase === 'artillery') {
      this.duck(m);
      m.timer = downFor;
    }
  }

  /** Looks for someone to shoot within `range` and fires when ready; true if he has a target. */
  private shootIfSeen(m: Man, dt: number, front: Front, range: number, base: number, perMetre: number): boolean {
    if (m.scan <= 0) {
      m.scan = 0.35 + Math.random() * 0.2;
      m.aim = this.look(m, front, range);
    }
    if (!m.aim) return false;
    m.t.faceToward(m.aim.x, m.aim.z, dt);
    if (m.fire <= 0) {
      const officer = m.role === 'officer';
      m.fire = (officer ? 1.1 : m.mode === 'up' ? 1.7 : 1.0) * (0.75 + Math.random() * 0.6);
      const d = m.aim.distanceTo(m.t.pos);
      front.fireAt(m.t, m.aim, base + d * perMetre);
    }
    return true;
  }

  /** The nearest foe he can see within range (an aim point at the chest), or null. */
  private look(m: Man, front: Front, range: number): THREE.Vector3 | null {
    const t = m.t;
    const eye = t.eye();
    const options: { d: number; at: THREE.Vector3 }[] = [];
    for (const o of this.men) {
      if (o.t.side === t.side || !o.t.active || o.t.inCover) continue;
      // Nobody but the player fights in or out of the dugouts: the officers in there are his to find.
      if (o.mode === 'dugout' || m.mode === 'dugout') continue;
      const d = Math.hypot(o.t.pos.x - t.pos.x, o.t.pos.z - t.pos.z);
      if (d < range) options.push({ d, at: o.t.chest() });
    }
    if (t.side === 'enemy') {
      for (const player of front.players ?? [front.player]) {
        if (player.down) continue;
        const p = player.pos;
        const d = Math.hypot(p.x - t.pos.x, p.z - t.pos.z);
        if (d < range) options.push({ d: d * 0.75, at: player.chest.clone() });
      }
    }
    options.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(5, options.length); i++) if (front.sees(eye, options[i].at)) return options[i].at;
    return null;
  }

  /** The nearest foe (for ours: not in a dugout, and in zone `reach` or nearer). */
  private nearestFoe(m: Man, reach = 8): { t: Trooper; pos: THREE.Vector3 } | null {
    const t = m.t;
    let best: { t: Trooper; pos: THREE.Vector3 } | null = null;
    let bestD = Infinity;
    for (const o of this.men) {
      // Ours don't go into their dugouts: the officers in there are the player's to find.
      if (o.t.side === t.side || !o.t.active || (t.side === 'friend' && (o.mode === 'dugout' || zoneOf(o.t.pos.x, o.t.pos.z) > reach))) continue;
      const d = Math.hypot(o.t.pos.x - t.pos.x, o.t.pos.z - t.pos.z);
      if (d < bestD) {
        bestD = d;
        best = { t: o.t, pos: o.t.pos };
      }
    }
    return best;
  }

  /** Somewhere in their trenches to lob a grenade: one of their men within reach, give or take, and not too near the player. */
  private grenadeTarget(m: Man, front: Front): THREE.Vector3 | null {
    const t = m.t;
    const p = front.player.pos;
    let best: THREE.Vector3 | null = null;
    let bestD = THROW_RANGE;
    for (const o of this.men) {
      if (o.t.side === 'friend' || !o.t.active || o.role === 'officer' || o.mode === 'dugout') continue;
      const d = Math.hypot(o.t.pos.x - t.pos.x, o.t.pos.z - t.pos.z);
      if (d < bestD && zoneOf(o.t.pos.x, o.t.pos.z) >= 3 && Math.hypot(o.t.pos.x - p.x, o.t.pos.z - p.z) > 9) {
        bestD = d;
        best = o.t.pos;
      }
    }
    if (!best) return null;
    return new THREE.Vector3(best.x + (Math.random() - 0.5) * 8, 0, best.z + (Math.random() - 0.5) * 4);
  }
}

/** The nearest breach in their parapet to x (they drift toward one as they cross). */
function breachNear(x: number): number {
  return BREACHES.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
}
