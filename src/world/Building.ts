import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { HitRegistry } from '../combat/HitRegistry';
import type { Faction } from '../entities/Tank';

const COLLAPSE_DURATION = 1.1;
const DEBRIS_LIFETIME = 5;
const DEBRIS_COUNT = 7;
/** How long a health bar stays up after a hit, and how long it takes to fade. */
const BAR_SHOW_TIME = 3.5;
const BAR_FADE_TIME = 0.8;
const BAR_MAX_HEIGHT = 24; // above the ground, so skyscraper bars stay in view

interface Debris {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  age: number;
}

/** A weak point: a shell landing on it destroys the building outright. */
export interface CritSpot {
  label: string;
  /** True when a point on the shell's path (travelling along `dir`) is on this spot. */
  test: (point: THREE.Vector3, dir: THREE.Vector3) => boolean;
}

/** A single destructible building: GLB visual + static collider, collapsing into debris at 0 HP. */
export class Building {
  health: number;
  readonly maxHealth: number;
  destroyed = false;
  /** Size of the explosion when it collapses (fuel tanks go up bigger). */
  explosionSize = 2.2;
  /** Which side owns it; shells never hurt their own side's buildings. Null = anyone's target. */
  faction: Faction | null = null;
  /** Indestructible while set (the Fortress, until its gates open). */
  locked = false;
  /**
   * A fuel tank: fragile, and it goes up in a huge fireball that sets off anything close by.
   * Setting it also sizes the blast.
   */
  get fuel(): boolean {
    return this.isFuel;
  }
  set fuel(on: boolean) {
    this.isFuel = on;
    if (on) this.explosionSize = 6.5;
  }
  private isFuel = false;
  /** Weak points (a pillbox's gun slit, a jet's missiles). */
  readonly critSpots: CritSpot[] = [];
  /** How much bigger the blast is when it goes up from a critical hit. */
  critExplosionScale = 1;

  private bar: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } | null = null;
  private barTimer = 0;

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

  /**
   * The weak point a shell entering at `point` along `dir` would reach, if any. The collider is a
   * plain box round the whole model, so the shell's path is followed on through the box.
   */
  critAt(point: THREE.Vector3, dir: THREE.Vector3): CritSpot | null {
    if (this.destroyed || this.locked || this.critSpots.length === 0) return null;
    const box = new THREE.Box3().setFromCenterAndSize(this.center, this.halfExtents.clone().multiplyScalar(2)).expandByScalar(0.6);
    const d = dir.clone().normalize();
    const p = new THREE.Vector3();
    for (let k = 0; k <= 40; k++) {
      p.copy(point).addScaledVector(d, k * 0.4);
      if (k > 0 && !box.containsPoint(p)) break;
      const hit = this.critSpots.find((c) => c.test(p, d));
      if (hit) return hit;
    }
    return null;
  }

  /** A shell hit at `point` travelling along `dir`: normal damage, or instant destruction on a weak point. */
  strike(amount: number, point: THREE.Vector3, dir: THREE.Vector3): CritSpot | null {
    const crit = this.critAt(point, dir);
    if (crit) {
      this.destroyByCritical();
      return crit;
    }
    this.takeDamage(amount);
    return null;
  }

  /** Goes up at once, with the bigger weak-point blast. */
  destroyByCritical(): void {
    if (this.destroyed || this.locked) return;
    this.explosionSize *= this.critExplosionScale;
    this.takeDamage(this.health + 1);
  }

  takeDamage(amount: number): void {
    if (this.destroyed || this.locked) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.collapse();
    else this.showHealthBar();
  }

  /** Pops a health bar over the building; it fades away a few seconds after the last hit. */
  private showHealthBar(): void {
    if (!this.bar) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 16;
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
      const width = THREE.MathUtils.clamp(Math.max(this.halfExtents.x, this.halfExtents.z) * 1.3, 3, 14);
      sprite.scale.set(width, width * 0.13, 1);
      const ground = this.center.y - this.halfExtents.y;
      sprite.position.set(this.center.x, Math.min(this.center.y + this.halfExtents.y + 2, ground + BAR_MAX_HEIGHT), this.center.z);
      sprite.renderOrder = 10;
      this.scene.add(sprite);
      this.bar = { sprite, canvas, texture };
    }
    const ctx = this.bar.canvas.getContext('2d') as CanvasRenderingContext2D;
    const frac = this.health / this.maxHealth;
    ctx.clearRect(0, 0, 128, 16);
    ctx.fillStyle = 'rgba(10,10,10,0.75)';
    ctx.fillRect(0, 0, 128, 16);
    ctx.fillStyle = frac > 0.5 ? '#5fd15f' : frac > 0.25 ? '#e0c23f' : '#e05f4f';
    ctx.fillRect(2, 2, 124 * frac, 12);
    this.bar.texture.needsUpdate = true;
    this.bar.sprite.visible = true;
    this.barTimer = BAR_SHOW_TIME;
  }

  private removeHealthBar(): void {
    if (!this.bar) return;
    this.scene.remove(this.bar.sprite);
    this.bar.texture.dispose();
    this.bar.sprite.material.dispose();
    this.bar = null;
  }

  private collapse(): void {
    this.destroyed = true;
    this.removeHealthBar();
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
    if (this.bar && this.barTimer > 0) {
      this.barTimer -= dt;
      this.bar.sprite.material.opacity = Math.min(1, this.barTimer / BAR_FADE_TIME);
      if (this.barTimer <= 0) this.bar.sprite.visible = false;
    }

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
