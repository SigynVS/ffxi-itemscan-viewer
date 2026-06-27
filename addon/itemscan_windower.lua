--[[
    itemscan — Windower port
    Writes inventory.json to the addon folder; the FFXI Item Scan Viewer
    (Electron app) reads it and displays inventory, character, and mission data.

    Install: copy this file to [Windower]/addons/itemscan/itemscan.lua
    Load:    //lua load itemscan   (or add to your init.txt)
    Viewer:  https://github.com/SigynVS/ffxi-itemscan-viewer
--]]

_addon.name     = 'itemscan'
_addon.author   = 'SigynVS'
_addon.version  = '1.0.0'
_addon.commands = {'itemscan', 'is'}

local res = require 'resources'   -- confirmed from local battlemod.lua

-- ── State ───────────────────────────────────────────────────────────────────

local state = {
    auto     = false,
    maptrack = false,
    frame    = 0,
    scan_at  = 0,
    last_pos = { x = nil, y = nil, zone = nil },
}

-- windower.addon_path ends with backslash (confirmed from local battlemod.lua)
local PATH_OUT    = windower.addon_path .. 'inventory.json'
local PATH_POS    = windower.addon_path .. 'position.json'
local PATH_CFG    = windower.addon_path .. 'itemscan_config.json'
local PATH_RELOAD = windower.addon_path .. 'reload_flag.txt'

-- ── Container map ────────────────────────────────────────────────────────────
-- Windower container IDs for windower.ffxi.get_items(id).
-- VERIFY: if items appear in wrong containers, cross-check these IDs.

local CONTAINERS = {
    {id=0,  label='Inventory'},
    {id=1,  label='Safe'},
    {id=2,  label='Storage'},
    {id=3,  label='Locker'},
    {id=4,  label='Satchel'},
    {id=5,  label='Sack'},
    {id=6,  label='Case'},
    {id=7,  label='Wardrobe'},
    {id=8,  label='Safe 2'},
    {id=9,  label='Wardrobe 2'},
    {id=10, label='Wardrobe 3'},
    {id=11, label='Wardrobe 4'},
}

-- ── Equipment slot maps ──────────────────────────────────────────────────────
-- windower.ffxi.get_equipment() returns a table keyed by slot name.
-- Key names documented from GearSwap / Lua addon conventions.
-- VERIFY: if equipment is missing, print pairs(windower.ffxi.get_equipment())
--         to see the actual keys your Windower version uses.

local SLOT_ID = {
    main=0, sub=1, ranged=2, ammo=3,
    head=4, neck=5,
    left_ear=6,  lear=6,   -- Windower uses one of these
    right_ear=7, rear=7,
    body=8, hands=9,
    left_ring=10, lring=10,
    right_ring=11, rring=11,
    back=12, waist=13, legs=14, feet=15,
}

local SLOT_LABEL = {
    [0]='Main', [1]='Sub', [2]='Ranged', [3]='Ammo',
    [4]='Head', [5]='Neck', [6]='L.Ear', [7]='R.Ear',
    [8]='Body', [9]='Hands', [10]='L.Ring', [11]='R.Ring',
    [12]='Back', [13]='Waist', [14]='Legs', [15]='Feet',
}

-- ── JSON helpers ─────────────────────────────────────────────────────────────

local function esc(s)
    s = tostring(s or '')
    return (s
        :gsub('\\', '\\\\')
        :gsub('"',  '\\"')
        :gsub('\n', '\\n')
        :gsub('\r', '\\r')
        :gsub('\t', '\\t')
    )
end

local function write_file(path, content)
    local f = io.open(path, 'w')
    if f then f:write(content); f:close() end
end

-- ── Item name resolution ─────────────────────────────────────────────────────
-- res.items[id].english confirmed via res.buffs[id].english_log pattern in battlemod.

local function resolve_item(id)
    if not id or id == 0 or id == 65535 then return nil end
    local entry = res.items[id]
    if not entry then return nil end
    -- 'english' is the standard display name; fall back to 'en' for older builds
    local name = entry.english or entry.en or 'Unknown'
    local desc = entry.description or ''
    return name, desc
