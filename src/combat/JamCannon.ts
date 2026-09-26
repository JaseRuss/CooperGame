import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { surfaceHeightAt } from '../world/Terrain';

const GRAVITY = -12;
const MAX_LIFETIME = 4;
const SPLAT_LIFETIME = 14;
const SPLAT_FADE = 3;
/** Most puddles on the ground at once; the oldest go first (a long spray lays a lot of jam). */
const MAX_SPLATS = 90;
const DROPLET_LIFETIME = 1.2;
/** A glob sheds a drip every this many metres of flight, so jam rains on whatever is under its path. */
const DRIP_SPACING = 3.5;
/** Only every few globs drip: a held spray fires about 14 a second and their paths overlap. */
const DRIP_EVERY = 3;
/** Globs lower than this are about to land anyway. */
const DRIP_MIN_HEIGHT = 1.2;
const DRIP_SPLAT_LIFETIME = 7;
const MAX_DRIP_SPLATS = 120;

// Bright strawberry jam (glossy and pinkish so it reads as jam, not anything nastier).
const JAM_COLOR = 0xe0294f;
const blobMaterial = new THREE.MeshPhysicalMaterial({
  color: JAM_COLOR,
  emissive: 0x5a0616,
  roughness: 0.08,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  sheen: 0.6,
  sheenColor: new THREE.Color(0xff8fa8),
});
const chunkMaterial = new THREE.MeshPhysicalMaterial({ color: 0xff5a78, roughness: 0.2, clearcoat: 1 });
const chunkGeometry = new THREE.SphereGeometry(0.16, 8, 6).scale(1, 0.55, 1);
const blobGeometry = new THREE.SphereGeometry(0.24, 12, 8);
const dropletGeometry = new THREE.SphereGeometry(0.12, 8, 6);

/** A glob of jam stuck over a gun's muzzle (friendly fire from the jam cannon). */
export function createMuzzleGlob(size = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(blobGeometry, blobMaterial);
  mesh.scale.set(size, size * 0.85, size * 1.2);
  return mesh;
}

const tagMaterials = new Map<string, THREE.SpriteMaterial>();

/** A floating pink tag such as "GUN JAMMED!" (one shared texture per text; one sprite per unit). */
export function createJammedTag(width: number, text = 'GUN JAMMED!'): THREE.Sprite {
  let material = tagMaterials.get(text);
  if (!material) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = 'rgba(40,6,14,0.78)';
    ctx.beginPath();
    ctx.roundRect(4, 6, 248, 52, 26);
    ctx.fill();
    ctx.font = '900 30px "Black Ops One", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff8aa8';
    ctx.fillText(text, 128, 34, 228);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    material = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    tagMaterials.set(text, material);
  }
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, width / 4, 1);
  sprite.renderOrder = 12;
  return sprite;
}

/** An irregular jam puddle, lying flat (built in XY; laid onto the ground by the caller). */
function splatGeometry(radius: number, rng: () => number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const lobes = 14;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const r = radius * (0.7 + rng() * 0.45);
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.quadraticCurveTo(Math.cos(a - 0.2) * r * 1.15, Math.sin(a - 0.2) * r * 1.15, Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s, 3).rotateX(-Math.PI / 2);
}

interface Blob {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  /** Whether this glob sheds drips on its way (only some do: a held spray's paths overlap). */
  drips: boolean;
  /** Metres of flight left before the next drip falls. */
  toNextDrip: number;
}

interface Droplet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
}

interface Splat {
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  age: number;
}

/** A small spot of jam left where a drip landed; the geometry and material are shared. */
interface DripSplat {
  mesh: THREE.Mesh;
  age: number;
}

let dripSplatShapes: THREE.BufferGeometry[] | null = null;
const dripSplatMaterial = new THREE.MeshPhysicalMaterial({
  color: JAM_COLOR,
  emissive: 0x5a0616,
  roughness: 0.08,
  clearcoat: 1,
  polygonOffset: true,
  polygonOffsetFactor: -5,
  polygonOffsetUnits: -5,
});

