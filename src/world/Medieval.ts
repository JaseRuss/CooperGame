import * as THREE from 'three';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';
import { plastic, shade } from '../utils/plastic';

/**
 * The knights mission's buildings, all made in code: castle walls and towers, keeps, great halls,
 * forges, powder stores, watchtowers, trebuchets, hay carts and village cottages. Each model is
 * built once per look and shared (every copy gets its own meshes over the same geometry, so it
 * can collapse on its own). Models stand on y = 0; the front faces +Z.
 */

export const STONE = 0xb9b2a3;
export const STONE_DARK = 0x938c7e;
export const WOOD = 0x8b5e38;
export const WOOD_DARK = 0x5a3b24;
const PLASTER = 0xefe4c8;
const THATCH = 0xcfa85a;
const IRON = 0x4a4d52;
const GLOOM = 0x2a2620;
const HAY = 0xe3c45a;

const stone = () => plastic(STONE);
const stoneDark = () => plastic(STONE_DARK);
const wood = () => plastic(WOOD);
const woodDark = () => plastic(WOOD_DARK);
const gloom = () => plastic(GLOOM);

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

const shapeCache = new Map<string, Map<THREE.Material, THREE.BufferGeometry>>();

/** A fresh group of meshes over the shared geometry for `key`, building it the first time. */
function model(key: string, build: (p: PartBuilder) => void): THREE.Group {
  let geos = shapeCache.get(key);
  if (!geos) {
    const p = new PartBuilder();
    build(p);
    geos = p.buildGeometries();
    shapeCache.set(key, geos);
  }
  const g = new THREE.Group();
  for (const [mat, geo] of geos) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

/** A triangular prism `w` wide and `h` tall, running `d` along Z (a gable end or a roof core). */
function prism(w: number, h: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

/**
 * A pitched roof with its ridge along Z: a prism for the gable ends and two thick slabs over it
 * that overhang the walls. `y` is the eaves height.
 */
function gableRoof(p: PartBuilder, w: number, d: number, h: number, y: number, gable: THREE.Material, roof: THREE.Material, overhang = 0.7, thick = 0.35): void {
  p.add(prism(w, h, d), gable, 0, y, 0);
  const run = Math.hypot(w / 2, h);
  const slope = Math.atan2(h, w / 2);
  for (const s of [-1, 1]) {
    // Centre of the slope, slid down toward the eaves by half the overhang and out by half the thickness.
    const x = (s * w) / 4 + ((s * w) / 2 / run) * (overhang / 2) + ((s * h) / run) * (thick / 2);
    const yy = y + h / 2 - (h / run) * (overhang / 2) + (w / 2 / run) * (thick / 2);
    p.add(box(run + overhang, thick, d + overhang * 2), roof, x, yy, 0, 0, 0, -s * slope);
  }
  p.add(tubeZ(thick * 0.9, thick * 0.9, d + overhang * 2, 8), roof, 0, y + h + thick * 0.4, 0); // ridge
}

/** Merlons along a run from (x0, z0) to (x1, z1) at height y, every `gap` metres. */
function merlons(p: PartBuilder, mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y: number, size = 1.2, gap = 2.4): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.floor(len / gap));
  const along = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    p.add(box(size * 0.6, size, size), mat, x0 + (x1 - x0) * t, y + size / 2, z0 + (z1 - z0) * t, 0, along);
  }
}

/** A ring of merlons round a round tower's top. */
function merlonRing(p: PartBuilder, mat: THREE.Material, r: number, y: number, count: number, size = 1.1): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    p.add(box(size, size, size * 0.6), mat, Math.cos(a) * r, y + size / 2, Math.sin(a) * r, 0, -a + Math.PI / 2);
  }
}

/** A dark arched opening (window or slit) on a face whose outward normal is +Z, rotated by `ry`. */
function archedOpening(p: PartBuilder, w: number, h: number, x: number, y: number, z: number, ry = 0): void {
  const q = new THREE.Vector3(x, y, z);
  p.add(box(w, h, 0.2), gloom(), q.x, q.y, q.z, 0, ry);
  p.add(new THREE.CylinderGeometry(w / 2, w / 2, 0.2, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(ry), gloom(), q.x, q.y + h / 2, q.z);
}

/** A pennant on a pole above `y`. */
function pennant(p: PartBuilder, color: number, x: number, y: number, z: number, pole = 3): void {
  p.add(new THREE.CylinderGeometry(0.07, 0.09, pole, 6), woodDark(), x, y + pole / 2, z);
  const flag = new THREE.BufferGeometry();
  flag.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2.2, -0.45, 0, 0, -0.9, 0, 0, 0, 0, 0, -0.9, 0, 2.2, -0.45, 0], 3));
  flag.computeVertexNormals();
  p.add(flag, plastic(color), x + 0.08, y + pole - 0.05, z);
  p.add(new THREE.SphereGeometry(0.16, 8, 6), plastic(0xd9a520), x, y + pole + 0.1, z);
}

