import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { plastic } from '../utils/plastic';
import { PartBuilder, tubeZ } from '../utils/modelKit';

/** Darts per salvo; the pod carries two salvos and rearms at a home base. */
export const AA_SALVO = 6;
export const AA_CAPACITY = 12;
const RIPPLE = 0.1; // seconds between launches in a salvo
const LAUNCH_SPEED = 28;
const MAX_SPEED = 80;
const ACCELERATION = 75;
const SEEK_RATE = 0.8; // rad/s: a very light pull toward the target
const WOBBLE_RATE = 1.4; // rad/s of sideways stagger: how drunk they are
const PROXIMITY_FUSE = 7;
const LIFETIME = 4.5;
const TRAIL_INTERVAL = 0.06;

/** Where a missile is heading: a live position, or null once the target is gone. */
export type AirTrack = () => THREE.Vector3 | null;

let dartShapes: Map<THREE.Material, THREE.BufferGeometry> | null = null;

/** A little white dart with a red nose and grey fins, nose along +Z, about 1.1 m long. */
export function buildDartModel(): THREE.Group {
  if (!dartShapes) {
    const body = plastic(0xf0ece0);
    const red = plastic(0xd0463a);
    const grey = plastic(0x6b7166);
    const p = new PartBuilder();
    p.add(tubeZ(0.09, 0.09, 0.75, 10), body, 0, 0, 0);
    p.add(new THREE.ConeGeometry(0.09, 0.3, 10).rotateX(Math.PI / 2), red, 0, 0, 0.52);
    p.add(tubeZ(0.08, 0.06, 0.1, 8), grey, 0, 0, -0.42);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      p.add(new THREE.BoxGeometry(0.02, 0.2, 0.22), grey, Math.cos(a) * 0.14, Math.sin(a) * 0.14, -0.28, 0, 0, a - Math.PI / 2);
    }
    dartShapes = p.buildGeometries();
  }
  const g = new THREE.Group();
  for (const [mat, geo] of dartShapes) g.add(new THREE.Mesh(geo, mat));
  return g;
}

interface Missile {
  mesh: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  track: AirTrack | null;
  age: number;
  trail: number;
  /** Each missile staggers about on its own: a slow corkscrew plus random lurches. */
  phase: number;
  spin: number;
  lurch: THREE.Vector3;
  lurchTimer: number;
}

/** Where the next missile of a salvo leaves from and which way it's pointing. */
export type Launcher = () => { origin: THREE.Vector3; direction: THREE.Vector3 };

let flame: { geometry: THREE.BufferGeometry; material: THREE.Material } | null = null;

/**
 * The player's "drunken" anti-aircraft missiles: a ripple-fired salvo of small darts that stagger
 * and corkscrew toward their target. They converge as they close in, so most of a salvo finds a
 * helicopter, but a few always wander off and burst in the sky.
 */
export class AAMissiles {
  private readonly missiles: Missile[] = [];
  private pending = 0;
  private rippleTimer = 0;
  private launcher: Launcher | null = null;
  private salvoTrack: AirTrack | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** True while a salvo is still leaving the pod. */
  get firing(): boolean {
    return this.pending > 0;
  }

  /** Ripple-fires `count` darts from `launcher` at `track`. */
  fire(launcher: Launcher, track: AirTrack, count = AA_SALVO): void {
    this.launcher = launcher;
    this.salvoTrack = track;
    this.pending = count;
    this.rippleTimer = 0;
  }

  /**
   * Advances the salvo. `retarget` offers a fresh track when a missile's target is gone;
   * `onBurst` is called where each missile detonates.
   */
  update(
    dt: number,
    world: RAPIER.World,
    exclude: RAPIER.Collider,
    retarget: (from: THREE.Vector3) => AirTrack | null,
    onTrail: (p: THREE.Vector3) => void,
    onLaunch: (origin: THREE.Vector3, direction: THREE.Vector3) => void,
    onBurst: (point: THREE.Vector3) => void,
  ): void {
    if (this.pending > 0 && this.launcher) {
      this.rippleTimer -= dt;
      while (this.pending > 0 && this.rippleTimer <= 0) {
        this.rippleTimer += RIPPLE;
        this.pending--;
        const { origin, direction } = this.launcher();
        this.launch(origin, direction);
        onLaunch(origin, direction);
      }
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      const burst = this.step(m, dt, world, exclude, retarget, onTrail);
      if (burst) {
        this.scene.remove(m.mesh);
        this.missiles.splice(i, 1);
        onBurst(burst);
      }
    }
  }

