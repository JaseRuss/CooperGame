import { mulberry32 } from '../utils/rng';
import { randRange } from '../utils/math';
import { WORLD_HALF, WORLD_SEED, FRIENDLY_BASES, ENEMY_BASE_COUNT, FORTRESS_HALF, distanceToFriendlyBase } from '../core/config';
import { TOWNS } from './TownPlan';
import type { EnemyArmy } from '../utils/plastic';

/** A flattened rectangular site. `flip` = which way the site's front faces along Z (+1 or -1). */
export interface Site {
  kind: 'mall' | 'airport' | 'enemyBase' | 'fortress';
  /** Call sign for enemy bases ("Alpha", ...); empty otherwise. */
  name: string;
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
  /** Airports: true when the runway runs along world Z instead of X. */
  rotated: boolean;
  flip: 1 | -1;
}

export interface Lake {
  cx: number;
  cz: number;
  radius: number;
}

const MALL_HALF = { x: 95, z: 80 };
const AIRPORT_HALF = { x: 390, z: 150 };
export const ENEMY_BASE_HALF = 75;
const ENEMY_BASE_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
const ENEMY_BASE_MIN_DIST_FROM_FRIENDLY = 420;
const ENEMY_BASE_MIN_SPACING = 420;
const LAKE_COUNT = 5;
const MALL_COUNT = 3;

function rectDistance(s: Rect, x: number, z: number): number {
  const dx = Math.max(Math.abs(x - s.cx) - s.halfX, 0);
  const dz = Math.max(Math.abs(z - s.cz) - s.halfZ, 0);
  return Math.hypot(dx, dz);
}

export type Rect = { cx: number; cz: number; halfX: number; halfZ: number };

function rectRectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(Math.abs(a.cx - b.cx) - a.halfX - b.halfX, 0);
  const dz = Math.max(Math.abs(a.cz - b.cz) - a.halfZ - b.halfZ, 0);
  return Math.hypot(dx, dz);
}

function plan(): { sites: Site[]; lakes: Lake[] } {
  const rng = mulberry32(WORLD_SEED + 881);
  const sites: Site[] = [];
  const lakes: Lake[] = [];

  const clearOfEverything = (x: number, z: number, hx: number, hz: number, margin: number): boolean => {
    if (Math.abs(x) + hx > WORLD_HALF - 60 || Math.abs(z) + hz > WORLD_HALF - 60) return false;
    const probe = { cx: x, cz: z, halfX: hx, halfZ: hz };
    if (FRIENDLY_BASES.some((b) => rectDistance(probe, b.x, b.z) < 200 + margin)) return false;
    for (const t of TOWNS) {
      const town = { cx: (t.minX + t.maxX) / 2, cz: (t.minZ + t.maxZ) / 2, halfX: (t.maxX - t.minX) / 2, halfZ: (t.maxZ - t.minZ) / 2 };
      if (rectRectDistance(probe, town) < margin) return false;
    }
    for (const s of sites) if (rectRectDistance(probe, s) < margin) return false;
    for (const l of lakes) if (rectDistance(probe, l.cx, l.cz) < l.radius + margin) return false;
    return true;
  };

  // The Fortress holds the middle of the map; everything else keeps clear of it.
  sites.push({ kind: 'fortress', name: 'Fortress', cx: 0, cz: 0, halfX: FORTRESS_HALF, halfZ: FORTRESS_HALF, rotated: false, flip: 1 });

  // Airport next: it needs the most room.
  for (let attempt = 0; attempt < 400 && !sites.some((s) => s.kind === 'airport'); attempt++) {
    const rotated = rng() < 0.5;
    const hx = rotated ? AIRPORT_HALF.z : AIRPORT_HALF.x;
    const hz = rotated ? AIRPORT_HALF.x : AIRPORT_HALF.z;
    const x = randRange(rng, -WORLD_HALF + hx + 60, WORLD_HALF - hx - 60);
    const z = randRange(rng, -WORLD_HALF + hz + 60, WORLD_HALF - hz - 60);
    if (clearOfEverything(x, z, hx, hz, 60)) {
      sites.push({ kind: 'airport', name: '', cx: x, cz: z, halfX: hx, halfZ: hz, rotated, flip: rng() < 0.5 ? 1 : -1 });
    }
  }

  // Enemy bases next: they're the objective, so they get first pick of the open ground.
  const enemyBases = () => sites.filter((s) => s.kind === 'enemyBase');
  for (let attempt = 0; attempt < 2000 && enemyBases().length < ENEMY_BASE_COUNT; attempt++) {
    const h = ENEMY_BASE_HALF;
    const x = randRange(rng, -WORLD_HALF + h + 80, WORLD_HALF - h - 80);
    const z = randRange(rng, -WORLD_HALF + h + 80, WORLD_HALF - h - 80);
    if (distanceToFriendlyBase(x, z) < ENEMY_BASE_MIN_DIST_FROM_FRIENDLY) continue;
    if (enemyBases().some((b) => Math.hypot(b.cx - x, b.cz - z) < ENEMY_BASE_MIN_SPACING)) continue;
    if (clearOfEverything(x, z, h, h, 50)) {
      const name = ENEMY_BASE_NAMES[enemyBases().length];
      sites.push({ kind: 'enemyBase', name, cx: x, cz: z, halfX: h, halfZ: h, rotated: false, flip: rng() < 0.5 ? 1 : -1 });
    }
  }

  for (let attempt = 0; attempt < 600 && sites.filter((s) => s.kind === 'mall').length < MALL_COUNT; attempt++) {
    const x = randRange(rng, -WORLD_HALF, WORLD_HALF);
    const z = randRange(rng, -WORLD_HALF, WORLD_HALF);
    if (clearOfEverything(x, z, MALL_HALF.x, MALL_HALF.z, 70)) {
      sites.push({ kind: 'mall', name: '', cx: x, cz: z, halfX: MALL_HALF.x, halfZ: MALL_HALF.z, rotated: false, flip: rng() < 0.5 ? 1 : -1 });
    }
  }

  for (let attempt = 0; attempt < 600 && lakes.length < LAKE_COUNT; attempt++) {
    const radius = randRange(rng, 45, 95);
    const x = randRange(rng, -WORLD_HALF, WORLD_HALF);
    const z = randRange(rng, -WORLD_HALF, WORLD_HALF);
    if (clearOfEverything(x, z, radius, radius, 80)) lakes.push({ cx: x, cz: z, radius });
  }

  return { sites, lakes };
}

