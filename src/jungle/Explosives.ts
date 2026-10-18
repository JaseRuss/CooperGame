import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { FRIEND_SHOTS } from '../prison/groups';

const GRAVITY = 15;
const FUSE = 2.6;
const BOMB_FUSE = 7;
/** A grenade goes off when it hits something, or when its fuse runs out. */
export const GRENADE_RADIUS = 7;
export const BOMB_RADIUS = 17;

interface Grenade {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  byPlayer: boolean;
}

export interface Bomb {
  pos: THREE.Vector3;
  left: number;
  mesh: THREE.Group;
  light: THREE.Mesh;
}

export interface Blast {
  at: THREE.Vector3;
  radius: number;
  /** A grenade or a bomb. */
  kind: 'grenade' | 'bomb';
  /** Thrown or fired by the player himself (not one of his men). */
  byPlayer: boolean;
}

const grenadeGeo = new THREE.SphereGeometry(0.2, 8, 6);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3d4a2e, roughness: 0.6 });

/**
 * Grenades from the launcher (lobbed, bouncing nowhere: they burst on the first thing they hit or
 * when the fuse runs out) and the satchel bomb planted at an outpost's ammo dump (a long fuse, a
 * blinking light, a much bigger bang).
 */
export class Explosives {
  private readonly grenades: Grenade[] = [];
  readonly bombs: Bomb[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: RAPIER.World,
    /** The height of the ground (flat at 0 unless the level has hills). */
    private readonly groundAt: (x: number, z: number) => number = () => 0,
  ) {}

  launch(origin: THREE.Vector3, dir: THREE.Vector3, speed = 24, byPlayer = true): void {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.grenades.push({ mesh, vel: dir.clone().normalize().multiplyScalar(speed), age: 0, byPlayer });
  }

  /** A bomb set down at `pos`, ticking. */
  plant(pos: THREE.Vector3): Bomb {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.45), new THREE.MeshStandardMaterial({ color: 0x5a3b24 }));
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x24262a }));
    strap.position.y = 0.1;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    light.position.set(0, 0.34, 0);
    g.add(body, strap, light);
    g.position.copy(pos);
    this.scene.add(g);
    const bomb: Bomb = { pos: pos.clone(), left: BOMB_FUSE, mesh: g, light };
    this.bombs.push(bomb);
    return bomb;
  }

  /** The positions of bombs that are armed. */
  armed(): THREE.Vector3[] {
    return this.bombs.map((b) => b.pos);
  }

  /** The seconds left on the shortest fuse, or null with none armed. */
  get shortestFuse(): number | null {
    return this.bombs.length ? Math.min(...this.bombs.map((b) => b.left)) : null;
  }

  update(dt: number, burst: (b: Blast) => void, trail: (p: THREE.Vector3) => void): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.age += dt;
      const from = g.mesh.position.clone();
      g.vel.y -= GRAVITY * dt;
      const step = g.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const ground = this.groundAt(g.mesh.position.x, g.mesh.position.z);
      let hit = g.mesh.position.y + step.y <= ground + 0.15;
      if (!hit && len > 1e-4) {
        const ray = this.world.castRay(new RAPIER.Ray(from, step.clone().normalize()), len + 0.1, true, undefined, FRIEND_SHOTS);
        if (ray) {
          g.mesh.position.addScaledVector(step.clone().normalize(), Math.max(0, ray.timeOfImpact - 0.05));
          hit = true;
        }
      }
      if (!hit) g.mesh.position.add(step);
      if (Math.random() < 0.5) trail(g.mesh.position);
      if (hit || g.age > FUSE) {
        if (g.mesh.position.y < ground + 0.2) g.mesh.position.y = ground + 0.2;
        burst({ at: g.mesh.position.clone(), radius: GRENADE_RADIUS, kind: 'grenade', byPlayer: g.byPlayer });
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.left -= dt;
      // The light blinks faster and faster.
      const rate = b.left < 2 ? 22 : b.left < 4 ? 10 : 4;
      b.light.visible = Math.sin((BOMB_FUSE - b.left) * rate) > -0.2;
      if (b.left > 0) continue;
      burst({ at: b.pos.clone().setY(b.pos.y + 0.35), radius: BOMB_RADIUS, kind: 'bomb', byPlayer: true });
      this.scene.remove(b.mesh);
      this.bombs.splice(i, 1);
    }
  }
}
