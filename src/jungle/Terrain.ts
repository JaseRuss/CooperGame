import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PartBuilder } from '../utils/modelKit';
import { plastic } from '../utils/plastic';
import { mulberry32 } from '../utils/rng';
import { WATER_GROUPS } from '../prison/groups';
import type { Clearing } from './Forest';

/** The river runs west to east across the jungle, wandering a little. It's level at x = 0 and x = ±173, where the bridges go. */
export const riverZ = (x: number): number => 96 + 14 * Math.cos(x / 55);
/** How wide it is at `x`, in metres. */
export const riverWidth = (x: number): number => 11 + 2 * Math.sin(x / 23 + 1);

const STEP = 1.5;
const BRIDGE_HALF_WIDTH = 2.1;
const SAND = 0xc9b27a;
const WATER = 0x3b8fc2;

export interface Zone {
  x: number;
  z: number;
  r: number;
}

export interface Bridge {
  x: number;
  z: number;
  /** Which way the river runs here (a unit vector). */
  dir: THREE.Vector2;
  /** The two ends, on the south and north banks. */
  south: THREE.Vector2;
  north: THREE.Vector2;
}

const PONDS: Zone[] = [
  { x: -178, z: 128, r: 16 },
  { x: 74, z: -52, r: 15 },
  { x: -46, z: -84, r: 11 },
];

/**
 * The lie of the land: a river with bridges (the only way across), ponds, and rock outcrops that
 * make cover. The ground itself is flat; water is a wall to soldiers (a collider only walking
 * notices: shots and sight go over it).
 */
