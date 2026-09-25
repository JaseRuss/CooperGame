import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank';
import { ENEMY_MAX_HEALTH } from '../core/config';
import { heightAt } from '../world/Terrain';
import type { AssetLibrary } from '../world/AssetLibrary';
import { ARMY_TAN, plastic } from '../utils/plastic';

const CRUISE_HEIGHT = 38;
// The GLB is authored in metres (about 9 x 3.5 x 11 m); a touch over life size reads well next to the tanks.
const MODEL_SCALE = 1.2;
const ENGAGE_RANGE = 125;
const DISENGAGE_RANGE = 145;
const ORBIT_RANGE = 62;
const TURN_RATE = 1.15;

/** Airborne enemy that shares the tank health, faction, shell and target interfaces. */
export class HelicopterEnemy extends Tank {
  override readonly fireInterval = 3.1;
  override readonly shellDamage = 10;
  protected override barrelPitchMin = -1.45;
  private readonly mixer: THREE.AnimationMixer;
  private readonly orbitPhase: number;
  private readonly healthBar: THREE.Sprite;
  private readonly healthTexture: THREE.CanvasTexture;
  private readonly healthCanvas: HTMLCanvasElement;
  private readonly healthCtx: CanvasRenderingContext2D;
  private readonly gunGeometry: THREE.CylinderGeometry;
  private readonly healthBarHeight: number;
  private engaging = false;
  private trackedTarget: { position: THREE.Vector3 } | null = null;
  private readonly previousTargetPosition = new THREE.Vector3();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly cruiseHeight: number;