// ---------- castle walls and towers ----------

export const WALL_HEIGHT = 8;
export const WALL_THICK = 2.6;

/** A curtain-wall section `length` long along X: plinth, coursed stone, arrow slits and battlements (outer face +Z). */
export function buildWallSegment(length: number): THREE.Group {
  return model(`wall-${length.toFixed(1)}`, (p) => {
    const H = WALL_HEIGHT;
    const T = WALL_THICK;
    p.add(box(length, H, T), stone(), 0, H / 2, 0);
    p.add(box(length, 1, T + 0.9), stoneDark(), 0, 0.5, 0); // plinth
    p.add(box(length, 0.35, T + 0.5), stoneDark(), 0, H + 0.1, 0); // walkway
    p.add(box(length, 0.9, 0.5), stone(), 0, H + 0.7, -T / 2 + 0.1); // inner parapet
    merlons(p, stone(), -length / 2 + 0.6, T / 2 - 0.2, length / 2 - 0.6, T / 2 - 0.2, H + 0.25, 1.4, 2.6);
    // Mortar courses and staggered joints on both faces, so it reads as big stone blocks.
    for (const face of [-1, 1]) {
      for (let row = 1; row <= 5; row++) {
        const y = 1 + row * 1.2;
        p.add(box(length, 0.08, 0.06), stoneDark(), 0, y, face * (T / 2 + 0.01));
        for (let x = -length / 2 + (row % 2) * 1.3 + 1.3; x < length / 2 - 0.4; x += 2.6) {
          p.add(box(0.08, 1.2, 0.06), stoneDark(), x, y - 0.6, face * (T / 2 + 0.01));
        }
      }
    }
    for (let x = -length / 2 + 6; x < length / 2 - 3; x += 9) archedOpening(p, 0.45, 1.6, x, 5, T / 2 + 0.02);
    for (let x = -length / 2 + 10; x < length / 2 - 5; x += 16) p.add(box(1.6, H - 1, 1.2), stoneDark(), x, (H - 1) / 2, -T / 2 - 0.5); // buttresses
  });
}

/** A round corner tower with a band of battlements and a pointed roof in the army's colour. */
export function buildRoundTower(color: number, radius = 6, height = 13): THREE.Group {
  return model(`tower-${color}-${radius}-${height}`, (p) => {
    p.add(new THREE.CylinderGeometry(radius, radius + 0.6, height, 22), stone(), 0, height / 2, 0);
    p.add(new THREE.CylinderGeometry(radius + 0.9, radius + 0.9, 1, 22), stoneDark(), 0, 0.5, 0);
    for (let y = 2.2; y < height - 1; y += 2.2) p.add(new THREE.CylinderGeometry(radius + 0.62 - (y / height) * 0.6, radius + 0.62 - (y / height) * 0.6, 0.1, 22), stoneDark(), 0, y, 0);
    p.add(new THREE.CylinderGeometry(radius + 0.6, radius + 0.3, 0.9, 22), stoneDark(), 0, height + 0.2, 0); // corbelled rim
    merlonRing(p, stone(), radius + 0.2, height + 0.6, 14, 1.3);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      archedOpening(p, 0.5, 1.6, Math.sin(a) * (radius + 0.05), height * 0.6, Math.cos(a) * (radius + 0.05), a);
    }
    const roofH = radius * 1.9;
    p.add(new THREE.ConeGeometry(radius + 0.7, roofH, 22), plastic(color), 0, height + 1.2 + roofH / 2, 0);
    p.add(new THREE.CylinderGeometry(radius + 0.8, radius + 0.8, 0.3, 22), plastic(shade(color, 0.7)), 0, height + 1.3, 0);
    pennant(p, color, 0, height + 1.2 + roofH - 0.3, 0, 3);
  });
}

/** One of the two square towers either side of a castle gate, with a banner on its outer (+Z) face. */
export function buildGateTower(color: number): THREE.Group {
  return model(`gatetower-${color}`, (p) => {
    const w = 9;
    const h = 12;
    p.add(box(w, h, w), stone(), 0, h / 2, 0);
    p.add(box(w + 0.9, 1, w + 0.9), stoneDark(), 0, 0.5, 0);
    p.add(box(w + 0.7, 0.6, w + 0.7), stoneDark(), 0, h, 0);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      merlons(p, stone(), (ax * w) / 2, (az * w) / 2, (bx * w) / 2, (bz * w) / 2, h + 0.3, 1.3, 2.2);
    }
    for (let row = 1; row <= 4; row++) p.add(box(w + 0.04, 0.08, w + 0.04), stoneDark(), 0, row * 2.4, 0);
    archedOpening(p, 0.5, 1.8, 0, 8.5, w / 2 + 0.02);
    // Hanging banner: the army's colour with a golden stripe and a dark roundel.
    p.add(box(2.6, 5, 0.12), plastic(color), 0, 5.2, w / 2 + 0.1);
    p.add(box(2.6, 0.35, 0.14), plastic(0xd9a520), 0, 7.4, w / 2 + 0.12);
    p.add(new THREE.CylinderGeometry(0.75, 0.75, 0.14, 16).rotateX(Math.PI / 2), plastic(shade(color, 0.55)), 0, 5, w / 2 + 0.14);
    for (const x of [-0.9, 0, 0.9]) p.add(new THREE.ConeGeometry(0.43, 0.8, 4).rotateZ(Math.PI), plastic(color), x, 2.35, w / 2 + 0.1);
    pennant(p, color, w / 2 - 1, h + 0.3, -w / 2 + 1, 3.5);
  });
}

