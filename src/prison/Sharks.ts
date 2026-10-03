import * as THREE from 'three';
import { PartBuilder, loftGeometry } from '../utils/modelKit';
import { mulberry32 } from '../utils/rng';
import { SEA_LEVEL } from './Sea';

/** Sharks further than this from the player aren't drawn or moved. */
const ACTIVE_RANGE = 260;
/** A shark smells the raft this far off and comes to have a look, and gets this close. */
const STALK_RANGE = 48;
const STALK_CLOSE = 11;
const STALK_TIME = 11;

type Shapes = {
  body: Map<THREE.Material, THREE.BufferGeometry>;
  jaw: Map<THREE.Material, THREE.BufferGeometry>;
  tail: Map<THREE.Material, THREE.BufferGeometry>;
};
let shapes: Shapes | null = null;

const mat = (color: number, emissive = 0x1c2a38) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, emissive });

/**
 * A cartoon shark about 5 m long, nose toward -Z: blue-grey, white belly, round eyes under angry
 * eyebrows, a toothy grin on a hinged lower jaw with a tongue and drool, and a red-checked
 * napkin tied round its neck as a bib. It's hungry.
 */
function sharkShapes(): Shapes {
  if (shapes) return shapes;
  const grey = mat(0x6d8296);
  const dark = mat(0x4c5d6e);
  const white = mat(0xe8eef2, 0x151a1f);
  const red = mat(0xc8302a);
  const black = mat(0x101214, 0x000000);
  const mouth = mat(0x7a1820, 0x1a0408);
  const pink = mat(0xe86a86);
  const drool = new THREE.MeshStandardMaterial({ color: 0xbfe4f4, roughness: 0.1, transparent: true, opacity: 0.8 });
  const body = new PartBuilder();
  const sections = [
    { z: -2.55, w: 0.3, h: 0.3, y: -0.05 },
    { z: -2.1, w: 0.85, h: 0.8, y: 0 },
    { z: -1.1, w: 1.3, h: 1.3, y: 0.02 },
    { z: 0.3, w: 1.25, h: 1.25, y: 0.02 },
    { z: 1.5, w: 0.8, h: 0.8, y: 0.05 },
    { z: 2.3, w: 0.32, h: 0.4, y: 0.08 },
  ];
  body.add(loftGeometry(sections, 24, 2.2), grey);
  body.add(loftGeometry(sections.map((s) => ({ ...s, w: s.w + 0.04, h: s.h + 0.04 })), 24, 2.2, [Math.PI * 1.08, Math.PI * 1.92]), white);
  // Dorsal fin, pectoral fins.
  body.add(new THREE.ConeGeometry(0.34, 1.15, 4), dark, 0, 1.15, 0.15, -0.3, Math.PI / 4, 0, 0.35, 1, 1);
  for (const s of [-1, 1]) body.add(new THREE.BoxGeometry(0.7, 0.07, 0.5), dark, s * 0.85, -0.45, -0.4, 0, s * 0.3, s * -0.5);
  // Eyes under angry eyebrows, looking straight at you.
  for (const s of [-1, 1]) {
    body.add(new THREE.SphereGeometry(0.15, 12, 8), white, s * 0.5, 0.25, -1.62);
    body.add(new THREE.SphereGeometry(0.075, 10, 8), black, s * 0.56, 0.25, -1.74);
    body.add(new THREE.BoxGeometry(0.34, 0.07, 0.1), black, s * 0.5, 0.47, -1.66, 0, 0, s * 0.5);
  }
  // The upper teeth, along the snout's underside, and the dark mouth.
  body.add(new THREE.BoxGeometry(0.62, 0.06, 1.3), mouth, 0, -0.38, -1.55);
  for (const s of [-1, 1]) for (let z = -2.15; z < -0.9; z += 0.2) body.add(new THREE.ConeGeometry(0.055, 0.2, 5).rotateX(Math.PI), white, s * 0.3, -0.45, z);
  // The napkin: a string round the neck and a red-checked bib hanging down the chest.
  body.add(new THREE.TorusGeometry(0.64, 0.035, 6, 20), red, 0, 0.02, -0.7, 0, 0, 0, 1, 1, 1);
  body.add(new THREE.BoxGeometry(0.95, 0.85, 0.07), white, 0, -0.38, -0.98, 0.15, 0, 0);
  for (const x of [-0.3, 0, 0.3]) body.add(new THREE.BoxGeometry(0.14, 0.85, 0.075), red, x, -0.38, -0.98, 0.15, 0, 0);
  for (const y of [-0.15, -0.5]) body.add(new THREE.BoxGeometry(0.95, 0.12, 0.078), red, 0, y, -0.97, 0.15, 0, 0);

  // The lower jaw (hinged at the back of the mouth), with its own teeth, tongue and a drip of drool.
  const jaw = new PartBuilder();
  jaw.add(new THREE.BoxGeometry(0.66, 0.12, 1.45), grey, 0, -0.06, -0.72);
  jaw.add(new THREE.BoxGeometry(0.62, 0.08, 1.3), white, 0, -0.14, -0.72);
  for (const s of [-1, 1]) for (let z = -1.3; z < -0.1; z += 0.2) jaw.add(new THREE.ConeGeometry(0.05, 0.19, 5), white, s * 0.28, 0.12, z);
  jaw.add(new THREE.BoxGeometry(0.22, 0.04, 0.6), pink, 0, 0.03, -0.9);
  jaw.add(new THREE.SphereGeometry(0.05, 8, 6), drool, 0.22, -0.2, -1.3);

  const tail = new PartBuilder();
  tail.add(new THREE.BoxGeometry(0.1, 1.15, 0.5), dark, 0, 0.5, 0.35, 0.5, 0, 0);
  tail.add(new THREE.BoxGeometry(0.1, 0.75, 0.4), dark, 0, -0.3, 0.3, -0.5, 0, 0);
  shapes = { body: body.buildGeometries(), jaw: jaw.buildGeometries(), tail: tail.buildGeometries() };
  return shapes;
}

