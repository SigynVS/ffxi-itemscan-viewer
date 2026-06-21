--[[
* itemscan - Inventory exporter addon for Ashita4
*
* Walks every inventory container, resolves each item's name and description
* from the resource manager, and writes the result to inventory.json beside
* this addon. A separate viewer program (Electron) watches that file and joins
* it against bundled vendor-price / gobbiebag / quest datasets and live AH data.
*
* This addon is intentionally "thin": it only exports raw inventory data.
* All enrichment (prices, quest turn-ins, gobbiebag flags) happens in the viewer.
*
* Usage:
*   /itemscan          - Scan now and write inventory.json
*   /itemscan auto     - Toggle auto-scan on inventory-change packets
--]]

addon.name    = 'itemscan';
addon.author  = 'Brian Justice';
addon.version = '0.1';
addon.desc    = 'Exports full inventory to inventory.json for an external viewer.';

require 'common';

local json = require 'json';

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
    auto = false,
    roe_active = {}, -- objective id -> progress, captured from packet 0x111
    missions = {},   -- storyline -> raw current-mission stage, from packet 0x056
    quests = {},     -- area -> { current = {ids}, completed = {ids} }, from 0x056
    quest_raw = nil, -- raw bytes of the last 0x0070 packet, for offset verification
    maptrack = false,-- when true, write position.json each ~15 frames for the map
    frame = 0,       -- frame counter for throttling position writes
};

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
-- This start offset is UNVERIFIED — confirm with /itemscan questdump in-game.
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
        m.adoulin = u32(data, 0x1D);
        m.rhapsodies = u32(data, 0x21);
    elseif (mtype == 0x0080) then
        m.assault = u32(data, 0x15);
        m.aht_urhgan = u32(data, 0x19);
        m.goddess = u32(data, 0x1D);
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
                    local name, desc = resolve_item(entry.Id);
                    items:append(T{
                        id        = entry.Id,
                        count     = entry.Count,
                        container = container,
                        container_name = container_names[container] or ('Container %d'):fmt(container),
                        slot      = slot,
                        name      = name,
                        description = desc,
                    });
                end
            end
        end
    end

    return items;
end

--[[
* Performs a scan and writes inventory.json beside this addon.
--]]
local function do_scan()
    local party = AshitaCore:GetMemoryManager():GetParty();
    local charname = (party ~= nil and party:GetMemberName(0)) or 'Unknown';

    -- Main inventory (container 0) size doubles as Gobbiebag progress: base is
    -- 30 slots and each completed Gobbiebag quest adds 5 (up to 80 at all 10).
    local inv = AshitaCore:GetMemoryManager():GetInventory();
    local inv_max = inv:GetContainerCountMax(0) or 0;

    -- National mission rank (0=San d'Oria, 1=Bastok, 2=Windurst), rank 1-10.
    local player = AshitaCore:GetMemoryManager():GetPlayer();
    local nation, rank, rank_points = nil, nil, nil;
    if (player ~= nil) then
        nation      = player:GetNation();
        rank        = player:GetRank();
        rank_points = player:GetRankPoints();
    end

    local payload = T{
        character     = charname,
        timestamp     = os.time(),
        inventory_max = inv_max,
        nation        = nation,
        rank          = rank,
        rank_points   = rank_points,
        roe           = itemscan.roe_active,
        missions      = itemscan.missions,
        quests        = itemscan.quests,
        items         = collect_inventory(),
    };

    local path = ('%s\\inventory.json'):fmt(addon.path);
    local file = io.open(path, 'w');
    if (file == nil) then
        print(('[itemscan] ERROR: could not open %s for writing.'):fmt(path));
        return;
    end
    file:write(json.encode(payload));
    file:close();

    print(('[itemscan] Wrote %d items to inventory.json'):fmt(#payload.items));
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

    local payload = T{
        zone      = party:GetMemberZone(0),
        x         = ent:GetLocalPositionX(idx),
        y         = ent:GetLocalPositionY(idx),
        z         = ent:GetLocalPositionZ(idx),
        heading   = ent:GetLocalPositionYaw(idx),
        timestamp = os.time(),
    };

    local file = io.open(('%s\\position.json'):fmt(addon.path), 'w');
    if (file == nil) then return; end
    file:write(json.encode(payload));
    file:close();
end

ashita.events.register('command', 'command_cb', function (e)
    local args = e.command:args();
    if (#args == 0 or args[1] ~= '/itemscan') then
        return;
    end
    e.blocked = true;

    if (#args >= 2 and args[2]:lower() == 'auto') then
        itemscan.auto = not itemscan.auto;
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
                         'goddess', 'adoulin', 'rhapsodies', 'voracious' };
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
            do_scan();
        end
        return;
    end
    if (e.id == 0x111) then
        itemscan.roe_active = parse_roe(e.data);
        local n = 0;
        for _ in pairs(itemscan.roe_active) do n = n + 1; end
        print(('[itemscan] RoE packet 0x111 received (size %d): captured %d objectives.'):fmt(e.size, n));
        if (itemscan.auto) then
            do_scan();
        end
        return;
    end
    if (itemscan.auto and e.id == 0x001D) then
        do_scan();
    end
end);

-- Throttled position writer for the map display (~4x/sec at 60fps). Only active
-- when map tracking is toggled on via /itemscan map.
ashita.events.register('d3d_present', 'present_cb', function ()
    if (not itemscan.maptrack) then
        return;
    end
    itemscan.frame = itemscan.frame + 1;
    if (itemscan.frame >= 15) then
        itemscan.frame = 0;
        write_position();
    end
end);
