import * as THREE from 'three';
import { PartBuilder } from '../../utils/modelKit';
import { plastic, shade } from '../../utils/plastic';
import { createPoseFigure, type Pose } from '../../entities/Soldier';

/** Shorthands the tableaux are built from. */
export const P = plastic;
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const ball = (r: number, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
export const cyl = (rt: number, rb: number, h: number, s = 14) => new THREE.CylinderGeometry(rt, rb, h, s);

const glowCache = new Map<string, THREE.MeshStandardMaterial>();
/** A lit-up material (lamps, screens, neon), shared per colour and strength. */
export function glow(color: number, intensity = 1.2): THREE.MeshStandardMaterial {
  const key = `${color}-${intensity}`;
  let m = glowCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5 });
    glowCache.set(key, m);
  }
  return m;
}

/** Clear glass for the fishbowl space helmets everyone (and everything) wears up here. */
export const GLASS = new THREE.MeshPhysicalMaterial({
  color: 0xdff0ff,
  transparent: true,
  opacity: 0.26,
  roughness: 0.04,
  metalness: 0,
  clearcoat: 1,
  depthWrite: false,
});

/** Water (bath water, a pond in a crater): flat, glossy and a bit see-through. */
export const WATER = new THREE.MeshPhysicalMaterial({ color: 0x4fb4e8, roughness: 0.08, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.85 });

/** An army man in a space suit, in a pose. Faces -Z, like all the figures. */
export function guy(color: number, pose: Pose = 'stand', space = true): THREE.Mesh {
  return createPoseFigure(color, pose, space);
}

/** Places `obj` at (x, y, z) turned `yaw`, adds it to `parent`, and hands it back. */
export function put<T extends THREE.Object3D>(parent: THREE.Object3D, obj: T, x: number, y: number, z: number, yaw = 0, scale = 1): T {
  obj.position.set(x, y, z);
  obj.rotation.y = yaw;
  obj.scale.setScalar(scale);
  parent.add(obj);
  return obj;
}

/** Merges what `fn` adds into a new group (one mesh per material). */
export function built(fn: (p: PartBuilder) => void, castShadow = true): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  fn(p);
  p.buildInto(g, castShadow);
  return g;
}

export interface SignStyle {
  bg?: string;
  fg?: string;
  border?: string;
  font?: string;
  /** Pixels per metre on the canvas. */
  res?: number;
}

/** A painted board: lines of words, centred, on a coloured background with a border. */
export function signTexture(lines: string[], w: number, h: number, style: SignStyle = {}): THREE.CanvasTexture {
  const res = style.res ?? 96;
  const c = document.createElement('canvas');
  c.width = Math.max(64, Math.round(w * res));
  c.height = Math.max(32, Math.round(h * res));
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = style.bg ?? '#f4efe0';
  ctx.fillRect(0, 0, c.width, c.height);
  const edge = Math.max(4, Math.round(c.height * 0.06));
  ctx.strokeStyle = style.border ?? '#3a3e46';
  ctx.lineWidth = edge;
  ctx.strokeRect(edge / 2, edge / 2, c.width - edge, c.height - edge);
  ctx.fillStyle = style.fg ?? '#2a2c31';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineH = (c.height - edge * 2) / lines.length;
  lines.forEach((line, i) => {
    let size = Math.floor(lineH * 0.78);
    const font = style.font ?? '"Black Ops One", Impact, sans-serif';
    ctx.font = `900 ${size}px ${font}`;
    while (size > 8 && ctx.measureText(line).width > c.width - edge * 4) {
      size -= 2;
      ctx.font = `900 ${size}px ${font}`;
    }
    ctx.fillText(line, c.width / 2, edge + lineH * (i + 0.5));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * A signboard on two posts, readable from both sides, facing +Z (turn it with `yaw`). Its bottom
 * edge is `lift` metres up. Returns the group.
 */
export function signboard(lines: string[], w: number, h: number, style: SignStyle = {}, lift = 1.6, postColor = 0x8b5e38): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: signTexture(lines, w, h, style), roughness: 0.7 });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  front.position.set(0, lift + h / 2, 0.07);
  const back = front.clone();
  back.position.z = -0.07;
  back.rotation.y = Math.PI;
  g.add(front, back);
  const p = new PartBuilder();
  p.add(box(w + 0.2, h + 0.2, 0.12), P(postColor), 0, lift + h / 2, 0);
  for (const x of [-w / 2 + 0.25, w / 2 - 0.25]) p.add(box(0.18, lift + h, 0.18), P(postColor), x, (lift + h) / 2, 0);
  p.buildInto(g);
  return g;
}

