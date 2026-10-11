import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { heightAt } from './Terrain';
import { buildPrisonTower, buildPrisonPen, PRISON_PEN, PRISON_TOWER_HALF } from './Medieval';
import { createFigureMesh, createSurrenderedKnightMesh } from '../entities/Soldier';
import { ARMY_GREEN, ARMY_TAN } from '../utils/plastic';

/** Which side a prison is on: ours (holds captured knights) or theirs (holds our soldiers). */
export type PrisonSide = 'friendly' | 'enemy';

/** The most prisoners shown standing in the yard; the count above the door can go higher. */
const SHOWN = 16;
/** The yard's gap between the gate posts, matching `buildPrisonPen`. */
const GATE_GAP = 2.8;
/** How far past the yard gate the wagon pulls up (local Z). */
const DOOR_STOP = PRISON_PEN.z1 + 7;
const SIGN_Z = PRISON_PEN.z1;
const SIGN_Y = 7.4;

export interface PrisonOptions {
  x: number;
  z: number;
  /** Turns the prison's local Z (its front) in the world, like rotation.y. */
  yaw: number;
  side: PrisonSide;
  /** The garrison's colour (pennant and turret caps). */
  color: number;
  name: string;
  /** Prisoners inside at the start. */
  held: number;
}

function drawSign(canvas: HTMLCanvasElement, side: PrisonSide, name: string, held: number): void {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#f4f1e4';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = side === 'friendly' ? '#4b7a2e' : '#7a2e2e';
  ctx.fillRect(8, 8, 496, 112);
  ctx.fillStyle = '#ffcc33';
  ctx.font = '900 46px "Black Ops One", Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.toUpperCase(), 256, 44, 480);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 38px "Black Ops One", Impact, "Arial Black", sans-serif';
  ctx.fillText(held === 1 ? '1 PRISONER' : `${held} PRISONERS`, 256, 92, 480);
}

/**
 * A prison: a stone tower with a walled yard in front of it, a sign with the number of prisoners
 * inside, and the prisoners standing in the yard. Friendly prisons hold the knights our wagons
 * bring in; enemy prisons hold our soldiers (to be freed on foot). The tower and yard walls
 * are solid; nothing here can be shot down.
 */
export class Prison {
  readonly side: PrisonSide;
  readonly name: string;
  readonly yaw: number;
  /** The garrison's colour (the army that holds it). */
  readonly color: number;
  readonly center: THREE.Vector3;
  /** The spot outside the yard gate where a wagon pulls up. */
  readonly door = new THREE.Vector3();
  private count: number;
  private readonly root = new THREE.Group();
  private readonly cosYaw: number;
  private readonly sinYaw: number;
  private readonly signCanvas = document.createElement('canvas');
  private readonly signTexture: THREE.CanvasTexture;
  private readonly crowd: THREE.InstancedMesh;
  private readonly spots: THREE.Matrix4[] = [];

