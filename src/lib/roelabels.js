'use strict';

const fs = require('fs');
const path = require('path');

const { app } = require('electron');

// User-entered RoE objective labels, keyed by character then objective id.
// These override the bundled roe_names.json so a player can name the objectives
// they care about (read from the in-game RoE menu). Persists to user-data.
function labelsPath() {
  return path.join(app.getPath('userData'), 'roe_labels.json');
}

let store = null;

function load() {
  if (store !== null) {
    return store;
  }
  try {
    store = JSON.parse(fs.readFileSync(labelsPath(), 'utf8'));
  } catch (err) {
    store = {};
  }
  return store;
}

function save() {
  try {
    fs.writeFileSync(labelsPath(), JSON.stringify(store, null, 2));
  } catch (err) {
    // Non-fatal: a failed write just loses the latest label edit.
  }
}

function getLabels(character) {
  return load()[character] || {};
}

function setLabel(character, id, name) {
  const data = load();
  if (!data[character]) {
    data[character] = {};
  }
  const trimmed = String(name || '').trim();
  if (trimmed === '') {
    delete data[character][id];
  } else {
    data[character][id] = trimmed;
  }
  save();
  return data[character];
}

module.exports = { getLabels, setLabel };
