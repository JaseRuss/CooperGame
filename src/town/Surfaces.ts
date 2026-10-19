import * as THREE from 'three';

/**
 * Detail textures for the town's surfaces that have no texture coordinates of their own (the
 * buildings are one big vertex-coloured mesh; fences, hedges and trees are instanced boxes and
 * blobs). The texture is projected from the world position and the way the surface faces, in the
 * shader, and multiplies the surface's own colour (each tile averages mid grey, so it adds detail
 * without shifting the colour):
 *
 * - building: pebble-dash render on the walls, brick on reddish and buff ones, rows of slates on
 *   pitched roofs (the rows follow the eaves); dark surfaces are left plain. (Windows and doors
 *   have their own texture: see Openings.)
 * - planks: vertical timber boards. stone: coursed stone. leaves: clumps of leaves. bark: bark.
 */
export type Detail = 'building' | 'planks' | 'stone' | 'leaves' | 'bark';

function rnd(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function canvas(w: number, h: number, fill: string): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = fill;
  g.fillRect(0, 0, w, h);
  return [c, g];
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, r: () => number, dark: string, light: string, size = 1.5): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? dark : light;
    const s = 0.6 + r() * size;
    g.fillRect(r() * w, r() * h, s, s);
  }
}

function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Pebble-dash render: fine grit, a few small stones, faint streaks (2 m square). */
function render(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256, 'rgb(128,128,128)');
  const r = rnd(3);
  speckle(g, 256, 256, 9000, r, 'rgba(70,70,70,0.35)', 'rgba(200,200,200,0.35)');
  speckle(g, 256, 256, 500, r, 'rgba(60,60,60,0.5)', 'rgba(220,220,220,0.5)', 3);
  for (let i = 0; i < 10; i++) {
    g.fillStyle = 'rgba(90,90,90,0.06)';
    g.fillRect(r() * 256, 0, 6 + r() * 20, 256);
  }
  return tex(c);
}

/** Stretcher-bond brick with lighter mortar (1.8 m square: courses of 75 mm, bricks 225 mm). */
function brick(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512, 'rgb(170,170,165)');
  const r = rnd(8);
  const rows = 24, cols = 8;
  const bh = 512 / rows, bw = 512 / cols;
  for (let y = 0; y < rows; y++) {
    for (let x = -1; x < cols; x++) {
      const v = 95 + r() * 45;
      g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.95})`;
      const ox = (y % 2) * bw * 0.5;
      g.fillRect(x * bw + ox + 2, y * bh + 2, bw - 4, bh - 4);
    }
  }
  speckle(g, 512, 512, 6000, r, 'rgba(50,50,50,0.25)', 'rgba(220,220,220,0.2)');
  return tex(c);
}

/** Rows of slates (2.4 m by 1 m: rows every 250 mm up the roof, slates 300 mm wide, joints staggered). */
function slate(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256, 'rgb(128,128,130)');
  const r = rnd(5);
  const rows = 4, cols = 8;
  const sh = 256 / rows, sw = 512 / cols;
  for (let y = 0; y < rows; y++) {
    for (let x = -1; x < cols; x++) {
      const v = 112 + r() * 34;
      const ox = (y % 2) * sw * 0.5;
      g.fillStyle = `rgb(${v},${v},${v + 4})`;
      g.fillRect(x * sw + ox + 1, y * sh + 1, sw - 2, sh - 2);
      // The shadow along the lower edge, where the next row laps over.
      g.fillStyle = 'rgba(30,30,35,0.45)';
      g.fillRect(x * sw + ox, y * sh + sh - 5, sw, 5);
    }
  }
  speckle(g, 512, 256, 3000, r, 'rgba(40,40,45,0.25)', 'rgba(210,210,215,0.2)');
  return tex(c);
}

/** Vertical timber boards with grain (1.2 m square, boards 150 mm wide). */
function planks(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256, 'rgb(128,128,128)');
  const r = rnd(12);
  const n = 8, w = 256 / n;
  for (let k = 0; k < n; k++) {
    const v = 110 + r() * 40;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(k * w, 0, w, 256);
    g.strokeStyle = 'rgba(60,60,60,0.25)';
    for (let j = 0; j < 6; j++) {
      g.lineWidth = 0.5 + r();
      const x = k * w + 3 + r() * (w - 6);
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (r() - 0.5) * 6, 80, x + (r() - 0.5) * 6, 170, x, 256);
      g.stroke();
    }
    g.fillStyle = 'rgba(30,30,30,0.6)';
    g.fillRect(k * w, 0, 2, 256);
  }
  return tex(c);
}

/** Coursed stone: rough blocks of different lengths in rows, with dark joints (2 m square). */
function stone(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256, 'rgb(80,80,80)');
  const r = rnd(21);
  for (let y = 0; y < 256; ) {
    const h = 22 + r() * 18;
    for (let x = -r() * 40; x < 256; ) {
      const w = 30 + r() * 50;
      const v = 110 + r() * 50;
      g.fillStyle = `rgb(${v},${v},${v - 4})`;
      g.fillRect(x + 2, y + 2, w - 4, h - 4);
      x += w;
    }
    y += h;
  }
  speckle(g, 256, 256, 4000, r, 'rgba(50,50,50,0.3)', 'rgba(220,220,220,0.25)');
  return tex(c);
}

/** Clumps of small leaves, light on top and dark between (1.5 m square). */
function leaves(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256, 'rgb(118,118,118)');
  const r = rnd(33);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 256, y = r() * 256, s = 2 + r() * 5;
    const v = r();
    g.fillStyle = v < 0.35 ? 'rgba(50,50,50,0.5)' : v < 0.75 ? 'rgba(150,150,150,0.55)' : 'rgba(205,205,205,0.5)';
    g.beginPath();
    g.ellipse(x, y, s, s * 0.55, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** Bark: dark ridges running up the trunk (1 m square). */
function bark(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256, 'rgb(128,128,128)');
  const r = rnd(44);
  for (let i = 0; i < 60; i++) {
    const x = r() * 128;
    g.strokeStyle = `rgba(40,40,40,${0.3 + r() * 0.4})`;
    g.lineWidth = 1 + r() * 3;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 32) g.lineTo(x + (r() - 0.5) * 8, y);
    g.stroke();
  }
  speckle(g, 128, 256, 1500, r, 'rgba(50,50,50,0.3)', 'rgba(200,200,200,0.25)');
  return tex(c);
}

const cache = new Map<string, THREE.CanvasTexture>();
function get(name: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = cache.get(name);
  if (!t) cache.set(name, (t = make()));
  return t;
}

/** The surface's horizontal direction along it (for walls and roofs), and its coordinates: across, and up. */
const PROJECT = `
vec3 dN = normalize(vDNormal);
bool dFlat = abs(dN.y) > 0.95;
vec3 dH = dFlat ? vec3(1.0, 0.0, 0.0) : normalize(vec3(dN.z, 0.0, -dN.x));
vec2 dUV = dFlat ? vDPos.xz : vec2(dot(vDPos, dH), vDPos.y);
`;

const FRAGMENT: Record<Detail, string> = {
  building: `${PROJECT}
float dLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
float dRoof = smoothstep(0.3, 0.5, dN.y) * (dFlat ? 0.6 : 1.0);
float dBrick = smoothstep(0.1, 0.22, diffuseColor.r - diffuseColor.b) * (1.0 - dRoof);
vec3 dWall = mix(texture2D(dTexA, dUV / 2.0).rgb, texture2D(dTexB, dUV / 1.8).rgb, dBrick) * 2.0;
vec3 dSlate = texture2D(dTexC, dUV / vec2(2.4, 1.0)).rgb * 2.0;
vec3 dDetail = mix(dWall, dSlate, dRoof);
float dAmount = mix(smoothstep(0.04, 0.2, dLum), 1.0, dRoof);
diffuseColor.rgb *= mix(vec3(1.0), dDetail, dAmount);
`,
  planks: `${PROJECT}
diffuseColor.rgb *= texture2D(dTexA, dUV / 1.2).rgb * 2.0;
`,
  stone: `${PROJECT}
diffuseColor.rgb *= texture2D(dTexA, dUV / 2.0).rgb * 2.0;
`,
  leaves: `
vec3 dN = abs(normalize(vDNormal));
vec3 dW = pow(dN, vec3(4.0));
dW /= (dW.x + dW.y + dW.z);
vec3 dL = texture2D(dTexA, vDPos.zy / 1.5).rgb * dW.x + texture2D(dTexA, vDPos.xz / 1.5).rgb * dW.y + texture2D(dTexA, vDPos.xy / 1.5).rgb * dW.z;
diffuseColor.rgb *= dL * 2.0;
`,
  bark: `
vec3 dN = abs(normalize(vDNormal));
float dU = dN.x > dN.z ? vDPos.z : vDPos.x;
diffuseColor.rgb *= texture2D(dTexA, vec2(dU, vDPos.y) / vec2(0.5, 1.0)).rgb * 2.0;
`,
};

/** Works a detail texture into `mat` (see the notes at the top); returns it. */
export function withDetail<T extends THREE.Material>(mat: T, kind: Detail): T {
  const maps: THREE.Texture[] =
    kind === 'building' ? [get('render', render), get('brick', brick), get('slate', slate)]
    : kind === 'planks' ? [get('planks', planks)]
    : kind === 'stone' ? [get('stone', stone)]
    : kind === 'leaves' ? [get('leaves', leaves)]
    : [get('bark', bark)];
  mat.onBeforeCompile = (shader) => {
    ['dTexA', 'dTexB', 'dTexC'].forEach((name, i) => (shader.uniforms[name] = { value: maps[Math.min(i, maps.length - 1)] }));
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDPos;\nvarying vec3 vDNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vDPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vDNormal = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
#else
  vDPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vDNormal = mat3(modelMatrix) * objectNormal;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D dTexA;\nuniform sampler2D dTexB;\nuniform sampler2D dTexC;\nvarying vec3 vDPos;\nvarying vec3 vDNormal;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT[kind]}`);
  };
  // Each kind compiles its own program.
  mat.customProgramCacheKey = () => `town-detail-${kind}`;
  return mat;
}
