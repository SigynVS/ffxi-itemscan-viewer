'use strict';

let allItems = [];
let visibleItems = []; // current filtered+sorted item list (for detail panel prev/next)
let currentData = null;
let currentCharacter = '';

// Per-section state (populated when inventory loads, re-applied on sort/filter)
let currentQuestData = [];
let currentMissionsData = null;
let currentMissionLabels = {};
let currentRoeData = [];
let currentRoeLabels = {};

// Sort/filter state for list views
let questSortState = 'default';
let questSearchQuery = '';
let missionSortState = 'default';
let missionFilterState = 'all';
let roeSortState = 'default';
let roeSearchQuery = '';

// Detail panel state
let detailIndex = -1;

const priceCache = new Map(); // itemId -> { price, cached, stale, error }
const sortState = { key: null, dir: 1 };

const NATIONS = ["San d'Oria", 'Bastok', 'Windurst'];

const GOBBIE_RANK = {
  'Gobbiebag I': 1, 'Gobbiebag II': 2, 'Gobbiebag III': 3, 'Gobbiebag IV': 4,
  'Gobbiebag V': 5, 'Gobbiebag VI': 6, 'Gobbiebag VII': 7, 'Gobbiebag VIII': 8,
  'Gobbiebag IX': 9, 'Gobbiebag X': 10
};

