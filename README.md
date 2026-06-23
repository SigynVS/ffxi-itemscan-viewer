# FFXI Item Scan

A second-monitor companion app for **Final Fantasy XI** (Ashita v4). An in-game
Lua addon exports your character data to a file; a desktop app reads it and shows
it on your other screen — live, no alt-tabbing.

## What it shows

- **Items** — every item across all your bags, with the in-game description
  (element tags like `[Fire]`/`[Ice]` included), **live FFXIAH market prices**,
  total inventory value, sortable columns, filters, and a per-item wiki link.
- **Gobbiebag** — completion-aware progress for all 10 inventory-expansion quests
  (knows which parts you've done from your inventory size) and flags items you own.
- **Records of Eminence** — your active objectives with progress, named, plus
  editable labels for anything custom.
- **Missions** — current mission for every storyline (Nation, Zilart, CoP, Aht
  Urhgan, Assault, WotG, Adoulin, Rhapsodies, Voracious, and the three add-on
  scenarios), each a clickable BG-Wiki link.
- **Quests** — your active (accepted-not-completed) quests, named and wiki-linked.
- **Map** — your current zone's map with a live "you are here" dot that tracks you.

## Requirements

- Windows, **Ashita v4**, and FFXI.
- (Optional, for the Map tab) a map-image pack — see [Maps](#maps).

## Install

### 1. The addon
Copy the `addon/itemscan.lua` from this repo into a new folder in your Ashita
addons directory, so it lives at:
```
<your Ashita>\addons\itemscan\itemscan.lua
```
Load it in-game with `/addon load itemscan`. To load it automatically every
launch, add `/addon load itemscan` to your Ashita boot script
(`<Ashita>\scripts\default.txt`).

### 2. The app
Download the latest **`FFXI Item Scan Setup`** installer from the
[Releases](../../releases) page and run it.

> **Windows SmartScreen** will warn "unknown publisher" (the installer isn't code
> signed). Click **More info → Run anyway**. It installs per-user, no admin needed,
> and creates a desktop shortcut.

### 3. Point the app at your Ashita
First launch, open the **Config** tab → **Ashita itemscan folder** → **Browse…**
and select your `<Ashita>\addons\itemscan` folder. (It auto-detects `C:\Ashita4`.)

### 4. Scan
In-game: `/itemscan` once to populate, or flip **Auto-scan** on in the Config tab
so it stays current automatically. Drag the app to your second monitor — done.

## Maps

Map images aren't bundled (they're large, third-party assets). To enable the live
map:
1. Download **`remapster-wiki-pack-1-1024.zip`** (and pack-2 for full coverage)
   from [AkadenTK/remapster_maps releases](https://github.com/AkadenTK/remapster_maps/releases).
2. In the app's **Map** tab (or Config), click **Open maps folder** and unzip the
   PNGs directly into it.
3. In-game, toggle **Map tracking** on (Config tab) and walk around.

## Config tab

- **In-game addon** — Auto-scan and Map-tracking toggles that drive the addon
  directly (no commands needed; stay in sync with `/itemscan auto` / `map`).
- **App settings** — Ashita folder, AH fetch speed, default tab, paths.
- **In-game commands** — reference for the `/itemscan` commands.

## Notes

- **FFXIAH prices** are scraped from the public site (no official API exists) —
  done gently (throttled, cached 24h) and intended for personal inventory review.
- The app and addon talk over plain files in your addon folder; nothing is sent
  anywhere except the FFXIAH price lookups you trigger.

## Build from source

```
npm install
npm start          # run in dev
npm run dist       # build the Windows installer into dist/
```

## Credits

This project stands on the FFXI community's reverse-engineering work:

- **[Electron-FFXI-Atlas](https://github.com/miguelstrife/Electron-FFXI-Atlas)** —
  the per-zone map calibration data and game→pixel formula.
- **[remapster_maps](https://github.com/AkadenTK/remapster_maps)** — the map image
  packs (user-supplied, not redistributed here).
- **[Ivaar's Windower QuestLog](https://github.com/Ivaar/Windower-addons)** — the
  active-quest name tables.
- **[DarkstarProject](https://github.com/DarkstarProject/darkstar)** — mission and
  assault id references.
- **[Windower](https://github.com/Windower/Lua)** — packet structure references.
- **BG-Wiki** — mission/quest/Gobbiebag data.

## License

MIT (this project's code). Bundled third-party data belongs to the projects
credited above.
