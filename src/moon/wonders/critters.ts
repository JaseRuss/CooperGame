import * as THREE from 'three';
import { loftGeometry, type PartBuilder } from '../../utils/modelKit';
import { ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE } from '../../utils/plastic';
import { sharkShapes, dress } from '../../prison/Sharks';
import { buildLounger } from '../../world/Moat';
import { buildDragonParts, DRAGON_NECK } from '../../entities/KnightModels';
import { P, v3, box, ball, cyl, glow, WATER, guy, put, built, signboard, alien, fishbowl, greeter, signTexture, shade } from './kit';
import type { WonderTools, WonderAnim } from './types';

const BLACK = 0x15161a;
const PINK = 0xf2a0b4;

/** Two little black eyes with white shines, looking along -Z from (x ± spread, y, z). */
function eyes(p: PartBuilder, x: number, y: number, z: number, spread: number, r: number): void {
  for (const s of [-1, 1]) {
    p.add(ball(r, 10, 8), P(BLACK), x + s * spread, y, z);
    p.add(ball(r * 0.35, 6, 5), P(0xffffff), x + s * spread + r * 0.3, y + r * 0.35, z - r * 0.75);
  }
}

// ---------- Hey diddle diddle ----------

/** A friendly black-and-white cow (about 3 m long) in a fishbowl helmet, nose toward -Z, standing on y 0. */
function cow(): THREE.Group {
  return built((p) => {
    const white = P(0xf6f3ea);
    const black = P(0x1d1e22);
    const pink = P(PINK);
    p.add(ball(1, 18, 12), white, 0, 1.55, 0.1, 0, 0, 0, 0.85, 0.75, 1.5);
    for (const [x, y, z, r] of [[0.55, 1.8, 0.4, 0.45], [-0.6, 1.5, -0.4, 0.4], [0.2, 2.2, 0.9, 0.35], [-0.4, 1.9, 0.9, 0.3]]) p.add(ball(r, 10, 8), black, x, y, z, 0, 0, 0, 0.5, 1, 1);
    for (const [x, z] of [[-0.45, -0.85], [0.45, -0.85], [-0.45, 1.0], [0.45, 1.0]]) {
      p.add(cyl(0.17, 0.15, 1.1, 10), white, x, 0.6, z);
      p.add(cyl(0.18, 0.18, 0.18, 10), black, x, 0.09, z);
    }
    p.add(ball(0.3, 10, 8), pink, 0, 0.9, 0.6);
    // The head.
    p.add(box(0.75, 0.8, 0.9), white, 0, 2.3, -1.45);
    p.add(box(0.8, 0.45, 0.4), pink, 0, 2.05, -1.95);
    for (const s of [-1, 1]) {
      p.add(ball(0.05, 6, 4), P(0x6a3a3a), s * 0.17, 2.1, -2.16);
      p.add(new THREE.ConeGeometry(0.08, 0.35, 8), P(0xf0e6c8), s * 0.3, 2.85, -1.35, 0, 0, s * -0.4);
      p.add(box(0.4, 0.12, 0.22), black, s * 0.55, 2.55, -1.35, 0, 0, s * 0.3);
    }
    eyes(p, 0, 2.5, -1.92, 0.2, 0.08);
    p.beam(v3(0, 1.8, 1.55), v3(0.1, 0.9, 1.85), 0.07, white, true);
    p.add(ball(0.13, 8, 6), black, 0.1, 0.85, 1.87);
    fishbowl(p, 0, 2.35, -1.6, 0.95);
  });
}

/** The cat with the fiddle: an orange cat stood up on its back legs, playing. Its bow is separate, to saw. */
function catWithFiddle(): { group: THREE.Group; bow: THREE.Group } {
  const group = built((p) => {
    const fur = P(0xf09a3a);
    const light = P(0xfde0b0);
    p.add(ball(0.5, 14, 10), fur, 0, 0.9, 0, 0, 0, 0, 0.9, 1.25, 0.8);
    p.add(ball(0.35, 12, 8), light, 0, 0.85, -0.25, 0, 0, 0, 0.8, 1.1, 0.5);
    p.add(ball(0.42, 14, 10), fur, 0, 1.75, 0);
    for (const s of [-1, 1]) {
      p.add(new THREE.ConeGeometry(0.15, 0.3, 4), fur, s * 0.25, 2.15, 0, 0, 0, s * -0.3);
      p.add(cyl(0.12, 0.14, 0.4, 8), fur, s * 0.2, 0.2, -0.05);
      p.add(box(0.25, 0.02, 0.02), P(BLACK), s * 0.3, 1.65, -0.38, 0, 0, s * 0.15);
    }
    eyes(p, 0, 1.82, -0.37, 0.14, 0.06);
    p.add(ball(0.05, 6, 4), P(PINK), 0, 1.7, -0.42);
    // Tail up in a curl, and the fiddle tucked under the chin.
    p.beam(v3(0, 0.6, 0.35), v3(0.3, 1.3, 0.7), 0.1, fur, true);
    p.add(ball(0.11, 8, 6), fur, 0.3, 1.32, 0.7);
    p.add(ball(0.24, 12, 8), P(0x8a4a20), 0.25, 1.45, -0.45, 0, 0, 0.6, 1, 1.5, 0.35);
    p.add(box(0.06, 0.6, 0.06), P(0x2a1a10), 0.5, 1.75, -0.45, 0, 0, 0.6);
    p.beam(v3(0.4, 1.1, 0), v3(0.25, 1.4, -0.4), 0.09, fur, true);
  });
  const bow = built((p) => {
    p.add(box(0.03, 0.03, 0.9), P(0x6a3a1a), 0, 0, 0);
    p.beam(v3(-0.25, 0, 0), v3(0, 0, 0), 0.08, P(0xf09a3a), true);
  });
  bow.position.set(-0.05, 1.45, -0.55);
  group.add(bow);
  return { group, bow };
}

