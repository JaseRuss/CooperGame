import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { AssetLibrary, AssetGroup } from '../world/AssetLibrary';
import { PartBuilder, tubeZ } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';

const WOOD = 0x8b5e38;
const WOOD_DARK = 0x5a3b24;

/** Fixed colliders in one body, in the default (walls) collision group. */
export class Solids {
  private readonly body: RAPIER.RigidBody;
  constructor(private readonly world: RAPIER.World) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }
  box(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0): RAPIER.Collider {
    return this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
      this.body,
    );
  }
  cylinder(x: number, z: number, r: number, h: number, y0 = 0): RAPIER.Collider {
    return this.world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y0 + h / 2, z), this.body);
  }
  remove(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }
}

/** Something that can be blown up: a hut's ammo dump, a parked jet. */
export class Target {
  hp: number;
  alive = true;
  /** Set to run something when it goes up. */
  onDestroyed: (() => void) | null = null;
  private readonly colliders: RAPIER.Collider[];

  constructor(
    readonly name: string,
    readonly root: THREE.Object3D,
    readonly pos: THREE.Vector3,
    /** How far from its middle a blast still reaches it. */
    readonly radius: number,
    hp: number,
    colliders: RAPIER.Collider[],
    private readonly solids: Solids,
  ) {
    this.hp = hp;
    this.colliders = colliders;
  }

  hurt(n: number): void {
    if (!this.alive) return;
    this.hp -= n;
    if (this.hp > 0) return;
    this.alive = false;
    for (const c of this.colliders) this.solids.remove(c);
    this.root.visible = false;
    this.onDestroyed?.();
  }
}

// ---------- lookout towers ----------

const LOOKOUT_TOP = 15.2;

/**
 * A wooden lookout tower standing over the canopy: four slanting legs, braces, a platform with a
 * rail (and a gap at the head of the ladder) and a roof. Climb the ladder on its south side to
 * see a long way and put the country round it on the map.
 */
export class Lookout {
  readonly top = LOOKOUT_TOP;
  /** Where he stands to start climbing, where he steps off at the top, and the spot at the head of the ladder that takes him down. */
  readonly foot: THREE.Vector3;
  readonly arrive: THREE.Vector3;
  readonly hatch: THREE.Vector3;
  constructor(solids: Solids, scene: THREE.Scene, readonly x: number, readonly z: number) {
    this.foot = new THREE.Vector3(x, 0, z + 4.4);
    this.arrive = new THREE.Vector3(x, LOOKOUT_TOP, z + 0.2);
    this.hatch = new THREE.Vector3(x, LOOKOUT_TOP, z + 2.9);
    const wood = plastic(WOOD);
    const dark = plastic(WOOD_DARK);
    const p = new PartBuilder();
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of corners) {
      p.beam(new THREE.Vector3(x + sx * 3.9, 0, z + sz * 3.9), new THREE.Vector3(x + sx * 2.9, LOOKOUT_TOP, z + sz * 2.9), 0.7, dark, true);
      solids.cylinder(x + sx * 3.4, z + sz * 3.4, 0.55, LOOKOUT_TOP);
    }
    // Cross braces on each face, at three heights.
    for (const y of [4.5, 9, 13]) {
      const inset = 3.9 - (y / LOOKOUT_TOP) * 1.0;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 4];
        p.beam(new THREE.Vector3(x + ax * inset, y, z + az * inset), new THREE.Vector3(x + bx * inset, y + 2.2, z + bz * inset), 0.3, wood);
        p.beam(new THREE.Vector3(x + ax * inset, y + 2.2, z + az * inset), new THREE.Vector3(x + bx * inset, y, z + bz * inset), 0.3, wood);
      }
    }
    // Platform and railing.
    p.add(new THREE.BoxGeometry(7.6, 0.4, 7.6), wood, x, LOOKOUT_TOP - 0.2, z);
    solids.box(x, LOOKOUT_TOP - 0.2, z, 3.8, 0.2, 3.8);
    for (let s = -1; s <= 1; s += 2) {
      p.add(new THREE.BoxGeometry(7.6, 0.14, 0.14), wood, x, LOOKOUT_TOP + 1.05, z + s * 3.7);
      p.add(new THREE.BoxGeometry(0.14, 0.14, 7.6), wood, x + s * 3.7, LOOKOUT_TOP + 1.05, z);
    }
    for (const [sx, sz] of corners) p.add(new THREE.BoxGeometry(0.3, 5, 0.3), dark, x + sx * 3.6, LOOKOUT_TOP + 2.5, z + sz * 3.6);
    for (let i = -3; i <= 3; i++) {
      p.add(new THREE.BoxGeometry(0.1, 1, 0.1), wood, x + i, LOOKOUT_TOP + 0.5, z - 3.7);
      p.add(new THREE.BoxGeometry(0.1, 1, 0.1), wood, x - 3.7, LOOKOUT_TOP + 0.5, z + i);
      p.add(new THREE.BoxGeometry(0.1, 1, 0.1), wood, x + 3.7, LOOKOUT_TOP + 0.5, z + i);
      if (Math.abs(i) > 1) p.add(new THREE.BoxGeometry(0.1, 1, 0.1), wood, x + i, LOOKOUT_TOP + 0.5, z + 3.7);
    }
    solids.box(x, LOOKOUT_TOP + 0.7, z - 3.7, 3.8, 0.7, 0.15);
    solids.box(x - 3.7, LOOKOUT_TOP + 0.7, z, 0.15, 0.7, 3.8);
    solids.box(x + 3.7, LOOKOUT_TOP + 0.7, z, 0.15, 0.7, 3.8);
    solids.box(x - 2.4, LOOKOUT_TOP + 0.7, z + 3.7, 1.4, 0.7, 0.15);
    solids.box(x + 2.4, LOOKOUT_TOP + 0.7, z + 3.7, 1.4, 0.7, 0.15);
    // The ladder's gap is open to the eye but shut to feet: the way down is the hatch spot just inside it.
    solids.box(x, LOOKOUT_TOP + 0.7, z + 3.75, 1.1, 0.7, 0.1);
    // Roof.
    p.add(new THREE.ConeGeometry(6.2, 3.2, 4).rotateY(Math.PI / 4), plastic(0x8a6a3a), x, LOOKOUT_TOP + 6.6, z);
    // The ladder up the south face.
    for (const s of [-0.5, 0.5]) p.add(new THREE.BoxGeometry(0.14, LOOKOUT_TOP, 0.14), dark, x + s, LOOKOUT_TOP / 2, z + 3.9 + 0.35);
    for (let y = 0.5; y < LOOKOUT_TOP; y += 0.6) p.add(new THREE.BoxGeometry(1, 0.1, 0.1), wood, x, y, z + 4.25);
    // A sack-cloth flag.
    p.add(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), dark, x + 3.6, LOOKOUT_TOP + 7.9, z - 3.6);
    p.buildInto(scene as unknown as THREE.Object3D);
  }
}

