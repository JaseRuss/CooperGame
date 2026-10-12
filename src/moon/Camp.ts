import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';
import { createCheeringFigure } from '../entities/Soldier';
import { mulberry32 } from '../utils/rng';
import { dome, tube, WHITE, STEEL, DARK } from '../world/MoonBase';
import { makeCrate, MOON_G } from './Buggy';
import { approach, DROP_DISTANCE, DROP_RADIUS, CRATES_NEEDED, type Faction } from './Layout';

/** What a camp's building sequence can ask of the game around it. */
export interface BuildFx {
  /** A cloud of dust kicked up at a point; `size` is roughly its radius. */
  dust(at: THREE.Vector3, size: number): void;
  /** A firework burst. */
  burst(at: THREE.Vector3): void;
  /** A thump, a clang or a pop. */
  sound(name: 'thud' | 'clang' | 'poof' | 'boom' | 'crack' | 'cheer'): void;
  /** Words across the screen. */
  banner(title: string, subtitle: string): void;
}

type Kind = 'rise' | 'slide' | 'lift';

interface Piece {
  obj: THREE.Object3D;
  t0: number;
  t1: number;
  kind: Kind;
  /** Kick up dust round it when it starts. */
  dust: number;
  started: boolean;
  /** For 'lift': how far it climbs. */
  height: number;
}

interface Hopper {
  mesh: THREE.Object3D;
  base: THREE.Vector3;
  phase: number;
  period: number;
  height: number;
  yaw: number;
}

/** The whole sequence's length, and the time the words come up. */
export const BUILD_TIME = 15.5;
const WORDS_AT = 11.2;

const easeBack = (u: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
};
const easeOut = (u: number) => 1 - (1 - u) ** 3;
const ease = (u: number) => u * u * (3 - 2 * u);

/** An army flag: the army's colour with a white star. */
function armyFlag(color: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 120;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  ctx.fillRect(0, 0, 192, 120);
  ctx.fillStyle = '#f4efe0';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 16 : 40;
    ctx.lineTo(96 + Math.cos(a) * r, 62 + Math.sin(a) * r);
  }
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * An army's camp on the Moon. Until its supplies arrive it's a handful of tents, a signal beam and
 * a pallet waiting at the end of the road, with the army men hopping about and waving the buggy in.
 * Once the third crate lands, `beginBuild` plays the time-lapse: the tents fold, a pad, domes,
 * tubes, solar panels, a dish and a flag go up in turn, and the whole army celebrates.
 *
 * Everything is in a group at the camp's middle, turned so its +Z points down the road toward the
 * main base.
 */
