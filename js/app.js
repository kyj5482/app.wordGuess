// 화면 라우팅 + 게임 세션 (docs/05-design.md §3)

import { loadWords, CATEGORIES, countFor, buildDeck } from './words.js';
import { TiltDetector } from './tilt.js';
import { Round } from './round.js';
import { initAudio, sfx } from './sound.js';

const $ = id => document.getElementById(id);
const screens = ['home', 'category', 'settings', 'ready', 'round', 'result'];

const state = {
  motionMode: 'unknown', // 'motion' | 'tap' | 'unknown'
  category: null, // {tag, name, emoji}
  level: localStorage.getItem('wg.level') || 'mix',
  time: Number(localStorage.getItem('wg.time') || 60),
  round: null,
  lastResult: null,
  wakeLock: null,
};

function show(name) {
  for (const s of screens) $(`screen-${s}`).classList.toggle('active', s === name);
}

// ── 모션 감지기 ───────────────────────────────────────────
const tilt = new TiltDetector({
  onCorrect: () => state.round?.correct(),
  onSkip: () => state.round?.skip(),
  onRearm: () => sfx.rearm(), // 짧은 진동 — 다음 동작 인식 준비 완료 (화면 못 보는 플레이어용)
});

// ── 홈: 시작 버튼 한 번의 제스처에 권한+오디오+WakeLock을 묶는다 ──
$('btn-start').addEventListener('click', async () => {
  initAudio();
  acquireWakeLock();
  const perm = await TiltDetector.requestPermission();
  if (perm === 'granted') {
    const probe = await tilt.start();
    tilt.stop();
    state.motionMode = probe === 'ok' ? 'motion' : 'tap';
  } else {
    state.motionMode = 'tap';
  }
  $('motion-status').textContent =
    state.motionMode === 'motion' ? '' : 'Motion off — tap the screen to play. ✋';
  renderCategories();
  show('category');
});

// ── 카테고리 ─────────────────────────────────────────────
function renderCategories() {
  const grid = $('category-grid');
  grid.innerHTML = '';
  const cats = [{ tag: '*', name: 'Everything', emoji: '🎲' }, ...CATEGORIES];
  for (const c of cats) {
    const n = countFor(c.tag, 'mix');
    if (c.tag !== '*' && n === 0) continue;
    const btn = document.createElement('button');
    btn.className = 'cat-card';
    btn.innerHTML = `<span class="cat-emoji">${c.emoji}</span>
      <span class="cat-name">${c.name}</span>
      <span class="cat-count">${n} words</span>`;
    btn.addEventListener('click', () => {
      state.category = c;
      $('settings-category-name').textContent = `${c.emoji} ${c.name}`;
      updateDeckCount();
      show('settings');
    });
    grid.appendChild(btn);
  }
}

// ── 설정 ────────────────────────────────────────────────
function segInit(segId, key, apply) {
  const seg = $(segId);
  for (const b of seg.querySelectorAll('button')) {
    if (b.dataset[key] === String(state[key === 'level' ? 'level' : 'time'])) {
      seg.querySelector('.on')?.classList.remove('on');
      b.classList.add('on');
    }
    b.addEventListener('click', () => {
      seg.querySelector('.on')?.classList.remove('on');
      b.classList.add('on');
      apply(b.dataset[key]);
      updateDeckCount();
    });
  }
}
segInit('seg-level', 'level', v => { state.level = v; localStorage.setItem('wg.level', v); });
segInit('seg-time', 'time', v => { state.time = Number(v); localStorage.setItem('wg.time', v); });

function updateDeckCount() {
  if (!state.category) return;
  const n = countFor(state.category.tag, state.level);
  $('deck-count').textContent = n < 20 ? `⚠️ Only ${n} words in this mix` : `${n} words ready`;
  $('btn-play').disabled = n === 0;
}

$('btn-play').addEventListener('click', () => show('ready'));

// ── 준비 → 카운트다운 → 라운드 ───────────────────────────
function updateOrientationTip() {
  document.body.classList.toggle('is-portrait', matchMedia('(orientation: portrait)').matches);
}
matchMedia('(orientation: portrait)').addEventListener('change', updateOrientationTip);
updateOrientationTip();

$('btn-round-start').addEventListener('click', async () => {
  initAudio(); // 제스처마다 보강 (iOS suspended 복귀 대비)
  acquireWakeLock();
  $('btn-round-start').classList.add('hidden');
  const cd = $('countdown');
  cd.textContent = '3'; // 이전 라운드의 "1" 잔상 제거 — 1→3→2→1 버그 수정
  cd.classList.remove('hidden');
  // 리스너 부착은 동기 — 1.5초 이벤트 프로브를 기다리지 않는다 (카운트다운 지연 원인)
  if (state.motionMode === 'motion') tilt.start();
  for (const n of [3, 2, 1]) {
    cd.textContent = n;
    sfx.countdown();
    await sleep(800);
  }
  cd.classList.add('hidden');
  $('btn-round-start').classList.remove('hidden');
  sfx.go();
  startRound();
});