function sortValue(it, key) {
  switch (key) {
    case 'count': return it.count || 0;
    case 'vendorPrice': return it.vendorPrice;
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

function sortRows(rows) {
  if (!sortState.key) return rows;
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

// DOM refs
const rowsEl = document.getElementById('rows');
const metaEl = document.getElementById('meta');
const errorEl = document.getElementById('error');
const searchEl = document.getElementById('search');
const onlyVendorEl = document.getElementById('onlyVendor');
const onlyGobbieEl = document.getElementById('onlyGobbie');
const onlyQuestEl = document.getElementById('onlyQuest');
const getPricesEl = document.getElementById('getPrices');
const speedEl = document.getElementById('speed');
const statsEl = document.getElementById('stats');
const questListEl = document.getElementById('questList');
const ambuscadePanelEl = document.querySelector('[data-panel="ambuscade"] .ambuscade-panel');
const missionGridEl = document.getElementById('missionGrid');
const mapZoneEl = document.getElementById('mapZone');
const mapImgEl = document.getElementById('mapImg');
const mapDotEl = document.getElementById('mapDot');
const mapMsgEl = document.getElementById('mapMsg');
const openMapsFolderEl = document.getElementById('openMapsFolder');
const mapDirHintEl = document.getElementById('mapDirHint');
const roeListEl = document.getElementById('roeList');

function gil(n) {
  return n.toLocaleString('en-US') + 'g';
}

// FFXI job IDs 1-22 in order.
const JOBS = ['WAR','MNK','WHM','BLM','RDM','THF','PLD','DRK','BST','BRD','RNG','SAM','NIN','DRG','SMN','BLU','COR','PUP','DNC','SCH','GEO','RUN'];

// Equipment slot labels in slot-id order (0-15).
const EQUIP_SLOTS = ['Main','Sub','Ranged','Ammo','Head','Neck','L.Ear','R.Ear','Body','Hands','L.Ring','R.Ring','Back','Waist','Legs','Feet'];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function passesFilters(it) {
  const q = searchEl.value.trim().toLowerCase();
  if (q && !it.name.toLowerCase().includes(q)) return false;
  if (onlyVendorEl.checked) {
    const ah = priceCache.get(it.id);
    if (!(it.vendorPrice && it.vendorPrice > 0) && !(ah && ah.price)) return false;
  }
  if (onlyGobbieEl.checked && !it.gobbiebag) return false;
  if (onlyQuestEl.checked && it.quests.length === 0) return false;
  return true;
}

function ahCell(it) {
  const p = priceCache.get(it.id);
  if (!p) return '<span class="dash">—</span>';
  if (p.price && p.price > 0) {
    const stale = p.stale ? ' title="Older than 24h — re-fetch to refresh" class="ah stale"' : ' class="ah"';
    return `<span${stale}>${gil(p.price)}</span>`;
  }
  if (p.error) return '<span class="dash" title="' + escapeHtml(p.error) + '">err</span>';
  return '<span class="dash">n/a</span>';
}

// ── Items list view ──────────────────────────────────────────────

function render() {
  const filtered = allItems.filter(passesFilters);
  visibleItems = sortRows(filtered);

  rowsEl.innerHTML = visibleItems.map((it, idx) => {
    // Status dot: green = quest item, gold = gobbiebag, dim = plain
    let dotCls = 'sdot';
    if (it.quests.length > 0) dotCls += ' sdot-done';
    else if (it.gobbiebag) dotCls += ' sdot-active';

    const vendor = (it.vendorPrice && it.vendorPrice > 0)
      ? `<span class="gil">${gil(it.vendorPrice)}</span>`
      : '<span class="dash">—</span>';
    const gobbie = it.gobbiebag
      ? `<span class="tag">${escapeHtml(it.gobbiebag)}</span>`
      : '<span class="dash">—</span>';
    const questSpans = it.quests.length
      ? it.quests.map((q) => `<span class="quest">${escapeHtml(q)}</span>`).join('')
      : '';
    const wiki = `<span class="wikilink" data-wiki="${escapeHtml(it.name)}">wiki &#8599;</span>`;

    return `<tr class="item-row" data-index="${idx}">
      <td class="col-status"><div class="${dotCls}"></div></td>
      <td class="name">${escapeHtml(it.name)}</td>
      <td class="num">${it.count}</td>
      <td class="where">${escapeHtml(it.container_name)}</td>
      <td class="desc">${escapeHtml(it.description)}</td>
      <td class="num">${vendor}</td>
      <td class="num">${ahCell(it)}</td>
      <td>${gobbie}</td>
      <td>${questSpans}${wiki}</td>
    </tr>`;
  }).join('');

  metaEl.textContent = `${visibleItems.length} of ${allItems.length} items shown`;
}

// ── Dashboard (Chronicle home view) ─────────────────────────────

function renderDashboard(data) {
  const dashEl = document.getElementById('dashboard');
  if (!dashEl) return;

  const parts = data.progress || [];
  const gobbieDone = parts.filter((p) => p.completed).length;
  const gobbieTotal = parts.length || 10;
  const gobbiePct = gobbieTotal ? Math.round(gobbieDone / gobbieTotal * 100) : 0;

  const quests = data.activeQuests || [];
  const roe = data.roe || [];

  // Mission stats
  let missionDone = 0;
  let missionActive = 0;
  for (const line of MISSION_LINES) {
    const e = (data.missions || {})[line.key];
    if (!e || e.value === undefined) continue;
    if (e.value === 65535) missionDone++;
    else if (e.value > 0) missionActive++;
  }

  // Quest item count
  const questItemCount = (data.items || []).filter((i) => i.quests.length > 0).length;

  const cards = [
    {
      name: 'Gobbiebag',
      count: `${gobbieDone} / ${gobbieTotal} parts`,
      pct: gobbiePct,
      complete: gobbieDone === gobbieTotal,
      active: gobbieDone > 0 && gobbieDone < gobbieTotal,
    },
    {
      name: 'Inventory',
      count: `${(data.items || []).length} items · ${data.inventoryMax || '?'} slots`,
      pct: null,
    },
    {
      name: 'Quest Items',
      count: `${questItemCount} items with quest use`,
      pct: (data.items && data.items.length)
        ? Math.round(questItemCount / data.items.length * 100)
        : null,
    },
    {
      // Completion is only reliably detectable via the 65535 "done" sentinel
      // (verified for Nation missions). CoP/Assault and others use server-side
      // ids for "done", so we report confirmed-done + in-progress rather than a
      // false "X / 13 complete" fraction.
      name: 'Missions',
      count: `${missionDone} done · ${missionActive} in progress`,
      pct: null,
      active: missionActive > 0,
    },
    {
      name: 'Records of Eminence',
      count: `${roe.length} active objectives`,
      pct: null,
    },
    {
      name: 'Active Quests',
      count: `${quests.length} quests across all areas`,
      pct: null,
    },
  ];

  const cardsHtml = cards.map((c) => {
    let cardCls = 'cat-card';
    if (c.complete) cardCls += ' card-complete';
    else if (c.active) cardCls += ' card-active';

    const pctHtml = c.pct !== null
      ? `<div class="cat-card-pct">${c.pct}%</div>`
      : '';
    const barHtml = c.pct !== null
      ? `<div class="mini-bar-track"><div class="mini-bar-fill" style="width:${c.pct}%"></div></div>`
      : '';

    return `<div class="${cardCls}">
      ${pctHtml}
      <div class="cat-card-name">${c.name}</div>
      <div class="cat-card-count">${c.count}</div>
      ${barHtml}
    </div>`;
  }).join('');

  const when = data.timestamp
    ? new Date(data.timestamp * 1000).toLocaleString()
    : '—';

  dashEl.innerHTML = `
    <div class="db-header">
      <div class="db-title">${escapeHtml(data.character || 'Inventory')}</div>
      <div class="db-subtitle">Last scanned ${when}</div>
    </div>
    <div class="overall-bar-wrap">
      <div class="overall-bar-label">
        <span class="overall-bar-text">Gobbiebag Completion</span>
        <div class="overall-pct-block">
          <span class="overall-pct">${gobbiePct}%</span>
          <span class="overall-sub">${gobbieDone} / ${gobbieTotal} parts</span>
        </div>
      </div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width:${gobbiePct}%"></div>
      </div>
    </div>
    <div class="cat-grid">${cardsHtml}</div>
  `;
}

// ── Quests list view ─────────────────────────────────────────────

const QUEST_AREA_LABELS = {
  other: 'Nations / Jeuno / Misc', abyssea: 'Abyssea',
  adoulin: 'Adoulin', coalition: 'Coalition'
};

function renderQuests(activeQuests) {
  currentQuestData = activeQuests || [];
  applyQuestRender();
}

function applyQuestRender() {
  const countEl = document.getElementById('questCount');
  const q = questSearchQuery.toLowerCase();

  let list = currentQuestData.filter((quest) => {
    if (!q) return true;
    const area = QUEST_AREA_LABELS[quest.area] || quest.area;
    return (quest.name || '').toLowerCase().includes(q)
      || area.toLowerCase().includes(q);
  });

  if (questSortState === 'name') {
    list = list.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  if (countEl) countEl.textContent = currentQuestData.length;

  if (!list.length) {
    questListEl.innerHTML = `<div class="muted" style="padding:14px 0">
      ${currentQuestData.length
        ? 'No results match your search.'
        : 'No active quests captured yet. Zone once so the game sends quest packets, then rescan.'}
    </div>`;
    return;
  }

  questListEl.innerHTML = list.map((quest) => {
    const area = QUEST_AREA_LABELS[quest.area] || quest.area;
    const name = quest.name ? escapeHtml(quest.name) : `Quest #${quest.id}`;
    const wikiAttr = quest.name ? ` data-wiki="${escapeHtml(quest.name)}"` : '';
    return `<div class="status-row clickable">
      <div class="status-dot-wrap"><div class="sdot sdot-active"></div></div>
      <div class="status-row-body">
        <div class="status-row-name mission-link"${wikiAttr}>${name}</div>
        <div class="status-row-sub">${escapeHtml(area)}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Missions list view ───────────────────────────────────────────

const MISSION_LINES = [
  { key: 'nation',     label: 'Nation Missions' },
  { key: 'zilart',     label: 'Rise of the Zilart' },
  { key: 'promathia',  label: 'Chains of Promathia' },
  { key: 'aht_urhgan', label: 'Treasures of Aht Urhgan' },
  { key: 'assault',    label: 'Assault' },
  { key: 'goddess',    label: 'Wings of the Goddess' },
  { key: 'campaign',   label: 'Campaign Operations' },
  { key: 'adoulin',    label: 'Seekers of Adoulin' },
  { key: 'rhapsodies', label: "Rhapsodies of Vana'diel" },
  { key: 'voracious',  label: 'The Voracious Resurgence' },
  { key: 'crystalline',label: 'A Crystalline Prophecy' },
  { key: 'moogle',     label: "A Moogle Kupo d'Etat" },
  { key: 'shantotto',  label: 'A Shantotto Ascension' },
];

function missionStatusOf(entry) {
  if (!entry || entry.value === undefined || entry.value === null) return 'none';
  if (entry.value === 0) return 'none';
  if (entry.value === 65535) return 'done';
  return 'active';
}

function missionValueCell(line, entry, labels) {
  if (!entry || entry.value === undefined || entry.value === null) {
    return '<span class="dash">—</span>';
  }
  const v = entry.value;
  if (v === 65535) return '<span class="muted">Completed</span>';
  if (v === 0) return '<span class="muted">not started</span>';
  const labelKey = `${line.key}:${v}`;
  const name = labels[labelKey] || entry.name;
  if (name) {
    return `<span class="mission-link" data-wiki="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
  }
  return `<input class="mission-input" data-key="${labelKey}"
    placeholder="stage ${v} — type the mission name" />`;
}

async function renderMissions(missions, character) {
  currentMissionsData = missions || {};
  currentCharacter = character;
  try {
    currentMissionLabels = await window.itemscan.getMissionLabels(character);
  } catch (_) {
    currentMissionLabels = {};
  }
  applyMissionRender();
}

function applyMissionRender() {
  const countEl = document.getElementById('missionCount');
  const m = currentMissionsData || {};
  const STATUS_ORDER = { done: 0, active: 1, none: 2 };

  let lines = MISSION_LINES.map((line) => ({
    line,
    entry: m[line.key],
    status: missionStatusOf(m[line.key]),
  }));

  if (missionSortState === 'name') {
    lines = lines.slice().sort((a, b) => a.line.label.localeCompare(b.line.label));
  } else if (missionSortState === 'status') {
    lines = lines.slice().sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  }

  if (missionFilterState === 'complete') {
    lines = lines.filter((x) => x.status === 'done');
  } else if (missionFilterState === 'todo') {
    lines = lines.filter((x) => x.status !== 'done');
  }

  const doneCount = MISSION_LINES.filter((l) => {
    const e = m[l.key];
    return e && e.value === 65535;
  }).length;

  if (countEl) countEl.textContent = doneCount;

  missionGridEl.innerHTML = lines.map(({ line, entry, status }) => {
    const dotCls = status === 'done' ? 'sdot sdot-done'
      : status === 'active' ? 'sdot sdot-active'
      : 'sdot';

    let sub = '';
    if (entry && entry.value === 65535) sub = 'Completed';
    else if (!entry || !entry.value) sub = 'Not started';
    else sub = `Stage ${entry.value}`;

    const valueHtml = missionValueCell(line, entry, currentMissionLabels);

    return `<div class="status-row">
      <div class="status-dot-wrap"><div class="${dotCls}"></div></div>
      <div class="status-row-body">
        <div class="status-row-name">${line.label}</div>
        <div class="status-row-sub">${sub}</div>
      </div>
      <div class="status-row-right">${valueHtml}</div>
    </div>`;
  }).join('');

  missionGridEl.querySelectorAll('.mission-input').forEach((inp) => {
    inp.addEventListener('change', () => {
      window.itemscan.setMissionLabel(currentCharacter, inp.dataset.key, inp.value);
      currentMissionLabels[inp.dataset.key] = inp.value;
    });
  });
}

// ── Records of Eminence list view ────────────────────────────────

async function renderRoe(roe, character) {
  currentRoeData = roe || [];
  currentCharacter = character;
  try {
    currentRoeLabels = await window.itemscan.getRoeLabels(character);
  } catch (_) {
    currentRoeLabels = {};
  }
  applyRoeRender();
}

function applyRoeRender() {
  const countEl = document.getElementById('roeCount');
  if (countEl) countEl.textContent = currentRoeData.length || '0';

  const q = roeSearchQuery.toLowerCase();

  let list = currentRoeData.filter((o) => {
    if (!q) return true;
    const name = currentRoeLabels[o.id] || o.name || `Objective #${o.id}`;
    return name.toLowerCase().includes(q);
  });

  if (roeSortState === 'name') {
    list = list.slice().sort((a, b) => {
      const na = currentRoeLabels[a.id] || a.name || '';
      const nb = currentRoeLabels[b.id] || b.name || '';
      return na.localeCompare(nb);
    });
  } else if (roeSortState === 'progress') {
    list = list.slice().sort((a, b) => b.progress - a.progress);
  }

  if (!list.length) {
    roeListEl.innerHTML = `<div class="muted" style="padding:14px 0">
      ${currentRoeData.length
        ? 'No results match your search.'
        : 'No RoE data yet. Open your Records of Eminence log in-game, then rescan.'}
    </div>`;
    return;
  }

  roeListEl.innerHTML = list.map((o) => {
    const name = currentRoeLabels[o.id] || o.name || '';
    return `<div class="status-row">
      <div class="status-dot-wrap"><div class="sdot sdot-active"></div></div>
      <div class="status-row-body">
        <input class="roe-name-input" data-id="${o.id}"
          value="${escapeHtml(name)}"
          placeholder="Objective #${o.id} — type a name" />
      </div>
      <div class="status-row-right roe-prog">${o.progress.toLocaleString('en-US')}</div>
    </div>`;
  }).join('');

  roeListEl.querySelectorAll('.roe-name-input').forEach((inp) => {
    inp.addEventListener('change', () => {
      currentRoeLabels[inp.dataset.id] = inp.value;
      window.itemscan.setRoeLabel(currentCharacter, inp.dataset.id, inp.value);
    });
  });
}

// ── Stats bar ────────────────────────────────────────────────────

function renderStats() {
  if (!currentData) { statsEl.innerHTML = ''; return; }
  const bits = [];
  if (typeof currentData.nation === 'number' && NATIONS[currentData.nation]) {
    const rank = currentData.rank ? ` Rank ${currentData.rank}` : '';
    bits.push(`<span class="stat">${NATIONS[currentData.nation]}${rank}</span>`);
  }
  let total = 0, priced = 0;
  for (const it of allItems) {
    const p = priceCache.get(it.id);
    if (p && typeof p.price === 'number') { total += p.price * (it.count || 1); priced++; }
  }
  if (priced > 0) {
    bits.push(`<span class="stat">AH value: <b>${total.toLocaleString('en-US')}g</b>`
      + ` <span class="muted">(${priced} priced)</span></span>`);
  }
  statsEl.innerHTML = bits.join('');
}

// ── Detail panel (Chronicle guide view) ─────────────────────────

function openDetail(idx) {
  detailIndex = idx;
  renderDetailContent();
  document.getElementById('detailOverlay').classList.add('open');
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('open');
  detailIndex = -1;
}

function renderDetailContent() {
  const item = visibleItems[detailIndex];
  if (!item) return;

  const container = item.container_name || '';
  const p = priceCache.get(item.id);

  // Breadcrumb
  const breadcrumb = `<div class="detail-breadcrumb">
    <span class="bc-link" id="bcBack">Items</span>
    <span class="bc-sep">›</span>
    <span class="bc-link" id="bcContainer">${escapeHtml(container)}</span>
    <span class="bc-sep">›</span>
    <span class="bc-current">${escapeHtml(item.name)}</span>
  </div>`;

  // Status badges
  const badges = [];
  if (item.quests.length > 0) badges.push('<span class="badge badge-quest">Quest Item</span>');
  if (item.gobbiebag) badges.push(`<span class="badge badge-gobbie">${escapeHtml(item.gobbiebag)}</span>`);
  if (item.vendorPrice && item.vendorPrice > 0) badges.push('<span class="badge badge-vendor">Vendor</span>');

  // Fields
  const vendorHtml = (item.vendorPrice && item.vendorPrice > 0)
    ? `<span class="gil">${gil(item.vendorPrice)}</span>`
    : '<span class="dash">—</span>';

  let ahHtml = '<span class="dash">—</span>';
  if (p) {
    if (p.price && p.price > 0) {
      ahHtml = `<span class="${p.stale ? 'ah stale' : 'ah'}">${gil(p.price)}</span>`;
    } else if (p.error) {
      ahHtml = `<span class="dash" title="${escapeHtml(p.error)}">err</span>`;
    } else {
      ahHtml = '<span class="dash">n/a</span>';
    }
  }

  const fields = `<div class="detail-fields">
    <div class="detail-field">
      <span class="df-label">Container</span>
      <span class="df-value">${escapeHtml(container)}</span>
    </div>
    <div class="detail-field">
      <span class="df-label">Quantity</span>
      <span class="df-value">${item.count}</span>
    </div>
    <div class="detail-field">
      <span class="df-label">Vendor</span>
      <span class="df-value">${vendorHtml}</span>
    </div>
    <div class="detail-field">
      <span class="df-label">AH Median</span>
      <span class="df-value">${ahHtml}</span>
    </div>
    ${item.description ? `<div class="detail-field">
      <span class="df-label">Description</span>
      <span class="df-value desc">${escapeHtml(item.description)}</span>
    </div>` : ''}
  </div>`;

  // Requirements — quests this item is used in
  let sections = '';
  if (item.quests.length > 0) {
    const items = item.quests.map((q) =>
      `<li class="req-item req-met">
        <span class="mission-link" data-wiki="${escapeHtml(q)}">${escapeHtml(q)}</span>
      </li>`
    ).join('');
    sections += `<div class="detail-section">
      <div class="detail-section-head">Used In</div>
      <ul class="req-list">${items}</ul>
    </div>`;
  }

  // Gobbiebag part item checklist
  if (item.gobbiebag && currentData) {
    const part = (currentData.progress || []).find((pt) => pt.label === item.gobbiebag);
    if (part) {
      const partItems = part.items.map((h) => {
        const ok = h.count > 0;
        return `<li class="req-item ${ok ? 'req-met' : 'req-unmet'}">
          ${escapeHtml(h.name)}${ok ? ` ×${h.count}` : ''}
        </li>`;
      }).join('');
      sections += `<div class="detail-section">
        <div class="detail-section-head">${escapeHtml(item.gobbiebag)} — Required Items</div>
        <ul class="req-list">${partItems}</ul>
      </div>`;
    }
  }

  document.getElementById('detailContent').innerHTML =
    breadcrumb
    + `<h2 class="detail-title">${escapeHtml(item.name)}</h2>`
    + `<div class="detail-badges">${badges.join('')}</div>`
    + fields
    + sections;

  // Breadcrumb back action
  document.getElementById('bcBack').addEventListener('click', closeDetail);
  document.getElementById('bcContainer').addEventListener('click', () => {
    searchEl.value = '';
    onlyVendorEl.checked = false;
    onlyGobbieEl.checked = false;
    onlyQuestEl.checked = false;
    closeDetail();
    activateTab('items');
  });

  // Prev/Next state
  document.getElementById('detailPrev').disabled = detailIndex <= 0;
  document.getElementById('detailNext').disabled = detailIndex >= visibleItems.length - 1;
}

// ── AH price fetching ────────────────────────────────────────────

function fetchAllPrices() {
  getPricesEl.disabled = true;
  const targets = allItems.filter(passesFilters);
  let done = 0;

  const jobs = targets.map((it) =>
    window.itemscan.fetchPrice(it.id)
      .then((result) => priceCache.set(it.id, result))
      .catch((err) => priceCache.set(it.id, { price: null, cached: false, error: err.message }))
      .finally(() => {
        done++;
        getPricesEl.textContent = `Fetching ${done}/${targets.length}…`;
        render();
        renderStats();
        if (detailIndex >= 0) renderDetailContent();
      })
  );

  Promise.all(jobs).then(() => {
    getPricesEl.textContent = 'Fetch AH prices';
    getPricesEl.disabled = false;
  });
}

// ── IPC event handlers ───────────────────────────────────────────

function renderAmbuscade(ambuscade) {
  if (!ambuscade) {
    ambuscadePanelEl.innerHTML = '<p class="muted">Ambuscade data not available.</p>';
    return;
  }

  const source = ambuscade.fetched
    ? `<div class="ambuscade-source">Live data from bg-wiki · ${escapeHtml(ambuscade.month || '')}</div>`
    : `<div class="ambuscade-source muted">Offline fallback · ${escapeHtml(ambuscade.month || '')}</div>`;

  // Vol 1 bosses
  const bossList = ambuscade.bosses && ambuscade.bosses.length
    ? `<div class="ambuscade-section"><strong>Vol. 1 — ${escapeHtml(ambuscade.mount || 'Unknown')}:</strong>
       <ul>${ambuscade.bosses.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul></div>`
    : `<div class="ambuscade-section"><strong>Vol. 1:</strong> ${escapeHtml(ambuscade.mount || 'Unknown')}</div>`;

  // Boss mechanics notes
  const notes = ambuscade.notes || [];
  const notesHtml = notes.length
    ? `<div class="ambuscade-section">
         <details class="amb-details">
           <summary>Boss mechanics (${notes.length} notes)</summary>
           <ul class="amb-notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
         </details>
       </div>`
    : '';

  // Vol 1 strategies
  const strategies = ambuscade.strategies || [];
  const strategiesHtml = strategies.length
    ? `<div class="ambuscade-section">
         <strong>Vol. 1 strategies:</strong>
         <div class="amb-strats">${strategies.map((s) =>
           `<details class="amb-details">
              <summary>${escapeHtml(s.difficulty)}</summary>
              <div class="amb-strat-text">${escapeHtml(s.text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>
            </details>`).join('')}
         </div>
       </div>`
    : '';

  // Vol 2
  const vol2 = ambuscade.vol2;
  const vol2Html = vol2
    ? `<div class="ambuscade-section"><strong>Vol. 2 — ${escapeHtml(vol2.mount || 'Unknown')}:</strong>
       ${vol2.adds && vol2.adds.length
         ? `<ul>${[`${escapeHtml(vol2.boss || '')} (boss)`].concat(vol2.adds.map((a) => escapeHtml(a))).map((a) => `<li>${a}</li>`).join('')}</ul>`
         : `${escapeHtml(vol2.boss || '')}`}
       ${vol2.strategy
         ? `<details class="amb-details" style="margin-top:6px">
              <summary>Strategy</summary>
              <div class="amb-strat-text">${escapeHtml(vol2.strategy).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>
            </details>`
         : ''}</div>`
    : '';

  // Key items
  const keyItems = ambuscade.keyItems || [];
  const keyItemsHtml = keyItems.length
    ? `<div class="ambuscade-section"><strong>Key item locations:</strong>
         <div class="ambuscade-keys">${keyItems.map((item) =>
           `<div class="ambuscade-key">
              <div class="ambuscade-key-name">${escapeHtml(item.name)}${item.count > 0 ? ' <span class="owned">✓ owned</span>' : ''}</div>
              <div class="ambuscade-key-mobs">${item.mobs.map((mob) => `<span>${escapeHtml(mob)}</span>`).join('<br>')}</div>
            </div>`).join('')}</div></div>`
    : '<div class="ambuscade-section muted">Key item locations not available.</div>';

  ambuscadePanelEl.innerHTML = source + bossList + notesHtml + strategiesHtml + vol2Html + keyItemsHtml;
}

// ── Character tab ────────────────────────────────────────────────

const charNameEl    = document.getElementById('charName');
const charJobLineEl = document.getElementById('charJobLine');
const jobGridEl     = document.getElementById('jobGrid');
const equipListEl   = document.getElementById('equipList');
const equipTooltipEl = document.getElementById('equipTooltip');

function showEquipTooltip(rowEl, desc) {
  if (!desc) return;
  equipTooltipEl.textContent = desc;
  // Place off-screen first so offsetHeight is measurable
  equipTooltipEl.style.top  = '-9999px';
  equipTooltipEl.style.left = '-9999px';
  equipTooltipEl.classList.add('visible');

  const rect = rowEl.getBoundingClientRect();
  const th   = equipTooltipEl.offsetHeight;
  const tw   = equipTooltipEl.offsetWidth;
  const top  = (window.innerHeight - rect.bottom >= th + 8)
    ? rect.bottom + 4
    : rect.top - th - 4;
  const left = Math.min(rect.left, window.innerWidth - tw - 8);
  equipTooltipEl.style.top  = `${Math.max(4, top)}px`;
  equipTooltipEl.style.left = `${Math.max(4, left)}px`;
}

function hideEquipTooltip() {
  equipTooltipEl.classList.remove('visible');
}

function renderCharacter(data) {
  // ── Header ──────────────────────────────────────────────────────
  charNameEl.textContent = data.character || '—';

  const mainName = data.mainJob ? (JOBS[data.mainJob - 1] || '???') : null;
  const subName  = data.subJob  ? (JOBS[data.subJob  - 1] || null)  : null;
  const mainLv   = data.mainJobLevel || null;
  const subLv    = data.subJobLevel  || null;

  let jobLine = mainName ? `${mainName}${mainLv ?? ''}` : '';
  if (subName && subLv) jobLine += `/${subName}${subLv}`;
  charJobLineEl.textContent = jobLine;

  // ── Job levels grid ─────────────────────────────────────────────
  const levels = Array.isArray(data.jobLevels) ? data.jobLevels : [];
  jobGridEl.innerHTML = JOBS.map((name, i) => {
    const lvl    = levels[i] || 0;
    const isMain = data.mainJob === i + 1;
    const isSub  = data.subJob  === i + 1;
    const cls = isMain ? 'job-cell is-main'
              : isSub  ? 'job-cell is-sub'
              : lvl > 0 ? 'job-cell'
              :            'job-cell is-locked';
    return `<div class="${cls}">
      <span class="job-abbr">${name}</span>
      <span class="job-lvl">${lvl > 0 ? lvl : '—'}</span>
    </div>`;
  }).join('');

  // ── Equipment list ───────────────────────────────────────────────
  const bySlot = {};
  for (const eq of (data.equipment || [])) bySlot[eq.slot] = eq;

  equipListEl.innerHTML = EQUIP_SLOTS.map((label, slot) => {
    const eq = bySlot[slot];
    if (!eq) {
      return `<div class="equip-row equip-empty">
        <span class="equip-slot-label">${label}</span>
        <span class="equip-item-name muted">—</span>
      </div>`;
    }
    return `<div class="equip-row" data-desc="${escapeHtml(eq.description || '')}">
      <span class="equip-slot-label">${label}</span>
      <span class="equip-item-name">${escapeHtml(eq.name)}</span>
      <button class="equip-wiki-btn" data-wiki="${escapeHtml(eq.name)}" title="BG-Wiki">↗</button>
    </div>`;
  }).join('');

  // Tooltip events
  equipListEl.querySelectorAll('.equip-row[data-desc]').forEach((row) => {
    row.addEventListener('mouseenter', () => showEquipTooltip(row, row.dataset.desc));
    row.addEventListener('mouseleave', hideEquipTooltip);
  });

  // Wiki button events
  equipListEl.querySelectorAll('.equip-wiki-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.itemscan.openExternal(
        `https://www.bg-wiki.com/ffxi/${encodeURIComponent(btn.dataset.wiki)}`
      );
    });
  });
}

window.itemscan.onInventory(async (data) => {
  errorEl.classList.add('hidden');
  currentData = data;
  allItems = data.items;
  currentCharacter = data.character;

  try {
    const cached = await window.itemscan.getCachedPrices(allItems.map((it) => it.id));
    for (const [id, result] of Object.entries(cached)) {
      priceCache.set(Number(id), result);
    }
  } catch (_) { /* non-fatal */ }

  const when = data.timestamp
    ? new Date(data.timestamp * 1000).toLocaleTimeString()
    : 'unknown time';
  metaEl.textContent = `${data.character} — ${data.count} items — scanned ${when}`;

  renderDashboard(data);
  renderStats();
  renderQuests(data.activeQuests);
  renderAmbuscade(data.ambuscade);
  renderMissions(data.missions, data.character);
  renderRoe(data.roe, data.character);
  renderCharacter(data);
  render();
});

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
      mapMsgEl.innerHTML = `No image for <b>${escapeHtml(p.mapName)}.png</b>. `
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
    + 'Run /itemscan in-game to create it, or set your Ashita itemscan folder '
    + 'in the Config tab (Browse…).';
  errorEl.classList.remove('hidden');
});

// ── Sort headers (items table) ───────────────────────────────────

function updateSortHeaders() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    const base = th.dataset.label || (th.dataset.label = th.textContent);
    th.textContent = th.dataset.key === sortState.key
      ? base + (sortState.dir === 1 ? ' ▲' : ' ▼')
      : base;
  });
}

