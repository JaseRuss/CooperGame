import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PartBuilder, sandbagGeometry } from '../utils/modelKit';
import { plastic } from '../utils/plastic';
import type { Pt } from './TownData';

/** The upgrades waiting at the supply depot. */
export type Upgrade = 'rifle' | 'armour' | 'launcher';

export const UPGRADE_NAME: Record<Upgrade, string> = { rifle: 'ASSAULT RIFLE', armour: 'BODY ARMOUR', launcher: 'GRENADE LAUNCHER' };

export interface Depot {
  at: Pt;
  /** Each upgrade's table: where to stand, and the model on it (hidden once everyone playing has taken it). */
  tables: { kind: Upgrade; at: Pt; item: THREE.Group }[];
  /** Posts for its guards. */
  posts: Pt[];
  /** Spins and bobs the models on the tables. */
  update(time: number): void;
}

type Ground = (x: number, z: number) => number;

/** A turning frame at (at, facing toward `toward`): s across, t toward it. */
function frame(at: Pt, toward: Pt) {
  let fx = toward.x - at.x, fz = toward.z - at.z;
  const l = Math.hypot(fx, fz) || 1;
  fx /= l;
  fz /= l;
  const yaw = Math.atan2(-fx, -fz);
  const P = (s: number, t: number): Pt => ({ x: at.x - fz * s + fx * t, z: at.z + fx * s + fz * t });
  return { fx, fz, yaw, P };
}

function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = 'rgba(20,28,16,0.85)';
  g.fillRect(0, 0, 512, 96);
  g.strokeStyle = '#ffd24a';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 506, 90);
  g.fillStyle = '#ffd24a';
  g.font = '900 46px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  s.scale.set(2.4, 0.45, 1);
  return s;
}

/** The three upgrades as models: a rifle, a vest and a launcher, about life size. */
function itemModel(kind: Upgrade): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const steel = plastic(0x2f3236), olive = plastic(0x4f5a32), wood = plastic(0x6b4a2e);
  if (kind === 'rifle') {
    p.add(new THREE.BoxGeometry(0.07, 0.13, 0.55), steel, 0, 0, 0);
    p.add(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 8).rotateX(Math.PI / 2), steel, 0, 0.03, -0.5);
    p.add(new THREE.BoxGeometry(0.05, 0.2, 0.09), steel, 0, -0.14, -0.08, 0.25);
    p.add(new THREE.BoxGeometry(0.06, 0.12, 0.3), olive, 0, -0.03, 0.4);
    p.add(new THREE.BoxGeometry(0.05, 0.06, 0.22), olive, 0, 0.0, -0.3);
    p.add(new THREE.BoxGeometry(0.03, 0.05, 0.12), steel, 0, 0.1, 0.02);
  } else if (kind === 'armour') {
    p.add(new THREE.BoxGeometry(0.5, 0.56, 0.24), olive, 0, 0, 0);
    for (const x of [-0.15, 0, 0.15]) p.add(new THREE.BoxGeometry(0.12, 0.14, 0.08), plastic(0x3f4a26), x, -0.12, -0.14);
    p.add(new THREE.BoxGeometry(0.14, 0.12, 0.26), olive, -0.18, 0.31, 0);
    p.add(new THREE.BoxGeometry(0.14, 0.12, 0.26), olive, 0.18, 0.31, 0);
    p.add(new THREE.BoxGeometry(0.4, 0.04, 0.02), plastic(0x2a2f1c), 0, 0.12, -0.125);
  } else {
    p.add(new THREE.CylinderGeometry(0.075, 0.075, 0.55, 12).rotateX(Math.PI / 2), steel, 0, 0.04, -0.2);
    p.add(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 12).rotateX(Math.PI / 2), olive, 0, 0.0, 0.12);
    p.add(new THREE.BoxGeometry(0.06, 0.18, 0.08), steel, 0, -0.14, 0.2, 0.25);
    p.add(new THREE.BoxGeometry(0.06, 0.12, 0.32), wood, 0, -0.02, 0.38);
  }
  p.buildInto(g);
  return g;
}

/**
 * The enemy's supply depot, out in the south-west corner: a dirt yard with a canvas tent, stacks
 * of ammo crates, a ring of sandbags, the enemy's flag, and three trestle tables each with an
 * upgrade on it (an assault rifle, body armour and a grenade launcher), labelled and turning
 * slowly over a glowing ring so they can be seen from the road.
 */
