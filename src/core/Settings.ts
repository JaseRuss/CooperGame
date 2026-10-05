/** Player options, remembered in this browser between visits. */

export type DriveStyle = 'warthog' | 'classic';
export type AimSpeed = 'slow' | 'normal' | 'fast';
export type GraphicsQuality = 'low' | 'balanced' | 'high';
export type SplitOrientation = 'vertical' | 'horizontal';

export const GRAPHICS_QUALITY: Record<GraphicsQuality, { pixelRatio: number; shadowSize: number }> = {
  low: { pixelRatio: 0.75, shadowSize: 0 },
  balanced: { pixelRatio: 1, shadowSize: 1024 },
  high: { pixelRatio: 2, shadowSize: 2048 },
};

export interface Settings {
  /** Warthog: stick drives toward the camera's view. Classic: the tank turns to face the stick. */
  driveStyle: DriveStyle;
  aimSpeed: AimSpeed;
  graphicsQuality: GraphicsQuality;
  /** Show the frame rate at the top-right of the minimap. */
  showFps: boolean;
  /** Floating names over the buddy tanks. */
  nameTags: boolean;
  /** The four buddy tank crews, in the order they're called in. */
  buddyNames: string[];
  /** How long a jeep from a changing station lasts before it turns back into the tank. */
  jeepMinutes: RideMinutes;
  /** How long a chopper from a changing station lasts before it lands and turns back into the tank. */
  chopperMinutes: RideMinutes;
  /** Off, Low, Medium or High. */
  musicVolume: Volume;
  sfxVolume: Volume;
  /** Gamepad index, -1 for keyboard and mouse, -2 for automatic assignment. */
  player1Controller: number;
  /** Gamepad index, -1 for keyboard and mouse, -2 to disable the second player. */
  player2Controller: number;
  splitOrientation: SplitOrientation;
}

export type RideMinutes = 1 | 2 | 3 | 5;
const RIDE_MINUTES: RideMinutes[] = [1, 2, 3, 5];
export type Volume = 0 | 1 | 2 | 3;
const VOLUMES: Volume[] = [0, 1, 2, 3];
const VOLUME_LABELS = ['Off', 'Low', 'Medium', 'High'];

export const DEFAULT_BUDDY_NAMES = ['Keston', 'Max', 'Innes', 'Jason'];
export const BUDDY_NAME_MAX = 10;

export const DEFAULT_SETTINGS: Settings = {
  driveStyle: 'warthog',
  aimSpeed: 'normal',
  graphicsQuality: 'high',
  showFps: false,
  nameTags: true,
  buddyNames: [...DEFAULT_BUDDY_NAMES],
  jeepMinutes: 3,
  chopperMinutes: 3,
  musicVolume: 2,
  sfxVolume: 3,
  player1Controller: -2,
  player2Controller: -2,
  splitOrientation: 'vertical',
};

/** Tidies a typed name: allowed characters only, trimmed, capped; blank falls back to `fallback`. */
export function cleanBuddyName(name: string, fallback: string): string {
  const tidy = name.replace(/[^A-Za-z0-9 '-]/g, '').replace(/\s+/g, ' ').trim().slice(0, BUDDY_NAME_MAX).trim();
  return tidy || fallback;
}

export const AIM_SPEED_SCALE: Record<AimSpeed, number> = { slow: 0.65, normal: 1, fast: 1.45 };

const STORAGE_KEY = 'cooper-tank-settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // Older saves have no names; a damaged list falls back name by name.
      const names = Array.isArray(saved.buddyNames) ? saved.buddyNames : [];
      const buddyNames = DEFAULT_BUDDY_NAMES.map((d, i) => (typeof names[i] === 'string' ? cleanBuddyName(names[i], d) : d));
      const minutes = (m: unknown, fallback: RideMinutes) => (RIDE_MINUTES.includes(m as RideMinutes) ? (m as RideMinutes) : fallback);
      const jeepMinutes = minutes(saved.jeepMinutes, DEFAULT_SETTINGS.jeepMinutes);
      const chopperMinutes = minutes(saved.chopperMinutes, DEFAULT_SETTINGS.chopperMinutes);
      const volume = (v: unknown, fallback: Volume) => (VOLUMES.includes(v as Volume) ? (v as Volume) : fallback);
      const musicVolume = volume(saved.musicVolume, DEFAULT_SETTINGS.musicVolume);
      const sfxVolume = volume(saved.sfxVolume, DEFAULT_SETTINGS.sfxVolume);
      const graphicsQuality = saved.graphicsQuality === 'low' || saved.graphicsQuality === 'balanced' || saved.graphicsQuality === 'high'
        ? saved.graphicsQuality : DEFAULT_SETTINGS.graphicsQuality;
      const showFps = typeof saved.showFps === 'boolean' ? saved.showFps : DEFAULT_SETTINGS.showFps;
      const controller = (value: unknown, fallback: number) => typeof value === 'number' && Number.isInteger(value) && value >= -2 && value <= 15 ? value : fallback;
      const player1Controller = controller(saved.player1Controller, DEFAULT_SETTINGS.player1Controller);
      const player2Controller = controller(saved.player2Controller, DEFAULT_SETTINGS.player2Controller);
      const splitOrientation = saved.splitOrientation === 'vertical' || saved.splitOrientation === 'horizontal' ? saved.splitOrientation : DEFAULT_SETTINGS.splitOrientation;
      const duplicateInput = player2Controller === player1Controller && (player2Controller === -1 || player2Controller >= 0);
      return { ...DEFAULT_SETTINGS, ...saved, buddyNames, jeepMinutes, chopperMinutes, musicVolume, sfxVolume, graphicsQuality, showFps, player1Controller, player2Controller: duplicateInput ? DEFAULT_SETTINGS.player2Controller : player2Controller, splitOrientation };
    }
  } catch {
    // Storage can be blocked (private windows, embedded previews); defaults are fine.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not remembered this time; the game still uses the new values.
  }
}

