import * as THREE from 'three';
import { ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE } from '../../utils/plastic';
import { MOON_G, makeCrate } from '../Buggy';
import { rampHeight } from '../MoonTerrain';
import { P, v3, box, ball, cyl, glow, guy, put, built, signboard, alien, greeter, signTexture, shade } from './kit';
import type { WonderTools, WonderAnim } from './types';

const ARMIES = [ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE];

// ---------- bowling ----------

interface Pin {
  mesh: THREE.Object3D;
  home: THREE.Vector3;
  down: boolean;
  flying: boolean;
  vel: THREE.Vector3;
  axis: THREE.Vector3;
  angle: number;
  spin: number;
}

const PIN_H = 3.4;

function pinModel(): THREE.Group {
  const pts = [[0, 0], [0.42, 0], [0.62, 0.5], [0.7, 1.0], [0.55, 1.75], [0.3, 2.25], [0.32, 2.6], [0.38, 2.95], [0.3, 3.3], [0, 3.4]].map(([x, y]) => new THREE.Vector2(x, y - PIN_H / 2));
  return built((p) => {
    p.add(new THREE.LatheGeometry(pts, 16), P(0xfaf7ef), 0, 0, 0);
    for (const y of [2.15, 2.4]) p.add(cyl(0.33, 0.35, 0.1, 16), P(0xd8303a), 0, y - PIN_H / 2, 0);
  });
}

/** Moon bowling: a lane, a ball as big as a car, and ten pins taller than a man. Drive into them! */
export function bowling(g: THREE.Group, tools: WonderTools): WonderAnim {
  const LANE = 44;
  g.add(
    built((p) => {
      p.add(box(7, 0.12, LANE), P(0xd8a868), 0, 0.06, 0);
      for (const s of [-1, 1]) p.add(box(1.2, 0.1, LANE), P(0x5a5f68), s * 4.1, 0.05, 0);
      for (let i = 0; i < 7; i++) p.add(new THREE.ConeGeometry(0.3, 0.8, 3).rotateX(-Math.PI / 2), P(0x8a5426), -3 + i, 0.14, 4 - Math.abs(i - 3) * 0.8, 0, 0, 0, 1, 0.1, 1);
      // The back wall behind the pins.
      p.add(box(10, 4, 1), P(0x2a2c31), 0, 2, -LANE / 2 - 2);
      p.add(box(10, 0.6, 1.1), P(0xd8303a), 0, 3.7, -LANE / 2 - 2);
      // The ball, waiting at the start.
      p.add(ball(1.7, 20, 14), P(0x5a2a8a), -5.8, 1.7, LANE / 2 - 3);
      for (const [x, y] of [[-0.35, 0.35], [0.35, 0.35], [0, -0.25]]) p.add(cyl(0.25, 0.25, 0.1, 10).rotateX(Math.PI / 2), P(0x1a1a1a), -5.8 + x, 1.7 + y, LANE / 2 - 4.68);
    }),
  );
  tools.solid(-5.8, LANE / 2 - 3, 1.8, 3.4);
  tools.solid(0, -LANE / 2 - 2, 4, 4);
  tools.solid(-3.5, -LANE / 2 - 2, 1.5, 4);
  tools.solid(3.5, -LANE / 2 - 2, 1.5, 4);
  // The scoreboard.
  const boardTex = (strikes: number) => signTexture(['MOON BOWLING', `STRIKES: ${strikes}`], 5, 2, { bg: '#1a1a3a', fg: '#ffd24a', border: '#d8303a' });
  const board = signboard(['MOON BOWLING', 'STRIKES: 0'], 5, 2, { bg: '#1a1a3a', fg: '#ffd24a', border: '#d8303a' }, 4.2);
  put(g, board, 0, 0, -LANE / 2 - 2.6);
  const boardMats = board.children.slice(0, 2).map((m) => (m as THREE.Mesh).material as THREE.MeshStandardMaterial);
  put(g, signboard(['DRIVE INTO', 'THE PINS!'], 3, 1.4, { bg: '#ffd24a', fg: '#1a1a3a' }), 6.5, 0, LANE / 2 - 1, -0.3);
  const pins: Pin[] = [];
  const GAP = 1.9;
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k <= row; k++) {
      const home = v3((k - row / 2) * GAP, PIN_H / 2, -LANE / 2 + 6 - row * GAP * 0.87);
      const mesh = put(g, pinModel(), home.x, home.y, home.z);
      pins.push({ mesh, home, down: false, flying: false, vel: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), angle: 0, spin: 0 });
    }
  }
  let strikes = 0;
  let resetIn = -1;
  let struck = false;
  const knock = (pin: Pin, push: THREE.Vector3) => {
    pin.flying = true;
    pin.down = true;
    pin.vel.copy(push);
    const flat = v3(push.x, 0, push.z);
    if (flat.lengthSq() < 0.01) flat.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    pin.axis.set(flat.z, 0, -flat.x).normalize();
    pin.spin = 2 + Math.random() * 3;
    resetIn = 12;
  };
  return (ctx) => {
    const b = ctx.buggy;
    for (const pin of pins) {
      if (!pin.down) {
        // The buggy (or a flying pin) knocks a standing pin flying.
        if (Math.hypot(b.x - pin.home.x, b.z - pin.home.z) < 2.2 && b.y < PIN_H + 1) {
          const v = ctx.buggyVel;
          knock(pin, v3(v.x * 0.9 + (pin.home.x - b.x) * 1.5, 3 + Math.hypot(v.x, v.z) * 0.25, v.z * 0.9 + (pin.home.z - b.z) * 1.5));
          ctx.sound('clang', 0.7, 1.5 + Math.random() * 0.4);
          continue;
        }
        for (const other of pins) {
          if (!other.flying || other.mesh.position.distanceTo(pin.mesh.position) > 1.5) continue;
          knock(pin, other.vel.clone().multiplyScalar(0.7).setY(2.5));
          ctx.sound('clang', 0.4, 1.8);
          break;
        }
        continue;
      }
      if (!pin.flying) continue;
      pin.vel.y -= MOON_G * ctx.dt;
      pin.mesh.position.addScaledVector(pin.vel, ctx.dt);
      pin.angle += pin.spin * ctx.dt;
      pin.mesh.quaternion.setFromAxisAngle(pin.axis, pin.angle);
      const floor = 0.62;
      if (pin.mesh.position.y < floor && pin.vel.y < 0) {
        pin.mesh.position.y = floor;
        pin.vel.y *= -0.3;
        pin.vel.x *= 0.6;
        pin.vel.z *= 0.6;
        pin.spin *= 0.5;
        if (Math.abs(pin.vel.y) < 0.8) {
          // Lying down.
          pin.flying = false;
          pin.angle = Math.PI / 2;
          pin.mesh.quaternion.setFromAxisAngle(pin.axis, pin.angle);
        }
      }
    }
    if (!struck && pins.every((p) => p.down)) {
      struck = true;
      strikes++;
      const tex = boardTex(strikes);
      for (const m of boardMats) {
        m.map?.dispose();
        m.map = tex;
        m.needsUpdate = true;
      }
      ctx.say('STRIKE!!!', '#ffd24a');
      ctx.confetti(v3(0, 6, -LANE / 2 + 3));
      ctx.confetti(v3(-3, 8, -LANE / 2 + 5));
      ctx.sound('crack', 0.6, 1.4);
    }
    if (resetIn > 0) {
      resetIn -= ctx.dt;
      if (resetIn <= 0 && Math.hypot(b.x, b.z + LANE / 2 - 4) > 9) {
        // The pins pop back up for another go.
        for (const pin of pins) {
          pin.down = false;
          pin.flying = false;
          pin.angle = 0;
          pin.mesh.quaternion.identity();
          pin.mesh.position.copy(pin.home);
        }
        struck = false;
        ctx.dust(v3(0, 0.5, -LANE / 2 + 4), 16, 3);
        ctx.sound('poof', 0.5, 1.2);
      } else if (resetIn <= 0) resetIn = 1;
    }
  };
}

