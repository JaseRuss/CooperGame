import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';
import { createCheeringFigure } from '../entities/Soldier';
import { damp, clamp } from '../utils/math';
import { MoonTerrain, PLAY_HALF } from './MoonTerrain';

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
 * The moon buggy: a toy rover with four fat wheels, an army man at the wheel waving, a roll bar, a
 * dish and a flat bed behind for the supply crates. Its physics are hand-rolled: soft springs, slidey
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
    const frame = plastic(0x5b6068);
    const body = plastic(ARMY_GREEN);
    const dark = plastic(shade(ARMY_GREEN, 0.6));
    const steel = plastic(0xaeb4bc);
    const seat = plastic(0x2f3238);
    const white = plastic(0xf2eee2);
    const lamp = new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0xffe9a0, emissiveIntensity: 1.4 });

    p.add(new THREE.BoxGeometry(1.5, 0.28, 4.3), frame, 0, -0.16, 0);
    // Hood and the front bumper.
    p.add(new THREE.BoxGeometry(1.7, 0.5, 1.45), body, 0, 0.12, 1.35);
    p.add(new THREE.BoxGeometry(1.76, 0.24, 0.3), dark, 0, -0.04, 2.2);
    for (const x of [-0.5, 0.5]) p.add(new THREE.SphereGeometry(0.17, 10, 8), lamp, x, 0.2, 2.1);
    // Seats, two side by side, backs to the rear.
    for (const x of [-0.42, 0.42]) {
      p.add(new THREE.BoxGeometry(0.7, 0.2, 0.7), seat, x, 0.36, 0.0);
      p.add(new THREE.BoxGeometry(0.7, 0.62, 0.16), seat, x, 0.66, -0.4);
    }
    p.add(new THREE.BoxGeometry(1.8, 0.4, 0.8), body, 0, 0.1, 0.1);
    p.add(new THREE.BoxGeometry(1.84, 0.1, 0.84), dark, 0, 0.32, 0.1);
    // The cab's roll bar and a flat windscreen frame.
    for (const [x, z] of [[-0.88, 0.62], [0.88, 0.62], [-0.88, -0.62], [0.88, -0.62]]) p.add(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), steel, x, 0.88, z);
    for (const x of [-0.88, 0.88]) p.add(new THREE.CylinderGeometry(0.06, 0.06, 1.24, 8).rotateX(Math.PI / 2), steel, x, 1.48, 0);
    p.add(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8).rotateZ(Math.PI / 2), steel, 0, 1.48, 0.62);
    p.add(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8).rotateZ(Math.PI / 2), steel, 0, 1.48, -0.62);
    // The load bed.
    p.add(new THREE.BoxGeometry(1.95, 0.16, 2.35), dark, 0, 0.06, -1.62);
    for (const x of [-0.96, 0.96]) p.add(new THREE.BoxGeometry(0.08, 0.3, 2.35), steel, x, 0.26, -1.62);
    p.add(new THREE.BoxGeometry(1.95, 0.3, 0.08), steel, 0, 0.26, -2.82);
    // A dish on a mast at the back corner, and a whip aerial.
    p.add(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), steel, 0.84, 1.0, -2.7);
    p.add(new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), white, 0.84, 1.8, -2.7, -1.0, 0.3);
    p.add(new THREE.CylinderGeometry(0.015, 0.015, 2.3, 4), steel, -0.84, 1.3, -2.7);
    p.add(new THREE.SphereGeometry(0.05, 6, 5), plastic(0xe0503f), -0.84, 2.45, -2.7);
    // A white star on the hood.
    p.add(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 5), white, 0, 0.39, 1.35);
    p.buildInto(g);

    const driver = createCheeringFigure(ARMY_GREEN);
    driver.scale.setScalar(0.55);
    driver.rotation.y = Math.PI;
    driver.position.set(-0.42, 0.45, 0.02);
    g.add(driver);
    const mate = createCheeringFigure(0xb8392e);
    mate.scale.setScalar(0.55);
    mate.rotation.y = Math.PI;
    mate.position.set(0.42, 0.45, 0.02);
    g.add(mate);

    const tyre = plastic(0x2a2c31);
    const hub = plastic(0xe8c23f);
    const lug = plastic(0xaeb4bc);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      const wp = new PartBuilder();
      wp.add(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.52, 18).rotateZ(Math.PI / 2), tyre, 0, 0, 0);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        wp.add(new THREE.BoxGeometry(0.56, 0.1, 0.16), tyre, 0, Math.cos(a) * (WHEEL_R + 0.03), Math.sin(a) * (WHEEL_R + 0.03), a);
      }
      wp.add(new THREE.CylinderGeometry(0.3, 0.3, 0.56, 12).rotateZ(Math.PI / 2), hub, 0, 0, 0);
      for (let i = 0; i < 3; i++) wp.add(new THREE.BoxGeometry(0.58, 0.08, 0.5), lug, 0, 0, 0, (i / 3) * Math.PI);
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
    // The edge of the plain.
    for (const axis of ['x', 'z'] as const) {
      const limit = PLAY_HALF - 6;
      if (Math.abs(this.pos[axis]) > limit) {
        const sign = Math.sign(this.pos[axis]);
        this.pos[axis] = sign * limit;
        if (this.vel[axis] * sign > 0) {
          ev.bumped = Math.max(ev.bumped, Math.abs(this.vel[axis]));
          this.vel[axis] *= -0.4;
        }
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
