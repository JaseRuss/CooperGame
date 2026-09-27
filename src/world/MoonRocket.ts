import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PartBuilder } from '../utils/modelKit';
import { plastic, ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE } from '../utils/plastic';

// The zombie mission's way out: a big toy moon rocket on a launch pad in the middle of the
// Fortress. It stands there all mission; when it's ready, searchlight beams mark it from anywhere
// on the map, and when it goes it lifts off on a column of fire and smoke.

/** Nose tip height of the rocket, standing on its fins. */
export const ROCKET_HEIGHT = 36;
const BODY_RADIUS = 3.5;
const PAD_RADIUS = 14;
const GANTRY_X = 9.5;
const GANTRY_HEIGHT = 31;
/** Engine bell mouth, above the fin bottoms. */
const NOZZLE_Y = 0.7;

const WHITE = 0xf1ede2;
const RED = 0xd8392b;
const DARK = 0x3a3e46;
const STEEL = 0x9aa0a8;
const CONCRETE = 0x8d8a82;
/** Seconds from ignition to leaving the pad. */
const IGNITION_TIME = 1.6;
const SMOKE_POOL = 300;
/** The pad is a thin slab (it has no collider, so tanks just roll over it). */
const PAD_TOP = 0.3;

let glowTexture: THREE.CanvasTexture | null = null;

/** A soft round blob, for smoke puffs, the beacon and the searchlight glow. */
function softTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

/** A turned (lathe) band of the rocket's body from [radius, height] points, bottom to top. */
function lathe(points: [number, number][], segments = 40): THREE.BufferGeometry {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** A five-pointed star in the XY plane, `r` to its points, `depth` thick toward +Z. */
function starGeometry(r: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.42;
    if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}

/**
 * A big retro toy moon rocket moulded in plastic, standing on its fins with the origin at the fin
 * bottoms: white body with a stripe for each of the four armies, a red nose cone, four swept red
 * fins, lit portholes, a hatch, a star and an engine bell. About 7 m across the body and 36 m tall.
 */
export function buildRocket(): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const white = plastic(WHITE);
  const red = plastic(RED);
  const dark = plastic(DARK);
  const steel = plastic(STEEL);
  // Cabin windows glow warm, as if the crew's lights are on.
  const glass = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffc860, emissiveIntensity: 1.1, roughness: 0.2 });

  // Engine bell and boat tail.
  p.add(lathe([[2.2, NOZZLE_Y], [1.9, 1.4], [1.45, 2.2], [1.3, 2.6]]), dark);
  p.add(new THREE.CircleGeometry(2.1, 24).rotateX(Math.PI / 2), plastic(0x1c1e22), 0, NOZZLE_Y + 0.25, 0);
  p.add(lathe([[1.3, 2.5], [2.4, 2.8], [2.95, 3.4], [3.2, 4]]), steel);
  // The body, in bands: white, the four army stripes, white again with the cabin, then the nose.
  p.add(lathe([[3.2, 4], [3.42, 6], [BODY_RADIUS, 9], [BODY_RADIUS, 12]]), white);
  [ARMY_GREEN, ARMY_RED, ARMY_TAN, ARMY_BLUE].forEach((color, i) => {
    const y = 12 + i * 0.75;
    p.add(lathe([[BODY_RADIUS + 0.04, y], [BODY_RADIUS + 0.04, y + 0.75]]), plastic(color));
  });
  p.add(lathe([[BODY_RADIUS, 15], [BODY_RADIUS, 22], [3.4, 24.5], [3.25, 26]]), white);
  p.add(lathe([[3.3, 25.9], [3.3, 26.6]]), red); // collar
  p.add(lathe([[3.25, 26.5], [2.95, 28.5], [2.4, 30.8], [1.6, 32.8], [0.8, 34.4], [0.22, 35.4], [0, 35.6]]), red);
  p.add(new THREE.CylinderGeometry(0.06, 0.1, 1.6, 6), steel, 0, 36.2, 0); // aerial on the tip
  p.add(new THREE.SphereGeometry(0.16, 8, 6), red, 0, 37, 0);

  // Four swept fins between the stripes and the ground, set at the diagonals.
  const fin = new THREE.Shape();
  fin.moveTo(2.9, 13);
  fin.lineTo(3.3, 13);
  fin.bezierCurveTo(5.4, 9, 7.2, 6, 7.6, 0);
  fin.lineTo(5.6, 0);
  fin.bezierCurveTo(5.2, 2.2, 4.2, 3.4, 3.0, 3.8);
  fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 }).translate(0, 0, -0.25);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    p.add(finGeo, red, 0, 0, 0, 0, a);
    p.add(new THREE.CylinderGeometry(0.28, 0.4, 0.5, 10), dark, Math.cos(a) * 6.6, 0.25, -Math.sin(a) * 6.6); // foot pad
  }

  // Portholes up the front and one on each side, with steel rims.
  const rim = new THREE.TorusGeometry(0.85, 0.16, 8, 20);
  const pane = new THREE.CircleGeometry(0.85, 20);
  for (const [a, y] of [[0, 21.8], [0, 18.8], [Math.PI / 2, 20.3], [-Math.PI / 2, 20.3]] as [number, number][]) {
    const x = Math.sin(a) * (BODY_RADIUS + 0.02);
    const z = Math.cos(a) * (BODY_RADIUS + 0.02);
    p.add(rim, steel, x, y, z, 0, a);
    p.add(pane, glass, x * 0.998, y, z * 0.998, 0, a);
  }
  // The crew hatch, facing the gantry (+X), and a big white star on blue at the front.
  p.add(new THREE.BoxGeometry(0.25, 3.4, 2.2), steel, BODY_RADIUS - 0.02, 7.6, 0);
  p.add(new THREE.BoxGeometry(0.3, 2.9, 1.7), white, BODY_RADIUS + 0.02, 7.6, 0);
  p.add(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8).rotateZ(Math.PI / 2), dark, BODY_RADIUS + 0.2, 7.4, 0.55);
  p.add(new THREE.CircleGeometry(1.9, 28), plastic(ARMY_BLUE), 0, 8, BODY_RADIUS + 0.03);
  p.add(starGeometry(1.6, 0.08), white, 0, 7.95, BODY_RADIUS + 0.04);
  p.buildInto(g);
  return g;
}

