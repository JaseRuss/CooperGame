import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Tank } from './Tank';
import type { Shot } from './Soldier';
import { PLAYER_MAX_SPEED, ENEMY_MAX_SPEED } from '../core/config';
import { clamp, damp } from '../utils/math';
import { ARMY_RED, plastic, shade } from '../utils/plastic';
import { PartBuilder, tubeZ } from '../utils/modelKit';
import { heightAt } from '../world/Terrain';
import { buildJeepParts, buildChopperParts, type JeepParts, type ChopperParts } from '../world/Vehicles';

/** Something an allied tank can shoot at. */
export interface AllyTarget {
  position: THREE.Vector3;
  /** Higher = more worth shooting (tanks over bunkers over soldiers). */
  priority: number;
  alive: () => boolean;
  /** What it is, so a buddy in a jeep can go after the soldiers. */
  kind: 'tank' | 'objective' | 'bunker' | 'soldier';
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
  override readonly fireInterval: number = 2.2;
  override readonly shellDamage: number = 22;
  protected target: AllyTarget | null = null;
  private retargetTimer = Math.random() * RETARGET_INTERVAL;
  private readonly tag: THREE.Sprite | null;

  constructor(world: RAPIER.World, x: number, z: number, facing: number, health: number, color: number, name: string | null, tankBody = true) {
    super(world, x, z, health, color, facing, 'player', tankBody);
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

  /** How much this tank wants to shoot `t` (0 = not at all). */
  protected priorityOf(t: AllyTarget): number {
    return t.priority;
  }

  private pickTarget(world: RAPIER.World, anchor: THREE.Vector3, leash: number, targets: AllyTarget[]): AllyTarget | null {
    let best: AllyTarget | null = null;
    let bestScore = -Infinity;
    for (const t of targets) {
      const priority = this.priorityOf(t);
      if (priority <= 0 || !t.alive()) continue;
      const d = t.position.distanceTo(this.position);
      if (d > ENGAGE_RANGE || t.position.distanceTo(anchor) > leash) continue;
      const score = priority * 100 - d;
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

/** What a buddy rolls in with: a tank, a quick jeep with a machine gun, or a chopper. */
export type BuddyVehicle = 'tank' | 'jeep' | 'chopper';
/** How a jeep (the same size as the tank's collider) and a chopper look and go. */
const JEEP_SCALE = 1.15;
const JEEP_WHEEL_RADIUS = 0.42;
const JEEP_SPEED_SCALE = 1.5;
/**
 * A buddy chopper flies out in front of the player (where the camera looks) so it's in view, low
 * enough to show on screen and below the player's own chopper, a little to one side.
 */
const CHOPPER_HEIGHT = 22;
const CHOPPER_AHEAD = 65;
const CHOPPER_SIDE = 16;
const CHOPPER_SPEED = 38;
const CHOPPER_TURN = 1.6;
/** Its model hangs so the cabin sits on the hull collider. */
const CHOPPER_MOUNT = new THREE.Vector3(0, 0.5, 1);

/**
 * A named buddy: holds a formation slot behind the player and engages nearby enemies. They come
 * in a tank, a jeep (fast, with a machine gun that goes after soldiers) or a chopper (flying over
 * its slot, with a chin gun).
 */
export class BuddyTank extends AllyTank {
  override readonly fireInterval: number;
  override readonly shellDamage: number;
  override readonly muzzleSpeed: number;
  private jeep: JeepParts | null = null;
  private chopper: ChopperParts | null = null;
  private readonly chopperTilt = new THREE.Group();
  private readonly lastPosition = new THREE.Vector3();
  private readonly flyVelocity = new THREE.Vector3();

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
    readonly vehicle: BuddyVehicle = 'tank',
  ) {
    super(world, x, z, facing, BUDDY_HEALTH, BUDDY_COLOR, name, vehicle === 'tank');
    this.fasterOnRoads = true; // so they keep up with the player on the highway
    // Guns: the tank's cannon, the jeep's machine gun (rifle rounds), the chopper's chin gun.
    this.fireInterval = vehicle === 'jeep' ? 0.16 : vehicle === 'chopper' ? 0.22 : 2.2;
    this.shellDamage = vehicle === 'jeep' ? 0.7 : vehicle === 'chopper' ? 4 : 22;
    this.muzzleSpeed = vehicle === 'jeep' ? 220 : vehicle === 'chopper' ? 190 : 160;
    if (vehicle === 'tank') this.addCommander(BUDDY_COLOR);
    else if (vehicle === 'jeep') this.buildJeep();
    else this.buildChopper(x, z);
    this.lastPosition.copy(this.position);
  }

  /** In the air (a chopper): too high to knock trees over or be bitten. */
  get flying(): boolean {
    return this.vehicle === 'chopper';
  }

  /** The jeep: a machine gun on a post in the back, turning with the aim, with the commander on it. */
  private buildJeep(): void {
    this.jeep = buildJeepParts(BUDDY_COLOR, { mountedGun: false, movingParts: true, driver: true });
    const model = this.jeep.group;
    model.scale.setScalar(JEEP_SCALE);
    model.position.y = -0.5;
    this.root.add(model);
    this.turnRateScale = 1.3;
    const deckY = -0.5 + 1.0 * JEEP_SCALE;
    const post = new PartBuilder();
    const dark = plastic(shade(BUDDY_COLOR, 0.6));
    post.add(new THREE.CylinderGeometry(0.09, 0.12, 0.7, 10), dark, 0, deckY + 0.3, 1.0);
    post.buildInto(this.root);
    this.turretPivot.position.set(0, deckY + 0.72, 1.0);
    this.root.add(this.turretPivot);
    this.turretPivot.add(this.barrelPivot);
    const gun = new PartBuilder();
    const steel = plastic(0x4a4d52);
    gun.add(new THREE.BoxGeometry(0.18, 0.2, 0.6), dark, 0, 0.1, 0.05);
    gun.add(tubeZ(0.05, 0.06, 1.1, 8), steel, 0, 0.12, -0.75);
    gun.add(tubeZ(0.08, 0.08, 0.4, 10), steel, 0, 0.12, -0.45); // cooling jacket
    gun.add(new THREE.BoxGeometry(0.16, 0.18, 0.2), plastic(0x6b5a2e), 0.18, 0.05, 0); // ammo box
    gun.add(new THREE.BoxGeometry(0.6, 0.4, 0.04), dark, 0, 0.2, -0.3); // shield
    gun.buildInto(this.barrelPivot);
    this.muzzle.position.set(0, 0.12, -1.35);
    this.barrelPivot.add(this.muzzle);
    const gunner = AllyTank.createCommander(BUDDY_COLOR);
    gunner.position.set(0, deckY - this.turretPivot.position.y, 0.55);
    this.turretPivot.add(gunner);
  }

  /** The chopper: the player's model in buddy green, with the chin gun on Tank's aiming pivots. */
  private buildChopper(x: number, z: number): void {
    const parts = (this.chopper = buildChopperParts(BUDDY_COLOR));
    this.chopperTilt.position.copy(CHOPPER_MOUNT);
    this.chopperTilt.add(parts.group);
    this.root.add(this.chopperTilt);
    const gunner = AllyTank.createCommander(BUDDY_COLOR);
    gunner.position.y = -0.9 * gunner.scale.y;
    parts.frontSeat.add(gunner);
    // Invisible aiming pivots at the chin; the gun model is turned to match them.
    parts.chinTurret.getWorldPosition(this.turretPivot.position);
    this.chopperTilt.worldToLocal(this.turretPivot.position);
    this.turretPivot.position.add(CHOPPER_MOUNT);
    this.root.add(this.turretPivot);
    this.turretPivot.add(this.barrelPivot);
    this.muzzle.position.set(0, 0, -1.6);
    this.barrelPivot.add(this.muzzle);
    this.barrelPitchMin = -1.2;
    this.root.position.y = heightAt(x, z) + CHOPPER_HEIGHT;
    this.body.setTranslation(this.root.position, true);
  }

  /** A jeep goes for the soldiers and leaves the tanks and buildings to the others. */
  protected override priorityOf(t: AllyTarget): number {
    if (this.vehicle === 'jeep') return t.kind === 'soldier' ? 4 : 0;
    return t.priority;
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
    if (this.chopper) return this.fly(dt, world, player, targets);
    if (Math.hypot(this.position.x - player.position.x, this.position.z - player.position.z) > CATCH_UP_DISTANCE) {
      this.teleport(slot.x, slot.z, player.yaw);
      this.target = null;
    }
    const maxSpeed = PLAYER_MAX_SPEED * (this.jeep ? JEEP_SPEED_SCALE : 1);

    const to = slot.clone().sub(this.position).setY(0);
    const dist = to.length();
    if (dist < SLOT_TOLERANCE) {
      // In position: settle onto the player's heading.
      const err = wrap(player.yaw - this.yaw);
      this.drive(0, clamp(-err * 1.5, -1, 1) * 0.4, dt, maxSpeed);
    } else {
      // Close the gap quickly when far, ease in when near.
      this.steerToward(slot, clamp((dist - SLOT_TOLERANCE) / 30, 0.25, 1), dt, maxSpeed * 1.1);
    }
    if (this.jeep) this.rollWheels();

    return this.spray(this.engage(dt, world, player.position, BUDDY_LEASH, targets));
  }

  /** Machine gun and chin gun rounds scatter a little. */
  private spray(shot: Shot | null): Shot | null {
    if (shot && this.vehicle !== 'tank') {
      shot.direction.x += (Math.random() - 0.5) * 0.03;
      shot.direction.y += (Math.random() - 0.5) * 0.015;
      shot.direction.z += (Math.random() - 0.5) * 0.03;
      shot.direction.normalize();
    }
    return shot;
  }

  /** Rolls the jeep's wheels by how far it went. */
  private rollWheels(): void {
    const along = this.position.clone().sub(this.lastPosition).dot(this.forward);
    this.lastPosition.copy(this.position);
    if (Math.abs(along) > 5 || !this.jeep) return;
    for (const w of this.jeep.wheels) w.rotation.x -= along / (JEEP_WHEEL_RADIUS * JEEP_SCALE);
  }

  /**
   * The chopper flies ahead of the player, out where the camera's looking (left or right of the
   * middle by its slot), turning to face whatever it's shooting, or the same way as the player.
   */
  private fly(dt: number, world: RAPIER.World, player: Tank, targets: AllyTarget[]): Shot | null {
    const parts = this.chopper as ChopperParts;
    const look = player.turretWorldYaw;
    const offset = (this.slot % 2 === 0 ? -1 : 1) * CHOPPER_SIDE * (1 + Math.floor(this.slot / 2));
    const goal = player.position.clone().add(new THREE.Vector3(-Math.sin(look) * CHOPPER_AHEAD + Math.cos(look) * offset, 0, -Math.cos(look) * CHOPPER_AHEAD - Math.sin(look) * offset));
    const toGoal = new THREE.Vector3(goal.x - this.position.x, 0, goal.z - this.position.z);
    if (toGoal.length() > CATCH_UP_DISTANCE) {
      this.root.position.set(goal.x, heightAt(goal.x, goal.z) + CHOPPER_HEIGHT, goal.z);
      this.body.setTranslation(this.root.position, true);
      this.flyVelocity.set(0, 0, 0);
      toGoal.set(0, 0, 0);
    }
    const speed = Math.min(CHOPPER_SPEED, toGoal.length() * 0.8);
    const want = toGoal.lengthSq() > 0.01 ? toGoal.normalize().multiplyScalar(speed) : toGoal;
    this.flyVelocity.x = damp(this.flyVelocity.x, want.x, 1.5, dt);
    this.flyVelocity.z = damp(this.flyVelocity.z, want.z, 1.5, dt);
    const p = this.position;
    const floor = heightAt(p.x, p.z) + CHOPPER_HEIGHT;
    const next = new THREE.Vector3(p.x + this.flyVelocity.x * dt, damp(p.y, floor, 1.2, dt), p.z + this.flyVelocity.z * dt);
    this.body.setNextKinematicTranslation(next);
    this.root.position.copy(next);

    const shot = this.spray(this.engage(dt, world, player.position, BUDDY_LEASH * 1.3, targets));
    // Nose toward the target, or along with the player.
    const face = this.target ? Math.atan2(-(this.target.position.x - p.x), -(this.target.position.z - p.z)) : look;
    const err = wrap(face - this.yaw);
    const turn = clamp(err, -CHOPPER_TURN * dt, CHOPPER_TURN * dt);
    this.setHullHeading(this.yaw + turn);
    this.aim(-turn, 0); // keep the gun on target while the nose swings
    parts.chinTurret.rotation.y = this.turretPivot.rotation.y;
    parts.chinGun.rotation.x = this.barrelPivot.rotation.x;
    // Rotors, and a lean into the travel.
    parts.mainRotor.rotation.y += 24 * dt;
    parts.tailRotor.rotation.x += 50 * dt;
    parts.rotorDisc.material.opacity = 0.16;
    const along = -this.flyVelocity.x * Math.sin(this.yaw) - this.flyVelocity.z * Math.cos(this.yaw);
    const side = this.flyVelocity.x * Math.cos(this.yaw) - this.flyVelocity.z * Math.sin(this.yaw);
    this.chopperTilt.rotation.x = damp(this.chopperTilt.rotation.x, clamp(-along * 0.006, -0.22, 0.22), 3, dt);
    this.chopperTilt.rotation.z = damp(this.chopperTilt.rotation.z, clamp(-side * 0.008, -0.25, 0.25), 3, dt);
    return shot;
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
