--[[
* itemscan - Inventory addon for Ashita4
*
* Streams inventory, equipment, position, and progression data to the FFXI Item
* Scan viewer app over a local TCP socket (localhost:51234). No files are written.
* The app must be running for data to be received.
*
* All enrichment (prices, quest turn-ins, gobbiebag flags) happens in the viewer.
*
* Usage:
*   /itemscan          - Scan now and send to viewer
*   /itemscan auto     - Toggle auto-scan on inventory-change packets
*   /itemscan map      - Toggle live position tracking
*   /itemscan dumpresources - Rebuild item name database (run once, copy items.json to viewer data/)
--]]

addon.name    = 'itemscan';
addon.author  = 'Brian Justice';
addon.version = '0.1.0-beta.1';
addon.desc    = 'Streams inventory and position data to the FFXI Item Scan viewer app.';

require 'common';

local json    = require 'json';
local socket  = require 'socket';

-- Equipment slot id -> friendly label.
local equip_slot_names = T{
    [0]  = 'Main',   [1]  = 'Sub',     [2]  = 'Ranged', [3]  = 'Ammo',
    [4]  = 'Head',   [5]  = 'Neck',    [6]  = 'L.Ear',  [7]  = 'R.Ear',
    [8]  = 'Body',   [9]  = 'Hands',   [10] = 'L.Ring', [11] = 'R.Ring',
    [12] = 'Back',   [13] = 'Waist',   [14] = 'Legs',   [15] = 'Feet',
};

-- Container id -> friendly name. Mirrors invmon's container table.
local container_names = T{
    [0x00] = 'Inventory',
    [0x01] = 'Safe',
    [0x02] = 'Storage',
    [0x03] = 'Temporary',
    [0x04] = 'Locker',
    [0x05] = 'Satchel',
    [0x06] = 'Sack',
    [0x07] = 'Case',
    [0x08] = 'Wardrobe',
    [0x09] = 'Safe 2',
    [0x0A] = 'Wardrobe 2',
    [0x0B] = 'Wardrobe 3',
    [0x0C] = 'Wardrobe 4',
    [0x0D] = 'Wardrobe 5',
    [0x0E] = 'Wardrobe 6',
    [0x0F] = 'Wardrobe 7',
    [0x10] = 'Wardrobe 8',
    [0x11] = 'Recycle',
};

local itemscan = T{
    auto = true,
    roe_active = {}, -- objective id -> progress, captured from packet 0x111
    missions = {},   -- storyline -> raw current-mission stage, from packet 0x056
    quests = {},     -- area -> { current = {ids}, completed = {ids} }, from 0x056
    quest_raw = nil, -- raw bytes of the last 0x0070 packet, for offset verification
    maptrack = false,-- when true, write position.json only on meaningful movement
    frame = 0,       -- frame counter for throttling position writes
    scan_at = 0,     -- frame to run a debounced auto-scan (0 = none pending)
    last_config = {},-- last-seen values from itemscan_config.json (app-driven)
    last_pos = { x = nil, y = nil, zone = nil }, -- last sent position for delta check
    sock = nil,      -- LuaSocket TCP client connected to the viewer
    sock_retry = 0,  -- frame at which to attempt next reconnect
};

-- Connects to the viewer's TCP server (localhost:51234). A short blocking
-- connect is correct here: on localhost it returns immediately (success, or
-- "connection refused" when the viewer is closed), so FFXI never stalls. The
-- socket is then switched to non-blocking so sends never block the render
-- thread. The old code used a non-blocking connect, which returns "timeout"
-- (the normal in-progress status) and was wrongly treated as failure, so the
-- socket was closed on every attempt and inventory was never delivered.
local function connect_viewer()
    local s = socket.tcp();
    s:settimeout(2);
    local ok = s:connect('127.0.0.1', 51234);
    if (ok == 1) then
        s:settimeout(0);
        itemscan.sock = s;
        print('[itemscan] Connected to viewer.');
    else
        s:close();
    end
