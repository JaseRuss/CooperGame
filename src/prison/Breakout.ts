import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PlayerTank } from '../entities/PlayerTank';
import { createFigureMesh, createCheeringFigure } from '../entities/Soldier';
import { nameTag } from '../entities/AllyTank';
import { buildJeepParts } from '../world/Vehicles';
import { predictTrajectory, type Trajectory } from '../combat/Projectile';
import { plastic, ARMY_TAN } from '../utils/plastic';
import type { FacilityLayout } from './Facility';
import { Convoy } from './Trucks';

/** Buddies are a lighter green than the other prisoners, like their tanks in the main game. */
const BUDDY_COLOR = 0x6a9a3c;
/** Where the four buddies ride on the hull (local to the tank: x out to the sides, z along it), facing out. */
const RIDER_SEATS = [
  { x: -1.1, z: -0.6 },
  { x: 1.1, z: -0.6 },
  { x: -1.1, z: 1.0 },
  { x: 1.1, z: 1.0 },
];
const RIDER_HEIGHT = 0.42;
/** Shells: how close to the gate (or a jeep, or a guard) a hit has to be. */
const GATE_BLAST = 4;
const JEEP_BLAST = 4.5;
export const SHELL_BLAST = 4;
/** Close enough to Cooper's Base to be home. */
const HOME_REACH = 16;
/** The raiders: how many, how fast, how close they ride alongside, how often they fire. */
const JEEPS = 4;
const JEEP_SPEED = 24;
const JEEP_SIDE = 7;
const JEEP_FIRE = 1.4;
const SLIDE_TIME = 2.5;

/** What Breakout needs the game to do for it: effects and sounds, and knocking guards over. */
export interface BreakoutEffects {
  explode(at: THREE.Vector3, size: number): void;
  dust(at: THREE.Vector3): void;
  puff(at: THREE.Vector3): void;
  sound(name: 'cannon' | 'explosion' | 'boom' | 'clang' | 'crack' | 'poof', at?: THREE.Vector3, volume?: number, rate?: number): void;
  shake(amount: number): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3): void;
  /** A shell's burst at `at`: guards within `radius` are knocked over. */
  blast(at: THREE.Vector3, radius: number): void;
}

interface Jeep {
  root: THREE.Group;
  side: number;
  speed: number;
  fireTimer: number;
  /** Seconds since it was hit (it's tumbling through the air), or -1 while it's still chasing. */
  wrecked: number;
  spin: THREE.Vector3;
  vy: number;
}

interface Shell {
  mesh: THREE.Mesh;
  traj: Trajectory;
  t: number;
}

/** A sliding (or blown-open) gate: bars drawn, and a collider until it's open. */
interface Gate {
  group: THREE.Group;
  collider: RAPIER.Collider | null;
}

function barsGate(x0: number, x1: number, z: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const steel = plastic(0x3e4246);
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (let x = x0 + 0.15; x < x1; x += 0.3) {
    const m = new THREE.Mesh(box, steel);
    m.position.set(x, height / 2, z);
    m.scale.set(0.08, height, 0.08);
    g.add(m);
  }
  for (const y of [0.15, height / 2, height - 0.15]) {
    const m = new THREE.Mesh(box, steel);
    m.position.set((x0 + x1) / 2, y, z);
    m.scale.set(x1 - x0, 0.12, 0.12);
    g.add(m);
  }
  for (const m of g.children) (m as THREE.Mesh).castShadow = true;
  return g;
}

/**
 * The bonus level's finale. The motor pool's gate slides open once the prison's taken; get back
 * in your tank and the buddies jump up on the hull while everyone else piles into the tan
 * army's trucks. Blow the main gate open with the main gun, then drive home up the road to
 * Cooper's Base, the trucks following in your tracks and tan jeeps coming after you (nothing
 * can stop the tank, but they're fun to knock out).
 */