const planned = plan();
export const SITES: Site[] = planned.sites;
export const LAKES: Lake[] = planned.lakes;

/** Enemy bases alternate between the tan and blue armies. */
export function enemyArmyOfSite(site: Site): EnemyArmy {
  return SITES.filter((s) => s.kind === 'enemyBase').indexOf(site) % 2 === 0 ? 'tan' : 'blue';
}

/** The enemy army holding the ground around (x, z): whoever owns the nearest enemy base. */
export function enemyArmyAt(x: number, z: number): EnemyArmy {
  let best: Site | null = null;
  let bestD = Infinity;
  for (const s of SITES) {
    if (s.kind !== 'enemyBase') continue;
    const d = Math.hypot(s.cx - x, s.cz - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best ? enemyArmyOfSite(best) : 'tan';
}

/** Rotation (about Y) from a site's local layout frame to the world. Local +Z is the site's front. */
export function siteYaw(site: Site): number {
  return (site.rotated ? Math.PI / 2 : 0) + (site.flip === -1 ? Math.PI : 0);
}

/** Half-extents of the site in its own local frame (runway/frontage along local X). */
export function siteLocalHalf(site: Site): { x: number; z: number } {
  return site.rotated ? { x: site.halfZ, z: site.halfX } : { x: site.halfX, z: site.halfZ };
}

/** Local (lx, lz) → world (x, z), matching THREE's rotation about +Y. */
export function siteToWorld(site: Site, lx: number, lz: number): { x: number; z: number } {
  const yaw = siteYaw(site);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: site.cx + lx * c + lz * s, z: site.cz - lx * s + lz * c };
}

/** A local axis-aligned rectangle mapped to its (still axis-aligned) world rectangle. */
export function siteRectToWorld(site: Site, lx: number, lz: number, halfW: number, halfD: number): Rect {
  const c = siteToWorld(site, lx, lz);
  const swap = site.rotated;
  return { cx: c.x, cz: c.z, halfX: swap ? halfD : halfW, halfZ: swap ? halfW : halfD };
}

// Local-frame layout shared by the site builders, the road planner and the map, so the
// highway entrances always land on paving.
/** Mall car park: spans the full lot width, from just in front of the shops to the front edge. */
export const MALL_LOT_BACK_Z = -32;
/** Mall side entrances join the car park at this depth. */
export const MALL_SIDE_ENTRY_Z = 20;
/** Airfield apron (local): centred at z=52, 380 x 84. */
export const APRON = { z: 52, halfX: 190, halfZ: 42 };
/** Airfield landside access road runs from the site's front edge down to the apron at this x. */
export const AIRPORT_ACCESS_X = 30;
export const SITE_ROAD_WIDTH = 12;

export interface SiteEntry {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

/** Paved points on the site edge where a highway may join, each with its outward direction. */
export function siteEntries(site: Site): SiteEntry[] {
  const half = siteLocalHalf(site);
  const byKind: Record<Site['kind'], [number, number, number, number][]> = {
    mall: [
      [0, half.z, 0, 1],
      [-half.x, MALL_SIDE_ENTRY_Z, -1, 0],
      [half.x, MALL_SIDE_ENTRY_Z, 1, 0],
    ],
    airport: [
      [AIRPORT_ACCESS_X, half.z, 0, 1],
      [-half.x, APRON.z, -1, 0],
      [half.x, APRON.z, 1, 0],
    ],
    enemyBase: [[0, half.z, 0, 1]], // the checkpoint gate
    fortress: [
      [0, half.z, 0, 1],
      [0, -half.z, 0, -1],
    ], // north and south gatehouses
  };
  const local = byKind[site.kind];
  return local.map(([lx, lz, dx, dz]) => {
    const p = siteToWorld(site, lx, lz);
    const tip = siteToWorld(site, lx + dx, lz + dz);
    return { x: p.x, z: p.z, dirX: tip.x - p.x, dirZ: tip.z - p.z };
  });
}

export function distanceToSite(site: Site, x: number, z: number): number {
  return rectDistance(site, x, z);
}

/** True when (x, z) is on (or within `padding` of) a mall, the airfield or a lake. */
export function isInLandmark(x: number, z: number, padding = 0): boolean {
  if (SITES.some((s) => rectDistance(s, x, z) <= padding)) return true;
  return LAKES.some((l) => Math.hypot(x - l.cx, z - l.cz) <= l.radius + padding);
}
