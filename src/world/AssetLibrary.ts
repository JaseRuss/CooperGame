import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Kenney CC0 kits in public/models/<dir>; each kit keeps its own Textures/colormap.png. */
export type AssetGroup = 'house' | 'tree' | 'commercial' | 'industrial' | 'prop' | 'car';

const letters = (s: string) => s.split('');

const MANIFEST: Record<AssetGroup, { dir: string; names: string[] }> = {
  house: { dir: 'buildings', names: letters('abcdefghijklmnopqrstu').map((l) => `building-type-${l}`) },
  tree: { dir: 'buildings', names: ['tree-large', 'tree-small'] },
  commercial: {
    dir: 'commercial',
    names: [
      ...letters('abcdefghijklmn').map((l) => `building-${l}`),
      'building-skyscraper-a',
      'building-skyscraper-b',
      'building-skyscraper-c',
      'detail-awning',
      'detail-awning-wide',
      'detail-parasol-a',
      'detail-parasol-b',
    ],
  },
  industrial: {
    dir: 'industrial',
    names: [
      ...letters('abcdefghijklmnopqrst').map((l) => `building-${l}`),
      'chimney-large',
      'chimney-medium',
      'detail-tank-large',
      'detail-tank',
      'shipping-container-a',
      'shipping-container-b',
      'shipping-container-c',
      'water-tower',
      'windmill',
    ],
  },
  prop: {
    dir: 'roads',
    names: [
      'light-square',
      'light-square-double',
      'light-curved',
      'traffic-light',
      'road-sign-stop',
      'road-sign-warning',
      'construction-barrier',
      'construction-cone',
      'construction-fence',
      'construction-light',
      'dumpster',
      'electricity-pole',
      'sign-highway',
    ],
  },
  car: {
    dir: 'cars',
    names: [
      'sedan',
      'sedan-sports',
      'hatchback-sports',
      'suv',
      'suv-luxury',
      'taxi',
      'police',
      'ambulance',
      'van',
      'delivery',
      'truck',
      'firetruck',
      'garbage-truck',
    ],
  },
};

function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

/** Loads and caches every Kenney GLB model used to populate the world. */
export class AssetLibrary {
  private readonly models = new Map<string, THREE.Object3D>();
  private helicopterAnimations: THREE.AnimationClip[] = [];

  async load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    const jobs = (Object.keys(MANIFEST) as AssetGroup[]).flatMap((group) =>
      MANIFEST[group].names.map((name) => ({ group, name, url: `${import.meta.env.BASE_URL}models/${MANIFEST[group].dir}/${name}.glb` })),
    );
    let loaded = 0;
    const total = jobs.length + 1;

    const requests = jobs.map((job) => new Promise<void>((resolve, reject) => {
      loader.load(job.url, (gltf) => {
        enableShadows(gltf.scene);
        this.models.set(`${job.group}/${job.name}`, gltf.scene);
        loaded += 1;
        onProgress?.(loaded, total);
        resolve();
      }, undefined, reject);
    }));
    requests.push(new Promise<void>((resolve, reject) => {
      loader.load(`${import.meta.env.BASE_URL}models/helicopter/light-utility-helicopter.glb`, (gltf) => {
        enableShadows(gltf.scene);
        this.models.set('helicopter/light-utility-helicopter', gltf.scene);
        this.helicopterAnimations = gltf.animations;
        loaded += 1;
        onProgress?.(loaded, total);
        resolve();
      }, undefined, reject);
    }));
    await Promise.all(requests);
  }

  names(group: AssetGroup): string[] {
    return MANIFEST[group].names;
  }

  /** The shared source model (don't add it to the scene; use clone or instancing). */
  template(group: AssetGroup, name: string): THREE.Object3D {
    const src = this.models.get(`${group}/${name}`);
    if (!src) throw new Error(`Unknown asset: ${group}/${name}`);
    return src;
  }

  clone(group: AssetGroup, name: string): THREE.Object3D {
    return this.template(group, name).clone(true);
  }

  helicopter(): THREE.Object3D {
    const model = this.models.get('helicopter/light-utility-helicopter');
    if (!model) throw new Error('Helicopter model has not loaded');
    return model.clone(true);
  }

  get helicopterClips(): THREE.AnimationClip[] {
    return this.helicopterAnimations;
  }

  random(group: AssetGroup, rng: () => number, filter?: (name: string) => boolean): string {
    const pool = filter ? this.names(group).filter(filter) : this.names(group);
    return pool[Math.floor(rng() * pool.length)];
  }
}
