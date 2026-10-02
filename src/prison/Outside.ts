import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, ARMY_GREEN } from '../utils/plastic';
import { createFigureMesh, createCheeringFigure } from '../entities/Soldier';
import { mulberry32 } from '../utils/rng';

const ROAD_WIDTH = 8;
const TARMAC = 0x3e3f42;
const VERGE = 0x6b5a3e;
/** Cooper's Base: the sandbag ring's radius (its way in faces the road, south). */
const BASE_RADIUS = 20;

/**
 * The country north of the prison on the bonus level: the road home through fields, woods and
 * fences, and Cooper's Base at the end of it (a sandbag ring with tents, a flagpole, a sign and
 * the home team waiting). All drawn only: the tank drives over (and through) the scenery.
 */
export class Outside {
  readonly group = new THREE.Group();
  /** The home team at Cooper's Base: they cheer when the convoy rolls in. */
  private readonly welcome: THREE.Mesh[] = [];
  private readonly box = new THREE.BoxGeometry(1, 1, 1);

  constructor(road: { x: number; z: number }[], home: { x: number; z: number }, ground: { minX: number; maxX: number; minZ: number }) {
    const b = new PartBuilder();
    this.buildRoad(b, road, home);
    this.buildScenery(b, road, home, ground);
    this.buildBase(b, home);
    b.buildInto(this.group);
    this.box.dispose();
  }

  /** The base's soldiers throw their arms up. */
  cheer(): void {
    for (const m of this.welcome) {
      const c = createCheeringFigure(ARMY_GREEN);
      c.position.copy(m.position);
      c.rotation.copy(m.rotation);
      this.group.add(c);
      this.group.remove(m);
    }
    this.welcome.length = 0;
  }

