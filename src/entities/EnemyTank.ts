import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank';
import type { PlayerTank } from './PlayerTank';
import { ENEMY_MAX_HEALTH, ENEMY_MAX_SPEED } from '../core/config';
import { randRange } from '../utils/math';
import { heightAt } from '../world/Terrain';
import { ARMY_TAN } from '../utils/plastic';

type AIState = 'patrol' | 'engage' | 'flee';

const DETECT_RANGE = 90;
const LOSE_RANGE = 130;
const PREFERRED_RANGE = 45;
const FLEE_HEALTH_FRACTION = 0.25;
const TURRET_TRACK_RATE = 2.2;
const AIM_FIRE_TOLERANCE = 0.05;

export class EnemyTank extends Tank {
  override readonly fireInterval = 3.4;
  override readonly shellDamage = 11;
  private state: AIState = 'patrol';
  private readonly patrolTarget = new THREE.Vector3();
  private readonly healthBarSprite: THREE.Sprite;
  private readonly healthBarCanvas: HTMLCanvasElement;
  private readonly healthBarCtx: CanvasRenderingContext2D;
  private readonly healthBarTexture: THREE.CanvasTexture;

  constructor(
    world: RAPIER.World,
    spawnX: number,
    spawnZ: number,
    private readonly patrolCenter: THREE.Vector3,
    private readonly patrolRadius: number,
    private readonly rng: () => number,
  ) {
    super(world, spawnX, spawnZ, ENEMY_MAX_HEALTH, ARMY_TAN);
    this.pickNewPatrolTarget();

    this.healthBarCanvas = document.createElement('canvas');
    this.healthBarCanvas.width = 128;
    this.healthBarCanvas.height = 16;
    this.healthBarCtx = this.healthBarCanvas.getContext('2d') as CanvasRenderingContext2D;
    this.healthBarTexture = new THREE.CanvasTexture(this.healthBarCanvas);
    const mat = new THREE.SpriteMaterial({ map: this.healthBarTexture, depthTest: false, transparent: true });
    this.healthBarSprite = new THREE.Sprite(mat);
    this.healthBarSprite.scale.set(2.4, 0.3, 1);
    this.healthBarSprite.position.set(0, 2.6, 0);
    this.healthBarSprite.renderOrder = 10;
    this.healthBarSprite.visible = false;
    this.root.add(this.healthBarSprite);
    this.redrawHealthBar();
  }

  private pickNewPatrolTarget(): void {
    const angle = randRange(this.rng, 0, Math.PI * 2);
    const radius = randRange(this.rng, this.patrolRadius * 0.2, this.patrolRadius);
    const x = this.patrolCenter.x + Math.cos(angle) * radius;
    const z = this.patrolCenter.z + Math.sin(angle) * radius;
    this.patrolTarget.set(x, heightAt(x, z), z);
  }

