import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { HitRegistry } from '../combat/HitRegistry';

const COLLIDER_RADIUS = 2.2;
const COLLIDER_HALF_HEIGHT = 2.8;
const FALL_DURATION = 0.8;
const FALL_TRIGGER_RADIUS = 4.8;
const COLLIDER_RELEASE_ANGLE = (65 * Math.PI) / 180;

/** A tree with a trunk collider that falls over when a tank drives into it. */
export class Tree {
  private readonly pivot = new THREE.Group();
  private fallAxis = new THREE.Vector3(1, 0, 0);
  private fallT = 0;
  private falling = false;
  private collider: RAPIER.Collider | null;
  private readonly yaw: number;

  constructor(
    private readonly world: RAPIER.World,
    private readonly hitRegistry: HitRegistry,
    staticBody: RAPIER.RigidBody,
    scene: THREE.Scene,
    visual: THREE.Object3D | null,
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number,
    private readonly applyInstanceTransform?: (transform: THREE.Matrix4) => void,
  ) {
    this.yaw = yaw;
    this.pivot.position.set(x, y, z);
    this.pivot.scale.setScalar(scale);
    if (visual) {
      visual.rotation.y = yaw;
      visual.position.set(0, 0, 0);
      this.pivot.add(visual);
      scene.add(this.pivot);
    }

    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(COLLIDER_HALF_HEIGHT, COLLIDER_RADIUS).setTranslation(x, y + COLLIDER_HALF_HEIGHT, z),
      staticBody,
    );
    hitRegistry.register(this.collider, { kind: 'tree' });
    this.syncInstance(0);
  }

  /** Start falling when a tank reaches the trunk, then ease the tree down to the ground. */
  update(dt: number, tankPositions: readonly THREE.Vector3[]): void {
    if (!this.falling) {
      for (const tank of tankPositions) {
        const dx = tank.x - this.pivot.position.x;
        const dz = tank.z - this.pivot.position.z;
        if (dx * dx + dz * dz > FALL_TRIGGER_RADIUS * FALL_TRIGGER_RADIUS) continue;
        this.falling = true;
        if (Math.hypot(dx, dz) < 1e-4) this.fallAxis.set(1, 0, 0);
        else this.fallAxis.set(-dz, 0, dx).normalize();
        break;
      }
    }

    if (!this.falling || this.fallT >= FALL_DURATION) return;
    this.fallT = Math.min(FALL_DURATION, this.fallT + dt);
    const progress = this.fallT / FALL_DURATION;
    const eased = progress * progress * (3 - 2 * progress);
    this.pivot.quaternion.setFromAxisAngle(this.fallAxis, eased * Math.PI / 2);
    this.syncInstance(eased);
    if (eased * Math.PI / 2 >= COLLIDER_RELEASE_ANGLE && this.collider) {
      this.hitRegistry.unregister(this.collider);
      this.world.removeCollider(this.collider, false);
      this.collider = null;
    }
  }

  private syncInstance(progress: number): void {
    if (!this.applyInstanceTransform) return;
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const fall = new THREE.Quaternion().setFromAxisAngle(this.fallAxis, progress * Math.PI / 2);
    this.applyInstanceTransform(new THREE.Matrix4().compose(
      this.pivot.position,
      fall.multiply(yaw),
      this.pivot.scale,
    ));
  }
}
