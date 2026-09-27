import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Tank } from '../entities/Tank';
import type { AAGun } from '../world/AAGun';
import { heightAt } from '../world/Terrain';
import { PartBuilder, tubeZ } from '../utils/modelKit';
import { plastic } from '../utils/plastic';

/** A chopper on your side that the enemy's anti-aircraft shoots at, and how it's moving. */
export interface AirTarget {
  tank: Tank;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

/** The anti-aircraft troopers' unguided rockets (or fire arrows): how fast and how far. */
export const AA_ROCKET_SPEED = 80;
export const AA_TROOPER_RANGE = 170;
const ROCKET_DAMAGE = 20;
const ROCKET_HIT_RADIUS = 4.5;
const ROCKET_LIFETIME = 3.5;
const ROCKET_TRAIL = 0.035;

// The bases' flak guns: a volley from all four barrels, shells timed to burst by the chopper.
const FLAK_RANGE = 300;
const FLAK_SPEED = 170;
const FLAK_VOLLEY = 1.2;
const FLAK_SPREAD = 0.022;
const FLAK_FUSE_JITTER = 0.07;
const FLAK_PROXIMITY = 3.5;
const FLAK_RADIUS = 7;
const FLAK_DAMAGE = 4.5;
/** A gun opens up once its barrels are this close (radians) to where it wants them. */
const FLAK_AIM_TOLERANCE = 0.12;
/** Choppers lower than this above a gun are left alone (landing or taking off by it). */
const FLAK_MIN_HEIGHT = 8;

/** A jump bigger than this between frames is a teleport, not flying. */
const TELEPORT = 40;

/** What the game does when the anti-aircraft fires and hits: effects, sounds and damage. */
export interface AntiAirHooks {
  flakFired(muzzle: THREE.Vector3, direction: THREE.Vector3): void;
  flakBurst(point: THREE.Vector3): void;
  rocketTrail(point: THREE.Vector3): void;
  rocketBurst(point: THREE.Vector3): void;
  hit(target: AirTarget, damage: number, point: THREE.Vector3): void;
}

interface FlakShell {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  fuse: number;
}

interface Rocket {
  mesh: THREE.Group;
  velocity: THREE.Vector3;
  age: number;
  trail: number;
}

const SHELL_GEOMETRY = new THREE.SphereGeometry(0.12, 6, 4);
const SHELL_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffb04a });
const FLAME_GEOMETRY = new THREE.ConeGeometry(0.12, 0.6, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.75);
const FLAME_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });

let rocketShapes: Map<THREE.Material, THREE.BufferGeometry> | null = null;
let arrowShapes: Map<THREE.Material, THREE.BufferGeometry> | null = null;

/** A bazooka rocket (olive, red nose, fins), or on the knights mission a fire arrow; nose along +Z. */
function buildRocket(fireArrow: boolean): THREE.Group {
  let shapes: Map<THREE.Material, THREE.BufferGeometry>;
  if (fireArrow) {
    shapes = arrowShapes ??= (() => {
      const p = new PartBuilder();
      p.add(tubeZ(0.03, 0.03, 1.3, 5), plastic(0x8a6a3e), 0, 0, 0);
      p.add(new THREE.ConeGeometry(0.07, 0.2, 5).rotateX(Math.PI / 2), plastic(0x3a3a3a), 0, 0, 0.74);
      p.add(new THREE.BoxGeometry(0.2, 0.02, 0.26), plastic(0xf0ece0), 0, 0, -0.52);
      p.add(new THREE.BoxGeometry(0.02, 0.2, 0.26), plastic(0xf0ece0), 0, 0, -0.52);
      return p.buildGeometries();
    })();
  } else {
    shapes = rocketShapes ??= (() => {
      const olive = plastic(0x5f6b3a);
      const dark = plastic(0x3a3d38);
      const p = new PartBuilder();
      p.add(tubeZ(0.08, 0.08, 0.8, 10), olive, 0, 0, 0);
      p.add(new THREE.ConeGeometry(0.1, 0.3, 10).rotateX(Math.PI / 2), plastic(0xc0392b), 0, 0, 0.55);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        p.add(new THREE.BoxGeometry(0.02, 0.16, 0.2), dark, Math.cos(a) * 0.12, Math.sin(a) * 0.12, -0.32, 0, 0, a - Math.PI / 2);
      }
      return p.buildGeometries();
    })();
  }
  const g = new THREE.Group();
  for (const [mat, geo] of shapes) g.add(new THREE.Mesh(geo, mat));
  const flame = new THREE.Mesh(FLAME_GEOMETRY, FLAME_MATERIAL);
  // A fire arrow burns at the head; a rocket's motor at the back.
  if (fireArrow) flame.position.z = 1.45;
  g.add(flame);
  g.scale.setScalar(1.5); // so it reads from the ground
  return g;
}

