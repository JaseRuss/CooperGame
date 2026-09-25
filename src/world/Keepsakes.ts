import * as THREE from 'three';
import type { Keepsake } from '../core/config';
import { plastic } from '../utils/plastic';

const PLINTH_TOP = 1.2;

function plaqueMaterial(text: string): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#c9a441';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#7a5e1c';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = '#3b2a0a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 76;
  do {
    ctx.font = `900 ${size}px "Segoe UI", Georgia, serif`;
    size -= 2;
  } while (ctx.measureText(text).width > 460 && size > 12);
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, metalness: 0.4, roughness: 0.4 });
}

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function heartShape(size: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -size);
  s.bezierCurveTo(size * 1.3, -size * 0.1, size * 0.9, size * 0.95, 0, size * 0.45);
  s.bezierCurveTo(-size * 0.9, size * 0.95, -size * 1.3, -size * 0.1, 0, -size);
  return s;
}

const GOLD = new THREE.MeshPhysicalMaterial({ color: 0xf2c230, metalness: 0.85, roughness: 0.22, clearcoat: 0.6 });
const GOLD_CUP = new THREE.MeshPhysicalMaterial({ color: 0xf2c230, metalness: 0.85, roughness: 0.22, side: THREE.DoubleSide });

function trophy(g: THREE.Group): void {
  const y = PLINTH_TOP;
  add(g, new THREE.CylinderGeometry(1.6, 2, 0.9, 20), GOLD, 0, y + 0.45, 0);
  add(g, new THREE.CylinderGeometry(0.35, 0.5, 2.2, 14), GOLD, 0, y + 2, 0);
  add(g, new THREE.CylinderGeometry(2.3, 0.6, 2.8, 24, 1, true), GOLD_CUP, 0, y + 4.4, 0); // open cup, visible inside
  for (const side of [-1, 1]) {
    const handle = add(g, new THREE.TorusGeometry(0.9, 0.18, 8, 16, Math.PI), GOLD, side * 2.3, y + 4.5, 0);
    handle.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  }
  // A little green tank on top, for the boss.
  const tank = new THREE.Group();
  tank.position.y = y + 5.9;
  g.add(tank);
  const green = plastic(0x4b7a2e);
  add(tank, new THREE.BoxGeometry(1.4, 0.5, 2.2), green, 0, 0.25, 0);
  add(tank, new THREE.CylinderGeometry(0.5, 0.55, 0.4, 12), green, 0, 0.7, 0);
  add(tank, new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8).rotateX(Math.PI / 2), green, 0, 0.75, -0.8);
}

function hearts(g: THREE.Group): void {
  const red = plastic(0xe0405a);
  const pink = plastic(0xf58fb0);
  const big = add(g, new THREE.ExtrudeGeometry(heartShape(2.2), { depth: 0.7, bevelEnabled: true, bevelSize: 0.2, bevelThickness: 0.2 }), red, 0, PLINTH_TOP + 3.4, -0.35);
  big.rotation.z = Math.PI;
  big.rotation.y = Math.PI;
  const small = add(g, new THREE.ExtrudeGeometry(heartShape(1.2), { depth: 0.5, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15 }), pink, 1.8, PLINTH_TOP + 1.6, 0.6);
  small.rotation.z = Math.PI + 0.3;
  small.rotation.y = Math.PI;
  // A ring of flowers around the plinth top.
  const colors = [0xf2c230, 0xff6fa3, 0xffffff, 0xb07cff, 0xff8a3d];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x = Math.cos(a) * 3;
    const z = Math.sin(a) * 3;
    add(g, new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), plastic(0x3e8a3a), x, PLINTH_TOP + 0.7, z);
    const bloom = add(g, new THREE.CylinderGeometry(0.5, 0.5, 0.12, 10), plastic(colors[i % colors.length]), x, PLINTH_TOP + 1.45, z);
    bloom.rotation.x = 0.3;
    add(g, new THREE.SphereGeometry(0.2, 8, 6), plastic(0xf2c230), x, PLINTH_TOP + 1.55, z);
  }
}

