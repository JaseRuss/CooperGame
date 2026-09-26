# CooperGame

A Claude Code project to build an army men game for Cooper.

A toy-soldier tank sandbox that runs in the browser. Drive a green plastic tank
around a big open world, flatten the five tan enemy bases, and head back to a
family base to repair. You can't be destroyed, so there's no game over.

Built with [Three.js](https://threejs.org/), [Rapier](https://rapier.rs/) physics,
TypeScript and [Vite](https://vite.dev/). 3D models are from
[Kenney](https://kenney.nl/) (CC0).

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
| Drive | Left stick | W A S D or arrow keys |
| Aim turret | Right stick | Mouse |
| Fire | RT or A | Left click or Space |
| Jam cannon (hold, short range) | LT | E |
| Mega jam: jam all round the tank (when charged) | X | X |
| Homing rocket (when charged) | LB | F or right click |
| AA missiles (with a helicopter locked) | RB | Q |
| Switch first / third person | Y | C |
| Pause, full map and options | Start | M |
| Return to the nearest family base | Back | R |

Driving works like the Warthog in Halo by default: push the stick the way you
want to go relative to the camera. Pull back to reverse. Let go and the tank
turns to face where you're aiming. Prefer the old way? Pause, open **Options**
(X or O) and switch **Tank controls** to **Classic**. Options also has aim speed,
buddy name tags and the **buddy names**: pick a buddy and press A or Enter, then
type a new name, or on a controller use up and down to pick each letter, left
and right to move, and X to delete. Your choices are remembered.

## Playing

- **Who's who:** green (you and your buddies) and **red** are friendly; **tan**
  and **blue** are the enemy.
- There are **5 enemy bases** to destroy, held by the **tan** and **blue**
  armies. The red arrow on the minimap points to the nearest one. Get close and
  a checklist shows what's left to knock down.
- Once a base falls, **green troops and bunkers** move in and fight anything
  nearby.
- **The Fortress** in the middle of the map is locked until all five enemy
  bases are down, and nothing inside can be shot until then. Then its gates
  open and a column of green and red tanks and troops joins you for the final
  assault. Flatten it to win.
- **Enemy helicopters** patrol the open country and circle in to attack. Raise
  your gun: one direct shell hit brings one down. Or aim roughly at one until
  **HELI LOCKED** shows by the crosshair and fire a salvo of wobbly
  **AA missiles** (RB / Q). They only seek a little, so aim well; two darts
  bursting close will do it. You carry 12, six per salvo; when they run out,
  drive back to a family base to rearm. Helicopters show as pink markers on the
  maps.
- The **red army** is on your side. Their tanks and soldiers guard every town.
- **Family bases** sit around the edge of the map. Drive inside one to repair
  and restock your AA missiles.
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
- Drive into trees and lamp posts to knock them flat.
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
- **Buddy tanks** (Keston, Max, Innes and Jason, unless you rename them) follow
  you and join the fight. One rolls in by themselves whenever the buddy meter
  fills (it starts full and refills over five minutes), up to all four at once.
- Hit a building and a health bar pops up over it for a few seconds.
- The pause map shows where the enemy is gathered as a red glow.

## Mission 2: Night Raid

Win the first mission and the night raid starts on its own: a new battlefield
under the stars. Every enemy base has a flak gun hosing tracer into the sky, so
you can see where the bases are from across the map. Knocking out the flak gun
is one of the base's targets. Flares go up over troops in the distance: red over
the enemy, green over your side. Your tank has a headlight. To jump between
missions at any time, pause and change **Mission** at the bottom of **Options**
(it starts that mission from the beginning), or open the game with `?mission=2`.
