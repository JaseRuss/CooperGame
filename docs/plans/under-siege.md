# Plan: Bonus level "Under Siege" (mission 6)

Source: the gamedev meeting notes, then the owner's follow-up (no co-op; an on-foot prison break
at each enemy prison; two prisons per side; a wagon that ferries surrendered troops; a break
releases a wave that takes the nearest base and then stops). Starting point: mission 3 (Castle
Siege), plus the on-foot machinery from mission 5 (Prison Break). Nothing here is built yet.

## The level in one paragraph

The Germans (blue), helped by Wales (tan), want Europe. You are Scotland (green) with the
Americans (red) as allies. Single player. You take the tank into enemy castles: villages inside
the walls, archers in huge towers, cannons on wagon wheels. Beaten knights **surrender** instead
of always dying, and a **wagon** collects them and takes them to one of our two prisons. The enemy
locks up our soldiers in its two prisons, some from the start. At an enemy prison you get out of
the tank (Y) and do a **jailbreak on foot**, in disguise if you want. Break out the prisoners and
a wave of them storms the nearest enemy castle and takes it themselves, then stops.

Factions need no new art: friendly = green/red, enemy = tan/blue already. Only names change
(`ENEMY_ARMY_NAME` in `src/utils/plastic.ts`: tan = Wales, blue = Germans on this mission).

## What already exists (reuse, don't rebuild)

| Idea | Already in the repo |
| --- | --- |
| Castle theme, towers, keep, village cottages | `KNIGHTS` flag, `src/world/Medieval.ts`, `EnemyBase.buildCastle`, `Fortress` as Great Castle |
| Cannon on wagon wheels, driven around | `EnemyTank` under `KNIGHTS` + `buildCannonParts` (spoked wheels, two gunners) |
| Arrows | `ShotStyle 'arrow'`, crossbow knights, fire-arrow AA troopers |
| Surrender | `Wrecks.surrender()` (white flag, shout) for tank crews only, cosmetic |
| A cart | `buildHayCart` (Medieval.ts), `PartCargo` trailer |
| Squads marching on a base | `Warfront.ts` marches (green squads that "can't take it on their own") |
| On foot, stealth, vision cones | `src/prison/`: `PlayerSoldier`, `Guards` (cones, alarm, knock down, `carried`/`jailed`, melee shot), `VisionCones`, `NavGraph`, `Followers`, `ShoulderCam`, `Cells` |
| Stealth rating end screen | `PrisonGame` |
| Castle music | `Music.ts` jig |

## Architecture decision (the big one)

`Game` (tank) and `PrisonGame` (on foot) each create their own renderer, HUD, input, physics world
and animation loop, and `main.ts` picks one per page load. There is no on-foot player inside
`Game`. Because the owner wants an on-foot section at **each** prison, the player goes in and out
of it several times per mission, so this matters more than it did for a single finale.

Recommended: **reload with a snapshot.**
- Y at an enemy prison saves a compact mission snapshot to `sessionStorage` and loads
  `?mission=6&stage=foot&prison=N`. When the break ends (success or the player backs out), it
  loads `?mission=6` again and `Game` restores the snapshot.
- The world is generated from a fixed seed, so the snapshot only needs the changeable bits:
  which castles are down or captured, which prisons are open, prisoner and surrender counts,
  squad/wagon positions, time of day, and the tank's position and health.
