import * as THREE from 'three';
import { loftGeometry } from '../../utils/modelKit';
import { ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE } from '../../utils/plastic';
import { createZombieFigure, ZOMBIE_COLOR } from '../../entities/Soldier';
import { makeCrate } from '../Buggy';
import { bulldozer, steamroller, dumpTruck, cementMixer } from '../RoadMachines';
import { P, v3, box, ball, cyl, glow, WATER, guy, put, built, signboard, alien, greeter, signTexture, panel, ufo, twinkle, checkTexture } from './kit';
import type { WonderTools, WonderAnim } from './types';

const ARMIES = [ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE];
const BLACK = 0x15161a;

// ---------- lost socks ----------

/** Where all the lost socks go: a mountain of odd socks, being sorted. */
export function lostSocks(g: THREE.Group, tools: WonderTools): WonderAnim {
  const rng = tools.rng;
  const colors = [0xe0503f, 0x3a8ae0, 0xffd24a, 0x7ac24a, 0xf7a8c8, 0xf09a2a, 0xffffff, 0x8a5ad8];
  const sock = (color: number, stripe: number) =>
    built((b) => {
      b.add(cyl(0.38, 0.38, 2.2, 10), P(color), 0, 1.1, 0);
      b.add(new THREE.CapsuleGeometry(0.38, 1.2, 4, 10).rotateX(Math.PI / 2), P(color), 0, 0.1, -0.6);
      for (const y of [1.5, 1.9]) b.add(cyl(0.4, 0.4, 0.18, 10), P(stripe), 0, y, 0);
      b.add(ball(0.4, 10, 8), P(stripe), 0, 0.1, -1.25);
    });
  g.add(
    built((p) => {
      p.add(new THREE.ConeGeometry(8, 6, 18), P(0xd8d0c0), 0, 3, 0);
      for (let i = 0; i < 110; i++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * 8;
        const y = 6 * (1 - d / 8) + 0.2;
        const c = colors[Math.floor(rng() * colors.length)];
        const st = colors[Math.floor(rng() * colors.length)];
        const m = new THREE.Matrix4().compose(v3(Math.cos(a) * d, y, Math.sin(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3)), v3(1, 1, 1));
        p.addMatrix(cyl(0.38, 0.38, 2.2, 8).translate(0, 0.6, 0), P(c), m);
        p.addMatrix(new THREE.CapsuleGeometry(0.38, 1.0, 3, 8).rotateX(Math.PI / 2).translate(0, -0.5, -0.5), P(c), m);
        p.addMatrix(cyl(0.4, 0.4, 0.2, 8).translate(0, 1.2, 0), P(st), m);
      }
    }),
  );
  tools.solid(0, 0, 7, 6);
  put(g, signboard(['LOST SOCKS', 'DEPARTMENT'], 4.4, 1.6, { bg: '#fdf3e3', fg: '#c84a7a' }), -9, 0, 7, 0.5);
  put(g, signboard(['EST. FOREVER', 'NO PAIRS'], 2.6, 1.0, { bg: '#ffffff', fg: '#3a3e46' }, 1.2), 9, 0, 8, -0.5);
  put(g, guy(ARMY_BLUE, 'point'), 6, 0, 6, Math.PI * 0.75);
  // An alien wearing two odd socks on its antennae.
  const al = put(g, alien('cheer', 0x5ad0e0), -5, 0, 9, Math.PI);
  for (const s of [-1, 1]) {
    const tiny = sock(s > 0 ? 0xe0503f : 0x7ac24a, 0xffffff);
    tiny.scale.setScalar(0.15);
    tiny.position.set(s * 0.26, 2.25, 0.02);
    al.add(tiny);
  }
  // Now and then a sock gets flung out of the pile.
  const flung = put(g, sock(0xffd24a, 0x8a5ad8), 0, 6, 0);
  const vel = new THREE.Vector3();
  let t = 0;
  const hello = greeter(32, ['FOUND IT! …WRONG SOCK', 'THIS ONE GOES WITH… NOTHING'], '#f7a8c8');
  return (ctx) => {
    t -= ctx.dt;
    if (t <= 0) {
      t = 6;
      flung.position.set(0, 6, 0);
      const a = Math.random() * Math.PI * 2;
      vel.set(Math.cos(a) * 3, 7, Math.sin(a) * 3);
    }
    vel.y -= 2.5 * ctx.dt;
    flung.position.addScaledVector(vel, ctx.dt);
    flung.rotation.x += ctx.dt * 3;
    flung.rotation.z += ctx.dt * 2;
    if (flung.position.y < 0.4) {
      flung.position.y = 0.4;
      vel.set(0, 0, 0);
    }
    al.position.y = Math.abs(Math.sin(ctx.t * 3)) * 0.3;
    hello(ctx);
  };
}

// ---------- bath time ----------

