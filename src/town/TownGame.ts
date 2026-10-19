import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, createWorld } from '../physics/PhysicsWorld';
import { InputManager, type InputState } from '../input/InputManager';
import { HUD, type HUDState, type PrisonHUD } from '../ui/HUD';
import type { MapView } from '../ui/WorldMap';
import { Sound } from '../audio/Sound';
import { ImpactEffects } from '../combat/ImpactEffects';
import { JamCannon } from '../combat/JamCannon';
import { loadSettings, saveSettings, AIM_SPEED_SCALE, GRAPHICS_QUALITY, type Settings } from '../core/Settings';
import { MISSION, levelNumber, nextMission, startMission } from '../core/config';
import { PlayerSoldier, MAX_HEALTH } from '../prison/PlayerSoldier';
import { ShoulderCam } from '../prison/ShoulderCam';
import { FRIEND_SHOTS, ENEMY_SHOTS, WALLS_ONLY } from '../prison/groups';
import { ARMY_GREEN, ARMY_TAN, ARMY_BLUE, shade } from '../utils/plastic';
import { mulberry32 } from '../utils/rng';
import { Trooper } from '../jungle/Trooper';
import { Enemies } from '../jungle/Enemies';
import { Squad } from '../jungle/Squad';
import type { Battle } from '../jungle/Battle';
import { Explosives, type Blast } from '../jungle/Explosives';
import { TownData, type Pt } from './TownData';
import { TownTerrain } from './TownTerrain';
import { TownRoads } from './Roads';
import { Buildings, type Roadblock, type Pen } from './Buildings';
import { TownMap } from './TownMap';
import { buildDepot, buildNest, UPGRADE_NAME, type Depot, type Upgrade } from './Depot';

const TITLE = 'DOWN THE HILL';
/** The squad starts captured: two of them in each of the enemy's pens, away from the route. */
const PENS = 4;
const PEN_MEN = 2;
/** The squad names from Options cover the first four prisoners; these are the other four. */
const MORE_BUDDIES = ['Eleanor', 'Robert', 'Luca', 'Zoey'];
/** Pens stand this far from the way down the hill (metres), and at least this far from each other. */
const PEN_MIN = 45;
const PEN_MAX = 140;
const PEN_GAP = 110;
/** The best distance off the route for a pen: a short detour down a side street. */
const PEN_IDEAL = 80;
/** Standing at a pen's gate this long lets them out. */
const GATE_TIME = 1.5;
const GATE_REACH = 2.2;
const SQUAD_HP = 40;
const ENEMY_HP = 3;
const SHADOW_HALF = 45;
const SHOT_RANGE = 160;
const TRACER_TIME = 0.06;
const ENEMY_DAMAGE = 7;
const SHOT_NOISE = 46;
const JAM_INTERVAL = 0.07;
const JAM_SPEED = 22;
const JAM_GRAVITY = 12;
const JAM_RANGE = 22;
const JAM_DRAIN = 0.28;
const JAM_REFILL = 0.2;
const JAM_RADIUS = 1.8;
const GRENADES = 4;
const GRENADE_RELOAD = 18;
/** Roadblocks on the way down: the first is this far along the route, then at least this far apart, none too near the school. */
const FIRST_BLOCK = 130;
const BLOCK_GAP = 150;
const BLOCK_SCHOOL_CLEAR = 130;
const BLOCK_MEN = 6;
/** The machine gun in each roadblock's nest: how far it reaches, rounds in a burst, seconds between rounds and between bursts. */
const MG_RANGE = 55;
const MG_BURST = 7;
const MG_EVERY = 0.09;
const MG_REST = 2.8;
/** A roadblock (or the school) counts as cleared with this many of its men left standing. */
const CLEARED = 0;
/** The school is dug in: this many defenders, the first few of them heavies who take twice the hits, and two machine-gun nests. */
const SCHOOL_MEN = 24;
const SCHOOL_HEAVIES = 8;
/** Patrols walking the streets, this many men each. There are only these: none come back once they're down. */
const PATROLS = 8;
const PATROL_MEN = 3;
/** A patrol's beat: at most this long, and it starts this far from where you start, and well clear of the school. */
const BEAT_MAX = 170;
const PATROL_START_CLEAR = 150;
/** Guns. You start with a pistol; the depot's assault rifle fires far faster and straighter. */
const PISTOL_EVERY = 0.42;
const PISTOL_SPREAD = 0.03;
const RIFLE_EVERY = 0.11;
const RIFLE_SPREAD = 0.006;
/** Body armour: the share of each hit that still gets through. */
const ARMOUR = 0.45;
/** The supply depot is out toward the south-west corner (this far toward it, from the middle), with a few guards. */
const DEPOT_TOWARD = 0.68;
const DEPOT_GUARDS = 4;
/** Walk this close to an upgrade's table to take it. */
const PICKUP_REACH = 2.4;
/** Standing at the flagpole this long raises our flag. */
const FLAG_TIME = 4;
const FLAG_REACH = 3.5;
/** A player knocked down is helped up by the other one standing beside them for this long. */
const REVIVE_REACH = 2.4;
const REVIVE_TIME = 1.5;
const REVEAL = 50;
const VICTORY_DELAY = 25;
/** After winning, the replay button works after this long (so a shot held at the end doesn't trigger it). */
const REPLAY_AFTER = 1.5;

const CONTROLS =
  '<span><b>Move</b> left stick · W A S D</span><span><b>Aim</b> right stick · mouse</span>' +
  '<span><b>Creep</b> (they see you from less far) RB · Left Shift</span><span><b>Rifle</b> RT · click</span>' +
  '<span><b>Jam gun</b> (sticks soldiers) hold LT · hold E</span>' +
  '<span><b>Grenade launcher</b> (from the supply depot: 4 shots, then a reload) LB · F · right click</span>' +
  '<span><b>Squad: hold here / follow me</b> X</span><span><b>Camera</b> Y · C</span><span><b>Back to checkpoint</b> Back · R</span>';
const CONTROLS_P2 =
  '<span><b>Move</b> arrow keys · <b>Aim</b> mouse in your view or numpad 4/6 and 8/2</span>' +
  '<span><b>Rifle</b> numpad 0 · <b>Creep</b> Right Shift · <b>Jam gun</b> hold numpad 1</span>' +
  '<span><b>Grenade launcher</b> numpad 3 · <b>Squad</b> numpad 7</span>' +
  '<span><b>Camera</b> numpad 9 · <b>Pause / map</b> numpad enter · <b>Checkpoint</b> numpad decimal</span>';
const LEGEND =
  '<span><i style="background:#4b7a2e"></i>You and your squad</span><span><i style="background:#c4a468"></i>Tan army</span><span><i style="background:#3f6fb0"></i>Blue army</span>' +
  '<span><i style="background:#ffd24a"></i>The way down the hill, and Mauricewood Primary School</span><span>Squares: enemy roadblocks</span><span><i style="background:#7a8a3a"></i>Supply depot: upgrades (south-west)</span><span><i style="background:#ffd24a"></i>Barred squares: pens holding your squad</span>';

const NO_MAP: MapView = {
  playerX: 0,
  playerZ: 0,
  playerYaw: 0,
  friendlyBases: [],
  enemyBases: [],
  buddies: [],
  markers: [],
  objective: null,
  home: null,
  fortress: { x: 0, z: 0, name: '', title: '', locked: false, destroyed: false, friendly: true },
  stations: [],
  prisons: [],
  wagons: [],
  tanker: null,
  airbase: null,
};

interface Block {
  rb: Roadblock;
  army: 'tan' | 'blue';
  men: Trooper[];
  taken: boolean;
  /** How far along the route it is. */
  along: number;
  name: string;
}

interface Prison {
  pen: Pen;
  /** Our men locked in it (not in the squad until they're let out). */
  captives: Trooper[];
  guards: Trooper[];
  freed: boolean;
  /** Seconds someone of ours has stood at the gate. */
  opening: number;
}

/** One player's own state: the jam gun, the launcher, being helped up. */
interface Kit {
  jam: JamCannon;
  jamTank: number;
  jamCooldown: number;
  grenades: number;
  reload: number;
  downTime: number;
  revive: number;
  /** What he's picked up at the depot: the assault rifle (else a pistol), body armour, the grenade launcher. */
  gun: 'pistol' | 'rifle';
  armour: boolean;
  launcher: boolean;
}

/** A machine gun in a sandbagged nest (a roadblock's, or one of the school's): its gunner, the gun, and its burst. */
interface Mg {
  gunner: Trooper;
  gun: THREE.Group;
  mg: { left: number; next: number; rest: number };
  /** Whether it's out of the fight anyway (its roadblock taken). */
  silent: () => boolean;
}

