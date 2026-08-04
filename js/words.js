// 단어 로드·병합·카테고리 질의 (docs/04-word-db-spec.md)

const FILES = [
  'animals-nature.json',
  'food-drink.json',
  'everyday-life.json',
  'school-jobs-places.json',
  'play-culture.json',
  'actions-concepts.json',
  'adv-nature-science.json',
  'adv-society-places.json',
  'adv-culture-tech.json',
  'adv-actions-concepts.json',
];

// 레벨: 1=초등 저학년(K-2) 2=초등 고학년(3-5) 3=중고생 4=대학생/성인
export const LEVELS = [
  { level: 1, name: 'Easy', desc: 'K–2' },
  { level: 2, name: 'Medium', desc: 'Gr 3–5' },
  { level: 3, name: 'Hard', desc: 'Teen' },
  { level: 4, name: 'Expert', desc: 'College' },
];

export const CATEGORIES = [
  { tag: 'animals', name: 'Animals', emoji: '🐘' },
  { tag: 'food', name: 'Food & Drinks', emoji: '🍕' },
  { tag: 'school', name: 'School Life', emoji: '✏️' },
  { tag: 'home', name: 'Around the House', emoji: '🛋️' },
  { tag: 'body', name: 'My Body', emoji: '💪' },
  { tag: 'clothes', name: 'Clothes', emoji: '👕' },
  { tag: 'jobs', name: 'Jobs & People', emoji: '🧑‍🚒' },
  { tag: 'places', name: 'Places', emoji: '🏖️' },
  { tag: 'transport', name: 'Things That Go', emoji: '🚀' },
  { tag: 'nature', name: 'Nature & Weather', emoji: '🌈' },
  { tag: 'space', name: 'Space', emoji: '🪐' },
  { tag: 'sports', name: 'Sports & Games', emoji: '⚽' },
  { tag: 'toys', name: 'Toys & Fun', emoji: '🧸' },
  { tag: 'music', name: 'Music', emoji: '🎵' },
  { tag: 'holidays', name: 'Holidays & Parties', emoji: '🎉' },
  { tag: 'story', name: 'Stories & Characters', emoji: '🐉' },
  { tag: 'actions', name: 'Actions', emoji: '🤸' },
  { tag: 'feelings', name: 'Feelings', emoji: '😊' },
  { tag: 'concepts', name: 'Colors & Shapes', emoji: '🔺' },
  { tag: 'science', name: 'Science', emoji: '🔬' },
];

let all = [];
const usedThisSession = new Set();

export async function loadWords() {
  const results = await Promise.allSettled(
    FILES.map(f => fetch(`./data/words/${f}`).then(r => {
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      return r.json();
    }))
  );
  const byWord = new Map();
  for (const r of results) {
    if (r.status !== 'fulfilled') { console.warn('word file skipped:', r.reason); continue; }
    for (const w of r.value.words || []) {
      const prev = byWord.get(w.word);
      if (prev) prev.tags = [...new Set([...prev.tags, ...w.tags])]; // 중복 단어: 태그 병합
      else byWord.set(w.word, { ...w });
    }
  }
  all = [...byWord.values()];
  return all.length;
}

export function countFor(tag, levelSel) {
  return queryAll(tag, levelSel).length;
}

// levelSel: 1~4(정확히 그 레벨) | 'mix'(전체) | 'auto'(캘리브레이션 결과 — matchLevel에서 처리)
function matchLevel(w, levelSel, autoLevel) {
  if (levelSel === 'mix') return true;
  if (levelSel === 'auto') {
    // 그룹 레벨 N: N 위주 + 한 단계 아래 섞기 → 인지율 ~70% 목표
    const n = autoLevel || 2;
    return w.level === n || w.level === Math.max(1, n - 1);
  }
  return w.level === Number(levelSel);
}

function queryAll(tag, levelSel, autoLevel) {
  return all.filter(w =>
    (tag === '*' || w.tags.includes(tag)) && matchLevel(w, levelSel, autoLevel)
  );
}

// 캘리브레이션: 특정 레벨에서 무작위 단어 1개 (제외 목록 회피)
export function sampleWord(tag, level, exclude) {
  const pool = all.filter(w =>
    (tag === '*' || w.tags.includes(tag)) && w.level === level && !exclude.has(w.word)
  );
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// 세션 내 재출제 금지 셔플 덱. 덱 소진 시에만 사용 기록 리셋.
export function buildDeck(tag, level, autoLevel) {
  let pool = queryAll(tag, level, autoLevel).filter(w => !usedThisSession.has(w.word));
  if (pool.length < 10) {
    for (const w of queryAll(tag, level, autoLevel)) usedThisSession.delete(w.word);
    pool = queryAll(tag, level, autoLevel);
  }
  // Fisher–Yates
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

export function markUsed(word) { usedThisSession.add(word); }
