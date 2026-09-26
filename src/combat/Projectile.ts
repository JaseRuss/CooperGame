import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { HitRegistry } from './HitRegistry';
import { isUnderwater } from '../world/Terrain';
import type { Building } from '../world/Building';
import type { Tree } from '../world/Tree';
import type { Tank, ArmorZone, Faction } from '../entities/Tank';

export interface ImpactResult {
  /** Set when this hit brought a building down. */
  collapsedBuilding: Building | null;
  /** Set when this hit struck a tank's armour. */
  tankHit: { tank: Tank; zone: ArmorZone } | null;
  /** The shot landed in a lake. */
  water: boolean;
  /** The tree (or lamp post) whose trunk the shot struck. */
  tree: Tree | null;
  /** Name of the weak point hit ("Gun slit", "Missile"), when it was a critical hit. */
  critical: string | null;
}

const GRAVITY = -9;
const MAX_LIFETIME = 8;
const MAX_RANGE = 900;

const SHELL_GEOMETRY = new THREE.SphereGeometry(0.16, 8, 6);
const SHELL_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffd27a });

/**
 * How a shot looks in flight: a glowing tracer (the default), or on the knights mission a dragon's
 * fireball, an iron cannonball or an arrow. They all fly and hit exactly the same way.
 */
export type ShotStyle = 'shell' | 'fireball' | 'cannonball' | 'arrow';

const FIREBALL_GEOMETRY = new THREE.IcosahedronGeometry(0.6, 1);
const FIREBALL_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.75, depthWrite: false });
const FIRE_CORE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xfff08a });
/** A flame licking back from the fireball (it points along -Z, away from the way it flies). */
const FIRE_TAIL_GEOMETRY = new THREE.ConeGeometry(0.5, 2.2, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.2);
const FIRE_TAIL_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xff4a12, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const CANNONBALL_GEOMETRY = new THREE.SphereGeometry(0.3, 12, 8);
const CANNONBALL_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x2e3036, roughness: 0.5, metalness: 0.3 });
/** An arrow along +Z (the way lookAt points a mesh): shaft, head and white fletching. */
const ARROW_GEOMETRY = (() => {
  const shaft = new THREE.CylinderGeometry(0.035, 0.035, 1.3, 5).rotateX(Math.PI / 2);
  const head = new THREE.ConeGeometry(0.08, 0.22, 5).rotateX(Math.PI / 2).translate(0, 0, 0.75);
  const fletch = new THREE.BoxGeometry(0.22, 0.02, 0.28).translate(0, 0, -0.55);
  const fletch2 = new THREE.BoxGeometry(0.02, 0.22, 0.28).translate(0, 0, -0.55);
  const parts = [shaft, head, fletch, fletch2].map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    return n;
  });
  const merged = new THREE.BufferGeometry();
  const pos = parts.flatMap((g) => Array.from(g.attributes.position.array as Float32Array));
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  return merged;
})();
const ARROW_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xe8dcc0 });

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
  /** A fireball's bright core, which flickers. */
  private readonly core: THREE.Mesh | null = null;

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
    style: ShotStyle = 'shell',
  ) {
    this.velocity = direction.clone().normalize().multiplyScalar(speed);
    if (style === 'fireball') {
      this.mesh = new THREE.Mesh(FIREBALL_GEOMETRY, FIREBALL_MATERIAL);
      this.mesh.scale.setScalar(visualScale);
      this.core = new THREE.Mesh(FIREBALL_GEOMETRY, FIRE_CORE_MATERIAL);
      this.core.scale.setScalar(0.6);
      this.mesh.add(this.core, new THREE.Mesh(FIRE_TAIL_GEOMETRY, FIRE_TAIL_MATERIAL));
    } else if (style === 'cannonball') {
      this.mesh = new THREE.Mesh(CANNONBALL_GEOMETRY, CANNONBALL_MATERIAL);
      this.mesh.scale.setScalar(visualScale);
      this.mesh.castShadow = true;
    } else if (style === 'arrow') {
      this.mesh = new THREE.Mesh(ARROW_GEOMETRY, ARROW_MATERIAL);
      this.mesh.scale.setScalar(visualScale * 1.6);
    } else {
      // Glowing tracer, stretched along its flight direction so it reads at long range.
      this.mesh = new THREE.Mesh(SHELL_GEOMETRY, SHELL_MATERIAL);
      this.mesh.scale.set(visualScale, visualScale, 5 * visualScale);
    }
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
    if (this.core) {
      this.core.scale.setScalar(0.55 + Math.random() * 0.2);
      this.mesh.scale.z = 1 + Math.random() * 0.25; // the tail flickers
      this.mesh.rotateZ(this.age * 9);
    }
    this.traveled += segLen;

    if (this.age > MAX_LIFETIME || this.traveled > MAX_RANGE || newPos.y < -20) {
      this.remove();
    }
  }

  private resolveHit(collider: RAPIER.Collider, hitRegistry: HitRegistry, point: THREE.Vector3): void {
    const target = hitRegistry.lookup(collider);
    const water = target?.kind === 'water' || (target?.kind !== 'tank' && isUnderwater(point.x, point.y, point.z));
    const result: ImpactResult = { collapsedBuilding: null, tankHit: null, water, tree: target?.kind === 'tree' ? target.tree : null, critical: null };
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
