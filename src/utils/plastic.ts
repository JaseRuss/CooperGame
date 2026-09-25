import * as THREE from 'three';

const cache = new Map<number, THREE.MeshPhysicalMaterial>();

/** Glossy moulded-plastic material, shared per colour, for the toy-soldier look. */
export function plastic(color: number): THREE.MeshPhysicalMaterial {
  let mat = cache.get(color);
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.3,
      sheen: 0.3,
      sheenColor: new THREE.Color(color).multiplyScalar(1.3),
    });
    cache.set(color, mat);
  }
  return mat;
}

export function shade(color: number, factor: number): number {
  return new THREE.Color(color).multiplyScalar(factor).getHex();
}

/** Classic toy army colours. */
export const ARMY_GREEN = 0x4b7a2e;
export const ARMY_TAN = 0xc4a468;