export function buildDepot(parent: THREE.Object3D, world: RAPIER.World, ground: Ground, at: Pt, toward: Pt, armyColor: number): Depot {
  const { yaw, P } = frame(at, toward);
  const p = new PartBuilder();
  const G = (s: number, t: number) => {
    const q = P(s, t);
    return ground(q.x, q.z);
  };
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, s: number, t: number, y: number, ry = 0) => {
    const q = P(s, t);
    p.add(geo, m, q.x, G(s, t) + y, q.z, 0, yaw + ry, 0);
  };
  const rot = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
  const box = (s: number, t: number, y: number, hx: number, hy: number, hz: number, ry = 0) => {
    const q = P(s, t);
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(q.x, G(s, t) + y, q.z).setRotation(rot(yaw + ry)));
  };

  // The yard.
  const dirt = new THREE.Mesh(
    new THREE.CircleGeometry(11, 28).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x7d6a4e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  dirt.position.set(at.x, ground(at.x, at.z) + 0.06, at.z);
  dirt.receiveShadow = true;
  parent.add(dirt);

  // The tent at the back: a canvas ridge tent on poles, built in its own frame (x across, -z toward the road).
  const canvas = plastic(0x5d6b3e), pole = plastic(0x6b4a2e);
  const canvasDark = new THREE.MeshStandardMaterial({ color: 0x4c5832, roughness: 0.8, side: THREE.DoubleSide });
  const tt = -6.5;
  const tent = new THREE.Group();
  const tp = new PartBuilder();
  const slope = Math.atan2(1.6, 2.2);
  for (const side of [-1, 1]) tp.add(new THREE.BoxGeometry(5.4, 0.05, 2.75).rotateX(side * slope), canvas, 0, 1.87, side * 1.1);
  for (const x of [-2.6, 2.6]) {
    tp.add(new THREE.CylinderGeometry(0.06, 0.06, 2.7, 6), pole, x, 1.35, 0);
    for (const z of [-2.2, 2.2]) tp.add(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), pole, x, 0.6, z);
    tp.add(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-2.2, 0), new THREE.Vector2(2.2, 0), new THREE.Vector2(0, 2.65)])).rotateY(Math.PI / 2), canvasDark, x, 0.02, 0);
  }
  tp.buildInto(tent);
  const tq = P(0, tt);
  tent.position.set(tq.x, G(0, tt), tq.z);
  tent.rotation.y = yaw;
  parent.add(tent);
  box(0, tt, 1.2, 2.7, 1.2, 2.3);

  // Stacks of ammo crates either side of the tent.
  const crate = new THREE.BoxGeometry(1.0, 0.55, 0.6);
  const crateMat = plastic(0x5a6b3a), crateDark = plastic(0x4a5a30);
  for (const s of [-5.5, 5.5]) {
    for (let row = 0; row < 3; row++) for (let k = 0; k < 3 - row; k++) put(crate, (row + k) % 2 ? crateDark : crateMat, s + (k - (2 - row) / 2) * 1.05, -4.5, 0.28 + row * 0.56);
    box(s, -4.5, 0.85, 1.6, 0.85, 0.35);
  }
  // Oil drums.
  const drum = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12);
  for (const [s, t] of [[-7.2, -1.5], [-7.0, -0.8], [7.3, -1.2]]) {
    put(drum, plastic(0x3a5a7a), s, t, 0.45);
    box(s, t, 0.45, 0.3, 0.45, 0.3);
  }

  // A low ring of sandbags round the back half of the yard, open toward the road.
  const bag = sandbagGeometry();
  const bagMat = plastic(0xb5a47a), bagDark = plastic(0xa39368);
  for (let j = 0; j < 24; j++) {
    const a = Math.PI * 0.12 + (j / 23) * Math.PI * 0.76;
    const s = Math.cos(a) * 10, t = -Math.sin(a) * 9.5 + 0.5;
    for (let row = 0; row < 2; row++) put(bag, row ? bagDark : bagMat, s, t, 0.2 + row * 0.38, -a - Math.PI / 2 + row * 0.05);
    box(s, t, 0.45, 0.55, 0.45, 0.3, -a - Math.PI / 2);
  }

  // The enemy's flag on a pole.
  put(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), plastic(0xdedede), 4.6, -7.6, 3);
  const flagQ = P(4.6, -7.6);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1).translate(0.82, 0, 0), new THREE.MeshStandardMaterial({ color: armyColor, side: THREE.DoubleSide }));
  flag.position.set(flagQ.x, G(4.6, -7.6) + 5.4, flagQ.z);
  flag.rotation.y = yaw;
  parent.add(flag);

  // The three tables, side by side at the front of the yard, each with its upgrade.
  const kinds: Upgrade[] = ['rifle', 'armour', 'launcher'];
  const top = plastic(0x8a6a44), leg = plastic(0x5a4028);
  const ring = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const tables: Depot['tables'] = [];
  kinds.forEach((kind, i) => {
    const s = (i - 1) * 3.2, t = -0.5;
    put(new THREE.BoxGeometry(1.7, 0.08, 0.9), top, s, t, 0.85);
    for (const [ds, dt] of [[-0.75, -0.35], [0.75, -0.35], [-0.75, 0.35], [0.75, 0.35]]) {
      const q = P(s + ds, t + dt);
      p.add(new THREE.BoxGeometry(0.07, 0.85, 0.07), leg, q.x, G(s, t) + 0.42, q.z, 0, yaw, 0);
    }
    box(s, t, 0.45, 0.85, 0.45, 0.45);
    const q = P(s, t);
    const y = G(s, t);
    const item = itemModel(kind);
    item.position.set(q.x, y + 1.35, q.z);
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 28).rotateX(-Math.PI / 2), ring);
    glow.position.set(0, -0.45, 0);
    item.add(glow);
    const tag = label(UPGRADE_NAME[kind]);
    tag.position.set(0, 0.85, 0);
    item.add(tag);
    parent.add(item);
    // The way to stand to pick it up: in front of the table.
    tables.push({ kind, at: P(s, t + 1.1), item });
  });

  p.buildInto(parent);

  const posts = [P(-4, 3), P(4, 3), P(-8, -3), P(8, -2.5), P(0, -9.5)];
  return {
    at,
    tables,
    posts,
    update(time: number) {
      tables.forEach((tb, i) => (tb.item.rotation.y = time * 0.9 + i));
    },
  };
}

