import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { HitRegistry } from '../combat/HitRegistry';
import { Tree, type ToppleSize } from './Tree';

/**
 * Instanced copies of `template` that each fall over when a tank drives into them (trees, lamp
 * posts): one InstancedMesh per part, with each Tree rewriting its own instance as it topples.
 */
export function toppleInstances(
  world: RAPIER.World,
  scene: THREE.Object3D,
  hitRegistry: HitRegistry,
  staticBody: RAPIER.RigidBody,
  source: THREE.Object3D,
  placements: { x: number; y: number; z: number; yaw: number; scale: number }[],
  size: ToppleSize,
  shadows = true,
): Tree[] {
  if (placements.length === 0) return [];
  const template = source.clone(true);
  template.position.set(0, 0, 0);
  template.rotation.set(0, 0, 0);
  template.scale.set(1, 1, 1);
  template.updateMatrixWorld(true);
  const meshes: { instanced: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  template.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const instanced = new THREE.InstancedMesh(child.geometry, child.material, placements.length);
    instanced.castShadow = shadows;
    instanced.receiveShadow = shadows;
    scene.add(instanced);
    meshes.push({ instanced, local: child.matrixWorld.clone() });
  });

  const out = placements.map((p, index) => {
    const writeTransform = (transform: THREE.Matrix4) => {
      const combined = new THREE.Matrix4();
      for (const { instanced, local } of meshes) {
        instanced.setMatrixAt(index, combined.multiplyMatrices(transform, local));
        instanced.instanceMatrix.needsUpdate = true;
      }
    };
    return new Tree(world, hitRegistry, staticBody, scene, null, p.x, p.y, p.z, p.yaw, p.scale, writeTransform, size);
  });
  // Bounds must cover every instance even once they've toppled, so pad them out.
  for (const { instanced } of meshes) {
    instanced.computeBoundingSphere();
    if (instanced.boundingSphere) instanced.boundingSphere.radius += 20;
  }
  return out;
}
