import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';
import { SITES } from './Landmarks';
import { MOAT_LEVEL } from './Terrain';
import { CAUSEWAY_HALF, MOAT_INNER, MOAT_OUTER, MOAT_OUTER_CORE, inMoat } from './MoatShape';
import { KNIGHTS } from '../core/config';

/** The water's grid: cells this big, kept where their middle is over the moat. */
const WATER_CELL = 3;
/**
 * Loungers drift along the middle of the channel, curving round the corners with it, and turn
 * back before the causeways. The line rounds off round the same square as the outer bank.
 */
const DRIFT_RADIUS = 34;
const DRIFT_END = CAUSEWAY_HALF + 6;
const LOUNGERS_PER_SIDE = 4;
/** A shell or blast this close tips a lounger out of his ring (grows with the blast). */
const TIP_RADIUS = 6;
const TIP_TIME = 3.2;
const JAM_RADIUS = 3.5;
const JAM_TIME = 10;
const RING_COLORS = [0xff6fa8, 0xffd23a, 0x39c6e0, 0xff8a2a];
const RAIL_WOOD = KNIGHTS ? 0x7a5a36 : 0x8a6a44;
/** Big enough to spot from the tank (the ring's about 4 m across). */
const LOUNGER_SCALE = 1.4;

interface Lounger {
  root: THREE.Group;
  /** The soldier, hidden while he's under after being tipped out. */
  figure: THREE.Group;
  blob: THREE.Mesh;
  /** Which half of the moat (east +1, west -1), and how far along its U-shaped path. */
  side: 1 | -1;
  along: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
  spin: number;
  tipTime: number;
  jamTime: number;
  splashTimer: number;
}

/**
 * One half's drift line (the east half; the west is its mirror image): along the +z arm, round the
 * corner, down the side, round the other corner and back along the -z arm.
 */
const DRIFT_PATH: { x: number; z: number; at: number }[] = (() => {
  const c = MOAT_OUTER_CORE;
  const r = DRIFT_RADIUS;
  const pts: { x: number; z: number }[] = [{ x: DRIFT_END, z: c + r }];
  const arc = (cz: number, from: number, to: number) => {
    for (let i = 0; i <= 8; i++) {
      const a = from + ((to - from) * i) / 8;
      pts.push({ x: c + Math.cos(a) * r, z: cz + Math.sin(a) * r });
    }
  };
  arc(c, Math.PI / 2, 0);
  arc(-c, 0, -Math.PI / 2);
  pts.push({ x: DRIFT_END, z: -(c + r) });
  let at = 0;
  return pts.map((p, i) => {
    if (i > 0) at += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    return { ...p, at };
  });
})();
const PATH_LENGTH = DRIFT_PATH[DRIFT_PATH.length - 1].at;

/** How far `along` one half's drift line (east half +1, west half -1, mirrored). */
function pathPoint(side: 1 | -1, along: number): { x: number; z: number } {
  let i = 1;
  while (i < DRIFT_PATH.length - 1 && DRIFT_PATH[i].at < along) i++;
  const a = DRIFT_PATH[i - 1];
  const b = DRIFT_PATH[i];
  const t = b.at > a.at ? Math.min(1, Math.max(0, (along - a.at) / (b.at - a.at))) : 0;
  return { x: side * (a.x + (b.x - a.x) * t), z: a.z + (b.z - a.z) * t };
}

/**
 * A soldier lounging in a rubber ring: leaning back with his hands behind his head, legs over the
 * front of the ring and boots in the water, some in sunglasses. Faces -Z; the water line is y = 0.
 */
