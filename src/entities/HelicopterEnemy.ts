import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank';
import { ENEMY_MAX_HEALTH } from '../core/config';
import { heightAt } from '../world/Terrain';
import { ARMY_TAN, plastic, shade } from '../utils/plastic';
import { PartBuilder, loftGeometry, tubeX, tubeZ } from '../utils/modelKit';

const CRUISE_HEIGHT = 38;
const ENGAGE_RANGE = 125;
const DISENGAGE_RANGE = 145;
const ORBIT_RANGE = 62;
const TURN_RATE = 1.15;
const MAIN_ROTOR_SPEED = 16; // rad/s
const TAIL_ROTOR_SPEED = 34;
/** Hit volume round the cabin and boom (half extents), a little generous for a flying target. */
const HIT_HALF = { x: 2.6, y: 1.6, z: 6 };

type Shapes = Record<'body' | 'rotor' | 'tail' | 'gun', Map<THREE.Material, THREE.BufferGeometry>>;
const shapeCache = new Map<number, Shapes>();

/**
 * A toy gunship in moulded army plastic, nose toward -Z and about 14 m long: rounded cabin and
 * glazed nose, tapering boom, stub wings with rocket pods, skids, and a chin gun. The rotors and
 * the gun are built separately so they can spin and aim.
 */
