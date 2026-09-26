import * as THREE from 'three';
import { versionAssetURL } from '../world/AssetLibrary';
import { clamp } from '../utils/math';
import { Music } from './Music';
import type { Mission } from '../core/config';
import type { Volume } from '../core/Settings';

/**
 * Kenney CC0 samples in public/sounds (Sci-fi, Impact and Interface Sounds), under the name the
 * game plays them by. Several files means one is picked at random each time.
 */
const SAMPLES = {
  explosion: ['explosionCrunch_000', 'explosionCrunch_001', 'explosionCrunch_002', 'explosionCrunch_003', 'explosionCrunch_004'],
  boom: ['lowFrequency_explosion_000'],
  cannon: ['lowFrequency_explosion_001'],
  crack: ['explosionCrunch_000'],
  splat: ['slime_000'],
  jamShot: ['pluck_002'],
  launch: ['thrusterFire_000'],
  poof: ['forceField_000'],
  thud: ['impactSoft_heavy_000'],
  clang: ['impactMetal_heavy_001'],
  uiMove: ['select_001'],
  uiChange: ['toggle_001'],
  uiBack: ['back_001'],
  uiOpen: ['maximize_001'],
  uiConfirm: ['confirmation_001'],
} satisfies Record<string, string[]>;

export type SoundName = keyof typeof SAMPLES;

export interface PlayOptions {
  /** Where it happens; quieter with distance and panned left/right. Omit for "in your ears" (UI, your own gun). */
  at?: THREE.Vector3;
  volume?: number;
  /** Playback speed: above 1 is higher and shorter. */
  rate?: number;
  /** Fade out and stop after this many seconds (for long samples like the rocket motor). */
  fadeAfter?: number;
  /** Don't play this sound again within this many seconds (rapid fire, jam splats). */
  minGap?: number;
}

/** Gain for each volume setting: Off, Low, Medium, High. */
const SFX_LEVELS = [0, 0.35, 0.65, 1];
const MUSIC_LEVELS = [0, 0.3, 0.55, 0.85];

/** Distance (m) at which a sound is at about half volume, and beyond which it isn't heard. */
const REF_DISTANCE = 45;
const MAX_DISTANCE = 650;
const MAX_VOICES = 28;

/**
 * All the game's audio: sound effects (samples, placed in the world relative to the camera), the
 * player's engine note (synthesised, following speed) and the music (see Music). Browsers only
 * let a page make sound after a click or key press, so it stays silent until then.
 */
export class Sound {
  readonly ctx: AudioContext;
  readonly music: Music;
  private readonly master: GainNode;
  private readonly sfxBus: GainNode;
  private readonly musicBus: GainNode;
  private readonly buffers = new Map<SoundName, AudioBuffer[]>();
  private readonly lastPlayed = new Map<SoundName, number>();
  private readonly listener = new THREE.Vector3();
  private readonly listenerRight = new THREE.Vector3(1, 0, 0);
  private voices = 0;
  private sfxLevel = 1;
  private engine: { a: OscillatorNode; b: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; clatter: GainNode; lfo: OscillatorNode } | null = null;

  constructor(mission: Mission) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    // A limiter on the way out, so a pile of explosions at once can't crackle.
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.master.connect(limiter).connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.music = new Music(this.ctx, this.musicBus, mission);

    // Sound can only start from a real click or key press (a gamepad button doesn't count).
    const unlock = () => void this.ctx.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // Hidden tabs throttle timers, which would bunch the music up; just pause it all.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** True until the player clicks or presses a key (the browser keeps pages quiet until then). */
  get locked(): boolean {
    return this.ctx.state !== 'running' && !document.hidden;
  }

  /** Fetches and decodes every sample in the background; each can play as soon as it's in. */
  async load(): Promise<void> {
    const names = Object.keys(SAMPLES) as SoundName[];
    const files = new Map<string, Promise<AudioBuffer | null>>();
    const fetchFile = (file: string) => {
      let job = files.get(file);
      if (!job) {
        const url = versionAssetURL(`${import.meta.env.BASE_URL}sounds/${file}.ogg`);
        job = fetch(url)
          .then((r) => r.arrayBuffer())
          .then((data) => this.ctx.decodeAudioData(data))
          .catch(() => null); // a missing sound just stays silent
        files.set(file, job);
      }
      return job;
    };
    await Promise.all(
      names.map(async (name) => {
        const buffers = (await Promise.all(SAMPLES[name].map(fetchFile))).filter((b): b is AudioBuffer => b !== null);
        if (buffers.length) this.buffers.set(name, buffers);
      }),
    );
  }

