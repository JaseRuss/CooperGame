import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE } from '../utils/plastic';
import { mulberry32 } from '../utils/rng';
import { createPoseFigure } from '../entities/Soldier';
import { MOON_G } from './Buggy';
import { canyonX, VALLEY } from './Layout';
import type { MoonTerrain } from './MoonTerrain';
import { bulldozer, steamroller, dumpTruck, cementMixer, type Machine } from './RoadMachines';
import { signboard } from './wonders/kit';

/** What the road-building scene asks of the game round it. */
export interface RoadFx {
  boom(at: THREE.Vector3, size: number): void;
  dust(at: THREE.Vector3, count: number, speed: number): void;
  confetti(at: THREE.Vector3): void;
  sound(name: 'boom' | 'explosion' | 'thud' | 'clang' | 'poof', at: THREE.Vector3, volume: number, rate: number): void;
  banner(title: string, subtitle: string): void;
  stinger(): void;
}

/** The scene's length, and its beats. */
export const ROADWORKS_TIME = 19.6;
const DRIVE_END = 7.6;
const PLUNGE = 8.9;
const BLAST = 9.3;
const FLY_FROM = 10.6;
const FLY_TO = 14.8;
const WORDS_AT = 15.2;
/** The rockfall that blocks the canyon until the road is built, and where the bulldozer at the front stops short of it. */
const PLUG_Z = -620;
const STOP_Z = -602;
const SPACING = 13;
/** Where along the road the bulldozer starts: far enough out that the whole column is on the road. */
const LEAD_START = SPACING * 3 + 4;

interface Boulder {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

const ease = (u: number) => u * u * (3 - 2 * u);

/** The point `s` metres along a path of points about evenly spaced, and which way it runs there. */
function along(path: THREE.Vector2[], lengths: number[], s: number): { p: THREE.Vector2; dir: THREE.Vector2 } {
  const total = lengths[lengths.length - 1];
  const d = THREE.MathUtils.clamp(s, 0, total);
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < d) i++;
  const a = path[i - 1];
  const b = path[i];
  const k = (d - lengths[i - 1]) / Math.max(1e-6, lengths[i] - lengths[i - 1]);
  return { p: a.clone().lerp(b, k), dir: b.clone().sub(a).normalize() };
}

function cumulative(path: THREE.Vector2[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + path[i].distanceTo(path[i - 1]));
  return out;
}

/**
 * The last act of the supply run: once every army has its Moon base, the four armies' road crews
 * drive out of the back of the main base laying a new road north, blast away the rockfall that
 * blocks the canyon through the mountains, and the camera flies on down the canyon to the Weird
 * Side's valley. Before that, the rockfall and a ROAD CLOSED sign sit at the canyon mouth.
 */
