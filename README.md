# FFXI Item Scan

A second-monitor companion app for **Final Fantasy XI**. An in-game Lua addon streams your character's inventory, position, and progression data directly to the app over a local TCP socket — no files written, no polling, no alt-tabbing required.

Built for **Ashita v4**. Windower support is planned but is not working in this beta.

> **Beta** — This is an early release. Please report bugs using the **Feedback** button in the app or by joining the [SigynVS Labs Discord](https://discord.gg/ahduPcRfZ6).

---

## Community & Feedback

Join the **[SigynVS Labs Discord](https://discord.gg/ahduPcRfZ6)** to report bugs or request features.

You can also use the built-in **Feedback** button (top-right of the app) to send a report directly — no Discord account needed.

---

## What it shows

| Tab | Description |
|-----|-------------|
| **Items** | Every item across all bags with description, live FFXIAH market price, AH median, total inventory value, sortable columns, filters, and a per-item BG-Wiki link |
| **Dashboard** | Gobbiebag quest completion tracker — knows which steps you've done from your inventory size, flags items you own |
| **Character** | Your character name, main/sub job line, all 22 job levels in a grid (main/sub highlighted), and every equipped piece of gear with hover-over stat descriptions and BG-Wiki links |
| **Map** | Current zone map with a live "you are here" dot that tracks your position in real time |
| **Records of Eminence** | Active objectives with progress, named and labeled |
| **Quests** | Active (accepted, not completed) quests by area, named and BG-Wiki linked |
| **Ambuscade** | Monthly boss reference |
| **Missions** | Current stage for every storyline (Nation, Zilart, CoP, ToAU, Assault, WotG, Adoulin, Rhapsodies, Voracious, and the add-on scenarios), each a clickable BG-Wiki link |
| **Config** | In-game addon toggles, path settings, quick-reference command list, and a one-click **Reload addon** button |

---

## Requirements

- Windows 10 or 11
- Final Fantasy XI (retail or private server)
- **Ashita v4** (Windower support is planned but not working in this beta)
- Node.js 18+ (only if building from source)

---

## Install

### Step 1 — Download the app

Grab the latest **`FFXI Item Scan Setup.exe`** from the [Releases](../../releases) page and run it.

> **Windows SmartScreen** may warn "unknown publisher." Click **More info → Run anyway**. The installer is per-user and requires no admin rights.

---

### Step 2 — Install the addon

#### Ashita v4

1. Copy `addon/itemscan.lua` from this repo into a new folder inside your Ashita addons directory:

   ```
   <Ashita>\addons\itemscan\itemscan.lua
   ```

2. Add it to your Ashita boot script so it loads automatically on every login:

   **`<Ashita>\scripts\default.txt`**
   ```
   /addon load itemscan
   ```

3. The addon auto-scans on load — no in-game commands needed after that.

#### Windower

Not supported in this beta. The Windower addon still uses the old file-based
design and cannot connect to the app's TCP server yet. Windower support will
return once the addon is rewritten for TCP. Use Ashita v4 for now.

---

### Step 3 — Launch the app and play

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

Map images are not bundled (large third-party assets). To enable the live position dot:

1. Open the **Map** tab and click **Download map pack** — the app downloads and installs everything automatically (~209 MB).
2. Enable **Map tracking** via the Config tab or `/itemscan map` in-game.

---

## Known issues & beta notes

### Windower (not yet supported)

The Windower addon still uses the old file-based design and cannot talk to the current TCP app, so it does not work in this beta. Windower support will return once the addon is rewritten for the TCP connection. Ashita v4 is the only supported framework right now.

### All users
- FFXIAH price lookups are throttled and cached 24h — they're not instant
- Map dot requires the remapster PNG pack (not bundled) — see [Maps](#maps) section
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

The app runs with `contextIsolation`, `sandbox`, and a strict Content Security Policy. All external data — the inventory.json written by the addon, IPC arguments from the renderer — is schema-validated before use. A security audit log is written to `%APPDATA%\ffxi-itemscan-viewer\security.log`.

The only outbound network requests are the FFXIAH price lookups you explicitly trigger.

---

## Credits

This project builds on the FFXI community's reverse-engineering work:

- **[Electron-FFXI-Atlas](https://github.com/miguelstrife/Electron-FFXI-Atlas)** — per-zone map calibration data and game→pixel coordinate formula
- **[remapster_maps](https://github.com/AkadenTK/remapster_maps)** — map image packs (user-supplied, not redistributed here)
- **[Ivaar's Windower QuestLog](https://github.com/Ivaar/Windower-addons)** — active-quest name tables
- **[DarkstarProject](https://github.com/DarkstarProject/darkstar)** — mission and assault ID references
- **[Windower](https://github.com/Windower/Lua)** — packet structure references
- **BG-Wiki** — mission, quest, and Gobbiebag data

---

## License

MIT — this project's code. Bundled third-party data belongs to the projects credited above.