end

-- ── Core scan ────────────────────────────────────────────────────────────────

local function do_scan(silent)
    if not silent then
        windower.add_to_chat(8, '[itemscan] Scanning...')
    end

    -- ── Character / job info ─────────────────────────────────────────────
    local player        = windower.ffxi.get_player()
    local char_name     = player and player.name           or ''
    local main_job      = player and player.main_job       or 0
    local main_job_lvl  = player and player.main_job_level or 0
    local sub_job       = player and player.sub_job        or 0
    local sub_job_lvl   = player and player.sub_job_level  or 0

    -- All 22 job levels.
    -- VERIFY: player.jobs is a table indexed [1..22] = level in most Windower builds.
    -- If this returns zeros, listen for packet 0x061 and cache levels yourself.
    local jlvl_parts = {}
    local pjobs = (player and player.jobs) or {}
    for i = 1, 22 do
        jlvl_parts[i] = tostring(pjobs[i] or 0)
    end

    -- ── Equipment ────────────────────────────────────────────────────────
    -- windower.ffxi.get_equipment() returns a table keyed by slot name (see SLOT_ID above).
    -- VERIFY: print slot keys if equipment shows empty.
    local equip_parts = {}
    local equipment   = windower.ffxi.get_equipment()
    if type(equipment) == 'table' then
        for key, slot_data in pairs(equipment) do
            local slot_id = SLOT_ID[key]
            if slot_id ~= nil
            and type(slot_data) == 'table'
            and slot_data.id
            and slot_data.id ~= 0
            and slot_data.id ~= 65535
            then
                local name, desc = resolve_item(slot_data.id)
                if name then
                    equip_parts[#equip_parts + 1] = string.format(
                        '{"slot":%d,"slot_name":"%s","id":%d,"name":"%s","description":"%s"}',
                        slot_id,
                        esc(SLOT_LABEL[slot_id] or ('Slot '..slot_id)),
                        slot_data.id,
                        esc(name),
                        esc(desc:sub(1, 2000))
                    )
                end
            end
        end
    end

    -- ── Inventory items ──────────────────────────────────────────────────
    -- windower.ffxi.get_items(bag_id) returns a table of item slots.
    -- VERIFY: each slot is {id=..., count=..., status=...}; slot 0 is typically the
    -- "count" sentinel — iterate from 1. If items are missing, check container IDs above.
    local item_parts = {}

    for _, cont in ipairs(CONTAINERS) do
        local bag = windower.ffxi.get_items(cont.id)
        if type(bag) == 'table' then
            for slot_idx = 1, #bag do
                local slot = bag[slot_idx]
                if type(slot) == 'table' then
                    local id = slot.id or 0
                    if id ~= 0 and id ~= 65535 then
                        local name, desc = resolve_item(id)
                        if name then
                            item_parts[#item_parts + 1] = string.format(
                                '{"id":%d,"name":"%s","description":"%s","count":%d,"container":%d,"container_name":"%s","slot":%d}',
                                id,
                                esc(name),
                                esc((desc or ''):sub(1, 2000)),
                                slot.count or 1,
                                cont.id,
                                esc(cont.label),
                                slot_idx - 1
                            )
                        end
                    end
                end
            end
        end
    end

    -- ── Write JSON ───────────────────────────────────────────────────────
    -- Output format is identical to the Ashita4 version so the viewer works
    -- with both frameworks unchanged.
    local out = string.format(
        '{"character":"%s","nation":0,"rank":0,'..
        '"main_job":%d,"main_job_level":%d,"sub_job":%d,"sub_job_level":%d,'..
        '"job_levels":[%s],"equipment":[%s],"items":[%s]}',
        esc(char_name),
        main_job, main_job_lvl, sub_job, sub_job_lvl,
        table.concat(jlvl_parts, ','),
        table.concat(equip_parts, ','),
        table.concat(item_parts, ',')
    )

    write_file(PATH_OUT, out)

    if not silent then
        windower.add_to_chat(8, string.format(
            '[itemscan] Wrote %d items.', #item_parts
        ))
    end
