import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Building } from './Building';
import type { HitRegistry } from '../combat/HitRegistry';
import { heightAt } from './Terrain';
import { plastic, shade, ARMY_TAN } from '../utils/plastic';
import type { Shot } from '../entities/Soldier';

const BUNKER_COLOR = 0xa99f86;
const BUNKER_HEALTH = 180;
const GUN_RANGE = 170;
const GUN_ARC = (80 * Math.PI) / 180; // either side of the firing slit
const BURST_SIZE = 6;
const BURST_GAP = 0.09;
const BURST_COOLDOWN = 2.2;
const LOS_INTERVAL = 0.5;
const GUN_TURN_RATE = 1.8;

function buildBunkerMesh(): { root: THREE.Group; gunPivot: THREE.Group } {
  const root = new THREE.Group();
  const concrete = plastic(BUNKER_COLOR);
  const dark = plastic(shade(BUNKER_COLOR, 0.35));
  const sandbag = plastic(shade(ARMY_TAN, 0.85));

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(7, 2.4, 6), concrete, 0, 1.2, 0);
  add(new THREE.BoxGeometry(7.8, 0.5, 6.8), concrete, 0, 2.65, 0); // roof slab
  add(new THREE.BoxGeometry(4.2, 0.45, 0.3), dark, 0, 1.6, -2.92); // firing slit
  add(new THREE.BoxGeometry(1.2, 1.8, 0.2), dark, 1.8, 0.9, 3.02); // rear door

  // Two rows of sandbags wrapped around the front.
  const bagGeo = new THREE.CapsuleGeometry(0.28, 0.7, 4, 8).rotateZ(Math.PI / 2).scale(1, 0.75, 1);
  for (let row = 0; row < 2; row++) {
    for (let i = -5; i <= 5; i++) {
      const a = (i / 5) * 1.1;
      const r = 4.4;
      const bag = add(bagGeo, sandbag, Math.sin(a) * r + (row ? 0.35 : 0), 0.22 + row * 0.4, -Math.cos(a) * r - 0.3);
      bag.rotation.y = a;
    }
  }

  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, 1.6, -2.7);
  root.add(gunPivot);
  add(new THREE.CylinderGeometry(0.07, 0.08, 1.5, 8).rotateX(Math.PI / 2), dark, 0, 0, -0.75, gunPivot);
  add(new THREE.BoxGeometry(0.3, 0.25, 0.5), dark, 0, 0, 0, gunPivot);

  return { root, gunPivot };
}

/** A destructible pillbox whose machine gun fires bursts at the player within its front arc. */
export class Bunker {
  readonly building: Building;
  private readonly gunPivot: THREE.Group;
  private readonly facing: number;
  private gunYaw = 0;
  private burstLeft = 0;
  private burstTimer = 0;
  private cooldown = Math.random() * BURST_COOLDOWN;
  private losTimer = Math.random() * LOS_INTERVAL;
  private seesPlayer = false;

  constructor(world: RAPIER.World, scene: THREE.Scene, hitRegistry: HitRegistry, x: number, z: number, facing: number) {
    const { root, gunPivot } = buildBunkerMesh();
    this.gunPivot = gunPivot;
    this.facing = facing;
    root.rotation.y = facing;
    root.position.set(x, heightAt(x, z) - 0.4, z); // sunk a little so slopes don't leave it floating
    scene.add(root);

    const box = new THREE.Box3().setFromObject(root);
    this.building = new Building(
      world,
      scene,
      hitRegistry,
      root,
      box.getSize(new THREE.Vector3()).multiplyScalar(0.5),
      box.getCenter(new THREE.Vector3()),
      BUNKER_HEALTH,
      BUNKER_COLOR,
    );
  }

  get alive(): boolean {
    return !this.building.destroyed;
  }

  get position(): THREE.Vector3 {
    return this.building.center;
  }

  update(dt: number, world: RAPIER.World, playerPos: THREE.Vector3): Shot | null {
    if (!this.alive) return null;

    const muzzle = this.gunPivot.localToWorld(new THREE.Vector3(0, 0, -1.5));
    const toPlayer = playerPos.clone().sub(muzzle);
    const dist = toPlayer.length();
    if (dist > GUN_RANGE * 1.5) return null;

    // Angle of the player relative to the slit, in the bunker's own frame.
    const worldYaw = Math.atan2(-toPlayer.x, -toPlayer.z);
    let rel = worldYaw - this.facing;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const inArc = Math.abs(rel) < GUN_ARC;

    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = LOS_INTERVAL;
      const exclude = this.building.physicsCollider ?? undefined;
      this.seesPlayer =
        inArc &&
        dist < GUN_RANGE &&
        world.castRay(new RAPIER.Ray(muzzle, toPlayer.clone().normalize()), Math.max(0, dist - 3), true, undefined, undefined, exclude) === null;
    }

    const targetYaw = this.seesPlayer ? THREE.MathUtils.clamp(rel, -GUN_ARC, GUN_ARC) : 0;
    const maxStep = GUN_TURN_RATE * dt;
    this.gunYaw += THREE.MathUtils.clamp(targetYaw - this.gunYaw, -maxStep, maxStep);
    this.gunPivot.rotation.y = this.gunYaw;
    this.gunPivot.rotation.x = this.seesPlayer ? Math.atan2(toPlayer.y, Math.hypot(toPlayer.x, toPlayer.z)) : 0;

    this.cooldown -= dt;
    if (this.seesPlayer && this.burstLeft === 0 && this.cooldown <= 0 && Math.abs(targetYaw - this.gunYaw) < 0.15) {
      this.burstLeft = BURST_SIZE;
      this.burstTimer = 0;
    }
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = BURST_GAP;
        this.burstLeft--;
        if (this.burstLeft === 0) this.cooldown = BURST_COOLDOWN;
        const dir = toPlayer.normalize();
        dir.x += (Math.random() - 0.5) * 0.05;
        dir.y += (Math.random() - 0.5) * 0.03;
        dir.z += (Math.random() - 0.5) * 0.05;
        return { origin: muzzle, direction: dir.normalize() };
      }
    }
    return null;
  }
}
