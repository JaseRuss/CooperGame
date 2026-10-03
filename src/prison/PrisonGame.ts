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
import { Facility, ROOF_TOP, type ClimbSpot, type FacilityLayout, type ZoneId } from './Facility';
import { Searchlights } from './Searchlights';
import { Breakout } from './Breakout';
import { Outside, loadTreeModels } from './Outside';
import { CameraRig } from '../camera/CameraRig';
import { PlayerSoldier, MAX_HEALTH } from './PlayerSoldier';
import { ShoulderCam } from './ShoulderCam';
import { Cells } from './Cells';
import { Followers, type PrisonerSpot, type SquadWorld } from './Followers';
import { Guards, type Guard, type Shot } from './Guards';
import { NavGraph } from './NavGraph';
import { Towers } from './Towers';
import { Flag } from './Flag';
import type { Cell } from './Cells';
import { FRIEND_SHOTS, ENEMY_SHOTS, WALLS_ONLY } from './groups';

const SKY = 0x2a3550;
/** The sun's shadow box follows the player; the compound is small, so it can be tight and sharp. */
const SHADOW_HALF = 45;
const SHOT_RANGE = 220;
const TRACER_TIME = 0.06;
/**
 * Who's locked in each cell: Cell Block A (the first is the player's own), Cell Block B, then
 * the punishment hut. Which cells hold the buddies (cell: buddy), and the medics.
 */
const CELL_PRISONERS = [0, 1, 1, 2, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 1];
const BUDDY_CELLS: Record<number, number> = { 1: 0, 2: 1, 9: 2, 14: 3 };
const MEDIC_CELLS = [4, 11];
/**
 * The opening, after Alcatraz's 1962 escape: out through the vent at the back of the cell,
 * along the pipe chase (letting Keston and Max out through theirs), up the pipes to the roof,
 * across it past the searchlights and down the bakery pipe. From there it's a fight.
 */
type EscapeStage = 'cell' | 'pipechase' | 'roof' | 'out';
/** Seconds to climb up the pipes, and down the bakery pipe. */
const CLIMB_UP_TIME = 3.2;
const CLIMB_DOWN_TIME = 2.8;
/** He starts a climb when he's this close to the foot (or top) of it. */
const CLIMB_REACH = 1.1;
const VENT_PROMPT_RANGE = 4;
/** The opening flyover: where the camera is and what it looks at, at each second-or-so mark, and how long it runs. */
const INTRO: { at: number; pos: [number, number, number]; look: [number, number, number] }[] = [
  { at: 0, pos: [0, 70, -160], look: [0, 0, -10] },
  { at: 2.5, pos: [70, 40, -50], look: [0, 3, 0] },
  { at: 4.5, pos: [34, 20, 2], look: [-10, 4, 20] },
  { at: 6, pos: [8, 14, 6], look: [-18, 2, 18] },
];
const INTRO_TIME = 6;
/** The "last guard" arrow shows when a part of the prison is down to this many, and he's this far off. */
const LAST_GUARDS = 2;
const LAST_GUARD_RANGE = 12;
/** Prompts for the lever box, a tower and the flag show this close. */
const LEVER_PROMPT_RANGE = 16;
const TOWER_PROMPT_RANGE = 14;
const FLAG_PROMPT_RANGE = 30;
/** "Shoot the padlock" shows when he's this close to a locked door. */
const LOCK_PROMPT_RANGE = 5;
/** A guard's rifle hit on the player. */
const GUARD_DAMAGE = 5;
/** Down this long at most waiting for a medic, before he's back at the checkpoint anyway. */
const MEDIC_WAIT = 15;
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

/** What the pause screen's first page shows on foot, instead of the map. */
const CONTROLS =
  '<span><b>Move</b> left stick · W A S D</span><span><b>Aim</b> right stick · mouse</span>' +
  '<span><b>Fire</b> RT · click (padlocks, levers, tower legs and flags can all be shot)</span><span><b>Jam riot cannon</b> hold LT · hold E</span>' +
  '<span><b>Squad: follow me / hold here</b> X · X</span><span><b>Camera</b> Y · C</span><span><b>Back to checkpoint</b> Back · R</span>';

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

/**
 * The bonus level: a prison break on foot. Its own small game rather than a mode of `Game`,
 * which is built round driving the tank across the big map. It reuses the same input, HUD,
 * sound, physics and effects.
 *
 * So far: break out of your cell, free Cell Block A, then take the yard (and its towers), Cell
 * Block B and the barracks with the squad behind you. Beaten guards are carried off to the
 * cells, and the squad's medics patch up anyone who's knocked down.
 */
