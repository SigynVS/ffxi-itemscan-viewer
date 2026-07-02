'use strict';

const path = require('path');
const { app } = require('electron');

// Read-only bundled datasets. When packaged they live under resources/data
// (declared as extraResources); in dev they sit in the repo's data/ folder.
const DATA_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'data')
  : path.join(__dirname, '..', '..', 'data');

// Bundled Ashita addon source (itemscan.lua, slips.lua), used by the
// one-click installer. Same dev-vs-packaged split as DATA_DIR.
const ADDON_SRC_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'addon')
  : path.join(__dirname, '..', '..', 'addon');

// The price cache must be writable. A packaged app's install dir may be
// read-only, so always cache under the per-user app-data folder.
function cachePath() {
  return path.join(app.getPath('userData'), 'price_cache.json');
}

module.exports = { DATA_DIR, ADDON_SRC_DIR, cachePath };
