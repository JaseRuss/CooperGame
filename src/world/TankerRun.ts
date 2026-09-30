import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Faction } from '../entities/Tank';
import type { PlayerTank } from '../entities/PlayerTank';
import type { SoundName } from '../audio/Sound';
import type { Building } from './Building';
import type { Fortress } from './Fortress';
import { EnemyJeep } from '../entities/EnemyJeep';
import { TankerParts } from './TankerParts';
import { TankerRig, TANKER_PARTS, RIG_DECK } from './TankerRig';
import { planTankerRoute, type RouteObstacles } from './TankerRoute';
import { siteToWorld } from './Landmarks';
import { heightAt } from './Terrain';
import { mulberry32 } from '../utils/rng';
import { ARMY_BLUE, ARMY_TAN } from '../utils/plastic';
import { clamp, damp, shortestAngleDelta } from '../utils/math';

export type TankerPhase = 'hunt' | 'assemble' | 'run' | 'breach' | 'fuse' | 'blast' | 'done';

/** Everything the run needs from the game around it. */
export interface TankerHost {
  scene: THREE.Scene;
  world: RAPIER.World;
  player: PlayerTank;
  fortress: Fortress;
  obstacles: RouteObstacles;
  /** Puts a raider's jeep into the scene and the hit registry. */
  register(jeep: EnemyJeep): void;
  /** Takes a raider out: with a blast and a gag, or quietly. */
  remove(jeep: EnemyJeep, blast: boolean): void;
  explode(at: THREE.Vector3, size: number): void;
  smoke(at: THREE.Vector3): void;
  dust(at: THREE.Vector3): void;
  flash(origin: THREE.Vector3, direction: THREE.Vector3, scale: number): void;
  /** A round leaves a gun; `exclude` keeps it from hitting what it's fired from. */
  tracer(origin: THREE.Vector3, direction: THREE.Vector3, faction: Faction, exclude?: RAPIER.Collider): void;
  shake(amount: number): void;
  play(name: SoundName, at: THREE.Vector3 | undefined, volume: number, rate?: number, minGap?: number): void;
  callout(text: string, color: string): void;
  banner(title: string, sub: string): void;
  /** Bowls over whatever stands in the rig's way. */
  crush(at: THREE.Vector3, radius: number): void;
  /** Puts the player in the tank, and sends any buddies off the field (they're aboard now). */
  board(): void;
  collapse(building: Building): void;
  buddyNames(): string[];
  nameTags(): boolean;
}

/** What the HUD shows. */
export interface TankerHUD {
  phase: TankerPhase;
  parts: { name: string; /** The enemy base it drops from. */ source: string; /** Dropped and lying there to be picked up. */ lying: boolean; found: boolean; fitted: boolean }[];
  /** Parts picked up but not yet fitted to the rig. */
  carried: number;
  /** How far along Thunder Road (0..1), and the metres to go. */
  progress: number;
  metresLeft: number;
  /** Seconds on the countdown (before the run or the fuse), or null. */
  countdown: number | null;
  crew: string[];
}

interface Raider {
  jeep: EnemyJeep;
  kind: 'shooter' | 'rammer';
  lane: number;
  alongStart: number;
  alongEnd: number;
  age: number;
  life: number;
  phase: number;
  fire: number;
  pos: THREE.Vector2;
  heading: number;
}

interface SetPiece {
  at: number;
  point: THREE.Vector3;
  done: boolean;
}

const CRUISE_SPEED = 24;
const ACCELERATION = 7;
/** Fitting a part or all of them at the rig: how close the player has to be. */
const DELIVER_RADIUS = 48;
const ASSEMBLE_TIME = 6.5;
const BOARD_TIME = 1.4;
const MAX_RAIDERS = 9;
const WAVE_FIRST = 70;
const WAVE_EVERY = 170;
/** Bullets (and the rate they're fired at) from a raider and from a gunner on the rig. */
const RAIDER_FIRE_GAP = 0.3;
const GUNNER_FIRE_GAP = 0.085;
const GUNNER_RANGE = 110;
const BULLET_SPEED = 220;
/** The rig rolling in by itself once the player's been thrown clear. */
const FUSE_SPEED = 15;
const FUSE_MAX = 9;
const GATE_INSET = 98;
const DEMOLITION_GAP = 0.22;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The bomb tanker mission: collect the five parts lying about the map, drive back to the rig
 * parked outside Cooper's base and fit them, then ride Thunder Road to the Fortress. The ride is
 * on rails: the rig follows a planned route at a steady speed while raider jeeps come at it and
 * explosions go off along the road, the buddies man its guns, and the player fires the tank's
 * gun from the rear deck. At the gate the rig is sent in on its own and blows the Fortress up.
 */