// ---------- huts and outposts ----------

/** Places a copy of a hut model `width` metres wide, with a collider, and returns it. */
export function placeHut(assets: AssetLibrary, group: AssetGroup, name: string, scene: THREE.Scene, solids: Solids, x: number, z: number, yaw: number, width: number): { obj: THREE.Object3D; colliders: RAPIER.Collider[]; center: THREE.Vector3; height: number } {
  const obj = assets.clone(group, name);
  obj.rotation.set(0, 0, 0);
  const unit = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  const scale = width / Math.max(unit.x, unit.z, 0.1);
  obj.scale.setScalar(scale);
  obj.rotation.y = yaw;
  obj.position.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(x - c.x, -box.min.y, z - c.z);
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const placed = new THREE.Box3().setFromObject(obj);
  const size = placed.getSize(new THREE.Vector3());
  const center = placed.getCenter(new THREE.Vector3());
  const collider = solids.box(center.x, size.y / 2, center.z, (size.x / 2) * 0.92, size.y / 2, (size.z / 2) * 0.92);
  return { obj, colliders: [collider], center: new THREE.Vector3(center.x, 0, center.z), height: size.y };
}

/** A column of light over something to find, visible through the trees. */
export function beacon(scene: THREE.Scene, x: number, z: number, color = 0xffc040): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 70, 10, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }),
  );
  m.position.set(x, 35, z);
  scene.add(m);
  return m;
}

function flag(scene: THREE.Scene, x: number, z: number, color: number): THREE.MeshStandardMaterial {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 6), plastic(0xd8d8d0));
  pole.position.set(x, 4.5, z);
  const material = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.9).translate(1.5, 0, 0), material);
  cloth.position.set(x + 0.1, 8, z);
  scene.add(pole, cloth);
  return material;
}

