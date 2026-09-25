import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceHeightAt } from '../world/Terrain';
import { plastic } from '../utils/plastic';
import type { Faction } from './Tank';

const UP = new THREE.Vector3(0, 1, 0);
const ENGAGE_RANGE = 120;
const WALK_SPEED = 1.8;
const LOS_CHECK_INTERVAL = 0.5;
const DOWN_LINGER = 14;

export type Shot = { origin: THREE.Vector3; direction: THREE.Vector3 };

// ---------- figure geometry (built once, shared by every soldier) ----------
// Modelled on the classic bag-of-army-men rifleman: helmet with a net band, webbing, pack with a
// bedroll, boots and gaiters, all moulded in one colour on an oval stand.

type V = THREE.Vector3;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function limb(a: V, b: V, r: number, taper = 0.9): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r * taper, r, len, 8);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function ball(r: number, at: V, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, 8, 6).scale(sx, sy, sz).translate(at.x, at.y, at.z);
}

/** Two-segment arm or leg with a rounded joint. */
function jointed(a: V, joint: V, b: V, r: number): THREE.BufferGeometry[] {
  return [limb(a, joint, r, 0.92), limb(joint, b, r * 0.9, 0.9), ball(r * 0.95, joint)];
}

/** A boot and gaiter planted at `ankle`, toe pointing -Z. */
function boot(ankle: V): THREE.BufferGeometry[] {
  return [
    box(0.15, 0.11, 0.28, ankle.x, ankle.y - 0.03, ankle.z - 0.06),
    new THREE.CylinderGeometry(0.095, 0.1, 0.16, 8).translate(ankle.x, ankle.y + 0.08, ankle.z),
  ];
}

/** Rifle with stock, receiver, magazine and barrel, held at the shoulder pointing -Z. */
function rifle(x: number, y: number, z: number): THREE.BufferGeometry[] {
  return [
    box(0.07, 0.13, 0.32, x, y - 0.02, z + 0.02), // stock
    box(0.07, 0.1, 0.44, x, y, z - 0.34), // receiver and fore-end
    box(0.05, 0.16, 0.08, x, y - 0.11, z - 0.3, 0.15), // magazine
    new THREE.CylinderGeometry(0.024, 0.024, 0.52, 6).rotateX(Math.PI / 2).translate(x, y + 0.02, z - 0.8), // barrel
    box(0.02, 0.05, 0.02, x, y + 0.07, z - 1.02), // front sight
    new THREE.TorusGeometry(0.05, 0.012, 4, 8, Math.PI).rotateY(Math.PI / 2).translate(x, y - 0.07, z - 0.18), // trigger guard
  ];
}