/** Where to aim so something going `speed` from `from` meets `target` on its current course. */
export function leadPoint(target: Pick<AirTarget, 'position' | 'velocity'>, from: THREE.Vector3, speed: number): THREE.Vector3 {
  const aim = target.position.clone();
  for (let i = 0; i < 2; i++) {
    const t = aim.distanceTo(from) / speed;
    aim.copy(target.position).addScaledVector(target.velocity, t);
  }
  return aim;
}

/** The nearest point to `p` on the segment from `a` to `b`. */
function closestOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const ab = out.subVectors(b, a);
  const len = ab.lengthSq();
  const t = len > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len, 0, 1) : 0;
  return ab.multiplyScalar(t).add(a);
}

/**
 * The enemy's answer to your choppers: the flak guns in their bases, which fire volleys of shells
 * that burst in black puffs round a chopper, and the troopers' unguided rockets (fire arrows for
 * the knights), which only hurt if they fly right into one. Neither can touch anything on the ground.
 */
export class AntiAir {
  /** Your side's choppers in the air this frame, with their speed and heading for leading them. */
  readonly targets: AirTarget[] = [];
  private readonly lastSeen = new Map<Tank, AirTarget>();
  private readonly reload = new Map<AAGun, number>();
  private readonly shells: FlakShell[] = [];
  private readonly rockets: Rocket[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hooks: AntiAirHooks,
    private readonly fireArrows: boolean,
  ) {}

  /** Works out which way each of the choppers is going (from how far it moved since last frame). */
  track(choppers: Tank[], dt: number): void {
    this.targets.length = 0;
    for (const tank of choppers) {
      let t = this.lastSeen.get(tank);
      if (!t) {
        t = { tank, position: tank.position.clone(), velocity: new THREE.Vector3() };
      } else if (dt > 0) {
        const moved = tank.position.clone().sub(t.position);
        if (moved.length() > TELEPORT) t.velocity.set(0, 0, 0);
        else t.velocity.lerp(moved.divideScalar(dt), Math.min(1, dt * 6));
        t.position.copy(tank.position);
      }
      this.targets.push(t);
    }
    this.lastSeen.clear();
    for (const t of this.targets) this.lastSeen.set(t.tank, t);
  }

  /** Each standing flak gun swings onto the nearest chopper in reach and fires volleys at it. */
  updateGuns(dt: number, guns: AAGun[]): void {
    for (const gun of guns) {
      if (!gun.alive) continue;
      const reload = Math.max(0, (this.reload.get(gun) ?? 0) - dt);
      this.reload.set(gun, reload);
      let best: AirTarget | null = null;
      let nearest = FLAK_RANGE;
      for (const t of this.targets) {
        const d = t.position.distanceTo(gun.position);
        if (d < nearest && t.position.y - gun.position.y > FLAK_MIN_HEIGHT) {
          nearest = d;
          best = t;
        }
      }
      if (!best) continue;
      const muzzle = gun.muzzle;
      const dir = leadPoint(best, muzzle, FLAK_SPEED).sub(muzzle).normalize();
      gun.track(dir);
      const barrels = gun.barrelDirection;
      if (reload > 0 || barrels.angleTo(dir) > FLAK_AIM_TOLERANCE) continue;
      this.reload.set(gun, FLAK_VOLLEY * (0.9 + Math.random() * 0.2));
      const fuse = nearest / FLAK_SPEED;
      for (let i = 0; i < 4; i++) {
        const v = barrels.clone();
        v.x += (Math.random() - 0.5) * FLAK_SPREAD * 2;
        v.y += (Math.random() - 0.5) * FLAK_SPREAD * 2;
        v.z += (Math.random() - 0.5) * FLAK_SPREAD * 2;
        const mesh = new THREE.Mesh(SHELL_GEOMETRY, SHELL_MATERIAL);
        mesh.position.copy(muzzle).addScaledVector(v, i * 0.8);
        mesh.scale.set(1, 1, 5);
        mesh.lookAt(mesh.position.clone().add(v));
        this.scene.add(mesh);
        this.shells.push({ mesh, velocity: v.normalize().multiplyScalar(FLAK_SPEED), fuse: fuse + (Math.random() - 0.5) * FLAK_FUSE_JITTER * 2 });
      }
      this.hooks.flakFired(muzzle, barrels);
    }
  }