/** The arch between the gate towers: a bridge of stone with battlements and a raised portcullis. Span along X. */
export function buildGateArch(span: number): THREE.Group {
  return model(`arch-${span}`, (p) => {
    p.add(box(span, 3.4, 7), stone(), 0, 9.6, 0);
    p.add(box(span, 0.5, 7.4), stoneDark(), 0, 11.4, 0);
    merlons(p, stone(), -span / 2 + 0.5, 3.4, span / 2 - 0.5, 3.4, 11.6, 1.3, 2.3);
    // Pointed arch trim under the bridge.
    for (const s of [-1, 1]) p.add(box(span / 2 + 1, 0.9, 7.2), stoneDark(), s * span * 0.22, 7.9, 0, 0, 0, s * -0.22);
    // Portcullis raised into the arch: iron bars with spikes along the bottom.
    for (let x = -span / 2 + 1; x <= span / 2 - 1; x += 1.4) {
      p.add(box(0.18, 3.2, 0.18), plastic(IRON), x, 9.4, 3.2);
      p.add(new THREE.ConeGeometry(0.16, 0.5, 6).rotateZ(Math.PI), plastic(IRON), x, 7.6, 3.2);
    }
    for (const y of [8.4, 9.6, 10.8]) p.add(box(span - 1.4, 0.16, 0.2), plastic(IRON), 0, y, 3.2);
  });
}

// ---------- inside the castle ----------

/** The keep: a big square stone tower with corner turrets, arched windows, a banner and a door with steps. */
export function buildKeep(color: number): THREE.Group {
  return model(`keep-${color}`, (p) => {
    const w = 15;
    const h = 16;
    p.add(box(w, h, w), stone(), 0, h / 2, 0);
    p.add(box(w + 1.2, 1.4, w + 1.2), stoneDark(), 0, 0.7, 0);
    p.add(box(w + 0.8, 0.7, w + 0.8), stoneDark(), 0, h, 0);
    for (const y of [5.5, 10.5]) p.add(box(w + 0.3, 0.35, w + 0.3), stoneDark(), 0, y, 0);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      merlons(p, stone(), (ax * w) / 2, (az * w) / 2, (bx * w) / 2, (bz * w) / 2, h + 0.35, 1.4, 2.5);
    }
    // Windows on every face, two storeys.
    for (let f = 0; f < 4; f++) {
      const ry = (f * Math.PI) / 2;
      for (const y of [7.6, 12.4]) {
        for (const x of [-3.6, 3.6]) {
          const v = new THREE.Vector3(x, 0, w / 2 + 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
          archedOpening(p, 1.1, 1.9, v.x, y, v.z, ry);
        }
      }
    }
    // Corner turrets with pointed roofs.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = (sx * w) / 2;
        const z = (sz * w) / 2;
        p.add(new THREE.CylinderGeometry(2.4, 2.6, h + 3, 14), stone(), x, (h + 3) / 2, z);
        merlonRing(p, stone(), 2.3, h + 3, 8, 0.9);
        p.add(new THREE.ConeGeometry(2.9, 5.5, 14), plastic(color), x, h + 3.9 + 2.75, z);
        p.add(new THREE.SphereGeometry(0.25, 8, 6), plastic(0xd9a520), x, h + 3.9 + 5.6, z);
      }
    }
    // A little roof house on top with the flag.
    p.add(box(5, 3, 5), stone(), 0, h + 1.8, 0);
    p.add(new THREE.ConeGeometry(4.2, 4, 4).rotateY(Math.PI / 4), plastic(color), 0, h + 5.3, 0);
    pennant(p, color, 0, h + 7.2, 0, 4);
    // Door with steps, and a long banner over it.
    p.add(box(3.4, 4.6, 0.3), woodDark(), 0, 3.7, w / 2 + 0.1);
    p.add(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), woodDark(), 0, 6, w / 2 + 0.1);
    for (let i = 0; i < 4; i++) p.add(box(5 - i * 0.3, 0.35, 1.2), stoneDark(), 0, 0.2 + i * 0.35, w / 2 + 1.6 - i * 0.35);
    p.add(box(3.2, 5.5, 0.14), plastic(color), 0, 10.5, w / 2 + 0.15);
    p.add(new THREE.CylinderGeometry(0.9, 0.9, 0.14, 16).rotateX(Math.PI / 2), plastic(0xd9a520), 0, 11, w / 2 + 0.2);
  });
}

