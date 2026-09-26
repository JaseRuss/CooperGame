import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank, HULL_HALF_EXTENTS, type ArmorZone } from './Tank';
import type { InputState } from '../input/InputManager';
import { PLAYER_MAX_HEALTH, PLAYER_MAX_SPEED } from '../core/config';
import { ARMY_GREEN, plastic, shade } from '../utils/plastic';
import { PartBuilder, tubeZ } from '../utils/modelKit';
import { buildRocketModel } from '../combat/HomingRocket';
import { buildJeepParts, type JeepParts } from '../world/Vehicles';
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
/** The AA pod's six tube mouths (x, y on its front face): two rows of three. */
const AA_TUBES = [-0.15, 0, 0.15].flatMap((x) => [0.07, -0.08].map((y) => [x, y] as const));

// The jeep from a changing station: same body and collider, much quicker and nimbler.
export type Vehicle = 'tank' | 'jeep';
const JEEP_MAX_SPEED = 36; // m/s (the tank does 22)
const JEEP_TURN_RATE = 1.3; // × the tank's
/** The toy jeep is ~3.9 m long; scaled to about the tank's footprint so it fills the same collider. */
const JEEP_SCALE = 1.15;
/** The model's wheel radius (before JEEP_SCALE), for rolling the wheels at the right speed. */
const JEEP_WHEEL_RADIUS = 0.42;
/** Rapid-fire jam gun: globs per second and a little spray. */
const JEEP_JAM_INTERVAL = 0.11;
const JEEP_JAM_SPREAD = 0.035;
/** The jeep's twin missile pod: tube mouths (x, y) on its front face. */
const JEEP_MISSILE_TUBES = [-0.13, 0.13].map((x) => [x, 0] as const);

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
  private readonly aaPod = new THREE.Group();
  private readonly aaMuzzle = new THREE.Object3D();
  private readonly aaNoses: THREE.Mesh[] = [];

  private vehicleMode: Vehicle = 'tank';
  /** Everything that makes up the tank's look (hull and turret), hidden while it's a jeep. */
  private readonly tankParts: THREE.Object3D[];
  private readonly jeepRig = new THREE.Group();
  /** The jeep's gun mount: turns with the aim (yaw), with the gun and missile pod pitching on it. */
  private readonly jeepMount = new THREE.Group();
  private readonly jeepTilt = new THREE.Group();
  private readonly jeepMuzzle = new THREE.Object3D();
  private readonly jeepPodMuzzle = new THREE.Object3D();
  private readonly jeepMissileNoses: THREE.Mesh[] = [];
  private jeepJamCooldown = 0;
  /** The jeep's wheels (roll and steer) and steering wheel, animated as it drives. */
  private jeepParts!: JeepParts;
  private jeepSteer = 0;
  private readonly lastJeepPosition = new THREE.Vector3();

  constructor(world: RAPIER.World, spawnX: number, spawnZ: number, facingRadians = 0) {
    super(world, spawnX, spawnZ, PLAYER_MAX_HEALTH, ARMY_GREEN, facingRadians, 'player');
    this.fasterOnRoads = true;
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
    this.buildAAPod();
    this.tankParts = [...this.root.children];
    this.buildJeepRig();
  }

  // ---------- the jeep ----------

  /**
   * The toy jeep, with a rapid-fire jam gun and a twin missile pod on a post in the back and the
   * commander standing behind them. Built once and hidden until a changing station swaps it in.
   */
  private buildJeepRig(): void {
    this.jeepParts = buildJeepParts(ARMY_GREEN, { mountedGun: false, movingParts: true, driver: true });
    const model = this.jeepParts.group;
    model.scale.setScalar(JEEP_SCALE);
    model.position.y = -HULL_HALF_EXTENTS.y; // wheels on the ground under the collider
    this.jeepRig.add(model);

    const dark = plastic(shade(ARMY_GREEN, 0.6));
    const deep = plastic(shade(ARMY_GREEN, 0.35));
    const jam = new THREE.MeshPhysicalMaterial({ color: 0xe0294f, emissive: 0x5a0616, roughness: 0.1, clearcoat: 1 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xdff4ff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.35 });

    // Post up from the back seat, in the rig's (root) space.
    const deckY = -HULL_HALF_EXTENTS.y + 1.0 * JEEP_SCALE;
    const post = new PartBuilder();
    post.add(new THREE.CylinderGeometry(0.09, 0.12, 0.7, 10), deep, 0, deckY + 0.3, 1.0);
    post.add(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 16), dark, 0, deckY + 0.66, 1.0); // turntable
    post.buildInto(this.jeepRig);

    this.jeepMount.position.set(0, deckY + 0.72, 1.0);
    this.jeepRig.add(this.jeepMount);
    this.jeepMount.add(this.jeepTilt);

    // Jam gun: a big jar feeding a long barrel, and a twin missile pod on its left.
    const gun = new PartBuilder();
    gun.add(new THREE.BoxGeometry(0.2, 0.28, 0.5), dark, 0, 0.12, 0.05); // cradle
    gun.add(new THREE.CylinderGeometry(0.22, 0.22, 0.44, 16), glass, 0, 0.5, 0.2);
    gun.add(new THREE.CylinderGeometry(0.19, 0.19, 0.34, 16), jam, 0, 0.45, 0.2);
    gun.add(new THREE.CylinderGeometry(0.25, 0.25, 0.07, 16), plastic(0xe8e0d0), 0, 0.74, 0.2); // lid
    gun.add(tubeZ(0.08, 0.1, 1.3, 12), dark, 0, 0.2, -0.6); // barrel
    gun.add(tubeZ(0.12, 0.09, 0.16, 12), jam, 0, 0.2, -1.28); // jammy muzzle
    for (const z of [-0.2, -0.6]) gun.add(tubeZ(0.11, 0.11, 0.06, 12), deep, 0, 0.2, z); // barrel bands
    gun.add(new THREE.BoxGeometry(0.46, 0.34, 1.0), plastic(shade(ARMY_GREEN, 0.85)), -0.46, 0.22, -0.1); // missile pod
    gun.add(new THREE.BoxGeometry(0.5, 0.05, 1.04), dark, -0.46, 0.41, -0.1); // pod lid
    gun.add(new THREE.BoxGeometry(0.16, 0.12, 0.2), dark, -0.2, 0.18, -0.1); // pod bracket
    for (const [x, y] of JEEP_MISSILE_TUBES) gun.add(tubeZ(0.1, 0.1, 0.04, 12), deep, -0.46 + x, 0.22 + y, -0.6);
    gun.buildInto(this.jeepTilt);
    const red = plastic(0xd0463a);
    const nose = new THREE.ConeGeometry(0.085, 0.22, 12).rotateX(-Math.PI / 2);
    for (const [x, y] of JEEP_MISSILE_TUBES) {
      const m = new THREE.Mesh(nose, red);
      m.position.set(-0.46 + x, 0.22 + y, -0.68);
      m.castShadow = true;
      this.jeepTilt.add(m);
      this.jeepMissileNoses.push(m);
    }
    this.jeepMuzzle.position.set(0, 0.2, -1.4);
    this.jeepTilt.add(this.jeepMuzzle);
    this.jeepPodMuzzle.position.set(-0.46, 0.22, -0.9);
    this.jeepTilt.add(this.jeepPodMuzzle);

    // The commander rides along, standing behind the gun and turning with it.
    const gunner = Tank.createCommander(ARMY_GREEN);
    gunner.position.set(0, deckY - this.jeepMount.position.y, 0.55);
    this.jeepMount.add(gunner);

    this.jeepRig.visible = false;
    this.root.add(this.jeepRig);
  }

  get vehicle(): Vehicle {
    return this.vehicleMode;
  }

  get isJeep(): boolean {
    return this.vehicleMode === 'jeep';
  }

  /** Swaps the look, speed and guns (the body, collider, health and aim carry straight over). */
  setVehicle(vehicle: Vehicle): void {
    this.vehicleMode = vehicle;
    const jeep = vehicle === 'jeep';
    for (const part of this.tankParts) part.visible = !jeep;
    this.jeepRig.visible = jeep;
    this.turnRateScale = jeep ? JEEP_TURN_RATE : 1;
    this.lastJeepPosition.copy(this.position);
  }

  /** Rolls the jeep's wheels by how far it moved, and steers the front wheels (and the driver's wheel) into turns. */
  private animateJeep(dt: number, hullDelta: number): void {
    const moved = this.position.clone().sub(this.lastJeepPosition);
    this.lastJeepPosition.copy(this.position);
    if (moved.lengthSq() > 25) return; // a teleport home, not a drive
    const along = moved.dot(this.forward);
    for (const w of this.jeepParts.wheels) w.rotation.x -= along / (JEEP_WHEEL_RADIUS * JEEP_SCALE);
    // Positive yaw turns left; reversing steers the other way.
    const turn = dt > 0 ? clamp((hullDelta / dt) * 0.3, -0.45, 0.45) * (along < -0.01 ? -1 : 1) : 0;
    this.jeepSteer += (turn - this.jeepSteer) * Math.min(1, dt * 8);
    for (const pivot of this.jeepParts.steerPivots) pivot.rotation.y = this.jeepSteer;
    if (this.jeepParts.steeringWheel) this.jeepParts.steeringWheel.rotation.z = this.jeepSteer * 2.5;
  }

  private get maxSpeed(): number {
    return this.isJeep ? JEEP_MAX_SPEED : PLAYER_MAX_SPEED;
  }

  /** The jeep's missile pod shows red noses while a missile is ready. */
  setJeepMissilesReady(ready: boolean): void {
    for (const m of this.jeepMissileNoses) m.visible = ready;
  }

  /** Where a jeep missile leaves the pod, and which way (along the aim, lofted up a little). */
  get jeepMissileLaunch(): { origin: THREE.Vector3; direction: THREE.Vector3 } {
    const origin = this.jeepPodMuzzle.getWorldPosition(new THREE.Vector3());
    const direction = this.muzzleWorldDirection.add(new THREE.Vector3(0, 0.45, 0)).normalize();
    return { origin, direction };
  }

  /** Where the jeep's jam gun muzzle is (for the aim guide). */
  get jeepMuzzlePosition(): THREE.Vector3 {
    return this.jeepMuzzle.getWorldPosition(new THREE.Vector3());
  }

  /** The jeep's main gun: a stream of fast jam rounds along the aim while the trigger's held. */
  tryJeepJam(): { origin: THREE.Vector3; direction: THREE.Vector3 } | null {
    if (!this.isJeep || this.jeepJamCooldown > 0 || this.isGunJammed) return null;
    this.jeepJamCooldown = JEEP_JAM_INTERVAL;
    const direction = this.muzzleWorldDirection;
    direction.x += (Math.random() - 0.5) * JEEP_JAM_SPREAD;
    direction.y += (Math.random() - 0.5) * JEEP_JAM_SPREAD * 0.5;
    direction.z += (Math.random() - 0.5) * JEEP_JAM_SPREAD;
    return { origin: this.jeepMuzzlePosition, direction: direction.normalize() };
  }

  /** First person: hide the jeep's gun mount too, so the camera isn't inside the jam jar. */
  override setTurretHidden(hidden: boolean): void {
    super.setTurretHidden(hidden);
    this.jeepMount.visible = !hidden;
  }

  /** A six-tube anti-aircraft pod on the turret bustle, angled up; loaded tubes show red noses. */
  private buildAAPod(): void {
    this.aaPod.position.set(-0.42, 0.72, 0.8);
    this.aaPod.rotation.x = 0.55;
    this.turretPivot.add(this.aaPod);
    const dark = plastic(shade(ARMY_GREEN, 0.6));
    const deep = plastic(shade(ARMY_GREEN, 0.35));
    const p = new PartBuilder();
    p.add(new THREE.BoxGeometry(0.5, 0.34, 0.64), plastic(shade(ARMY_GREEN, 0.85)), 0, 0, 0);
    p.add(new THREE.BoxGeometry(0.54, 0.05, 0.68), dark, 0, 0.19, 0); // lid
    p.add(new THREE.BoxGeometry(0.1, 0.3, 0.12), dark, 0, -0.3, 0.12); // post down to the bustle
    for (const [x, y] of AA_TUBES) p.add(tubeZ(0.065, 0.065, 0.04, 10), deep, x, y, -0.32);
    p.buildInto(this.aaPod);
    const red = plastic(0xd0463a);
    const nose = new THREE.ConeGeometry(0.055, 0.14, 10).rotateX(-Math.PI / 2);
    for (const [x, y] of AA_TUBES) {
      const m = new THREE.Mesh(nose, red);
      m.position.set(x, y, -0.36);
      this.aaPod.add(m);
      this.aaNoses.push(m);
    }
    this.aaMuzzle.position.set(0, 0, -0.5);
    this.aaPod.add(this.aaMuzzle);
  }

  /** Shows how many AA missiles are still in the pod. */
  setAALoaded(count: number): void {
    this.aaNoses.forEach((m, i) => (m.visible = i < count));
  }

  /**
   * Where the next AA missile leaves the pod, and which way (up and out along the turret). The
   * jeep fires them from its missile pod.
   */
  get aaLaunch(): { origin: THREE.Vector3; direction: THREE.Vector3 } {
    if (this.isJeep) {
      const { origin, direction } = this.jeepMissileLaunch;
      return { origin, direction: direction.add(new THREE.Vector3(0, 0.5, 0)).normalize() };
    }
    const origin = this.aaMuzzle.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.aaPod.getWorldQuaternion(new THREE.Quaternion()));
    return { origin, direction };
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
    const muzzle = this.isJeep ? this.jeepMuzzle : this.jamMuzzle;
    return { origin: muzzle.getWorldPosition(new THREE.Vector3()), direction: direction.normalize(), speedScale: 0.62 + 0.45 * t };
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
      else this.drive(input.throttle, input.steer, dt, this.maxSpeed);
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
    this.jeepMount.rotation.y = this.barrelYaw;
    this.jeepTilt.rotation.x = this.barrelPitch;
    this.jeepJamCooldown = Math.max(0, this.jeepJamCooldown - dt);
    if (this.isJeep) this.animateJeep(dt, hullDelta);
    this.update(dt);

    // The jeep has no cannon: its trigger fires the jam gun instead (see tryJeepJam).
    return input.firing && !this.isJeep ? this.tryFire() : null;
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
    this.drive(throttle, steer, dt, this.maxSpeed);
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
    this.drive(throttle, steer, dt, this.maxSpeed);
  }

  /** Once the stick has been left alone for a moment, turn the nose to face the camera. */
  private alignToCamera(dt: number): void {
    const err = wrap(this.turretWorldYaw - this.yaw);
    const aligning = this.idleTime > ALIGN_DELAY && Math.abs(err) > ALIGN_DEADBAND;
    const steer = aligning ? clamp(-err * 2, -1, 1) * ALIGN_TURN_RATE : 0;
    this.drive(0, steer, dt, this.maxSpeed);
    if (!aligning) this.driveDir = 1;
  }
}