document.querySelectorAll('th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (sortState.key === key) sortState.dir *= -1;
    else { sortState.key = key; sortState.dir = 1; }
    updateSortHeaders();
    render();
  });
});

// ── Click handlers ───────────────────────────────────────────────

// Items table: wiki link opens browser; row click opens detail panel
rowsEl.addEventListener('click', (e) => {
  const wikiEl = e.target.closest('.wikilink');
  if (wikiEl) {
    window.itemscan.openExternal(
      `https://www.bg-wiki.com/ffxi/${encodeURIComponent(wikiEl.dataset.wiki)}`
    );
    return;
  }
  const row = e.target.closest('.item-row');
  if (row) openDetail(parseInt(row.dataset.index, 10));
});

// Detail panel: close on overlay backdrop click
document.getElementById('detailOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDetail();
});

document.getElementById('detailClose').addEventListener('click', closeDetail);

document.getElementById('detailPrev').addEventListener('click', () => {
  if (detailIndex > 0) { detailIndex--; renderDetailContent(); }
});
document.getElementById('detailNext').addEventListener('click', () => {
  if (detailIndex < visibleItems.length - 1) { detailIndex++; renderDetailContent(); }
});

// Wiki links in detail panel content
document.getElementById('detailContent').addEventListener('click', (e) => {
  const link = e.target.closest('.mission-link');
  if (link && link.dataset.wiki) {
    window.itemscan.openExternal(
      `https://www.bg-wiki.com/ffxi/${encodeURIComponent(link.dataset.wiki)}`
    );
  }
});

