'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Window icon for dev runs (`npm start`). In packaged builds the window
// inherits the icon embedded in the .exe, so this path simply won't exist.
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

const { enrichInventory } = require('./lib/enrich');
const { getPrice, getCachedPrices, setConcurrency } = require('./lib/ffxiah');
const { getFame, setFame } = require('./lib/fame');
const { getLabels, setLabel } = require('./lib/roelabels');

// Path to the inventory.json written by the Ashita itemscan addon.
// Override with the ITEMSCAN_PATH environment variable if your install differs.
const INVENTORY_PATH = process.env.ITEMSCAN_PATH
  || 'C:\\Ashita4\\addons\\itemscan\\inventory.json';

let mainWindow = null;
let watchDebounce = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 1000,
    title: 'FFXI Item Scan',
    backgroundColor: '#1a1a1f',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Reads, parses, and enriches inventory.json, then pushes it to the renderer.
async function pushInventory() {
  if (mainWindow === null) {
    return;
  }
  try {
    const raw = fs.readFileSync(INVENTORY_PATH, 'utf8');
    const data = JSON.parse(raw);
    const enriched = enrichInventory(data);
    mainWindow.webContents.send('inventory:update', enriched);
  } catch (err) {
    mainWindow.webContents.send('inventory:error', {
      path: INVENTORY_PATH,
      message: err.message
    });
  }
}

// Watches the inventory file and re-pushes on change (debounced ~250ms,
// since editors/writers often fire multiple events per save).
function watchInventory() {
  const dir = path.dirname(INVENTORY_PATH);
  const base = path.basename(INVENTORY_PATH);
  try {
    fs.watch(dir, (eventType, filename) => {
      if (filename === base) {
        clearTimeout(watchDebounce);
        watchDebounce = setTimeout(pushInventory, 250);
      }
    });
  } catch (err) {
    // Directory may not exist yet; the renderer will show the error state.
  }
}

// Renderer asks for a live FFXIAH price for one item id.
ipcMain.handle('price:fetch', async (_event, itemId) => {
  return getPrice(itemId);
});

// Renderer asks for already-saved prices (no network) to show on startup.
ipcMain.handle('price:cached', (_event, itemIds) => getCachedPrices(itemIds));

// Renderer sets how many price fetches run in parallel.
ipcMain.handle('price:concurrency', (_event, n) => {
  return setConcurrency(n);
});

// RoE labels: per-character user names for objective ids.
ipcMain.handle('roe:labels', (_event, character) => getLabels(character));
ipcMain.handle('roe:setLabel', (_event, { character, id, name }) =>
  setLabel(character, id, name));

// Fame tracker: load levels for a character, and persist edits.
ipcMain.handle('fame:get', (_event, character) => getFame(character));
ipcMain.handle('fame:set', (_event, { character, area, level }) =>
  setFame(character, area, level));

// Opens a URL in the user's default browser. Restricted to the two FFXI
// reference sites so the renderer can't be tricked into opening arbitrary URLs.
ipcMain.handle('open:external', (_event, url) => {
  if (/^https:\/\/(www\.)?(bg-wiki\.com|ffxiah\.com)\//i.test(url)) {
    shell.openExternal(url);
  }
});

app.whenReady().then(() => {
  createWindow();
  watchInventory();
  // Initial load once the window is ready to receive it.
  mainWindow.webContents.once('did-finish-load', pushInventory);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
