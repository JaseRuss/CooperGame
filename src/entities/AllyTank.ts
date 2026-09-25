import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank';
import type { Shot } from './Soldier';
import { PLAYER_MAX_SPEED, ENEMY_MAX_SPEED } from '../core/config';
import { clamp } from '../utils/math';
import { ARMY_RED } from '../utils/plastic';

/** Something an allied tank can shoot at. */
export interface AllyTarget {
  position: THREE.Vector3;
  /** Higher = more worth shooting (tanks over bunkers over soldiers). */
  priority: number;
  alive: () => boolean;
}

const ENGAGE_RANGE = 140;
const RETARGET_INTERVAL = 0.6;
const TURRET_RATE = 2.4;
const SHELL_GRAVITY = 9; // matches Projectile, for drop compensation

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** The name tag's picture: the name in a bold green outline, shrunk to fit longer names. */
function nameTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let size = 38;
  do ctx.font = `900 ${size}px "Segoe UI", system-ui, sans-serif`;
  while (ctx.measureText(name).width > 236 && --size > 16);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(10,25,8,0.9)';
  ctx.strokeText(name, 128, 34);
  ctx.fillStyle = '#c8f5a8';
  ctx.fillText(name, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A floating name tag, readable through walls so you can always spot your buddies. */
function nameTag(name: string): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name), depthTest: false, transparent: true }));
  sprite.scale.set(4.8, 1.2, 1);
  sprite.position.y = 3.6;
  sprite.renderOrder = 11;
  return sprite;
}

/** A tank on the player's side: picks the most valuable enemy in reach and shells it. */
abstract class AllyTank extends Tank {
  override readonly fireInterval = 2.2;
  override readonly shellDamage = 22;
  protected target: AllyTarget | null = null;
  private retargetTimer = Math.random() * RETARGET_INTERVAL;
  private readonly tag: THREE.Sprite | null;

  constructor(world: RAPIER.World, x: number, z: number, facing: number, health: number, color: number, name: string | null) {
    super(world, x, z, health, color, facing, 'player');
    this.tag = name ? nameTag(name) : null;
    if (this.tag) this.root.add(this.tag);
  }