  setVolumes(sfx: Volume, music: Volume): void {
    this.sfxLevel = SFX_LEVELS[sfx];
    this.sfxBus.gain.setTargetAtTime(this.sfxLevel, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(MUSIC_LEVELS[music], this.ctx.currentTime, 0.05);
  }

  /** Where the ears are: the camera, and which way is its right. */
  setListener(camera: THREE.Camera): void {
    camera.getWorldPosition(this.listener);
    this.listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  }

  play(name: SoundName, opts: PlayOptions = {}): void {
    const { at, volume = 1, rate = 1, fadeAfter, minGap = 0.03 } = opts;
    const buffers = this.buffers.get(name);
    if (!buffers || this.ctx.state !== 'running' || this.sfxLevel === 0 || this.voices >= MAX_VOICES) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < minGap) return;

    let gain = volume;
    let pan = 0;
    if (at) {
      const offset = at.clone().sub(this.listener);
      const d = offset.length();
      if (d > MAX_DISTANCE) return;
      gain *= (1 / (1 + (d / REF_DISTANCE) ** 1.5)) * (1 - d / MAX_DISTANCE);
      if (d > 1) pan = clamp(offset.dot(this.listenerRight) / d, -1, 1) * 0.75;
    }
    if (gain < 0.01) return;
    this.lastPlayed.set(name, now);

    const src = this.ctx.createBufferSource();
    src.buffer = buffers[Math.floor(Math.random() * buffers.length)];
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (fadeAfter !== undefined) {
      g.gain.setValueAtTime(gain, now + fadeAfter);
      g.gain.linearRampToValueAtTime(0, now + fadeAfter + 0.4);
      src.stop(now + fadeAfter + 0.45);
    }
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(g).connect(panner).connect(this.sfxBus);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      panner.disconnect();
    };
    src.start();
  }

  /**
   * The player's engine: a low, clanking rumble for the tank and a higher buzz for the jeep,
   * rising with speed. Silent while `running` is false (paused, rocket cam).
   */
  updateEngine(speed: number, jeep: boolean, running: boolean): void {
    if (this.ctx.state !== 'running') return;
    const e = (this.engine ??= this.buildEngine());
    const t = this.ctx.currentTime;
    const pace = clamp(speed / (jeep ? 36 : 22), 0, 1.3);
    const pitch = jeep ? 62 + pace * 70 : 34 + pace * 26;
    e.a.frequency.setTargetAtTime(pitch, t, 0.12);
    e.b.frequency.setTargetAtTime(pitch * (jeep ? 2.01 : 1.5), t, 0.12);
    e.filter.frequency.setTargetAtTime(jeep ? 600 + pace * 900 : 220 + pace * 380, t, 0.15);
    // Tank tracks clank in time with the speed; the jeep just purrs.
    e.lfo.frequency.setTargetAtTime(jeep ? 18 : 3 + pace * 9, t, 0.2);
    e.clatter.gain.setTargetAtTime(jeep ? 0.12 : 0.45 * Math.min(1, pace * 2), t, 0.2);
    e.gain.gain.setTargetAtTime(running ? (jeep ? 0.05 : 0.07) * (0.55 + pace * 0.6) : 0, t, running ? 0.15 : 0.05);
  }

  private buildEngine(): NonNullable<Sound['engine']> {
    const a = this.ctx.createOscillator();
    a.type = 'sawtooth';
    const b = this.ctx.createOscillator();
    b.type = 'square';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    // Amplitude wobble for the track clatter: an LFO feeding a gain's gain.
    const wobble = this.ctx.createGain();
    wobble.gain.value = 1;
    const clatter = this.ctx.createGain();
    clatter.gain.value = 0;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.connect(clatter).connect(wobble.gain);
    const mixB = this.ctx.createGain();
    mixB.gain.value = 0.35;
    a.connect(filter);
    b.connect(mixB).connect(filter);
    filter.connect(wobble).connect(gain).connect(this.sfxBus);
    a.start();
    b.start();
    lfo.start();
    return { a, b, filter, gain, clatter, lfo };
  }
}
