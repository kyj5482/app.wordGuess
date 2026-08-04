// 그룹 레벨 캘리브레이션 (FR-13, docs/05-design.md §5.5)
//
// 방식: 참가자당 6칸 단어 그리드. 아는 단어를 탭하면 그 칸에 "다음 레벨" 단어가
// 나타난다(계단 오르기). 모르는 단어는 그냥 두면 된다. TAPS_PER_PLAYER회 탭하거나
// "Done"을 누르면 다음 사람으로.
//
// 레벨 추정: 각 칸은 독립적인 계단이다. 탭 = 그 레벨 단어를 안다는 신호.
//  - 플레이어 점수 = 탭한 단어들의 레벨 히스토그램에서 "안정적으로 아는 최고 레벨".
//    구체적으로: 레벨 N을 2회 이상 탭했으면 N을 안다고 보고, 최고 인정 레벨을 취한다.
//    (1회뿐이면 우연일 수 있어 N-1로 보수적으로.)
//  - 그룹 레벨 = min(참가자 레벨들) — "모두가 잘 아는" 수준 (70% 인지율 목표).
//    덱은 그룹 레벨 N + (N-1)을 섞어 낸다 (words.js 'auto' 질의).

import { sampleWord } from './words.js';

export const SLOTS = 6;
export const TAPS_PER_PLAYER = 8;   // 이 횟수 탭하면 자동 완료 (인당 ~20초)
const START_LEVEL = 2;              // 모든 칸은 레벨 2에서 시작 (초등 고학년)
const MAX_LEVEL = 4;

export class Calibration {
  constructor(tag = '*') {
    this.tag = tag;
    this.players = [];   // [{taps: {level: count}, levelResult}]
    this._exclude = new Set();
  }

  // 새 참가자 세션 시작 → 슬롯 배열 반환
  startPlayer() {
    this._current = { taps: {}, tapCount: 0 };
    this.slots = [];
    for (let i = 0; i < SLOTS; i++) this.slots.push(this._draw(START_LEVEL));
    return this.slots;
  }

  _draw(level) {
    const w = sampleWord(this.tag, level, this._exclude);
    if (w) { this._exclude.add(w.word); return { word: w.word, level }; }
    // 해당 레벨 소진 시 아래 레벨에서 보충 (레벨 표기는 실제 단어 레벨 유지)
    for (let l = level - 1; l >= 1; l--) {
      const alt = sampleWord(this.tag, l, this._exclude);
      if (alt) { this._exclude.add(alt.word); return { word: alt.word, level: l }; }
    }
    return null;
  }

  // 칸 탭 = 그 단어를 안다 → 다음 레벨 단어로 교체. 반환: 교체된 슬롯(또는 null=종료)
  tap(slotIdx) {
    const cur = this.slots[slotIdx];
    if (!cur) return { done: this.isPlayerDone() };
    const t = this._current.taps;
    t[cur.level] = (t[cur.level] || 0) + 1;
    this._current.tapCount++;
    const next = cur.level < MAX_LEVEL ? this._draw(cur.level + 1) : this._draw(cur.level);
    this.slots[slotIdx] = next;
    return { slot: next, done: this.isPlayerDone() };
  }

  isPlayerDone() { return this._current.tapCount >= TAPS_PER_PLAYER; }

  // 참가자 종료(자동 또는 Done 버튼) → 개인 레벨 확정
  // 2회 이상 탭한 레벨만 "안정적으로 안다"고 인정 (1회는 우연일 수 있음 → 보수적)
  finishPlayer() {
    const t = this._current.taps;
    let lvl = 1;
    for (let n = 1; n <= MAX_LEVEL; n++) if ((t[n] || 0) >= 2) lvl = n;
    const player = { taps: t, level: lvl };
    this.players.push(player);
    return player;
  }

  // 그룹 공통 레벨 = 참가자 최소 레벨 (모두가 아는 수준 → 인지율 ~70%)
  groupLevel() {
    if (!this.players.length) return START_LEVEL;
    return Math.max(1, Math.min(...this.players.map(p => p.level)));
  }
}
