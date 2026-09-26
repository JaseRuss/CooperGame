import type { WorldMap, MapView } from './WorldMap';
import type { AimTarget } from './AimGuide';
import type { ArmorZone } from '../entities/Tank';
import type { MenuInput } from '../input/InputManager';
import { OPTION_ROWS, DEFAULT_BUDDY_NAMES, BUDDY_NAME_MAX, cleanBuddyName, type Settings } from '../core/Settings';
import { WORLD_SIZE, MISSION, MISSIONS, type Mission } from '../core/config';

/** Where the ready-made models and the font came from, grouped by site, for the pause screen. */
const CREDITS: { site: string; url: string; items: string }[] = [
  {
    site: 'kenney.nl',
    url: 'https://kenney.nl',
    items: 'City Kit Suburban, Commercial, Industrial and Roads, Car Kit, Nature Kit (jungle trees and plants) · CC0',
  },
  { site: 'poly.pizza', url: 'https://poly.pizza', items: 'Wooden huts and shacks by Quaternius · CC0' },
  { site: 'fonts.google.com', url: 'https://fonts.google.com/specimen/Black+Ops+One', items: 'Black Ops One font by James Grieshaber and Eben Sorkin · SIL Open Font License' },
];

export interface ObjectiveLine {
  label: string;
  done: boolean;
}

export interface HUDState {
  health: number;
  maxHealth: number;
  reloadFraction: number; // 0 = ready to fire, 1 = just fired
  cameraMode: 'first' | 'third';
  usingGamepad: boolean;
  /** Name of the family base the player is parked in, or null. */
  insideBase: string | null;
  map: MapView;
  /** Where the shell will land, in screen pixels, or null if off-screen. */
  aimScreen: { x: number; y: number } | null;
  /** Ground distance to the predicted impact, or null if it lands out of range. */
  aimRange: number | null;
  aimTarget: AimTarget;
  /** 0..1; the rocket can launch at 1. */
  rocketCharge: number;
  /** Screen position of the enemy the rocket would lock onto, when ready. */
  rocketLockScreen: { x: number; y: number } | null;
  /** AA darts left, out of `aaMax`; they're only restocked at a home base. */
  aaLoaded: number;
  aaMax: number;
  aaFiring: boolean;
  aaRearming: boolean;
  /** Screen position of the helicopter the AA salvo would chase, when loaded. */
  aaLockScreen: { x: number; y: number } | null;
  /** 0..1; a buddy tank rolls in by itself at 1. */
  buddyCharge: number;
  /** 0..1; the mega jam (X) is ready at 1. */
  megaJamCharge: number;
  /** Every buddy's name, and which of them are out right now. */
  buddyRoster: string[];
  buddyOut: boolean[];
  buddyMax: number;
  /** True while the rocket cam / explosion replay is playing. */
  cinematic: boolean;
  enemyBasesLeft: number;
  enemyBasesTotal: number;
  /** When close to an enemy base: what still needs destroying there. */
  nearbyBase: { name: string; distance: number; objectives: ObjectiveLine[] } | null;
  driveStyle: Settings['driveStyle'];
  /** Remind the player to click so the browser hands over the mouse for aiming. */
  mouseCaptureHint: boolean;
}

const HIT_MARKER_TEXT: Record<ArmorZone, { text: string; color: string }> = {
  front: { text: 'FRONT ARMOUR ×0.5', color: '#c9d3dc' },
  side: { text: 'SIDE HIT ×1', color: '#ffd27a' },
  rear: { text: 'REAR HIT ×2!', color: '#ff6a5a' },
};
const HIT_MARKER_TIME = 1.1;
const BANNER_TIME = 4;
const HULL_SEGMENTS = 20;

const RETICLE_COLORS: Record<AimTarget, string> = {
  enemy: '#ff6a5a',
  building: '#ffb050',
  ground: 'rgba(255,255,255,0.9)',
  none: 'rgba(255,255,255,0.6)',
  critical: '#ffd24a',
};

/** Letters a controller cycles through when editing a buddy's name. */
const NAME_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ' ', '-'];

const MINIMAP_SIZE = 200;
const MINIMAP_METERS = 700; // meters shown across the minimap

// ---------- look ----------

