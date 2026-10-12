import * as THREE from 'three';
import { PartBuilder } from '../utils/modelKit';
import { plastic, ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE } from '../utils/plastic';
import { mulberry32 } from '../utils/rng';
import { createCheeringFigure } from '../entities/Soldier';
import { buildRocket } from '../world/MoonRocket';
import { dome, tube, bannerTexture, flagTexture, WHITE, STEEL } from '../world/MoonBase';
import { makeCrate } from './Buggy';
import type { MoonTerrain } from './MoonTerrain';
import { FACTIONS, BAY_RADIUS, type Faction } from './Layout';

const ARMIES = [ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE];

interface Hopper {
  mesh: THREE.Object3D;
  phase: number;
  period: number;
  height: number;
}

/** A signboard: the army's name on its colour. */
function signTexture(text: string, color: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#f4efe0';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 496, 144);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 54px "Black Ops One", Impact, sans-serif';
  ctx.fillText(text, 256, 62);
  ctx.font = '700 34px Impact, sans-serif';
  ctx.fillText('SUPPLIES', 256, 118);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The main Moon base, where the zombie mission left off: domes joined by covered walkways, the
 * rocket on its pad, the "MISSION ACCOMPLISHED" banner and a crowd still jumping for joy. In front
 * of it, a supply bay for each army: a pad with a pyramid of that army's crates and a signboard.
 */
export class MainBase {
  private readonly hoppers: Hopper[] = [];
  private readonly rings = new Map<string, THREE.Mesh>();
  private time = 0;

  constructor(scene: THREE.Scene, terrain: MoonTerrain) {
    const p = new PartBuilder();
    const steel = plastic(STEEL);
    const concrete = plastic(0x8d8a82);
    const yellow = plastic(0xe8c23f);

    dome(p, 0, -36, 16, 0);
    dome(p, -31, -52, 9, Math.PI * 0.35);
    dome(p, 33, -54, 10, -Math.PI * 0.3);
    tube(p, new THREE.Vector2(-12, -46), new THREE.Vector2(-24, -50));
    tube(p, new THREE.Vector2(13, -46), new THREE.Vector2(25, -51));
    terrain.solids.add({ x: 0, z: -36, r: 17, h: 30 });
    terrain.solids.add({ x: -31, z: -52, r: 10, h: 20 });
    terrain.solids.add({ x: 33, z: -54, r: 11, h: 20 });

    // Solar panels and a dish.
    const panel = plastic(0x1f3a78);
    for (let i = 0; i < 4; i++) {
      for (const row of [0, 1]) {
        const x = 56 + i * 7;
        const z = -34 + row * 9;
        p.add(new THREE.CylinderGeometry(0.2, 0.2, 2.4, 6), steel, x, 1.2, z);
        p.add(new THREE.BoxGeometry(6, 0.2, 4), panel, x, 2.5, z, -0.5);
        for (let k = -1; k <= 1; k++) p.add(new THREE.BoxGeometry(0.08, 0.25, 4), steel, x + k * 2, 2.55, z, -0.5);
      }
    }
    p.add(new THREE.CylinderGeometry(0.4, 0.6, 10, 10), steel, -62, 5, -38);
    p.add(new THREE.SphereGeometry(5, 24, 10, 0, Math.PI * 2, 0, Math.PI / 3), plastic(WHITE), -62, 10.5, -38, -0.9, 0.6);
    terrain.solids.add({ x: -62, z: -38, r: 1.2, h: 12 });

    // The rocket's pad, and the stage with its banner in front of the main dome.
    p.add(new THREE.CylinderGeometry(13, 13.4, 0.3, 8), concrete, -46, 0.15, -6);
    p.add(new THREE.BoxGeometry(12, 1.2, 6), plastic(0x5a5f68), 0, 0.6, -14);
    for (let i = 0; i < 3; i++) p.add(new THREE.BoxGeometry(4, 0.4, 1), plastic(0x6c717a), 0, 0.2 + i * 0.4, -10.7 - i * 0.4);
    for (const x of [-15, 15]) {
      p.add(new THREE.CylinderGeometry(0.3, 0.35, 16, 10), steel, x, 8, -18.5);
      p.add(new THREE.SphereGeometry(0.5, 10, 8), yellow, x, 16.3, -18.5);
      terrain.solids.add({ x, z: -18.5, r: 0.6, h: 16 });
    }
    p.add(new THREE.CylinderGeometry(0.12, 0.12, 30, 8).rotateZ(Math.PI / 2), steel, 0, 15, -18.5);
    terrain.solids.add({ x: 0, z: -14, r: 5.5, h: 1.4 });

    // The supply bays.
    for (const f of FACTIONS) this.buildBay(p, scene, f, terrain);
    p.buildInto(scene);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 4.6, 24, 1),
      new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.8 }),
    );
    const pos = banner.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 0.5) * 0.25 - (1 - (pos.getX(i) / 14) ** 2) * 0.6);
    banner.geometry.computeVertexNormals();
    banner.position.set(0, 12.4, -18.8);
    banner.castShadow = true;
    scene.add(banner);

    const rocket = buildRocket();
    rocket.position.set(-46, 0.3, -6);
    rocket.rotation.y = 0.5;
    scene.add(rocket);
    terrain.solids.add({ x: -46, z: -6, r: 6, h: 40 });

    // The army flag, planted beside the stage.
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5, 4, 1).translate(2, 0, 0), new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide }));
    flag.position.set(11.4, 8.6, -12);
    scene.add(flag);
    const pole = new PartBuilder();
    pole.add(new THREE.CylinderGeometry(0.1, 0.12, 10, 8), steel, 11.4, 5, -12);
    pole.buildInto(scene);

    // The party carries on in front of the stage.
    const rng = mulberry32(2468);
    for (let i = 0; i < 26; i++) {
      const mesh = createCheeringFigure(ARMIES[i % 4], true);
      mesh.position.set((rng() - 0.5) * 26, 0, -8 + rng() * 6);
      mesh.rotation.y = Math.PI + (rng() - 0.5) * 0.6;
      scene.add(mesh);
      this.hoppers.push({ mesh, phase: rng(), period: 1.5 + rng() * 1.1, height: 0.6 + rng() * 1.8 });
    }
  }

  private buildBay(p: PartBuilder, scene: THREE.Scene, f: Faction, terrain: MoonTerrain): void {
    const concrete = plastic(0x8d8a82);
    const accent = plastic(f.color);
    const white = plastic(0xf2eee2);
    const steel = plastic(STEEL);
    const { x, z } = f.bay;
    p.add(new THREE.CylinderGeometry(BAY_RADIUS, BAY_RADIUS + 0.4, 0.3, 8), concrete, x, 0.15, z);
    p.add(new THREE.TorusGeometry(BAY_RADIUS - 0.6, 0.18, 4, 8).rotateX(Math.PI / 2), accent, x, 0.34, z);
    // A pyramid of crates at the back of the pad.
    const stack = new THREE.Group();
    const rows = [[-0.5, 0.5], [0], [-1, 0, 1]];
    for (const [layer, row] of [[0, rows[2]], [1, rows[0]], [2, rows[1]]] as [number, number[]][]) {
      for (const c of row) {
        const crate = makeCrate(f.color);
        crate.position.set(c * 1.0, 0.76 + layer * 0.94, 0);
        stack.add(crate);
      }
    }
    stack.position.set(x, 0, z + BAY_RADIUS - 1.6);
    scene.add(stack);
    terrain.solids.add({ x, z: z + BAY_RADIUS - 1.6, r: 2.1, h: 3.2 });
    // The signboard on two posts, beside the stack.
    for (const dx of [-2.6, 2.6]) p.add(new THREE.CylinderGeometry(0.1, 0.12, 4.6, 6), steel, x + dx, 2.3, z + BAY_RADIUS - 0.6);
    p.add(new THREE.BoxGeometry(6, 0.12, 0.2), white, x, 4.7, z + BAY_RADIUS - 0.6);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.75), new THREE.MeshStandardMaterial({ map: signTexture(f.name.toUpperCase(), f.color), roughness: 0.7 }));
    sign.position.set(x, 3.7, z + BAY_RADIUS - 0.74);
    sign.rotation.y = Math.PI;
    scene.add(sign);
    const back = sign.clone();
    back.position.z += 0.28;
    back.rotation.y = 0;
    scene.add(back);
    // A ring on the ground that glows while this army still needs supplies.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(BAY_RADIUS - 2.2, BAY_RADIUS - 1.2, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.position.set(x, 0.42, z);
    scene.add(ring);
    this.rings.set(f.id, ring);
  }

  /** Turns an army's bay ring off once its camp is built. */
  bayDone(id: string): void {
    const ring = this.rings.get(id);
    if (ring) ring.visible = false;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (const h of this.hoppers) {
      const f = (t / h.period + h.phase) % 1;
      h.mesh.position.y = 4 * h.height * f * (1 - f);
    }
    for (const ring of this.rings.values()) (ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.4 * Math.sin(t * 3);
  }
}
