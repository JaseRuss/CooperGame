import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PartBuilder } from '../utils/modelKit';
import { plastic, shade, ARMY_GREEN } from '../utils/plastic';
import { createFigureMesh } from '../entities/Soldier';
import { buildWallSegment, buildGateTower, buildCottage, gableRoofAlongX, prism, WALL_HEIGHT, WALL_THICK, STONE, STONE_DARK, WOOD, WOOD_DARK } from '../world/Medieval';
import {
  addCornerTower,
  addGateTower,
  addWallDetail,
  buildStirlingGreatHall,
  buildChapelRoyal,
  buildGreatKitchens,
  buildElphinstoneTower,
  buildKnotGarden,
  saltire,
  royalStandard,
  BUFF,
} from '../world/StirlingCastle';
import type { GuardPost } from '../prison/Facility';

/** The courtyard: inside the walls it runs from -YARD_X to YARD_X across and -YARD_Z to YARD_Z deep. */
export const YARD_X = 35.5;
export const YARD_Z = 41;
/** Where the player starts (just inside the gate, facing in), and the gap in the south wall. */
export const START = { x: 0, z: 38, yaw: 0 };
export const GATE_HALF = 5;
const WALL_X = 37;
const WALL_Z = 42;
const CELL_PITCH = 7.4;
const CELL_WIDTH = 6.4;
/** The cell doors' line, and how deep each cell goes behind it. */
export const DOOR_Z = -20.2;
const CELL_DEPTH = 4;
const BLOCK_BACK = -36;
const BLOCK_HEIGHT = 7;
const BARS_HEIGHT = 3.3;
const OPEN_TIME = 0.9;
export const MAX_CELLS = 6;

const GLOOM = 0x25211c;
const IRON = 0x4a4d52;
const GROUND = 0x6e6a58;
const PAVING = 0x8a8473;
const GRASS = 0x56783a;

export interface DungeonCell {
  index: number;
  /** Middle of the cell, across. */
  x: number;
  /** The door's collider (switched off once it's open) and the bars that slide up. */
  door: RAPIER.Collider;
  bars: THREE.Group;
  /** 0 shut, 1 open. */
  open: number;
  opening: boolean;
  prisoners: THREE.Mesh[];
}

export interface DungeonLayout {
  cells: DungeonCell[];
  /** The jailers' posts and beats. */
  guards: GuardPost[];
  /** Where flames burn (for the lights). */
  torches: THREE.Vector3[];
}

type Box = { x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw?: number };

/**
 * The castle dungeon courtyard, built in code: curtain walls with a gate on the south side, a
 * block of cells along the north wall (iron-barred doors that slide up), crates, barrels and
 * cottages to hide behind, a well and torches. Night. Everything solid is in the physics world,
 * in the default (walls) collision group, so the guards' sight lines and the player's moves treat
 * it as walls.
 */
export class Dungeon {
  readonly group = new THREE.Group();
  readonly layout: DungeonLayout;
  private readonly flames: THREE.Mesh[] = [];
  private time = 0;

  /**
   * `royal`: the Great Castle's dungeon, dressed like Stirling Castle: round corner towers and a
   * Forework gate, the Great Hall, Chapel Royal and Great Kitchens round the yard, a knot garden,
   * the Elphinstone Tower for cover, and a slate roof and chimneys on the cell block.
   */
  constructor(private readonly world: RAPIER.World, cellCount: number, armyColor: number, private readonly royal = false) {
    const cells = Math.max(1, Math.min(MAX_CELLS, cellCount));
    this.buildGround();
    this.buildWalls(armyColor);
    const cellList = this.buildBlock(cells);
    this.buildProps();
    const torches = this.buildTorches(cellList);
    this.layout = { cells: cellList, guards: this.guardPosts(), torches };
    // Colliders added now aren't seen by queries until the world steps.
    this.world.step();
  }

  // ---------- helpers ----------

