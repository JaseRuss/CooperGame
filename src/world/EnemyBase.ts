import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { AssetLibrary } from './AssetLibrary';
import type { Building } from './Building';
import { Bunker } from './Bunker';
import type { HitRegistry } from '../combat/HitRegistry';
import { heightAt } from './Terrain';
import { siteToWorld, siteYaw, ENEMY_BASE_HALF, type Site } from './Landmarks';
import { plantBuilding } from './placeModel';
import { instanceTemplate, placement } from '../utils/instancing';
import { plastic, shade, ARMY_TAN } from '../utils/plastic';

export interface Objective {
  label: string;
  position: THREE.Vector3;
  isDestroyed: () => boolean;
}

interface ModelTarget {
  label: string;
  model: string;
  lx: number;
  lz: number;
  scale: number;
  hp: number;
  fuel?: boolean;
  smoke?: boolean;
}

// Local layout: the gate is on the +Z edge, a road runs from it to the middle of the compound.
const TARGETS: ModelTarget[] = [
  { label: 'Factory', model: 'building-l', lx: -38, lz: -40, scale: 11, hp: 320 },
  { label: 'Warehouse', model: 'building-r', lx: 36, lz: -44, scale: 10, hp: 260 },
  { label: 'Smokestack', model: 'chimney-large', lx: -8, lz: -52, scale: 10, hp: 140, smoke: true },
  { label: 'Fuel Tank', model: 'detail-tank-large', lx: -48, lz: 22, scale: 8, hp: 90, fuel: true },
  { label: 'Fuel Tank', model: 'detail-tank-large', lx: -48, lz: 46, scale: 8, hp: 90, fuel: true },
  { label: 'Water Tower', model: 'water-tower', lx: 48, lz: 42, scale: 10, hp: 120 },
];
const CONTAINERS: [string, number, number, number][] = [
  ['shipping-container-a', 20, 54, 0],
  ['shipping-container-b', 30, 54, 0],
  ['shipping-container-c', 25, 64, Math.PI / 2],
];
const FENCE_INSET = 72;
const GATE_HALF = 10;
const PROP_SCALE = 12;
const SMOKE_INTERVAL = 0.35;

