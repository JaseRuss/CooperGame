import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../utils/rng';
import { TOWNS, distanceToTown } from './TownPlan';
import { SITES, LAKES, distanceToSite } from './Landmarks';
import {
  WORLD_SIZE,
  TERRAIN_SEGMENTS,
  TERRAIN_HEIGHT,
  WORLD_SEED,
  FRIENDLY_BASES,
  BASE_RADIUS,
} from '../core/config';

const noise2D = createNoise2D(mulberry32(WORLD_SEED));

function fbm(x: number, z: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < 4; i++) {
    sum += noise2D(x * freq, z * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / max;
}

function rawHeight(x: number, z: number): number {
  const scale = 1 / 650;
  return fbm(x * scale, z * scale) * TERRAIN_HEIGHT;
}

const TOWN_BLEND = 70;
const SITE_BLEND = 90;
const LAKE_DEPTH = 6;
const SHORE_BLEND = 40;
const BASE_FLAT_RADIUS = BASE_RADIUS + 35;
const BASE_BLEND = 70;
const townHeights = TOWNS.map((t) => rawHeight(t.cx, t.cz));
const baseHeights = FRIENDLY_BASES.map((b) => rawHeight(b.x, b.z));
const siteHeights = SITES.map((s) => rawHeight(s.cx, s.cz));

/** Lake surface heights: a little below the lowest ground around each lake so water never spills. */
export const LAKE_LEVELS = LAKES.map((l) => {
  let lowest = rawHeight(l.cx, l.cz);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    lowest = Math.min(lowest, rawHeight(l.cx + Math.cos(a) * (l.radius + 25), l.cz + Math.sin(a) * (l.radius + 25)));
  }
  return lowest - 0.8;
});

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** World-space terrain height (meters) at (x, z): flattened under towns/sites/base, carved for lakes. */
export function heightAt(x: number, z: number): number {
  let h = rawHeight(x, z);

  for (let i = 0; i < TOWNS.length; i++) {
    const d = distanceToTown(TOWNS[i], x, z);
    if (d < TOWN_BLEND) {
      const s = smoothstep(d / TOWN_BLEND);
      h = townHeights[i] * (1 - s) + h * s;
    }
  }

  for (let i = 0; i < SITES.length; i++) {
    const d = distanceToSite(SITES[i], x, z);
    if (d < SITE_BLEND) {
      const s = smoothstep(d / SITE_BLEND);
      h = siteHeights[i] * (1 - s) + h * s;
    }
  }

  for (let i = 0; i < LAKES.length; i++) {
    const lake = LAKES[i];
    const level = LAKE_LEVELS[i];
    const d = Math.hypot(x - lake.cx, z - lake.cz);
    const beach = level + 0.3;
    if (d < lake.radius) {
      const t = d / lake.radius;
      h = beach - (LAKE_DEPTH + 0.3) * (1 - t * t);
    } else if (d < lake.radius + SHORE_BLEND) {
      const s = smoothstep((d - lake.radius) / SHORE_BLEND);
      h = beach * (1 - s) + Math.max(h, beach) * s;
    }
  }

  // Family bases sit on a dead-level plateau (pad, wall, towers and keepsake), then blend out.
  for (let i = 0; i < FRIENDLY_BASES.length; i++) {
    const base = FRIENDLY_BASES[i];
    const d = Math.hypot(x - base.x, z - base.z);
    if (d < BASE_FLAT_RADIUS + BASE_BLEND) {
      const s = smoothstep(Math.max(0, d - BASE_FLAT_RADIUS) / BASE_BLEND);
      h = baseHeights[i] * (1 - s) + h * s;
    }
  }

  return h;
}

/** How deep the water is at (x, z) (0 when dry). */
export function waterDepthAt(x: number, z: number): number {
  for (let i = 0; i < LAKES.length; i++) {
    const lake = LAKES[i];
    if (Math.hypot(x - lake.cx, z - lake.cz) < lake.radius + 2) {
      return Math.max(0, LAKE_LEVELS[i] - heightAt(x, z));
    }
  }
  return 0;
}