/** Bath time: there's no water on the Moon, so he brought his own. */
export function bathTime(g: THREE.Group, tools: WonderTools): WonderAnim {
  const white = P(0xf8f6f0);
  const gold = P(0xe8c23f);
  g.add(
    built((p) => {
      p.add(new THREE.CapsuleGeometry(1.6, 3.4, 6, 20).rotateX(Math.PI / 2), white, 0, 1.9, 0, 0, 0, 0, 1, 0.75, 1);
      p.add(cyl(1.5, 1.5, 0.1, 24), WATER, 0, 2.95, -1.7);
      p.add(cyl(1.5, 1.5, 0.1, 24), WATER, 0, 2.95, 1.7);
      p.add(box(3, 0.1, 3.4), WATER, 0, 2.95, 0);
      for (const [x, z] of [[-1.2, -2.2], [1.2, -2.2], [-1.2, 2.2], [1.2, 2.2]]) {
        p.add(ball(0.35, 10, 8), gold, x, 0.35, z);
        p.add(cyl(0.18, 0.3, 0.8, 8), gold, x, 0.8, z);
      }
      // Taps, and the shower on its stand.
      for (const s of [-1, 1]) p.add(cyl(0.1, 0.1, 0.6, 8), gold, s * 0.4, 3.4, -2.9);
      p.add(cyl(0.14, 0.14, 0.9, 8).rotateX(Math.PI / 2), gold, 0, 3.6, -3.1);
      p.add(cyl(0.08, 0.08, 6.5, 8), P(0xd9dee6), 0, 3.25, -4.2);
      p.add(cyl(0.08, 0.08, 1.6, 8).rotateX(Math.PI / 2), P(0xd9dee6), 0, 6.5, -3.4);
      p.add(cyl(0.45, 0.25, 0.3, 12), P(0xd9dee6), 0, 6.3, -2.6);
      p.add(new THREE.TorusGeometry(2.2, 0.06, 6, 30).rotateX(Math.PI / 2), P(0xd9dee6), 0, 7, 0);
      // Bubbles heaped up.
      const rng = tools.rng;
      for (let i = 0; i < 26; i++) p.add(ball(0.3 + rng() * 0.35, 10, 8), P(0xffffff), (rng() - 0.5) * 2.6, 3.1 + rng() * 0.4, (rng() - 0.5) * 4.6);
      // A bath mat and slippers.
      p.add(box(2.4, 0.05, 1.4), P(0x7ac2e0), 2.8, 0.03, 1);
      for (const z of [0.7, 1.3]) p.add(box(0.5, 0.25, 0.9), P(0xf7a8c8), 2.8, 0.15, z);
    }),
  );
  // The shower curtain, half drawn, with polka dots.
  const curtain = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4, 24, 1, true, Math.PI * 0.6, Math.PI * 0.7), new THREE.MeshStandardMaterial({ map: checkTexture('#f7a8c8', '#ffffff', 6), side: THREE.DoubleSide, roughness: 0.8 }));
  curtain.position.y = 5;
  g.add(curtain);
  const bather = put(g, guy(ARMY_RED, 'wave', false), 0, 1.6, 0.6, Math.PI);
  const duck = put(g, built((p) => {
    p.add(ball(0.35, 10, 8), P(0xffd23a), 0, 0, 0, 0, 0, 0, 1, 0.8, 1.2);
    p.add(ball(0.22, 10, 8), P(0xffd23a), 0, 0.3, -0.25);
    p.add(box(0.2, 0.08, 0.2), P(0xf07a1a), 0, 0.28, -0.48);
  }), 0.6, 3.25, -1.4);
  const bubbles = Array.from({ length: 8 }, (_, i) => put(g, new THREE.Mesh(ball(0.25, 10, 8), new THREE.MeshPhysicalMaterial({ color: 0xe8f4ff, roughness: 0, transparent: true, opacity: 0.5, clearcoat: 1 })), 0, 3 + i, 0));
  tools.solid(0, 0, 2.2, 3.4);
  tools.solid(0, -4.2, 0.4, 7);
  put(g, signboard(['NO WATER ON THE MOON', 'SO HE BROUGHT HIS OWN'], 4.6, 1.3, { bg: '#e8f6ff', fg: '#2a5a8a' }), -5.5, 0, 4, 0.5);
  const hello = greeter(26, ['OI! DO YOU MIND?!', '♪ RUB-A-DUB-DUB ♪'], '#9fd4f0');
  return (ctx) => {
    bather.rotation.z = Math.sin(ctx.t * 2) * 0.15;
    duck.position.y = 3.25 + Math.sin(ctx.t * 2.5) * 0.05;
    bubbles.forEach((b, i) => {
      const f = (ctx.t * 0.12 + i / bubbles.length) % 1;
      b.position.set(Math.sin(i * 2.3 + f * 4) * 1.5, 3.2 + f * 12, Math.cos(i * 1.7) * 1.8);
      b.scale.setScalar(0.6 + f * 1.4);
    });
    hello(ctx);
  };
}

// ---------- the living room ----------

/** A sofa, a telly and a standard lamp in the middle of nowhere: best view in the solar system and they're watching TV. */
export function livingRoom(g: THREE.Group, tools: WonderTools): WonderAnim {
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(10, 8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checkTexture('#b8503a', '#d8a868', 10), roughness: 1 }));
  rug.position.y = 0.06;
  rug.receiveShadow = true;
  g.add(rug);
  const sofa = P(0x5a7ab8);
  g.add(
    built((p) => {
      // The sofa faces the telly at -Z.
      p.add(box(5.4, 0.9, 2), sofa, 0, 0.6, 2.5);
      p.add(box(5.4, 1.6, 0.6), sofa, 0, 1.6, 3.3);
      for (const s of [-1, 1]) p.add(box(0.6, 1.3, 2), sofa, s * 2.7, 1.0, 2.5);
      for (const x of [-1.6, 0, 1.6]) p.add(box(1.5, 0.3, 1.7), P(0x7a9ad8), x, 1.15, 2.4);
      // The armchair.
      p.add(box(2, 0.9, 2), P(0xb84a5a), -4.5, 0.6, 0);
      p.add(box(2, 1.6, 0.5), P(0xb84a5a), -5.2, 1.6, 0, 0, Math.PI / 2);
      // The coffee table with tea things.
      p.add(box(2.6, 0.12, 1.4), P(0x8b5e38), 0, 0.9, 0.2);
      for (const [x, z] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.9], [1.1, 0.9]]) p.add(box(0.12, 0.85, 0.12), P(0x6a4428), x, 0.43, z);
      p.add(ball(0.32, 12, 10), P(0xf2eee2), -0.4, 1.25, 0.2);
      for (const x of [0.4, 0.8]) p.add(cyl(0.12, 0.1, 0.2, 10), P(0xf2eee2), x, 1.06, 0.3);
      // The telly on its stand.
      p.add(box(3.4, 2.4, 1.4), P(0x6a4428), 0, 2.6, -3);
      p.add(box(2.4, 1.2, 1.2), P(0x3a3e46), 0, 0.6, -3);
      for (const s of [-1, 1]) p.add(cyl(0.03, 0.03, 1.4, 6), P(0xd9dee6), s * 0.5, 4.4, -3.1, 0, 0, s * 0.4);
      // The standard lamp, a pot plant and a picture on a bit of wall.
      p.add(cyl(0.06, 0.06, 3.2, 8), P(0x3a3e46), 3.6, 1.6, 2.8);
      p.add(cyl(0.6, 0.9, 0.9, 14), glow(0xfff0c0, 0.9), 3.6, 3.4, 2.8);
      p.add(cyl(0.5, 0.4, 0.8, 12), P(0xc8703a), -4, 0.4, -3);
      for (let i = 0; i < 6; i++) p.add(new THREE.ConeGeometry(0.25, 1.4, 6), P(0x4a9a3a), -4 + Math.cos(i) * 0.3, 1.4, -3 + Math.sin(i) * 0.3, Math.cos(i) * 0.4, 0, Math.sin(i) * 0.4);
      p.add(box(3, 4, 0.3), P(0xe8dcc0), 5.5, 2, -1, 0, -0.8);
    }),
  );
  const pic = panel(signTexture(['HOME', 'SWEET', 'HOME'], 1.4, 1.4, { bg: '#fff8e8', fg: '#b84a5a', border: '#8b5e38' }), 1.4, 1.4);
  pic.position.set(5.4, 2.6, -0.85);
  pic.rotation.y = -0.8;
  g.add(pic);
  // The screen: what's on changes every few seconds.
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const tv = c.getContext('2d') as CanvasRenderingContext2D;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = panel(tex, 2.8, 1.9, true);
  screen.position.set(0, 2.6, -2.28);
  g.add(screen);
  const show = (n: number, t: number) => {
    if (n % 3 === 0) {
      ['#ffffff', '#ffe03a', '#3ae0ff', '#3aff7a', '#ff3ae0', '#ff3a3a', '#3a3aff'].forEach((col, i) => {
        tv.fillStyle = col;
        tv.fillRect(i * 18.3, 0, 18.3, 96);
      });
    } else if (n % 3 === 1) {
      tv.fillStyle = '#0a0a1a';
      tv.fillRect(0, 0, 128, 96);
      tv.fillStyle = '#3a7ae8';
      tv.beginPath();
      tv.arc(64, 48, 30, 0, Math.PI * 2);
      tv.fill();
      tv.fillStyle = '#4ac04a';
      tv.fillRect(50 + Math.sin(t) * 10, 34, 22, 16);
      tv.fillRect(60, 58, 16, 10);
    } else {
      tv.fillStyle = '#7ac0f0';
      tv.fillRect(0, 0, 128, 96);
      tv.fillStyle = '#4b7a2e';
      tv.fillRect(20 + ((t * 30) % 100), 56, 30, 14);
      tv.fillStyle = '#111';
      tv.fillRect(24 + ((t * 30) % 100), 68, 7, 7);
      tv.fillRect(40 + ((t * 30) % 100), 68, 7, 7);
      tv.fillStyle = '#ffffff';
      tv.font = 'bold 14px sans-serif';
      tv.fillText('BUGGY TV', 30, 20);
    }
    tex.needsUpdate = true;
  };
  show(0, 0);
  const viewers = [put(g, alien('sit', 0x8ee05a), -1.5, 0.75, 2.3, 0), put(g, alien('sit', 0xffa0c8), 1.5, 0.75, 2.3, 0)];
  put(g, guy(ARMY_TAN, 'kneel'), -4.4, 0.9, 0.1, -Math.PI / 2);
  tools.solid(0, 2.6, 2.8, 2.4);
  tools.solid(0, -3, 1.8, 4);
  tools.solid(-4.5, 0, 1.3, 1.6);
  put(g, signboard(['BEST VIEW IN THE SOLAR SYSTEM.', "THEY'RE WATCHING TELLY."], 5.6, 1.2, { bg: '#fff8e8', fg: '#5a3a2a' }), 0, 0, 7, 0);
  const hello = greeter(26, ["SHHH! THE GOOD BIT'S ON", 'HAVE YOU SEEN THIS ONE? IT HAS A BUGGY IN IT'], '#ffd24a');
  let channel = 0;
  let timer = 0;
  return (ctx) => {
    timer += ctx.dt;
    if (ctx.dist < 120 && (timer > 4 || channel % 3 !== 0)) {
      if (timer > 4) {
        timer = 0;
        channel++;
      }
      show(channel, ctx.t);
    }
    viewers.forEach((v, i) => (v.rotation.z = Math.sin(ctx.t * 1.5 + i * 2) * 0.06));
    hello(ctx);
  };
}

