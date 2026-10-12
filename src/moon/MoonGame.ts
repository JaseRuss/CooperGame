import * as THREE from 'three';
import { InputManager, type InputState } from '../input/InputManager';
import { HUD, type HUDState, type PrisonHUD } from '../ui/HUD';
import type { MapView } from '../ui/WorldMap';
import { Sound } from '../audio/Sound';
import { ImpactEffects } from '../combat/ImpactEffects';
import { loadSettings, saveSettings, AIM_SPEED_SCALE, GRAPHICS_QUALITY, type Settings } from '../core/Settings';
import { MISSION, startMission } from '../core/config';
import { damp, clamp } from '../utils/math';
import { mulberry32 } from '../utils/rng';
import { earthTexture } from '../world/MoonBase';
import { MoonTerrain } from './MoonTerrain';
import { Buggy, makeCrate, MAX_CRATES, MOON_G, THUD_SPEED, HARD_SPEED, type BuggyEvents } from './Buggy';
import { Dust } from './Dust';
import { Camp, BUILD_TIME, type BuildFx } from './Camp';
import { MainBase } from './MainBase';
import { MoonMap } from './MoonMap';
import { FACTIONS, BASE_ZONE, START, CRATES_NEEDED, DROP_RADIUS, BAY_RADIUS, CAMP_R, roadTo, campZones } from './Layout';

const SHADOW_HALF = 60;
/** Where the sun is: low in the sky, so everything throws a long shadow. */
const SUN_DIRECTION = new THREE.Vector3(0.55, 0.5, -0.67).normalize();
/** Where the Earth hangs, as a direction from the camera. */
const EARTH_DIRECTION = new THREE.Vector3(-0.35, 0.3, 0.88).normalize();
/** Seconds between one crate being loaded and the next. */
const LOAD_INTERVAL = 0.3;
const UNLOAD_INTERVAL = 0.45;
/** The most the buggy can be moving to unload at a camp. */
const UNLOAD_SPEED = 20;
const CRATE_FLIGHT = 1.1;
/** A fallen crate can't be picked straight back up. */
const PICKUP_DELAY = 1.2;
const PICKUP_RANGE = 3.6;

const CONTROLS =
  '<span><b>Drive</b> left stick · W A S D</span><span><b>Jump</b> (it\'s the Moon: you stay up for ages) A · RT · Space</span>' +
  '<span><b>In the air</b> W / S tip the nose, A / D spin</span><span><b>Handbrake</b> (for slides) RB · Shift</span>' +
  '<span><b>Camera</b> Y · C</span><span><b>Back to the main base</b> Back · R</span>' +
  '<span><b>Load up</b> drive into an army\'s supply bay at the main base</span><span><b>Drop off</b> drive into the glowing ring at their camp</span>';

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

/** A supply crate that isn't on the buggy: tossed off by a hard landing, or flying to a camp's pallet. */
interface LooseCrate {
  mesh: THREE.Object3D;
  color: number;
  vel: THREE.Vector3;
  spin: number;
  age: number;
  /** Set for a delivery: the camp it's flying to and the slot it lands in. */
  to: { camp: Camp; slot: number } | null;
}

/**
 * The epilogue (mission 7): the armies made it to the Moon. A moon buggy with a jump and moon-like
 * gravity ferries supplies from the main base along dirt roads to the four armies' camps; each
 * delivery plays a time-lapse of that army's Moon base going up.
 */
