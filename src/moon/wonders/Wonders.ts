import * as THREE from 'three';
import { mulberry32 } from '../../utils/rng';
import type { SoundName } from '../../audio/Sound';
import type { MoonTerrain } from '../MoonTerrain';
import { MOON_G, type Buggy } from '../Buggy';
import type { WonderAnim, WonderCtx, WonderDef, WonderTools } from './types';

/** What the Weird Side asks of the game round it. */
export interface WonderFx {
  say(text: string, color: string): void;
  sound(name: SoundName, at: THREE.Vector3, volume: number, rate: number): void;
  dust(at: THREE.Vector3, count: number, speed: number): void;
  confetti(at: THREE.Vector3): void;
  boom(at: THREE.Vector3, size: number): void;
  splash(at: THREE.Vector3, size: number): void;
  /** A tableau has just been found (`count` of `total` so far). */
  found(def: WonderDef, count: number, total: number): void;
}

interface Entry {
  def: WonderDef;
  group: THREE.Group;
  anim: WonderAnim | null;
  found: boolean;
  /** Handed to its animation each frame (made once; its numbers are refreshed). */
  ctx: WonderCtx | null;
}

interface Bouncer {
  x: number;
  z: number;
  r: number;
  boost: number;
}

interface Booster {
  x: number;
  z: number;
  yaw: number;
  len: number;
  halfW: number;
  speed: number;
}

interface Cannon {
  x: number;
  z: number;
  r: number;
  muzzle: THREE.Vector3;
  dir: THREE.Vector3;
  yaw: number;
  pitch: number;
  speed: number;
}

interface Door {
  pair: string;
  x: number;
  z: number;
  yaw: number;
  halfW: number;
}

/** The buggy's chassis rides this far above the ground (as in Buggy). */
const RIDE = 0.62;
/** Tableaux further off than this aren't animated. */
const ANIMATE_RANGE = 360;
/** Tableaux further from the camera than this aren't drawn (the landmarks marked `always` are). */
const VIEW_RANGE = 480;

/** The launch speed that carries something fired at `pitch` from `height` above the landing ground `range` metres. */
function launchSpeed(pitch: number, height: number, range: number): number {
  const reach = (v: number) => {
    const vy = v * Math.sin(pitch);
    return (v * Math.cos(pitch) * (vy + Math.sqrt(vy * vy + 2 * MOON_G * Math.max(0, height)))) / MOON_G;
  };
  let lo = 1;
  let hi = 120;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < range) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The Weird Side: every tableau, built at its spot in the valley (hidden until the road over the
 * mountains is built), animated while the buggy's about, found one by one as the buggy comes
 * near, and the gadgets some of them have: bouncy pads, zoom arrows, a cannon and a pair of doors.
 */
export class WonderValley {
  readonly root = new THREE.Group();
  readonly entries: Entry[] = [];
  private readonly bouncers: Bouncer[] = [];
  private readonly boosters: Booster[] = [];
  private readonly cannons: Cannon[] = [];
  private readonly doors: Door[] = [];
  private time = 0;
  private bounceCool = 0;
  private doorCool = 0;
  private cannonCool = 0;
  /** The cannon the buggy is sitting in, and how long until it goes off. */
  private loaded: { cannon: Cannon; fuse: number } | null = null;
  /** Finding things only starts once the road's open. */
  open = false;
  private readonly inv = new THREE.Quaternion();