// ---------- the upside-down house ----------

/** A cottage balanced on its roof: low gravity got a bit too low. */
export function upsideDownHouse(g: THREE.Group, tools: WonderTools): WonderAnim {
  const house = new THREE.Group();
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-3.6, 0);
  roofShape.lineTo(3.6, 0);
  roofShape.lineTo(0, 3);
  roofShape.closePath();
  house.add(
    built((p) => {
      // Built the right way up, then the whole thing is turned over.
      p.add(box(6, 4, 5), P(0xf2e2c0), 0, 2, 0);
      p.add(new THREE.ExtrudeGeometry(roofShape, { depth: 6, bevelEnabled: false }).translate(0, 0, -3).rotateY(Math.PI / 2), P(0xc84a3a), 0, 4, 0);
      p.add(box(0.8, 2, 0.8), P(0x8a5a4a), 1.5, 6.2, 1);
      p.add(box(1.2, 2.2, 0.1), P(0x3a6ed8), 0, 1.1, 2.52);
      p.add(ball(0.08, 6, 5), P(0xe8c23f), 0.4, 1.1, 2.6);
      for (const s of [-1, 1]) {
        p.add(box(1.2, 1.1, 0.1), P(0x9fd4f0), s * 1.9, 2.5, 2.52);
        p.add(box(1.3, 0.12, 0.14), P(0xffffff), s * 1.9, 2.5, 2.54);
        p.add(box(0.1, 1.2, 0.14), P(0xffffff), s * 1.9, 2.5, 2.54);
        p.add(box(1.6, 0.4, 0.5), P(0x8b5e38), s * 1.9, 1.8, 2.8);
        for (let i = 0; i < 3; i++) p.add(ball(0.18, 8, 6), P([0xe0503f, 0xffd24a, 0xf7a8c8][i]), s * 1.9 - 0.5 + i * 0.5, 2.1, 2.8);
      }
    }),
  );
  house.rotation.z = Math.PI;
  house.position.y = 7;
  g.add(house);
  g.add(
    built((p) => {
      // Props stopping it toppling over, and the path to the (upside-down) front door.
      for (const s of [-1, 1]) p.beam(v3(s * 3, 6.5, 0), v3(s * 6, 0, 0), 0.25, P(0x8b5e38), true);
      for (let i = 0; i < 5; i++) p.add(box(1.2, 0.08, 0.9), P(0xb8b0a0), 0, 0.04, 4 + i * 1.3);
      // A letterbox and a gnome, both on their heads.
      p.add(box(0.6, 0.5, 0.8), P(0xd8303a), 3, 0.25, 6);
      p.add(cyl(0.06, 0.06, 1.3, 6), P(0x3a3e46), 3, 1.15, 6);
      p.add(new THREE.ConeGeometry(0.3, 0.7, 10).rotateX(Math.PI), P(0xd8303a), -3, 0.35, 5);
      p.add(ball(0.3, 10, 8), P(0xf0c8a0), -3, 0.9, 5);
      p.add(ball(0.25, 10, 8), P(0xffffff), -3, 0.75, 4.8);
      p.add(cyl(0.3, 0.25, 0.6, 10), P(0x3a6ed8), -3, 1.4, 5);
    }),
  );
  const resident = put(g, guy(ARMY_GREEN, 'wave'), 2, 1.95, 4.5, 0);
  resident.rotation.z = Math.PI;
  tools.solid(0, 0, 4, 7);
  put(g, signboard(['LOW GRAVITY GOT', 'A BIT TOO LOW'], 3.8, 1.3, { bg: '#fff8e8', fg: '#3a6ed8' }), -6, 0, 7, 0.4);
  const hello = greeter(30, ["EVERYTHING'S FINE! (IT'S NOT)", 'MIND THE CHIMNEY. IT GOES DOWN.'], '#ffd24a');
  return (ctx) => {
    house.rotation.x = Math.sin(ctx.t * 0.7) * 0.03;
    resident.rotation.x = Math.sin(ctx.t * 2) * 0.1;
    if (Math.floor(ctx.t / 3) !== Math.floor((ctx.t - ctx.dt) / 3)) ctx.dust(v3(1.5, 0.3, -1), 5, 1.2);
    hello(ctx);
  };
}

