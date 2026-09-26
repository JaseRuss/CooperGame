import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { AssetLibrary } from './AssetLibrary';
import type { Building } from './Building';
import { Bunker } from './Bunker';
import { AAGun } from './AAGun';
import { NIGHT, KNIGHTS } from '../core/config';
import type { HitRegistry } from '../combat/HitRegistry';
import { heightAt } from './Terrain';
import { siteToWorld, siteYaw, enemyArmyOfSite, ENEMY_BASE_HALF, type Site } from './Landmarks';
import { plantBuilding } from './placeModel';
import { instanceTemplate, placement } from '../utils/instancing';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade, ENEMY_ARMY_COLOR, ENEMY_ARMY_NAME, type EnemyArmy } from '../utils/plastic';
import {
  buildWallSegment,
  buildRoundTower,
  buildGateTower,
  buildGateArch,
  buildKeep,
  buildGreatHall,
  buildForge,
  buildPowderStore,
  buildWatchtower,
  buildTrebuchet,
  buildHayCart,
  STONE_DARK,
} from './Medieval';

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
  // Fuel tanks go up from one shell; the water tower takes two.
  { label: 'Fuel Tank', model: 'detail-tank-large', lx: -48, lz: 22, scale: 8, hp: 20, fuel: true },
  { label: 'Fuel Tank', model: 'detail-tank-large', lx: -48, lz: 46, scale: 8, hp: 20, fuel: true },
  { label: 'Water Tower', model: 'water-tower', lx: 48, lz: 42, scale: 10, hp: 45 },
];
const CONTAINERS: [string, number, number, number][] = [
  ['shipping-container-a', 20, 54, 0],
  ['shipping-container-b', 30, 54, 0],
  ['shipping-container-c', 25, 64, Math.PI / 2],
];
const FENCE_INSET = 72;
const GATE_HALF = 10;
// Castles (knights mission): the curtain wall runs round the same line as the fence.
const TOWER_RADIUS = 6.5;
const GATE_TOWER_X = GATE_HALF + 4.5;
const WALL_HP = 150;
const TOWER_HP = 220;
const PROP_SCALE = 12;
const SMOKE_INTERVAL = 0.35;