/** The dish and the spoon, with little legs and faces, hand in hand. */
function dishAndSpoon(): THREE.Group {
  return built((p) => {
    const china = P(0xf6f3ea);
    const blue = P(0x3a6ed8);
    const steel = P(0xc8ccd4);
    // The dish, stood on its edge.
    p.add(cyl(0.75, 0.75, 0.12, 24).rotateX(Math.PI / 2), china, -0.5, 1.4, 0);
    p.add(new THREE.TorusGeometry(0.62, 0.04, 6, 24), blue, -0.5, 1.4, -0.07);
    eyes(p, -0.5, 1.55, -0.1, 0.18, 0.07);
    p.add(new THREE.TorusGeometry(0.16, 0.03, 6, 12, Math.PI), P(BLACK), -0.5, 1.3, -0.1, 0, 0, Math.PI);
    // The spoon, bowl up.
    p.add(ball(0.42, 14, 10), steel, 0.65, 1.9, 0, 0, 0, 0, 1, 1.35, 0.3);
    p.add(box(0.14, 1.2, 0.08), steel, 0.65, 1.0, 0);
    eyes(p, 0.65, 2.0, -0.13, 0.13, 0.06);
    // Legs and joined hands.
    for (const x of [-0.75, -0.25, 0.55, 0.75]) p.beam(v3(x, x < 0 ? 0.75 : 0.5, 0), v3(x, 0.05, 0), 0.06, P(BLACK), true);
    p.beam(v3(-0.05, 1.45, 0), v3(0.45, 1.5, 0), 0.05, P(BLACK), true);
  });
}