const STYLE = `
.hud { position:absolute; inset:0; pointer-events:none; font-family:"Segoe UI",system-ui,sans-serif; color:#eef3f8; user-select:none; }
.hud * { box-sizing:border-box; }
.hud .stencil { font-family:"Black Ops One", Impact, "Arial Black", sans-serif; font-weight:400; letter-spacing:1.5px; }
.hud .panel { background:linear-gradient(180deg, rgba(34,44,26,0.86), rgba(20,27,16,0.86)); border:1px solid rgba(214,196,138,0.45);
  border-radius:8px; box-shadow:0 3px 12px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08); }
.hud .shadow { text-shadow:0 1px 3px #000; }

.hud .card { position:absolute; left:18px; bottom:18px; width:300px; padding:12px 14px 12px; }
.hud .card-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; }
.hud .callsign { font-size:18px; color:#e8d9a4; }
.hud .subtle { font-size:11px; opacity:0.7; letter-spacing:0.5px; }
.hud .row-label { display:flex; justify-content:space-between; font-size:11px; font-weight:700; letter-spacing:1px; margin:8px 0 3px; opacity:0.92; }
.hud .segs { display:flex; gap:2px; height:14px; }
.hud .seg { flex:1; border-radius:2px; background:rgba(0,0,0,0.45); }
.hud .bar { height:8px; border-radius:4px; background:rgba(0,0,0,0.5); overflow:hidden; border:1px solid rgba(255,255,255,0.12); }
.hud .fill { height:100%; width:0%; border-radius:4px; transition:width 0.12s linear; }
.hud .slot { display:flex; align-items:center; gap:10px; margin-top:9px; }
.hud .slot .icon { width:30px; height:30px; flex:none; display:flex; align-items:center; justify-content:center; border-radius:6px;
  background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.14); }
.hud .slot .body { flex:1; min-width:0; }
.hud .ready { animation:hudPulse 0.8s ease-in-out infinite alternate; }
@keyframes hudPulse { from { filter:brightness(1); } to { filter:brightness(1.6); } }
.hud .chips { display:flex; gap:4px; margin-top:5px; }
.hud .chip { flex:1; text-align:center; font-size:10.5px; font-weight:800; letter-spacing:0.5px; padding:3px 0; border-radius:4px;
  background:rgba(0,0,0,0.4); color:rgba(238,243,248,0.45); border:1px solid rgba(255,255,255,0.1); }
.hud .chip.on { background:rgba(120,190,80,0.3); color:#d6f7c0; border-color:rgba(155,226,122,0.7); }

.hud .keys { position:absolute; left:18px; top:16px; font-size:11.5px; line-height:1.9; opacity:0.85; }
.hud .key { display:inline-block; min-width:20px; padding:0 5px; margin:0 3px 0 8px; border-radius:4px; text-align:center; font-weight:800; font-size:10.5px;
  background:rgba(232,217,164,0.9); color:#1c2414; box-shadow:0 1px 0 #6f6446; }
.hud .key:first-child { margin-left:0; }

.hud .bases { position:absolute; left:50%; top:12px; transform:translateX(-50%); padding:7px 16px 8px; text-align:center; }
.hud .bases .title { font-size:13px; color:#e8d9a4; }
.hud .flags { display:flex; gap:8px; justify-content:center; margin-top:4px; }
.hud .sides { margin-top:5px; padding-top:4px; border-top:1px solid rgba(214,196,138,0.25); font-size:10.5px; font-weight:700; letter-spacing:0.5px; white-space:nowrap; }
.hud .sides i { display:inline-block; width:9px; height:9px; border-radius:50%; margin:0 3px 0 6px; vertical-align:-1px; border:1px solid rgba(0,0,0,0.5); }
.hud .flag { display:flex; flex-direction:column; align-items:center; font-size:9.5px; font-weight:800; letter-spacing:0.5px; }

.hud .minimap { position:absolute; right:18px; top:16px; width:${MINIMAP_SIZE + 12}px; height:${MINIMAP_SIZE + 12}px; border-radius:50%; padding:6px;
  background:conic-gradient(from 0deg, #8f845d, #c9b983, #8f845d, #c9b983, #8f845d); box-shadow:0 3px 12px rgba(0,0,0,0.5); }
.hud .minimap canvas { display:block; border-radius:50%; }
.hud .north { position:absolute; left:50%; top:-3px; transform:translateX(-50%); font-size:12px; color:#1c2414; background:#e8d9a4;
  border-radius:8px; padding:0 6px; line-height:16px; }

.hud .checklist { position:absolute; right:18px; top:${MINIMAP_SIZE + 42}px; width:${MINIMAP_SIZE + 12}px; padding:0 0 8px; overflow:hidden; font-size:12.5px; line-height:1.6; }
.hud .checklist .head { padding:6px 12px; background:repeating-linear-gradient(135deg, rgba(200,60,40,0.85) 0 10px, rgba(160,40,30,0.85) 10px 20px); }
.hud .checklist .line { padding:0 12px; }
.hud .checklist .done { color:#9be27a; text-decoration:line-through; opacity:0.75; }

.hud .banner { position:absolute; left:50%; top:17%; transform:translateX(-50%); text-align:center; opacity:0; white-space:nowrap; padding:10px 34px 12px;
  background:linear-gradient(90deg, transparent, rgba(20,26,14,0.85) 12%, rgba(20,26,14,0.85) 88%, transparent); }
.hud .banner .big { font-size:32px; color:#ffd24a; text-shadow:0 3px 8px #000, 0 0 18px rgba(255,160,40,0.45); }
.hud .banner .small { font-size:15px; font-weight:700; margin-top:4px; }

.hud .prompt { position:absolute; left:50%; top:73%; transform:translateX(-50%); padding:7px 18px; border-radius:20px; font-size:15px; font-weight:700; display:none;
  background:rgba(15,20,12,0.7); border:1px solid rgba(255,255,255,0.2); }

.hud .crosshair { position:absolute; left:0; top:0; width:24px; height:24px; margin:-12px 0 0 -12px; border:2px solid; border-radius:50%;
  box-shadow:0 0 4px rgba(0,0,0,0.7); display:none; }
.hud .crosshair::before, .hud .crosshair::after { content:""; position:absolute; background:currentColor; }
.hud .crosshair::before { left:50%; top:-8px; width:2px; height:6px; margin-left:-1px; box-shadow:0 30px 0 currentColor; }
.hud .crosshair::after { top:50%; left:-8px; height:2px; width:6px; margin-top:-1px; box-shadow:30px 0 0 currentColor; }
.hud .crosshair .dot { position:absolute; left:50%; top:50%; width:4px; height:4px; margin:-2px 0 0 -2px; background:currentColor; border-radius:50%; }
.hud .helitag { position:absolute; left:0; top:0; display:none; align-items:center; gap:5px; margin:-11px 0 0 26px; padding:2px 7px 2px 4px;
  border-radius:5px; background:rgba(10,30,50,0.55); border:1px solid #8fd3ff; color:#8fd3ff; font-size:12px; font-weight:800; white-space:nowrap;
  text-shadow:0 1px 3px #000; box-shadow:0 0 8px rgba(143,211,255,0.5); animation:hudPulse 0.8s ease-in-out infinite alternate; }
.hud .crosshair .range { position:absolute; left:50%; top:30px; transform:translateX(-50%); font-size:12px; font-weight:800; white-space:nowrap; text-shadow:0 1px 3px #000; }

.hud .lock { position:absolute; left:0; top:0; width:36px; height:36px; margin:-18px 0 0 -18px; border:2px solid #ff5a4a; display:none;
  box-shadow:0 0 8px rgba(255,90,74,0.8); }
.hud .lock span { position:absolute; left:50%; top:-22px; transform:translateX(-50%) rotate(-45deg); font-size:11px; font-weight:800; color:#ff6a5a; }
.hud .lock.aa { border-color:#8fd3ff; box-shadow:0 0 8px rgba(143,211,255,0.8); border-radius:50%; }
.hud .lock.aa span { color:#8fd3ff; transform:translateX(-50%); }
.hud .pips { display:flex; gap:2px; }
.hud .pip { flex:1; height:8px; border-radius:2px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.12); }
.hud .pip.on { background:linear-gradient(180deg,#f0ece0,#d0463a); }

.hud .overlay { position:absolute; inset:0; display:none; align-items:center; justify-content:center; flex-direction:column; gap:10px; pointer-events:auto;
  background:radial-gradient(ellipse at center, rgba(20,30,14,0.72), rgba(0,0,0,0.82)); backdrop-filter:blur(3px); }
.hud .overlay h1 { margin:0; font-size:34px; letter-spacing:8px; color:#e8d9a4; text-shadow:0 3px 10px #000; font-weight:400; }
.hud .tabs { display:flex; gap:6px; }
.hud .tab { padding:6px 22px; border-radius:6px 6px 0 0; font-size:15px; cursor:pointer; background:rgba(0,0,0,0.35); color:rgba(238,243,248,0.6);
  border:1px solid rgba(214,196,138,0.3); border-bottom:none; }
.hud .tab.on { background:rgba(214,196,138,0.9); color:#1c2414; }
.hud .page { display:none; }
.hud .page.on { display:flex; flex-direction:column; align-items:center; gap:8px; }
.hud .legend { font-size:12.5px; opacity:0.9; display:flex; gap:14px; flex-wrap:wrap; justify-content:center; max-width:760px; }
.hud .legend i { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:-1px; }
.hud .options { width:min(560px, 92vw); padding:10px; max-height:calc(100vh - 340px); overflow-y:auto; }
.hud .opt { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-radius:6px; cursor:pointer; border:1px solid transparent; }
.hud .opt.sel { background:rgba(214,196,138,0.16); border-color:rgba(214,196,138,0.6); }
.hud .opt .name { font-size:16px; font-weight:700; }
.hud .opt .val { display:flex; align-items:center; gap:10px; font-size:16px; }
.hud .opt .val b { font-family:"Black Ops One", Impact, sans-serif; font-weight:400; letter-spacing:1px; color:#ffd24a; min-width:92px; text-align:center; }
.hud .opt .arrow { opacity:0.5; font-size:13px; }
.hud .opt.sel .arrow { opacity:1; }
.hud .opt.first-name { margin-top:8px; border-top-color:rgba(214,196,138,0.25); }
.hud .options .section { margin:12px 14px 2px; padding-top:8px; border-top:1px solid rgba(214,196,138,0.25); font-size:13px; color:#e8d9a4; }
.hud .opt.level { padding:8px 14px; }
.hud .credits { max-width:min(780px, 94vw); padding:5px 14px 6px; font-size:11px; line-height:1.5; text-align:center; opacity:0.85; }
.hud .credits .head { font-size:11.5px; color:#e8d9a4; }
.hud .credits a { color:#ffd24a; font-weight:700; text-decoration:none; }
.hud .opt .val b.pen { color:#9be27a; }
.hud .letters { display:flex; gap:3px; }
.hud .letters span { width:17px; height:26px; display:flex; align-items:center; justify-content:center; font-family:"Black Ops One", Impact, sans-serif;
  font-size:17px; color:#ffd24a; border-bottom:2px solid rgba(255,210,74,0.35); }
.hud .letters span.cur { background:rgba(255,210,74,0.22); border-bottom-color:#ffd24a; animation:hudPulse 0.5s ease-in-out infinite alternate; }
.hud .hint { min-height:42px; max-width:520px; text-align:center; font-size:13px; line-height:1.5; opacity:0.85; margin-top:4px; }
.hud .footer { font-size:12px; opacity:0.75; margin-top:4px; }

.hud .letterbox { position:absolute; left:0; right:0; height:0; background:#000; transition:height 0.35s; }
.hud .cine { position:absolute; left:24px; top:10.5vh; font-size:15px; letter-spacing:3px; color:#ff8a3d; display:none; }
.hud .hitmark { position:absolute; left:50%; top:40%; transform:translateX(-50%); font-size:18px; font-weight:800; letter-spacing:1px; text-shadow:0 2px 4px #000; opacity:0; }

.hud .victory { position:absolute; inset:0; display:none; flex-direction:column; align-items:center; justify-content:center; gap:14px; text-align:center;
  background:radial-gradient(ellipse at center, rgba(40,80,30,0.6), rgba(0,0,0,0.3)); }
.hud .victory .big { font-size:72px; color:#ffd24a; text-shadow:0 4px 14px #000, 0 0 30px rgba(255,200,60,0.7); }
`;

