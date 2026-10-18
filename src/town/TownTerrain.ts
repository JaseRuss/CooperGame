import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { TownData, Pt } from './TownData';

/** What each kind of ground is painted (the base is rough grass). */
const AREA_COLOR: Record<string, string> = {
  grass: '#7fae58',
  garden: '#86b85c',
  wood: '#3f6b2e',
  scrub: '#6a8a45',
  water: '#4a8fc4',
  pitch: '#5fae48',
  parking: '#8c8e90',
  playground: '#b56d4e',
  allotment: '#8a7a4a',
  school: '#93c26a',
};
/** Paint order: big, soft areas first, small hard ones on top. */
const AREA_ORDER = ['grass', 'wood', 'scrub', 'allotment', 'school', 'garden', 'pitch', 'parking', 'playground', 'water'];
const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'track']);

/**
 * The ground of the town: the real lie of the land as a mesh (and the same shape as a Rapier
 * trimesh to walk on), with the map painted on it: gardens, woods, playing fields, car parks,
 * pavements and roads.
 */
export class TownTerrain {
  readonly mesh: THREE.Mesh;

  constructor(world: RAPIER.World, scene: THREE.Scene, private readonly town: TownData, textureSize: number) {
    const { n, step } = town.grid;
    const half = town.half;
    const positions = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        positions[k * 3] = -half + i * step;
        positions[k * 3 + 1] = town.sample(i, j);
        positions[k * 3 + 2] = -half + j * step;
        uvs[k * 2] = i / (n - 1);
        uvs[k * 2 + 1] = j / (n - 1);
      }
    }
    const index = new Uint32Array((n - 1) * (n - 1) * 6);
    let w = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        // Split along b-c, the same way TownData.heightAt reads the height.
        index.set([a, c, b, b, c, d], w);
        w += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const map = new THREE.CanvasTexture(this.paint(textureSize));
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 0.95 }));
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.trimesh(positions, index), body);
    // A fence of invisible walls just inside the edge of the map.
    const edge = half - 6;
    for (const [x, z, hx, hz] of [[0, -edge, edge, 1], [0, edge, edge, 1], [-edge, 0, 1, edge], [edge, 0, 1, edge]]) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 120, hz).setTranslation(x, 100, z), body);
    }
  }

  /** The map painted at `size` pixels across. */
  private paint(size: number): HTMLCanvasElement {
    const town = this.town;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const s = size / (town.half * 2);
    const px = (p: Pt) => [(p.x + town.half) * s, (p.z + town.half) * s] as const;
    ctx.fillStyle = '#76a24f';
    ctx.fillRect(0, 0, size, size);
    // A little mottling, so open grass isn't one flat colour.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < size * 6; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(40,70,20,0.07)' : 'rgba(200,230,140,0.06)';
      const r = (2 + rnd() * 9) * s;
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const poly = (pts: Pt[]) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
      ctx.closePath();
    };
    for (const kind of AREA_ORDER) {
      for (const a of town.areas) {
        if (a.kind !== kind) continue;
        poly(a.pts);
        ctx.fillStyle = AREA_COLOR[kind];
        ctx.fill();
        if (kind === 'garden' || kind === 'school') {
          ctx.strokeStyle = 'rgba(40,60,20,0.25)';
          ctx.lineWidth = Math.max(1, 0.4 * s);
          ctx.stroke();
        }
        if (kind === 'pitch') {
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = Math.max(1, 0.25 * s);
          ctx.stroke();
        }
      }
    }
    // Paths and steps (packed gravel), then the roads with their pavements.
    const line = (pts: Pt[]) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const l of town.lines) {
      if (l.kind !== 'stream') continue;
      line(l.pts);
      ctx.strokeStyle = '#4a8fc4';
      ctx.lineWidth = 1.6 * s;
      ctx.stroke();
    }
    for (const r of town.roads) {
      if (!FOOT.has(r.kind)) continue;
      line(r.pts);
      ctx.strokeStyle = r.kind === 'steps' ? '#9a9890' : '#b4aa94';
      ctx.lineWidth = r.width * s;
      ctx.stroke();
    }
    const streets = town.roads.filter((r) => !FOOT.has(r.kind));
    for (const r of streets) {
      line(r.pts);
      ctx.strokeStyle = '#a9a9a4';
      ctx.lineWidth = (r.width + (r.kind === 'service' ? 0.6 : 3.4)) * s;
      ctx.stroke();
    }
    for (const r of streets) {
      line(r.pts);
      ctx.strokeStyle = '#4f5256';
      ctx.lineWidth = r.width * s;
      ctx.stroke();
    }
    // White lines down the middle of the main roads.
    ctx.setLineDash([3 * s, 4 * s]);
    for (const r of streets) {
      if (r.width < 6.5) continue;
      line(r.pts);
      ctx.strokeStyle = 'rgba(240,240,230,0.85)';
      ctx.lineWidth = Math.max(1, 0.18 * s);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Driveways and paths round each house are left to the gardens; a soft shadow at the foot of each building.
    ctx.fillStyle = 'rgba(30,40,25,0.28)';
    for (const b of town.buildings) {
      poly(b.pts.map((p) => ({ x: p.x + 0.5, z: p.z + 0.6 })));
      ctx.fill();
    }
    return canvas;
  }
}
