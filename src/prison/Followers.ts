import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createFigureMesh, createCheeringFigure } from '../entities/Soldier';
import { nameTag, renameTag } from '../entities/AllyTank';
import { createJammedTag } from '../combat/JamCannon';
import { PartBuilder } from '../utils/modelKit';
import { ARMY_GREEN, plastic } from '../utils/plastic';
import { FRIEND_GROUPS, WALLS_ONLY } from './groups';
import type { Guard, Guards, Shot } from './Guards';
import type { Cell, Cells } from './Cells';
import { CELL_CAPACITY } from './Cells';
import type { NavGraph } from './NavGraph';

/** Buddies are a lighter green than the other prisoners, like their tanks in the main game. */
const BUDDY_COLOR = 0x6a9a3c;
const RADIUS = 0.3;
const HALF_HEIGHT = 0.9 - RADIUS;
const GRAVITY = 24;
/** A breadcrumb is dropped every this many metres the player moves; the squad walks the trail. */
const SPACING = 0.6;
const TRAIL_MAX = 900;
/** The first follower keeps this far back along the trail, the rest this much further each. */
const FIRST_GAP = 1.6;
const GAP = 1;
const RUN = 6.3;
const CATCH_UP = 8;
/** How often each follower looks for a straight line to further along the trail. */
const SHORTCUT_EVERY = 0.25;
const CHEER_TIME = 1.3;
const PERSONAL_SPACE = 0.95;
/** In sight of the player (and this close), followers gather round him instead of walking the trail. */
const DIRECT_RANGE = 30;
/** The first to reach him stops this far off, the rest a bit further each, so they gather in a loose crowd. */
const CROWD_NEAR = 2.2;
const CROWD_SPREAD = 0.9;
/** Rejoining the trail only looks this many crumbs back (older bits may loop the long way round). */
const REJOIN_LOOKBACK = 200;
const REJOIN_REACH = 25;
/**
 * Every this many seconds, someone who wanted to go somewhere but got less than STUCK_MOVE
 * metres has a strike: the first finds another way, the third hops him along (a last resort,
 * for a crate corner he can't get round).
 */
const STUCK_WINDOW = 2;
const STUCK_MOVE = 1;
const STUCK_WARP = 3;
/** The line-of-sight rays run this far either side of his middle (inside his capsule, so they never start in a wall). */
const SIGHT_SIDE = 0.22;

/** Hits a prisoner takes before he's knocked down (medics are tougher, so there's usually one left to patch the rest up). */
const HP = 5;
const MEDIC_HP = 8;
/** Nobody comes for him this long, and he gets up by himself (a bit shaky, with this many hits left). */
const GET_UP_ALONE = 25;
const SHAKY_HP = 2;
/** Shooting back at the guards: how far, how often, how wild. */
const FIGHT_RANGE = 20;
const SCAN_EVERY = 0.4;
const FIRE_EVERY = 0.45;
const FIRE_JITTER = 0.25;
const MUZZLE = new THREE.Vector3(0.12, 1.49, -0.95);
const UP = new THREE.Vector3(0, 1, 0);
/** How often jobs are handed out, how far anyone's sent, and how many carry guards at once. */
const DISPATCH_EVERY = 0.5;
const JOB_RANGE = 45;
/** Carriers are sent from further: a guard left lying across the prison still gets collected. */
const CARRY_RANGE = 90;
/**
 * The over-the-shoulder camera sits behind the player: the squad keeps this far from it (and
 * from the point halfway to it), and anyone who still ends up right in front of it is hidden.
 */
const CAMERA_ROOM = 2;
/**
 * How many follow the player: the four buddies, the two medics and a couple of others. Anyone
 * else freed stays behind to hold the prison: guarding the cells with captured guards in them,
 * or securing the doorways.
 */
const SQUAD_SIZE = 8;
const HIDE_NEAR_CAMERA = 1.3;
const MAX_CARRIERS = 2;
/** A medic patches someone up in this long; the player can help a friend up by standing by him this long. */
const TREAT_TIME = 2.2;
const HELP_UP_TIME = 2;
const HELP_UP_RANGE = 1.8;
/** The medics' white helmet band and red cross. */
const MEDIC_COLOR = 0xf4f1e8;
const MEDIC_RED = 0xd8262e;

export interface PrisonerSpot {
  x: number;
  z: number;
  /** Which cell he's locked in. */
  cell: number;
  kneel: boolean;
  /** Set for one of the four buddies: which (an index into the buddy names). */
  buddy: number | null;
  medic: boolean;
  /** The way out of his cell once it's open: inside the door, then out in the corridor. */
  exits: THREE.Vector2[];
  /** The way out through his cell's vent instead (into the pipe chase), if it has one. */
  ventExits?: THREE.Vector2[];
}

