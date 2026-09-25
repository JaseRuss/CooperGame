import type RAPIER from '@dimforge/rapier3d-compat';
import type { Tank } from '../entities/Tank';
import type { Building } from '../world/Building';

export type HitTarget =
  | { kind: 'tank'; tank: Tank }
  | { kind: 'building'; building: Building }
  | { kind: 'terrain' }
  | { kind: 'water' };

/** Maps Rapier collider handles to the game entity they belong to, for raycast hit resolution. */
export class HitRegistry {
  private map = new Map<number, HitTarget>();

  register(collider: RAPIER.Collider, target: HitTarget): void {
    this.map.set(collider.handle, target);
  }

  unregister(collider: RAPIER.Collider): void {
    this.map.delete(collider.handle);
  }

  lookup(collider: RAPIER.Collider): HitTarget | undefined {
    return this.map.get(collider.handle);
  }
}
