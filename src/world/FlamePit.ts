import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Building } from './Building';
import type { HitRegistry } from '../combat/HitRegistry';
import { surfaceHeightAt } from './Terrain';
import { PartBuilder, sandbagGeometry, tubeZ } from '../utils/modelKit';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';
import { createFigureMesh } from '../entities/Soldier';

/**
 * A flamethrower pit (zombie mission): a sandbagged hole with a big flame projector on a post
 * and a green soldier crouched behind it, facing out from the Fortress. When zombies come into
 * its cone it hoses them with a roaring jet of fire.
 */

export const FLAME_RANGE = 26;
/** Half the width of the fire cone, radians. */
export const FLAME_HALF_ANGLE = 0.42;
const PIT_HEALTH = 200;
const BURST_TIME = 1.6;
const PAUSE_TIME = 0.6;
const PARTICLES = 16;
const JET_SPEED = 1.8; // loops of the jet per second

const FIRE = new THREE.IcosahedronGeometry(1, 1);
const FIRE_HOT = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
const FIRE_MID = new THREE.MeshBasicMaterial({ color: 0xff8a1e, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
const FIRE_OUT = new THREE.MeshBasicMaterial({ color: 0xd8401a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });

let pitShapes: Map<THREE.Material, THREE.BufferGeometry> | null = null;

/** The pit, the fuel tanks and the projector on its post, facing -Z; built once and shared. */
function shapes(): Map<THREE.Material, THREE.BufferGeometry> {
  if (pitShapes) return pitShapes;
  const p = new PartBuilder();
  const bag = sandbagGeometry(0.7, 0.28);
  const sand = plastic(shade(ARMY_GREEN, 1.35));
  const dark = plastic(shade(ARMY_GREEN, 0.55));
  const metal = plastic(0x5b5f58);
  const red = plastic(0xc0392b);
  // Dug-out floor and two rings of sandbags round it.
  p.add(new THREE.CylinderGeometry(2.9, 2.9, 0.1, 24), plastic(0x5a4a34), 0, 0.02, 0);
  for (let row = 0; row < 3; row++) {
    const r = 3.1 - row * 0.1;
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (row % 2) * 0.16;
      p.add(bag, sand, Math.sin(a) * r, 0.2 + row * 0.36, -Math.cos(a) * r, 0, a);
    }
  }
  // Two fuel tanks with red bands, on a rack at the back, and the hose to the projector.
  for (const s of [-1, 1]) {
    p.add(new THREE.CylinderGeometry(0.42, 0.42, 1.8, 14), metal, s * 0.55, 0.95, 1.7);
    p.add(new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal, s * 0.55, 1.85, 1.7);
    for (const y of [0.5, 1.4]) p.add(new THREE.CylinderGeometry(0.44, 0.44, 0.14, 14), red, s * 0.55, y, 1.7);
  }
  p.add(new THREE.BoxGeometry(1.8, 0.12, 0.6), dark, 0, 0.1, 1.7);
  p.beam(new THREE.Vector3(0, 0.9, 1.3), new THREE.Vector3(0, 1.1, -0.2), 0.12, plastic(0x2a2a2a), true);
  p.beam(new THREE.Vector3(0, 1.1, -0.2), new THREE.Vector3(0, 1.5, -0.9), 0.12, plastic(0x2a2a2a), true);
  // Projector post and swivel.
  p.add(new THREE.CylinderGeometry(0.12, 0.16, 1.4, 8), dark, 0, 0.7, -1.2);
  p.add(new THREE.CylinderGeometry(0.28, 0.28, 0.14, 12), metal, 0, 1.42, -1.2);
  pitShapes = p.buildGeometries();
  return pitShapes;
}

/** The flame projector itself: a fat barrel with cooling rings, a blast shield and a glowing pilot light. */
function buildProjector(): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const metal = plastic(0x5b5f58);
  const dark = plastic(shade(ARMY_GREEN, 0.55));
  p.add(tubeZ(0.2, 0.26, 1.9, 12), metal, 0, 0.12, -0.6);
  for (const z of [-0.2, -0.6, -1.0]) p.add(tubeZ(0.27, 0.27, 0.08, 12), dark, 0, 0.12, z);
  p.add(tubeZ(0.3, 0.18, 0.3, 12), metal, 0, 0.12, -1.65); // nozzle
  p.add(new THREE.BoxGeometry(1.2, 0.8, 0.06), plastic(ARMY_GREEN), 0, 0.2, -0.2); // shield
  p.add(new THREE.BoxGeometry(0.1, 0.3, 0.35), dark, 0, -0.1, 0.35); // grip
  p.add(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0x66ccff }), 0, -0.05, -1.82); // pilot light
  p.buildInto(g);
  return g;
}

