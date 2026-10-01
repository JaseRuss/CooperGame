import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createFigureMesh, JAM_MATERIAL } from '../entities/Soldier';
import { createJammedTag } from '../combat/JamCannon';
import { ARMY_TAN, plastic } from '../utils/plastic';
import type { GuardPost } from './Facility';
import { ENEMY_GROUPS, WALLS_ONLY } from './groups';

const RADIUS = 0.3;
const HALF_HEIGHT = 0.9 - RADIUS;
/** Rifle hits to put one down. */
const HP = 3;
/** How far a guard can spot someone, and how often he looks. */
const SIGHT = 28;
const SCAN_EVERY = 0.35;
/** Seconds between his shots (plus up to FIRE_JITTER), and how far off he aims (radians). */
const FIRE_EVERY = 1.25;
const FIRE_JITTER = 0.7;
const SPREAD = 0.05;
/** Seconds stuck in jam before he slips over. */
const JAM_TIME = 3.5;
const WALK = 2.2;
const TURN = 5;
const EYE = 1.5;
/** The rifle's muzzle, in the figure's own space (it faces -Z). */
const MUZZLE = new THREE.Vector3(0.12, 1.49, -0.95);
const TIP_SPEED = 6;
const UP = new THREE.Vector3(0, 1, 0);

export type GuardState = 'active' | 'jammed' | 'down' | 'carried' | 'jailed';

/** A rifle shot: from `from` along `dir`. The game works out what it hits. */
export interface Shot {
  from: THREE.Vector3;
  dir: THREE.Vector3;
}

export class Guard {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly collider: RAPIER.Collider;
  state: GuardState = 'active';
  yaw: number;
  hp = HP;
  /** A carrier is on his way to (or carrying) him. */
  claimed = false;
  jamLeft = 0;
  tip = 0;
  fallYaw = 0;
  readonly stand: THREE.Mesh;
  readonly kneel: THREE.Mesh;
  readonly stuckTag: THREE.Sprite;
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.KinematicCharacterController;
  leg = 1;
  fireTimer = FIRE_EVERY * Math.random();
  scanTimer = SCAN_EVERY * Math.random();
  target: THREE.Vector3 | null = null;

  constructor(world: RAPIER.World, readonly post: GuardPost) {
    this.yaw = post.yaw;
    this.stand = createFigureMesh(0, ARMY_TAN);
    this.kneel = createFigureMesh(1, ARMY_TAN);
    this.kneel.visible = false;
    this.stuckTag = createJammedTag(1.8, 'STUCK!');
    this.stuckTag.position.y = 2.4;
    this.stuckTag.visible = false;
    this.root.add(this.stand, this.kneel, this.stuckTag);
    this.pos.set(post.x, 0, post.z);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(post.x, 0.9, post.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(ENEMY_GROUPS), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.enableSnapToGround(0.3);
  }

  /** Can still fight (standing, not stuck in jam). */
  get isActive(): boolean {
    return this.state === 'active';
  }

  /** Where to aim at him. */
  chest(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + 1.2);
  }

  /** Over and out: he falls away from `dir` and can be picked up. */
  knockDown(dir: THREE.Vector3): void {
    this.state = 'down';
    this.fallYaw = Math.atan2(-dir.x, -dir.z);
    this.collider.setEnabled(false);
    this.stuckTag.visible = false;
    this.target = null;
  }

  /** Draws him: standing, wobbling in jam, tipped over, carried, or sat in a cell. */
  pose(dt: number): void {
    if (this.state === 'carried' || this.state === 'jailed') return;
    const tipping = this.state === 'down';
    this.tip = tipping ? Math.min(1, this.tip + dt * TIP_SPEED) : 0;
    this.root.position.copy(this.pos);
    this.stand.rotation.set(0, 0, 0);
    if (tipping) {
      // Flat on his back, away from whatever got him (a little bounce at the end).
      this.stand.rotateY(this.fallYaw);
      this.stand.rotateX(-(Math.PI / 2) * Math.min(1, this.tip * 1.08));
      this.stand.rotateY(this.yaw - this.fallYaw);
    } else {
      this.stand.rotation.y = this.yaw;
      if (this.state === 'jammed') this.stand.rotation.z = Math.sin(this.jamLeft * 9) * 0.08;
    }
  }
}