function gunshipShapes(color: number): Shapes {
  const cached = shapeCache.get(color);
  if (cached) return cached;
  const body = plastic(color);
  const dark = plastic(shade(color, 0.65));
  const deep = plastic(shade(color, 0.42));
  const steel = plastic(0x5b5f58);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fd0e0, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.8 });
  const b = new PartBuilder();

  // Fuselage: glazed nose, deep cabin, then a boom tapering back to the tail.
  const hull = [
    { z: -5.8, w: 0.7, h: 0.7, y: -0.2 },
    { z: -5.3, w: 1.7, h: 1.6, y: 0 },
    { z: -4.3, w: 2.3, h: 2.3, y: 0.15 },
    { z: 0.8, w: 2.4, h: 2.4, y: 0.25 },
    { z: 2.0, w: 1.7, h: 1.7, y: 0.6 },
    { z: 3.2, w: 0.85, h: 0.9, y: 0.85 },
    { z: 8.2, w: 0.45, h: 0.5, y: 1.05 },
  ];
  b.add(loftGeometry(hull, 28, 3), body);
  b.add(loftGeometry(hull.slice(0, 4).map((s) => ({ ...s, w: s.w + 0.05, h: s.h + 0.05, z: Math.min(s.z, -3.4) })), 22, 3, [-0.1 * Math.PI, 1.1 * Math.PI]), glass);
  b.add(new THREE.BoxGeometry(0.08, 1.4, 0.08), deep, 0, 0.95, -4.5, -0.6); // windscreen frame
  // Engine housing and exhausts on the roof, rotor mast.
  b.add(loftGeometry([
    { z: -1.8, w: 0.6, h: 0.3, y: 1.45 },
    { z: -1.2, w: 1.5, h: 0.9, y: 1.7 },
    { z: 1.6, w: 1.4, h: 0.9, y: 1.7 },
    { z: 2.4, w: 0.7, h: 0.4, y: 1.55 },
  ], 18, 3), body);
  for (const s of [-1, 1]) b.add(tubeZ(0.18, 0.22, 0.6, 10), deep, s * 0.45, 1.75, 2.5);
  b.add(new THREE.CylinderGeometry(0.16, 0.2, 0.8, 10), steel, 0, 2.4, 0);
  // Tail: fin, tailplanes, and the tail rotor gearbox.
  b.add(new THREE.BoxGeometry(0.14, 1.9, 1.2), body, 0, 1.9, 7.9, -0.35);
  b.add(new THREE.BoxGeometry(2.4, 0.08, 0.7), body, 0, 1.0, 6.4);
  b.add(tubeX(0.14, 0.4, 8), dark, 0.25, 2.4, 8.2);
  for (const s of [-1, 1]) {
    // Stub wings with a rocket pod and a missile each side.
    b.add(new THREE.BoxGeometry(1.6, 0.12, 1.0), dark, s * 1.9, -0.1, -0.4, 0, 0, s * -0.06);
    b.add(tubeZ(0.3, 0.3, 1.6, 14), deep, s * 2.45, -0.45, -0.5);
    b.add(tubeZ(0.26, 0.26, 0.04, 14), steel, s * 2.45, -0.45, -1.32);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(tubeZ(0.06, 0.06, 0.05, 6), deep, s * 2.45 + Math.cos(a) * 0.16, -0.45 + Math.sin(a) * 0.16, -1.35);
    }
    b.add(tubeZ(0.1, 0.1, 1.4, 10), plastic(0xe8e4d8), s * 1.6, -0.4, -0.3);
    b.add(new THREE.ConeGeometry(0.1, 0.3, 10).rotateX(-Math.PI / 2), plastic(0xc0392b), s * 1.6, -0.4, -1.15);
    // Skids and their struts.
    b.add(new THREE.BoxGeometry(0.14, 0.14, 4.6), steel, s * 1.15, -1.55, -1);
    b.add(new THREE.BoxGeometry(0.14, 0.14, 0.6), steel, s * 1.15, -1.4, -3.5, -0.6);
    for (const z of [-2.2, 0.2]) b.beam(new THREE.Vector3(s * 1.15, -1.55, z), new THREE.Vector3(s * 0.85, -0.7, z), 0.1, steel);
    // Army roundel on the cabin side.
    b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20).rotateZ(Math.PI / 2), deep, s * 1.2, 0.3, -1.4);
    b.add(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 16).rotateZ(Math.PI / 2), body, s * 1.21, 0.3, -1.4);
  }

  const rotor = new PartBuilder();
  rotor.add(new THREE.CylinderGeometry(0.34, 0.3, 0.28, 12), steel);
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI;
    rotor.add(new THREE.BoxGeometry(6.4, 0.08, 0.46), dark, Math.cos(a) * 3.3, 0.05, -Math.sin(a) * 3.3, 0, a, 0.02);
    rotor.add(new THREE.BoxGeometry(0.4, 0.09, 0.48), plastic(0xffcc33), Math.cos(a) * 6.4, 0.05, -Math.sin(a) * 6.4, 0, a);
  }
  const tail = new PartBuilder();
  tail.add(tubeX(0.12, 0.2, 8), steel);
  for (let i = 0; i < 2; i++) tail.add(new THREE.BoxGeometry(0.05, 1.8, 0.2), dark, 0.06, 0, 0, (i * Math.PI) / 2);
  const gun = new PartBuilder();
  gun.add(new THREE.SphereGeometry(0.34, 12, 8), deep);
  gun.add(tubeZ(0.07, 0.09, 1.3, 8), steel, 0, 0, -0.75);
  gun.add(tubeZ(0.11, 0.11, 0.2, 8), deep, 0, 0, -1.35);

  const shapes: Shapes = { body: b.buildGeometries(), rotor: rotor.buildGeometries(), tail: tail.buildGeometries(), gun: gun.buildGeometries() };
  shapeCache.set(color, shapes);
  return shapes;
}

function dress(geos: Map<THREE.Material, THREE.BufferGeometry>, parent: THREE.Object3D): void {
  for (const [mat, geo] of geos) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    parent.add(mesh);
  }
}

/** Airborne enemy that shares the tank health, faction, shell and target interfaces. */
export class HelicopterEnemy extends Tank {
  override readonly fireInterval = 3.1;
  override readonly shellDamage = 10;
  protected override barrelPitchMin = -1.45;
  private readonly orbitPhase: number;
  private readonly airframe = new THREE.Group();
  private readonly mainRotor = new THREE.Group();
  private readonly tailRotor = new THREE.Group();
  private readonly healthBar: THREE.Sprite;
  private readonly healthTexture: THREE.CanvasTexture;
  private readonly healthCanvas: HTMLCanvasElement;
  private readonly healthCtx: CanvasRenderingContext2D;
  private readonly healthBarHeight = 4.2;
  private readonly lastPosition = new THREE.Vector3();
  private engaging = false;
  private trackedTarget: { position: THREE.Vector3 } | null = null;
  private readonly previousTargetPosition = new THREE.Vector3();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly cruiseHeight = CRUISE_HEIGHT;

