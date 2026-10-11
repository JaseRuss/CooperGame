import * as THREE from 'three';
import { surfaceHeightAt } from './Terrain';
import { buildPrisonWagon } from './Medieval';
import { createFigureMesh, createSurrenderedKnightMesh, type Soldier } from '../entities/Soldier';
import { ARMY_GREEN, ARMY_TAN, ARMY_BLUE } from '../utils/plastic';
import type { TroopManager } from '../entities/TroopManager';
import type { Prison } from './Prison';

/** Prisoners it carries at once. */
const CAPACITY = 8;
/** Metres a second, and how fast it can turn (radians a second). */
const SPEED = 11;
const TURN_RATE = 2.4;
/** It stops this close to the soldier it came for, and picks up anyone this near. */
const PICKUP_STOP = 5;
const PICKUP_RADIUS = 24;
/** A prisoner climbs in when he gets this close. */
const BOARD_DISTANCE = 2.4;
/** Gives up loading after this long. */
const LOADING_TIMEOUT = 14;
/** Arrived at the prison gate this close. */
const GATE_STOP = 3;
/** Seconds spent handing prisoners over. */
const UNLOAD_TIME = 2.2;
/** A trip that takes longer than this (stuck on something) is abandoned. */
const STUCK_TIME = 150;
const WHEEL_RADIUS = 0.95;
const WHEELBASE = 2.8;
const PULLERS = [-1.1, 1.1];
const PULL_Z = -6.9;
const SEAT_X = [-0.75, 0.75];
const SEAT_Z = [0.05, 0.85, 1.65, 2.45];

type State = 'idle' | 'toPickup' | 'loading' | 'toPrison' | 'unloading';

export interface WagonContext {
  troops: TroopManager;
  /** Our prisons, to deliver to. */
  prisons: Prison[];
  /** The nearest surrendered soldier worth driving to for a wagon at `from` (not claimed by another wagon). */
  nextCaptive(from: THREE.Vector3, wagon: PrisonWagon): Soldier | null;
  /** True for a surrendered soldier this wagon can reach (not inside a standing castle). */
  reachable(s: Soldier): boolean;
}

/**
 * A prisoner wagon, pulled by two green army men. It finds the nearest surrendered knights,
 * drives out to them, they climb in, and it takes them to our nearest prison. It can't be
 * destroyed, and nobody shoots at it.
 */
export class PrisonWagon {
  readonly position = new THREE.Vector3();
  readonly root = new THREE.Group();
  private readonly wheels: THREE.Group[];
  private readonly pullers: THREE.Mesh[] = [];
  private readonly riders: THREE.Mesh[] = [];
  private heading = 0;
  private state: State = 'idle';
  private timer = 0;
  private trip = 0;
  private hop = Math.random() * 10;
  private wheelSpin = 0;
  private load = 0;
  /** The soldier it's driving to. */
  target: Soldier | null = null;
  private readonly boarding = new Set<Soldier>();
  private dest: Prison | null = null;
  /** Called with how many prisoners were just handed over, and where. */
  onDelivered: ((count: number, prison: Prison) => void) | null = null;

  constructor(scene: THREE.Scene, start: THREE.Vector3, heading: number) {
    const { group, wheels } = buildPrisonWagon(ARMY_GREEN);
    this.wheels = wheels;
    this.root.add(group);
    this.root.rotation.order = 'YXZ';
    for (const x of PULLERS) {
      const puller = createFigureMesh(0, ARMY_GREEN);
      puller.position.set(x, 0, PULL_Z);
      this.root.add(puller);
      this.pullers.push(puller);
    }
    for (let i = 0; i < CAPACITY; i++) {
      const rider = createSurrenderedKnightMesh(i % 2 === 0 ? ARMY_TAN : ARMY_BLUE);
      rider.scale.setScalar(0.8);
      rider.position.set(SEAT_X[i % 2], 1.3, SEAT_Z[Math.floor(i / 2)]);
      rider.rotation.y = Math.PI;
      rider.visible = false;
      this.root.add(rider);
      this.riders.push(rider);
    }
    this.position.copy(start);
    this.heading = heading;
    scene.add(this.root);
    this.place(0, 0);
  }

  get carrying(): number {
    return this.load;
  }

  get busy(): boolean {
    return this.state !== 'idle';
  }

