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
import { Bunker } from '../world/Bunker';
import type { EnemyBase } from '../world/EnemyBase';
import type { Fortress } from '../world/Fortress';
import { ENEMY_BASE_HALF } from '../world/Landmarks';
import type { Tree } from '../world/Tree';
import type { LandmarkSet } from '../world/LandmarkBuilders';
import { TOWNS } from '../world/TownPlan';
import { PlayerTank } from '../entities/PlayerTank';
import type { Tank, Faction } from '../entities/Tank';
import { EnemyTank } from '../entities/EnemyTank';
import { BuddyTank, RedTank, type AllyTarget } from '../entities/AllyTank';
import { TroopManager } from '../entities/TroopManager';
import type { Shot } from '../entities/Soldier';
import { HitRegistry } from '../combat/HitRegistry';
import { ProjectileManager } from '../combat/ProjectileManager';
import { ImpactEffects } from '../combat/ImpactEffects';
import { predictTrajectory } from '../combat/Projectile';
import { HomingRocket, type RocketTarget } from '../combat/HomingRocket';
import { JamCannon } from '../combat/JamCannon';
import { CameraRig } from '../camera/CameraRig';
import { HUD, type HUDState } from '../ui/HUD';
import { WorldMap, type MapMarker, type MapView } from '../ui/WorldMap';
import { AimGuide, type AimTarget } from '../ui/AimGuide';
import { FRIENDLY_BASES, nearestFriendlyBase, BASE_RADIUS, type FriendlyBase } from '../core/config';
import { ARMY_GREEN, ARMY_RED, shade } from '../utils/plastic';
import { loadSettings, saveSettings, AIM_SPEED_SCALE, type Settings } from './Settings';

const RESPAWN_DELAY = 25;
const BASE_HEAL_RATE = 45; // HP/sec while inside a family base
const BULLET_SPEED = 220;
const BULLET_DAMAGE = 0.7;
const BLAST_RADIUS = 7; // per unit of explosion size, for knocking soldiers over
const BULLET_HIT_RADIUS = 1.2; // a rifle round landing this close knocks a soldier over
const RUN_OVER_RADIUS = 2.8;
// Jam cannon: short-range lobbed jam that sticks infantry fast, then they slip over.
const JAM_SPEED = 36;
const JAM_RADIUS = 3; // per splat; a held spray lays a whole line of them
const JAM_STUCK_TIME = 5;
const GUN_JAM_TIME = 4; // friendly fire: a teammate's gun is gummed up this long
const RED_RESPAWN_DELAY = 40;
const GARRISON_SQUAD_SIZE = 6;
// Final assault on the Fortress.
const FORTRESS_CHECKLIST_RANGE = 480;
const ESCORT_TANKS = 8; // form up behind the player
const GATE_TANKS = 4; // waiting at each gate
const ASSAULT_GREEN = shade(ARMY_GREEN, 1.18);

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

// Buddy tanks: a long recharge, starting full. Each slot has its own crew.
const BUDDY_RECHARGE_TIME = 300;
const BUDDY_NAMES = ['Keston', 'Max', 'Innes', 'Jason'];
const MAX_BUDDIES = BUDDY_NAMES.length;

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

/** An allied (non-buddy) tank: the red army round the towns, or the final-assault columns. */
interface RedSlot {
  route: THREE.Vector3[];
  tank: RedTank | null;
  respawnTimer: number;
  color: number;
  /** Waypoint the route carries on from after its last point. */
  loopFrom: number;
  /** Waypoint a replacement tank starts at. */
  respawnAt: number;
  /** Replacements keep coming only while this holds (null = always). */
  holdWhile: (() => boolean) | null;
}

interface FamilyBase {
  info: FriendlyBase;
  camp: HomeBase;
  /** Hull yaw that faces out of the gate, for spawning/resetting here. */
  spawnYaw: number;
}