/** Hey diddle diddle: the cow jumping over the Moon (a toy crescent one), the cat with the fiddle, and the dish running away with the spoon. */
export function cowOverMoon(g: THREE.Group, tools: WonderTools): WonderAnim {
  // The crescent Moon on its stand, with a sleepy face.
  const crescent = new THREE.Shape();
  crescent.absarc(0, 0, 3, Math.PI * 0.5, Math.PI * 1.5, false);
  crescent.absarc(-1.1, 0, 2.4, Math.PI * 1.5, Math.PI * 0.5, true);
  g.add(
    built((p) => {
      p.add(new THREE.ExtrudeGeometry(crescent, { depth: 0.8, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15, bevelSegments: 2 }).translate(0, 0, -0.4), glow(0xffe27a, 0.35), 0, 4.2, 0);
      p.add(cyl(0.15, 0.2, 1.4, 8), P(0x8b5e38), 0, 0.7, 0);
      p.add(cyl(1.2, 1.4, 0.3, 16), P(0x8b5e38), 0, 0.15, 0);
      // A sleepy face on the inside of the curve.
      p.add(box(0.5, 0.08, 0.1), P(BLACK), -1.9, 4.9, 0.6, 0, 0, -0.2);
      p.add(box(0.3, 0.08, 0.1), P(BLACK), -2.1, 3.7, 0.6, 0, 0, 0.3);
    }),
  );
  tools.solid(0, 0, 1.6, 7);
  const bessie = put(g, cow(), -10, 0, 0, -Math.PI / 2);
  const cat = catWithFiddle();
  put(g, cat.group, 6, 0, 8, Math.PI + 0.4, 1.4);
  const dog = put(
    g,
    built((p) => {
      const fur = P(0xc08a4a);
      p.add(ball(0.5, 12, 10), fur, 0, 0.6, 0, 0, 0, 0, 0.9, 1, 1.1);
      p.add(ball(0.38, 12, 10), fur, 0, 1.25, -0.2);
      p.add(box(0.3, 0.2, 0.35), P(0xe8c89a), 0, 1.15, -0.55);
      p.add(box(0.3, 0.1, 0.25), P(0xd84a5a), 0, 1.02, -0.55);
      for (const s of [-1, 1]) p.add(ball(0.18, 8, 6), P(0x7a4a22), s * 0.35, 1.3, -0.1, 0, 0, 0, 0.5, 1.4, 0.8);
      eyes(p, 0, 1.4, -0.52, 0.13, 0.06);
    }),
    -6,
    0,
    8,
    Math.PI - 0.4,
    1.3,
  );
  const couple = put(g, dishAndSpoon(), 12, 0, 0, 0, 1.3);
  put(g, signboard(['HEY DIDDLE', 'DIDDLE'], 3.6, 1.6, { bg: '#e8f0ff', fg: '#3a4ab0' }), 0, 0, 13, 0);
  const hello = greeter(40, ['MOOOOO!', 'MOO! (OVER THE MOON!)'], '#ffffff');
  let jump = 0;
  let dir = 1;
  return (ctx) => {
    // The cow: a run up, a big floaty jump over the Moon, a moment to get its breath back, then the other way.
    jump += ctx.dt;
    const T = 5.2;
    const rest = 1.6;
    if (jump > T + rest) {
      jump = 0;
      dir = -dir;
    }
    const u = Math.min(1, jump / T);
    bessie.position.set(dir * (-10 + 20 * u), 10 * 4 * u * (1 - u), 0);
    bessie.rotation.set(0, dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    bessie.rotateX(jump < T ? (0.5 - u) * 0.6 : 0);
    if (jump >= T && jump - ctx.dt < T && ctx.dist < 100) {
      ctx.sound('thud', 0.6, 0.9);
      ctx.dust(bessie.position.clone(), 10, 2.5);
    }
    cat.bow.position.x = -0.05 + Math.sin(ctx.t * 9) * 0.25;
    dog.position.y = Math.abs(Math.sin(ctx.t * 6)) * 0.4;
    // The dish and the spoon run off round the Moon, hand in hand.
    const a = ctx.t * 0.35;
    couple.position.set(Math.cos(a) * 12, Math.abs(Math.sin(ctx.t * 7)) * 0.3, Math.sin(a) * 12);
    couple.rotation.y = -a;
    hello(ctx);
  };
}

// ---------- the rabbit in the Moon ----------

/** The rabbit in the Moon, pounding mochi with a mallet, like the old stories say. */
export function moonRabbit(g: THREE.Group, tools: WonderTools): WonderAnim {
  const fur = P(0xf8f6f0);
  const pink = P(PINK);
  const wood = P(0x8b5e38);
  g.add(
    built((p) => {
      p.add(ball(1.1, 18, 14), fur, 0, 1.3, 0.3, 0, 0, 0, 1, 1.15, 1);
      p.add(ball(0.8, 18, 14), fur, 0, 2.75, 0);
      for (const s of [-1, 1]) {
        p.add(ball(0.32, 10, 8), fur, s * 0.32, 4.0, 0.1, 0, 0, s * -0.2, 0.55, 2.4, 0.35);
        p.add(ball(0.18, 10, 8), pink, s * 0.32, 4.0, -0.02, 0, 0, s * -0.2, 0.5, 2.2, 0.2);
        p.add(ball(0.42, 10, 8), fur, s * 0.6, 0.35, -0.5, 0, 0, 0, 0.7, 0.5, 1.4);
      }
      eyes(p, 0, 2.95, -0.68, 0.3, 0.11);
      p.add(ball(0.1, 8, 6), pink, 0, 2.7, -0.78);
      p.add(box(0.12, 0.2, 0.05), P(0xffffff), 0, 2.45, -0.74);
      p.add(ball(0.35, 10, 8), fur, 0, 0.9, 1.35);
      // The mortar, full of mochi, and a plate of finished ones.
      p.add(cyl(1.3, 1.0, 1.4, 20), wood, 0, 0.7, -2.4);
      p.add(cyl(1.15, 1.15, 0.05, 20), P(0x5a3a20), 0, 1.42, -2.4);
      p.add(cyl(1.0, 0.9, 0.12, 20), P(0xf2eee2), 2.6, 0.06, -1.2);
      for (let i = 0; i < 6; i++) p.add(ball(0.32, 12, 8), P(i % 3 === 0 ? 0xf7b8c8 : i % 3 === 1 ? 0xb8e0a0 : 0xffffff), 2.6 + Math.cos(i) * 0.5 * (i < 5 ? 1 : 0), 0.32 + (i === 5 ? 0.35 : 0), -1.2 + Math.sin(i) * 0.5 * (i < 5 ? 1 : 0), 0, 0, 0, 1, 0.75, 1);
    }),
  );
  tools.solid(0, 0, 1.4, 4);
  tools.solid(0, -2.4, 1.4, 1.5);
  const mochi = put(g, built((p) => p.add(ball(0.75, 16, 10), P(0xffffff), 0, 0, 0, 0, 0, 0, 1, 0.5, 1)), 0, 1.5, -2.4);
  // The mallet swings from the rabbit's shoulders.
  const pivot = new THREE.Group();
  pivot.position.set(0, 2.2, -0.5);
  g.add(pivot);
  pivot.add(
    built((p) => {
      p.add(cyl(0.09, 0.09, 2.2, 8).rotateX(Math.PI / 2), wood, 0, 0, -1.1);
      p.add(cyl(0.4, 0.4, 1.2, 14).rotateZ(Math.PI / 2), wood, 0, 0, -2.2);
      for (const s of [-1, 1]) p.beam(v3(s * 0.5, -0.4, 0.4), v3(s * 0.1, 0, -0.5), 0.2, fur, true);
    }),
  );
  put(g, signboard(['MOCHI', 'FRESHLY POUNDED'], 3, 1.2, { bg: '#fff0f4', fg: '#c84a7a' }), 3.5, 0, 1.5, -0.4);
  const hello = greeter(30, ['POUND! POUND! (MOCHI?)'], '#ffffff');
  let last = 0;
  return (ctx) => {
    const beat = (ctx.t * 0.9) % 1;
    // Up slowly, down fast.
    const swing = beat < 0.75 ? beat / 0.75 : 1 - (beat - 0.75) / 0.25;
    pivot.rotation.x = 0.55 - swing * 1.4;
    const squash = beat > 0.97 || beat < 0.08 ? 0.35 : 0;
    mochi.scale.set(1 + squash, 1 - squash, 1 + squash);
    if (beat < last && ctx.dist < 60) ctx.sound('thud', 0.35, 1.4);
    last = beat;
    hello(ctx);
  };
}

// ---------- penguins ----------

function penguin(helmet: boolean): THREE.Group {
  return built((p) => {
    const black = P(0x1e2026);
    const white = P(0xf6f3ea);
    const orange = P(0xf09a2a);
    p.add(ball(0.45, 14, 12), black, 0, 0.62, 0, 0, 0, 0, 1, 1.4, 0.9);
    p.add(ball(0.38, 14, 12), white, 0, 0.58, -0.12, 0, 0, 0, 0.9, 1.3, 0.8);
    p.add(ball(0.3, 12, 10), black, 0, 1.25, 0);
    p.add(new THREE.ConeGeometry(0.08, 0.3, 8).rotateX(-Math.PI / 2), orange, 0, 1.2, -0.38);
    for (const s of [-1, 1]) {
      p.add(ball(0.06, 6, 5), white, s * 0.12, 1.32, -0.24);
      p.add(ball(0.03, 6, 5), P(BLACK), s * 0.12, 1.32, -0.29);
      p.add(box(0.06, 0.5, 0.22), black, s * 0.45, 0.75, 0, 0, 0, s * 0.35);
      p.add(box(0.18, 0.05, 0.26), orange, s * 0.13, 0.03, -0.08);
    }
    if (helmet) fishbowl(p, 0, 1.25, 0, 0.42);
  });
}

/** Penguins on the Moon, taking turns down an ice slide: up the ladder, a belly slide, a waddle round and again. */
export function penguinSlide(g: THREE.Group, tools: WonderTools): WonderAnim {
  const ice = P(0xbfe4f4);
  const frame = P(0x7ab0d0);
  const TOP = 6;
  // The slide runs from the platform at z -6 down to the ground at z 8.
  g.add(
    built((p) => {
      p.add(box(3.2, 0.3, 3.2), frame, 0, TOP, -7);
      for (const [x, z] of [[-1.5, -8.5], [1.5, -8.5], [-1.5, -5.5], [1.5, -5.5]]) p.add(box(0.25, TOP, 0.25), frame, x, TOP / 2, z);
      // The ladder up the back.
      for (const x of [-0.6, 0.6]) p.add(box(0.12, TOP + 0.6, 0.12), P(0xf2eee2), x, TOP / 2, -8.75);
      for (let i = 1; i < 10; i++) p.add(box(1.2, 0.08, 0.08), P(0xf2eee2), 0, i * 0.62, -8.75);
      // The chute, with a lip at the bottom.
      const len = Math.hypot(14, TOP);
      const tilt = Math.atan2(TOP, 14);
      p.add(box(2.2, 0.2, len), ice, 0, TOP / 2, 1, tilt);
      for (const s of [-1, 1]) p.add(box(0.2, 0.6, len), frame, s * 1.1, TOP / 2 + 0.3, 1, tilt);
      p.add(box(2.2, 0.2, 2), ice, 0, 0.1, 8.8);
      // An igloo round the side.
      p.add(new THREE.SphereGeometry(3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), P(0xf2f8fc), -8, 0, -2);
      p.add(cyl(1.1, 1.1, 2, 14).rotateX(Math.PI / 2), P(0xf2f8fc), -8, 0.6, 1.1, 0, 0, 0, 1, 0.8, 1);
      p.add(cyl(0.8, 0.8, 0.1, 14).rotateX(Math.PI / 2), P(0x2a3a4a), -8, 0.6, 2.12, 0, 0, 0, 1, 0.8, 1);
    }),
  );
  tools.solid(0, -7, 2.4, TOP + 1);
  tools.solid(-8, -2, 3.2, 3);
  // The queue goes round and round: a waddle back to the ladder, a climb, a slide.
  const path = (u: number): { pos: THREE.Vector3; yaw: number; belly: boolean } => {
    if (u < 0.45) {
      // Waddling from the bottom of the slide round to the ladder.
      const k = u / 0.45;
      const a = Math.PI * k;
      return { pos: v3(3.5 + Math.sin(a) * 4, 0, 10 - k * 19.5), yaw: Math.PI, belly: false };
    }
    if (u < 0.75) {
      const k = (u - 0.45) / 0.3;
      return { pos: v3(0, k * TOP, -9.1), yaw: Math.PI, belly: false };
    }
    if (u < 0.82) {
      const k = (u - 0.75) / 0.07;
      return { pos: v3(0, TOP + 0.15, -8.5 + k * 2.5), yaw: 0, belly: false };
    }
    const k = (u - 0.82) / 0.18;
    return { pos: v3(0, TOP * (1 - k) + 0.35, -6 + k * 15.5), yaw: 0, belly: true };
  };
  const birds = Array.from({ length: 7 }, (_, i) => put(g, penguin(i % 2 === 0), 0, 0, 0));
  const watchers = [put(g, penguin(true), 5, 0, -4, Math.PI * 1.2), put(g, penguin(false), 6, 0, -2.5, Math.PI * 1.3)];
  put(g, signboard(['NO RUNNING', '(WADDLING OK)'], 3, 1.3, { bg: '#e8f6ff', fg: '#2a5a8a' }), -4.5, 0, 9, 0.2);
  const hello = greeter(36, ['NOOT NOOT!', 'WRONG POLE. GOOD SLIDE THOUGH'], '#bfe4f4');
  return (ctx) => {
    birds.forEach((b, i) => {
      const u = (ctx.t * 0.06 + i / birds.length) % 1;
      const { pos, yaw, belly } = path(u);
      b.position.copy(pos);
      b.rotation.set(belly ? Math.PI / 2 - Math.atan2(TOP, 14) : 0, 0, 0);
      b.rotation.y = yaw;
      if (!belly && pos.y === 0) {
        b.rotation.z = Math.sin(ctx.t * 10 + i) * 0.15;
        b.position.y = Math.abs(Math.sin(ctx.t * 10 + i)) * 0.08;
      }
    });
    watchers.forEach((w, i) => (w.rotation.z = Math.sin(ctx.t * 2 + i) * 0.1));
    hello(ctx);
  };
}

// ---------- snail race ----------

function snail(number: number, color: number): THREE.Group {
  const g = built((p) => {
    const body = P(0xd8c08a);
    p.add(new THREE.CapsuleGeometry(0.35, 1.8, 4, 10).rotateX(Math.PI / 2), body, 0, 0.3, 0, 0, 0, 0, 1, 0.75, 1);
    p.add(ball(0.32, 10, 8), body, 0, 0.55, -1.1);
    for (const s of [-1, 1]) {
      p.beam(v3(s * 0.12, 0.75, -1.2), v3(s * 0.25, 1.35, -1.35), 0.06, body, true);
      p.add(ball(0.09, 8, 6), P(0xf6f3ea), s * 0.25, 1.38, -1.36);
      p.add(ball(0.045, 6, 4), P(BLACK), s * 0.25, 1.38, -1.44);
    }
    p.add(ball(0.85, 16, 12), P(color), 0, 1.15, 0.25, 0, 0, 0, 0.75, 1, 1);
    for (let i = 0; i < 3; i++) p.add(new THREE.TorusGeometry(0.62 - i * 0.2, 0.06, 6, 20).rotateY(Math.PI / 2), P(shade(color, 0.6)), 0, 1.15, 0.25, 0, 0, 0, 1, 1, 1);
  });
  for (const s of [-1, 1]) {
    const num = new THREE.Mesh(new THREE.CircleGeometry(0.34, 18), new THREE.MeshStandardMaterial({ map: signTexture([String(number)], 1, 1, { bg: '#ffffff', fg: '#111', border: '#111' }) }));
    num.position.set(s * 0.65, 1.15, 0.25);
    num.rotation.y = s * Math.PI / 2;
    g.add(num);
  }
  return g;
}

/** The great snail race: six snails, six lanes, one finish line, no hurry. */
export function snailRace(g: THREE.Group, tools: WonderTools): WonderAnim {
  const lanes = 6;
  const LEN = 18;
  g.add(
    built((p) => {
      p.add(box(lanes * 2.2 + 0.4, 0.06, LEN + 2), P(0x7aa860), 0, 0.03, 0);
      for (let i = 0; i <= lanes; i++) p.add(box(0.12, 0.08, LEN + 2), P(0xffffff), -lanes * 1.1 + i * 2.2, 0.07, 0);
      for (let i = 0; i < 14; i++) for (let j = 0; j < 2; j++) p.add(box(lanes * 2.2 / 14, 0.09, 0.5), P((i + j) % 2 ? 0x111111 : 0xffffff), -lanes * 1.1 + (i + 0.5) * (lanes * 2.2) / 14, 0.08, -LEN / 2 + j * 0.5);
      p.add(box(lanes * 2.2, 0.09, 0.3), P(0xffffff), 0, 0.08, LEN / 2 - 1);
      // The finishing banner, on two poles.
      for (const s of [-1, 1]) p.add(cyl(0.12, 0.12, 5, 8), P(0xf2eee2), s * (lanes * 1.1 + 0.5), 2.5, -LEN / 2);
      // A grandstand of benches.
      for (let r = 0; r < 3; r++) p.add(box(2.2, 0.4 + r * 0.8, LEN * 0.8), P(0x8b5e38), lanes * 1.1 + 2.5 + r * 1.6, 0.2 + r * 0.4, 0);
    }),
  );
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(lanes * 2.2 + 1, 1.2), new THREE.MeshStandardMaterial({ map: signTexture(['FINISH'], lanes * 2.2 + 1, 1.2, { bg: '#ffffff', fg: '#c81e36' }), side: THREE.DoubleSide }));
  banner.position.set(0, 4.4, -LEN / 2);
  g.add(banner);
  const colors = [0xe0503f, 0x3a8ae0, 0xffd24a, 0x7ac24a, 0xc84ad8, 0xf09a2a];
  const snails = colors.map((c, i) => put(g, snail(i + 1, c), -lanes * 1.1 + 1.1 + i * 2.2, 0.05, 0));
  const pace = colors.map((_, i) => 0.035 + ((i * 7) % 5) * 0.006);
  const crowd: THREE.Object3D[] = [];
  for (let i = 0; i < 8; i++) {
    const who = i % 3 === 1 ? alien('cheer', [0x8ee05a, 0x5ad0e0][i % 2]) : guy([ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE][i % 4], i % 2 ? 'cheer' : 'wave');
    crowd.push(put(g, who, lanes * 1.1 + 2.5 + (i % 3) * 1.6, 0.4 + (i % 3) * 0.8, -6 + i * 1.7, -Math.PI / 2));
  }
  put(g, signboard(['THE GREAT SNAIL RACE', 'LAP 1 OF 1 · TIME: 6 HRS'], 6, 1.6, { bg: '#1e3a1e', fg: '#ffd24a', border: '#ffd24a' }), -lanes * 1.1 - 3, 0, 4, 0.5);
  tools.solid(lanes * 1.1 + 4, 0, 3.4, 2.5);
  const hello = greeter(36, ['AND NUMBER 3 TAKES THE LEAD! …SLOWLY', "IT'S NECK AND NECK! (THEY HAVEN'T GOT NECKS)"], '#ffd24a');
  let race = 0;
  return (ctx) => {
    race += ctx.dt;
    snails.forEach((s, i) => {
      s.position.z = LEN / 2 - 1.5 - Math.min(LEN - 2.5, race * pace[i]);
      s.scale.z = 1 + Math.sin(ctx.t * 2 + i) * 0.04;
    });
    if (race * Math.max(...pace) > LEN - 2.5) {
      race = 0;
      ctx.confetti(v3(0, 5, -LEN / 2));
    }
    crowd.forEach((c, i) => (c.position.y = 0.4 + (i % 3) * 0.8 + Math.max(0, Math.sin(ctx.t * 3 + i)) * 0.5));
    hello(ctx);
  };
}