function buildLounger(army: number, ringColor: number, duck: boolean, shades: boolean): { root: THREE.Group; figure: THREE.Group } {
  const root = new THREE.Group();
  const ring = new PartBuilder();
  const rubber = plastic(ringColor);
  ring.add(new THREE.TorusGeometry(1.0, 0.38, 12, 28).rotateX(Math.PI / 2), rubber, 0, 0.12, 0);
  // White stripes round the ring.
  const stripe = plastic(0xf4f1e4);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ring.add(new THREE.TorusGeometry(0.39, 0.03, 6, 16), stripe, Math.cos(a) * 1.0, 0.12, Math.sin(a) * 1.0, 0, -a + Math.PI / 2);
  }
  if (duck) {
    // A duck's head on the front of the ring.
    ring.add(new THREE.SphereGeometry(0.36, 14, 10), rubber, 0, 0.72, -1.05);
    ring.add(new THREE.BoxGeometry(0.34, 0.12, 0.34), plastic(0xff8a1a), 0, 0.68, -1.42);
    for (const s of [-1, 1]) ring.add(new THREE.SphereGeometry(0.06, 8, 6), plastic(0x1e2119), s * 0.16, 0.82, -1.3);
  }
  ring.buildInto(root);

  const figure = new THREE.Group();
  const body = plastic(shade(army, 1.15));
  const dark = plastic(shade(army, 0.8));
  const f = new PartBuilder();
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Sitting down in the hole, leaning well back against the ring.
  const hip = v(0, 0.1, 0.15);
  const lean = 0.75; // back from upright
  const up = v(0, Math.cos(lean), Math.sin(lean));
  const neck = hip.clone().addScaledVector(up, 0.62);
  const chest = hip.clone().addScaledVector(up, 0.31);
  f.add(new THREE.CylinderGeometry(0.17, 0.19, 0.62, 12), body, chest.x, chest.y, chest.z, lean, 0, 0, 1, 1, 0.75);
  f.add(new THREE.CylinderGeometry(0.195, 0.195, 0.06, 12), dark, hip.x, hip.y + 0.08, hip.z + 0.03, lean, 0, 0, 1, 1, 0.75); // belt
  const head = neck.clone().addScaledVector(up, 0.17).add(v(0, 0, -0.03));
  f.add(new THREE.SphereGeometry(0.16, 14, 10), body, head.x, head.y, head.z);
  // Helmet tipped back on the head, with a rim.
  f.add(new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark, head.x, head.y + 0.03, head.z + 0.04, lean * 0.7);
  f.add(new THREE.CylinderGeometry(0.23, 0.23, 0.025, 16), dark, head.x, head.y + 0.03, head.z + 0.04, lean * 0.7);
  if (shades) {
    const black = plastic(0x151515);
    f.add(new THREE.BoxGeometry(0.26, 0.06, 0.04), black, head.x, head.y + 0.03, head.z - 0.15, -0.3);
  }
  for (const s of [-1, 1]) {
    // Arms up with the hands behind the head, elbows out.
    const shoulder = neck.clone().add(v(s * 0.2, -0.05, 0));
    const elbow = head.clone().add(v(s * 0.32, 0.12, 0.05));
    const hand = head.clone().add(v(s * 0.06, 0.02, 0.16));
    f.beam(shoulder, elbow, 0.11, body, true);
    f.beam(elbow, hand, 0.1, body, true);
    f.add(new THREE.SphereGeometry(0.065, 8, 6), body, elbow.x, elbow.y, elbow.z);
    // Legs over the front of the ring, boots dangling in the water.
    const hipJoint = hip.clone().add(v(s * 0.1, 0, 0));
    const knee = v(s * 0.16, 0.5, -1.0);
    const boot = v(s * 0.18, -0.12, -1.4);
    f.beam(hipJoint, knee, 0.15, dark, true);
    f.beam(knee, boot, 0.13, dark, true);
    f.add(new THREE.SphereGeometry(0.08, 8, 6), dark, knee.x, knee.y, knee.z);
  }
  f.buildInto(figure);
  root.add(figure);
  return { root, figure };
}

/**
 * The Fortress's moat: the water, wooden rails along the two causeways, and a few soldiers of its
 * garrison lounging about in rubber rings. They drift along the moat, get tipped out by shells and
 * blasts landing near them (and climb back in), get gummed up by jam, and paddle for their lives
 * once the gates open. They're scenery: nothing shoots at them and they don't shoot back.
 */
