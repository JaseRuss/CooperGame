import type { WorldMap, MapView } from './WorldMap';
import type { AimTarget } from './AimGuide';
import type { ArmorZone } from '../entities/Tank';
import { WORLD_SIZE } from '../core/config';

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
  /** 0..1; a buddy tank can be called in at 1. */
  buddyCharge: number;
  buddyCount: number;
  /** True while the rocket cam / explosion replay is playing. */
  cinematic: boolean;
  enemyBasesLeft: number;
  enemyBasesTotal: number;
  /** When close to an enemy base: what still needs destroying there. */
  nearbyBase: { name: string; distance: number; objectives: ObjectiveLine[] } | null;
}

const HIT_MARKER_TEXT: Record<ArmorZone, { text: string; color: string }> = {
  front: { text: 'FRONT ARMOR ×0.5', color: '#c9d3dc' },
  side: { text: 'SIDE HIT ×1', color: '#ffd27a' },
  rear: { text: 'REAR HIT ×2!', color: '#ff6a5a' },
};
const HIT_MARKER_TIME = 1.1;
const BANNER_TIME = 4;

const RETICLE_COLORS: Record<AimTarget, string> = {
  enemy: '#ff6a5a',
  building: '#ffb050',
  ground: 'rgba(255,255,255,0.9)',
  none: 'rgba(255,255,255,0.6)',
};

const MINIMAP_SIZE = 200;
const MINIMAP_METERS = 700; // meters shown across the minimap

const PANEL = 'background:rgba(12,22,12,0.62); border:1px solid rgba(255,255,255,0.18); border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.4);';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cssText: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = cssText;
  parent?.appendChild(e);
  return e;
}

function meter(parent: HTMLElement, height: number, fill: string): { label: HTMLDivElement; fill: HTMLDivElement } {
  const label = el('div', 'margin-top:10px; font-size:12px; font-weight:700; text-shadow:0 1px 3px #000;', parent);
  const track = el(
    'div',
    `margin-top:3px; width:100%; height:${height}px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.3); border-radius:3px; overflow:hidden;`,
    parent,
  );
  return { label, fill: el('div', `height:100%; width:0%; background:${fill};`, track) };
}

/** Plain-DOM + canvas HUD overlay. */
export class HUD {
  private readonly healthFill: HTMLDivElement;
  private readonly healthLabel: HTMLDivElement;
  private readonly reloadFill: HTMLDivElement;
  private readonly rocket: { label: HTMLDivElement; fill: HTMLDivElement };
  private readonly buddy: { label: HTMLDivElement; fill: HTMLDivElement };
  private readonly statusLabel: HTMLDivElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly bigMapWrap: HTMLDivElement;
  private readonly bigMapCanvas: HTMLCanvasElement;
  private readonly bigMapCtx: CanvasRenderingContext2D;
  private readonly crosshair: HTMLDivElement;
  private readonly rangeLabel: HTMLDivElement;
  private readonly promptLabel: HTMLDivElement;
  private readonly lockMarker: HTMLDivElement;
  private readonly hitMarker: HTMLDivElement;
  private readonly letterbox: HTMLDivElement[];
  private readonly cinematicLabel: HTMLDivElement;
  private readonly baseCounter: HTMLDivElement;
  private readonly checklist: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly victory: HTMLDivElement;
  private readonly hudBits: HTMLElement[];
  private worldMap: WorldMap | null = null;
  private bigMapOpen = false;
  private hitMarkerAge = HIT_MARKER_TIME;
  private bannerAge = BANNER_TIME;
  private lastUpdate = performance.now();
  private lastChecklist = '';

