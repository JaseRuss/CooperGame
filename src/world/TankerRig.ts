import * as THREE from 'three';
import { nameTag } from '../entities/AllyTank';
import { buildGunner } from './TankerCrew';
import { PartBuilder, tubeX, tubeZ } from '../utils/modelKit';
import { plastic, shade, ARMY_GREEN, ARMY_RED } from '../utils/plastic';
import { clamp, shortestAngleDelta } from '../utils/math';

/** The five parts of the bomb tanker, in the order they're listed on the HUD. */
export const TANKER_PARTS = ['Armoured Engine', 'Bomb Casing', 'Explosives', 'Detonator', 'Turret Guns'] as const;

/** Where the player's tank sits on the rear deck, in the rig's own space (the tank's centre). */
export const RIG_DECK = new THREE.Vector3(0, 2.15, 8.3);

const WHEEL_RADIUS = 0.95;
const WHEEL_WIDTH = 0.75;
const AXLES = [-9.2, -6.8, 6.0, 7.6, 9.2];
const CASING_Y = 3.0;
const CASING_R = 1.9;
const GUN_TURN = 5;
const GUN_ELEVATE = 0.9;

/** Height of the gun's trunnions above the post's deck, and where its spade grips sit behind them. */
const GUN_HEIGHT = 1.15;
const GRIP = new THREE.Vector3(0.2, 0, 0.72);
/** Where the gunner stands behind the gun (yaw-pivot space, feet on the deck), and his size. */
const GUNNER_AT = new THREE.Vector3(0, -0.6, 1.18);
const GUNNER_SCALE = 1.1;
const REST_PITCH = 0.1;

/**
 * Where each gun post's deck is (rig space): the cab roof, a sponson either side, and a platform
 * on top of the casing. `arc` limits a sponson gun to its own side, so its gunner never ends up
 * standing inside the casing.
 */
const MOUNTS: { at: THREE.Vector3; arc?: { centre: number; half: number } }[] = [
  { at: new THREE.Vector3(0, 4.1, -7.3) },
  { at: new THREE.Vector3(-3.35, 2.75, -2.4), arc: { centre: Math.PI / 2, half: 1.5 } },
  { at: new THREE.Vector3(3.35, 2.75, -2.4), arc: { centre: -Math.PI / 2, half: 1.5 } },
  { at: new THREE.Vector3(0, 4.95, 2.6) },
];

interface Gun {
  yawPivot: THREE.Group;
  tilt: THREE.Group;
  muzzle: THREE.Object3D;
  crew: THREE.Group;
  tag: THREE.Sprite | null;
  yaw: number;
  pitch: number;
}

/**
 * A toy Mad Max war rig: a welded-scrap armoured cab with a supercharger, skull and spiked ram,
 * pulling a fat bomb casing with explosive drums along its flanks, a plunger detonator on top, and
 * four gun posts crewed by road warriors. The player's tank rides the spiked rear deck.
 * It is built in five stages (see TANKER_PARTS) that switch on as the parts are delivered; the
 * frame, wheels and deck are always there. Nose toward -Z, wheels on y = 0.
 */
