import * as THREE from 'three';
import type { SquadSpawn, TroopManager } from '../entities/TroopManager';
import type { Faction } from '../entities/Tank';
import type { EnemyBase } from './EnemyBase';
import { FRIENDLY_BASES, BASE_RADIUS, KNIGHTS, nearestFriendlyBase, type FriendlyBase } from '../core/config';
import { ARMY_GREEN, ENEMY_ARMY_COLOR } from '../utils/plastic';
import { routeRoundMoat } from './MoatShape';

/** Marching troops hop along at this speed (m/s): a raid crosses the map in a few minutes. */
const MARCH_SPEED = 6;
const RAID_SIZE = 6;
const ALLY_SIZE = 6;
/** Each standing enemy base sends a raid this often (seconds, random within the range). */
const RAID_EVERY: [number, number] = [70, 110];
const FIRST_RAID = 60;
/** Your family base nearest you sends a squad at the enemy this often; each captured base too, less often. */
const ALLY_EVERY = 80;
const FIRST_ALLY = 40;
const CAPTURED_EVERY = 120;
/** Most soldiers on the march for each side at once. */
const MAX_MARCHING = 30;
/** Enemy soldiers this close to a family base's middle have it under siege. */
const SIEGE_REACH = BASE_RADIUS + 12;
const DEFENDERS = 5;
const SIEGE_CHECK = 0.5;
/** Seconds between "raiders are coming" callouts, so they don't pile up. */
const RAID_NEWS_GAP = 25;

export interface WarNews {
  /** A banner (big news) or a callout. */
  banner: boolean;
  text: string;
  sub?: string;
  color?: string;
}

interface March {
  spawn: SquadSpawn;
  faction: Faction;
  /** Where it's going, for the news when it gets there. */
  target: string;
  announced: boolean;
}

const baseTitle = (b: EnemyBase) => `${KNIGHTS ? 'CASTLE' : 'BASE'} ${b.name.toUpperCase()}`;
const familyTitle = (b: FriendlyBase) => b.name.toUpperCase();

/**
 * The war going on around the player (missions 1 to 4). Nothing changes hands, but the bases keep
 * fighting: each standing enemy base sends raiding squads at the family base nearest the player,
 * and the family base nearest the player (and any captured enemy base) sends green squads at the
 * nearest enemy base. A raid that reaches a family base puts it under siege: its repairs stop and
 * its guards turn out, until the raiders are cleared. Squads march in a straight line, round the
 * Fortress's moat, carried along even when far from the player, and stop to fight whatever they meet.
 */
export class Warfront {
  private readonly raidTimers: number[];
  private allyTimer = FIRST_ALLY;
  private readonly capturedTimers = new Map<EnemyBase, number>();
  private readonly marches: March[] = [];
  private readonly besieged = new Set<FriendlyBase>();
  private siegeTimer = 0;
  private raidNewsTimer = 0;

  constructor(
    private readonly troops: TroopManager,
    private readonly enemyBases: EnemyBase[],
    private readonly rng: () => number,
  ) {
    // Staggered, so the first raids don't all set off together.
    this.raidTimers = enemyBases.map((_, i) => FIRST_RAID + i * 15 + rng() * 20);
  }

  /** True while raiders are in this family base: it can't repair. */
  isBesieged(base: FriendlyBase): boolean {
    return this.besieged.has(base);
  }

  update(dt: number, player: THREE.Vector3): WarNews[] {
    const news: WarNews[] = [];
    this.raidNewsTimer -= dt;
    const standing = this.enemyBases.filter((b) => !b.isDestroyed);
    const home = nearestFriendlyBase(player.x, player.z);

    // Enemy raids on the family base nearest the player.
    this.enemyBases.forEach((base, i) => {
      if (base.isDestroyed) return;
      this.raidTimers[i] -= dt;
      if (this.raidTimers[i] > 0) return;
      this.raidTimers[i] = RAID_EVERY[0] + this.rng() * (RAID_EVERY[1] - RAID_EVERY[0]);
      if (this.marching('enemy') + RAID_SIZE > MAX_MARCHING) return;
      this.launch(base.center, this.inside(home, base.center), 'enemy', ENEMY_ARMY_COLOR[base.army], RAID_SIZE, familyTitle(home));
      if (this.raidNewsTimer <= 0) {
        this.raidNewsTimer = RAID_NEWS_GAP;
        news.push({ banner: false, text: `RAIDERS FROM ${baseTitle(base)} ARE HEADING FOR ${familyTitle(home)}!`, color: '#ff8a7a' });
      }
    });

    // Your squads: from the family base nearest you, and from every captured enemy base.
    if (standing.length > 0) {
      this.allyTimer -= dt;
      if (this.allyTimer <= 0) {
        this.allyTimer = ALLY_EVERY;
        this.sendAllies(new THREE.Vector3(home.x, 0, home.z), standing);
      }
      for (const base of this.enemyBases) {
        if (!base.isDestroyed) continue;
        const t = (this.capturedTimers.get(base) ?? CAPTURED_EVERY / 2) - dt;
        this.capturedTimers.set(base, t > 0 ? t : CAPTURED_EVERY);
        if (t <= 0) this.sendAllies(base.center, standing.filter((b) => b !== base));
      }
    }

    // Marches that have got where they were going.
    for (let i = this.marches.length - 1; i >= 0; i--) {
      const m = this.marches[i];
      const left = this.troops.soldiersOf(m.spawn).length;
      if (left === 0) {
        this.marches.splice(i, 1);
        continue;
      }
      if (m.spawn.march?.arrived && !m.announced) {
        m.announced = true;
        if (m.faction === 'player') news.push({ banner: false, text: `YOUR TROOPS ARE ATTACKING ${m.target}! GO HELP THEM!`, color: '#9be27a' });
      }
    }

    this.siegeTimer -= dt;
    if (this.siegeTimer <= 0) {
      this.siegeTimer = SIEGE_CHECK;
      news.push(...this.checkSieges(home));
    }
    return news;
  }