function flagTexture(owner: EnemyArmy | 'captured'): THREE.CanvasTexture {
  const captured = owner === 'captured';
  const cloth = captured ? '#4b7a2e' : '#' + ENEMY_ARMY_COLOR[owner].toString(16).padStart(6, '0');
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = cloth;
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
    ctx.fillStyle = cloth;
    ctx.fillRect(84, 72, 88, 16);
    ctx.fillRect(120, 36, 16, 88);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A tan or blue army compound. It's knocked out once every objective inside is destroyed. */
export class EnemyBase {
  readonly name: string;
  readonly army: EnemyArmy;
  readonly center: THREE.Vector3;
  readonly objectives: Objective[] = [];
  readonly buildings: Building[] = [];
  readonly bunker: Bunker;
  /** The flak gun that lights up the night sky with tracer (night mission only). */
  readonly aaGun: AAGun | null = null;
  private readonly smokestacks: { building: Building; top: THREE.Vector3; timer: number }[] = [];
  /** The spinning radar dish, or on a castle the trebuchet's rocking arm. */
  private radarDish: THREE.Object3D | null = null;
  private trebuchetArm: THREE.Object3D | null = null;
  /** A castle's gate arch, which comes down when either gate tower does. */
  private gateArch: { mesh: THREE.Object3D; towers: Building[] } | null = null;
  private time = 0;
  private readonly flagMaterial: THREE.MeshStandardMaterial;
  private captured = false;

  constructor(
    world: RAPIER.World,
    private readonly scene: THREE.Scene,
    hitRegistry: HitRegistry,
    assets: AssetLibrary,
    readonly site: Site,
  ) {
    this.name = site.name;
    this.army = enemyArmyOfSite(site);
    const armyColor = ENEMY_ARMY_COLOR[this.army];
    const yaw = siteYaw(site);
    const ground = heightAt(site.cx, site.cz);
    this.center = new THREE.Vector3(site.cx, ground, site.cz);
    const at = (lx: number, lz: number) => siteToWorld(site, lx, lz);

    if (KNIGHTS) this.buildCastle(world, hitRegistry, yaw, ground, armyColor);
    else this.buildCompound(world, hitRegistry, assets, yaw, ground, armyColor);

    // Command bunker facing the gate (its gun slit is on its local -Z).
    const bp = at(0, -2);
    this.bunker = new Bunker(world, scene, hitRegistry, bp.x, bp.z, yaw + Math.PI, 'enemy', armyColor);
    this.objectives.push({ label: KNIGHTS ? 'Guardhouse' : 'Command Bunker', position: this.bunker.position, isDestroyed: () => !this.bunker.alive });

    if (NIGHT) {
      const ap = at(-22, 30);
      const gun = new AAGun(world, scene, hitRegistry, ap.x, ap.z, armyColor);
      this.aaGun = gun;
      this.buildings.push(gun.building);
      this.objectives.push({ label: 'AA Gun', position: gun.position, isDestroyed: () => !gun.alive });
    }

    // The army's own shells never hurt its compound.
    for (const b of this.buildings) b.faction = 'enemy';

    // Flag: the army's colour while held, green once captured.
    const fp = at(-14, 58);
    const fy = heightAt(fp.x, fp.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 12, 8), plastic(0xd8d8d0));
    pole.position.set(fp.x, fy + 6, fp.z);
    pole.castShadow = true;
    scene.add(pole);
    this.flagMaterial = new THREE.MeshStandardMaterial({ map: flagTexture(this.army), side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5).translate(2, 0, 0), this.flagMaterial);
    flag.position.set(fp.x + 0.15, fy + 10.6, fp.z);
    flag.rotation.y = yaw;
    flag.castShadow = true;
    scene.add(flag);
  }

  /** The modern army compound: a fenced yard of industrial buildings, fuel tanks and a radar mast. */
  private buildCompound(world: RAPIER.World, hitRegistry: HitRegistry, assets: AssetLibrary, yaw: number, ground: number, armyColor: number): void {
    const scene = this.scene;
    const at = (lx: number, lz: number) => siteToWorld(this.site, lx, lz);
      this.buildGround(yaw, ground);
      this.buildFence(assets, yaw);
      this.buildGate(assets, yaw);

      for (const t of TARGETS) {
        const p = at(t.lx, t.lz);
        const b = plantBuilding(world, scene, hitRegistry, assets.clone('industrial', t.model), p.x, p.z, yaw, t.scale, t.hp, t.fuel ? 0x6a6a6a : 0x9c9478);
        if (t.fuel) b.fuel = true;
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
      const tan = plastic(armyColor);
      const dark = plastic(shade(armyColor, 0.6));
      // Lattice mast tapering to a railed deck, with an equipment hut at its foot.
      const mast = new PartBuilder();
      const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
      const foot = 1.8;
      const head = 1.1;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 4];
        mast.beam(v(ax * foot, 0, az * foot), v(ax * head, 10, az * head), 0.26, dark);
        for (let k = 0; k < 4; k++) {
          const y0 = k * 2.5;
          const y1 = y0 + 2.5;
          const w0 = foot + (head - foot) * (y0 / 10);
          const w1 = foot + (head - foot) * (y1 / 10);
          mast.beam(v(ax * w0, y0, az * w0), v(bx * w1, y1, bz * w1), 0.1, dark);
          mast.beam(v(bx * w0, y0, bz * w0), v(ax * w1, y1, az * w1), 0.1, dark);
          mast.beam(v(ax * w1, y1, az * w1), v(bx * w1, y1, bz * w1), 0.12, dark);
        }
      }
      mast.add(new THREE.BoxGeometry(3.4, 0.4, 3.4), tan, 0, 10, 0);
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 4];
        mast.beam(v(ax * 1.65, 11.1, az * 1.65), v(bx * 1.65, 11.1, bz * 1.65), 0.06, dark);
        mast.add(new THREE.BoxGeometry(0.06, 0.9, 0.06), dark, ax * 1.65, 10.65, az * 1.65);
      }
      mast.add(new THREE.BoxGeometry(3, 2.2, 2.2), tan, 3.2, 1.1, 0);
      mast.add(new THREE.BoxGeometry(3.2, 0.2, 2.4), dark, 3.2, 2.3, 0);
      mast.add(new THREE.BoxGeometry(0.8, 1.6, 0.06), dark, 3.2, 0.8, 1.12);
      mast.add(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), dark, 4.3, 3.8, -0.7);
      mast.buildInto(radar);

      const dish = new THREE.Group();
      this.radarDish = dish;
      dish.position.y = 11;
      radar.add(dish);
      // Ribbed dish on a yoke, with a feed horn on struts.
      const dishParts = new PartBuilder();
      const tilt = -Math.PI / 2 + 0.4;
      dishParts.add(new THREE.SphereGeometry(3, 18, 8, 0, Math.PI * 2, 0, Math.PI / 3), tan, 0, 1.2, 0.8, tilt);
      const axis = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt); // dish's open side
      const centre = v(0, 1.2, 0.8);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rim = v(Math.cos(a) * 2.6, 1.5, Math.sin(a) * 2.6).applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt).add(centre);
        dishParts.beam(centre.clone().addScaledVector(axis, 3), rim, 0.07, dark);
      }
      dishParts.add(new THREE.CylinderGeometry(0.3, 0.2, 0.6, 10), dark, 0, 0, 0);
      dishParts.add(new THREE.BoxGeometry(0.3, 1.4, 0.3), dark, 0, 0.7, 0.3);
      const horn = centre.clone().addScaledVector(axis, 1.3);
      dishParts.add(new THREE.CylinderGeometry(0.25, 0.12, 0.5, 8), dark, horn.x, horn.y, horn.z, tilt);
      dishParts.add(new THREE.BoxGeometry(0.8, 0.8, 0.6), dark, 0, 0.6, -1.3); // counterweight
      dishParts.buildInto(dish);
      const rp = at(34, 8);
      const radarBuilding = plantBuilding(world, scene, hitRegistry, radar, rp.x, rp.z, yaw, 1, 25, armyColor); // one shell
      this.buildings.push(radarBuilding);
      this.objectives.push({ label: 'Radar', position: radarBuilding.center, isDestroyed: () => radarBuilding.destroyed });
  }

  /**
   * A stone castle (knights mission): a curtain wall of breakable sections with round corner
   * towers and a gatehouse, round a keep, a great hall, a forge, powder stores, a watchtower and
   * a trebuchet.
   */
  private buildCastle(world: RAPIER.World, hitRegistry: HitRegistry, yaw: number, ground: number, color: number): void {
    const scene = this.scene;
    const at = (lx: number, lz: number) => siteToWorld(this.site, lx, lz);
    this.buildCastleGround(yaw, ground);
    const plant = (model: THREE.Object3D, lx: number, lz: number, turn: number, hp: number, debris = STONE_DARK, scale = 1) => {
      const p = at(lx, lz);
      const b = plantBuilding(world, scene, hitRegistry, model, p.x, p.z, yaw + turn, scale, hp, debris);
      this.buildings.push(b);
      return b;
    };
    const target = (label: string, b: Building) => {
      this.objectives.push({ label, position: b.center, isDestroyed: () => b.destroyed });
      return b;
    };

    // Curtain wall: sections between the towers (outer face out), which shells can break open.
    const I = FENCE_INSET;
    const run = I - TOWER_RADIUS;
    for (const s of [-1, 1]) {
      plant(buildWallSegment(run), (s * run) / 2, -I, Math.PI, WALL_HP);
      plant(buildWallSegment(run), I, (s * run) / 2, Math.PI / 2, WALL_HP);
      plant(buildWallSegment(run), -I, (s * run) / 2, -Math.PI / 2, WALL_HP);
    }
    const front = I - TOWER_RADIUS - (GATE_TOWER_X + 4.5);
    for (const s of [-1, 1]) plant(buildWallSegment(front), s * (GATE_TOWER_X + 4.5 + front / 2), I, 0, WALL_HP);
    for (const x of [-I, I]) for (const z of [-I, I]) plant(buildRoundTower(color), x, z, 0, TOWER_HP);
    const towers = [-1, 1].map((s) => plant(buildGateTower(color), s * GATE_TOWER_X, I, 0, TOWER_HP));
    const arch = buildGateArch(GATE_TOWER_X * 2 - 9);
    const ap = at(0, I);
    arch.position.set(ap.x, heightAt(ap.x, ap.z), ap.z);
    arch.rotation.y = yaw;
    scene.add(arch);
    this.gateArch = { mesh: arch, towers };

    target('Keep', plant(buildKeep(color), -38, -38, 0, 320, STONE_DARK, 1.3)).explosionSize = 3.8;
    target('Great Hall', plant(buildGreatHall(color), 36, -44, 0, 260));
    const forge = target('Forge', plant(buildForge(), -8, -52, 0, 140));
    this.smokestacks.push({ building: forge, top: new THREE.Vector3(forge.center.x, forge.center.y + forge.halfExtents.y + 1, forge.center.z), timer: 0 });
    for (const lz of [22, 46]) target('Powder Store', plant(buildPowderStore(), -48, lz, Math.PI / 2, 20, 0x5a3b24)).fuel = true;
    target('Watchtower', plant(buildWatchtower(color), 48, 42, 0, 45, 0x5a3b24));
    const treb = buildTrebuchet(color);
    this.trebuchetArm = treb.arm;
    target('Trebuchet', plant(treb.group, 34, 8, Math.PI / 2, 25, 0x5a3b24));
    for (const [lx, lz, turn] of [[22, 58, 0.3], [32, 60, -0.2], [26, 50, Math.PI / 2]]) plant(buildHayCart(), lx, lz, turn, 40, 0x8a6a3a);
  }

  private buildCastleGround(yaw: number, ground: number): void {
    const g = new THREE.Group();
    g.position.set(this.site.cx, ground, this.site.cz);
    g.rotation.y = yaw;
    this.scene.add(g);
    const flat = (w: number, d: number, color: number, x: number, z: number, offset: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.05, z);
      m.receiveShadow = true;
      g.add(m);
    };
    flat(FENCE_INSET * 2, FENCE_INSET * 2, 0xa9a58c, 0, 0, -2); // trodden courtyard
    flat(14, ENEMY_BASE_HALF + 8, 0x9b8a6c, 0, ENEMY_BASE_HALF / 2, -3); // cobbled road in through the gate
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

  /** "Blue Army Base Bravo" ("Blue Army Castle Bravo" on the knights mission) */
  get title(): string {
    return `${ENEMY_ARMY_NAME[this.army]} ${KNIGHTS ? 'Castle' : 'Base'} ${this.name}`;
  }

  /**
   * Where the green garrison sets up once the base is taken: bunkers covering every side
   * (facing = world yaw with the gun slit outward) and squad rally points.
   */
  garrisonLayout(): {
    bunkers: { x: number; z: number; facing: number }[];
    squads: THREE.Vector2[];
    /** A clear lane beside the entry road for a changing station (jeep or chopper), parallel to the road. */
    station: { x: number; z: number; yaw: number };
  } {
    const yaw = siteYaw(this.site);
    const bunker = (lx: number, lz: number, facing: number) => ({ ...siteToWorld(this.site, lx, lz), facing: yaw + facing });
    const spot = (lx: number, lz: number) => {
      const p = siteToWorld(this.site, lx, lz);
      return new THREE.Vector2(p.x, p.z);
    };
    return {
      // Gun slits sit on a bunker's local -Z: facing 0 looks toward local -Z, pi toward the gate.
      bunkers: [bunker(-26, 60, Math.PI), bunker(56, -18, -Math.PI / 2), bunker(-56, -18, Math.PI / 2), bunker(10, -62, 0)],
      squads: [spot(-20, 5), spot(22, 24), spot(0, 50)],
      // Between the radar mast (34, 8) and the containers (20-30, 54-64).
      station: { ...siteToWorld(this.site, 22, 33), yaw },
    };
  }

  get remaining(): number {
    return this.objectives.filter((o) => !o.isDestroyed()).length;
  }

  get isDestroyed(): boolean {
    return this.remaining === 0;
  }

  update(dt: number, emitSmoke: (point: THREE.Vector3, radius: number) => void): void {
    this.time += dt;
    if (this.radarDish) this.radarDish.rotation.y += dt * 1.1;
    // The trebuchet creaks back and forth, winding up for a throw that never comes.
    if (this.trebuchetArm) this.trebuchetArm.rotation.x = -0.55 + Math.sin(this.time * 0.7) * 0.12;
    if (this.gateArch?.towers.some((t) => t.destroyed)) {
      this.gateArch.mesh.removeFromParent();
      this.gateArch = null;
    }
    this.aaGun?.update(dt);
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
      this.flagMaterial.map = flagTexture('captured');
      this.flagMaterial.needsUpdate = true;
    }
  }
}
