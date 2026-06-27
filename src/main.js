'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const {
  auditLog,
  checkFileSize,
  validateInventoryJson,
  validateAddonPath,
  validateItemId,
  validateItemIds,
  validateConcurrency,
  validateCharacter,
  validateLabelKey,
  validateLabelName,
  validateAddonConfig
} = require('./lib/security');

// Window icon for dev runs (`npm start`). In packaged builds the window
// inherits the icon embedded in the .exe, so this path simply won't exist.
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

const { enrichInventory } = require('./lib/enrich');
const { fetchAmbuscadeData } = require('./lib/ambuscade-fetch');
const { getPrice, getCachedPrices, setConcurrency } = require('./lib/ffxiah');
const { getLabels, setLabel } = require('./lib/roelabels');
const { getMissionLabels, setMissionLabel } = require('./lib/missionlabels');
const { getZoneMap, toPercent, mapImageDataUrl, MAPS_DIR } = require('./lib/mapdata');
const feedbackCfg = (() => { try { return require('./lib/feedback.config'); } catch { return { webhookUrl: null }; } })();

// Persisted app settings (the configurable Ashita addon folder, etc.).
function settingsPath() { return path.join(app.getPath('userData'), 'app_settings.json'); }
function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const s = JSON.parse(raw);
    // Validate the stored addonDir before trusting it
    if (s.addonDir !== undefined) {
      try { s.addonDir = validateAddonPath(s.addonDir); }
      catch (err) {
        auditLog('SETTINGS_INVALID', `bad addonDir in settings: ${err.message}`);
        delete s.addonDir;
      }
    }
    return s;
  } catch (err) { return {}; }
}
function saveSettings(s) {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (err) { /* ignore */ }
}

// The folder where the itemscan addon writes inventory.json / position.json /
// itemscan_config.json. Configurable so the app works wherever Ashita lives.
function defaultAddonDir() {
  if (process.env.ITEMSCAN_PATH) { return path.dirname(process.env.ITEMSCAN_PATH); }
  const candidates = [
    'C:\\Ashita4\\addons\\itemscan',
    'C:\\Ashita\\addons\\itemscan',
    'D:\\Ashita4\\addons\\itemscan'
  ];
  for (const c of candidates) { if (fs.existsSync(c)) { return c; } }
  return candidates[0];
}

let addonDir = loadSettings().addonDir || defaultAddonDir();
let INVENTORY_PATH, POSITION_PATH, ADDON_CONFIG_PATH;
function updatePaths() {
  INVENTORY_PATH = path.join(addonDir, 'inventory.json');
  POSITION_PATH = path.join(addonDir, 'position.json');
  ADDON_CONFIG_PATH = path.join(addonDir, 'itemscan_config.json');
}
updatePaths();

let mainWindow = null;
let liveAmbuscade = null; // cached from bg-wiki, refreshed on launch
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
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // if (!app.isPackaged) mainWindow.webContents.openDevTools();
}

