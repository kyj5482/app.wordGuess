// 모션 제스처 상태 머신 v4 (docs/05-design.md §4)
//
// 입력: devicemotion accelerationIncludingGravity.z (화면에 수직인 축 — 이마 자세에서 ≈ 0)
//
// v4 = v1(최초, 체감 최고) 구조 복원 + 속도는 "가속 전용"으로만 사용.
// 버전 회귀 분석(2026-08-03, 3버전 동일 신호 시뮬레이션) 결론:
//  - v1: 위치 임계값 6.5, 단순 대칭 판정 → 6/6 인식. 기준선 미세 추종은 팔 처짐을
//    따라가는 유익한 기능이었음 (버그가 아니었다).
//  - v2: 임계값 8.0 + 120ms 지속 조건 → 보통 동작 3/6 놓침 ("한번씩 안 먹힘").
//  - v3: 속도를 재무장 "차단 조건"에 사용 → 속도는 노이즈를 dt로 나눠 증폭하는 신호라
//    손떨림 환경(라운드 후반)에서 재무장이 최대 2.5초 지연, 동작 삼킴 ("점차 나빠짐").
//
// 원칙: 위치(기울기)만이 판정과 재무장을 결정한다. 속도는 낮은 임계값에서
//       "더 빨리" 인식시키는 가속 경로로만 쓰고, 절대 어떤 것도 막지 않는다.
//
// 속도 계산은 이벤트 간 차분이 아니라 ~90ms 슬라이딩 윈도우 기울기 —
// iOS Safari의 버스트 배달(이벤트가 2ms 간격 묶음으로 옴)에도 안정적.

const TRIGGER = 6.5;          // m/s² — 위치 판정 임계값 (v1과 동일)
const NEUTRAL = 3.0;          // m/s² — 재무장 밴드 (위치만 사용)
const COOLDOWN_MS = 800;      // 트리거 후 절대 잠금 (복귀 스윙은 이 안에서 끝남)
const NEUTRAL_HOLD_MS = 150;
const EMA_ALPHA = 0.25;

const FAST_POS = 5.0;         // m/s² — 가속 경로: 이 위치 이상이면서
const FAST_VEL = 25;          // m/s²/s — 같은 방향 속도 동반 시 TRIGGER 전에 즉시 판정
const VEL_WINDOW_MS = 90;     // 속도 측정 슬라이딩 윈도우

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
    this._neutral = 0;
    this._cooldownUntil = 0;
    this._neutralSince = null;
    this._hist = []; // [{t, v}] 속도 윈도우
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
    this._hist = [];
    window.addEventListener('devicemotion', this._handler);
    return new Promise(resolve => {
      setTimeout(() => resolve(this._eventSeen ? 'ok' : 'no-events'), 1500);
    });
  }

  stop() {
    window.removeEventListener('devicemotion', this._handler);
    this.mode = 'idle';
  }

  // 라운드 시작(카운트다운 종료) 시점 자세를 중립으로
  calibrate() {
    const ema = this._ema;
    this._reset();
    this._ema = ema;
    if (ema !== null) this._neutral = ema;
  }

  // ~90ms 윈도우에 걸친 평균 기울기 (m/s²/s) — 버스트 배달·노이즈에 강함
  _velocity(now) {
    const h = this._hist;
    while (h.length && now - h[0].t > VEL_WINDOW_MS) h.shift();
    h.push({ t: now, v: this._ema });
    if (h.length < 2) return 0;
    const dt = (h[h.length - 1].t - h[0].t) / 1000;
    if (dt < 0.03) return 0; // 윈도우가 아직 짧으면 속도 신뢰 불가 → 가속 경로만 비활성
    return (h[h.length - 1].v - h[0].v) / dt;
  }

  _onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.z == null) return;
    this._eventSeen = true;

    const now = performance.now();
    this._ema = this._ema === null ? g.z : this._ema + EMA_ALPHA * (g.z - this._ema);
    const vel = this._velocity(now);
    const delta = this._ema - this._neutral;
    this.onProgress(Math.max(-1, Math.min(1, delta / TRIGGER)));

    switch (this._state) {
      case 'ARMED': {
        if (now < this._cooldownUntil) return;
        // 위치 판정 (v1 동일) — 항상 동작하는 기본 경로
        if (delta >= TRIGGER) { this._trigger('correct', now); return; }
        if (delta <= -TRIGGER) { this._trigger('skip', now); return; }
        // 가속 경로 — 빠른 스냅은 더 낮은 위치에서 조기 인식 (차단에는 절대 불사용)
        if (delta >= FAST_POS && vel >= FAST_VEL) { this._trigger('correct', now); return; }
        if (delta <= -FAST_POS && vel <= -FAST_VEL) { this._trigger('skip', now); return; }
        // 중립 체류 중 기준선 미세 추종 — 팔 처짐 등 자세 드리프트 흡수 (v1 기능 복원)
        if (Math.abs(delta) < NEUTRAL) {
          this._neutral = this._neutral * 0.95 + this._ema * 0.05;
        }
        break;
      }
      case 'COOLDOWN': {
        if (now >= this._cooldownUntil) this._state = 'WAIT_NEUTRAL';
        break;
      }
      case 'WAIT_NEUTRAL': {
        // 재무장은 위치만 본다 (v3의 속도 조건이 손떨림에서 재무장을 지연시킨 원인)
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
    if (kind === 'correct') this.onCorrect();
    else this.onSkip();
  }
}
