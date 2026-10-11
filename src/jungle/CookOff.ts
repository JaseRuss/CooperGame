import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Outpost } from './Props';

/** What the cook-off needs from the game: effects, sound, and what a blast does to soldiers and trees. */
export interface CookOffHooks {
  explode(at: THREE.Vector3, size: number): void;
  boom(at: THREE.Vector3, volume: number, rate: number): void;
  shake(amount: number): void;
  /** Knocks down enemy soldiers within `radius` of `at`. */
  kill(at: THREE.Vector3, radius: number): void;
  /** Knocks trees flat within `radius` of `at`. */
  fell(at: THREE.Vector3, radius: number): void;
  /** A smoking ruin: smoke that keeps rising for `seconds`. */
  smoke(at: THREE.Vector3, radius: number, seconds: number): void;
}

interface Event {
  t: number;
  run: () => void;
}

interface Piece {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  resting: boolean;
}

const PIECE_LIFE = 9;
const MAX_PIECES = 220;
const GEO = new THREE.BoxGeometry(1, 1, 1);

/**
 * An ammunition dump going up: the big blast, a shockwave that flattens the trees, the crates
 * round it cooking off one by one, then each outbuilding in turn blown to bits and thrown about
 * as planks. Run it as a cutscene: `start`, then `update` every frame until `done`.
 */
export class CookOff {
  static readonly DURATION = 6.4;
  private events: Event[] = [];
  private pieces: Piece[] = [];
  private rings: { mesh: THREE.Mesh; age: number; life: number; to: number }[] = [];
  private t = 0;
  private running = false;
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x8b5e38, roughness: 1 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
  private readonly char = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 1 });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });

  constructor(private readonly scene: THREE.Scene, private readonly hooks: CookOffHooks, private readonly removeCollider: (c: RAPIER.Collider) => void) {}

  get done(): boolean {
    return !this.running;
  }

  start(o: Outpost): void {
    const at = o.dump.pos.clone();
    const h = this.hooks;
    this.t = 0;
    this.running = true;
    this.events = [];
    const at0 = (t: number, run: () => void) => this.events.push({ t, run });
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    // The dump itself: a fireball climbing, the roof and walls thrown out, a shockwave.
    at0(0, () => {
      h.explode(at, 4.2);
      h.boom(at, 1, 0.6);
      h.shake(1.4);
      h.kill(at, 26);
      h.fell(at, 16);
      this.ring(at, 36, 1.1);
      this.throwPieces(at.clone().setY(2), 46, 17, 11);
      h.smoke(at, 3.4, 140);
    });
    for (const [t, y, size] of [[0.14, 5, 3.4], [0.3, 8.5, 3], [0.5, 12, 2.5]] as [number, number, number][]) {
      at0(t, () => {
        h.explode(at.clone().setY(y), size);
        h.shake(0.5);
      });
    }
    at0(0.55, () => {
      h.fell(at, 28);
      this.ring(at, 52, 1.6);
    });

    // The crates round it cook off in a ripple.
    o.crates.points.forEach((p, i) => {
      const t = 0.6 + i * 0.32 + rnd(0, 0.25);
      at0(t, () => {
        h.explode(p.clone().setY(1), 2.6);
        h.boom(p, 0.6, rnd(0.9, 1.4));
        h.shake(0.3);
        this.throwPieces(p.clone().setY(1), 9, 8, 6);
      });
    });
    at0(0.6 + o.crates.points.length * 0.32 + 0.3, () => {
      for (const m of o.crates.meshes) m.visible = false;
      for (const c of o.crates.colliders) this.removeCollider(c);
    });
    // A few random pops among the rubble.
    for (let i = 0; i < 9; i++) {
      const t = rnd(1, 4.4);
      const p = at.clone().add(new THREE.Vector3(rnd(-9, 9), 0.5, rnd(-9, 9)));
      at0(t, () => {
        h.explode(p, rnd(1.4, 2.4));
        h.boom(p, 0.35, rnd(1.1, 1.8));
        this.throwPieces(p, 5, 7, 5);
      });
    }

    // The outbuildings go one after another, nearest first, as the fire reaches them.
    const huts = [...o.huts].sort((a, b) => a.center.distanceTo(at) - b.center.distanceTo(at));
    huts.forEach((hut, i) => {
      const t = 1.3 + i * 0.85 + rnd(0, 0.3);
      const c = hut.center.clone().setY(1.5);
      at0(t - 0.35, () => h.explode(c.clone().add(new THREE.Vector3(rnd(-2, 2), 1, rnd(-2, 2))), 2.4));
      at0(t, () => {
        h.explode(c, 3.4);
        h.explode(c.clone().setY(hut.height), 2.4);
        h.boom(c, 0.9, rnd(0.65, 0.85));
        h.shake(0.7);
        h.kill(c, 9);
        h.fell(c, 9);
        this.throwPieces(c, 34, 14, 10);
        hut.obj.visible = false;
        for (const col of hut.colliders) this.removeCollider(col);
        h.smoke(c, 2.2, 100);
      });
    });
    at0(CookOff.DURATION - 0.01, () => {
      this.running = false;
    });
  }

  /** `count` planks and splinters flung out from `at` and left lying about. */
  private throwPieces(at: THREE.Vector3, count: number, speed: number, up: number): void {
    for (let i = 0; i < count; i++) {
      if (this.pieces.length >= MAX_PIECES) {
        const old = this.pieces.shift() as Piece;
        old.mesh.removeFromParent();
      }
      const mesh = new THREE.Mesh(GEO, [this.wood, this.dark, this.char][Math.floor(Math.random() * 3)]);
      const long = 0.5 + Math.random() * 1.9;
      mesh.scale.set(0.12 + Math.random() * 0.2, 0.12 + Math.random() * 0.2, long);
      mesh.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2));
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pieces.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(a) * s, up * (0.5 + Math.random() * 0.7), Math.sin(a) * s),
        spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        age: 0,
        resting: false,
      });
      this.scene.add(mesh);
    }
  }

  private ring(at: THREE.Vector3, to: number, life: number): void {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), this.ringMaterial.clone());
    mesh.position.set(at.x, 0.4, at.z);
    mesh.scale.setScalar(1);
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, to });
  }

  update(dt: number): void {
    if (this.running) {
      this.t += dt;
      const due = this.events.filter((e) => e.t <= this.t);
      if (due.length) {
        this.events = this.events.filter((e) => e.t > this.t);
        for (const e of due) e.run();
      }
    }
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      if (p.age > PIECE_LIFE) {
        p.mesh.removeFromParent();
        this.pieces.splice(i, 1);
        continue;
      }
      if (p.resting) continue;
      p.vel.y -= 16 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (p.mesh.position.y < 0.1) {
        p.mesh.position.y = 0.1;
        if (p.vel.y < -3) {
          p.vel.y *= -0.3;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
          p.spin.multiplyScalar(0.5);
        } else {
          p.resting = true;
        }
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const k = Math.min(1, r.age / r.life);
      r.mesh.scale.setScalar(1 + (r.to - 1) * (1 - (1 - k) * (1 - k)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (k >= 1) {
        r.mesh.removeFromParent();
        (r.mesh.material as THREE.Material).dispose();
        r.mesh.geometry.dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}