/** What the squad needs to know about the rest of the prison each frame. */
export interface SquadWorld {
  player: THREE.Vector3;
  playerDown: boolean;
  revivePlayer(): void;
  guards: Guards;
  cells: Cells;
  nav: NavGraph;
  /** Is there a clear line from `a` to `b` (walls and bars, not people)? */
  sees(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** Where the camera is (the squad keeps out of its way). */
  camera: THREE.Vector3;
  /** Sneaking out (the escape): nobody opens fire. */
  readonly quiet: boolean;
  /** Doorways for those staying behind to secure, most important first. */
  doorPosts: DoorPost[];
}

type State = 'caged' | 'leaving' | 'following' | 'holding' | 'garrison' | 'boarded';

/** A post for one of those holding the prison: outside a cell full of captured guards, or by a doorway. */
interface Post {
  key: string;
  kind: 'cell' | 'door';
  x: number;
  z: number;
  yaw: number;
}

/** A doorway to secure (a post either side of it), from the facility's layout. */
export interface DoorPost {
  x: number;
  z: number;
  /** Which way the man on it faces (out through the doorway). */
  yaw: number;
}

/** Someone being patched up: a downed prisoner, or the player. */
type Patient = Prisoner | 'player';

type Job =
  | { kind: 'carry'; guard: Guard; cell: Cell; seat: number; phase: 'fetch' | 'deliver' | 'leave'; path: THREE.Vector2[]; target: THREE.Vector2 }
  | { kind: 'heal'; patient: Patient; path: THREE.Vector2[]; target: THREE.Vector2; treating: number };

// The medic's white helmet band and red cross on his pack: built once, shared.
let medicGeos: Map<THREE.Material, THREE.BufferGeometry> | null = null;

function medicKit(drop: number): THREE.Group {
  if (!medicGeos) {
    const b = new PartBuilder();
    const white = plastic(MEDIC_COLOR);
    const red = plastic(MEDIC_RED);
    const band = new THREE.CylinderGeometry(0.212, 0.212, 0.1, 18, 1, true);
    b.add(band, white, 0, 1.72, 0);
    b.add(new THREE.BoxGeometry(0.26, 0.26, 0.02), white, 0, 1.33, 0.295);
    b.add(new THREE.BoxGeometry(0.17, 0.055, 0.02), red, 0, 1.33, 0.307);
    b.add(new THREE.BoxGeometry(0.055, 0.17, 0.02), red, 0, 1.33, 0.307);
    // A little cross on the front of the helmet band too.
    b.add(new THREE.BoxGeometry(0.08, 0.025, 0.02), red, 0, 1.72, -0.214);
    b.add(new THREE.BoxGeometry(0.025, 0.08, 0.02), red, 0, 1.72, -0.214);
    medicGeos = b.buildGeometries();
  }
  const g = new THREE.Group();
  for (const [mat, geo] of medicGeos) g.add(new THREE.Mesh(geo, mat));
  g.position.y = -drop;
  return g;
}

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
  private readonly treatTag: THREE.Sprite | null;
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
  hp = HP;
  /** Knocked down: lying there until a medic (or the player) helps him up. */
  down = false;
  /** Seconds the player's been stood by him, helping him up. */
  helpUp = 0;
  /** Seconds he's been lying there. */
  downFor = 0;
  /** The medic on his way to him. */
  healer: Prisoner | null = null;
  job: Job | null = null;
  /** Climbing up or down after the player: where he comes out, and in how long. */
  climb: { to: THREE.Vector3; in: number } | null = null;
  /** Staying behind to hold the prison (not following), on this post, and the way there. */
  stays = false;
  post: Post | null = null;
  postPath: THREE.Vector2[] = [];
  fireTimer = Math.random() * FIRE_EVERY;
  scanTimer = Math.random() * SCAN_EVERY;
  target: Guard | null = null;

