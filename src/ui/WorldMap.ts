import { WORLD_SIZE, WORLD_HALF, TERRAIN_HEIGHT } from '../core/config';
import { heightAt } from '../world/Terrain';
import { ROAD_WIDTH, type Town } from '../world/TownPlan';
import { HIGHWAY_WIDTH, type Polyline } from '../world/RoadNetwork';
import {
  LAKES,
  SITES,
  siteLocalHalf,
  siteRectToWorld,
  APRON,
  AIRPORT_ACCESS_X,
  MALL_LOT_BACK_Z,
  SITE_ROAD_WIDTH,
  enemyArmyOfSite,
} from '../world/Landmarks';

export interface MapHouse {
  x: number;
  z: number;
  hx: number;
  hz: number;
  destroyed: () => boolean;
}

export type MarkerKind = 'tank' | 'troop' | 'bunker' | 'helicopter';

export interface MapMarker {
  x: number;
  z: number;
  kind: MarkerKind;
  /** On the player's side (red army, green garrisons), drawn in green. */
  friendly: boolean;
}

export interface MapBase {
  x: number;
  z: number;
  name: string;
}

export interface MapView {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  friendlyBases: MapBase[];
  /** 	itle is the full label, e.g. "Blue Army Base Bravo". */
  enemyBases: (MapBase & { destroyed: boolean; title: string })[];
  buddies: { x: number; z: number; name: string }[];
  markers: MapMarker[];
  /** Nearest enemy base still standing (or the Fortress once they're all down); the minimap points at it. */
  objective: MapBase | null;
  /** `friendly`: on the zombie mission it's everyone's stronghold. */
  fortress: MapBase & { title: string; locked: boolean; destroyed: boolean; friendly: boolean };
  /** Changing stations that turn the tank into a jeep or a chopper. */
  stations: { x: number; z: number; kind: 'jeep' | 'chopper' }[];
}

export interface MapDrawOptions {
  /** Size multiplier for the player arrow (bigger on the full-screen map). */
  arrowScale: number;
  /** Write base names next to their icons. */
  labels: boolean;
  /** Draw an arrow on the rim of a round map pointing at `view.objective` when it's out of view. */
  rimPointer: boolean;
  /** Show enemies as a heatmap of where they're gathered instead of individual dots. */
  heatmap: boolean;
}

const LAYER_SIZE = 1024;
const TERRAIN_SAMPLES = 192;
const HEAT_GRID = 128; // cells per side (~23m each)
const HEAT_SPREAD = 1.7; // Gaussian sigma, in cells
const HEAT_REACH = 5; // cells either side that a unit warms
const HEAT_WEIGHT: Record<MarkerKind, number> = { tank: 3, bunker: 2, troop: 0.7, helicopter: 3 };
/** Heat at which the colour peaks at full red. */
const HEAT_FULL = 5;

/** Top-down map of the world: a pre-rendered static layer plus live houses, markers and player. */
export class WorldMap {
  private readonly layer: HTMLCanvasElement;
  private readonly heatCanvas: HTMLCanvasElement;
  private readonly heatImage: ImageData;
  private readonly heat = new Float32Array(HEAT_GRID * HEAT_GRID);