// Mission + quest name wiki links in list views
function wireWikiLinks(container) {
  container.addEventListener('click', (e) => {
    const link = e.target.closest('.mission-link');
    if (link && link.dataset.wiki) {
      window.itemscan.openExternal(
        `https://www.bg-wiki.com/ffxi/${encodeURIComponent(link.dataset.wiki)}`
      );
    }
  });
}
wireWikiLinks(missionGridEl);
wireWikiLinks(questListEl);

// ── Toolbar button wiring (sort / filter) ────────────────────────

document.addEventListener('click', (e) => {
  const sortQuest = e.target.closest('[data-sort-quest]');
  if (sortQuest) {
    document.querySelectorAll('[data-sort-quest]').forEach((b) => b.classList.remove('active'));
    sortQuest.classList.add('active');
    questSortState = sortQuest.dataset.sortQuest;
    applyQuestRender();
    return;
  }

  const sortMission = e.target.closest('[data-sort-mission]');
  if (sortMission) {
    document.querySelectorAll('[data-sort-mission]').forEach((b) => b.classList.remove('active'));
    sortMission.classList.add('active');
    missionSortState = sortMission.dataset.sortMission;
    applyMissionRender();
    return;
  }

  const filterMission = e.target.closest('[data-filter-mission]');
  if (filterMission) {
    document.querySelectorAll('[data-filter-mission]').forEach((b) => b.classList.remove('active'));
    filterMission.classList.add('active');
    missionFilterState = filterMission.dataset.filterMission;
    applyMissionRender();
    return;
  }

  const sortRoe = e.target.closest('[data-sort-roe]');
  if (sortRoe) {
    document.querySelectorAll('[data-sort-roe]').forEach((b) => b.classList.remove('active'));
    sortRoe.classList.add('active');
    roeSortState = sortRoe.dataset.sortRoe;
    applyRoeRender();
    return;
  }

  const filterQuest = e.target.closest('[data-filter-quest]');
  if (filterQuest) {
    document.querySelectorAll('[data-filter-quest]').forEach((b) => b.classList.remove('active'));
    filterQuest.classList.add('active');
    applyQuestRender();
  }
});

