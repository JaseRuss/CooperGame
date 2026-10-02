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
const COMPOUND = { minX: -72, maxX: 72, minZ: -25, maxZ: 42 };
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
/** Cell Block A's front row of cells and the corridor in front of it (see CELLHOUSE); Cell Block B in the east wing. */
const BLOCK_A: BlockPlan = { minX: -20, maxX: 20, minZ: 10, maxZ: 22, corridor: 14, doorX: 0 };
/**
 * Cell Block A is a cellhouse like Alcatraz's: a tall hall (inside edges here, roof at `top`)
 * with a block of cells down the middle, two rows back to back, three tiers high (only the
 * bottom tier is real). Between the two rows runs the utility corridor, the pipe chase (PIPE_Z0
 * to PIPE_Z1), full of pipes and only reachable through the vents at the back of some cells.
 * The north row faces the front corridor (BLOCK_A); the back row faces a corridor along the back
 * wall; aisles round each end of the block join the two.
 */
const CELLHOUSE = { minX: -23, maxX: 23, minZ: 10, maxZ: 37, top: 7.2 };
const PIPE_Z0 = 22.3;
const PIPE_Z1 = 24.3;
const BACK_ROW = { front: 32.6, back: 24.6 };
/** Walkable top of the cellhouse roof, and its parapet. */
export const ROOF_TOP = CELLHOUSE.top + 0.35;
const PARAPET = 0.9;
/** The raised clerestory along the middle of the roof (cover from the searchlights). */
const CLERESTORY = { minX: -14, maxX: 13, minZ: 20, maxZ: 26.6, height: 2.6 };
/** Cells in Cell Block A's front row with a loose vent grille at the back (the player's, Keston's, Max's), and where it is along the cell. */
const VENT_CELLS = [0, 1, 2];
const VENT_FROM = 2.6;
const VENT_TO = 3.8;
const VENT_HEIGHT = 2;
/** The bakery against the cellhouse's west wall, and its flue pipe up to the roof. */
const BAKERY = { minX: -29.4, maxX: -24.2, minZ: 26, maxZ: 39, height: 4 };
const PIPE_SPOT = { x: -24.05, z: 24 };
/**
 * The motor pool, fenced off in the south of the east wing: your tank and three trucks under a
 * carport. The fence's gate (on its north side, x LOT.gateX0 to gateX1) stays shut until the
 * rest of the prison's taken.
 */
const LOT = { minX: 39, maxX: 71.4, minZ: 27.5, maxZ: 41.4, gateX0: 40, gateX1: 46.4 };
/** The ground: the whole compound and the country to the north, out to Cooper's Base. */
const GROUND = { minX: -150, maxX: 150, minZ: -580, maxZ: 70 };
/** The road home from the main gate, and Cooper's Base at the end of it. */
const ROAD: { x: number; z: number }[] = [
  { x: 0, z: -26 },
  { x: 0, z: -80 },
  { x: -28, z: -150 },
  { x: -32, z: -230 },
  { x: 18, z: -320 },
  { x: 10, z: -410 },
  { x: 0, z: -470 },
];
const HOME = { x: 0, z: -500 };
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
  /** No padlock: a door that can't be shot open (the player's own: the way out is the vent). */
  noLock?: boolean;
}

/** A loose vent grille in the back wall of a cell, opening into the pipe chase. */
export interface VentSpot {
  cell: number;
  x0: number;
  x1: number;
  /** The line of the wall (the grille is on the pipe chase side of it). */
  z: number;
  height: number;
}

/** A spot to climb from and where the climb ends (up the pipes to the roof, down the bakery pipe). */
export interface ClimbSpot {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number; yaw: number };
}

/** A searchlight on a mast at the roof's edge, and the loop its beam sweeps over the roof. */
export interface SearchlightSpot {
  lamp: { x: number; y: number; z: number };
  path: { x: number; z: number }[];
  speed: number;
}

