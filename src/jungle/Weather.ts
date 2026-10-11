import * as THREE from 'three';

/** Calm weather's fog, and the storm's: how far you can see, in metres. */
const CALM_FOG = { near: 28, far: 235 };
const STORM_FOG = { near: 1, far: 44 };
const RAIN_DROPS = 1700;
/** Box the rain falls in round the camera. */
const BOX = { x: 34, y: 26, z: 34 };
const FALL_SPEED = 30;
const WIND = 4;

type Phase = 'calm' | 'rolling' | 'storm' | 'clearing';
const PHASE_TIME: Record<Phase, [number, number]> = { calm: [55, 85], rolling: [18, 18], storm: [50, 75], clearing: [20, 20] };

export type WeatherEvent = 'rolling' | 'storm' | 'clearing' | 'calm' | 'thunder';

/**
 * Rain storms that roll in out of a clear sky now and then: the fog closes in to a few dozen
 * metres, the light goes grey, rain streaks fall past the camera and lightning flashes. The
 * storm builds over about 18 seconds, rages for a minute or so, and fades out again.
 */
export class Weather {
  /** 0 clear .. 1 full storm. */
  intensity = 0;
  phase: Phase = 'calm';
  private timer = 0;
  private flash = 0;
  private nextFlash = 3;
  private thunderIn = -1;
  private readonly rain: THREE.LineSegments;
  private readonly offsets = new Float32Array(RAIN_DROPS * 3);
  private readonly calmSky = new THREE.Color(0x9fbfa4);
  private readonly stormSky = new THREE.Color(0x46524f);
  private readonly sky = new THREE.Color();
  private readonly baseHemi: number;
  private readonly baseSun: number;
  private readonly events: WeatherEvent[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly fog: THREE.Fog,
    private readonly hemi: THREE.HemisphereLight,
    private readonly sun: THREE.DirectionalLight,
  ) {
    this.baseHemi = hemi.intensity;
    this.baseSun = sun.intensity;
    this.timer = 40 + Math.random() * 20; // the first storm comes fairly soon
    for (let i = 0; i < RAIN_DROPS; i++) {
      this.offsets[i * 3] = (Math.random() * 2 - 1) * BOX.x;
      this.offsets[i * 3 + 1] = (Math.random() * 2 - 1) * BOX.y;
      this.offsets[i * 3 + 2] = (Math.random() * 2 - 1) * BOX.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_DROPS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc4d4dc, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 20;
    this.rain.visible = false;
    scene.add(this.rain);
    this.apply();
  }

  /** How far enemies (and you) can see, as a share of normal: a storm cuts it to about a third. */
  get visibility(): number {
    return 1 - 0.68 * this.intensity;
  }

  /** The distance, in metres, you can make things out. */
  get seeMetres(): number {
    return Math.round(CALM_FOG.far + (STORM_FOG.far - CALM_FOG.far) * this.intensity);
  }

  get raining(): boolean {
    return this.intensity > 0.12;
  }

  takeEvents(): WeatherEvent[] {
    return this.events.splice(0);
  }

  private advance(next: Phase): void {
    this.phase = next;
    const [lo, hi] = PHASE_TIME[next];
    this.timer = lo + Math.random() * (hi - lo);
    this.events.push(next);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.timer -= dt;
    if (this.phase === 'calm' && this.timer <= 0) this.advance('rolling');
    else if (this.phase === 'rolling') {
      this.intensity = Math.min(1, this.intensity + dt / PHASE_TIME.rolling[0]);
      if (this.timer <= 0) this.advance('storm');
    } else if (this.phase === 'storm' && this.timer <= 0) this.advance('clearing');
    else if (this.phase === 'clearing') {
      this.intensity = Math.max(0, this.intensity - dt / PHASE_TIME.clearing[0]);
      if (this.timer <= 0) this.advance('calm');
    }

    // Lightning, once the storm is properly up.
    this.flash = Math.max(0, this.flash - dt * 4.5);
    if (this.intensity > 0.6) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.nextFlash = 4 + Math.random() * 9;
        this.flash = 1;
        this.thunderIn = 0.4 + Math.random() * 1.8;
      }
    }
    if (this.thunderIn >= 0) {
      this.thunderIn -= dt;
      if (this.thunderIn < 0) this.events.push('thunder');
    }

    this.apply();
    this.moveRain(dt, camera.position);
  }

  private apply(): void {
    const s = this.intensity;
    this.fog.near = CALM_FOG.near + (STORM_FOG.near - CALM_FOG.near) * s;
    this.fog.far = CALM_FOG.far + (STORM_FOG.far - CALM_FOG.far) * s;
    this.sky.copy(this.calmSky).lerp(this.stormSky, s);
    if (this.flash > 0) this.sky.lerp(new THREE.Color(0xe8f0ff), this.flash * 0.55);
    this.fog.color.copy(this.sky);
    this.hemi.intensity = this.baseHemi * (1 - 0.5 * s) + this.flash * 2.4;
    this.sun.intensity = this.baseSun * (1 - 0.75 * s) + this.flash * 1.2;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.55 * Math.min(1, s * 1.6);
    this.rain.visible = s > 0.05;
  }

  /** The sky colour to use as the scene background (it follows the fog). */
  get skyColor(): THREE.Color {
    return this.sky;
  }

  private moveRain(dt: number, cam: THREE.Vector3): void {
    if (!this.rain.visible) return;
    const pos = (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const o = this.offsets;
    for (let i = 0; i < RAIN_DROPS; i++) {
      let y = o[i * 3 + 1] - FALL_SPEED * dt;
      if (y < -BOX.y) {
        y += BOX.y * 2;
        o[i * 3] = (Math.random() * 2 - 1) * BOX.x;
        o[i * 3 + 2] = (Math.random() * 2 - 1) * BOX.z;
      }
      o[i * 3 + 1] = y;
      const x = cam.x + o[i * 3];
      const z = cam.z + o[i * 3 + 2];
      const wy = cam.y + y;
      pos[i * 6] = x;
      pos[i * 6 + 1] = wy;
      pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x + WIND * 0.045;
      pos[i * 6 + 4] = wy + FALL_SPEED * 0.045;
      pos[i * 6 + 5] = z;
    }
    (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
