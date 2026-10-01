import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PartBuilder } from '../utils/modelKit';
import { plastic } from '../utils/plastic';

const CONCRETE = 0x9c988c;
const CONCRETE_DARK = 0x7d7a70;
const ROOF = 0x5d6266;
const STEEL = 0x3e4246;
const WOOD = 0x8a6a3e;
const LAMP = 0xfff1b8;

/** Wall height outside, and the cell block's ceiling. */
const YARD_WALL = 4;
const CEILING = 3.6;
const WALL = 0.6;

/** The yard's inside edges. */
const YARD = { minX: -30, maxX: 30, minZ: -25, maxZ: 25 };
/** The cell block, against the yard's south wall: a corridor along the front, cells behind it. */
const BLOCK = { minX: -20, maxX: 20, minZ: 10, maxZ: 22, corridor: 14 };
const CELL_WIDTH = 5;

export interface FacilityLayout {
  /** Where the player starts, and faces. */
  start: { x: number; z: number; yaw: number };
  /** Spots for the practice dummies. */
  dummies: { x: number; z: number; yaw: number }[];
  /** True inside the cell block (for the objective). */
  inBlock(x: number, z: number): boolean;
}

/**
 * The prison compound, built from boxes with `PartBuilder` like the rest of the game's models,
 * with a fixed Rapier cuboid for every solid part. So far: a walled exercise yard with crates for
 * cover and one cell block with a corridor and a row of barred cells.
 */
export class Facility {
  readonly group = new THREE.Group();
  readonly layout: FacilityLayout;
  private readonly body: RAPIER.RigidBody;
  private readonly parts = new PartBuilder();
  private readonly box = new THREE.BoxGeometry(1, 1, 1);

