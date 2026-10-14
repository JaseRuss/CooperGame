// Desktop wrapper: runs the built web game (dist/, copied to ./app) in its own Chromium window.
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
  win.loadURL('app://game/index.html');
});

app.on('window-all-closed', () => app.quit());
