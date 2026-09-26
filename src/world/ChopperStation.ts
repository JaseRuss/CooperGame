import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { heightAt } from './Terrain';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';

/** A round helipad with nothing overhead, so the chopper can lift straight off it. */
const PAD_RADIUS = 9;
/** A tank or jeep whose middle is this close to the centre gets changed. */
const TRIGGER_RADIUS = 6.5;
/** Height of the pad's top above the ground (a low kerb the tracks ride straight over). */
const PAD_TOP = 0.12;
/** The sign stands off one end of the pad, the windsock off one side. */
const SIGN_Z = -(PAD_RADIUS + 2.6);
const SIGN_HEIGHT = 4.2;
const SOCK_AT = { x: PAD_RADIUS + 2.4, z: 3.5 };
const SOCK_HEIGHT = 6;
/** Seconds the rotor on the sign whirls and the lights flash after a change. */
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
  ctx.font = '900 60px "Black Ops One", Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CHOPPER STATION', 256, 68, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A big H in a yellow ring, with hazard ticks round the edge. */
function makePadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#6f766c';
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = '#ffcc33';
  ctx.lineWidth = 30;
  ctx.beginPath();
  ctx.arc(256, 256, 180, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 14;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(256 + Math.cos(a) * 222, 256 + Math.sin(a) * 222);
    ctx.lineTo(256 + Math.cos(a) * 246, 256 + Math.sin(a) * 246);
    ctx.stroke();
  }
  ctx.fillStyle = '#f4f1e4';
  ctx.fillRect(166, 146, 44, 220);
  ctx.fillRect(302, 146, 44, 220);
  ctx.fillRect(166, 234, 180, 44);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A changing station for the chopper: a round helipad with lights round the rim, a windsock,
 * and a "CHOPPER STATION" sign with a toy rotor spinning on top. Drive the tank (or the jeep)
 * onto the pad and it takes off as a chopper. Only the sign posts and the windsock pole are
 * solid, so it drives on from any side.
 */
export class ChopperStation {
  readonly kind = 'chopper';
  readonly center: THREE.Vector3;
  private readonly root = new THREE.Group();
  private readonly rotor = new THREE.Group();
  private readonly sock = new THREE.Group();
  private readonly lamp: THREE.MeshStandardMaterial;
  private readonly cosYaw: number;
  private readonly sinYaw: number;
  private time = 0;
  private busy = 0;

