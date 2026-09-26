import * as THREE from 'three';
import { surfaceHeightAt } from './Terrain';

/** Where the moon hangs (and the moonlight's shadows come from): low enough to see from the tank. */
export const MOON_DIRECTION = new THREE.Vector3(160, 105, 70).normalize();
const SKY_RADIUS = 1500;
const STAR_COUNT = 1400;

// The enemy bases' guns hose tracer into the sky (so you can see where every standing base is
// from far off), parachute flares go up over the other troops, and now and then something goes
// up with a flash. Just scenery: none of it can hurt anyone.
/** A base's guns go quiet while the player is right in it (the real fight is on). */
const BASE_QUIET_DIST = 110;
/** Flares go up over troops between these distances from the player. */
const FLARE_MIN_DIST = 120;
const FLARE_MAX_DIST = 900;
/** Tracer rounds burn out before they get this close to the player: they stay off in the distance. */
const ROUND_KEEP_AWAY = 140;
const MAX_ROUNDS = 260;
const ROUND_GAP = 0.075;
const GRAVITY = -9.8;
const MAX_FLARES = 8;
/** Point lights are pooled: adding or removing lights recompiles every shader. */
const FLARE_LIGHTS = 2;
const FLARE_RISE_SPEED = 48;
const FLARE_BURN_TIME = 13;
const FLARE_FADE = 2.5;

const TRACER_RED = new THREE.Color(0xff5a2a);
const TRACER_AMBER = new THREE.Color(0xffc04a);
/** Flares over the enemy's troops are red, over your side's green. */
const FLARE_ENEMY = 0xff6a5a;
const FLARE_FRIENDLY = 0x9dff8a;

/** A base's flak gun: the tracer comes out of its barrels, and it swings round to fire. */
export interface FlakGun {
  readonly alive: boolean;
  readonly muzzle: THREE.Vector3;
  aimAlong(dir: THREE.Vector3): void;
}

/** A standing enemy base: its (unchanging) centre, and its flak gun if it has one. */
export interface NightBase {
  position: THREE.Vector3;
  gun: FlakGun | null;
}

/** What the night sky marks: where the standing enemy bases are, and where troops are. */
export interface NightTargets {
  bases(): NightBase[];
  troops(): { position: THREE.Vector3; friendly: boolean }[];
}

interface BaseGuns {
  nextBurst: number;
  nextFlash: number;
}

interface Burst {
  from: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  /** How long each round glows for. */
  life: number;
  /** Fired from this gun's barrels (it swings round first), rather than from `from`. */
  gun: FlakGun | null;
  color: THREE.Color;
  left: number;
  timer: number;
}

interface Round {
  /** Burns out near the player (scattered fire; a flak gun's always leans away, so it doesn't). */
  keepAway: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  color: THREE.Color;
}

interface Flare {
  sprite: THREE.Sprite;
  pos: THREE.Vector3;
  top: number;
  burning: boolean;
  age: number;
  color: THREE.Color;
  light: THREE.PointLight | null;
  sway: number;
}

interface Flash {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  size: number;
}

