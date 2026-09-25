import * as THREE from 'three';

/**
 * Draws many copies of a (static, non-destructible) model with one InstancedMesh per sub-mesh,
 * so hundreds of street lights or poles cost a handful of draw calls.
 */
export function instanceTemplate(template: THREE.Object3D, placements: THREE.Matrix4[]): THREE.Group {
  const group = new THREE.Group();
  if (placements.length === 0) return group;

  const root = template.clone(true);
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const combined = new THREE.Matrix4();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const inst = new THREE.InstancedMesh(child.geometry, child.material, placements.length);
    placements.forEach((m, i) => inst.setMatrixAt(i, combined.multiplyMatrices(m, child.matrixWorld)));
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}

/** Placement matrix: stand on (x, y, z), turned `yaw` about Y, uniformly scaled. */
export function placement(x: number, y: number, z: number, yaw: number, scale: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(scale, scale, scale),
  );
}