export class TankerRun {
  phase: TankerPhase = 'hunt';
  readonly parts: TankerParts;
  readonly rig = new TankerRig();
  private readonly garage: THREE.Vector3;
  private readonly installed = TANKER_PARTS.map(() => false);
  private readonly carried: number[] = [];
  private route: THREE.Vector2[] = [];
  private cumulative: number[] = [];
  private length = 0;
  private s = 0;
  private speed = 0;
  private rigYaw = 0;
  private rigPitch = 0;
  private timer = 0;
  private boardFrom = new THREE.Vector3();
  private readonly raiders: Raider[] = [];
  private nextWave = 0;
  private waveCount = 0;
  private pieces: SetPiece[] = [];
  private readonly rng = mulberry32(1981);
  private smokeTimer = 0;
  private stack = 0;
  private crushTimer = 0;
  private gunFire = [0, 0, 0, 0];
  private countdownShown = -1;
  private gateDir = new THREE.Vector3();
  private gatePoint = new THREE.Vector3();
  private inside = new THREE.Vector3();
  private rally = new THREE.Vector3();
  private fuseLeft = FUSE_MAX;
  private demolition: Building[] = [];
  private demolitionTimer = 0;
  private blastTimer = 0;
  private blastRing = 0;
  private readonly shockwave: THREE.Mesh;
  private shockAge = -1;
  private pieceTimer = 0;
  /** Things that happen a moment from now (a chain of blasts), counted down with the game's own clock so pausing holds them. */
  private delayed: { at: number; run: () => void }[] = [];

  constructor(
    private readonly host: TankerHost,
    /** The enemy base each part drops from (by part number). */
    private readonly sources: string[],
    garage: { x: number; z: number; yaw: number },
  ) {
    this.parts = new TankerParts(host.scene);
    this.garage = new THREE.Vector3(garage.x, heightAt(garage.x, garage.z), garage.z);
    this.rigYaw = garage.yaw;
    this.rig.root.position.copy(this.garage);
    this.rig.root.rotation.set(0, garage.yaw, 0, 'YXZ');
    this.rig.setInstalled(this.installed);
    host.scene.add(this.rig.root);
    this.shockwave = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.shockwave.visible = false;
    host.scene.add(this.shockwave);
  }

  /** The player is locked onto the rig's deck (during the build-up and the ride). */
  get riding(): boolean {
    return this.phase === 'assemble' || this.phase === 'run';
  }

  /** The player's on the run or is watching the finale, so the ordinary mission goals are on hold. */
  get active(): boolean {
    return this.phase !== 'hunt';
  }

  /** The gate, the rig's last roll and the blast are watched from a cut-away camera, with the player left where they were dropped. */
  get cinematic(): boolean {
    return this.phase === 'breach' || this.phase === 'fuse' || this.phase === 'blast' || this.demolition.length > 0;
  }

  /** The finale's camera: out in front of the gate and high enough to see over the wall into the courtyard. */
  cameraShot(): { position: THREE.Vector3; look: THREE.Vector3 } | null {
    if (!this.cinematic) return null;
    const outward = this.gateDir.clone().negate();
    const right = new THREE.Vector3(-this.gateDir.z, 0, this.gateDir.x);
    const position = this.gatePoint.clone().addScaledVector(outward, 46).addScaledVector(right, 20);
    position.y = this.gatePoint.y + 19;
    const look = this.phase === 'breach' ? this.gatePoint.clone().add(new THREE.Vector3(0, 4, 0)) : this.rig.root.position.clone().add(new THREE.Vector3(0, 5, 0));
    return { position, look };
  }

  get metresLeft(): number {
    return Math.max(0, this.length - this.s);
  }

  hud(): TankerHUD {
    const taken = this.parts.taken;
    const lying = this.parts.lying;
    return {
      phase: this.phase,
      parts: TANKER_PARTS.map((name, i) => ({ name, source: this.sources[i] ?? '', lying: lying[i], found: taken[i] || this.installed[i], fitted: this.installed[i] })),
      carried: this.carried.length,
      progress: this.length > 0 ? clamp(this.s / this.length, 0, 1) : 0,
      metresLeft: this.metresLeft,
      countdown: this.phase === 'assemble' && this.timer > 0 ? Math.max(0, ASSEMBLE_TIME - this.timer) : this.phase === 'fuse' ? this.fuseLeft : null,
      crew: this.host.buddyNames(),
    };
  }

