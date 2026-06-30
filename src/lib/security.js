'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Audit logging ────────────────────────────────────────────────
// Appends one timestamped line per security event to security.log in userData.

let _logPath = null;
function logPath() {
  if (!_logPath) _logPath = path.join(app.getPath('userData'), 'security.log');
  return _logPath;
}

function auditLog(event, detail = '') {
  try {
    const line = `[${new Date().toISOString()}] ${event}${detail ? ' - ' + detail : ''}\n`;
    fs.appendFileSync(logPath(), line, 'utf8');
  } catch (_) { /* non-fatal - never let logging crash the app */ }
}

// ── File guards ──────────────────────────────────────────────────

function checkFileSize(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    const msg = `${path.basename(filePath)}: ${stat.size} bytes (max ${MAX_FILE_BYTES})`;
    auditLog('FILE_TOO_LARGE', msg);
    throw new Error(`File too large: ${msg}`);
  }
}

// ── JSON schema validation ───────────────────────────────────────
// Parses and validates inventory.json. Throws on structural violations.

function validateInventoryJson(raw) {
  const data = JSON.parse(raw); // let the native parser throw on malformed JSON
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    auditLog('SCHEMA_INVALID', `inventory root is not an object: ${typeof data}`);
    throw new Error('inventory.json must be a JSON object');
  }
  // Validate top-level scalar fields that the renderer uses directly
  if (data.character !== undefined && typeof data.character !== 'string') {
    auditLog('SCHEMA_INVALID', `character is not a string: ${typeof data.character}`);
    throw new Error('inventory.json character must be a string');
  }
  if (data.character && data.character.length > 64) {
    auditLog('SCHEMA_INVALID', `character name too long: ${data.character.length}`);
    throw new Error('inventory.json character name too long');
  }
  if (data.nation !== undefined && typeof data.nation !== 'number') {
    auditLog('SCHEMA_INVALID', `nation is not a number: ${typeof data.nation}`);
    throw new Error('inventory.json nation must be a number');
  }
  if (data.rank !== undefined && typeof data.rank !== 'number') {
    auditLog('SCHEMA_INVALID', `rank is not a number: ${typeof data.rank}`);
    throw new Error('inventory.json rank must be a number');
  }
  // Validate optional job level fields
  for (const f of ['main_job', 'main_job_level', 'sub_job', 'sub_job_level']) {
    if (data[f] !== undefined && typeof data[f] !== 'number') {
      auditLog('SCHEMA_INVALID', `${f} is not a number: ${typeof data[f]}`);
      throw new Error(`inventory.json ${f} must be a number`);
    }
  }
  if (data.job_levels !== undefined) {
    if (!Array.isArray(data.job_levels) || data.job_levels.length > 22) {
      auditLog('SCHEMA_INVALID', `job_levels invalid (len=${Array.isArray(data.job_levels) ? data.job_levels.length : 'non-array'})`);
      throw new Error('inventory.json job_levels must be an array of ≤22 numbers');
    }
    for (const lvl of data.job_levels) {
      if (typeof lvl !== 'number') {
        auditLog('SCHEMA_INVALID', 'job_levels contains non-number');
        throw new Error('inventory.json job_levels entries must be numbers');
      }
    }
  }

  // Validate optional equipment array
  if (data.equipment !== undefined) {
    if (!Array.isArray(data.equipment) || data.equipment.length > 16) {
      auditLog('SCHEMA_INVALID', `equipment invalid (len=${Array.isArray(data.equipment) ? data.equipment.length : 'non-array'})`);
      throw new Error('inventory.json equipment must be an array of ≤16 objects');
    }
    for (const eq of data.equipment) {
      if (typeof eq !== 'object' || eq === null || Array.isArray(eq)) {
        auditLog('SCHEMA_INVALID', 'equipment entry is not a plain object');
        throw new Error('Each equipment entry must be an object');
      }
      if (typeof eq.slot !== 'number' || eq.slot < 0 || eq.slot > 15) {
        auditLog('SCHEMA_INVALID', `equipment slot out of range: ${eq.slot}`);
        throw new Error('Equipment slot must be 0–15');
      }
      if (eq.name !== undefined && (typeof eq.name !== 'string' || eq.name.length > 64)) {
        auditLog('SCHEMA_INVALID', `equipment name invalid for slot ${eq.slot}`);
        throw new Error('Equipment name must be a string ≤64 chars');
      }
      if (eq.description !== undefined && typeof eq.description !== 'string') {
        auditLog('SCHEMA_INVALID', `equipment description not a string for slot ${eq.slot}`);
        throw new Error('Equipment description must be a string');
      }
      if (typeof eq.description === 'string' && eq.description.length > 2000) {
        eq.description = eq.description.slice(0, 2000);
      }
    }
  }

  // Validate each item in the items array
  const items = data.items;
  if (items !== undefined && !Array.isArray(items)) {
    auditLog('SCHEMA_INVALID', 'items is not an array');
    throw new Error('inventory.json items must be an array');
  }
  for (const item of (items || [])) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      auditLog('SCHEMA_INVALID', 'item entry is not a plain object');
      throw new Error('Each inventory item must be an object');
    }
    if (typeof item.id !== 'number' || !Number.isFinite(item.id)) {
      auditLog('SCHEMA_INVALID', `item.id not a finite number: ${JSON.stringify(item.id)}`);
      throw new Error('Item id must be a finite number');
    }
    if (item.name !== undefined && typeof item.name !== 'string') {
      auditLog('SCHEMA_INVALID', `item.name not a string for id=${item.id}`);
      throw new Error('Item name must be a string');
    }
    if (typeof item.name === 'string' && item.name.length > 64) {
      auditLog('SCHEMA_INVALID', `item.name too long (${item.name.length}) for id=${item.id}`);
      throw new Error(`Item name too long: "${item.name.slice(0, 20)}…"`);
    }
    if (item.description !== undefined && typeof item.description !== 'string') {
      auditLog('SCHEMA_INVALID', `item.description not a string for id=${item.id}`);
      throw new Error('Item description must be a string');
    }
    // Clamp description - game data is at most ~256 chars; anything larger is suspicious
    if (typeof item.description === 'string' && item.description.length > 2000) {
      item.description = item.description.slice(0, 2000);
    }
  }
  return data;
}

