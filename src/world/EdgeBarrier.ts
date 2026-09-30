import * as THREE from 'three';
import { EDGE_WALL } from '../core/config';
import { PartBuilder } from '../utils/modelKit';
import { plastic } from '../utils/plastic';
import { surfaceHeightAt, waterDepthAt } from './Terrain';

/** Each block of the barrier: yellow and black in turn, like a toy road-works barricade. */
const BLOCK_LENGTH = 6;
const BLOCK_HEIGHT = 2.6;
const BLOCK_WIDTH = 1.6;
/** Sunk this far into the ground so slopes don't leave a gap under it. */
const BLOCK_SINK = 1.5;
/** A tall post with a red lamp every so often, so the edge shows from the chopper too. */
const POST_EVERY = 10;
const POST_HEIGHT = 14;

const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b2f });

/**
 * The barrier round the edge of the map. Only a marker: vehicles are held inside by EDGE_LIMIT
 * (in `Tank.drive` and the chopper's flight), which stops them just short of it.
 */
export function buildEdgeBarrier(): THREE.Group {
  const yellow = plastic(0xe8b824);
  const black = plastic(0x1f201d);
  const grey = plastic(0x8a8d86);
  const block = new THREE.BoxGeometry(1, 1, 1);
  const post = new THREE.CylinderGeometry(0.35, 0.45, 1, 8);
  const lamp = new THREE.SphereGeometry(0.9, 12, 8);
  const p = new PartBuilder();
  const lamps = new PartBuilder();
  const count = Math.ceil((EDGE_WALL * 2) / BLOCK_LENGTH);
  const length = (EDGE_WALL * 2) / count;
  // Four sides: along X at z = ±EDGE_WALL, and along Z at x = ±EDGE_WALL.
  for (const [alongX, side] of [[true, -1], [true, 1], [false, -1], [false, 1]] as const) {
    for (let i = 0; i < count; i++) {
      const t = -EDGE_WALL + (i + 0.5) * length;
      const x = alongX ? t : side * EDGE_WALL;
      const z = alongX ? side * EDGE_WALL : t;
      const ground = surfaceHeightAt(x, z);
      // Over a lake it stands on the bottom and still shows above the water.
      const top = ground + Math.max(0, waterDepthAt(x, z)) + BLOCK_HEIGHT;
      const bottom = ground - BLOCK_SINK;
      const [sx, sz] = alongX ? [length + 0.02, BLOCK_WIDTH] : [BLOCK_WIDTH, length + 0.02];
      p.add(block, i % 2 === 0 ? yellow : black, x, (top + bottom) / 2, z, 0, 0, 0, sx, top - bottom, sz);
      if (i % POST_EVERY === 0) {
        p.add(post, grey, x, top + POST_HEIGHT / 2, z, 0, 0, 0, 1, POST_HEIGHT, 1);
        lamps.add(lamp, lampMaterial, x, top + POST_HEIGHT + 0.6, z);
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'edge-barrier';
  p.buildInto(group, false, true);
  lamps.buildInto(group, false, false);
  return group;
}
