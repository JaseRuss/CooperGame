import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Projectile, type ImpactResult } from './Projectile';
import type { HitRegistry } from './HitRegistry';

export class ProjectileManager {
  private readonly projectiles: Projectile[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: RAPIER.World,
    private readonly hitRegistry: HitRegistry,
  ) {}

  spawn(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    damage: number,
    shooterCollider: RAPIER.Collider | undefined,
    onImpact?: (point: THREE.Vector3, result: ImpactResult) => void,
    visualScale = 1,
  ): void {
    this.projectiles.push(
      new Projectile(this.scene, origin, direction, speed, damage, shooterCollider, onImpact, visualScale),
    );
  }

  update(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt, this.world, this.hitRegistry);
      if (p.dead) this.projectiles.splice(i, 1);
    }
  }

  get activeCount(): number {
    return this.projectiles.length;
  }
}