// Search inputs
document.getElementById('questSearch').addEventListener('input', (e) => {
  questSearchQuery = e.target.value;
  applyQuestRender();
});
document.getElementById('roeSearch').addEventListener('input', (e) => {
  roeSearchQuery = e.target.value;
  applyRoeRender();
});

// ── Items filter controls ────────────────────────────────────────

searchEl.addEventListener('input', render);
onlyVendorEl.addEventListener('change', render);
onlyGobbieEl.addEventListener('change', render);
onlyQuestEl.addEventListener('change', render);
getPricesEl.addEventListener('click', fetchAllPrices);

const speedCfgEl = document.getElementById('speedCfg');
function applySpeed(value) {
  speedEl.value = String(value);
  speedCfgEl.value = String(value);
  window.itemscan.setConcurrency(parseInt(value, 10));
}
speedEl.addEventListener('change', () => { applySpeed(speedEl.value); localStorage.setItem('speed', speedEl.value); });
speedCfgEl.addEventListener('change', () => { applySpeed(speedCfgEl.value); localStorage.setItem('speed', speedCfgEl.value); });
applySpeed(localStorage.getItem('speed') || speedEl.value);

// ── In-game config toggles ───────────────────────────────────────

const cfgAutoEl = document.getElementById('cfgAuto');
const cfgMapEl = document.getElementById('cfgMap');

