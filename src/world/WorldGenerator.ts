import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { AssetLibrary } from './AssetLibrary';
import type { Building } from './Building';
import type { HitRegistry } from '../combat/HitRegistry';
import { heightAt, surfaceHeightAt } from './Terrain';
import { TOWNS, ROAD_WIDTH, isInAnyTown } from './TownPlan';
import { EnemyBase } from './EnemyBase';
import { Fortress } from './Fortress';
import { plantBuilding, fitScale } from './placeModel';
import { instanceTemplate, placement } from '../utils/instancing';
import { PartBuilder } from '../utils/modelKit';
import { planHighways, buildHighwayMeshes, distanceToPolyline, HIGHWAY_WIDTH, type Polyline } from './RoadNetwork';
import { Bunker } from './Bunker';
import { LandmarkSet } from './LandmarkBuilders';
import { SITES, isInLandmark, siteToWorld, siteLocalHalf, enemyArmyAt, type Site } from './Landmarks';
import type { SquadSpawn } from '../entities/TroopManager';
import { mulberry32 } from '../utils/rng';
import { randRange } from '../utils/math';
import { ENEMY_ARMY_COLOR, ARMY_RED, ARMY_TAN, ARMY_BLUE, plastic } from '../utils/plastic';
import { WORLD_HALF, WORLD_SEED, BASE_RADIUS, MAX_ENEMIES, FORTRESS_HALF, distanceToFriendlyBase } from '../core/config';

export interface EnemySpawnPoint {
  x: number;
  z: number;
  patrolCenter: THREE.Vector3;
  patrolRadius: number;
  facing: number;
  color: number;
  /** Keeps respawning only while this holds (guards stop coming once their base is taken). */
  holdWhile: (() => boolean) | null;
}

export interface WorldContent {
  buildings: Building[];
  enemySpawns: EnemySpawnPoint[];
  highways: Polyline[];
  bunkers: Bunker[];
  squads: SquadSpawn[];
  landmarks: LandmarkSet;
  enemyBases: EnemyBase[];
  /** Patrol loops for the red army's tanks, one round each town. */
  redRoutes: THREE.Vector3[][];
  fortress: Fortress;
  forests: Forest[];
}

/** A patch of dense woodland (drawn on the map too). */
export interface Forest {
  x: number;
  z: number;
  radius: number;
}

const BUNKER_COUNT = 24;
const BUNKER_MIN_SPACING = 190;
const BUNKER_MIN_DIST_FROM_BASE = 350;
const ROAMING_SQUADS = 16;

// Kenney models are authored at ~1 unit per house; scale up to read correctly next to a ~4m tank.
const BUILDING_SCALE_MIN = 9;
const BUILDING_SCALE_MAX = 12;
const MAX_HOUSE_WIDTH = 22; // along the street, keeps neighbours from overlapping
const MAX_HOUSE_DEPTH = 18;
const TREE_SCALE_MIN = 11;
const TREE_SCALE_MAX = 16;

// Kenney road props and cars are authored at different scales than the houses.
const PROP_SCALE = 12;
const LIGHT_SCALE = 12;
const CAR_SCALE = 1.7;
const PARKED_CAR_CHANCE = 0.22;
const POLE_SPACING = 70;
const POLE_OFFSET = HIGHWAY_WIDTH / 2 + 5;

const BASE_CLEAR_RADIUS = BASE_RADIUS * 2.6;
const BUILDING_MAX_HEALTH = 120;
const DEBRIS_COLOR = 0x8a8478;
const ENEMY_MIN_DIST_FROM_BASE = 350;
const ENEMY_MIN_DIST_APART = 160;

