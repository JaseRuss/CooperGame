import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createFigureMesh } from '../entities/Soldier';
import { ARMY_TAN } from '../utils/plastic';

/** How long a dummy lies there before popping back up, and how fast it tips over. */
const DOWN_TIME = 5;
const TIP_SPEED = 7;

interface Dummy {
  mesh: THREE.Mesh;
  collider: RAPIER.Collider;
  /** 0 standing, rising to 1 when flat. */
  tip: number;
  downFor: number;
  /** Which way it falls (away from the shot), as a yaw. */
  fallYaw: number;
  yaw: number;
}

/**
 * Tan practice dummies: a guard figure on its stand that tips over when shot and pops back up a
 * few seconds later. Something to aim at until there are real guards.
 */
export class Dummies {
  readonly group = new THREE.Group();
  private readonly list: Dummy[] = [];
  private readonly byCollider = new Map<number, Dummy>();
  /** Every dummy that's been knocked over at least once. */
  private readonly hitOnce = new Set<Dummy>();

  constructor(world: RAPIER.World, spots: { x: number; z: number; yaw: number }[]) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const s of spots) {
      const mesh = createFigureMesh(0, ARMY_TAN);
      mesh.position.set(s.x, 0, s.z);
      mesh.rotation.y = s.yaw;
      this.group.add(mesh);
      const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.32, 0.9, 0.32).setTranslation(s.x, 0.9, s.z), body);
      const dummy: Dummy = { mesh, collider, tip: 0, downFor: 0, fallYaw: 0, yaw: s.yaw };
      this.list.push(dummy);
      this.byCollider.set(collider.handle, dummy);
    }
  }

  get total(): number {
    return this.list.length;
  }

  get knockedOnce(): number {
    return this.hitOnce.size;
  }

  /** Shot along `dir`: true if `collider` was a standing dummy (and it's now going over). */
  hit(collider: RAPIER.Collider, dir: THREE.Vector3): boolean {
    const d = this.byCollider.get(collider.handle);
    if (!d || d.downFor > 0) return false;
    d.downFor = DOWN_TIME;
    d.fallYaw = Math.atan2(-dir.x, -dir.z);
    d.collider.setEnabled(false);
    this.hitOnce.add(d);
    return true;
  }

  update(dt: number): void {
    for (const d of this.list) {
      if (d.downFor > 0) {
        d.downFor = Math.max(0, d.downFor - dt);
        d.tip = Math.min(1, d.tip + dt * TIP_SPEED);
        if (d.downFor === 0) d.collider.setEnabled(true);
      } else if (d.tip > 0) {
        d.tip = Math.max(0, d.tip - dt * 2);
      } else {
        continue;
      }
      // Fall over backwards, away from the shot (a little bounce at the end).
      const angle = (Math.PI / 2) * Math.min(1, d.tip * 1.08);
      d.mesh.rotation.set(0, 0, 0);
      d.mesh.rotateY(d.fallYaw);
      d.mesh.rotateX(-angle);
      d.mesh.rotateY(d.yaw - d.fallYaw);
    }
  }
}
