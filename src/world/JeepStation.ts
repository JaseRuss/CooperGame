import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { heightAt } from './Terrain';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';
import { PartBuilder, tubeX } from '../utils/modelKit';

/** Drive-through bay: posts either side and a frame at each end, open along local Z. */
const HALF_W = 5.9;
const HALF_L = 8.5;
const HEIGHT = 6;
/** A tank or jeep whose middle is this far inside the bay gets changed. */
const TRIGGER = { x: 4.4, z: 6.5 };
/** Height of the pad's top above the ground (a low kerb the tracks ride straight over). */
const PAD_TOP = 0.12;
const STRIPE_YELLOW = 0xffcc33;
const STRIPE_BLACK = 0x222222;
/** Seconds the cog whirls and the lamps flash after a change. */
const BUSY_TIME = 2.5;

let signTexture: THREE.CanvasTexture | null = null;
let padTexture: THREE.CanvasTexture | null = null;

function makeSignTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#f4f1e4';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#4b7a2e';
  ctx.fillRect(8, 8, 496, 112);
  ctx.fillStyle = '#ffcc33';
  ctx.font = '900 64px "Black Ops One", Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('JEEP STATION', 256, 68, 470);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Hazard stripes at both ends, arrows pointing in from either side and "JEEP" in the middle. */
function makePadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 400;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#7c8378';
  ctx.fillRect(0, 0, 256, 400);
  for (const y of [0, 364]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, 256, 36);
    ctx.clip();
    for (let x = -40; x < 300; x += 32) {
      ctx.fillStyle = '#ffcc33';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 16, y);
      ctx.lineTo(x + 52, y + 36);
      ctx.lineTo(x + 36, y + 36);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.fillStyle = '#f4f1e4';
  for (const [y, dir] of [[80, 1], [320, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(128, y + dir * 34);
    ctx.lineTo(96, y - dir * 4);
    ctx.lineTo(116, y - dir * 4);
    ctx.lineTo(116, y - dir * 34);
    ctx.lineTo(140, y - dir * 34);
    ctx.lineTo(140, y - dir * 4);
    ctx.lineTo(160, y - dir * 4);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(128, 200);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '900 76px "Black Ops One", Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('JEEP', 0, 4);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A drive-through changing station, like a toy car wash: striped posts, a green canopy with a
 * sign at each end and a big cog on the roof. Drive the tank through it and it comes out the
 * other side as a jeep. Only the posts are solid, so it drives straight through either way.
 */
export class JeepStation {
  readonly center: THREE.Vector3;
  private readonly root = new THREE.Group();
  private readonly cog = new THREE.Group();
  private readonly glow: THREE.MeshStandardMaterial;
  private readonly lamp: THREE.MeshStandardMaterial;
  private readonly cosYaw: number;
  private readonly sinYaw: number;
  private time = 0;
  private busy = 0;

  /** @param yaw turns the bay's local Z (the way you drive through) in the world, like rotation.y. */
  constructor(world: RAPIER.World, scene: THREE.Scene, x: number, z: number, yaw: number) {
    const ground = heightAt(x, z);
    this.center = new THREE.Vector3(x, ground, z);
    this.cosYaw = Math.cos(yaw);
    this.sinYaw = Math.sin(yaw);
    this.root.position.copy(this.center);
    this.root.rotation.y = yaw;
    scene.add(this.root);

    this.glow = new THREE.MeshStandardMaterial({ color: 0x6fe0ff, emissive: 0x2fb8ff, emissiveIntensity: 0.6 });
    this.lamp = new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8800, emissiveIntensity: 0.2 });
    this.build();

    // Posts are the only solid parts.
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = this.toWorld(sx * HALF_W, sz * HALF_L);
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.35, HEIGHT / 2, 0.35).setTranslation(p.x, ground + HEIGHT / 2, p.z), body);
      }
    }
  }

  private toWorld(lx: number, lz: number): { x: number; z: number } {
    return { x: this.center.x + lx * this.cosYaw + lz * this.sinYaw, z: this.center.z - lx * this.sinYaw + lz * this.cosYaw };
  }

  /** True when `p` is inside the bay (between the posts). */
  contains(p: THREE.Vector3): boolean {
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    const lx = dx * this.cosYaw - dz * this.sinYaw;
    const lz = dx * this.sinYaw + dz * this.cosYaw;
    return Math.abs(lx) < TRIGGER.x && Math.abs(lz) < TRIGGER.z;
  }

  /** Whirl the cog and flash the lamps: something's just been changed. */
  celebrate(): void {
    this.busy = BUSY_TIME;
  }

  update(dt: number): void {
    this.time += dt;
    this.busy = Math.max(0, this.busy - dt);
    const busy = this.busy > 0;
    this.cog.rotation.x -= dt * (busy ? 7 : 0.8);
    this.glow.emissiveIntensity = busy ? 1.4 + Math.sin(this.time * 18) * 0.6 : 0.5 + 0.3 * Math.sin(this.time * 3);
    this.lamp.emissiveIntensity = busy ? (Math.sin(this.time * 14) > 0 ? 2.4 : 0.3) : 0.25;
  }

  private build(): void {
    const green = plastic(ARMY_GREEN);
    const dark = plastic(shade(ARMY_GREEN, 0.65));
    const yellow = plastic(STRIPE_YELLOW);
    const black = plastic(STRIPE_BLACK);
    const steel = plastic(0x8a9084);
    const p = new PartBuilder();

    // Pad: a concrete slab just proud of the ground, with its markings on top.
    p.add(new THREE.BoxGeometry(HALF_W * 2 + 1, 0.4, HALF_L * 2 + 1), plastic(0x7c8378), 0, PAD_TOP - 0.2, 0);
    // Glowing kerb lines along both sides of the lane.
    for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.25, 0.06, HALF_L * 2 - 1), this.glow, s * (TRIGGER.x + 0.2), PAD_TOP + 0.03, 0);

    // Striped posts at the corners and a frame across each end.
    const bands = 8;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let i = 0; i < bands; i++) {
          const h = HEIGHT / bands;
          p.add(new THREE.BoxGeometry(0.6, h, 0.6), i % 2 === 0 ? yellow : black, sx * HALF_W, PAD_TOP + h * (i + 0.5), sz * HALF_L);
        }
        p.add(new THREE.BoxGeometry(0.9, 0.3, 0.9), dark, sx * HALF_W, PAD_TOP + 0.15, sz * HALF_L); // foot
        p.add(new THREE.SphereGeometry(0.28, 12, 8), this.lamp, sx * (HALF_W + 0.1), HEIGHT + 1.05, sz * (HALF_L + 0.1)); // corner lamp
      }
    }
    for (const sz of [-1, 1]) {
      p.add(new THREE.BoxGeometry(HALF_W * 2 + 0.8, 0.7, 0.8), green, 0, HEIGHT + 0.35, sz * HALF_L);
      // Sign board above the frame, facing out (its textured faces are added separately).
      p.add(new THREE.BoxGeometry(8.4, 1.9, 0.25), dark, 0, HEIGHT + 1.65, sz * HALF_L);
      // Rows of spray nozzles under the frame, like a car wash.
      for (let i = -3; i <= 3; i++) p.add(new THREE.CylinderGeometry(0.1, 0.16, 0.4, 8), steel, i * 1.4, HEIGHT - 0.15, sz * HALF_L);
    }
    // Canopy: a shallow green roof over the lane, with ribs.
    p.add(new THREE.BoxGeometry(HALF_W * 2 + 0.6, 0.25, HALF_L * 2 - 0.6), green, 0, HEIGHT + 0.6, 0);
    for (let i = -3; i <= 3; i++) p.add(new THREE.BoxGeometry(HALF_W * 2 + 0.7, 0.12, 0.2), dark, 0, HEIGHT + 0.78, i * 2.3);
    // The cog's stand on the roof ridge.
    for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.3, 1.8, 0.4), dark, s * 1.0, HEIGHT + 1.6, 0);
    p.add(tubeX(0.16, 2.3, 10), steel, 0, HEIGHT + 2.4, 0);
    p.buildInto(this.root);

    // Painted pad markings.
    const markings = new THREE.Mesh(
      new THREE.PlaneGeometry(TRIGGER.x * 2 - 0.4, HALF_L * 2 - 0.4),
      new THREE.MeshStandardMaterial({ map: (padTexture ??= makePadTexture()), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    markings.rotation.x = -Math.PI / 2;
    markings.position.y = PAD_TOP + 0.01;
    markings.receiveShadow = true;
    this.root.add(markings);

    // "JEEP STATION" on both faces of both signs.
    const signMat = new THREE.MeshStandardMaterial({ map: (signTexture ??= makeSignTexture()), roughness: 0.6 });
    for (const sz of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 1.75), signMat);
      face.position.set(0, HEIGHT + 1.65, sz * (HALF_L + 0.14));
      face.rotation.y = sz > 0 ? 0 : Math.PI;
      this.root.add(face);
      const inner = face.clone();
      inner.position.z = sz * (HALF_L - 0.14);
      inner.rotation.y = sz > 0 ? Math.PI : 0;
      this.root.add(inner);
    }

    // The big yellow cog, turning on its axle.
    const cog = new PartBuilder();
    cog.add(tubeX(1.15, 0.45, 20), yellow, 0, 0, 0);
    cog.add(tubeX(0.4, 0.55, 12), dark, 0, 0, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      cog.add(new THREE.BoxGeometry(0.45, 0.42, 0.42), yellow, 0, Math.cos(a) * 1.3, Math.sin(a) * 1.3, a);
    }
    cog.buildInto(this.cog);
    this.cog.position.set(0, HEIGHT + 2.4, 0);
    this.root.add(this.cog);
  }
}
