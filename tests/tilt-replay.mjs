#!/usr/bin/env node
// 실기기 트레이스 재생 회귀 테스트 — node tests/tilt-replay.mjs [trace.json ...]
//
// Motion Lab(motion-lab.html)에서 기록한 원시 센서 트레이스(JSON)를 현재 tilt.js에
// 그대로 재생해, 실제 기기에서 있었던 신호로 인식률을 검증한다.
// 인자를 생략하면 tests/traces/*.json 전부 실행.
//
// 트레이스 형식 (Motion Lab이 생성):
//   meta:   { ua, startedAt, kind, screen }
//   ori:    [[t, alpha, beta, gamma], ...]   ← 원시 deviceorientation
//   mot:    [[t, gx, gy, gz], ...]           ← 원시 devicemotion (gravity 포함)
//   marks:  [{t, intent}]                     ← guided-test 프롬프트 시각 (있으면 채점)
//   events: [{t, kind}]                       ← 기록 당시 감지기 판정 (참고용)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

let now = 0;
globalThis.performance = { now: () => now };
let UA = '';
Object.defineProperty(globalThis, 'navigator', { get: () => ({ userAgent: UA }), configurable: true });
const listeners = { deviceorientation: null, devicemotion: null };
globalThis.window = {
  addEventListener: (k, f) => { listeners[k] = f; },
  removeEventListener: k => { listeners[k] = null; },
};
const { TiltDetector } = await import('../js/tilt.js');

function replay(trace) {
  UA = trace.meta?.ua || '';
  const ev = [];
  const det = new TiltDetector({
    onCorrect: () => ev.push({ t: now, k: 'CORRECT' }),
    onSkip: () => ev.push({ t: now, k: 'SKIP' }),
    onRearm: () => {},
  });
  det.mode = 'motion';
  det.start();

  // ori/mot 스트림을 타임스탬프 순으로 병합 재생 (기록과 동일한 인터리브)
  const stream = [
    ...(trace.ori || []).map(s => ({ t: s[0], kind: 'ori', s })),
    ...(trace.mot || []).map(s => ({ t: s[0], kind: 'mot', s })),
  ].sort((a, b) => a.t - b.t);
  if (!stream.length) return { error: 'empty trace' };

  // 초기 0.6초 재생 후 캘리브레이션 (Motion Lab 테스트 시작 시점과 일치)
  const t0 = stream[0].t;
  let calibrated = false;
  for (const item of stream) {
    now = item.t;
    if (!calibrated && item.t - t0 > 600) { det.calibrate(); calibrated = true; }
    if (item.kind === 'ori') {
      listeners.deviceorientation?.({ alpha: item.s[1], beta: item.s[2], gamma: item.s[3] });
    } else {
      listeners.devicemotion?.({ accelerationIncludingGravity: { x: item.s[1], y: item.s[2], z: item.s[3] } });
    }
  }

  // 채점: marks가 있으면 각 프롬프트 후 3.5초 내 첫 판정과 대조
  if (trace.marks?.length) {
    let hit = 0, wrong = 0, miss = 0;
    const used = new Set();
    const lat = [];
    for (const m of trace.marks) {
      const e = ev.find(x => !used.has(x) && x.t >= m.t && x.t < m.t + 3500);
      if (!e) miss++;
      else { used.add(e); if (e.k === m.intent) { hit++; lat.push(e.t - m.t); } else wrong++; }
    }
    const ghost = ev.filter(e => !used.has(e)).length;
    return { total: trace.marks.length, hit, wrong, miss, ghost,
             avgLat: lat.length ? Math.round(lat.reduce((a, b) => a + b) / lat.length) : null };
  }
  return { freeRun: true, detections: ev.length,
           kinds: ev.map(e => e.k).join(',') || '(없음)' };
}

// ── 실행 ──
const args = process.argv.slice(2);
const tracesDir = join(DIR, 'traces');
const files = args.length ? args
  : existsSync(tracesDir) ? readdirSync(tracesDir).filter(f => f.endsWith('.json')).map(f => join(tracesDir, f))
  : [];

if (!files.length) {
  console.log('트레이스 없음. motion-lab.html에서 기록한 JSON을 tests/traces/에 넣거나 인자로 전달하세요.');
  process.exit(0);
}

let failures = 0;
for (const f of files) {
  let r;
  try { r = replay(JSON.parse(readFileSync(f, 'utf8'))); }
  catch (e) { console.log(`✗ ${f}: ${e.message}`); failures++; continue; }
  if (r.error) { console.log(`✗ ${f}: ${r.error}`); failures++; continue; }
  if (r.freeRun) {
    console.log(`· ${f}: 자유 기록 — 판정 ${r.detections}회 [${r.kinds}]`);
  } else {
    const rate = Math.round(r.hit / r.total * 100);
    const pass = rate >= 99 && r.ghost === 0;
    console.log(`${pass ? '✓' : '✗'} ${f}: ${r.hit}/${r.total} (${rate}%) 오인식 ${r.wrong} 미인식 ${r.miss} 유령 ${r.ghost}` +
      (r.avgLat !== null ? ` 평균지연 ${r.avgLat}ms` : ''));
    if (!pass) failures++;
  }
}
process.exit(failures ? 1 : 0);
