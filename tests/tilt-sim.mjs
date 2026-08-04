#!/usr/bin/env node
// tilt.js(v5) 합성 신호 회귀 시뮬레이션 — node tests/tilt-sim.mjs
//
// 주의: 합성 신호는 1차 방어선일 뿐이다. 실기기 검증은 Motion Lab(motion-lab.html)으로
// 기록한 트레이스를 tests/tilt-replay.mjs로 재생하는 것이 기준이다.
//
// v5가 반드시 통과해야 하는 실기기 실패 시나리오:
//  A. 동작 후 손 자세가 크게 이동해도(고쳐 잡기 ±25°) 다음 동작 인식 — v1~v4 공통 사인
//  B. 어떤 신호가 와도 2.5초 내 재무장 (고착 불가능 failsafe)
//  C. 떨림·버스트 배달·gamma 흔들림에서 오발 없음
let t = 0;
globalThis.performance = { now: () => t };
// Node 24: navigator는 getter 전용 → defineProperty로 대체. IS_IOS 판단은
// tilt.js 모듈 로드 시점이므로 반드시 import 전에 설정해야 한다 (동적 import).
let UA = 'test';
Object.defineProperty(globalThis, 'navigator', { get: () => ({ userAgent: UA }), configurable: true });
const { TiltDetector } = await import('../js/tilt.js');
let oriL = null, motL = null;
globalThis.window = {
  addEventListener: (k, f) => { if (k === 'deviceorientation') oriL = f; else motL = f; },
  removeEventListener: () => {},
};

let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const noise = a => (rnd() * 2 - 1) * a;

// tilt(deg) → deviceorientation: beta = 90 - tilt (gamma 0 근방) 이 관계로 합성
function harness({ tremor = 2, gammaWobble = 5, burst = false } = {}) {
  t = 0; seed = 42;
  const ev = [];
  const det = new TiltDetector({
    onCorrect: () => ev.push({ t, k: 'CORRECT' }),
    onSkip: () => ev.push({ t, k: 'SKIP' }),
    onRearm: () => {},
  });
  det.mode = 'motion';
  det.start();
  let tilt = 0; // 이마 자세
  const emit = () => oriL({ beta: 90 - tilt + noise(tremor), gamma: noise(gammaWobble) });
  const feed = (target, ms) => {
    const from = tilt;
    if (burst) {
      const groups = Math.max(1, Math.round(ms / 60));
      for (let gI = 1; gI <= groups; gI++) {
        tilt = from + (target - from) * gI / groups;
        for (let b = 0; b < 3; b++) { t += 2; emit(); }
        t += 54;
      }
    } else {
      const steps = Math.max(1, Math.round(ms / 18));
      for (let i = 1; i <= steps; i++) {
        t += 14 + rnd() * 8;
        tilt = from + (target - from) * i / steps;
        emit();
      }
    }
  };
  feed(0, 600); det.calibrate();
  return { ev, feed, det, tiltNow: () => tilt };
}

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};
function score(ev, marks, windowMs = 1800) {
  let miss = 0, wrong = 0;
  const used = new Set();
  for (const m of marks) {
    const hit = ev.find(e => !used.has(e) && e.t >= m.t && e.t < m.t + windowMs);
    if (!hit) miss++;
    else { used.add(hit); if (hit.k !== m.intent) wrong++; }
  }
  return { miss, wrong, ghost: ev.filter(e => !used.has(e)).length };
}

