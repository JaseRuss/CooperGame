import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PartBuilder } from '../utils/modelKit';
import { plastic } from '../utils/plastic';

const WOOD = 0x7a5a32;
const WOOD_DARK = 0x5e4526;
const ROOF = 0x4f555a;
/** Platform height (a guard stands on top of it), and the legs' footprint. */
export const TOWER_TOP = 4.6;
const LEG_SPREAD = 1.1;
/** Rifle hits to bring one down, and how long it takes to fall. */
const HP = 10;
const FALL_TIME = 1.4;

interface Tower {
  readonly x: number;
  readonly z: number;
  readonly pivot: THREE.Group;
  collider: RAPIER.Collider | null;
  hp: number;
  /** 0 standing, rising to 1 as it falls. */
  fall: number;
  readonly axis: THREE.Vector3;
}

// Built once, shared by every tower.
let geos: Map<THREE.Material, THREE.BufferGeometry> | null = null;

/** A wooden guard tower: four braced legs, a railed platform at TOWER_TOP, and a little roof on posts. */
function towerGeometry(): Map<THREE.Material, THREE.BufferGeometry> {
  const b = new PartBuilder();
  const wood = plastic(WOOD);
  const dark = plastic(WOOD_DARK);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const s = LEG_SPREAD;
  for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]) {
    b.beam(v(x, 0, z), v(x * 0.85, TOWER_TOP, z * 0.85), 0.22, wood);
    // Roof posts at the platform's corners.
    b.beam(v(x * 1.15, TOWER_TOP, z * 1.15), v(x * 1.15, TOWER_TOP + 2.4, z * 1.15), 0.1, dark);
  }
  // Cross braces up each side.
  for (const [ax, az, bx, bz] of [[-s, -s, s, -s], [s, -s, s, s], [s, s, -s, s], [-s, s, -s, -s]]) {
    b.beam(v(ax, 0.4, az), v(bx * 0.9, 2.4, bz * 0.9), 0.1, dark);
    b.beam(v(bx, 0.4, bz), v(ax * 0.9, 2.4, az * 0.9), 0.1, dark);
    b.beam(v(ax * 0.9, 2.4, az * 0.9), v(bx * 0.85, TOWER_TOP - 0.2, bz * 0.85), 0.1, dark);
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  // Platform, railing and roof.
  b.add(box, wood, 0, TOWER_TOP - 0.15, 0, 0, 0, 0, 3, 0.3, 3);
  for (const [x, z, w, d] of [[0, -1.45, 3, 0.08], [0, 1.45, 3, 0.08], [-1.45, 0, 0.08, 3], [1.45, 0, 0.08, 3]]) {
    b.add(box, dark, x, TOWER_TOP + 1, z, 0, 0, 0, w, 0.08, d);
    b.add(box, wood, x, TOWER_TOP + 0.35, z, 0, 0, 0, w, 0.7, d); // a solid half wall to hide behind
  }
  b.add(new THREE.ConeGeometry(2.3, 0.9, 4), plastic(ROOF), 0, TOWER_TOP + 2.85, 0, 0, Math.PI / 4);
  // A searchlight on the railing (switched off: no stealth in this prison).
  b.add(new THREE.CylinderGeometry(0.18, 0.24, 0.35, 10), plastic(0x30343a), 1.2, TOWER_TOP + 1.2, -1.2, Math.PI / 2);
  box.dispose();
  return b.buildGeometries();
}

/**
 * The yard's guard towers, each with a guard on top (one of the Guards, posted up there). Shoot
 * the legs enough and a tower topples over, and the guard on it comes down with it.
 */
export class Towers {
  readonly group = new THREE.Group();
  private readonly list: Tower[] = [];
  private readonly body: RAPIER.RigidBody;

  /** `fallToward`: where they topple towards (the middle of the yard, so they come down inside it). */
  constructor(private readonly world: RAPIER.World, spots: { x: number; z: number }[], private readonly fallToward: { x: number; z: number }) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    geos ??= towerGeometry();
    for (const spot of spots) {
      const pivot = new THREE.Group();
      pivot.position.set(spot.x, 0, spot.z);
      for (const [mat, geo] of geos) {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        pivot.add(m);
      }
      this.group.add(pivot);
      // The legs, as one block (it's what gets shot at and bumped into); the platform's left open
      // so the guard on top can shoot down past it.
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(LEG_SPREAD, (TOWER_TOP - 0.3) / 2, LEG_SPREAD).setTranslation(spot.x, (TOWER_TOP - 0.3) / 2, spot.z), this.body);
      this.list.push({ x: spot.x, z: spot.z, pivot, collider, hp: HP, fall: 0, axis: new THREE.Vector3() });
    }
  }

  get total(): number {
    return this.list.length;
  }

  get standing(): number {
    return this.list.filter((t) => t.fall === 0).length;
  }

  /** The towers still up, for prompts. */
  get up(): { x: number; z: number }[] {
    return this.list.filter((t) => t.fall === 0);
  }

  /**
   * A shot hit `collider`. Returns null if it wasn't a tower; otherwise the tower's spot, its
   * hits left, whether this shot brought it down, and which way it's falling (into the yard,
   * whichever side it was shot from).
   */
  hit(collider: RAPIER.Collider): { x: number; z: number; left: number; felled: boolean; dir: THREE.Vector3 } | null {
    const t = this.list.find((tw) => tw.collider?.handle === collider.handle);
    if (!t) return null;
    t.hp--;
    const dir = new THREE.Vector3(this.fallToward.x - t.x, 0, this.fallToward.z - t.z).normalize();
    if (t.hp > 0) return { x: t.x, z: t.z, left: t.hp, felled: false, dir };
    // Over it goes, into the yard.
    if (t.collider) this.world.removeCollider(t.collider, false);
    t.collider = null;
    t.axis.set(dir.z, 0, -dir.x);
    t.fall = 0.001;
    return { x: t.x, z: t.z, left: 0, felled: true, dir };
  }

  /** Tips falling towers over. Returns the spots of any that hit the ground this frame. */
  update(dt: number): { x: number; z: number }[] {
    const landed: { x: number; z: number }[] = [];
    for (const t of this.list) {
      if (t.fall === 0 || t.fall >= 1) continue;
      t.fall = Math.min(1, t.fall + dt / FALL_TIME);
      // Slow to start, fast at the end, like a felled tree.
      const angle = (Math.PI / 2 - 0.08) * t.fall * t.fall;
      t.pivot.quaternion.setFromAxisAngle(t.axis, angle);
      if (t.fall >= 1) landed.push({ x: t.x, z: t.z });
    }
    return landed;
  }
}