function flagTexture(captured: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = captured ? '#4b7a2e' : '#c4a468';
  ctx.fillRect(0, 0, 256, 160);
  if (captured) {
    ctx.fillStyle = '#f4f1e4';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 52 : 21;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(128 + Math.cos(a) * r, 84 + Math.sin(a) * r);
    }
    ctx.fill();
  } else {
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath();
    ctx.arc(128, 80, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c4a468';
    ctx.fillRect(84, 72, 88, 16);
    ctx.fillRect(120, 36, 16, 88);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A tan army compound. It's knocked out once every objective inside is destroyed. */
export class EnemyBase {
  readonly name: string;
  readonly center: THREE.Vector3;
  readonly objectives: Objective[] = [];
  readonly buildings: Building[] = [];
  readonly bunker: Bunker;
  private readonly smokestacks: { building: Building; top: THREE.Vector3; timer: number }[] = [];
  private readonly radarDish: THREE.Object3D;
  private readonly flagMaterial: THREE.MeshStandardMaterial;
  private captured = false;

  constructor(
    world: RAPIER.World,
    private readonly scene: THREE.Scene,
    hitRegistry: HitRegistry,
    assets: AssetLibrary,
    private readonly site: Site,
  ) {
    this.name = site.name;
    const yaw = siteYaw(site);
    const ground = heightAt(site.cx, site.cz);
    this.center = new THREE.Vector3(site.cx, ground, site.cz);
    const at = (lx: number, lz: number) => siteToWorld(site, lx, lz);

    this.buildGround(yaw, ground);
    this.buildFence(assets, yaw);
    this.buildGate(assets, yaw);

    for (const t of TARGETS) {
      const p = at(t.lx, t.lz);
      const b = plantBuilding(world, scene, hitRegistry, assets.clone('industrial', t.model), p.x, p.z, yaw, t.scale, t.hp, t.fuel ? 0x6a6a6a : 0x9c9478);
      if (t.fuel) b.explosionSize = 4;
      this.buildings.push(b);
      this.objectives.push({ label: t.label, position: b.center, isDestroyed: () => b.destroyed });
      if (t.smoke) {
        this.smokestacks.push({ building: b, top: new THREE.Vector3(b.center.x, b.center.y + b.halfExtents.y + 1, b.center.z), timer: 0 });
      }
    }

    for (const [model, lx, lz, turn] of CONTAINERS) {
      const p = at(lx, lz);
      this.buildings.push(plantBuilding(world, scene, hitRegistry, assets.clone('industrial', model), p.x, p.z, yaw + turn, 11, 40, 0x7a5a3a));
    }

    // Radar mast with a spinning dish.
    const radar = new THREE.Group();
    const tan = plastic(ARMY_TAN);
    const dark = plastic(shade(ARMY_TAN, 0.6));
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 10, 0.3), dark);
      leg.position.set(x, 5, z);
      leg.castShadow = true;
      radar.add(leg);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 3.4), tan);
    deck.position.y = 10;
    radar.add(deck);
    this.radarDish = new THREE.Group();
    this.radarDish.position.y = 11;
    radar.add(this.radarDish);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), tan);
    dish.rotation.x = -Math.PI / 2 + 0.4;
    dish.position.set(0, 1.2, 0.8);
    dish.castShadow = true;
    this.radarDish.add(dish);
    const rp = at(34, 8);
    const radarBuilding = plantBuilding(world, scene, hitRegistry, radar, rp.x, rp.z, yaw, 1, 80, ARMY_TAN);
    this.buildings.push(radarBuilding);
    this.objectives.push({ label: 'Radar', position: radarBuilding.center, isDestroyed: () => radarBuilding.destroyed });

    // Command bunker facing the gate (its gun slit is on its local -Z).
    const bp = at(0, -2);
    this.bunker = new Bunker(world, scene, hitRegistry, bp.x, bp.z, yaw + Math.PI);
    this.objectives.push({ label: 'Command Bunker', position: this.bunker.position, isDestroyed: () => !this.bunker.alive });

    // Flag: tan while held, green once captured.
    const fp = at(-14, 58);
    const fy = heightAt(fp.x, fp.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 12, 8), plastic(0xd8d8d0));
    pole.position.set(fp.x, fy + 6, fp.z);
    pole.castShadow = true;
    scene.add(pole);
    this.flagMaterial = new THREE.MeshStandardMaterial({ map: flagTexture(false), side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5).translate(2, 0, 0), this.flagMaterial);
    flag.position.set(fp.x + 0.15, fy + 10.6, fp.z);
    flag.rotation.y = yaw;
    flag.castShadow = true;
    scene.add(flag);
  }

  private buildGround(yaw: number, ground: number): void {
    const g = new THREE.Group();
    g.position.set(this.site.cx, ground, this.site.cz);
    g.rotation.y = yaw;
    this.scene.add(g);
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(ENEMY_BASE_HALF * 2 - 4, ENEMY_BASE_HALF * 2 - 4),
      new THREE.MeshStandardMaterial({ color: 0xa89c7c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.05;
    pad.receiveShadow = true;
    g.add(pad);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(12, ENEMY_BASE_HALF),
      new THREE.MeshStandardMaterial({ color: 0x45484d, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.07, ENEMY_BASE_HALF / 2);
    road.receiveShadow = true;
    g.add(road);
  }

  /** Construction-fence panels around the edge, with a gap for the gate. */
  private buildFence(assets: AssetLibrary, yaw: number): void {
    const panel = 0.38 * PROP_SCALE;
    const placements: THREE.Matrix4[] = [];
    const add = (lx: number, lz: number, turn: number) => {
      const p = siteToWorld(this.site, lx, lz);
      placements.push(placement(p.x, heightAt(p.x, p.z), p.z, yaw + turn, PROP_SCALE));
    };
    for (let s = -FENCE_INSET; s <= FENCE_INSET; s += panel) {
      add(-FENCE_INSET, s, 0);
      add(FENCE_INSET, s, 0);
      add(s, -FENCE_INSET, Math.PI / 2);
      if (Math.abs(s) > GATE_HALF) add(s, FENCE_INSET, Math.PI / 2);
    }
    this.scene.add(instanceTemplate(assets.template('prop', 'construction-fence'), placements));
  }

  /** Checkpoint: barriers, warning lights, cones and a warning sign at the gate. */
  private buildGate(assets: AssetLibrary, yaw: number): void {
    const put = (lx: number, lz: number, turn: number) => {
      const p = siteToWorld(this.site, lx, lz);
      return placement(p.x, heightAt(p.x, p.z), p.z, yaw + turn, PROP_SCALE);
    };
    const z = FENCE_INSET + 2;
    const add = (model: string, spots: THREE.Matrix4[]) => this.scene.add(instanceTemplate(assets.template('prop', model), spots));
    add('construction-barrier', [put(-GATE_HALF - 2, z, Math.PI / 2), put(GATE_HALF + 2, z, Math.PI / 2)]);
    add('construction-light', [put(-GATE_HALF, z + 1, 0), put(GATE_HALF, z + 1, 0)]);
    add('construction-cone', [-6, -2, 2, 6].map((x) => put(x, z + 6, 0)));
    add('road-sign-warning', [put(GATE_HALF + 5, z + 3, Math.PI)]);
  }

  get remaining(): number {
    return this.objectives.filter((o) => !o.isDestroyed()).length;
  }

  get isDestroyed(): boolean {
    return this.remaining === 0;
  }

  update(dt: number, emitSmoke: (point: THREE.Vector3, radius: number) => void): void {
    this.radarDish.rotation.y += dt * 1.1;
    for (const s of this.smokestacks) {
      if (s.building.destroyed) continue;
      s.timer -= dt;
      if (s.timer <= 0) {
        s.timer = SMOKE_INTERVAL;
        emitSmoke(s.top, 1.2);
      }
    }
    if (!this.captured && this.isDestroyed) {
      this.captured = true;
      this.flagMaterial.map?.dispose();
      this.flagMaterial.map = flagTexture(true);
      this.flagMaterial.needsUpdate = true;
    }
  }
}
