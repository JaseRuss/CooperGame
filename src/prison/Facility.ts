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
const SIGN = 0xd9c35a;
const BARRACKS_WALL = 0xa89a7a;

/** Wall height outside, and the cell blocks' ceiling. */
const COMPOUND_WALL = 4;
const CEILING = 3.6;
const WALL = 0.6;

/** The whole compound's inside edges: the yard in the middle, a wing either side. */
const COMPOUND = { minX: -72, maxX: 72, minZ: -25, maxZ: 25 };
/** The walls between the yard and the wings (at x = ±YARD_EDGE), each with a doorway from DOORWAY_Z0 to DOORWAY_Z1. */
const YARD_EDGE = 30;
const DOORWAY_Z0 = -5;
const DOORWAY_Z1 = 1;
const CELL_WIDTH = 5;
/** Each cell's door: from this far along the cell's front to that far (the rest is fixed bars). */
const DOOR_FROM = 3.3;
const DOOR_TO = 4.7;

/** A cell block: a corridor along the front (-Z side, door in the middle at doorX), a row of cells behind. */
interface BlockPlan {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  corridor: number;
  doorX: number;
}
/** Cell Block A, against the yard's south wall; Cell Block B in the east wing. */
const BLOCK_A: BlockPlan = { minX: -20, maxX: 20, minZ: 10, maxZ: 22, corridor: 14, doorX: 0 };
const BLOCK_B: BlockPlan = { minX: 38, maxX: 68, minZ: 8, maxZ: 22, corridor: 12, doorX: 53 };
/** The barracks in the west wing (its door on the east side, facing the yard), and the punishment hut behind it. */
const BARRACKS = { minX: -66, maxX: -42, minZ: -18, maxZ: -4, doorZ0: -12.5, doorZ1: -9.5, height: 3.4 };
const HUT = { minX: -66, maxX: -61, frontZ: 8, backZ: 13 };

/** One cell: its sides, and the door in its barred front (which faces -Z). */
export interface CellSpot {
  minX: number;
  maxX: number;
  /** The line of the bars. */
  frontZ: number;
  backZ: number;
  /** The door's hinge (at doorX0) and latch (at doorX1) ends. */
  doorX0: number;
  doorX1: number;
  height: number;
  /** Which block it's in (the punishment hut is a cell on its own). */
  block: ZoneId;
}

/** The parts of the prison to take, in the order they're met. */
export type ZoneId = 'blockA' | 'yard' | 'blockB' | 'barracks';

export interface Zone {
  id: ZoneId;
  name: string;
  /** Where the player (and the squad) gets back up once this part's been taken. */
  checkpoint: { x: number; z: number; yaw: number };
}

/** Where a tan guard stands (facing `yaw`), or the beat he walks up and down; `height` up a guard tower. */
export interface GuardPost {
  x: number;
  z: number;
  yaw: number;
  zone: ZoneId;
  patrol?: { x: number; z: number }[];
  height?: number;
}

/** A lever box on a wall that opens every cell door in a block at once. */
export interface LeverSpot {
  x: number;
  y: number;
  z: number;
  /** Which way it faces (the way out from the wall it's on), as a yaw. */
  yaw: number;
  /** Indices (in `cells`) of the doors it opens. */
  cells: number[];
}

export interface FacilityLayout {
  /** Where the player starts, and faces. */
  start: { x: number; z: number; yaw: number };
  guards: GuardPost[];
  /** Waypoints for the nav graph: open ground, doorways, the corridors, inside each cell. */
  navPoints: { x: number; z: number }[];
  /** Every cell: Cell Block A west to east (the first is the player's), then Cell Block B, then the punishment hut. */
  cells: CellSpot[];
  levers: LeverSpot[];
  /** The yard's guard towers. */
  towers: { x: number; z: number }[];
  /** The flagpole on the barracks roof: its foot and its top. */
  flag: { x: number; z: number; foot: number; top: number };
  zones: Zone[];
  /** Where the player gets back up once he's out of his cell: in the corridor, facing along it. */
  corridorCheckpoint: { x: number; z: number; yaw: number };
}

/**
 * The prison compound, built from boxes with `PartBuilder` like the rest of the game's models,
 * with a fixed Rapier cuboid for every solid part: a walled exercise yard in the middle with
 * Cell Block A along its south side, the east wing with Cell Block B, and the west wing with the
 * guards' barracks and the punishment hut. Cell doors, levers, towers and the flag are built by
 * their own classes from the layout.
 */
