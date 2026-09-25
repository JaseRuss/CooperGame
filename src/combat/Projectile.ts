import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { HitRegistry } from './HitRegistry';
import { isUnderwater } from '../world/Terrain';
import type { Building } from '../world/Building';
import type { Tank, ArmorZone, Faction } from '../entities/Tank';

export interface ImpactResult {
  /** Set when this hit brought a building down. */
  collapsedBuilding: Building | null;
  /** Set when this hit struck a tank's armour. */
  tankHit: { tank: Tank; zone: ArmorZone } | null;
  /** The shot landed in a lake. */
  water: boolean;
  /** The shot struck a tree trunk. */
treeHit: boolean;
  /** Name of the weak point hit ("Gun slit", "Missile"), when it was a critical hit. */
  critical: string | null;
}

const GRAVITY = -9;
const MAX_LIFETIME = 8;
const MAX_RANGE = 900;

const SHELL_GEOMETRY = new THREE.SphereGeometry(0.16, 8, 6);
const SHELL_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffd27a });

export interface Trajectory {
  /** Points along the flight path, from the muzzle to the impact. */
  points: THREE.Vector3[];
  impact: THREE.Vector3;
  /** Surface normal at the impact, or null if the shell runs out of range in mid-air. */
  normal: THREE.Vector3 | null;
  /** Ground distance from the muzzle to the impact, meters. */
  range: number;
  hitCollider: RAPIER.Collider | null;
}

/** Traces a shell's arc exactly as Projectile will fly it, stopping at the first thing it hits. */
export function predictTrajectory(
  world: RAPIER.World,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  speed: number,
  excludeCollider: RAPIER.Collider,
): Trajectory {
  const step = 1 / 30;
  const pos = origin.clone();
  const vel = direction.clone().normalize().multiplyScalar(speed);
  const dir = new THREE.Vector3();
  const points = [pos.clone()];
  let traveled = 0;
  let normal: THREE.Vector3 | null = null;
  let hitCollider: RAPIER.Collider | null = null;

  while (traveled < MAX_RANGE) {
    vel.y += GRAVITY * step;
    dir.copy(vel).multiplyScalar(step);
    const len = dir.length();
    dir.divideScalar(len);
    const hit = world.castRayAndGetNormal(new RAPIER.Ray(pos, dir), len, true, undefined, undefined, excludeCollider);
    if (hit) {
      pos.addScaledVector(dir, hit.timeOfImpact);
      normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      hitCollider = hit.collider;
      points.push(pos.clone());
      break;
    }
    pos.addScaledVector(dir, len);
    points.push(pos.clone());
    traveled += len;
  }

  const range = Math.hypot(pos.x - origin.x, pos.z - origin.z);
  return { points, impact: pos, normal, range, hitCollider };
}

/** A manually-integrated ballistic shell; resolves hits via a swept raycast each frame. */
export class Projectile {
  readonly mesh: THREE.Mesh;
  private readonly velocity: THREE.Vector3;
  private age = 0;
  private traveled = 0;
  dead = false;

  constructor(
    private readonly scene: THREE.Scene,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    private readonly damage: number,
    private readonly excludeCollider: RAPIER.Collider | undefined,
    private readonly onImpact?: (point: THREE.Vector3, result: ImpactResult) => void,
    visualScale = 1,
    private readonly faction: Faction = 'enemy',
  ) {
    this.velocity = direction.clone().normalize().multiplyScalar(speed);
    // Glowing tracer, stretched along its flight direction so it reads at long range.
    this.mesh = new THREE.Mesh(SHELL_GEOMETRY, SHELL_MATERIAL);
    this.mesh.scale.set(visualScale, visualScale, 5 * visualScale);
    this.mesh.position.copy(origin);
    this.mesh.lookAt(origin.clone().add(this.velocity));
    scene.add(this.mesh);
  }

  update(dt: number, world: RAPIER.World, hitRegistry: HitRegistry): void {
    if (this.dead) return;
    this.age += dt;

    const prevPos = this.mesh.position.clone();
    this.velocity.y += GRAVITY * dt;
    const newPos = prevPos.clone().addScaledVector(this.velocity, dt);
    const segment = new THREE.Vector3().subVectors(newPos, prevPos);
    const segLen = segment.length();

    if (segLen > 1e-5) {
      const dir = segment.clone().normalize();
      const ray = new RAPIER.Ray(prevPos, dir);
      const hit = world.castRay(ray, segLen, true, undefined, undefined, this.excludeCollider);
      if (hit) {
        const hitPoint = prevPos.clone().addScaledVector(dir, hit.timeOfImpact);
        this.resolveHit(hit.collider, hitRegistry, hitPoint);
        return;
      }
    }

    this.mesh.position.copy(newPos);
    this.mesh.lookAt(newPos.clone().add(this.velocity));
    this.traveled += segLen;

    if (this.age > MAX_LIFETIME || this.traveled > MAX_RANGE || newPos.y < -20) {
      this.remove();
    }
  }

  private resolveHit(collider: RAPIER.Collider, hitRegistry: HitRegistry, point: THREE.Vector3): void {
    const target = hitRegistry.lookup(collider);
    const water = target?.kind === 'water' || (target?.kind !== 'tank' && isUnderwater(point.x, point.y, point.z));
    const result: ImpactResult = { collapsedBuilding: null, tankHit: null, water, critical: null ,treeHit: target?.kind === 'tree' };
    
    if (target?.kind === 'tank') {
      // No friendly fire: shells just bounce off their own side's tanks.
      if (target.tank.faction !== this.faction) {
        const zone = target.tank.takeDamage(this.damage, point);
        if (zone) result.tankHit = { tank: target.tank, zone };
      }
    } else if (target?.kind === 'building') {
      // Nor do they hurt their own side's bunkers and compounds.
      if (target.building.faction !== this.faction) {
        result.critical = target.building.strike(this.damage, point, this.velocity)?.label ?? null;
        if (target.building.destroyed) result.collapsedBuilding = target.building;
      }
    }
    this.onImpact?.(point, result);
    this.remove();
  }

  private remove(): void {
    if (this.dead) return;
    this.dead = true;
    this.scene.remove(this.mesh);
  }
}
