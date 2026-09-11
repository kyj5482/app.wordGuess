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

// 레벨별 최소 유니크 단어 수 — "20게임 중복률 20% 이내" 보장선.
// 근거: 60초 라운드 · 평균 4초/단어 ≈ 15단어 → 20게임 = 300단어 소비.
// 중복률 = (300 − 풀)/300 ≤ 20% → 풀 ≥ 240. (행동 검증은 app/tests/game-logic)
const MIN_UNIQUE_PER_LEVEL = 240;

let errors = 0;

// ── 매니페스트(index.json) ↔ 디렉토리 일치 — words.js는 매니페스트만 로드하므로
//    여기 안 적힌 파일은 조용히 무시된다. 그 불일치를 에러로 승격.
let manifest = [];
try {
  manifest = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).files;
  if (!Array.isArray(manifest)) throw new Error('files 배열 없음');
} catch (e) {
  console.error(`✗ index.json (매니페스트): ${e.message}`);
  errors++;
}
const onDisk = readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
for (const f of onDisk) {
  if (!manifest.includes(f)) { console.error(`✗ ${f}: 디렉토리에 있지만 매니페스트에 없음 — 게임에서 로드 안 됨`); errors++; }
}
for (const f of manifest) {
  if (!onDisk.includes(f)) { console.error(`✗ ${f}: 매니페스트에 있지만 파일 없음`); errors++; }
}

const seen = new Map(); // word -> file
const stats = { total: 0, levels: { 1: 0, 2: 0, 3: 0, 4: 0 }, emoji: 0, dupes: 0 };
const uniqueLevels = { 1: 0, 2: 0, 3: 0, 4: 0 }; // 최초 등장 기준 (words.js 병합 규칙과 동일)
const tagCount = new Map();

// 매니페스트 순서로 순회 — 중복 단어의 레벨 귀속이 로더(words.js)와 같아지게
for (const file of manifest.filter(f => onDisk.includes(f))) {
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
    else {
      seen.set(w.word, file);
      if (uniqueLevels[w.level] !== undefined) uniqueLevels[w.level]++;
    }
    if (stats.levels[w.level] !== undefined) stats.levels[w.level]++;
    if (w.emoji) stats.emoji++;
  }
}

// ── 레벨별 최소 유니크 단어 수 (20게임 중복률 보장) ──
for (const n of [1, 2, 3, 4]) {
  if (uniqueLevels[n] < MIN_UNIQUE_PER_LEVEL) {
    console.error(`✗ L${n}: 유니크 ${uniqueLevels[n]}개 < 최소 ${MIN_UNIQUE_PER_LEVEL}개 — 20게임 중복률 20% 초과 위험`);
    errors++;
  }
}

console.log('\n── stats ──');
console.log(`words: ${stats.total} (unique ${seen.size}) | unique L1 ${uniqueLevels[1]} / L2 ${uniqueLevels[2]} / L3 ${uniqueLevels[3]} / L4 ${uniqueLevels[4]} (min ${MIN_UNIQUE_PER_LEVEL}) | emoji ${stats.emoji} (${Math.round(stats.emoji / stats.total * 100)}%) | cross-file dupes ${stats.dupes}`);
console.log('base-tag coverage:');
for (const t of [...BASE_TAGS]) console.log(`  ${t.padEnd(10)} ${tagCount.get(t) || 0}`);
console.log(errors ? `\n✗ ${errors} error(s)` : '\n✓ all checks passed');
process.exit(errors ? 1 : 0);
