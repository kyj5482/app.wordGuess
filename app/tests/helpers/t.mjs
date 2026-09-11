// 미니 테스트 리포터 — 루트 tests/의 check 스타일과 동일
let failures = 0;

export const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

export const done = () => {
  console.log(failures ? `\n✗ ${failures}개 실패` : '\n✓ 전부 통과');
  process.exit(failures ? 1 : 0);
};
