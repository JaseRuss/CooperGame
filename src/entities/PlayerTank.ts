import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank, type ArmorZone } from './Tank';
import type { InputState } from '../input/InputManager';
import { PLAYER_MAX_HEALTH, PLAYER_MAX_SPEED } from '../core/config';
import { ARMY_GREEN, plastic, shade } from '../utils/plastic';
import { PartBuilder, tubeZ } from '../utils/modelKit';
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
  /** Tip of the jam cannon's barrel, on the turret's right cheek. */
  private readonly jamMuzzle = new THREE.Object3D();
  private jamCooldown = 0;
  readonly jamInterval = 0.07; // a hose, not a mortar
  /** Walks each glob's range from near to far and back, so a held spray paints a line of jam. */
  private jamSweep = 0;

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
    this.buildJamCannon();
  }

  /** A jam jar with a gingham lid feeding a stubby barrel, on the turret's right cheek. */
  private buildJamCannon(): void {
    const mount = new THREE.Group();
    mount.position.set(0.98, 0.62, 0.1);
    this.turretPivot.add(mount);
    const dark = plastic(shade(ARMY_GREEN, 0.6));
    const jam = new THREE.MeshPhysicalMaterial({ color: 0xe0294f, emissive: 0x5a0616, roughness: 0.1, clearcoat: 1 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xdff4ff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.35 });
    const b = new PartBuilder();
    b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 16), glass, 0, 0.32, 0.15);
    b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 16), jam, 0, 0.27, 0.15);
    b.add(new THREE.CylinderGeometry(0.23, 0.23, 0.07, 16), plastic(0xe8e0d0), 0, 0.55, 0.15); // lid band
    b.add(new THREE.BoxGeometry(0.14, 0.16, 0.14), dark, 0, 0.06, 0.15); // feed
    b.add(tubeZ(0.1, 0.12, 0.8, 12), dark, 0, 0, -0.3); // barrel
    b.add(tubeZ(0.16, 0.1, 0.14, 12), jam, 0, 0, -0.74); // jammy muzzle
    b.add(new THREE.BoxGeometry(0.08, 0.3, 0.3), dark, -0.12, -0.1, 0.05); // bracket
    b.buildInto(mount);
    // Red-and-white gingham cloth over the lid.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(200,30,40,0.55)';
    for (let i = 0; i < 8; i += 2) {
      ctx.fillRect(i * 8, 0, 8, 64);
      ctx.fillRect(0, i * 8, 64, 8);
    }
    const cloth = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.08, 16), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c) }));
    cloth.position.set(0, 0.6, 0.15);
    cloth.castShadow = true;
    mount.add(cloth);
    this.jamMuzzle.position.set(0, 0, -0.85);
    mount.add(this.jamMuzzle);
  }

  /**
   * Sprays jam while the trigger's held. Each glob's speed sweeps between short and long, so they
   * land in a line along the aim; speedScale is that glob's share of full speed.
   */
  tryJam(): { origin: THREE.Vector3; direction: THREE.Vector3; speedScale: number } | null {
    if (this.jamCooldown > 0) return null;
    this.jamCooldown = this.jamInterval;
    this.jamSweep = (this.jamSweep + 0.17) % 2;
    const t = this.jamSweep < 1 ? this.jamSweep : 2 - this.jamSweep; // 0 → 1 → 0
    const direction = this.muzzleWorldDirection;
    direction.x += (Math.random() - 0.5) * 0.03;
    direction.z += (Math.random() - 0.5) * 0.03;
    return { origin: this.jamMuzzle.getWorldPosition(new THREE.Vector3()), direction: direction.normalize(), speedScale: 0.62 + 0.45 * t };
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
    this.jamCooldown = Math.max(0, this.jamCooldown - dt);
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
