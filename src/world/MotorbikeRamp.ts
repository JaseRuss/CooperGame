import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { heightAt } from './Terrain';
import { plastic } from '../utils/plastic';

/** A broad, ground-level dirt kicker with a smooth approach and a proper launch lip. */
export class MotorbikeRamp {
  constructor(world: RAPIER.World, scene: THREE.Scene, x: number, z: number, yaw: number) {
    const ground = heightAt(x, z);
    const root = new THREE.Group();
    root.position.set(x, ground, z);
    root.rotation.y = yaw;
    scene.add(root);

    // The wedge starts flush with ground at local +Z and rises toward the launch at -Z.
    const halfWidth = 5.5;
    const length = 18;
    const rise = 3.6;
    const verts = new Float32Array([
      -halfWidth, 0, length / 2,  halfWidth, 0, length / 2,
      -halfWidth, 0, -length / 2, halfWidth, 0, -length / 2,
      -halfWidth, rise, -length / 2, halfWidth, rise, -length / 2,
    ]);
    // Ground, sloped deck, back face and two sides form a solid wedge.
    const indexList = [
      0, 2, 1, 1, 2, 3,
      0, 1, 5, 0, 5, 4,
      2, 4, 5, 2, 5, 3,
      0, 4, 2, 1, 3, 5,
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geometry.setIndex(indexList);
    geometry.computeVertexNormals();
    const deck = new THREE.Mesh(geometry, plastic(0x9a7044));
    deck.castShadow = true;
    deck.receiveShadow = true;
    root.add(deck);

    // Bright stripes across the upper third make the launch lip easy to spot at speed.
    const stripeMat = plastic(0xffcc33);
    for (const zAt of [-6.5, -7.2]) {
      const yAt = rise * ((length / 2 - zAt) / length) + 0.05;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 1.7, 0.12, 0.3), stripeMat);
      stripe.position.set(0, yAt, zAt);
      stripe.rotation.x = Math.atan2(rise, length);
      stripe.castShadow = true;
      root.add(stripe);
    }

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, ground, z).setRotation(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    ));
    world.createCollider(RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(indexList)), body);
  }
}