// ---------- the washing line ----------

/** A washing line of enormous pants. No wind up here, so they've been "drying" for years. Whose are they? */
export function washingLine(g: THREE.Group, tools: WonderTools): WonderAnim {
  const tshirt = signTexture(['I ♥', 'EARTH'], 2, 2, { bg: '#ffffff', fg: '#d8303a', border: '#ffffff' });
  g.add(
    built((p) => {
      for (const x of [-9, 9]) {
        p.add(cyl(0.15, 0.18, 6, 8), P(0x8b5e38), x, 3, 0);
        p.add(box(1.6, 0.2, 0.2), P(0x8b5e38), x, 5.9, 0);
      }
      p.add(cyl(0.03, 0.03, 18, 4).rotateZ(Math.PI / 2), P(0xf2eee2), 0, 5.6, 0);
      // The pants: enormous white Y-fronts with red hearts.
      p.add(box(4, 2.2, 0.15), P(0xffffff), -4.5, 4.5, 0);
      for (const s of [-1, 1]) p.add(box(1.6, 1.4, 0.15), P(0xffffff), -4.5 + s * 1.2, 2.8, 0);
      for (const [x, y] of [[-5.5, 4.8], [-3.6, 4.2], [-4.6, 3.6], [-5.6, 2.8], [-3.4, 2.9]]) p.add(cyl(0.22, 0.22, 0.17, 10).rotateX(Math.PI / 2), P(0xe0303a), x, y, 0);
      p.add(box(4.1, 0.35, 0.18), P(0x3a6ed8), -4.5, 5.45, 0);
      // A stripy sock as tall as a man.
      p.add(box(1, 3.4, 0.15), P(0xffd24a), 1.2, 3.8, 0);
      p.add(box(1.8, 0.9, 0.15), P(0xffd24a), 1.6, 2.4, 0);
      for (let i = 0; i < 4; i++) p.add(box(1.02, 0.3, 0.17), P(0x8a5ad8), 1.2, 5.0 - i * 0.7, 0);
      // Pegs.
      for (const x of [-6.3, -2.7, 0.9, 1.5, 4, 6.8]) p.add(box(0.15, 0.5, 0.25), P(0xe0503f), x, 5.55, 0);
      // The laundry basket.
      p.add(cyl(1, 0.8, 1, 14), P(0xd8c08a), 6, 0.5, 3);
    }),
  );
  const shirt = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: tshirt, side: THREE.DoubleSide }));
  shirt.position.set(5.3, 4.2, 0.05);
  g.add(shirt);
  for (const x of [-9, 9]) tools.solid(x, 0, 0.4, 6);
  put(g, signboard(['NO WIND ON THE MOON.', 'STILL NOT DRY.'], 4.2, 1.2, { bg: '#e8f6ff', fg: '#3a5a8a' }), -2, 0, 5, 0.2);
  put(g, guy(ARMY_BLUE, 'point'), 4, 0, 5, Math.PI + 0.3);
  const hello = greeter(30, ['WHOSE PANTS ARE THOSE?!', "THEY'RE NOT MINE. HONEST."], '#ffffff');
  return (ctx) => {
    hello(ctx);
  };
}

// ---------- the man in the Moon ----------

/** The Man in the Moon himself, having a lie-in: a giant face half sunk in the dust, snoring. He wakes up if you get close. */
export function manInTheMoon(g: THREE.Group, tools: WonderTools): WonderAnim {
  const skin = P(0xf2e2a0);
  const head = new THREE.Group();
  const R = 11;
  head.add(
    built((p) => {
      p.add(ball(R, 36, 24), skin, 0, 0, 0);
      p.add(ball(2.4, 18, 14), P(0xf8d890), 0, 0, R + 0.6);
      for (const s of [-1, 1]) {
        p.add(ball(2, 14, 10), P(0xf8b0a0), s * 5.5, -2.6, R - 2.2, 0, 0, 0, 1, 0.7, 0.4);
        p.add(box(3.4, 0.5, 0.6), P(0xc0a060), s * 4, 4.6, R - 1.4, -0.3, 0, s * 0.25);
      }
      p.add(ball(1.8, 16, 12), P(0x6a2a2a), 0, -5, R - 1.8, 0, 0, 0, 1.3, 0.8, 0.5);
      // His nightcap.
      p.add(new THREE.ConeGeometry(7, 14, 20), P(0x3a6ed8), 0, 10, -3, -1.1);
      p.add(new THREE.TorusGeometry(6.8, 1, 8, 24).rotateX(Math.PI / 2), P(0xffffff), 0, 6.5, 0.3, -1.1);
      p.add(ball(1.6, 12, 10), P(0xffffff), 0, 9, -16);
    }),
  );
  const shut = built((p) => {
    for (const s of [-1, 1]) p.add(new THREE.TorusGeometry(1.4, 0.25, 6, 14, Math.PI), P(0x3a2a1a), s * 4, 2.5, R - 0.9, 0.2, 0, Math.PI);
  });
  const open = built((p) => {
    for (const s of [-1, 1]) {
      p.add(ball(1.6, 14, 10), P(0xffffff), s * 4, 2.5, R - 1.2, 0, 0, 0, 1, 1, 0.5);
      p.add(ball(0.75, 10, 8), P(BLACK), s * 4, 2.4, R - 0.4);
    }
  });
  open.visible = false;
  head.add(shut, open);
  head.rotation.x = -0.75;
  head.position.y = 1;
  g.add(head);
  tools.solid(0, 0, R, R + 1);
  tools.solid(0, 9, 3, 6);
  // Big Zs floating up.
  const zs = [0, 1, 2].map(() =>
    put(
      g,
      built((p) => {
        p.add(box(1.6, 0.35, 0.35), P(0xffffff), 0, 0.8, 0);
        p.add(box(1.6, 0.35, 0.35), P(0xffffff), 0, -0.8, 0);
        p.add(box(2, 0.35, 0.35), P(0xffffff), 0, 0, 0, 0, 0, -0.9);
      }, false),
      0,
      0,
      0,
    ),
  );
  put(g, signboard(["SHHH! HE'S HAVING", 'A LIE-IN'], 4, 1.4, { bg: '#1a1a3a', fg: '#ffd24a' }), 14, 0, 12, -0.4);
  let awake = 0;
  let near = false;
  return (ctx) => {
    if (ctx.dist < 34 && !near) {
      near = true;
      awake = 4;
      ctx.say("WHO'S THERE?! …OH, IT'S YOU. NIGHT NIGHT.", '#ffd24a');
      ctx.sound('boom', 0.35, 0.6);
    } else if (ctx.dist > 50) near = false;
    awake = Math.max(0, awake - ctx.dt);
    open.visible = awake > 0;
    shut.visible = awake === 0;
    head.rotation.x = -0.75 + (awake > 0 ? 0.12 : Math.sin(ctx.t * 0.6) * 0.02);
    zs.forEach((z, i) => {
      const f = (ctx.t * 0.18 + i / 3) % 1;
      z.visible = awake === 0;
      z.position.set(-3 + f * 8, 9 + f * 14, 6 - f * 2);
      z.scale.setScalar(0.6 + f * 1.4);
      z.rotation.z = Math.sin(f * 6) * 0.3;
    });
    if (awake === 0 && ctx.dist < 90 && Math.floor(ctx.t / 3.4) !== Math.floor((ctx.t - ctx.dt) / 3.4)) ctx.sound('thud', 0.25, 0.4);
  };
}