  private solid(b: Box): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const yaw = b.yaw ?? 0;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
      body,
    );
  }

  private round(x: number, z: number, r: number, h: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, h / 2, z), body);
  }

  // ---------- the ground and walls ----------

  private buildGround(): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(300, 0.5, 300).setTranslation(0, -0.5, 0), body);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1 }));
    grass.position.y = -0.02;
    grass.receiveShadow = true;
    const dirt = new THREE.Mesh(new THREE.PlaneGeometry(WALL_X * 2, WALL_Z * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1 }));
    dirt.position.y = 0;
    dirt.receiveShadow = true;
    // A paved apron in front of the cells and a road from the gate up to it.
    const paving = new THREE.MeshStandardMaterial({ color: PAVING, roughness: 0.95 });
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(52, 9).rotateX(-Math.PI / 2), paving);
    apron.position.set(0, 0.02, -15.5);
    apron.receiveShadow = true;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 56).rotateX(-Math.PI / 2), paving);
    road.position.set(0, 0.02, 13);
    road.receiveShadow = true;
    // The road carries on out through the gate.
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(9, 80).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 1 }));
    lane.position.set(0, 0.015, WALL_Z + 40);
    lane.receiveShadow = true;
    this.group.add(grass, dirt, apron, road, lane);
  }

  private buildWalls(armyColor: number): void {
    const wall = (len: number, x: number, z: number, yaw: number, alongX: boolean) => {
      const w = buildWallSegment(len);
      w.position.set(x, 0, z);
      w.rotation.y = yaw;
      this.group.add(w);
      this.solid({ x, y: 4, z, hx: alongX ? len / 2 : WALL_THICK / 2 + 0.2, hy: 4, hz: alongX ? WALL_THICK / 2 + 0.2 : len / 2 });
    };
    wall(WALL_X * 2 + 6, 0, -WALL_Z, Math.PI, true); // north
    wall(WALL_Z * 2 + 3, -WALL_X, 0, -Math.PI / 2, false); // west
    wall(WALL_Z * 2 + 3, WALL_X, 0, Math.PI / 2, false); // east
    // South, either side of the gate towers.
    const towerHalf = 4.5;
    const gateInner = GATE_HALF + 2 * towerHalf;
    const sideLen = WALL_X + 3 - gateInner;
    for (const s of [-1, 1]) {
      wall(sideLen, s * (gateInner + sideLen / 2), WALL_Z, 0, true);
      if (!this.royal) {
        const tower = buildGateTower(armyColor);
        tower.position.set(s * (GATE_HALF + towerHalf), 0, WALL_Z);
        this.group.add(tower);
      }
      this.solid({ x: s * (GATE_HALF + towerHalf), y: 6, z: WALL_Z, hx: towerHalf, hy: 6, hz: towerHalf });
    }
    if (this.royal) this.buildRoyalTowers();
  }

  /** Stirling's round towers on the four corners and either side of the Forework gate, and bartizans along the walls. */
  private buildRoyalTowers(): void {
    const p = new PartBuilder();
    const flag = saltire();
    const flagAt = (x: number, y: number, z: number) => {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.3).translate(1.8, 0, 0), flag);
      f.position.set(x, y, z);
      this.group.add(f);
    };
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const tip = addCornerTower(p, sx * WALL_X, sz * WALL_Z);
        flagAt(sx * WALL_X, tip - 0.6, sz * WALL_Z);
        this.solid({ x: sx * WALL_X, y: 7.5, z: sz * WALL_Z, hx: 6.4, hy: 7.5, hz: 6.4 });
      }
    }
    for (const sx of [-1, 1]) addGateTower(p, sx * (GATE_HALF + 4.6), WALL_Z, 1);
    const detail = (x0: number, z0: number, x1: number, z1: number) => {
      const along = Math.atan2(x1 - x0, z1 - z0);
      const out = Math.sign(Math.cos(along) * ((x0 + x1) / 2) - Math.sin(along) * ((z0 + z1) / 2)) || 1;
      addWallDetail(p, x0, z0, x1, z1, WALL_HEIGHT, WALL_THICK, out, 0x434b55);
    };
    detail(-WALL_X + 9, -WALL_Z, WALL_X - 9, -WALL_Z);
    detail(-WALL_X, -WALL_Z + 9, -WALL_X, WALL_Z - 9);
    detail(WALL_X, -WALL_Z + 9, WALL_X, WALL_Z - 9);
    p.buildInto(this.group);
  }

  // ---------- the cell block ----------

  private buildBlock(count: number): DungeonCell[] {
    const width = count * CELL_PITCH + 2;
    const frontZ = DOOR_Z - CELL_DEPTH; // the block's face behind the cells
    const p = new PartBuilder();
    const stone = plastic(this.royal ? BUFF : STONE);
    const stoneDark = plastic(STONE_DARK);
    const gloom = plastic(GLOOM);
    const iron = plastic(IRON);
    const depth = frontZ - BLOCK_BACK;
    p.add(new THREE.BoxGeometry(width, BLOCK_HEIGHT, depth), stone, 0, BLOCK_HEIGHT / 2, BLOCK_BACK + depth / 2);
    p.add(new THREE.BoxGeometry(width + 1, 0.9, depth + 1), stoneDark, 0, 0.45, BLOCK_BACK + depth / 2);
    p.add(new THREE.BoxGeometry(width + 0.8, 0.6, depth + 0.8), stoneDark, 0, BLOCK_HEIGHT + 0.1, BLOCK_BACK + depth / 2);
    for (let x = -width / 2 + 1; x <= width / 2 - 1; x += 2.4) p.add(new THREE.BoxGeometry(1.2, 1.2, 1), stone, x, BLOCK_HEIGHT + 1, frontZ - 0.1);
    // The cells: piers between them, a lintel over them, and a dark back wall.
    const cells: DungeonCell[] = [];
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * CELL_PITCH;
      p.add(new THREE.BoxGeometry(CELL_WIDTH - 0.6, 4, 0.1), gloom, x, 2, frontZ + 0.06);
      p.add(new THREE.BoxGeometry(CELL_WIDTH, 0.7, CELL_DEPTH), stoneDark, x, 4.05, frontZ + CELL_DEPTH / 2); // roof of the alcove
      p.add(new THREE.BoxGeometry(CELL_WIDTH - 1, 0.25, CELL_DEPTH - 0.6), plastic(0xc8a050), x, 0.14, frontZ + CELL_DEPTH / 2); // straw
      // A chain hanging on the back wall.
      p.add(new THREE.BoxGeometry(0.1, 1.6, 0.08), iron, x + 1.6, 3.1, frontZ + 0.15);
      p.add(new THREE.TorusGeometry(0.2, 0.04, 6, 10), iron, x + 1.6, 2.2, frontZ + 0.15);
    }
    // The piers between the cells.
    for (let i = 0; i <= count; i++) {
      const x = (i - count / 2) * CELL_PITCH;
      p.add(new THREE.BoxGeometry(1, 4.1, CELL_DEPTH), stone, x, 2.05, frontZ + CELL_DEPTH / 2);
      this.solid({ x, y: 2.05, z: frontZ + CELL_DEPTH / 2, hx: 0.5, hy: 2.05, hz: CELL_DEPTH / 2 });
    }
    const roof = new THREE.Group();
    p.buildInto(roof);
    this.group.add(roof);
    if (this.royal) this.addRoyalRoof(width, depth);
    this.solid({ x: 0, y: BLOCK_HEIGHT / 2, z: BLOCK_BACK + depth / 2, hx: width / 2, hy: BLOCK_HEIGHT / 2, hz: depth / 2 });

    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * CELL_PITCH;
      const bars = new THREE.Group();
      const b = new PartBuilder();
      for (let k = -2; k <= 2; k++) b.add(new THREE.BoxGeometry(0.1, BARS_HEIGHT, 0.1), iron, (k / 2) * (CELL_WIDTH / 2 - 0.2), BARS_HEIGHT / 2, 0);
      for (const y of [0.3, 1.5, BARS_HEIGHT - 0.1]) b.add(new THREE.BoxGeometry(CELL_WIDTH - 0.3, 0.12, 0.12), iron, 0, y, 0);
      b.buildInto(bars);
      bars.position.set(x, 0, DOOR_Z);
      this.group.add(bars);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const door = this.world.createCollider(RAPIER.ColliderDesc.cuboid(CELL_WIDTH / 2, BARS_HEIGHT / 2, 0.15).setTranslation(x, BARS_HEIGHT / 2, DOOR_Z), body);
      cells.push({ index: i, x, door, bars, open: 0, opening: false, prisoners: [] });
    }
    return cells;
  }

  /** A steep slate roof, gable ends, and chimney stacks over the cell block (Stirling's palace vaults). */
  private addRoyalRoof(width: number, depth: number): void {
    const rp = new PartBuilder();
    const slate = plastic(0x59636f);
    const buff = plastic(BUFF);
    gableRoofAlongX(rp, width, depth, 5, BLOCK_HEIGHT + 0.5, slate, 0.7, 0.4);
    for (const sx of [-1, 1]) rp.add(prism(depth, 5, 0.6).rotateY(Math.PI / 2), buff, sx * (width / 2 - 0.3), BLOCK_HEIGHT + 0.5, 0);
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * (width / 4);
      rp.add(new THREE.BoxGeometry(1.7, 3.2, 1.7), buff, x, BLOCK_HEIGHT + 4.6, 0);
      rp.add(new THREE.BoxGeometry(2.2, 0.3, 2.2), plastic(STONE_DARK), x, BLOCK_HEIGHT + 6.3, 0);
      for (const dx of [-0.4, 0.4]) rp.add(new THREE.CylinderGeometry(0.28, 0.34, 0.9, 8), plastic(0xa5502e), x + dx, BLOCK_HEIGHT + 6.9, 0);
    }
    const g = new THREE.Group();
    rp.buildInto(g);
    g.position.z = BLOCK_BACK + depth / 2;
    this.group.add(g);
    const standard = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3).translate(2.3, 0, 0), royalStandard());
    standard.position.set(0, BLOCK_HEIGHT + 12, BLOCK_BACK + depth / 2);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 8, 6), plastic(WOOD_DARK));
    pole.position.set(0, BLOCK_HEIGHT + 9, BLOCK_BACK + depth / 2);
    this.group.add(standard, pole);
  }

  /** Puts `n` of our soldiers in a cell (called by the game, which knows how many are held). */
  fillCell(cell: DungeonCell, n: number): void {
    const baseZ = DOOR_Z - 1.6;
    for (let j = 0; j < n; j++) {
      const figure = createFigureMesh(j % 2 === 0 ? 0 : 1, ARMY_GREEN);
      figure.position.set(cell.x + (j - (n - 1) / 2) * 1.8, 0.2, baseZ - (j % 2) * 0.6);
      figure.rotation.y = Math.PI + (j - (n - 1) / 2) * 0.25;
      this.group.add(figure);
      cell.prisoners.push(figure);
    }
  }

  /** Slides a cell's bars up and takes its door out of the physics world. */
  openCell(cell: DungeonCell): void {
    if (cell.opening) return;
    cell.opening = true;
    cell.door.setEnabled(false);
  }

  // ---------- cover ----------

  /** The royal courtyard: Stirling's Great Hall, Chapel Royal and Great Kitchens round the yard, a knot garden, the Elphinstone Tower, and cover. */
  private buildRoyalProps(): void {
    const put = (model: THREE.Object3D, x: number, z: number, yaw = 0) => {
      model.position.set(x, 0, z);
      model.rotation.y = yaw;
      this.group.add(model);
    };
    put(buildStirlingGreatHall(0xc4a468), 28.4, 8);
    this.solid({ x: 28.4, y: 6, z: 8, hx: 7.8, hy: 6, hz: 20.3 });
    this.solid({ x: 28.4, y: 6, z: -14.5, hx: 5.4, hy: 6, hz: 5.4 });
    put(buildChapelRoyal(0xc4a468), -29, 24);
    this.solid({ x: -29, y: 4.5, z: 24, hx: 5.8, hy: 4.5, hz: 10.4 });
    put(buildGreatKitchens(0xc4a468), -29.6, -3, Math.PI);
    this.solid({ x: -29, y: 4, z: -3, hx: 6.2, hy: 4, hz: 15.2 });
    put(buildElphinstoneTower(), 0, -6);
    this.solid({ x: 0, y: 12, z: -6, hx: 5.6, hy: 12, hz: 5.6 });
    put(buildKnotGarden(), 0, 16);
    const p = new PartBuilder();
    const wood = plastic(WOOD);
    const woodDark = plastic(WOOD_DARK);
    const iron = plastic(IRON);
    const hay = plastic(0xe3c45a);
    const crate = (x: number, z: number, s: number, yaw: number) => {
      p.add(new THREE.BoxGeometry(2 * s, 1.6 * s, 2 * s), wood, x, 0.8 * s, z, 0, yaw);
      p.add(new THREE.BoxGeometry(2.1 * s, 0.18 * s, 2.1 * s), woodDark, x, 0.3 * s, z, 0, yaw);
      this.solid({ x, y: 0.8 * s, z, hx: s, hy: 0.8 * s, hz: s, yaw });
    };
    const barrel = (x: number, z: number) => {
      p.add(new THREE.CylinderGeometry(0.62, 0.56, 1.3, 12), wood, x, 0.65, z);
      for (const y of [0.25, 1.05]) p.add(new THREE.CylinderGeometry(0.66, 0.66, 0.1, 12), iron, x, y, z);
      this.round(x, z, 0.62, 1.3);
    };
    const bale = (x: number, z: number, yaw: number) => {
      p.add(new THREE.BoxGeometry(2.4, 1.2, 1.2), hay, x, 0.6, z, 0, yaw);
      this.solid({ x, y: 0.6, z, hx: 1.2, hy: 0.6, hz: 0.6, yaw });
    };
    crate(-12, 25, 1.1, 0.2); crate(-9.8, 26.8, 0.9, -0.3); barrel(-13.6, 27.6);
    crate(12, 24, 1.2, -0.2); crate(10, 26, 0.9, 0.4); barrel(13.4, 26.6); bale(11.4, 21.4, 0.5);
    crate(-13, 4, 1.2, 0.1); crate(-10.6, 5.8, 0.9, 0.5); bale(-14.8, 2.6, -0.2);
    crate(13.5, 1, 1.1, 0.3); barrel(11.6, 3.4); bale(14, -2.6, 0.6);
    crate(-12, -9, 1.0, 0.5); barrel(-14, -7.6); crate(12.4, -10, 1.0, -0.2);
    p.buildInto(this.group);
  }

  private buildProps(): void {
    if (this.royal) {
      this.buildRoyalProps();
      return;
    }
    const p = new PartBuilder();
    const wood = plastic(WOOD);
    const woodDark = plastic(WOOD_DARK);
    const iron = plastic(IRON);
    const hay = plastic(0xe3c45a);
    const crate = (x: number, z: number, s: number, yaw: number) => {
      p.add(new THREE.BoxGeometry(2 * s, 1.6 * s, 2 * s), wood, x, 0.8 * s, z, 0, yaw);
      p.add(new THREE.BoxGeometry(2.1 * s, 0.18 * s, 2.1 * s), woodDark, x, 0.3 * s, z, 0, yaw);
      p.add(new THREE.BoxGeometry(2.1 * s, 0.18 * s, 2.1 * s), woodDark, x, 1.3 * s, z, 0, yaw);
      this.solid({ x, y: 0.8 * s, z, hx: s, hy: 0.8 * s, hz: s, yaw });
    };
    const barrel = (x: number, z: number) => {
      p.add(new THREE.CylinderGeometry(0.62, 0.56, 1.3, 12), wood, x, 0.65, z);
      for (const y of [0.25, 1.05]) p.add(new THREE.CylinderGeometry(0.66, 0.66, 0.1, 12), iron, x, y, z);
      this.round(x, z, 0.62, 1.3);
    };
    const bale = (x: number, z: number, yaw: number) => {
      p.add(new THREE.BoxGeometry(2.4, 1.2, 1.2), hay, x, 0.6, z, 0, yaw);
      this.solid({ x, y: 0.6, z, hx: 1.2, hy: 0.6, hz: 0.6, yaw });
    };
    // Clusters to hide behind, kept clear of the guards' lanes (x = +-21, z = -16, the central road).
    crate(-14, 24, 1.1, 0.2); crate(-11.8, 25.8, 0.9, -0.3); barrel(-15.6, 26.6); bale(-13, 21.4, 0.4);
    crate(14, 22, 1.2, -0.2); crate(16.2, 24.2, 0.9, 0.4); barrel(12.6, 24.4); barrel(13.6, 25.6);
    crate(-13, 4, 1.2, 0.1); crate(-10.6, 5.6, 0.9, 0.5); bale(-15.4, 3.2, -0.2);
    crate(13.5, -1, 1.1, 0.3); barrel(15.6, 1.2); bale(11.6, 1.4, 0.6); crate(16.2, -3.2, 0.9, 0);
    crate(-27.4, -8, 1.1, 0); barrel(-28.8, -5.6); crate(27.4, -9.4, 1.0, 0.3); bale(27.6, -6.2, 0.2);
    crate(-6.4, -9, 1.0, 0.5); crate(6.8, -11, 1.0, -0.2); barrel(-8.4, -10.4);
    // The well, on the central road's edge.
    p.add(new THREE.CylinderGeometry(1.5, 1.6, 1.1, 14), plastic(shade(STONE, 0.9)), -6.5, 0.55, 14);
    p.add(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 14), plastic(0x2e5f86), -6.5, 1.0, 14);
    for (const s of [-1, 1]) p.add(new THREE.BoxGeometry(0.2, 2.4, 0.2), woodDark, -6.5 + s * 1.5, 2.2, 14);
    p.add(new THREE.BoxGeometry(3.6, 0.2, 0.2), woodDark, -6.5, 3.3, 14);
    this.round(-6.5, 14, 1.6, 1.2);
    p.buildInto(this.group);

    // Barracks cottages in the east and west corners, fronts to the yard.
    const west = buildCottage(0, 'thatch', 1);
    west.position.set(-30.4, 0, 22);
    west.rotation.y = Math.PI / 2;
    const east = buildCottage(1, 'tile', 2);
    east.position.set(30.4, 0, 18);
    east.rotation.y = -Math.PI / 2;
    this.group.add(west, east);
    this.solid({ x: -30.4, y: 3, z: 22, hx: 4, hy: 3, hz: 4.8 });
    this.solid({ x: 30.4, y: 3, z: 18, hx: 4.4, hy: 3, hz: 5.2 });
  }

  // ---------- light ----------

  private buildTorches(cells: DungeonCell[]): THREE.Vector3[] {
    const spots: THREE.Vector3[] = [];
    const add = (x: number, z: number) => spots.push(new THREE.Vector3(x, 2.6, z));
    for (const s of [-1, 1]) {
      add(s * 7.5, 38.6); // by the gate
      add(s * 33.5, 8);
      add(s * 33.5, -14);
    }
    for (const c of cells) if (c.index % 2 === 0) add(c.x + CELL_PITCH / 2, DOOR_Z + 0.8);
    const p = new PartBuilder();
    const woodDark = plastic(WOOD_DARK);
    for (const t of spots) {
      p.add(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 6), woodDark, t.x, 1.3, t.z);
      p.add(new THREE.CylinderGeometry(0.3, 0.16, 0.4, 8), plastic(IRON), t.x, 2.7, t.z);
    }
    p.buildInto(this.group, false, false);
    const flameGeo = new THREE.ConeGeometry(0.28, 0.8, 8);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb04a });
    for (const t of spots) {
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.set(t.x, 3.2, t.z);
      this.group.add(f);
      this.flames.push(f);
    }
    return spots;
  }

  // ---------- the jailers ----------

  /**
   * Beats along open lanes (walls, props and the cell block are all well clear of these), and a
   * few posts where a jailer stands and sweeps his gaze about.
   */
  private guardPosts(): GuardPost[] {
    const lane = (x0: number, z0: number, x1: number, z1: number) => ({ x: x0, z: z0, yaw: Math.atan2(-(x1 - x0), -(z1 - z0)), zone: 'yard' as const, patrol: [{ x: x0, z: z0 }, { x: x1, z: z1 }] });
    if (this.royal) {
      return [
        lane(-18, 32, -18, -14),
        lane(18, -14, 18, 32),
        lane(-21, -15.5, 21, -15.5),
        { x: -8, z: 10, yaw: 0, zone: 'yard', sight: 14 },
        { x: 9, z: -3, yaw: Math.PI, zone: 'yard', sight: 14 },
        { x: -10, z: 14, yaw: -Math.PI / 2, zone: 'yard', sight: 12 },
        { x: 7, z: 8, yaw: Math.PI / 2, zone: 'yard', sight: 12 },
        { x: 0, z: -13.2, yaw: Math.PI, zone: 'yard', sight: 12 },
      ];
    }
    return [
      lane(-21, 32, -21, -14), // down the west side
      lane(21, -14, 21, 32), // and the east
      lane(-24, -15.5, 24, -15.5), // along the cell doors
      { x: -9, z: 8, yaw: 0, zone: 'yard', sight: 14 },
      { x: 9, z: -4, yaw: Math.PI, zone: 'yard', sight: 14 },
      { x: 3, z: -6, yaw: Math.PI / 2, zone: 'yard', sight: 12 },
    ];
  }

  update(dt: number): void {
    this.time += dt;
    for (const c of this.layout.cells) {
      if (c.opening && c.open < 1) {
        c.open = Math.min(1, c.open + dt / OPEN_TIME);
        c.bars.position.y = c.open * (BARS_HEIGHT + 0.4);
      }
    }
    this.flames.forEach((f, i) => {
      const k = 1 + Math.sin(this.time * 11 + i * 1.7) * 0.18 + Math.sin(this.time * 23 + i) * 0.08;
      f.scale.set(k, 0.9 + (k - 1) * 2, k);
    });
  }
}
