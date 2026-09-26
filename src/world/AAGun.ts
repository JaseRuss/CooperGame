import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Building } from './Building';
import type { HitRegistry } from '../combat/HitRegistry';
import { plantBuilding } from './placeModel';
import { PartBuilder, sandbagGeometry, tubeZ } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';

const AA_GUN_HEALTH = 50; // two shells
const SLEW_RATE = 2.2; // rad/s round
const ELEVATE_RATE = 1.4; // rad/s up and down
const IDLE_PITCH = 0.9;

/**
 * An enemy base's quad-barrelled flak gun (night mission): a sandbagged pit with a turntable,
 * a gunner's seat and four long barrels. It's what hoses the tracer up into the night sky, and
 * one of the base's targets.
 */
export class AAGun {
  readonly building: Building;
  private readonly mount = new THREE.Group();
  private readonly cradle = new THREE.Group();
  private readonly muzzlePoint = new THREE.Object3D();
  private yaw = Math.random() * Math.PI * 2;
  private pitch = IDLE_PITCH;
  private targetYaw = this.yaw;
  private targetPitch = IDLE_PITCH;
  private idleTimer = 0;

  constructor(world: RAPIER.World, scene: THREE.Scene, hitRegistry: HitRegistry, x: number, z: number, color: number) {
    const body = plastic(color);
    const dark = plastic(shade(color, 0.6));
    const metal = plastic(0x4f5450);
    const bags = plastic(shade(color, 0.85));
    const root = new THREE.Group();

    // Sandbag ring (with a gap to get in) round a concrete plinth.
    const pit = new PartBuilder();
    // Each bag lies along the ring (its length on local X, turned to the tangent), rows staggered
    // like brickwork and stepping in slightly as they go up.
    const bag = sandbagGeometry(0.7, 0.28);
    const perRow = 22;
    for (let row = 0; row < 3; row++) {
      const r = 4.3 - row * 0.12;
      for (let i = 1; i < perRow - 1; i++) {
        const a = ((i + (row % 2) * 0.5) / perRow) * Math.PI * 2; // i = 0 and the last leave a way in
        pit.add(bag, bags, Math.sin(a) * r, 0.2 + row * 0.38, Math.cos(a) * r, 0, a);
      }
    }
    pit.add(new THREE.CylinderGeometry(2.3, 2.5, 0.6, 20), plastic(0x9a9486), 0, 0.3, 0);
    for (const [bx, bz] of [[-3, -1.6], [-3, 0.2], [3.1, 1.2]]) pit.add(new THREE.BoxGeometry(0.9, 0.55, 0.6), dark, bx, 0.28, bz); // ammo crates
    pit.buildInto(root);

    // Turntable, gun cheeks and the gunner's seat: turns round on the mount.
    this.mount.position.y = 0.6;
    this.mount.rotation.y = this.yaw;
    root.add(this.mount);
    const turn = new PartBuilder();
    turn.add(new THREE.CylinderGeometry(1.7, 1.8, 0.35, 20), metal, 0, 0.18, 0);
    for (const s of [-1, 1]) {
      turn.add(new THREE.BoxGeometry(0.18, 1.5, 1.6), body, s * 0.95, 1.05, 0);
      turn.add(new THREE.BoxGeometry(0.5, 0.5, 0.7), dark, s * 1.35, 1.2, 0.3); // ammo drums
    }
    turn.add(new THREE.BoxGeometry(0.7, 0.12, 0.6), dark, 0, 0.8, 1.35); // seat
    turn.add(new THREE.BoxGeometry(0.7, 0.7, 0.1), dark, 0, 1.15, 1.65);
    turn.add(new THREE.BoxGeometry(1.8, 1.0, 0.08), metal, 0, 1.4, -0.9, -0.35); // splinter shield
    turn.buildInto(this.mount);

    // Four barrels in a square, on the cradle that elevates them.
    this.cradle.position.y = 1.45;
    this.mount.add(this.cradle);
    const guns = new PartBuilder();
    guns.add(new THREE.BoxGeometry(1.4, 0.9, 1.3), body, 0, 0, 0.1);
    for (const gx of [-0.34, 0.34]) {
      for (const gy of [-0.24, 0.24]) {
        guns.add(tubeZ(0.07, 0.09, 3.2, 8), metal, gx, gy, -1.9);
        guns.add(tubeZ(0.12, 0.12, 0.35, 8), dark, gx, gy, -3.3); // flash hider
      }
    }
    guns.buildInto(this.cradle);
    this.muzzlePoint.position.set(0, 0, -3.5);
    this.cradle.add(this.muzzlePoint);
    this.cradle.rotation.x = this.pitch;

    this.building = plantBuilding(world, scene, hitRegistry, root, x, z, 0, 1, AA_GUN_HEALTH, color);
  }

  get alive(): boolean {
    return !this.building.destroyed;
  }

  get position(): THREE.Vector3 {
    return this.building.center;
  }

  /** The end of the barrels, in world space. */
  get muzzle(): THREE.Vector3 {
    return this.muzzlePoint.getWorldPosition(new THREE.Vector3());
  }

  /** Which way the barrels point right now, in world space. */
  get barrelDirection(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.cradle.getWorldQuaternion(new THREE.Quaternion()));
  }

  /** Swings the barrels round to fire along `dir`. */
  aimAlong(dir: THREE.Vector3): void {
    this.targetYaw = Math.atan2(-dir.x, -dir.z);
    this.targetPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.idleTimer = 4;
  }

  update(dt: number): void {
    if (!this.alive) return;
    // Between bursts it scans the sky slowly.
    this.idleTimer -= dt;
    if (this.idleTimer <= 0) {
      this.idleTimer = 3 + Math.random() * 3;
      this.targetYaw = this.yaw + (Math.random() - 0.5) * 2;
      this.targetPitch = 0.6 + Math.random() * 0.6;
    }
    const dYaw = Math.atan2(Math.sin(this.targetYaw - this.yaw), Math.cos(this.targetYaw - this.yaw));
    this.yaw += THREE.MathUtils.clamp(dYaw, -SLEW_RATE * dt, SLEW_RATE * dt);
    this.pitch += THREE.MathUtils.clamp(this.targetPitch - this.pitch, -ELEVATE_RATE * dt, ELEVATE_RATE * dt);
    this.mount.rotation.y = this.yaw;
    this.cradle.rotation.x = this.pitch;
  }
}