/** A long great hall with buttresses, tall windows and a steep roof in the army's colour. Front (+Z) gable has the doors. */
export function buildGreatHall(color: number, length = 24): THREE.Group {
  return model(`hall-${color}-${length}`, (p) => {
    const w = 12;
    const h = 7;
    p.add(box(w, h, length), stone(), 0, h / 2, 0);
    p.add(box(w + 0.8, 0.9, length + 0.8), stoneDark(), 0, 0.45, 0);
    gableRoof(p, w, length, 6.5, h, stone(), plastic(color), 0.9, 0.45);
    for (const s of [-1, 1]) {
      for (let z = -length / 2 + 2; z <= length / 2 - 2; z += 4) {
        p.add(box(1, h - 0.5, 1.2), stoneDark(), s * (w / 2 + 0.45), (h - 0.5) / 2, z);
        p.add(box(1, 1.4, 1.2), stoneDark(), s * (w / 2 + 0.2), h - 0.6, z, 0, 0, s * 0.5);
      }
      for (let z = -length / 2 + 4; z <= length / 2 - 4; z += 4) archedOpening(p, 1, 2.8, s * (w / 2 + 0.02), 3.8, z, s * Math.PI / 2);
    }
    // Front: double doors, a round window above, and a golden emblem.
    p.add(box(3.4, 4.4, 0.3), woodDark(), 0, 2.2, length / 2 + 0.1);
    p.add(box(0.12, 4.4, 0.34), plastic(IRON), 0, 2.2, length / 2 + 0.12);
    p.add(new THREE.TorusGeometry(1.3, 0.25, 8, 20), stoneDark(), 0, h + 1.8, length / 2 + 0.1);
    p.add(new THREE.CircleGeometry(1.3, 20), gloom(), 0, h + 1.8, length / 2 + 0.05);
    p.add(box(0.2, 2.4, 0.1), plastic(0xd9a520), 0, h + 1.8, length / 2 + 0.2);
    p.add(box(2.4, 0.2, 0.1), plastic(0xd9a520), 0, h + 1.8, length / 2 + 0.2);
    // Chimney near the back.
    p.add(box(1.6, 5, 1.6), stoneDark(), w / 4, h + 4.5, -length / 3);
  });
}

/** The blacksmith's forge: a stone smithy with a tall chimney in the middle, a lean-to and an anvil out front. */
export function buildForge(): THREE.Group {
  return model('forge', (p) => {
    p.add(box(8, 3.6, 7), stone(), 0, 1.8, 0);
    p.add(box(8.6, 0.3, 7.6), wood(), 0, 3.75, 0);
    gableRoof(p, 8.6, 7.6, 2.4, 3.9, wood(), plastic(0xa8503a), 0.4, 0.3);
    p.add(box(1.8, 11, 1.8), stoneDark(), 0, 5.5, 0);
    p.add(box(2.2, 0.5, 2.2), stone(), 0, 11, 0);
    // Glowing open front with a hood, the anvil and a water barrel.
    p.add(box(3.6, 2.4, 0.2), plastic(0xff7a2a), -1, 1.4, 3.51);
    p.add(box(4.4, 0.4, 1.4), woodDark(), -1, 2.8, 4.1);
    p.add(box(0.8, 0.8, 0.6), plastic(IRON), 2.2, 0.4, 5);
    p.add(box(1.4, 0.35, 0.5), plastic(IRON), 2.2, 0.95, 5);
    p.add(new THREE.ConeGeometry(0.25, 0.5, 8).rotateZ(Math.PI / 2), plastic(IRON), 3.1, 0.95, 5);
    p.add(new THREE.CylinderGeometry(0.55, 0.5, 1, 12), wood(), -3.4, 0.5, 4.6);
    p.add(new THREE.CylinderGeometry(0.47, 0.47, 0.04, 12), plastic(0x3d8fd4), -3.4, 0.98, 4.6);
  });
}

/** Gunpowder barrels under a little open shed with a red warning flag. One shell sets it off. */
export function buildPowderStore(): THREE.Group {
  return model('powder', (p) => {
    for (const [x, z] of [[-2.6, -1.8], [2.6, -1.8], [-2.6, 1.8], [2.6, 1.8]]) p.add(box(0.35, 4, 0.35), wood(), x, 2, z);
    p.add(box(6.4, 0.3, 4.8), woodDark(), 0, 4.1, -0.2, -0.12);
    const barrel = new THREE.CylinderGeometry(0.55, 0.55, 1.2, 12);
    const bulge = new THREE.CylinderGeometry(0.62, 0.62, 0.35, 12);
    const spots: [number, number, number][] = [[-1.6, 0.6, -0.8], [-0.4, 0.6, -0.8], [0.8, 0.6, -0.8], [2, 0.6, -0.8], [-1, 0.6, 0.6], [0.2, 0.6, 0.6], [1.4, 0.6, 0.6], [-1, 1.8, -0.8], [0.2, 1.8, -0.8], [1.4, 1.8, -0.8], [0.8, 1.8, 0.6]];
    for (const [x, y, z] of spots) {
      p.add(barrel, wood(), x, y, z);
      p.add(bulge, woodDark(), x, y, z);
      for (const dy of [-0.45, 0.45]) p.add(new THREE.CylinderGeometry(0.57, 0.57, 0.08, 12), gloom(), x, y + dy, z);
    }
    p.add(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), woodDark(), 2.9, 5.5, 2);
    p.add(box(1.4, 0.8, 0.05), plastic(0xd0342a), 3.6, 6.5, 2);
  });
}