// ---------- the traffic jam ----------

function toyCar(color: number): THREE.Group {
  return built((p) => {
    const body = P(color);
    const dark = P(0x2a2c31);
    p.add(box(2, 0.8, 4), body, 0, 0.75, 0);
    p.add(box(1.7, 0.75, 2), body, 0, 1.5, 0.2);
    p.add(box(1.72, 0.55, 1.6), P(0x9fd4f0), 0, 1.5, 0.2);
    for (const z of [-1.3, 1.3]) for (const s of [-1, 1]) p.add(cyl(0.42, 0.42, 0.3, 14).rotateZ(Math.PI / 2), dark, s * 1, 0.42, z);
    for (const s of [-1, 1]) p.add(ball(0.14, 8, 6), glow(0xfff3c0, 0.8), s * 0.65, 0.85, -2.0);
  });
}

/** The Moon's worst traffic jam: a queue of cars waiting for a tortoise in a helmet to cross. */
export function trafficJam(g: THREE.Group, tools: WonderTools): WonderAnim {
  const LEN = 46;
  g.add(
    built((p) => {
      p.add(box(7.5, 0.06, LEN), P(0x3a3c42), 0, 0.03, 0);
      for (let z = -LEN / 2 + 2; z < LEN / 2; z += 4) p.add(box(0.2, 0.08, 2), P(0xf2eee2), 0, 0.07, z);
      // The zebra crossing at the front.
      for (let i = 0; i < 6; i++) p.add(box(1, 0.08, 3), P(0xf2eee2), -3 + i * 1.2, 0.08, -LEN / 2 + 4);
    }),
  );
  const colors = [0xe0503f, 0x3a8ae0, 0xffd24a, 0x7ac24a, 0xf7a8c8, 0xf09a2a, 0xd9dee6, 0x8a5ad8, 0x2aa8a0, 0xe8c23f];
  const cars = colors.map((c, i) => put(g, toyCar(c), i % 2 ? 1.9 : -1.9, 0, -LEN / 2 + 8 + Math.floor(i / 2) * 5.6 + (i % 2) * 1.5, 0));
  for (let i = 0; i < 5; i++) tools.solid(0, -LEN / 2 + 9 + i * 5.6, 3.2, 2.2);
  const tortoise = built((p) => {
    const shell = P(0x5a8a3a);
    p.add(ball(1.1, 16, 10), shell, 0, 0.75, 0, 0, 0, 0, 1, 0.65, 1.2);
    for (let i = 0; i < 6; i++) p.add(cyl(0.3, 0.3, 0.05, 6), P(0x3a6a2a), Math.cos(i) * 0.5, 1.4, Math.sin(i) * 0.6, 0.3, 0, 0.2);
    p.add(ball(0.35, 12, 8), P(0x9ab86a), 0, 0.9, -1.45);
    for (const [x, z] of [[-0.75, -0.7], [0.75, -0.7], [-0.75, 0.7], [0.75, 0.7]]) p.add(cyl(0.2, 0.22, 0.6, 8), P(0x9ab86a), x, 0.3, z);
    eyes(p, 0, 1.0, -1.75, 0.13, 0.06);
    fishbowl(p, 0, 0.95, -1.45, 0.55);
  });
  put(g, tortoise, 0, 0, -LEN / 2 + 4, Math.PI / 2);
  const lolly = guy(ARMY_BLUE, 'wave');
  lolly.add(built((p) => {
    p.add(cyl(0.04, 0.04, 2.2, 6), P(0xf2eee2), 0.5, 2.0, -0.04);
    p.add(cyl(0.5, 0.5, 0.06, 20).rotateX(Math.PI / 2), P(0xe0303a), 0.5, 3.2, -0.04);
  }));
  put(g, lolly, -5, 0, -LEN / 2 + 3, -Math.PI / 2);
  put(g, signboard(['QUEUE STARTS HERE', 'WAIT: 3 WEEKS'], 4, 1.4, { bg: '#ffd24a', fg: '#1a1a1a' }), 5.5, 0, LEN / 2 - 2, 0);
  const hello = greeter(40, ['HONK! HONK!', 'COME ON, TORTOISE!', 'ARE WE NEARLY THERE?'], '#ffffff');
  let cross = 0;
  return (ctx) => {
    cross += ctx.dt;
    const across = (cross * 0.06) % 9;
    tortoise.position.x = -4.5 + across;
    tortoise.position.y = Math.abs(Math.sin(ctx.t * 1.5)) * 0.04;
    // Now and then a car hops with impatience and honks.
    cars.forEach((c, i) => {
      const hop = Math.max(0, Math.sin(ctx.t * 1.3 + i * 2.1) - 0.93) * 6;
      c.position.y = hop * 0.6;
      c.rotation.x = -hop * 0.2;
    });
    if (hello(ctx)) ctx.sound('uiChange', 0.5, 0.7);
  };
}

