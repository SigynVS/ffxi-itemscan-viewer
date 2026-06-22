'use strict';

let allItems = [];
let currentData = null;
const priceCache = new Map(); // itemId -> { price, cached, error }
const sortState = { key: null, dir: 1 }; // dir: 1 asc, -1 desc

const NATIONS = ["San d'Oria", 'Bastok', 'Windurst'];

// Gobbiebag note -> sortable rank, so "Gobbiebag X" sorts after "Gobbiebag II".
const GOBBIE_RANK = {
  'Gobbiebag I': 1, 'Gobbiebag II': 2, 'Gobbiebag III': 3, 'Gobbiebag IV': 4,
  'Gobbiebag V': 5, 'Gobbiebag VI': 6, 'Gobbiebag VII': 7, 'Gobbiebag VIII': 8,
  'Gobbiebag IX': 9, 'Gobbiebag X': 10
};

// Returns a comparable value for one item under the given sort key.
function sortValue(it, key) {
  switch (key) {
    case 'count': return it.count || 0;
    case 'vendorPrice': return it.vendorPrice; // null handled by comparator
    case 'ah': {
      const p = priceCache.get(it.id);
      return p && typeof p.price === 'number' ? p.price : null;
    }
    case 'gobbiebag': return it.gobbiebag ? GOBBIE_RANK[it.gobbiebag] || 99 : null;
    case 'quests': return it.quests.length || null;
    case 'container_name': return it.container_name || '';
    default: return it.name || '';
  }
}

// Sorts a copy of the rows. Nulls/blanks always sink to the bottom regardless
// of direction, so ascending and descending both keep "no data" rows last.
function sortRows(rows) {
  if (!sortState.key) {
    return rows;
  }
  const key = sortState.key;
  return rows.slice().sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const aEmpty = va === null || va === undefined || va === '';
    const bEmpty = vb === null || vb === undefined || vb === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va).localeCompare(String(vb)) * sortState.dir;
    }
    return (va - vb) * sortState.dir;
  });
}

const rowsEl = document.getElementById('rows');
const progressEl = document.getElementById('progress');
const metaEl = document.getElementById('meta');
const errorEl = document.getElementById('error');
const searchEl = document.getElementById('search');
const onlyVendorEl = document.getElementById('onlyVendor');
const onlyGobbieEl = document.getElementById('onlyGobbie');
const onlyQuestEl = document.getElementById('onlyQuest');
const getPricesEl = document.getElementById('getPrices');
const speedEl = document.getElementById('speed');
const statsEl = document.getElementById('stats');
const questCountEl = document.getElementById('questCount');
const questListEl = document.getElementById('questList');
const missionGridEl = document.getElementById('missionGrid');
const mapZoneEl = document.getElementById('mapZone');
const mapImgEl = document.getElementById('mapImg');
const mapDotEl = document.getElementById('mapDot');
const mapMsgEl = document.getElementById('mapMsg');
const openMapsFolderEl = document.getElementById('openMapsFolder');
const mapDirHintEl = document.getElementById('mapDirHint');
const roeCountEl = document.getElementById('roeCount');
const roeListEl = document.getElementById('roeList');

