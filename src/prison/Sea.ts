import * as THREE from 'three';
import { mulberry32 } from '../utils/rng';

/** The water's surface (just below the beach), and how wide the texture's tile is on it. */
export const SEA_LEVEL = -0.25;
const TILE = 36;
const SIZE = 1700;

export interface MistBank {
  x: number;
  z: number;
  radius: number;
}

export interface Buoy {
  x: number;
  z: number;
  /** How far along the crossing it is (0 to 1). */
  progress: number;
}

function waterTexture(): THREE.CanvasTexture {
  const rng = mulberry32(77);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#f4f8ff';
  ctx.fillRect(0, 0, 512, 512);
  // Soft ripples: short light streaks, wrapped round the tile's edges so it repeats without a seam.
  ctx.lineCap = 'round';
  for (let i = 0; i < 520; i++) {
    const x = rng() * 512;
    const y = rng() * 512;
    const len = 14 + rng() * 40;
    const v = Math.floor(205 + rng() * 50);
    ctx.strokeStyle = `rgba(${v - 40},${v - 22},${v},${0.18 + rng() * 0.3})`;
    ctx.lineWidth = 1 + rng() * 2.2;
    for (const ox of [-512, 0, 512]) {
      for (const oy of [-512, 0, 512]) {
        ctx.beginPath();
        ctx.moveTo(x + ox - len / 2, y + oy);
        ctx.quadraticCurveTo(x + ox, y + oy - 3 - rng() * 3, x + ox + len / 2, y + oy + rng() * 2);
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(SIZE / TILE, SIZE / TILE);
  tex.anisotropy = 4;
  return tex;
}

function mistTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The sea between the prison and the far shore: a dark sheet of rippled water that follows
 * the raft (its texture is pinned to the world, so it slides past), banks of sea mist to hide
 * in from the search helicopters, and lit buoys along the way (each a checkpoint).
 */
export class Sea {
  readonly group = new THREE.Group();
  readonly mist: MistBank[];
  readonly buoys: Buoy[];
  private readonly water: THREE.Mesh;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly mistSprites: THREE.Sprite[] = [];
  private readonly mistMaterial: THREE.SpriteMaterial;
  private readonly lamps: THREE.Sprite[] = [];

  /**
   * `from` and `to` are the z of the jetty's end and of the far beach; the mist and buoys are
   * strung out between them.
   */
  constructor(from: number, to: number) {
    this.texture = waterTexture();
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.texture, roughness: 0.3, metalness: 0.25 });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), this.material);
    this.water.position.y = SEA_LEVEL;
    this.water.receiveShadow = true;
    this.group.add(this.water);

    // Banks of mist, alternating sides of the course, every 130 m or so (the beam of a helicopter can't see into one).
    const rng = mulberry32(2024);
    this.mist = [];
    const length = from - to;
    for (let i = 0; i < 8; i++) {
      const z = from - length * (0.1 + i * 0.105 + rng() * 0.03);
      const side = i % 2 === 0 ? -1 : 1;
      this.mist.push({ x: side * (22 + rng() * 38), z, radius: 34 + rng() * 14 });
    }
    // A few lit buoys down the middle, each a checkpoint (and a spare life jacket).
    this.buoys = [0.2, 0.4, 0.6, 0.8].map((progress, i) => ({ x: (i % 2 ? 1 : -1) * 6, z: from - length * progress, progress }));

    this.mistMaterial = new THREE.SpriteMaterial({ map: mistTexture(), color: 0xaab8cc, transparent: true, opacity: 0.55, depthWrite: false });
    for (const bank of this.mist) {
      const count = Math.round(bank.radius / 2.6);
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * bank.radius * 0.85;
        const sprite = new THREE.Sprite(this.mistMaterial);
        const size = 34 + rng() * 40;
        sprite.scale.set(size, size * 0.55, 1);
        sprite.position.set(bank.x + Math.cos(a) * r, 2 + rng() * 7, bank.z + Math.sin(a) * r);
        this.group.add(sprite);
        this.mistSprites.push(sprite);
      }
    }
    const buoyBody = new THREE.CylinderGeometry(0.35, 0.5, 1.1, 10);
    const stripe = new THREE.CylinderGeometry(0.38, 0.4, 0.3, 10);
    const lampTexture = mistTexture();
    for (const b of this.buoys) {
      const g = new THREE.Group();
      g.position.set(b.x, SEA_LEVEL + 0.35, b.z);
      g.add(new THREE.Mesh(buoyBody, new THREE.MeshStandardMaterial({ color: 0xc8302a, roughness: 0.5 })));
      const band = new THREE.Mesh(stripe, new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }));
      band.position.y = 0.1;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x444444 }));
      mast.position.y = 1.3;
      const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampTexture, color: 0xff5030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      lamp.scale.set(6, 6, 1);
      lamp.position.y = 2.2;
      g.add(band, mast, lamp);
      this.group.add(g);
      this.lamps.push(lamp);
    }
  }

  /** Low graphics: half the mist sprites (the big overlapping sheets are the costly part). */
  setLite(lite: boolean): void {
    this.mistSprites.forEach((s, i) => (s.visible = !lite || i % 2 === 0));
  }

  /** How hidden a point on the water is by the mist (0 in the clear, 1 in the middle of a bank). */
  mistAt(x: number, z: number): number {
    let best = 0;
    for (const m of this.mist) {
      const d = Math.hypot(x - m.x, z - m.z);
      best = Math.max(best, THREE.MathUtils.smoothstep(m.radius * 0.95 - d, 0, m.radius * 0.45));
    }
    return best;
  }

  /** Slides the water under `center` (the raft or the camera), ripples drifting, mist tinted to the sky. */
  update(center: THREE.Vector3, time: number, water: THREE.Color, mist: THREE.Color): void {
    this.water.position.x = center.x;
    this.water.position.z = center.z;
    this.texture.offset.set(center.x / TILE + time * 0.004, -center.z / TILE + time * 0.007);
    this.material.color.copy(water);
    this.mistMaterial.color.copy(mist).multiplyScalar(1.15);
    const blink = Math.sin(time * 4) > 0.2 ? 1 : 0.25;
    for (const lamp of this.lamps) lamp.material.opacity = blink;
  }
}
