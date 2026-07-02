'use strict';

const fs   = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

// Lazy-loaded static item database. Generated once in-game via
// /itemscan dumpresources and bundled with the app as data/items.json.
// Keys are item IDs as strings; values are { name, desc }.
let _db = null;
function db() {
  if (!_db) {
    try {
      _db = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'items.json'), 'utf8'));
    } catch (e) {
      _db = {};
    }
  }
  return _db;
}

function getItemName(id) {
  const entry = db()[String(id)];
  return entry ? entry.name : `Unknown (${id})`;
}

function getItemDesc(id) {
  const entry = db()[String(id)];
  return entry ? entry.desc : '';
}

// Raw item flag bits (LandSandBoat ItemFlag enum), 0 when unknown. Present in
// items.json only for items that have flags set; older dumps without the field
// return 0 so the app degrades gracefully (no badges, nothing excluded).
function getItemFlags(id) {
  const entry = db()[String(id)];
  return (entry && typeof entry.flags === 'number') ? entry.flags : 0;
}

module.exports = { getItemName, getItemDesc, getItemFlags };
