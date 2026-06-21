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

// Per-zone calibration: { "<zoneId>": { mapName, scale, offsetX, offsetY } }
const zoneOffset = load('zoneOffset.json');

// User-supplied map images live here (the remapster wiki pack, unzipped).
// Override with ITEMSCAN_MAPS. Not bundled (too large + licensing).
const MAPS_DIR = process.env.ITEMSCAN_MAPS || path.join(app.getPath('userData'), 'maps');

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
    const buf = fs.readFileSync(path.join(MAPS_DIR, mapName + '.png'));
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch (err) {
    return null;
  }
}

module.exports = { getZone, toPercent, mapImageDataUrl, MAPS_DIR };