export function generateWorld(
  world: RAPIER.World,
  scene: THREE.Scene,
  hitRegistry: HitRegistry,
  assets: AssetLibrary,
): WorldContent {
  placeRoads(scene);
  const highways = planHighways();
  scene.add(buildHighwayMeshes(highways));
  placePowerLines(scene, assets, highways);
  const landmarks = new LandmarkSet(world, scene, hitRegistry, assets);
  const enemyBases = SITES.filter((s) => s.kind === 'enemyBase').map((s) => new EnemyBase(world, scene, hitRegistry, assets, s));
  const fortress = new Fortress(world, scene, hitRegistry, assets, SITES.find((s) => s.kind === 'fortress') as Site);
  const buildings = [
    ...placeHouses(world, scene, hitRegistry, assets),
    ...dressTowns(world, scene, hitRegistry, assets),
    ...landmarks.buildings,
    ...enemyBases.flatMap((b) => b.buildings),
    ...fortress.buildings.filter((b) => !fortress.bunkers.some((k) => k.building === b)),
  ];
  const bunkers = [...placeBunkers(world, scene, hitRegistry, highways), ...enemyBases.map((b) => b.bunker), ...fortress.bunkers];
  const forests = planForests(highways, bunkers);
  placeTrees(scene, assets, highways, bunkers, forests);
  const holds = (site: Site) => whileBaseHolds(site, enemyBases, fortress);
  const enemySpawns = placeEnemySpawns(holds);
  const squads = [...planSquads(bunkers, holds), ...planRedSquads()];
  return { buildings, enemySpawns, highways, bunkers, squads, landmarks, enemyBases, redRoutes: planRedRoutes(), fortress, forests };
}

/** Anywhere a bunker, tree or spawn shouldn't go: towns, malls, the airfield, lakes. */
function isOccupied(x: number, z: number, padding: number): boolean {
  return isInAnyTown(x, z, padding) || isInLandmark(x, z, padding);
}

function placeBunkers(world: RAPIER.World, scene: THREE.Scene, hitRegistry: HitRegistry, highways: Polyline[]): Bunker[] {
  const rng = mulberry32(WORLD_SEED + 331);
  const bunkers: Bunker[] = [];
  if (highways.length === 0) return bunkers;
  let attempts = 0;

  while (bunkers.length < BUNKER_COUNT && attempts < 3000) {
    attempts++;
    const road = highways[Math.floor(rng() * highways.length)];
    if (road.length < 3) continue;
    const i = 1 + Math.floor(rng() * (road.length - 2));
    const p = road[i];
    const tangent = road[i + 1].clone().sub(road[i - 1]).normalize();
    const side = rng() < 0.5 ? -1 : 1;
    const offset = randRange(rng, 28, 45) * side;
    const x = p.x - tangent.y * offset;
    const z = p.y + tangent.x * offset;

    if (Math.abs(x) > WORLD_HALF - 40 || Math.abs(z) > WORLD_HALF - 40) continue;
    if (distanceToFriendlyBase(x, z) < BUNKER_MIN_DIST_FROM_BASE) continue;
    if (isOccupied(x, z, 25)) continue;
    if (highways.some((h) => distanceToPolyline(x, z, h) < 18)) continue;
    if (bunkers.some((b) => Math.hypot(b.position.x - x, b.position.z - z) < BUNKER_MIN_SPACING)) continue;

    // Face the road, snapped to a quarter turn so the box collider fits the footprint.
    const yaw = Math.atan2(-(p.x - x), -(p.y - z));
    const facing = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
    bunkers.push(new Bunker(world, scene, hitRegistry, x, z, facing, 'enemy', ENEMY_ARMY_COLOR[enemyArmyAt(x, z)]));
  }

  return bunkers;
}

/** While a site's enemy base (or the Fortress) stands; null (always) for other sites. */
function whileBaseHolds(site: Site, enemyBases: EnemyBase[], fortress: Fortress): (() => boolean) | null {
  if (site.kind === 'fortress') return () => !fortress.isDestroyed;
  const base = enemyBases.find((b) => b.site === site);
  return base ? () => !base.isDestroyed : null;
}

type HoldFor = (site: Site) => (() => boolean) | null;

