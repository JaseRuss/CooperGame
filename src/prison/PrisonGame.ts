import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, createWorld } from '../physics/PhysicsWorld';
import { InputManager, type InputState } from '../input/InputManager';
import { HUD, type HUDState, type PrisonHUD } from '../ui/HUD';
import type { MapView } from '../ui/WorldMap';
import { Sound } from '../audio/Sound';
import { ImpactEffects } from '../combat/ImpactEffects';
import { JamCannon } from '../combat/JamCannon';
import { NightSky } from '../world/NightSky';
import { loadSettings, saveSettings, AIM_SPEED_SCALE, GRAPHICS_QUALITY, type Settings } from '../core/Settings';
import { MISSION, startMission } from '../core/config';
import { Facility, ROOF_TOP, JETTY, type ClimbSpot, type FacilityLayout } from './Facility';
import { Lighthouse } from './Lighthouse';
import { Searchlights } from './Searchlights';
import { Outside, SHORE, SHORE_CHECKPOINTS, SHORE_GUARDS, HOME_REACH, loadTreeModels } from './Outside';
import { PlayerSoldier, MAX_HEALTH } from './PlayerSoldier';
import { ShoulderCam } from './ShoulderCam';
import { Cells } from './Cells';
import { Followers, type PrisonerSpot, type SquadWorld } from './Followers';
import { Guards, type Guard, type GuardWorld, type Shot } from './Guards';
import { VisionCones } from './VisionCones';
import { NavGraph } from './NavGraph';
import { Towers } from './Towers';
import { Flag } from './Flag';
import { Gear, GEAR_INFO } from './Gear';
import { SeaGate } from './SeaGate';
import { Sea, SEA_LEVEL } from './Sea';
import { Raft, RaftCam, CRUISE } from './Raft';
import { SearchHelis, type HeliReport } from './Helis';
import { Sharks } from './Sharks';
import { DayCycle, MOON_DIR } from './DayCycle';
import type { Cell } from './Cells';
import { FRIEND_SHOTS, ENEMY_SHOTS, WALLS_ONLY } from './groups';

/** The night sky's colour (the day cycle takes over from here as the dawn comes up). */
const SKY = 0x070b18;
/** The moon's shadow box follows the player; the compound is small, so it can be tight and sharp. */
const SHADOW_HALF = 45;
const SHOT_RANGE = 220;
const TRACER_TIME = 0.06;
/**
 * Who's locked in each cell. Only Keston and Max are in the plan: they're in the next two cells
 * along from yours, behind the same sort of loose vent. (The rest of the prison's empty: this
 * is a sneak-out, not a revolution.)
 */
const CELL_PRISONERS = [0, 1, 1];
const BUDDY_CELLS: Record<number, number> = { 1: 0, 2: 1 };
/**
 * The level, after Alcatraz's 1962 escape: out through the vent at the back of the cell, along
 * the pipe chase (letting Keston and Max out through theirs), up the pipes to the roof, across
 * it past the searchlights and down the bakery pipe. Then it's night in the prison grounds: gather
 * the gear for a raft without being seen ('out'), launch from the jetty and paddle the long way
 * across the sea past the search helicopters ('raft'), land at dawn and sneak up the road past
 * the patrols to Cooper's Base ('shore').
 */
type Stage = 'cell' | 'pipechase' | 'roof' | 'out' | 'raft' | 'shore';
/** Seconds to climb up the pipes, and down the bakery pipe. */
const CLIMB_UP_TIME = 3.2;
const CLIMB_DOWN_TIME = 2.8;
/** He starts a climb when he's this close to the foot (or top) of it. */
const CLIMB_REACH = 1.1;
const VENT_PROMPT_RANGE = 4;
/** The opening flyover: where the camera is and what it looks at, at each second-or-so mark, and how long it runs. */
const INTRO: { at: number; pos: [number, number, number]; look: [number, number, number] }[] = [
  { at: 0, pos: [0, 110, -230], look: [0, 0, -10] },
  { at: 2.5, pos: [120, 55, -70], look: [0, 3, 0] },
  { at: 4.5, pos: [34, 20, 2], look: [-10, 4, 20] },
  { at: 6, pos: [8, 14, 6], look: [-18, 2, 18] },
];
const INTRO_TIME = 6;
/** A guard's rifle hit on the player. */
const GUARD_DAMAGE = 5;
/** A rifle shot is heard by guards this far off (they come to look). */
const SHOT_NOISE = 26;
/** The jam riot cannon: seconds between globs, their speed, how much of the tank a second's spray uses, and how fast it refills. */
const JAM_INTERVAL = 0.07;
const JAM_SPEED = 22;
/** The jam's gravity (see JamCannon), for lobbing it onto the crosshair, and the farthest it's lobbed. */
const JAM_GRAVITY = 12;
const JAM_RANGE = 22;
const JAM_DRAIN = 0.28;
const JAM_REFILL = 0.2;
/** Guards within this of a glob's splat (or a drip) are stuck fast. */
const JAM_RADIUS = 1.8;
const JAM_DRIP_RADIUS = 1;
/** The raft: how long it takes to blow up, where it floats off the end of the jetty, how many hits it takes, and how many of those are life jackets. */
const RAFT_INFLATE_TIME = 5;
const RAFT_START_Z = JETTY.z1 - 4.5;
const HULL_MAX = 5;
const JACKETS = 3;
const CAPSIZE_TIME = 2.6;
/** The raft springs a leak this far across (0 to 1), twice: mash A to pump it up before it goes flat. */
const LEAKS = [0.3, 0.66];
/** Seconds for a leaking raft to go flat if you don't pump, how much air one press of A puts back, and how long flat before it sinks. */
const LEAK_TIME = 20;
const PUMP_PRESS = 0.085;
const FLAT_SINK = 4;
/** The raft grounds on the beach this far out from the waterline. */
const BEACH_REACH = 5;
/** How far along the walk home the dawn finishes (metres up the shore from where he lands). */
const DAWN_WALK = 280;
/** The raft's dawn: how far the sky gets by the time it lands. */
const DAWN_AT_LANDING = 0.36;
/** The little point lights on the floodlight poles that follow the player round the compound. */
const LAMP_LIGHTS = 4;

/** What the pause screen's first page shows on foot, instead of the map. */
const CONTROLS =
  '<span><b>Move</b> left stick · W A S D</span><span><b>Aim</b> right stick · mouse</span>' +
  '<span><b>Creep</b> (guards see half as far; lie flat on the raft) RB · Shift</span><span><b>Fire</b> RT · click (a shot is heard from far off)</span>' +
  '<span><b>Jam riot cannon</b> (quiet) hold LT · hold E</span><span><b>Squad: follow me / hold here</b> X · X</span>' +
  '<span><b>Camera</b> Y · C</span><span><b>Back to checkpoint</b> Back · R</span>' +
  '<span><b>On the raft</b> W paddle · S back water · A D steer · mouse swings the camera</span>';

/** Nothing on the map: the HUD needs one, but the prison has no minimap. */
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
  tanker: null,
  airbase: null,
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The bonus level: a night-time escape in the style of Alcatraz, 1962. Its own small game rather
 * than a mode of `Game`, which is built round driving the tank across the big map. It reuses
 * the same input, HUD, sound, physics and effects.
 *
 * Break out of your cell, take the escape gear from the prison without being seen (guards have
 * vision cones, and a shot is heard from far off, but you can still fight a bit with the rifle
 * and the jam riot cannon), launch a raft and paddle three minutes across the sea, hiding in the
 * mist from the search helicopters, then land as the dawn breaks and sneak home to Cooper's Base
 * past the patrols.
 */
