# Plan: Bonus level "Prison Break"

Status: proposal, nothing built yet.

## The level in one paragraph

The tan army has captured your tank and locked you, your four buddies (Keston, Max, Innes and
Jason, or whatever they've been renamed to) and a load of green soldiers in a prison compound.
You play on foot, as a green army man, in third person. Break out of your cell, free the other
prisoners block by block, and they follow you through the compound and help you take it over.
The last stop is the motor pool, where your tank is parked under guard. Climb back in, the
buddies jump onto the sides, smash through the main gate and drive home to Cooper's Base.

## How it plays, beat by beat

1. **Opening.** Short cutscene: night, searchlights sweeping the yard, the camera drops into
   your cell. Banner: `BONUS: PRISON BREAK` / "They've got your tank! Break out, free your
   buddies and take it back."
2. **Your cell (tutorial).** A guard walks past and drops his rifle near the bars (or a buddy
   in the next cell slides you one). Shoot the padlock to get out. This teaches move, aim, fire.
3. **Cell Block A.** Corridor of cells. Shoot each padlock to free who's inside. The first
   buddy is here. Freed soldiers fall in behind you.
4. **Cell Block B and the control room.** A bigger block. Shooting the control room's lever
   box opens every door in the block at once (a nice "whoosh" moment). Second and third buddy.
5. **The yard.** Open ground with watchtowers and searchlights. Get caught in a light and the
   alarm goes, sending a squad out of the barracks. Knock out the towers (two hits, they topple
   like the water towers) to quiet the yard. Followers fight alongside you.
6. **Barracks.** Clear the guards, then shoot down the tan flag on the roof: it flips to a green
   one. Fourth buddy is in the punishment hut behind it.
7. **Motor pool.** Unlocks once every zone is green. Your tank is parked inside behind a
   roller door, guarded by an enemy tank and a pillbox. Followers and buddies help.
8. **Recapture.** Walk up to your tank. Puff of smoke (like a jeep station), and you're in the
   normal player tank, with all its weapons. The four buddies hop up and ride on the sides of
   the hull, two each side. The freed green soldiers stay behind holding the compound and wave.
9. **The drive home.** Blast the main gate and follow the road (gold waypoint arrow) to
   Cooper's Base, a few hundred metres away, with tan jeeps chasing. Nothing can stop you, as
   with the bomb tanker.
10. **Ending.** Roll through the base gate, the buddies jump down and cheer, banner
    `MISSION ACCOMPLISHED!`, the end screen shows prisoners freed and guards knocked over.

No game over, matching missions 1 to 3: if you're knocked down on foot you get back up at the
last checkpoint (the last zone you took) after a few seconds. Buddies get knocked over and get
back up; they're never lost, since the ending needs all four.

## Controls on foot

Same buttons as the tank, so nothing new to learn:

| Action | Controller | Keyboard / mouse |
| --- | --- | --- |
| Move (relative to the camera) | Left stick | W A S D |
| Aim | Right stick | Mouse |
| Fire rifle | RT or A | Left click / Space |
| Jam grenade: lob one, it splats and sticks guards | LT | E |
| "Follow me" / "Hold here" for your squad | X | X |
| Switch first / third person | Y | C |
| Back to last checkpoint | Back | R |

Doors open when you walk into them; padlocks, lever boxes and flags are opened by shooting them,
so there's no separate "use" button to explain.

## How it fits the code

### Keep it out of `Game.ts`

`src/core/Game.ts` is 3,000 lines and nearly all of it assumes the player is a `PlayerTank`
driving round the 3 km world (stations, rockets, AA, buddies-as-vehicles, family bases, the
warfront). Bolting an on-foot mode into that would touch almost every method. Instead:

- New folder `src/prison/` with a `PrisonGame` class that owns its own scene, loop and state.
- `src/main.ts` picks `new PrisonGame(app)` when `MISSION === 5`, otherwise `new Game(app)`.
- `PrisonGame` reuses the existing building blocks directly rather than `Game`:
  `PhysicsWorld` (Rapier), `HitRegistry`, `ProjectileManager`, `ImpactEffects`, `JamCannon`,
  `RepairCrates` (medkits), `Sound`, `Music`, `InputManager`, `HUD`, `PartBuilder`, the
  `Soldier` figures, `EnemyTank`, `EnemyJeep`, `Bunker` and, for the finale, `PlayerTank`.

If some helpers in `Game.ts` turn out to be needed (bullet firing, explosions, crate drops),
move them into small shared modules rather than copying them.

### New pieces

| File | What it is |
| --- | --- |
| `src/prison/PrisonGame.ts` | Loop, state machine for the beats above, HUD state, ending. |
| `src/prison/PlayerSoldier.ts` | The on-foot player: Rapier `KinematicCharacterController` capsule (about 0.35 m radius, 1.85 m tall), Warthog-style movement relative to the camera, hops instead of walking like every other army man (`Soldier.ts` does the same), rifle hit-scan, jam grenade, knocked-down and get-up. Uses the existing rifleman figure in green. |
| `src/prison/ShoulderCam.ts` | Over-the-shoulder camera: about 3.5 m back, 1 m right, 1.9 m up, with a ray cast back from the head so walls and ceilings don't block the view indoors (the tank chase cam has no collision because it never needs it). First person puts the eye at the head. |
| `src/prison/Facility.ts` | The compound, built with `PartBuilder`: perimeter wall, cell blocks, control room, yard, watchtowers, barracks, punishment hut, motor pool, main gate. A fixed hand-made layout (not seeded), since the beats depend on where things are. Walls and roofs get Rapier cuboid colliders. |
| `src/prison/Cells.ts` | Cell doors with shootable padlocks, lever boxes that open a whole block, who's in each cell. |
| `src/prison/Followers.ts` | Freed soldiers and buddies: follow in a loose column behind the player, fight guards in range, hold position on X. Buddies get name tags (reuse the buddy name-tag code). |
| `src/prison/NavGraph.ts` | Hand-placed waypoints at doorways and corridor ends with A* between them, so followers and guards get through doors instead of grinding into walls. The free-roaming wander in `Soldier` only works outdoors. |
| `src/prison/Guards.ts` | Tan and blue guards: patrol routes on the nav graph, the existing `Soldier` shooting, an alarm that sends a barracks squad. |
| `src/prison/Searchlights.ts` | Watchtower lights sweeping the yard; standing in a beam trips the alarm. Towers are shootable. |
| `src/prison/Zones.ts` | Each zone's "taken" check (guards cleared, flag down), the HUD checklist, and checkpoints. |
| `src/prison/Breakout.ts` | The finale: tank recapture, riders on the hull, the road home, chasing jeeps, the ending cutscene. |
| `src/prison/HullRiders.ts` | The four buddies clinging to the hull sides, attached to `player.root` (like the bomb tanker's gunners in `TankerCrew.ts`). A new seated or clinging pose built with `PartBuilder`. |

### Changes to existing files

- `src/core/config.ts`: `Mission` gains `5`, `MISSIONS` gets `{ mission: 5, title: 'Prison Break', … }`,
  `SEEDS` gets a 5, add `export const PRISON = MISSION === 5`.
- `src/audio/Music.ts`: a fifth song in `SONGS` (a sneaky tune for inside that swaps to a march
  for the breakout, the way mission 1 swaps to its night song).
- `src/core/Game.ts`: the `Record<Mission, string>` victory message needs a 5 to compile, and
  mission 4's win shouldn't roll on into the bonus level automatically (`nextMission`).
- `src/ui/HUD.ts`: label the level select row "Bonus". `HUDState` is shaped around the tank
  (rocket, AA, jam, buddy meter, hull); either make those fields optional or give the prison a
  smaller state. Decide this when building milestone 1.
- `src/entities/Soldier.ts`: probably a `follow(target)` mode and patrol routes, unless those
  live entirely in `Followers.ts` / `Guards.ts` driving the mesh themselves.
- `README.md`: a "Bonus: Prison Break" section and the on-foot controls.

## Sizes (checklist from AGENTS.md)

Everything is procedural, so no new GLBs or credits. Sizes to build to, all in metres:

- Army man: about 1.85 tall. Player capsule the same.
- Tank hull: 2.3 x 1 x 3.8 (`HULL_HALF_EXTENTS`). Motor pool doors at least 6 wide.
- Corridors at least 3 wide, doors at least 2.4 wide, so a column of followers gets through.
- Ceilings about 3.5, so the shoulder cam fits indoors.
- Whole compound about 200 x 200, on flat ground, with the road home about 400 to 600 long.

Check it in the running game with screenshots, not just `npm run build`.

## Milestones

`main` deploys on every push, so the level stays out of the level select until milestone 6.
Before then it's only reachable with `?mission=5`.

1. **On foot in a box.** Mission 5 plumbing, `PrisonGame` skeleton, `PlayerSoldier`,
   `ShoulderCam`, one walled room. Walk, hop, aim, shoot, no clipping through walls.
2. **Cell Block A.** Facility pieces, padlocks, freeing prisoners, followers in a column through
   doors (nav graph).
3. **Guards and fighting.** Guards with patrols, rifle and jam grenade, followers fighting,
   knocked down and checkpoint, zone checklist on the HUD.
4. **The rest of the compound.** Cell Block B and control room, yard, towers, searchlights and
   alarm, barracks and flag, all four buddies.
5. **Breakout.** Motor pool fight, swapping into `PlayerTank`, hull riders, the road home,
   chasing jeeps, ending cutscene and end screen.
6. **Polish and release.** Music, sounds, intro cutscene, Low graphics check, README, add to
   the level select.

## Risks

- **`PlayerTank` outside `Game`.** It's built for `Game`'s world. Expect some coupling to
  untangle when it's reused for the finale (milestone 5).
- **Indoor lighting and shadows.** The shadow camera is sized for open country. Indoors needs
  a tighter shadow box that follows the player, and should be checked on Low graphics.
- **Followers in doorways.** The most likely thing to look broken. The nav graph plus a bit of
  spacing between followers should handle it; budget time for it.
- **Size of the job.** This is a new game mode, comparable to the bomb tanker and zombie
  mission put together. Each milestone is a PR on its own.

## Decisions for the owner

1. **Unlocking.** Always in the level select as "Bonus", or only after beating mission 4?
2. **Stealth.** Light (searchlights and an alarm that brings reinforcements, as above), or
   none at all (straight shooting)?
3. **Enemies.** Tan and blue guards, as above, or one army only?
4. **The other freed soldiers at the end.** Stay behind holding the compound (as above), or
   follow in trucks?
5. **Home.** Back to Cooper's Base (as above) or a fresh "base" at the end of the road?