/** True when a world point is below a lake's surface (e.g. a shell landing in the shallows). */
export function isUnderwater(x: number, y: number, z: number): boolean {
  for (let i = 0; i < LAKES.length; i++) {
    const lake = LAKES[i];
    if (Math.hypot(x - lake.cx, z - lake.cz) < lake.radius + 2 && y < LAKE_LEVELS[i] + 0.05) return true;
  }
  return false;
}

/** 0 = dry land, 1 = sandy shore, 2 = lake bed. Used to tint the terrain. */
function shoreKind(x: number, z: number): number {
  for (const lake of LAKES) {
    const d = Math.hypot(x - lake.cx, z - lake.cz);
    if (d < lake.radius - 6) return 2;
    if (d < lake.radius + 12) return 1;
  }
  return 0;
}

let gridHeights: Float32Array | null = null;
const CELL = WORLD_SIZE / TERRAIN_SEGMENTS;

function gridHeight(ix: number, iz: number): number {
  if (!gridHeights) {
    const n = TERRAIN_SEGMENTS + 1;
    gridHeights = new Float32Array(n * n);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) gridHeights[x + z * n] = heightAt(-WORLD_SIZE / 2 + x * CELL, -WORLD_SIZE / 2 + z * CELL);
    }
  }
  return gridHeights[ix + iz * (TERRAIN_SEGMENTS + 1)];
}

/**
 * Height of the rendered terrain mesh at (x, z): heightAt sampled on the mesh grid and
 * interpolated across the same two triangles per cell that THREE.PlaneGeometry uses.
 */
export function surfaceHeightAt(x: number, z: number): number {
  const fx = Math.min(Math.max((x + WORLD_SIZE / 2) / CELL, 0), TERRAIN_SEGMENTS - 1e-6);
  const fz = Math.min(Math.max((z + WORLD_SIZE / 2) / CELL, 0), TERRAIN_SEGMENTS - 1e-6);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fz - iz;
  const ha = gridHeight(ix, iz);
  const hb = gridHeight(ix, iz + 1);
  const hc = gridHeight(ix + 1, iz + 1);
  const hd = gridHeight(ix + 1, iz);
  if (u + v <= 1) return ha + (hd - ha) * u + (hb - ha) * v;
  return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
}

export interface TerrainBuild {
  mesh: THREE.Mesh;
  colliderDesc: RAPIER.ColliderDesc;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function buildTerrain(): TerrainBuild {
  const segments = TERRAIN_SEGMENTS;
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  // Light, sunny "playmat" greens so the darker army-green plastic stands out.
  const grass = new THREE.Color('#8dbb55');
  const grassHigh = new THREE.Color('#b2c26a');
  const dirt = new THREE.Color('#bda673');
  const sand = new THREE.Color('#e3d29a');
  const lakeBed = new THREE.Color('#8a8a5c');
  const tmp = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const h = heightAt(x, z);
    position.setY(i, h);

    const t = clamp01(h / TERRAIN_HEIGHT);
    const shore = shoreKind(x, z);
    if (shore === 1) {
      tmp.copy(sand);
    } else if (shore === 2) {
      tmp.copy(lakeBed);
    } else if (t > 0.6) {
      tmp.copy(grassHigh).lerp(dirt, (t - 0.6) / 0.4);
    } else {
      tmp.copy(grass).lerp(grassHigh, t / 0.6);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // Rapier heightfield: centered on the origin, column-major, rows run along Z and columns along X.
  const rows = segments;
  const cols = segments;
  const heights = new Float32Array((rows + 1) * (cols + 1));
  for (let col = 0; col <= cols; col++) {
    for (let row = 0; row <= rows; row++) {
      const x = (col / cols - 0.5) * WORLD_SIZE;
      const z = (row / rows - 0.5) * WORLD_SIZE;
      heights[row + col * (rows + 1)] = heightAt(x, z);
    }
  }

  const colliderDesc = RAPIER.ColliderDesc.heightfield(rows, cols, heights, {
    x: WORLD_SIZE,
    y: 1,
    z: WORLD_SIZE,
  });

  return { mesh, colliderDesc };
}
