import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BASE_RADIUS, distanceToFriendlyBase, type FriendlyBase } from '../core/config';
import { heightAt } from './Terrain';
import { buildKeepsake } from './Keepsakes';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';
import { createFigureMesh } from '../entities/Soldier';
import { PartBuilder, loftGeometry, sandbagGeometry, tubeX, tubeZ, type LoftSection } from '../utils/modelKit';
import { buildJeep, buildTruck } from './Vehicles';

const WALL_RADIUS = BASE_RADIUS + 5;
const GATE_HALF_WIDTH = 9;
const SANDBAG = 0x8a8f55;
const CONCRETE = 0x7c8378;
const WOOD = 0x9a7a4a;
const UP = new THREE.Vector3(0, 1, 0);
/** Height of the concrete pad's top above the (flat) base ground. */
const PAD_TOP = 0.04;

function starShape(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

function textTexture(text: string, bg: string, fg: string, w = 512, h = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Shrink the font until long names ("AUNTIE CLAIRE'S BASE") fit the board.
  let size = Math.floor(h * 0.62);
  do {
    ctx.font = `900 ${size}px "Segoe UI", Impact, sans-serif`;
    size -= 2;
  } while (ctx.measureText(text).width > w * 0.92 && size > 10);
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function flagTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#4b7a2e';
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = '#f4f1e4';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 52 : 21;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(128 + Math.cos(a) * r, 84 + Math.sin(a) * r);
  }
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The player's home base, styled as a green plastic army-men playset: sandbag perimeter with a
 * gate onto the highway, watchtowers, tents, helipad, supply dump, repair gantry and guards.
 */
export class HomeBase {
  readonly root = new THREE.Group();
  private readonly groundY: number;
  private readonly rotor = new THREE.Group();
  private readonly rearRotor = new THREE.Group();
  private readonly flagGeometry: THREE.PlaneGeometry;
  private readonly flagRest: Float32Array;
  private readonly searchlights: { pivot: THREE.Object3D; base: number; phase: number }[] = [];
  private readonly beacons: THREE.Mesh[] = [];
  private readonly beaconMaterial: THREE.MeshStandardMaterial;
  private readonly healRingMaterial: THREE.MeshStandardMaterial;
  private time = 0;
  /** The repair bay's side walls, which fade when they'd hide the tank from the camera. */
  private readonly bayWalls: { side: number; x: number; materials: THREE.Material[]; opacity: number }[] = [];
  private bayFrame: THREE.Object3D | null = null;
  private bayHalf = { x: 0, z: 0 };

  /**
   * @param center where the camp stands; `name` goes on the gate sign.
   * @param gateAngle direction (radians in the XZ plane, x = cos, z = sin) the highway leaves the base.
   */
  constructor(
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    private readonly center: FriendlyBase,
    private readonly gateAngle: number,
  ) {
    this.groundY = heightAt(center.x, center.z);
    this.root.position.set(center.x, this.groundY, center.z);
    scene.add(this.root);

    this.beaconMaterial = new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8800, emissiveIntensity: 0.2 });
    this.healRingMaterial = new THREE.MeshStandardMaterial({
      color: 0xffcc33,
      emissive: 0xaa7700,
      emissiveIntensity: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });

    this.buildPad();
    this.buildWall();
    this.buildGateTowers();
    this.buildTents();
    this.buildHelipad();
    this.buildSupplyDump();
    this.buildRepairGantry();
    const flag = this.buildFlag();
    this.flagGeometry = flag;
    this.flagRest = Float32Array.from(flag.attributes.position.array as ArrayLike<number>);
    this.buildGuards();
    this.buildMotorPool();
    this.placeKeepsake();
  }

  /** The family member's keepsake stands on a plinth beside the road, just outside the gate. */
  private placeKeepsake(): void {
    const angle = this.gateAngle + 0.36;
    const p = this.polar(angle, WALL_RADIUS + 16);
    const yaw = this.facingCenter(p.x, p.y) + Math.PI; // face travellers arriving on the road
    const spot = this.place(p.x, p.y, yaw);
    spot.add(buildKeepsake(this.center.keepsake, this.center.name.replace(/'s Base$/, '')));
    this.solid(p.x, this.gy(p.x, p.y) + 3, p.y, 3.6, 3, 3.6, yaw);
  }

  // ---------- detailed pieces ----------

  private buildWatchtower(green: THREE.Material, dark: THREE.Material): PartBuilder {
    const b = new PartBuilder();
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const corners: [number, number][] = [[-1.4, -1.4], [1.4, -1.4], [1.4, 1.4], [-1.4, 1.4]];
    for (const [x, z] of corners) {
      b.add(new THREE.BoxGeometry(0.28, 7, 0.28), green, x, 3.5, z);
      b.add(new THREE.BoxGeometry(0.6, 0.2, 0.6), dark, x, 0.1, z); // footings
    }
    // X-braced on every face in two storeys, with a ring beam between.
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      for (const [y0, y1] of [[0.3, 3.4], [3.6, 6.8]]) {
        b.beam(v(ax, y0, az), v(bx, y1, bz), 0.12, dark);
        b.beam(v(bx, y0, bz), v(ax, y1, az), 0.12, dark);
      }
      b.beam(v(ax, 3.5, az), v(bx, 3.5, bz), 0.16, green);
    }
    // Platform with plank lines, sandbag parapet, corner posts and a pyramid roof with a fascia.
    b.add(new THREE.BoxGeometry(3.8, 0.3, 3.8), green, 0, 7, 0);
    for (let i = 0; i < 6; i++) b.add(new THREE.BoxGeometry(3.7, 0.02, 0.04), dark, 0, 7.16, -1.5 + i * 0.6);
    const bag = sandbagGeometry(0.6, 0.24);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 4; i++) {
        const t = -1.35 + i * 0.9 + (row % 2) * 0.3;
        const y = 7.35 + row * 0.32;
        b.add(bag, plastic(SANDBAG), t, y, 1.7);
        b.add(bag, plastic(SANDBAG), t, y, -1.7);
        b.add(bag, plastic(SANDBAG), 1.7, y, t, 0, Math.PI / 2);
        b.add(bag, plastic(SANDBAG), -1.7, y, t, 0, Math.PI / 2);
      }
    }
    for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) b.add(new THREE.BoxGeometry(0.14, 1.9, 0.14), dark, x, 8.1, z);
    b.add(new THREE.ConeGeometry(3.3, 1.4, 4), green, 0, 9.7, 0, 0, Math.PI / 4);
    b.add(new THREE.BoxGeometry(3.9, 0.2, 3.9), dark, 0, 9.05, 0);
    b.add(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), dark, 0, 10.9, 0); // lightning rod
    // Ladder up the inside face.
    for (const x of [-0.35, 0.35]) b.beam(v(x, 0, -2.1), v(x, 7.1, -1.5), 0.08, dark);
    for (let i = 1; i < 16; i++) {
      const t = i / 16;
      b.add(new THREE.BoxGeometry(0.7, 0.05, 0.05), dark, 0, t * 7.1, -2.1 + t * 0.6);
    }
    // Machine gun on a tripod, poking over the outward parapet.
    b.add(new THREE.BoxGeometry(0.14, 0.18, 0.7), dark, 0.6, 8.25, 1.55);
    b.add(tubeZ(0.035, 0.035, 0.7, 6), dark, 0.6, 8.27, 2.2);
    for (const a of [0, 2.1, 4.2]) b.beam(v(0.6, 8.2, 1.4), v(0.6 + Math.sin(a) * 0.35, 7.15, 1.4 + Math.cos(a) * 0.35), 0.04, dark);
    return b;
  }

  /** Three drooping blades on a hub, for either of the Chinook's rotors. */
  private static chinookRotor(): PartBuilder {
    const r = new PartBuilder();
    const dark = plastic(shade(ARMY_GREEN, 0.45));
    const hub = plastic(0x5b5f58);
    r.add(new THREE.CylinderGeometry(0.42, 0.36, 0.34, 14), hub);
    r.add(new THREE.ConeGeometry(0.3, 0.3, 12), hub, 0, 0.32, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      const dir = (d: number) => [Math.cos(a) * d, -Math.sin(a) * d] as const;
      const [gx, gz] = dir(0.55);
      r.add(new THREE.BoxGeometry(0.5, 0.18, 0.26), hub, gx, 0, gz, 0, a); // blade grip
      const [bx, bz] = dir(3.0);
      r.add(new THREE.BoxGeometry(4.8, 0.07, 0.5), dark, bx, -0.06, bz, 0, a, -0.02); // slight droop
      const [tx, tz] = dir(5.3);
      r.add(new THREE.BoxGeometry(0.4, 0.08, 0.52), plastic(0xffcc33), tx, -0.11, tz, 0, a);
    }
    return r;
  }

  /** A toy CH-47 Chinook, nose toward -Z: tandem rotor pylons, fuel pods, loading ramp. */
  private buildChinook(): PartBuilder {
    const b = new PartBuilder();
    const green = plastic(ARMY_GREEN);
    const dark = plastic(shade(ARMY_GREEN, 0.65));
    const deep = plastic(shade(ARMY_GREEN, 0.45));
    const steel = plastic(0x5b5f58);
    const tyre = plastic(0x2e2f2c);
    const white = plastic(0xf4f1e4);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fd0e0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.8 });

    // Long boxy fuselage: blunt nose, straight cabin, and a belly that sweeps up to the ramp.
    const body: LoftSection[] = [
      { z: -7.3, w: 1.3, h: 1.1, y: 2.0 },
      { z: -7.0, w: 2.3, h: 2.0, y: 2.25 },
      { z: -6.5, w: 2.85, h: 2.6, y: 2.4 },
      { z: -5.8, w: 3.0, h: 2.9, y: 2.45 },
      { z: 4.6, w: 3.0, h: 2.9, y: 2.45 },
      { z: 5.5, w: 3.0, h: 2.6, y: 2.6 },
      { z: 6.4, w: 2.8, h: 1.9, y: 2.95 },
    ];
    b.add(loftGeometry(body, 32, 5), green);
    // Cockpit glazing over the upper nose, with frame bars.
    const glazing = body.slice(0, 4).map((s) => ({ ...s, w: s.w + 0.05, h: s.h + 0.05 }));
    b.add(loftGeometry(glazing, 24, 5, [-0.15 * Math.PI, 1.15 * Math.PI]), glass);
    for (const x of [-0.75, 0, 0.75]) b.add(new THREE.BoxGeometry(0.07, 0.07, 1.4), deep, x, 3.55, -6.4, 0.55);
    for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.07, 1.4, 0.07), deep, s * 1.42, 2.9, -6.0);
    b.add(new THREE.BoxGeometry(2.9, 0.08, 0.08), deep, 0, 2.45, -6.9);

    // Forward rotor pylon over the cockpit and the tall aft pylon with the rear rotor.
    b.add(
      loftGeometry([
        { z: -6.6, w: 1.1, h: 0.4, y: 3.9 },
        { z: -6.0, w: 1.6, h: 1.1, y: 4.2 },
        { z: -4.6, w: 1.6, h: 1.1, y: 4.2 },
        { z: -3.6, w: 1.0, h: 0.4, y: 3.95 },
      ], 20, 4),
      green,
    );
    b.add(
      loftGeometry([
        { z: 1.8, w: 1.4, h: 0.3, y: 3.9 },
        { z: 3.4, w: 2.2, h: 1.6, y: 4.5 },
        { z: 5.0, w: 2.0, h: 3.0, y: 5.05 },
        { z: 6.3, w: 1.6, h: 3.0, y: 5.1 },
        { z: 6.9, w: 0.9, h: 2.2, y: 5.1 },
      ], 20, 4),
      green,
    );
    b.add(new THREE.CylinderGeometry(0.2, 0.26, 0.7, 12), steel, 0, 4.95, -5.3); // masts
    b.add(new THREE.CylinderGeometry(0.2, 0.26, 0.6, 12), steel, 0, 6.75, 5.1);
    // Walkway along the roof between the pylons.
    b.add(new THREE.BoxGeometry(0.9, 0.12, 5.4), dark, 0, 3.95, -0.8);
    for (let i = 0; i < 9; i++) b.add(new THREE.BoxGeometry(0.95, 0.04, 0.06), deep, 0, 4.03, -3.2 + i * 0.6);

    for (const s of [-1, 1]) {
      // Twin turboshaft engines hung on the aft pylon.
      b.add(tubeZ(0.48, 0.48, 2.6, 16), green, s * 1.45, 4.55, 4.7);
      b.add(tubeZ(0.3, 0.48, 0.5, 16), steel, s * 1.45, 4.55, 3.15); // intake
      b.add(tubeZ(0.1, 0.1, 0.1, 10), deep, s * 1.45, 4.55, 2.9);
      b.add(tubeZ(0.4, 0.34, 0.5, 14), deep, s * 1.45, 4.55, 6.2); // exhaust
      b.add(new THREE.BoxGeometry(0.4, 0.3, 1.8), dark, s * 1.05, 4.35, 4.7); // mount

      // Fuel pods along the lower sides.
      b.add(
        loftGeometry([
          { z: -4.3, w: 0.3, h: 0.4, y: 1.45 },
          { z: -3.8, w: 0.75, h: 0.95, y: 1.45 },
          { z: 3.0, w: 0.75, h: 0.95, y: 1.45 },
          { z: 3.6, w: 0.3, h: 0.4, y: 1.45 },
        ], 16, 3),
        green,
        s * 1.75,
        0,
        0,
      );

      // Round cabin windows, the crew door and a white star.
      for (let i = 0; i < 7; i++) {
        b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14).rotateZ(Math.PI / 2), glass, s * 1.51, 2.75, -3.8 + i * 1.1);
        b.add(new THREE.TorusGeometry(0.22, 0.035, 4, 14), deep, s * 1.52, 2.75, -3.8 + i * 1.1, 0, Math.PI / 2);
      }
      b.add(new THREE.BoxGeometry(0.05, 1.7, 0.95), deep, s * 1.51, 2.1, -4.95);
      b.add(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 12).rotateZ(Math.PI / 2), glass, s * 1.53, 2.45, -4.95);
      b.add(new THREE.ShapeGeometry(starShape(0.42, 0.17)), white, s * 1.53, 3.3, 3.5, 0, s * Math.PI / 2);

      // Landing gear: twin wheels forward, single wheels aft, on sturdy legs.
      b.add(new THREE.BoxGeometry(0.2, 0.9, 0.2), steel, s * 1.55, 0.85, -3.6);
      for (const dz of [-0.28, 0.28]) b.add(tubeX(0.42, 0.28, 16), tyre, s * 1.55, 0.42, -3.6 + dz);
      b.add(tubeX(0.2, 0.32, 10), steel, s * 1.55, 0.42, -3.6);
      b.add(new THREE.BoxGeometry(0.2, 0.9, 0.2), steel, s * 1.4, 0.95, 4.3);
      b.add(tubeX(0.46, 0.32, 16), tyre, s * 1.4, 0.46, 4.3);
      b.add(tubeX(0.22, 0.36, 10), steel, s * 1.4, 0.46, 4.3);
      // Pitot probes on the nose.
      b.add(tubeZ(0.03, 0.03, 0.6, 6), steel, s * 0.6, 2.1, -7.5);
    }
    // Loading ramp outline under the tail, and the nose searchlight.
    b.add(new THREE.BoxGeometry(2.6, 0.08, 1.8), deep, 0, 1.55, 5.7, -0.55);
    b.add(new THREE.CylinderGeometry(0.2, 0.15, 0.2, 12), steel, 0, 1.05, -5.5);
    // Aerials on the roof.
    b.add(new THREE.BoxGeometry(0.05, 0.6, 0.3), steel, 0, 4.2, 1.2, -0.3);
    b.add(new THREE.BoxGeometry(0.05, 0.5, 0.25), steel, 0.5, 4.15, -2.5, -0.3);
    return b;
  }

  /** A jeep by the gate and a lorry by the supply dump. */
  private buildMotorPool(): void {
    const spots: [THREE.Group, number, number, number, number, number][] = [
      [buildJeep(ARMY_GREEN), this.gateAngle + 0.5, 38, 0.3, 1.2, 1.8],
      [buildTruck(ARMY_GREEN), this.gateAngle - Math.PI / 2 + 0.32, 36, Math.PI / 2, 1.2, 3.3],
    ];
    for (const [model, angle, r, turn, hx, hz] of spots) {
      const p = this.polar(angle, r);
      const yaw = this.facingCenter(p.x, p.y) + turn;
      this.place(p.x, p.y, yaw).add(model);
      this.solid(p.x, this.gy(p.x, p.y) + 1.2, p.y, hx, 1.2, hz, yaw);
    }
  }

  // ---------- helpers ----------

  private polar(angle: number, r: number): THREE.Vector2 {
    return new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
  }

  /** Local ground height (the base area is nearly, but not perfectly, flat). */
  private gy(lx: number, lz: number): number {
    return heightAt(this.center.x + lx, this.center.z + lz) - this.groundY;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** A group standing on the ground at (lx, lz), with +Z facing the given yaw. */
  private place(lx: number, lz: number, yaw: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(lx, this.gy(lx, lz), lz);
    g.rotation.y = yaw;
    this.root.add(g);
    return g;
  }

  private solid(lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, yaw: number): void {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(this.center.x + lx, this.groundY + ly, this.center.z + lz)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
  }

  /** Yaw that makes a group's +Z axis point from (lx, lz) toward the base centre. */
  private facingCenter(lx: number, lz: number): number {
    return Math.atan2(-lx, -lz);
  }

  // ---------- pieces ----------

  private buildPad(): void {
    // The ground here is dead level; the pad is sunk so its top sits just proud of it and tanks
    // drive across it rather than through it.
    const padR = BASE_RADIUS * 0.9;
    this.mesh(new THREE.CylinderGeometry(padR, padR + 1, 0.3, 48), plastic(CONCRETE), this.root, 0, PAD_TOP - 0.15, 0);

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f1e4, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const star = new THREE.Mesh(new THREE.ShapeGeometry(starShape(11, 4.4)), white);
    star.rotation.x = -Math.PI / 2;
    star.rotation.z = -this.gateAngle - Math.PI / 2; // point the star at the gate
    star.position.y = PAD_TOP + 0.02;
    this.root.add(star);
    const circle = new THREE.Mesh(new THREE.RingGeometry(12.5, 13.6, 64), white);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = PAD_TOP + 0.02;
    this.root.add(circle);

    // A flat glowing stripe marks the repair zone (a raised ring would poke through the tracks).
    const healRing = new THREE.Mesh(new THREE.RingGeometry(padR - 1.2, padR - 0.2, 96), this.healRingMaterial);
    healRing.rotation.x = -Math.PI / 2;
    healRing.position.y = PAD_TOP + 0.03;
    this.root.add(healRing);
  }

  private buildWall(): void {
    const gapHalf = Math.asin(GATE_HALF_WIDTH / WALL_RADIUS);
    const bagGeo = new THREE.CapsuleGeometry(0.3, 0.75, 4, 8).rotateZ(Math.PI / 2).scale(1, 0.72, 1);
    const step = 1.25 / WALL_RADIUS;
    const rows = [0.25, 0.64, 1.03];
    const count = Math.ceil((Math.PI * 2) / step) * rows.length;
    const bags = new THREE.InstancedMesh(bagGeo, plastic(SANDBAG), count);
    bags.castShadow = true;
    bags.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    rows.forEach((h, row) => {
      for (let a = (row % 2) * step * 0.5; a < Math.PI * 2; a += step) {
        const rel = Math.atan2(Math.sin(a - this.gateAngle), Math.cos(a - this.gateAngle));
        if (Math.abs(rel) < gapHalf) continue;
        const p = this.polar(a, WALL_RADIUS);
        q.setFromAxisAngle(UP, -a - Math.PI / 2);
        m.compose(new THREE.Vector3(p.x, this.gy(p.x, p.y) + h, p.y), q, s);
        bags.setMatrixAt(n++, m);
      }
    });
    bags.count = n;
    this.root.add(bags);

    // Colliders in ~10° chunks, skipping the gate.
    const chunk = (10 * Math.PI) / 180;
    for (let a = 0; a < Math.PI * 2; a += chunk) {
      const mid = a + chunk / 2;
      const rel = Math.atan2(Math.sin(mid - this.gateAngle), Math.cos(mid - this.gateAngle));
      if (Math.abs(rel) < gapHalf + chunk / 2) continue;
      const p = this.polar(mid, WALL_RADIUS);
      this.solid(p.x, this.gy(p.x, p.y) + 0.7, p.y, (chunk * WALL_RADIUS) / 2, 0.7, 0.5, -mid - Math.PI / 2);
    }
  }

  private buildGateTowers(): void {
    const gapHalf = Math.asin(GATE_HALF_WIDTH / WALL_RADIUS);
    const green = plastic(ARMY_GREEN);
    const dark = plastic(shade(ARMY_GREEN, 0.7));
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfff6c8,
      transparent: true,
      opacity: 0.05, // subtle in daylight; it's a toy searchlight, not a floodlight
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (const side of [-1, 1]) {
      const a = this.gateAngle + side * (gapHalf + 0.07);
      const p = this.polar(a, WALL_RADIUS + 1);
      const tower = this.place(p.x, p.y, this.facingCenter(p.x, p.y) + Math.PI); // +Z faces outward

      this.buildWatchtower(green, dark).buildInto(tower);

      // Sweeping searchlight on the outward rim.
      const pivot = new THREE.Group();
      pivot.position.set(0, 8.3, 1.6);
      tower.add(pivot);
      this.mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.6, 12).rotateX(Math.PI / 2), dark, pivot, 0, 0, 0.1);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
      lens.position.z = 0.41;
      pivot.add(lens);
      const beamLen = 34;
      const beam = new THREE.Mesh(new THREE.ConeGeometry(5, beamLen, 24, 1, true).rotateX(-Math.PI / 2), beamMat);
      beam.position.z = beamLen / 2 + 0.4;
      pivot.add(beam);
      pivot.rotation.x = 0.22; // aim down at the approach road
      this.searchlights.push({ pivot, base: 0, phase: side > 0 ? 0 : Math.PI });

      const world = new THREE.Vector3(p.x, 0, p.y);
      this.solid(world.x, this.gy(world.x, world.z) + 4, world.z, 1.9, 4, 1.9, a);
    }

    // Gate sign across the entrance.
    const gp = this.polar(this.gateAngle, WALL_RADIUS + 1);
    const gate = this.place(gp.x, gp.y, this.facingCenter(gp.x, gp.y) + Math.PI);
    const width = GATE_HALF_WIDTH * 2 + 4;
    this.mesh(new THREE.BoxGeometry(width, 0.5, 0.4), plastic(ARMY_GREEN), gate, 0, 8.6, 0);
    // Two single-sided boards back to back, so the text reads correctly from both sides.
    const signMat = new THREE.MeshStandardMaterial({ map: textTexture(this.center.name.toUpperCase(), '#2f4f1c', '#f4f1e4') });
    this.mesh(new THREE.BoxGeometry(9.3, 1.8, 0.2), plastic(shade(ARMY_GREEN, 0.7)), gate, 0, 9.9, 0);
    for (const side of [1, -1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.6), signMat);
      sign.position.set(0, 9.9, 0.11 * side);
      sign.rotation.y = side > 0 ? 0 : Math.PI;
      gate.add(sign);
    }
  }

  private buildTents(): void {
    const back = this.gateAngle + Math.PI;
    const tri = new THREE.Shape();
    tri.moveTo(-3.2, 0);
    tri.lineTo(3.2, 0);
    tri.lineTo(0, 3.4);
    tri.closePath();
    const tentGeo = new THREE.ExtrudeGeometry(tri, { depth: 8, bevelEnabled: false });
    tentGeo.translate(0, 0, -4);
    const flapGeo = new THREE.ShapeGeometry(
      new THREE.Shape([new THREE.Vector2(-1, 0), new THREE.Vector2(1, 0), new THREE.Vector2(0, 2.1)]),
    );
    const canvas = plastic(shade(ARMY_GREEN, 0.9));
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2a14, side: THREE.DoubleSide });

    const rope = plastic(0xd9cfa8);
    const wood = plastic(WOOD);
    const cot = plastic(shade(ARMY_GREEN, 0.6));
    for (const off of [-0.42, 0, 0.42]) {
      const p = this.polar(back + off, 45);
      const yaw = this.facingCenter(p.x, p.y);
      const tent = this.place(p.x, p.y, yaw);
      const flap = new THREE.Mesh(flapGeo, dark);
      flap.position.set(0, 0.01, 4.02);
      tent.add(flap);

      const b = new PartBuilder();
      b.add(tentGeo, canvas);
      // Ridge pole with an upright at each end, and the door flaps rolled up above the entrance.
      b.add(tubeZ(0.07, 0.07, 8.6, 6), wood, 0, 3.42, 0);
      for (const z of [-4.3, 4.3]) b.add(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 6), wood, 0, 1.75, z);
      for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.13, 0.13, 1.9, 8), canvas, s * 0.95, 1.45, 4.05, 0, 0, s * 0.95);
      // Guy ropes from the ridge ends and the sides out to pegs.
      for (const z of [-4.3, 4.3]) {
        const peg = new THREE.Vector3(0, 0.05, z * 1.45);
        b.beam(new THREE.Vector3(0, 3.4, z), peg, 0.035, rope, true);
        b.add(new THREE.BoxGeometry(0.08, 0.3, 0.08), wood, peg.x, 0.1, peg.z);
      }
      for (const s of [-1, 1]) {
        for (const z of [-2.8, 0, 2.8]) {
          const peg = new THREE.Vector3(s * 4.6, 0.05, z);
          b.beam(new THREE.Vector3(s * 1.7, 1.6, z), peg, 0.03, rope, true);
          b.add(new THREE.BoxGeometry(0.08, 0.3, 0.08), wood, peg.x, 0.1, peg.z);
        }
      }
      // A camp cot and a footlocker just inside the door.
      b.add(new THREE.BoxGeometry(0.8, 0.12, 2), cot, -1.4, 0.45, 2.2);
      for (const [x, z] of [[-1.75, 1.3], [-1.05, 1.3], [-1.75, 3.1], [-1.05, 3.1]]) b.add(new THREE.BoxGeometry(0.05, 0.4, 0.05), wood, x, 0.2, z);
      b.add(new THREE.BoxGeometry(0.9, 0.45, 0.5), wood, 1.3, 0.23, 3.2);
      b.buildInto(tent);
      this.solid(p.x, this.gy(p.x, p.y) + 1.6, p.y, 3.2, 1.6, 4, yaw);
    }
  }

  private buildHelipad(): void {
    const p = this.polar(this.gateAngle + Math.PI / 2, 38);
    const yaw = this.facingCenter(p.x, p.y);
    const pad = this.place(p.x, p.y, yaw);
    const top = PAD_TOP + 0.03; // a hair above the main pad so the two don't flicker
    this.mesh(new THREE.CylinderGeometry(11, 11.3, 0.25, 48), plastic(0x55604f), pad, 0, top - 0.125, 0);

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f1e4, polygonOffset: true, polygonOffsetFactor: -2 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(9.6, 10.3, 64), white);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = top + 0.02;
    pad.add(ring);
    for (const [x, w, d] of [[-1.6, 0.7, 5], [1.6, 0.7, 5], [0, 3.2, 0.7]]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, d), white);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(x, top + 0.025, 0);
      pad.add(bar);
    }

    // Toy Chinook parked across the pad, its two rotors turning slowly in opposite directions.
    const heli = new THREE.Group();
    heli.position.y = top;
    heli.rotation.y = Math.PI / 2;
    pad.add(heli);
    this.buildChinook().buildInto(heli);
    const rotorShape = HomeBase.chinookRotor();
    this.rotor.position.set(0, 5.35, -5.3);
    this.rearRotor.position.set(0, 7.05, 5.1);
    rotorShape.buildInto(this.rotor);
    HomeBase.chinookRotor().buildInto(this.rearRotor);
    heli.add(this.rotor, this.rearRotor);
    this.solid(p.x, this.gy(p.x, p.y) + 2, p.y, 1.7, 2, 6.8, yaw + Math.PI / 2);
  }

  private buildSupplyDump(): void {
    const p = this.polar(this.gateAngle - Math.PI / 2, 40);
    const yaw = this.facingCenter(p.x, p.y);
    const dump = this.place(p.x, p.y, yaw);
    const crate = plastic(WOOD);
    const drum = plastic(shade(ARMY_GREEN, 0.8));
    const crateGeo = new THREE.BoxGeometry(1.6, 1.3, 1.6);
    const drumGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.3, 14);

    const crates: [number, number, number, number][] = [
      [-3, 0.65, 0, 0.1], [-1.3, 0.65, 0.2, -0.05], [-2.2, 1.95, 0.1, 0.3], [-3, 0.65, 1.7, 0.2], [0.4, 0.65, -0.3, 0],
    ];
    const b = new PartBuilder();
    const slat = plastic(shade(WOOD, 0.7));
    const rim = plastic(shade(ARMY_GREEN, 0.55));
    for (const [x, y, z, r] of crates) {
      b.add(crateGeo, crate, x, y, z, 0, r);
      // Planked sides with corner battens and a stencilled lid band.
      for (const dy of [-0.4, 0, 0.4]) b.add(new THREE.BoxGeometry(1.64, 0.06, 1.64), slat, x, y + dy, z, 0, r);
      b.add(new THREE.BoxGeometry(1.66, 0.14, 0.3), slat, x, y + 0.66, z, 0, r);
    }
    // Drums stood on pallets, with rims and filler caps.
    for (const [px, pz] of [[3.15, -0.6], [3.15, 0.35]]) {
      b.add(new THREE.BoxGeometry(3, 0.14, 1), crate, px, 0.07, pz);
      for (const dx of [-1.2, 0, 1.2]) b.add(new THREE.BoxGeometry(0.12, 0.1, 1), slat, px + dx, 0.19, pz);
    }
    for (let i = 0; i < 6; i++) {
      const x = 2.2 + (i % 3) * 0.95;
      const z = -0.6 + Math.floor(i / 3) * 0.95;
      b.add(drumGeo, drum, x, 0.85, z);
      for (const dy of [-0.35, 0.35]) b.add(new THREE.TorusGeometry(0.46, 0.03, 4, 16), rim, x, 0.85 + dy, z, Math.PI / 2);
      b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8), rim, x + 0.2, 1.52, z);
    }
    // Hand fuel pump on the end drum, and a pile of sandbags.
    b.add(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), rim, 4.1, 1.95, -0.6);
    b.add(new THREE.BoxGeometry(0.2, 0.3, 0.2), rim, 4.1, 2.35, -0.6);
    b.add(new THREE.BoxGeometry(0.5, 0.05, 0.05), rim, 4.3, 2.5, -0.6, 0, 0, -0.4);
    const bag = sandbagGeometry(0.7, 0.28);
    for (let i = 0; i < 4; i++) b.add(bag, plastic(SANDBAG), -4.2 + (i % 2) * 0.8, 0.22 + Math.floor(i / 2) * 0.38, 3 - (i % 2) * 0.2, 0, 0.3);
    // Camouflage net on poles, sagging between them.
    const netGeo = new THREE.PlaneGeometry(10, 7, 14, 10).rotateX(-Math.PI / 2);
    const np = netGeo.attributes.position;
    for (let i = 0; i < np.count; i++) {
      const x = np.getX(i);
      const z = np.getZ(i);
      const sag = Math.sin(((x + 5) / 10) * Math.PI) * Math.sin(((z + 3.5) / 7) * Math.PI);
      np.setY(i, -sag * 0.7 + 0.08 * Math.sin(x * 3 + z * 2));
    }
    netGeo.computeVertexNormals();
    b.add(netGeo, new THREE.MeshStandardMaterial({ color: 0x5a6b34, side: THREE.DoubleSide, roughness: 1 }), -0.3, 3.4, 0.4);
    for (const [x, z] of [[-5, -3.2], [4.4, -3.2], [-5, 3.8], [4.4, 3.8]]) {
      b.add(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), plastic(WOOD), x, 1.7, z);
      b.beam(new THREE.Vector3(x, 3.3, z), new THREE.Vector3(x * 1.35, 0.05, z * 1.35), 0.03, plastic(0xd9cfa8), true);
    }
    b.buildInto(dump);
    this.solid(p.x, this.gy(p.x, p.y) + 1, p.y, 4.6, 1, 2.8, yaw);
  }

  /**
   * The repair bay: a drive-through Quonset workshop in the middle of the pad, open at both ends
   * along the line from the gate, with a crane, workbenches, tools and hazard-striped entrances.
   */
  private buildRepairGantry(): void {
    // Local X spans across the gate line, so tanks drive through along local Z.
    const yaw = Math.atan2(-Math.cos(this.gateAngle), -Math.sin(this.gateAngle));
    const bay = this.place(0, 0, yaw);
    const green = plastic(ARMY_GREEN);
    const dark = plastic(shade(ARMY_GREEN, 0.65));
    const steel = plastic(0x6b7166);
    const roofMat = new THREE.MeshPhysicalMaterial({ color: 0x8e9a78, roughness: 0.5, clearcoat: 0.4, side: THREE.DoubleSide });
    const yellow = plastic(0xffcc33);
    const black = plastic(0x222222);
    const red = plastic(0xc0392b);
    const wood = plastic(WOOD);
    const HALF_W = 6.5; // posts either side of the bay
    const HALF_L = 8; // first and last frame along the bay
    const EAVE = 5.2;
    const RISE = 2.8; // arch height above the eaves
    const b = new PartBuilder();
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const archPoint = (t: number, z: number, inset = 0) =>
      v(-Math.cos(t * Math.PI) * (HALF_W - inset), EAVE + Math.sin(t * Math.PI) * (RISE - inset), z);

    // Portal frames: posts, an arched rafter in segments, and a tie beam.
    for (let i = 0; i <= 4; i++) {
      const z = -HALF_L + i * 4;
      // (The posts themselves are built with the side walls below, so they fade with them.)
      for (const s of [-1, 1]) this.solid(...this.bayToBase(yaw, s * HALF_W, EAVE / 2, z), 0.3, EAVE / 2, 0.3, yaw);
      for (let k = 0; k < 10; k++) b.beam(archPoint(k / 10, z), archPoint((k + 1) / 10, z), 0.35, green);
      b.add(new THREE.BoxGeometry(HALF_W * 2, 0.25, 0.25), dark, 0, EAVE, z);
    }
    // Roof purlins running the length of the bay.
    for (const t of [0.12, 0.3, 0.5, 0.7, 0.88]) {
      const a = archPoint(t, 0, -0.2);
      b.add(new THREE.BoxGeometry(0.16, 0.16, HALF_L * 2 + 0.6), dark, a.x, a.y, 0);
    }
    b.buildInto(bay);

    // Corrugated arched roof sheet (half-cylinder along Z, flattened), with ridges.
    const roof = new PartBuilder();
    const shell = new THREE.CylinderGeometry(HALF_W + 0.2, HALF_W + 0.2, HALF_L * 2 + 1.2, 40, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
    roof.add(shell, roofMat, 0, EAVE, 0, 0, 0, 0, 1, (RISE + 0.3) / (HALF_W + 0.2), 1);
    for (let k = 1; k < 20; k++) {
      const t = k / 20;
      const a = archPoint(t, 0, -0.32);
      roof.add(new THREE.BoxGeometry(0.1, 0.1, HALF_L * 2 + 1.2), roofMat, a.x, a.y, 0, 0, 0, Math.atan2(a.y - EAVE, a.x) - Math.PI / 2);
    }
    roof.buildInto(bay, true, true);

    // Work lamps hanging from the roof between the frames, kept high so the chase cam sees over them.
    const lamps = new PartBuilder();
    for (const z of [-6, -2, 2, 6]) {
      lamps.add(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), black, 0, EAVE + RISE - 0.6, z);
      lamps.add(new THREE.ConeGeometry(0.5, 0.4, 12, 1, true), dark, 0, EAVE + RISE - 1.1, z);
      lamps.add(new THREE.SphereGeometry(0.16, 8, 6), plastic(0xfff3c0), 0, EAVE + RISE - 1.25, z);
    }
    lamps.buildInto(bay);

    // Corrugated side walls between the end frames, with a band of windows under the eaves.
    // Each side has its own materials so it can fade out when it's between the camera and the tank.
    for (const s of [-1, 1]) {
      const side = new THREE.Group();
      const sheet = new THREE.MeshPhysicalMaterial({ color: 0x8e9a78, roughness: 0.5, clearcoat: 0.4, transparent: true });
      const glass = new THREE.MeshStandardMaterial({ color: 0x9fc6d8, emissive: 0x1d3440, roughness: 0.15, transparent: true });
      const kerb = new THREE.MeshStandardMaterial({ color: 0xa99f86, roughness: 0.9, transparent: true });
      const fade = (m: THREE.Material) => {
        const c = m.clone();
        c.transparent = true;
        return c;
      };
      const [postMat, footMat, stripeA, stripeB] = [green, dark, yellow, black].map(fade);
      const x = s * (HALF_W + 0.32);
      const len = HALF_L * 2;
      const w = new PartBuilder();
      // The portal-frame posts on this side, with hazard stripes round the entrance posts.
      for (let i = 0; i <= 4; i++) {
        const z = -HALF_L + i * 4;
        w.add(new THREE.BoxGeometry(0.5, EAVE, 0.5), postMat, s * HALF_W, EAVE / 2, z);
        w.add(new THREE.BoxGeometry(1.0, 0.25, 1.0), footMat, s * HALF_W, 0.12, z);
        if (i === 0 || i === 4) {
          for (let k = 0; k < 7; k++) w.add(new THREE.BoxGeometry(0.56, 0.36, 0.56), k % 2 ? stripeB : stripeA, s * HALF_W, 0.3 + k * 0.38, z);
        }
      }
      w.add(new THREE.BoxGeometry(0.4, 0.6, len + 0.4), kerb, x, 0.3, 0);
      w.add(new THREE.BoxGeometry(0.12, 3.2, len), sheet, x, 2.2, 0); // sheet below the windows
      w.add(new THREE.BoxGeometry(0.12, 0.5, len), sheet, x, EAVE - 0.25, 0); // strip above them
      // Window band: panes between mullions, set into each bay between frames.
      for (let i = 0; i < 4; i++) {
        const z = -HALF_L + 2 + i * 4;
        w.add(new THREE.BoxGeometry(0.06, 1.1, 3.1), glass, x, 4.35, z);
        w.add(new THREE.BoxGeometry(0.14, 1.1, 0.12), sheet, x, 4.35, z);
      }
      w.add(new THREE.BoxGeometry(0.16, 0.1, len), sheet, x, 3.85, 0); // sill
      // Vertical corrugation ribs on both faces.
      for (let z = -HALF_L + 0.25; z < HALF_L; z += 0.5) {
        for (const f of [-1, 1]) w.add(new THREE.BoxGeometry(0.05, 3.2, 0.12), sheet, x + f * 0.08, 2.2, z);
      }
      w.buildInto(side);
      bay.add(side);
      this.bayWalls.push({ side: s, x, materials: [sheet, glass, kerb, postMat, footMat, stripeA, stripeB], opacity: 1 });
      this.solid(...this.bayToBase(yaw, x, EAVE / 2, 0), 0.25, EAVE / 2, HALF_L, yaw);
    }
    this.bayFrame = bay;
    this.bayHalf = { x: HALF_W, z: HALF_L };

    // Workbenches down each side with toolboxes, a vice and pegboards of tools.
    const kit = new PartBuilder();
    for (const s of [-1, 1]) {
      const x = s * (HALF_W - 0.9);
      for (const z of [-4.5, 4.5]) {
        kit.add(new THREE.BoxGeometry(1.1, 0.12, 3.2), wood, x, 1.0, z);
        for (const dz of [-1.4, 1.4]) for (const dx of [-0.45, 0.45]) kit.add(new THREE.BoxGeometry(0.08, 1.0, 0.08), steel, x + dx, 0.5, z + dz);
        kit.add(new THREE.BoxGeometry(1.0, 0.08, 3.0), wood, x, 0.3, z); // lower shelf
        kit.add(new THREE.BoxGeometry(0.6, 0.45, 0.9), red, x, 1.3, z - 0.8); // toolbox
        kit.add(new THREE.BoxGeometry(0.62, 0.06, 0.92), black, x, 1.4, z - 0.8);
        kit.add(new THREE.BoxGeometry(0.3, 0.25, 0.25), steel, x - s * 0.25, 1.2, z + 0.9); // vice
        kit.add(new THREE.BoxGeometry(0.1, 1.6, 3.0), wood, s * (HALF_W - 0.25), 2.3, z); // pegboard
        for (let t = 0; t < 5; t++) {
          const tz = z - 1.1 + t * 0.55;
          kit.add(new THREE.BoxGeometry(0.06, 0.5 + (t % 2) * 0.2, 0.08), t % 2 ? red : steel, s * (HALF_W - 0.33), 2.4, tz);
          kit.add(new THREE.BoxGeometry(0.06, 0.12, 0.26), steel, s * (HALF_W - 0.33), 2.7 + (t % 2) * 0.1, tz);
        }
        this.solid(...this.bayToBase(yaw, x, 0.6, z), 0.55, 0.6, 1.6, yaw);
      }
      // Air-hose reel on a middle post.
      kit.add(new THREE.TorusGeometry(0.45, 0.1, 6, 16), yellow, s * (HALF_W - 0.35), 2.2, 0, 0, Math.PI / 2);
      kit.add(tubeX(0.12, 0.25, 8), steel, s * (HALF_W - 0.35), 2.2, 0);
    }
    // Outside the entrance: a trolley jack, a welding cart and a stack of spare road wheels.
    const out = HALF_L + 2.5;
    kit.add(new THREE.BoxGeometry(0.6, 0.3, 1.4), red, -4.2, 0.25, out);
    kit.add(new THREE.BoxGeometry(0.06, 0.06, 1.4), steel, -4.2, 0.7, out + 1.1, 0.6);
    for (const dx of [-0.25, 0.25]) kit.add(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 10), steel, 4.6 + dx, 0.75, -out);
    kit.add(new THREE.BoxGeometry(0.9, 0.2, 0.6), dark, 4.6, 0.12, -out);
    for (let i = 0; i < 4; i++) kit.add(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 16), dark, -4.4, 0.15 + i * 0.32, -out, 0, i * 0.4);
    // Floor paint: bay edges, entrance chevrons.
    const paint = new THREE.MeshStandardMaterial({ color: 0xffcc33, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const s of [-1, 1]) kit.add(new THREE.PlaneGeometry(0.35, HALF_L * 2 + 6).rotateX(-Math.PI / 2), paint, s * (HALF_W - 1.8), 0.08, 0);
    for (const e of [-1, 1]) {
      for (let c = 0; c < 3; c++) {
        for (const s of [-1, 1]) {
          kit.add(new THREE.PlaneGeometry(0.4, 2.2).rotateX(-Math.PI / 2), paint, s * 1.2, 0.08, e * (HALF_L + 1 + c * 1.6), 0, s * e * 0.7);
        }
      }
    }
    kit.buildInto(bay);

    // The sign over the entrance facing the gate, with flashing beacons at either end.
    const signMat = new THREE.MeshStandardMaterial({ map: textTexture('REPAIR BAY', '#2f4f1c', '#ffcc33') });
    for (const e of [-1, 1]) {
      const z = e * (HALF_L + 0.35);
      this.mesh(new THREE.BoxGeometry(7.4, 1.6, 0.25), dark, bay, 0, EAVE + RISE + 0.5, z);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.35), signMat);
      sign.position.set(0, EAVE + RISE + 0.5, z + e * 0.14);
      sign.rotation.y = e > 0 ? 0 : Math.PI;
      bay.add(sign);
      for (const s of [-1, 1]) {
        const beacon = this.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.45, 12), this.beaconMaterial, bay, s * 4.1, EAVE + RISE + 0.6, z);
        this.beacons.push(beacon);
      }
    }
  }

  /** A side wall goes see-through while it stands between the chase camera and the tank. */
  private fadeBayWalls(dt: number, camera: THREE.Vector3, focus: THREE.Vector3): void {
    if (!this.bayFrame) return;
    const cam = this.bayFrame.worldToLocal(camera.clone());
    const tank = this.bayFrame.worldToLocal(focus.clone());
    const near = (p: THREE.Vector3) => Math.abs(p.z) < this.bayHalf.z + 6;
    for (const wall of this.bayWalls) {
      // The wall's line separates the camera from the tank, somewhere along the bay.
      const between = Math.sign(cam.x - wall.x) !== Math.sign(tank.x - wall.x) && (near(cam) || near(tank)) && cam.y < 12;
      const goal = between ? 0.15 : 1;
      wall.opacity += (goal - wall.opacity) * Math.min(1, dt * 10);
      for (const m of wall.materials) {
        m.opacity = wall.opacity;
        m.depthWrite = wall.opacity > 0.95;
      }
    }
  }

  /** Bay-local (x, y, z) → base-local, for colliders, given the bay's yaw. */
  private bayToBase(yaw: number, x: number, y: number, z: number): [number, number, number] {
    const p = new THREE.Vector3(x, 0, z).applyAxisAngle(UP, yaw);
    return [p.x, y, p.z];
  }

  private buildFlag(): THREE.PlaneGeometry {
    const p = this.polar(this.gateAngle - 0.55, 28);
    this.mesh(new THREE.CylinderGeometry(0.12, 0.16, 12, 10), plastic(0xd8d8d0), this.root, p.x, this.gy(p.x, p.y) + 6, p.y);
    this.mesh(new THREE.SphereGeometry(0.25, 10, 8), plastic(0xffcc33), this.root, p.x, this.gy(p.x, p.y) + 12.1, p.y);
    this.solid(p.x, this.gy(p.x, p.y) + 3, p.y, 0.2, 3, 0.2, 0);

    const geo = new THREE.PlaneGeometry(4, 2.5, 16, 4);
    geo.translate(2, 0, 0); // hoist edge at the pole
    const flag = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.8 }),
    );
    flag.position.set(p.x + 0.12, this.gy(p.x, p.y) + 10.6, p.y);
    flag.castShadow = true;
    this.root.add(flag);
    return geo;
  }

  private buildGuards(): void {
    const gapHalf = Math.asin(GATE_HALF_WIDTH / WALL_RADIUS);
    const spots: { angle: number; r: number; pose: 0 | 1; outward: boolean }[] = [
      { angle: this.gateAngle + gapHalf + 0.02, r: WALL_RADIUS - 3, pose: 0, outward: true },
      { angle: this.gateAngle - gapHalf - 0.02, r: WALL_RADIUS - 3, pose: 0, outward: true },
      { angle: this.gateAngle + gapHalf + 0.12, r: WALL_RADIUS - 2, pose: 1, outward: true },
      { angle: this.gateAngle - gapHalf - 0.12, r: WALL_RADIUS - 2, pose: 1, outward: true },
      { angle: this.gateAngle + Math.PI + 0.2, r: 38, pose: 0, outward: false },
      { angle: this.gateAngle + Math.PI / 2 - 0.3, r: 30, pose: 0, outward: false },
      { angle: this.gateAngle - Math.PI / 2 + 0.25, r: 33, pose: 1, outward: false },
    ];
    for (const s of spots) {
      const p = this.polar(s.angle, s.r);
      const guard = createFigureMesh(s.pose, ARMY_GREEN);
      // Figures face -Z; point them away from (or toward) the centre.
      guard.rotation.y = this.facingCenter(p.x, p.y) + (s.outward ? 0 : Math.PI);
      guard.position.set(p.x, this.gy(p.x, p.y) + 0.3, p.y);
      this.root.add(guard);
    }
  }

  update(dt: number, repairing: boolean, camera?: THREE.Vector3, focus?: THREE.Vector3): void {
    this.time += dt;
    if (camera && focus) this.fadeBayWalls(dt, camera, focus);
    // Tandem rotors turn in opposite directions.
    this.rotor.rotation.y += dt * 0.6;
    this.rearRotor.rotation.y -= dt * 0.6;

    for (const s of this.searchlights) {
      s.pivot.rotation.y = Math.sin(this.time * 0.45 + s.phase) * 0.7;
    }

    // Flag ripple: displace along Z, increasing away from the pole.
    const pos = this.flagGeometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = this.flagRest[i * 3];
      const y = this.flagRest[i * 3 + 1];
      const wave = Math.sin(x * 1.6 - this.time * 5 + y * 0.4) * 0.22 * (x / 4);
      pos.setZ(i, this.flagRest[i * 3 + 2] + wave);
    }
    pos.needsUpdate = true;

    const pulse = repairing ? 0.6 + 0.6 * Math.abs(Math.sin(this.time * 6)) : 0.2;
    this.beaconMaterial.emissiveIntensity = pulse;
    for (const b of this.beacons) b.rotation.y += dt * (repairing ? 8 : 0.5);
    this.healRingMaterial.emissiveIntensity = repairing ? 0.7 + 0.5 * Math.sin(this.time * 4) : 0.5;
  }
}

/** True inside the repair zone of any friendly base. */
export function isInsideBase(position: THREE.Vector3): boolean {
  return distanceToFriendlyBase(position.x, position.z) < BASE_RADIUS;
}