/** Everything from the hips up, with the hips at height y. */
function upperBody(y: number): THREE.BufferGeometry[] {
  const v = (x: number, yy: number, z: number) => v3(x, y + yy, z);
  const helmet = new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1.05);
  helmet.translate(0, y + 0.72, 0);
  return [
    box(0.4, 0.18, 0.25, 0, y, 0), // hips
    box(0.44, 0.52, 0.27, 0, y + 0.33, 0, -0.08), // torso
    box(0.46, 0.08, 0.3, 0, y + 0.06, 0), // belt
    ...[-0.14, -0.05, 0.05, 0.14].map((x) => box(0.08, 0.1, 0.06, x, y + 0.07, -0.16)), // ammo pouches
    new THREE.CylinderGeometry(0.07, 0.07, 0.16, 8).translate(0.25, y + 0.03, 0.08), // canteen
    box(0.12, 0.11, 0.04, -0.11, y + 0.4, -0.15, -0.08), // breast pockets
    box(0.12, 0.11, 0.04, 0.11, y + 0.4, -0.15, -0.08),
    ball(0.055, v(-0.1, 0.24, -0.17)), // grenade clipped to the webbing
    box(0.05, 0.5, 0.03, -0.12, y + 0.35, -0.14, -0.08), // webbing straps
    box(0.05, 0.5, 0.03, 0.12, y + 0.35, -0.14, -0.08),
    // Pack with a rolled blanket on top and an entrenching tool strapped to the side.
    box(0.34, 0.34, 0.15, 0, y + 0.36, 0.21),
    new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8).rotateZ(Math.PI / 2).translate(0, y + 0.58, 0.22),
    box(0.03, 0.3, 0.04, 0.2, y + 0.3, 0.22),
    box(0.1, 0.12, 0.03, 0.2, y + 0.12, 0.22),
    // Neck, face, helmet.
    new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8).translate(0, y + 0.6, 0),
    ball(0.13, v(0, 0.68, 0), 1, 1.05, 1),
    box(0.04, 0.06, 0.05, 0, y + 0.66, -0.13), // nose
    ball(0.03, v(-0.13, 0.67, 0)), // ears
    ball(0.03, v(0.13, 0.67, 0)),
    helmet,
    new THREE.CylinderGeometry(0.23, 0.25, 0.035, 16).translate(0, y + 0.72, 0.01), // flared brim
    new THREE.TorusGeometry(0.2, 0.014, 4, 18).rotateX(Math.PI / 2).translate(0, y + 0.78, 0), // net band
    // Arms bent to hold the rifle: right hand on the grip, left under the fore-end.
    ...jointed(v(0.25, 0.53, 0.01), v(0.33, 0.36, -0.05), v(0.14, 0.44, -0.2), 0.065),
    ...jointed(v(-0.25, 0.53, 0.01), v(-0.18, 0.37, -0.34), v(0.1, 0.46, -0.58), 0.065),
    ball(0.06, v(0.14, 0.44, -0.2)),
    ball(0.06, v(0.1, 0.46, -0.58)),
    ...rifle(0.12, y + 0.52, 0),
  ];
}

function stand(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(0.42, 0.44, 0.06, 20);
  base.scale(1, 1, 0.75);
  base.translate(0, 0.03, 0);
  return base;
}

function standingFigure(): THREE.BufferGeometry {
  const frontAnkle = v3(-0.12, 0.13, -0.24);
  const backAnkle = v3(0.12, 0.13, 0.22);
  return mergeGeometries([
    stand(),
    ...boot(frontAnkle),
    ...boot(backAnkle),
    ...jointed(frontAnkle, v3(-0.12, 0.52, -0.15), v3(-0.1, 0.93, -0.02), 0.095),
    ...jointed(backAnkle, v3(0.11, 0.53, 0.14), v3(0.1, 0.93, 0.02), 0.095),
    ...upperBody(0.95),
  ]);
}

function kneelingFigure(): THREE.BufferGeometry {
  const frontAnkle = v3(-0.12, 0.13, -0.32);
  return mergeGeometries([
    stand(),
    ...boot(frontAnkle),
    ...jointed(frontAnkle, v3(-0.12, 0.52, -0.3), v3(-0.1, 0.58, 0.04), 0.095), // front leg, knee up
    limb(v3(0.12, 0.1, 0.05), v3(0.1, 0.58, 0.05), 0.095), // thigh down to the kneeling knee
    ball(0.09, v3(0.12, 0.1, 0.05)),
    limb(v3(0.12, 0.1, 0.05), v3(0.12, 0.12, 0.42), 0.085), // shin along the ground
    box(0.14, 0.1, 0.24, 0.12, 0.11, 0.55, -1.2), // boot, toe down
    ...upperBody(0.6),
  ]);
}

const FIGURES = [standingFigure(), kneelingFigure()];
const MUZZLE_HEIGHT = [1.49, 1.14];

/** A static army-man figure (0 = standing, 1 = kneeling) in the given plastic colour, e.g. for base guards. */
export function createFigureMesh(pose: 0 | 1, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(FIGURES[pose], plastic(color));
  mesh.castShadow = true;
  return mesh;
}

/** Glossy strawberry jam, for soldiers caught by the jam cannon. */
export const JAM_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0xe0294f,
  emissive: 0x5a0616,
  roughness: 0.1,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
  sheen: 0.4,
  sheenColor: new THREE.Color(0xff5070),
});

