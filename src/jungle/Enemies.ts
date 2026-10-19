import * as THREE from 'three';
import type { Battle } from './Battle';
import type { Trooper } from './Trooper';

const SIGHT = 36;
/** Anyone this close is noticed whichever way he's looking, rain or not. */
const NOTICE = 6;
const ALERT_TIME = 11;
const CALL_RADIUS = 26;
const WALK = 1.4;
const RUN = 3.4;
const FIRE_EVERY = 1.35;
/** An alerted soldier closes to this far from what he's shooting at, then stands and fires. */
const ENGAGE = 17;
const FIRE_RANGE = 34;
/** Caught off guard: how long he gapes before he reacts (longer the closer you are when you're spotted). */
const STARTLE_FAR = 0.7;
const STARTLE_NEAR = 1.5;

interface Brain {
  t: Trooper;
  post: THREE.Vector2;
  roam: number;
  alert: number;
  last: THREE.Vector3 | null;
  seen: boolean;
  aim: THREE.Vector3;
  scan: number;
  fire: number;
  wander: THREE.Vector2 | null;
  wait: number;
  /** Seconds left of being startled: he stands and stares, and doesn't shoot or move. */
  startle: number;
  /** On patrol: the beat he walks up and down at ease (instead of wandering about his post), and the point he's heading for. */
  beat: THREE.Vector2[] | null;
  leg: number;
  way: 1 | -1;
}

/**
 * The enemy's soldiers. Each stands about his post (or an outpost's yard) until something
 * comes into view (further in clear weather than in a storm, nearer if you creep) or a shot is
 * heard; then he's alerted, calls the men near him, closes in to about seventeen metres, and
 * stands and shoots. Lose him and he searches where you were, then goes back to his post.
 */
export class Enemies {
  readonly list: Brain[] = [];

  /** A soldier on patrol: he walks `beat` there and back at ease, and goes back to it once he's lost you. */
  patrol(t: Trooper, beat: THREE.Vector2[]): void {
    this.add(t, 0);
    const b = this.list[this.list.length - 1];
    b.beat = beat;
  }

  add(t: Trooper, roam: number): void {
    this.list.push({
      t,
      post: new THREE.Vector2(t.pos.x, t.pos.z),
      roam,
      alert: 0,
      last: null,
      seen: false,
      aim: new THREE.Vector3(),
      scan: Math.random() * 0.4,
      fire: 0.6 + Math.random() * FIRE_EVERY,
      wander: null,
      wait: Math.random() * 3,
      startle: 0,
      beat: null,
      leg: 1,
      way: 1,
    });
  }

  /** Something loud at `at`: soldiers within `radius` come to look. */
  hear(at: THREE.Vector3, radius: number): void {
    for (const b of this.list) {
      if (!b.t.active || b.alert > 0) continue;
      if (Math.hypot(b.t.pos.x - at.x, b.t.pos.z - at.z) < radius) {
        b.alert = ALERT_TIME * 0.7;
        b.startle = 0.5;
        b.last = at.clone();
      }
    }
  }

  /** Soldiers on the alert right now. */
  get alerted(): number {
    return this.list.filter((b) => b.t.active && b.alert > 0).length;
  }