async function refreshAddonConfig() {
  try {
    const cfg = await window.itemscan.getAddonConfig();
    cfgAutoEl.checked = Boolean(cfg.auto);
    cfgMapEl.checked = Boolean(cfg.maptrack);
  } catch (_) { /* ignore */ }
}
function writeAddonConfig() {
  window.itemscan.setAddonConfig({ auto: cfgAutoEl.checked, maptrack: cfgMapEl.checked });
}
cfgAutoEl.addEventListener('change', writeAddonConfig);
cfgMapEl.addEventListener('change', writeAddonConfig);
refreshAddonConfig();

// ── Tab switching ────────────────────────────────────────────────

function activateTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  if (name === 'config') refreshAddonConfig();
}
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
});

// ── Default tab + config paths ───────────────────────────────────

const defaultTabEl = document.getElementById('defaultTabCfg');
const savedTab = localStorage.getItem('defaultTab') || 'items';
defaultTabEl.value = savedTab;
defaultTabEl.addEventListener('change', () => localStorage.setItem('defaultTab', defaultTabEl.value));
if (savedTab !== 'items') activateTab(savedTab);

document.getElementById('openMapsCfg').addEventListener('click', () => {
  window.itemscan.openMapsFolder();
});

async function refreshConfigInfo() {
  try {
    const info = await window.itemscan.getConfigInfo();
    document.getElementById('cfgAddonDir').textContent = info.addonDir;
    document.getElementById('cfgMapsDir').textContent = info.mapsDir;
    document.getElementById('cfgInvPath').textContent = info.inventoryPath;
    document.getElementById('cfgUserData').textContent = info.userData;
  } catch (_) { /* ignore */ }
}
refreshConfigInfo();

