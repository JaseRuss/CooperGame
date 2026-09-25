import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Building } from './Building';
import type { HitRegistry } from '../combat/HitRegistry';
import type { AssetLibrary } from './AssetLibrary';
import { heightAt, LAKE_LEVELS } from './Terrain';
import {
  SITES,
  LAKES,
  siteYaw,
  siteLocalHalf,
  MALL_LOT_BACK_Z,
  APRON,
  AIRPORT_ACCESS_X,
  SITE_ROAD_WIDTH,
  type Site,
} from './Landmarks';
import { plastic, shade, ARMY_TAN } from '../utils/plastic';
import { mulberry32 } from '../utils/rng';
import { PartBuilder } from '../utils/modelKit';
import { WORLD_SEED } from '../core/config';

const ASPHALT = 0x45484d;
const LINE_WHITE = 0xf2f0e6;
const CAR_SCALE = 1.7; // Kenney Car Kit → roughly tank-length cars

function canvasSign(text: string, bg: string, fg: string, w = 512, h = 128): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `900 ${Math.floor(h * 0.6)}px "Segoe UI", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
}

function box(w: number, h: number, d: number, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A flat, ground-hugging painted surface (asphalt, markings). */
function flat(w: number, d: number, color: number, parent: THREE.Object3D, x: number, y: number, z: number, offset = -2): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A flat swept wing/tail panel in the XZ plane reaching `span` along X (negative = left), leading edge toward -Z. */
function sweptPanel(root: number, tip: number, span: number, sweep: number, thickness: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -root / 2);
  s.lineTo(span, -root / 2 + sweep);
  s.lineTo(span, -root / 2 + sweep + tip);
  s.lineTo(0, root / 2);
  s.closePath();
  // Shape is drawn in XY; lay it flat so shape-Y becomes world Z.
  return new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, thickness / 2, 0);
}

/** A toy twin-engined jet fighter, nose toward -Z. */
function toyJet(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = plastic(color);
  const dark = plastic(shade(color, 0.6));
  const deep = plastic(shade(color, 0.4));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fcde0, roughness: 0.1, clearcoat: 1 });
  const tyre = plastic(0x2e2f2c);
  const p = new PartBuilder();
  const tube = (r1: number, r2: number, len: number) => new THREE.CylinderGeometry(r1, r2, len, 14).rotateX(Math.PI / 2);

  // Fuselage, pointed nose cone with a pitot probe, and engine nacelles blended in at the back.
  p.add(new THREE.CapsuleGeometry(1.4, 11, 6, 16).rotateX(Math.PI / 2), body, 0, 3, 0.5);
  p.add(new THREE.ConeGeometry(1.1, 3.2, 16).rotateX(-Math.PI / 2), body, 0, 3.05, -7.6);
  p.add(tube(0.05, 0.05, 1.4), deep, 0, 3.05, -9.6);
  for (const s of [-1, 1]) {
    p.add(tube(0.85, 0.85, 7), body, s * 1.1, 2.6, 3.4);
    p.add(tube(0.7, 0.85, 1.0), deep, s * 1.1, 2.6, 7.3); // nozzle
    p.add(new THREE.BoxGeometry(0.9, 1.3, 2.2), dark, s * 1.55, 2.9, -2.2); // intakes
    // Swept wing, tailplane and twin tail fins.
    p.add(sweptPanel(5, 1.6, s * 8.5, 3.6, 0.3), body, s * 0.8, 2.55, 1.2);
    p.add(sweptPanel(2.8, 1.1, s * 3.4, 1.8, 0.22), body, s * 1.4, 2.5, 6.8);
    p.add(sweptPanel(3, 1.2, 3.2, 1.8, 0.2), body, s * 1.3, 3.2, 6.3, 0, 0, Math.PI / 2 - s * 0.3, 1, 1, 1);
    // Wing-tip missiles and an underwing fuel tank.
    p.add(tube(0.14, 0.14, 2.6), plastic(0xe8e4d8), s * 9.4, 2.7, 3.2);
    p.add(new THREE.ConeGeometry(0.14, 0.5, 10).rotateX(-Math.PI / 2), plastic(0xc0392b), s * 9.4, 2.7, 1.65);
    p.add(new THREE.CapsuleGeometry(0.35, 2.4, 4, 10).rotateX(Math.PI / 2), dark, s * 5, 1.9, 1.6);
    p.add(new THREE.BoxGeometry(0.1, 0.5, 0.6), dark, s * 5, 2.3, 1.6);
    // Main landing gear: leg, wheel, door.
    p.add(new THREE.BoxGeometry(0.15, 1.8, 0.15), deep, s * 2.2, 1.35, 1.2);
    p.add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14).rotateZ(Math.PI / 2), tyre, s * 2.3, 0.5, 1.2);
    p.add(new THREE.BoxGeometry(0.06, 1.2, 1.4), dark, s * 1.75, 1.6, 1.2);
  }
  // Nose gear.
  p.add(new THREE.BoxGeometry(0.15, 1.9, 0.15), deep, 0, 1.3, -5.2);
  p.add(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14).rotateZ(Math.PI / 2), tyre, 0, 0.45, -5.2);
  // Bubble canopy with a frame, and a spine behind it.
  p.add(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 4.2, -4.5, 0, 0, 0, 0.95, 0.85, 2.1);
  p.add(new THREE.TorusGeometry(0.95, 0.06, 4, 16, Math.PI), deep, 0, 4.2, -4.2, 0, 0, 0, 1, 0.85, 1);
  p.add(new THREE.BoxGeometry(0.8, 0.5, 6), body, 0, 4.1, 0.5);
  p.buildInto(g);
  return g;
}
/** Builds lakes, shopping malls and the airfield. Returns their destructible pieces. */
export class LandmarkSet {
  readonly buildings: Building[] = [];
  private readonly ducks: { mesh: THREE.Object3D; phase: number; baseY: number; cx: number; cz: number; r: number; speed: number }[] = [];
  private readonly radars: THREE.Object3D[] = [];
  private time = 0;

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly hitRegistry: HitRegistry,
    private readonly assets: AssetLibrary,
  ) {
    const rng = mulberry32(WORLD_SEED + 1234);
    LAKES.forEach((lake, i) => this.buildLake(lake.cx, lake.cz, lake.radius, LAKE_LEVELS[i], rng));
    for (const site of SITES) {
      if (site.kind === 'mall') this.buildMall(site, rng);
      else if (site.kind === 'airport') this.buildAirport(site, rng);
      // Enemy bases are built by EnemyBase.
    }
  }

  // ---------- shared ----------

  private siteGroup(site: Site): THREE.Group {
    const g = new THREE.Group();
    g.position.set(site.cx, heightAt(site.cx, site.cz), site.cz);
    g.rotation.y = siteYaw(site);
    this.scene.add(g);
    return g;
  }

  /** Registers `mesh` (already inside the site group) as a destructible building. */
  private destructible(group: THREE.Group, mesh: THREE.Object3D, health: number, debrisColor: number): void {
    group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(mesh);
    this.buildings.push(
      new Building(
        this.world,
        this.scene,
        this.hitRegistry,
        mesh,
        bb.getSize(new THREE.Vector3()).multiplyScalar(0.5),
        bb.getCenter(new THREE.Vector3()),
        health,
        debrisColor,
      ),
    );
  }

  // ---------- lakes ----------

  private buildLake(cx: number, cz: number, radius: number, level: number, rng: () => number): void {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(radius + 1.5, 72),
      new THREE.MeshPhysicalMaterial({
        color: 0x3d8fd4,
        roughness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        transparent: true,
        opacity: 0.85,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, level + 0.02, cz);
    water.receiveShadow = true;
    this.scene.add(water);

    // Deep water is a solid slab: tanks can wade the shallows but not drive under, and
    // shells hitting it register as a splash.
    const halfHeight = 4.5;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, level + 0.1 - halfHeight, cz));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, radius - 6), body);
    this.hitRegistry.register(collider, { kind: 'water' });

    // Rubber ducks, because it's a toy box.
    const duckBody = plastic(0xffd23a);
    const beak = plastic(0xff8a1a);
    const count = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const duck = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), duckBody);
      b.scale.set(1, 0.75, 1.3);
      duck.add(b);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), duckBody);
      head.position.set(0, 0.9, -0.8);
      duck.add(head);
      const bill = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), beak);
      bill.position.set(0, 0.85, -1.4);
      duck.add(bill);
      duck.traverse((o) => (o.castShadow = true));
      this.scene.add(duck);
      this.ducks.push({ mesh: duck, phase: rng() * 10, baseY: level + 0.35, cx, cz, r: radius * (0.3 + rng() * 0.45), speed: 0.05 + rng() * 0.06 });
    }
  }

  // ---------- shopping mall ----------

  private buildMall(site: Site, rng: () => number): void {
    const g = this.siteGroup(site);
    const half = siteLocalHalf(site);
    const wall = plastic(0xefe3c8);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x2d4a6a, roughness: 0.1, clearcoat: 1 });
    const roof = plastic(0xb9b3a4);
    const shops = [
      { name: 'TOY TOWN', band: 0xe05a7a },
      { name: 'MEGA MART', band: 0x2fa4a8 },
      { name: 'BURGER BOX', band: 0xf2b632 },
    ];

    // Car park asphalt covering the lot out to its front and side edges, where the highways join.
    flat(half.x * 2, half.z - MALL_LOT_BACK_Z, ASPHALT, g, 0, 0.06, (half.z + MALL_LOT_BACK_Z) / 2);
    flat(half.x * 2 - 10, 10, 0xc9c3b3, g, 0, 0.07, -27); // pavement along the shopfronts

    shops.forEach((shop, i) => {
      const x = (i - 1) * 50;
      const section = new THREE.Group();
      section.position.set(x, 0, -62);
      g.add(section);
      box(48, 12, 36, wall, section, 0, 6, 0);
      box(48.6, 2.4, 36.6, plastic(shop.band), section, 0, 11.2, 0);
      box(44, 6.5, 0.5, glass, section, 0, 4, 18.1);
      box(6, 4.5, 0.6, plastic(0x1e1e1e), section, 0, 2.25, 18.3);
      box(48, 0.6, 36, roof, section, 0, 12.4, 0);
      for (let k = 0; k < 3; k++) box(4, 2, 3, plastic(0xa9a9a0), section, -14 + k * 14, 13.7, -6 + rng() * 12);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.2), canvasSign(shop.name, '#fffaf0', '#' + shop.band.toString(16).padStart(6, '0')));
      sign.position.set(0, 11.2, 18.35);
      section.add(sign);
      this.destructible(g, section, 260, 0xd8ccb0);
    });

    // Painted bays: two double rows of stalls.
    const lineMat = new THREE.MeshBasicMaterial({ color: LINE_WHITE, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const lineGeo = new THREE.PlaneGeometry(0.3, 5.5).rotateX(-Math.PI / 2);
    const bays: { x: number; z: number; facing: number }[] = [];
    const lines = new THREE.InstancedMesh(lineGeo, lineMat, 200);
    let n = 0;
    const m = new THREE.Matrix4();
    for (const rowZ of [-1, 45]) {
      for (const side of [-1, 1]) {
        const z = rowZ + side * 3;
        for (let x = -80; x <= 80; x += 5) {
          m.makeTranslation(x, 0.1, z);
          lines.setMatrixAt(n++, m);
          if (x < 80) bays.push({ x: x + 2.5, z, facing: side > 0 ? 0 : Math.PI });
        }
      }
    }
    lines.count = n;
    g.add(lines);

    const carCount = 22 + Math.floor(rng() * 8);
    for (let i = 0; i < carCount && bays.length; i++) {
      const bay = bays.splice(Math.floor(rng() * bays.length), 1)[0];
      const car = this.assets.clone('car', this.assets.random('car', rng));
      car.scale.setScalar(CAR_SCALE);
      car.position.set(bay.x, 0.05, bay.z);
      car.rotation.y = bay.facing + (rng() - 0.5) * 0.15;
      g.add(car);
      this.destructible(g, car, 26, 0x777777);
    }

    // Lamp posts and a roadside pylon sign.
    const pole = plastic(0x8d9399);
    for (const x of [-60, -20, 20, 60]) {
      for (const z of [22, 68]) {
        box(0.35, 9, 0.35, pole, g, x, 4.5, z);
        box(2.6, 0.35, 0.8, pole, g, x, 9, z);
      }
    }
    box(1, 16, 1, pole, g, half.x - 16, 8, half.z - 6);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 0.8), canvasSign('SHOPPING', '#2fa4a8', '#fffaf0'));
    pylon.position.set(half.x - 16, 17, half.z - 6);
    pylon.castShadow = true;
    g.add(pylon);
  }

  // ---------- airfield ----------

  private buildAirport(site: Site, rng: () => number): void {
    const g = this.siteGroup(site);
    const half = siteLocalHalf(site);
    const khaki = plastic(0xb9a57a);
    const cream = plastic(0xefe3c8);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x2d4a6a, roughness: 0.1, clearcoat: 1 });
    const marking = new THREE.MeshBasicMaterial({ color: LINE_WHITE, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const yellow = new THREE.MeshBasicMaterial({ color: 0xf2c230, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

    const runwayLen = half.x * 2 - 40;
    flat(runwayLen, 40, ASPHALT, g, 0, 0.06, -70);
    flat(runwayLen - 120, 16, ASPHALT, g, 0, 0.06, -10);
    for (const x of [-runwayLen / 2 + 90, runwayLen / 2 - 90]) flat(16, 60, ASPHALT, g, x, 0.065, -40);
    flat(APRON.halfX * 2, APRON.halfZ * 2, 0x55595e, g, 0, 0.06, APRON.z);

    // Landside access road (front edge → apron, between the hangars and the tower) and service
    // roads from each end of the site to the apron: these are where the highways join.
    const apronFront = APRON.z + APRON.halfZ;
    flat(SITE_ROAD_WIDTH, half.z - apronFront, ASPHALT, g, AIRPORT_ACCESS_X, 0.065, (half.z + apronFront) / 2);
    for (const side of [-1, 1]) {
      const len = half.x - APRON.halfX;
      flat(len, SITE_ROAD_WIDTH, ASPHALT, g, side * (APRON.halfX + len / 2), 0.065, APRON.z);
    }

    // Runway centreline dashes and threshold "piano keys"; taxiway centreline.
    const dashGeo = new THREE.PlaneGeometry(14, 0.9).rotateX(-Math.PI / 2);
    const dashes = new THREE.InstancedMesh(dashGeo, marking, 64);
    let n = 0;
    const m = new THREE.Matrix4();
    for (let x = -runwayLen / 2 + 60; x < runwayLen / 2 - 60 && n < 64; x += 30) {
      dashes.setMatrixAt(n++, m.makeTranslation(x, 0.12, -70));
    }
    dashes.count = n;
    g.add(dashes);
    const keyGeo = new THREE.PlaneGeometry(26, 1.8).rotateX(-Math.PI / 2);
    const keys = new THREE.InstancedMesh(keyGeo, marking, 24);
    n = 0;
    for (const end of [-1, 1]) {
      for (let i = 0; i < 10; i++) {
        keys.setMatrixAt(n++, m.makeTranslation(end * (runwayLen / 2 - 20), 0.12, -70 - 16 + i * 3.5));
      }
    }
    keys.count = n;
    g.add(keys);
    const taxiLine = new THREE.Mesh(new THREE.PlaneGeometry(runwayLen - 120, 0.6).rotateX(-Math.PI / 2), yellow);
    taxiLine.position.set(0, 0.12, -10);
    g.add(taxiLine);

    // Hangars: half-cylinder huts facing the apron.
    for (const x of [-150, -90, -30]) {
      const hangar = new THREE.Group();
      hangar.position.set(x, 0, 118);
      g.add(hangar);
      // Half cylinder (the +Z half, caps included) turned so the arch stands up and runs along Z.
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 34, 20, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), khaki);
      shell.castShadow = true;
      shell.receiveShadow = true;
      hangar.add(shell);
      const door = new THREE.Mesh(new THREE.CircleGeometry(13.5, 20, 0, Math.PI), plastic(0x2a2a24));
      door.position.set(0, 0.05, -17.05);
      door.rotation.y = Math.PI;
      hangar.add(door);
      this.destructible(g, hangar, 300, 0xb9a57a);
    }

    // Control tower with a spinning radar.
    const tower = new THREE.Group();
    tower.position.set(90, 0, 112);
    g.add(tower);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, 20, 14), cream);
    shaft.position.y = 10;
    shaft.castShadow = true;
    tower.add(shaft);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 4.5, 4.5, 8), glass);
    cab.position.y = 22.2;
    tower.add(cab);
    const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.8, 8), plastic(0xd94141));
    cabRoof.position.y = 24.8;
    cabRoof.castShadow = true;
    tower.add(cabRoof);
    const radar = new THREE.Group();
    radar.position.y = 26.5;
    tower.add(radar);
    box(0.4, 2.4, 0.4, plastic(0x8d9399), radar, 0, 0, 0);
    box(6, 1.6, 0.3, plastic(0xefefef), radar, 0, 1.4, 0);
    this.radars.push(radar);
    this.destructible(g, tower, 220, 0xefe3c8);

    // Terminal building with glass frontage and sign.
    const terminal = new THREE.Group();
    terminal.position.set(200, 0, 120);
    g.add(terminal);
    box(110, 11, 26, cream, terminal, 0, 5.5, 0);
    box(106, 5, 0.5, glass, terminal, 0, 4.5, -13.1);
    box(111, 1, 27, plastic(0x2fa4a8), terminal, 0, 11.3, 0);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(30, 4), canvasSign('AIRPORT', '#fffaf0', '#2fa4a8'));
    sign.position.set(0, 13.8, -9);
    sign.rotation.y = Math.PI;
    terminal.add(sign);
    box(30.4, 4.4, 0.3, cream, terminal, 0, 13.8, -8.8);
    this.destructible(g, terminal, 320, 0xefe3c8);

    // Parked enemy planes on the apron.
    const planeSpots = [-150, -80, 0, 80, 150];
    for (const x of planeSpots) {
      if (rng() < 0.2) continue;
      const jet = toyJet(ARMY_TAN);
      jet.position.set(x, 0.05, 52 + (rng() - 0.5) * 10);
      jet.rotation.y = Math.PI + (rng() - 0.5) * 0.3; // noses toward the taxiway
      g.add(jet);
      this.destructible(g, jet, 70, ARMY_TAN);
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const d of this.ducks) {
      const a = this.time * d.speed + d.phase;
      d.mesh.position.set(d.cx + Math.cos(a) * d.r, d.baseY + Math.sin(this.time * 2 + d.phase) * 0.12, d.cz + Math.sin(a) * d.r);
      d.mesh.rotation.y = -a + Math.PI; // swim along the circle
      d.mesh.rotation.z = Math.sin(this.time * 1.6 + d.phase) * 0.08;
    }
    for (const r of this.radars) r.rotation.y += dt * 1.2;
  }
}
