import * as THREE from 'three';
import type { PlayerTank, Vehicle } from '../entities/PlayerTank';
import { PartBuilder, tubeX } from '../utils/modelKit';
import { plastic, ARMY_GREEN } from '../utils/plastic';
import { heightAt } from './Terrain';
import { partModel } from './TankerParts';
import { clamp } from '../utils/math';

/** The winch: cable length at cruise, how fast it reels in, and the sling's drop from hook to load. */
const WINCH_LENGTH = 9;
const REEL_SPEED = 7;
const SLING_DROP = 2.2;
const GRAVITY = 18;
/** The swing dies away at this rate. */
const SWING_DAMPING = 0.9;
/** The load is about this tall, so the cable shortens to keep it off the ground when landing. */
const LOAD_HEIGHT = 2.2;

/** The trailer: drawbar length from hitch to axle, and wheel radius. */
const DRAWBAR = 3.6;
const WHEEL_RADIUS = 0.5;
/** How far behind the hull's centre the tow hitch sits on each vehicle. */
const HITCH: Record<Vehicle, number> = { tank: 2.1, jeep: 2.4, motorbike: 1.2, chopper: 0 };

/** Beyond this the cargo has been left behind by a teleport: put it straight back. */
const SNAP_DISTANCE = 20;

const UP = new THREE.Vector3(0, 1, 0);
const cableMaterial = new THREE.MeshBasicMaterial({ color: 0x1f201d });
const flagMaterial = new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.6, side: THREE.DoubleSide });

/** Where each of `n` parts sits on a 2.6 x 3.2 m deck, and how big. */
function layout(n: number): { x: number; y: number; z: number; s: number }[] {
  if (n <= 1) return [{ x: 0, y: 0, z: 0, s: 0.8 }];
  if (n === 2) return [-0.8, 0.8].map((z) => ({ x: 0, y: 0, z, s: 0.52 }));
  const grid = [[-0.65, -0.8], [0.65, -0.8], [-0.65, 0.8], [0.65, 0.8]].map(([x, z]) => ({ x, y: 0, z, s: 0.44 }));
  // The fifth rides on top of the others.
  return n === 5 ? [...grid, { x: 0, y: 1.1, z: 0, s: 0.44 }] : grid.slice(0, n);
}

function buildTrailer(): { root: THREE.Group; wheels: THREE.Group; deck: THREE.Group; flag: THREE.Group } {
  const green = plastic(ARMY_GREEN);
  const steel = plastic(0x5b5f58);
  const black = plastic(0x1f201d);
  const yellow = plastic(0xe8b824);
  const root = new THREE.Group();
  const body = new PartBuilder();
  // Origin at the axle's centre; the drawbar runs forward (-Z) to the hitch.
  body.add(new THREE.BoxGeometry(2.6, 0.25, 3.2), green, 0, 0.3, 0);
  for (const s of [-1, 1]) {
    body.add(new THREE.BoxGeometry(0.12, 0.35, 3.2), yellow, s * 1.25, 0.6, 0); // side rails
    body.add(new THREE.BoxGeometry(0.5, 0.12, 1.2), black, s * 1.45, WHEEL_RADIUS + 0.2, 0); // mudguards
  }
  body.add(new THREE.BoxGeometry(2.6, 0.35, 0.12), yellow, 0, 0.6, 1.55);
  body.beam(new THREE.Vector3(-0.9, 0.25, -1.5), new THREE.Vector3(0, 0.1, -DRAWBAR), 0.16, steel);
  body.beam(new THREE.Vector3(0.9, 0.25, -1.5), new THREE.Vector3(0, 0.1, -DRAWBAR), 0.16, steel);
  body.add(tubeX(0.08, 2.9, 8), steel, 0, 0, 0); // axle
  body.add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), steel, 1.1, 1.6, 1.4); // flag pole
  body.buildInto(root);

  const wheels = new THREE.Group();
  const w = new PartBuilder();
  for (const s of [-1, 1]) {
    w.add(tubeX(WHEEL_RADIUS, 0.36, 14), black, s * 1.45, 0, 0);
    w.add(tubeX(WHEEL_RADIUS * 0.45, 0.38, 10), yellow, s * 1.45, 0, 0);
  }
  w.buildInto(wheels);
  root.add(wheels);

  // A yellow pennant: "take this home".
  const flag = new THREE.Group();
  const f = new PartBuilder();
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, -0.7), new THREE.Vector2(1.1, -0.35)]);
  f.add(new THREE.ShapeGeometry(shape).rotateY(-Math.PI / 2), flagMaterial);
  f.buildInto(flag, false, false);
  flag.position.set(1.1, 2.85, 1.4);
  root.add(flag);

  const deck = new THREE.Group();
  deck.position.y = 0.42;
  root.add(deck);
  return { root, wheels, deck, flag };
}

