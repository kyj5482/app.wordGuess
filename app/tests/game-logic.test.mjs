#!/usr/bin/env node
// 게임 로직 단위 테스트 — 앱 번들(app/www/js)의 실제 모듈을 그대로 검증.
// 라운드 진행(점수·잠금·힌트·타이머), 단어 덱(레벨 필터·중복 방지), 그룹 캘리브레이션.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeClock } from './helpers/fake-clock.mjs';
import { check, done } from './helpers/t.mjs';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const WWW = join(APP, 'www');

// ── 환경 스텁 (모듈 import 전에) ──
const clock = installFakeClock(globalThis);
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'test', vibrate: () => true }, configurable: true,
});
globalThis.window = globalThis; // sound.js initAudio용 (호출 안 하지만 안전망)
const WORDS_DIR = join(WWW, 'data', 'words');
globalThis.fetch = async url => {
  const f = String(url).split('/').pop();
  const body = readFileSync(join(WORDS_DIR, f), 'utf8');
  return { ok: true, json: async () => JSON.parse(body) };
};

const words = await import(`file://${WWW}/js/words.js`);
const { Round } = await import(`file://${WWW}/js/round.js`);
const { Calibration, SLOTS, TAPS_PER_PLAYER } = await import(`file://${WWW}/js/calibrate.js`);

// ── 단어 DB ──
const total = await words.loadWords();
check('단어 로드', total > 900, `${total}개`);
{
  // 매니페스트(index.json) ↔ 디렉토리 일치 — words.js는 매니페스트만 로드하므로
  // 누락 파일은 조용히 무시된다. 앱 번들에서도 그 불일치가 없음을 보장.
  const manifest = [...JSON.parse(readFileSync(join(WORDS_DIR, 'index.json'), 'utf8')).files].sort();
  const onDisk = readdirSync(WORDS_DIR).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
  check('단어 파일 매니페스트 = 디렉토리', JSON.stringify(manifest) === JSON.stringify(onDisk),
    `${onDisk.length}개 파일`);
}

{
  const deck3 = words.buildDeck('*', '3', null);
  check('레벨 필터: level=3 덱은 전부 레벨 3', deck3.length > 0 && deck3.every(w => w.level === 3),
    `${deck3.length}개`);
  const auto = words.buildDeck('*', 'auto', 3);
  check('Auto 덱: 그룹 레벨 3 → 레벨 2·3만', auto.length > 0 && auto.every(w => w.level === 2 || w.level === 3),
    `${auto.length}개`);
  const auto1 = words.buildDeck('*', 'auto', 1);
  check('Auto 덱: 그룹 레벨 1 → 레벨 1만', auto1.length > 0 && auto1.every(w => w.level === 1));
  const animals = words.buildDeck('animals', 'mix', null);
  check('카테고리 필터: animals 태그만', animals.length > 0 && animals.every(w => w.tags.includes('animals')));
}

{
  // 세션 내 재출제 금지: 사용 처리한 단어는 다음 덱에서 제외
  const deck = words.buildDeck('animals', 'mix', null);
  const first = deck[0].word;
  words.markUsed(first);
  const deck2 = words.buildDeck('animals', 'mix', null);
  check('사용한 단어는 다음 덱에서 제외', !deck2.some(w => w.word === first));
}

{
  // 필수 필드: 모든 단어에 textHint (힌트는 그림+텍스트 원칙 — 텍스트 필수)
  const deck = words.buildDeck('*', 'mix', null);
  check('모든 단어에 textHint 존재', deck.every(w => typeof w.textHint === 'string' && w.textHint.length > 0));
}

