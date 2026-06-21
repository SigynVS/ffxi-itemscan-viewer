'use strict';

const { vendorPrices, gobbiebag, quests, roeNames } = require('./datasets');

const BASE_INVENTORY = 30;       // Slots before any Gobbiebag quest.
const SLOTS_PER_PART = 5;        // Each completed Gobbiebag quest adds 5.
const PART_ORDER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// Inverts the gobbiebag dataset into { "Gobbiebag IV": ["item", ...] }.
function buildPartItems() {
  const parts = {};
  for (const [name, note] of Object.entries(gobbiebag)) {
    if (!parts[note]) {
      parts[note] = [];
    }
    parts[note].push(name);
  }
  return parts;
}

// Computes per-part Gobbiebag progress. Parts at or below the count implied by
// current inventory size are marked completed; the rest report which of their
// four items you currently hold.
function buildProgress(inventoryMax, ownedCounts) {
  const partItems = buildPartItems();
  const completedParts = inventoryMax
    ? Math.max(0, Math.floor((inventoryMax - BASE_INVENTORY) / SLOTS_PER_PART))
    : 0;

  return PART_ORDER.map((roman, idx) => {
    const label = `Gobbiebag ${roman}`;
    const items = partItems[label] || [];
    const have = items.map((name) => ({ name, count: ownedCounts[name] || 0 }));
    const completed = (idx + 1) <= completedParts;
    const canComplete = !completed && items.length > 0 && have.every((h) => h.count > 0);
    return {
      part: roman,
      label,
      completed,
      canComplete,
      items: have
    };
  });
}

// Turns the raw RoE map { id: progress } into a sorted list with names looked
// up from roe_names.json (falls back to the bare id when no name is bundled).
function buildRoe(roeMap) {
  if (!roeMap || typeof roeMap !== 'object') {
    return [];
  }
  return Object.entries(roeMap)
    .map(([id, progress]) => ({
      id: Number(id),
      progress,
      name: roeNames[id] || null
    }))
    .sort((a, b) => a.id - b.id);
}

function enrichInventory(data) {
  const items = Array.isArray(data.items) ? data.items : [];

  // Sum counts per item name (an item can span multiple containers).
  const ownedCounts = {};
  for (const it of items) {
    ownedCounts[it.name] = (ownedCounts[it.name] || 0) + (it.count || 0);
  }

  // Datasets are keyed by exact in-game item name (verifiable, human-editable).
  // FFXIAH lookups still use it.id, which comes straight from inventory.json.
  const enriched = items.map((it) => {
    const key = it.name;
    const gb = gobbiebag[key] !== undefined ? gobbiebag[key] : null;
    const qs = Array.isArray(quests[key]) ? quests[key] : [];
    return {
      ...it,
      vendorPrice: vendorPrices[key] !== undefined ? vendorPrices[key] : null,
      gobbiebag: gb,
      quests: qs,
      hasUse: gb !== null || qs.length > 0
    };
  });

  return {
    character: data.character || 'Unknown',
    timestamp: data.timestamp || 0,
    inventoryMax: data.inventory_max || 0,
    nation: typeof data.nation === 'number' ? data.nation : null,
    rank: data.rank || null,
    rankPoints: data.rank_points || null,
    roe: buildRoe(data.roe),
    missions: data.missions || {},
    count: enriched.length,
    progress: buildProgress(data.inventory_max || 0, ownedCounts),
    items: enriched
  };
}

module.exports = { enrichInventory };
