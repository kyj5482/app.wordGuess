// Calibration 단위 검증 — 실제 word DB 로드 (fetch 목킹)
import { readFileSync, readdirSync } from 'node:fs';

globalThis.fetch = async (path) => {
  const f = new URL('../' + path.replace('./', ''), import.meta.url).pathname;
  try {
    const data = readFileSync(f, 'utf8');
    return { ok: true, json: async () => JSON.parse(data) };
  } catch { return { ok: false, status: 404 }; }
};

const { loadWords } = await import('../js/words.js');
const { Calibration, SLOTS, TAPS_PER_PLAYER } = await import('../js/calibrate.js');

const n = await loadWords();
console.log('로드:', n, '단어');

let fail = 0;
const check = (name, cond, detail='') => { console.log(`${cond?'✓':'✗'} ${name}${detail?' — '+detail:''}`); if(!cond) fail++; };

// 1. 슬롯 6개, 전부 레벨 2에서 시작
const cal = new Calibration('*');
const slots = cal.startPlayer();
check('슬롯 6개 생성', slots.length === SLOTS && slots.every(Boolean));
check('시작 레벨 2', slots.every(s => s.level === 2), slots.map(s=>s.level).join(','));

// 2. 탭하면 다음 레벨 단어로 교체
const r1 = cal.tap(0);
check('탭 → 레벨 3 교체', r1.slot && r1.slot.level === 3, r1.slot?.level);

// 3. 시나리오: "레벨 3까지 아는 사람" — L2 두 번, L3 두 번 탭
const calA = new Calibration('*');
calA.startPlayer();
calA.tap(0); calA.tap(1);        // L2 두 번 (slot0,1 → L3)
calA.tap(0); calA.tap(1);        // L3 두 번 (slot0,1 → L4)
const pA = calA.finishPlayer();
check('플레이어 A 레벨 3 판정', pA.level === 3, `taps=${JSON.stringify(pA.taps)} level=${pA.level}`);

// 4. 시나리오: "초등 수준" — L2 한 번만 탭 (2회 미만 → 레벨 1)
const calB = new Calibration('*');
calB.startPlayer();
calB.tap(2);
const pB = calB.finishPlayer();
check('플레이어 B 레벨 1 판정 (보수적)', pB.level === 1, `level=${pB.level}`);

// 5. 그룹 레벨 = 최소값
const calG = new Calibration('*');
calG.startPlayer(); calG.tap(0); calG.tap(1); calG.tap(0); calG.tap(1); calG.finishPlayer(); // L3
calG.startPlayer(); calG.tap(0); calG.tap(1); calG.finishPlayer(); // L2
check('그룹 레벨 = min(3,2) = 2', calG.groupLevel() === 2, calG.groupLevel());

// 6. TAPS_PER_PLAYER 회 탭하면 done
const calD = new Calibration('*');
calD.startPlayer();
let done = false;
for (let i = 0; i < TAPS_PER_PLAYER; i++) done = calD.tap(i % 6).done;
check(`${TAPS_PER_PLAYER}회 탭 후 done`, done === true);

// 7. 단어 중복 없음 (교체된 단어가 이미 나온 단어와 안 겹침)
const calU = new Calibration('animals');
const seen = new Set();
const s0 = calU.startPlayer();
s0.forEach(s => { check(`중복 없음: ${s.word}`, !seen.has(s.word)); seen.add(s.word); });
for (let i = 0; i < 20; i++) {
  const r = calU.tap(i % 6);
  if (r.slot) { if (seen.has(r.slot.word)) { check('교체 단어 중복', false, r.slot.word); } seen.add(r.slot.word); }
}
console.log('중복 검사 완료 (에러 없으면 통과)');

// 8. auto 덱: 그룹 레벨 2면 L1+L2만
const { buildDeck } = await import('../js/words.js');
const deck = buildDeck('*', 'auto', 2);
check('auto 덱 = L1+L2만', deck.every(w => w.level <= 2) && deck.some(w => w.level === 2) && deck.some(w => w.level === 1), `${deck.length}단어`);
const deck4 = buildDeck('*', 'auto', 4);
check('auto 덱(그룹4) = L3+L4만', deck4.every(w => w.level >= 3), `${deck4.length}단어`);

process.exit(fail ? 1 : 0);
