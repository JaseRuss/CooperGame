import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { plastic, ARMY_GREEN } from '../utils/plastic';

const LAUNCH_SPEED = 22;
const MAX_SPEED = 95;
const ACCELERATION = 55;
const BASE_TURN_RATE = 1.6; // rad/s, ramps up with age so it tightens in on the target
const MAX_LIFETIME = 14;
const PROXIMITY_FUSE = 3;
const TRAIL_INTERVAL = 0.025;

export type RocketTarget = () => THREE.Vector3 | null;

/** A player-launched homing rocket: climbs out, arcs over and dives onto its target. */
export class HomingRocket {
  readonly mesh = new THREE.Group();
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  private readonly flame: THREE.Mesh;
  private age = 0;
  private trailTimer = 0;
  private lastTarget: THREE.Vector3;

  constructor(
    private readonly scene: THREE.Scene,
    origin: THREE.Vector3,
    launchDir: THREE.Vector3,
    private readonly target: RocketTarget,
    fallbackTarget: THREE.Vector3,
    private readonly exclude: RAPIER.Collider,
  ) {
    this.position = origin.clone();
    this.velocity = launchDir.clone().normalize().multiplyScalar(LAUNCH_SPEED);
    this.lastTarget = fallbackTarget.clone();

    // Built along +Z (nose forward) because Object3D.lookAt aims +Z.
    const body = plastic(0xe8e4d8);
    const nose = plastic(0xc0392b);
    const fins = plastic(ARMY_GREEN);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.z = z;
      m.castShadow = true;
      this.mesh.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(0.24, 0.24, 1.9, 14).rotateX(Math.PI / 2), body, 0);
    add(new THREE.ConeGeometry(0.24, 0.7, 14).rotateX(Math.PI / 2), nose, 1.3);
    add(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 14).rotateX(Math.PI / 2), fins, 0.5);
    for (let i = 0; i < 4; i++) {
      const fin = add(new THREE.BoxGeometry(0.05, 0.55, 0.6), fins, -0.8);
      fin.rotation.z = (i * Math.PI) / 2;
      fin.position.set(Math.cos((i * Math.PI) / 2) * 0.32, Math.sin((i * Math.PI) / 2) * 0.32, -0.8);
    }
    this.flame = add(
      new THREE.ConeGeometry(0.22, 1.1, 10).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      -1.5,
    );

    this.mesh.position.copy(this.position);
    this.mesh.lookAt(this.position.clone().add(this.velocity));
    scene.add(this.mesh);
  }

  /**
   * Advances the rocket. Returns the detonation point once it hits something, reaches its
   * target, or runs out of fuel; otherwise null. `onTrail` is called to emit exhaust smoke.
   */
  update(dt: number, world: RAPIER.World, onTrail: (p: THREE.Vector3) => void): THREE.Vector3 | null {
    this.age += dt;

    const live = this.target();
    if (live) this.lastTarget.copy(live);
    const goal = this.lastTarget;
    const toGoal = goal.clone().sub(this.position);
    const dist = toGoal.length();

    if (dist < PROXIMITY_FUSE) return this.detonate(this.position.clone());

    // Top-attack profile: aim above the target while far away, then dive.
    const flat = Math.hypot(toGoal.x, toGoal.z);
    const aimPoint = goal.clone();
    if (flat > 40) aimPoint.y += Math.min(45, flat * 0.3);

    const desired = aimPoint.sub(this.position).normalize();
    const dir = this.velocity.clone().normalize();
    const angle = dir.angleTo(desired);
    const maxTurn = (BASE_TURN_RATE + this.age * 1.2) * dt;
    if (angle > 1e-4) dir.lerp(desired, Math.min(1, maxTurn / angle)).normalize();

    const speed = Math.min(MAX_SPEED, this.velocity.length() + ACCELERATION * dt);
    this.velocity.copy(dir).multiplyScalar(speed);

    const step = this.velocity.clone().multiplyScalar(dt);
    const stepLen = step.length();
    const hit = world.castRay(new RAPIER.Ray(this.position, dir), stepLen, true, undefined, undefined, this.exclude);
    if (hit) return this.detonate(this.position.clone().addScaledVector(dir, hit.timeOfImpact));

    this.position.add(step);
    this.mesh.position.copy(this.position);
    this.mesh.lookAt(this.position.clone().add(this.velocity));
    this.flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);

    this.trailTimer -= dt;
    while (this.trailTimer <= 0) {
      this.trailTimer += TRAIL_INTERVAL;
      onTrail(this.position.clone().addScaledVector(dir, -1.6));
    }

    if (this.age > MAX_LIFETIME) return this.detonate(this.position.clone());
    return null;
  }

  private detonate(point: THREE.Vector3): THREE.Vector3 {
    this.scene.remove(this.mesh);
    return point;
  }
}