function startRound() {
  const deck = buildDeck(state.category.tag, state.level);
  tilt.calibrate(); // 이마 자세를 중립으로

  state.round = new Round({
    deck,
    timeLimitS: state.time,
    ui: roundUI,
    onEnd: res => {
      tilt.stop();
      state.lastResult = res;
      renderResult(res);
      show('result');
    },
  });

  $('tap-zones').classList.toggle('hidden', state.motionMode === 'motion');
  $('round-score').textContent = '✅ 0';
  show('round');
  state.round.start();
}

// 탭 존 (폴백 전용 — 모션 모드에서는 숨김: 이마에 댄 폰의 접촉 오입력 방지)
let tapLock = 0;
function tapAction(kind) {
  const now = performance.now();
  if (now - tapLock < 300) return;
  tapLock = now;
  kind === 'correct' ? state.round?.correct() : state.round?.skip();
}
$('tap-correct').addEventListener('pointerdown', () => tapAction('correct'));
$('tap-skip').addEventListener('pointerdown', () => tapAction('skip'));

$('btn-hint').addEventListener('pointerdown', e => {
  e.stopPropagation();
  state.round?.hint();
  if (state.round?.hintExhausted()) $('btn-hint').disabled = true;
});

// ── 라운드 UI 어댑터 ─────────────────────────────────────
const roundUI = {
  word(w) {
    $('round-word').textContent = w.word;
    $('hint-emoji').textContent = '';
    $('hint-text').textContent = '';
    $('btn-hint').disabled = false;
  },
  timer(s) {
    const t = $('round-timer');
    t.textContent = s;
    t.classList.toggle('low', s <= 10);
  },
  feedback(kind, score) {
    $('round-score').textContent = `✅ ${score}`;
    flash(kind);
    const big = $('feedback-big');
    big.textContent = kind === 'correct' ? '✅' : '⏭️';
    big.classList.remove('hidden');
    setTimeout(() => big.classList.add('hidden'), 500);
  },
  hint({ emoji, text, penalty }) {
    flash('hint');
    if (emoji) $('hint-emoji').textContent = emoji;
    if (text) $('hint-text').textContent = text;
    const p = $('hint-penalty');
    p.textContent = `−${penalty}s!`;
    setTimeout(() => { p.textContent = '−5s'; }, 900);
  },
};

function flash(kind) {
  const f = $('round-flash');
  f.className = `round-flash flash-${kind}`;
  requestAnimationFrame(() => setTimeout(() => { f.className = 'round-flash'; }, 250));
}

// ── 결과 ────────────────────────────────────────────────
function renderResult({ score, results }) {
  $('result-score').textContent = score;
  const skips = results.filter(r => r.outcome !== 'correct').length;
  const hints = results.reduce((n, r) => n + r.hintsUsed, 0);
  $('result-summary').textContent = `⏭️ Skip ${skips} · 💡 Hint ${hints}`;

  // 개별 단어 목록은 기본 접힘 — 원할 때만 펼침
  const list = $('result-list');
  list.classList.add('hidden');
  $('btn-toggle-details').textContent = 'Show words ▾';
  list.innerHTML = '';
  const mark = { correct: '✅', skip: '⏭️', timeup: '⏰' };
  for (const r of results) {
    const li = document.createElement('li');
    li.innerHTML = `<span style="text-transform:capitalize">${r.word}
        ${r.hintsUsed ? `<span class="hints-used">💡×${r.hintsUsed}</span>` : ''}</span>
      <span class="mark">${mark[r.outcome]}</span>`;
    list.appendChild(li);
  }
}

$('btn-toggle-details').addEventListener('click', () => {
  const list = $('result-list');
  const open = list.classList.toggle('hidden');
  $('btn-toggle-details').textContent = open ? 'Show words ▾' : 'Hide words ▴';
});

$('btn-next-player').addEventListener('click', () => show('ready'));
$('btn-change-category').addEventListener('click', () => { renderCategories(); show('category'); });

// ── 뒤로가기 버튼들 ──────────────────────────────────────
for (const b of document.querySelectorAll('.btn-back')) {
  b.addEventListener('click', () => show(b.dataset.goto));
}

// ── Wake Lock (visibilitychange 시 해제되므로 재획득) ─────
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* 저전력 모드 등에서 실패 — 치명적이지 않음 */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.wakeLock !== null) acquireWakeLock();
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 부트스트랩 ───────────────────────────────────────────
loadWords().then(n => {
  console.log(`${n} words loaded`);
  if (n === 0) $('motion-status').textContent = '⚠️ Word data failed to load.';
});
