import type { Mission } from '../core/config';
import { mulberry32 } from '../utils/rng';

/**
 * Each level's music, played live by a little step sequencer: drums, a bass line, chords and a
 * tune, all synthesised (no recordings). A song is a loop of bars; each bar is 16 steps
 * (sixteenth notes) over one chord. The tune is made up once from the song's seed, so it's the
 * same every time you play.
 */

type Drum = 'kick' | 'snare' | 'hat' | 'bongoHi' | 'bongoLo' | 'tom';
type Lead = 'bugle' | 'flute' | 'marimba';

interface Song {
  bpm: number;
  /** One chord per bar: its root as a MIDI note, and major or minor. */
  chords: [number, 'maj' | 'min'][];
  /** 16 steps per bar: 'x' a hit, 'o' a soft hit, '.' nothing. A list is used bar by bar, cycling. */
  drums: Partial<Record<Drum, string[]>>;
  /** 16 steps: 'r' root, 'f' fifth, 'o' octave, 't' third, '.' rest. */
  bass: string;
  bassWave: OscillatorType;
  lead: Lead;
  /** Rhythm of the tune, bar by bar (cycling): 'x' starts a note. */
  rhythm: string[];
  /** The key's home note (MIDI). */
  key: number;
  /** Notes the tune picks from: 'chord' for the chord's own notes (a bugle), or a scale in semitones above the key. */
  tuneNotes: 'chord' | number[];
  /** Octaves above the chord root (or key) the tune sits. */
  tuneOctave: number;
  /** Soft sustained chords underneath. */
  pad: boolean;
  seed: number;
}

// C3 = 48, D3 = 50, A2 = 45 ...
const C = 48;
const D = 50;
const A = 45;

const SONGS: Record<Mission, Song> = {
  // Day Battle: a jaunty toy-soldier march in C major, with a bugle playing the tune.
  1: {
    bpm: 112,
    chords: [[C, 'maj'], [C + 5, 'maj'], [C + 7, 'maj'], [C, 'maj'], [C, 'maj'], [C + 5, 'maj'], [C + 7, 'maj'], [C, 'maj']],
    drums: {
      kick: ['x.......x.......'],
      snare: ['....x.......x...', '....x.......x...', '....x.......x...', '....x...o.o.xoxo'],
    },
    bass: 'r...f...r...f...',
    bassWave: 'triangle',
    lead: 'bugle',
    rhythm: ['x..xx...x...x...', 'x...x...x.x.x...', 'x..xx...x...x.x.', 'x.......x.......'],
    key: C,
    tuneNotes: 'chord',
    tuneOctave: 1,
    pad: false,
    seed: 11,
  },
  // Night Raid: slower and sneakier in D minor, a pulsing bass, soft pads and a lonely flute.
  2: {
    bpm: 92,
    chords: [[D, 'min'], [D, 'min'], [D - 4, 'maj'], [D - 5, 'min'], [D, 'min'], [D - 2, 'maj'], [D - 4, 'maj'], [D - 5, 'min']],
    drums: {
      kick: ['x.........x.....'],
      hat: ['..o...o...o...o.'],
      tom: ['................', '................', '................', '............o.o.'],
    },
    bass: 'r.o.f.o.r.o.f.o.',
    bassWave: 'triangle',
    lead: 'flute',
    rhythm: ['x.......x.......', '....x...........', 'x...x...x.......', '................'],
    key: D,
    tuneNotes: [0, 3, 5, 7, 10, 12],
    tuneOctave: 2,
    pad: true,
    seed: 29,
  },
  // Jungle Strike: bongos and shakers under a marimba tune in A minor pentatonic.
  3: {
    bpm: 116,
    chords: [[A, 'min'], [A, 'min'], [A - 2, 'maj'], [A, 'min'], [A - 4, 'maj'], [A - 2, 'maj'], [A, 'min'], [A - 5, 'min']],
    drums: {
      kick: ['x.......x.......'],
      hat: ['o.o.o.o.o.o.o.o.'],
      bongoHi: ['x..x..x...x.x...'],
      bongoLo: ['..x.....x..x..x.'],
    },
    bass: 'r..r..f.r..r..o.',
    bassWave: 'sine',
    lead: 'marimba',
    rhythm: ['x.x..x..x.x..x..', 'x..x..x.x...x...', 'x.x..x..x.x..x.x', 'x...x...x..x....'],
    key: A,
    tuneNotes: [0, 3, 5, 7, 10, 12, 15],
    tuneOctave: 2,
    pad: false,
    seed: 47,
  },
};

