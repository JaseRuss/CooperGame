import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createFigureMesh, JAM_MATERIAL } from '../entities/Soldier';
import { createJammedTag } from '../combat/JamCannon';
import { ARMY_TAN, plastic } from '../utils/plastic';
import type { GuardPost } from './Facility';
import type { NavGraph } from './NavGraph';
import { ENEMY_GROUPS, WALLS_ONLY } from './groups';

const RADIUS = 0.3;
const HALF_HEIGHT = 0.9 - RADIUS;
/** Rifle hits to put one down. */
const HP = 3;
/** How far a guard's vision cone reaches (a tower's reaches further), and how wide it is (half angle, radians). */
const SIGHT = 17;
const TOWER_SIGHT = 26;
const HALF_FOV = 0.62;
/** Anyone this close is noticed whichever way the guard's facing: he hears the footsteps. */
const NEAR_SENSE = 2.2;
/** Creeping along shortens the cone's reach to this fraction of it (the bright inner part of the drawn cone). */
export const SNEAK_REACH = 0.55;
/** How far an alarmed guard can pick out someone (no cone: he's on to them), and how often he looks. */
const ALARM_SIGHT = 30;
const SCAN_EVERY = 0.12;
const TARGET_EVERY = 0.35;
/** Seconds between his shots (plus up to FIRE_JITTER), and how far off he aims (radians). */
const FIRE_EVERY = 1.25;
const FIRE_JITTER = 0.7;
const SPREAD = 0.05;
/** Seconds stuck in jam before he slips over. */
const JAM_TIME = 3.5;
const WALK = 2.2;
const SEARCH_WALK = 3.4;
const HUNT_WALK = 4.4;
const TURN = 5;
const EYE = 1.5;
/** An alarm brings the guards this close running, and a noise (a shot) is heard this far off. */
const ALERT_RADIUS = 32;
/** Seconds an alarmed guard stays on to him after he's lost sight, and a searching one looks round at the last place. */
const ALARM_TIME = 12;
const SEARCH_TIME = 7;
/** How fast suspicion drains with nothing in view. */
const CALM_DOWN = 0.28;
/** Above this a guard stops and stares his way. */
const SUSPICIOUS = 0.3;
/** Closer than this to the place he's searching, he's there. */
const ARRIVED = 1.2;
/** The rifle's muzzle, in the figure's own space (it faces -Z). */
const MUZZLE = new THREE.Vector3(0.12, 1.49, -0.95);
const TIP_SPEED = 6;
const UP = new THREE.Vector3(0, 1, 0);
/** Within this of the ground counts as on it (walking his beat leaves a guard a hair below or above). */
const ON_GROUND = 0.05;
const aim0 = new THREE.Vector3();

export type GuardState = 'active' | 'jammed' | 'down' | 'carried' | 'jailed';
/** What an active guard's up to: on his beat, staring at something, off to look for someone, or on to them. */
export type Awareness = 'calm' | 'searching' | 'alarmed';

/** A rifle shot: from `from` along `dir`. The game works out what it hits. */
export interface Shot {
  from: THREE.Vector3;
  dir: THREE.Vector3;
  /** Set for a glob of jam (the prisoners' only weapon): where it's lobbed to. */
  at?: THREE.Vector3;
}

/** Things the game wants to react to (a sting, a banner). */
export interface GuardEvent {
  kind: 'alarm' | 'searching';
  at: THREE.Vector3;
}

/** What the guards need to know about the world each frame. */
export interface GuardWorld {
  /** Where the player's feet are, or null when he can't be seen (down, mid-climb). */
  player: THREE.Vector3 | null;
  sneaking: boolean;
  /** Each visible player is checked independently for suspicion and stealth. */
  players?: { position: THREE.Vector3; sneaking: boolean }[];
  /** Who an alarmed guard can shoot at: the player and the squad. */
  targets: THREE.Vector3[];
  /** A clear line between two points (walls and bars, not people). */
  sees(from: THREE.Vector3, to: THREE.Vector3): boolean;
  /** The compound's waypoints, for walking round doors and corners (null out in the open). */
  nav: NavGraph | null;
  /** Which part of the level is live: the other's guards stand frozen and unseen. */
  sector: 'compound' | 'shore';
}

