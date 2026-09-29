import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';
import { surfaceHeightAt, waterDepthAt } from './Terrain';

/** How high above the ground the chutes open, and how fast they come down (metres, m/s). */
const DROP_HEIGHT = 75;
const FALL_SPEED = 9;

interface Chute {
  root: THREE.Group;
  x: number;
  z: number;
  y: number;
  swayPhase: number;
}

interface Drop {
  chutes: Chute[];
  land: () => void;
}

let shared: Map<THREE.Material, THREE.BufferGeometry> | null = null;

/** A green and white canopy with rigging lines and a little army man hanging underneath. */
function chuteGeometries(): Map<THREE.Material, THREE.BufferGeometry> {
  if (shared) return shared;
  const b = new PartBuilder();
  const green = plastic(shade(ARMY_GREEN, 1.1));
  const white = plastic(0xf4f1e4);
  const line = plastic(0x3a3a34);
  const R = 2.6;
  const top = 5;
  // Alternating green and white gores make up the dome.
  const gores = 8;
  for (let i = 0; i < gores; i++) {
    const g = new THREE.SphereGeometry(R, 4, 6, (i / gores) * Math.PI * 2, (Math.PI * 2) / gores, 0, Math.PI / 2).scale(1, 0.62, 1);
    b.add(g, i % 2 ? white : green, 0, top, 0);
  }
  // Rigging from the rim down to the trooper's shoulders.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.beam(new THREE.Vector3(Math.cos(a) * R, top, Math.sin(a) * R), new THREE.Vector3(0, 1.75, 0), 0.03, line, true);
  }
  // The trooper: body, head and helmet, legs dangling.
  b.add(new THREE.BoxGeometry(0.42, 0.6, 0.28), green, 0, 1.4, 0);
  b.add(new THREE.SphereGeometry(0.17, 8, 6), green, 0, 1.85, 0);
  b.add(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), green, 0, 1.9, 0);
  for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.16, 0.7, 0.18), green, s * 0.12, 0.75, 0.05);
  shared = b.buildGeometries();
  return shared;
}

/**
 * Allied paratroopers coming down under their canopies. The geometry and materials are built
 * once and shared, so there's nothing to dispose. When the last chute of a drop touches down its
 * `land` callback runs and the canopies vanish (the game puts the soldiers on the ground there).
 */
export class Paratroopers {
  private readonly drops: Drop[] = [];
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {}

  /** Chutes still in the air. */
  get airborne(): number {
    return this.drops.reduce((n, d) => n + d.chutes.length, 0);
  }

  /** `count` chutes open over (x, z), scattered a few metres apart; `land` runs when they're down. */
  drop(x: number, z: number, count: number, land: () => void): void {
    const geo = chuteGeometries();
    const chutes: Chute[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random();
      const r = 2 + Math.random() * 5;
      const root = new THREE.Group();
      for (const [mat, g] of geo) {
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = true;
        root.add(mesh);
      }
      const cx = x + Math.cos(a) * r;
      const cz = z + Math.sin(a) * r;
      const y = surfaceHeightAt(cx, cz) + DROP_HEIGHT + Math.random() * 14;
      root.position.set(cx, y, cz);
      this.scene.add(root);
      chutes.push({ root, x: cx, z: cz, y, swayPhase: Math.random() * 6 });
    }
    this.drops.push({ chutes, land });
  }

  update(dt: number): void {
    this.time += dt;
    for (let d = this.drops.length - 1; d >= 0; d--) {
      const drop = this.drops[d];
      for (let i = drop.chutes.length - 1; i >= 0; i--) {
        const c = drop.chutes[i];
        c.y -= FALL_SPEED * dt;
        const ground = surfaceHeightAt(c.x, c.z) + waterDepthAt(c.x, c.z);
        if (c.y <= ground) {
          this.scene.remove(c.root);
          drop.chutes.splice(i, 1);
          continue;
        }
        c.root.position.y = c.y;
        c.root.rotation.z = Math.sin(this.time * 1.4 + c.swayPhase) * 0.12;
        c.root.rotation.x = Math.cos(this.time * 1.1 + c.swayPhase) * 0.08;
      }
      if (drop.chutes.length === 0) {
        this.drops.splice(d, 1);
        drop.land();
      }
    }
  }
}
