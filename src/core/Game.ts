import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, createWorld } from '../physics/PhysicsWorld';
import { InputManager, type InputState } from '../input/InputManager';
import { buildTerrain, surfaceHeightAt, waterDepthAt } from '../world/Terrain';
import { AssetLibrary } from '../world/AssetLibrary';
import { generateWorld, type EnemySpawnPoint } from '../world/WorldGenerator';
import { HomeBase, isInsideBase } from '../world/Base';
import { distanceToPolyline, HIGHWAY_WIDTH, type Polyline } from '../world/RoadNetwork';
import { JeepStation } from '../world/JeepStation';
import { ChopperStation } from '../world/ChopperStation';
import type { Building } from '../world/Building';
import { Bunker } from '../world/Bunker';
import type { EnemyBase } from '../world/EnemyBase';
import type { Fortress } from '../world/Fortress';
import { ENEMY_BASE_HALF } from '../world/Landmarks';
import type { Tree } from '../world/Tree';
import type { LandmarkSet } from '../world/LandmarkBuilders';
import { TOWNS } from '../world/TownPlan';
import { PlayerTank, type Vehicle } from '../entities/PlayerTank';
import type { Tank, Faction } from '../entities/Tank';
import { EnemyTank } from '../entities/EnemyTank';
import { HelicopterEnemy } from '../entities/HelicopterEnemy';
import { BuddyTank, RedTank, type AllyTarget } from '../entities/AllyTank';
import { TroopManager } from '../entities/TroopManager';
import { ZOMBIE_COLOR, type Shot } from '../entities/Soldier';
import { HitRegistry } from '../combat/HitRegistry';
import { ProjectileManager } from '../combat/ProjectileManager';
import { ImpactEffects } from '../combat/ImpactEffects';
import { predictTrajectory, type Trajectory } from '../combat/Projectile';
import { HomingRocket, type RocketTarget } from '../combat/HomingRocket';
import { JamCannon } from '../combat/JamCannon';
import { AAMissiles, AA_SALVO, AA_CAPACITY, type AirTrack } from '../combat/AAMissiles';
import { Wrecks, pickWreckGag } from '../combat/Wrecks';
import { CameraRig } from '../camera/CameraRig';
import { HUD, type HUDState } from '../ui/HUD';
import { WorldMap, type MapMarker, type MapView } from '../ui/WorldMap';
import { AimGuide, type AimTarget } from '../ui/AimGuide';
import { FRIENDLY_BASES, nearestFriendlyBase, BASE_RADIUS, MISSION, MISSIONS, NIGHT, JUNGLE, KNIGHTS, ZOMBIES, startMission, type FriendlyBase, type Mission } from '../core/config';
import { ZombieWaves } from '../world/ZombieWaves';
import type { ShotStyle } from '../combat/Projectile';
import { NightSky, MOON_DIRECTION } from '../world/NightSky';
import { ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE, shade } from '../utils/plastic';
import { Sound } from '../audio/Sound';
import { loadSettings, saveSettings, AIM_SPEED_SCALE, DEFAULT_BUDDY_NAMES, type Settings } from './Settings';

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
const JAM_DRIP_RADIUS = 2.2; // jam dripping off the globs in flight catches whatever is under their path
const TANK_STUCK_TIME = 4; // an enemy tank caught in jam can't drive for this long (topped up by more jam)
// Mega jam (X): rings of jam lobbed out all round the tank, then a wait while it refills.
const MEGA_JAM_RECHARGE = 20;
const MEGA_JAM_RINGS = [7, 12.5, 18]; // landing distance of each ring, metres
const MEGA_JAM_PER_RING = 16;
// Drunken AA missiles: six-dart salvos at a locked helicopter; rearm at a home base.
const AA_REARM_TIME = 0.4; // seconds per dart while parked at a home base
const AA_RANGE = 450;
const AA_LOCK_CONE = (45 * Math.PI) / 180; // the helicopter must be roughly where the turret points
const AA_DAMAGE = 50; // a helicopter has 85 HP: any two darts that get close, which the light seeking makes hard work
const AA_BLAST_RADIUS = 10;
const RED_RESPAWN_DELAY = 40;
const GARRISON_SQUAD_SIZE = 6;
// Final assault on the Fortress.
const FORTRESS_CHECKLIST_RANGE = 480;
const ESCORT_TANKS = 8; // form up behind the player
const GATE_TANKS = 4; // waiting at each gate
const ASSAULT_GREEN = shade(ARMY_GREEN, 1.18);
// A fuel tank going up: a fireball that hurts enemy tanks and buildings nearby (other fuel tanks too).
const FUEL_BLAST_RADIUS = 24;
const FUEL_BLAST_DAMAGE = 120;

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

// Changing stations: drive through a jeep station and the tank becomes a fast jeep for a while,
// or onto a chopper station's pad and it takes off as a chopper (the times are in the options).
// The jeep's trigger fires jam rounds, the chopper's its chin gun; LB / F fires quick-reloading
// missiles from either.
const JEEP_JAM_SPEED = 130; // m/s: flat and fast, like bullets
const CHOPPER_GUN_SPEED = 190;
const CHOPPER_GUN_DAMAGE = 4; // a tank shell does 26; the chin gun fires ten a second
const CHOPPER_GUN_BLAST = 0.4;
const MISSILE_RECHARGE = 8; // seconds (the tank's rocket takes 75)
const MISSILE_DAMAGE = 95;
const MISSILE_RADIUS = 12;
const MISSILE_BLAST = 2.3;
const MISSILE_SCALE = 0.6;
/** The model swap happens this long into the smoke puff, once the cloud has thickened. */
const CHANGE_SWAP_DELAY = 0.18;
/** Where a station stands outside a home base's wall, and how far either side of the road. */
const STATION_RADIUS = 80;
const STATION_ANGLES = [-0.36, -0.55, 0.62, -0.8, 0.85]; // off the gate; the keepsake sits at +0.36
const STATION_ROAD_CLEARANCE = HIGHWAY_WIDTH / 2 + 11;
/** A chopper tops up its time anywhere this much wider than the pad (it's hard to see straight down). */
const CHOPPER_TOP_UP_REACH = 8;
/** Below this height the chopper counts as on the ground: it knocks trees over and splashes through lakes. */
const CHOPPER_LOW = 4;

// Buddy tanks: a long recharge, starting full. Each slot has its own crew.
const BUDDY_RECHARGE_TIME = 300;
// Crews come from the options (Keston, Max, Innes and Jason unless renamed).
const MAX_BUDDIES = DEFAULT_BUDDY_NAMES.length;

// Enemy base objectives.
const CHECKLIST_RANGE = 350; // show the target list when this close to an enemy base
const VICTORY_SCREEN_TIME = 9;
const NEXT_MISSION_DELAY = 12; // after winning a mission, the next one starts this long after the victory screen
/** The mission that follows this one, if any. */
const nextMission = MISSIONS.find((m) => m.mission === MISSION + 1);
/** Where the jungle haze turns fully opaque. */
const JUNGLE_FOG_FAR = 950;

// The zombie mission: every army holds the Fortress while waves of zombies come at it. Zombies
// that reach the wall batter it; when the wall's strength runs out, the zombies are in and the
// game is over. The waves grow faster than anyone can keep up with, so it falls in the end.
const FORT_STRENGTH = 1200;
/**
 * Wall damage per blow from a walker (brutes hit harder); it grows a little with every wave. A
 * crowd at the wall shares it out (it does the square root of the crowd's worth), so a horde
 * wears the wall down over a couple of minutes rather than smashing it in seconds.
 */
const FORT_BITE = 2.6;
/** About how often each zombie at the wall lands a blow (Soldier's attack time). */
const BLOW_TIME = 1.1;
const BITE_GROWTH = 0.07;
/** The wall is patched up this fast (strength per second) while no zombie is at it. */
const FORT_REPAIR = 1.5;
/** A zombie's blow does this much to a tank (the player can't go below 1), and this much to a pillbox. */
const TANK_BITE = 3;
const BUNKER_BITE = 5;
const BITE_REACH = 3.4;
/** Zombies stop this far outside the wall and batter it. */
const WALL_STOP = 1.5;
const LAST_STAND_COLORS = [ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE];
/** After the zombies get in, how long before a button press starts again (so a held trigger doesn't). */
const RETRY_DELAY = 4;

interface RocketSequence {
  rocket: HomingRocket;
  phase: 'flight' | 'linger';
  timer: number;
  point: THREE.Vector3;
  orbit: number;
}

