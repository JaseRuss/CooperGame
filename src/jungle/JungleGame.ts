import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, createWorld } from '../physics/PhysicsWorld';
import { InputManager, type InputState } from '../input/InputManager';
import { HUD, type HUDState, type PrisonHUD } from '../ui/HUD';
import type { MapView } from '../ui/WorldMap';
import { Sound } from '../audio/Sound';
import { ImpactEffects } from '../combat/ImpactEffects';
import { JamCannon } from '../combat/JamCannon';
import { AssetLibrary } from '../world/AssetLibrary';
import { loadSettings, saveSettings, AIM_SPEED_SCALE, GRAPHICS_QUALITY, type Settings } from '../core/Settings';
import { MISSION, levelNumber, nextMission, startMission } from '../core/config';
import { PlayerSoldier, MAX_HEALTH } from '../prison/PlayerSoldier';
import { ShoulderCam } from '../prison/ShoulderCam';
import { FRIEND_SHOTS, ENEMY_SHOTS, WALLS_ONLY } from '../prison/groups';
import { ARMY_GREEN, ARMY_TAN, ARMY_BLUE } from '../utils/plastic';
import { mulberry32 } from '../utils/rng';
import { Forest, type Clearing } from './Forest';
import { Terrain, type Zone } from './Terrain';
import { Roads } from './Roads';
import { Weather } from './Weather';
import { Trooper } from './Trooper';
import { Enemies } from './Enemies';
import { Squad } from './Squad';
import type { Battle } from './Battle';
import { Explosives, type Blast } from './Explosives';
import { Drops } from './Drops';
import { CookOff } from './CookOff';
import { JungleMap } from './JungleMap';
import { Solids, Lookout, Target, buildOutpost, buildAirbase, buildCamp, type Outpost, type Airbase, type Camp } from './Props';

/** The jungle is a square this many metres either side of the middle. */
const HALF = 230;
/** He starts a few steps off the road, facing across it (yaw -90 degrees: east). */
const START = { x: -10, z: 205, yaw: -Math.PI / 2 };
/** The dirt road: from the south edge over the main bridge and north to the North outpost, with tracks off it to the West and East outposts. */
const ROADS: [number, number][][] = [
  [[22, 238], [8, 214], [2, 180], [0, 146], [0, 110], [0, 76], [-8, 40], [8, 8], [10, -30], [-4, -66], [-8, -108], [-10, -146]],
  [[-8, 40], [-40, 38], [-70, 37], [-90, 36]],
  [[10, -10], [50, -12], [88, -9]],
];
/** Small camps dotted along the road. */
const CAMPS: { x: number; z: number; army: 'tan' | 'blue' }[] = [
  { x: -15, z: 150, army: 'tan' },
  { x: 16, z: 56, army: 'blue' },
  { x: 26, z: -34, army: 'tan' },
  { x: 12, z: -90, army: 'blue' },
];
const AIRBASE_AT = { x: -104, z: 172 };
/** A river crosses the middle of the jungle; these are the x positions of its bridges. */
const BRIDGES = [0, 172];
const LOOKOUTS = [
  { x: 40, z: 150 },
  { x: -128, z: -44 },
  { x: 118, z: -116 },
];
const OUTPOSTS: { name: string; army: 'tan' | 'blue'; x: number; z: number }[] = [
  { name: 'West outpost', army: 'tan', x: -112, z: 36 },
  { name: 'East outpost', army: 'blue', x: 112, z: -8 },
  { name: 'North outpost', army: 'tan', x: -10, z: -170 },
];
const PATROLS = [
  { x: 74, z: 128 },
  { x: 60, z: -62 },
];
const SQUAD_SIZE = 4;
const SQUAD_HP = 40;
const ENEMY_HP = 3;
const MAX_SQUAD = 8;

const SHADOW_HALF = 38;
const SHOT_RANGE = 120;
const TRACER_TIME = 0.06;
/** What an enemy hit takes off the player or a squad mate, and a rifle hit off an enemy. */
const ENEMY_DAMAGE = 7;
/** The rifle's noise is heard this far (halved in a storm). */
const SHOT_NOISE = 44;
/** The jam gun, as on the prison level. */
const JAM_INTERVAL = 0.07;
const JAM_SPEED = 22;
const JAM_GRAVITY = 12;
const JAM_RANGE = 22;
const JAM_DRAIN = 0.28;
const JAM_REFILL = 0.2;
const JAM_RADIUS = 1.8;
/** A jam splat knocks flat every tree this close to it. */
const JAM_TREE_RADIUS = 1.6;
/** The grenade launcher: shots in a magazine, and how long the reload takes once it's empty. */
const GRENADES = 4;
const GRENADE_RELOAD = 20;
const BOMBS_AT_START = 3;
const MAX_BOMBS = 5;
/** A bomb can be planted from this close to an ammo dump (its blast reaches further than that). */
const PLANT_REACH = 12;
/** Climbing a lookout: seconds up and down, how far round it you can see from the top. */
const CLIMB_TIME = 3.4;
const SCOUT_RADIUS = 120;
const START_REVEAL = 90;
const WALK_REVEAL = 26;
const LADDER_REACH = 1.4;
const HATCH_DWELL = 0.7;
/** After climbing down, seconds before the ladder will take him up again, so he can walk away from it. */
const LADDER_COOLDOWN = 2.5;
const VICTORY_DELAY = 11;

const CONTROLS =
  '<span><b>Move</b> left stick · W A S D</span><span><b>Aim</b> right stick · mouse</span>' +
  '<span><b>Creep</b> (they see you from less far) RB · Shift</span><span><b>Rifle</b> RT · click</span>' +
  '<span><b>Jam gun</b> (knocks trees flat, sticks soldiers) hold LT · hold E</span>' +
  '<span><b>Grenade launcher</b> (4 shots, then a reload) LB · F · right click</span>' +
  '<span><b>Squad: hold here / follow me</b> X</span><span><b>Camera</b> Y · C</span><span><b>Back to checkpoint</b> Back · R</span>' +
  '<span><b>Plant a bomb</b> (close to an ammo dump; 7 second fuse) RB · Q</span>';
const CONTROLS_P2 =
  '<span><b>Move</b> arrow keys · <b>Aim</b> mouse in your view or numpad 4/6 and 8/2</span>' +
  '<span><b>Rifle</b> numpad 0 · <b>Creep</b> Shift · <b>Jam gun</b> hold numpad 1</span>' +
  '<span><b>Grenade launcher</b> numpad 3 · <b>Plant a bomb</b> numpad 5 · <b>Squad</b> numpad 7</span>' +
  '<span><b>Camera</b> numpad 9 · <b>Pause / map</b> numpad enter · <b>Checkpoint</b> numpad decimal</span>';

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

interface Climb {
  tower: Lookout;
  up: boolean;
  t: number;
  path: THREE.Vector3[];
}

interface Crate {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
}

/**
 * Mission 2, the jungle, on foot. A small square of very thick jungle: thousands of trees (you can
 * knock them flat with the jam gun), lookout towers to climb for a view that puts the country round
 * them on the map, rain storms that roll in and cut the fog in to a few dozen metres, three enemy
 * outposts whose ammunition dumps you blow up with a planted bomb, an enemy airbase near where you
 * start (wreck its jets and paratroopers and a supply drop come in), a grenade launcher, and a
 * squad of four who follow you and fight.
 */