  /** @param yaw turns the station's local Z (sign at -Z) in the world, like rotation.y. */
  constructor(world: RAPIER.World, scene: THREE.Scene, x: number, z: number, yaw: number) {
    const ground = heightAt(x, z);
    this.center = new THREE.Vector3(x, ground, z);
    this.cosYaw = Math.cos(yaw);
    this.sinYaw = Math.sin(yaw);
    this.root.position.copy(this.center);
    this.root.rotation.y = yaw;
    scene.add(this.root);

    this.lamp = new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffb020, emissiveIntensity: 0.4 });
    this.build();

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const sx of [-1, 1]) {
      const p = this.toWorld(sx * 3.6, SIGN_Z);
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, SIGN_HEIGHT / 2, 0.3).setTranslation(p.x, ground + SIGN_HEIGHT / 2, p.z), body);
    }
    const pole = this.toWorld(SOCK_AT.x, SOCK_AT.z);
    world.createCollider(RAPIER.ColliderDesc.cylinder(SOCK_HEIGHT / 2, 0.2).setTranslation(pole.x, ground + SOCK_HEIGHT / 2, pole.z), body);
  }

  private toWorld(lx: number, lz: number): { x: number; z: number } {
    return { x: this.center.x + lx * this.cosYaw + lz * this.sinYaw, z: this.center.z - lx * this.sinYaw + lz * this.cosYaw };
  }

  /** True when `p` is over the middle of the pad; `extra` widens it (for a chopper passing overhead). */
  contains(p: THREE.Vector3, extra = 0): boolean {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z) < TRIGGER_RADIUS + extra;
  }

  /** Whirl the rotor and flash the lights: something's just been changed. */
  celebrate(): void {
    this.busy = BUSY_TIME;
  }

  update(dt: number): void {
    this.time += dt;
    this.busy = Math.max(0, this.busy - dt);
    const busy = this.busy > 0;
    this.rotor.rotation.y += dt * (busy ? 16 : 1.2);
    this.lamp.emissiveIntensity = busy ? (Math.sin(this.time * 14) > 0 ? 2.4 : 0.3) : 0.35 + 0.25 * Math.sin(this.time * 3);
    // The windsock swings about in the breeze.
    this.sock.rotation.y = 0.5 + Math.sin(this.time * 0.7) * 0.35 + Math.sin(this.time * 2.3) * 0.08;
    this.sock.rotation.z = -0.12 + Math.sin(this.time * 1.9) * 0.06;
  }

  private build(): void {
    const green = plastic(ARMY_GREEN);
    const dark = plastic(shade(ARMY_GREEN, 0.65));
    const yellow = plastic(0xffcc33);
    const black = plastic(0x222222);
    const white = plastic(0xf4f1e4);
    const orange = plastic(0xff7a2a);
    const steel = plastic(0x8a9084);
    const p = new PartBuilder();

    // Pad: a round concrete slab just proud of the ground, with a lamp every so often round the rim.
    p.add(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.2, 0.4, 40), plastic(0x7c8378), 0, PAD_TOP - 0.2, 0);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = Math.cos(a) * (PAD_RADIUS - 0.25);
      const z = Math.sin(a) * (PAD_RADIUS - 0.25);
      p.add(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 10), black, x, PAD_TOP + 0.04, z);
      p.add(new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.lamp, x, PAD_TOP + 0.08, z);
    }

    // Sign: two striped posts, the board, and a toy rotor on a mast on top.
    const bands = 6;
    for (const sx of [-1, 1]) {
      for (let i = 0; i < bands; i++) {
        const h = SIGN_HEIGHT / bands;
        p.add(new THREE.BoxGeometry(0.5, h, 0.5), i % 2 === 0 ? yellow : black, sx * 3.6, h * (i + 0.5), SIGN_Z);
      }
      p.add(new THREE.BoxGeometry(0.8, 0.3, 0.8), dark, sx * 3.6, 0.15, SIGN_Z); // foot
      p.add(new THREE.SphereGeometry(0.26, 12, 8), this.lamp, sx * 3.6, SIGN_HEIGHT + 0.25, SIGN_Z); // lamp
    }
    p.add(new THREE.BoxGeometry(8.2, 1.9, 0.3), dark, 0, SIGN_HEIGHT - 0.6, SIGN_Z);
    p.add(new THREE.BoxGeometry(8.4, 0.25, 0.5), green, 0, SIGN_HEIGHT + 0.47, SIGN_Z);
    p.add(new THREE.CylinderGeometry(0.12, 0.16, 1.4, 10), steel, 0, SIGN_HEIGHT + 1.3, SIGN_Z);

    // Windsock pole with its hoop at the top.
    for (let i = 0; i < 6; i++) {
      const h = SOCK_HEIGHT / 6;
      p.add(new THREE.CylinderGeometry(0.12, 0.14, h, 10), i % 2 === 0 ? white : orange, SOCK_AT.x, h * (i + 0.5), SOCK_AT.z);
    }
    p.add(new THREE.CylinderGeometry(0.4, 0.5, 0.2, 12), dark, SOCK_AT.x, 0.1, SOCK_AT.z);
    p.buildInto(this.root);

    // Painted H and ring on the pad.
    const markings = new THREE.Mesh(
      new THREE.CircleGeometry(PAD_RADIUS - 0.6, 48),
      new THREE.MeshStandardMaterial({ map: (padTexture ??= makePadTexture()), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    );
    markings.rotation.x = -Math.PI / 2;
    markings.position.y = PAD_TOP + 0.01;
    markings.receiveShadow = true;
    this.root.add(markings);

    // "CHOPPER STATION" on both faces of the board.
    const signMat = new THREE.MeshStandardMaterial({ map: (signTexture ??= makeSignTexture()), roughness: 0.6 });
    for (const sz of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 1.75), signMat);
      face.position.set(0, SIGN_HEIGHT - 0.6, SIGN_Z + sz * 0.16);
      face.rotation.y = sz > 0 ? 0 : Math.PI;
      this.root.add(face);
    }

    // The toy rotor on the sign: four yellow-tipped blades that whirl after a change.
    const r = new PartBuilder();
    r.add(new THREE.CylinderGeometry(0.3, 0.3, 0.25, 12), steel);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      r.add(new THREE.BoxGeometry(2.4, 0.08, 0.36), dark, Math.cos(a) * 1.4, 0.05, -Math.sin(a) * 1.4, 0, a);
      r.add(new THREE.BoxGeometry(0.3, 0.09, 0.37), yellow, Math.cos(a) * 2.5, 0.05, -Math.sin(a) * 2.5, 0, a);
    }
    r.buildInto(this.rotor);
    this.rotor.position.set(0, SIGN_HEIGHT + 2.05, SIGN_Z);
    this.root.add(this.rotor);

    // Orange-and-white striped windsock on a swivel at the top of the pole.
    const s = new PartBuilder();
    s.add(new THREE.TorusGeometry(0.42, 0.04, 6, 16), steel, 0, 0, 0.1, 0, 0, 0);
    s.add(tubeX(0.04, 0.5, 6), steel, 0, 0, 0.1);
    for (let i = 0; i < 5; i++) {
      const r0 = 0.42 - i * 0.055;
      s.add(tubeZ(r0 - 0.055, r0, 0.5, 14), i % 2 === 0 ? orange : white, 0, -i * 0.04, 0.35 + i * 0.5);
    }
    s.buildInto(this.sock);
    this.sock.position.set(SOCK_AT.x, SOCK_HEIGHT - 0.2, SOCK_AT.z);
    this.root.add(this.sock);
  }
}
