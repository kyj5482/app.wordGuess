// 모션 제스처 감지 v5 — 절대 각도 + 안정 기반 재무장 (docs/05-design.md §4)
//
// v1~v4 실기기 실패(인식률 <20%)의 근본 원인 2가지를 제거한 재설계:
//
// [원인 1] 단일 z축 원시값 사용 → iOS devicemotion은 스펙과 부호가 반대(유명 퀴크).
//   기기에 따라 정답/Skip이 뒤집히거나 임계값이 안 맞았다.
//   → 해결: deviceorientation의 회전행렬 성분 R33 = cos(beta)·cos(gamma)로
//     "화면 법선이 수평면에서 벗어난 절대 각도"를 계산한다.
//     - R33은 회전행렬 원소라 오일러 각 개별 점프(짐벌)와 무관하게 연속적
//     - deviceorientation 부호는 iOS/Android 모두 스펙 준수 → 플랫폼 일관
//     - +90° = 화면이 하늘, -90° = 화면이 바닥, 0° = 수직(이마 자세)
//     devicemotion은 orientation 이벤트가 없을 때만 폴백(iOS 부호 보정 포함).
//
// [원인 2] 재무장이 "고정 중립 위치로 복귀"를 요구 → 동작 후 손 자세가 20~30°만
//   이동해도(팔 처짐, 고쳐 잡기) WAIT_NEUTRAL에 영원히 갇혀 이후 전부 무시.
//   "첫 동작은 되고 뒤로 갈수록 안 된다"의 원인.
//   → 해결: 재무장은 위치가 아니라 **안정성**으로 판단한다. 어디서든 각도가
//     250ms 동안 잠잠하면 재무장하고 그 자세를 새 기준(rest)으로 삼는다.
//     + 어떤 경우에도 2.5초를 넘기면 강제 재무장(failsafe) → 고착 불가능.
//
// 판정: 기준 대비 상대 각도 ±45° (또는 절대 ±70° 안전망, 빠른 스냅은 40°+속도).
// 아래로 기울임(화면이 바닥 쪽, 각도 감소) = 정답 / 위로 젖힘(각도 증가) = Skip.

const TH_REL = 45;          // deg — 기준 대비 판정 임계값
const TH_ABS = 70;          // deg — 절대 안전망 (화면이 거의 바닥/하늘)
const TH_ABS_MIN_REL = 20;  // deg — 절대 안전망도 기준 대비 최소 이만큼 움직여야 발동
                            //       (극단 자세에서 재무장된 직후 무한 재트리거 방지)
const FAST_TH = 38;         // deg — 가속 경로: 이 각도 이상이면서
const FAST_VEL = 160;       // deg/s — 같은 방향 속도 동반 시 조기 판정
const REST_BAND = 18;       // deg — 이 범위 안이면 기준을 천천히 추종
const REST_TRACK = 0.02;    // 기준 추종 속도 (샘플당)
const MID_STABLE_MS = 280;  // deg — 중간 지대(REST_BAND~판정 미달)에 이 시간 동안
                            //       안정적으로 머물면 그 자세를 새 기준으로 채택.
                            //       (게이지 1/2쯤에서 멈추면 기준이 영영 안 따라와
                            //       이후 판정이 비대칭해지던 사각지대 해소)

const HOME_GUARD = 25;      // deg — 판정은 홈(라운드 시작 이마 자세)에서 이만큼
                            //       동작 방향으로 넘어간 경우만 인정. 극단 자세에서
                            //       재무장된 뒤 이마로 복귀하는 스윙의 오판을 차단.
const COOLDOWN_MS = 600;    // 트리거 직후 절대 잠금 (복귀 스윙 흡수)
const STABLE_WIN_MS = 200;  // 재무장: 이 시간 동안 (250→200, 게임 템포 피드백)
const STABLE_RANGE = 12;    // deg — 각도 변동 폭이 이내면 "안정"
const STUCK_MS = 2500;      // 쿨다운 종료 후 이 시간 내 재무장 실패 시 강제 재무장
const EMA_ALPHA = 0.3;
const HIST_MS = 320;        // 속도·안정성 판단용 샘플 윈도우

