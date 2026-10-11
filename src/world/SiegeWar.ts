import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { FRIENDLY_BASES, FORTRESS_HALF, WORLD_HALF, nearestFriendlyBase, type FriendlyBase } from '../core/config';
import { ARMY_GREEN, ENEMY_ARMY_COLOR, ENEMY_ARMY_NAME } from '../utils/plastic';
import { heightAt } from './Terrain';
import { isInLandmark, ENEMY_BASE_HALF } from './Landmarks';
import { isInAnyTown } from './TownPlan';
import { inMoat } from './MoatShape';
import { distanceToPolyline, type Polyline } from './RoadNetwork';
import { routeRoundMoat } from './MoatShape';
import { Prison } from './Prison';
import { PrisonWagon, type WagonContext } from './PrisonWagon';
import type { EnemyBase } from './EnemyBase';
import type { Fortress } from './Fortress';
import type { SquadSpawn, TroopManager } from '../entities/TroopManager';
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
/** How far inside a family base's wall the freed soldiers make for. */
const BASE_INSIDE = 40;
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

/** The freed soldiers' march: metres a second, how many of them are shown (the rest are too many to fight with), and how tough each is. */
const WAVE_SPEED = 7;
const WAVE_MAX = 14;
const WAVE_HP = 2;
/** The guards who chase them out of the prison, and how fast they go. */
const CHASERS = 6;
const CHASER_SPEED = 5.5;
/** Seconds they regroup at the friendly base before setting off for a castle. */
const REGROUP_TIME = 10;
/** Seconds at the castle before the assault is settled by numbers if the garrison hasn't been beaten on screen. */
const ASSAULT_TIME = 50;
/** Enemy soldiers within this of a castle's middle are still defending it. */
const GARRISON_RADIUS = 95;
/** Fewest survivors that can still take a castle. */
const MIN_TO_TAKE = 3;