/** A flat picture or label on one side only (a TV screen, a menu), facing +Z. */
export function panel(tex: THREE.Texture, w: number, h: number, emissive = false): THREE.Mesh {
  const mat = emissive
    ? new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.8, roughness: 0.6 })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

export type AlienPose = 'wave' | 'stand' | 'sit' | 'cheer' | 'run';

/**
 * A little green alien (about 1.5 m) in the toy style: a big bulb head with three black eyes,
 * two bobbly antennae, a stubby body in a silver jumpsuit with a belt, and thin arms. Faces -Z.
 */
export function alien(pose: AlienPose = 'stand', skin = 0x8ee05a): THREE.Group {
  return built((p) => {
    const s = P(skin);
    const suit = P(0xc8ccd4);
    const dark = P(0x15161a);
    const belt = P(0x7a3cc8);
    const sitting = pose === 'sit';
    const hip = sitting ? 0.45 : 0.62;
    // Legs (bent forward when sitting) and boots.
    for (const x of [-0.12, 0.12]) {
      if (sitting) {
        p.beam(v3(x, hip, 0), v3(x, hip, -0.42), 0.13, suit, true);
        p.beam(v3(x, hip, -0.42), v3(x, 0.08, -0.48), 0.12, suit, true);
        p.add(box(0.16, 0.1, 0.26), dark, x, 0.05, -0.52);
      } else {
        const run = pose === 'run' ? (x > 0 ? 0.3 : -0.3) : 0;
        p.beam(v3(x, hip, 0), v3(x, 0.08, run), 0.13, suit, true);
        p.add(box(0.16, 0.1, 0.26), dark, x, 0.05, run - 0.04);
      }
    }
    p.add(cyl(0.2, 0.24, 0.5, 12), suit, 0, hip + 0.25, 0);
    p.add(cyl(0.25, 0.25, 0.07, 12), belt, 0, hip + 0.06, 0);
    p.add(ball(0.05, 8, 6), glow(0xffe14a, 1.5), 0, hip + 0.06, -0.24);
    p.add(cyl(0.07, 0.08, 0.12, 8), s, 0, hip + 0.56, 0);
    // The head: a big egg with three eyes and a little smile.
    const hy = hip + 0.95;
    p.add(ball(0.36, 18, 14), s, 0, hy, 0, 0, 0, 0, 1, 0.9, 0.95);
    for (const [x, y, r] of [[-0.14, 0.02, 0.085], [0.14, 0.02, 0.085], [0, 0.16, 0.07]]) p.add(ball(r, 10, 8), dark, x, hy + y, -0.3, 0, 0, 0, 1, 1.25, 0.6);
    p.add(new THREE.TorusGeometry(0.08, 0.018, 6, 12, Math.PI), dark, 0, hy - 0.15, -0.32, 0, 0, Math.PI);
    for (const x of [-1, 1]) {
      const tip = v3(x * 0.26, hy + 0.62, 0.02);
      p.beam(v3(x * 0.1, hy + 0.28, 0), tip, 0.03, s, true);
      p.add(ball(0.07, 8, 6), glow(0xff5ac8, 1.1), tip.x, tip.y, tip.z);
    }
    // Arms.
    const sh = hip + 0.44;
    for (const x of [-1, 1]) {
      let hand: THREE.Vector3;
      if (pose === 'wave' && x > 0) hand = v3(0.42, sh + 0.55, -0.05);
      else if (pose === 'cheer') hand = v3(x * 0.38, sh + 0.55, -0.05);
      else if (pose === 'run') hand = v3(x * 0.32, sh + 0.45, -0.1);
      else if (sitting) hand = v3(x * 0.26, sh - 0.12, -0.32);
      else hand = v3(x * 0.3, sh - 0.4, 0.02);
      p.beam(v3(x * 0.2, sh, 0), hand, 0.08, s, true);
      p.add(ball(0.07, 8, 6), s, hand.x, hand.y, hand.z);
    }
  });
}

