import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank, type ArmorZone } from './Tank';
import type { InputState } from '../input/InputManager';
import { PLAYER_MAX_HEALTH, PLAYER_MAX_SPEED } from '../core/config';
import { ARMY_GREEN } from '../utils/plastic';
import { clamp } from '../utils/math';

// Hysteresis for switching between driving forward and reversing toward the stick direction.
const START_REVERSING = 1.95; // rad off the nose
const STOP_REVERSING = 1.2;

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class PlayerTank extends Tank {
  private driveDir: 1 | -1 = 1;

  constructor(world: RAPIER.World, spawnX: number, spawnZ: number, facingRadians = 0) {
    super(world, spawnX, spawnZ, PLAYER_MAX_HEALTH, ARMY_GREEN, facingRadians, 'player');
  }

  /** Set while a rocket-cam sequence plays: the player can't be hurt while not in control. */
  invulnerable = false;

  /** The player tank can never be reduced below 1 HP, and ignores armour zones. */
  override takeDamage(amount: number): ArmorZone | null {
    if (!this.invulnerable) this.health = Math.max(1, this.health - amount);
    return null;
  }

  step(input: InputState, dt: number): { origin: THREE.Vector3; direction: THREE.Vector3 } | null {
    const hullYawBefore = this.yaw;

    const stickLen = Math.hypot(input.moveX, input.moveY);
    if (stickLen > 0) this.driveTowardStick(input.moveX, input.moveY, stickLen, dt);
    else this.drive(input.throttle, input.steer, dt, PLAYER_MAX_SPEED);

    // Stabilised turret: cancel out the hull's rotation so the aim (and camera) hold still.
    const hullDelta = wrap(this.yaw - hullYawBefore);
    // Positive yaw input (stick/mouse right) must turn the turret clockwise, i.e. negative rotation.y.
    this.aim(-hullDelta - input.aimYawDelta, -input.aimPitchDelta);
    this.update(dt);

    return input.firing ? this.tryFire() : null;
  }

  /** Stick direction is relative to the camera, which looks along the turret. */
  private driveTowardStick(sx: number, sy: number, len: number, dt: number): void {
    const camYaw = this.turretWorldYaw;
    const mx = -Math.sin(camYaw) * sy + Math.cos(camYaw) * sx;
    const mz = -Math.cos(camYaw) * sy - Math.sin(camYaw) * sx;
    const desiredYaw = Math.atan2(-mx, -mz);

    const errForward = wrap(desiredYaw - this.yaw);
    if (this.driveDir === 1 && Math.abs(errForward) > START_REVERSING) this.driveDir = -1;
    else if (this.driveDir === -1 && Math.abs(errForward) < STOP_REVERSING) this.driveDir = 1;

    const err = this.driveDir === 1 ? errForward : wrap(errForward + Math.PI);
    const steer = clamp(-err * 2.5, -1, 1);
    // Turn first, then pick up speed as the hull lines up with the stick.
    const throttle = this.driveDir * Math.min(1, len) * Math.max(0, Math.cos(err));
    this.drive(throttle, steer, dt, PLAYER_MAX_SPEED);
  }
}