  constructor(container: HTMLElement) {
    const root = el(
      'div',
      'position:absolute; inset:0; pointer-events:none; font-family:"Segoe UI",system-ui,sans-serif; color:#eef3f8;',
      container,
    );

    // --- health, reload, rocket and buddy meters (bottom-left) ---
    const bottomLeft = el('div', 'position:absolute; left:20px; bottom:20px; width:260px;', root);
    this.healthLabel = el('div', 'font-size:13px; font-weight:600; margin-bottom:4px; text-shadow:0 1px 3px #000;', bottomLeft);
    const healthTrack = el(
      'div',
      'width:100%; height:16px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.35); border-radius:3px; overflow:hidden;',
      bottomLeft,
    );
    this.healthFill = el('div', 'height:100%; width:100%; background:#5fd15f;', healthTrack);
    const reloadTrack = el(
      'div',
      'margin-top:6px; width:100%; height:6px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.25); border-radius:3px; overflow:hidden;',
      bottomLeft,
    );
    this.reloadFill = el('div', 'height:100%; width:100%; background:#e0c23f;', reloadTrack);
    this.rocket = meter(bottomLeft, 10, 'linear-gradient(90deg,#c0392b,#ff8a3d)');
    this.buddy = meter(bottomLeft, 10, 'linear-gradient(90deg,#3f7a2a,#9be27a)');

    // --- lock-on diamond over the rocket's target ---
    this.lockMarker = el(
      'div',
      'position:absolute; left:0; top:0; width:34px; height:34px; margin:-17px 0 0 -17px; border:2px solid #ff5a4a; display:none; box-shadow:0 0 6px rgba(255,90,74,0.8);',
      root,
    );
    el('div', 'position:absolute; left:50%; top:-20px; transform:translateX(-50%); font-size:11px; font-weight:800; color:#ff6a5a; white-space:nowrap; text-shadow:0 1px 3px #000;', this.lockMarker).textContent = 'LOCK';

    // --- armour hit feedback ---
    this.hitMarker = el(
      'div',
      'position:absolute; left:50%; top:40%; transform:translateX(-50%); font-size:18px; font-weight:800; letter-spacing:1px; text-shadow:0 2px 4px #000; opacity:0;',
      root,
    );

    // --- rocket cam letterbox ---
    this.letterbox = ['top', 'bottom'].map((side) =>
      el('div', `position:absolute; left:0; right:0; ${side}:0; height:0; background:#000; transition:height 0.35s;`, root),
    );
    this.cinematicLabel = el(
      'div',
      'position:absolute; left:24px; top:10.5vh; font-size:14px; font-weight:800; letter-spacing:3px; color:#ff8a3d; text-shadow:0 1px 3px #000; display:none;',
      root,
    );
    this.cinematicLabel.textContent = '● ROCKET CAM';

    // --- controls help (top-left) ---
    this.statusLabel = el('div', 'position:absolute; left:20px; top:18px; font-size:13px; line-height:1.5; text-shadow:0 1px 3px #000; opacity:0.9;', root);

    // --- enemy base counter (top-centre) ---
    this.baseCounter = el(
      'div',
      `position:absolute; left:50%; top:14px; transform:translateX(-50%); padding:6px 16px; font-size:15px; font-weight:800; letter-spacing:1.5px; text-shadow:0 1px 3px #000; white-space:nowrap; ${PANEL}`,
      root,
    );

    // --- minimap (top-right) ---
    const minimapWrap = el(
      'div',
      `position:absolute; right:20px; top:18px; width:${MINIMAP_SIZE}px; height:${MINIMAP_SIZE}px; border-radius:50%; overflow:hidden; border:3px solid rgba(20,40,20,0.85); box-shadow:0 2px 8px rgba(0,0,0,0.5);`,
      root,
    );
    const minimapCanvas = el('canvas', '', minimapWrap);
    minimapCanvas.width = MINIMAP_SIZE;
    minimapCanvas.height = MINIMAP_SIZE;
    this.minimapCtx = minimapCanvas.getContext('2d') as CanvasRenderingContext2D;

    // --- target checklist when near an enemy base (under the minimap) ---
    this.checklist = el(
      'div',
      `position:absolute; right:20px; top:${MINIMAP_SIZE + 34}px; width:${MINIMAP_SIZE}px; padding:10px 12px; font-size:13px; line-height:1.55; text-shadow:0 1px 2px #000; display:none; ${PANEL}`,
      root,
    );

    // --- event banner (base destroyed etc.) ---
    this.banner = el(
      'div',
      'position:absolute; left:50%; top:18%; transform:translateX(-50%); text-align:center; font-size:30px; font-weight:900; letter-spacing:2px; color:#ffd24a; text-shadow:0 3px 8px #000, 0 0 18px rgba(255,160,40,0.5); opacity:0; white-space:nowrap;',
      root,
    );

    // --- full map / pause screen ---
    this.bigMapWrap = el(
      'div',
      'position:absolute; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.55); flex-direction:column; gap:8px;',
      root,
    );
    el('div', 'font-size:28px; font-weight:900; letter-spacing:6px; text-shadow:0 2px 6px #000;', this.bigMapWrap).textContent = 'PAUSED';
    this.bigMapCanvas = el('canvas', 'border:3px solid rgba(20,40,20,0.9); border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,0.6);', this.bigMapWrap);
    el('div', 'font-size:13px; text-shadow:0 1px 3px #000;', this.bigMapWrap).textContent =
      'You (green arrow) · Buddies (light green) · Family bases (yellow) · Enemy bases (red ✕) · Tanks · Troops · Bunkers — M / Start to resume';
    this.bigMapCtx = this.bigMapCanvas.getContext('2d') as CanvasRenderingContext2D;

    // --- crosshair: where the shell will land ---
    this.crosshair = el(
      'div',
      'position:absolute; left:0; top:0; width:22px; height:22px; margin:-11px 0 0 -11px; border:2px solid rgba(255,255,255,0.9); border-radius:50%; box-shadow:0 0 4px rgba(0,0,0,0.7); display:none;',
      root,
    );
    el('div', 'position:absolute; left:50%; top:50%; width:4px; height:4px; margin:-2px 0 0 -2px; background:currentColor; border-radius:50%;', this.crosshair);
    this.rangeLabel = el(
      'div',
      'position:absolute; left:50%; top:26px; transform:translateX(-50%); font-size:12px; font-weight:700; white-space:nowrap; text-shadow:0 1px 3px #000;',
      this.crosshair,
    );

    // --- centre prompt ---
    this.promptLabel = el(
      'div',
      'position:absolute; left:50%; top:72%; transform:translateX(-50%); font-size:16px; font-weight:600; text-align:center; text-shadow:0 1px 4px #000; display:none;',
      root,
    );

    // --- victory screen ---
    this.victory = el(
      'div',
      'position:absolute; inset:0; display:none; flex-direction:column; align-items:center; justify-content:center; gap:14px; background:radial-gradient(ellipse at center, rgba(40,80,30,0.55), rgba(0,0,0,0.25)); text-align:center;',
      root,
    );
    el('div', 'font-size:64px; font-weight:900; letter-spacing:4px; color:#ffd24a; text-shadow:0 4px 14px #000, 0 0 30px rgba(255,200,60,0.7);', this.victory).textContent = 'WELL DONE COOPER!';
    el('div', 'font-size:22px; font-weight:700; text-shadow:0 2px 6px #000;', this.victory).textContent = 'Every enemy base has been destroyed. The toy box is yours!';
    el('div', 'font-size:14px; opacity:0.85; text-shadow:0 1px 4px #000;', this.victory).textContent = 'Keep driving around and enjoy it!';

    this.hudBits = [bottomLeft, this.statusLabel, minimapWrap, this.promptLabel, this.baseCounter, this.checklist];
  }

