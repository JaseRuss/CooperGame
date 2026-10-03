# Plan: Bonus level "Prison Break"

> **Redesigned (milestone 8).** The level is now a night-time stealth escape by raft, not a
> fight for the prison and a tank drive. The beat-by-beat below and milestones 1 to 7 describe
> the original design and are kept as history; see **Milestone 8** at the end for what the level
> is now, and what was removed (the zones, the tank, trucks and jeeps, Cell Block B's lever,
> the medics and most of the prisoners).

Status: milestones 1 to 4 built (on foot; Cell Block A and the squad; guards, the jam riot cannon, capturing guards and medics; the whole compound). The Alcatraz-style opening (4b), the breakout (5) and the polish (6) are built: the level is finished. Decisions from the owner are below.

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
5. **The yard.** Open ground with guard towers, each with a tan guard shooting down from the
   top. Knock out the towers (two hits, they topple like the water towers). Followers fight
   alongside you. No stealth: it's a straight fight all the way.
6. **Barracks.** Clear the guards, then shoot down the tan flag on the roof: it flips to a green
   one. Fourth buddy is in the punishment hut behind it.
7. **Motor pool.** Unlocks once every zone is green. Your tank is parked inside behind a
   roller door, guarded by an enemy tank and a pillbox. Followers and buddies help.
8. **Recapture.** Walk up to your tank. Puff of smoke (like a jeep station), and you're in the
   normal player tank, with all its weapons. The four buddies hop up and ride on the sides of
   the hull, two each side. The freed green soldiers pile into tan army trucks from the motor
   pool and follow you out.
9. **The drive home.** Blast the main gate and follow the road (gold waypoint arrow) to
   Cooper's Base, a few hundred metres away, with the trucks behind you and tan jeeps chasing.
   Nothing can stop you, as with the bomb tanker.
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
| Jam riot cannon: hold to spray jam that sticks guards | LT | E |
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
| `src/prison/Followers.ts` | *(Built.)* Freed soldiers and buddies: follow the player's trail, gather round him, fight guards in range, hold position on X. Buddies get name tags (reuse the buddy name-tag code). |
| `src/prison/NavGraph.ts` | Hand-placed waypoints at doorways and corridor ends with A* between them, so followers and guards get through doors instead of grinding into walls. The free-roaming wander in `Soldier` only works outdoors. |
| `src/prison/Guards.ts` | Tan guards: posts and patrol routes on the nav graph, the existing `Soldier` shooting. |
| `src/prison/Towers.ts` | Guard towers round the yard with a guard on top; shootable, they topple. |
| `src/prison/Trucks.ts` | Tan army trucks (built with `PartBuilder`, detailed like the tanks and splashed with green paint) that the freed soldiers ride out in, following the tank along the road. |
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

The owner wants it in the level select while it's being tested, so it's there (as
"5 · Bonus: Prison Break") from milestone 1, and also reachable with `?mission=5`. Winning
mission 4 never rolls on into it: the bonus is only picked by hand.

1. **On foot in a box.** *(Done.)* Mission 5 plumbing, `PrisonGame`, `PlayerSoldier`,
   `ShoulderCam`, a walled training yard and one cell block, tan practice dummies to shoot.
2. **Cell Block A.** *(Done.)* Start locked in your own cell; shootable padlocks; doors swing
   flat against the bars; prisoners cheer and follow; X to hold or follow. Followers walk the
   trail of breadcrumbs the player leaves, which handles doorways without a nav graph: they
   cut corners when there's a straight line, gather round him when they can see him, and
   re-route (and as a last resort hop onto the trail) if a corner holds them up for six
   seconds. The nav graph is still needed for guards' patrols in milestone 3.
3. **Guards and fighting.** *(Done.)* Nine tan guards (posts and beats) in the corridor and the
   yard; the squad shoots back. Added at the owner's request:
   - **Jam riot cannon** (hold LT / E) instead of a jam grenade: a hose of jam lobbed onto the
     crosshair; guards it lands on are stuck, then slip over. It has a tank that refills.
   - **Capturing guards:** a downed guard is carried overhead by one of the squad (two at
     a time) along the nav graph to the nearest unlocked cell with room (three to a cell), sat
     down inside, and the door shuts once the doorway's clear.
   - **Medics:** two prisoners (white helmet band, red cross on the pack) run to anyone
     knocked down, the player included, and patch them up. The player can help a friend up
     by standing by him; anyone left alone gets up by himself after 25 seconds.
   `src/prison/NavGraph.ts` links hand-placed waypoints (a grid over the open yard, the
   doorway, the corridor, each cell) for these errands.
