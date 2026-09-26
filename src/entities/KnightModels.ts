import * as THREE from 'three';
import { PartBuilder, loftGeometry, tubeX, tubeZ } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';
import { WOOD, WOOD_DARK } from '../world/Medieval';

/**
 * The knights mission's enemy vehicles, moulded like the army men: an old field cannon wheeled
 * about by two gunners (standing in for the enemy tanks), and a toy dragon (for the helicopters).
 * Geometry is built once per army colour and shared.
 */

type Shapes = Map<THREE.Material, THREE.BufferGeometry>;
const cache = new Map<string, Shapes>();

function shapes(key: string, build: (p: PartBuilder) => void): Shapes {
  let s = cache.get(key);
  if (!s) {
    const p = new PartBuilder();
    build(p);
    s = p.buildGeometries();
    cache.set(key, s);
  }
  return s;
}

function dress(geos: Shapes, parent: THREE.Object3D): void {
  for (const [mat, geo] of geos) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const BRONZE = 0xb08a3a;
const IRON = 0x4a4d52;

// ---------- the cannon ----------

/** Where the cannon's parts sit in the tank rig's space (the hull collider's centre; ground at y = -0.5). */
export const CANNON_LAYOUT = {
  wheelRadius: 0.95,
  wheelX: 1.12,
  axle: new THREE.Vector3(0, 0.45, -0.45),
  /** The gun's trunnions, where it pivots. */
  trunnion: new THREE.Vector3(0, 1.05, -0.45),
  muzzle: -2.05,
};

export interface CannonParts {
  /** Carriage and trail, fixed to the hull. */
  carriage: THREE.Group;
  wheels: THREE.Group[];
  /** The barrel, to go on the barrel pivot (pointing -Z). */
  gun: THREE.Group;
  /** The two gunners pushing the trail. */
  crew: THREE.Group[];
}

/** A spoked wooden wheel with an iron tyre, round the X axis. */
function wheel(p: PartBuilder, r: number): void {
  p.add(new THREE.TorusGeometry(r - 0.06, 0.1, 6, 22).rotateY(Math.PI / 2), plastic(IRON));
  p.add(new THREE.TorusGeometry(r - 0.2, 0.09, 6, 22).rotateY(Math.PI / 2), plastic(WOOD));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    p.beam(v(0, Math.cos(a) * 0.18, Math.sin(a) * 0.18), v(0, Math.cos(a) * (r - 0.2), Math.sin(a) * (r - 0.2)), 0.08, plastic(WOOD));
  }
  p.add(tubeX(0.2, 0.34, 12), plastic(WOOD_DARK));
  p.add(tubeX(0.08, 0.42, 8), plastic(IRON));
}

/**
 * A toy gunner leaning into the push: kettle helmet, quilted tunic, a tabard in the army's colour
 * and both hands on the trail handle in front of him. Feet at y = 0, facing -Z.
 */
function gunner(p: PartBuilder, body: THREE.Material, kit: THREE.Material, step: number): void {
  const lean = -0.42;
  const hip = v(0, 0.92, 0);
  // Legs mid-stride: one planted forward, one pushing off behind.
  const fwd = step > 0 ? 1 : -1;
  for (const [x, footZ] of [[-0.12, -0.3 * fwd], [0.12, 0.42 * fwd]]) {
    const foot = v(x, 0.1, footZ);
    const knee = v(x, 0.5, (hip.z + footZ) / 2 - 0.08);
    p.beam(v(x, hip.y, hip.z), knee, 0.17, body, true);
    p.beam(knee, foot, 0.15, body, true);
    p.add(new THREE.SphereGeometry(0.09, 8, 6), body, knee.x, knee.y, knee.z);
    p.add(new THREE.BoxGeometry(0.15, 0.12, 0.3), kit, x, 0.06, footZ - 0.06);
  }
  // Upper body tipped forward about the hips.
  const up = (x: number, y: number, z: number) => v(x, y, z).applyAxisAngle(v(1, 0, 0), lean).add(hip);
  const put = (g: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Vector3) => p.add(g, mat, at.x, at.y, at.z, lean);
  put(new THREE.BoxGeometry(0.44, 0.56, 0.28), body, up(0, 0.34, 0));
  put(new THREE.BoxGeometry(0.47, 0.72, 0.31), kit, up(0, 0.22, 0)); // tabard
  put(new THREE.BoxGeometry(0.5, 0.08, 0.33), body, up(0, 0.05, 0)); // belt
  put(new THREE.BoxGeometry(0.12, 0.12, 0.05), plastic(0xd9a520), up(0, 0.05, -0.17)); // buckle
  put(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8), body, up(0, 0.66, 0));
  put(new THREE.SphereGeometry(0.13, 10, 8), body, up(0, 0.76, 0));
  put(new THREE.BoxGeometry(0.05, 0.06, 0.06), body, up(0, 0.74, -0.13)); // nose
  // Kettle helmet: a dome with a wide brim.
  put(new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), kit, up(0, 0.8, 0));
  put(new THREE.CylinderGeometry(0.29, 0.3, 0.04, 16), kit, up(0, 0.8, 0));
  // Arms reaching forward and down to the handle.
  for (const s of [-1, 1]) {
    const shoulder = up(s * 0.25, 0.56, 0);
    const hand = v(s * 0.22, 0.95, -0.62);
    const elbow = shoulder.clone().lerp(hand, 0.5).add(v(s * 0.1, -0.06, 0.05));
    p.beam(shoulder, elbow, 0.13, body, true);
    p.beam(elbow, hand, 0.11, body, true);
    p.add(new THREE.SphereGeometry(0.07, 8, 6), body, hand.x, hand.y, hand.z);
  }
}