interface EnemySlot {
  spawn: EnemySpawnPoint;
  tank: EnemyTank | HelicopterEnemy | null;
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

type Station = JeepStation | ChopperStation;

interface FamilyBase {
  info: FriendlyBase;
  camp: HomeBase;
  /** Direction (x = cos, z = sin) from the centre to the gate. */
  gate: number;
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
  private readonly sound = new Sound(MISSION);
  /** Where the player was last frame, for the engine note's speed. */
  private readonly lastPlayerPosition = new THREE.Vector3();
  private readonly loadingLabel: HTMLDivElement;
  private readonly sun: THREE.DirectionalLight;

  private world!: RAPIER.World;
  private projectiles!: ProjectileManager;
  private impacts!: ImpactEffects;
  private jam!: JamCannon;
  private aa!: AAMissiles;
  /** Knocked-out tanks going out with a gag: flying turrets, turtles, surrenders, fireworks. */
  private wrecks!: Wrecks;
  /** AA darts left; they only come back by returning to a home base. */
  private aaLoaded = AA_CAPACITY;
  private aaRearm = 0;
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
  private megaJamCharge = 1;
  private rocketSeq: RocketSequence | null = null;
  /** Delayed secondary explosions (missiles cooking off after a critical hit). */
  private aftershocks: { at: THREE.Vector3; delay: number; size: number }[] = [];
  private victoryTimer = 0;
  private settings: Settings = loadSettings();
  private wakeTimer = 0;
  private ready = false;
  private assets!: AssetLibrary;
  /** Stars, moon and distant firefights on the night mission. */
  private nightSky: NightSky | null = null;
  /** Changing stations that turn the tank into a jeep or a chopper. */
  private stations: Station[] = [];
  /** The station the player is in (or over) right now, so passing through one only counts once. */
  private inStation: Station | null = null;
  /** Seconds of jeep or chopper left (0 while it's the tank), out of `rideTimeTotal`. */
  private rideTime = 0;
  private rideTimeTotal = 0;
  /** The jeep's and chopper's missiles: reload (0..1) and the ones in flight. */
  private missileCharge = 1;
  private missiles: HomingRocket[] = [];
  /** The night mission's headlight, which the chopper points down at the ground. */
  private headlight: THREE.SpotLight | null = null;
  /** Seconds until the "Fortress is locked" callout can show again. */
  private fortressWarning = 0;
  /** The vehicle to swap to once the smoke puff has thickened, and how long until then. */
  private pendingSwap: { to: Vehicle; delay: number } | null = null;
  /** The zombie mission's waves, the Fortress wall's strength and how long it's held out. */
  private waves: ZombieWaves | null = null;
  private fortStrength = FORT_STRENGTH;
  private survived = 0;
  /** Zombies battering the wall this frame (and a moment ago, for the HUD). */
  private wallBlows = 0;
  private wallDamage = 0;
  /** About how many zombies are battering the wall (smoothed). */
  private wallCrowd = 0;
  private wallAlarm = 0;
  private gameOverTime = -1;
  /** The score when the wall fell (the defenders keep knocking zombies over after). */
  private finalDowned = 0;
  /** Where the player starts and goes home to on the zombie mission: just outside the Fortress gate. */
  private fortHome: { x: number; z: number; yaw: number } | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // In the jungle haze nothing shows past the fog, so don't draw the thousands of trees out there.
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, JUNGLE ? JUNGLE_FOG_FAR + 60 : 4000);
    this.cameraRig = new CameraRig(this.camera);
    this.input = new InputManager(this.renderer.domElement);
    this.hud = new HUD(container);
    this.hud.setSoundHook((kind) => this.sound.play(kind === 'move' ? 'uiMove' : kind === 'change' ? 'uiChange' : kind === 'back' ? 'uiBack' : kind === 'open' ? 'uiOpen' : 'uiConfirm', { volume: 0.5, minGap: 0 }));

    this.loadingLabel = document.createElement('div');
    this.loadingLabel.style.cssText =
      'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;' +
      "font-size:22px; background:#0a0e14; color:#e8eef5; font-family:'Segoe UI',system-ui,sans-serif; z-index:10;";
    this.loadingLabel.textContent = 'Loading world…';
    container.appendChild(this.loadingLabel);

    // Daylight, or moonlight on the night raid (dark enough for the flares to show, light enough to play).
    // The jungle is a steamy haze: close green-grey fog and warm, filtered sun.
    // The zombies come at dusk: a bruised purple sky and a low orange sun.
    const sky = NIGHT ? 0x0d1733 : JUNGLE ? 0xa9c4a2 : ZOMBIES ? 0xa7a2c2 : KNIGHTS ? 0xa8d9f4 : 0x9fd3f0;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = NIGHT
      ? new THREE.Fog(sky, 280, 1250)
      : JUNGLE
        ? new THREE.Fog(sky, 180, JUNGLE_FOG_FAR)
        : ZOMBIES
          ? new THREE.Fog(sky, 240, 1250)
          : new THREE.Fog(sky, 500, 1700);

    this.scene.add(
      NIGHT
        ? new THREE.HemisphereLight(0x7088c4, 0x1d1b26, 0.5)
        : JUNGLE
          ? new THREE.HemisphereLight(0xd8ecc8, 0x2e3a1c, 0.95)
          : ZOMBIES
            ? new THREE.HemisphereLight(0xe2dcf2, 0x4a4250, 1.05)
            : new THREE.HemisphereLight(0xbfd9ff, 0x3a3226, 0.9),
    );
    this.sun = NIGHT
      ? new THREE.DirectionalLight(0xaec4ff, 0.55)
      : JUNGLE
        ? new THREE.DirectionalLight(0xffe7b8, 1.5)
        : ZOMBIES
          ? new THREE.DirectionalLight(0xffc9a0, 1.6)
          : new THREE.DirectionalLight(0xfff2d9, 1.7);
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
    this.aa = new AAMissiles(this.scene);
    this.wrecks = new Wrecks(this.scene);
    this.aimGuide = new AimGuide(this.scene);

    const terrain = buildTerrain();
    this.scene.add(terrain.mesh);
    const terrainBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const terrainCollider = this.world.createCollider(terrain.colliderDesc, terrainBody);
    this.hitRegistry.register(terrainCollider, { kind: 'terrain' });

    this.assets = new AssetLibrary();
    void this.sound.load(); // in the background: each sound plays once it has loaded
    await this.assets.load((loaded, total) => {
      this.loadingLabel.textContent = `Loading world… ${loaded}/${total}`;
    });

    const content = generateWorld(this.world, this.scene, this.hitRegistry, this.assets);
    this.trees = content.trees;
    this.familyBases = FRIENDLY_BASES.map((info) => {
      const gate = gateAngle(info, content.highways);
      return {
        info,
        camp: new HomeBase(this.world, this.scene, info, gate),
        gate,
        // Face the gate: hull forward (-sin, -cos) should equal (cos gate, sin gate).
        spawnYaw: Math.atan2(-Math.cos(gate), -Math.sin(gate)),
      };
    });
    // Every home base has a station, alternating round the map: a jeep station at the four in the
    // middle of an edge, a chopper station at the four corners.
    for (const fb of this.familyBases) {
      this.addHomeStation(fb, content.highways, fb.info.x === 0 || fb.info.z === 0 ? 'jeep' : 'chopper');
    }
    this.bunkers = content.bunkers;
    this.enemyBases = content.enemyBases;
    this.fortress = content.fortress;
    this.landmarks = content.landmarks;
    this.buildings = [...content.buildings, ...content.bunkers.map((b) => b.building)];
    this.troops = new TroopManager(this.scene, content.squads, Math.random);
    this.troops.shielded = (p) => this.sealedInFortress(p);
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

    if (ZOMBIES) this.setupLastStand(content.highways);
    const home = this.familyBases[0];
    const start = this.fortHome ?? { x: home.info.x, z: home.info.z, yaw: home.spawnYaw };
    this.player = new PlayerTank(this.world, start.x, start.z, start.yaw);
    this.scene.add(this.player.root);
    this.hitRegistry.register(this.player.physicsCollider, { kind: 'tank', tank: this.player });
    this.hud.setSettings(this.settings, (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    });
    this.applySettings();
    this.hud.setMissionStart((m) => startMission(m));
    if (NIGHT) {
      this.nightSky = new NightSky(this.scene, {
        // Tracer marks every standing enemy base (and the Fortress); flares go up over the troops.
        bases: () => [
          ...this.enemyBases.filter((b) => !b.isDestroyed).map((b) => ({ position: b.center, gun: b.aaGun })),
          ...(this.fortress.isDestroyed ? [] : [{ position: this.fortress.center, gun: null }]),
        ],
        troops: () => [
          ...this.troops.activeSoldiers('enemy').map((s) => ({ position: s.position, friendly: false })),
          ...this.troops.activeSoldiers('player').map((s) => ({ position: s.position, friendly: true })),
          ...this.targetableEnemies.map((t) => ({ position: t.position, friendly: false })),
          ...this.redTanks.map((t) => ({ position: t.position, friendly: true })),
        ],
      });
      this.fitHeadlights();
    }

