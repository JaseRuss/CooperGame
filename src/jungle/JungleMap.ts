import type { WorldMap, MapView, MapDrawOptions } from '../ui/WorldMap';

const CELL = 5;
/** How many metres across the little corner map shows. */
const MINI_METERS = 230;

export interface MapData {
  player: { x: number; z: number; yaw: number };
  squad: { x: number; z: number; down: boolean }[];
  /** Enemies the player (or a lookout) can currently make out. */
  enemies: { x: number; z: number }[];
  outposts: { x: number; z: number; army: 'tan' | 'blue'; destroyed: boolean }[];
  towers: { x: number; z: number }[];
  airbase: { x: number; z: number; left: number } | null;
  bombs: { x: number; z: number }[];
}

/**
 * The jungle's map: it starts nearly blank, and what you've seen is drawn in as you go: a patch
 * round you wherever you walk, and a big circle round any lookout tower you climb. Outposts and
 * towers only show once their ground is on the map. It's drawn through the HUD's own map slots
 * (the corner map and the pause-screen map), standing in for the tank game's world map.
 */
export class JungleMap {
  readonly data: MapData = { player: { x: 0, z: 0, yaw: 0 }, squad: [], enemies: [], outposts: [], towers: [], airbase: null, bombs: [] };
  private readonly n: number;
  private readonly seen: Uint8Array;

  constructor(private readonly half: number) {
    this.n = Math.ceil((half * 2) / CELL);
    this.seen = new Uint8Array(this.n * this.n);
  }

  private index(x: number, z: number): number {
    const cx = Math.floor((x + this.half) / CELL);
    const cz = Math.floor((z + this.half) / CELL);
    return cx < 0 || cz < 0 || cx >= this.n || cz >= this.n ? -1 : cz * this.n + cx;
  }

  /** Puts everything within `r` of (x, z) on the map. */
  reveal(x: number, z: number, r: number): void {
    const c = Math.ceil(r / CELL);
    for (let dz = -c; dz <= c; dz++) {
      for (let dx = -c; dx <= c; dx++) {
        if (Math.hypot(dx, dz) * CELL > r) continue;
        const i = this.index(x + dx * CELL, z + dz * CELL);
        if (i >= 0) this.seen[i] = 1;
      }
    }
  }

  known(x: number, z: number): boolean {
    const i = this.index(x, z);
    return i >= 0 && this.seen[i] === 1;
  }

  /** A fresh view object, so the HUD knows to redraw. */
  view(base: MapView): MapView {
    return { ...base };
  }

  /** The HUD's map interface. */
  asWorldMap(): WorldMap {
    return this as unknown as WorldMap;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cz: number, meters: number, _view: MapView, opts: MapDrawOptions): void {
    const big = meters > 1000;
    // The corner map is a fixed window on the player; the full map shows the whole arena.
    const span = big ? this.half * 2 + 20 : MINI_METERS;
    const s = w / span;
    const centreX = big ? 0 : cx;
    const centreZ = big ? 0 : cz;
    const sx = (x: number) => (x - centreX) * s + w / 2;
    const sy = (z: number) => (z - centreZ) * s + h / 2;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0f09';
    ctx.fillRect(0, 0, w, h);
    const lo = (c: number) => Math.max(0, Math.floor((c - span / 2 + this.half) / CELL));
    const hi = (c: number) => Math.min(this.n - 1, Math.ceil((c + span / 2 + this.half) / CELL));
    for (let gz = lo(centreZ); gz <= hi(centreZ); gz++) {
      for (let gx = lo(centreX); gx <= hi(centreX); gx++) {
        if (!this.seen[gz * this.n + gx]) continue;
        const shade = 0x2f + ((gx * 7 + gz * 13) % 5) * 3;
        ctx.fillStyle = `rgb(${Math.round(shade * 0.55)},${shade + 24},${Math.round(shade * 0.5)})`;
        ctx.fillRect(sx(gx * CELL - this.half), sy(gz * CELL - this.half), CELL * s + 0.6, CELL * s + 0.6);
      }
    }
    const d = this.data;
    const dot = (x: number, z: number, r: number, color: string, stroke = '#000') => {
      ctx.beginPath();
      ctx.arc(sx(x), sy(z), r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    };
    const r = big ? 6 : 4;
    for (const t of d.towers) {
      if (!this.known(t.x, t.z)) continue;
      ctx.fillStyle = '#e8c070';
      ctx.beginPath();
      ctx.moveTo(sx(t.x), sy(t.z) - r * 1.4);
      ctx.lineTo(sx(t.x) + r * 1.2, sy(t.z) + r);
      ctx.lineTo(sx(t.x) - r * 1.2, sy(t.z) + r);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }
    for (const o of d.outposts) {
      if (!this.known(o.x, o.z)) continue;
      const half = r * 1.5;
      ctx.fillStyle = o.destroyed ? '#5fbf4a' : o.army === 'tan' ? '#c4a468' : '#3d6fc4';
      ctx.fillRect(sx(o.x) - half, sy(o.z) - half, half * 2, half * 2);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(o.x) - half, sy(o.z) - half, half * 2, half * 2);
      ctx.fillStyle = '#000';
      ctx.font = `900 ${half * 1.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.destroyed ? '✓' : '✕', sx(o.x), sy(o.z) + 1);
    }
    if (d.airbase && this.known(d.airbase.x, d.airbase.z)) {
      ctx.fillStyle = d.airbase.left > 0 ? '#8c9099' : '#5fbf4a';
      ctx.fillRect(sx(d.airbase.x) - r * 6, sy(d.airbase.z) - r * 0.8, r * 12, r * 1.6);
      ctx.fillStyle = '#000';
      ctx.font = `900 ${r * 1.7}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(d.airbase.left > 0 ? `✈ ${d.airbase.left}` : '✈ ✓', sx(d.airbase.x), sy(d.airbase.z) + 1);
    }
    for (const b of d.bombs) dot(b.x, b.z, r * 1.3, '#ff2a1a', '#fff');
    for (const e of d.enemies) dot(e.x, e.z, r * 0.75, '#ff5a4a');
    for (const f of d.squad) dot(f.x, f.z, r * 0.8, f.down ? '#7a8a70' : '#7be24a');
    // The player: an arrow pointing the way he faces (yaw 0 is north).
    ctx.save();
    ctx.translate(sx(d.player.x), sy(d.player.z));
    ctx.rotate(-d.player.yaw);
    const a = r * (opts.arrowScale > 1 ? 1.4 : 1.8);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -a * 1.3);
    ctx.lineTo(a, a);
    ctx.lineTo(0, a * 0.5);
    ctx.lineTo(-a, a);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
}