/** One row on the options screen: its label and the values it cycles through. */
export interface OptionRow<K extends Exclude<keyof Settings, 'buddyNames'> = Exclude<keyof Settings, 'buddyNames'>> {
  key: K;
  label: string;
  values: { value: Settings[K]; label: string; hint: string }[];
}

export const OPTION_ROWS: OptionRow[] = [
  {
    key: 'player1Controller',
    label: 'Player 1 controls',
    values: [
      { value: -2, label: 'Automatic', hint: 'Use the keyboard and mouse, or the first controller that is connected.' },
      { value: -1, label: 'Keyboard / mouse', hint: 'Assign keyboard and mouse to Player 1.' },
      ...Array.from({ length: 8 }, (_, i) => ({ value: i, label: `Controller ${i + 1}`, hint: `Assign Controller ${i + 1} to Player 1.` })),
    ],
  },
  {
    key: 'player2Controller',
    label: 'Player 2 controls',
    values: [
      { value: -2, label: 'Disabled', hint: 'Play solo. Choose a controller or keyboard and mouse to join.' },
      { value: -1, label: 'Keyboard / mouse', hint: 'Assign keyboard and mouse to Player 2. Use arrow keys to move, mouse to aim, and number pad keys to fire and use controls.' },
      ...Array.from({ length: 8 }, (_, i) => ({ value: i, label: `Controller ${i + 1}`, hint: `Assign Controller ${i + 1} to Player 2.` })),
    ],
  },
  {
    key: 'splitOrientation',
    label: 'Split screen',
    values: [
      { value: 'vertical', label: 'Vertical', hint: 'Players appear side by side.' },
      { value: 'horizontal', label: 'Horizontal', hint: 'Player 1 appears above Player 2.' },
    ],
  },
  {
    key: 'graphicsQuality',
    label: 'Graphics',
    values: [
      { value: 'low', label: 'Low', hint: 'For older computers: a softer picture and no shadows.' },
      { value: 'balanced', label: 'Balanced', hint: 'A clear picture with lighter shadows. A good starting point for most computers.' },
      { value: 'high', label: 'High', hint: 'Sharper shadows and extra detail on high resolution screens. Needs a faster computer.' },
    ],
  },
  {
    key: 'showFps',
    label: 'Show FPS',
    values: [
      { value: false, label: 'Off', hint: 'Hide the frame rate display.' },
      { value: true, label: 'On', hint: 'Show frames per second at the top-right of the minimap.' },
    ],
  },
  {
    key: 'driveStyle',
    label: 'Tank controls',
    values: [
      { value: 'warthog', label: 'Warthog', hint: 'Push the stick where you want to go on screen. Pull back to reverse. The tank turns to face where you aim.' },
      { value: 'classic', label: 'Classic', hint: 'The tank turns to face the stick and drives that way; it reverses if you point it behind. WASD steers like a real tank.' },
    ],
  },
  {
    key: 'aimSpeed',
    label: 'Aim speed',
    values: [
      { value: 'slow', label: 'Slow', hint: 'Gentle turret turning for careful aiming.' },
      { value: 'normal', label: 'Normal', hint: 'The standard turret speed.' },
      { value: 'fast', label: 'Fast', hint: 'Whip the turret round quickly.' },
    ],
  },
  {
    key: 'nameTags',
    label: 'Buddy name tags',
    values: [
      { value: true, label: 'On', hint: "Show each buddy's name above their tank." },
      { value: false, label: 'Off', hint: 'Hide the floating names.' },
    ],
  },
  {
    key: 'jeepMinutes',
    label: 'Jeep time',
    values: RIDE_MINUTES.map((m) => ({
      value: m,
      label: `${m} min`,
      hint: `Drive through a jeep station for a fast jeep that lasts ${m} minute${m > 1 ? 's' : ''}, then turns back into your tank.`,
    })),
  },
  {
    key: 'chopperMinutes',
    label: 'Chopper time',
    values: RIDE_MINUTES.map((m) => ({
      value: m,
      label: `${m} min`,
      hint: `Drive onto a chopper station's pad for a chopper that flies for ${m} minute${m > 1 ? 's' : ''}, then lands and turns back into your tank.`,
    })),
  },
  {
    key: 'musicVolume',
    label: 'Music',
    values: VOLUMES.map((v) => ({
      value: v,
      label: VOLUME_LABELS[v],
      hint: v === 0 ? 'No music.' : 'Each level has its own tune: a march by day, a sneaky tune at night, bongos in the jungle, a jig for the castles and a spooky one for the zombies.',
    })),
  },
  {
    key: 'sfxVolume',
    label: 'Sound effects',
    values: VOLUMES.map((v) => ({
      value: v,
      label: VOLUME_LABELS[v],
      hint: v === 0 ? 'No sound effects.' : 'Bangs, booms, jam splats and engine noise.',
    })),
  },
] as OptionRow[];