// ---------- golf ----------

/** Moon golf: a putting green, a golfer mid-swing and golf balls that fly for miles. */
export function golf(g: THREE.Group, tools: WonderTools): WonderAnim {
  g.add(
    built((p) => {
      p.add(cyl(10, 10.5, 0.1, 40), P(0x6ac04a), 0, 0.05, -2);
      p.add(cyl(7, 7, 0.12, 40), P(0x8ad86a), 0, 0.06, -3);
      p.add(cyl(0.35, 0.35, 0.14, 16), P(0x111111), 2, 0.07, -6);
      p.add(cyl(0.05, 0.05, 4, 6), P(0xf2eee2), 2, 2, -6);
      p.add(box(1.4, 0.9, 0.04), P(0xe0303a), 2.7, 3.5, -6);
      // The tee box, a golf bag and a buggy of their own.
      p.add(box(3, 0.15, 3), P(0x8ad86a), -2, 0.08, 7);
      p.add(cyl(0.45, 0.4, 1.6, 12), P(0x2a5ad8), -4.5, 0.85, 8, 0.2);
      for (let i = 0; i < 4; i++) p.add(cyl(0.04, 0.04, 1.2, 6), P(0xd9dee6), -4.6 + i * 0.12, 2, 8.1, 0.25 + i * 0.05);
      p.add(box(2, 1, 3), P(0xf2eee2), 5.5, 0.9, 8);
      p.add(box(2, 0.1, 3.4), P(0x3a8a4a), 5.5, 2.6, 8);
      for (const [x, z] of [[-0.8, -1.2], [0.8, -1.2], [-0.8, 1.2], [0.8, 1.2]]) p.add(cyl(0.05, 0.05, 1.3, 6), P(0xd9dee6), 5.5 + x, 2, 8 + z);
      for (const z of [-1, 1]) for (const s of [-1, 1]) p.add(cyl(0.35, 0.35, 0.25, 12).rotateZ(Math.PI / 2), P(0x1a1a1a), 5.5 + s, 0.35, 8 + z);
    }),
  );
  const golfer = put(g, guy(ARMY_TAN, 'stand'), -2, 0.15, 7.6, Math.PI / 2);
  const club = new THREE.Group();
  club.position.set(0, 1.3, -0.3);
  club.add(built((p) => {
    p.add(cyl(0.03, 0.03, 1.3, 6), P(0xd9dee6), 0, -0.65, 0);
    p.add(box(0.12, 0.12, 0.3), P(0x3a3e46), 0, -1.3, -0.1);
  }));
  golfer.add(club);
  put(g, signboard(['HOLE 1 · PAR 1,000'], 3.6, 0.8, { bg: '#f4efe0', fg: '#2a5a2a' }), -7, 0, 2, 0.6);
  put(g, signboard(['THE FIRST MOON GOLF:', 'APOLLO 14, 1971'], 3.6, 1.2, { bg: '#e8e0c8', fg: '#3a3020' }, 0.9), -7.5, 0, -3, 0.9);
  tools.solid(5.5, 8, 2, 3);
  const balls = Array.from({ length: 3 }, () => put(g, new THREE.Mesh(ball(0.14, 10, 8), P(0xffffff)), -1.6, 0.25, 7));
  const flights = balls.map(() => ({ t: -1, vel: new THREE.Vector3() }));
  let next = 1;
  let shot = 0;
  const hello = greeter(30, ['FORE!', 'FOOOORE! (IT WENT THAT WAY)'], '#ffffff');
  return (ctx) => {
    next -= ctx.dt;
    // The swing: back slowly, through fast.
    const k = Math.max(0, 1 - next / 1.2);
    club.rotation.z = next < 1.2 ? 1.8 * Math.sin(k * Math.PI * 0.5) : -1.6 + Math.min(1, (5 - next) / 1.2) * 1.6;
    if (next <= 0) {
      next = 5;
      club.rotation.z = -1.6;
      const f = flights[shot % flights.length];
      const ballMesh = balls[shot % balls.length];
      shot++;
      ballMesh.position.set(-1.6, 0.25, 7);
      f.t = 0;
      f.vel.set(-14 - Math.random() * 6, 18 + Math.random() * 6, -12 + Math.random() * 8);
      if (ctx.dist < 70) ctx.sound('crack', 0.3, 2.4);
    }
    flights.forEach((f, i) => {
      if (f.t < 0) return;
      f.t += ctx.dt;
      f.vel.y -= MOON_G * ctx.dt;
      balls[i].position.addScaledVector(f.vel, ctx.dt);
      if (f.t > 16) {
        f.t = -1;
        balls[i].position.set(-1.6, 0.25, 7);
      }
    });
    hello(ctx);
  };
}

