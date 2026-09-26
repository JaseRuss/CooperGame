/** Player options, remembered in this browser between visits. */

export type DriveStyle = 'warthog' | 'classic';
export type AimSpeed = 'slow' | 'normal' | 'fast';

export interface Settings {
  /** Warthog: stick drives toward the camera's view. Classic: the tank turns to face the stick. */
  driveStyle: DriveStyle;
  aimSpeed: AimSpeed;
  /** Floating names over the buddy tanks. */
  nameTags: boolean;
  /** The four buddy tank crews, in the order they're called in. */
  buddyNames: string[];
  /** How long a jeep from a changing station lasts before it turns back into the tank. */
  jeepMinutes: JeepMinutes;
}

export type JeepMinutes = 1 | 2 | 3 | 5;
const JEEP_MINUTES: JeepMinutes[] = [1, 2, 3, 5];

export const DEFAULT_BUDDY_NAMES = ['Keston', 'Max', 'Innes', 'Jason'];
export const BUDDY_NAME_MAX = 10;

export const DEFAULT_SETTINGS: Settings = {
  driveStyle: 'warthog',
  aimSpeed: 'normal',
  nameTags: true,
  buddyNames: [...DEFAULT_BUDDY_NAMES],
  jeepMinutes: 3,
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
      const jeepMinutes = JEEP_MINUTES.includes(saved.jeepMinutes as JeepMinutes) ? (saved.jeepMinutes as JeepMinutes) : DEFAULT_SETTINGS.jeepMinutes;
      return { ...DEFAULT_SETTINGS, ...saved, buddyNames, jeepMinutes };
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
    values: JEEP_MINUTES.map((m) => ({
      value: m,
      label: `${m} min`,
      hint: `Drive through a jeep station for a fast jeep that lasts ${m} minute${m > 1 ? 's' : ''}, then turns back into your tank.`,
    })),
  },
] as OptionRow[];