document.getElementById('browseAddonDir').addEventListener('click', async () => {
  try { await window.itemscan.browseAddonDir(); refreshConfigInfo(); } catch (_) { /* ignore */ }
});

const reloadAddonBtn = document.getElementById('reloadAddon');
reloadAddonBtn.addEventListener('click', async () => {
  reloadAddonBtn.disabled = true;
  reloadAddonBtn.textContent = 'Reloading…';
  const ok = await window.itemscan.reloadAddon();
  reloadAddonBtn.textContent = ok ? 'Sent ✓' : 'Failed ✗';
  setTimeout(() => {
    reloadAddonBtn.textContent = 'Reload in-game';
    reloadAddonBtn.disabled = false;
  }, 3000);
});

async function initMapsDirHint() {
  try {
    mapDirHintEl.textContent = await window.itemscan.getMapsDir();
  } catch (_) {
    mapDirHintEl.textContent = '';
  }
}

openMapsFolderEl.addEventListener('click', async () => {
  try {
    mapDirHintEl.textContent = await window.itemscan.openMapsFolder();
  } catch (err) {
    mapMsgEl.textContent = 'Could not open maps folder: ' + err.message;
    mapMsgEl.style.display = '';
  }
});

initMapsDirHint();

// ── Feedback modal ────────────────────────────────────────────────────────────
const feedbackOverlay  = document.getElementById('feedbackOverlay');
const feedbackBtn      = document.getElementById('feedbackBtn');
const feedbackClose    = document.getElementById('feedbackClose');
const fbType           = document.getElementById('fbType');
const fbFramework      = document.getElementById('fbFramework');
const fbTitle          = document.getElementById('fbTitle');
const fbDescription    = document.getElementById('fbDescription');
const fbSubmit         = document.getElementById('fbSubmit');
const fbStatus         = document.getElementById('fbStatus');