/** A plastic army man: hops around, shoots at the other side, gets knocked flat by blasts. */
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
  private seesTarget = false;
  private downTime = 0;
  private readonly fallVelocity = new THREE.Vector3();
  private readonly tipAxis = new THREE.Vector3(1, 0, 0);
  private tipAngle = 0;
  private tipTarget = Math.PI / 2;
  /** Seconds left stuck in jam (0 = free). */
  private jamTime = 0;
  private jamWobble = 0;

  constructor(
    x: number,
    z: number,
    private readonly anchor: THREE.Vector2,
    private readonly wanderRadius: number,
    private readonly rng: () => number,
    readonly faction: Faction,
    color: number,
  ) {
    this.pose = rng() < 0.35 ? 1 : 0;
    this.mesh = new THREE.Mesh(FIGURES[this.pose], plastic(color));
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

  get isJammed(): boolean {
    return this.jamTime > 0;
  }

  /**
   * Splattered by the jam cannon: coated in jam and stuck fast, unable to move or shoot, until
   * `duration` runs out and he slips over. Returns true if he wasn't already jammed.
   */
  jam(duration: number): boolean {
    if (this.state !== 'active' || this.jamTime > 0) return false;
    this.jamTime = duration;
    this.jamWobble = this.rng() * 10;
    this.mesh.material = JAM_MATERIAL;
    this.tipAxis.set(Math.cos(this.heading), 0, -Math.sin(this.heading)); // sways side to side
    return true;
  }

  /** Blast or run over: fly away from `from` and land flat on the ground. */
  knockDown(from: THREE.Vector3, strength: number): void {
    if (this.state !== 'active') return;
    this.jamTime = 0;
    const away = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (away.lengthSq() < 0.01) away.set(this.rng() - 0.5, 0, this.rng() - 0.5);
    away.normalize();
    this.state = 'flying';
    this.fallVelocity.copy(away).multiplyScalar(3 + strength * 5).setY(3 + strength * 6);
    this.tipAxis.crossVectors(UP, away).normalize();
    this.tipTarget = Math.PI / 2 + (this.rng() - 0.5) * 0.3;
    this.pos.y += 0.05;
  }

  /** `target`: the nearest thing on the other side worth shooting at, or null to just wander. */
  update(dt: number, world: RAPIER.World, target: THREE.Vector3 | null): Shot | null {
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

    if (this.jamTime > 0) {
      // Stuck in jam: struggling from side to side, sinking a little, then slipping over.
      this.jamTime -= dt;
      this.jamWobble += dt * (9 + (4 - Math.min(4, this.jamTime)) * 2);
      this.tipAngle = Math.sin(this.jamWobble) * 0.16;
      this.pos.y = surfaceHeightAt(this.pos.x, this.pos.z) - 0.06;
      this.applyTransform(0);
      if (this.jamTime <= 0) {
        this.jamTime = 0;
        const slip = new THREE.Vector3(this.rng() - 0.5, 0, this.rng() - 0.5).add(this.pos);
        this.knockDown(slip, 0.15);
      }
      return null;
    }

    const dx = target ? target.x - this.pos.x : 0;
    const dz = target ? target.z - this.pos.z : 0;
    const dist = target ? Math.hypot(dx, dz) : Infinity;

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = LOS_CHECK_INTERVAL;
      this.seesTarget = target !== null && dist < ENGAGE_RANGE && this.lineOfSight(world, target, dist);
    }

    let hop = 0;
    let shot: Shot | null = null;

    if (this.seesTarget && target && dist < ENGAGE_RANGE) {
      this.heading = Math.atan2(-dx, -dz);
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = 1.4 + this.rng() * 1.6;
        shot = this.shootAt(target, dist);
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

  private lineOfSight(world: RAPIER.World, target: THREE.Vector3, dist: number): boolean {
    const eye = this.pos.clone().setY(this.pos.y + MUZZLE_HEIGHT[this.pose]);
    const dir = target.clone().setY(target.y + 0.8).sub(eye).normalize();
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
