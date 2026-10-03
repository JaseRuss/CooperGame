import * as THREE from 'three';
import { createGunshipModel } from '../entities/HelicopterEnemy';
import { ARMY_TAN } from '../utils/plastic';
import { SEA_LEVEL } from './Sea';

/** How high they fly, and how big a pool of light a searchlight throws on the water. */
const ALTITUDE = 44;
const POOL = 9;
/** Seconds in a beam before they're sure of the raft (a sweep crossing it takes about two). */
const SPOT_TIME = 2.6;
/** Seconds of being hunted (they have to lose sight of you for this long before they go back to searching). */
const HUNT_TIME = 9;
const HUNT_SPEED = 9;
/** In a chase each gunship fires a burst this often, once it's within range and has had a moment to react. */
const FIRE_EVERY = 4.8;
const FIRE_RANGE = 80;
const REACTION = 4;
/** Chance a burst hits the raft: sitting up, and lying flat under the tarp. */
const HIT_CHANCE = 0.12;
const HIT_CHANCE_FLAT = 0.04;

interface Heli {
  readonly model: THREE.Group;
  readonly mainRotor: THREE.Group;
  readonly tailRotor: THREE.Group;
  readonly beam: THREE.Mesh;
  readonly pool: THREE.Mesh;
  readonly light: THREE.SpotLight;
  readonly pos: THREE.Vector3;
  readonly spot: THREE.Vector3;
  readonly heading: THREE.Vector3;
  /** Its patrol: a zigzag back and forth across the course over a band of it (the middle of the band as a fraction of the crossing, half its length), how far it swings either side, how many passes down the band, its pace in m/s, and where in the cycle it starts. */
  readonly beat: { at: number; half: number; swing: number; passes: number; speed: number; offset: number } | null;
  exposure: number;
  fireTimer: number;
  roll: number;
  index: number;
}

export interface HeliHit {
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** It struck the raft (otherwise it threw up a splash nearby). */
  hit: boolean;
}

export interface HeliReport {
  /** How close the nearest beam's got to being sure of the raft (0 to 1). */
  exposure: number;
  /** The beam's on the raft this very moment. */
  lit: boolean;
  /** They've found it and are coming. */
  hunting: boolean;
  /** The alarm went up this frame. */
  alarm: boolean;
  /** They lost it (it hid in the mist long enough) this frame. */
  lost: boolean;
  hits: HeliHit[];
  /** Distance to the nearest gunship (for the rotor noise). */
  nearest: number;
}

