'use strict';

const { vendorPrices, gobbiebag, quests, roeNames, questNames, missionNames, ambuscade } = require('./datasets');

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

// Builds the RoE list with names looked up from roe_names.json. The addon now
// sends an ordered array (packet slot order, which may match the in-game menu);
// an older object form { id: progress } is still accepted for compatibility.
function buildRoe(roe) {
  if (Array.isArray(roe)) {
    return roe.map((o) => ({
      id: o.id,
      progress: o.progress,
      name: roeNames[String(o.id)] || null
    }));
  }
  if (roe && typeof roe === 'object') {
    return Object.entries(roe)
      .map(([id, progress]) => ({ id: Number(id), progress, name: roeNames[id] || null }))
      .sort((a, b) => a.id - b.id);
  }
  return [];
}

// An active quest = a bit set in the area's "current" block but NOT in its
// "completed" block. Names come from the bundled quest_names.json per area.
function buildActiveQuests(questData) {
  if (!questData || typeof questData !== 'object') {
    return [];
  }
  const result = [];
  for (const [area, blocks] of Object.entries(questData)) {
    const completed = new Set(blocks.completed || []);
    const names = questNames[area] || {};
    for (const id of (blocks.current || [])) {
      if (!completed.has(id)) {
        result.push({ area, id, name: names[String(id)] || null });
      }
    }
  }
  return result.sort((a, b) => a.area.localeCompare(b.area) || a.id - b.id);
}

// Attaches a bundled name to each storyline's raw current-mission value. The
// nation table is nested by city (sandoria/bastok/windurst), selected by the
// player's nation id (0/1/2). Name is null when the dataset can't cover it.
const NATION_KEYS = ['sandoria', 'bastok', 'windurst'];

function resolveMissions(missions, nationId) {
  const out = {};
  for (const [key, value] of Object.entries(missions || {})) {
    let table = missionNames[key] || {};
    if (key === 'nation') {
      table = (typeof nationId === 'number' && table[NATION_KEYS[nationId]]) || {};
    }
    let name = table[String(value)] || null;
    // Mid-mission progress values have no named entry; fall back to the nearest
    // lower named stage so the player sees which mission they're currently in.
    if (name === null && value > 0 && value !== 65535) {
      const floor = Object.keys(table).map(Number).filter(k => k <= value).sort((a, b) => b - a)[0];
      if (floor !== undefined) name = table[String(floor)] || null;
    }
    out[key] = { value, name };
  }
  return out;
}

function enrichInventory(data, liveAmbuscade) {
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

  // Use live bg-wiki data if available, otherwise fall back to local JSON.
  const amb = liveAmbuscade || ambuscade;
  const kiSource = amb.keyItems || {};
  const keyItemNames = Object.keys(kiSource);

  const cur = amb.current || {};
  const currentAmbuscade = {
    fetched: Boolean(liveAmbuscade && liveAmbuscade.fetched),
    month: amb.month || null,
    mount: cur.mount || null,
    bosses: Array.isArray(cur.bosses) ? cur.bosses : [],
    notes: Array.isArray(cur.notes) ? cur.notes : [],
    strategies: Array.isArray(cur.strategies) ? cur.strategies : [],
    vol2: amb.vol2 || null,
    keyItems: keyItemNames.map((name) => ({
      name,
      count: ownedCounts[name] || 0,
      mobs: (kiSource[name] && kiSource[name].mobs) || []
    }))
  };

  return {
    character: data.character || 'Unknown',
    timestamp: data.timestamp || 0,
    inventoryMax: data.inventory_max || 0,
    nation: typeof data.nation === 'number' ? data.nation : null,
    rank: data.rank || null,
    rankPoints: data.rank_points || null,
    roe: buildRoe(data.roe),
    missions: resolveMissions(data.missions, data.nation),
    activeQuests: buildActiveQuests(data.quests),
    ambuscade: currentAmbuscade,
    count: enriched.length,
    progress: buildProgress(data.inventory_max || 0, ownedCounts),
    items: enriched
  };
}

module.exports = { enrichInventory };
