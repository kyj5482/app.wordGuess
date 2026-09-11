#!/usr/bin/env node
// 앱 플로우 통합 테스트 — 앱 번들(app/www)의 index.html + 실제 모듈 전체를 jsdom에서
// 구동하고, 가짜 타이머로 실시간 대기 없이 시나리오를 재생한다.
//
//  시나리오 1 (터치 모드): 홈 → 카테고리 → 설정 → 카운트다운 → 라운드
//    (정답 탭·디바운스·Skip·힌트 감점) → 시간 종료 → 결과 → 다음 사람
//  시나리오 2 (모션 모드): 합성 deviceorientation 이벤트로 기울임 동작을 재생해
//    정답/Skip 판정·재무장 진동까지 웹 PoC와 동일하게 동작하는지 검증
//  시나리오 3 (Auto 레벨): 그룹 캘리브레이션 → 참가자 전환 오버레이 → 그룹 레벨 확정

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { installFakeClock, flushMicrotasks } from './helpers/fake-clock.mjs';
import { check, done } from './helpers/t.mjs';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const WWW = join(APP, 'www');
const HTML = readFileSync(join(WWW, 'index.html'), 'utf8');

let seq = 0;

function setupEnv({ storage = {} } = {}) {
  const dom = new JSDOM(HTML, { url: 'https://app.local/' });
  const win = dom.window;
  const clock = installFakeClock(globalThis);
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.localStorage = win.localStorage;
  win.localStorage.clear();
  for (const [k, v] of Object.entries(storage)) win.localStorage.setItem(k, v);
  const mq = { matches: false, addEventListener() {}, removeEventListener() {} };
  globalThis.matchMedia = () => mq;
  win.matchMedia = globalThis.matchMedia;
  const vibrations = [];
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'test', vibrate: p => { vibrations.push(p); return true; } },
    configurable: true,
  });
  globalThis.fetch = async url => {
    const f = String(url).split('/').pop();
    const body = readFileSync(join(WWW, 'data', 'words', f), 'utf8');
    return { ok: true, json: async () => JSON.parse(body) };
  };
  delete globalThis.DeviceOrientationEvent;
  delete globalThis.DeviceMotionEvent;

  const $ = id => win.document.getElementById(id);
  const active = () => win.document.querySelector('.screen.active')?.id;
  const click = el => { clock.advance(450); el.click(); }; // 전역 400ms 디바운스 회피
  const pointerdown = el => el.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));

  // 조건 충족까지 가짜 시간 진행 (매 스텝 tick 훅 — 센서 이벤트 주입 등)
  async function pumpUntil(cond, maxMs, tick) {
    const start = clock.now;
    while (!cond() && clock.now - start < maxMs) {
      tick?.();
      await clock.advanceAsync(20, 20);
    }
    await flushMicrotasks();
    return cond();
  }

  return { dom, win, clock, vibrations, $, active, click, pointerdown, pumpUntil };
}

async function loadApp(env) {
  const mod = await import(`${pathToFileURL(join(WWW, 'js', 'app.js')).href}?s=${++seq}`);
  await flushMicrotasks(); // loadWords 완료
  await flushMicrotasks();
  return mod;
}

// 합성 deviceorientation 공급기 — tilt(deg)를 beta = 90 − tilt 관계로 방사
function makeFeeder(env) {
  let tilt = 0;
  const emit = () => {
    const ev = new env.win.Event('deviceorientation');
    ev.alpha = 0; ev.beta = 90 - tilt; ev.gamma = 0;
    env.win.dispatchEvent(ev);
  };
  const feed = async (target, ms) => {
    const from = tilt;
    const steps = Math.max(1, Math.round(ms / 18));
    for (let i = 1; i <= steps; i++) {
      await env.clock.advanceAsync(18, 18);
      tilt = from + (target - from) * i / steps;
      emit();
    }
  };
  return { emit, feed, get tilt() { return tilt; } };
}