/**
 * The bonus level in a real town: Penicuik, in Midlothian, from OpenStreetMap and real elevation
 * data. Every house and garage, every street and path, the gardens and the woods are where they
 * really are, on the real hill. Start outside 64 Sycamore Drive with a squad of four and fight down the
 * hill through the enemy's roadblocks on the streets to Mauricewood Primary School: clear its
 * defenders and raise our flag on its flagpole to win. Two players can play, each with their own
 * view; either can raise the flag, and either can help the other up.
 */
export class TownGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private readonly camera2: THREE.PerspectiveCamera;
  private readonly input: InputManager;
  private hud: HUD;
  private readonly hud2: HUD;
  private readonly sound = new Sound(MISSION);
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly clock = new THREE.Clock();
  private readonly loadingLabel: HTMLDivElement;
  private settings: Settings = loadSettings();
  private ready = false;
  private pausedRendered = false;
  private world!: RAPIER.World;
  private impacts!: ImpactEffects;
  private town!: TownData;
  private terrain!: TownTerrain;
  private buildings!: Buildings;
  private explosives!: Explosives;
  private map!: TownMap;
  private player!: PlayerSoldier;
  private player2: PlayerSoldier | null = null;
  private cam!: ShoulderCam;
  private cam2!: ShoulderCam;
  private kit!: Kit;
  private kit2!: Kit;
  private squad = new Squad();
  private enemies = new Enemies();
  private battle!: Battle;
  private blocks: Block[] = [];
  private schoolMen: Trooper[] = [];
  private patrolMen: Trooper[] = [];
  private guns: Mg[] = [];
  private depot!: Depot;
  private leaving = false;
  private prisons: Prison[] = [];
  private schoolCleared = false;
  private flag = 0;
  private readonly byHandle = new Map<number, Trooper>();
  private readonly trail: THREE.Vector3[] = [];
  private checkpoint = { x: 0, z: 0, yaw: 0 };
  private start = { x: 0, z: 0, yaw: 0 };
  private time = 0;
  private victoryAt: number | null = null;
  private mapAge = 0;
  private mapView: MapView = NO_MAP;
  private readonly stats = { enemiesDown: 0, grenadesFired: 0 };
  private readonly tracers: { line: THREE.Line; age: number }[] = [];
  private readonly friendTracer = new THREE.LineBasicMaterial({ color: 0xffe7a0, transparent: true });
  private readonly enemyTracer = new THREE.LineBasicMaterial({ color: 0xff9a5a, transparent: true });
  /** Dev only: pins the camera for screenshots. */
  debugCam: { pos: [number, number, number]; look: [number, number, number] } | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: this.settings.graphicsQuality !== 'low' });
    const graphics = GRAPHICS_QUALITY[this.settings.graphicsQuality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = graphics.shadowSize > 0;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera2 = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 900);
    this.input = new InputManager(this.renderer.domElement);
    this.hud = new HUD(container);
    this.hud2 = new HUD(container, true);
    this.hud.setMirror(this.hud2);
    this.hud2.setActive(false);
    this.hud.setSoundHook((kind) => this.sound.play(kind === 'move' ? 'uiMove' : kind === 'change' ? 'uiChange' : kind === 'back' ? 'uiBack' : kind === 'open' ? 'uiOpen' : 'uiConfirm', { volume: 0.5, minGap: 0 }));

    this.loadingLabel = document.createElement('div');
    this.loadingLabel.style.cssText =
      'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;' +
      "font-size:22px; background:#0a0e14; color:#e8eef5; font-family:'Segoe UI',system-ui,sans-serif; z-index:10;";
    this.loadingLabel.textContent = 'Loading Penicuik…';
    container.appendChild(this.loadingLabel);

    // A bright, breezy Midlothian day with a little haze over the Pentlands.
    this.scene.background = new THREE.Color(0xb7cde0);
    this.scene.fog = new THREE.Fog(0xb7cde0, 90, 620);
    this.hemi = new THREE.HemisphereLight(0xe4eef8, 0x4a5a3a, 1.45);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(graphics.shadowSize || 1024, graphics.shadowSize || 1024);
    const sh = this.sun.shadow.camera;
    sh.left = sh.bottom = -SHADOW_HALF;
    sh.right = sh.top = SHADOW_HALF;
    sh.far = 220;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.onResize());
    void this.init();
  }

  private ground(x: number, z: number): number {
    return this.town.heightAt(x, z);
  }

  private async init(): Promise<void> {
    await initPhysics();
    this.world = createWorld();
    this.impacts = new ImpactEffects(this.scene);
    this.town = await TownData.load();
    this.loadingLabel.textContent = 'Building Penicuik…';
    await new Promise((r) => setTimeout(r, 0));
    const ground = (x: number, z: number) => this.town.heightAt(x, z);
    Trooper.ground = ground;
    const quality = this.settings.graphicsQuality;
    this.terrain = new TownTerrain(this.world, this.scene, this.town, quality === 'low' ? 2048 : 4096);
    new TownRoads(this.town, this.scene);
    this.buildings = new Buildings(this.world, this.scene, this.town);
    this.explosives = new Explosives(this.scene, this.world, ground);
    this.kit = this.kitOne = this.makeKit();
    this.kit2 = this.makeKit();
    this.map = new TownMap(this.town);

    // Start outside 64 Sycamore Drive, facing the way the route goes.
    const s = this.town.start;
    const ahead = this.alongRoute(25);
    const yaw = Math.atan2(-(ahead.x - s.x), -(ahead.z - s.z));
    this.start = { x: s.x, z: s.z, yaw };
    this.checkpoint = { ...this.start };
    this.player = new PlayerSoldier(this.world, s.x, s.z, yaw);
    this.player.teleport(s.x, s.z, yaw, ground(s.x, s.z) + 0.05);
    this.scene.add(this.player.root);
    this.playerOne = this.player;
    this.cam = this.camOne = new ShoulderCam(this.camera, this.world);
    if (this.settings.player2Controller !== -2) this.addPlayer2();
    // On your own: the squad's been captured (see placePrisons).
    this.placeEnemies();
    this.placePrisons();
    this.battle = this.makeBattle();
    this.hud.setWorldMap(this.map.asWorldMap());
    this.hud.setOnFoot(CONTROLS, { legend: LEGEND }, CONTROLS_P2);
    this.hud.setSettings(this.settings, (st) => {
      this.settings = st;
      saveSettings(st);
      this.applySettings();
    });
    this.hud2.setOnFoot(CONTROLS_P2, { legend: LEGEND });
    this.hud.setCoopLayout(!!this.player2);
    this.hud2.setActive(!!this.player2);
    this.applySettings();
    this.hud.setMissionStart((m) => startMission(m));
    void this.sound.load();
    this.world.step();
    this.refreshMap();

    this.loadingLabel.remove();
    this.ready = true;
    this.sound.music.start();
    this.clock.start();
    this.hud.showBanner(`LEVEL ${levelNumber(MISSION)}: ${TITLE}`, "Penicuik! You're on your own with just a pistol: your squad's locked in four enemy pens, and the school at the bottom of the hill is dug in. The enemy's supply depot in the south-west corner has better kit");
    if (import.meta.env.DEV) (window as unknown as { town: TownGame }).town = this;
    requestAnimationFrame(this.animate);
  }

  private makeKit(): Kit {
    return { jam: new JamCannon(this.scene, (x, z) => this.ground(x, z), FRIEND_SHOTS), jamTank: 1, jamCooldown: 0, grenades: GRENADES, reload: 0, downTime: 0, revive: 0, gun: 'pistol', armour: false, launcher: false };
  }

  /** How far along the route each point is, in metres. */
  private routeDistances(): number[] {
    const r = this.town.route;
    const out = [0];
    for (let i = 1; i < r.length; i++) out.push(out[i - 1] + Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z));
    return out;
  }

  /** A point `d` metres along the route. */
  private alongRoute(d: number, dist = this.routeDistances()): Pt {
    const r = this.town.route;
    for (let i = 1; i < r.length; i++) {
      if (dist[i] >= d) {
        const k = (d - dist[i - 1]) / Math.max(1e-6, dist[i] - dist[i - 1]);
        return { x: r[i - 1].x + (r[i].x - r[i - 1].x) * k, z: r[i - 1].z + (r[i].z - r[i - 1].z) * k };
      }
    }
    return r[r.length - 1];
  }

  /** Roadblocks at junctions along the way, patrols in the streets between them, and the school's defenders. */
  private placeEnemies(): void {
    const dist = this.routeDistances();
    const total = dist[dist.length - 1];
    const route = this.town.route;
    const rng = mulberry32(905);
    const junction = new Set(this.town.junctions.map((j) => `${j.x},${j.z}`));
    let last = -Infinity;
    route.forEach((p, i) => {
      const d = dist[i];
      if (d < FIRST_BLOCK || d > total - BLOCK_SCHOOL_CLEAR || d - last < BLOCK_GAP || !junction.has(`${p.x},${p.z}`)) return;
      last = d;
      const uphill = this.alongRoute(Math.max(0, d - 15), dist);
      const army: 'tan' | 'blue' = this.blocks.length % 2 ? 'blue' : 'tan';
      const color = army === 'tan' ? ARMY_TAN : ARMY_BLUE;
      const rb = this.buildings.roadblock(p, { x: uphill.x - p.x, z: uphill.z - p.z }, color);
      const men = rb.posts.slice(0, BLOCK_MEN).map((q) => this.addEnemy(q.x, q.z, color, 3));
      const gunner = this.addEnemy(rb.gunner.x, rb.gunner.z, color, 0);
      men.push(gunner);
      const street = this.town.roads.find((r) => r.name && r.pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 12))?.name;
      const block: Block = { rb, army, men, taken: false, along: d, name: street ? `${street} roadblock` : `Roadblock ${this.blocks.length + 1}` };
      this.blocks.push(block);
      this.guns.push({ gunner, gun: rb.gun, mg: { left: 0, next: 0, rest: 1 + rng() * 2 }, silent: () => block.taken });
    });
    this.placeDepot();
    this.placePatrols(rng);
    this.fortifySchool(rng, dist);
  }

  /**
   * The school, dug in: two dozen defenders round the buildings and the playground (the first few
   * of them heavies in darker kit who take twice the hits), and two sandbagged machine-gun nests
   * covering the way in from the last roadblock. A pistol alone won't do it.
   */
  private fortifySchool(rng: () => number, dist: number[]): void {
    const school = this.buildings.school;
    const c = school.centre;
    this.schoolMen = school.posts.slice(0, SCHOOL_MEN).map((q, i) => {
      const color = i % 2 ? ARMY_BLUE : ARMY_TAN;
      const heavy = i < SCHOOL_HEAVIES;
      const t = new Trooper(this.world, q.x, q.z, 'enemy', heavy ? shade(color, 0.62) : color, heavy ? ENEMY_HP * 2 : ENEMY_HP);
      this.scene.add(t.root);
      this.byHandle.set(t.collider.handle, t);
      this.enemies.add(t, 5);
      return t;
    });
    // The way the attack comes from: back up the route.
    const total = dist[dist.length - 1];
    const from = this.alongRoute(Math.max(0, total - 70), dist);
    const base = Math.atan2(from.z - c.z, from.x - c.x);
    for (const turn of [-0.55, 0.55]) {
      // The nearest clear ground that way, swinging further round if the first line is all buildings and road.
      let q: Pt | null = null, a = base;
      for (const swing of [0, 0.25, -0.25, 0.5, -0.5, 0.75]) {
        a = base + turn + swing * Math.sign(turn) + (rng() - 0.5) * 0.1;
        for (let r = 18; r < 50 && !q; r += 2) {
          const at = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
          if (this.buildings.clear(at, 2.5)) q = at;
        }
        if (q) break;
      }
      if (q) {
        const nest = buildNest(this.buildings.group, this.world, (x, z) => this.ground(x, z), q, { x: q.x + Math.cos(a), z: q.z + Math.sin(a) });
        const color = turn < 0 ? ARMY_TAN : ARMY_BLUE;
        const gunner = new Trooper(this.world, nest.gunner.x, nest.gunner.z, 'enemy', shade(color, 0.62), ENEMY_HP * 2);
        this.scene.add(gunner.root);
        this.byHandle.set(gunner.collider.handle, gunner);
        this.enemies.add(gunner, 0);
        this.schoolMen.push(gunner);
        this.guns.push({ gunner, gun: nest.gun, mg: { left: 0, next: 0, rest: 1 + rng() * 2 }, silent: () => false });
      }
    }
  }

  /**
   * Patrols walking the streets all over town, three men to a patrol: each walks its own stretch of
   * one street there and back, spread apart, clear of where you start, the school and the
   * roadblocks. Only these: once they're down, the streets stay clear.
   */
  private placePatrols(rng: () => number): void {
    const s = this.town.start, sc = this.buildings.school.centre;
    const kinds = new Set(['residential', 'unclassified', 'tertiary', 'secondary', 'living_street', 'service']);
    const roads = this.town.roads.filter((r) => kinds.has(r.kind) && r.pts.length >= 2);
    // A seeded shuffle, so the patrols are the same every game.
    for (let i = roads.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [roads[i], roads[j]] = [roads[j], roads[i]];
    }
    const mids: Pt[] = [];
    for (const r of roads) {
      if (mids.length >= PATROLS) break;
      // Its first stretch up to BEAT_MAX long.
      const beat: Pt[] = [r.pts[0]];
      let len = 0;
      for (let i = 1; i < r.pts.length && len < BEAT_MAX; i++) {
        len += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].z - r.pts[i - 1].z);
        beat.push(r.pts[i]);
      }
      if (len < 50) continue;
      const mid = beat[Math.floor(beat.length / 2)];
      const far = (p: Pt, d: number) => Math.hypot(p.x - mid.x, p.z - mid.z) > d;
      if (!far(s, PATROL_START_CLEAR) || !far(sc, 90) || !far(this.depot.at, 60)) continue;
      if (!this.blocks.every((b) => far(b.rb.at, 60)) || !mids.every((m) => far(m, 130))) continue;
      if (beat.some((p) => Math.abs(p.x) > this.town.half - 30 || Math.abs(p.z) > this.town.half - 30)) continue;
      mids.push(mid);
      const color = mids.length % 2 ? ARMY_TAN : ARMY_BLUE;
      for (let k = 0; k < PATROL_MEN; k++) {
        // Side by side across the street.
        const off = (k - (PATROL_MEN - 1) / 2) * 1.4;
        const path = beat.map((p, i) => {
          const a = beat[Math.max(0, i - 1)], b = beat[Math.min(beat.length - 1, i + 1)];
          const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
          return new THREE.Vector2(p.x - ((b.z - a.z) / l) * off, p.z + ((b.x - a.x) / l) * off);
        });
        const t = new Trooper(this.world, path[0].x, path[0].y, 'enemy', color, ENEMY_HP);
        this.scene.add(t.root);
        this.byHandle.set(t.collider.handle, t);
        this.enemies.patrol(t, path);
        this.patrolMen.push(t);
      }
    }
  }

  /**
   * The enemy's supply depot, out toward the south-west corner: open ground by a road, as near the
   * corner as there is. It holds an assault rifle, body armour and a grenade launcher, each one for
   * each player, and a handful of guards. It's off the way down the hill: a detour, but the school
   * is hard going with just a pistol.
   */
  private placeDepot(): void {
    const h = this.town.half;
    const corner = { x: -h * DEPOT_TOWARD, z: h * DEPOT_TOWARD };
    let best: { p: Pt; road: Pt } | null = null, bestD = Infinity;
    for (const need of [11, 9]) {
      for (let x = corner.x - 220; x <= corner.x + 220; x += 8) {
        for (let z = corner.z - 220; z <= corner.z + 220; z += 8) {
          const p = { x, z };
          const d = Math.hypot(x - corner.x, z - corner.z);
          if (d >= bestD) continue;
          const road = this.buildings.nearestRoad(p);
          if (!road || Math.hypot(road.x - p.x, road.z - p.z) < need + 2) continue;
          if (!this.buildings.openSpot(p, need)) continue;
          best = { p, road };
          bestD = d;
        }
      }
      if (best) break;
    }
    const found = best as { p: Pt; road: Pt } | null;
    const at = found?.p ?? corner, road = found?.road ?? { x: corner.x + 10, z: corner.z };
    this.depot = buildDepot(this.buildings.group, this.world, (x, z) => this.ground(x, z), at, road, ARMY_TAN);
    for (const q of this.depot.posts.slice(0, DEPOT_GUARDS)) this.addEnemy(q.x, q.z, ARMY_TAN, 4);
  }

  /** Upgrades: walk up to a table at the depot and it's yours (each player has their own). A model goes once everyone has taken it. */
  private updatePickups(): void {
    const players: [PlayerSoldier, Kit, 1 | 2][] = [[this.playerOne, this.kitOne, 1]];
    if (this.player2) players.push([this.player2, this.kit2, 2]);
    const has = (k: Kit, u: Upgrade) => (u === 'rifle' ? k.gun === 'rifle' : u === 'armour' ? k.armour : k.launcher);
    for (const tb of this.depot.tables) {
      for (const [p, k, n] of players) {
        if (p.isDown || has(k, tb.kind) || Math.hypot(p.position.x - tb.at.x, p.position.z - tb.at.z) > PICKUP_REACH) continue;
        if (tb.kind === 'rifle') {
          k.gun = 'rifle';
        } else if (tb.kind === 'armour') {
          k.armour = true;
          p.wearArmour();
        } else {
          k.launcher = true;
          k.grenades = GRENADES;
          k.reload = 0;
        }
        const what = tb.kind === 'rifle' ? 'Fast and straight: it cuts through a crowd' : tb.kind === 'armour' ? 'Hits hurt you less than half as much' : `${GRENADES} shots, then a reload: LB · F · right click`;
        this.hud.showBanner(`${this.player2 ? `PLAYER ${n}: ` : ''}${UPGRADE_NAME[tb.kind]}!`, what);
        this.sound.play('uiConfirm', { volume: 0.6 });
      }
      tb.item.visible = players.some(([, k]) => !has(k, tb.kind));
    }
  }

  /** How many upgrades a kit has (out of 3). */
  private upgrades(k: Kit): number {
    return (k.gun === 'rifle' ? 1 : 0) + (k.armour ? 1 : 0) + (k.launcher ? 1 : 0);
  }

  /**
   * The enemy's prisoner pens: open ground a short detour off the way down the hill (about 80 m,
   * near a road so they can be reached), one beside each stretch of it: a fifth, two fifths, three
   * fifths and four fifths of the way down. Each holds two of our squad, by name, with four guards.
   */
  private placePrisons(): void {
    const route = this.town.route;
    const along = this.routeDistances();
    const total = along[along.length - 1];
    const s = this.town.start, sc = this.buildings.school.centre;
    // How far off the route a spot is, and how far down the route its nearest point is.
    const onRoute = (p: Pt) => {
      let best = Infinity, at = 0;
      route.forEach((q, i) => {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < best) {
          best = d;
          at = along[i];
        }
      });
      return { d: best, at };
    };
    const spots: { p: Pt; road: Pt; d: number; at: number }[] = [];
    const half = this.town.half - 40;
    for (let x = -half; x <= half; x += 12) {
      for (let z = -half; z <= half; z += 12) {
        const p = { x, z };
        const r = onRoute(p);
        if (r.d < PEN_MIN || r.d > PEN_MAX || Math.hypot(p.x - s.x, p.z - s.z) < 60 || Math.hypot(p.x - sc.x, p.z - sc.z) < 90) continue;
        // Not on top of a roadblock either.
        if (this.blocks.some((b) => Math.hypot(b.rb.at.x - p.x, b.rb.at.z - p.z) < 40)) continue;
        const road = this.buildings.nearestRoad(p);
        if (!road || Math.hypot(road.x - p.x, road.z - p.z) < 9) continue;
        if (!this.buildings.openSpot(p, 9)) continue;
        spots.push({ p, road, d: r.d, at: r.at });
      }
    }
    // One per stretch of the route: the spot beside that stretch nearest the ideal detour, clear of the pens already placed.
    const chosen: { p: Pt; road: Pt }[] = [];
    for (let k = 0; k < PENS; k++) {
      const target = (total * (k + 1)) / (PENS + 1);
      let best: (typeof spots)[number] | null = null, bestScore = Infinity;
      for (const c of spots) {
        if (chosen.some((q) => Math.hypot(q.p.x - c.p.x, q.p.z - c.p.z) < PEN_GAP)) continue;
        const score = Math.abs(c.at - target) + Math.abs(c.d - PEN_IDEAL) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best) chosen.push(best);
    }
    const names = [...this.settings.buddyNames, ...MORE_BUDDIES];
    chosen.forEach((c, i) => {
      const army = i % 2 ? ARMY_BLUE : ARMY_TAN;
      const pen = this.buildings.pen(c.p, c.road, army);
      const captives = pen.inside.slice(0, PEN_MEN).map((q, k) => {
        const n = i * PEN_MEN + k;
        const t = new Trooper(this.world, q.x, q.z, 'friend', ARMY_GREEN, SQUAD_HP, names[n] ?? `Buddy ${n + 1}`);
        t.yaw = Math.atan2(-(pen.gate.x - q.x), -(pen.gate.z - q.z));
        this.scene.add(t.root);
        this.byHandle.set(t.collider.handle, t);
        return t;
      });
      const guards = pen.guards.map((q) => this.addEnemy(q.x, q.z, army, 4));
      this.prisons.push({ pen, captives, guards, freed: false, opening: 0 });
    });
  }

  /** Pens: the prisoners stand about until someone of ours stands at the gate long enough, then they join the squad. */
  private updatePrisons(dt: number): void {
    for (const pr of this.prisons) {
      if (pr.freed) continue;
      for (const c of pr.captives) c.update(dt);
      const g = pr.pen.gate;
      const at = [this.playerOne, this.player2].some((p) => p && !p.isDown && Math.hypot(p.position.x - g.x, p.position.z - g.z) < GATE_REACH);
      pr.opening = at ? pr.opening + dt : Math.max(0, pr.opening - dt);
      if (pr.opening < GATE_TIME) continue;
      pr.freed = true;
      pr.pen.open();
      for (const c of pr.captives) {
        if (c.down) c.revive(SQUAD_HP);
        this.squad.add(c);
      }
      if (this.squad.holding) this.squad.toggleHold();
      const left = this.prisons.filter((x) => !x.freed).length;
      this.hud.showBanner(`${pr.captives.map((c) => c.name.toUpperCase()).join(' AND ')} FREED!`, left ? `They're with you now. ${left} more pen${left === 1 ? '' : 's'} on your map` : 'The whole squad is back together!');
      this.sound.music.stinger();
      this.enemies.hear(new THREE.Vector3(g.x, this.ground(g.x, g.z), g.z), 30);
    }
  }

  /** The nearest pen still holding our men, and how far it is. */
  private nearestPen(p: THREE.Vector3): { pr: Prison; d: number } | null {
    let best: { pr: Prison; d: number } | null = null;
    for (const pr of this.prisons) {
      if (pr.freed) continue;
      const d = Math.hypot(pr.pen.at.x - p.x, pr.pen.at.z - p.z);
      if (!best || d < best.d) best = { pr, d };
    }
    return best;
  }

  private addPlayer2(): void {
    const p = this.player.position;
    this.player2 = new PlayerSoldier(this.world, p.x + 1.8, p.z, this.player.yaw);
    this.player2.teleport(p.x + 1.8, p.z, this.player.yaw, this.ground(p.x + 1.8, p.z) + 0.05);
    this.scene.add(this.player2.root);
    this.cam2 = new ShoulderCam(this.camera2, this.world);
  }

  private applySettings(): void {
    const graphics = GRAPHICS_QUALITY[this.settings.graphicsQuality];
    const ratio = Math.min(window.devicePixelRatio, graphics.pixelRatio);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = graphics.shadowSize > 0;
    this.renderer.shadowMap.autoUpdate = false;
    const size = graphics.shadowSize || 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(size, size);
    }
    this.input.setAimScale(AIM_SPEED_SCALE[this.settings.aimSpeed]);
    this.sound.setVolumes(this.settings.sfxVolume, this.settings.musicVolume);
    this.syncPlayer2();
    this.pausedRendered = false;
  }

  private syncPlayer2(): void {
    if (!this.player || !this.world) return;
    const enabled = this.settings.player2Controller !== -2;
    if (enabled && !this.player2) this.addPlayer2();
    else if (!enabled && this.player2) {
      this.scene.remove(this.player2.root);
      this.player2.dispose();
      this.player2 = null;
    }
    this.hud.setCoopLayout(!!this.player2);
    this.hud2.setActive(!!this.player2);
  }

  /** Runs `run` as player two: their soldier, camera, HUD and kit stand in for player one's. */
  private withPlayer2<T>(run: () => T): T {
    if (!this.player2) return run();
    const player = this.player, camera = this.camera, cam = this.cam, hud = this.hud, kit = this.kit;
    this.player = this.player2; this.camera = this.camera2; this.cam = this.cam2; this.hud = this.hud2; this.kit = this.kit2;
    try {
      return run();
    } finally {
      this.player = player; this.camera = camera; this.cam = cam; this.hud = hud; this.kit = kit;
    }
  }

  /** The other player, from inside a turn (null playing alone). */
  private get partner(): PlayerSoldier | null {
    if (!this.player2) return null;
    return this.player === this.player2 ? this.playerOne : this.player2;
  }
  /** Player one's soldier, camera and kit, which stay put while player two's turn swaps the current ones. */
  private playerOne!: PlayerSoldier;
  private camOne!: ShoulderCam;
  private kitOne!: Kit;

  private onResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (!this.player2) this.hud.setViewport({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    this.pausedRendered = false;
  }

  // ---------- people ----------

  private addEnemy(x: number, z: number, color: number, roam: number): Trooper {
    const t = new Trooper(this.world, x, z, 'enemy', color, ENEMY_HP);
    this.scene.add(t.root);
    this.byHandle.set(t.collider.handle, t);
    this.enemies.add(t, roam);
    return t;
  }

  private makeBattle(): Battle {
    const game = this;
    const chest = new THREE.Vector3();
    const view = (soldier: PlayerSoldier) => ({ pos: soldier.position, chest: soldier.position.clone().setY(soldier.position.y + 1.15), down: soldier.isDown, sneaking: soldier.sneaking });
    return {
      sees: (a, b) => this.sees(a, b),
      visibility: 1,
      player: {
        get pos() {
          return game.player.position;
        },
        get chest() {
          return chest.copy(game.player.position).setY(game.player.position.y + 1.15);
        },
        get down() {
          return game.player.isDown;
        },
        get sneaking() {
          return game.player.sneaking;
        },
      },
      get players() {
        return game.player2 ? [view(game.playerOne), view(game.player2)] : undefined;
      },
      fireAt: (shooter, aim) => this.troopFire(shooter, aim),
      squad: () => this.squad.list.filter((b) => b.t.active).map((b) => b.t),
      enemies: () => this.enemies.list.filter((b) => b.t.active).map((b) => b.t),
      unseen: (p) => {
        const ndc = p.clone().project(this.camera);
        return ndc.z > 1 || Math.abs(ndc.x) > 1.15 || Math.abs(ndc.y) > 1.15;
      },
      bombs: () => this.explosives.armed(),
    };
  }

  // ---------- shooting ----------

  /** A clear line: houses, walls, hedges, cars, trunks and the hill itself block it (people don't). */
  private sees(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = b.clone().sub(a);
    const d = dir.length();
    if (d < 0.01) return true;
    return !this.world.castRay(new RAPIER.Ray(a, dir.divideScalar(d)), Math.max(0, d - 0.4), true, undefined, WALLS_ONLY);
  }

  private aimPoint(): THREE.Vector3 {
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const aim = this.cam.aimDirection();
    const sight = this.world.castRay(new RAPIER.Ray(camPos, aim), SHOT_RANGE, true, undefined, FRIEND_SHOTS);
    return camPos.addScaledVector(aim, sight ? sight.timeOfImpact : SHOT_RANGE);
  }

  /** Hurts either player (player two's camera and kit are never swapped, player one's are kept in camOne and kitOne). */
  private hurtPlayer(target: PlayerSoldier, amount: number, shake: number): void {
    const second = target === this.player2;
    const wasUp = !target.isDown;
    target.takeDamage((second ? this.kit2 : this.kitOne).armour ? amount * ARMOUR : amount);
    (second ? this.cam2 : this.camOne).addShake(shake);
    if (wasUp && target.isDown) (second ? this.kit2 : this.kitOne).downTime = 0;
  }

  /** One rifle round from `from` along `dir`: what it hits, tracer and all. */
  private resolveRound(from: THREE.Vector3, dir: THREE.Vector3, side: 'friend' | 'enemy'): void {
    const hit = this.world.castRay(new RAPIER.Ray(from, dir), SHOT_RANGE, true, undefined, side === 'friend' ? FRIEND_SHOTS : ENEMY_SHOTS);
    const end = from.clone().addScaledVector(dir, hit ? hit.timeOfImpact : 70);
    this.addTracer(from, end, side === 'friend' ? this.friendTracer : this.enemyTracer);
    if (!hit) return;
    const handle = hit.collider.handle;
    this.impacts.dustPuff(end);
    if (side === 'friend') {
      const e = this.byHandle.get(handle);
      if (e && e.side === 'enemy' && !e.down && e.hurt(1)) {
        this.stats.enemiesDown++;
        this.sound.play('thud', { at: end, volume: 0.5, rate: 1.2, minGap: 0.05 });
      }
      return;
    }
    for (const p of [this.playerOne, this.player2]) {
      if (!p || handle !== p.collider.handle) continue;
      this.hurtPlayer(p, ENEMY_DAMAGE, 0.22);
      this.sound.play('thud', { volume: 0.45, rate: 1.6, minGap: 0.1 });
      return;
    }
    const f = this.byHandle.get(handle);
    if (f && f.side === 'friend' && !f.down) f.hurt(ENEMY_DAMAGE);
  }

  /** A soldier fires at `aim`, with a scatter that grows with the range. */
  private troopFire(shooter: Trooper, aim: THREE.Vector3): void {
    const fwd = new THREE.Vector3(-Math.sin(shooter.yaw), 0, -Math.cos(shooter.yaw));
    const from = shooter.eye().addScaledVector(fwd, 0.7);
    const dir = aim.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    const spread = (shooter.side === 'friend' ? 0.02 : 0.03) + dist * (shooter.side === 'friend' ? 0.0016 : 0.0021);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    this.impacts.muzzleFlash(from, dir, 0.25);
    this.sound.play('crack', { at: from, volume: 0.2, rate: shooter.side === 'friend' ? 2.1 : 1.8, minGap: 0.04 });
    this.resolveRound(from, dir, shooter.side);
    if (shooter.side === 'friend') this.enemies.hear(shooter.pos, SHOT_NOISE * 0.8);
  }

  private firePlayerRifle(): void {
    const muzzle = this.player.muzzle();
    const dir = this.aimPoint().sub(muzzle).normalize();
    // The pistol wanders more, so at range it misses.
    const pistol = this.kit.gun === 'pistol';
    const spread = pistol ? PISTOL_SPREAD : RIFLE_SPREAD;
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    this.impacts.muzzleFlash(muzzle, dir, pistol ? 0.2 : 0.3);
    this.sound.play('crack', { volume: pistol ? 0.22 : 0.28, rate: pistol ? 2.7 : 2.3, minGap: 0.05 });
    this.cam.addShake(pistol ? 0.05 : 0.07);
    this.enemies.hear(muzzle, SHOT_NOISE);
    this.resolveRound(muzzle, dir, 'friend');
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3, material: THREE.LineBasicMaterial): void {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material);
    this.scene.add(line);
    this.tracers.push({ line, age: 0 });
  }

  private updateTracers(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.age += dt;
      if (t.age < TRACER_TIME) continue;
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      this.tracers.splice(i, 1);
    }
  }

  // ---------- the jam gun and the grenade launcher ----------

  private updateJam(input: InputState, dt: number): void {
    const k = this.kit;
    const spraying = input.jamFiring && !this.player.isDown && k.jamTank > 0;
    if (spraying) {
      k.jamTank = Math.max(0, k.jamTank - JAM_DRAIN * dt);
      k.jamCooldown -= dt;
      if (k.jamCooldown <= 0) {
        k.jamCooldown = JAM_INTERVAL;
        this.lobJam(this.player.muzzle(), this.aimPoint());
        this.sound.play('jamShot', { volume: 0.22, rate: 1.1, minGap: 0.09 });
      }
    } else {
      k.jamCooldown = 0;
      if (!input.jamFiring) k.jamTank = Math.min(1, k.jamTank + JAM_REFILL * dt);
    }
    k.jam.update(
      dt,
      this.world,
      this.player.collider,
      (point) => {
        this.sound.play('splat', { at: point, volume: 0.9, minGap: 0.1 });
        this.jamSoldiers(point, JAM_RADIUS);
      },
      (point) => this.jamSoldiers(point, 1),
    );
  }

  private jamSoldiers(point: THREE.Vector3, radius: number): void {
    for (const b of this.enemies.list) {
      const t = b.t;
      if (!t.active || Math.hypot(t.pos.x - point.x, t.pos.z - point.z) > radius || point.y - t.pos.y > 3) continue;
      if (t.jam()) this.enemies.hear(t.pos, 12);
    }
  }

  private lobJam(from: THREE.Vector3, target: THREE.Vector3): void {
    const dir = target.clone().sub(from);
    const reach = Math.min(JAM_RANGE, Math.hypot(dir.x, dir.z));
    dir.normalize();
    dir.x += (Math.random() - 0.5) * 0.08;
    dir.y += Math.min(0.4, (JAM_GRAVITY * reach) / (2 * JAM_SPEED * JAM_SPEED)) + (Math.random() - 0.5) * 0.05;
    dir.z += (Math.random() - 0.5) * 0.08;
    this.kit.jam.fire(from, dir.normalize(), JAM_SPEED * (0.95 + Math.random() * 0.1));
  }

  private fireGrenade(): void {
    const k = this.kit;
    if (!k.launcher) {
      this.hud.showCallout('NO GRENADE LAUNCHER: THERE\'S ONE AT THE SUPPLY DEPOT', '#ffd24a');
      return;
    }
    if (k.grenades <= 0 || this.player.isDown) {
      if (k.grenades <= 0) this.hud.showCallout(`GRENADE LAUNCHER RELOADING: ${Math.ceil(k.reload)}s`, '#ffd24a');
      return;
    }
    const muzzle = this.player.muzzle();
    const dir = this.aimPoint().sub(muzzle).normalize();
    dir.y += 0.2;
    this.explosives.launch(muzzle, dir.normalize());
    k.grenades--;
    this.stats.grenadesFired++;
    if (k.grenades === 0) k.reload = GRENADE_RELOAD;
    this.sound.play('cannon', { volume: 0.35, rate: 1.7, minGap: 0.2 });
    this.impacts.muzzleFlash(muzzle, dir, 0.4);
    this.cam.addShake(0.14);
    this.enemies.hear(muzzle, 34);
  }

  private onBlast(b: Blast): void {
    this.impacts.explode(b.at, 2);
    this.sound.play('cannon', { at: b.at, volume: 0.7, rate: 1.2 });
    for (const e of this.enemies.list) {
      const t = e.t;
      if (t.down) continue;
      const d = Math.hypot(t.pos.x - b.at.x, t.pos.z - b.at.z);
      if (d > b.radius || Math.abs(t.pos.y - b.at.y) > 4) continue;
      if (t.hurt(d < b.radius * 0.55 ? 3 : 2)) this.stats.enemiesDown++;
    }
    this.enemies.hear(b.at, 45);
    // Friendly fire: closer is worse.
    for (const p of [this.playerOne, this.player2]) {
      if (!p || p.isDown) continue;
      const d = Math.hypot(p.position.x - b.at.x, p.position.z - b.at.z);
      if (d < b.radius) this.hurtPlayer(p, 30 * (1 - d / b.radius), 0.35);
    }
    for (const s of this.squad.list) {
      const dist = Math.hypot(s.t.pos.x - b.at.x, s.t.pos.z - b.at.z);
      if (dist < b.radius && !s.t.down) s.t.hurt(30 * (1 - dist / b.radius));
    }
  }

  /**
   * The roadblocks' machine guns: when its gunner can see one of ours in range he fires a burst of
   * rounds, rests, and fires again; the gun swings round with him. Stuck in jam, knocked down or
   * with the roadblock taken, it's silent.
   */
  private updateMachineGuns(dt: number): void {
    for (const b of this.guns) {
      const g = b.gunner;
      const mg = b.mg;
      mg.rest = Math.max(0, mg.rest - dt);
      if (b.silent() || !g.active) {
        mg.left = 0;
        continue;
      }
      const eye = g.eye();
      let target: THREE.Vector3 | null = null;
      let best = MG_RANGE;
      const consider = (pos: THREE.Vector3) => {
        const d = Math.hypot(pos.x - g.pos.x, pos.z - g.pos.z);
        const chest = pos.clone().setY(pos.y + 1.15);
        if (d < best && this.sees(eye, chest)) {
          best = d;
          target = chest;
        }
      };
      for (const p of [this.playerOne, this.player2]) if (p && !p.isDown) consider(p.position);
      for (const s of this.squad.list) if (s.t.active) consider(s.t.pos);
      const aim = target as THREE.Vector3 | null;
      if (aim) {
        g.faceToward(aim.x, aim.z, dt, 12);
        b.gun.rotation.y = Math.atan2(-(aim.x - b.gun.position.x), -(aim.z - b.gun.position.z));
      }
      if (mg.left > 0) {
        mg.next -= dt;
        if (mg.next <= 0) {
          mg.next = MG_EVERY;
          mg.left--;
          if (aim) this.troopFire(g, aim);
          if (mg.left === 0) mg.rest = MG_REST * (0.8 + Math.random() * 0.4);
        }
      } else if (aim && mg.rest === 0) {
        mg.left = MG_BURST;
        mg.next = 0;
        this.enemies.hear(g.pos, 40);
      }
    }
  }

  // ---------- objectives ----------

  private standing(men: Trooper[]): number {
    return men.filter((t) => !t.down && t.state !== 'jammed').length;
  }

  private updateObjectives(dt: number): void {
    for (const b of this.blocks) {
      if (b.taken || this.standing(b.men) > CLEARED) continue;
      b.taken = true;
      b.rb.flagMaterial.color.setHex(ARMY_GREEN);
      const ahead = this.blocks.filter((x) => !x.taken).length;
      this.checkpoint = { x: b.rb.at.x + b.rb.facing.x * 6, z: b.rb.at.z + b.rb.facing.z * 6, yaw: Math.atan2(b.rb.facing.x, b.rb.facing.z) };
      this.hud.showBanner(`${b.name.toUpperCase()} TAKEN!`, ahead ? `Checkpoint here. ${ahead} more roadblock${ahead === 1 ? '' : 's'} on the way down` : 'Checkpoint here. Now on down to the school!');
      this.sound.music.stinger();
    }
    if (!this.schoolCleared && this.standing(this.schoolMen) <= CLEARED) {
      this.schoolCleared = true;
      this.hud.showBanner('THE SCHOOL IS CLEAR!', 'Get to the flagpole in front of it and raise our flag');
      this.sound.music.stinger();
    }
    if (this.schoolCleared && this.victoryAt === null) {
      const pole = this.buildings.school.pole;
      const at = [this.playerOne, this.player2].some((p) => p && !p.isDown && Math.hypot(p.position.x - pole.x, p.position.z - pole.z) < FLAG_REACH);
      this.flag = Math.max(0, Math.min(1, this.flag + (at ? dt / FLAG_TIME : -dt / (FLAG_TIME * 3))));
      this.buildings.school.raise(this.flag);
      if (this.flag >= 1) {
        this.victoryAt = this.time;
        this.hud.showVictory('Mauricewood Primary is ours! Our flag flies over Penicuik.', '');
        if (document.pointerLockElement) document.exitPointerLock();
        this.sound.music.fanfare();
      }
    }
  }

  /** The victory screen: play the level again, or (if there is one) on to the next mission after a while. */
  private afterVictory(input: InputState, input2: InputState | null): void {
    const since = this.time - (this.victoryAt as number);
    const next = nextMission();
    const key = input.usingGamepad ? 'A' : 'Enter';
    const wait = Math.max(0, Math.ceil(VICTORY_DELAY - since));
    this.hud.setVictoryFooter(`Press ${key} to play Penicuik again${next ? `  ·  next mission in ${wait}s` : '  ·  or pick another level from the pause menu'}`);
    if (since > REPLAY_AFTER && (input.menu.confirm || input2?.menu.confirm)) {
      this.leaving = true;
      window.location.reload();
      return;
    }
    if (next && since > VICTORY_DELAY) {
      this.leaving = true;
      startMission(next);
    }
  }

  // ---------- the frame ----------

  private toCheckpoint(): void {
    const c = this.checkpoint;
    const off = this.player === this.player2 ? 1.8 : 0;
    this.player.teleport(c.x + off, c.z, c.yaw, this.ground(c.x + off, c.z) + 0.05);
    this.kit.downTime = 0;
    this.kit.revive = 0;
  }

  private recordTrail(): void {
    const p = this.playerOne.position;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.7) this.trail.push(new THREE.Vector3(p.x, 0, p.z));
    if (this.trail.length > 400) this.trail.splice(0, 100);
  }

  /** One player's turn: moving, shooting, the launcher, and being helped up by the other. */
  private playerTurn(input: InputState, dt: number): void {
    const k = this.kit;
    if (input.cameraTogglePressed) this.cam.toggle();
    if (input.megaJamPressed) {
      const holding = this.squad.toggleHold();
      this.hud.showCallout(holding ? 'SQUAD: HOLD HERE' : 'SQUAD: FOLLOW ME', holding ? '#ffd24a' : '#9be27a');
      this.sound.play('uiChange', { volume: 0.5 });
    }
    if (this.player.isDown) {
      k.downTime += dt;
      const mate = this.partner;
      const helping = !!mate && !mate.isDown && Math.hypot(mate.position.x - this.player.position.x, mate.position.z - this.player.position.z) < REVIVE_REACH;
      k.revive = helping ? k.revive + dt : 0;
      if (k.revive >= REVIVE_TIME) {
        this.player.revive();
        k.revive = 0;
        this.hud.showCallout('BACK ON YOUR FEET!', '#9be27a');
      }
    }
    const wasDown = this.player.isDown;
    this.player.fireInterval = k.gun === 'rifle' ? RIFLE_EVERY : PISTOL_EVERY;
    if (this.player.step(input, dt)) this.firePlayerRifle();
    if (input.resetPressed || (wasDown && !this.player.isDown && this.player.health === 0)) this.toCheckpoint();
    // Fell off the world somehow (through a gap at the edge): back to the checkpoint.
    if (this.player.position.y < this.ground(this.player.position.x, this.player.position.z) - 4) this.toCheckpoint();
    this.updateJam(input, dt);
    if (input.rocketPressed) this.fireGrenade();
    if (k.reload > 0) {
      k.reload -= dt;
      if (k.reload <= 0) {
        k.reload = 0;
        k.grenades = GRENADES;
        this.hud.showCallout('GRENADE LAUNCHER RELOADED', '#9be27a');
      }
    }
  }

  private step(input: InputState, dt: number, input2: InputState | null = null): void {
    if (input.mapTogglePressed || input2?.mapTogglePressed) this.hud.toggleBigMap();
    this.time += dt;
    if (this.victoryAt !== null && !this.leaving) this.afterVictory(input, input2);
    this.playerTurn(input, dt);
    if (this.player2 && input2) this.withPlayer2(() => this.playerTurn(input2, dt));
    this.recordTrail();
    this.squad.update(dt, this.battle, this.trail);
    this.enemies.update(dt, this.battle);
    this.updateMachineGuns(dt);
    for (const [handle, t] of this.byHandle) if (t.gone) this.byHandle.delete(handle);
    this.explosives.update(dt, (b) => this.onBlast(b), (pt) => this.impacts.trailPuff(pt));
    this.updatePrisons(dt);
    this.updatePickups();
    this.depot.update(this.time);
    this.updateObjectives(dt);
    this.world.step();

    this.cam.update(this.player, dt);
    if (this.player2) this.cam2.update(this.player2, dt);
    this.impacts.update(dt);
    this.updateTracers(dt);
    const p = this.player.position;
    this.sun.position.set(p.x - 40, p.y + 90, p.z + 30);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();
    this.mapAge += dt;
    if (this.mapAge > 0.15) {
      this.mapAge = 0;
      this.refreshMap();
    }
    if (import.meta.env.DEV && this.debugCam) {
      this.camera.position.set(...this.debugCam.pos);
      this.camera.lookAt(...this.debugCam.look);
    }
  }

  private refreshMap(): void {
    const d = this.map.data;
    const one = this.playerOne ?? this.player;
    const players = [one, ...(this.player2 ? [this.player2] : [])];
    d.players = players.map((s) => ({ x: s.position.x, z: s.position.z, yaw: s.yaw, down: s.isDown }));
    d.squad = this.squad.list.map((b) => ({ x: b.t.pos.x, z: b.t.pos.z, down: b.t.down }));
    const watch = [...players.map((s) => s.position), ...this.squad.list.filter((b) => b.t.active).map((b) => b.t.pos)];
    d.enemies = this.enemies.list.filter((b) => b.t.active && watch.some((w) => Math.hypot(w.x - b.t.pos.x, w.z - b.t.pos.z) < REVEAL)).map((b) => ({ x: b.t.pos.x, z: b.t.pos.z }));
    d.roadblocks = this.blocks.map((b) => ({ x: b.rb.at.x, z: b.rb.at.z, army: b.army, taken: b.taken }));
    const sc = this.buildings.school.centre;
    d.school = { x: sc.x, z: sc.z, taken: this.victoryAt !== null };
    d.pens = this.prisons.map((pr) => ({ x: pr.pen.at.x, z: pr.pen.at.z, freed: pr.freed }));
    d.depot = { x: this.depot.at.x, z: this.depot.at.z, stocked: this.depot.tables.some((tb) => tb.item.visible) };
    const p = one.position;
    this.mapView = { ...NO_MAP, playerX: p.x, playerZ: p.z, playerYaw: one.yaw };
  }

  // ---------- HUD ----------

  private waypointTo(point: THREE.Vector3, label: string): HUDState['waypoint'] {
    const view = point.clone().applyMatrix4(this.camera.matrixWorldInverse);
    let x = view.x;
    let y = view.y;
    let onScreen = false;
    if (view.z < -1) {
      const ndc = point.clone().project(this.camera);
      x = ndc.x;
      y = ndc.y;
      onScreen = Math.abs(x) < 0.92 && Math.abs(y) < 0.8;
    } else {
      y = -Math.abs(y) - 0.2 * Math.abs(x) - 1e-3;
    }
    if (!onScreen) {
      const k = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.75);
      x /= k;
      y /= k;
    }
    return { x: ((x + 1) / 2) * window.innerWidth, y: ((1 - y) / 2) * window.innerHeight, onScreen, angle: Math.atan2(-y, x), label };
  }

  /**
   * The way to go next. It takes turns: free a pen of buddies, then take a roadblock, then the next
   * pen, and so on (whichever is due: a pen while no more pens have been freed than roadblocks
   * taken). The pen is the nearest one still holding our men; the roadblock is the next one down
   * the hill. When one kind runs out it's the other, and then the school (and its flagpole).
   */
  private waypoint(): HUDState['waypoint'] {
    if (this.hud.paused || this.victoryAt !== null) return null;
    const p = this.player.position;
    const next = this.blocks.find((b) => !b.taken);
    const pen = this.nearestPen(p);
    const freed = this.prisons.filter((pr) => pr.freed).length;
    const taken = this.blocks.filter((b) => b.taken).length;
    if (pen && (!next || freed <= taken)) {
      const g = pen.pr.pen.gate;
      return this.waypointTo(new THREE.Vector3(g.x, this.ground(g.x, g.z) + 4, g.z), `FREE ${pen.pr.captives.map((c) => c.name.toUpperCase()).join(' & ')} ${Math.round(pen.d)} m`);
    }
    if (next) {
      const a = next.rb.at;
      return this.waypointTo(new THREE.Vector3(a.x, this.ground(a.x, a.z) + 6, a.z), `${next.name.toUpperCase()} ${Math.round(Math.hypot(a.x - p.x, a.z - p.z))} m`);
    }
    const target = this.schoolCleared ? this.buildings.school.pole : (() => {
      const c = this.buildings.school.centre;
      return new THREE.Vector3(c.x, this.ground(c.x, c.z), c.z);
    })();
    return this.waypointTo(target.clone().setY(target.y + 8), `${this.schoolCleared ? 'FLAGPOLE' : 'MAURICEWOOD PRIMARY'} ${Math.round(Math.hypot(target.x - p.x, target.z - p.z))} m`);
  }

  private objectives(): { label: string; done: boolean }[] {
    const taken = this.blocks.filter((b) => b.taken).length;
    const left = this.standing(this.schoolMen);
    return [
      { label: `Break through the roadblocks on the way down (${taken} / ${this.blocks.length})`, done: taken === this.blocks.length },
      { label: `Free your squad from the enemy's pens (${this.prisons.filter((pr) => pr.freed).length} / ${this.prisons.length}) (optional)`, done: this.prisons.every((pr) => pr.freed) },
      { label: `Grab the upgrades at the supply depot, south-west (${this.upgrades(this.kit)} / 3) (optional)`, done: this.upgrades(this.kit) === 3 },
      { label: `Clear Mauricewood Primary School (${this.schoolMen.length - left} / ${this.schoolMen.length} defenders)`, done: this.schoolCleared },
      { label: 'Raise our flag on the school flagpole', done: this.victoryAt !== null },
    ];
  }

  private prisonHUD(): PrisonHUD {
    const p = this.player.position;
    const k = this.kit;
    let prompt: string | null = null;
    const mate = this.partner;
    if (this.player.downFor > 0) prompt = mate && !mate.isDown ? `Knocked down! Your partner can help you up, or you're back at the checkpoint in ${Math.ceil(this.player.downFor)}…` : `Knocked down! Back at the checkpoint in ${Math.ceil(this.player.downFor)}…`;
    else if (mate?.isDown && Math.hypot(mate.position.x - p.x, mate.position.z - p.z) < 12) prompt = 'Your partner is down! Stand next to them to help them up';
    else if (this.schoolCleared && this.victoryAt === null) prompt = Math.hypot(this.buildings.school.pole.x - p.x, this.buildings.school.pole.z - p.z) < FLAG_REACH ? `Raising the flag… ${Math.round(this.flag * 100)}%` : 'Stand at the flagpole to raise our flag';
    else if (this.prisons.some((pr) => !pr.freed && Math.hypot(pr.pen.gate.x - p.x, pr.pen.gate.z - p.z) < 10)) {
      const pr = this.prisons.find((x) => !x.freed && Math.hypot(x.pen.gate.x - p.x, x.pen.gate.z - p.z) < 10) as Prison;
      prompt = pr.opening > 0 ? `Opening the gate… ${Math.round((pr.opening / GATE_TIME) * 100)}%` : `${pr.captives.map((c) => c.name).join(' and ')} are locked in here! Stand at the gate to let them out`;
    } else if (this.depot.tables.some((tb) => tb.item.visible && Math.hypot(tb.at.x - p.x, tb.at.z - p.z) < 9)) {
      const missing = this.depot.tables.filter((tb) => Math.hypot(tb.at.x - p.x, tb.at.z - p.z) < 9 && this.upgrades(k) < 3).map((tb) => tb.kind).filter((u) => (u === 'rifle' ? k.gun !== 'rifle' : u === 'armour' ? !k.armour : !k.launcher));
      if (missing.length) prompt = `Walk up to a table to take the ${missing.map((u) => UPGRADE_NAME[u].toLowerCase()).join(', the ')}`;
    } else if (this.time < 16) prompt = 'Outside 64 Sycamore Drive, on your own with just a pistol. Follow the golden marker down the hill. Off the route, the supply depot in the south-west corner (on your map) has an assault rifle, body armour and a grenade launcher';
    else if (!this.schoolCleared && this.upgrades(k) < 3 && Math.hypot(this.buildings.school.centre.x - p.x, this.buildings.school.centre.z - p.z) < 150) prompt = `Mauricewood Primary is dug in: two machine guns and ${this.schoolMen.length} men. You'll want the upgrades from the supply depot in the south-west corner first`;
    const height = Math.round(this.town.base + this.ground(p.x, p.z));
    const street = this.streetName(p);
    const status = [`Squad ${this.squad.standing} / ${this.squad.list.length}${this.squad.holding ? ' (HOLDING)' : ''}  ·  ${height} m above sea level`];
    const patrols = this.standing(this.patrolMen);
    status.push(`${k.gun === 'rifle' ? 'Assault rifle' : 'Pistol'}${k.armour ? ' · body armour' : ''}  ·  ${patrols ? `${patrols} patrolling the streets` : 'Streets clear of patrols'}`);
    if (street) status.push(street);
    const alerted = this.enemies.alerted;
    return {
      title: TITLE,
      objectives: this.objectives(),
      prompt,
      downFor: this.player.downFor,
      jam: k.jamTank,
      onRaft: false,
      stealth: this.player.isDown
        ? null
        : alerted > 0
          ? { level: Math.min(1, 0.3 + alerted / 8), label: `${alerted} ENEMY ON THE ALERT`, color: '#ff6a4a' }
          : { level: 0, label: this.player.sneaking ? 'UNSEEN · CREEPING' : 'UNSEEN', color: '#9be27a' },
      status,
      launcher: k.launcher ? { shots: k.grenades, max: GRENADES, reloadLeft: k.reload, reloadTime: GRENADE_RELOAD } : undefined,
      gun: k.gun === 'rifle' ? 'ASSAULT RIFLE' : 'PISTOL',
    };
  }

  private streetCache = { x: 1e9, z: 1e9, name: '' };
  /** The name of the street he's on (or next to), looked up every few metres. */
  private streetName(p: THREE.Vector3): string {
    const c = this.streetCache;
    if (Math.hypot(p.x - c.x, p.z - c.z) < 4) return c.name;
    let best = '', bestD = 14;
    for (const r of this.town.roads) {
      if (!r.name) continue;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const dx = b.x - a.x, dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        const d = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
        if (d < bestD) {
          bestD = d;
          best = r.name;
        }
      }
    }
    this.streetCache = { x: p.x, z: p.z, name: best };
    return best;
  }

  private hudState(input: InputState): HUDState {
    const split = !!this.player2;
    const vertical = this.settings.splitOrientation === 'vertical';
    const second = this.player === this.player2;
    const localWidth = split && vertical ? (second ? window.innerWidth - Math.floor(window.innerWidth / 2) : Math.floor(window.innerWidth / 2)) : window.innerWidth;
    const localHeight = split && !vertical ? (second ? Math.floor(window.innerHeight / 2) : window.innerHeight - Math.floor(window.innerHeight / 2)) : window.innerHeight;
    const position = this.player.position;
    return {
      zombies: null,
      health: this.player.health,
      maxHealth: MAX_HEALTH,
      reloadFraction: 0,
      damageBoost: 0,
      ride: null,
      cameraMode: this.cam.mode,
      usingGamepad: input.usingGamepad,
      keyboardPlayer: input.keyboardPlayer,
      keyboardEnabled: input.keyboardEnabled,
      insideBase: null,
      map: second ? { ...this.mapView, playerX: position.x, playerZ: position.z, playerYaw: this.player.yaw } : this.mapView,
      aimScreen: this.hud.paused ? null : { x: localWidth / 2, y: localHeight / 2 },
      aimRange: null,
      aimTarget: 'none',
      rocketCharge: 0,
      rocketDamaged: false,
      rocketLockScreen: null,
      aaLoaded: 0,
      aaMax: 0,
      aaFiring: false,
      aaRearming: false,
      aaLockScreen: null,
      buddyCharge: 0,
      megaJamCharge: 0,
      buddyRoster: [],
      buddyOut: [],
      buddyMax: 0,
      cinematic: false,
      cinematicLabel: '',
      waypoint: this.waypoint(),
      enemyBasesLeft: 0,
      enemyBasesTotal: 0,
      nearbyBase: null,
      airSupport: null,
      tanker: null,
      siege: null,
      prison: this.prisonHUD(),
      driveStyle: this.settings.driveStyle,
      mouseCaptureHint: input.keyboardEnabled && !input.pointerLocked && input.pointerLockAvailable,
      soundLocked: this.sound.locked && (this.settings.sfxVolume > 0 || this.settings.musicVolume > 0),
    };
  }

  private render(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setScissorTest(!!this.player2);
    if (!this.player2) {
      this.hud.setViewport({ left: 0, top: 0, width: w, height: h });
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const half = Math.floor((this.settings.splitOrientation === 'vertical' ? w : h) / 2);
    const v1 = this.settings.splitOrientation === 'vertical' ? { left: 0, top: 0, width: half, height: h } : { left: 0, top: 0, width: w, height: h - half };
    const v2 = this.settings.splitOrientation === 'vertical' ? { left: half, top: 0, width: w - half, height: h } : { left: 0, top: h - half, width: w, height: half };
    this.hud.setViewport(v1);
    this.hud2.setViewport(v2);
    for (const [camera, v] of [[this.camera, v1], [this.camera2, v2]] as const) {
      camera.aspect = v.width / v.height;
      camera.updateProjectionMatrix();
      const bottom = h - v.top - v.height;
      this.renderer.setViewport(v.left, bottom, v.width, v.height);
      this.renderer.setScissor(v.left, bottom, v.width, v.height);
      this.renderer.render(this.scene, camera);
    }
    this.renderer.setScissorTest(false);
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate);
    if (!this.ready) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.input.textEntry = this.hud.editingText;
    this.input.beginFrame();
    const pads = Array.from(navigator.getGamepads?.() ?? []);
    const p2Index = this.player2 ? this.settings.player2Controller : -3;
    const p1Index = !this.player2 ? -2 : this.settings.player1Controller === -2 ? (pads.find((pad) => pad && pad.index !== p2Index)?.index ?? -1) : this.settings.player1Controller;
    const input = this.input.update(dt, p1Index, 1, this.settings.splitOrientation, !!this.player2 && p2Index === -1, pads, this.player2 && p2Index === -1 ? 2 : 1);
    const input2 = this.player2 ? this.input.update(dt, p2Index, 2, this.settings.splitOrientation, false, pads, this.player2 && p2Index === -1 ? 2 : 1) : null;
    const kbMenu = this.input.keyboardMenu();
    input.mapTogglePressed ||= kbMenu.mapTogglePressed;
    // On the victory screen the keyboard can always choose to play again.
    if (this.victoryAt !== null) input.menu.confirm ||= kbMenu.menu.confirm;
    if (this.hud.paused) {
      this.sound.updateEngine(0, 'chopper', false);
      this.hud.handleMenu({
        up: input.menu.up || kbMenu.menu.up || !!input2?.menu.up,
        down: input.menu.down || kbMenu.menu.down || !!input2?.menu.down,
        left: input.menu.left || kbMenu.menu.left || !!input2?.menu.left,
        right: input.menu.right || kbMenu.menu.right || !!input2?.menu.right,
        confirm: input.menu.confirm || kbMenu.menu.confirm || !!input2?.menu.confirm,
        back: input.menu.back || kbMenu.menu.back || !!input2?.menu.back,
        options: input.menu.options || kbMenu.menu.options || !!input2?.menu.options,
      });
      if ((input.mapTogglePressed || input2?.mapTogglePressed) && this.hud.paused) this.hud.toggleBigMap();
      this.hud.update(this.hudState(input));
      if (input2 && this.player2) this.withPlayer2(() => this.hud2.update(this.hudState(input2)));
      if (!this.pausedRendered) {
        this.render();
        this.pausedRendered = true;
      }
      return;
    }
    this.pausedRendered = false;
    this.step(input, dt, input2);
    this.sound.setListener(this.camera);
    this.hud.update(this.hudState(input));
    if (input2 && this.player2) this.withPlayer2(() => this.hud2.update(this.hudState(input2)));
    this.render();
    this.hud.recordFrame();
  };

  /** Dev only: runs the game `seconds` ahead with `hold` pressed. */
  debugAdvance(seconds: number, hold: Partial<InputState> = {}): void {
    const base = this.input.update(0);
    for (let t = 0; t < seconds; t += 0.05) this.step({ ...base, ...hold }, 0.05);
  }

  /** Dev only: the pieces a test needs to reach in and look at. */
  get debug() {
    return {
      player: this.player,
      player2: this.player2,
      world: this.world,
      town: this.town,
      terrain: this.terrain,
      buildings: this.buildings,
      squad: this.squad,
      enemies: this.enemies,
      blocks: this.blocks,
      schoolMen: this.schoolMen,
      stats: this.stats,
      state: () => ({ flag: this.flag, schoolCleared: this.schoolCleared, victory: this.victoryAt !== null, checkpoint: this.checkpoint, start: this.start, renderer: this.renderer.info.render }),
    };
  }
}
