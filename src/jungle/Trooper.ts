import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createFigureMesh, JAM_MATERIAL } from '../entities/Soldier';
import { plastic } from '../utils/plastic';
import { createJammedTag } from '../combat/JamCannon';
import { FRIEND_GROUPS, ENEMY_GROUPS, WALK_ONLY } from '../prison/groups';

const RADIUS = 0.3;
const HALF_HEIGHT = 0.9 - RADIUS;
const JAM_TIME = 3.6;
/** Seconds a fallen soldier lies there before he sinks away. */
const LINGER = 11;

export type TrooperState = 'active' | 'jammed' | 'down';

/**
 * A toy soldier in the jungle (one of the squad, or one of theirs): a capsule that slides round the
 * trunks with a character controller, a figure that hops along, hit points, and the states every
 * soldier shares: standing, stuck in jam (can't move or shoot), and flat on his back.
 */
export class Trooper {
  /** Where to head from (fx, fz) to get to (tx, tz): the target itself, or the end of a bridge if there's a river between. */
  static route: ((fx: number, fz: number, tx: number, tz: number) => { x: number; z: number }) | null = null;
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly collider: RAPIER.Collider;
  state: TrooperState = 'active';
  yaw = 0;
  hp: number;
  /** Seconds in the current state (down: since he fell). */
  stateTime = 0;
  /** Gone for good (sunk away): the manager drops him. */
  gone = false;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly figure: THREE.Mesh;
  private readonly baseMaterial: THREE.Material;
  private readonly tag: THREE.Sprite;
  private readonly startledTag: THREE.Sprite;
  private hop = Math.random() * 6;
  private tip = 0;
  private sink = 0;
  private moving = false;
  /** Jammed against a trunk: how long, and a short sidestep to get round it (seconds left, and which way). */
  private stuck = 0;
  private detour = 0;
  private detourTurn = 0;

  constructor(
    private readonly world: RAPIER.World,
    x: number,
    z: number,
    readonly side: 'friend' | 'enemy',
    color: number,
    readonly maxHp: number,
    readonly name = '',
  ) {
    this.hp = maxHp;
    this.figure = createFigureMesh(Math.random() < 0.25 ? 1 : 0, color);
    this.baseMaterial = plastic(color);
    this.tag = createJammedTag(1.8, 'STUCK!');
    this.tag.position.y = 2.4;
    this.tag.visible = false;
    this.startledTag = createJammedTag(1.3, 'WHAT?!');
    this.startledTag.position.y = 2.4;
    this.startledTag.visible = false;
    this.root.add(this.figure, this.tag, this.startledTag);
    this.pos.set(x, 0, z);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.9, z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(side === 'friend' ? FRIEND_GROUPS : ENEMY_GROUPS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.enableSnapToGround(0.3);
    this.root.position.copy(this.pos);
  }

  get active(): boolean {
    return this.state === 'active';
  }

  get down(): boolean {
    return this.state === 'down';
  }

  /** Where to aim at him. */
  chest(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).setY(1.15);
  }

  eye(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).setY(1.45);
  }

  /** Walks `speed` m/s toward (x, z), sliding along trunks, turning to face the way he goes. */
  stepToward(x: number, z: number, speed: number, dt: number, face = true): number {
    // Across a river, he heads for the bridge first.
    const go = Trooper.route ? Trooper.route(this.pos.x, this.pos.z, x, z) : { x, z };
    const dx = go.x - this.pos.x;
    const dz = go.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3 || this.state !== 'active') {
      this.moving = false;
      return 0;
    }
    const step = Math.min(d, speed * dt);
    let ux = dx / d;
    let uz = dz / d;
    if (this.detour > 0) {
      this.detour -= dt;
      const c = Math.cos(this.detourTurn);
      const n = Math.sin(this.detourTurn);
      [ux, uz] = [ux * c - uz * n, ux * n + uz * c];
    }
    this.controller.computeColliderMovement(this.collider, { x: ux * step, y: -dt, z: uz * step }, undefined, WALK_ONLY);
    const m = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: 0.9, z: t.z + m.z });
    this.pos.set(t.x + m.x, 0, t.z + m.z);
    // Head-on into a trunk gets nowhere: after a moment, step off to one side.
    if (Math.hypot(m.x, m.z) < step * 0.3 && step > 0.01) {
      this.stuck += dt;
      if (this.stuck > 0.4) {
        this.stuck = 0;
        this.detour = 0.8;
        this.detourTurn = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.5);
      }
    } else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (face) this.faceToward(go.x, go.z, dt);
    this.moving = true;
    return Math.hypot(m.x, m.z);
  }

  faceToward(x: number, z: number, dt: number, rate = 9): void {
    const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    let diff = want - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, rate * dt);
  }

  /** Hit for `n` points: down when they're gone. Returns true if that did it. */
  hurt(n: number): boolean {
    if (this.state === 'down') return false;
    this.hp -= n;
    if (this.hp > 0) return false;
    this.knockOver();
    return true;
  }

  private knockOver(): void {
    this.state = 'down';
    this.stateTime = 0;
    this.hp = 0;
    this.collider.setEnabled(false);
    this.figure.material = this.baseMaterial;
    this.tag.visible = false;
    this.startledTag.visible = false;
  }

  /** Splattered by jam: stuck fast, then he slips over. */
  jam(): boolean {
    if (this.state !== 'active') return false;
    this.state = 'jammed';
    this.stateTime = 0;
    this.figure.material = JAM_MATERIAL;
    this.tag.visible = true;
    return true;
  }

  /** Caught by surprise: a "WHAT?!" over his head while he gapes. */
  surprise(on: boolean): void {
    this.startledTag.visible = on && this.state === 'active';
  }

  /** Jumps him to (x, z), clear of whatever he was stuck on. */
  warp(x: number, z: number): void {
    this.body.setTranslation({ x, y: 0.9, z }, true);
    this.pos.set(x, 0, z);
    this.stuck = 0;
    this.detour = 0;
  }

  /** Back on his feet with `hp` (a squad mate who's been helped up). */
  revive(hp: number): void {
    this.state = 'active';
    this.stateTime = 0;
    this.hp = hp;
    this.collider.setEnabled(true);
    this.tip = 0;
  }

  /** Per-frame upkeep: jam wobble, the fall, sinking away, drawing him. */
  update(dt: number): void {
    this.stateTime += dt;
    if (this.state === 'jammed' && this.stateTime > JAM_TIME) this.knockOver();
    if (this.state === 'down' && this.side === 'enemy' && this.stateTime > LINGER) {
      this.sink += dt * 0.4;
      if (this.stateTime > LINGER + 3) this.gone = true;
    }
    this.tip = this.state === 'down' ? Math.min(1, this.tip + dt * 5) : 0;
    this.hop += dt * (this.moving ? 9 : 0);
    this.root.position.set(this.pos.x, -this.sink, this.pos.z);
    this.figure.position.y = this.moving && this.state === 'active' ? Math.abs(Math.sin(this.hop)) * 0.15 : 0;
    this.figure.rotation.set(0, this.yaw, 0);
    if (this.state === 'jammed') this.figure.rotation.z = Math.sin(this.stateTime * 9) * 0.1;
    if (this.state === 'down') this.figure.rotation.set(-(Math.PI / 2) * Math.min(1, this.tip * 1.05), this.yaw, 0, 'YXZ');
    this.moving = false;
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
    this.root.removeFromParent();
  }
}