export class MoonGame {
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
  private readonly sky = new THREE.Group();
  private terrain!: MoonTerrain;
  private base!: MainBase;
  private buggy!: Buggy;
  private dust!: Dust;
  private effects!: ImpactEffects;
  private camps: Camp[] = [];
  private map!: MoonMap;
  private mapView: MapView = NO_MAP;
  private mapAge = 0;
  private time = 0;
  private readonly loose: LooseCrate[] = [];
  private readonly events: BuggyEvents = { jumped: false, landed: 0, bumped: 0 };
  /** Loading and unloading timers. */
  private loadTimer = 0;
  private unloadTimer = 0;
  /** The camp whose Moon base is going up, while the cutscene plays. */
  private building: Camp | null = null;
  private fadeIn = 0;
  private victoryAt: number | null = null;
  private farCamera = true;
  private readonly camFocus = new THREE.Vector3();
  private camYaw = 0;
  private readonly camLook = new THREE.Vector3();
  private cutCameraReady = false;
  private stats = { jumps: 0, bestAir: 0, lost: 0 };
  /** Dev only: pins the camera for screenshots. */
  debugCam: { pos: [number, number, number]; look: [number, number, number] } | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: this.settings.graphicsQuality !== 'low' });
    const graphics = GRAPHICS_QUALITY[this.settings.graphicsQuality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphics.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = graphics.shadowSize > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 5000);
    this.input = new InputManager(this.renderer.domElement);
    this.hud = new HUD(container);
    this.hud.setSoundHook((kind) => this.sound.play(kind === 'move' ? 'uiMove' : kind === 'change' ? 'uiChange' : kind === 'back' ? 'uiBack' : kind === 'open' ? 'uiOpen' : 'uiConfirm', { volume: 0.5, minGap: 0 }));

    this.loadingLabel = document.createElement('div');
    this.loadingLabel.style.cssText =
      'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;' +
      "font-size:22px; background:#02030a; color:#e8eef5; font-family:'Segoe UI',system-ui,sans-serif; z-index:10;";
    this.loadingLabel.textContent = 'Loading the Moon…';
    container.appendChild(this.loadingLabel);

    this.scene.background = new THREE.Color(0x02030a);
    this.scene.add(new THREE.HemisphereLight(0x8494b8, 0x3a3836, 0.75));
    this.sun = new THREE.DirectionalLight(0xfff6e8, 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(graphics.shadowSize || 1024, graphics.shadowSize || 1024);
    const sh = this.sun.shadow.camera;
    sh.left = sh.bottom = -SHADOW_HALF;
    sh.right = sh.top = SHADOW_HALF;
    sh.near = 1;
    sh.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.onResize());
    // Let the loading words paint before the terrain is made.
    window.setTimeout(() => this.init(), 30);
  }

  private init(): void {
    // The roads come first: the ground is flattened along them and craters keep clear.
    const roads = FACTIONS.map((f, i) => roadTo(f, i));
    const zones = [BASE_ZONE, ...campZones()];
    this.terrain = new MoonTerrain(roads, zones);
    this.scene.add(this.terrain.buildMesh());
    this.scene.add(this.terrain.buildRoads([...FACTIONS.map((f) => ({ x: f.camp.x, z: f.camp.z, r: CAMP_R - 8 }))]));
    this.scene.add(this.terrain.buildRocks([{ x: 0, z: -10, r: 90 }, ...campZones().map((z) => ({ ...z, r: z.r + 6 }))]));
    this.buildSky();
    this.dust = new Dust(this.scene);
    this.effects = new ImpactEffects(this.scene);
    this.base = new MainBase(this.scene, this.terrain);
    this.camps = FACTIONS.map((f, i) => new Camp(this.scene, f, this.terrain, i));
    this.buggy = new Buggy();
    this.buggy.placeAt(START.x, START.z, START.yaw, this.terrain);
    this.scene.add(this.buggy.root);
    this.map = new MoonMap(this.terrain.paths);
    this.map.data.base = { x: 0, z: -30 };
    this.camFocus.copy(this.buggy.pos);
    this.camYaw = this.buggy.yaw;

    this.hud.setWorldMap(this.map.asWorldMap());
    this.hud.setOnFoot(CONTROLS, {
      legend:
        '<span><i style="background:#eeebe3"></i>Main base (load up here)</span><span><i style="background:#b8392e"></i>An army\'s camp: a square until it\'s built, then a dome</span>' +
        '<span><i style="background:#b09a6a"></i>Dirt roads to each camp</span><span><i style="background:#ffffff"></i>You, in the buggy</span>',
    });
    this.hud.setSettings(this.settings, (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    });
    this.applySettings();
    this.hud.setMissionStart((m) => startMission(m));
    void this.sound.load();
    this.refreshMap();
    this.loadingLabel.remove();
    this.ready = true;
    this.sound.music.start();
    this.clock.start();
    this.hud.showBanner('EPILOGUE: THE MOON', "Everyone made it! Load an army's supplies at the main base and drive them along the dirt road to their camp. Space jumps: the Moon's gravity is weak");
    if (import.meta.env.DEV) (window as unknown as { moon: MoonGame }).moon = this;
    requestAnimationFrame(this.animate);
  }

  /** Stars, and the Earth with its thin blue glow, held at the same place in the view however far you drive. */
  private buildSky(): void {
    const rng = mulberry32(88);
    const count = 2600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(rng() - 0.5, rng() * 0.95 - 0.08, rng() - 0.5).normalize().multiplyScalar(3500);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sky.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })));
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(260, 48, 24),
      new THREE.MeshStandardMaterial({ map: earthTexture(), emissive: 0xffffff, emissiveMap: earthTexture(), emissiveIntensity: 0.5, roughness: 0.9 }),
    );
    earth.position.copy(EARTH_DIRECTION).multiplyScalar(3300);
    earth.rotation.set(0.3, 2.2, 0.2);
    this.sky.add(earth);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(64, 64, 40, 64, 64, 64);
    g.addColorStop(0, 'rgba(120,180,255,0.7)');
    g.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.setScalar(260 * 3.2);
    glow.position.copy(earth.position).multiplyScalar(1.01);
    this.sky.add(glow);
    this.scene.add(this.sky);
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
    this.pausedRendered = false;
  }

  private onResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.hud.setViewport({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    this.pausedRendered = false;
  }

  // ---------- supplies ----------

  private get unbuilt(): Camp[] {
    return this.camps.filter((c) => !c.built);
  }

  /** Loading at a bay, and picking up crates that have fallen off. */
  private updateLoading(dt: number): void {
    const b = this.buggy;
    const p = b.pos;
    let atBay = false;
    for (const camp of this.camps) {
      const f = camp.faction;
      if (Math.hypot(p.x - f.bay.x, p.z - f.bay.z) > BAY_RADIUS || camp.built) continue;
      atBay = true;
      const full = b.cargoColor === f.color && b.cargo >= MAX_CRATES;
      if (full) break;
      this.loadTimer += dt;
      if (this.loadTimer < LOAD_INTERVAL) break;
      this.loadTimer = 0;
      if (b.cargo > 0 && b.cargoColor !== f.color) {
        // Another army's crates are swapped out for these.
        b.setCargo(f.color, 0);
        this.hud.showCallout(`SWAPPING TO ${f.name.toUpperCase()} SUPPLIES`, '#ffd24a');
      }
      b.setCargo(f.color, b.cargo + 1);
      this.sound.play('thud', { at: p, volume: 0.35, rate: 1.5 + b.cargo * 0.12, minGap: 0.05 });
      if (b.cargo === MAX_CRATES) this.hud.showCallout(`LOADED: ${MAX_CRATES} ${f.name.toUpperCase()} CRATES. Follow the beam!`, `#${new THREE.Color(f.color).getHexString()}`);
      break;
    }
    if (!atBay) this.loadTimer = 0;
    // Fallen crates.
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const c = this.loose[i];
      if (c.to || c.age < PICKUP_DELAY) continue;
      if (b.cargo >= MAX_CRATES || (b.cargo > 0 && b.cargoColor !== c.color)) continue;
      if (Math.hypot(c.mesh.position.x - p.x, c.mesh.position.z - p.z) < PICKUP_RANGE && Math.abs(c.mesh.position.y - p.y) < 3) {
        b.setCargo(c.color, b.cargo + 1);
        this.scene.remove(c.mesh);
        this.loose.splice(i, 1);
        this.sound.play('uiChange', { volume: 0.5, rate: 1.3 });
        this.hud.showCallout('CRATE BACK ON BOARD', '#9be27a');
      }
    }
  }

  /** At a camp's ring with the right crates: they hop off the bed onto the pallet, one by one. */
  private updateUnloading(dt: number): void {
    const b = this.buggy;
    const p = b.pos;
    for (const camp of this.camps) {
      if (camp.built || camp.building) continue;
      if (Math.hypot(p.x - camp.drop.x, p.z - camp.drop.z) > DROP_RADIUS) continue;
      if (b.cargo === 0 || b.cargoColor !== camp.faction.color) {
        this.unloadTimer = 0;
        return;
      }
      if (Math.abs(b.forwardSpeed) > UNLOAD_SPEED || !b.grounded) return;
      this.unloadTimer += dt;
      if (this.unloadTimer < UNLOAD_INTERVAL) return;
      this.unloadTimer = 0;
      if (camp.delivered + camp.incoming >= CRATES_NEEDED) return;
      const from = b.cratePosition() ?? p.clone();
      b.dropCrate();
      const slot = camp.delivered + camp.incoming;
      camp.incoming++;
      const mesh = makeCrate(camp.faction.color);
      mesh.position.copy(from);
      this.scene.add(mesh);
      const to = camp.slotWorld(slot);
      const vel = Camp.flightVelocity(from, to, CRATE_FLIGHT);
      this.loose.push({ mesh, color: camp.faction.color, vel, spin: 2.5, age: 0, to: { camp, slot } });
      this.sound.play('poof', { at: from, volume: 0.4, rate: 1.4 });
      return;
    }
    this.unloadTimer = 0;
  }

  private updateLoose(dt: number): void {
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const c = this.loose[i];
      c.age += dt;
      c.vel.y -= MOON_G * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.y += c.spin * dt;
      if (c.to) {
        c.mesh.rotation.x += c.spin * 0.6 * dt;
        if (c.age >= CRATE_FLIGHT) {
          const { camp } = c.to;
          this.scene.remove(c.mesh);
          this.loose.splice(i, 1);
          camp.incoming--;
          camp.delivered++;
          camp.showDelivered(camp.delivered);
          this.dust.burst(camp.slotWorld(camp.delivered - 1), 7, 2.2);
          this.sound.play('thud', { at: camp.drop, volume: 0.6, rate: 1.1 });
          if (camp.delivered >= CRATES_NEEDED) this.startBuild(camp);
          else this.hud.showCallout(`${camp.faction.name.toUpperCase()}: ${camp.delivered} / ${CRATES_NEEDED} CRATES`, '#ffd24a');
          this.refreshMap();
        }
        continue;
      }
      const ground = this.terrain.heightAt(c.mesh.position.x, c.mesh.position.z) + 0.46;
      if (c.mesh.position.y < ground) {
        c.mesh.position.y = ground;
        if (c.vel.y < -1.2) {
          c.vel.y *= -0.35;
          this.dust.burst(c.mesh.position.clone().setY(ground - 0.3), 3, 1.2);
          this.sound.play('thud', { at: c.mesh.position, volume: 0.25, rate: 1.3, minGap: 0.1 });
        } else c.vel.y = 0;
        const drag = Math.exp(-1.4 * dt);
        c.vel.x *= drag;
        c.vel.z *= drag;
        c.spin *= drag;
        c.mesh.rotation.x = damp(c.mesh.rotation.x, 0, 8, dt);
      }
    }
  }

  // ---------- building ----------

  private readonly fx: BuildFx = {
    dust: (at, size) => this.dust.burst(at, Math.round(14 + size * 3), 3 + size * 0.5, 0.35 + size * 0.04),
    burst: (at) => {
      this.effects.confetti(at);
      this.sound.play('crack', { volume: 0.25, rate: 1.3 + Math.random() * 0.4, minGap: 0.2 });
      this.sound.play('boom', { volume: 0.2, rate: 1.6, minGap: 0.2 });
    },
    sound: (name) => {
      if (name === 'cheer') this.sound.music.stinger();
      else this.sound.play(name, { at: this.building?.drop, volume: name === 'poof' ? 0.5 : 0.7, rate: name === 'clang' ? 1.2 : 0.9, minGap: 0.1 });
    },
    banner: (title, subtitle) => this.hud.showBanner(title, subtitle),
  };

  private startBuild(camp: Camp): void {
    this.building = camp;
    camp.beginBuild();
    this.base.bayDone(camp.faction.id);
    this.cutCameraReady = false;
    this.sound.music.alarm();
    this.hud.showCallout(`${camp.faction.name.toUpperCase()}: SUPPLIES DELIVERED!`, '#9be27a');
  }

  /** The time-lapse of a camp's base going up, with the camera taken over. */
  private stepBuild(dt: number, skip: boolean): void {
    const camp = this.building as Camp;
    let done = skip && camp.buildTime > 2.5;
    if (done) camp.finishBuild();
    else done = camp.updateBuild(dt, this.fx);
    const shot = camp.cameraShot();
    const k = this.cutCameraReady ? 1 - Math.exp(-5 * dt) : 1;
    this.cutCameraReady = true;
    this.camera.position.lerp(shot.pos, k);
    this.camLook.lerp(shot.look, k);
    this.camera.lookAt(this.camLook);
    const t = camp.buildTime;
    const fade = Math.max(1 - t / 0.7, (t - (BUILD_TIME - 0.8)) / 0.8);
    this.hud.setFade(clamp(fade, 0, 1), '#000000');
    this.effects.update(dt);
    this.dust.update(dt, (x, z) => this.terrain.heightAt(x, z));
    camp.update(dt, 999);
    for (const c of this.camps) if (c !== camp) c.update(dt, 999);
    this.base.update(dt);
    if (!done) return;
    // The camp is built: its domes are solid now, and the buggy's back in the driver's seat.
    for (const s of camp.solidsWorld()) this.terrain.solids.add(s);
    this.building = null;
    this.fadeIn = 0.8;
    this.camYaw = this.buggy.yaw;
    this.camFocus.copy(this.buggy.pos);
    this.refreshMap();
    const left = this.unbuilt.length;
    if (left === 0) {
      this.victoryAt = this.time;
      this.hud.showVictory('All four armies have their Moon bases! The Green, Red, Tan and Blue armies are home at last.', 'Keep driving around and enjoy the Moon!');
      this.sound.music.fanfare();
    } else this.hud.showBanner(`${left} CAMP${left === 1 ? '' : 'S'} TO GO`, 'Back to the main base for the next army\'s supplies');
  }

  // ---------- the frame ----------

  private driveInput(input: InputState): { throttle: number; steer: number; jump: boolean; brake: boolean } {
    return {
      throttle: clamp(input.throttle + input.moveY, -1, 1),
      steer: clamp(input.steer + input.moveX, -1, 1),
      jump: input.firing,
      brake: input.sneak,
    };
  }

  private step(input: InputState, dt: number): void {
    if (input.mapTogglePressed) this.hud.toggleBigMap();
    this.time += dt;
    if (this.victoryAt !== null && this.time - this.victoryAt > 10) {
      this.hud.hideVictory();
      this.victoryAt = null;
    }
    if (this.building) {
      this.sound.updateEngine(0, 'jeep', false);
      this.stepBuild(dt, input.menu.confirm);
      this.updateLoose(dt);
      return;
    }
    if (this.fadeIn > 0) {
      this.fadeIn = Math.max(0, this.fadeIn - dt);
      this.hud.setFade(this.fadeIn / 0.8, '#000000');
    }
    if (input.cameraTogglePressed) this.farCamera = !this.farCamera;
    const b = this.buggy;
    if (input.resetPressed) {
      b.placeAt(START.x, START.z, START.yaw, this.terrain);
      this.hud.showCallout('BACK AT THE MAIN BASE', '#c9d3dc');
    }
    // The physics runs in small steps so a fast jump or landing doesn't skip through the ground.
    const drive = this.driveInput(input);
    this.events.jumped = false;
    this.events.landed = 0;
    this.events.bumped = 0;
    const sub = Math.max(1, Math.ceil(dt / (1 / 60)));
    for (let i = 0; i < sub; i++) b.step(dt / sub, drive, this.terrain, this.events);
    this.afterPhysics(dt);
    this.updateLoading(dt);
    this.updateUnloading(dt);
    this.updateLoose(dt);
    const near = (c: Camp) => Math.hypot(b.pos.x - c.center.x, b.pos.z - c.center.z);
    for (const c of this.camps) c.update(dt, near(c));
    this.base.update(dt);
    this.effects.update(dt);
    this.dust.update(dt, (x, z) => this.terrain.heightAt(x, z));
    this.updateCamera(dt);
    this.mapAge += dt;
    if (this.mapAge > 0.15) {
      this.mapAge = 0;
      this.refreshMap();
    }
  }

  /** Sounds and dust for what the physics just did, and crates shaken off by a hard landing. */
  private afterPhysics(dt: number): void {
    const b = this.buggy;
    const ev = this.events;
    const ground = this.terrain.heightAt(b.pos.x, b.pos.z);
    const wheelAt = new THREE.Vector3(b.pos.x, ground + 0.2, b.pos.z);
    if (ev.jumped) {
      this.stats.jumps++;
      this.sound.play('poof', { at: b.pos, volume: 0.45, rate: 1.1 });
      this.dust.burst(wheelAt, 12, 2.2, 0.3);
    }
    if (ev.landed > THUD_SPEED) {
      this.sound.play('thud', { at: b.pos, volume: clamp(ev.landed / 10, 0.3, 0.9), rate: 0.9 });
      this.dust.burst(wheelAt, Math.round(8 + ev.landed * 2.4), 1.5 + ev.landed * 0.35, 0.3);
      this.stats.bestAir = Math.max(this.stats.bestAir, ev.landed);
    }
    if (ev.landed > HARD_SPEED && b.cargo > 0) this.shakeCrateLoose();
    if (ev.bumped > 3) {
      this.sound.play('clang', { at: b.pos, volume: clamp(ev.bumped / 14, 0.25, 0.8), rate: 1.2, minGap: 0.15 });
      this.dust.burst(wheelAt.clone().addScaledVector(b.vel, 0.05), 6, 1.5);
    }
    if (ev.bumped > 11 && b.cargo > 0) this.shakeCrateLoose();
    // Wheels throw dust when it's moving fast on the ground.
    const speed = Math.hypot(b.vel.x, b.vel.z);
    if (b.grounded && speed > 6 && Math.random() < dt * (speed * 1.5)) {
      this.dust.burst(wheelAt.clone().addScaledVector(b.forward(), -2), 1, 1.2, 0.25, b.vel.clone().multiplyScalar(-0.2));
    }
    this.sound.updateEngine(speed, 'jeep', b.grounded, 0.7);
  }

  /** A hard landing (or crash) throws the top crate off the bed in a lazy low-gravity arc. */
  private shakeCrateLoose(): void {
    const b = this.buggy;
    const at = b.cratePosition();
    if (!at || b.cargo === 0) return;
    const color = b.cargoColor;
    b.dropCrate();
    const mesh = makeCrate(color);
    mesh.position.copy(at);
    this.scene.add(mesh);
    const side = Math.random() < 0.5 ? -1 : 1;
    const vel = b.vel.clone().multiplyScalar(0.6);
    vel.x += side * (1.5 + Math.random() * 2) * Math.cos(b.yaw);
    vel.z -= side * (1.5 + Math.random() * 2) * Math.sin(b.yaw);
    vel.y = 3.5 + Math.random() * 2;
    this.loose.push({ mesh, color, vel, spin: (Math.random() - 0.5) * 6, age: 0, to: null });
    this.stats.lost++;
    this.hud.showCallout('A CRATE FELL OFF! Drive back over it to pick it up', '#ff8a7a');
    this.sound.play('clang', { at, volume: 0.6, rate: 0.8 });
  }

  private updateCamera(dt: number): void {
    const b = this.buggy;
    const speed = Math.hypot(b.vel.x, b.vel.z);
    // The camera trails a little behind the way it's facing, and stays level through a jump so you see it fly.
    this.camYaw += Math.atan2(Math.sin(b.yaw - this.camYaw), Math.cos(b.yaw - this.camYaw)) * (1 - Math.exp(-3.2 * dt));
    this.camFocus.x = damp(this.camFocus.x, b.pos.x, 14, dt);
    this.camFocus.z = damp(this.camFocus.z, b.pos.z, 14, dt);
    this.camFocus.y = damp(this.camFocus.y, b.pos.y, b.grounded ? 6 : 2.2, dt);
    const dist = this.farCamera ? 12.5 : 8;
    const height = this.farCamera ? 5.2 : 3.4;
    const pos = new THREE.Vector3(this.camFocus.x - Math.sin(this.camYaw) * dist, this.camFocus.y + height, this.camFocus.z - Math.cos(this.camYaw) * dist);
    pos.y = Math.max(pos.y, this.terrain.heightAt(pos.x, pos.z) + 1.4);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.camFocus.x + Math.sin(this.camYaw) * 4, this.camFocus.y + 1.4, this.camFocus.z + Math.cos(this.camYaw) * 4);
    const fov = 62 + clamp(speed, 0, 28) * 0.45;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, fov, 4, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------- map, waypoint and HUD ----------

  private refreshMap(): void {
    const b = this.buggy;
    const d = this.map.data;
    d.player = { x: b.pos.x, z: b.pos.z, yaw: b.yaw };
    d.camps = this.camps.map((c) => ({ x: c.center.x, z: c.center.z, color: c.faction.color, built: c.built, delivered: c.delivered, need: CRATES_NEEDED }));
    d.crates = this.loose.filter((c) => !c.to).map((c) => ({ x: c.mesh.position.x, z: c.mesh.position.z, color: c.color }));
    this.mapView = this.map.view({ ...NO_MAP, playerX: b.pos.x, playerZ: b.pos.z, playerYaw: b.yaw });
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

  /** The way to go next: the camp its crates belong to, else the nearest bay that still has a camp waiting. */
  private waypoint(): HUDState['waypoint'] {
    if (this.hud.paused || this.building || this.victoryAt !== null) return null;
    const b = this.buggy;
    const p = b.pos;
    const carrying = this.camps.find((c) => !c.built && b.cargo > 0 && c.faction.color === b.cargoColor);
    if (carrying) {
      const d = Math.round(Math.hypot(carrying.drop.x - p.x, carrying.drop.z - p.z));
      return this.waypointTo(new THREE.Vector3(carrying.drop.x, carrying.drop.y + 4, carrying.drop.z), `${carrying.faction.name.toUpperCase()} CAMP ${d} m`);
    }
    const wanting = this.unbuilt.filter((c) => c.delivered + c.incoming < CRATES_NEEDED);
    if (wanting.length === 0) return null;
    const bay = wanting.reduce((a, c) => (Math.hypot(a.faction.bay.x - p.x, a.faction.bay.z - p.z) < Math.hypot(c.faction.bay.x - p.x, c.faction.bay.z - p.z) ? a : c));
    const d = Math.round(Math.hypot(bay.faction.bay.x - p.x, bay.faction.bay.z - p.z));
    return this.waypointTo(new THREE.Vector3(bay.faction.bay.x, 5, bay.faction.bay.z), `${bay.faction.name.toUpperCase()} SUPPLIES ${d} m`);
  }

  private prompt(usingGamepad: boolean): string | null {
    const b = this.buggy;
    const p = b.pos;
    if (this.building) return null;
    for (const camp of this.camps) {
      const f = camp.faction;
      if (!camp.built && Math.hypot(p.x - f.bay.x, p.z - f.bay.z) < BAY_RADIUS) {
        return b.cargo >= MAX_CRATES && b.cargoColor === f.color ? `${f.name.toUpperCase()} SUPPLIES LOADED: now follow the beam!` : `Loading ${f.name} supplies… ${b.cargoColor === f.color ? b.cargo : 0} / ${MAX_CRATES}`;
      }
      if (!camp.built && Math.hypot(p.x - camp.drop.x, p.z - camp.drop.z) < DROP_RADIUS + 3) {
        if (b.cargo === 0) return `The ${f.name} need supplies: load up at their bay at the main base`;
        if (b.cargoColor !== f.color) return 'These are another army\'s crates: this is the ' + f.name + ' camp';
        return b.grounded ? `Unloading… ${camp.delivered + camp.incoming} / ${CRATES_NEEDED}` : 'Land first to unload';
      }
    }
    if (this.time < 20 && b.cargo === 0) return `Drive into a coloured supply bay to load that army's crates. ${usingGamepad ? 'A' : 'Space'} jumps: try it!`;
    if (b.cargo === 0 && this.unbuilt.length > 0) return 'Load up at a supply bay at the main base, then follow the beam to that army\'s camp';
    if (b.airTime > 2.2) return 'WHEEEE!';
    return null;
  }

  private prisonHUD(usingGamepad: boolean): PrisonHUD {
    const b = this.buggy;
    const speed = Math.hypot(b.vel.x, b.vel.z);
    const ground = this.terrain.heightAt(b.pos.x, b.pos.z);
    const colorName = FACTIONS.find((f) => f.color === b.cargoColor)?.name;
    const k = (key: string, what: string) => `<span class="key">${key}</span>${what}`;
    return {
      title: 'MOON SUPPLY RUN',
      objectives: this.camps.map((c) => ({
        label: c.built ? `${c.faction.name} Moon base built` : `${c.faction.name} camp: ${c.delivered} / ${CRATES_NEEDED} crates`,
        done: c.built,
      })),
      prompt: this.prompt(usingGamepad),
      downFor: 0,
      jam: 0,
      stealth: null,
      status: [
        b.cargo > 0 && colorName ? `Carrying ${b.cargo} ${colorName} crate${b.cargo === 1 ? '' : 's'}` : 'Bed empty',
        `Speed ${Math.round(speed * 3.6)} km/h  ·  Height ${Math.max(0, Math.round(b.pos.y - ground - 0.62))} m${this.stats.lost ? `  ·  Crates lost ${this.stats.lost}` : ''}`,
      ],
      vehicle: {
        gun: 'MOON BUGGY',
        hull: 'CARGO',
        ready: b.cargo === 0 ? 'EMPTY' : `${b.cargo} / ${MAX_CRATES} CRATES`,
        mode: 'Moon gravity · 1/6 g',
        keysPad: `${k('LS', 'drive')}${k('A', 'jump')}${k('RB', 'handbrake')}${k('Y', 'camera')}${k('Start', 'pause · options')}${k('Back', 'main base')}`,
        keysKb: `${k('WASD', 'drive')}${k('Space', 'jump')}${k('Shift', 'handbrake')}${k('C', 'camera')}${k('M', 'pause · options')}${k('R', 'main base')}`,
      },
    };
  }

  private hudState(input: InputState): HUDState {
    return {
      zombies: null,
      health: this.buggy.cargo,
      maxHealth: MAX_CRATES,
      reloadFraction: 0,
      damageBoost: 0,
      ride: null,
      cameraMode: 'third',
      usingGamepad: input.usingGamepad,
      insideBase: null,
      map: this.mapView,
      aimScreen: null,
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
      cinematic: this.building !== null,
      cinematicLabel: this.building ? `● ${this.building.faction.name.toUpperCase()} MOON BASE` : '',
      waypoint: this.waypoint(),
      enemyBasesLeft: 0,
      enemyBasesTotal: 0,
      nearbyBase: null,
      airSupport: null,
      tanker: null,
      siege: null,
      prison: this.prisonHUD(input.usingGamepad),
      driveStyle: this.settings.driveStyle,
      mouseCaptureHint: !input.usingGamepad && !input.pointerLocked && input.pointerLockAvailable,
      soundLocked: this.sound.locked && (this.settings.sfxVolume > 0 || this.settings.musicVolume > 0),
    };
  }

  private render(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.hud.setViewport({ left: 0, top: 0, width: w, height: h });
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.debugCam) {
      this.camera.position.set(...this.debugCam.pos);
      this.camera.lookAt(...this.debugCam.look);
    }
    // The shadow follows whatever the camera's watching.
    const watch = this.building ? this.building.center : this.buggy.pos;
    this.sun.position.copy(watch).addScaledVector(SUN_DIRECTION, 160);
    this.sun.target.position.copy(watch);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.render(this.scene, this.camera);
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate);
    if (!this.ready) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.input.textEntry = this.hud.editingText;
    this.input.beginFrame();
    const pads = Array.from(navigator.getGamepads?.() ?? []);
    const input = this.input.update(dt, -2, 1, this.settings.splitOrientation, false, pads, 1);
    const kbMenu = this.input.keyboardMenu();
    input.mapTogglePressed ||= kbMenu.mapTogglePressed;
    input.menu.confirm ||= kbMenu.menu.confirm;
    if (this.hud.paused) {
      this.sound.updateEngine(0, 'jeep', false);
      this.hud.handleMenu({
        up: input.menu.up || kbMenu.menu.up,
        down: input.menu.down || kbMenu.menu.down,
        left: input.menu.left || kbMenu.menu.left,
        right: input.menu.right || kbMenu.menu.right,
        confirm: input.menu.confirm || kbMenu.menu.confirm,
        back: input.menu.back || kbMenu.menu.back,
        options: input.menu.options || kbMenu.menu.options,
      });
      if (input.mapTogglePressed && this.hud.paused) this.hud.toggleBigMap();
      this.hud.update(this.hudState(input));
      if (!this.pausedRendered) {
        this.render();
        this.pausedRendered = true;
      }
      return;
    }
    this.pausedRendered = false;
    this.step(input, dt);
    this.sound.setListener(this.camera);
    this.hud.update(this.hudState(input));
    this.render();
    this.hud.recordFrame();
  };

  /** Dev only: runs the game `seconds` ahead with `hold` pressed. */
  debugAdvance(seconds: number, hold: Partial<InputState> = {}): void {
    const base = this.input.update(0);
    for (let t = 0; t < seconds; t += 1 / 30) this.step({ ...base, ...hold }, 1 / 30);
  }

  /** Dev only: the pieces a test needs to reach in and look at. */
  get debug() {
    return {
      buggy: this.buggy,
      terrain: this.terrain,
      camps: this.camps,
      loose: this.loose,
      stats: this.stats,
      camera: this.camera,
      state: () => ({ building: !!this.building, built: this.camps.map((c) => c.built), delivered: this.camps.map((c) => c.delivered), cargo: this.buggy.cargo }),
    };
  }
}
