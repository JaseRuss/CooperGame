import * as THREE from 'three';
import { X_HALF } from './Layout';

const PUFFS = 150;
/** How fast the cloud rolls toward us, how far it gets, and how long it hangs about before thinning out. */
const SPEED = 4.2;
const START_Z = -30;
const REACH_Z = 58;
const LINGER = 14;
const FADE = 7;
/** The cloud is this deep from its front edge back. */
const DEPTH = 46;

let puffTexture: THREE.Texture | null = null;
function texture(): THREE.Texture {
  if (puffTexture) return puffTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  puffTexture = new THREE.CanvasTexture(c);
  return puffTexture;
}

/**
 * A gas attack: a low yellow-green cloud let off along their trench that rolls across no man's
 * land, over our parapet and into our trench, hangs there, then thins away. Anyone inside it
 * without a gas mask on is hurt.
 */
export class Gas {
  /** Where the front edge has got to, and how thick it is overall (0..1). */
  front = START_Z;
  strength = 0;
  private state: 'idle' | 'rolling' | 'lingering' | 'fading' = 'idle';
  private t = 0;
  private readonly group = new THREE.Group();
  private readonly puffs: { s: THREE.Sprite; x: number; dz: number; y: number; phase: number }[] = [];
  private readonly material: THREE.SpriteMaterial;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.SpriteMaterial({ map: texture(), color: 0xb8c94a, transparent: true, opacity: 0, depthWrite: false, fog: true });
    for (let i = 0; i < PUFFS; i++) {
      const s = new THREE.Sprite(this.material);
      const size = 7 + Math.random() * 7;
      s.scale.set(size, size * 0.55, 1);
      this.group.add(s);
      this.puffs.push({ s, x: (Math.random() * 2 - 1) * (X_HALF + 4), dz: Math.random() * DEPTH, y: 0.8 + Math.random() * 1.8, phase: Math.random() * 6 });
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  get active(): boolean {
    return this.state !== 'idle';
  }

  release(): void {
    this.state = 'rolling';
    this.t = 0;
    this.front = START_Z;
    this.group.visible = true;
  }

  /** How thick the gas is this far up or down the map: 0 outside the cloud. */
  at(z: number): number {
    if (!this.active) return 0;
    return z < this.front && z > this.front - DEPTH ? this.strength : 0;
  }

  update(dt: number): void {
    if (this.state === 'idle') return;
    this.t += dt;
    if (this.state === 'rolling') {
      this.front = Math.min(REACH_Z, this.front + SPEED * dt);
      this.strength = Math.min(1, this.t / 3);
      if (this.front >= REACH_Z) {
        this.state = 'lingering';
        this.t = 0;
      }
    } else if (this.state === 'lingering') {
      if (this.t > LINGER) {
        this.state = 'fading';
        this.t = 0;
      }
    } else {
      this.strength = Math.max(0, 1 - this.t / FADE);
      if (this.strength === 0) {
        this.state = 'idle';
        this.group.visible = false;
      }
    }
    this.material.opacity = 0.42 * this.strength;
    for (const p of this.puffs) {
      p.phase += dt * 0.4;
      const z = this.front - p.dz + Math.sin(p.phase) * 1.5;
      p.s.visible = z > START_Z - 4;
      p.s.position.set(p.x + Math.cos(p.phase * 0.7) * 2, p.y + Math.sin(p.phase * 1.3) * 0.3, z);
    }
  }
}
