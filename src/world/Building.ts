import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { HitRegistry } from '../combat/HitRegistry';

const COLLAPSE_DURATION = 1.1;
const DEBRIS_LIFETIME = 5;
const DEBRIS_COUNT = 7;

interface Debris {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  age: number;
}

/** A single destructible building: GLB visual + static collider, collapsing into debris at 0 HP. */
export class Building {
  health: number;
  readonly maxHealth: number;
  destroyed = false;

  private collapseT = 0;
  private startY = 0;
  private readonly startScale = new THREE.Vector3(1, 1, 1);
  private body: RAPIER.RigidBody | null;
  private collider: RAPIER.Collider | null;
  private readonly debris: Debris[] = [];
  private readonly debrisMaterial: THREE.MeshStandardMaterial;

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly hitRegistry: HitRegistry,
    readonly mesh: THREE.Object3D,
    readonly halfExtents: THREE.Vector3,
    readonly center: THREE.Vector3,
    maxHealth: number,
    debrisColor: number,
  ) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.debrisMaterial = new THREE.MeshStandardMaterial({ color: debrisColor, roughness: 0.85 });

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    this.body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    this.collider = world.createCollider(colliderDesc, this.body);
    hitRegistry.register(this.collider, { kind: 'building', building: this });
  }

  get physicsCollider(): RAPIER.Collider | null {
    return this.collider;
  }

  takeDamage(amount: number): void {
    if (this.destroyed) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.collapse();
  }

  private collapse(): void {
    this.destroyed = true;
    this.startY = this.mesh.position.y;
    this.startScale.copy(this.mesh.scale);
    if (this.collider) this.hitRegistry.unregister(this.collider);
    if (this.body) {
      this.world.removeRigidBody(this.body);
      this.body = null;
      this.collider = null;
    }
    this.spawnDebris();
    this.spawnRubblePile();
  }

  /** A low, permanent heap of broken blocks left where the building stood. */
  private spawnRubblePile(): void {
    const groundY = this.center.y - this.halfExtents.y;
    const pile = new THREE.Group();
    const darker = this.debrisMaterial.clone();
    darker.color.multiplyScalar(0.6);
    for (let i = 0; i < 9; i++) {
      const w = this.halfExtents.x * (0.4 + Math.random() * 0.6);
      const d = this.halfExtents.z * (0.4 + Math.random() * 0.6);
      const h = 0.6 + Math.random() * Math.min(3, this.halfExtents.y * 0.5);
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), i % 3 === 0 ? darker : this.debrisMaterial);
      block.position.set(
        this.center.x + (Math.random() - 0.5) * this.halfExtents.x,
        groundY + h * 0.35,
        this.center.z + (Math.random() - 0.5) * this.halfExtents.z,
      );
      block.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
      block.castShadow = true;
      block.receiveShadow = true;
      pile.add(block);
    }
    this.scene.add(pile);
  }

  /** Point on the ground at the middle of the footprint, where smoke should rise from. */
  get groundCenter(): THREE.Vector3 {
    return new THREE.Vector3(this.center.x, this.center.y - this.halfExtents.y + 1, this.center.z);
  }

  private spawnDebris(): void {
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const size = 0.6 + Math.random() * 1.1;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mesh = new THREE.Mesh(geo, this.debrisMaterial);
      mesh.castShadow = true;
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * this.halfExtents.x * 1.6,
        this.halfExtents.y * (0.3 + Math.random() * 0.8),
        (Math.random() - 0.5) * this.halfExtents.z * 1.6,
      );
      const pos = this.center.clone().add(offset);
      mesh.position.copy(pos);
      this.scene.add(mesh);

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z);
      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setDensity(4);
      this.world.createCollider(colliderDesc, body);
      body.setLinvel(
        { x: (Math.random() - 0.5) * 6, y: 3 + Math.random() * 5, z: (Math.random() - 0.5) * 6 },
        true,
      );
      body.setAngvel({ x: Math.random() * 4, y: Math.random() * 4, z: Math.random() * 4 }, true);

      this.debris.push({ mesh, body, age: 0 });
    }
  }

  update(dt: number): void {
    if (this.destroyed && this.collapseT < COLLAPSE_DURATION) {
      this.collapseT += dt;
      const t = Math.min(1, this.collapseT / COLLAPSE_DURATION);
      this.mesh.scale.copy(this.startScale).multiplyScalar(Math.max(0.001, 1 - t));
      this.mesh.position.y = this.startY - this.halfExtents.y * t;
      if (t >= 1) this.mesh.removeFromParent(); // may live inside a landmark group, not the scene root
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      const t = d.body.translation();
      const r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (d.age > DEBRIS_LIFETIME) {
        this.scene.remove(d.mesh);
        this.world.removeRigidBody(d.body);
        this.debris.splice(i, 1);
      }
    }
  }
}
