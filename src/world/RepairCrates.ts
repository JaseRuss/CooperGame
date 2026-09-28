import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade, ARMY_GREEN, ARMY_RED } from '../utils/plastic';
import { surfaceHeightAt, waterDepthAt } from './Terrain';

/** Hull points a crate puts back. */
export const REPAIR_AMOUNT = 25;
const LIFETIME = 30;
/** It blinks for this long before it goes, so the player can see it's about to. */
const BLINK_TIME = 5;
/** Most crates lying about at once; a new one pushes out the oldest. */
const MAX_CRATES = 6;
/** Drive within this far of a crate (metres, across the ground) to pick it up. */
const PICKUP_RADIUS = 6;
/** The chopper can scoop one up from a little further, as long as it's flying low over it. */
const CHOPPER_PICKUP_RADIUS = 12;
const CHOPPER_PICKUP_HEIGHT = 10;
const GRAVITY = -14;
/** How high the crate floats (and bobs) over the ground once it has landed. */
const HOVER = 0.45;
const SIZE = 1.6;

interface Crate {
  root: THREE.Group;
  body: THREE.Group;
  velocityY: number;
  restY: number;
  landed: boolean;
  age: number;
}

/** The player, as far as the crates care. */
export interface CrateCollector {
  position: THREE.Vector3;
  health: number;
  maxHealth: number;
  isChopper: boolean;
  heightAboveGround: number;
}

let shared: { crate: Map<THREE.Material, THREE.BufferGeometry>; ring: THREE.BufferGeometry; beam: THREE.BufferGeometry } | null = null;
const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const beamMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false });

/** A green plastic supply crate with a white panel and red cross on each side and the lid. */
function crateGeometries(): NonNullable<typeof shared> {
  if (shared) return shared;
  const b = new PartBuilder();
  const green = plastic(shade(ARMY_GREEN, 1.12));
  const trim = plastic(shade(ARMY_GREEN, 0.7));
  const white = plastic(0xf4f1e4);
  const red = plastic(ARMY_RED);
  const h = SIZE / 2;
  b.add(new THREE.BoxGeometry(SIZE, SIZE, SIZE), green, 0, h, 0);
  // Corner posts and a rim round the top and bottom.
  const post = new THREE.BoxGeometry(0.16, SIZE + 0.04, 0.16);
  for (const x of [-h, h]) for (const z of [-h, h]) b.add(post, trim, x, h, z);
  const rim = new THREE.BoxGeometry(SIZE + 0.1, 0.14, 0.14);
  for (const y of [0.07, SIZE - 0.07]) {
    for (const s of [-h, h]) {
      b.add(rim, trim, 0, y, s);
      b.add(rim, trim, s, y, 0, 0, Math.PI / 2);
    }
  }
  // A white panel with a red cross on each side, facing out, and one on the lid.
  const panel = new THREE.BoxGeometry(1.0, 1.0, 0.04);
  const bar = new THREE.BoxGeometry(0.66, 0.2, 0.05);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const out = h + 0.02;
    const x = Math.sin(a) * out;
    const z = Math.cos(a) * out;
    b.add(panel, white, x, h, z, 0, a);
    b.add(bar, red, x * 1.02, h, z * 1.02, 0, a);
    b.add(bar, red, x * 1.02, h, z * 1.02, 0, a, Math.PI / 2);
  }
  b.add(panel, white, 0, SIZE + 0.02, 0, -Math.PI / 2);
  b.add(bar, red, 0, SIZE + 0.04, 0, -Math.PI / 2);
  b.add(bar, red, 0, SIZE + 0.04, 0, -Math.PI / 2, 0, Math.PI / 2);
  shared = {
    crate: b.buildGeometries(),
    ring: new THREE.RingGeometry(1.7, 2.1, 40).rotateX(-Math.PI / 2),
    // A soft column of light so a crate can be spotted from a way off.
    beam: new THREE.CylinderGeometry(0.45, 0.45, 16, 12, 1, true).translate(0, 8, 0),
  };
  return shared;
}

/**
 * Repair crates dropped by knocked-out enemies. Drive over one (or fly low over it in the chopper)
 * while the hull is damaged and it patches the hull up; otherwise it waits there a while for when
 * it's needed. The geometry and materials are built once and shared, so there's nothing to dispose.
 */
export class RepairCrates {
  private readonly crates: Crate[] = [];
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {}

  /** Drops a crate from `from` (a wreck, or a helicopter falling out of the sky); it falls to the ground. */
  drop(from: THREE.Vector3): void {
    const geo = crateGeometries();
    const root = new THREE.Group();
    const body = new THREE.Group();
    for (const [mat, g] of geo.crate) {
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      body.add(mesh);
    }
    body.rotation.y = Math.random() * Math.PI * 2;
    const ring = new THREE.Mesh(geo.ring, ringMaterial);
    const beam = new THREE.Mesh(geo.beam, beamMaterial);
    ring.visible = beam.visible = false; // until it lands
    root.add(body, ring, beam);
    root.position.copy(from);
    // It floats on a lake.
    const restY = surfaceHeightAt(from.x, from.z) + waterDepthAt(from.x, from.z);
    this.scene.add(root);
    // A little hop up out of the wreck first.
    this.crates.push({ root, body, velocityY: 6, restY, landed: false, age: 0 });
    while (this.crates.length > MAX_CRATES) this.remove(0);
  }

  /** Moves the crates along; returns how many the player picked up this frame. */
  update(dt: number, player: CrateCollector): number {
    this.time += dt;
    ringMaterial.opacity = 0.45 + 0.25 * Math.sin(this.time * 4);
    let collected = 0;
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.age += dt;
      c.body.rotation.y += dt * 1.2;
      if (!c.landed) {
        c.velocityY += GRAVITY * dt;
        c.root.position.y += c.velocityY * dt;
        if (c.velocityY < 0 && c.root.position.y <= c.restY + HOVER) {
          c.landed = true;
          c.root.position.y = c.restY + HOVER;
          for (const child of c.root.children) child.visible = true;
        }
      } else {
        c.body.position.y = Math.sin(this.time * 2.5 + i) * 0.2;
        // The ring and beam sit on the ground under the bobbing crate.
        for (const child of c.root.children) if (child !== c.body) child.position.y = -HOVER + 0.05;
      }
      // Blinks faster and faster as it's about to go.
      const left = LIFETIME - c.age;
      if (left < BLINK_TIME) c.root.visible = Math.sin(c.age * (8 + (BLINK_TIME - left) * 4)) > -0.3;
      if (left <= 0) {
        this.remove(i);
        continue;
      }
      if (c.landed && player.health < player.maxHealth && this.within(c, player)) {
        this.remove(i);
        collected++;
      }
    }
    return collected;
  }

  private within(c: Crate, player: CrateCollector): boolean {
    const p = c.root.position;
    const across = Math.hypot(player.position.x - p.x, player.position.z - p.z);
    if (player.isChopper && player.heightAboveGround > 2) {
      return across < CHOPPER_PICKUP_RADIUS && player.position.y - p.y < CHOPPER_PICKUP_HEIGHT;
    }
    return across < PICKUP_RADIUS && Math.abs(player.position.y - p.y) < 4;
  }

  private remove(i: number): void {
    this.scene.remove(this.crates[i].root);
    this.crates.splice(i, 1);
  }
}