export const sectorOf = (post: GuardPost): 'compound' | 'shore' => (post.zone === 'shore' ? 'shore' : 'compound');

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class Guard {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly collider: RAPIER.Collider;
  state: GuardState = 'active';
  alert: Awareness = 'calm';
  /** How close he is to being sure of the player (0 to 1). */
  suspicion = 0;
  /** Where he last saw (or heard) something, if anywhere. */
  lastKnown: THREE.Vector3 | null = null;
  /** Seconds left being on to the player (alarmed) or looking round a spot (searching, once there). */
  alertLeft = 0;
  /** The way to walk (waypoints), when he's off somewhere. */
  route: THREE.Vector2[] = [];
  /** Heading back to his post or beat after a search. */
  returning = false;
  /** Sees the player this very moment (inside the cone and in the clear). */
  seeing = false;
  /** How fast suspicion climbs while he can see the player (set when he spots him). */
  suspicionRate = 0;
  readonly sight: number;
  readonly halfFov = HALF_FOV;
  yaw: number;
  hp = HP;
  /** A carrier is on his way to (or carrying) him. */
  claimed = false;
  jamLeft = 0;
  tip = 0;
  fallYaw = 0;
  readonly stand: THREE.Mesh;
  readonly kneel: THREE.Mesh;
  readonly stuckTag: THREE.Sprite;
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.KinematicCharacterController;
  leg = 1;
  fireTimer = FIRE_EVERY * Math.random();
  scanTimer = SCAN_EVERY * Math.random();
  targetTimer = TARGET_EVERY * Math.random();
  target: THREE.Vector3 | null = null;
  /** Up a tower (or otherwise rooted): stands his ground. */
  readonly fixed: boolean;
  /** For the sweeping look of a guard standing at his post. */
  readonly sweepPhase = Math.random() * Math.PI * 2;
  /** Progress check while walking: where he was, and for how long he's gone nowhere. */
  readonly stuckFrom = new THREE.Vector2();
  stuckFor = 0;
  stuckClock = 0;

  constructor(world: RAPIER.World, readonly post: GuardPost) {
    this.yaw = post.yaw;
    this.fixed = post.height !== undefined;
    this.sight = post.sight ?? (this.fixed ? TOWER_SIGHT : SIGHT);
    this.stand = createFigureMesh(0, ARMY_TAN);
    this.kneel = createFigureMesh(1, ARMY_TAN);
    this.kneel.visible = false;
    this.stuckTag = createJammedTag(1.8, 'STUCK!');
    this.stuckTag.position.y = 2.4;
    this.stuckTag.visible = false;
    this.root.add(this.stand, this.kneel, this.stuckTag);
    const up = post.height ?? 0;
    this.pos.set(post.x, up, post.z);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(post.x, up + 0.9, post.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(ENEMY_GROUPS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.enableSnapToGround(0.3);
  }

  /** Can still fight (standing, not stuck in jam). */
  get isActive(): boolean {
    return this.state === 'active';
  }

  /** Which way he's looking, along the ground. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Where to aim at him. */
  chest(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + 1.2);
  }

  /** Over and out: he falls away from `dir` and can be picked up. */
  knockDown(dir: THREE.Vector3): void {
    this.state = 'down';
    this.fallYaw = Math.atan2(-dir.x, -dir.z);
    this.collider.setEnabled(false);
    this.stuckTag.visible = false;
    this.target = null;
    this.seeing = false;
    // Up a tower: he tumbles off, landing a couple of metres out from it the way he was knocked.
    if (this.pos.y > ON_GROUND) {
      this.dropVelocity.set(dir.x, 0, dir.z).normalize().multiplyScalar(2).setY(2);
    }
  }

  /** Down on the ground (not still falling off a tower), so he can be picked up. */
  get landed(): boolean {
    return this.state === 'down' && this.pos.y <= ON_GROUND;
  }

  /** Draws him: standing, wobbling in jam, tipped over, carried, or sat in a cell. */
  readonly dropVelocity = new THREE.Vector3();

  pose(dt: number): void {
    if (this.state === 'down' && this.pos.y > ON_GROUND) {
      this.dropVelocity.y -= 20 * dt;
      this.pos.addScaledVector(this.dropVelocity, dt);
      if (this.pos.y <= 0) this.pos.y = 0;
    }
    if (this.state === 'carried' || this.state === 'jailed') return;
    const tipping = this.state === 'down';
    this.tip = tipping ? Math.min(1, this.tip + dt * TIP_SPEED) : 0;
    this.root.position.copy(this.pos);
    this.stand.rotation.set(0, 0, 0);
    if (tipping) {
      // Flat on his back, away from whatever got him (a little bounce at the end).
      this.stand.rotateY(this.fallYaw);
      this.stand.rotateX(-(Math.PI / 2) * Math.min(1, this.tip * 1.08));
      this.stand.rotateY(this.yaw - this.fallYaw);
    } else {
      this.stand.rotation.y = this.yaw;
      if (this.state === 'jammed') this.stand.rotation.z = Math.sin(this.jamLeft * 9) * 0.08;
    }
  }
}

/**
 * The tan guards. Each has a vision cone (drawn on the ground, see VisionCones): stand in it with
 * a clear line to him and he gets more and more suspicious, faster the closer you are, and when
 * he's sure he raises the alarm. Then he and the guards near him are on to you: shooting if they
 * can see you, otherwise going to the last place you were seen, then searching it before they give
 * up and go back to their beats. Noises (a rifle shot) bring guards to look too. Creeping along
 * halves how far the cones reach.
 *
 * Three rifle hits put a guard down, or a splat from the jam riot cannon sticks him fast until he
 * slips over. A downed guard lies there until one of the squad carries him off to a cell (see
 * Followers).
 */
export class Guards {
  readonly group = new THREE.Group();
  readonly list: Guard[];
  private readonly byCollider = new Map<number, Guard>();
  private events: GuardEvent[] = [];
  private time = 0;

  constructor(world: RAPIER.World, posts: GuardPost[]) {
    this.list = posts.map((post) => {
      const g = new Guard(world, post);
      this.group.add(g.root);
      this.byCollider.set(g.collider.handle, g);
      g.pose(0);
      return g;
    });
  }

  get total(): number {
    return this.list.length;
  }

  /** Still in the fight, stuck or not. */
  get standing(): number {
    return this.list.filter((g) => g.state === 'active' || g.state === 'jammed').length;
  }

  get jailed(): number {
    return this.list.filter((g) => g.state === 'jailed').length;
  }

  /** Who the squad can shoot at (the live part of the level only). */
  get active(): Guard[] {
    return this.list.filter((g) => g.isActive && g.root.visible);
  }

  /** Downed guards nobody's come for yet. */
  get uncollected(): Guard[] {
    return this.list.filter((g) => g.landed && !g.claimed);
  }

  /** How many are on to the player right now. */
  get alarmed(): number {
    return this.list.filter((g) => g.state === 'active' && g.root.visible && g.alert === 'alarmed').length;
  }

  /** How sure the most suspicious guard is (0 to 1; 1 once any guard's raised the alarm). */
  get suspicion(): number {
    let worst = 0;
    for (const g of this.list) {
      if (g.state !== 'active' || !g.root.visible) continue;
      worst = Math.max(worst, g.alert === 'alarmed' ? 1 : g.suspicion);
    }
    return worst;
  }

  /** Some guard has a bead on the player this second. */
  get anySeeing(): boolean {
    return this.list.some((g) => g.state === 'active' && g.root.visible && g.seeing);
  }

  /** Shows one part of the level's guards and hides the other's. */
  setSector(sector: 'compound' | 'shore'): void {
    for (const g of this.list) g.root.visible = sectorOf(g.post) === sector;
  }

  /** Events since the last call (alarms raised, searches begun). */
  takeEvents(): GuardEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** A shot along `dir` hit `collider`: if it was a guard still on his feet, he's hit. Returns him, or null. */
  hit(collider: RAPIER.Collider, dir: THREE.Vector3): Guard | null {
    const g = this.byCollider.get(collider.handle);
    if (!g || (g.state !== 'active' && g.state !== 'jammed')) return null;
    g.hp--;
    if (g.hp <= 0) g.knockDown(dir);
    else g.yaw = Math.atan2(dir.x, dir.z); // he turns to face whoever shot him
    return g;
  }

  /** Jam landed at `point`: guards within `radius` are stuck fast. Returns how many. */
  jamAt(point: THREE.Vector3, radius: number): number {
    let stuck = 0;
    for (const g of this.list) {
      if (g.state !== 'active' || Math.hypot(g.pos.x - point.x, g.pos.z - point.z) > radius || Math.abs(point.y - g.pos.y) > 2.6) continue;
      g.state = 'jammed';
      g.jamLeft = JAM_TIME;
      g.stand.material = JAM_MATERIAL;
      g.stuckTag.visible = true;
      g.target = null;
      g.seeing = false;
      stuck++;
    }
    return stuck;
  }

  /** Picked up by one of the squad. */
  pickUp(g: Guard): void {
    g.state = 'carried';
    g.stand.material = plastic(ARMY_TAN);
  }

  /** Being carried: held flat over the carrier's head, lengthways so he fits through a cell door. */
  carry(g: Guard, at: THREE.Vector3, yaw: number): void {
    g.pos.copy(at);
    g.root.position.set(at.x, at.y + 2, at.z);
    g.stand.rotation.set(0, 0, 0);
    g.stand.rotateY(yaw);
    g.stand.rotateX(-Math.PI / 2);
    // Centred over the carrier's head: his middle (0.9 m up from his feet) over the root.
    g.stand.position.set(0, -0.9, 0).applyQuaternion(g.stand.quaternion);
  }

  /** Put down where he was (the carrier was knocked over): he can be collected again. */
  drop(g: Guard): void {
    g.state = 'down';
    g.claimed = false;
    g.stand.position.set(0, 0, 0);
    g.tip = 1;
  }

  /** Locked up: sat in a cell at `spot`, facing the bars. */
  jail(g: Guard, spot: THREE.Vector2): void {
    g.state = 'jailed';
    g.pos.set(spot.x, 0, spot.y);
    g.root.position.copy(g.pos);
    g.stand.position.set(0, 0, 0);
    g.stand.visible = false;
    g.kneel.visible = true;
    g.kneel.rotation.y = 0;
  }

  /** The player's been sent back to a checkpoint: everyone in that part of the level stands down and goes back to his beat. */
  standDown(sector: 'compound' | 'shore'): void {
    for (const g of this.list) {
      if (g.state !== 'active' || sectorOf(g.post) !== sector) continue;
      g.alert = 'calm';
      g.suspicion = 0;
      g.seeing = false;
      g.target = null;
      g.route = [];
      g.stuckFor = 0;
      g.returning = !g.fixed;
    }
  }

  /** Something loud (a rifle shot, a gate banging open) at `at`: guards within `radius` come to look. */
  hear(at: THREE.Vector3, radius: number, sector: 'compound' | 'shore'): void {
    for (const g of this.list) {
      if (g.state !== 'active' || sectorOf(g.post) !== sector || g.alert === 'alarmed') continue;
      if (Math.hypot(g.pos.x - at.x, g.pos.z - at.z) > radius) continue;
      this.search(g, at, SEARCH_TIME + 2);
    }
  }

  /** Somebody shot (or jammed) this guard: he's on to the player, wherever he is. */
  provoke(g: Guard, at: THREE.Vector3): void {
    if (g.state !== 'active') return;
    g.lastKnown = at.clone();
    this.raise(g, at);
  }

  private search(g: Guard, at: THREE.Vector3, time: number): void {
    if (g.fixed) {
      // Up a tower he can only turn to look.
      g.lastKnown = at.clone();
      g.alert = 'searching';
      g.alertLeft = time;
      return;
    }
    if (g.alert === 'calm') this.events.push({ kind: 'searching', at: at.clone() });
    g.alert = 'searching';
    g.lastKnown = at.clone();
    g.alertLeft = time;
    g.route = [];
    g.returning = false;
    g.stuckFor = 0;
  }

  /** He's sure: the alarm goes up, and everyone near him comes running. */
  private raise(g: Guard, at: THREE.Vector3): void {
    const first = g.alert !== 'alarmed';
    g.alert = 'alarmed';
    g.alertLeft = ALARM_TIME;
    g.suspicion = 1;
    g.returning = false;
    if (!first) return;
    this.events.push({ kind: 'alarm', at: at.clone() });
    const sector = sectorOf(g.post);
    for (const o of this.list) {
      if (o === g || o.state !== 'active' || sectorOf(o.post) !== sector || o.alert === 'alarmed') continue;
      if (Math.hypot(o.pos.x - g.pos.x, o.pos.z - g.pos.z) > ALERT_RADIUS) continue;
      o.lastKnown = at.clone();
      o.suspicion = Math.max(o.suspicion, 0.6);
      this.search(o, at, SEARCH_TIME + 4);
    }
  }

  /**
   * Moves, looks and shoots for one frame. Returns the shots fired.
   */
  update(dt: number, w: GuardWorld): Shot[] {
    this.time += dt;
    const shots: Shot[] = [];
    const eye = new THREE.Vector3();
    const aim = new THREE.Vector3();
    for (const g of this.list) {
      if (sectorOf(g.post) !== w.sector) continue;
      if (g.state === 'jammed') {
        g.jamLeft -= dt;
        if (g.jamLeft <= 0) {
          // Slips over backwards in the jam.
          g.stand.material = plastic(ARMY_TAN);
          g.knockDown(new THREE.Vector3(-Math.sin(g.yaw), 0, -Math.cos(g.yaw)).negate());
        }
      } else if (g.state === 'active') {
        g.stand.position.y = 0; // (walking his beat hops him)
        this.perceive(g, dt, w, eye);
        if (g.alert === 'alarmed') this.fight(g, dt, w, eye, aim, shots);
        else if (g.alert === 'searching') this.searchAround(g, dt, w);
        else this.calm(g, dt, w);
      }
      g.pose(dt);
    }
    return shots;
  }

  /** Looks for the player in his cone: suspicion climbs while he's in it, drains when he isn't. */
  private perceive(g: Guard, dt: number, w: GuardWorld, eye: THREE.Vector3): void {
    g.scanTimer -= dt;
    if (g.scanTimer <= 0) {
      g.scanTimer = SCAN_EVERY;
      g.seeing = false;
      const players = w.players ?? (w.player ? [{ position: w.player, sneaking: w.sneaking }] : []);
      let highestRate = 0;
      for (const player of players) {
        const p = player.position;
        const dx = p.x - g.pos.x;
        const dz = p.z - g.pos.z;
        const d = Math.hypot(dx, dz);
        const reach = g.sight * (player.sneaking ? SNEAK_REACH : 1);
        const inCone = d < NEAR_SENSE || Math.abs(wrapAngle(Math.atan2(-dx, -dz) - g.yaw)) < g.halfFov;
        // Alarmed, he's looking straight at where you are: no cone, a bit further.
        const inReach = g.alert === 'alarmed' ? d < ALARM_SIGHT : d < reach && inCone;
        if (!inReach || Math.abs(p.y - g.pos.y) >= 6) continue;
        eye.copy(g.pos).setY(g.pos.y + EYE);
        if (!w.sees(eye, aim0.copy(p).setY(p.y + 1.2))) continue;
        g.seeing = true;
        const rate = (0.5 + 1.5 * (1 - Math.min(1, d / reach))) * (player.sneaking ? 0.75 : 1);
        if (rate >= highestRate) {
          highestRate = rate;
          g.lastKnown = (g.lastKnown ?? new THREE.Vector3()).copy(p);
          g.suspicionRate = rate;
        }
      }
    }
    if (g.seeing) {
      g.suspicion = Math.min(1, g.suspicion + g.suspicionRate * dt);
      if (g.alert === 'alarmed') g.alertLeft = ALARM_TIME;
      else if (g.suspicion >= 1) this.raise(g, g.lastKnown ?? g.pos);
    } else if (g.alert !== 'alarmed') {
      g.suspicion = Math.max(0, g.suspicion - CALM_DOWN * dt);
    }
  }

  /** On his beat or at his post: walks it, or stands and looks slowly round. Stops to stare when he's suspicious. */
  private calm(g: Guard, dt: number, w: GuardWorld): void {
    if (g.suspicion > SUSPICIOUS && g.lastKnown) {
      this.faceToward(g, g.lastKnown.x, g.lastKnown.z, dt, TURN * 0.7);
      return;
    }
    if (g.returning) {
      const home = g.post.patrol ? g.post.patrol[g.leg] : g.post;
      if (!g.route.length) g.route = this.routeTo(g, home.x, home.z, w);
      if (!this.followRoute(g, dt, WALK + 0.6)) g.returning = false;
      else return;
    }
    if (g.post.patrol) {
      this.walkBeat(g, dt);
    } else if (!g.fixed || g.post.sweep !== false) {
      // Standing at his post, he slowly looks from side to side.
      const want = g.post.yaw + Math.sin(this.time * 0.45 + g.sweepPhase) * (g.fixed ? 1.1 : 0.8);
      g.yaw += wrapAngle(want - g.yaw) * Math.min(1, 2.5 * dt);
    }
  }

  /** Off to the last place he saw or heard something, then looking round it, then back to his beat. */
  private searchAround(g: Guard, dt: number, w: GuardWorld): void {
    const at = g.lastKnown;
    if (!at) {
      g.alert = 'calm';
      g.returning = true;
      return;
    }
    const far = Math.hypot(at.x - g.pos.x, at.z - g.pos.z) > ARRIVED;
    if (far && !g.fixed && g.stuckFor < 1.6) {
      if (!g.route.length) g.route = this.routeTo(g, at.x, at.z, w);
      this.followRoute(g, dt, SEARCH_WALK);
      this.checkStuck(g, dt);
      return;
    }
    // There (or can't get closer): looks all round, then gives up.
    g.alertLeft -= dt;
    g.yaw += wrapAngle(Math.atan2(-(at.x - g.pos.x), -(at.z - g.pos.z)) + Math.sin(this.time * 1.1 + g.sweepPhase) * 1.4 - g.yaw) * Math.min(1, 3 * dt);
    if (g.alertLeft <= 0) {
      g.alert = 'calm';
      g.suspicion = 0;
      g.returning = !g.fixed;
      g.route = [];
      g.stuckFor = 0;
    }
  }

  /** He's on to the player: shoots whoever he can see, and closes in or hunts the last place he saw them. */
  private fight(g: Guard, dt: number, w: GuardWorld, eye: THREE.Vector3, aim: THREE.Vector3, shots: Shot[]): void {
    g.targetTimer -= dt;
    if (g.targetTimer <= 0) {
      g.targetTimer = TARGET_EVERY;
      eye.copy(g.pos).setY(g.pos.y + EYE);
      let best: THREE.Vector3 | null = null;
      let bestD = ALARM_SIGHT;
      for (const t of w.targets) {
        const d = Math.hypot(t.x - g.pos.x, t.z - g.pos.z);
        if (d < bestD && w.sees(eye, aim.copy(t).setY(t.y + 1.2))) {
          bestD = d;
          best = t;
        }
      }
      g.target = best;
      if (best) {
        g.alertLeft = ALARM_TIME;
        g.lastKnown = (g.lastKnown ?? new THREE.Vector3()).copy(best);
      }
    }
    const t = g.target;
    if (t) {
      // Turn to face him and fire, closing in to a good range.
      const dx = t.x - g.pos.x;
      const dz = t.z - g.pos.z;
      const want = Math.atan2(-dx, -dz);
      const diff = wrapAngle(want - g.yaw);
      g.yaw += Math.sign(diff) * Math.min(Math.abs(diff), TURN * dt);
      if (!g.fixed && Math.hypot(dx, dz) > 11) this.stepToward(g, t.x, t.z, HUNT_WALK, dt, false);
      g.fireTimer -= dt;
      if (g.fireTimer <= 0 && Math.abs(diff) < 0.3) {
        g.fireTimer = FIRE_EVERY + Math.random() * FIRE_JITTER;
        const from = MUZZLE.clone().applyAxisAngle(UP, g.yaw).add(g.pos);
        const dir = aim.copy(t).setY(t.y + 1.1).sub(from).normalize();
        dir.x += (Math.random() - 0.5) * 2 * SPREAD;
        dir.y += (Math.random() - 0.5) * 2 * SPREAD;
        dir.z += (Math.random() - 0.5) * 2 * SPREAD;
        shots.push({ from, dir: dir.clone().normalize() });
      }
      return;
    }
    // Lost sight: runs to where he was last seen, and if that fails (or the alarm dies down) goes looking.
    g.alertLeft -= dt;
    const at = g.lastKnown;
    if (at && !g.fixed && g.alertLeft > 0 && Math.hypot(at.x - g.pos.x, at.z - g.pos.z) > ARRIVED && g.stuckFor < 1.6) {
      if (!g.route.length) g.route = this.routeTo(g, at.x, at.z, w);
      this.followRoute(g, dt, HUNT_WALK);
      this.checkStuck(g, dt);
    } else if (at && g.alertLeft > 0) {
      g.yaw += wrapAngle(Math.atan2(-(at.x - g.pos.x), -(at.z - g.pos.z)) + Math.sin(this.time * 1.3 + g.sweepPhase) * 1.2 - g.yaw) * Math.min(1, 3 * dt);
    }
    if (g.alertLeft <= 0) {
      g.alert = 'searching';
      g.alertLeft = SEARCH_TIME;
      g.route = [];
      g.stuckFor = 0;
    }
  }

  private routeTo(g: Guard, x: number, z: number, w: GuardWorld): THREE.Vector2[] {
    return w.nav?.path({ x: g.pos.x, z: g.pos.z }, { x, z }) ?? [new THREE.Vector2(x, z)];
  }

  /** Walks the next waypoint of his route. Returns false once it's done. */
  private followRoute(g: Guard, dt: number, speed: number): boolean {
    const next = g.route[0];
    if (!next) return false;
    if (Math.hypot(next.x - g.pos.x, next.y - g.pos.z) < 0.6) {
      g.route.shift();
      return g.route.length > 0;
    }
    this.stepToward(g, next.x, next.y, speed, dt, true);
    return true;
  }

  /** Gives up on a walk that's going nowhere (a tree or a crate in the way). */
  private checkStuck(g: Guard, dt: number): void {
    g.stuckClock += dt;
    if (g.stuckClock < 0.6) return;
    g.stuckClock = 0;
    if (Math.hypot(g.pos.x - g.stuckFrom.x, g.pos.z - g.stuckFrom.y) < 0.25) g.stuckFor += 0.6;
    else g.stuckFor = 0;
    g.stuckFrom.set(g.pos.x, g.pos.z);
  }

  private faceToward(g: Guard, x: number, z: number, dt: number, rate: number): void {
    const diff = wrapAngle(Math.atan2(-(x - g.pos.x), -(z - g.pos.z)) - g.yaw);
    g.yaw += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
  }

  /** Up and down his beat. */
  private walkBeat(g: Guard, dt: number): void {
    const beat = g.post.patrol as { x: number; z: number }[];
    const to = beat[g.leg];
    const d = Math.hypot(to.x - g.pos.x, to.z - g.pos.z);
    if (d < 0.4) {
      g.leg = (g.leg + 1) % beat.length;
      return;
    }
    this.stepToward(g, to.x, to.z, WALK, dt, true);
  }

  /** One step toward (x, z), sliding along walls, facing the way he goes (or not, when he's got his eyes on something). */
  private stepToward(g: Guard, x: number, z: number, speed: number, dt: number, face: boolean): void {
    const dx = x - g.pos.x;
    const dz = z - g.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    g.controller.computeColliderMovement(g.collider, { x: (dx / d) * speed * dt, y: -dt, z: (dz / d) * speed * dt }, undefined, WALLS_ONLY);
    const m = g.controller.computedMovement();
    const t = g.body.translation();
    g.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    g.pos.set(t.x + m.x, t.y + m.y - 0.9, t.z + m.z);
    if (face) {
      const want = Math.atan2(-dx, -dz);
      g.yaw += wrapAngle(want - g.yaw) * Math.min(1, 8 * dt);
    }
    // A little hop as he goes, like every toy soldier.
    g.stand.position.y = Math.abs(Math.sin(this.time * 8.5 + g.sweepPhase)) * 0.15;
  }
}
