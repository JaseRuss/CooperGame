import RAPIER from '@dimforge/rapier3d-compat';

let initialized = false;

export async function initPhysics(): Promise<void> {
  if (!initialized) {
    await RAPIER.init();
    initialized = true;
  }
}

export function createWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
  return world;
}

export { RAPIER };
