import * as THREE from 'three';
import { PartBuilder, tubeX } from '../utils/modelKit';
import { plastic, shade, ARMY_TAN, ARMY_GREEN } from '../utils/plastic';
import { createFigureMesh, createCheeringFigure } from '../entities/Soldier';

/** A truck's length (nose at -Z), and how far apart along the tank's tracks they drive. */
const LENGTH = 6.4;
const FIRST_GAP = 9;
const GAP = 8.5;
/** The tank's tracks: a crumb every this far. */
const CRUMB = 0.5;
const WHEEL_RADIUS = 0.5;
/** Seats in the back: two benches facing in. */
const SEATS = 8;

let truckGeos: Map<THREE.Material, THREE.BufferGeometry> | null = null;

/**
 * A tan army truck, facing -Z with its wheels on y = 0: a snub-nosed cab, an open back with a
 * bench down each side, six chunky wheels. Captured from the tan army's motor pool.
 */
function truckGeometry(): Map<THREE.Material, THREE.BufferGeometry> {
  const b = new PartBuilder();
  const body = plastic(ARMY_TAN);
  const dark = plastic(shade(ARMY_TAN, 0.7));
  const tyre = plastic(0x2a2a2a);
  const glass = plastic(0x2a3448);
  const lamp = plastic(0xfff3c0);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const L = LENGTH;
  // Chassis and wheels.
  b.add(box, dark, 0, 0.75, 0, 0, 0, 0, 1.9, 0.3, L - 0.4);
  for (const z of [-L / 2 + 1.1, L / 2 - 1.6, L / 2 - 0.5]) {
    for (const x of [-1.05, 1.05]) b.add(tubeX(WHEEL_RADIUS, 0.4, 14), tyre, x, WHEEL_RADIUS, z);
  }
  // The cab: bonnet, cab box, windscreen, lamps, bumper.
  b.add(box, body, 0, 1.2, -L / 2 + 0.75, 0, 0, 0, 2.1, 0.8, 1.5);
  b.add(box, body, 0, 1.75, -L / 2 + 2.05, 0, 0, 0, 2.2, 1.9, 1.3);
  b.add(box, glass, 0, 2.15, -L / 2 + 1.38, -0.15, 0, 0, 1.9, 0.7, 0.05);
  for (const x of [-0.7, 0.7]) b.add(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 10).rotateX(Math.PI / 2), lamp, x, 1.35, -L / 2 - 0.02);
  b.add(box, dark, 0, 0.85, -L / 2 - 0.05, 0, 0, 0, 2.2, 0.25, 0.2);
  // The open back: floor, sides with slats, tailgate, and the benches inside.
  const back0 = -L / 2 + 2.8;
  const back1 = L / 2;
  const mid = (back0 + back1) / 2;
  const len = back1 - back0;
  b.add(box, body, 0, 1.0, mid, 0, 0, 0, 2.3, 0.15, len);
  for (const x of [-1.12, 1.12]) {
    b.add(box, body, x, 1.45, mid, 0, 0, 0, 0.08, 0.8, len);
    for (let z = back0 + 0.4; z < back1; z += 0.8) b.add(box, dark, x * 1.02, 1.45, z, 0, 0, 0, 0.06, 0.82, 0.08);
    b.add(box, dark, x * 0.75, 1.3, mid, 0, 0, 0, 0.4, 0.12, len - 0.3);
  }
  b.add(box, body, 0, 1.45, back1, 0, 0, 0, 2.3, 0.8, 0.08);
  // A white star on each door.
  for (const x of [-1.11, 1.11]) b.add(new THREE.CircleGeometry(0.28, 5).rotateY(x > 0 ? Math.PI / 2 : -Math.PI / 2), plastic(0xf4f1e4), x * 1.01, 1.75, -L / 2 + 2.05);
  box.dispose();
  return b.buildGeometries();
}

