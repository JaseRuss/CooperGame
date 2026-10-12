import * as THREE from 'three';
import type { WorldMap, MapView, MapDrawOptions } from '../ui/WorldMap';
import { PLAY_HALF } from './MoonTerrain';

/** How many metres across the little corner map shows. */
const MINI_METERS = 300;

export interface MoonMapData {
  player: { x: number; z: number; yaw: number };
  /** The base's middle, and the armies' camps: where they are, their colour, whether they're built, how many crates they have. */
  base: { x: number; z: number };
  camps: { x: number; z: number; color: number; built: boolean; delivered: number; need: number }[];
  crates: { x: number; z: number; color: number }[];
}

/**
 * The Moon map: grey ground, the dirt roads, the main base and each army's camp (a flag until it's
 * built, then a dome), crates that have fallen off, and the buggy. It's drawn through the HUD's own
 * map slots, standing in for the tank game's world map.
 */
export class MoonMap {
  readonly data: MoonMapData = { player: { x: 0, z: 0, yaw: 0 }, base: { x: 0, z: -20 }, camps: [], crates: [] };

  constructor(private readonly roads: THREE.Vector2[][]) {}

  /** A fresh view object, so the HUD knows to redraw. */
  view(base: MapView): MapView {
    return { ...base };
  }

  asWorldMap(): WorldMap {
    return this as unknown as WorldMap;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cz: number, meters: number, _view: MapView, opts: MapDrawOptions): void {
    const big = meters > 1000;
    const span = big ? PLAY_HALF * 2 + 40 : MINI_METERS;
    const s = w / span;
    const centreX = big ? 0 : cx;
    const centreZ = big ? 0 : cz;
    const sx = (x: number) => (x - centreX) * s + w / 2;
    const sy = (z: number) => (z - centreZ) * s + h / 2;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#2a2b2e';
    ctx.fillRect(0, 0, w, h);
    // The plain's edge.
    ctx.fillStyle = '#4a4a4c';
    ctx.fillRect(sx(-PLAY_HALF), sy(-PLAY_HALF), PLAY_HALF * 2 * s, PLAY_HALF * 2 * s);
    // Dirt roads.
    ctx.strokeStyle = '#b09a6a';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.8, 7 * s);
    for (const path of this.roads) {
      ctx.beginPath();
      path.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.y)) : ctx.moveTo(sx(p.x), sy(p.y))));
      ctx.stroke();
    }
    const d = this.data;
    const r = big ? 7 : 5;
    // The main base: a white dome.
    ctx.beginPath();
    ctx.arc(sx(d.base.x), sy(d.base.z), r * 1.9, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = '#eeebe3';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (opts.labels) {
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(r * 1.7)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('MAIN BASE', sx(d.base.x), sy(d.base.z) + r * 3.4);
    }
    for (const c of d.camps) {
      const hex = `#${new THREE.Color(c.color).getHexString()}`;
      ctx.beginPath();
      if (c.built) {
        ctx.arc(sx(c.x), sy(c.z), r * 1.7, Math.PI, 0);
        ctx.closePath();
      } else ctx.rect(sx(c.x) - r * 1.2, sy(c.z) - r * 1.2, r * 2.4, r * 2.4);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(r * 1.7)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.built ? '✓' : `${c.delivered}/${c.need}`, sx(c.x), sy(c.z) + (c.built ? -r * 0.5 : 0));
    }
    for (const c of d.crates) {
      ctx.fillStyle = `#${new THREE.Color(c.color).getHexString()}`;
      ctx.fillRect(sx(c.x) - r * 0.5, sy(c.z) - r * 0.5, r, r);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(sx(c.x) - r * 0.5, sy(c.z) - r * 0.5, r, r);
    }
    // The buggy: an arrow pointing the way it faces (yaw 0 is south, down the screen).
    ctx.save();
    ctx.translate(sx(d.player.x), sy(d.player.z));
    ctx.rotate(Math.PI - d.player.yaw);
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
