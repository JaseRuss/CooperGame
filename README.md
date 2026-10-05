# CooperGame

A Claude Code project to build an army men game for Cooper.

A toy-soldier tank sandbox that runs in the browser. Drive a green plastic tank
around a big open world, flatten the five tan enemy bases, and head back to a
family base to repair. You can't be destroyed, so there's no game over, except
in the last level, where the zombies can break into the Fortress before you
escape to the Moon.

Built with [Three.js](https://threejs.org/), [Rapier](https://rapier.rs/) physics,
TypeScript and [Vite](https://vite.dev/). See [Credits](#credits) for where the ready-made
models and font came from.

## Play it online

**https://jaseruss.github.io/CooperGame/**

Works in Chrome, Edge or Firefox on a computer. Plug in a controller, or use the
keyboard and mouse. The site rebuilds itself automatically whenever changes are
pushed to the `main` branch.

## Running it on your own computer

### 1. Install the tools (one time)

- **Node.js 22 or newer**: download the LTS version from
  [nodejs.org](https://nodejs.org/). This includes `npm`.
- **Git**: from [git-scm.com](https://git-scm.com/downloads). You can skip this
  if you use the ZIP download below.

To check Node is installed, open a terminal and run `node --version`. It should
print `v22` or higher.

### 2. Get the code

Either clone it with Git:

```bash
git clone https://github.com/JaseRuss/CooperGame.git
cd CooperGame
```

Or, on the GitHub page, click the green **Code** button, then
**Download ZIP**. Unzip it and open a terminal in the unzipped folder.

### 3. Install and start

```bash
npm install
npm run dev
```

The first `npm install` takes a minute. Then `npm run dev` prints a local
address, usually **http://localhost:5173**. Open it in Chrome, Edge or Firefox.
If you're playing with a mouse, click the game once so it can take over the
mouse for aiming. Press `Esc` to get the pointer back.

To stop the game server, press `Ctrl + C` in the terminal.

### Optional: a production build

```bash
npm run build
npm run preview
```

This puts a standalone copy of the game in the `dist` folder. You can host that
folder on any static web host.

## Controls

A gamepad is the best way to play. Xbox and PlayStation controllers both work;
plug one in and press a button so the browser detects it.

| Action | Controller | Keyboard / mouse |
| --- | --- | --- |
| Drive (or fly the chopper) | Left stick | W A S D or arrow keys |
| Aim turret | Right stick | Mouse |
| Fire (the jeep fires jam rounds, the chopper its chin gun) | RT or A | Left click or Space |
| Jam cannon (hold, short range) | LT | E |
| Mega jam: jam all round the tank (when charged) | X | X |
| Homing rocket (when charged; the jeep and chopper fire missiles, the motorbike rocket jumps) | LB | F or right click |
| AA missiles (with a helicopter locked) | RB | Q |
| Switch first / third person | Y | C |
| Pause, full map and options | Start | M |
| Return to the nearest family base | Back | R |

Driving works like the Warthog in Halo by default: push the stick the way you
want to go relative to the camera. Pull back to reverse. Let go and the tank
turns to face where you're aiming. Prefer the old way? Pause, open **Options**
(X or O) and switch **Tank controls** to **Classic**. Options also has aim speed,
buddy name tags, how long the **jeep** and the **chopper** last, **music** and **sound effects**
volume (Off, Low, Medium or High), and the **buddy names**: pick a buddy and
press A or Enter, then type a new name, or on a controller use up and down to
pick each letter, left and right to move, and X to delete. Your choices are
remembered.

**Local co-op:** pause, open **Options**, choose a controller for each player, and choose a **Vertical** (side-by-side) or **Horizontal** (top-and-bottom) split. Player 2 is disabled by default. Either player can use keyboard and mouse; when Player 2 uses them, use the arrow keys to move, the mouse to aim, and the number pad to fire (0), use the jam cannon (1), or switch camera (9). Both players have a complete HUD, separate views, health, weapons, vehicle state, and abilities. Co-op works across the tank missions and the prison escape; objectives can be advanced by either player, and both players take part in the prison raft crossing and escape.

**Slower computers:** pause with **M** / **Start**, open **Options**, and set
**Graphics** to **Low** for a softer picture without shadows. **Balanced** uses
normal screen resolution and lighter shadows; **High** is the default, with
sharper shadows and extra resolution on Retina / high DPI screens. Enable
**Show FPS** to display frames per second at the top-right of the minimap (off
by default). Changes take effect immediately and are remembered between visits.

**Sound:** each level has its own music: a march for the day battle (which
turns into a sneaky tune once night falls), bongos in the jungle, a jig for the castles and a spooky
xylophone for the zombies. Browsers keep a page quiet
until you click or press a key, and a controller button doesn't count, so if
you're playing on a controller, click the game or press a key once to turn the
sound on.

## Playing

- **Who's who:** green (you and your buddies) and **red** are friendly; **tan**
  and **blue** are the enemy.
- There are **5 enemy bases** to destroy, held by the **tan** and **blue**
  armies. The red arrow on the minimap points to the nearest one, and the gold
  arrow to the nearest family base (with the distance to each). Get close and
  a checklist shows what's left to knock down.
- Once a base falls, **green troops and bunkers** move in and fight anything
  nearby.
- **The war goes on around you** (missions 1 to 4). Every enemy base that's
  still standing sends squads of raiders, a minute or two apart, marching on
  the family base nearest you. If they get inside, that base is **under
  attack**: its guards turn out to fight, and it can't repair you until the
  raiders are cleared out. Your side sends squads too: the family base
  nearest you, and every enemy base you've captured, sends green troops
  marching on the nearest enemy base to soften it up (they can't take it on
  their own), and you'll hear when they get there so you can go and help.
  Knock out enemy bases and the raids dry up.
- **Day to night:** the first mission starts in bright sunshine, and every base you
  take sends the sun lower: orange dusk, then dark. By the final assault (or the
  bomb tanker's run) it's a night raid: stars, flares over the troops, tracer from
  the guns and a barrage of explosions round the Fortress. Your tank's headlight
  switches on as it gets dark.
- **The Fortress** in the middle of the map is locked until all five enemy
  bases are down, and nothing inside can be shot until then. Then its gates
  open and a column of green and red tanks and troops joins you for the final
  assault. Flatten it to win.
- A **moat** runs all the way round the Fortress (the Great Castle's too), with
  a causeway across it to each gate. An invisible wall along the water's edge
  stops anything driving in, so you can't get stuck in it. A few of the
  garrison lounge about in the moat in **rubber rings**, some in sunglasses,
  one on a duck: shells and blasts nearby tip them in (they climb back out),
  jam gums them up, and once the gates open they paddle for their lives.
  Nobody shoots at them and they don't shoot back.
- **Enemy helicopters** patrol the open country and circle in to attack. Raise
  your gun: one direct shell hit brings one down. Or aim roughly at one until
  **HELI LOCKED** shows by the crosshair and fire a salvo of wobbly
  **AA missiles** (RB / Q). They only seek a little, so aim well; two darts
  bursting close will do it. You carry 12, six per salvo; when they run out,
  drive back to a family base to rearm. Helicopters show as pink markers on the
  maps.
- The **red army** is on your side. Their tanks and soldiers guard every town.
- **The edge of the map** is ringed by a yellow and black barrier with red lamp posts. Nothing
  can drive or fly past it.
- **Family bases** sit around the edge of the map. Drive inside one to repair
  and restock your AA missiles.
- **Repair crates**: knocked-out enemy helicopters always drop a green crate
  with a red cross, and tanks and bunkers sometimes do (on the zombie mission,
  the big zombies). Drive over one, or fly low over it in the chopper, to patch
  up 25 hull points. It only gets picked up if you're damaged, and it glows so
  you can spot it, then blinks and vanishes after 30 seconds.
- **Power crates**: an orange crate with a yellow lightning bolt, dropped now and
  then by knocked-out tanks, bunkers, big zombies and (often) helicopters. Drive
  over one for **double damage** from your guns, rockets and missiles for 20
  seconds (another crate tops it up, to 40). The HUD counts it down.
- The **jam cannon** sprays a stream of strawberry jam that lands in a line along
  your aim; sweep the turret to hose down a whole squad. The jam drips as it
  flies, so anything under its path gets it too, even if you shoot over their
  heads. Enemy soldiers caught in it get stuck, can't shoot, and slip over a few
  seconds later. Enemy tanks get their tracks stuck and can't drive for a few
  seconds. Get jam into the front of an enemy bunker and it's a critical hit.
  Careful with your own side: jam doesn't hurt them, but it gums up their guns
  for a few seconds.
- **Mega jam** (X): lobs rings of jam all round the tank. It takes 20 seconds to
  refill.
- Your tank (and your buddies) go a bit faster on **roads**.
- **Low hull:** when the hull drops below a third, the homing rocket (and the
  jeep's and chopper's missiles) are knocked out until you repair at a family
  base or with repair crates.
- Drive into trees and lamp posts, or shoot them, to knock them flat.
- **Rear hits** do double damage to enemy tanks. Front armour takes half damage.
- Knocked-out enemy tanks usually just blow up, but sometimes the turret pops
  off like a cork, the tank flips onto its back like a stuck turtle, the crew
  waves a white flag and shouts, or the whole thing rockets into the sky and
  bursts into confetti.
- **Critical hits:** put a shell through a pillbox's gun slit, or into a parked
  jet's wing-tip missiles or fuel tanks, and it goes up in one shot.
- **Fuel tanks** in the enemy bases go up from one shell in a huge fireball that
  can set off the tank next door. Radars fall to one shell, water towers to two. The
  crosshair turns gold and says CRITICAL when you're lined up on one.
- **Buddies** (Keston, Max, Innes and Jason, unless you rename them) follow
  you and join the fight. One rolls in by themselves whenever the buddy meter
  fills (it starts full and refills over five minutes), up to all four at once.
  Who comes next is a surprise, and so is what they come in: a **tank**, a fast
  **jeep** with a machine gun that goes after soldiers, or a **chopper** that
  flies out ahead of you where you can see it and shoots its chin gun. Only one
  buddy can be in a chopper at a time.
- **Anti-aircraft:** every enemy base (except the castles) has a **flak gun**
  that fills the sky round your choppers with black bursts, and one soldier in
  every enemy squad carries a **rocket launcher** (a longbow with fire arrows on
  the knights mission) that he only fires at choppers. The rockets aren't
  guided, so a moving chopper is harder to hit. They hit your own chopper too,
  but it takes much less damage than a buddy's. The flak gun is one of the
  base's targets and falls to two shells, so knock it out before sending
  choppers in.
- Hit a building and a health bar pops up over it for a few seconds.
- **Cracks:** tough buildings (factories, warehouses, smokestacks, castle walls
  and towers) crack where your first shell lands, with a glowing orange split,
  and crack again as they lose each quarter of their health. A shell that
  lands on a crack does **double damage**, and the aim ring turns orange and
  says **CRACK ×2** when you're lined up on one. Keep hitting the crack and a
  factory goes down in 7 shells instead of 13.
- The pause map shows where the enemy is gathered as a red glow.

## The bomb tanker (Mission 1)

The Fortress on the first mission sits in the far top-left corner of the map, and its gates
don't open when the bases fall. You get in by building a **bomb tanker** and driving it there.

- **Destroy the bases for the parts.** Each of the five enemy bases drops one part into its
  ruins when it falls, in a beam of light: the **Armoured Engine**, **Bomb Casing**,
  **Explosives**, **Detonator** and **Turret Guns**. They show on both maps as numbered gold
  discs and on screen as an arrow. Drive over one to pick it up, or fly over it in the chopper
  and it's winched up from any height.
- **Bring them home.** Parts you're carrying ride on a little trailer (with a yellow pennant)
  behind the tank, jeep or motorbike, or hang from a winch cable under the chopper, a reminder
  to take them back.
- **Fit them.** The rig is parked on the highway just outside Cooper's Base (an orange **B**
  on the maps). Drive or fly within about 48 m of it with parts and they're fitted (the chopper
  doesn't need to land); you can make several trips.
- **Thunder Road.** Once all five are on, your tank rides the rig's rear deck and the
  buddies man its four gun posts. The run is on rails: the rig drives itself along the roads
  across the whole map to the Fortress while you aim and fire the tank's gun. The homing
  rocket fires without the rocket cam up there, so you never lose sight of the rig, and it
  reloads in 12 seconds instead of 75. Raider jeeps
  (tan and blue) come at it, shooting and some ramming (a rammer bounces off, swerves out wide
  for a few seconds, which gives you a clear shot, then has another go; the third ram wrecks
  it). Up on the deck your gun dips far enough to hit jeeps alongside. Explosions go off along the road, and
  the rig bowls over anything in the way: soldiers, enemy tanks and trees. Nothing can stop the
  rig, so there's no game over.
- **The bomb.** At the Fortress gate the rig blows the gates off and everyone bails out. The
  empty tanker rolls on into the courtyard on its own, and a few seconds later the Fortress goes
  up in a chain of explosions, which wins the mission. The other missions don't have the tanker.

## Jeep, chopper and motorbike stations

Every family base has a changing station just outside the gate: Cooper's,
Dad's and Auntie Claire's have a **motorbike station**, Mum's and Innes' a
**jeep station**, and Granny's, Grandpa's and Uncle Steven's a **chopper
station**. Each enemy base gets one too once you've captured it. Jeep stations
show as a blue **J** on the maps, chopper stations as an orange **H** and
motorbike stations as a pink **M**.

### Jeep stations

A jeep station is like a drive-through car wash. Drive the tank through it and,
in a puff of smoke, it turns into a jeep.

- The jeep is much faster than the tank. A driver steers and the commander rides
  in the back on the guns.
- It has no cannon. **Fire** shoots a stream of jam rounds that fly straight
  like bullets and stick soldiers and tanks where they land.
- **LB / F** fires a homing missile. It's smaller than the tank's rocket, with no
  rocket cam, and reloads in 8 seconds.
- AA missiles and the mega jam still work.
- After **3 minutes** (change it under **Jeep time** in **Options**) it turns
  back into the tank in another puff of smoke. Drive through a station while
  you're in the jeep to top the time back up.

### Chopper stations

A chopper station is a round helipad with a big **H**, a windsock and a sign
with a spinning rotor on top. Drive the tank (or the jeep) onto the pad and, in
a puff of smoke, it turns into an attack helicopter and takes off.

- The chopper flies high over everything, so it can't bump into buildings or
  trees. You don't have to worry about height: push the stick (or W A S D) the
  way you want to go on screen, including sideways and backwards, and the nose
  turns to face where you're aiming. A pilot flies it and the commander sits in
  the front seat.
- It can't fly into the Fortress while the gates are locked.
- **Fire** shoots the chin gun: a fast stream of small shells.
- **LB / F** fires two homing missiles, one off each wing. They reload in 8
  seconds.
- AA missiles fire from the rocket pods, and the **mega jam** drops rings of
  jam onto the ground below.
- First person (**Y** / **C**) is a gun camera under the nose.
- After **3 minutes** (change it under **Chopper time** in **Options**) it comes
  down to land wherever it is (steer it somewhere clear), then turns back into
  the tank. Fly over a chopper station, even on the way down, to top the time
  back up.

### Motorbike stations

Drive through a motorbike station and the tank turns into an army-green sports
bike, with a rider in a helmet, twin machine guns on the fairing and a booster
rocket down each side.

- It's the fastest thing on the ground and leans into the corners. Hit a
  kicker ramp or a hill crest at speed to jump, with a backflip.
- **Fire** shoots the twin machine guns, left and right in turn. It has no jam
  cannon or AA missiles.
- **LB / F** fires the boosters for a **rocket jump**: the bike shoots about
  25 m straight up. At the top, the six missiles in the booster racks fire down
  at the nearest enemies below (tanks first, then bunkers and base buildings,
  then soldiers), and landing bowls over any soldiers close by. It recharges in
  a minute, and the missiles show back on the racks when it's ready. A rocket
  jump can't carry you over the Fortress's walls while the gates are locked.
- After **3 minutes** (it uses the **Jeep time** option) it turns back into the
  tank. Drive through a motorbike station to top the time back up.

## Mission 2: Jungle Strike

Win the first mission and the jungle is next: thick jungle on a fresh battlefield,
with villages of wooden huts and shacks joined by dirt tracks. The trees hide
the enemy until you're close, so drive through them or blast them over with the
main gun to clear a path.

## Mission 3: Castle Siege

Win the jungle and you ride into the land of knights. You're still in your tank,
but the enemy bases are stone **castles** with towers, a gatehouse, a keep, a
great hall, a forge, powder stores (one shell sets them off), a watchtower and a
trebuchet. Shells can knock holes in the castle walls, so you don't have to go
in through the gate. The tan and blue armies are **knights** with crossbows, their
tanks are old **cannons** pushed about by two gunners, and their helicopters are
**dragons** that breathe fireballs (one shell or two AA darts brings one down).
The pillboxes are stone guardhouses with a ballista. The villages are thatched
cottages on dirt tracks, and the Fortress in the middle is the **Great Castle**.

## Mission 4: Zombie Attack

The last level, at night. Green, red, tan and blue have all joined up to defend
the **Fortress**, and waves of glow-in-the-dark plastic **zombies** are coming. A
new wave comes every minute, from more sides and bigger each time: walkers, then
speedy runners, then big purple brutes that take several hits. Pillboxes, squads
and tanks from every army hold a ring round the moat, green soldiers man
**flamethrower pits** on its far bank that hose any zombie that gets close,
and there's a jeep station and a chopper station by the gates. Some of the towns
have already been overrun: houses knocked down, fires burning and zombies still
hanging about. Drive into the Fortress to repair and rearm, and press Back / R to
get back there.

Zombies can't swim, so they go round the moat and up the causeways to batter
the gates. Zombies that reach the Fortress wall batter it, and the wall's strength bar at
the top of the screen goes down (it mends slowly while they're kept off). If it
runs out, the zombies are in and the game is over.

The way out is the big **moon rocket** on its launch pad in the middle of the
Fortress. The panel at the top counts down until it's ready. Hold the wall for
**16 minutes** and searchlights light up over the pad: you then have **one
minute** to get onto it (an arrow on screen points the way). If the wall gives way
in that last minute the zombies pour in, but you can still make it. Reach the pad
and the rocket blasts off, and the ending shows everyone celebrating at a Moon base
under a "MISSION ACCOMPLISHED" banner. Don't make it, or lose the wall before the
rocket's ready, and the zombies close in round your tank while the rocket leaves
without you. The end screen shows how long you held out and how many zombies you
knocked over. Press A or Enter to play again.

## Bonus: Prison Break

A bonus level on foot, played at night as a **stealth** escape, on a rocky island prison
modelled on Alcatraz: the cellhouse (with Broadway and Michigan Avenue), the dining hall,
hospital, powerhouse and its tall chimney, the factory and the warden's house, concrete corner
towers, a terraced recreation yard with a handball wall, and a lighthouse whose beams sweep the
sea all night. The tan army has locked you
up. Break out of your cell, steal the gear for a raft (as the 1962 Alcatraz
escapers did, from raincoats), paddle across the sea past the search helicopters,
and creep home to Cooper's Base as the dawn breaks. It opens with a flyover of the prison (any
button or key skips it). The whole level is night, with the sky brightening as the raft nears
the far shore, and full morning by the time you reach the base.

- **The escape.** You start in a cell with a dummy head on the pillow. The grille at the back
  of the cell is loose: shoot it out and squeeze into the pipe chase, the narrow passage full
  of pipes between the two rows of cells. Shoot out the grilles of Keston's and Max's cells
  next door to let them out, then climb the pipes at the far end up through a ventilator onto
  the roof. Searchlights sweep the roof: stay out of their pools of light (hide behind the
  ventilators and the raised skylight roof), or you're spotted and sent back to the ventilator.
  Slide down the bakery's flue pipe at the far end.
- **The gear.** Five pieces of escape gear are lying about the prison, each marked by a tall
  golden beam you can see from across the yard (and an arrow on screen points to the nearest):
  **raincoats** for the raft (in the barracks lockers), **life jackets** (in Cell Block B's
  corridor), a **bellows pump**, which is a squeezebox as in 1962 (in the workshop bay in the
  motor pool), **paddles** (in the punishment hut, behind a padlock) and a tin of **contact
  cement** (out in the yard). Walk over a piece to take it. With the lot, shoot the padlock on
  the **sea gate** in the north wall (it winds up into the gatehouse) and walk out along the
  beach and the jetty to launch.
- **Vision cones.** Every guard's field of view is drawn on the ground in front of him: pale
  while he's calm, amber as he gets suspicious, red once he's raised the alarm, with a "?" or
  "!" over his head. Stand in a cone with a clear line to him and the stealth meter (top
  centre) fills, faster the closer you are. The cones are blocked by walls, crates, hedges
  and hay bales. **Creeping** (hold Shift, or RB) halves how far they reach (the bright inner
  part of each cone) but slows you right down. Guards pace their beats, stand and look slowly
  from side to side, or watch from the two guard towers.
- **Being found.** When a guard's sure, he raises the alarm: he and the guards near him shoot
  if they can see you, otherwise go to the last place you were seen, search it, and finally
  give up and go back to their beats. A **rifle shot is heard from far off** and brings guards
  to look (so shooting a padlock or a tower isn't quiet), and a guard you shoot knows exactly
  where you are. You can still fight a bit: three rifle hits knock a guard over, and the **jam
  riot cannon** (hold LT / E, quiet) sticks him fast until he slips over. Knocked down, you
  get back up at your last checkpoint with the guards stood down. Your squad (Keston and Max)
  keep their heads down until the alarm goes up; X tells them to hold where they are.
- **The crossing.** The raft is a green inflatable triangle, like the real escape boat. Twice during the crossing (about a third and two thirds of the way) a seam splits and it starts losing air, going soft, low and slow: **mash A** (Space or click) to pump it back up before it goes flat, or it sinks. Launch the raft from the jetty (the squad climbs aboard) and paddle north:
  W paddles, S backs water, A and D steer, and the mouse swings the camera round the raft.
  It's about **three minutes** to the far shore. Four tan **search helicopters** drift over the
  sea sweeping small searchlights: three work slowly back and forth across the course in
  bands, and a fourth keeps wandering over you. They menace rather than hound: a beam takes
  a few seconds on you before they're sure, and once they are the nearest two circle and
  loose off the odd, mostly wild, burst (a life jacket takes the first three hits, the raft
  the next two, and then it goes down and you're put back at the last buoy) before giving up.
  Ways out: the white **mist banks** hide you completely, and holding Shift pulls a **tarp**
  over you, which shrinks the beams on you and spoils their aim, at the cost of speed. Lit
  **buoys** down the middle are checkpoints, each with a spare life jacket tied to it.
- **Sharks in bibs.** The water is full of hungry cartoon sharks wearing red-checked napkins
  round their necks. Mostly it's just a fin cutting the surface; now and then one heaves its
  head out with its jaws going, and one that smells the raft slinks over and circles it,
  staring. They're scenery: they never touch you.
- **The far shore.** The raft grounds on a beach as the sun comes up. It's a few hundred
  metres up the road to Cooper's Base, the same camp as on mission 1, through fields split by
  hedges, a farm with a barn, mission 1's woods and a roadblock, with a dozen tan guards out
  searching: pacing the beach, working the lanes between the hedges, watching from the barn and
  holding the road. Hug the hedges, hay bales and trees, creep past the cones, and keep going.
  Walk in through the base's gate and everyone celebrates, and the end screen gives you a
  **stealth rating** (S ghost, A shadow, B prowler, C noisy, D smash and grab) from the alarms
  raised, time seen by guards or lit by searchlights, shots fired, guards put down, knock-downs
  and sinkings.

On **Low** graphics (Options) the level also drops antialiasing, every real light (the
floodlights and the searchlight beams are still drawn), half the sea mist, the lighthouse
beams and the far sharks, pulls the fog in and refreshes the vision cones less often.

Run about as a green army man (he hops, like all the toy soldiers) and aim over his shoulder.
Move with the left stick or W A S D, aim with the right stick or mouse, fire with RT or a
click, creep with RB / Shift, Y / C swaps to first person and Back / R goes back to the last
checkpoint. It's in the level select as **5 · Bonus: Prison Break**. The plan is in
`docs/plans/prison-break.md`.

## Level select

Pause, open **Options** and pick a level under **Level select** at the bottom,
then press A or Enter (or click it). It starts that mission from the beginning.
You can also open the game with `?mission=2` up to `?mission=5`.

## Credits

The tanks, soldiers, bases, the music and nearly everything else are made in
code. The ready-made pieces are all free to use, and the pause screen lists them
too:

- **[kenney.nl](https://kenney.nl/)**: City Kit Suburban, City Kit Commercial,
  City Kit Industrial, City Kit Roads, Car Kit and Nature Kit (the jungle trees
  and plants); the sound effects from Sci-fi Sounds, Impact Sounds and
  Interface Sounds. CC0.
- **[poly.pizza](https://poly.pizza/)**: wooden huts and shacks by
  [Quaternius](https://quaternius.com/). CC0. Links to each model are in
  `public/models/huts/LICENSE-quaternius-huts.txt`.
- **[fonts.google.com](https://fonts.google.com/specimen/Black+Ops+One)**: the
  Black Ops One font by James Grieshaber and Eben Sorkin. SIL Open Font License.