/** Where along a bench seat `i` is (local to the truck), and which way he faces. */
function seat(i: number): { x: number; z: number; yaw: number } {
  const side = i % 2 === 0 ? -1 : 1;
  const row = Math.floor(i / 2);
  return { x: side * 0.75, z: -LENGTH / 2 + 3.4 + row * 0.85, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

interface Truck {
  root: THREE.Group;
  /** How far behind the tank (along its tracks) this one drives. */
  gap: number;
  riders: THREE.Mesh[];
}

/**
 * The trucks the prisoners ride out in. They follow the tank nose to tail along its tracks (no
 * steering of their own: the tracks are the road), slowing to a stop when it stops.
 */
export class Convoy {
  readonly group = new THREE.Group();
  private readonly trucks: Truck[] = [];
  /** The tank's tracks, oldest first (seeded with the line they're parked along). */
  private readonly trail: THREE.Vector2[] = [];

  constructor(count: number, parkedAlong: { x: number; z: number }[]) {
    truckGeos ??= truckGeometry();
    // The tracks to start with: along the parked line, a crumb every CRUMB metres.
    for (let i = 0; i + 1 < parkedAlong.length; i++) {
      const a = parkedAlong[i];
      const b = parkedAlong[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / CRUMB));
      for (let k = 0; k < n; k++) this.trail.push(new THREE.Vector2(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n));
    }
    const end = parkedAlong[parkedAlong.length - 1];
    this.trail.push(new THREE.Vector2(end.x, end.z));
    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      for (const [mat, geo] of truckGeos) {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        root.add(m);
      }
      this.group.add(root);
      this.trucks.push({ root, gap: FIRST_GAP + i * GAP, riders: [] });
    }
    this.place();
  }

  get seats(): number {
    return this.trucks.length * SEATS;
  }

  /** Sits `count` prisoners in the backs, filling the trucks in turn. */
  board(count: number): void {
    for (let i = 0; i < Math.min(count, this.seats); i++) {
      const truck = this.trucks[i % this.trucks.length];
      const s = seat(truck.riders.length);
      const man = createFigureMesh(1, ARMY_GREEN);
      man.position.set(s.x, 0.7, s.z);
      man.rotation.y = s.yaw;
      truck.root.add(man);
      truck.riders.push(man);
    }
  }

  /** The tank's moved to `x, z`: drop a crumb if it's gone far enough, and move the trucks up behind it. */
  follow(x: number, z: number): void {
    const last = this.trail[this.trail.length - 1];
    if (Math.hypot(x - last.x, z - last.y) >= CRUMB) this.trail.push(new THREE.Vector2(x, z));
    if (this.trail.length > 4000) this.trail.splice(0, this.trail.length - 4000);
    this.place();
  }

  /** At the end: everyone jumps down beside their truck and cheers. Returns where they're stood. */
  unload(): THREE.Mesh[] {
    const cheering: THREE.Mesh[] = [];
    for (const t of this.trucks) {
      t.riders.forEach((r, i) => {
        t.root.remove(r);
        const man = createCheeringFigure(ARMY_GREEN);
        const side = i % 2 === 0 ? -1 : 1;
        man.position.set(side * 2.2, 0, -LENGTH / 2 + 2.6 + Math.floor(i / 2) * 1.2).applyMatrix4(t.root.matrixWorld);
        man.position.y = 0;
        man.rotation.y = t.root.rotation.y + side * Math.PI / 2;
        this.group.add(man);
        cheering.push(man);
      });
      t.riders.length = 0;
    }
    return cheering;
  }

  /** Each truck at its distance back along the tracks, facing along them. */
  private place(): void {
    for (const t of this.trucks) {
      const at = this.back(t.gap);
      const ahead = this.back(t.gap - 2.5);
      t.root.position.set(at.x, 0, at.y);
      if (ahead.distanceTo(at) > 0.01) t.root.rotation.y = Math.atan2(-(ahead.x - at.x), -(ahead.y - at.y));
      t.root.updateMatrixWorld();
    }
  }

  /** The point `distance` metres back along the tracks from their newest end. */
  private back(distance: number): THREE.Vector2 {
    let left = Math.max(0, distance);
    for (let i = this.trail.length - 1; i > 0; i--) {
      const a = this.trail[i];
      const b = this.trail[i - 1];
      const len = a.distanceTo(b);
      if (left <= len) return a.clone().lerp(b, left / len);
      left -= len;
    }
    return this.trail[0].clone();
  }
}
