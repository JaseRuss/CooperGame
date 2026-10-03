import * as THREE from 'three';
import { createFigureMesh } from '../entities/Soldier';
import { nameTag } from '../entities/AllyTank';
import { ARMY_GREEN } from '../utils/plastic';
import { clamp } from '../utils/math';
import type { InputState } from '../input/InputManager';
import { SEA_LEVEL } from './Sea';

/** Buddies are a lighter green than the other prisoners, like their tanks in the main game. */
const BUDDY_COLOR = 0x6a9a3c;
/** Paddling flat out, drifting, and backing water (m/s), and how quickly the raft speeds up and slows down. */
export const CRUISE = 6.2;
const DRIFT = 1.1;
const REVERSE = -1.3;
const SPEED_UP = 2;
const SLOW_DOWN = 2.4;
/** Lying flat under the tarp, the raft barely creeps. */
const FLAT_SPEED = 2.6;
/** The raft turns this fast (rad/s) at speed. */
const TURN_RATE = 0.85;
/** The raft can't leave the channel: the current turns it back at this distance from the middle. */
export const CHANNEL = 125;
const SEAT = [
  { x: 0, z: 0.9 },
  { x: -0.55, z: 0.1 },
  { x: 0.55, z: 0.1 },
  { x: 0, z: -0.9 },
];
/** The triangle's corners (x, z): the bow, then the two stern corners. */
const CORNERS: [number, number][] = [[0, -2.3], [-1.55, 1.7], [1.55, 1.7]];

/**
 * The makeshift raft, stitched from raincoats: a yellow oval tube with the squad kneeling in it,
 * paddling. Drive it with W / S (paddle, back water), A / D (steer); hold Shift to pull the
 * tarp over you and lie flat (slow, but much harder to see from the air).
 */
export class Raft {
  readonly group = new THREE.Group();
  /** Where it is on the water (y is always the sea level). */
  readonly position = new THREE.Vector3();
  /** Which way it points (0 is -Z, increasing turns left), and how fast it's going forward. */
  yaw = 0;
  speed = 0;
  /** 0 sitting up, 1 lying flat under the tarp. */
  flat = 0;
  private readonly body = new THREE.Group();
  private readonly tarp: THREE.Mesh;
  private readonly crew: THREE.Group[] = [];
  private readonly paddles: THREE.Group[] = [];
  private phase = 0;
  /** Blown up enough for the crew to climb in. */
  private manned = false;
  private turn = 0;
  /** How blown up it is (0 flat, 1 full) while being pumped up at the start, and the air in it afterwards (1 hard, 0 flat). */
  private inflation = 1;
  pressure = 1;
  private bob = Math.random() * 10;

