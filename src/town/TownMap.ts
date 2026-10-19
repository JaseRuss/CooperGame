import type { WorldMap, MapView, MapDrawOptions } from '../ui/WorldMap';
import type { TownData, Pt } from './TownData';

/** How many metres across the little corner map shows. */
const MINI_METERS = 260;
/** Pixels per metre of the pre-drawn street map. */
const RES = 2;
const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'track']);

export interface TownMapData {
  players: { x: number; z: number; yaw: number; down: boolean }[];
  squad: { x: number; z: number; down: boolean }[];
  /** Enemies someone of ours can make out. */
  enemies: { x: number; z: number }[];
  roadblocks: { x: number; z: number; army: 'tan' | 'blue'; taken: boolean }[];
  school: { x: number; z: number; taken: boolean };
  /** The enemy's pens holding our squad. */
  pens: { x: number; z: number; freed: boolean }[];
}

/**
 * The town's map: the real street plan (every house, the roads with their names, gardens and
 * woods), with the way down the hill dotted on it, the enemy roadblocks and the school. The whole
 * town is known from the start; enemies show when one of ours is near enough to see them.
 */
export class TownMap {
  readonly data: TownMapData = { players: [], squad: [], enemies: [], roadblocks: [], school: { x: 0, z: 0, taken: false }, pens: [] };
  private readonly plan: HTMLCanvasElement;
  private readonly half: number;

  constructor(private readonly town: TownData) {
    this.half = town.half;
    this.plan = this.drawPlan();
  }

  asWorldMap(): WorldMap {
    return this as unknown as WorldMap;
  }