// ---------- the space whale ----------

/** A whale swimming slowly round the sky over the valley, spouting now and then. Its group is moved, not just animated. */
export function spaceWhale(g: THREE.Group): WonderAnim {
  const blue = P(0x4a72b8);
  const belly = P(0xd8e4f2);
  const body = built((p) => {
    const sections = [
      { z: -14, w: 3.5, h: 3.6, y: 0.3 },
      { z: -11, w: 6.6, h: 6.2, y: 0.4 },
      { z: -6, w: 8, h: 7.4, y: 0.4 },
      { z: 0, w: 7.6, h: 7, y: 0.3 },
      { z: 6, w: 5, h: 4.6, y: 0.4 },
      { z: 10, w: 2.6, h: 2.4, y: 0.6 },
      { z: 13, w: 1.4, h: 1.3, y: 0.8 },
    ];
    p.add(loftGeometry(sections, 28, 2.2), blue);
    p.add(loftGeometry(sections.map((s) => ({ ...s, w: s.w + 0.08, h: s.h + 0.08 })).slice(0, 5), 28, 2.2, [Math.PI * 1.15, Math.PI * 1.85]), belly);
    for (let i = 0; i < 6; i++) p.add(box(0.15, 0.08, 9), P(0xa8b8d0), -1.5 + i * 0.6, -3.1, -6, 0, 0, 0);
    for (const s of [-1, 1]) {
      p.add(ball(0.55, 12, 10), P(0xffffff), s * 3.4, 1.2, -9);
      p.add(ball(0.3, 10, 8), P(BLACK), s * 3.65, 1.25, -9.3);
      p.add(box(5, 0.4, 2.2), blue, s * 4.6, -1.8, -4, 0, s * 0.3, s * -0.5);
    }
    p.add(new THREE.TorusGeometry(2.6, 0.12, 6, 24, Math.PI * 0.6), P(0x1e2a4a), 0, -0.3, -11, 0, Math.PI / 2, Math.PI * 1.2);
    p.add(new THREE.ConeGeometry(0.5, 1.6, 4), blue, 0, 4, 4, -0.6, 0, 0);
    // A cosy little hat, because space is cold.
    p.add(cyl(1.1, 1.4, 1.4, 16), P(0xd83a4a), 0, 4.0, -8.5, -0.15);
    p.add(ball(0.5, 10, 8), P(0xffffff), 0, 4.9, -8.6);
  });
  g.add(body);
  const tail = built((p) => {
    for (const s of [-1, 1]) p.add(box(5, 0.35, 2.6), blue, s * 2.4, 0, 1.2, 0, s * -0.4, 0);
  });
  tail.position.set(0, 0.8, 13);
  g.add(tail);
  const R = 175;
  return (ctx) => {
    const a = ctx.t * (Math.PI * 2) / 160 + 1;
    const x = Math.cos(a) * R;
    const z = -1130 + Math.sin(a) * R * 0.6;
    g.position.set(x, 46 + Math.sin(ctx.t * 0.5) * 3, z);
    // Facing along the way it's going (anticlockwise seen from above), nose down a touch as it swims.
    g.rotation.set(0, Math.atan2(-Math.sin(a) * R, Math.cos(a) * R * 0.6) + Math.PI, 0);
    body.rotation.x = Math.sin(ctx.t * 0.7) * 0.05;
    tail.rotation.x = Math.sin(ctx.t * 1.4) * 0.35;
    if (Math.floor(ctx.t / 9) !== Math.floor((ctx.t - ctx.dt) / 9)) ctx.splash(v3(0, 4.6, -8.5), 1.6);
  };
}