  constructor() {
    // An army-green inflatable triangle, like the real escape boat: three fat tubes joined at rounded corners, a floor, and a valve.
    const tube = new THREE.MeshStandardMaterial({ color: 0x4b7a2e, roughness: 0.5, metalness: 0, emissive: 0x14260c });
    const floor = new THREE.MeshStandardMaterial({ color: 0x36581f, roughness: 0.7, metalness: 0, emissive: 0x0c1807 });
    const R = 0.32;
    for (let i = 0; i < 3; i++) {
      const [ax, az] = CORNERS[i];
      const [bx, bz] = CORNERS[(i + 1) % 3];
      const len = Math.hypot(bx - ax, bz - az);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(R, R, len, 14), tube);
      t.position.set((ax + bx) / 2, 0.3, (az + bz) / 2);
      t.rotation.set(Math.PI / 2, 0, 0);
      t.rotation.order = 'YXZ';
      t.rotation.y = Math.atan2(bx - ax, bz - az);
      t.castShadow = true;
      const corner = new THREE.Mesh(new THREE.SphereGeometry(R, 14, 10), tube);
      corner.position.set(ax, 0.3, az);
      this.body.add(t, corner);
    }
    const shape = new THREE.Shape(CORNERS.map(([x, z]) => new THREE.Vector2(x, -z)));
    const base = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).scale(0.82, 1, 0.82), floor);
    base.position.y = 0.22;
    this.body.add(base);
    // A valve on one tube, and a rope lifeline round the outside.
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0xe8e4d0 }));
    valve.position.set(-0.78, 0.65, 0.7);
    this.body.add(valve);
    // A tarp (the raincoats' spare sleeves) to pull over everyone.
    this.tarp = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.2, 0.7, 1.75), new THREE.MeshStandardMaterial({ color: 0x3f4c28, roughness: 0.9, metalness: 0 }));
    this.tarp.position.set(0, 0.4, -0.1);
    this.tarp.castShadow = true;
    this.tarp.visible = false;
    this.body.add(this.tarp);
    this.group.add(this.body);
    this.group.visible = false;
  }

  /** Sets who's aboard: the player (always), the buddies by name. */
  setCrew(buddyNames: string[], showTags: boolean): void {
    for (const c of this.crew) this.body.remove(c);
    for (const p of this.paddles) this.body.remove(p);
    this.crew.length = 0;
    this.paddles.length = 0;
    const wood = new THREE.MeshStandardMaterial({ color: 0xb08a52, roughness: 0.7, metalness: 0 });
    ['Cooper', ...buddyNames].forEach((name, i) => {
      const seat = SEAT[i % SEAT.length];
      const g = new THREE.Group();
      const man = createFigureMesh(1, i === 0 ? ARMY_GREEN : BUDDY_COLOR);
      g.add(man);
      if (i > 0 && showTags) {
        const tag = nameTag(name);
        tag.scale.set(2, 0.5, 1);
        tag.position.y = 1.8;
        g.add(tag);
      }
      g.position.set(seat.x, 0.32, seat.z);
      this.body.add(g);
      this.crew.push(g);
      // A paddle on his outer side: a pole with a blade, pivoting at his hand.
      const side = seat.x === 0 ? (i % 2 ? -1 : 1) : Math.sign(seat.x);
      const paddle = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), wood);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.5, 0.03), wood);
      blade.position.y = -0.95;
      shaft.position.y = -0.2;
      paddle.add(shaft, blade);
      paddle.position.set(seat.x + side * 0.55, 0.95, seat.z);
      paddle.rotation.z = side * 0.45;
      this.body.add(paddle);
      this.paddles.push(paddle);
    });
  }

  /** Squashes the tubes down as the air goes: a soft raft sits low and floppy. */
  private sag(): void {
    const k = this.inflation;
    const soft = 0.4 + 0.6 * this.pressure;
    this.body.scale.set(0.25 + 0.75 * k, (0.1 + 0.9 * k) * soft, 0.25 + 0.75 * k);
  }

  /** The air left in the raft (0 flat, 1 hard): less of it, less speed. */
  setPressure(p: number): void {
    this.pressure = clamp(p, 0, 1);
    this.sag();
  }

  /** Everyone's off: an empty raft. */
  clearCrew(): void {
    for (const c of [...this.crew, ...this.paddles]) this.body.remove(c);
    this.crew.length = 0;
    this.paddles.length = 0;
  }

  /** Puts it on the water at (x, z) pointing `yaw`, dead in the water. */
  place(x: number, z: number, yaw: number): void {
    this.position.set(x, SEA_LEVEL, z);
    this.yaw = yaw;
    this.speed = 0;
    this.flat = 0;
    this.manned = true;
    this.apply(0);
  }

  /** Blowing up (0 flat, 1 full size): it swells out of a heap of raincoats. */
  inflate(t: number): void {
    const k = clamp(t, 0, 1);
    this.inflation = k;
    this.sag();
    this.manned = k > 0.7;
  }

  /** Paddles, steers and drifts for one frame. `paddled` says whether anyone's paddling (the paddles aren't lost). */
  update(dt: number, time: number, input: InputState, paddled = true): void {
    const forward = clamp(input.moveY + input.throttle, -1, 1);
    const turn = clamp(input.moveX + input.steer, -1, 1);
    const flat = input.sneak;
    this.flat += ((flat ? 1 : 0) - this.flat) * Math.min(1, dt * 4);
    let target = forward > 0.1 ? (paddled ? CRUISE : CRUISE * 0.6) : forward < -0.1 ? REVERSE : DRIFT;
    target *= 0.35 + 0.65 * this.pressure;
    if (flat) target = Math.min(target, FLAT_SPEED);
    const rate = target > this.speed ? SPEED_UP : SLOW_DOWN;
    this.speed += clamp(target - this.speed, -rate * dt, rate * dt);
    // Steering bites harder the faster it's moving (and a little even when it's drifting).
    const bite = clamp(0.4 + Math.abs(this.speed) / 3, 0.4, 1.1);
    this.turn += (turn - this.turn) * Math.min(1, dt * 3);
    this.yaw -= this.turn * TURN_RATE * bite * dt;
    this.position.x += -Math.sin(this.yaw) * this.speed * dt;
    this.position.z += -Math.cos(this.yaw) * this.speed * dt;
    // The tide sets it sideways a little.
    this.position.x += Math.sin(time * 0.07) * 0.22 * dt;
    // Out at the edge of the channel the current turns it back.
    const over = Math.abs(this.position.x) - CHANNEL;
    if (over > 0) {
      this.position.x -= Math.sign(this.position.x) * Math.min(over, 6 * dt + over * dt);
    }
    this.phase += dt * (1.8 + Math.max(0, this.speed) * 1.4);
    this.apply(time);
  }

  /** Is it out past the edge of the channel (the current's pushing it back)? */
  get atEdge(): boolean {
    return Math.abs(this.position.x) > CHANNEL - 4;
  }

  private apply(time: number): void {
    this.bob = time;
    this.group.position.set(this.position.x, SEA_LEVEL + 0.1 + Math.sin(this.bob * 1.7) * 0.05, this.position.z);
    this.group.rotation.set(Math.sin(this.bob * 1.1) * 0.03 - this.speed * 0.008, this.yaw, Math.sin(this.bob * 1.3) * 0.05 - this.turn * 0.06, 'YXZ');
    this.tarp.visible = this.flat > 0.5;
    for (let i = 0; i < this.crew.length; i++) {
      this.crew[i].visible = this.manned && this.flat < 0.5;
      const p = this.paddles[i];
      if (p) {
        p.visible = this.manned && this.flat < 0.5;
        const swing = Math.sin(this.phase + i * 1.6) * 0.55 * Math.min(1, Math.max(0.15, this.speed / 2));
        p.rotation.x = swing;
      }
    }
  }

  /** Hide the raft altogether (before it's launched). */
  setVisible(on: boolean): void {
    this.group.visible = on;
  }
}