  constructor(world: RAPIER.World, readonly spot: PrisonerSpot, name: string | null) {
    const color = spot.buddy === null ? ARMY_GREEN : BUDDY_COLOR;
    this.stand = createFigureMesh(0, color);
    this.kneel = createFigureMesh(1, color);
    this.cheering = createCheeringFigure(color);
    this.root.add(this.stand, this.kneel, this.cheering);
    if (spot.medic) {
      this.stand.add(medicKit(0));
      this.cheering.add(medicKit(0));
      this.kneel.add(medicKit(0.35));
    }
    this.treatTag = spot.medic ? createJammedTag(1.8, '+ PATCHING UP') : null;
    if (this.treatTag) {
      this.treatTag.position.y = 2.2;
      this.treatTag.visible = false;
      this.root.add(this.treatTag);
    }
    this.tag = name === null ? null : nameTag(name);
    if (this.tag) {
      this.tag.scale.set(2, 0.5, 1);
      this.tag.position.y = 2.45;
      this.root.add(this.tag);
    }
    this.exits = spot.exits.map((e) => e.clone());
    this.hp = spot.medic ? MEDIC_HP : HP;
    this.pos.set(spot.x, 0, spot.z);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spot.x, 0.9, spot.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(FRIEND_GROUPS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.pose(0);
  }

  get medic(): boolean {
    return this.spot.medic;
  }

  /** Out, on his feet, and not busy cheering or on a job: free to follow, fight or be sent somewhere. */
  get free(): boolean {
    return this.state !== 'caged' && this.state !== 'leaving' && !this.down && this.cheer === 0 && this.job === null;
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

  teleport(x: number, z: number, y = 0): void {
    this.body.setTranslation({ x, y: y + 0.9, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + 0.9, z });
    this.pos.set(x, y, z);
    this.velocity.set(0, 0);
    this.fallSpeed = 0;
  }

  muzzle(): THREE.Vector3 {
    return MUZZLE.clone().applyAxisAngle(UP, this.yaw).add(this.pos);
  }

  /** Shows the right figure: standing (hopping as he goes), sat in his cell, cheering, carrying a guard overhead, kneeling to patch someone up, or lying flat. */
  pose(dt: number): void {
    const speed = this.velocity.length();
    let hop = 0;
    if (speed > 0.4 && !this.down) {
      this.hopPhase += dt * (6 + speed * 1.2);
      hop = Math.abs(Math.sin(this.hopPhase)) * 0.25;
    }
    const cheering = this.cheer > 0;
    const carrying = this.job?.kind === 'carry' && this.job.phase === 'deliver';
    const treating = this.job?.kind === 'heal' && this.job.treating > 0;
    const sitting = (this.state === 'caged' && this.spot.kneel) || treating;
    this.stand.visible = !cheering && !carrying && !sitting;
    this.kneel.visible = !cheering && !carrying && sitting;
    this.cheering.visible = cheering || carrying;
    if (this.treatTag) this.treatTag.visible = treating;
    // Cheering, he jumps up and down on the spot.
    if (cheering) hop = Math.abs(Math.sin(this.cheer * 9)) * 0.35;
    this.root.position.set(this.pos.x, this.pos.y + hop, this.pos.z);
    for (const f of [this.stand, this.kneel, this.cheering]) f.rotation.set(0, this.yaw, 0);
    // Knocked down: flat on his back.
    if (this.down) this.stand.rotation.set(Math.PI / 2, this.yaw, 0, 'YXZ');
  }
}

/**
 * The prisoners: locked in their cells until the player shoots the padlock, then they cheer,
 * file out of the cell and follow him.
 *
 * Following: rather than path-finding, the squad walks the trail of breadcrumbs the player
 * leaves, each a little further back, so they go wherever he went (through doorways included).
 * Each keeps checking for a straight line further along the trail and cuts the corner when
 * there is one, and once he can see the player he leaves the trail and gathers round him.
 *
 * Fighting: they shoot at any guard they can see. Three hits knock one of them down, and he
 * lies there until a medic (two of the prisoners, with a white helmet band and a red cross)
 * comes and patches him up, or the player stands by him to help him up. A medic will come for
 * the player too.
 *
 * Capturing: a downed guard is picked up by one of the squad, carried over his head to an open
 * cell along the nav graph, and sat down inside; the door shuts behind him once the carrier's
 * out.
 */
export class Followers {
  readonly group = new THREE.Group();
  /** Out of their cells, in the order they joined (which sets their place in the line). */
  private readonly squad: Prisoner[] = [];
  private readonly all: Prisoner[] = [];
  private readonly byCollider = new Map<number, Prisoner>();
  private readonly trail: THREE.Vector2[] = [];
  private holding = false;
  private tagsOn = true;
  private readonly playerSpot = new THREE.Vector2();
  private dispatchTimer = 0;
  /** The medic on his way to the player, while he's down. */
  private playerHealer: Prisoner | null = null;
  private names: string[] = [];

  constructor(private readonly world: RAPIER.World, spots: PrisonerSpot[], names: string[]) {
    for (const spot of spots) {
      const p = new Prisoner(world, spot, spot.buddy === null ? null : names[spot.buddy]);
      // Facing the bars, waiting.
      p.yaw = 0;
      p.pose(0);
      this.all.push(p);
      this.byCollider.set(p.collider.handle, p);
      this.group.add(p.root);
    }
  }

  /** How many are out of their cells and following the player. */
  get count(): number {
    return this.squad.filter((p) => !p.stays).length;
  }

  /** Following the player and on their feet. */
  get standing(): number {
    return this.squad.filter((p) => !p.stays && !p.down).length;
  }

  /** Out, but staying behind to hold the prison. */
  get onGuard(): number {
    return this.squad.filter((p) => p.stays).length;
  }

  get isHolding(): boolean {
    return this.holding;
  }

  /** A medic's on his way to the player (so he stays down rather than going back to the checkpoint). */
  get medicComing(): boolean {
    return this.playerHealer !== null;
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

  /** Where the prisoners the guards can shoot at are (out, and on their feet). */
  targets(): THREE.Vector3[] {
    return this.squad.filter((p) => !p.down && p.state !== 'leaving' && p.state !== 'boarded').map((p) => p.pos);
  }

  /** The nearest friend lying down within `range` of `at` that the player could help up, or null. */
  downNear(at: THREE.Vector3, range: number): { name: string | null; progress: number } | null {
    for (const p of this.squad) {
      if (p.down && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < range) {
        return { name: p.tag ? this.tagName(p) : null, progress: p.helpUp / HELP_UP_TIME };
      }
    }
    return null;
  }

  private tagName(p: Prisoner): string | null {
    return p.spot.buddy === null ? null : (this.names[p.spot.buddy] ?? null);
  }

  setNameTags(visible: boolean, names: string[]): void {
    this.names = names;
    this.tagsOn = visible;
    for (const p of this.all) {
      if (!p.tag || p.spot.buddy === null) continue;
      p.tag.visible = visible;
      renameTag(p.tag, names[p.spot.buddy]);
    }
  }

  /**
   * The cell's door (or its vent) is open: everyone inside cheers and heads out. Returns the
   * buddies among them.
   */
  release(cell: number, viaVent = false): number[] {
    const freed: number[] = [];
    this.stayedBehind = 0;
    for (const p of this.all) {
      if (p.spot.cell !== cell || p.state !== 'caged') continue;
      if (viaVent && p.spot.ventExits) p.exits = p.spot.ventExits.map((e) => e.clone());
      p.state = 'leaving';
      p.cheer = CHEER_TIME + Math.random() * 0.3;
      this.squad.push(p);
      if (p.spot.buddy !== null) freed.push(p.spot.buddy);
      // Only so many follow. Buddies and medics always do (if the squad's full, someone else
      // steps out of it to hold the prison instead).
      if (this.count <= SQUAD_SIZE) continue;
      const vip = (q: Prisoner) => q.spot.buddy !== null || q.medic;
      const stepsOut = vip(p) ? [...this.squad].reverse().find((q) => !q.stays && !vip(q)) : p;
      if (stepsOut) {
        stepsOut.stays = true;
        if (stepsOut.state === 'following' || stepsOut.state === 'holding') stepsOut.state = 'garrison';
        this.stayedBehind++;
      }
    }
    return freed;
  }

  /** How many of those just released are staying behind to hold the prison. */
  stayedBehind = 0;

  /**
   * A guard's shot hit `collider`: if it was one of the squad on his feet, he takes the hit.
   * Returns what happened: null if it wasn't one of them, else whether he's now down and his name.
   */
  hit(collider: RAPIER.Collider): { down: boolean; name: string | null } | null {
    const p = this.byCollider.get(collider.handle);
    if (!p || p.down || p.state === 'caged') return null;
    p.hp--;
    if (p.hp > 0) return { down: false, name: this.tagName(p) };
    this.knockDown(p);
    return { down: true, name: this.tagName(p) };
  }

  /** X: hold here, or follow me again. Returns true when they're now holding. */
  toggleHold(): boolean {
    this.holding = !this.holding;
    for (const p of this.squad) {
      if (this.holding && p.state === 'following') {
        p.state = 'holding';
      } else if (!this.holding && p.state === 'holding') {
        // Following again: back onto the trail (join keeps a holder holding, so switch him first).
        p.state = 'following';
        if (!p.job && !p.down) this.join(p);
      }
    }
    return this.holding;
  }

  /**
   * Back to the checkpoint: the squad comes too, bunched up round him, and the trail starts
   * again. Anyone down gets up; carried guards are dropped where they are.
   */
  gather(at: THREE.Vector3, world: SquadWorld): void {
    this.trail.length = 0;
    this.trail.push(new THREE.Vector2(at.x, at.z));
    this.playerHealer = null;
    this.squad.forEach((p, i) => {
      if (p.state === 'caged' || p.stays) return;
      this.endJob(p, world);
      if (p.down) this.revive(p);
      p.teleport(at.x + Math.sin(i * 2.4) * 0.4, at.z + Math.cos(i * 2.4) * 0.4, at.y);
      p.climb = null;
      p.exits.length = 0;
      p.cursor = 0;
      p.cheer = 0;
      if (p.state === 'leaving') p.state = this.holding ? 'holding' : 'following';
    });
  }

  /**
   * The player's climbed up (or down) to `to`: everyone out of the cells climbs after him, one
   * after another, and comes out there. Anyone down gets up; jobs are dropped.
   */
  climbAfter(to: THREE.Vector3, yaw: number, world: SquadWorld): void {
    // The trail starts again where he comes out.
    this.trail.length = 0;
    this.trail.push(new THREE.Vector2(to.x, to.z));
    this.squad.forEach((p, i) => {
      if (p.stays) return;
      p.cursor = 0;
      this.endJob(p, world);
      if (p.down) this.revive(p);
      // Out a couple of metres ahead of him (not on top of him, or in front of the camera).
      const ahead = 2.5 + Math.floor(i / 3) * 1.2;
      const side = ((i % 3) - 1) * 1.2;
      const at = new THREE.Vector3(to.x - Math.sin(yaw) * ahead + Math.cos(yaw) * side, to.y, to.z - Math.cos(yaw) * ahead - Math.sin(yaw) * side);
      p.climb = { to: at, in: 1.2 + i * 0.5 };
    });
  }

  /**
   * Into the tank and the trucks: everyone out of the cells is off the field (the buddies ride on
   * the tank, everyone else in the trucks). Returns which buddies, and how many others.
   */
  board(world: SquadWorld): { buddies: number[]; others: number } {
    const buddies: number[] = [];
    let others = 0;
    for (const p of this.squad) {
      if (p.state === 'boarded') continue;
      this.endJob(p, world);
      p.state = 'boarded';
      p.down = false;
      p.climb = null;
      p.root.visible = false;
      p.collider.setEnabled(false);
      if (p.spot.buddy !== null) buddies.push(p.spot.buddy);
      else others++;
    }
    return { buddies, others };
  }

  /** Moves, fights and works for one frame. Returns the shots fired at the guards. */
  update(dt: number, world: SquadWorld): Shot[] {
    const player = world.player;
    this.dropCrumb(player);
    this.dispatchTimer -= dt;
    if (this.dispatchTimer <= 0) {
      this.dispatchTimer = DISPATCH_EVERY;
      this.dispatch(world);
    }
    this.shutCells(world);
    // The medic's no use if the player's back up already (or he got knocked down himself on the way).
    if (this.playerHealer && (!world.playerDown || this.playerHealer.down || this.playerHealer.job?.kind !== 'heal')) {
      if (this.playerHealer.job?.kind === 'heal' && this.playerHealer.job.patient === 'player') this.endJob(this.playerHealer, world);
      this.playerHealer = null;
    }

    const shots: Shot[] = [];
    const last = this.trail.length - 1;
    // Places in the line along the trail only count those walking it: the ones who can see him
    // are already gathering round him, so the rest close up behind.
    const onTrail = this.squad.filter((p) => p.state === 'following' && !p.direct && p.free);
    for (const p of this.all) {
      if (p.state === 'boarded') continue;
      if (p.climb) {
        // Climbing after the player: out of sight until he comes out at the top (or bottom).
        p.climb.in -= dt;
        p.root.visible = false;
        if (p.climb.in > 0) continue;
        p.teleport(p.climb.to.x, p.climb.to.z, p.climb.to.y);
        p.climb = null;
        p.cheer = 0;
        p.exits.length = 0;
        if (p.state === 'leaving') p.state = 'following';
        if (p.state === 'following') this.join(p);
        p.pose(0);
        p.root.visible = true;
        continue;
      }
      if (p.down) {
        this.lieDown(p, world, dt);
        continue;
      }
      const crowd = this.squad.indexOf(p);
      const place = Math.max(0, onTrail.indexOf(p));
      let goal: THREE.Vector2 | null = null;
      let arrive = 0.3;
      if (p.cheer > 0) {
        p.cheer = Math.max(0, p.cheer - dt);
      } else if (p.state === 'leaving') {
        if (p.exits.length && Math.hypot(p.exits[0].x - p.pos.x, p.exits[0].y - p.pos.z) < 0.5) p.exits.shift();
        if (p.exits.length) goal = p.exits[0];
        else if (p.stays) p.state = 'garrison';
        else if (this.holding) p.state = 'holding';
        else this.join(p);
      } else if (p.job) {
        const step = this.work(p, world, dt);
        goal = step.goal;
        arrive = step.arrive;
      } else if (p.state === 'garrison') {
        // To his post (once he's been given one) and stand there.
        if (p.post) {
          const step = this.followPath(p, p.postPath, new THREE.Vector2(p.post.x, p.post.z), 0.3);
          goal = step.goal;
          arrive = step.arrive;
        }
      } else if (p.state === 'following') {
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
      this.steer(p, goal, arrive, world, dt);
      if ((p.free && p.state === 'following') || (p.state === 'garrison' && p.post)) this.unstick(p, goal, arrive, last, place, dt, world);
      else if (p.job) this.unstick(p, goal, arrive, last, place, dt, world);
      else p.stuckFrom.set(p.pos.x, p.pos.z);
      if (p.free && !world.quiet) this.fight(p, world, dt, shots);
    }
    return shots;
  }

  // ---------- fighting and getting hurt ----------

  /**
   * Sprays jam at the nearest guard he can see (the prisoners' only weapon: it sticks a guard
   * fast until he slips over), turning to face him when he's not on the move.
   */
  private fight(p: Prisoner, world: SquadWorld, dt: number, shots: Shot[]): void {
    p.scanTimer -= dt;
    if (p.scanTimer <= 0) {
      p.scanTimer = SCAN_EVERY;
      const eye = p.pos.clone().setY(p.pos.y + 1.5);
      let best: Guard | null = null;
      let bestD = FIGHT_RANGE;
      for (const g of world.guards.active) {
        const d = Math.hypot(g.pos.x - p.pos.x, g.pos.z - p.pos.z);
        if (d < bestD && world.sees(eye, g.chest())) {
          bestD = d;
          best = g;
        }
      }
      p.target = best;
    }
    const g = p.target;
    if (!g || !g.isActive) {
      p.target = null;
      return;
    }
    if (p.velocity.length() < 2) p.yaw = Math.atan2(-(g.pos.x - p.pos.x), -(g.pos.z - p.pos.z));
    p.fireTimer -= dt;
    if (p.fireTimer > 0) return;
    p.fireTimer = FIRE_EVERY + Math.random() * FIRE_JITTER;
    const from = p.muzzle();
    // A glob of jam lobbed at his feet (the game lobs it; see PrisonGame.lobJam).
    const at = g.pos.clone().setY(g.pos.y + 0.6);
    shots.push({ from, dir: at.clone().sub(from).normalize(), at });
  }

  private knockDown(p: Prisoner): void {
    p.down = true;
    p.helpUp = 0;
    p.downFor = 0;
    p.target = null;
    p.velocity.set(0, 0);
    p.collider.setEnabled(false);
  }

  private revive(p: Prisoner, hp = p.medic ? MEDIC_HP : HP): void {
    p.down = false;
    p.hp = hp;
    p.helpUp = 0;
    p.healer = null;
    p.collider.setEnabled(true);
    if (p.state === 'following') this.join(p);
  }

  /** Lying there: the player stood by him helps him up. */
  private lieDown(p: Prisoner, world: SquadWorld, dt: number): void {
    if (p.job) this.endJob(p, world);
    const near = !world.playerDown && Math.hypot(world.player.x - p.pos.x, world.player.z - p.pos.z) < HELP_UP_RANGE;
    p.helpUp = near ? p.helpUp + dt : Math.max(0, p.helpUp - dt);
    p.downFor += dt;
    const alone = p.downFor > GET_UP_ALONE && !p.healer;
    if (p.helpUp >= HELP_UP_TIME || alone) {
      if (p.healer?.job?.kind === 'heal') this.endJob(p.healer, world);
      this.revive(p, alone ? SHAKY_HP : undefined);
    }
    p.pose(dt);
  }

  // ---------- jobs: carrying guards to the cells, patching people up ----------

  /**
   * Gives those holding the prison their posts: first one outside each cell with captured
   * guards in it, then the doorways. A cell that needs guarding takes a man off a doorway if
   * there's nobody spare.
   */
  private assignPosts(world: SquadWorld): void {
    const garrison = this.squad.filter((p) => p.stays && p.state === 'garrison');
    if (!garrison.length) return;
    const posts: Post[] = [];
    for (const c of world.cells.all) {
      if (c.guards === 0) continue;
      posts.push({ key: `cell${c.index}`, kind: 'cell', x: c.spot.doorX1 + 0.7, z: c.spot.frontZ - 1.5, yaw: Math.PI });
    }
    world.doorPosts.forEach((d, i) => posts.push({ key: `door${i}`, kind: 'door', x: d.x, z: d.z, yaw: d.yaw }));
    for (const post of posts) {
      if (garrison.some((p) => p.post?.key === post.key)) continue;
      const spare = garrison.filter((p) => !p.post || (post.kind === 'cell' && p.post.kind === 'door'));
      // Someone with no post first; only then a man off a doorway.
      const pool = spare.some((p) => !p.post) ? spare.filter((p) => !p.post) : spare;
      let best: Prisoner | null = null;
      let bestD = Infinity;
      for (const p of pool) {
        const d = Math.hypot(p.pos.x - post.x, p.pos.z - post.z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (!best) continue;
      best.post = post;
      best.postPath = world.nav.path({ x: best.pos.x, z: best.pos.z }, { x: post.x, z: post.z }) ?? [new THREE.Vector2(post.x, post.z)];
    }
  }

  /** Hands out jobs: medics to whoever's down, carriers to downed guards, and posts to those holding the prison. */
  private dispatch(world: SquadWorld): void {
    this.assignPosts(world);
    // Medics first: the player, then the squad, nearest medic to each.
    const patients: Patient[] = [];
    if (world.playerDown && !this.playerHealer) patients.push('player');
    for (const p of this.squad) if (p.down && !p.healer) patients.push(p);
    for (const patient of patients) {
      const at = patient === 'player' ? world.player : patient.pos;
      const medic = this.nearestFree(at, (p) => p.medic && p !== patient);
      if (!medic) continue;
      const target = new THREE.Vector2(at.x, at.z);
      const path = world.nav.path({ x: medic.pos.x, z: medic.pos.z }, { x: at.x, z: at.z });
      if (!path) continue;
      medic.job = { kind: 'heal', patient, path, target, treating: 0 };
      if (patient === 'player') this.playerHealer = medic;
      else patient.healer = medic;
    }

    // Carriers: one per downed guard, a couple at a time, to the nearest open cell with room.
    let carrying = this.squad.filter((p) => p.job?.kind === 'carry').length;
    for (const guard of world.guards.uncollected) {
      if (carrying >= MAX_CARRIERS) break;
      const cell = this.cellFor(guard, world);
      if (!cell) break;
      const carrier = this.nearestFree(guard.pos, (p) => !p.medic, CARRY_RANGE);
      if (!carrier) continue;
      const target = new THREE.Vector2(guard.pos.x, guard.pos.z);
      const path = world.nav.path({ x: carrier.pos.x, z: carrier.pos.z }, { x: guard.pos.x, z: guard.pos.z });
      if (!path) continue;
      carrier.job = { kind: 'carry', guard, cell, seat: cell.guards + cell.booked, phase: 'fetch', path, target };
      guard.claimed = true;
      cell.booked++;
      carrying++;
    }
  }

  /** The nearest one of the squad who's free and `fits`, within reach of `at`. */
  private nearestFree(at: THREE.Vector3, fits: (p: Prisoner) => boolean, range = JOB_RANGE): Prisoner | null {
    let best: Prisoner | null = null;
    let bestD = range;
    for (const p of this.squad) {
      if (!p.free || !fits(p)) continue;
      const d = Math.hypot(p.pos.x - at.x, p.pos.z - at.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** The nearest cell that's been unlocked and has room for another guard. */
  private cellFor(guard: Guard, world: SquadWorld): Cell | null {
    let best: Cell | null = null;
    let bestD = Infinity;
    for (const c of world.cells.all) {
      if (c.locked || c.guards + c.booked >= CELL_CAPACITY) continue;
      const d = Math.hypot((c.spot.doorX0 + c.spot.doorX1) / 2 - guard.pos.x, c.spot.frontZ - guard.pos.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** One frame of his job: where he's heading and how close he needs to get. */
  private work(p: Prisoner, world: SquadWorld, dt: number): { goal: THREE.Vector2 | null; arrive: number } {
    const job = p.job as Job;
    if (job.kind === 'heal') {
      const patient = job.patient;
      const at = patient === 'player' ? world.player : patient.pos;
      const stillDown = patient === 'player' ? world.playerDown : patient.down;
      if (!stillDown) {
        this.endJob(p, world);
        return { goal: null, arrive: 0 };
      }
      job.target.set(at.x, at.z);
      if (Math.hypot(at.x - p.pos.x, at.z - p.pos.z) < 1.2) {
        // Kneel down by him and patch him up.
        job.path.length = 0;
        job.treating += dt;
        p.yaw = Math.atan2(-(at.x - p.pos.x), -(at.z - p.pos.z));
        if (job.treating >= TREAT_TIME) {
          if (patient === 'player') {
            this.playerHealer = null;
            world.revivePlayer();
          } else {
            this.revive(patient);
          }
          this.endJob(p, world);
        }
        return { goal: null, arrive: 0 };
      }
      return this.followPath(p, job.path, job.target, 0.9);
    }

    const guard = job.guard;
    if (job.phase === 'fetch') {
      job.target.set(guard.pos.x, guard.pos.z);
      if (Math.hypot(guard.pos.x - p.pos.x, guard.pos.z - p.pos.z) < 1.3) {
        world.guards.pickUp(guard);
        world.cells.openDoor(job.cell.index);
        job.phase = 'deliver';
        const seat = world.cells.jailSpot(job.cell.index, job.seat);
        job.target.copy(seat);
        job.path = world.nav.path({ x: p.pos.x, z: p.pos.z }, { x: seat.x, z: seat.y }) ?? [seat.clone()];
      }
      return this.followPath(p, job.path, job.target, 0.9);
    }
    if (job.phase === 'deliver') {
      world.guards.carry(guard, p.pos, p.yaw);
      if (Math.hypot(job.target.x - p.pos.x, job.target.y - p.pos.z) < 0.7) {
        world.guards.jail(guard, job.target);
        job.cell.guards++;
        job.cell.booked--;
        job.phase = 'leave';
        // Out into the corridor in front of the cell.
        const out = new THREE.Vector2((job.cell.spot.doorX0 + job.cell.spot.doorX1) / 2, job.cell.spot.frontZ - 1.8);
        job.target.copy(out);
        job.path = world.nav.path({ x: p.pos.x, z: p.pos.z }, { x: out.x, z: out.y }) ?? [out.clone()];
      }
      return this.followPath(p, job.path, job.target, 0.4);
    }
    // Leaving the cell.
    if (Math.hypot(job.target.x - p.pos.x, job.target.y - p.pos.z) < 0.8) {
      this.endJob(p, world);
      return { goal: null, arrive: 0 };
    }
    return this.followPath(p, job.path, job.target, 0.4);
  }

  /** Along `path` (waypoints are dropped as he reaches them) to `target`. */
  private followPath(p: Prisoner, path: THREE.Vector2[], target: THREE.Vector2, arrive: number): { goal: THREE.Vector2; arrive: number } {
    while (path.length > 1 && Math.hypot(path[0].x - p.pos.x, path[0].y - p.pos.z) < 0.7) path.shift();
    // The last waypoint is the target, which may have moved (a casualty, a guard): head for where it is now.
    if (path.length <= 1) return { goal: target, arrive };
    return { goal: path[0], arrive: 0 };
  }

  /** Drops whatever he was doing (putting a carried guard down where he is) and goes back to following. */
  private endJob(p: Prisoner, world: SquadWorld): void {
    const job = p.job;
    if (!job) return;
    p.job = null;
    if (job.kind === 'carry') {
      if (job.phase === 'fetch') {
        job.guard.claimed = false;
        job.cell.booked--;
      } else if (job.phase === 'deliver') {
        world.guards.drop(job.guard);
        job.guard.pos.copy(p.pos);
        job.guard.root.position.copy(p.pos);
        job.cell.booked--;
      }
    } else if (job.patient !== 'player' && job.patient.healer === p) {
      job.patient.healer = null;
    }
    if (!p.down && p.state === 'following') this.join(p);
    if (p.state === 'garrison' && p.post) p.postPath = world.nav.path({ x: p.pos.x, z: p.pos.z }, { x: p.post.x, z: p.post.z }) ?? [new THREE.Vector2(p.post.x, p.post.z)];
  }

  /** Shuts cells on the guards inside once nobody's carrying another in and the doorway's clear. */
  private shutCells(world: SquadWorld): void {
    for (const c of world.cells.all) {
      if (c.locked || c.shut || c.guards === 0 || c.booked > 0) continue;
      const s = c.spot;
      const doorX = (s.doorX0 + s.doorX1) / 2;
      const inTheWay = (at: THREE.Vector3) =>
        (at.x > s.minX - 0.4 && at.x < s.maxX + 0.4 && at.z > s.frontZ - 0.6 && at.z < s.backZ) || Math.hypot(at.x - doorX, at.z - s.frontZ) < 1.8;
      if (inTheWay(world.player) || this.squad.some((p) => inTheWay(p.pos))) continue;
      world.cells.shutDoor(c.index);
    }
  }

  // ---------- following ----------

  /** Stuck on a corner or a crate: try another way, and in the end just hop along. */
  private unstick(p: Prisoner, goal: THREE.Vector2 | null, arrive: number, last: number, place: number, dt: number, world: SquadWorld): void {
    p.stuckWanted ||= goal !== null && p.cheer === 0 && Math.hypot(goal.x - p.pos.x, goal.y - p.pos.z) > arrive + 1;
    p.stuckClock += dt;
    if (p.stuckClock < STUCK_WINDOW) return;
    const moved = Math.hypot(p.pos.x - p.stuckFrom.x, p.pos.z - p.stuckFrom.y);
    p.strikes = p.stuckWanted && moved < STUCK_MOVE ? p.strikes + 1 : 0;
    p.stuckClock = 0;
    p.stuckWanted = false;
    p.stuckFrom.set(p.pos.x, p.pos.z);
    if (!p.strikes) return;
    if (!p.job && p.state === 'garrison' && p.post) {
      // On his way to his post: plan the way again, and as a last resort hop to the next waypoint.
      if (p.strikes >= STUCK_WARP && p.postPath.length) {
        p.teleport(p.postPath[0].x, p.postPath[0].y);
        p.strikes = 0;
      } else {
        p.postPath = world.nav.path({ x: p.pos.x, z: p.pos.z }, { x: p.post.x, z: p.post.z }) ?? [new THREE.Vector2(p.post.x, p.post.z)];
      }
      return;
    }
    const job = p.job;
    if (job) {
      // On a job: plan the way again, and as a last resort hop to the next waypoint.
      if (p.strikes >= STUCK_WARP && job.path.length) {
        p.teleport(job.path[0].x, job.path[0].y);
        p.strikes = 0;
      } else {
        job.path = world.nav.path({ x: p.pos.x, z: p.pos.z }, { x: job.target.x, z: job.target.y }) ?? [job.target.clone()];
      }
      return;
    }
    if (p.strikes >= STUCK_WARP) {
      const crumb = this.trail[Math.max(0, last - Math.ceil((FIRST_GAP + place * GAP) / SPACING))];
      p.teleport(crumb.x, crumb.y);
    }
    this.join(p);
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
    if (p.state !== 'holding') p.state = 'following';
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
  private steer(p: Prisoner, goal: THREE.Vector2 | null, arrive: number, world: SquadWorld, dt: number): void {
    const player = world.player;
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
      // Shuffle apart from the others and from the player (not when squeezing into a cell or kneeling by a casualty).
      const busy = p.job !== null && (p.job.kind === 'heal' || p.job.phase !== 'fetch');
      const push = (x: number, z: number, room: number) => {
        const dx = p.pos.x - x;
        const dz = p.pos.z - z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < room) {
          vx += (dx / d) * (room - d) * 4;
          vz += (dz / d) * (room - d) * 4;
        }
      };
      if (!busy) {
        for (const o of this.squad) if (o !== p && !o.down) push(o.pos.x, o.pos.z, PERSONAL_SPACE);
        push(player.x, player.z, PERSONAL_SPACE + 0.2);
        // Out of the camera's way: off the spot it's at, and off the line from it to the player.
        const cam = world.camera;
        push(cam.x, cam.z, CAMERA_ROOM);
        push((cam.x + player.x) / 2, (cam.z + player.z) / 2, CAMERA_ROOM * 0.75);
      }
      p.move(vx, vz, dt);
    }
    // A name tag right in front of the camera would fill the screen, so it's hidden up close.
    if (p.tag) p.tag.visible = this.tagsOn && Math.hypot(player.x - p.pos.x, player.z - p.pos.z) > 3;
    // Face where he's going, or the player when he's stood still.
    if (p.velocity.length() > 0.6) p.yaw = Math.atan2(-p.velocity.x, -p.velocity.y);
    else if (p.state === 'garrison' && p.post && !p.job && !p.target) p.yaw = p.post.yaw;
    else if (p.state !== 'caged' && p.state !== 'garrison' && !p.job && !p.target) p.yaw = Math.atan2(-(player.x - p.pos.x), -(player.z - p.pos.z));
    p.pose(dt);
    p.root.visible = Math.hypot(world.camera.x - p.pos.x, world.camera.y - p.pos.y - 1, world.camera.z - p.pos.z) > HIDE_NEAR_CAMERA;
  }
}
