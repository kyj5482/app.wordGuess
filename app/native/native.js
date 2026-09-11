// 앱 전용 네이티브 레이어 (Capacitor) — 공유 웹 코드(js/*.js)는 손대지 않는다.
//
// 웹 PoC와의 차이를 이 파일 하나로 흡수한다:
//  1. iOS 진동: WKWebView에는 navigator.vibrate가 없다 → Haptics 플러그인으로
//     동일 시그니처를 폴리필. sound.js의 진동 채널(정답=길게, Skip=톡톡톡,
//     재무장=미세)이 코드 수정 없이 iOS에서도 살아난다.
//  2. Android 하드웨어 뒤로가기: 화면 내 ← 버튼과 동일하게 동작. 홈 화면에서는
//     앱을 백그라운드로 (실수로 게임 상태를 잃지 않게 종료 대신 최소화).
//  3. 화면 꺼짐 방지는 네이티브 셸에서 처리(MainActivity FLAG_KEEP_SCREEN_ON /
//     AppDelegate isIdleTimerDisabled) — navigator.wakeLock 부재를 보완.
//
// 브라우저(비네이티브)에서 로드되면 아무것도 하지 않는다 → www를 그대로
// 웹에서 열어 디버깅 가능.
//
// 플러그인은 번들러 없이 쓰기 위해 Capacitor 런타임이 주입하는
// window.Capacitor.Plugins 레지스트리로 접근한다.

const cap = globalThis.Capacitor;
const isNative = !!cap?.isNativePlatform?.();

// ── 1. 진동 폴리필 (iOS: navigator.vibrate 부재 시에만) ──────────────
// 패턴 의미 보존: [진동, 쉼, 진동, ...] ms 배열 또는 단일 ms.
// 짧은 펄스는 임팩트 햅틱으로(길이감이 없는 대신 즉각적), 긴 펄스는 실제 진동으로.
export function makeVibrate(Haptics) {
  return function vibrate(pattern) {
    const seq = Array.isArray(pattern) ? pattern : [pattern];
    let delay = 0;
    for (let i = 0; i < seq.length; i++) {
      const ms = seq[i];
      if (i % 2 === 1) { delay += ms; continue; } // 홀수 인덱스 = 쉼
      const at = delay;
      if (ms <= 35) setTimeout(() => Haptics.impact({ style: 'LIGHT' }).catch(() => {}), at);
      else if (ms <= 90) setTimeout(() => Haptics.impact({ style: 'MEDIUM' }).catch(() => {}), at);
      else setTimeout(() => Haptics.vibrate({ duration: ms }).catch(() => {}), at);
      delay += ms;
    }
    return true;
  };
}

// ── 2. Android 뒤로가기 → 현재 화면의 ← 버튼 ────────────────────────
// 화면 구조(.screen.active 안의 .btn-back)에만 의존 — app.js 내부를 몰라도 된다.
export function handleBackButton(doc, App) {
  const active = doc.querySelector('.screen.active');
  const back = active?.querySelector('.btn-back');
  if (back) back.click();
  else if (active?.id === 'screen-home') App.minimizeApp?.().catch(() => {});
  // 그 외 화면(라운드 진행 중 등)은 무시 — 실수로 라운드를 날리지 않게.
}

export function initNative(win = globalThis) {
  const c = win.Capacitor;
  if (!c?.isNativePlatform?.()) return false;
  const { Haptics, App } = c.Plugins || {};
  if (Haptics && !win.navigator.vibrate) {
    try { win.navigator.vibrate = makeVibrate(Haptics); } catch { /* read-only면 포기 */ }
  }
  if (App?.addListener) {
    App.addListener('backButton', () => handleBackButton(win.document, App));
  }
  return true;
}

initNative();
