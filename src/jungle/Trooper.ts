import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createFigureMesh, JAM_MATERIAL } from '../entities/Soldier';
import { plastic } from '../utils/plastic';
import { createJammedTag } from '../combat/JamCannon';
import { FRIEND_GROUPS, ENEMY_GROUPS, WALLS_ONLY } from '../prison/groups';

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
  private hop = Math.random() * 6;
  private tip = 0;
  private sink = 0;
  private moving = false;

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
    this.root.add(this.figure, this.tag);
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
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3 || this.state !== 'active') {
      this.moving = false;
      return 0;
    }
    const step = Math.min(d, speed * dt);
    this.controller.computeColliderMovement(this.collider, { x: (dx / d) * step, y: -dt, z: (dz / d) * step }, undefined, WALLS_ONLY);
    const m = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: 0.9, z: t.z + m.z });
    this.pos.set(t.x + m.x, 0, t.z + m.z);
    if (face) this.faceToward(x, z, dt);
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