function dress(geos: Map<THREE.Material, THREE.BufferGeometry>, parent: THREE.Object3D): void {
  for (const [m, g] of geos) parent.add(new THREE.Mesh(g, m));
}

interface Shark {
  readonly root: THREE.Group;
  readonly jaw: THREE.Group;
  readonly tail: THREE.Group;
  readonly home: THREE.Vector2;
  readonly anchor: THREE.Vector2;
  readonly homeRadius: number;
  radius: number;
  readonly dir: number;
  readonly speed: number;
  angle: number;
  /** 0 fin only, 1 head and bib out of the water. */
  surface: number;
  surfaceTimer: number;
  stalk: number;
  cooldown: number;
  yaw: number;
  phase: number;
}

/**
 * Sharks in bibs, as scenery: they lurk about the course (just a fin cutting the water), now
 * and then lift their heads out for a look with their jaws going, and slink up to a raft that
 * comes close, circling it hungrily and staring. They never touch it.
 */
export class Sharks {
  readonly group = new THREE.Group();
  private readonly sharks: Shark[] = [];

  /** `start` and `end` are the z of the jetty's end and of the far beach. */
  constructor(start: number, end: number) {
    const geo = sharkShapes();
    const rng = mulberry32(88);
    const length = start - end;
    const spots: [number, number][] = [
      // A couple right off the jetty, to be seen from the beach.
      [-16, start + 20],
      [15, start + 5],
      // And one off the far beach.
      [22, end + 14],
    ];
    for (let i = 0; i < 12; i++) spots.push([(i % 2 ? 1 : -1) * (14 + rng() * 42), start - length * (0.07 + i * 0.075 + rng() * 0.02)]);
    for (const [x, z] of spots) {
      const root = new THREE.Group();
      const body = new THREE.Group();
      dress(geo.body, body);
      const jaw = new THREE.Group();
      jaw.position.set(0, -0.42, -0.85);
      dress(geo.jaw, jaw);
      const tail = new THREE.Group();
      tail.position.set(0, 0, 2.2);
      dress(geo.tail, tail);
      body.add(jaw, tail);
      root.add(body);
      this.group.add(root);
      const radius = 9 + rng() * 11;
      this.sharks.push({
        root,
        jaw,
        tail,
        home: new THREE.Vector2(x, z),
        anchor: new THREE.Vector2(x, z),
        homeRadius: radius,
        radius,
        dir: rng() < 0.5 ? -1 : 1,
        speed: 2.2 + rng() * 1.2,
        angle: rng() * Math.PI * 2,
        surface: 0,
        surfaceTimer: 4 + rng() * 20,
        stalk: 0,
        cooldown: rng() * 8,
        yaw: 0,
        phase: rng() * 10,
      });
    }
  }