  /** Where to point the player: the nearest part to find, or the rig once there's something to fit. */
  waypoint(from: THREE.Vector3): { position: THREE.Vector3; label: string } | null {
    // Once the Fortress is open by the ordinary route, the tanker's just a sideshow.
    if (this.phase !== 'hunt' || !this.host.fortress.locked) return null;
    const rigAt = this.rig.root.position.clone().add(new THREE.Vector3(0, 5, 0));
    if (this.carried.length > 0) {
      const d = Math.hypot(from.x - rigAt.x, from.z - rigAt.z);
      if (d < DELIVER_RADIUS) return null;
      return { position: rigAt, label: `BOMB TANKER ${Math.round(d)} m` };
    }
    const near = this.parts.nearest(from);
    return near ? { position: near.position, label: `${TANKER_PARTS[near.index].toUpperCase()} ${Math.round(near.distance)} m` } : null;
  }

  /** Points along the rig's nose, middle and tail, for knocking trees and lamp posts flat. */
  plowPoints(): THREE.Vector3[] {
    if (!this.riding && this.phase !== 'fuse') return [];
    return [[-1.8, -11], [1.8, -11], [0, -4], [0, 3]].map(([x, z]) => this.rig.root.localToWorld(new THREE.Vector3(x, 0, z)));
  }

  /** An enemy base has fallen: its part drops into the ruins. Returns the part's name. */
  partDropped(index: number, at: THREE.Vector3): string {
    this.parts.spawn(index, at.x, at.z);
    return TANKER_PARTS[index];
  }

  /** Markers for the maps. */
  mapMarkers(): { parts: { x: number; z: number; index: number }[]; rig: { x: number; z: number } } {
    const parts: { x: number; z: number; index: number }[] = [];
    for (let i = 0; i < TANKER_PARTS.length; i++) {
      const p = this.parts.position(i);
      if (p) parts.push({ x: p.x, z: p.z, index: i });
    }
    return { parts, rig: { x: this.rig.root.position.x, z: this.rig.root.position.z } };
  }

  update(dt: number): void {
    const player = this.host.player;
    this.rig.animate(dt, this.phase === 'fuse' || this.phase === 'blast');
    this.updateShockwave(dt);
    this.updateDemolition(dt);
    this.runDelayed(dt);
    if (this.phase === 'hunt') {
      const got = this.parts.update(dt, player);
      for (const i of got) {
        this.carried.push(i);
        const missing = TANKER_PARTS.length - this.installed.filter(Boolean).length - this.carried.length;
        this.host.callout(`GOT THE ${TANKER_PARTS[i].toUpperCase()}!`, '#ffd24a');
        this.host.play('uiConfirm', undefined, 0.8);
        this.host.banner(
          `${TANKER_PARTS[i].toUpperCase()} FOUND!`,
          missing > 0 ? `Take it back to the bomb tanker outside Cooper's Base · ${missing} more to come from the other bases` : 'That\'s all five! Drive back to the bomb tanker outside Cooper\'s Base',
        );
      }
      if (this.carried.length > 0 && player.position.distanceTo(this.rig.root.position) < DELIVER_RADIUS) this.fit();
      return;
    }
    this.parts.update(dt, null);
    if (this.phase === 'assemble') this.updateAssemble(dt);
    else if (this.phase === 'run') this.updateRun(dt);
    else if (this.phase === 'breach') this.updateBreach(dt);
    else if (this.phase === 'fuse') this.updateFuse(dt);
    else if (this.phase === 'blast') this.updateBlast(dt);
    this.updateRaiders(dt);
    this.updateGunners(dt);
  }

  /** The player on the rear deck: after the tank's own step, so it is where the rig is this frame. */
  carryPlayer(): void {
    if (!this.riding) return;
    const deck = this.rig.root.localToWorld(RIG_DECK.clone());
    let at = deck;
    if (this.phase === 'assemble' && this.timer < BOARD_TIME) {
      const t = clamp(this.timer / BOARD_TIME, 0, 1);
      const ease = t * t * (3 - 2 * t);
      at = this.boardFrom.clone().lerp(deck, ease);
      at.y += Math.sin(t * Math.PI) * 4; // a hop up onto the flatbed
    }
    this.host.player.rideAt(at, this.rigYaw);
    this.host.player.heal(1000);
  }

