import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BASE_RADIUS, distanceToFriendlyBase, type FriendlyBase } from '../core/config';
import { heightAt } from './Terrain';
import { buildKeepsake } from './Keepsakes';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';
import { createFigureMesh } from '../entities/Soldier';

const WALL_RADIUS = BASE_RADIUS + 5;
const GATE_HALF_WIDTH = 9;
const SANDBAG = 0x8a8f55;
const CONCRETE = 0x7c8378;
const WOOD = 0x9a7a4a;
const UP = new THREE.Vector3(0, 1, 0);

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
  private readonly tailRotor = new THREE.Group();
  private readonly flagGeometry: THREE.PlaneGeometry;
  private readonly flagRest: Float32Array;
  private readonly searchlights: { pivot: THREE.Object3D; base: number; phase: number }[] = [];
  private readonly beacons: THREE.Mesh[] = [];
  private readonly beaconMaterial: THREE.MeshStandardMaterial;
  private readonly healRingMaterial: THREE.MeshStandardMaterial;
  private time = 0;

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
    this.healRingMaterial = new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0xaa7700, emissiveIntensity: 0.5 });

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
    const padR = BASE_RADIUS * 0.9;
    this.mesh(new THREE.CylinderGeometry(padR, padR + 1, 0.3, 48), plastic(CONCRETE), this.root, 0, 0.15, 0);

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f1e4, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const star = new THREE.Mesh(new THREE.ShapeGeometry(starShape(11, 4.4)), white);
    star.rotation.x = -Math.PI / 2;
    star.rotation.z = -this.gateAngle - Math.PI / 2; // point the star at the gate
    star.position.y = 0.32;
    this.root.add(star);
    const circle = new THREE.Mesh(new THREE.RingGeometry(12.5, 13.6, 64), white);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.32;
    this.root.add(circle);

    const healRing = new THREE.Mesh(new THREE.TorusGeometry(padR, 0.35, 8, 64), this.healRingMaterial);
    healRing.rotation.x = Math.PI / 2;
    healRing.position.y = 0.34;
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

      for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
        this.mesh(new THREE.BoxGeometry(0.28, 7, 0.28), green, tower, lx, 3.5, lz);
      }
      for (const h of [2.2, 4.4]) {
        const brace = this.mesh(new THREE.BoxGeometry(2.9, 0.12, 0.12), dark, tower, 0, h, 1.4);
        brace.rotation.z = 0.6;
        const brace2 = this.mesh(new THREE.BoxGeometry(2.9, 0.12, 0.12), dark, tower, 0, h, -1.4);
        brace2.rotation.z = -0.6;
      }
      this.mesh(new THREE.BoxGeometry(3.8, 0.3, 3.8), green, tower, 0, 7, 0);
      for (const [lx, lz, w, d] of [[0, 1.8, 3.8, 0.25], [0, -1.8, 3.8, 0.25], [1.8, 0, 0.25, 3.8], [-1.8, 0, 0.25, 3.8]]) {
        this.mesh(new THREE.BoxGeometry(w, 0.9, d), plastic(SANDBAG), tower, lx, 7.6, lz);
      }
      for (const [lx, lz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) {
        this.mesh(new THREE.BoxGeometry(0.14, 1.9, 0.14), dark, tower, lx, 8.1, lz);
      }
      const roof = this.mesh(new THREE.ConeGeometry(3.3, 1.4, 4), green, tower, 0, 9.7, 0);
      roof.rotation.y = Math.PI / 4;

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

    for (const off of [-0.42, 0, 0.42]) {
      const p = this.polar(back + off, 45);
      const yaw = this.facingCenter(p.x, p.y);
      const tent = this.place(p.x, p.y, yaw);
      this.mesh(tentGeo, canvas, tent, 0, 0, 0);
      const flap = new THREE.Mesh(flapGeo, dark);
      flap.position.set(0, 0.01, 4.02);
      tent.add(flap);
      this.mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), plastic(WOOD), tent, 0, 2, 4.3);
      this.solid(p.x, this.gy(p.x, p.y) + 1.6, p.y, 3.2, 1.6, 4, yaw);
    }
  }

  private buildHelipad(): void {
    const p = this.polar(this.gateAngle + Math.PI / 2, 38);
    const yaw = this.facingCenter(p.x, p.y);
    const pad = this.place(p.x, p.y, yaw);
    this.mesh(new THREE.CylinderGeometry(9, 9.3, 0.25, 40), plastic(0x55604f), pad, 0, 0.12, 0);

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f1e4, polygonOffset: true, polygonOffsetFactor: -2 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(7.4, 8.1, 48), white);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.26;
    pad.add(ring);
    for (const [x, w, d] of [[-1.6, 0.7, 5], [1.6, 0.7, 5], [0, 3.2, 0.7]]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, d), white);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(x, 0.27, 0);
      pad.add(bar);
    }

    // Toy helicopter parked on the pad.
    const green = plastic(ARMY_GREEN);
    const dark = plastic(shade(ARMY_GREEN, 0.65));
    const heli = new THREE.Group();
    heli.position.y = 0.25;
    heli.rotation.y = Math.PI / 2;
    pad.add(heli);
    const body = this.mesh(new THREE.SphereGeometry(1.5, 16, 12), green, heli, 0, 1.9, 0);
    body.scale.set(1, 0.95, 1.7);
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0x9fd0e0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.75 }),
    );
    canopy.position.set(0, 2.2, -1.2);
    canopy.rotation.x = -0.5;
    heli.add(canopy);
    this.mesh(new THREE.CylinderGeometry(0.28, 0.45, 5.5, 10).rotateX(Math.PI / 2), green, heli, 0, 2.2, 4.2);
    this.mesh(new THREE.BoxGeometry(0.15, 1.4, 0.9), green, heli, 0, 2.8, 6.8);
    for (const side of [-1, 1]) {
      this.mesh(new THREE.BoxGeometry(0.14, 0.14, 4.4), dark, heli, side * 1.2, 0.1, 0);
      this.mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), dark, heli, side * 1.1, 0.5, -1);
      this.mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), dark, heli, side * 1.1, 0.5, 1);
    }
    this.mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.7, 8), dark, heli, 0, 3.4, 0);
    this.rotor.position.set(0, 3.8, 0);
    heli.add(this.rotor);
    for (let i = 0; i < 2; i++) {
      const blade = this.mesh(new THREE.BoxGeometry(11, 0.08, 0.45), dark, this.rotor, 0, 0, 0);
      blade.rotation.y = (i * Math.PI) / 2;
    }
    this.tailRotor.position.set(0.25, 2.9, 6.9);
    heli.add(this.tailRotor);
    for (let i = 0; i < 2; i++) {
      const blade = this.mesh(new THREE.BoxGeometry(0.06, 2, 0.22), dark, this.tailRotor, 0, 0, 0);
      blade.rotation.x = (i * Math.PI) / 2;
    }
    this.solid(p.x, this.gy(p.x, p.y) + 1.8, p.y, 2, 1.8, 2, yaw);
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
    for (const [x, y, z, r] of crates) this.mesh(crateGeo, crate, dump, x, y, z).rotation.y = r;
    for (let i = 0; i < 6; i++) {
      this.mesh(drumGeo, drum, dump, 2.2 + (i % 3) * 0.95, 0.65, -0.6 + Math.floor(i / 3) * 0.95);
    }
    const camo = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 7, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0x5a6b34, side: THREE.DoubleSide, roughness: 1 }),
    );
    camo.rotation.x = -Math.PI / 2;
    camo.position.set(-0.3, 3.4, 0.4);
    dump.add(camo);
    for (const [x, z] of [[-5, -3.2], [4.4, -3.2], [-5, 3.8], [4.4, 3.8]]) {
      this.mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), plastic(WOOD), dump, x, 1.7, z);
    }
    this.solid(p.x, this.gy(p.x, p.y) + 1, p.y, 4.6, 1, 2.8, yaw);
  }

  private buildRepairGantry(): void {
    // An arch over the middle of the pad, spanning across the line from the gate.
    const yaw = Math.atan2(-Math.cos(this.gateAngle), -Math.sin(this.gateAngle)); // local X spans across the gate line
    const gantry = this.place(0, 0, yaw);
    const green = plastic(ARMY_GREEN);
    const dark = plastic(shade(ARMY_GREEN, 0.7));
    const span = 11;

    for (const side of [-1, 1]) {
      this.mesh(new THREE.BoxGeometry(0.7, 7.5, 0.7), green, gantry, side * span, 3.75, 0);
      this.mesh(new THREE.BoxGeometry(1.4, 0.3, 1.4), dark, gantry, side * span, 0.15, 0);
      const worldPos = new THREE.Vector3(side * span, 0, 0).applyAxisAngle(UP, yaw);
      this.solid(worldPos.x, 3.75, worldPos.z, 0.5, 3.75, 0.5, yaw);
    }
    this.mesh(new THREE.BoxGeometry(span * 2 + 1.4, 0.8, 0.9), green, gantry, 0, 7.6, 0);
    for (const x of [-4, 0, 4]) {
      this.mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), dark, gantry, x, 6.1, 0);
      this.mesh(new THREE.BoxGeometry(0.4, 0.25, 0.25), dark, gantry, x, 5, 0); // dangling tool hooks
    }
    const signMat = new THREE.MeshStandardMaterial({ map: textTexture('REPAIR', '#2f4f1c', '#ffcc33') });
    this.mesh(new THREE.BoxGeometry(6.3, 1.7, 0.2), dark, gantry, 0, 8.9, 0);
    for (const side of [1, -1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), signMat);
      sign.position.set(0, 8.9, 0.11 * side);
      sign.rotation.y = side > 0 ? 0 : Math.PI;
      gantry.add(sign);
    }

    for (const side of [-1, 1]) {
      const beacon = this.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.45, 12), this.beaconMaterial, gantry, side * (span - 1.2), 8.25, 0);
      this.beacons.push(beacon);
    }
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

  update(dt: number, repairing: boolean): void {
    this.time += dt;
    this.rotor.rotation.y += dt * 0.6;
    this.tailRotor.rotation.x += dt * 1.8;

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
