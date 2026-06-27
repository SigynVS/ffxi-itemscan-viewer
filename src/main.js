'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const net = require('net');
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
const PORT = 51234;

let INVENTORY_PATH, ADDON_CONFIG_PATH;
function updatePaths() {
  INVENTORY_PATH = path.join(addonDir, 'inventory.json');
  ADDON_CONFIG_PATH = path.join(addonDir, 'itemscan_config.json');
}
updatePaths();

let mainWindow = null;
let liveAmbuscade = null;
let lastMapName = null;
let lastImageMissing = false;

// Per-character state. Each multibox instance connects as a separate socket.
const characterRaw  = new Map(); // charName → validated inventory object (for re-enrichment)
const characterData = new Map(); // charName → enriched inventory object
const charPositions = new Map(); // charName → last position object
const sockToChar    = new Map(); // socket → charName
let   activeChar    = null;

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

function pushCharList() {
  if (mainWindow) mainWindow.webContents.send('characters:update', {
    list: [...characterData.keys()],
    active: activeChar,
  });
}

function pushActiveInventory() {
  if (!mainWindow) return;
  if (!activeChar || !characterData.has(activeChar)) {
    mainWindow.webContents.send('inventory:error', { path: '', message: 'Waiting for addon to connect…' });
    return;
  }
  mainWindow.webContents.send('inventory:update', characterData.get(activeChar));
}

function pushActivePosition() {
  if (!activeChar) return;
  const pos = charPositions.get(activeChar);
  if (pos) pushPosition(pos);
}

// Resolves zone calibration + dot position from a pos object and pushes to
// the renderer. Called by the TCP server when the Lua addon sends a position update.
function pushPosition(pos) {
  if (mainWindow === null || !pos) return;
  try {
    const m = getZoneMap(pos.zone, pos);
    const payload = { zone: pos.zone, hasCalibration: Boolean(m), mapsDir: MAPS_DIR };
    if (m) {
      payload.mapName = m.file;
      payload.dot = toPercent(m, pos.x, pos.y);
      if (m.file !== lastMapName || lastImageMissing) {
        lastMapName = m.file;
        const img = mapImageDataUrl(m.file);
        lastImageMissing = (img === null);
        payload.imageChanged = true;
        payload.image = img;
      }
    } else {
      lastMapName = null;
    }
    mainWindow.webContents.send('position:update', payload);
  } catch (err) { /* ignore malformed position data */ }
}

// Re-points the app at a new addon folder and persists it.
function setAddonDir(dir) {
  addonDir = dir;
  updatePaths();
  const s = loadSettings();
  s.addonDir = dir;
  saveSettings(s);
  lastMapName = null;
  lastImageMissing = false;
}

// TCP server that receives data from the Lua addon over a localhost socket.
// Protocol: single-char type prefix + raw JSON + newline.
//   I{...}\n  — inventory payload (same schema as inventory.json)
//   P{...}\n  — position payload { zone, x, y, z, heading }
function startTcpServer() {
  const server = net.createServer((sock) => {
    auditLog('LUA_CONNECT', `${sock.remoteAddress}:${sock.remotePort}`);
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const type = line[0];
        const payload = line.slice(1);
        if (type === 'I') {
          try {
            const validated = validateInventoryJson(payload);
            const enriched = enrichInventory(validated, liveAmbuscade);
            const charName = validated.character || 'Unknown';
            characterRaw.set(charName, validated);
            characterData.set(charName, enriched);
            sockToChar.set(sock, charName);
            if (!activeChar) activeChar = charName;
            auditLog('INVENTORY_RECV', `char=${charName} items=${validated.items ? validated.items.length : '?'}`);
            pushCharList();
            if (mainWindow && charName === activeChar) mainWindow.webContents.send('inventory:update', enriched);
          } catch (err) {
            auditLog('INVENTORY_ERR', err.message);
            if (mainWindow) mainWindow.webContents.send('inventory:error', { path: 'socket', message: err.message });
          }
        } else if (type === 'P') {
          try {
            const pos = JSON.parse(payload);
            // Use character name from payload so position works before first inventory scan.
            const charName = pos.character || sockToChar.get(sock);
            if (charName) {
              if (!sockToChar.has(sock)) sockToChar.set(sock, charName);
              charPositions.set(charName, pos);
              if (charName === activeChar) pushPosition(pos);
            }
          } catch (e) { /* ignore */ }
        }
      }
    });
    sock.on('close', () => {
      const charName = sockToChar.get(sock);
      sockToChar.delete(sock);
      if (charName) {
        characterRaw.delete(charName);
        characterData.delete(charName);
        charPositions.delete(charName);
        if (activeChar === charName) {
          activeChar = characterData.size > 0 ? [...characterData.keys()][0] : null;
        }
      }
      auditLog('LUA_DISCONNECT', charName || '');
      pushCharList();
      if (mainWindow) {
        if (activeChar) {
          pushActiveInventory();
          pushActivePosition();
        } else {
          mainWindow.webContents.send('inventory:error', { path: '', message: 'Waiting for addon to connect…' });
        }
      }
    });
    sock.on('error', () => {});
  });
  server.listen(PORT, '127.0.0.1', () => {
    auditLog('TCP_SERVER', `listening on 127.0.0.1:${PORT}`);
  });
  server.on('error', (err) => auditLog('TCP_SERVER_ERR', err.message));
}

// Switches the active character and pushes their data to the renderer.
ipcMain.handle('character:select', (_event, charName) => {
  if (!characterData.has(charName)) return activeChar;
  activeChar = charName;
  pushActiveInventory();
  pushActivePosition();
  pushCharList();
  return activeChar;
});

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
  startTcpServer();
  mainWindow.webContents.once('did-finish-load', () => {
    pushActiveInventory(); // shows "waiting for addon" until socket connects
  });
  fetchAmbuscadeData().then((data) => {
    liveAmbuscade = data;
    // Re-enrich any characters already connected when ambuscade data arrives.
    for (const [charName, raw] of characterRaw) {
      characterData.set(charName, enrichInventory(raw, liveAmbuscade));
    }
    pushActiveInventory();
  }).catch(() => {});

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
