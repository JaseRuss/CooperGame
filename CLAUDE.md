@AGENTS.md

## Two-player support is required in every level

- Every playable level and stage must support two local players. This includes newly added levels,
  bonus levels, on-foot stages, and vehicles/epilogues; do not ship a level that silently forces
  solo play.
- Use the existing local co-op settings (`player1Controller`, `player2Controller`, and
  `splitOrientation`) and the split-screen HUD/camera patterns in `src/core/Game.ts` and
  `src/prison/PrisonGame.ts`. Keep both players independently controllable with separate cameras
  and HUD viewports.
- Audit the whole gameplay loop for player-two participation: movement and camera, damage and
  revive/respawn, combat and interactions, pickups and shared objectives, transitions/cutscenes,
  map/objective indicators, pause/menu input, and cleanup. A second avatar or a second input read
  alone does not count as co-op support.
- When a mechanic is intentionally shared (for example, a vehicle or one mounted weapon), define
  how either player can use it and ensure the other player can still participate. Do not hard-code
  a single player as the sole owner of level progress or completion.
- Before adding or changing a level, trace its player setup, input routing, simulation, HUD, camera,
  and completion paths for both players. Check that two-player support remains enabled when entering
  that level or a stage reached from it.
