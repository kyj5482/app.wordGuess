#!/usr/bin/env node
// 앱 웹 자산 빌드 — 루트 웹 PoC를 app/www로 복사하고 네이티브 레이어를 주입한다.
//
// 원칙: 루트(웹 배포본)는 단일 소스 오브 트루스. 여기서는 복사 + 최소 주입만 한다.
//  - js/, css/, data/ : 그대로 복사 (모션 로직 등 바이트 동일 — 테스트로 강제)
//  - index.html       : native.js <script> 한 줄만 app.js 앞에 주입
//  - motion-lab.html  : 실기기(앱 셸) 모션 검증용으로 포함
//
// 실행: node scripts/build.mjs  (app/ 기준)

import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(APP);
const WWW = join(APP, 'www');

const INJECT = '<script type="module" src="./js/native.js"></script>';

rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });

// 1. 정적 자산 복사
for (const d of ['css', 'js', 'data']) cpSync(join(ROOT, d), join(WWW, d), { recursive: true });
cpSync(join(ROOT, 'motion-lab.html'), join(WWW, 'motion-lab.html'));

// 2. 네이티브 레이어
cpSync(join(APP, 'native', 'native.js'), join(WWW, 'js', 'native.js'));

// 3. index.html — native.js를 app.js보다 먼저 로드 (진동 폴리필 선행)
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const anchor = '<script type="module" src="./js/app.js"></script>';
if (!html.includes(anchor)) {
  console.error('build failed: index.html에서 app.js 스크립트 태그를 찾지 못함');
  process.exit(1);
}
writeFileSync(join(WWW, 'index.html'), html.replace(anchor, `${INJECT}\n${anchor}`));

if (!existsSync(join(WWW, 'data', 'words'))) {
  console.error('build failed: 단어 데이터 누락');
  process.exit(1);
}
console.log('✓ app/www 빌드 완료');