/** A tall wooden lookout on four splayed legs, with cross braces, a railed platform and a pointed roof. */
export function buildWatchtower(color: number): THREE.Group {
  return model(`watchtower-${color}`, (p) => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const top = 12;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      p.beam(v(ax * 2.6, 0, az * 2.6), v(ax * 1.6, top, az * 1.6), 0.4, wood());
      for (const [y0, y1] of [[1, 6], [6, 11]]) {
        const w0 = 2.6 - (y0 / top);
        const w1 = 2.6 - (y1 / top);
        p.beam(v(ax * w0, y0, az * w0), v(bx * w1, y1, bz * w1), 0.18, woodDark());
      }
    }
    p.add(box(4.4, 0.35, 4.4), wood(), 0, top, 0);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      p.add(box(0.2, 3, 0.2), woodDark(), ax * 2.05, top + 1.5, az * 2.05);
    }
    for (const [x, z, w, d] of [[0, 2.1, 4.3, 0.12], [0, -2.1, 4.3, 0.12], [2.1, 0, 0.12, 4.3], [-2.1, 0, 0.12, 4.3]]) {
      p.add(box(w, 0.14, d), woodDark(), x, top + 1.1, z);
      p.add(box(w, 0.8, d), plastic(color), x, top + 0.55, z);
    }
    p.add(new THREE.ConeGeometry(3.4, 3.2, 4).rotateY(Math.PI / 4), plastic(color), 0, top + 4.6, 0);
    p.add(new THREE.SphereGeometry(0.3, 8, 6), plastic(0xd9a520), 0, top + 6.3, 0);
    // A bell hanging under the roof, and a ladder up one side.
    p.add(new THREE.CylinderGeometry(0.25, 0.55, 0.8, 12), plastic(0xd9a520), 0, top + 2.3, 0);
    for (const s of [-1, 1]) p.beam(v(s * 0.4, 0, 3.2), v(s * 0.4, top, 2.25), 0.12, woodDark());
    for (let y = 0.8; y < top; y += 0.8) p.add(box(0.9, 0.08, 0.08), woodDark(), 0, y, 3.2 - (y / top) * 0.95);
  });
}

/**
 * A trebuchet: a wheeled frame with two A-frame uprights and a long throwing arm (returned
 * separately so it can rock) with the counterweight in the army's colour.
 */
export function buildTrebuchet(color: number): { group: THREE.Group; arm: THREE.Group } {
  const group = model('trebuchet-frame', (p) => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    for (const s of [-1, 1]) {
      p.add(box(0.5, 0.5, 9), wood(), s * 1.6, 0.9, 0);
      p.beam(v(s * 1.6, 1.1, -3.2), v(s * 1.4, 7, 0), 0.4, wood());
      p.beam(v(s * 1.6, 1.1, 3.2), v(s * 1.4, 7, 0), 0.4, wood());
      p.beam(v(s * 1.6, 1, -2), v(s * 1.6, 4, 0), 0.22, woodDark());
      for (const z of [-3.6, 3.6]) {
        p.add(tubeX(0.75, 0.3, 14), woodDark(), s * 2, 0.75, z);
        p.add(tubeX(0.2, 0.35, 8), plastic(IRON), s * 2.05, 0.75, z);
      }
    }
    for (const z of [-3.8, 0, 3.8]) p.add(box(3.8, 0.4, 0.4), wood(), 0, 1.2, z);
    p.add(tubeX(0.25, 3.6, 10), plastic(IRON), 0, 7, 0); // axle
    p.add(box(2.2, 0.2, 3), woodDark(), 0, 1.5, 3); // sling trough
  });
  const arm = new THREE.Group();
  arm.position.set(0, 7, 0);
  const a = new PartBuilder();
  a.add(box(0.45, 0.45, 12), wood(), 0, 0, 2.5);
  a.add(box(2, 2, 2), plastic(color), 0, -1.2, -3.8); // counterweight
  a.add(box(2.2, 0.3, 2.2), plastic(shade(color, 0.6)), 0, -0.1, -3.8);
  a.add(new THREE.CylinderGeometry(0.02, 0.02, 3, 4), woodDark(), 0, -1.5, 8.5);
  a.add(new THREE.SphereGeometry(0.5, 10, 8), stoneDark(), 0, -3.1, 8.5);
  a.buildInto(arm);
  arm.rotation.x = -0.55; // cocked, with the long end down by the trough
  group.add(arm);
  return { group, arm };
}

