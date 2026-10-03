import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { plastic } from '../utils/plastic';

/** How long the portcullis takes to wind up, and how high it goes (into the gatehouse's arch). */
const RAISE_TIME = 2.6;
const RISE = 4.4;

function bars(x0: number, x1: number, z: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const steel = plastic(0x3e4246);
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (let x = x0 + 0.15; x < x1; x += 0.3) {
    const m = new THREE.Mesh(box, steel);
    m.position.set(x, height / 2, z);
    m.scale.set(0.08, height, 0.08);
    g.add(m);
  }
  for (const y of [0.15, height / 2, height - 0.15]) {
    const m = new THREE.Mesh(box, steel);
    m.position.set((x0 + x1) / 2, y, z);
    m.scale.set(x1 - x0, 0.12, 0.12);
    g.add(m);
  }
  for (const m of g.children) (m as THREE.Mesh).castShadow = true;
  return g;
}

/**
 * The prison's sea gate: an iron portcullis in the north wall, chained shut with a big padlock
 * on the yard side. Shoot the padlock and the gate winds up into the gatehouse, which is the
 * way out to the beach and the jetty (and a noisy one).
 */
export class SeaGate {
  readonly group = new THREE.Group();
  private collider: RAPIER.Collider | null;
  private lockCollider: RAPIER.Collider | null;
  private readonly lock: THREE.Mesh;
  private readonly lockBody: THREE.Group;
  private raise = -1;

  constructor(private readonly world: RAPIER.World, private readonly spec: { x0: number; x1: number; z: number; height: number }) {
    this.lockBody = bars(spec.x0, spec.x1, spec.z, spec.height);
    this.group.add(this.lockBody);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const mx = (spec.x0 + spec.x1) / 2;
    this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid((spec.x1 - spec.x0) / 2, spec.height / 2, 0.1).setTranslation(mx, spec.height / 2, spec.z), body);
    // The padlock hangs on a chain across the middle, on the yard side, with a dark bar through it.
    const gold = plastic(0xe0b020);
    this.lock = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.2), gold);
    this.lock.position.set(mx, 1.6, spec.z + 0.28);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 6, 14, Math.PI), plastic(0x8a9096));
    shackle.position.set(0, 0.17, 0);
    this.lock.add(shackle);
    const chain = new THREE.Mesh(new THREE.BoxGeometry(spec.x1 - spec.x0 - 0.3, 0.07, 0.07), plastic(0x6a6e72));
    chain.position.set(mx, 1.6, spec.z + 0.12);
    this.lockBody.add(chain, this.lock);
    this.lockCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.25, 0.2).setTranslation(mx, 1.6, spec.z + 0.28), body);
  }

  get opened(): boolean {
    return this.raise >= 0;
  }

  get position(): THREE.Vector3 {
    return new THREE.Vector3((this.spec.x0 + this.spec.x1) / 2, 1.6, this.spec.z);
  }

  /** True for the gate's colliders (the nav graph looks through them). */
  isGate(c: RAPIER.Collider): boolean {
    return c.handle === this.collider?.handle || c.handle === this.lockCollider?.handle;
  }

  /** A rifle shot hit `collider`: true if it was the padlock, which is now shot off. */
  hit(collider: RAPIER.Collider): boolean {
    if (this.raise >= 0 || collider.handle !== this.lockCollider?.handle) return false;
    this.raise = 0;
    this.lock.visible = false;
    if (this.lockCollider) this.world.removeCollider(this.lockCollider, false);
    this.lockCollider = null;
    if (this.collider) this.world.removeCollider(this.collider, false);
    this.collider = null;
    return true;
  }

  update(dt: number): void {
    if (this.raise < 0 || this.raise >= 1) return;
    this.raise = Math.min(1, this.raise + dt / RAISE_TIME);
    this.lockBody.position.y = RISE * this.raise * this.raise * (3 - 2 * this.raise);
  }
}
