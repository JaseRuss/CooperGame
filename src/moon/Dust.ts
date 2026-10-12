import * as THREE from 'three';
import { MOON_G } from './Buggy';

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  age: number;
  size: number;
  alive: boolean;
}

const GEO = new THREE.IcosahedronGeometry(1, 0);
const POOL = 160;

/**
 * Moon dust: with no air to hold it up, a puff thrown up by a wheel or a landing flies in a clean
 * arc and drops slowly, instead of billowing. A fixed pool of little grey rocks.
 */
export class Dust {
  private readonly puffs: Puff[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9d9488, roughness: 1, flatShading: true, transparent: true, opacity: 0.85 });
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(GEO, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.puffs.push({ mesh, vel: new THREE.Vector3(), life: 1, age: 0, size: 0.2, alive: false });
    }
  }

  /** Throws up `count` bits of dust round `at`, spreading out at about `speed`. */
  burst(at: THREE.Vector3, count: number, speed: number, size = 0.22, carry?: THREE.Vector3): void {
    for (let i = 0; i < count; i++) {
      const p = this.puffs[this.next];
      this.next = (this.next + 1) % POOL;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      p.vel.set(Math.cos(a) * s, speed * (0.3 + Math.random() * 0.8), Math.sin(a) * s);
      if (carry) p.vel.addScaledVector(carry, 0.5);
      p.mesh.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6));
      p.size = size * (0.6 + Math.random() * 0.8);
      p.life = 1.3 + Math.random() * 1.4;
      p.age = 0;
      p.alive = true;
      p.mesh.visible = true;
      p.mesh.scale.setScalar(p.size);
      p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    }
  }

  update(dt: number, groundAt: (x: number, z: number) => number): void {
    for (const p of this.puffs) {
      if (!p.alive) continue;
      p.age += dt;
      p.vel.y -= MOON_G * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const g = groundAt(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y < g + p.size * 0.5) {
        p.mesh.position.y = g + p.size * 0.5;
        p.vel.set(p.vel.x * 0.3, 0, p.vel.z * 0.3);
      }
      const k = p.age / p.life;
      p.mesh.scale.setScalar(p.size * (1 - k * 0.6));
      if (k >= 1) {
        p.alive = false;
        p.mesh.visible = false;
      }
    }
  }
}
