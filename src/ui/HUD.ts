import type { WorldMap, MapMarker } from './WorldMap';
import type { AimTarget } from './AimGuide';
import type { ArmorZone } from '../entities/Tank';
import { WORLD_SIZE } from '../core/config';

export interface HUDState {
  health: number;
  maxHealth: number;
  reloadFraction: number; // 0 = ready to fire, 1 = just fired
  cameraMode: 'first' | 'third';
  usingGamepad: boolean;
  insideBase: boolean;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  markers: MapMarker[];
  baseX: number;
  baseZ: number;
  /** Where the shell will land, in screen pixels, or null if off-screen. */
  aimScreen: { x: number; y: number } | null;
  /** Ground distance to the predicted impact, or null if it lands out of range. */
  aimRange: number | null;
  aimTarget: AimTarget;
  /** 0..1; the rocket can launch at 1. */
  rocketCharge: number;
  /** Screen position of the enemy the rocket would lock onto, when ready. */
  rocketLockScreen: { x: number; y: number } | null;
  /** True while the rocket cam / explosion replay is playing. */
  cinematic: boolean;
}

const HIT_MARKER_TEXT: Record<ArmorZone, { text: string; color: string }> = {
  front: { text: 'FRONT ARMOR ×0.5', color: '#c9d3dc' },
  side: { text: 'SIDE HIT ×1', color: '#ffd27a' },
  rear: { text: 'REAR HIT ×2!', color: '#ff6a5a' },
};
const HIT_MARKER_TIME = 1.1;

const RETICLE_COLORS: Record<AimTarget, string> = {
  enemy: '#ff6a5a',
  building: '#ffb050',
  ground: 'rgba(255,255,255,0.9)',
  none: 'rgba(255,255,255,0.6)',
};

const MINIMAP_SIZE = 200;
const MINIMAP_METERS = 700; // meters shown across the minimap

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cssText: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = cssText;
  return e;
}

/** Plain-DOM + canvas HUD overlay: health, reload, minimap / full map, crosshair, prompts. */
export class HUD {
  private readonly healthFill: HTMLDivElement;
  private readonly healthLabel: HTMLDivElement;
  private readonly reloadFill: HTMLDivElement;
  private readonly statusLabel: HTMLDivElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly bigMapWrap: HTMLDivElement;
  private readonly bigMapCanvas: HTMLCanvasElement;
  private readonly bigMapCtx: CanvasRenderingContext2D;
  private readonly crosshair: HTMLDivElement;
  private readonly rangeLabel: HTMLDivElement;
  private readonly promptLabel: HTMLDivElement;
  private readonly rocketFill: HTMLDivElement;
  private readonly rocketLabel: HTMLDivElement;
  private readonly lockMarker: HTMLDivElement;
  private readonly hitMarker: HTMLDivElement;
  private readonly letterbox: HTMLDivElement[];
  private readonly cinematicLabel: HTMLDivElement;
  private readonly hudBits: HTMLElement[];
  private worldMap: WorldMap | null = null;
  private bigMapOpen = false;
  private hitMarkerAge = HIT_MARKER_TIME;
  private lastUpdate = performance.now();

