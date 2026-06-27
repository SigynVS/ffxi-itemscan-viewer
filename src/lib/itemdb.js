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

module.exports = { getItemName, getItemDesc };
