import * as THREE from 'three';
import { plastic, shade } from '../utils/plastic';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';

const TYRE = 0x2e2f2c;

function wheels(p: PartBuilder, positions: [number, number, number][], radius: number, width: number, color: number): void {
  const tyre = plastic(TYRE);
  const hub = plastic(shade(color, 0.8));
  for (const [x, y, z] of positions) {
    p.add(tubeX(radius, width, 16), tyre, x, y, z);
    p.add(tubeX(radius * 0.55, width + 0.04, 10), hub, x, y, z);
    // Chunky tread blocks round the tyre.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      p.add(new THREE.BoxGeometry(width * 0.9, 0.06, 0.1), tyre, x, y + Math.cos(a) * radius, z + Math.sin(a) * radius, a);
    }
  }
}

/** A toy army jeep (nose toward -Z), about 3.4m long. */
export function buildJeep(color: number): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const body = plastic(color);
  const dark = plastic(shade(color, 0.7));
  const deep = plastic(shade(color, 0.45));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fcde0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.6 });
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  p.add(box(1.5, 0.5, 3.2), body, 0, 0.75, 0); // tub
  p.add(box(1.46, 0.36, 1.1), body, 0, 0.92, -1.05); // bonnet
  p.add(box(1.3, 0.3, 0.06), deep, 0, 0.95, -1.62); // grille
  for (let i = 0; i < 7; i++) p.add(box(0.05, 0.26, 0.04), dark, -0.45 + i * 0.15, 0.95, -1.66);
  for (const s of [-1, 1]) {
    p.add(tubeZ(0.1, 0.1, 0.08, 10), deep, s * 0.48, 1.0, -1.67); // headlights
    p.add(box(0.3, 0.06, 1.0), body, s * 0.83, 0.82, -1.1, 0.12); // front wings
    p.add(box(0.3, 0.06, 0.9), body, s * 0.83, 0.82, 1.1, -0.1); // rear wings
    p.add(box(0.36, 0.5, 0.5), dark, s * 0.4, 1.25, 0.7); // seat backs
  }
  p.add(box(1.3, 0.12, 0.6), dark, 0, 1.05, 0.55); // seats
  // Folded windscreen frame, spare wheel on the back, jerry can, whip aerial.
  p.add(box(1.4, 0.06, 0.06), deep, 0, 1.12, -0.48);
  p.add(box(1.3, 0.5, 0.03), glass, 0, 1.35, -0.48, -0.25);
  p.add(box(1.4, 0.06, 0.06), deep, 0, 1.6, -0.54);
  for (const s of [-1, 1]) p.add(box(0.06, 0.55, 0.06), deep, s * 0.68, 1.35, -0.5, -0.25);
  p.add(box(0.26, 0.4, 0.14), dark, 0.5, 1.0, 1.66);
  p.add(new THREE.CylinderGeometry(0.012, 0.016, 2.4, 5), deep, -0.68, 2.1, 1.45);
  p.add(tubeZ(0.1, 0.1, 0.3, 8), deep, 0, 0.7, -1.75); // front bumper winch
  p.add(box(1.6, 0.12, 0.12), deep, 0, 0.55, -1.7);
  p.add(box(1.6, 0.12, 0.12), deep, 0, 0.55, 1.62);
  // Mounted machine gun on a post in the back.
  p.add(box(0.08, 0.8, 0.08), deep, 0, 1.4, 1.1);
  p.add(box(0.12, 0.14, 0.6), dark, 0, 1.85, 0.95);
  p.add(tubeZ(0.03, 0.03, 0.6, 6), deep, 0, 1.87, 0.4);
  p.buildInto(g);

  const w = new PartBuilder();
  wheels(w, [[-0.72, 0.42, -1.05], [0.72, 0.42, -1.05], [-0.72, 0.42, 1.05], [0.72, 0.42, 1.05]], 0.42, 0.3, color);
  // Spare wheel stood on the tailgate.
  w.add(new THREE.CylinderGeometry(0.4, 0.4, 0.26, 16).rotateX(Math.PI / 2), plastic(TYRE), -0.3, 1.05, 1.72);
  w.buildInto(g);
  return g;
}

/** A toy army lorry with a canvas-covered load bed (nose toward -Z), about 6.5m long. */
export function buildTruck(color: number): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const body = plastic(color);
  const dark = plastic(shade(color, 0.7));
  const deep = plastic(shade(color, 0.45));
  const canvas = plastic(shade(color, 1.12));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fcde0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.7 });
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  p.add(box(1.8, 0.25, 6.2), deep, 0, 0.85, 0); // chassis rails
  // Cab: bonnet, cab box, windows, grille, bumper, lamps.
  p.add(box(1.9, 0.8, 1.3), body, 0, 1.4, -2.45);
  p.add(box(2.1, 1.2, 1.4), body, 0, 1.85, -1.2);
  p.add(box(1.9, 0.55, 0.04), glass, 0, 2.15, -1.92);
  for (const s of [-1, 1]) {
    p.add(box(0.04, 0.5, 0.8), glass, s * 1.06, 2.15, -1.25);
    p.add(tubeZ(0.14, 0.14, 0.1, 10), deep, s * 0.7, 1.5, -3.12);
    p.add(box(0.5, 0.08, 1.4), body, s * 1.0, 1.1, -2.4, 0.1); // mudguards
    p.add(box(0.08, 0.5, 0.08), deep, s * 1.15, 2.1, -1.95); // mirror arm
    p.add(box(0.06, 0.28, 0.2), deep, s * 1.2, 2.35, -1.95);
    p.add(box(0.36, 0.2, 0.5), dark, s * 0.95, 0.75, -0.5); // fuel tank / step
  }
  p.add(box(1.5, 0.6, 0.06), deep, 0, 1.4, -3.12);
  for (let i = 0; i < 8; i++) p.add(box(0.06, 0.5, 0.04), dark, -0.63 + i * 0.18, 1.4, -3.16);
  p.add(box(2.2, 0.2, 0.2), deep, 0, 0.9, -3.2);
  p.add(box(2.14, 0.12, 1.46), dark, 0, 2.5, -1.2); // cab roof
  // Load bed with drop sides and a canvas tilt over hoops.
  p.add(box(2.3, 0.18, 4.0), body, 0, 1.1, 1.1);
  for (const s of [-1, 1]) p.add(box(0.08, 0.6, 4.0), body, s * 1.12, 1.48, 1.1);
  p.add(box(2.3, 0.6, 0.08), body, 0, 1.48, 3.08);
  // Half-cylinder along Z with the curve on top (thetaStart π/2 puts the arc above the axis).
  const tilt = new THREE.CylinderGeometry(1.15, 1.15, 3.9, 16, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
  p.add(tilt, canvas, 0, 2.4, 1.1, 0, 0, 0, 1, 0.6, 1);
  p.add(box(2.3, 0.9, 3.9), canvas, 0, 1.95, 1.1);
  for (const z of [-0.6, 0.5, 1.6, 2.7]) p.add(new THREE.TorusGeometry(1.17, 0.035, 4, 12, Math.PI), deep, 0, 2.4, z, 0, 0, 0, 1, 0.6, 1);
  p.add(tubeX(0.12, 2.0, 8), dark, 0, 2.8, 3.07); // rolled-up rear flap
  p.buildInto(g);

  const w = new PartBuilder();
  const y = 0.55;
  wheels(w, [[-1.0, y, -2.35], [1.0, y, -2.35], [-1.0, y, 0.6], [1.0, y, 0.6], [-1.0, y, 1.85], [1.0, y, 1.85]], 0.55, 0.36, color);
  w.buildInto(g);
  return g;
}
