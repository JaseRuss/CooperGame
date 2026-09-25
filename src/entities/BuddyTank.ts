import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank';
import type { Shot } from './Soldier';
import { PLAYER_MAX_SPEED } from '../core/config';
import { clamp } from '../utils/math';

/** Something a buddy can shoot at. */
export interface BuddyTarget {
  position: THREE.Vector3;
  /** Higher = more worth shooting (tanks over bunkers over soldiers). */
  priority: number;
  alive: () => boolean;
}

const BUDDY_HEALTH = 150;
const BUDDY_COLOR = 0x6a9a3c; // a lighter green than the player so they're easy to tell apart
const ENGAGE_RANGE = 140;
const LEASH = 170; // don't chase targets this far from the player
const RETARGET_INTERVAL = 0.6;
const CATCH_UP_DISTANCE = 320;
const SLOT_TOLERANCE = 6;
const TURRET_RATE = 2.4;
const SHELL_GRAVITY = 9; // matches Projectile, for drop compensation

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** A friendly AI tank: holds a formation slot behind the player and engages nearby enemies. */
export class BuddyTank extends Tank {
  override readonly fireInterval = 2.2;
  override readonly shellDamage = 22;
  private target: BuddyTarget | null = null;
  private retargetTimer = 0;

  constructor(
    world: RAPIER.World,
    x: number,
    z: number,
    facing: number,
    /** Formation position: 0 = behind-left, 1 = behind-right, 2 = further back-left, ... */
    public slot: number,
  ) {
    super(world, x, z, BUDDY_HEALTH, BUDDY_COLOR, facing, 'player');
  }

  /** Where this buddy should sit relative to the player's hull. */
  private slotPosition(player: Tank): THREE.Vector3 {
    const side = this.slot % 2 === 0 ? -1 : 1;
    const row = Math.floor(this.slot / 2) + 1;
    const local = new THREE.Vector3(side * 9, 0, row * 12); // +Z is behind the player
    return local.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw).add(player.position);
  }

  think(dt: number, world: RAPIER.World, player: Tank, targets: BuddyTarget[]): Shot | null {
    this.update(dt);

    const slot = this.slotPosition(player);
    if (this.position.distanceTo(player.position) > CATCH_UP_DISTANCE) {
      this.teleport(slot.x, slot.z, player.yaw);
      this.target = null;
    }

    this.retargetTimer -= dt;
    if (this.retargetTimer <= 0 || (this.target && !this.target.alive())) {
      this.retargetTimer = RETARGET_INTERVAL;
      this.target = this.pickTarget(world, player, targets);
    }

    this.driveToSlot(slot, player, dt);

    if (!this.target) {
      // Relax the turret back to straight ahead.
      this.aim(-this.turretPivot.rotation.y * 0.05, -this.aimPitch * 0.05);
      return null;
    }

    // Lead the barrel up a little so the shell's drop lands it on target.
    const aimPoint = this.target.position.clone();
    const dist = aimPoint.distanceTo(this.muzzleWorldPosition);
    const flight = dist / this.muzzleSpeed;
    aimPoint.y += 0.8 + 0.5 * SHELL_GRAVITY * flight * flight;
    this.aimToward(aimPoint, TURRET_RATE, dt);
    if (this.isAimedAt(aimPoint, 0.04)) return this.tryFire();
    return null;
  }

  private driveToSlot(slot: THREE.Vector3, player: Tank, dt: number): void {
    const to = slot.clone().sub(this.position);
    to.y = 0;
    const dist = to.length();
    if (dist < SLOT_TOLERANCE) {
      // In position: settle onto the player's heading.
      const err = wrap(player.yaw - this.yaw);
      this.drive(0, clamp(-err * 1.5, -1, 1) * 0.4, dt, PLAYER_MAX_SPEED);
      return;
    }
    const desiredYaw = Math.atan2(-to.x, -to.z);
    const err = wrap(desiredYaw - this.yaw);
    const steer = clamp(-err * 2, -1, 1);
    // Close the gap quickly when far, ease in when near; slow down to turn.
    const urgency = clamp((dist - SLOT_TOLERANCE) / 30, 0.25, 1);
    const throttle = urgency * Math.max(0, Math.cos(err));
    this.drive(throttle, steer, dt, PLAYER_MAX_SPEED * 1.1);
  }

  private pickTarget(world: RAPIER.World, player: Tank, targets: BuddyTarget[]): BuddyTarget | null {
    let best: BuddyTarget | null = null;
    let bestScore = -Infinity;
    for (const t of targets) {
      if (!t.alive()) continue;
      const d = t.position.distanceTo(this.position);
      if (d > ENGAGE_RANGE || t.position.distanceTo(player.position) > LEASH) continue;
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
}
