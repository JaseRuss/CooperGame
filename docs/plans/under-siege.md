# Plan: Bonus level "Under Siege" (mission 6)

Source: the gamedev meeting notes. Starting point: mission 3 (Castle Siege), plus the on-foot
machinery from mission 5 (Prison Break). Nothing here is built yet.

## The level in one paragraph

The Germans (blue), helped by Wales (tan), want Europe. You are Scotland (green) with the
Americans (red) as allies. You drive a truck convoy to the friendly bottom half of the map, then
take the tank into enemy castles: villages inside the walls, archers in huge towers, cannons on
wagon wheels. Beaten knights **surrender** instead of always dying. You carry them to a prison;
the enemy also takes your soldiers prisoner, and some of yours are locked up from the start.
When the last castle falls, the tank can't go further: get out at the Great Castle and do the
**jailbreak on foot**, in disguise if you want, to free the army.

Factions need no new art: friendly = green/red, enemy = tan/blue already. Only names change
(`ENEMY_ARMY_NAME` in `src/utils/plastic.ts`: tan = Wales, blue = Germans on this mission).

## What already exists (reuse, don't rebuild)

| Meeting idea | Already in the repo |
| --- | --- |
| Castle theme, towers, keep, village cottages | `KNIGHTS` flag, `src/world/Medieval.ts`, `EnemyBase.buildCastle`, `Fortress` as Great Castle |
| Cannon on wagon wheels, driven around | `EnemyTank` under `KNIGHTS` + `buildCannonParts` (spoked wheels, two gunners) in `KnightModels.ts` |
| Arrows | `ShotStyle 'arrow'`, crossbow knights, fire-arrow AA troopers |
| Surrender | `Wrecks.surrender()` (white flag, "WE SURRENDER!") but for tank crews only and purely cosmetic |
| Carrying things behind the tank | `PartCargo` trailer (bomb parts) |
| On foot, stealth, vision cones, disguise-adjacent AI | `src/prison/`: `PlayerSoldier`, `Guards` (cones, alarm, knock down, `carried`/`jailed` states, melee shot), `VisionCones`, `NavGraph`, `Followers`, `ShoulderCam`, `Cells` |
| Stealth rating end screen | `PrisonGame` |
| Castle music | `Music.ts` jig |

## Architecture decision (the big one)

`main.ts` boots **either** `Game` (tank, 3.6k lines) **or** `PrisonGame` (on foot) per page
load, picked by `?mission=`. There is no on-foot player inside `Game`, and the two have separate
physics worlds. So:

- Stage 1 = `Game` with `?mission=6` (castle world + siege rules).
- Stage 2 = new `JailbreakGame` (copy the shape of `PrisonGame`, reuse the `src/prison/` modules).
  Entered by reload with `?mission=6&stage=foot`; stage 1 passes a small blob via
  `sessionStorage` (prisoners taken, soldiers rescued, buddies alive, time).

Not recommended: embedding a walking player in `Game`. It touches camera, HUD, input, physics and
co-op all at once for one scene.

## Milestones

**M0 Plumbing.** `Mission = 1..6`, entry in `MISSIONS` (`bonus: true`, so the post-victory chain
skips it), `SEEDS`, `?mission=6`, level select, README. Add `SIEGE = MISSION === 6` and make
`KNIGHTS = MISSION === 3 || MISSION === 6` so the ~47 castle checks apply unchanged.

**M1 Siege world.** Map rule: friendly bottom half, enemy top half, with a "turn back, that's
enemy territory" barrier at the line while you stage. Enemy names/banner. Tall towers
(`buildTallTower`, roughly 2x `buildRoundTower`, PartBuilder only) with archers on top. A village
inside each castle: cottages, a well and a market stall from `buildCottage`/`buildHayCart`.
Peasants wander and never shoot (optional: occasional skirmish between garrison and villagers,
cheap to cut).