  constructor(container: HTMLElement) {
    const root = el(
      'div',
      'position:absolute; inset:0; pointer-events:none; font-family:"Segoe UI",system-ui,sans-serif; color:#eef3f8;',
    );
    container.appendChild(root);

    // --- health + reload (bottom-left) ---
    const bottomLeft = el('div', 'position:absolute; left:20px; bottom:20px; width:260px;');
    this.healthLabel = el('div', 'font-size:13px; font-weight:600; margin-bottom:4px; text-shadow:0 1px 3px #000;');
    bottomLeft.appendChild(this.healthLabel);

    const healthTrack = el(
      'div',
      'width:100%; height:16px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.35); border-radius:3px; overflow:hidden;',
    );
    this.healthFill = el('div', 'height:100%; width:100%; background:#5fd15f;');
    healthTrack.appendChild(this.healthFill);
    bottomLeft.appendChild(healthTrack);

    const reloadTrack = el(
      'div',
      'margin-top:6px; width:100%; height:6px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.25); border-radius:3px; overflow:hidden;',
    );
    this.reloadFill = el('div', 'height:100%; width:100%; background:#e0c23f;');
    reloadTrack.appendChild(this.reloadFill);
    bottomLeft.appendChild(reloadTrack);

    // Rocket charge meter.
    this.rocketLabel = el('div', 'margin-top:10px; font-size:12px; font-weight:700; text-shadow:0 1px 3px #000;');
    bottomLeft.appendChild(this.rocketLabel);
    const rocketTrack = el(
      'div',
      'margin-top:3px; width:100%; height:10px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.3); border-radius:3px; overflow:hidden;',
    );
    this.rocketFill = el('div', 'height:100%; width:0%; background:linear-gradient(90deg,#c0392b,#ff8a3d);');
    rocketTrack.appendChild(this.rocketFill);
    bottomLeft.appendChild(rocketTrack);
    root.appendChild(bottomLeft);

    // Lock-on diamond over the rocket's target.
    this.lockMarker = el(
      'div',
      'position:absolute; left:0; top:0; width:34px; height:34px; margin:-17px 0 0 -17px; border:2px solid #ff5a4a; transform-origin:center; display:none; box-shadow:0 0 6px rgba(255,90,74,0.8);',
    );
    const lockText = el('div', 'position:absolute; left:50%; top:-20px; transform:translateX(-50%); font-size:11px; font-weight:800; color:#ff6a5a; white-space:nowrap; text-shadow:0 1px 3px #000;');
    lockText.textContent = 'LOCK';
    this.lockMarker.appendChild(lockText);
    root.appendChild(this.lockMarker);

    // Armour hit feedback near the centre.
    this.hitMarker = el(
      'div',
      'position:absolute; left:50%; top:40%; transform:translateX(-50%); font-size:18px; font-weight:800; letter-spacing:1px; text-shadow:0 2px 4px #000; opacity:0;',
    );
    root.appendChild(this.hitMarker);

    // Cinematic letterbox bars + label for the rocket cam.
    this.letterbox = ['top', 'bottom'].map((side) => {
      const bar = el('div', `position:absolute; left:0; right:0; ${side}:0; height:0; background:#000; transition:height 0.35s;`);
      root.appendChild(bar);
      return bar;
    });
    this.cinematicLabel = el(
      'div',
      'position:absolute; left:24px; top:10.5vh; font-size:14px; font-weight:800; letter-spacing:3px; color:#ff8a3d; text-shadow:0 1px 3px #000; display:none;',
    );
    this.cinematicLabel.textContent = '● ROCKET CAM';
    root.appendChild(this.cinematicLabel);

    // --- status (top-left) ---
    this.statusLabel = el(
      'div',
      'position:absolute; left:20px; top:18px; font-size:13px; line-height:1.5; text-shadow:0 1px 3px #000; opacity:0.9;',
    );
    root.appendChild(this.statusLabel);

    // --- minimap (top-right) ---
    const minimapWrap = el(
      'div',
      `position:absolute; right:20px; top:18px; width:${MINIMAP_SIZE}px; height:${MINIMAP_SIZE}px; border-radius:50%; overflow:hidden; border:3px solid rgba(20,40,20,0.85); box-shadow:0 2px 8px rgba(0,0,0,0.5);`,
    );
    const minimapCanvas = document.createElement('canvas');
    minimapCanvas.width = MINIMAP_SIZE;
    minimapCanvas.height = MINIMAP_SIZE;
    minimapWrap.appendChild(minimapCanvas);
    root.appendChild(minimapWrap);
    this.minimapCtx = minimapCanvas.getContext('2d') as CanvasRenderingContext2D;

    // --- full map overlay (toggled) ---
    this.bigMapWrap = el(
      'div',
      'position:absolute; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.45); flex-direction:column; gap:8px;',
    );
    this.bigMapCanvas = document.createElement('canvas');
    this.bigMapCanvas.style.cssText = 'border:3px solid rgba(20,40,20,0.9); border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,0.6);';
    this.bigMapWrap.appendChild(this.bigMapCanvas);
    const legend = el('div', 'font-size:13px; text-shadow:0 1px 3px #000;');
    legend.textContent = 'You (green arrow) · Base (yellow ring) · Tanks (red) · Troops (orange) · Bunkers (brown) — M / Start to close';
    this.bigMapWrap.appendChild(legend);
    root.appendChild(this.bigMapWrap);
    this.bigMapCtx = this.bigMapCanvas.getContext('2d') as CanvasRenderingContext2D;

    // --- crosshair: follows where the barrel points ---
    this.crosshair = el(
      'div',
      'position:absolute; left:0; top:0; width:22px; height:22px; margin:-11px 0 0 -11px; border:2px solid rgba(255,255,255,0.9); border-radius:50%; box-shadow:0 0 4px rgba(0,0,0,0.7); display:none;',
    );
    const dot = el('div', 'position:absolute; left:50%; top:50%; width:4px; height:4px; margin:-2px 0 0 -2px; background:currentColor; border-radius:50%;');
    this.crosshair.appendChild(dot);
    this.rangeLabel = el(
      'div',
      'position:absolute; left:50%; top:26px; transform:translateX(-50%); font-size:12px; font-weight:700; white-space:nowrap; text-shadow:0 1px 3px #000;',
    );
    this.crosshair.appendChild(this.rangeLabel);
    root.appendChild(this.crosshair);

    // --- center prompt ---
    this.promptLabel = el(
      'div',
      'position:absolute; left:50%; top:72%; transform:translateX(-50%); font-size:16px; font-weight:600; text-align:center; text-shadow:0 1px 4px #000; display:none;',
    );
    root.appendChild(this.promptLabel);

    this.hudBits = [bottomLeft, this.statusLabel, minimapWrap, this.promptLabel];
  }

