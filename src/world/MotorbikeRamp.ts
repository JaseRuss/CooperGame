import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { heightAt } from './Terrain';
import { PartBuilder } from '../utils/modelKit';
import { plastic } from '../utils/plastic';

/** A freestanding dirt kicker for bikes, placed beside (clear of) the road and the vehicle bay. */
export class MotorbikeRamp {
  constructor(world: RAPIER.World, scene: THREE.Scene, x: number, z: number, yaw: number) {
    const ground = heightAt(x, z);
    const root = new THREE.Group();
    root.position.set(x, ground, z);
    root.rotation.y = yaw;
    scene.add(root);

    const dirt = plastic(0x9a7044);
    const dark = plastic(0x654b31);
    const yellow = plastic(0xffcc33);
    const parts = new PartBuilder();
    // A long, broad kicker: the launch lip is high, facing bikes riding toward local -Z.
    parts.add(new THREE.BoxGeometry(8, 1.15, 13), dirt, 0, 0.88, 0, 0.27);
    parts.add(new THREE.BoxGeometry(8.1, 0.16, 1.3), dark, 0, 1.48, -5.55, 0.27);
    parts.add(new THREE.BoxGeometry(8.25, 0.12, 0.55), yellow, 0, 1.5, -5.9, 0.27);
    for (const side of [-1, 1]) {
      parts.add(new THREE.BoxGeometry(0.28, 0.55, 12), dark, side * 4.1, 0.38, 0);
      for (let i = 0; i < 5; i++) parts.add(new THREE.BoxGeometry(0.3, 0.08, 0.5), yellow, side * 4.1, 0.68, -4.5 + i * 2.1);
    }
    parts.buildInto(root);

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.27));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(4, 0.575, 6.5)
        .setTranslation(x, ground + 0.88, z)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }),
      body,
    );
  }
}
