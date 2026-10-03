import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PartBuilder } from '../utils/modelKit';
import { plastic } from '../utils/plastic';

const HEIGHT = 20;

/**
 * The lighthouse in the corner of the island, as at Alcatraz: a white tower on a stone base with
 * a gallery and a glazed lantern, whose two beams sweep slowly round over the sea all night
 * (pure scenery: the beams don't see anything). They fade out as the day comes up.
 */
export class Lighthouse {
  readonly group = new THREE.Group();
  private readonly beams = new THREE.Group();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private readonly lantern: THREE.Mesh;
  private lite = false;

  constructor(world: RAPIER.World, x: number, z: number) {
    this.group.position.set(x, 0, z);
    const b = new PartBuilder();
    const stone = plastic(0xb0a898);
    const white = plastic(0xeeeae0);
    const black = plastic(0x1c1e22);
    b.add(new THREE.BoxGeometry(6, 3, 6), stone, 0, 1.5, 0);
    b.add(new THREE.BoxGeometry(6.4, 0.3, 6.4), plastic(0x8a867a), 0, 3.1, 0);
    b.add(new THREE.CylinderGeometry(1.5, 2.3, HEIGHT - 3, 10), white, 0, 3 + (HEIGHT - 3) / 2, 0);
    for (const y of [8, 13]) b.add(new THREE.CylinderGeometry(1.95 - (y - 8) * 0.045, 2.0 - (y - 8) * 0.045, 1.4, 10), black, 0, y, 0);
    b.add(new THREE.CylinderGeometry(2.7, 2.7, 0.3, 14), black, 0, HEIGHT, 0);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      b.add(new THREE.BoxGeometry(0.08, 1, 0.08), black, Math.cos(a) * 2.6, HEIGHT + 0.65, Math.sin(a) * 2.6);
    }
    b.add(new THREE.CylinderGeometry(2.7, 2.7, 0.08, 14), black, 0, HEIGHT + 1.15, 0);
    b.add(new THREE.CylinderGeometry(0.15, 1.9, 1.2, 12), black, 0, HEIGHT + 3.9, 0);
    b.add(new THREE.CylinderGeometry(1.4, 1.5, 2.2, 12), black, 0, HEIGHT + 2.3, 0, 0, 0, 0, 1, 0.1, 1);
    b.buildInto(this.group);
    this.lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 12), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }));
    this.lantern.position.y = HEIGHT + 2.3;
    this.group.add(this.lantern);
    world.createCollider(RAPIER.ColliderDesc.cuboid(3, HEIGHT / 2, 3).setTranslation(x, HEIGHT / 2, z), world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
    // Two long soft beams out from the lantern, opposite each other.
    const beam = new THREE.CylinderGeometry(0.4, 14, 1, 16, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2).scale(1, 1, 320);
    for (const dir of [0, Math.PI]) {
      const m = new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(beam, m);
      mesh.rotation.y = dir;
      mesh.frustumCulled = false;
      this.beams.add(mesh);
      this.materials.push(m);
    }
    this.beams.position.y = HEIGHT + 2.3;
    this.group.add(this.beams);
  }

  /** Low graphics: no sweeping beams. */
  setLite(lite: boolean): void {
    this.lite = lite;
  }

  /** `day` is how far the dawn has got (0 night, 1 morning). */
  update(dt: number, day: number): void {
    this.beams.rotation.y += dt * 0.35;
    const on = 1 - THREE.MathUtils.smoothstep(day, 0.25, 0.8);
    for (const m of this.materials) m.opacity = 0.045 * on;
    this.beams.visible = on > 0.01 && !this.lite;
    (this.lantern.material as THREE.MeshBasicMaterial).color.set(on > 0.3 ? 0xfff0b0 : 0xb8b4a0);
  }
}