export class FlamePit {
  readonly building: Building;
  private readonly projector: THREE.Group;
  private readonly jet = new THREE.Group();
  private readonly flames: THREE.Mesh[] = [];
  /** Which way the fire goes (on the ground plane). */
  readonly direction: THREE.Vector3;
  readonly nozzle: THREE.Vector3;
  private aim = 0;
  private burst = 0;
  private pause = 0;
  private jetTime = 0;

  constructor(world: RAPIER.World, scene: THREE.Scene, hitRegistry: HitRegistry, x: number, z: number, facing: number) {
    const root = new THREE.Group();
    for (const [mat, geo] of shapes()) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    this.projector = buildProjector();
    this.projector.position.set(0, 1.55, -1.2);
    root.add(this.projector);
    // A green soldier crouched behind the projector, working it.
    const gunner = createFigureMesh(1, ARMY_GREEN);
    gunner.position.set(0.1, 0.05, 0.1);
    root.add(gunner);
    root.rotation.y = facing;
    root.position.set(x, surfaceHeightAt(x, z) - 0.15, z);
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    this.building = new Building(world, scene, hitRegistry, root, box.getSize(new THREE.Vector3()).multiplyScalar(0.5), box.getCenter(new THREE.Vector3()), PIT_HEALTH, 0x8a7a5a);
    this.building.faction = 'player';
    this.direction = new THREE.Vector3(-Math.sin(facing), 0, -Math.cos(facing));
    this.nozzle = root.localToWorld(new THREE.Vector3(0, 1.67, -3));

    for (let i = 0; i < PARTICLES; i++) {
      const m = new THREE.Mesh(FIRE, FIRE_HOT);
      this.jet.add(m);
      this.flames.push(m);
    }
    this.jet.visible = false;
    scene.add(this.jet);
  }

  get alive(): boolean {
    return !this.building.destroyed;
  }

  get position(): THREE.Vector3 {
    return this.building.center;
  }

  /**
   * Swings the projector toward the nearest zombie in its cone and fires in bursts. Returns the
   * direction of the jet while it's firing (to burn what's in it), or null.
   */
  update(dt: number, zombies: THREE.Vector3[]): THREE.Vector3 | null {
    if (!this.alive) {
      this.jet.visible = false;
      return null;
    }
    let best: THREE.Vector3 | null = null;
    let bestD = FLAME_RANGE;
    for (const z of zombies) {
      const dx = z.x - this.nozzle.x;
      const dz = z.z - this.nozzle.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const cos = (dx * this.direction.x + dz * this.direction.z) / Math.max(d, 0.01);
      if (cos < Math.cos(FLAME_HALF_ANGLE * 1.2)) continue;
      best = z;
      bestD = d;
    }
    // Track the target (within the cone), or drift back to straight ahead.
    const want = best ? Math.atan2(-(best.x - this.nozzle.x), -(best.z - this.nozzle.z)) - Math.atan2(-this.direction.x, -this.direction.z) : 0;
    const rel = Math.atan2(Math.sin(want), Math.cos(want));
    this.aim += THREE.MathUtils.clamp(THREE.MathUtils.clamp(rel, -FLAME_HALF_ANGLE, FLAME_HALF_ANGLE) - this.aim, -2 * dt, 2 * dt);
    this.projector.rotation.y = this.aim;

    if (this.pause > 0) this.pause -= dt;
    if (best && this.burst <= 0 && this.pause <= 0) this.burst = BURST_TIME;
    const firing = this.burst > 0;
    if (firing) {
      this.burst -= dt;
      if (this.burst <= 0) this.pause = PAUSE_TIME;
    }
    const dir = this.direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.aim);
    this.animateJet(dt, firing, dir);
    return firing ? dir : null;
  }

  /** Balls of fire streaming out along the jet: hot and small at the nozzle, big and red at the end. */
  private animateJet(dt: number, firing: boolean, dir: THREE.Vector3): void {
    this.jet.visible = firing;
    if (!firing) return;
    this.jetTime += dt * JET_SPEED;
    this.flames.forEach((m, i) => {
      const t = (this.jetTime + i / PARTICLES) % 1;
      const along = t * FLAME_RANGE;
      const wobble = Math.sin(i * 12.9 + this.jetTime * 20) * t * 1.6;
      m.position.set(
        this.nozzle.x + dir.x * along - dir.z * wobble,
        this.nozzle.y + Math.sin(t * Math.PI) * 1.2 - t * 1.2 + t * t * 1.5,
        this.nozzle.z + dir.z * along + dir.x * wobble,
      );
      m.scale.setScalar(0.35 + t * 2.4);
      m.material = t < 0.25 ? FIRE_HOT : t < 0.65 ? FIRE_MID : FIRE_OUT;
    });
  }
}
