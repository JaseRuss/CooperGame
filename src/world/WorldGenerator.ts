import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { AssetLibrary } from './AssetLibrary';
import { Building } from './Building';
import type { HitRegistry } from '../combat/HitRegistry';
import { heightAt, surfaceHeightAt } from './Terrain';
import { TOWNS, ROAD_WIDTH, isInAnyTown, type Lot } from './TownPlan';
import { planHighways, buildHighwayMeshes, distanceToPolyline, HIGHWAY_WIDTH, type Polyline } from './RoadNetwork';
import { Bunker } from './Bunker';
import { LandmarkSet } from './LandmarkBuilders';
import { SITES, isInLandmark, siteToWorld, siteLocalHalf } from './Landmarks';
import type { SquadSpawn } from '../entities/TroopManager';
import { mulberry32 } from '../utils/rng';
import { randRange } from '../utils/math';
import { WORLD_HALF, WORLD_SEED, BASE_POSITION, BASE_RADIUS, MAX_ENEMIES } from '../core/config';

export interface EnemySpawnPoint {
  x: number;
  z: number;
  patrolCenter: THREE.Vector3;
  patrolRadius: number;
  facing: number;
}

export interface WorldContent {
  buildings: Building[];
  enemySpawns: EnemySpawnPoint[];
  highways: Polyline[];
  bunkers: Bunker[];
  squads: SquadSpawn[];
  landmarks: LandmarkSet;
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
  const landmarks = new LandmarkSet(world, scene, hitRegistry);
  const buildings = [...placeHouses(world, scene, hitRegistry, assets), ...landmarks.buildings];
  const bunkers = placeBunkers(world, scene, hitRegistry, highways);
  placeTrees(scene, assets, highways, bunkers);
  const enemySpawns = placeEnemySpawns();
  const squads = planSquads(bunkers);
  return { buildings, enemySpawns, highways, bunkers, squads, landmarks };
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
    if (Math.hypot(x - BASE_POSITION.x, z - BASE_POSITION.z) < BUNKER_MIN_DIST_FROM_BASE) continue;
    if (isOccupied(x, z, 25)) continue;
    if (highways.some((h) => distanceToPolyline(x, z, h) < 18)) continue;
    if (bunkers.some((b) => Math.hypot(b.position.x - x, b.position.z - z) < BUNKER_MIN_SPACING)) continue;

    // Face the road, snapped to a quarter turn so the box collider fits the footprint.
    const yaw = Math.atan2(-(p.x - x), -(p.y - z));
    const facing = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
    bunkers.push(new Bunker(world, scene, hitRegistry, x, z, facing));
  }

  return bunkers;
}

