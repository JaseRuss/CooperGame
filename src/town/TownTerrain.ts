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
  basin: '#6b9a4c',
  pitch: '#5fae48',
  parking: '#8c8e90',
  playground: '#b56d4e',
  allotment: '#8a7a4a',
  school: '#93c26a',
  // Mauricewood Primary's playground, its little all-weather pitch, the lawn and the yard (traced from photos).
  court: '#6f6c66',
  astro: '#67b35e',
  lawn: '#6fae4c',
  yard: '#8c7c64',
};
/**
 * A tile of grass blades for the ground's detail (see groundMaterial): mid grey on average, so it
 * lightens and darkens the painted colour without shifting it, with short blades leaning every way
 * in darker green, lighter green and straw, drawn wrapped round the edges so it tiles.
 */
function grassDetail(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  let seed = 91;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = 'rgb(124,128,120)';
  g.fillRect(0, 0, size, size);
  // Soft clumps first, then thousands of blades.
  for (let i = 0; i < 260; i++) {
    const x = r() * size, y = r() * size, rad = 8 + r() * 30;
    g.fillStyle = r() < 0.5 ? 'rgba(90,100,80,0.18)' : 'rgba(165,170,140,0.16)';
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  const shades = ['rgba(70,86,58,0.75)', 'rgba(98,116,80,0.7)', 'rgba(176,184,146,0.7)', 'rgba(196,186,140,0.55)', 'rgba(58,70,50,0.8)'];
  g.lineCap = 'round';
  for (let i = 0; i < 9000; i++) {
    const x = r() * size, y = r() * size;
    const len = 4 + r() * 9, a = r() * Math.PI * 2;
    g.strokeStyle = shades[Math.floor(r() * shades.length)];
    g.lineWidth = 0.8 + r() * 1.2;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.quadraticCurveTo(x + ox + Math.cos(a) * len * 0.5 + 1.5, y + oy + Math.sin(a) * len * 0.5, x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Paint order: big, soft areas first, small hard ones on top. */
const AREA_ORDER = ['grass', 'basin', 'wood', 'scrub', 'allotment', 'school', 'garden', 'pitch', 'parking', 'playground', 'water', 'yard', 'lawn', 'court', 'astro'];
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
    this.mesh = new THREE.Mesh(geo, this.groundMaterial(map));
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

  /** Painted games on the school playground: a hopscotch, a court outline and a centre line, along its longest side. */
  private courtMarkings(ctx: CanvasRenderingContext2D, pts: Pt[], px: (p: Pt) => readonly [number, number], s: number): void {
    let a = pts[0], b = pts[1];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (Math.hypot(q.x - p.x, q.z - p.z) > Math.hypot(b.x - a.x, b.z - a.z)) [a, b] = [p, q];
    }
    const c = { x: pts.reduce((t, p) => t + p.x, 0) / pts.length, z: pts.reduce((t, p) => t + p.z, 0) / pts.length };
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const at = (u: number, v: number) => px({ x: c.x + ux * u - uz * v, z: c.z + uz * u + ux * v });
    ctx.strokeStyle = 'rgba(245,245,235,0.9)';
    ctx.lineWidth = Math.max(1, 0.15 * s);
    ctx.beginPath();
    ctx.moveTo(...at(-12, -7)); ctx.lineTo(...at(12, -7)); ctx.lineTo(...at(12, 7)); ctx.lineTo(...at(-12, 7)); ctx.closePath();
    ctx.moveTo(...at(0, -7)); ctx.lineTo(...at(0, 7));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,214,74,0.95)';
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.moveTo(...at(-16 + k * 0.9, -2)); ctx.lineTo(...at(-15.1 + k * 0.9, -2)); ctx.lineTo(...at(-15.1 + k * 0.9, -1.1)); ctx.lineTo(...at(-16 + k * 0.9, -1.1)); ctx.closePath();
      ctx.stroke();
    }
  }

  /**
   * The ground's material: the painted map, with a fine tiling texture of grass blades worked into it
   * wherever the map is green (gardens, verges, fields), at two scales so the repeat doesn't show:
   * blades about every 2.5 m, and broad lighter and darker patches about every 37 m.
   */
  private groundMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
    const detail = grassDetail();
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.grassDetail = { value: detail };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vTownXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTownXZ = position.xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D grassDetail;\nvarying vec2 vTownXZ;')
        .replace(
          '#include <map_fragment>',
          [
            '#include <map_fragment>',
            // How green the painted map is here: grass gets the full detail, grey and brown ground none.
            'float grassy = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 7.0, 0.0, 1.0);',
            'vec3 blades = texture2D(grassDetail, vTownXZ / 2.5).rgb * 2.0;',
            'vec3 patches = texture2D(grassDetail, vTownXZ / 37.0 + 0.37).rgb * 2.0;',
            'vec3 detail = blades * mix(vec3(1.0), patches, 0.45);',
            'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * detail, grassy);',
          ].join('\n'),
        );
    };
    return mat;
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
        if (kind === 'basin') {
          // A damp, reedy bottom inside the grassy banks.
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = 'rgba(70,95,50,0.55)';
          ctx.lineWidth = 9 * s;
          ctx.stroke();
          ctx.restore();
        }
        if (kind === 'garden' || kind === 'school') {
          ctx.strokeStyle = 'rgba(40,60,20,0.25)';
          ctx.lineWidth = Math.max(1, 0.4 * s);
          ctx.stroke();
        }
        if (kind === 'court') this.courtMarkings(ctx, a.pts, px, s);
        if (kind === 'pitch') {
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = Math.max(1, 0.25 * s);
          ctx.stroke();
        }
      }
    }
    // Driveways from the houses to the street: red block paving, or tarmac.
    ctx.lineCap = 'butt';
    for (const d of town.driveways) {
      ctx.beginPath();
      ctx.moveTo(...px(d.a));
      ctx.lineTo(...px(d.b));
      ctx.strokeStyle = d.paved ? '#a0634c' : '#77736c';
      ctx.lineWidth = 3.2 * s;
      ctx.stroke();
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
