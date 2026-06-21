'use strict';

const fs = require('fs');

const { cachePath } = require('./paths');

// -------------------------------------------------------------------------
// Live FFXIAH price lookup.
//
// FFXIAH has NO official API. This module scrapes the public item page at
// https://www.ffxiah.com/item/<id>, which is ToS-gray, so it is deliberately
// conservative:
//   - Every result is cached on disk for CACHE_TTL_MS (default 24h), so a given
//     item is fetched at most ~once per day no matter how often you scan.
//   - Requests are serialized through a queue with MIN_INTERVAL_MS between them,
//     so we never burst the server.
//   - Any failure returns null; the UI silently falls back to the vendor price.
//
// If FFXIAH changes their HTML, only PRICE_REGEX below should need updating.
// -------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'ffxi-itemscan-viewer/0.1 (personal inventory tool)';

// Per-request base delay + random jitter, applied inside each worker lane so
// concurrent workers don't fire in lockstep bursts.
const BASE_DELAY_MS = 300;
const JITTER_MS = 500;

// How many fetches may be in flight at once. Tunable from the UI; kept modest
// by default to stay gentle on FFXIAH (1 = original serial behaviour).
let concurrency = 3;

// Median price appears in the page's embedded data; this matches the common
// "median":<number> field. Fragile by nature — see note above.
const PRICE_REGEX = /"median"\s*:\s*(\d+)/i;

let cache = null;
let active = 0;          // workers currently in flight
const pending = [];      // queued { itemId, hit, resolve }

function loadCache() {
  if (cache !== null) {
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
  } catch (err) {
    cache = {};
  }
  return cache;
}

function saveCache() {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(cache, null, 2));
  } catch (err) {
    // Non-fatal: a failed cache write just means we may refetch next time.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Performs a single fetch + parse for one item id (no throttling here; pacing
// is handled by the worker lane before this is called).
async function fetchPrice(itemId) {
  const res = await fetch(`https://www.ffxiah.com/item/${itemId}`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const html = await res.text();
  const match = html.match(PRICE_REGEX);
  return match ? parseInt(match[1], 10) : null;
}

// Drains the pending queue, keeping up to `concurrency` workers in flight.
function pump() {
  while (active < concurrency && pending.length > 0) {
    const task = pending.shift();
    active += 1;
    runTask(task);
  }
}

// One worker lane: jittered delay, fetch, cache, resolve, then pull the next.
async function runTask({ itemId, hit, resolve }) {
  await sleep(BASE_DELAY_MS + Math.random() * JITTER_MS);
  const store = loadCache();
  try {
    const price = await fetchPrice(itemId);
    store[String(itemId)] = { price, ts: Date.now() };
    saveCache();
    resolve({ price, cached: false, error: null });
  } catch (err) {
    resolve({ price: hit ? hit.price : null, cached: Boolean(hit), error: err.message });
  } finally {
    active -= 1;
    pump();
  }
}

// Public: returns { price, cached, error } for an item id, served from cache
// when fresh, otherwise queued through the concurrency-limited worker pool.
function getPrice(itemId) {
  const store = loadCache();
  const hit = store[String(itemId)];
  if (hit && (Date.now() - hit.ts) < CACHE_TTL_MS) {
    return Promise.resolve({ price: hit.price, cached: true, error: null });
  }
  return new Promise((resolve) => {
    pending.push({ itemId, hit, resolve });
    pump();
  });
}

// Returns already-cached prices for the given item ids WITHOUT any network
// fetch. Used on startup so saved prices show immediately. Entries past the TTL
// are still returned but flagged stale so the UI can mark them.
function getCachedPrices(itemIds) {
  const store = loadCache();
  const now = Date.now();
  const out = {};
  for (const id of itemIds) {
    const hit = store[String(id)];
    if (hit) {
      out[id] = {
        price: hit.price,
        cached: true,
        stale: (now - hit.ts) >= CACHE_TTL_MS,
        error: null
      };
    }
  }
  return out;
}

// Adjusts how many fetches run in parallel (clamped 1..8). Higher = faster but
// more aggressive on FFXIAH.
function setConcurrency(n) {
  concurrency = Math.max(1, Math.min(8, Math.floor(n) || 1));
  pump();
  return concurrency;
}

module.exports = { getPrice, getCachedPrices, setConcurrency };
