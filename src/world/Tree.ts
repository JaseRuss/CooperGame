import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { HitRegistry } from '../combat/HitRegistry';

const COLLIDER_RELEASE_ANGLE = (65 * Math.PI) / 180;

/** How big a toppling thing is and how it goes over. */
export interface ToppleSize {
  colliderRadius: number;
  colliderHalfHeight: number;
  /** A tank this close (centre to base) knocks it over. */
  triggerRadius: number;
  fallDuration: number;
}

export const TREE_SIZE: ToppleSize = { colliderRadius: 2.2, colliderHalfHeight: 2.8, triggerRadius: 4.8, fallDuration: 0.8 };
/** Lamp posts: a thin pole that snaps over quickly. */
export const LAMP_SIZE: ToppleSize = { colliderRadius: 0.35, colliderHalfHeight: 3, triggerRadius: 3.2, fallDuration: 0.55 };

/**
 * A tree (or lamp post) with a trunk collider that falls over, away from the tank, when a tank
 * drives into it.
 */
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
    private readonly size: ToppleSize = TREE_SIZE,
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
      RAPIER.ColliderDesc.cylinder(size.colliderHalfHeight, size.colliderRadius).setTranslation(x, y + size.colliderHalfHeight, z),
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
        if (dx * dx + dz * dz > this.size.triggerRadius * this.size.triggerRadius) continue;
        this.falling = true;
        if (Math.hypot(dx, dz) < 1e-4) this.fallAxis.set(1, 0, 0);
        else this.fallAxis.set(-dz, 0, dx).normalize();
        break;
      }
    }

    if (!this.falling || this.fallT >= this.size.fallDuration) return;
    this.fallT = Math.min(this.size.fallDuration, this.fallT + dt);
    const progress = this.fallT / this.size.fallDuration;
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