  update(dt: number, battle: Battle): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.t.update(dt);
      if (b.t.gone) {
        b.t.dispose();
        this.list.splice(i, 1);
        continue;
      }
      if (!b.t.active) continue;
      this.think(b, dt, battle);
    }
  }

  private think(b: Brain, dt: number, battle: Battle): void {
    const t = b.t;
    b.scan -= dt;
    if (b.scan <= 0) {
      b.scan = 0.35 + Math.random() * 0.15;
      this.look(b, battle);
    }
    b.fire -= dt;
    if (b.alert > 0) {
      b.alert -= dt;
      if (b.startle > 0) {
        b.startle -= dt;
        t.surprise(true);
        if (b.last) t.faceToward(b.last.x, b.last.z, dt, 14);
        return;
      }
      t.surprise(false);
      if (b.seen) {
        const d = Math.hypot(b.aim.x - t.pos.x, b.aim.z - t.pos.z);
        if (d > ENGAGE) t.stepToward(b.aim.x, b.aim.z, RUN, dt);
        else t.faceToward(b.aim.x, b.aim.z, dt);
        if (b.fire <= 0 && d < FIRE_RANGE) {
          b.fire = FIRE_EVERY * (0.8 + Math.random() * 0.7);
          battle.fireAt(t, b.aim);
        }
      } else if (b.last) {
        if (Math.hypot(b.last.x - t.pos.x, b.last.z - t.pos.z) > 2) t.stepToward(b.last.x, b.last.z, RUN, dt);
        else b.alert = Math.min(b.alert, 2.5); // got there: a look round, then back to his post
      }
      return;
    }
    // On patrol: walk the beat, turning round at each end.
    if (b.beat) {
      const to = b.beat[b.leg];
      if (Math.hypot(to.x - t.pos.x, to.y - t.pos.z) < 1.2) {
        if (b.leg + b.way < 0 || b.leg + b.way >= b.beat.length) b.way = b.way === 1 ? -1 : 1;
        b.leg += b.way;
      } else t.stepToward(to.x, to.y, WALK, dt);
      return;
    }
    // At ease: wander about the post.
    if (b.wander) {
      if (Math.hypot(b.wander.x - t.pos.x, b.wander.y - t.pos.z) < 0.8) {
        b.wander = null;
        b.wait = 1.5 + Math.random() * 5;
      } else t.stepToward(b.wander.x, b.wander.y, WALK, dt);
    } else {
      b.wait -= dt;
      if (b.wait <= 0 && b.roam > 0) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * b.roam;
        b.wander = new THREE.Vector2(b.post.x + Math.cos(a) * r, b.post.y + Math.sin(a) * r);
      }
    }
  }

  /** Looks for anyone to shoot: the player (further when he's not creeping) and the squad. */
  private look(b: Brain, battle: Battle): void {
    const t = b.t;
    const eye = t.eye();
    const reach = SIGHT * battle.visibility;
    let best: { d: number; at: THREE.Vector3 } | null = null;
    const consider = (pos: THREE.Vector3, chest: THREE.Vector3, range: number) => {
      const d = Math.hypot(pos.x - t.pos.x, pos.z - t.pos.z);
      if (d > Math.max(range, NOTICE) || (best && d >= best.d)) return;
      if (battle.sees(eye, chest)) best = { d, at: chest };
    };
    for (const player of battle.players ?? [battle.player]) {
      if (!player.down) consider(player.pos, player.chest, player.sneaking ? reach * 0.55 : reach);
    }
    for (const f of battle.squad()) consider(f.pos, f.chest(), reach * 0.9);
    if (!best) {
      b.seen = false;
      return;
    }
    const found = best as { d: number; at: THREE.Vector3 };
    b.seen = true;
    b.aim.copy(found.at);
    b.last = found.at.clone();
    const wasCalm = b.alert <= 0;
    b.alert = ALERT_TIME;
    if (!wasCalm) return;
    // Spotted at ease: he's caught flat-footed, more so the nearer you are.
    b.startle = found.d < 14 ? STARTLE_NEAR : STARTLE_FAR;
    // He shouts, and the men near him come running.
    for (const o of this.list) {
      if (o === b || !o.t.active || o.alert > ALERT_TIME * 0.5) continue;
      if (Math.hypot(o.t.pos.x - t.pos.x, o.t.pos.z - t.pos.z) < CALL_RADIUS) {
        o.alert = ALERT_TIME * 0.8;
        o.startle = 0.6 + Math.random() * 0.4;
        o.last = found.at.clone();
      }
    }
  }
}
