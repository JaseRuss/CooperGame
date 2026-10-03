import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic } from '../utils/plastic';
import type { GearId, GearSpot } from './Facility';

/** What each piece of gear is, for the checklist. */
export const GEAR_INFO: Record<GearId, { name: string; what: string }> = {
  raincoats: { name: 'Raincoats', what: 'to stitch the raft from' },
  jackets: { name: 'Life jackets', what: 'so a hit from the air does not sink you' },
  pump: { name: 'Bellows pump', what: 'to blow the raft up' },
  paddles: { name: 'Paddles', what: 'to get across before the sun comes up' },
  cement: { name: 'Contact cement', what: 'to seal the raft' },
};

const PICKUP_RANGE = 1.7;
const BEAM_HEIGHT = 9;

interface Item {
  readonly spot: GearSpot;
  readonly group: THREE.Group;
  readonly model: THREE.Group;
  taken: boolean;
}

/** One piece of gear, modelled in plastic: about a metre across, standing on the ground at the origin. */
function buildModel(id: GearId): THREE.Group {
  const group = new THREE.Group();
  const b = new PartBuilder();
  const yellow = plastic(0xe6b92c);
  const olive = plastic(0x5e6b34);
  const orange = plastic(0xe8601c);
  const cream = plastic(0xe8e0c8);
  const steel = plastic(0x8a9096);
  const wood = plastic(0x8a6a3e);
  const dark = plastic(0x24262a);
  const red = plastic(0xb8302a);
  if (id === 'raincoats') {
    // A canvas kit bag with a bundle of folded yellow raincoats on top.
    b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14).rotateZ(Math.PI / 2), olive, 0, 0.32, 0);
    b.add(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 14).rotateZ(Math.PI / 2), dark, 0.3, 0.32, 0);
    for (let i = 0; i < 4; i++) b.add(new THREE.BoxGeometry(0.8, 0.09, 0.55), i % 2 ? yellow : plastic(0xd9a21c), 0, 0.68 + i * 0.1, 0, 0, i * 0.12, 0);
    b.add(new THREE.BoxGeometry(0.05, 0.05, 0.9), dark, 0.1, 0.84, 0, 0, 0, 0);
  } else if (id === 'jackets') {
    // A pile of orange life jackets with white straps.
    for (let i = 0; i < 3; i++) {
      const y = 0.12 + i * 0.2;
      b.add(new THREE.BoxGeometry(0.55, 0.16, 0.42), orange, 0, y, 0, 0, i * 0.5, 0);
      b.add(new THREE.BoxGeometry(0.2, 0.17, 0.44), orange, 0.3, y, 0, 0, i * 0.5, 0);
      b.add(new THREE.BoxGeometry(0.2, 0.17, 0.44), orange, -0.3, y, 0, 0, i * 0.5, 0);
      b.add(new THREE.BoxGeometry(0.58, 0.04, 0.1), cream, 0, y + 0.09, 0, 0, i * 0.5, 0);
    }
  } else if (id === 'pump') {
    // A squeezebox: wooden end boards and a red-and-cream bellows, with a hose coiled off it.
    for (const z of [-0.42, 0.42]) b.add(new THREE.BoxGeometry(0.52, 0.5, 0.05), wood, 0, 0.4, z);
    for (let i = 0; i < 8; i++) b.add(new THREE.BoxGeometry(0.46, 0.44, 0.07), i % 2 ? red : cream, 0, 0.4, -0.34 + i * 0.097);
    b.add(new THREE.BoxGeometry(0.12, 0.06, 0.2), dark, 0, 0.7, -0.5);
    b.add(new THREE.TorusGeometry(0.2, 0.035, 8, 20), steel, 0.5, 0.06, 0.1, Math.PI / 2, 0, 0);
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8).rotateZ(Math.PI / 2), steel, 0.31, 0.12, 0.1);
  } else if (id === 'paddles') {
    // Two paddles hacked out of plywood, leant on a crate.
    b.add(new THREE.BoxGeometry(0.5, 0.4, 0.4), wood, 0, 0.2, 0);
    for (const [x, tilt] of [[-0.12, 0.28], [0.14, -0.2]] as const) {
      b.add(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), wood, x, 0.85, 0.28, tilt, 0, 0);
      b.add(new THREE.BoxGeometry(0.26, 0.5, 0.03), plastic(0xb08a52), x, 1.5 + (tilt > 0 ? 0 : 0.05), 0.28 + tilt * 0.4, tilt, 0, 0);
    }
  } else {
    // A big tin of contact cement with a brush resting on the lid.
    b.add(new THREE.CylinderGeometry(0.24, 0.24, 0.42, 16), steel, 0, 0.21, 0);
    b.add(new THREE.CylinderGeometry(0.245, 0.245, 0.14, 16), red, 0, 0.22, 0);
    b.add(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 16), dark, 0, 0.44, 0);
    b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6).rotateZ(Math.PI / 2), wood, 0.05, 0.48, 0.05);
    b.add(new THREE.BoxGeometry(0.1, 0.03, 0.08), dark, 0.28, 0.48, 0.05);
  }
  b.buildInto(group);
  return group;
}