/** A soft round glow: white-hot middle fading out to nothing (tinted by the sprite's colour). */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A pale full moon with a faint halo. */
function moonTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const halo = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  halo.addColorStop(0, 'rgba(190,210,255,0.35)');
  halo.addColorStop(1, 'rgba(190,210,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#eef2ff';
  ctx.beginPath();
  ctx.arc(128, 128, 44, 0, Math.PI * 2);
  ctx.fill();
  // A few grey seas so it reads as the moon.
  ctx.fillStyle = 'rgba(150,160,190,0.45)';
  for (const [x, y, r] of [[112, 116, 13], [142, 138, 10], [136, 106, 7], [118, 146, 6]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * The night mission's sky: stars and a moon that stay put however far you drive, and distant
 * firefights round the horizon with streams of tracers, parachute flares drifting down and
 * flashes on the ground.
 */
export class NightSky {
  private readonly sky = new THREE.Group();
  private readonly glow = glowTexture();
  private readonly tracers: THREE.InstancedMesh;
  private readonly rounds: Round[] = [];
  private readonly bursts: Burst[] = [];
  /** Firing timers for each base, keyed by its (unchanging) centre. */
  private readonly baseGuns = new Map<THREE.Vector3, BaseGuns>();
  private nextFlare = 1;
  private readonly flares: Flare[] = [];
  private readonly flashes: Flash[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly size = new THREE.Vector3(1, 1, 1);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly targets: NightTargets,
  ) {
    // Stars on the upper half of a big sphere, dimmer towards the horizon.
    const positions: number[] = [];
    const colors: number[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(0.03, 1), rand(-1, 1)).normalize();
      positions.push(dir.x * SKY_RADIUS, dir.y * SKY_RADIUS, dir.z * SKY_RADIUS);
      const b = rand(0.35, 1) * Math.min(1, 0.4 + dir.y * 1.5);
      colors.push(b * rand(0.85, 1), b * rand(0.88, 1), b);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false }));
    stars.frustumCulled = false;
    this.sky.add(stars);

    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), fog: false, depthWrite: false }));
    moon.position.copy(MOON_DIRECTION).multiplyScalar(SKY_RADIUS * 0.95);
    moon.scale.setScalar(260);
    this.sky.add(moon);
    scene.add(this.sky);

    const tracerMaterial = new THREE.MeshBasicMaterial({ fog: false, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    this.tracers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.5, 17), tracerMaterial, MAX_ROUNDS);
    this.tracers.setColorAt(0, TRACER_RED); // creates the colour buffer
    this.tracers.count = 0;
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);

    for (let i = 0; i < FLARE_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 520, 1);
      scene.add(light);
      this.lights.push(light);
    }
  }

  update(dt: number, camera: THREE.Camera, player: THREE.Vector3): void {
    this.sky.position.copy(camera.position);
    this.updateBaseGuns(dt, player);
    this.updateTroopFlares(dt, player);
    this.updateBursts(dt);
    this.updateRounds(dt, player, camera.position);
    this.updateFlares(dt);
    this.updateFlashes(dt);
  }

  /** Every standing enemy base keeps firing tracer, so its position shows from across the map. */
  private updateBaseGuns(dt: number, player: THREE.Vector3): void {
    for (const { position: base, gun } of this.targets.bases()) {
      let guns = this.baseGuns.get(base);
      if (!guns) {
        guns = { nextBurst: rand(0, 1.5), nextFlash: rand(1, 5) };
        this.baseGuns.set(base, guns);
      }
      // Without its flak gun, a base's scattered fire stops when the player's right there.
      if (!gun?.alive && base.distanceTo(player) < BASE_QUIET_DIST) continue;
      guns.nextBurst -= dt;
      if (guns.nextBurst <= 0) {
        guns.nextBurst = rand(0.5, 1.8);
        this.startBurst(base, gun?.alive ? gun : null, player);
      }
      guns.nextFlash -= dt;
      if (guns.nextFlash <= 0) {
        guns.nextFlash = rand(3, 8);
        this.flash(base.clone().add(new THREE.Vector3(rand(-50, 50), 0, rand(-50, 50))));
      }
    }
  }

  /** Every so often a flare goes up over a squad or tank somewhere off in the distance. */
  private updateTroopFlares(dt: number, player: THREE.Vector3): void {
    this.nextFlare -= dt;
    if (this.nextFlare > 0) return;
    this.nextFlare = rand(1.2, 2.8);
    const candidates = this.targets.troops().filter((t) => {
      const d = t.position.distanceTo(player);
      return d > FLARE_MIN_DIST && d < FLARE_MAX_DIST;
    });
    // There are far more enemy soldiers than friendly ones, so pick a side first: some green flares too.
    const friendly = candidates.filter((t) => t.friendly);
    const enemy = candidates.filter((t) => !t.friendly);
    const side = friendly.length > 0 && (enemy.length === 0 || Math.random() < 0.35) ? friendly : enemy;
    if (side.length === 0) return;
    const pick = side[Math.floor(Math.random() * side.length)];
    this.launchFlare(pick.position, pick.friendly ? FLARE_FRIENDLY : FLARE_ENEMY);
  }

  /**
   * A burst of tracer from a base's guns: mostly hosed up into the sky, sometimes low across the
   * ground. It always leans away from the player, so it never streams overhead. A base with its
   * flak gun still standing fires it from there, always skyward; otherwise from round the base.
   */
  private startBurst(base: THREE.Vector3, gun: FlakGun | null, player: THREE.Vector3): void {
    const from = gun ? gun.muzzle : base.clone().add(new THREE.Vector3(rand(-45, 45), 0, rand(-45, 45)));
    if (!gun) from.y = surfaceHeightAt(from.x, from.z) + 3;
    const skyward = gun !== null || Math.random() < 0.8;
    const speed = rand(170, 230);
    const flat = from.clone().sub(player).setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), rand(-1.2, 1.2));
    const elevation = skyward ? rand(0.7, 1.3) : rand(0.04, 0.16);
    const dir = flat.multiplyScalar(Math.cos(elevation)).setY(Math.sin(elevation));
    const color = skyward ? (Math.random() < 0.6 ? TRACER_AMBER : TRACER_RED) : TRACER_RED;
    const life = skyward ? rand(1.8, 2.6) : rand(1, 1.6);
    gun?.aimAlong(dir);
    // A gun swings round before it opens up.
    this.bursts.push({ from, dir, speed, life, gun, color, left: Math.floor(rand(6, 14)), timer: gun ? 1 : 0 });
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.timer -= dt;
      while (b.timer <= 0 && b.left > 0) {
        b.timer += ROUND_GAP;
        b.left--;
        if (this.rounds.length >= MAX_ROUNDS) break;
        const dir = b.dir.clone();
        dir.x += rand(-0.03, 0.03);
        dir.y += rand(-0.02, 0.02);
        dir.z += rand(-0.03, 0.03);
        if (b.gun && !b.gun.alive) {
          b.left = 0;
          break;
        }
        this.rounds.push({ keepAway: !b.gun, pos: b.gun ? b.gun.muzzle : b.from.clone(), vel: dir.normalize().multiplyScalar(b.speed), age: 0, life: b.life * rand(0.9, 1.1), color: b.color });
      }
      if (b.left <= 0) this.bursts.splice(i, 1);
    }
  }

  private updateRounds(dt: number, player: THREE.Vector3, eye: THREE.Vector3): void {
    let n = 0;
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i];
      r.age += dt;
      r.vel.y += GRAVITY * dt;
      r.pos.addScaledVector(r.vel, dt);
      if (r.age > r.life || r.pos.y < surfaceHeightAt(r.pos.x, r.pos.z) || (r.keepAway && r.pos.distanceTo(player) < ROUND_KEEP_AWAY)) {
        this.rounds.splice(i, 1);
        continue;
      }
      this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.vel.clone().normalize());
      // Fat enough to read from half a map away, but slim streaks when they're close.
      const d = r.pos.distanceTo(eye);
      const thick = THREE.MathUtils.clamp(d / 350, 0.12, 1);
      this.size.set(thick, thick, THREE.MathUtils.clamp(d / 250, 0.3, 1));
      this.tracers.setMatrixAt(n, this.matrix.compose(r.pos, this.quat, this.size));
      this.tracers.setColorAt(n, r.color);
      n++;
    }
    this.tracers.count = n;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
  }

  /** A parachute flare: shot up from the ground, then drifting slowly down, lighting the area below. */
  private launchFlare(at: THREE.Vector3, tint: number): void {
    if (this.flares.length >= MAX_FLARES) return;
    const color = new THREE.Color(tint);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glow, color, fog: false, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    const pos = at.clone().setY(surfaceHeightAt(at.x, at.z) + 2);
    sprite.position.copy(pos);
    sprite.scale.setScalar(4);
    this.scene.add(sprite);
    this.flares.push({ sprite, pos, top: pos.y + rand(65, 95), burning: false, age: 0, color, light: null, sway: rand(0, Math.PI * 2) });
  }

  private updateFlares(dt: number): void {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      const material = f.sprite.material as THREE.SpriteMaterial;
      if (!f.burning) {
        f.pos.y += FLARE_RISE_SPEED * dt;
        if (f.pos.y >= f.top) {
          f.burning = true;
          f.age = 0;
          f.light = this.lights.find((l) => !this.flares.some((o) => o.light === l)) ?? null;
          if (f.light) f.light.color.copy(f.color);
        }
      } else {
        f.age += dt;
        f.sway += dt * 0.8;
        f.pos.x += Math.sin(f.sway) * 1.2 * dt;
        f.pos.z += Math.cos(f.sway * 0.7) * 1.2 * dt;
        f.pos.y -= 3.2 * dt; // hanging under its parachute
      }
      const fade = f.burning ? THREE.MathUtils.clamp((FLARE_BURN_TIME - f.age) / FLARE_FADE, 0, 1) : 1;
      const flicker = f.burning ? 0.85 + Math.random() * 0.15 : 1;
      material.opacity = fade * flicker;
      f.sprite.position.copy(f.pos);
      f.sprite.scale.setScalar(f.burning ? 50 * Math.min(1, 0.3 + f.age * 3) : 9);
      if (f.light) {
        f.light.position.copy(f.pos);
        f.light.intensity = 40 * fade * flicker * Math.min(1, f.age * 3);
      }
      if (f.burning && f.age >= FLARE_BURN_TIME) {
        if (f.light) f.light.intensity = 0;
        this.scene.remove(f.sprite);
        material.dispose();
        this.flares.splice(i, 1);
      }
    }
  }

  /** Something going up on the horizon: an orange glow that swells and fades. */
  private flash(at: THREE.Vector3): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glow, color: 0xff9a40, fog: false, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    sprite.position.copy(at).setY(surfaceHeightAt(at.x, at.z) + 6);
    this.scene.add(sprite);
    this.flashes.push({ sprite, age: 0, life: rand(0.5, 0.9), size: rand(30, 55) });
  }

  private updateFlashes(dt: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const t = f.age / f.life;
      const material = f.sprite.material as THREE.SpriteMaterial;
      material.opacity = Math.max(0, 1 - t);
      f.sprite.scale.setScalar(f.size * (0.5 + t * 0.7));
      if (t >= 1) {
        this.scene.remove(f.sprite);
        material.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }
}