  setWorldMap(map: WorldMap): void {
    this.worldMap = map;
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

  update(state: HUDState): void {
    const healthFrac = Math.max(0, state.health / state.maxHealth);
    this.healthFill.style.width = `${healthFrac * 100}%`;
    this.healthFill.style.background = healthFrac > 0.5 ? '#5fd15f' : healthFrac > 0.25 ? '#e0c23f' : '#e05f4f';
    this.healthLabel.textContent = `HULL  ${Math.ceil(state.health)} / ${state.maxHealth}`;
    this.reloadFill.style.width = `${(1 - state.reloadFraction) * 100}%`;

    this.statusLabel.innerHTML = state.usingGamepad
      ? `${state.cameraMode === 'first' ? '1st' : '3rd'} person · Controller<br>LS drive · RS aim · RT fire · LB rocket · Y camera · Start map · Back reset`
      : `${state.cameraMode === 'first' ? '1st' : '3rd'} person · Keyboard/Mouse<br>WASD drive · mouse aim · click fire · F / right-click rocket · C camera · M map · R reset`;

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;

    // Rocket charge.
    const ready = state.rocketCharge >= 1;
    this.rocketFill.style.width = `${Math.floor(state.rocketCharge * 100)}%`;
    this.rocketFill.style.boxShadow = ready ? '0 0 10px #ff8a3d' : 'none';
    this.rocketLabel.textContent = ready
      ? `ROCKET READY — ${state.usingGamepad ? 'LB' : 'F / right-click'}`
      : `ROCKET ${Math.floor(state.rocketCharge * 100)}%`;
    this.rocketLabel.style.color = ready ? `hsl(20, 100%, ${60 + 15 * Math.sin(now / 150)}%)` : '#eef3f8';

    if (state.rocketLockScreen) {
      this.lockMarker.style.display = 'block';
      this.lockMarker.style.transform = `translate(${state.rocketLockScreen.x}px, ${state.rocketLockScreen.y}px) rotate(45deg)`;
    } else {
      this.lockMarker.style.display = 'none';
    }

    this.hitMarkerAge += dt;
    this.hitMarker.style.opacity = `${Math.max(0, 1 - this.hitMarkerAge / HIT_MARKER_TIME)}`;
    this.hitMarker.style.transform = `translateX(-50%) translateY(${-this.hitMarkerAge * 20}px)`;

    // Rocket cam: letterbox, hide the regular HUD.
    for (const bar of this.letterbox) bar.style.height = state.cinematic ? '9vh' : '0';
    this.cinematicLabel.style.display = state.cinematic ? 'block' : 'none';
    for (const bit of this.hudBits) bit.style.visibility = state.cinematic ? 'hidden' : 'visible';
    if (state.cinematic) {
      this.crosshair.style.display = 'none';
      return;
    }

    if (state.aimScreen) {
      this.crosshair.style.display = 'block';
      this.crosshair.style.transform = `translate(${state.aimScreen.x}px, ${state.aimScreen.y}px)`;
      const color = RETICLE_COLORS[state.aimTarget];
      this.crosshair.style.borderColor = color;
      this.crosshair.style.color = color;
      this.rangeLabel.textContent = state.aimRange === null ? 'out of range' : `${Math.round(state.aimRange)} m`;
    } else {
      this.crosshair.style.display = 'none';
    }

    if (state.insideBase) {
      this.promptLabel.style.display = 'block';
      this.promptLabel.style.color = '#eef3f8';
      this.promptLabel.textContent = state.health < state.maxHealth ? 'Home base — repairing' : 'Home base';
    } else if (healthFrac < 0.3) {
      this.promptLabel.style.display = 'block';
      this.promptLabel.style.color = '#ff9a8a';
      this.promptLabel.textContent = 'Hull critical — retreat to base (follow the yellow ring on the map)';
    } else {
      this.promptLabel.style.display = 'none';
    }

    if (!this.worldMap) return;
    const view = {
      playerX: state.playerX,
      playerZ: state.playerZ,
      playerYaw: state.playerYaw,
      baseX: state.baseX,
      baseZ: state.baseZ,
      markers: state.markers,
    };
    this.worldMap.draw(this.minimapCtx, MINIMAP_SIZE, MINIMAP_SIZE, state.playerX, state.playerZ, MINIMAP_METERS, view);

    if (this.bigMapOpen) {
      const size = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.82);
      if (this.bigMapCanvas.width !== size) {
        this.bigMapCanvas.width = size;
        this.bigMapCanvas.height = size;
      }
      this.worldMap.draw(this.bigMapCtx, size, size, 0, 0, WORLD_SIZE, view);
    }
  }
}
