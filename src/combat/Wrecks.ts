import * as THREE from 'three';
import { surfaceHeightAt, waterDepthAt } from '../world/Terrain';

/**
 * Comedy knock-outs for enemy tanks. Most just blow up, but now and then:
 * - turret: the turret pops off like a champagne cork, tumbles and bounces to a stop;
 * - turtle: the whole tank flips onto its back and rocks there, stuck;
 * - surrender: the barrel droops, a white flag pops out of the hatch and the crew shouts;
 * - firework: the tank rockets into the sky, spinning, and bursts into confetti.
 */
export type WreckGag = 'turret' | 'turtle' | 'surrender' | 'firework';

/** Rolls how an enemy tank goes out: null is a plain explosion. */
export function pickWreckGag(): WreckGag | null {
  const r = Math.random();
  if (r < 0.4) return null;
  if (r < 0.65) return 'turret';
  if (r < 0.78) return 'turtle';
  if (r < 0.9) return 'surrender';
  return 'firework';
}

const GRAVITY = 22; // a touch heavier than real, so arcs read as cartoon pops
const REST_TIME = 10; // seconds a wreck lies there before sinking away
const SINK_TIME = 2;
const SQUASH_TIME = 0.35;
const SURRENDER_TIME = 7;
const FIREWORK_FUSE = 1.5;
const SHOUTS = ['WE GIVE UP!', 'OK, YOU WIN!', 'NOT FAIR!', 'WAAAH!', 'WE SURRENDER!'];

export interface WreckEffects {
  smoke: (p: THREE.Vector3) => void;
  thud: (p: THREE.Vector3) => void;
  splash: (p: THREE.Vector3) => void;
  burst: (p: THREE.Vector3) => void;
}

interface Wreck {
  kind: WreckGag;
  obj: THREE.Object3D;
  velocity: THREE.Vector3;
  axis: THREE.Vector3;
  spin: number;
  bounces: number;
  /** Seconds since it came to rest (or, for surrender and firework, since it started). */
  time: number;
  resting: boolean;
  squash: number;
  smoke: number;
  scale: THREE.Vector3;
  /** Resting orientation it rocks about (turtle). */
  restQuat?: THREE.Quaternion;
  /** Surrender props, removed and freed at the end. */
  barrel?: THREE.Object3D;
  flag?: { pole: THREE.Group; cloth: THREE.Mesh; rest: Float32Array; bubble: THREE.Sprite };
}