export class JungleGame {
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
  private readonly fog: THREE.Fog;
  private readonly clock = new THREE.Clock();
  private readonly loadingLabel: HTMLDivElement;
  private settings: Settings = loadSettings();
  private ready = false;
  private pausedRendered = false;
  private world!: RAPIER.World;
  private impacts!: ImpactEffects;
  private jam!: JamCannon;
  private jam2!: JamCannon;
  private forest!: Forest;
  private terrain!: Terrain;
  private roads!: Roads;
  private camps: Camp[] = [];
  private weather!: Weather;
  private solids!: Solids;
  private explosives!: Explosives;
  private drops!: Drops;
  private cookOff!: CookOff;
  /** The cutscene of an ammo dump going up, while it runs. */
  private cut: { t: number; outpost: Outpost; angle: number } | null = null;
  private player!: PlayerSoldier;
  private player2: PlayerSoldier | null = null;
  private cam!: ShoulderCam;
  private cam2!: ShoulderCam;
  private squad = new Squad();
  private enemies = new Enemies();
  private battle!: Battle;
  private map = new JungleMap(HALF);
  private lookouts: Lookout[] = [];
  private outposts: Outpost[] = [];
  private airbase!: Airbase;
  private readonly crates: Crate[] = [];
  private readonly byHandle = new Map<number, Trooper>();
  private readonly trail: THREE.Vector3[] = [];
  private checkpoint = { x: START.x, z: START.z - 3, yaw: START.yaw };
  private time = 0;
  private jamTank = 1;
  private jamTank2 = 1;
  private jamCooldown = 0;
  private jamCooldown2 = 0;
  private grenades = GRENADES;
  private reload = 0;
  private bombs = BOMBS_AT_START;
  private climb: Climb | null = null;
  private climb2: Climb | null = null;
  private onTower: Lookout | null = null;
  private onTower2: Lookout | null = null;
  private hatchDwell = 0;
  private hatchDwell2 = 0;
  private ladderCooldown = 0;
  private ladderCooldown2 = 0;
  private scouted = false;
  private airSupportCalled = false;
  private victoryAt: number | null = null;
  private mapAge = 0;
  private mapView: MapView = NO_MAP;
  private reinforcements = 0;
  private downTime = 0;
  private downTime2 = 0;
  private readonly stats = { enemiesDown: 0, treesFelled: 0, grenadesFired: 0 };
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

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 600);
    this.camera2 = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 600);
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
    this.loadingLabel.textContent = 'Loading jungle…';
    container.appendChild(this.loadingLabel);

    this.fog = new THREE.Fog(0x9fbfa4, 28, 235);
    this.scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xd6f0d0, 0x2c3b24, 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0cc, 1.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(graphics.shadowSize || 1024, graphics.shadowSize || 1024);
    const sh = this.sun.shadow.camera;
    sh.left = sh.bottom = -SHADOW_HALF;
    sh.right = sh.top = SHADOW_HALF;
    sh.far = 160;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.onResize());
    void this.init();
  }

  private async init(): Promise<void> {
    await initPhysics();
    this.world = createWorld();
    this.impacts = new ImpactEffects(this.scene);
    this.jam = new JamCannon(this.scene, () => 0, FRIEND_SHOTS);
    this.jam2 = new JamCannon(this.scene, () => 0, FRIEND_SHOTS);
    this.explosives = new Explosives(this.scene, this.world);
    this.drops = new Drops(this.scene, (kind, at) => this.landed(kind, at));
    const assets = new AssetLibrary();
    await assets.load((n, total) => (this.loadingLabel.textContent = `Loading jungle… ${n}/${total}`), ['jungleTree', 'undergrowth', 'hut', 'bigHut']);
    this.solids = new Solids(this.world);
    this.cookOff = new CookOff(
      this.scene,
      {
        explode: (at, size) => this.impacts.explode(at, size),
        boom: (at, volume, rate) => this.sound.play('boom', { at, volume, rate, minGap: 0.05 }),
        shake: (n) => this.cam.addShake(n),
        kill: (at, radius) => {
          for (const e of this.enemies.list) if (!e.t.down && Math.hypot(e.t.pos.x - at.x, e.t.pos.z - at.z) < radius && e.t.hurt(99)) this.stats.enemiesDown++;
          this.enemies.hear(at, 90);
        },
        fell: (at, radius) => this.forest.fell(at, new THREE.Vector3(1, 0, 0), radius),
        smoke: (at, radius, seconds) => this.impacts.addSmokeSource(at, radius, seconds),
      },
      (c) => this.solids.remove(c),
    );

    // The ground, and the edge of the map.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3c5a2c, roughness: 1 }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.solids.box(0, -0.5, 0, 450, 0.5, 450);
    for (const [x, z, hx, hz] of [[0, -HALF - 1, HALF + 4, 1], [0, HALF + 1, HALF + 4, 1], [-HALF - 1, 0, 1, HALF + 4], [HALF + 1, 0, 1, HALF + 4]]) this.solids.box(x, 15, z, hx, 15, hz);

    // Where things stand, and the clearings the forest leaves for them.
    this.lookouts = LOOKOUTS.map((l) => new Lookout(this.solids, this.scene, l.x, l.z));
    this.outposts = OUTPOSTS.map((o) => buildOutpost(assets, this.scene, this.solids, o.name, o.army, o.army === 'tan' ? ARMY_TAN : ARMY_BLUE, o.x, o.z));
    this.airbase = buildAirbase(this.scene, this.solids, AIRBASE_AT.x, AIRBASE_AT.z, ARMY_TAN);
    this.roads = new Roads(this.scene, ROADS);
    this.camps = CAMPS.map((c) => {
      const road = this.roads.nearest(c.x, c.z);
      return buildCamp(this.scene, this.solids, c.x, c.z, new THREE.Vector2(road.x - c.x, road.y - c.z).normalize(), c.army === 'tan' ? ARMY_TAN : ARMY_BLUE);
    });
    const avoid: Zone[] = [
      ...this.camps.map((c) => ({ x: c.x, z: c.z, r: c.r + 3 })),
      ...this.roads.paths.flatMap((path) => path.filter((_, i) => i % 4 === 0).map((p) => ({ x: p.x, z: p.y, r: 7 }))),
      { x: START.x, z: START.z, r: 22 },
      { x: AIRBASE_AT.x, z: AIRBASE_AT.z, r: 58 },
      ...this.lookouts.map((l) => ({ x: l.x, z: l.z, r: 12 })),
      ...this.outposts.map((o) => ({ x: o.x, z: o.z, r: o.r + 4 })),
    ];
    this.terrain = new Terrain(this.world, this.scene, HALF, BRIDGES, avoid, 5150);
    Trooper.route = (fx, fz, tx, tz) => this.terrain.route(fx, fz, tx, tz);
    this.map.setTerrain({ isWater: (x, z) => this.terrain.isWater(x, z), bridges: this.terrain.bridges, roads: this.roads.paths });
    const clearings: Clearing[] = [
      ...this.terrain.clearings,
      ...this.roads.clearings,
      ...this.camps.map((c) => ({ x: c.x, z: c.z, r: c.r })),
      { x: START.x, z: START.z, r: 17 },
      ...this.lookouts.map((l) => ({ x: l.x, z: l.z + 1, r: 9 })),
      ...this.outposts.map((o) => ({ x: o.x, z: o.z, r: o.r })),
      this.airbase.clearing,
    ];
    this.forest = new Forest(this.world, this.scene, assets, HALF, clearings, 20241011);

    this.weather = new Weather(this.scene, this.fog, this.hemi, this.sun);
    this.scene.background = this.weather.skyColor;

    // The player and his squad.
    this.player = new PlayerSoldier(this.world, START.x, START.z, START.yaw);
    this.scene.add(this.player.root);
    this.cam = new ShoulderCam(this.camera, this.world);
    if (this.settings.player2Controller !== -2) {
      this.player2 = new PlayerSoldier(this.world, START.x + 1.8, START.z, START.yaw);
      this.scene.add(this.player2.root);
      this.cam2 = new ShoulderCam(this.camera2, this.world);
    }
    const names = this.settings.buddyNames;
    for (let i = 0; i < SQUAD_SIZE; i++) this.addSquadMate(START.x + 0.4, START.z + (i < 2 ? -2.2 - i * 1.7 : 2.2 + (i - 2) * 1.7), names[i] ?? `Buddy ${i + 1}`);

    // The enemy: six at each outpost, four guarding the airbase, two patrols out in the trees.
    const rng = mulberry32(777);
    for (const o of this.outposts) {
      for (let i = 0; i < 6; i++) {
        const a = rng() * Math.PI * 2;
        const r = 5 + rng() * 11;
        this.addEnemy(o.x + Math.cos(a) * r, o.z + Math.sin(a) * r, o.army === 'tan' ? ARMY_TAN : ARMY_BLUE, 9);
      }
    }
    // The camps along the road: a couple round the fire, one behind each gun, one wandering among the tents.
    CAMPS.forEach((cfg, k) => {
      const camp = this.camps[k];
      const color = cfg.army === 'tan' ? ARMY_TAN : ARMY_BLUE;
      for (let i = 0; i < 2; i++) this.addEnemy(camp.fire.x + (i ? 1.8 : -1.8), camp.fire.z + (i ? 0.8 : -0.4), color, 6);
      for (const g of camp.guns) this.addEnemy(g.x + (rng() - 0.5), g.z + 1.2 + rng(), color, 1.5);
      this.addEnemy(camp.x + (rng() - 0.5) * 6, camp.z + (rng() - 0.5) * 6, color, 9);
    });
    // A few at the north end of the main bridge.
    const gate = this.terrain.bridges[0];
    for (let i = 0; i < 3; i++) this.addEnemy(gate.north.x - 6 + i * 6, gate.north.y - 14 - (i % 2) * 5, ARMY_TAN, 7);
    for (let i = 0; i < 4; i++) this.addEnemy(AIRBASE_AT.x - 18 + i * 14, AIRBASE_AT.z - 6 + (i % 2) * 14, ARMY_TAN, 8);
    for (const p of PATROLS) for (let i = 0; i < 3; i++) this.addEnemy(p.x + (rng() - 0.5) * 8, p.z + (rng() - 0.5) * 8, i % 2 ? ARMY_BLUE : ARMY_TAN, 18);

    for (const c of this.camps) this.impacts.addSmokeSource(c.fire.clone().setY(1.2), 0.35, 1e7);
    this.battle = this.makeBattle();
    this.map.reveal(START.x, START.z, START_REVEAL);
    this.hud.setWorldMap(this.map.asWorldMap());
    this.hud.setOnFoot(CONTROLS, {
      legend: '<span><i style="background:#4b7a2e"></i>You and your squad</span><span><i style="background:#c4a468"></i>Tan army</span><span><i style="background:#3f6fb0"></i>Blue army</span><span><i style="background:#3b8fc2"></i>River and ponds: cross at a bridge</span><span>Dark ground: not scouted yet. Climb a lookout to reveal the map around it</span>',
    }, CONTROLS_P2);
    this.hud.setSettings(this.settings, (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    });
    this.hud2.setOnFoot(CONTROLS_P2, { legend: '<span><i style="background:#4b7a2e"></i>You and your squad</span><span><i style="background:#c4a468"></i>Tan army</span><span><i style="background:#3f6fb0"></i>Blue army</span>' });
    this.hud.setCoopLayout(!!this.player2);
    this.hud2.setActive(!!this.player2);
    this.applySettings();
    this.hud.setMissionStart((m) => startMission(m));
    for (const o of this.outposts) o.dump.onDestroyed = () => this.onDumpDestroyed(o);
    for (const j of this.airbase.jets) j.onDestroyed = () => this.onJetDestroyed();
    void this.sound.load();
    this.world.step();

    this.loadingLabel.remove();
    this.ready = true;
    this.sound.music.start();
    this.clock.start();
    this.hud.showBanner(`LEVEL ${levelNumber(MISSION)}: JUNGLE PATROL`, 'On foot with your squad. Cross the river by a bridge, scout from a lookout tower, wreck the airbase jets, and blow up the ammo dumps at the three enemy outposts');
    if (import.meta.env.DEV) (window as unknown as { jungle: JungleGame }).jungle = this;
    requestAnimationFrame(this.animate);
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
    if (enabled && !this.player2) {
      this.player2 = new PlayerSoldier(this.world, this.player.position.x + 1.8, this.player.position.z, this.player.yaw);
      this.scene.add(this.player2.root);
      this.cam2 = new ShoulderCam(this.camera2, this.world);
    } else if (!enabled && this.player2) {
      this.scene.remove(this.player2.root);
      this.player2.dispose();
      this.player2 = null;
    }
    this.hud.setCoopLayout(!!this.player2);
    this.hud2.setActive(!!this.player2);
  }

  private withPlayer2<T>(run: () => T): T {
    if (!this.player2) return run();
    const player = this.player, camera = this.camera, cam = this.cam, hud = this.hud;
    const jam = this.jam, jamTank = this.jamTank, jamCooldown = this.jamCooldown;
    const climb = this.climb, onTower = this.onTower, hatchDwell = this.hatchDwell, ladderCooldown = this.ladderCooldown;
    this.player = this.player2; this.camera = this.camera2; this.cam = this.cam2; this.hud = this.hud2;
    this.jam = this.jam2; this.jamTank = this.jamTank2; this.jamCooldown = this.jamCooldown2;
    this.climb = this.climb2; this.onTower = this.onTower2; this.hatchDwell = this.hatchDwell2; this.ladderCooldown = this.ladderCooldown2;
    try { return run(); }
    finally {
      this.jam2 = this.jam; this.jamTank2 = this.jamTank; this.jamCooldown2 = this.jamCooldown;
      this.climb2 = this.climb; this.onTower2 = this.onTower; this.hatchDwell2 = this.hatchDwell; this.ladderCooldown2 = this.ladderCooldown;
      this.player = player; this.camera = camera; this.cam = cam; this.hud = hud;
      this.jam = jam; this.jamTank = jamTank; this.jamCooldown = jamCooldown;
      this.climb = climb; this.onTower = onTower; this.hatchDwell = hatchDwell; this.ladderCooldown = ladderCooldown;
    }
  }

  private onResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (!this.player2) this.hud.setViewport({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    this.pausedRendered = false;
  }

  // ---------- people ----------

  private addSquadMate(x: number, z: number, name: string): Trooper {
    const t = new Trooper(this.world, x, z, 'friend', ARMY_GREEN, SQUAD_HP, name);
    this.scene.add(t.root);
    this.byHandle.set(t.collider.handle, t);
    this.squad.add(t);
    return t;
  }

  private addEnemy(x: number, z: number, color: number, roam: number): void {
    const t = new Trooper(this.world, x, z, 'enemy', color, ENEMY_HP);
    this.scene.add(t.root);
    this.byHandle.set(t.collider.handle, t);
    this.enemies.add(t, roam);
  }

  private makeBattle(): Battle {
    const game = this;
    const chest = new THREE.Vector3();
    return {
      sees: (a, b) => this.sees(a, b),
      get visibility() {
        return game.weather.visibility;
      },
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
        return game.player2 ? [game.player, game.player2].map((soldier) => ({
          pos: soldier.position,
          chest: soldier.position.clone().setY(soldier.position.y + 1.15),
          down: soldier.isDown,
          sneaking: soldier.sneaking,
        })) : undefined;
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

  /** A clear line (trunks, huts and walls block it; people don't). */
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

  /** One rifle round from `from` along `dir`: what it hits, tracer and all. */
  private resolveRound(from: THREE.Vector3, dir: THREE.Vector3, side: 'friend' | 'enemy', by: Trooper | null): void {
    const hit = this.world.castRay(new RAPIER.Ray(from, dir), SHOT_RANGE, true, undefined, side === 'friend' ? FRIEND_SHOTS : ENEMY_SHOTS);
    const end = from.clone().addScaledVector(dir, hit ? hit.timeOfImpact : 60);
    this.addTracer(from, end, side === 'friend' ? this.friendTracer : this.enemyTracer);
    if (!hit) return;
    const handle = hit.collider.handle;
    if (side === 'friend') {
      const e = this.byHandle.get(handle);
      if (e && e.side === 'enemy' && !e.down) {
        this.impacts.dustPuff(end);
        if (e.hurt(1)) {
          this.stats.enemiesDown++;
          this.sound.play('thud', { at: end, volume: 0.5, rate: 1.2, minGap: 0.05 });
        }
      } else this.impacts.dustPuff(end);
      return;
    }
    this.impacts.dustPuff(end);
    if (handle === this.player.collider.handle || handle === this.player2?.collider.handle) {
      const second = handle === this.player2?.collider.handle;
      const target = second ? this.player2! : this.player;
      const wasUp = !target.isDown;
      target.takeDamage(ENEMY_DAMAGE);
      (second ? this.cam2 : this.cam).addShake(0.22);
      this.sound.play('thud', { volume: 0.45, rate: 1.6, minGap: 0.1 });
      if (wasUp && target.isDown) { if (second) this.downTime2 = 0; else this.downTime = 0; }
      return;
    }
    const f = this.byHandle.get(handle);
    if (f && f.side === 'friend' && !f.down) f.hurt(ENEMY_DAMAGE);
    void by;
  }

  /** A soldier fires at `aim`, with a scatter that grows with the range. */
  private troopFire(shooter: Trooper, aim: THREE.Vector3): void {
    const fwd = new THREE.Vector3(-Math.sin(shooter.yaw), 0, -Math.cos(shooter.yaw));
    const from = shooter.pos.clone().setY(1.45).addScaledVector(fwd, 0.7);
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
    this.resolveRound(from, dir, shooter.side, shooter);
    // A friend's shots are heard too: the enemy near them comes to look.
    if (shooter.side === 'friend') this.enemies.hear(shooter.pos, SHOT_NOISE * this.weather.visibility * 0.8 + 8);
  }

  private firePlayerRifle(): void {
    const muzzle = this.player.muzzle();
    const target = this.aimPoint();
    const dir = target.clone().sub(muzzle).normalize();
    const hit = this.world.castRay(new RAPIER.Ray(muzzle, dir), SHOT_RANGE, true, undefined, FRIEND_SHOTS);
    this.impacts.muzzleFlash(muzzle, dir, 0.3);
    this.sound.play('crack', { volume: 0.28, rate: 2.3, minGap: 0.05 });
    this.cam.addShake(0.07);
    this.enemies.hear(muzzle, SHOT_NOISE * this.weather.visibility + 8);
    void hit;
    this.resolveRound(muzzle, dir, 'friend', null);
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

  // ---------- the jam gun ----------

  private updateJam(input: InputState, dt: number): void {
    const spraying = input.jamFiring && !this.player.isDown && this.jamTank > 0;
    if (spraying) {
      this.jamTank = Math.max(0, this.jamTank - JAM_DRAIN * dt);
      this.jamCooldown -= dt;
      if (this.jamCooldown <= 0) {
        this.jamCooldown = JAM_INTERVAL;
        this.lobJam(this.player.muzzle(), this.aimPoint());
        this.sound.play('jamShot', { volume: 0.22, rate: 1.1, minGap: 0.09 });
      }
    } else {
      this.jamCooldown = 0;
      if (!input.jamFiring) this.jamTank = Math.min(1, this.jamTank + JAM_REFILL * dt);
    }
    this.jam.update(
      dt,
      this.world,
      this.player.collider,
      (point) => {
        this.sound.play('splat', { at: point, volume: 0.9, minGap: 0.1 });
        // Wherever it lands, trees within reach go over, away from the player.
        const dir = new THREE.Vector3(point.x - this.player.position.x, 0, point.z - this.player.position.z).normalize();
        this.forest.fell(point, dir, JAM_TREE_RADIUS);
        this.jamSoldiers(point, JAM_RADIUS);
      },
      (point) => this.jamSoldiers(point, 1),
    );
  }

  private jamSoldiers(point: THREE.Vector3, radius: number): number {
    let n = 0;
    for (const b of this.enemies.list) {
      const t = b.t;
      if (!t.active || Math.hypot(t.pos.x - point.x, t.pos.z - point.z) > radius || point.y > 3) continue;
      if (t.jam()) {
        n++;
        this.enemies.hear(t.pos, 12);
      }
    }
    return n;
  }

  private lobJam(from: THREE.Vector3, target: THREE.Vector3): void {
    const dir = target.clone().sub(from);
    const reach = Math.min(JAM_RANGE, Math.hypot(dir.x, dir.z));
    dir.normalize();
    dir.x += (Math.random() - 0.5) * 0.08;
    dir.y += Math.min(0.4, (JAM_GRAVITY * reach) / (2 * JAM_SPEED * JAM_SPEED)) + (Math.random() - 0.5) * 0.05;
    dir.z += (Math.random() - 0.5) * 0.08;
    this.jam.fire(from, dir.normalize(), JAM_SPEED * (0.95 + Math.random() * 0.1));
  }

  // ---------- grenades and bombs ----------

  private fireGrenade(): void {
    if (this.grenades <= 0 || this.player.isDown) {
      if (this.grenades <= 0) this.hud.showCallout(`GRENADE LAUNCHER RELOADING: ${Math.ceil(this.reload)}s`, '#ffd24a');
      return;
    }
    const muzzle = this.player.muzzle();
    const dir = this.aimPoint().sub(muzzle).normalize();
    dir.y += 0.2;
    this.explosives.launch(muzzle, dir.normalize());
    this.grenades--;
    this.stats.grenadesFired++;
    if (this.grenades === 0) this.reload = GRENADE_RELOAD;
    this.sound.play('cannon', { volume: 0.35, rate: 1.7, minGap: 0.2 });
    this.impacts.muzzleFlash(muzzle, dir, 0.4);
    this.cam.addShake(0.14);
    this.enemies.hear(muzzle, 30 * this.weather.visibility + 8);
  }

  /** A grenade or bomb has gone off: everything near it feels it. */
  private onBlast(b: Blast): void {
    const bomb = b.kind === 'bomb';
    this.impacts.explode(b.at, bomb ? 5 : 2);
    if (bomb) {
      for (let i = 0; i < 6; i++) this.impacts.explode(b.at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 4, (Math.random() - 0.5) * 12)), 2.4);
    }
    this.sound.play(bomb ? 'boom' : 'cannon', { at: b.at, volume: bomb ? 1 : 0.7, rate: bomb ? 0.7 : 1.2 });
    const away = new THREE.Vector3();
    for (const e of this.enemies.list) {
      const t = e.t;
      if (t.down) continue;
      const d = Math.hypot(t.pos.x - b.at.x, t.pos.z - b.at.z);
      if (d > b.radius) continue;
      if (t.hurt(bomb ? 99 : d < b.radius * 0.55 ? 3 : 2)) this.stats.enemiesDown++;
    }
    this.enemies.hear(b.at, bomb ? 80 : 45);
    // Friendly fire: the bigger the blast and the closer you are, the worse.
    const power = bomb ? 90 : 30;
    const dp = Math.hypot(this.player.position.x - b.at.x, this.player.position.z - b.at.z);
    if (dp < b.radius && !this.player.isDown) {
      const wasUp = !this.player.isDown;
      this.player.takeDamage(power * (1 - dp / b.radius));
      if (wasUp && this.player.isDown) this.downTime = 0;
    }
    if (this.player2) {
      const p2 = this.player2.position;
      const d2 = Math.hypot(p2.x - b.at.x, p2.z - b.at.z);
      if (d2 < b.radius && !this.player2.isDown) {
        const wasUp = !this.player2.isDown;
        this.player2.takeDamage(power * (1 - d2 / b.radius));
        if (wasUp && this.player2.isDown) this.downTime2 = 0;
      }
    }
    for (const s of this.squad.list) {
      const dist = Math.hypot(s.t.pos.x - b.at.x, s.t.pos.z - b.at.z);
      if (dist < b.radius && !s.t.down) s.t.hurt(power * (1 - dist / b.radius));
    }
    // Trees go over, away from the blast; dumps and jets are damaged.
    away.copy(b.at);
    this.forest.fell(b.at, new THREE.Vector3(1, 0, 0), b.radius * 0.92);
    for (const t of this.targets()) {
      if (Math.hypot(t.pos.x - b.at.x, t.pos.z - b.at.z) < b.radius + t.radius) t.hurt(bomb ? 12 : 1.6);
    }
    const shake = 1 / Math.max(1, dp / 10);
    this.cam.addShake((bomb ? 0.9 : 0.35) * Math.min(1, shake));
  }

  private targets(): Target[] {
    return [...this.outposts.map((o) => o.dump), ...this.airbase.jets];
  }

  /** The dump goes up as a cutscene (`stepCutscene`); the banner and any victory come when it ends. */
  private onDumpDestroyed(o: Outpost): void {
    o.beacon.visible = false;
    o.flagMaterial.color.setHex(ARMY_GREEN);
    this.checkpoint = { x: o.x + 3, z: o.z + 15, yaw: 0 };
    const p = this.player.position;
    const angle = Math.atan2(p.z - o.z, p.x - o.x);
    this.cut = { t: 0, outpost: o, angle: Math.hypot(p.x - o.x, p.z - o.z) < 3 ? 0.8 : angle };
    this.cookOff.start(o);
  }

  private finishDump(o: Outpost): void {
    const left = this.outposts.filter((x) => x.dump.alive).length;
    this.sound.music.stinger();
    if (left === 0) {
      this.victoryAt = this.time;
      this.hud.showVictory('The jungle is ours! All three ammunition dumps are gone.', 'Starting the next mission shortly…');
      this.sound.music.fanfare();
    } else {
      this.hud.showBanner(`${o.name.toUpperCase()} DESTROYED!`, `${left} ammo dump${left === 1 ? '' : 's'} to go`);
    }
  }

  private onJetDestroyed(): void {
    const left = this.airbase.jets.filter((j) => j.alive).length;
    if (left > 0) {
      this.hud.showCallout(`JET DOWN! ${left} LEFT AT THE AIRBASE`, '#8fd3ff');
      return;
    }
    if (this.airSupportCalled) return;
    this.airSupportCalled = true;
    this.hud.showBanner('AIRBASE WRECKED!', 'Air support is on its way: paratroopers and a supply drop are coming in near you');
    this.sound.music.stinger();
    const p = this.player.position;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random();
      this.drops.drop('soldier', p.x + Math.cos(a) * (8 + Math.random() * 6), p.z + Math.sin(a) * (8 + Math.random() * 6), i * 0.7);
    }
    this.drops.drop('crate', p.x + 7, p.z - 4, 0.5);
  }

  /** A chute has come down: a paratrooper joins the squad, or the supply crate lands. */
  private landed(kind: 'soldier' | 'crate', at: THREE.Vector3): void {
    if (kind === 'soldier') {
      if (this.squad.list.length < MAX_SQUAD) {
        this.reinforcements++;
        this.addSquadMate(at.x, at.z, `Para ${this.reinforcements}`);
        this.impacts.dustPuff(at);
      }
      return;
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 1.1), new THREE.MeshStandardMaterial({ color: 0x8b5e38 }));
    mesh.position.set(at.x, 0.4, at.z);
    this.scene.add(mesh);
    this.crates.push({ mesh, pos: at.clone() });
    this.hud.showCallout('SUPPLY CRATE LANDED: grenades and a bomb', '#ffd24a');
  }

  // ---------- the lookout towers ----------

  private startClimb(tower: Lookout, up: boolean): void {
    const top = tower.top;
    const path = up
      ? [tower.foot.clone(), new THREE.Vector3(tower.foot.x, top - 0.6, tower.foot.z - 0.2), tower.arrive.clone()]
      : [tower.hatch.clone(), new THREE.Vector3(tower.hatch.x, top - 0.6, tower.hatch.z + 1.6), tower.foot.clone().setZ(tower.foot.z + 0.2)];
    this.climb = { tower, up, t: 0, path };
    this.sound.play('clang', { volume: 0.35, rate: 1.4 });
  }

  private updateClimb(dt: number): void {
    const c = this.climb;
    if (!c) return;
    c.t = Math.min(1, c.t + dt / CLIMB_TIME);
    const legs = c.path.length - 1;
    const f = c.t * legs;
    const i = Math.min(legs - 1, Math.floor(f));
    const at = c.path[i].clone().lerp(c.path[i + 1], f - i);
    this.player.climbAt(at, c.up ? 0 : Math.PI);
    if (Math.floor(c.t * 9) !== Math.floor((c.t - dt / CLIMB_TIME) * 9)) this.sound.play('thud', { volume: 0.15, rate: 2, minGap: 0.1 });
    if (c.t < 1) return;
    this.climb = null;
    if (c.up) {
      const a = c.tower.arrive;
      this.player.teleport(a.x, a.z, 0, a.y);
      this.onTower = c.tower;
      this.hatchDwell = 0;
      const before = this.scouted;
      this.map.reveal(c.tower.x, c.tower.z, SCOUT_RADIUS);
      this.scouted = true;
      this.hud.showBanner('FROM THE LOOKOUT', before ? 'More of the map is yours. Walk to the gap in the rail at the head of the ladder to climb down' : 'The country round the tower is on your map. Walk to the gap in the rail at the head of the ladder to climb down');
    } else {
      this.player.teleport(c.tower.foot.x, c.tower.foot.z + LADDER_REACH + 0.6, Math.PI, 0);
      this.onTower = null;
      this.ladderCooldown = LADDER_COOLDOWN;
    }
  }

  // ---------- the frame ----------

  private toCheckpoint(): void {
    this.player.teleport(this.checkpoint.x, this.checkpoint.z, this.checkpoint.yaw);
    this.onTower = null;
    this.climb = null;
    this.hatchDwell = 0;
    this.ladderCooldown = 0;
    if (this.player === this.player2) this.downTime2 = 0;
    else this.downTime = 0;
  }

  private recordTrail(): void {
    const p = this.player.position;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.7) this.trail.push(new THREE.Vector3(p.x, 0, p.z));
    if (this.trail.length > 400) this.trail.splice(0, 100);
  }

  private updateWeather(dt: number): void {
    this.weather.update(dt, this.camera);
    for (const e of this.weather.takeEvents()) {
      if (e === 'rolling') this.hud.showCallout('A STORM IS ROLLING IN: the visibility is dropping', '#8fd3ff');
      else if (e === 'storm') this.hud.showBanner('RAIN STORM!', 'You can see only a few dozen metres, and so can they. Creep past, or fight in the downpour');
      else if (e === 'clearing') this.hud.showCallout('THE STORM IS PASSING', '#c9d3dc');
      else if (e === 'thunder') this.sound.play('boom', { volume: 0.45, rate: 0.5, minGap: 1 });
    }
  }

  private updateSupplies(): void {
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      const collector = [this.player, this.player2].find((player) => player && !player.isDown && Math.hypot(player.position.x - c.pos.x, player.position.z - c.pos.z) <= 2.2);
      if (!collector) continue;
      this.grenades = GRENADES;
      this.reload = 0;
      this.bombs = Math.min(MAX_BOMBS, this.bombs + 1);
      this.scene.remove(c.mesh);
      this.crates.splice(i, 1);
      this.hud.showCallout('GRENADES RELOADED · +1 BOMB', '#ffd24a');
      this.sound.play('uiConfirm', { volume: 0.7 });
    }
  }

  /** At an ammo dump with a bomb: stand there a couple of seconds and it's planted. */
  /** The nearest live ammo dump within planting reach of the player, if any. */
  private dumpInReach(): Outpost | null {
    const p = this.player.position;
    let best: Outpost | null = null;
    let bestD = PLANT_REACH;
    for (const o of this.outposts) {
      if (!o.dump.alive) continue;
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Q / RB: set a bomb down where he stands, if he's close enough to an ammo dump. */
  private plantBomb(): void {
    if (this.player.isDown || this.onTower || this.climb) return;
    const o = this.dumpInReach();
    if (!o) {
      this.hud.showCallout('GET CLOSER TO AN AMMO DUMP TO PLANT A BOMB', '#ffd24a');
      return;
    }
    if (this.bombs <= 0) {
      this.hud.showCallout('NO BOMBS LEFT: WRECK THE AIRBASE JETS FOR A SUPPLY DROP', '#ff8a7a');
      return;
    }
    if (this.explosives.bombs.some((b) => Math.hypot(b.pos.x - o.x, b.pos.z - o.z) < 14)) {
      this.hud.showCallout('THERE IS ALREADY A BOMB TICKING AT THIS DUMP', '#ffd24a');
      return;
    }
    const p = this.player.position;
    this.bombs--;
    this.explosives.plant(new THREE.Vector3(p.x, 0.25, p.z).addScaledVector(this.player.forward(), 0.8));
    this.sound.play('clang', { volume: 0.6, rate: 1.1 });
    this.hud.showBanner('BOMB ARMED!', 'Get clear: it goes off in seven seconds. The squad is running too');
  }

  private step(input: InputState, dt: number, input2: InputState | null = null): void {
    if (input.mapTogglePressed || input2?.mapTogglePressed) this.hud.toggleBigMap();
    this.time += dt;
    this.updateWeather(dt);
    if (this.cut) {
      this.stepCutscene(dt);
      return;
    }
    this.cookOff.update(dt);
    if (this.victoryAt !== null && this.time - this.victoryAt > VICTORY_DELAY) {
      const next = nextMission();
      if (next) startMission(next);
      this.victoryAt = null;
    }
    if (input.cameraTogglePressed) this.cam.toggle();
    if (input.megaJamPressed) {
      const holding = this.squad.toggleHold();
      this.hud.showCallout(holding ? 'SQUAD: HOLD HERE' : 'SQUAD: FOLLOW ME', holding ? '#ffd24a' : '#9be27a');
      this.sound.play('uiChange', { volume: 0.5 });
    }
    if (this.player.isDown) this.downTime += dt;
    const p = this.player.position;
    if (this.climb) this.updateClimb(dt);
    else {
      const wasDown = this.player.isDown;
      if (this.player.step(input, dt)) this.firePlayerRifle();
      if (input.resetPressed || (wasDown && !this.player.isDown && this.player.health === 0)) this.toCheckpoint();
      this.updateJam(input, dt);
      if (input.rocketPressed) this.fireGrenade();
      if (input.aaPressed) this.plantBomb();
      // Lookouts: walk to the foot of the ladder to climb, to the gap at the top to come down.
      if (!this.player.isDown) {
        if (this.onTower) {
          const h = this.onTower.hatch;
          if (Math.hypot(p.x - h.x, p.z - h.z) < 0.9) {
            this.hatchDwell += dt;
            if (this.hatchDwell > HATCH_DWELL) this.startClimb(this.onTower, false);
          } else this.hatchDwell = 0;
        } else {
          this.ladderCooldown = Math.max(0, this.ladderCooldown - dt);
          if (this.ladderCooldown === 0) {
            for (const l of this.lookouts) if (Math.hypot(p.x - l.foot.x, p.z - l.foot.z) < LADDER_REACH) this.startClimb(l, true);
          }
        }
      }
    }
    if (this.player2 && input2) this.withPlayer2(() => {
      if (this.player.isDown) this.downTime2 += dt;
      if (input2.cameraTogglePressed) this.cam.toggle();
      const p2 = this.player.position;
      if (this.climb) this.updateClimb(dt);
      else {
        const wasDown = this.player.isDown;
        if (this.player.step(input2, dt)) this.firePlayerRifle();
        if (input2.resetPressed || (wasDown && !this.player.isDown && this.player.health === 0)) this.toCheckpoint();
        this.updateJam(input2, dt);
        if (input2.rocketPressed) this.fireGrenade();
        if (input2.aaPressed) this.plantBomb();
        if (!this.player.isDown) {
          if (this.onTower) {
            const h = this.onTower.hatch;
            if (Math.hypot(p2.x - h.x, p2.z - h.z) < 0.9) {
              this.hatchDwell += dt;
              if (this.hatchDwell > HATCH_DWELL) this.startClimb(this.onTower, false);
            } else this.hatchDwell = 0;
          } else {
            this.ladderCooldown = Math.max(0, this.ladderCooldown - dt);
            if (this.ladderCooldown === 0) {
              for (const l of this.lookouts) if (Math.hypot(p2.x - l.foot.x, p2.z - l.foot.z) < LADDER_REACH) this.startClimb(l, true);
            }
          }
        }
      }
      if (this.onTower && !this.climb && this.player.position.y < this.onTower.top - 3) this.onTower = null;
      this.map.reveal(this.player.position.x, this.player.position.z, WALK_REVEAL);
    });
    // Off the platform somehow (a fall, a jam knock): he's on the ground, so he's not "on the tower".
    if (this.onTower && !this.climb && this.player.position.y < this.onTower.top - 3) this.onTower = null;
    if (!this.onTower) this.recordTrail();
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) {
        this.reload = 0;
        this.grenades = GRENADES;
        this.hud.showCallout('GRENADE LAUNCHER RELOADED', '#9be27a');
      }
    }
    this.updateSupplies();

    this.squad.update(dt, this.battle, this.trail);
    this.enemies.update(dt, this.battle);
    for (const [handle, t] of this.byHandle) if (t.gone) this.byHandle.delete(handle);
    this.explosives.update(dt, (b) => this.onBlast(b), (pt) => this.impacts.trailPuff(pt));
    this.drops.update(dt);
    this.forest.update(dt);
    this.world.step();

    // The map: a patch round the player wherever he walks, the lookouts' circles, who's in view.
    this.map.reveal(p.x, p.z, WALK_REVEAL);
    this.cam.update(this.player, dt);
    if (this.player2) this.cam2.update(this.player2, dt);
    this.impacts.update(dt);
    this.updateTracers(dt);
    this.updateAtmosphere();
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

  private updateAtmosphere(): void {
    const p = this.player.position;
    this.sun.position.set(p.x - 30, 70, p.z + 25);
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.target.updateMatrixWorld();
  }

  private refreshMap(): void {
    const d = this.map.data;
    const p = this.player.position;
    d.player = { x: p.x, z: p.z, yaw: this.player.yaw };
    d.squad = this.squad.list.map((b) => ({ x: b.t.pos.x, z: b.t.pos.z, down: b.t.down }));
    // Enemies show when someone of ours is near them, or from a lookout within its circle.
    const player2 = this.player2?.position;
    const watch = [p, ...(player2 ? [player2] : []), ...this.squad.list.filter((b) => b.t.active).map((b) => b.t.pos)];
    const towers = [this.onTower, this.onTower2].filter((tower): tower is Lookout => !!tower);
    d.enemies = this.enemies.list
      .filter((b) => b.t.active && (watch.some((w) => Math.hypot(w.x - b.t.pos.x, w.z - b.t.pos.z) < 48 * this.weather.visibility + 8) || towers.some((tower) => Math.hypot(tower.x - b.t.pos.x, tower.z - b.t.pos.z) < SCOUT_RADIUS * (0.55 + 0.45 * this.weather.visibility))))
      .map((b) => ({ x: b.t.pos.x, z: b.t.pos.z }));
    d.outposts = this.outposts.map((o) => ({ x: o.x, z: o.z, army: o.army, destroyed: !o.dump.alive }));
    d.towers = this.lookouts.map((l) => ({ x: l.x, z: l.z }));
    d.airbase = { x: this.airbase.x, z: this.airbase.z, left: this.airbase.jets.filter((j) => j.alive).length };
    d.bombs = this.explosives.bombs.map((b) => ({ x: b.pos.x, z: b.pos.z }));
    this.mapView = { ...NO_MAP, playerX: p.x, playerZ: p.z, playerYaw: this.player.yaw };
  }

  // ---------- HUD ----------

  /** The camera for the dump cutscene: high and wide, swinging slowly round the blast. */
  private cutscenePose(c: { t: number; outpost: Outpost; angle: number }): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const k = Math.min(1, c.t / (CookOff.DURATION + 1));
    const a = c.angle + 0.35 + k * 0.9;
    const dist = 50 - k * 8;
    const at = c.outpost.dump.pos;
    const shake = 0.45 * Math.max(0, 1 - c.t / 1.6) + 0.12 * Math.max(0, Math.sin(c.t * 9)) * (c.t < CookOff.DURATION ? 1 : 0);
    const jitter = () => (Math.random() - 0.5) * 2 * shake;
    return {
      pos: new THREE.Vector3(at.x + Math.cos(a) * dist + jitter(), 24 + k * 5 + jitter(), at.z + Math.sin(a) * dist + jitter()),
      look: new THREE.Vector3(at.x, 3 + k * 4, at.z),
    };
  }

  /** The world carries on without the soldiers: blasts, flying planks, trees going over. */
  private stepCutscene(dt: number): void {
    const c = this.cut as NonNullable<typeof this.cut>;
    c.t += dt;
    this.cookOff.update(dt);
    this.explosives.update(dt, (b) => this.onBlast(b), (pt) => this.impacts.trailPuff(pt));
    this.drops.update(dt);
    this.forest.update(dt);
    this.world.step();
    // The camera lands back on the player over the last moments.
    this.cam.update(this.player, dt);
    const back = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone() };
    const pose = this.cutscenePose(c);
    this.camera.position.copy(pose.pos);
    this.camera.lookAt(pose.look);
    const end = CookOff.DURATION + 1;
    const blend = Math.max(0, (c.t - (end - 0.8)) / 0.8);
    if (blend > 0) {
      const k = blend * blend * (3 - 2 * blend);
      this.camera.position.lerp(back.pos, k);
      this.camera.quaternion.slerp(back.quat, k);
    }
    this.impacts.update(dt);
    this.updateTracers(dt);
    this.mapAge += dt;
    if (this.mapAge > 0.15) {
      this.mapAge = 0;
      this.refreshMap();
    }
    if (c.t >= end) {
      this.cut = null;
      this.finishDump(c.outpost);
    }
  }

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

  /** The way to go next: the nearest dump we've found, else the nearest lookout. */
  private waypoint(): HUDState['waypoint'] {
    if (this.hud.paused || this.victoryAt !== null || this.cut) return null;
    const p = this.player.position;
    const known = this.outposts.filter((o) => o.dump.alive && this.map.known(o.x, o.z));
    if (known.length) {
      const o = known.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
      return this.waypointTo(new THREE.Vector3(o.x, 8, o.z), `${o.name.toUpperCase()} ${Math.round(Math.hypot(o.x - p.x, o.z - p.z))} m`);
    }
    const tower = this.lookouts.filter((l) => !this.map.known(l.x + 30, l.z)).concat(this.lookouts)[0];
    return this.waypointTo(new THREE.Vector3(tower.x, 17, tower.z), 'LOOKOUT');
  }

  private objectives(): { label: string; done: boolean }[] {
    const dumps = this.outposts.filter((o) => !o.dump.alive).length;
    const jets = this.airbase.jets.filter((j) => !j.alive).length;
    return [
      { label: 'Climb a lookout tower to scout (optional)', done: this.scouted },
      { label: `Blow up the ammo dumps at the enemy outposts (${dumps} / ${this.outposts.length})`, done: dumps === this.outposts.length },
      { label: `Wreck the airbase jets for air support (${jets} / ${this.airbase.jets.length}) (optional)`, done: jets === this.airbase.jets.length },
    ];
  }

  private prisonHUD(input: InputState): PrisonHUD {
    const p = this.player.position;
    let prompt: string | null = null;
    const fuse = this.explosives.shortestFuse;
    if (this.player.downFor > 0) prompt = `Knocked down! Back on your feet in ${Math.ceil(this.player.downFor)}…`;
    else if (this.climb) prompt = this.climb.up ? 'Climbing the lookout…' : 'Climbing down…';
    else if (fuse !== null) prompt = `BOMB ARMED! GET CLEAR: ${Math.ceil(fuse)}`;
    else if (this.onTower) prompt = 'Look around! Walk to the gap in the rail at the head of the ladder to climb down';
    else {
      const l = this.lookouts.find((t) => Math.hypot(t.foot.x - p.x, t.foot.z - p.z) < 8);
      const dump = this.outposts.find((o) => o.dump.alive && Math.hypot(o.x - p.x, o.z - p.z) < 20);
      if (l) prompt = 'Walk to the foot of the ladder to climb the lookout';
      else if (dump && this.bombs > 0) prompt = this.dumpInReach() ? `Press ${input.usingGamepad ? 'RB' : input.keyboardPlayer === 2 ? 'Numpad 5' : 'Q'} to plant a bomb here, then run!` : 'Get closer to the ammo dump to plant a bomb';
      else if (dump) prompt = 'No bombs left: wreck the airbase jets for a supply drop';
      else if (this.time < 16) prompt = `Follow the golden beams, or climb a lookout tower (ladder on the south side) to scout. Hold ${input.usingGamepad ? 'LT' : input.keyboardPlayer === 2 ? 'Numpad 1' : 'E'} to knock trees flat with the jam gun`;
    }
    const standing = this.squad.standing;
    const status = [`Squad ${standing} / ${this.squad.list.length}${this.squad.holding ? ' (HOLDING)' : ''}  ·  Trees felled ${this.forest.fallen}`];
    if (this.weather.raining) status.push(`STORM: you can see about ${this.weather.seeMetres} m`);
    const alerted = this.enemies.alerted;
    return {
      title: 'JUNGLE PATROL',
      objectives: this.objectives(),
      prompt,
      downFor: this.player.downFor,
      jam: this.jamTank,
      onRaft: false,
      stealth: this.player.isDown
        ? null
        : alerted > 0
          ? { level: Math.min(1, 0.3 + alerted / 8), label: `${alerted} ENEMY ON THE ALERT`, color: '#ff6a4a' }
          : { level: 0, label: this.player.sneaking ? 'UNSEEN · CREEPING' : 'UNSEEN', color: '#9be27a' },
      status,
      launcher: { shots: this.grenades, max: GRENADES, reloadLeft: this.reload, reloadTime: GRENADE_RELOAD },
      bombs: { count: this.bombs, max: MAX_BOMBS },
    };
  }

  private hudState(input: InputState): HUDState {
    const split = !!this.player2;
    const vertical = this.settings.splitOrientation === 'vertical';
    const localWidth = split && vertical
      ? this.player === this.player2 ? window.innerWidth - Math.floor(window.innerWidth / 2) : Math.floor(window.innerWidth / 2)
      : window.innerWidth;
    const localHeight = split && !vertical
      ? this.player === this.player2 ? Math.floor(window.innerHeight / 2) : window.innerHeight - Math.floor(window.innerHeight / 2)
      : window.innerHeight;
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
      insideBase: null,
      map: this.player === this.player2 ? { ...this.mapView, playerX: position.x, playerZ: position.z, playerYaw: this.player.yaw } : this.mapView,
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
      cinematic: this.cut !== null,
      cinematicLabel: this.cut ? '● AMMO DUMP' : '',
      waypoint: this.waypoint(),
      enemyBasesLeft: 0,
      enemyBasesTotal: 0,
      nearbyBase: null,
      airSupport: null,
      tanker: null,
      siege: null,
      prison: this.prisonHUD(input),
      driveStyle: this.settings.driveStyle,
      mouseCaptureHint: !input.usingGamepad && !input.pointerLocked && input.pointerLockAvailable,
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
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.renderer.setViewport(0, 0, w, h); this.renderer.render(this.scene, this.camera);
      return;
    }
    const half = Math.floor((this.settings.splitOrientation === 'vertical' ? w : h) / 2);
    const v1 = this.settings.splitOrientation === 'vertical' ? { left: 0, top: 0, width: half, height: h } : { left: 0, top: 0, width: w, height: h - half };
    const v2 = this.settings.splitOrientation === 'vertical' ? { left: half, top: 0, width: w - half, height: h } : { left: 0, top: h - half, width: w, height: half };
    this.hud.setViewport(v1); this.hud2.setViewport(v2);
    for (const [camera, v] of [[this.camera, v1], [this.camera2, v2]] as const) {
      camera.aspect = v.width / v.height; camera.updateProjectionMatrix();
      const bottom = h - v.top - v.height;
      this.renderer.setViewport(v.left, bottom, v.width, v.height); this.renderer.setScissor(v.left, bottom, v.width, v.height);
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
      world: this.world,
      forest: this.forest,
      terrain: this.terrain,
      camps: this.camps,
      roads: this.roads,
      weather: this.weather,
      squad: this.squad,
      enemies: this.enemies,
      outposts: this.outposts,
      airbase: this.airbase,
      lookouts: this.lookouts,
      explosives: this.explosives,
      map: this.map,
      stats: this.stats,
      state: () => ({ grenades: this.grenades, reload: this.reload, bombs: this.bombs, onTower: !!this.onTower, climbing: !!this.climb, scouted: this.scouted, victory: this.victoryAt !== null, trees: this.forest.trees.length, felled: this.forest.fallen }),
    };
  }
}
