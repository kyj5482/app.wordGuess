// 모션 제스처 상태 머신 (docs/05-design.md §4, docs/03-tech-research.md §2.2)
//
// 입력: devicemotion accelerationIncludingGravity.z
//   이마 자세(화면 수직)에서 z ≈ 0. 화면이 바닥을 향하게 숙이면 |z| 증가(한쪽 부호),
//   하늘을 향하게 젖히면 반대 부호. 부호 방향은 기기·자세 편차가 있어
//   라운드 시작 시 캘리브레이션한 중립값 기준 델타로 판정한다.
//
// 오작동 방지 4중 장치:
//   1. 트리거 임계값(TRIGGER)과 중립 밴드(NEUTRAL) 사이 히스테리시스 갭
//   2. 임계값 초과가 TRIGGER_HOLD_MS 동안 지속되어야 판정 — 순간 스파이크 무시,
//      "명확한 움직임"만 인정 (PoC 피드백 반영)
//   3. 트리거 후 COOLDOWN_MS 절대 잠금
//   4. 중립 밴드에 NEUTRAL_HOLD_MS 연속 체류해야 재무장(re-arm)

const TRIGGER = 8.0;          // m/s², 중립 대비 델타 (기울임 ~55° 이상)
const NEUTRAL = 3.0;          // m/s², 재무장 밴드
const TRIGGER_HOLD_MS = 120;  // 임계값 초과 지속 시간
const COOLDOWN_MS = 800;      // 카드 전환 애니메이션과 일치
const NEUTRAL_HOLD_MS = 150;
const EMA_ALPHA = 0.3;        // 지속 확인이 있으므로 스무딩은 약간 민첩하게

export class TiltDetector {
  constructor({ onCorrect, onSkip, onProgress, onRearm }) {
    this.onCorrect = onCorrect;
    this.onSkip = onSkip;
    this.onProgress = onProgress || (() => {});
    this.onRearm = onRearm || (() => {}); // 중립 복귀 완료 — 다음 동작 인식 가능 신호
    this.mode = 'idle'; // idle | motion | tap
    this._state = 'ARMED'; // ARMED | COOLDOWN | WAIT_NEUTRAL
    this._ema = null;
    this._neutral = 0;
    this._cooldownUntil = 0;
    this._neutralSince = null;
    this._overSince = null;  // 임계값 초과 시작 시각
    this._overKind = null;   // 'correct' | 'skip'
    this._signCorrect = null; // 첫 큰 기울임에서 학습하지 않고 orientation.angle로 결정
    this._handler = e => this._onMotion(e);
    this._eventSeen = false;
  }

  // iOS 권한 요청 — 반드시 사용자 제스처 핸들러 안에서 호출할 것
  static async requestPermission() {
    if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        return await DeviceMotionEvent.requestPermission(); // 'granted' | 'denied'
      } catch {
        return 'denied';
      }
    }
    return 'granted'; // Android/데스크톱
  }

  // 시작. 1.5초 내 이벤트 미수신 시 'no-events' resolve (Android 센서 꺼짐 등)
  start() {
    this.mode = 'motion';
    this._eventSeen = false;
    window.addEventListener('devicemotion', this._handler);
    return new Promise(resolve => {
      setTimeout(() => resolve(this._eventSeen ? 'ok' : 'no-events'), 1500);
    });
  }

  stop() {
    window.removeEventListener('devicemotion', this._handler);
    this.mode = 'idle';
  }

  // 라운드 시작(카운트다운 종료) 시점 각도를 중립으로 캘리브레이션
  calibrate() {
    if (this._ema !== null) this._neutral = this._ema;
    this._state = 'ARMED';
    this._cooldownUntil = 0;
    this._neutralSince = null;
    this._overSince = null;
    this._overKind = null;
  }

  _onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.z == null) return;
    this._eventSeen = true;

    // EMA 스무딩
    this._ema = this._ema === null ? g.z : this._ema + EMA_ALPHA * (g.z - this._ema);
    const delta = this._ema - this._neutral;

    // 화면이 위(하늘)를 보게 젖히면 z가 음수 방향(-9.8), 바닥을 보게 숙이면 양수 방향.
    // 기기 눕힘 방향(landscape-primary/secondary)과 무관 — z축은 화면에 수직.
    const now = performance.now();
    this.onProgress(Math.max(-1, Math.min(1, delta / TRIGGER)));

    switch (this._state) {
      case 'ARMED': {
        if (now < this._cooldownUntil) return;
        const kind = delta >= TRIGGER ? 'correct' : delta <= -TRIGGER ? 'skip' : null;
        if (kind) {
          // 같은 방향으로 TRIGGER_HOLD_MS 지속되어야 판정 — 순간 스파이크·복합 흔들림 무시
          if (this._overKind !== kind) { this._overKind = kind; this._overSince = now; }
          else if (now - this._overSince >= TRIGGER_HOLD_MS) this._trigger(kind, now);
        } else {
          this._overKind = null;
          this._overSince = null;
          if (Math.abs(delta) < NEUTRAL) {
            // 중립 체류 중 기준선 드리프트 추종 (저역 통과)
            this._neutral = this._neutral * 0.95 + this._ema * 0.05;
          }
        }
        break;
      }
      case 'COOLDOWN': {
        if (now >= this._cooldownUntil) this._state = 'WAIT_NEUTRAL';
        break;
      }
      case 'WAIT_NEUTRAL': {
        if (Math.abs(delta) < NEUTRAL) {
          if (this._neutralSince === null) this._neutralSince = now;
          if (now - this._neutralSince >= NEUTRAL_HOLD_MS) {
            this._state = 'ARMED';
            this._neutralSince = null;
            this.onRearm();
          }
        } else {
          this._neutralSince = null;
        }
        break;
      }
    }
  }

  _trigger(kind, now) {
    this._state = 'COOLDOWN';
    this._cooldownUntil = now + COOLDOWN_MS;
    this._overKind = null;
    this._overSince = null;
    if (kind === 'correct') this.onCorrect();
    else this.onSkip();
  }
}