  update(dt: number, ctx: WagonContext): void {
    this.timer += dt;
    this.trip += dt;
    let moved = 0;
    switch (this.state) {
      case 'idle':
        if (this.timer > 0.6) {
          this.timer = 0;
          const captive = ctx.nextCaptive(this.position, this);
          if (captive) {
            this.target = captive;
            this.state = 'toPickup';
            this.trip = 0;
          }
        }
        break;
      case 'toPickup': {
        const t = this.target;
        if (!t || !t.isSurrendered || !ctx.reachable(t) || this.trip > STUCK_TIME) {
          this.giveUp();
          break;
        }
        moved = this.driveToward(t.position.x, t.position.z, dt, PICKUP_STOP);
        if (moved < 0) {
          this.state = 'loading';
          this.timer = 0;
          moved = 0;
        }
        break;
      }
      case 'loading':
        this.loading(ctx);
        break;
      case 'toPrison': {
        const d = this.dest;
        if (!d) {
          this.giveUp();
          break;
        }
        if (this.trip > STUCK_TIME) {
          // Hung up on something: it turns up at the gate rather than driving at a wall forever.
          this.position.set(d.door.x, d.door.y, d.door.z);
          this.trip = 0;
        }
        moved = this.driveToward(d.door.x, d.door.z, dt, GATE_STOP);
        if (moved < 0) {
          this.state = 'unloading';
          this.timer = 0;
          moved = 0;
        }
        break;
      }
      case 'unloading':
        if (this.timer >= UNLOAD_TIME) {
          if (this.dest) {
            this.dest.admit(this.load);
            this.onDelivered?.(this.load, this.dest);
          }
          this.setLoad(0);
          this.dest = null;
          this.state = 'idle';
          this.timer = 0;
        }
        break;
    }
    this.place(moved, dt);
  }

  /** Runs out of reasons to be driving: lets everyone go and starts over. */
  private giveUp(): void {
    for (const s of this.boarding) s.escortTo(null);
    this.boarding.clear();
    this.target = null;
    this.trip = 0;
    this.timer = 0;
    this.state = this.load > 0 && this.dest ? 'toPrison' : 'idle';
  }

  private loading(ctx: WagonContext): void {
    // Anyone with his hands up near the wagon walks over; he climbs in when he gets there.
    for (const s of ctx.troops.surrendered()) {
      if (this.load + this.boarding.size >= CAPACITY) break;
      if (this.boarding.has(s) || !ctx.reachable(s)) continue;
      if (s.position.distanceTo(this.position) < PICKUP_RADIUS) {
        this.boarding.add(s);
        s.escortTo(this.position);
      }
    }
    for (const s of [...this.boarding]) {
      if (!s.isSurrendered) {
        this.boarding.delete(s);
      } else if (s.position.distanceTo(this.position) < BOARD_DISTANCE) {
        this.boarding.delete(s);
        ctx.troops.take(s);
        this.setLoad(this.load + 1);
      }
    }
    const full = this.load >= CAPACITY;
    if (full || this.boarding.size === 0 || this.timer > LOADING_TIMEOUT) {
      for (const s of this.boarding) s.escortTo(null);
      this.boarding.clear();
      this.target = null;
      if (this.load > 0) {
        this.dest = nearestPrison(ctx.prisons, this.position);
        this.state = this.dest ? 'toPrison' : 'idle';
        this.trip = 0;
      } else {
        this.state = 'idle';
      }
      this.timer = 0;
    }
  }

  private setLoad(n: number): void {
    this.load = n;
    this.riders.forEach((r, i) => (r.visible = i < n));
  }

  /**
   * Turns toward (x, z) and drives at it. Returns the distance moved, or -1 once it's within `stop`.
   */
  private driveToward(x: number, z: number, dt: number, stop: number): number {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < stop) return -1;
    const want = Math.atan2(-dx, -dz);
    let diff = want - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, diff));
    // Slows right down for a sharp turn so it doesn't swing wide.
    const speed = SPEED * Math.max(0.25, 1 - Math.abs(diff) / 1.6);
    const step = Math.min(d - stop * 0.5, speed * dt);
    this.position.x -= Math.sin(this.heading) * step;
    this.position.z -= Math.cos(this.heading) * step;
    return step;
  }

  private place(moved: number, dt: number): void {
    this.position.y = surfaceHeightAt(this.position.x, this.position.z);
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const front = surfaceHeightAt(this.position.x + fx * WHEELBASE, this.position.z + fz * WHEELBASE);
    const back = surfaceHeightAt(this.position.x - fx * WHEELBASE, this.position.z - fz * WHEELBASE);
    this.root.position.copy(this.position);
    this.root.rotation.y = this.heading;
    this.root.rotation.x = Math.atan2(front - back, WHEELBASE * 2);
    if (dt > 0) {
      this.wheelSpin += moved / WHEEL_RADIUS;
      this.hop += moved * 1.6;
    }
    for (const w of this.wheels) w.rotation.x = -this.wheelSpin;
    // The two pullers hop along, in step.
    const bob = moved > 0 ? Math.abs(Math.sin(this.hop)) * 0.25 : 0;
    this.pullers.forEach((p, i) => (p.position.y = bob * (i === 0 ? 1 : 0.85)));
  }
}

function nearestPrison(prisons: Prison[], from: THREE.Vector3): Prison | null {
  let best: Prison | null = null;
  let bestD = Infinity;
  for (const p of prisons) {
    const d = Math.hypot(p.door.x - from.x, p.door.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
