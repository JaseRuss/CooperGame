import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CameraMode } from '../camera/CameraRig';
import type { PlayerSoldier } from './PlayerSoldier';

/** Over the right shoulder: the pivot is this far up and to the right of his feet, the camera this far behind it. */
const PIVOT_UP = 1.75;
const PIVOT_RIGHT = 1;
const BACK = 4;
/** Keep this far off a wall the camera has been pulled in against. */
const WALL_GAP = 0.25;
const EYE_HEIGHT = 1.6;
/** How fast the camera catches back up after a wall stops blocking it (it snaps in instantly). */
const RELEASE_LAMBDA = 6;

/**
 * The on-foot camera: over the player's shoulder, looking down the aim, pulled in when a wall or
 * ceiling is in the way (indoors that's most of the time). First person sits at his eyes.
 */
export class ShoulderCam {
  mode: CameraMode = 'third';
  private distance = BACK;
  private readonly pivot = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private shake = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly world: RAPIER.World) {}

  toggle(): void {
    this.mode = this.mode === 'third' ? 'first' : 'third';
  }

  addShake(amount: number): void {
    this.shake = Math.min(0.6, this.shake + amount);
  }

  /** Which way the camera is looking (the crosshair is the middle of the screen). */
  aimDirection(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }

  update(player: PlayerSoldier, dt: number): void {
    const p = player.position;
    const cp = Math.cos(player.pitch);
    this.dir.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp);
    this.right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));

    if (this.mode === 'first' && !player.isDown) {
      player.setVisible(false);
      this.camera.position.set(p.x, p.y + EYE_HEIGHT, p.z).addScaledVector(this.dir, 0.25);
    } else {
      player.setVisible(true);
      // Shuffle the pivot in toward his head if he's standing with a wall on his right.
      this.pivot.set(p.x, p.y + PIVOT_UP, p.z);
      const side = this.world.castRay(new RAPIER.Ray(this.pivot, this.right), PIVOT_RIGHT + WALL_GAP, true, undefined, undefined, player.collider);
      this.pivot.addScaledVector(this.right, side ? Math.max(0, side.timeOfImpact - WALL_GAP) : PIVOT_RIGHT);
      // Lying down: pull back and up so he's in the shot.
      const want = player.isDown ? BACK + 2 : BACK;
      const back = this.dir.clone().negate();
      if (player.isDown) back.y += 0.6;
      back.normalize();
      // Anything between the pivot and where the camera wants to be pulls it in.
      const ray = new RAPIER.Ray(this.pivot, back);
      const hit = this.world.castRay(ray, want, true, undefined, undefined, player.collider);
      const limit = hit ? Math.max(0.3, hit.timeOfImpact - WALL_GAP) : want;
      this.distance = limit < this.distance ? limit : this.distance + (limit - this.distance) * (1 - Math.exp(-RELEASE_LAMBDA * dt));
      this.camera.position.copy(this.pivot).addScaledVector(back, this.distance);
    }
    this.look.copy(this.camera.position).addScaledVector(this.dir, 30);
    this.camera.lookAt(this.look);
    if (this.shake > 0) {
      this.camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.05;
      this.camera.rotation.y += (Math.random() - 0.5) * this.shake * 0.05;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
  }
}
