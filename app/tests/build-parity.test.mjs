#!/usr/bin/env node
// 빌드 무결성 — 앱 번들(app/www)이 웹 원본과 동일한 코드를 싣고 있는지 검증.
// 모션 로직(tilt.js)을 포함한 공유 모듈이 바이트 단위로 같아야 "웹에서 검증된
// 현재 수준 그대로"가 보장된다. 앱 전용 차이는 native.js 주입 한 줄뿐이어야 한다.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './helpers/t.mjs';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(APP);
const WWW = join(APP, 'www');

const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');

// 1. 공유 JS 모듈 바이트 동일 (모션 포함)
for (const f of ['tilt.js', 'round.js', 'words.js', 'calibrate.js', 'sound.js', 'app.js']) {
  check(`js/${f} 원본과 동일`, sha(join(ROOT, 'js', f)) === sha(join(WWW, 'js', f)));
}
check('css/style.css 원본과 동일', sha(join(ROOT, 'css', 'style.css')) === sha(join(WWW, 'css', 'style.css')));
check('motion-lab.html 포함(실기기 검증용)', existsSync(join(WWW, 'motion-lab.html')));

// 2. 단어 데이터 전체 복사
const rootWords = readdirSync(join(ROOT, 'data', 'words')).filter(f => f.endsWith('.json')).sort();
const appWords = readdirSync(join(WWW, 'data', 'words')).filter(f => f.endsWith('.json')).sort();
check('단어 파일 목록 동일', JSON.stringify(rootWords) === JSON.stringify(appWords),
  `${rootWords.length}개`);
check('단어 파일 내용 동일', rootWords.every(f =>
  sha(join(ROOT, 'data', 'words', f)) === sha(join(WWW, 'data', 'words', f))));

// 3. index.html — native.js 주입이 유일한 차이, app.js보다 먼저 로드
const rootHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const appHtml = readFileSync(join(WWW, 'index.html'), 'utf8');
const INJECT = '<script type="module" src="./js/native.js"></script>';
check('native.js 스크립트 주입됨', appHtml.includes(INJECT));
check('native.js가 app.js보다 먼저', appHtml.indexOf(INJECT) < appHtml.indexOf('js/app.js'));
check('index.html 그 외 차이 없음', appHtml.replace(`${INJECT}\n`, '') === rootHtml);

// 4. native.js는 원본(app/native)과 동일
check('native.js 원본과 동일', sha(join(APP, 'native', 'native.js')) === sha(join(WWW, 'js', 'native.js')));

done();
