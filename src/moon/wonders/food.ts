import * as THREE from 'three';
import { CARRY_CRATE_AT } from '../../entities/Soldier';
import { ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE } from '../../utils/plastic';
import { P, v3, box, ball, cyl, glow, GLASS, guy, put, built, signboard, alien, fishbowl, ufo, twinkle, checkTexture, greeter } from './kit';
import type { WonderTools, WonderAnim } from './types';

const CHEESE = 0xf2c84b;
const HOLE = 0xc99a2a;

/** A mouse about a metre long in a fishbowl helmet, nose toward -Z. */
function mouse(): THREE.Group {
  return built((p) => {
    const fur = P(0x9a98a0);
    const pink = P(0xf2a0b4);
    p.add(ball(0.42, 14, 10), fur, 0, 0.42, 0.1, 0, 0, 0, 0.8, 0.75, 1.15);
    p.add(ball(0.27, 14, 10), fur, 0, 0.62, -0.42);
    p.add(ball(0.06, 8, 6), pink, 0, 0.6, -0.69);
    for (const s of [-1, 1]) {
      p.add(cyl(0.2, 0.2, 0.04, 14), fur, s * 0.2, 0.86, -0.4, Math.PI / 2, 0, s * 0.3);
      p.add(cyl(0.13, 0.13, 0.05, 12), pink, s * 0.2, 0.86, -0.39, Math.PI / 2, 0, s * 0.3);
      p.add(ball(0.04, 6, 5), P(0x15161a), s * 0.1, 0.7, -0.64);
    }
    // A long tail curling up behind.
    let prev = v3(0, 0.3, 0.55);
    for (let i = 1; i <= 6; i++) {
      const next = v3(Math.sin(i * 0.7) * 0.25, 0.3 + i * 0.12, 0.55 + i * 0.16);
      p.beam(prev, next, 0.05, pink, true);
      prev = next;
    }
    fishbowl(p, 0, 0.66, -0.42, 0.42);
  });
}

/** The Moon really is made of cheese: a wedge the size of a house, with mice in space helmets nibbling it. */
export function cheese(g: THREE.Group, tools: WonderTools): WonderAnim {
  const shape = new THREE.Shape();
  shape.moveTo(-6, 4.5);
  shape.lineTo(6, 4.5);
  shape.lineTo(0, -9);
  shape.closePath();
  // A bite out of the thin end.
  const wedge = new THREE.ExtrudeGeometry(shape, { depth: 5.5, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 2 });
  wedge.rotateX(-Math.PI / 2);
  const rng = tools.rng;
  g.add(
    built((p) => {
      p.add(wedge, P(CHEESE), 0, 0.25, 0);
      // Holes: dark rounds on the top and down the sides. The wedge's back is at z -4.5, its tip at z 9.
      const hole = P(HOLE);
      for (let i = 0; i < 10; i++) {
        const t = rng() * 0.85;
        const r = 0.35 + rng() * 0.55;
        p.add(cyl(r, r, 0.05, 18), hole, (rng() - 0.5) * 2 * 6 * (1 - t) * 0.75, 6.02, -4.5 + 13.5 * t);
      }
      for (const s of [-1, 1]) {
        const nx = s * 0.914;
        const nz = 0.406;
        for (let i = 0; i < 6; i++) {
          const t = 0.08 + rng() * 0.75;
          const r = 0.35 + rng() * 0.6;
          p.add(cyl(r, r, 0.05, 18).rotateX(Math.PI / 2), hole, s * 6 * (1 - t) + nx * 0.27, 0.9 + rng() * 4.4, -4.5 + 13.5 * t + nz * 0.27, 0, Math.atan2(nx, nz));
        }
      }
      for (let i = 0; i < 5; i++) p.add(cyl(0.5 + rng() * 0.4, 0.5, 0.05, 18).rotateX(Math.PI / 2), hole, -4 + i * 2 + rng() * 0.6, 1 + rng() * 4, -4.78);
      // Crumbs.
      for (let i = 0; i < 14; i++) p.add(box(0.5, 0.4, 0.5), P(CHEESE), (rng() - 0.5) * 16, 0.2, (rng() - 0.5) * 16, rng(), rng() * 3, rng());
      // A cracker leaning on the back, as big as a door.
      p.add(box(3, 3, 0.25), P(0xd9a55a), -3, 1.6, -5.3, -0.15, 0.2, 0.1);
      for (let i = 0; i < 9; i++) p.add(cyl(0.08, 0.08, 0.3, 6).rotateX(Math.PI / 2), P(0xa8742e), -3 + ((i % 3) - 1) * 0.8, 1.6 + (Math.floor(i / 3) - 1) * 0.8, -5.45, -0.15, 0.2, 0.1);
    }),
  );
  for (const [x, z, r] of [[0, -2, 4.5], [0, 3, 3], [0, 7, 1.5]]) tools.solid(x, z, r, 6);
  const mice = [put(g, mouse(), -1.2, 6.05, 1.5, 0.4), put(g, mouse(), 1.8, 6.05, -1, -0.6), put(g, mouse(), 0.2, 6.05, -3.2, 3), put(g, mouse(), 5, 0, 7, -2.2)];
  const fan = put(g, guy(ARMY_GREEN, 'point'), 7, 0, 7.5, Math.PI * 0.75);
  fan.scale.setScalar(1.1);
  put(g, signboard(['THE MOON:', '100% CHEESE'], 4, 1.6, { bg: '#ffe9a0' }), -8, 0, 7, 0.4);
  const hello = greeter(36, ['SQUEAK! (THIS IS OUR CHEESE)', 'SQUEAK SQUEAK!']);
  return (ctx) => {
    mice.forEach((m, i) => {
      const nibble = Math.max(0, Math.sin(ctx.t * 9 + i * 2));
      m.rotation.x = -0.25 * nibble;
      m.position.y = (i < 3 ? 6.05 : 0) + 0.08 * nibble;
    });
    hello(ctx);
  };
}

