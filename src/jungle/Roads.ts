import * as THREE from 'three';
import type { Clearing } from './Forest';

const WIDTH = 5.2;
const ROAD_Y = 0.025;

/** A dirt road (or track) through the jungle, smoothed through its way points. */
export class Roads {
  /** Each road as points about three metres apart. */
  readonly paths: THREE.Vector2[][] = [];
  /** Bare ground the forest keeps off. */
  readonly clearings: Clearing[] = [];
  private readonly material = new THREE.MeshStandardMaterial({ color: 0x7a6a48, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  constructor(private readonly scene: THREE.Scene, roads: [number, number][][]) {
    for (const way of roads) this.add(way);
  }

  private add(way: [number, number][]): void {
    const curve = new THREE.CatmullRomCurve3(way.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.5);
    const n = Math.max(2, Math.round(curve.getLength() / 3));
    const pts = curve.getSpacedPoints(n).map((v) => new THREE.Vector2(v.x, v.z));
    this.paths.push(pts);
    const pos: number[] = [];
    const idx: number[] = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dir = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
      const nx = -dir.y * (WIDTH / 2);
      const nz = dir.x * (WIDTH / 2);
      pos.push(p.x + nx, ROAD_Y, p.y + nz, p.x - nx, ROAD_Y, p.y - nz);
      if (i > 0) {
        const k = (i - 1) * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
      if (i % 2 === 0) this.clearings.push({ x: p.x, z: p.y, r: WIDTH / 2 + 1.8 });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.material);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  /** The point of any road nearest (x, z). */
  nearest(x: number, z: number): THREE.Vector2 {
    let best = this.paths[0][0];
    let bestD = Infinity;
    for (const path of this.paths) {
      for (const p of path) {
        const d = (p.x - x) ** 2 + (p.y - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    return best;
  }
}
