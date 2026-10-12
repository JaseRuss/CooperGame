import * as THREE from 'three';
import { PartBuilder, loftGeometry, tubeX, tubeZ } from '../utils/modelKit';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';
import { createCheeringFigure } from '../entities/Soldier';
import { damp, clamp } from '../utils/math';
import type { MoonTerrain } from './MoonTerrain';

/**
 * Moon gravity is about a sixth of Earth's (1.6 m/s²). The buggy's is a bit stronger than that so
 * jumps are floaty without taking forever.
 */
export const MOON_G = 2.5;
const JUMP_SPEED = 6.4;
/** How high the chassis centre sits above flat ground when the springs are loaded just by its weight. */
const RIDE = 0.62;
const SPRING_K = 90;
const SPRING_C = 5.5;
const MAX_COMPRESS = 0.55;
const MAX_SPEED = 27;
const ENGINE = 10.5;
const BRAKE = 20;
const WHEEL_R = 0.58;
const HALF_TRACK = 1.05;
const HALF_BASE = 1.35;
/** A landing faster than this makes a thud; faster than the second, the load shakes loose. */
export const THUD_SPEED = 4.5;
export const HARD_SPEED = 8.2;
const COYOTE = 0.14;
export const MAX_CRATES = 4;

/** What the player asked for this frame. */
export interface DriveInput {
  /** -1..1, forward positive. */
  throttle: number;
  /** -1..1, right positive. */
  steer: number;
  jump: boolean;
  brake: boolean;
}

/** What happened during a step, for sound and dust. */
export interface BuggyEvents {
  jumped: boolean;
  /** Downward speed of a landing (0 for none). */
  landed: number;
  /** Speed of a bump into a rock or building (0 for none). */
  bumped: number;
}

const crateProtos = new Map<number, THREE.Group>();

/** A supply crate in an army's colour, with white straps and a star. The geometry is shared between copies. */
export function makeCrate(color: number): THREE.Group {
  let proto = crateProtos.get(color);
  if (!proto) {
    proto = new THREE.Group();
    const p = new PartBuilder();
    const body = plastic(color);
    const strap = plastic(0xf2eee2);
    const dark = plastic(shade(color, 0.6));
    p.add(new THREE.BoxGeometry(0.92, 0.92, 0.92), body, 0, 0, 0);
    for (const x of [-0.3, 0.3]) p.add(new THREE.BoxGeometry(0.12, 0.96, 0.96), strap, x, 0, 0);
    p.add(new THREE.BoxGeometry(0.96, 0.12, 0.96), strap, 0, 0, 0);
    for (const [x, z] of [[-0.43, -0.43], [0.43, -0.43], [-0.43, 0.43], [0.43, 0.43]]) p.add(new THREE.BoxGeometry(0.12, 0.98, 0.12), dark, x, 0, z);
    p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 5), strap, 0, 0.47, 0);
    p.buildInto(proto);
    crateProtos.set(color, proto);
  }
  return proto.clone();
}

interface Wheel {
  steer: THREE.Group;
  spin: THREE.Group;
  x: number;
  z: number;
  /** Where the tyre meets the ground, as a drop below the chassis (smoothed for the suspension). */
  drop: number;
}

/**
 * The moon buggy: a toy rover with four balloon tyres under mudguards, a rounded hood behind a bull
 * bar, two army men cheering in a roll cage, a dish, and a railed bed behind for the supply crates. Its physics are hand-rolled: soft springs, slidey
 * grip and a jump that takes several seconds to come down.
 */
export class Buggy {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  grounded = false;
  /** How long it has been off the ground (seconds); zero when it's down. */
  airTime = 0;
  /** The army the crates on board belong to (a colour), and how many there are. */
  cargoColor = 0;
  cargo = 0;
  private yawRate = 0;
  private coyote = 0;
  private jumpHeld = false;
  private steerAngle = 0;
  private wheelSpin = 0;
  private readonly wheels: Wheel[] = [];
  private readonly crates: THREE.Object3D[] = [];
  private readonly crateSpring: { o: number; v: number }[] = [];
  private lastVy = 0;
  private readonly tmp = new THREE.Vector2();

