import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic } from '../utils/plastic';

const CORAL = 0xd97757;
const CREAM = 0xf3e6d3;
const BOT_HEIGHT = 1.5; // model units; scaled down onto each vehicle
const FLASH_RATE = 7; // Hz-ish blink of the beacon

// Shared by every bot: the beacon blinks in unison, so one material (and one write per frame) is enough.
const lampMat = new THREE.MeshStandardMaterial({ color: 0x6a1a10, emissive: 0xff3a1a, emissiveIntensity: 0 });
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false });
let shapes: { body: Map<THREE.Material, THREE.BufferGeometry>; arm: Map<THREE.Material, THREE.BufferGeometry>; spark: THREE.BufferGeometry } | null = null;

function buildShapes() {
  const body = plastic(CORAL);
  const cream = plastic(CREAM);
  const dark = plastic(0x3a2a22);
  const b = new PartBuilder();
  b.add(new THREE.BoxGeometry(0.26, 0.1, 0.36), dark, -0.16, 0.05, 0).add(new THREE.BoxGeometry(0.26, 0.1, 0.36), dark, 0.16, 0.05, 0); // treads
  b.add(new THREE.BoxGeometry(0.6, 0.5, 0.42), body, 0, 0.42, 0);
  b.add(new THREE.BoxGeometry(0.34, 0.22, 0.05), cream, 0, 0.44, -0.22); // chest plate
  b.add(new THREE.BoxGeometry(0.52, 0.4, 0.4), body, 0, 0.92, 0); // head
  b.add(new THREE.BoxGeometry(0.4, 0.16, 0.05), dark, 0, 0.94, -0.21); // visor
  for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.08, 0.08, 0.02), cream, s * 0.1, 0.94, -0.24); // eyes
  b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 5), dark, 0, 1.28, 0); // antenna
  b.add(new THREE.BoxGeometry(0.12, 0.3, 0.12), dark, -0.36, 0.45, 0); // idle arm
  const arm = new PartBuilder();
  arm.add(new THREE.BoxGeometry(0.12, 0.4, 0.12), dark, 0, -0.18, 0);
  arm.add(new THREE.BoxGeometry(0.06, 0.34, 0.05), cream, 0, -0.45, 0); // wrench shaft
  arm.add(new THREE.BoxGeometry(0.2, 0.1, 0.05), cream, 0, -0.66, 0); // wrench head
  return { body: b.buildGeometries(), arm: arm.buildGeometries(), spark: new THREE.OctahedronGeometry(0.09, 0) };
}

/** A tiny toy helper robot, Claude, who climbs aboard a wounded vehicle and fixes it with a wrench and a flashing beacon. */
export class RepairBot {
  readonly group = new THREE.Group();
  private readonly armPivot = new THREE.Group();
  private readonly lamp: THREE.Mesh;
  private readonly bob = new THREE.Group();
  private readonly spark: THREE.Mesh;
  private time = Math.random() * 10;

  constructor(scale = 0.4) {
    shapes ??= buildShapes();
    const dress = (map: Map<THREE.Material, THREE.BufferGeometry>, parent: THREE.Object3D) => {
      for (const [mat, geo] of map) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        parent.add(mesh);
      }
    };
    dress(shapes.body, this.bob);
    this.armPivot.position.set(0.36, 0.62, 0);
    dress(shapes.arm, this.armPivot);
    this.bob.add(this.armPivot);
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), lampMat);
    this.lamp.position.y = BOT_HEIGHT - 0.1;
    this.bob.add(this.lamp);
    this.spark = new THREE.Mesh(shapes.spark, sparkMat);
    this.bob.add(this.spark);
    this.group.add(this.bob);
    this.group.scale.setScalar(scale);
    this.group.visible = false;
  }

  /** Puts the bot on a vehicle at `x,y,z` (vehicle-local), facing `yaw`. */
  place(x: number, y: number, z: number, yaw = 0, scale?: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    if (scale) this.group.scale.setScalar(scale);
  }

  /** Off for models with nowhere for the bot to stand. */
  enabled = true;

  set active(on: boolean) {
    this.group.visible = on && this.enabled;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.time += dt;
    const t = this.time;
    // Hammering: the wrench swings down and taps, with a spark at the contact point.
    const tap = Math.max(0, Math.sin(t * 9));
    this.armPivot.rotation.x = -0.4 - tap * 0.9;
    this.bob.rotation.z = Math.sin(t * 4.5) * 0.05;
    this.bob.position.y = Math.abs(Math.sin(t * 9)) * 0.03;
    this.spark.position.set(0.36, 0.05, -0.32);
    this.spark.scale.setScalar(0.4 + tap * 0.9);
    this.spark.rotation.y = t * 8;
    sparkMat.opacity = tap > 0.85 ? 1 : 0;
    lampMat.emissiveIntensity = Math.sin(performance.now() / 1000 * FLASH_RATE * Math.PI) > 0 ? 2.4 : 0.1;
  }
}