  private drawPlan(): HTMLCanvasElement {
    const t = this.town;
    const size = Math.round(this.half * 2 * RES);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const px = (p: Pt) => [(p.x + this.half) * RES, (p.z + this.half) * RES] as const;
    const path = (pts: Pt[], close: boolean) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
      if (close) ctx.closePath();
    };
    ctx.fillStyle = '#3e5a34';
    ctx.fillRect(0, 0, size, size);
    const fills: Record<string, string> = { wood: '#2c4526', garden: '#4a6a3c', grass: '#4d6e3d', pitch: '#4f7a3a', parking: '#5c5e60', playground: '#7a5040', water: '#2f6f9e', basin: '#4a6e3a', school: '#5e8a45', scrub: '#435e34', allotment: '#5e5634', court: '#5c5a56', astro: '#4f8a46', lawn: '#4f7a3a', yard: '#6a5e4c' };
    for (const a of t.areas) {
      path(a.pts, true);
      ctx.fillStyle = fills[a.kind] ?? '#4a6a3c';
      ctx.fill();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of t.roads) {
      path(r.pts, false);
      ctx.strokeStyle = FOOT.has(r.kind) ? '#8f8770' : '#d8d4c6';
      ctx.lineWidth = Math.max(1.5, (FOOT.has(r.kind) ? r.width * 0.8 : r.width + 1) * RES);
      ctx.stroke();
    }
    ctx.fillStyle = '#b9a58a';
    ctx.strokeStyle = '#6e604e';
    ctx.lineWidth = 1;
    for (const b of t.buildings) {
      path(b.pts, true);
      ctx.fill();
      ctx.stroke();
    }
    // The school grounds' edge.
    path(t.schoolGrounds, true);
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Street names, along the longest stretch of each street.
    const named = new Map<string, { a: Pt; b: Pt; len: number }>();
    for (const r of t.roads) {
      if (!r.name || FOOT.has(r.kind)) continue;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len > (named.get(r.name)?.len ?? 0)) named.set(r.name, { a, b, len });
      }
    }
    ctx.font = `700 ${7 * RES}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [name, s] of named) {
      if (s.len < 25) continue;
      const [x0, y0] = px(s.a), [x1, y1] = px(s.b);
      let ang = Math.atan2(y1 - y0, x1 - x0);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
      ctx.rotate(ang);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20,24,18,0.85)';
      ctx.strokeText(name, 0, 0);
      ctx.fillStyle = '#fff6d8';
      ctx.fillText(name, 0, 0);
      ctx.restore();
    }
    // The way down the hill.
    ctx.setLineDash([4 * RES, 4 * RES]);
    path(t.route, false);
    ctx.strokeStyle = 'rgba(255,210,74,0.9)';
    ctx.lineWidth = 1.6 * RES;
    ctx.stroke();
    ctx.setLineDash([]);
    return c;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cz: number, meters: number, _view: MapView, opts: MapDrawOptions): void {
    const big = meters > 1000;
    const span = big ? this.half * 2 + 20 : MINI_METERS;
    const s = w / span;
    const centreX = big ? 0 : cx;
    const centreZ = big ? 0 : cz;
    const sx = (x: number) => (x - centreX) * s + w / 2;
    const sy = (z: number) => (z - centreZ) * s + h / 2;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#26361f';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    // The pre-drawn plan, the part of it in view.
    const srcX = (centreX - span / 2 + this.half) * RES;
    const srcY = (centreZ - span / 2 + this.half) * RES;
    ctx.drawImage(this.plan, srcX, srcY, span * RES, span * RES, 0, 0, w, h);
    const d = this.data;
    const r = big ? 6 : 4;
    const dot = (x: number, z: number, rad: number, color: string, stroke = '#000') => {
      ctx.beginPath();
      ctx.arc(sx(x), sy(z), rad, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    };
    for (const o of d.roadblocks) {
      const half = r * 1.4;
      ctx.fillStyle = o.taken ? '#5fbf4a' : o.army === 'tan' ? '#c4a468' : '#3d6fc4';
      ctx.fillRect(sx(o.x) - half, sy(o.z) - half, half * 2, half * 2);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(o.x) - half, sy(o.z) - half, half * 2, half * 2);
      ctx.fillStyle = '#000';
      ctx.font = `900 ${half * 1.4}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.taken ? '✓' : '✕', sx(o.x), sy(o.z) + 1);
    }
    // The pens: a cage, yellow while our men are in it, green once they're free.
    for (const pn of d.pens) {
      const half = r * 1.5;
      const x0 = sx(pn.x) - half, y0 = sy(pn.z) - half;
      ctx.fillStyle = pn.freed ? 'rgba(95,191,74,0.85)' : 'rgba(255,210,74,0.9)';
      ctx.fillRect(x0, y0, half * 2, half * 2);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(x0, y0, half * 2, half * 2);
      ctx.lineWidth = 1.5;
      for (let k = 1; k < 4; k++) {
        ctx.beginPath();
        ctx.moveTo(x0 + (half * 2 * k) / 4, y0);
        ctx.lineTo(x0 + (half * 2 * k) / 4, y0 + half * 2);
        ctx.stroke();
      }
      if (big && opts.labels && !pn.freed) {
        ctx.font = '900 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeText('SQUAD HELD HERE', sx(pn.x), y0 - 6);
        ctx.fillStyle = '#ffd24a';
        ctx.fillText('SQUAD HELD HERE', sx(pn.x), y0 - 6);
      }
    }
    // The school: a star.
    const sc = d.school;
    ctx.save();
    ctx.translate(sx(sc.x), sy(sc.z));
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = (i % 2 ? 0.45 : 1) * r * 2.4;
      if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = sc.taken ? '#5fbf4a' : '#ffd24a';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    if (big && opts.labels) {
      ctx.font = '900 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText('MAURICEWOOD PRIMARY', sx(sc.x), sy(sc.z) + r * 4.4);
      ctx.fillStyle = '#ffd24a';
      ctx.fillText('MAURICEWOOD PRIMARY', sx(sc.x), sy(sc.z) + r * 4.4);
    }
    for (const e of d.enemies) dot(e.x, e.z, r * 0.75, '#ff5a4a');
    for (const f of d.squad) dot(f.x, f.z, r * 0.8, f.down ? '#7a8a70' : '#7be24a');
    // The players: arrows pointing the way they face (yaw 0 is north); the first is white, the second yellow.
    d.players.forEach((p, i) => {
      ctx.save();
      ctx.translate(sx(p.x), sy(p.z));
      ctx.rotate(-p.yaw);
      const a = r * (opts.arrowScale > 1 ? 1.4 : 1.8);
      ctx.fillStyle = p.down ? '#888' : i === 0 ? '#ffffff' : '#ffe14a';
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
    });
    ctx.restore();
  }
}