// ── A. 기본 6제스처 + 매번 손 자세 이동 (실기기 킬러 시나리오) ──
// 동작 → 복귀하되 원위치가 아니라 매번 다른 자세(±25°)로 정착
for (const [label, opts] of [
  ['자세이동, 기본노이즈', {}],
  ['자세이동, 떨림 ±4°', { tremor: 4 }],
  ['자세이동, 버스트 배달', { burst: true }],
  ['자세이동, 떨림+감마 ±15°', { tremor: 4, gammaWobble: 15 }],
]) {
  const { ev, feed } = harness(opts);
  const marks = [];
  const rests = [0, 22, -18, 25, 8, -18, 0]; // 동작 후 정착 자세가 매번 이동
  const seq = ['SKIP', 'SKIP', 'CORRECT', 'SKIP', 'CORRECT', 'SKIP'];
  seq.forEach((intent, i) => {
    marks.push({ t, intent });
    const from = rests[i];
    const peak = intent === 'SKIP' ? from + 70 : from - 70; // 기준 대비 ±70° 동작
    feed(peak, 300); feed(peak, 120);
    feed(rests[i + 1], 350);      // 새 자세로 복귀
    feed(rests[i + 1], 900);      // 다음 단어 보는 시간
  });
  const s = score(ev, marks);
  check(`A. 6제스처+자세이동 [${label}]`, s.miss === 0 && s.wrong === 0 && s.ghost === 0,
    `miss=${s.miss} wrong=${s.wrong} ghost=${s.ghost}`);
}

// ── B. 고착 불가능: 이상 신호(느린 대각 드리프트) 후에도 다음 동작 인식 ──
{
  const { ev, feed } = harness();
  feed(60, 300); feed(60, 120);       // skip
  feed(30, 4000);                      // 이상하게 30°에서 아주 느리게 머묾 (구 버전이면 고착)
  const t0 = t;
  feed(95, 300); feed(95, 150);        // 다음 skip (30 기준 +65)
  feed(30, 300); feed(30, 800);
  const after = ev.filter(e => e.t >= t0);
  check('B. 드리프트 고착 후 다음 동작 인식', after.some(e => e.k === 'SKIP'),
    ev.map(e => e.k).join(','));
}

// ── C. 오발 없음 ──
{
  const { ev, feed } = harness({ tremor: 4, gammaWobble: 15 });
  feed(0, 5000);
  check('C1. 정지 5초(떨림+감마) 오발 없음', ev.length === 0, `${ev.length}회`);
}
{
  // 걷기: ±12° 요동 — 판정 각도(45°)에 크게 못 미침
  const { ev, feed } = harness({ tremor: 3 });
  for (let i = 0; i < 12; i++) { feed(12, 260); feed(-10, 260); }
  feed(0, 500);
  check('C2. 걷기 요동 오발 없음', ev.length === 0, `${ev.length}회`);
}
{
  const { ev, feed } = harness();
  feed(-70, 300); feed(-70, 2500); feed(0, 300); feed(0, 800);
  check('C3. 숙인 자세 2.5초 유지 → CORRECT 1회만', ev.length === 1 && ev[0].k === 'CORRECT',
    ev.map(e => e.k).join(','));
}

// ── D. devicemotion 폴백 (orientation 이벤트 부재 시) + iOS 부호 보정 ──
{
  t = 0; seed = 42;
  const ev = [];
  UA = 'iPhone Safari test';
  const det = new TiltDetector({
    onCorrect: () => ev.push('CORRECT'), onSkip: () => ev.push('SKIP'), onRearm: () => {},
  });
  det.mode = 'motion';
  det.start();
  // iOS 퀴크: 화면 하늘 = z −9.8 (스펙과 반대). tilt = asin(-z/9.8)
  let tiltDeg = 0;
  const emit = () => motL({ accelerationIncludingGravity: {
    x: noise(0.3), y: noise(0.3), z: -Math.sin(tiltDeg * Math.PI / 180) * 9.8 + noise(0.4) } });
  const feed = (target, ms) => {
    const from = tiltDeg, steps = Math.round(ms / 18);
    for (let i = 1; i <= steps; i++) { t += 18; tiltDeg = from + (target - from) * i / steps; emit(); }
  };
  feed(0, 600); det.calibrate();
  feed(70, 300); feed(70, 120); feed(5, 350); feed(5, 900);   // skip (위로)
  feed(-65, 300); feed(-65, 120); feed(5, 350); feed(5, 900); // correct (아래로)
  check('D. motion 폴백(iOS 부호) skip→correct', ev.join(',') === 'SKIP,CORRECT', ev.join(','));
  UA = 'test';
}

console.log(failures ? `\n✗ ${failures}개 실패` : '\n✓ 전부 통과');
process.exit(failures ? 1 : 0);