// ---------- the dino-naut ----------

/** A T-rex in a fishbowl helmet with a tiny army flag in its tiny arms. */
export function dinoNaut(g: THREE.Group, tools: WonderTools): WonderAnim {
  const skin = P(0x6ac06a);
  const lighter = P(0xc8e88a);
  const body = built((p) => {
    p.add(loftGeometry([
      { z: -2.2, w: 1.6, h: 2, y: 5.6 },
      { z: -1, w: 3.2, h: 3.6, y: 4.9 },
      { z: 1, w: 3.4, h: 3.4, y: 4.2 },
      { z: 3, w: 2, h: 2, y: 3.9 },
      { z: 6, w: 0.9, h: 0.9, y: 3.5 },
      { z: 8.5, w: 0.25, h: 0.25, y: 3.1 },
    ], 20, 2.2), skin);
    p.add(ball(1.3, 14, 10), lighter, 0, 4.6, -1.6, 0, 0, 0, 1, 1.3, 0.6);
    for (const s of [-1, 1]) {
      p.add(ball(0.9, 12, 10), skin, s * 1.2, 3.6, 0.5, 0, 0, 0, 0.8, 1.3, 1.1);
      p.add(cyl(0.45, 0.5, 2.6, 10), skin, s * 1.2, 1.5, 0.6);
      p.add(box(1, 0.4, 1.7), skin, s * 1.2, 0.2, 0.1);
      for (const dx of [-0.3, 0, 0.3]) p.add(new THREE.ConeGeometry(0.1, 0.35, 6).rotateX(-Math.PI / 2), P(0xf4efe0), s * 1.2 + dx, 0.2, -0.8);
      // Tiny arms.
      p.beam(v3(s * 1.1, 5.2, -1.6), v3(s * 0.6, 4.7, -2.4), 0.22, skin, true);
    }
    for (let i = 0; i < 6; i++) p.add(new THREE.ConeGeometry(0.25, 0.6, 4), P(0x3a8a4a), 0, 7.1 - i * 0.3, -1.5 + i * 1.2, -0.4);
    // The tiny flag, held up.
    p.add(cyl(0.04, 0.04, 1.6, 6), P(0xf2eee2), 0, 5.1, -2.5);
    p.add(box(0.7, 0.45, 0.04), P(ARMY_GREEN), 0.35, 5.7, -2.5);
  });
  g.add(body);
  const head = built((p) => {
    p.add(box(1.8, 1.4, 2.6), skin, 0, 0, -0.9);
    p.add(box(1.6, 0.5, 2.3), lighter, 0, -0.85, -0.95);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) p.add(new THREE.ConeGeometry(0.08, 0.25, 5).rotateX(Math.PI), P(0xffffff), s * 0.75, -0.75, -2 + i * 0.4);
      p.add(ball(0.22, 10, 8), P(0xffffff), s * 0.7, 0.45, -0.6);
      p.add(ball(0.11, 8, 6), P(BLACK), s * 0.78, 0.47, -0.78);
    }
    fishbowl(p, 0, 0, -0.9, 2.1);
  });
  head.position.set(0, 7.1, -2.2);
  g.add(head);
  tools.solid(0, 0, 2.6, 9);
  tools.solid(0, 4, 1.2, 4);
  // Footprints, and an army man saluting.
  g.add(built((p) => {
    for (let i = 0; i < 6; i++) p.add(cyl(0.7, 0.8, 0.04, 10), P(0x9a8f88), (i % 2 ? 1 : -1) * 1.2, 0.04, 4 + i * 2.6, 0, 0, 0, 1, 1, 1.4);
  }, false));
  put(g, guy(ARMY_GREEN, 'salute'), 3, 0, -6, Math.PI + 0.6);
  put(g, signboard(['DINOSAURS DID NOT', 'DIE OUT. THEY MOVED.'], 4.4, 1.4, { bg: '#e8f8e0', fg: '#2a5a2a' }), -5, 0, -4, 0.6);
  const hello = greeter(40, ['RAWR! (THAT MEANS HELLO)', 'RAAAWR! (NICE BUGGY)'], '#9be27a');
  return (ctx) => {
    head.rotation.y = Math.sin(ctx.t * 0.6) * 0.35;
    head.rotation.x = Math.sin(ctx.t * 1.1) * 0.08 + (ctx.dist < 40 ? -0.2 : 0);
    body.rotation.y = Math.sin(ctx.t * 0.8) * 0.04;
    if (hello(ctx)) ctx.sound('boom', 0.25, 1.6);
  };
}