/** A fishbowl space helmet of radius `r`, open at the bottom, added at (x, y, z). */
export function fishbowl(p: PartBuilder, x: number, y: number, z: number, r: number): void {
  p.add(new THREE.SphereGeometry(r, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.8), GLASS, x, y, z);
  p.add(new THREE.TorusGeometry(r * 0.6, r * 0.06, 6, 20).rotateX(Math.PI / 2), P(0xaeb4bc), x, y - r * 0.8, z);
}

export { shade };

/**
 * A flying saucer about 9 m across: a silver disc with a glass dome, a ring of coloured lights
 * (returned so they can twinkle) and three landing legs. Its base is at y 0 with the legs down.
 */
export function ufo(hull = 0xb8c0cc, legs = true): { group: THREE.Group; lights: THREE.Mesh[]; dome: THREE.Group } {
  const group = new THREE.Group();
  const p = new PartBuilder();
  const metal = P(hull);
  const dark = P(shade(hull, 0.6));
  const y = legs ? 2.2 : 0;
  p.add(ball(4.6, 32, 12), metal, 0, y, 0, 0, 0, 0, 1, 0.26, 1);
  p.add(cyl(4.7, 4.7, 0.25, 40), dark, 0, y, 0);
  p.add(ball(2, 20, 10), dark, 0, y - 0.6, 0, 0, 0, 0, 1, 0.4, 1);
  if (legs) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      p.beam(v3(Math.sin(a) * 2.2, y - 0.4, Math.cos(a) * 2.2), v3(Math.sin(a) * 3.4, 0.15, Math.cos(a) * 3.4), 0.2, dark, true);
      p.add(cyl(0.45, 0.55, 0.15, 10), dark, Math.sin(a) * 3.4, 0.08, Math.cos(a) * 3.4);
    }
  }
  p.buildInto(group);
  const dome = built((d) => {
    d.add(new THREE.SphereGeometry(2.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), GLASS, 0, 0, 0);
  }, false);
  dome.position.y = y + 0.9;
  group.add(dome);
  const lights: THREE.Mesh[] = [];
  const colors = [0xff4a6a, 0xffd24a, 0x5affb0, 0x5ab4ff];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const m = new THREE.Mesh(ball(0.26, 8, 6), new THREE.MeshStandardMaterial({ color: colors[i % 4], emissive: colors[i % 4], emissiveIntensity: 1 }));
    m.position.set(Math.sin(a) * 4.45, y + 0.15, Math.cos(a) * 4.45);
    group.add(m);
    lights.push(m);
  }
  return { group, lights, dome };
}

/** Makes a row of UFO lights chase round. */
export function twinkle(lights: THREE.Mesh[], t: number, speed = 6): void {
  lights.forEach((m, i) => {
    (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 1.5 * Math.max(0, Math.sin(t * speed - i * 0.8));
  });
}

/** A checked cloth (a picnic blanket, a napkin). */
export function checkTexture(a: string, b: string, squares = 8): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const s = 256 / squares;
  for (let i = 0; i < squares; i++) {
    for (let j = 0; j < squares; j++) {
      ctx.fillStyle = (i + j) % 2 ? a : b;
      ctx.fillRect(i * s, j * s, s, s);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** "Only on the Moon" reactions: says `text` once each time the buggy comes within `range`. */
export function greeter(range: number, text: string | string[], color = '#ffd24a'): (ctx: { dist: number; say(t: string, c?: string): void }) => boolean {
  let near = false;
  let n = 0;
  return (ctx) => {
    const now = ctx.dist < range;
    const fresh = now && !near;
    if (fresh) {
      const lines = Array.isArray(text) ? text : [text];
      ctx.say(lines[n++ % lines.length], color);
    }
    near = ctx.dist < range + 8 ? now || near : false;
    return fresh;
  };
}