  /** How far a point is from the road (for keeping scenery off it). */
  private static distToRoad(road: { x: number; z: number }[], x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const c = road[i + 1];
      const dx = c.x - a.x;
      const dz = c.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
    }
    return best;
  }

  /** Tarmac strips between the road's points, with a dirt verge and white dashes down the middle. */
  private buildRoad(b: PartBuilder, road: { x: number; z: number }[], home: { x: number; z: number }): void {
    const path = [...road, { x: home.x, z: home.z + BASE_RADIUS * 0.6 }];
    const tarmac = plastic(TARMAC);
    const verge = plastic(VERGE);
    const paint = new THREE.MeshBasicMaterial({ color: 0xe8e4d0 });
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const c = path[i + 1];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const yaw = Math.atan2(c.x - a.x, c.z - a.z);
      const mx = (a.x + c.x) / 2;
      const mz = (a.z + c.z) / 2;
      // A bit longer than the segment so the joins at the bends are covered.
      b.add(this.box, verge, mx, 0.01, mz, 0, yaw, 0, ROAD_WIDTH + 3, 0.02, len + 3);
      b.add(this.box, tarmac, mx, 0.03, mz, 0, yaw, 0, ROAD_WIDTH, 0.02, len + 2);
      for (let t = 2; t < len - 1; t += 6) {
        const f = t / len;
        b.add(this.box, paint, a.x + (c.x - a.x) * f, 0.05, a.z + (c.z - a.z) * f, 0, yaw, 0, 0.25, 0.01, 2.5);
      }
    }
  }

  /** Trees in clumps, haystacks, fences along the road and a signpost, kept off the road. */
  private buildScenery(b: PartBuilder, road: { x: number; z: number }[], home: { x: number; z: number }, ground: { minX: number; maxX: number; minZ: number }): void {
    const rng = mulberry32(5050);
    const trunk = plastic(0x6a4a2a);
    const leaves = [plastic(0x2f5a2a), plastic(0x3a6a30), plastic(0x2a4a28)];
    const hay = plastic(0xd8b45a);
    const clear = (x: number, z: number, room: number) => Outside.distToRoad(road, x, z) > room && Math.hypot(x - home.x, z - home.z) > BASE_RADIUS + 8;
    let trees = 0;
    for (let tries = 0; tries < 2000 && trees < 260; tries++) {
      const x = ground.minX + 6 + rng() * (ground.maxX - ground.minX - 12);
      const z = ground.minZ + 6 + rng() * (-40 - ground.minZ);
      if (!clear(x, z, ROAD_WIDTH / 2 + 5)) continue;
      // Clumps: more trees where there are already some (a cheap way of making woods).
      const h = 4 + rng() * 4;
      b.add(new THREE.CylinderGeometry(0.18, 0.26, h * 0.4, 6), trunk, x, h * 0.2, z);
      b.add(new THREE.ConeGeometry(h * 0.28, h * 0.75, 7), leaves[trees % 3], x, h * 0.4 + h * 0.36, z);
      trees++;
    }
    for (let i = 0; i < 30; i++) {
      const x = ground.minX + 10 + rng() * (ground.maxX - ground.minX - 20);
      const z = -60 - rng() * 380;
      if (!clear(x, z, ROAD_WIDTH / 2 + 4)) continue;
      b.add(new THREE.CylinderGeometry(0.9, 0.9, 1.3, 12).rotateZ(Math.PI / 2), hay, x, 0.9, z, 0, rng() * Math.PI, 0);
    }
    // Post and rail fences along both sides of the road.
    const wood = plastic(0x8a6a3e);
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const c = road[i + 1];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      const nx = -(c.z - a.z) / len;
      const nz = (c.x - a.x) / len;
      for (let t = 4; t < len - 2; t += 3) {
        for (const side of [-1, 1]) {
          if ((Math.floor(t / 30) + (side > 0 ? 1 : 0)) % 3 === 0) continue; // gaps here and there
          const off = ROAD_WIDTH / 2 + 2.2;
          const x = a.x + ((c.x - a.x) * t) / len + nx * side * off;
          const z = a.z + ((c.z - a.z) * t) / len + nz * side * off;
          b.add(this.box, wood, x, 0.55, z, 0, 0, 0, 0.14, 1.1, 0.14);
          b.add(this.box, wood, x, 0.8, z, 0, Math.atan2(c.x - a.x, c.z - a.z), 0, 0.08, 0.1, 3.05);
        }
      }
    }
    // A signpost by the gate, pointing the way home.
    b.add(this.box, wood, ROAD_WIDTH / 2 + 2, 1.3, -34, 0, 0, 0, 0.16, 2.6, 0.16);
    b.add(this.box, plastic(0xe8dcb4), ROAD_WIDTH / 2 + 2.9, 2.3, -34, 0, 0.3, 0, 2, 0.45, 0.08);
  }

  /** Cooper's Base: a ring of sandbags open to the south, tents, a flagpole with a green flag, a sign, the home team. */
  private buildBase(b: PartBuilder, home: { x: number; z: number }): void {
    const sand = plastic(0xb9a77a);
    const canvas = plastic(0x5a6a3a);
    const gap = 0.45; // the way in, either side of south (radians)
    for (let a = 0; a < Math.PI * 2; a += 0.11) {
      const off = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      if (off < gap) continue; // a = 0 is south (+Z)
      const x = home.x + Math.sin(a) * BASE_RADIUS;
      const z = home.z + Math.cos(a) * BASE_RADIUS;
      for (let row = 0; row < 3; row++) b.add(this.box, sand, x, 0.3 + row * 0.42, z, 0, a, 0, 2.3, 0.4, 0.9);
    }
    // Tents round the back.
    for (const [dx, dz] of [[-10, -9], [0, -12], [10, -9], [-13, 2]]) {
      b.add(new THREE.CylinderGeometry(0.05, 2.4, 2.6, 4, 1).rotateY(Math.PI / 4).scale(1.4, 1, 1), canvas, home.x + dx, 1.3, home.z + dz);
    }
    // The flagpole and its flag, and a sign over the way in.
    b.add(new THREE.CylinderGeometry(0.08, 0.1, 9, 8), plastic(0xd8d8d0), home.x, 4.5, home.z);
    b.add(this.box, plastic(ARMY_GREEN), home.x + 1, 8.2, home.z, 0, 0, 0, 2, 1.2, 0.05);
    b.add(this.box, plastic(0xf4f1e4), home.x + 1, 8.2, home.z - 0.03, 0, 0, Math.PI / 4, 0.5, 0.5, 0.06);
    for (const side of [-1, 1]) b.add(this.box, plastic(0x8a6a3e), home.x + side * 5, 2, home.z + BASE_RADIUS + 0.5, 0, 0, 0, 0.25, 4, 0.25);
    b.add(this.box, plastic(0xe8c23a), home.x, 3.7, home.z + BASE_RADIUS + 0.5, 0, 0, 0, 10.5, 1.1, 0.15);
    this.sign(home.x, 3.7, home.z + BASE_RADIUS + 0.6);
    // The home team, waiting.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 1.4 - Math.PI * 0.7;
      const m = createFigureMesh(0, ARMY_GREEN);
      m.position.set(home.x + Math.sin(a + Math.PI) * 9, 0, home.z + Math.cos(a + Math.PI) * 9 - 2);
      m.rotation.y = Math.atan2(-(home.x - m.position.x), -(home.z + BASE_RADIUS - m.position.z));
      this.group.add(m);
      this.welcome.push(m);
    }
  }

  /** "COOPER'S BASE" on the sign, facing the road (+Z). */
  private sign(x: number, y: number, z: number): void {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 64;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#e8c23a';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#2a2a2a';
    ctx.font = '900 44px "Black Ops One", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("COOPER'S BASE", 256, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.05), new THREE.MeshBasicMaterial({ map: tex }));
    board.position.set(x, y, z + 0.02);
    this.group.add(board);
  }
}
