import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createFigureMesh, createCheeringFigure } from '../entities/Soldier';
import { nameTag, renameTag } from '../entities/AllyTank';
import { ARMY_GREEN } from '../utils/plastic';
import { FRIEND_GROUPS, WALLS_ONLY } from './groups';

/** Buddies are a lighter green than the other prisoners, like their tanks in the main game. */
const BUDDY_COLOR = 0x6a9a3c;
const RADIUS = 0.3;
const HALF_HEIGHT = 0.9 - RADIUS;
const GRAVITY = 24;
/** A breadcrumb is dropped every this many metres the player moves; the squad walks the trail. */
const SPACING = 0.6;
const TRAIL_MAX = 900;
/** The first follower keeps this far back along the trail, the rest this much further each. */
const FIRST_GAP = 2;
const GAP = 1.3;
const RUN = 6.3;
const CATCH_UP = 8;
/** How often each follower looks for a straight line to further along the trail. */
const SHORTCUT_EVERY = 0.25;
const CHEER_TIME = 1.3;
const PERSONAL_SPACE = 0.95;
/** In sight of the player (and this close), followers gather round him instead of walking the trail. */
const DIRECT_RANGE = 30;
/** The first to reach him stops this far off, the rest a bit further each, so they gather in a loose crowd. */
const CROWD_NEAR = 1.6;
const CROWD_SPREAD = 0.9;
/** Rejoining the trail only looks this many crumbs back (older bits may loop the long way round). */
const REJOIN_LOOKBACK = 200;
const REJOIN_REACH = 25;
/**
 * Every this many seconds, a follower who wanted to go somewhere but got less than STUCK_MOVE
 * metres has a strike: the first finds another way onto the trail, the third hops him onto it
 * (a last resort, for a crate corner he can't get round).
 */
const STUCK_WINDOW = 2;
const STUCK_MOVE = 1;
const STUCK_WARP = 3;
/** The line-of-sight rays run this far either side of his middle (inside his capsule, so they never start in a wall). */
const SIGHT_SIDE = 0.22;

export interface PrisonerSpot {
  x: number;
  z: number;
  /** Which cell he's locked in. */
  cell: number;
  kneel: boolean;
  /** Set for one of the four buddies: which (an index into the buddy names). */
  buddy: number | null;
  /** The way out of his cell once it's open: inside the door, then out in the corridor. */
  exits: THREE.Vector2[];
}

type State = 'caged' | 'leaving' | 'following' | 'holding';

class Prisoner {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly collider: RAPIER.Collider;
  state: State = 'caged';
  yaw = 0;
  cursor = 0;
  cheer = 0;
  exits: THREE.Vector2[];
  readonly tag: THREE.Sprite | null;
  readonly velocity = new THREE.Vector2();
  private readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.KinematicCharacterController;
  private readonly stand: THREE.Mesh;
  private readonly kneel: THREE.Mesh;
  private readonly cheering: THREE.Mesh;
  private fallSpeed = 0;
  private hopPhase = Math.random() * 10;
  shortcutTimer = Math.random() * SHORTCUT_EVERY;
  /** He can see the player, so he heads straight for him instead of walking the trail. */
  direct = false;
  /** Progress check: time into this window, where he was at its start, whether he wanted to go anywhere, strikes so far. */
  stuckClock = Math.random() * STUCK_WINDOW;
  readonly stuckFrom = new THREE.Vector2();
  stuckWanted = false;
  strikes = 0;