/** Army colour at a spot: the Fortress is split tan (west) and blue (east); elsewhere the nearest base's army. */
function armyColorAt(x: number, z: number): number {
  if (Math.max(Math.abs(x), Math.abs(z)) < FORTRESS_HALF) return x < 0 ? ARMY_TAN : ARMY_BLUE;
  return ENEMY_ARMY_COLOR[enemyArmyAt(x, z)];
}

function enemySquad(x: number, z: number, count: number, wanderRadius: number, holdWhile: (() => boolean) | null): SquadSpawn {
  return {
    anchor: new THREE.Vector2(x, z),
    count,
    wanderRadius,
    faction: 'enemy',
    color: armyColorAt(x, z),
    holdWhile,
  };
}

function planSquads(bunkers: Bunker[], holds: HoldFor): SquadSpawn[] {
  const rng = mulberry32(WORLD_SEED + 677);
  const squads: SquadSpawn[] = [];

  for (const bunker of bunkers) {
    const rot = bunker.building.mesh.rotation.y;
    const front = new THREE.Vector2(-Math.sin(rot), -Math.cos(rot));
    squads.push(
      enemySquad(bunker.position.x + front.x * 11, bunker.position.z + front.y * 11, 4 + Math.floor(rng() * 2), 7, () => bunker.alive),
    );
  }

  let attempts = 0;
  let roaming = 0;
  while (roaming < ROAMING_SQUADS && attempts < 500) {
    attempts++;
    const x = randRange(rng, -WORLD_HALF * 0.85, WORLD_HALF * 0.85);
    const z = randRange(rng, -WORLD_HALF * 0.85, WORLD_HALF * 0.85);
    if (distanceToFriendlyBase(x, z) < BUNKER_MIN_DIST_FROM_BASE) continue;
    if (isOccupied(x, z, 15)) continue;
    squads.push(enemySquad(x, z, 5, 22, null));
    roaming++;
  }

  // Garrisons: the airfield and enemy bases are held in force, each mall has a car-park patrol.
  const garrison: Record<Site['kind'], number[][]> = {
    airport: [[-200, 25], [0, 25], [200, 25]],
    mall: [[0, 55]],
    enemyBase: [[-20, 5], [22, 24], [0, 50]],
    fortress: [[-50, -30], [-55, 30], [-30, 75], [-40, -80], [-15, -20], [50, -30], [55, 30], [30, 75], [40, -80], [15, -20]],
  };
  for (const site of SITES) {
    const holdWhile = holds(site);
    for (const [lx, lz] of garrison[site.kind]) {
      const p = siteToWorld(site, lx, lz);
      squads.push(enemySquad(p.x, p.z, site.kind === 'fortress' ? 6 : 5, site.kind === 'mall' || site.kind === 'airport' ? 18 : 12, holdWhile));
    }
  }

  return squads;
}

