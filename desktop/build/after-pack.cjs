// Puts a launch script in front of the Electron binary, for SteamOS Game Mode. There, gamescope
// advertises a Wayland display that Electron picks by default but gamescope only shows X11
// (XWayland) windows, so the game never appeared. Under gamescope it forces X11. When Steam
// launched the game it also drops Chromium's sandbox, which can fail inside Steam's process
// wrappers. Both are read before main.cjs runs, so they must be on the real command line.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const name = context.packager.executableName;
  const binary = path.join(context.appOutDir, name);
  fs.renameSync(binary, `${binary}.bin`);
  fs.writeFileSync(
    binary,
    `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
if [ -n "$GAMESCOPE_WAYLAND_DISPLAY" ] || [ "$XDG_CURRENT_DESKTOP" = gamescope ]; then
  set -- --ozone-platform=x11 "$@"
fi
if [ -n "$SteamAppId$SteamGameId$SteamClientLaunch" ]; then
  set -- --no-sandbox --disable-gpu-sandbox "$@"
fi
exec "$HERE/${name}.bin" "$@"
`,
    { mode: 0o755 },
  );
};