  constructor(private readonly world: RAPIER.World) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.buildGround();
    this.buildYard();
    this.buildCellBlock();
    this.parts.buildInto(this.group);
    this.box.dispose();
    this.layout = {
      start: { x: 0, z: -12, yaw: Math.PI }, // facing the cell block (+Z)
      dummies: [
        { x: -14, z: -4, yaw: Math.PI },
        { x: -6, z: 2, yaw: Math.PI },
        { x: 8, z: -2, yaw: Math.PI },
        { x: 17, z: 4, yaw: Math.PI },
        { x: 24, z: -18, yaw: Math.PI / 2 },
        { x: -6, z: 12, yaw: Math.PI / 2 },
      ],
      inBlock: (x, z) => x > BLOCK.minX && x < BLOCK.maxX && z > BLOCK.minZ && z < BLOCK.maxZ,
    };
  }

  /** A solid box from (x0, y0, z0) to (x1, y1, z1): drawn, and something to bump into. */
  private solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, collide = true): void {
    const sx = x1 - x0;
    const sy = y1 - y0;
    const sz = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    this.parts.add(this.box, plastic(color), cx, cy, cz, 0, 0, 0, sx, sy, sz);
    if (collide) this.blocker(x0, y0, z0, x1, y1, z1);
  }

  /** Something to bump into (and shoot at) with nothing drawn: the drawn part is bars, say. */
  private blocker(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const desc = RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.world.createCollider(desc, this.body);
  }

  private buildGround(): void {
    const size = 240;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#857f70';
    ctx.fillRect(0, 0, 256, 256);
    // Paving slabs, each a slightly different shade, with dark joints.
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = 118 + Math.floor(Math.random() * 18);
        ctx.fillStyle = `rgb(${v + 8},${v + 4},${v - 8})`;
        ctx.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(size / 8, size / 8);
    tex.anisotropy = 4;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    ground.receiveShadow = true;
    this.group.add(ground);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2).setTranslation(0, -0.5, 0), this.body);
  }

  private buildYard(): void {
    const { minX, maxX, minZ, maxZ } = YARD;
    const h = YARD_WALL;
    // Perimeter wall, with a locked gate in the north side.
    this.solid(minX - WALL, 0, minZ - WALL, -3, h, minZ, CONCRETE);
    this.solid(3, 0, minZ - WALL, maxX + WALL, h, minZ, CONCRETE);
    this.solid(minX - WALL, 0, maxZ, maxX + WALL, h, maxZ + WALL, CONCRETE);
    this.solid(minX - WALL, 0, minZ, minX, h, maxZ, CONCRETE);
    this.solid(maxX, 0, minZ, maxX + WALL, h, maxZ, CONCRETE);
    // A coping strip along the top, for a bit of shape.
    for (const [x0, z0, x1, z1] of [
      [minX - WALL - 0.15, minZ - WALL - 0.15, maxX + WALL + 0.15, minZ + 0.15],
      [minX - WALL - 0.15, maxZ - 0.15, maxX + WALL + 0.15, maxZ + WALL + 0.15],
      [minX - WALL - 0.15, minZ, minX + 0.15, maxZ],
      [maxX - 0.15, minZ, maxX + WALL + 0.15, maxZ],
    ]) {
      this.solid(x0, h, z0, x1, h + 0.25, z1, CONCRETE_DARK, false);
    }
    // The gate: steel bars between two posts.
    this.solid(-3.6, 0, minZ - WALL - 0.2, -3, h + 0.6, minZ + 0.2, CONCRETE_DARK);
    this.solid(3, 0, minZ - WALL - 0.2, 3.6, h + 0.6, minZ + 0.2, CONCRETE_DARK);
    this.bars(-3, 3, minZ - WALL / 2, h);
    this.blocker(-3, 0, minZ - WALL / 2 - 0.05, 3, h, minZ - WALL / 2 + 0.05);

    // Crates for cover round the yard.
    const crate = (x: number, z: number, s = 1.2, stack = 1) => {
      for (let i = 0; i < stack; i++) {
        this.solid(x - s / 2, i * s, z - s / 2, x + s / 2, (i + 1) * s, z + s / 2, WOOD);
        this.solid(x - s / 2 - 0.02, i * s + s * 0.42, z - s / 2 - 0.02, x + s / 2 + 0.02, i * s + s * 0.58, z + s / 2 + 0.02, 0x6e5230, false);
      }
    };
    crate(-12, -8, 1.2, 2);
    crate(-10.6, -8);
    crate(5, -6);
    crate(6.3, -6.2, 1.2, 2);
    crate(14, -14);
    crate(-20, 4, 1.2, 2);
    crate(20, 0);
    crate(-24, -16);
    // A low wall to run along.
    this.solid(-4, 0, -2, 4, 1.1, -1.4, CONCRETE_DARK);
  }

  private buildCellBlock(): void {
    const { minX, maxX, minZ, maxZ, corridor } = BLOCK;
    const h = CEILING;
    // Outside walls; the front has a doorway in the middle.
    this.solid(minX - WALL, 0, minZ - WALL, -1.6, h, minZ, CONCRETE);
    this.solid(1.6, 0, minZ - WALL, maxX + WALL, h, minZ, CONCRETE);
    this.solid(-1.6, 2.7, minZ - WALL, 1.6, h, minZ, CONCRETE);
    this.solid(minX - WALL, 0, minZ, minX, h, maxZ, CONCRETE);
    this.solid(maxX, 0, minZ, maxX + WALL, h, maxZ, CONCRETE);
    this.solid(minX - WALL, 0, maxZ, maxX + WALL, h, maxZ + WALL, CONCRETE);
    // Roof slab, with an overhang over the door.
    this.solid(minX - WALL - 0.3, h, minZ - WALL - 0.3, maxX + WALL + 0.3, h + 0.35, maxZ + WALL + 0.3, ROOF);
    this.solid(-2.4, 2.9, minZ - 2.2, 2.4, 3.1, minZ - WALL, ROOF);
    // A sign over the door.
    this.solid(-2, 3.15, minZ - WALL - 0.12, 2, 3.55, minZ - WALL, 0xd9c35a, false);
    // Floor inside, a shade darker than the yard.
    this.solid(minX, 0, minZ, maxX, 0.02, maxZ, CONCRETE_DARK, false);

    // Cells: partition walls, and a barred front on each with a door in it.
    for (let x = minX + CELL_WIDTH; x < maxX; x += CELL_WIDTH) {
      this.solid(x - 0.15, 0, corridor, x + 0.15, h, maxZ, CONCRETE);
    }
    for (let x = minX; x < maxX; x += CELL_WIDTH) {
      this.bars(x + 0.15, x + CELL_WIDTH - 0.15, corridor, h);
      this.blocker(x + 0.15, 0, corridor - 0.05, x + CELL_WIDTH - 0.15, h, corridor + 0.05);
      // A bunk and a bucket in each.
      this.solid(x + 0.5, 0, maxZ - 1, x + 2.6, 0.55, maxZ - 0.1, WOOD);
      this.solid(x + 3.6, 0, maxZ - 0.9, x + 4.2, 0.45, maxZ - 0.3, STEEL);
    }
    // Ceiling lamps down the corridor (they glow; there's no real light, to keep it cheap).
    const lamp = new THREE.MeshBasicMaterial({ color: LAMP });
    for (let x = minX + 4; x < maxX; x += 8) {
      this.parts.add(this.box, lamp, x, h - 0.08, (minZ + corridor) / 2, 0, 0, 0, 1.2, 0.1, 0.3);
    }
  }

  /** Steel bars from x0 to x1 along z, floor to `h`, with rails top and bottom (drawn only). */
  private bars(x0: number, x1: number, z: number, h: number): void {
    const steel = plastic(STEEL);
    const rod = new THREE.CylinderGeometry(0.045, 0.045, h, 6);
    for (let x = x0 + 0.15; x < x1; x += 0.3) this.parts.add(rod, steel, x, h / 2, z);
    rod.dispose();
    for (const y of [0.15, h - 0.15, h / 2]) this.parts.add(this.box, steel, (x0 + x1) / 2, y, z, 0, 0, 0, x1 - x0, 0.12, 0.12);
  }
}