function barbecue(g: THREE.Group): void {
  const black = plastic(0x2a2a2a);
  const y = PLINTH_TOP;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = add(g, new THREE.CylinderGeometry(0.12, 0.12, 3, 8), black, Math.cos(a) * 1.3, y + 1.4, Math.sin(a) * 1.3);
    leg.rotation.z = Math.cos(a) * 0.25;
    leg.rotation.x = -Math.sin(a) * 0.25;
  }
  add(g, new THREE.SphereGeometry(2.3, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), black, 0, y + 3.6, 0);
  const lid = add(g, new THREE.SphereGeometry(2.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), black, 0, y + 4.1, -0.9);
  lid.rotation.x = -0.9; // propped open
  add(g, new THREE.CylinderGeometry(2.25, 2.25, 0.08, 20), plastic(0x9a9a9a), 0, y + 3.65, 0);
  const sausage = plastic(0xb5562e);
  for (let i = 0; i < 4; i++) {
    const s = add(g, new THREE.CapsuleGeometry(0.28, 1.4, 4, 8).rotateZ(Math.PI / 2), sausage, 0, y + 3.95, -1.2 + i * 0.8);
    s.rotation.y = (i - 1.5) * 0.15;
  }
  const spatula = add(g, new THREE.BoxGeometry(0.12, 3.2, 0.12), plastic(0x8a5a2a), 2.8, y + 2.5, 0.8);
  spatula.rotation.z = -0.35;
  add(g, new THREE.BoxGeometry(0.8, 0.05, 1), plastic(0xc0c0c0), 3.35, y + 4, 0.8);
}

/** Inness: a toy T-rex, roaring at the road. */
function dinosaur(g: THREE.Group): void {
  const skin = plastic(0x4caf50);
  const belly = plastic(0xc5e17a);
  const spikes = plastic(0xf2a33a);
  const white = plastic(0xffffff);
  const dark = plastic(0x1a1a1a);
  const y = PLINTH_TOP;
  // Body leans forward (+Z), tail sweeps back for balance.
  const body = add(g, new THREE.SphereGeometry(1.8, 20, 14), skin, 0, y + 3.4, 0);
  body.scale.set(1, 1.1, 1.5);
  body.rotation.x = 0.35;
  add(g, new THREE.SphereGeometry(1.2, 16, 12), belly, 0, y + 3.1, 0.9).scale.set(1, 1.2, 0.6);
  const tail = add(g, new THREE.ConeGeometry(1.2, 5, 14).rotateX(-Math.PI / 2), skin, 0, y + 2.6, -3.6);
  tail.rotation.x = -0.25;
  const neck = add(g, new THREE.CylinderGeometry(0.9, 1.2, 2, 14), skin, 0, y + 5.1, 1.4);
  neck.rotation.x = 0.5;
  const head = add(g, new THREE.BoxGeometry(1.9, 1.5, 2.8), skin, 0, y + 6.3, 2.6);
  head.rotation.x = -0.15;
  const jaw = add(g, new THREE.BoxGeometry(1.7, 0.5, 2.4), skin, 0, y + 5.35, 2.9);
  jaw.rotation.x = 0.35; // mouth open mid-roar
  for (let i = 0; i < 5; i++) {
    const tooth = add(g, new THREE.ConeGeometry(0.12, 0.35, 6).rotateX(Math.PI), white, -0.6 + i * 0.3, y + 5.85, 3.8);
    tooth.rotation.x = Math.PI - 0.1;
  }
  for (const side of [-1, 1]) {
    add(g, new THREE.SphereGeometry(0.22, 10, 8), white, side * 0.7, y + 6.8, 2.9);
    add(g, new THREE.SphereGeometry(0.12, 8, 6), dark, side * 0.78, y + 6.82, 3.05);
    // Big legs, tiny arms.
    const thigh = add(g, new THREE.CapsuleGeometry(0.75, 1.4, 4, 10), skin, side * 1.2, y + 2, -0.3);
    thigh.rotation.x = 0.4;
    add(g, new THREE.CapsuleGeometry(0.45, 1.2, 4, 8), skin, side * 1.25, y + 0.8, 0.2);
    add(g, new THREE.BoxGeometry(0.9, 0.3, 1.4), skin, side * 1.25, y + 0.15, 0.6);
    const arm = add(g, new THREE.CapsuleGeometry(0.18, 0.7, 4, 6), skin, side * 1, y + 4, 1.8);
    arm.rotation.x = -0.9;
  }
  for (let i = 0; i < 7; i++) {
    const spike = add(g, new THREE.ConeGeometry(0.35, 0.8, 6), spikes, 0, y + 5.2 - i * 0.45, 0.6 - i * 0.85);
    spike.rotation.x = -0.4;
  }
}