  constructor(world: RAPIER.World, scene: THREE.Scene, opts: PrisonOptions) {
    this.side = opts.side;
    this.name = opts.name;
    this.yaw = opts.yaw;
    this.color = opts.color;
    this.count = opts.held;
    this.cosYaw = Math.cos(opts.yaw);
    this.sinYaw = Math.sin(opts.yaw);
    this.center = new THREE.Vector3(opts.x, heightAt(opts.x, opts.z), opts.z);
    const stop = this.toWorld(0, DOOR_STOP);
    this.door.set(stop.x, heightAt(stop.x, stop.z), stop.z);
    this.root.position.copy(this.center);
    this.root.rotation.y = opts.yaw;
    scene.add(this.root);

    this.root.add(buildPrisonTower(opts.color), buildPrisonPen());

    // The sign over the yard gate, readable from both sides.
    this.signCanvas.width = 512;
    this.signCanvas.height = 128;
    drawSign(this.signCanvas, opts.side, opts.name, this.count);
    this.signTexture = new THREE.CanvasTexture(this.signCanvas);
    this.signTexture.colorSpace = THREE.SRGBColorSpace;
    const signMat = new THREE.MeshStandardMaterial({ map: this.signTexture, roughness: 0.6 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(GATE_GAP * 2 + 2.4, 1.9, 0.25), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }));
    board.position.set(0, SIGN_Y, SIGN_Z);
    this.root.add(board);
    for (const f of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(GATE_GAP * 2 + 2.2, 1.7), signMat);
      face.position.set(0, SIGN_Y, SIGN_Z + f * 0.14);
      face.rotation.y = f > 0 ? 0 : Math.PI;
      this.root.add(face);
    }
    // A beam from post to post carries the board.
    const beam = new THREE.Mesh(new THREE.BoxGeometry(GATE_GAP * 2 + 1.6, 0.5, 0.6), new THREE.MeshStandardMaterial({ color: 0x5a3b24 }));
    beam.position.set(0, 5.5, SIGN_Z);
    this.root.add(beam);

    // The prisoners: green army men in an enemy prison, hands-up knights in ours.
    const proto = opts.side === 'enemy' ? createFigureMesh(0, ARMY_GREEN) : createSurrenderedKnightMesh(ARMY_TAN);
    this.crowd = new THREE.InstancedMesh(proto.geometry, proto.material, SHOWN);
    this.crowd.castShadow = true;
    this.crowd.frustumCulled = false;
    const cols = 4;
    const rows = Math.ceil(SHOWN / cols);
    const rotation = new THREE.Quaternion();
    for (let i = 0; i < SHOWN; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = (c - (cols - 1) / 2) * 4.2 + Math.sin(i * 12.9) * 0.5;
      const z = PRISON_PEN.z0 + 3.2 + (r / Math.max(1, rows - 1)) * (PRISON_PEN.z1 - PRISON_PEN.z0 - 6.4);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(i * 7.3) * Math.PI);
      this.spots.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.05, z), rotation, new THREE.Vector3(1, 1, 1)));
    }
    this.root.add(this.crowd);
    this.refresh();

    // Solid parts: the tower, the side walls and the two halves of the front wall.
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const rot = { x: 0, y: Math.sin(opts.yaw / 2), z: 0, w: Math.cos(opts.yaw / 2) };
    const solid = (hx: number, hy: number, hz: number, lx: number, ly: number, lz: number) => {
      const p = this.toWorld(lx, lz);
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(p.x, this.center.y + ly, p.z).setRotation(rot), body);
    };
    const t = PRISON_TOWER_HALF + 0.3;
    solid(t, 6, t, 0, 6, 0);
    const { halfWidth, z0, z1 } = PRISON_PEN;
    for (const s of [-1, 1]) {
      solid(0.5, 1.5, (z1 - z0) / 2, s * halfWidth, 1.5, (z0 + z1) / 2);
      const frontLen = halfWidth - GATE_GAP;
      solid(frontLen / 2, 1.5, 0.5, s * (GATE_GAP + frontLen / 2), 1.5, z1);
      solid(0.8, 2.3, 0.8, s * GATE_GAP, 2.3, z1);
    }
  }

  private toWorld(lx: number, lz: number): { x: number; z: number } {
    return { x: this.center.x + lx * this.cosYaw + lz * this.sinYaw, z: this.center.z - lx * this.sinYaw + lz * this.cosYaw };
  }

  get held(): number {
    return this.count;
  }

  /** Locks up `n` more prisoners. */
  admit(n: number): void {
    this.count += n;
    this.refresh();
  }

  /** Sets the number locked up (when picking a game up again). */
  setHeld(n: number): void {
    this.count = n;
    this.refresh();
  }

  /** Lets everyone out; returns how many there were. */
  empty(): number {
    const n = this.count;
    this.count = 0;
    this.refresh();
    return n;
  }

  /** True when `p` is within `reach` metres of the yard gate. */
  nearGate(p: THREE.Vector3, reach: number): boolean {
    const g = this.toWorld(0, PRISON_PEN.z1);
    return Math.hypot(p.x - g.x, p.z - g.z) < reach;
  }

  private refresh(): void {
    drawSign(this.signCanvas, this.side, this.name, this.count);
    this.signTexture.needsUpdate = true;
    const shown = Math.min(SHOWN, this.count);
    this.crowd.count = shown;
    for (let i = 0; i < shown; i++) this.crowd.setMatrixAt(i, this.spots[i]);
    this.crowd.instanceMatrix.needsUpdate = true;
  }
}