/** A toaster as big as a house that pops its toast up so high it takes ages to come down. */
export function toaster(g: THREE.Group, tools: WonderTools): WonderAnim {
  const chrome = P(0xd9dee6);
  const dark = P(0x2f3238);
  g.add(
    built((p) => {
      p.add(box(9, 5.2, 4.6), chrome, 0, 3.0, 0);
      for (const x of [-4.5, 4.5]) p.add(cyl(2.3, 2.3, 5.2, 20).rotateX(Math.PI / 2), chrome, x, 3.0, 0, 0, 0, 0, 0.18, 1, 1);
      p.add(box(9.4, 0.4, 5), P(0x2b2d33), 0, 0.3, 0);
      for (const x of [-2.1, 2.1]) p.add(box(3.6, 0.1, 1.0), dark, x, 5.63, 0);
      // The lever and the dial on the end.
      p.add(box(0.5, 2.6, 0.3), dark, 5.05, 3.2, 1.2);
      p.add(box(1, 0.4, 0.9), P(0xe0503f), 5.4, 3.6, 1.2);
      p.add(cyl(0.6, 0.6, 0.3, 18).rotateZ(Math.PI / 2), dark, 5.05, 2.2, -1.2);
      p.add(box(0.1, 0.5, 0.12), P(0xf2eee2), 5.22, 2.35, -1.2);
      // The flex and its plug, which isn't plugged in to anything.
      p.beam(v3(-4.8, 1, 0), v3(-8, 0.2, 2), 0.25, dark, true);
      p.beam(v3(-8, 0.2, 2), v3(-10.5, 0.2, 5), 0.25, dark, true);
      p.add(box(0.9, 0.6, 1.2), P(0xf2eee2), -10.8, 0.35, 5.6, 0, 0.7, 0);
    }),
  );
  tools.solid(-2.5, 0, 3.4, 6);
  tools.solid(2.5, 0, 3.4, 6);
  const toast = [-2.1, 2.1].map((x) =>
    put(
      g,
      built((p) => {
        p.add(box(3.3, 3.6, 0.6), P(0xd9a55a), 0, 0, 0);
        p.add(box(3.5, 0.5, 0.7), P(0x8a5426), 0, 1.75, 0);
        for (const s of [-1, 1]) p.add(box(0.3, 3.6, 0.7), P(0x8a5426), s * 1.65, 0, 0);
        p.add(box(1.4, 0.15, 1.2), P(0xfff0a0), 0.3, 0.2, 0.32, Math.PI / 2, 0, 0.2); // a pat of butter
      }),
      x,
      4.4,
      0,
    ),
  );
  // Hungry army men holding out plates.
  [ARMY_RED, ARMY_TAN, ARMY_BLUE].forEach((c, i) => {
    const man = put(g, guy(c, 'carry'), -4 + i * 4, 0, 7.5 + (i % 2), Math.PI + (i - 1) * 0.3);
    const plate = new THREE.Mesh(cyl(0.45, 0.35, 0.06, 18), P(0xf2eee2));
    plate.position.copy(CARRY_CRATE_AT).setY(CARRY_CRATE_AT.y - 0.2);
    man.add(plate);
  });
  put(g, signboard(['TOAST TAKES', 'A WHILE', 'UP HERE'], 3, 1.8, { bg: '#fff6d8' }), 8.5, 0, 6, -0.5);
  let phase = 2;
  let up = false;
  const hello = greeter(34, 'POP!… (wait for it…)');
  return (ctx) => {
    phase += ctx.dt;
    const POP = 7.5;
    const flight = 7;
    if (phase > POP + flight) {
      phase = 0;
      up = false;
    }
    if (!up && phase > POP) {
      up = true;
      if (ctx.dist < 120) ctx.sound('thud', 0.7, 1.7);
      ctx.dust(v3(0, 5.8, 0), 6, 2);
    }
    const f = up ? phase - POP : 0;
    const y = up ? 4.4 + 9 * f - 0.5 * 2.5 * f * f : 4.4;
    toast.forEach((t, i) => {
      t.position.y = Math.max(4.4, y + i * 0.3);
      t.rotation.x = up && y > 4.5 ? f * (i ? 0.9 : -0.7) : 0;
    });
    hello(ctx);
  };
}