const LOOKAHEAD = 0.15; // seconds of notes scheduled ahead
/** The band's overall level, leaving headroom for the sound effects on top. */
const BAND_LEVEL = 0.6;
const TICK_MS = 40;

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface TuneNote {
  step: number; // from the start of the loop
  midi: number;
  steps: number; // length
}

export class Music {
  private readonly song: Song;
  private readonly tune: TuneNote[];
  private readonly loopSteps: number;
  private readonly noise: AudioBuffer;
  private readonly out: GainNode;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;

  constructor(private readonly ctx: AudioContext, destination: AudioNode, mission: Mission) {
    this.song = SONGS[mission];
    // The tune runs twice round the chords: the second time starts like the first and then goes its own way.
    this.loopSteps = this.song.chords.length * 16 * 2;
    this.tune = this.makeTune();
    this.out = ctx.createGain();
    this.out.gain.value = BAND_LEVEL;
    this.out.connect(destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  private get stepTime(): number {
    return 60 / this.song.bpm / 4;
  }

  start(): void {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setValueAtTime(BAND_LEVEL, this.ctx.currentTime);
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Victory: the song stops and a bugle plays a big "ta-ta-ta-taaa!" with a drum roll. */
  fanfare(): void {
    this.stop();
    const t = this.ctx.currentTime + 0.15;
    const notes: [number, number, number][] = [
      [67, 0, 0.14], [67, 0.16, 0.14], [67, 0.32, 0.14], [72, 0.48, 0.5],
      [67, 1.05, 0.2], [72, 1.3, 0.2], [76, 1.55, 0.2], [79, 1.8, 1.1],
    ];
    for (const [m, at, len] of notes) this.lead('bugle', t + at, m, len, 0.16);
    for (let i = 0; i < 14; i++) this.drum('snare', t + 1.8 + i * 0.07, 0.25 + i * 0.03);
    this.drum('kick', t + 1.8, 1);
    this.drum('kick', t + 2.8, 1);
  }

  /** A short rising "ta-da!" over the music, for knocking out an enemy base. */
  stinger(): void {
    const t = this.ctx.currentTime + 0.05;
    [[67, 0, 0.12], [72, 0.13, 0.12], [76, 0.26, 0.45]].forEach(([m, at, len]) => this.lead('bugle', t + at, m, len, 0.13));
    this.drum('snare', t + 0.26, 0.6);
  }

  // ---------- sequencing ----------

  private schedule(): void {
    if (this.ctx.state !== 'running') return;
    // After a pause (or before the sound was unlocked) start again from now, not in a rush to catch up.
    if (this.nextTime < this.ctx.currentTime - 0.05) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.stepTime;
      this.step = (this.step + 1) % this.loopSteps;
    }
  }

  private playStep(step: number, t: number): void {
    const s = this.song;
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const [root, quality] = s.chords[bar % s.chords.length];
    const third = quality === 'maj' ? 4 : 3;

    for (const [drum, bars] of Object.entries(s.drums) as [Drum, string[]][]) {
      const hit = bars[bar % bars.length][inBar];
      if (hit === 'x') this.drum(drum, t, 1);
      else if (hit === 'o') this.drum(drum, t, 0.45);
    }

    const b = s.bass[inBar];
    const offset = { r: 0, f: 7, o: 12, t: third }[b as 'r' | 'f' | 'o' | 't'];
    if (offset !== undefined) this.bass(t, root - 12 + offset, this.stepTime * 3.2);

    if (s.pad && inBar === 0) this.pad(t, [root, root + third, root + 7], this.stepTime * 16);

    for (const n of this.tune) if (n.step === step) this.lead(s.lead, t, n.midi, this.stepTime * n.steps, 0.11);
  }

  /** Makes up the tune: chord tones or scale notes, moving mostly by small steps. */
  private makeTune(): TuneNote[] {
    const s = this.song;
    const rng = mulberry32(s.seed);
    const bars = this.loopSteps / 16;
    const notes: TuneNote[] = [];
    let last = 0;
    for (let bar = 0; bar < bars; bar++) {
      // The second time round opens with the same four bars as the first.
      const copyFrom = bar >= s.chords.length && bar < s.chords.length + 4 ? bar - s.chords.length : -1;
      if (copyFrom >= 0) {
        for (const n of notes.filter((n) => Math.floor(n.step / 16) === copyFrom)) notes.push({ ...n, step: n.step + s.chords.length * 16 });
        continue;
      }
      const [root, quality] = s.chords[bar % s.chords.length];
      const pool = s.tuneNotes === 'chord' ? [0, quality === 'maj' ? 4 : 3, 7, 12] : s.tuneNotes;
      const rhythm = s.rhythm[bar % s.rhythm.length];
      const starts = [...rhythm].flatMap((c, i) => (c === 'x' ? [i] : []));
      starts.forEach((i, k) => {
        // Prefer a note near the last one; the last note of the loop comes home to the root.
        const home = bar === bars - 1 && k === starts.length - 1;
        let pick = home ? 0 : pool[Math.floor(rng() * pool.length)];
        if (!home && Math.abs(pick - last) > 7 && rng() < 0.7) pick = pool[Math.min(pool.length - 1, Math.max(0, pool.indexOf(last) + (rng() < 0.5 ? -1 : 1)))] ?? pick;
        last = pick;
        const end = starts[k + 1] ?? 16;
        const base = s.tuneNotes === 'chord' ? root : s.key;
        notes.push({ step: bar * 16 + i, midi: base + 12 * s.tuneOctave + pick, steps: Math.min(end - i, 6) });
      });
    }
    return notes;
  }

  // ---------- instruments ----------

  private env(t: number, peak: number, attack: number, hold: number, release: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.out);
    return g;
  }

  private osc(type: OscillatorType, freq: number, t: number, stop: number, to: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(to);
    o.start(t);
    o.stop(stop);
    return o;
  }

  private noiseBurst(t: number, length: number, filter: BiquadFilterType, freq: number, to: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    src.connect(f).connect(to);
    src.start(t, Math.random() * 0.5);
    src.stop(t + length);
  }

  private drum(kind: Drum, t: number, vel: number): void {
    switch (kind) {
      case 'kick': {
        const g = this.env(t, 0.55 * vel, 0.003, 0.02, 0.25);
        const o = this.osc('sine', 130, t, t + 0.3, g);
        o.frequency.setValueAtTime(130, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        break;
      }
      case 'snare': {
        this.noiseBurst(t, 0.18, 'highpass', 1400, this.env(t, 0.22 * vel, 0.002, 0.01, 0.13));
        this.osc('triangle', 185, t, t + 0.1, this.env(t, 0.12 * vel, 0.002, 0.01, 0.06));
        break;
      }
      case 'hat':
        this.noiseBurst(t, 0.06, 'highpass', 7500, this.env(t, 0.09 * vel, 0.002, 0.005, 0.035));
        break;
      case 'tom':
      case 'bongoHi':
      case 'bongoLo': {
        const [f0, len, peak] = kind === 'tom' ? [150, 0.35, 0.35] : kind === 'bongoHi' ? [420, 0.13, 0.22] : [280, 0.16, 0.24];
        const g = this.env(t, peak * vel, 0.002, 0.01, len);
        const o = this.osc('sine', f0, t, t + len + 0.05, g);
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + len);
        break;
      }
    }
  }

  private bass(t: number, midi: number, len: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 650;
    f.connect(this.env(t, 0.2, 0.01, len * 0.6, len * 0.4));
    this.osc(this.song.bassWave, midiHz(midi), t, t + len + 0.05, f);
  }

  private lead(kind: Lead, t: number, midi: number, len: number, peak: number): void {
    const hz = midiHz(midi);
    if (kind === 'marimba') {
      // Wooden bar: a sine plus a quickly-dying high partial.
      this.osc('sine', hz, t, t + 0.6, this.env(t, peak * 1.4, 0.003, 0.01, 0.5));
      this.osc('sine', hz * 4, t, t + 0.15, this.env(t, peak * 0.35, 0.002, 0.005, 0.08));
      return;
    }
    // Bugle (bright, brassy) or flute (soft, breathy), both with a little vibrato.
    const bugle = kind === 'bugle';
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = bugle ? 2600 : 1800;
    f.connect(this.env(t, bugle ? peak : peak * 1.1, bugle ? 0.025 : 0.09, Math.max(0.01, len - 0.1), bugle ? 0.08 : 0.25));
    const o = this.osc(bugle ? 'square' : 'triangle', hz, t, t + len + 0.35, f);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = bugle ? 5.5 : 4.5;
    const depth = this.ctx.createGain();
    depth.gain.value = bugle ? 8 : 14; // cents
    vib.connect(depth).connect(o.detune);
    vib.start(t);
    vib.stop(t + len + 0.35);
    if (!bugle) this.noiseBurst(t, 0.12, 'bandpass', hz * 2, this.env(t, peak * 0.12, 0.02, 0.02, 0.08)); // breath
  }

  private pad(t: number, notes: number[], len: number): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.connect(this.env(t, 0.045, 0.5, Math.max(0.1, len - 1.1), 0.6));
    for (const m of notes) {
      for (const cents of [-7, 7]) {
        const o = this.osc('sawtooth', midiHz(m), t, t + len + 0.1, f);
        o.detune.value = cents;
      }
    }
  }
}
