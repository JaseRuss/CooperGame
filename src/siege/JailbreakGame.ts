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
import { MISSION, startMission } from '../core/config';
import { PlayerSoldier, MAX_HEALTH } from '../prison/PlayerSoldier';
import { ShoulderCam } from '../prison/ShoulderCam';
import { Guards, type Guard, type GuardWorld, type Shot } from '../prison/Guards';
import { VisionCones } from '../prison/VisionCones';
import { FRIEND_SHOTS, ENEMY_SHOTS, WALLS_ONLY } from '../prison/groups';
import { loadRequest, saveResult, type JailbreakRequest } from '../core/SiegeSave';
import { Dungeon, START, GATE_HALF, DOOR_Z, YARD_Z, type DungeonCell } from './Dungeon';

const SKY = 0x070b18;
const SHADOW_HALF = 45;
const SHOT_RANGE = 220;
const TRACER_TIME = 0.06;
const GUARD_DAMAGE = 5;
/** A rifle shot is heard by guards this far off. */
const SHOT_NOISE = 28;
/** He's within this of a cell door to start unlocking it, and it takes this long. */
const UNLOCK_REACH = 2.6;
const UNLOCK_TIME = 1.3;
/** A guard sneaked up on from behind goes down quietly when he's this close. */
const TAKEDOWN_REACH = 1.9;
/** Disguised: a jailer this close who's facing him notices (per second, filling a meter that catches him at 1), and more slowly from the side or behind. */
const INSPECT_REACH = 3;
const INSPECT_FRONT = 0.55;
const INSPECT_SIDE = 0.16;
/** Running (not creeping) disguised within this of a jailer looks wrong. */
const RUN_REACH = 9;
const RUN_RATE = 0.13;
const SUSPICION_DECAY = 0.35;
/** The jam riot cannon, as on the prison level. */
const JAM_INTERVAL = 0.07;
const JAM_SPEED = 22;
const JAM_GRAVITY = 12;
const JAM_RANGE = 22;
const JAM_DRAIN = 0.28;
const JAM_REFILL = 0.2;
const JAM_RADIUS = 1.8;
const JAM_DRIP_RADIUS = 1;
const LAMP_LIGHTS = 4;
/** The freed soldiers keep to the player's trail, this many trail points behind each other. */
const FOLLOW_GAP = 5;
const TRAIL_STEP = 0.6;
const DONE_DELAY = 3.2;

const CONTROLS =
  '<span><b>Move</b> left stick · W A S D</span><span><b>Aim</b> right stick · mouse</span>' +
  '<span><b>Creep</b> (guards see half as far) RB · Left Shift</span><span><b>Fire</b> RT · click (a shot is heard from far off; right behind a jailer it is a quiet takedown)</span>' +
  '<span><b>Jam riot cannon</b> (quiet) hold LT · hold E</span><span><b>Put on / take off the jailer disguise</b> X · X</span>' +
  '<span><b>Camera</b> Y · C</span><span><b>Back to the gate</b> Back · R</span>';
const CONTROLS_P2 =
  '<span><b>Move</b> arrow keys · <b>Aim</b> mouse in your view or numpad 4/6 and 8/2</span>' +
  '<span><b>Quiet takedown / fire</b> numpad 0 · <b>Creep</b> Right Shift · <b>Jam riot cannon</b> hold numpad 1</span>' +
  '<span><b>Put on / take off disguise</b> numpad 7 · <b>Camera</b> numpad 9 · <b>Back to gate</b> numpad decimal</span>' +
  '<span><b>Pause / map</b> numpad enter · <b>Menu options</b> numpad plus</span>';

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

interface Freed {
  mesh: THREE.Mesh;
  /** How many real prisoners this figure stands for. */
  weight: number;
  hop: number;
  leader: 1 | 2;
}

/**
 * The siege level's on-foot section: break the prisoners out of a castle dungeon. It's its own
 * small game, like the prison break, loaded by `?mission=6&stage=foot` when the tank gets to an
 * enemy prison and the player gets out. The jailers have vision cones; the player can creep, fight
 * a little, sneak up on one from behind and knock him out, or press X to put on a jailer's tabard
 * and hat and walk among them (a jailer who looks him over up close, or who sees him run, sees
 * through it, and then it's back to the gate). Open the cells, lead the prisoners out of the gate,
 * and the page goes back to the tank game, where they run for the nearest friendly base.
 */
