import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, createWorld } from '../physics/PhysicsWorld';
import { InputManager, type InputState } from '../input/InputManager';
import { buildTerrain, surfaceHeightAt, waterDepthAt } from '../world/Terrain';
import { AssetLibrary } from '../world/AssetLibrary';
import { generateWorld, type EnemySpawnPoint } from '../world/WorldGenerator';
import { HomeBase, isInsideBase } from '../world/Base';
import type { Polyline } from '../world/RoadNetwork';
import type { Building } from '../world/Building';
import type { Bunker } from '../world/Bunker';
import type { EnemyBase } from '../world/EnemyBase';
import type { LandmarkSet } from '../world/LandmarkBuilders';
import { TOWNS } from '../world/TownPlan';
import { PlayerTank } from '../entities/PlayerTank';
import type { Tank } from '../entities/Tank';
import { EnemyTank } from '../entities/EnemyTank';
import { BuddyTank, type BuddyTarget } from '../entities/BuddyTank';
import { TroopManager } from '../entities/TroopManager';
import type { Shot } from '../entities/Soldier';
import { HitRegistry } from '../combat/HitRegistry';
import { ProjectileManager } from '../combat/ProjectileManager';
import { ImpactEffects } from '../combat/ImpactEffects';
import { predictTrajectory } from '../combat/Projectile';
import { HomingRocket, type RocketTarget } from '../combat/HomingRocket';
import { CameraRig } from '../camera/CameraRig';
import { HUD, type HUDState } from '../ui/HUD';
import { WorldMap, type MapMarker, type MapView } from '../ui/WorldMap';
import { AimGuide, type AimTarget } from '../ui/AimGuide';
import { FRIENDLY_BASES, nearestFriendlyBase, BASE_RADIUS, type FriendlyBase } from '../core/config';

const RESPAWN_DELAY = 25;
const BASE_HEAL_RATE = 45; // HP/sec while inside a family base
const BULLET_SPEED = 220;
const BULLET_DAMAGE = 0.7;
const BLAST_RADIUS = 7; // per unit of explosion size, for knocking soldiers over
const RUN_OVER_RADIUS = 2.8;

// Homing rocket: fills on a timer, faster when the player wrecks things.
const ROCKET_RECHARGE_TIME = 75;
const CHARGE_PER_TANK = 0.25;
const CHARGE_PER_BUNKER = 0.2;
const CHARGE_PER_BUILDING = 0.08;
const CHARGE_PER_TROOP = 0.02;
const CHARGE_PER_ENEMY_BASE = 0.5;
const ROCKET_LOCK_RANGE = 700;
const ROCKET_LOCK_CONE = (35 * Math.PI) / 180;
const ROCKET_BLAST_RADIUS = 16;
const ROCKET_DAMAGE = 140;
const ROCKET_LINGER_TIME = 3.2;

// Buddy tanks: a long recharge, starting full.
const BUDDY_RECHARGE_TIME = 300;
const MAX_BUDDIES = 6;

// Enemy base objectives.
const CHECKLIST_RANGE = 350; // show the target list when this close to an enemy base
const VICTORY_SCREEN_TIME = 9;

interface RocketSequence {
  rocket: HomingRocket;
  phase: 'flight' | 'linger';
  timer: number;
  point: THREE.Vector3;
  orbit: number;
}

interface EnemySlot {
  spawn: EnemySpawnPoint;
  tank: EnemyTank | null;
  respawnTimer: number;
}

interface FamilyBase {
  info: FriendlyBase;
  camp: HomeBase;
  /** Hull yaw that faces out of the gate, for spawning/resetting here. */
  spawnYaw: number;
}

