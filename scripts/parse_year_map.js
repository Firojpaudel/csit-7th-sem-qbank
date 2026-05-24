const fs = require('fs');
const path = require('path');
const QUESTIONS_DB = require('../db.js');

const rawFiles = [
  'raw_advanced_java.txt',
  'raw_data_mining.txt',
  'raw_pom.txt',
  'raw_software_project_management.txt'
].map(f => path.join(__dirname, '..', f));

let rawContent = '';
for (const f of rawFiles) {
  if (fs.existsSync(f)) {
    rawContent += '\n' + fs.readFileSync(f, 'utf8');
  }
}

// find year headers (4-digit numbers)
const yearHeaderRegex = /(^|\n)\s*(\d{4})\s*(?=\n)/g;
let match;
const years = [];
while ((match = yearHeaderRegex.exec(rawContent)) !== null) {
  years.push({ year: match[2], index: match.index + match[1].length });
}

function findClosestYear(index) {
  let best = null;
  for (const y of years) {
    if (y.index <= index) best = y.year;
    else break;
  }
  return best;
}

const mapping = {};

for (const [subId, questions] of Object.entries(QUESTIONS_DB)) {
  for (const q of questions) {
    const text = typeof q === 'object' ? q.text : q;
    const short = text.slice(0, 80).replace(/\s+/g, ' ').trim();
    const idx = rawContent.indexOf(short);
    if (idx !== -1) {
      const y = findClosestYear(idx) || 'unknown';
      mapping[text] = y;
    } else {
      // try looser: search for first 20 chars
      const s2 = text.slice(0, 20).replace(/\s+/g, ' ').trim();
      const idx2 = rawContent.indexOf(s2);
      if (idx2 !== -1) {
        const y = findClosestYear(idx2) || 'unknown';
        mapping[text] = y;
      } else {
        // leave unassigned
      }
    }
  }
}

const outPath = path.join(__dirname, '..', 'assets', 'year_map.json');
fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2), 'utf8');
console.log('Wrote', outPath, 'with', Object.keys(mapping).length, 'entries');