/** The great jam sandwich: every shot of the jam cannon had to come from somewhere. */
export function jamSandwich(g: THREE.Group, tools: WonderTools): WonderAnim {
  const bread = new THREE.Shape();
  bread.moveTo(-5, -5);
  bread.lineTo(5, -5);
  bread.lineTo(5, 3);
  bread.bezierCurveTo(5, 6.2, 2.5, 6.5, 0, 6);
  bread.bezierCurveTo(-2.5, 6.5, -5, 6.2, -5, 3);
  bread.lineTo(-5, -5);
  // A big bite out of one side.
  const bite = new THREE.Path();
  bite.absarc(5, -1, 1.8, 0, Math.PI * 2, false);
  bread.holes.push(bite);
  const slice = (thick: number) => new THREE.ExtrudeGeometry(bread, { depth: thick, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 2 }).rotateX(-Math.PI / 2);
  const crumb = P(0xf3dfb0);
  const crust = P(0xb47a3a);
  const jam = P(0xd8243f);
  g.add(
    built((p) => {
      p.add(slice(1.1), crumb, 0, 0.3, 0);
      p.add(slice(0.5).scale(1.04, 1, 1.04), jam, 0, 1.7, 0);
      p.add(slice(1.1), crumb, 0, 2.5, 0);
      p.add(slice(0.2).scale(1.01, 1, 1.01), crust, 0, 3.9, 0);
      // Jam oozing out of the sides and dribbling down.
      const rng = tools.rng;
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2;
        const x = Math.cos(a) * 5.3;
        const z = -Math.sin(a) * 5.3 * 1.1;
        const len = 0.6 + rng() * 1.6;
        p.add(cyl(0.22, 0.28, len, 8), jam, x, 1.9 - len / 2, z);
        p.add(ball(0.32, 8, 6), jam, x, 1.9 - len, z);
      }
      p.add(cyl(2.4, 2.6, 0.12, 24), jam, 6.5, 0.06, 4); // a puddle
      // The jar, nearly empty, and the knife.
      p.add(cyl(1.8, 1.8, 4.4, 24), GLASS, -8, 2.3, -2);
      p.add(cyl(1.7, 1.7, 0.8, 24), jam, -8, 0.5, -2);
      p.add(cyl(1.9, 1.9, 0.7, 24), P(0xe0503f), -8, 4.8, -2);
      p.add(cyl(1.95, 1.95, 0.1, 24), P(0xf2eee2), -8, 5.2, -2, 0, 0, 0.05);
      p.add(box(0.5, 0.12, 6), P(0xd9dee6), 3, 4.4, -6.5, 0.15, 0.6, 0);
      p.add(box(0.7, 0.5, 2.6), P(0x7a4a24), 1.8, 4.75, -9.0, 0.15, 0.6, 0);
    }),
  );
  const label = signboard(['JAM'], 2.4, 1.2, { bg: '#f4efe0', fg: '#c81e36' }, 0);
  label.children.slice(2).forEach((c) => (c.visible = false));
  put(g, label, -8, 1.6, -0.15);
  tools.solid(0, 0, 5.6, 4.2);
  tools.solid(-8, -2, 2, 5);
  // Army men on top, spreading and cheering; one stuck fast in the jam.
  const top = [put(g, guy(ARMY_GREEN, 'cheer'), -1.5, 4.1, 1, 0.5), put(g, guy(ARMY_RED, 'wave'), 2, 4.1, -1.5, -2.5)];
  const stuck = put(g, guy(ARMY_TAN, 'stand'), 6.5, 0.1, 4, -0.6);
  stuck.rotation.z = 0.25;
  put(g, signboard(['WHERE ALL', 'THE JAM', 'WENT'], 3, 1.8, { bg: '#ffd8de', fg: '#8a1024' }), -4, 0, 8.5, 0.3);
  const hello = greeter(36, ["I'M STUCK! …AND IT'S DELICIOUS", 'MMMM, STRAWBERRY'], '#ff6a8a');
  return (ctx) => {
    top.forEach((m, i) => (m.position.y = 4.1 + Math.abs(Math.sin(ctx.t * 2.2 + i * 1.7)) * 1.6));
    stuck.rotation.z = 0.25 + Math.sin(ctx.t * 5) * 0.08;
    hello(ctx);
  };
}

