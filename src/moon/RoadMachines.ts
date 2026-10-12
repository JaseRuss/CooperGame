import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';
import { createPoseFigure } from '../entities/Soldier';

/** A road-building machine: its model (front toward +Z), and the parts that turn as it drives. */
export interface Machine {
  root: THREE.Group;
  /** Spun about X as it rolls (wheels, the steamroller's drum, the mixer's drum about Z). */
  spinners: THREE.Object3D[];
  /** Turned about its own axis whatever it's doing (the cement mixer's drum). */
  churn: THREE.Object3D | null;
}

const TYRE = 0x2a2c31;
const STEEL = 0x9aa0a8;
const HAZARD = 0xe8c23f;

function wheel(r: number, w: number): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  p.add(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2), plastic(TYRE), 0, 0, 0);
  p.add(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.04, 12).rotateZ(Math.PI / 2), plastic(HAZARD), 0, 0, 0);
  for (let i = 0; i < 3; i++) p.add(new THREE.BoxGeometry(w + 0.06, 0.08, r * 0.9), plastic(STEEL), 0, 0, 0, (i / 3) * Math.PI);
  p.buildInto(g);
  return g;
}

/** A cab with a roll cage and an army man in a space suit at the wheel, added to `root`. */
function cab(p: PartBuilder, root: THREE.Group, color: number, x: number, y: number, z: number): void {
  const body = plastic(color);
  p.add(new THREE.BoxGeometry(2, 0.3, 2), body, x, y, z);
  for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) p.add(new THREE.CylinderGeometry(0.07, 0.07, 2.1, 6), plastic(STEEL), x + dx, y + 1.1, z + dz);
  p.add(new THREE.BoxGeometry(2.1, 0.15, 2.1), body, x, y + 2.15, z);
  p.add(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a10, emissiveIntensity: 1.2 }), x, y + 2.35, z);
  const driver = createPoseFigure(color, 'stand', true);
  driver.scale.setScalar(0.62);
  driver.position.set(x, y + 0.15, z);
  driver.rotation.y = Math.PI;
  root.add(driver);
}

/** A bulldozer with a big blade, on tracks. */
export function bulldozer(color: number): Machine {
  const root = new THREE.Group();
  const p = new PartBuilder();
  const body = plastic(color);
  const dark = plastic(shade(color, 0.6));
  p.add(new THREE.BoxGeometry(2.8, 1.4, 4), body, 0, 1.5, 0);
  for (const s of [-1, 1]) {
    p.add(new THREE.BoxGeometry(0.9, 1.1, 4.8), plastic(TYRE), s * 1.6, 0.6, 0);
    for (let i = 0; i < 10; i++) p.add(new THREE.BoxGeometry(0.95, 0.1, 0.25), plastic(0x4a4e56), s * 1.6, 1.17, -2.2 + i * 0.49);
  }
  p.add(new THREE.BoxGeometry(4.2, 1.6, 0.35), plastic(HAZARD), 0, 0.85, 3.1, -0.15);
  for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.25, 0.25, 1.6), dark, s * 1.2, 1.2, 2.3);
  p.add(new THREE.CylinderGeometry(0.15, 0.18, 1.2, 8), plastic(0x3a3e46), 0.9, 2.6, 1.4);
  cab(p, root, color, 0, 2.2, -0.5);
  p.buildInto(root);
  return { root, spinners: [], churn: null };
}

/** A steamroller: a huge drum in front, big wheels behind, and a chimney. */
export function steamroller(color: number): Machine {
  const root = new THREE.Group();
  const p = new PartBuilder();
  const body = plastic(color);
  p.add(new THREE.BoxGeometry(2.4, 1.6, 3.6), body, 0, 1.6, -0.4);
  p.add(new THREE.BoxGeometry(3, 0.3, 1.2), body, 0, 2.6, 2.2);
  p.add(new THREE.CylinderGeometry(0.25, 0.3, 2.2, 10), plastic(0x2a2c31), 0, 3.4, 1.0);
  cab(p, root, color, 0, 2.4, -1.2);
  p.buildInto(root);
  const drum = new THREE.Group();
  const d = new PartBuilder();
  d.add(new THREE.CylinderGeometry(1.25, 1.25, 3, 24).rotateZ(Math.PI / 2), plastic(STEEL), 0, 0, 0);
  for (let i = 0; i < 6; i++) d.add(new THREE.BoxGeometry(3.04, 0.06, 0.3), plastic(shade(STEEL, 0.75)), 0, 0, 0, (i / 6) * Math.PI);
  d.buildInto(drum);
  drum.position.set(0, 1.25, 2.4);
  root.add(drum);
  const wheels = [-1, 1].map((s) => {
    const w = wheel(1.1, 0.7);
    w.position.set(s * 1.5, 1.1, -1.5);
    root.add(w);
    return w;
  });
  return { root, spinners: [drum, ...wheels], churn: null };
}

