import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Soldier, type Shot } from './Soldier';
import type { Bunker } from '../world/Bunker';
import type { MapMarker } from '../ui/WorldMap';

const RESPAWN_DELAY = 45;

export interface SquadSpawn {
  anchor: THREE.Vector2;
  count: number;
  wanderRadius: number;
  /** Squads guarding a bunker stop respawning once it's destroyed. */
  bunker: Bunker | null;
}

interface Squad {
  spawn: SquadSpawn;
  soldiers: Soldier[];
  respawnTimer: number;
}

export class TroopManager {
  private readonly squads: Squad[];

  constructor(
    private readonly scene: THREE.Scene,
    spawns: SquadSpawn[],
    private readonly rng: () => number,
  ) {
    this.squads = spawns.map((spawn) => ({ spawn, soldiers: [], respawnTimer: 0 }));
    for (const squad of this.squads) this.fillSquad(squad);
  }

  private fillSquad(squad: Squad): void {
    const { anchor, count, wanderRadius } = squad.spawn;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.rng();
      const r = 2 + this.rng() * wanderRadius * 0.6;
      const soldier = new Soldier(anchor.x + Math.cos(a) * r, anchor.y + Math.sin(a) * r, anchor, wanderRadius, this.rng);
      this.scene.add(soldier.mesh);
      squad.soldiers.push(soldier);
    }
  }

  /** `friendlies`: positions of the player and buddy tanks; each soldier shoots at the nearest. */
  update(dt: number, world: RAPIER.World, friendlies: THREE.Vector3[], onShot: (shot: Shot) => void): void {
    for (const squad of this.squads) {
      for (let i = squad.soldiers.length - 1; i >= 0; i--) {
        const s = squad.soldiers[i];
        let target = friendlies[0];
        let nearest = Infinity;
        for (const f of friendlies) {
          const d = f.distanceToSquared(s.position);
          if (d < nearest) {
            nearest = d;
            target = f;
          }
        }
        const shot = s.update(dt, world, target);
        if (shot) onShot(shot);
        if (s.expired) {
          this.scene.remove(s.mesh);
          squad.soldiers.splice(i, 1);
          if (squad.soldiers.length === 0) squad.respawnTimer = RESPAWN_DELAY;
        }
      }

      if (squad.soldiers.length === 0) {
        if (squad.spawn.bunker && !squad.spawn.bunker.alive) continue;
        squad.respawnTimer -= dt;
        if (squad.respawnTimer <= 0) this.fillSquad(squad);
      }
    }
  }

  /** Knocks over every standing soldier within `radius` of `point`. Returns how many went down. */
  blast(point: THREE.Vector3, radius: number): number {
    let knocked = 0;
    for (const s of this.activeSoldiers()) {
      const d = s.position.distanceTo(point);
      if (d < radius) {
        s.knockDown(point, 1 - d / radius);
        knocked++;
      }
    }
    return knocked;
  }

  /** Soldiers the tank drives into get bowled over. Returns how many went down. */
  runOver(tankPos: THREE.Vector3, radius: number): number {
    let knocked = 0;
    for (const s of this.activeSoldiers()) {
      const dx = s.position.x - tankPos.x;
      const dz = s.position.z - tankPos.z;
      if (dx * dx + dz * dz < radius * radius && Math.abs(s.position.y - tankPos.y) < 3) {
        s.knockDown(tankPos, 0.6);
        knocked++;
      }
    }
    return knocked;
  }

  activeSoldiers(): Soldier[] {
    return this.squads.flatMap((squad) => squad.soldiers.filter((s) => s.isActive));
  }

  collectMarkers(out: MapMarker[]): void {
    for (const squad of this.squads) {
      for (const s of squad.soldiers) {
        if (s.isActive) out.push({ x: s.position.x, z: s.position.z, kind: 'troop' });
      }
    }
  }
}
