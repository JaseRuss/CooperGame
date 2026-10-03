import * as THREE from 'three';
import type { NightSky } from '../world/NightSky';

/** Where the moon hangs: out over the sea (north), so the water glitters ahead of the raft. */
export const MOON_DIR = new THREE.Vector3(-45, 62, -90);
const MOON: [number, number, number] = [MOON_DIR.x, MOON_DIR.y, MOON_DIR.z];

/** One look of the sky and the lights, at a point in the night's turn into morning (0 to 1). */
interface Look {
  at: number;
  sky: number;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunLight: number;
  /** Where the sun (or moon) shines from, relative to the player (for the shadows). */
  dir: [number, number, number];
  fogNear: number;
  fogFar: number;
  water: number;
}

/** Deep night, the first grey of dawn, the sky catching fire, then a clear pale morning. */
const LOOKS: Look[] = [
  { at: 0, sky: 0x070b18, fog: 0x080d1c, hemiSky: 0x6c84b8, hemiGround: 0x2a2c3a, hemi: 1, sun: 0x9fb6ff, sunLight: 0.85, dir: MOON, fogNear: 40, fogFar: 230, water: 0x143c5a },
  { at: 0.4, sky: 0x1d2248, fog: 0x2a2a58, hemiSky: 0x8088c8, hemiGround: 0x3a3640, hemi: 1.05, sun: 0xff9a6a, sunLight: 0.8, dir: [70, 14, -50], fogNear: 50, fogFar: 270, water: 0x14304a },
  { at: 0.7, sky: 0xc47a72, fog: 0xd69a82, hemiSky: 0xe8b8a8, hemiGround: 0x6a5648, hemi: 1.15, sun: 0xffb070, sunLight: 1.15, dir: [80, 22, -30], fogNear: 70, fogFar: 340, water: 0x2a4a62 },
  { at: 1, sky: 0xa6c6ea, fog: 0xcdd6de, hemiSky: 0xdce8ff, hemiGround: 0x8a7a60, hemi: 1.3, sun: 0xffe2b0, sunLight: 1.5, dir: [50, 55, -20], fogNear: 90, fogFar: 420, water: 0x3a6a86 },
];

/**
 * The whole bonus level is a night, until the dawn breaks as the raft reaches the shore. `set`
 * takes how far into the dawn it is (0 night, 1 full morning) and blends the sky, fog, lights
 * and the sea's colour, and fades the stars.
 */
export class DayCycle {
  /** Where the sun (or moon) sits relative to the player: the game puts its shadow-casting light here. */
  readonly sunOffset = new THREE.Vector3(30, 60, 20);
  /** The sea's colour at this time of day. */
  readonly waterColor = new THREE.Color(LOOKS[0].water);
  /** How far into the dawn it is now. */
  value = 0;
  private readonly b = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly fog: THREE.Fog,
    private readonly hemi: THREE.HemisphereLight,
    private readonly sun: THREE.DirectionalLight,
    private readonly stars: NightSky,
  ) {
    this.set(0);
  }

  set(t: number): void {
    this.value = t = Math.min(1, Math.max(0, t));
    let i = 0;
    while (i < LOOKS.length - 2 && t > LOOKS[i + 1].at) i++;
    const from = LOOKS[i];
    const to = LOOKS[i + 1];
    const f = THREE.MathUtils.smoothstep(t, from.at, to.at);
    const mix = (out: THREE.Color, x: number, y: number) => out.set(x).lerp(this.b.set(y), f);
    mix(this.scene.background as THREE.Color, from.sky, to.sky);
    mix(this.fog.color, from.fog, to.fog);
    mix(this.hemi.color, from.hemiSky, to.hemiSky);
    mix(this.hemi.groundColor, from.hemiGround, to.hemiGround);
    mix(this.sun.color, from.sun, to.sun);
    mix(this.waterColor, from.water, to.water);
    this.hemi.intensity = THREE.MathUtils.lerp(from.hemi, to.hemi, f);
    this.sun.intensity = THREE.MathUtils.lerp(from.sunLight, to.sunLight, f);
    this.fog.near = THREE.MathUtils.lerp(from.fogNear, to.fogNear, f);
    this.fog.far = THREE.MathUtils.lerp(from.fogFar, to.fogFar, f);
    this.sunOffset.set(
      THREE.MathUtils.lerp(from.dir[0], to.dir[0], f),
      THREE.MathUtils.lerp(from.dir[1], to.dir[1], f),
      THREE.MathUtils.lerp(from.dir[2], to.dir[2], f),
    );
    this.stars.setDarkness(1 - THREE.MathUtils.smoothstep(t, 0.15, 0.75));
  }
}