/** Mr Moonwhippy's ice cream van, with a queue of aliens and army men. */
export function iceCreamVan(g: THREE.Group, tools: WonderTools): WonderAnim {
  const pink = P(0xf7a8c8);
  const cream = P(0xfdf3e3);
  const dark = P(0x2a2c31);
  g.add(
    built((p) => {
      p.add(box(4.2, 3.6, 8.5), cream, 0, 2.4, 0);
      p.add(box(4.25, 1.1, 8.55), pink, 0, 1.2, 0);
      p.add(box(4.25, 0.4, 8.55), pink, 0, 3.9, 0);
      p.add(box(4.2, 2.2, 2.2), cream, 0, 1.7, -5.2);
      p.add(box(3.6, 1.0, 0.1), P(0x9fd4f0), 0, 2.4, -6.32, -0.3);
      for (const z of [-4.6, 2.8]) for (const s of [-1, 1]) p.add(cyl(0.75, 0.75, 0.5, 18).rotateZ(Math.PI / 2), dark, s * 2.05, 0.75, z);
      for (const s of [-1, 1]) p.add(ball(0.25, 10, 8), glow(0xfff3c0, 1), s * 1.5, 1.6, -6.3);
      // The serving hatch on the side, and the cone on the roof.
      p.add(box(0.1, 1.6, 3.6), dark, 2.12, 2.6, 0.6);
      p.add(box(0.6, 0.12, 3.6), pink, 2.4, 1.85, 0.6);
    }),
  );
  const cone = built((p) => {
    p.add(new THREE.ConeGeometry(1.1, 3.2, 16).rotateX(Math.PI), P(0xd9a55a), 0, 1.6, 0);
    for (let i = 0; i < 6; i++) p.add(ball(1.15 - i * 0.16, 14, 10), P(0xfdf8ee), 0, 3.3 + i * 0.42, 0, 0, i * 0.6, 0, 1, 0.55, 1);
    p.add(cyl(0.16, 0.16, 2, 8), P(0x6a3e1e), 0.4, 5.4, 0.2, 0, 0, -0.35);
  });
  put(g, cone, 0, 4.1, 1.5);
  const side = signboard(['MR MOONWHIPPY', '99 FLAVOURS (ALL MOON DUST)'], 6.4, 1.3, { bg: '#ffffff', fg: '#d8306a', border: '#f7a8c8' }, 0);
  side.children.slice(2).forEach((c) => (c.visible = false));
  put(g, side, 2.2, 2.45, -2.2, Math.PI / 2);
  tools.solid(0, -1, 3.5, 5);
  tools.solid(0, 3, 3, 5);
  // The queue, out from the hatch.
  const queue: THREE.Object3D[] = [];
  for (let i = 0; i < 6; i++) {
    const who = i % 2 === 0 ? alien(i === 0 ? 'cheer' : 'stand', [0x8ee05a, 0x5ad0e0, 0xd08ef0][i % 3]) : guy([ARMY_GREEN, ARMY_RED, ARMY_BLUE][i % 3], 'stand');
    queue.push(put(g, who, 4.2 + i * 1.6, 0, 0.6 + Math.sin(i) * 0.4, -Math.PI / 2));
  }
  const hello = greeter(36, ['♪ DING-A-LING-A-LING ♪', 'ONE MOON DUST RIPPLE, PLEASE!'], '#ff9ad0');
  return (ctx) => {
    cone.rotation.y += ctx.dt * 0.8;
    queue.forEach((q, i) => (q.position.y = Math.max(0, Math.sin(ctx.t * 3 + i * 1.3)) * 0.35));
    if (hello(ctx)) {
      ctx.sound('uiConfirm', 0.6, 1.3);
    }
  };
}

