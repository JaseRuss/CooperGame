import * as THREE from 'three';
import type { Building } from './Building';
import { TOWNS, distanceToTown, type Town } from './TownPlan';
import { surfaceHeightAt } from './Terrain';
import { mulberry32 } from '../utils/rng';
import { WORLD_SEED } from '../core/config';

/**
 * The zombie mission's overrun towns: some houses already flattened, fires burning in the rubble
 * and on the rooftops, smoke drifting up from each, and a warm flickering glow over the town.
 */

/** Share of the towns that have been overrun, and of their houses already knocked down. */
const OVERRUN_SHARE = 0.65;
const WRECKED_SHARE = 0.35;
const FIRES_PER_TOWN = 10;
/** Fires only smoke within this distance of the player (the fog hides the rest). */
const SMOKE_RANGE = 900;
const SMOKE_INTERVAL = 0.55;

const FLAME = new THREE.ConeGeometry(1, 2.4, 7, 1, true).translate(0, 1.2, 0);
const FLAME_OUTER = new THREE.MeshBasicMaterial({ color: 0xff5a14, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const FLAME_INNER = new THREE.MeshBasicMaterial({ color: 0xffd04a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const EMBERS = new THREE.MeshBasicMaterial({ color: 0x3a1a0a });

interface Fire {
  group: THREE.Group;
  tongues: THREE.Mesh[];
  /** The house it's burning on, if it's on a roof: it drops to the ground when the house comes down. */
  on: Building | null;
  size: number;
  phase: number;
  smoke: number;
}

export class OverrunTowns {
  /** Middles of the overrun towns (a few zombies hang about in each). */
  readonly centres: THREE.Vector2[] = [];
  private readonly fires: Fire[] = [];
  private readonly glows: { light: THREE.PointLight; base: number; phase: number }[] = [];
  private time = 0;

  constructor(private readonly scene: THREE.Scene, buildings: Building[]) {
    const rng = mulberry32(WORLD_SEED + 4242);
    for (const town of TOWNS) {
      if (rng() > OVERRUN_SHARE) continue;
      this.centres.push(new THREE.Vector2(town.cx, town.cz));
      const houses = buildings.filter((b) => !b.destroyed && distanceToTown(town, b.center.x, b.center.z) === 0);
      for (const b of houses) if (rng() < WRECKED_SHARE) b.takeDamage(b.health + 1);
      this.lightTown(town, houses, rng);
    }
  }

  private lightTown(town: Town, houses: Building[], rng: () => number): void {
    const shuffled = [...houses].sort(() => rng() - 0.5).slice(0, FIRES_PER_TOWN);
    for (const b of shuffled) {
      // Fires in the rubble, or on the roof of a house that's still standing.
      const roof = !b.destroyed;
      const size = roof ? 1.8 + rng() * 1.2 : 2.2 + rng() * 1.8;
      const x = b.center.x + (rng() - 0.5) * b.halfExtents.x;
      const z = b.center.z + (rng() - 0.5) * b.halfExtents.z;
      const y = roof ? b.center.y + b.halfExtents.y * 0.6 : surfaceHeightAt(x, z);
      this.fires.push(this.makeFire(x, y, z, size, roof ? b : null, rng));
    }
    // A flickering orange glow over the middle of the town.
    const light = new THREE.PointLight(0xff7a2a, 0, 110, 1.2);
    light.position.set(town.cx, surfaceHeightAt(town.cx, town.cz) + 14, town.cz);
    this.scene.add(light);
    this.glows.push({ light, base: 260, phase: rng() * 10 });
  }

  private makeFire(x: number, y: number, z: number, size: number, on: Building | null, rng: () => number): Fire {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const tongues: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const outer = new THREE.Mesh(FLAME, FLAME_OUTER);
      const a = (i / 4) * Math.PI * 2 + rng();
      const r = i === 0 ? 0 : 0.6;
      outer.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      outer.scale.setScalar(i === 0 ? 1 : 0.65);
      const inner = new THREE.Mesh(FLAME, FLAME_INNER);
      inner.scale.set(0.5, 0.6, 0.5);
      outer.add(inner);
      group.add(outer);
      tongues.push(outer);
    }
    if (!on) {
      // A heap of charred timbers under a fire on the ground.
      for (let i = 0; i < 4; i++) {
        const log = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 2.4), EMBERS);
        log.rotation.y = (i / 4) * Math.PI + rng() * 0.3;
        log.position.y = 0.15 + (i % 2) * 0.25;
        group.add(log);
      }
    }
    group.scale.setScalar(size);
    this.scene.add(group);
    return { group, tongues, on, size, phase: rng() * 10, smoke: rng() * SMOKE_INTERVAL };
  }

  update(dt: number, player: THREE.Vector3, puff: (point: THREE.Vector3, radius: number) => void): void {
    this.time += dt;
    for (const f of this.fires) {
      if (f.on?.destroyed) {
        // The house came down under it: it carries on burning in the rubble.
        f.group.position.y = surfaceHeightAt(f.group.position.x, f.group.position.z);
        f.on = null;
      }
      f.tongues.forEach((t, i) => {
        const k = this.time * (7 + i * 1.3) + f.phase + i;
        t.scale.y = (i === 0 ? 1 : 0.65) * (0.8 + 0.35 * Math.abs(Math.sin(k)) + Math.random() * 0.1);
        t.rotation.y += dt * (i % 2 ? 2 : -2);
      });
      f.smoke -= dt;
      if (f.smoke <= 0) {
        f.smoke = SMOKE_INTERVAL;
        if (f.group.position.distanceTo(player) < SMOKE_RANGE) {
          puff(f.group.position.clone().add(new THREE.Vector3(0, 2.6 * f.size, 0)), 0.9 * f.size);
        }
      }
    }
    for (const g of this.glows) {
      g.light.intensity = g.base * (0.8 + 0.2 * Math.sin(this.time * 9 + g.phase) + 0.1 * Math.sin(this.time * 23 + g.phase));
    }
  }
}