// ---------- the pirate ship ----------

function jollyRoger(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 84;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 128, 84);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(64, 36, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(54, 46, 20, 12);
  ctx.fillStyle = '#111';
  for (const x of [56, 72]) {
    ctx.beginPath();
    ctx.arc(x, 34, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(30, 60);
  ctx.lineTo(98, 78);
  ctx.moveTo(98, 60);
  ctx.lineTo(30, 78);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A pirate ship stranded in a crater, its crew peering through telescopes for the sea. */
export function pirateShip(g: THREE.Group, tools: WonderTools): WonderAnim {
  const wood = P(0x8a5426);
  const dark = P(0x5a3416);
  const ship = new THREE.Group();
  ship.add(
    built((p) => {
      const hull = [
        { z: -11, w: 0.6, h: 2.4, y: 3.2 },
        { z: -8, w: 5, h: 4, y: 2.6 },
        { z: -3, w: 7, h: 4.6, y: 2.3 },
        { z: 3, w: 7, h: 4.6, y: 2.3 },
        { z: 8, w: 6.2, h: 5.4, y: 2.8 },
        { z: 10, w: 5.6, h: 6, y: 3.2 },
      ];
      p.add(loftGeometry(hull, 24, 2.6), wood);
      p.add(box(6, 0.3, 17), dark, 0, 4.4, -0.5);
      p.add(box(5.4, 2.2, 4), wood, 0, 5.6, 8);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          p.add(box(0.1, 0.8, 0.8), P(0x1a1a1a), s * 3.45, 3.2, -5 + i * 3);
          p.add(cyl(0.22, 0.25, 1.2, 10).rotateZ(Math.PI / 2), P(0x2a2c31), s * 3.9, 3.2, -5 + i * 3);
        }
        p.add(box(0.15, 0.8, 16), dark, s * 3.0, 5, -1);
      }
      // Masts, yards, the bowsprit and a crow's nest.
      for (const [z, h] of [[-3, 16], [4, 13]]) {
        p.add(cyl(0.3, 0.35, h, 10), dark, 0, 4.4 + h / 2, z);
        p.add(cyl(0.15, 0.15, 7, 8).rotateZ(Math.PI / 2), dark, 0, 4.4 + h * 0.85, z);
        p.add(cyl(0.15, 0.15, 8, 8).rotateZ(Math.PI / 2), dark, 0, 4.4 + h * 0.45, z);
      }
      p.add(cyl(1.3, 1.1, 1, 12), wood, 0, 19.6, -3);
      p.add(cyl(0.2, 0.25, 7, 8).rotateX(Math.PI / 2 - 0.35), dark, 0, 4.8, -13);
      // Sails, bellied with no wind (they're just like that).
      for (const [z, y0, y1, w] of [[-3, 8.2, 15.5, 6.6], [4, 7.4, 13.2, 5.8]]) p.add(box(w, y1 - y0, 0.25), P(0xf6f0e0), 0, (y0 + y1) / 2, z + 0.4, 0, 0, 0);
      // The plank.
      p.add(box(0.9, 0.15, 5), P(0xb07a3e), 4.4, 4.5, 1, 0, 0, 0);
    }),
  );
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.7, 6, 1).translate(1.3, 0, 0), new THREE.MeshStandardMaterial({ map: jollyRoger(), side: THREE.DoubleSide }));
  flag.position.set(0, 21.8, -3);
  ship.add(flag);
  ship.rotation.set(0.04, 0, 0.12);
  g.add(ship);
  // The crew: one up in the crow's nest, one walking the plank, a lookout with a telescope.
  const lookout = put(ship, guy(ARMY_RED, 'point'), 0, 20.1, -3, Math.PI);
  const scope = built((p) => p.add(cyl(0.08, 0.12, 0.9, 8).rotateX(Math.PI / 2), P(0xe8c23f), 0.36, 1.58, -0.6));
  lookout.add(scope);
  put(ship, guy(ARMY_TAN, 'wave'), 4.4, 4.55, 3, -Math.PI / 2);
  put(ship, guy(ARMY_RED, 'point'), -1.5, 4.55, -8, Math.PI);
  put(ship, guy(ARMY_BLUE, 'salute'), 0, 6.7, 8, Math.PI);
  // A parrot on the rail.
  put(ship, built((p) => {
    p.add(ball(0.3, 10, 8), P(0x3ac04a), 0, 0.3, 0, 0, 0, 0, 1, 1.3, 1);
    p.add(ball(0.2, 10, 8), P(0xe0303a), 0, 0.75, -0.05);
    p.add(new THREE.ConeGeometry(0.08, 0.2, 6).rotateX(Math.PI / 2 + 0.6), P(0xffd24a), 0, 0.7, -0.3);
    p.add(box(0.15, 0.6, 0.3), P(0x3a8ae0), 0, 0.1, 0.35, 0.6);
  }), -3, 5.4, 2, Math.PI / 2);
  // X marks the spot.
  g.add(built((p) => {
    for (const s of [-1, 1]) p.add(box(5, 0.08, 0.8), P(0xa81c24), 14, 0.06, 6, 0, s * 0.785);
  }, false));
  tools.solid(0, -6, 3.4, 6);
  tools.solid(0, 0, 3.8, 6);
  tools.solid(0, 6, 3.8, 7);
  put(g, signboard(["WHICH WAY'S THE SEA?"], 4.4, 0.9, { bg: '#f6f0e0', fg: '#5a3416', border: '#5a3416' }), 10, 0, -4, -0.6);
  const hello = greeter(40, ['ARRR! WHICH WAY IS THE SEA?', "ARRR! WE'VE BEEN BECALMED FOR AGES"], '#ffd24a');
  return (ctx) => {
    ship.rotation.z = 0.12 + Math.sin(ctx.t * 0.6) * 0.025;
    const pos = flag.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 2 - ctx.t * 3) * 0.12 * pos.getX(i));
    pos.needsUpdate = true;
    lookout.rotation.y = Math.PI + Math.sin(ctx.t * 0.4) * 1.2;
    hello(ctx);
  };
}

