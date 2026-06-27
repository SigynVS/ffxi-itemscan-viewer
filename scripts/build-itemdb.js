'use strict';

// One-off script: downloads Windower item name + description data from GitHub
// and writes data/items.json in the format the viewer expects.
// Run with: node scripts/build-itemdb.js

const https = require('https');
const fs    = require('fs');
const path  = require('path');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Each line looks like: [123] = {id=123,en="Some Name",...}
// Descriptions may contain \n sequences (literal backslash-n in the source).
function parseEnLines(lua) {
  const out = {};
  for (const line of lua.split('\n')) {
    const idM = line.match(/^\s*\[(\d+)\]/);
    if (!idM) continue;
    const enM = line.match(/\ben="((?:[^"\\]|\\.)*)"/);
    if (!enM) continue;
    let text = enM[1]
      .replace(/\\n/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .trim();
    out[idM[1]] = text;
  }
  return out;
}

async function main() {
  const BASE = 'https://raw.githubusercontent.com/Windower/Resources/master/resources_data';
  console.log('Fetching item names...');
  const [namesLua, descsLua] = await Promise.all([
    fetch(`${BASE}/items.lua`),
    fetch(`${BASE}/item_descriptions.lua`),
  ]);

  const names = parseEnLines(namesLua);
  const descs = parseEnLines(descsLua);

  const out = {};
  for (const id of Object.keys(names)) {
    out[id] = { name: names[id], desc: descs[id] || '' };
  }

  const outPath = path.join(__dirname, '..', 'data', 'items.json');
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`Written ${Object.keys(out).length} items to ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
