'use strict';

const fs = require('fs');

const { famePath } = require('./paths');

// The trackable fame areas. Fame is per-area in FFXI; quest unlocks cap at
// level 6, above which only NPC buy/sell prices keep improving.
const FAME_AREAS = [
  "San d'Oria",
  'Bastok',
  'Windurst',
  'Jeuno',
  'Selbina / Mhaura',
  'Kazham',
  'Norg',
  'Rabao',
  'Aht Urhgan (Whitegate)',
  'Western Adoulin'
];

let store = null;

function load() {
  if (store !== null) {
    return store;
  }
  try {
    store = JSON.parse(fs.readFileSync(famePath(), 'utf8'));
  } catch (err) {
    store = {};
  }
  return store;
}

function save() {
  try {
    fs.writeFileSync(famePath(), JSON.stringify(store, null, 2));
  } catch (err) {
    // Non-fatal: failing to persist just loses the latest edit.
  }
}

// Returns { areas, levels } for a character. levels maps area -> 0..9.
function getFame(character) {
  const data = load();
  return { areas: FAME_AREAS, levels: data[character] || {} };
}

// Records one area's fame level for a character and persists it.
function setFame(character, area, level) {
  const data = load();
  if (!data[character]) {
    data[character] = {};
  }
  data[character][area] = Math.max(0, Math.min(9, Math.floor(level) || 0));
  save();
  return data[character];
}

module.exports = { getFame, setFame, FAME_AREAS };