export class Camp {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  /** Where the drop-off ring is, in the world. */
  readonly drop = new THREE.Vector3();
  readonly yaw: number;
  delivered = 0;
  /** Crates in the air between the buggy and the pallet. */
  incoming = 0;
  built = false;
  building = false;
  private time = 0;
  private buildT = 0;
  private wordsShown = false;
  private nextBurst = 0;
  private readonly tents = new THREE.Group();
  private readonly beacon: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly posts: THREE.Group;
  private readonly stacked: THREE.Object3D[] = [];
  private readonly hoppers: Hopper[] = [];
  private readonly pieces: Piece[] = [];
  private readonly glass = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc860, emissiveIntensity: 0.05 });
  private readonly buildGroup = new THREE.Group();
  private flag!: THREE.Mesh;
  private flagPole!: THREE.Object3D;
  private readonly rng: () => number;
  private readonly slots: THREE.Vector3[] = [];

  constructor(
    scene: THREE.Scene,
    readonly faction: Faction,
    terrain: { heightAt(x: number, z: number): number },
    index: number,
  ) {
    const u = approach(faction);
    this.yaw = Math.atan2(u.x, u.y);
    this.rng = mulberry32(5000 + index * 31);
    this.center.set(faction.camp.x, terrain.heightAt(faction.camp.x, faction.camp.z), faction.camp.z);
    this.group.position.copy(this.center);
    this.group.rotation.y = this.yaw;
    scene.add(this.group);
    this.drop.copy(this.localToWorld(0, 0, DROP_DISTANCE));

    const color = faction.color;
    const p = new PartBuilder();
    const canvas = plastic(color);
    const canvasDark = plastic(shade(color, 0.7));
    const wood = plastic(0x8b5e38);
    const steel = plastic(STEEL);
    const white = plastic(WHITE);

    // Tents: a canvas pyramid on a pole each.
    for (const [x, z, r] of [[-11, -7, 0.4], [10, -9, -0.3], [-1, -15, 0.1], [-17, -17, 0.8]]) {
      const t = new PartBuilder();
      t.add(new THREE.ConeGeometry(3, 3, 4).rotateY(Math.PI / 4), canvas, 0, 1.5, 0, 0, r, 0, 1, 1, 1.3);
      t.add(new THREE.BoxGeometry(0.14, 3.3, 0.14), wood, 0, 1.6, 0);
      t.add(new THREE.BoxGeometry(2.4, 0.1, 3), canvasDark, 0, 0.05, 0, 0, r);
      const g = new THREE.Group();
      t.buildInto(g);
      g.position.set(x, 0, z);
      this.tents.add(g);
    }
    // Supplies already unpacked, and a little flag on a pole.
    for (const [x, z] of [[8, -2], [9.2, 0.4], [-8, 1]]) p.add(new THREE.BoxGeometry(1.1, 1.1, 1.1), canvasDark, x, 0.55, z, 0, x);
    p.add(new THREE.CylinderGeometry(0.07, 0.07, 6, 6), steel, -5, 3, 4);
    // The pallet the crates land on, with a low rail round three sides.
    const pallet = this.localToLocalPallet();
    p.add(new THREE.BoxGeometry(5, 0.3, 2), wood, pallet.x, 0.15, pallet.z);
    p.buildInto(this.group);
    const smallFlag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4, 6, 1).translate(1.1, 0, 0), new THREE.MeshStandardMaterial({ map: armyFlag(color), side: THREE.DoubleSide }));
    smallFlag.position.set(-5, 5.3, 4);
    this.group.add(smallFlag);
    this.group.add(this.tents);

    // The signal: a beam of the army's colour that can be seen from the main base, and a ring on the ground.
    const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.4, 170, 14, 1, true), beamMat);
    this.beacon.position.set(pallet.x, 85, pallet.z);
    this.group.add(this.beacon);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(DROP_RADIUS - 0.7, DROP_RADIUS, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.position.set(pallet.x, 0.3, pallet.z);
    this.group.add(this.ring);
    this.posts = new THREE.Group();
    const pp = new PartBuilder();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = pallet.x + Math.cos(a) * DROP_RADIUS;
      const z = pallet.z + Math.sin(a) * DROP_RADIUS;
      pp.add(new THREE.CylinderGeometry(0.14, 0.18, 1.8, 6), i % 2 ? white : canvas, x, 0.9, z);
      pp.add(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }), x, 1.9, z);
    }
    pp.buildInto(this.posts);
    this.group.add(this.posts);

    // Crate slots on the pallet: three across.
    for (let i = 0; i < CRATES_NEEDED; i++) this.slots.push(this.localToWorld((i - (CRATES_NEEDED - 1) / 2) * 1.5, 0.3 + 0.46, DROP_DISTANCE));

    // The army, hopping about near the tents and waving.
    for (let i = 0; i < 7; i++) {
      const mesh = createCheeringFigure(color, true);
      const a = this.rng() * Math.PI * 2;
      const d = 4 + this.rng() * 9;
      const base = new THREE.Vector3(Math.cos(a) * d, 0, -6 + Math.sin(a) * d * 0.7);
      mesh.position.copy(base);
      this.group.add(mesh);
      this.hoppers.push({ mesh, base, phase: this.rng(), period: 1.7 + this.rng() * 1.2, height: 0.6 + this.rng() * 1.2, yaw: Math.PI });
    }

    this.group.add(this.buildGroup);
    this.makeBuild();
  }

  private localToLocalPallet(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, DROP_DISTANCE);
  }

  /** A point in the camp's own frame (x across, z toward the road), in the world. */
  localToWorld(x: number, y: number, z: number): THREE.Vector3 {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return new THREE.Vector3(this.center.x + x * c + z * s, this.center.y + y, this.center.z - x * s + z * c);
  }

  /** The three crate slots on the pallet, in the world. */
  slotWorld(index: number): THREE.Vector3 {
    return this.slots[Math.min(index, this.slots.length - 1)].clone();
  }

  /** Shows the crates delivered so far, stacked on the pallet. */
  showDelivered(n: number): void {
    while (this.stacked.length < n) {
      const crate = makeCrate(this.faction.color);
      const slot = this.slots[Math.min(this.stacked.length, this.slots.length - 1)];
      crate.position.copy(slot);
      crate.rotation.y = this.yaw;
      this.group.parent?.add(crate);
      this.stacked.push(crate);
    }
  }

  // ---------- waiting for supplies ----------

  /** Idle animation: the army hops and waves (more when the buggy's near), the ring pulses. */
  update(dt: number, buggyDistance: number): void {
    this.time += dt;
    const t = this.time;
    const excited = this.built ? 1.2 : this.building ? 0.8 : buggyDistance < 90 ? 1.6 : 1;
    for (const h of this.hoppers) {
      const f = (t * excited / h.period + h.phase) % 1;
      h.mesh.position.set(h.base.x, 4 * h.height * f * (1 - f) * (this.built ? 1.6 : 1), h.base.z);
      h.mesh.rotation.y = h.yaw + (this.built ? Math.sin(t * 0.5 + h.phase * 6) * 0.9 : 0.2 * Math.sin(t + h.phase * 9));
    }
    if (!this.built && !this.building) {
      const pulse = 0.55 + 0.45 * Math.sin(t * 3);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + pulse * 0.5;
      (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.22 + pulse * 0.16;
    }
    if (this.flag) {
      const pos = this.flag.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 1.6 - t * 2) * 0.1 * pos.getX(i));
      pos.needsUpdate = true;
    }
  }

  // ---------- the build ----------

  /** The dome, tubes, panels, dish and flag, all there but hidden until their moment. */
  private makeBuild(): void {
    const color = this.faction.color;
    const g = this.buildGroup;
    const concrete = plastic(0x8d8a82);
    const accent = plastic(color);
    const steel = plastic(STEEL);
    const dark = plastic(DARK);
    const panelMat = plastic(0x1f3a78);

    const add = (obj: THREE.Object3D, t0: number, t1: number, kind: Kind, dustSize = 0, height = 0): void => {
      obj.visible = false;
      // The domes' windows share one material, so they can all light up together.
      obj.traverse((o) => {
        const m = o instanceof THREE.Mesh ? (o.material as THREE.MeshStandardMaterial) : null;
        if (m && m.emissive && m.emissiveIntensity === 0.9 && m.color.getHex() === 0xffe2a0) (o as THREE.Mesh).material = this.glass;
      });
      g.add(obj);
      this.pieces.push({ obj, t0, t1, kind, dust: dustSize, started: false, height });
    };
    const piece = (fn: (p: PartBuilder) => void, x: number, z: number): THREE.Group => {
      const grp = new THREE.Group();
      const p = new PartBuilder();
      fn(p);
      p.buildInto(grp);
      grp.position.set(x, 0, z);
      return grp;
    };
    const glassDome = (r: number, porchYaw: number) => (p: PartBuilder) => {
      dome(p, 0, 0, r, porchYaw);
      p.add(new THREE.TorusGeometry(r * 0.99, 0.35, 6, 48).rotateX(Math.PI / 2), accent, 0, 1.3 + r * 0.15, 0);
      p.add(new THREE.SphereGeometry(r * 0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), accent, 0, 1.3 + r * 0.97, 0);
    };

    // The landing pad: concrete with the army's colour round its rim.
    const pad = piece((p) => {
      p.add(new THREE.CylinderGeometry(19, 19.5, 0.5, 36), concrete, 0, 0.25, 0);
      p.add(new THREE.TorusGeometry(18.2, 0.35, 6, 48).rotateX(Math.PI / 2), accent, 0, 0.55, 0);
    }, 0, 0);
    add(pad, 1.6, 2.8, 'rise', 0);
    // The main dome, and a small one either side joined by tubes.
    add(piece(glassDome(10.5, 0), 0, -3), 3.0, 5.6, 'rise', 9);
    const domeL = piece(glassDome(6, Math.PI * 0.3), -19, -9);
    const domeR = piece(glassDome(6.5, -Math.PI * 0.3), 19, -11);
    add(domeL, 5.2, 7.0, 'rise', 6);
    add(domeR, 5.8, 7.6, 'rise', 6);
    const tubeFrom = (ax: number, az: number, bx: number, bz: number) => {
      const grp = new THREE.Group();
      const p = new PartBuilder();
      const len = Math.hypot(bx - ax, bz - az);
      tube(p, new THREE.Vector2(0, 0), new THREE.Vector2(0, len));
      p.buildInto(grp);
      grp.position.set(ax, 0, az);
      grp.rotation.y = Math.atan2(bx - ax, bz - az);
      return grp;
    };
    add(tubeFrom(-9.5, -5, -15.6, -8.2), 6.8, 7.8, 'slide');
    add(tubeFrom(9.5, -6, 15.3, -9.5), 7.2, 8.2, 'slide');
    // Solar panels, one after the other.
    for (let i = 0; i < 6; i++) {
      const x = -34 + (i % 3) * 7;
      const z = 14 + Math.floor(i / 3) * 8;
      add(
        piece((p) => {
          p.add(new THREE.CylinderGeometry(0.2, 0.2, 2.4, 6), steel, 0, 1.2, 0);
          p.add(new THREE.BoxGeometry(6, 0.2, 4), panelMat, 0, 2.5, 0, -0.5);
          for (let k = -1; k <= 1; k++) p.add(new THREE.BoxGeometry(0.08, 0.25, 4), steel, k * 2, 2.55, 0, -0.5);
        }, x, z),
        7.6 + i * 0.35,
        8.4 + i * 0.35,
        'rise',
        0,
      );
    }
    // A dish on a mast, and a fuel store: three white tanks.
    add(
      piece((p) => {
        p.add(new THREE.CylinderGeometry(0.4, 0.6, 10, 10), steel, 0, 5, 0);
        p.add(new THREE.SphereGeometry(4.6, 24, 10, 0, Math.PI * 2, 0, Math.PI / 3), plastic(WHITE), 0, 10.4, 0, -0.9, 0.5);
        p.add(new THREE.CylinderGeometry(0.1, 0.1, 4, 6), steel, 0, 11.8, 1.4, -0.9, 0.5);
      }, 24, -14),
      9.0,
      10.0,
      'rise',
      3,
    );
    add(
      piece((p) => {
        for (let i = 0; i < 3; i++) {
          p.add(new THREE.CylinderGeometry(1.5, 1.5, 4, 14), plastic(WHITE), i * 3.4, 2, 0);
          p.add(new THREE.SphereGeometry(1.5, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), plastic(WHITE), i * 3.4, 4, 0);
          p.add(new THREE.CylinderGeometry(1.52, 1.52, 0.5, 14), accent, i * 3.4, 1.2, 0);
        }
        p.add(new THREE.BoxGeometry(10.4, 0.2, 0.3), dark, 3.4, 3.4, 1.6);
      }, -29, -2),
      8.4,
      9.4,
      'rise',
      3,
    );
    // The flag pole rises, then the flag climbs it.
    this.flagPole = piece((p) => {
      p.add(new THREE.CylinderGeometry(0.14, 0.18, 14, 8), steel, 0, 7, 0);
      p.add(new THREE.SphereGeometry(0.4, 10, 8), plastic(0xe8c23f), 0, 14.2, 0);
    }, 12, 10);
    add(this.flagPole, 9.8, 10.6, 'rise', 0);
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.1, 10, 1).translate(2.5, 0, 0), new THREE.MeshStandardMaterial({ map: armyFlag(color), side: THREE.DoubleSide }));
    this.flag.position.set(12.2, 2, 10);
    this.flag.visible = false;
    g.add(this.flag);
    this.pieces.push({ obj: this.flag, t0: 10.2, t1: 12.4, kind: 'lift', dust: 0, started: false, height: 10.4 });
  }

  /** Seconds into the time-lapse. */
  get buildTime(): number {
    return this.buildT;
  }

  /** Starts the time-lapse. */
  beginBuild(): void {
    this.building = true;
    this.buildT = 0;
    this.wordsShown = false;
    this.nextBurst = 11.6;
    this.ring.visible = false;
    this.posts.visible = false;
    this.beacon.visible = false;
  }

  /** Advances the sequence; true once it's finished. */
  updateBuild(dt: number, fx: BuildFx): boolean {
    if (!this.building) return true;
    const before = this.buildT;
    this.buildT += dt;
    const t = this.buildT;
    // The tents fold up and blow away.
    const fold = THREE.MathUtils.clamp((t - 0.9) / 1.3, 0, 1);
    this.tents.scale.setScalar(Math.max(0.001, 1 - ease(fold)));
    this.tents.visible = fold < 1;
    if (before < 0.9 && t >= 0.9) {
      fx.dust(this.localToWorld(0, 1, -10), 8);
      fx.sound('poof');
    }
    for (const piece of this.pieces) {
      if (t < piece.t0) continue;
      const u = THREE.MathUtils.clamp((t - piece.t0) / (piece.t1 - piece.t0), 0, 1);
      if (!piece.started) {
        piece.started = true;
        piece.obj.visible = true;
        if (piece.dust > 0) {
          const at = new THREE.Vector3();
          piece.obj.getWorldPosition(at);
          fx.dust(at.setY(this.center.y + 0.6), piece.dust);
          fx.sound(piece.kind === 'rise' && piece.dust > 6 ? 'thud' : 'poof');
        } else if (piece.kind === 'rise') fx.sound('clang');
      }
      if (piece.kind === 'rise') piece.obj.scale.setScalar(Math.max(0.001, easeBack(u)));
      else if (piece.kind === 'slide') piece.obj.scale.set(1, 1, Math.max(0.001, easeOut(u)));
      else piece.obj.position.y = 2 + piece.height * ease(u);
    }
    // The windows come on.
    this.glass.emissiveIntensity = 0.05 + 1.1 * THREE.MathUtils.clamp((t - 7.5) / 3, 0, 1);
    if (!this.wordsShown && t >= WORDS_AT) {
      this.wordsShown = true;
      fx.banner(`${this.faction.name.toUpperCase()} MOON BASE!`, 'The base is open. Home sweet Moon');
      fx.sound('cheer');
    }
    // Fireworks over the finished base.
    if (t >= this.nextBurst && t < BUILD_TIME - 0.5) {
      this.nextBurst = t + 0.55 + this.rng() * 0.5;
      fx.burst(this.localToWorld((this.rng() - 0.5) * 26, 20 + this.rng() * 14, -4 + (this.rng() - 0.5) * 16));
    }
    // The army cheers louder.
    if (t > 11) for (const h of this.hoppers) h.height = Math.max(h.height, 1.6);
    if (t >= BUILD_TIME) {
      this.finishBuild();
      return true;
    }
    return false;
  }

  /** Jumps to the finished camp (the end of the sequence, or when it's skipped). */
  finishBuild(): void {
    for (const piece of this.pieces) {
      piece.started = true;
      piece.obj.visible = true;
      if (piece.kind === 'lift') piece.obj.position.y = 2 + piece.height;
      else piece.obj.scale.set(1, 1, 1);
    }
    this.tents.visible = false;
    this.ring.visible = false;
    this.posts.visible = false;
    this.beacon.visible = false;
    for (const c of this.stacked) c.visible = false;
    this.glass.emissiveIntensity = 1.15;
    this.building = false;
    this.built = true;
  }

  /** Where the camera goes during the sequence (in the world). */
  cameraShot(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const t = this.buildT;
    const w = (x: number, y: number, z: number) => this.localToWorld(x, y, z);
    if (t < 4.2) {
      // From the road, watching the crates go and the pad rise, pushing in slowly.
      const k = t / 4.2;
      return { pos: w(14 - k * 8, 7 - k * 2, DROP_DISTANCE + 22 - k * 8), look: w(0, 4, -2) };
    }
    if (t < 10) {
      // A slow orbit round the domes going up.
      const k = (t - 4.2) / 5.8;
      const a = 0.35 + k * 1.5;
      const r = 46 - k * 6;
      return { pos: w(Math.sin(a) * r, 10 + k * 9, Math.cos(a) * r - 4), look: w(0, 5 + k * 3, -4) };
    }
    // A low shot up at the flag and the fireworks.
    const k = Math.min(1, (t - 10) / 5.5);
    return { pos: w(-8 + k * 10, 2.4 + k * 3, 36 - k * 6), look: w(4, 12 + k * 6, -2) };
  }

  /** Domes and big structures in the camp's frame, as [x, z, radius], for the buggy to bump into once it's built. */
  solidsWorld(): { x: number; z: number; r: number; h: number }[] {
    const out: { x: number; z: number; r: number; h: number }[] = [];
    for (const [x, z, r, h] of [[0, -3, 11, 12], [-19, -9, 6.6, 8], [19, -11, 7, 8], [24, -14, 1.5, 12], [12, 10, 0.6, 14]]) {
      const at = this.localToWorld(x, 0, z);
      out.push({ x: at.x, z: at.z, r, h });
    }
    return out;
  }

  /** Where a delivered crate flying from the buggy should land on the pallet. */
  static flightVelocity(from: THREE.Vector3, to: THREE.Vector3, seconds: number): THREE.Vector3 {
    return to.clone().sub(from).divideScalar(seconds).setY((to.y - from.y) / seconds + 0.5 * MOON_G * seconds);
  }
}
