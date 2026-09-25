# CooperGame

A Claude Code project to build an army men game for Cooper.

A toy-soldier tank sandbox that runs in the browser. Drive a green plastic tank
around a big open world, flatten the five tan enemy bases, and head back to a
family base to repair. You can't be destroyed, so there's no game over.

Built with [Three.js](https://threejs.org/), [Rapier](https://rapier.rs/) physics,
TypeScript and [Vite](https://vite.dev/). 3D models are from
[Kenney](https://kenney.nl/) (CC0).

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
| Homing rocket (when charged) | LB | F or right click |
| Call a buddy tank (when charged) | X | X |
| Switch first / third person | Y | C |
| Pause and full map | Start | M |
| Return to the nearest family base | Back | R |

## Playing

- There are **5 enemy bases** to destroy. The red arrow on the minimap points to the
  nearest one. Get close and a checklist shows what's left to knock down.
- **Family bases** sit around the edge of the map. Drive inside one to repair.
- **Rear hits** do double damage to enemy tanks. Front armour takes half damage.
- **Buddy tanks** follow you and join the fight. The meter starts full and
  refills over five minutes.