export class Terrain {
  readonly bridges: Bridge[] = [];
  readonly ponds = PONDS;
  readonly rocks: Zone[] = [];
  /** Ground the forest leaves bare. */
  readonly clearings: Clearing[] = [];
  private readonly body: RAPIER.RigidBody;

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly half: number,
    bridgeXs: number[],
    /** Places that already have something on them, which rocks keep clear of. */
    avoid: Zone[],
    seed: number,
  ) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const bx of bridgeXs) this.bridges.push(this.makeBridge(bx));
    this.river();
    for (const b of this.bridges) this.buildBridge(b);
    for (const p of PONDS) this.pond(p);
    this.outcrops(avoid, seed);
  }

  /** Whether (x, z) is under water. */
  isWater(x: number, z: number): boolean {
    if (Math.abs(z - riverZ(x)) < riverWidth(x) / 2 && !this.bridges.some((b) => Math.abs(x - b.x) < BRIDGE_HALF_WIDTH)) return true;
    return PONDS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r);
  }

  /** -1 north of the river, 1 south of it, 0 in it (on a bridge). */
  private side(x: number, z: number): number {
    const d = z - riverZ(x);
    const w = riverWidth(x) / 2 + 0.3;
    return d < -w ? -1 : d > w ? 1 : 0;
  }

  /**
   * Where a soldier at (fx, fz) should head to get to (tx, tz): straight there, unless the river
   * is in between, in which case it's the end of the nearest bridge (and across it).
   */
  route(fx: number, fz: number, tx: number, tz: number): { x: number; z: number } {
    const sa = this.side(fx, fz);
    const sb = this.side(tx, tz);
    if (sa === sb || this.bridges.length === 0) return { x: tx, z: tz };
    if (sa === 0) {
      // On a bridge: carry on to the far end, then off.
      const b = this.bridges.reduce((a, c) => (Math.abs(a.x - fx) < Math.abs(c.x - fx) ? a : c));
      const end = sb > 0 || (sb === 0 && tz > fz) ? b.south : b.north;
      return { x: end.x, z: end.y };
    }
    if (sb === 0) return { x: tx, z: tz };
    let best: Bridge | null = null;
    let bestCost = Infinity;
    for (const b of this.bridges) {
      const near = sa > 0 ? b.south : b.north;
      const far = sa > 0 ? b.north : b.south;
      const cost = Math.hypot(fx - near.x, fz - near.y) + near.distanceTo(far) + Math.hypot(tx - far.x, tz - far.y);
      if (cost < bestCost) {
        bestCost = cost;
        best = b;
      }
    }
    const b = best as Bridge;
    const near = sa > 0 ? b.south : b.north;
    const far = sa > 0 ? b.north : b.south;
    // On the line of the bridge and at (or past) its near end: straight across. Otherwise line up with that end first.
    const ax = (far.x - near.x) / near.distanceTo(far);
    const az = (far.y - near.y) / near.distanceTo(far);
    const along = (fx - near.x) * ax + (fz - near.y) * az;
    const across = Math.abs((fx - near.x) * az - (fz - near.y) * ax);
    return across < 2.4 && along > -1 ? { x: far.x, z: far.y } : { x: near.x, z: near.y };
  }

  private box(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number, water: boolean): void {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    if (water) desc.setCollisionGroups(WATER_GROUPS);
    this.world.createCollider(desc, this.body);
  }

  private makeBridge(x: number): Bridge {
    const z = riverZ(x);
    const dz = (riverZ(x + 0.5) - riverZ(x - 0.5)) / 1;
    const dir = new THREE.Vector2(1, dz).normalize();
    const n = new THREE.Vector2(-dir.y, dir.x); // points south
    const reach = riverWidth(x) / 2 + 2.8;
    return {
      x,
      z,
      dir,
      south: new THREE.Vector2(x, z).addScaledVector(n, reach),
      north: new THREE.Vector2(x, z).addScaledVector(n, -reach),
    };
  }

  // ---------- the river ----------

  private river(): void {
    const xs: number[] = [];
    for (let x = -this.half - 8; x <= this.half + 8; x += STEP) xs.push(x);
    const frame = (x: number) => {
      const dir = new THREE.Vector2(1, riverZ(x + 0.5) - riverZ(x - 0.5)).normalize();
      return { dir, n: new THREE.Vector2(-dir.y, dir.x) };
    };
    const ribbon = (extra: number, y: number, mat: THREE.Material) => {
      const pos: number[] = [];
      const idx: number[] = [];
      xs.forEach((x, i) => {
        const { n } = frame(x);
        const w = riverWidth(x) / 2 + extra;
        const z = riverZ(x);
        pos.push(x + n.x * w, y, z + n.y * w, x - n.x * w, y, z - n.y * w);
        if (i > 0) {
          const a = (i - 1) * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    ribbon(2.4, 0.03, new THREE.MeshStandardMaterial({ color: SAND, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    ribbon(0, 0.06, new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.15, transparent: true, opacity: 0.86, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));

    // The wall in the water: boxes along the river, with a gap at each bridge.
    for (const x of xs) {
      if (this.bridges.some((b) => Math.abs(x - b.x) < BRIDGE_HALF_WIDTH + 1)) continue;
      const { dir } = frame(x);
      this.box(x, 2, riverZ(x), STEP * 0.6, 2, riverWidth(x) / 2 + 0.6, -Math.atan2(dir.y, dir.x), true);
    }

    // Keep the forest off the water and the banks, and cut a track through it to each bridge.
    for (let i = 0; i < xs.length; i += 5) {
      const x = xs[i];
      this.clearings.push({ x, z: riverZ(x), r: riverWidth(x) / 2 + 3.5 });
    }
    for (const b of this.bridges) this.clearings.push({ x0: b.x - 3.6, x1: b.x + 3.6, z0: b.z - 34, z1: b.z + 34 });
  }

  private buildBridge(b: Bridge): void {
    const L = riverWidth(b.x) + 7;
    const plank = plastic(0x9a6b3e);
    const plankDark = plastic(0x7b5230);
    const post = plastic(0x5a3b24);
    const p = new PartBuilder();
    // Planks across the deck (length runs along local x, from bank to bank).
    for (let i = 0, x = -L / 2 + 0.25; x < L / 2; i++, x += 0.52) p.add(new THREE.BoxGeometry(0.46, 0.08, BRIDGE_HALF_WIDTH * 2), i % 2 ? plankDark : plank, x, 0.07, 0);
    for (const s of [-1, 1]) {
      p.add(new THREE.BoxGeometry(L, 0.22, 0.3), post, 0, 0.0, s * (BRIDGE_HALF_WIDTH - 0.3));
      p.add(new THREE.BoxGeometry(L, 0.12, 0.14), post, 0, 1.0, s * (BRIDGE_HALF_WIDTH + 0.05));
      p.add(new THREE.BoxGeometry(L, 0.1, 0.1), post, 0, 0.55, s * (BRIDGE_HALF_WIDTH + 0.05));
      for (let x = -L / 2 + 0.3; x <= L / 2 - 0.2; x += 2.2) p.add(new THREE.BoxGeometry(0.2, 1.15, 0.2), post, x, 0.55, s * (BRIDGE_HALF_WIDTH + 0.05));
    }
    // Piles standing in the water.
    for (let x = -L / 2 + 2.5; x < L / 2 - 1; x += 3.4) for (const s of [-1, 1]) p.add(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 6), post, x, -0.2, s * (BRIDGE_HALF_WIDTH - 0.2));
    const group = new THREE.Group();
    // The deck's length is across the river: the river's direction turned a quarter.
    const yaw = -Math.atan2(b.dir.y, b.dir.x) + Math.PI / 2;
    group.position.set(b.x, 0, b.z);
    group.rotation.y = yaw;
    p.buildInto(group, true, true);
    this.scene.add(group);
    // Rails on both sides, so nobody steps off into the water.
    for (const s of [-1, 1]) {
      const off = new THREE.Vector2(b.dir.x, b.dir.y).multiplyScalar(s * (BRIDGE_HALF_WIDTH + 0.1));
      this.box(b.x + off.x, 1, b.z + off.y, L / 2, 1, 0.12, yaw, true);
    }
    // A dirt track either side of the bridge.
    const path = new THREE.Mesh(new THREE.PlaneGeometry(5, 68).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a6a48, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    path.position.set(b.x, 0.02, b.z);
    path.receiveShadow = true;
    this.scene.add(path);
  }

  // ---------- ponds ----------

  private pond(p: Zone): void {
    const shore = new THREE.Mesh(new THREE.CircleGeometry(p.r + 2.2, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: SAND, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    shore.position.set(p.x, 0.03, p.z);
    const water = new THREE.Mesh(new THREE.CircleGeometry(p.r, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.15, transparent: true, opacity: 0.86, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    water.position.set(p.x, 0.06, p.z);
    shore.receiveShadow = true;
    this.scene.add(shore, water);
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(2, p.r).setTranslation(p.x, 2, p.z).setCollisionGroups(WATER_GROUPS), this.body);
    // Reeds round the edge and a few lily pads.
    const rng = mulberry32(Math.floor(p.x * 31 + p.z * 17));
    const b = new PartBuilder();
    const reed = plastic(0x5f8f3a);
    const pad = plastic(0x3e8a45);
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const r = p.r - 0.4 + rng() * 2.4;
      const h = 1.2 + rng() * 1.2;
      b.add(new THREE.CylinderGeometry(0.05, 0.06, h, 4), reed, p.x + Math.cos(a) * r, h / 2, p.z + Math.sin(a) * r);
    }
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * (p.r - 2);
      b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 8), pad, p.x + Math.cos(a) * r, 0.09, p.z + Math.sin(a) * r);
    }
    b.buildInto(this.scene as unknown as THREE.Object3D, false, false);
    this.clearings.push({ x: p.x, z: p.z, r: p.r + 3 });
  }

  // ---------- rocks ----------

  private outcrops(avoid: Zone[], seed: number): void {
    const rng = mulberry32(seed);
    const grey = [plastic(0x8a8d90), plastic(0x757a7d), plastic(0x9a9690)];
    const b = new PartBuilder();
    let tries = 0;
    while (this.rocks.length < 14 && tries++ < 600) {
      const x = (rng() * 2 - 1) * (this.half - 18);
      const z = (rng() * 2 - 1) * (this.half - 18);
      const r = 5 + rng() * 3;
      if (Math.abs(z - riverZ(x)) < riverWidth(x) / 2 + r + 6) continue;
      if (avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + r + 4)) continue;
      if (PONDS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r + 5)) continue;
      if (this.rocks.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + r + 10)) continue;
      if (this.bridges.some((br) => Math.abs(x - br.x) < 8 && Math.abs(z - br.z) < 40)) continue;
      this.rocks.push({ x, z, r });
      const n = 4 + Math.floor(rng() * 4);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const d = i === 0 ? 0 : rng() * (r - 1.6);
        const size = i === 0 ? 2.1 + rng() * 1.2 : 0.9 + rng() * 1.5;
        const bx = x + Math.cos(a) * d;
        const bz = z + Math.sin(a) * d;
        const sy = 0.75 + rng() * 0.45;
        b.add(new THREE.DodecahedronGeometry(1, 0), grey[Math.floor(rng() * grey.length)], bx, size * sy * 0.6, bz, rng() * 0.5, rng() * 6.3, rng() * 0.5, size, size * sy, size * (0.8 + rng() * 0.4));
        this.world.createCollider(RAPIER.ColliderDesc.cylinder(size * sy * 0.6, size * 0.85).setTranslation(bx, size * sy * 0.6, bz), this.body);
      }
      this.clearings.push({ x, z, r: r + 1.5 });
    }
    b.buildInto(this.scene as unknown as THREE.Object3D, true, true);
  }
}