// ---------- disco ----------

/** The Moon disco: a flashing floor, a mirror ball, coloured beams and everybody dancing. */
export function disco(g: THREE.Group, tools: WonderTools): WonderAnim {
  const tiles = 6;
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const ctx2 = c.getContext('2d') as CanvasRenderingContext2D;
  const floorTex = new THREE.CanvasTexture(c);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  const paint = (beat: number) => {
    const colors = ['#ff3a8a', '#3ae0ff', '#ffe03a', '#7aff3a', '#b03aff', '#ff8a3a'];
    for (let i = 0; i < tiles; i++) {
      for (let j = 0; j < tiles; j++) {
        ctx2.fillStyle = (i + j + beat) % 3 === 0 ? colors[(i * 3 + j + beat) % colors.length] : '#1a1a2a';
        ctx2.fillRect(i * 32 + 1, j * 32 + 1, 30, 30);
      }
    }
    floorTex.needsUpdate = true;
  };
  paint(0);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(14, 0.3, 14), new THREE.MeshStandardMaterial({ map: floorTex, emissive: 0xffffff, emissiveMap: floorTex, emissiveIntensity: 0.9, roughness: 0.3 }));
  floor.position.y = 0.15;
  floor.receiveShadow = true;
  g.add(floor);
  g.add(
    built((p) => {
      for (const s of [-1, 1]) p.add(box(0.4, 11, 0.4), P(0x3a3e46), s * 7.5, 5.5, 0);
      p.add(box(15.4, 0.4, 0.4), P(0x3a3e46), 0, 11, 0);
      p.add(cyl(0.03, 0.03, 2, 4), P(0x3a3e46), 0, 10, 0);
      // The DJ's booth and speakers.
      p.add(box(4, 1.2, 1.4), P(0x2a2c31), 0, 0.9, -8.6);
      for (const s of [-1, 1]) {
        p.add(cyl(0.5, 0.5, 0.1, 18), P(0x111111), s * 1, 1.55, -8.6);
        p.add(box(1.8, 3, 1.6), P(0x1a1a1a), s * 6.5, 1.5, -8.5);
        for (const y of [0.9, 2.2]) p.add(cyl(0.55, 0.55, 0.1, 18).rotateX(Math.PI / 2), P(0x4a4e56), s * 6.5, y, -7.65);
      }
    }),
  );
  const mirrorBall = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 2), new THREE.MeshStandardMaterial({ color: 0xe8eef8, emissive: 0x6a7a9a, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.2, flatShading: true }));
  mirrorBall.position.set(0, 8.6, 0);
  g.add(mirrorBall);
  const beams = [0xff3a8a, 0x3ae0ff, 0xffe03a, 0x7aff3a].map((color) => {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 9, 14, 1, true).translate(0, -4.5, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.position.copy(mirrorBall.position);
    g.add(m);
    return m;
  });
  const dj = put(g, alien('cheer', 0xd08ef0), 0, 0, -9.8, Math.PI);
  const dancers: THREE.Object3D[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const who = i % 3 === 2 ? alien(i % 2 ? 'cheer' : 'wave', [0x8ee05a, 0x5ad0e0, 0xffa0c8][i % 3]) : guy(ARMIES[i % 4], i % 2 ? 'cheer' : 'wave');
    dancers.push(put(g, who, Math.sin(a) * 4.5, 0.3, Math.cos(a) * 4.5, a));
  }
  put(g, signboard(['MOON DISCO'], 4, 1.1, { bg: '#1a1a2a', fg: '#ff6ac8', border: '#3ae0ff' }, 2.2), -9.5, 0, 6, 0.5);
  for (const s of [-1, 1]) tools.solid(s * 7.5, 0, 0.6, 11);
  tools.solid(0, -8.6, 2.2, 1.6);
  for (const s of [-1, 1]) tools.solid(s * 6.5, -8.5, 1.2, 3);
  const hello = greeter(40, ['♪ LOW GRAVITY, HIGH ENERGY ♪', '♪ DO THE MOONWALK! ♪'], '#ff6ac8');
  let lastBeat = -1;
  return (ctx) => {
    const beat = Math.floor(ctx.t * 2.2);
    if (beat !== lastBeat) {
      lastBeat = beat;
      paint(beat);
    }
    mirrorBall.rotation.y += ctx.dt * 1.2;
    beams.forEach((b, i) => {
      const a = ctx.t * 0.9 + (i / beams.length) * Math.PI * 2;
      b.rotation.set(0.55 * Math.cos(a), 0, 0.55 * Math.sin(a));
    });
    dancers.forEach((d, i) => {
      const f = (ctx.t * 1.1 + i * 0.37) % 1;
      d.position.y = 0.3 + 4 * 1.6 * f * (1 - f);
      d.rotation.y += ctx.dt * (i % 2 ? 2 : -2);
    });
    dj.rotation.z = Math.sin(ctx.t * 8.8) * 0.12;
    hello(ctx);
  };
}