function placeRoads(scene: THREE.Scene): void {
  const material = new THREE.MeshStandardMaterial({
    color: 0x45484d,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: 0xe8d36a,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  for (const town of TOWNS) {
    for (const road of town.roads) {
      const w = road.alongX ? road.length : ROAD_WIDTH;
      const d = road.alongX ? ROAD_WIDTH : road.length;
      const y = heightAt(road.x, road.z) + 0.06;

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(road.x, y, road.z);
      mesh.receiveShadow = true;
      scene.add(mesh);

      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(road.alongX ? road.length - ROAD_WIDTH : 0.35, road.alongX ? 0.35 : road.length - ROAD_WIDTH),
        lineMaterial,
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(road.x, y + 0.02, road.z);
      scene.add(line);
    }
  }
}

/** Houses on residential streets; Kenney commercial buildings on each town's high street. */
function placeHouses(world: RAPIER.World, scene: THREE.Scene, hitRegistry: HitRegistry, assets: AssetLibrary): Building[] {
  const rng = mulberry32(WORLD_SEED + 7);
  const buildings: Building[] = [];

  for (const town of TOWNS) {
    for (const lot of town.lots) {
      const shop = lot.kind === 'shop';
      // A few skyscrapers give each high street a skyline; otherwise regular shop fronts.
      const name = shop
        ? assets.random('commercial', rng, (n) => n.startsWith('building-') && (rng() < 0.15 || !n.includes('skyscraper')))
        : assets.random('house', rng);
      const model = assets.clone(shop ? 'commercial' : 'house', name);
      const scale = fitScale(model, lot.facing, randRange(rng, BUILDING_SCALE_MIN, BUILDING_SCALE_MAX), MAX_HOUSE_WIDTH, MAX_HOUSE_DEPTH);
      buildings.push(
        plantBuilding(world, scene, hitRegistry, model, lot.x, lot.z, lot.facing, scale, shop ? 180 : BUILDING_MAX_HEALTH, DEBRIS_COLOR),
      );
    }
  }

  return buildings;
}

/** Street lights along every town street, and cars parked at the kerb (they're destructible). */
function dressTowns(world: RAPIER.World, scene: THREE.Scene, hitRegistry: HitRegistry, assets: AssetLibrary): Building[] {
  const rng = mulberry32(WORLD_SEED + 19);
  const lights: THREE.Matrix4[] = [];
  const cars: Building[] = [];
  const kerb = ROAD_WIDTH / 2 + 1.5;

  for (const town of TOWNS) {
    for (const z of town.streetZs) {
      for (let x = town.cx - town.halfLen + 13; x < town.cx + town.halfLen - 6; x += 26) {
        if (town.crossXs.some((cx) => Math.abs(cx - x) < 10)) continue;
        // Lamps alternate sides; the lamp head overhangs the road.
        const side = Math.round((x - town.cx) / 26) % 2 === 0 ? 1 : -1;
        // The Kenney lamp's arm points along its local -Z, so turn it to face across the road.
        lights.push(placement(x, heightAt(x, z + side * kerb), z + side * kerb, side > 0 ? 0 : Math.PI, LIGHT_SCALE));
      }
    }

    for (const lot of town.lots) {
      if (rng() > PARKED_CAR_CHANCE) continue;
      const side = lot.z > lot.streetZ ? 1 : -1;
      const x = lot.x + randRange(rng, -6, 6);
      const z = lot.streetZ + side * (ROAD_WIDTH / 2 - 1.6);
      const heading = rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2; // parallel parked
      const model = assets.clone('car', assets.random('car', rng));
      cars.push(plantBuilding(world, scene, hitRegistry, model, x, z, heading, CAR_SCALE, 26, 0x555555));
    }
  }

  scene.add(instanceTemplate(assets.template('prop', 'light-square'), lights));
  return cars;
}

/**
 * Wooden power poles marching along the highways, with sagging wires strung between the ends of
 * their crossarms. Where a pole is left out (a town, a landmark) the line breaks.
 */
function placePowerLines(scene: THREE.Scene, assets: AssetLibrary, highways: Polyline[]): void {
  const template = assets.template('prop', 'electricity-pole');
  // Attachment points in the model's own units: both ends of the crossarm and the top.
  const box = new THREE.Box3().setFromObject(template);
  const size = box.getSize(new THREE.Vector3());
  const armAlongX = size.x >= size.z;
  const reach = (armAlongX ? size.x : size.z) * 0.44;
  const top = box.max.y - size.y * 0.04;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const attach = [-1, 1].map((s) => new THREE.Vector3(cx + (armAlongX ? s * reach : 0), top, cz + (armAlongX ? 0 : s * reach)));
  attach.push(new THREE.Vector3(cx, box.max.y + size.y * 0.02, cz));

  const poles: THREE.Matrix4[] = [];
  const wires = new PartBuilder();
  const wireMat = plastic(0x2a2a2a);
  const string = (a: THREE.Matrix4, b: THREE.Matrix4) => {
    for (const p of attach) {
      const from = p.clone().applyMatrix4(a);
      const to = p.clone().applyMatrix4(b);
      const sag = from.distanceTo(to) * 0.035;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        pts.push(from.clone().lerp(to, t).setY(from.y + (to.y - from.y) * t - sag * 4 * t * (1 - t)));
      }
      wires.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.05, 4), wireMat);
    }
  };

  for (const road of highways) {
    let carried = 0;
    let last: THREE.Matrix4 | null = null;
    for (let i = 1; i < road.length; i++) {
      carried += road[i].distanceTo(road[i - 1]);
      if (carried < POLE_SPACING) continue;
      carried = 0;
      const t = road[Math.min(road.length - 1, i + 1)].clone().sub(road[i - 1]).normalize();
      const x = road[i].x - t.y * POLE_OFFSET;
      const z = road[i].y + t.x * POLE_OFFSET;
      if (isOccupied(x, z, 2) || distanceToFriendlyBase(x, z) < BASE_RADIUS + 10) {
        last = null; // break the line here
        continue;
      }
      const m = placement(x, surfaceHeightAt(x, z), z, Math.atan2(-t.x, -t.y), PROP_SCALE);
      poles.push(m);
      if (last) string(last, m);
      last = m;
    }
  }
  scene.add(instanceTemplate(template, poles));
  wires.buildInto(scene, false, false);
}

