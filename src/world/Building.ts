import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import type { HitRegistry } from '../combat/HitRegistry';
import type { Faction } from '../entities/Tank';

const COLLAPSE_DURATION = 1.1;
const DEBRIS_LIFETIME = 5;
const DEBRIS_COUNT = 7;
/** How long a health bar stays up after a hit, and how long it takes to fade. */
const BAR_SHOW_TIME = 3.5;
const BAR_FADE_TIME = 0.8;
const BAR_MAX_HEIGHT = 24; // above the ground, so skyscraper bars stay in view

/** Buildings this tough (several shells) crack where they're hit; a shell on a crack does double damage. */
const CRACK_MIN_HEALTH = 100;
/** Only a real shell cracks a wall (not rifle rounds or the chin gun). */
const CRACK_MIN_DAMAGE = 15;
const MAX_CRACKS = 3;
const CRACK_BONUS = 2;
const CRACK_VARIANTS = 3;

/** How far the crack decal reaches in and out of the wall (metres, in total): wraps round a corner within about half this. */
const CRACK_DEPTH = 3;

let crackMaterials: THREE.MeshBasicMaterial[] | null = null;
const crackGeometry = new THREE.PlaneGeometry(1, 1);

/**
 * A jagged crack drawn on a canvas so it reads from across a base: a wide hot-orange halo, then the
 * splits drawn three times over (a dark edge, an orange body, a yellow-white core), so they glow
 * like broken glass with light behind it rather than looking like thin pencil lines.
 */