export class JailbreakGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private readonly camera2: THREE.PerspectiveCamera;
  private readonly input: InputManager;
  private hud: HUD;
  private readonly hud2: HUD;
  private readonly splitDivider: HTMLDivElement;
  private dividerOrientation: 'vertical' | 'horizontal' | null = null;
  private readonly sound = new Sound(MISSION);
  private readonly sun: THREE.DirectionalLight;
  private readonly clock = new THREE.Clock();
  private readonly loadingLabel: HTMLDivElement;
  private readonly lampLights: THREE.PointLight[] = [];
  private settings: Settings = loadSettings();
  private ready = false;
  private pausedRendered = false;
  private world!: RAPIER.World;
  private impacts!: ImpactEffects;
  private jam!: JamCannon;
  private jam2!: JamCannon;
  private dungeon!: Dungeon;
  private player!: PlayerSoldier;
  private player2: PlayerSoldier | null = null;
  private cam!: ShoulderCam;
  private cam2!: ShoulderCam;
  private guards!: Guards;
  private cones!: VisionCones;
  private readonly request: JailbreakRequest;
  private weights: number[] = [];
  private readonly unlocking = new Map<DungeonCell, number>();
  private readonly freed: Freed[] = [];
  private readonly trails: [THREE.Vector3[], THREE.Vector3[]] = [[], []];
  private time = 0;
  private entered = false;
  private jamTank = 1;
  private jamTank2 = 1;
  private jamCooldown = 0;
  private jamCooldown2 = 0;
  private downTime = 0;
  private downTime2 = 0;
  private wasFiring = false;
  private wasFiring2 = false;
  /** How close a jailer is to seeing through the disguise (0..1). */
  private suspicion = 0;
  private suspicion2 = 0;
  private caught = 0;
  private done: number | null = null;
  private lastAlarmAt = -99;
  private readonly stats = { alarms: 0, takedowns: 0, shots: 0, knockedDown: 0 };
  private readonly tracers: { line: THREE.Line; age: number }[] = [];
  private readonly friendTracer = new THREE.LineBasicMaterial({ color: 0xffe7a0, transparent: true });
  private readonly enemyTracer = new THREE.LineBasicMaterial({ color: 0xff9a5a, transparent: true });
  /** Dev only: pins the camera for screenshots. */
  debugCam: { pos: [number, number, number]; look: [number, number, number] } | null = null;

  constructor(container: HTMLElement) {
    this.request = loadRequest() ?? { prison: 0, held: 8 };
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
    this.splitDivider = document.createElement('div');
    this.splitDivider.style.cssText = 'display:none;position:absolute;z-index:2;background:#d6dfd880;pointer-events:none';
    container.appendChild(this.splitDivider);
    this.hud.setSoundHook((kind) => this.sound.play(kind === 'move' ? 'uiMove' : kind === 'change' ? 'uiChange' : kind === 'back' ? 'uiBack' : kind === 'open' ? 'uiOpen' : 'uiConfirm', { volume: 0.5, minGap: 0 }));

    this.loadingLabel = document.createElement('div');
    this.loadingLabel.style.cssText =
      'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;' +
      "font-size:22px; background:#0a0e14; color:#e8eef5; font-family:'Segoe UI',system-ui,sans-serif; z-index:10;";
    this.loadingLabel.textContent = 'Loading dungeon…';
    container.appendChild(this.loadingLabel);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 40, 200);
    this.scene.add(new THREE.HemisphereLight(0x8aa2d8, 0x3a3c4c, 2.4));
    this.sun = new THREE.DirectionalLight(0xa8bcff, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(graphics.shadowSize || 1024, graphics.shadowSize || 1024);
    const sh = this.sun.shadow.camera;
    sh.left = sh.bottom = -SHADOW_HALF;
    sh.right = sh.top = SHADOW_HALF;
    sh.far = 200;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    for (let i = 0; i < LAMP_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffc890, 0, 36, 2);
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
    this.jam = new JamCannon(this.scene, () => 0, FRIEND_SHOTS);
    this.jam2 = new JamCannon(this.scene, () => 0, FRIEND_SHOTS);
    // As many cells as it takes at two prisoners to a cell; each figure in a cell stands for a share of those held.
    const cells = Math.min(6, Math.max(1, Math.ceil(this.request.held / 2)));
    this.dungeon = new Dungeon(this.world, cells, this.request.army === 'blue' ? 0x3d6fc4 : 0xc4a468, this.request.royal ? 'royal' : this.request.army === 'blue' ? 'german' : 'welsh');
    this.scene.add(this.dungeon.group);
    this.weights = Array.from({ length: cells }, (_, i) => Math.floor(this.request.held / cells) + (i < this.request.held % cells ? 1 : 0));
    this.dungeon.layout.cells.forEach((cell, i) => this.dungeon.fillCell(cell, Math.min(2, this.weights[i])));

    this.player = new PlayerSoldier(this.world, START.x, START.z, START.yaw);
    this.scene.add(this.player.root);
    this.cam = new ShoulderCam(this.camera, this.world);
    this.syncPlayer2();
    this.guards = new Guards(this.world, this.dungeon.layout.guards);
    this.guards.setSector('compound');
    this.scene.add(this.guards.group);
    this.cones = new VisionCones(this.world, this.guards);
    this.scene.add(this.cones.group);
    this.hud.setOnFoot(CONTROLS, undefined, CONTROLS_P2);
    this.hud2.setOnFoot(CONTROLS_P2);
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
    this.sound.music.setNight(true);
    this.sound.music.start();
    this.clock.start();
    this.hud.showBanner(this.request.royal ? 'THE ROYAL DUNGEON' : 'BREAK THEM OUT!', 'Open the cell doors, then lead everyone out of the gate. Creep past the jailers, or press X / numpad 7 to put on a jailer disguise');
    if (import.meta.env.DEV) (window as unknown as { jailbreak: JailbreakGame }).jailbreak = this;
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
    const lite = this.settings.graphicsQuality === 'low';
    this.cones?.setLite(lite);
    for (const l of this.lampLights) l.visible = !lite;
    if (this.player) this.syncPlayer2();
    this.pausedRendered = false;
  }

  private syncPlayer2(): void {
    const enabled = this.settings.player2Controller !== -2;
    if (enabled && !this.player2 && this.world && this.player) {
      this.player2 = new PlayerSoldier(this.world, this.player.position.x + 1.8, this.player.position.z, this.player.yaw);
      this.scene.add(this.player2.root);
      this.cam2 = new ShoulderCam(this.camera2, this.world);
      this.hud2.setActive(true);
    } else if (!enabled && this.player2) {
      this.scene.remove(this.player2.root);
      this.player2.dispose();
      this.player2 = null;
      this.hud2.setActive(false);
    }
    this.hud.setCoopLayout(!!this.player2);
    this.splitDivider.style.display = this.player2 ? 'block' : 'none';
    this.hud.setViewport(this.playerViewport(1));
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
    return player === 1 ? { left: 0, top: 0, width: w, height: h - half } : { left: 0, top: h - half, width: w, height: half };
  }

  private withPlayer2<T>(run: () => T): T {
    if (!this.player2) return run();
    const player = this.player;
    const camera = this.camera;
    const cam = this.cam;
    const hud = this.hud;
    const jam = this.jam;
    const jamTank = this.jamTank;
    const jamCooldown = this.jamCooldown;
    const downTime = this.downTime;
    const wasFiring = this.wasFiring;
    const suspicion = this.suspicion;
    this.player = this.player2;
    this.camera = this.camera2;
    this.cam = this.cam2;
    this.hud = this.hud2;
    this.jam = this.jam2;
    this.jamTank = this.jamTank2;
    this.jamCooldown = this.jamCooldown2;
    this.downTime = this.downTime2;
    this.wasFiring = this.wasFiring2;
    this.suspicion = this.suspicion2;
    try { return run(); }
    finally {
      this.jamTank2 = this.jamTank;
      this.jamCooldown2 = this.jamCooldown;
      this.downTime2 = this.downTime;
      this.wasFiring2 = this.wasFiring;
      this.suspicion2 = this.suspicion;
      this.player = player;
      this.camera = camera;
      this.cam = cam;
      this.hud = hud;
      this.jam = jam;
      this.jamTank = jamTank;
      this.jamCooldown = jamCooldown;
      this.downTime = downTime;
      this.wasFiring = wasFiring;
      this.suspicion = suspicion;
    }
  }

  private updateSecondHud(input: InputState | null): void {
    if (!this.player2 || !input) return;
    this.withPlayer2(() => this.hud2.update(this.hudState(input)));
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
    } else if (this.settings.splitOrientation === 'vertical') {
      const half = Math.floor(w / 2);
      this.camera.aspect = half / h;
      this.camera2.aspect = (w - half) / h;
      this.camera.updateProjectionMatrix();
      this.camera2.updateProjectionMatrix();
      this.renderer.setViewport(0, 0, half, h); this.renderer.setScissor(0, 0, half, h); this.renderer.render(this.scene, this.camera);
      this.renderer.setViewport(half, 0, w - half, h); this.renderer.setScissor(half, 0, w - half, h); this.renderer.render(this.scene, this.camera2);
    } else {
      const half = Math.floor(h / 2);
      this.camera.aspect = w / (h - half);
      this.camera2.aspect = w / half;
      this.camera.updateProjectionMatrix();
      this.camera2.updateProjectionMatrix();
      this.renderer.setViewport(0, half, w, h - half); this.renderer.setScissor(0, half, w, h - half); this.renderer.render(this.scene, this.camera);
      this.renderer.setViewport(0, 0, w, half); this.renderer.setScissor(0, 0, w, half); this.renderer.render(this.scene, this.camera2);
    }
  }

  private onResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.hud.setViewport(this.playerViewport(1));
    this.hud2.setViewport(this.player2 ? this.playerViewport(2) : null);
    this.pausedRendered = false;
  }

  // ---------- shooting and sneaking ----------

  private sees(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = b.clone().sub(a);
    const d = dir.length();
    if (d < 0.01) return true;
    return !this.world.castRay(new RAPIER.Ray(a, dir.divideScalar(d)), d, true, undefined, WALLS_ONLY);
  }

  private aimPoint(): THREE.Vector3 {
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const aim = this.cam.aimDirection();
    const sight = this.world.castRay(new RAPIER.Ray(camPos, aim), SHOT_RANGE, true, undefined, FRIEND_SHOTS);
    return camPos.addScaledVector(aim, sight ? sight.timeOfImpact : SHOT_RANGE);
  }

  /** A jailer on his feet and not on to anyone, close, and with his back (or side) turned: the one a takedown works on. */
  private takedownTarget(): Guard | null {
    const p = this.player.position;
    let best: Guard | null = null;
    let bestD = TAKEDOWN_REACH;
    for (const g of this.guards.list) {
      if (g.state !== 'active' || g.alert === 'alarmed') continue;
      const dx = p.x - g.pos.x;
      const dz = p.z - g.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const fwd = g.forward();
      // His back is toward the player: the player is on the far side of his shoulders.
      if ((fwd.x * dx + fwd.z * dz) / Math.max(d, 0.01) > -0.2) continue;
      best = g;
      bestD = d;
    }
    return best;
  }

  /** A quiet takedown: he's down before he knows it, and nobody hears. */
  private takedown(target: Guard): void {
    const dir = new THREE.Vector3(target.pos.x - this.player.position.x, 0, target.pos.z - this.player.position.z).normalize();
    target.knockDown(dir);
    this.stats.takedowns++;
    this.sound.play('thud', { at: target.pos, volume: 0.35, rate: 1.1, minGap: 0.1 });
    this.hud.showCallout('QUIET TAKEDOWN!', '#ffd24a');
  }

  private fireRifle(): void {
    // A shot gives the disguise away.
    if (this.player.disguised) {
      this.player.setDisguised(false);
      this.hud.showCallout('DISGUISE OFF', '#ff9a8a');
    }
    const muzzle = this.player.muzzle();
    const target = this.aimPoint();
    const dir = target.clone().sub(muzzle);
    const dist = dir.length();
    dir.normalize();
    const hit = this.world.castRay(new RAPIER.Ray(muzzle, dir), dist + 0.05, true, undefined, FRIEND_SHOTS);
    const end = hit ? muzzle.clone().addScaledVector(dir, hit.timeOfImpact) : target;
    this.impacts.muzzleFlash(muzzle, dir, 0.3);
    this.sound.play('crack', { volume: 0.28, rate: 2.3, minGap: 0.05 });
    this.cam.addShake(0.08);
    this.guards.hear(muzzle, SHOT_NOISE, 'compound');
    this.stats.shots++;
    this.addTracer(muzzle, end, this.friendTracer);
    if (!hit) return;
    this.impacts.dustPuff(end);
    const guard = this.guards.hit(hit.collider, dir);
    if (guard) {
      this.sound.play('thud', { at: end, volume: 0.6, rate: 1.3, minGap: 0.05 });
      if (guard.state === 'down') this.hud.showCallout('JAILER DOWN!', '#ffd24a');
      this.guards.provoke(guard, this.player.position);
    } else {
      this.sound.play('clang', { at: end, volume: 0.15, rate: 2.2, minGap: 0.08 });
    }
  }

  private resolveGuardShot(shot: Shot): void {
    if (shot.at) return;
    const hit = this.world.castRay(new RAPIER.Ray(shot.from, shot.dir), SHOT_RANGE, true, undefined, ENEMY_SHOTS);
    const end = shot.from.clone().addScaledVector(shot.dir, hit ? hit.timeOfImpact : 60);
    this.impacts.muzzleFlash(shot.from, shot.dir, 0.25);
    this.sound.play('crack', { at: shot.from, volume: 0.22, rate: 1.8, minGap: 0.04 });
    this.addTracer(shot.from, end, this.enemyTracer);
    if (!hit) return;
    this.impacts.dustPuff(end);
    if (hit.collider.handle === this.player.collider.handle) {
      const wasUp = !this.player.isDown;
      this.player.takeDamage(GUARD_DAMAGE);
      this.cam.addShake(0.25);
      this.sound.play('thud', { volume: 0.5, rate: 1.6, minGap: 0.1 });
      if (wasUp && this.player.isDown) {
        this.downTime = 0;
        this.stats.knockedDown++;
      }
    } else if (this.player2 && hit.collider.handle === this.player2.collider.handle) {
      const wasUp = !this.player2.isDown;
      this.player2.takeDamage(GUARD_DAMAGE);
      this.cam2.addShake(0.25);
      this.sound.play('thud', { volume: 0.5, rate: 1.6, minGap: 0.1 });
      if (wasUp && this.player2.isDown) {
        this.downTime2 = 0;
        this.stats.knockedDown++;
      }
    }
  }

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
        if (this.guards.jamAt(point, JAM_RADIUS) > 0 && point.distanceTo(this.player.position) < 25) this.hud.showCallout('JAILER STUCK IN JAM!', '#ff8aa8');
      },
      (point) => this.guards.jamAt(point, JAM_DRIP_RADIUS),
    );
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

  // ---------- the disguise ----------

  private toggleDisguise(): void {
    if (this.player.disguised) {
      this.player.setDisguised(false);
      this.suspicion = 0;
      this.hud.showCallout('DISGUISE OFF', '#c9d3dc');
      return;
    }
    if (this.guards.alarmed > 0 || this.guards.anySeeing) {
      this.hud.showCallout("CAN'T DISGUISE: THEY'RE ON TO YOU", '#ff9a8a');
      return;
    }
    this.player.setDisguised(true);
    this.sound.play('uiChange', { volume: 0.5 });
    this.hud.showCallout('DISGUISED AS A JAILER: DON\'T RUN, KEEP AWAY FROM THEM', '#ffd24a');
  }

  /** Disguised, he's safe unless a jailer looks him over up close or sees him run: that fills a meter, and a full one is "caught". */
  private updateDisguise(dt: number, moved: number): void {
    if (!this.player.disguised) {
      this.suspicion = Math.max(0, this.suspicion - SUSPICION_DECAY * dt);
      return;
    }
    const p = this.player.position;
    let rate = 0;
    const running = moved / Math.max(dt, 1e-3) > 3.2 && !this.player.sneaking;
    for (const g of this.guards.list) {
      if (g.state !== 'active') continue;
      const dx = p.x - g.pos.x;
      const dz = p.z - g.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < INSPECT_REACH) {
        const fwd = g.forward();
        const facing = (fwd.x * dx + fwd.z * dz) / Math.max(d, 0.01) > 0.15;
        rate += facing ? INSPECT_FRONT : INSPECT_SIDE;
      }
      if (running && d < RUN_REACH) rate += RUN_RATE;
    }
    this.suspicion = rate > 0 ? Math.min(1, this.suspicion + rate * dt) : Math.max(0, this.suspicion - SUSPICION_DECAY * dt);
    if (this.suspicion >= 1 && this.caught === 0) {
      this.caught = 0.0001;
      this.sound.music.alarm();
      this.hud.showBanner('CAUGHT!', 'A jailer saw through the disguise. Back to the gate…');
    }
  }

  // ---------- the cells ----------

  private updateCells(dt: number): void {
    for (const cell of this.dungeon.layout.cells) {
      if (cell.opening) continue;
      const atCell = (player: PlayerSoldier | null) => !!player && !player.isDown && Math.abs(player.position.x - cell.x) < 3.4 && player.position.z < DOOR_Z + UNLOCK_REACH && player.position.z > DOOR_Z - 0.2;
      const near = atCell(this.player) || atCell(this.player2);
      const t = near ? (this.unlocking.get(cell) ?? 0) + dt / UNLOCK_TIME : Math.max(0, (this.unlocking.get(cell) ?? 0) - dt * 2);
      this.unlocking.set(cell, t);
      if (t < 1) continue;
      this.unlocking.delete(cell);
      this.dungeon.openCell(cell);
      this.sound.play('clang', { at: new THREE.Vector3(cell.x, 1.5, DOOR_Z), volume: 1, rate: 0.8 });
      this.guards.hear(new THREE.Vector3(cell.x, 1, DOOR_Z), 14, 'compound');
      this.hud.showCallout('CELL OPEN!', '#9be27a');
      const share = this.weights[cell.index] / Math.max(1, cell.prisoners.length);
      const p1 = this.player.position;
      const p2 = this.player2?.position;
      const leader: 1 | 2 = p2 && Math.hypot(p2.x - cell.x, p2.z - DOOR_Z) < Math.hypot(p1.x - cell.x, p1.z - DOOR_Z) ? 2 : 1;
      for (const mesh of cell.prisoners) this.freed.push({ mesh, weight: share, hop: Math.random() * 6, leader });
      cell.prisoners = [];
    }
  }

  private updateFreed(dt: number): void {
    const p = this.player.position;
    const p2 = this.player2?.position;
    const players = [p, p2];
    players.forEach((at, i) => {
      if (!at) return;
      const trail = this.trails[i];
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(at.x - last.x, at.z - last.z) > TRAIL_STEP) trail.push(new THREE.Vector3(at.x, 0, at.z));
      if (trail.length > 600) trail.splice(0, 200);
    });
    const followerIndex = new Map<1 | 2, number>([[1, 0], [2, 0]]);
    this.freed.forEach((f) => {
      const index = followerIndex.get(f.leader)!;
      followerIndex.set(f.leader, index + 1);
      const trail = this.trails[f.leader - 1];
      const spot = trail[Math.max(0, trail.length - 1 - FOLLOW_GAP * (index + 1))] ?? players[f.leader - 1] ?? p;
      const dx = spot.x - f.mesh.position.x;
      const dz = spot.z - f.mesh.position.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, 7 * dt);
      if (d > 0.3) {
        f.mesh.position.x += (dx / d) * step;
        f.mesh.position.z += (dz / d) * step;
        f.mesh.rotation.y = Math.atan2(-dx, -dz);
        f.hop += dt * 9;
      }
      f.mesh.position.y = d > 0.3 ? Math.abs(Math.sin(f.hop)) * 0.2 : 0;
    });
  }

  private get freedCount(): number {
    return Math.round(this.freed.reduce((n, f) => n + f.weight, 0));
  }

  private get opened(): number {
    return this.dungeon.layout.cells.filter((c) => c.opening).length;
  }

  // ---------- the frame ----------

  private toGate(): void {
    this.player.teleport(START.x, START.z, START.yaw);
    this.guards.standDown('compound');
    if (this.player === this.player2) this.downTime2 = 0;
    else this.downTime = 0;
  }

  private restart(): void {
    window.location.reload();
  }

  private finish(): void {
    if (this.done !== null) return;
    this.done = 0;
    const freed = this.freedCount;
    saveResult({ prison: this.request.prison, freed });
    this.sound.music.fanfare();
    if (freed > 0) this.hud.showBanner('PRISONERS FREED!', `${freed} soldier${freed === 1 ? '' : 's'} out of the gate and running for the friendly base`);
    else this.hud.showBanner('BACK OUT THE GATE', 'You left without freeing anyone');
    this.hud.setFade(0, '#000000');
  }

  private updateAtmosphere(): void {
    const p = this.player.position;
    this.sun.position.set(p.x - 28, 60, p.z + 24);
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.target.updateMatrixWorld();
    // The few real lights hop between the torches nearest him.
    const torches = [...this.dungeon.layout.torches].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    this.lampLights.forEach((l, i) => {
      const t = torches[i];
      if (!t) {
        l.intensity = 0;
        return;
      }
      l.position.set(t.x, t.y + 1, t.z);
      l.intensity = 40 + Math.sin(this.time * 9 + i * 2) * 1.5;
    });
  }

  private step(input: InputState, dt: number, input2: InputState | null = null): void {
    if (input.mapTogglePressed || input2?.mapTogglePressed) this.hud.toggleBigMap();
    this.time += dt;
    if (this.done !== null) {
      this.done += dt;
      this.hud.setFade(Math.min(1, Math.max(0, (this.done - (DONE_DELAY - 1)) / 1)), '#000000');
      if (this.done >= DONE_DELAY) {
        const url = new URL(window.location.href);
        url.searchParams.set('mission', '6');
        url.searchParams.set('resume', '1');
        url.searchParams.delete('stage');
        window.location.href = url.toString();
      }
    } else if (this.caught > 0) {
      this.caught += dt;
      this.hud.setFade(Math.min(1, Math.max(0, (this.caught - 1.2) / 0.8)), '#000000');
      if (this.caught > 2.2) this.restart();
    } else {
      this.stepFoot(input, dt, input2);
    }
    this.cam.update(this.player, dt);
    if (this.player2) this.cam2.update(this.player2, dt);
    this.dungeon.update(dt);
    this.impacts.update(dt);
    this.updateTracers(dt);
    this.cones.update(this.camera.position, this.time, this.player2 ? this.camera2.position : undefined);
    this.updateAtmosphere();
    if (import.meta.env.DEV && this.debugCam) {
      this.camera.position.set(...this.debugCam.pos);
      this.camera.lookAt(...this.debugCam.look);
    }
  }

  private stepFoot(input: InputState, dt: number, input2: InputState | null = null): void {
    if (input.cameraTogglePressed) this.cam.toggle();
    if (this.player.isDown) this.downTime += dt;
    const p = this.player.position;
    const before = p.clone();
    if (input.megaJamPressed) this.toggleDisguise();
    const wasDown = this.player.isDown;
    // Fire starts a takedown or a shot once per press (holding it is a stream of rifle shots).
    if (this.player.step(input, dt)) {
      const behind = this.takedownTarget();
      if (!behind) this.fireRifle();
      else if (!this.wasFiring) this.takedown(behind);
    }
    this.wasFiring = input.firing;
    if (input.resetPressed || (wasDown && !this.player.isDown && this.player.health === 0)) this.toGate();
    this.updateJam(input, dt);
    this.updateDisguise(dt, Math.hypot(p.x - before.x, p.z - before.z));
    if (this.player2 && input2) {
      this.withPlayer2(() => {
        if (input2.cameraTogglePressed) this.cam.toggle();
        if (this.player.isDown) this.downTime += dt;
        const p2 = this.player.position;
        const p2Before = p2.clone();
        if (input2.megaJamPressed) this.toggleDisguise();
        const wasDown2 = this.player.isDown;
        if (this.player.step(input2, dt)) {
          const behind = this.takedownTarget();
          if (!behind) this.fireRifle();
          else if (!this.wasFiring) this.takedown(behind);
        }
        this.wasFiring = input2.firing;
        if (input2.resetPressed || (wasDown2 && !this.player.isDown && this.player.health === 0)) this.toGate();
        this.updateJam(input2, dt);
        this.updateDisguise(dt, Math.hypot(p2.x - p2Before.x, p2.z - p2Before.z));
      });
      if (this.player2.position.z < YARD_Z - 10) this.entered = true;
    }
    if (p.z < YARD_Z - 10) this.entered = true;
    this.updateCells(dt);
    this.updateFreed(dt);

    const exposed = !this.player.isDown && !this.player.disguised;
    const p2 = this.player2?.position;
    const p2Exposed = !!this.player2 && !this.player2.isDown && !this.player2.disguised;
    const world: GuardWorld = {
      player: exposed ? p : null,
      sneaking: this.player.sneaking,
      players: [...(exposed ? [{ position: p, sneaking: this.player.sneaking }] : []), ...(p2Exposed && p2 ? [{ position: p2, sneaking: this.player2!.sneaking }] : [])],
      targets: [...(exposed ? [p] : []), ...(p2Exposed && p2 ? [p2] : [])],
      sees: (a, b) => this.sees(a, b),
      nav: null,
      sector: 'compound',
    };
    for (const shot of this.guards.update(dt, world)) this.resolveGuardShot(shot);
    for (const e of this.guards.takeEvents()) {
      if (e.kind !== 'alarm') continue;
      this.stats.alarms++;
      if (this.time - this.lastAlarmAt < 6) continue;
      this.lastAlarmAt = this.time;
      this.sound.music.alarm();
      this.hud.showBanner('SPOTTED!', 'The jailers are on to you: break their line of sight and creep away (Shift), or fight');
    }
    this.world.step();

    // Out of the gate (having been in): done.
    const escaped = (at: THREE.Vector3) => this.entered && at.z > YARD_Z - 2 && Math.abs(at.x) < GATE_HALF + 1;
    if (escaped(p) || (p2 && escaped(p2))) this.finish();
  }

  // ---------- HUD ----------

  private stealthMeter(): PrisonHUD['stealth'] {
    if (this.player.isDown) return null;
    if (this.player.disguised) {
      return this.suspicion > 0.05
        ? { level: this.suspicion, label: 'A JAILER IS LOOKING YOU OVER…', color: '#ff8a3a' }
        : { level: 0, label: 'DISGUISED AS A JAILER', color: '#9be27a' };
    }
    const alarmed = this.guards.alarmed;
    if (alarmed > 0) return { level: 1, label: `SPOTTED: ${alarmed} JAILER${alarmed === 1 ? '' : 'S'} ON TO YOU`, color: '#ff4a38' };
    const level = this.guards.suspicion;
    const creeping = this.player.sneaking ? ' · CREEPING' : '';
    if (level > 0.05) return { level, label: `SUSPICIOUS${creeping}`, color: '#ffc040' };
    return { level: 0, label: `UNSEEN${creeping}`, color: '#9be27a' };
  }

  private prisonHUD(input: InputState): PrisonHUD {
    const p = this.player.position;
    const cells = this.dungeon.layout.cells;
    const down = this.player.downFor;
    let prompt: string | null = null;
    const unlocking = [...this.unlocking.values()].some((t) => t > 0);
    if (down > 0) prompt = `Knocked down! Back on your feet at the gate in ${Math.ceil(down)}…`;
    else if (this.caught > 0) prompt = 'Caught!';
    else if (this.done !== null) prompt = null;
    else if (unlocking) prompt = 'Unlocking the cell…';
    else if (this.guards.alarmed > 0) prompt = `The jailers are on to you! Break line of sight and creep away (${!input.keyboardEnabled ? 'RB' : input.keyboardPlayer === 2 ? 'Right Shift' : 'Shift'}), or fight`;
    else if (this.opened < cells.length) {
      const next = cells.find((c) => !c.opening);
      const toCells = next ? Math.hypot(p.x - next.x, p.z - DOOR_Z) : 99;
      prompt = this.opened === 0 && toCells > 12 ? `Get to the cells at the north end of the yard. Press ${this.player === this.player2 && this.settings.player2Controller === -1 ? 'Numpad 7' : 'X'} to put on a jailer disguise (not when they have seen you)` : toCells < 8 ? 'Stand at a cell door to unlock it' : null;
    } else prompt = 'All the cells are open: lead them out of the gate!';
    if (!prompt && this.entered && this.opened > 0 && p.z > 20) prompt = 'Out of the gate, with everyone behind you';
    const status: string[] = [];
    if (this.player.disguised) status.push(`Disguised: ${this.player === this.player2 && this.settings.player2Controller === -1 ? 'Numpad 7' : 'X'} takes it off · don't run, keep away from the jailers`);
    const downed = this.guards.list.filter((g) => g.state === 'down').length;
    if (downed > 0) status.push(`${downed} jailer${downed === 1 ? '' : 's'} knocked out`);
    return {
      title: this.request.royal ? 'ROYAL DUNGEON' : 'JAILBREAK',
      objectives: [
        { label: `Open the cells (${this.opened}/${cells.length})`, done: this.opened === cells.length },
        { label: `Lead them out of the gate (${this.freedCount} of ${this.request.held} free)`, done: this.done !== null && this.freedCount > 0 },
      ],
      prompt,
      downFor: down,
      jam: this.jamTank,
      onRaft: false,
      stealth: this.stealthMeter(),
      status,
    };
  }

  private hudState(input: InputState): HUDState {
    const viewport = this.player === this.player2 ? this.playerViewport(2) : this.playerViewport(1);
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
      map: NO_MAP,
      aimScreen: this.hud.paused || this.done !== null ? null : { x: viewport.width / 2, y: viewport.height / 2 },
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
      waypoint: null,
      enemyBasesLeft: 0,
      enemyBasesTotal: 0,
      nearbyBase: null,
      airSupport: null,
      tanker: null,
      siege: null,
      prison: this.prisonHUD(input),
      driveStyle: this.settings.driveStyle,
      mouseCaptureHint: input.keyboardEnabled && !input.pointerLocked && input.pointerLockAvailable,
      soundLocked: this.sound.locked && (this.settings.sfxVolume > 0 || this.settings.musicVolume > 0),
    };
  }

  private render(): void {
    this.renderViews();
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate);
    if (!this.ready) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.input.textEntry = this.hud.editingText;
    this.input.beginFrame();
    const pads = Array.from(navigator.getGamepads?.() ?? []);
    // Solo: any controller (or the keyboard) drives, whatever Player 1 is set to.
    const p2Index = this.player2 ? this.settings.player2Controller : -3;
    const p2KeyboardFirst = this.player2 !== null && p2Index === -1;
    const p1Index = !this.player2
      ? -2
      : this.settings.player1Controller !== -2
        ? this.settings.player1Controller
        : pads.find((pad) => pad && pad.index !== p2Index)?.index ?? -1;
    const lockedMousePlayer: 1 | 2 = this.player2 && p2Index === -1 ? 2 : 1;
    const p2Raw = this.player2 && p2KeyboardFirst
      ? this.input.update(dt, p2Index, 2, this.settings.splitOrientation, false, pads, lockedMousePlayer)
      : null;
    const input = this.input.update(dt, p1Index, 1, this.settings.splitOrientation, this.player2 !== null && p2Index === -1, pads, lockedMousePlayer);
    const input2 = p2Raw ?? (this.player2 ? this.input.update(dt, p2Index, 2, this.settings.splitOrientation, false, pads, lockedMousePlayer) : null);
    const kbMenu = this.input.keyboardMenu();
    input.mapTogglePressed ||= kbMenu.mapTogglePressed;
    if (this.hud.paused) {
      this.sound.updateEngine(0, 'chopper', false);
      this.hud.handleMenu({
        up: input.menu.up || kbMenu.menu.up || (input2?.menu.up ?? false),
        down: input.menu.down || kbMenu.menu.down || (input2?.menu.down ?? false),
        left: input.menu.left || kbMenu.menu.left || (input2?.menu.left ?? false),
        right: input.menu.right || kbMenu.menu.right || (input2?.menu.right ?? false),
        confirm: input.menu.confirm || kbMenu.menu.confirm || (input2?.menu.confirm ?? false),
        back: input.menu.back || kbMenu.menu.back || (input2?.menu.back ?? false),
        options: input.menu.options || kbMenu.menu.options || (input2?.menu.options ?? false),
      });
      if ((input.mapTogglePressed || input2?.mapTogglePressed) && this.hud.paused) this.hud.toggleBigMap();
      this.hud.update(this.hudState(input));
      this.updateSecondHud(input2);
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
    this.updateSecondHud(input2);
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
    return { player: this.player, guards: this.guards, dungeon: this.dungeon, world: this.world, freed: this.freed, state: () => ({ suspicion: this.suspicion, caught: this.caught, done: this.done, opened: this.opened, freed: this.freedCount, entered: this.entered }) };
  }
}