// ══ 시나리오 1: 터치 모드 전체 플로우 ══════════════════════════════
{
  console.log('── 시나리오 1: 터치 모드 전체 플로우');
  const env = setupEnv({ storage: { 'wg.controls': 'touch', 'wg.time': '60' } });
  const { $, active, click, pointerdown, clock, pumpUntil, vibrations } = env;
  await loadApp(env);

  check('시작 화면', active() === 'screen-home');
  click($('btn-start'));
  await flushMicrotasks();
  check('시작 → 카테고리 화면 (터치 모드: 권한 프롬프트 없음)', active() === 'screen-category');

  const cards = env.win.document.querySelectorAll('.cat-card');
  check('카테고리 카드 렌더링', cards.length >= 10, `${cards.length}개`);
  click(cards[0]); // Everything
  check('카테고리 → 설정 화면', active() === 'screen-settings');
  check('덱 단어 수 표시', /words ready/.test($('deck-count').textContent), $('deck-count').textContent);

  click($('btn-play'));
  check('Play → 준비 화면', active() === 'screen-ready');
  check('터치 모드 안내문', /Tap/.test($('ready-help').textContent));

  click($('btn-round-start'));
  const started = await pumpUntil(() => active() === 'screen-round', 4000);
  check('카운트다운(3·2·1) 후 라운드 시작', started);
  check('터치 모드: 탭 존 표시', !$('tap-zones').classList.contains('hidden'));

  const w1 = $('round-word').textContent;
  check('첫 단어 표시', w1.length > 0, w1);

  clock.advance(400);
  pointerdown($('tap-correct'));
  check('정답 탭 → 점수 1, 다음 단어', $('round-score').textContent === '✅ 1' && $('round-word').textContent !== w1);
  check('정답 진동(길게 400ms)', vibrations.includes(400));

  const w2 = $('round-word').textContent;
  pointerdown($('tap-correct')); // 300ms 디바운스 내 재탭 — 무시
  check('탭 디바운스: 연속 탭 무시', $('round-score').textContent === '✅ 1' && $('round-word').textContent === w2);

  clock.advance(800);
  pointerdown($('tap-skip'));
  check('Skip 탭 → 점수 유지, 다음 단어', $('round-score').textContent === '✅ 1' && $('round-word').textContent !== w2);
  check('Skip 진동(톡톡 패턴)', vibrations.some(v => JSON.stringify(v) === '[60,80,60]'));

  clock.advance(800);
  const timerBefore = Number($('round-timer').textContent);
  pointerdown($('btn-hint'));
  check('힌트 → 시간 −5초', Number($('round-timer').textContent) === timerBefore - 5,
    `${timerBefore} → ${$('round-timer').textContent}`);
  check('힌트 텍스트 표시', $('hint-text').textContent.length > 0, $('hint-text').textContent);
  check('힌트 1회 소진 → 버튼 비활성', $('btn-hint').disabled);

  await clock.advanceAsync(61_000, 100); // 남은 시간 소진
  check('시간 종료 → 결과 화면', active() === 'screen-result');
  check('결과 점수 1', $('result-score').textContent === '1');
  // 요약의 Skip 수는 미정답(skip+timeup) 합계 — 웹 PoC와 동일 기준
  check('결과 요약: Skip 2(스킵+타임업) · Hint 1', $('result-summary').textContent.includes('Skip 2') &&
    $('result-summary').textContent.includes('Hint 1'), $('result-summary').textContent);

  click($('btn-toggle-details'));
  const items = env.win.document.querySelectorAll('#result-list li');
  check('단어 목록: 정답+Skip+타임업 3개', !$('result-list').classList.contains('hidden') && items.length === 3,
    `${items.length}개`);

  click($('btn-next-player'));
  check('다음 사람 → 준비 화면', active() === 'screen-ready');
}