export class Facility {
  readonly group = new THREE.Group();
  readonly layout: FacilityLayout;
  private readonly body: RAPIER.RigidBody;
  private readonly parts = new PartBuilder();
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  /** Footprints (x0, z0, x1, z1) of everything solid at ground level, to keep waypoints clear of. */
  private readonly footprints: [number, number, number, number][] = [];

  constructor(private readonly world: RAPIER.World) {
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.buildGround();
    this.buildWalls();
    this.buildCrates();
    this.buildCellBlock(BLOCK_A, 'A');
    this.buildCellBlock(BLOCK_B, 'B');
    this.buildBarracks();
    this.buildHut();
    this.parts.buildInto(this.group);
    this.box.dispose();

    const cells: CellSpot[] = [...blockCells(BLOCK_A, 'blockA'), ...blockCells(BLOCK_B, 'blockB')];
    const blockB = cells.flatMap((c, i) => (c.block === 'blockB' ? [i] : []));
    cells.push({ minX: HUT.minX, maxX: HUT.maxX, frontZ: HUT.frontZ, backZ: HUT.backZ, doorX0: HUT.minX + DOOR_FROM, doorX1: HUT.minX + DOOR_TO, height: 3, block: 'barracks' });
    const towers = [
      { x: -26, z: -21 },
      { x: 26, z: -21 },
      { x: -26, z: 6 },
      { x: 26, z: 6 },
    ];
    const towerTop = 4.6;
    this.layout = {
      // In his own cell (the westmost in Cell Block A), facing the door (-Z).
      start: { x: BLOCK_A.minX + 2.5, z: (BLOCK_A.corridor + BLOCK_A.maxZ) / 2 + 0.5, yaw: 0 },
      corridorCheckpoint: { x: BLOCK_A.minX + 4, z: (BLOCK_A.minZ + BLOCK_A.corridor) / 2 + 0.4, yaw: -Math.PI / 2 },
      cells,
      levers: [{ x: BLOCK_B.minX + 0.12, y: 1.4, z: (BLOCK_B.minZ + BLOCK_B.corridor) / 2, yaw: -Math.PI / 2, cells: blockB }],
      towers,
      flag: { x: (BARRACKS.minX + BARRACKS.maxX) / 2, z: (BARRACKS.minZ + BARRACKS.maxZ) / 2, foot: BARRACKS.height + 0.35, top: BARRACKS.height + 6 },
      zones: [
        { id: 'blockA', name: 'Cell Block A', checkpoint: { x: BLOCK_A.minX + 4, z: 12.4, yaw: -Math.PI / 2 } },
        { id: 'yard', name: 'The yard', checkpoint: { x: 0, z: -6, yaw: Math.PI } },
        { id: 'blockB', name: 'Cell Block B', checkpoint: { x: BLOCK_B.doorX, z: 2, yaw: Math.PI } },
        { id: 'barracks', name: 'The barracks', checkpoint: { x: -36, z: -2, yaw: Math.PI / 2 } },
      ],
      guards: [
        // Cell Block A: one on his beat up the corridor, one by the door.
        { zone: 'blockA', x: -6, z: 12, yaw: -Math.PI / 2, patrol: [{ x: -6, z: 12 }, { x: 16, z: 12 }] },
        { zone: 'blockA', x: 2.5, z: 11, yaw: Math.PI / 2 },
        // The yard: behind crates facing the cell block, one walking the north wall, one up each tower.
        { zone: 'yard', x: -13, z: -10, yaw: Math.PI },
        { zone: 'yard', x: 6, z: -8.5, yaw: Math.PI },
        { zone: 'yard', x: 15, z: -16, yaw: Math.PI * 0.85 },
        { zone: 'yard', x: -22, z: 1.5, yaw: Math.PI * 1.2 },
        { zone: 'yard', x: 21, z: -2, yaw: Math.PI * 0.8 },
        { zone: 'yard', x: -20, z: -22, yaw: -Math.PI / 2, patrol: [{ x: -20, z: -22 }, { x: 20, z: -22 }] },
        ...towers.map((t) => ({ zone: 'yard' as const, x: t.x, z: t.z, yaw: Math.atan2(t.x, t.z + 2), height: towerTop })),
        // The east wing and Cell Block B: two outside facing the yard's doorway, one on the corridor, one by the lever.
        { zone: 'blockB', x: 44, z: -2, yaw: Math.PI / 2 },
        { zone: 'blockB', x: 58, z: -14, yaw: Math.PI * 0.6 },
        { zone: 'blockB', x: 46, z: 10, yaw: -Math.PI / 2, patrol: [{ x: 46, z: 10 }, { x: 66, z: 10 }] },
        { zone: 'blockB', x: 40.5, z: 9, yaw: -Math.PI / 2 },
        // The west wing: two outside facing the yard's doorway, three in the barracks, one guarding the hut.
        { zone: 'barracks', x: -38, z: -12, yaw: -Math.PI / 2 },
        { zone: 'barracks', x: -40, z: 7, yaw: -Math.PI * 0.6 },
        { zone: 'barracks', x: -46, z: -11, yaw: -Math.PI / 2 },
        { zone: 'barracks', x: -55, z: -13, yaw: -Math.PI / 2 },
        { zone: 'barracks', x: -60, z: -8, yaw: -Math.PI / 2, patrol: [{ x: -60, z: -8 }, { x: -48, z: -8 }] },
        { zone: 'barracks', x: -63.5, z: 5, yaw: -Math.PI / 2 },
      ],
      navPoints: this.navPoints(cells),
    };
  }

