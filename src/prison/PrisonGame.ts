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
import { Facility, type CellSpot, type ZoneId } from './Facility';
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
const CELL_PRISONERS = [0, 2, 1, 2, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 1];
const BUDDY_CELLS: Record<number, number> = { 4: 0, 9: 1, 12: 2, 14: 3 };
const MEDIC_CELLS = [2, 6, 11];
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
  private checkpoint = { x: 0, z: 0, yaw: 0 };
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
    this.cells = new Cells(this.world, layout.cells, layout.levers);
    this.scene.add(this.cells.group);
    this.followers = new Followers(this.world, prisonerSpots(layout.cells), this.settings.buddyNames);
    this.scene.add(this.followers.group);
    this.guards = new Guards(this.world, layout.guards);
    this.scene.add(this.guards.group);
    this.towers = new Towers(this.world, layout.towers);
    this.scene.add(this.towers.group);
    this.flag = new Flag(this.world, layout.flag);
    this.scene.add(this.flag.mesh);
    this.checkpoint = { ...layout.start };
    // Colliders added this frame aren't in the query pipeline until a step (and the nav graph needs them).
    this.world.step();
    this.nav = new NavGraph(this.world, layout.navPoints, (c) => this.cells.isDoor(c));
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
    this.hud.showBanner('BONUS: PRISON BREAK', "They've locked you up and taken your tank! Shoot the padlock to get out");
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
    const tower = this.towers.hit(hit.collider, dir);
    if (tower) {
      this.sound.play('thud', { at: end, volume: 0.6, rate: 0.8, minGap: 0.05 });
      if (tower.felled) {
        this.hud.showCallout("TIMBER! THE TOWER'S COMING DOWN!", '#ffd24a');
        // Whoever's up there comes down with it.
        for (const g of this.guards.list) {
          if (g.post.height && g.post.x === tower.x && g.post.z === tower.z && (g.state === 'active' || g.state === 'jammed')) g.knockDown(dir);
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
        const muzzle = this.player.muzzle();
        const dir = this.aimPoint().sub(muzzle);
        // Lobbed up just enough to come down on the crosshair (out to its range), with a bit of
        // scatter: it's a hose, not a rifle.
        const reach = Math.min(JAM_RANGE, Math.hypot(dir.x, dir.z));
        dir.normalize();
        dir.x += (Math.random() - 0.5) * 0.08;
        dir.y += Math.min(0.4, (JAM_GRAVITY * reach) / (2 * JAM_SPEED * JAM_SPEED)) + (Math.random() - 0.5) * 0.05;
        dir.z += (Math.random() - 0.5) * 0.08;
        this.jam.fire(muzzle, dir.normalize(), JAM_SPEED * (0.95 + Math.random() * 0.1));
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
        if (this.guards.jamAt(point, JAM_RADIUS) > 0) this.hud.showCallout('GUARD STUCK IN JAM!', '#ff8aa8');
      },
      (point) => this.guards.jamAt(point, JAM_DRIP_RADIUS),
    );
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
    this.player.teleport(c.x, c.z, c.yaw);
    this.followers.gather(this.player.position, this.squadWorld);
  }

  /** Cells just opened (one padlock, or a whole block from its lever): the prisoners come out. */
  private onCellsOpened(cells: Cell[], byLever = false): void {
    if (cells.some((c) => c.index === 0)) {
      this.checkpoint = { ...this.facility.layout.corridorCheckpoint };
      this.hud.showBanner("YOU'RE OUT!", 'Watch out for the guards! Shoot the padlocks on the other cells and free everyone');
      return;
    }
    const names = this.settings.buddyNames;
    const buddies = cells.flatMap((c) => this.followers.release(c.index));
    const freed = buddies.map((b) => names[b]).join(' & ');
    const out = cells.reduce((n, c) => n + this.followers.inCell(c.index), 0);
    if (byLever) {
      this.hud.showBanner('EVERY DOOR IS OPEN!', `${out} prisoners are out${buddies.length ? `, ${freed} too` : ''}!`);
    } else if (buddies.length) {
      this.hud.showBanner(`${freed.toUpperCase()} IS FREE!`, 'Your buddies will help you get your tank back');
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
    return { open: cells.filter((c) => !c.locked).length, total: cells.length };
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
      this.hud.showBanner('THE PRISON IS OURS!', 'Every part of it is taken. Next: get your tank back from the motor pool');
    }
  }

  private prisonHUD(): PrisonHUD {
    const p = this.player.position;
    const down = this.player.downFor;
    const cells = this.cells.all;
    const own = cells[0];
    const names = this.settings.buddyNames;
    const buddies = this.followers.buddiesHere;
    const freed = this.followers.buddiesFreed;
    const nearLock = cells.some((c) => c.locked && Math.hypot(c.lockAt.x - p.x, c.lockAt.z - p.z) < LOCK_PROMPT_RANGE);
    const nearLever = this.cells.leversLeft.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < LEVER_PROMPT_RANGE);
    const nearTower = this.towers.up.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < TOWER_PROMPT_RANGE);
    const flagSpot = this.facility.layout.flag;
    const nearFlag = !this.flag.captured && Math.hypot(flagSpot.x - p.x, flagSpot.z - p.z) < FLAG_PROMPT_RANGE;
    const squad = this.followers.count;
    const total = this.guards.total;
    const friendDown = this.player.isDown ? null : this.followers.downNear(p, 6);
    let prompt: string | null = null;
    if (down > 0) {
      prompt = this.followers.medicComing ? 'Knocked down! Hang on, a medic is coming…' : `Knocked down! Back on your feet in ${Math.ceil(down)}…`;
    } else if (own.locked) {
      prompt = 'Shoot the padlock on your cell door!';
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
      title: `PRISON BREAK${squad ? ` · SQUAD ${this.followers.standing}${this.followers.isHolding ? ' (HOLDING)' : ''}` : ''}`,
      objectives: [
        ...(own.locked ? [{ label: 'Break out of your cell', done: false }] : []),
        ...this.facility.layout.zones.map((z) => ({ label: `${z.name}: ${this.zoneProgress(z.id)}`, done: this.taken.has(z.id) })),
        { label: `Free your buddies (${freed.length} / ${buddies.length})${freed.length ? `: ${freed.map((b) => names[b]).join(', ')}` : ''}`, done: freed.length === buddies.length },
        { label: `Lock the guards in the cells (${this.guards.jailed} / ${total})`, done: this.guards.jailed === total },
      ],
      prompt,
      downFor: down,
      jam: this.jamTank,
    };
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
      health: this.player.health,
      maxHealth: MAX_HEALTH,
      reloadFraction: 0,
      damageBoost: 0,
      ride: null,
      cameraMode: this.cam.mode,
      usingGamepad: input.usingGamepad,
      insideBase: null,
      map: NO_MAP,
      aimScreen: this.hud.paused ? null : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
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
    this.step(input, dt);
    this.sound.setListener(this.camera);
    this.hud.update(this.hudState(input));
    this.renderer.render(this.scene, this.camera);
    this.hud.recordFrame();
  };

  /** One frame of the game (everything but drawing it). */
  private step(input: InputState, dt: number): void {
    if (input.mapTogglePressed) this.hud.toggleBigMap();
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
    const wasDown = this.player.isDown;
    if (this.player.step(input, dt)) this.fireRifle();
    // Back on his feet at the last checkpoint (with the squad) when asked, or when he gets up with nobody having patched him up.
    if (input.resetPressed || (wasDown && !this.player.isDown && this.player.health === 0)) this.toCheckpoint();
    this.updateJam(input, dt);

    const targets = this.player.isDown ? this.followers.targets() : [this.player.position, ...this.followers.targets()];
    for (const shot of this.guards.update(dt, targets, (a, b) => this.sees(a, b))) this.resolveShot(shot, 'enemy');
    for (const shot of this.followers.update(dt, this.squadWorld)) this.resolveShot(shot, 'friend');
    this.world.step();

    this.checkZones();
    this.time += dt;
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

    const p = this.player.position;
    this.sun.position.set(p.x + 30, p.y + 60, p.z + 20);
    this.sun.target.position.copy(p);
  }
}

/** Who's in each cell: a couple of prisoners (some sat waiting), the four buddies and three medics. */
function prisonerSpots(cells: CellSpot[]): PrisonerSpot[] {
  const spots: PrisonerSpot[] = [];
  cells.forEach((cell, i) => {
    const doorX = (cell.doorX0 + cell.doorX1) / 2;
    const exits = [new THREE.Vector2(doorX, cell.frontZ + 0.9), new THREE.Vector2(doorX, cell.frontZ - 1.6)];
    for (let j = 0; j < (CELL_PRISONERS[i] ?? 0); j++) {
      spots.push({
        x: cell.minX + 1.4 + j * 1.6,
        z: cell.frontZ + 2.6 + (j % 2) * 1.2,
        cell: i,
        kneel: (i + j) % 3 === 0,
        buddy: j === 0 && i in BUDDY_CELLS ? BUDDY_CELLS[i] : null,
        medic: MEDIC_CELLS.includes(i) && j === 0,
        exits,
      });
    }
  });
  return spots;
}
