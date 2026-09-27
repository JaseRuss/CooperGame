import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade, ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE } from '../utils/plastic';
import { mulberry32 } from '../utils/rng';
import { Tank } from '../entities/Tank';
import { createCheeringFigure } from '../entities/Soldier';
import { buildJeep, buildChopperParts } from './Vehicles';
import { buildRocket } from './MoonRocket';
import { ImpactEffects } from '../combat/ImpactEffects';

// The zombie mission's happy ending: everyone who made it onto the rocket is partying at a Moon
// base under a big "MISSION ACCOMPLISHED" banner, with the Earth hanging in the black sky. It's
// its own little scene, drawn instead of the world once the rocket gets there.

const ARMIES = [ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE];
const MOON_GREY = 0xa6a5a2;
const WHITE = 0xeeebe3;
const STEEL = 0x9aa0a8;
const DARK = 0x3a3e46;
/** Where the camera ends up looking: the crowd in front of the banner. */
const FOCUS = new THREE.Vector3(0, 6.5, -10);
/** The Earth, low in the sky over the left of the base as the camera sees it (under the words on screen). */
const EARTH_AT = new THREE.Vector3(-627, 222, -1344);
const MAIN_DOME = { x: 0, z: -36, r: 16 };
const ROCKET_AT = new THREE.Vector2(-36, -6);

/** Crater [x, z, radius, depth]: scattered across the plain, plus a few little ones near the base. */
function craters(): [number, number, number, number][] {
  const rng = mulberry32(2026);
  const out: [number, number, number, number][] = [
    [-22, 34, 5, 1.2],
    [44, 26, 4, 1],
    [-62, 18, 7, 1.6],
    [62, -8, 5, 1.2],
  ];
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2;
    const d = 110 + rng() * 650;
    const r = 8 + rng() * rng() * 60;
    out.push([Math.cos(a) * d, Math.sin(a) * d, r, r * (0.18 + rng() * 0.1)]);
  }
  return out;
}

const CRATERS = craters();

/** Height of the Moon's surface: a flat patch for the base, bumpy plain and craters beyond. */
function groundHeight(x: number, z: number): number {
  const fromBase = Math.hypot(x, z + 10);
  const rough = THREE.MathUtils.smoothstep(fromBase, 45, 110);
  let h = (Math.sin(x * 0.045) * Math.cos(z * 0.052) * 1.6 + Math.sin(x * 0.13 + z * 0.09) * 0.5) * rough;
  for (const [cx, cz, r, depth] of CRATERS) {
    const q = Math.hypot(x - cx, z - cz) / r;
    if (q > 1.8) continue;
    if (q < 1) h -= depth * (1 - q * q);
    h += depth * 0.4 * Math.exp(-(((q - 1) / 0.22) ** 2)); // raised rim
  }
  return h;
}