  /** An AA trooper's rocket (or fire arrow), flying straight from `origin` along `direction`. */
  fireRocket(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const mesh = buildRocket(this.fireArrows);
    mesh.position.copy(origin);
    const velocity = direction.clone().normalize().multiplyScalar(AA_ROCKET_SPEED);
    mesh.lookAt(origin.clone().add(velocity));
    this.scene.add(mesh);
    this.rockets.push({ mesh, velocity, age: 0, trail: 0 });
  }

  /** Flies the flak shells and rockets on, bursting them by the choppers (or on the ground). */
  update(dt: number, world: RAPIER.World): void {
    const near = new THREE.Vector3();
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      const from = s.mesh.position.clone();
      const to = from.clone().addScaledVector(s.velocity, dt);
      s.fuse -= dt;
      let burst: THREE.Vector3 | null = s.fuse <= 0 ? to : null;
      for (const t of this.targets) {
        if (burst) break;
        if (closestOnSegment(from, to, t.position, near).distanceTo(t.position) < FLAK_PROXIMITY) burst = near.clone();
      }
      if (!burst && to.y < heightAt(to.x, to.z)) burst = to;
      if (!burst) {
        s.mesh.position.copy(to);
        continue;
      }
      for (const t of this.targets) {
        const d = t.position.distanceTo(burst);
        if (d < FLAK_RADIUS) this.hooks.hit(t, FLAK_DAMAGE * (1 - 0.6 * (d / FLAK_RADIUS)), burst);
      }
      this.hooks.flakBurst(burst);
      this.scene.remove(s.mesh);
      this.shells.splice(i, 1);
    }

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.age += dt;
      const from = r.mesh.position.clone();
      const step = r.velocity.clone().multiplyScalar(dt);
      const to = from.clone().add(step);
      r.trail -= dt;
      if (r.trail <= 0) {
        r.trail = ROCKET_TRAIL;
        this.hooks.rocketTrail(from);
      }
      let hit: AirTarget | null = null;
      for (const t of this.targets) {
        if (closestOnSegment(from, to, t.position, near).distanceTo(t.position) < ROCKET_HIT_RADIUS) {
          hit = t;
          break;
        }
      }
      let end: THREE.Vector3 | null = hit ? near.clone() : null;
      if (!end) {
        // Anything solid on the way (a building, a tree, the ground) sets it off.
        const len = step.length();
        const ray = world.castRay(new RAPIER.Ray(from, step.clone().divideScalar(len)), len, true);
        if (ray) {
          end = from.clone().addScaledVector(step, ray.timeOfImpact / len);
          hit = this.targets.find((t) => t.tank.physicsCollider === ray.collider) ?? null;
        }
        else if (r.age > ROCKET_LIFETIME) end = to;
      }
      if (!end) {
        r.mesh.position.copy(to);
        continue;
      }
      if (hit) this.hooks.hit(hit, ROCKET_DAMAGE, end);
      this.hooks.rocketBurst(end);
      this.scene.remove(r.mesh);
      this.rockets.splice(i, 1);
    }
  }
}