/**
 * The tan guards: posted round the compound or walking a beat, they shoot at the player and the
 * prisoners when they can see them. Three rifle hits put one down, or a splat from the jam riot
 * cannon sticks him fast until he slips over. A downed guard lies there until one of the squad
 * carries him off to a cell (see Followers).
 */
export class Guards {
  readonly group = new THREE.Group();
  readonly list: Guard[];
  private readonly byCollider = new Map<number, Guard>();

  constructor(world: RAPIER.World, posts: GuardPost[]) {
    this.list = posts.map((post) => {
      const g = new Guard(world, post);
      this.group.add(g.root);
      this.byCollider.set(g.collider.handle, g);
      g.pose(0);
      return g;
    });
  }

  get total(): number {
    return this.list.length;
  }

  /** Still in the fight, stuck or not. */
  get standing(): number {
    return this.list.filter((g) => g.state === 'active' || g.state === 'jammed').length;
  }

  get jailed(): number {
    return this.list.filter((g) => g.state === 'jailed').length;
  }

  /** Who the squad can shoot at. */
  get active(): Guard[] {
    return this.list.filter((g) => g.isActive);
  }

  /** Downed guards nobody's come for yet. */
  get uncollected(): Guard[] {
    return this.list.filter((g) => g.state === 'down' && !g.claimed);
  }

  /** A shot along `dir` hit `collider`: if it was a guard still on his feet, he's hit. Returns him, or null. */
  hit(collider: RAPIER.Collider, dir: THREE.Vector3): Guard | null {
    const g = this.byCollider.get(collider.handle);
    if (!g || (g.state !== 'active' && g.state !== 'jammed')) return null;
    g.hp--;
    if (g.hp <= 0) g.knockDown(dir);
    else g.yaw = Math.atan2(dir.x, dir.z); // he turns to face whoever shot him
    return g;
  }

  /** Jam landed at `point`: guards within `radius` are stuck fast. Returns how many. */
  jamAt(point: THREE.Vector3, radius: number): number {
    let stuck = 0;
    for (const g of this.list) {
      if (g.state !== 'active' || Math.hypot(g.pos.x - point.x, g.pos.z - point.z) > radius || Math.abs(point.y - g.pos.y) > 2.6) continue;
      g.state = 'jammed';
      g.jamLeft = JAM_TIME;
      g.stand.material = JAM_MATERIAL;
      g.stuckTag.visible = true;
      g.target = null;
      stuck++;
    }
    return stuck;
  }

  /** Picked up by one of the squad. */
  pickUp(g: Guard): void {
    g.state = 'carried';
    g.stand.material = plastic(ARMY_TAN);
  }

  /** Being carried: held flat over the carrier's head, lengthways so he fits through a cell door. */
  carry(g: Guard, at: THREE.Vector3, yaw: number): void {
    g.pos.copy(at);
    g.root.position.set(at.x, at.y + 2, at.z);
    g.stand.rotation.set(0, 0, 0);
    g.stand.rotateY(yaw);
    g.stand.rotateX(-Math.PI / 2);
    // Centred over the carrier's head: his middle (0.9 m up from his feet) over the root.
    g.stand.position.set(0, -0.9, 0).applyQuaternion(g.stand.quaternion);
  }

  /** Put down where he was (the carrier was knocked over): he can be collected again. */
  drop(g: Guard): void {
    g.state = 'down';
    g.claimed = false;
    g.stand.position.set(0, 0, 0);
    g.tip = 1;
  }

