'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// User-entered mission names for storylines whose ids the bundled dataset can't
// resolve (CoP, Assault). Keyed by character then "<storyline>:<rawValue>", so a
// label only applies while you're on that exact stage; advancing asks for the
// new name. Persists to user-data.
function labelsPath() {
  return path.join(app.getPath('userData'), 'mission_labels.json');
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

function getMissionLabels(character) {
  return load()[character] || {};
}

function setMissionLabel(character, key, name) {
  const data = load();
  if (!data[character]) {
    data[character] = {};
  }
  const trimmed = String(name || '').trim();
  if (trimmed === '') {
    delete data[character][key];
  } else {
    data[character][key] = trimmed;
  }
  save();
  return data[character];
}

module.exports = { getMissionLabels, setMissionLabel };