/** Who's who, always shown under the enemy-bases counter. */
const ARMY_KEY =
  '<div class="sides"><span style="color:#9be27a">FRIENDS</span><i style="background:#4b7a2e"></i>Green<i style="background:#b8392e"></i>Red' +
  '<span style="color:#ff8a7a; margin-left:12px">ENEMIES</span><i style="background:#c4a468"></i>Tan<i style="background:#3d6fc4"></i>Blue</div>';

/** Side view of a helicopter, for the AA lock tag. */
const HELI_ICON = `<svg width="20" height="14" viewBox="0 0 20 14" fill="#8fd3ff"><rect x="1" y="1" width="16" height="1.4" rx=".7"/>
<rect x="8.3" y="2" width="1.4" height="2.5"/><path d="M4 5.5h7.5c2 0 3.5 1.5 3.5 3.3S13.5 12 11.5 12H6.5C5 12 4 10.8 4 9.3z"/>
<path d="M11 7h-3v2.5h4z" fill="#0a1e32"/><rect x="0" y="7.3" width="5" height="1.4"/><rect x="0" y="5.5" width="1.3" height="3.2"/>
<rect x="6" y="12.6" width="8" height="1.2" rx=".6"/></svg>`;

/** Three little darts climbing on wobbly smoke trails. */
const AA_ICON = `<svg width="22" height="22" viewBox="0 0 24 24"><g fill="none" stroke="#cfd6dc" stroke-width="1.3" opacity=".7">
<path d="M5 22c-1-3 2-4 1-7"/><path d="M12 22c1-3-2-5 0-8"/><path d="M19 22c-1-2 2-4 0-7"/></g>
<g fill="#f0ece0"><rect x="5" y="7" width="2.2" height="7" rx="1"/><rect x="10.9" y="5" width="2.2" height="7" rx="1"/><rect x="17" y="8" width="2.2" height="7" rx="1"/></g>
<g fill="#d0463a"><path d="M5 7l1.1-2.5L7.2 7z"/><path d="M10.9 5L12 2.5 13.1 5z"/><path d="M17 8l1.1-2.5L19.2 8z"/></g></svg>`;

const JAM_ICON = `<svg width="22" height="22" viewBox="0 0 24 24"><rect x="6" y="7" width="12" height="14" rx="2.5" fill="#dff4ff" opacity=".5"/>
<rect x="7" y="10" width="10" height="10" rx="2" fill="#b3142e"/><path d="M4.5 7.5 L12 3 L19.5 7.5 L18 8.5 H6z" fill="#fff"/>
<path d="M6 5.6h3v2.4H6zM12 4h3v3h-3zM9 3.9h3v2.2H9z" fill="#d33" opacity=".7"/><circle cx="10" cy="13" r="1.2" fill="#ff8aa0"/></svg>`;
const ROCKET_ICON = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 2c3 2 4.5 5.5 4.5 9.5v5h-9v-5C7.5 7.5 9 4 12 2z" fill="#e8e4d8"/>
<path d="M12 2c1.6 1 2.8 2.6 3.5 4.5h-7C9.2 4.6 10.4 3 12 2z" fill="#d0463a"/><path d="M7.5 13l-3 4v2l3-1.5zM16.5 13l3 4v2l-3-1.5z" fill="#6fae4a"/>
<path d="M10 17h4l-.5 2.5h-3z" fill="#555"/><path d="M10.5 20h3l-1.5 3z" fill="#ffb040"/></svg>`;
const TANK_ICON = `<svg width="24" height="20" viewBox="0 0 26 20"><rect x="2" y="11" width="22" height="6" rx="3" fill="#6fae4a"/>
<rect x="6" y="6" width="11" height="6" rx="2" fill="#8cc865"/><rect x="16" y="7.5" width="9" height="2" fill="#8cc865"/>
<circle cx="6" cy="14" r="1.6" fill="#2c4a1c"/><circle cx="11" cy="14" r="1.6" fill="#2c4a1c"/><circle cx="16" cy="14" r="1.6" fill="#2c4a1c"/><circle cx="21" cy="14" r="1.6" fill="#2c4a1c"/></svg>`;
const flagIcon = (color: string, done: boolean) =>
  `<svg width="22" height="22" viewBox="0 0 22 22"><rect x="4" y="2" width="2" height="19" fill="#d8d2bd"/><path d="M6 3h12l-3 4 3 4H6z" fill="${color}"/>${
    done ? '<path d="M8.5 7l2 2 4-4" stroke="#fff" stroke-width="1.8" fill="none"/>' : ''
  }</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Plain-DOM + canvas HUD overlay, including the pause screen (map and options). */
