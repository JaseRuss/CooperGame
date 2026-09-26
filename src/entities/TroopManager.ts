import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Soldier, type Shot, type ZombieKind } from './Soldier';
import type { Faction } from './Tank';
import type { MapMarker } from '../ui/WorldMap';

const RESPAWN_DELAY = 45;
/** Soldiers further than this from the player stand still, to save CPU. */
const ACTIVE_RANGE = 650;

export interface SquadSpawn {
  anchor: THREE.Vector2;
  count: number;
  wanderRadius: number;
  faction: Faction;
  color: number;
  /** The squad keeps respawning only while this holds (its bunker stands, its base isn't taken). */
  holdWhile: (() => boolean) | null;
  /** A pack of zombies (never respawns; the anchor is where they're heading). */
  zombie?: ZombieKind;
}

interface Squad {
  spawn: SquadSpawn;
  soldiers: Soldier[];
  respawnTimer: number;
}

export class TroopManager {
  private readonly squads: Squad[] = [];
  /** Soldiers standing where this holds can't be targeted or hurt. */
  shielded: ((p: THREE.Vector3) => boolean) | null = null;
  /** Where zombies can't walk (the Fortress wall): they stop there and batter it. */
  blocked: ((x: number, z: number) => boolean) | null = null;
  /** Zombies knocked over so far. */
  zombiesDowned = 0;

  constructor(
    private readonly scene: THREE.Scene,
    spawns: SquadSpawn[],
    private readonly rng: () => number,
  ) {
    for (const spawn of spawns) this.addSquad(spawn);
  }

  addSquad(spawn: SquadSpawn): void {
    const squad: Squad = { spawn, soldiers: [], respawnTimer: 0 };
    this.squads.push(squad);
    this.fillSquad(squad);
  }

  /**
   * A pack of zombies that appears at (x, z) and heads for `goal`. They don't come back once
   * they're knocked over.
   */
  addZombies(x: number, z: number, goal: THREE.Vector2, kinds: ZombieKind[], color: (k: ZombieKind) => number): void {
    const squad: Squad = { spawn: { anchor: goal, count: 0, wanderRadius: 0, faction: 'enemy', color: 0, holdWhile: () => false, zombie: 'walker' }, soldiers: [], respawnTimer: 0 };
    kinds.forEach((kind, i) => {
      const a = (i / kinds.length) * Math.PI * 2 + this.rng();
      const r = 1.5 + this.rng() * 5;
      const s = new Soldier(x + Math.cos(a) * r, z + Math.sin(a) * r, goal, 0, this.rng, 'enemy', color(kind), kind);
      this.scene.add(s.mesh);
      squad.soldiers.push(s);
    });
    this.squads.push(squad);
  }

  /** Zombies still on their feet. */
  get zombiesStanding(): number {
    let n = 0;
    for (const squad of this.squads) if (squad.spawn.zombie) for (const s of squad.soldiers) if (s.isActive) n++;
    return n;
  }

