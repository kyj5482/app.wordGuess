#!/usr/bin/env node
// 네이티브 레이어 단위 테스트 — Capacitor 플러그인을 모킹해 앱 전용 코드 검증.
//  1. iOS 진동 폴리필: sound.js의 진동 패턴이 의도한 햅틱으로 매핑되는가
//  2. Android 뒤로가기: 화면별 동작 (← 버튼 / 홈=최소화 / 라운드=무시)
//  3. 비네이티브(웹)에서는 아무것도 하지 않는가

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { installFakeClock } from './helpers/fake-clock.mjs';
import { check, done } from './helpers/t.mjs';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const clock = installFakeClock(globalThis);

const { makeVibrate, handleBackButton, initNative } =
  await import(`file://${join(APP, 'www', 'js', 'native.js')}`);

// ── 1. 진동 폴리필 매핑 (sound.js의 실제 패턴 기준) ──
function recordHaptics() {
  const calls = [];
  return {
    calls,
    impact: async ({ style }) => calls.push({ t: clock.now, kind: 'impact', style }),
    vibrate: async ({ duration }) => calls.push({ t: clock.now, kind: 'vibrate', duration }),
  };
}

{
  const H = recordHaptics();
  const vibrate = makeVibrate(H);
  const t0 = clock.now;
  vibrate(400); // sfx.correct — 정답: 길게 1회
  clock.advance(1000);
  check('정답(400ms) → 실제 진동 1회', H.calls.length === 1 &&
    H.calls[0].kind === 'vibrate' && H.calls[0].duration === 400 && H.calls[0].t === t0);
}
{
  const H = recordHaptics();
  makeVibrate(H)([60, 80, 60]); // sfx.skip — 톡톡 2회 (60ms 진동, 80ms 쉼, 60ms 진동)
  const t0 = clock.now;
  clock.advance(1000);
  check('Skip([60,80,60]) → 임팩트 2회, 간격 140ms', H.calls.length === 2 &&
    H.calls.every(c => c.kind === 'impact' && c.style === 'MEDIUM') &&
    H.calls[1].t - H.calls[0].t === 140 && H.calls[0].t === t0);
}
{
  const H = recordHaptics();
  const v = makeVibrate(H);
  v(30);  // sfx.rearm — 재무장 미세 진동
  v(12);  // sfx.click — 버튼 확인
  clock.advance(100);
  check('미세 진동(30/12ms) → LIGHT 임팩트', H.calls.length === 2 &&
    H.calls.every(c => c.kind === 'impact' && c.style === 'LIGHT'));
}

// ── 2. Android 뒤로가기 ──
const dom = new JSDOM(`
  <section id="screen-home" class="screen"><h1>home</h1></section>
  <section id="screen-settings" class="screen active">
    <button class="btn-back" data-goto="category">←</button>
  </section>
  <section id="screen-round" class="screen"></section>
`);
const doc = dom.window.document;

{
  let clicked = 0, minimized = 0;
  doc.querySelector('.btn-back').addEventListener('click', () => clicked++);
  const App = { minimizeApp: async () => { minimized++; } };

  handleBackButton(doc, App); // 설정 화면 → ← 버튼 클릭과 동일
  check('뒤로가기: 활성 화면의 ← 버튼 클릭', clicked === 1 && minimized === 0);

  // 홈 화면 → 앱 최소화
  doc.getElementById('screen-settings').classList.remove('active');
  doc.getElementById('screen-home').classList.add('active');
  handleBackButton(doc, App);
  check('뒤로가기(홈): 앱 최소화', clicked === 1 && minimized === 1);

  // 라운드 화면(← 없음) → 무시 (실수로 라운드 손실 방지)
  doc.getElementById('screen-home').classList.remove('active');
  doc.getElementById('screen-round').classList.add('active');
  handleBackButton(doc, App);
  check('뒤로가기(라운드): 무시', clicked === 1 && minimized === 1);
}

// ── 3. initNative ──
{
  // 비네이티브(웹): 아무것도 안 함
  check('웹 환경: no-op', initNative({ Capacitor: undefined }) === false);
  check('웹뷰지만 비네이티브: no-op', initNative({ Capacitor: { isNativePlatform: () => false } }) === false);

  // 네이티브 iOS 시뮬레이션: navigator.vibrate 없음 → 폴리필 설치 + backButton 리스너 등록
  const listeners = {};
  const H = recordHaptics();
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { Haptics: H, App: { addListener: (ev, cb) => { listeners[ev] = cb; } } },
    },
    navigator: { userAgent: 'iPhone' },
    document: doc,
  };
  check('네이티브: 초기화 성공', initNative(win) === true);
  check('네이티브 iOS: vibrate 폴리필 설치', typeof win.navigator.vibrate === 'function');
  check('네이티브: backButton 리스너 등록', typeof listeners.backButton === 'function');
  win.navigator.vibrate(400);
  clock.advance(500);
  check('폴리필 경유 진동 동작', H.calls.length === 1 && H.calls[0].kind === 'vibrate');

  // 네이티브 Android 시뮬레이션: navigator.vibrate 이미 있음 → 폴리필로 덮지 않음
  const androidVibrate = () => true;
  const win2 = {
    Capacitor: win.Capacitor,
    navigator: { userAgent: 'Android', vibrate: androidVibrate },
    document: doc,
  };
  initNative(win2);
  check('네이티브 Android: 기존 vibrate 유지', win2.navigator.vibrate === androidVibrate);
}

done();
