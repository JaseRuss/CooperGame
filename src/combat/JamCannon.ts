import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { surfaceHeightAt } from '../world/Terrain';

const GRAVITY = -12;
const MAX_LIFETIME = 4;
const SPLAT_LIFETIME = 22;
const SPLAT_FADE = 4;
const DROPLET_LIFETIME = 1.2;

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
const blobGeometry = new THREE.SphereGeometry(0.34, 14, 10);
const dropletGeometry = new THREE.SphereGeometry(0.12, 8, 6);

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

/**
 * The jam cannon's blobs: lobbed, wobbling globs of strawberry jam. Where one lands it bursts
 * into droplets and leaves a glossy puddle; the game decides who gets stuck in it.
 */
export class JamCannon {
  private readonly blobs: Blob[] = [];
  private readonly droplets: Droplet[] = [];
  private readonly splats: Splat[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  fire(origin: THREE.Vector3, direction: THREE.Vector3, speed: number): void {
    const mesh = new THREE.Mesh(blobGeometry, blobMaterial);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.blobs.push({ mesh, velocity: direction.clone().normalize().multiplyScalar(speed), age: 0 });
  }

  /** Advances blobs; calls `onSplat` with each landing point. */
  update(dt: number, world: RAPIER.World, exclude: RAPIER.Collider, onSplat: (point: THREE.Vector3) => void): void {
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
      }
      // Wobble like a jelly in flight.
      const w = Math.sin(b.age * 28) * 0.18;
      b.mesh.scale.set(1 + w, 1 - w, 1 + w * 0.5);
      if (landed || b.age > MAX_LIFETIME) {
        this.scene.remove(b.mesh);
        this.blobs.splice(i, 1);
        if (landed) {
          this.burst(landed);
          onSplat(landed);
        }
      }
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
  }

  /** Droplets flying out, and a glossy puddle left on the ground. */
  private burst(point: THREE.Vector3): void {
    for (let i = 0; i < 12; i++) {
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
    const mesh = new THREE.Mesh(splatGeometry(1.7 + Math.random() * 0.6, Math.random), material);
    // Strawberry chunks sitting in the jam.
    for (let i = 0; i < 6; i++) {
      const chunk = new THREE.Mesh(chunkGeometry, chunkMaterial);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.3;
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
  }
}