// ---------- the UFO's parking ticket ----------

/** A flying saucer parked on double yellow lines, and a traffic warden who has seen it all before. */
export function ufoTicket(g: THREE.Group, tools: WonderTools): WonderAnim {
  g.add(built((p) => {
    for (const x of [-0.6, 0.6]) p.add(box(0.35, 0.05, 26), P(0xffd23a), 6 + x, 0.04, 0);
    p.add(cyl(0.12, 0.12, 1.4, 8), P(0x3a3e46), 7.6, 0.7, 4);
    p.add(box(0.5, 0.8, 0.35), P(0x9aa0a8), 7.6, 1.7, 4);
    p.add(box(0.3, 0.2, 0.05), glow(0xff3a3a, 1), 7.6, 1.85, 3.8);
  }));
  const ship = ufo(0xa8e0b8);
  put(g, ship.group, 2, 0, 0, 0.4);
  const ticket = panel(signTexture(['PARKING', 'FINE'], 1.6, 1.2, { bg: '#ffd23a', fg: '#1a1a1a' }), 1.6, 1.2);
  ticket.position.set(2.5, 4.3, 1.6);
  ticket.rotation.x = -0.6;
  g.add(ticket);
  tools.solid(2, 0, 4.4, 5);
  const warden = put(g, guy(ARMY_TAN, 'point'), 8, 0, -2, Math.PI / 2 + 0.6);
  const pad = built((p) => p.add(box(0.35, 0.45, 0.05), P(0xffffff), -0.3, 1.25, -0.4));
  warden.add(pad);
  const owner = put(g, alien('run', 0x8ee05a), -6, 0, 6, Math.PI / 2);
  put(g, signboard(['NO PARKING', 'ANY TIME · ANY PLANET'], 3.8, 1.4, { bg: '#ffffff', fg: '#d8303a', border: '#d8303a' }), 9.5, 0, 6, -0.4);
  const hello = greeter(30, ["THAT'S A FINE! TWELVE MOON DOLLARS", "I WAS ONLY GONE A MINUTE! (A LIGHT-YEAR)"], '#ffd23a');
  return (ctx) => {
    twinkle(ship.lights, ctx.t, 9);
    ship.group.position.y = Math.sin(ctx.t * 2) * 0.08;
    // The owner runs back and forth flapping.
    const run = Math.sin(ctx.t * 0.8);
    owner.position.x = -6 + run * 4;
    owner.rotation.y = Math.cos(ctx.t * 0.8) > 0 ? -Math.PI / 2 : Math.PI / 2;
    owner.position.y = Math.abs(Math.sin(ctx.t * 9)) * 0.25;
    hello(ctx);
  };
}

// ---------- the end of the rainbow ----------

class ArchCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly r: number, private readonly h: number) {
    super();
  }

  getPoint(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = Math.PI * t;
    return out.set(-this.r + this.r * Math.cos(a), this.h * Math.sin(a), 0);
  }
}

/** A rainbow arching right over the valley, and at its end a pot of gold with a leprechaun dancing on it. */
export function rainbowEnd(g: THREE.Group, tools: WonderTools): WonderAnim {
  // The pot sits at the rainbow's east foot; the arch reaches 660 m west to the other foot.
  const bands = [0xff3a3a, 0xff8a1a, 0xffe03a, 0x4ad84a, 0x3a9aff, 0x5a4ad8, 0xb04ad8];
  bands.forEach((color, k) => {
    const r = 330 - k * 4.2;
    const arch = new THREE.Mesh(
      new THREE.TubeGeometry(new ArchCurve(r, 150 - k * 4.2), 160, 2.3, 6, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, fog: false }),
    );
    arch.position.set(-k * 4.2, -3, 0);
    arch.renderOrder = 2;
    arch.frustumCulled = false;
    g.add(arch);
  });
  const pot = built((p) => {
    const pts = [[0, 0], [1.6, 0.1], [2.4, 1], [2.5, 2], [2.1, 2.9], [2.3, 3.1], [2.2, 3.2], [0, 3.2]].map(([x, y]) => new THREE.Vector2(x, y));
    p.add(new THREE.LatheGeometry(pts, 24), P(0x1e2026), 0, 0, 0);
    p.add(cyl(2.1, 2.1, 0.3, 24), P(0xf2c43a), 0, 3.0, 0);
    for (let i = 0; i < 24; i++) {
      const a = i * 2.4;
      const d = (i % 6) * 0.3;
      p.add(cyl(0.35, 0.35, 0.08, 10), P(0xf2c43a), Math.cos(a) * d, 3.3 + (5 - i % 6) * 0.25, Math.sin(a) * d, i, 0, i * 0.5);
    }
    // Spilt coins all round.
    for (let i = 0; i < 30; i++) {
      const a = i * 1.7;
      const d = 3 + (i % 5) * 0.9;
      p.add(cyl(0.35, 0.35, 0.08, 10), P(0xf2c43a), Math.cos(a) * d, 0.06, Math.sin(a) * d, 0.1 * (i % 3), 0, 0);
    }
  });
  g.add(pot);
  tools.solid(0, 0, 2.6, 4);
  const sparkles = Array.from({ length: 6 }, (_, i) => put(g, new THREE.Mesh(new THREE.OctahedronGeometry(0.25), glow(0xfff0a0, 2)), Math.cos(i) * 1.5, 4.5, Math.sin(i) * 1.5));
  const leprechaun = guy(ARMY_GREEN, 'cheer');
  leprechaun.add(built((p) => {
    p.add(cyl(0.28, 0.28, 0.6, 12), P(0x2a8a3a), 0, 2.1, -0.05);
    p.add(cyl(0.45, 0.45, 0.05, 14), P(0x2a8a3a), 0, 1.82, -0.05);
    p.add(box(0.3, 0.15, 0.05), P(0xe8c23f), 0, 1.98, -0.33);
  }));
  put(g, leprechaun, 0, 3.6, 0, 0);
  put(g, signboard(['FINDERS', 'KEEPERS!'], 2.8, 1.3, { bg: '#2a8a3a', fg: '#ffd24a', border: '#ffd24a' }), 5, 0, 4, -0.5);
  const hello = greeter(30, ['THE END OF THE RAINBOW!', 'GOLD! (IT IS CHOCOLATE COINS)'], '#ffd24a');
  return (ctx) => {
    leprechaun.position.y = 3.6 + Math.abs(Math.sin(ctx.t * 4)) * 0.7;
    leprechaun.rotation.y = ctx.t * 2;
    sparkles.forEach((s, i) => {
      const a = ctx.t * 1.5 + i;
      s.position.set(Math.cos(a) * (1.4 + (i % 2)), 4 + Math.sin(ctx.t * 3 + i) * 0.8, Math.sin(a) * (1.4 + (i % 2)));
      s.rotation.y = ctx.t * 4;
    });
    hello(ctx);
  };
}