// ---------- bouncy castle ----------

/** A bouncy castle with army men bouncing sky-high, and a trampoline in front: drive on and boing! */
export function bouncyCastle(g: THREE.Group, tools: WonderTools): WonderAnim {
  const red = P(0xe8403a);
  const yellow = P(0xffd23a);
  const blue = P(0x3a7ae8);
  const castle = built((p) => {
    p.add(box(12, 1.4, 12), red, 0, 0.7, -4);
    for (const [x, z] of [[-6, -10], [6, -10], [-6, 2], [6, 2]]) {
      p.add(cyl(1.3, 1.4, 6, 16), yellow, x, 3, z);
      p.add(ball(1.4, 14, 10), blue, x, 6.4, z);
      p.add(new THREE.ConeGeometry(0.9, 1.6, 12), red, x, 7.8, z);
    }
    for (const [x, z, len, rot] of [[0, -10, 10, 0], [-6, -4, 10, Math.PI / 2], [6, -4, 10, Math.PI / 2]] as const) {
      p.add(cyl(0.8, 0.8, len, 14).rotateZ(Math.PI / 2), blue, x, 2.2, z, 0, rot);
      p.add(cyl(0.8, 0.8, len, 14).rotateZ(Math.PI / 2), yellow, x, 3.6, z, 0, rot);
      for (let i = -2; i <= 2; i++) p.add(box(1.2, 1.2, 1.2), red, x + (rot ? 0 : i * 2), 4.8, z + (rot ? i * 2 : 0));
    }
    // The trampoline out front.
    p.add(new THREE.TorusGeometry(3.6, 0.45, 10, 32).rotateX(Math.PI / 2), blue, 0, 0.7, 9);
    p.add(cyl(3.4, 3.4, 0.08, 32), P(0x1a1a1a), 0, 0.62, 9);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      p.add(cyl(0.12, 0.12, 0.7, 6), P(0x3a3e46), Math.sin(a) * 3.6, 0.35, 9 + Math.cos(a) * 3.6);
    }
  });
  g.add(castle);
  tools.bouncer(0, 9, 3.6, 13);
  tools.bouncer(0, -4, 5, 10);
  for (const [x, z] of [[-6, -10], [6, -10], [-6, 2], [6, 2]]) tools.solid(x, z, 1.5, 8);
  for (const x of [-4, -2, 0, 2, 4]) tools.solid(x, -10, 0.9, 5.5);
  for (const z of [-8, -6, -4, -2, 0]) for (const s of [-1, 1]) tools.solid(s * 6, z, 0.9, 5.5);
  const bouncers = ARMIES.concat([ARMY_GREEN, ARMY_RED]).map((c, i) => put(g, guy(c, i % 2 ? 'cheer' : 'wave'), -3.5 + (i % 3) * 3.5, 1.4, -7 + Math.floor(i / 3) * 4.5, Math.PI));
  put(g, signboard(['BOUNCY CASTLE', 'BUGGIES WELCOME!'], 4.4, 1.6, { bg: '#ffd23a', fg: '#e8403a', border: '#3a7ae8' }), 9, 0, 9, -0.5);
  const hello = greeter(36, ['WHEEE! TRY THE TRAMPOLINE!', 'BOING BOING BOING!'], '#ffd23a');
  return (ctx) => {
    bouncers.forEach((b, i) => {
      const f = (ctx.t * 0.38 + i * 0.29) % 1;
      b.position.y = 1.4 + 4 * 6 * f * (1 - f);
      b.rotation.x = Math.sin(f * Math.PI * 2) * 0.4;
    });
    castle.scale.y = 1 + Math.sin(ctx.t * 3) * 0.015;
    hello(ctx);
  };
}