  private launch(origin: THREE.Vector3, direction: THREE.Vector3): void {
    // Each dart leaves the pod a little askew.
    const dir = direction.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.2, (Math.random() - 0.5) * 0.5)).normalize();
    const mesh = buildDartModel();
    flame ??= {
      geometry: new THREE.ConeGeometry(0.08, 0.5, 8).rotateX(-Math.PI / 2),
      material: new THREE.MeshBasicMaterial({ color: 0xffc050, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    };
    const exhaust = new THREE.Mesh(flame.geometry, flame.material);
    exhaust.position.z = -0.7;
    mesh.add(exhaust);
    mesh.position.copy(origin);
    mesh.lookAt(origin.clone().add(dir));
    this.scene.add(mesh);
    this.missiles.push({
      mesh,
      position: origin.clone(),
      velocity: dir.multiplyScalar(LAUNCH_SPEED),
      track: this.salvoTrack,
      age: 0,
      trail: 0,
      phase: Math.random() * Math.PI * 2,
      spin: (4 + Math.random() * 4) * (Math.random() < 0.5 ? -1 : 1),
      lurch: new THREE.Vector3(),
      lurchTimer: 0,
    });
  }

  private step(
    m: Missile,
    dt: number,
    world: RAPIER.World,
    exclude: RAPIER.Collider,
    retarget: (from: THREE.Vector3) => AirTrack | null,
    onTrail: (p: THREE.Vector3) => void,
  ): THREE.Vector3 | null {
    m.age += dt;
    const dir = m.velocity.clone().normalize();

    let goal = m.track?.() ?? null;
    if (!goal && m.track) {
      // Its helicopter went down: stagger off after another one, if there is one.
      m.track = retarget(m.position);
      goal = m.track?.() ?? null;
    }

    // Straight at the target, or on up the launch line (climbing) with nothing to chase.
    const desired = goal ? goal.clone().sub(m.position) : dir.clone().add(new THREE.Vector3(0, 0.15, 0));
    const dist = goal ? desired.length() : Infinity;
    if (dist < PROXIMITY_FUSE) return m.position.clone();
    desired.normalize();

    // Very light seeking: only a gentle pull toward the target, so the launch aim matters.
    const angle = dir.angleTo(desired);
    if (angle > 1e-4) dir.lerp(desired, Math.min(1, (SEEK_RATE * dt) / angle)).normalize();

    // On top of that, the drunken stagger: a corkscrew and random lurches across its path.
    m.lurchTimer -= dt;
    if (m.lurchTimer <= 0) {
      m.lurchTimer = 0.12 + Math.random() * 0.25;
      m.lurch.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2);
    }
    const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir);
    m.phase += m.spin * dt;
    const stagger = side
      .multiplyScalar(Math.cos(m.phase))
      .addScaledVector(up, Math.sin(m.phase))
      .add(m.lurch.clone().projectOnPlane(dir));
    dir.addScaledVector(stagger, WOBBLE_RATE * dt).normalize();
    const speed = Math.min(MAX_SPEED, m.velocity.length() + ACCELERATION * dt);
    m.velocity.copy(dir).multiplyScalar(speed);

    const stepLen = speed * dt;
    const hit = world.castRay(new RAPIER.Ray(m.position, dir), stepLen, true, undefined, undefined, exclude);
    if (hit) return m.position.clone().addScaledVector(dir, hit.timeOfImpact);

    m.position.addScaledVector(dir, stepLen);
    m.mesh.position.copy(m.position);
    m.mesh.lookAt(m.position.clone().add(dir));

    m.trail -= dt;
    while (m.trail <= 0) {
      m.trail += TRAIL_INTERVAL;
      onTrail(m.position.clone().addScaledVector(dir, -0.8));
    }

    return m.age > LIFETIME ? m.position.clone() : null;
  }
}
