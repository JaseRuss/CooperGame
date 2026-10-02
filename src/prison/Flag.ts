import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const WIDTH = 1.8;
const HEIGHT = 1.1;
/** Hits to shoot it down, and how long it takes to come down and for ours to go up. */
const HP = 3;
const LOWER_TIME = 1.2;
const RAISE_TIME = 2.2;

type State = 'tan' | 'lowering' | 'raising' | 'green';

/** A flag's picture: a field with a big star (tan with a brown star, or green with a white one). */
function flagTexture(field: string, star: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, 128, 80);
  ctx.fillStyle = star;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 28 : 11;
    ctx.lineTo(64 + Math.cos(a) * r, 42 + Math.sin(a) * r);
  }
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The tan flag flying over the barracks. Shoot it three times and it's run down the pole, and
 * a green one goes up in its place.
 */
export class Flag {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT, 10, 4);
  private readonly rest: Float32Array;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly green = flagTexture('#4b7a2e', '#f2f2ea');
  private collider: RAPIER.Collider | null;
  private state: State = 'tan';
  private hp = HP;
  private t = 0;
  private wave = 0;

  constructor(private readonly world: RAPIER.World, private readonly spot: { x: number; z: number; foot: number; top: number }) {
    // Hung from the pole along +X, its top edge at the pole's top.
    this.geometry.translate(WIDTH / 2 + 0.08, -HEIGHT / 2, 0);
    this.rest = Float32Array.from(this.geometry.attributes.position.array as Float32Array);
    this.material = new THREE.MeshStandardMaterial({ map: flagTexture('#c4a468', '#7a5a2e'), side: THREE.DoubleSide, roughness: 0.8 });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.set(spot.x, spot.top - 0.1, spot.z);
    this.mesh.castShadow = true;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // Generous, so it can be hit from the ground well below it.
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(WIDTH / 2 + 0.2, HEIGHT / 2 + 0.25, 0.5).setTranslation(spot.x + WIDTH / 2, spot.top - 0.1 - HEIGHT / 2, spot.z),
      body,
    );
  }

  /** Ours now (the green flag's going up, or up). */
  get captured(): boolean {
    return this.state === 'raising' || this.state === 'green';
  }

  /** A shot hit `collider`: returns null if it wasn't the flag, else whether that hit brought it down. */
  hit(collider: RAPIER.Collider): { down: boolean } | null {
    if (!this.collider || collider.handle !== this.collider.handle) return null;
    this.hp--;
    this.wave += 1.5; // it jerks about
    if (this.hp > 0) return { down: false };
    this.world.removeCollider(this.collider, false);
    this.collider = null;
    this.state = 'lowering';
    this.t = 0;
    return { down: true };
  }

  /** Waves the flag, and runs it down (and ours up). Returns true the moment the green flag's at the top. */
  update(dt: number, time: number): boolean {
    this.wave = Math.max(0, this.wave - dt * 2);
    let raised = false;
    const travel = this.spot.top - this.spot.foot - HEIGHT;
    if (this.state === 'lowering') {
      this.t = Math.min(1, this.t + dt / LOWER_TIME);
      this.mesh.position.y = this.spot.top - 0.1 - travel * this.t;
      if (this.t >= 1) {
        this.state = 'raising';
        this.t = 0;
        this.material.map?.dispose();
        this.material.map = this.green;
        this.material.needsUpdate = true;
      }
    } else if (this.state === 'raising') {
      this.t = Math.min(1, this.t + dt / RAISE_TIME);
      this.mesh.position.y = this.spot.top - 0.1 - travel * (1 - this.t);
      if (this.t >= 1) {
        this.state = 'green';
        raised = true;
      }
    }
    // Ripples running out along the flag, bigger at the free end.
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = this.rest[i * 3];
      const y = this.rest[i * 3 + 1];
      const out = x / WIDTH;
      pos.setZ(i, Math.sin(x * 3.2 - time * 6 + y) * 0.12 * out * (1 + this.wave));
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
    return raised;
  }
}
