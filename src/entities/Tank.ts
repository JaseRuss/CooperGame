import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { heightAt, waterDepthAt } from '../world/Terrain';
import { clamp } from '../utils/math';
import { plastic, shade } from '../utils/plastic';

export const HULL_HALF_EXTENTS = { x: 1.15, y: 0.5, z: 1.9 };
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export type ArmorZone = 'front' | 'side' | 'rear';
/** Thick glacis up front, thin engine deck at the back. */
export const ARMOR_MULTIPLIER: Record<ArmorZone, number> = { front: 0.5, side: 1, rear: 2 };
const FRONT_ARC = (40 * Math.PI) / 180;
const REAR_ARC = (135 * Math.PI) / 180;
const MAX_YAW_RATE = 1.7; // rad/s at full steer
const BARREL_PITCH_MIN = -0.1;
const BARREL_PITCH_MAX = 0.38;
const GROUND_SEEK = 6; // m/s downward search bias fed to the character controller

/** Shared hull+turret+barrel tank rig: visuals, kinematic movement/collision, health, firing. */
export class Tank {
  readonly root = new THREE.Group();
  readonly turretPivot = new THREE.Group();
  readonly barrelPivot = new THREE.Group();
  readonly muzzle = new THREE.Object3D();

  health: number;
  readonly maxHealth: number;
  alive = true;

  fireCooldown = 0;
  readonly fireInterval: number = 1.6;
  readonly muzzleSpeed: number = 160;
  readonly shellDamage: number = 26;

  protected barrelYaw = 0;
  protected barrelPitch = 0.04;
  /**
   * Hull heading, kept as its own accumulator. Reading root.rotation.y back is unreliable:
   * once the heading passes ±90° three.js re-decomposes it as (π, π-yaw, π).
   */
  private hullYaw = 0;

  protected body: RAPIER.RigidBody;
  protected controller: RAPIER.KinematicCharacterController;
  protected collider: RAPIER.Collider;

  constructor(
    protected world: RAPIER.World,
    spawnX: number,
    spawnZ: number,
    maxHealth: number,
    plasticColor: number,
    facingRadians = 0,
  ) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;