export interface Outpost {
  readonly name: string;
  readonly army: 'tan' | 'blue';
  readonly x: number;
  readonly z: number;
  /** The clearing's radius. */
  readonly r: number;
  readonly dump: Target;
  /** The outbuildings round the dump, and the stacks of crates beside it (for when it goes up). */
  readonly huts: { obj: THREE.Object3D; colliders: RAPIER.Collider[]; center: THREE.Vector3; height: number }[];
  readonly crates: { meshes: THREE.Mesh[]; colliders: RAPIER.Collider[]; points: THREE.Vector3[] };
  readonly beacon: THREE.Mesh;
  readonly flagMaterial: THREE.MeshStandardMaterial;
}

/**
 * An enemy outpost: a ring of huts and shacks round a clearing, a flag, stacks of crates, and in
 * the middle the ammunition dump (a storage hut) that has to be blown up.
 */
export function buildOutpost(assets: AssetLibrary, scene: THREE.Scene, solids: Solids, name: string, army: 'tan' | 'blue', color: number, x: number, z: number): Outpost {
  const r = 24;
  const huts: [string, number, number, number, number][] = [
    ['hut-open', -13, -6, 0.6, 7.5],
    ['shack-porch', 12, -9, -0.5, 6.5],
    ['hut-walled', -9, 12, 2.4, 6.5],
    ['shack-open', 13, 11, -2.2, 6],
  ];
  const outbuildings = huts.map(([model, dx, dz, yaw, w]) => placeHut(assets, 'hut', model, scene, solids, x + dx, z + dz, yaw, w));
  const dumpHut = placeHut(assets, 'bigHut', 'storage-hut', scene, solids, x, z, 0.3, 7.5);
  // Crates and barrels stacked about the dump.
  const p = new PartBuilder();
  const wood = plastic(WOOD);
  const crateColliders: RAPIER.Collider[] = [];
  const cratePoints: THREE.Vector3[] = [];
  for (const [dx, dz, s, yaw] of [[4.8, 3.6, 1.2, 0.3], [5.4, 5.2, 0.9, -0.2], [-5.2, 4.2, 1.1, 0.5], [-5.6, -3.8, 1.0, 0.1], [3.8, -5.4, 1.1, -0.4]] as [number, number, number, number][]) {
    p.add(new THREE.BoxGeometry(2 * s, 1.6 * s, 2 * s), wood, x + dx, 0.8 * s, z + dz, 0, yaw);
    crateColliders.push(solids.box(x + dx, 0.8 * s, z + dz, s, 0.8 * s, s, yaw));
    cratePoints.push(new THREE.Vector3(x + dx, 0, z + dz));
  }
  const crateMeshes = p.buildInto(scene as unknown as THREE.Object3D);
  const flagMaterial = flag(scene, x - 3, z - 9, color);
  const dump = new Target(`${name} ammo dump`, dumpHut.obj, new THREE.Vector3(x, 1.5, z), 4.5, 8, dumpHut.colliders, solids);
  return { name, army, x, z, r, dump, huts: outbuildings, crates: { meshes: crateMeshes, colliders: crateColliders, points: cratePoints }, beacon: beacon(scene, x, z), flagMaterial };
}

// ---------- the airbase ----------

/** A toy twin-engined jet, about eight metres long, nose toward -Z. */
function toyJet(color: number): THREE.Group {
  const p = new PartBuilder();
  const hull = plastic(color);
  const dark = plastic(shade(color, 0.6));
  const glass = plastic(0x5aa0c8);
  p.add(tubeZ(0.9, 0.9, 7.6, 12), hull, 0, 1.5, 0);
  p.add(new THREE.ConeGeometry(0.9, 2.2, 12).rotateX(-Math.PI / 2), hull, 0, 1.5, -4.8);
  p.add(new THREE.SphereGeometry(0.7, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1.9), glass, 0, 2.1, -1.4);
  p.add(new THREE.BoxGeometry(9, 0.2, 2.6), hull, 0, 1.3, 0.8, 0, 0, 0);
  p.add(new THREE.BoxGeometry(3.6, 0.16, 1.5), hull, 0, 1.6, 3.4);
  p.add(new THREE.BoxGeometry(0.16, 2, 1.6), hull, 0, 2.6, 3.4);
  for (const s of [-1, 1]) {
    p.add(tubeZ(0.4, 0.45, 2.6, 8), dark, s * 1.5, 1.2, 1.9);
    p.add(new THREE.BoxGeometry(0.18, 0.4, 1.4), dark, s * 4.3, 1.3, 1.3);
    p.add(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 8).rotateZ(Math.PI / 2), dark, s * 1.2, 0.3, -1.6);
    p.add(new THREE.BoxGeometry(0.12, 1, 0.12), dark, s * 1.2, 0.8, -1.6);
  }
  p.add(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 8).rotateZ(Math.PI / 2), dark, 0, 0.3, 2.4);
  const g = new THREE.Group();
  p.buildInto(g);
  return g;
}