/** The parts of the prison to take, in the order they're met. */
export type ZoneId = 'blockA' | 'yard' | 'blockB' | 'barracks' | 'motorpool';

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
  /** The motor pool: where the tank's parked, the trucks' line out behind it, and the fence's gate. */
  motorPool: { tank: { x: number; z: number; yaw: number }; truckLine: { x: number; z: number }[]; gate: { x0: number; x1: number; z: number } };
  /** The main gate (shut until it's shot open), the road home and Cooper's Base. */
  mainGate: { x0: number; x1: number; z: number; height: number };
  road: { x: number; z: number }[];
  home: { x: number; z: number };
  ground: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** The yard's guard towers, and the middle of the yard (they fall towards it). */
  towers: { x: number; z: number }[];
  yardMiddle: { x: number; z: number };
  /** The flagpole on the barracks roof: its foot and its top. */
  flag: { x: number; z: number; foot: number; top: number };
  zones: Zone[];
  /** The opening, Alcatraz-style: out through the vent, along the pipe chase, up to the roof, past the searchlights, down the bakery pipe. */
  vents: VentSpot[];
  /** Where he gets back up once he's out through the vent: in the pipe chase. */
  pipeChaseCheckpoint: { x: number; z: number; yaw: number };
  ladder: ClimbSpot;
  bakeryPipe: ClimbSpot;
  searchlights: SearchlightSpot[];
  /** True on the cellhouse roof. */
  onRoof(x: number, y: number, z: number): boolean;
  /** Posts either side of each doorway for prisoners holding the prison, most important first (facing out). */
  doorPosts: { x: number; z: number; yaw: number }[];
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
    this.buildCellhouse();
    this.buildRoof();
    this.buildBakery();
    this.buildMotorPool();
    this.buildYardDressing();
    this.buildCellBlock(BLOCK_B, 'B');
    this.buildBarracks();
    this.buildHut();
    this.parts.buildInto(this.group);
    this.box.dispose();

    const cells: CellSpot[] = [...blockCells(BLOCK_A, 'blockA'), ...blockCells(BLOCK_B, 'blockB')];
    cells[0].noLock = true;
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
      // In his own cell (the westmost in the front row), facing the back wall with the loose vent (+Z).
      start: { x: BLOCK_A.minX + 2.2, z: BLOCK_A.corridor + 3, yaw: Math.PI },
      vents: VENT_CELLS.map((cell) => {
        const minX = BLOCK_A.minX + cell * CELL_WIDTH;
        return { cell, x0: minX + VENT_FROM, x1: minX + VENT_TO, z: BLOCK_A.maxZ + 0.15, height: VENT_HEIGHT };
      }),
      pipeChaseCheckpoint: { x: BLOCK_A.minX + 3.2, z: (PIPE_Z0 + PIPE_Z1) / 2, yaw: -Math.PI / 2 },
      ladder: {
        from: { x: BLOCK_A.maxX - 0.8, y: 0, z: (PIPE_Z0 + PIPE_Z1) / 2 },
        to: { x: BLOCK_A.maxX - 1, y: ROOF_TOP, z: PIPE_Z0 - 1.6, yaw: Math.PI / 2 },
      },
      bakeryPipe: {
        from: { x: CELLHOUSE.minX + 0.2, y: ROOF_TOP, z: PIPE_SPOT.z },
        to: { x: PIPE_SPOT.x - 1.6, y: 0, z: PIPE_SPOT.z - 1.2, yaw: 0 },
      },
      searchlights: [
        // Zig-zags over the north half of the roof, the south half, and the west end where the
        // bakery pipe is (each loop runs back to its start).
        { lamp: { x: 0, y: ROOF_TOP + 5, z: CELLHOUSE.minZ - 0.4 }, path: zigzag(-21, 21, [11.5, 15.5, 19.4]), speed: 4 },
        { lamp: { x: 0, y: ROOF_TOP + 5, z: CELLHOUSE.maxZ + 0.4 }, path: zigzag(21, -21, [35.5, 31.5, 28]), speed: 4 },
        { lamp: { x: CELLHOUSE.minX - 0.4, y: ROOF_TOP + 5, z: 18 }, path: zigzag(12, 35.5, [-21.3, -18.5, -15.8]).map((p) => ({ x: p.z, z: p.x })), speed: 3 },
      ],
      doorPosts: [
        // The cellhouse door, the yard's doorways to each wing, Cell Block B's door, the barracks door, the main gate.
        { x: -2.8, z: CELLHOUSE.minZ - 1.8, yaw: 0 },
        { x: 2.8, z: CELLHOUSE.minZ - 1.8, yaw: 0 },
        { x: -YARD_EDGE + 1.4, z: DOORWAY_Z0 - 1.2, yaw: Math.PI / 2 },
        { x: -YARD_EDGE + 1.4, z: DOORWAY_Z1 + 1.2, yaw: Math.PI / 2 },
        { x: YARD_EDGE - 1.4, z: DOORWAY_Z0 - 1.2, yaw: -Math.PI / 2 },
        { x: YARD_EDGE - 1.4, z: DOORWAY_Z1 + 1.2, yaw: -Math.PI / 2 },
        { x: BLOCK_B.doorX - 2.6, z: BLOCK_B.minZ - 1.8, yaw: 0 },
        { x: BLOCK_B.doorX + 2.6, z: BLOCK_B.minZ - 1.8, yaw: 0 },
        { x: BARRACKS.maxX + 1.6, z: BARRACKS.doorZ0 - 1, yaw: -Math.PI / 2 },
        { x: BARRACKS.maxX + 1.6, z: BARRACKS.doorZ1 + 1, yaw: -Math.PI / 2 },
        { x: -4.8, z: COMPOUND.minZ + 1.6, yaw: 0 },
        { x: 4.8, z: COMPOUND.minZ + 1.6, yaw: 0 },
      ],
      onRoof: (x, y, z) => y > CELLHOUSE.top && x > CELLHOUSE.minX - WALL && x < CELLHOUSE.maxX + WALL && z > CELLHOUSE.minZ - WALL && z < CELLHOUSE.maxZ + WALL,
      cells,
      levers: [{ x: BLOCK_B.minX + 0.12, y: 1.4, z: (BLOCK_B.minZ + BLOCK_B.corridor) / 2, yaw: -Math.PI / 2, cells: blockB }],
      towers,
      yardMiddle: { x: 0, z: -8 },
      motorPool: {
        tank: { x: LOT.gateX0 + 2.6, z: LOT.minZ + 4, yaw: 0 },
        // From the far end of the carport to the tank: the trucks start parked along it, nose to tail.
        truckLine: [{ x: LOT.maxX - 1, z: 34 }, { x: LOT.gateX0 + 2.6, z: 34 }, { x: LOT.gateX0 + 2.6, z: LOT.minZ + 4 }],
        gate: { x0: LOT.gateX0, x1: LOT.gateX1, z: LOT.minZ },
      },
      mainGate: { x0: -3, x1: 3, z: COMPOUND.minZ - WALL / 2, height: COMPOUND_WALL },
      road: ROAD,
      home: HOME,
      ground: GROUND,
      flag: { x: (BARRACKS.minX + BARRACKS.maxX) / 2, z: (BARRACKS.minZ + BARRACKS.maxZ) / 2, foot: BARRACKS.height + 0.35, top: BARRACKS.height + 6 },
      zones: [
        { id: 'blockA', name: 'Cell Block A', checkpoint: { x: BLOCK_A.minX + 4, z: 12.4, yaw: -Math.PI / 2 } },
        { id: 'yard', name: 'The yard', checkpoint: { x: 0, z: -6, yaw: Math.PI } },
        { id: 'blockB', name: 'Cell Block B', checkpoint: { x: BLOCK_B.doorX, z: 2, yaw: Math.PI } },
        { id: 'barracks', name: 'The barracks', checkpoint: { x: -36, z: -2, yaw: Math.PI / 2 } },
      ],
      guards: [
        // Cell Block A: one on his beat up the front corridor, one by the door, one on the back corridor.
        { zone: 'blockA', x: -6, z: 12, yaw: -Math.PI / 2, patrol: [{ x: -6, z: 12 }, { x: 16, z: 12 }] },
        { zone: 'blockA', x: 2.5, z: 11, yaw: Math.PI / 2 },
        { zone: 'blockA', x: -16, z: 34.8, yaw: -Math.PI / 2, patrol: [{ x: -16, z: 34.8 }, { x: 16, z: 34.8 }] },
        // Waiting at the bottom of the bakery pipe.
        { zone: 'yard', x: -27, z: 13, yaw: Math.PI },
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
        // The motor pool: they only come into it once its gate's open.
        { zone: 'motorpool', x: 44, z: 29.5, yaw: 0 },
        { zone: 'motorpool', x: 60, z: 30, yaw: Math.PI / 2 },
        { zone: 'motorpool', x: 52, z: 39.5, yaw: Math.PI / 2 },
        { zone: 'motorpool', x: 68, z: 38, yaw: Math.PI / 2 },
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
  private wall(x0: number, z0: number, x1: number, z1: number, outside?: { x: number; z: number }): void {
    const h = COMPOUND_WALL;
    this.solid(x0, 0, z0, x1, h, z1, CONCRETE);
    this.solid(x0 - 0.15, h, z0 - 0.15, x1 + 0.15, h + 0.25, z1 + 0.15, CONCRETE_DARK, false);
    // Cast-concrete panels: a pilaster every few metres on both faces, a seam between each, a footing.
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const dark = plastic(CONCRETE_DARK);
    const seam = plastic(0x86827a);
    for (let t = 1.5; t < len - 0.5; t += 3) {
      const pilaster = Math.round((t - 1.5) / 3) % 2 === 0;
      const cx = alongX ? x0 + t : (x0 + x1) / 2;
      const cz = alongX ? (z0 + z1) / 2 : z0 + t;
      const thick = (alongX ? z1 - z0 : x1 - x0) + (pilaster ? 0.3 : 0.04);
      const w = pilaster ? 0.5 : 0.06;
      this.parts.add(this.box, pilaster ? dark : seam, cx, h / 2, cz, 0, 0, 0, alongX ? w : thick, pilaster ? h : h - 0.3, alongX ? thick : w);
    }
    this.parts.add(this.box, dark, (x0 + x1) / 2, 0.15, (z0 + z1) / 2, 0, 0, 0, alongX ? len : x1 - x0 + 0.2, 0.3, alongX ? z1 - z0 + 0.2 : len);
    if (outside) this.barbedWire(x0, z0, x1, z1, alongX, outside);
  }

  /**
   * Barbed wire along the top of an outside wall: posts leaning out over the outside (the way
   * `outside` points), three strands, and a coil of razor wire.
   */
  private barbedWire(x0: number, z0: number, x1: number, z1: number, alongX: boolean, outside: { x: number; z: number }): void {
    const top = COMPOUND_WALL + 0.25;
    const steel = plastic(0x5a5e62);
    const wire = plastic(0x9aa0a6);
    const mx = alongX ? 0 : outside.x * ((x1 - x0) / 2);
    const mz = alongX ? outside.z * ((z1 - z0) / 2) : 0;
    const cx = (x0 + x1) / 2 + mx;
    const cz = (z0 + z1) / 2 + mz;
    const len = alongX ? x1 - x0 : z1 - z0;
    // Leaning posts.
    for (let t = 0.3; t < len; t += 3) {
      const px = alongX ? x0 + t : cx;
      const pz = alongX ? cz : z0 + t;
      this.parts.beam(new THREE.Vector3(px, top - 0.05, pz), new THREE.Vector3(px + outside.x * 0.45, top + 0.9, pz + outside.z * 0.45), 0.06, steel);
    }
    // Strands, stepping out as they go up.
    for (let i = 1; i <= 3; i++) {
      const y = top + i * 0.28;
      const off = i * 0.14;
      const strand = new THREE.CylinderGeometry(0.015, 0.015, len, 3);
      if (alongX) strand.rotateZ(Math.PI / 2);
      else strand.rotateX(Math.PI / 2);
      this.parts.add(strand, wire, cx + outside.x * off, y, cz + outside.z * off);
      strand.dispose();
    }
    // A coil of razor wire along the top, as a helix.
    const turns = Math.floor(len / 0.8);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= turns * 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const t = (i / (turns * 5)) * len;
      const r = 0.28;
      const along = alongX ? new THREE.Vector3(x0 + t, 0, cz) : new THREE.Vector3(cx, 0, z0 + t);
      const side = Math.cos(a) * r;
      pts.push(new THREE.Vector3(along.x + (alongX ? 0 : side) + outside.x * 0.2, top + 0.32 + Math.sin(a) * r, along.z + (alongX ? side : 0) + outside.z * 0.2));
    }
    const coil = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, 0.02, 3, false);
    this.parts.add(coil, wire);
    coil.dispose();
  }

  /**
   * Waypoints: open ground on a grid all round the compound (clear of anything solid and outside
   * the cell blocks), plus each cell block's doorway, corridor and cells, and the hut.
   */
  private navPoints(cells: CellSpot[]): { x: number; z: number }[] {
    const points: { x: number; z: number }[] = [];
    const open = (x: number, z: number) => this.footprints.every(([x0, z0, x1, z1]) => x < x0 - 0.9 || x > x1 + 0.9 || z < z0 - 0.9 || z > z1 + 0.9);
    const inBlock = (x: number, z: number) =>
      [BLOCK_B, { minX: CELLHOUSE.minX, maxX: CELLHOUSE.maxX, minZ: CELLHOUSE.minZ, maxZ: CELLHOUSE.maxZ }].some((b) => x > b.minX - 1.5 && x < b.maxX + 1.5 && z > b.minZ - 1.5 && z < b.maxZ + 1.5) ||
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
    // Cell Block A's aisles round the ends of the block, and its back corridor.
    const backCorridor = (BACK_ROW.front + CELLHOUSE.maxZ) / 2;
    for (const x of [CELLHOUSE.minX + 1.5, CELLHOUSE.maxX - 1.5]) points.push({ x, z: 12 }, { x, z: (PIPE_Z0 + PIPE_Z1) / 2 }, { x, z: backCorridor });
    for (let x = -15; x <= 15; x += 10) points.push({ x, z: backCorridor });
    for (const cell of cells) {
      const door = (cell.doorX0 + cell.doorX1) / 2;
      const inBlockA = cell.block === 'blockA';
      const corridor = cell.block === 'barracks' ? cell.frontZ - 1.8 : inBlockA ? (BLOCK_A.minZ + BLOCK_A.corridor) / 2 : (BLOCK_B.minZ + BLOCK_B.corridor) / 2;
      points.push({ x: door, z: corridor }, { x: door, z: cell.frontZ + 1.2 }, { x: cell.minX + 2.2, z: cell.frontZ + 3.2 });
    }
    return points;
  }

  /**
   * The ground: paving slabs over the compound, and below them (so they don't flicker) a huge
   * grassy field out to Cooper's Base, with an invisible wall round its edge.
   */
  private buildGround(): void {
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
    const w = COMPOUND.maxX - COMPOUND.minX + 6;
    const d = COMPOUND.maxZ - COMPOUND.minZ + 6;
    tex.repeat.set(w / 8, d / 8);
    tex.anisotropy = 4;
    const paving = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    paving.position.set((COMPOUND.minX + COMPOUND.maxX) / 2, 0, (COMPOUND.minZ + COMPOUND.maxZ) / 2);
    paving.receiveShadow = true;
    this.group.add(paving);

    const g = GROUND;
    const gw = g.maxX - g.minX;
    const gd = g.maxZ - g.minZ;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4f6a36, roughness: 1 }));
    grass.position.set((g.minX + g.maxX) / 2, -0.03, (g.minZ + g.maxZ) / 2);
    grass.receiveShadow = true;
    this.group.add(grass);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(gw / 2, 0.5, gd / 2).setTranslation((g.minX + g.maxX) / 2, -0.5, (g.minZ + g.maxZ) / 2), this.body);
    for (const [x0, z0, x1, z1] of [
      [g.minX - 1, g.minZ - 1, g.maxX + 1, g.minZ],
      [g.minX - 1, g.maxZ, g.maxX + 1, g.maxZ + 1],
      [g.minX - 1, g.minZ, g.minX, g.maxZ],
      [g.maxX, g.minZ, g.maxX + 1, g.maxZ],
    ]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, 5, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, 5, (z0 + z1) / 2), this.body);
    }
  }

  /** The perimeter (a locked gate in the north side, out of the yard) and the walls between the yard and the wings. */
  private buildWalls(): void {
    const { minX, maxX, minZ, maxZ } = COMPOUND;
    // The perimeter has barbed wire along the top, leaning out.
    this.wall(minX - WALL, minZ - WALL, -6.6, minZ, { x: 0, z: -1 });
    this.wall(6.6, minZ - WALL, maxX + WALL, minZ, { x: 0, z: -1 });
    this.wall(minX - WALL, maxZ, maxX + WALL, maxZ + WALL, { x: 0, z: 1 });
    this.wall(minX - WALL, minZ, minX, maxZ, { x: -1, z: 0 });
    this.wall(maxX, minZ, maxX + WALL, maxZ, { x: 1, z: 0 });
    this.buildGatehouse();
    for (const x of [-YARD_EDGE, YARD_EDGE]) {
      this.wall(x - WALL / 2, minZ, x + WALL / 2, DOORWAY_Z0);
      this.wall(x - WALL / 2, DOORWAY_Z1, x + WALL / 2, maxZ);
      // Posts either side of the doorway.
      for (const z of [DOORWAY_Z0, DOORWAY_Z1]) this.solid(x - 0.5, 0, z - 0.3, x + 0.5, COMPOUND_WALL + 0.5, z + 0.3, CONCRETE_DARK);
    }
  }

  /**
   * The gatehouse over the main gate (the gate itself is in Breakout: it gets blown open): a
   * tower either side with a lookout window and a little roof, an arch across the top with the
   * prison's name on it, and lamps either side of the way through.
   */
  private buildGatehouse(): void {
    const z0 = COMPOUND.minZ - WALL - 0.6;
    const z1 = COMPOUND.minZ + 0.6;
    const h = 7.5;
    for (const side of [-1, 1]) {
      const xa = side < 0 ? -6.6 : 3;
      const xb = side < 0 ? -3 : 6.6;
      this.solid(xa, 0, z0, xb, h, z1, CONCRETE);
      this.solid(xa - 0.25, h, z0 - 0.25, xb + 0.25, h + 0.3, z1 + 0.25, CONCRETE_DARK, false);
      this.parts.add(new THREE.ConeGeometry(2.9, 1.4, 4), plastic(ROOF), (xa + xb) / 2, h + 1, (z0 + z1) / 2, 0, Math.PI / 4, 0);
      // Lookout windows, front and back, and arrow-slit stripes down the front.
      for (const z of [z0 - 0.02, z1 + 0.02]) {
        this.solid((xa + xb) / 2 - 0.8, 5, Math.min(z, z + 0.03), (xa + xb) / 2 + 0.8, 6.2, Math.max(z, z + 0.03), 0x2a3040, false);
        this.solid(xa + 0.6, 0.6, Math.min(z, z + 0.03), xa + 0.85, 3.6, Math.max(z, z + 0.03), CONCRETE_DARK, false);
        this.solid(xb - 0.85, 0.6, Math.min(z, z + 0.03), xb - 0.6, 3.6, Math.max(z, z + 0.03), CONCRETE_DARK, false);
      }
      // A lamp on each tower, over the way through.
      this.parts.add(this.box, plastic(STEEL), side * 3.2, 4.6, z0 - 0.3, 0, 0, 0, 0.12, 0.12, 0.6);
      this.parts.add(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: LAMP }), side * 3.2, 4.45, z0 - 0.6);
    }
    // The arch across the top, with the name board on the outside face.
    this.solid(-3, 4.8, z0 + 0.2, 3, 6.4, z1 - 0.2, CONCRETE);
    this.solid(-3.2, 6.4, z0, 3.2, 6.7, z1, CONCRETE_DARK, false);
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#c4a468';
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = '#5a4a2a';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 504, 88);
    ctx.fillStyle = '#3a2e1a';
    ctx.font = '900 46px "Black Ops One", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAN ARMY PRISON', 256, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.05), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    board.position.set(0, 5.6, z0 + 0.15);
    board.rotation.y = Math.PI;
    this.group.add(board);
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
    // By the bakery, where the pipe comes down.
    crate(-27.6, 17, 2);
    crate(-26.2, 17.2);
    // The east wing.
    crate(42, -4, 2);
    crate(43.3, -4.2);
    crate(56, -12);
    crate(50, -19, 2);
    crate(36, 30);
    crate(34.6, 30.4, 2);
    crate(64, -2);
    // The west wing.
    crate(-37, -10, 2);
    crate(-37, -8.6);
    crate(-38, 5);
    crate(-50, 2, 2);
    crate(-56, -21);
  }

  /**
   * Cell Block A's cellhouse (see CELLHOUSE): the hall's walls and roof slab, the block of cells
   * down the middle (front row real and lockable, back row emptied and open, upper tiers
   * painted on), the pipe chase between the rows with its pipes and the ladder up to the roof.
   */
  private buildCellhouse(): void {
    const H = CELLHOUSE;
    const h = H.top;
    const { minX, maxX, maxZ: rowBack, corridor } = BLOCK_A;
    // The hall: a front door in the north wall, onto the yard.
    this.solid(H.minX - WALL, 0, H.minZ - WALL, -1.6, h, H.minZ, CONCRETE);
    this.solid(1.6, 0, H.minZ - WALL, H.maxX + WALL, h, H.minZ, CONCRETE);
    this.solid(-1.6, 2.7, H.minZ - WALL, 1.6, h, H.minZ, CONCRETE);
    this.solid(H.minX - WALL, 0, H.minZ, H.minX, h, H.maxZ, CONCRETE);
    this.solid(H.maxX, 0, H.minZ, H.maxX + WALL, h, H.maxZ, CONCRETE);
    this.solid(H.minX - WALL, 0, H.maxZ, H.maxX + WALL, h, H.maxZ + WALL, CONCRETE);
    this.solid(H.minX - WALL - 0.3, h, H.minZ - WALL - 0.3, H.maxX + WALL + 0.3, ROOF_TOP, H.maxZ + WALL + 0.3, ROOF);
    this.solid(-2.4, 2.9, H.minZ - 2.2, 2.4, 3.1, H.minZ - WALL, ROOF);
    this.solid(-2, 3.15, H.minZ - WALL - 0.12, 2, 3.55, H.minZ - WALL, SIGN, false);
    this.letter('A', 0, 3.35, H.minZ - WALL - 0.14);
    this.solid(H.minX, 0, H.minZ, H.maxX, 0.02, H.maxZ, CONCRETE_DARK, false);
    // Tall barred windows high up the hall's long walls, pilasters between them, a cornice along the top.
    for (let x = H.minX + 3; x < H.maxX - 2; x += 5) {
      if (Math.abs(x + 0.7) < 3) continue; // not over the front door's porch
      this.barredWindow(x, x + 1.4, 4.2, 6.6, H.minZ - WALL, -1);
      this.barredWindow(x, x + 1.4, 4.2, 6.6, H.maxZ + WALL, 1);
    }
    this.pilasters(H.minX - WALL, H.maxX + WALL, H.minZ - WALL, h, -1, 5, H.minX + 0.5);
    this.pilasters(H.minX - WALL, H.maxX + WALL, H.maxZ + WALL, h, 1, 5, H.minX + 0.5);
    this.cornice(H.minX - WALL, H.minZ - WALL, H.maxX + WALL, H.maxZ + WALL, h - 0.35);
    // A lamp over the front door.
    this.parts.add(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: LAMP }), 0, 3.4, H.minZ - 2.3);

    // The block's ends, full height (they close off the pipe chase).
    this.solid(minX - 0.3, 0, corridor, minX, h, BACK_ROW.front, CONCRETE);
    this.solid(maxX, 0, corridor, maxX + 0.3, h, BACK_ROW.front, CONCRETE);
    // Upper tiers: solid, with a gallery and painted-on bars along each face.
    this.solid(minX, 3.6, corridor, maxX, h, PIPE_Z0, CONCRETE);
    this.solid(minX, 3.6, PIPE_Z1, maxX, h, BACK_ROW.front, CONCRETE);
    for (const [face, out] of [[corridor, -1], [BACK_ROW.front, 1]] as const) {
      for (const y of [3.6, 5.4]) {
        this.solid(minX, y, Math.min(face, face + out * 0.8), maxX, y + 0.12, Math.max(face, face + out * 0.8), CONCRETE_DARK, false);
        this.solid(minX, y + 0.95, Math.min(face + out * 0.75, face + out * 0.8), maxX, y + 1.02, Math.max(face + out * 0.75, face + out * 0.8), STEEL, false);
        for (let x = minX + 0.15; x < maxX; x += 0.6) this.parts.add(this.box, plastic(STEEL), x, y + 0.9, face + out * 0.03, 0, 0, 0, 0.06, 1.6, 0.06);
      }
    }

    // The front row: partitions, barred fronts with a gap for each door (see Cells), and the back
    // wall, with a vent in the back of the first three.
    for (let x = minX + CELL_WIDTH; x < maxX; x += CELL_WIDTH) this.solid(x - 0.15, 0, corridor, x + 0.15, 3.6, rowBack, CONCRETE);
    for (let i = 0, x = minX; x < maxX; i++, x += CELL_WIDTH) {
      this.barsX(x + 0.15, x + DOOR_FROM, corridor, 3.6);
      this.blocker(x + 0.15, 0, corridor - 0.05, x + DOOR_FROM, 3.6, corridor + 0.05);
      this.barsX(x + DOOR_TO, x + CELL_WIDTH - 0.15, corridor, 3.6);
      this.blocker(x + DOOR_TO, 0, corridor - 0.05, x + CELL_WIDTH - 0.15, 3.6, corridor + 0.05);
      this.solid(x + 0.5, 0, rowBack - 1, x + 2.6, 0.55, rowBack - 0.1, WOOD);
      if (VENT_CELLS.includes(i)) {
        this.solid(x, 0, rowBack, x + VENT_FROM, 3.6, PIPE_Z0, CONCRETE);
        this.solid(x + VENT_TO, 0, rowBack, x + CELL_WIDTH, 3.6, PIPE_Z0, CONCRETE);
        this.solid(x + VENT_FROM, VENT_HEIGHT, rowBack, x + VENT_TO, 3.6, PIPE_Z0, CONCRETE);
        // A dummy head on the pillow and a lump under the blanket, to fool the guards.
        this.solid(x + 0.6, 0.55, rowBack - 0.9, x + 2, 0.75, rowBack - 0.2, 0x5a6a8a, false);
        this.parts.add(new THREE.SphereGeometry(0.16, 10, 8), plastic(0xd8b48c), x + 2.2, 0.72, rowBack - 0.55);
      } else {
        this.solid(x, 0, rowBack, x + CELL_WIDTH, 3.6, PIPE_Z0, CONCRETE);
        this.solid(x + 3.6, 0, rowBack - 0.9, x + 4.2, 0.45, rowBack - 0.3, STEEL);
      }
    }
    // The back row: emptied out, doors gone.
    this.solid(minX, 0, PIPE_Z1, maxX, 3.6, BACK_ROW.back, CONCRETE);
    for (let x = minX + CELL_WIDTH; x < maxX; x += CELL_WIDTH) this.solid(x - 0.15, 0, BACK_ROW.back, x + 0.15, 3.6, BACK_ROW.front, CONCRETE);
    for (let x = minX; x < maxX; x += CELL_WIDTH) {
      this.barsX(x + 0.15, x + DOOR_FROM, BACK_ROW.front, 3.6);
      this.blocker(x + 0.15, 0, BACK_ROW.front - 0.05, x + DOOR_FROM, 3.6, BACK_ROW.front + 0.05);
      this.barsX(x + DOOR_TO, x + CELL_WIDTH - 0.15, BACK_ROW.front, 3.6);
      this.blocker(x + DOOR_TO, 0, BACK_ROW.front - 0.05, x + CELL_WIDTH - 0.15, 3.6, BACK_ROW.front + 0.05);
      this.solid(x + 0.5, 0, BACK_ROW.back + 0.1, x + 2.6, 0.55, BACK_ROW.back + 1, WOOD);
    }

    // The pipe chase: pipes along both walls, valves, a dim bulb or two, and the ladder of pipes
    // up to the roof ventilator at the east end.
    const pipeMat = plastic(0x6a6e72);
    const rust = plastic(0x8a5a3a);
    for (const [z, y, r, mat] of [
      [PIPE_Z0 + 0.15, 0.4, 0.09, pipeMat],
      [PIPE_Z0 + 0.15, 1.1, 0.06, rust],
      [PIPE_Z0 + 0.18, 2.6, 0.12, pipeMat],
      [PIPE_Z1 - 0.15, 0.7, 0.1, rust],
      [PIPE_Z1 - 0.15, 1.9, 0.07, pipeMat],
      [PIPE_Z1 - 0.18, 3.4, 0.12, pipeMat],
      [PIPE_Z0 + 0.2, 5, 0.1, rust],
      [PIPE_Z1 - 0.2, 6, 0.1, pipeMat],
    ] as const) {
      const pipe = new THREE.CylinderGeometry(r, r, maxX - minX, 10).rotateZ(Math.PI / 2);
      this.parts.add(pipe, mat, 0, y, z);
      pipe.dispose();
    }
    for (let x = minX + 3; x < maxX - 2; x += 6) {
      this.parts.add(new THREE.TorusGeometry(0.12, 0.03, 6, 12), plastic(0xc0392b), x, 1.1, PIPE_Z0 + 0.32);
    }
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    for (let x = minX + 6; x < maxX; x += 12) this.parts.add(new THREE.SphereGeometry(0.12, 8, 6), lamp, x, h - 0.4, (PIPE_Z0 + PIPE_Z1) / 2);
    const ladderX = maxX - 0.8;
    for (const dz of [-0.35, 0.35]) {
      const rail = new THREE.CylinderGeometry(0.06, 0.06, h, 8);
      this.parts.add(rail, pipeMat, ladderX + 0.5, h / 2, (PIPE_Z0 + PIPE_Z1) / 2 + dz);
      rail.dispose();
    }
    for (let y = 0.4; y < h; y += 0.45) this.parts.add(this.box, pipeMat, ladderX + 0.5, y, (PIPE_Z0 + PIPE_Z1) / 2, 0, 0, 0, 0.06, 0.06, 0.7);

    // Ceiling lamps down the front and back corridors.
    const bulb = new THREE.MeshBasicMaterial({ color: LAMP });
    for (let x = minX + 4; x < maxX; x += 8) {
      this.parts.add(this.box, bulb, x, h - 0.08, (H.minZ + corridor) / 2, 0, 0, 0, 1.2, 0.1, 0.3);
      this.parts.add(this.box, bulb, x, h - 0.08, (BACK_ROW.front + H.maxZ) / 2, 0, 0, 0, 1.2, 0.1, 0.3);
    }
  }

  /**
   * The cellhouse roof: a parapet round the edge (with a gap at the bakery pipe), the raised
   * clerestory down the middle, ventilators (the one over the pipe chase is the way up), and
   * masts for the searchlights.
   */
  private buildRoof(): void {
    const H = CELLHOUSE;
    const y0 = ROOF_TOP;
    const x0 = H.minX - WALL - 0.3;
    const x1 = H.maxX + WALL + 0.3;
    const z0 = H.minZ - WALL - 0.3;
    const z1 = H.maxZ + WALL + 0.3;
    const t = 0.3;
    this.solid(x0, y0, z0, x1, y0 + PARAPET, z0 + t, CONCRETE_DARK);
    this.solid(x0, y0, z1 - t, x1, y0 + PARAPET, z1, CONCRETE_DARK);
    this.solid(x1 - t, y0, z0, x1, y0 + PARAPET, z1, CONCRETE_DARK);
    this.solid(x0, y0, z0, x0 + t, y0 + PARAPET, PIPE_SPOT.z - 0.9, CONCRETE_DARK);
    this.solid(x0, y0, PIPE_SPOT.z + 0.9, x0 + t, y0 + PARAPET, z1, CONCRETE_DARK);
    // The clerestory: a long raised roof with a row of windows down each side.
    const c = CLERESTORY;
    this.solid(c.minX, y0, c.minZ, c.maxX, y0 + c.height, c.maxZ, CONCRETE);
    this.solid(c.minX - 0.3, y0 + c.height, c.minZ - 0.3, c.maxX + 0.3, y0 + c.height + 0.25, c.maxZ + 0.3, ROOF);
    for (let x = c.minX + 0.8; x < c.maxX - 1; x += 2.2) {
      this.solid(x, y0 + 0.9, c.minZ - 0.03, x + 1.4, y0 + 2.1, c.minZ, 0x8fb4d0, false);
      this.solid(x, y0 + 0.9, c.maxZ, x + 1.4, y0 + 2.1, c.maxZ + 0.03, 0x8fb4d0, false);
    }
    // Ventilators: the big one over the pipe chase (the way up), and smaller ones to hide behind.
    const vent = (x: number, z: number, s: number, tall: number) => {
      this.solid(x - s / 2, y0, z - s / 2, x + s / 2, y0 + tall, z + s / 2, 0x7d8288);
      this.solid(x - s / 2 - 0.15, y0 + tall, z - s / 2 - 0.15, x + s / 2 + 0.15, y0 + tall + 0.2, z + s / 2 + 0.15, ROOF, false);
    };
    vent(BLOCK_A.maxX - 0.3, (PIPE_Z0 + PIPE_Z1) / 2, 1.8, 1.6);
    // Tall enough (2.2 m) to hide a standing man from a searchlight: three just off the way along
    // the clerestory's north side, one at the west end on the way to the bakery pipe.
    for (const [x, z] of [[10, 16.8], [0, 16.8], [-9, 16.8], [-18.5, 20.5], [-19, 28], [-9, 31], [3, 33], [14, 31.5], [17, 13]]) vent(x, z, 1.3, 2.2);
    // Searchlight masts on the roof's edges (the lamps are in Searchlights).
    const mast = new THREE.CylinderGeometry(0.12, 0.15, 5, 8);
    for (const [x, z] of [[0, H.minZ - 0.4], [0, H.maxZ + 0.4], [H.minX - 0.4, 18]]) this.parts.add(mast, plastic(STEEL), x, y0 + 2.5, z);
    mast.dispose();
  }

  /** The bakery against the cellhouse's west wall, and its tall flue pipe up the wall to the roof: the way down. */
  private buildBakery(): void {
    const b = BAKERY;
    this.solid(b.minX, 0, b.minZ, b.maxX, b.height, b.maxZ, 0xb7a58a);
    this.solid(b.minX - 0.3, b.height, b.minZ - 0.3, b.maxX + 0.3, b.height + 0.3, b.maxZ + 0.3, 0x7a3a2a);
    this.solid(b.minX + 1, 1.2, b.minZ - 0.03, b.minX + 2.6, 2.4, b.minZ, 0x2a3040, false);
    this.solid(b.minX + 3, 0, b.minZ - 0.03, b.minX + 4.2, 2.3, b.minZ, 0x5a3a20, false);
    this.solid(b.minX + 1.4, 2.6, b.minZ - 0.12, b.maxX - 0.6, 3.2, b.minZ, 0xe6d27a, false);
    // The flue: up the cellhouse wall from the ground to above the roof's edge, with brackets.
    const p = PIPE_SPOT;
    const pipe = new THREE.CylinderGeometry(0.2, 0.2, ROOF_TOP + 1.2, 12);
    this.parts.add(pipe, plastic(0x55595e), p.x, (ROOF_TOP + 1.2) / 2, p.z);
    pipe.dispose();
    this.parts.add(new THREE.TorusGeometry(0.35, 0.2, 8, 12, Math.PI / 2), plastic(0x55595e), p.x, ROOF_TOP + 1.2, p.z, 0, Math.PI / 2, 0);
    for (let y = 1; y < ROOF_TOP; y += 1.6) this.parts.add(this.box, plastic(STEEL), p.x + 0.1, y, p.z, 0, 0, 0, 0.3, 0.1, 0.5);
    this.blocker(p.x - 0.2, 0, p.z - 0.2, p.x + 0.2, ROOF_TOP - 0.5, p.z + 0.2);
  }

  /**
   * The motor pool: a chain-link fence (with a gap on its north side for the sliding gate, see
   * Breakout), and a carport roof over where the tank and the trucks are parked.
   */
  private buildMotorPool(): void {
    const l = LOT;
    const h = 2.6;
    const fence = (x0: number, z0: number, x1: number, z1: number) => {
      const steel = plastic(0x7a8086);
      const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const len = along ? x1 - x0 : z1 - z0;
      for (let t = 0; t <= len + 0.01; t += 2) {
        const x = along ? x0 + t : x0;
        const z = along ? z0 : z0 + t;
        this.parts.add(this.box, steel, x, h / 2, z, 0, 0, 0, 0.1, h, 0.1);
      }
      for (const y of [0.1, h / 2, h - 0.05]) this.parts.add(this.box, steel, (x0 + x1) / 2, y, (z0 + z1) / 2, 0, 0, 0, along ? len : 0.06, 0.06, along ? 0.06 : len);
      // The mesh: thin wires criss-crossing, drawn as a lattice of slats.
      const wire = plastic(0x9aa2a8);
      for (let t = 0.25; t < len; t += 0.5) {
        const x = along ? x0 + t : x0;
        const z = along ? z0 : z0 + t;
        this.parts.add(this.box, wire, x, h / 2, z, 0, 0, 0, along ? 0.02 : 0.02, h - 0.2, along ? 0.02 : 0.02);
      }
      this.blocker(Math.min(x0, x1) - 0.05, 0, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, h, Math.max(z0, z1) + 0.05);
    };
    fence(l.minX, l.minZ, l.gateX0, l.minZ);
    fence(l.gateX1, l.minZ, l.maxX, l.minZ);
    fence(l.minX, l.minZ, l.minX, l.maxZ);
    this.solid(l.gateX0 - 0.25, 0, l.minZ - 0.25, l.gateX0 + 0.25, h + 0.4, l.minZ + 0.25, STEEL);
    this.solid(l.gateX1 - 0.25, 0, l.minZ - 0.25, l.gateX1 + 0.25, h + 0.4, l.minZ + 0.25, STEEL);
    // The carport: a flat roof on posts (none in the tank's way out).
    for (const x of [48.5, 56.5, 64.5, 70.8]) for (const z of [29.8, 38.4]) this.solid(x - 0.15, 0, z - 0.15, x + 0.15, 4.2, z + 0.15, STEEL);
    this.solid(47.5, 4.2, 29.3, 71.4, 4.45, 38.9, 0x5a6168);
    // A sign on the fence.
    this.solid(l.gateX1 + 1, 1.4, l.minZ - 0.12, l.gateX1 + 4.4, 2.2, l.minZ - 0.05, SIGN, false);
    // Oil drums and a fuel pump.
    for (const [x, z] of [[69.5, 29.5], [70.3, 30.4], [69.6, 31.3]]) {
      this.parts.add(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 12), plastic(0x3a5a8a), x, 0.45, z);
    }
    this.solid(46.8, 0, 39.6, 47.6, 1.8, 40.4, 0xc0392b);
  }

  /** A window on a wall facing ±Z (`out` -1 north, 1 south): dark glass, a lighter surround and bars in front. */
  private barredWindow(x0: number, x1: number, y0: number, y1: number, z: number, out: number): void {
    const f = (d: number) => z + out * d;
    this.solid(x0, y0, Math.min(f(0), f(0.03)), x1, y1, Math.max(f(0), f(0.03)), 0x2a3040, false);
    const frame = plastic(0xb4ae9e);
    this.parts.add(this.box, frame, (x0 + x1) / 2, y0 - 0.08, f(0.06), 0, 0, 0, x1 - x0 + 0.4, 0.16, 0.14);
    this.parts.add(this.box, frame, (x0 + x1) / 2, y1 + 0.06, f(0.04), 0, 0, 0, x1 - x0 + 0.3, 0.12, 0.08);
    const steel = plastic(STEEL);
    for (let x = x0 + 0.2; x < x1 - 0.05; x += 0.3) this.parts.add(this.box, steel, x, (y0 + y1) / 2, f(0.08), 0, 0, 0, 0.05, y1 - y0, 0.05);
  }

  /** Pilasters up a wall facing ±Z (`out`), every `every` metres from `from`. */
  private pilasters(x0: number, x1: number, z: number, h: number, out: number, every: number, from: number): void {
    const mat = plastic(CONCRETE_DARK);
    for (let x = from; x < x1 - 0.2; x += every) {
      if (x < x0 + 0.2) continue;
      this.parts.add(this.box, mat, x, h / 2, z + out * 0.1, 0, 0, 0, 0.45, h, 0.2);
    }
  }

  /** A cornice: a strip standing proud all round a building's walls at height `y`. */
  private cornice(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const mat = plastic(CONCRETE_DARK);
    const t = 0.25;
    this.parts.add(this.box, mat, (x0 + x1) / 2, y, z0 - t / 2, 0, 0, 0, x1 - x0 + 2 * t, 0.28, t);
    this.parts.add(this.box, mat, (x0 + x1) / 2, y, z1 + t / 2, 0, 0, 0, x1 - x0 + 2 * t, 0.28, t);
    this.parts.add(this.box, mat, x0 - t / 2, y, (z0 + z1) / 2, 0, 0, 0, t, 0.28, z1 - z0);
    this.parts.add(this.box, mat, x1 + t / 2, y, (z0 + z1) / 2, 0, 0, 0, t, 0.28, z1 - z0);
  }

  /** A painted board with `text` on it, facing -Z, centred at (x, y, z). */
  private textBoard(text: string, x: number, y: number, z: number, w: number, h: number, bg: string, fg: string): void {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.round((512 * h) / w);
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = fg;
    ctx.font = `900 ${Math.round(c.height * 0.62)}px "Black Ops One", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c.width / 2, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    board.position.set(x, y, z);
    board.rotation.y = Math.PI;
    this.group.add(board);
  }

  /**
   * Things round the yard and the wings: floodlight poles, a painted basketball court with a
   * hoop, benches by the cellhouse, and a water tower in the west wing.
   */
  private buildYardDressing(): void {
    const steel = plastic(STEEL);
    const lampGlow = new THREE.MeshBasicMaterial({ color: LAMP });
    // Floodlights on tall poles, two lamps each, turned in towards the yard.
    for (const [x, z] of [[-28.4, -14], [28.4, -14], [-14, -23.4], [14, -23.4], [-28.4, 22], [28.4, 22], [50, -23.4], [-50, -23.4]]) {
      const pole = new THREE.CylinderGeometry(0.1, 0.14, 8, 8);
      this.parts.add(pole, steel, x, 4, z);
      pole.dispose();
      const inward = Math.atan2(-x, -(z + 5));
      this.parts.add(this.box, steel, x, 8, z, 0, inward, 0, 1.6, 0.1, 0.1);
      for (const s of [-0.6, 0.6]) {
        const lx = x + Math.cos(inward) * s;
        const lz = z - Math.sin(inward) * s;
        this.parts.add(this.box, steel, lx, 8.25, lz, -0.5, inward, 0, 0.45, 0.35, 0.3);
        this.parts.add(this.box, lampGlow, lx - Math.sin(inward) * 0.16, 8.15, lz - Math.cos(inward) * 0.16, -0.5, inward, 0, 0.36, 0.26, 0.02);
      }
      this.blocker(x - 0.15, 0, z - 0.15, x + 0.15, 8, z + 0.15);
    }

    // A basketball court painted on the yard (the lines are just paint), with a hoop at the west end.
    const paint = plastic(0xe8e4d0);
    const court = { minX: -21, maxX: -7, minZ: -21.5, maxZ: -13.5 };
    const line = (x0: number, z0: number, x1: number, z1: number) =>
      this.parts.add(this.box, paint, (x0 + x1) / 2, 0.015, (z0 + z1) / 2, 0, 0, 0, Math.max(0.1, x1 - x0), 0.01, Math.max(0.1, z1 - z0));
    line(court.minX, court.minZ, court.maxX, court.minZ);
    line(court.minX, court.maxZ, court.maxX, court.maxZ);
    line(court.minX, court.minZ, court.minX, court.maxZ);
    line(court.maxX, court.minZ, court.maxX, court.maxZ);
    line(-14, court.minZ, -14, court.maxZ);
    line(court.minX, -19.5, court.minX + 3.5, -19.5);
    line(court.minX, -15.5, court.minX + 3.5, -15.5);
    line(court.minX + 3.5, -19.5, court.minX + 3.5, -15.5);
    const ring = new THREE.RingGeometry(1.7, 1.8, 32).rotateX(-Math.PI / 2);
    this.parts.add(ring, paint, -14, 0.016, -17.5);
    ring.dispose();
    this.parts.add(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), steel, court.minX - 0.8, 1.6, -17.5);
    this.parts.add(this.box, steel, court.minX - 0.45, 3.1, -17.5, 0, 0, 0, 0.8, 0.08, 0.08);
    this.parts.add(this.box, plastic(0xf4f1e4), court.minX - 0.05, 3.3, -17.5, 0, 0, 0, 0.06, 1, 1.6);
    const hoop = new THREE.TorusGeometry(0.24, 0.025, 6, 16).rotateX(Math.PI / 2);
    this.parts.add(hoop, plastic(0xd8572a), court.minX + 0.27, 3.05, -17.5);
    hoop.dispose();
    this.blocker(court.minX - 0.9, 0, -17.6, court.minX - 0.7, 3.2, -17.4);

    // Benches either side of the cellhouse door.
    for (const x of [-9, 9]) {
      this.solid(x - 1.2, 0.42, CELLHOUSE.minZ - 3.2, x + 1.2, 0.5, CELLHOUSE.minZ - 2.7, WOOD);
      for (const lx of [x - 1, x + 1]) this.solid(lx - 0.06, 0, CELLHOUSE.minZ - 3.15, lx + 0.06, 0.42, CELLHOUSE.minZ - 2.75, STEEL);
    }

    // A water tower in the west wing: four braced legs, a tank and a pointed roof.
    const wt = { x: -52, z: 30 };
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const legs: [number, number][] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
    for (const [dx, dz] of legs) {
      this.parts.beam(v(wt.x + dx * 1.2, 0, wt.z + dz * 1.2), v(wt.x + dx, 10, wt.z + dz), 0.25, steel);
      this.blocker(wt.x + dx * 1.2 - 0.2, 0, wt.z + dz * 1.2 - 0.2, wt.x + dx * 1.2 + 0.2, 3, wt.z + dz * 1.2 + 0.2);
    }
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i];
      const [bx, bz] = legs[(i + 1) % 4];
      this.parts.beam(v(wt.x + ax * 1.15, 1, wt.z + az * 1.15), v(wt.x + bx * 1.05, 6, wt.z + bz * 1.05), 0.08, steel);
      this.parts.beam(v(wt.x + bx * 1.15, 1, wt.z + bz * 1.15), v(wt.x + ax * 1.05, 6, wt.z + az * 1.05), 0.08, steel);
    }
    this.parts.add(new THREE.CylinderGeometry(3, 3, 3.6, 20), plastic(0x9aa2a8), wt.x, 11.8, wt.z);
    this.parts.add(new THREE.ConeGeometry(3.3, 1.6, 20), plastic(ROOF), wt.x, 14.4, wt.z);
    this.parts.add(new THREE.CylinderGeometry(3.15, 3.15, 0.15, 20), steel, wt.x, 10, wt.z);
    for (let y = 0.5; y < 10; y += 0.5) this.parts.add(this.box, steel, wt.x + 2.6, y, wt.z, 0, 0, 0, 0.05, 0.05, 0.5);
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
    // Small barred windows along the front, pilasters, and a cornice under the roof.
    for (let x = minX + 2; x < maxX - 1; x += 5) {
      if (Math.abs(x + 0.6 - doorX) < 3) continue;
      this.barredWindow(x, x + 1.2, 2, 3, minZ - WALL, -1);
    }
    this.pilasters(minX - WALL, maxX + WALL, minZ - WALL, h, -1, 5, minX + 0.5);
    this.cornice(minX - WALL, minZ - WALL, maxX + WALL, maxZ + WALL, h - 0.3);

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
    // A sign over the door, a porch roof on posts, plank siding, and a chimney.
    this.solid(maxX + WALL, 2.75, doorZ0 - 0.6, maxX + WALL + 0.12, 3.25, doorZ1 + 0.6, SIGN, false);
    this.solid(maxX + WALL, 3.05, doorZ0 - 1.2, maxX + WALL + 1.8, 3.2, doorZ1 + 1.2, 0x6b5a3a, false);
    for (const z of [doorZ0 - 1, doorZ1 + 1]) this.solid(maxX + WALL + 1.5, 0, z - 0.1, maxX + WALL + 1.7, 3.05, z + 0.1, WOOD);
    const plank = plastic(0x8a7a5a);
    for (let y = 0.4; y < h - 0.2; y += 0.42) {
      this.parts.add(this.box, plank, (minX + maxX) / 2, y, minZ - WALL - 0.01, 0, 0, 0, maxX - minX + 2 * WALL, 0.04, 0.03);
      this.parts.add(this.box, plank, (minX + maxX) / 2, y, maxZ + WALL + 0.01, 0, 0, 0, maxX - minX + 2 * WALL, 0.04, 0.03);
      this.parts.add(this.box, plank, minX - WALL - 0.01, y, (minZ + maxZ) / 2, 0, 0, 0, 0.03, 0.04, maxZ - minZ + 2 * WALL);
    }
    this.solid(minX + 4, h, maxZ - 3, minX + 5, h + 2.2, maxZ - 2, 0x7a4a3a, false);
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
    this.textBoard('SOLITARY', (minX + maxX) / 2, h + 0.55, frontZ - 0.62, 3.6, 0.6, '#c4a468', '#3a2e1a');
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

/** Back and forth from `a` to `b` along each line in turn (lines at fixed z, given in `lines`). */
function zigzag(a: number, b: number, lines: number[]): { x: number; z: number }[] {
  return lines.flatMap((z, i) => (i % 2 === 0 ? [{ x: a, z }, { x: b, z }] : [{ x: b, z }, { x: a, z }]));
}

/** The cells along a block, west to east. */
function blockCells(b: BlockPlan, block: ZoneId): CellSpot[] {
  return Array.from({ length: (b.maxX - b.minX) / CELL_WIDTH }, (_, i) => {
    const minX = b.minX + i * CELL_WIDTH;
    return { minX, maxX: minX + CELL_WIDTH, frontZ: b.corridor, backZ: b.maxZ, doorX0: minX + DOOR_FROM, doorX1: minX + DOOR_TO, height: CEILING, block };
  });
}
