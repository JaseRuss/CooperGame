import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, createWorld } from '../physics/PhysicsWorld';
import { InputManager, type InputState } from '../input/InputManager';
import { HUD, type HUDState, type PrisonHUD } from '../ui/HUD';
import type { MapView } from '../ui/WorldMap';
import { Sound } from '../audio/Sound';
import { ImpactEffects } from '../combat/ImpactEffects';
import { loadSettings, saveSettings, AIM_SPEED_SCALE, GRAPHICS_QUALITY, type Settings } from '../core/Settings';
import { MISSION, startMission } from '../core/config';
import { Facility } from './Facility';
import { PlayerSoldier, MAX_HEALTH } from './PlayerSoldier';
import { ShoulderCam } from './ShoulderCam';
import { Dummies } from './Dummies';
import { Cells } from './Cells';
import { Followers, type PrisonerSpot } from './Followers';
import { PLAYER_SHOTS } from './groups';
import type { CellSpot } from './Facility';

const SKY = 0x2a3550;
/** The sun's shadow box follows the player; the compound is small, so it can be tight and sharp. */
const SHADOW_HALF = 45;
const SHOT_RANGE = 220;
const TRACER_TIME = 0.06;
/** Who's locked in each of Cell Block A's cells (the first is the player's own), and which holds a buddy. */
const CELL_PRISONERS = [0, 2, 1, 2, 2, 1, 2, 1];
const BUDDY_CELL = 4;
/** "Shoot the padlock" shows when he's this close to a locked door. */
const LOCK_PROMPT_RANGE = 5;

