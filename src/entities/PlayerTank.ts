import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank, type ArmorZone } from './Tank';
import type { InputState } from '../input/InputManager';
import { PLAYER_MAX_HEALTH, PLAYER_MAX_SPEED } from '../core/config';
import { ARMY_GREEN, plastic, shade } from '../utils/plastic';
import { PartBuilder } from '../utils/modelKit';
import { buildRocketModel } from '../combat/HomingRocket';
import type { DriveStyle } from '../core/Settings';
import { clamp } from '../utils/math';

// Warthog-style driving: the stick is read in the camera's frame, so up is always "where I'm
// looking". Pull back and the tank reverses with its nose still toward the camera, rather than
// spinning round. Hysteresis stops it flip-flopping when the stick sits near the boundary.
const START_REVERSING = 2.0; // stick angle off camera-forward, rad
const STOP_REVERSING = 1.3;
// Classic driving: the hull turns to face the stick, reversing when the stick points well behind
// the hull (judged against the hull, not the camera). WASD is plain tank steering.
const CLASSIC_START_REVERSING = 1.95; // rad off the nose
const CLASSIC_STOP_REVERSING = 1.2;
/** Seconds with no drive input before the hull swings round to face the camera. */
const ALIGN_DELAY = 0.6;
const ALIGN_DEADBAND = 0.04;
const ALIGN_TURN_RATE = 0.8;

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class PlayerTank extends Tank {
  driveStyle: DriveStyle = 'warthog';
  private driveDir: 1 | -1 = 1;
  private idleTime = 0;
  /** Launch rail on the turret's left cheek; the rocket sits on it while it's ready to fire. */
  private readonly rocketRail = new THREE.Group();
  private readonly readyRocket: THREE.Group;
  private readonly readyLamp: THREE.MeshStandardMaterial;
  private lampTime = 0;

  constructor(world: RAPIER.World, spawnX: number, spawnZ: number, facingRadians = 0) {
    super(world, spawnX, spawnZ, PLAYER_MAX_HEALTH, ARMY_GREEN, facingRadians, 'player');
    this.addCommander(ARMY_GREEN);

    this.rocketRail.position.set(-0.98, 0.62, 0.15);
    this.turretPivot.add(this.rocketRail);
    const dark = plastic(shade(ARMY_GREEN, 0.6));
    this.readyLamp = new THREE.MeshStandardMaterial({ color: 0xff5030, emissive: 0xff3010, emissiveIntensity: 0 });
    const rail = new PartBuilder();
    rail.add(new THREE.BoxGeometry(0.16, 0.08, 2.2), dark, 0, 0, 0);
    rail.add(new THREE.BoxGeometry(0.1, 0.34, 0.14), dark, 0.12, -0.18, -0.6);
    rail.add(new THREE.BoxGeometry(0.1, 0.34, 0.14), dark, 0.12, -0.18, 0.6);
    rail.add(new THREE.BoxGeometry(0.22, 0.2, 0.3), dark, 0, -0.06, 1.05); // blast shield at the back
    rail.add(new THREE.SphereGeometry(0.07, 8, 6), this.readyLamp, 0, 0.1, 1.05);
    rail.buildInto(this.rocketRail);
    this.readyRocket = buildRocketModel();
    this.readyRocket.scale.setScalar(0.55);
    this.readyRocket.position.set(0, 0.2, -0.1);
    this.readyRocket.rotation.y = Math.PI; // the model's nose is +Z; the tank's front is -Z
    this.rocketRail.add(this.readyRocket);
    this.setRocketReady(false);
  }

  /** Shows the rocket on its rail (and blinks the lamp) when it's charged. */
  setRocketReady(ready: boolean): void {
    this.readyRocket.visible = ready;
    if (!ready) this.readyLamp.emissiveIntensity = 0;
  }

  /** Where a launched rocket leaves from, in world space. */
  get rocketLaunchPoint(): THREE.Vector3 {
    return this.readyRocket.getWorldPosition(new THREE.Vector3());
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

    // WASD drives exactly like the left stick.
    let sx = input.moveX;
    let sy = input.moveY;
    if (sx === 0 && sy === 0) {
      sx = input.steer;
      sy = input.throttle;
    }
    const len = Math.min(1, Math.hypot(sx, sy));
    if (this.driveStyle === 'classic') {
      const stickLen = Math.hypot(input.moveX, input.moveY);
      if (stickLen > 0) this.driveClassic(input.moveX, input.moveY, Math.min(1, stickLen), dt);
      else this.drive(input.throttle, input.steer, dt, PLAYER_MAX_SPEED);
    } else if (len > 0) {
      this.idleTime = 0;
      this.driveCameraRelative(sx, sy, len, dt);
    } else {
      this.idleTime += dt;
      this.alignToCamera(dt);
    }
    if (this.readyRocket.visible) {
      this.lampTime += dt;
      this.readyLamp.emissiveIntensity = Math.sin(this.lampTime * 8) > 0 ? 2.2 : 0.3;
    }

    // Stabilised turret: cancel out the hull's rotation so the aim (and camera) hold still.
    const hullDelta = wrap(this.yaw - hullYawBefore);
    // Positive yaw input (stick/mouse right) must turn the turret clockwise, i.e. negative rotation.y.
    this.aim(-hullDelta - input.aimYawDelta, -input.aimPitchDelta);
    this.update(dt);

    return input.firing ? this.tryFire() : null;
  }

  private driveCameraRelative(sx: number, sy: number, len: number, dt: number): void {
    const stickAngle = Math.atan2(sx, sy); // 0 = straight ahead of the camera, positive = right
    if (this.driveDir === 1 && Math.abs(stickAngle) > START_REVERSING) this.driveDir = -1;
    else if (this.driveDir === -1 && Math.abs(stickAngle) < STOP_REVERSING) this.driveDir = 1;

    // Heading of travel in the world; positive yaw turns left, so a stick to the right subtracts.
    const travelYaw = this.turretWorldYaw - stickAngle;
    const noseYaw = this.driveDir === 1 ? travelYaw : travelYaw + Math.PI;
    const err = wrap(noseYaw - this.yaw);
    const steer = clamp(-err * 2.5, -1, 1);
    // Turn first, then pick up speed as the hull lines up.
    const throttle = this.driveDir * len * Math.max(0, Math.cos(err));
    this.drive(throttle, steer, dt, PLAYER_MAX_SPEED);
  }

  /** Classic: the stick (relative to the camera) is a direction the hull turns to face and drives. */
  private driveClassic(sx: number, sy: number, len: number, dt: number): void {
    const desiredYaw = this.turretWorldYaw - Math.atan2(sx, sy);
    const errForward = wrap(desiredYaw - this.yaw);
    if (this.driveDir === 1 && Math.abs(errForward) > CLASSIC_START_REVERSING) this.driveDir = -1;
    else if (this.driveDir === -1 && Math.abs(errForward) < CLASSIC_STOP_REVERSING) this.driveDir = 1;
    const err = this.driveDir === 1 ? errForward : wrap(errForward + Math.PI);
    const steer = clamp(-err * 2.5, -1, 1);
    // Turn first, then pick up speed as the hull lines up with the stick.
    const throttle = this.driveDir * len * Math.max(0, Math.cos(err));
    this.drive(throttle, steer, dt, PLAYER_MAX_SPEED);
  }

  /** Once the stick has been left alone for a moment, turn the nose to face the camera. */
  private alignToCamera(dt: number): void {
    const err = wrap(this.turretWorldYaw - this.yaw);
    const aligning = this.idleTime > ALIGN_DELAY && Math.abs(err) > ALIGN_DEADBAND;
    const steer = aligning ? clamp(-err * 2, -1, 1) * ALIGN_TURN_RATE : 0;
    this.drive(0, steer, dt, PLAYER_MAX_SPEED);
    if (!aligning) this.driveDir = 1;
  }
}
