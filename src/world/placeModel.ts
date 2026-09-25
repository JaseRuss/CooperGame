import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Building } from './Building';
import type { HitRegistry } from '../combat/HitRegistry';
import { heightAt } from './Terrain';

/**
 * Turns and scales `model`, then stands it so its footprint is centred on (x, z) with its base
 * on the ground, and adds it to the scene. Quarter-turn yaws keep the box collider a tight fit.
 */
export function plantModel(scene: THREE.Scene, model: THREE.Object3D, x: number, z: number, yaw: number, scale: number): THREE.Box3 {
  model.rotation.y = yaw;
  model.scale.setScalar(scale);
  model.position.set(0, 0, 0);
  const local = new THREE.Box3().setFromObject(model);
  const c = local.getCenter(new THREE.Vector3());
  model.position.set(x - c.x, heightAt(x, z) - local.min.y, z - c.z);
  scene.add(model);
  return new THREE.Box3().setFromObject(model);
}

/** Largest uniform scale that keeps the model's footprint (after `yaw`) within maxX × maxZ. */
export function fitScale(model: THREE.Object3D, yaw: number, preferred: number, maxX: number, maxZ: number): number {
  model.rotation.y = yaw;
  model.scale.setScalar(1);
  model.position.set(0, 0, 0);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  return Math.min(preferred, maxX / size.x, maxZ / size.z);
}

/** Plants a model and wraps it as a destructible building. */
export function plantBuilding(
  world: RAPIER.World,
  scene: THREE.Scene,
  hitRegistry: HitRegistry,
  model: THREE.Object3D,
  x: number,
  z: number,
  yaw: number,
  scale: number,
  health: number,
  debrisColor: number,
): Building {
  const box = plantModel(scene, model, x, z, yaw, scale);
  return new Building(
    world,
    scene,
    hitRegistry,
    model,
    box.getSize(new THREE.Vector3()).multiplyScalar(0.5),
    box.getCenter(new THREE.Vector3()),
    health,
    debrisColor,
  );
}
