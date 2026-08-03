#!/usr/bin/env node
// tilt.js 회귀 시뮬레이션 — 합성 devicemotion 신호로 상태 머신 검증.
// 실행: node tests/tilt-sim.mjs (실패 시 exit 1)
//
// 배경 (2026-08-03 버전 회귀 분석): 판정·재무장은 위치 신호만 써야 한다.
//  - v2의 "임계값 상향+지속 조건" → 보통 속도 동작 miss
//  - v3의 "재무장 속도 조건" → 손떨림에서 재무장 지연·동작 삼킴
// 이 테스트는 그 두 회귀가 다시 들어오지 못하게 막는다.
import { TiltDetector } from '../js/tilt.js';

let t = 0;
globalThis.performance = { now: () => t };
let listener = null;
globalThis.window = {
  addEventListener: (k, f) => { listener = f; },
  removeEventListener: () => { listener = null; },
};

let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const noise = a => (rnd() * 2 - 1) * a;

function harness({ tremor = 0.6, burst = false } = {}) {
  t = 0; seed = 42;
  const ev = [];
  const det = new TiltDetector({
    onCorrect: () => ev.push({ t, k: 'CORRECT' }),
    onSkip: () => ev.push({ t, k: 'SKIP' }),
    onRearm: () => {},
  });
  det.mode = 'motion';
  det.start();
  let z = 0.5;
  const emit = () => listener({ accelerationIncludingGravity: { z: z + noise(tremor) } });
  const feed = (target, ms) => {
    const from = z;
    if (burst) { // iOS Safari 버스트 배달: 3개가 2ms 간격, 묶음 사이 54ms
      const groups = Math.max(1, Math.round(ms / 60));
      for (let gI = 1; gI <= groups; gI++) {
        z = from + (target - from) * gI / groups;
        for (let b = 0; b < 3; b++) { t += 2; emit(); }
        t += 54;
      }
    } else {
      const steps = Math.max(1, Math.round(ms / 18));
      for (let i = 1; i <= steps; i++) {
        t += 14 + rnd() * 8;
        z = from + (target - from) * i / steps;
        emit();
      }
    }
  };
  feed(0.5, 500);
  det.calibrate();
  return { ev, feed };
}

// 제스처: 동작 → 끝점 유지 → 복귀(오버슈트 포함) → 정착 → 대기
function gestures(feed, seq) {
  const marks = [];
  for (const [dir, moveMs, overshoot] of seq) {
    marks.push({ t, intent: dir });
    const peak = dir === 'SKIP' ? -9 : 9;
    feed(peak, moveMs); feed(peak, 120); feed(overshoot, moveMs); feed(0.5, 150); feed(0.5, 700);
  }
  return marks;
}

function score(ev, marks) {
  let miss = 0, wrong = 0;
  const used = new Set();
  for (const m of marks) {
    const hit = ev.find(e => !used.has(e) && e.t >= m.t && e.t < m.t + 1600);
    if (!hit) miss++;
    else { used.add(hit); if (hit.k !== m.intent) wrong++; }
  }
  return { miss, wrong, ghost: ev.filter(e => !used.has(e)).length };
}

// 빠른 스냅, 보통, 느린 동작 + 오버슈트 복귀 (실플레이 패턴)
const SEQ = [
  ['SKIP', 280, 2.5], ['SKIP', 450, 1.5], ['CORRECT', 300, -2.0],
  ['SKIP', 350, 4.5], ['CORRECT', 500, 0.5], ['SKIP', 600, 1.0],
];

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

for (const [label, opts] of [
  ['기본', {}],
  ['손떨림 ±1.5', { tremor: 1.5 }],
  ['손떨림 ±2.0', { tremor: 2.0 }],
  ['iOS 버스트 배달', { burst: true }],
  ['버스트+떨림 ±1.5', { burst: true, tremor: 1.5 }],
]) {
  const { ev, feed } = harness(opts);
  const s = score(ev, gestures(feed, SEQ));
  check(`제스처 6회 전부 인식 [${label}]`, s.miss === 0 && s.wrong === 0 && s.ghost === 0,
    `miss=${s.miss} wrong=${s.wrong} ghost=${s.ghost}`);
}

// 정지 상태 오발 없음
for (const [label, opts] of [['떨림 ±2.0', { tremor: 2.0 }], ['버스트', { burst: true }]]) {
  const { ev, feed } = harness(opts);
  feed(0.5, 3000);
  check(`정지 3초 오발 없음 [${label}]`, ev.length === 0, `${ev.length}회 오발`);
}

// 자세 유지 시 1회만 판정
{
  const { ev, feed } = harness();
  feed(-9, 300); feed(-9, 2000); feed(0.5, 300); feed(0.5, 800);
  check('젖힌 자세 2초 유지 → SKIP 1회만', ev.length === 1 && ev[0].k === 'SKIP',
    ev.map(e => e.k).join(','));
}

process.exit(failures ? 1 : 0);
