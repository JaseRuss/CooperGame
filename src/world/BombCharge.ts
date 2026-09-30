import * as THREE from 'three';

/** Seconds from a paratrooper planting the charge to it going off. */
export const BOMB_FUSE = 6;

const bodyGeometry = new THREE.BoxGeometry(0.9, 0.55, 0.6);
const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2f2a, roughness: 0.7 });
const bandGeometry = new THREE.BoxGeometry(0.94, 0.12, 0.64);
const bandMaterial = new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: 0.6 });
const lightGeometry = new THREE.SphereGeometry(0.11, 8, 6);
const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xff3a22 });

/**
 * A satchel charge stuck to a wall, blinking faster and faster as its fuse burns down. The
 * geometry and materials are shared, so there's nothing to dispose.
 */
export class BombCharge {
  readonly root = new THREE.Group();
  private readonly light: THREE.Mesh;
  private left = BOMB_FUSE;

  constructor(
    private readonly scene: THREE.Scene,
    position: THREE.Vector3,
  ) {
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    const band = new THREE.Mesh(bandGeometry, bandMaterial);
    this.light = new THREE.Mesh(lightGeometry, lightMaterial);
    body.castShadow = true;
    body.position.y = 0.28;
    band.position.y = 0.28;
    this.light.position.set(0.3, 0.68, 0);
    this.root.add(body, band, this.light);
    this.root.position.copy(position);
    scene.add(this.root);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  /** Burns the fuse down; true once it has gone off (the charge is removed). */
  update(dt: number): boolean {
    this.left -= dt;
    this.light.visible = Math.sin(this.left * (6 + (BOMB_FUSE - this.left) * 5)) > -0.2;
    if (this.left > 0) return false;
    this.scene.remove(this.root);
    return true;
  }

  /** Takes the charge away without it going off (its building is already gone). */
  remove(): void {
    this.scene.remove(this.root);
  }
}
