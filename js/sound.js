// WebAudio 효과음 — 파일 없이 오실레이터로 생성 (PoC)
// AudioContext는 사용자 제스처(시작 버튼) 안에서 resume()해야 iOS에서 소리가 남.

let ctx = null;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, durMs, { type = 'sine', gain = 0.25, when = 0 } = {}) {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + when / 1000;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000);
}

// 진동 패턴은 화면을 못 보는 플레이어의 유일한 촉각 확인 수단 (Android 한정, iOS 미지원)
// — 정답: 길게 1회(묵직) / Skip: 짧게 2회(톡톡). 세기·리듬이 겹치지 않게 구분.
//
// 사운드 설계 원칙: 정답 = 밝은 상승 차임(사인), Skip = 거친 하강 버저(사각파).
// 폰 스피커는 저음 사인파를 거의 못 내므로 Skip은 사각파 + 큰 게인으로
// 음색 자체를 다르게 한다 (음높이만 다르면 시끄러운 곳에서 구분 불가).
export const sfx = {
  correct() { tone(523, 120, { gain: 0.35 }); tone(784, 260, { when: 100, gain: 0.35 }); vibrate(400); },
  skip() {
    tone(370, 130, { type: 'square', gain: 0.35 });
    tone(240, 280, { type: 'square', gain: 0.4, when: 110 });
    vibrate([60, 80, 60]);
  },
  click() { tone(950, 45, { type: 'triangle', gain: 0.18 }); vibrate(12); }, // 버튼 눌림 확인
  rearm() { vibrate(30); }, // 재무장 — 다음 동작 인식 준비 완료 신호
  hint() { tone(660, 90, { type: 'triangle' }); tone(880, 90, { type: 'triangle', when: 90 }); },
  tick() { tone(880, 60, { gain: 0.15 }); },
  countdown() { tone(440, 150); },
  go() { tone(660, 300, { gain: 0.3 }); },
  timeUp() { tone(330, 200); tone(262, 200, { when: 180 }); tone(196, 400, { when: 360 }); },
};

function vibrate(pattern) {
  // iOS 미지원 — Android 한정 강화 요소
  if (navigator.vibrate) navigator.vibrate(pattern);
}