// Reads, parses, and enriches inventory.json, then pushes it to the renderer.
async function pushInventory() {
  if (mainWindow === null) {
    return;
  }
  try {
    checkFileSize(INVENTORY_PATH);
    const raw = fs.readFileSync(INVENTORY_PATH, 'utf8');
    const data = validateInventoryJson(raw);
    const enriched = enrichInventory(data, liveAmbuscade);
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
    const m = getZoneMap(pos.zone, pos);
    const payload = { zone: pos.zone, hasCalibration: Boolean(m), mapsDir: MAPS_DIR };
    if (m) {
      payload.mapName = m.file;
      payload.dot = toPercent(m, pos.x, pos.y);
      if (m.file !== lastMapName || lastImageMissing) {
        lastMapName = m.file;
        const img = mapImageDataUrl(m.file);
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
let dirWatcher = null;
function watchInventory() {
  if (dirWatcher) {
    try { dirWatcher.close(); } catch (err) { /* ignore */ }
    dirWatcher = null;
  }
  const dir = path.dirname(INVENTORY_PATH);
  const invBase = path.basename(INVENTORY_PATH);
  try {
    dirWatcher = fs.watch(dir, (eventType, filename) => {
      if (filename === invBase) {
        clearTimeout(watchDebounce);
        watchDebounce = setTimeout(pushInventory, 250);
      }
    });
  } catch (err) {
    // Directory may not exist yet; the renderer will show the error state.
  }
}

// Re-points the app at a new Ashita addon folder, persists it, and re-watches.
function setAddonDir(dir) {
  addonDir = dir;
  updatePaths();
  const s = loadSettings();
  s.addonDir = dir;
  saveSettings(s);
  lastMapName = null;
  lastImageMissing = false;
  watchInventory();
  pushInventory();
  pushPosition();
}

// Renderer asks for a live FFXIAH price for one item id.
ipcMain.handle('price:fetch', async (_event, itemId) => {
  return getPrice(validateItemId(itemId));
});

// Renderer asks for already-saved prices (no network) to show on startup.
ipcMain.handle('price:cached', (_event, itemIds) => getCachedPrices(validateItemIds(itemIds)));

// Renderer sets how many price fetches run in parallel.
ipcMain.handle('price:concurrency', (_event, n) => {
  return setConcurrency(validateConcurrency(n));
});

// RoE labels: per-character user names for objective ids.
ipcMain.handle('roe:labels', (_event, character) => getLabels(validateCharacter(character)));
ipcMain.handle('roe:setLabel', (_event, { character, id, name }) =>
  setLabel(validateCharacter(character), validateLabelKey(String(id)), validateLabelName(name)));

// Mission labels: per-character user names for unresolved mission stages.
ipcMain.handle('mission:labels', (_event, character) => getMissionLabels(validateCharacter(character)));
ipcMain.handle('mission:setLabel', (_event, { character, key, name }) =>
  setMissionLabel(validateCharacter(character), validateLabelKey(key), validateLabelName(name)));

// Opens (creating if needed) the maps folder so the user can drop the pack in.
ipcMain.handle('map:openFolder', () => {
  try {
    fs.mkdirSync(MAPS_DIR, { recursive: true });
  } catch (err) { /* ignore */ }
  shell.openPath(MAPS_DIR);
  return MAPS_DIR;
});
ipcMain.handle('map:dir', () => MAPS_DIR);

// Addon control: read/write itemscan_config.json (auto-scan, map tracking).
ipcMain.handle('addon:getConfig', () => {
  try {
    return JSON.parse(fs.readFileSync(ADDON_CONFIG_PATH, 'utf8'));
  } catch (err) {
    return { auto: false, maptrack: false };
  }
});
ipcMain.handle('addon:setConfig', (_event, cfg) => {
  try {
    fs.writeFileSync(ADDON_CONFIG_PATH, JSON.stringify(validateAddonConfig(cfg)));
    return true;
  } catch (err) {
    auditLog('CONFIG_WRITE_ERROR', err.message);
    return false;
  }
});

// Config tab: paths for display.
ipcMain.handle('config:info', () => ({
  inventoryPath: INVENTORY_PATH,
  addonDir: addonDir,
  mapsDir: MAPS_DIR,
  userData: app.getPath('userData')
}));

// Configurable Ashita addon folder.
ipcMain.handle('config:browseAddonDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your Ashita itemscan addon folder',
    defaultPath: addonDir,
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths.length) { return addonDir; }
  try {
    setAddonDir(validateAddonPath(res.filePaths[0]));
  } catch (err) {
    auditLog('PATH_REJECTED', err.message);
  }
  return addonDir;
});

// Writes reload_flag.txt to the addon folder; the Lua addon polls this every ~2s
// and queues /addon reload itemscan, then auto-scans on load.
ipcMain.handle('addon:reload', () => {
  try {
    fs.writeFileSync(path.join(addonDir, 'reload_flag.txt'), '1', 'utf8');
    auditLog('ADDON_RELOAD', 'reload_flag.txt written');
    return true;
  } catch (err) {
    auditLog('ADDON_RELOAD_FAIL', err.message);
    return false;
  }
});

// Sends feedback to Discord via webhook. Webhook URL lives in gitignored feedback.config.js.
ipcMain.handle('feedback:send', async (_event, { type, title, description, framework }) => {
  if (!feedbackCfg.webhookUrl) return { ok: false, error: 'No webhook configured' };
  const colors = { Bug: 15548997, Feature: 5793266, Other: 10066613 };
  const body = {
    thread_name: `[${type}] ${String(title).slice(0, 100)}`,
    embeds: [{
      title: `[${type}] ${String(title).slice(0, 100)}`,
      description: String(description).slice(0, 1800) || '(no description)',
      color: colors[type] || 10066613,
      fields: [
        { name: 'Type',        value: String(type),      inline: true },
        { name: 'Framework',   value: String(framework), inline: true },
        { name: 'App Version', value: app.getVersion(),  inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  };
  try {
    const res = await fetch(feedbackCfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    auditLog('FEEDBACK_SENT', `type=${type} ok=${res.ok}`);
    return { ok: res.ok };
  } catch (err) {
    auditLog('FEEDBACK_FAIL', err.message);
    return { ok: false, error: err.message };
  }
});

// Opens a URL in the user's default browser. Restricted to the two FFXI
// reference sites so the renderer can't be tricked into opening arbitrary URLs.
ipcMain.handle('open:external', (_event, url) => {
  if (/^https:\/\/(www\.)?(bg-wiki\.com|ffxiah\.com)\//i.test(url)) {
    shell.openExternal(url);
  }
});

app.whenReady().then(() => {
  auditLog('APP_START', `v${app.getVersion()} pid=${process.pid}`);
  createWindow();
  watchInventory();
  // Push as soon as the window is ready (liveAmbuscade may still be null here).
  mainWindow.webContents.once('did-finish-load', () => {
    pushInventory();
    pushPosition();
  });
  // Fetch live Ambuscade data in parallel; re-push when it arrives.
  fetchAmbuscadeData().then((data) => {
    liveAmbuscade = data;
    if (mainWindow) pushInventory();
  }).catch(() => {});
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