// ---------- the Moon yeti ----------

/** A big shy yeti hiding behind a lamp post far too thin to hide behind. */
export function moonYeti(g: THREE.Group, tools: WonderTools): WonderAnim {
  g.add(built((p) => {
    p.add(cyl(0.08, 0.1, 7, 8), P(0x3a3e46), 0, 3.5, 0);
    p.add(box(0.8, 0.3, 0.4), P(0x3a3e46), 0.3, 7, 0);
    p.add(ball(0.25, 10, 8), glow(0xfff3c0, 1.4), 0.6, 6.8, 0);
  }));
  tools.solid(0, 0, 0.5, 7);
  const yeti = built((p) => {
    const fur = P(0xf2f6fa);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 * 3;
      const y = 0.6 + (i / 40) * 3;
      p.add(ball(0.55, 8, 6), fur, Math.cos(a) * 0.75, y, Math.sin(a) * 0.55 + 0.6);
    }
    p.add(ball(1.0, 14, 10), fur, 0, 3.8, 0.5);
    p.add(ball(0.5, 12, 8), P(0x8ab0c8), 0.25, 3.7, -0.4, 0, 0, 0, 1, 0.8, 0.4);
    p.add(ball(0.14, 8, 6), P(0xffffff), 0.35, 3.85, -0.55);
    p.add(ball(0.07, 6, 5), P(BLACK), 0.36, 3.85, -0.65);
    for (const s of [-1, 1]) {
      p.add(ball(0.32, 8, 6), fur, s * 0.25, 3.0, -0.2);
      p.add(ball(0.45, 8, 6), P(0x8ab0c8), s * 0.5, 0.2, 0.4, 0, 0, 0, 1, 0.5, 1.5);
    }
  });
  put(g, yeti, 0.3, 0, 0.3);
  const hello = greeter(26, ["…YOU CAN'T SEE ME", 'NOBODY HERE. JUST A LAMP POST'], '#e8f0ff');
  return (ctx) => {
    // It shuffles to keep the post between itself and the buggy (it doesn't work).
    const side = Math.atan2(-ctx.buggy.x, -ctx.buggy.z);
    yeti.rotation.y = side;
    yeti.position.set(Math.sin(side) * -0.9, Math.abs(Math.sin(ctx.t * 4)) * 0.05, Math.cos(side) * -0.9);
    hello(ctx);
  };
}

// ---------- water ----------

/** A round pond of water in a ring of rocks, radius r, added to `p`. */
function pond(p: PartBuilder, r: number, rng: () => number): void {
  p.add(cyl(r, r, 0.2, 40), WATER, 0, 0.18, 0);
  for (let i = 0; i < Math.round(r * 3); i++) {
    const a = (i / Math.round(r * 3)) * Math.PI * 2;
    const s = 0.5 + rng() * 0.6;
    p.add(new THREE.DodecahedronGeometry(s, 0), P(0x8a8a90), Math.cos(a) * (r + 0.2), s * 0.4, Math.sin(a) * (r + 0.2), rng(), rng(), rng());
  }
}

/** A shark in its bib, still hungry, circling a crater pond. */
export function sharkPond(g: THREE.Group, tools: WonderTools): WonderAnim {
  g.add(built((p) => pond(p, 8, tools.rng)));
  const shark = new THREE.Group();
  const geo = sharkShapes();
  dress(geo.body, shark);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.42, -0.85);
  dress(geo.jaw, jaw);
  const tail = new THREE.Group();
  tail.position.set(0, 0, 2.2);
  dress(geo.tail, tail);
  shark.add(jaw, tail);
  shark.scale.setScalar(1.1);
  g.add(shark);
  put(g, signboard(['NO SWIMMING', '(HE HAS A BIB ON)'], 3.4, 1.3, { bg: '#ffffff', fg: '#c81e36' }), -6, 0, 9.5, 0.4);
  put(g, signboard(['MENU', 'FISH FINGERS · JAM'], 3, 1.4, { bg: '#2a2c31', fg: '#ffffff', border: '#8b5e38' }), 7, 0, 9, -0.4);
  // A knife and fork as tall as a door, stuck in the ground.
  g.add(built((p) => {
    p.add(box(0.25, 3, 0.08), P(0xd9dee6), 9.5, 1.5, 3, 0, 0, 0.1);
    for (const x of [-0.25, 0, 0.25]) p.add(box(0.08, 1, 0.08), P(0xd9dee6), 9.5 + x, 3.4, 3, 0, 0, 0.1);
    p.add(box(0.4, 3.6, 0.08), P(0xd9dee6), 10.5, 1.8, 3, 0, 0, -0.08);
  }));
  tools.solid(0, 0, 8.4, 0.6);
  const hello = greeter(30, ['CHOMP CHOMP… JUST LOOKING!', "IS THAT A BUGGY? I'M SO HUNGRY"], '#9fd4f0');
  let a = 0;
  return (ctx) => {
    a += ctx.dt * 0.5;
    const close = ctx.dist < 30;
    const peek = close ? Math.min(1, Math.max(0, Math.sin(ctx.t * 0.8) + 0.4)) : Math.max(0, Math.sin(ctx.t * 0.3) - 0.85) * 6;
    const r = 4.5;
    shark.position.set(Math.cos(a) * r, -0.3 + peek * 0.9, Math.sin(a) * r);
    shark.rotation.set(-peek * 0.5, -a, 0);
    jaw.rotation.x = -Math.max(0, Math.sin(ctx.t * 8)) * 0.5 * peek;
    tail.rotation.y = Math.sin(ctx.t * 5) * 0.4;
    hello(ctx);
  };
}