/** Direction (x = cos, z = sin) from a base centre to where its highway leaves. */
function gateAngle(base: { x: number; z: number }, highways: Polyline[]): number {
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (const road of highways) {
    for (const end of [road[0], road[road.length - 1]]) {
      const d = Math.hypot(end.x - base.x, end.y - base.z);
      if (d < bestDist) {
        bestDist = d;
        best = end;
      }
    }
  }
  // No road nearby: face the middle of the map.
  if (!best || bestDist > BASE_RADIUS * 2) return Math.atan2(-base.z, -base.x);
  return Math.atan2(best.y - base.z, best.x - base.x);
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly input: InputManager;
  private readonly hitRegistry = new HitRegistry();
  private readonly cameraRig: CameraRig;
  private readonly hud: HUD;
  private readonly loadingLabel: HTMLDivElement;
  private readonly sun: THREE.DirectionalLight;

  private world!: RAPIER.World;
  private projectiles!: ProjectileManager;
  private impacts!: ImpactEffects;
  private aimGuide!: AimGuide;
  private landmarks!: LandmarkSet;
  private troops!: TroopManager;
  private player!: PlayerTank;
  private familyBases: FamilyBase[] = [];
  private enemyBases: EnemyBase[] = [];
  private enemyBuildings = new Set<Building>();
  private announcedBases = new Set<EnemyBase>();
  private buildings: Building[] = [];
  private enemySlots: EnemySlot[] = [];
  private bunkers: Bunker[] = [];
  private buddies: BuddyTank[] = [];
  private rocketCharge = 0;
  private buddyCharge = 1;
  private rocketSeq: RocketSequence | null = null;
  private victoryTimer = 0;
  private wakeTimer = 0;
  private ready = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);
    this.cameraRig = new CameraRig(this.camera);
    this.input = new InputManager(this.renderer.domElement);
    this.hud = new HUD(container);

    this.loadingLabel = document.createElement('div');
    this.loadingLabel.style.cssText =
      'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;' +
      "font-size:22px; background:#0a0e14; color:#e8eef5; font-family:'Segoe UI',system-ui,sans-serif; z-index:10;";
    this.loadingLabel.textContent = 'Loading world…';
    container.appendChild(this.loadingLabel);

    this.scene.background = new THREE.Color(0x9fd3f0);
    this.scene.fog = new THREE.Fog(0x9fd3f0, 500, 1700);

    this.scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x3a3226, 0.9));
    this.sun = new THREE.DirectionalLight(0xfff2d9, 1.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -180;
    this.sun.shadow.camera.right = 180;
    this.sun.shadow.camera.top = 180;
    this.sun.shadow.camera.bottom = -180;
    this.sun.shadow.camera.far = 700;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    window.addEventListener('resize', () => this.onResize());

    void this.init();
  }

  private async init(): Promise<void> {
    await initPhysics();
    this.world = createWorld();
    this.projectiles = new ProjectileManager(this.scene, this.world, this.hitRegistry);
    this.impacts = new ImpactEffects(this.scene);
    this.aimGuide = new AimGuide(this.scene);

    const terrain = buildTerrain();
    this.scene.add(terrain.mesh);
    const terrainBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const terrainCollider = this.world.createCollider(terrain.colliderDesc, terrainBody);
    this.hitRegistry.register(terrainCollider, { kind: 'terrain' });

    const assets = new AssetLibrary();
    await assets.load((loaded, total) => {
      this.loadingLabel.textContent = `Loading world… ${loaded}/${total}`;
    });

    const content = generateWorld(this.world, this.scene, this.hitRegistry, assets);
    this.familyBases = FRIENDLY_BASES.map((info) => {
      const gate = gateAngle(info, content.highways);
      return {
        info,
        camp: new HomeBase(this.world, this.scene, info, gate),
        // Face the gate: hull forward (-sin, -cos) should equal (cos gate, sin gate).
        spawnYaw: Math.atan2(-Math.cos(gate), -Math.sin(gate)),
      };
    });
    this.bunkers = content.bunkers;
    this.enemyBases = content.enemyBases;
    this.landmarks = content.landmarks;
    this.buildings = [...content.buildings, ...content.bunkers.map((b) => b.building)];
    for (const b of content.bunkers) this.enemyBuildings.add(b.building);
    for (const base of content.enemyBases) for (const b of base.buildings) this.enemyBuildings.add(b);
    this.troops = new TroopManager(this.scene, content.squads, Math.random);
    this.hud.setWorldMap(
      new WorldMap(
        content.highways,
        TOWNS,
        content.buildings.map((b) => ({
          x: b.center.x,
          z: b.center.z,
          hx: b.halfExtents.x,
          hz: b.halfExtents.z,
          destroyed: () => b.destroyed,
        })),
      ),
    );
    this.enemySlots = content.enemySpawns.map((spawn) => ({ spawn, tank: null, respawnTimer: 0 }));
    for (const slot of this.enemySlots) this.spawnEnemy(slot);

    const home = this.familyBases[0];
    this.player = new PlayerTank(this.world, home.info.x, home.info.z, home.spawnYaw);
    this.scene.add(this.player.root);
    this.hitRegistry.register(this.player.physicsCollider, { kind: 'tank', tank: this.player });

    this.loadingLabel.remove();
    this.ready = true;
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = this;
    this.clock.start();
    requestAnimationFrame(this.animate);
  }

  // ---------- spawning ----------

  private spawnEnemy(slot: EnemySlot): void {
    const tank = new EnemyTank(this.world, slot.spawn.x, slot.spawn.z, slot.spawn.patrolCenter, slot.spawn.patrolRadius, Math.random);
    this.scene.add(tank.root);
    this.hitRegistry.register(tank.physicsCollider, { kind: 'tank', tank });
    slot.tank = tank;
  }

  private removeEnemy(slot: EnemySlot): void {
    if (!slot.tank) return;
    this.explode(slot.tank.position.clone(), 2.5);
    this.addRocketCharge(CHARGE_PER_TANK);
    this.hitRegistry.unregister(slot.tank.physicsCollider);
    this.scene.remove(slot.tank.root);
    slot.tank.dispose();
    slot.tank = null;
    slot.respawnTimer = RESPAWN_DELAY;
  }

  /** Calls in a buddy tank; it rolls in just behind the player in the first free formation slot. */
  private spawnBuddy(): void {
    const used = new Set(this.buddies.map((b) => b.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const side = slot % 2 === 0 ? -1 : 1;
    const row = Math.floor(slot / 2) + 1;
    const offset = new THREE.Vector3(side * 9, 0, row * 12).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.yaw);
    const spot = this.player.position.clone().add(offset);

    const buddy = new BuddyTank(this.world, spot.x, spot.z, this.player.yaw, slot);
    this.scene.add(buddy.root);
    this.hitRegistry.register(buddy.physicsCollider, { kind: 'tank', tank: buddy });
    this.buddies.push(buddy);
    this.impacts.splash(spot, 0.6); // a puff of dust as it rolls in
    this.buddyCharge = 0;
    this.hud.showBanner('BUDDY TANK INCOMING!', `${this.buddies.length} buddy tank${this.buddies.length > 1 ? 's' : ''} with you`);
  }

  private removeBuddy(buddy: BuddyTank): void {
    this.explode(buddy.position.clone(), 2.5);
    this.hitRegistry.unregister(buddy.physicsCollider);
    this.scene.remove(buddy.root);
    buddy.dispose();
    this.buddies = this.buddies.filter((b) => b !== buddy);
  }

  // ---------- combat ----------

  private addRocketCharge(amount: number): void {
    this.rocketCharge = Math.min(1, this.rocketCharge + amount);
  }

  private explode(point: THREE.Vector3, size: number, byPlayerSide = false): void {
    this.impacts.explode(point, size);
    const knocked = this.troops.blast(point, BLAST_RADIUS * size);
    if (byPlayerSide) this.addRocketCharge(knocked * CHARGE_PER_TROOP);
    // During rocket cam the camera is near the blast, not the tank.
    const camDist = point.distanceTo(this.rocketSeq ? this.camera.position : this.player.position);
    this.cameraRig.addShake((size * 0.9) / Math.max(1, camDist / 12));
  }

  private isBunker(building: Building): boolean {
    return this.bunkers.some((b) => b.building === building);
  }

  private collapseBuilding(building: Building, byPlayerSide: boolean): void {
    this.explode(building.center.clone(), building.explosionSize, byPlayerSide);
    const footprint = Math.max(building.halfExtents.x, building.halfExtents.z);
    this.impacts.addSmokeSource(building.groundCenter, footprint * 0.6);
    if (byPlayerSide) this.addRocketCharge(this.isBunker(building) ? CHARGE_PER_BUNKER : CHARGE_PER_BUILDING);
  }

  private fire(tank: Tank, shot: Shot): void {
    const byPlayerSide = tank.faction === 'player';
    this.impacts.muzzleFlash(shot.origin, shot.direction);
    if (tank === this.player) this.cameraRig.addShake(0.35);
    this.projectiles.spawn(
      shot.origin,
      shot.direction,
      tank.muzzleSpeed,
      tank.shellDamage,
      tank.physicsCollider,
      (point, result) => {
        if (result.collapsedBuilding) this.collapseBuilding(result.collapsedBuilding, byPlayerSide);
        else if (result.water) this.impacts.splash(point, 1);
        else this.explode(point, 1, byPlayerSide);
        if (tank === this.player && result.tankHit) this.hud.showHitMarker(result.tankHit.zone);
      },
      1,
      tank.faction,
    );
  }

  /** Small-arms fire from troops and bunker machine guns. */
  private fireBullet(shot: Shot, exclude: RAPIER.Collider | undefined): void {
    this.projectiles.spawn(
      shot.origin,
      shot.direction,
      BULLET_SPEED,
      BULLET_DAMAGE,
      exclude,
      (point, result) => {
        if (result.collapsedBuilding) this.collapseBuilding(result.collapsedBuilding, false);
        else if (result.water) this.impacts.splash(point, 0.25);
        else this.impacts.dustPuff(point);
      },
      0.45,
      'enemy',
    );
  }

  /** The player plus any buddies: everything the enemy shoots at. */
  private get friendlies(): Tank[] {
    return [this.player, ...this.buddies];
  }

  private nearestFriendlyPosition(from: THREE.Vector3): THREE.Vector3 {
    let best = this.player.position;
    let bestD = best.distanceToSquared(from);
    for (const b of this.buddies) {
      const d = b.position.distanceToSquared(from);
      if (d < bestD) {
        bestD = d;
        best = b.position;
      }
    }
    return best;
  }

  /** Everything a buddy might shoot at, most valuable first. */
  private buddyTargets(): BuddyTarget[] {
    const targets: BuddyTarget[] = [];
    for (const slot of this.enemySlots) {
      const tank = slot.tank;
      if (tank) targets.push({ position: tank.position, priority: 3, alive: () => !tank.isDestroyed });
    }
    for (const base of this.enemyBases) {
      for (const o of base.objectives) if (!o.isDestroyed()) targets.push({ position: o.position, priority: 2.5, alive: () => !o.isDestroyed() });
    }
    for (const bunker of this.bunkers) {
      if (bunker.alive) targets.push({ position: bunker.position, priority: 2, alive: () => bunker.alive });
    }
    for (const s of this.troops.activeSoldiers()) targets.push({ position: s.position, priority: 1, alive: () => s.isActive });
    return targets;
  }

  // ---------- homing rocket ----------

  /** The enemy the rocket would lock onto: whatever sits closest to the turret's aim, tanks first. */
  private findLockTarget(): { position: THREE.Vector3; track: RocketTarget } | null {
    const origin = this.player.position;
    const yaw = this.player.turretWorldYaw;
    const aimX = -Math.sin(yaw);
    const aimZ = -Math.cos(yaw);
    let best: { position: THREE.Vector3; track: RocketTarget } | null = null;
    let bestScore = Infinity;

    const consider = (pos: THREE.Vector3, bias: number, track: RocketTarget) => {
      const dx = pos.x - origin.x;
      const dz = pos.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > ROCKET_LOCK_RANGE || dist < 8) return;
      const angle = Math.acos(Math.max(-1, Math.min(1, (dx * aimX + dz * aimZ) / dist)));
      if (angle > ROCKET_LOCK_CONE) return;
      const score = angle + bias + (dist / ROCKET_LOCK_RANGE) * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = { position: pos, track };
      }
    };

    for (const slot of this.enemySlots) {
      const tank = slot.tank;
      if (tank && !tank.isDestroyed) consider(tank.position, 0, () => (tank.isDestroyed ? null : tank.position));
    }
    for (const base of this.enemyBases) {
      for (const o of base.objectives) if (!o.isDestroyed()) consider(o.position, 0.05, () => (o.isDestroyed() ? null : o.position));
    }
    for (const bunker of this.bunkers) {
      if (bunker.alive) consider(bunker.position, 0.08, () => (bunker.alive ? bunker.position : null));
    }
    for (const soldier of this.troops.activeSoldiers()) {
      consider(soldier.position, 0.2, () => (soldier.isActive ? soldier.position.clone().setY(soldier.position.y + 1) : null));
    }
    return best;
  }

  private launchRocket(): void {
    const lock = this.findLockTarget();
    const fallback = predictTrajectory(
      this.world,
      this.player.muzzleWorldPosition,
      this.player.muzzleWorldDirection,
      this.player.muzzleSpeed,
      this.player.physicsCollider,
    ).impact;
    const yaw = this.player.turretWorldYaw;
    const origin = this.player.position.clone().add(new THREE.Vector3(0, 2.6, 0));
    const launchDir = new THREE.Vector3(-Math.sin(yaw) * 0.45, 1, -Math.cos(yaw) * 0.45);

    const rocket = new HomingRocket(
      this.scene,
      origin,
      launchDir,
      lock ? lock.track : () => null,
      lock ? lock.position.clone() : fallback,
      this.player.physicsCollider,
    );
    this.impacts.muzzleFlash(origin, launchDir.clone().normalize());
    this.rocketCharge = 0;
    this.player.invulnerable = true;
    this.rocketSeq = { rocket, phase: 'flight', timer: 0, point: new THREE.Vector3(), orbit: 0 };
  }

  /** Big blast: wrecks tanks, buildings and troops around the impact. */
  private rocketBlast(point: THREE.Vector3): void {
    this.explode(point, 3.4, true);
    this.impacts.addSmokeSource(point.clone(), 3, 25);

    for (const slot of this.enemySlots) {
      if (!slot.tank) continue;
      const d = slot.tank.position.distanceTo(point);
      if (d < ROCKET_BLAST_RADIUS) slot.tank.takeDamage(ROCKET_DAMAGE * (1 - (d / ROCKET_BLAST_RADIUS) ** 2));
    }

    const closest = new THREE.Vector3();
    for (const building of this.buildings) {
      if (building.destroyed) continue;
      const box = new THREE.Box3().setFromCenterAndSize(building.center, building.halfExtents.clone().multiplyScalar(2));
      const d = box.clampPoint(point, closest).distanceTo(point);
      if (d >= ROCKET_BLAST_RADIUS) continue;
      building.takeDamage(ROCKET_DAMAGE * 1.6 * (1 - (d / ROCKET_BLAST_RADIUS) ** 2));
      if (building.destroyed) this.collapseBuilding(building, true);
    }
  }

  /** Runs the rocket-cam sequence. Returns true while the player is not in control. */
  private updateRocketSequence(dt: number): boolean {
    const seq = this.rocketSeq;
    if (!seq) return false;

    if (seq.phase === 'flight') {
      const hit = seq.rocket.update(dt, this.world, (p) => this.impacts.trailPuff(p));
      if (hit) {
        this.rocketBlast(hit);
        seq.phase = 'linger';
        seq.point.copy(hit);
        const v = seq.rocket.velocity;
        seq.orbit = Math.atan2(-v.z, -v.x); // start the orbit roughly behind the rocket's approach
      } else {
        const dir = seq.rocket.velocity.clone().normalize();
        const camPos = seq.rocket.position.clone().addScaledVector(dir, -8).add(new THREE.Vector3(0, 2.2, 0));
        const look = seq.rocket.position.clone().addScaledVector(dir, 14);
        this.cameraRig.updateCinematic(camPos, look, dt, 14);
      }
    }

    if (seq.phase === 'linger') {
      seq.timer += dt;
      seq.orbit += dt * 0.35;
      const r = 38 + seq.timer * 3;
      const camPos = new THREE.Vector3(seq.point.x + Math.cos(seq.orbit) * r, 0, seq.point.z + Math.sin(seq.orbit) * r);
      camPos.y = Math.max(seq.point.y + 13 + seq.timer * 1.5, surfaceHeightAt(camPos.x, camPos.z) + 3);
      this.cameraRig.updateCinematic(camPos, seq.point.clone().add(new THREE.Vector3(0, 3, 0)), dt, 2.5);

      if (seq.timer >= ROCKET_LINGER_TIME) {
        this.rocketSeq = null;
        this.player.invulnerable = false;
        return false;
      }
    }
    return true;
  }

  // ---------- enemy base objectives ----------

  /** Announces bases as they fall, and the victory when the last one goes. */
  private updateEnemyBases(dt: number): void {
    for (const base of this.enemyBases) {
      base.update(dt, (p, r) => this.impacts.chimneyPuff(p, r));
      if (!base.isDestroyed || this.announcedBases.has(base)) continue;
      this.announcedBases.add(base);
      this.addRocketCharge(CHARGE_PER_ENEMY_BASE);
      const left = this.enemyBases.length - this.announcedBases.size;
      if (left === 0) {
        this.hud.showVictory();
        this.victoryTimer = VICTORY_SCREEN_TIME;
      } else {
        this.hud.showBanner(`ENEMY BASE ${base.name.toUpperCase()} DESTROYED!`, `${left} enemy base${left > 1 ? 's' : ''} to go`);
      }
    }
    if (this.victoryTimer > 0) {
      this.victoryTimer -= dt;
      if (this.victoryTimer <= 0) this.hud.hideVictory();
    }
  }

  private nearestEnemyBase(onlyStanding: boolean): { base: EnemyBase; distance: number } | null {
    let best: { base: EnemyBase; distance: number } | null = null;
    for (const base of this.enemyBases) {
      if (onlyStanding && base.isDestroyed) continue;
      const d = Math.hypot(base.center.x - this.player.position.x, base.center.z - this.player.position.z);
      if (!best || d < best.distance) best = { base, distance: d };
    }
    return best;
  }

  // ---------- aiming / HUD helpers ----------

  /** Where the player's next shell would fly and land, and what it would hit. */
  private updateAim(): { screen: { x: number; y: number } | null; range: number | null; target: AimTarget } {
    const traj = predictTrajectory(
      this.world,
      this.player.muzzleWorldPosition,
      this.player.muzzleWorldDirection,
      this.player.muzzleSpeed,
      this.player.physicsCollider,
    );
    const target = this.classifyTarget(traj.hitCollider);
    this.aimGuide.update(traj, target, this.camera);
    return { screen: this.toScreen(traj.impact), range: traj.normal ? traj.range : null, target };
  }

  private toScreen(world: THREE.Vector3): { x: number; y: number } | null {
    const ndc = world.clone().project(this.camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.2 || Math.abs(ndc.y) > 1.2) return null;
    return { x: ((ndc.x + 1) / 2) * window.innerWidth, y: ((1 - ndc.y) / 2) * window.innerHeight };
  }

  private classifyTarget(collider: RAPIER.Collider | null): AimTarget {
    if (!collider) return 'none';
    const hit = this.hitRegistry.lookup(collider);
    if (!hit || hit.kind === 'terrain' || hit.kind === 'water') return 'ground';
    if (hit.kind === 'tank') return hit.tank.faction === 'player' ? 'ground' : 'enemy';
    return this.enemyBuildings.has(hit.building) ? 'enemy' : 'building';
  }

  private collectMarkers(): MapMarker[] {
    const markers: MapMarker[] = [];
    this.troops.collectMarkers(markers);
    for (const b of this.bunkers) {
      if (b.alive) markers.push({ x: b.position.x, z: b.position.z, kind: 'bunker' });
    }
    for (const slot of this.enemySlots) {
      if (slot.tank) markers.push({ x: slot.tank.position.x, z: slot.tank.position.z, kind: 'tank' });
    }
    return markers;
  }

  private mapView(): MapView {
    const objective = this.nearestEnemyBase(true);
    return {
      playerX: this.player.position.x,
      playerZ: this.player.position.z,
      playerYaw: this.player.yaw,
      friendlyBases: FRIENDLY_BASES,
      enemyBases: this.enemyBases.map((b) => ({ x: b.center.x, z: b.center.z, name: b.name, destroyed: b.isDestroyed })),
      buddies: this.buddies.map((b) => ({ x: b.position.x, z: b.position.z })),
      markers: this.collectMarkers(),
      objective: objective ? { x: objective.base.center.x, z: objective.base.center.z, name: objective.base.name } : null,
    };
  }

  private hudState(input: InputState, cinematic: boolean, aim: ReturnType<Game['updateAim']>, lockScreen: { x: number; y: number } | null): HUDState {
    const near = this.nearestEnemyBase(false);
    const inside = isInsideBase(this.player.position);
    return {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      reloadFraction: this.player.fireCooldown / this.player.fireInterval,
      cameraMode: this.cameraRig.mode,
      usingGamepad: input.usingGamepad,
      insideBase: inside ? nearestFriendlyBase(this.player.position.x, this.player.position.z).name : null,
      map: this.mapView(),
      aimScreen: aim.screen,
      aimRange: aim.range,
      aimTarget: aim.target,
      rocketCharge: this.rocketCharge,
      rocketLockScreen: lockScreen,
      buddyCharge: this.buddyCharge,
      buddyCount: this.buddies.length,
      cinematic,
      enemyBasesLeft: this.enemyBases.filter((b) => !b.isDestroyed).length,
      enemyBasesTotal: this.enemyBases.length,
      nearbyBase:
        near && near.distance < CHECKLIST_RANGE
          ? {
              name: near.base.name,
              distance: near.distance,
              objectives: near.base.objectives.map((o) => ({ label: o.label, done: o.isDestroyed() })),
            }
          : null,
    };
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------- main loop ----------

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate);
    if (!this.ready) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const rawInput = this.input.update(dt);

    // Full map doubles as the pause screen: nothing moves while it's open.
    if (this.hud.paused) {
      if (rawInput.mapTogglePressed) this.hud.toggleBigMap();
      this.hud.update(this.hudState(rawInput, false, { screen: null, range: null, target: 'none' }, null));
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const inSequence = this.rocketSeq !== null;
    // The tank sits still (and can't be hurt) while the rocket cam plays.
    const input = inSequence
      ? { ...rawInput, throttle: 0, steer: 0, moveX: 0, moveY: 0, aimYawDelta: 0, aimPitchDelta: 0, firing: false }
      : rawInput;

    if (!inSequence) {
      if (input.cameraTogglePressed) this.cameraRig.toggle();
      if (input.resetPressed) {
        const base = this.familyBases.find((b) => b.info === nearestFriendlyBase(this.player.position.x, this.player.position.z));
        if (base) this.player.teleport(base.info.x, base.info.z, base.spawnYaw);
      }
      if (input.mapTogglePressed) this.hud.toggleBigMap();
      if (input.rocketPressed && this.rocketCharge >= 1) this.launchRocket();
      if (input.buddyPressed && this.buddyCharge >= 1 && this.buddies.length < MAX_BUDDIES) this.spawnBuddy();
      this.addRocketCharge(dt / ROCKET_RECHARGE_TIME);
      this.buddyCharge = Math.min(1, this.buddyCharge + dt / BUDDY_RECHARGE_TIME);
    }

    const playerShot = this.player.step(input, dt);
    if (playerShot) this.fire(this.player, playerShot);

    const friendlies = this.friendlies;
    for (const slot of this.enemySlots) {
      if (slot.tank) {
        if (slot.tank.isDestroyed) {
          this.removeEnemy(slot);
          continue;
        }
        const shot = slot.tank.ai(this.world, friendlies, dt);
        if (shot) this.fire(slot.tank, shot);
      } else {
        slot.respawnTimer -= dt;
        if (slot.respawnTimer <= 0) this.spawnEnemy(slot);
      }
    }

    if (this.buddies.length > 0) {
      const targets = this.buddyTargets();
      for (const buddy of [...this.buddies]) {
        if (buddy.isDestroyed) {
          this.removeBuddy(buddy);
          continue;
        }
        const shot = buddy.think(dt, this.world, this.player, targets);
        if (shot) this.fire(buddy, shot);
      }
    }

    for (const bunker of this.bunkers) {
      const shot = bunker.update(dt, this.world, this.nearestFriendlyPosition(bunker.position));
      if (shot) this.fireBullet(shot, bunker.building.physicsCollider ?? undefined);
    }
    this.troops.update(dt, this.world, friendlies.map((t) => t.position), (shot) => this.fireBullet(shot, undefined));
    this.addRocketCharge(this.troops.runOver(this.player.position, RUN_OVER_RADIUS) * CHARGE_PER_TROOP);

    this.world.step();
    this.projectiles.update(dt);
    this.impacts.update(dt);
    for (const building of this.buildings) building.update(dt);
    this.updateEnemyBases(dt);

    const insideBase = isInsideBase(this.player.position);
    if (insideBase) this.player.heal(BASE_HEAL_RATE * dt);
    const repairingAt = insideBase && this.player.health < this.player.maxHealth ? nearestFriendlyBase(this.player.position.x, this.player.position.z) : null;
    for (const fb of this.familyBases) fb.camp.update(dt, fb.info === repairingAt);
    this.landmarks.update(dt);

    // Bow wave while the tank wades through a lake.
    this.wakeTimer -= dt;
    const moving = Math.abs(input.throttle) + Math.hypot(input.moveX, input.moveY) > 0.1;
    if (moving && this.wakeTimer <= 0 && waterDepthAt(this.player.position.x, this.player.position.z) > 0.3) {
      this.wakeTimer = 0.12;
      const bow = this.player.position.clone().addScaledVector(this.player.forward, 2.2);
      bow.y = this.player.position.y;
      this.impacts.splash(bow, 0.3);
    }

    const cinematic = this.updateRocketSequence(dt);
    let aim: ReturnType<Game['updateAim']> = { screen: null, range: null, target: 'none' };
    let lockScreen: { x: number; y: number } | null = null;
    if (cinematic) {
      this.player.setTurretHidden(false);
      this.aimGuide.setVisible(false);
    } else {
      this.cameraRig.update(this.player, dt);
      aim = this.updateAim();
      if (this.rocketCharge >= 1) {
        const lock = this.findLockTarget();
        if (lock) lockScreen = this.toScreen(lock.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
      }
    }

    const sunOffset = new THREE.Vector3(120, 220, 90);
    this.sun.position.copy(this.player.position).add(sunOffset);
    this.sun.target.position.copy(this.player.position);
    this.sun.target.updateMatrixWorld();

    this.hud.update(this.hudState(input, cinematic, aim, lockScreen));
    this.renderer.render(this.scene, this.camera);
  };
}