function crackTexture(seed: number): THREE.CanvasTexture {
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const size = 512;
  const mid = size / 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const glow = ctx.createRadialGradient(mid, mid, 6, mid, mid, mid * 0.85);
  glow.addColorStop(0, 'rgba(255,190,60,0.95)');
  glow.addColorStop(0.35, 'rgba(255,120,30,0.55)');
  glow.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The splits, as polylines: arms from the middle, forking as they go.
  const lines: { pts: [number, number][]; width: number }[] = [];
  const branch = (x: number, y: number, angle: number, width: number, depth: number) => {
    const pts: [number, number][] = [[x, y]];
    const steps = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < steps; i++) {
      angle += (rand() - 0.5) * 0.9;
      x += Math.cos(angle) * (22 + rand() * 20);
      y += Math.sin(angle) * (22 + rand() * 20);
      pts.push([x, y]);
    }
    lines.push({ pts, width });
    if (depth > 0) {
      branch(x, y, angle + 0.6, width * 0.65, depth - 1);
      if (rand() > 0.35) branch(x, y, angle - 0.7, width * 0.6, depth - 1);
    }
  };
  const arms = 6 + Math.floor(rand() * 2);
  for (let i = 0; i < arms; i++) branch(mid, mid, (i / arms) * Math.PI * 2 + rand() * 0.5, 20, 2);
  const stroke = (color: string, extra: number, scale: number) => {
    ctx.strokeStyle = color;
    for (const { pts, width } of lines) {
      ctx.lineWidth = Math.max(2, width * scale + extra);
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
    }
  };
  stroke('#1a0f08', 8, 1); // dark edge
  stroke('#ff7a1c', 0, 0.8); // orange body
  stroke('#fff3b0', 0, 0.3); // hot core
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function crackMaterial(): THREE.MeshBasicMaterial {
  crackMaterials ??= Array.from(
    { length: CRACK_VARIANTS },
    (_, i) =>
      new THREE.MeshBasicMaterial({
        map: crackTexture(i + 1),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
  );
  return crackMaterials[Math.floor(Math.random() * CRACK_VARIANTS)];
}

/**
 * A crack on a building's wall: where it is and how close a shell has to land to it. It's made of
 * one or more meshes: a decal cut from the building's own surface (so it follows the walls, wraps
 * round edges and stops where the model stops), or a flat square if there was no surface to cut.
 */
interface Crack {
  meshes: THREE.Mesh[];
  position: THREE.Vector3;
  radius: number;
}

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
  /** Set by strike(): the last shell landed on a crack and did double damage. */
  lastStrikeOnCrack = false;
  private readonly cracks: Crack[] = [];

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

  /**
   * A shell hit at `point` travelling along `dir`: normal damage, instant destruction on a weak
   * point, or double damage on a crack. A tough building cracks where the first shell lands and
   * again each time it loses another quarter of its health.
   */
  strike(amount: number, point: THREE.Vector3, dir: THREE.Vector3): CritSpot | null {
    this.lastStrikeOnCrack = false;
    const crit = this.critAt(point, dir);
    if (crit) {
      this.destroyByCritical();
      return crit;
    }
    const crackable = this.crackable && amount >= CRACK_MIN_DAMAGE;
    const onCrack = crackable && this.crackAt(point, dir);
    this.lastStrikeOnCrack = onCrack;
    this.takeDamage(onCrack ? amount * CRACK_BONUS : amount);
    if (crackable && !onCrack && !this.destroyed) {
      const wanted = Math.min(MAX_CRACKS, 1 + Math.floor((1 - this.health / this.maxHealth) * 4));
      if (this.cracks.length < wanted) this.addCrack(point, dir);
    }
    return null;
  }

  /** Tough enough to crack, and not something with its own weak point (a bunker's slit) or a fuel tank. */
  private get crackable(): boolean {
    return this.maxHealth >= CRACK_MIN_HEALTH && !this.isFuel && this.critSpots.length === 0 && !this.locked && !this.destroyed;
  }

  /** True when a shell entering at `point` along `dir` passes close by a crack (for double damage). */
  crackAt(point: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (this.cracks.length === 0 || !this.crackable) return false;
    const d = dir.clone().normalize();
    const reach = this.halfExtents.length() * 2;
    const line = new THREE.Line3(point.clone().addScaledVector(d, -2), point.clone().addScaledVector(d, reach));
    const closest = new THREE.Vector3();
    // The collider is a box round the whole model, so follow the shell's path on to the wall itself.
    return this.cracks.some((c) => line.closestPointToPoint(c.position, true, closest).distanceTo(c.position) < c.radius);
  }

  /** Puts a crack on the wall where a shell entering at `point` along `dir` meets the model. */
  private addCrack(point: THREE.Vector3, dir: THREE.Vector3): void {
    const d = dir.clone().normalize();
    const ray = new THREE.Raycaster(point.clone().addScaledVector(d, -2), d, 0, this.halfExtents.length() * 2 + 2);
    const hit = ray.intersectObject(this.mesh, true).find((h) => h.face);
    let at: THREE.Vector3;
    let normal: THREE.Vector3;
    let onModel = false;
    if (hit?.face) {
      at = hit.point;
      normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (normal.dot(d) > 0) normal.negate(); // face the way the shell came from
      onModel = true;
    } else {
      // The collider is a box round the whole model, and it's bigger than the model, so a shell
      // can hit the box in empty air: put the crack on the nearest bit of the model instead.
      // Walls and roofs that face the shooter come first: a crack on a roof behind a parapet can't be seen.
      const near = this.nearestSurface(point, d.clone().negate()) ?? this.nearestSurface(point, null);
      if (near) {
        at = near.point;
        normal = near.normal;
        onModel = true;
      } else {
        // Nothing close by at all: the face of the collider box the shell struck.
        at = point.clone();
        normal = new THREE.Vector3();
      }
    }
    if (!onModel) {
      const rel = point.clone().sub(this.center);
      const ax = Math.abs(rel.x) / this.halfExtents.x;
      const ay = Math.abs(rel.y) / this.halfExtents.y;
      const az = Math.abs(rel.z) / this.halfExtents.z;
      normal = ax >= ay && ax >= az ? new THREE.Vector3(Math.sign(rel.x), 0, 0) : ay >= az ? new THREE.Vector3(0, Math.sign(rel.y), 0) : new THREE.Vector3(0, 0, Math.sign(rel.z));
    }
    // Big enough to spot from the range you shoot at: about half the building's smallest dimension.
    const smallest = Math.min(this.halfExtents.x, this.halfExtents.y, this.halfExtents.z) * 2;
    const size = THREE.MathUtils.clamp(smallest * 0.55, 3.5, 9);
    const meshes = onModel ? this.crackDecal(at, normal, size) : [];
    if (meshes.length === 0) {
      // No surface to cut a decal from (the shell missed the model): a flat square on the collider's face.
      const mesh = new THREE.Mesh(crackGeometry, crackMaterial());
      mesh.position.copy(at).addScaledVector(normal, 0.06);
      mesh.lookAt(mesh.position.clone().add(normal));
      mesh.rotateZ(Math.random() * Math.PI * 2);
      mesh.scale.setScalar(size);
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    this.cracks.push({ meshes, position: at.clone(), radius: Math.max(2.2, size * 0.6) });
  }

  /**
   * The point on the model's surface nearest `p` (within 15 m), and which way that surface faces
   * (toward `p`). With `facing` (a unit vector toward the shooter), only surfaces that face that
   * way count. Searches every triangle of the model once, when a crack is added.
   */
  nearestSurface(p: THREE.Vector3, facing: THREE.Vector3 | null = null): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    this.mesh.updateWorldMatrix(true, true);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const tri = new THREE.Triangle();
    const closest = new THREE.Vector3();
    const point = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const n = new THREE.Vector3();
    const out = new THREE.Vector3();
    let best = 15 * 15;
    let found = false;
    this.mesh.traverse((o) => {
      const part = o as THREE.Mesh;
      if (!part.isMesh || !part.geometry.attributes.position) return;
      const pos = part.geometry.attributes.position;
      const index = part.geometry.index;
      const count = index ? index.count : pos.count;
      for (let i = 0; i < count; i += 3) {
        a.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(part.matrixWorld);
        b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1).applyMatrix4(part.matrixWorld);
        c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2).applyMatrix4(part.matrixWorld);
        tri.set(a, b, c);
        tri.closestPointToPoint(p, closest);
        const d = closest.distanceToSquared(p);
        if (d >= best) continue;
        tri.getNormal(n);
        out.subVectors(p, closest);
        if (n.dot(out) < 0) n.negate(); // face out toward p
        if (facing && n.dot(facing) < 0.3) continue;
        best = d;
        found = true;
        point.copy(closest);
        normal.copy(n);
      }
    });
    if (!found) return null;
    return { point, normal };
  }

  /**
   * The crack projected onto the building's own surface at `at` (facing `normal`), `size` metres
   * across: one decal mesh for each part of the model it touches, each cut to that part's triangles,
   * so it hugs the walls and stops at the edges instead of hanging in the air.
   */
  private crackDecal(at: THREE.Vector3, normal: THREE.Vector3, size: number): THREE.Mesh[] {
    this.mesh.updateWorldMatrix(true, true);
    const helper = new THREE.Object3D();
    helper.position.copy(at);
    helper.lookAt(at.clone().add(normal));
    const orientation = new THREE.Euler().copy(helper.rotation);
    orientation.z = Math.random() * Math.PI * 2; // a random spin round the wall's normal
    const decalSize = new THREE.Vector3(size, size, CRACK_DEPTH);
    const material = crackMaterial();
    const box = new THREE.Box3();
    const out: THREE.Mesh[] = [];
    this.mesh.traverse((o) => {
      const part = o as THREE.Mesh;
      if (!part.isMesh || !part.geometry.attributes.position) return;
      if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
      box.copy(part.geometry.boundingBox as THREE.Box3).applyMatrix4(part.matrixWorld);
      if (box.distanceToPoint(at) > size * 0.75) return; // nowhere near this part
      const geometry = new DecalGeometry(part, at, orientation, decalSize);
      if (geometry.attributes.position.count === 0) {
        geometry.dispose();
        return;
      }
      const decal = new THREE.Mesh(geometry, material);
      decal.renderOrder = 2;
      this.scene.add(decal);
      out.push(decal);
    });
    return out;
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
    // (The materials and the fallback square are shared; each decal has its own geometry to dispose.)
    for (const c of this.cracks) {
      for (const m of c.meshes) {
        this.scene.remove(m);
        if (m.geometry !== crackGeometry) m.geometry.dispose();
      }
    }
    this.cracks.length = 0;
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