export class Moat {
  private readonly loungers: Lounger[] = [];
  private readonly center: THREE.Vector3;
  private panicking = false;
  private time = 0;

  /** `armies`: the colours of the west and east halves' soldiers. */
  constructor(private readonly scene: THREE.Scene, armies: [number, number]) {
    const site = SITES.find((s) => s.kind === 'fortress');
    this.center = new THREE.Vector3(site?.cx ?? 0, MOAT_LEVEL, site?.cz ?? 0);
    if (!site) return;
    this.buildWater();
    this.buildRails();
    const blobGeo = new THREE.SphereGeometry(0.35, 10, 8).scale(1, 0.45, 1);
    const blobMat = new THREE.MeshPhysicalMaterial({ color: 0xe0294f, roughness: 0.08, clearcoat: 1 });
    let n = 0;
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < LOUNGERS_PER_SIDE; i++, n++) {
        const { root, figure } = buildLounger(side < 0 ? armies[0] : armies[1], RING_COLORS[n % RING_COLORS.length], n % 3 === 1, n % 2 === 0);
        const blob = new THREE.Mesh(blobGeo, blobMat);
        blob.position.set(0.5, 0.52, 0.3);
        blob.visible = false;
        root.add(blob);
        root.traverse((o) => (o.castShadow = true));
        root.scale.setScalar(LOUNGER_SCALE);
        this.scene.add(root);
        this.loungers.push({
          root,
          figure,
          blob,
          side,
          along: ((i + 0.3 + Math.random() * 0.4) / LOUNGERS_PER_SIDE) * PATH_LENGTH,
          dir: Math.random() < 0.5 ? 1 : -1,
          speed: 0.4 + Math.random() * 0.4,
          phase: Math.random() * Math.PI * 2,
          spin: Math.random() * Math.PI * 2,
          tipTime: 0,
          jamTime: 0,
          splashTimer: 0,
        });
      }
    }
  }

  private buildWater(): void {
    const positions: number[] = [];
    const extent = MOAT_OUTER + 1.5;
    for (let x = -extent; x < extent; x += WATER_CELL) {
      for (let z = -extent; z < extent; z += WATER_CELL) {
        const lx = x + WATER_CELL / 2;
        const lz = z + WATER_CELL / 2;
        // Over the moat and a little past its edges (the banks hide the rest), but off the causeways.
        if (!inMoat(this.center.x + lx, this.center.z + lz, 1.5) || (Math.abs(lz) >= Math.abs(lx) && Math.abs(lx) < CAUSEWAY_HALF + 2)) continue;
        const x0 = this.center.x + x;
        const z0 = this.center.z + z;
        const x1 = x0 + WATER_CELL;
        const z1 = z0 + WATER_CELL;
        positions.push(x0, 0, z0, x0, 0, z1, x1, 0, z0, x1, 0, z0, x0, 0, z1, x1, 0, z1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    // The same water as the lakes.
    const water = new THREE.Mesh(
      geo,
      new THREE.MeshPhysicalMaterial({ color: 0x3d8fd4, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, transparent: true, opacity: 0.85 }),
    );
    water.position.y = MOAT_LEVEL + 0.02;
    water.receiveShadow = true;
    this.scene.add(water);
  }

  /** Wooden posts and rails along both sides of each causeway, over the water. */
  private buildRails(): void {
    const b = new PartBuilder();
    const wood = plastic(RAIL_WOOD);
    const post = new THREE.BoxGeometry(0.25, 1.3, 0.25);
    const top = MOAT_LEVEL + 1; // the Fortress's ground
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        const x = this.center.x + sx * (CAUSEWAY_HALF - 1);
        const z0 = this.center.z + sz * (MOAT_INNER - 1);
        const z1 = this.center.z + sz * (MOAT_OUTER + 2);
        const n = Math.round(Math.abs(z1 - z0) / 4);
        for (let i = 0; i <= n; i++) b.add(post, wood, x, top + 0.55, z0 + ((z1 - z0) * i) / n);
        for (const y of [0.55, 1.05]) {
          b.add(new THREE.BoxGeometry(0.12, 0.14, Math.abs(z1 - z0)), wood, x, top + y, (z0 + z1) / 2);
        }
      }
    }
    const rails = new THREE.Group();
    b.buildInto(rails);
    this.scene.add(rails);
  }

  /** A shell, blast or splash at `point`: loungers close by get tipped out. Returns where to splash. */
  disturb(point: THREE.Vector3, size: number): THREE.Vector3[] {
    const splashes: THREE.Vector3[] = [];
    const reach = TIP_RADIUS + size * 3;
    for (const l of this.loungers) {
      if (l.tipTime > 0 || l.root.position.distanceTo(point) > reach) continue;
      l.tipTime = TIP_TIME;
      splashes.push(l.root.position.clone());
    }
    return splashes;
  }

  /** Jam landing at `point` gums up any lounger it hits: he's stuck where he is for a while. */
  jam(point: THREE.Vector3): void {
    for (const l of this.loungers) {
      if (Math.hypot(l.root.position.x - point.x, l.root.position.z - point.z) > JAM_RADIUS) continue;
      l.jamTime = JAM_TIME;
      l.blob.visible = true;
    }
  }

  /** The gates are open and the assault's coming: everyone paddles like mad. */
  panic(): void {
    this.panicking = true;
    for (const l of this.loungers) l.speed = 2.5 + Math.random() * 1.5;
  }

  /** Drifts, bobs and flips the loungers. Returns where they're splashing (paddling hard, or tipping in). */
  update(dt: number): THREE.Vector3[] {
    this.time += dt;
    const splashes: THREE.Vector3[] = [];
    for (const l of this.loungers) {
      if (l.jamTime > 0) {
        l.jamTime -= dt;
        if (l.jamTime <= 0) l.blob.visible = false;
      } else if (l.tipTime <= 0) {
        l.along += l.dir * l.speed * dt;
        if (l.along < 0 || l.along > PATH_LENGTH) {
          l.dir = l.dir === 1 ? -1 : 1;
          l.along = Math.min(PATH_LENGTH, Math.max(0, l.along));
        }
      }
      const p = pathPoint(l.side, l.along);
      const wobble = l.jamTime > 0 ? 3 : this.panicking ? 2.2 : 1;
      l.root.position.set(this.center.x + p.x, MOAT_LEVEL + Math.sin(this.time * 1.8 * wobble + l.phase) * 0.06, this.center.z + p.z);
      l.spin += dt * (this.panicking ? 1.2 : 0.12) * l.dir;
      l.root.rotation.y = l.spin;
      // Tipped out: the ring flips over, he's under for a bit, then it rights itself and he's back in.
      if (l.tipTime > 0) {
        l.tipTime = Math.max(0, l.tipTime - dt);
        const t = TIP_TIME - l.tipTime;
        const flip = t < 0.35 ? t / 0.35 : l.tipTime < 0.6 ? l.tipTime / 0.6 : 1;
        l.root.rotation.z = Math.PI * flip;
        l.figure.visible = t < 0.2 || l.tipTime < 0.3;
        if (l.tipTime === 0) splashes.push(l.root.position.clone());
      } else {
        l.root.rotation.z = Math.sin(this.time * 1.3 * wobble + l.phase) * 0.05;
        l.figure.visible = true;
      }
      if (this.panicking && l.tipTime <= 0 && l.jamTime <= 0) {
        l.splashTimer -= dt;
        if (l.splashTimer <= 0) {
          l.splashTimer = 0.5 + Math.random() * 0.4;
          splashes.push(l.root.position.clone());
        }
      }
    }
    return splashes;
  }
}