// ── 20게임 중복률 (레벨별) ─────────────────────────────────
// 모델: 60초 라운드 · 평균 4초/단어 ≈ 15단어/게임 → 20게임 = 300단어 소비.
// 요구: 재출제 단어 비율 ≤ 20%. 실제 buildDeck/markUsed 로직으로 시뮬레이션
// (덱 소진 시 사용 기록 리셋되는 동작 포함 — 단어 수가 부족하면 여기서 잡힌다).
const WORDS_PER_GAME = 15, GAMES = 20;
for (const level of ['1', '2', '3', '4']) {
  // 레벨마다 새 세션 (usedThisSession이 모듈 상태라 재-import로 격리)
  const w = await import(`file://${WWW}/js/words.js?dupsim=${level}`);
  await w.loadWords();
  const shows = [];
  for (let g = 0; g < GAMES; g++) {
    const deck = w.buildDeck('*', level, null);
    for (const card of deck.slice(0, WORDS_PER_GAME)) {
      w.markUsed(card.word);
      shows.push(card.word);
    }
  }
  const dup = shows.length - new Set(shows).size;
  const rate = dup / shows.length;
  check(`레벨 ${level}: 20게임(15단어/60초) 중복률 ≤ 20%`, shows.length === GAMES * WORDS_PER_GAME && rate <= 0.20,
    `${shows.length}단어 중 재출제 ${dup}개 (${(rate * 100).toFixed(1)}%)`);
}
{
  // Auto 모드(그룹 레벨 N = N + N−1 믹스)는 풀이 더 크므로 최악 케이스인 N=1만 확인
  const w = await import(`file://${WWW}/js/words.js?dupsim=auto1`);
  await w.loadWords();
  const shows = [];
  for (let g = 0; g < GAMES; g++) {
    for (const card of w.buildDeck('*', 'auto', 1).slice(0, WORDS_PER_GAME)) {
      w.markUsed(card.word);
      shows.push(card.word);
    }
  }
  const rate = (shows.length - new Set(shows).size) / shows.length;
  check('Auto(그룹 레벨 1): 20게임 중복률 ≤ 20%', rate <= 0.20, `${(rate * 100).toFixed(1)}%`);
}

// ── 라운드 ──
function makeUI() {
  const log = { words: [], feedback: [], hints: [], timer: [] };
  return {
    log,
    word: w => log.words.push(w.word),
    timer: s => log.timer.push(s),
    feedback: (k, s) => log.feedback.push([k, s]),
    hint: h => log.hints.push(h),
  };
}
const mkDeck = n => Array.from({ length: n }, (_, i) =>
  ({ word: `w${i}`, level: 1, tags: ['t'], textHint: `hint ${i}`, emoji: i % 2 ? '🙂' : undefined }));

{
  const ui = makeUI();
  let ended = null;
  const r = new Round({ deck: mkDeck(50), timeLimitS: 60, ui, onEnd: res => { ended = res; } });
  r.start();
  check('시작 시 첫 단어 표시', ui.log.words[0] === 'w0');

  r.correct();
  check('정답 → 점수 1, 다음 단어', r.score === 1 && ui.log.words[1] === 'w1');

  r.correct(); // 잠금(700ms) 내 재입력 — 무시되어야 함 (모션 쿨다운 이중 방어)
  check('입력 잠금: 700ms 내 재입력 무시', r.score === 1 && ui.log.words.length === 2);

  clock.advance(700);
  r.skip();
  check('Skip → 점수 유지, 다음 단어', r.score === 1 && ui.log.words[2] === 'w2');

  clock.advance(700);
  const before = r.remaining;
  r.hint();
  check('힌트 → 시간 −5초, 힌트 UI 호출', r.remaining === before - 5 && ui.log.hints.length === 1);
  check('힌트에 텍스트 필수 포함', ui.log.hints[0].text === 'hint 2');
  r.hint();
  check('힌트 1회 제한: 재호출 무시', r.remaining === before - 5 && ui.log.hints.length === 1);
  check('힌트 소진 플래그', r.hintExhausted());

  // 타이머 소진 → 종료, 마지막 단어는 timeup으로 기록
  clock.advance(60_000);
  check('시간 종료 → onEnd 호출', !!ended, ended && `score=${ended.score}`);
  check('결과: 정답 1, skip 1, timeup 1', ended &&
    JSON.stringify(ended.results.map(x => x.outcome)) === '["correct","skip","timeup"]');
  check('timeup 단어에 힌트 사용 기록', ended && ended.results[2].hintsUsed === 1);

  r.correct(); // 종료 후 입력 무시
  check('종료 후 입력 무시', ended.score === 1 && r.score === 1);
}