  /** `focus` is the player (or the raft); `raft` is where the raft is, or null when it's not on the water. */
  update(dt: number, time: number, focus: THREE.Vector3, raft: THREE.Vector3 | null): void {
    for (const s of this.sharks) {
      const near = Math.hypot(s.anchor.x - focus.x, s.anchor.y - focus.z) < ACTIVE_RANGE;
      s.root.visible = near;
      if (!near) continue;
      // The raft's within smelling distance: slink over and circle it for a while, then lose interest.
      const dr = raft ? Math.hypot(s.root.position.x - raft.x, s.root.position.z - raft.z) : Infinity;
      s.cooldown -= dt;
      if (s.stalk <= 0 && dr < STALK_RANGE && s.cooldown <= 0) s.stalk = STALK_TIME;
      if (s.stalk > 0) {
        s.stalk -= dt;
        if (s.stalk <= 0) s.cooldown = 25;
      }
      const stalking = s.stalk > 0 && raft !== null;
      const goal = stalking && raft ? new THREE.Vector2(raft.x, raft.z) : s.home;
      s.anchor.lerp(goal, Math.min(1, dt * (stalking ? 0.55 : 0.2)));
      s.radius += ((stalking ? STALK_CLOSE : s.homeRadius) - s.radius) * Math.min(1, dt * 0.6);
      const before = s.root.position.clone();
      s.angle += (s.dir * s.speed * (stalking ? 1.3 : 1) * dt) / s.radius;
      const x = s.anchor.x + Math.cos(s.angle) * s.radius;
      const z = s.anchor.y + Math.sin(s.angle) * s.radius;

      // Up for a look now and then, and whenever it's close to a raft.
      s.surfaceTimer -= dt;
      const wantUp = stalking || (s.surfaceTimer < 3.5 && s.surfaceTimer > 0);
      if (s.surfaceTimer < -1) s.surfaceTimer = 12 + Math.random() * 22;
      s.surface += ((wantUp ? 1 : 0) - s.surface) * Math.min(1, dt * 1.6);

      const tangent = Math.atan2(-(x - before.x), -(z - before.z));
      let yaw = dt > 0 && before.x !== 0 ? tangent : s.yaw;
      // Surfaced, it keeps its eyes on the raft (or you), swimming sideways round it.
      const look = raft ?? focus;
      const toLook = Math.atan2(-(look.x - x), -(look.z - z));
      if (s.surface > 0.3 && Math.hypot(look.x - x, look.z - z) < 90) yaw += Math.atan2(Math.sin(toLook - yaw), Math.cos(toLook - yaw)) * 0.7 * s.surface;
      s.yaw += Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw)) * Math.min(1, dt * 3);
      s.root.position.set(x, SEA_LEVEL - 0.78 + 1.45 * s.surface + Math.sin(time * 1.3 + s.phase) * 0.04, z);
      s.root.rotation.set(0.6 * s.surface, s.yaw, 0, 'YXZ');
      s.tail.rotation.y = Math.sin(time * 4 + s.phase) * 0.4;
      // Jaws chomping while it's up.
      const chomp = s.surface > 0.5 ? Math.max(0, Math.sin(time * 5.5 + s.phase)) * 0.55 + 0.12 : 0.04;
      s.jaw.rotation.x = -chomp;
    }
  }
}