export function buildCannonParts(color: number): CannonParts {
  const L = CANNON_LAYOUT;
  const armyDark = shade(color, 0.7);
  const carriage = new THREE.Group();
  dress(
    shapes(`cannon-carriage-${color}`, (p) => {
      const wood = plastic(WOOD);
      const woodDark = plastic(WOOD_DARK);
      // Two cheeks running from the axle down to the trail on the ground behind.
      for (const s of [-1, 1]) {
        p.beam(v(s * 0.42, 0.72, -1.1), v(s * 0.3, -0.25, 2.3), 0.2, wood);
        p.add(new THREE.BoxGeometry(0.2, 0.55, 1.2), wood, s * 0.42, 0.8, -0.55);
        p.add(new THREE.BoxGeometry(0.24, 0.1, 0.3), plastic(IRON), s * 0.42, 1.1, -0.45); // cap-square over the trunnion
      }
      for (const z of [-1, 0.5, 1.6]) p.add(new THREE.BoxGeometry(0.8, 0.14, 0.24), woodDark, 0, 0.62 - (z + 1) * 0.3, z);
      p.add(tubeX(0.09, L.wheelX * 2 + 0.2, 8), plastic(IRON), L.axle.x, L.axle.y, L.axle.z);
      // Trail end: a spade and the push handle the gunners hold.
      p.add(new THREE.BoxGeometry(0.8, 0.3, 0.3), woodDark, 0, -0.3, 2.35);
      p.add(new THREE.BoxGeometry(0.8, 0.06, 0.34), plastic(IRON), 0, -0.47, 2.4);
      for (const s of [-1, 1]) p.beam(v(s * 0.32, -0.2, 2.3), v(s * 0.22, 0.45, 2.75), 0.08, woodDark, true);
      p.add(tubeX(0.05, 0.62, 8), woodDark, 0, 0.45, 2.75);
      // Ammunition box on the trail with the army's badge, a rammer and a bucket.
      p.add(new THREE.BoxGeometry(0.7, 0.4, 0.55), plastic(color), 0, 0.2, 1.1, -0.3);
      p.add(new THREE.BoxGeometry(0.74, 0.07, 0.59), plastic(armyDark), 0, 0.4, 1.05, -0.3);
      for (const [x, z] of [[-0.14, 0.95], [0.14, 0.95], [0, 1.2]]) p.add(new THREE.SphereGeometry(0.13, 8, 6), plastic(0x2e3036), x, 0.55, z);
      p.beam(v(0.55, 0.8, 0.9), v(0.4, -0.2, 2.1), 0.07, woodDark, true);
      p.add(new THREE.CylinderGeometry(0.16, 0.16, 0.25, 8), plastic(IRON), 0.52, 0.82, 0.8, 0.4);
      p.add(new THREE.CylinderGeometry(0.2, 0.17, 0.3, 10), wood, -0.62, -0.35, 1.6);
      // A pennant on a staff at the back.
      p.add(new THREE.CylinderGeometry(0.03, 0.035, 2.2, 6), woodDark, -0.5, 0.9, 1.9);
      const flag = new THREE.BufferGeometry();
      flag.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.5, 0, 0, -0.25, 0.9, 0, 0, 0, 0, -0.25, 0.9, 0, -0.5, 0], 3));
      flag.computeVertexNormals();
      p.add(flag, plastic(color), -0.5, 2, 1.9);
    }),
    carriage,
  );
  const wheels = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * L.wheelX, L.axle.y, L.axle.z);
    dress(shapes('cannon-wheel', (p) => wheel(p, L.wheelRadius)), g);
    carriage.add(g);
    return g;
  });
  const gun = new THREE.Group();
  dress(
    shapes('cannon-gun', (p) => {
      const bronze = plastic(BRONZE);
      const dark = plastic(shade(BRONZE, 0.7));
      // Barrel pointing -Z from the trunnions: a swelling breech, rings, a flared muzzle.
      p.add(tubeZ(0.22, 0.33, 2.5, 18), bronze, 0, 0, -0.55);
      p.add(tubeZ(0.3, 0.3, 0.7, 18), bronze, 0, 0, 0.8);
      p.add(new THREE.SphereGeometry(0.3, 16, 10), bronze, 0, 0, 1.15);
      p.add(new THREE.SphereGeometry(0.12, 10, 8), dark, 0, 0, 1.52); // cascabel knob
      for (const z of [-1.7, -0.9, 0.2, 0.6]) p.add(tubeZ(0.3 - (z < 0 ? 0.04 : -0.04), 0.3 - (z < 0 ? 0.04 : -0.04), 0.1, 18), dark, 0, 0, z);
      p.add(tubeZ(0.3, 0.24, 0.3, 18), bronze, 0, 0, -1.9); // muzzle swell
      p.add(new THREE.CircleGeometry(0.17, 14), plastic(0x1c1a18), 0, 0, -2.06, Math.PI);
      p.add(tubeX(0.1, 0.8, 10), dark, 0, 0, 0); // trunnions
      for (const s of [-1, 1]) p.add(new THREE.TorusGeometry(0.1, 0.035, 6, 10, Math.PI).rotateY(Math.PI / 2), dark, s * 0.12, 0.3, 0.1); // lifting dolphins
      p.add(new THREE.SphereGeometry(0.05, 6, 4), plastic(0x2e3036), 0, 0.3, 0.9); // touch hole
    }),
    gun,
  );
  const crew = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.26, -0.5, 3.35);
    dress(
      shapes(`gunner-${color}-${s}`, (p) => gunner(p, plastic(shade(color, 1.15)), plastic(shade(color, 0.72)), s)),
      g,
    );
    carriage.add(g);
    return g;
  });
  return { carriage, wheels, gun, crew };
}