export class Wrecks {
  private readonly items: Wreck[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  private add(kind: WreckGag, obj: THREE.Object3D, velocity: THREE.Vector3, axis: THREE.Vector3, spin: number): Wreck {
    const w: Wreck = { kind, obj, velocity, axis, spin, bounces: 0, time: 0, resting: false, squash: 0, smoke: 0, scale: obj.scale.clone() };
    this.items.push(w);
    return w;
  }

  /** Takes the turret off its tank (keeping where it is in the world) and pops it into the air. */
  turretPop(turret: THREE.Object3D): void {
    this.scene.attach(turret);
    const kick = Math.random() * Math.PI * 2;
    this.add(
      'turret',
      turret,
      new THREE.Vector3(Math.cos(kick) * 7, 24 + Math.random() * 8, Math.sin(kick) * 7),
      new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize(),
      (7 + Math.random() * 6) * (Math.random() < 0.5 ? -1 : 1),
    );
  }

  /** Hops the whole tank up and rolls it over onto its back. */
  turtle(tank: THREE.Object3D): void {
    // Roll about the hull's own nose-to-tail axis, about half a turn during the hop.
    const along = new THREE.Vector3(0, 0, 1).applyQuaternion(tank.quaternion);
    const up = 11;
    const airTime = (2 * up) / GRAVITY;
    this.add('turtle', tank, new THREE.Vector3((Math.random() - 0.5) * 3, up, (Math.random() - 0.5) * 3), along, (Math.PI / airTime) * (Math.random() < 0.5 ? -1 : 1));
  }

  /** Droops the barrel and runs up a white flag from the hatch, with a shout. */
  surrender(tank: THREE.Object3D, turret: THREE.Object3D, barrel: THREE.Object3D): void {
    const w = this.add('surrender', tank, new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0);
    w.resting = true;
    w.barrel = barrel;

    const pole = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x8a6a42 }));
    stick.position.y = 1.2;
    pole.add(stick);
    const clothGeo = new THREE.PlaneGeometry(1.1, 0.7, 10, 3).translate(0.55, 0, 0);
    const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ color: 0xf8f8f2, side: THREE.DoubleSide, roughness: 0.9 }));
    cloth.position.y = 2.0;
    pole.add(cloth);
    pole.position.set(-0.32, -1.6, 0.12); // down inside the loader's hatch, ready to pop up
    turret.add(pole);

    const bubble = speechBubble(SHOUTS[Math.floor(Math.random() * SHOUTS.length)]);
    bubble.position.set(0, 5, 0);
    bubble.visible = false;
    tank.add(bubble);
    w.flag = { pole, cloth, rest: Float32Array.from(clothGeo.attributes.position.array as ArrayLike<number>), bubble };
  }

  /** Lights the tank up like a rocket: it spins up into the sky and bursts. */
  firework(tank: THREE.Object3D): void {
    const w = this.add('firework', tank, new THREE.Vector3(0, 4, 0), new THREE.Vector3(0, 1, 0), 14);
    w.resting = true; // steered by its own timeline rather than the bounce physics
  }

  update(dt: number, fx: WreckEffects): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const w = this.items[i];
      const done =
        w.kind === 'surrender' ? this.updateSurrender(w, dt, fx) : w.kind === 'firework' ? this.updateFirework(w, dt, fx) : this.updateTossed(w, dt, fx);
      if (done) {
        this.scene.remove(w.obj);
        if (w.flag) {
          for (const m of [w.flag.pole.children[0], w.flag.cloth] as THREE.Mesh[]) {
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
          }
          w.flag.bubble.material.map?.dispose();
          w.flag.bubble.material.dispose();
        }
        this.items.splice(i, 1);
      }
    }
  }

  /** Turret and turtle: fly, tumble, bounce, settle, lie there, sink. Returns true when gone. */
  private updateTossed(w: Wreck, dt: number, fx: WreckEffects): boolean {
    this.applySquash(w, dt);
    if (w.resting) {
      w.time += dt;
      if (w.kind === 'turtle' && w.restQuat && w.time < 4) {
        // Stuck on its back, rocking helplessly and slowly giving up.
        const rock = Math.sin(w.time * 7) * 0.28 * (1 - w.time / 4);
        w.obj.quaternion.copy(w.restQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rock));
      }
      w.smoke -= dt;
      if (w.smoke <= 0 && w.time < REST_TIME) {
        w.smoke = 0.5;
        fx.smoke(w.obj.position.clone().add(new THREE.Vector3(0, 0.6, 0)));
      }
      if (w.time > REST_TIME) w.obj.position.y -= (dt / SINK_TIME) * 3;
      return w.time > REST_TIME + SINK_TIME;
    }

    w.velocity.y -= GRAVITY * dt;
    w.obj.position.addScaledVector(w.velocity, dt);
    w.obj.rotateOnWorldAxis(w.axis, w.spin * dt);
    w.smoke -= dt;
    if (w.smoke <= 0) {
      w.smoke = 0.05;
      fx.smoke(w.obj.position.clone());
    }

    const lift = w.kind === 'turtle' ? 1.25 : 0.4; // turtle rests on its turret roof
    const ground = surfaceHeightAt(w.obj.position.x, w.obj.position.z);
    if (w.obj.position.y > ground + lift || w.velocity.y > 0) return false;

    if (waterDepthAt(w.obj.position.x, w.obj.position.z) > 0.3) {
      // Plop into a lake and glug under.
      fx.splash(w.obj.position.clone());
      w.resting = true;
      w.time = REST_TIME;
      return false;
    }

    w.obj.position.y = ground + lift;
    fx.thud(w.obj.position.clone());
    w.bounces++;
    w.squash = SQUASH_TIME;
    const settle = w.kind === 'turtle' || w.bounces >= 3 || Math.abs(w.velocity.y) < 3;
    if (!settle) {
      w.velocity.set(w.velocity.x * 0.6, -w.velocity.y * 0.45, w.velocity.z * 0.6);
      w.spin *= 0.6;
      return false;
    }

    w.resting = true;
    const yaw = new THREE.Euler().setFromQuaternion(w.obj.quaternion, 'YXZ').y;
    // Turtles always land on their backs; turrets flop either way up.
    const upsideDown = w.kind === 'turtle' || Math.random() < 0.5;
    w.restQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, upsideDown ? Math.PI : 0, 'YXZ'));
    w.obj.quaternion.copy(w.restQuat);
    if (w.kind === 'turret') w.obj.position.y = ground + (upsideDown ? 0.75 : 0.05);
    return false;
  }

  private updateSurrender(w: Wreck, dt: number, fx: WreckEffects): boolean {
    w.time += dt;
    const t = w.time;
    const ease = (a: number, b: number) => THREE.MathUtils.smoothstep(t, a, b);
    // The barrel wilts down like a sad flower...
    if (w.barrel) w.barrel.rotation.x = THREE.MathUtils.lerp(w.barrel.rotation.x, -0.45, Math.min(1, dt * 3));
    const flag = w.flag;
    if (flag) {
      // ...then the flag shoots up out of the hatch, with a little overshoot, and waves.
      const rise = ease(0.5, 1.1);
      const boing = rise < 1 ? 0 : Math.sin((t - 1.1) * 14) * Math.exp(-(t - 1.1) * 5) * 0.25;
      flag.pole.position.y = -1.6 + rise * 1.6 + boing;
      flag.pole.rotation.z = Math.sin(t * 5) * 0.25 * rise; // waved from side to side
      const pos = flag.cloth.geometry.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const x = flag.rest[k * 3];
        pos.setZ(k, flag.rest[k * 3 + 2] + Math.sin(x * 5 - t * 9) * 0.12 * x);
      }
      pos.needsUpdate = true;
      flag.bubble.visible = t > 1.0 && t < 4.5;
      if (flag.bubble.visible) flag.bubble.scale.setScalar(Math.min(1, (t - 1.0) * 6) * 1).multiply(new THREE.Vector3(5.2, 1.6, 1));
    }
    w.smoke -= dt;
    if (w.smoke <= 0 && t < SURRENDER_TIME) {
      w.smoke = 0.6;
      fx.smoke(w.obj.position.clone().add(new THREE.Vector3(0, 1, 0)));
    }
    if (t > SURRENDER_TIME) w.obj.position.y -= (dt / SINK_TIME) * 3.5;
    return t > SURRENDER_TIME + SINK_TIME;
  }

  private updateFirework(w: Wreck, dt: number, fx: WreckEffects): boolean {
    w.time += dt;
    // A fizzing wobble on the spot, then it takes off faster and faster, spinning like a top.
    if (w.time > 0.35) {
      w.velocity.y += 28 * dt;
      w.obj.position.addScaledVector(w.velocity, dt);
    } else {
      w.obj.position.x += (Math.random() - 0.5) * 0.12;
      w.obj.position.z += (Math.random() - 0.5) * 0.12;
    }
    w.spin += dt * 10;
    w.obj.rotateOnWorldAxis(w.axis, w.spin * dt);
    w.smoke -= dt;
    while (w.smoke <= 0) {
      w.smoke += 0.03;
      fx.smoke(w.obj.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, -0.8, (Math.random() - 0.5) * 1.5)));
    }
    if (w.time < FIREWORK_FUSE) return false;
    fx.burst(w.obj.position.clone());
    return true;
  }

  /** A quick squash-and-stretch on each landing. */
  private applySquash(w: Wreck, dt: number): void {
    if (w.squash <= 0) return;
    w.squash = Math.max(0, w.squash - dt);
    const k = Math.sin((1 - w.squash / SQUASH_TIME) * Math.PI) * 0.35 * (w.squash / SQUASH_TIME);
    w.obj.scale.set(w.scale.x * (1 + k), w.scale.y * (1 - k), w.scale.z * (1 + k));
    if (w.squash === 0) w.obj.scale.copy(w.scale);
  }
}

/** A white comic-book speech bubble with the crew's shout in it. */
function speechBubble(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 112, 40);
  ctx.moveTo(230, 118);
  ctx.lineTo(256, 152);
  ctx.lineTo(282, 118);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(234, 110, 44, 12); // hide the outline where the tail joins
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 64;
  do ctx.font = `900 ${size}px "Black Ops One", Impact, sans-serif`;
  while (ctx.measureText(text).width > 440 && --size > 24);
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.renderOrder = 12;
  return sprite;
}