/** A two-wheeled cart piled with hay. */
export function buildHayCart(): THREE.Group {
  return model('haycart', (p) => {
    p.add(box(2.6, 0.25, 4), wood(), 0, 1.2, 0);
    for (const s of [-1, 1]) {
      p.add(box(0.15, 0.7, 4), woodDark(), s * 1.25, 1.6, 0);
      p.add(tubeX(0.9, 0.2, 16), woodDark(), s * 1.45, 0.9, 0.3);
      p.add(tubeX(0.2, 0.3, 8), wood(), s * 1.5, 0.9, 0.3);
      for (let i = 0; i < 6; i++) p.add(box(0.1, 1.6, 0.1), wood(), s * 1.45, 0.9, 0.3, (i / 6) * Math.PI);
      p.beam(new THREE.Vector3(s * 0.6, 1.1, -2), new THREE.Vector3(s * 0.5, 0.5, -4.4), 0.14, woodDark());
    }
    p.add(new THREE.SphereGeometry(1.5, 14, 10), plastic(HAY), 0, 1.9, 0, 0, 0, 0, 0.9, 0.7, 1.4);
    p.add(new THREE.SphereGeometry(1, 12, 8), plastic(shade(HAY, 0.9)), 0.3, 2.6, 0.6, 0, 0, 0, 1, 0.6, 1);
  });
}

/** A huge old bombard on a timber bed, pointing out of the gate (for the Great Castle). */
export function buildBombard(color: number): THREE.Group {
  return model(`bombard-${color}`, (p) => {
    p.add(box(4.4, 1.2, 9), wood(), 0, 0.6, 0);
    p.add(box(4.8, 0.3, 9.4), woodDark(), 0, 1.25, 0);
    const up = 0.18;
    p.add(tubeZ(1.3, 1.5, 7, 20), plastic(IRON), 0, 2.6, -0.8, up);
    for (const z of [-3.6, -1.8, 0, 1.8]) p.add(tubeZ(1.6, 1.6, 0.4, 20), plastic(shade(IRON, 0.7)), 0, 2.6 - z * Math.sin(up) * 0.95, -0.8 + z, up);
    p.add(tubeZ(1.75, 1.6, 0.6, 20), plastic(shade(IRON, 0.7)), 0, 3.3, -4.4, up); // flared muzzle
    p.add(new THREE.CircleGeometry(1.1, 18), gloom(), 0, 3.37, -4.72, -Math.PI + up);
    p.add(new THREE.SphereGeometry(1.4, 16, 10), plastic(IRON), 0, 2.1, 2.8, 0, 0, 0, 1, 1, 0.8);
    for (const s of [-1, 1]) p.add(box(0.4, 2.4, 1), plastic(color), s * 2, 2.2, -1.5);
    // A pyramid of stone cannonballs beside it.
    for (const [x, y, z] of [[3.4, 0.6, 3.2], [4.4, 0.6, 3.2], [3.9, 0.6, 4.1], [3.9, 1.4, 3.5]]) p.add(new THREE.SphereGeometry(0.55, 10, 8), stoneDark(), x, y, z);
  });
}

/** A tall wizard's tower in tan and blue bands, with a balcony and a star-spangled pointed hat. */
export function buildWizardTower(): THREE.Group {
  return model('wizard', (p) => {
    const r = 4.2;
    const h = 24;
    p.add(new THREE.CylinderGeometry(r, r + 0.8, h, 20), stone(), 0, h / 2, 0);
    for (let i = 0; i < 4; i++) p.add(new THREE.CylinderGeometry(r + 0.55 - i * 0.18, r + 0.55 - i * 0.18, 1, 20), plastic(i % 2 ? 0x3d6fc4 : 0xc4a468), 0, 4 + i * 5, 0);
    p.add(new THREE.CylinderGeometry(r + 1.6, r + 1.2, 0.6, 20), stoneDark(), 0, h - 3, 0);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      p.add(box(0.15, 1, 0.15), woodDark(), Math.cos(a) * (r + 1.4), h - 2.3, Math.sin(a) * (r + 1.4));
    }
    p.add(new THREE.TorusGeometry(r + 1.4, 0.1, 5, 24).rotateX(Math.PI / 2), woodDark(), 0, h - 1.8, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      archedOpening(p, 0.8, 1.6, Math.sin(a) * (r + 0.1 - (8 / h) * 0.8 * 0), 8 + (i % 3) * 5, Math.cos(a) * (r + 0.1), a);
    }
    p.add(new THREE.ConeGeometry(r + 1.4, 12, 20), plastic(0x5a3c9a), 0, h + 6, 0);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const y = 2 + (i % 5) * 1.8;
      const rr = (r + 1.4) * (1 - y / 12) + 0.05;
      p.add(new THREE.OctahedronGeometry(0.45), plastic(0xffd24a), Math.cos(a) * rr, h + y, Math.sin(a) * rr);
    }
    p.add(new THREE.SphereGeometry(0.6, 10, 8), plastic(0xffd24a), 0, h + 12.3, 0);
  });
}