**M2 Surrender.** New `Soldier` state `surrendering`: when a knight is hit but not killed (and
for crews of knocked-out cannons/tanks that don't explode) he drops his weapon prop, raises hands,
shows "WE SURRENDER!", stops shooting and stays put. Applies to enemy and our soldiers. Counter
in the HUD. Reuse the shout list from `Wrecks.ts`.

**M3 Prisons.** A prison (dungeon tower from `Medieval.ts`) in every castle and beside friendly
bases.
- Pick up: drive within ~6 m of surrendered knights and they climb onto a prisoner cart towed
  behind the tank (`PartCargo` pattern).
- Lock up: drive the cart to a friendly prison, they file in, counter ticks up.
- Enemy side: our soldiers who are downed near an enemy squad sometimes get marched to the
  nearest enemy prison (hook into `Warfront`/`TroopManager`).
- Rescue: shell the prison wall or gate (castle walls already break); prisoners run out and
  join. Some prisons start occupied. Rescue is a side objective, destroying the castles is the
  required one.
- Siege win condition (from the meeting): each castle also shows a **garrison counter**. Down or
  capture every knight inside and a white flag goes up, which counts as taking it, as well as the
  existing "destroy the buildings" route.

**M4 Dismount.** Y is the camera toggle today. Proposal: Y near the Great Castle's prison gate
shows "Y: get out" and starts the handoff; everywhere else Y still toggles the camera. Finale
only; no mid-mission dismount (that would need the handoff mid-level and state restore).

**M5 Jailbreak on foot.** New `JailbreakGame`: Great Castle dungeon and courtyard, built with
`PartBuilder`, at night. Guards are plain jailers in hats (not soldiers), using `Guards.ts`.
- **Disguise (X):** put on a guard's tabard and hat. Guards stop reacting from afar; they only
  suspect you if you stand within `NEAR_SENSE` for a few seconds, run, or fire. Firing drops the
  disguise.
- **Caught while disguised = restart the section** (the meeting's balance rule), unlike
  undisguised, which keeps the normal checkpoint behaviour.
- **Takedown:** sneak up behind in disguise or not, press fire for a melee knock-out (the
  `melee` shot already exists), then carry the guard into a cell (`carried`/`jailed` exist).
- **Friendly prison rule:** guards of a prison we've captured don't react to you at all.
- Free the cells; prisoners follow (`Followers`); walk out of the gate.
- Button clash: on foot X is currently "squad hold". Move hold to LB / Q.

**M6 Ending and polish.** Banner "Tonight there's going to be a jailbreak", end screen reusing the
stealth rating plus prisoners captured/rescued. Castle jig music for both stages. Low-graphics
pass (archers and crowds are the cost).

**M7 Co-op intro (stretch).** Short scripted truck convoy to the staging area where both players
have a job (one drives, one mans the gun or fixes a tyre) with callouts. Local co-op exists in
`Game`; `JailbreakGame` would need it too (Prison Break has it), which is extra work.

## Checks before each merge (from AGENTS.md)

- `git fetch origin main` and rebase first; `npm run build` must pass (`noUnusedLocals`).
- New models with `PartBuilder`/`loftGeometry`, cached geometry, shared materials. No new GLBs.
- Never assign a material array to a mesh whose geometry has no groups.
- Look at screenshots in the running game and count meshes/triangles; type checks don't prove
  anything is visible.
- Asset deletions and loader changes in the same commit.

## Open questions for the owner

1. Mission 6 as a second bonus (after Prison Break), or replace the end of mission 3? Plan assumes new.
2. On-foot section only at the end, or also mid-mission dismounts at prisons? Plan assumes end only.
3. Intro co-op segment: in scope now or later? Plan puts it last.
4. Disguise on X, squad hold moved to LB / Q: OK?
5. Jungle: the meeting mentions bottom/top jungle. The world is one theme per page load, so
   the plan uses a forest band at the staging area, not mission 2's full jungle.