/** The launch tower: a red-and-white lattice with a crew walkway, and the swing arm to the hatch. */
function buildGantry(): { tower: THREE.Group; arm: THREE.Group } {
  const tower = new THREE.Group();
  const p = new PartBuilder();
  const red = plastic(RED);
  const white = plastic(WHITE);
  const steel = plastic(STEEL);
  const half = 2.2;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const x of [-half, half]) for (const z of [-half, half]) p.beam(v(x, 0, z), v(x, GANTRY_HEIGHT, z), 0.45, red);
  for (let y = 0; y < GANTRY_HEIGHT; y += 3.5) {
    const mat = Math.round(y / 3.5) % 2 === 0 ? red : white;
    for (const [a, b] of [[v(-half, y, -half), v(half, y, -half)], [v(-half, y, half), v(half, y, half)], [v(-half, y, -half), v(-half, y, half)], [v(half, y, -half), v(half, y, half)]]) {
      p.beam(a, b, 0.3, mat);
      p.beam(a, b.clone().setY(y + 3.5), 0.18, steel); // cross-bracing
    }
  }
  p.add(new THREE.BoxGeometry(5.4, 0.4, 5.4), steel, 0, GANTRY_HEIGHT, 0);
  p.add(new THREE.CylinderGeometry(0.12, 0.12, 5, 6), steel, 0, GANTRY_HEIGHT + 2.5, 0); // lightning rod
  p.buildInto(tower);

  // The arm hinges at the tower's rocket-side face and reaches across to the hatch.
  const arm = new THREE.Group();
  const a = new PartBuilder();
  a.add(new THREE.BoxGeometry(GANTRY_X - BODY_RADIUS - 0.6, 0.4, 2), white, -(GANTRY_X - BODY_RADIUS - 0.6) / 2, 0, 0);
  a.add(new THREE.BoxGeometry(GANTRY_X - BODY_RADIUS - 0.6, 1.1, 0.12), red, -(GANTRY_X - BODY_RADIUS - 0.6) / 2, 0.75, -0.95); // hand rails
  a.add(new THREE.BoxGeometry(GANTRY_X - BODY_RADIUS - 0.6, 1.1, 0.12), red, -(GANTRY_X - BODY_RADIUS - 0.6) / 2, 0.75, 0.95);
  a.buildInto(arm);
  arm.position.set(-half, 6.1, 0);
  tower.add(arm);
  return { tower, arm };
}