/** A dump truck with its tipper full of Moon rocks. */
export function dumpTruck(color: number): Machine {
  const root = new THREE.Group();
  const p = new PartBuilder();
  const body = plastic(color);
  p.add(new THREE.BoxGeometry(2.6, 0.5, 6.2), plastic(0x3a3e46), 0, 1.0, 0);
  p.add(new THREE.BoxGeometry(2.6, 1.8, 1.8), body, 0, 2.0, 2.2);
  p.add(new THREE.BoxGeometry(2.4, 0.8, 0.1), plastic(0x9fd4f0), 0, 2.4, 3.12);
  p.add(new THREE.BoxGeometry(2.8, 1.5, 3.8), plastic(HAZARD), 0, 2.0, -1.1);
  for (let i = 0; i < 9; i++) p.add(new THREE.DodecahedronGeometry(0.45 + (i % 3) * 0.12, 0), plastic(0x8a8a90), -0.8 + (i % 3) * 0.8, 2.9, -2.3 + Math.floor(i / 3) * 1.1, i, i * 2, 0);
  const driver = createPoseFigure(color, 'stand', true);
  driver.scale.setScalar(0.62);
  driver.position.set(0, 1.35, 2.1);
  driver.rotation.y = Math.PI;
  root.add(driver);
  p.buildInto(root);
  const wheels: THREE.Group[] = [];
  for (const z of [2.0, -1.0, -2.4]) {
    for (const s of [-1, 1]) {
      const w = wheel(0.75, 0.6);
      w.position.set(s * 1.35, 0.75, z);
      root.add(w);
      wheels.push(w);
    }
  }
  return { root, spinners: wheels, churn: null };
}

/** A cement mixer with a striped drum that turns all the time. */
export function cementMixer(color: number): Machine {
  const root = new THREE.Group();
  const p = new PartBuilder();
  const body = plastic(color);
  p.add(new THREE.BoxGeometry(2.4, 0.5, 6), plastic(0x3a3e46), 0, 1.0, 0);
  p.add(new THREE.BoxGeometry(2.4, 1.8, 1.7), body, 0, 2.0, 2.2);
  p.add(new THREE.BoxGeometry(2.2, 0.8, 0.1), plastic(0x9fd4f0), 0, 2.4, 3.07);
  p.add(new THREE.BoxGeometry(0.6, 0.15, 1.6), plastic(STEEL), 0, 1.7, -3.4, 0.5);
  const driver = createPoseFigure(color, 'stand', true);
  driver.scale.setScalar(0.62);
  driver.position.set(0, 1.35, 2.1);
  driver.rotation.y = Math.PI;
  root.add(driver);
  p.buildInto(root);
  const drum = new THREE.Group();
  const d = new PartBuilder();
  d.add(new THREE.SphereGeometry(1.4, 18, 12), plastic(0xf2eee2), 0, 0, 0, 0, 0, 0, 1, 1, 1.55);
  for (let i = 0; i < 4; i++) d.add(new THREE.TorusGeometry(1.25, 0.12, 6, 20), plastic(color), 0, 0, -1.2 + i * 0.8, 0, 0, 0, 1, 1, 1);
  d.buildInto(drum);
  drum.position.set(0, 2.7, -0.9);
  drum.rotation.x = -0.35;
  root.add(drum);
  const wheels: THREE.Group[] = [];
  for (const z of [2.0, -1.4]) {
    for (const s of [-1, 1]) {
      const w = wheel(0.75, 0.6);
      w.position.set(s * 1.25, 0.75, z);
      root.add(w);
      wheels.push(w);
    }
  }
  return { root, spinners: wheels, churn: drum };
}