export interface Airbase {
  readonly x: number;
  readonly z: number;
  readonly jets: Target[];
  /** Cleared ground: a rectangle round the strip. */
  readonly clearing: { x0: number; x1: number; z0: number; z1: number };
}

/** A jungle airstrip: a runway cut through the trees, a hangar, fuel drums and three parked enemy jets. */
export function buildAirbase(scene: THREE.Scene, solids: Solids, x: number, z: number, color: number): Airbase {
  const tarmac = new THREE.Mesh(new THREE.PlaneGeometry(100, 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.95 }));
  tarmac.position.set(x, 0.04, z);
  tarmac.receiveShadow = true;
  scene.add(tarmac);
  const marks = new PartBuilder();
  const white = plastic(0xe8e4d0);
  for (let i = -45; i < 46; i += 9) marks.add(new THREE.BoxGeometry(4, 0.03, 0.5), white, x + i, 0.07, z);
  marks.add(new THREE.BoxGeometry(100, 0.03, 0.25), white, x, 0.07, z - 7);
  marks.add(new THREE.BoxGeometry(100, 0.03, 0.25), white, x, 0.07, z + 7);
  marks.buildInto(scene as unknown as THREE.Object3D, false, false);
  // The hangar at the far end: a half-barrel of corrugated iron.
  const hangar = new THREE.Group();
  const hp = new PartBuilder();
  hp.add(new THREE.CylinderGeometry(7, 7, 18, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), plastic(0x7a8070), 0, 0, 0);
  hp.add(new THREE.BoxGeometry(14, 0.3, 18), plastic(0x3a3d3a), 0, 0.05, 0);
  hp.buildInto(hangar);
  hangar.position.set(x + 58, 0, z);
  hangar.rotation.y = Math.PI / 2;
  scene.add(hangar);
  solids.box(x + 58, 3.5, z, 9.2, 3.5, 7.2);
  // Fuel drums and a windsock.
  const dp = new PartBuilder();
  for (let i = 0; i < 6; i++) {
    const dx = x - 56 + (i % 3) * 1.4;
    const dz = z + 11 + Math.floor(i / 3) * 1.4;
    dp.add(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 10), plastic(i % 2 ? 0xb8392e : 0x3d6fc4), dx, 0.55, dz);
    solids.cylinder(dx, dz, 0.5, 1.1);
  }
  dp.add(new THREE.CylinderGeometry(0.1, 0.12, 6, 6), plastic(0xe8e4d0), x - 44, 3, z - 11);
  dp.add(new THREE.ConeGeometry(0.5, 2.4, 8).rotateZ(-Math.PI / 2), plastic(0xff7a2a), x - 42.6, 5.6, z - 11);
  dp.buildInto(scene as unknown as THREE.Object3D);
  const jets: Target[] = [];
  [-30, -4, 22].forEach((dx, i) => {
    const jet = toyJet(color);
    jet.position.set(x + dx, 0.05, z + 4.5);
    jet.rotation.y = Math.PI + (i - 1) * 0.12;
    scene.add(jet);
    const c = solids.box(x + dx, 1.5, z + 4.5, 4.4, 1.5, 4.2);
    jets.push(new Target(`jet ${i + 1}`, jet, new THREE.Vector3(x + dx, 1.6, z + 4.5), 5, 3, [c], solids));
  });
  return { x, z, jets, clearing: { x0: x - 62, x1: x + 70, z0: z - 15, z1: z + 18 } };
}

// ---------- roadside camps ----------

export interface Camp {
  readonly x: number;
  readonly z: number;
  /** The clearing's radius. */
  readonly r: number;
  /** Where the fire burns, and where the gun emplacements are (a soldier or two stands behind each). */
  readonly fire: THREE.Vector3;
  readonly guns: THREE.Vector3[];
}

/**
 * A small enemy camp beside the road: a fire, a couple of tents, crates and barrels, and two sandbag
 * gun emplacements facing the road. The guns are for show: whoever stands behind them is a soldier
 * like any other, and he's caught napping when you walk up.
 */
