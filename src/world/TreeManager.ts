import type * as THREE from 'three';
import type { Tree } from './Tree';

const CELL_SIZE = 32;

/** Only trunks near a vehicle need collision checks; only falling trees need animation. */
export class TreeManager {
  private readonly cells = new Map<number, Map<number, Tree[]>>();
  private readonly falling = new Set<Tree>();

  constructor(trees: readonly Tree[]) {
    for (const tree of trees) {
      const { x, z } = tree.position;
      const r = tree.triggerRadius;
      // Index every cell touched by the trigger, including across zero and cell boundaries.
      for (let cx = Math.floor((x - r) / CELL_SIZE); cx <= Math.floor((x + r) / CELL_SIZE); cx++) {
        let column = this.cells.get(cx);
        if (!column) this.cells.set(cx, column = new Map());
        for (let cz = Math.floor((z - r) / CELL_SIZE); cz <= Math.floor((z + r) / CELL_SIZE); cz++) {
          let cell = column.get(cz);
          if (!cell) column.set(cz, cell = []);
          cell.push(tree);
        }
      }
      // Shell hits can start a fall anywhere in the world, including away from all vehicles.
      tree.onFall = () => this.falling.add(tree);
    }
  }

  update(dt: number, tankPositions: readonly THREE.Vector3[]): void {
    for (const tank of tankPositions) {
      const cell = this.cells.get(Math.floor(tank.x / CELL_SIZE))?.get(Math.floor(tank.z / CELL_SIZE));
      if (cell) for (const tree of cell) tree.tryTopple(tank);
    }
    for (const tree of this.falling) {
      tree.update(dt);
      if (tree.fallen) this.falling.delete(tree);
    }
  }
}
