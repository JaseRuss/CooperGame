import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank, HULL_HALF_EXTENTS } from './Tank';
import { buildJeepParts } from '../world/Vehicles';
import { heightAt } from '../world/Terrain';

/** One tank shell kills it; a few rifle rounds from the gunners on the tanker do too. */
const JEEP_HEALTH = 12;
const JEEP_SCALE = 1.25;
const WHEEL_RADIUS = 0.42 * JEEP_SCALE;

/**
 * A raider's jeep for the bomb tanker's run. It is a Tank underneath, so shells and bullets hit
 * it like any other vehicle, but it has no driving of its own: the run steers it with `place`.
 */
export class EnemyJeep extends Tank {
  /** Which way it is moving (metres per second), for the gunners to lead their shots. */
  readonly velocity = new THREE.Vector3();
  /** The wheels' roll, so they turn as it goes. */
  private readonly wheelPivots: THREE.Object3D[] = [];
  private roll = 0;
  private readonly last = new THREE.Vector3();

  constructor(world: RAPIER.World, x: number, z: number, color: number, yaw: number) {
    super(world, x, z, JEEP_HEALTH, color, yaw, 'enemy', false);
    const parts = buildJeepParts(color, { mountedGun: true, driver: true, movingParts: true });
    this.wheelPivots.push(...parts.wheels);
    const model = parts.group;
    model.scale.setScalar(JEEP_SCALE);
    model.position.y = -HULL_HALF_EXTENTS.y;
    this.root.add(model);
    this.last.copy(this.root.position);
  }

  /** Puts the jeep on the ground at (x, z), heading `yaw`, and works out how fast that is. */
  place(x: number, z: number, yaw: number, dt: number): void {
    const y = heightAt(x, z) + HULL_HALF_EXTENTS.y + 0.05;
    this.last.copy(this.root.position);
    this.teleportTo(x, y, z, yaw);
    if (dt > 0) this.velocity.copy(this.root.position).sub(this.last).divideScalar(dt);
    this.roll += (this.velocity.length() * dt) / WHEEL_RADIUS;
    for (const w of this.wheelPivots) w.rotation.x = -this.roll;
    this.update(dt);
  }

  private teleportTo(x: number, y: number, z: number, yaw: number): void {
    this.teleport(x, z, yaw);
    this.root.position.y = y;
    this.body.setTranslation({ x, y, z }, true);
  }
}
