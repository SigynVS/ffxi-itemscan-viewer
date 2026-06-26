'use strict';

const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'FFXIItemScan/1.0', 'Accept-Encoding': 'identity' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|td|th|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseStrategies(section, endAnchor) {
  const match = section.match(new RegExp(`Setups and Strategies:\\n\\n([\\s\\S]*?)(?:\\n\\n${endAnchor}|$)`, 'i'));
  if (!match) return [];
  const stratText = match[1];
  const parts = stratText.split(/\n\n(?=Very Difficult:|Difficult:|Normal:|Easy:|Very Easy:)/);
  return parts
    .map(p => {
      const m = p.match(/^(Very Difficult|Difficult|Normal|Easy|Very Easy):\n\n([\s\S]+)/i);
      return m ? { difficulty: m[1], text: m[2].trim() } : null;
    })
    .filter(Boolean);
}

function parseNotes(section) {
  const match = section.match(/Notes:\n\n([\s\S]*?)\n\nSetups and Strategies:/i);
  if (!match) return [];
  const raw = match[1];
  const notes = [];
  let vdMode = false;
  for (const chunk of raw.split('\n\n')) {
    const l = chunk.trim();
    if (!l) continue;
    if (/^Very Difficult:$/.test(l)) { vdMode = true; continue; }
    if (/^Difficult:$|^Normal:$|^Easy:$|^Very Easy:$/.test(l)) { vdMode = false; continue; }
    if (/^[A-Z][^\n]{0,40}:$/.test(l)) continue; // boss name headers like "Bozzetto Songstress:"
    if (l.length < 6) continue;
    notes.push(vdMode ? `[VD only] ${l}` : l);
  }
  return notes;
}

async function fetchAmbuscadeData() {
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const now = new Date();
  const mon = MONTHS[now.getMonth()];
  const yr  = now.getFullYear();

  try {
    const html = await get('https://www.bg-wiki.com/ffxi/Category:Ambuscade');
    const text = stripHtml(html);

    const vol1Rx = new RegExp(`Volume 1,\\s*${mon}\\s+${yr},\\s*([^\\n]+)`, 'i');
    const vol2Rx = new RegExp(`Volume 2,\\s*${mon}\\s+${yr},\\s*([^\\n]+)`, 'i');
    const vol1Match = text.match(vol1Rx);
    const vol2Match = text.match(vol2Rx);

    // --- Vol 1 ---
    let mount = 'Unknown';
    let bosses = [];
    let notes = [];
    let strategies = [];
    let vol1KiMobs = [];

    if (vol1Match) {
      mount = vol1Match[1].trim();
      const vol1Start = text.indexOf(vol1Match[0]);
      const vol2Start = vol2Match ? text.indexOf(vol2Match[0]) : text.length;
      const vol1Section = text.slice(vol1Start, vol2Start);

      const vdMatch = vol1Section.match(/Very Difficult\n\n([\s\S]*?)\n\n[A-Z]/);
      if (vdMatch) bosses = vdMatch[1].split('\n').map(l => l.trim()).filter(Boolean);

      notes = parseNotes(vol1Section);
      strategies = parseStrategies(vol1Section, 'Key Item Locations:');

      const kiMatch = vol1Section.match(/Key Item Locations:\n\n([\s\S]*?)(?:\n\nRegular Ambuscade|$)/i);
      if (kiMatch) {
        vol1KiMobs = kiMatch[1].split('\n\n').map(l => l.trim()).filter(l => l.length > 3);
      }
    }

    // --- Vol 2 ---
    let vol2Mount = 'Unknown';
    let vol2Boss = 'Unknown';
    let vol2Adds = [];
    let vol2Strategy = '';
    let vol2KiMobs = [];

    if (vol2Match) {
      vol2Mount = vol2Match[1].trim();
      const vol2Start = text.indexOf(vol2Match[0]);
      const vol2Section = text.slice(vol2Start);

      const vdMatch = vol2Section.match(/Very Difficult\n\n([\s\S]*?)\n\n[A-Z]/);
      if (vdMatch) {
        const lines = vdMatch[1].split('\n').map(l => l.trim()).filter(Boolean);
        vol2Boss = lines[0].replace(/\s*\(\s*\)\s*$/, '').trim();
        if (lines[1]) vol2Adds = lines[1].split(',').map(a => a.trim()).filter(Boolean);
      }

      const vol2Strats = parseStrategies(vol2Section, 'Key Item Locations:');
      const vdStrat = vol2Strats.find(s => s.difficulty === 'Very Difficult');
      if (vdStrat) vol2Strategy = vdStrat.text;

      const kiMatch = vol2Section.match(/Key Item Locations:\n\n([\s\S]*?)(?:\n\nPrevious Battles|$)/i);
      if (kiMatch) {
        vol2KiMobs = kiMatch[1].split('\n\n').map(l => l.trim()).filter(l => l.length > 3);
      }
    }

    return {
      fetched: true,
      month: `${mon} ${yr}`,
      current: { mount, bosses, notes, strategies },
      vol2: { mount: vol2Mount, boss: vol2Boss, adds: vol2Adds, strategy: vol2Strategy },
      keyItems: {
        'Ambuscade Primer Volume One': { mobs: vol1KiMobs },
        'Ambuscade Primer Volume Two': { mobs: vol2KiMobs }
      }
    };
  } catch (err) {
    console.error('[ambuscade-fetch] failed:', err.message);
    return null;
  }
}

module.exports = { fetchAmbuscadeData };
