#!/usr/bin/env node
// 단어 DB 검증: docs/04-word-db-spec.md §5 규칙
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'words');
const BASE_TAGS = new Set([
  'animals','food','school','home','body','clothes','jobs','places','transport',
  'nature','space','sports','toys','music','holidays','story','actions','feelings',
  'concepts','science',
]);

let errors = 0;
const seen = new Map(); // word -> file
const stats = { total: 0, levels: { 1: 0, 2: 0, 3: 0, 4: 0 }, emoji: 0, dupes: 0 };
const tagCount = new Map();

for (const file of readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  } catch (e) {
    console.error(`✗ ${file}: JSON parse error — ${e.message}`);
    errors++;
    continue;
  }
  if (!Array.isArray(data.words)) {
    console.error(`✗ ${file}: missing "words" array`);
    errors++;
    continue;
  }
  for (const w of data.words) {
    stats.total++;
    const id = `${file}:"${w.word}"`;
    if (!w.word || typeof w.word !== 'string') { console.error(`✗ ${id}: bad word`); errors++; continue; }
    if (![1, 2, 3, 4].includes(w.level)) { console.error(`✗ ${id}: level must be 1-4`); errors++; }
    if (!Array.isArray(w.tags) || w.tags.length === 0) { console.error(`✗ ${id}: tags missing`); errors++; }
    else {
      if (!w.tags.some(t => BASE_TAGS.has(t))) { console.error(`✗ ${id}: no base-category tag`); errors++; }
      for (const t of w.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    }
    if (!w.textHint || typeof w.textHint !== 'string') { console.error(`✗ ${id}: textHint missing`); errors++; }
    else if (w.textHint.toLowerCase().includes(w.word.toLowerCase())) {
      console.error(`✗ ${id}: textHint leaks the word`);
      errors++;
    }
    if (seen.has(w.word)) { stats.dupes++; console.warn(`⚠ dup "${w.word}" in ${file} (first: ${seen.get(w.word)}) — tags will merge at load`); }
    else seen.set(w.word, file);
    if (stats.levels[w.level] !== undefined) stats.levels[w.level]++;
    if (w.emoji) stats.emoji++;
  }
}

console.log('\n── stats ──');
console.log(`words: ${stats.total} (unique ${seen.size}) | L1 ${stats.levels[1]} / L2 ${stats.levels[2]} / L3 ${stats.levels[3]} / L4 ${stats.levels[4]} | emoji ${stats.emoji} (${Math.round(stats.emoji / stats.total * 100)}%) | cross-file dupes ${stats.dupes}`);
console.log('base-tag coverage:');
for (const t of [...BASE_TAGS]) console.log(`  ${t.padEnd(10)} ${tagCount.get(t) || 0}`);
console.log(errors ? `\n✗ ${errors} error(s)` : '\n✓ all checks passed');
process.exit(errors ? 1 : 0);