/** A picnic with the neighbours: three aliens, one army man, sandwiches and a jelly that might be alive. */
export function alienPicnic(g: THREE.Group, tools: WonderTools): WonderAnim {
  const blanket = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checkTexture('#d83a3a', '#f4efe0'), roughness: 0.9 }));
  blanket.position.y = 0.08;
  blanket.receiveShadow = true;
  g.add(blanket);
  g.add(
    built((p) => {
      // The basket.
      p.add(box(2, 1.2, 1.4), P(0xb07a3e), -2.6, 0.7, -2.6);
      p.add(new THREE.TorusGeometry(0.8, 0.08, 6, 16, Math.PI), P(0x8a5a2a), -2.6, 1.3, -2.6);
      // Plates with sandwiches, cups, and a teapot.
      for (const [x, z] of [[-1.5, 1.2], [1.6, 1.4], [1.4, -1.6], [-1.2, -0.5]]) {
        p.add(cyl(0.5, 0.42, 0.06, 18), P(0xf2eee2), x, 0.14, z);
        p.add(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 3), P(0xf3dfb0), x, 0.3, z, 0, x);
        p.add(new THREE.CylinderGeometry(0.43, 0.43, 0.06, 3), P(0x7ac24a), x, 0.3, z, 0, x);
      }
      p.add(ball(0.55, 16, 12), P(0x5ab4e8), 0.6, 0.6, 0.2);
      p.beam(v3(1.05, 0.6, 0.2), v3(1.5, 0.95, 0.2), 0.12, P(0x5ab4e8), true);
      p.add(new THREE.TorusGeometry(0.28, 0.06, 6, 12), P(0x5ab4e8), 0.05, 0.65, 0.2);
      for (const [x, z] of [[-0.4, 1.8], [2.1, 0.2]]) p.add(cyl(0.14, 0.11, 0.24, 10), P(0xf2eee2), x, 0.2, z);
    }),
  );
  // The jelly: a green wobbler with a cherry on top.
  const jelly = built((p) => {
    const pts = [v3(0, 0, 0), v3(0.75, 0, 0), v3(0.7, 0.35, 0), v3(0.62, 0.38, 0), v3(0.58, 0.75, 0), v3(0.48, 0.78, 0), v3(0.42, 1.05, 0), v3(0, 1.08, 0)].map((v) => new THREE.Vector2(v.x, v.y));
    p.add(new THREE.LatheGeometry(pts, 18), new THREE.MeshPhysicalMaterial({ color: 0x5ee03a, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.85 }), 0, 0, 0);
    p.add(ball(0.16, 10, 8), P(0xd8102a), 0, 1.15, 0);
    for (const s of [-1, 1]) p.add(ball(0.06, 6, 5), P(0x101010), s * 0.18, 0.75, -0.52);
  });
  put(g, jelly, -0.4, 0.14, -1.4);
  const guests = [put(g, alien('sit'), 0, 0, 3, Math.PI), put(g, alien('wave', 0x5ad0e0), 3.2, 0, -0.5, -Math.PI / 2), put(g, alien('sit', 0xd08ef0), -0.5, 0, -3.4, 0.1)];
  put(g, guy(ARMY_GREEN, 'kneel'), -3.2, 0, 0.6, Math.PI / 2);
  const ship = ufo(0xb8c0cc);
  put(g, ship.group, 4, 0, -9.5, 0.3, 0.8);
  tools.solid(4, -9.5, 3.8, 5);
  tools.solid(-2.6, -2.6, 1, 1.4);
  const hello = greeter(30, ['GREETINGS, EARTHLING. JELLY?', 'TAKE ME TO YOUR SANDWICHES'], '#9bf07a');
  return (ctx) => {
    const w = Math.sin(ctx.t * 7) * 0.12 * (ctx.dist < 30 ? 1.6 : 1);
    jelly.scale.set(1 + w, 1 - w, 1 + w);
    jelly.rotation.z = w * 0.4;
    guests[1].rotation.z = Math.sin(ctx.t * 4) * 0.12;
    guests.forEach((a, i) => (a.position.y = i === 1 ? 0 : Math.max(0, Math.sin(ctx.t * 2 + i)) * 0.12));
    twinkle(ship.lights, ctx.t);
    hello(ctx);
  };
}

