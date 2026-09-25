import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceHeightAt } from '../world/Terrain';
import { plastic, ARMY_TAN } from '../utils/plastic';

const UP = new THREE.Vector3(0, 1, 0);
const ENGAGE_RANGE = 120;
const ACTIVE_RANGE = 450; // beyond this from the player, soldiers stand still to save CPU
const WALK_SPEED = 1.8;
const LOS_CHECK_INTERVAL = 0.5;
const DOWN_LINGER = 14;

export type Shot = { origin: THREE.Vector3; direction: THREE.Vector3 };

// ---------- figure geometry (built once, shared by every soldier) ----------

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

function limb(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r * 0.9, len, 8);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function upperBody(y: number): THREE.BufferGeometry[] {
  const v = (x: number, yy: number, z: number) => new THREE.Vector3(x, y + yy, z);
  const helmet = new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  helmet.translate(0, y + 0.72, 0);
  const brim = new THREE.CylinderGeometry(0.22, 0.22, 0.03, 14);
  brim.translate(0, y + 0.72, 0);
  const head = new THREE.SphereGeometry(0.13, 10, 8);
  head.translate(0, y + 0.66, 0);
  return [
    box(0.4, 0.18, 0.24, 0, y, 0), // hips
    box(0.44, 0.55, 0.26, 0, y + 0.33, 0, -0.08), // torso
    box(0.34, 0.36, 0.14, 0, y + 0.36, 0.2), // backpack
    head,
    helmet,
    brim,
    box(0.06, 0.09, 1.0, 0.12, y + 0.52, -0.38), // rifle at the shoulder
    limb(v(0.25, 0.52, 0), v(0.15, 0.5, -0.22), 0.065), // trigger arm
    limb(v(-0.25, 0.52, 0), v(0.08, 0.49, -0.62), 0.065), // support arm
  ];
}

function standingFigure(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20);
  base.scale(1, 1, 0.75);
  base.translate(0, 0.03, 0);
  return mergeGeometries([
    base,
    limb(new THREE.Vector3(-0.12, 0.06, -0.22), new THREE.Vector3(-0.1, 0.92, -0.02), 0.09),
    limb(new THREE.Vector3(0.12, 0.06, 0.22), new THREE.Vector3(0.1, 0.92, 0.02), 0.09),
    ...upperBody(0.95),
  ]);
}

function kneelingFigure(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20);
  base.scale(1, 1, 0.75);
  base.translate(0, 0.03, 0);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  return mergeGeometries([
    base,
    limb(v(-0.12, 0.06, -0.3), v(-0.12, 0.5, -0.3), 0.09), // front shin
    limb(v(-0.12, 0.5, -0.3), v(-0.1, 0.55, 0.05), 0.09), // front thigh
    limb(v(0.12, 0.08, 0.05), v(0.1, 0.55, 0.05), 0.09), // kneeling thigh
    limb(v(0.12, 0.08, 0.05), v(0.12, 0.1, 0.45), 0.08), // shin on the ground
    ...upperBody(0.6),
  ]);
}

const FIGURES = [standingFigure(), kneelingFigure()];
const MUZZLE_HEIGHT = [1.47, 1.12];

/** A static army-man figure (0 = standing, 1 = kneeling) in the given plastic colour, e.g. for base guards. */
export function createFigureMesh(pose: 0 | 1, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(FIGURES[pose], plastic(color));
  mesh.castShadow = true;
  return mesh;
}

/** A tan plastic army man: hops around, shoots at the player, gets knocked flat by blasts. */
export class Soldier {
  readonly mesh: THREE.Mesh;
  private state: 'active' | 'flying' | 'down' = 'active';
  private readonly pos = new THREE.Vector3();
  private heading: number;
  private readonly pose: number;
  private wanderTarget: THREE.Vector2 | null = null;
  private hopPhase = Math.random() * 10;
  private fireTimer: number;
  private losTimer = Math.random() * LOS_CHECK_INTERVAL;
  private seesPlayer = false;
  private downTime = 0;
  private readonly fallVelocity = new THREE.Vector3();
  private readonly tipAxis = new THREE.Vector3(1, 0, 0);
  private tipAngle = 0;
  private tipTarget = Math.PI / 2;

  constructor(
    x: number,
    z: number,
    private readonly anchor: THREE.Vector2,
    private readonly wanderRadius: number,
    private readonly rng: () => number,
  ) {
    this.pose = rng() < 0.35 ? 1 : 0;
    this.mesh = new THREE.Mesh(FIGURES[this.pose], plastic(ARMY_TAN));
    this.mesh.castShadow = true;
    this.pos.set(x, surfaceHeightAt(x, z), z);
    this.heading = rng() * Math.PI * 2;
    this.fireTimer = 1 + rng() * 2;
    this.applyTransform(0);
  }

  get position(): THREE.Vector3 {
    return this.pos;
  }

