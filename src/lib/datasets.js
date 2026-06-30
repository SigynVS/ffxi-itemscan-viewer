'use strict';

const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('./paths');

// Loads a JSON dataset, returning {} on any failure so the app never crashes
// just because a dataset is missing or being edited.
function loadJson(name) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

// Vendor prices: { "<itemId>": <gilPrice> }
const vendorPrices = loadJson('vendor_prices.json');

// Gobbiebag: { "<itemId>": "<note>" } - items accepted by Gobbie quests.
const gobbiebag = loadJson('gobbiebag.json');

// Quest turn-ins: { "<itemId>": ["Quest A", "Mission B"] }
const quests = loadJson('quests.json');

// Records of Eminence: { "<objectiveId>": "<objective name>" }
const roeNames = loadJson('roe_names.json');

// Active-quest names by area: { "<area>": { "<questId>": "<name>" } }
const questNames = loadJson('quest_names.json');

// Mission names by storyline: { "<storyline>": { "<rawValue>": "<name>" } }
const missionNames = loadJson('mission_names.json');

// Ambuscade dataset: current mount/bosses and key item => mob targets.
const ambuscade = loadJson('ambuscade.json');

module.exports = { vendorPrices, gobbiebag, quests, roeNames, questNames, missionNames, ambuscade };
