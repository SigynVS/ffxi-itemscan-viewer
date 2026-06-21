# FFXI Item Scan Viewer

A second-monitor desktop app (Electron) that reads the `inventory.json` written by
the **itemscan** Ashita addon and shows, for every item you own:

- **What it is** — the in-game item description (FFXI text decoded to clean UTF-8,
  including elemental tags like `[Fire]` / `[Ice]`).
- **What it's worth** — a bundled vendor price *and* a live FFXIAH median price
  (fetched in a configurable-concurrency pool, cached 24h).
- **Gobbiebag** — whether the item is accepted by a Gobbiebag inventory-expansion
  quest, plus a completion-aware progress panel (derived from your inventory size).
- **Quests / Missions** — a per-item BG-Wiki link (authoritative "Used in Quest"
  data), plus any verified entries you add to `quests.json`.
- **Totals & character** — your nation/mission rank and the summed AH value of your
  whole inventory (updates live as prices load).

Sortable columns (click headers), live filters, and a Speed selector (1×–8×) that
controls how many FFXIAH fetches run in parallel.

## Architecture

Two parts talk over a single file — no networking inside the game client:

```
Ashita addon (Lua)            Electron viewer (this repo)
  itemscan.lua                  src/main.js     - watches inventory.json
   walks every container         src/lib/enrich  - joins bundled datasets
   resolves name + desc          src/lib/ffxiah  - live FFXIAH price (cached)
   writes inventory.json  ─────► src/renderer    - table on your 2nd monitor
```

The addon lives at `C:\Ashita4\addons\itemscan\itemscan.lua`.

## Setup

```powershell
cd C:\Users\scoot\OneDrive\Documents\GitHub\ffxi-itemscan-viewer
npm install
npm start
```

In-game, load the addon once and scan:

```
/addon load itemscan
/itemscan          # writes inventory.json; the viewer updates instantly
/itemscan auto     # optional: re-export whenever inventory changes
```

If your Ashita install is not at `C:\Ashita4`, set the path before launching:

```powershell
$env:ITEMSCAN_PATH = "D:\Games\Ashita4\addons\itemscan\inventory.json"; npm start
```

## The datasets (`data/`)

Datasets are keyed by **exact in-game item name** (the `name` field in
`inventory.json`) — verifiable and human-editable, no item-id lookups needed.
The app works without them (columns show `—`); live FFXIAH prices work regardless.

| File | Shape | Status | Source |
|------|-------|--------|--------|
| `gobbiebag.json` | `{ "<name>": "<note>" }` | **populated** (all 10 Gobbiebag quests, 40 items) | BG-Wiki Inventory 101 |
| `vendor_prices.json` | `{ "<name>": <gil> }` | empty | BG-Wiki NPC sell prices |
| `quests.json` | `{ "<name>": ["Quest A", "Mission B"] }` | empty | BG-Wiki item "Used in Quest" |

Example:

```json
{ "Potion": 7 }                       // vendor_prices.json
{ "Darksteel Ingot": "Gobbiebag IV" } // gobbiebag.json
{ "Persikos au Lait": ["Sweets for the Soul"] } // quests.json
```

## FFXIAH note

FFXIAH has no official API. This app scrapes the public item page, which is against
their ToS if abused, so it is deliberately gentle: one request at a time, ≥1.5s
apart, every result cached on disk for 24h (`data/price_cache.json`, git-ignored).
Use it for personal inventory review, not bulk harvesting.

## Status

- Part 1 (Lua exporter): done, output verified as valid UTF-8 with correct element decoding.
- Part 2 (this viewer): file-watch, enrichment, UI, and throttled FFXIAH lookups implemented.
- Datasets ship empty by design — populate vendor/gobbiebag/quest data as needed.