  constructor() {
    const g = this.root;
    const p = new PartBuilder();
    const frame = plastic(0x4a4e56);
    const body = plastic(ARMY_GREEN);
    const dark = plastic(shade(ARMY_GREEN, 0.6));
    const steel = plastic(0xaeb4bc);
    const seat = plastic(0x2f3238);
    const white = plastic(0xf2eee2);
    const orange = plastic(0xf2a21e);
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0ae34, metalness: 0.75, roughness: 0.38, flatShading: true });
    const lamp = new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0xffe9a0, emissiveIntensity: 1.4 });
    const tail = new THREE.MeshStandardMaterial({ color: 0xff3b2e, emissive: 0xff2010, emissiveIntensity: 1.2 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.28, roughness: 0.05, clearcoat: 1, depthWrite: false });
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // The chassis: two rails with cross-members, a skid plate, and a gold-foil equipment box slung under the bed.
    for (const x of [-0.55, 0.55]) p.add(new THREE.BoxGeometry(0.14, 0.16, 4.6), frame, x, -0.2, -0.1);
    for (const z of [-2.3, -1.35, 0, 1.35, 2.1]) p.add(new THREE.BoxGeometry(1.24, 0.12, 0.14), frame, 0, -0.2, z);
    p.add(new THREE.BoxGeometry(1.0, 0.05, 3.2), steel, 0, -0.3, 0.2);
    p.add(new THREE.BoxGeometry(0.96, 0.3, 0.8), gold, 0, -0.24, -2.0);
    // Jump jets: four little rocket bells under the corners.
    for (const [x, z] of [[-0.42, 0.75], [0.42, 0.75], [-0.42, -0.85], [0.42, -0.85]]) {
      p.add(new THREE.CylinderGeometry(0.08, 0.17, 0.24, 10), frame, x, -0.4, z);
      p.add(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 10), orange, x, -0.3, z);
    }

    // A rounded hood that tapers to the nose, with racing stripes and a white star.
    p.add(
      loftGeometry(
        [
          { z: 0.7, w: 1.84, h: 0.68, y: 0.14 },
          { z: 1.3, w: 1.76, h: 0.62, y: 0.14 },
          { z: 1.95, w: 1.56, h: 0.46, y: 0.08 },
          { z: 2.3, w: 1.2, h: 0.28, y: 0.02 },
        ],
        20,
        4,
      ),
      body,
    );
    for (const x of [-0.34, 0.34]) p.add(new THREE.BoxGeometry(0.16, 0.03, 0.62), orange, x, 0.47, 1.02);
    p.add(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 5), white, 0, 0.47, 1.05);
    // Grille, a tubular bull bar, and headlamps in steel housings.
    p.add(new THREE.BoxGeometry(0.72, 0.16, 0.05), seat, 0, 0.03, 2.31);
    for (const x of [-0.24, -0.08, 0.08, 0.24]) p.add(new THREE.BoxGeometry(0.04, 0.17, 0.06), steel, x, 0.03, 2.32);
    p.add(tubeX(0.06, 1.96, 10), steel, 0, -0.1, 2.5);
    p.add(tubeX(0.05, 1.2, 10), steel, 0, 0.22, 2.48);
    for (const x of [-0.58, 0.58]) {
      p.beam(v(x, -0.1, 2.5), v(x, 0.22, 2.48), 0.09, steel, true);
      p.beam(v(x * 0.95, -0.2, 2.1), v(x, -0.1, 2.5), 0.09, steel, true);
    }
    for (const x of [-0.58, 0.58]) {
      p.add(tubeZ(0.2, 0.17, 0.2, 14), steel, x, 0.2, 2.1);
      p.add(new THREE.SphereGeometry(0.17, 12, 8), lamp, x, 0.2, 2.16, 0, 0, 0, 1, 1, 0.5);
    }

    // The cab: a tub with a dashboard, a steering wheel and two bucket seats with headrests.
    p.add(new THREE.BoxGeometry(1.84, 0.08, 1.5), dark, 0, -0.1, -0.02);
    for (const x of [-0.9, 0.9]) {
      p.add(new THREE.BoxGeometry(0.08, 0.5, 1.5), body, x, 0.15, -0.02);
      p.add(new THREE.BoxGeometry(0.1, 0.06, 1.5), orange, x, 0.42, -0.02);
    }
    p.add(new THREE.BoxGeometry(1.84, 0.62, 0.08), body, 0, 0.2, -0.76);
    p.add(new THREE.BoxGeometry(1.72, 0.24, 0.26), seat, 0, 0.56, 0.62);
    for (const x of [-0.6, -0.42, -0.24]) p.add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10).rotateX(Math.PI / 2), lamp, x, 0.6, 0.48);
    p.add(new THREE.TorusGeometry(0.17, 0.028, 6, 16), seat, -0.42, 0.74, 0.36, -0.5);
    p.beam(v(-0.42, 0.74, 0.36), v(-0.42, 0.56, 0.6), 0.05, steel, true);
    for (const x of [-0.42, 0.42]) {
      p.add(new THREE.BoxGeometry(0.64, 0.16, 0.62), seat, x, 0.3, -0.05);
      p.add(new THREE.BoxGeometry(0.64, 0.7, 0.14), seat, x, 0.68, -0.42, -0.1);
      p.add(new THREE.BoxGeometry(0.36, 0.2, 0.13), seat, x, 1.12, -0.48, -0.1);
      p.add(new THREE.BoxGeometry(0.1, 0.72, 0.15), orange, x, 0.68, -0.42, -0.1);
    }
    // The roll cage: raked pillars, top rails, a brace across the back, a low windscreen and a light bar.
    for (const x of [-0.9, 0.9]) {
      const top = x * 0.92;
      p.beam(v(x, 0.4, 0.74), v(top, 1.52, 0.42), 0.11, steel, true);
      p.beam(v(x, 0.4, -0.74), v(top, 1.52, -0.6), 0.11, steel, true);
      p.beam(v(top, 1.52, 0.42), v(top, 1.52, -0.6), 0.11, steel, true);
      for (const z of [0.42, -0.6]) p.add(new THREE.SphereGeometry(0.065, 8, 6), steel, top, 1.52, z);
    }
    p.add(tubeX(0.055, 1.66, 10), steel, 0, 1.52, 0.42);
    p.add(tubeX(0.055, 1.66, 10), steel, 0, 1.52, -0.6);
    p.beam(v(-0.86, 0.6, -0.72), v(0.84, 1.48, -0.62), 0.07, steel, true);
    p.add(new THREE.BoxGeometry(1.66, 0.46, 0.03), glass, 0, 0.84, 0.66, -0.28);
    p.add(new THREE.BoxGeometry(1.3, 0.1, 0.12), seat, 0, 1.63, 0.42);
    for (const x of [-0.48, -0.16, 0.16, 0.48]) p.add(new THREE.SphereGeometry(0.085, 10, 8), lamp, x, 1.63, 0.49, 0, 0, 0, 1, 1, 0.6);

    // The load bed: a dark floor, low boards, a tubular rail round the top and a tailgate with lights.
    p.add(new THREE.BoxGeometry(1.95, 0.16, 2.35), dark, 0, 0.06, -1.62);
    for (const x of [-0.96, 0.96]) {
      p.add(new THREE.BoxGeometry(0.06, 0.22, 2.35), body, x, 0.25, -1.62);
      p.add(tubeZ(0.045, 0.045, 2.35, 8), steel, x, 0.5, -1.62);
      for (const z of [-0.5, -1.62, -2.76]) p.add(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8), steel, x, 0.32, z);
    }
    p.add(new THREE.BoxGeometry(1.95, 0.26, 0.08), body, 0, 0.27, -2.82);
    p.add(tubeX(0.045, 1.95, 8), steel, 0, 0.5, -2.8);
    p.add(new THREE.BoxGeometry(0.5, 0.16, 0.02), white, 0, 0.27, -2.87);
    for (const x of [-0.78, 0.78]) p.add(new THREE.BoxGeometry(0.22, 0.14, 0.04), tail, x, 0.27, -2.87);
    p.add(new THREE.BoxGeometry(1.9, 0.12, 0.14), frame, 0, -0.06, -2.9);

    // Mudguards over each wheel on little stays, and the springs.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wx = sx * HALF_TRACK;
        const wz = sz * HALF_BASE;
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.42;
          p.add(new THREE.BoxGeometry(0.6, 0.05, 0.4), dark, wx, -0.04 + Math.cos(a) * 0.9, wz + Math.sin(a) * 0.9, a);
        }
        p.beam(v(sx * 0.6, -0.14, wz), v(sx * 0.82, 0.84, wz), 0.06, steel, true);
        p.beam(v(sx * 0.62, -0.2, wz - 0.3), v(sx * 0.86, -0.08, wz), 0.07, frame, true);
        p.beam(v(sx * 0.62, -0.2, wz + 0.3), v(sx * 0.86, -0.08, wz), 0.07, frame, true);
        p.beam(v(sx * 0.58, 0.36, wz + sz * 0.16), v(sx * 0.8, -0.06, wz + sz * 0.16), 0.13, orange, true);
      }
    }

    // A dish with a feed horn on a mast at one back corner, and a whip aerial with a pennant at the other.
    p.add(new THREE.CylinderGeometry(0.05, 0.06, 1.4, 8), steel, 0.86, 1.1, -2.72);
    p.add(new THREE.SphereGeometry(0.46, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), white, 0.86, 1.86, -2.72, -1.0, 0.3);
    p.add(new THREE.SphereGeometry(0.07, 8, 6), orange, 0.86, 1.86, -2.72);
    p.add(new THREE.CylinderGeometry(0.015, 0.02, 2.3, 4), steel, -0.86, 1.6, -2.72);
    p.add(new THREE.SphereGeometry(0.06, 6, 5), plastic(0xe0503f), -0.86, 2.76, -2.72);
    p.add(new THREE.BoxGeometry(0.02, 0.24, 0.42), orange, -0.86, 2.5, -2.94);
    p.buildInto(g);

    const driver = createCheeringFigure(ARMY_GREEN, true);
    driver.scale.setScalar(0.55);
    driver.rotation.y = Math.PI;
    driver.position.set(-0.42, 0.45, 0.02);
    g.add(driver);
    const mate = createCheeringFigure(0xb8392e, true);
    mate.scale.setScalar(0.55);
    mate.rotation.y = Math.PI;
    mate.position.set(0.42, 0.45, 0.02);
    g.add(mate);

    // Fat balloon tyres with chevron treads, on yellow five-spoke hubs.
    const tyre = plastic(0x2a2c31);
    const hub = plastic(0xe8c23f);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      const wp = new PartBuilder();
      wp.add(new THREE.TorusGeometry(WHEEL_R - 0.23, 0.23, 10, 22).rotateY(Math.PI / 2), tyre, 0, 0, 0, 0, 0, 0, 1.15, 1, 1);
      wp.add(tubeX(0.4, 0.42, 16), tyre, 0, 0, 0);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        for (const side of [-1, 1]) wp.add(new THREE.BoxGeometry(0.27, 0.07, 0.1), tyre, side * 0.11, Math.cos(a) * (WHEEL_R - 0.025), Math.sin(a) * (WHEEL_R - 0.025), a, side * 0.4);
      }
      wp.add(tubeX(0.31, 0.5, 14), hub, 0, 0, 0);
      wp.add(new THREE.TorusGeometry(0.31, 0.035, 6, 18).rotateY(Math.PI / 2), steel, sx * 0.25, 0, 0);
      for (let i = 0; i < 5; i++) wp.add(new THREE.BoxGeometry(0.05, 0.56, 0.09), steel, sx * 0.25, 0, 0, (i / 5) * Math.PI * 2 + Math.PI / 5);
      wp.add(new THREE.SphereGeometry(0.1, 10, 8), steel, sx * 0.27, 0, 0, 0, 0, 0, 0.7, 1, 1);
      wp.buildInto(spin);
      steer.add(spin);
      steer.position.set(sx * HALF_TRACK, -0.04, sz * HALF_BASE);
      g.add(steer);
      this.wheels.push({ steer, spin, x: sx * HALF_TRACK, z: sz * HALF_BASE, drop: 0 });
    }
    g.rotation.order = 'YXZ';
  }

  /** The buggy's forward direction on the ground. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** How fast it's travelling forward (negative in reverse), in metres per second. */
  get forwardSpeed(): number {
    return this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
  }

  /** Parks it on the ground at (x, z) facing `yaw`, standing still. */
  placeAt(x: number, z: number, yaw: number, terrain: MoonTerrain): void {
    this.pos.set(x, terrain.heightAt(x, z) + RIDE, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.airTime = 0;
    this.grounded = true;
    this.applyPose();
  }

  /** Moves it to (x, z) facing `yaw`, keeping its speed but turned to match (for doors that lead somewhere else). */
  teleport(x: number, z: number, yaw: number, terrain: MoonTerrain): void {
    const turn = yaw - this.yaw;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const vx = this.vel.x;
    this.vel.x = vx * c + this.vel.z * s;
    this.vel.z = -vx * s + this.vel.z * c;
    const lift = this.pos.y - terrain.heightAt(this.pos.x, this.pos.z);
    this.pos.set(x, terrain.heightAt(x, z) + Math.max(lift, RIDE), z);
    this.yaw = yaw;
    this.applyPose();
  }

  /** Loads (or empties) the bed: `count` crates of an army's colour. */
  setCargo(color: number, count: number): void {
    for (const c of this.crates) this.root.remove(c);
    this.crates.length = 0;
    this.crateSpring.length = 0;
    this.cargoColor = color;
    this.cargo = count;
    for (let i = 0; i < count; i++) {
      const crate = makeCrate(color);
      const row = i % 2 === 0 ? -1.05 : -2.0;
      const side = i < 2 ? -0.5 : 0.5;
      crate.position.set(side, 0.6, row);
      crate.rotation.y = (i - 1.5) * 0.04;
      this.root.add(crate);
      this.crates.push(crate);
      this.crateSpring.push({ o: 0, v: 0 });
    }
  }

  /** The world position of the top crate, for flinging it off when the ride gets rough. Null with no cargo. */
  cratePosition(index = this.crates.length - 1): THREE.Vector3 | null {
    const c = this.crates[index];
    if (!c) return null;
    this.root.updateMatrixWorld(true);
    return c.getWorldPosition(new THREE.Vector3());
  }

  /** Where the bed's crates sit in the world (for unloading): their positions in order. */
  cratePositions(): THREE.Vector3[] {
    this.root.updateMatrixWorld(true);
    return this.crates.map((c) => c.getWorldPosition(new THREE.Vector3()));
  }

  /** Takes a crate off the bed (its last one). */
  dropCrate(): void {
    if (this.cargo === 0) return;
    this.setCargo(this.cargoColor, this.cargo - 1);
  }

  /** Advances the physics by `dt` (keep it under about 1/30 s). */
  step(dt: number, input: DriveInput, terrain: MoonTerrain, ev: BuggyEvents): void {
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // The ground under the four wheels.
    let sum = 0;
    let top = -Infinity;
    const hs: number[] = [];
    for (const w of this.wheels) {
      const wx = this.pos.x + w.x * cosY + w.z * sinY;
      const wz = this.pos.z - w.x * sinY + w.z * cosY;
      const h = terrain.heightAt(wx, wz);
      hs.push(h);
      sum += h;
      top = Math.max(top, h);
    }
    const ground = (sum / 4) * 0.6 + top * 0.4;
    const [fl, fr, rl, rr] = hs;
    const targetPitch = Math.atan2((fl + fr) / 2 - (rl + rr) / 2, HALF_BASE * 2);
    const targetRoll = Math.atan2((fl + rl) / 2 - (fr + rr) / 2, HALF_TRACK * 2);

    // Vertical: gravity, springs and the jump.
    const rest = ground + RIDE;
    const comp = rest - this.pos.y;
    const touching = comp > -0.01;
    const wasGrounded = this.grounded;
    const impactVy = this.vel.y;
    this.vel.y -= MOON_G * dt;
    if (touching) {
      this.vel.y += (SPRING_K * Math.min(comp, MAX_COMPRESS) - SPRING_C * this.vel.y) * dt;
      if (comp > MAX_COMPRESS) {
        this.pos.y = rest - MAX_COMPRESS;
        if (this.vel.y < 0) this.vel.y *= -0.12;
      }
      if (!wasGrounded && impactVy < -0.5 && this.airTime > 0.25) ev.landed = Math.max(ev.landed, -impactVy);
      this.grounded = true;
      this.airTime = 0;
      this.coyote = COYOTE;
    } else {
      this.grounded = false;
      this.airTime += dt;
      this.coyote = Math.max(0, this.coyote - dt);
    }
    const jumpPressed = input.jump && !this.jumpHeld;
    this.jumpHeld = input.jump;
    if (jumpPressed && (this.grounded || this.coyote > 0)) {
      this.vel.y = JUMP_SPEED;
      this.coyote = 0;
      this.grounded = false;
      ev.jumped = true;
    }

    // Along the ground: engine, brakes and slidey grip.
    let vf = this.vel.x * sinY + this.vel.z * cosY;
    let vl = this.vel.x * cosY - this.vel.z * sinY;
    if (this.grounded) {
      const road = terrain.roadDistAt(this.pos.x, this.pos.z) < 4.2;
      const grip = (road ? 3.6 : 2.0) * (input.brake ? 0.4 : 1);
      const reversing = input.throttle * vf < -0.5;
      if (input.throttle !== 0) {
        const accel = reversing ? BRAKE : ENGINE * (1 - Math.min(1, Math.abs(vf) / MAX_SPEED) ** 2) * (input.throttle < 0 ? 0.6 : 1);
        vf += input.throttle * accel * dt;
      } else {
        const roll = Math.min(Math.abs(vf), 0.9 * dt);
        vf -= Math.sign(vf) * roll;
      }
      if (input.brake) vf *= Math.exp(-1.6 * dt);
      vf *= Math.exp(-0.04 * dt);
      vl *= Math.exp(-grip * dt);
      const factor = clamp(Math.abs(vf) / 5, 0, 1) * (1 - 0.4 * clamp(Math.abs(vf) / MAX_SPEED, 0, 1));
      const turn = -input.steer * 1.55 * factor * (vf < -0.5 ? -1 : 1);
      this.yawRate = damp(this.yawRate, turn, 7, dt);
      // Downhill pulls it along: the slope's rise per metre times gravity.
      const grad = terrain.gradient(this.pos.x, this.pos.z, this.tmp);
      vf -= (grad.x * sinY + grad.y * cosY) * MOON_G * 0.9 * dt;
      vl -= (grad.x * cosY - grad.y * sinY) * MOON_G * 0.9 * dt;
      this.vel.x = vf * sinY + vl * cosY;
      this.vel.z = vf * cosY - vl * sinY;
    } else {
      // In the air: W and S pitch the nose, A and D spin it round, and nothing slows it down.
      this.yawRate = damp(this.yawRate, -input.steer * 1.1, 3, dt);
      this.pitch = clamp(this.pitch - input.throttle * 1.3 * dt, -1.1, 1.1);
    }
    this.yaw += this.yawRate * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // Boulders and buildings: bounce off, or sail over them.
    for (const s of terrain.solids.near(this.pos.x, this.pos.z)) {
      const dx = this.pos.x - s.x;
      const dz = this.pos.z - s.z;
      const reach = s.r + 1.5;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      if (this.pos.y - RIDE * 0.5 > terrain.heightAt(s.x, s.z) + s.h) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d;
      const nz = dz / d;
      this.pos.x = s.x + nx * reach;
      this.pos.z = s.z + nz * reach;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) {
        this.vel.x -= 1.35 * vn * nx;
        this.vel.z -= 1.35 * vn * nz;
        ev.bumped = Math.max(ev.bumped, -vn);
      }
    }
    // The edge of the plain (and of the canyon and valley, once they're open).
    const out = terrain.keepInside(this.pos);
    if (out) {
      const vn = this.vel.x * out.x + this.vel.z * out.y;
      if (vn > 0) {
        ev.bumped = Math.max(ev.bumped, vn);
        this.vel.x -= 1.4 * vn * out.x;
        this.vel.z -= 1.4 * vn * out.y;
      }
    }

    // Attitude: it follows the ground when it's down, and is free in the air.
    if (this.grounded) {
      this.pitch = damp(this.pitch, targetPitch, 9, dt);
      this.roll = damp(this.roll, targetRoll, 9, dt);
    } else {
      this.roll = damp(this.roll, 0, 0.7, dt);
    }

    // Wheels and the load.
    const speed = this.forwardSpeed;
    this.wheelSpin += (speed * dt) / WHEEL_R;
    this.steerAngle = damp(this.steerAngle, -input.steer * 0.42, 9, dt);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const contact = this.grounded ? clamp(hs[i] + WHEEL_R - (this.pos.y - 0.04), -0.5, 0.35) : -0.4;
      w.drop = damp(w.drop, contact, 14, dt);
    }
    const accY = dt > 0 ? (this.vel.y - this.lastVy) / dt : 0;
    this.lastVy = this.vel.y;
    for (const s of this.crateSpring) {
      s.v += (-60 * s.o - 5 * s.v - accY * 0.5) * dt;
      s.o = clamp(s.o + s.v * dt, -0.18, 0.22);
    }
    this.applyPose();
  }

  private applyPose(): void {
    this.root.position.copy(this.pos);
    this.root.rotation.set(-this.pitch, this.yaw, this.roll);
    this.wheels.forEach((w, i) => {
      w.steer.position.y = -0.04 + w.drop;
      w.steer.rotation.y = i < 2 ? this.steerAngle : 0;
      w.spin.rotation.x = this.wheelSpin;
    });
    this.crates.forEach((c, i) => {
      c.position.y = 0.6 + this.crateSpring[i].o;
    });
  }
}