  private fillSquad(squad: Squad): void {
    const { anchor, count, wanderRadius, faction, color, zombie } = squad.spawn;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.rng();
      const r = 2 + this.rng() * wanderRadius * 0.6;
      const soldier = new Soldier(anchor.x + Math.cos(a) * r, anchor.y + Math.sin(a) * r, anchor, wanderRadius, this.rng, faction, color, zombie ?? null);
      this.scene.add(soldier.mesh);
      squad.soldiers.push(soldier);
    }
  }

  /**
   * `targets[f]`: positions soldiers of faction `f` shoot at (the other side's tanks, troops and
   * bunkers); each soldier picks the nearest.
   */
  update(
    dt: number,
    world: RAPIER.World,
    playerPos: THREE.Vector3,
    targets: Record<Faction, THREE.Vector3[]>,
    onShot: (shot: Shot, faction: Faction) => void,
  ): void {
    const activeSq = ACTIVE_RANGE * ACTIVE_RANGE;
    // Backwards, since a zombie pack that's all been knocked over is dropped from the list.
    for (let q = this.squads.length - 1; q >= 0; q--) {
      const squad = this.squads[q];
      const foes = targets[squad.spawn.faction];
      for (let i = squad.soldiers.length - 1; i >= 0; i--) {
        const s = squad.soldiers[i];
        // Far-off soldiers stand still to save time, but zombies never stop coming.
        if (s.isActive && !s.zombie && s.position.distanceToSquared(playerPos) > activeSq) continue;
        let target: THREE.Vector3 | null = null;
        let nearest = Infinity;
        for (const f of foes) {
          const d = f.distanceToSquared(s.position);
          if (d < nearest) {
            nearest = d;
            target = f;
          }
        }
        const shot = s.update(dt, world, target, this.blocked ?? undefined);
        if (shot) onShot(shot, squad.spawn.faction);
        if (s.zombie && !s.isActive && !s.counted) {
          s.counted = true;
          this.zombiesDowned++;
        }
        if (s.expired) {
          this.scene.remove(s.mesh);
          squad.soldiers.splice(i, 1);
          if (squad.soldiers.length === 0) squad.respawnTimer = RESPAWN_DELAY;
        }
      }

      if (squad.soldiers.length === 0) {
        if (squad.spawn.zombie) {
          this.squads.splice(q, 1);
          continue;
        }
        if (squad.spawn.holdWhile && !squad.spawn.holdWhile()) continue;
        squad.respawnTimer -= dt;
        if (squad.respawnTimer <= 0) this.fillSquad(squad);
      }
    }
  }

  /**
   * Knocks over every standing soldier within `radius` of `point` who isn't on the attacker's side
   * (null = everyone). Returns how many went down.
   */
  blast(point: THREE.Vector3, radius: number, attacker: Faction | null): number {
    let knocked = 0;
    for (const s of this.activeSoldiers()) {
      if (s.faction === attacker) continue;
      const d = s.position.distanceTo(point);
      if (d < radius) {
        s.knockDown(point, 1 - d / radius);
        knocked++;
      }
    }
    return knocked;
  }

  /**
   * A jam splat at `point`: every standing soldier of the other side within `radius` is stuck
   * fast for `duration` seconds. Returns how many were caught.
   */
  jam(point: THREE.Vector3, radius: number, attacker: Faction, duration: number): number {
    let caught = 0;
    for (const s of this.activeSoldiers()) {
      if (s.faction === attacker) continue;
      const dx = s.position.x - point.x;
      const dz = s.position.z - point.z;
      if (dx * dx + dz * dz < radius * radius && s.jam(duration * (0.85 + Math.random() * 0.3))) caught++;
    }
    return caught;
  }

  /** A jam splat on your own side's soldiers: their rifles are gummed up for `duration`. Returns how many. */
  jamGuns(point: THREE.Vector3, radius: number, owner: Faction, duration: number): number {
    let fumbled = 0;
    for (const s of this.activeSoldiers(owner)) {
      const dx = s.position.x - point.x;
      const dz = s.position.z - point.z;
      if (dx * dx + dz * dz < radius * radius && s.jamGun(duration)) fumbled++;
    }
    return fumbled;
  }

  /** A rifle round landing at `point` drops the nearest of the other side's soldiers within `radius`. */
  shoot(point: THREE.Vector3, radius: number, attacker: Faction): void {
    let victim: Soldier | null = null;
    let nearest = radius;
    for (const s of this.activeSoldiers()) {
      if (s.faction === attacker) continue;
      const d = s.position.distanceTo(point);
      if (d < nearest) {
        nearest = d;
        victim = s;
      }
    }
    victim?.knockDown(point, 0.3);
  }

  /** The other side's soldiers that a tank drives into get bowled over. Returns how many went down. */
  runOver(tankPos: THREE.Vector3, radius: number, driver: Faction): number {
    let knocked = 0;
    for (const s of this.activeSoldiers()) {
      if (s.faction === driver) continue;
      const dx = s.position.x - tankPos.x;
      const dz = s.position.z - tankPos.z;
      if (dx * dx + dz * dz < radius * radius && Math.abs(s.position.y - tankPos.y) < 3) {
        s.knockDown(tankPos, 0.6);
        knocked++;
      }
    }
    return knocked;
  }

  /**
   * Standing soldiers that can be shot at, optionally only one side's. Soldiers `shielded` says
   * are out of reach (inside the locked Fortress) are left out, so nothing can target or hurt them.
   */
  activeSoldiers(faction?: Faction): Soldier[] {
    const out: Soldier[] = [];
    for (const squad of this.squads) {
      if (faction && squad.spawn.faction !== faction) continue;
      for (const s of squad.soldiers) if (s.isActive && !this.shielded?.(s.position)) out.push(s);
    }
    return out;
  }

  collectMarkers(out: MapMarker[]): void {
    for (const squad of this.squads) {
      const friendly = squad.spawn.faction === 'player';
      for (const s of squad.soldiers) {
        if (s.isActive) out.push({ x: s.position.x, z: s.position.z, kind: 'troop', friendly });
      }
    }
  }
}
