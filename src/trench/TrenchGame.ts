import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, createWorld } from '../physics/PhysicsWorld';
import { InputManager, type InputState } from '../input/InputManager';
import { HUD, type HUDState, type PrisonHUD } from '../ui/HUD';
import type { MapView } from '../ui/WorldMap';
import { Sound } from '../audio/Sound';
import { ImpactEffects } from '../combat/ImpactEffects';
import { AssetLibrary } from '../world/AssetLibrary';
import { loadSettings, saveSettings, AIM_SPEED_SCALE, GRAPHICS_QUALITY, type Settings } from '../core/Settings';
import { MISSION, MISSIONS, levelNumber, nextMission, startMission } from '../core/config';
import { PlayerSoldier, MAX_HEALTH } from '../prison/PlayerSoldier';
import { ShoulderCam } from '../prison/ShoulderCam';
import { FRIEND_SHOTS, ENEMY_SHOTS, WALLS_ONLY } from '../prison/groups';
import { ARMY_GREEN, ARMY_TAN, plastic } from '../utils/plastic';
import { tubeZ } from '../utils/modelKit';
import { Trooper } from '../jungle/Trooper';
import { Forest } from '../jungle/Forest';
import { Solids } from '../jungle/Props';
import { Explosives, type Blast } from '../jungle/Explosives';
import {
  X_HALF, PARAPET_Z, STEP_H, STEP_Z, FLOOR_Z, LADDERS, BREACHES, GUN, AID_POST, RESPAWN, AMMO_DUMP, DUGOUTS, MG_AT, SNIPER_RACK, OUR_GAPS, COMMS,
  GUN_PIVOT_Y, GUN_MUZZLE, SCENERY_HALF, SIDE_WALL, zoneOf, onStep, route, clearings, buildBattlefield, lineAt,
} from './Layout';
import { Troops, type Man, type Phase, type Front } from './Troops';
import { Medic, officerCap, fallenFigure } from './Figures';
import { Gas } from './Gas';

const SHADOW_HALF = 40;
/** The level after this one, started this many seconds after the victory screen. */
const NEXT = nextMission();
const VICTORY_DELAY = 12;
const SHOT_RANGE = 160;
const TRACER_TIME = 0.06;
/** What one of their rounds takes off the player (there's no healing here). */
const ENEMY_DAMAGE = 8;
/** Hit points: their riflemen, their officers, our men in the trench (and in the assault). */
const ENEMY_HP = 2;
const OFFICER_HP = 3;
const OFFICER_VS_TROOPS = 0.12;
const OUR_HP = 3;
/** Their officers out in their trenches: two in the front line and one in the support line (the other two are in the dugouts). */
const OFFICERS_IN_TRENCH = [
  { x: -31, line: 0 },
  { x: 35, line: 0 },
  { x: 14, line: 1 },
];
/** Their riflemen in the front, support and reserve lines. */
const ENEMY_LINES_MEN = [18, 10, 7];
const ENEMY_MEN = ENEMY_LINES_MEN.reduce((a, b) => a + b, 0) + OFFICERS_IN_TRENCH.length + DUGOUTS.length;
const OUR_LINE = 18;
/**
 * Both sides have a fixed number of men: nobody is replaced and nobody gets back up, so every man
 * of theirs who falls stays down, and the battle can always be won in the end. Ours are the line,
 * plus a reserve waiting behind the trench for the whistle (fifty in all).
 */
const OUR_RESERVE = 32;
/** The big gun: shells, how far it reaches, and how big a hole a shell makes. */
const SHELLS = 6;
const GUN_MIN = 70;
const GUN_MAX = 190;
const GUN_YAW = 0.42;
const SHELL_RADIUS = 5;
const ENEMY_SHELL_RADIUS = 6;
/** The weapons: seconds between shots and rounds to start with. */
const RIFLE_EVERY = 0.42;
const SNIPER_EVERY = 1.3;
const LEWIS_EVERY = 0.11;
const MG_EVERY = 0.085;
const RIFLE_START = 30;
const MG_BELT = 150;
const GRENADE_MAX = 6;
/** A gas attack this long after reaching the front line, and then every so often. */
const GAS_FIRST = 38;
const GAS_EVERY = 105;
/** Damage per second breathing gas. */
const GAS_HURT = 6;
/** The camera's field of view through the sniper scope, and normally. */
const SCOPE_FOV = 14;
const FOV = 70;
const USE_REACH = 1.8;
/** The covering barrage on their trench when the whistle goes: this long, this many shells. */
const BARRAGE_TIME = 11;
const BARRAGE_SHELLS = 8;
const TITLE = 'TRENCH JUNGLE';

const CONTROLS =
  '<span><b>Move</b> left stick · W A S D</span><span><b>Aim</b> right stick · mouse</span>' +
  '<span><b>Fire</b> RT · click</span><span><b>Climb onto / off the fire step, use the big gun, the machine gun or a ladder</b> A · G</span>' +
  '<span><b>Sniper scope</b> (on the fire step, with a sniper rifle) B · V</span><span><b>Gas mask on / off</b> X</span>' +
  '<span><b>Throw a grenade</b> LB · F · right click</span><span><b>Creep</b> RB · Shift</span><span><b>Camera</b> Y · C</span>';

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

type PickupKind = 'ammo' | 'grenades' | 'sniperAmmo' | 'lewis' | 'mask' | 'sniper';
interface Pickup {
  kind: PickupKind;
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
}

interface Shell {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  ours: boolean;
  whistled: boolean;
}

const PICKUP_TEXT: Record<PickupKind, string> = {
  ammo: '+15 RIFLE ROUNDS',
  grenades: '+2 GRENADES',
  sniperAmmo: '+5 SNIPER ROUNDS',
  lewis: 'A LEWIS GUN! (+47 ROUNDS)',
  mask: 'GAS MASK: PRESS X TO PUT IT ON',
  sniper: 'SNIPER RIFLE! ON THE FIRE STEP, PRESS B (V) FOR THE SCOPE',
};
const PICKUP_COLOR: Record<PickupKind, number> = { ammo: 0xc9a24a, grenades: 0x4d5a2e, sniperAmmo: 0x8fd3ff, lewis: 0xff9a5a, mask: 0x9be27a, sniper: 0x8fd3ff };

/**
 * The new trench level (on trial: only on the level select). Our trench line in the jungle faces
 * theirs across no man's land. Start at the big gun at the back for a few shells into their
 * trench, go up to the front line and shoot from the fire step (rifle, a sniper rifle with a scope,
 * the machine gun), put a gas mask on when they gas us, stock up at the ammo dump, then blow the
 * whistle at a ladder: fifty of ours go over the top, the grenade throwers lob grenades into their
 * trench and everyone storms in through the breaches. Take out their five officers (red-banded
 * caps) to win. Harder than the other levels: no healing, and when you're hit too often you wake
 * at the aid post by the gun and have to make your way back.
 */
