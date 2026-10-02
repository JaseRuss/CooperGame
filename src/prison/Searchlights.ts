import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SearchlightSpot } from './Facility';
import { WALLS_ONLY } from './groups';

/** The pool of light on the roof: anyone inside it (with a clear line to the lamp) is seen. */
const RADIUS = 2.5;
/** Seconds in the light before the alarm goes (the beam turns orange meanwhile). */
const GRACE = 0.35;
const WHITE = new THREE.Color(0xfff4d0);
const ORANGE = new THREE.Color(0xff8a3a);

interface Light {
  spot: SearchlightSpot;
  /** Where along its loop the beam is (0 to the loop's length, in metres). */
  along: number;
  loop: number;
  readonly aim: THREE.Vector3;
  readonly lamp: THREE.Vector3;
  readonly housing: THREE.Group;
  readonly beam: THREE.Mesh;
  readonly pool: THREE.Mesh;
  readonly light: THREE.SpotLight;
}

/** Shared, so nothing here is disposed. */
const beamGeometry = new THREE.CylinderGeometry(0.25, RADIUS, 1, 20, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
const poolGeometry = new THREE.CircleGeometry(RADIUS, 28).rotateX(-Math.PI / 2);

/**
 * The searchlights sweeping the cellhouse roof on the way out. Each beam goes round its own
 * loop; stand in its pool of light for a moment, where the lamp can see you (the clerestory and
 * the ventilators cast shadows), and you're spotted.
 */
export class Searchlights {
  readonly group = new THREE.Group();
  private readonly lights: Light[] = [];
  private active = true;
  private readonly to = new THREE.Vector3();

  constructor(private readonly world: RAPIER.World, spots: SearchlightSpot[], private readonly roofY: number) {
    for (const spot of spots) {
      const lamp = new THREE.Vector3(spot.lamp.x, spot.lamp.y, spot.lamp.z);
      const housing = new THREE.Group();
      housing.position.copy(lamp);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.7, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0 }));
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
      glass.position.z = 0.36; // (lookAt points the housing's +Z at the beam's pool)
      housing.add(can, glass);
      const beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      const pool = new THREE.Mesh(poolGeometry, new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
      const light = new THREE.SpotLight(0xfff0c8, 40, 30, 0.2, 0.5, 1.2);
      light.position.copy(lamp);
      this.group.add(housing, beam, pool, light, light.target);
      let loop = 0;
      for (let i = 0; i < spot.path.length; i++) {
        const a = spot.path[i];
        const b = spot.path[(i + 1) % spot.path.length];
        loop += Math.hypot(b.x - a.x, b.z - a.z);
      }
      this.lights.push({ spot, along: Math.random() * loop, loop, aim: new THREE.Vector3(), lamp, housing, beam, pool, light });
    }
    this.group.visible = false;
  }

  /** Turns them on (on the roof) or off (once he's down the bakery pipe). */
  setActive(on: boolean): void {
    this.active = on;
    this.group.visible = on;
  }

  /**
   * Sweeps the beams. `player` is where the player's feet are; returns how close he is to being
   * spotted (0 safe, 1 spotted: the alarm goes).
   */
  update(dt: number, player: THREE.Vector3, onRoof: boolean): number {
    if (!this.active) return 0;
    let worst = 0;
    for (const l of this.lights) {
      l.along = (l.along + l.spot.speed * dt) % l.loop;
      this.pointOnLoop(l, l.along, l.aim);
      l.aim.y = this.roofY + 0.02;
      // The beam: a cone from the lamp down to the pool on the roof.
      l.beam.position.copy(l.lamp);
      l.beam.lookAt(l.aim);
      l.beam.scale.set(1, 1, l.lamp.distanceTo(l.aim));
      l.pool.position.copy(l.aim);
      l.housing.lookAt(l.aim);
      l.light.target.position.copy(l.aim);

      const inPool = onRoof && Math.hypot(player.x - l.aim.x, player.z - l.aim.z) < RADIUS && this.seen(l.lamp, player);
      const was = l.pool.userData.seen ?? 0;
      const seen = inPool ? Math.min(1, was + dt / GRACE) : Math.max(0, was - dt * 2);
      l.pool.userData.seen = seen;
      const tint = WHITE.clone().lerp(ORANGE, seen);
      (l.pool.material as THREE.MeshBasicMaterial).color.copy(tint);
      (l.beam.material as THREE.MeshBasicMaterial).color.copy(tint);
      worst = Math.max(worst, seen);
    }
    return worst;
  }

  /** Clears every beam's "seen" (after he's been sent back). */
  reset(): void {
    for (const l of this.lights) l.pool.userData.seen = 0;
  }

  /** Can the lamp see him (chest high), or is something on the roof in the way? */
  private seen(lamp: THREE.Vector3, player: THREE.Vector3): boolean {
    this.to.copy(player).setY(player.y + 1.2).sub(lamp);
    const d = this.to.length();
    this.to.divideScalar(d);
    return !this.world.castRay(new RAPIER.Ray(lamp, this.to), d - 0.4, true, undefined, WALLS_ONLY);
  }

  private pointOnLoop(l: Light, along: number, out: THREE.Vector3): void {
    const path = l.spot.path;
    let left = along;
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (left <= len) {
        const t = left / len;
        out.set(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
        return;
      }
      left -= len;
    }
    out.set(path[0].x, 0, path[0].z);
  }
}