  /**
   * Keeps a target picked (within `leash` of `anchor`) and turns the gun on it.
   * Returns a shot when the gun is on target and loaded.
   */
  protected engage(dt: number, world: RAPIER.World, anchor: THREE.Vector3, leash: number, targets: AllyTarget[]): Shot | null {
    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0 || (this.target && !this.target.alive())) {
      this.retargetTimer = RETARGET_INTERVAL;
      this.target = this.pickTarget(world, anchor, leash, targets);
    }
    if (!this.target) {
      // Relax the turret back to straight ahead.
      this.aim(-this.turretPivot.rotation.y * 0.05, -this.aimPitch * 0.05);
      return null;
    }
    // Lead the barrel up a little so the shell's drop lands it on target.
    const aimPoint = this.target.position.clone();
    const flight = aimPoint.distanceTo(this.muzzleWorldPosition) / this.muzzleSpeed;
    aimPoint.y += 0.8 + 0.5 * SHELL_GRAVITY * flight * flight;
    this.aimToward(aimPoint, TURRET_RATE, dt);
    return this.isAimedAt(aimPoint, 0.04) ? this.tryFire() : null;
  }

  private pickTarget(world: RAPIER.World, anchor: THREE.Vector3, leash: number, targets: AllyTarget[]): AllyTarget | null {
    let best: AllyTarget | null = null;
    let bestScore = -Infinity;
    for (const t of targets) {
      if (!t.alive()) continue;
      const d = t.position.distanceTo(this.position);
      if (d > ENGAGE_RANGE || t.position.distanceTo(anchor) > leash) continue;
      const score = t.priority * 100 - d;
      if (score > bestScore && this.canSee(world, t.position)) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  private canSee(world: RAPIER.World, point: THREE.Vector3): boolean {
    const origin = this.muzzleWorldPosition;
    const dir = point.clone().add(new THREE.Vector3(0, 1, 0)).sub(origin);
    const dist = dir.length();
    dir.normalize();
    const hit = world.castRay(new RAPIER.Ray(origin, dir), Math.max(0, dist - 4), true, undefined, undefined, this.physicsCollider);
    return hit === null;
  }

  /** Steers toward `point`, slowing to turn. `urgency` 0..1 scales the throttle. */
  protected steerToward(point: THREE.Vector3, urgency: number, dt: number, maxSpeed: number): void {
    const to = point.clone().sub(this.position);
    const err = wrap(Math.atan2(-to.x, -to.z) - this.yaw);
    this.drive(urgency * Math.max(0, Math.cos(err)), clamp(-err * 2, -1, 1), dt, maxSpeed);
  }

  /** Shows or hides the floating name (an option). */
  setNameTagVisible(visible: boolean): void {
    if (this.tag) this.tag.visible = visible;
  }

  /** Redraws the floating name, after it's been changed in the options. */
  protected redrawNameTag(name: string): void {
    if (!this.tag) return;
    this.tag.material.map?.dispose();
    this.tag.material.map = nameTexture(name);
  }

  override dispose(): void {
    if (this.tag) {
      this.tag.material.map?.dispose();
      this.tag.material.dispose();
    }
    super.dispose();
  }
}

// ---------- buddies ----------

const BUDDY_HEALTH = 150;
const BUDDY_COLOR = 0x6a9a3c; // a lighter green than the player so they're easy to tell apart
const BUDDY_LEASH = 170; // don't chase targets this far from the player
const CATCH_UP_DISTANCE = 320;
const SLOT_TOLERANCE = 6;

/** A named buddy: holds a formation slot behind the player and engages nearby enemies. */
export class BuddyTank extends AllyTank {
  constructor(
    world: RAPIER.World,
    x: number,
    z: number,
    facing: number,
    /** Formation position: 0 = behind-left, 1 = behind-right, 2 = further back-left, ... */
    readonly slot: number,
    /** Which crew in the buddy rota this is (their name can be changed in the options). */
    readonly crew: number,
    public name: string,
  ) {
    super(world, x, z, facing, BUDDY_HEALTH, BUDDY_COLOR, name);
    this.addCommander(BUDDY_COLOR);
  }

  rename(name: string): void {
    if (name === this.name) return;
    this.name = name;
    this.redrawNameTag(name);
  }

  /** Where this buddy should sit relative to the player's hull. */
  private slotPosition(player: Tank): THREE.Vector3 {
    const side = this.slot % 2 === 0 ? -1 : 1;
    const row = Math.floor(this.slot / 2) + 1;
    const local = new THREE.Vector3(side * 9, 0, row * 12); // +Z is behind the player
    return local.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw).add(player.position);
  }

  think(dt: number, world: RAPIER.World, player: Tank, targets: AllyTarget[]): Shot | null {
    this.update(dt);
    const slot = this.slotPosition(player);
    if (this.position.distanceTo(player.position) > CATCH_UP_DISTANCE) {
      this.teleport(slot.x, slot.z, player.yaw);
      this.target = null;
    }

    const to = slot.clone().sub(this.position).setY(0);
    const dist = to.length();
    if (dist < SLOT_TOLERANCE) {
      // In position: settle onto the player's heading.
      const err = wrap(player.yaw - this.yaw);
      this.drive(0, clamp(-err * 1.5, -1, 1) * 0.4, dt, PLAYER_MAX_SPEED);
    } else {
      // Close the gap quickly when far, ease in when near.
      this.steerToward(slot, clamp((dist - SLOT_TOLERANCE) / 30, 0.25, 1), dt, PLAYER_MAX_SPEED * 1.1);
    }

    return this.engage(dt, world, player.position, BUDDY_LEASH, targets);
  }
}

// ---------- the red army ----------

const RED_HEALTH = 110;
const WAYPOINT_REACHED = 10;

/**
 * An allied tank driving a route of waypoints (a loop round a town for the red army, or the road
 * into the Fortress for the final assault); stops to fight whatever it meets. After the last
 * waypoint it carries on from `loopFrom`.
 */
export class RedTank extends AllyTank {
  private waypoint = 0;

  constructor(
    world: RAPIER.World,
    private readonly route: THREE.Vector3[],
    start: number,
    color = ARMY_RED,
    private readonly loopFrom = 0,
  ) {
    const p = route[start];
    const next = route[Math.min(start + 1, route.length - 1)];
    super(world, p.x, p.z, Math.atan2(-(next.x - p.x), -(next.z - p.z)), RED_HEALTH, color, null);
    this.waypoint = this.after(start);
  }

  private after(i: number): number {
    return i + 1 < this.route.length ? i + 1 : this.loopFrom;
  }

  think(dt: number, world: RAPIER.World, targets: AllyTarget[]): Shot | null {
    this.update(dt);
    const shot = this.engage(dt, world, this.position, ENGAGE_RANGE, targets);
    if (this.target) {
      this.drive(0, 0, dt, ENEMY_MAX_SPEED); // hold still and shoot
      return shot;
    }
    const goal = this.route[this.waypoint];
    if (Math.hypot(goal.x - this.position.x, goal.z - this.position.z) < WAYPOINT_REACHED) {
      this.waypoint = this.after(this.waypoint);
    }
    this.steerToward(goal, 0.7, dt, ENEMY_MAX_SPEED);
    return shot;
  }
}