export class HUD {
  private readonly segs: HTMLDivElement[] = [];
  private readonly healthText: HTMLSpanElement;
  private readonly reloadFill: HTMLDivElement;
  private readonly reloadText: HTMLSpanElement;
  private readonly rocketSlot: HTMLDivElement;
  private readonly rocketFill: HTMLDivElement;
  private readonly rocketText: HTMLSpanElement;
  private readonly buddyFill: HTMLDivElement;
  private readonly jamText: HTMLSpanElement;
  private readonly aaSlot: HTMLDivElement;
  private readonly aaText: HTMLSpanElement;
  private readonly aaPips: HTMLDivElement;
  private readonly aaLockMarker: HTMLDivElement;
  private readonly buddyText: HTMLSpanElement;
  private readonly buddyChips: HTMLDivElement;
  private readonly modeText: HTMLSpanElement;
  private readonly keys: HTMLDivElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly overlay: HTMLDivElement;
  private readonly tabs: Record<'map' | 'options', HTMLDivElement>;
  private readonly pages: Record<'map' | 'options', HTMLDivElement>;
  private readonly bigMapCanvas: HTMLCanvasElement;
  private readonly bigMapCtx: CanvasRenderingContext2D;
  private readonly optionList: HTMLDivElement;
  private readonly optionHint: HTMLDivElement;
  private readonly footer: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly rangeLabel: HTMLDivElement;
  private readonly heliTag: HTMLDivElement;
  private readonly heliTagText: HTMLSpanElement;
  private readonly promptLabel: HTMLDivElement;
  private readonly lockMarker: HTMLDivElement;
  private readonly hitMarker: HTMLDivElement;
  private readonly letterbox: HTMLDivElement[];
  private readonly cinematicLabel: HTMLDivElement;
  private readonly baseCounter: HTMLDivElement;
  private readonly checklist: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly victory: HTMLDivElement;
  private readonly victoryText: HTMLDivElement;
  private readonly victoryFooter: HTMLDivElement;
  private onMissionStart: ((m: Mission) => void) | null = null;
  private readonly hudBits: HTMLElement[];
  private readonly html = new Map<HTMLElement, string>();
  private worldMap: WorldMap | null = null;
  private pausedOpen = false;
  private page: 'map' | 'options' = 'map';
  private optionIndex = 0;
  /** The buddy name being edited on the options screen, if any. */
  private nameEdit: { crew: number; chars: string[]; cursor: number } | null = null;
  private settings: Settings | null = null;
  private onSettingsChange: ((s: Settings) => void) | null = null;
  private hitMarkerAge = HIT_MARKER_TIME;
  private bannerAge = BANNER_TIME;
  private lastUpdate = performance.now();