// ---------- village cottages ----------

type Roof = 'thatch' | 'tile' | 'slate';
const ROOF_COLOR: Record<Roof, number> = { thatch: THATCH, tile: 0xb5553a, slate: 0x5d6474 };

/** Timber framing on a wall face `w` wide from y0 to y1, at depth z (face normal +Z), turned by ry. */
function timberFrame(p: PartBuilder, w: number, y0: number, y1: number, z: number, ry: number): void {
  const beam = woodDark();
  const put = (g: THREE.BufferGeometry, x: number, y: number, rz = 0) => {
    const v = new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    p.add(g, beam, v.x, v.y, v.z, 0, ry, rz);
  };
  const h = y1 - y0;
  put(box(w, 0.25, 0.12), 0, y0 + 0.12);
  put(box(w, 0.25, 0.12), 0, y1 - 0.12);
  const posts = Math.max(2, Math.round(w / 2.4));
  for (let i = 0; i <= posts; i++) put(box(0.25, h, 0.12), -w / 2 + (i * w) / posts, y0 + h / 2);
  for (let i = 0; i < posts; i += 2) {
    const x = -w / 2 + ((i + 0.5) * w) / posts;
    put(box(0.2, Math.hypot(w / posts, h), 0.1), x, y0 + h / 2, (i % 4 === 0 ? 1 : -1) * Math.atan2(w / posts, h));
  }
}

/** A window with a wooden frame and two shutters, on a face with normal +Z turned by ry. */
function cottageWindow(p: PartBuilder, x: number, y: number, z: number, ry: number, shutter: number): void {
  const put = (g: THREE.BufferGeometry, mat: THREE.Material, dx: number, dy: number, dz: number) => {
    const v = new THREE.Vector3(x + dx, y + dy, z + dz).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    p.add(g, mat, v.x, v.y, v.z, 0, ry);
  };
  put(box(1.1, 1.1, 0.12), gloom(), 0, 0, 0);
  put(box(1.3, 0.14, 0.2), woodDark(), 0, -0.62, 0.05);
  put(box(0.08, 1.1, 0.16), woodDark(), 0, 0, 0.04);
  for (const s of [-1, 1]) put(box(0.55, 1.15, 0.08), plastic(shutter), s * 0.88, 0, 0.1);
}

/**
 * A village house. `variant` picks the shape: a timber-framed cottage, a stone cottage, a tall
 * jettied town house, or a long inn with a hanging sign (the last two line the high street).
 */