// ---------- the dragon ----------

export interface DragonParts {
  body: THREE.Group;
  wings: THREE.Group[];
  tail: THREE.Group;
  /** The head, to go on the barrel pivot (facing -Z) so it turns to look at what it breathes on. */
  head: THREE.Group;
}

/** Where the dragon's head sits on the airframe (the Tank rig's turret pivot). */
export const DRAGON_NECK = new THREE.Vector3(0, 2.2, -5.4);
/** The head's size on the body (it's modelled small), and where its mouth ends up: fireballs come from there. */
const HEAD_SCALE = 1.3;
export const DRAGON_MOUTH = -2.1 * HEAD_SCALE;

const membraneMats = new Map<number, THREE.MeshPhysicalMaterial>();

/** The plastic, but double-sided, for the wing membranes. */
function membrane(color: number): THREE.MeshPhysicalMaterial {
  let m = membraneMats.get(color);
  if (!m) {
    m = plastic(color).clone();
    m.side = THREE.DoubleSide;
    membraneMats.set(color, m);
  }
  return m;
}

/** A wing spreading along +X from the shoulder (mirror with `s` = -1): bones, claws and a scalloped membrane. */
function wing(p: PartBuilder, color: number, s: number): void {
  const bone = plastic(shade(color, 0.6));
  // Paler, warmer skin between the bones, so the wings stand out against the body.
  const skin = membrane(new THREE.Color(color).lerp(new THREE.Color(0xfff0cc), 0.5).getHex());
  const X = (x: number, y: number, z: number) => v(s * x, y, z);
  const wrist = X(5.6, 0.5, -0.2);
  const elbow = X(2.8, 0.4, 0.6);
  const tips = [X(9.6, 0.1, 0.8), X(8.6, -0.1, 3), X(6.4, -0.2, 4.4)];
  const attach = X(0.4, -0.1, 4);
  p.beam(X(0, 0, 0), elbow, 0.34, bone, true);
  p.beam(elbow, wrist, 0.28, bone, true);
  p.add(new THREE.SphereGeometry(0.22, 8, 6), bone, elbow.x, elbow.y, elbow.z);
  p.add(new THREE.SphereGeometry(0.2, 8, 6), bone, wrist.x, wrist.y, wrist.z);
  p.add(new THREE.ConeGeometry(0.12, 0.6, 6).rotateZ(-s * 1.2), plastic(0xf4efe0), wrist.x + s * 0.2, wrist.y + 0.35, wrist.z - 0.1); // thumb claw
  for (const t of tips) p.beam(wrist, t, 0.14, bone, true);
  // Membrane: fans between the fingers, and from the last finger back to the flank.
  const pts: THREE.Vector3[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pts.push(a, b, c);
  const sag = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().lerp(b, 0.5).add(v(0, -0.1, 0)).lerp(wrist, 0.22); // scalloped trailing edge
  tri(X(0, 0, 0), wrist, tips[0]);
  tri(wrist, tips[0], sag(tips[0], tips[1]));
  tri(wrist, sag(tips[0], tips[1]), tips[1]);
  tri(wrist, tips[1], sag(tips[1], tips[2]));
  tri(wrist, sag(tips[1], tips[2]), tips[2]);
  tri(X(0, 0, 0), wrist, tips[2]);
  tri(X(0, 0, 0), tips[2], sag(tips[2], attach));
  tri(X(0, 0, 0), sag(tips[2], attach), attach);
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  g.computeVertexNormals();
  p.add(g, skin);
}

/**
 * A toy dragon about as big as the gunship: a plump body with a pale ribbed belly, spikes down
 * its back, tucked legs with claws, big bat wings (separate, to flap), a long tail with a spade
 * tip (separate, to swish) and a horned head with a toothy grin.
 */
export function buildDragonParts(color: number): DragonParts {
  const scales = plastic(color);
  const dark = plastic(shade(color, 0.62));
  const belly = plastic(0xf0dc9a);
  const claw = plastic(0xf4efe0);
  const body = new THREE.Group();
  dress(
    shapes(`dragon-body-${color}`, (p) => {
      const trunk = [
        { z: -5.5, w: 1.15, h: 1.2, y: 2.2 },
        { z: -4.6, w: 1.3, h: 1.35, y: 1.8 },
        { z: -3.6, w: 1.8, h: 1.9, y: 1.2 },
        { z: -2.2, w: 2.9, h: 2.7, y: 0.55 },
        { z: 0, w: 3.3, h: 3, y: 0.3 },
        { z: 2.2, w: 2.5, h: 2.3, y: 0.35 },
        { z: 3.6, w: 1.4, h: 1.35, y: 0.55 },
      ];
      p.add(loftGeometry(trunk, 24, 2.2), scales);
      // Pale belly plates under the chest and tummy.
      for (let i = 0; i < 7; i++) {
        const z = -3.6 + i * 1;
        const s = trunk.reduce((a, b) => (Math.abs(b.z - z) < Math.abs(a.z - z) ? b : a));
        p.add(new THREE.BoxGeometry(s.w * 0.62, 0.2, 0.85), belly, 0, s.y - s.h / 2 + 0.05, z, 0.1);
      }
      // Spikes down the neck and back.
      for (let i = 0; i < 9; i++) {
        const z = -5.2 + i * 1.05;
        const y = z < -3 ? 2.2 + (-3 - z) * -0.2 + 0.6 : 1.45 + Math.max(0, 1 - Math.abs(z) / 3) * 0.2;
        const size = 0.55 - Math.abs(z + 0.5) * 0.04;
        p.add(new THREE.ConeGeometry(size * 0.55, size * 1.4, 4), dark, 0, y + (z < -3 ? 0.3 : 0.35), z, -0.35);
      }
      // Legs tucked up in flight, with pale claws.
      for (const s of [-1, 1]) {
        for (const [z, back] of [[-1.6, 0], [2.2, 1]] as const) {
          const hip = v(s * 1.05, -0.2, z);
          const knee = v(s * 1.25, -1.1, z + (back ? -0.2 : 0.6));
          const foot = v(s * 1.15, -1.35, z + (back ? 1 : 1.1));
          p.beam(hip, knee, back ? 0.62 : 0.48, scales, true);
          p.beam(knee, foot, back ? 0.42 : 0.36, scales, true);
          p.add(new THREE.SphereGeometry(back ? 0.34 : 0.27, 8, 6), scales, knee.x, knee.y, knee.z);
          for (const dx of [-0.14, 0, 0.14]) p.add(new THREE.ConeGeometry(0.07, 0.3, 6).rotateX(Math.PI / 2 + 0.5), claw, foot.x + dx, foot.y - 0.08, foot.z + 0.18);
        }
      }
    }),
    body,
  );
  const tail = new THREE.Group();
  tail.position.set(0, 0.55, 3.5);
  dress(
    shapes(`dragon-tail-${color}`, (p) => {
      p.add(
        loftGeometry([
          { z: 0, w: 1.4, h: 1.3, y: 0 },
          { z: 2.5, w: 0.8, h: 0.75, y: 0.2 },
          { z: 5, w: 0.45, h: 0.45, y: 0.5 },
          { z: 7, w: 0.22, h: 0.22, y: 0.9 },
        ], 16, 2.2),
        scales,
      );
      for (let i = 0; i < 5; i++) p.add(new THREE.ConeGeometry(0.3 - i * 0.04, 0.7 - i * 0.08, 4), dark, 0, 0.55 - i * 0.02 + i * 0.12, 0.6 + i * 1.3, -0.4);
      // Spade tip: a flat diamond.
      p.add(new THREE.OctahedronGeometry(0.8), dark, 0, 0.95, 7.5, 0, 0, 0, 0.9, 0.18, 1.1);
    }),
    tail,
  );
  body.add(tail);
  const wings = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 1.0, 1.1, -1.4);
    dress(shapes(`dragon-wing-${color}-${s}`, (p) => wing(p, color, s)), g);
    body.add(g);
    return g;
  });
  const head = new THREE.Group();
  dress(
    shapes(`dragon-head-${color}`, (p) => {
      p.add(
        loftGeometry([
          { z: -2, w: 0.7, h: 0.5, y: -0.05 },
          { z: -1.2, w: 0.85, h: 0.65, y: 0 },
          { z: -0.3, w: 1.15, h: 1.05, y: 0.15 },
          { z: 0.6, w: 1.05, h: 1.05, y: 0.1 },
        ], 18, 2.6),
        scales,
      );
      // Lower jaw hanging a little open, with a hot glow inside and a row of teeth.
      p.add(new THREE.BoxGeometry(0.72, 0.22, 1.6), scales, 0, -0.42, -1.05, 0.18);
      p.add(new THREE.BoxGeometry(0.5, 0.12, 1.2), plastic(0xff6a1a), 0, -0.26, -1.15, 0.1);
      for (let i = 0; i < 4; i++) {
        for (const s of [-1, 1]) p.add(new THREE.ConeGeometry(0.06, 0.2, 5).rotateZ(Math.PI), claw, s * 0.28, -0.25, -1.75 + i * 0.3);
      }
      // Eyes with pupils, brow ridges, nostrils, horns and cheek frills.
      for (const s of [-1, 1]) {
        p.add(new THREE.SphereGeometry(0.17, 10, 8), plastic(0xffd24a), s * 0.44, 0.38, -0.55);
        p.add(new THREE.SphereGeometry(0.08, 8, 6), plastic(0x1c1a18), s * 0.52, 0.4, -0.66);
        p.add(new THREE.BoxGeometry(0.34, 0.1, 0.4), dark, s * 0.42, 0.56, -0.5, 0, 0, s * -0.3);
        p.add(new THREE.SphereGeometry(0.06, 6, 4), plastic(0x1c1a18), s * 0.18, 0.18, -2.02);
        p.add(new THREE.ConeGeometry(0.15, 1.1, 8), claw, s * 0.35, 0.8, 0.45, -1.1, 0, s * -0.3);
        p.add(new THREE.ConeGeometry(0.09, 0.55, 6), claw, s * 0.22, 0.75, 0.05, -1.2, 0, s * -0.2);
        p.add(new THREE.ConeGeometry(0.25, 0.8, 4), dark, s * 0.6, 0, 0.35, 0, 0, s * 1.9);
      }
    }),
    head,
  );
  head.scale.setScalar(HEAD_SCALE);
  return { body, wings, tail, head };
}