  constructor(container: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    const root = el('div', 'hud', container);

    // --- tank status card (bottom-left) ---
    const card = el('div', 'panel card', root);
    const head = el('div', 'card-head', card);
    el('div', 'stencil callsign', head, 'COOPER');
    this.modeText = el('span', 'subtle', head);

    const hullLabel = el('div', 'row-label', card);
    el('span', '', hullLabel, 'HULL');
    this.healthText = el('span', '', hullLabel);
    const segs = el('div', 'segs', card);
    for (let i = 0; i < HULL_SEGMENTS; i++) this.segs.push(el('div', 'seg', segs));

    const gunLabel = el('div', 'row-label', card);
    el('span', '', gunLabel, 'MAIN GUN');
    this.reloadText = el('span', '', gunLabel);
    this.reloadFill = el('div', 'fill', el('div', 'bar', card));
    this.reloadFill.style.background = 'linear-gradient(90deg,#b9982f,#ffd24a)';

    this.rocketSlot = el('div', 'slot', card);
    el('div', 'icon', this.rocketSlot).innerHTML = ROCKET_ICON;
    const rocketBody = el('div', 'body', this.rocketSlot);
    const rocketLabel = el('div', 'row-label', rocketBody);
    rocketLabel.style.marginTop = '0';
    el('span', '', rocketLabel, 'HOMING ROCKET');
    this.rocketText = el('span', '', rocketLabel);
    this.rocketFill = el('div', 'fill', el('div', 'bar', rocketBody));
    this.rocketFill.style.background = 'linear-gradient(90deg,#c0392b,#ff8a3d)';

    this.aaSlot = el('div', 'slot', card);
    el('div', 'icon', this.aaSlot).innerHTML = AA_ICON;
    const aaBody = el('div', 'body', this.aaSlot);
    const aaLabel = el('div', 'row-label', aaBody);
    aaLabel.style.marginTop = '0';
    el('span', '', aaLabel, 'AA MISSILES');
    this.aaText = el('span', '', aaLabel);
    this.aaPips = el('div', 'pips', aaBody);

    const jamSlot = el('div', 'slot', card);
    el('div', 'icon', jamSlot).innerHTML = JAM_ICON;
    const jamBody = el('div', 'body', jamSlot);
    const jamLabel = el('div', 'row-label', jamBody);
    jamLabel.style.margin = '0';
    el('span', '', jamLabel, 'JAM CANNON');
    this.jamText = el('span', '', jamLabel);
    this.jamText.style.color = '#ff8aa0';
    el('div', 'subtle', jamBody, 'Sticks soldiers and tanks · X: jam all round');

    const buddySlot = el('div', 'slot', card);
    el('div', 'icon', buddySlot).innerHTML = TANK_ICON;
    const buddyBody = el('div', 'body', buddySlot);
    const buddyLabel = el('div', 'row-label', buddyBody);
    buddyLabel.style.marginTop = '0';
    el('span', '', buddyLabel, 'BUDDY TANKS');
    this.buddyText = el('span', '', buddyLabel);
    this.buddyFill = el('div', 'fill', el('div', 'bar', buddyBody));
    this.buddyFill.style.background = 'linear-gradient(90deg,#3f7a2a,#9be27a)';
    this.buddyChips = el('div', 'chips', buddyBody);

    // --- lock-on diamond over the rocket's target ---
    this.lockMarker = el('div', 'lock', root);
    this.lockMarker.innerHTML = '<span>LOCK</span>';
    this.aaLockMarker = el('div', 'lock aa', root);
    this.aaLockMarker.innerHTML = '<span>AA</span>';

    this.hitMarker = el('div', 'hitmark', root);

    // --- rocket cam letterbox ---
    this.letterbox = ['top', 'bottom'].map((side) => {
      const bar = el('div', 'letterbox', root);
      bar.style[side as 'top' | 'bottom'] = '0';
      return bar;
    });
    this.cinematicLabel = el('div', 'stencil cine shadow', root, '● ROCKET CAM');

    // --- control hints (top-left) ---
    this.keys = el('div', 'keys shadow', root);

    // --- enemy base counter (top-centre) ---
    this.baseCounter = el('div', 'panel bases', root);

    // --- minimap (top-right) ---
    const minimapWrap = el('div', 'minimap', root);
    const minimapCanvas = el('canvas', '', minimapWrap);
    minimapCanvas.width = MINIMAP_SIZE;
    minimapCanvas.height = MINIMAP_SIZE;
    this.minimapCtx = minimapCanvas.getContext('2d') as CanvasRenderingContext2D;
    el('div', 'stencil north', minimapWrap, 'N');

    // --- target checklist when near an enemy base (under the minimap) ---
    this.checklist = el('div', 'panel checklist', root);
    this.checklist.style.display = 'none';

    // --- event banner (base destroyed etc.) ---
    this.banner = el('div', 'banner', root);

    // --- pause screen: map and options tabs ---
    this.overlay = el('div', 'overlay', root);
    el('h1', 'stencil', this.overlay, 'PAUSED');
    const tabRow = el('div', 'tabs', this.overlay);
    this.tabs = { map: el('div', 'stencil tab', tabRow, 'MAP'), options: el('div', 'stencil tab', tabRow, 'OPTIONS') };
    this.tabs.map.addEventListener('click', () => this.showPage('map'));
    this.tabs.options.addEventListener('click', () => this.showPage('options'));

    this.pages = { map: el('div', 'page', this.overlay), options: el('div', 'page', this.overlay) };
    this.bigMapCanvas = el('canvas', '', this.pages.map);
    this.bigMapCanvas.style.cssText = 'border:3px solid rgba(214,196,138,0.7); border-radius:8px; box-shadow:0 4px 18px rgba(0,0,0,0.6);';
    this.bigMapCtx = this.bigMapCanvas.getContext('2d') as CanvasRenderingContext2D;
    el('div', 'legend shadow', this.pages.map).innerHTML =
      '<span><i style="background:#4b7a2e"></i>Green army: you</span><span><i style="background:#b8392e"></i>Red army: friendly</span>' +
      '<span><i style="background:#c4a468"></i>Tan army: enemy</span><span><i style="background:#3d6fc4"></i>Blue army: enemy</span>';
    el('div', 'legend shadow', this.pages.map).innerHTML =
      '<span><i style="background:#5fe05f"></i>You</span><span><i style="background:#9be27a"></i>Buddies &amp; friendly troops</span>' +
      '<span><i style="background:#ffcc33"></i>Family bases</span><span><i style="background:#d23c32"></i>Enemy bases</span>' +
      '<span><i style="background:linear-gradient(90deg,#ffd44a,#dc2a1a)"></i>Enemies gathered</span>' +
      '<span><i style="background:#ff75d8"></i>Enemy helicopter</span>';

    this.optionList = el('div', 'panel options', this.pages.options);
    this.optionHint = el('div', 'hint shadow', this.pages.options);
    window.addEventListener('keydown', (e) => this.onNameKey(e));
    this.footer = el('div', 'footer shadow', this.overlay);

    // Where the ready-made models and the font came from, grouped by site.
    const credits = el('div', 'panel credits shadow', this.overlay);
    el('div', 'stencil head', credits, 'MODELS & FONT FROM');
    for (const c of CREDITS) {
      const line = el('div', '', credits);
      const link = el('a', '', line, c.site);
      link.href = c.url;
      link.target = '_blank';
      link.rel = 'noopener';
      line.append(`: ${c.items}`);
    }
    el('div', 'subtle', credits, 'Tanks, soldiers, bases and everything else are made in code.');

    // --- crosshair: where the shell will land ---
    this.crosshair = el('div', 'crosshair', root);
    el('div', 'dot', this.crosshair);
    this.rangeLabel = el('div', 'range', this.crosshair);
    // "HELI LOCKED" tag beside the reticle while the AA missiles have a target.
    this.heliTag = el('div', 'helitag', root);
    this.heliTag.innerHTML = `${HELI_ICON}<span></span>`;
    this.heliTagText = this.heliTag.querySelector('span') as HTMLSpanElement;

    this.promptLabel = el('div', 'prompt shadow', root);

    // --- victory screen ---
    this.victory = el('div', 'victory', root);
    el('div', 'stencil big', this.victory, 'WELL DONE COOPER!');
    this.victoryText = el('div', 'shadow', this.victory);
    this.victoryText.style.cssText = 'font-size:22px; font-weight:700;';
    this.victoryFooter = el('div', 'shadow', this.victory);
    this.victoryFooter.style.cssText = 'font-size:14px; opacity:0.85;';

    this.hudBits = [card, this.keys, minimapWrap, this.promptLabel, this.baseCounter, this.checklist];
    this.showPage('map');
  }

  setWorldMap(map: WorldMap): void {
    this.worldMap = map;
  }

  /** The options screen edits these; `onChange` fires with the new values after every change. */
  setSettings(settings: Settings, onChange: (s: Settings) => void): void {
    this.settings = settings;
    this.onSettingsChange = onChange;
    this.renderOptions();
  }

  /** Called when a different mission is picked and confirmed on the options screen. */
  setMissionStart(onStart: (m: Mission) => void): void {
    this.onMissionStart = onStart;
  }

  get paused(): boolean {
    return this.pausedOpen;
  }

  /** True while a buddy's name is being edited, so typed letters are text rather than controls. */
  get editingText(): boolean {
    return this.nameEdit !== null;
  }