  get isActive(): boolean {
    return this.state === 'active';
  }

  /** True once the fallen soldier has lain around long enough to be cleaned up. */
  get expired(): boolean {
    return this.state === 'down' && this.downTime > DOWN_LINGER;
  }

  /** Blast or run over: fly away from `from` and land flat on the ground. */
  knockDown(from: THREE.Vector3, strength: number): void {
    if (this.state !== 'active') return;
    const away = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (away.lengthSq() < 0.01) away.set(this.rng() - 0.5, 0, this.rng() - 0.5);
    away.normalize();
    this.state = 'flying';
    this.fallVelocity.copy(away).multiplyScalar(3 + strength * 5).setY(3 + strength * 6);
    this.tipAxis.crossVectors(UP, away).normalize();
    this.tipTarget = Math.PI / 2 + (this.rng() - 0.5) * 0.3;
    this.pos.y += 0.05;
  }

  update(dt: number, world: RAPIER.World, playerPos: THREE.Vector3): Shot | null {
    if (this.state === 'flying') {
      this.fallVelocity.y -= 24 * dt;
      this.pos.addScaledVector(this.fallVelocity, dt);
      this.tipAngle = Math.min(this.tipTarget, this.tipAngle + dt * 9);
      const ground = surfaceHeightAt(this.pos.x, this.pos.z) + 0.15;
      if (this.pos.y <= ground && this.fallVelocity.y < 0) {
        this.pos.y = ground;
        this.tipAngle = this.tipTarget;
        this.state = 'down';
      }
      this.applyTransform(0);
      return null;
    }
    if (this.state === 'down') {
      this.downTime += dt;
      if (this.downTime > DOWN_LINGER - 2) this.pos.y -= dt * 0.3; // sink away before removal
      this.applyTransform(0);
      return null;
    }

    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > ACTIVE_RANGE) return null;

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = LOS_CHECK_INTERVAL;
      this.seesPlayer = dist < ENGAGE_RANGE && this.lineOfSight(world, playerPos, dist);
    }

    let hop = 0;
    let shot: Shot | null = null;

    if (this.seesPlayer) {
      this.heading = Math.atan2(-dx, -dz);
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = 1.4 + this.rng() * 1.6;
        shot = this.shootAt(playerPos, dist);
      }
    } else {
      if (!this.wanderTarget || this.wanderTarget.distanceTo(new THREE.Vector2(this.pos.x, this.pos.z)) < 1) {
        const a = this.rng() * Math.PI * 2;
        const r = this.rng() * this.wanderRadius;
        this.wanderTarget = new THREE.Vector2(this.anchor.x + Math.cos(a) * r, this.anchor.y + Math.sin(a) * r);
      }
      const tx = this.wanderTarget.x - this.pos.x;
      const tz = this.wanderTarget.y - this.pos.z;
      const tLen = Math.hypot(tx, tz);
      if (tLen > 0.01) {
        const step = Math.min(tLen, WALK_SPEED * dt);
        this.pos.x += (tx / tLen) * step;
        this.pos.z += (tz / tLen) * step;
        this.heading = Math.atan2(-tx, -tz);
        this.hopPhase += dt * 9;
        hop = Math.abs(Math.sin(this.hopPhase)) * 0.22; // toy soldiers can't walk, they hop
      }
    }

    this.pos.y = surfaceHeightAt(this.pos.x, this.pos.z);
    this.applyTransform(hop);
    return shot;
  }

  private lineOfSight(world: RAPIER.World, playerPos: THREE.Vector3, dist: number): boolean {
    const eye = this.pos.clone().setY(this.pos.y + MUZZLE_HEIGHT[this.pose]);
    const dir = playerPos.clone().sub(eye).normalize();
    return world.castRay(new RAPIER.Ray(eye, dir), Math.max(0, dist - 3), true) === null;
  }

  private shootAt(playerPos: THREE.Vector3, dist: number): Shot {
    const forward = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const origin = this.pos.clone().setY(this.pos.y + MUZZLE_HEIGHT[this.pose]).addScaledVector(forward, 0.9);
    const spread = 0.02 + dist * 0.0004;
    const aim = playerPos.clone().setY(playerPos.y + 0.3).sub(origin).normalize();
    aim.x += (this.rng() - 0.5) * spread * 2;
    aim.y += (this.rng() - 0.5) * spread;
    aim.z += (this.rng() - 0.5) * spread * 2;
    return { origin, direction: aim.normalize() };
  }

  private applyTransform(hop: number): void {
    this.mesh.position.set(this.pos.x, this.pos.y + hop, this.pos.z);
    const facing = new THREE.Quaternion().setFromAxisAngle(UP, this.heading);
    const tip = new THREE.Quaternion().setFromAxisAngle(this.tipAxis, this.tipAngle);
    this.mesh.quaternion.copy(tip).multiply(facing);
  }
}