// ══ 시나리오 2: 모션 모드 — 기울임 동작으로 정답/Skip ═══════════════
{
  console.log('\n── 시나리오 2: 모션 모드 (합성 센서 이벤트)');
  const env = setupEnv({ storage: { 'wg.controls': 'motion', 'wg.motionOk': '1', 'wg.time': '60' } });
  const { $, active, click, clock, pumpUntil, vibrations } = env;
  globalThis.DeviceOrientationEvent = class {}; // 권한 API 없는 플랫폼 (Android/WebView)
  const feeder = makeFeeder(env);
  await loadApp(env);

  click($('btn-start'));
  const toCategory = await pumpUntil(() => active() === 'screen-category', 3000, feeder.emit);
  check('모션 프로브 통과 → 카테고리 화면', toCategory);
  check('모션 사용 가능: 폴백 경고 없음', $('motion-status').textContent === '');

  click(env.win.document.querySelector('.cat-card'));
  click($('btn-play'));
  check('준비 화면: 모션 안내문(Tilt)', active() === 'screen-ready' && /Tilt/.test($('ready-help').textContent));

  click($('btn-round-start'));
  const started = await pumpUntil(() => active() === 'screen-round', 4000, feeder.emit);
  check('라운드 시작 (이마 자세 0°에서 캘리브레이션)', started);
  check('모션 모드: 탭 존 숨김', $('tap-zones').classList.contains('hidden'));

  const w1 = $('round-word').textContent;
  await feeder.feed(0, 300); // 이마 자세 안정

  // 아래로 기울임 = 정답
  await feeder.feed(-65, 300);
  await feeder.feed(-65, 200);
  check('기울임 아래 → 정답 판정, 점수 1', $('round-score').textContent === '✅ 1' &&
    $('round-word').textContent !== w1, `word: ${w1} → ${$('round-word').textContent}`);
  check('정답 진동', vibrations.includes(400));

  // 복귀 + 재무장 (쿨다운 600ms + 안정 200ms)
  vibrations.length = 0;
  await feeder.feed(0, 350);
  await feeder.feed(0, 1000);
  check('재무장 진동(미세 30ms)', vibrations.includes(30));

  // 위로 젖힘 = Skip
  const w2 = $('round-word').textContent;
  await feeder.feed(65, 300);
  await feeder.feed(65, 200);
  check('젖힘 위 → Skip 판정, 점수 유지', $('round-score').textContent === '✅ 1' &&
    $('round-word').textContent !== w2);
  check('Skip 진동(톡톡)', vibrations.some(v => JSON.stringify(v) === '[60,80,60]'));

  // 복귀 후 정지 — 오발 없어야 함
  await feeder.feed(0, 350);
  const w3 = $('round-word').textContent;
  await feeder.feed(0, 3000);
  check('정지 3초: 오발 없음', $('round-word').textContent === w3 && $('round-score').textContent === '✅ 1');

  await clock.advanceAsync(61_000, 100);
  check('시간 종료 → 결과 화면', active() === 'screen-result');
  check('결과: 정답 1 · 미정답 2(스킵+타임업)', $('result-score').textContent === '1' &&
    $('result-summary').textContent.includes('Skip 2'), $('result-summary').textContent);
}

// ══ 시나리오 3: Auto 레벨 — 그룹 캘리브레이션 ═══════════════════════
{
  console.log('\n── 시나리오 3: Auto 레벨 체크 (그룹 캘리브레이션)');
  const env = setupEnv({ storage: { 'wg.controls': 'touch' } });
  const { $, active, click } = env;
  await loadApp(env);

  click($('btn-start'));
  await flushMicrotasks();
  click(env.win.document.querySelector('.cat-card'));
  click(env.win.document.querySelector('#seg-level button[data-level="auto"]'));
  check('Auto 레벨 선택 상태 안내', !$('auto-status').classList.contains('hidden') &&
    /level check/i.test($('auto-status').textContent), $('auto-status').textContent);

  click($('btn-play'));
  check('Play → 캘리브레이션 화면', active() === 'screen-calibrate');
  const slots = env.win.document.querySelectorAll('.cal-word');
  check('단어 그리드 6칸', slots.length === 6);
  const firstWord = slots[0].textContent;

  click(slots[0]); // 아는 단어 탭 → 다음 레벨 단어로 교체
  check('탭 → 단어 교체(계단 오르기)', slots[0].textContent !== firstWord && slots[0].textContent !== '—');
  click(slots[1]);
  check('진행 바 갱신', $('cal-progress-bar').style.width !== '0%', $('cal-progress-bar').style.width);

  click($('btn-cal-done'));
  check('참가자 완료 → 전환 오버레이', !$('cal-handoff').classList.contains('hidden') &&
    $('cal-done-num').textContent === '1');

  click($('btn-cal-next'));
  check('다음 참가자 시작 (Player 2)', $('cal-handoff').classList.contains('hidden') &&
    $('cal-player-num').textContent === '2');
  const slots2 = env.win.document.querySelectorAll('.cal-word');
  click(slots2[0]); click(slots2[1]); click(slots2[2]); // 레벨 2 × 3회

  click($('btn-cal-finish'));
  check('완료 → 준비 화면', active() === 'screen-ready');
  check('그룹 레벨 확정: Medium(2)', /Group level: Medium/.test($('auto-status').textContent),
    $('auto-status').textContent);
}

done();