/**
 * A chase camera for the raft: behind and above it, and the mouse (or right stick) swings it
 * round the raft; left alone it drifts back behind.
 */
export class RaftCam {
  private yawOffset = 0;
  private elevation = 0.42;
  private readonly look = new THREE.Vector3();
  private shake = 0;

  addShake(amount: number): void {
    this.shake = Math.min(0.8, this.shake + amount);
  }

  update(camera: THREE.PerspectiveCamera, raft: Raft, input: InputState, dt: number, distance = 11.5): void {
    this.yawOffset -= input.aimYawDelta;
    this.elevation = clamp(this.elevation + input.aimPitchDelta * 0.8, 0.12, 1.1);
    if (input.aimYawDelta === 0) this.yawOffset *= Math.exp(-dt * 0.45);
    this.yawOffset = clamp(this.yawOffset, -Math.PI, Math.PI);
    const heading = raft.yaw + this.yawOffset;
    const back = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    camera.position.copy(raft.position).addScaledVector(back, distance * Math.cos(this.elevation));
    camera.position.y += 0.8 + distance * Math.sin(this.elevation);
    this.look.copy(raft.position).addScaledVector(back, -5);
    this.look.y += 1.2;
    camera.lookAt(this.look);
    if (this.shake > 0) {
      camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.05;
      camera.rotation.y += (Math.random() - 0.5) * this.shake * 0.05;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
  }

  /** Where the camera looks along the ground (so "up" on the stick means that way). */
  get offset(): number {
    return this.yawOffset;
  }
}