function buildSling(): { root: THREE.Group; deck: THREE.Group } {
  const steel = plastic(0x5b5f58);
  const yellow = plastic(0xe8b824);
  const root = new THREE.Group();
  const p = new PartBuilder();
  // Origin at the hook; four lines down to a lifting frame, the load sitting on it.
  p.add(new THREE.TorusGeometry(0.28, 0.08, 6, 12), steel, 0, -0.1, 0);
  p.add(new THREE.BoxGeometry(0.5, 0.5, 0.5), yellow, 0, -0.55, 0);
  for (const x of [-1.2, 1.2]) for (const z of [-1.5, 1.5]) p.beam(new THREE.Vector3(0, -0.8, 0), new THREE.Vector3(x, -SLING_DROP, z), 0.05, steel);
  p.add(new THREE.BoxGeometry(2.6, 0.14, 0.14), yellow, 0, -SLING_DROP, -1.5);
  p.add(new THREE.BoxGeometry(2.6, 0.14, 0.14), yellow, 0, -SLING_DROP, 1.5);
  p.add(new THREE.BoxGeometry(2.6, 0.12, 3.2), steel, 0, -SLING_DROP - 0.12, 0);
  p.buildInto(root);
  const deck = new THREE.Group();
  deck.position.y = -SLING_DROP - 0.06;
  root.add(deck);
  return { root, deck };
}

/**
 * The bomb tanker's parts on their way home. The chopper carries them slung under a winch cable,
 * swinging as it flies; anything on wheels tows them on a little trailer with a yellow pennant.
 */
