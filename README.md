# CooperGame

A Claude Code project to build an army men game for Cooper.

A toy-soldier tank sandbox that runs in the browser. Drive a green plastic tank
around a big open world, flatten the five tan enemy bases, and head back to a
family base to repair. You can't be destroyed, so there's no game over, except
in the last level, where the zombies can break into the Fortress before you
escape to the Moon.

The game now starts with **Level 1: Trench Jungle**, a tougher level on foot designed by Cooper
(see [below](#level-1-trench-jungle)); win it and the tank battle, Day to Night, is next.

Built with [Three.js](https://threejs.org/), [Rapier](https://rapier.rs/) physics,
TypeScript and [Vite](https://vite.dev/). See [Credits](#credits) for where the ready-made
models and font came from.

## Play it online

**https://jaseruss.github.io/CooperGame/**

Works in Chrome, Edge or Firefox on a computer. Plug in a controller, or use the
keyboard and mouse. The site rebuilds itself automatically whenever changes are
pushed to the `main` branch.

## Linux desktop build (Steam Machine / Steam Deck)

Every push to `main` also builds a Linux AppImage and attaches it to the
[`linux-latest` release](https://github.com/JaseRuss/CooperGame/releases/tag/linux-latest).
It's the game in its own window (Electron). It loads the live site, so it's
always the latest version without downloading again, and falls back to the copy
bundled in the AppImage when there's no connection (`--offline` forces that).
Settings and saves are kept separately for the live and bundled copies. It
starts fullscreen and plays sound without a click first.

1. Download `CoopersTankArmy-x86_64.AppImage`, then make it executable
   (right-click → Properties → Permissions → "Is executable", or `chmod +x`).
2. On SteamOS, add it to Steam with **Add a Non-Steam Game** (Desktop Mode)
   and launch it from Game Mode.
3. F11 toggles fullscreen. Add `--windowed` to the launch options to start in
   a window.

If it doesn't start, `~/.config/Coopers Tank Army/launch.log` records each
launch, its options and any crash.

Controllers are read the same way Chrome reads them. If Steam has taken over a
controller (it does this with 8BitDo, Xbox and PlayStation pads), set Steam
Input for the shortcut to a gamepad layout, or turn it off, in the shortcut's
controller settings.

To build it yourself: `npm run build`, then `cd desktop && npm install && npm run dist`.
The AppImage lands in `desktop/release/`.

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

**Controllers:** playing solo, any connected controller (or the keyboard and mouse) drives your character, whatever Player 1 is set to. In co-op each player uses exactly one device: the one assigned to them in Options.

**Local co-op:** pause, open **Options**, choose a controller for each player, and choose a **Vertical** (side-by-side) or **Horizontal** (top-and-bottom) split. Player 2 is disabled by default. Either player can use keyboard and mouse; when Player 2 uses them, use the arrow keys to move, the mouse to aim, and the number pad for Player 2's controls. Both players have a complete HUD, separate views, health, weapons, vehicle state, and abilities. Co-op is supported throughout the campaign and bonus levels, including the tank missions, Jungle Patrol, the Moon, Prison Escape, Under Siege and Jailbreak. Both players can advance objectives and take part in each level's combat, interactions and completion.

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
- **Day to night:** Day to Night starts in bright sunshine, and every base you
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

## The bomb tanker (Day to Night)

The Fortress in Day to Night sits in the far top-left corner of the map, and its gates
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

## Level 3: Jungle Strike

Win Day to Night and the jungle is next, and this one is **entirely on foot**: a
very dense patch of jungle (about 4,800 trees) with a **river** across the middle, ponds and rock outcrops, you, and a **squad** of four green soldiers who
follow you, shoot at what they can see, and get back up after being knocked down. Press **X** to
make them hold their ground or follow you again.

- **A dirt road** runs from where you start (you begin a few steps off it, facing across) over the main bridge
  and north to the North outpost, with tracks off it to the West and East outposts. Four small **camps** are dotted
  along it: a fire, tents, crates and two sandbag gun emplacements (just for show). The soldiers there mill about,
  and if you walk up on them they stand gaping for a second ("WHAT?!") before they react, so you get the first shot.
- **A river with two bridges.** You can't wade it, so cross at a bridge (soldiers, yours and theirs, use them too).
  Water doesn't stop bullets, so expect to get shot at from the far bank. The enemy keeps a guard on the north end
  of the main bridge. Rock outcrops make good cover.
- **Three enemy outposts** (the tan and blue armies' hut camps), each with an ammo dump in a storage hut. Blow
  all three up to win. Get within about a dozen metres of a dump and press **Q** (RB on a controller) to plant a
  **bomb** (you start with three and can carry five). It goes off after seven seconds, so run, and your squad runs too.
  When a dump goes up it's a short cutscene: a huge blast that flattens the trees, the crates round it cooking off,
  and each outbuilding blown apart in turn, leaving burning wreckage.
- **An enemy airbase right by where you start.** It's optional: wreck its three jets and **paratroopers** drop in to
  join your squad, along with a supply crate that refills your grenades and gives you another bomb.
- **Lookout towers.** Walk up to the foot of the ladder to climb. From the top you can see over the trees, and the
  ground around the tower is revealed on your map (the rest starts out unscouted). Walk to the gap in the rail to climb down.
- **The jam gun** (hold **E**) is a short-range handheld cannon that sticks soldiers and **knocks trees flat**, so you
  can clear a way or a line of sight.
- **The grenade launcher** (**F**, right click or LB) fires four lobbed grenades, then needs a 20 second reload.
  Its ammo, the bombs and the jam gun all show in the weapon card at the bottom left.
- **Rain storms** roll in every minute or two: the sky darkens, the rain pours, and everyone (you and the enemy)
  can only see a short way until it clears. Creeping (Shift) makes you harder to spot.
- You can also use the rifle (click) and the checkpoint (R). The enemy shoots back and calls for help
  once they've seen you, so scout first, then pick the outposts off one at a time.

## Level 4: Castle Siege

Win the jungle and you're back in your tank in the land of knights,
but the enemy bases are stone **castles** with towers, a gatehouse, a keep, a
great hall, a forge, powder stores (one shell sets them off), a watchtower and a
trebuchet. Shells can knock holes in the castle walls, so you don't have to go
in through the gate. The tan and blue armies are **knights** with crossbows, their
tanks are old **cannons** pushed about by two gunners, and their helicopters are
**dragons** that breathe fireballs (one shell or two AA darts brings one down).
The pillboxes are stone guardhouses with a ballista. The villages are thatched
cottages on dirt tracks, and the Fortress in the middle is the **Great Castle**.

## Level 5: Zombie Attack

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
checkpoint. It's in the level select as **6 · Bonus: Prison Break**. The plan is in
`docs/plans/prison-break.md`.

## Epilogue: Moon Buggy

The zombie mission's happy ending now leads on (press A / Enter on the "Mission Accomplished"
screen), and it's in the level select as **8 · Epilogue: Moon Buggy**. The armies made it to the Moon;
you drive a moon buggy with low gravity (a jump keeps you up for about five seconds, and a hard
landing can shake a crate off the bed).

- Drive into an army's coloured **supply bay** at the main base to load four of its crates, then
  follow the beam and the **dirt road** to that army's camp and into the glowing ring. Crates hop
  off onto the pallet; the third one starts a time-lapse of that army's Moon base going up.
- Controls: left stick / W A S D drive, A / Space / RT jumps, RB / Shift handbrake, Y / C camera,
  Back / R back to the main base. In the air W / S tip the nose and A / D spin.
- Code is in `src/moon/` (`MoonGame` is the level, `Buggy` the physics, `Camp` the build sequence).

### The Weird Side

Build all four Moon bases and the armies have one more surprise. Their road crews (a bulldozer, a
dump truck, a cement mixer and a steamroller) drive out of the back of the main base laying a new
road north, blow up the rockfall that blocks the canyon through the mountains (you can see it, with
a ROAD CLOSED sign, from the north edge of the plain beforehand), and the camera flies down the
canyon to the **Weird Side of the Moon**: a valley of candy-coloured dust, crystals, a rainbow over
the lot and a whale swimming round the sky. The buggy is put at the start of the new road.

There are **40 odd things to find**. Drive close to one and it's found: its name comes up with a
joke and the count. The map shows each one as a purple **?** until it's found (then a gold star),
and the arrow points to the nearest one you haven't found. One of them is hiding and isn't on the
map at all. Find the lot for a fanfare. The music changes to a bongo-and-marimba tune in the valley.

- **Things to play on:** the bouncy castle's trampoline (and the castle floor) fling the buggy
  sky-high; drive into the funnel at the back of the **circus cannon** to be fired across the valley
  at a bullseye; drive through the **blue door** and you come out of the **red door** on the other
  side of the valley (and back again); hit the **zoom arrows** and the **rainbow ramp** to jump six
  buses; and drive down the **bowling lane** to knock the pins flying (all ten is a strike, and the
  scoreboard counts them; the pins stand back up after a while).
- **The rest, roughly south to north:** the road crew's tea break by the canyon, Echo Canyon, the
  welcome arch, a dragon asleep on its gold, an upside-down house, the moat guys on holiday at a duck
  pond, the shark in a bib, an alien picnic, a UFO getting a parking ticket, the lost socks
  department, a bath, Mr Moonwhippy's ice cream van, the rabbit in the Moon pounding mochi, a giant
  wedge of cheese with mice in helmets, the cow jumping over the Moon (with the dish and the spoon),
  a giant toaster, a living room with the telly on, the human pyramid, zombie aerobics, the Moon
  disco, Crate-henge, a dinosaur in a fishbowl helmet, the great jam sandwich, penguins on a slide,
  the end of the rainbow, the great snail race, a pirate ship looking for the sea, a washing line of
  enormous pants, the Man in the Moon having a lie-in, a soldier fishing for stars, the Moon's worst
  traffic jam, Moon golf and the space whale.
- **The maze:** high candy-coloured castle walls (too high to jump) cut the valley floor into winding
  lanes. It's a real maze with a good few walls knocked through, and the walls stop short of the
  roads and of every tableau, so nothing is shut in. On the map the valley starts under a **fog of
  war** that lifts as you explore, showing the walls; the purple blips for things still to find
  always show through the fog, and the ones off the edge of the corner radar sit on its rim.
- **The skiing robot:** a giant cooker on red skis (bobble hat, scarf, two ski poles) does laps of
  the mountain walls round the valley, and ski-jumps the canyon each time it comes round.
- To jump straight there (for trying it out), open the game with `?mission=7&wonders`: every camp is
  built and the road is open.
- Code is in `src/moon/wonders/` (`index.ts` lists every tableau and where it stands, `Wonders.ts`
  finds them and runs the gadgets), `src/moon/RoadWorks.ts` (the road-building scene), `src/moon/Maze.ts`
  and `src/moon/SkiRobot.ts`.

## Level 1: Trench Jungle

The first level, designed by Cooper: it's where the game starts, first in the level select as
**1 · Trench Jungle**, and `?mission=8` opens it too. Win it and Level 2 (Day to Night) starts. Single
player, on foot, and **tougher than the others**.

**It looks like a huge front.** Both trench lines, their wire and no man's land carry on far beyond
the part you fight in, with our men kneeling in the trench out there and shells bursting along the
line, and the jungle goes on all round. The fighting area is fenced off with **barbed wire**:
heavy coils of it on iron pickets where it crosses the trenches and no man's land, and a post-and-wire
fence back in the jungle.

**The big gun** is a proper WWI field gun: spoked wheels with iron tyres, seats on the axle, a box
trail and spade, an armoured shield, the barrel on its cradle with the recoil buffer and
recuperator, a breech block, a dial sight and handwheels. The barrel slams back when it fires. It
has an ammunition limber and a stack of shells, and two of its crew (theirs is the same, in tan).

Our trench line runs across a strip of jungle, facing theirs across a muddy no man's land of shell
holes, stumps and barbed wire. Each trench has a sandbagged parapet too tall to see over, a fire
step to stand on to shoot over it, duckboards and a parados at the back. Theirs is a whole trench
system: a front line, a support line behind it and a reserve line behind that, joined by doglegged
communication trenches. The jungle between their lines is shut in, so the only way back through
them is along the communication trenches. Medics (white helmets with
red crosses) are never shot at, by either side.

**A fixed number of soldiers on each side.** Nobody is replaced and nobody gets back up: they have
35 riflemen (18 in the front line, 10 in support, 7 in reserve) and 5 officers, and we have 50 (18 on the fire step, 32 in reserve kneeling behind the
trench until the whistle). Every man of theirs who falls stays down, so even if you're not a great
shot the battle can always be won in the end. The panel shows how many each side has left.

1. **The big gun.** You start at our field gun at the back. Walk up to it and press **A** (**G**)
   to aim it from a spotter's view: the red ring is where the shell lands. Six shells; they hit the
   soldiers in their trench (not the trees: the lane in front of the gun is already clear) while
   their officers shelter in the dugouts.
2. **The front line.** Go down the lane into our trench and press **A** (**G**) at the parapet to
   climb onto the fire step (again to get down). Their men pop up to shoot and duck back down, and
   so do ours. There's a **sniper rifle** on a rack along the step left of the middle: on the fire
   step, **B** (**V**) is the scope. The **machine gun** on the step to the right takes **A** (**G**).
   Their officers wear **peaked caps with a red band** and only look over now and then.
3. **Gas!** A while after you reach the front line they let off gas, and again every so often. Press
   **X** for your gas mask (and again to take it off). You don't start with one: the fallen
   soldier by the middle gap into our trench has one, with some ammunition.
4. **Pick things up from the fallen**, on both sides: rifle rounds, grenades, sniper rounds, a Lewis
   gun or a gas mask. Walk over it to take it.
5. **The ammo dump**, in the dugout behind the right-hand gap at the back of our trench: a full
   load of rifle rounds, a Lewis gun and grenades (**LB** / **F** / right click to throw).
6. **Over the top.** Once you've stocked up, press **A** (**G**) at a ladder to blow the whistle.
   Our guns put down a barrage on their trench while fifty of our men go over: more of them
   grenade throwers, who get close and lob grenades into their trench, and the rest riflemen, who
   stop and cover them. Then everyone storms in through the breaches in their parapet.
7. **Up the communication trenches.** Once their front line is taken most of our men hold it, and
   a bombing party of about a dozen goes on with you: wherever you go in their trench system,
   they push one step ahead of you (up the next communication trench, into the next line), lobbing
   grenades round the corners. Their support and reserve lines keep their heads down until we come
   over, then come down the communication trenches to meet you. If the party gets thin, more of
   our men come up from the front line to join it.
8. **Their five officers.** Two are in their front line and one in their support line: our men
   fight them too, but officers are tough and go down far quicker to your shots. The other two are
   in dugouts, one off the back of the support line and their headquarters off the back of the
   reserve line, and they're yours alone: our men don't go in. Get all five and the trenches are
   ours.

**No healing.** Health doesn't come back on this level. Get hit too often and the stretcher
bearers carry you back: you wake at the aid post by the big gun and have to make your way to the
front again (after the whistle, over the top from a ladder).

- Code is in `src/trench/` (`TrenchGame` is the level, `Layout` the trenches, communication
  trenches and the routes between them, `Troops` both sides' soldiers, `Gas` the gas cloud, `Figures` the officers and medics).
  The design came from the "new level" meeting notes in Notion.

## Bonus: Under Siege

A second bonus level, in the level select as **7 · Bonus: Under Siege**: the castle mission with
prisoners. This level supports local co-op: both players can fight, rescue prisoners and take part in the jailbreak.

- **Surrender.** Knights who are beaten but not blasted flat often surrender: they drop their
  crossbows, throw their hands up and shout "WE SURRENDER!".
- **Prisoner wagons.** A green wagon, pulled by two army men, drives out to collect any surrendered
  knights it can reach (not ones still inside a castle that's standing), takes up to eight at a
  time, and locks them in the nearer of our two **prisons** (squares with a **P** on the map; the
  wagons are green diamonds).
- **Their prisons.** Two enemy prisons stand by the front-line castles and start with eight of our
  soldiers each; more are added when enemy squads beat ours. The map and the objective panel
  count both.
- **The jailbreak.** Drive to an enemy prison's yard gate and a prompt appears: press **Y** (**C**
  on the keyboard) to get out and go in on foot. The level is saved and the on-foot section
  loads (it is its own page, like the prison break). You're in a castle dungeon courtyard at night
  with jailers who have vision cones. The courtyard is dressed for whoever holds the prison: Welsh (stone roundhouses under thatch, a fire pit, red dragon banners) or German (half-timbered houses, a fountain, black eagle banners). Stand at a cell door to unlock it; the freed soldiers follow
  you. Creep (Shift) past the jailers, or press **X** to put on a **jailer disguise**: they won't
  notice you from a distance, but a jailer who looks you over up close, or sees you run, sees
  through it, and you start again from the gate. You can't disguise while you're being watched,
  and firing a shot drops it. Right behind a jailer, the fire button is a quiet **takedown**.
  Press **R** to go back to the gate. Walk out of the gate to finish.
- **Archer towers and villages.** Every enemy castle on this level has two very tall **archer
  towers** inside the walls, each with archers on top who turn to face you and loose volleys of
  arrows from up to 200 m, all round (they're targets, so knock them down to take the castle).
  Each castle also has a little village along the road in from the gate: cottages, a well and
  market stalls.
- **Garrisons and surrender.** Near a castle the objective panel shows its **garrison**: the knights
  still standing inside its walls and its archer towers still up. Beat them all (down, or
  surrendered) and, after a few quiet seconds, the castle **surrenders**: the white flag goes up
  and it's yours, whatever's still standing in it. A knocked-out cannon's gunners mostly climb
  out with their hands up too. Peasants wander the green in each castle's village; they don't
  fight. On this level the tan army is **Welsh** and the blue army **German**.
- **The Great Castle.** On this level the final castle is modelled on Stirling Castle: a Palace
  with statues in niches, a dormered slate roof and a carved doorway under the Royal Standard
  (the red lion rampant); a Great Hall in "Stirling gold" with crow-stepped gables, buttresses,
  tall windows, a polygonal bay and a stair turret; a Chapel Royal with a belfry; the King's Old
  Building and the Great Kitchens with their tall chimneys; the Elphinstone Tower with its
  corbelled parapet; a Grand Battery of guns each side of the gate; knot gardens; and round
  towers with bartizans and conical slate roofs round the wall and on the Forework gatehouse.
  Mission 3's Great Castle is unchanged.
- **The Royal Dungeon.** The Great Castle has a dungeon of its own, a third enemy prison off to
  one side of its south gate holding 14 of ours. It's sealed until the Great Castle's gates open
  (every other castle taken); then the same prompt appears. The on-foot section there is the
  Stirling Castle courtyard at night: round corner towers and a Forework gate, the Great Hall,
  Chapel Royal and Great Kitchens round the yard, a knot garden, the Elphinstone Tower in the
  middle for cover, and a slate-roofed cell block under the Royal Standard. Freeing them sends a
  wave of 14 to the Great Castle itself once every other castle has fallen, and if they take it
  the level is won.
- **The wave.** Back in the tank, the freed soldiers run for the nearest friendly base with the
  jailers chasing them. Covering their escape is optional. Once they make it they regroup, march
  on the nearest enemy castle, take it themselves, and hold it. A castle they take counts as one
  of the five.

The plan is in `docs/plans/under-siege.md`.

## Bonus: Penicuik

A bonus level in a real town, in the level select as **9 · Bonus: Penicuik** (`?mission=9`). Every
house, garage and block of flats, every street and path, the gardens, woods, playing fields and
car parks are where they really are in Penicuik, Midlothian (from OpenStreetMap), on the real
hill (from elevation data): about 1,500 buildings over a square kilometre and a bit. Houses with a
plain rectangular footprint get a pitched roof (hipped on most detached houses, gabled on terraces
and long semis, as in aerial photos of the estate), windows on each storey, and a front facing the
road (the door goes in the gable end when the road runs past that end) with a driveway to it. Behind
each house is a back garden with a tall wooden fence round it, running back to the next building or
road (they're solid, so the way down is along the streets and paths). The rest are built to their own
outline with a flat roof. As in a drone shot of Sycamore Drive, most walls are white or pale grey
render (with some buff and a few rows of red brick), roofs are blue-grey slate with solar panels on
some south-facing slopes, and garages have low pitched roofs. Street lamps line the pavements and
the path along the old railway line, which has rows of young trees either side. Cars are
parked along the kerbs, and hedges, garden walls and trees make cover. The drainage basins that are
dry most of the time are grass, with a fine texture of grass blades worked into every green part of
the ground. Walls, roofs, fences, hedges and trees carry detail textures too (pebble-dash render or
brick, rows of slates, timber boards, coursed stone, leaves and bark). The streets are laid as their own surfaces over the ground:
speckled asphalt with dashed white lines on the main roads, paving-slab pavements with kerbstones,
tarmac footpaths and gravel tracks.

You start at the top of the hill on your own: your squad has been captured and is held in
four enemy **prisoner pens** (marked on the map), each a short detour of about 80 m off the way
down, one beside each stretch of it. Each is a barred cage on a concrete footing with spiked bars,
X-braces and barbed wire on angled arms along the top, a padlocked gate, and a tin shelter over a
bunk inside; outside there's a watchtower with a ladder and a searchlight trained on the cage, a
plank guard hut, a table and stools by a brazier, sandbags, a lamp and a sign. Stand at a pen's gate for a moment to let the two inside out, and they join your squad.
Freeing them is optional, but the golden marker takes turns: the nearest pen, then the next
roadblock, then a pen again, and so on, then the school. You fight down the
hill to **Mauricewood Primary School**, about 1.1 km away by road and 30 m lower. The way is dotted in gold
on the map. The enemy has five **roadblocks** at junctions on the way down (taking one makes it your
checkpoint). Each is built in layers across the street: a triple coil of barbed wire on pickets
(you can see and shoot through it, not walk through it) with a gap at one side, a staggered row of
concrete barriers with their gap at the other side, a line of sandbags with a gap near the middle,
a sandbagged machine-gun nest whose gunner fires bursts, and behind it all a sentry box with a
raised barrier pole, a floodlight, oil drums, ammo crates and (on wider streets) an army truck, pairs on patrol in the side streets, and ten defenders round the school.
Clear the school, then stand at the flagpole on its playground to raise our flag and win. The school's
buildings aren't on OpenStreetMap (only its grounds are), so they're traced from aerial photos: the
single-storey flat-roofed blocks with their rooflights, the taller hall with its hipped roof, the
playground with its little all-weather pitch, the lawn, the yard and the trees round it (in
`tools/town-map/extras.json`).

You have the rifle, the jam gun and the grenade launcher. The HUD shows the street you're on and
how high above sea level you are. Two players can play: either can raise the flag, and standing next
to a knocked-down partner helps them back up (otherwise it's back to the checkpoint).

- Code is in `src/town/` (`TownGame` is the level, `TownData` loads the map, `TownTerrain` the
  ground and its painted map, `Buildings` the houses, school, trees, hedges, cars and roadblocks,
  `TownMap` the minimap and pause map, `Roads` the road surfaces).
- The map is `public/maps/penicuik.json`, made by `tools/town-map/convert.py` from an Overpass
  API download of OpenStreetMap, AWS Terrain Tiles (zoom 15) and the hand-traced
  `tools/town-map/extras.json`; the script's header has the area and the start and school
  coordinates.

## Level select

Pause, open **Options** and pick a level under **Level select** at the bottom,
then press A or Enter (or click it). It starts that mission from the beginning.
You can also open the game with `?mission=1` up to `?mission=9`. Those numbers are fixed ids, not
the level numbers: 1 is Day to Night, 2 the jungle, 3 the castles, 4 the zombies, 5 the prison
break, 6 Under Siege, 7 the Moon, 8 the trenches and 9 Penicuik. The level numbers come from the order in the
level select.

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
- **[OpenStreetMap](https://www.openstreetmap.org/copyright)**: the streets, houses, gardens and
  woods of the Penicuik level. © OpenStreetMap contributors, Open Database License (ODbL).
- **[Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)** on AWS (Mapzen terrarium):
  the elevation of the Penicuik level, from public sources including SRTM and EU-DEM.