// ---------- fishing for stars ----------

/** At the valley's very edge, a soldier on a camping stool fishing for stars. He's caught one. */
export function starFishing(g: THREE.Group, tools: WonderTools): WonderAnim {
  g.add(built((p) => {
    for (let i = 0; i < 5; i++) p.add(new THREE.DodecahedronGeometry(1.4 + (i % 3) * 0.6, 0), P(0x8a8a90), -4 + i * 2.2, 0.6, -2 - (i % 2), i, i * 2, 0);
    // The stool, the tackle box and a bucket of stars.
    p.add(cyl(0.5, 0.5, 0.12, 12), P(0x3a6ed8), 0, 0.9, 1);
    for (const s of [-1, 1]) p.beam(v3(s * 0.4, 0, 0.6), v3(-s * 0.3, 0.85, 1.4), 0.08, P(0x9aa0a8), true);
    p.add(box(1, 0.6, 0.6), P(0x3a8a4a), 1.5, 0.3, 1.5);
    p.add(cyl(0.5, 0.4, 0.8, 14), P(0x9aa0a8), -1.5, 0.4, 1.6);
    for (let i = 0; i < 4; i++) p.add(new THREE.OctahedronGeometry(0.22), glow(0xffe060, 1.6), -1.5 + Math.cos(i * 1.7) * 0.25, 0.85, 1.6 + Math.sin(i * 1.7) * 0.25);
  }));
  for (let i = 0; i < 5; i++) tools.solid(-4 + i * 2.2, -2 - (i % 2), 1.6, 2.4);
  put(g, guy(ARMY_GREEN, 'kneel'), 0, 0.3, 1, Math.PI);
  // The rod, bent by the catch, and the line up to the star.
  const rodTip = v3(0.4, 6, -3.5);
  g.add(built((p) => p.beam(v3(0.3, 1.4, 0.6), rodTip, 0.08, P(0x6a4428), true)));
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.9 : 2.2;
    if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  starShape.closePath();
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.6, bevelEnabled: true, bevelSize: 0.2, bevelThickness: 0.2 }).translate(0, 0, -0.3), glow(0xffe060, 1.8));
  g.add(star);
  const line = new THREE.Mesh(cyl(0.03, 0.03, 1, 4), P(0xf2eee2));
  g.add(line);
  put(g, signboard(['GONE FISHING', '(FOR STARS)'], 3, 1.3, { bg: '#1a1a3a', fg: '#ffe060' }), 4, 0, 3, -0.4);
  const hello = greeter(24, ["SHHH! I'VE GOT ONE ON THE LINE!", 'THE BIG ONE GOT AWAY. IT WAS THE SUN.'], '#ffe060');
  return (ctx) => {
    star.position.set(Math.sin(ctx.t * 0.7) * 3, 28 + Math.sin(ctx.t * 1.3) * 2, -14 + Math.cos(ctx.t * 0.5) * 2);
    star.rotation.y = ctx.t * 0.8;
    star.rotation.z = Math.sin(ctx.t * 2) * 0.3;
    const a = rodTip;
    const b = star.position;
    line.position.copy(a).add(b).multiplyScalar(0.5);
    line.scale.set(1, a.distanceTo(b), 1);
    line.quaternion.setFromUnitVectors(v3(0, 1, 0), b.clone().sub(a).normalize());
    hello(ctx);
  };
}

// ---------- zombie aerobics ----------

/** The zombies made it up too. They've given up brains for star jumps. */
export function zombieAerobics(g: THREE.Group, tools: WonderTools): WonderAnim {
  g.add(built((p) => {
    p.add(box(12, 0.12, 9), P(0xb8d8a8), 0, 0.06, 0);
    // The instructor's step and the boombox.
    p.add(box(2.4, 0.5, 1.2), P(0x3a6ed8), 0, 0.25, -6);
    p.add(box(2, 1, 0.8), P(0x2a2c31), 4.5, 0.5, -6.5);
    for (const s of [-1, 1]) p.add(cyl(0.32, 0.32, 0.1, 14).rotateX(Math.PI / 2), P(0x9aa0a8), 4.5 + s * 0.55, 0.5, -6.08);
    p.add(box(1.6, 0.1, 0.1), P(0x9aa0a8), 4.5, 1.1, -6.5);
  }));
  const kinds = [ZOMBIE_COLOR.walker, ZOMBIE_COLOR.runner, ZOMBIE_COLOR.brute];
  const band = P(0xff4aa8);
  const class_: THREE.Object3D[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const z = createZombieFigure(kinds[(row + col) % 3], (row + col) % 2 === 1);
      z.add(built((p) => p.add(new THREE.TorusGeometry(0.17, 0.05, 6, 14).rotateX(Math.PI / 2), band, 0.04, 1.72, -0.05)));
      if (row === 1 && col === 1) z.scale.setScalar(1.35);
      class_.push(put(g, z, (col - 1) * 3.4, 0.12, (row - 1) * 2.8 + 0.5, 0));
    }
  }
  const coach = put(g, guy(ARMY_RED, 'cheer'), 0, 0.5, -6, Math.PI);
  put(g, signboard(['ZOMBIE AEROBICS', 'NO BRAINS, NO GAINS'], 4.6, 1.4, { bg: '#ff4aa8', fg: '#ffffff', border: '#ffffff' }), -7.5, 0, -4, 0.6);
  tools.solid(4.5, -6.5, 1.2, 1);
  const hello = greeter(32, ['AND ONE! AND TWO! (BRAAAINS…)', 'FEEL THE BURN! (WE CAN’T FEEL ANYTHING)'], '#9be27a');
  return (ctx) => {
    const beat = ctx.t * 2.4;
    class_.forEach((z, i) => {
      const f = (beat + (i % 2) * 0.05) % 1;
      z.position.y = 0.12 + 4 * 0.9 * f * (1 - f);
      z.scale.x = (i === 4 ? 1.35 : 1) * (1 + Math.sin(f * Math.PI) * 0.12);
      z.rotation.z = Math.sin(beat * Math.PI) * 0.1;
    });
    coach.position.y = 0.5 + Math.abs(Math.sin(beat * Math.PI)) * 0.6;
    hello(ctx);
  };
}

// ---------- welcome, echo and the road crew ----------

