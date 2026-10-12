import * as THREE from 'three';
import { PartBuilder, tubeX } from '../utils/modelKit';
import { plastic } from '../utils/plastic';
import { damp } from '../utils/math';
import { VALLEY } from './Layout';
import type { MoonTerrain } from './MoonTerrain';

/** It's a giant: big enough to spot on the mountainside from the far end of the valley. */
const SCALE = 2.2;
const SPEED = 17;
/** How far up the valley's mountain wall it skis (1 is the rim of the floor), and how far its turns swing. */
const TRACK_Q = 1.2;
const CARVE = 0.06;
const TURNS = 9;
/** The canyon cuts through the mountains due south of the valley: it takes that as a ski jump. */
const JUMP_AT = Math.PI / 2;
const JUMP_HALF = 0.22;
const JUMP_RISE = 18;

/** What the robot asks of the game round it. */
export interface SkiFx {
  say(text: string, color: string): void;
  dust(at: THREE.Vector3, count: number, speed: number): void;
}

/**
 * The skiing robot: an old cooker on wheels that always dreamed of skiing, and now does laps of
 * the mountain walls round the Weird Side on a pair of red skis, slaloming along the slope and
 * leaping the canyon each time it comes round. It's scenery: it's up where the buggy can't go.
 */
export class SkiRobot {
  readonly root = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly scarf = new THREE.Group();
  private readonly aerial = new THREE.Group();
  private theta = JUMP_AT + 0.6;
  private time = 0;
  private spray = 0;
  private armLift = 0;
  private spotted = false;
  private jumping = false;
  private readonly takeOff: number;
  private readonly landing: number;
  private readonly here = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();