const isIOS = () => typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class TiltDetector {
  constructor({ onCorrect, onSkip, onProgress, onRearm, onSample }) {
    this.onCorrect = onCorrect;
    this.onSkip = onSkip;
    this.onProgress = onProgress || (() => {});
    this.onRearm = onRearm || (() => {});
    this.onSample = onSample || null; // 디버그/기록용 훅 (Motion Lab)
    this.mode = 'idle'; // idle | motion | tap
    this._oriHandler = e => this.handleOrientation(e);
    this._motHandler = e => this.handleMotion(e);
    this._eventSeen = false;
    this._reset();
  }

  _reset() {
    this._state = 'ARMED'; // ARMED | COOLDOWN | WAIT_STABLE
    this._ema = null;
    this._rest = 0;
    this._home = 0; // 라운드 시작 이마 자세 (calibrate에서만 설정 — 판정 가드 기준)
    this._hist = [];          // [{t, a}] 최근 HIST_MS
    this._cooldownEnd = 0;
    this._lastOriT = -Infinity;
  }

  // iOS 13+: orientation과 motion은 별개 권한 — 둘 다 요청 (사용자 제스처 안에서)
  static async requestPermission() {
    const reqs = [];
    for (const Ev of [globalThis.DeviceOrientationEvent, globalThis.DeviceMotionEvent]) {
      if (Ev && typeof Ev.requestPermission === 'function') {
        reqs.push(Ev.requestPermission().catch(() => 'denied'));
      }
    }
    if (reqs.length === 0) {
      return typeof globalThis.DeviceOrientationEvent === 'undefined' &&
             typeof globalThis.DeviceMotionEvent === 'undefined' ? 'unsupported' : 'granted';
    }
    const results = await Promise.all(reqs);
    return results.some(r => r === 'granted') ? 'granted' : 'denied';
  }

  start() {
    this.mode = 'motion';
    this._eventSeen = false;
    window.addEventListener('deviceorientation', this._oriHandler);
    window.addEventListener('devicemotion', this._motHandler);
    return new Promise(resolve => {
      setTimeout(() => resolve(this._eventSeen ? 'ok' : 'no-events'), 1500);
    });
  }

  stop() {
    window.removeEventListener('deviceorientation', this._oriHandler);
    window.removeEventListener('devicemotion', this._motHandler);
    this.mode = 'idle';
  }

  // 라운드 시작 시점 자세를 기준으로 (이후에도 안정 재무장 때마다 기준이 갱신됨)
  calibrate() {
    this._state = 'ARMED';
    this._cooldownEnd = 0;
    this._hist = [];
    if (this._ema !== null) { this._rest = this._ema; this._home = this._ema; }
  }

  // ── 신호원 1 (주): deviceorientation — 플랫폼 부호 일관 ──
  handleOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    const now = performance.now();
    this._lastOriT = now;
    const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
    // R33: 화면 법선의 수직 성분 (회전행렬 원소 — 짐벌 점프에도 연속)
    const tilt = Math.asin(clamp(Math.cos(b) * Math.cos(g), -1, 1)) * 180 / Math.PI;
    this._update(tilt, now, 'ori');
  }

  // ── 신호원 2 (폴백): devicemotion — orientation 이벤트가 안 올 때만 ──
  handleMotion(e) {
    const now = performance.now();
    if (now - this._lastOriT < 500) return; // orientation이 살아있으면 무시
    const g = e.accelerationIncludingGravity;
    if (!g || g.z == null) return;
    const mag = Math.hypot(g.x || 0, g.y || 0, g.z);
    if (mag < 2) return;
    // 스펙: 화면 위로 눕히면 z=+9.8 → tilt +90. iOS는 부호 반전 퀴크 보정.
    const zn = clamp((g.z / mag) * (isIOS() ? -1 : 1), -1, 1);
    this._update(Math.asin(zn) * 180 / Math.PI, now, 'mot');
  }

  _update(tilt, now, src) {
    this._eventSeen = true;
    this._ema = this._ema === null ? tilt : this._ema + EMA_ALPHA * (tilt - this._ema);
    const a = this._ema;

    const h = this._hist;
    h.push({ t: now, a });
    while (h.length && now - h[0].t > HIST_MS) h.shift();

    // 속도: 윈도우 양끝 기울기 (deg/s) — 버스트 배달에도 안정
    let vel = 0;
    if (h.length >= 2) {
      const dt = (h[h.length - 1].t - h[0].t) / 1000;
      if (dt >= 0.04) vel = (h[h.length - 1].a - h[0].a) / dt;
    }

    const rel = a - this._rest;
    this.onProgress(clamp(-rel / TH_REL, -1, 1)); // +1 = 정답 방향 진행
    if (this.onSample) this.onSample({ t: now, src, tilt, ema: a, rest: this._rest, vel, state: this._state });

    switch (this._state) {
      case 'ARMED': {
        // 아래로(각도 감소) = 정답, 위로(각도 증가) = Skip
        // homeRel 가드: 현재 각도가 홈(이마) 자세에서 동작 방향으로 실제로 넘어가
        // 있어야 판정 — 극단 자세에서 재무장된 뒤 이마로 "복귀"하는 스윙은 rel이
        // 커도 homeRel이 반대라 걸러진다.
        const homeRel = a - this._home;
        if (homeRel <= -HOME_GUARD &&
            (rel <= -TH_REL || (a <= -TH_ABS && rel <= -TH_ABS_MIN_REL) ||
             (rel <= -FAST_TH && vel <= -FAST_VEL))) {
          this._trigger('correct', now); return;
        }
        if (homeRel >= HOME_GUARD &&
            (rel >= TH_REL || (a >= TH_ABS && rel >= TH_ABS_MIN_REL) ||
             (rel >= FAST_TH && vel >= FAST_VEL))) {
          this._trigger('skip', now); return;
        }
        // 기준 근처에 머무는 동안 천천히 추종 (팔 처짐 등 자세 드리프트 흡수)
        if (Math.abs(rel) < REST_BAND) {
          this._rest += REST_TRACK * (a - this._rest);
        } else {
          // 중간 지대(추종 밴드 밖 && 판정 미달)에 안정적으로 머물면 새 기준 채택
          // — 동작하다 만 자세에서 게이지가 리셋되지 않던 사각지대
          const winStart = now - MID_STABLE_MS;
          const win = h.filter(s => s.t >= winStart);
          if (win.length >= 3 && h[0].t <= winStart) {
            let lo = Infinity, hi = -Infinity;
            for (const s of win) { if (s.a < lo) lo = s.a; if (s.a > hi) hi = s.a; }
            if (hi - lo < STABLE_RANGE && Math.abs(vel) < 50) {
              this._rest = a;
              this.onRearm(); // 미세 진동 — 기준 재설정 알림
            }
          }
        }
        break;
      }
      case 'COOLDOWN': {
        if (now >= this._cooldownEnd) this._state = 'WAIT_STABLE';
        break;
      }
      case 'WAIT_STABLE': {
        // 재무장 = 위치 무관, "안정"만 요구: 최근 STABLE_WIN_MS 동안 변동 폭이 작으면
        // 지금 자세를 새 기준으로 삼고 재무장 → 자세가 어디로 이동했든 고착 불가
        const winStart = now - STABLE_WIN_MS;
        const win = h.filter(s => s.t >= winStart);
        if (win.length >= 3 && h[0].t <= winStart) {
          let lo = Infinity, hi = -Infinity;
          for (const s of win) { if (s.a < lo) lo = s.a; if (s.a > hi) hi = s.a; }
          if (hi - lo < STABLE_RANGE && Math.abs(vel) < 50) {
            this._rearm(a); return;
          }
        }
        // failsafe: 무슨 일이 있어도 STUCK_MS 안에는 재무장
        if (now - this._cooldownEnd > STUCK_MS) this._rearm(a);
        break;
      }
    }
  }

  _rearm(currentAngle) {
    this._rest = currentAngle;
    this._state = 'ARMED';
    this.onRearm();
  }

  _trigger(kind, now) {
    this._state = 'COOLDOWN';
    this._cooldownEnd = now + COOLDOWN_MS;
    if (kind === 'correct') this.onCorrect();
    else this.onSkip();
  }
}