feedbackBtn.addEventListener('click', () => {
  feedbackOverlay.classList.remove('hidden');
  fbTitle.focus();
});

feedbackClose.addEventListener('click', () => feedbackOverlay.classList.add('hidden'));

feedbackOverlay.addEventListener('click', (e) => {
  if (e.target === feedbackOverlay) feedbackOverlay.classList.add('hidden');
});

fbSubmit.addEventListener('click', async () => {
  const title = fbTitle.value.trim();
  if (!title) { fbStatus.textContent = 'Please enter a title.'; fbStatus.className = 'fb-status err'; return; }
  fbSubmit.disabled = true;
  fbStatus.textContent = 'Sending…';
  fbStatus.className = 'fb-status';
  const result = await window.itemscan.sendFeedback({
    type:        fbType.value,
    framework:   fbFramework.value,
    title,
    description: fbDescription.value.trim(),
  });
  if (result.ok) {
    fbStatus.textContent = 'Sent! Thank you.';
    fbStatus.className = 'fb-status ok';
    fbTitle.value = '';
    fbDescription.value = '';
    setTimeout(() => feedbackOverlay.classList.add('hidden'), 1500);
  } else {
    fbStatus.textContent = 'Failed to send — check your connection.';
    fbStatus.className = 'fb-status err';
  }
  fbSubmit.disabled = false;
});