end

-- ── Config polling ───────────────────────────────────────────────────────────
-- The viewer writes itemscan_config.json to control auto-scan and map tracking.

local function poll_config()
    local f = io.open(PATH_CFG, 'r')
    if not f then return end
    local raw = f:read('*a')
    f:close()
    state.auto     = (raw:match('"auto"%s*:%s*true')     ~= nil)
    state.maptrack = (raw:match('"maptrack"%s*:%s*true') ~= nil)
end

-- ── Reload flag ──────────────────────────────────────────────────────────────
-- The viewer's "Reload in-game" button writes reload_flag.txt.
-- We consume it and queue //lua reload itemscan so the new version loads.

local function poll_reload_flag()
    local f = io.open(PATH_RELOAD, 'r')
    if not f then return end
    f:close()
    os.remove(PATH_RELOAD)
    windower.send_command('lua reload itemscan')
end

-- ── Events ───────────────────────────────────────────────────────────────────

windower.register_event('load', function()
    poll_config()
    state.scan_at = state.frame + 180   -- auto-scan ~3s after load
end)

windower.register_event('prerender', function()
    state.frame = state.frame + 1

    if state.frame % 120 == 0 then      -- every ~2s at 60fps
        poll_config()
        poll_reload_flag()
    end

    if state.scan_at > 0 and state.frame >= state.scan_at then
        state.scan_at = 0
        do_scan(true)
    end

    -- Live map position: check ~2x/sec, write only when player moved > 0.5 yalms.
    if state.maptrack and state.frame % 30 == 0 then
        local p = windower.ffxi.get_player()
        if p then
            -- VERIFY: get_mob_by_index gives world position in Windower
            local mob  = windower.ffxi.get_mob_by_index(p.index)
            local zone = windower.ffxi.get_info().zone
            if mob then
                local x, y = mob.x or 0, mob.y or 0
                local lp = state.last_pos
                if lp.zone ~= zone or lp.x == nil
                    or math.abs(x - lp.x) >= 0.5 or math.abs(y - lp.y) >= 0.5 then
                    lp.zone = zone; lp.x = x; lp.y = y
                    write_file(PATH_POS, string.format(
                        '{"x":%.4f,"y":%.4f,"z":%.4f,"zone_id":%d}',
                        x, y, mob.z or 0, zone or 0
                    ))
                end
            end
        end
    end
end)

windower.register_event('incoming chunk', function(id)
    -- Same packet IDs as Ashita4 — FFXI game protocol is framework-agnostic.
    -- 0x1D = inventory finished, 0x50 = equipment change, 0x111 = RoE update
    if state.auto then
        if id == 0x1D or id == 0x111 then
            state.scan_at = state.frame + 60    -- debounce ~1s
        elseif id == 0x50 then
            state.scan_at = state.frame + 15    -- debounce ~0.25s (gear swap)
        end
    end
end)

windower.register_event('addon command', function(cmd, ...)
    cmd = (cmd or ''):lower()

    if cmd == '' or cmd == 'scan' then
        do_scan(false)

    elseif cmd == 'auto' then
        state.auto = not state.auto
        windower.add_to_chat(8, string.format(
            '[itemscan] Auto-scan %s.', state.auto and 'ON' or 'OFF'
        ))
        write_file(PATH_CFG, string.format(
            '{"auto":%s,"maptrack":%s}',
            tostring(state.auto), tostring(state.maptrack)
        ))

    elseif cmd == 'map' then
        state.maptrack = not state.maptrack
        windower.add_to_chat(8, string.format(
            '[itemscan] Map tracking %s.', state.maptrack and 'ON' or 'OFF'
        ))
        write_file(PATH_CFG, string.format(
            '{"auto":%s,"maptrack":%s}',
            tostring(state.auto), tostring(state.maptrack)
        ))

    else
        windower.add_to_chat(8, '[itemscan] Commands: //is, //is auto, //is map')
    end
end)