/** A blue-and-green toy Earth with swirly clouds and white poles. */
function earthTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const sea = ctx.createLinearGradient(0, 0, 0, 256);
  sea.addColorStop(0, '#2d6fc8');
  sea.addColorStop(0.5, '#2a84e0');
  sea.addColorStop(1, '#2d6fc8');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, 512, 256);
  const rng = mulberry32(77);
  // Continents: clumps of blobs, green with sandy middles.
  for (let k = 0; k < 7; k++) {
    const cx = rng() * 512;
    const cy = 50 + rng() * 156;
    for (let i = 0; i < 16; i++) {
      const x = cx + (rng() - 0.5) * 90;
      const y = cy + (rng() - 0.5) * 60;
      const r = 8 + rng() * 20;
      ctx.fillStyle = i % 5 === 0 ? '#c9b37a' : i % 2 ? '#4f9a3c' : '#3f8a34';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#f4f7fb';
  ctx.fillRect(0, 0, 512, 16);
  ctx.fillRect(0, 240, 512, 16);
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.ellipse(rng() * 512, 20 + rng() * 216, 20 + rng() * 40, 4 + rng() * 6, (rng() - 0.5) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The banner: red and white stripes, a blue canton full of stars, and the words across it. */
function bannerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 340;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 2 ? '#f6f2ea' : '#c4262e';
    ctx.fillRect(0, (i * 340) / 7, 2048, 340 / 7 + 1);
  }
  ctx.fillStyle = '#233e8b';
  ctx.fillRect(0, 0, 360, 340);
  ctx.fillStyle = '#ffffff';
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 6; col++) {
      const x = 36 + col * 58 + (row % 2) * 29;
      const y = 40 + row * 64;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 9 : 22;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.fill();
    }
  }
  ctx.font = '900 190px "Black Ops One", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = 'MISSION ACCOMPLISHED';
  const x = 360 + (2048 - 360) / 2;
  // Squeeze it to fit whichever font loaded.
  const w = ctx.measureText(text).width;
  ctx.save();
  ctx.translate(x, 178);
  ctx.scale(Math.min(1, 1600 / w), 1);
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#1a2f6e';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 0, 0);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A green army flag: a white star on green. */
function flagTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 120;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#4b7a2e';
  ctx.fillRect(0, 0, 192, 120);
  ctx.fillStyle = '#f4efe0';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 16 : 40;
    ctx.lineTo(96 + Math.cos(a) * r, 62 + Math.sin(a) * r);
  }
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A panelled white dome on a grey ring, with an airlock porch facing +Z (rotate to aim it). */
function dome(p: PartBuilder, x: number, z: number, r: number, porchYaw: number): void {
  const white = plastic(WHITE);
  const steel = plastic(STEEL);
  const dark = plastic(DARK);
  const glass = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc860, emissiveIntensity: 0.9 });
  p.add(new THREE.CylinderGeometry(r + 0.4, r + 0.6, 1.4, 40), steel, x, 0.7, z);
  p.add(new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), white, x, 1.3, z);
  for (const f of [0.35, 0.65]) {
    const y = r * f;
    p.add(new THREE.TorusGeometry(Math.sqrt(r * r - y * y) + 0.05, 0.14, 6, 48).rotateX(Math.PI / 2), steel, x, 1.3 + y, z);
  }
  for (let i = 0; i < 8; i++) {
    p.add(new THREE.TorusGeometry(r + 0.05, 0.14, 6, 24, Math.PI).rotateY((i / 8) * Math.PI), steel, x, 1.3, z);
  }
  // A ring of lit windows low down, and the porch with its door.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const y = r * 0.18;
    const rr = Math.sqrt(r * r - y * y) + 0.02;
    p.add(new THREE.CircleGeometry(0.7, 16), glass, x + Math.sin(a) * rr, 1.3 + y, z + Math.cos(a) * rr, 0, a);
  }
  const s = Math.sin(porchYaw);
  const c = Math.cos(porchYaw);
  const at = (d: number) => [x + s * d, z + c * d] as const;
  const [px, pz] = at(r + 1.2);
  p.add(new THREE.BoxGeometry(5, 4.6, 5), white, px, 2.3, pz, 0, porchYaw);
  p.add(new THREE.BoxGeometry(5.4, 0.4, 5.4), steel, px, 4.8, pz, 0, porchYaw);
  const [dx, dz] = at(r + 3.75);
  p.add(new THREE.BoxGeometry(2.4, 3.2, 0.12), dark, dx, 1.7, dz, 0, porchYaw);
  p.add(new THREE.BoxGeometry(1.2, 0.5, 0.14), glass, dx, 2.7, dz, 0, porchYaw);
}

/** A covered walkway tube between two points on the ground. */
function tube(p: PartBuilder, a: THREE.Vector2, b: THREE.Vector2): void {
  const len = a.distanceTo(b);
  const yaw = Math.atan2(b.x - a.x, b.y - a.y);
  const mx = (a.x + b.x) / 2;
  const mz = (a.y + b.y) / 2;
  p.add(new THREE.CylinderGeometry(1.6, 1.6, len, 16).rotateX(Math.PI / 2), plastic(WHITE), mx, 2, mz, 0, yaw);
  for (let i = 1; i < len / 3; i++) {
    const t = (i * 3) / len;
    p.add(new THREE.TorusGeometry(1.65, 0.12, 6, 20), plastic(STEEL), a.x + (b.x - a.x) * t, 2, a.y + (b.y - a.y) * t, 0, yaw);
  }
}

