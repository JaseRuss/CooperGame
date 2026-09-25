/** Player options, remembered in this browser between visits. */

export type DriveStyle = 'warthog' | 'classic';
export type AimSpeed = 'slow' | 'normal' | 'fast';

export interface Settings {
  /** Warthog: stick drives toward the camera's view. Classic: the tank turns to face the stick. */
  driveStyle: DriveStyle;
  aimSpeed: AimSpeed;
  /** Floating names over the buddy tanks. */
  nameTags: boolean;
}

export const DEFAULT_SETTINGS: Settings = { driveStyle: 'warthog', aimSpeed: 'normal', nameTags: true };

export const AIM_SPEED_SCALE: Record<AimSpeed, number> = { slow: 0.65, normal: 1, fast: 1.45 };

const STORAGE_KEY = 'cooper-tank-settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
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
export interface OptionRow<K extends keyof Settings = keyof Settings> {
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
      { value: true, label: 'On', hint: 'Show Keston, Max, Innes and Jason above their tanks.' },
      { value: false, label: 'Off', hint: 'Hide the floating names.' },
    ],
  },
] as OptionRow[];