export class TankerRig {
  readonly root = new THREE.Group();
  private readonly stages: THREE.Group[] = TANKER_PARTS.map(() => new THREE.Group());
  private readonly wheels: THREE.Object3D[] = [];
  private readonly guns: Gun[] = [];
  private readonly lamp = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 0.4 });
  private readonly glow = new THREE.MeshStandardMaterial({ color: 0xd8401c, emissive: 0xff5a20, emissiveIntensity: 0.35, roughness: 0.5 });
  private readonly flames: THREE.Mesh[] = [];
  /** The tips of the two exhaust stacks, in rig space, for the smoke. */
  readonly stackTips = [new THREE.Vector3(-1.4, 4.6, -5.6), new THREE.Vector3(1.4, 4.6, -5.6)];
  private time = 0;

  constructor() {
    this.buildChassis();
    this.buildEngine(this.stages[0]);
    this.buildCasing(this.stages[1]);
    this.buildExplosives(this.stages[2]);
    this.buildDetonator(this.stages[3]);
    this.buildGuns(this.stages[4]);
    for (const s of this.stages) {
      s.visible = false;
      this.root.add(s);
    }
  }

  private buildChassis(): void {
    const body = plastic(shade(ARMY_GREEN, 0.75));
    const dark = plastic(shade(ARMY_GREEN, 0.4));
    const steel = plastic(0x4d5049);
    const tyre = plastic(0x232421);
    const hub = plastic(0xb8b29c);
    const p = new PartBuilder();
    // Frame rails, the rear deck the player's tank stands on, and the fenders over the back wheels.
    for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.4, 0.5, 21), steel, s * 0.95, 1.15, 0);
    p.add(new THREE.BoxGeometry(3.7, 0.25, 6.4), body, 0, 1.5, 8.0);
    p.add(new THREE.BoxGeometry(3.9, 0.3, 0.3), dark, 0, 1.55, 11.1);
    for (const s of [-1, 1]) {
      p.add(new THREE.BoxGeometry(0.3, 0.5, 6.4), dark, s * 1.85, 1.75, 8.0);
      p.add(new THREE.BoxGeometry(0.9, 0.12, 4.4), dark, s * 2.15, 2.05, 7.6);
    }
    for (const z of AXLES) p.add(tubeX(0.16, 4.2, 10), steel, 0, WHEEL_RADIUS, z);
    // Spikes along the rear fenders, a spiked ram bumper on the tail, and skull tail lamps.
    const rust = plastic(0x9a5a2e);
    const bone = plastic(0xf4f1e4);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) p.add(new THREE.ConeGeometry(0.1, 0.5, 6), steel, s * 2.5, 2.3, 5.8 + i * 0.72);
      p.add(new THREE.SphereGeometry(0.2, 10, 8), bone, s * 1.45, 1.55, 11.3, 0, 0, 0, 1, 0.9, 1);
      for (const e of [-1, 1]) p.add(new THREE.SphereGeometry(0.055, 6, 5), this.lamp, s * 1.45 + e * 0.075, 1.58, 11.47);
    }
    p.add(new THREE.BoxGeometry(4.0, 0.4, 0.35), rust, 0, 1.0, 11.35);
    for (let i = -3; i <= 3; i++) p.add(new THREE.ConeGeometry(0.12, 0.6, 6).rotateX(Math.PI / 2), steel, i * 0.55, 1.0, 11.8);
    // Chains swagged along both flanks of the frame.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 22; i++) {
        const z = -4.2 + i * 0.4;
        const sag = Math.sin((i / 21) * Math.PI) * 0.45;
        p.add(new THREE.TorusGeometry(0.1, 0.03, 4, 8), steel, s * 1.9, 1.4 - sag, z, 0, Math.PI / 2, i % 2 ? Math.PI / 2 : 0);
      }
    }
    p.buildInto(this.root);
    for (const z of AXLES) {
      for (const s of [-1, 1]) {
        const w = new PartBuilder();
        w.add(tubeX(WHEEL_RADIUS, WHEEL_WIDTH, 22), tyre);
        w.add(tubeX(WHEEL_RADIUS * 0.55, WHEEL_WIDTH + 0.06, 14), hub);
        w.add(tubeX(WHEEL_RADIUS * 0.22, WHEEL_WIDTH + 0.12, 8), steel);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          w.add(new THREE.BoxGeometry(WHEEL_WIDTH * 0.92, 0.12, 0.22), tyre, 0, Math.cos(a) * WHEEL_RADIUS, Math.sin(a) * WHEEL_RADIUS, a);
        }
        // A scythe spike out of the hub and a ring of bolts round it.
        w.add(new THREE.ConeGeometry(0.16, 0.8, 8).rotateZ(-s * Math.PI / 2), steel, s * (WHEEL_WIDTH / 2 + 0.45), 0, 0);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          w.add(new THREE.SphereGeometry(0.06, 6, 4), steel, s * (WHEEL_WIDTH / 2 + 0.06), Math.cos(a) * 0.36, Math.sin(a) * 0.36);
        }
        const pivot = new THREE.Group();
        pivot.position.set(s * 2.05, WHEEL_RADIUS, z);
        w.buildInto(pivot);
        this.root.add(pivot);
        this.wheels.push(pivot);
      }
    }
  }

  /** Stage 0: a slab-sided armoured cab with a bull bar, spikes, big exhaust stacks and headlamps. */
  private buildEngine(g: THREE.Group): void {
    const body = plastic(ARMY_GREEN);
    const plate = plastic(shade(ARMY_GREEN, 0.6));
    const steel = plastic(0x4d5049);
    const rust = plastic(0x9a5a2e);
    const chrome = plastic(0xc9cbc4);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fcde0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.75 });
    const lampOn = new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0xffe9a0, emissiveIntensity: 1.2 });
    const p = new PartBuilder();
    p.add(new THREE.BoxGeometry(3.0, 1.5, 2.8), body, 0, 2.0, -9.3); // hood
    p.add(new THREE.BoxGeometry(3.3, 2.1, 2.7), body, 0, 2.85, -6.95); // cab
    p.add(new THREE.BoxGeometry(3.5, 0.22, 3.0), plate, 0, 3.98, -6.95); // roof armour
    p.add(new THREE.BoxGeometry(3.0, 0.8, 0.12), glass, 0, 3.15, -8.35);
    p.add(new THREE.BoxGeometry(0.12, 0.8, 1.9), glass, -1.68, 3.15, -6.95);
    p.add(new THREE.BoxGeometry(0.12, 0.8, 1.9), glass, 1.68, 3.15, -6.95);
    for (const s of [-1, 1]) {
      p.add(new THREE.BoxGeometry(0.15, 1.1, 2.2), plate, s * 1.75, 2.0, -6.9, 0, 0, s * 0.18); // side plates
      p.add(new THREE.BoxGeometry(0.9, 0.12, 2.6), plate, s * 2.0, 1.15, -9.0); // running boards
      const stack = new THREE.CylinderGeometry(0.22, 0.26, 2.8, 12);
      p.add(stack, chrome, s * 1.4, 3.3, -5.6);
      p.add(new THREE.CylinderGeometry(0.34, 0.24, 0.3, 12), rust, s * 1.4, 4.62, -5.6);
      for (const y of [2.6, 3.4, 4.1]) p.add(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 12), steel, s * 1.4, y, -5.6);
      p.add(new THREE.SphereGeometry(0.2, 10, 8), lampOn, s * 1.0, 2.25, -10.75);
    }
    // Bull bar and ram spikes across the nose.
    p.add(new THREE.BoxGeometry(3.6, 0.55, 0.45), plate, 0, 1.0, -10.85);
    p.add(new THREE.BoxGeometry(3.6, 0.2, 0.3), steel, 0, 1.75, -10.85);
    for (let i = -3; i <= 3; i++) p.add(new THREE.ConeGeometry(0.17, 0.75, 6).rotateX(-Math.PI / 2), steel, i * 0.5, 1.0, -11.4);
    // A cow-catcher wedge of welded bars under the bull bar.
    for (let i = -4; i <= 4; i++) {
      p.beam(new THREE.Vector3(i * 0.4, 0.75, -11.05), new THREE.Vector3(i * 0.3, 0.2, -12.0), 0.1, steel, true);
    }
    p.add(new THREE.BoxGeometry(2.9, 0.12, 0.12), steel, 0, 0.22, -11.95);

    // The chrome skull on the grille, with glowing eyes.
    const skullAt = new THREE.Vector3(0, 2.05, -10.78);
    p.add(new THREE.SphereGeometry(0.42, 16, 12), chrome, skullAt.x, skullAt.y + 0.1, skullAt.z, 0, 0, 0, 1, 0.95, 0.8);
    p.add(new THREE.BoxGeometry(0.46, 0.26, 0.3), chrome, skullAt.x, skullAt.y - 0.28, skullAt.z - 0.04);
    for (const s of [-1, 1]) p.add(new THREE.SphereGeometry(0.11, 10, 8), this.lamp, skullAt.x + s * 0.15, skullAt.y + 0.08, skullAt.z - 0.3);
    for (let i = -2; i <= 2; i++) p.add(new THREE.BoxGeometry(0.06, 0.14, 0.04), plate, skullAt.x + i * 0.085, skullAt.y - 0.3, skullAt.z - 0.2);
    // Crossed pistons behind it for bones.
    for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(1.8, 0.14, 0.1), chrome, 0, 2.05, -10.7, 0, 0, s * 0.55);

    // Supercharger blower bursting out of the hood, with its belt drive and a big intake scoop.
    p.add(new THREE.BoxGeometry(0.95, 0.55, 1.5), chrome, 0, 3.0, -9.4);
    for (let i = 0; i < 6; i++) p.add(new THREE.BoxGeometry(1.05, 0.06, 0.08), steel, 0, 3.05, -10.05 + i * 0.26);
    p.add(tubeX(0.2, 0.3, 12), steel, 0, 2.95, -10.25);
    p.add(new THREE.BoxGeometry(1.1, 0.35, 0.95), chrome, 0, 3.45, -9.55);
    p.add(new THREE.BoxGeometry(1.2, 0.08, 1.05), steel, 0, 3.64, -9.55);
    for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.06, 0.28, 0.9), steel, s * 0.3, 3.45, -9.55);

    // Welded-on scrap plates in rust and bare steel over the cab and hood.
    const scrap: [number, number, number, number, number, number, THREE.Material][] = [
      [1.52, 2.4, -9.6, 0.9, 0.7, 0.08, rust],
      [1.52, 1.75, -8.7, 0.6, 0.5, 0.05, steel],
      [1.7, 2.35, -6.2, 1.0, 0.8, 0.12, rust],
      [1.7, 3.65, -7.7, 0.6, 0.35, -0.1, steel],
    ];
    for (const s of [-1, 1]) {
      for (const [x, y, z, w, h, tilt, mat] of scrap) {
        p.add(new THREE.BoxGeometry(0.06, h, w), mat, s * x, y, z, tilt * s, 0, 0);
        for (const dz of [-w / 2 + 0.1, w / 2 - 0.1]) p.add(new THREE.SphereGeometry(0.04, 5, 4), steel, s * (x + 0.04), y + h / 2 - 0.08, z + dz);
      }
    }
    // Armour slats over the windscreen and side windows.
    for (const y of [2.95, 3.15, 3.35]) {
      p.add(new THREE.BoxGeometry(3.1, 0.07, 0.07), steel, 0, y, -8.43);
      for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.07, 0.07, 2.0), steel, s * 1.75, y, -6.95);
    }
    // Two tattered war flags on poles behind the cab.
    for (const s of [-1, 1]) {
      p.add(new THREE.CylinderGeometry(0.04, 0.05, 3.4, 6), steel, s * 1.6, 5.4, -5.9);
      const flag = s < 0 ? rust : plastic(ARMY_GREEN);
      p.add(new THREE.BoxGeometry(0.03, 0.55, 0.9), flag, s * 1.6, 6.75, -5.4, 0.08, 0, 0);
      p.add(new THREE.BoxGeometry(0.03, 0.35, 0.5), flag, s * 1.6, 6.8, -4.75, -0.12, 0, 0);
    }
    p.buildInto(g);
    // Engine flames licking out of the stacks.
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const tip of this.stackTips) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.0, 8).translate(0, 0.5, 0), flameMat);
      flame.position.copy(tip).add(new THREE.Vector3(0, 0.05, 0));
      g.add(flame);
      this.flames.push(flame);
    }
  }

  /** Stage 1: the big bomb casing, lying along the frame with hazard bands and a nose cap. */
  private buildCasing(g: THREE.Group): void {
    const shell = plastic(0x7d8064);
    const yellow = plastic(0xe8b824);
    const black = plastic(0x1f201d);
    const steel = plastic(0x4d5049);
    const p = new PartBuilder();
    p.add(tubeZ(CASING_R, CASING_R, 10.2, 32), shell, 0, CASING_Y, 0);
    for (const s of [-1, 1]) p.add(new THREE.SphereGeometry(CASING_R, 28, 14), shell, 0, CASING_Y, s * 5.1, 0, 0, 0, 1, 1, 0.5);
    for (let i = 0; i < 6; i++) {
      p.add(tubeZ(CASING_R + 0.06, CASING_R + 0.06, 0.55, 32), i % 2 ? black : yellow, 0, CASING_Y, -3.9 + i * 1.56);
    }
    // Saddles holding it on the frame, and rivets along the seam.
    for (const z of [-3.4, 0.2, 3.6]) p.add(new THREE.BoxGeometry(3.4, 1.0, 0.5), steel, 0, 1.9, z);
    for (let i = 0; i < 18; i++) p.add(new THREE.SphereGeometry(0.09, 6, 5), steel, -1.3 + (i % 2) * 2.6, CASING_Y + 1.3, -4.4 + i * 0.5);
    // Skull-and-crossbones on each flank: two bones and a round head.
    const mark = plastic(0xf4f1e4);
    for (const s of [-1, 1]) {
      p.add(new THREE.SphereGeometry(0.42, 12, 10), mark, s * (CASING_R + 0.08), CASING_Y + 0.15, 0.2, 0, 0, 0, 0.3, 1, 1);
      p.add(new THREE.BoxGeometry(0.1, 0.16, 1.3), mark, s * (CASING_R + 0.08), CASING_Y - 0.6, 0.2, Math.PI / 5);
      p.add(new THREE.BoxGeometry(0.1, 0.16, 1.3), mark, s * (CASING_R + 0.08), CASING_Y - 0.6, 0.2, -Math.PI / 5);
    }
    p.buildInto(g);
  }

  /** Stage 2: rows of glowing TNT drums stacked along both flanks. */
  private buildExplosives(g: THREE.Group): void {
    const cap = plastic(0xe8b824);
    const p = new PartBuilder();
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        for (const y of [2.05, 3.15]) {
          const z = 0.3 + i * 1.25;
          p.add(new THREE.CylinderGeometry(0.52, 0.52, 1.0, 14), this.glow, s * 2.6, y, z);
          p.add(new THREE.CylinderGeometry(0.54, 0.54, 0.12, 14), cap, s * 2.6, y + 0.5, z);
          p.add(new THREE.CylinderGeometry(0.54, 0.54, 0.12, 14), cap, s * 2.6, y - 0.5, z);
        }
      }
    }
    p.buildInto(g);
  }

  /** Stage 3: a detonator box on top with a T-handle plunger, an aerial, wires and a blinking lamp. */
  private buildDetonator(g: THREE.Group): void {
    const box = plastic(0xc0392b);
    const steel = plastic(0x4d5049);
    const wire = plastic(0x1f201d);
    const y = CASING_Y + CASING_R;
    const p = new PartBuilder();
    p.add(new THREE.BoxGeometry(1.5, 0.9, 1.3), box, 0, y + 0.4, -1.2);
    p.add(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), steel, 0, y + 1.25, -1.2);
    p.add(tubeX(0.09, 1.2, 8), steel, 0, y + 1.7, -1.2);
    p.add(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6), steel, 0.55, y + 2.0, -1.5);
    p.add(new THREE.SphereGeometry(0.1, 8, 6), steel, 0.55, y + 3.3, -1.5);
    for (const z of [-0.2, 1.1]) p.beam(new THREE.Vector3(0, y + 0.3, -0.7), new THREE.Vector3(0, y + 0.1, z), 0.07, wire, true);
    p.buildInto(g);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), this.lamp);
    lamp.position.set(-0.5, y + 1.0, -1.65);
    g.add(lamp);
  }

  /**
   * Stage 4: four twin-barrelled guns on swivel posts, each with a spiked shield and spade grips,
   * and a road warrior standing behind it with both hands on the grips.
   */
  private buildGuns(g: THREE.Group): void {
    const dark = plastic(shade(ARMY_GREEN, 0.5));
    const steel = plastic(0x3d403a);
    const chrome = plastic(0xc9cbc4);
    const rust = plastic(0x9a5a2e);
    const body = plastic(shade(ARMY_GREEN, 0.85));
    const bone = plastic(0xf4f1e4);
    // Round decks for the gunners: sponsons out from the casing, and a railed platform on top of it.
    const deck = new PartBuilder();
    for (const s of [-1, 1]) {
      const m = MOUNTS[s < 0 ? 1 : 2].at;
      deck.add(new THREE.CylinderGeometry(1.55, 1.55, 0.2, 20), dark, m.x, m.y - 0.1, m.z);
      deck.add(new THREE.CylinderGeometry(1.6, 1.6, 0.08, 20), rust, m.x, m.y - 0.22, m.z);
      for (const dz of [-0.9, 0.9]) deck.beam(new THREE.Vector3(s * 1.5, 1.9, m.z + dz), new THREE.Vector3(m.x - s * 0.4, m.y - 0.2, m.z + dz), 0.14, steel);
    }
    const top = MOUNTS[3].at;
    deck.add(new THREE.CylinderGeometry(1.45, 1.45, 0.15, 20), rust, top.x, top.y - 0.08, top.z);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      deck.add(new THREE.BoxGeometry(0.06, 0.5, 0.06), steel, top.x + Math.cos(a) * 1.4, top.y + 0.25, top.z + Math.sin(a) * 1.4);
    }
    deck.add(new THREE.TorusGeometry(1.4, 0.04, 5, 28), steel, top.x, top.y + 0.5, top.z, Math.PI / 2);
    for (const x of [-0.9, 0.9]) for (const dz of [-0.9, 0.9]) deck.add(new THREE.BoxGeometry(0.14, 0.7, 0.14), steel, top.x + x, top.y - 0.45, top.z + dz);
    deck.buildInto(g);

    for (const [i, m] of MOUNTS.entries()) {
      const stand = new PartBuilder();
      stand.add(new THREE.CylinderGeometry(0.24, 0.34, 0.55, 10), steel, m.at.x, m.at.y + 0.27, m.at.z);
      stand.add(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 14), dark, m.at.x, m.at.y + 0.57, m.at.z);
      stand.buildInto(g);

      const yawPivot = new THREE.Group();
      yawPivot.position.set(m.at.x, m.at.y + 0.6, m.at.z);
      // The swivel column and the gun's cradle turn with it.
      const swivel = new PartBuilder();
      swivel.add(new THREE.CylinderGeometry(0.14, 0.18, GUN_HEIGHT - 0.6, 10), steel, 0, (GUN_HEIGHT - 0.6) / 2, 0);
      for (const s of [-1, 1]) swivel.add(new THREE.BoxGeometry(0.08, 0.4, 0.4), dark, s * 0.42, GUN_HEIGHT - 0.65, 0);
      swivel.buildInto(yawPivot);

      const tilt = new THREE.Group();
      tilt.position.y = GUN_HEIGHT - 0.6;
      const gun = new PartBuilder();
      gun.add(new THREE.BoxGeometry(0.72, 0.5, 1.15), body, 0, 0, 0.05);
      gun.add(new THREE.BoxGeometry(0.5, 0.14, 0.9), dark, 0, 0.3, 0.1); // feed cover
      for (const s of [-1, 1]) {
        gun.add(tubeX(0.12, 0.12, 12), steel, s * 0.4, 0, 0); // trunnion
        gun.add(tubeZ(0.075, 0.085, 2.1, 10), steel, s * 0.2, 0.03, -1.3);
        gun.add(tubeZ(0.13, 0.13, 0.95, 12), dark, s * 0.2, 0.03, -0.95); // cooling jacket
        for (let k = 0; k < 4; k++) gun.add(tubeZ(0.14, 0.14, 0.05, 12), steel, s * 0.2, 0.03, -0.6 - k * 0.24);
        gun.add(tubeZ(0.14, 0.12, 0.28, 10), chrome, s * 0.2, 0.03, -2.35); // muzzle brake
        // Spade grips.
        gun.add(new THREE.CylinderGeometry(0.045, 0.045, 0.28, 8), steel, s * GRIP.x, GRIP.y, GRIP.z);
        gun.beam(new THREE.Vector3(s * 0.12, 0, 0.6), new THREE.Vector3(s * GRIP.x, GRIP.y, GRIP.z), 0.07, steel);
      }
      gun.add(new THREE.BoxGeometry(0.5, 0.06, 0.06), steel, 0, -0.14, GRIP.z);
      // A spiked, scrap-riveted shield with a skull painted on the front.
      gun.add(new THREE.BoxGeometry(1.45, 0.95, 0.09), rust, 0, 0.18, -0.62, -0.12);
      gun.add(new THREE.BoxGeometry(1.2, 0.3, 0.1), dark, 0.1, -0.12, -0.66, -0.12, 0, 0.08);
      for (let k = -3; k <= 3; k++) gun.add(new THREE.ConeGeometry(0.05, 0.28, 6), steel, k * 0.2, 0.78, -0.69, -0.12);
      gun.add(new THREE.SphereGeometry(0.17, 10, 8), bone, -0.42, 0.3, -0.7, 0, 0, 0, 1, 1, 0.3);
      gun.add(new THREE.BoxGeometry(0.16, 0.1, 0.05), bone, -0.42, 0.14, -0.7);
      // Ammo can on the side with a belt feeding into the gun.
      gun.add(new THREE.BoxGeometry(0.3, 0.38, 0.5), plastic(ARMY_RED), 0.56, -0.12, 0.2);
      for (let k = 0; k < 5; k++) gun.add(new THREE.BoxGeometry(0.06, 0.05, 0.12), chrome, 0.5 - k * 0.07, 0.12 + k * 0.03, 0.2);
      gun.buildInto(tilt);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.03, -2.5);
      tilt.add(muzzle);
      yawPivot.add(tilt);

      // His hands meet the grips with the gun at rest.
      const grip = new THREE.Vector3(GRIP.x, GRIP.y, GRIP.z).applyAxisAngle(new THREE.Vector3(1, 0, 0), REST_PITCH);
      grip.y += tilt.position.y;
      grip.sub(GUNNER_AT).divideScalar(GUNNER_SCALE);
      const crew = buildGunner(i, grip);
      crew.scale.setScalar(GUNNER_SCALE);
      crew.position.copy(GUNNER_AT);
      crew.visible = false;
      yawPivot.add(crew);
      g.add(yawPivot);
      const yaw = m.arc?.centre ?? 0;
      yawPivot.rotation.y = yaw;
      tilt.rotation.x = REST_PITCH;
      this.guns.push({ yawPivot, tilt, muzzle, crew, tag: null, yaw, pitch: REST_PITCH });
    }
  }

  /** Switches the stages on for the parts that have been fitted. */
  setInstalled(installed: boolean[]): void {
    this.stages.forEach((s, i) => (s.visible = installed[i] ?? false));
  }

  get complete(): boolean {
    return this.stages.every((s) => s.visible);
  }

  /** Puts the crew on the guns, name tags over their heads (null: nobody aboard). */
  setCrew(names: string[] | null, tags: boolean): void {
    this.guns.forEach((gun, i) => {
      const name = names?.[i] ?? null;
      gun.crew.visible = name !== null;
      if (gun.tag) {
        gun.tag.removeFromParent();
        gun.tag.material.map?.dispose();
        gun.tag.material.dispose();
        gun.tag = null;
      }
      if (name) {
        gun.tag = nameTag(name);
        gun.tag.scale.set(3.6, 0.9, 1);
        gun.tag.visible = tags;
        // Hung over the post, not on the turning gun, so it doesn't swing round with it.
        gun.tag.position.set(MOUNTS[i].at.x, MOUNTS[i].at.y + 3.4, MOUNTS[i].at.z);
        gun.yawPivot.parent?.add(gun.tag);
      }
    });
  }

  get gunCount(): number {
    return this.guns.length;
  }

  /** Rolls every wheel by `distance` metres of travel. */
  spin(distance: number): void {
    for (const w of this.wheels) w.rotation.x += distance / WHEEL_RADIUS;
  }

  /** Flames flicker in the stacks, and the detonator lamp blinks (faster once the bomb's armed). */
  animate(dt: number, armed: boolean): void {
    this.time += dt;
    this.lamp.emissiveIntensity = Math.sin(this.time * (armed ? 22 : 5)) > 0 ? 2.4 : 0.15;
    this.glow.emissiveIntensity = 0.35 + (armed ? 0.5 : 0.1) * (0.5 + 0.5 * Math.sin(this.time * 9));
    for (const f of this.flames) {
      f.scale.set(0.8 + Math.random() * 0.5, 0.7 + Math.random() * 1.1, 0.8 + Math.random() * 0.5);
      f.visible = this.stages[0].visible;
    }
  }

  /** Swings gun `i` toward a world-space point (null: back to straight ahead). */
  aimGun(i: number, target: THREE.Vector3 | null, dt: number): void {
    const gun = this.guns[i];
    const arc = MOUNTS[i].arc;
    let wantYaw = arc?.centre ?? 0;
    let wantPitch = REST_PITCH;
    if (target) {
      const local = this.root.worldToLocal(target.clone()).sub(MOUNTS[i].at);
      wantYaw = Math.atan2(-local.x, -local.z);
      if (arc) wantYaw = arc.centre + clamp(shortestAngleDelta(arc.centre, wantYaw), -arc.half, arc.half);
      wantPitch = clamp(Math.atan2(local.y - GUN_HEIGHT, Math.hypot(local.x, local.z)), -0.25, 1.1);
    }
    const step = GUN_TURN * dt;
    // A sponson gun swings the long way round rather than through the casing.
    const turn = arc ? shortestAngleDelta(arc.centre, wantYaw) - shortestAngleDelta(arc.centre, gun.yaw) : shortestAngleDelta(gun.yaw, wantYaw);
    gun.yaw += clamp(turn, -step, step);
    gun.pitch += clamp(wantPitch - gun.pitch, -GUN_ELEVATE * dt * 3, GUN_ELEVATE * dt * 3);
    gun.yawPivot.rotation.y = gun.yaw;
    gun.tilt.rotation.x = gun.pitch;
    gun.yawPivot.updateMatrixWorld(true);
  }

  /** False when `target` is outside gun `i`'s arc of fire (the far side, for a sponson gun). */
  covers(i: number, target: THREE.Vector3): boolean {
    const arc = MOUNTS[i].arc;
    if (!arc) return true;
    const local = this.root.worldToLocal(target.clone()).sub(MOUNTS[i].at);
    return Math.abs(shortestAngleDelta(arc.centre, Math.atan2(-local.x, -local.z))) <= arc.half;
  }

  /** True when gun `i` is lined up on `target` well enough to open fire. */
  gunOn(i: number, target: THREE.Vector3, tolerance = 0.12): boolean {
    const { origin, direction } = this.muzzle(i);
    return direction.angleTo(target.clone().sub(origin)) < tolerance;
  }

  /** Where gun `i`'s rounds leave, and which way (world space; call after the rig's matrices are up to date). */
  muzzle(i: number): { origin: THREE.Vector3; direction: THREE.Vector3 } {
    const gun = this.guns[i];
    const origin = gun.muzzle.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(0, 0, -1).transformDirection(gun.tilt.matrixWorld);
    return { origin, direction };
  }

  gunPosition(i: number): THREE.Vector3 {
    return this.root.localToWorld(MOUNTS[i].at.clone());
  }

  /** Puts the name tags on or off. */
  setNameTags(on: boolean): void {
    for (const gun of this.guns) if (gun.tag) gun.tag.visible = on;
  }

  dispose(): void {
    this.setCrew(null, false);
  }
}
