# FFXI Item Scan

A second-monitor companion app for **Final Fantasy XI**. An in-game Lua addon streams your character's inventory, position, and progression data directly to the app over a local TCP socket, no files written, no polling, no alt-tabbing required.

Built for **Ashita v4**. Windower support is not supported; the Ashita build is the primary one I use and maintain.

---

## Community & Feedback

Use the built-in **Feedback** button in the app to send bug reports or feature ideas directly. If you prefer Discord, the **[SigynVS Labs Discord](https://discord.gg/ahduPcRfZ6)** is still available too.

---

## What it shows

| Tab | Description |
|-----|-------------|
| **Items** | Every item across all bags, including gear stored on Porter Moogle slips, with description, live FFXIAH market price, AH median, Rare/Ex badges, total inventory value, sortable columns, filters, and a per-item BG-Wiki link |
| **Dashboard** | Gobbiebag quest completion tracker, knows which steps you've done from your inventory size, flags items you own |
| **Character** | Your character name, main/sub job line, all 22 job levels in a grid (main/sub highlighted), and every equipped piece of gear with hover-over stat descriptions and BG-Wiki links |
| **Map** | Current zone map with a directional arrow showing your position and which way you are facing in real time, plus zoom, pan, and a center-on-player toggle |
| **Records of Eminence** | Active objectives with progress, named and labeled |
| **Quests** | Active (accepted, not completed) quests by area, named and BG-Wiki linked |
| **Ambuscade** | Monthly boss reference |
| **Missions** | Current stage for every storyline (Nation, Zilart, CoP, ToAU, Assault, WotG, Adoulin, Rhapsodies, Voracious, and the add-on scenarios), each a clickable BG-Wiki link |
| **Config** | In-game addon toggles, path settings, a quick-reference command list, and one-click **Install/update** and **Reload addon** buttons |

---

## Requirements

- Windows 10 or 11
- Final Fantasy XI (retail or private server)
- **Ashita v4**
- Node.js 18+ (only if building from source)

---

## Install

### Step 1, Download the app

Grab the latest **`FFXI Item Scan Setup.exe`** from the [Releases](../../releases) page and run it.

> **Windows SmartScreen** may warn "unknown publisher." Click **More info → Run anyway**. The installer is per-user and requires no admin rights.

---

### Step 2, Install the addon

#### Ashita v4

1. In the app's **Config** tab, confirm or **Browse…** to your Ashita `addons` folder, then click **Install / update**. This copies the addon files into place for you.

   Prefer to do it by hand? Copy both `addon/itemscan.lua` and `addon/slips.lua` from this repo into:

   ```
   <Ashita>\addons\itemscan\
   ```

2. Add it to your Ashita boot script so it loads automatically on every login:

   **`<Ashita>\scripts\default.txt`**
   ```
   /addon load itemscan
   ```

3. The addon auto-scans on load, no in-game commands needed after that.

#### Windower

Not supported. Ashita v4 remains the main setup for this repo.

---

### Step 3, Launch the app and play

That's it. The app auto-detects standard Ashita install paths and auto-scan is on by default, so data updates the moment your inventory changes.

If the app can't find your addon folder (non-standard install location), open the **Config** tab → **Ashita itemscan folder** → **Browse…** and point it at `<Ashita>\addons\itemscan\`.

---

## Reloading the addon

If you update the Lua file while FFXI is running, click **Reload addon** in the Config tab. The app writes a flag file that the running addon picks up within ~2 seconds, reloads itself, and auto-scans. No in-game typing required.

---

## In-game commands

| Command | Effect |
|---------|--------|
| `/itemscan` | Scan now and send data to the viewer |
| `/itemscan auto` | Toggle auto-rescan on inventory/equipment changes |
| `/itemscan map` | Toggle live position tracking for the Map tab |
| `/itemscan missions` | Print current mission stages to chat |
| `/itemscan roe` | Print active RoE objectives to chat |
| `/itemscan quests` | Print active quest counts by area to chat |
| `/itemscan dumpresources` | Rebuild the item name database (run once after a game update adds new items) |

---

## Maps

Map images are not bundled (large third-party assets). To enable the live position arrow:

1. Open the **Map** tab and click **Download map pack**, the app downloads and installs everything automatically (~209 MB).
2. Enable **Map tracking** via the Config tab or `/itemscan map` in-game.

---

## Notes

### Windower

Not supported.

### All users
- FFXIAH price lookups are throttled and cached 24h, so they are not instant
- Map arrow requires the remapster PNG pack in your selected maps folder
- Private server item IDs may differ from retail; some item names may show as Unknown

---

## Build from source

```bash
git clone https://github.com/SigynVS/ffxi-itemscan-viewer.git
cd ffxi-itemscan-viewer
npm install
npm start            # run in dev mode
npm run dist         # build the Windows installer into dist/
```

---

## Security

The app runs with `contextIsolation`, `sandbox`, and a strict Content Security Policy. All external data, inventory payloads from the addon and IPC arguments from the renderer, is schema-validated before use. A security audit log is written to `%APPDATA%\ffxi-itemscan-viewer\security.log`.

The app makes outbound requests for FFXIAH price lookups and the optional
Ambuscade data refresh.

---

## Credits

This project builds on the FFXI community's reverse-engineering work:

- **[Electron-FFXI-Atlas](https://github.com/miguelstrife/Electron-FFXI-Atlas)**, per-zone map calibration data and game→pixel coordinate formula
- **[remapster_maps](https://github.com/AkadenTK/remapster_maps)**, map image packs (user-supplied, not redistributed here)
- **[Ivaar's Windower QuestLog](https://github.com/Ivaar/Windower-addons)**, active-quest name tables
- **[find](https://github.com/Sippius/Ashita-v4-addons)** by MalRD, zombie343, and sippius (MIT licensed), storage slip content roster data
- **[DarkstarProject](https://github.com/DarkstarProject/darkstar)**, mission and assault ID references
- **[Windower](https://github.com/Windower/Lua)**, packet structure references
- **BG-Wiki**, mission, quest, and Gobbiebag data

---

## License

MIT, this project's code. Bundled third-party data belongs to the projects credited above.