// ---------- the buggy cannon ----------

const CANNON_PITCH = 0.55;
const CANNON_RANGE = 220;

/**
 * The human cannonball, but for buggies: drive into the funnel at the back and you're fired across
 * the valley at a bullseye. The cannon fires along its +Z; the target is 220 m out that way.
 */
export function buggyCannon(g: THREE.Group, tools: WonderTools): WonderAnim {
  const red = P(0xd8303a);
  const yellow = P(0xffd23a);
  const barrel = new THREE.Group();
  barrel.position.set(0, 3, 0);
  barrel.rotation.x = -CANNON_PITCH;
  barrel.add(
    built((p) => {
      p.add(cyl(1.9, 2.3, 12, 24).rotateX(Math.PI / 2), red, 0, 0, 4);
      for (const z of [-1.5, 3, 7.5]) p.add(cyl(2.35, 2.35, 0.6, 24).rotateX(Math.PI / 2), yellow, 0, 0, z);
      p.add(cyl(2.3, 2.3, 0.8, 24).rotateX(Math.PI / 2), yellow, 0, 0, 10);
      p.add(cyl(1.6, 1.6, 0.9, 24).rotateX(Math.PI / 2), P(0x1a1a1a), 0, 0, 10.1);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        p.add(new THREE.OctahedronGeometry(0.45, 0), yellow, Math.cos(a) * 2.15, Math.sin(a) * 2.15, 5.2, 0, 0, a);
      }
    }),
  );
  g.add(barrel);
  g.add(
    built((p) => {
      // The carriage and its wheels.
      p.add(box(3.4, 2, 6), P(0x8b5e38), 0, 1.6, -0.5);
      for (const s of [-1, 1]) {
        p.add(cyl(2, 2, 0.5, 20).rotateZ(Math.PI / 2), P(0x5a3a20), s * 2.2, 2, 0);
        p.add(cyl(0.5, 0.5, 0.6, 12).rotateZ(Math.PI / 2), yellow, s * 2.3, 2, 0);
      }
      // The funnel at the back: drive in here.
      p.add(new THREE.CylinderGeometry(3.8, 2, 3, 20, 1, true).rotateX(Math.PI / 2), yellow, 0, 2.1, -5.5);
      p.add(box(4.5, 0.15, 3), P(0x8b5e38), 0, 0.3, -7.5, 0.15);
    }),
  );
  put(g, signboard(['INSERT BUGGY', 'HERE ↓'], 3, 1.3, { bg: '#ffffff', fg: '#d8303a' }), 4.5, 0, -8, Math.PI + 0.4);
  put(g, signboard(['THE HUMAN', 'CANNONBALL'], 3.6, 1.4, { bg: '#d8303a', fg: '#ffd23a', border: '#ffd23a' }), -5, 0, -7, Math.PI - 0.4);
  for (const s of [-1, 1]) tools.solid(s * 2.4, 0, 1.4, 4);
  tools.solid(0, 3, 1.6, 6);
  const muzzle = v3(0, 3 + Math.sin(CANNON_PITCH) * 10.4, Math.cos(CANNON_PITCH) * 10.4 + 0.2);
  tools.cannon(0, -6, 2.6, muzzle, 0, CANNON_PITCH, CANNON_RANGE - muzzle.z);
  // The bullseye, far off, with judges holding up their scores.
  const tz = CANNON_RANGE;
  const target = new THREE.Group();
  target.position.set(0, tools.groundAt(0, tz), tz);
  g.add(target);
  for (let i = 0; i < 5; i++) {
    const ringMesh = new THREE.Mesh(new THREE.CircleGeometry(12 - i * 2.4, 40).rotateX(-Math.PI / 2), P(i % 2 ? 0xffffff : 0xd8303a));
    ringMesh.position.y = 0.12 + i * 0.01;
    ringMesh.receiveShadow = true;
    target.add(ringMesh);
  }
  [10, 9, 10].forEach((score, i) => {
    const judge = guy(ARMIES[i], 'cheer');
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), new THREE.MeshStandardMaterial({ map: signTexture([String(score)], 0.9, 0.7, { bg: '#ffffff', fg: '#111' }), side: THREE.DoubleSide }));
    card.position.set(0, 2.5, -0.1);
    judge.add(card);
    put(target, judge, -4 + i * 4, 0, -15, 0);
  });
  let flying = false;
  const hello = greeter(30, ['DRIVE INTO THE FUNNEL!', 'THREE… TWO… ONE…'], '#ffd23a');
  return (ctx) => {
    hello(ctx);
    const b = ctx.buggy;
    if (b.y > 18) flying = true;
    if (!flying || b.y > 2.5) return;
    flying = false;
    const off = Math.hypot(b.x, b.z - tz);
    if (off < 12) {
      ctx.say(off < 4 ? 'BULLSEYE!!! 10 / 10' : 'ON TARGET! 9 / 10', '#ffd24a');
      ctx.confetti(v3(b.x, 4, b.z));
      ctx.confetti(v3(0, 8, tz - 15));
      ctx.sound('crack', 0.6, 1.3);
    } else if (off < 70) ctx.say('MISSED! (THE JUDGES SAY 3)', '#ffffff');
  };
}