interface Hopper {
  mesh: THREE.Object3D;
  groundY: number;
  phase: number;
  period: number;
  height: number;
  yaw: number;
  spin: number;
}

/**
 * The Moon base party. `update` animates it (low-gravity hops, fireworks) and flies the camera
 * in from high up to a slow sweep past the crowd and the banner.
 */
export class MoonBase {
  readonly scene = new THREE.Scene();
  private readonly hoppers: Hopper[] = [];
  private readonly effects: ImpactEffects;
  private readonly flag: THREE.Mesh;
  private time = 0;
  private fireworkTimer = 1.2;
  private readonly rng = mulberry32(516);

  constructor() {
    const scene = this.scene;
    scene.background = new THREE.Color(0x02030a);
    scene.add(new THREE.HemisphereLight(0x8494b8, 0x2a2826, 0.45));
    const sun = new THREE.DirectionalLight(0xfff6e8, 2.6);
    sun.position.set(110, 80, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, far: 400 });
    sun.shadow.bias = -0.001;
    sun.target.position.set(0, 0, -10);
    scene.add(sun, sun.target);
    this.effects = new ImpactEffects(scene);

    this.buildSky();
    this.buildGround();

    const p = new PartBuilder();
    // The base: a big dome and two small ones joined by tubes, solar panels and a dish.
    dome(p, MAIN_DOME.x, MAIN_DOME.z, MAIN_DOME.r, 0);
    dome(p, -30, -52, 9, Math.PI * 0.35);
    dome(p, 32, -54, 10, -Math.PI * 0.3);
    tube(p, new THREE.Vector2(-12, -44), new THREE.Vector2(-23, -48));
    tube(p, new THREE.Vector2(13, -44), new THREE.Vector2(24, -49));
    const panel = plastic(0x1f3a78);
    const steel = plastic(STEEL);
    for (let i = 0; i < 4; i++) {
      for (const row of [0, 1]) {
        const x = 52 + i * 7;
        const z = -30 + row * 9;
        p.add(new THREE.CylinderGeometry(0.2, 0.2, 2.4, 6), steel, x, 1.2, z);
        p.add(new THREE.BoxGeometry(6, 0.2, 4), panel, x, 2.5, z, -0.5);
        for (let k = -1; k <= 1; k++) p.add(new THREE.BoxGeometry(0.08, 0.25, 4), steel, x + k * 2, 2.55, z, -0.5);
      }
    }
    p.add(new THREE.CylinderGeometry(0.4, 0.6, 10, 10), steel, -58, 5, -34);
    p.add(new THREE.SphereGeometry(5, 24, 10, 0, Math.PI * 2, 0, Math.PI / 3), plastic(WHITE), -58, 10.5, -34, -0.9, 0.6);
    p.add(new THREE.CylinderGeometry(0.1, 0.1, 4, 6), steel, -58, 12, -32.5, -0.9, 0.6);

