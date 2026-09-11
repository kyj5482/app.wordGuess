#!/usr/bin/env node
// 모션 회귀 — 웹에서 검증된 모션 테스트(합성 시뮬레이션 + 실기기 트레이스 재생)를
// 앱 번들의 tilt.js(app/www/js/tilt.js)에 그대로 실행한다.
// 웹 PoC와 동일한 기준: 시뮬레이션 전 시나리오 통과 + 트레이스 인식률 99%+, 유령 0.

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './helpers/t.mjs';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(APP);
const TILT_JS = join(APP, 'www', 'js', 'tilt.js');

for (const [name, script] of [
  ['합성 시뮬레이션 (tilt-sim)', 'tilt-sim.mjs'],
  ['실기기 트레이스 재생 (tilt-replay)', 'tilt-replay.mjs'],
]) {
  const r = spawnSync(process.execPath, [join(ROOT, 'tests', script)], {
    cwd: ROOT,
    env: { ...process.env, TILT_JS },
    encoding: 'utf8',
  });
  const out = (r.stdout + r.stderr).trim();
  check(`앱 번들 tilt.js — ${name}`, r.status === 0,
    r.status === 0 ? '' : `\n${out}`);
  if (r.status !== 0) console.log(out);
}

done();
