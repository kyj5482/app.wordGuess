// 단어 로드·병합·카테고리 질의 (docs/04-word-db-spec.md)

const FILES = [
  'animals-nature.json',
  'food-drink.json',
  'everyday-life.json',
  'school-jobs-places.json',
  'play-culture.json',
  'actions-concepts.json',
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

export function countFor(tag, maxLevel) {
  return queryAll(tag, maxLevel).length;
}

function queryAll(tag, maxLevel) {
  return all.filter(w =>
    (tag === '*' || w.tags.includes(tag)) &&
    (maxLevel === 'mix' || w.level === Number(maxLevel))
  );
}

// 세션 내 재출제 금지 셔플 덱. 덱 소진 시에만 사용 기록 리셋.
export function buildDeck(tag, level) {
  let pool = queryAll(tag, level).filter(w => !usedThisSession.has(w.word));
  if (pool.length < 10) {
    for (const w of queryAll(tag, level)) usedThisSession.delete(w.word);
    pool = queryAll(tag, level);
  }
  // Fisher–Yates
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

export function markUsed(word) { usedThisSession.add(word); }
