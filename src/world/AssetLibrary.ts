import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BUILDING_LETTERS = 'abcdefghijklmnopqrstu'.split('');
const BUILDING_NAMES = BUILDING_LETTERS.map((l) => `building-type-${l}`);
const TREE_NAMES = ['tree-large', 'tree-small'];
const MODEL_BASE = '/models/buildings/';

function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

/** Loads and caches the Kenney "City Kit (Suburban)" GLB models used to populate the world. */
export class AssetLibrary {
  private readonly buildings = new Map<string, THREE.Object3D>();
  private readonly trees = new Map<string, THREE.Object3D>();

  async load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    const names = [...BUILDING_NAMES, ...TREE_NAMES];
    let loaded = 0;

    const loadOne = (name: string) =>
      new Promise<THREE.Object3D>((resolve, reject) => {
        loader.load(
          `${MODEL_BASE}${name}.glb`,
          (gltf) => {
            enableShadows(gltf.scene);
            loaded += 1;
            onProgress?.(loaded, names.length);
            resolve(gltf.scene);
          },
          undefined,
          reject,
        );
      });

    const results = await Promise.all(names.map(loadOne));
    results.forEach((obj, i) => {
      const name = names[i];
      if (BUILDING_NAMES.includes(name)) this.buildings.set(name, obj);
      else this.trees.set(name, obj);
    });
  }

  get buildingNames(): string[] {
    return [...this.buildings.keys()];
  }

  cloneBuilding(name: string): THREE.Object3D {
    const src = this.buildings.get(name);
    if (!src) throw new Error(`Unknown building asset: ${name}`);
    return src.clone(true);
  }

  cloneTree(name: string): THREE.Object3D {
    const src = this.trees.get(name);
    if (!src) throw new Error(`Unknown tree asset: ${name}`);
    return src.clone(true);
  }

  get treeNames(): string[] {
    return [...this.trees.keys()];
  }
}