  constructor(scene: THREE.Scene, private readonly terrain: MoonTerrain, defs: WonderDef[]) {
    this.root.visible = false;
    scene.add(this.root);
    defs.forEach((def, i) => {
      const group = new THREE.Group();
      const yaw = def.yaw ?? 0;
      const base = terrain.heightAt(def.x, def.z);
      group.position.set(def.x, base, def.z);
      group.rotation.y = yaw;
      this.root.add(group);
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const wx = (x: number, z: number) => def.x + x * c + z * s;
      const wz = (x: number, z: number) => def.z - x * s + z * c;
      const tools: WonderTools = {
        solid: (x, z, r, h) => terrain.solids.add({ x: wx(x, z), z: wz(x, z), r, h }),
        bouncer: (x, z, r, boost) => this.bouncers.push({ x: wx(x, z), z: wz(x, z), r, boost }),
        ramp: (x, z, ryaw, len, halfW, rise) => terrain.ramps.push({ x: wx(x, z), z: wz(x, z), yaw: yaw + ryaw, len, halfW, rise }),
        boost: (x, z, byaw, len, halfW, speed) => this.boosters.push({ x: wx(x, z), z: wz(x, z), yaw: yaw + byaw, len, halfW, speed }),
        cannon: (x, z, r, muzzle, cyaw, pitch, range) => {
          const m = new THREE.Vector3(wx(muzzle.x, muzzle.z), base + muzzle.y, wz(muzzle.x, muzzle.z));
          const wyaw = yaw + cyaw;
          const land = terrain.heightAt(m.x + Math.sin(wyaw) * range, m.z + Math.cos(wyaw) * range);
          const speed = launchSpeed(pitch, m.y - land - RIDE, range);
          const dir = new THREE.Vector3(Math.sin(wyaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(wyaw) * Math.cos(pitch));
          this.cannons.push({ x: wx(x, z), z: wz(x, z), r, muzzle: m, dir, yaw: wyaw, pitch, speed });
        },
        door: (pair, x, z, dyaw, halfW) => this.doors.push({ pair, x: wx(x, z), z: wz(x, z), yaw: yaw + dyaw, halfW }),
        groundAt: (x, z) => terrain.heightAt(wx(x, z), wz(x, z)) - base,
        rng: mulberry32(9100 + i * 37),
      };
      const anim = def.build(group, tools) ?? null;
      this.entries.push({ def, group, anim, found: false, ctx: null });
    });
  }

  get total(): number {
    return this.entries.length;
  }

  get foundCount(): number {
    return this.entries.reduce((n, e) => n + (e.found ? 1 : 0), 0);
  }

  /** The tableaux for the map: where each is, and whether it's been found. */
  mapPoints(): { x: number; z: number; found: boolean; secret: boolean; title: string }[] {
    return this.entries.map((e) => ({ x: e.group.position.x, z: e.group.position.z, found: e.found, secret: !!e.def.secret, title: e.def.title }));
  }

  /** The nearest tableau not found yet (and not a secret one), for the waypoint. */
  nearestUnfound(x: number, z: number): Entry | null {
    let best: Entry | null = null;
    let bestD = Infinity;
    for (const e of this.entries) {
      if (e.found || e.def.secret) continue;
      const d = Math.hypot(e.group.position.x - x, e.group.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Hides the tableaux too far from the camera to matter, so the far side of the valley costs nothing to draw. */
  cull(camera: THREE.Vector3): void {
    if (!this.root.visible) return;
    for (const e of this.entries) {
      const g = e.group;
      g.visible = !!e.def.always || Math.hypot(g.position.x - camera.x, g.position.z - camera.z) < VIEW_RANGE;
    }
  }

  /** True while the buggy is sitting in the cannon waiting to be fired (the game holds it still). */
  get inCannon(): boolean {
    return this.loaded !== null;
  }

  update(dt: number, buggy: Buggy, fx: WonderFx): void {
    this.time += dt;
    this.bounceCool = Math.max(0, this.bounceCool - dt);
    this.doorCool = Math.max(0, this.doorCool - dt);
    this.cannonCool = Math.max(0, this.cannonCool - dt);
    if (!this.root.visible) return;
    this.animate(dt, buggy, fx);
    if (!this.open) return;
    this.gadgets(dt, buggy, fx);
    for (const e of this.entries) {
      if (e.found) continue;
      const d = Math.hypot(e.group.position.x - buggy.pos.x, e.group.position.z - buggy.pos.z);
      if (d > (e.def.find ?? e.def.r + 24)) continue;
      e.found = true;
      fx.confetti(e.group.position.clone().setY(e.group.position.y + 8));
      fx.found(e.def, this.foundCount, this.total);
    }
  }

  private animate(dt: number, buggy: Buggy, fx: WonderFx): void {
    for (const e of this.entries) {
      if (!e.anim) continue;
      const g = e.group;
      const dist = Math.hypot(g.position.x - buggy.pos.x, g.position.z - buggy.pos.z);
      if (dist > ANIMATE_RANGE && !e.def.always) continue;
      const ctx = (e.ctx ??= this.makeCtx(g, fx));
      g.updateMatrixWorld();
      ctx.dt = dt;
      ctx.t = this.time;
      ctx.dist = dist;
      g.worldToLocal(ctx.buggy.copy(buggy.pos));
      this.inv.copy(g.quaternion).invert();
      ctx.buggyVel.copy(buggy.vel).applyQuaternion(this.inv);
      e.anim(ctx);
    }
  }

  private makeCtx(g: THREE.Group, fx: WonderFx): WonderCtx {
    const world = (at: THREE.Vector3) => g.localToWorld(at.clone());
    return {
      dt: 0,
      t: 0,
      dist: 0,
      buggy: new THREE.Vector3(),
      buggyVel: new THREE.Vector3(),
      say: (text, color = '#ffd24a') => fx.say(text, color),
      sound: (name, volume = 0.6, rate = 1) => fx.sound(name, g.position, volume, rate),
      dust: (at, count = 10, speed = 3) => fx.dust(world(at), count, speed),
      confetti: (at) => fx.confetti(world(at)),
      boom: (at, size = 1) => fx.boom(world(at), size),
      splash: (at, size = 1) => fx.splash(world(at), size),
    };
  }

  private gadgets(dt: number, b: Buggy, fx: WonderFx): void {
    const p = b.pos;
    const ground = this.terrain.heightAt(p.x, p.z);
    const low = p.y - ground < RIDE + 0.6;
    // Sitting in the cannon with the fuse fizzing.
    if (this.loaded) {
      const c = this.loaded.cannon;
      this.loaded.fuse -= dt;
      b.vel.set(0, 0, 0);
      p.set(c.x, this.terrain.heightAt(c.x, c.z) + RIDE, c.z);
      b.yaw = c.yaw;
      if (this.loaded.fuse > 0) {
        if (Math.random() < dt * 14) fx.dust(c.muzzle.clone().addScaledVector(c.dir, -6), 1, 1.2);
        return;
      }
      this.loaded = null;
      this.cannonCool = 3;
      p.copy(c.muzzle);
      b.vel.copy(c.dir).multiplyScalar(c.speed);
      b.pitch = c.pitch;
      b.grounded = false;
      fx.boom(c.muzzle.clone().addScaledVector(c.dir, 1.5), 1.4);
      fx.confetti(c.muzzle.clone().addScaledVector(c.dir, 3));
      fx.sound('cannon', c.muzzle, 1, 0.9);
      fx.say('KA-BOOM! WHEEEEE!', '#ff8a3a');
      return;
    }
    for (const c of this.cannons) {
      if (this.cannonCool > 0 || !low || Math.hypot(p.x - c.x, p.z - c.z) > c.r) continue;
      this.loaded = { cannon: c, fuse: 1.1 };
      fx.say('FUSE LIT… HOLD ON!', '#ffd24a');
      fx.sound('launch', c.muzzle, 0.5, 1.6);
      return;
    }
    // Bouncy pads.
    for (const s of this.bouncers) {
      if (this.bounceCool > 0 || !low || b.vel.y > 2 || Math.hypot(p.x - s.x, p.z - s.z) > s.r) continue;
      b.vel.y = s.boost;
      b.grounded = false;
      this.bounceCool = 0.6;
      fx.sound('jamShot', p, 0.9, 0.45);
      fx.say(['BOING!', 'BOINNNG!', 'BOING BOING!', 'SPROING!'][Math.floor(Math.random() * 4)], '#ff7ad1');
    }
    // Zoom arrows.
    if (b.grounded) {
      for (const z of this.boosters) {
        const s = Math.sin(z.yaw);
        const c = Math.cos(z.yaw);
        const dx = p.x - z.x;
        const dz = p.z - z.z;
        const u = dx * s + dz * c;
        if (u < 0 || u > z.len || Math.abs(dx * c - dz * s) > z.halfW) continue;
        const fwdX = Math.sin(b.yaw);
        const fwdZ = Math.cos(b.yaw);
        if (fwdX * s + fwdZ * c < 0.6) continue;
        const vf = b.forwardSpeed;
        if (vf < z.speed) {
          b.vel.x += fwdX * (z.speed - vf);
          b.vel.z += fwdZ * (z.speed - vf);
          if (vf < z.speed - 6) {
            fx.say('ZOOOOM!', '#7ae0ff');
            fx.sound('launch', p, 0.5, 1.3);
          }
        }
      }
    }
    // Doors that lead somewhere else.
    if (this.doorCool > 0) return;
    for (const d of this.doors) {
      const s = Math.sin(d.yaw);
      const c = Math.cos(d.yaw);
      const dx = p.x - d.x;
      const dz = p.z - d.z;
      if (Math.abs(dx * s + dz * c) > 1.4 || Math.abs(dx * c - dz * s) > d.halfW) continue;
      const other = this.doors.find((o) => o.pair === d.pair && o !== d);
      if (!other) continue;
      const through = Math.sign(b.vel.x * s + b.vel.z * c) || -1;
      const os = Math.sin(other.yaw);
      const oc = Math.cos(other.yaw);
      const exitX = other.x + os * through * 4;
      const exitZ = other.z + oc * through * 4;
      fx.dust(p.clone(), 14, 3);
      b.teleport(exitX, exitZ, b.yaw + (other.yaw - d.yaw), this.terrain);
      fx.dust(b.pos.clone(), 14, 3);
      fx.sound('poof', b.pos, 0.8, 1.2);
      fx.say('WHOOSH! …WHERE ARE WE?', '#c9a0ff');
      this.doorCool = 1.5;
      return;
    }
  }
}
