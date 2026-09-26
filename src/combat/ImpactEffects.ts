import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  startScale: number;
  endScale: number;
  startOpacity: number;
  gravity: number;
  drag: number;
  colorFrom?: THREE.Color;
  colorTo?: THREE.Color;
}

interface Flash {
  light: THREE.PointLight;
  age: number;
  life: number;
  peak: number;
}

const SPHERE = new THREE.SphereGeometry(1, 10, 8);
const SMOKE_SPHERE = new THREE.IcosahedronGeometry(1, 2);
const SPARK = new THREE.BoxGeometry(0.12, 0.12, 0.5);
const CONFETTI = new THREE.BoxGeometry(0.35, 0.02, 0.25);
const RING = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
const LIGHT_POOL_SIZE = 4;

/**
 * Cosmetic explosions: fireball, sparks, smoke, shockwave ring and a light flash.
 * Point lights are pooled because adding/removing lights forces shader recompiles.
 */
interface SmokeSource {
  position: THREE.Vector3;
  radius: number;
  timeLeft: number;
  duration: number;
  accumulator: number;
}

const MAX_SMOKE_SOURCES = 24;
const SMOKE_PUFFS_PER_SEC = 4;

export class ImpactEffects {
  private readonly particles: Particle[] = [];
  private readonly flashes: Flash[] = [];
  private readonly smokeSources: SmokeSource[] = [];

  /** Keeps a column of dark smoke rising from `position` for `duration` seconds. */
  addSmokeSource(position: THREE.Vector3, radius: number, duration = 60): void {
    if (this.smokeSources.length >= MAX_SMOKE_SOURCES) this.smokeSources.shift();
    this.smokeSources.push({ position: position.clone(), radius, timeLeft: duration, duration, accumulator: 0 });
  }

  /** One puff of dark smoke, e.g. from a factory chimney. */
  chimneyPuff(point: THREE.Vector3, radius: number): void {
    this.emitSmokePuff({ position: point, radius, timeLeft: 1, duration: 1, accumulator: 0 });
  }