  constructor(world: RAPIER.World, readonly spot: PrisonerSpot, name: string | null) {
    const color = spot.buddy === null ? ARMY_GREEN : BUDDY_COLOR;
    this.stand = createFigureMesh(0, color);
    this.kneel = createFigureMesh(1, color);
    this.cheering = createCheeringFigure(color);
    this.root.add(this.stand, this.kneel, this.cheering);
    this.tag = name === null ? null : nameTag(name);
    if (this.tag) {
      this.tag.scale.set(2, 0.5, 1);
      this.tag.position.y = 2.45;
      this.root.add(this.tag);
    }
    this.exits = spot.exits.map((e) => e.clone());
    this.pos.set(spot.x, 0, spot.z);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spot.x, 0.9, spot.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(FRIEND_GROUPS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.pose(0);
  }

  /** Moves him by `vx, vz` m/s for `dt`, sliding along walls (and through his friends). */
  move(vx: number, vz: number, dt: number): void {
    this.fallSpeed = this.controller.computedGrounded() ? 0 : this.fallSpeed + GRAVITY * dt;
    this.controller.computeColliderMovement(this.collider, { x: vx * dt, y: -Math.max(this.fallSpeed, 1) * dt, z: vz * dt }, undefined, WALLS_ONLY);
    const m = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.pos.set(t.x + m.x, t.y + m.y - 0.9, t.z + m.z);
    if (dt > 0) this.velocity.set(m.x / dt, m.z / dt);
  }

  teleport(x: number, z: number): void {
    this.body.setTranslation({ x, y: 0.9, z }, true);
    this.body.setNextKinematicTranslation({ x, y: 0.9, z });
    this.pos.set(x, 0, z);
    this.velocity.set(0, 0);
    this.fallSpeed = 0;
  }

  /** Shows the right figure, hopping `hop` m off the ground. */
  pose(dt: number): void {
    const speed = this.velocity.length();
    let hop = 0;
    if (speed > 0.4) {
      this.hopPhase += dt * (6 + speed * 1.2);
      hop = Math.abs(Math.sin(this.hopPhase)) * 0.25;
    }
    const cheering = this.cheer > 0;
    this.stand.visible = !cheering && !(this.state === 'caged' && this.spot.kneel);
    this.kneel.visible = !cheering && this.state === 'caged' && this.spot.kneel;
    this.cheering.visible = cheering;
    // Cheering, he jumps up and down on the spot.
    if (cheering) hop = Math.abs(Math.sin(this.cheer * 9)) * 0.35;
    this.root.position.set(this.pos.x, this.pos.y + hop, this.pos.z);
    for (const f of [this.stand, this.kneel, this.cheering]) f.rotation.y = this.yaw;
  }
}

/**
 * The prisoners: locked in their cells until the player shoots the padlock, then they cheer,
 * file out of the cell and follow him. Rather than path-finding, the squad walks the trail of
 * breadcrumbs the player leaves, each a little further back, so they go wherever he went
 * (through doorways included). Each one keeps checking for a straight line further along the
 * trail and cuts the corner when there is one, so they don't retrace every wiggle, and once
 * he can see the player he leaves the trail and gathers round him with the others.
 */
export class Followers {
  readonly group = new THREE.Group();
  /** Out of their cells, in the order they joined (which sets their place in the line). */
  private readonly squad: Prisoner[] = [];
  private readonly all: Prisoner[] = [];
  private readonly trail: THREE.Vector2[] = [];
  private holding = false;
  private tagsOn = true;
  private readonly playerSpot = new THREE.Vector2();

  constructor(private readonly world: RAPIER.World, spots: PrisonerSpot[], names: string[]) {
    for (const spot of spots) {
      const p = new Prisoner(world, spot, spot.buddy === null ? null : names[spot.buddy]);
      // Facing the bars, waiting.
      p.yaw = 0;
      p.pose(0);
      this.all.push(p);
      this.group.add(p.root);
    }
  }

  /** How many are out of their cells. */
  get count(): number {
    return this.squad.length;
  }

  get isHolding(): boolean {
    return this.holding;
  }

  /** Buddies freed so far (indices into the buddy names). */
  get buddiesFreed(): number[] {
    return this.squad.flatMap((p) => (p.spot.buddy === null ? [] : [p.spot.buddy]));
  }

  /** Every buddy locked up here. */
  get buddiesHere(): number[] {
    return this.all.flatMap((p) => (p.spot.buddy === null ? [] : [p.spot.buddy]));
  }

  /** Who's in a cell. */
  inCell(cell: number): number {
    return this.all.filter((p) => p.spot.cell === cell).length;
  }

  setNameTags(visible: boolean, names: string[]): void {
    for (const p of this.all) {
      if (!p.tag || p.spot.buddy === null) continue;
      this.tagsOn = visible;
      p.tag.visible = visible;
      renameTag(p.tag, names[p.spot.buddy]);
    }
  }

  /** The cell's door is open: everyone inside cheers and heads out. Returns the buddies among them. */
  release(cell: number): number[] {
    const freed: number[] = [];
    for (const p of this.all) {
      if (p.spot.cell !== cell || p.state !== 'caged') continue;
      p.state = 'leaving';
      p.cheer = CHEER_TIME + Math.random() * 0.3;
      this.squad.push(p);
      if (p.spot.buddy !== null) freed.push(p.spot.buddy);
    }
    return freed;
  }