  /** A solid box from (x0, y0, z0) to (x1, y1, z1): drawn, and something to bump into. */
  private solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, collide = true): void {
    const sx = x1 - x0;
    const sy = y1 - y0;
    const sz = z1 - z0;
    this.parts.add(this.box, plastic(color), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 0, 0, sx, sy, sz);
    if (collide) this.blocker(x0, y0, z0, x1, y1, z1);
  }

  /** Something to bump into (and shoot at) with nothing drawn: the drawn part is bars, say. */
  private blocker(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    if (y0 < 1.5) this.footprints.push([x0, z0, x1, z1]);
    const desc = RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.world.createCollider(desc, this.body);
  }

  /** An outside wall (4 m, with a coping strip along the top) from (x0, z0) to (x1, z1), one of which is the same. */
  private wall(x0: number, z0: number, x1: number, z1: number): void {
    this.solid(x0, 0, z0, x1, COMPOUND_WALL, z1, CONCRETE);
    this.solid(x0 - 0.15, COMPOUND_WALL, z0 - 0.15, x1 + 0.15, COMPOUND_WALL + 0.25, z1 + 0.15, CONCRETE_DARK, false);
  }

  /**
   * Waypoints: open ground on a grid all round the compound (clear of anything solid and outside
   * the cell blocks), plus each cell block's doorway, corridor and cells, and the hut.
   */
  private navPoints(cells: CellSpot[]): { x: number; z: number }[] {
    const points: { x: number; z: number }[] = [];
    const open = (x: number, z: number) => this.footprints.every(([x0, z0, x1, z1]) => x < x0 - 0.9 || x > x1 + 0.9 || z < z0 - 0.9 || z > z1 + 0.9);
    const inBlock = (x: number, z: number) =>
      [BLOCK_A, BLOCK_B].some((b) => x > b.minX - 1.5 && x < b.maxX + 1.5 && z > b.minZ - 1.5 && z < b.maxZ + 1.5) ||
      (x > HUT.minX - 1.5 && x < HUT.maxX + 1.5 && z > HUT.frontZ - 0.5 && z < HUT.backZ + 1.5);
    for (let x = COMPOUND.minX + 2.5; x < COMPOUND.maxX; x += 5.5) {
      for (let z = COMPOUND.minZ + 2.5; z < COMPOUND.maxZ; z += 5.5) if (!inBlock(x, z) && open(x, z)) points.push({ x, z });
    }
    // The doorways through the yard's walls, and into the barracks.
    for (const x of [-YARD_EDGE, YARD_EDGE]) points.push({ x: x - 1.5, z: (DOORWAY_Z0 + DOORWAY_Z1) / 2 }, { x: x + 1.5, z: (DOORWAY_Z0 + DOORWAY_Z1) / 2 });
    const barracksDoor = (BARRACKS.doorZ0 + BARRACKS.doorZ1) / 2;
    points.push({ x: BARRACKS.maxX + 1.5, z: barracksDoor }, { x: BARRACKS.maxX - 1.5, z: barracksDoor });
    for (const b of [BLOCK_A, BLOCK_B]) {
      const corridor = (b.minZ + b.corridor) / 2;
      points.push({ x: b.doorX, z: b.minZ - 2 }, { x: b.doorX, z: corridor }, { x: b.minX + 1.2, z: corridor }, { x: b.maxX - 1.2, z: corridor });
    }
    for (const cell of cells) {
      const door = (cell.doorX0 + cell.doorX1) / 2;
      const inBlockA = cell.block === 'blockA';
      const corridor = cell.block === 'barracks' ? cell.frontZ - 1.8 : inBlockA ? (BLOCK_A.minZ + BLOCK_A.corridor) / 2 : (BLOCK_B.minZ + BLOCK_B.corridor) / 2;
      points.push({ x: door, z: corridor }, { x: door, z: cell.frontZ + 1.2 }, { x: cell.minX + 2.2, z: cell.frontZ + 3.2 });
    }
    return points;
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

  /** The perimeter (a locked gate in the north side, out of the yard) and the walls between the yard and the wings. */
  private buildWalls(): void {
    const { minX, maxX, minZ, maxZ } = COMPOUND;
    this.wall(minX - WALL, minZ - WALL, -3, minZ);
    this.wall(3, minZ - WALL, maxX + WALL, minZ);
    this.wall(minX - WALL, maxZ, maxX + WALL, maxZ + WALL);
    this.wall(minX - WALL, minZ, minX, maxZ);
    this.wall(maxX, minZ, maxX + WALL, maxZ);
    for (const x of [-YARD_EDGE, YARD_EDGE]) {
      this.wall(x - WALL / 2, minZ, x + WALL / 2, DOORWAY_Z0);
      this.wall(x - WALL / 2, DOORWAY_Z1, x + WALL / 2, maxZ);
      // Posts either side of the doorway.
      for (const z of [DOORWAY_Z0, DOORWAY_Z1]) this.solid(x - 0.5, 0, z - 0.3, x + 0.5, COMPOUND_WALL + 0.5, z + 0.3, CONCRETE_DARK);
    }
    // The main gate: steel bars between two posts.
    this.solid(-3.6, 0, minZ - WALL - 0.2, -3, COMPOUND_WALL + 0.6, minZ + 0.2, CONCRETE_DARK);
    this.solid(3, 0, minZ - WALL - 0.2, 3.6, COMPOUND_WALL + 0.6, minZ + 0.2, CONCRETE_DARK);
    this.barsX(-3, 3, minZ - WALL / 2, COMPOUND_WALL);
    this.blocker(-3, 0, minZ - WALL / 2 - 0.05, 3, COMPOUND_WALL, minZ - WALL / 2 + 0.05);
  }

  /** Crates for cover round the yard and the wings, and a low wall in the yard to run along. */
  private buildCrates(): void {
    const crate = (x: number, z: number, stack = 1) => {
      const s = 1.2;
      for (let i = 0; i < stack; i++) {
        this.solid(x - s / 2, i * s, z - s / 2, x + s / 2, (i + 1) * s, z + s / 2, WOOD);
        this.solid(x - s / 2 - 0.02, i * s + s * 0.42, z - s / 2 - 0.02, x + s / 2 + 0.02, i * s + s * 0.58, z + s / 2 + 0.02, 0x6e5230, false);
      }
    };
    // The yard.
    crate(-12, -8, 2);
    crate(-10.6, -8);
    crate(5, -6);
    crate(6.3, -6.2, 2);
    crate(14, -14);
    crate(-20, 4, 2);
    crate(20, 0);
    crate(-24, -14);
    this.solid(-4, 0, -2, 4, 1.1, -1.4, CONCRETE_DARK);
    // The east wing.
    crate(42, -4, 2);
    crate(43.3, -4.2);
    crate(56, -12);
    crate(50, -19, 2);
    crate(64, -2);
    // The west wing.
    crate(-37, -10, 2);
    crate(-37, -8.6);
    crate(-38, 5);
    crate(-50, 2, 2);
    crate(-56, -21);
  }

  /** A cell block: outside walls, a doorway in the middle of the front, a corridor, then a row of barred cells. */
  private buildCellBlock(b: BlockPlan, letter: string): void {
    const { minX, maxX, minZ, maxZ, corridor, doorX } = b;
    const h = CEILING;
    this.solid(minX - WALL, 0, minZ - WALL, doorX - 1.6, h, minZ, CONCRETE);
    this.solid(doorX + 1.6, 0, minZ - WALL, maxX + WALL, h, minZ, CONCRETE);
    this.solid(doorX - 1.6, 2.7, minZ - WALL, doorX + 1.6, h, minZ, CONCRETE);
    this.solid(minX - WALL, 0, minZ, minX, h, maxZ, CONCRETE);
    this.solid(maxX, 0, minZ, maxX + WALL, h, maxZ, CONCRETE);
    this.solid(minX - WALL, 0, maxZ, maxX + WALL, h, maxZ + WALL, CONCRETE);
    // Roof slab, with an overhang over the door and a sign: a yellow board with the block's letter.
    this.solid(minX - WALL - 0.3, h, minZ - WALL - 0.3, maxX + WALL + 0.3, h + 0.35, maxZ + WALL + 0.3, ROOF);
    this.solid(doorX - 2.4, 2.9, minZ - 2.2, doorX + 2.4, 3.1, minZ - WALL, ROOF);
    this.solid(doorX - 2, 3.15, minZ - WALL - 0.12, doorX + 2, 3.55, minZ - WALL, SIGN, false);
    this.letter(letter, doorX, 3.35, minZ - WALL - 0.14);
    this.solid(minX, 0, minZ, maxX, 0.02, maxZ, CONCRETE_DARK, false);

    // Cells: partition walls, and a barred front on each with a gap for its door (see Cells).
    for (let x = minX + CELL_WIDTH; x < maxX; x += CELL_WIDTH) this.solid(x - 0.15, 0, corridor, x + 0.15, h, maxZ, CONCRETE);
    for (let x = minX; x < maxX; x += CELL_WIDTH) {
      this.barsX(x + 0.15, x + DOOR_FROM, corridor, h);
      this.blocker(x + 0.15, 0, corridor - 0.05, x + DOOR_FROM, h, corridor + 0.05);
      this.barsX(x + DOOR_TO, x + CELL_WIDTH - 0.15, corridor, h);
      this.blocker(x + DOOR_TO, 0, corridor - 0.05, x + CELL_WIDTH - 0.15, h, corridor + 0.05);
      // A bunk and a bucket in each.
      this.solid(x + 0.5, 0, maxZ - 1, x + 2.6, 0.55, maxZ - 0.1, WOOD);
      this.solid(x + 3.6, 0, maxZ - 0.9, x + 4.2, 0.45, maxZ - 0.3, STEEL);
    }
    // Ceiling lamps down the corridor (they glow; there's no real light, to keep it cheap).
    const lamp = new THREE.MeshBasicMaterial({ color: LAMP });
    for (let x = minX + 4; x < maxX; x += 8) this.parts.add(this.box, lamp, x, h - 0.08, (minZ + corridor) / 2, 0, 0, 0, 1.2, 0.1, 0.3);
  }

  /** The guards' barracks: a long hut with a door facing the yard, bunks and lockers inside, and a flagpole on the roof. */
  private buildBarracks(): void {
    const { minX, maxX, minZ, maxZ, doorZ0, doorZ1, height: h } = BARRACKS;
    this.solid(minX - WALL, 0, minZ - WALL, maxX + WALL, h, minZ, BARRACKS_WALL);
    this.solid(minX - WALL, 0, maxZ, maxX + WALL, h, maxZ + WALL, BARRACKS_WALL);
    this.solid(minX - WALL, 0, minZ, minX, h, maxZ, BARRACKS_WALL);
    this.solid(maxX, 0, minZ, maxX + WALL, h, doorZ0, BARRACKS_WALL);
    this.solid(maxX, 0, doorZ1, maxX + WALL, h, maxZ, BARRACKS_WALL);
    this.solid(maxX, 2.6, doorZ0, maxX + WALL, h, doorZ1, BARRACKS_WALL);
    this.solid(minX - WALL - 0.3, h, minZ - WALL - 0.3, maxX + WALL + 0.3, h + 0.35, maxZ + WALL + 0.3, 0x6b5a3a);
    this.solid(minX, 0, minZ, maxX, 0.02, maxZ, 0x6e6352, false);
    // Dark windows along the long sides (painted on: there's no glass to see through).
    for (let x = minX + 2; x < maxX - 1; x += 4) {
      this.solid(x, 1.4, minZ - WALL - 0.03, x + 1.6, 2.4, minZ - WALL, 0x2a3040, false);
      this.solid(x, 1.4, maxZ + WALL, x + 1.6, 2.4, maxZ + WALL + 0.03, 0x2a3040, false);
    }
    // A sign over the door.
    this.solid(maxX + WALL, 2.75, doorZ0 - 0.6, maxX + WALL + 0.12, 3.25, doorZ1 + 0.6, SIGN, false);
    // Bunks along both long walls, with a gangway down the middle; lockers at the far end.
    for (let x = minX + 1; x < maxX - 4; x += 3.5) {
      for (const [z0, z1] of [[minZ + 0.2, minZ + 1.2], [maxZ - 1.2, maxZ - 0.2]]) {
        this.solid(x, 0, z0, x + 2.1, 0.5, z1, WOOD);
        this.solid(x, 1.4, z0, x + 2.1, 1.55, z1, WOOD, false);
        for (const px of [x, x + 2]) this.solid(px, 0, z0, px + 0.1, 1.6, z0 + 0.1, STEEL, false);
      }
    }
    for (let z = minZ + 3; z < maxZ - 2.5; z += 1) this.solid(minX + 0.1, 0, z, minX + 0.7, 2, z + 0.9, 0x6a7a5a);
    // The flagpole (the flag itself is in Flag).
    const pole = new THREE.CylinderGeometry(0.07, 0.09, 6, 8);
    this.parts.add(pole, plastic(0xc8c8c0), (minX + maxX) / 2, h + 0.35 + 3, (minZ + maxZ) / 2);
    pole.dispose();
  }

  /** The punishment hut: one barred cell on its own behind the barracks (its door is in Cells). */
  private buildHut(): void {
    const { minX, maxX, frontZ, backZ } = HUT;
    const h = 3;
    this.solid(minX - WALL, 0, frontZ, minX, h, backZ, CONCRETE);
    this.solid(maxX, 0, frontZ, maxX + WALL, h, backZ, CONCRETE);
    this.solid(minX - WALL, 0, backZ, maxX + WALL, h, backZ + WALL, CONCRETE);
    this.solid(minX - WALL - 0.3, h, frontZ - 0.6, maxX + WALL + 0.3, h + 0.3, backZ + WALL + 0.3, ROOF);
    this.barsX(minX, minX + DOOR_FROM, frontZ, h);
    this.blocker(minX, 0, frontZ - 0.05, minX + DOOR_FROM, h, frontZ + 0.05);
    this.barsX(minX + DOOR_TO, maxX, frontZ, h);
    this.blocker(minX + DOOR_TO, 0, frontZ - 0.05, maxX, h, frontZ + 0.05);
    this.solid(minX + 0.4, 0, backZ - 0.9, minX + 2.4, 0.45, backZ - 0.1, WOOD);
  }

  /** Steel bars from x0 to x1 along z, floor to `h`, with rails top and bottom (drawn only). */
  private barsX(x0: number, x1: number, z: number, h: number): void {
    const steel = plastic(STEEL);
    const rod = new THREE.CylinderGeometry(0.045, 0.045, h, 6);
    for (let x = x0 + 0.15; x < x1; x += 0.3) this.parts.add(rod, steel, x, h / 2, z);
    rod.dispose();
    for (const y of [0.15, h - 0.15, h / 2]) this.parts.add(this.box, steel, (x0 + x1) / 2, y, z, 0, 0, 0, x1 - x0, 0.12, 0.12);
  }

  /** A big block letter (A or B) in dark paint at (x, y) on a sign facing -Z. */
  private letter(which: string, x: number, y: number, z: number): void {
    const paint = plastic(0x2a2a2a);
    // Read from the -Z side, so the letter's right is -X.
    const bar = (cx: number, cy: number, w: number, hh: number, rz = 0) => this.parts.add(this.box, paint, x - cx, y + cy, z, 0, 0, -rz, w, hh, 0.03);
    if (which === 'A') {
      bar(-0.07, 0, 0.05, 0.34, -0.25);
      bar(0.07, 0, 0.05, 0.34, 0.25);
      bar(0, -0.03, 0.12, 0.04);
    } else {
      bar(-0.07, 0, 0.05, 0.34);
      for (const cy of [0.15, 0, -0.15]) bar(0, cy, 0.14, 0.04);
      bar(0.08, 0.075, 0.04, 0.13);
      bar(0.08, -0.075, 0.04, 0.13);
    }
  }
}

/** The cells along a block, west to east. */
function blockCells(b: BlockPlan, block: ZoneId): CellSpot[] {
  return Array.from({ length: (b.maxX - b.minX) / CELL_WIDTH }, (_, i) => {
    const minX = b.minX + i * CELL_WIDTH;
    return { minX, maxX: minX + CELL_WIDTH, frontZ: b.corridor, backZ: b.maxZ, doorX0: minX + DOOR_FROM, doorX1: minX + DOOR_TO, height: CEILING, block };
  });
}