{
  // 덱 소진 종료
  const ui = makeUI();
  let ended = null;
  const r = new Round({ deck: mkDeck(2), timeLimitS: 60, ui, onEnd: res => { ended = res; } });
  r.start();
  r.correct(); clock.advance(700); r.correct();
  check('덱 소진 → 즉시 종료, 점수 2', !!ended && ended.score === 2);
}

{
  // 5초 이하 카운트다운 틱 + 매초 타이머 UI
  const ui = makeUI();
  const r = new Round({ deck: mkDeck(50), timeLimitS: 8, ui, onEnd: () => {} });
  r.start();
  clock.advance(3000);
  check('타이머 UI 매초 갱신', JSON.stringify(ui.log.timer) === '[8,7,6,5]');
}

// ── 그룹 캘리브레이션 ──
{
  const cal = new Calibration('*');
  const slots = cal.startPlayer();
  check(`캘리브레이션: ${SLOTS}칸, 전부 레벨 2 시작`, slots.length === SLOTS && slots.every(s => s && s.level === 2));

  // 참가자 1: 레벨 2를 2회 탭 → 개인 레벨 2
  cal.tap(0); cal.tap(1);
  const p1 = cal.finishPlayer();
  check('2회 탭한 레벨만 인정 → 레벨 2', p1.level === 2, `taps=${JSON.stringify(p1.taps)}`);

  // 참가자 2: 계단 오르기 — 슬롯 0을 계속 탭 (2→3→4), 슬롯 1도 3까지
  const slots2 = cal.startPlayer();
  check('새 참가자: 새 슬롯', slots2.every(s => s && s.level === 2));
  cal.tap(0); cal.tap(0); cal.tap(1); cal.tap(1); // 레벨2 ×2, 레벨3 ×2
  const p2 = cal.finishPlayer();
  check('레벨 3을 2회 탭 → 개인 레벨 3', p2.level === 3, `taps=${JSON.stringify(p2.taps)}`);

  check('그룹 레벨 = 참가자 최소', cal.groupLevel() === 2);
}

{
  // 탭 1회뿐인 레벨은 우연으로 간주 (보수적)
  const cal = new Calibration('*');
  cal.startPlayer();
  cal.tap(0); // 레벨 2 한 번만
  const p = cal.finishPlayer();
  check('1회 탭은 미인정 → 레벨 1', p.level === 1);
  check('참가자 없으면 시작 레벨(2)', new Calibration('*').groupLevel() === 2);
}

{
  // 자동 완료: TAPS_PER_PLAYER회 탭하면 done
  const cal = new Calibration('*');
  cal.startPlayer();
  let doneFlag = false;
  for (let i = 0; i < TAPS_PER_PLAYER; i++) doneFlag = cal.tap(i % SLOTS).done;
  check(`${TAPS_PER_PLAYER}회 탭 → 자동 완료`, doneFlag);

  // 중복 출제 금지: 캘리브레이션에 나온 단어는 서로 다르다
  const cal2 = new Calibration('*');
  const seen = new Set();
  let dup = false;
  const s = cal2.startPlayer();
  for (const x of s) { if (seen.has(x.word)) dup = true; seen.add(x.word); }
  for (let i = 0; i < 12; i++) {
    const { slot } = cal2.tap(i % SLOTS);
    if (slot) { if (seen.has(slot.word)) dup = true; seen.add(slot.word); }
  }
  check('캘리브레이션 단어 중복 없음', !dup, `${seen.size}개 출제`);
}

done();