/**
 * The jam cannon's blobs: lobbed, wobbling globs of strawberry jam. Where one lands it bursts
 * into droplets and leaves a glossy puddle; on the way it drips, so jam rains down on everything
 * under its path. The game decides who gets stuck in it.
 */
export class JamCannon {
  private readonly blobs: Blob[] = [];
  private readonly droplets: Droplet[] = [];
  private readonly drips: Droplet[] = [];
  private readonly splats: Splat[] = [];
  private readonly dripSplats: DripSplat[] = [];
  private fired = 0;

  constructor(private readonly scene: THREE.Scene) {}

  fire(origin: THREE.Vector3, direction: THREE.Vector3, speed: number): void {
    const mesh = new THREE.Mesh(blobGeometry, blobMaterial);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.blobs.push({
      mesh,
      velocity: direction.clone().normalize().multiplyScalar(speed),
      age: 0,
      drips: this.fired++ % DRIP_EVERY === 0,
      toNextDrip: DRIP_SPACING * (0.3 + Math.random() * 0.7),
    });
  }

  /**
   * Advances blobs and drips. `onSplat` gets each glob's landing point, the collider it hit (null
   * for open ground) and its velocity; `onDrip` gets each point a drip lands on.
   */
  update(
    dt: number,
    world: RAPIER.World,
    exclude: RAPIER.Collider,
    onSplat: (point: THREE.Vector3, hit: RAPIER.Collider | null, velocity: THREE.Vector3) => void,
    onDrip: (point: THREE.Vector3) => void,
  ): void {
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i];
      b.age += dt;
      b.velocity.y += GRAVITY * dt;
      const step = b.velocity.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().divideScalar(len || 1);
      const hit = world.castRay(new RAPIER.Ray(b.mesh.position, dir), len, true, undefined, undefined, exclude);
      let landed: THREE.Vector3 | null = null;
      if (hit) {
        landed = b.mesh.position.clone().addScaledVector(dir, hit.timeOfImpact);
      } else {
        b.mesh.position.add(step);
        const ground = surfaceHeightAt(b.mesh.position.x, b.mesh.position.z);
        if (b.mesh.position.y <= ground) landed = b.mesh.position.clone().setY(ground);
        else if (b.drips) {
          b.toNextDrip -= Math.hypot(step.x, step.z);
          if (b.toNextDrip <= 0) {
            b.toNextDrip += DRIP_SPACING;
            if (b.mesh.position.y - ground > DRIP_MIN_HEIGHT) this.drip(b.mesh.position, b.velocity);
          }
        }
      }
      // Stretched along its flight so a spray of globs reads as one stream, with a jelly wobble.
      const w = Math.sin(b.age * 28 + i) * 0.15;
      b.mesh.lookAt(b.mesh.position.clone().add(b.velocity));
      b.mesh.scale.set(1 + w, 1 - w, 2.2);
      if (landed || b.age > MAX_LIFETIME) {
        this.scene.remove(b.mesh);
        this.blobs.splice(i, 1);
        if (landed) {
          this.burst(landed);
          onSplat(landed, hit?.collider ?? null, b.velocity);
        }
      }
    }

    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.age += dt;
      d.velocity.y += GRAVITY * 1.4 * dt;
      d.mesh.position.addScaledVector(d.velocity, dt);
      d.mesh.scale.set(0.8, 1.6, 0.8); // a falling teardrop
      const ground = surfaceHeightAt(d.mesh.position.x, d.mesh.position.z);
      if (d.mesh.position.y > ground && d.age < MAX_LIFETIME) continue;
      this.scene.remove(d.mesh);
      this.drips.splice(i, 1);
      const point = d.mesh.position.clone().setY(ground);
      this.dripSplat(point);
      onDrip(point);
    }

    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i];
      d.age += dt;
      d.velocity.y += GRAVITY * 1.4 * dt;
      d.mesh.position.addScaledVector(d.velocity, dt);
      const ground = surfaceHeightAt(d.mesh.position.x, d.mesh.position.z) + 0.05;
      if (d.mesh.position.y < ground) {
        d.mesh.position.y = ground;
        d.velocity.set(0, 0, 0);
        d.mesh.scale.set(1.4, 0.3, 1.4); // flattened blob
      }
      if (d.age > DROPLET_LIFETIME) {
        this.scene.remove(d.mesh);
        this.droplets.splice(i, 1);
      }
    }

    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.age += dt;
      s.mesh.scale.setScalar(Math.min(1, 0.3 + s.age * 6)); // spreads out as it lands
      const left = SPLAT_LIFETIME - s.age;
      if (left < SPLAT_FADE) s.material.opacity = Math.max(0, left / SPLAT_FADE);
      if (left <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.material.dispose();
        this.splats.splice(i, 1);
      }
    }

    for (let i = this.dripSplats.length - 1; i >= 0; i--) {
      const s = this.dripSplats[i];
      s.age += dt;
      // Spreads as it lands, then dries up (shrinks away) at the end.
      s.mesh.scale.setScalar(Math.min(1, 0.3 + s.age * 8, (DRIP_SPLAT_LIFETIME - s.age) / SPLAT_FADE));
      if (s.age >= DRIP_SPLAT_LIFETIME) {
        this.scene.remove(s.mesh);
        this.dripSplats.splice(i, 1);
      }
    }
  }

  /** A drip of jam falling off a glob in flight. */
  private drip(from: THREE.Vector3, velocity: THREE.Vector3): void {
    const mesh = new THREE.Mesh(dropletGeometry, blobMaterial);
    mesh.position.copy(from);
    this.scene.add(mesh);
    // Most of the glob's forward speed stays with the glob: the drip falls almost straight down.
    this.drips.push({ mesh, velocity: new THREE.Vector3(velocity.x * 0.12, Math.min(0, velocity.y) * 0.3 - 2, velocity.z * 0.12), age: 0 });
  }

  /** A little spot of jam where a drip landed. */
  private dripSplat(point: THREE.Vector3): void {
    const shapes = (dripSplatShapes ??= Array.from({ length: 6 }, () => splatGeometry(0.55, Math.random)));
    const mesh = new THREE.Mesh(shapes[Math.floor(Math.random() * shapes.length)], dripSplatMaterial);
    mesh.position.set(point.x, point.y + 0.07, point.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(0.3);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.dripSplats.push({ mesh, age: 0 });
    while (this.dripSplats.length > MAX_DRIP_SPLATS) this.scene.remove((this.dripSplats.shift() as DripSplat).mesh);
  }

  /** Droplets flying out, and a glossy puddle left on the ground. */
  private burst(point: THREE.Vector3): void {
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(dropletGeometry, blobMaterial);
      mesh.position.copy(point).setY(point.y + 0.3);
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 5;
      this.scene.add(mesh);
      this.droplets.push({ mesh, velocity: new THREE.Vector3(Math.cos(a) * s, 3 + Math.random() * 5, Math.sin(a) * s), age: 0 });
    }
    const material = new THREE.MeshPhysicalMaterial({
      color: JAM_COLOR,
      emissive: 0x5a0616,
      roughness: 0.08,
      clearcoat: 1,
      transparent: true,
      opacity: 1,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    const mesh = new THREE.Mesh(splatGeometry(1.0 + Math.random() * 0.45, Math.random), material);
    // Strawberry chunks sitting in the jam.
    for (let i = 0; i < 2; i++) {
      const chunk = new THREE.Mesh(chunkGeometry, chunkMaterial);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.7;
      chunk.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r);
      chunk.rotation.y = Math.random() * Math.PI;
      mesh.add(chunk);
    }
    const ground = surfaceHeightAt(point.x, point.z);
    mesh.position.set(point.x, Math.max(ground, point.y - 0.5) + 0.08, point.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.splats.push({ mesh, material, age: 0 });
    while (this.splats.length > MAX_SPLATS) {
      const old = this.splats.shift() as Splat;
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      old.material.dispose();
    }
  }
}