    // Landing pad under the rocket, and a helipad for the chopper.
    const concrete = plastic(0x8d8a82);
    const yellow = plastic(0xe8c23f);
    p.add(new THREE.CylinderGeometry(13, 13.4, 0.3, 8), concrete, ROCKET_AT.x, 0.15, ROCKET_AT.y);
    p.add(new THREE.CylinderGeometry(7, 7, 0.3, 24), concrete, 34, 0.15, -24);
    p.add(new THREE.TorusGeometry(5, 0.25, 4, 32).rotateX(Math.PI / 2), yellow, 34, 0.32, -24);
    // The stage: a platform with a lectern in front of the dome, and the banner on two masts behind it.
    p.add(new THREE.BoxGeometry(12, 1.2, 6), plastic(0x5a5f68), 0, 0.6, -15);
    for (let i = 0; i < 3; i++) p.add(new THREE.BoxGeometry(4, 0.4, 1), plastic(0x6c717a), 0, 0.2 + i * 0.4, -11.5 + i * -0.4 + 0.8);
    p.add(new THREE.BoxGeometry(1.4, 1.6, 0.9), plastic(0x233e8b), 1.6, 2, -14);
    p.add(new THREE.CircleGeometry(0.4, 16), plastic(0xe8c23f), 1.6, 2.2, -13.53);
    for (const x of [-15, 15]) {
      p.add(new THREE.CylinderGeometry(0.3, 0.35, 16, 10), steel, x, 8, -18.5);
      p.add(new THREE.SphereGeometry(0.5, 10, 8), yellow, x, 16.3, -18.5);
    }
    p.add(new THREE.CylinderGeometry(0.12, 0.12, 30, 8).rotateZ(Math.PI / 2), steel, 0, 15, -18.5);
    // Moon rocks.
    const rock = plastic(shade(MOON_GREY, 0.7));
    for (let i = 0; i < 70; i++) {
      const a = this.rng() * Math.PI * 2;
      const d = 30 + this.rng() * 140;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d - 10;
      if (Math.abs(x) < 25 && z > -30 && z < 30) continue; // not in the crowd
      const s = 0.3 + this.rng() * this.rng() * 2.2;
      p.add(new THREE.DodecahedronGeometry(s, 0), rock, x, groundHeight(x, z) + s * 0.3, z, this.rng() * 3, this.rng() * 3, 0, 1, 0.7, 1);
    }
    p.buildInto(scene);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 4.6, 24, 1),
      new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.8 }),
    );
    const pos = banner.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 0.5) * 0.25 - (1 - (pos.getX(i) / 14) ** 2) * 0.6);
    banner.geometry.computeVertexNormals();
    banner.position.set(0, 12.4, -18.3);
    banner.castShadow = true;
    scene.add(banner);

    const rocket = buildRocket();
    rocket.position.set(ROCKET_AT.x, 0.3, ROCKET_AT.y);
    rocket.rotation.y = 0.5;
    scene.add(rocket);

    // A flag planted beside the stage, on its top rod so it flies with no wind.
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5, 10, 1).translate(2, 0, 0), new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
    this.flag.position.set(9.3, 8.6, -12);
    scene.add(this.flag);
    const pole = new PartBuilder();
    pole.add(new THREE.CylinderGeometry(0.1, 0.12, 10, 8), steel, 9.3, 5, -12);
    pole.add(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6).rotateZ(Math.PI / 2), steel, 11.4, 9.85, -12);
    pole.buildInto(scene);

    // Tanks of every army parked in a row, a jeep, and a chopper on its pad.
    ARMIES.forEach((color, i) => {
      const tank = Tank.displayModel(color, (i - 1.5) * 0.3);
      tank.position.set(22 + i * 1.5, 0, -8 + i * 6.5);
      tank.rotation.y = -0.9;
      scene.add(tank);
      const jeep = buildJeep(color, { stars: true });
      jeep.position.set(-22 - (i % 2) * 5, 0, 12 + i * 3);
      jeep.rotation.y = 1.9 + i * 0.2;
      if (i < 2) scene.add(jeep);
    });
    const chopper = buildChopperParts(ARMY_GREEN);
    chopper.group.position.set(34, 1.6, -24);
    chopper.group.rotation.y = 2.4;
    scene.add(chopper.group);

    // The party: army men of every colour, jumping for joy in the low gravity.
    for (let i = 0; i < 52; i++) {
      const color = ARMIES[i % 4];
      const mesh = createCheeringFigure(color);
      const x = (this.rng() - 0.5) * 34;
      const z = -7 + this.rng() * 20;
      mesh.position.set(x, 0, z);
      scene.add(mesh);
      this.hoppers.push({
        mesh,
        groundY: groundHeight(x, z),
        phase: this.rng(),
        period: 1.5 + this.rng() * 0.9,
        height: 0.8 + this.rng() * 2.2,
        yaw: Math.PI + (this.rng() - 0.5) * 1.6,
        spin: this.rng() < 0.3 ? (this.rng() < 0.5 ? -1 : 1) * Math.PI * 2 : 0,
      });
    }
    // The general on the stage, cheering too (a little more dignified).
    const general = createCheeringFigure(shade(ARMY_GREEN, 1.35));
    general.scale.setScalar(1.15);
    general.position.set(-1.2, 1.2, -14.5);
    scene.add(general);
    this.hoppers.push({ mesh: general, groundY: 1.2, phase: 0, period: 2.4, height: 0.4, yaw: Math.PI, spin: 0 });
  }

  /** Black sky, lots of stars and the Earth with a thin blue glow. */
  private buildSky(): void {
    const count = 2200;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(this.rng() - 0.5, this.rng() * 0.9 - 0.05, this.rng() - 0.5).normalize().multiplyScalar(2800);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false })));

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(120, 48, 24),
      new THREE.MeshStandardMaterial({ map: earthTexture(), emissive: 0xffffff, emissiveMap: earthTexture(), emissiveIntensity: 0.45, roughness: 0.9 }),
    );
    earth.position.copy(EARTH_AT);
    earth.rotation.set(0.3, 2.2, 0.2);
    this.scene.add(earth);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(64, 64, 40, 64, 64, 64);
    g.addColorStop(0, 'rgba(120,180,255,0.7)');
    g.addColorStop(1, 'rgba(120,180,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(120 * 3.2);
    glow.position.copy(EARTH_AT).multiplyScalar(1.01);
    this.scene.add(glow);
  }

  /** The grey, cratered plain, moulded low-poly like the rest of the toys. */
  private buildGround(): void {
    const geo = new THREE.PlaneGeometry(1800, 1800, 180, 180).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(MOON_GREY);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = groundHeight(x, z);
      pos.setY(i, h);
      const k = 0.9 + Math.sin(x * 0.21 + z * 0.17) * 0.04 + Math.sin(x * 0.037 - z * 0.05) * 0.05 + Math.max(-0.25, Math.min(0, h * 0.04));
      colors.set([base.r * k, base.g * k, base.b * k], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /** Moves the party on and places the camera. Returns true when a firework bursts (for its bang). */
  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    this.time += dt;
    const t = this.time;
    for (const h of this.hoppers) {
      const f = (t / h.period + h.phase) % 1;
      const y = 4 * h.height * f * (1 - f);
      h.mesh.position.y = h.groundY + y;
      h.mesh.rotation.y = h.yaw + h.spin * f;
      h.mesh.rotation.z = Math.sin(f * Math.PI * 2) * 0.06;
    }
    // The flag ripples a little (it's on a rod: there's no wind on the Moon).
    const fpos = this.flag.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fpos.count; i++) fpos.setZ(i, Math.sin(fpos.getX(i) * 1.6 - t * 2) * 0.08 * fpos.getX(i));
    fpos.needsUpdate = true;

    let burst = false;
    this.fireworkTimer -= dt;
    if (this.fireworkTimer <= 0) {
      this.fireworkTimer = 0.9 + this.rng() * 1.4;
      this.effects.confetti(new THREE.Vector3((this.rng() - 0.5) * 70, 22 + this.rng() * 20, -30 + (this.rng() - 0.5) * 40));
      burst = true;
    }
    this.effects.update(dt);

    // Swoop in from high over the plain, then sweep slowly back and forth past the crowd.
    const settle = Math.exp(-t / 4.5);
    const angle = 0.45 * Math.sin(t * 0.09 - 0.35) - 0.9 * settle;
    const radius = 34 + 110 * settle;
    const cam = new THREE.Vector3(FOCUS.x + Math.sin(angle) * radius, 4.5 + 55 * settle, FOCUS.z + Math.cos(angle) * radius);
    camera.position.copy(cam);
    camera.lookAt(FOCUS.x, FOCUS.y + 4 * settle, FOCUS.z);
    return burst;
  }
}