end

-- Sends a prefixed JSON message to the viewer. 'I' = inventory, 'P' = position.
-- Marks the socket nil on error so the reconnect logic in d3d_present takes over.
local function send_to_viewer(prefix, json_str)
    if (itemscan.sock == nil) then return; end
    local ok, err = itemscan.sock:send(prefix .. json_str .. '\n');
    if (not ok) then
        if (err == 'timeout') then return; end -- send buffer full; skip this message
        itemscan.sock:close();
        itemscan.sock = nil;
        itemscan.sock_retry = itemscan.frame + 360; -- retry in ~6s
        print('[itemscan] Viewer disconnected.');
    end
end

-- Settings the external app can drive, persisted in itemscan_config.json beside
-- this addon. The app writes the file; the addon reads it on load and polls it,
-- applying a value only when it changed (so in-game /commands aren't clobbered).
local function config_path()
    return ('%s\\itemscan_config.json'):fmt(addon.path);
end

local function write_config()
    local cfg = { auto = itemscan.auto, maptrack = itemscan.maptrack };
    itemscan.last_config = { auto = itemscan.auto, maptrack = itemscan.maptrack };
    local file = io.open(config_path(), 'w');
    if (file ~= nil) then
        file:write(json.encode(cfg));
        file:close();
    end
end

local function reload_flag_path()
    return ('%s\\reload_flag.txt'):fmt(addon.path);
end

-- When the viewer writes reload_flag.txt, queue a reload and consume the file.
-- The new addon instance will auto-scan in its load_cb, so no manual /itemscan needed.
local function poll_reload_flag()
    local f = io.open(reload_flag_path(), 'r');
    if (f == nil) then return; end
    f:close();
    os.remove(reload_flag_path());
    AshitaCore:GetChatManager():QueueCommand(1, '/addon reload itemscan');
end

local function poll_config()
    local file = io.open(config_path(), 'r');
    if (file == nil) then return; end
    local txt = file:read('*a');
    file:close();
    local ok, cfg = pcall(json.decode, txt);
    if (not ok or cfg == nil) then return; end
    if (cfg.auto ~= nil and cfg.auto ~= itemscan.last_config.auto) then
        itemscan.auto = cfg.auto;
        itemscan.last_config.auto = cfg.auto;
        print(('[itemscan] auto-scan %s (from app).'):fmt(cfg.auto and 'ON' or 'OFF'));
    end
    if (cfg.maptrack ~= nil and cfg.maptrack ~= itemscan.last_config.maptrack) then
        itemscan.maptrack = cfg.maptrack;
        itemscan.last_config.maptrack = cfg.maptrack;
        print(('[itemscan] map tracking %s (from app).'):fmt(cfg.maptrack and 'ON' or 'OFF'));
    end
end

-- Quest-log blocks within packet 0x056: Type selector -> { area, state }.
-- Source: Ivaar's Windower QuestLog addon quest_logs table.
local quest_types = {
    [0x0070] = { 'other',     'current' },
    [0x00B0] = { 'other',     'completed' },
    [0x00E0] = { 'abyssea',   'current' },
    [0x00E8] = { 'abyssea',   'completed' },
    [0x00F0] = { 'adoulin',   'current' },
    [0x00F8] = { 'adoulin',   'completed' },
    [0x0100] = { 'coalition', 'current' },
    [0x0108] = { 'coalition', 'completed' },
};

-- Quest flag payload is assumed to start right after the 4-byte header, i.e.
-- 1-based byte 5, running up to the Type selector at 0x25 (32 bytes = 256 bits).
-- This start offset is UNVERIFIED, confirm with /itemscan questdump in-game.
local QUEST_BITS_START = 0x05;
local QUEST_BIT_COUNT  = 256;

-- Reads the quest bitfield and returns a list of set quest ids (bit indices,
-- LSB-first per byte).
local function parse_quest_bits(data)
    local ids = {};
    for b = 0, QUEST_BIT_COUNT - 1 do
        local byte = data:byte(QUEST_BITS_START + math.floor(b / 8));
        if (byte ~= nil and (math.floor(byte / (2 ^ (b % 8))) % 2) == 1) then
            ids[#ids + 1] = b;
        end
    end
    return ids;
end

-- Little-endian readers. pos is 1-based (matches Ashita's data:byte()).
local function u16(data, pos)
    local b1, b2 = data:byte(pos, pos + 1);
    if (b1 == nil) then return nil; end
    return b1 + (b2 * 256);
end

local function u32(data, pos)
    local b1, b2, b3, b4 = data:byte(pos, pos + 3);
    if (b1 == nil) then return nil; end
    return b1 + (b2 * 256) + (b3 * 65536) + (b4 * 16777216);
end

--[[
* Parses incoming packet 0x056 (Quest/Mission Log), which is multiplexed by a
* 16-bit Type selector. Different Types carry different storylines' current
* mission stage. Offsets are the Windower fields.lua byte offsets + 1 (Ashita's
* data:byte is 1-based). Only the RAW stage numbers are exported here; turning
* them into mission names is a separate, fallible lookup layer added later.
*
* Verified source: Windower libs/packets/fields.lua (packet 0x056).
--]]
local function parse_missions(data)
    local m = itemscan.missions;
    local mtype = u16(data, 0x25);
    if (mtype == 0xFFFF) then
        m.nation = u32(data, 0x09);
        m.zilart = u32(data, 0x0D);
        m.promathia = u32(data, 0x11);
        -- Add-on scenarios are packed as 4-bit nibbles at 0x18-0x19 (0-based).
        local acp_mkd = data:byte(0x19); -- 1-based (0x18 + 1)
        local asa_b   = data:byte(0x1A); -- 1-based (0x19 + 1)
        if (acp_mkd ~= nil) then
            m.crystalline = acp_mkd % 16;            -- A Crystalline Prophecy (low nibble)
            m.moogle      = math.floor(acp_mkd / 16); -- A Moogle Kupo d'Etat (high nibble)
        end
        if (asa_b ~= nil) then
            m.shantotto = asa_b % 16;                -- A Shantotto Ascension (low nibble)
        end
        m.adoulin = u32(data, 0x1D);
        m.rhapsodies = u32(data, 0x21);
    elseif (mtype == 0x0080) then
        m.assault = u32(data, 0x15);
        m.aht_urhgan = u32(data, 0x19);
        m.goddess = u32(data, 0x1D);
        m.campaign = u32(data, 0x21);
    elseif (mtype == 0xFFFE) then
        m.voracious = u32(data, 0x05);
    end
    return mtype;
end

--[[
* Parses incoming packet 0x111 (Eminence Update), which carries the player's
* up to 30 active Records of Eminence objectives. Each 4-byte entry packs a
* 12-bit objective id and a 20-bit progress value, starting at byte offset 5.
* Method mirrors Windower's roe addon. Arithmetic is used instead of bit ops
* so 32-bit values stay safe as Lua doubles.
--]]
local function parse_roe(data)
    -- Ordered list of { id, progress } preserving the packet's slot order, which
    -- may match the in-game RoE menu order.
    local active = {};
    for i = 0, 29 do
        local pos = 5 + (i * 4); -- 1-based offset into the packet
        local b1, b2, b3, b4 = data:byte(pos, pos + 3);
        if (b1 == nil) then
            break;
        end
        local u32 = b1 + (b2 * 256) + (b3 * 65536) + (b4 * 16777216);
        local id = u32 % 4096;                         -- low 12 bits
        local progress = math.floor(u32 / 4096) % 1048576; -- next 20 bits
        if (id > 0) then
            active[#active + 1] = { id = id, progress = progress };
        end
    end
    return active;
end

-- FFXI encodes special in-line glyphs as a 0xEF lead byte followed by a
-- selector byte. In item descriptions these are the elemental resistance
-- icons, ordered Fire..Dark. (Verify against one gear tooltip in-game.)
local ffxi_glyphs = {
    [0x1F] = '[Fire]',
    [0x20] = '[Ice]',
    [0x21] = '[Wind]',
    [0x22] = '[Earth]',
    [0x23] = '[Lightning]',
    [0x24] = '[Water]',
    [0x25] = '[Light]',
    [0x26] = '[Dark]',
};

--[[
* Converts a raw FFXI text string into guaranteed-valid UTF-8.
*
* - ASCII bytes pass through unchanged.
* - A 0xEF lead byte + known selector becomes a readable element tag.
* - Any other high byte is transcoded losslessly (latin-1 -> UTF-8) so the
*   output is always valid UTF-8 and never breaks JSON.parse downstream.
--]]
local function sanitize(str)
    if (str == nil) then return ''; end
    local out = {};
    local i, n = 1, #str;
    while (i <= n) do
        local b = str:byte(i);
        if (b == 0xEF and i < n) then
            local sel = str:byte(i + 1);
            local glyph = ffxi_glyphs[sel];
            if (glyph ~= nil) then
                out[#out + 1] = glyph;
                i = i + 2;
            else
                -- Unknown 0xEF sequence: emit the lead byte as lossless UTF-8.
                out[#out + 1] = string.char(0xC0 + math.floor(b / 64), 0x80 + (b % 64));
                i = i + 1;
            end
        elseif (b < 0x80) then
            out[#out + 1] = string.char(b);
            i = i + 1;
        else
            -- High byte: latin-1 -> UTF-8 (lossless, always valid).
            out[#out + 1] = string.char(0xC0 + math.floor(b / 64), 0x80 + (b % 64));
            i = i + 1;
        end
    end
    return table.concat(out);
end

--[[
* Resolves an item's static name and description from the resource manager.
* Returns name, description (both UTF-8 strings; description may be empty).
--]]
local function resolve_item(id)
    local res = AshitaCore:GetResourceManager():GetItemById(id);
    if (res == nil) then
        return ('Unknown (%d)'):fmt(id), '';
    end
    local name = (res.Name ~= nil and res.Name[1]) or ('Unknown (%d)'):fmt(id);
    local desc = (res.Description ~= nil and res.Description[1]) or '';
    return sanitize(name), sanitize(desc);
end

--[[
* Walks every container and returns a flat list of item entries.
--]]
local function collect_inventory()
    local inv   = AshitaCore:GetMemoryManager():GetInventory();
    local items = T{ };

    for container = 0x00, 0x11 do
        local max = inv:GetContainerCountMax(container);
        if (max ~= nil and max > 0) then
            -- Slot 0 is reserved/gil for some containers; scan the full range.
            for slot = 0, max do
                local entry = inv:GetContainerItem(container, slot);
                if (entry ~= nil and entry.Id ~= 0 and entry.Id ~= 65535) then
                    items:append(T{
                        id        = entry.Id,
                        count     = entry.Count,
                        container = container,
                        container_name = container_names[container] or ('Container %d'):fmt(container),
                        slot      = slot,
                    });
                end
            end
        end
    end

    return items;
end

--[[
* Performs a scan and sends the payload to the viewer over the TCP socket.
--]]
local function do_scan(silent)
    local party = AshitaCore:GetMemoryManager():GetParty();
    local charname = (party ~= nil and party:GetMemberName(0)) or 'Unknown';

    -- Main inventory (container 0) size doubles as Gobbiebag progress: base is
    -- 30 slots and each completed Gobbiebag quest adds 5 (up to 80 at all 10).
    local inv = AshitaCore:GetMemoryManager():GetInventory();
    local inv_max = inv:GetContainerCountMax(0) or 0;

    -- National mission rank (0=San d'Oria, 1=Bastok, 2=Windurst), rank 1-10.
    local player = AshitaCore:GetMemoryManager():GetPlayer();
    local nation, rank, rank_points = nil, nil, nil;
    local main_job, main_job_level, sub_job, sub_job_level = nil, nil, nil, nil;
    local job_levels = T{};
    if (player ~= nil) then
        nation      = player:GetNation();
        rank        = player:GetRank();
        rank_points = player:GetRankPoints();
        main_job       = player:GetMainJob();
        main_job_level = player:GetMainJobLevel();
        sub_job        = player:GetSubJob();
        sub_job_level  = player:GetSubJobLevel();
        for job_id = 1, 22 do
            job_levels[job_id] = player:GetJobLevel(job_id) or 0;
        end
    end

    -- Current equipment: GetEquippedItem returns a packed Index where
    -- the low byte is the slot within the container and the high byte is
    -- the container id. Arithmetic is used instead of bit ops for portability.
    local equipment = T{};
    for slot = 0, 15 do
        local equip = inv:GetEquippedItem(slot);
        if (equip ~= nil) then
            local raw   = equip.Index;
            local idx   = raw % 256;                      -- low byte = slot within container
            local cont  = math.floor(raw / 256) % 256;   -- high byte = container id
            if (idx > 0) then
                local item = inv:GetContainerItem(cont, idx);
                if (item ~= nil and item.Id ~= 0 and item.Id ~= 65535) then
                    equipment:append(T{
                        slot      = slot,
                        slot_name = equip_slot_names[slot] or ('Slot %d'):fmt(slot),
                        id        = item.Id,
                    });
                end
            end
        end
    end

    local payload = T{
        character      = charname,
        timestamp      = os.time(),
        inventory_max  = inv_max,
        nation         = nation,
        rank           = rank,
        rank_points    = rank_points,
        main_job       = main_job,
        main_job_level = main_job_level,
        sub_job        = sub_job,
        sub_job_level  = sub_job_level,
        job_levels     = job_levels,
        equipment      = equipment,
        roe            = itemscan.roe_active,
        missions       = itemscan.missions,
        quests         = itemscan.quests,
        items          = collect_inventory(),
    };

    -- Send to viewer over socket. No file write -- app requires client to be running.
    send_to_viewer('I', json.encode(payload));

    if (not silent) then
        print(('[itemscan] Scanned %d items.'):fmt(#payload.items));
    end
end

--[[
* Writes the player's current zone + position to position.json for the external
* map display. Kept separate from inventory.json so it can update frequently
* without rewriting the large inventory payload. All three axes are exported so
* the viewer can pick the correct horizontal pair (verify against movement).
--]]
local function write_position()
    local party = AshitaCore:GetMemoryManager():GetParty();
    local ent   = AshitaCore:GetMemoryManager():GetEntity();
    if (party == nil or ent == nil) then return; end
    local idx = party:GetMemberTargetIndex(0);
    if (idx == nil or idx == 0) then return; end

    local zone      = party:GetMemberZone(0);
    local charname  = party:GetMemberName(0) or 'Unknown';
    local x         = ent:GetLocalPositionX(idx);
    local y         = ent:GetLocalPositionY(idx);

    -- Only send when zone changed or player moved more than 0.5 yalms.
    local lp = itemscan.last_pos;
    if (lp.zone == zone and lp.x ~= nil
        and math.abs(x - lp.x) < 0.5 and math.abs(y - lp.y) < 0.5) then
        return;
    end
    lp.zone = zone; lp.x = x; lp.y = y;

    send_to_viewer('P', json.encode(T{
        character = charname,
        zone      = zone,
        x         = x,
        y         = y,
        z         = ent:GetLocalPositionZ(idx),
        heading   = ent:GetLocalPositionYaw(idx),
    }));
end

ashita.events.register('command', 'command_cb', function (e)
    local args = e.command:args();
    if (#args == 0 or args[1] ~= '/itemscan') then
        return;
    end
    e.blocked = true;

    if (#args >= 2 and args[2]:lower() == 'auto') then
        itemscan.auto = not itemscan.auto;
        write_config();
        print(('[itemscan] Auto-scan %s.'):fmt(itemscan.auto and 'enabled' or 'disabled'));
        return;
    end

    -- Empirical probe: try to resolve an RoE objective id to text via various
    -- candidate Ashita resource string tables. Usage: /itemscan roetest [id]
    if (#args >= 2 and args[2]:lower() == 'roetest') then
        local id = tonumber(args[3]) or 12;
        local rm = AshitaCore:GetResourceManager();
        local tables = T{
            'roe.names', 'roe.descriptions', 'eminence.names', 'records.names',
            'roe', 'eminence', 'achievements.names', 'records_of_eminence.names',
        };
        print(('[itemscan] Probing RoE id %d across resource tables:'):fmt(id));
        tables:each(function (t)
            local ok, res = pcall(function () return rm:GetString(t, id); end);
            if (ok and res ~= nil and tostring(res):len() > 0) then
                print(('[itemscan]   %s -> "%s"'):fmt(t, tostring(res)));
            else
                print(('[itemscan]   %s -> (nil/error)'):fmt(t));
            end
        end);
        return;
    end

    if (#args >= 2 and args[2]:lower() == 'map') then
        itemscan.maptrack = not itemscan.maptrack;
        write_config();
        print(('[itemscan] Map position tracking %s.'):fmt(itemscan.maptrack and 'ON' or 'OFF'));
        return;
    end

    if (#args >= 2 and args[2]:lower() == 'quests') then
        for area, blocks in pairs(itemscan.quests) do
            local cur = blocks.current or {};
            local done = {};
            for _, id in ipairs(blocks.completed or {}) do done[id] = true; end
            local active = {};
            for _, id in ipairs(cur) do
                if (not done[id]) then active[#active + 1] = id; end
            end
            print(('[itemscan] %s: %d current, %d completed, %d ACTIVE'):fmt(
                area, #cur, #(blocks.completed or {}), #active));
            local sample = {};
            for i = 1, math.min(8, #active) do sample[i] = active[i]; end
            if (#sample > 0) then
                print(('[itemscan]   active ids: %s'):fmt(table.concat(sample, ', ')));
            end
        end
        return;
    end

    if (#args >= 2 and args[2]:lower() == 'questdump') then
        if (itemscan.quest_raw == nil) then
            print('[itemscan] No 0x0070 packet captured yet. Zone first.');
            return;
        end
        local hex = {};
        for i = 1, math.min(40, #itemscan.quest_raw) do
            hex[i] = ('%02X'):fmt(itemscan.quest_raw:byte(i));
        end
        print(('[itemscan] 0x0070 raw bytes: %s'):fmt(table.concat(hex, ' ')));
        return;
    end

    if (#args >= 2 and args[2]:lower() == 'missions') then
        local m = itemscan.missions;
        local order = T{ 'nation', 'zilart', 'promathia', 'aht_urhgan', 'assault',
                         'goddess', 'campaign', 'adoulin', 'rhapsodies', 'voracious',
                         'crystalline', 'moogle', 'shantotto' };
        order:each(function (k)
            print(('[itemscan] mission %s = %s'):fmt(k, tostring(m[k])));
        end);
        return;
    end

    if (#args >= 2 and args[2]:lower() == 'roe') then
        for i, o in ipairs(itemscan.roe_active) do
            print(('[itemscan] #%d slot %d: id %d = progress %d'):fmt(i, i, o.id, o.progress));
        end
        print(('[itemscan] %d active RoE objectives currently captured.'):fmt(#itemscan.roe_active));
        return;
    end

    -- Dumps all known item names and descriptions to items.json beside this addon.
    -- Copy that file to the viewer's data/ folder then restart the app.
    if (#args >= 2 and args[2]:lower() == 'dumpresources') then
        local rm = AshitaCore:GetResourceManager();
        local out = {};
        local count = 0;
        print('[itemscan] Dumping item database -- game will freeze briefly, this is normal.');
        for id = 1, 65535 do
            local res = rm:GetItemById(id);
            if (res ~= nil and res.Name ~= nil and res.Name[1] ~= nil and #res.Name[1] > 0) then
                out[tostring(id)] = {
                    name = sanitize(res.Name[1]),
                    desc = (res.Description ~= nil and res.Description[1] ~= nil)
                        and sanitize(res.Description[1]) or '',
                };
                count = count + 1;
            end
        end
        local f = io.open(('%s\\items.json'):fmt(addon.path), 'w');
        if (f ~= nil) then
            f:write(json.encode(out));
            f:close();
            print(('[itemscan] items.json written (%d items). Copy to viewer data/ folder and restart the app.'):fmt(count));
        else
            print('[itemscan] ERROR: could not write items.json');
        end
        return;
    end

    do_scan();
end);

-- Capture Records of Eminence updates (0x111) always, and re-export inventory
-- on inventory-finished (0x001D) when auto mode is on.
ashita.events.register('packet_in', 'packet_in_cb', function (e)
    if (e.id == 0x056) then
        local mtype = parse_missions(e.data);
        local q = quest_types[mtype];
        if (q ~= nil) then
            local area, state = q[1], q[2];
            itemscan.quests[area] = itemscan.quests[area] or {};
            itemscan.quests[area][state] = parse_quest_bits(e.data);
            if (mtype == 0x0070) then
                itemscan.quest_raw = e.data; -- keep for offset verification
            end
        end
        if (itemscan.auto) then
            itemscan.scan_at = itemscan.frame + 60; -- debounce ~1s
        end
        return;
    end
    if (e.id == 0x111) then
        itemscan.roe_active = parse_roe(e.data);
        if (not itemscan.auto) then
            print(('[itemscan] RoE packet 0x111 received (size %d): captured %d objectives.'):fmt(
                e.size, #itemscan.roe_active));
        end
        if (itemscan.auto) then
            itemscan.scan_at = itemscan.frame + 60; -- debounce ~1s
        end
        return;
    end
    if (itemscan.auto and e.id == 0x001D) then
        itemscan.scan_at = itemscan.frame + 60; -- debounce ~1s
    end
    -- Equipment change: re-export so the Character tab stays live.
    if (itemscan.auto and e.id == 0x050) then
        itemscan.scan_at = itemscan.frame + 15; -- debounce ~0.25s
    end
end);

-- Read app-driven settings on load; connect to viewer; queue an auto-scan.
ashita.events.register('load', 'load_cb', function ()
    poll_config();
    connect_viewer();
    itemscan.scan_at = itemscan.frame + 180; -- ~3s debounce so game state is ready
end);

-- Render loop: reconnect to viewer if needed, poll config, send position updates.
ashita.events.register('d3d_present', 'present_cb', function ()
    itemscan.frame = itemscan.frame + 1;
    -- Reconnect to the viewer if the socket dropped (retries every ~6s).
    if (itemscan.sock == nil and itemscan.frame >= itemscan.sock_retry) then
        itemscan.sock_retry = itemscan.frame + 360;
        connect_viewer();
    end
    if (itemscan.frame % 120 == 0) then
        poll_config();
        poll_reload_flag();
    end
    -- Run a debounced auto-scan once the burst of triggers has settled (silent,
    -- so it doesn't spam chat).
    if (itemscan.scan_at > 0 and itemscan.frame >= itemscan.scan_at) then
        itemscan.scan_at = 0;
        do_scan(true);
    end
    if (itemscan.maptrack and (itemscan.frame % 30 == 0)) then
        write_position();
    end
end);