  constructor(
    highways: Polyline[],
    towns: Town[],
    private readonly houses: MapHouse[],
    forests: { x: number; z: number; radius: number }[],
  ) {
    this.heatCanvas = document.createElement('canvas');
    this.heatCanvas.width = HEAT_GRID;
    this.heatCanvas.height = HEAT_GRID;
    this.heatImage = new ImageData(HEAT_GRID, HEAT_GRID);

    this.layer = document.createElement('canvas');
    this.layer.width = LAYER_SIZE;
    this.layer.height = LAYER_SIZE;
    const ctx = this.layer.getContext('2d') as CanvasRenderingContext2D;
    const px = LAYER_SIZE / WORLD_SIZE;
    ctx.setTransform(px, 0, 0, px, LAYER_SIZE / 2, LAYER_SIZE / 2);

    const cell = WORLD_SIZE / TERRAIN_SAMPLES;
    for (let iz = 0; iz < TERRAIN_SAMPLES; iz++) {
      for (let ix = 0; ix < TERRAIN_SAMPLES; ix++) {
        const x = -WORLD_HALF + (ix + 0.5) * cell;
        const z = -WORLD_HALF + (iz + 0.5) * cell;
        const t = Math.max(0, Math.min(1, (heightAt(x, z) / TERRAIN_HEIGHT + 1) / 2));
        const g = Math.round(95 + t * 60);
        ctx.fillStyle = `rgb(${Math.round(55 + t * 50)},${g},${Math.round(45 + t * 20)})`;
        ctx.fillRect(x - cell / 2, z - cell / 2, cell + 1, cell + 1);
      }
    }

    // Forests: dark green patches with a softer rim.
    for (const f of forests) {
      const grad = ctx.createRadialGradient(f.x, f.z, f.radius * 0.3, f.x, f.z, f.radius);
      grad.addColorStop(0, 'rgba(38,78,34,0.95)');
      grad.addColorStop(0.8, 'rgba(44,88,38,0.85)');
      grad.addColorStop(1, 'rgba(50,95,42,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.z, f.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#2f3237';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = HIGHWAY_WIDTH * 1.4;
    for (const road of highways) {
      ctx.beginPath();
      road.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }

    ctx.fillStyle = '#4a93d6';
    for (const lake of LAKES) {
      ctx.beginPath();
      ctx.arc(lake.cx, lake.cz, lake.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#3a3d42';
    for (const site of SITES) {
      const half = siteLocalHalf(site);
      const runwayLen = half.x * 2 - 40;
      const apronFront = APRON.z + APRON.halfZ;
      const serviceLen = half.x - APRON.halfX;
      if (site.kind === 'fortress') {
        // Tan west half, blue east half, heavy walls.
        ctx.fillStyle = '#9c8a62';
        ctx.fillRect(site.cx - site.halfX, site.cz - site.halfZ, site.halfX, site.halfZ * 2);
        ctx.fillStyle = '#62769c';
        ctx.fillRect(site.cx, site.cz - site.halfZ, site.halfX, site.halfZ * 2);
        ctx.strokeStyle = '#3a3528';
        ctx.lineWidth = 9;
        ctx.strokeRect(site.cx - site.halfX + 8, site.cz - site.halfZ + 8, site.halfX * 2 - 16, site.halfZ * 2 - 16);
        ctx.fillStyle = '#3a3d42';
        continue;
      }
      if (site.kind === 'enemyBase') {
        const blue = enemyArmyOfSite(site) === 'blue';
        ctx.fillStyle = blue ? '#5f7396' : '#8a7d5c';
        ctx.fillRect(site.cx - site.halfX, site.cz - site.halfZ, site.halfX * 2, site.halfZ * 2);
        ctx.strokeStyle = blue ? '#2a3a5a' : '#5a4a2a';
        ctx.lineWidth = 4;
        ctx.strokeRect(site.cx - site.halfX, site.cz - site.halfZ, site.halfX * 2, site.halfZ * 2);
        ctx.fillStyle = '#3a3d42';
        continue;
      }
      const rects =
        site.kind === 'mall'
          ? [siteRectToWorld(site, 0, (half.z + MALL_LOT_BACK_Z) / 2, half.x, (half.z - MALL_LOT_BACK_Z) / 2)]
          : [
              siteRectToWorld(site, 0, -70, runwayLen / 2, 20),
              siteRectToWorld(site, 0, -10, runwayLen / 2 - 60, 8),
              siteRectToWorld(site, 0, APRON.z, APRON.halfX, APRON.halfZ),
              siteRectToWorld(site, AIRPORT_ACCESS_X, (half.z + apronFront) / 2, SITE_ROAD_WIDTH / 2, (half.z - apronFront) / 2),
              siteRectToWorld(site, -(APRON.halfX + serviceLen / 2), APRON.z, serviceLen / 2, SITE_ROAD_WIDTH / 2),
              siteRectToWorld(site, APRON.halfX + serviceLen / 2, APRON.z, serviceLen / 2, SITE_ROAD_WIDTH / 2),
            ];
      for (const r of rects) ctx.fillRect(r.cx - r.halfX, r.cz - r.halfZ, r.halfX * 2, r.halfZ * 2);
    }

    ctx.fillStyle = '#2f3237';
    for (const town of towns) {
      for (const r of town.roads) {
        const w = r.alongX ? r.length : ROAD_WIDTH * 1.4;
        const d = r.alongX ? ROAD_WIDTH * 1.4 : r.length;
        ctx.fillRect(r.x - w / 2, r.z - d / 2, w, d);
      }
    }
  }

  /**
   * Draws the map into `ctx` (a width x height canvas) centered on (cx, cz), showing
   * `metersAcross` meters horizontally.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cx: number,
    cz: number,
    metersAcross: number,
    view: MapView,
    opts: MapDrawOptions,
  ): void {
    const s = width / metersAcross;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#35502f';
    ctx.fillRect(0, 0, width, height);

    ctx.setTransform(s, 0, 0, s, width / 2 - cx * s, height / 2 - cz * s);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.layer, -WORLD_HALF, -WORLD_HALF, WORLD_SIZE, WORLD_SIZE);

    const minPx = 2.5 / s; // keep tiny things visible when zoomed out
    for (const h of this.houses) {
      const destroyed = h.destroyed();
      ctx.fillStyle = destroyed ? 'rgba(40,40,40,0.55)' : '#d9d2c3';
      const hx = Math.max(h.hx, minPx);
      const hz = Math.max(h.hz, minPx);
      ctx.fillRect(h.x - hx, h.z - hz, hx * 2, hz * 2);
    }

    if (opts.heatmap) this.drawHeatmap(ctx, view.markers);

    // Family bases: yellow rings.
    ctx.strokeStyle = '#ffcc33';
    ctx.lineWidth = 3 / s;
    for (const b of view.friendlyBases) {
      ctx.beginPath();
      ctx.arc(b.x, b.z, Math.max(40, 7 / s), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Changing stations: a blue tile with a J for the jeep, an orange disc with an H for the chopper.
    for (const st of view.stations) {
      const r = Math.max(14, 6 / s);
      const jeep = st.kind === 'jeep';
      ctx.fillStyle = jeep ? '#2fb8ff' : '#ff9a2f';
      ctx.strokeStyle = jeep ? '#0b2533' : '#331a05';
      ctx.lineWidth = 2 / s;
      ctx.beginPath();
      if (jeep) ctx.rect(st.x - r, st.z - r, r * 2, r * 2);
      else ctx.arc(st.x, st.z, r * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${r * 1.6}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(jeep ? 'J' : 'H', st.x, st.z + r * 0.1);
    }

    // Enemy bases: red squares (green tick once destroyed).
    for (const b of view.enemyBases) {
      const r = Math.max(30, 7 / s);
      ctx.fillStyle = b.destroyed ? 'rgba(80,160,80,0.85)' : 'rgba(210,60,50,0.85)';
      ctx.fillRect(b.x - r, b.z - r, r * 2, r * 2);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2 / s;
      ctx.strokeRect(b.x - r, b.z - r, r * 2, r * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 / s;
      ctx.beginPath();
      if (b.destroyed) {
        ctx.moveTo(b.x - r * 0.5, b.z);
        ctx.lineTo(b.x - r * 0.1, b.z + r * 0.45);
        ctx.lineTo(b.x + r * 0.55, b.z - r * 0.45);
      } else {
        ctx.moveTo(b.x - r * 0.5, b.z - r * 0.5);
        ctx.lineTo(b.x + r * 0.5, b.z + r * 0.5);
        ctx.moveTo(b.x + r * 0.5, b.z - r * 0.5);
        ctx.lineTo(b.x - r * 0.5, b.z + r * 0.5);
      }
      ctx.stroke();
    }

    // The Fortress: padlock while locked, red cross once open, tick when it falls.
    {
      const fz = view.fortress;
      const r = Math.max(40, 9 / s);
      ctx.lineWidth = 3.5 / s;
      ctx.strokeStyle = fz.destroyed || fz.friendly ? '#9be27a' : fz.locked ? '#d8d2bd' : '#ff5a4a';
      ctx.beginPath();
      if (fz.friendly) {
        // A green shield: ours to defend.
        ctx.moveTo(fz.x - r * 0.5, fz.z - r * 0.5);
        ctx.lineTo(fz.x + r * 0.5, fz.z - r * 0.5);
        ctx.lineTo(fz.x + r * 0.5, fz.z);
        ctx.quadraticCurveTo(fz.x + r * 0.45, fz.z + r * 0.45, fz.x, fz.z + r * 0.65);
        ctx.quadraticCurveTo(fz.x - r * 0.45, fz.z + r * 0.45, fz.x - r * 0.5, fz.z);
        ctx.closePath();
      } else if (fz.destroyed) {
        ctx.moveTo(fz.x - r * 0.5, fz.z);
        ctx.lineTo(fz.x - r * 0.1, fz.z + r * 0.45);
        ctx.lineTo(fz.x + r * 0.55, fz.z - r * 0.45);
      } else if (fz.locked) {
        ctx.arc(fz.x, fz.z - r * 0.15, r * 0.3, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = '#d9a520';
        ctx.fillRect(fz.x - r * 0.45, fz.z - r * 0.15, r * 0.9, r * 0.7);
        ctx.beginPath();
      } else {
        ctx.moveTo(fz.x - r * 0.5, fz.z - r * 0.5);
        ctx.lineTo(fz.x + r * 0.5, fz.z + r * 0.5);
        ctx.moveTo(fz.x + r * 0.5, fz.z - r * 0.5);
        ctx.lineTo(fz.x - r * 0.5, fz.z + r * 0.5);
      }
      ctx.stroke();
    }

    for (const m of view.markers) {
      // Keep aircraft directly marked on the full map as well as in the enemy heatmap.
      if (opts.heatmap && !m.friendly && m.kind !== 'helicopter') continue;
      if (m.kind === 'helicopter') {
        const r = 11 / s;
        ctx.save();
        ctx.translate(m.x, m.z);
        ctx.fillStyle = '#ff75d8';
        ctx.strokeStyle = '#24152b';
        ctx.lineWidth = 2.5 / s;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Rotor and tail make this distinct from the round tank and troop markers.
        ctx.lineWidth = 2.5 / s;
        ctx.beginPath();
        ctx.moveTo(-r * 0.55, 0);
        ctx.lineTo(r * 0.55, 0);
        ctx.moveTo(r * 0.45, 0);
        ctx.lineTo(r, -r * 0.45);
        ctx.moveTo(-r * 0.7, -r * 0.6);
        ctx.lineTo(r * 0.3, -r * 0.6);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (m.kind === 'bunker') {
        const r = 5 / s;
        ctx.fillStyle = m.friendly ? '#6fbf4a' : '#c0843a';
        ctx.fillRect(m.x - r, m.z - r, r * 2, r * 2);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1 / s;
        ctx.strokeRect(m.x - r, m.z - r, r * 2, r * 2);
      } else {
        if (m.friendly) ctx.fillStyle = m.kind === 'tank' ? '#b8f59a' : '#d8f7c4';
        else ctx.fillStyle = m.kind === 'tank' ? '#e0523f' : '#f0a040';
        ctx.beginPath();
        ctx.arc(m.x, m.z, (m.kind === 'tank' ? 4.5 : 2.5) / s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const b of view.buddies) {
      ctx.fillStyle = '#9be27a';
      ctx.strokeStyle = '#0d2a0d';
      ctx.lineWidth = 1.2 / s;
      ctx.beginPath();
      ctx.arc(b.x, b.z, 5 / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Everything below is in screen pixels so it stays readable at any zoom.
    const toScreen = (x: number, z: number) => [width / 2 + (x - cx) * s, height / 2 + (z - cz) * s] as const;

    if (opts.labels) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const label = (x: number, z: number, text: string, color: string) => {
        const [lx, lz] = toScreen(x, z);
        ctx.fillStyle = color;
        ctx.strokeText(text, lx, lz - 16);
        ctx.fillText(text, lx, lz - 16);
      };
      for (const b of view.friendlyBases) label(b.x, b.z, b.name, '#ffe07a');
      for (const b of view.enemyBases) label(b.x, b.z, `${b.title}${b.destroyed ? ' ✓' : ''}`, b.destroyed ? '#9be27a' : '#ff8a7a');
      const fz = view.fortress;
      label(
        fz.x,
        fz.z - 50,
        fz.friendly ? `${fz.title}: defend it!` : `${fz.title}${fz.destroyed ? ' ✓' : fz.locked ? ' (locked)' : ''}`,
        fz.destroyed || fz.friendly ? '#9be27a' : fz.locked ? '#e8d9a4' : '#ff8a7a',
      );
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
      for (const b of view.buddies) label(b.x, b.z + 2 / s, b.name, '#c8f5a8');
    }

    if (opts.rimPointer && view.objective) this.drawRimPointer(ctx, width, height, toScreen(view.objective.x, view.objective.z), view);

    // Player arrow.
    const [px, pz] = toScreen(view.playerX, view.playerZ);
    const k = opts.arrowScale;
    ctx.setTransform(k, 0, 0, k, px, pz);
    ctx.rotate(-view.playerYaw);
    ctx.fillStyle = '#5fe05f';
    ctx.strokeStyle = '#0d2a0d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * Splats every enemy onto a coarse grid with a soft falloff and draws it as a yellow-to-red glow,
   * so the pause map shows where the enemy is gathered rather than hundreds of dots.
   * Expects `ctx` to be in world coordinates.
   */
  private drawHeatmap(ctx: CanvasRenderingContext2D, markers: MapMarker[]): void {
    const heat = this.heat;
    heat.fill(0);
    const cell = WORLD_SIZE / HEAT_GRID;
    const falloff = 1 / (2 * HEAT_SPREAD * HEAT_SPREAD);
    for (const m of markers) {
      if (m.friendly) continue;
      const gx = (m.x + WORLD_HALF) / cell;
      const gz = (m.z + WORLD_HALF) / cell;
      const w = HEAT_WEIGHT[m.kind];
      const x0 = Math.max(0, Math.floor(gx) - HEAT_REACH);
      const x1 = Math.min(HEAT_GRID - 1, Math.floor(gx) + HEAT_REACH);
      const z0 = Math.max(0, Math.floor(gz) - HEAT_REACH);
      const z1 = Math.min(HEAT_GRID - 1, Math.floor(gz) + HEAT_REACH);
      for (let iz = z0; iz <= z1; iz++) {
        const dz = iz + 0.5 - gz;
        for (let ix = x0; ix <= x1; ix++) {
          const dx = ix + 0.5 - gx;
          heat[ix + iz * HEAT_GRID] += w * Math.exp(-(dx * dx + dz * dz) * falloff);
        }
      }
    }

    const px = this.heatImage.data;
    for (let i = 0; i < heat.length; i++) {
      const t = Math.min(1, heat[i] / HEAT_FULL);
      px[i * 4] = 255 - 35 * t;
      px[i * 4 + 1] = 225 - 195 * t; // yellow → red as it gets hotter
      px[i * 4 + 2] = 70 - 50 * t;
      px[i * 4 + 3] = heat[i] < 0.15 ? 0 : 255 * Math.min(0.85, 0.08 + 0.8 * Math.pow(t, 0.8));
    }
    (this.heatCanvas.getContext('2d') as CanvasRenderingContext2D).putImageData(this.heatImage, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.heatCanvas, -WORLD_HALF, -WORLD_HALF, WORLD_SIZE, WORLD_SIZE);
  }

  /**
   * On a round minimap: when the objective is off the edge, a red arrow on the rim points at it
   * with the distance; when it's on the map, a pulsing ring marks it.
   */
  private drawRimPointer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    [tx, tz]: readonly [number, number],
    view: MapView,
  ): void {
    const cx = width / 2;
    const cz = height / 2;
    const dx = tx - cx;
    const dz = tz - cz;
    const r = Math.min(width, height) / 2 - 12;
    const dist = view.objective ? Math.round(Math.hypot(view.objective.x - view.playerX, view.objective.z - view.playerZ)) : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (Math.hypot(dx, dz) < r) {
      const pulse = 8 + 4 * Math.sin(performance.now() / 200);
      ctx.strokeStyle = '#ff5a4a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(tx, tz, pulse, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    const a = Math.atan2(dz, dx);
    const ax = cx + Math.cos(a) * r;
    const az = cz + Math.sin(a) * r;
    ctx.setTransform(1, 0, 0, 1, ax, az);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = '#ff5a4a';
    ctx.strokeStyle = '#2a0a0a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(8, 6);
    ctx.lineTo(-8, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const lx = cx + Math.cos(a) * (r - 22);
    const lz = cz + Math.sin(a) * (r - 22);
    ctx.font = '800 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = '#ffd0c8';
    const text = dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${dist}m`;
    ctx.strokeText(text, lx, lz);
    ctx.fillText(text, lx, lz);
    ctx.textBaseline = 'alphabetic';
  }
}
