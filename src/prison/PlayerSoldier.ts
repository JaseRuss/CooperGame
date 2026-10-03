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
/**
 * The gap the character controller keeps round him. Too thin and a frame that leaves the capsule
 * a hair inside the floor stops him dead (Rapier won't move a shape out of something it starts in).
 */
const SKIN = 0.08;
const RUN_SPEED = 6;
/** Creeping along (Shift): slow, but the guards' vision cones see only half as far. */
const SNEAK_SPEED = 2.5;
/** How far he veers off (radians) to get round a corner he's run into, and how far to the side he looks for a way past. */
const VEER = 0.9;
const SIDESTEP = [0.5, 0.9];
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
  private settling = false;
  private hopPhase = 0;
  /** Creeping along this frame (the sneak button held). */
  sneaking = false;
  private fireCooldown = 0;
  private sinceHit = REGEN_DELAY;
  private readonly pos = new THREE.Vector3();

  constructor(private readonly world: RAPIER.World, x: number, z: number, yaw: number) {
    this.yaw = yaw;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.9 + SKIN, z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(FRIEND_GROUPS), this.body);
    this.controller = world.createCharacterController(SKIN);
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
  teleport(x: number, z: number, yaw: number, y = 0): void {
    this.body.setNextKinematicTranslation({ x, y: y + 0.9 + SKIN, z });
    this.body.setTranslation({ x, y: y + 0.9 + SKIN, z }, true);
    // The collider only catches up with the body when the world steps, so don't move him off it until then.
    this.settling = true;
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.fallSpeed = 0;
    this.downFor = 0;
    this.health = MAX_HEALTH;
    this.applyTransform(0);
  }

  /** Mid-climb: drawn at `at` facing `yaw`, not moving under his own steam (the game moves him). */
  climbAt(at: THREE.Vector3, yaw: number): void {
    this.pos.copy(at);
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
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
      this.sneaking = false;
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
    this.sneaking = input.sneak;
    const top = this.sneaking ? SNEAK_SPEED : RUN_SPEED;
    const wantX = (-sin * my + cos * mx) * top;
    const wantZ = (-cos * my - sin * mx) * top;
    const k = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (wantX - this.velocity.x) * k;
    this.velocity.z += (wantZ - this.velocity.z) * k;

    if (this.settling) {
      this.settling = false;
      this.applyTransform(0);
      return false;
    }
    const grounded = this.controller.computedGrounded();
    this.fallSpeed = grounded ? 0 : this.fallSpeed + GRAVITY * dt;
    // On his feet the run is purely sideways (snap-to-ground keeps him on the floor and takes him down
    // steps): pushing down into the floor every frame made Rapier now and then refuse the whole move.
    const desired = { x: this.velocity.x * dt, y: grounded ? 0 : -Math.max(this.fallSpeed, 1) * dt, z: this.velocity.z * dt };
    const moved = this.move(desired);
    const t = this.body.translation();
    const next = { x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z };
    this.body.setNextKinematicTranslation(next);
    this.pos.set(next.x, next.y - 0.9 - SKIN, next.z);
    // The run itself is left alone when he bumps into something: the controller slides him along
    // it, and the moment he's past a post or a crate's corner he's straight back to full speed.
    const speed = dt > 0 ? Math.hypot(moved.x, moved.z) / dt : 0;
    let hop = 0;
    if (speed > 0.4) {
      this.hopPhase += dt * (6 + speed * 1.2);
      hop = Math.abs(Math.sin(this.hopPhase)) * (this.sneaking ? 0.1 : 0.25);
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

  /**
   * Runs the character controller for one frame's move and returns how far he actually goes. Run
   * nearly head-on into a crate, a post or the end of a wall and Rapier just stops him dead, so when
   * he's blocked he looks just past the obstacle either side and, if one side is open, slides off
   * that way round it. Square into a long wall, neither side is open and he stays put.
   */
  private move(desired: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const run = (d: { x: number; y: number; z: number }) => {
      this.controller.computeColliderMovement(this.collider, d, undefined, WALLS_ONLY); // walks through his own side
      const m = this.controller.computedMovement();
      return { x: m.x, y: m.y, z: m.z };
    };
    const straight = run(desired);
    const want = Math.hypot(desired.x, desired.z);
    if (want < 1e-4) return straight;
    const fx = desired.x / want;
    const fz = desired.z / want;
    if (straight.x * fx + straight.z * fz > want * 0.4) return straight;
    // Which side is open: a clear line ahead from a little way off to that side.
    const t = this.body.translation();
    const open = (side: number, off: number) =>
      [-0.6, 0.3].every((dy) => { // a hand above the floor, and chest high
        const origin = { x: t.x - fz * side * off, y: t.y + dy, z: t.z + fx * side * off };
        return !this.world.castRay(new RAPIER.Ray(origin, { x: fx, y: 0, z: fz }), RADIUS + SKIN + 0.5, true, undefined, WALLS_ONLY, this.collider);
      });
    for (const off of SIDESTEP) {
      const left = open(1, off);
      const right = open(-1, off);
      if (!left && !right) continue;
      // The open side (either, round something thin), veering toward it: a negative turn swings the move toward +side.
      const turn = left ? -VEER : VEER;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      return run({ x: desired.x * c + desired.z * s, y: desired.y, z: -desired.x * s + desired.z * c });
    }
    return straight;
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