  constructor(
    world: RAPIER.World,
    x: number,
    z: number,
    private readonly patrolCenter: THREE.Vector3,
    private readonly patrolRadius: number,
    private readonly rng: () => number,
    assets: AssetLibrary,
    color: number = ARMY_TAN,
  ) {
    super(world, x, z, ENEMY_MAX_HEALTH * 0.85, color);
    // Keep the tank kinematic body/controller for shared teardown and tank-compatible combat,
    // but give the aircraft a broad, elevated hit volume instead of tank-sized ground collision.
    world.removeCollider(this.collider, true);
    for (const child of [...this.root.children]) this.root.remove(child);
    // Keep the reusable aiming pivots but discard every moulded tank mesh beneath them.
    this.turretPivot.clear();
    this.barrelPivot.clear();

    const aircraft = new THREE.Group();
    aircraft.rotation.y = Math.PI; // asset nose points +Z; game forward is -Z
    const model = assets.helicopter();
    model.scale.setScalar(MODEL_SCALE);
    model.updateMatrixWorld(true);
    const modelBounds = new THREE.Box3().setFromObject(model);
    const modelSize = modelBounds.getSize(new THREE.Vector3());
    const modelCenter = modelBounds.getCenter(new THREE.Vector3());
    // Scale the aircraft's physical hit volume with its visible model so direct fire and
    // homing rockets can strike the enlarged aircraft instead of passing through it.
    const aircraftBounds = RAPIER.ColliderDesc.cuboid(
      Math.max(2.8, modelSize.x / 2),
      Math.max(1.2, modelSize.y / 2),
      Math.max(3.5, modelSize.z / 2),
    ).setTranslation(-modelCenter.x, modelCenter.y, -modelCenter.z);
    this.collider = world.createCollider(aircraftBounds, this.body);
    this.cruiseHeight = Math.max(CRUISE_HEIGHT, modelSize.y / 2 + 3);
    this.healthBarHeight = Math.max(4.1, modelBounds.max.y + 4);
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      child.material = materials.map((mat) => {
        const material = mat.clone();
        if ('color' in material && material.color) {
          const isGlass = /glass|window|canopy/i.test(child.name + material.name);
          if (!isGlass) material.color.set(color);
          else material.color.lerp(new THREE.Color(color), 0.22);
        }
        if ('roughness' in material) material.roughness = 0.9;
        return material;
      });
      child.castShadow = true;
      child.receiveShadow = true;
    });
    aircraft.add(model);
    this.root.add(aircraft);
    this.mixer = new THREE.AnimationMixer(model);
    const rotor = assets.helicopterClips.find((clip) => /rotor/i.test(clip.name));
    if (rotor) this.mixer.clipAction(rotor).play();
    this.orbitPhase = rng() * Math.PI * 2;

    // Reuse Tank's world-space aim and shell APIs, with a toy-like side gun under the cabin.
    this.barrelPivot.position.set(1.3, -0.55, -0.15);
    this.turretPivot.position.set(0, 0, 0);
    this.root.add(this.turretPivot);
    this.turretPivot.add(this.barrelPivot);
    this.gunGeometry = new THREE.CylinderGeometry(0.12, 0.17, 1.1, 8);
    const gun = new THREE.Mesh(this.gunGeometry, plastic(0x4d4734).clone());
    gun.rotation.x = Math.PI / 2;
    gun.position.z = -0.5;
    gun.castShadow = true;
    this.barrelPivot.add(gun);
    this.muzzle.position.set(0, 0, -1.1);
    this.barrelPivot.add(this.muzzle);
    this.healthCanvas = document.createElement('canvas');
    this.healthCanvas.width = 128;
    this.healthCanvas.height = 14;
    this.healthCtx = this.healthCanvas.getContext('2d') as CanvasRenderingContext2D;
    this.healthTexture = new THREE.CanvasTexture(this.healthCanvas);
    this.healthBar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.healthTexture, transparent: true, depthTest: false }));
    this.healthBar.scale.set(3.2, 0.35, 1);
    this.healthBar.position.set(0, this.healthBarHeight, 0);
    this.healthBar.renderOrder = 10;
    this.healthBar.visible = false;
    this.root.add(this.healthBar);
    this.redrawHealth();
    this.teleport(x, z, 0);
    this.root.position.y = heightAt(x, z) + this.cruiseHeight;
    this.body.setTranslation(this.root.position, true);
  }

  ai(world: RAPIER.World, targets: { position: THREE.Vector3 }[], dt: number): { origin: THREE.Vector3; direction: THREE.Vector3 } | null {
    this.update(dt);
    this.mixer.update(dt);
    if (!this.alive || targets.length === 0) {
      this.flyPatrol(dt);
      return null;
    }
    let target = targets[0];
    let closest = Infinity;
    for (const candidate of targets) {
      const distance = candidate.position.distanceToSquared(this.position);
      if (distance < closest) { closest = distance; target = candidate; }
    }
    // Engage by horizontal separation: the scaled aircraft flies higher to keep its rotor clear.
    const distance = Math.hypot(target.position.x - this.position.x, target.position.z - this.position.z);
    if (this.engaging ? distance > DISENGAGE_RANGE : distance > ENGAGE_RANGE) {
      this.engaging = false;
      this.flyPatrol(dt);
      return null;
    }
    this.engaging = true;

    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const desiredYaw = Math.atan2(-dx, -dz);
    const yawError = Math.atan2(Math.sin(desiredYaw - this.yaw), Math.cos(desiredYaw - this.yaw));
    this.setHeading(this.yaw + THREE.MathUtils.clamp(yawError, -TURN_RATE * dt, TURN_RATE * dt));
    const radial = Math.hypot(dx, dz);
    const radialSpeed = radial > ORBIT_RANGE + 10 ? -10 : radial < ORBIT_RANGE - 10 ? 5 : 0;
    const orbitSign = Math.sin(this.orbitPhase) >= 0 ? 1 : -1;
    const radialX = radial > 0.01 ? -dx / radial : 1;
    const radialZ = radial > 0.01 ? -dz / radial : 0;
    const tangentX = -radialZ * orbitSign;
    const tangentZ = radialX * orbitSign;
    const strafeSpeed = 6;
    this.moveAirborne(
      (radialX * radialSpeed + tangentX * strafeSpeed) * dt,
      (radialZ * radialSpeed + tangentZ * strafeSpeed) * dt,
      dt,
    );

    if (this.trackedTarget === target && dt > 0) {
      this.targetVelocity.subVectors(target.position, this.previousTargetPosition).divideScalar(dt);
      if (this.targetVelocity.length() > 35) this.targetVelocity.setLength(35);
    } else {
      this.trackedTarget = target;
      this.targetVelocity.set(0, 0, 0);
    }
    this.previousTargetPosition.copy(target.position);
    const flightTime = target.position.distanceTo(this.muzzleWorldPosition) / this.muzzleSpeed;
    const aimPoint = target.position.clone().addScaledVector(this.targetVelocity, flightTime);
    aimPoint.y += 0.8 + 0.5 * 9 * flightTime * flightTime;
    this.aimToward(aimPoint, 1.8, dt);
    if (this.lineOfSight(world, aimPoint) && this.isAimedAt(aimPoint, 0.08)) {
      const shot = this.tryFire();
      if (shot) {
        shot.direction.x += (this.rng() - 0.5) * 0.025;
        shot.direction.y += (this.rng() - 0.5) * 0.015;
        shot.direction.z += (this.rng() - 0.5) * 0.025;
        shot.direction.normalize();
      }
      return shot;
    }
    return null;
  }

  private flyPatrol(dt: number): void {
    const t = performance.now() / 1000 * 0.12 + this.orbitPhase;
    const x = this.patrolCenter.x + Math.cos(t) * this.patrolRadius * 0.65;
    const z = this.patrolCenter.z + Math.sin(t) * this.patrolRadius * 0.65;
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const yaw = Math.atan2(-dx, -dz);
    const error = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    this.setHeading(this.yaw + THREE.MathUtils.clamp(error, -TURN_RATE * dt, TURN_RATE * dt));
    const direction = this.forward;
    this.moveAirborne(direction.x * 7 * dt, direction.z * 7 * dt, dt);
  }

  private setHeading(yaw: number): void {
    this.setHullHeading(yaw);
  }

  private moveAirborne(dx: number, dz: number, dt: number): void {
    const x = this.position.x + dx;
    const z = this.position.z + dz;
    const floor = heightAt(x, z) + this.cruiseHeight + Math.sin(performance.now() / 650 + this.orbitPhase) * 1.1;
    const y = THREE.MathUtils.damp(this.position.y, floor, 1.2, dt);
    this.root.position.set(x, y, z);
    this.body.setNextKinematicTranslation(this.root.position);
    this.healthBar.position.y = this.healthBarHeight;
  }

  private lineOfSight(world: RAPIER.World, point: THREE.Vector3): boolean {
    const origin = this.muzzleWorldPosition;
    const direction = point.clone().sub(origin);
    const distance = direction.length();
    direction.normalize();
    return world.castRay(new RAPIER.Ray(origin, direction), Math.max(0, distance - 1), true, undefined, undefined, this.physicsCollider) === null;
  }

  private redrawHealth(): void {
    const ctx = this.healthCtx;
    ctx.clearRect(0, 0, 128, 14);
    ctx.fillStyle = 'rgba(10,10,10,0.75)';
    ctx.fillRect(0, 0, 128, 14);
    const fraction = Math.max(0, this.health / this.maxHealth);
    ctx.fillStyle = fraction > 0.5 ? '#5fd15f' : fraction > 0.25 ? '#e0c23f' : '#e05f4f';
    ctx.fillRect(2, 2, 124 * fraction, 10);
    this.healthTexture.needsUpdate = true;
    this.healthBar.visible = this.health < this.maxHealth;
  }

  override takeDamage(amount: number, hitPoint?: THREE.Vector3): ReturnType<Tank['takeDamage']> {
    const result = super.takeDamage(amount, hitPoint);
    this.redrawHealth();
    return result;
  }

  override dispose(): void {
    this.gunGeometry.dispose();
    this.healthTexture.dispose();
    (this.healthBar.material as THREE.SpriteMaterial).dispose();
    this.root.traverse((child) => {
      if (child instanceof THREE.Mesh && child.parent !== this.root) {
        // GLTF clone materials are unique to this aircraft.
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      }
    });
    super.dispose();
  }
}
