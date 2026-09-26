# Notes for AI coding agents

Read this before changing models, materials or anything that deploys. It records a bug that
shipped once so it doesn't ship again.

## Working in this repo

- `main` auto-deploys to GitHub Pages (`.github/workflows/deploy-pages.yml`), so every push is a
  release. Run `npm run build` (it type-checks with `tsc`, including `noUnusedLocals`) before
  pushing.
- Stage code changes and asset additions/deletions in the **same commit**. A commit that deletes a
  model file while the loader still requests it leaves the game stuck on "Loading world".
- Nearly every model in the game is procedural: built from primitives with `PartBuilder`
  (`src/utils/modelKit.ts`), which merges parts into one geometry per material. Prefer that over
  importing new GLB files. The GLBs in `public/models/` are only for the town scenery, cars and
  the jungle mission's trees, plants and huts (`src/world/AssetLibrary.ts`). If you add one, also
  credit it in `CREDITS` in `src/ui/HUD.ts` (shown on the pause screen) and in the README.
- Sound effects are Kenney CC0 samples in `public/sounds/`, played through `src/audio/Sound.ts`
  (credit new ones the same way). The music is synthesised live in `src/audio/Music.ts`; there are
  no music files. Browsers block audio until a click or key press (not a gamepad button), which
  the HUD tells the player.
- The Nature Kit and Quaternius GLBs leave metalness unset, which glTF treats as fully metallic
  and renders nearly black; `AssetLibrary` sets their materials to matte on load.
- Friendly armies are green (player) and red; enemies are tan and blue.

## Case study: the invisible enemy helicopter

**Symptom:** in game the enemy helicopter showed up as "a small tube and nothing else".

**What the code did:** PR #3 added a downloaded GLB helicopter
(`public/models/helicopter/light-utility-helicopter.glb`) and tinted each clone to its army's
colour like this:

```ts
model.traverse((child) => {
  if (!(child instanceof THREE.Mesh)) return;
  const materials = Array.isArray(child.material) ? child.material : [child.material];
  child.material = materials.map((mat) => {       // always assigns an ARRAY
    const material = mat.clone();
    material.color.set(color);
    return material;
  });
});
```

### Bug 1: an array of materials on a geometry without groups renders nothing

In three.js, when `mesh.material` is an **array**, the renderer draws only the index ranges listed
in `mesh.geometry.groups`, one draw call per group using `material[group.materialIndex]`. The
GLTFLoader gives each primitive its own mesh with a single material and a geometry with **no
groups**. `[material]` looks harmless, but with `groups.length === 0` there is nothing to draw, so
every mesh of the helicopter silently disappeared. There is no error or warning.

The "small tube" was the chin gun, a separately built `THREE.Mesh` with a single (non-array)
material, which was the only visible part left.

**Correct pattern:** keep the material's original shape. Only map into an array if it already was
one:

```ts
child.material = Array.isArray(child.material)
  ? child.material.map(tint)
  : tint(child.material);
```

### Bug 2: wrong unit scale

The same PR scaled the model with `MODEL_SCALE = 0.58 * 100`, as if the GLB were in centimetres.
It is authored in metres (about 9 x 3.5 x 11 m), so each aircraft was about 650 m across, with a
hit box to match: shells 15 m wide of the airframe still counted as hits, and the cruise height
was pushed up to about 103 m. The fix was a 1.2x scale, but because of bug 1 it still rendered
nothing.

### How it was resolved

The GLB and its loader code were removed. `src/entities/HelicopterEnemy.ts` now builds a toy
gunship procedurally with `PartBuilder` and `loftGeometry`, caches the geometry per army colour and
shares the materials, like the tanks, bunkers and Chinook do.

### Checklist for imported or recoloured models

1. Never replace a single `mesh.material` with an array unless the geometry has matching
   `groups`.
2. Measure the model after loading (`new THREE.Box3().setFromObject(model).getSize(...)`) and
   compare it with a tank hull (2.3 x 1 x 3.8 m, `HULL_HALF_EXTENTS` in `Tank.ts`) before choosing a scale. glTF is in metres.
3. Derive hit boxes from a known, sane size, not from whatever the model reports.
4. Check it in the running game. Count drawn meshes and triangles in the console, and look at a
   screenshot. Passing type checks and AI behaviour tests does not mean it is visible.
5. Remember that cloned materials must be disposed of. Shared or cached ones must not.
