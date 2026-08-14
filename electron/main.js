/**
 * The desktop app.
 *
 * There is no server and no account. The window talks to SQLite through the
 * handlers below, which are the same functions the Express routes used to
 * call — the transport changed, the validation did not.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, dbPath, libraryDir } from './db.js';
import { scanFolder } from './library.js';
import { isNewer } from './version.js';
import * as repo from './repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** Vite's dev server when running `npm run desktop`, the built files otherwise. */
const devServer = process.env.VITE_DEV_SERVER_URL ?? null;

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'djtree',
    // The traffic lights sit over the app's own toolbar rather than a grey bar.
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111111',
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Painting only once the app has rendered avoids a white flash on dark mode.
  win.once('ready-to-show', () => win.show());

  if (devServer) {
    win.loadURL(devServer);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(root, 'dist', 'index.html'));
  }

  // Anything that isn't the app itself opens in the real browser, not in here.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ---------------------------------------------------------------- updates */

const RELEASES_API = 'https://api.github.com/repos/eggshaan/djtree/releases/latest';

/**
 * Asks GitHub what the newest release is.
 *
 * This is the only network call djtree ever makes, and it only happens when
 * you pick the menu item — nothing checks on launch, on a timer, or in the
 * background. That keeps "this app does not talk to anything" true for anyone
 * who never clicks it.
 */
async function checkForUpdates() {
  const current = app.getVersion();
  let latest;
  let url;

  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `djtree/${current}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const body = await res.json();
    latest = String(body.tag_name ?? '').replace(/^v/, '');
    url = body.html_url;
    if (!latest) throw new Error('no version in the response');
  } catch (err) {
    await dialog.showMessageBox(win ?? undefined, {
      type: 'warning',
      message: "Couldn't check for updates",
      detail: `${err?.message ?? err}\n\nYou are running ${current}.`,
      buttons: ['OK'],
    });
    return;
  }

  if (!isNewer(latest, current)) {
    await dialog.showMessageBox(win ?? undefined, {
      type: 'info',
      message: `djtree ${current} is up to date`,
      detail: 'Nothing newer has been released.',
      buttons: ['OK'],
    });
    return;
  }

  // No silent install: updating a build with no Developer ID signature means
  // downloading the disk image and dragging it over, same as the first time.
  const { response } = await dialog.showMessageBox(win ?? undefined, {
    type: 'info',
    message: `djtree ${latest} is available`,
    detail: `You have ${current}. Opening the release page — download the .dmg and drag it `
      + 'over your copy in Applications, then clear the quarantine flag again:\n\n'
      + 'xattr -dr com.apple.quarantine /Applications/djtree.app',
    buttons: ['Open Release Page', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0 && url) shell.openExternal(url);
}

/* ------------------------------------------------------------------ menu */

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => { void checkForUpdates(); } },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Music Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win?.webContents.send('djtree:menu', 'import'),
        },
        { type: 'separator' },
        {
          label: 'Show Library Folder in Finder',
          click: () => shell.showItemInFolder(dbPath),
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------- ipc */

/**
 * Every call the renderer can make. Errors are re-thrown with a clean message
 * so the toast shows "bpm must be a number between 20 and 400" rather than
 * Electron's wrapped "Error invoking remote method" noise.
 */
const handlers = {
  graph: () => repo.graph(),
  createTrack: (draft) => repo.createTrack(draft),
  updateTrack: (id, patch) => repo.updateTrack(id, patch),
  savePositions: (positions) => repo.savePositions(positions),
  deleteTrack: (id) => repo.deleteTrack(id),
  createTransition: (from, to, details) => repo.createTransition(from, to, details),
  updateTransition: (id, patch) => repo.updateTransition(id, patch),
  deleteTransition: (id) => repo.deleteTransition(id),
  createSetlist: (name, ids, notes) => repo.createSetlist(name, ids, notes),
  updateSetlist: (id, patch) => repo.updateSetlist(id, patch),
  deleteSetlist: (id) => repo.deleteSetlist(id),
  saveSetlistPositions: (id, positions) => repo.saveSetlistPositions(id, positions),
  resetSetlistPositions: (id) => repo.resetSetlistPositions(id),
  restore: (tracks, transitions, setlists) => repo.restore(tracks, transitions, setlists),
  importTracks: (rows) => repo.importTracks(rows),

  /** Native folder picker, then a tag read of everything inside it. */
  chooseFolder: async () => {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Add music',
      message: 'Pick a folder of audio files',
      properties: ['openDirectory', 'multiSelections'],
      buttonLabel: 'Scan',
    });
    if (picked.canceled || !picked.filePaths.length) return null;

    const scans = await Promise.all(picked.filePaths.map(scanFolder));
    return {
      folders: picked.filePaths,
      rows: scans.flatMap((s) => s.rows),
      scanned: scans.reduce((n, s) => n + s.scanned, 0),
      unreadable: scans.flatMap((s) => s.unreadable),
    };
  },

  revealLibrary: () => {
    shell.showItemInFolder(dbPath);
    return { ok: true };
  },

  paths: () => ({ libraryDir, dbPath }),
};

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(`djtree:${name}`, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      throw new Error(err?.message ?? String(err));
    }
  });
}

/* ------------------------------------------------------------- lifecycle */

app.whenReady().then(() => {
  // The packaged app takes its icon from the bundle. A dev run is just the
  // Electron binary, so it has to be handed the artwork explicitly or the Dock
  // shows Electron's own logo.
  if (devServer) app.dock?.setIcon(join(root, 'build', 'icon.png'));

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// A Mac app normally survives its last window; this one has nothing to do
// without a window, and leaving it running would hold the database open.
app.on('window-all-closed', () => app.quit());

app.on('before-quit', closeDb);