    this.loadingLabel.remove();
    this.ready = true;
    if (MISSION === 2) this.hud.showBanner('MISSION 2: NIGHT RAID', 'The enemy has dug in on new ground. Knock out their bases under the flares!');
    else if (MISSION === 3) this.hud.showBanner('MISSION 3: JUNGLE STRIKE', 'The enemy is hiding in the jungle. Drive or blast through the trees to find their bases!');
    else if (MISSION === 4) this.hud.showBanner('MISSION 4: CASTLE SIEGE', 'Knights, cannons and dragons! Knock down their castles, then the Great Castle');
    else if (MISSION === 5) this.hud.showBanner('MISSION 5: ZOMBIE ATTACK!', 'Every army together! Keep the zombies away from the Fortress wall');
    else this.hud.showBanner('GREEN & RED ARE FRIENDS', 'Tan and blue are the enemy. Knock out their bases!');
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = this;
    this.lastPlayerPosition.copy(this.player.position);
    this.sound.music.start();
    this.clock.start();
    requestAnimationFrame(this.animate);
  }

  /** Night driving: a headlight beam from the front of the hull, lighting the ground ahead. */
  private fitHeadlights(): void {
    const lamp = new THREE.SpotLight(0xfff0c8, 45, 120, 0.6, 0.7, 1);
    this.player.root.add(lamp, lamp.target);
    this.headlight = lamp;
    this.aimHeadlight();
  }

  /** The headlight lights the road ahead, or from the chopper's nose the ground well below. */
  private aimHeadlight(): void {
    const lamp = this.headlight;
    if (!lamp) return;
    const chopper = this.player.isChopper;
    lamp.position.set(0, chopper ? 0.3 : 0.8, chopper ? -2.8 : -2.1);
    lamp.target.position.set(0, chopper ? -60 : -3, chopper ? -45 : -30);
    lamp.distance = chopper ? 170 : 120;
    lamp.intensity = chopper ? 120 : 45;
  }

  // ---------- spawning ----------

  private spawnEnemy(slot: EnemySlot): void {
    const { x, z, patrolCenter, patrolRadius, color } = slot.spawn;
    const tank = slot.spawn.helicopter
      ? new HelicopterEnemy(this.world, x, z, patrolCenter, patrolRadius, Math.random, color)
      : new EnemyTank(this.world, x, z, patrolCenter, patrolRadius, Math.random, color);
    this.scene.add(tank.root);
    this.hitRegistry.register(tank.physicsCollider, { kind: 'tank', tank });
    if (!(tank instanceof HelicopterEnemy)) tank.shielded = this.sealedInFortress(tank.position);
    slot.tank = tank;
  }

  private removeEnemy(slot: EnemySlot, gag = slot.tank instanceof HelicopterEnemy ? null : pickWreckGag()): void {
    const tank = slot.tank;
    if (!tank) return;
    // Now and then a tank goes out with a gag rather than just blowing up (helicopters always blow up).
    this.explode(tank.position.clone(), gag === 'surrender' ? 0.6 : gag === 'firework' ? 1.2 : 2.5, null);
    let keepHull = gag === 'turtle' || gag === 'surrender' || gag === 'firework';
    if (keepHull) tank.root.traverse((o) => o instanceof THREE.Sprite && (o.visible = false)); // its health bar
    if (gag === 'turret') this.wrecks.turretPop(tank.turretPivot);
    else if (gag === 'turtle') this.wrecks.turtle(tank.root);
    else if (gag === 'surrender') this.wrecks.surrender(tank.root, tank.turretPivot, tank.barrelPivot);
    else if (gag === 'firework') this.wrecks.firework(tank.root);
    else keepHull = false;
    this.addRocketCharge(CHARGE_PER_TANK);
    this.hitRegistry.unregister(tank.physicsCollider);
    if (!keepHull) this.scene.remove(tank.root);
    tank.dispose();
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
    spot.y = surfaceHeightAt(spot.x, spot.z); // on the ground, even with the player up in the chopper

    // Take the next crew in the rota that isn't already out.
    const out = new Set(this.buddies.map((b) => b.crew));
    let pick = this.nextBuddy;
    for (let k = 0; k < MAX_BUDDIES; k++) {
      const i = (this.nextBuddy + k) % MAX_BUDDIES;
      if (!out.has(i)) {
        pick = i;
        break;
      }
    }
    this.nextBuddy = (pick + 1) % MAX_BUDDIES;
    const name = this.settings.buddyNames[pick];
    const buddy = new BuddyTank(this.world, spot.x, spot.z, this.player.yaw, slot, pick, name);
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
    this.sound.setVolumes(this.settings.sfxVolume, this.settings.musicVolume);
    for (const b of this.buddies) {
      b.setNameTagVisible(this.settings.nameTags);
      b.rename(this.settings.buddyNames[b.crew]);
    }
  }

  private removeBuddy(buddy: BuddyTank): void {
    this.explode(buddy.position.clone(), 2.5, null);
    this.hud.showBanner(`${buddy.name.toUpperCase()}'S TANK IS KNOCKED OUT!`, 'A new buddy rolls in when the buddy meter is full');
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
    this.sound.play('explosion', { at: point, volume: Math.min(1, 0.35 + size * 0.22), rate: size < 1 ? 1.25 : 1, minGap: 0.05 });
    if (size >= 2.3) this.sound.play('boom', { at: point, volume: 0.9, minGap: 0.1 });
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
    if (building.fuel) this.fuelBlast(building, attacker);
  }

  /** A fuel tank goes up: a ring of fireballs and a blast that can set its neighbours off too. */
  private fuelBlast(tank: Building, attacker: Faction | null): void {
    const point = tank.center.clone();
    this.impacts.addSmokeSource(tank.groundCenter, 6, 45);
    for (let i = 1; i <= 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 9;
      const off = new THREE.Vector3(Math.cos(a) * r, 1 + Math.random() * 6, Math.sin(a) * r);
      this.aftershocks.push({ at: point.clone().add(off), delay: i * 0.18 + Math.random() * 0.12, size: 2 + Math.random() * 1.5 });
    }
    // Only the enemy's things get hurt: fuel is always on their side.
    for (const enemy of this.targetableEnemies) {
      const d = enemy.position.distanceTo(point);
      if (d < FUEL_BLAST_RADIUS) enemy.takeDamage(FUEL_BLAST_DAMAGE * (1 - (d / FUEL_BLAST_RADIUS) ** 2));
    }
    const closest = new THREE.Vector3();
    for (const b of this.buildings) {
      if (b === tank || b.destroyed || b.faction === 'player') continue;
      const box = new THREE.Box3().setFromCenterAndSize(b.center, b.halfExtents.clone().multiplyScalar(2));
      const d = box.clampPoint(point, closest).distanceTo(point);
      if (d >= FUEL_BLAST_RADIUS) continue;
      b.takeDamage(FUEL_BLAST_DAMAGE * (1 - (d / FUEL_BLAST_RADIUS) ** 2));
      if (b.destroyed) this.collapseBuilding(b, attacker);
    }
  }

  private fire(tank: Tank, shot: Shot): void {
    this.impacts.muzzleFlash(shot.origin, shot.direction);
    if (tank === this.player) this.cameraRig.addShake(0.35);
    // A deep boom and a sharp crack; your own gun is right in your ears.
    const at = tank === this.player ? undefined : shot.origin;
    // The knights' dragons breathe fireballs and their cannons fire iron balls.
    const dragon = KNIGHTS && tank instanceof HelicopterEnemy;
    const style: ShotStyle = KNIGHTS && tank.faction === 'enemy' ? (dragon ? 'fireball' : 'cannonball') : 'shell';
    if (dragon) {
      this.sound.play('launch', { at, volume: 0.8, rate: 0.55, fadeAfter: 0.7, minGap: 0.05 });
    } else {
      this.sound.play('cannon', { at, volume: 0.9, minGap: 0.02 });
      this.sound.play('crack', { at, volume: 0.35, rate: 1.6, minGap: 0.02 });
    }
    this.projectiles.spawn(
      shot.origin,
      shot.direction,
      tank.muzzleSpeed,
      tank.shellDamage,
      tank.physicsCollider,
      (point, result) => {
        if (result.collapsedBuilding) this.collapseBuilding(result.collapsedBuilding, tank.faction);
        else if (result.water) this.impacts.splash(point, 1);
        else if (result.tree) {
          // Tank shells fell trees (and lamp posts), so you can blast a way through the jungle.
          result.tree.knockDown(shot.direction);
          this.impacts.dustPuff(point);
        }
        else this.explode(point, 1, tank.faction);
        if (tank === this.player && result.tankHit) {
          this.hud.showHitMarker(result.tankHit.zone);
          this.sound.play('clang', { volume: 0.55 });
        }
        if (result.critical) this.onCriticalHit(result.critical, point, tank === this.player);
      },
      1,
      tank.faction,
      style,
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

  /** X: lob rings of jam out all round the tank, if the mega jam has refilled. */
  private tryMegaJam(): void {
    if (this.megaJamCharge < 1) {
      this.hud.showCallout(`MEGA JAM ${Math.floor(this.megaJamCharge * 100)}%`, '#ff8aa8');
      return;
    }
    this.megaJamCharge = 0;
    const origin = this.player.position.clone().add(new THREE.Vector3(0, 2.8, 0));
    // From the chopper it's flung out level and falls into the same rings on the ground below.
    const drop = this.player.heightAboveGround > CHOPPER_LOW ? origin.y - surfaceHeightAt(origin.x, origin.z) : 0;
    const pitch = drop > 0 ? 0 : 0.7; // lobbed, so it clears anything standing round the tank
    MEGA_JAM_RINGS.forEach((range, ring) => {
      // Speed for that range on a flat lob, or thrown level from a height (jam globs fall at 12 m/s²).
      const speed = drop > 0 ? range * Math.sqrt(12 / (2 * drop)) : Math.sqrt((range * 12) / Math.sin(2 * pitch));
      for (let i = 0; i < MEGA_JAM_PER_RING; i++) {
        const a = ((i + ring * 0.5) / MEGA_JAM_PER_RING) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a) * Math.cos(pitch), Math.sin(pitch), Math.sin(a) * Math.cos(pitch));
        this.jam.fire(origin, dir, speed * (0.93 + Math.random() * 0.14));
      }
    });
    this.cameraRig.addShake(0.5);
    this.hud.showCallout('MEGA JAM!', '#ff8aa8');
  }

  /** Jam landing at `point`: enemy soldiers within `radius` are stuck fast, and enemy tanks can't drive. */
  private jamEnemies(point: THREE.Vector3, radius: number): void {
    const caught = this.troops.jam(point, radius, 'player', JAM_STUCK_TIME);
    this.addRocketCharge(caught * CHARGE_PER_TROOP);
    for (const tank of this.targetableEnemies) {
      // Helicopters fly over it; a tank's hull reaches about 2 m either side of its middle.
      if (tank instanceof HelicopterEnemy || tank.position.distanceTo(point) > radius + 2.2) continue;
      if (tank.stickInJam(TANK_STUCK_TIME)) this.hud.showCallout('ENEMY TANK STUCK IN JAM!', '#ff8aa8');
    }
  }

  /** A jam glob into the front of an enemy bunker gums up its gun for good: a critical hit. */
  private jamBunkerSlit(collider: RAPIER.Collider, point: THREE.Vector3, velocity: THREE.Vector3): void {
    const target = this.hitRegistry.lookup(collider);
    if (target?.kind !== 'building') return;
    const bunker = this.targetableBunkers.find((b) => b.building === target.building);
    if (!bunker?.jamCritAt(point, velocity)) return;
    bunker.building.destroyByCritical();
    this.collapseBuilding(bunker.building, 'player');
    this.onCriticalHit('Jam in the gun slit', point, true);
  }

  /** A round from the chopper's chin gun: a small bang where it lands, for tanks, buildings and troops alike. */
  private fireChinGun(shot: Shot): void {
    this.impacts.muzzleFlash(shot.origin, shot.direction);
    this.sound.play('crack', { volume: 0.3, rate: 2.2, minGap: 0.06 });
    this.projectiles.spawn(
      shot.origin,
      shot.direction,
      CHOPPER_GUN_SPEED,
      CHOPPER_GUN_DAMAGE,
      this.player.physicsCollider,
      (point, result) => {
        if (result.collapsedBuilding) this.collapseBuilding(result.collapsedBuilding, 'player');
        else if (result.water) this.impacts.splash(point, 0.3);
        else if (result.tree) {
          result.tree.knockDown(shot.direction);
          this.impacts.dustPuff(point);
        } else this.explode(point, CHOPPER_GUN_BLAST, 'player');
        if (result.critical) this.onCriticalHit(result.critical, point, true);
      },
      0.55,
      'player',
    );
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
      KNIGHTS && faction === 'enemy' ? 'arrow' : 'shell', // the knights shoot crossbows
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

  /** Inside the Fortress walls while its gates are still locked: out of reach of everything. */
  private sealedInFortress(p: THREE.Vector3): boolean {
    return this.fortress.locked && this.fortress.contains(p.x, p.z);
  }

  /** Enemy tanks and helicopters that can be shot at (not the Fortress's locked-in guards). */
  private get targetableEnemies(): (EnemyTank | HelicopterEnemy)[] {
    return this.enemySlots.flatMap((s) => (s.tank && !s.tank.shielded && !s.tank.isDestroyed ? [s.tank] : []));
  }

  /** Enemy pillboxes that can be shot at. */
  private get targetableBunkers(): Bunker[] {
    return this.bunkers.filter((b) => b.alive && !this.sealedInFortress(b.position));
  }

  /** Everything the player's side shoots at. */
  private playerSideTargets(): { position: THREE.Vector3 }[] {
    return [...this.targetableEnemies, ...this.troops.activeSoldiers('enemy'), ...this.targetableBunkers];
  }

  /** Everything an allied tank might shoot at, most valuable first. */
  private allyTargets(): AllyTarget[] {
    const targets: AllyTarget[] = [];
    for (const tank of this.targetableEnemies) {
      targets.push({ position: tank.position, priority: 3, alive: () => !tank.isDestroyed && !tank.shielded });
    }
    for (const base of this.enemyBases) {
      for (const o of base.objectives) if (!o.isDestroyed()) targets.push({ position: o.position, priority: 2.5, alive: () => !o.isDestroyed() });
    }
    if (!this.fortress.locked && !ZOMBIES) {
      for (const o of this.fortress.objectives) if (!o.isDestroyed()) targets.push({ position: o.position, priority: 2.5, alive: () => !o.isDestroyed() });
    }
    for (const bunker of this.targetableBunkers) targets.push({ position: bunker.position, priority: 2, alive: () => bunker.alive });
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

    for (const tank of this.targetableEnemies) consider(tank.position, 0, () => (tank.isDestroyed ? null : tank.position));
    for (const base of this.enemyBases) {
      for (const o of base.objectives) if (!o.isDestroyed()) consider(o.position, 0.05, () => (o.isDestroyed() ? null : o.position));
    }
    if (!this.fortress.locked && !ZOMBIES) {
      for (const o of this.fortress.objectives) if (!o.isDestroyed()) consider(o.position, 0.05, () => (o.isDestroyed() ? null : o.position));
    }
    for (const bunker of this.targetableBunkers) consider(bunker.position, 0.08, () => (bunker.alive ? bunker.position : null));
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
    this.sound.play('launch', { volume: 0.75, fadeAfter: 1.4 });
    this.rocketCharge = 0;
    this.player.setRocketReady(false);
    this.player.invulnerable = true;
    this.rocketSeq = { rocket, phase: 'flight', timer: 0, point: new THREE.Vector3(), orbit: 0 };
  }

  // ---------- drunken AA missiles ----------

  private get helicopters(): HelicopterEnemy[] {
    return this.targetableEnemies.filter((t): t is HelicopterEnemy => t instanceof HelicopterEnemy);
  }

  private trackHelicopter(heli: HelicopterEnemy): AirTrack {
    return () => (heli.isDestroyed ? null : heli.position);
  }

  /** The helicopter the AA salvo would lock onto: in range and near the turret's aim, closest to it first. */
  private findAirTarget(): HelicopterEnemy | null {
    const origin = this.player.position;
    const yaw = this.player.turretWorldYaw;
    let best: HelicopterEnemy | null = null;
    let bestScore = Infinity;
    for (const heli of this.helicopters) {
      const dx = heli.position.x - origin.x;
      const dz = heli.position.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > AA_RANGE) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / Math.max(dist, 1))));
      if (angle > AA_LOCK_CONE) continue;
      const score = angle + (dist / AA_RANGE) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = heli;
      }
    }
    return best;
  }

  /** A missile whose helicopter went down staggers off after the nearest other one. */
  private retargetAA(from: THREE.Vector3): AirTrack | null {
    let best: HelicopterEnemy | null = null;
    for (const heli of this.helicopters) {
      if (heli.position.distanceTo(from) < (best?.position.distanceTo(from) ?? AA_RANGE)) best = heli;
    }
    return best ? this.trackHelicopter(best) : null;
  }

  /** AA only fires with a helicopter locked, and the pod only refills back at base. */
  private tryFireAA(): void {
    if (this.aa.firing) return;
    if (this.aaLoaded === 0) {
      this.hud.showCallout('AA EMPTY! RETURN TO BASE', '#8fd3ff');
      return;
    }
    const target = this.findAirTarget();
    if (!target) {
      this.hud.showCallout('NO AA LOCK', '#8fd3ff');
      return;
    }
    this.aa.fire(() => this.player.aaLaunch, this.trackHelicopter(target), Math.min(AA_SALVO, this.aaLoaded));
  }

  /** A dart goes off: a small blast that hurts any enemy tank or helicopter close by. */
  private aaBurst(point: THREE.Vector3): void {
    this.explode(point, 0.55, 'player');
    for (const tank of this.targetableEnemies) {
      const d = tank.position.distanceTo(point);
      if (d >= AA_BLAST_RADIUS) continue;
      tank.takeDamage(AA_DAMAGE * (1 - 0.2 * (d / AA_BLAST_RADIUS)));
      if (tank.isDestroyed && tank instanceof HelicopterEnemy) this.hud.showCallout(KNIGHTS ? 'DRAGON DOWN!' : 'CHOPPER DOWN!', '#8fd3ff');
    }
  }

  /** Big blast: wrecks tanks, buildings and troops around the impact (the rocket; smaller for the jeep's and chopper's missiles). */
  private rocketBlast(point: THREE.Vector3, damage = ROCKET_DAMAGE, radius = ROCKET_BLAST_RADIUS, size = 3.4): void {
    this.explode(point, size, 'player');
    this.impacts.addSmokeSource(point.clone(), size * 0.9, 25);

    for (const slot of this.enemySlots) {
      if (!slot.tank) continue;
      const d = slot.tank.position.distanceTo(point);
      if (d < radius) slot.tank.takeDamage(damage * (1 - (d / radius) ** 2));
    }

    const closest = new THREE.Vector3();
    for (const building of this.buildings) {
      if (building.destroyed || building.faction === 'player') continue;
      const box = new THREE.Box3().setFromCenterAndSize(building.center, building.halfExtents.clone().multiplyScalar(2));
      const d = box.clampPoint(point, closest).distanceTo(point);
      if (d >= radius) continue;
      building.takeDamage(damage * 1.6 * (1 - (d / radius) ** 2));
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

  // ---------- changing stations: jeeps and choppers ----------

  /**
   * A station just outside a home base's wall, beside the road out of the gate. A jeep station's
   * bay runs across the radius, so you pull off the road and drive straight through it.
   */
  private addHomeStation(fb: FamilyBase, highways: Polyline[], kind: Station['kind']): void {
    for (const off of STATION_ANGLES) {
      const a = fb.gate + off;
      const x = fb.info.x + Math.cos(a) * STATION_RADIUS;
      const z = fb.info.z + Math.sin(a) * STATION_RADIUS;
      if (highways.some((h) => distanceToPolyline(x, z, h) < STATION_ROAD_CLEARANCE)) continue;
      // The station's local Z becomes (sin yaw, cos yaw): along the wall, (-sin a, cos a).
      this.stations.push(this.buildStation(kind, x, z, -a));
      return;
    }
  }

  private buildStation(kind: Station['kind'], x: number, z: number, yaw: number): Station {
    return kind === 'jeep' ? new JeepStation(this.world, this.scene, x, z, yaw) : new ChopperStation(this.world, this.scene, x, z, yaw);
  }

  private rideMinutes(kind: Station['kind']): number {
    return kind === 'jeep' ? this.settings.jeepMinutes : this.settings.chopperMinutes;
  }

  /**
   * Drive through a station to change (or top the time back up); run the jeep's or chopper's
   * timer and the missiles. When the chopper's time is up it lands first, then changes back.
   */
  private updateRide(dt: number): void {
    for (const station of this.stations) station.update(dt);
    const p = this.player.position;
    const flying = this.player.isChopper;
    // The chopper flies straight over jeep stations, and tops up anywhere over its own pad.
    const station =
      this.stations.find((s) => (s.kind === 'chopper' ? s.contains(p, flying ? CHOPPER_TOP_UP_REACH : 0) : !flying && s.contains(p))) ?? null;
    if (station && station !== this.inStation && !this.pendingSwap) {
      station.celebrate();
      if (this.player.vehicle === station.kind) {
        this.rideTime = this.rideTimeTotal = this.rideMinutes(station.kind) * 60;
        this.missileCharge = 1;
        this.player.cancelLanding();
        this.hud.showCallout(`${station.kind.toUpperCase()} TIME TOPPED UP!`, '#8fe0ff');
      } else {
        this.changeVehicle(station.kind);
      }
    }
    this.inStation = station;

    if (this.pendingSwap) {
      this.pendingSwap.delay -= dt;
      if (this.pendingSwap.delay <= 0) {
        this.player.setVehicle(this.pendingSwap.to);
        this.aimHeadlight();
        this.pendingSwap = null;
      }
    } else if (this.player.vehicle !== 'tank') {
      this.rideTime = Math.max(0, this.rideTime - dt);
      if (this.rideTime > 0) {
        // Still time left.
      } else if (!this.player.isChopper || this.player.landed) {
        this.changeVehicle('tank');
      } else if (!this.player.landing) {
        this.player.beginLanding();
        this.hud.showBanner('TIME TO LAND!', 'The chopper is coming down. Steer it somewhere clear');
      }
    }

    this.missileCharge = Math.min(1, this.missileCharge + dt / MISSILE_RECHARGE);
    this.player.setMissilesReady(this.missileCharge >= 1);
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const hit = this.missiles[i].update(dt, this.world, (p) => this.impacts.trailPuff(p));
      if (!hit) continue;
      this.rocketBlast(hit, MISSILE_DAMAGE, MISSILE_RADIUS, MISSILE_BLAST);
      this.missiles.splice(i, 1);
    }
  }

  /** A puff of smoke, and the vehicle swaps once it's thick enough to hide the change. */
  private changeVehicle(to: Vehicle): void {
    const chopper = to === 'chopper' || this.player.isChopper;
    this.impacts.changePuff(this.player.position.clone(), chopper ? 1.8 : 1);
    this.sound.play('poof', { volume: 0.6 });
    this.sound.play('thud', { volume: 0.7 });
    this.cameraRig.addShake(0.3);
    this.pendingSwap = { to, delay: CHANGE_SWAP_DELAY };
    if (to === 'tank') {
      this.rideTime = 0;
      this.hud.showBanner('BACK IN THE TANK!', 'Drive through a jeep station or onto a chopper pad for another go');
      return;
    }
    const minutes = this.rideMinutes(to);
    this.rideTime = this.rideTimeTotal = minutes * 60;
    this.missileCharge = 1;
    const time = `${minutes} minute${minutes > 1 ? 's' : ''}`;
    if (to === 'jeep') this.hud.showBanner('JEEP TIME!', `Zoom about for ${time}. Fire shoots jam, the rocket button fires missiles`);
    else this.hud.showBanner('CHOPPER TIME!', `Fly about for ${time}. Fire shoots the chin gun, the rocket button fires two missiles`);
  }

  /** The jeep's and chopper's missiles: like the rocket (same lock), smaller, no rocket cam and a quick reload. */
  private tryMissiles(): void {
    if (this.missileCharge < 1) {
      this.hud.showCallout(`MISSILES ${Math.floor(this.missileCharge * 100)}%`, '#ff9a5a');
      return;
    }
    const lock = this.findLockTarget();
    const fallback = this.aimTrajectory().impact;
    for (const { origin, direction } of this.player.missileLaunches) {
      const missile = new HomingRocket(
        this.scene,
        origin,
        direction,
        lock ? lock.track : () => null,
        lock ? lock.position.clone() : fallback,
        this.player.physicsCollider,
      );
      missile.mesh.scale.setScalar(MISSILE_SCALE);
      this.missiles.push(missile);
      this.impacts.muzzleFlash(origin, direction);
    }
    this.sound.play('launch', { volume: 0.55, rate: 1.25, fadeAfter: 0.9 });
    this.missileCharge = 0;
  }

  /** A captured base gets a station as the garrison moves in: a jeep station at every other one, a chopper station at the rest. */
  private addBaseStation(base: EnemyBase): Station['kind'] {
    const kind = this.enemyBases.indexOf(base) % 2 === 0 ? 'jeep' : 'chopper';
    const spot = base.garrisonLayout().station;
    const station = this.buildStation(kind, spot.x, spot.z, spot.yaw);
    this.stations.push(station);
    this.impacts.splash(station.center.clone(), 1.4); // dust as it drops into place
    return kind;
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
      const station = this.addBaseStation(base);
      this.sound.music.stinger();
      const left = this.enemyBases.length - this.announcedBases.size;
      if (left === 0) {
        this.startFinalAssault();
      } else {
        this.hud.showBanner(
          `${base.title.toUpperCase()} DESTROYED!`,
          `Green troops are moving in · ${station === 'jeep' ? 'Jeep' : 'Chopper'} station set up! · ${left} enemy base${left > 1 ? 's' : ''} to go`,
        );
      }
    }
    this.fortress.update(dt);
    if (!this.fortressAnnounced && this.fortress.isDestroyed) {
      this.fortressAnnounced = true;
      this.troops.blast(this.fortress.center, 150, 'player'); // the last defenders scatter
      const message: Record<Mission, string> = {
        1: 'The Fortress has fallen and every enemy base is yours. The toy box is saved!',
        2: 'Night raid complete! The flares are out and every enemy base is yours.',
        3: 'Jungle strike complete! Every enemy base in the jungle is yours.',
        4: 'The Great Castle has fallen! Every knight is bowled over and every dragon is down.',
        5: '',
      };
      this.hud.showVictory(message[MISSION], nextMission ? '' : 'Keep driving around and enjoy it!');
      this.sound.music.fanfare();
      this.victoryTimer = nextMission ? NEXT_MISSION_DELAY : VICTORY_SCREEN_TIME;
    }
    if (this.victoryTimer > 0) {
      this.victoryTimer -= dt;
      if (nextMission) {
        this.hud.setVictoryFooter(
          `Get ready for Mission ${nextMission.mission}: the ${nextMission.title}! Starting in ${Math.max(1, Math.ceil(this.victoryTimer))}…`,
        );
      }
      if (this.victoryTimer <= 0) {
        if (nextMission) startMission(nextMission.mission);
        else this.hud.hideVictory();
      }
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
      start.y = surfaceHeightAt(start.x, start.z);
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

  // ---------- the zombie mission ----------

  /** Somewhere the tank is repaired and rearmed: a family base, or on the zombie mission the Fortress. */
  private atHome(p: THREE.Vector3): boolean {
    return isInsideBase(p) || (ZOMBIES && this.fortress.contains(p.x, p.z));
  }

  /**
   * The last stand: the Fortress opens as everyone's stronghold. Its pillboxes are ours, a ring
   * of pillboxes and squads from every army dig in round it, tanks of every colour patrol the
   * walls, and a jeep and a chopper station sit outside the gates. The player starts at a gate.
   */
  private setupLastStand(highways: Polyline[]): void {
    const f = this.fortress;
    f.unlock();
    this.troops.blocked = (x, z) => f.nearWall(x, z, WALL_STOP);
    for (const b of f.bunkers) {
      this.friendlyBunkers.push(b);
      this.buildings.push(b.building);
    }
    const c = f.center;
    const around = (r: number, a: number) => new THREE.Vector3(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
    // Pillboxes round the outside, slits facing out, skipping the roads to the gates.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = around(140, a);
      if (Math.abs(Math.cos(a)) < 0.2 || highways.some((h) => distanceToPolyline(p.x, p.z, h) < 16)) continue; // leave the gates clear
      const bunker = new Bunker(this.world, this.scene, this.hitRegistry, p.x, p.z, Math.atan2(-Math.cos(a), -Math.sin(a)), 'player', LAST_STAND_COLORS[i % 4]);
      this.friendlyBunkers.push(bunker);
      this.buildings.push(bunker.building);
    }
    for (let i = 0; i < 8; i++) {
      const p = around(125, ((i + 0.5) / 8) * Math.PI * 2); // between the gates
      this.troops.addSquad({ anchor: new THREE.Vector2(p.x, p.z), count: GARRISON_SQUAD_SIZE, wanderRadius: 12, faction: 'player', color: LAST_STAND_COLORS[i % 4], holdWhile: null });
    }
    // Tanks of every army on a loop round the walls.
    const loop = Array.from({ length: 8 }, (_, i) => {
      const p = around(175, (i / 8) * Math.PI * 2);
      p.y = surfaceHeightAt(p.x, p.z);
      return p;
    });
    for (let i = 0; i < 8; i++) {
      const slot: RedSlot = { route: loop, tank: null, respawnTimer: 0, color: LAST_STAND_COLORS[i % 4], loopFrom: 0, respawnAt: i, holdWhile: null };
      this.redSlots.push(slot);
      this.spawnRed(slot, i);
    }
    // A jeep station and a chopper station beside the gates.
    const gates = f.rallyPoints;
    gates.forEach((g, i) => {
      const out = new THREE.Vector3(g.x - c.x, 0, g.z - c.z).normalize();
      for (const side of [1, -1]) {
        const x = g.x + out.z * 42 * side;
        const z = g.z - out.x * 42 * side;
        if (highways.some((h) => distanceToPolyline(x, z, h) < STATION_ROAD_CLEARANCE)) continue;
        this.stations.push(this.buildStation(i === 0 ? 'jeep' : 'chopper', x, z, Math.atan2(out.x, out.z)));
        break;
      }
    });
    const g = gates[0];
    const away = new THREE.Vector3(g.x - c.x, 0, g.z - c.z).normalize();
    this.fortHome = { x: g.x - away.x * 20, z: g.z - away.z * 20, yaw: Math.atan2(-away.x, -away.z) };
    this.waves = new ZombieWaves(c, Math.random);
  }

  /** A zombie's blow landing at `at`: the Fortress wall, or whatever of ours is standing there. */
  private zombieBlow(at: THREE.Vector3, power: number): void {
    if (this.gameOverTime >= 0) return;
    const scale = 1 + BITE_GROWTH * Math.max(0, (this.waves?.wave ?? 1) - 1);
    if (this.fortress.nearWall(at.x, at.z, 0.5)) {
      this.wallDamage += FORT_BITE * power * scale;
      this.wallBlows++;
      if (Math.random() < 0.3) this.impacts.dustPuff(at);
      this.sound.play('thud', { at, volume: 0.35, rate: 1.3 + Math.random() * 0.3, minGap: 0.15 });
      return;
    }
    for (const tank of [this.player, ...this.buddies, ...this.redTanks]) {
      if (Math.hypot(tank.position.x - at.x, tank.position.z - at.z) < BITE_REACH) tank.takeDamage(TANK_BITE * power * scale);
    }
    this.troops.shoot(at, 1.6, 'enemy');
    const closest = new THREE.Vector3();
    for (const b of this.friendlyBunkers) {
      if (!b.alive) continue;
      const box = new THREE.Box3().setFromCenterAndSize(b.building.center, b.building.halfExtents.clone().multiplyScalar(2));
      if (box.clampPoint(at, closest).distanceTo(at) > 2) continue;
      b.building.takeDamage(BUNKER_BITE * power * scale);
      if (b.building.destroyed) this.collapseBuilding(b.building, 'enemy');
    }
    this.sound.play('thud', { at, volume: 0.25, rate: 1.6, minGap: 0.2 });
  }

  /** Runs the waves, the wall's strength and the clock; the game ends when the wall gives way. */
  private updateLastStand(dt: number, confirm: boolean): void {
    const waves = this.waves;
    if (!waves) return;
    if (this.gameOverTime >= 0) {
      this.gameOverTime += dt;
      this.hud.setVictoryFooter(this.gameOverTime > RETRY_DELAY ? 'Press A or Enter to try again · Start / M for the level select' : '');
      if (confirm && this.gameOverTime > RETRY_DELAY) startMission(MISSION);
      return;
    }
    this.survived += dt;
    const { started, packs } = waves.update(dt, this.troops.zombiesStanding);
    if (started) {
      this.sound.music.alarm();
      const from = started.from.length > 1 ? `${started.from.slice(0, -1).join(', ')} and ${started.from[started.from.length - 1]}` : started.from[0];
      this.hud.showBanner(`WAVE ${started.wave}!`, `${started.count} zombies coming from the ${from}!`);
    }
    for (const p of packs) {
      this.troops.addZombies(p.x, p.z, p.goal, p.kinds, (k) => ZOMBIE_COLOR[k]);
    }
    // The crowd at the wall shares out its damage; the wall mends a little while nobody's at it.
    this.wallCrowd = THREE.MathUtils.damp(this.wallCrowd, dt > 0 ? (this.wallBlows * BLOW_TIME) / dt : 0, 1.5, dt);
    this.fortStrength = Math.max(0, this.fortStrength - this.wallDamage / Math.sqrt(Math.max(1, this.wallCrowd)));
    this.wallDamage = 0;
    if (this.wallBlows > 0) {
      if (this.wallAlarm <= 0) this.hud.showCallout('ZOMBIES AT THE WALL!', '#c8ff7a');
      this.wallAlarm = 3;
    } else {
      this.wallAlarm -= dt;
      if (this.wallAlarm <= 0) this.fortStrength = Math.min(FORT_STRENGTH, this.fortStrength + FORT_REPAIR * dt);
    }
    this.wallBlows = 0;
    if (this.fortStrength <= 0) {
      this.gameOverTime = 0;
      this.finalDowned = this.troops.zombiesDowned;
      this.sound.music.stop();
      this.sound.music.alarm();
      const mins = Math.floor(this.survived / 60);
      const secs = Math.floor(this.survived % 60);
      this.hud.showDefeat(
        'THE ZOMBIES GOT IN!',
        `You held the Fortress for ${mins}:${String(secs).padStart(2, '0')} and made it to wave ${waves.wave}. ${this.finalDowned} zombies knocked over!`,
      );
    }
  }

  // ---------- aiming / HUD helpers ----------

  /** The flight of the player's next shell (or the jeep's jam round, or the chopper's chin gun round). */
  private aimTrajectory(): Trajectory {
    const vehicle = this.player.vehicle;
    return predictTrajectory(
      this.world,
      this.player.gunMuzzlePosition,
      this.player.muzzleWorldDirection,
      vehicle === 'jeep' ? JEEP_JAM_SPEED : vehicle === 'chopper' ? CHOPPER_GUN_SPEED : this.player.muzzleSpeed,
      this.player.physicsCollider,
    );
  }

  /** Where the player's next shot would fly and land, and what it would hit. */
  private updateAim(): { screen: { x: number; y: number } | null; range: number | null; target: AimTarget } {
    const traj = this.aimTrajectory();
    const pts = traj.points;
    const travel = pts.length > 1 ? pts[pts.length - 1].clone().sub(pts[pts.length - 2]) : this.player.muzzleWorldDirection;
    const target = this.classifyTarget(traj.hitCollider, traj.impact, travel, this.player.isJeep);
    this.aimGuide.update(traj, target, this.camera);
    return { screen: this.toScreen(traj.impact), range: traj.normal ? traj.range : null, target };
  }

  private toScreen(world: THREE.Vector3): { x: number; y: number } | null {
    const ndc = world.clone().project(this.camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.2 || Math.abs(ndc.y) > 1.2) return null;
    return { x: ((ndc.x + 1) / 2) * window.innerWidth, y: ((1 - ndc.y) / 2) * window.innerHeight };
  }

  /** `jam`: a jam round, whose only weak point is a pillbox gun slit (it gums the gun up for good). */
  private classifyTarget(collider: RAPIER.Collider | null, impact: THREE.Vector3, travel: THREE.Vector3, jam = false): AimTarget {
    if (!collider) return 'none';
    const hit = this.hitRegistry.lookup(collider);
    if (!hit || hit.kind === 'terrain' || hit.kind === 'water' || hit.kind === 'tree') return 'ground';
    if (hit.kind === 'tank') return hit.tank.faction === 'player' || hit.tank.shielded ? 'ground' : 'enemy';
    if (hit.building.faction === 'player' || hit.building.locked) return 'ground';
    const crit = jam
      ? (this.targetableBunkers.find((b) => b.building === hit.building)?.jamCritAt(impact, travel) ?? false)
      : hit.building.critAt(impact, travel) !== null;
    if (crit) return 'critical';
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
      if (slot.tank) markers.push({
        x: slot.tank.position.x,
        z: slot.tank.position.z,
        kind: slot.tank instanceof HelicopterEnemy ? 'helicopter' : 'tank',
        friendly: false,
      });
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
      fortress: { x: f.center.x, z: f.center.z, name: f.name, title: f.title, locked: f.locked, destroyed: f.isDestroyed, friendly: ZOMBIES },
      stations: this.stations.map((s) => ({ x: s.center.x, z: s.center.z, kind: s.kind })),
    };
  }

  private hudState(
    input: InputState,
    cinematic: boolean,
    aim: ReturnType<Game['updateAim']>,
    lockScreen: { x: number; y: number } | null,
    aaLockScreen: { x: number; y: number } | null = null,
  ): HUDState {
    const near = this.nearestEnemyBase(false);
    const inside = this.atHome(this.player.position);
    const f = this.fortress;
    const fortressDist = Math.hypot(f.center.x - this.player.position.x, f.center.z - this.player.position.z);
    const checklist = ZOMBIES
      ? null
      : fortressDist < FORTRESS_CHECKLIST_RANGE && (!near || fortressDist < near.distance)
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
    const vehicle = this.player.vehicle;
    return {
      zombies: this.waves
        ? {
            wave: this.waves.wave,
            nextWaveIn: this.waves.nextIn,
            standing: this.troops.zombiesStanding + this.waves.waiting,
            fortStrength: this.fortStrength,
            fortMax: FORT_STRENGTH,
            survived: this.survived,
            downed: this.gameOverTime >= 0 ? this.finalDowned : this.troops.zombiesDowned,
            atWall: this.wallAlarm > 0,
            over: this.gameOverTime >= 0,
          }
        : null,
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      reloadFraction: vehicle !== 'tank' ? 0 : this.player.fireCooldown / this.player.fireInterval,
      ride:
        vehicle !== 'tank'
          ? { vehicle, timeLeft: this.rideTime, total: this.rideTimeTotal, missileCharge: this.missileCharge, landing: this.player.landing }
          : null,
      cameraMode: this.cameraRig.mode,
      usingGamepad: input.usingGamepad,
      insideBase: inside ? (isInsideBase(this.player.position) ? nearestFriendlyBase(this.player.position.x, this.player.position.z).name : this.fortress.title) : null,
      map: this.mapView(),
      aimScreen: aim.screen,
      aimRange: aim.range,
      aimTarget: aim.target,
      rocketCharge: this.rocketCharge,
      rocketLockScreen: lockScreen,
      aaLoaded: this.aaLoaded,
      aaMax: AA_CAPACITY,
      aaFiring: this.aa.firing,
      aaRearming: this.aaLoaded < AA_CAPACITY && inside,
      aaLockScreen,
      buddyCharge: this.buddyCharge,
      megaJamCharge: this.megaJamCharge,
      buddyRoster: this.settings.buddyNames,
      buddyOut: this.settings.buddyNames.map((_, i) => this.buddies.some((b) => b.crew === i)),
      driveStyle: this.settings.driveStyle,
      mouseCaptureHint: !input.usingGamepad && !input.pointerLocked && input.pointerLockAvailable,
      soundLocked: this.sound.locked && (this.settings.sfxVolume > 0 || this.settings.musicVolume > 0),
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
    // Typing a buddy name on the options screen: letters are text, not menu or map keys.
    this.input.textEntry = this.hud.editingText;
    const rawInput = this.input.update(dt);

    // Full map doubles as the pause screen: nothing moves while it's open.
    if (this.hud.paused) {
      this.hud.handleMenu(rawInput.menu);
      if (rawInput.mapTogglePressed && this.hud.paused) this.hud.toggleBigMap();
      this.sound.updateEngine(0, this.player.vehicle, false);
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
        if (this.fortHome) this.player.teleport(this.fortHome.x, this.fortHome.z, this.fortHome.yaw);
        else if (base) this.player.teleport(base.info.x, base.info.z, base.spawnYaw);
      }
      if (input.mapTogglePressed) this.hud.toggleBigMap();
      if (input.rocketPressed) {
        if (this.player.vehicle !== 'tank') this.tryMissiles();
        else if (this.rocketCharge >= 1) this.launchRocket();
      }
      if (input.aaPressed) this.tryFireAA();
      if (input.megaJamPressed) this.tryMegaJam();
      this.megaJamCharge = Math.min(1, this.megaJamCharge + dt / MEGA_JAM_RECHARGE);
      // A buddy rolls in by themselves as soon as the meter's full.
      if (this.buddyCharge >= 1 && this.buddies.length < MAX_BUDDIES) this.spawnBuddy();
      this.addRocketCharge(dt / ROCKET_RECHARGE_TIME);
      this.buddyCharge = Math.min(1, this.buddyCharge + dt / BUDDY_RECHARGE_TIME);
    }
    this.player.setRocketReady(this.rocketCharge >= 1 && !this.rocketSeq);

    // AA darts are only restocked back at a home base, one at a time.
    if (this.aaLoaded < AA_CAPACITY && !this.aa.firing && this.atHome(this.player.position)) {
      this.aaRearm += dt;
      while (this.aaRearm >= AA_REARM_TIME && this.aaLoaded < AA_CAPACITY) {
        this.aaRearm -= AA_REARM_TIME;
        this.aaLoaded++;
      }
    } else {
      this.aaRearm = 0;
    }
    this.aa.update(
      dt,
      this.world,
      this.player.physicsCollider,
      (from) => this.retargetAA(from),
      (p) => this.impacts.wispPuff(p),
      (origin) => {
        this.aaLoaded = Math.max(0, this.aaLoaded - 1);
        this.impacts.trailPuff(origin);
        this.sound.play('launch', { volume: 0.3, rate: 1.7, fadeAfter: 0.35, minGap: 0.05 });
      },
      (point) => this.aaBurst(point),
    );
    this.player.setAALoaded(Math.min(AA_SALVO, this.aaLoaded));

    // The Fortress's guards can't be hurt or targeted until its gates open.
    for (const slot of this.enemySlots) {
      if (slot.tank && !(slot.tank instanceof HelicopterEnemy)) slot.tank.shielded = this.sealedInFortress(slot.tank.position);
    }

    const before = this.player.position.clone();
    const playerShot = this.player.step(input, dt);
    if (playerShot) this.fire(this.player, playerShot);
    // The chopper can't fly in over the Fortress while it's locked: it would land inside and be stuck.
    const p = this.player.position;
    this.fortressWarning -= dt;
    if (this.player.isChopper && this.fortress.locked && this.fortress.contains(p.x, p.z) && !this.fortress.contains(before.x, before.z)) {
      this.player.holdAt(before.x, before.z);
      if (this.fortressWarning <= 0) {
        this.hud.showCallout('THE FORTRESS IS LOCKED!', '#ffd24a');
        this.fortressWarning = 2;
      }
    }
    // The jeep and chopper have no cannon: the trigger fires a stream of jam rounds or chin gun rounds.
    if (input.firing && this.player.vehicle !== 'tank') {
      const round = this.player.tryRapidFire();
      if (round && this.player.isChopper) {
        this.fireChinGun(round);
      } else if (round) {
        this.jam.shoot(round.origin, round.direction, JEEP_JAM_SPEED);
        this.sound.play('jamShot', { volume: 0.35, rate: 0.85, minGap: 0.07 });
      }
    }
    this.updateRide(dt);
    if (input.jamFiring) {
      const glob = this.player.tryJam();
      if (glob) {
        this.jam.fire(glob.origin, glob.direction, JAM_SPEED * glob.speedScale);
        this.sound.play('jamShot', { volume: 0.22, rate: 1.1, minGap: 0.09 });
      }
    }
    this.jam.update(dt, this.world, this.player.physicsCollider, (point, hit, velocity) => {
      if (hit) this.jamBunkerSlit(hit, point, velocity);
      this.sound.play('splat', { at: point, volume: 0.9, minGap: 0.1 });
      this.jamEnemies(point, JAM_RADIUS);
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
    }, (point) => this.jamEnemies(point, JAM_DRIP_RADIUS));

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
      (shot, faction) => (shot.melee ? this.zombieBlow(shot.origin, shot.melee) : this.fireBullet(shot, undefined, faction)),
    );
    if (this.waves) this.updateLastStand(dt, rawInput.menu.confirm);
    this.addRocketCharge(this.troops.runOver(this.player.position, RUN_OVER_RADIUS, 'player') * CHARGE_PER_TROOP);

    // Trees go over when a tank reaches them (or the chopper comes down low over them).
    const playerLow = this.player.heightAboveGround < CHOPPER_LOW;
    const tankPositions = [...(playerLow ? [this.player] : []), ...this.buddies, ...this.enemySlots.flatMap((slot) => slot.tank ? [slot.tank] : []), ...this.redSlots.flatMap((slot) => slot.tank ? [slot.tank] : [])]
      .filter((tank) => !tank.isDestroyed)
      .map((tank) => tank.position);
    for (const tree of this.trees) tree.update(dt, tankPositions);

    this.world.step();
    this.projectiles.update(dt);
    this.impacts.update(dt);
    this.wrecks.update(dt, {
      smoke: (p) => this.impacts.trailPuff(p),
      thud: (p) => {
        for (let i = 0; i < 3; i++) this.impacts.dustPuff(p);
        this.cameraRig.addShake(0.25 / Math.max(1, p.distanceTo(this.player.position) / 15));
      },
      splash: (p) => this.impacts.splash(p, 0.8),
      burst: (p) => {
        this.impacts.explode(p, 1.5);
        this.impacts.confetti(p);
      },
    });
    for (let i = this.aftershocks.length - 1; i >= 0; i--) {
      const a = this.aftershocks[i];
      a.delay -= dt;
      if (a.delay > 0) continue;
      this.explode(a.at, a.size, 'player');
      this.aftershocks.splice(i, 1);
    }
    for (const building of this.buildings) building.update(dt);
    this.updateEnemyBases(dt);

    const insideBase = this.atHome(this.player.position);
    if (insideBase) this.player.heal(BASE_HEAL_RATE * dt);
    const repairingAt = insideBase && this.player.health < this.player.maxHealth ? nearestFriendlyBase(this.player.position.x, this.player.position.z) : null;
    for (const fb of this.familyBases) fb.camp.update(dt, fb.info === repairingAt, this.camera.position, this.player.position);
    this.landmarks.update(dt);

    // Bow wave while the tank wades through a lake.
    this.wakeTimer -= dt;
    const moving = Math.abs(input.throttle) + Math.hypot(input.moveX, input.moveY) > 0.1;
    if (moving && playerLow && this.wakeTimer <= 0 && waterDepthAt(this.player.position.x, this.player.position.z) > 0.3) {
      this.wakeTimer = 0.12;
      const bow = this.player.position.clone().addScaledVector(this.player.forward, 2.2);
      bow.y = this.player.position.y;
      this.impacts.splash(bow, 0.3);
    }

    const cinematic = this.updateRocketSequence(dt);
    let aim: ReturnType<Game['updateAim']> = { screen: null, range: null, target: 'none' };
    let lockScreen: { x: number; y: number } | null = null;
    let aaLockScreen: { x: number; y: number } | null = null;
    if (cinematic) {
      this.player.setTurretHidden(false);
      this.aimGuide.setVisible(false);
    } else {
      this.cameraRig.setAerial(this.player.isChopper);
      this.cameraRig.update(this.player, dt);
      aim = this.updateAim();
      if (this.player.vehicle !== 'tank' ? this.missileCharge >= 1 : this.rocketCharge >= 1) {
        const lock = this.findLockTarget();
        if (lock) lockScreen = this.toScreen(lock.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
      }
      if (this.aaLoaded > 0 && !this.aa.firing) {
        const heli = this.findAirTarget();
        if (heli) aaLockScreen = this.toScreen(heli.position);
      }
    }

    // The shadow-casting light: the sun by day, the moon by night.
    const sunOffset = NIGHT ? MOON_DIRECTION.clone().multiplyScalar(266) : new THREE.Vector3(120, 220, 90);
    this.sun.position.copy(this.player.position).add(sunOffset);
    this.nightSky?.update(dt, this.camera, this.player.position);
    this.sun.target.position.copy(this.player.position);
    this.sun.target.updateMatrixWorld();

    // The engine note follows how fast the player is really going.
    const speed = dt > 0 ? this.player.position.distanceTo(this.lastPlayerPosition) / dt : 0;
    this.lastPlayerPosition.copy(this.player.position);
    this.sound.updateEngine(speed < 80 ? speed : 0, this.player.vehicle, !cinematic);
    this.sound.setListener(this.camera);

    this.hud.update(this.hudState(input, cinematic, aim, lockScreen, aaLockScreen));
    this.renderer.render(this.scene, this.camera);
  };
}