  constructor(
    world: RAPIER.World,
    x: number,
    z: number,
    private readonly patrolCenter: THREE.Vector3,
    private readonly patrolRadius: number,
    private readonly rng: () => number,
    color: number = ARMY_TAN,
  ) {
    super(world, x, z, ENEMY_MAX_HEALTH * 0.85, color, 0, 'enemy', false);
    // The tank rig's hull-sized collider is swapped for one round the aircraft.
    world.removeCollider(this.collider, true);
    this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(HIT_HALF.x, HIT_HALF.y, HIT_HALF.z).setTranslation(0, 0.3, 1.2), this.body);

    const shapes = gunshipShapes(color);
    this.root.add(this.airframe);
    dress(shapes.body, this.airframe);
    this.mainRotor.position.set(0, 2.85, 0);
    dress(shapes.rotor, this.mainRotor);
    this.tailRotor.position.set(0.45, 2.4, 8.2);
    dress(shapes.tail, this.tailRotor);
    this.airframe.add(this.mainRotor, this.tailRotor);

    // Chin turret: Tank's aiming pivots, so the shared aim/fire code drives it.
    this.turretPivot.position.set(0, -0.9, -4.3);
    this.airframe.add(this.turretPivot);
    this.turretPivot.add(this.barrelPivot);
    dress(shapes.gun, this.barrelPivot);
    this.muzzle.position.set(0, 0, -1.5);
    this.barrelPivot.add(this.muzzle);
    this.orbitPhase = rng() * Math.PI * 2;

    this.healthCanvas = document.createElement('canvas');
    this.healthCanvas.width = 128;
    this.healthCanvas.height = 14;
    this.healthCtx = this.healthCanvas.getContext('2d') as CanvasRenderingContext2D;
    this.healthTexture = new THREE.CanvasTexture(this.healthCanvas);
    this.healthBar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.healthTexture, transparent: true, depthTest: false }));
    this.healthBar.scale.set(3.6, 0.38, 1);
    this.healthBar.position.set(0, this.healthBarHeight, 0);
    this.healthBar.renderOrder = 10;
    this.healthBar.visible = false;
    this.root.add(this.healthBar);
    this.redrawHealth();
    this.teleport(x, z, 0);
    this.root.position.y = heightAt(x, z) + this.cruiseHeight;
    this.body.setTranslation(this.root.position, true);
    this.lastPosition.copy(this.root.position);
  }

  /** Spins the rotors and leans the airframe into its direction of travel. */
  private animate(dt: number): void {
    this.mainRotor.rotation.y += MAIN_ROTOR_SPEED * dt;
    this.tailRotor.rotation.x += TAIL_ROTOR_SPEED * dt;
    if (dt <= 0) return;
    const v = this.root.position.clone().sub(this.lastPosition).divideScalar(dt);
    this.lastPosition.copy(this.root.position);
    const local = v.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    this.airframe.rotation.x = THREE.MathUtils.damp(this.airframe.rotation.x, THREE.MathUtils.clamp(local.z * 0.02, -0.25, 0.25), 3, dt);
    this.airframe.rotation.z = THREE.MathUtils.damp(this.airframe.rotation.z, THREE.MathUtils.clamp(-local.x * 0.02, -0.25, 0.25), 3, dt);
  }
  ai(world: RAPIER.World, targets: { position: THREE.Vector3 }[], dt: number): { origin: THREE.Vector3; direction: THREE.Vector3 } | null {
    this.update(dt);
    this.animate(dt);
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
    // Geometry and plastic materials are shared between helicopters; only the health bar is ours.
    this.healthTexture.dispose();
    (this.healthBar.material as THREE.SpriteMaterial).dispose();
    super.dispose();
  }
}