  /** Opens or closes the pause screen (it always opens on the map). */
  toggleBigMap(): void {
    this.nameEdit = null;
    this.pausedOpen = !this.pausedOpen;
    this.overlay.style.display = this.pausedOpen ? 'flex' : 'none';
    this.showPage('map');
    // Free the mouse so the options can be clicked.
    if (this.pausedOpen && document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * Controller/keyboard navigation while paused: X / O opens options, B / Esc backs out,
   * D-pad or stick picks a row and changes it.
   */
  handleMenu(menu: MenuInput): void {
    if (!this.pausedOpen) return;
    if (this.page === 'map') {
      if (menu.options || menu.right) this.showPage('options');
      else if (menu.back) this.toggleBigMap();
      return;
    }
    if (this.nameEdit) {
      this.handleNameEdit(menu);
      return;
    }
    if (menu.back) {
      this.showPage('map');
      return;
    }
    const rows = OPTION_ROWS.length + DEFAULT_BUDDY_NAMES.length + MISSIONS.length;
    if (menu.up) this.optionIndex = (this.optionIndex + rows - 1) % rows;
    if (menu.down) this.optionIndex = (this.optionIndex + 1) % rows;
    const crew = this.optionIndex - OPTION_ROWS.length;
    if (crew >= DEFAULT_BUDDY_NAMES.length) {
      // Level select: A / Enter starts the chosen level.
      if (menu.confirm) this.startLevel(MISSIONS[crew - DEFAULT_BUDDY_NAMES.length].mission);
    } else if (crew >= 0) {
      if (menu.confirm || menu.right) this.startNameEdit(crew);
    } else {
      if (menu.left) this.cycleOption(this.optionIndex, -1);
      if (menu.right || menu.confirm) this.cycleOption(this.optionIndex, 1);
    }
    this.renderOptions();
  }

  // ---------- buddy name editor ----------
  // Arcade-style on a pad (up/down picks the letter, left/right moves along, X deletes) and
  // plain typing on a keyboard. A / Enter saves, B / Esc cancels.

  private startNameEdit(crew: number): void {
    if (!this.settings) return;
    const chars = [...this.settings.buddyNames[crew]];
    this.nameEdit = { crew, chars, cursor: Math.min(chars.length, BUDDY_NAME_MAX - 1) };
    this.showPage('options');
  }

  private handleNameEdit(menu: MenuInput): void {
    const edit = this.nameEdit;
    if (!edit) return;
    if (menu.back) {
      this.nameEdit = null;
    } else if (menu.confirm) {
      this.saveNameEdit();
    } else {
      if (menu.up || menu.down) this.cycleLetter(menu.up ? 1 : -1);
      if (menu.left) edit.cursor = Math.max(0, edit.cursor - 1);
      if (menu.right) edit.cursor = Math.min(edit.chars.length, BUDDY_NAME_MAX - 1, edit.cursor + 1);
      if (menu.options && edit.cursor < edit.chars.length) {
        edit.chars.splice(edit.cursor, 1);
      }
    }
    this.showPage('options');
  }

  /** Steps the letter under the cursor through A–Z, space and hyphen, capitalising word starts. */
  private cycleLetter(dir: 1 | -1): void {
    const edit = this.nameEdit;
    if (!edit) return;
    const set = NAME_LETTERS;
    const at = edit.cursor;
    const current = edit.chars[at];
    // A new slot starts at A going up, or Z going down.
    let i = current === undefined ? (dir > 0 ? -1 : set.indexOf('Z') + 1) : set.indexOf(current.toUpperCase());
    i = (i + dir + set.length) % set.length;
    const wordStart = at === 0 || edit.chars[at - 1] === ' ' || edit.chars[at - 1] === '-';
    const letter = wordStart ? set[i] : set[i].toLowerCase();
    if (current === undefined) edit.chars.push(letter);
    else edit.chars[at] = letter;
  }

  /** Typing on the keyboard while a name is open. */
  private onNameKey(e: KeyboardEvent): void {
    const edit = this.nameEdit;
    if (!edit || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace') {
      if (edit.cursor > 0) {
        edit.chars.splice(edit.cursor - 1, 1);
        edit.cursor--;
      }
    } else if (e.key === 'Delete') {
      if (edit.cursor < edit.chars.length) edit.chars.splice(edit.cursor, 1);
    } else if (e.key.length === 1 && /[A-Za-z0-9 '-]/.test(e.key)) {
      if (edit.chars.length >= BUDDY_NAME_MAX) return;
      edit.chars.splice(edit.cursor, 0, e.key);
      edit.cursor = Math.min(edit.cursor + 1, BUDDY_NAME_MAX - 1);
    } else {
      return; // arrows, Enter and Esc arrive as menu moves
    }
    e.preventDefault();
    this.renderOptions();
  }

  private saveNameEdit(): void {
    const edit = this.nameEdit;
    if (!edit || !this.settings) return;
    const buddyNames = [...this.settings.buddyNames];
    buddyNames[edit.crew] = cleanBuddyName(edit.chars.join(''), DEFAULT_BUDDY_NAMES[edit.crew]);
    this.nameEdit = null;
    this.settings = { ...this.settings, buddyNames };
    this.onSettingsChange?.(this.settings);
  }

  private showPage(page: 'map' | 'options'): void {
    this.page = page;
    for (const p of ['map', 'options'] as const) {
      this.tabs[p].classList.toggle('on', p === page);
      this.pages[p].classList.toggle('on', p === page);
    }
    this.footer.textContent =
      page === 'map'
        ? 'Start / M: resume  ·  X / O: options  ·  B / Esc: resume'
        : this.nameEdit
          ? 'Type, or D-pad ↑↓: letter  ·  ←→: move  ·  X / Backspace: delete  ·  A / Enter: save  ·  B / Esc: cancel'
          : 'D-pad / arrows: choose and change  ·  A / Enter: change  ·  B / Esc: back to map';
    if (page === 'options') this.renderOptions();
  }

  private cycleOption(index: number, dir: 1 | -1): void {
    if (!this.settings) return;
    const row = OPTION_ROWS[index];
    const current = row.values.findIndex((v) => v.value === this.settings?.[row.key]);
    const next = row.values[(current + dir + row.values.length) % row.values.length];
    this.settings = { ...this.settings, [row.key]: next.value };
    this.onSettingsChange?.(this.settings);
    this.renderOptions();
  }

  private startLevel(mission: Mission): void {
    if (mission !== MISSION) this.onMissionStart?.(mission);
  }

  private renderOptions(): void {
    if (!this.settings) return;
    const settings = this.settings;
    this.optionList.replaceChildren();
    OPTION_ROWS.forEach((row, i) => {
      const current = row.values.find((v) => v.value === settings[row.key]) ?? row.values[0];
      const line = el('div', `opt${i === this.optionIndex ? ' sel' : ''}`, this.optionList);
      el('div', 'name', line, row.label);
      const val = el('div', 'val', line);
      const left = el('span', 'arrow', val, '◀');
      el('b', '', val, current.label);
      const right = el('span', 'arrow', val, '▶');
      line.addEventListener('mouseenter', () => {
        if (this.optionIndex === i) return;
        this.optionIndex = i;
        this.renderOptions();
      });
      left.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cycleOption(i, -1);
      });
      right.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cycleOption(i, 1);
      });
      line.addEventListener('click', () => this.cycleOption(i, 1));
      if (i === this.optionIndex) this.optionHint.textContent = current.hint;
    });

    // One row per buddy crew, in rota order; pick one to rename it.
    settings.buddyNames.forEach((name, crew) => {
      const i = OPTION_ROWS.length + crew;
      const editing = this.nameEdit?.crew === crew ? this.nameEdit : null;
      const line = el('div', `opt${i === this.optionIndex ? ' sel' : ''}${crew === 0 ? ' first-name' : ''}`, this.optionList);
      el('div', 'name', line, `Buddy ${crew + 1}`);
      const val = el('div', 'val', line);
      if (editing) {
        const letters = el('div', 'letters', val);
        const slots = Math.min(BUDDY_NAME_MAX, Math.max(editing.chars.length, editing.cursor + 1));
        for (let c = 0; c < slots; c++) {
          const ch = editing.chars[c] ?? '';
          el('span', c === editing.cursor ? 'cur' : '', letters, ch === ' ' ? ' ' : ch);
        }
      } else {
        el('b', '', val, name);
        el('span', 'arrow', val, '✎');
      }
      line.addEventListener('mouseenter', () => {
        if (this.optionIndex === i || this.nameEdit) return;
        this.optionIndex = i;
        this.renderOptions();
      });
      line.addEventListener('click', () => {
        if (this.nameEdit) return;
        this.optionIndex = i;
        this.startNameEdit(crew);
      });
      if (i === this.optionIndex) {
        this.optionHint.textContent = editing
          ? `Leave it empty to go back to ${DEFAULT_BUDDY_NAMES[crew]}. Up to ${BUDDY_NAME_MAX} letters.`
          : `Press A / Enter to rename. ${name === DEFAULT_BUDDY_NAMES[crew] ? '' : `(Was ${DEFAULT_BUDDY_NAMES[crew]}.)`}`;
      }
    });

