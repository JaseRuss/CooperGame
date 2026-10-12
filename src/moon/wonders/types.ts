import type * as THREE from 'three';
import type { SoundName } from '../../audio/Sound';

/** What a tableau can do each frame: its clock, where the buggy is, and a few ways to make a fuss. */
export interface WonderCtx {
  dt: number;
  /** Seconds since the Weird Side was made. */
  t: number;
  /** How far the buggy is from the tableau's middle, along the ground. */
  dist: number;
  /** The buggy's position and velocity in the tableau's own frame (its +Z is "forward"). */
  buggy: THREE.Vector3;
  buggyVel: THREE.Vector3;
  /** A line in the middle of the screen that floats up (a moo, a shout). */
  say(text: string, color?: string): void;
  /** A sound from this tableau. */
  sound(name: SoundName, volume?: number, rate?: number): void;
  /** A puff of Moon dust at a point in the tableau's frame. */
  dust(at: THREE.Vector3, count?: number, speed?: number): void;
  confetti(at: THREE.Vector3): void;
  boom(at: THREE.Vector3, size?: number): void;
  /** Water thrown up (a whale's spout, a splash). */
  splash(at: THREE.Vector3, size?: number): void;
}

/** Things a tableau sets up while it's being built: obstacles, and the gadgets the buggy can play on. */
export interface WonderTools {
  /** A round obstacle the buggy bumps into (or sails over if it's higher than `h`). Local coordinates. */
  solid(x: number, z: number, r: number, h: number): void;
  /** A springy pad: drive onto it and the buggy is flung up at `boost` m/s. */
  bouncer(x: number, z: number, r: number, boost: number): void;
  /** A ramp the buggy drives up (it's part of the ground), rising `rise` over `len` toward local yaw `yaw`. */
  ramp(x: number, z: number, yaw: number, len: number, halfW: number, rise: number): void;
  /** Zoom arrows: drive over them heading `yaw` and the buggy goes at least `speed`. */
  boost(x: number, z: number, yaw: number, len: number, halfW: number, speed: number): void;
  /** A cannon: drive into its breech at (x, z) and the buggy is fired from `muzzle` at `pitch` up, toward `yaw`, to land `range` metres away. */
  cannon(x: number, z: number, r: number, muzzle: THREE.Vector3, yaw: number, pitch: number, range: number): void;
  /** One of a pair of doors: drive through one and come out of the other. Doors with the same `pair` are linked. */
  door(pair: string, x: number, z: number, yaw: number, halfW: number): void;
  /** The ground height at a local point, relative to the tableau's own base. */
  groundAt(x: number, z: number): number;
  rng: () => number;
}

/** A tableau's frame-by-frame animation. */
export type WonderAnim = (ctx: WonderCtx) => void;

/** One of the odd things to find on the Weird Side. */
export interface WonderDef {
  id: string;
  /** Shown big when it's found. */
  title: string;
  /** The joke under the title. */
  line: string;
  x: number;
  z: number;
  /** Which way its +Z faces (radians, like the buggy's yaw). */
  yaw?: number;
  /** Radius of flat ground it needs (0 for none). */
  r: number;
  /** More flat ground elsewhere (in the world), like the cannon's far-off target. */
  zones?: { x: number; z: number; r: number }[];
  /** How close the buggy must come to find it (defaults to a bit more than `r`). */
  find?: number;
  /** Left off the map until it's found (the hiding ones). */
  secret?: boolean;
  /** Keeps animating however far away the buggy is (the whale in the sky, the rainbow). */
  always?: boolean;
  build(g: THREE.Group, tools: WonderTools): WonderAnim | void;
}
