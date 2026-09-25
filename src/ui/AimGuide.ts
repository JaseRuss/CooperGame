import * as THREE from 'three';
import type { Trajectory } from '../combat/Projectile';

export type AimTarget = 'enemy' | 'building' | 'ground' | 'none';

const DOT_SPACING = 6; // meters of arc between dots
const TICK_EVERY = 50; // meters of ground range between bigger range ticks
const MAX_DOTS = 200;
const DOT_SCREEN_SIZE = 0.0032; // world radius per meter of camera distance
const NEAR_CAMERA_SKIP = 7;

const TARGET_COLORS: Record<AimTarget, number> = {
  enemy: 0xff5a4a,
  building: 0xffa040,
  ground: 0xffffff,
  none: 0xffffff,
};

/** In-world aiming aid: dotted shell arc with range ticks, plus a ring where the shell lands. */
export class AimGuide {
  private readonly dots: THREE.InstancedMesh;
  private readonly ring: THREE.Group;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tickColor = new THREE.Color(0xffb347);
  private readonly dotColor = new THREE.Color(0xfff2b0);

  constructor(scene: THREE.Scene) {
    const dotMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), dotMaterial, MAX_DOTS);
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 5;
    this.dots.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DOTS * 3), 3);
    scene.add(this.dots);

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.ring = new THREE.Group();
    this.ring.add(new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), this.ringMaterial));
    this.ring.add(new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 24), this.ringMaterial));
    // Four tick marks around the ring, like a gunsight.
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.35), this.ringMaterial);
      const a = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0);
      tick.rotation.z = a + Math.PI / 2;
      this.ring.add(tick);
    }
    this.ring.renderOrder = 6;
    scene.add(this.ring);
  }

  setVisible(visible: boolean): void {
    this.dots.visible = visible;
    if (!visible) this.ring.visible = false;
  }

  update(traj: Trajectory, target: AimTarget, camera: THREE.Camera): void {
    this.dots.visible = true;
    const camPos = camera.position;
    const origin = traj.points[0];
    let count = 0;
    let carried = 0;
    let nextTick = TICK_EVERY;

    for (let i = 1; i < traj.points.length && count < MAX_DOTS; i++) {
      const a = traj.points[i - 1];
      const b = traj.points[i];
      const segLen = a.distanceTo(b);
      let t = DOT_SPACING - carried;
      while (t <= segLen && count < MAX_DOTS) {
        const p = a.clone().lerp(b, t / segLen);
        const camDist = p.distanceTo(camPos);
        if (camDist > NEAR_CAMERA_SKIP) {
          const ground = Math.hypot(p.x - origin.x, p.z - origin.z);
          const isTick = ground >= nextTick;
          if (isTick) nextTick = (Math.floor(ground / TICK_EVERY) + 1) * TICK_EVERY;
          const r = camDist * DOT_SCREEN_SIZE * (isTick ? 2.2 : 1);
          this.tmpMatrix.compose(p, this.tmpQuat.identity(), this.tmpScale.set(r, r, r));
          this.dots.setMatrixAt(count, this.tmpMatrix);
          this.dots.setColorAt(count, isTick ? this.tickColor : this.dotColor);
          count++;
        }
        t += DOT_SPACING;
      }
      carried = segLen - (t - DOT_SPACING);
    }
    this.dots.count = count;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;

    if (traj.normal) {
      this.ring.visible = true;
      const n = traj.normal;
      this.ring.position.copy(traj.impact).addScaledVector(n, 0.15);
      this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      this.ring.scale.setScalar(Math.max(1.4, traj.impact.distanceTo(camPos) * 0.022));
      this.ringMaterial.color.setHex(TARGET_COLORS[target]);
    } else {
      this.ring.visible = false;
    }
  }
}