  // ---------- fitting the parts ----------

  private fit(): void {
    const fitted = this.carried.splice(0);
    for (const i of fitted) this.installed[i] = true;
    this.rig.setInstalled(this.installed);
    const at = this.rig.root.position.clone().add(new THREE.Vector3(0, 3, 0));
    this.host.explode(at, 0.9);
    this.host.play('clang', at, 0.9);
    this.host.play('poof', at, 0.6);
    const done = this.installed.filter(Boolean).length;
    if (done < TANKER_PARTS.length) {
      this.host.callout(`FITTED: ${fitted.map((i) => TANKER_PARTS[i].toUpperCase()).join(', ')} · ${done}/${TANKER_PARTS.length}`, '#8fe07a');
      return;
    }
    this.beginAssemble();
  }

  private beginAssemble(): void {
    this.phase = 'assemble';
    this.timer = 0;
    this.host.board();
    this.host.player.heal(1000);
    this.boardFrom.copy(this.host.player.position);
    this.rig.setCrew(this.host.buddyNames(), this.host.nameTags());
    this.planRoute();
    this.host.banner('THE BOMB TANKER IS READY!', 'Your buddies man the guns · hold on, it\'s Thunder Road!');
    this.host.shake(0.7);
    this.host.play('boom', this.rig.root.position, 0.9);
    for (let i = 0; i < 6; i++) {
      const p = this.rig.root.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, 2 + Math.random() * 4, (Math.random() - 0.5) * 16));
      this.later(i * 0.12, () => this.host.explode(p, 0.6 + Math.random() * 0.6));
    }
  }

  private planRoute(): void {
    const fortress = this.host.fortress;
    const start = new THREE.Vector2(this.garage.x, this.garage.z);
    const rally = fortress.gateNear(this.garage.x, this.garage.z);
    this.rally.copy(rally);
    const northern = fortress.rallyPoints[0].distanceTo(rally) < 1;
    const gate = siteToWorld(fortress.site, 0, northern ? GATE_INSET : -GATE_INSET);
    this.gatePoint.set(gate.x, heightAt(gate.x, gate.z), gate.z);
    this.gateDir.copy(fortress.center).sub(this.gatePoint).setY(0).normalize();
    this.inside.copy(fortress.center);
    const toRally = planTankerRoute(start, new THREE.Vector2(rally.x, rally.z), this.host.obstacles);
    // The last stretch is dead straight, up the causeway and through the gate.
    const leg = new THREE.Vector2(gate.x, gate.z).sub(new THREE.Vector2(rally.x, rally.z));
    const legLength = leg.length();
    const straight: THREE.Vector2[] = [];
    for (let d = 3; d < legLength; d += 3) straight.push(new THREE.Vector2(rally.x, rally.z).addScaledVector(leg, d / legLength / 1));
    this.route = [...toRally, ...straight, new THREE.Vector2(gate.x, gate.z)];
    this.cumulative = [0];
    for (let i = 1; i < this.route.length; i++) this.cumulative.push(this.cumulative[i - 1] + this.route[i].distanceTo(this.route[i - 1]));
    this.length = this.cumulative[this.cumulative.length - 1];
    this.s = 0;
    this.buildPieces();
  }

  /** A point and heading at a distance along the route. */
  private at(s: number, into: THREE.Vector3): number {
    const c = this.cumulative;
    const d = clamp(s, 0, this.length);
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = c[hi] - c[lo] || 1;
    const t = (d - c[lo]) / span;
    const a = this.route[lo];
    const b = this.route[hi];
    into.set(a.x + (b.x - a.x) * t, 0, a.y + (b.y - a.y) * t);
    into.y = heightAt(into.x, into.z);
    return Math.atan2(-(b.x - a.x), -(b.y - a.y));
  }

  // ---------- the build-up and the ride ----------

  private updateAssemble(dt: number): void {
    this.timer += dt;
    // The rig shakes and steams while it warms up.
    this.rig.root.position.y = this.garage.y + Math.sin(this.timer * 40) * 0.03;
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.07;
      this.stackSmoke();
    }
    const left = Math.ceil(ASSEMBLE_TIME - this.timer);
    if (left !== this.countdownShown && left <= 3 && left > 0) {
      this.countdownShown = left;
      this.host.callout(`${left}…`, '#ffd24a');
      this.host.play('uiMove', undefined, 0.7, 1.2 - left * 0.1);
      this.host.shake(0.25);
    }
    if (this.timer >= ASSEMBLE_TIME) {
      this.phase = 'run';
      this.s = 0;
      this.speed = 0;
      this.nextWave = WAVE_FIRST;
      this.host.banner('THUNDER ROAD!', 'Shoot the raiders off the rig · the gunners have your back');
      this.host.play('launch', this.rig.root.position, 0.9, 0.6);
      this.host.shake(0.8);
    }
  }

  private updateRun(dt: number): void {
    this.speed = Math.min(CRUISE_SPEED, this.speed + ACCELERATION * dt);
    this.s = Math.min(this.length, this.s + this.speed * dt);
    this.placeRig(dt, this.s);
    this.rig.spin(this.speed * dt);

    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.06;
      this.stackSmoke();
      const tail = this.rig.root.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 3, 0.3, 11));
      this.host.dust(tail);
    }
    // Anything in the way is bowled over.
    this.crushTimer -= dt;
    if (this.crushTimer <= 0) {
      this.crushTimer = 0.25;
      const nose = this.rig.root.localToWorld(new THREE.Vector3(0, 1.5, -11));
      this.host.crush(nose, 8);
    }
    this.updatePieces(dt);
    this.spawnWaves();
    if (this.s >= this.length - 0.5) this.beginBreach();
  }

  private placeRig(dt: number, s: number): void {
    const p = new THREE.Vector3();
    const yaw = this.at(s, p);
    const front = new THREE.Vector3();
    const back = new THREE.Vector3();
    this.at(s + 8, front);
    this.at(s - 8, back);
    this.rigYaw += shortestAngleDelta(this.rigYaw, yaw) * Math.min(1, dt * 5);
    const pitch = Math.atan2(front.y - back.y, 16);
    this.rigPitch = damp(this.rigPitch, pitch, 6, dt);
    this.rig.root.position.set(p.x, p.y, p.z);
    this.rig.root.rotation.set(this.rigPitch, this.rigYaw, 0, 'YXZ');
    this.rig.root.updateMatrixWorld(true);
  }

  /** A puff from one exhaust stack, taking them in turn. */
  private stackSmoke(): void {
    this.stack = 1 - this.stack;
    this.host.smoke(this.rig.root.localToWorld(this.rig.stackTips[this.stack].clone()));
  }

  // ---------- explosions along the road ----------

  private buildPieces(): void {
    this.pieces = [];
    const p = new THREE.Vector3();
    for (let d = 140; d < this.length - 120; d += 50 + this.rng() * 40) {
      const yaw = this.at(d, p);
      const side = this.rng() < 0.5 ? -1 : 1;
      const offset = 9 + this.rng() * 13;
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const point = p.clone().addScaledVector(right, side * offset);
      point.y = heightAt(point.x, point.z);
      this.pieces.push({ at: d, point, done: false });
    }
  }

  private updatePieces(dt: number): void {
    this.pieceTimer += dt;
    for (const piece of this.pieces) {
      if (piece.done || this.s < piece.at - 32) continue;
      piece.done = true;
      const big = this.rng() < 0.4;
      const count = big ? 6 : 3;
      for (let i = 0; i < count; i++) {
        const offset = new THREE.Vector3((this.rng() - 0.5) * 12, 0.5 + this.rng() * 3, (this.rng() - 0.5) * 18);
        const at = piece.point.clone().add(offset);
        this.later(i * 0.13, () => this.host.explode(at, (big ? 2.6 : 1.8) + Math.random()));
      }
      this.host.play('boom', piece.point, 0.8, 0.9);
    }
  }

  // ---------- raiders ----------

  private spawnWaves(): void {
    if (this.s < this.nextWave || this.s > this.length - 160) return;
    this.nextWave += WAVE_EVERY;
    const wave = this.waveCount++;
    const count = Math.min(MAX_RAIDERS - this.raiders.length, 3 + Math.min(3, wave));
    if (count <= 0) return;
    const rammers = wave >= 1 && wave % 3 === 1 ? 2 : wave >= 4 ? 1 : 0;
    this.host.callout(wave === 0 ? 'RAIDERS! THEY\'RE ON US!' : rammers ? 'RAMMERS INCOMING!' : 'MORE RAIDERS!', '#ff8a5a');
    for (let i = 0; i < count; i++) {
      const rammer = i < rammers;
      const side = i % 2 === 0 ? -1 : 1;
      const lane = side * (rammer ? 18 : 7 + (i % 3) * 3.5);
      const ahead = !rammer && i % 3 !== 2;
      this.spawnRaider({
        kind: rammer ? 'rammer' : 'shooter',
        lane,
        alongStart: rammer ? -(70 + i * 10) : ahead ? 120 : -110,
        alongEnd: rammer ? 0 : ahead ? 8 - i * 4 : -12 + i * 3,
        life: rammer ? 14 : 26,
      });
    }
  }

  /** `alongStart` is metres ahead of the rig centre (negative: behind) when it arrives. */
  private spawnRaider(o: { kind: Raider['kind']; lane: number; alongStart: number; alongEnd: number; life: number }): void {
    const rigPos = this.rig.root.position;
    const f = new THREE.Vector3(0, 0, -1).applyAxisAngle(UP, this.rigYaw);
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const x = rigPos.x + f.x * o.alongStart + r.x * o.lane;
    const z = rigPos.z + f.z * o.alongStart + r.z * o.lane;
    const color = this.raiders.length % 2 === 0 ? ARMY_TAN : ARMY_BLUE;
    const jeep = new EnemyJeep(this.host.world, x, z, color, this.rigYaw);
    this.host.register(jeep);
    this.raiders.push({
      jeep,
      kind: o.kind,
      lane: o.lane,
      alongStart: o.alongStart,
      alongEnd: o.alongEnd,
      age: 0,
      life: o.life,
      phase: Math.random() * 6,
      fire: 0.5 + Math.random() * 0.5,
      pos: new THREE.Vector2(x, z),
      heading: this.rigYaw,
    });
  }

  private updateRaiders(dt: number): void {
    const rigPos = this.rig.root.position;
    const f = new THREE.Vector3(0, 0, -1).applyAxisAngle(UP, this.rigYaw);
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const flying = this.phase === 'run';
    for (let i = this.raiders.length - 1; i >= 0; i--) {
      const raid = this.raiders[i];
      const jeep = raid.jeep;
      if (jeep.isDestroyed) {
        this.host.remove(jeep, true);
        this.raiders.splice(i, 1);
        continue;
      }
      raid.age += dt;
      // Once the run is over, or their time's up, they break off and fall away.
      const leaving = !flying || raid.age > raid.life;
      if (leaving && raid.age > raid.life + 4) {
        this.host.remove(jeep, false);
        this.raiders.splice(i, 1);
        continue;
      }
      const t = clamp(raid.age / 8, 0, 1);
      const ease = t * t * (3 - 2 * t);
      let along = raid.alongStart + (raid.alongEnd - raid.alongStart) * ease;
      let lane = raid.lane + Math.sin(raid.age * 1.6 + raid.phase) * 2.2;
      if (raid.kind === 'rammer') lane = raid.lane * (1 - ease);
      if (leaving) {
        along -= (raid.age - Math.min(raid.age, raid.life)) * 30 + 10;
        lane += Math.sign(raid.lane || 1) * (raid.age - Math.min(raid.age, raid.life)) * 5;
      }
      const tx = rigPos.x + f.x * along + r.x * lane;
      const tz = rigPos.z + f.z * along + r.z * lane;
      const dx = tx - raid.pos.x;
      const dz = tz - raid.pos.y;
      const dist = Math.hypot(dx, dz);
      const maxSpeed = this.speed + (raid.kind === 'rammer' ? 22 : 16);
      const step = Math.min(dist, maxSpeed * dt);
      if (dist > 0.01) {
        raid.pos.x += (dx / dist) * step;
        raid.pos.y += (dz / dist) * step;
      }
      // Face the way the rig is going, swinging round to whatever they're chasing when far off.
      const goal = dist > 12 ? Math.atan2(-dx, -dz) : this.rigYaw;
      raid.heading += shortestAngleDelta(raid.heading, goal) * Math.min(1, dt * 4);
      jeep.place(raid.pos.x, raid.pos.y, raid.heading, dt);

      const toRig = Math.hypot(rigPos.x - raid.pos.x, rigPos.z - raid.pos.y);
      if (raid.kind === 'rammer' && toRig < 6.5 && flying) {
        // Slams into the side: a blast (as it goes), and the rig shrugs it off.
        this.host.shake(0.7);
        this.host.callout(Math.random() < 0.5 ? 'RAMMER! IT BOUNCED OFF!' : 'WHAM! STILL ROLLING!', '#ffb050');
        jeep.health = 0;
        continue;
      }
      if (raid.kind === 'shooter' && !leaving && toRig < 75) {
        raid.fire -= dt;
        if (raid.fire <= 0) {
          raid.fire = RAIDER_FIRE_GAP * (0.8 + Math.random() * 0.8);
          this.raiderShot(raid);
        }
      }
    }
  }

  private raiderShot(raid: Raider): void {
    const from = raid.jeep.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    const aim = this.rig.root.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 18));
    // Mostly a near miss: the rounds stream past and bang off the ground and the road.
    aim.x += (Math.random() - 0.5) * 7;
    aim.z += (Math.random() - 0.5) * 7;
    const direction = aim.sub(from).normalize();
    this.host.flash(from, direction, 0.3);
    this.host.play('crack', from, 0.18, 2.6, 0.07);
    this.host.tracer(from, direction, 'enemy');
    if (Math.random() < 0.1) {
      const hit = this.rig.root.localToWorld(new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 4), 0.5, (Math.random() - 0.5) * 18));
      this.host.explode(hit, 0.7 + Math.random() * 0.7);
      this.host.shake(0.14);
    }
  }

  // ---------- the gunners ----------

  private updateGunners(dt: number): void {
    if (!this.rig.complete || this.phase === 'hunt') return;
    const shooting = this.phase === 'run' || this.phase === 'assemble';
    const player = this.host.player;
    for (let g = 0; g < this.rig.gunCount; g++) {
      this.gunFire[g] = Math.max(0, this.gunFire[g] - dt);
      let best: Raider | null = null;
      let bestD = GUNNER_RANGE;
      const gunAt = this.rig.gunPosition(g);
      if (shooting) {
        for (const raid of this.raiders) {
          if (raid.jeep.isDestroyed) continue;
          const d = raid.jeep.position.distanceTo(gunAt);
          if (d < bestD) {
            bestD = d;
            best = raid;
          }
        }
      }
      if (!best) {
        this.rig.aimGun(g, null, dt);
        continue;
      }
      const aim = best.jeep.position.clone().add(new THREE.Vector3(0, 0.8, 0));
      aim.addScaledVector(best.jeep.velocity, bestD / BULLET_SPEED);
      aim.y += 0.0025 * bestD * bestD / 40; // drop over the range
      this.rig.aimGun(g, aim, dt);
      if (this.gunFire[g] > 0 || !this.rig.gunOn(g, aim, 0.12)) continue;
      this.gunFire[g] = GUNNER_FIRE_GAP;
      const { origin, direction } = this.rig.muzzle(g);
      direction.x += (Math.random() - 0.5) * 0.05;
      direction.y += (Math.random() - 0.5) * 0.05;
      direction.z += (Math.random() - 0.5) * 0.05;
      direction.normalize();
      this.host.flash(origin, direction, 0.35);
      this.host.play('crack', origin, 0.12, 2.8, 0.05);
      this.host.tracer(origin, direction, 'player', player.physicsCollider);
    }
  }

  // ---------- the gate and the bomb ----------

  private beginBreach(): void {
    this.phase = 'breach';
    this.timer = 0;
    const fortress = this.host.fortress;
    fortress.blowGates();
    this.host.explode(this.gatePoint.clone().add(new THREE.Vector3(0, 4, 0)), 5);
    for (let i = 0; i < 7; i++) {
      const at = this.gatePoint.clone().add(new THREE.Vector3((Math.random() - 0.5) * 26, 1 + Math.random() * 9, (Math.random() - 0.5) * 12));
      this.later(0.06 + i * 0.09, () => this.host.explode(at, 2 + Math.random() * 2));
    }
    this.host.play('boom', this.gatePoint, 1);
    this.host.shake(1.2);
    this.host.banner('THE GATES ARE BLOWN!', 'Everybody out! The tanker is going in on its own');
    // Everyone bails out: the crew vanish into a puff, and the player's tank lands back up the road.
    this.rig.setCrew(null, false);
    const p = this.host.player;
    const back = this.rally.clone();
    p.teleport(back.x, back.z, Math.atan2(-this.gateDir.x, -this.gateDir.z));
    p.heal(1000);
    for (const raid of this.raiders) raid.age = Math.max(raid.age, raid.life);
    this.speed = 0;
  }

  private updateBreach(dt: number): void {
    this.timer += dt;
    this.speed = Math.min(FUSE_SPEED, this.speed + 10 * dt);
    if (this.timer > 1.6) {
      this.phase = 'fuse';
      this.fuseLeft = FUSE_MAX;
      this.host.callout('THE BOMB IS ARMED! KEEP BACK!', '#ff5a4a');
    }
  }

  private updateFuse(dt: number): void {
    this.fuseLeft -= dt;
    this.speed = FUSE_SPEED;
    const rig = this.rig.root;
    const toCentre = this.inside.clone().sub(rig.position).setY(0);
    const dist = toCentre.length();
    const step = Math.min(dist, this.speed * dt);
    if (dist > 0.1) rig.position.addScaledVector(toCentre, step / dist);
    rig.position.y = heightAt(rig.position.x, rig.position.z);
    this.rigYaw += shortestAngleDelta(this.rigYaw, Math.atan2(-this.gateDir.x, -this.gateDir.z)) * Math.min(1, dt * 4);
    rig.rotation.set(0, this.rigYaw, 0, 'YXZ');
    rig.updateMatrixWorld(true);
    this.rig.spin(this.speed * dt);
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.05;
      this.stackSmoke();
    }
    this.crushTimer -= dt;
    if (this.crushTimer <= 0) {
      this.crushTimer = 0.2;
      this.host.crush(rig.localToWorld(new THREE.Vector3(0, 1.5, -10)), 9);
      if (Math.random() < 0.6) {
        const at = rig.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 18));
        this.host.explode(at, 1 + Math.random() * 0.8);
      }
    }
    if (dist < 6 || this.fuseLeft <= 0) this.beginBlast();
  }

  private beginBlast(): void {
    this.phase = 'blast';
    this.blastTimer = 0;
    this.blastRing = 0;
    const at = this.rig.root.position.clone().add(new THREE.Vector3(0, 3, 0));
    this.host.banner('K A B O O O M !', 'The Fortress is coming down');
    this.host.play('boom', at, 1, 0.7);
    this.host.shake(1.2);
    this.host.explode(at.clone().add(new THREE.Vector3(0, 3, 0)), 7);
    this.rig.root.visible = false;
    this.shockAge = 0;
    this.shockwave.visible = true;
    this.shockwave.position.copy(at);
    this.demolition = [...this.host.fortress.buildings].sort((a, b) => a.center.distanceTo(at) - b.center.distanceTo(at));
    this.demolitionTimer = 0.4;
  }

  private updateBlast(dt: number): void {
    this.blastTimer += dt;
    const centre = this.rig.root.position;
    // A ring of fireballs spreading out over the courtyard.
    while (this.blastRing < 14 && this.blastTimer > this.blastRing * 0.11) {
      const a = Math.random() * Math.PI * 2;
      const radius = 6 + this.blastRing * 4.5;
      const at = new THREE.Vector3(centre.x + Math.cos(a) * radius, centre.y + 2 + Math.random() * 9, centre.z + Math.sin(a) * radius);
      this.host.explode(at, 3.5 + Math.random() * 2.5);
      this.blastRing++;
    }
    if (this.demolition.length === 0 && this.blastRing >= 14) {
      this.phase = 'done';
      this.host.callout('BOOM!', '#ffd24a');
    }
  }

  private updateDemolition(dt: number): void {
    if (this.demolition.length === 0) return;
    this.demolitionTimer -= dt;
    while (this.demolitionTimer <= 0 && this.demolition.length > 0) {
      this.demolitionTimer += DEMOLITION_GAP;
      const b = this.demolition.shift() as Building;
      if (b.destroyed) continue;
      this.host.collapse(b);
    }
  }

  private updateShockwave(dt: number): void {
    if (this.shockAge < 0) return;
    this.shockAge += dt;
    const t = this.shockAge / 1.4;
    if (t >= 1) {
      this.shockAge = -1;
      this.shockwave.visible = false;
      return;
    }
    this.shockwave.scale.setScalar(4 + t * 190);
    (this.shockwave.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t) ** 2;
  }

  private later(seconds: number, run: () => void): void {
    this.delayed.push({ at: seconds, run });
  }

  private runDelayed(dt: number): void {
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const d = this.delayed[i];
      d.at -= dt;
      if (d.at > 0) continue;
      this.delayed.splice(i, 1);
      d.run();
    }
  }

  /** Debug: the parts all fitted, and the run about to start. */
  skipToRun(): void {
    for (let i = 0; i < this.installed.length; i++) this.installed[i] = true;
    this.rig.setInstalled(this.installed);
    this.beginAssemble();
  }
}