export class PrisonGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private readonly camera2: THREE.PerspectiveCamera;
  private readonly input: InputManager;
  private readonly hud: HUD;
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
  private facility!: Facility;
  private player!: PlayerSoldier;
  private player2: PlayerSoldier | null = null;
  private cam!: ShoulderCam;
  private cam2!: ShoulderCam;
  private readonly hud2: HUD;
  private readonly splitDivider: HTMLDivElement;
  private dividerOrientation: 'vertical' | 'horizontal' | null = null;
  private jamTank2 = 1;
  private jamCooldown2 = 0;
  private downTime2 = 0;
  private cells!: Cells;
  private followers!: Followers;
  private guards!: Guards;
  private cones!: VisionCones;
  private nav!: NavGraph;
  private towers!: Towers;
  private flag!: Flag;
  private gear!: Gear;
  private seaGate!: SeaGate;
  private sea!: Sea;
  private raft!: Raft;
  private raftCam!: RaftCam;
  private helis!: SearchHelis;
  private sharks!: Sharks;
  private lighthouse!: Lighthouse;
  private sky!: NightSky;
  private day!: DayCycle;
  private searchlights!: Searchlights;
  private outside!: Outside;
  private readonly lampLights: THREE.PointLight[] = [];
  private lampTimer = 0;
  private time = 0;
  private squadWorld!: SquadWorld;
  /** Where he gets back up: his cell, until he's out of it. */
  private checkpoint: { x: number; z: number; yaw: number; y?: number } = { x: 0, z: 0, yaw: 0 };
  private stage: Stage = 'cell';
  /** The raft: blowing up at the jetty, under way, or going down (and back to the last buoy). */
  private raftPhase: 'inflating' | 'sailing' | 'sinking' = 'inflating';
  private raftTimer = 0;
  private hull = HULL_MAX;
  private buoysPassed = 0;
  /** Air in the raft (1 hard), whether it's leaking, which leak is next, how long it's been flat, and the last frame's fire button. */
  private air = 1;
  private leaking = false;
  private leakIndex = 0;
  private flatFor = 0;
  private wasFiring = false;
  private raftCheckpoint = { x: 0, z: RAFT_START_Z, yaw: 0 };
  private heliReport: HeliReport | null = null;
  /** The ending at Cooper's Base: seconds since it started (null until then). */
  private ending: number | null = null;
  /** The opening flyover: seconds into it (null once it's over). */
  private intro: number | null = 0;
  /** Mid-climb: the way he goes (waypoints), how far along (0..1), how long it takes, which way he faces, and what happens at the end. */
  private climbing: { path: THREE.Vector3[]; t: number; duration: number; yaw: number; spot: ClimbSpot; up: boolean } | null = null;
  private climbOwner: 1 | 2 = 1;
  /** How close the searchlights are to spotting him (0..1). */
  private spotted = 0;
  /** The jam riot cannon's tank (0..1) and the time to its next glob. */
  private jamTank = 1;
  private jamCooldown = 0;
  /** How long he's been down. */
  private downTime = 0;
  private readonly stats = { alarms: 0, helicopterAlarms: 0, capsized: 0, knockedDown: 0, startedAt: 0, shots: 0, guardsHit: 0, seenTime: 0, litTime: 0 };
  private lastAlarmAt = -99;
  /** Dev only: where the last rifle shot went. */
  lastShot: { from: number[]; to: number[]; hit: boolean } | null = null;
  /** Dev only: pins the camera for screenshots. */
  debugCam: { pos: [number, number, number]; look: [number, number, number] } | null = null;
  private readonly tracers: { line: THREE.Line; age: number }[] = [];
  private readonly friendTracer = new THREE.LineBasicMaterial({ color: 0xffe7a0, transparent: true });
  private readonly enemyTracer = new THREE.LineBasicMaterial({ color: 0xff9a5a, transparent: true });

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: this.settings.graphicsQuality !== 'low' });
    const graphics = GRAPHICS_QUALITY[this.settings.graphicsQuality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = graphics.shadowSize > 0;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1800);
    this.camera2 = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1800);
    this.input = new InputManager(this.renderer.domElement);
    this.hud = new HUD(container);
    this.hud2 = new HUD(container, true);
    this.hud.setMirror(this.hud2);
    this.hud2.setActive(false);
    this.splitDivider = document.createElement('div');
    this.splitDivider.style.cssText = 'display:none;position:absolute;z-index:2;background:#d6dfd880;pointer-events:none';
    container.appendChild(this.splitDivider);
    this.hud.setSoundHook((kind) => this.sound.play(kind === 'move' ? 'uiMove' : kind === 'change' ? 'uiChange' : kind === 'back' ? 'uiBack' : kind === 'open' ? 'uiOpen' : 'uiConfirm', { volume: 0.5, minGap: 0 }));

    this.loadingLabel = document.createElement('div');
    this.loadingLabel.style.cssText =
      'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;' +
      "font-size:22px; background:#0a0e14; color:#e8eef5; font-family:'Segoe UI',system-ui,sans-serif; z-index:10;";
    this.loadingLabel.textContent = 'Loading prison…';
    container.appendChild(this.loadingLabel);

    // Night: moonlight and a few floodlights (the DayCycle sets the real values and takes it through the dawn).
    this.scene.background = new THREE.Color(SKY);
    this.fog = new THREE.Fog(SKY, 40, 230);
    this.scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0x6c84b8, 0x2a2c3a, 1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0x9fb6ff, 0.85);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(graphics.shadowSize || 1024, graphics.shadowSize || 1024);
    const sh = this.sun.shadow.camera;
    sh.left = sh.bottom = -SHADOW_HALF;
    sh.right = sh.top = SHADOW_HALF;
    sh.far = 200;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    // A few real lights that hop between the floodlight poles nearest the player (the rest just glow).
    for (let i = 0; i < LAMP_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffe2a8, 0, 42, 2);
      this.scene.add(light);
      this.lampLights.push(light);
    }

    window.addEventListener('resize', () => this.onResize());
    void this.init();
  }

  private async init(): Promise<void> {
    await initPhysics();
    this.world = createWorld();
    this.impacts = new ImpactEffects(this.scene);
    // The prison's ground is flat (y = 0), and the jam goes past the squad.
    this.jam = new JamCannon(this.scene, () => 0, FRIEND_SHOTS);
    this.jam2 = new JamCannon(this.scene, () => 0, FRIEND_SHOTS);
    this.facility = new Facility(this.world);
    this.scene.add(this.facility.group);
    const layout = this.facility.layout;
    this.player = new PlayerSoldier(this.world, layout.start.x, layout.start.z, layout.start.yaw);
    this.scene.add(this.player.root);
    this.cam = new ShoulderCam(this.camera, this.world);
    this.syncPlayer2();
    this.cells = new Cells(this.world, layout.cells, layout.levers, layout.vents);
    this.scene.add(this.cells.group);
    this.followers = new Followers(this.world, prisonerSpots(layout), this.settings.buddyNames);
    this.scene.add(this.followers.group);
    this.guards = new Guards(this.world, [...layout.guards, ...SHORE_GUARDS]);
    this.guards.setSector('compound');
    this.scene.add(this.guards.group);
    this.cones = new VisionCones(this.world, this.guards);
    this.scene.add(this.cones.group);
    this.towers = new Towers(this.world, layout.towers, layout.yardMiddle);
    this.scene.add(this.towers.group);
    this.flag = new Flag(this.world, layout.flag);
    this.scene.add(this.flag.mesh);
    this.searchlights = new Searchlights(this.world, layout.searchlights, ROOF_TOP);
    this.scene.add(this.searchlights.group);
    this.gear = new Gear(layout.gear);
    this.scene.add(this.gear.group);
    this.seaGate = new SeaGate(this.world, layout.mainGate);
    this.scene.add(this.seaGate.group);
    const landing = SHORE.waterZ + BEACH_REACH;
    this.sea = new Sea(RAFT_START_Z, landing);
    this.scene.add(this.sea.group);
    this.raft = new Raft();
    this.scene.add(this.raft.group);
    this.raftCam = new RaftCam();
    this.helis = new SearchHelis(RAFT_START_Z, landing);
    this.scene.add(this.helis.group);
    this.lighthouse = new Lighthouse(this.world, 88, -37);
    this.scene.add(this.lighthouse.group);
    this.sharks = new Sharks(RAFT_START_Z, landing);
    this.scene.add(this.sharks.group);
    this.outside = new Outside(this.world, await loadTreeModels());
    this.scene.add(this.outside.group);
    // Stars and a moon; the day cycle fades them and brings the dawn (there are no firefights on the horizon here).
    this.sky = new NightSky(this.scene, { bases: () => [], troops: () => [] }, MOON_DIR.clone().normalize());
    this.day = new DayCycle(this.scene, this.fog, this.hemi, this.sun, this.sky);
    this.checkpoint = { ...layout.start };
    // Colliders added this frame aren't in the query pipeline until a step (and the nav graph needs them).
    this.world.step();
    this.nav = new NavGraph(this.world, layout.navPoints, (c) => this.cells.isDoor(c) || this.seaGate.isGate(c));
    const game = this;
    this.squadWorld = {
      get player() {
        return game.player.position;
      },
      get playerDown() {
        return game.player.isDown;
      },
      revivePlayer: () => {
        this.player.revive();
        this.hud.showCallout('PATCHED UP!', '#9be27a');
      },
      guards: this.guards,
      cells: this.cells,
      nav: this.nav,
      sees: (a, b) => this.sees(a, b),
      camera: this.camera.position,
      doorPosts: layout.doorPosts,
      // Hands off the jam cannons until the guards are on to you: the squad's only weapon is a loud one.
      get quiet() {
        return (game.stage !== 'out' && game.stage !== 'shore') || game.guards.alarmed === 0;
      },
    };

    this.hud.setOnFoot(CONTROLS);
    this.hud.setSettings(this.settings, (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    });
    this.applySettings();
    this.hud.setMissionStart((m) => startMission(m));
    void this.sound.load();

    this.loadingLabel.remove();
    this.ready = true;

    // Sneaking out to the night tune, all the way to the dawn.
    this.sound.music.setNight(true);
    this.sound.music.start();
    this.clock.start();
    if (import.meta.env.DEV) (window as unknown as { prison: PrisonGame }).prison = this;
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
    this.followers?.setNameTags(this.settings.nameTags, this.settings.buddyNames);
    if (this.player) this.syncPlayer2();
    this.pausedRendered = false;
    this.applyLite(this.settings.graphicsQuality === 'low');
  }

  private syncPlayer2(): void {
    const enabled = this.settings.player2Controller !== -2;
    if (enabled && !this.player2 && this.player) {
      const start = this.stage === 'raft' ? this.raft.position : this.player.position;
      this.player2 = new PlayerSoldier(this.world, start.x + 1.6, start.z, this.player.yaw);
      this.scene.add(this.player2.root);
      this.cam2 = new ShoulderCam(this.camera2, this.world);
      if (this.stage === 'raft') {
        this.player2.setVisible(false);
        this.player2.collider.setEnabled(false);
      }
      this.hud2.setActive(true);
    } else if (!enabled && this.player2) {
      this.scene.remove(this.player2.root);
      this.player2.dispose();
      this.player2 = null;
      this.hud2.setActive(false);
    }
    this.splitDivider.style.display = this.player2 ? 'block' : 'none';
    this.hud2.setViewport(this.player2 ? this.playerViewport(2) : null);
  }

  private playerViewport(player: 1 | 2): { left: number; top: number; width: number; height: number } {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!this.player2) return { left: 0, top: 0, width: w, height: h };
    if (this.settings.splitOrientation === 'vertical') {
      const half = Math.floor(w / 2);
      return player === 1 ? { left: 0, top: 0, width: half, height: h } : { left: half, top: 0, width: w - half, height: h };
    }
    const half = Math.floor(h / 2);
    return player === 1 ? { left: 0, top: half, width: w, height: h - half } : { left: 0, top: 0, width: w, height: half };
  }

  private withPlayer2<T>(run: () => T): T {
    if (!this.player2) return run();
    const player = this.player;
    const camera = this.camera;
    const cam = this.cam;
    const jam = this.jam;
    const jamTank = this.jamTank;
    const jamCooldown = this.jamCooldown;
    const downTime = this.downTime;
    this.player = this.player2;
    this.camera = this.camera2;
    this.cam = this.cam2;
    this.jam = this.jam2;
    this.jamTank = this.jamTank2;
    this.jamCooldown = this.jamCooldown2;
    this.downTime = this.downTime2;
    try { return run(); }
    finally {
      this.jamTank2 = this.jamTank;
      this.jamCooldown2 = this.jamCooldown;
      this.downTime2 = this.downTime;
      this.player = player;
      this.camera = camera;
      this.cam = cam;
      this.jam = jam;
      this.jamTank = jamTank;
      this.jamCooldown = jamCooldown;
      this.downTime = downTime;
    }
  }

  /**
   * Low graphics, on top of the lower resolution and no shadows: no real lights (the floodlights,
   * helicopter and roof searchlights are just drawn), half the mist, closer fog, fewer sharks and no lighthouse beams, and the vision cones refresh less often.
   */
  private applyLite(lite: boolean): void {
    if (!this.helis) return;
    this.helis.setLite(lite);
    this.searchlights.setLite(lite);
    this.cones.setLite(lite);
    this.sharks.setLite(lite);
    this.lighthouse.setLite(lite);
    this.sea.setLite(lite);
    this.day.fogScale = lite ? 0.55 : 1;
    for (const l of this.lampLights) l.visible = !lite;
  }

  private onResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.hud.setViewport(this.playerViewport(1));
    this.hud2.setViewport(this.player2 ? this.playerViewport(2) : null);
    this.pausedRendered = false;
  }

  private updateSecondHUD(input: InputState | null): void {
    if (!this.player2 || !input) return;
    const viewport = this.playerViewport(2);
    this.withPlayer2(() => this.hud2.update({
      ...this.hudState(input),
      aimScreen: this.hud.paused || this.ending !== null || this.stage === 'raft' || this.intro !== null
        ? null : { x: viewport.width / 2, y: viewport.height / 2 },
    }));
  }

  private renderViews(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.hud.setViewport(this.playerViewport(1));
    this.hud2.setViewport(this.player2 ? this.playerViewport(2) : null);
    if (this.dividerOrientation !== this.settings.splitOrientation) {
      this.dividerOrientation = this.settings.splitOrientation;
      this.splitDivider.style.left = this.settings.splitOrientation === 'vertical' ? '50%' : '0';
      this.splitDivider.style.top = this.settings.splitOrientation === 'vertical' ? '0' : '50%';
      this.splitDivider.style.width = this.settings.splitOrientation === 'vertical' ? '1px' : '100%';
      this.splitDivider.style.height = this.settings.splitOrientation === 'vertical' ? '100%' : '1px';
    }
    this.renderer.setScissorTest(this.player2 !== null);
    this.renderer.shadowMap.needsUpdate = true;
    if (!this.player2) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.settings.splitOrientation === 'vertical') {
      const half = Math.floor(w / 2);
      this.camera.aspect = half / h;
      this.camera2.aspect = (w - half) / h;
      this.camera.updateProjectionMatrix(); this.camera2.updateProjectionMatrix();
      this.renderer.setViewport(0, 0, half, h); this.renderer.setScissor(0, 0, half, h); this.renderer.render(this.scene, this.camera);
      this.renderer.setViewport(half, 0, w - half, h); this.renderer.setScissor(half, 0, w - half, h); this.renderer.render(this.scene, this.camera2);
    } else {
      const half = Math.floor(h / 2);
      this.camera.aspect = w / (h - half);
      this.camera2.aspect = w / half;
      this.camera.updateProjectionMatrix(); this.camera2.updateProjectionMatrix();
      this.renderer.setViewport(0, half, w, h - half); this.renderer.setScissor(0, half, w, h - half); this.renderer.render(this.scene, this.camera);
      this.renderer.setViewport(0, 0, w, half); this.renderer.setScissor(0, 0, w, half); this.renderer.render(this.scene, this.camera2);
    }
  }

  /** A clear line from `a` to `b`: no walls or bars (people don't block the view). */
  private sees(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = b.clone().sub(a);
    const d = dir.length();
    if (d < 0.01) return true;
    return !this.world.castRay(new RAPIER.Ray(a, dir.divideScalar(d)), d, true, undefined, WALLS_ONLY);
  }

  /** Where the crosshair points: whatever's under it, or far off down the aim. */
  private aimPoint(): THREE.Vector3 {
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const aim = this.cam.aimDirection();
    const sight = this.world.castRay(new RAPIER.Ray(camPos, aim), SHOT_RANGE, true, undefined, FRIEND_SHOTS);
    return camPos.addScaledVector(aim, sight ? sight.timeOfImpact : SHOT_RANGE);
  }

  /** The rifle: at whatever's under the crosshair, from the muzzle (so a wall in front of him still stops it). */
  private fireRifle(): void {
    const muzzle = this.player.muzzle();
    const target = this.aimPoint();
    const dir = target.clone().sub(muzzle);
    const dist = dir.length();
    dir.normalize();
    const hit = this.world.castRay(new RAPIER.Ray(muzzle, dir), dist + 0.05, true, undefined, FRIEND_SHOTS);
    const end = hit ? muzzle.clone().addScaledVector(dir, hit.timeOfImpact) : target;
    if (import.meta.env.DEV) this.lastShot = { from: muzzle.toArray(), to: end.toArray(), hit: !!hit };

    this.impacts.muzzleFlash(muzzle, dir, 0.3);
    this.sound.play('crack', { volume: 0.28, rate: 2.3, minGap: 0.05 });
    this.cam.addShake(0.08);
    // A shot is heard from far off: nearby guards come to look.
    if (this.stage === 'out' || this.stage === 'shore') {
      this.guards.hear(muzzle, SHOT_NOISE, this.sector());
      this.stats.shots++;
    }
    this.addTracer(muzzle, end, this.friendTracer);
    if (!hit) return;
    const vented = this.cells.hitVent(hit.collider);
    if (vented) {
      this.sound.play('clang', { at: end, volume: 0.9, rate: 0.9 });
      this.impacts.dustPuff(end);
      this.onVentOpened(vented);
      return;
    }
    const cell = this.cells.hit(hit.collider, dir);
    if (cell) {
      this.sound.play('clang', { at: end, volume: 0.9, rate: 1.1 });
      this.impacts.dustPuff(end);
      this.onCellsOpened([cell]);
      return;
    }
    if (this.seaGate.hit(hit.collider)) {
      this.sound.play('clang', { at: end, volume: 1, rate: 0.7 });
      this.sound.play('launch', { at: end, volume: 0.4, rate: 1.6, fadeAfter: 0.6 });
      this.impacts.dustPuff(end);
      this.onGateOpened();
      return;
    }
    this.impacts.dustPuff(end);
    const tower = this.towers.hit(hit.collider);
    if (tower) {
      this.sound.play('thud', { at: end, volume: 0.6, rate: 0.8, minGap: 0.05 });
      if (tower.felled) {
        this.hud.showCallout("TIMBER! THE TOWER'S COMING DOWN!", '#ffd24a');
        // Whoever's up there comes down with it.
        for (const g of this.guards.list) {
          if (g.post.height && g.post.x === tower.x && g.post.z === tower.z && (g.state === 'active' || g.state === 'jammed')) g.knockDown(tower.dir);
        }
      }
      return;
    }
    const flag = this.flag.hit(hit.collider);
    if (flag) {
      this.sound.play('thud', { at: end, volume: 0.5, rate: 1.8 });
      if (flag.down) this.hud.showCallout("THEIR FLAG'S COMING DOWN!", '#9be27a');
      return;
    }
    const guard = this.guards.hit(hit.collider, dir);
    if (guard) this.onGuardHit(guard, end, true);
    else this.sound.play('clang', { at: end, volume: 0.15, rate: 2.2, minGap: 0.08 });
  }

  /** A shot from the squad (at the guards) or a guard (at the player and the squad): what it hits. */
  private resolveShot(shot: Shot, side: 'friend' | 'enemy'): void {
    // The prisoners fire jam, not bullets.
    if (shot.at) {
      this.lobJam(shot.from, shot.at);
      this.sound.play('jamShot', { at: shot.from, volume: 0.18, rate: 1.2, minGap: 0.06 });
      return;
    }
    const hit = this.world.castRay(new RAPIER.Ray(shot.from, shot.dir), SHOT_RANGE, true, undefined, side === 'friend' ? FRIEND_SHOTS : ENEMY_SHOTS);
    const end = shot.from.clone().addScaledVector(shot.dir, hit ? hit.timeOfImpact : 60);
    this.impacts.muzzleFlash(shot.from, shot.dir, 0.25);
    this.sound.play('crack', { at: shot.from, volume: 0.22, rate: side === 'friend' ? 2.1 : 1.8, minGap: 0.04 });
    this.addTracer(shot.from, end, side === 'friend' ? this.friendTracer : this.enemyTracer);
    if (!hit) return;
    this.impacts.dustPuff(end);
    if (side === 'friend') {
      const guard = this.guards.hit(hit.collider, shot.dir);
      if (guard) this.onGuardHit(guard, end, false);
      return;
    }
    if (hit.collider.handle === this.player.collider.handle) {
      const wasUp = !this.player.isDown;
      this.player.takeDamage(GUARD_DAMAGE);
      this.cam.addShake(0.25);
      this.sound.play('thud', { volume: 0.5, rate: 1.6, minGap: 0.1 });
      if (wasUp && this.player.isDown) {
        this.downTime = 0;
        this.stats.knockedDown++;
      }
      return;
    }
    if (this.player2 && hit.collider.handle === this.player2.collider.handle) {
      const wasUp = !this.player2.isDown;
      this.player2.takeDamage(GUARD_DAMAGE);
      this.cam2.addShake(0.25);
      this.sound.play('thud', { volume: 0.5, rate: 1.6, minGap: 0.1 });
      if (wasUp && this.player2.isDown) {
        this.downTime2 = 0;
        this.stats.knockedDown++;
      }
      return;
    }
    const friend = this.followers.hit(hit.collider);
    if (friend?.down) this.hud.showCallout(`${friend.name ? friend.name.toUpperCase() : 'A PRISONER'} IS DOWN! MEDIC!`, '#ff8a7a');
  }

  private onGuardHit(guard: Guard, at: THREE.Vector3, byPlayer: boolean): void {
    this.sound.play('thud', { at, volume: 0.6, rate: 1.3, minGap: 0.05 });
    if (guard.state === 'down' && byPlayer) this.hud.showCallout('GUARD DOWN!', '#ffd24a');
    // Shot at, a guard knows exactly where the shooter is.
    if (byPlayer) {
      this.guards.provoke(guard, this.player.position);
      if (guard.state === 'down') this.stats.guardsHit++;
    }
  }

  /** The jam riot cannon: a spray of jam globs at the crosshair while LT / E is held (and there's jam in the tank). */
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
        if (this.guards.jamAt(point, JAM_RADIUS) > 0 && point.distanceTo(this.player.position) < 25) this.hud.showCallout('GUARD STUCK IN JAM!', '#ff8aa8');
      },
      (point) => this.guards.jamAt(point, JAM_DRIP_RADIUS),
    );
  }

  /**
   * A glob of jam from `from`, lobbed up just enough to come down on `target` (out to its
   * range), with a bit of scatter: it's a hose, not a rifle.
   */
  private lobJam(from: THREE.Vector3, target: THREE.Vector3): void {
    const dir = target.clone().sub(from);
    const reach = Math.min(JAM_RANGE, Math.hypot(dir.x, dir.z));
    dir.normalize();
    dir.x += (Math.random() - 0.5) * 0.08;
    dir.y += Math.min(0.4, (JAM_GRAVITY * reach) / (2 * JAM_SPEED * JAM_SPEED)) + (Math.random() - 0.5) * 0.05;
    dir.z += (Math.random() - 0.5) * 0.08;
    this.jam.fire(from, dir.normalize(), JAM_SPEED * (0.95 + Math.random() * 0.1));
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3, material: THREE.LineBasicMaterial): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, material);
    this.scene.add(line);
    this.tracers.push({ line, age: 0 });
  }

  private updateTracers(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.age += dt;
      if (t.age < TRACER_TIME) continue;
      this.scene.remove(t.line);
      t.line.geometry.dispose(); // the materials are shared
      this.tracers.splice(i, 1);
    }
  }

  private toCheckpoint(): void {
    const c = this.checkpoint;
    this.player.teleport(c.x, c.z, c.yaw, c.y ?? 0);
    this.player2?.teleport(c.x + 1.5, c.z, c.yaw, c.y ?? 0);
    this.followers.gather(this.player.position, this.squadWorld);
    // Everyone stands down and goes back to his beat.
    this.guards.standDown(this.sector());
    this.downTime = 0;
  }

  /** A vent grille's knocked out: his own (he's out into the pipe chase), or a buddy's. */
  private onVentOpened(cell: Cell): void {
    if (cell.index === 0) {
      this.stage = 'pipechase';
      this.checkpoint = { ...this.facility.layout.pipeChaseCheckpoint };
      this.hud.showBanner('THROUGH THE VENT!', 'You\'re in the pipe chase behind the cells. Let your buddies out of theirs, then climb the pipes at the far end');
      return;
    }
    const names = this.settings.buddyNames;
    const buddies = this.followers.release(cell.index, true);
    if (buddies.length) this.hud.showBanner(`${buddies.map((b) => names[b].toUpperCase()).join(' & ')} IS OUT!`, 'Squeezing out through the vent to join you');
    this.sound.play('uiConfirm', { volume: 0.6 });
  }

  /** Starts a climb: up the pipes to the roof, or down the bakery pipe. */
  private startClimb(spot: ClimbSpot, up: boolean): void {
    const f = spot.from;
    const t = spot.to;
    const path = up
      ? [new THREE.Vector3(f.x, f.y, f.z), new THREE.Vector3(f.x + 0.2, t.y - 0.4, f.z), new THREE.Vector3(t.x, t.y, t.z)]
      : [new THREE.Vector3(f.x, f.y, f.z), new THREE.Vector3(f.x - 1.1, f.y + 0.3, f.z), new THREE.Vector3(f.x - 1.1, 0.4, f.z), new THREE.Vector3(t.x, t.y, t.z)];
    // Facing the pipes (east, +X) going up; facing the wall (east) going down too.
    this.climbing = { path, t: 0, duration: up ? CLIMB_UP_TIME : CLIMB_DOWN_TIME, yaw: -Math.PI / 2, spot, up };
    this.climbOwner = this.player === this.player2 ? 2 : 1;
    this.sound.play('clang', { volume: 0.4, rate: 1.4 });
  }

  /** One frame of a climb; at the end he's off it and the squad climbs after him. */
  private updateClimb(dt: number): void {
    if (this.climbOwner === 2 && this.player2 && this.player !== this.player2) {
      this.withPlayer2(() => this.updateClimb(dt));
      return;
    }
    const c = this.climbing;
    if (!c) return;
    c.t = Math.min(1, c.t + dt / c.duration);
    // Along the waypoints, each leg taking its share of the time.
    const legs = c.path.length - 1;
    const f = c.t * legs;
    const i = Math.min(legs - 1, Math.floor(f));
    const at = c.path[i].clone().lerp(c.path[i + 1], f - i);
    this.player.climbAt(at, c.yaw);
    // Going up through the roof ventilator: a quick blackout as he squeezes through.
    const climbHud = this.player === this.player2 ? this.hud2 : this.hud;
    if (c.up) climbHud.setFade(c.t > 0.7 ? Math.min(1, (c.t - 0.7) * 6) : 0, '#000000');
    if (Math.floor(c.t * 8) !== Math.floor((c.t - dt / c.duration) * 8)) this.sound.play('thud', { volume: 0.2, rate: 2, minGap: 0.1 });
    if (c.t < 1) return;
    this.climbing = null;
    const to = c.spot.to;
    this.player.teleport(to.x, to.z, to.yaw, to.y);
    this.followers.climbAfter(new THREE.Vector3(to.x, to.y, to.z), to.yaw, this.squadWorld);
    this.checkpoint = { ...to };
    if (c.up) {
      climbHud.setFade(0);
      if (this.stage === 'pipechase') this.stage = 'roof';
      this.searchlights.setActive(true);
      this.hud.showBanner('ON THE ROOF!', 'Keep out of the searchlights and get to the bakery pipe at the far end');
    } else {
      if (this.stage === 'roof') this.stage = 'out';
      const anyoneOnRoof = this.facility.layout.onRoof(this.player.position.x, this.player.position.y, this.player.position.z)
        || (!!this.player2 && this.facility.layout.onRoof(this.player2.position.x, this.player2.position.y, this.player2.position.z));
      this.searchlights.setActive(anyoneOnRoof);
      this.sound.music.stinger();
      this.hud.showBanner('DOWN THE BAKERY PIPE!', "That's how they got out of Alcatraz. Now find the gear for a raft: follow the golden beams, and keep out of the guards' vision cones");
    }
  }

  /** On the roof: caught in a searchlight, he's back at the ventilator. */
  private updateSearchlights(dt: number): void {
    const p = this.player.position;
    const p2 = this.player2?.position;
    this.spotted = this.searchlights.update(dt, p, !(this.climbing && this.climbOwner === 1) && this.facility.layout.onRoof(p.x, p.y, p.z), p2 ? [{
      position: p2, onRoof: !(this.climbing && this.climbOwner === 2) && this.facility.layout.onRoof(p2.x, p2.y, p2.z),
    }] : []);
    if (this.spotted < 1) return;
    this.sound.music.alarm();
    this.hud.showBanner('SPOTTED!', 'Back to the ventilator. Keep to the shadows behind the vents and the skylights');
    this.searchlights.reset();
    this.spotted = 0;
    this.toCheckpoint();
  }

  /** Cells just opened (one padlock, or a whole block from its lever): the prisoners come out. */
  private onCellsOpened(cells: Cell[], byLever = false): void {
    const names = this.settings.buddyNames;
    const buddies = cells.flatMap((c) => this.followers.release(c.index));
    const freed = buddies.map((b) => names[b]).join(' & ');
    const out = cells.reduce((n, c) => n + this.followers.inCell(c.index), 0);
    if (byLever) {
      this.hud.showBanner('EVERY DOOR IS OPEN!', `${out} prisoners are out${buddies.length ? `, ${freed} too` : ''}!`);
    } else if (buddies.length) {
      this.hud.showBanner(`${freed.toUpperCase()} IS FREE!`, 'Your buddies are with you');
    } else if (this.followers.stayedBehind) {
      this.hud.showCallout(`+${out} · ${this.followers.stayedBehind} STAY TO HOLD THE PRISON`, '#9be27a');
    } else {
      this.hud.showCallout(`+${out} · SQUAD ${this.followers.count}`, '#9be27a');
    }
    this.sound.play('uiConfirm', { volume: 0.6 });
  }

  /** Which half of the level the guards are live in. */
  private sector(): 'compound' | 'shore' {
    return this.stage === 'shore' ? 'shore' : 'compound';
  }

  /** The padlock's shot off: the sea gate winds up (noisily), and there's the beach and the jetty beyond. */
  private onGateOpened(): void {
    this.guards.hear(this.seaGate.position, SHOT_NOISE + 12, 'compound');
    this.checkpoint = { x: 0, z: this.facility.layout.mainGate.z + 6, yaw: 0 };
    this.hud.showBanner('THE SEA GATE IS OPENING!', this.gear.complete ? 'Down the beach and out along the jetty to launch the raft' : `You still need: ${this.gear.missing.map((id) => GEAR_INFO[id].name.toLowerCase()).join(', ')}`);
  }

  /** He's walked over a piece of the escape gear. */
  private onGearTaken(id: keyof typeof GEAR_INFO): void {
    const info = GEAR_INFO[id];
    const have = this.gear.collected.length;
    this.sound.play('uiConfirm', { volume: 0.7 });
    this.sound.play('thud', { volume: 0.4, rate: 1.4 });
    if (this.gear.complete) {
      this.hud.showBanner('YOU HAVE EVERYTHING!', 'Shoot the padlock on the sea gate in the north wall, then down to the jetty. Keep out of sight on the way');
    } else {
      this.hud.showBanner(`${info.name.toUpperCase()}! (${have} / ${this.gear.total})`, `${info.name}: ${info.what}`);
    }
  }

  /** The gear's all together at the end of the jetty: blow up the raft, and the squad climbs aboard. */
  private startRaft(): void {
    const layout = this.facility.layout;
    this.stage = 'raft';
    this.raftPhase = 'inflating';
    this.raftTimer = 0;
    this.hull = HULL_MAX;
    this.buoysPassed = 0;
    this.air = 1;
    this.leaking = false;
    this.leakIndex = 0;
    this.flatFor = 0;
    this.raft.setPressure(1);
    this.raftCheckpoint = { x: layout.launch.x, z: RAFT_START_Z, yaw: 0 };
    this.stats.startedAt = this.time;
    const names = this.followers.buddiesFreed.map((b) => this.settings.buddyNames[b]);
    this.followers.board(this.squadWorld);
    this.raft.setCrew(names, this.settings.nameTags);
    this.raft.place(layout.launch.x, RAFT_START_Z, 0);
    this.raft.inflate(0);
    this.raft.setVisible(true);
    this.player.setVisible(false);
    this.player.root.visible = false;
    this.player.collider.setEnabled(false);
    if (this.player2) {
      this.player2.setVisible(false);
      this.player2.root.visible = false;
      this.player2.collider.setEnabled(false);
    }
    for (const l of this.lampLights) l.intensity = 0;
    this.hud.showBanner('BLOWING UP THE RAFT', 'Squeeze the bellows, stitch the raincoats, seal the seams…');
  }

  /** Down to the water: the raft's soaked, it's launched, and the helicopters start looking. */
  private sailing(): void {
    this.raftPhase = 'sailing';
    this.helis.setActive(true);
    this.hud.showBanner('PADDLE FOR THE FAR SHORE!', 'Three minutes of open sea. Stay out of the helicopters\' searchlights; the white mist banks hide you, and Shift pulls the tarp over you');
    this.sound.music.stinger();
  }

  private onRaftHit(): void {
    this.hull = Math.max(0, this.hull - 1);
    this.raftCam.addShake(0.5);
    this.sound.play('thud', { volume: 0.7, rate: 1.1 });
    if (this.hull === 0) {
      this.raftPhase = 'sinking';
      this.raftTimer = 0;
      this.stats.capsized++;
      this.hud.showBanner('THE RAFT IS GOING DOWN!', 'You\'ll be fished out and put back at the last buoy');
      return;
    }
    const jacket = this.hull >= HULL_MAX - JACKETS;
    this.hud.showCallout(jacket ? 'A LIFE JACKET TOOK THE HIT!' : 'THE RAFT IS TAKING WATER!', jacket ? '#ffd24a' : '#ff8a7a');
  }

  /** The crossing: paddle, hide, and hope. */
  private stepRaft(input: InputState, dt: number): void {
    const r = this.raft;
    const landingZ = SHORE.waterZ + BEACH_REACH;
    this.raftTimer += dt;
    const idle: InputState = { ...input, moveX: 0, moveY: 0, throttle: 0, steer: 0, sneak: false, aimYawDelta: 0, aimPitchDelta: 0 };
    if (this.raftPhase === 'inflating') {
      const t = Math.min(1, this.raftTimer / RAFT_INFLATE_TIME);
      r.inflate(t * t * (3 - 2 * t));
      r.update(dt, this.time, idle);
      r.speed = 0;
      // The camera looks on from the jetty, drifting round to the raft's side.
      const a = 0.5 + t * 0.9;
      this.camera.position.set(r.position.x + Math.sin(a) * 7, 3.2 + t, r.position.z + 2 + Math.cos(a) * 7);
      this.camera.lookAt(r.position.x, 0.8, r.position.z);
      if (Math.floor(this.raftTimer * 2) !== Math.floor((this.raftTimer - dt) * 2)) this.sound.play('poof', { volume: 0.35, rate: 1.7 + t * 0.6, minGap: 0.2 });
      this.hud.setFade(0);
      if (t >= 1) this.sailing();
      this.sound.updateEngine(0, 'chopper', false);
      return;
    }
    if (this.raftPhase === 'sinking') {
      // Down she goes, and the screen fades; then it's the last buoy again, with the raft patched.
      r.group.position.y = SEA_LEVEL - 0.1 - this.raftTimer * 0.5;
      r.group.rotation.z += dt * 0.5;
      this.raftCam.update(this.camera, r, idle, dt);
      this.hud.setFade(Math.min(1, Math.max(0, (this.raftTimer - 1) / 1.2)), '#000000');
      if (this.raftTimer >= CAPSIZE_TIME) {
        r.place(this.raftCheckpoint.x, this.raftCheckpoint.z, this.raftCheckpoint.yaw);
        r.inflate(1);
        this.hull = HULL_MAX - JACKETS + 1;
        this.helis.reset();
        this.air = 1;
        this.leaking = false;
        this.flatFor = 0;
        r.setPressure(1);
        this.raftPhase = 'sailing';
        this.hud.setFade(0);
        this.hud.showCallout('BACK AT THE LAST BUOY, PATCHED UP', '#9be27a');
      }
      return;
    }
    r.update(dt, this.time, input, this.gear.has('paddles'));
    this.raftCam.update(this.camera, r, input, dt);
    this.updateAir(input, dt);
    const mist = this.sea.mistAt(r.position.x, r.position.z);
    const progress = THREE.MathUtils.clamp((RAFT_START_Z - r.position.z) / (RAFT_START_Z - landingZ), 0, 1);
    const report = this.helis.update(dt, r.position, mist, r.flat, progress);
    this.heliReport = report;
    if (report.lit) this.stats.litTime += dt;
    if (report.alarm) {
      this.stats.helicopterAlarms++;
      this.sound.music.alarm();
      this.hud.showBanner('SPOTTED FROM THE AIR!', 'They\'re coming: get into a white mist bank and lie flat (Shift)');
    }
    if (report.lost) this.hud.showCallout('YOU\'VE LOST THEM… KEEP QUIET', '#9be27a');
    for (const h of report.hits) {
      this.addTracer(h.from, h.to, this.enemyTracer);
      this.sound.play('crack', { at: h.from, volume: 0.5, rate: 1.4, minGap: 0.1 });
      this.impacts.splash(h.to, h.hit ? 1.5 : 1);
      if (h.hit && this.raftPhase === 'sailing') this.onRaftHit();
    }
    // Lit buoys down the middle: each is a checkpoint, with a spare life jacket tied to it.
    const buoy = this.sea.buoys[this.buoysPassed];
    if (buoy && r.position.z < buoy.z) {
      this.buoysPassed++;
      this.raftCheckpoint = { x: buoy.x, z: buoy.z - 5, yaw: r.yaw };
      if (this.hull < HULL_MAX) this.hull++;
      this.hud.showBanner(`BUOY ${this.buoysPassed} OF ${this.sea.buoys.length}`, 'A spare life jacket was tied to it. The next buoy is further up the course');
      this.sound.play('uiConfirm', { volume: 0.6 });
    }
    // The rotors, heard from further off than seen.
    const near = Math.min(report.nearest, 400);
    this.sound.updateEngine(24, 'chopper', true, Math.pow(Math.max(0, 1 - near / 320), 1.5) * 1.6);
    if (r.position.z < landingZ) this.landOnShore();
  }

  /** The leaks: a seam splits (twice in the crossing) and the air starts going; mash A to pump it back up. */
  private updateAir(input: InputState, dt: number): void {
    const r = this.raft;
    const progress = THREE.MathUtils.clamp((RAFT_START_Z - r.position.z) / (RAFT_START_Z - (SHORE.waterZ + BEACH_REACH)), 0, 1);
    if (!this.leaking && this.leakIndex < LEAKS.length && progress >= LEAKS[this.leakIndex]) {
      this.leaking = true;
      this.sound.play('clang', { volume: 0.5, rate: 0.7 });
      this.hud.showBanner('A SEAM HAS SPLIT!', 'The raft is losing air: mash A (or Space / click) to pump it up!');
    }
    const pressed = input.firing && !this.wasFiring;
    this.wasFiring = input.firing;
    if (this.leaking) {
      this.air = Math.max(0, this.air - dt / LEAK_TIME);
      if (pressed) {
        this.air = Math.min(1, this.air + PUMP_PRESS);
        this.sound.play('poof', { volume: 0.4, rate: 1.4 + this.air * 0.6, minGap: 0.05 });
        this.raftCam.addShake(0.05);
      }
      if (this.air >= 1) {
        this.leaking = false;
        this.leakIndex++;
        this.hud.showCallout('PUMPED UP!', '#9be27a');
      }
      this.flatFor = this.air <= 0 ? this.flatFor + dt : 0;
      if (this.flatFor > FLAT_SINK && this.raftPhase === 'sailing') {
        this.flatFor = 0;
        this.hull = 1;
        this.onRaftHit();
      }
    }
    r.setPressure(this.air);
  }

  /** The raft grounds on the beach: he steps ashore as the sun comes up. */
  private landOnShore(): void {
    const x = THREE.MathUtils.clamp(this.raft.position.x, -100, 100);
    this.stage = 'shore';
    this.raft.place(x, SHORE.waterZ + BEACH_REACH + 0.6, this.raft.yaw);
    this.raft.speed = 0;
    this.raft.clearCrew();
    this.player.root.visible = true;
    this.player.setVisible(true);
    this.player.collider.setEnabled(true);
    this.player.teleport(x, SHORE.landing.z, 0);
    this.followers.disembark(this.player.position, 0);
    if (this.player2) {
      this.player2.collider.setEnabled(true);
      this.player2.root.visible = true;
      this.player2.setVisible(true);
      this.player2.teleport(x + 1.6, SHORE.landing.z, 0);
    }
    this.guards.setSector('shore');
    this.helis.setActive(false);
    this.sound.updateEngine(0, 'chopper', false);
    this.checkpoint = { ...SHORE_CHECKPOINTS[0], x };
    this.shoreCheckpoint = 0;
    this.shoreSince = this.time;
    this.sound.music.setNight(false);
    this.sound.music.stinger();
    this.hud.setFade(0);
    this.hud.showBanner('LANDFALL!', "Dawn's breaking. Cooper's Base is straight up the road, but the tan army is out looking for you: keep out of the vision cones (creep with Shift)");
  }

  private shoreCheckpoint = 0;

  /** Home at Cooper's Base: the camp cheers, and the end screen comes up. */
  private startEnding(): void {
    this.ending = 0;
    this.outside.cheer();
    this.sound.music.fanfare();
    const names = this.followers.buddiesFreed.map((b) => this.settings.buddyNames[b]);
    const crew = names.length ? `${[...names, 'you'].slice(0, -1).join(', ')} and you` : 'You';
    const alarms = this.stats.alarms + this.stats.helicopterAlarms;
    const rating = this.stealthRating();
    this.hud.showEnding(
      true,
      'MISSION ACCOMPLISHED!',
      `${crew} slipped out of the tan army's prison, rafted across the sea and walked home to Cooper's Base in ${clock(this.time)}. ` +
        `STEALTH RATING: ${rating.grade} · ${rating.title} (${rating.score} / 100). ` +
        `Alarms raised: ${alarms} · seen by guards for ${Math.round(this.stats.seenTime)} s · in a searchlight for ${Math.round(this.stats.litTime)} s · shots fired: ${this.stats.shots} · guards put down: ${this.stats.guardsHit}` +
        `${this.stats.capsized ? ` · raft sunk ${this.stats.capsized}×` : ''}${this.stats.knockedDown ? ` · knocked down ${this.stats.knockedDown}×` : ''}.`,
    );
  }

  /** How quietly it went: points off for alarms, being seen or lit, shooting, putting guards down, getting knocked down and sinking. */
  private stealthRating(): { grade: string; title: string; score: number } {
    const st = this.stats;
    const score = Math.max(
      0,
      Math.round(
        100 - st.alarms * 14 - st.helicopterAlarms * 10 - Math.min(24, st.seenTime * 1.5) - Math.min(15, st.litTime * 1) - Math.min(15, st.shots * 0.6) - st.guardsHit * 4 - st.knockedDown * 8 - st.capsized * 12,
      ),
    );
    const [grade, title] = score >= 95 ? ['S', 'GHOST'] : score >= 80 ? ['A', 'SHADOW'] : score >= 60 ? ['B', 'PROWLER'] : score >= 40 ? ['C', 'NOISY'] : ['D', 'SMASH AND GRAB'];
    return { grade, title, score };
  }

  /** The ending: the camera circles the party; A / Enter plays again. */
  private updateEnding(input: InputState, dt: number): void {
    const t = (this.ending = (this.ending ?? 0) + dt);
    this.outside.update(dt);
    const c = this.player.position;
    const a = t * 0.25;
    this.camera.position.set(c.x + Math.sin(a) * 9, c.y + 4.5, c.z + Math.cos(a) * 9);
    this.camera.lookAt(c.x, c.y + 1.4, c.z);
    if (t > 3) this.hud.setVictoryFooter('Press A / Enter to play it again (or Start / M for the level select)');
    if (t > 3 && input.menu.confirm) startMission(MISSION);
    this.world.step();
    this.impacts.update(dt);
  }

  /**
   * The sky, the sea and the lights: the dawn (nothing until the raft's near the far shore,
   * then the sun comes up as he walks home), the sea under the raft, and the floodlights that
   * follow him round the compound.
   */
  private updateAtmosphere(dt: number, focus: THREE.Vector3): void {
    let dawn = 0;
    if (this.stage === 'raft') {
      const landingZ = SHORE.waterZ + BEACH_REACH;
      const progress = THREE.MathUtils.clamp((RAFT_START_Z - this.raft.position.z) / (RAFT_START_Z - landingZ), 0, 1);
      dawn = DAWN_AT_LANDING * THREE.MathUtils.smoothstep(progress, 0.55, 1);
    } else if (this.stage === 'shore') {
      const walked = SHORE.landing.z - this.player.position.z;
      dawn = DAWN_AT_LANDING + (1 - DAWN_AT_LANDING) * THREE.MathUtils.smoothstep(walked, 0, DAWN_WALK);
    }
    if (this.ending !== null) dawn = 1;
    this.day.set(dawn);
    this.sun.position.copy(focus).add(this.day.sunOffset);
    this.sun.target.position.copy(focus);
    this.sky.update(dt, this.camera, focus);
    const seaCenter = this.stage === 'raft' ? this.raft.position : this.stage === 'shore' ? SEA_CENTER_SHORE : SEA_CENTER_PRISON;
    this.sea.update(seaCenter, this.time, this.day.waterColor, MIST_NIGHT.clone().lerp(this.fog.color, THREE.MathUtils.smoothstep(dawn, 0.3, 0.8)));

    // Floodlights: the nearest few poles get a real light (only in the compound, where they're lit).
    const inCompound = this.stage !== 'raft' && this.stage !== 'shore';
    this.lampTimer -= dt;
    if (this.lampLights.length && this.lampTimer <= 0) {
      this.lampTimer = 0.4;
      const player2 = this.player2?.position;
      const distance = (lamp: (typeof this.facility.layout.lamps)[number]) => Math.min(
        Math.hypot(lamp.x - focus.x, lamp.z - focus.z),
        player2 ? Math.hypot(lamp.x - player2.x, lamp.z - player2.z) : Infinity,
      );
      const lamps = [...this.facility.layout.lamps].sort((a, b) => distance(a) - distance(b));
      this.lampLights.forEach((l, i) => {
        const lamp = lamps[i];
        if (!lamp) { l.intensity = 0; return; }
        l.position.set(lamp.x, lamp.y - 0.4, lamp.z);
        l.intensity = inCompound && distance(lamp) < 60 ? 130 : 0;
      });
    }
  }

  /** One frame on foot (the cell, the pipes, the roof, the prison grounds and the far shore). */
  private stepFoot(input: InputState, dt: number, input2: InputState | null = null): void {
    if (input.cameraTogglePressed) this.cam.toggle();
    if ((input.megaJamPressed || input2?.megaJamPressed) && this.followers.count > 0) {
      const holding = this.followers.toggleHold();
      this.hud.showCallout(holding ? 'SQUAD: HOLD HERE' : 'SQUAD: FOLLOW ME', holding ? '#ffd24a' : '#9be27a');
      this.sound.play('uiChange', { volume: 0.5 });
    }
    if (this.player.isDown) this.downTime += dt;
    const layout = this.facility.layout;
    const p = this.player.position;
    if (this.climbing) this.updateClimb(dt);
    if (!(this.climbing && this.climbOwner === 1)) {
      const wasDown = this.player.isDown;
      if (this.player.step(input, dt)) this.fireRifle();
      // Back on his feet at the last checkpoint (with the squad) when asked, or when he's been down his time.
      if (input.resetPressed || (wasDown && !this.player.isDown && this.player.health === 0)) this.toCheckpoint();
      this.updateJam(input, dt);
      // Up the pipes at the end of the pipe chase; down the bakery pipe from the roof.
      const near = (s: ClimbSpot) => Math.hypot(p.x - s.from.x, p.z - s.from.z) < CLIMB_REACH && Math.abs(p.y - s.from.y) < 1.5;
      if ((this.stage === 'pipechase' || this.stage === 'roof') && near(layout.ladder)) this.startClimb(layout.ladder, true);
      else if ((this.stage === 'roof' || this.stage === 'out') && near(layout.bakeryPipe)) this.startClimb(layout.bakeryPipe, false);
      else if (this.stage === 'out' && !this.player.isDown && this.gear.complete && Math.hypot(p.x - layout.launch.x, p.z - layout.launch.z) < LAUNCH_REACH) this.startRaft();
    }
    if (this.player2 && input2) {
      this.withPlayer2(() => {
        if (input2.cameraTogglePressed) this.cam.toggle();
        if (this.player.isDown) this.downTime += dt;
        const wasDown = this.player.isDown;
        if (!(this.climbing && this.climbOwner === 2) && this.player.step(input2, dt)) this.fireRifle();
        if (input2.resetPressed || (wasDown && !this.player.isDown && this.player.health === 0)) {
          this.player.teleport(this.checkpoint.x, this.checkpoint.z + 1.5, this.checkpoint.yaw, this.checkpoint.y ?? 0);
          this.downTime = 0;
        }
        this.updateJam(input2, dt);
        const layout = this.facility.layout;
        const p = this.player.position;
        const near = (s: ClimbSpot) => Math.hypot(p.x - s.from.x, p.z - s.from.z) < CLIMB_REACH && Math.abs(p.y - s.from.y) < 1.5;
        if (!this.climbing && (this.stage === 'pipechase' || this.stage === 'roof') && near(layout.ladder)) this.startClimb(layout.ladder, true);
        else if (!this.climbing && (this.stage === 'roof' || this.stage === 'out') && near(layout.bakeryPipe)) this.startClimb(layout.bakeryPipe, false);
        else if (!this.climbing && this.stage === 'out' && !this.player.isDown && this.gear.complete && Math.hypot(p.x - layout.launch.x, p.z - layout.launch.z) < LAUNCH_REACH) this.startRaft();
      });
    }
    const anyoneOnRoof = layout.onRoof(this.player.position.x, this.player.position.y, this.player.position.z)
      || (!!this.player2 && layout.onRoof(this.player2.position.x, this.player2.position.y, this.player2.position.z));
    if (anyoneOnRoof) this.updateSearchlights(dt);
    else this.searchlights.update(dt, p, false);

    // The gear (in the prison grounds).
    if (this.stage === 'out') {
      const got = this.gear.update(this.time, this.player.isDown ? null : p, this.player2 && !this.player2.isDown ? this.player2.position : null);
      for (const item of got) this.onGearTaken(item);
    }

    // The guards: nobody on the roof is seen from the ground (it's a sneaking bit), and nobody mid-climb.
    if (this.stage !== 'raft') {
      const onRoof = layout.onRoof(p.x, p.y, p.z);
      const exposed = !this.player.isDown && !(this.climbing && this.climbOwner === 1) && !onRoof;
      const p2 = this.player2?.position;
      const p2Exposed = !!p2 && !this.player2?.isDown && !(this.climbing && this.climbOwner === 2) && !layout.onRoof(p2.x, p2.y, p2.z);
      const targets = [...(exposed ? [p] : []), ...(p2Exposed && p2 ? [p2] : []), ...this.followers.targets().filter((t) => !layout.onRoof(t.x, t.y, t.z))];
      const world: GuardWorld = {
        player: exposed ? p : null,
        sneaking: this.player.sneaking,
        players: [
          ...(exposed ? [{ position: p, sneaking: this.player.sneaking }] : []),
          ...(p2Exposed && p2 ? [{ position: p2, sneaking: this.player2?.sneaking ?? false }] : []),
        ],
        targets,
        sees: (a, b) => this.sees(a, b),
        nav: this.stage === 'shore' ? null : this.nav,
        sector: this.sector(),
      };
      for (const shot of this.guards.update(dt, world)) this.resolveShot(shot, 'enemy');
      this.handleGuardEvents();
      if (this.guards.anySeeing) this.stats.seenTime += dt;
    }
    for (const shot of this.followers.update(dt, this.squadWorld)) this.resolveShot(shot, 'friend');
    this.world.step();

    this.outside.update(dt);
    if (this.flag.update(dt, this.time)) this.hud.showCallout('OUR FLAG FLIES OVER THE BARRACKS!', '#9be27a');
    for (const at of this.towers.update(dt)) {
      // The tower crashes down in a cloud of dust (and the whole prison hears it).
      const d = new THREE.Vector3(at.x, 0.5, at.z);
      this.sound.play('explosion', { at: d, volume: 0.8, rate: 0.8 });
      this.guards.hear(d, 45, 'compound');
      this.cam.addShake(0.3);
      for (let i = 0; i < 6; i++) this.impacts.dustPuff(d.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)));
    }

    // The far shore: checkpoints on the way, and home.
    if (this.stage === 'shore') {
      const next = SHORE_CHECKPOINTS[this.shoreCheckpoint + 1];
      const p2AtNext = !!this.player2 && this.player2.position.z < (next?.z ?? Infinity) + 8;
      if (next && (p.z < next.z + 8 || p2AtNext)) {
        this.shoreCheckpoint++;
        this.checkpoint = { ...next };
        this.hud.showCallout('CHECKPOINT', '#9be27a');
      }
      const home = SHORE.home;
      const p2Home = !this.player2 || Math.hypot(this.player2.position.x - home.x, this.player2.position.z - home.z) < HOME_REACH;
      if (Math.hypot(p.x - home.x, p.z - home.z) < HOME_REACH && p2Home) this.startEnding();
    }

    this.cam.update(this.player, dt);
    this.cells.update(dt);
    this.seaGate.update(dt);
    this.impacts.update(dt);
    this.updateTracers(dt);
  }

  /** Alarms (and, silently, searches) the guards raised this frame. */
  private handleGuardEvents(): void {
    for (const e of this.guards.takeEvents()) {
      if (e.kind !== 'alarm') continue;
      this.stats.alarms++;
      if (this.time - this.lastAlarmAt < 6) continue;
      this.lastAlarmAt = this.time;
      this.sound.music.alarm();
      this.hud.showBanner('SPOTTED!', 'The guards are on to you: break their line of sight and creep away (Shift), or fight');
    }
  }

  /** Dev only: runs the game `seconds` ahead with `hold` pressed (to test a long stretch without waiting for it). */
  debugAdvance(seconds: number, hold: Partial<InputState> = {}): void {
    const base = this.input.update(0);
    for (let t = 0; t < seconds; t += 0.05) this.step({ ...base, ...hold }, 0.05);
  }

  /** One frame of the game (everything but drawing it). */
  private step(input: InputState, dt: number, input2: InputState | null = null): void {
    if (input.mapTogglePressed || input2?.mapTogglePressed) this.hud.toggleBigMap();
    this.time += dt;
    let focus: THREE.Vector3;
    if (this.stage === 'raft') {
      const raftInput = input2 ? {
        ...input,
        throttle: THREE.MathUtils.clamp(input.throttle + input2.throttle, -1, 1),
        steer: THREE.MathUtils.clamp(input.steer + input2.steer, -1, 1),
        moveX: THREE.MathUtils.clamp(input.moveX + input2.moveX, -1, 1),
        moveY: THREE.MathUtils.clamp(input.moveY + input2.moveY, -1, 1),
        firing: input.firing || input2.firing,
        sneak: input.sneak || input2.sneak,
        aimYawDelta: input.aimYawDelta + input2.aimYawDelta,
        aimPitchDelta: input.aimPitchDelta + input2.aimPitchDelta,
      } : input;
      this.stepRaft(raftInput, dt);
      this.world.step();
      this.impacts.update(dt);
      this.updateTracers(dt);
      focus = this.raft.position;
    } else if (this.ending !== null) {
      this.updateEnding(input2 ? { ...input, menu: { ...input.menu, confirm: input.menu.confirm || input2.menu.confirm } } : input, dt);
      focus = this.player.position;
    } else {
      this.stepFoot(input, dt, input2);
      focus = this.player.position;
    }
    if (this.player2) {
      if (this.stage === 'raft' || this.ending !== null || this.intro !== null) {
        this.camera2.position.copy(this.camera.position);
        this.camera2.quaternion.copy(this.camera.quaternion);
      } else this.cam2.update(this.player2, dt);
    }
    this.cones.update(this.camera.position, this.time, this.player2 ? this.camera2.position : undefined);
    this.sharks.update(dt, this.time, focus, this.stage === 'raft' ? this.raft.position : null);
    this.updateAtmosphere(dt, focus);
    this.lighthouse.update(dt, this.day.value);
    if (import.meta.env.DEV && this.debugCam) {
      this.camera.position.set(...this.debugCam.pos);
      this.camera.lookAt(...this.debugCam.look);
    }
  }

  /** How the stealth meter reads: the guards' (or the helicopters', or the searchlights') suspicion of him. */
  private stealthMeter(): PrisonHUD['stealth'] {
    if (this.climbing || this.player.isDown) return null;
    if (this.stage === 'roof') {
      return this.spotted > 0 ? { level: this.spotted, label: 'IN THE LIGHT!', color: '#ff8a3a' } : { level: 0, label: 'IN THE SHADOWS', color: '#9be27a' };
    }
    if (this.stage === 'raft') {
      const r = this.heliReport;
      if (!r || this.raftPhase !== 'sailing') return null;
      if (r.hunting) return { level: 1, label: 'HUNTED: GET INTO THE MIST', color: '#ff4a38' };
      if (r.lit) return { level: Math.max(0.15, r.exposure), label: 'IN THE BEAM!', color: '#ff8a3a' };
      if (this.sea.mistAt(this.raft.position.x, this.raft.position.z) > 0.5) return { level: 0, label: 'HIDDEN IN THE MIST', color: '#8fd0ff' };
      return { level: r.exposure, label: this.raft.flat > 0.5 ? 'LYING LOW' : 'UNSEEN', color: r.exposure > 0.05 ? '#ffc040' : '#9be27a' };
    }
    if (this.stage !== 'out' && this.stage !== 'shore') return null;
    const alarmed = this.guards.alarmed;
    const level = this.guards.suspicion;
    const creeping = this.player.sneaking ? ' · CREEPING' : '';
    if (alarmed > 0) return { level: 1, label: `SPOTTED: ${alarmed} GUARD${alarmed === 1 ? '' : 'S'} ON TO YOU`, color: '#ff4a38' };
    if (level > 0.05) return { level, label: `SUSPICIOUS${creeping}`, color: '#ffc040' };
    return { level: 0, label: `UNSEEN${creeping}`, color: '#9be27a' };
  }

  private prisonHUD(): PrisonHUD {
    const p = this.player.position;
    const down = this.player.downFor;
    const layout = this.facility.layout;
    const names = this.settings.buddyNames;
    const squad = this.followers.count;
    const friendDown = this.player.isDown || this.stage === 'raft' ? null : this.followers.downNear(p, 6);
    let prompt: string | null = null;

    const ventNear = this.cells.ventsLeft.find((v) => v.cell !== 0 && Math.hypot((v.x0 + v.x1) / 2 - p.x, v.z - p.z) < VENT_PROMPT_RANGE);
    const alarmed = this.guards.alarmed > 0;
    const missing = this.gear.missing.map((id) => GEAR_INFO[id].name.toLowerCase());
    if (this.climbing) {
      prompt = this.climbing.up ? 'Climbing up the pipes…' : 'Sliding down the bakery pipe…';
    } else if (this.stage === 'raft') {
      const r = this.heliReport;
      if (this.raftPhase === 'inflating') prompt = 'Pumping up the raft…';
      else if (this.raftPhase === 'sinking') prompt = 'The raft is going down…';
      else if (this.leaking) prompt = this.air <= 0 ? 'FLAT! Mash A to pump!' : 'The raft is losing air! MASH A (Space / click) to pump it up!';
      else if (r?.hunting) prompt = 'They\'ve found you! Head for a white mist bank and lie flat (Shift)';
      else if (r?.lit) prompt = 'You\'re in a searchlight! Paddle out of it, or lie flat (Shift)';
      else if (this.raft.atEdge) prompt = 'The current is pushing you back: keep to the channel';
      else if (this.raftTimer < 14) prompt = 'W paddle · A D steer · mouse swings the camera · Shift lie flat';
    } else if (this.stage === 'roof' && this.spotted > 0) {
      prompt = "You're in the light! Get out of it!";
    } else if (down > 0) {
      prompt = `Knocked down! Back on your feet in ${Math.ceil(down)}…`;
    } else if (this.stage === 'cell') {
      prompt = 'The grille at the back of your cell is loose: shoot it out!';
    } else if (ventNear) {
      const buddy = BUDDY_CELLS[ventNear.cell];
      prompt = `Shoot the grille to let ${buddy === undefined ? 'them' : names[buddy]} out`;
    } else if (this.stage === 'pipechase') {
      prompt = 'Climb the pipes at the far (east) end of the pipe chase';
    } else if (this.stage === 'roof') {
      prompt = 'Keep out of the searchlights! Get to the bakery pipe at the far (west) end';
    } else if (alarmed) {
      prompt = 'The guards are on to you! Break line of sight and creep away (Shift), or fight';
    } else if (friendDown) {
      const who = friendDown.name ?? 'A friend';
      prompt = friendDown.progress > 0 ? `Helping ${who} up… ${Math.round(friendDown.progress * 100)}%` : `${who} is down: stand right next to them to help them up`;
    } else if (this.stage === 'out') {
      const toLaunch = Math.hypot(layout.launch.x - p.x, layout.launch.z - p.z);
      if (this.seaGate.opened && !this.gear.complete && toLaunch < 30) prompt = `You still need: ${missing.join(', ')}`;
      else if (this.gear.complete && !this.seaGate.opened) prompt = 'You have it all: shoot the padlock on the sea gate (it\'s loud!)';
      else if (this.gear.complete && this.seaGate.opened) prompt = 'Out along the jetty to launch the raft';
      else if (this.guards.suspicion > 0.3) prompt = 'A guard is getting suspicious: get out of his vision cone!';
      else if (this.gear.collected.length === 0) prompt = 'Find the escape gear: follow the golden beams, and keep out of the guards\' vision cones';
    } else if (this.stage === 'shore') {
      if (this.guards.suspicion > 0.3) prompt = 'A guard is getting suspicious: get out of his vision cone!';
      else if (this.time - this.shoreSince < 10) prompt = "Cooper's Base is straight up the road. Stay out of the vision cones, behind the hedges and hay bales";
    }

    const status: string[] = [];
    if (this.stage === 'raft' && this.raftPhase !== 'inflating') {
      const landingZ = SHORE.waterZ + BEACH_REACH;
      const left = Math.max(0, this.raft.position.z - landingZ);
      status.push(`Raft ${'●'.repeat(this.hull)}${'○'.repeat(HULL_MAX - this.hull)} (${Math.min(this.hull, JACKETS)} life jackets)`);
      if (this.leaking) status.push(`Air ${'▮'.repeat(Math.round(this.air * 10))}${'▯'.repeat(10 - Math.round(this.air * 10))}`);
      status.push(`Far shore ${Math.round(left)} m · about ${clock(left / CRUISE)}`);
    }
    if (this.ending !== null) prompt = null;
    return {
      title: `PRISON BREAK · ${this.stageTitle()}${squad && this.stage !== 'raft' ? ` · SQUAD ${this.followers.standing}${this.followers.isHolding ? ' (HOLDING)' : ''}` : ''}`,
      objectives: this.objectives(),
      prompt,
      downFor: down,
      jam: this.jamTank,
      onRaft: this.stage === 'raft',
      stealth: this.stealthMeter(),
      status,
    };
  }

  private shoreSince = 0;

  private stageTitle(): string {
    switch (this.stage) {
      case 'out':
        return 'THE GEAR';
      case 'raft':
        return 'ACROSS THE SEA';
      case 'shore':
        return 'THE WALK HOME';
      default:
        return 'THE ESCAPE';
    }
  }

  /** Where the gold arrow points: the nearest gear, then the sea gate, the jetty, the far shore, and home. */
  private waypoint(): HUDState['waypoint'] {
    if (this.intro !== null || this.ending !== null || this.hud.paused || this.climbing) return null;
    const layout = this.facility.layout;
    const p = this.player.position;
    if (this.stage === 'out') {
      if (!this.gear.complete) {
        const at = this.gear.nearest(p);
        return at && at.distanceTo(p) > 7 ? this.waypointTo(at.setY(at.y + 1.5), 'ESCAPE GEAR') : null;
      }
      if (!this.seaGate.opened) return this.waypointTo(this.seaGate.position.setY(3.2), 'SEA GATE');
      return this.waypointTo(new THREE.Vector3(layout.launch.x, 3, layout.launch.z), 'JETTY');
    }
    if (this.stage === 'raft' && this.raftPhase === 'sailing') {
      const left = Math.max(0, this.raft.position.z - (SHORE.waterZ + BEACH_REACH));
      return this.waypointTo(new THREE.Vector3(this.raft.position.x * 0.5, 14, SHORE.waterZ), `FAR SHORE ${Math.round(left)} m`);
    }
    if (this.stage === 'shore') {
      const home = SHORE.home;
      return this.waypointTo(new THREE.Vector3(home.x, 6, home.z + 66), `HOME ${Math.round(Math.hypot(p.x - home.x, p.z - home.z))} m`);
    }
    return null;
  }

  /** The checklist for each part of the level. */
  private objectives(): { label: string; done: boolean }[] {
    const names = this.settings.buddyNames;
    const stage = ['cell', 'pipechase', 'roof', 'out', 'raft', 'shore'].indexOf(this.stage);
    if (stage < 3) {
      const ventBuddies = this.facility.layout.vents.filter((v) => v.cell !== 0).map((v) => v.cell);
      const out = ventBuddies.filter((c) => this.cells.all[c].vented).length;
      const who = ventBuddies.map((c) => names[BUDDY_CELLS[c]]).join(' and ');
      return [
        { label: 'Out through the loose vent at the back of your cell', done: stage > 0 },
        { label: `Let ${who} out through their vents (${out} / ${ventBuddies.length})`, done: out === ventBuddies.length },
        { label: 'Climb the pipes up to the roof', done: stage > 1 },
        { label: 'Across the roof without being spotted, and down the bakery pipe', done: stage > 2 },
      ];
    }
    if (this.stage === 'out') {
      const lines = (Object.keys(GEAR_INFO) as (keyof typeof GEAR_INFO)[]).map((id) => ({ label: `${GEAR_INFO[id].name} (${GEAR_INFO[id].what})`, done: this.gear.has(id) }));
      return [
        ...lines,
        { label: 'Shoot the padlock on the sea gate', done: this.seaGate.opened },
        { label: 'Launch the raft from the end of the jetty', done: false },
      ];
    }
    if (this.stage === 'raft') {
      return [
        { label: 'Launch the raft', done: true },
        { label: 'Cross the sea without being caught by the search helicopters', done: false },
        { label: "Land and sneak home to Cooper's Base", done: false },
      ];
    }
    return [
      { label: 'Make landfall', done: true },
      { label: `Sneak past the patrols to Cooper's Base (${Math.round(Math.hypot(this.player.position.x - SHORE.home.x, this.player.position.z - SHORE.home.z))} m)`, done: false },
    ];
  }

  /** A marker over `point` on screen, or pinned to the edge pointing at it (as in the main game). */
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

  private hudState(input: InputState): HUDState {
    const viewport = this.playerViewport(this.player === this.player2 ? 2 : 1);
    return {
      zombies: null,
      health: this.stage === 'raft' ? this.hull : this.player.health,
      maxHealth: this.stage === 'raft' ? HULL_MAX : MAX_HEALTH,
      reloadFraction: 0,
      damageBoost: 0,
      ride: null,
      cameraMode: this.stage === 'raft' ? 'third' : this.cam.mode,
      usingGamepad: input.usingGamepad,
      insideBase: null,
      map: NO_MAP,
      aimScreen: this.hud.paused || this.ending !== null || this.stage === 'raft' || this.intro !== null ? null : { x: viewport.width / 2, y: viewport.height / 2 },
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
      cinematic: this.intro !== null,
      cinematicLabel: '',
      waypoint: this.hud.paused ? null : this.waypoint(),
      enemyBasesLeft: 0,
      enemyBasesTotal: 0,
      nearbyBase: null,
      airSupport: null,
      tanker: null,
      prison: this.prisonHUD(),
      driveStyle: this.settings.driveStyle,
      mouseCaptureHint: !input.usingGamepad && !input.pointerLocked && input.pointerLockAvailable,
      soundLocked: this.sound.locked && (this.settings.sfxVolume > 0 || this.settings.musicVolume > 0),
    };
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate);
    if (!this.ready) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.input.textEntry = this.hud.editingText;
    this.input.beginFrame();
    const p2Index = this.player2 ? this.settings.player2Controller : -3;
    const p2KeyboardFirst = this.player2 !== null && p2Index === -1;
    const pads = Array.from(navigator.getGamepads?.() ?? []);
    const p1Index = this.settings.player1Controller !== -2
      ? this.settings.player1Controller
      : this.player2
        ? pads.find((pad) => pad && pad.index !== p2Index)?.index ?? -1
        : -2;
    const lockedMousePlayer: 1 | 2 = this.player2 && p2Index === -1 ? 2 : 1;
    const p2Raw = this.player2 && p2KeyboardFirst
      ? this.input.update(dt, p2Index, 2, this.settings.splitOrientation, false, pads, lockedMousePlayer)
      : null;
    const input = this.input.update(dt, p1Index, 1, this.settings.splitOrientation, this.player2 !== null && p2Index === -1, pads, lockedMousePlayer);
    const p2Input = p2Raw ?? (this.player2 ? this.input.update(dt, p2Index, 2, this.settings.splitOrientation, false, pads, lockedMousePlayer) : null);

    if (this.hud.paused) {
      this.sound.updateEngine(0, 'chopper', false);
      const menu = p2Input ? {
        up: input.menu.up || p2Input.menu.up, down: input.menu.down || p2Input.menu.down,
        left: input.menu.left || p2Input.menu.left, right: input.menu.right || p2Input.menu.right,
        confirm: input.menu.confirm || p2Input.menu.confirm, back: input.menu.back || p2Input.menu.back,
        options: input.menu.options || p2Input.menu.options,
      } : input.menu;
      this.hud.handleMenu(menu);
      if ((input.mapTogglePressed || p2Input?.mapTogglePressed) && this.hud.paused) this.hud.toggleBigMap();
      this.hud.update(this.hudState(input));
      this.updateSecondHUD(p2Input);
      if (!this.pausedRendered) {
        this.renderViews();
        this.pausedRendered = true;
      }
      return;
    }
    this.pausedRendered = false;
    if (this.intro !== null) this.updateIntro(p2Input ? {
      ...input,
      firing: input.firing || p2Input.firing,
      jamFiring: input.jamFiring || p2Input.jamFiring,
      moveX: input.moveX || p2Input.moveX,
      moveY: input.moveY || p2Input.moveY,
      throttle: input.throttle || p2Input.throttle,
      menu: { ...input.menu, confirm: input.menu.confirm || p2Input.menu.confirm, back: input.menu.back || p2Input.menu.back },
    } : input, dt);
    else this.step(input, dt, p2Input);
    if (this.player2 && this.intro !== null) {
      this.camera2.position.copy(this.camera.position);
      this.camera2.quaternion.copy(this.camera.quaternion);
    }
    this.sound.setListener(this.camera);
    this.hud.update(this.hudState(input));
    this.updateSecondHUD(p2Input);
    this.renderViews();
    this.hud.recordFrame();
  };

  /**
   * The opening flyover: in over the prison and down to the cellhouse, then into the cell. Any
   * button or key skips it. The world carries on underneath (the searchlights, the guards' beats).
   */
  private updateIntro(input: InputState, dt: number): void {
    const t = (this.intro = (this.intro ?? 0) + dt);
    const skip = input.firing || input.jamFiring || input.menu.confirm || input.menu.back || input.moveX !== 0 || input.moveY !== 0 || input.throttle !== 0;
    if (t >= INTRO_TIME || (skip && t > 0.3)) {
      this.intro = null;
      this.hud.setFade(0);
      this.hud.showBanner('BONUS: PRISON BREAK', "They've locked you up! It's night, and the vent at the back of your cell is loose...");
      return;
    }
    let i = 0;
    while (i < INTRO.length - 2 && t > INTRO[i + 1].at) i++;
    const a = INTRO[i];
    const b = INTRO[i + 1];
    const f = Math.min(1, (t - a.at) / (b.at - a.at));
    const e = f * f * (3 - 2 * f);
    const lerp = (u: [number, number, number], v: [number, number, number]) => new THREE.Vector3(u[0] + (v[0] - u[0]) * e, u[1] + (v[1] - u[1]) * e, u[2] + (v[2] - u[2]) * e);
    this.camera.position.copy(lerp(a.pos, b.pos));
    this.camera.lookAt(lerp(a.look, b.look));
    // Fade to black at the end, before it cuts to the cell.
    this.hud.setFade(t > INTRO_TIME - 0.8 ? (t - (INTRO_TIME - 0.8)) / 0.8 : 0, '#000000');
    this.time += dt;
    this.searchlights.update(dt, this.player.position, false);
    this.guards.update(dt, { player: null, sneaking: false, targets: [], sees: () => false, nav: null, sector: 'compound' });
    this.flag.update(dt, this.time);
    this.world.step();
    this.cones.update(this.camera.position, this.time, this.player2 ? this.camera2.position : undefined);
    this.updateAtmosphere(dt, this.player.position);
  }
}

