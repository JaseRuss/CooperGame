import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PartBuilder } from '../utils/modelKit';
import { plastic } from '../utils/plastic';
import type { CellSpot } from './Facility';

const STEEL = 0x3e4246;
const BRASS = 0xd8a93a;
/** An opened door swings right round, out of the way flat against the bars beside it (and this fast). */
const OPEN_ANGLE = Math.PI - 0.12;
const SWING_SPEED = 3.2;
/** The padlock hangs this far along the door from the hinge, at this height. */
const LOCK_HEIGHT = 1.15;
const LOCK_INSET = 0.18;

export interface Cell {
  readonly spot: CellSpot;
  readonly index: number;
  locked: boolean;
  /** Where the padlock hangs, for prompts and the HUD. */
  readonly lockAt: THREE.Vector3;
}

interface Door extends Cell {
  pivot: THREE.Group;
  lock: THREE.Group;
  doorCollider: RAPIER.Collider | null;
  lockCollider: RAPIER.Collider | null;
  swing: number;
  /** The padlock flies off when it's shot. */
  lockVelocity: THREE.Vector3;
  lockSpin: number;
  lockLanded: boolean;
}

// Built once, shared by every door: nothing here is disposed.
let doorGeos: Map<THREE.Material, THREE.BufferGeometry> | null = null;
let lockGeos: Map<THREE.Material, THREE.BufferGeometry> | null = null;

/** A barred door `width` wide, hinged at x = 0 and running along +X, standing on y = 0. */
function doorGeometry(width: number, height: number): Map<THREE.Material, THREE.BufferGeometry> {
  const b = new PartBuilder();
  const steel = plastic(STEEL);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const rod = new THREE.CylinderGeometry(0.045, 0.045, height - 0.1, 6);
  for (let x = 0.12; x < width - 0.05; x += 0.28) b.add(rod, steel, x, height / 2, 0);
  for (const y of [0.15, height / 2, height - 0.15]) b.add(box, steel, width / 2, y, 0, 0, 0, 0, width, 0.12, 0.12);
  // Stiles at each end, the hinge end a bit chunkier.
  b.add(box, steel, 0.04, height / 2, 0, 0, 0, 0, 0.1, height - 0.05, 0.14);
  b.add(box, steel, width - 0.04, height / 2, 0, 0, 0, 0, 0.08, height - 0.05, 0.12);
  const out = b.buildGeometries();
  box.dispose();
  rod.dispose();
  return out;
}

/** A chunky brass padlock, toy-sized up so it's easy to see and hit. Origin at its middle. */
function lockGeometry(): Map<THREE.Material, THREE.BufferGeometry> {
  const b = new PartBuilder();
  const brass = plastic(BRASS);
  const steel = plastic(0x9aa0a6);
  b.add(new THREE.BoxGeometry(0.3, 0.26, 0.14), brass, 0, -0.04, 0);
  b.add(new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI), steel, 0, 0.09, 0);
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), plastic(0x2a2a2a), 0, -0.06, -0.075, Math.PI / 2);
  return b.buildGeometries();
}

function meshes(geos: Map<THREE.Material, THREE.BufferGeometry>, into: THREE.Object3D): void {
  for (const [mat, geo] of geos) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    into.add(m);
  }
}

/**
 * The cell doors: barred doors with a big brass padlock on the corridor side. Shoot the padlock
 * and it flies off and the door swings open, right round flat against the bars. A locked door is
 * solid (and stops bullets); an open one is out of the way.
 */
export class Cells {
  readonly group = new THREE.Group();
  private readonly doors: Door[] = [];
  private readonly byLock = new Map<number, Door>();
  private readonly body: RAPIER.RigidBody;

  constructor(private readonly world: RAPIER.World, spots: CellSpot[]) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    spots.forEach((spot, index) => {
      const width = spot.doorX1 - spot.doorX0;
      doorGeos ??= doorGeometry(width, spot.height);
      lockGeos ??= lockGeometry();
      const pivot = new THREE.Group();
      pivot.position.set(spot.doorX0, 0, spot.frontZ);
      meshes(doorGeos, pivot);
      this.group.add(pivot);

      // The padlock hangs on the corridor side of the latch end.
      const lockAt = new THREE.Vector3(spot.doorX1 - LOCK_INSET, LOCK_HEIGHT, spot.frontZ - 0.1);
      const lock = new THREE.Group();
      lock.position.copy(lockAt);
      meshes(lockGeos, lock);
      this.group.add(lock);

      const doorCollider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(width / 2, spot.height / 2, 0.06).setTranslation(spot.doorX0 + width / 2, spot.height / 2, spot.frontZ),
        this.body,
      );
      // Bigger than the lock and right through the door, so it can be shot from inside the cell too.
      const lockCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.24, 0.24, 0.22).setTranslation(lockAt.x, lockAt.y, spot.frontZ), this.body);
      const door: Door = {
        spot,
        index,
        locked: true,
        lockAt,
        pivot,
        lock,
        doorCollider,
        lockCollider,
        swing: 0,
        lockVelocity: new THREE.Vector3(),
        lockSpin: 0,
        lockLanded: false,
      };
      this.doors.push(door);
      this.byLock.set(lockCollider.handle, door);
    });
  }

  get all(): readonly Cell[] {
    return this.doors;
  }

  /** The cell `x, z` is in (behind the bars), or null. */
  cellAt(x: number, z: number): Cell | null {
    return this.doors.find((d) => x > d.spot.minX && x < d.spot.maxX && z > d.spot.frontZ && z < d.spot.backZ) ?? null;
  }

  /** A shot along `dir` hit `collider`: if it was a padlock, it's off and the door opens. Returns that cell. */
  hit(collider: RAPIER.Collider, dir: THREE.Vector3): Cell | null {
    const door = this.byLock.get(collider.handle);
    if (!door || !door.locked) return null;
    this.open(door);
    door.lockVelocity.set(dir.x * 3 + (Math.random() - 0.5), 3.5, dir.z * 3 - 1.5);
    door.lockSpin = 10 + Math.random() * 6;
    return door;
  }

  private open(door: Door): void {
    door.locked = false;
    for (const c of [door.doorCollider, door.lockCollider]) if (c) this.world.removeCollider(c, false);
    door.doorCollider = door.lockCollider = null;
  }

  update(dt: number): void {
    for (const d of this.doors) {
      if (d.locked) continue;
      if (d.swing < 1) {
        d.swing = Math.min(1, d.swing + dt * SWING_SPEED * (1 - d.swing * 0.7));
        // Out through the corridor side (-Z) and back flat against the bars, with a little bounce off its stop.
        const ease = 1 - (1 - d.swing) ** 3;
        d.pivot.rotation.y = OPEN_ANGLE * ease + Math.sin(d.swing * Math.PI) * 0.12;
      }
      if (!d.lockLanded) {
        d.lockVelocity.y -= 18 * dt;
        d.lock.position.addScaledVector(d.lockVelocity, dt);
        d.lock.rotation.x += d.lockSpin * dt;
        if (d.lock.position.y < 0.12) {
          // It lands and stays there, on the floor.
          d.lock.position.y = 0.12;
          d.lock.rotation.set(Math.PI / 2, d.lock.rotation.y, 0);
          d.lockLanded = true;
        }
      }
    }
  }
}