function nearestOf(points: THREE.Vector3[], from: THREE.Vector3): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestD = Infinity;
  for (const p of points) {
    const d = p.distanceToSquared(from);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
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
  private jam!: JamCannon;
  private aimGuide!: AimGuide;
  private landmarks!: LandmarkSet;
  private troops!: TroopManager;
  private player!: PlayerTank;
  private familyBases: FamilyBase[] = [];
  private enemyBases: EnemyBase[] = [];
  private announcedBases = new Set<EnemyBase>();
  private buildings: Building[] = [];
  private trees: Tree[] = [];
  private enemySlots: EnemySlot[] = [];
  /** Enemy pillboxes. */
  private bunkers: Bunker[] = [];
  /** Green pillboxes set up in captured enemy bases. */
  private friendlyBunkers: Bunker[] = [];
  private buddies: BuddyTank[] = [];
  private redSlots: RedSlot[] = [];
  private fortress!: Fortress;
  private finalAssault = false;
  private fortressAnnounced = false;
  /** Next buddy in the rota; a knocked-out buddy's turn passes to the next name. */
  private nextBuddy = 0;
  private rocketCharge = 0;
  private buddyCharge = 1;
  private rocketSeq: RocketSequence | null = null;
  /** Delayed secondary explosions (missiles cooking off after a critical hit). */
  private aftershocks: { at: THREE.Vector3; delay: number; size: number }[] = [];
  private victoryTimer = 0;
  private settings: Settings = loadSettings();
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
    this.jam = new JamCannon(this.scene);
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
    this.trees = content.trees;
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
    this.fortress = content.fortress;
    this.landmarks = content.landmarks;
    this.buildings = [...content.buildings, ...content.bunkers.map((b) => b.building)];
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
        content.forests,
        ),
    );
    this.enemySlots = content.enemySpawns.map((spawn) => ({ spawn, tank: null, respawnTimer: 0 }));
    for (const slot of this.enemySlots) this.spawnEnemy(slot);
    this.redSlots = content.redRoutes.map((route) => ({
      route,
      tank: null,
      respawnTimer: 0,
      color: ARMY_RED,
      loopFrom: 0,
      respawnAt: 0,
      holdWhile: null,
    }));
    this.redSlots.forEach((slot, i) => this.spawnRed(slot, i % slot.route.length));

    const home = this.familyBases[0];
    this.player = new PlayerTank(this.world, home.info.x, home.info.z, home.spawnYaw);
    this.scene.add(this.player.root);
    this.hitRegistry.register(this.player.physicsCollider, { kind: 'tank', tank: this.player });
    this.hud.setSettings(this.settings, (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    });
    this.applySettings();

    this.loadingLabel.remove();
    this.ready = true;
    this.hud.showBanner('GREEN & RED ARE FRIENDS', 'Tan and blue are the enemy. Knock out their bases!');
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = this;
    this.clock.start();
    requestAnimationFrame(this.animate);
  }

  // ---------- spawning ----------

  private spawnEnemy(slot: EnemySlot): void {
    const { x, z, patrolCenter, patrolRadius, color } = slot.spawn;
    const tank = new EnemyTank(this.world, x, z, patrolCenter, patrolRadius, Math.random, color);
    this.scene.add(tank.root);
    this.hitRegistry.register(tank.physicsCollider, { kind: 'tank', tank });
    slot.tank = tank;
  }

  private removeEnemy(slot: EnemySlot): void {
    if (!slot.tank) return;
    this.explode(slot.tank.position.clone(), 2.5, null);
    this.addRocketCharge(CHARGE_PER_TANK);
    this.hitRegistry.unregister(slot.tank.physicsCollider);
    this.scene.remove(slot.tank.root);
    slot.tank.dispose();
    slot.tank = null;
    slot.respawnTimer = RESPAWN_DELAY;
  }

  private spawnRed(slot: RedSlot, start = 0): void {
    const tank = new RedTank(this.world, slot.route, start, slot.color, slot.loopFrom);
    this.scene.add(tank.root);
    this.hitRegistry.register(tank.physicsCollider, { kind: 'tank', tank });
    slot.tank = tank;
  }

  private removeRed(slot: RedSlot): void {
    if (!slot.tank) return;
    this.explode(slot.tank.position.clone(), 2.5, null);
    this.hitRegistry.unregister(slot.tank.physicsCollider);
    this.scene.remove(slot.tank.root);
    slot.tank.dispose();
    slot.tank = null;
    slot.respawnTimer = RED_RESPAWN_DELAY;
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

    // Take the next name in the rota that isn't already out.
    const out = new Set(this.buddies.map((b) => b.name));
    let pick = this.nextBuddy;
    for (let k = 0; k < BUDDY_NAMES.length; k++) {
      const i = (this.nextBuddy + k) % BUDDY_NAMES.length;
      if (!out.has(BUDDY_NAMES[i])) {
        pick = i;
        break;
      }
    }
    this.nextBuddy = (pick + 1) % BUDDY_NAMES.length;
    const name = BUDDY_NAMES[pick];
    const buddy = new BuddyTank(this.world, spot.x, spot.z, this.player.yaw, slot, name);
    this.scene.add(buddy.root);
    buddy.setNameTagVisible(this.settings.nameTags);
    this.hitRegistry.register(buddy.physicsCollider, { kind: 'tank', tank: buddy });
    this.buddies.push(buddy);
    this.impacts.splash(spot, 0.6); // a puff of dust as it rolls in
    this.buddyCharge = 0;
    this.hud.showBanner(`${name.toUpperCase()} IS ROLLING IN!`, `${this.buddies.length} of ${MAX_BUDDIES} buddy tanks with you`);
  }

  private applySettings(): void {
    this.player.driveStyle = this.settings.driveStyle;
    this.input.setAimScale(AIM_SPEED_SCALE[this.settings.aimSpeed]);
    for (const b of this.buddies) b.setNameTagVisible(this.settings.nameTags);
  }

  private removeBuddy(buddy: BuddyTank): void {
    this.explode(buddy.position.clone(), 2.5, null);
    this.hud.showBanner(`${buddy.name.toUpperCase()}'S TANK IS KNOCKED OUT!`, 'Call them back in when the buddy meter is full');
    this.hitRegistry.unregister(buddy.physicsCollider);
    this.scene.remove(buddy.root);
    buddy.dispose();
    this.buddies = this.buddies.filter((b) => b !== buddy);
  }

  // ---------- combat ----------

  private addRocketCharge(amount: number): void {
    this.rocketCharge = Math.min(1, this.rocketCharge + amount);
  }

  /** A blast knocks over the other side's soldiers (`attacker` null = everyone's). */
  private explode(point: THREE.Vector3, size: number, attacker: Faction | null): void {
    this.impacts.explode(point, size);
    const knocked = this.troops.blast(point, BLAST_RADIUS * size, attacker);
    if (attacker === 'player') this.addRocketCharge(knocked * CHARGE_PER_TROOP);
    // During rocket cam the camera is near the blast, not the tank.
    const camDist = point.distanceTo(this.rocketSeq ? this.camera.position : this.player.position);
    this.cameraRig.addShake((size * 0.9) / Math.max(1, camDist / 12));
  }

  private isBunker(building: Building): boolean {
    return this.bunkers.some((b) => b.building === building);
  }

  private collapseBuilding(building: Building, attacker: Faction | null): void {
    this.explode(building.center.clone(), building.explosionSize, attacker);
    const footprint = Math.max(building.halfExtents.x, building.halfExtents.z);
    this.impacts.addSmokeSource(building.groundCenter, footprint * 0.6);
    if (attacker === 'player') this.addRocketCharge(this.isBunker(building) ? CHARGE_PER_BUNKER : CHARGE_PER_BUILDING);
  }

  private fire(tank: Tank, shot: Shot): void {
    this.impacts.muzzleFlash(shot.origin, shot.direction);
    if (tank === this.player) this.cameraRig.addShake(0.35);
    this.projectiles.spawn(
      shot.origin,
      shot.direction,
      tank.muzzleSpeed,
      tank.shellDamage,
      tank.physicsCollider,
      (point, result) => {
        if (result.collapsedBuilding) this.collapseBuilding(result.collapsedBuilding, tank.faction);
        else if (result.water) this.impacts.splash(point, 1);
        else if (result.treeHit) this.impacts.dustPuff(point);
        else this.explode(point, 1, tank.faction);
        if (tank === this.player && result.tankHit) this.hud.showHitMarker(result.tankHit.zone);
        if (result.critical) this.onCriticalHit(result.critical, point, tank === this.player);
      },
      1,
      tank.faction,
    );
  }

  /** A shell found a weak point: callout for the player, and missiles cook off in a chain of blasts. */
  private onCriticalHit(label: string, point: THREE.Vector3, byPlayer: boolean): void {
    if (byPlayer) this.hud.showCallout(`CRITICAL HIT! ${label.toUpperCase()}`, '#ffd24a');
    if (label === 'Missiles' || label === 'Fuel tank') {
      for (let i = 1; i <= 4; i++) {
        const off = new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 3, (Math.random() - 0.5) * 12);
        this.aftershocks.push({ at: point.clone().add(off), delay: i * 0.22 + Math.random() * 0.15, size: 1.4 + Math.random() });
      }
    }
  }

  /** Small-arms fire from troops and bunker machine guns; a round landing by a soldier drops him. */
  private fireBullet(shot: Shot, exclude: RAPIER.Collider | undefined, faction: Faction): void {
    this.projectiles.spawn(
      shot.origin,
      shot.direction,
      BULLET_SPEED,
      BULLET_DAMAGE,
      exclude,
      (point, result) => {
        if (result.collapsedBuilding) this.collapseBuilding(result.collapsedBuilding, faction);
        else if (result.water) this.impacts.splash(point, 0.25);
        else this.impacts.dustPuff(point);
        this.troops.shoot(point, BULLET_HIT_RADIUS, faction);
      },
      0.45,
      faction,
    );
  }

  private get redTanks(): RedTank[] {
    return this.redSlots.flatMap((s) => (s.tank ? [s.tank] : []));
  }

  /** Everything the enemy shoots at: the player, buddies, the red army and green garrisons. */
  private enemyTargets(): { position: THREE.Vector3 }[] {
    return [
      this.player,
      ...this.buddies,
      ...this.redTanks,
      ...this.troops.activeSoldiers('player'),
      ...this.friendlyBunkers.filter((b) => b.alive),
    ];
  }

  /** Everything the player's side shoots at. */
  private playerSideTargets(): { position: THREE.Vector3 }[] {
    return [
      ...this.enemySlots.flatMap((s) => (s.tank ? [s.tank] : [])),
      ...this.troops.activeSoldiers('enemy'),
      ...this.bunkers.filter((b) => b.alive),
    ];
  }

  /** Everything an allied tank might shoot at, most valuable first. */
  private allyTargets(): AllyTarget[] {
    const targets: AllyTarget[] = [];
    for (const slot of this.enemySlots) {
      const tank = slot.tank;
      if (tank) targets.push({ position: tank.position, priority: 3, alive: () => !tank.isDestroyed });
    }
    for (const base of this.enemyBases) {
      for (const o of base.objectives) if (!o.isDestroyed()) targets.push({ position: o.position, priority: 2.5, alive: () => !o.isDestroyed() });
    }
    if (!this.fortress.locked) {
      for (const o of this.fortress.objectives) if (!o.isDestroyed()) targets.push({ position: o.position, priority: 2.5, alive: () => !o.isDestroyed() });
    }
    for (const bunker of this.bunkers) {
      if (bunker.alive) targets.push({ position: bunker.position, priority: 2, alive: () => bunker.alive });
    }
    for (const s of this.troops.activeSoldiers('enemy')) targets.push({ position: s.position, priority: 1, alive: () => s.isActive });
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
    if (!this.fortress.locked) {
      for (const o of this.fortress.objectives) if (!o.isDestroyed()) consider(o.position, 0.05, () => (o.isDestroyed() ? null : o.position));
    }
    for (const bunker of this.bunkers) {
      if (bunker.alive) consider(bunker.position, 0.08, () => (bunker.alive ? bunker.position : null));
    }
    for (const soldier of this.troops.activeSoldiers('enemy')) {
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
    const origin = this.player.rocketLaunchPoint;
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
    this.player.setRocketReady(false);
    this.player.invulnerable = true;
    this.rocketSeq = { rocket, phase: 'flight', timer: 0, point: new THREE.Vector3(), orbit: 0 };
  }

  /** Big blast: wrecks tanks, buildings and troops around the impact. */
  private rocketBlast(point: THREE.Vector3): void {
    this.explode(point, 3.4, 'player');
    this.impacts.addSmokeSource(point.clone(), 3, 25);

    for (const slot of this.enemySlots) {
      if (!slot.tank) continue;
      const d = slot.tank.position.distanceTo(point);
      if (d < ROCKET_BLAST_RADIUS) slot.tank.takeDamage(ROCKET_DAMAGE * (1 - (d / ROCKET_BLAST_RADIUS) ** 2));
    }

    const closest = new THREE.Vector3();
    for (const building of this.buildings) {
      if (building.destroyed || building.faction === 'player') continue;
      const box = new THREE.Box3().setFromCenterAndSize(building.center, building.halfExtents.clone().multiplyScalar(2));
      const d = box.clampPoint(point, closest).distanceTo(point);
      if (d >= ROCKET_BLAST_RADIUS) continue;
      building.takeDamage(ROCKET_DAMAGE * 1.6 * (1 - (d / ROCKET_BLAST_RADIUS) ** 2));
      if (building.destroyed) this.collapseBuilding(building, 'player');
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
      this.garrison(base);
      const left = this.enemyBases.length - this.announcedBases.size;
      if (left === 0) {
        this.startFinalAssault();
      } else {
        this.hud.showBanner(
          `${base.title.toUpperCase()} DESTROYED!`,
          `Green troops are moving in · ${left} enemy base${left > 1 ? 's' : ''} to go`,
        );
      }
    }
    this.fortress.update(dt);
    if (!this.fortressAnnounced && this.fortress.isDestroyed) {
      this.fortressAnnounced = true;
      this.troops.blast(this.fortress.center, 150, 'player'); // the last defenders scatter
      this.hud.showVictory();
      this.victoryTimer = VICTORY_SCREEN_TIME;
    }
    if (this.victoryTimer > 0) {
      this.victoryTimer -= dt;
      if (this.victoryTimer <= 0) this.hud.hideVictory();
    }
  }

  /**
   * Every enemy base has fallen: the Fortress opens, the rocket and buddy meters refill, and
   * columns of green and red tanks plus infantry join the player for the final assault.
   */
  private startFinalAssault(): void {
    if (this.finalAssault) return;
    this.finalAssault = true;
    this.fortress.unlock();
    this.rocketCharge = 1;
    this.buddyCharge = 1;
    this.hud.showBanner('THE FORTRESS GATES ARE OPEN!', 'Final assault! The whole army is rolling in with you');

    const holdWhile = () => !this.fortress.isDestroyed;
    const sweep = this.fortress.sweepRoute;
    const up = new THREE.Vector3(0, 1, 0);
    const p = this.player.position;
    const gate = this.fortress.gateNear(p.x, p.z);
    // An escort forms up behind the player, then heads for the nearest gate and sweeps inside.
    for (let i = 0; i < ESCORT_TANKS; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const offset = new THREE.Vector3(side * 14, 0, 26 + Math.floor(i / 2) * 13).applyAxisAngle(up, this.player.yaw);
      const start = p.clone().add(offset);
      this.addAssaultTank([start, gate, ...sweep], i % 2 === 0 ? ASSAULT_GREEN : ARMY_RED, 2, 1, holdWhile);
    }
    // More tanks and infantry already waiting outside each gate.
    for (const rally of this.fortress.rallyPoints) {
      for (let i = 0; i < GATE_TANKS; i++) {
        const spot = rally.clone().add(new THREE.Vector3((i - 1.5) * 12, 0, 0));
        this.addAssaultTank([spot, ...sweep], i % 2 === 0 ? ASSAULT_GREEN : ARMY_RED, 1, 0, holdWhile);
      }
      for (const [dx, color] of [[-18, ARMY_GREEN], [0, ARMY_RED], [18, ARMY_GREEN]] as [number, number][]) {
        this.troops.addSquad({
          anchor: new THREE.Vector2(rally.x + dx, rally.z),
          count: GARRISON_SQUAD_SIZE,
          wanderRadius: 20,
          faction: 'player',
          color,
          holdWhile,
        });
      }
    }
  }

  private addAssaultTank(route: THREE.Vector3[], color: number, loopFrom: number, respawnAt: number, holdWhile: () => boolean): void {
    const slot: RedSlot = { route, tank: null, respawnTimer: 0, color, loopFrom, respawnAt, holdWhile };
    this.redSlots.push(slot);
    this.spawnRed(slot, 0);
    this.impacts.splash(route[0].clone(), 0.8);
  }

  /** A captured base becomes a green outpost: pillboxes and squads that fight anything nearby. */
  private garrison(base: EnemyBase): void {
    // What's left of the enemy garrison is routed: bowled over as the base falls.
    this.troops.blast(base.center, ENEMY_BASE_HALF * 1.3, 'player');
    const layout = base.garrisonLayout();
    for (const spot of layout.bunkers) {
      const bunker = new Bunker(this.world, this.scene, this.hitRegistry, spot.x, spot.z, spot.facing, 'player', ARMY_GREEN);
      this.friendlyBunkers.push(bunker);
      this.buildings.push(bunker.building);
      this.impacts.splash(bunker.position.clone(), 1.2); // a puff of dust as it drops into place
    }
    for (const anchor of layout.squads) {
      this.troops.addSquad({
        anchor,
        count: GARRISON_SQUAD_SIZE,
        wanderRadius: 12,
        faction: 'player',
        color: ARMY_GREEN,
        holdWhile: null,
      });
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
    const pts = traj.points;
    const travel = pts.length > 1 ? pts[pts.length - 1].clone().sub(pts[pts.length - 2]) : this.player.muzzleWorldDirection;
    const target = this.classifyTarget(traj.hitCollider, traj.impact, travel);
    this.aimGuide.update(traj, target, this.camera);
    return { screen: this.toScreen(traj.impact), range: traj.normal ? traj.range : null, target };
  }

  private toScreen(world: THREE.Vector3): { x: number; y: number } | null {
    const ndc = world.clone().project(this.camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.2 || Math.abs(ndc.y) > 1.2) return null;
    return { x: ((ndc.x + 1) / 2) * window.innerWidth, y: ((1 - ndc.y) / 2) * window.innerHeight };
  }

  private classifyTarget(collider: RAPIER.Collider | null, impact: THREE.Vector3, travel: THREE.Vector3): AimTarget {
    if (!collider) return 'none';
    const hit = this.hitRegistry.lookup(collider);
    if (!hit || hit.kind === 'terrain' || hit.kind === 'water' || hit.kind === 'tree') return 'ground';
    if (hit.kind === 'tank') return hit.tank.faction === 'player' ? 'ground' : 'enemy';
    if (hit.building.faction === 'player') return 'ground';
    if (hit.building.critAt(impact, travel)) return 'critical';
    return hit.building.faction === 'enemy' ? 'enemy' : 'building';
  }

  private collectMarkers(): MapMarker[] {
    const markers: MapMarker[] = [];
    this.troops.collectMarkers(markers);
    for (const b of this.bunkers) {
      if (b.alive) markers.push({ x: b.position.x, z: b.position.z, kind: 'bunker', friendly: false });
    }
    for (const b of this.friendlyBunkers) {
      if (b.alive) markers.push({ x: b.position.x, z: b.position.z, kind: 'bunker', friendly: true });
    }
    for (const slot of this.enemySlots) {
      if (slot.tank) markers.push({ x: slot.tank.position.x, z: slot.tank.position.z, kind: 'tank', friendly: false });
    }
    for (const tank of this.redTanks) markers.push({ x: tank.position.x, z: tank.position.z, kind: 'tank', friendly: true });
    return markers;
  }

  private mapView(): MapView {
    const base = this.nearestEnemyBase(true);
    const f = this.fortress;
    // Point at the nearest standing base; once they're all down, at the Fortress.
    const objective = base
      ? { x: base.base.center.x, z: base.base.center.z, name: base.base.name }
      : f.isDestroyed
        ? null
        : { x: f.center.x, z: f.center.z, name: f.name };
    return {
      playerX: this.player.position.x,
      playerZ: this.player.position.z,
      playerYaw: this.player.yaw,
      friendlyBases: FRIENDLY_BASES,
      enemyBases: this.enemyBases.map((b) => ({ x: b.center.x, z: b.center.z, name: b.name, title: b.title, destroyed: b.isDestroyed })),
      buddies: this.buddies.map((b) => ({ x: b.position.x, z: b.position.z, name: b.name })),
      markers: this.collectMarkers(),
      objective,
      fortress: { x: f.center.x, z: f.center.z, name: f.name, title: f.title, locked: f.locked, destroyed: f.isDestroyed },
    };
  }

  private hudState(input: InputState, cinematic: boolean, aim: ReturnType<Game['updateAim']>, lockScreen: { x: number; y: number } | null): HUDState {
    const near = this.nearestEnemyBase(false);
    const inside = isInsideBase(this.player.position);
    const f = this.fortress;
    const fortressDist = Math.hypot(f.center.x - this.player.position.x, f.center.z - this.player.position.z);
    const checklist =
      fortressDist < FORTRESS_CHECKLIST_RANGE && (!near || fortressDist < near.distance)
        ? {
            name: f.title,
            distance: fortressDist,
            objectives: f.locked
              ? [{ label: `Locked! Destroy all ${this.enemyBases.length} enemy bases to open the gates`, done: false }]
              : f.objectives.map((o) => ({ label: o.label, done: o.isDestroyed() })),
          }
        : near && near.distance < CHECKLIST_RANGE
          ? {
              name: near.base.title,
              distance: near.distance,
              objectives: near.base.objectives.map((o) => ({ label: o.label, done: o.isDestroyed() })),
            }
          : null;
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
      buddyRoster: BUDDY_NAMES,
      buddyNames: this.buddies.map((b) => b.name),
      driveStyle: this.settings.driveStyle,
      mouseCaptureHint: !input.usingGamepad && !input.pointerLocked && input.pointerLockAvailable,
      buddyMax: MAX_BUDDIES,
      cinematic,
      enemyBasesLeft: this.enemyBases.filter((b) => !b.isDestroyed).length,
      enemyBasesTotal: this.enemyBases.length,
      nearbyBase: checklist,
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
      this.hud.handleMenu(rawInput.menu);
      if (rawInput.mapTogglePressed && this.hud.paused) this.hud.toggleBigMap();
      this.hud.update(this.hudState(rawInput, false, { screen: null, range: null, target: 'none' }, null));
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const inSequence = this.rocketSeq !== null;
    // The tank sits still (and can't be hurt) while the rocket cam plays.
    const input = inSequence
      ? { ...rawInput, throttle: 0, steer: 0, moveX: 0, moveY: 0, aimYawDelta: 0, aimPitchDelta: 0, firing: false, jamFiring: false }
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
    this.player.setRocketReady(this.rocketCharge >= 1 && !this.rocketSeq);

    const playerShot = this.player.step(input, dt);
    if (playerShot) this.fire(this.player, playerShot);
    if (input.jamFiring) {
      const glob = this.player.tryJam();
      if (glob) this.jam.fire(glob.origin, glob.direction, JAM_SPEED * glob.speedScale);
    }
    this.jam.update(dt, this.world, this.player.physicsCollider, (point) => {
      const caught = this.troops.jam(point, JAM_RADIUS, 'player', JAM_STUCK_TIME);
      this.addRocketCharge(caught * CHARGE_PER_TROOP);
      // Jam on your own side doesn't hurt, but it gums up their guns for a bit.
      const fumbled = this.troops.jamGuns(point, JAM_RADIUS, 'player', GUN_JAM_TIME);
      let jammedTank: string | null = null;
      for (const tank of [...this.buddies, ...this.redTanks]) {
        if (tank.position.distanceTo(point) < JAM_RADIUS + 2 && tank.jamGun(GUN_JAM_TIME)) {
          jammedTank = tank instanceof BuddyTank ? `${tank.name.toUpperCase()}'S` : "A FRIENDLY TANK'S";
        }
      }
      if (jammedTank) this.hud.showCallout(`OOPS! ${jammedTank} GUN IS JAMMED`, '#ff8aa8');
      else if (fumbled > 0) this.hud.showCallout(fumbled > 1 ? `OOPS! ${fumbled} FRIENDLY GUNS JAMMED` : 'OOPS! FRIENDLY GUN JAMMED', '#ff8aa8');
    });

    // Who's shooting at whom this frame.
    const enemyTargets = this.enemyTargets();
    const enemyTargetPositions = enemyTargets.map((t) => t.position);
    const playerSidePositions = this.playerSideTargets().map((t) => t.position);

    for (const slot of this.enemySlots) {
      if (slot.tank) {
        if (slot.tank.isDestroyed) {
          this.removeEnemy(slot);
          continue;
        }
        const shot = slot.tank.ai(this.world, enemyTargets, dt);
        if (shot) this.fire(slot.tank, shot);
      } else {
        slot.respawnTimer -= dt;
        // Guards of a captured base don't come back.
        if (slot.respawnTimer <= 0 && (slot.spawn.holdWhile?.() ?? true)) this.spawnEnemy(slot);
      }
    }

    const allyTargets = this.allyTargets();
    for (const buddy of [...this.buddies]) {
      if (buddy.isDestroyed) {
        this.removeBuddy(buddy);
        continue;
      }
      const shot = buddy.think(dt, this.world, this.player, allyTargets);
      if (shot) this.fire(buddy, shot);
    }
    for (const slot of this.redSlots) {
      if (slot.tank) {
        if (slot.tank.isDestroyed) {
          this.removeRed(slot);
          continue;
        }
        const shot = slot.tank.think(dt, this.world, allyTargets);
        if (shot) this.fire(slot.tank, shot);
      } else if (!slot.holdWhile || slot.holdWhile()) {
        slot.respawnTimer -= dt;
        if (slot.respawnTimer <= 0) this.spawnRed(slot, slot.respawnAt);
      }
    }

    for (const bunker of this.bunkers) {
      const shot = bunker.update(dt, this.world, nearestOf(enemyTargetPositions, bunker.position));
      if (shot) this.fireBullet(shot, bunker.building.physicsCollider ?? undefined, 'enemy');
    }
    for (const bunker of this.friendlyBunkers) {
      const shot = bunker.update(dt, this.world, nearestOf(playerSidePositions, bunker.position));
      if (shot) this.fireBullet(shot, bunker.building.physicsCollider ?? undefined, 'player');
    }
    this.troops.update(
      dt,
      this.world,
      this.player.position,
      { enemy: enemyTargetPositions, player: playerSidePositions },
      (shot, faction) => this.fireBullet(shot, undefined, faction),
    );
    this.addRocketCharge(this.troops.runOver(this.player.position, RUN_OVER_RADIUS, 'player') * CHARGE_PER_TROOP);

    const tankPositions = [this.player, ...this.buddies, ...this.enemySlots.flatMap((slot) => slot.tank ? [slot.tank] : []), ...this.redSlots.flatMap((slot) => slot.tank ? [slot.tank] : [])]
      .filter((tank) => !tank.isDestroyed)
      .map((tank) => tank.position);
    for (const tree of this.trees) tree.update(dt, tankPositions);

    this.world.step();
    this.projectiles.update(dt);
    this.impacts.update(dt);
    for (let i = this.aftershocks.length - 1; i >= 0; i--) {
      const a = this.aftershocks[i];
      a.delay -= dt;
      if (a.delay > 0) continue;
      this.explode(a.at, a.size, 'player');
      this.aftershocks.splice(i, 1);
    }
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
