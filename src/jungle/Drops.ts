import * as THREE from 'three';
import { createFigureMesh } from '../entities/Soldier';
import { ARMY_GREEN } from '../utils/plastic';

const DROP_HEIGHT = 55;
const FALL = 6;

interface Chute {
  root: THREE.Group;
  /** What's on it: a soldier, or a supply crate. */
  kind: 'soldier' | 'crate';
  sway: number;
  landed: boolean;
}

const canopyGeo = new THREE.SphereGeometry(2.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1);
const canopyMats = [0xe8e4d0, 0xb8392e, 0x3d6fc4].map((c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide }));

/**
 * Air support: paratroopers and a supply crate drifting down on chutes over somewhere clear.
 * `land(kind, position)` runs as each one touches down.
 */
export class Drops {
  private readonly chutes: Chute[] = [];
  private readonly landing: (kind: 'soldier' | 'crate', at: THREE.Vector3) => void;

  constructor(private readonly scene: THREE.Scene, landing: (kind: 'soldier' | 'crate', at: THREE.Vector3) => void) {
    this.landing = landing;
  }

  get airborne(): number {
    return this.chutes.length;
  }

  drop(kind: 'soldier' | 'crate', x: number, z: number, delay = 0): void {
    const root = new THREE.Group();
    const canopy = new THREE.Mesh(canopyGeo, canopyMats[Math.floor(Math.random() * canopyMats.length)]);
    canopy.position.y = 3.6;
    root.add(canopy);
    const load = kind === 'soldier' ? createFigureMesh(0, ARMY_GREEN) : new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 1.1), new THREE.MeshStandardMaterial({ color: 0x8b5e38 }));
    if (kind === 'crate') load.position.y = 0.4;
    root.add(load);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3.2, 3), new THREE.MeshBasicMaterial({ color: 0xe8e4d0 }));
      line.position.set(Math.cos(a) * 1, 1.9, Math.sin(a) * 1);
      line.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      root.add(line);
    }
    root.position.set(x, DROP_HEIGHT + delay * FALL, z);
    this.scene.add(root);
    this.chutes.push({ root, kind, sway: Math.random() * 6, landed: false });
  }

  update(dt: number): void {
    for (let i = this.chutes.length - 1; i >= 0; i--) {
      const c = this.chutes[i];
      c.sway += dt;
      c.root.position.y -= FALL * dt;
      c.root.rotation.z = Math.sin(c.sway * 1.4) * 0.12;
      if (c.root.position.y > 0) continue;
      this.landing(c.kind, new THREE.Vector3(c.root.position.x, 0, c.root.position.z));
      this.scene.remove(c.root);
      this.chutes.splice(i, 1);
    }
  }
}