interface Wave {
  spawn: SquadSpawn;
  size: number;
  base: FriendlyBase;
  prison: Prison;
  phase: 'escape' | 'regroup' | 'assault';
  timer: number;
  target: EnemyBase | null;
  /** The chasers, whose squad is checked for the optional "cover their escape" objective. */
  chasers: SquadSpawn;
  /** Every freed soldier who gets to the friendly base is counted once. */
  covered: boolean;
}

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
  private readonly waves: Wave[] = [];
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

  /** Enemy prisons whose prisoners have already been freed (by index into `prisons`). */
  readonly freed = new Set<number>();

  /** How many are locked up in each prison, in order, for saving. */
  heldCounts(): number[] {
    return this.prisons.map((p) => p.held);
  }

  /** Picks up where a saved game left off. */
  restore(held: number[], freed: number[]): void {
    this.prisons.forEach((p, i) => p.setHeld(held[i] ?? p.held));
    for (const i of freed) this.freed.add(i);
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

  /** The freed soldiers' wave now, for the HUD: what it's doing and how many are left, or null. */
  waveStatus(): { text: string; left: number } | null {
    const w = this.waves[0];
    if (!w) return null;
    const left = this.troops.soldiersOf(w.spawn).length;
    const chasing = this.troops.soldiersOf(w.chasers).length;
    if (w.phase === 'escape') return { text: chasing > 0 ? `COVER THEIR ESCAPE to ${w.base.name} (${chasing} chasers)` : `Escorting them to ${w.base.name}`, left };
    if (w.phase === 'regroup') return { text: `Regrouping at ${w.base.name}`, left };
    return { text: `Taking ${w.target?.title ?? 'the castle'}`, left };
  }

  /**
   * A break-out succeeded: `freed` of our soldiers run out of `prison` for the nearest friendly
   * base with guards at their heels (cover their escape, if you like). Once they've made it they
   * regroup, march on the nearest enemy castle, take it themselves, and stay there.
   */
  release(prison: Prison, freed: number): void {
    this.freed.add(this.prisons.indexOf(prison));
    prison.setHeld(Math.max(0, prison.held - freed));
    const base = nearestFriendlyBase(prison.door.x, prison.door.z);
    const size = Math.max(1, Math.min(WAVE_MAX, freed));
    const from = new THREE.Vector3(prison.door.x, 0, prison.door.z);
    const into = new THREE.Vector3(base.x, 0, base.z).sub(from).setY(0).normalize().multiplyScalar(-(BASE_INSIDE));
    const to = new THREE.Vector3(base.x, 0, base.z).add(into);
    const route = (a: THREE.Vector3, b: THREE.Vector3) => routeRoundMoat({ x: a.x, z: a.z }, { x: b.x, z: b.z }).map((q) => new THREE.Vector2(q.x, q.z));
    const spawn: SquadSpawn = {
      anchor: new THREE.Vector2(from.x, from.z),
      count: size,
      wanderRadius: 8,
      faction: 'player',
      color: ARMY_GREEN,
      holdWhile: null,
      march: { route: route(from, to), speed: WAVE_SPEED, next: 0, arrived: false },
      once: true,
      hp: WAVE_HP,
    };
    this.troops.addSquad(spawn);
    // The jailers chase them out, a little way behind.
    const behind = from.clone().addScaledVector(new THREE.Vector3(Math.sin(prison.yaw), 0, Math.cos(prison.yaw)), -26);
    const chasers: SquadSpawn = {
      anchor: new THREE.Vector2(behind.x, behind.z),
      count: CHASERS,
      wanderRadius: 6,
      faction: 'enemy',
      color: prison.color,
      holdWhile: null,
      march: { route: route(behind, to), speed: CHASER_SPEED, next: 0, arrived: false },
      once: true,
    };
    this.troops.addSquad(chasers);
    this.waves.push({ spawn, size, base, prison, phase: 'escape', timer: 0, target: null, chasers, covered: false });
    this.notices.push({ text: `${size} SOLDIERS ARE RUNNING FOR ${base.name.toUpperCase()}! COVER THEIR ESCAPE`, banner: true, sub: 'Optional: the jailers are chasing them. Keep them alive and they will take a castle for you' });
  }

  private updateWaves(dt: number): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      const left = this.troops.soldiersOf(w.spawn).length;
      if (left === 0) {
        this.notices.push({ text: w.phase === 'assault' ? 'THE FREED SOLDIERS WERE BEATEN AT THE CASTLE' : 'THE FREED SOLDIERS WERE CAUGHT', color: '#ff8a7a' });
        this.waves.splice(i, 1);
        continue;
      }
      if (w.phase === 'escape' && w.spawn.march?.arrived) {
        w.phase = 'regroup';
        w.timer = REGROUP_TIME;
        this.notices.push(
          left * 2 >= w.size
            ? { text: `COVERED THEIR ESCAPE! ${left} MADE IT TO ${w.base.name.toUpperCase()}`, color: '#9be27a' }
            : { text: `ONLY ${left} MADE IT TO ${w.base.name.toUpperCase()}`, color: '#ffd24a' },
        );
      } else if (w.phase === 'regroup') {
        w.timer -= dt;
        if (w.timer > 0) continue;
        const standing = this.enemyBases.filter((b) => !b.isDestroyed);
        const here = new THREE.Vector3(w.base.x, 0, w.base.z);
        const target = standing.sort((a, b) => a.center.distanceTo(here) - b.center.distanceTo(here))[0];
        if (!target) {
          this.waves.splice(i, 1);
          continue;
        }
        w.target = target;
        w.phase = 'assault';
        w.timer = ASSAULT_TIME;
        // Into the castle from the side they come from.
        const toward = here.clone().sub(target.center).setY(0).normalize();
        const end = target.center.clone().addScaledVector(toward, 30);
        const anchor = w.spawn.anchor;
        w.spawn.march = { route: routeRoundMoat({ x: anchor.x, z: anchor.y }, { x: end.x, z: end.z }).map((q) => new THREE.Vector2(q.x, q.z)), speed: WAVE_SPEED, next: 0, arrived: false };
        this.notices.push({ text: `THE FREED SOLDIERS ARE MARCHING ON ${target.title.toUpperCase()}! GO HELP THEM`, color: '#9be27a' });
      } else if (w.phase === 'assault' && w.spawn.march?.arrived && w.target) {
        w.timer -= dt;
        const target = w.target;
        const defenders = this.troops.activeSoldiers('enemy').filter((s) => Math.hypot(s.position.x - target.center.x, s.position.z - target.center.z) < GARRISON_RADIUS).length;
        // The garrison beaten on screen, or (too far from the player to see) settled by numbers.
        if ((defenders === 0 && ASSAULT_TIME - w.timer > 6) || w.timer <= 0) {
          if (left >= MIN_TO_TAKE) {
            target.ruin();
            this.notices.push({ text: `THE FREED SOLDIERS TOOK ${target.title.toUpperCase()}!`, banner: true, sub: 'They are holding it for you' });
          } else {
            this.notices.push({ text: 'THE FREED SOLDIERS WERE TOO FEW TO TAKE THE CASTLE', color: '#ff8a7a' });
          }
          this.waves.splice(i, 1);
        }
      }
    }
  }

  update(dt: number): SiegeNotice[] {
    this.updateWaves(dt);
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