  private redrawHealthBar(): void {
    const ctx = this.healthBarCtx;
    const w = this.healthBarCanvas.width;
    const h = this.healthBarCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,10,10,0.7)';
    ctx.fillRect(0, 0, w, h);
    const frac = Math.max(0, this.health / this.maxHealth);
    ctx.fillStyle = frac > 0.5 ? '#5fd15f' : frac > 0.25 ? '#e0c23f' : '#e05f4f';
    ctx.fillRect(2, 2, (w - 4) * frac, h - 4);
    this.healthBarTexture.needsUpdate = true;
  }

  private hasLineOfSight(world: RAPIER.World, targetPos: THREE.Vector3): boolean {
    const origin = this.muzzleWorldPosition;
    const dir = new THREE.Vector3().subVectors(targetPos, origin);
    const dist = dir.length();
    if (dist < 0.5) return true;
    dir.normalize();
    const ray = new RAPIER.Ray(origin, dir);
    const hit = world.castRay(ray, Math.max(0, dist - 1.0), true, undefined, undefined, this.physicsCollider);
    return hit === null;
  }

  /** Runs one frame of patrol/engage/flee AI. Returns a shot if this tank fired. */
  ai(world: RAPIER.World, player: PlayerTank, dt: number): { origin: THREE.Vector3; direction: THREE.Vector3 } | null {
    if (!this.alive) return null;

    const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
    const distToPlayer = toPlayer.length();
    const losClear = distToPlayer < LOSE_RANGE && this.hasLineOfSight(world, player.position);

    if (this.state !== 'flee' && this.health / this.maxHealth <= FLEE_HEALTH_FRACTION) {
      this.state = 'flee';
    } else if (this.state === 'patrol' && distToPlayer < DETECT_RANGE && losClear) {
      this.state = 'engage';
    } else if (this.state === 'engage' && (distToPlayer > LOSE_RANGE || !losClear)) {
      this.state = 'patrol';
      this.pickNewPatrolTarget();
    } else if (this.state === 'flee' && distToPlayer > LOSE_RANGE) {
      this.state = 'patrol';
      this.pickNewPatrolTarget();
    }

    let throttle = 0;
    let steer = 0;
    let shot: { origin: THREE.Vector3; direction: THREE.Vector3 } | null = null;

    if (this.state === 'patrol') {
      const toTarget = new THREE.Vector3().subVectors(this.patrolTarget, this.position);
      toTarget.y = 0;
      const dist = toTarget.length();
      if (dist < 8) {
        this.pickNewPatrolTarget();
      } else {
        const desiredYaw = Math.atan2(-toTarget.x, -toTarget.z);
        const yawErr = wrapAngle(desiredYaw - this.yaw);
        steer = clampSteer(-yawErr * 1.2);
        throttle = Math.abs(yawErr) < 1.1 ? 0.65 : 0.25;
      }
      this.aim(-this.turretPivot.rotation.y * 0.04, -this.barrelPitchValue() * 0.04);
    } else if (this.state === 'engage') {
      const desiredYaw = Math.atan2(-toPlayer.x, -toPlayer.z);
      const yawErr = wrapAngle(desiredYaw - this.yaw);

      if (distToPlayer > PREFERRED_RANGE + 10) {
        steer = clampSteer(-yawErr * 1.2);
        throttle = 0.7;
      } else if (distToPlayer < PREFERRED_RANGE - 10) {
        steer = clampSteer(yawErr * 0.6);
        throttle = -0.5;
      } else {
        steer = clampSteer(-yawErr * 0.8);
        throttle = 0.15;
      }

      this.aimToward(player.position, TURRET_TRACK_RATE, dt);
      if (losClear && this.isAimedAt(player.position, AIM_FIRE_TOLERANCE)) {
        shot = this.tryFire();
        if (shot) {
          // Toy gunners aren't marksmen: scatter the shot a little.
          shot.direction.x += (this.rng() - 0.5) * 0.04;
          shot.direction.y += (this.rng() - 0.5) * 0.02;
          shot.direction.z += (this.rng() - 0.5) * 0.04;
          shot.direction.normalize();
        }
      }
    } else {
      // flee
      const away = new THREE.Vector3().subVectors(this.position, player.position);
      away.y = 0;
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      const fleeTarget = new THREE.Vector3().addVectors(this.position, away.normalize().multiplyScalar(20));
      const toTarget = new THREE.Vector3().subVectors(fleeTarget, this.position);
      const desiredYaw = Math.atan2(-toTarget.x, -toTarget.z);
      const yawErr = wrapAngle(desiredYaw - this.yaw);
      steer = clampSteer(-yawErr * 1.2);
      throttle = 0.85;

      if (losClear) {
        this.aimToward(player.position, TURRET_TRACK_RATE * 0.5, dt);
      }
    }

    this.drive(throttle, steer, dt, ENEMY_MAX_SPEED);
    this.update(dt);
    this.redrawHealthBar();
    this.healthBarSprite.visible = this.health < this.maxHealth;

    return shot;
  }

  private barrelPitchValue(): number {
    return this.barrelPivot.rotation.x;
  }

  override dispose(): void {
    this.healthBarTexture.dispose();
    (this.healthBarSprite.material as THREE.SpriteMaterial).dispose();
    super.dispose();
  }
}

function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function clampSteer(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