    // Level select: one row per mission; picking another starts it from the beginning.
    el('div', 'stencil section', this.optionList, 'LEVEL SELECT');
    MISSIONS.forEach((level, n) => {
      const i = OPTION_ROWS.length + settings.buddyNames.length + n;
      const playing = level.mission === MISSION;
      const line = el('div', `opt level${i === this.optionIndex ? ' sel' : ''}`, this.optionList);
      el('div', 'name', line, `${level.mission} · ${level.title}`);
      el('b', playing ? 'pen' : '', el('div', 'val', line), playing ? 'PLAYING' : 'START ▶');
      line.addEventListener('mouseenter', () => {
        if (this.optionIndex === i || this.nameEdit) return;
        this.optionIndex = i;
        this.renderOptions();
      });
      line.addEventListener('click', () => this.startLevel(level.mission));
      if (i === this.optionIndex) {
        this.optionHint.textContent = playing
          ? `${level.blurb} (You're playing this one now.)`
          : `${level.blurb} Press A / Enter to start it from the beginning.`;
      }
    });
    this.optionList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  showHitMarker(zone: ArmorZone): void {
    const { text, color } = HIT_MARKER_TEXT[zone];
    this.hitMarker.textContent = text;
    this.hitMarker.style.color = color;
    this.hitMarkerAge = 0;
  }

  /** A short line in the middle of the screen that floats up and fades (like the armour hit markers). */
  showCallout(text: string, color: string): void {
    this.hitMarker.textContent = text;
    this.hitMarker.style.color = color;
    this.hitMarkerAge = 0;
  }

  showBanner(title: string, subtitle: string): void {
    this.banner.replaceChildren();
    el('div', 'stencil big', this.banner, title);
    el('div', 'small shadow', this.banner, subtitle);
    this.bannerAge = 0;
  }

  showVictory(message: string, footer: string): void {
    this.victoryText.textContent = message;
    this.victoryFooter.textContent = footer;
    this.victory.style.display = 'flex';
    this.bannerAge = BANNER_TIME; // the victory screen replaces any "base destroyed" banner
  }

  setVictoryFooter(text: string): void {
    this.victoryFooter.textContent = text;
  }

  hideVictory(): void {
    this.victory.style.display = 'none';
  }

  get victoryVisible(): boolean {
    return this.victory.style.display === 'flex';
  }

  /** Sets innerHTML only when it actually changes (cheap to call every frame). */
  private setHTML(target: HTMLElement, html: string): void {
    if (this.html.get(target) === html) return;
    this.html.set(target, html);
    target.innerHTML = html;
  }

  update(state: HUDState): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;

    // Hull: segmented bar that shifts green → amber → red.
    const healthFrac = Math.max(0, state.health / state.maxHealth);
    const lit = Math.ceil(healthFrac * HULL_SEGMENTS);
    const hullColor = healthFrac > 0.5 ? '#6fd35a' : healthFrac > 0.25 ? '#e8c23f' : '#e0503f';
    this.segs.forEach((s, i) => (s.style.background = i < lit ? hullColor : 'rgba(0,0,0,0.45)'));
    this.healthText.textContent = `${Math.ceil(state.health)} / ${state.maxHealth}`;
    const loaded = state.reloadFraction <= 0;
    this.reloadFill.style.width = `${(1 - state.reloadFraction) * 100}%`;
    this.reloadText.textContent = loaded ? 'LOADED' : 'RELOADING';
    this.reloadText.style.color = loaded ? '#ffd24a' : '#eef3f8';
    this.modeText.textContent = `${state.cameraMode === 'first' ? '1st' : '3rd'} person · ${state.driveStyle === 'warthog' ? 'Warthog' : 'Classic'} drive`;

    const rocketReady = state.rocketCharge >= 1;
    this.rocketFill.style.width = `${Math.floor(state.rocketCharge * 100)}%`;
    this.rocketText.textContent = rocketReady ? `READY · ${state.usingGamepad ? 'LB' : 'F'}` : `${Math.floor(state.rocketCharge * 100)}%`;
    this.rocketText.style.color = rocketReady ? '#ff9a5a' : '#eef3f8';
    this.rocketSlot.classList.toggle('ready', rocketReady);

    const aaLocked = state.aaLockScreen !== null;
    this.aaText.textContent = state.aaRearming
      ? 'REARMING'
      : state.aaFiring
        ? 'FIRING'
        : state.aaLoaded === 0
          ? 'EMPTY · RETURN TO BASE'
          : aaLocked
            ? `LOCKED · ${state.usingGamepad ? 'RB' : 'Q'}`
            : `${state.aaLoaded} · NO LOCK`;
    this.aaText.style.color = state.aaLoaded === 0 ? '#ff8a7a' : aaLocked ? '#8fd3ff' : '#eef3f8';
    this.aaSlot.classList.toggle('ready', aaLocked);
    this.setHTML(
      this.aaPips,
      Array.from({ length: state.aaMax }, (_, i) => `<div class="pip${i < state.aaLoaded ? ' on' : ''}"></div>`).join(''),
    );
    if (state.aaLockScreen) {
      this.aaLockMarker.style.display = 'block';
      this.aaLockMarker.style.transform = `translate(${state.aaLockScreen.x}px, ${state.aaLockScreen.y}px)`;
    } else {
      this.aaLockMarker.style.display = 'none';
    }

    const hold = state.usingGamepad ? 'HOLD LT' : 'HOLD E';
    this.jamText.textContent = state.megaJamCharge >= 1 ? `${hold} · X MEGA` : `${hold} · MEGA ${Math.floor(state.megaJamCharge * 100)}%`;

    // Buddies roll in by themselves when the meter fills.
    const allOut = state.buddyOut.filter(Boolean).length >= state.buddyMax;
    this.buddyFill.style.width = `${Math.floor(state.buddyCharge * 100)}%`;
    this.buddyText.textContent = allOut ? 'ALL OUT' : `NEXT ${Math.floor(state.buddyCharge * 100)}%`;
    this.buddyText.style.color = allOut ? '#9be27a' : '#eef3f8';
    this.setHTML(
      this.buddyChips,
      // Names only ever hold letters, digits, spaces, hyphens and apostrophes, so they're safe as HTML.
      state.buddyRoster.map((n, i) => `<div class="chip${state.buddyOut[i] ? ' on' : ''}">${n}</div>`).join(''),
    );

    const k = (key: string, what: string) => `<span class="key">${key}</span>${what}`;
    this.setHTML(
      this.keys,
      state.usingGamepad
        ? `${k('LS', 'drive')}${k('RS', 'aim')}${k('RT', 'fire')}${k('LT', 'jam')}${k('LB', 'rocket')}${k('RB', 'AA')}<br>${k('X', 'mega jam')}${k('Y', 'camera')}${k('Start', 'pause · options')}${k('Back', 'home')}`
        : `${k('WASD', 'drive')}${k('Mouse', 'aim')}${k('Click', 'fire')}${k('E', 'jam')}${k('F', 'rocket')}${k('Q', 'AA')}<br>${k('X', 'mega jam')}${k('C', 'camera')}${k('M', 'pause · options')}${k('R', 'home')}` +
            (state.mouseCaptureHint ? '<br><span style="color:#ffd24a">Click the game to capture the mouse for aiming</span>' : ''),
    );