const SEA_CENTER_PRISON = new THREE.Vector3(0, SEA_LEVEL, -520);
const SEA_CENTER_SHORE = new THREE.Vector3(0, SEA_LEVEL, SHORE.waterZ - 20);
const LAUNCH_REACH = 3;
/** The mist's colour by moonlight (by day it takes the fog's). */
const MIST_NIGHT = new THREE.Color(0x8296b8);

/** Who's in each cell: just Keston and Max, each behind a vent of his own. */
function prisonerSpots(layout: FacilityLayout): PrisonerSpot[] {
  const spots: PrisonerSpot[] = [];
  layout.cells.forEach((cell, i) => {
    const doorX = (cell.doorX0 + cell.doorX1) / 2;
    const exits = [new THREE.Vector2(doorX, cell.frontZ + 0.9), new THREE.Vector2(doorX, cell.frontZ - 1.6)];
    // Out through the vent at the back instead, into the pipe chase.
    const vent = layout.vents.find((v) => v.cell === i);
    const ventX = vent ? (vent.x0 + vent.x1) / 2 : 0;
    const ventExits = vent ? [new THREE.Vector2(ventX, cell.backZ - 0.9), new THREE.Vector2(ventX, layout.pipeChaseCheckpoint.z)] : undefined;
    for (let j = 0; j < (CELL_PRISONERS[i] ?? 0); j++) {
      spots.push({
        x: cell.minX + 1.4 + j * 1.6,
        z: cell.frontZ + 2.6 + (j % 2) * 1.2,
        cell: i,
        kneel: (i + j) % 3 === 0,
        buddy: j === 0 && i in BUDDY_CELLS ? BUDDY_CELLS[i] : null,
        medic: false,
        exits,
        ventExits,
      });
    }
  });
  return spots;
}
