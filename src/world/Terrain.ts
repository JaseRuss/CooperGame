import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../utils/rng';
import { PRISON } from '../core/config';
import { TOWNS, distanceToTown } from './TownPlan';
import { SITES, LAKES, distanceToSite } from './Landmarks';
import { inMoat, moatDig, moatLevelling, MOAT_DEPTH, MOAT_WATER_DROP } from './MoatShape';
import {
  WORLD_SIZE,
  TERRAIN_SEGMENTS,
  TERRAIN_HEIGHT,
  WORLD_SEED,
  FRIENDLY_BASES,
  BASE_RADIUS,
  JUNGLE,
  KNIGHTS,
  ZOMBIES,
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
const fortressHeight = siteHeights[SITES.findIndex((s) => s.kind === 'fortress')] ?? 0;
/** The moat's water surface: a little below the Fortress's ground. */
export const MOAT_LEVEL = fortressHeight - MOAT_WATER_DROP;

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

interface JumpHill {
  x: number;
  z: number;
  height: number;
  spread: number;
}

/** How far a hill's slope reaches past its middle, in multiples of its spread (beyond that it adds under 4% of its height). */
const HILL_REACH = 2.6;

/**
 * Broad, steep-sided natural mounds seeded per mission, placed clear of bases, towns, sites and
 * lakes. The clearance is measured from the edge of each town and site (not its middle, which
 * let hills rise through the airport's runways) and allows for the hill's own slopes.
 */
const JUMP_HILLS: JumpHill[] = (() => {
  const rng = mulberry32(WORLD_SEED ^ 0x4a554d50);
  const hills: JumpHill[] = [];
  for (let tries = 0; tries < 3000 && hills.length < 28; tries++) {
    const x = (rng() * 2 - 1) * (WORLD_SIZE / 2 - 220);
    const z = (rng() * 2 - 1) * (WORLD_SIZE / 2 - 220);
    const height = 11 + rng() * 7;
    const spread = 32 + rng() * 15;
    const reach = spread * HILL_REACH + 15;
    if (FRIENDLY_BASES.some((b) => Math.hypot(x - b.x, z - b.z) < 240)) continue;
    if (TOWNS.some((t) => distanceToTown(t, x, z) < reach)) continue;
    if (SITES.some((s) => distanceToSite(s, x, z) < reach)) continue;
    if (LAKES.some((l) => Math.hypot(x - l.cx, z - l.cz) < l.radius + 110)) continue;
    if (hills.some((h) => Math.hypot(x - h.x, z - h.z) < 150)) continue;
    hills.push({ x, z, height, spread });
  }
  return hills;
})();

/** World-space terrain height (meters) at (x, z): flattened under towns/sites/base, carved for lakes. */
export function heightAt(x: number, z: number): number {
  if (PRISON) return 0; // the bonus prison level is flat (its own ground; see src/prison)
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

  // The moat round the Fortress: the ground levelled to the Fortress's, with the channel dug out.
  const level = moatLevelling(x, z);
  if (level > 0) h = fortressHeight * level + h * (1 - level);
  const dig = moatDig(x, z);
  if (dig > 0) h -= MOAT_DEPTH * dig;

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

  // Rounded but pronounced terrain shoulders give fast vehicles natural launch slopes (flattened
  // out near the moat, where they'd hide it).
  const hillScale = 1 - level;
  for (const hill of JUMP_HILLS) {
    if (hillScale <= 0) break;
    const d = Math.hypot(x - hill.x, z - hill.z);
    h += hill.height * hillScale * Math.exp(-(d * d) / (2 * hill.spread * hill.spread));
  }

  return h;
}

/** How deep the water is at (x, z) (0 when dry). */
export function waterDepthAt(x: number, z: number): number {
  if (PRISON) return 0;
  if (inMoat(x, z)) return Math.max(0, MOAT_LEVEL - heightAt(x, z));
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
  if (inMoat(x, z) && y < MOAT_LEVEL + 0.05) return true;
  for (let i = 0; i < LAKES.length; i++) {
    const lake = LAKES[i];
    if (Math.hypot(x - lake.cx, z - lake.cz) < lake.radius + 2 && y < LAKE_LEVELS[i] + 0.05) return true;
  }
  return false;
}

/** 0 = dry land, 1 = sandy shore, 2 = lake bed. Used to tint the terrain. */
function shoreKind(x: number, z: number): number {
  if (inMoat(x, z)) return 2;
  if (inMoat(x, z, 5)) return 1; // a sandy bank round the moat
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
  if (PRISON) return 0;
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

/** A contour line every this many metres of height, like a playmat map. */
const CONTOUR_STEP = 3;
/** Contour line half-width across the ground, in metres. */
const CONTOUR_HALF_WIDTH = 0.35;
const CONTOUR_DARKEN = 0.16;
/** Steep ground is shaded down to this fraction of its colour, so hillsides stand out from flats. */
const SLOPE_SHADE = 0.84;

/**
 * Draws contour lines and shades steep ground in the terrain's shader, so hills are easy to read.
 * It works per pixel from the world height, so the lines stay crisp even though the mesh's
 * vertices (and its vertex colours) are ~12 m apart.
 */
function addContours(material: THREE.MeshStandardMaterial): void {
  const f = (n: number) => n.toFixed(3);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float land;
varying float vTerrainY;
varying float vTerrainLand;
varying float vTerrainSlope;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTerrainY = position.y;
vTerrainLand = land;
vTerrainSlope = length(normal.xz) / max(normal.y, 0.2); // rise over run`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vTerrainY;
varying float vTerrainLand;
varying float vTerrainSlope;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float fw = max(fwidth(vTerrainY), 1e-5);
  float d = abs(fract(vTerrainY / ${f(CONTOUR_STEP)} + 0.5) - 0.5) * ${f(CONTOUR_STEP)};
  // A fixed width across the ground is a height band that narrows to nothing on the flat.
  float halfWidth = ${f(CONTOUR_HALF_WIDTH)} * vTerrainSlope;
  float line = 1.0 - smoothstep(halfWidth, halfWidth + fw, d);
  line *= 1.0 - smoothstep(0.15, 0.45, fw / ${f(CONTOUR_STEP)}); // far off, where the lines crowd together
  diffuseColor.rgb *= 1.0 - ${f(CONTOUR_DARKEN)} * line * vTerrainLand;
  diffuseColor.rgb *= mix(1.0, ${f(SLOPE_SHADE)}, smoothstep(0.05, 0.35, vTerrainSlope) * vTerrainLand);
}`,
      );
  };
}

export function buildTerrain(): TerrainBuild {
  const segments = TERRAIN_SEGMENTS;
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  // Light, sunny "playmat" greens so the darker army-green plastic stands out.
  // The jungle floor is deeper and muddier, but still lighter than the green plastic.
  // The knights' meadows are lush; the zombie mission's grass has gone dull and dry.
  const pick = (day: string, jungle: string, knights: string, zombies: string) => new THREE.Color(JUNGLE ? jungle : KNIGHTS ? knights : ZOMBIES ? zombies : day);
  const grass = pick('#8dbb55', '#6f9c3e', '#84bd4e', '#86b456');
  const grassHigh = pick('#b2c26a', '#8aa748', '#a9c95f', '#a3b666');
  const dirt = pick('#bda673', '#9a7a4e', '#b39a66', '#9e8c68');
  const sand = pick('#e3d29a', '#c9b27a', '#e0cf96', '#c8bb92');
  const lakeBed = pick('#8a8a5c', '#6b6a3e', '#86895a', '#6f6a58');
  // Hollows are a slightly deeper, fresher green (still well lighter than the green plastic).
  const grassLow = grass.clone().multiplyScalar(0.9).lerp(new THREE.Color('#5fa84f'), 0.2);
  // Colour stops by height: about half the ground is below 0 m, so the hollows get their own shade.
  const stops: [number, THREE.Color][] = [
    [-TERRAIN_HEIGHT * 0.65, grassLow],
    [0, grass],
    [TERRAIN_HEIGHT * 0.45, grassHigh],
    [TERRAIN_HEIGHT * 0.9, dirt],
  ];
  const tmp = new THREE.Color();
  // 1 on open ground, 0 on the beaches and lake beds (no contour lines under the water).
  const land = new Float32Array(position.count);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const h = heightAt(x, z);
    position.setY(i, h);

    const shore = shoreKind(x, z);
    land[i] = shore === 0 ? 1 : 0;
    if (shore === 1) {
      tmp.copy(sand);
    } else if (shore === 2) {
      tmp.copy(lakeBed);
    } else {
      let k = 1;
      while (k < stops.length - 1 && h > stops[k][0]) k++;
      const [h0, c0] = stops[k - 1];
      const [h1, c1] = stops[k];
      tmp.copy(c0).lerp(c1, clamp01((h - h0) / (h1 - h0)));
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('land', new THREE.BufferAttribute(land, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  addContours(material);

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