  setWorldMap(map: WorldMap): void {
    this.worldMap = map;
  }

  get paused(): boolean {
    return this.bigMapOpen;
  }

  toggleBigMap(): void {
    this.bigMapOpen = !this.bigMapOpen;
    this.bigMapWrap.style.display = this.bigMapOpen ? 'flex' : 'none';
  }

  showHitMarker(zone: ArmorZone): void {
    const { text, color } = HIT_MARKER_TEXT[zone];
    this.hitMarker.textContent = text;
    this.hitMarker.style.color = color;
    this.hitMarkerAge = 0;
  }

  showBanner(title: string, subtitle: string): void {
    this.banner.innerHTML = `${title}<div style="font-size:17px; font-weight:700; letter-spacing:1px; color:#fff; margin-top:6px">${subtitle}</div>`;
    this.bannerAge = 0;
  }

  showVictory(): void {
    this.victory.style.display = 'flex';
    this.bannerAge = BANNER_TIME; // the victory screen replaces any "base destroyed" banner
  }

  hideVictory(): void {
    this.victory.style.display = 'none';
  }

  get victoryVisible(): boolean {
    return this.victory.style.display === 'flex';
  }

  update(state: HUDState): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;

    const healthFrac = Math.max(0, state.health / state.maxHealth);
    this.healthFill.style.width = `${healthFrac * 100}%`;
    this.healthFill.style.background = healthFrac > 0.5 ? '#5fd15f' : healthFrac > 0.25 ? '#e0c23f' : '#e05f4f';
    this.healthLabel.textContent = `HULL  ${Math.ceil(state.health)} / ${state.maxHealth}`;
    this.reloadFill.style.width = `${(1 - state.reloadFraction) * 100}%`;

    this.statusLabel.innerHTML = state.usingGamepad
      ? `${state.cameraMode === 'first' ? '1st' : '3rd'} person · Controller<br>LS drive · RS aim · RT fire · LB rocket · X buddy · Y camera · Start map · Back reset`
      : `${state.cameraMode === 'first' ? '1st' : '3rd'} person · Keyboard/Mouse<br>WASD drive · mouse aim · click fire · F rocket · X buddy · C camera · M map · R reset`;

    this.updateMeter(this.rocket, state.rocketCharge, 'ROCKET', state.usingGamepad ? 'LB' : 'F / right-click', 20, now);
    const buddyNote = state.buddyCount > 0 ? ` · ${state.buddyCount} with you` : '';
    this.updateMeter(this.buddy, state.buddyCharge, 'BUDDY TANK', state.usingGamepad ? 'X' : 'X key', 100, now, buddyNote);

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