function planSquads(bunkers: Bunker[]): SquadSpawn[] {
  const rng = mulberry32(WORLD_SEED + 677);
  const squads: SquadSpawn[] = [];

  for (const bunker of bunkers) {
    const rot = bunker.building.mesh.rotation.y;
    const front = new THREE.Vector2(-Math.sin(rot), -Math.cos(rot));
    squads.push({
      anchor: new THREE.Vector2(bunker.position.x + front.x * 11, bunker.position.z + front.y * 11),
      count: 4 + Math.floor(rng() * 2),
      wanderRadius: 7,
      bunker,
    });
  }

  let attempts = 0;
  let roaming = 0;
  while (roaming < ROAMING_SQUADS && attempts < 500) {
    attempts++;
    const x = randRange(rng, -WORLD_HALF * 0.85, WORLD_HALF * 0.85);
    const z = randRange(rng, -WORLD_HALF * 0.85, WORLD_HALF * 0.85);
    if (Math.hypot(x - BASE_POSITION.x, z - BASE_POSITION.z) < BUNKER_MIN_DIST_FROM_BASE) continue;
    if (isOccupied(x, z, 15)) continue;
    squads.push({ anchor: new THREE.Vector2(x, z), count: 5, wanderRadius: 22, bunker: null });
    roaming++;
  }

  // Garrisons: the airfield is held in force, each mall has a patrol in the car park.
  for (const site of SITES) {
    const spots = site.kind === 'airport' ? [[-200, 25], [0, 25], [200, 25]] : [[0, 55]];
    for (const [lx, lz] of spots) {
      const p = siteToWorld(site, lx, lz);
      squads.push({ anchor: new THREE.Vector2(p.x, p.z), count: 5, wanderRadius: 18, bunker: null });
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

function placeHouse(
  lot: Lot,
  name: string,
  rng: () => number,
  world: RAPIER.World,
  scene: THREE.Scene,
  hitRegistry: HitRegistry,
  assets: AssetLibrary,
): Building {
  const mesh = assets.cloneBuilding(name);
  mesh.rotation.y = lot.facing;

  // Measure the footprint at scale 1 (facing is a half-turn, so X stays along the street).
  const rawSize = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  const scale = Math.min(
    randRange(rng, BUILDING_SCALE_MIN, BUILDING_SCALE_MAX),
    MAX_HOUSE_WIDTH / rawSize.x,
    MAX_HOUSE_DEPTH / rawSize.z,
  );
  mesh.scale.setScalar(scale);

  // Center the footprint on the lot and plant its base on the (flattened) ground.
  const localBox = new THREE.Box3().setFromObject(mesh);
  const localCenter = localBox.getCenter(new THREE.Vector3());
  const groundY = heightAt(lot.x, lot.z);
  mesh.position.set(lot.x - localCenter.x, groundY - localBox.min.y, lot.z - localCenter.z);
  scene.add(mesh);

  const placedBox = new THREE.Box3().setFromObject(mesh);
  const center = placedBox.getCenter(new THREE.Vector3());
  const halfExtents = placedBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);

  return new Building(world, scene, hitRegistry, mesh, halfExtents, center, BUILDING_MAX_HEALTH, DEBRIS_COLOR);
}

function placeHouses(
  world: RAPIER.World,
  scene: THREE.Scene,
  hitRegistry: HitRegistry,
  assets: AssetLibrary,
): Building[] {
  const rng = mulberry32(WORLD_SEED + 7);
  const names = assets.buildingNames;
  const buildings: Building[] = [];

  for (const town of TOWNS) {
    for (const lot of town.lots) {
      const name = names[Math.floor(rng() * names.length)];
      buildings.push(placeHouse(lot, name, rng, world, scene, hitRegistry, assets));
    }
  }

  return buildings;
}

function placeTrees(scene: THREE.Scene, assets: AssetLibrary, highways: Polyline[], bunkers: Bunker[]): void {
  const rng = mulberry32(WORLD_SEED + 41);
  const names = assets.treeNames;
  if (names.length === 0) return;

  const gridStep = 55;
  const steps = Math.floor((WORLD_HALF * 2) / gridStep);

  for (let i = 0; i < steps * steps; i++) {
    if (rng() > 0.12) continue;
    const x = randRange(rng, -WORLD_HALF, WORLD_HALF);
    const z = randRange(rng, -WORLD_HALF, WORLD_HALF);
    if (Math.hypot(x - BASE_POSITION.x, z - BASE_POSITION.z) < BASE_CLEAR_RADIUS) continue;
    if (isOccupied(x, z, 4)) continue;
    if (highways.some((h) => distanceToPolyline(x, z, h) < HIGHWAY_WIDTH / 2 + 6)) continue;
    if (bunkers.some((b) => Math.hypot(b.position.x - x, b.position.z - z) < 20)) continue;

    const name = names[Math.floor(rng() * names.length)];
    const tree = assets.cloneTree(name);
    tree.scale.setScalar(randRange(rng, TREE_SCALE_MIN, TREE_SCALE_MAX));
    tree.rotation.y = randRange(rng, 0, Math.PI * 2);
    tree.position.set(x, surfaceHeightAt(x, z), z);
    scene.add(tree);
  }
}

function placeEnemySpawns(): EnemySpawnPoint[] {
  const rng = mulberry32(WORLD_SEED + 97);
  const spawns: EnemySpawnPoint[] = [];
  let attempts = 0;

  while (spawns.length < MAX_ENEMIES && attempts < 500) {
    attempts++;
    const x = randRange(rng, -WORLD_HALF * 0.85, WORLD_HALF * 0.85);
    const z = randRange(rng, -WORLD_HALF * 0.85, WORLD_HALF * 0.85);
    if (Math.hypot(x - BASE_POSITION.x, z - BASE_POSITION.z) < ENEMY_MIN_DIST_FROM_BASE) continue;
    if (isOccupied(x, z, 10)) continue;
    if (spawns.some((s) => Math.hypot(x - s.x, z - s.z) < ENEMY_MIN_DIST_APART)) continue;

    spawns.push({
      x,
      z,
      patrolCenter: new THREE.Vector3(x, 0, z),
      patrolRadius: randRange(rng, 60, 120),
      facing: randRange(rng, 0, Math.PI * 2),
    });
  }

  // Extra tanks guarding the landmarks (on top of the roaming ones).
  for (const site of SITES) {
    const half = siteLocalHalf(site);
    const spots = site.kind === 'airport' ? [[-120, 20], [120, 20]] : [[0, half.z + 30]];
    for (const [lx, lz] of spots) {
      const p = siteToWorld(site, lx, lz);
      spawns.push({
        x: p.x,
        z: p.z,
        patrolCenter: new THREE.Vector3(p.x, 0, p.z),
        patrolRadius: site.kind === 'airport' ? 120 : 50,
        facing: rng() * Math.PI * 2,
      });
    }
  }

  return spawns;
}
