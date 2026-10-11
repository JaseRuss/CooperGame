/**
 * The siege level's progress, carried across a page reload. The tank game and the on-foot jailbreak
 * are separate pages, so going into a prison saves where things stand here and coming back loads
 * it again. It lives in sessionStorage: it only has to survive the next load in this tab.
 */

export interface SiegeSnapshot {
  /** Indices (into the enemy bases) of the castles already taken. */
  castles: number[];
  /** How many are locked up in each prison, in the order SiegeWar builds them. */
  prisons: number[];
  /** Enemy prisons whose prisoners have been freed (their wave is out). */
  freed: number[];
  player: { x: number; z: number; yaw: number; health: number };
  rocketCharge: number;
}

/** What the on-foot section is asked to do. */
export interface JailbreakRequest {
  /** Which prison (its index in SiegeWar's list). */
  prison: number;
  /** Our soldiers locked up inside. */
  held: number;
  /** The Great Castle's dungeon, dressed like Stirling Castle. */
  royal?: boolean;
}

/** How it ended: the prisoners freed (0 if the player gave up). */
export interface JailbreakResult {
  prison: number;
  freed: number;
}

const SNAPSHOT_KEY = 'cooper-siege-snapshot';
const REQUEST_KEY = 'cooper-siege-jailbreak';
const RESULT_KEY = 'cooper-siege-result';

function read<T>(key: string): T | null {
  try {
    const text = sessionStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage: the level then just starts fresh next time.
  }
}

export const loadSnapshot = (): SiegeSnapshot | null => read<SiegeSnapshot>(SNAPSHOT_KEY);
export const saveSnapshot = (s: SiegeSnapshot | null): void => write(SNAPSHOT_KEY, s);
export const loadRequest = (): JailbreakRequest | null => read<JailbreakRequest>(REQUEST_KEY);
export const saveRequest = (r: JailbreakRequest | null): void => write(REQUEST_KEY, r);
export const loadResult = (): JailbreakResult | null => read<JailbreakResult>(RESULT_KEY);
export const saveResult = (r: JailbreakResult | null): void => write(RESULT_KEY, r);

/** The page's `?resume=1`: pick up the saved siege instead of starting afresh. */
export const RESUME = new URLSearchParams(window.location.search).get('resume') === '1';