export class PrisonGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: InputManager;
  private readonly hud: HUD;
  private readonly sound = new Sound(MISSION);
  private readonly sun: THREE.DirectionalLight;
  private readonly clock = new THREE.Clock();
  private readonly loadingLabel: HTMLDivElement;
  private settings: Settings = loadSettings();
  private ready = false;
  private pausedRendered = false;
  private world!: RAPIER.World;
  private impacts!: ImpactEffects;
  private jam!: JamCannon;
  private facility!: Facility;
  private player!: PlayerSoldier;
  private cam!: ShoulderCam;
  private cells!: Cells;
  private followers!: Followers;
  private guards!: Guards;
  private nav!: NavGraph;
  private towers!: Towers;
  private flag!: Flag;
  /** The parts of the prison already taken (each announced once). */
  private readonly taken = new Set<ZoneId>();
  private allTaken = false;
  private time = 0;
  private squadWorld!: SquadWorld;
  /** Where he gets back up: his cell, until he's out of it. */
  private checkpoint: { x: number; z: number; yaw: number; y?: number } = { x: 0, z: 0, yaw: 0 };
  private escape: EscapeStage = 'cell';
  private searchlights!: Searchlights;
  private breakout!: Breakout;
  private outside!: Outside;
  /** The tank's chase camera, once he's back in it (the main game's). */
  private rig!: CameraRig;
  private inTank = false;
  /** How many prisoners (not counting the buddies) rode out in the trucks. */
  private passengers = 0;
  /** The ending at Cooper's Base: seconds since it started (null until then). */
  private ending: number | null = null;
  /** The opening flyover: seconds into it (null once it's over). */
  private intro: number | null = 0;
  private lastTankSpot = new THREE.Vector3();
  /** Dev only: pins the camera for screenshots. */
  debugCam: { pos: [number, number, number]; look: [number, number, number] } | null = null;
  /** Mid-climb: the way he goes (waypoints), how far along (0..1), how long it takes, which way he faces, and what happens at the end. */
  private climbing: { path: THREE.Vector3[]; t: number; duration: number; yaw: number; spot: ClimbSpot; up: boolean } | null = null;
  /** How close the searchlights are to spotting him (0..1). */
  private spotted = 0;
  /** The jam riot cannon's tank (0..1) and the time to its next glob. */
  private jamTank = 1;
  private jamCooldown = 0;
  /** How long he's been down, waiting on a medic. */
  private downTime = 0;
  private readonly tracers: { line: THREE.Line; age: number }[] = [];
  private readonly friendTracer = new THREE.LineBasicMaterial({ color: 0xffe7a0, transparent: true });
  private readonly enemyTracer = new THREE.LineBasicMaterial({ color: 0xff9a5a, transparent: true });

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    const graphics = GRAPHICS_QUALITY[this.settings.graphicsQuality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = graphics.shadowSize > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 600);
    this.input = new InputManager(this.renderer.domElement);
    this.hud = new HUD(container);
    this.hud.setSoundHook((kind) => this.sound.play(kind === 'move' ? 'uiMove' : kind === 'change' ? 'uiChange' : kind === 'back' ? 'uiBack' : kind === 'open' ? 'uiOpen' : 'uiConfirm', { volume: 0.5, minGap: 0 }));

    this.loadingLabel = document.createElement('div');
    this.loadingLabel.style.cssText =
      'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;' +
      "font-size:22px; background:#0a0e14; color:#e8eef5; font-family:'Segoe UI',system-ui,sans-serif; z-index:10;";
    this.loadingLabel.textContent = 'Loading prison…';
    container.appendChild(this.loadingLabel);

    // Early evening under floodlights: dark enough to feel like a break-out, light enough to play.
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 90, 320);
    this.scene.add(new THREE.HemisphereLight(0xb8c8e8, 0x6a6458, 1.25));
    this.sun = new THREE.DirectionalLight(0xffe2b0, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(graphics.shadowSize || 1024, graphics.shadowSize || 1024);
    const sh = this.sun.shadow.camera;
    sh.left = sh.bottom = -SHADOW_HALF;
    sh.right = sh.top = SHADOW_HALF;
    sh.far = 200;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.onResize());
    void this.init();
  }

  private async init(): Promise<void> {
    await initPhysics();
    this.world = createWorld();
    this.impacts = new ImpactEffects(this.scene);
    // The prison's ground is flat (y = 0), and the jam goes past the squad.
    this.jam = new JamCannon(this.scene, () => 0, FRIEND_SHOTS);
    this.facility = new Facility(this.world);
    this.scene.add(this.facility.group);
    const layout = this.facility.layout;
    this.player = new PlayerSoldier(this.world, layout.start.x, layout.start.z, layout.start.yaw);
    this.scene.add(this.player.root);
    this.cam = new ShoulderCam(this.camera, this.world);
    this.cells = new Cells(this.world, layout.cells, layout.levers, layout.vents);
    this.scene.add(this.cells.group);
    this.followers = new Followers(this.world, prisonerSpots(layout), this.settings.buddyNames);
    this.scene.add(this.followers.group);
    this.guards = new Guards(this.world, layout.guards);
    this.scene.add(this.guards.group);
    this.towers = new Towers(this.world, layout.towers, layout.yardMiddle);
    this.scene.add(this.towers.group);
    this.flag = new Flag(this.world, layout.flag);
    this.scene.add(this.flag.mesh);
    this.searchlights = new Searchlights(this.world, layout.searchlights, ROOF_TOP);
    this.scene.add(this.searchlights.group);
    this.outside = new Outside(this.world, await loadTreeModels(), layout.road, layout.home, layout.ground);
    this.scene.add(this.outside.group);
    this.rig = new CameraRig(this.camera);
    this.breakout = new Breakout(this.world, layout, {
      explode: (at, size) => this.impacts.explode(at, size),
      dust: (at) => this.impacts.dustPuff(at),
      puff: (at) => this.impacts.changePuff(at, 1.4),
      sound: (name, at, volume = 1, rate = 1) => this.sound.play(name, { at, volume, rate, minGap: 0.05 }),
      shake: (amount) => this.rig.addShake(amount),
      tracer: (from, to) => this.addTracer(from, to, this.enemyTracer),
      blast: (at, radius) => {
        for (const g of this.guards.list) {
          if ((g.state === 'active' || g.state === 'jammed') && g.pos.distanceTo(at) < radius) g.knockDown(g.pos.clone().sub(at).setY(0).normalize());
        }
      },
      struck: (hit, direction) => this.outside.treeAt(hit)?.knockDown(direction),
    });
    this.scene.add(this.breakout.group);
    this.checkpoint = { ...layout.start };
    // Colliders added this frame aren't in the query pipeline until a step (and the nav graph needs them).
    this.world.step();
    this.nav = new NavGraph(this.world, layout.navPoints, (c) => this.cells.isDoor(c) || this.breakout.isGate(c));
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
        this.hud.showCallout('PATCHED UP BY A MEDIC!', '#9be27a');
      },
      guards: this.guards,
      cells: this.cells,
      nav: this.nav,
      sees: (a, b) => this.sees(a, b),
      camera: this.camera.position,
      doorPosts: layout.doorPosts,
      get quiet() {
        return game.escape !== 'out';
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

    // Sneaking out to the night tune; the prison's own song once it turns into a fight.
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
    const size = graphics.shadowSize || 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(size, size);
    }
    this.input.setAimScale(AIM_SPEED_SCALE[this.settings.aimSpeed]);
    this.sound.setVolumes(this.settings.sfxVolume, this.settings.musicVolume);
    this.followers?.setNameTags(this.settings.nameTags, this.settings.buddyNames);
    this.pausedRendered = false;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.pausedRendered = false;
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

    this.impacts.muzzleFlash(muzzle, dir, 0.3);
    this.sound.play('crack', { volume: 0.28, rate: 2.3, minGap: 0.05 });
    this.cam.addShake(0.08);
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
    const opened = this.cells.hitLever(hit.collider);
    if (opened) {
      this.sound.play('clang', { at: end, volume: 1, rate: 0.7 });
      this.sound.play('launch', { at: end, volume: 0.4, rate: 1.6, fadeAfter: 0.6 });
      this.impacts.dustPuff(end);
      if (opened.length) this.onCellsOpened(opened, true);
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
      if (wasUp && this.player.isDown) this.downTime = 0;
      return;
    }
    const friend = this.followers.hit(hit.collider);
    if (friend?.down) this.hud.showCallout(`${friend.name ? friend.name.toUpperCase() : 'A PRISONER'} IS DOWN! MEDIC!`, '#ff8a7a');
  }

  private onGuardHit(guard: Guard, at: THREE.Vector3, byPlayer: boolean): void {
    this.sound.play('thud', { at, volume: 0.6, rate: 1.3, minGap: 0.05 });
    if (guard.state === 'down' && byPlayer) this.hud.showCallout('GUARD DOWN!', '#ffd24a');
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
    this.followers.gather(this.player.position, this.squadWorld);
  }

  /** A vent grille's knocked out: his own (he's out into the pipe chase), or a buddy's. */
  private onVentOpened(cell: Cell): void {
    if (cell.index === 0) {
      this.escape = 'pipechase';
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
    this.sound.play('clang', { volume: 0.4, rate: 1.4 });
  }

  /** One frame of a climb; at the end he's off it and the squad climbs after him. */
  private updateClimb(dt: number): void {
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
    if (c.up) this.hud.setFade(c.t > 0.7 ? Math.min(1, (c.t - 0.7) * 6) : 0, '#000000');
    if (Math.floor(c.t * 8) !== Math.floor((c.t - dt / c.duration) * 8)) this.sound.play('thud', { volume: 0.2, rate: 2, minGap: 0.1 });
    if (c.t < 1) return;
    this.climbing = null;
    const to = c.spot.to;
    this.player.teleport(to.x, to.z, to.yaw, to.y);
    this.followers.climbAfter(new THREE.Vector3(to.x, to.y, to.z), to.yaw, this.squadWorld);
    this.checkpoint = { ...to };
    if (c.up) {
      this.hud.setFade(0);
      this.escape = 'roof';
      this.searchlights.setActive(true);
      this.hud.showBanner('ON THE ROOF!', 'Keep out of the searchlights and get to the bakery pipe at the far end');
    } else {
      this.escape = 'out';
      this.searchlights.setActive(false);
      this.sound.music.setNight(false);
      this.sound.music.stinger();
      this.hud.showBanner('DOWN THE BAKERY PIPE!', "That's how they got out of Alcatraz. Here it turns into a fight: take the prison!");
    }
  }

  /** On the roof: caught in a searchlight, he's back at the ventilator. */
  private updateSearchlights(dt: number): void {
    const p = this.player.position;
    this.spotted = this.searchlights.update(dt, p, this.escape === 'roof' && this.facility.layout.onRoof(p.x, p.y, p.z));
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
      this.hud.showBanner(`${freed.toUpperCase()} IS FREE!`, 'Your buddies will help you get your tank back');
    } else if (this.followers.stayedBehind) {
      this.hud.showCallout(`+${out} · ${this.followers.stayedBehind} STAY TO HOLD THE PRISON`, '#9be27a');
    } else {
      this.hud.showCallout(`+${out} · SQUAD ${this.followers.count}`, '#9be27a');
    }
    this.sound.play('uiConfirm', { volume: 0.6 });
  }

  /** Still in the fight in a part of the prison (on their feet, stuck in jam or not). */
  private guardsLeft(zone: ZoneId): number {
    return this.guards.list.filter((g) => g.post.zone === zone && (g.state === 'active' || g.state === 'jammed')).length;
  }

  /** The cells in a part of the prison, and how many are open. */
  private cellsIn(zone: ZoneId): { open: number; total: number } {
    const cells = this.cells.all.filter((c) => c.spot.block === zone && c.index !== 0);
    return { open: cells.filter((c) => !c.locked || c.vented).length, total: cells.length };
  }

  /** Is that part of the prison ours yet? */
  private isTaken(zone: ZoneId): boolean {
    if (this.guardsLeft(zone) > 0) return false;
    const cells = this.cellsIn(zone);
    if (cells.open < cells.total) return false;
    if (zone === 'yard') return this.towers.standing === 0;
    if (zone === 'barracks') return this.flag.captured;
    return true;
  }

  /** Announces each part of the prison as it's taken, and moves the checkpoint up to it. */
  private checkZones(): void {
    for (const zone of this.facility.layout.zones) {
      if (this.taken.has(zone.id) || !this.isTaken(zone.id)) continue;
      this.taken.add(zone.id);
      if (!this.cells.all[0].locked) this.checkpoint = { ...zone.checkpoint };
      this.hud.showBanner(`${zone.name.toUpperCase()} IS OURS!`, this.taken.size < this.facility.layout.zones.length ? `${this.facility.layout.zones.length - this.taken.size} more to go` : '');
      this.sound.play('uiConfirm', { volume: 0.8 });
    }
    if (!this.allTaken && this.taken.size === this.facility.layout.zones.length) {
      this.allTaken = true;
      this.breakout.openLot();
      this.hud.showBanner('THE PRISON IS OURS!', "The motor pool's gate is open: get your tank back!");
    }
  }

  private prisonHUD(): PrisonHUD {
    const p = this.player.position;
    const down = this.player.downFor;
    const cells = this.cells.all;
    const names = this.settings.buddyNames;
    const buddies = this.followers.buddiesHere;
    const freed = this.followers.buddiesFreed;
    const nearLock = cells.some((c) => c.locked && c.padlocked && Math.hypot(c.lockAt.x - p.x, c.lockAt.z - p.z) < LOCK_PROMPT_RANGE);
    const nearLever = this.cells.leversLeft.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < LEVER_PROMPT_RANGE);
    const nearTower = this.towers.up.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < TOWER_PROMPT_RANGE);
    const flagSpot = this.facility.layout.flag;
    const nearFlag = !this.flag.captured && Math.hypot(flagSpot.x - p.x, flagSpot.z - p.z) < FLAG_PROMPT_RANGE;
    const squad = this.followers.count;
    const total = this.guards.total;
    const friendDown = this.player.isDown ? null : this.followers.downNear(p, 6);
    let prompt: string | null = null;

    const ventNear = this.cells.ventsLeft.find((v) => v.cell !== 0 && Math.hypot((v.x0 + v.x1) / 2 - p.x, v.z - p.z) < VENT_PROMPT_RANGE);
    if (this.climbing) {
      prompt = this.climbing.up ? 'Climbing up the pipes…' : 'Sliding down the bakery pipe…';
    } else if (this.escape === 'roof' && this.spotted > 0) {
      prompt = "You're in the light! Get out of it!";
    } else if (down > 0) {
      prompt = this.followers.medicComing ? 'Knocked down! Hang on, a medic is coming…' : `Knocked down! Back on your feet in ${Math.ceil(down)}…`;
    } else if (this.escape === 'cell') {
      prompt = 'The grille at the back of your cell is loose: shoot it out!';
    } else if (ventNear) {
      const buddy = BUDDY_CELLS[ventNear.cell];
      prompt = `Shoot the grille to let ${buddy === undefined ? 'them' : names[buddy]} out`;
    } else if (this.escape === 'pipechase') {
      prompt = 'Climb the pipes at the far (east) end of the pipe chase';
    } else if (this.escape === 'roof') {
      prompt = 'Keep out of the searchlights! Get to the bakery pipe at the far (west) end';
    } else if (this.inTank) {
      prompt = this.ending !== null ? null : !this.breakout.gateOpen ? 'Shoot the main gate to blow it open!' : 'Follow the road north, home to Cooper\'s Base!';
    } else if (this.breakout.lotOpen && Math.hypot(this.breakout.tank.position.x - p.x, this.breakout.tank.position.z - p.z) < 12) {
      prompt = 'Walk up to your tank to climb back in!';
    } else if (friendDown) {
      const who = friendDown.name ?? 'A friend';
      prompt = friendDown.progress > 0 ? `Helping ${who} up… ${Math.round(friendDown.progress * 100)}%` : `${who} is down: stand right next to them to help them up`;
    } else if (nearLever) {
      prompt = 'Shoot the yellow lever box to open every cell in the block!';
    } else if (nearLock) {
      prompt = 'Shoot the padlock to open the cell';
    } else if (nearTower) {
      prompt = "Shoot the tower's legs to bring it down";
    } else if (nearFlag) {
      prompt = 'Shoot their flag off the barracks roof! (Stand back for a clear shot over the edge)';
    }
    return {
      title: this.inTank ? 'PRISON BREAK · THE BREAKOUT' : `PRISON BREAK${this.escape !== 'out' ? ' · THE ESCAPE' : ''}${squad ? ` · SQUAD ${this.followers.standing}${this.followers.isHolding ? ' (HOLDING)' : ''}` : ''}${this.followers.onGuard ? ` · ${this.followers.onGuard} ON GUARD` : ''}`,
      objectives: this.escape !== 'out' ? this.escapeObjectives() : this.allTaken ? this.breakoutObjectives() : [
        ...this.facility.layout.zones.map((z) => ({ label: `${z.name}: ${this.zoneProgress(z.id)}`, done: this.taken.has(z.id) })),
        { label: `Free your buddies (${freed.length} / ${buddies.length})${freed.length ? `: ${freed.map((b) => names[b]).join(', ')}` : ''}`, done: freed.length === buddies.length },
        { label: `Lock the guards in the cells (${this.guards.jailed} / ${total})`, done: this.guards.jailed === total },
      ],
      prompt,
      downFor: down,
      inTank: this.inTank,
      jam: this.jamTank,
    };
  }

  /** The checklist for the breakout, once the prison's taken. */
  private breakoutObjectives(): { label: string; done: boolean }[] {
    const left = this.guardsLeft('motorpool');
    const b = this.breakout;
    return [
      { label: `Get your tank back from the motor pool${left && !this.inTank ? ` · ${left} guard${left === 1 ? '' : 's'}` : ''}`, done: this.inTank },
      { label: 'Blast the main gate open', done: b.gateOpen },
      { label: `Drive home to Cooper's Base${this.inTank && !b.home ? ` (${Math.round(b.distanceHome)} m)` : ''}`, done: b.home },
    ];
  }

  /** Where the gold arrow points: the tank, then the main gate, then home. */
  private waypoint(): HUDState['waypoint'] {
    if (this.intro !== null || this.ending !== null) return null;
    if (!this.allTaken) return this.lastGuardWaypoint();
    const layout = this.facility.layout;
    if (!this.inTank) return this.waypointTo(this.breakout.tank.position.clone().setY(2.5), 'YOUR TANK');
    if (!this.breakout.gateOpen) return this.waypointTo(new THREE.Vector3(0, 3, layout.mainGate.z), 'MAIN GATE');
    return this.waypointTo(new THREE.Vector3(layout.home.x, 4, layout.home.z), `HOME ${Math.round(this.breakout.distanceHome)} m`);
  }

  /**
   * When a part of the prison is down to its last guard or two (they can be easy to miss, round
   * the back of a building), an arrow to the nearest of them.
   */
  private lastGuardWaypoint(): HUDState['waypoint'] {
    if (this.escape !== 'out') return null;
    const p = this.player.position;
    let best: { at: THREE.Vector3; d: number; n: number } | null = null;
    for (const zone of this.facility.layout.zones) {
      const n = this.guardsLeft(zone.id);
      if (this.taken.has(zone.id) || n === 0 || n > LAST_GUARDS) continue;
      for (const g of this.guards.list) {
        if (g.post.zone !== zone.id || (g.state !== 'active' && g.state !== 'jammed')) continue;
        const d = g.pos.distanceTo(p);
        if (!best || d < best.d) best = { at: g.chest(), d, n };
      }
    }
    if (!best || best.d < LAST_GUARD_RANGE) return null;
    return this.waypointTo(best.at.setY(best.at.y + 1.5), best.n > 1 ? 'LAST GUARDS' : 'LAST GUARD');
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

  /** Where the tank's next shell comes down, on screen (null off it). */
  private tankAim(): { x: number; y: number } | null {
    const ndc = this.breakout.aim().project(this.camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
    return { x: ((ndc.x + 1) / 2) * window.innerWidth, y: ((1 - ndc.y) / 2) * window.innerHeight };
  }

  /** The checklist while he's escaping (Alcatraz-style), before it turns into a fight. */
  private escapeObjectives(): { label: string; done: boolean }[] {
    const names = this.settings.buddyNames;
    const ventBuddies = this.facility.layout.vents.filter((v) => v.cell !== 0).map((v) => v.cell);
    const out = ventBuddies.filter((c) => this.cells.all[c].vented).length;
    const who = ventBuddies.map((c) => names[BUDDY_CELLS[c]]).join(' and ');
    const stage = ['cell', 'pipechase', 'roof', 'out'].indexOf(this.escape);
    return [
      { label: 'Out through the loose vent at the back of your cell', done: stage > 0 },
      { label: `Let ${who} out through their vents (${out} / ${ventBuddies.length})`, done: out === ventBuddies.length },
      { label: 'Climb the pipes up to the roof', done: stage > 1 },
      { label: 'Across the roof without being spotted, and down the bakery pipe', done: stage > 2 },
    ];
  }

  /** What's left to do in a part of the prison, for the HUD's checklist. */
  private zoneProgress(zone: ZoneId): string {
    if (this.taken.has(zone)) return 'taken';
    const bits: string[] = [];
    const cells = this.cellsIn(zone);
    if (cells.total && cells.open < cells.total) bits.push(zone === 'barracks' ? 'the punishment hut' : `cells ${cells.open} / ${cells.total}`);
    if (zone === 'yard' && this.towers.standing) bits.push(`towers ${this.towers.total - this.towers.standing} / ${this.towers.total}`);
    if (zone === 'barracks' && !this.flag.captured) bits.push('their flag');
    const left = this.guardsLeft(zone);
    if (left) bits.push(`${left} guard${left === 1 ? '' : 's'}`);
    return bits.join(' · ');
  }

  private hudState(input: InputState): HUDState {
    return {
      zombies: null,
      health: this.inTank ? this.breakout.tank.maxHealth : this.player.health,
      maxHealth: this.inTank ? this.breakout.tank.maxHealth : MAX_HEALTH,
      reloadFraction: this.inTank ? this.breakout.tank.fireCooldown / this.breakout.tank.fireInterval : 0,
      damageBoost: 0,
      ride: null,
      cameraMode: this.inTank ? this.rig.mode : this.cam.mode,
      usingGamepad: input.usingGamepad,
      insideBase: null,
      map: NO_MAP,
      aimScreen: this.hud.paused || this.ending !== null ? null : this.inTank ? this.tankAim() : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
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
    const input = this.input.update(dt);

    if (this.hud.paused) {
      this.sound.updateEngine(0, 'tank', false);
      this.hud.handleMenu(input.menu);
      if (input.mapTogglePressed && this.hud.paused) this.hud.toggleBigMap();
      this.hud.update(this.hudState(input));
      if (!this.pausedRendered) {
        this.renderer.render(this.scene, this.camera);
        this.pausedRendered = true;
      }
      return;
    }
    this.pausedRendered = false;
    if (this.intro !== null) this.updateIntro(input, dt);
    else this.step(input, dt);
    this.sound.setListener(this.camera);
    this.hud.update(this.hudState(input));
    this.renderer.render(this.scene, this.camera);
    this.hud.recordFrame();
  };

  /** Back in the tank: the player's off the field, the squad's aboard (buddies on the hull, the rest in the trucks). */
  private boardTank(): void {
    this.inTank = true;
    this.player.setVisible(false);
    this.player.root.visible = false;
    this.player.collider.setEnabled(false);
    this.breakout.tank.setCommanderVisible(true);
    const aboard = this.followers.board(this.squadWorld);
    this.passengers = aboard.others;
    const names = this.settings.buddyNames;
    this.breakout.board(aboard.buddies.map((b) => ({ name: names[b] })), aboard.others, this.settings.nameTags);
    this.breakout.tank.driveStyle = this.settings.driveStyle;
    this.lastTankSpot.copy(this.breakout.tank.position);
    this.hud.showBanner('BACK IN YOUR TANK!', 'Your buddies are on the hull and everyone else is in the trucks. Blow the main gate open!');
    this.sound.music.stinger();
  }

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
      this.hud.showBanner('BONUS: PRISON BREAK', "They've locked you up and taken your tank! The vent at the back of your cell is loose...");
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
    this.guards.update(dt, [], () => false);
    this.flag.update(dt, this.time);
    this.world.step();
  }

  /** One frame in the tank: drive, shoot, and the trucks and the raiders follow. */
  private stepTank(input: InputState, dt: number): void {
    const tank = this.breakout.tank;
    if (this.ending !== null) {
      this.updateEnding(input, dt);
    } else {
      if (input.cameraTogglePressed) this.rig.toggle();
      const shot = tank.step(input, dt);
      // The engine note rises with the tank's speed.
      const moved = Math.hypot(tank.position.x - this.lastTankSpot.x, tank.position.z - this.lastTankSpot.z);
      this.lastTankSpot.copy(tank.position);
      this.sound.updateEngine(dt > 0 ? Math.min(30, moved / dt) : 0, 'tank', true);
      if (shot) this.breakout.fire(shot.origin, shot.direction);
      if (input.jamFiring) {
        const glob = tank.tryJam();
        if (glob) this.jam.fire(glob.origin, glob.direction, JAM_SPEED * glob.speedScale, true);
      }
      this.rig.update(tank, dt);
      if (this.breakout.home) this.startEnding();
    }
    this.updateJam({ ...input, jamFiring: false }, dt);
    for (const shot of this.guards.update(dt, [tank.position], (a, b) => this.sees(a, b))) this.resolveShot(shot, 'enemy');
    this.world.step();
    this.time += dt;
    this.breakout.update(dt, this.time);
    this.outside.update(dt, tank.position);
    this.flag.update(dt, this.time);
    this.towers.update(dt);
    this.cells.update(dt);
    this.impacts.update(dt);
    this.updateTracers(dt);
    const p = tank.position;
    this.sun.position.set(p.x + 30, p.y + 60, p.z + 20);
    this.sun.target.position.copy(p);
  }

  /** Home at Cooper's Base: everyone jumps down and cheers, and the end screen comes up. */
  private startEnding(): void {
    this.ending = 0;
    this.sound.updateEngine(0, 'tank', false);
    this.breakout.arrive();
    this.outside.cheer();
    this.sound.music.fanfare();
    this.hud.showEnding(
      true,
      'MISSION ACCOMPLISHED!',
      `You broke out with your buddies and ${this.passengers} more prisoners, locked up ${this.guards.jailed} guards, knocked out ${this.breakout.jeepsKnockedOut} jeeps and got your tank home to Cooper's Base!`,
    );
  }

  /** The ending: the camera circles the party; A / Enter plays again. */
  private updateEnding(input: InputState, dt: number): void {
    const t = (this.ending = (this.ending ?? 0) + dt);
    this.breakout.celebrate(this.time);
    this.outside.update(dt, null);
    const c = this.breakout.tank.position;
    const a = t * 0.25;
    this.rig.updateCinematic(new THREE.Vector3(c.x + Math.sin(a) * 18, 9, c.z + Math.cos(a) * 18), c.clone().setY(1.5), dt, 2);
    if (t > 3) this.hud.setVictoryFooter('Press A / Enter to play it again (or Start / M for the level select)');
    if (t > 3 && input.menu.confirm) startMission(MISSION);
  }

  /** One frame of the game (everything but drawing it). */
  private step(input: InputState, dt: number): void {
    if (input.mapTogglePressed) this.hud.toggleBigMap();
    if (this.inTank) {
      this.stepTank(input, dt);
      return;
    }
    if (input.cameraTogglePressed) this.cam.toggle();
    if (input.megaJamPressed && this.followers.count > 0) {
      const holding = this.followers.toggleHold();
      this.hud.showCallout(holding ? 'SQUAD: HOLD HERE' : 'SQUAD: FOLLOW ME', holding ? '#ffd24a' : '#9be27a');
      this.sound.play('uiChange', { volume: 0.5 });
    }

    // Down and a medic on the way: he stays down for them (up to a point) instead of going back to the checkpoint.
    if (this.player.isDown) {
      this.downTime += dt;
      if (this.followers.medicComing && this.downTime < MEDIC_WAIT) this.player.downFor = Math.max(this.player.downFor, 0.5);
    }
    const layout = this.facility.layout;
    const p = this.player.position;
    if (this.climbing) {
      this.updateClimb(dt);
    } else {
      const wasDown = this.player.isDown;
      if (this.player.step(input, dt)) this.fireRifle();
      // Back on his feet at the last checkpoint (with the squad) when asked, or when he gets up with nobody having patched him up.
      if (input.resetPressed || (wasDown && !this.player.isDown && this.player.health === 0)) this.toCheckpoint();
      this.updateJam(input, dt);
      // Up the pipes at the end of the pipe chase; down the bakery pipe from the roof.
      const near = (s: ClimbSpot) => Math.hypot(p.x - s.from.x, p.z - s.from.z) < CLIMB_REACH && Math.abs(p.y - s.from.y) < 1.5;
      if (this.escape === 'pipechase' && near(layout.ladder)) this.startClimb(layout.ladder, true);
      else if (this.escape === 'roof' && near(layout.bakeryPipe)) this.startClimb(layout.bakeryPipe, false);
      else if (!this.player.isDown && this.breakout.canBoard(p)) this.boardTank();
    }
    if (this.escape === 'roof' && !this.climbing) this.updateSearchlights(dt);
    else this.searchlights.update(dt, p, false);

    // Nobody on the roof is shot at from the ground (it's a sneaking bit), and nobody mid-climb.
    const shootable = (at: THREE.Vector3) => !layout.onRoof(at.x, at.y, at.z);
    const playerTarget = this.player.isDown || this.climbing || !shootable(p) ? [] : [p];
    const targets = [...playerTarget, ...this.followers.targets().filter(shootable)];
    for (const shot of this.guards.update(dt, targets, (a, b) => this.sees(a, b))) this.resolveShot(shot, 'enemy');
    for (const shot of this.followers.update(dt, this.squadWorld)) this.resolveShot(shot, 'friend');
    this.world.step();

    this.checkZones();
    this.time += dt;
    this.breakout.update(dt, this.time);
    this.outside.update(dt, null);
    if (this.flag.update(dt, this.time)) this.hud.showCallout('OUR FLAG FLIES OVER THE BARRACKS!', '#9be27a');
    for (const at of this.towers.update(dt)) {
      // The tower crashes down in a cloud of dust.
      const p = new THREE.Vector3(at.x, 0.5, at.z);
      this.sound.play('explosion', { at: p, volume: 0.8, rate: 0.8 });
      this.cam.addShake(0.3);
      for (let i = 0; i < 6; i++) this.impacts.dustPuff(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)));
    }

    this.cam.update(this.player, dt);
    this.cells.update(dt);
    this.impacts.update(dt);
    this.updateTracers(dt);

    this.sun.position.set(p.x + 30, p.y + 60, p.z + 20);
    this.sun.target.position.copy(p);
    if (import.meta.env.DEV && this.debugCam) {
      this.camera.position.set(...this.debugCam.pos);
      this.camera.lookAt(...this.debugCam.look);
    }
  }
}

/** Who's in each cell: a couple of prisoners (some sat waiting), the four buddies and three medics. */
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
        medic: MEDIC_CELLS.includes(i) && j === 0,
        exits,
        ventExits,
      });
    }
  });
  return spots;
}
