// 라운드 진행: 타이머, 정답/스킵/힌트, 점수 (docs/05-design.md §5)

import { markUsed } from './words.js';
import { sfx } from './sound.js';

const HINT_PENALTY_S = 5;
const MAX_HINTS = 2;

export class Round {
  constructor({ deck, timeLimitS, ui, onEnd }) {
    this.deck = deck;
    this.remaining = timeLimitS;
    this.ui = ui;
    this.onEnd = onEnd;
    this.idx = -1;
    this.score = 0;
    this.results = []; // {word, outcome: 'correct'|'skip'|'timeup', hintsUsed}
    this.hintsUsed = 0;
    this._timer = null;
    this._locked = false; // 카드 전환 중 입력 잠금 (모션 쿨다운과 이중 방어)
    this._ended = false;
  }

  start() {
    this._nextWord();
    this._timer = setInterval(() => this._tick(), 1000);
    this.ui.timer(this.remaining);
  }

  _tick() {
    this.remaining--;
    this.ui.timer(this.remaining);
    if (this.remaining <= 5 && this.remaining > 0) sfx.tick();
    if (this.remaining <= 0) this.end('timeup');
  }

  get current() { return this.deck[this.idx]; }

  _nextWord() {
    this.idx++;
    this.hintsUsed = 0;
    if (this.idx >= this.deck.length) { this.end('deck-empty'); return; }
    markUsed(this.current.word);
    this.ui.word(this.current);
  }

  correct() {
    if (this._locked || this._ended) return;
    this._lock();
    this.score++;
    this.results.push({ word: this.current.word, outcome: 'correct', hintsUsed: this.hintsUsed });
    sfx.correct();
    this.ui.feedback('correct', this.score);
    this._nextWord();
  }

  skip() {
    if (this._locked || this._ended) return;
    this._lock();
    this.results.push({ word: this.current.word, outcome: 'skip', hintsUsed: this.hintsUsed });
    sfx.skip();
    this.ui.feedback('skip', this.score);
    this._nextWord();
  }

  // 힌트: 설명하는 친구가 화면 버튼 탭으로 발동. 시간 감점.
  // 1회차: 이모지 있으면 그림, 없으면 텍스트. 2회차: 텍스트.
  hint() {
    if (this._ended || this.hintsUsed >= MAX_HINTS) return;
    const w = this.current;
    // 이모지 없는 단어는 1회차에 바로 텍스트 → 힌트 1회로 끝
    const showText = this.hintsUsed >= 1 || !w.emoji;
    this.hintsUsed = showText ? MAX_HINTS : this.hintsUsed + 1;
    this.remaining = Math.max(0, this.remaining - HINT_PENALTY_S);
    sfx.hint();
    this.ui.hint({ emoji: w.emoji, text: showText ? w.textHint : null, penalty: HINT_PENALTY_S });
    this.ui.timer(this.remaining);
    if (this.remaining <= 0) this.end('timeup');
  }

  hintExhausted() { return this.hintsUsed >= MAX_HINTS; }

  _lock() {
    this._locked = true;
    setTimeout(() => { this._locked = false; }, 700);
  }

  end(reason) {
    if (this._ended) return;
    this._ended = true;
    clearInterval(this._timer);
    if (reason === 'timeup' && this.current) {
      this.results.push({ word: this.current.word, outcome: 'timeup', hintsUsed: this.hintsUsed });
      sfx.timeUp();
    }
    this.onEnd({ score: this.score, results: this.results });
  }
}