// ── Path validation ──────────────────────────────────────────────

function validateAddonPath(dirPath) {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    auditLog('PATH_INVALID', 'empty or non-string addon path');
    throw new Error('Addon path must be a non-empty string');
  }
  if (dirPath.includes('\0')) {
    auditLog('PATH_INVALID', 'null byte in path - possible path traversal attempt');
    throw new Error('Path contains null bytes');
  }
  const resolved = path.resolve(dirPath.trim());
  if (!path.isAbsolute(resolved)) {
    auditLog('PATH_INVALID', `non-absolute resolved path: ${resolved}`);
    throw new Error('Addon path must be absolute');
  }
  return resolved;
}

// ── IPC argument validators ──────────────────────────────────────
// Every IPC handler calls one of these before touching any data.

function validateItemId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    auditLog('IPC_INVALID', `bad itemId: ${JSON.stringify(id)}`);
    throw new Error(`Item ID must be an integer 1–65535, got: ${id}`);
  }
  return n;
}

function validateItemIds(ids) {
  if (!Array.isArray(ids)) {
    auditLog('IPC_INVALID', 'itemIds is not an array');
    throw new Error('Item IDs must be an array');
  }
  if (ids.length > 10000) {
    auditLog('IPC_INVALID', `itemIds array too large: ${ids.length}`);
    throw new Error('Too many item IDs requested');
  }
  return ids.map(validateItemId);
}

function validateConcurrency(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > 10) {
    auditLog('IPC_INVALID', `bad concurrency: ${JSON.stringify(n)}`);
    throw new Error(`Concurrency must be an integer 1–10, got: ${n}`);
  }
  return num;
}

function validateCharacter(character) {
  if (typeof character !== 'string') {
    auditLog('IPC_INVALID', `character is not a string: ${typeof character}`);
    throw new Error('Character must be a string');
  }
  if (character.length > 64) {
    auditLog('IPC_INVALID', `character name too long: ${character.length} chars`);
    throw new Error('Character name too long');
  }
  return character;
}

function validateLabelKey(key) {
  if (typeof key !== 'string' || key.length > 128) {
    auditLog('IPC_INVALID', `bad label key: ${JSON.stringify(key)}`);
    throw new Error('Label key must be a string ≤128 chars');
  }
  return key;
}

function validateLabelName(name) {
  if (typeof name !== 'string' || name.length > 256) {
    auditLog('IPC_INVALID', `bad label name type=${typeof name} len=${String(name).length}`);
    throw new Error('Label name must be a string ≤256 chars');
  }
  return name;
}

function validateAddonConfig(cfg) {
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) {
    auditLog('IPC_INVALID', `bad addon config type: ${typeof cfg}`);
    throw new Error('Addon config must be a plain object');
  }
  // Whitelist: only known boolean fields are written to disk.
  // Anything else the renderer sends is silently dropped.
  return {
    auto: Boolean(cfg.auto),
    maptrack: Boolean(cfg.maptrack)
  };
}

module.exports = {
  MAX_FILE_BYTES,
  auditLog,
  checkFileSize,
  validateInventoryJson,
  validateAddonPath,
  validateItemId,
  validateItemIds,
  validateConcurrency,
  validateCharacter,
  validateLabelKey,
  validateLabelName,
  validateAddonConfig
};