export class Breakout {
  readonly group = new THREE.Group();
  readonly tank: PlayerTank;
  readonly convoy: Convoy;
  private readonly lotGate: Gate;
  private readonly mainGate: Gate;
  private lotSlide = -1;
  private gateBlown = -1;
  private readonly riders: THREE.Group[] = [];
  private readonly jeeps: Jeep[] = [];
  private jeepsSent = false;
  private readonly shells: Shell[] = [];
  private readonly shellMaterial = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  private readonly shellGeometry = new THREE.SphereGeometry(0.2, 8, 6);
  boarded = false;
  home = false;
  jeepsKnockedOut = 0;

  constructor(private readonly world: RAPIER.World, private readonly layout: FacilityLayout, private readonly fx: BreakoutEffects) {
    const mp = layout.motorPool;
    this.tank = new PlayerTank(world, mp.tank.x, mp.tank.z, mp.tank.yaw);
    this.group.add(this.tank.root);
    this.convoy = new Convoy(3, mp.truckLine);
    this.group.add(this.convoy.group);
    this.lotGate = this.gate(mp.gate.x0, mp.gate.x1, mp.gate.z, 2.6);
    const g = layout.mainGate;
    this.mainGate = this.gate(g.x0, g.x1, g.z, g.height);
  }

  private gate(x0: number, x1: number, z: number, height: number): Gate {
    const group = barsGate(x0, x1, z, height);
    this.group.add(group);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, height / 2, 0.1).setTranslation((x0 + x1) / 2, height / 2, z), body);
    return { group, collider };
  }

  /** True for the gates' colliders (the nav graph looks through them). */
  isGate(c: RAPIER.Collider): boolean {
    return c.handle === this.lotGate.collider?.handle || c.handle === this.mainGate.collider?.handle;
  }

  get lotOpen(): boolean {
    return this.lotSlide >= 0;
  }

  get gateOpen(): boolean {
    return this.gateBlown >= 0;
  }

  /** How far the tank is from Cooper's Base. */
  get distanceHome(): number {
    const h = this.layout.home;
    return Math.hypot(this.tank.position.x - h.x, this.tank.position.z - h.z);
  }

  /** The prison's taken: the motor pool's gate slides open. */
  openLot(): void {
    if (this.lotSlide >= 0) return;
    this.lotSlide = 0;
    if (this.lotGate.collider) this.world.removeCollider(this.lotGate.collider, false);
    this.lotGate.collider = null;
    this.fx.sound('clang', this.tank.position, 0.8, 0.6);
  }

  /** Close enough to climb back in. */
  canBoard(at: THREE.Vector3): boolean {
    return this.lotOpen && !this.boarded && Math.hypot(at.x - this.tank.position.x, at.z - this.tank.position.z) < 3.4;
  }

  /** Back in the tank: the buddies hop up on the hull, everyone else into the trucks. */
  board(buddies: { name: string }[], passengers: number, showTags: boolean): void {
    this.boarded = true;
    this.fx.puff(this.tank.position.clone().add(new THREE.Vector3(0, 1, 0)));
    this.fx.sound('poof', this.tank.position, 0.8);
    buddies.slice(0, RIDER_SEATS.length).forEach((b, i) => {
      const s = RIDER_SEATS[i];
      const rider = new THREE.Group();
      const man = createFigureMesh(1, BUDDY_COLOR);
      rider.add(man);
      if (showTags) {
        const tag = nameTag(b.name);
        tag.scale.set(2, 0.5, 1);
        tag.position.y = 2.1;
        rider.add(tag);
      }
      rider.position.set(s.x, RIDER_HEIGHT, s.z);
      rider.rotation.y = s.x < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.tank.root.add(rider);
      this.riders.push(rider);
    });
    this.convoy.board(passengers);
  }

  /** Fires a shell from the tank's gun (its arc worked out now, then flown along it). */
  fire(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const traj = predictTrajectory(this.world, origin, direction, this.tank.muzzleSpeed, this.tank.physicsCollider);
    const mesh = new THREE.Mesh(this.shellGeometry, this.shellMaterial);
    mesh.position.copy(origin);
    this.group.add(mesh);
    this.shells.push({ mesh, traj, t: 0 });
    this.fx.sound('cannon', origin, 0.9);
    this.fx.shake(0.35);
  }

  /** Where the next shell would come down (for the crosshair). */
  aim(): THREE.Vector3 {
    return predictTrajectory(this.world, this.tank.gunMuzzlePosition, this.tank.muzzleWorldDirection, this.tank.muzzleSpeed, this.tank.physicsCollider).impact;
  }

  update(dt: number, time: number): void {
    // The motor pool's gate slides along behind the fence.
    if (this.lotSlide >= 0 && this.lotSlide < 1) {
      this.lotSlide = Math.min(1, this.lotSlide + dt / SLIDE_TIME);
      this.lotGate.group.position.x = 6.6 * this.lotSlide;
    }
    // The main gate's bars, blown out, fly off and fall.
    if (this.gateBlown >= 0 && this.gateBlown < 2.5) {
      this.gateBlown += dt;
      const t = this.gateBlown;
      this.mainGate.group.position.set(0, Math.max(-4, 9 * t - 9 * t * t), -14 * t);
      this.mainGate.group.rotation.x = -t * 2.2;
      if (t >= 2.5) this.mainGate.group.visible = false;
    }
    this.updateShells(dt);
    if (this.boarded) {
      this.convoy.follow(this.tank.position.x, this.tank.position.z);
      // The riders sway as the tank goes.
      this.riders.forEach((r, i) => {
        r.position.y = RIDER_HEIGHT + Math.abs(Math.sin(time * 9 + i)) * 0.06;
      });
      // Out through the main gate, and the raiders come after the convoy.
      if (!this.jeepsSent && this.gateOpen && this.tank.position.z < this.layout.mainGate.z - 6) this.sendJeeps();
      this.updateJeeps(dt);
      if (!this.home && this.distanceHome < HOME_REACH) this.home = true;
    }
  }

  /** Home: the buddies jump down and cheer, and so does everyone from the trucks. */
  arrive(): void {
    const tank = this.tank.root;
    tank.updateMatrixWorld();
    this.riders.forEach((r, i) => {
      const at = new THREE.Vector3(RIDER_SEATS[i].x * 2.6, 0, RIDER_SEATS[i].z * 1.6).applyMatrix4(tank.matrixWorld);
      tank.remove(r);
      const man = createCheeringFigure(BUDDY_COLOR);
      r.clear();
      r.add(man);
      r.position.set(at.x, 0, at.z);
      r.rotation.y = this.tank.yaw + (RIDER_SEATS[i].x < 0 ? Math.PI / 2 : -Math.PI / 2);
      this.group.add(r);
    });
    this.convoy.unload();
    for (const j of this.jeeps) if (j.wrecked < 0) this.wreck(j);
  }

  /** The cheering buddies (after `arrive`), for a little hop. */
  celebrate(time: number): void {
    this.riders.forEach((r, i) => {
      r.position.y = Math.abs(Math.sin(time * 7 + i * 1.3)) * 0.4;
    });
  }

  private updateShells(dt: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      // The arc's points are 1/30 s apart.
      s.t += dt * 30;
      const k = Math.min(s.traj.points.length - 1, Math.floor(s.t));
      s.mesh.position.copy(s.traj.points[k]);
      if (k < s.traj.points.length - 1) continue;
      this.group.remove(s.mesh);
      this.shells.splice(i, 1);
      this.burst(s.traj.impact, s.traj.hitCollider);
    }
  }

  /** A shell's burst: the gate, any jeeps and guards nearby. */
  private burst(at: THREE.Vector3, hit: RAPIER.Collider | null): void {
    this.fx.explode(at, 1.6);
    this.fx.sound('explosion', at, 1);
    this.fx.blast(at, SHELL_BLAST);
    const g = this.layout.mainGate;
    const gateHit = hit?.handle === this.mainGate.collider?.handle || Math.hypot(at.x - (g.x0 + g.x1) / 2, at.z - g.z) < GATE_BLAST;
    if (gateHit && this.gateBlown < 0) {
      this.gateBlown = 0;
      if (this.mainGate.collider) this.world.removeCollider(this.mainGate.collider, false);
      this.mainGate.collider = null;
      this.fx.explode(new THREE.Vector3((g.x0 + g.x1) / 2, 2, g.z), 3);
      this.fx.sound('boom', at, 1);
      this.fx.shake(0.8);
    }
    for (const j of this.jeeps) {
      if (j.wrecked < 0 && j.root.position.distanceTo(at) < JEEP_BLAST) this.wreck(j);
    }
  }

  /** Four tan jeeps come racing out of the fields after the convoy. */
  private sendJeeps(): void {
    this.jeepsSent = true;
    const t = this.tank.position;
    for (let i = 0; i < JEEPS; i++) {
      const parts = buildJeepParts(ARMY_TAN, { driver: true, mountedGun: true });
      const root = new THREE.Group();
      root.add(parts.group);
      const side = i % 2 === 0 ? -1 : 1;
      root.position.set(t.x + side * (55 + i * 8), 0, t.z - 30 - i * 25);
      this.group.add(root);
      this.jeeps.push({ root, side, speed: JEEP_SPEED * (0.9 + Math.random() * 0.2), fireTimer: Math.random() * JEEP_FIRE, wrecked: -1, spin: new THREE.Vector3(), vy: 0 });
    }
  }

  /** The raiders race up alongside the tank and fire away (they can't hurt it). */
  private updateJeeps(dt: number): void {
    const tank = this.tank.position;
    const yaw = this.tank.yaw;
    for (let i = this.jeeps.length - 1; i >= 0; i--) {
      const j = this.jeeps[i];
      if (j.wrecked >= 0) {
        // Knocked out: it cartwheels up, comes down and goes up in smoke.
        j.wrecked += dt;
        j.vy -= 20 * dt;
        j.root.position.y = Math.max(0, j.root.position.y + j.vy * dt);
        j.root.rotation.x += j.spin.x * dt;
        j.root.rotation.z += j.spin.z * dt;
        if (j.wrecked > 2.2) {
          this.fx.explode(j.root.position.clone().setY(0.8), 1.2);
          this.group.remove(j.root);
          this.jeeps.splice(i, 1);
        }
        continue;
      }
      // Alongside the tank, a little behind, on its side.
      const goal = new THREE.Vector3(tank.x + Math.cos(yaw) * JEEP_SIDE * j.side + Math.sin(yaw) * 3, 0, tank.z - Math.sin(yaw) * JEEP_SIDE * j.side + Math.cos(yaw) * 3);
      const to = goal.sub(j.root.position);
      const d = Math.hypot(to.x, to.z);
      const want = Math.atan2(-to.x, -to.z);
      const turn = Math.atan2(Math.sin(want - j.root.rotation.y), Math.cos(want - j.root.rotation.y));
      j.root.rotation.y += Math.sign(turn) * Math.min(Math.abs(turn), 2.4 * dt);
      const speed = Math.min(j.speed, d * 2);
      j.root.position.x += -Math.sin(j.root.rotation.y) * speed * dt;
      j.root.position.z += -Math.cos(j.root.rotation.y) * speed * dt;
      j.fireTimer -= dt;
      if (j.fireTimer <= 0 && j.root.position.distanceTo(tank) < 30) {
        j.fireTimer = JEEP_FIRE + Math.random() * 0.6;
        const from = j.root.position.clone().setY(1.8);
        this.fx.tracer(from, tank.clone().setY(1.2).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2)));
        this.fx.sound('crack', from, 0.3, 2);
      }
    }
  }

  private wreck(j: Jeep): void {
    j.wrecked = 0;
    j.vy = 9;
    j.spin.set((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8);
    this.jeepsKnockedOut++;
    this.fx.sound('explosion', j.root.position, 0.9);
  }
}