  /** X: hold here, or follow me again. Returns true when they're now holding. */
  toggleHold(): boolean {
    this.holding = !this.holding;
    for (const p of this.squad) {
      if (this.holding && p.state === 'following') p.state = 'holding';
      else if (!this.holding && p.state === 'holding') this.join(p);
    }
    return this.holding;
  }

  /** Back to the checkpoint: the squad comes too, bunched up round him, and the trail starts again. */
  gather(at: THREE.Vector3): void {
    this.trail.length = 0;
    this.trail.push(new THREE.Vector2(at.x, at.z));
    this.squad.forEach((p, i) => {
      if (p.state === 'caged') return;
      p.teleport(at.x + Math.sin(i * 2.4) * 0.4, at.z + Math.cos(i * 2.4) * 0.4);
      p.exits.length = 0;
      p.cursor = 0;
      if (p.state === 'leaving') p.state = this.holding ? 'holding' : 'following';
    });
  }

  update(dt: number, player: THREE.Vector3): void {
    this.dropCrumb(player);
    const last = this.trail.length - 1;
    // Places in the line along the trail only count those walking it: the ones who can see him
    // are already gathering round him, so the rest close up behind.
    const onTrail = this.squad.filter((p) => p.state === 'following' && !p.direct);
    for (const p of this.all) {
      const crowd = this.squad.indexOf(p);
      const place = Math.max(0, onTrail.indexOf(p));
      let goal: THREE.Vector2 | null = null;
      let arrive = 0.3;
      if (p.cheer > 0) {
        p.cheer = Math.max(0, p.cheer - dt);
      } else if (p.state === 'leaving') {
        if (p.exits.length && Math.hypot(p.exits[0].x - p.pos.x, p.exits[0].y - p.pos.z) < 0.5) p.exits.shift();
        if (p.exits.length) goal = p.exits[0];
        else if (this.holding) p.state = 'holding';
        else this.join(p);
      }
      if (p.state === 'following' && p.cheer === 0) {
        const slot = Math.max(0, last - Math.ceil((FIRST_GAP + place * GAP) / SPACING));
        p.shortcutTimer -= dt;
        if (p.shortcutTimer <= 0) {
          p.shortcutTimer = SHORTCUT_EVERY;
          const sees = Math.hypot(player.x - p.pos.x, player.z - p.pos.z) < DIRECT_RANGE && this.clear(p.pos, this.playerSpot.set(player.x, player.z));
          // Lost sight of him (he's gone round a corner): back onto the trail where it's in reach.
          if (p.direct && !sees) this.join(p);
          p.direct = sees;
          if (!sees && p.cursor !== slot) {
            if (this.clear(p.pos, this.trail[slot])) p.cursor = slot;
            else {
              const mid = Math.round((p.cursor + slot) / 2);
              if (mid !== p.cursor && this.clear(p.pos, this.trail[mid])) p.cursor = mid;
            }
          }
        }
        if (p.direct) {
          goal = this.playerSpot.set(player.x, player.z);
          arrive = CROWD_NEAR + Math.sqrt(crowd) * CROWD_SPREAD;
        } else {
          const crumb = this.trail[p.cursor];
          if (p.cursor !== slot && Math.hypot(crumb.x - p.pos.x, crumb.y - p.pos.z) < 0.7) p.cursor += Math.sign(slot - p.cursor);
          goal = this.trail[p.cursor];
          arrive = p.cursor === slot ? 0.45 : 0;
        }
      }
      this.steer(p, goal, arrive, player, dt);
      if (p.state === 'following') this.unstick(p, goal, arrive, last, place, dt);
      else p.stuckFrom.set(p.pos.x, p.pos.z);
    }
  }

  /** Stuck on a corner or a crate: try another way onto the trail, and in the end just hop onto it. */
  private unstick(p: Prisoner, goal: THREE.Vector2 | null, arrive: number, last: number, place: number, dt: number): void {
    p.stuckWanted ||= goal !== null && p.cheer === 0 && Math.hypot(goal.x - p.pos.x, goal.y - p.pos.z) > arrive + 1;
    p.stuckClock += dt;
    if (p.stuckClock < STUCK_WINDOW) return;
    const moved = Math.hypot(p.pos.x - p.stuckFrom.x, p.pos.z - p.stuckFrom.y);
    p.strikes = p.stuckWanted && moved < STUCK_MOVE ? p.strikes + 1 : 0;
    p.stuckClock = 0;
    p.stuckWanted = false;
    if (p.strikes >= STUCK_WARP) {
      const crumb = this.trail[Math.max(0, last - Math.ceil((FIRST_GAP + place * GAP) / SPACING))];
      p.teleport(crumb.x, crumb.y);
      this.join(p);
    } else if (p.strikes > 0) {
      this.join(p);
    }
    p.stuckFrom.set(p.pos.x, p.pos.z);
  }