/**
 * The escape gear lying about the prison, as at Alcatraz in 1962: raincoats for the raft, life
 * jackets, a squeezebox for a pump, paddles and contact cement. Each is marked with a tall
 * golden beam (so it can be found in the dark from across the yard); walk over one to take it.
 */
export class Gear {
  readonly group = new THREE.Group();
  private readonly items: Item[] = [];
  private readonly beamMaterial = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

  constructor(spots: GearSpot[]) {
    const beam = new THREE.CylinderGeometry(0.45, 0.45, BEAM_HEIGHT, 16, 1, true).translate(0, BEAM_HEIGHT / 2, 0);
    const ring = new THREE.RingGeometry(0.9, 1.1, 28).rotateX(-Math.PI / 2);
    for (const spot of spots) {
      const group = new THREE.Group();
      group.position.set(spot.x, 0, spot.z);
      const model = buildModel(spot.id);
      model.scale.setScalar(1.25);
      const b = new THREE.Mesh(beam, this.beamMaterial);
      const r = new THREE.Mesh(ring, this.ringMaterial);
      r.position.y = 0.06;
      group.add(model, b, r);
      this.group.add(group);
      this.items.push({ spot, group, model, taken: false });
    }
  }

  get total(): number {
    return this.items.length;
  }

  get collected(): GearId[] {
    return this.items.filter((i) => i.taken).map((i) => i.spot.id);
  }

  has(id: GearId): boolean {
    return this.items.some((i) => i.spot.id === id && i.taken);
  }

  get complete(): boolean {
    return this.items.every((i) => i.taken);
  }

  /** What's still to find, in the order it's listed. */
  get missing(): GearId[] {
    return this.items.filter((i) => !i.taken).map((i) => i.spot.id);
  }

  /** The nearest piece still lying about, or null. */
  nearest(from: THREE.Vector3): THREE.Vector3 | null {
    let best: Item | null = null;
    let bestD = Infinity;
    for (const i of this.items) {
      const d = Math.hypot(i.spot.x - from.x, i.spot.z - from.z);
      if (!i.taken && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best ? new THREE.Vector3(best.spot.x, 1.2, best.spot.z) : null;
  }

  /** Spins and bobs the gear; returns the piece the player's just walked over (if any). */
  update(time: number, player: THREE.Vector3 | null): GearId | null {
    let got: GearId | null = null;
    for (const i of this.items) {
      if (i.taken) continue;
      i.model.rotation.y = time * 0.9;
      i.model.position.y = 0.12 + Math.sin(time * 2.2 + i.spot.x) * 0.08;
      if (player && !got && Math.hypot(i.spot.x - player.x, i.spot.z - player.z) < PICKUP_RANGE && Math.abs(player.y) < 2) {
        i.taken = true;
        i.group.visible = false;
        got = i.spot.id;
      }
    }
    this.beamMaterial.opacity = 0.17 + Math.sin(time * 3) * 0.05;
    return got;
  }
}
