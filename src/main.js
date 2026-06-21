'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// Window icon for dev runs (`npm start`). In packaged builds the window
// inherits the icon embedded in the .exe, so this path simply won't exist.
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

const { enrichInventory } = require('./lib/enrich');
const { getPrice, getCachedPrices, setConcurrency } = require('./lib/ffxiah');
const { getLabels, setLabel } = require('./lib/roelabels');
const { getZone, toPercent, mapImageDataUrl, MAPS_DIR } = require('./lib/mapdata');

// Path to the inventory.json written by the Ashita itemscan addon.
// Override with the ITEMSCAN_PATH environment variable if your install differs.
const INVENTORY_PATH = process.env.ITEMSCAN_PATH
  || 'C:\\Ashita4\\addons\\itemscan\\inventory.json';

// position.json is written by the addon beside inventory.json.
const POSITION_PATH = path.join(path.dirname(INVENTORY_PATH), 'position.json');

let mainWindow = null;
let watchDebounce = null;
let lastMapName = null; // so the map image is only re-read on zone change
let lastImageMissing = false; // keep retrying if the PNG wasn't found yet

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

// Reads position.json, resolves zone calibration + dot position, and pushes to
// the renderer. The map image is only re-read (and sent) when the zone changes.
function pushPosition() {
  if (mainWindow === null) {
    return;
  }
  try {
    const pos = JSON.parse(fs.readFileSync(POSITION_PATH, 'utf8'));
    const cal = getZone(pos.zone);
    const payload = { zone: pos.zone, hasCalibration: Boolean(cal), mapsDir: MAPS_DIR };
    if (cal) {
      payload.mapName = cal.mapName;
      payload.dot = toPercent(cal, pos.x, pos.y);
      if (cal.mapName !== lastMapName || lastImageMissing) {
        lastMapName = cal.mapName;
        const img = mapImageDataUrl(cal.mapName);
        lastImageMissing = (img === null); // retry next tick until the file appears
        payload.imageChanged = true;
        payload.image = img; // null if the pack lacks it
      }
    } else {
      lastMapName = null;
    }
    mainWindow.webContents.send('position:update', payload);
  } catch (err) {
    // No position.json yet (map tracking off / not in-game) — ignore.
  }
}

// Watches the addon's output dir for inventory.json. position.json is polled
// instead (below), since fs.watch is unreliable for a file rewritten 4x/sec.
function watchInventory() {
  const dir = path.dirname(INVENTORY_PATH);
  const invBase = path.basename(INVENTORY_PATH);
  try {
    fs.watch(dir, (eventType, filename) => {
      if (filename === invBase) {
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

// Opens (creating if needed) the maps folder so the user can drop the pack in.
ipcMain.handle('map:openFolder', () => {
  try {
    fs.mkdirSync(MAPS_DIR, { recursive: true });
  } catch (err) { /* ignore */ }
  shell.openPath(MAPS_DIR);
  return MAPS_DIR;
});
ipcMain.handle('map:dir', () => MAPS_DIR);

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
  mainWindow.webContents.once('did-finish-load', () => {
    pushInventory();
    pushPosition();
  });
  // Poll position.json ~3x/sec for the live map dot (reliable vs fs.watch).
  setInterval(pushPosition, 300);

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