    const groundY = heightAt(spawnX, spawnZ) + HULL_HALF_EXTENTS.y;
    this.root.position.set(spawnX, groundY, spawnZ);
    this.hullYaw = facingRadians;
    this.root.quaternion.setFromAxisAngle(Y_AXIS, facingRadians);
    this.buildVisuals(plasticColor);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawnX,
      groundY,
      spawnZ,
    );
    this.body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      HULL_HALF_EXTENTS.x,
      HULL_HALF_EXTENTS.y,
      HULL_HALF_EXTENTS.z,
    );
    this.collider = world.createCollider(colliderDesc, this.body);

    this.controller = world.createCharacterController(0.04);
    this.controller.enableAutostep(0.35, 0.15, true);
    this.controller.enableSnapToGround(1.0);
    this.controller.setMaxSlopeClimbAngle((65 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((75 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(1400);
  }

  /** A one-colour moulded plastic toy tank, like the ones in a bag of army men. */
  private buildVisuals(color: number): void {
    const body = plastic(color);
    const dark = plastic(shade(color, 0.72));

    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // Hull: lower tub, upper deck and a sloped glacis plate.
    part(new THREE.BoxGeometry(2.1, 0.62, 3.7), body, this.root, 0, -0.14, 0);
    part(new THREE.BoxGeometry(2.3, 0.34, 3.1), body, this.root, 0, 0.3, 0.2);
    const glacis = part(new THREE.BoxGeometry(2.1, 0.12, 1.0), body, this.root, 0, 0.18, -1.72);
    glacis.rotation.x = 0.55;
    part(new THREE.BoxGeometry(1.6, 0.18, 0.5), body, this.root, 0, 0.5, 1.35); // engine deck

    // Tracks, fenders and road wheels on each side.
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.14, 14).rotateZ(Math.PI / 2);
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.5, 0.72, 4.05), dark, this.root, side * 1.28, -0.16, 0);
      part(new THREE.BoxGeometry(0.62, 0.06, 4.15), body, this.root, side * 1.3, 0.24, 0);
      for (let i = 0; i < 5; i++) part(wheelGeo, body, this.root, side * 1.55, -0.24, -1.5 + i * 0.75);
      part(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8).rotateX(Math.PI / 2), dark, this.root, side * 0.55, 0.45, 1.95); // exhaust
    }

    this.turretPivot.position.set(0, HULL_HALF_EXTENTS.y + 0.02, 0.15);
    this.root.add(this.turretPivot);

    // Rounded cast turret with a mantlet, hatch and hatch-mounted machine gun.
    part(new THREE.CylinderGeometry(0.72, 0.92, 0.6, 16), body, this.turretPivot, 0, 0.3, 0);
    part(new THREE.BoxGeometry(1.2, 0.34, 0.7), body, this.turretPivot, 0, 0.28, 0.75); // bustle
    part(new THREE.BoxGeometry(0.7, 0.46, 0.34), body, this.turretPivot, 0, 0.3, -0.82); // mantlet
    part(new THREE.CylinderGeometry(0.24, 0.26, 0.12, 14), dark, this.turretPivot, 0.28, 0.66, 0.2); // hatch
    const mg = part(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6).rotateX(Math.PI / 2), dark, this.turretPivot, 0.28, 0.82, -0.05);
    mg.rotation.y = 0.1;

    this.barrelPivot.position.set(0, 0.3, -0.95);
    this.turretPivot.add(this.barrelPivot);
    part(new THREE.CylinderGeometry(0.09, 0.12, 2.3, 12).rotateX(Math.PI / 2), body, this.barrelPivot, 0, 0, -1.15);
    part(new THREE.CylinderGeometry(0.15, 0.15, 0.32, 12).rotateX(Math.PI / 2), dark, this.barrelPivot, 0, 0, -2.2); // muzzle brake

    this.muzzle.position.set(0, 0, -2.4);
    this.barrelPivot.add(this.muzzle);

    this.applyAim();
  }

  private applyAim(): void {
    this.turretPivot.rotation.y = this.barrelYaw;
    // +X rotation tips the -Z barrel upward, so positive pitch = barrel up.
    this.barrelPivot.rotation.x = this.barrelPitch;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion);
  }

  get muzzleWorldPosition(): THREE.Vector3 {
    const v = new THREE.Vector3();
    this.muzzle.getWorldPosition(v);
    return v;
  }

  get muzzleWorldDirection(): THREE.Vector3 {
    const q = new THREE.Quaternion();
    this.barrelPivot.getWorldQuaternion(q);
    return new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  }

  get turretWorldYaw(): number {
    return this.hullYaw + this.barrelYaw;
  }

  /** Hull heading in radians; 0 faces -Z, positive turns left. */
  get yaw(): number {
    return this.hullYaw;
  }

  get aimPitch(): number {
    return this.barrelPitch;
  }

  /** Hide the turret body (keeping the barrel) so a first-person camera doesn't clip into it. */
  setTurretHidden(hidden: boolean): void {
    for (const child of this.turretPivot.children) {
      if (child !== this.barrelPivot) child.visible = !hidden;
    }
  }

  get isDestroyed(): boolean {
    return this.health <= 0;
  }

  get physicsCollider(): RAPIER.Collider {
    return this.collider;
  }

  /** Which armour face a world-space hit point lands on, judged from the hull's heading. */
  hitZone(point: THREE.Vector3): ArmorZone {
    const local = point.clone().sub(this.position).applyAxisAngle(Y_AXIS, -this.hullYaw);
    const offNose = Math.abs(Math.atan2(local.x, -local.z)); // 0 = dead ahead, π = dead astern
    if (offNose < FRONT_ARC) return 'front';
    if (offNose > REAR_ARC) return 'rear';
    return 'side';
  }

  /** Applies damage, scaled by armour when the hit point is known. Returns the face that was hit. */
  takeDamage(amount: number, hitPoint?: THREE.Vector3): ArmorZone | null {
    if (!this.alive) return null;
    const zone = hitPoint ? this.hitZone(hitPoint) : null;
    this.health = Math.max(0, this.health - amount * (zone ? ARMOR_MULTIPLIER[zone] : 1));
    return zone;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** Rotate the turret/barrel by the given deltas (radians), clamping barrel pitch. */
  protected aim(yawDelta: number, pitchDelta: number): void {
    this.barrelYaw += yawDelta;
    this.barrelPitch = clamp(this.barrelPitch + pitchDelta, BARREL_PITCH_MIN, BARREL_PITCH_MAX);
    this.applyAim();
  }

  /** Point the turret at a world-space target, at an angular rate limited by radPerSec. */
  protected aimToward(targetWorld: THREE.Vector3, radPerSec: number, dt: number): void {
    const toTarget = new THREE.Vector3().subVectors(targetWorld, this.muzzleWorldPosition);
    const localDir = toTarget.clone().applyQuaternion(this.root.quaternion.clone().invert());
    const desiredYaw = Math.atan2(-localDir.x, -localDir.z);
    const flatDist = Math.sqrt(localDir.x * localDir.x + localDir.z * localDir.z);
    const desiredPitch = clamp(Math.atan2(localDir.y, flatDist), BARREL_PITCH_MIN, BARREL_PITCH_MAX);

    let yawDelta = desiredYaw - this.barrelYaw;
    yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
    const maxStep = radPerSec * dt;
    this.barrelYaw += clamp(yawDelta, -maxStep, maxStep);

    let pitchDelta = desiredPitch - this.barrelPitch;
    pitchDelta = clamp(pitchDelta, -maxStep, maxStep);
    this.barrelPitch = clamp(this.barrelPitch + pitchDelta, BARREL_PITCH_MIN, BARREL_PITCH_MAX);
    this.applyAim();
  }

  /** True once the turret is aimed within `tolerance` radians of the target direction. */
  protected isAimedAt(targetWorld: THREE.Vector3, tolerance: number): boolean {
    const toTarget = new THREE.Vector3().subVectors(targetWorld, this.muzzleWorldPosition).normalize();
    const aimDir = this.muzzleWorldDirection;
    return aimDir.angleTo(toTarget) < tolerance;
  }

  /** Drive the hull for this frame using skid-steer kinematics; handles terrain + obstacle collision. */
  protected drive(throttle: number, steer: number, dt: number, maxSpeed: number): void {
    const turnAuthority = 0.75 + 0.25 * Math.abs(throttle);
    this.hullYaw -= steer * MAX_YAW_RATE * dt * turnAuthority;
    this.hullYaw = Math.atan2(Math.sin(this.hullYaw), Math.cos(this.hullYaw));
    this.root.quaternion.setFromAxisAngle(Y_AXIS, this.hullYaw);

    const wading = waterDepthAt(this.root.position.x, this.root.position.z) > 0.4;
    const speed = throttle * maxSpeed * (wading ? 0.5 : 1);
    const fwd = this.forward;
    const desired = new THREE.Vector3(fwd.x * speed * dt, -GROUND_SEEK * dt, fwd.z * speed * dt);

    this.controller.computeColliderMovement(this.collider, desired);
    const corrected = this.controller.computedMovement();
    const t = this.body.translation();
    const newPos = new THREE.Vector3(t.x + corrected.x, t.y + corrected.y, t.z + corrected.z);

    // A kinematic body under the one-sided heightfield can never climb back out, so recover it.
    const floorY = heightAt(newPos.x, newPos.z) + HULL_HALF_EXTENTS.y;
    if (newPos.y < floorY - 1.5) newPos.y = floorY + 0.2;

    this.body.setNextKinematicTranslation(newPos);

    this.body.setNextKinematicRotation(this.root.quaternion);
    this.root.position.copy(newPos);
  }

  teleport(x: number, z: number, facingRadians = this.hullYaw): void {
    const y = heightAt(x, z) + HULL_HALF_EXTENTS.y + 0.2;
    this.hullYaw = facingRadians;
    this.root.quaternion.setFromAxisAngle(Y_AXIS, facingRadians);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(this.root.quaternion, true);
    this.root.position.set(x, y, z);
  }

  /** Attempt to fire; returns muzzle world position/direction if a shot was fired. */
  tryFire(): { origin: THREE.Vector3; direction: THREE.Vector3 } | null {
    if (this.fireCooldown > 0 || !this.alive) return null;
    this.fireCooldown = this.fireInterval;
    return { origin: this.muzzleWorldPosition, direction: this.muzzleWorldDirection };
  }

  update(dt: number): void {
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