/** The pad: an octagonal concrete apron with a hazard ring, a flame trench and four floodlights. */
function buildPad(): THREE.Group {
  const g = new THREE.Group();
  const p = new PartBuilder();
  const concrete = plastic(CONCRETE);
  const yellow = plastic(0xe8c23f);
  const black = plastic(0x222428);
  const steel = plastic(STEEL);
  p.add(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.6, PAD_TOP, 8), concrete, 0, PAD_TOP / 2, 0, 0, Math.PI / 8);
  // Hazard ring: yellow and black blocks round the edge.
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    p.add(new THREE.BoxGeometry(2.4, 0.08, 0.7), i % 2 ? yellow : black, Math.cos(a) * (PAD_RADIUS - 1.4), PAD_TOP + 0.02, Math.sin(a) * (PAD_RADIUS - 1.4), 0, -a + Math.PI / 2);
  }
  p.add(new THREE.BoxGeometry(4.4, 0.06, PAD_RADIUS * 2 - 4), black, 0, PAD_TOP + 0.02, 0); // flame trench
  // Floodlights on the diagonals, pointing in at the rocket.
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xfff0c0, emissiveIntensity: 1.4 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2 + 0.3;
    const r = PAD_RADIUS - 0.8;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    p.add(new THREE.CylinderGeometry(0.15, 0.2, 7, 8), steel, x, 3.5, z);
    p.add(new THREE.BoxGeometry(1.4, 0.9, 0.5), black, x * 0.97, 7.2, z * 0.97, 0.5, -a - Math.PI / 2);
    p.add(new THREE.BoxGeometry(1.2, 0.7, 0.1), lamp, x * 0.95, 7.1, z * 0.95, 0.5, -a - Math.PI / 2);
  }
  p.buildInto(g);
  return g;
}

interface Puff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  from: number;
  to: number;
  hot: number;
}

/**
 * The zombie mission's launch pad in the middle of the Fortress, with its rocket and gantry. The
 * rocket blocks tanks until it goes; `launch` counts down, lights the engine and sends it up.
 */