function gil(n) {
  return n.toLocaleString('en-US') + 'g';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function passesFilters(it) {
  const q = searchEl.value.trim().toLowerCase();
  if (q && !it.name.toLowerCase().includes(q)) {
    return false;
  }
  if (onlyVendorEl.checked) {
    const ah = priceCache.get(it.id);
    const hasValue = (it.vendorPrice && it.vendorPrice > 0) || (ah && ah.price);
    if (!hasValue) {
      return false;
    }
  }
  if (onlyGobbieEl.checked && !it.gobbiebag) {
    return false;
  }
  if (onlyQuestEl.checked && it.quests.length === 0) {
    return false;
  }
  return true;
}

function ahCell(it) {
  const p = priceCache.get(it.id);
  if (!p) {
    return '<span class="dash">—</span>';
  }
  if (p.price && p.price > 0) {
    const stale = p.stale ? ' title="Older than 24h — re-fetch to refresh" class="ah stale"' : ' class="ah"';
    return `<span${stale}>${gil(p.price)}</span>`;
  }
  if (p.error) {
    return '<span class="dash" title="' + escapeHtml(p.error) + '">err</span>';
  }
  return '<span class="dash">n/a</span>';
}

function render() {
  const visible = sortRows(allItems.filter(passesFilters));
  rowsEl.innerHTML = visible.map((it) => {
    const vendor = (it.vendorPrice && it.vendorPrice > 0)
      ? `<span class="gil">${gil(it.vendorPrice)}</span>`
      : '<span class="dash">—</span>';
    const gobbie = it.gobbiebag
      ? `<span class="tag">${escapeHtml(it.gobbiebag)}</span>`
      : '<span class="dash">—</span>';
    const verified = it.quests.length
      ? it.quests.map((q) => `<span class="quest">${escapeHtml(q)}</span>`).join('')
      : '';
    const wiki = `<span class="wikilink" data-wiki="${escapeHtml(it.name)}">wiki &#8599;</span>`;
    const quests = verified + wiki;
    const useDot = it.hasUse ? '<span class="use" title="Used by a quest or Gobbiebag">&#9679;</span> ' : '';
    return `<tr>
      <td class="name">${useDot}${escapeHtml(it.name)}</td>
      <td class="num">${it.count}</td>
      <td class="where">${escapeHtml(it.container_name)}</td>
      <td class="desc">${escapeHtml(it.description)}</td>
      <td class="num">${vendor}</td>
      <td class="num">${ahCell(it)}</td>
      <td>${gobbie}</td>
      <td>${quests}</td>
    </tr>`;
  }).join('');
  metaEl.textContent = `${visible.length} of ${allItems.length} items shown`;
}

// Active quests captured from packet 0x056 (current bits minus completed bits).
const QUEST_AREA_LABELS = {
  other: 'Nations / Jeuno / Misc', abyssea: 'Abyssea',
  adoulin: 'Adoulin', coalition: 'Coalition'
};

function renderQuests(activeQuests) {
  const list = activeQuests || [];
  questCountEl.textContent = `(${list.length} active)`;
  if (!list.length) {
    questListEl.innerHTML = '<div class="muted">No active quests captured yet. '
      + 'Zone once so the game sends the quest packets, then rescan.</div>';
    return;
  }
  questListEl.innerHTML = list.map((q) => {
    const name = q.name ? escapeHtml(q.name) : `Quest #${q.id}`;
    const area = QUEST_AREA_LABELS[q.area] || q.area;
    return `<div class="quest-item">
      <span class="quest-qname">${name}</span>
      <span class="quest-area">${escapeHtml(area)}</span>
    </div>`;
  }).join('');
}

// Storyline display order + labels. Values are the raw current-mission stage
// from packet 0x056 (verified read); turning them into named stages is a
// separate bundled-table effort, so these show the raw number for now.
const MISSION_LINES = [
  { key: 'nation', label: 'Nation Missions' },
  { key: 'zilart', label: 'Rise of the Zilart' },
  { key: 'promathia', label: 'Chains of Promathia', raw: true },
  { key: 'aht_urhgan', label: 'Treasures of Aht Urhgan' },
  { key: 'assault', label: 'Assault' },
  { key: 'goddess', label: 'Wings of the Goddess' },
  { key: 'adoulin', label: 'Seekers of Adoulin', raw: true },
  { key: 'rhapsodies', label: 'Rhapsodies of Vana\'diel', raw: true },
  { key: 'voracious', label: 'The Voracious Resurgence' }
];

function missionValueText(entry, raw) {
  if (!entry || entry.value === undefined || entry.value === null) {
    return '<span class="dash">—</span>';
  }
  const v = entry.value;
  if (v === 65535) {
    return '<span class="muted">none / complete</span>';
  }
  if (v === 0) {
    return '<span class="muted">not started</span>';
  }
  if (entry.name) {
    return escapeHtml(entry.name);
  }
  return `stage ${v}${raw ? ' <span class="muted">(raw)</span>' : ''}`;
}

function renderMissions(missions) {
  const m = missions || {};
  missionGridEl.innerHTML = MISSION_LINES.map((line) =>
    `<div class="mission-row">
      <span class="mission-name">${line.label}</span>
      <span class="mission-val">${missionValueText(m[line.key], line.raw)}</span>
    </div>`).join('');
}

// Renders the active Records of Eminence objectives captured from packet 0x111.
// Names come from roe_names.json once bundled; until then the objective id is
// shown so the read itself can be verified against the in-game RoE log.
async function renderRoe(roe, character) {
  const list = roe || [];
  roeCountEl.textContent = list.length ? `(${list.length} active)` : '(none captured yet)';
  if (!list.length) {
    roeListEl.innerHTML = '<div class="muted">No RoE data yet. After loading in, open your '
      + 'Records of Eminence log (or zone once) so the game sends the update, then rescan.</div>';
    return;
  }
  // User labels override the bundled names; both fall back to the bare id.
  let labels = {};
  try {
    labels = await window.itemscan.getRoeLabels(character);
  } catch (err) {
    labels = {};
  }
  roeListEl.innerHTML = list.map((o) => {
    const name = labels[o.id] || o.name || '';
    return `<div class="roe-row">
      <input class="roe-name-input" data-id="${o.id}" value="${escapeHtml(name)}"
        placeholder="Objective #${o.id} — type a name" />
      <span class="roe-prog">${o.progress.toLocaleString('en-US')}</span>
    </div>`;
  }).join('');

  roeListEl.querySelectorAll('.roe-name-input').forEach((inp) => {
    inp.addEventListener('change', () => {
      window.itemscan.setRoeLabel(character, inp.dataset.id, inp.value);
    });
  });
}

// Renders the top stats line: nation/rank and total AH value of inventory
// (summed across items that have a fetched price; updates live as prices load).
function renderStats() {
  if (!currentData) {
    statsEl.innerHTML = '';
    return;
  }
  const bits = [];

  if (typeof currentData.nation === 'number' && NATIONS[currentData.nation]) {
    const rank = currentData.rank ? ` Rank ${currentData.rank}` : '';
    bits.push(`<span class="stat">${NATIONS[currentData.nation]}${rank}</span>`);
  }

  let total = 0;
  let priced = 0;
  for (const it of allItems) {
    const p = priceCache.get(it.id);
    if (p && typeof p.price === 'number') {
      total += p.price * (it.count || 1);
      priced += 1;
    }
  }
  if (priced > 0) {
    bits.push(`<span class="stat">AH value: <b>${total.toLocaleString('en-US')}g</b>`
      + ` <span class="muted">(${priced} priced)</span></span>`);
  }

  statsEl.innerHTML = bits.join('');
}

// Renders the Gobbiebag progress strip: which parts are done, which you can
// complete right now, and which items you still need for the rest.
function renderProgress(data) {
  const parts = data.progress || [];
  if (!parts.length) {
    progressEl.innerHTML = '';
    return;
  }
  const done = parts.filter((p) => p.completed).length;
  const cards = parts.map((p) => {
    let cls = 'pcard';
    let status = '';
    if (p.completed) {
      cls += ' done';
      status = 'done';
    } else if (p.canComplete) {
      cls += ' ready';
      status = 'ready!';
    } else {
      cls += ' partial';
      status = 'need items';
    }
    const items = p.items.map((h) => {
      const ok = h.count > 0;
      return `<li class="${ok ? 'ok' : 'miss'}">${escapeHtml(h.name)}${ok ? ` ×${h.count}` : ''}</li>`;
    }).join('');
    return `<div class="${cls}">
      <div class="phead">Part ${p.part} <span class="pstatus">${status}</span></div>
      <ul>${items}</ul>
    </div>`;
  }).join('');
  progressEl.innerHTML = `<div class="psummary">Gobbiebag: <b>${done}/10</b> parts done`
    + ` &middot; inventory ${data.inventoryMax || '?'} slots</div>`
    + `<div class="pgrid">${cards}</div>`;
}

// Fetch AH prices for every currently-visible item. All requests are dispatched
// at once; the main process's worker pool bounds real concurrency, so this
// actually runs in parallel (unlike awaiting one at a time). UI updates as each
// resolves.
function fetchAllPrices() {
  getPricesEl.disabled = true;
  const targets = allItems.filter(passesFilters);
  let done = 0;

  const jobs = targets.map((it) =>
    window.itemscan.fetchPrice(it.id)
      .then((result) => priceCache.set(it.id, result))
      .catch((err) => priceCache.set(it.id, { price: null, cached: false, error: err.message }))
      .finally(() => {
        done += 1;
        getPricesEl.textContent = `Fetching ${done}/${targets.length}…`;
        render();
        renderStats();
      })
  );

  Promise.all(jobs).then(() => {
    getPricesEl.textContent = 'Fetch AH prices';
    getPricesEl.disabled = false;
  });
}

window.itemscan.onInventory(async (data) => {
  errorEl.classList.add('hidden');
  currentData = data;
  allItems = data.items;

  // Restore previously-saved AH prices from disk so the column isn't blank
  // after a restart (no network — just the cache).
  try {
    const cached = await window.itemscan.getCachedPrices(allItems.map((it) => it.id));
    for (const [id, result] of Object.entries(cached)) {
      priceCache.set(Number(id), result);
    }
  } catch (err) {
    // Non-fatal: just means prices stay blank until a manual fetch.
  }
  const when = data.timestamp
    ? new Date(data.timestamp * 1000).toLocaleTimeString()
    : 'unknown time';
  metaEl.textContent = `${data.character} — ${data.count} items — scanned ${when}`;
  renderProgress(data);
  renderStats();
  renderQuests(data.activeQuests);
  renderMissions(data.missions);
  renderRoe(data.roe, data.character);
  render();
});

// Live map updates from position.json. Image only arrives on zone change; the
// dot moves every update via percentage positioning (scales with the image).
window.itemscan.onPosition((p) => {
  mapZoneEl.textContent = `zone ${p.zone}`;
  if (!p.hasCalibration) {
    mapImgEl.style.display = 'none';
    mapDotEl.classList.add('hidden');
    mapMsgEl.textContent = `No map calibration for zone ${p.zone}.`;
    mapMsgEl.style.display = '';
    return;
  }
  if (p.imageChanged) {
    if (p.image) {
      mapImgEl.src = p.image;
      mapImgEl.style.display = '';
      mapMsgEl.style.display = 'none';
    } else {
      mapImgEl.style.display = 'none';
      mapMsgEl.innerHTML = `No image for <b>${p.mapName}.png</b>. `
        + 'Click <b>Open maps folder</b> above and drop the PNGs there '
        + '(from remapster-wiki-pack-1-1024).';
      mapMsgEl.style.display = '';
    }
  }
  if (p.dot && mapImgEl.style.display !== 'none') {
    mapDotEl.style.left = p.dot.xPct + '%';
    mapDotEl.style.top = p.dot.yPct + '%';
    mapDotEl.classList.remove('hidden');
  } else {
    mapDotEl.classList.add('hidden');
  }
});

window.itemscan.onError((data) => {
  errorEl.textContent = `Could not read inventory:\n${data.path}\n${data.message}\n\n`
    + 'Run /itemscan in-game to create it.';
  errorEl.classList.remove('hidden');
});

// Reflects the active sort in the header labels via a ▲/▼ suffix.
function updateSortHeaders() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    const base = th.dataset.label || (th.dataset.label = th.textContent);
    if (th.dataset.key === sortState.key) {
      th.textContent = base + (sortState.dir === 1 ? ' ▲' : ' ▼');
    } else {
      th.textContent = base;
    }
  });
}

