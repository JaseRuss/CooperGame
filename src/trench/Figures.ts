import * as THREE from 'three';
import { createFigureMesh } from '../entities/Soldier';
import { plastic, shade } from '../utils/plastic';

/** An officer's peaked cap with a bright red band, worn over the helmet so he stands out in a scope. */
export function officerCap(color: number): THREE.Group {
  const g = new THREE.Group();
  const cloth = plastic(shade(color, 0.55));
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.14, 14), cloth);
  crown.position.y = 1.93;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 14), plastic(0xd8261c));
  band.position.y = 1.84;
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.16), plastic(0x1c1c1c));
  peak.position.set(0, 1.81, -0.2);
  peak.rotation.x = 0.25;
  const badge = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), plastic(0xf2c84a));
  badge.position.set(0, 1.86, -0.205);
  g.add(crown, band, peak, badge);
  for (const m of [crown, band, peak]) m.castShadow = true;
  return g;
}

/** A medic's white helmet cover with red crosses front and back. */
export function medicHelmet(): THREE.Group {
  const g = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.SphereGeometry(0.215, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.92, 1.07), plastic(0xf2f0ea));
  cover.position.y = 1.665;
  g.add(cover);
  const red = plastic(0xd02a22);
  for (const z of [-0.21, 0.21]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.02), red);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.02), red);
    a.position.set(0, 1.76, z);
    b.position.set(0, 1.76, z);
    g.add(a, b);
  }
  return g;
}

/**
 * A stretcher-bearer: nobody shoots a medic, so he has no collider at all. He walks where he's
 * sent in straight lines (the game only sends him along a trench), kneels to patch someone up,
 * and otherwise potters about his post.
 */
export class Medic {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  yaw = 0;
  /** Where he's going, and who he's going to patch up when he gets there (null to just stand). */
  goal: THREE.Vector3 | null = null;
  kneeling = 0;
  private readonly figure: THREE.Mesh;
  private readonly kneel: THREE.BufferGeometry;
  private readonly stand: THREE.BufferGeometry;
  private readonly helmet: THREE.Group;
  private hop = Math.random() * 5;

  constructor(color: number, x: number, z: number, readonly home: THREE.Vector3, readonly span: number) {
    this.figure = createFigureMesh(0, color);
    this.stand = this.figure.geometry;
    this.kneel = createFigureMesh(1, color).geometry;
    this.helmet = medicHelmet();
    this.figure.add(this.helmet);
    this.root.add(this.figure);
    this.pos.set(x, 0, z);
    this.root.position.copy(this.pos);
  }

  /** Walks toward the goal; returns true once he's there. */
  update(dt: number, speed = 3): boolean {
    let there = true;
    if (this.goal && this.kneeling <= 0) {
      const dx = this.goal.x - this.pos.x;
      const dz = this.goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.9) {
        there = false;
        const step = Math.min(d, speed * dt);
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.yaw = Math.atan2(-dx, -dz);
        this.hop += dt * 9;
      }
    }
    this.kneeling = Math.max(0, this.kneeling - dt);
    const kneel = this.kneeling > 0;
    this.figure.geometry = kneel ? this.kneel : this.stand;
    this.helmet.position.y = kneel ? -0.35 : 0;
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.figure.position.y = !there && !kneel ? Math.abs(Math.sin(this.hop)) * 0.14 : 0;
    this.figure.rotation.y = this.yaw;
    return there;
  }
}

/** A soldier lying on his back (scenery, or the fallen man by the gap with his gas mask). */
export function fallenFigure(color: number, x: number, z: number, yaw: number): THREE.Mesh {
  const m = createFigureMesh(0, color);
  m.rotation.set(-Math.PI / 2, yaw, 0, 'YXZ');
  m.position.set(x, 0.12, z);
  return m;
}