export class LaunchPad {
  readonly position: THREE.Vector3;
  readonly rocket: THREE.Group;
  /** How high the rocket has climbed off the pad. */
  altitude = 0;
  private speed = 0;
  private phase: 'waiting' | 'ready' | 'countdown' | 'burning' | 'flying' | 'gone' = 'waiting';
  private clock = 0;
  private readonly root = new THREE.Group();
  private readonly arm: THREE.Group;
  private readonly flame = new THREE.Group();
  private readonly flameLight: THREE.PointLight;
  private readonly beacon: THREE.Sprite;
  private readonly beams: THREE.Mesh[] = [];
  private rocketBody: RAPIER.RigidBody | null;
  private readonly puffs: Puff[] = [];
  private nextPuff = 0;
  private puffTimer = 0;

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) {
    this.position = new THREE.Vector3(x, y, z);
    this.root.position.copy(this.position);
    this.root.rotation.y = yaw;
    scene.add(this.root);
    this.root.add(buildPad());
    this.rocket = buildRocket();
    this.rocket.position.y = PAD_TOP;
    this.root.add(this.rocket);
    const { tower, arm } = buildGantry();
    tower.position.set(GANTRY_X + 2.2, PAD_TOP, 0);
    this.root.add(tower);
    this.arm = arm;

    // The pad is lit up so the rocket stands out at night.
    const lamp = new THREE.PointLight(0xfff0d0, 250, 80, 2);
    lamp.position.set(-6, 14, 8);
    this.root.add(lamp);

    // The engine: two additive cones of flame and an orange light, off until ignition.
    const flameMat = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const outer = new THREE.Mesh(new THREE.ConeGeometry(2.3, 16, 20, 1, true).rotateX(Math.PI).translate(0, -8, 0), flameMat(0xff7a1c, 0.75));
    const inner = new THREE.Mesh(new THREE.ConeGeometry(1.3, 9, 16, 1, true).rotateX(Math.PI).translate(0, -4.5, 0), flameMat(0xfff0a8, 0.95));
    this.flame.add(outer, inner);
    this.flame.position.y = NOZZLE_Y;
    this.flame.visible = false;
    this.rocket.add(this.flame);
    this.flameLight = new THREE.PointLight(0xff8a30, 0, 400, 2);
    this.flameLight.position.y = -3;
    this.rocket.add(this.flameLight);

    // A red beacon blinking on the nose, which shows from a long way off.
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0xff4030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.beacon.scale.setScalar(5);
    this.beacon.position.y = 37.2;
    this.rocket.add(this.beacon);

    // Two searchlight beams for when it's time to go: "the rocket's here!" from anywhere on the map.
    const beamGeo = new THREE.CylinderGeometry(9, 0.8, 520, 20, 1, true).translate(0, 260, 0);
    for (let i = 0; i < 2; i++) {
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      beam.position.set(i ? -7 : 7, 1, i ? 7 : -7);
      beam.visible = false;
      this.root.add(beam);
      this.beams.push(beam);
    }

    // Tanks can't drive through the rocket or the tower.
    this.rocketBody = this.solid(0, 12, 0, 6.2, 12, 6.2, yaw);
    const t = new THREE.Vector3(GANTRY_X + 2.2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.solid(t.x, GANTRY_HEIGHT / 2, t.z, 2.5, GANTRY_HEIGHT / 2, 2.5, yaw);
    this.root.updateMatrixWorld(true);
  }

  /** The nose tip, in the world. */
  get tip(): THREE.Vector3 {
    return this.rocket.localToWorld(new THREE.Vector3(0, ROCKET_HEIGHT, 0));
  }

  /** The middle of the rocket, in the world (where the cameras look). */
  get middle(): THREE.Vector3 {
    return this.rocket.localToWorld(new THREE.Vector3(0, ROCKET_HEIGHT * 0.45, 0));
  }

  get launched(): boolean {
    return this.phase === 'countdown' || this.phase === 'burning' || this.phase === 'flying' || this.phase === 'gone';
  }

  /** The engine's lit (on the pad or climbing). */
  get burning(): boolean {
    return this.phase === 'burning' || this.phase === 'flying';
  }

  /** Off the pad and climbing. */
  get flying(): boolean {
    return this.phase === 'flying' || this.phase === 'gone';
  }

  /** Time to go: the searchlights come on and the beacon blinks fast. */
  setReady(): void {
    if (this.phase === 'waiting') this.phase = 'ready';
  }

  /** Counts down `delay` seconds, lights the engine and lifts off. */
  launch(delay: number): void {
    if (this.launched) return;
    this.phase = 'countdown';
    this.clock = -delay;
  }

  /** Returns 'ignition' on the frame the engine lights and 'liftoff' on the frame it leaves the pad. */
  update(dt: number): 'ignition' | 'liftoff' | null {
    let event: 'ignition' | 'liftoff' | null = null;
    this.clock += dt;
    const ready = this.phase !== 'waiting';
    const blink = ready ? 2.2 : 0.8;
    const on = (this.clock * blink) % 1 < 0.35;
    (this.beacon.material as THREE.SpriteMaterial).opacity = on ? 1 : 0.15;
    for (const [i, beam] of this.beams.entries()) {
      beam.visible = ready && this.phase !== 'gone';
      beam.rotation.set(0.28 * Math.sin(this.clock * 0.5 + i * 2), 0, 0.28 * Math.cos(this.clock * 0.4 + i * 1.3));
    }

    if (this.phase === 'countdown') {
      // The arm swings clear during the countdown.
      this.arm.rotation.y = Math.min(1, (this.clock + 3) / 3) * -1.35;
      if (this.clock >= 0) {
        this.phase = 'burning';
        this.clock = 0;
        this.flame.visible = true;
        event = 'ignition';
      }
    }
    if (this.phase === 'burning' || this.phase === 'flying') {
      const flicker = 0.85 + Math.random() * 0.3;
      const spool = Math.min(1, this.clock / IGNITION_TIME);
      this.flame.scale.set(flicker * (0.6 + 0.4 * spool), (0.4 + 0.8 * spool) * (0.9 + Math.random() * 0.25), flicker * (0.6 + 0.4 * spool));
      this.flameLight.intensity = 20000 * spool * flicker;
    }
    if (this.phase === 'burning' && this.clock >= IGNITION_TIME) {
      this.phase = 'flying';
      if (this.rocketBody) this.world.removeRigidBody(this.rocketBody);
      this.rocketBody = null;
      event = 'liftoff';
    }
    if (this.phase === 'flying') {
      this.speed += (4 + Math.min(10, this.altitude / 25)) * dt;
      this.altitude += this.speed * dt;
      this.rocket.position.y = PAD_TOP + this.altitude;
      // A gentle roll over onto its course once it's clear of the tower.
      this.rocket.rotation.z = Math.min(0.3, Math.max(0, (this.altitude - 90) / 900));
      if (this.altitude > 5000) {
        this.phase = 'gone';
        this.rocket.visible = false;
        this.flameLight.intensity = 0;
      }
    }
    this.updateSmoke(dt);
    this.rocket.updateMatrixWorld(true);
    return event;
  }

  /** Billowing smoke: out along the ground while the engine lights, then a column behind the rocket. */
  private updateSmoke(dt: number): void {
    if (this.phase === 'burning' || (this.phase === 'flying' && this.altitude < 1500)) {
      this.puffTimer -= dt;
      while (this.puffTimer <= 0) {
        this.puffTimer += this.phase === 'burning' || this.altitude < 40 ? 0.018 : 0.035;
        const nozzle = this.rocket.localToWorld(new THREE.Vector3(0, NOZZLE_Y - 1, 0));
        if (this.altitude < 25) {
          // Rolling out sideways along the ground from the pad.
          const a = Math.random() * Math.PI * 2;
          const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          const at = this.position.clone().addScaledVector(out, 3).setY(this.position.y + 1.5);
          this.puff(at, out.multiplyScalar(12 + Math.random() * 10).setY(1 + Math.random() * 2), 3, 13 + Math.random() * 6, 4 + Math.random() * 2);
        } else {
          const spread = new THREE.Vector3(Math.random() - 0.5, -1.5, Math.random() - 0.5).multiplyScalar(2.5);
          this.puff(nozzle.add(new THREE.Vector3(0, -2, 0)), spread, 2.5, 9 + Math.random() * 4, 3 + Math.random() * 2);
        }
      }
    }
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.sprite.visible = false;
        continue;
      }
      p.velocity.multiplyScalar(Math.exp(-1.2 * dt));
      p.velocity.y += 0.6 * dt; // warm smoke drifts up
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.sprite.scale.setScalar(p.from + (p.to - p.from) * (1 - (1 - t) * (1 - t)));
      const mat = p.sprite.material as THREE.SpriteMaterial;
      mat.opacity = 0.75 * Math.min(1, t * 6) * (1 - t);
      // Lit orange by the flame at first, then grey.
      const hot = Math.max(0, p.hot - p.age * 1.5);
      mat.color.setRGB(0.55 + 0.45 * hot, 0.56 + 0.2 * hot, 0.6 - 0.1 * hot);
    }
  }

  private puff(at: THREE.Vector3, velocity: THREE.Vector3, from: number, to: number, life: number): void {
    let p = this.puffs[this.nextPuff];
    if (!p) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), transparent: true, depthWrite: false }));
      this.scene.add(sprite);
      p = { sprite, velocity: new THREE.Vector3(), age: 0, life: 1, from: 1, to: 1, hot: 1 };
      this.puffs.push(p);
    }
    this.nextPuff = (this.nextPuff + 1) % SMOKE_POOL;
    p.sprite.visible = true;
    p.sprite.position.copy(at);
    p.sprite.scale.setScalar(from);
    p.velocity.copy(velocity);
    p.age = 0;
    p.life = life;
    p.from = from;
    p.to = to;
    p.hot = 1;
  }

  private solid(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number): RAPIER.RigidBody {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(this.position.x + x, this.position.y + y, this.position.z + z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
    return body;
  }
}