  /** Soldiers of `faction` still on the march (or holding where their march ended). */
  private marching(faction: Faction): number {
    return this.marches.filter((m) => m.faction === faction).reduce((n, m) => n + this.troops.soldiersOf(m.spawn).length, 0);
  }

  /** A green squad from `from` to the nearest of `targets`. */
  private sendAllies(from: THREE.Vector3, targets: EnemyBase[]): void {
    if (targets.length === 0 || this.marching('player') + ALLY_SIZE > MAX_MARCHING) return;
    const target = targets.reduce((a, b) => (a.center.distanceTo(from) < b.center.distanceTo(from) ? a : b));
    // Into the compound, on the side they come from.
    const toward = new THREE.Vector3(from.x - target.center.x, 0, from.z - target.center.z).normalize();
    const end = target.center.clone().addScaledVector(toward, 30);
    this.launch(from, end, 'player', ARMY_GREEN, ALLY_SIZE, baseTitle(target));
  }

  /** A spot inside a family base, on the side facing `from` (in through the wall: toy soldiers climb). */
  private inside(base: FriendlyBase, from: THREE.Vector3): THREE.Vector3 {
    const d = new THREE.Vector3(from.x - base.x, 0, from.z - base.z).normalize();
    return new THREE.Vector3(base.x + d.x * (BASE_RADIUS - 18), 0, base.z + d.z * (BASE_RADIUS - 18));
  }

  private launch(from: THREE.Vector3, to: THREE.Vector3, faction: Faction, color: number, count: number, target: string): void {
    const route = routeRoundMoat({ x: from.x, z: from.z }, { x: to.x, z: to.z }).map((p) => new THREE.Vector2(p.x, p.z));
    const spawn: SquadSpawn = {
      anchor: new THREE.Vector2(from.x, from.z),
      count,
      wanderRadius: 8,
      faction,
      color,
      holdWhile: null,
      antiAir: 1,
      march: { route, speed: MARCH_SPEED, next: 0, arrived: false },
      once: true,
    };
    this.troops.addSquad(spawn);
    this.marches.push({ spawn, faction, target, announced: false });
  }

  /** Which family bases have raiders in them; the news when a siege starts or ends (big news if it's `home`). */
  private checkSieges(home: FriendlyBase): WarNews[] {
    const news: WarNews[] = [];
    const raiders = this.troops.activeSoldiers('enemy');
    for (const base of FRIENDLY_BASES) {
      const under = raiders.some((s) => Math.hypot(s.position.x - base.x, s.position.z - base.z) < SIEGE_REACH);
      if (under && !this.besieged.has(base)) {
        this.besieged.add(base);
        // The guards turn out to fight.
        this.troops.addSquad({ anchor: new THREE.Vector2(base.x, base.z), count: DEFENDERS, wanderRadius: 30, faction: 'player', color: ARMY_GREEN, holdWhile: null, once: true });
        news.push(
          base === home
            ? { banner: true, text: `${familyTitle(base)} IS UNDER ATTACK!`, sub: 'Raiders are in! Repairs there are stopped until you clear them out' }
            : { banner: false, text: `${familyTitle(base)} IS UNDER ATTACK!`, color: '#ff8a7a' },
        );
      } else if (!under && this.besieged.has(base)) {
        this.besieged.delete(base);
        news.push({ banner: false, text: `${familyTitle(base)} IS SAFE AGAIN!`, color: '#9be27a' });
      }
    }
    return news;
  }
}