export class RoadWorks {
  readonly group = new THREE.Group();
  playing = false;
  done = false;
  time = 0;
  private readonly machines: Machine[];
  private readonly boulders: Boulder[] = [];
  private readonly barrier: THREE.Group;
  private readonly plunger: THREE.Group;
  private readonly handle: THREE.Object3D;
  private readonly north: THREE.Vector2[];
  private readonly northLen: number[];
  private readonly loopLen: number;
  /** Where the bulldozer stops, and where the road has got to by then (behind the steamroller). */
  private readonly leadStop: number;
  private readonly stopAt: number;
  private readonly plugCentre: THREE.Vector3;
  private blasted = false;
  private worded = false;
  private nextThud = 0;
  private shake = 0;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: MoonTerrain,
    /** The north road's and the ring road's meshes, laid a bit at a time. */
    private readonly roads: THREE.Mesh[],
  ) {
    scene.add(this.group);
    this.north = terrain.paths[terrain.shownRoads];
    this.northLen = cumulative(this.north);
    this.loopLen = cumulative(terrain.paths[terrain.shownRoads + 1]).slice(-1)[0];
    this.leadStop = this.northLen[this.north.findIndex((p) => p.y < STOP_Z)];
    this.stopAt = this.leadStop - SPACING * 3 - 3;
    const px = canyonX(PLUG_Z);
    this.plugCentre = new THREE.Vector3(px, terrain.heightAt(px, PLUG_Z), PLUG_Z);

    // The rockfall: big boulders piled across the canyon.
    const rng = mulberry32(616);
    const rock = new THREE.MeshStandardMaterial({ color: 0x7c7a76, roughness: 1, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const r = 2 + rng() * 2.8;
      const x = px - 18 + rng() * 36;
      const z = PLUG_Z - 6 + rng() * 12;
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rock);
      mesh.position.set(x, terrain.heightAt(x, z) + r * 0.6 + (i > 9 ? 3 : 0), z);
      mesh.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.boulders.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    // The barrier in front of it, and the sign.
    this.barrier = new THREE.Group();
    const p = new PartBuilder();
    for (let i = 0; i < 4; i++) {
      const x = px - 13 + i * 8.6;
      for (const dx of [-2.6, 2.6]) {
        p.add(new THREE.BoxGeometry(0.2, 1.4, 0.2), plastic(0x9aa0a8), x + dx, 0.7, 0, 0.3);
        p.add(new THREE.BoxGeometry(0.2, 1.4, 0.2), plastic(0x9aa0a8), x + dx, 0.7, 0, -0.3);
      }
      for (let k = 0; k < 6; k++) p.add(new THREE.BoxGeometry(1, 0.6, 0.12), plastic(k % 2 ? 0xffffff : 0xd8303a), x - 2.5 + k, 1.3, 0);
      p.add(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a10, emissiveIntensity: 1.4 }), x, 1.8, 0);
    }
    p.buildInto(this.barrier);
    const sign = signboard(['ROAD CLOSED', 'OPENS WHEN ALL FOUR ARMIES', 'HAVE THEIR MOON BASES'], 6, 2.4, { bg: '#ffd23a', fg: '#1a1a1a' }, 1.8);
    sign.position.set(px - 8, 0, 0.2);
    this.barrier.add(sign);
    this.barrier.position.set(0, terrain.heightAt(px, -608), -608);
    this.group.add(this.barrier);

    // The road crew, waiting out of sight until it's time.
    this.machines = [bulldozer(ARMY_GREEN), dumpTruck(ARMY_TAN), cementMixer(ARMY_BLUE), steamroller(ARMY_RED)];
    for (const m of this.machines) {
      m.root.visible = false;
      this.group.add(m.root);
    }
    // The soldier with the detonator, by the side of the road.
    this.plunger = new THREE.Group();
    const box = new PartBuilder();
    box.add(new THREE.BoxGeometry(1, 0.8, 0.8), plastic(0xd8303a), 0, 0.4, 0);
    box.add(new THREE.BoxGeometry(0.8, 0.1, 0.1), plastic(0xffd23a), 0, 0.5, 0.41);
    box.buildInto(this.plunger);
    this.handle = new THREE.Group();
    const h = new PartBuilder();
    h.add(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), plastic(0x3a3e46), 0, 0.5, 0);
    h.add(new THREE.BoxGeometry(0.9, 0.12, 0.12), plastic(0x3a3e46), 0, 1, 0);
    h.buildInto(this.handle);
    this.handle.position.y = 0.8;
    this.plunger.add(this.handle);
    const man = createPoseFigure(ARMY_GREEN, 'kneel', true);
    man.position.set(0, 0, 0.9);
    this.plunger.add(man);
    const at = this.pointAt(this.leadStop - 10);
    const sx = at.p.x - at.dir.y * 9;
    const sz = at.p.y + at.dir.x * 9;
    this.plunger.position.set(sx, terrain.heightAt(sx, sz), sz);
    this.plunger.rotation.y = Math.atan2(this.plugCentre.x - sx, this.plugCentre.z - sz) + Math.PI;
    this.plunger.visible = false;
    this.group.add(this.plunger);
  }

  private pointAt(s: number): { p: THREE.Vector2; dir: THREE.Vector2 } {
    return along(this.north, this.northLen, s);
  }

  /** Lays the north road up to `s` metres, and the ring road's first `loop` fraction. */
  private lay(s: number, loop: number): void {
    const steps = this.northLen.findIndex((d) => d >= s);
    this.roads[0].geometry.setDrawRange(0, Math.max(0, steps < 0 ? Infinity : steps * 6));
    const loopSteps = Math.floor(loop * (this.loopLen / 3));
    this.roads[1].geometry.setDrawRange(0, loop >= 1 ? Infinity : loopSteps * 6);
  }

  /** Where the lead machine is, `t` seconds into the scene. */
  private leadAt(t: number): number {
    return LEAD_START + (this.leadStop - LEAD_START) * ease(THREE.MathUtils.clamp((t - 0.6) / (DRIVE_END - 0.6), 0, 1));
  }

  begin(): void {
    this.playing = true;
    this.time = 0;
    this.blasted = false;
    this.worded = false;
    for (const m of this.machines) m.root.visible = true;
    this.plunger.visible = true;
    this.lay(0, 0);
  }

  /** Advances the scene; true once it's over. */
  update(dt: number, fx: RoadFx): boolean {
    if (!this.playing) return true;
    const before = this.time;
    this.time += dt;
    const t = this.time;
    // The column drives out, the steamroller at the back laying the road as it goes.
    const lead = this.leadAt(t);
    this.machines.forEach((m, i) => {
      const s = lead - i * SPACING;
      const { p, dir } = this.pointAt(Math.max(0, s));
      const prev = m.root.position.clone();
      m.root.position.set(p.x, this.terrain.heightAt(p.x, p.y), p.y);
      m.root.rotation.y = Math.atan2(dir.x, dir.y);
      const moved = m.root.position.distanceTo(prev);
      for (const w of m.spinners) w.rotation.x += moved / 0.9;
      if (m.churn) m.churn.rotation.z += dt * 2.5;
      if (i === 0 && moved > 0.05 && Math.random() < dt * 14) fx.dust(m.root.position.clone().add(new THREE.Vector3(dir.x * 3.4, 0.4, dir.y * 3.4)), 3, 3);
    });
    if (t < BLAST) this.lay(Math.max(0, lead - SPACING * 3 - 3), 0);
    if (t > 0.6 && t < DRIVE_END && t > this.nextThud) {
      this.nextThud = t + 0.45;
      fx.sound('thud', this.machines[0].root.position, 0.5, 0.6);
    }
    // Plunger down, then the bang.
    this.handle.position.y = 0.8 - 0.6 * ease(THREE.MathUtils.clamp((t - PLUNGE) / 0.3, 0, 1));
    if (!this.blasted && t >= BLAST) {
      this.blasted = true;
      this.shake = 1;
      const rng = mulberry32(17);
      for (const b of this.boulders) {
        const out = b.mesh.position.clone().sub(this.plugCentre).setY(0).normalize();
        b.vel.set(out.x * (4 + rng() * 8), 10 + rng() * 12, -6 - rng() * 10);
        b.spin.set(rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2);
      }
      for (let i = 0; i < 5; i++) fx.boom(this.plugCentre.clone().add(new THREE.Vector3((i - 2) * 6, 2 + (i % 2) * 3, (i % 3) - 1)), 2.2);
      fx.dust(this.plugCentre.clone().setY(this.plugCentre.y + 1), 40, 10);
      fx.confetti(this.plugCentre.clone().setY(this.plugCentre.y + 14));
      fx.sound('explosion', this.plugCentre, 1, 0.8);
      fx.sound('boom', this.plugCentre, 1, 0.7);
      this.barrier.visible = false;
    }
    if (this.blasted) {
      for (const b of this.boulders) {
        if (!b.mesh.visible) continue;
        b.vel.y -= MOON_G * dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        b.mesh.rotation.x += b.spin.x * dt;
        b.mesh.rotation.y += b.spin.y * dt;
        if (b.mesh.position.y < this.terrain.heightAt(b.mesh.position.x, b.mesh.position.z) - 4) b.mesh.visible = false;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 1.5);
    // The camera flies down the canyon, and the road unrolls just ahead of it.
    if (t >= FLY_FROM - 0.4) {
      const k = THREE.MathUtils.clamp((t - FLY_FROM + 0.4) / (FLY_TO - FLY_FROM + 0.4), 0, 1);
      const end = this.northLen[this.northLen.length - 1];
      this.lay(this.stopAt + (end - this.stopAt) * Math.min(1, k * 1.25), THREE.MathUtils.clamp((t - FLY_TO + 0.6) / 2.2, 0, 1));
    }
    if (!this.worded && t >= WORDS_AT) {
      this.worded = true;
      fx.banner('THE WEIRD SIDE OF THE MOON', "A new road over the mountains! Let's go and explore");
      fx.stinger();
      fx.confetti(new THREE.Vector3(0, 40, -960));
    }
    if (before < BLAST + 1.5 && t >= BLAST + 1.5) fx.sound('poof', this.plugCentre, 0.6, 0.8);
    if (t >= ROADWORKS_TIME) {
      this.finish();
      return true;
    }
    return false;
  }

  /** Skips to the end: the road laid, the rockfall gone, the crew packed away (they're having a tea break by the canyon). */
  finish(): void {
    this.playing = false;
    this.done = true;
    this.lay(Infinity, 1);
    for (const b of this.boulders) b.mesh.visible = false;
    this.barrier.visible = false;
    for (const m of this.machines) m.root.visible = false;
    this.plunger.visible = false;
  }

  /** Where the camera is during the scene. */
  cameraShot(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const t = this.time;
    let shot: { pos: THREE.Vector3; look: THREE.Vector3 };
    if (t < 2.6) {
      const k = t / 2.6;
      shot = { pos: new THREE.Vector3(36 - k * 10, 42 - k * 8, 10 - k * 20), look: new THREE.Vector3(0, 0, -150 - k * 40) };
    } else if (t < DRIVE_END) {
      // Alongside the column as it goes.
      const lead = this.leadAt(t);
      const { p, dir } = this.pointAt(lead - SPACING * 1.5);
      const side = new THREE.Vector2(-dir.y, dir.x);
      const pos = new THREE.Vector3(p.x + side.x * 20 + dir.x * 10, this.terrain.heightAt(p.x, p.y) + 8, p.y + side.y * 20 + dir.y * 10);
      shot = { pos, look: new THREE.Vector3(p.x + dir.x * 6, this.terrain.heightAt(p.x, p.y) + 2, p.y + dir.y * 6) };
    } else if (t < FLY_FROM) {
      // Low by the detonator, looking up the canyon at the rockfall.
      const k = THREE.MathUtils.clamp((t - DRIVE_END) / (FLY_FROM - DRIVE_END), 0, 1);
      const det = this.plunger.position;
      const pos = det.clone().add(new THREE.Vector3(0, 3.2 + k * 2, 0)).add(det.clone().sub(this.plugCentre).setY(0).normalize().multiplyScalar(6 + k * 4));
      shot = { pos, look: this.plugCentre.clone().setY(this.plugCentre.y + 4 + k * 4) };
    } else if (t < FLY_TO) {
      // Swooping down the canyon.
      const k = ease((t - FLY_FROM) / (FLY_TO - FLY_FROM));
      const end = this.northLen[this.northLen.length - 1];
      const s = this.stopAt + (end - 40 - this.stopAt) * k;
      const { p } = this.pointAt(s);
      const ahead = this.pointAt(s + 40).p;
      shot = {
        pos: new THREE.Vector3(p.x, this.terrain.heightAt(p.x, p.y) + 9 + k * 14, p.y),
        look: new THREE.Vector3(ahead.x, this.terrain.heightAt(ahead.x, ahead.y) + 4, ahead.y),
      };
    } else {
      // Up over the valley for a look at what's there.
      const k = ease(Math.min(1, (t - FLY_TO) / (ROADWORKS_TIME - FLY_TO)));
      shot = { pos: new THREE.Vector3(0, 30 + k * 55, -940 + k * 30), look: new THREE.Vector3(0, 10, VALLEY.z - 40) };
    }
    if (this.shake > 0) shot.pos.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
    return shot;
  }
}
