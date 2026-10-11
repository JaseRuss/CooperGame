import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { FRIENDLY_BASES, FORTRESS_HALF, WORLD_HALF } from '../core/config';
import { ARMY_GREEN, ENEMY_ARMY_COLOR, ENEMY_ARMY_NAME } from '../utils/plastic';
import { heightAt } from './Terrain';
import { isInLandmark, ENEMY_BASE_HALF } from './Landmarks';
import { isInAnyTown } from './TownPlan';
import { inMoat } from './MoatShape';
import { distanceToPolyline, type Polyline } from './RoadNetwork';
import { Prison } from './Prison';
import { PrisonWagon, type WagonContext } from './PrisonWagon';
import type { EnemyBase } from './EnemyBase';
import type { Fortress } from './Fortress';
import type { TroopManager } from '../entities/TroopManager';
import type { Soldier } from '../entities/Soldier';

/** A message for the HUD, in the same shape the war front uses. */
export interface SiegeNotice {
  text: string;
  banner?: boolean;
  sub?: string;
  color?: string;
}

/** Our soldiers locked up in each enemy prison at the start. */
const STARTING_PRISONERS = 8;
/** Enemy prisons will hold no more than this. */
const PRISON_LIMIT = 30;
/** A fallen soldier of ours within this of an enemy prison may be marched off to it. */
const CAPTURE_REACH = 420;
const CAPTURE_CHANCE = 0.3;
/** Seconds a downed soldier lies there before the enemy carries him off. */
const CARRY_OFF_DELAY = 2.5;
/** Keep a prison's site this far from towns, roads, lakes and castles, and at most this uneven. */
const SITE_CLEARANCE = 34;
const ROAD_CLEARANCE = 30;
const MAX_UNEVEN = 3.5;
/** A wagon's pick-up reach plus a little: a second wagon doesn't go for knights the first is already collecting. */
const WAGON_GROUP_RADIUS = 28;
/** Quiet time between "the enemy took a prisoner" messages. */
const CAPTURE_NOTICE_GAP = 45;

interface Site {
  x: number;
  z: number;
  yaw: number;
}

/**
 * The siege level's prisoners. Four prisons: two of ours down the friendly side of the map and
 * two of theirs beside the front-line castles (holding some of our soldiers from the start, and
 * getting more when enemy squads beat ours). Two wagons run between the field and our prisons,
 * collecting every knight who's surrendered and locking them up.
 */
