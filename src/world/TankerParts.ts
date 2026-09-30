import * as THREE from 'three';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';
import { TANKER_PARTS } from './TankerRig';
import { plastic, ARMY_GREEN } from '../utils/plastic';
import { surfaceHeightAt } from './Terrain';

/** Drive within this far of a part (metres, across the ground) to pick it up. */
const PICKUP_RADIUS = 8;
/** The chopper can scoop one up from a little further, flying low over it. */
const CHOPPER_RADIUS = 14;
const CHOPPER_HEIGHT = 10;
const HOVER = 1.3;
const BEAM_HEIGHT = 60;
/** A part drops in from this high. */
const DROP_HEIGHT = 40;

const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const beamMaterial = new THREE.MeshBasicMaterial({ color: 0xffd45a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

/** What picks parts up: the player's position, and whether they're flying low. */
export interface PartCollector {
  position: THREE.Vector3;
  isChopper: boolean;
  heightAboveGround: number;
}

/** A chunky toy version of each part, standing on a yellow pallet, about 2.5 m across. */
function partModel(index: number): THREE.Group {
  const steel = plastic(0x5b5f58);
  const green = plastic(ARMY_GREEN);
  const yellow = plastic(0xe8b824);
  const black = plastic(0x1f201d);
  const red = plastic(0xc0392b);
  const tan = plastic(0x7d8064);
  const p = new PartBuilder();
  p.add(new THREE.BoxGeometry(3, 0.2, 3), yellow, 0, 0.1, 0); // pallet
  switch (index) {
    case 0: // engine block with stacks and a bull bar
      p.add(new THREE.BoxGeometry(2, 1.0, 1.6), green, 0, 0.8, 0);
      p.add(new THREE.BoxGeometry(1.2, 0.6, 1.0), steel, 0, 1.6, 0);
      for (const s of [-1, 1]) p.add(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 8), black, s * 0.7, 2.0, -0.4);
      p.add(new THREE.BoxGeometry(2.4, 0.3, 0.2), steel, 0, 0.5, 1.0);
      break;
    case 1: // the casing: a short fat cylinder with hazard bands
      p.add(tubeZ(1.0, 1.0, 2.2, 20), tan, 0, 1.3, 0);
      for (const s of [-1, 1]) p.add(new THREE.SphereGeometry(1.0, 16, 10), tan, 0, 1.3, s * 1.1, 0, 0, 0, 1, 1, 0.5);
      for (const z of [-0.6, 0.6]) p.add(tubeZ(1.04, 1.04, 0.3, 20), yellow, 0, 1.3, z);
      break;
    case 2: // three red drums
      for (const [x, z] of [[-0.6, -0.4], [0.6, -0.4], [0, 0.5]]) {
        p.add(new THREE.CylinderGeometry(0.5, 0.5, 1.3, 14), red, x, 0.85, z);
        p.add(new THREE.CylinderGeometry(0.52, 0.52, 0.12, 14), yellow, x, 1.55, z);
      }
      break;
    case 3: // the plunger box
      p.add(new THREE.BoxGeometry(1.6, 0.9, 1.3), red, 0, 0.65, 0);
      p.add(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 8), steel, 0, 1.5, 0);
      p.add(tubeX(0.1, 1.2, 8), steel, 0, 2.0, 0);
      break;
    default: // twin-barrel gun on a stand
      p.add(new THREE.CylinderGeometry(0.3, 0.45, 1.0, 10), steel, 0, 0.7, 0);
      p.add(new THREE.BoxGeometry(0.9, 0.6, 1.0), green, 0, 1.5, 0);
      for (const s of [-1, 1]) p.add(tubeZ(0.08, 0.09, 1.6, 8), steel, s * 0.22, 1.5, -1.2);
      break;
  }
  const g = new THREE.Group();
  p.buildInto(g);
  return g;
}

interface Pickup {
  root: THREE.Group;
  body: THREE.Group;
  groundY: number;
  taken: boolean;
  x: number;
  z: number;
  /** Falling out of the sky onto the ruins (it can't be picked up until it lands). */
  fall: number;
}

/**
 * The bomb tanker's parts. Each one drops into the ruins of an enemy base when that base falls:
 * a model on a pallet with a tall beam of light. It stays there until it's collected.
 */
export class TankerParts {
  private readonly pickups: (Pickup | null)[] = TANKER_PARTS.map(() => null);
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {}

  /** Drops the part with this index onto the ground at (x, z). */
  spawn(index: number, x: number, z: number): void {
    if (this.pickups[index]) return;
    const root = new THREE.Group();
    const body = partModel(index);
    body.scale.setScalar(1.25);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.7, 40).rotateX(-Math.PI / 2), ringMaterial);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, BEAM_HEIGHT, 14, 1, true).translate(0, BEAM_HEIGHT / 2, 0), beamMaterial);
    root.add(body, ring, beam);
    const groundY = surfaceHeightAt(x, z);
    root.position.set(x, groundY, z);
    ring.position.y = 0.08;
    body.position.y = HOVER * 0.4 + DROP_HEIGHT;
    this.scene.add(root);
    this.pickups[index] = { root, body, groundY, taken: false, x, z, fall: DROP_HEIGHT };
  }

  /** Which parts have been picked up so far. */
  get taken(): boolean[] {
    return this.pickups.map((p) => p?.taken ?? false);
  }

  /** Which parts have dropped and are lying there (or fallen) for the taking. */
  get lying(): boolean[] {
    return this.pickups.map((p) => !!p && !p.taken);
  }

  /** Where the part with this index lies, or null if it hasn't dropped or has been taken. */
  position(index: number): THREE.Vector3 | null {
    const p = this.pickups[index];
    return p && !p.taken ? new THREE.Vector3(p.x, p.groundY + 2, p.z) : null;
  }

  /** The nearest part lying about, with its number. */
  nearest(from: THREE.Vector3): { index: number; position: THREE.Vector3; distance: number } | null {
    let best: { index: number; position: THREE.Vector3; distance: number } | null = null;
    this.pickups.forEach((p, index) => {
      if (!p || p.taken) return;
      const distance = Math.hypot(p.x - from.x, p.z - from.z);
      if (!best || distance < best.distance) best = { index, position: new THREE.Vector3(p.x, p.groundY + 2, p.z), distance };
    });
    return best;
  }

  /** Spins and bobs the parts; returns the indices the player picked up this frame. */
  update(dt: number, who: PartCollector | null): number[] {
    this.time += dt;
    ringMaterial.opacity = 0.45 + 0.25 * Math.sin(this.time * 4);
    const got: number[] = [];
    this.pickups.forEach((p, i) => {
      if (!p || p.taken) return;
      p.body.rotation.y += dt * 0.9;
      p.fall = Math.max(0, p.fall - (8 + (DROP_HEIGHT - p.fall) * 2.5) * dt);
      p.body.position.y = HOVER * 0.4 + p.fall + (p.fall > 0 ? 0 : Math.sin(this.time * 2 + i) * 0.25);
      if (!who || p.fall > 0) return;
      const across = Math.hypot(who.position.x - p.x, who.position.z - p.z);
      const reach = who.isChopper && who.heightAboveGround > 2 ? across < CHOPPER_RADIUS && who.position.y - p.groundY < CHOPPER_HEIGHT : across < PICKUP_RADIUS && Math.abs(who.position.y - p.groundY) < 6;
      if (!reach) return;
      p.taken = true;
      this.scene.remove(p.root);
      got.push(i);
    });
    return got;
  }
}
