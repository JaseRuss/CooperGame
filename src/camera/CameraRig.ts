import * as THREE from 'three';
import type { Tank } from '../entities/Tank';
import { damp } from '../utils/math';

export type CameraMode = 'third' | 'first';

const THIRD_PERSON_OFFSET = new THREE.Vector3(0, 4.6, 9.2);
const THIRD_PERSON_LOOK_OFFSET = new THREE.Vector3(0, 1.6, 0);
const FOLLOW_LAMBDA = 8;
const MAX_CAMERA_DIP_PITCH = 0.38;
/**
 * Chasing the chopper: this far back along the aim and this far above it (square to the aim), so
 * the camera looks straight down the shot with the chopper below the middle of the view rather
 * than in front of whatever it's aiming at.
 */
const AIR_CHASE_DISTANCE = 19;
const AIR_CHASE_RISE = 6.5;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Switchable third-person chase cam / first-person gunner-sight cam following the player tank,
 * plus a free "cinematic" mode (rocket cam, explosion orbit) driven by the game.
 */
export class CameraRig {
  mode: CameraMode = 'third';
  private readonly currentPos = new THREE.Vector3();
  private readonly currentLook = new THREE.Vector3();
  private initialized = false;
  private inCinematic = false;
  private shake = 0;
  /** Chase the chopper (see AIR_CHASE_DISTANCE) rather than a tank. */
  private aerial = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Adds camera shake; decays over roughly half a second. */
  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Switches the chase cam between following a tank or jeep and following the chopper. */
  setAerial(aerial: boolean): void {
    this.aerial = aerial;
  }

  toggle(): void {
    this.mode = this.mode === 'third' ? 'first' : 'third';
    if (this.mode === 'third') this.initialized = false;
  }

  update(target: Tank, dt: number): void {
    this.inCinematic = false;
    target.setTurretHidden(this.mode === 'first');
    if (this.mode === 'third') this.updateThirdPerson(target, dt);
    else this.updateFirstPerson(target);
    this.applyShake(dt);
  }

  /**
   * Eases the camera toward an arbitrary position/look target. Blends in from wherever the
   * camera currently is, and the regular chase cam blends back out afterwards.
   */
  updateCinematic(desiredPos: THREE.Vector3, desiredLook: THREE.Vector3, dt: number, lambda: number): void {
    if (!this.inCinematic) {
      this.inCinematic = true;
      this.currentPos.copy(this.camera.position);
      this.currentLook.copy(this.camera.position).add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10));
      this.initialized = true;
    }
    this.dampToward(desiredPos, desiredLook, lambda, dt);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
    this.applyShake(dt);
  }

  private applyShake(dt: number): void {
    if (this.shake <= 0.001) return;
    const s = this.shake * this.shake;
    this.camera.position.x += (Math.random() - 0.5) * s * 0.8;
    this.camera.position.y += (Math.random() - 0.5) * s * 0.8;
    this.camera.rotateZ((Math.random() - 0.5) * s * 0.04);
    this.shake *= Math.exp(-6 * dt);
  }

  private dampToward(pos: THREE.Vector3, look: THREE.Vector3, lambda: number, dt: number): void {
    this.currentPos.set(
      damp(this.currentPos.x, pos.x, lambda, dt),
      damp(this.currentPos.y, pos.y, lambda, dt),
      damp(this.currentPos.z, pos.z, lambda, dt),
    );
    this.currentLook.set(
      damp(this.currentLook.x, look.x, lambda, dt),
      damp(this.currentLook.y, look.y, lambda, dt),
      damp(this.currentLook.z, look.z, lambda, dt),
    );
  }

  private updateThirdPerson(target: Tank, dt: number): void {
    // Orbit behind the turret (not the hull) so aiming with the right stick/mouse swings the view.
    const yaw = target.turretWorldYaw;
    const aimQuat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const behind = THIRD_PERSON_OFFSET.clone().applyQuaternion(aimQuat);
    const desiredPos = target.position.clone().add(behind);
    // Dip the camera as the barrel raises, to look up the shot; capped so steep anti-aircraft
    // elevation doesn't drag the camera down into the ground behind the tank.
    desiredPos.y -= Math.min(target.aimPitch, MAX_CAMERA_DIP_PITCH) * 6;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(aimQuat);
    const desiredLook = target.position
      .clone()
      .add(THIRD_PERSON_LOOK_OFFSET)
      .addScaledVector(forward, 12)
      .add(new THREE.Vector3(0, Math.tan(target.aimPitch) * 12, 0));

    if (this.aerial) {
      // Straight down the aim; "up" here is the camera's own up, square to the aim.
      const pitch = target.aimPitch;
      const aim = forward.clone().multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch));
      const up = forward.clone().multiplyScalar(-Math.sin(pitch)).setY(Math.cos(pitch));
      desiredPos.copy(target.position).addScaledVector(aim, -AIR_CHASE_DISTANCE).addScaledVector(up, AIR_CHASE_RISE);
      desiredPos.y = Math.max(desiredPos.y, target.position.y + 1); // never down in the ground on take-off
      desiredLook.copy(desiredPos).addScaledVector(aim, 30);
    }

    if (!this.initialized) {
      this.currentPos.copy(desiredPos);
      this.currentLook.copy(desiredLook);
      this.initialized = true;
    } else {
      this.dampToward(desiredPos, desiredLook, FOLLOW_LAMBDA, dt);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
  }

  private updateFirstPerson(target: Tank): void {
    this.camera.position.copy(target.firstPersonEye());
    target.barrelPivot.getWorldQuaternion(this.camera.quaternion);
  }
}