// ---------- the doors that lead somewhere else ----------

function swirlTexture(hue: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  for (let r = 64; r > 0; r -= 4) {
    ctx.fillStyle = `hsl(${hue + r * 2}, 80%, ${30 + (64 - r) * 0.6}%)`;
    ctx.beginPath();
    ctx.arc(64 + Math.sin(r * 0.3) * 6, 64 + Math.cos(r * 0.3) * 6, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A front door standing open in the middle of nowhere; through it, a swirl. Drive through and come out of its twin. */
function door(g: THREE.Group, tools: WonderTools, paint: number, hue: number, number: string): WonderAnim {
  const W = 4.4;
  const H = 5.2;
  // The frame, a step, the porch light.
  g.add(
    built((p) => {
      for (const s of [-1, 1]) p.add(box(0.5, H, 0.6), P(0xf2eee2), s * (W / 2 + 0.25), H / 2, 0);
      p.add(box(W + 1, 0.6, 0.6), P(0xf2eee2), 0, H + 0.3, 0);
      p.add(box(W + 1.6, 0.25, 2.4), P(0x8a8a90), 0, 0.12, 0.8);
      p.add(ball(0.25, 10, 8), glow(0xfff3c0, 1.3), W / 2 + 0.25, H + 0.9, 0.3);
    }),
  );
  // The door itself, swung wide open on its hinge.
  const hinge = new THREE.Group();
  hinge.position.set(-W / 2, 0, 0);
  hinge.add(
    built((p) => {
      p.add(box(W - 0.1, H - 0.15, 0.2), P(paint), W / 2, H / 2, 0);
      p.add(ball(0.15, 8, 6), P(0xe8c23f), W - 0.5, H / 2, 0.15);
      for (const y of [1.3, 3.6]) p.add(box(W - 1.2, 1.6, 0.06), P(shade(paint, 0.8)), W / 2, y, 0.12);
    }),
  );
  hinge.rotation.y = -1.9;
  g.add(hinge);
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.1), new THREE.MeshStandardMaterial({ map: signTexture(['WELCOME'], 2.6, 1.1, { bg: '#8a5426', fg: '#f2e2c0', border: '#5a3416' }) }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0.31, 1.6);
  g.add(mat);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ map: signTexture([number], 0.8, 0.5, { bg: '#e8c23f', fg: '#1a1a1a' }) }));
  plate.position.set(0, H + 0.3, 0.31);
  g.add(plate);
  const tex = swirlTexture(hue);
  tex.center.set(0.5, 0.5);
  const swirl = new THREE.Mesh(new THREE.PlaneGeometry(W, H - 0.1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
  swirl.position.set(0, H / 2, 0);
  g.add(swirl);
  for (const s of [-1, 1]) tools.solid(s * (W / 2 + 0.3), 0, 0.45, H);
  tools.door('doors', 0, 0, 0, W / 2 - 0.2);
  return (ctx) => {
    tex.rotation = ctx.t * 1.5;
    swirl.material.opacity = 0.8 + Math.sin(ctx.t * 3) * 0.12;
  };
}

export function doorBlue(g: THREE.Group, tools: WonderTools): WonderAnim {
  return door(g, tools, 0x3a6ed8, 260, '42');
}

export function doorRed(g: THREE.Group, tools: WonderTools): WonderAnim {
  return door(g, tools, 0xd8303a, 320, '42½');
}

// ---------- the big jump ----------

/** Zoom arrows, a rainbow ramp and a row of buses to jump. The run-up is along local +Z. */
export function bigJump(g: THREE.Group, tools: WonderTools): WonderAnim {
  const LEN = 22;
  const RISE = 5;
  const HALF = 3.6;
  const START = -11;
  // The ramp's surface (matching the ground the buggy feels), with rainbow stripes down it.
  const colors = [0xe8403a, 0xf09a2a, 0xffd23a, 0x6ac04a, 0x3a8ae8, 0x5a4ad8, 0xb04ad8];
  const ramp = { x: 0, z: 0, yaw: 0, len: LEN, halfW: HALF, rise: RISE };
  g.add(
    built((p) => {
      const steps = 22;
      colors.forEach((c, k) => {
        const x0 = -HALF + (k * 2 * HALF) / colors.length;
        const x1 = -HALF + ((k + 1) * 2 * HALF) / colors.length;
        const pos: number[] = [];
        for (let i = 0; i < steps; i++) {
          const u0 = (i / steps) * LEN;
          const u1 = ((i + 1) / steps) * LEN;
          const y0 = rampHeight(ramp, u0) + 0.02;
          const y1 = rampHeight(ramp, u1) + 0.02;
          const z0 = START + u0;
          const z1 = START + u1;
          pos.push(x0, y0, z0, x0, y1, z1, x1, y0, z0, x1, y0, z0, x0, y1, z1, x1, y1, z1);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        p.add(geo, P(c));
      });
      // The sides and the back of the ramp, in wood.
      const side = new THREE.Shape();
      side.moveTo(0, 0);
      for (let i = 0; i <= 20; i++) side.lineTo((i / 20) * LEN, rampHeight(ramp, (i / 20) * LEN));
      side.lineTo(LEN, 0);
      side.closePath();
      const wood = new THREE.MeshStandardMaterial({ color: 0x8b5e38, roughness: 0.8, side: THREE.DoubleSide });
      for (const s of [-1, 1]) p.add(new THREE.ShapeGeometry(side).rotateY(-Math.PI / 2), wood, s * HALF, 0, START);
      p.add(box(HALF * 2, RISE, 0.3), P(0x6a4428), 0, RISE / 2, START + LEN);
      // Zoom arrows on the run-up.
      for (let i = 0; i < 6; i++) p.add(new THREE.ConeGeometry(1.6, 2.6, 3).rotateX(Math.PI / 2), glow(0x3ae0ff, 0.9), 0, 0.1, START - 4 - i * 4, 0, 0, 0, 1, 0.05, 1);
      // The buses.
      for (let i = 0; i < 6; i++) {
        const z = START + LEN + 6 + i * 3;
        p.add(box(9, 3, 2.6), P(i % 2 ? 0xffd23a : 0xe8403a), 0, 1.7, z);
        p.add(box(9.05, 0.9, 2.65), P(0x9fd4f0), 0, 2.4, z);
        for (const s of [-1, 1]) p.add(cyl(0.55, 0.55, 2.7, 12).rotateX(Math.PI / 2), P(0x1a1a1a), s * 3.2, 0.55, z);
      }
    }),
  );
  tools.ramp(0, START, 0, LEN, HALF, RISE);
  tools.boost(0, START - 26, 0, 25, 4, 26);
  // Solid sides at the high end, so the ramp can't be driven up from the side.
  for (let u = 6; u <= LEN; u += 4) for (const s of [-1, 1]) tools.solid(s * (HALF + 0.9), START + u, 0.9, rampHeight(ramp, u));
  for (let i = 0; i < 6; i++) for (const x of [-3, 0, 3]) tools.solid(x, START + LEN + 6 + i * 3, 1.5, 3.2);
  put(g, signboard(['THE BIG JUMP', '6 BUSES. NO PROBLEM'], 4.2, 1.5, { bg: '#1a1a3a', fg: '#ffd23a', border: '#e8403a' }), -8, 0, START - 6, -0.5);
  const crowd = [0, 1, 2, 3].map((i) => put(g, guy(ARMIES[i], 'cheer'), 9 + (i % 2) * 1.5, 0, START + LEN + 4 + i * 4, -Math.PI / 2));
  const hello = greeter(40, ['GO FOR IT! ZOOM ARROWS FIRST!', 'FASTER! FASTER!'], '#3ae0ff');
  return (ctx) => {
    crowd.forEach((c, i) => (c.position.y = Math.max(0, Math.sin(ctx.t * 4 + i)) * 0.7));
    hello(ctx);
  };
}

// ---------- crate-henge ----------

/** Crate-henge: a ring of standing crates in all four armies' colours. Ancient Moon mystery, or the spare crates. */
export function crateHenge(g: THREE.Group, tools: WonderTools): WonderAnim {
  const R = 11;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const color = ARMIES[i % 4];
    const tri = new THREE.Group();
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const c = makeCrate(color);
        c.scale.setScalar(2.4);
        c.position.set(s * 1.4, 1.15 + k * 2.25, 0);
        tri.add(c);
      }
    }
    const lintel = makeCrate(color);
    lintel.scale.set(5.2, 1.6, 2.2);
    lintel.position.set(0, 5.4, 0);
    tri.add(lintel);
    tri.position.set(Math.sin(a) * R, 0, Math.cos(a) * R);
    tri.rotation.y = a + Math.PI / 2;
    g.add(tri);
    for (const s of [-1, 1]) tools.solid(Math.sin(a) * R + Math.cos(a) * s * 1.4, Math.cos(a) * R - Math.sin(a) * s * 1.4, 1.4, 6.2);
  }
  // The altar, with a toy buggy on it.
  const altar = makeCrate(ARMY_GREEN);
  altar.scale.set(4, 1.2, 2.4);
  altar.position.y = 0.55;
  g.add(altar);
  tools.solid(0, 0, 2, 1.2);
  const dancers = new THREE.Group();
  g.add(dancers);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    put(dancers, guy(ARMIES[i % 4], i % 2 ? 'cheer' : 'wave'), Math.sin(a) * 5.5, 0, Math.cos(a) * 5.5, a + Math.PI / 2);
  }
  put(g, signboard(['CRATE-HENGE', 'BUILT: AGES AGO (TUESDAY)'], 4.6, 1.4, { bg: '#d8d0b8', fg: '#3a3020' }), 0, 0, R + 5, 0);
  const hello = greeter(36, ['ANCIENT MOON MYSTERY!', '…OR THE SPARE CRATES'], '#e8e0c8');
  return (ctx) => {
    dancers.rotation.y = ctx.t * 0.4;
    dancers.children.forEach((d, i) => (d.position.y = Math.abs(Math.sin(ctx.t * 3 + i)) * 0.6));
    hello(ctx);
  };
}

// ---------- the human pyramid ----------

/** Ten army men from all four armies stood on each other's shoulders. Don't sneeze. */
export function pyramid(g: THREE.Group): WonderAnim {
  const tower = new THREE.Group();
  g.add(tower);
  const rows = [4, 3, 2, 1];
  let n = 0;
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const top = row === rows.length - 1;
      put(tower, guy(ARMIES[n++ % 4], top ? 'flag' : row === 0 ? 'stand' : 'cheer'), (i - (count - 1) / 2) * 0.95, row * 1.75, 0, Math.PI);
    }
  });
  put(g, signboard(["DON'T SNEEZE"], 2.6, 0.8, { bg: '#ffffff', fg: '#d8303a' }), 3.5, 0, 2.5, -0.4);
  const hello = greeter(26, ['WOBBLE… WOBBLE…', "DON'T BEEP YOUR HORN!"], '#ffffff');
  return (ctx) => {
    const wobble = (ctx.dist < 30 ? 0.06 : 0.025) * Math.sin(ctx.t * 2.3);
    tower.rotation.z = wobble;
    tower.children.forEach((c, i) => (c.rotation.z = Math.sin(ctx.t * 3 + i) * 0.04));
    hello(ctx);
  };
}