/** Trees, drawn as one instanced batch per tree model. */
const FOREST_COUNT = 16;

/** Patches of woodland in open country, clear of roads, towns, landmarks and bases. */
function planForests(highways: Polyline[], bunkers: Bunker[]): Forest[] {
  const rng = mulberry32(WORLD_SEED + 1447);
  const forests: Forest[] = [];
  for (let attempt = 0; attempt < 3000 && forests.length < FOREST_COUNT; attempt++) {
    const radius = randRange(rng, 55, 130);
    const x = randRange(rng, -WORLD_HALF + radius + 40, WORLD_HALF - radius - 40);
    const z = randRange(rng, -WORLD_HALF + radius + 40, WORLD_HALF - radius - 40);
    if (distanceToFriendlyBase(x, z) < BASE_CLEAR_RADIUS + radius) continue;
    if (isOccupied(x, z, radius + 30)) continue;
    if (highways.some((h) => distanceToPolyline(x, z, h) < radius + 12)) continue;
    if (bunkers.some((b) => Math.hypot(b.position.x - x, b.position.z - z) < radius + 20)) continue;
    if (forests.some((f) => Math.hypot(f.x - x, f.z - z) < f.radius + radius + 60)) continue;
    forests.push({ x, z, radius });
  }
  return forests;
}

function placeTrees(scene: THREE.Scene, assets: AssetLibrary, highways: Polyline[], bunkers: Bunker[], forests: Forest[]): void {
  const rng = mulberry32(WORLD_SEED + 41);
  const names = assets.names('tree');
  const byModel = new Map<string, THREE.Matrix4[]>(names.map((n) => [n, []]));

  const gridStep = 55;
  const steps = Math.floor((WORLD_HALF * 2) / gridStep);

  for (let i = 0; i < steps * steps; i++) {
    if (rng() > 0.12) continue;
    const x = randRange(rng, -WORLD_HALF, WORLD_HALF);
    const z = randRange(rng, -WORLD_HALF, WORLD_HALF);
    if (distanceToFriendlyBase(x, z) < BASE_CLEAR_RADIUS) continue;
    if (isOccupied(x, z, 4)) continue;
    if (highways.some((h) => distanceToPolyline(x, z, h) < HIGHWAY_WIDTH / 2 + 6)) continue;
    if (bunkers.some((b) => Math.hypot(b.position.x - x, b.position.z - z) < 20)) continue;

    const name = names[Math.floor(rng() * names.length)];
    const scale = randRange(rng, TREE_SCALE_MIN, TREE_SCALE_MAX);
    byModel.get(name)?.push(placement(x, surfaceHeightAt(x, z), z, randRange(rng, 0, Math.PI * 2), scale));
  }

  // Forests: trees packed close, thinning out toward a ragged edge.
  for (const f of forests) {
    const count = Math.floor((Math.PI * f.radius * f.radius) / 90);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * f.radius;
      const edge = f.radius * (0.82 + 0.18 * Math.sin(a * 5 + f.x));
      if (r > edge) continue;
      const x = f.x + Math.cos(a) * r;
      const z = f.z + Math.sin(a) * r;
      const name = names[Math.floor(rng() * names.length)];
      const scale = randRange(rng, TREE_SCALE_MIN, TREE_SCALE_MAX) * (1.1 - (0.3 * r) / f.radius);
      byModel.get(name)?.push(placement(x, surfaceHeightAt(x, z), z, randRange(rng, 0, Math.PI * 2), scale));
    }
  }

  for (const [name, spots] of byModel) scene.add(instanceTemplate(assets.template('tree', name), spots));
}