/**
 * A sandbagged machine-gun nest at `at`, its gun facing `toward`: a ring of bags open at the back,
 * and the gun on its tripod (it turns to follow the gunner's aim).
 */
export function buildNest(parent: THREE.Object3D, world: RAPIER.World, ground: Ground, at: Pt, toward: Pt): { gunner: Pt; gun: THREE.Group } {
  const { yaw, P } = frame(at, toward);
  const p = new PartBuilder();
  const bag = sandbagGeometry();
  const bagMat = plastic(0xb5a47a), bagDark = plastic(0xa39368);
  const rot = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
  for (let j = 0; j < 11; j++) {
    const a = -Math.PI * 0.8 + (j / 10) * Math.PI * 1.6;
    const s = Math.sin(a) * 1.7, t = Math.cos(a) * 1.7;
    const q = P(s, t);
    const g = ground(q.x, q.z);
    for (let row = 0; row < 3; row++) p.add(bag, row % 2 ? bagDark : bagMat, q.x, g + 0.2 + row * 0.38, q.z, 0, yaw - a + (row % 2) * 0.05, 0);
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.6, 0.32).setTranslation(q.x, g + 0.6, q.z).setRotation(rot(yaw - a)));
  }
  p.buildInto(parent);
  const gun = new THREE.Group();
  const gp = new PartBuilder();
  const steel = plastic(0x3a3d40);
  const olive = plastic(0x4f5a32);
  gp.add(new THREE.BoxGeometry(0.22, 0.24, 0.7), steel, 0, 0.05, 0);
  gp.add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8).rotateX(Math.PI / 2), steel, 0, 0.08, -0.85);
  gp.add(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8).rotateX(Math.PI / 2), steel, 0, 0.08, -0.5);
  gp.add(new THREE.BoxGeometry(0.3, 0.2, 0.25), olive, 0.24, -0.02, 0.05);
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) gp.add(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 5), steel, Math.sin(a) * 0.3, -0.4, Math.cos(a) * 0.3, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
  gp.buildInto(gun);
  const gq = P(0, 0.6);
  gun.position.set(gq.x, ground(gq.x, gq.z) + 0.95, gq.z);
  gun.rotation.y = yaw;
  parent.add(gun);
  return { gunner: P(0, -0.3), gun };
}