export class TrenchGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private readonly camera2: THREE.PerspectiveCamera;
  private readonly input: InputManager;
  private hud: HUD;
  private primaryHud!: HUD;
  private readonly hud2: HUD;
  private readonly sound = new Sound(MISSION);
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly fog: THREE.Fog;
  private readonly clock = new THREE.Clock();
  private readonly loadingLabel: HTMLDivElement;
  private readonly scopeOverlay: HTMLDivElement;
  private readonly maskOverlay: HTMLDivElement;
  private readonly gasTint: HTMLDivElement;
  private readonly hurtFlash: HTMLDivElement;
  private settings: Settings = loadSettings();
  private ready = false;
  private pausedRendered = false;
  private world!: RAPIER.World;
  private impacts!: ImpactEffects;
  private explosives!: Explosives;
  private forest!: Forest;
  private gas!: Gas;
  private player!: PlayerSoldier;
  private player2: PlayerSoldier | null = null;
  private cam!: ShoulderCam;
  private cam2!: ShoulderCam;
  private gunModel!: THREE.Group;
  private gunBarrel!: THREE.Object3D;
  /** The barrel's slide back on firing (1 just fired, easing back to 0). */
  private gunRecoil!: THREE.Object3D;
  private gunKick = 0;
  private readonly troops = new Troops();
  private readonly byHandle = new Map<number, Man>();
  private readonly medics: Medic[] = [];
  /** Our fallen the trench medic has already seen to. */
  private readonly tended = new Set<Man>();
  private trenchMedic!: Medic;
  private readonly pickups: Pickup[] = [];
  private readonly shells: Shell[] = [];
  private readonly tracers: { line: THREE.Line; age: number }[] = [];
  private readonly friendTracer = new THREE.LineBasicMaterial({ color: 0xffe7a0, transparent: true });
  private readonly enemyTracer = new THREE.LineBasicMaterial({ color: 0xff9a5a, transparent: true });
  private readonly shellMesh = new THREE.SphereGeometry(0.18, 8, 6);
  private readonly shellMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
  private aimMarker!: THREE.Mesh;
  private front!: Front;

  private phase: Phase = 'artillery';
  private time = 0;
  private phaseTime = 0;
  /** What he's using: nothing (on foot), the big gun or the machine gun. */
  private manning: 'gun' | 'mg' | null = null;
  private manning2: 'gun' | 'mg' | null = null;
  private gunOwner: PlayerSoldier | null = null;
  private mgOwner: PlayerSoldier | null = null;
  private scoped = false;
  private scoped2 = false;
  private gunShells = SHELLS;
  private gunYaw = 0;
  private gunRange = 136;
  private mgBelt = MG_BELT;
  private rifle = RIFLE_START;
  private sniper = 0;
  private hasSniper = false;
  private lewis = 0;
  private grenades = 2;
  private hasMask = false;
  private maskOn = false;
  private maskOn2 = false;
  private resupplied = false;
  private reachedFront = false;
  private cooldown = 0;
  private cooldown2 = 0;
  private officersDown = 0;
  private enemiesDown = 0;
  private wakeUps = 0;
  private nextGas = Infinity;
  private gasWarned = false;
  private nextEnemyShell = 18;
  private barrageLeft = 0;
  private nextDistantShell = 3;
  private nextBarrage = 0;
  private hurtFlashLevel = 0;
  private cough = 0;
  private gasWasOn = false;
  private victoryAt: number | null = null;
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

    // Screen overlays (under the HUD): the sniper scope, the gas mask's eyepieces, the gas itself, being hit.
    const overlay = (css: string) => {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute; inset:0; pointer-events:none; display:none; ${css}`;
      container.appendChild(d);
      return d;
    };
    this.gasTint = overlay('background:rgba(176,196,64,0.3);');
    this.hurtFlash = overlay('background:radial-gradient(ellipse at center, rgba(160,0,0,0) 45%, rgba(170,0,0,0.75) 100%);');
    this.scopeOverlay = overlay(
      'background:radial-gradient(circle at center, rgba(0,0,0,0) 0, rgba(0,0,0,0) 33vmin, #000 33.6vmin);',
    );
    this.scopeOverlay.innerHTML =
      '<div style="position:absolute; left:50%; top:calc(50% - 33vmin); width:2px; height:66vmin; margin-left:-1px; background:rgba(0,0,0,0.85)"></div>' +
      '<div style="position:absolute; top:50%; left:calc(50% - 33vmin); height:2px; width:66vmin; margin-top:-1px; background:rgba(0,0,0,0.85)"></div>' +
      '<div style="position:absolute; left:50%; top:50%; width:6px; height:6px; margin:-3px 0 0 -3px; border-radius:50%; background:#d8261c"></div>';
    this.maskOverlay = overlay('');
    this.maskOverlay.innerHTML =
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%; height:100%">' +
      '<path fill="rgba(22,26,16,0.94)" fill-rule="evenodd" d="M0 0H100V100H0Z M18 48 a15 22 0 1 0 30 0 a15 22 0 1 0 -30 0Z M52 48 a15 22 0 1 0 30 0 a15 22 0 1 0 -30 0Z"/>' +
      '<ellipse cx="33" cy="48" rx="15" ry="22" fill="rgba(140,160,110,0.12)" stroke="#4b4636" stroke-width="1.2"/>' +
      '<ellipse cx="67" cy="48" rx="15" ry="22" fill="rgba(140,160,110,0.12)" stroke="#4b4636" stroke-width="1.2"/>' +
      '</svg>';

    this.camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 700);
    this.camera2 = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 700);
    this.input = new InputManager(this.renderer.domElement);
    // A is for climbing and using things here; the right trigger fires.
    this.input.padAFires = false;
    this.hud = new HUD(container);
    this.primaryHud = this.hud;
    this.hud2 = new HUD(container, true);
    this.hud.setMirror(this.hud2);
    this.hud2.setActive(false);
    this.hud.setSoundHook((kind) => this.sound.play(kind === 'move' ? 'uiMove' : kind === 'change' ? 'uiChange' : kind === 'back' ? 'uiBack' : kind === 'open' ? 'uiOpen' : 'uiConfirm', { volume: 0.5, minGap: 0 }));

    this.loadingLabel = document.createElement('div');
    this.loadingLabel.style.cssText =
      'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;' +
      "font-size:22px; background:#0a0e14; color:#e8eef5; font-family:'Segoe UI',system-ui,sans-serif; z-index:10;";
    this.loadingLabel.textContent = 'Loading the trenches…';
    container.appendChild(this.loadingLabel);

    // An overcast day: grey-green light and a long, murky view across no man's land.
    this.fog = new THREE.Fog(0xa3ad98, 50, 320);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0xa3ad98);
    this.hemi = new THREE.HemisphereLight(0xdfe6d6, 0x3a3524, 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xf2ead8, 1.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(graphics.shadowSize || 1024, graphics.shadowSize || 1024);
    const sh = this.sun.shadow.camera;
    sh.left = sh.bottom = -SHADOW_HALF;
    sh.right = sh.top = SHADOW_HALF;
    sh.far = 170;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.onResize());
    void this.init();
  }

  private async init(): Promise<void> {
    await initPhysics();
    this.world = createWorld();
    this.impacts = new ImpactEffects(this.scene);
    this.explosives = new Explosives(this.scene, this.world);
    const assets = new AssetLibrary();
    await assets.load((n, total) => (this.loadingLabel.textContent = `Loading the trenches… ${n}/${total}`), ['jungleTree', 'undergrowth']);
    const solids = new Solids(this.world);
    const built = buildBattlefield(this.scene, solids, ARMY_GREEN, ARMY_TAN);
    this.gunModel = built.gun;
    this.gunBarrel = built.barrel;
    this.gunRecoil = built.recoil;
    this.forest = new Forest(this.world, this.scene, assets, SCENERY_HALF + 10, clearings(), 19141918);
    Trooper.route = route;
    this.gas = new Gas(this.scene);

    // Where the gun's aimed: a red ring on the ground with a beam standing up out of it.
    const red = new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.85, depthTest: false, fog: false });
    this.aimMarker = new THREE.Mesh(new THREE.RingGeometry(SHELL_RADIUS - 0.8, SHELL_RADIUS, 32).rotateX(-Math.PI / 2), red);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 14, 8).translate(0, 7, 0), new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
    this.aimMarker.add(beam);
    this.aimMarker.renderOrder = 10;
    this.aimMarker.visible = false;
    this.scene.add(this.aimMarker);

    // The player starts by the big gun.
    this.player = new PlayerSoldier(this.world, RESPAWN.x, RESPAWN.z, RESPAWN.yaw);
    this.player.regenerates = false;
    this.scene.add(this.player.root);
    this.cam = new ShoulderCam(this.camera, this.world);
    this.player2 = this.settings.player2Controller === -2 ? null : new PlayerSoldier(this.world, RESPAWN.x + 1.8, RESPAWN.z, RESPAWN.yaw);
    if (this.player2) {
      this.player2.regenerates = false;
      this.scene.add(this.player2.root);
      this.cam2 = new ShoulderCam(this.camera2, this.world);
    }

    // Their three lines, their officers (three in the trenches, one in each dugout) and their medics.
    // Nobody stands on the step where it's broken by a breach or a communication trench.
    for (const [line, count] of ENEMY_LINES_MEN.entries()) {
      const gaps = line === 0 ? BREACHES : COMMS.filter((c) => c.zone === 2 + line * 2).map((c) => c.pts[c.pts.length - 1].x);
      for (let i = 0; i < count; i++) {
        let x = -X_HALF + 4 + ((i + 0.5) / count) * (X_HALF * 2 - 8) + (Math.random() - 0.5) * 2;
        for (const b of gaps) if (Math.abs(x - b) < 3) x = b + Math.sign(x - b || 1) * 3;
        this.addMan('enemy', 'line', x, ENEMY_HP, '', undefined, undefined, line);
      }
    }
    for (const o of OFFICERS_IN_TRENCH) this.addOfficer(o.x, undefined, o.line);
    for (const d of DUGOUTS) this.addOfficer(d.at.x, new THREE.Vector3(d.at.x + (Math.random() - 0.5) * 2, 0, d.at.z - 0.2));
    for (const x of [-26, 28]) this.addMedic(ARMY_TAN, x, -FLOOR_Z, 28);
    // Ours: the squad (by name) in the middle, the rest of the garrison along the line.
    const names = this.settings.buddyNames;
    for (let i = 0; i < OUR_LINE; i++) {
      const x = i < 4 ? -9 + i * 6 : -X_HALF + 6 + ((i - 4) / (OUR_LINE - 5)) * (X_HALF * 2 - 12);
      const avoid = [MG_AT.x, SNIPER_RACK.x, ...LADDERS];
      let px = x;
      for (const a of avoid) if (Math.abs(px - a) < 2) px = a + 2.2;
      this.addMan('friend', 'line', px, OUR_HP, i < 4 ? names[i] ?? `Buddy ${i + 1}` : '');
    }
    // The reserve, kneeling in two blocks behind the parados (either side of the path in from the middle gap, and behind the left-hand gap).
    const spots: THREE.Vector3[] = [];
    for (let row = 0; row < 5; row++) {
      for (const x of [-7.5, -5.5, 5.5, 7.5]) spots.push(new THREE.Vector3(x, 0, 42.6 + row * 1.6));
      for (const x of [-43, -41, -39, -37]) spots.push(new THREE.Vector3(x, 0, 42.6 + row * 1.6));
    }
    for (const at of spots.slice(0, OUR_RESERVE)) this.addMan('friend', 'line', at.x, OUR_HP, '', undefined, at);
    this.trenchMedic = this.addMedic(ARMY_GREEN, -6, FLOOR_Z, 60);
    for (const dx of [-2.2, 2.2]) this.addMedic(ARMY_GREEN, AID_POST.x + dx, AID_POST.z - 3, 3);

    // A fallen man just inside the trench by the middle gap, with his gas mask and ammunition.
    const gapX = OUR_GAPS[1];
    this.scene.add(fallenFigure(ARMY_GREEN, gapX + 2.2, FLOOR_Z + 0.4, 1.2));
    this.addPickup('mask', new THREE.Vector3(gapX + 1.6, 0, FLOOR_Z + 0.2));
    this.addPickup('ammo', new THREE.Vector3(gapX + 3.1, 0, FLOOR_Z + 0.5));
    this.addPickup('sniper', SNIPER_RACK.clone().setY(0));
    // A spare grenade box at the gun.
    this.addPickup('grenades', new THREE.Vector3(GUN.x - 3.5, 0, GUN.z + 3));

    this.front = this.makeFront();
    this.hud.setOnFoot(CONTROLS);
    this.hud2.setOnFoot(CONTROLS);
    this.hud.setCoopLayout(!!this.player2);
    this.hud2.setActive(!!this.player2);
    this.hud.setSettings(this.settings, (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    });
    this.applySettings();
    this.hud.setMissionStart((m) => startMission(m));
    void this.sound.load();
    this.world.step();

    this.loadingLabel.remove();
    this.ready = true;
    this.sound.music.start();
    this.clock.start();
    this.hud.showBanner('TRENCH JUNGLE', 'Start at the big gun: walk up to it and press A (G on the keyboard) to fire a few shells into their trench');
    if (import.meta.env.DEV) (window as unknown as { trench: TrenchGame }).trench = this;
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
      this.player2.regenerates = false;
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
    const player = this.player, camera = this.camera, cam = this.cam;
    const manning = this.manning, scoped = this.scoped, maskOn = this.maskOn, hud = this.hud;
    const cooldown = this.cooldown;
    const phaseBefore = this.phase;
    this.player = this.player2; this.camera = this.camera2; this.cam = this.cam2;
    this.manning = this.manning2; this.scoped = this.scoped2; this.maskOn = this.maskOn2; this.hud = this.hud2;
    this.cooldown = this.cooldown2;
    try { return run(); }
    finally {
      this.manning2 = this.manning; this.scoped2 = this.scoped; this.maskOn2 = this.maskOn;
      this.cooldown2 = this.cooldown;
      this.player = player; this.camera = camera; this.cam = cam;
      this.manning = manning; this.scoped = scoped; this.maskOn = maskOn; this.hud = hud;
      this.cooldown = cooldown;
      if (phaseBefore !== 'assault' && this.phase === 'assault') {
        this.manning = this.manning2 = null;
        this.scoped = this.scoped2 = false;
        this.gunOwner = this.mgOwner = null;
      }
    }
  }

  private onResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.hud.setViewport({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    this.pausedRendered = false;
  }

  // ---------- people ----------

  private addMan(side: 'friend' | 'enemy', role: 'line' | 'officer', x: number, hp: number, name = '', dugout?: THREE.Vector3, reserve?: THREE.Vector3, line = 0): Man {
    const z = (side === 'friend' ? 1 : -1) * (lineAt(line).step + 1.15);
    const at = reserve ?? dugout;
    const t = new Trooper(this.world, at ? at.x : x, at ? at.z : z, side, side === 'friend' ? ARMY_GREEN : ARMY_TAN, hp, name);
    this.scene.add(t.root);
    const m = this.troops.add(t, role, x, dugout, !!reserve, line);
    this.byHandle.set(t.collider.handle, m);
    if (dugout) t.yaw = 0;
    return m;
  }

  private addOfficer(x: number, dugout?: THREE.Vector3, line = 0): void {
    const m = this.addMan('enemy', 'officer', x, OFFICER_HP, '', dugout, undefined, line);
    m.t.extras.add(officerCap(ARMY_TAN));
  }

  private addMedic(color: number, x: number, z: number, span: number): Medic {
    const m = new Medic(color, x, z, new THREE.Vector3(x, 0, z), span);
    this.scene.add(m.root);
    this.medics.push(m);
    return m;
  }

  private makeFront(): Front {
    const game = this;
    const chest = new THREE.Vector3();
    return {
      get phase() {
        return game.phase;
      },
      get barrage() {
        return game.phase === 'assault' && game.phaseTime < BARRAGE_TIME;
      },
      sees: (a, b) => this.sees(a, b),
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
      },
      get players() {
        return game.player2 ? [game.player, game.player2].map((soldier) => ({
          pos: soldier.position,
          chest: soldier.position.clone().setY(soldier.position.y + 1.15),
          down: soldier.isDown,
        })) : undefined;
      },
      fireAt: (shooter, aim, spread) => this.troopFire(shooter, aim, spread),
      throwGrenade: (from, at) => this.lob(from, at),
    };
  }

  /** Something has knocked a soldier down: drops what he carried, and counts officers. */
  private hurtMan(m: Man, n: number): void {
    if (!m.t.hurt(n)) return;
    if (m.t.side === 'enemy') {
      this.enemiesDown++;
      if (m.role === 'officer') this.onOfficerDown();
    }
    this.dropFrom(m.t.pos);
  }

  private onOfficerDown(): void {
    this.officersDown++;
    const left = 5 - this.officersDown;
    this.sound.music.stinger();
    if (left > 0) {
      this.announceCallout(`OFFICER DOWN! ${left} TO GO`, '#ffd24a');
      return;
    }
    this.phase = 'won';
    this.victoryAt = this.time;
    this.announceVictory("Their trench is ours! All five of their officers are down.", NEXT ? '' : 'Pick another level from the pause menu (Start / M)');
    this.sound.music.fanfare();
    this.scoped = false;
    this.releaseMountedWeapon();
    this.manning = null;
  }

  // ---------- shooting ----------

  /** A clear line (walls, sandbags and trunks block it; people don't). */
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

  /** One round from `from` along `dir`: what it hits, tracer and all. */
  private resolveRound(from: THREE.Vector3, dir: THREE.Vector3, side: 'friend' | 'enemy', damage: number, byPlayer = false): void {
    const hit = this.world.castRay(new RAPIER.Ray(from, dir), SHOT_RANGE, true, undefined, side === 'friend' ? FRIEND_SHOTS : ENEMY_SHOTS);
    const end = from.clone().addScaledVector(dir, hit ? hit.timeOfImpact : 80);
    this.addTracer(from, end, side === 'friend' ? this.friendTracer : this.enemyTracer);
    if (!hit) return;
    this.impacts.dustPuff(end);
    const handle = hit.collider.handle;
    if (side === 'enemy' && (handle === this.player.collider.handle || handle === this.player2?.collider.handle)) {
      const target = handle === this.player.collider.handle ? this.player : this.player2!;
      if (target === this.player) this.hitPlayer(ENEMY_DAMAGE);
      else this.withPlayer2(() => this.hitPlayer(ENEMY_DAMAGE));
      return;
    }
    const m = this.byHandle.get(handle);
    // Their officers are tough: our men's rounds do them an eighth of the harm the player's do.
    if (!m || m.t.side === side || m.t.down) return;
    this.hurtMan(m, m.role === 'officer' && !byPlayer ? damage * OFFICER_VS_TROOPS : damage);
    if (side === 'friend' && m.t.down) this.sound.play('thud', { at: end, volume: 0.5, rate: 1.2, minGap: 0.05 });
  }

  private hitPlayer(amount: number): void {
    if (this.player.isDown || this.phase === 'won') return;
    this.player.takeDamage(amount);
    this.cam.addShake(0.22);
    this.hurtFlashLevel = Math.min(1, this.hurtFlashLevel + 0.45);
    this.sound.play('thud', { volume: 0.45, rate: 1.6, minGap: 0.1 });
    if (this.player.isDown) {
      this.releaseMountedWeapon();
      this.scoped = false;
      this.manning = null;
      this.hud.showCallout("YOU'RE HIT! THE STRETCHER BEARERS ARE CARRYING YOU BACK…", '#ff8a7a');
    }
  }

  private releaseMountedWeapon(): void {
    if (this.gunOwner === this.player) this.gunOwner = null;
    if (this.mgOwner === this.player) this.mgOwner = null;
  }

  private announceCallout(text: string, color: string): void {
    this.primaryHud.showCallout(text, color);
    if (this.hud !== this.primaryHud) this.hud.showCallout(text, color);
  }

  private announceBanner(title: string, subtitle: string): void {
    this.primaryHud.showBanner(title, subtitle);
    if (this.hud !== this.primaryHud) this.hud.showBanner(title, subtitle);
  }

  private announceVictory(message: string, footer: string): void {
    this.primaryHud.showVictory(message, footer);
    if (this.hud !== this.primaryHud) this.hud.showVictory(message, footer);
  }

  /** A soldier fires at `aim`, with scatter. */
  private troopFire(shooter: Trooper, aim: THREE.Vector3, spread: number): void {
    const fwd = new THREE.Vector3(-Math.sin(shooter.yaw), 0, -Math.cos(shooter.yaw));
    const from = shooter.pos.clone().setY(shooter.pos.y + 1.45).addScaledVector(fwd, 0.7);
    const dir = aim.clone().sub(from).normalize();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    this.impacts.muzzleFlash(from, dir, 0.25);
    this.sound.play('crack', { at: from, volume: 0.2, rate: shooter.side === 'friend' ? 2.1 : 1.8, minGap: 0.04 });
    this.resolveRound(from, dir, shooter.side, 1);
  }

  /** The player's weapon (whichever he's on) when the trigger's held. */
  private updateFiring(input: InputState, dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!input.firing || this.cooldown > 0 || this.player.isDown || this.phase === 'won') return;
    if (this.manning === 'gun') {
      this.fireGun();
      return;
    }
    let damage = 1;
    let spread = 0;
    let from = this.player.muzzle();
    if (this.manning === 'mg') {
      if (this.mgBelt <= 0) return this.empty('THE MACHINE GUN BELT IS EMPTY');
      this.mgBelt--;
      this.cooldown = MG_EVERY;
      spread = 0.012;
      from = MG_AT.clone().add(new THREE.Vector3(0, 1.08, -1.15));
      this.sound.play('crack', { volume: 0.3, rate: 2.6, minGap: 0.03 });
      this.cam.addShake(0.05);
    } else if (this.scoped) {
      if (this.sniper <= 0) return this.empty('OUT OF SNIPER ROUNDS');
      this.sniper--;
      this.cooldown = SNIPER_EVERY;
      damage = 5;
      from = this.camera.getWorldPosition(new THREE.Vector3());
      this.sound.play('crack', { volume: 0.4, rate: 1.4, minGap: 0.05 });
      this.cam.addShake(0.12);
    } else if (this.lewis > 0) {
      this.lewis--;
      this.cooldown = LEWIS_EVERY;
      spread = 0.014;
      this.sound.play('crack', { volume: 0.28, rate: 2.5, minGap: 0.03 });
      this.cam.addShake(0.05);
      if (this.lewis === 0) this.hud.showCallout('THE LEWIS GUN IS EMPTY: BACK TO THE RIFLE', '#ffd24a');
    } else {
      if (this.rifle <= 0) return this.empty('OUT OF RIFLE ROUNDS: TAKE SOME FROM THE FALLEN, OR THE AMMO DUMP');
      this.rifle--;
      this.cooldown = RIFLE_EVERY;
      this.sound.play('crack', { volume: 0.28, rate: 2.3, minGap: 0.05 });
      this.cam.addShake(0.07);
    }
    const dir = this.aimPoint().sub(from).normalize();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    if (!this.scoped) this.impacts.muzzleFlash(from, dir, 0.3);
    this.resolveRound(from, dir, 'friend', damage, true);
  }

  private empty(text: string): void {
    this.cooldown = 0.5;
    this.hud.showCallout(text, '#ff8a7a');
    this.sound.play('clang', { volume: 0.25, rate: 2.2, minGap: 0.3 });
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

  // ---------- grenades and shells ----------

  private throwGrenade(): void {
    if (this.player.isDown || this.manning || this.phase === 'won') return;
    if (this.grenades <= 0) {
      this.hud.showCallout('NO GRENADES: TAKE SOME FROM THE FALLEN, OR THE AMMO DUMP', '#ff8a7a');
      return;
    }
    this.grenades--;
    const from = this.player.position.clone().setY(this.player.position.y + 1.8).addScaledVector(this.player.forward(), 0.4);
    const dir = this.aimPoint().sub(from).normalize();
    dir.y += 0.35;
    this.explosives.launch(from, dir.normalize(), 17);
    this.sound.play('thud', { volume: 0.3, rate: 1.8, minGap: 0.2 });
  }

  /** One of ours lobs a grenade from `from` to land at `at` (about a second in the air). */
  private lob(from: THREE.Vector3, at: THREE.Vector3): void {
    const T = 1.15;
    const v = at.clone().sub(from).divideScalar(T);
    v.y += 0.5 * 15 * T;
    const speed = v.length();
    this.explosives.launch(from, v.divideScalar(speed), speed, false);
  }

  /** Who's in the open to a blast at `at` (behind a parapet you're safe). */
  private blastReaches(at: THREE.Vector3, rise: number, target: THREE.Vector3): boolean {
    return this.sees(new THREE.Vector3(at.x, at.y + rise, at.z), target);
  }

  /**
   * A grenade has gone off (all grenades are ours: they don't hurt our men, but they'll hurt you).
   * Only the player's own grenades can get an officer.
   */
  private onBlast(b: Blast): void {
    this.impacts.explode(b.at, 2);
    this.sound.play('cannon', { at: b.at, volume: 0.7, rate: 1.2 });
    for (const m of this.troops.enemies()) {
      if (m.t.down || (m.role === 'officer' && !b.byPlayer)) continue;
      const d = Math.hypot(m.t.pos.x - b.at.x, m.t.pos.z - b.at.z);
      if (d < b.radius && this.blastReaches(b.at, 1, m.t.chest())) this.hurtMan(m, d < b.radius * 0.45 ? 3 : 1);
    }
    const p = this.player.position;
    const dp = Math.hypot(p.x - b.at.x, p.z - b.at.z);
    if (dp < b.radius && this.blastReaches(b.at, 1, this.front.player.chest)) this.hitPlayer(45 * (1 - dp / b.radius));
    this.cam.addShake(0.35 * Math.min(1, 10 / Math.max(1, dp)));
    if (this.player2) {
      const p2 = this.player2.position;
      const d2 = Math.hypot(p2.x - b.at.x, p2.z - b.at.z);
      const chest2 = p2.clone().setY(p2.y + 1.15);
      if (d2 < b.radius && this.blastReaches(b.at, 1, chest2)) this.withPlayer2(() => this.hitPlayer(45 * (1 - d2 / b.radius)));
    }
  }

  private fireShell(from: THREE.Vector3, to: THREE.Vector3, ours: boolean, dur: number): void {
    const mesh = new THREE.Mesh(this.shellMesh, this.shellMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.shells.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur, ours, whistled: ours });
  }

  private updateShells(dt: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const h = s.from.distanceTo(s.to) * 0.22;
      s.mesh.position.lerpVectors(s.from, s.to, k).setY(s.from.y + (s.to.y - s.from.y) * k + 4 * h * k * (1 - k));
      // Theirs: you hear it coming.
      if (!s.whistled && s.dur - s.t < 1.3) {
        s.whistled = true;
        const d = s.to.distanceTo(this.player.position);
        this.whistle(1400, 420, 1.25, Math.max(0.08, 0.5 - d / 120));
      }
      if (k < 1) continue;
      this.scene.remove(s.mesh);
      this.shells.splice(i, 1);
      this.shellLands(s);
    }
  }

  /** A shell bursts. It doesn't touch the trees: it's the trenches they're aimed at. */
  private shellLands(s: Shell): void {
    const at = s.to;
    this.impacts.explode(at.clone().setY(0.6), 3.4);
    this.impacts.addSmokeSource(at.clone().setY(0.4), 1.2, 6);
    this.sound.play('boom', { at, volume: 1, rate: 0.85 });
    const dp = Math.hypot(this.player.position.x - at.x, this.player.position.z - at.z);
    this.cam.addShake(Math.min(0.9, 14 / Math.max(2, dp)));
    if (s.ours) {
      // Their officers are sheltering deep in the dugouts while the shells come over.
      for (const m of this.troops.enemies()) {
        if (m.t.down || m.role === 'officer') continue;
        const d = Math.hypot(m.t.pos.x - at.x, m.t.pos.z - at.z);
        if (d < SHELL_RADIUS && this.blastReaches(at, 2.5, m.t.chest())) this.hurtMan(m, 99);
      }
      return;
    }
    if (dp < ENEMY_SHELL_RADIUS && this.blastReaches(at, 2.5, this.front.player.chest)) this.hitPlayer(55 * (1 - dp / ENEMY_SHELL_RADIUS));
    if (this.player2) {
      const p2 = this.player2.position;
      const d2 = Math.hypot(p2.x - at.x, p2.z - at.z);
      const chest2 = p2.clone().setY(p2.y + 1.15);
      if (d2 < ENEMY_SHELL_RADIUS && this.blastReaches(at, 2.5, chest2)) this.withPlayer2(() => this.hitPlayer(55 * (1 - d2 / ENEMY_SHELL_RADIUS)));
    }
    for (const m of this.troops.friends()) {
      if (m.t.down) continue;
      const d = Math.hypot(m.t.pos.x - at.x, m.t.pos.z - at.z);
      if (d < ENEMY_SHELL_RADIUS * 0.6 && this.blastReaches(at, 2.5, m.t.chest())) this.hurtMan(m, 2);
    }
  }

  /** A falling tone (a shell coming over) or, with `trill`, an officer's whistle. */
  private whistle(f0: number, f1: number, seconds: number, volume: number, trill = false): void {
    const out = this.sound.synthOut();
    if (!out) return;
    const ctx = this.sound.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f1, now + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.06);
    gain.gain.setValueAtTime(volume, now + seconds - 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    if (trill) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 28;
      const depth = ctx.createGain();
      depth.gain.value = 180;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(now);
      lfo.stop(now + seconds);
    }
    osc.connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + seconds);
  }

  // ---------- the big gun ----------

  private gunTarget(): THREE.Vector3 {
    return new THREE.Vector3(GUN.x - Math.sin(this.gunYaw) * this.gunRange, 0, GUN.z - Math.cos(this.gunYaw) * this.gunRange);
  }

  private fireGun(): void {
    if (this.gunShells <= 0) return;
    this.gunShells--;
    this.cooldown = 1.6;
    const muzzle = new THREE.Vector3(0, 0, -GUN_MUZZLE).applyEuler(new THREE.Euler(this.gunBarrel.rotation.x, this.gunYaw, 0, 'YXZ')).add(GUN).setY(GUN_PIVOT_Y + GUN_MUZZLE * Math.sin(this.gunBarrel.rotation.x));
    this.gunKick = 1;
    const to = this.gunTarget().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5));
    this.fireShell(muzzle, to, true, 1.4 + this.gunRange / 80);
    this.impacts.muzzleFlash(muzzle, new THREE.Vector3(-Math.sin(this.gunYaw), 0.3, -Math.cos(this.gunYaw)), 2);
    this.impacts.addSmokeSource(muzzle, 0.6, 2);
    this.sound.play('cannon', { volume: 1, rate: 0.7 });
    this.cam.addShake(0.5);
    if (this.gunShells === 0) {
      this.releaseMountedWeapon();
      this.manning = null;
      this.announceBanner('OUT OF SHELLS', 'Head down the lane to the front line');
    } else this.hud.showCallout(`${this.gunShells} SHELL${this.gunShells === 1 ? '' : 'S'} LEFT`, '#ffd24a');
  }

  private aimGun(input: InputState): void {
    this.gunYaw = THREE.MathUtils.clamp(this.gunYaw - input.aimYawDelta * 0.4, -GUN_YAW, GUN_YAW);
    this.gunRange = THREE.MathUtils.clamp(this.gunRange - input.aimPitchDelta * 45 + input.moveY * 0.9, GUN_MIN, GUN_MAX);
    this.gunYaw = THREE.MathUtils.clamp(this.gunYaw - input.moveX * 0.012, -GUN_YAW, GUN_YAW);
    this.gunModel.rotation.y = this.gunYaw;
    this.gunBarrel.rotation.x = 0.12 + ((this.gunRange - GUN_MIN) / (GUN_MAX - GUN_MIN)) * 0.5;
    this.aimMarker.position.copy(this.gunTarget()).setY(0.15);
  }

  // ---------- pickups ----------

  private addPickup(kind: PickupKind, pos: THREE.Vector3): void {
    const g = new THREE.Group();
    if (kind === 'sniper') {
      // A long rifle with a scope, racked.
      const steel = plastic(0x2e3134);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.5), plastic(0x6b4528));
      stock.position.z = 0.45;
      const barrel = new THREE.Mesh(tubeZ(0.022, 0.022, 1.1), steel);
      const scope = new THREE.Mesh(tubeZ(0.04, 0.04, 0.4), steel);
      scope.position.set(0, 0.08, 0.15);
      g.add(stock, barrel, scope);
      g.rotation.y = Math.PI / 2;
      g.position.set(pos.x, STEP_H + 1.28, pos.z + 0.18);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.36), plastic(kind === 'mask' ? 0x5a6b3a : 0x7a5530));
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.38), new THREE.MeshBasicMaterial({ color: PICKUP_COLOR[kind] }));
      lid.position.y = 0.17;
      g.add(box, lid);
      g.position.set(pos.x, 0.2 + pos.y, pos.z);
    }
    this.scene.add(g);
    this.pickups.push({ kind, pos: pos.clone(), mesh: g });
  }

  /** A fallen soldier may leave something worth taking. */
  private dropFrom(at: THREE.Vector3): void {
    if (this.pickups.length > 40) return;
    const r = Math.random();
    let kind: PickupKind | null = null;
    if (!this.hasMask && !this.pickups.some((p) => p.kind === 'mask')) kind = 'mask';
    else if (r < 0.42) kind = 'ammo';
    else if (r < 0.58) kind = 'grenades';
    else if (r < 0.66) kind = this.hasSniper ? 'sniperAmmo' : 'sniper';
    else if (r < 0.74) kind = 'lewis';
    if (!kind) return;
    // On the ground beside him (even if he fell off a fire step).
    this.addPickup(kind === 'sniper' ? 'sniperAmmo' : kind, new THREE.Vector3(at.x + (Math.random() - 0.5) * 1.2, 0, at.z + (Math.random() - 0.5) * 0.6));
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const it = this.pickups[i];
      if (it.kind !== 'sniper') it.mesh.rotation.y += dt * 1.5;
      const reach = it.kind === 'sniper' ? 1.4 : 1.3;
      const collector = [this.player, this.player2].find((player) => {
        if (!player || player.isDown) return false;
        const p = player.position;
        return Math.hypot(p.x - it.pos.x, p.z - it.pos.z) <= reach
          && (it.kind !== 'sniper' || onStep(p.x, p.z, p.y) || Math.abs(p.z - STEP_Z) <= 1.6);
      });
      if (!collector) continue;
      switch (it.kind) {
        case 'ammo':
          this.rifle += 15;
          break;
        case 'grenades':
          this.grenades = Math.min(GRENADE_MAX, this.grenades + 2);
          break;
        case 'sniperAmmo':
          if (!this.hasSniper) this.hasSniper = true;
          this.sniper += 5;
          break;
        case 'lewis':
          this.lewis += 47;
          break;
        case 'mask':
          if (this.hasMask) continue;
          this.hasMask = true;
          break;
        case 'sniper':
          this.hasSniper = true;
          this.sniper += 10;
          break;
      }
      this.scene.remove(it.mesh);
      this.pickups.splice(i, 1);
      this.hud.showCallout(PICKUP_TEXT[it.kind], '#ffd24a');
      this.sound.play('uiConfirm', { volume: 0.6 });
    }
    // The ammo dump: walk in for a full load.
    if (!this.resupplied && [this.player, this.player2].some((player) => !!player && !player.isDown && Math.hypot(player.position.x - AMMO_DUMP.x, player.position.z - AMMO_DUMP.z) < 3.6)) {
      this.resupplied = true;
      this.rifle = Math.max(this.rifle, 120);
      this.grenades = GRENADE_MAX;
      this.lewis = Math.max(this.lewis, 97);
      if (this.hasSniper) this.sniper = Math.max(this.sniper, 10);
      if (!this.hasMask) this.hasMask = true;
      this.hud.showBanner('STOCKED UP!', 'Rifle rounds, a Lewis gun and a full bag of grenades. Now go to a ladder and press A (G) to blow the whistle');
      this.sound.play('uiConfirm', { volume: 0.8 });
    }
  }

  // ---------- the frame ----------

  /** Moves him without healing him (teleporting puts a soldier back at full health). */
  private hop(x: number, z: number, yaw: number, y = 0): void {
    const health = this.player.health;
    this.player.teleport(x, z, yaw, y);
    this.player.health = health;
  }

  /** Woken up at the aid post, patched up by the medics. */
  private wakeAtAidPost(): void {
    this.wakeUps++;
    this.player.teleport(RESPAWN.x, RESPAWN.z, RESPAWN.yaw);
    this.maskOn = false;
    this.scoped = false;
    this.releaseMountedWeapon();
    this.manning = null;
    for (const [i, m] of this.medics.filter((x) => x !== this.trenchMedic && x.home.z > 90).entries()) {
      m.pos.set(RESPAWN.x + (i ? 1.1 : -1.1), 0, RESPAWN.z + 0.8);
      m.goal = null;
      m.kneeling = 3;
    }
    this.hud.showBanner('PATCHED UP AT THE AID POST', this.phase === 'assault' ? 'Back to the front line, and over the top from a ladder (A / G)' : 'The medics have you on your feet again. Get back to the front line');
  }

  /** The A button: the gun, the machine gun, a ladder, or up onto (or down off) the fire step. */
  private use(): void {
    if (this.player.isDown || this.phase === 'won') return;
    const p = this.player.position;
    if (this.manning) {
      this.releaseMountedWeapon();
      this.manning = null;
      this.aimMarker.visible = false;
      return;
    }
    const breech = GUN.clone().add(new THREE.Vector3(Math.sin(this.gunYaw) * 1.6, 0, Math.cos(this.gunYaw) * 1.6));
    if (Math.hypot(p.x - breech.x, p.z - breech.z) < 3) {
      if (this.gunOwner && this.gunOwner !== this.player) {
        this.hud.showCallout('THE BIG GUN IS IN USE BY THE OTHER PLAYER', '#ffd24a');
        return;
      }
      if (this.gunShells <= 0) {
        this.hud.showCallout('NO SHELLS LEFT FOR THE BIG GUN', '#ff8a7a');
        return;
      }
      this.manning = 'gun';
      this.gunOwner = this.player;
      this.scoped = false;
      this.hud.showCallout('AIM WITH THE STICK OR MOUSE · FIRE WITH RT OR CLICK · A (G) TO LEAVE', '#ffd24a');
      return;
    }
    const zone = zoneOf(p.x, p.z);
    const step = onStep(p.x, p.z, p.y);
    if (step && Math.hypot(p.x - MG_AT.x, p.z - MG_AT.z) < USE_REACH) {
      if (this.mgOwner && this.mgOwner !== this.player) {
        this.hud.showCallout('THE MACHINE GUN IS IN USE BY THE OTHER PLAYER', '#ffd24a');
        return;
      }
      if (this.mgBelt <= 0) {
        this.hud.showCallout('THE MACHINE GUN IS OUT OF AMMUNITION', '#ff8a7a');
        return;
      }
      this.manning = 'mg';
      this.mgOwner = this.player;
      this.scoped = false;
      this.hop(MG_AT.x, STEP_Z + 0.25, 0, STEP_H);
      return;
    }
    if (zone === 1) {
      const ladder = LADDERS.find((x) => Math.abs(x - p.x) < 1.4);
      if (ladder !== undefined && p.z < 37.5) {
        if (this.phase === 'assault') {
          this.hop(ladder, PARAPET_Z - 4, 0); // far enough out that the camera's not stuck behind the parapet
          this.hud.showCallout('OVER THE TOP!', '#ffd24a');
          return;
        }
        if (!this.resupplied) {
          this.hud.showCallout('STOCK UP AT THE AMMO DUMP FIRST (THE DUGOUT BEHIND THE RIGHT-HAND GAP)', '#ffd24a');
          return;
        }
        this.startAssault(ladder);
        return;
      }
      if (step) {
        this.scoped = false;
        this.hop(p.x, STEP_Z + 1.4, this.player.yaw, 0);
        return;
      }
      if (p.z < STEP_Z + 2) {
        this.hop(p.x, STEP_Z, this.player.yaw, STEP_H);
        return;
      }
      this.hud.showCallout('GO RIGHT UP TO THE PARAPET TO CLIMB ONTO THE FIRE STEP', '#c9d3dc');
    }
  }

  private toggleScope(): void {
    if (this.player.isDown || this.manning) return;
    if (this.scoped) {
      this.scoped = false;
      return;
    }
    const p = this.player.position;
    if (!this.hasSniper) this.hud.showCallout('NO SNIPER RIFLE YET: THERE IS ONE ON A RACK ALONG THE FIRE STEP, LEFT OF THE MIDDLE', '#ffd24a');
    else if (!onStep(p.x, p.z, p.y)) this.hud.showCallout('GET UP ON THE FIRE STEP FIRST (A / G) TO USE THE SCOPE', '#ffd24a');
    else if (this.sniper <= 0) this.hud.showCallout('OUT OF SNIPER ROUNDS', '#ff8a7a');
    else this.scoped = true;
  }

  private toggleMask(): void {
    if (this.player.isDown) return;
    if (!this.hasMask) {
      this.hud.showCallout("YOU HAVEN'T GOT A GAS MASK! TAKE ONE FROM A FALLEN SOLDIER", '#ff8a7a');
      return;
    }
    this.maskOn = !this.maskOn;
    this.sound.play('uiChange', { volume: 0.5 });
  }

  /** The whistle: everyone of ours goes over the top, and so does the player, from `ladder`. */
  private startAssault(ladder: number): void {
    this.phase = 'assault';
    this.phaseTime = 0;
    this.scoped = false;
    this.scoped2 = false;
    this.releaseMountedWeapon();
    this.gunOwner = null;
    this.mgOwner = null;
    this.manning = null;
    this.manning2 = null;
    this.barrageLeft = BARRAGE_SHELLS;
    this.troops.overTheTop();
    this.hop(ladder, PARAPET_Z - 4, 0); // far enough out that the camera's not stuck behind the parapet
    this.whistle(2900, 2700, 1.6, 0.35, true);
    this.sound.music.stinger();
    this.announceBanner('OVER THE TOP!', 'Grenade throwers lob them into their trench while the riflemen cover them. In through the breaches, then up the communication trenches to their support and reserve lines: find their five officers!');
  }

  private updateMedics(dt: number): void {
    // Ours in the trench goes to each of our men who falls there and tends him (he's out of the
    // fight for good: nobody comes back, on either side).
    const m = this.trenchMedic;
    if (m.kneeling <= 0) {
      const hurt = this.troops.friends().find((f) => f.t.down && zoneOf(f.t.pos.x, f.t.pos.z) === 1 && f.t.stateTime > 2 && !this.tended.has(f));
      if (hurt) {
        m.goal = new THREE.Vector3(hurt.t.pos.x + 0.6, 0, FLOOR_Z);
        if (m.update(dt, 4)) {
          m.kneeling = 4;
          this.tended.add(hurt);
        }
      } else {
        if (!m.goal || m.update(dt, 2)) m.goal = new THREE.Vector3(m.home.x + (Math.random() - 0.5) * 2 * m.span, 0, FLOOR_Z + (Math.random() - 0.5) * 0.8);
      }
    } else m.update(dt);
    for (const o of this.medics) {
      if (o === m) continue;
      if (o.kneeling > 0) {
        o.update(dt);
        continue;
      }
      if (!o.goal || o.update(dt, 1.6)) {
        o.goal = new THREE.Vector3(o.home.x + (Math.random() - 0.5) * 2 * o.span, 0, o.home.z + (Math.random() - 0.5) * (o.home.z < 0 ? 0.8 : 3));
        if (Math.random() < 0.3) o.kneeling = 2 + Math.random() * 3;
      }
    }
  }

  private updateGas(dt: number): void {
    if (this.phase === 'front' && this.phaseTime > this.nextGas && !this.gas.active) {
      this.gas.release();
      this.nextGas = this.phaseTime + GAS_EVERY;
      this.gasWarned = false;
      this.hud.showBanner('GAS! GAS! GAS!', this.hasMask ? 'Press X to put your gas mask on, and keep it on until the gas has gone' : "Find a gas mask! Fallen soldiers have them. Don't breathe it in");
      this.sound.play('clang', { volume: 0.8, rate: 0.8 });
    }
    this.gas.update(dt);
    const thick = this.gas.at(this.player.position.z);
    if (thick > 0.2 && !this.maskOn && !this.player.isDown) {
      this.player.takeDamage(GAS_HURT * thick * dt);
      this.cough -= dt;
      if (this.cough <= 0) {
        this.cough = 0.9;
        this.sound.play('thud', { volume: 0.25, rate: 2.2 });
        if (!this.gasWarned) {
          this.gasWarned = true;
          this.hud.showCallout(this.hasMask ? 'YOU ARE BREATHING GAS! PRESS X FOR YOUR MASK' : 'YOU ARE BREATHING GAS! GET BACK OUT OF IT', '#c9e04a');
        }
      }
      if (this.player.isDown) this.hud.showCallout('GASSED! THE STRETCHER BEARERS ARE CARRYING YOU BACK…', '#ff8a7a');
    }
    if (this.player2) {
      this.withPlayer2(() => {
        const thick2 = this.gas.at(this.player.position.z);
        if (thick2 <= 0.2 || this.maskOn || this.player.isDown) return;
        this.player.takeDamage(GAS_HURT * thick2 * dt);
        if (this.player.isDown) {
          this.releaseMountedWeapon();
          this.scoped = false;
          this.manning = null;
          this.cam.addShake(0.2);
          this.hud.showCallout('GASSED! THE STRETCHER BEARERS ARE CARRYING YOU BACK…', '#ff8a7a');
        }
      });
    }
    if (!this.gas.active && this.maskOn && this.phase !== 'assault' && thick === 0 && this.gasWasOn) this.hud.showCallout('ALL CLEAR: MASKS OFF (X)', '#9be27a');
    this.gasWasOn = this.gas.active;
  }

  /**
   * The battle carries on all along the front beyond the wire: now and then a shell bursts out
   * there in no man's land or on one of the lines (scenery: it doesn't touch anyone).
   */
  private updateDistantBattle(dt: number): void {
    if (this.phase === 'won') return;
    this.nextDistantShell -= dt;
    if (this.nextDistantShell > 0) return;
    this.nextDistantShell = 1.5 + Math.random() * 3.5;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (SIDE_WALL + 12 + Math.random() * (SCENERY_HALF - SIDE_WALL - 20));
    const z = (Math.random() * 2 - 1) * 40;
    const at = new THREE.Vector3(x, 0.6, z);
    this.impacts.explode(at, 2.6 + Math.random() * 1.6);
    if (Math.random() < 0.4) this.impacts.addSmokeSource(at.clone().setY(0.4), 1.2, 8);
    this.sound.play('boom', { at, volume: 0.7, rate: 0.7 + Math.random() * 0.3, minGap: 0.3 });
  }

  /** Our guns covering the assault: shells all along their trench while our men cross. */
  private updateBarrage(dt: number): void {
    if (this.barrageLeft <= 0) return;
    this.nextBarrage -= dt;
    if (this.nextBarrage > 0) return;
    this.nextBarrage = (BARRAGE_TIME - 3) / BARRAGE_SHELLS;
    this.barrageLeft--;
    const x = -X_HALF + 6 + Math.random() * (X_HALF * 2 - 12);
    this.fireShell(new THREE.Vector3(x * 0.3, 40, 150), new THREE.Vector3(x, 0, -FLOOR_Z + (Math.random() - 0.5) * 2), true, 2.4);
  }

  private updateEnemyGuns(dt: number): void {
    if (this.phase !== 'front' && this.phase !== 'assault') return;
    this.nextEnemyShell -= dt;
    if (this.nextEnemyShell > 0) return;
    this.nextEnemyShell = 13 + Math.random() * 9;
    const p = this.player.position;
    const x = THREE.MathUtils.clamp(p.x + (Math.random() - 0.5) * 26, -X_HALF + 2, X_HALF - 2);
    // At our trench, or at the men crossing no man's land.
    const z = this.phase === 'assault' && zoneOf(p.x, p.z) === 2 ? p.z + (Math.random() - 0.5) * 16 : PARAPET_Z + 1 + Math.random() * 5;
    this.fireShell(new THREE.Vector3(0, 30, -140), new THREE.Vector3(x, 0, z), false, 3.2);
  }

  private step(input: InputState, dt: number, input2: InputState | null = null): void {
    if (input.mapTogglePressed || input2?.mapTogglePressed) this.hud.toggleBigMap();
    this.time += dt;
    this.phaseTime += dt;
    // Won: on to the next level after a while.
    if (this.victoryAt !== null && NEXT) {
      const left = VICTORY_DELAY - (this.time - this.victoryAt);
      this.hud.setVictoryFooter(`Get ready for Level ${levelNumber(NEXT)}: ${MISSIONS[levelNumber(NEXT) - 1].title}! Starting in ${Math.max(1, Math.ceil(left))}…`);
      if (left <= 0) {
        this.victoryAt = null;
        startMission(NEXT);
      }
    }
    if (input.cameraTogglePressed && !this.scoped) this.cam.toggle();
    if (input.usePressed) this.use();
    if (input.scopePressed) this.toggleScope();
    if (input.megaJamPressed) this.toggleMask();
    if (input.rocketPressed) this.throwGrenade();

    const p = this.player.position;
    // Reaching the front line moves the battle on.
    if (!this.reachedFront && (zoneOf(p.x, p.z) === 1 || (this.player2 && zoneOf(this.player2.position.x, this.player2.position.z) === 1))) {
      this.reachedFront = true;
      if (this.phase === 'artillery') {
        this.phase = 'front';
        this.phaseTime = 0;
      }
      this.nextGas = this.phaseTime + GAS_FIRST;
      this.hud.showBanner('THE FRONT LINE', 'Go right up to the parapet and press A (G) to climb the fire step. Take a few shots, then get down before they get you. Look out for their officers: red-banded caps');
    }

    // The player: aiming the gun, behind the machine gun, scoped, or on his feet.
    const wasDown = this.player.isDown;
    let move = { ...input, firing: false, jamFiring: false };
    if (this.manning === 'gun') {
      this.aimGun(input);
      move = { ...move, moveX: 0, moveY: 0, steer: 0, throttle: 0, aimYawDelta: 0, aimPitchDelta: 0 };
    } else if (this.manning === 'mg') {
      move = { ...move, moveX: 0, moveY: 0, steer: 0, throttle: 0 };
    } else if (this.scoped) {
      move = { ...move, moveX: 0, moveY: 0, steer: 0, throttle: 0, aimYawDelta: input.aimYawDelta * 0.22, aimPitchDelta: input.aimPitchDelta * 0.22 };
    }
    this.aimMarker.visible = this.manning === 'gun' || this.manning2 === 'gun';
    this.player.step(move, dt);
    if (wasDown && !this.player.isDown && this.player.health === 0) this.wakeAtAidPost();
    if (this.scoped && !onStep(p.x, p.z, p.y)) this.scoped = false;
    this.updateFiring(input, dt);
    if (this.player2 && input2) this.withPlayer2(() => {
      if (input2.cameraTogglePressed && !this.scoped) this.cam.toggle();
      if (input2.usePressed) this.use();
      if (input2.scopePressed) this.toggleScope();
      if (input2.megaJamPressed) this.toggleMask();
      if (input2.rocketPressed) this.throwGrenade();
      const secondWasDown = this.player.isDown;
      let secondMove = { ...input2, firing: false, jamFiring: false };
      if (this.manning === 'gun') {
        this.aimGun(input2);
        secondMove = { ...secondMove, moveX: 0, moveY: 0, steer: 0, throttle: 0, aimYawDelta: 0, aimPitchDelta: 0 };
      } else if (this.manning === 'mg') {
        secondMove = { ...secondMove, moveX: 0, moveY: 0, steer: 0, throttle: 0 };
      } else if (this.scoped) {
        secondMove = { ...secondMove, moveX: 0, moveY: 0, steer: 0, throttle: 0, aimYawDelta: input2.aimYawDelta * 0.22, aimPitchDelta: input2.aimPitchDelta * 0.22 };
      }
      this.player.step(secondMove, dt);
      const secondPos = this.player.position;
      if (this.scoped && !onStep(secondPos.x, secondPos.z, secondPos.y)) this.scoped = false;
      if (secondWasDown && !this.player.isDown && this.player.health === 0) this.wakeAtAidPost();
      this.updateFiring(input2, dt);
    });
    this.updatePickups(dt);

    this.troops.update(dt, this.front);
    // Ours still in our trench once the whistle's gone: up the nearest ladder and over.
    if (this.phase === 'assault') {
      for (const m of this.troops.friends()) {
        if (!m.t.active || zoneOf(m.t.pos.x, m.t.pos.z) !== 1) continue;
        if (LADDERS.some((x) => Math.abs(m.t.pos.x - x) < 1.2) && m.t.pos.z < 36.6) m.t.warp(m.t.pos.x, PARAPET_Z - 1.4);
      }
    }
    for (let i = this.troops.men.length - 1; i >= 0; i--) {
      const m = this.troops.men[i];
      if (!m.t.gone) continue;
      this.byHandle.delete(m.t.collider.handle);
      m.t.dispose();
      this.troops.men.splice(i, 1);
    }
    this.updateMedics(dt);
    this.updateGas(dt);
    this.updateEnemyGuns(dt);
    this.updateBarrage(dt);
    this.updateShells(dt);
    this.updateDistantBattle(dt);
    // The barrel slams back when the gun fires, then runs out again.
    this.gunKick = Math.max(0, this.gunKick - dt * 1.4);
    this.gunRecoil.position.z = 0.7 * Math.min(1, this.gunKick * 3) * this.gunKick;
    this.explosives.update(dt, (b) => this.onBlast(b), (pt) => this.impacts.trailPuff(pt));
    this.forest.update(dt);
    this.world.step();

    this.cam.update(this.player, dt);
    if (this.player2) this.cam2.update(this.player2, dt);
    if (this.scoped) {
      // Through the scope: from his eye on the fire step.
      const mode = this.cam.mode;
      this.cam.mode = 'first';
      this.cam.update(this.player, 0);
      this.cam.mode = mode;
    }
    if (this.manning === 'gun') {
      // A spotter's view from high up behind the gun, looking out to where the shell will land.
      const back = new THREE.Vector3(Math.sin(this.gunYaw), 0, Math.cos(this.gunYaw));
      this.camera.position.copy(GUN).addScaledVector(back, 14).setY(26);
      this.camera.lookAt(this.gunTarget().addScaledVector(back, 25));
    }
    if (this.player2) this.withPlayer2(() => {
      if (this.scoped) {
        const mode = this.cam.mode;
        this.cam.mode = 'first';
        this.cam.update(this.player, 0);
        this.cam.mode = mode;
      }
      if (this.manning === 'gun') {
        const back = new THREE.Vector3(Math.sin(this.gunYaw), 0, Math.cos(this.gunYaw));
        this.camera.position.copy(GUN).addScaledVector(back, 14).setY(26);
        this.camera.lookAt(this.gunTarget().addScaledVector(back, 25));
      }
    });
    this.impacts.update(dt);
    this.updateTracers(dt);
    const at = this.player.position;
    this.sun.position.set(at.x - 30, 70, at.z + 25);
    this.sun.target.position.set(at.x, 0, at.z);
    this.sun.target.updateMatrixWorld();
    this.hurtFlashLevel = Math.max(0, this.hurtFlashLevel - dt * 1.6);
    if (import.meta.env.DEV && this.debugCam) {
      this.camera.position.set(...this.debugCam.pos);
      this.camera.lookAt(...this.debugCam.look);
    }
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
    const split = !!this.player2;
    const localWidth = split && this.settings.splitOrientation === 'vertical' ? Math.floor(window.innerWidth / 2) : window.innerWidth;
    const localHeight = split && this.settings.splitOrientation === 'horizontal' ? Math.floor(window.innerHeight / 2) : window.innerHeight;
    return { x: ((x + 1) / 2) * localWidth, y: ((1 - y) / 2) * localHeight, onScreen, angle: Math.atan2(-y, x), label };
  }

  private nearestLadder(): number {
    const p = this.player.position;
    return LADDERS.reduce((a, b) => (Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a));
  }

  /** Where to go next. */
  private waypoint(): HUDState['waypoint'] {
    if (this.hud.paused || this.phase === 'won' || this.manning || this.scoped || this.player.isDown) return null;
    const p = this.player.position;
    const zone = zoneOf(p.x, p.z);
    const dist = (x: number, z: number) => `${Math.round(Math.hypot(x - p.x, z - p.z))} m`;
    if (this.phase === 'artillery' && this.gunShells === SHELLS) return this.waypointTo(GUN.clone().setY(3), 'THE BIG GUN');
    if (this.phase === 'assault') {
      if (zone <= 1) {
        if (zone === 0) return this.waypointTo(new THREE.Vector3(0, 1.5, FLOOR_Z), `FRONT LINE ${dist(0, FLOOR_Z)}`);
        const l = this.nearestLadder();
        return this.waypointTo(new THREE.Vector3(l, 2, PARAPET_Z + 1.5), 'LADDER: A TO GO OVER');
      }
      const left = this.troops.officers().filter((m) => !m.t.down);
      if (!left.length) return null;
      const o = left.reduce((a, b) => (Math.hypot(a.t.pos.x - p.x, a.t.pos.z - p.z) < Math.hypot(b.t.pos.x - p.x, b.t.pos.z - p.z) ? a : b));
      if (zone === 2) {
        const b = BREACHES.reduce((a, c) => (Math.abs(c - o.t.pos.x) + Math.abs(c - p.x) < Math.abs(a - o.t.pos.x) + Math.abs(a - p.x) ? c : a));
        return this.waypointTo(new THREE.Vector3(b, 2, -PARAPET_Z), `BREACH ${dist(b, -PARAPET_Z)}`);
      }
      // Through their trenches: the next turn on the way to him, if he's not straight ahead.
      const next = route(p.x, p.z, o.t.pos.x, o.t.pos.z);
      if (Math.hypot(next.x - o.t.pos.x, next.z - o.t.pos.z) > 0.1) {
        const officerZone = zoneOf(o.t.pos.x, o.t.pos.z);
        const label = officerZone === zone ? (o.mode === 'dugout' ? 'DUGOUT' : 'THIS WAY') : zone === 8 ? 'THIS WAY' : 'COMMUNICATION TRENCH';
        return this.waypointTo(new THREE.Vector3(next.x, 2, next.z), `${label} ${dist(next.x, next.z)}`);
      }
      return this.waypointTo(o.t.pos.clone().setY(2.6), `OFFICER ${dist(o.t.pos.x, o.t.pos.z)}`);
    }
    if (zone === 0 && !(Math.hypot(p.x - AMMO_DUMP.x, p.z - AMMO_DUMP.z) < 12 && !this.resupplied)) {
      if (!this.reachedFront || this.resupplied || this.phaseTime < 50) return this.waypointTo(new THREE.Vector3(0, 1.5, FLOOR_Z), `FRONT LINE ${dist(0, FLOOR_Z)}`);
    }
    if (this.reachedFront && !this.resupplied && (this.phaseTime > 50 || this.rifle < 8)) return this.waypointTo(AMMO_DUMP.clone().setY(2.5), `AMMO DUMP ${dist(AMMO_DUMP.x, AMMO_DUMP.z)}`);
    if (this.resupplied) {
      const l = this.nearestLadder();
      return this.waypointTo(new THREE.Vector3(l, 2, PARAPET_Z + 1.5), 'LADDER: A TO BLOW THE WHISTLE');
    }
    return null;
  }

  private objectives(): { label: string; done: boolean }[] {
    const assault = this.phase === 'assault' || this.phase === 'won';
    return [
      { label: `Shell their trench with the big gun (${this.gunShells} shell${this.gunShells === 1 ? '' : 's'} left)`, done: this.gunShells === 0 || assault },
      { label: 'Get to the front line and shoot from the fire step', done: this.reachedFront },
      { label: 'Stock up at the ammo dump', done: this.resupplied },
      { label: 'Blow the whistle at a ladder and go over the top', done: assault },
      { label: `Take out their five officers (${this.officersDown} / 5)`, done: this.officersDown >= 5 },
    ];
  }

  private prompt(usingGamepad: boolean): string | null {
    const p = this.player.position;
    const a = usingGamepad ? 'A' : 'G';
    if (this.phase === 'won') return null;
    if (this.player.downFor > 0) return `Hit! Waking up at the aid post in ${Math.ceil(this.player.downFor)}…`;
    if (this.manning === 'gun') return `Aim the gun (the red ring is where it lands) · ${usingGamepad ? 'RT' : 'click'} to fire · ${a} to leave · ${this.gunShells} shells`;
    if (this.manning === 'mg') return `Machine gun: ${this.mgBelt} rounds · ${a} to leave`;
    if (this.scoped) return `Scope: aim and fire · ${usingGamepad ? 'B' : 'V'} to put it down · ${this.sniper} rounds`;
    if (this.gas.at(p.z) > 0.2 && !this.maskOn) return this.hasMask ? 'GAS! Press X for your gas mask!' : 'GAS! You have no mask: get out of it!';
    const zone = zoneOf(p.x, p.z);
    const breech = GUN.clone().add(new THREE.Vector3(Math.sin(this.gunYaw) * 1.6, 0, Math.cos(this.gunYaw) * 1.6));
    if (this.gunShells > 0 && Math.hypot(p.x - breech.x, p.z - breech.z) < 3) return `Press ${a} to fire the big gun`;
    if (zone !== 1) return null;
    const step = onStep(p.x, p.z, p.y);
    if (step && Math.hypot(p.x - MG_AT.x, p.z - MG_AT.z) < USE_REACH && this.mgBelt > 0) return `Press ${a} to take the machine gun`;
    const ladder = LADDERS.find((x) => Math.abs(x - p.x) < 1.4);
    if (ladder !== undefined && p.z < 37.5 && !step) {
      if (this.phase === 'assault') return `Press ${a} to go over the top`;
      return this.resupplied ? `Press ${a} to blow the whistle: everyone goes over the top!` : 'A ladder: stock up at the ammo dump before you go over';
    }
    if (step) return this.hasSniper ? `On the fire step: ${usingGamepad ? 'B' : 'V'} for the sniper scope, ${a} to get down` : `On the fire step: ${a} to get down`;
    if (p.z < STEP_Z + 2) return `Press ${a} to climb onto the fire step`;
    return null;
  }

  private weaponLabel(): string {
    if (this.manning === 'gun') return `BIG GUN · ${this.gunShells}`;
    if (this.manning === 'mg') return `MACHINE GUN · ${this.mgBelt}`;
    if (this.scoped) return `SNIPER · ${this.sniper}`;
    if (this.lewis > 0) return `LEWIS GUN · ${this.lewis}`;
    return `RIFLE · ${this.rifle}`;
  }

  private trenchHUD(usingGamepad: boolean): PrisonHUD {
    const friends = this.troops.friends().filter((m) => m.t.active).length;
    const foes = this.troops.enemies().filter((m) => m.t.active).length;
    const k = (key: string, what: string) => `<span class="key">${key}</span>${what}`;
    const status = [
      `Rifle ${this.rifle} · Sniper ${this.hasSniper ? this.sniper : '—'} · Lewis gun ${this.lewis || '—'}`,
      `Gas mask: ${this.hasMask ? (this.maskOn ? 'ON' : 'off (X)') : 'none'}`,
      `Ours left ${friends} / ${OUR_LINE + OUR_RESERVE} · Theirs left ${foes} / ${ENEMY_MEN}`,
      'No healing here: hit too often and you wake at the aid post',
    ];
    if (this.wakeUps) status.push(`Woken at the aid post ${this.wakeUps} time${this.wakeUps === 1 ? '' : 's'}`);
    return {
      title: TITLE,
      objectives: this.objectives(),
      prompt: this.prompt(usingGamepad),
      downFor: this.player.downFor,
      jam: 0,
      onRaft: false,
      stealth: null,
      status,
      launcher: { shots: this.grenades, max: GRENADE_MAX, reloadLeft: 0, reloadTime: 1, name: 'GRENADES' },
      vehicle: {
        gun: this.weaponLabel(),
        hull: 'HEALTH',
        ready: this.player.downFor > 0 ? 'HIT' : this.maskOn ? 'MASK ON' : 'NO HEALING',
        mode: this.manning === 'gun' ? 'At the big gun' : this.manning === 'mg' ? 'On the machine gun' : onStep(this.player.position.x, this.player.position.z, this.player.position.y) ? 'On the fire step' : 'On foot',
        keysPad: `${k('LS', 'move')}${k('RS', 'aim')}${k('RT', 'fire')}${k('A', 'step · use')}${k('B', 'scope')}<br>${k('X', 'gas mask')}${k('LB', 'grenade')}${k('Y', 'camera')}${k('Start', 'pause')}`,
        keysKb: `${k('WASD', 'move')}${k('Mouse', 'aim')}${k('Click', 'fire')}${k('G', 'step · use')}${k('V', 'scope')}<br>${k('X', 'gas mask')}${k('F', 'grenade')}${k('C', 'camera')}${k('M', 'pause')}`,
      },
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
      map: NO_MAP,
      aimScreen: this.hud.paused || this.scoped || this.manning === 'gun' ? null : { x: localWidth / 2, y: localHeight / 2 },
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
      prison: this.trenchHUD(input.usingGamepad),
      driveStyle: this.settings.driveStyle,
      mouseCaptureHint: !input.usingGamepad && !input.pointerLocked && input.pointerLockAvailable,
      soundLocked: this.sound.locked && (this.settings.sfxVolume > 0 || this.settings.musicVolume > 0),
    };
  }

  private updateOverlays(): void {
    const show = (d: HTMLDivElement, on: boolean) => (d.style.display = on ? 'block' : 'none');
    const paused = this.hud.paused;
    show(this.scopeOverlay, this.scoped && !paused);
    show(this.maskOverlay, this.maskOn && !this.scoped && !paused && !this.player.isDown);
    const thick = this.gas.at(this.camera.position.z);
    show(this.gasTint, thick > 0.05);
    this.gasTint.style.opacity = String(Math.min(1, thick * (this.maskOn ? 0.35 : 1)));
    show(this.hurtFlash, this.hurtFlashLevel > 0.01 || this.player.isDown);
    this.hurtFlash.style.opacity = String(this.player.isDown ? 1 : this.hurtFlashLevel);
  }

  private render(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.shadowMap.needsUpdate = true;
    const split = !!this.player2;
    this.renderer.setScissorTest(split);
    if (!split) {
      this.hud.setViewport({ left: 0, top: 0, width: w, height: h });
      this.camera.aspect = w / h;
      this.camera.fov = this.scoped ? SCOPE_FOV : FOV;
      this.camera.updateProjectionMatrix();
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.hud.setCoopLayout(true);
    const vertical = this.settings.splitOrientation === 'vertical';
    const half = Math.floor((vertical ? w : h) / 2);
    const v1 = vertical ? { left: 0, top: 0, width: half, height: h } : { left: 0, top: 0, width: w, height: h - half };
    const v2 = vertical ? { left: half, top: 0, width: w - half, height: h } : { left: 0, top: h - half, width: w, height: half };
    this.hud.setViewport(v1); this.hud2.setViewport(v2);
    for (const [camera, v] of [[this.camera, v1], [this.camera2, v2]] as const) {
      camera.aspect = v.width / v.height;
      camera.fov = (camera === this.camera ? this.scoped : this.scoped2) ? SCOPE_FOV : FOV;
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
    const p2Enabled = !!this.player2;
    const p2Index = p2Enabled ? this.settings.player2Controller : -3;
    const p1Index = !p2Enabled ? -2 : this.settings.player1Controller === -2 ? (pads.find((pad) => pad && pad.index !== p2Index)?.index ?? -1) : this.settings.player1Controller;
    const lockedMousePlayer: 1 | 2 = p2Enabled && p2Index === -1 ? 2 : 1;
    const input = this.input.update(dt, p1Index, 1, this.settings.splitOrientation, p2Enabled && p2Index === -1, pads, lockedMousePlayer);
    const input2 = p2Enabled ? this.input.update(dt, p2Index, 2, this.settings.splitOrientation, false, pads, lockedMousePlayer) : null;
    const kbMenu = this.input.keyboardMenu();
    input.mapTogglePressed ||= kbMenu.mapTogglePressed;
    if (this.hud.paused) {
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
      this.updateOverlays();
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
    this.updateOverlays();
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
      troops: this.troops,
      gas: this.gas,
      medics: this.medics,
      pickups: this.pickups,
      use: () => this.use(),
      scope: () => this.toggleScope(),
      mask: () => this.toggleMask(),
      hop: (x: number, z: number, y = 0) => this.hop(x, z, this.player.yaw, y),
      assault: () => this.startAssault(0),
      state: () => ({
        phase: this.phase,
        manning: this.manning,
        scoped: this.scoped,
        shells: this.gunShells,
        rifle: this.rifle,
        sniper: this.sniper,
        lewis: this.lewis,
        grenades: this.grenades,
        hasMask: this.hasMask,
        maskOn: this.maskOn,
        resupplied: this.resupplied,
        officersDown: this.officersDown,
        enemiesDown: this.enemiesDown,
        health: this.player.health,
        wakeUps: this.wakeUps,
        victory: this.phase === 'won',
      }),
    };
  }
}
