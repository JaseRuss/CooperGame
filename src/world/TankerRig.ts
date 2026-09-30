import * as THREE from 'three';
import { Tank } from '../entities/Tank';
import { nameTag } from '../entities/AllyTank';
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

/** Where each gun post stands (rig space): the cab roof, a sponson either side, and on top of the casing. */
const MOUNTS: { at: THREE.Vector3 }[] = [
  { at: new THREE.Vector3(0, 3.85, -7.3) },
  { at: new THREE.Vector3(-2.75, 2.75, -2.4) },
  { at: new THREE.Vector3(2.75, 2.75, -2.4) },
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
 * A toy Mad Max war rig: an armoured cab pulling a fat bomb casing, with explosive drums along its
 * flanks, a plunger detonator on top, and four gun posts. The player's tank rides the rear deck.
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
      const stack = new THREE.CylinderGeometry(0.17, 0.2, 2.8, 10);
      p.add(stack, steel, s * 1.4, 3.3, -5.6);
      p.add(new THREE.CylinderGeometry(0.26, 0.2, 0.25, 10), plate, s * 1.4, 4.65, -5.6);
      p.add(new THREE.SphereGeometry(0.2, 10, 8), lampOn, s * 1.0, 2.25, -10.75);
    }
    // Bull bar and ram spikes across the nose.
    p.add(new THREE.BoxGeometry(3.6, 0.55, 0.45), plate, 0, 1.0, -10.85);
    p.add(new THREE.BoxGeometry(3.6, 0.2, 0.3), steel, 0, 1.75, -10.85);
    for (let i = -3; i <= 3; i++) p.add(new THREE.ConeGeometry(0.17, 0.75, 6).rotateX(-Math.PI / 2), steel, i * 0.5, 1.0, -11.4);
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

  /** Stage 4: four pedestal gun posts with twin barrels, a shield, and the crew standing behind. */
  private buildGuns(g: THREE.Group): void {
    const dark = plastic(shade(ARMY_GREEN, 0.5));
    const steel = plastic(0x3d403a);
    const body = plastic(shade(ARMY_GREEN, 0.85));
    // Sponson platforms out from the casing for the two side guns.
    const pf = new PartBuilder();
    for (const s of [-1, 1]) {
      pf.add(new THREE.BoxGeometry(1.7, 0.2, 2.0), dark, s * 2.75, 2.6, -2.4);
      pf.beam(new THREE.Vector3(s * 1.7, 2.0, -2.4), new THREE.Vector3(s * 2.5, 2.55, -2.4), 0.12, steel);
    }
    pf.buildInto(g);
    for (const m of MOUNTS) {
      const stand = new PartBuilder();
      stand.add(new THREE.CylinderGeometry(0.22, 0.3, 0.55, 10), steel, m.at.x, m.at.y + 0.25, m.at.z);
      stand.add(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 14), dark, m.at.x, m.at.y + 0.55, m.at.z);
      stand.buildInto(g);

      const yawPivot = new THREE.Group();
      yawPivot.position.set(m.at.x, m.at.y + 0.6, m.at.z);
      const tilt = new THREE.Group();
      tilt.position.y = 0.45;
      const gun = new PartBuilder();
      gun.add(new THREE.BoxGeometry(0.55, 0.42, 0.9), body, 0, 0, 0.05);
      for (const s of [-1, 1]) {
        gun.add(tubeZ(0.06, 0.07, 1.6, 8), steel, s * 0.17, 0.02, -0.95);
        gun.add(tubeZ(0.11, 0.11, 0.3, 8), dark, s * 0.17, 0.02, -1.6);
      }
      gun.add(new THREE.BoxGeometry(0.9, 0.7, 0.08), dark, 0, 0.15, -0.5); // shield
      gun.add(new THREE.BoxGeometry(0.3, 0.3, 0.45), plastic(ARMY_RED), 0.45, -0.1, 0.3); // ammo box
      gun.buildInto(tilt);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.02, -1.8);
      tilt.add(muzzle);
      yawPivot.add(tilt);

      const crew = Tank.crewman(ARMY_GREEN);
      crew.scale.setScalar(1.45);
      crew.position.set(0, -0.05, 0.95);
      crew.visible = false;
      yawPivot.add(crew);
      g.add(yawPivot);
      this.guns.push({ yawPivot, tilt, muzzle, crew, tag: null, yaw: 0, pitch: 0.1 });
      tilt.rotation.x = 0.1;
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
    let wantYaw = 0;
    let wantPitch = 0.1;
    if (target) {
      const local = this.root.worldToLocal(target.clone()).sub(MOUNTS[i].at);
      wantYaw = Math.atan2(-local.x, -local.z);
      wantPitch = clamp(Math.atan2(local.y - 1.0, Math.hypot(local.x, local.z)), -0.25, 1.1);
    }
    const step = GUN_TURN * dt;
    gun.yaw += clamp(shortestAngleDelta(gun.yaw, wantYaw), -step, step);
    gun.pitch += clamp(wantPitch - gun.pitch, -GUN_ELEVATE * dt * 3, GUN_ELEVATE * dt * 3);
    gun.yawPivot.rotation.y = gun.yaw;
    gun.tilt.rotation.x = gun.pitch;
    gun.yawPivot.updateMatrixWorld(true);
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