export function buildCottage(variant: number, roof: Roof, shutter: number): THREE.Group {
  const kind = variant % 4;
  return model(`cottage-${kind}-${roof}-${shutter}`, (p) => {
    const roofMat = plastic(ROOF_COLOR[roof]);
    const thick = roof === 'thatch' ? 0.6 : 0.3;
    const walls = kind === 1 ? stone() : plastic(PLASTER);
    const faces = (w: number, d: number, y0: number, y1: number, framed: boolean) => {
      if (!framed) return;
      timberFrame(p, w, y0, y1, d / 2 + 0.03, 0);
      timberFrame(p, w, y0, y1, d / 2 + 0.03, Math.PI);
      timberFrame(p, d, y0, y1, w / 2 + 0.03, Math.PI / 2);
      timberFrame(p, d, y0, y1, w / 2 + 0.03, -Math.PI / 2);
    };
    const door = (x: number, z: number) => {
      p.add(box(1.4, 2.4, 0.2), plastic(WOOD), x, 1.2, z);
      p.add(box(1.7, 0.2, 0.28), woodDark(), x, 2.5, z);
      p.add(new THREE.SphereGeometry(0.08, 6, 4), plastic(IRON), x + 0.45, 1.2, z + 0.12);
      p.add(box(1.8, 0.2, 0.9), stoneDark(), x, 0.1, z + 0.45);
    };
    if (kind === 0 || kind === 1) {
      // Cottage: one storey, big roof, chimney at one end.
      const w = kind === 0 ? 9 : 10;
      const d = 7;
      const h = 3.6;
      p.add(box(w, h, d), walls, 0, h / 2, 0);
      p.add(box(w + 0.4, 0.6, d + 0.4), stoneDark(), 0, 0.3, 0);
      faces(w, d, 0.6, h, kind === 0);
      p.add(prism(d, 3.6, w).rotateY(Math.PI / 2), walls, 0, h, 0);
      gableRoofAlongX(p, w, d, 3.6, h, roofMat, 0.6, thick);
      p.add(box(1.2, 4.2, 1.2), stoneDark(), w / 2 - 1.2, h + 2.3, -1);
      door(-1.2, d / 2 + 0.1);
      cottageWindow(p, 2.2, 2, d / 2 + 0.08, 0, shutter);
      cottageWindow(p, -2.4, 2, -d / 2 - 0.08, Math.PI, shutter);
      cottageWindow(p, 0, 2, w / 2 + 0.08, Math.PI / 2, shutter);
      if (kind === 1) for (let y = 1.2; y < h; y += 0.8) p.add(box(w + 0.04, 0.07, d + 0.04), stoneDark(), 0, y, 0);
    } else if (kind === 2) {
      // Tall town house: a stone ground floor and a wider plastered upper floor jutting out over it.
      const w = 8;
      const d = 8;
      p.add(box(w, 3.4, d), stone(), 0, 1.7, 0);
      p.add(box(w + 1.2, 3.4, d + 1.2), plastic(PLASTER), 0, 5.1, 0);
      p.add(box(w + 1.4, 0.35, d + 1.4), woodDark(), 0, 3.4, 0);
      for (let x = -w / 2; x <= w / 2; x += 2) p.add(box(0.25, 0.4, 0.8), woodDark(), x, 3.1, d / 2 + 0.3);
      faces(w + 1.2, d + 1.2, 3.4, 6.8, true);
      p.add(prism(w + 1.2, 4.5, d + 1.2), plastic(PLASTER), 0, 6.8, 0);
      gableRoof(p, w + 1.2, d + 1.2, 4.5, 6.8, plastic(PLASTER), roofMat, 0.6, thick);
      door(-1.8, d / 2 + 0.1);
      cottageWindow(p, 1.8, 1.9, d / 2 + 0.08, 0, shutter);
      for (const x of [-2, 2]) cottageWindow(p, x, 5.2, d / 2 + 0.68, 0, shutter);
      cottageWindow(p, 0, 8.3, d / 2 + 0.68, 0, shutter);
      p.add(box(1.1, 5, 1.1), stoneDark(), -w / 2 + 1, 9, -1.5);
    } else {
      // Inn: long and low with a hanging sign on a bracket and barrels by the door.
      const w = 14;
      const d = 8;
      const h = 4.4;
      p.add(box(w, h, d), plastic(PLASTER), 0, h / 2, 0);
      p.add(box(w + 0.4, 0.8, d + 0.4), stoneDark(), 0, 0.4, 0);
      faces(w, d, 0.8, h, true);
      p.add(prism(d, 4, w).rotateY(Math.PI / 2), plastic(PLASTER), 0, h, 0);
      gableRoofAlongX(p, w, d, 4, h, roofMat, 0.7, thick);
      p.add(box(1.2, 5, 1.2), stoneDark(), -w / 2 + 1.2, h + 2.4, 0);
      door(0, d / 2 + 0.1);
      for (const x of [-4.2, -2.2, 2.2, 4.2]) cottageWindow(p, x, 2.4, d / 2 + 0.08, 0, shutter);
      // Sign bracket and sign board.
      p.add(box(0.15, 0.15, 1.8), woodDark(), 1.4, 3.6, d / 2 + 0.9);
      p.add(box(0.1, 0.9, 1.3), plastic(shutter), 1.4, 2.95, d / 2 + 1.2);
      p.add(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 12).rotateZ(Math.PI / 2), plastic(0xd9a520), 1.47, 2.95, d / 2 + 1.2);
      for (const [x, z] of [[-1.6, d / 2 + 0.8], [-2.4, d / 2 + 0.9]]) {
        p.add(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 10), plastic(WOOD), x, 0.45, z);
        p.add(new THREE.CylinderGeometry(0.44, 0.44, 0.08, 10), gloom(), x, 0.7, z);
      }
    }
  });
}

/** A gable roof with its ridge along X (for cottages whose long side faces the street). */
function gableRoofAlongX(p: PartBuilder, w: number, d: number, h: number, y: number, roof: THREE.Material, overhang: number, thick: number): void {
  const run = Math.hypot(d / 2, h);
  const slope = Math.atan2(h, d / 2);
  for (const s of [-1, 1]) {
    const z = (s * d) / 4 + ((s * d) / 2 / run) * (overhang / 2) + ((s * h) / run) * (thick / 2);
    const yy = y + h / 2 - (h / run) * (overhang / 2) + (d / 2 / run) * (thick / 2);
    p.add(box(w + overhang * 2, thick, run + overhang), roof, 0, yy, z, s * slope);
  }
  p.add(tubeX(thick * 0.9, w + overhang * 2, 8), roof, 0, y + h + thick * 0.4, 0);
}

export const COTTAGE_ROOFS: Roof[] = ['thatch', 'thatch', 'tile', 'slate'];
export const SHUTTER_COLORS = [0x3d7a4a, 0x3d6fc4, 0xb8392e, 0xd9a520, 0x7a4a8a];