function placeEnemySpawns(holds: HoldFor): EnemySpawnPoint[] {
  const rng = mulberry32(WORLD_SEED + 97);
  const spawns: EnemySpawnPoint[] = [];
  let attempts = 0;

  while (spawns.length < MAX_ENEMIES && attempts < 500) {
    attempts++;
    const x = randRange(rng, -WORLD_HALF * 0.85, WORLD_HALF * 0.85);
    const z = randRange(rng, -WORLD_HALF * 0.85, WORLD_HALF * 0.85);
    if (distanceToFriendlyBase(x, z) < ENEMY_MIN_DIST_FROM_BASE) continue;
    if (isOccupied(x, z, 10)) continue;
    if (spawns.some((s) => Math.hypot(x - s.x, z - s.z) < ENEMY_MIN_DIST_APART)) continue;

    spawns.push({
      x,
      z,
      patrolCenter: new THREE.Vector3(x, 0, z),
      patrolRadius: randRange(rng, 60, 120),
      facing: randRange(rng, 0, Math.PI * 2),
      color: armyColorAt(x, z),
      holdWhile: null,
    });
  }

  // Extra tanks guarding the landmarks (on top of the roaming ones).
  for (const site of SITES) {
    const half = siteLocalHalf(site);
    const spots: Record<Site['kind'], number[][]> = {
      airport: [[-120, 20], [120, 20]],
      mall: [[0, half.z + 30]],
      enemyBase: [[0, half.z + 28], [half.x + 25, 0]],
      fortress: [[-45, 10], [-50, -45], [-20, 55], [45, 10], [50, -45], [20, 55]],
    };
    const radius: Record<Site['kind'], number> = { airport: 120, mall: 50, enemyBase: 60, fortress: 30 };
    const holdWhile = holds(site);
    for (const [lx, lz] of spots[site.kind]) {
      const p = siteToWorld(site, lx, lz);
      spawns.push({
        x: p.x,
        z: p.z,
        patrolCenter: new THREE.Vector3(p.x, 0, p.z),
        patrolRadius: radius[site.kind],
        facing: rng() * Math.PI * 2,
        color: armyColorAt(p.x, p.z),
        holdWhile,
      });
    }
  }

  return spawns;
}

// ---------- the red army (on the player's side) ----------

/** How far outside each town's footprint the red army patrols and camps. */
const RED_PERIMETER = 22;

/** The corners of a loop just outside a town, in driving order. */
function townLoop(town: (typeof TOWNS)[number]): THREE.Vector3[] {
  const x0 = town.minX - RED_PERIMETER;
  const x1 = town.maxX + RED_PERIMETER;
  const z0 = town.minZ - RED_PERIMETER;
  const z1 = town.maxZ + RED_PERIMETER;
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ].map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z));
}

/** One red tank circles each town. */
function planRedRoutes(): THREE.Vector3[][] {
  return TOWNS.map(townLoop);
}

/** A red squad camps at one corner of every town. */
function planRedSquads(): SquadSpawn[] {
  const rng = mulberry32(WORLD_SEED + 1201);
  return TOWNS.map((town) => {
    const corner = townLoop(town)[Math.floor(rng() * 4)];
    return {
      anchor: new THREE.Vector2(corner.x, corner.z),
      count: 5,
      wanderRadius: 14,
      faction: 'player' as const,
      color: ARMY_RED,
      holdWhile: null,
    };
  });
}