    if (state.rocketLockScreen) {
      this.lockMarker.style.display = 'block';
      this.lockMarker.style.transform = `translate(${state.rocketLockScreen.x}px, ${state.rocketLockScreen.y}px) rotate(45deg)`;
    } else {
      this.lockMarker.style.display = 'none';
    }

    this.hitMarkerAge += dt;
    this.hitMarker.style.opacity = `${Math.max(0, 1 - this.hitMarkerAge / HIT_MARKER_TIME)}`;
    this.hitMarker.style.transform = `translateX(-50%) translateY(${-this.hitMarkerAge * 20}px)`;

    this.bannerAge += dt;
    const bannerT = this.bannerAge / BANNER_TIME;
    this.banner.style.opacity = `${bannerT < 0.1 ? bannerT * 10 : Math.max(0, (1 - bannerT) * 2.5)}`;
    this.banner.style.transform = `translateX(-50%) scale(${1 + Math.max(0, 0.15 - this.bannerAge) * 2})`;

    // Enemy bases: a flag each, red while standing, green with a tick once taken.
    const flags = state.map.enemyBases
      .map(
        (b) =>
          `<div class="flag" style="color:${b.destroyed ? '#9be27a' : '#ff8a7a'}">${flagIcon(b.destroyed ? '#5fbf4a' : '#d23c32', b.destroyed)}${b.name.toUpperCase()}</div>`,
      )
      .join('');
    const fort = state.map.fortress;
    const fortColor = fort.destroyed ? '#9be27a' : fort.locked ? '#b8b09a' : '#ff5a4a';
    const fortIcon = fort.locked
      ? `<svg width="22" height="22" viewBox="0 0 22 22"><path d="M7 10V7a4 4 0 0 1 8 0v3" stroke="#d8d2bd" stroke-width="2" fill="none"/><rect x="5" y="10" width="12" height="9" rx="1.5" fill="#d9a520"/></svg>`
      : flagIcon(fort.destroyed ? '#5fbf4a' : '#8a3cc8', fort.destroyed);
    const title =
      fort.destroyed
        ? 'VICTORY! THE FORTRESS HAS FALLEN'
        : state.enemyBasesLeft === 0
          ? 'FINAL ASSAULT <span style="color:#ff8a7a">DESTROY THE FORTRESS</span>'
          : `ENEMY BASES LEFT <span style="color:#ff8a7a">${state.enemyBasesLeft}</span> / ${state.enemyBasesTotal}`;
    const fortFlag = `<div class="flag" style="color:${fortColor}; margin-left:6px; padding-left:10px; border-left:1px solid rgba(214,196,138,0.35)">${fortIcon}FORTRESS</div>`;
    this.setHTML(this.baseCounter, `<div class="stencil title">${title}</div><div class="flags">${flags}${fortFlag}</div>${ARMY_KEY}`);

    this.updateChecklist(state);

    // Rocket cam: letterbox, hide the regular HUD.
    for (const bar of this.letterbox) bar.style.height = state.cinematic ? '9vh' : '0';
    this.cinematicLabel.style.display = state.cinematic ? 'block' : 'none';
    for (const bit of this.hudBits) bit.style.visibility = state.cinematic ? 'hidden' : 'visible';

    if (state.cinematic || this.pausedOpen) {
      this.crosshair.style.display = 'none';
    } else if (state.aimScreen) {
      this.crosshair.style.display = 'block';
      this.crosshair.style.transform = `translate(${state.aimScreen.x}px, ${state.aimScreen.y}px)`;
      const color = RETICLE_COLORS[state.aimTarget];
      this.crosshair.style.borderColor = color;
      this.crosshair.style.color = color;
      const range = state.aimRange === null ? 'out of range' : `${Math.round(state.aimRange)} m`;
      this.rangeLabel.textContent = state.aimTarget === 'critical' ? `CRITICAL · ${range}` : range;
    } else {
      this.crosshair.style.display = 'none';
    }

    // Beside the reticle (or mid-screen when the reticle is off-screen, aiming high).
    if (state.aaLockScreen && !state.cinematic && !this.pausedOpen) {
      const at = state.aimScreen ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      this.heliTag.style.display = 'flex';
      this.heliTag.style.transform = `translate(${at.x}px, ${at.y}px)`;
      this.heliTagText.textContent = `HELI LOCKED · ${state.usingGamepad ? 'RB' : 'Q'}`;
    } else {
      this.heliTag.style.display = 'none';
    }

    if (this.pausedOpen) {
      this.promptLabel.style.display = 'none';
    } else if (state.insideBase) {
      this.promptLabel.style.display = 'block';
      this.promptLabel.style.color = '#eef3f8';
      this.promptLabel.textContent = state.health < state.maxHealth ? `🔧 ${state.insideBase} — repairing` : state.insideBase;
    } else if (healthFrac < 0.3) {
      this.promptLabel.style.display = 'block';
      this.promptLabel.style.color = '#ff9a8a';
      this.promptLabel.textContent = 'Hull critical — head back to a family base (yellow rings on the map)';
    } else {
      this.promptLabel.style.display = 'none';
    }

    if (!this.worldMap) return;
    this.worldMap.draw(this.minimapCtx, MINIMAP_SIZE, MINIMAP_SIZE, state.map.playerX, state.map.playerZ, MINIMAP_METERS, state.map, {
      arrowScale: 1,
      labels: false,
      rimPointer: true,
      heatmap: false,
    });

    if (this.pausedOpen && this.page === 'map') {
      const size = Math.floor(Math.min(window.innerWidth * 0.9, window.innerHeight - 310));
      if (this.bigMapCanvas.width !== size) {
        this.bigMapCanvas.width = size;
        this.bigMapCanvas.height = size;
      }
      this.worldMap.draw(this.bigMapCtx, size, size, 0, 0, WORLD_SIZE, state.map, { arrowScale: 2.6, labels: true, rimPointer: false, heatmap: true });
    }
  }

  private updateChecklist(state: HUDState): void {
    const base = state.nearbyBase;
    if (!base) {
      this.checklist.style.display = 'none';
      return;
    }
    this.checklist.style.display = 'block';
    const left = base.objectives.filter((o) => !o.done).length;
    this.setHTML(
      this.checklist,
      `<div class="head"><div class="stencil" style="font-size:13px">${base.name.toUpperCase()}</div>` +
        `<div style="font-size:11px; opacity:0.9">${Math.round(base.distance)} m · ${left} target${left === 1 ? '' : 's'} left</div></div>` +
        `<div style="height:6px"></div>` +
        base.objectives.map((o) => `<div class="line${o.done ? ' done' : ''}">${o.done ? '☑' : '☐'} ${o.label}</div>`).join(''),
    );
  }
}