/** What the pause screen's first page shows on foot, instead of the map. */
const CONTROLS =
  '<span><b>Move</b> left stick · W A S D</span><span><b>Aim</b> right stick · mouse</span>' +
  '<span><b>Fire</b> RT · click</span><span><b>Squad: follow me / hold here</b> X · X</span><span><b>Camera</b> Y · C</span><span><b>Back to checkpoint</b> Back · R</span>';

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
 * So far this is a sandbox: walk and hop round the exercise yard and the cell block, aim over
 * the shoulder and knock over the practice dummies.
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
  private facility!: Facility;
  private player!: PlayerSoldier;
  private cam!: ShoulderCam;
  private dummies!: Dummies;
  private cells!: Cells;
  private followers!: Followers;
  /** Where he gets back up: his cell, until he's out of it. */
  private checkpoint = { x: 0, z: 0, yaw: 0 };
  private blockFreed = false;
  private readonly tracers: { line: THREE.Line; age: number }[] = [];
  private readonly tracerMaterial = new THREE.LineBasicMaterial({ color: 0xffe7a0, transparent: true });

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
    this.facility = new Facility(this.world);
    this.scene.add(this.facility.group);
    const start = this.facility.layout.start;
    this.player = new PlayerSoldier(this.world, start.x, start.z, start.yaw);
    this.scene.add(this.player.root);
    this.cam = new ShoulderCam(this.camera, this.world);
    this.dummies = new Dummies(this.world, this.facility.layout.dummies);
    this.scene.add(this.dummies.group);
    this.cells = new Cells(this.world, this.facility.layout.cells);
    this.scene.add(this.cells.group);
    this.followers = new Followers(this.world, prisonerSpots(this.facility.layout.cells), this.settings.buddyNames);
    this.scene.add(this.followers.group);
    this.checkpoint = { ...start };
    // Colliders added this frame aren't in the query pipeline until a step.
    this.world.step();

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

  /** Where the rifle shot goes: whatever's under the crosshair, reached from the muzzle (so a wall in front of him still stops it). */
  private fireRifle(): void {
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const aim = this.cam.aimDirection();
    const sight = this.world.castRay(new RAPIER.Ray(camPos, aim), SHOT_RANGE, true, undefined, PLAYER_SHOTS);
    const target = camPos.clone().addScaledVector(aim, sight ? sight.timeOfImpact : SHOT_RANGE);
    const muzzle = this.player.muzzle();
    const dir = target.clone().sub(muzzle);
    const dist = dir.length();
    dir.normalize();
    const hit = this.world.castRay(new RAPIER.Ray(muzzle, dir), dist + 0.05, true, undefined, PLAYER_SHOTS);
    const end = hit ? muzzle.clone().addScaledVector(dir, hit.timeOfImpact) : target;

    this.impacts.muzzleFlash(muzzle, dir, 0.3);
    this.sound.play('crack', { volume: 0.28, rate: 2.3, minGap: 0.05 });
    this.cam.addShake(0.08);
    this.addTracer(muzzle, end);
    if (!hit) return;
    const cell = this.cells.hit(hit.collider, dir);
    if (cell) {
      this.sound.play('clang', { at: end, volume: 0.9, rate: 1.1 });
      this.impacts.dustPuff(end);
      this.onCellOpened(cell.index);
    } else if (this.dummies.hit(hit.collider, dir)) {
      this.sound.play('thud', { at: end, volume: 0.7, rate: 1.3 });
      this.impacts.dustPuff(end);
    } else {
      this.impacts.dustPuff(end);
      this.sound.play('clang', { at: end, volume: 0.15, rate: 2.2, minGap: 0.08 });
    }
  }

  private toCheckpoint(): void {
    const c = this.checkpoint;
    this.player.teleport(c.x, c.z, c.yaw);
    this.followers.gather(this.player.position);
  }

  private onCellOpened(index: number): void {
    if (index === 0) {
      this.checkpoint = { ...this.facility.layout.corridorCheckpoint };
      this.hud.showBanner("YOU'RE OUT!", 'Now shoot the padlocks on the other cells and free everyone');
      return;
    }
    const names = this.settings.buddyNames;
    const buddies = this.followers.release(index);
    const freedBuddies = buddies.map((b) => names[b]).join(' & ');
    if (this.cells.all.every((c) => !c.locked) && !this.blockFreed) {
      this.blockFreed = true;
      this.hud.showBanner(
        'CELL BLOCK A IS FREE!',
        `${buddies.length ? `${freedBuddies} too! ` : ''}${this.followers.count} prisoners are following you. Press X to tell them to hold or follow`,
      );
    } else if (buddies.length) {
      this.hud.showBanner(`${freedBuddies.toUpperCase()} IS FREE!`, 'Your buddies will help you get your tank back');
    } else {
      this.hud.showCallout(`+${this.followers.inCell(index)} · SQUAD ${this.followers.count}`, '#9be27a');
    }
    this.sound.play('uiConfirm', { volume: 0.6 });
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, this.tracerMaterial);
    this.scene.add(line);
    this.tracers.push({ line, age: 0 });
  }

  private updateTracers(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.age += dt;
      if (t.age < TRACER_TIME) continue;
      this.scene.remove(t.line);
      t.line.geometry.dispose(); // the material is shared
      this.tracers.splice(i, 1);
    }
  }

  private prisonHUD(): PrisonHUD {
    const p = this.player.position;
    const down = this.player.downFor;
    const cells = this.cells.all;
    const own = cells[0];
    const others = cells.slice(1);
    const opened = others.filter((c) => !c.locked).length;
    const names = this.settings.buddyNames;
    const buddies = this.followers.buddiesHere;
    const freed = this.followers.buddiesFreed;
    const nearLock = cells.some((c) => c.locked && Math.hypot(c.lockAt.x - p.x, c.lockAt.z - p.z) < LOCK_PROMPT_RANGE);
    const squad = this.followers.count;
    return {
      title: `PRISON BREAK · CELL BLOCK A${squad ? ` · SQUAD ${squad}${this.followers.isHolding ? ' (HOLDING)' : ''}` : ''}`,
      objectives: [
        { label: 'Break out of your cell', done: !own.locked },
        { label: `Open the other cells (${opened} / ${others.length})`, done: opened === others.length },
        ...buddies.map((b) => ({ label: `Free ${names[b]}`, done: freed.includes(b) })),
      ],
      prompt:
        down > 0
          ? `Knocked down! Back on your feet in ${Math.ceil(down)}…`
          : own.locked
            ? 'Shoot the padlock on your cell door!'
            : nearLock
              ? 'Shoot the padlock to open the cell'
              : null,
      downFor: down,
    };
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

    if (input.mapTogglePressed) this.hud.toggleBigMap();
    if (input.cameraTogglePressed) this.cam.toggle();
    if (input.megaJamPressed && this.followers.count > 0) {
      const holding = this.followers.toggleHold();
      this.hud.showCallout(holding ? 'SQUAD: HOLD HERE' : 'SQUAD: FOLLOW ME', holding ? '#ffd24a' : '#9be27a');
      this.sound.play('uiChange', { volume: 0.5 });
    }
    const wasDown = this.player.isDown;
    if (this.player.step(input, dt)) this.fireRifle();
    // Back on his feet at the last checkpoint (with the squad) when asked, or once he's been knocked down.
    if (input.resetPressed || (wasDown && !this.player.isDown)) this.toCheckpoint();
    this.followers.update(dt, this.player.position);
    this.world.step();

    this.cam.update(this.player, dt);
    this.dummies.update(dt);
    this.cells.update(dt);
    this.impacts.update(dt);
    this.updateTracers(dt);

    const p = this.player.position;
    this.sun.position.set(p.x + 30, p.y + 60, p.z + 20);
    this.sun.target.position.copy(p);

    this.sound.setListener(this.camera);
    this.hud.update(this.hudState(input));
    this.renderer.render(this.scene, this.camera);
    this.hud.recordFrame();
  };
}

/** Who's in Cell Block A: a couple of prisoners per cell (some sat waiting), and one buddy. */
function prisonerSpots(cells: CellSpot[]): PrisonerSpot[] {
  const spots: PrisonerSpot[] = [];
  cells.forEach((cell, i) => {
    const doorX = (cell.doorX0 + cell.doorX1) / 2;
    const exits = [new THREE.Vector2(doorX, cell.frontZ + 0.9), new THREE.Vector2(doorX, cell.frontZ - 1.6)];
    for (let j = 0; j < CELL_PRISONERS[i]; j++) {
      spots.push({
        x: cell.minX + 1.4 + j * 1.6,
        z: cell.frontZ + 2.6 + (j % 2) * 1.2,
        cell: i,
        kneel: (i + j) % 3 === 0,
        buddy: i === BUDDY_CELL && j === 0 ? 0 : null,
        exits,
      });
    }
  });
  return spots;
}
