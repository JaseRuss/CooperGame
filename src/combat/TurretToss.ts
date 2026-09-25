import * as THREE from 'three';
import { surfaceHeightAt, waterDepthAt } from '../world/Terrain';

const GRAVITY = 22; // a touch heavier than real, so the arc reads as a cartoon pop
const LAUNCH_UP = [24, 32]; // m/s straight up, randomised: a 13-23 m pop
const LAUNCH_SIDE = 7; // m/s of random sideways kick
const SPIN = [7, 13]; // rad/s tumble
const BOUNCE = 0.45; // share of the fall speed it bounces back with
const MAX_BOUNCES = 3;
const REST_TIME = 10; // seconds it lies there before sinking away
const SINK_TIME = 2;
const SQUASH_TIME = 0.35;

interface Tossed {
  obj: THREE.Object3D;
  velocity: THREE.Vector3;
  axis: THREE.Vector3;
  spin: number;
  bounces: number;
  resting: boolean;
  restTimer: number;
  squash: number;
  smoke: number;
  /** Landed in a lake: it glugs under instead of bouncing. */
  sinking: boolean;
  scale: THREE.Vector3;
}

export interface TossEffects {
  smoke: (p: THREE.Vector3) => void;
  thud: (p: THREE.Vector3) => void;
  splash: (p: THREE.Vector3) => void;
}

/**
 * A destroyed tank's turret pops off like a champagne cork: it flies high, tumbling, trailing
 * smoke, bounces a few times with a squash on each landing, then lies there smoking before it
 * sinks out of sight.
 */
export class TurretToss {
  private readonly items: Tossed[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Takes `turret` off its tank (keeping where it is in the world) and launches it. */
  launch(turret: THREE.Object3D): void {
    this.scene.attach(turret);
    const rand = (range: number[]) => range[0] + Math.random() * (range[1] - range[0]);
    const kick = Math.random() * Math.PI * 2;
    this.items.push({
      obj: turret,
      velocity: new THREE.Vector3(Math.cos(kick) * LAUNCH_SIDE, rand(LAUNCH_UP), Math.sin(kick) * LAUNCH_SIDE),
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize(),
      spin: rand(SPIN) * (Math.random() < 0.5 ? -1 : 1),
      bounces: 0,
      resting: false,
      restTimer: 0,
      squash: 0,
      smoke: 0,
      sinking: false,
      scale: turret.scale.clone(),
    });
  }

  update(dt: number, fx: TossEffects): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const t = this.items[i];
      if (t.resting) {
        t.restTimer += dt;
        // A lazy wisp of smoke while it lies there.
        t.smoke -= dt;
        if (t.smoke <= 0 && t.restTimer < REST_TIME && !t.sinking) {
          t.smoke = 0.5;
          fx.smoke(t.obj.position.clone().add(new THREE.Vector3(0, 0.6, 0)));
        }
        if (t.restTimer > REST_TIME) t.obj.position.y -= (dt / SINK_TIME) * 2.5;
        if (t.restTimer > REST_TIME + SINK_TIME) {
          this.scene.remove(t.obj);
          this.items.splice(i, 1);
        }
        this.applySquash(t, dt);
        continue;
      }

      t.velocity.y -= GRAVITY * dt;
      t.obj.position.addScaledVector(t.velocity, dt);
      t.obj.rotateOnWorldAxis(t.axis, t.spin * dt);
      t.smoke -= dt;
      if (t.smoke <= 0) {
        t.smoke = 0.05;
        fx.smoke(t.obj.position.clone());
      }
      this.applySquash(t, dt);

      const ground = surfaceHeightAt(t.obj.position.x, t.obj.position.z);
      if (t.obj.position.y > ground + 0.4 || t.velocity.y > 0) continue;

      if (waterDepthAt(t.obj.position.x, t.obj.position.z) > 0.3) {
        // Plop into a lake and glug under.
        fx.splash(t.obj.position.clone());
        t.sinking = true;
        t.resting = true;
        t.restTimer = REST_TIME;
        continue;
      }

      t.obj.position.y = ground + 0.4;
      fx.thud(t.obj.position.clone());
      t.bounces++;
      t.squash = SQUASH_TIME;
      if (t.bounces >= MAX_BOUNCES || Math.abs(t.velocity.y) < 3) {
        // Settle: flop down flat, either the right way up or upside down.
        t.resting = true;
        const upsideDown = Math.random() < 0.5;
        const yaw = Math.random() * Math.PI * 2;
        t.obj.quaternion.setFromEuler(new THREE.Euler(upsideDown ? Math.PI : 0, yaw, 0));
        t.obj.position.y = ground + (upsideDown ? 0.75 : 0.05);
      } else {
        t.velocity.y = -t.velocity.y * BOUNCE;
        t.velocity.x *= 0.6;
        t.velocity.z *= 0.6;
        t.spin *= 0.6;
      }
    }
  }

  /** A quick squash-and-stretch on each landing. */
  private applySquash(t: Tossed, dt: number): void {
    if (t.squash <= 0) return;
    t.squash = Math.max(0, t.squash - dt);
    const k = Math.sin((1 - t.squash / SQUASH_TIME) * Math.PI) * 0.35 * (t.squash / SQUASH_TIME);
    t.obj.scale.set(t.scale.x * (1 + k), t.scale.y * (1 - k), t.scale.z * (1 + k));
    if (t.squash === 0) t.obj.scale.copy(t.scale);
  }
}
