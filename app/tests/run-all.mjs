#!/usr/bin/env node
// 앱 테스트 전체 실행 — 각 테스트 파일을 독립 프로세스로 실행해 전역 오염을 격리.
// 사용: npm test (빌드 후 실행됨)

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(DIR).filter(f => f.endsWith('.test.mjs')).sort();

let failed = 0;
for (const f of files) {
  console.log(`\n════ ${f} ════`);
  const r = spawnSync(process.execPath, [join(DIR, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n✗✗ ${failed}개 테스트 파일 실패` : '\n✓✓ 모든 테스트 파일 통과');
process.exit(failed ? 1 : 0);
