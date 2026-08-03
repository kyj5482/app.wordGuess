// 모션 제스처 상태 머신 v2 (docs/05-design.md §4)
//
// 입력: devicemotion accelerationIncludingGravity.z (화면에 수직인 축 — 이마 자세에서 ≈ 0)
//
// v2 핵심 (2차 PoC 피드백): 정적 각도만 보지 않고 **가속도의 변화(속도)**를 함께 사용한다.
//  - 판정 신호 2개: 위치(delta = 중립 대비 기울기) + 속도(vel = delta의 시간당 변화율)
//  - 빠른 경로: 의도적으로 휙 기울이면 위치·속도가 같은 방향으로 동시에 커짐 → 즉시 판정 (빠른 게임 진행)
//  - 느린 경로: 천천히 크게 기울이면 위치 임계값 초과가 지속될 때 판정
//  - 재무장: 위치가 중립이고 **속도도 거의 0**이어야 함 → Skip 후 되돌아오는 스윙(반대 방향
//    속도)이 정답으로 오판되던 문제를 차단
//  - 중립 기준선 드리프트 제거: 플레이 중 기준선이 흘러 위/아래 판정이 비대칭해지던 버그 수정.
//    기준선은 라운드 시작 calibrate()에서만 잡는다.

const POS_ALPHA = 0.35;      // 위치 EMA
const VEL_ALPHA = 0.4;       // 속도 EMA

const FAST_POS = 5.5;        // m/s² — 빠른 경로: 이 위치 이상 +
const FAST_VEL = 22;         // m/s²/s — 같은 방향 속도 동반 시 즉시 판정
const SLOW_POS = 8.0;        // m/s² — 느린 경로: 명확한 큰 기울임
const SLOW_HOLD_MS = 150;    // 느린 경로 지속 확인

const NEUTRAL_POS = 3.0;     // m/s² — 재무장 위치 밴드
const NEUTRAL_VEL = 12;      // m/s²/s — 재무장 시 속도 상한 (스윙 통과 중 재무장 방지)
const NEUTRAL_HOLD_MS = 200;
const COOLDOWN_MS = 700;

export class TiltDetector {
  constructor({ onCorrect, onSkip, onProgress, onRearm }) {
    this.onCorrect = onCorrect;
    this.onSkip = onSkip;
    this.onProgress = onProgress || (() => {});
    this.onRearm = onRearm || (() => {}); // 중립 복귀 완료 — 다음 동작 인식 가능 신호
    this.mode = 'idle'; // idle | motion | tap
    this._reset();
    this._handler = e => this._onMotion(e);
    this._eventSeen = false;
  }

  _reset() {
    this._state = 'ARMED'; // ARMED | COOLDOWN | WAIT_NEUTRAL
    this._ema = null;
    this._vel = 0;
    this._lastT = null;
    this._neutral = 0;
    this._cooldownUntil = 0;
    this._neutralSince = null;
    this._overSince = null;
    this._overKind = null;
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

  // 리스너 부착은 동기 — 반환 프로미스는 이벤트 수신 프로브(최초 1회만 await하면 됨)
  start() {
    this.mode = 'motion';
    this._eventSeen = false;
    this._lastT = null;
    this._vel = 0;
    window.addEventListener('devicemotion', this._handler);
    return new Promise(resolve => {
      setTimeout(() => resolve(this._eventSeen ? 'ok' : 'no-events'), 1500);
    });
  }

  stop() {
    window.removeEventListener('devicemotion', this._handler);
    this.mode = 'idle';
  }

  // 라운드 시작(카운트다운 종료) 시점 자세를 중립으로 — 유일한 기준선 설정 지점
  calibrate() {
    const ema = this._ema;
    this._reset();
    this._ema = ema;
    if (ema !== null) this._neutral = ema;
  }

  _onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.z == null) return;
    this._eventSeen = true;

    const now = performance.now();
    const dt = this._lastT === null ? 0.016
      : Math.min(0.1, Math.max(0.005, (now - this._lastT) / 1000));
    this._lastT = now;

    const prev = this._ema;
    this._ema = prev === null ? g.z : prev + POS_ALPHA * (g.z - prev);
    const rawVel = prev === null ? 0 : (this._ema - prev) / dt;
    this._vel += VEL_ALPHA * (rawVel - this._vel);

    const delta = this._ema - this._neutral;
    this.onProgress(Math.max(-1, Math.min(1, delta / SLOW_POS)));

    switch (this._state) {
      case 'ARMED': {
        if (now < this._cooldownUntil) return;

        // 빠른 경로: 위치+속도가 같은 방향 — 의도적 스냅 동작 즉시 판정
        if (delta >= FAST_POS && this._vel >= FAST_VEL) { this._trigger('correct', now); return; }
        if (delta <= -FAST_POS && this._vel <= -FAST_VEL) { this._trigger('skip', now); return; }

        // 느린 경로: 큰 기울임이 같은 방향으로 지속
        const kind = delta >= SLOW_POS ? 'correct' : delta <= -SLOW_POS ? 'skip' : null;
        if (kind) {
          if (this._overKind !== kind) { this._overKind = kind; this._overSince = now; }
          else if (now - this._overSince >= SLOW_HOLD_MS) this._trigger(kind, now);
        } else {
          this._overKind = null;
          this._overSince = null;
        }
        break;
      }
      case 'COOLDOWN': {
        if (now >= this._cooldownUntil) this._state = 'WAIT_NEUTRAL';
        break;
      }
      case 'WAIT_NEUTRAL': {
        // 위치가 중립이고 속도도 잦아들어야 재무장 — 되돌아오는 스윙 통과는 무시됨
        if (Math.abs(delta) < NEUTRAL_POS && Math.abs(this._vel) < NEUTRAL_VEL) {
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
