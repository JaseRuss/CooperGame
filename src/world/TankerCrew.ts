import * as THREE from 'three';
import { PartBuilder, tubeZ } from '../utils/modelKit';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';

/** How the bomb tanker's gunners cover their heads: one look per gun post. */
export const GUNNER_LOOKS = 4;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Cached per look (and grip), with the materials shared, so nothing here is disposed.
const shapes = new Map<string, Map<THREE.Material, THREE.BufferGeometry>>();

/**
 * One of the bomb tanker's gunners: a green army man done up as a wasteland road warrior, feet on
 * y = 0, facing -Z, about 1.85 m tall. Legs braced, both hands on the gun's grips at `grip` (x is
 * each hand's offset to the side), a spiked shoulder pad, a bandolier, a jerry can on his back, a
 * scarf blowing out behind, and headgear by `look`: a mohawk and goggles, a spiked leather cap and
 * bandana, a desert hood and goggles, or a riveted welding mask.
 */
export function buildGunner(look: number, grip: THREE.Vector3): THREE.Group {
  const key = `${look % GUNNER_LOOKS}:${grip.x.toFixed(3)},${grip.y.toFixed(3)},${grip.z.toFixed(3)}`;
  let geos = shapes.get(key);
  if (!geos) {
    geos = gunnerParts(look % GUNNER_LOOKS, grip).buildGeometries();
    shapes.set(key, geos);
  }
  const g = new THREE.Group();
  for (const [mat, geo] of geos) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}

