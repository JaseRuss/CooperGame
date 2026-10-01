import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createFigureMesh } from '../entities/Soldier';
import { ARMY_GREEN } from '../utils/plastic';
import { clamp } from '../utils/math';
import type { InputState } from '../input/InputManager';
import { FRIEND_GROUPS, WALLS_ONLY } from './groups';

/** The capsule round the army man: 1.8 m from the bottom of the stand to the top of the helmet. */
const RADIUS = 0.35;
const HALF_HEIGHT = 0.9 - RADIUS;
const RUN_SPEED = 6;
const GRAVITY = 24;
/** How quickly the run speeds up and slows down (higher is snappier). */
const ACCEL = 14;
const PITCH_MIN = -0.75;
const PITCH_MAX = 0.65;
export const MAX_HEALTH = 100;
/** How long he lies there when knocked down, before getting up at the last checkpoint. */
const DOWN_TIME = 4;
/** The rifle's muzzle, in the figure's own space (it faces -Z). */
const MUZZLE = new THREE.Vector3(0.12, 1.49, -0.95);
const FIRE_INTERVAL = 0.16;
/** Health comes back by itself this long after the last hit, this fast (per second). */
const REGEN_DELAY = 4;
const REGEN_RATE = 10;
/** Health after a medic patches him up. */
const PATCHED_UP = 60;

/**
 * The player on foot in the prison: a green army man in a Rapier character controller. He runs
 * where the left stick points relative to the camera, always faces where he's aiming, and hops
 * like every other toy soldier (they can't walk).
 */
export class PlayerSoldier {
  readonly root = new THREE.Group();
  readonly collider: RAPIER.Collider;
  /** Aim: yaw turns him (0 faces -Z, increasing turns left); pitch raises the rifle. */
  yaw: number;
  pitch = 0;
  health = MAX_HEALTH;
  /** Seconds left lying down after being knocked over (0 while on his feet). */
  downFor = 0;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly figure: THREE.Mesh;
  private readonly velocity = new THREE.Vector3();
  private fallSpeed = 0;
  private hopPhase = 0;
  private fireCooldown = 0;
  private sinceHit = REGEN_DELAY;
  private readonly pos = new THREE.Vector3();

  constructor(private readonly world: RAPIER.World, x: number, z: number, yaw: number) {
    this.yaw = yaw;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.9, z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(FRIEND_GROUPS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.figure = createFigureMesh(0, ARMY_GREEN);
    this.root.add(this.figure);
    this.pos.set(x, 0, z);
    this.applyTransform(0);
  }

  /** The bottom of his stand. */
  get position(): THREE.Vector3 {
    return this.pos;
  }

  get isDown(): boolean {
    return this.downFor > 0;
  }

  /** Which way he's aiming, along the ground. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Where the rifle's muzzle is right now. */
  muzzle(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(MUZZLE).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.pos);
  }

  setVisible(visible: boolean): void {
    this.figure.visible = visible;
  }

  /** Puts him straight back on his feet at (x, z), facing `yaw`. */
  teleport(x: number, z: number, yaw: number): void {
    this.body.setNextKinematicTranslation({ x, y: 0.9, z });
    this.body.setTranslation({ x, y: 0.9, z }, true);
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.fallSpeed = 0;
    this.downFor = 0;
    this.health = MAX_HEALTH;
    this.applyTransform(0);
  }

  takeDamage(amount: number): void {
    if (this.isDown) return;
    this.sinceHit = 0;
    this.health = Math.max(0, this.health - amount);
    if (this.health === 0) this.downFor = DOWN_TIME;
  }

  /** A medic's patched him up: back on his feet where he lies. */
  revive(): void {
    this.downFor = 0;
    this.health = PATCHED_UP;
    this.sinceHit = 0;
    this.applyTransform(0);
  }

  heal(amount: number): void {
    if (!this.isDown) this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  /**
   * Moves and aims him for one frame. Returns true when the rifle fires this frame (the game
   * works out what the shot hits, from the camera's crosshair).
   */
  step(input: InputState, dt: number): boolean {
    if (this.isDown) {
      this.downFor = Math.max(0, this.downFor - dt);
      this.velocity.set(0, 0, 0);
      this.applyTransform(0);
      return false;
    }
    this.sinceHit += dt;
    if (this.sinceHit > REGEN_DELAY) this.health = Math.min(MAX_HEALTH, this.health + REGEN_RATE * dt);
    this.yaw -= input.aimYawDelta;
    this.pitch = clamp(this.pitch - input.aimPitchDelta, PITCH_MIN, PITCH_MAX);

    // Left stick (or W A S D) relative to the camera, which looks along the aim.
    let mx = input.moveX + input.steer;
    let my = input.moveY + input.throttle;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wantX = (-sin * my + cos * mx) * RUN_SPEED;
    const wantZ = (-cos * my - sin * mx) * RUN_SPEED;
    const k = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (wantX - this.velocity.x) * k;
    this.velocity.z += (wantZ - this.velocity.z) * k;

    const grounded = this.controller.computedGrounded();
    this.fallSpeed = grounded ? 0 : this.fallSpeed + GRAVITY * dt;
    const desired = { x: this.velocity.x * dt, y: -Math.max(this.fallSpeed, 1) * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, undefined, WALLS_ONLY); // walks through his own side
    const moved = this.controller.computedMovement();
    const t = this.body.translation();
    const next = { x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z };
    this.body.setNextKinematicTranslation(next);
    this.pos.set(next.x, next.y - 0.9, next.z);
    // Bumping into a wall shouldn't keep pushing at it.
    if (dt > 0) {
      this.velocity.x = moved.x / dt;
      this.velocity.z = moved.z / dt;
    }

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    let hop = 0;
    if (speed > 0.4) {
      this.hopPhase += dt * (6 + speed * 1.2);
      hop = Math.abs(Math.sin(this.hopPhase)) * 0.25;
    } else {
      this.hopPhase = 0;
    }
    this.applyTransform(hop);

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    // The rifle doesn't fire while he's spraying jam.
    if (input.firing && !input.jamFiring && this.fireCooldown === 0) {
      this.fireCooldown = FIRE_INTERVAL;
      return true;
    }
    return false;
  }

  private applyTransform(hop: number): void {
    this.root.position.copy(this.pos);
    this.figure.position.set(0, hop, 0);
    this.figure.rotation.set(0, this.yaw, 0);
    // Knocked down: flat on his back until he gets up.
    if (this.isDown) this.figure.rotation.set(Math.PI / 2, this.yaw, 0, 'YXZ');
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