export class PartCargo {
  private readonly models = new Map<number, THREE.Group>();
  private readonly trailer = buildTrailer();
  private readonly sling = buildSling();
  private readonly cable: THREE.Mesh;
  private mode: 'none' | 'sling' | 'trailer' = 'none';
  private loaded = '';
  private readonly hook = new THREE.Vector3();
  private readonly hookVelocity = new THREE.Vector3();
  private cableLength = WINCH_LENGTH;
  private readonly axle = new THREE.Vector3();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6).translate(0, 0.5, 0), cableMaterial);
    for (const o of [this.trailer.root, this.sling.root, this.cable]) {
      o.visible = false;
      scene.add(o);
    }
  }

  update(dt: number, player: PlayerTank, carried: readonly number[]): void {
    this.time += dt;
    const mode = carried.length === 0 ? 'none' : player.isChopper ? 'sling' : 'trailer';
    const key = `${mode}:${carried.join(',')}`;
    if (key !== this.loaded) {
      const fresh = mode !== this.mode;
      const deck = mode === 'sling' ? this.sling.deck : this.trailer.deck;
      for (const m of this.models.values()) m.removeFromParent();
      const spots = layout(carried.length);
      carried.forEach((index, i) => {
        const model = this.model(index);
        const at = spots[i];
        model.position.set(at.x, at.y, at.z);
        model.scale.setScalar(at.s);
        deck.add(model);
      });
      if (fresh) this.reset(player, mode);
      this.mode = mode;
      this.loaded = key;
    }
    this.trailer.root.visible = mode === 'trailer';
    this.sling.root.visible = this.cable.visible = mode === 'sling';
    if (mode === 'sling') this.swing(dt, player);
    else if (mode === 'trailer') this.tow(player);
  }

  private model(index: number): THREE.Group {
    let m = this.models.get(index);
    if (!m) {
      m = partModel(index);
      this.models.set(index, m);
    }
    return m;
  }

  private reset(player: PlayerTank, mode: 'none' | 'sling' | 'trailer'): void {
    const p = player.position;
    if (mode === 'sling') {
      // The load comes up off the ground under the chopper, then the winch reels it in.
      this.cableLength = Math.max(WINCH_LENGTH, p.y - heightAt(p.x, p.z) - LOAD_HEIGHT - SLING_DROP);
      this.hook.set(p.x, p.y - this.cableLength, p.z);
      this.hookVelocity.set(0, 0, 0);
    } else if (mode === 'trailer') {
      this.axle.copy(p).addScaledVector(player.forward, -(HITCH[player.vehicle] + DRAWBAR));
    }
  }

  /** A pendulum on the end of the cable, dragged along under the chopper. */
  private swing(dt: number, player: PlayerTank): void {
    const anchor = player.position.clone();
    anchor.y -= 0.7;
    const ground = heightAt(this.hook.x, this.hook.z);
    // Reel in to the winch's length, and shorten further coming in to land so the load sits on the ground.
    const room = Math.max(0.5, anchor.y - ground - SLING_DROP - LOAD_HEIGHT * 0.2);
    this.cableLength = Math.min(Math.max(WINCH_LENGTH, this.cableLength - REEL_SPEED * dt), room);
    if (this.hook.distanceTo(anchor) > this.cableLength + SNAP_DISTANCE) {
      this.hook.set(anchor.x, anchor.y - this.cableLength, anchor.z);
      this.hookVelocity.set(0, 0, 0);
    }
    const before = this.hook.clone();
    if (dt > 0) {
      this.hookVelocity.y -= GRAVITY * dt;
      this.hookVelocity.multiplyScalar(Math.exp(-SWING_DAMPING * dt));
      this.hook.addScaledVector(this.hookVelocity, dt);
      // The cable is taut: pull the hook back onto a sphere round the anchor.
      const off = this.hook.clone().sub(anchor);
      if (off.length() > this.cableLength) this.hook.copy(anchor).addScaledVector(off.normalize(), this.cableLength);
      const floor = heightAt(this.hook.x, this.hook.z) + SLING_DROP + 0.1;
      if (this.hook.y < floor) this.hook.y = floor;
      this.hookVelocity.copy(this.hook).sub(before).divideScalar(dt);
    }

    const up = anchor.clone().sub(this.hook);
    const length = up.length();
    const dir = length > 1e-3 ? up.divideScalar(length) : UP.clone();
    this.cable.position.copy(this.hook);
    this.cable.quaternion.setFromUnitVectors(UP, dir);
    this.cable.scale.set(1, length, 1);
    // The load hangs in line with the cable and turns with the chopper.
    this.sling.root.position.copy(this.hook);
    this.sling.root.quaternion.setFromUnitVectors(UP, dir).multiply(new THREE.Quaternion().setFromAxisAngle(UP, player.yaw));
  }

  /** A trailer on a drawbar: its axle follows the hitch like a real one, cutting corners. */
  private tow(player: PlayerTank): void {
    const p = player.position;
    const hitch = p.clone().addScaledVector(player.forward, -HITCH[player.vehicle]);
    hitch.y = p.y - 0.25;
    const back = this.axle.clone().sub(hitch).setY(0);
    if (back.lengthSq() < 1e-6) back.copy(player.forward).negate().setY(0);
    const moved = this.axle.clone();
    back.normalize();
    this.axle.set(hitch.x + back.x * DRAWBAR, 0, hitch.z + back.z * DRAWBAR);
    if (Math.hypot(this.axle.x - moved.x, this.axle.z - moved.z) > SNAP_DISTANCE) {
      back.copy(player.forward).negate().setY(0).normalize();
      this.axle.set(hitch.x + back.x * DRAWBAR, 0, hitch.z + back.z * DRAWBAR);
    }
    // On the ground, unless the bike jumped and the trailer's up in the air behind it.
    this.axle.y = Math.max(heightAt(this.axle.x, this.axle.z) + WHEEL_RADIUS, hitch.y - DRAWBAR * 0.5);
    // Roll the wheels by how far the axle went forward (towards the hitch).
    const along = -back.dot(this.axle.clone().sub(moved).setY(0));
    if (Math.abs(along) < SNAP_DISTANCE) this.trailer.wheels.rotation.x -= along / WHEEL_RADIUS;
    const t = this.trailer.root;
    t.position.copy(this.axle);
    t.rotation.set(Math.asin(clamp((hitch.y - this.axle.y - 0.1) / DRAWBAR, -0.5, 0.5)), Math.atan2(back.x, back.z), 0, 'YXZ');
    this.trailer.flag.rotation.y = Math.sin(this.time * 7) * 0.25;
  }
}