function yarn(g: THREE.Group): void {
  const wool = plastic(0xe86aa6);
  const y = PLINTH_TOP;
  add(g, new THREE.SphereGeometry(2.4, 24, 18), wool, 0, y + 2.4, 0);
  // Wraps of yarn around the ball.
  for (let i = 0; i < 7; i++) {
    const wrap = add(g, new THREE.TorusGeometry(2.42, 0.09, 6, 40), plastic(0xd9558f), 0, y + 2.4, 0);
    wrap.rotation.set(i * 0.45, i * 0.8, i * 0.3);
  }
  for (const side of [-1, 1]) {
    const needle = add(g, new THREE.CylinderGeometry(0.12, 0.12, 7, 8), plastic(0xc8c8d0), side * 0.6, y + 4.2, 0);
    needle.rotation.z = side * 0.55;
    add(g, new THREE.SphereGeometry(0.35, 10, 8), plastic(0x6a9fd8), side * 0.6 + Math.sin(side * 0.55) * -3.5, y + 4.2 + Math.cos(side * 0.55) * 3.5, 0);
  }
  // A dangling strand trailing off the plinth.
  const strand = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.8, y + 1, 1.2),
    new THREE.Vector3(3.2, y + 0.3, 2),
    new THREE.Vector3(3.6, y - 0.6, 3.6),
    new THREE.Vector3(4.2, -0.9 + y - 0.3, 4.8),
  ]);
  add(g, new THREE.TubeGeometry(strand, 20, 0.09, 6), wool, 0, 0, 0);
}

/** Grandpa: a putting green with a giant ball on a tee, a club and the pin flag. */
function golf(g: THREE.Group): void {
  const y = PLINTH_TOP;
  const green = new THREE.Mesh(
    new THREE.CylinderGeometry(3.3, 3.3, 0.12, 32),
    plastic(0x5fbf4a),
  );
  green.position.y = y + 0.06;
  green.receiveShadow = true;
  g.add(green);
  add(g, new THREE.CylinderGeometry(0.35, 0.35, 0.14, 16), plastic(0x1a1a1a), 1.8, y + 0.1, -1.5); // the hole

  // Tee and a dimpled ball.
  add(g, new THREE.CylinderGeometry(0.4, 0.15, 1.4, 12), plastic(0xf2c230), -0.8, y + 0.8, 0.8);
  add(g, new THREE.SphereGeometry(1.6, 24, 18), plastic(0xfafafa), -0.8, y + 3, 0.8);
  const dimple = plastic(0xe2e2e2);
  const dirs = new THREE.IcosahedronGeometry(1, 1).attributes.position;
  const seen = new Set<string>();
  for (let i = 0; i < dirs.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(dirs, i).normalize();
    const key = v.toArray().map((n) => n.toFixed(2)).join();
    if (seen.has(key) || v.y < -0.6) continue;
    seen.add(key);
    add(g, new THREE.SphereGeometry(0.18, 8, 6), dimple, -0.8 + v.x * 1.52, y + 3 + v.y * 1.52, 0.8 + v.z * 1.52).scale.set(1, 1, 0.4);
  }

  // Pin flag in the hole.
  add(g, new THREE.CylinderGeometry(0.07, 0.07, 6, 8), plastic(0xf4f4f0), 1.8, y + 3, -1.5);
  const flag = add(g, new THREE.PlaneGeometry(1.8, 1.1).translate(0.9, 0, 0), new THREE.MeshStandardMaterial({ color: 0xd63a3a, side: THREE.DoubleSide }), 1.85, y + 5.4, -1.5);
  flag.rotation.y = -0.3;

  // A club leaning against the ball.
  const shaft = add(g, new THREE.CylinderGeometry(0.06, 0.06, 5, 8), plastic(0xb8bcc4), 1.3, y + 2.4, 1.6);
  shaft.rotation.z = 0.35;
  add(g, new THREE.CylinderGeometry(0.14, 0.14, 1, 8), plastic(0x1a1a1a), 0.45, y + 4.65, 1.6).rotation.z = 0.35;
  add(g, new THREE.BoxGeometry(0.9, 0.35, 0.25), plastic(0xb8bcc4), 2.25, y + 0.25, 1.6);
}

