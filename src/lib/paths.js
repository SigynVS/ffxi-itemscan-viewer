'use strict';

const path = require('path');
const { app } = require('electron');

// Read-only bundled datasets. When packaged they live under resources/data
// (declared as extraResources); in dev they sit in the repo's data/ folder.
const DATA_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'data')
  : path.join(__dirname, '..', '..', 'data');

// The price cache must be writable. A packaged app's install dir may be
// read-only, so always cache under the per-user app-data folder.
function cachePath() {
  return path.join(app.getPath('userData'), 'price_cache.json');
}

// Manually-entered fame levels, keyed by character then area. Writable, so it
// lives under per-user app-data alongside the price cache.
function famePath() {
  return path.join(app.getPath('userData'), 'fame.json');
}

module.exports = { DATA_DIR, cachePath, famePath };