    this.baseCounter.innerHTML =
      state.enemyBasesLeft === 0
        ? '<span style="color:#9be27a">ALL ENEMY BASES DESTROYED ✓</span>'
        : `ENEMY BASES LEFT <span style="color:#ff7a6a">${state.enemyBasesLeft}</span> / ${state.enemyBasesTotal}`;

    this.updateChecklist(state);

    // Rocket cam: letterbox, hide the regular HUD.
    for (const bar of this.letterbox) bar.style.height = state.cinematic ? '9vh' : '0';
    this.cinematicLabel.style.display = state.cinematic ? 'block' : 'none';
    for (const bit of this.hudBits) bit.style.visibility = state.cinematic ? 'hidden' : 'visible';

    if (state.cinematic) {
      this.crosshair.style.display = 'none';
    } else if (state.aimScreen) {
      this.crosshair.style.display = 'block';
      this.crosshair.style.transform = `translate(${state.aimScreen.x}px, ${state.aimScreen.y}px)`;
      const color = RETICLE_COLORS[state.aimTarget];
      this.crosshair.style.borderColor = color;
      this.crosshair.style.color = color;
      this.rangeLabel.textContent = state.aimRange === null ? 'out of range' : `${Math.round(state.aimRange)} m`;
    } else {
      this.crosshair.style.display = 'none';
    }

    if (this.bigMapOpen) {
      this.promptLabel.style.display = 'none';
    } else if (state.insideBase) {
      this.promptLabel.style.display = 'block';
      this.promptLabel.style.color = '#eef3f8';
      this.promptLabel.textContent = state.health < state.maxHealth ? `${state.insideBase} — repairing` : state.insideBase;
    } else if (healthFrac < 0.3) {
      this.promptLabel.style.display = 'block';
      this.promptLabel.style.color = '#ff9a8a';
      this.promptLabel.textContent = 'Hull critical — retreat to a family base (yellow rings on the map)';
    } else {
      this.promptLabel.style.display = 'none';
    }

    if (!this.worldMap) return;
    this.worldMap.draw(this.minimapCtx, MINIMAP_SIZE, MINIMAP_SIZE, state.map.playerX, state.map.playerZ, MINIMAP_METERS, state.map, {
      arrowScale: 1,
      labels: false,
      rimPointer: true,
    });

    if (this.bigMapOpen) {
      const size = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.78);
      if (this.bigMapCanvas.width !== size) {
        this.bigMapCanvas.width = size;
        this.bigMapCanvas.height = size;
      }
      this.worldMap.draw(this.bigMapCtx, size, size, 0, 0, WORLD_SIZE, state.map, { arrowScale: 2.6, labels: true, rimPointer: false });
    }
  }

  private updateMeter(
    m: { label: HTMLDivElement; fill: HTMLDivElement },
    charge: number,
    name: string,
    key: string,
    hue: number,
    now: number,
    note = '',
  ): void {
    const ready = charge >= 1;
    m.fill.style.width = `${Math.floor(charge * 100)}%`;
    m.fill.style.boxShadow = ready ? `0 0 10px hsl(${hue}, 90%, 60%)` : 'none';
    m.label.textContent = ready ? `${name} READY — ${key}${note}` : `${name} ${Math.floor(charge * 100)}%${note}`;
    m.label.style.color = ready ? `hsl(${hue}, 100%, ${62 + 14 * Math.sin(now / 150)}%)` : '#eef3f8';
  }

  private updateChecklist(state: HUDState): void {
    const base = state.nearbyBase;
    if (!base) {
      this.checklist.style.display = 'none';
      this.lastChecklist = '';
      return;
    }
    this.checklist.style.display = 'block';
    const left = base.objectives.filter((o) => !o.done).length;
    const html =
      `<div style="font-weight:900; letter-spacing:1px; color:#ff8a7a">ENEMY BASE ${base.name.toUpperCase()}</div>` +
      `<div style="font-size:11px; opacity:0.8; margin-bottom:6px">${Math.round(base.distance)} m · ${left} target${left === 1 ? '' : 's'} left</div>` +
      base.objectives
        .map((o) =>
          o.done
            ? `<div style="color:#9be27a; text-decoration:line-through; opacity:0.8">☑ ${o.label}</div>`
            : `<div>☐ ${o.label}</div>`,
        )
        .join('');
    if (html !== this.lastChecklist) {
      this.checklist.innerHTML = html;
      this.lastChecklist = html;
    }
  }
}