export function buildCamp(scene: THREE.Scene, solids: Solids, x: number, z: number, facing: THREE.Vector2, color: number): Camp {
  const yaw = Math.atan2(-facing.x, -facing.y);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (lx: number, lz: number) => new THREE.Vector3(x + lx * c + lz * s, 0, z - lx * s + lz * c);
  const bag = plastic(0xb8a574);
  const bagDark = plastic(0x9a8a5c);
  const canvas = plastic(color);
  const wood = plastic(WOOD);
  const iron = plastic(0x4a4d52);
  const stone = plastic(0x8a8d90);
  const p = new PartBuilder();

  // Fire pit.
  const fire = at(0, 2.5);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.add(new THREE.DodecahedronGeometry(0.3, 0), stone, fire.x + Math.cos(a) * 0.8, 0.2, fire.z + Math.sin(a) * 0.8);
  }
  p.add(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 5).rotateZ(Math.PI / 2), plastic(WOOD_DARK), fire.x, 0.25, fire.z, 0, 0.6);
  p.add(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 5).rotateZ(Math.PI / 2), plastic(WOOD_DARK), fire.x, 0.25, fire.z, 0, -0.6);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 6), new THREE.MeshBasicMaterial({ color: 0xff8a2a, fog: false }));
  flame.position.set(fire.x, 0.9, fire.z);
  scene.add(flame);

  // Two tents.
  for (const [lx, lz, ry] of [[-6.2, 3.8, 0.3], [6.0, 4.6, -0.4]] as [number, number, number][]) {
    const t = at(lx, lz);
    p.add(new THREE.ConeGeometry(2.3, 2.3, 4).rotateY(Math.PI / 4), canvas, t.x, 1.15, t.z, 0, yaw + ry, 0, 1, 1, 1.35);
    p.add(new THREE.BoxGeometry(0.1, 2.4, 0.1), wood, t.x, 1.2, t.z);
    solids.box(t.x, 0.7, t.z, 1.4, 0.7, 1.7, yaw + ry);
  }

  // Crates and barrels.
  for (const [lx, lz, size] of [[-3, 6.6, 1.1], [-1.4, 7.2, 0.9], [3.6, 6.8, 1.2]] as [number, number, number][]) {
    const t = at(lx, lz);
    p.add(new THREE.BoxGeometry(2 * size, 1.5 * size, 2 * size), wood, t.x, 0.75 * size, t.z, 0, yaw + lx);
    solids.box(t.x, 0.75 * size, t.z, size, 0.75 * size, size, yaw + lx);
  }
  for (const [lx, lz] of [[1.2, 7], [2.2, 7.4]] as [number, number][]) {
    const t = at(lx, lz);
    p.add(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), iron, t.x, 0.55, t.z);
  }

  // Sandbag gun emplacements, one either side, a toy gun behind each.
  const guns: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const gun = at(side * 5.4, -3.8);
    guns.push(gun.clone());
    for (let layer = 0; layer < 2; layer++) {
      for (let i = -4; i <= 4; i++) {
        const a = (i / 4) * 1.15;
        // An arc round the front of the gun, each bag along the tangent.
        const lx = side * 5.4 + Math.sin(a) * 3.1;
        const lz = -3.8 - Math.cos(a) * 3.1 + layer * 0;
        const w = at(lx, lz);
        const ang = yaw - a;
        p.add(new THREE.BoxGeometry(1.15, 0.42, 0.55), (i + layer) % 2 ? bag : bagDark, w.x, 0.21 + layer * 0.42, w.z, 0, ang);
        if (layer === 0) solids.box(w.x, 0.42, w.z, 0.6, 0.42, 0.3, ang);
      }
    }
    // The gun: a barrel on a carriage with wheels and a shield.
    p.add(tubeZ(0.14, 0.2, 2.6, 8), iron, gun.x, 1.05, gun.z, 0, yaw);
    for (const w of [-1, 1]) {
      const wp = at(side * 5.4 + w * 0.8, -3.2);
      p.add(new THREE.CylinderGeometry(0.55, 0.55, 0.16, 12).rotateZ(Math.PI / 2), plastic(WOOD_DARK), wp.x, 0.55, wp.z, 0, yaw);
    }
    const sh = at(side * 5.4, -4.8);
    p.add(new THREE.BoxGeometry(1.8, 1.2, 0.1), iron, sh.x, 1.0, sh.z, 0, yaw);
    solids.box(gun.x, 0.6, gun.z, 0.5, 0.6, 0.9, yaw);
  }
  p.buildInto(scene as unknown as THREE.Object3D);
  return { x, z, r: 13, fire, guns };
}