  private dropCrumb(player: THREE.Vector3): void {
    const last = this.trail[this.trail.length - 1];
    if (last && Math.hypot(player.x - last.x, player.z - last.y) < SPACING) return;
    this.trail.push(new THREE.Vector2(player.x, player.z));
    if (this.trail.length > TRAIL_MAX) {
      const drop = this.trail.length - TRAIL_MAX;
      this.trail.splice(0, drop);
      for (const p of this.squad) p.cursor = Math.max(0, p.cursor - drop);
    }
  }

  /**
   * Puts him on the trail: at the newest crumb he can walk straight to, so he's as far along as
   * he can be (or the nearest recent one if he can't see any).
   */
  private join(p: Prisoner): void {
    p.state = 'following';
    p.direct = false;
    const oldest = Math.max(0, this.trail.length - REJOIN_LOOKBACK);
    let nearest = this.trail.length - 1;
    let nearestD = Infinity;
    let checks = 0;
    for (let i = this.trail.length - 1; i >= oldest; i--) {
      const d = Math.hypot(this.trail[i].x - p.pos.x, this.trail[i].y - p.pos.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = i;
      }
      if (d < REJOIN_REACH && checks < 60 && i % 2 === 0) {
        checks++;
        if (this.clear(p.pos, this.trail[i])) {
          p.cursor = i;
          return;
        }
      }
    }
    p.cursor = Math.max(0, nearest);
  }

  /** Can he walk straight from `a` to `b` (two rays, a shoulder-width apart, at knee height)? */
  private clear(a: THREE.Vector3, b: THREE.Vector2): boolean {
    const dx = b.x - a.x;
    const dz = b.y - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const dir = { x: dx / d, y: 0, z: dz / d };
    for (const side of [-SIGHT_SIDE, SIGHT_SIDE]) {
      const origin = { x: a.x - dir.z * side, y: a.y + 0.5, z: a.z + dir.x * side };
      if (this.world.castRay(new RAPIER.Ray(origin, dir), d, true, undefined, WALLS_ONLY)) return false;
    }
    return true;
  }

  /** Heads for `goal` (stopping within `arrive`), keeping out of everyone's way. */
  private steer(p: Prisoner, goal: THREE.Vector2 | null, arrive: number, player: THREE.Vector3, dt: number): void {
    let vx = 0;
    let vz = 0;
    if (goal && p.cheer === 0) {
      const dx = goal.x - p.pos.x;
      const dz = goal.y - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > arrive) {
        const speed = Math.min(d > 6 ? CATCH_UP : RUN, (d - arrive) * 4 + 1);
        vx = (dx / d) * speed;
        vz = (dz / d) * speed;
      }
    }
    if (p.state !== 'caged') {
      // Shuffle apart from the others and from the player.
      const push = (x: number, z: number, room: number) => {
        const dx = p.pos.x - x;
        const dz = p.pos.z - z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < room) {
          vx += (dx / d) * (room - d) * 4;
          vz += (dz / d) * (room - d) * 4;
        }
      };
      for (const o of this.squad) if (o !== p) push(o.pos.x, o.pos.z, PERSONAL_SPACE);
      push(player.x, player.z, PERSONAL_SPACE + 0.2);
      p.move(vx, vz, dt);
    }
    // A name tag right in front of the camera would fill the screen, so it's hidden up close.
    if (p.tag) p.tag.visible = this.tagsOn && Math.hypot(player.x - p.pos.x, player.z - p.pos.z) > 3;
    // Face where he's going, or the player when he's stood still.
    if (p.velocity.length() > 0.6) p.yaw = Math.atan2(-p.velocity.x, -p.velocity.y);
    else if (p.state !== 'caged') p.yaw = Math.atan2(-(player.x - p.pos.x), -(player.z - p.pos.z));
    p.pose(dt);
  }
}