export class SiegeWar {
  readonly prisons: Prison[] = [];
  readonly wagons: PrisonWagon[] = [];
  private readonly pendingCapture: { soldier: Soldier; delay: number }[] = [];
  private captureNoticeTimer = 0;
  private readonly notices: SiegeNotice[] = [];
  private readonly context: WagonContext;

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    private readonly troops: TroopManager,
    private readonly enemyBases: EnemyBase[],
    private readonly fortress: Fortress,
    highways: Polyline[],
  ) {
    const clear = (x: number, z: number, yaw: number) => this.isClear(x, z, yaw, highways);
    // The two enemy castles nearest our end of the map hold our prisoners.
    const home = FRIENDLY_BASES[0];
    const front = [...enemyBases].sort((a, b) => b.center.z - a.center.z).slice(0, 2);
    for (const base of front) {
      const site = findSite(base.center.x, base.center.z, ENEMY_BASE_HALF + 46, Math.atan2(home.x - base.center.x, home.z - base.center.z), clear);
      this.prisons.push(
        new Prison(world, scene, {
          ...site,
          side: 'enemy',
          color: ENEMY_ARMY_COLOR[base.army],
          name: `${ENEMY_ARMY_NAME[base.army]} jail`,
          held: STARTING_PRISONERS,
        }),
      );
    }
    // Two of ours, on the friendly side of the map: by the bottom corner bases, toward the middle.
    const corners = FRIENDLY_BASES.filter((b) => b.z > 0 && b !== home);
    corners.forEach((base, i) => {
      const site = findSite(base.x, base.z, 150, Math.atan2(-base.x, -base.z), clear);
      this.prisons.push(new Prison(world, scene, { ...site, side: 'friendly', color: ARMY_GREEN, name: i === 0 ? 'West stockade' : 'East stockade', held: 0 }));
    });
    // A wagon starts at each of our prisons.
    for (const prison of this.friendlyPrisons) {
      const wagon = new PrisonWagon(scene, prison.door, prison.yaw + Math.PI);
      wagon.onDelivered = (count, p) => this.notices.push({ text: `${count} PRISONER${count === 1 ? '' : 'S'} LOCKED UP IN THE ${p.name.toUpperCase()}`, color: '#9be27a' });
      this.wagons.push(wagon);
    }
    this.context = {
      troops,
      prisons: this.friendlyPrisons,
      nextCaptive: (from, wagon) => this.nextCaptive(from, wagon),
      reachable: (s) => this.reachable(s),
    };
    troops.onSoldierDown = (s) => this.soldierDown(s);
  }

  get friendlyPrisons(): Prison[] {
    return this.prisons.filter((p) => p.side === 'friendly');
  }

  get enemyPrisons(): Prison[] {
    return this.prisons.filter((p) => p.side === 'enemy');
  }

  /** Knights locked up in our prisons so far. */
  get captives(): number {
    return this.friendlyPrisons.reduce((n, p) => n + p.held, 0);
  }

  /** Our soldiers still locked up in theirs. */
  get ours(): number {
    return this.enemyPrisons.reduce((n, p) => n + p.held, 0);
  }

  update(dt: number): SiegeNotice[] {
    this.captureNoticeTimer = Math.max(0, this.captureNoticeTimer - dt);
    for (const wagon of this.wagons) wagon.update(dt, this.context);
    for (let i = this.pendingCapture.length - 1; i >= 0; i--) {
      const c = this.pendingCapture[i];
      c.delay -= dt;
      if (c.delay > 0) continue;
      this.pendingCapture.splice(i, 1);
      const prison = this.nearestEnemyPrison(c.soldier.position);
      if (!prison || prison.held >= PRISON_LIMIT) continue;
      this.troops.take(c.soldier);
      prison.admit(1);
      if (this.captureNoticeTimer <= 0) {
        this.captureNoticeTimer = CAPTURE_NOTICE_GAP;
        this.notices.push({ text: `THE ENEMY TOOK ONE OF OURS TO THE ${prison.name.toUpperCase()}`, color: '#ff9a5a' });
      }
    }
    return this.notices.splice(0);
  }

  private nearestEnemyPrison(p: THREE.Vector3): Prison | null {
    let best: Prison | null = null;
    let bestD = CAPTURE_REACH;
    for (const prison of this.enemyPrisons) {
      const d = Math.hypot(prison.center.x - p.x, prison.center.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = prison;
      }
    }
    return best;
  }

  /** One of our soldiers has been beaten: sometimes the enemy carries him off. */
  private soldierDown(s: Soldier): void {
    if (s.faction !== 'player' || Math.random() > CAPTURE_CHANCE) return;
    if (!this.nearestEnemyPrison(s.position)) return;
    this.pendingCapture.push({ soldier: s, delay: CARRY_OFF_DELAY });
  }

  /** The nearest surrendered soldier no other wagon is already after. */
  private nextCaptive(from: THREE.Vector3, wagon: PrisonWagon): Soldier | null {
    // Another wagon's already going for him, or for the group he's standing with.
    const taken = this.wagons.filter((w) => w !== wagon && w.target).map((w) => (w.target as Soldier).position);
    let best: Soldier | null = null;
    let bestD = Infinity;
    for (const s of this.troops.surrendered()) {
      if (taken.some((t) => t.distanceTo(s.position) < WAGON_GROUP_RADIUS) || !this.reachable(s)) continue;
      const d = from.distanceToSquared(s.position);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** A surrendered soldier a wagon can get to: not behind the walls of a castle that's still standing. */
  private reachable(s: Soldier): boolean {
    const { x, z } = s.position;
    for (const b of this.enemyBases) {
      if (!b.isDestroyed && Math.abs(x - b.center.x) < ENEMY_BASE_HALF + 8 && Math.abs(z - b.center.z) < ENEMY_BASE_HALF + 8) return false;
    }
    const f = this.fortress;
    if (!f.isDestroyed && Math.abs(x - f.center.x) < FORTRESS_HALF + 10 && Math.abs(z - f.center.z) < FORTRESS_HALF + 10) return false;
    return true;
  }

  /** True when a prison (tower behind, yard in front) fits at (x, z) facing `yaw`. */
  private isClear(x: number, z: number, yaw: number, highways: Polyline[]): boolean {
    if (Math.abs(x) > WORLD_HALF - 120 || Math.abs(z) > WORLD_HALF - 120) return false;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // Centre, the yard's gate, and the tower's back corner.
    const points = [
      [0, 0],
      [0, 20],
      [0, -9],
      [-11, 13],
      [11, 13],
    ].map(([lx, lz]) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos }));
    const heights = points.map((p) => heightAt(p.x, p.z));
    if (Math.max(...heights) - Math.min(...heights) > MAX_UNEVEN) return false;
    for (const p of points) {
      if (isInAnyTown(p.x, p.z, SITE_CLEARANCE) || isInLandmark(p.x, p.z, SITE_CLEARANCE) || inMoat(p.x, p.z, SITE_CLEARANCE)) return false;
      if (highways.some((h) => distanceToPolyline(p.x, p.z, h) < ROAD_CLEARANCE)) return false;
    }
    return !this.prisons.some((q) => Math.hypot(q.center.x - x, q.center.z - z) < 90);
  }
}

/**
 * Looks round (cx, cz) at `radius`, starting along the bearing `facing` (atan2(dx, dz)) and
 * fanning out to either side, for a clear spot. The prison's front looks outward along the
 * bearing it was found on, so its yard faces away from the centre it was placed round.
 */
function findSite(cx: number, cz: number, radius: number, facing: number, clear: (x: number, z: number, yaw: number) => boolean): Site {
  const spread = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3, 1.8, -1.8, 2.4, -2.4, Math.PI];
  for (const rScale of [1, 1.25, 0.85, 1.5]) {
    for (const off of spread) {
      const a = facing + off;
      const x = cx + Math.sin(a) * radius * rScale;
      const z = cz + Math.cos(a) * radius * rScale;
      if (clear(x, z, a)) return { x, z, yaw: a };
    }
  }
  return { x: cx + Math.sin(facing) * radius, z: cz + Math.cos(facing) * radius, yaw: facing };
}
