'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const { DATA_DIR } = require('./paths');

function load(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch (err) {
    return {};
  }
}

// Per-zone calibration data sourced from Electron-FFXI-Atlas by miguelstrife
// (https://github.com/miguelstrife/Electron-FFXI-Atlas). Used with attribution;
// that repo has no license file, so the usage terms are unconfirmed (ask the author).
// Files live under data/atlas/ to keep third-party data clearly separated.
const zoneOffset    = load('atlas/zoneOffset.json');
const zonesWithMaps = load('atlas/zonesWithMaps.json');

// User-supplied map images live here (the remapster wiki pack, unzipped).
// Starts from ITEMSCAN_MAPS or the per-user app-data folder; the Config tab can
// override it at runtime via setMapsDir (persisted in app_settings.json).
let mapsDir = process.env.ITEMSCAN_MAPS || path.join(app.getPath('userData'), 'maps');
function getMapsDir() { return mapsDir; }
function setMapsDir(dir) { if (dir) { mapsDir = dir; } }

function inRange(pos, r) {
  return pos.x >= r.x1 && pos.x <= r.x2
    && pos.y >= r.y1 && pos.y <= r.y2
    && pos.z >= r.z1 && pos.z <= r.z2;
}

// Resolves the active map (calibration + image filename) for a zone at a given
// position. Multi-floor zones pick the sub-map by coordinate range (falling back
// to the first if none match); flat zones use the single map. null = no map data.
function getZoneMap(zoneId, pos) {
  const multi = zonesWithMaps[String(zoneId)];
  if (multi && Array.isArray(multi.maps) && multi.maps.length) {
    let chosen = null;
    for (const m of multi.maps) {
      if ((m.ranges || []).some((r) => inRange(pos, r))) { chosen = m; break; }
    }
    if (!chosen) { chosen = multi.maps[0]; }
    return {
      file: `${multi.mapName}_${chosen.mapId}`,
      offsetX: chosen.offsetX, offsetY: chosen.offsetY, scale: chosen.scale
    };
  }
  const flat = zoneOffset[String(zoneId)];
  if (flat) {
    return { file: flat.mapName, offsetX: flat.offsetX, offsetY: flat.offsetY, scale: flat.scale };
  }
  return null;
}

function getZone(zoneId) {
  return zoneOffset[String(zoneId)] || null;
}

// Atlas gameToPixels: net pixel = 4*(offset +/- scale*coord) in 1024px space.
// `h` drives the horizontal (east-west) pixel axis, `v` the vertical (north-
// south, inverted). For Ashita (verified by movement): h = position.x (east=+x),
// v = position.y; position.z is height.
function toPercent(cal, h, v) {
  const px = 4 * (cal.offsetX + cal.scale * h);
  const py = 4 * (cal.offsetY - cal.scale * v);
  const clamp = (n) => Math.max(0, Math.min(100, n));
  return { xPct: clamp(px / 1024 * 100), yPct: clamp(py / 1024 * 100) };
}

// Reads a zone's map PNG from MAPS_DIR as a data URL, or null if not present.
function mapImageDataUrl(mapName) {
  try {
    const buf = fs.readFileSync(path.join(mapsDir, mapName + '.png'));
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch (err) {
    return null;
  }
}

module.exports = { getZone, getZoneMap, toPercent, mapImageDataUrl, getMapsDir, setMapsDir };