function gunnerParts(look: number, grip: THREE.Vector3): PartBuilder {
  // Lighter plastic than the rig so he reads at chase-cam distance; kit in a darker green.
  const skin = plastic(shade(ARMY_GREEN, 1.55));
  const kit = plastic(shade(ARMY_GREEN, 0.7));
  const steel = plastic(0x5a5d58);
  const lens = plastic(0x1b1d1a);
  const rust = plastic(0x9a5a2e);
  const hair = plastic(0xc0392b);
  const p = new PartBuilder();
  const ball = (r: number, at: THREE.Vector3, mat: THREE.Material, sx = 1, sy = sx, sz = sx) =>
    p.add(new THREE.SphereGeometry(r, 10, 8), mat, at.x, at.y, at.z, 0, 0, 0, sx, sy, sz);
  const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
    p.beam(a, b, r * 2, mat, true);
    ball(r, b, mat);
  };

  // Legs braced wide, knees bent, with knee pads and heavy boots.
  for (const s of [-1, 1]) {
    const hip = v(s * 0.11, 0.9, 0.02);
    const knee = v(s * 0.18, 0.5, -0.08);
    const ankle = v(s * 0.21, 0.13, 0.02);
    ball(0.1, hip, skin);
    limb(hip, knee, 0.095, skin);
    limb(knee, ankle, 0.08, skin);
    ball(0.088, knee.clone().add(v(0, 0.01, -0.06)), kit, 1, 1, 0.7);
    p.add(new THREE.BoxGeometry(0.18, 0.16, 0.33), kit, s * 0.21, 0.08, -0.05);
    p.add(new THREE.BoxGeometry(0.19, 0.04, 0.35), lens, s * 0.21, 0.02, -0.05);
  }

  // Torso leaning into the gun, with a belt, buckle and pouches.
  p.add(new THREE.SphereGeometry(0.2, 12, 8), skin, 0, 0.93, 0.02, 0, 0, 0, 1, 0.7, 0.75); // hips
  p.add(new THREE.CylinderGeometry(0.24, 0.19, 0.52, 14), skin, 0, 1.18, -0.01, -0.15, 0, 0, 1, 1, 0.72);
  p.add(new THREE.SphereGeometry(0.24, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin, 0, 1.41, -0.04, -0.15, 0, 0, 1.1, 0.45, 0.72);
  p.add(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 14), kit, 0, 0.95, 0.01, 0, 0, 0, 1, 1, 0.8);
  p.add(new THREE.BoxGeometry(0.09, 0.07, 0.03), steel, 0, 0.95, -0.13);
  for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.08, 0.1, 0.07), kit, s * 0.15, 0.92, -0.08, 0, s * 0.4, 0);

  // Bandolier over one shoulder, with rounds along it, and a strap down the back.
  const bandFrom = v(0.22, 1.41, -0.12);
  const bandTo = v(-0.19, 0.99, -0.17);
  p.beam(bandFrom, bandTo, 0.05, kit);
  for (let i = 1; i < 7; i++) {
    const at = bandFrom.clone().lerp(bandTo, i / 7).add(v(0, 0, -0.03));
    p.add(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 6), steel, at.x, at.y, at.z, 0, 0, 0.9);
  }
  p.beam(v(0.22, 1.41, 0.1), v(-0.19, 0.99, 0.14), 0.05, kit);
  // A jerry can strapped on his back: easy to spot from the deck behind him.
  p.add(new THREE.BoxGeometry(0.3, 0.36, 0.12), rust, 0, 1.2, 0.2, -0.15);
  p.add(new THREE.BoxGeometry(0.07, 0.05, 0.05), steel, 0.08, 1.41, 0.23, -0.15);

  // Spiked pauldron on the left shoulder.
  p.add(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), steel, -0.27, 1.42, -0.04, 0, 0, 0.35);
  for (const [dx, dy, rz] of [[-0.02, 0.12, 0.25], [-0.1, 0.08, 0.9], [0.06, 0.12, -0.2]] as const) {
    p.add(new THREE.ConeGeometry(0.035, 0.15, 6), steel, -0.27 + dx, 1.43 + dy, -0.04, 0, 0, rz);
  }

  // Arms out to the gun's grips, elbows out, a bracer on each forearm.
  for (const s of [-1, 1]) {
    const shoulder = v(s * 0.26, 1.39, -0.05);
    const hand = v(s * grip.x, grip.y, grip.z);
    const elbow = shoulder.clone().lerp(hand, 0.5).add(v(s * 0.1, -0.07, 0.06));
    ball(0.09, shoulder, skin);
    limb(shoulder, elbow, 0.072, skin);
    limb(elbow, hand, 0.064, skin);
    p.beam(elbow.clone().lerp(hand, 0.3), elbow.clone().lerp(hand, 0.75), 0.155, kit, true);
    ball(0.07, hand, skin);
  }

  // Neck and head, and a scarf streaming out behind in the wind.
  p.add(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), skin, 0, 1.49, -0.03);
  const head = v(0, 1.63, -0.05);
  ball(0.115, head, skin);
  ball(0.075, head.clone().add(v(0, -0.07, -0.04)), skin, 1, 0.85, 1); // jaw
  p.add(new THREE.TorusGeometry(0.075, 0.03, 6, 12), kit, 0, 1.51, -0.03, Math.PI / 2);
  p.beam(v(0, 1.52, 0.05), v(0.06, 1.47, 0.3), 0.08, kit);
  p.beam(v(0.06, 1.47, 0.3), v(0.14, 1.36, 0.52), 0.07, kit);
  p.beam(v(-0.03, 1.5, 0.05), v(-0.05, 1.4, 0.36), 0.06, kit);

  const goggles = () => {
    p.add(new THREE.TorusGeometry(0.118, 0.016, 5, 16), kit, head.x, head.y + 0.02, head.z, Math.PI / 2);
    for (const s of [-1, 1]) {
      p.add(tubeZ(0.042, 0.042, 0.05, 10), steel, head.x + s * 0.048, head.y + 0.02, head.z - 0.1);
      p.add(tubeZ(0.034, 0.034, 0.02, 10), lens, head.x + s * 0.048, head.y + 0.02, head.z - 0.127);
    }
  };
  if (look === 0) {
    // War boy: a red mohawk and driving goggles.
    goggles();
    for (let i = 0; i < 6; i++) {
      const a = -0.95 + i * 0.4;
      p.add(new THREE.BoxGeometry(0.035, 0.12 - Math.abs(i - 2.5) * 0.012, 0.07), hair, head.x, head.y + Math.cos(a) * 0.12, head.z + Math.sin(a) * 0.12, a);
    }
  } else if (look === 1) {
    // Road warrior: a studded leather cap with spikes, and a bandana over his face.
    p.add(new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), kit, head.x, head.y + 0.005, head.z);
    for (const [dx, dz] of [[0, 0], [-0.06, 0.03], [0.06, 0.03]] as const) {
      p.add(new THREE.ConeGeometry(0.025, 0.11, 6), steel, head.x + dx, head.y + 0.16 - Math.abs(dx) * 0.4, head.z + dz, 0, 0, -dx * 4);
    }
    p.add(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), hair, head.x, head.y - 0.03, head.z - 0.035, 0, 0, 0, 1.12, 1, 1);
    p.add(new THREE.ConeGeometry(0.06, 0.12, 4), hair, head.x, head.y - 0.16, head.z - 0.09, Math.PI + 0.25, Math.PI / 4, 0);
  } else if (look === 2) {
    // Desert scavenger: a wrapped hood with goggles and a trailing tail.
    p.add(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), rust, head.x, head.y - 0.005, head.z + 0.015);
    p.add(new THREE.TorusGeometry(0.12, 0.028, 6, 14), rust, head.x, head.y - 0.05, head.z + 0.01, Math.PI / 2 + 0.3);
    p.beam(v(0, head.y + 0.02, head.z + 0.14), v(-0.04, head.y - 0.1, head.z + 0.42), 0.07, rust);
    goggles();
  } else {
    // Welder: a riveted iron face mask with a slit, and a crest of spikes.
    p.add(new THREE.BoxGeometry(0.21, 0.22, 0.05), steel, head.x, head.y - 0.02, head.z - 0.115);
    p.add(new THREE.BoxGeometry(0.16, 0.025, 0.02), lens, head.x, head.y + 0.02, head.z - 0.142);
    for (const s of [-1, 1]) for (const dy of [0.07, -0.1]) ball(0.012, v(head.x + s * 0.085, head.y + dy, head.z - 0.142), lens);
    for (let i = 0; i < 4; i++) {
      const a = -0.6 + i * 0.4;
      p.add(new THREE.ConeGeometry(0.026, 0.12, 6), steel, head.x, head.y + Math.cos(a) * 0.14, head.z + Math.sin(a) * 0.14, a);
    }
  }
  return p;
}