- The cost is a page load each way and a restore path in `Game` (applying "this castle is
  already captured/ruined" at startup). That restore path is the risky part: it has to be built
  and tested before anything else on this mission.

Not recommended: one page with both modes. It needs `PrisonGame` rewritten into a section that
borrows `Game`'s renderer, HUD and input, which is a large refactor of two big files.

`JailbreakGame` is a new class modelled on `PrisonGame`, reusing the `src/prison/` modules, with
one parametrised prison layout (guard count, cell layout and search patrol vary per prison).

## Milestones

**M0 Plumbing.** `Mission = 1..6`, entry in `MISSIONS` (`bonus: true`, so the post-victory chain
skips it), `SEEDS`, `?mission=6`, level select, README. `SIEGE = MISSION === 6`;
`KNIGHTS = MISSION === 3 || MISSION === 6` so the ~47 castle checks apply unchanged. **Co-op is
off on mission 6:** player 2 is forced off, and the co-op options are hidden or greyed out there.

**M1 Snapshot and restore.** The save/restore described above, tested with a dummy round trip
(save, reload, castle still ruined, counters kept) before any gameplay is built on it.

**M2 Siege world.** Friendly bottom half, enemy top half. Enemy names and banner. Tall towers
(`buildTallTower`, roughly 2x `buildRoundTower`, PartBuilder only) with archers on top. A village
inside each castle: cottages, a well, a market stall from `buildCottage`/`buildHayCart`. Peasants
wander and never shoot. Each castle shows a **garrison counter** (knights left inside).

**M3 Surrender.** New `Soldier` state `surrendering`: a knight hit but not killed (and the crew
of a knocked-out cannon that doesn't blow up) drops his weapon prop, raises his hands, shows "WE
SURRENDER!", stops shooting and stays put. Applies to both sides. Counter on the HUD.

**M4 Prisons and the wagon.** Four prisons, built from one dungeon-tower model: **two friendly**
(in the bottom half) and **two enemy** (inside enemy castles; which two is a design call, see
questions).
- **Wagon** (replaces the tank-towed cart): an AI wagon, spoked wheels, canopy, green flag. One
  per friendly prison. It finds the nearest group of surrendered troops, drives over (along the
  road network where it can, straight otherwise, like `Warfront` marches), they climb in
  (capacity about 8), it takes them to the nearer friendly prison, they file in, the counter
  ticks up, and it goes looking again. The enemy ignores it and it can't be destroyed (no game
  over in this game). It wobbles if shot.
- **Enemy prisons** start with green soldiers locked in, and enemy squads that down our soldiers
  sometimes march them there (hook into `Warfront`/`TroopManager`).
- Friendly prisons are never raided.

**M5 Jailbreak on foot** (`JailbreakGame`, one section per enemy prison). Y near an enemy prison's
gate shows "Y: get out" and starts the handoff; everywhere else Y still toggles the camera.
Night, jailers in hats (not soldiers) using `Guards.ts`.
- **Disguise (X):** put on a jailer's tabard and hat. Guards stop reacting from afar; they only
  suspect you if you stand within `NEAR_SENSE` for a few seconds, run, or fire. Firing drops the
  disguise.
- **Caught while disguised = restart the section** (the meeting's balance rule). Undisguised
  keeps the normal knocked-down-and-checkpoint behaviour.
- **Takedown:** sneak up behind and press fire for a melee knock-out (the `melee` shot exists),
  then carry the guard into a cell (`carried`/`jailed` exist).
- Free the cells (shoot or unlock), prisoners pour out, walk out of the gate. Button clash: on
  foot X is currently "squad hold"; with no squad in these sections, X is free for disguise.

**M6 The released wave.** When a break succeeds, the freed soldiers appear as a marching wave
(a new `Warfront` march kind, `canCapture`) and head for the **nearest enemy castle**, fight the
garrison and, once its garrison counter is zero, flip it to green and **take it over themselves**.
Then they **stop**: they garrison the castle and it does not start the repeating raids that other
captured bases send out (`capturedTimers` is skipped for it). The wave can fail if it's too
small, in which case it falls back and you can help it.

**M7 Win condition, ending and polish.** Banner "Tonight there's going to be a jailbreak".
End screen reuses the stealth rating plus prisoners captured and rescued. Castle jig for both
stages. Low-graphics pass (archers and crowds are the cost).

Cut from the earlier version: the co-op truck intro and all co-op support in `JailbreakGame`.

## Checks before each merge (from AGENTS.md)

- `git fetch origin main` and rebase first; `npm run build` must pass (`noUnusedLocals`).
- New models with `PartBuilder`/`loftGeometry`, cached geometry, shared materials. No new GLBs.
- Never assign a material array to a mesh whose geometry has no groups.
- Look at screenshots in the running game and count meshes/triangles; type checks don't prove
  anything is visible.
- Asset deletions and loader changes in the same commit.

## Open questions for the owner

1. Which two enemy castles get the prisons: the two nearest the front, or one regular castle and
   one inside the Great Castle?
2. Does taking a castle with the released wave count as one of the five required castles?
   (Plan assumes yes, so a break is a valid route.)
3. What ends the mission: five castles taken plus the Great Castle, as in mission 3 (plan's
   assumption), or both prison breaks done?
4. "Release a wave at the nearest base": plan reads it as the wave heading for the nearest
   **enemy** castle to that prison. If you meant the nearest friendly base, say so.
5. Mission 6 as a second bonus after Prison Break, as assumed?
6. Jungle: the world is one theme per page load, so the staging area gets a forest band, not
   mission 2's full jungle.