document.querySelectorAll('th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortState.key === key) {
      sortState.dir *= -1; // toggle asc/desc on the same column
    } else {
      sortState.key = key;
      sortState.dir = 1;
    }
    updateSortHeaders();
    render();
  });
});

// Clicking a "wiki" link opens that item's BG-Wiki page (authoritative source
// for quest/mission usage) in the default browser.
rowsEl.addEventListener('click', (e) => {
  const link = e.target.closest('.wikilink');
  if (link) {
    const name = link.dataset.wiki;
    window.itemscan.openExternal(`https://www.bg-wiki.com/ffxi/${encodeURIComponent(name)}`);
  }
});

// Tab switching: activate the clicked tab button and its matching panel.
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.panel === name);
    });
  });
});

searchEl.addEventListener('input', render);
onlyVendorEl.addEventListener('change', render);
onlyGobbieEl.addEventListener('change', render);
onlyQuestEl.addEventListener('change', render);
getPricesEl.addEventListener('click', fetchAllPrices);
speedEl.addEventListener('change', () => {
  window.itemscan.setConcurrency(parseInt(speedEl.value, 10));
});
// Apply the default speed once on load.
window.itemscan.setConcurrency(parseInt(speedEl.value, 10));

async function initMapsDirHint() {
  try {
    const dir = await window.itemscan.getMapsDir();
    mapDirHintEl.textContent = dir;
  } catch (err) {
    mapDirHintEl.textContent = '';
  }
}

openMapsFolderEl.addEventListener('click', async () => {
  try {
    const dir = await window.itemscan.openMapsFolder();
    mapDirHintEl.textContent = dir;
  } catch (err) {
    mapMsgEl.textContent = 'Could not open maps folder: ' + err.message;
    mapMsgEl.style.display = '';
  }
});

initMapsDirHint();