/** The arch over the road at the way in, with balloons and a greeter. */
export function welcomeArch(g: THREE.Group, tools: WonderTools): WonderAnim {
  const W = 8;
  g.add(built((p) => {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 9; i++) p.add(cyl(0.6, 0.6, 1, 14), P(i % 2 ? 0xffffff : 0xff4aa8), s * W, 0.5 + i, 0);
      p.add(ball(0.9, 14, 10), P(0xffd23a), s * W, 9.6, 0);
    }
    p.add(box(W * 2 + 1, 3.2, 0.5), P(0x5a4ad8), 0, 10.4, 0);
  }));
  const front = panel(signTexture(['WELCOME TO', 'THE WEIRD SIDE'], 16, 3, { bg: '#5a4ad8', fg: '#ffe03a', border: '#ff4aa8' }), W * 2, 2.9);
  front.position.set(0, 10.4, 0.27);
  g.add(front);
  const back = panel(signTexture(['COME BACK SOON!', '(YOU WILL)'], 16, 3, { bg: '#5a4ad8', fg: '#ffe03a', border: '#ff4aa8' }), W * 2, 2.9);
  back.position.set(0, 10.4, -0.27);
  back.rotation.y = Math.PI;
  g.add(back);
  const balloons = [0xff3a3a, 0x3a9aff, 0xffe03a, 0x4ad84a, 0xff4aa8, 0xb04ad8].map((c, i) => {
    const s = i % 2 ? 1 : -1;
    const b = built((p) => {
      p.add(ball(0.8, 14, 10), P(c), 0, 3, 0, 0, 0, 0, 1, 1.2, 1);
      p.add(cyl(0.02, 0.02, 3, 4), P(0xf2eee2), 0, 1.5, 0);
    });
    return put(g, b, s * (W + 0.6 + (i % 3) * 0.6), 10, 0.5 - (i % 3) * 0.5);
  });
  for (const s of [-1, 1]) tools.solid(s * W, 0, 0.9, 10);
  const greeterAlien = put(g, alien('wave'), W + 3, 0, 4, 0.4);
  put(g, signboard(['POPULATION:', 'WEIRD'], 2.6, 1.2, { bg: '#ffffff', fg: '#5a4ad8' }), W + 5.5, 0, 3, -0.3);
  return (ctx) => {
    balloons.forEach((b, i) => {
      b.rotation.z = Math.sin(ctx.t * 1.2 + i) * 0.15;
      b.rotation.x = Math.cos(ctx.t * 0.9 + i) * 0.12;
    });
    greeterAlien.position.y = Math.abs(Math.sin(ctx.t * 3)) * 0.3;
  };
}

/** Halfway up the canyon, a soldier on a rock shouting to hear his echo. */
export function echoCanyon(g: THREE.Group, tools: WonderTools): WonderAnim {
  const rockY = tools.groundAt(0, 0);
  g.add(built((p) => {
    p.add(new THREE.DodecahedronGeometry(2.4, 0), P(0x8a8a90), 0, rockY + 0.6, 0, 0.3, 0.5, 0);
    p.add(new THREE.DodecahedronGeometry(1.4, 0), P(0x7a7a80), 2, rockY + 0.3, 1.2, 1, 0.2, 0);
  }));
  tools.solid(0, 0, 2.4, 3);
  const shouter = put(g, guy(ARMY_GREEN, 'wave'), 0, rockY + 2.5, 0, Math.PI / 2);
  put(g, signboard(['ECHO CANYON', 'GO ON, SHOUT'], 3, 1.2, { bg: '#f4efe0', fg: '#5a3a2a' }), -3, rockY, 3, 0);
  const lines = ['HELLOOO!', 'hellooo…', 'hellooo……', 'hello? (is that me?)'];
  let at = -1;
  let wait = 0;
  let near = false;
  return (ctx) => {
    shouter.rotation.z = Math.sin(ctx.t * 3) * 0.08;
    if (ctx.dist < 30 && !near) {
      near = true;
      at = 0;
      wait = 0;
    } else if (ctx.dist > 60) near = false;
    if (at < 0) return;
    wait -= ctx.dt;
    if (wait > 0) return;
    ctx.say(lines[at], at === 0 ? '#ffffff' : '#c9d3dc');
    if (at > 0) ctx.sound('uiMove', 0.5 / at, 0.9);
    at++;
    wait = 0.9;
    if (at >= lines.length) at = -1;
  };
}

/** Where the road crew parked up after building the road: the machines, a kettle on and a well-earned cuppa. */
export function teaBreak(g: THREE.Group, tools: WonderTools): WonderAnim {
  const machines = [bulldozer(ARMY_GREEN), steamroller(ARMY_RED), dumpTruck(ARMY_TAN), cementMixer(ARMY_BLUE)];
  machines.forEach((m, i) => {
    const a = -0.9 + i * 0.6;
    m.root.position.set(Math.sin(a) * 11, 0, -Math.cos(a) * 11 + 2);
    m.root.rotation.y = a + Math.PI;
    g.add(m.root);
    tools.solid(m.root.position.x, m.root.position.z, 2.8, 3.4);
  });
  const mixer = machines[3].churn;
  g.add(built((p) => {
    // A camping stove, the kettle and crates to sit on.
    p.add(box(1, 0.6, 1), P(0x3a3e46), 0, 0.3, 2);
    p.add(ball(0.45, 12, 10), P(0xd9dee6), 0, 0.95, 2, 0, 0, 0, 1, 0.9, 1);
    p.beam(v3(0.4, 1.0, 2), v3(0.75, 1.3, 2), 0.1, P(0xd9dee6), true);
  }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const crate = makeCrate(ARMIES[i % 4]);
    crate.position.set(Math.sin(a) * 3.2, 0.46, 2 + Math.cos(a) * 3.2);
    g.add(crate);
    const who = guy(ARMIES[i % 4], 'kneel');
    who.add(built((p) => p.add(cyl(0.1, 0.08, 0.18, 8), P(0xf2eee2), 0.3, 1.05, -0.35)));
    put(g, who, Math.sin(a) * 3.2, 0.92, 2 + Math.cos(a) * 3.2, a);
  }
  put(g, signboard(['GONE FOR TEA', 'BACK IN 5 MINS (MOON MINUTES)'], 4.6, 1.3, { bg: '#ffd23a', fg: '#1a1a1a' }), 7, 0, 7, -0.3);
  tools.solid(0, 2, 1, 1);
  const hello = greeter(30, ['WANT A CUPPA? KETTLE’S ON', 'BUILT IT IN AN AFTERNOON!'], '#ffd23a');
  return (ctx) => {
    if (mixer) mixer.rotation.z += ctx.dt * 1.2;
    if (Math.floor(ctx.t / 1.5) !== Math.floor((ctx.t - ctx.dt) / 1.5)) ctx.dust(v3(0.8, 1.4, 2), 2, 0.6);
    hello(ctx);
  };
}