function cupcake(g: THREE.Group): void {
  const y = PLINTH_TOP;
  add(g, new THREE.CylinderGeometry(2.4, 1.8, 2.6, 18), plastic(0xf58fb0), 0, y + 1.3, 0);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const rib = add(g, new THREE.BoxGeometry(0.12, 2.6, 0.12), plastic(0xe06a94), Math.cos(a) * 2.1, y + 1.3, Math.sin(a) * 2.1);
    rib.rotation.set(Math.sin(a) * 0.23, 0, -Math.cos(a) * 0.23);
  }
  const frost = plastic(0xfff3f8);
  add(g, new THREE.TorusGeometry(2.1, 0.7, 10, 28).rotateX(Math.PI / 2), frost, 0, y + 2.9, 0);
  add(g, new THREE.TorusGeometry(1.4, 0.65, 10, 24).rotateX(Math.PI / 2), frost, 0, y + 3.7, 0);
  add(g, new THREE.SphereGeometry(1.05, 16, 12), frost, 0, y + 4.3, 0);
  add(g, new THREE.SphereGeometry(0.55, 14, 10), plastic(0xd8243a), 0, y + 5.4, 0);
  // Sprinkles.
  const sprinkleColors = [0xf2c230, 0x5ab8e6, 0x7ad35a, 0xb07cff];
  for (let i = 0; i < 24; i++) {
    const a = i * 2.4;
    const r = 1 + (i % 3) * 0.5;
    const s = add(g, new THREE.CapsuleGeometry(0.07, 0.3, 2, 4), plastic(sprinkleColors[i % 4]), Math.cos(a) * r, y + 3.3 + (i % 4) * 0.25, Math.sin(a) * r);
    s.rotation.set(a, a * 0.5, 0);
  }
  add(g, new THREE.CylinderGeometry(0.15, 0.15, 1.4, 8), plastic(0x5ab8e6), 0.9, y + 5.1, 0.3);
  add(g, new THREE.ConeGeometry(0.2, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xffb040 }), 0.9, y + 6.05, 0.3);
}

function football(g: THREE.Group): void {
  const y = PLINTH_TOP;
  const white = plastic(0xf8f8f8);
  add(g, new THREE.SphereGeometry(1.8, 24, 18), white, 0, y + 1.8, 0.4);
  const black = plastic(0x1a1a1a);
  const patches = new THREE.IcosahedronGeometry(1, 0).attributes.position;
  const seen = new Set<string>();
  for (let i = 0; i < patches.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(patches, i).normalize();
    const key = v.toArray().map((n) => n.toFixed(2)).join();
    if (seen.has(key)) continue;
    seen.add(key);
    const p = add(g, new THREE.CylinderGeometry(0.45, 0.45, 0.1, 5), black, v.x * 1.76, y + 1.8 + v.y * 1.76, 0.4 + v.z * 1.76);
    p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
  }
  // Goal behind the ball.
  const post = plastic(0xffffff);
  for (const side of [-1, 1]) add(g, new THREE.CylinderGeometry(0.12, 0.12, 4.4, 8), post, side * 3.2, y + 2.2, -2.2);
  add(g, new THREE.CylinderGeometry(0.12, 0.12, 6.4, 8).rotateZ(Math.PI / 2), post, 0, y + 4.4, -2.2);
  const net = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 4.4, 1.6, 12, 8, 3),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.55 }),
  );
  net.position.set(0, y + 2.2, -3);
  g.add(net);
}

const BUILDERS: Record<Keepsake, (g: THREE.Group) => void> = {
  trophy,
  hearts,
  barbecue,
  dinosaur,
  yarn,
  golf,
  cupcake,
  football,
};

/** A keepsake on a stone plinth with a brass name plaque on its front (+Z) face. */
export function buildKeepsake(kind: Keepsake, name: string): THREE.Group {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(7, PLINTH_TOP, 7), plastic(0xcfc8b8), 0, PLINTH_TOP / 2, 0);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.1), plaqueMaterial(name.toUpperCase()));
  plaque.position.set(0, PLINTH_TOP / 2, 3.51);
  g.add(plaque);
  BUILDERS[kind](g);
  return g;
}