  constructor(private readonly terrain: MoonTerrain) {
    const g = this.root;
    g.rotation.order = 'YXZ';
    g.scale.setScalar(SCALE);
    const p = new PartBuilder();
    const enamel = plastic(0xf1ead6);
    const trim = plastic(0x3a3d44);
    const steel = plastic(0xaeb4bc);
    const red = plastic(0xd8392e);
    const white = plastic(0xf8f6f0);
    const amber = new THREE.MeshStandardMaterial({ color: 0xffb640, emissive: 0xff9a20, emissiveIntensity: 1.3, roughness: 0.4 });

    // Skis with turned-up tips, and the little wheels the cooker stands on.
    for (const x of [-0.5, 0.5]) {
      p.add(new THREE.BoxGeometry(0.28, 0.06, 3.4), red, x, 0.03, 0.1);
      p.add(new THREE.BoxGeometry(0.28, 0.06, 0.5), red, x, 0.14, 1.98, -0.5);
      p.add(new THREE.BoxGeometry(0.1, 0.02, 3.2), white, x, 0.07, 0.1);
      for (const z of [-0.4, 0.4]) {
        p.add(tubeX(0.18, 0.14, 12), trim, x, 0.26, z);
        p.add(new THREE.BoxGeometry(0.08, 0.2, 0.08), steel, x, 0.5, z);
      }
    }
    // The cooker: plinth, enamel body, oven door with a glowing window, drawer, hob and splash-back.
    p.add(new THREE.BoxGeometry(1.2, 0.12, 1.0), trim, 0, 0.62, 0);
    p.add(new THREE.BoxGeometry(1.3, 1.46, 1.1), enamel, 0, 1.41, 0);
    p.add(new THREE.BoxGeometry(0.96, 0.78, 0.06), trim, 0, 1.3, 0.56);
    p.add(new THREE.BoxGeometry(0.62, 0.4, 0.04), amber, 0, 1.32, 0.59);
    p.add(tubeX(0.035, 0.84, 8), steel, 0, 1.76, 0.64);
    for (const x of [-0.38, 0.38]) p.add(new THREE.BoxGeometry(0.05, 0.05, 0.1), steel, x, 1.76, 0.6);
    p.add(new THREE.BoxGeometry(1.1, 0.2, 0.05), trim, 0, 0.82, 0.56);
    p.add(tubeX(0.03, 0.4, 8), steel, 0, 0.82, 0.61);
    for (let i = 0; i < 4; i++) p.add(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 10).rotateX(Math.PI / 2), i === 3 ? red : trim, -0.42 + i * 0.28, 1.98, 0.58);
    p.add(new THREE.BoxGeometry(1.38, 0.08, 1.18), steel, 0, 2.18, 0);
    for (const [x, z] of [[-0.32, -0.24], [0.32, -0.24], [-0.32, 0.26], [0.32, 0.26]]) p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 14), trim, x, 2.235, z);
    p.add(new THREE.BoxGeometry(1.3, 0.5, 0.08), enamel, 0, 2.46, -0.52);
    p.add(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 14).rotateX(Math.PI / 2), white, 0.36, 2.48, -0.47);
    p.add(new THREE.BoxGeometry(0.02, 0.11, 0.02), trim, 0.36, 2.52, -0.45);
    // The coin box on its side: it wants ten pence for the ski pass.
    p.add(new THREE.BoxGeometry(0.12, 0.42, 0.3), red, 0.7, 1.7, 0.1);
    p.add(new THREE.BoxGeometry(0.02, 0.16, 0.04), trim, 0.765, 1.76, 0.1);
    // A woolly scarf round the top and a bobble hat on the splash-back.
    p.add(new THREE.BoxGeometry(1.4, 0.16, 1.2), red, 0, 2.02, 0);
    for (const x of [-0.5, -0.17, 0.17, 0.5]) p.add(new THREE.BoxGeometry(0.1, 0.17, 1.22), white, x, 2.02, 0);
    p.add(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), red, -0.3, 2.74, -0.52);
    p.add(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 14), white, -0.3, 2.74, -0.52);
    p.add(new THREE.SphereGeometry(0.12, 10, 8), white, -0.3, 3.12, -0.52);
    p.buildInto(g);

    // The scarf's tail, streaming out behind.
    const sp = new PartBuilder();
    for (let i = 0; i < 5; i++) sp.add(new THREE.BoxGeometry(0.3, 0.07, 0.3), i % 2 ? white : red, 0, 0, -0.15 - i * 0.3);
    sp.buildInto(this.scarf);
    this.scarf.position.set(0.3, 2.02, -0.6);
    g.add(this.scarf);

    // A telescopic aerial that wobbles.
    const ap = new PartBuilder();
    ap.add(new THREE.CylinderGeometry(0.03, 0.04, 0.9, 6), steel, 0, 0.45, 0);
    ap.add(new THREE.CylinderGeometry(0.018, 0.025, 0.8, 6), steel, 0, 1.3, 0);
    ap.add(new THREE.SphereGeometry(0.07, 8, 6), red, 0, 1.74, 0);
    ap.buildInto(this.aerial);
    this.aerial.position.set(0.52, 2.2, -0.42);
    g.add(this.aerial);

    // Two spindly arms, each with a ski pole.
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      const b = new PartBuilder();
      const shoulder = new THREE.Vector3(0, 0, 0);
      const elbow = new THREE.Vector3(side * 0.42, -0.1, 0.25);
      const hand = new THREE.Vector3(side * 0.5, -0.5, 0.75);
      const tip = new THREE.Vector3(side * 0.62, -1.72, -0.25);
      b.add(new THREE.SphereGeometry(0.1, 8, 6), trim, 0, 0, 0);
      b.beam(shoulder, elbow, 0.08, steel, true);
      b.add(new THREE.SphereGeometry(0.07, 8, 6), trim, elbow.x, elbow.y, elbow.z);
      b.beam(elbow, hand, 0.07, steel, true);
      b.add(new THREE.SphereGeometry(0.1, 8, 6), red, hand.x, hand.y, hand.z);
      b.beam(hand.clone().lerp(tip, -0.18), tip, 0.045, trim, true);
      b.add(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 10), white, tip.x, tip.y + 0.14, tip.z + 0.1);
      b.buildInto(arm);
      arm.position.set(side * 0.66, 1.78, 0.05);
      g.add(arm);
      this.arms.push(arm);
    }

    this.takeOff = this.groundAt(JUMP_AT - JUMP_HALF);
    this.landing = this.groundAt(JUMP_AT + JUMP_HALF);
    this.place(this.theta, this.here);
    g.position.copy(this.here);
  }

  /** How far up the mountain wall the track is at `theta`: it swings up and down for the slalom. */
  private trackQ(theta: number): number {
    return TRACK_Q + CARVE * Math.sin(theta * TURNS);
  }

  private groundAt(theta: number): number {
    const q = this.trackQ(theta);
    return this.terrain.heightAt(VALLEY.x + Math.cos(theta) * VALLEY.rx * q, VALLEY.z + Math.sin(theta) * VALLEY.rz * q);
  }

  /** How far through the ski jump `theta` is (0 to 1), or -1 when it's on the snow. */
  private jumpAt(theta: number): number {
    const off = Math.atan2(Math.sin(theta - JUMP_AT), Math.cos(theta - JUMP_AT));
    return Math.abs(off) < JUMP_HALF ? (off + JUMP_HALF) / (JUMP_HALF * 2) : -1;
  }

  /** Where the skis are at `theta`: on the slope, or up in the arc of the jump over the canyon. */
  private place(theta: number, out: THREE.Vector3): THREE.Vector3 {
    const q = this.trackQ(theta);
    const x = VALLEY.x + Math.cos(theta) * VALLEY.rx * q;
    const z = VALLEY.z + Math.sin(theta) * VALLEY.rz * q;
    let y = this.terrain.heightAt(x, z);
    const u = this.jumpAt(theta);
    if (u >= 0) y = Math.max(y, THREE.MathUtils.lerp(this.takeOff, this.landing, u) + JUMP_RISE * 4 * u * (1 - u));
    return out.set(x, y, z);
  }

  update(dt: number, buggy: THREE.Vector3, fx: SkiFx): void {
    this.time += dt;
    const here = this.place(this.theta, this.here);
    const step = this.place(this.theta + 0.002, this.ahead).distanceTo(here) / 0.002;
    this.theta = (this.theta + (SPEED * dt) / Math.max(step, 1)) % (Math.PI * 2);
    this.place(this.theta, here);
    const ahead = this.place(this.theta + 0.004, this.ahead);
    const dx = ahead.x - here.x;
    const dz = ahead.z - here.z;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(ahead.y - here.y, Math.hypot(dx, dz));
    const inAir = this.jumpAt(this.theta) >= 0;
    // It leans with the slope it's crossing (half as much, like a skier) and into each turn.
    const sideX = Math.cos(yaw) * 1.5;
    const sideZ = -Math.sin(yaw) * 1.5;
    const slope = inAir ? 0 : Math.atan2(this.terrain.heightAt(here.x + sideX, here.z + sideZ) - this.terrain.heightAt(here.x - sideX, here.z - sideZ), 3);
    const lean = Math.cos(this.theta * TURNS) * 0.22;
    const g = this.root;
    g.position.copy(here);
    g.rotation.set(damp(g.rotation.x, -pitch, 8, dt), yaw, damp(g.rotation.z, slope * 0.5 + lean, 6, dt));

    // Poles push in turn on the snow, and are flung back in the air.
    this.armLift = damp(this.armLift, inAir ? 1 : 0, 6, dt);
    this.arms.forEach((arm, i) => {
      const push = Math.sin(this.time * 5 + i * Math.PI) * 0.32;
      arm.rotation.x = push * (1 - this.armLift) + 0.95 * this.armLift;
      arm.rotation.z = (i ? -1 : 1) * 0.5 * this.armLift;
    });
    this.scarf.rotation.y = Math.sin(this.time * 7) * 0.35;
    this.scarf.rotation.x = Math.sin(this.time * 9.3) * 0.2 - 0.1;
    this.aerial.rotation.z = Math.sin(this.time * 6.1) * 0.12;
    this.aerial.rotation.x = Math.sin(this.time * 4.7) * 0.1 - 0.12;

    const dist = Math.hypot(here.x - buggy.x, here.z - buggy.z);
    if (!this.spotted && dist < 190) {
      this.spotted = true;
      fx.say('LOOK UP! A COOKER ON SKIS!', '#ffd24a');
    }
    if (inAir !== this.jumping) {
      this.jumping = inAir;
      if (dist < 420) fx.say(inAir ? 'SKI JUMP! WHEEEEE!' : 'WHAT A LANDING!', '#7ae0ff');
      if (!inAir) fx.dust(here, 14, 5);
    }
    // Snow (well, dust) thrown up by the skis.
    this.spray -= dt;
    if (!inAir && this.spray <= 0 && dist < 380) {
      this.spray = 0.1;
      fx.dust(here, 2, 3.5);
    }
  }
}