const beamGeometry = new THREE.CylinderGeometry(0.2, POOL, 1, 22, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
const poolGeometry = new THREE.CircleGeometry(POOL, 32).rotateX(-Math.PI / 2);
const WHITE = new THREE.Color(0xfff4d6);
const AMBER = new THREE.Color(0xffa23a);
const RED = new THREE.Color(0xff3a2a);

/**
 * The tan army's search helicopters on the crossing. Three have a beat each along the course
 * (swinging across it, sweeping their searchlights over the water), and a fourth joins later and
 * hunts further out ahead. Stay out of a beam and nothing happens; sit in one and it fills with
 * suspicion, and then they all converge on you, shooting. The way out of a hunt is the sea mist
 * (they can't see into it), though lying flat under the tarp makes you a harder target.
 */
export class SearchHelis {
  readonly group = new THREE.Group();
  private readonly helis: Heli[] = [];
  private active = false;
  private lite = false;
  private hunting = false;
  private huntLeft = 0;
  private huntAge = 0;
  private readonly lastKnown = new THREE.Vector3();
  private time = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly beamMaterial = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.055, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false });
  private readonly poolMaterial = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });

  /** `start` and `end` are the z of the jetty and of the far beach. */
  constructor(private readonly start: number, private readonly end: number) {
    const beats = [
      { at: 0.26, half: 0.12, swing: 66, passes: 8, speed: 4.6, offset: 40 },
      { at: 0.52, half: 0.13, swing: 70, passes: 8, speed: 5, offset: 300 },
      { at: 0.78, half: 0.13, swing: 66, passes: 8, speed: 5.3, offset: 120 },
      null,
    ];
    beats.forEach((beat, index) => {
      const { root, mainRotor, tailRotor } = createGunshipModel(ARMY_TAN);
      root.scale.setScalar(0.9);
      const beam = new THREE.Mesh(beamGeometry, this.beamMaterial.clone());
      const pool = new THREE.Mesh(poolGeometry, this.poolMaterial.clone());
      beam.frustumCulled = false;
      const light = new THREE.SpotLight(0xfff0c8, 0, 120, 0.2, 0.5, 1.2);
      this.group.add(root, beam, pool, light, light.target);
      this.helis.push({ model: root, mainRotor, tailRotor, beam, pool, light, pos: new THREE.Vector3(0, ALTITUDE, start), spot: new THREE.Vector3(0, SEA_LEVEL, start), heading: new THREE.Vector3(0, 0, -1), beat, exposure: 0, fireTimer: FIRE_EVERY * (0.4 + index * 0.25), roll: 0, index });
    });
    this.setActive(false);
  }

  /** Turns them on (the raft's afloat) or off (it's reached the shore). */
  setActive(on: boolean): void {
    this.active = on;
    this.hunting = false;
    this.huntLeft = 0;
    for (const h of this.helis) {
      h.exposure = 0;
      h.model.visible = on && h.beat !== null;
      h.light.visible = on && !this.lite;
      h.beam.visible = on;
      h.pool.visible = on;
      h.light.intensity = 0;
      if (on) h.pos.copy(this.patrolPoint(h, 0, h.pos));
    }
  }

  /** Low graphics: no real spotlights (the beams and pools are still drawn). */
  setLite(lite: boolean): void {
    this.lite = lite;
    if (lite) for (const h of this.helis) h.light.visible = false;
  }

  /** Back to searching (the raft's been sent back to a buoy). */
  reset(): void {
    this.hunting = false;
    this.huntLeft = 0;
    for (const h of this.helis) h.exposure = 0;
  }

  get isHunting(): boolean {
    return this.hunting;
  }

  /**
   * Where the helicopter's flight path is at time `t`: a zigzag back and forth across the course,
   * working its way down its band and back up again, or (the fourth) a long slow weave that
   * keeps coming back over the raft.
   */
  private patrolPoint(h: Heli, t: number, out: THREE.Vector3, raftZ = this.start): THREE.Vector3 {
    const length = this.start - this.end;
    if (h.beat) {
      const b = h.beat;
      const pass = b.swing * 2 + 20;
      const cycle = pass * b.passes * 2;
      const u = (((t * b.speed + b.offset) % cycle) + cycle) % cycle;
      const k = Math.floor(u / pass);
      const f = (u - k * pass) / pass;
      const along = (k + f) / b.passes; // 0 to 2: down the band, then back up
      const bandFrac = along <= 1 ? along : 2 - along;
      const x = k % 2 === 0 ? -b.swing + 2 * b.swing * f : b.swing - 2 * b.swing * f;
      return out.set(x, ALTITUDE, this.start - length * (b.at - b.half + 2 * b.half * bandFrac));
    }
    // The fourth weaves across the course and drifts over the raft and ahead of it, over and over.
    return out.set(Math.sin(t * 0.1 + 1) * 80, ALTITUDE + 4, raftZ - 70 - 80 * Math.sin(t * 0.045));
  }

  update(dt: number, raft: THREE.Vector3, hidden: number, flat: number, progress: number): HeliReport {
    this.time += dt;
    const report: HeliReport = { exposure: 0, lit: false, hunting: this.hunting, alarm: false, lost: false, hits: [], nearest: Infinity };
    if (!this.active) return report;
    const t = this.time;
    // The roamer joins once the crossing's under way.
    const roamer = this.helis[3];
    roamer.model.visible = progress > 0.12;
    const seen = hidden < 0.5;

    if (this.hunting) {
      this.huntAge += dt;
      if (seen) {
        this.huntLeft = Math.max(this.huntLeft, HUNT_TIME * 0.6);
        this.lastKnown.copy(raft);
      }
      // Out of sight in the mist they give up quickly; in plain view only slowly (they have you).
      this.huntLeft -= dt * (seen ? (flat > 0.5 ? 0.5 : 0.3) : 3);
      if (this.huntLeft <= 0) {
        this.hunting = false;
        report.lost = true;
        for (const h of this.helis) h.exposure = 0.2;
      }
    }

    const alive = this.helis.filter((h) => h.beat !== null || progress > 0.12);
    // In a hunt only the two nearest gunships bother to fire; the rest just keep the beams on the area.
    const shooters = new Set([...alive].sort((a, b) => Math.hypot(a.pos.x - raft.x, a.pos.z - raft.z) - Math.hypot(b.pos.x - raft.x, b.pos.z - raft.z)).slice(0, 2));
    alive.forEach((h, rank) => {
      // Where it wants to be: its beat, or (hunting) circling the raft's last known place.
      const want = this.tmp;
      if (this.hunting) {
        const a = t * 0.35 + (rank * Math.PI * 2) / alive.length;
        const r = 24 + rank * 7;
        want.set(this.lastKnown.x + Math.cos(a) * r, ALTITUDE - 6, this.lastKnown.z + Math.sin(a) * r + 14);
      } else {
        this.patrolPoint(h, t, want, raft.z);
      }
      const before = h.pos.clone();
      const step = want.sub(h.pos);
      const max = (this.hunting ? HUNT_SPEED : 24) * dt;
      if (step.length() > max) step.setLength(max);
      h.pos.add(step);
      const moved = h.pos.clone().sub(before).setY(0);
      if (moved.length() > 0.001 * dt * 60) h.heading.lerp(moved.normalize(), Math.min(1, dt * 1.5)).normalize();

      // The model: nose along its heading, leaning into turns.
      const yaw = Math.atan2(-h.heading.x, -h.heading.z);
      const turn = Math.atan2(Math.sin(yaw - h.model.rotation.y), Math.cos(yaw - h.model.rotation.y));
      h.model.rotation.y += turn * Math.min(1, dt * 2);
      h.roll += (THREE.MathUtils.clamp(-turn * 0.6, -0.3, 0.3) - h.roll) * Math.min(1, dt * 2);
      h.model.rotation.z = h.roll;
      h.model.position.copy(h.pos);
      h.mainRotor.rotation.y += 16 * dt;
      h.tailRotor.rotation.x += 34 * dt;

      // Where its beam falls: swinging about ahead of it when searching, on the raft when it has it.
      const goal = this.tmp;
      if (this.hunting && seen) {
        goal.set(raft.x + Math.sin(t * 1.7 + h.index) * 2.5, SEA_LEVEL, raft.z + Math.cos(t * 1.3 + h.index) * 2.5);
      } else if (this.hunting) {
        goal.set(this.lastKnown.x + Math.sin(t * 0.8 + h.index * 2) * 18, SEA_LEVEL, this.lastKnown.z + Math.cos(t * 0.6 + h.index) * 18);
      } else {
        goal.set(h.pos.x + h.heading.x * 30 + -h.heading.z * Math.sin(t * 0.9 + h.index * 1.3) * 16, SEA_LEVEL, h.pos.z + h.heading.z * 30 + h.heading.x * Math.sin(t * 0.9 + h.index * 1.3) * 16);
      }
      h.spot.lerp(goal, Math.min(1, dt * (this.hunting ? 3 : 2.2)));
      h.spot.y = SEA_LEVEL;

      // Is the raft in the light?
      const d = Math.hypot(raft.x - h.spot.x, raft.z - h.spot.z);
      const radius = POOL * (1 - 0.35 * flat);
      const inBeam = d < radius && seen;
      if (inBeam) {
        h.exposure = Math.min(1, h.exposure + dt / SPOT_TIME);
        report.lit = true;
      } else {
        h.exposure = Math.max(0, h.exposure - dt * 0.9);
      }
      report.exposure = Math.max(report.exposure, this.hunting ? 1 : h.exposure);
      report.nearest = Math.min(report.nearest, Math.hypot(h.pos.x - raft.x, h.pos.z - raft.z));
      if (!this.hunting && h.exposure >= 1) {
        this.hunting = true;
        this.huntLeft = HUNT_TIME;
        this.huntAge = 0;
        this.lastKnown.copy(raft);
        report.alarm = true;
        report.hunting = true;
        for (const o of alive) o.fireTimer = FIRE_EVERY * (0.3 + Math.random() * 0.5);
      }

      // Hunting: bursts from the chin gun at the raft, if they can see it.
      if (this.hunting && seen && this.huntAge > REACTION && shooters.has(h)) {
        h.fireTimer -= dt;
        const range = Math.hypot(h.pos.x - raft.x, h.pos.z - raft.z);
        if (h.fireTimer <= 0 && range < FIRE_RANGE) {
          h.fireTimer = FIRE_EVERY * (0.85 + Math.random() * 0.3);
          const hit = Math.random() < (flat > 0.5 ? HIT_CHANCE_FLAT : HIT_CHANCE);
          const to = new THREE.Vector3(raft.x, SEA_LEVEL + 0.4, raft.z);
          if (!hit) to.add(new THREE.Vector3((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14));
          report.hits.push({ from: h.pos.clone().add(new THREE.Vector3(0, -2, 0)), to, hit });
        }
      }
    });

    // Draw the beams (and give each its light).
    for (const h of this.helis) {
      const on = h.model.visible;
      h.beam.visible = on;
      h.pool.visible = on;
      h.light.visible = on && !this.lite;
      h.light.intensity = on ? 150 : 0;
      if (!on) continue;
      const tint = this.hunting ? RED : WHITE.clone().lerp(AMBER, h.exposure);
      (h.beam.material as THREE.MeshBasicMaterial).color.copy(tint);
      (h.pool.material as THREE.MeshBasicMaterial).color.copy(tint);
      const from = h.pos.clone().add(new THREE.Vector3(0, -1.6, 0));
      h.beam.position.copy(from);
      h.beam.lookAt(h.spot);
      h.beam.scale.set(1, 1, from.distanceTo(h.spot));
      h.pool.position.copy(h.spot).setY(SEA_LEVEL + 0.05);
      h.light.position.copy(from);
      h.light.target.position.copy(h.spot);
      h.light.color.copy(tint);
    }
    return report;
  }
}