/** The duck pond: the moat's loungers on holiday at last, in their rubber rings, with a giant rubber duck. */
export function duckPond(g: THREE.Group, tools: WonderTools): WonderAnim {
  g.add(built((p) => {
    pond(p, 13, tools.rng);
    // Deck chairs and a beach umbrella on the bank.
    for (const [x, z, c] of [[-15, 4, 0xe0503f], [-15.5, 7, 0x3a8ae0]]) {
      p.add(box(1.2, 0.08, 1.8), P(c), x, 0.5, z, 0.5);
      p.add(box(1.2, 1.4, 0.08), P(c), x, 1.1, z + 0.9, -0.4);
    }
    p.add(cyl(0.06, 0.06, 3, 6), P(0xf2eee2), -16.5, 1.5, 5.5);
    p.add(new THREE.ConeGeometry(2.2, 0.8, 12), P(0xffd24a), -16.5, 3.1, 5.5);
  }));
  const duck = built((p) => {
    const yellow = P(0xffd23a);
    p.add(ball(2.6, 18, 12), yellow, 0, 1.6, 0.5, 0, 0, 0, 1, 0.75, 1.3);
    p.add(ball(1.6, 16, 12), yellow, 0, 4.2, -1.6);
    p.add(box(1.4, 0.45, 1.4), P(0xf07a1a), 0, 3.9, -3.2);
    p.add(ball(0.9, 10, 8), yellow, 0, 2.9, 3.6, 0.6, 0, 0, 0.6, 0.6, 1.2);
    for (const s of [-1, 1]) {
      p.add(ball(0.32, 10, 8), P(0xffffff), s * 0.7, 4.6, -2.8);
      p.add(ball(0.16, 8, 6), P(BLACK), s * 0.74, 4.65, -3.05);
    }
  });
  put(g, duck, 2, 0, -3);
  const rings = [
    buildLounger(ARMY_TAN, 0xe0503f, false, true),
    buildLounger(ARMY_BLUE, 0xffd24a, true, false),
    buildLounger(ARMY_GREEN, 0x3ab0e0, false, true),
  ].map((r) => {
    g.add(r.root);
    return r.root;
  });
  put(g, signboard(["THE MOAT GUYS'", 'HOLIDAY'], 3.6, 1.4, { bg: '#e8f8ff', fg: '#1a5a8a' }), 0, 0, 15, 0);
  tools.solid(0, 0, 13.3, 0.6);
  const hello = greeter(36, ['AHHH, THIS IS THE LIFE', 'NOBODY SHOOTING AT US!'], '#9fd4f0');
  return (ctx) => {
    duck.position.y = Math.sin(ctx.t * 1.2) * 0.15;
    duck.rotation.z = Math.sin(ctx.t * 0.9) * 0.06;
    duck.rotation.y = Math.sin(ctx.t * 0.2) * 0.6;
    rings.forEach((r, i) => {
      const a = ctx.t * 0.08 + (i / rings.length) * Math.PI * 2;
      r.position.set(Math.cos(a) * 8.5, 0.3 + Math.sin(ctx.t * 1.5 + i) * 0.08, Math.sin(a) * 8.5);
      r.rotation.y = -a + Math.sin(ctx.t * 0.3 + i);
    });
    hello(ctx);
  };
}

// ---------- the dragon's hoard ----------

/** A castle dragon asleep on a heap of gold in a fishbowl helmet: it followed everyone up. */
export function dragonHoard(g: THREE.Group, tools: WonderTools): WonderAnim {
  const gold = P(0xf2c43a);
  g.add(built((p) => {
    p.add(new THREE.ConeGeometry(9, 3, 24), gold, 0, 1.5, 0);
    const rng = tools.rng;
    for (let i = 0; i < 90; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * 9.5;
      const y = Math.max(0.1, 3 * (1 - d / 9) + 0.1);
      p.add(cyl(0.35, 0.35, 0.08, 10), gold, Math.cos(a) * d, y, Math.sin(a) * d, rng() * 0.8, 0, rng() * 0.8);
    }
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2;
      p.add(ball(0.4, 10, 8), P([0xe0303a, 0x3a8ae0, 0x3ac06a][i % 3]), Math.cos(a) * 5, 1.4, Math.sin(a) * 5);
    }
    // A treasure chest, open.
    p.add(box(2.4, 1.4, 1.6), P(0x8b5e38), 7, 0.7, 4);
    p.add(box(2.5, 0.2, 1.7), gold, 7, 1.0, 4);
    p.add(box(2.4, 1.4, 0.2), P(0x8b5e38), 7, 2.0, 3.1, -0.5);
  }));
  const dragon = buildDragonParts(0xc84a3a);
  const rig = new THREE.Group();
  rig.add(dragon.body);
  const neck = new THREE.Group();
  neck.position.copy(DRAGON_NECK);
  neck.add(dragon.head);
  rig.add(neck);
  dragon.head.rotation.x = 0.55;
  dragon.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * 0.9));
  rig.position.set(0, 3.6, 0);
  rig.rotation.y = 0.4;
  g.add(rig);
  // Its helmet, on its head.
  const bowl = built((p) => fishbowl(p, 0, 0, -1.2, 2.2), false);
  dragon.head.add(bowl);
  tools.solid(0, 0, 8, 4.5);
  put(g, signboard(['DO NOT', 'WAKE THE DRAGON'], 3.6, 1.4, { bg: '#2a1a1a', fg: '#ffd24a', border: '#c84a3a' }), 0, 0, 12, 0);
  put(g, guy(ARMY_RED, 'kneel'), 5, 0, 9, Math.PI + 0.5);
  let awake = 0;
  let near = false;
  return (ctx) => {
    const breathe = Math.sin(ctx.t * 0.9);
    dragon.body.scale.set(1 + breathe * 0.02, 1 + breathe * 0.03, 1);
    if (ctx.dist < 28 && !near) {
      near = true;
      awake = 3.5;
      ctx.say('MINE! ALL MINE! …zzz', '#ff8a6a');
      ctx.sound('boom', 0.3, 1.8);
      ctx.boom(g.worldToLocal(dragon.head.localToWorld(v3(0, -0.3, -2.6))), 0.5);
    } else if (ctx.dist > 40) near = false;
    awake = Math.max(0, awake - ctx.dt);
    neck.rotation.x = awake > 0 ? -0.6 * Math.min(1, awake) : 0;
    dragon.tail.rotation.y = Math.sin(ctx.t * 0.7) * 0.25;
    // Snoring: a puff from the nostrils on every breath out.
    if (awake === 0 && Math.floor(ctx.t / 2.4) !== Math.floor((ctx.t - ctx.dt) / 2.4)) {
      const nose = dragon.head.localToWorld(v3(0, 0, -2.2));
      ctx.dust(g.worldToLocal(nose), 4, 0.8);
    }
  };
}

