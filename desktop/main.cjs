// Desktop wrapper: runs the live web game (GitHub Pages) in its own Chromium window, so every
// push to main reaches the desktop app without a new download. With no connection it falls back
// to the copy of dist/ bundled in ./app. Settings and saves are kept separately for each copy.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, net, protocol, shell } = require('electron');

// Play sound straight away; a browser would wait for a click or key press.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Serve the game from app:// rather than file://, so fetch() of models and sounds works and
// localStorage (settings, siege saves) has a stable origin.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const root = path.join(__dirname, 'app');
const LIVE_URL = 'https://jaseruss.github.io/CooperGame/';
const BUNDLED_URL = 'app://game/index.html';

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: !process.argv.includes('--windowed'),
    autoHideMenuBar: true,
    backgroundColor: '#0a0e14',
    title: "Cooper's Tank Army",
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.removeMenu();
  // Links (e.g. credits) open in the system browser, not inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  // Offline, or the site is unreachable: load the bundled copy, keeping the mission in the query.
  win.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !url.startsWith(LIVE_URL)) return; // -3: aborted by a newer load
    win.loadURL(BUNDLED_URL + new URL(url).search);
  });
  win.loadURL(process.argv.includes('--offline') ? BUNDLED_URL : LIVE_URL);
});

app.on('window-all-closed', () => app.quit());