  /** Locked up: sat in a cell at `spot`, facing the bars. */
  jail(g: Guard, spot: THREE.Vector2): void {
    g.state = 'jailed';
    g.pos.set(spot.x, 0, spot.y);
    g.root.position.copy(g.pos);
    g.stand.position.set(0, 0, 0);
    g.stand.visible = false;
    g.kneel.visible = true;
    g.kneel.rotation.y = 0;
  }

  /**
   * Moves, looks and shoots for one frame. `targets` are where the player and the prisoners he
   * can shoot at are; `sees` says whether there's a clear line between two points.
   * Returns the shots fired.
   */
  update(dt: number, targets: THREE.Vector3[], sees: (from: THREE.Vector3, to: THREE.Vector3) => boolean): Shot[] {
    const shots: Shot[] = [];
    const eye = new THREE.Vector3();
    const aim = new THREE.Vector3();
    for (const g of this.list) {
      if (g.state === 'jammed') {
        g.jamLeft -= dt;
        if (g.jamLeft <= 0) {
          // Slips over backwards in the jam.
          g.stand.material = plastic(ARMY_TAN);
          g.knockDown(new THREE.Vector3(-Math.sin(g.yaw), 0, -Math.cos(g.yaw)).negate());
        }
      } else if (g.state === 'active') {
        g.stand.position.y = 0; // (walking his beat hops him)
        g.scanTimer -= dt;
        if (g.scanTimer <= 0) {
          g.scanTimer = SCAN_EVERY;
          eye.copy(g.pos).setY(g.pos.y + EYE);
          let best: THREE.Vector3 | null = null;
          let bestD = SIGHT;
          for (const t of targets) {
            const d = Math.hypot(t.x - g.pos.x, t.z - g.pos.z);
            if (d < bestD && sees(eye, aim.copy(t).setY(t.y + 1.2))) {
              bestD = d;
              best = t;
            }
          }
          g.target = best;
        }
        if (g.target) {
          // Turn to face him and fire.
          const want = Math.atan2(-(g.target.x - g.pos.x), -(g.target.z - g.pos.z));
          const diff = Math.atan2(Math.sin(want - g.yaw), Math.cos(want - g.yaw));
          g.yaw += Math.sign(diff) * Math.min(Math.abs(diff), TURN * dt);
          g.fireTimer -= dt;
          if (g.fireTimer <= 0 && Math.abs(diff) < 0.3) {
            g.fireTimer = FIRE_EVERY + Math.random() * FIRE_JITTER;
            const from = MUZZLE.clone().applyAxisAngle(UP, g.yaw).add(g.pos);
            const dir = aim.copy(g.target).setY(g.target.y + 1.1).sub(from).normalize();
            dir.x += (Math.random() - 0.5) * 2 * SPREAD;
            dir.y += (Math.random() - 0.5) * 2 * SPREAD;
            dir.z += (Math.random() - 0.5) * 2 * SPREAD;
            shots.push({ from, dir: dir.clone().normalize() });
          }
        } else if (g.post.patrol) {
          this.walkBeat(g, dt);
        }
      }
      g.pose(dt);
    }
    return shots;
  }

  /** Up and down his beat. */
  private walkBeat(g: Guard, dt: number): void {
    const beat = g.post.patrol as { x: number; z: number }[];
    const to = beat[g.leg];
    const dx = to.x - g.pos.x;
    const dz = to.z - g.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) {
      g.leg = (g.leg + 1) % beat.length;
      return;
    }
    g.controller.computeColliderMovement(g.collider, { x: (dx / d) * WALK * dt, y: -dt, z: (dz / d) * WALK * dt }, undefined, WALLS_ONLY);
    const m = g.controller.computedMovement();
    const t = g.body.translation();
    g.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    g.pos.set(t.x + m.x, t.y + m.y - 0.9, t.z + m.z);
    g.yaw = Math.atan2(-dx, -dz);
    // A little hop as he goes, like every toy soldier.
    g.stand.position.y = Math.abs(Math.sin(performance.now() / 120)) * 0.15;
  }
}
