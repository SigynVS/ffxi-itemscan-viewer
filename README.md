# FFXI Item Scan

A second-monitor companion app for **Final Fantasy XI**. An in-game Lua addon exports your character's data to a local file; a desktop Electron app reads it and displays everything live on your other screen — no alt-tabbing required.

Supports both **Ashita v4** and **Windower** addon frameworks.

> **Beta** — This is an early release. Please report bugs using the **Feedback** button in the app or by joining the [SigynVS Labs Discord](https://discord.gg/ahduPcRfZ6).

---

## Community & Feedback

Join the **[SigynVS Labs Discord](https://discord.gg/ahduPcRfZ6)** to report bugs, request features, or help test the Windower port.

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
- **Ashita v4** *or* **Windower** (choose one based on what you already use)
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

1. Copy `addon/itemscan_windower.lua` from this repo, rename it to `itemscan.lua`, and place it in a new folder in your Windower addons directory:

   ```
   <Windower>\addons\itemscan\itemscan.lua
   ```

2. Add it to your Windower startup script so it loads automatically on every login:

   **`<Windower>\scripts\Default.txt`**
   ```
   /addon load itemscan
   ```

3. The addon auto-scans on load — no manual commands needed.

---

### Step 3 — Point the app at your addon folder

On first launch, open the **Config** tab → **Ashita itemscan folder** → **Browse…** and select:

- **Ashita:** `<Ashita>\addons\itemscan\`
- **Windower:** `<Windower>\addons\itemscan\`

The app defaults to `C:\Ashita4\addons\itemscan` if it exists.

---

## Auto-scan (recommended)

Enable **Auto-scan** in the Config tab (or run `/itemscan auto` in-game once). The addon will then re-export your data automatically whenever:

- Your inventory changes (items picked up, traded, moved)
- You swap any piece of equipment
- A Records of Eminence objective updates
- The addon loads or reloads

---

## Reloading the addon

If you update the Lua file while FFXI is running, click **Reload addon** in the Config tab. The app writes a flag file that the running addon picks up within ~2 seconds, reloads itself, and auto-scans. No in-game typing required.

---

## In-game commands

| Command | Effect |
|---------|--------|
| `/itemscan` | Scan now and write inventory.json |
| `/itemscan auto` | Toggle auto-rescan on inventory/equipment changes |
| `/itemscan map` | Toggle live position tracking for the Map tab |
| `/itemscan missions` | Print current mission stages to chat |
| `/itemscan roe` | Print active RoE objectives to chat |
| `/itemscan quests` | Print active quest counts by area to chat |

> **Windower users:** prefix commands with `//` — e.g. `//itemscan auto`

---

## Maps

Map images are not bundled (large, third-party assets). To enable the live position dot:

1. Download **`remapster-wiki-pack-1-1024.zip`** (and pack-2 for full coverage) from the [remapster_maps releases](https://github.com/AkadenTK/remapster_maps/releases).
2. In the app, open the **Map** tab → **Open maps folder** and unzip the PNGs directly into it.
3. Enable **Map tracking** via the Config tab or `/itemscan map` in-game.

---

## Known issues & beta notes

### Windower — needs in-game verification

The Windower port is new and has three areas that need testing. If you're on Windower and something looks wrong, check these first and report via the Feedback button:

| Area | What to test | What to report |
|------|-------------|----------------|
| **Job levels** | Open the Character tab — do all your job levels show correctly? | If they're all 0, report it |
| **Equipment** | Does your equipped gear show on the Character tab? | If slots are empty when you have gear on, report which slots |
| **Inventory bags** | Do items appear from all bags (Safe, Storage, Satchel etc.)? | If a bag is missing entirely, report which one |

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