  private emitSmokePuff(source: SmokeSource): void {
    const strength = source.timeLeft / source.duration; // thins out as the fire dies down
    const offset = randomInSphere(source.radius);
    offset.y = Math.abs(offset.y) * 0.3;
    const shade = 0.08 + Math.random() * 0.08;
    this.add({
      geometry: SMOKE_SPHERE,
      position: source.position.clone().add(offset),
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.2 + 1.0, 4 + Math.random() * 2.5, (Math.random() - 0.5) * 1.2),
      life: 3.5 + Math.random() * 2,
      startScale: 0.8 + Math.random() * 0.6,
      endScale: 3.5 + Math.random() * 2.5,
      startOpacity: 0.25 + 0.3 * strength,
      additive: false,
      colorFrom: new THREE.Color(shade, shade * 0.95, shade * 0.9),
      colorTo: new THREE.Color(shade + 0.18, shade + 0.18, shade + 0.18),
      drag: 0.3,
    });
  }

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 60, 2);
      scene.add(light);
      this.flashes.push({ light, age: 1, life: 1, peak: 0 });
    }
  }

  /** Full explosion at `point`; `size` 1 = shell impact, ~2.5 = tank destroyed. */
  explode(point: THREE.Vector3, size = 1): void {
    this.flash(point, 2500 * size, 0.22);

    // Fireball: a few overlapping blobs that bloom and cool from yellow to deep red.
    for (let i = 0; i < 3; i++) {
      const offset = randomInSphere(0.6 * size);
      this.add({
        geometry: SPHERE,
        position: point.clone().add(offset),
        velocity: offset.multiplyScalar(3).add(new THREE.Vector3(0, 1.5 * size, 0)),
        life: (0.35 + Math.random() * 0.2) * (0.7 + size * 0.3), // big blasts burn longer
        startScale: 0.4 * size,
        endScale: (2.2 + Math.random()) * size,
        startOpacity: 1,
        additive: true,
        colorFrom: new THREE.Color(0xfff0a0),
        colorTo: new THREE.Color(0xc0300a),
        drag: 3,
      });
    }

    // Sparks / shrapnel flying out and falling.
    const sparkCount = Math.round(14 * size);
    for (let i = 0; i < sparkCount; i++) {
      const dir = randomInSphere(1).normalize();
      dir.y = Math.abs(dir.y) * 0.9 + 0.2;
      const speed = (10 + Math.random() * 14) * Math.sqrt(size);
      this.add({
        geometry: SPARK,
        position: point.clone(),
        velocity: dir.multiplyScalar(speed),
        life: 0.5 + Math.random() * 0.5,
        startScale: 1,
        endScale: 0.3,
        startOpacity: 1,
        additive: true,
        colorFrom: new THREE.Color(0xffe080),
        colorTo: new THREE.Color(0xff5010),
        gravity: -22,
        drag: 0.6,
        orientToVelocity: true,
      });
    }

    // Smoke puffs that linger and drift upward.
    const smokeCount = Math.round(4 + size * 2.5);
    for (let i = 0; i < smokeCount; i++) {
      const offset = randomInSphere(1.2 * size);
      offset.y = Math.abs(offset.y);
      const shade = 0.1 + Math.random() * 0.12;
      this.add({
        geometry: SPHERE,
        position: point.clone().add(offset),
        velocity: new THREE.Vector3(offset.x * 0.6, 2.5 + Math.random() * 2, offset.z * 0.6),
        life: 1.4 + Math.random() * 1.0,
        startScale: 0.8 * size,
        endScale: (2.4 + Math.random() * 1.2) * size,
        startOpacity: 0.45,
        additive: false,
        colorFrom: new THREE.Color(shade + 0.15, shade + 0.12, shade + 0.1),
        colorTo: new THREE.Color(shade, shade, shade),
        drag: 1.2,
        delay: 0.08,
      });
    }

    // Shockwave ring hugging the impact point.
    this.add({
      geometry: RING,
      position: point.clone().add(new THREE.Vector3(0, 0.2, 0)),
      velocity: new THREE.Vector3(),
      life: 0.4,
      startScale: 0.5 * size,
      endScale: 7 * size,
      startOpacity: 0.7,
      additive: true,
      colorFrom: new THREE.Color(0xffd9a0),
      colorTo: new THREE.Color(0xff8040),
    });
  }

  /** Water plume: a column of white droplets and a spreading ring. `size` 1 = shell, ~0.3 = bullet/wake. */
  splash(point: THREE.Vector3, size = 1): void {
    const drops = Math.round(6 + size * 14);
    for (let i = 0; i < drops; i++) {
      const dir = randomInSphere(1);
      dir.y = 1.2 + Math.random() * 1.5;
      this.add({
        geometry: SMOKE_SPHERE,
        position: point.clone(),
        velocity: dir.multiplyScalar((4 + Math.random() * 5) * Math.sqrt(size)),
        life: 0.7 + Math.random() * 0.5,
        startScale: 0.35 * size + 0.1,
        endScale: 0.9 * size + 0.2,
        startOpacity: 0.9,
        additive: false,
        colorFrom: new THREE.Color(0xf4fbff),
        colorTo: new THREE.Color(0xb9dcf2),
        gravity: -18,
        drag: 0.4,
      });
    }
    this.add({
      geometry: RING,
      position: point.clone().add(new THREE.Vector3(0, 0.1, 0)),
      velocity: new THREE.Vector3(),
      life: 0.8,
      startScale: 0.5 * size,
      endScale: 5 * size + 0.5,
      startOpacity: 0.7,
      additive: false,
      colorFrom: new THREE.Color(0xffffff),
      colorTo: new THREE.Color(0xcfe8f7),
    });
  }

  /** Rocket exhaust: a puff of white-grey smoke with a flicker of flame. */
  trailPuff(point: THREE.Vector3): void {
    const shade = 0.55 + Math.random() * 0.2;
    this.add({
      geometry: SMOKE_SPHERE,
      position: point.clone().add(randomInSphere(0.15)),
      velocity: randomInSphere(0.6).setY(0.6),
      life: 1.4 + Math.random() * 0.6,
      startScale: 0.25,
      endScale: 1.4 + Math.random() * 0.6,
      startOpacity: 0.55,
      additive: false,
      colorFrom: new THREE.Color(shade + 0.2, shade + 0.18, shade + 0.15),
      colorTo: new THREE.Color(shade, shade, shade),
      drag: 1.5,
    });
    this.add({
      geometry: SPHERE,
      position: point.clone(),
      velocity: new THREE.Vector3(),
      life: 0.07,
      startScale: 0.35,
      endScale: 0.15,
      startOpacity: 0.9,
      additive: true,
      colorFrom: new THREE.Color(0xffe070),
      colorTo: new THREE.Color(0xff6010),
    });
  }

  /** A firework burst: a ring of bright stars and a shower of tumbling confetti. */
  confetti(point: THREE.Vector3): void {
    this.flash(point, 4000, 0.3);
    const colors = [0xff4d6d, 0xffd24a, 0x4dd2ff, 0x9be27a, 0xc77dff, 0xff8a3d];
    for (let i = 0; i < 36; i++) {
      const dir = randomInSphere(1).normalize();
      const color = new THREE.Color(colors[i % colors.length]);
      this.add({
        geometry: SPARK,
        position: point.clone(),
        velocity: dir.multiplyScalar(26 + Math.random() * 8),
        life: 0.9 + Math.random() * 0.4,
        startScale: 2.2,
        endScale: 0.4,
        startOpacity: 1,
        additive: true,
        colorFrom: color.clone().lerp(new THREE.Color(0xffffff), 0.5),
        colorTo: color,
        gravity: -6,
        drag: 1.6,
        orientToVelocity: true,
      });
    }
    for (let i = 0; i < 70; i++) {
      const color = new THREE.Color(colors[Math.floor(Math.random() * colors.length)]);
      this.add({
        geometry: CONFETTI,
        position: point.clone().add(randomInSphere(1.5)),
        velocity: randomInSphere(1).normalize().multiplyScalar(6 + Math.random() * 14),
        life: 2.5 + Math.random() * 1.5,
        startScale: 1,
        endScale: 1,
        startOpacity: 1,
        additive: false,
        colorFrom: color,
        colorTo: color,
        gravity: -7,
        drag: 1.8,
        orientToVelocity: true,
      });
    }
  }

  /**
   * A magic-trick cloud: thick white smoke billows round a vehicle so it can be swapped for
   * another unseen (tank to jeep and back), with a pop of sparkles. `size` 1 covers a tank.
   */
  changePuff(point: THREE.Vector3, size = 1): void {
    this.flash(point, 900, 0.25);
    for (let i = 0; i < 26; i++) {
      const offset = randomInSphere(2.6 * size);
      offset.y = Math.abs(offset.y) * 0.8 + 0.4;
      const white = 0.86 + Math.random() * 0.12;
      this.add({
        geometry: SMOKE_SPHERE,
        position: point.clone().add(offset),
        velocity: new THREE.Vector3(offset.x * 1.6, 1.2 + Math.random() * 1.5, offset.z * 1.6),
        life: 1.5 + Math.random() * 0.8,
        startScale: (1.5 + Math.random() * 0.6) * size,
        endScale: (3.6 + Math.random() * 1.6) * size,
        startOpacity: 0.95,
        additive: false,
        colorFrom: new THREE.Color(white, white, white),
        colorTo: new THREE.Color(white - 0.12, white - 0.1, white - 0.08),
        drag: 2.2,
      });
    }
    for (let i = 0; i < 16; i++) {
      const dir = randomInSphere(1).normalize();
      dir.y = Math.abs(dir.y) + 0.3;
      this.add({
        geometry: SPARK,
        position: point.clone().add(new THREE.Vector3(0, 1.5, 0)),
        velocity: dir.multiplyScalar(12 + Math.random() * 6),
        life: 0.5 + Math.random() * 0.3,
        startScale: 1.6,
        endScale: 0.3,
        startOpacity: 1,
        additive: true,
        colorFrom: new THREE.Color(0xffffff),
        colorTo: new THREE.Color(0x8fe0ff),
        gravity: -10,
        drag: 1.2,
        orientToVelocity: true,
      });
    }
    this.add({
      geometry: RING,
      position: point.clone().add(new THREE.Vector3(0, 0.3, 0)),
      velocity: new THREE.Vector3(),
      life: 0.5,
      startScale: 1 * size,
      endScale: 9 * size,
      startOpacity: 0.8,
      additive: false,
      colorFrom: new THREE.Color(0xffffff),
      colorTo: new THREE.Color(0xd8e8f0),
    });
  }

  /** A thin, short-lived smoke wisp: the trail of the little AA missiles. */
  wispPuff(point: THREE.Vector3): void {
    const shade = 0.75 + Math.random() * 0.15;
    this.add({
      geometry: SMOKE_SPHERE,
      position: point.clone().add(randomInSphere(0.08)),
      velocity: randomInSphere(0.4).setY(0.4),
      life: 0.7 + Math.random() * 0.4,
      startScale: 0.15,
      endScale: 0.7,
      startOpacity: 0.5,
      additive: false,
      colorFrom: new THREE.Color(shade, shade, shade),
      colorTo: new THREE.Color(shade - 0.1, shade - 0.1, shade - 0.1),
      drag: 1.5,
    });
  }

  /** Little dust kick where a bullet lands. */
  dustPuff(point: THREE.Vector3): void {
    this.add({
      geometry: SMOKE_SPHERE,
      position: point.clone(),
      velocity: new THREE.Vector3(0, 1.5, 0),
      life: 0.5,
      startScale: 0.15,
      endScale: 0.7,
      startOpacity: 0.6,
      additive: false,
      colorFrom: new THREE.Color(0x9c8a6a),
      colorTo: new THREE.Color(0x7a6d58),
      drag: 2,
    });
    this.add({
      geometry: SPHERE,
      position: point.clone(),
      velocity: new THREE.Vector3(),
      life: 0.08,
      startScale: 0.1,
      endScale: 0.35,
      startOpacity: 1,
      additive: true,
      colorFrom: new THREE.Color(0xffe9a0),
      colorTo: new THREE.Color(0xff9a40),
    });
  }

  /** Small flash + puff at the gun barrel when firing. */
  muzzleFlash(point: THREE.Vector3, direction: THREE.Vector3): void {
    this.flash(point, 600, 0.08);
    this.add({
      geometry: SPHERE,
      position: point.clone(),
      velocity: direction.clone().multiplyScalar(6),
      life: 0.12,
      startScale: 0.3,
      endScale: 1.1,
      startOpacity: 1,
      additive: true,
      colorFrom: new THREE.Color(0xfff2b0),
      colorTo: new THREE.Color(0xff7a20),
    });
    for (let i = 0; i < 2; i++) {
      this.add({
        geometry: SPHERE,
        position: point.clone().addScaledVector(direction, 0.5),
        velocity: direction.clone().multiplyScalar(3).add(new THREE.Vector3(0, 1.2, 0)),
        life: 0.9,
        startScale: 0.3,
        endScale: 1.6,
        startOpacity: 0.35,
        additive: false,
        colorFrom: new THREE.Color(0x9a9a9a),
        colorTo: new THREE.Color(0x6a6a6a),
        drag: 2,
      });
    }
  }

  private flash(point: THREE.Vector3, peak: number, life: number): void {
    // Reuse whichever pooled light is closest to finished.
    let best = this.flashes[0];
    for (const f of this.flashes) if (f.age / f.life > best.age / best.life) best = f;
    best.light.position.copy(point).add(new THREE.Vector3(0, 1.5, 0));
    best.age = 0;
    best.life = life;
    best.peak = peak;
  }

  private add(opts: {
    geometry: THREE.BufferGeometry;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    life: number;
    startScale: number;
    endScale: number;
    startOpacity: number;
    additive: boolean;
    colorFrom?: THREE.Color;
    colorTo?: THREE.Color;
    gravity?: number;
    drag?: number;
    orientToVelocity?: boolean;
    delay?: number;
  }): void {
    const material = new THREE.MeshBasicMaterial({
      color: opts.colorFrom ?? 0xffffff,
      transparent: true,
      opacity: opts.startOpacity,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(opts.geometry, material);
    mesh.position.copy(opts.position);
    mesh.scale.setScalar(opts.startScale);
    if (opts.orientToVelocity) mesh.lookAt(opts.position.clone().add(opts.velocity));
    mesh.visible = !opts.delay;
    this.scene.add(mesh);

    this.particles.push({
      mesh,
      material,
      velocity: opts.velocity,
      age: -(opts.delay ?? 0),
      life: opts.life,
      startScale: opts.startScale,
      endScale: opts.endScale,
      startOpacity: opts.startOpacity,
      gravity: opts.gravity ?? 0,
      drag: opts.drag ?? 0,
      colorFrom: opts.colorFrom,
      colorTo: opts.colorTo,
    });
  }

  update(dt: number): void {
    for (let i = this.smokeSources.length - 1; i >= 0; i--) {
      const s = this.smokeSources[i];
      s.timeLeft -= dt;
      if (s.timeLeft <= 0) {
        this.smokeSources.splice(i, 1);
        continue;
      }
      s.accumulator += dt * SMOKE_PUFFS_PER_SEC;
      while (s.accumulator >= 1) {
        s.accumulator -= 1;
        this.emitSmokePuff(s);
      }
    }

    for (const f of this.flashes) {
      f.age += dt;
      const t = Math.min(1, f.age / f.life);
      f.light.intensity = f.peak * (1 - t) * (1 - t);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age < 0) continue;
      p.mesh.visible = true;

      const t = Math.min(1, p.age / p.life);
      p.velocity.y += p.gravity * dt;
      p.velocity.multiplyScalar(Math.exp(-p.drag * dt));
      p.mesh.position.addScaledVector(p.velocity, dt);

      const eased = 1 - (1 - t) * (1 - t);
      const scale = p.startScale + (p.endScale - p.startScale) * eased;
      if (p.mesh.geometry === SPARK) {
        p.mesh.lookAt(p.mesh.position.clone().add(p.velocity));
        p.mesh.scale.set(scale, scale, scale * 2);
      } else {
        p.mesh.scale.setScalar(scale);
      }

      p.material.opacity = p.startOpacity * (1 - t);
      if (p.colorFrom && p.colorTo) p.material.color.copy(p.colorFrom).lerp(p.colorTo, t);

      if (t >= 1) {
        this.scene.remove(p.mesh);
        p.material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }
}

function randomInSphere(radius: number): THREE.Vector3 {
  const v = new THREE.Vector3();
  do {
    v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  } while (v.lengthSq() > 1);
  return v.multiplyScalar(radius);
}
