import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmp = new THREE.Object3D();

/**
 * Collects many small parts and merges them into one mesh per material, so a detailed toy
 * (hundreds of rivets, track links and sandbags) still draws in a handful of calls.
 */
export class PartBuilder {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** Adds `geo` (not modified) at a position, with optional Euler rotation and scale. */
  add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    sx = 1,
    sy = sx,
    sz = sx,
  ): this {
    tmp.position.set(x, y, z);
    tmp.rotation.set(rx, ry, rz);
    tmp.scale.set(sx, sy, sz);
    tmp.updateMatrix();
    return this.addMatrix(geo, mat, tmp.matrix);
  }

  addMatrix(geo: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.Matrix4): this {
    // Normalise so everything merges: non-indexed, position/normal/uv only.
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    let list = this.parts.get(mat);
    if (!list) {
      list = [];
      this.parts.set(mat, list);
    }
    list.push(g);
    return this;
  }

  /** Adds a box spanning two points in the XZ plane at height y (for rails, braces, ropes). */
  beam(a: THREE.Vector3, b: THREE.Vector3, thickness: number, mat: THREE.Material, round = false): this {
    const len = a.distanceTo(b);
    const geo = round ? new THREE.CylinderGeometry(thickness / 2, thickness / 2, len, 6) : new THREE.BoxGeometry(thickness, len, thickness);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.addMatrix(geo, mat, m);
  }

  /** Merges everything added so far into `parent` (one mesh per material). */
  buildInto(parent: THREE.Object3D, castShadow = true, receiveShadow = true): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      meshes.push(mesh);
    }
    for (const geos of this.parts.values()) for (const g of geos) g.dispose();
    this.parts.clear();
    return meshes;
  }

  /** Merges into one geometry per material without making meshes (for sharing between copies). */
  buildGeometries(): Map<THREE.Material, THREE.BufferGeometry> {
    const out = new Map<THREE.Material, THREE.BufferGeometry>();
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      out.set(mat, merged);
      for (const g of geos) g.dispose();
    }
    this.parts.clear();
    return out;
  }

  /** Merges everything into a single geometry (for one-material models like the soldiers). */
  buildGeometry(): THREE.BufferGeometry {
    const all = [...this.parts.values()].flat();
    const merged = mergeGeometries(all, false) as THREE.BufferGeometry;
    for (const g of all) g.dispose();
    this.parts.clear();
    return merged;
  }
}

/** One cross-section of a lofted body: a rounded rectangle `w` × `h` centred at height `y`. */
export interface LoftSection {
  z: number;
  w: number;
  h: number;
  y: number;
}

/**
 * A smooth body swept along +Z through rounded-rectangle cross-sections (superellipses): good for
 * fuselages and hulls. `roundness` 2 = ellipse, higher = boxier. `arc` limits it to part of the
 * ring (radians, measured from +X toward +Y), for window panels laid over a body; full rings
 * get their ends capped.
 */
export function loftGeometry(sections: LoftSection[], segments = 28, roundness = 3.5, arc?: [number, number]): THREE.BufferGeometry {
  const closed = !arc;
  const [a0, a1] = arc ?? [0, Math.PI * 2];
  const ringCount = closed ? segments : segments + 1;
  const e = 2 / roundness;
  const point = (s: LoftSection, t: number) => {
    const c = Math.cos(t);
    const n = Math.sin(t);
    return new THREE.Vector3(Math.sign(c) * Math.abs(c) ** e * (s.w / 2), s.y + Math.sign(n) * Math.abs(n) ** e * (s.h / 2), s.z);
  };
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  sections.forEach((s, i) => {
    for (let j = 0; j < ringCount; j++) {
      const p = point(s, a0 + ((a1 - a0) * j) / segments);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / segments, i / (sections.length - 1));
    }
  });
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const j1 = closed ? (j + 1) % segments : j + 1;
      const a = i * ringCount + j;
      const b = (i + 1) * ringCount + j;
      const c = i * ringCount + j1;
      const d = (i + 1) * ringCount + j1;
      index.push(a, c, b, c, d, b); // wound so faces point outward
    }
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  side.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  side.setIndex(index);
  side.computeVertexNormals();
  if (!closed) return side;

  // Flat end caps, with their own vertices so the sides stay smooth.
  const caps: number[] = [];
  const cap = (s: LoftSection, front: boolean) => {
    const centre = new THREE.Vector3(0, s.y, s.z);
    for (let j = 0; j < segments; j++) {
      const p = point(s, (Math.PI * 2 * j) / segments);
      const q = point(s, (Math.PI * 2 * (j + 1)) / segments);
      const [u, v] = front ? [q, p] : [p, q];
      caps.push(centre.x, centre.y, centre.z, u.x, u.y, u.z, v.x, v.y, v.z);
    }
  };
  cap(sections[0], true);
  cap(sections[sections.length - 1], false);
  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(caps, 3));
  capGeo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((caps.length / 3) * 2), 2));
  capGeo.computeVertexNormals();
  return mergeGeometries([side.toNonIndexed(), capGeo]) as THREE.BufferGeometry;
}

/** A cylinder lying along Z (the usual "barrel" orientation). */
export function tubeZ(rTop: number, rBottom: number, length: number, segments = 12): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, length, segments).rotateX(Math.PI / 2);
}

/** A cylinder lying along X (wheels, axles). */
export function tubeX(radius: number, length: number, segments = 14): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius, radius, length, segments).rotateZ(Math.PI / 2);
}

/** A sandbag: a squashed capsule along X. */
export function sandbagGeometry(length = 0.75, radius = 0.3): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, length, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.72, 1);
}