4. **The rest of the compound.** *(Done.)* The compound grew wings either side of the yard:
   Cell Block B (east, with a lever box that opens every door), the barracks and punishment
   hut (west). Four guard towers in the yard (ten rifle hits topple one; the guard on top
   falls with it). The barracks' tan flag (three hits, then a green one goes up). The four
   parts are zones: each is "taken" once its guards are down, its cells open, and its towers
   or flag dealt with, and becomes the checkpoint. 22 guards, 21 prisoners, all four buddies.
   Also: the squad keeps out of the camera's way.
4b. **Alcatraz opening** *(done)*. Replace the start with the 1962 Alcatraz
   escape's route, without the digging or planning: Cell Block A becomes a cellhouse with
   two rows of cells back to back and a utility corridor (pipe chase) between them. Out
   through the loose vent grille at the back of your cell, along the pipe chase (freeing
   Keston and Max through their vents), up the pipes and out through a roof ventilator; a
   searchlight sequence across the cellhouse roof (get caught and you're back at the
   hatch); then down the bakery pipe to the ground, where it turns into the fight-your-way-
   out level above. Also from the owner: only eight follow the player (the four buddies, two
   medics and two others); the rest stay behind on posts, guarding cells with captured guards
   in them first, then securing doorways.
5. **Breakout.** *(Done.)* The motor pool (fenced, south of the east wing) opens once every
   zone's taken. Walking up to the tank boards it: the real `PlayerTank`, which works on the
   prison level because the big map's terrain, moat and road lookups report flat ground with
   neither there when `PRISON` is set. The buddies ride on the hull, everyone else in three tan
   trucks (`Trucks.ts`) that follow the tank's tracks. A shell (the main game's
   `predictTrajectory`) blows the main gate open; four tan jeeps chase the convoy up the road
   (`Outside.ts`: road, trees, fences, Cooper's Base); home, everyone jumps down and cheers.
   Also from the owner: the prisoners' only weapon is the jam cannon, and the towers always
   fall into the yard.
6. **Polish.** *(Done.)* An opening flyover (skippable), the tank's engine note, a gold arrow
   to the last guard or two in a part of the prison, checked on Low graphics (no shadows,
   lower resolution, about twice as fast). And, from the owner, better geometry: cast-concrete
   walls with pilasters, panel seams and a footing; barbed wire and razor wire along the
   perimeter; a gatehouse with two towers and a "TAN ARMY PRISON" sign; barred windows,
   pilasters and cornices on the cell blocks; plank siding, a porch and a chimney on the
   barracks; a "SOLITARY" sign on the hut; floodlight poles; a basketball court in the yard;
   benches; a water tower in the west wing.
7. **Feedback round.** *(Done.)* From the owner:
   - Running on foot felt like snagging on things. Three causes, all fixed in
     `PlayerSoldier.ts`:
     - Every frame pushed the capsule down into the floor, and now and then Rapier refused the
       whole move. On his feet the move is now flat, and snap-to-ground keeps him down.
     - The controller's skin was 2 cm, so a frame that left him a hair inside something stopped
       him dead. It is now 8 cm.
     - Brushing a post or clipping a crate's corner wiped out his run speed. Now the run speed
       is left alone, and when he's blocked nearly head-on he looks just past the obstacle and
       slides round whichever side is open. Square into a long wall, he still stops.
   - Outside the prison it's mission 1's world:
     - The Kenney trees, which topple like they do there.
     - The real `HomeBase` for Cooper's Base: sandbag wall, gate towers, Chinook and trophy.
     - The road runs in through the base's gate.
     - The raider jeeps turn back in sight of the base's watchtowers.
   - The trucks are detailed like the tanks, with tan markings slapped over with green paint.
   - The tank parked in the motor pool has nobody in its hatch until you climb in.

## Risks

- **`PlayerTank` outside `Game`.** It's built for `Game`'s world. Expect some coupling to
  untangle when it's reused for the finale (milestone 5).
- **Indoor lighting and shadows.** The shadow camera is sized for open country. Indoors needs
  a tighter shadow box that follows the player, and should be checked on Low graphics.
- **Followers in doorways.** The most likely thing to look broken. The nav graph plus a bit of
  spacing between followers should handle it; budget time for it.
- **Size of the job.** This is a new game mode, comparable to the bomb tanker and zombie
  mission put together. Each milestone is a PR on its own.

## Decisions

1. **Unlocking:** in the level select as a bonus while it's tested.
2. **Stealth:** none, just fighting. *(Reversed in milestone 8: the level is now a stealth escape, with a bit of fighting allowed.)*
3. **Enemies:** tan only.
4. **The freed soldiers at the end:** follow you out, in trucks.
5. **Home:** Cooper's Base.
6. **Added later:** beaten guards are carried to the cells by the squad; a jam riot cannon;
   medics who pick up downed allies.

## Milestone 8: the stealth rework (night, gear, raft, shore)

*(Done.)* From the owner: fix the bakery pipe's top, swap the tank escape for a raft, cut down
the prison-break elements and replace them with collecting escape gear closer to the Alcatraz
escape (makeshift raft, life jackets, a pump), keep a bit of fighting but make it mostly
stealth; on foot to Cooper's Base after landing, with vision cones and guards searching;
the whole level at night with the dawn breaking as you land; helicopters searching during the
raft part, about five minutes long.

### What the level is now

1. **Cell, pipe chase, roof, bakery pipe** as before (night, searchlights on the roof). The
   bakery flue's elbow now starts exactly on the pipe's top (the torus was centred on the pipe's
   axis instead of a bend radius in from it) and turns in over the roof.
2. **The gear** (`Gear.ts`, stage `out`). Five pieces lie about the compound under golden
   beams: raincoats (barracks lockers), life jackets (Cell Block B corridor), a bellows pump
   (workshop bay), paddles (punishment hut, behind a padlock) and contact cement (the yard).
   Then shoot the padlock on the sea gate (`SeaGate.ts`, a portcullis in the north wall) and
   walk out the jetty to launch.
3. **Stealth** (`Guards.ts`, `VisionCones.ts`). Each guard has a vision cone (17 m, 26 m up a
   tower, 70 degrees wide) drawn flat on the ground, clipped by walls with a ray per slice.
   Suspicion fills while the player is in a cone with a clear line (faster when closer);
   creeping (Shift / RB) shortens the reach to 55% (the bright inner part of the drawn cone).
   At full, the guard raises the alarm: guards within 32 m start searching the spot, he and
   anyone who sees the player shoot. Alarmed guards that lose sight hunt the last known spot
   (by the nav graph in the compound, straight in the open), look round it, then give up and
   walk back to their beat. Rifle shots are heard 26 m off and bring guards to look; a shot
   guard is alarmed at once. The squad (Keston and Max only) holds fire until the alarm goes
   up. Guards: 14 in the compound (down from 22), 12 on the far shore.
4. **The raft** (`Raft.ts`, `Sea.ts`, `Helis.ts`, stage `raft`). About 1130 m of open sea:
   at 3.7 m/s paddling flat out that is just over five minutes, longer with hiding. W/S paddle,
   A/D steer, Shift pulls a tarp over you. Four search helicopters (`createGunshipModel` from
   `HelicopterEnemy.ts`): three zigzag across the course through a band of it each, one weaves
   over the raft. Standing in a beam fills a meter; when full they all hunt, firing bursts
   (28% to hit, 10% if flat). Hull 5: three life jackets then two raft hits, then it goes down
   and the player is put back at the last buoy (four of them, each also gives a spare jacket).
   Eight mist banks along the course hide the raft completely; hunters give up in a few seconds
   when hidden. A naive straight run at full speed is caught about once and sinks about
   40% of the time (checked with `debugAdvance` runs).
5. **The far shore** (`Outside.ts`, stage `shore`). A beach, hedged fields, a farm, mission
   1's woods, a roadblock and the road up to the same Cooper's Base, 450 m, with twelve guards
   out (beach pacers, lane patrols, a loop round the wood, a guard at the barn, the roadblock,
   the perimeter). Checkpoints after the beach, the first fields and the roadblock. Within 32 m
   of the base the ending plays.
6. **Night and dawn** (`DayCycle.ts`). The look is night (moon out over the sea, stars, a few
   real floodlight lights that follow the player round the compound). Dawn creeps in over the
   last 45% of the crossing and finishes about 280 m up the shore.

### Removed

`Breakout.ts` and `Trucks.ts` (the tank, riders, trucks and jeeps), the zones and their
checklist, the barracks flag objective, Cell Block B's lever box and prisoners, the medics, the
guards on two of the four towers, and the prisoners holding the prison. Cell Block B, the
barracks, the hut, the motor pool and the towers are still there as places to look for gear.

### Notes for later

- The helicopters' spotlights are real `SpotLight`s (four), the floodlights four `PointLight`s;
  both sets are only switched on when they matter (toggling `visible` recompiles the materials
  once), and the point lights are left out on Low graphics.
- `PrisonGame.debugAdvance(seconds, input)` runs the game ahead without drawing (used to test
  the crossing); `debugCam` pins the camera for screenshots. Both are dev only.

## Milestone 9: Alcatraz island, subtler helicopters, sharks

*(Done.)* From the owner: make the helicopters menace the player but not try too hard to spot
them, add hungry sharks in bibs as scenery, and make the prison bigger and more like Alcatraz.

- **Helicopters** (`Helis.ts`): beams are 9 m across (was 10), take 2.6 s to be sure (was 1.8),
  sweep at 4.6 to 5.3 m/s, a hunt lasts 9 s (was 18) at 9 m/s, only the nearest two gunships fire,
  one burst per 4.8 s, 12% to hit (4% flat). A naive straight run is now caught about once in
  eight and never sank in the test runs.
- **Sharks** (`Sharks.ts`): fifteen bibbed sharks (a red-checked napkin, tied on with a string)
  with angry eyes, a hinged toothy jaw, tongue and drool. They lurk as a fin, lift out for a
  chomp and a stare now and then, and a raft within 48 m gets circled at about 11 m. No damage.
- **The island** (`Facility.ts`, `Lighthouse.ts`): the compound is 200 by 113 m (was 144 by 67)
  on an island whose cliff edge drops into the sea on three sides, with the beach and jetty on
  the north. New in the added bands: dining hall, hospital, powerhouse and a 26 m chimney in the
  west; the factory (sawtooth roof, loading dock) and the warden's house in the east; concrete
  corner towers; a terraced recreation yard in the north with steps up to a platform and a
  handball wall; street signs in the cellhouse; a lighthouse in the north-east corner with two
  sweeping beams that fade at dawn. The wing walls have three doorways each (north, middle and
  south). Four more guards (18 in the compound), one on the recreation yard's platform. The new
  buildings are solid blocks with facades, not enterable.

## Milestone 10: the green triangle and the leaks

*(Done.)* The raft is now an army-green inflatable triangle (three tubes, rounded corners, floor,
valve), seating the crew inside it. Twice in the crossing (30% and 66% of the way) a seam splits
and the air drains over 20 s (`PrisonGame.updateAir`): the raft sags, speed drops to 35% when flat,
the HUD shows an Air bar, and each press of the fire button (A, Space or click) puts back 8.5%
(about twelve presses). Flat for four seconds sinks it (back to the last buoy, as for hits).

## Milestone 11: a three minute crossing and a stealth rating

*(Done.)* Raft cruise is 6.2 m/s (was 3.7), so the 1110 m crossing is about 3 minutes flat out
(drift, steering and hiding add to it). The end screen gives a stealth rating from 100 points:
-14 per guard alarm, -10 per helicopter alarm, up to -24 for time seen by guards, up to -15 for
time in a searchlight, up to -15 for shots fired, -4 per guard put down, -8 per knock-down,
-12 per sinking. S 95+ (ghost), A 80+ (shadow), B 60+ (prowler), C 40+ (noisy), else D.

Sharks are kept at least 8.5 m from the raft (anything closer is pushed straight out), so none ever intersects it.
