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
} from '../world/Landmarks';

export interface MapHouse {
  x: number;
  z: number;
  hx: number;
  hz: number;
  destroyed: () => boolean;
}

export type MarkerKind = 'tank' | 'troop' | 'bunker';

export interface MapMarker {
  x: number;
  z: number;
  kind: MarkerKind;
}

export interface MapView {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  baseX: number;
  baseZ: number;
  markers: MapMarker[];
}

const LAYER_SIZE = 1024;
const TERRAIN_SAMPLES = 192;

/** Top-down map of the world: a pre-rendered static layer plus live houses, markers and player. */
export class WorldMap {
  private readonly layer: HTMLCanvasElement;

  constructor(
    highways: Polyline[],
    towns: Town[],
    private readonly houses: MapHouse[],
  ) {
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
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, cx: number, cz: number, metersAcross: number, view: MapView): void {
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

    ctx.strokeStyle = '#ffcc33';
    ctx.lineWidth = 3 / s;
    ctx.beginPath();
    ctx.arc(view.baseX, view.baseZ, Math.max(40, 7 / s), 0, Math.PI * 2);
    ctx.stroke();

    for (const m of view.markers) {
      if (m.kind === 'bunker') {
        const r = 5 / s;
        ctx.fillStyle = '#c0843a';
        ctx.fillRect(m.x - r, m.z - r, r * 2, r * 2);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1 / s;
        ctx.strokeRect(m.x - r, m.z - r, r * 2, r * 2);
      } else {
        ctx.fillStyle = m.kind === 'tank' ? '#e0523f' : '#f0a040';
        ctx.beginPath();
        ctx.arc(m.x, m.z, (m.kind === 'tank' ? 4.5 : 2.5) / s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player arrow in screen space so it stays a constant size.
    const px = width / 2 + (view.playerX - cx) * s;
    const pz = height / 2 + (view.playerZ - cz) * s;
    ctx.setTransform(1, 0, 0, 1, px, pz);
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
}
