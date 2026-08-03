# Word Guess — 기술 조사 보고서 (모바일 웹 모션 감지)

> 작성일: 2026-08-03 · 출처: MDN, caniuse, WebKit 블로그/Bugzilla, firt.dev, Capacitor 문서, GitHub 오픈소스 구현체 코드 분석

## 1. DeviceOrientationEvent / DeviceMotionEvent

### 1.1 iOS Safari (iOS 13+ ~ 현재)

- iOS 13부터 `DeviceOrientationEvent.requestPermission()` / `DeviceMotionEvent.requestPermission()`으로 권한을 받아야 이벤트 발생. iOS 17/18에서도 유지.
- **필수 조건**: Secure context(HTTPS — GitHub Pages는 강제라 충족) + **사용자 제스처 핸들러 안에서 호출** (페이지 로드 시 호출하면 프롬프트 없이 `NotAllowedError`로 reject).
- 반환: `Promise<"granted" | "denied">`. orientation과 motion은 **별도 권한** — 둘 다 쓰면 둘 다 호출 (`Promise.all`).
- 거부 시 재프롬프트 정책은 문서로 확정 불가 → 실기기 테스트 필요. UX상 "거부 시 탭 조작 폴백 자동 전환" 설계 권장.

권장 패턴 (feature detection이 곧 플랫폼 분기):

```js
async function enableMotion() { // 반드시 클릭/탭 핸들러 안에서
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const p = await DeviceOrientationEvent.requestPermission();
      return p === "granted";
    } catch { return false; }
  }
  return true; // Android/데스크톱: 권한 절차 없음
}
```

### 1.2 Android Chrome

- `requestPermission()` 미구현 — 이벤트가 바로 발생. 위 패턴으로 자연 분기.
- Permissions-Policy(`accelerometer`, `gyroscope`) 기본 allowlist가 `self` → 최상위 same-origin 문서에서는 헤더 없이 동작 (GitHub Pages에서 문제없음).
- 사용자가 크롬 사이트 설정에서 모션 센서를 끌 수 있음 → 이벤트가 조용히 안 옴. **시작 후 1.5초 내 이벤트 미수신 시 폴백 전환**하는 타임아웃 감지 필요.

### 1.3 축 매핑: "이마에 대고 랜드스케이프" 자세

- 디바이스 좌표계는 항상 기본(세로) 방향 기준 고정 — 화면을 돌려도 축이 안 따라옴. `screen.orientation.type/angle`로 보정.
- alpha: z축(0–360), beta: x축 피치(−180~180), gamma: y축 롤(−90~90).
- 이마 자세(가로, 화면이 상대방 향함)에서 위/아래 까딱임의 회전축은 **gamma**.

**핵심 함정 3가지**:
1. **짐벌 락**: 기기가 수직(beta ≈ ±90°) 근처일 때 alpha·gamma가 불안정하게 점프 — 이마 자세가 정확히 이 위험 구간.
2. **gamma 랩어라운드**: ±90° 범위라 수직을 지나며 +90 → −90 부호 반전. 순수 gamma 임계값 비교는 오동작 가능.
3. **landscape-primary vs secondary**: 눕힌 방향에 따라 부호 반전. `screen.orientation.angle`(90 vs 270)로 보정 필수.

**권장 대안 — `devicemotion`의 `accelerationIncludingGravity.z` 사용**:
이마 자세(화면 수직)에서 중력 z 성분 ≈ 0, 화면이 바닥을 보게 숙이면 z → ±9.8. z축은 화면에 수직이라 **landscape 부호 보정이 gamma보다 단순**하고 짐벌 락 없음. 통상 임계값: |z| > 7 m/s² 트리거, |z| < 3~4 m/s² 중립 복귀. 부호 방향은 실기기 확정 필요.

이벤트 주기는 기기별 상이(실무상 대략 16–60Hz). `devicemotion`의 `event.interval`로 확인 가능.

## 2. 틸트 제스처 감지: 오픈소스 구현체 분석

### 2.1 구현체별 파라미터

**(a) Marqlo-C/toes_down--game** (Next.js, 가장 정교):
- beta만 사용, 시작 시 첫 판독값으로 **중립 캘리브레이션**, 이후 델타 판단.
- 임계값 비대칭: 정답(앞으로 숙임) +75°, 스킵(뒤로 젖힘) −45° — 뒤로 젖히기는 가동 범위가 좁아 낮은 임계값.
- 중립 밴드 ±16°, 중립 유지 180ms 후에만 재트리거 허용(re-arm), 추가 디바운스 800ms.
- 최근 4개 판독 이동 평균으로 노이즈 스무딩.
- 중립 기준선을 `neutral = neutral*0.95 + avg*0.05` 저역 통과로 드리프트 추종.
- 게임 로직 측에도 800ms 액션 잠금 + 카드 전환 800ms 지연.

**(b) JamesManningR/slowa-glowa** (Nuxt/VueUse, 단순 구현):
- gamma 사용(랜드스케이프): 20~60° → down, −45~0° → up. 히스테리시스/디바운스 없음 — **반면교사** (중복 트리거 취약).

**(c) portg4s23/headsup-hero** (React Native이나 로직 참고):
- 피치 기준 중립 존 75°~105°(수직 90° ± 15°), 위로 <50° = 패스, 아래로 >130° = 정답.
- **neutral-return 래치**: 중립 존 복귀해야 트리거 플래그 해제 — 시간 디바운스보다 우수. 트리거 시 햅틱. 샘플링 100ms.

### 2.2 권장 제스처 상태 머신

```
상태: ARMED(중립 대기) / TRIGGERED_CORRECT / TRIGGERED_SKIP / COOLDOWN

파라미터 (초기값, 실기기 튜닝 전제):
  TRIGGER_ANGLE = 중립 기준 ±45~60° (또는 gravity z 기준 |z| > 7 m/s²)
  NEUTRAL_BAND  = 중립 기준 ±15~20° (또는 |z| < 3.5 m/s²)  ← 히스테리시스 갭
  NEUTRAL_HOLD  = 150~200ms (중립 밴드 연속 체류해야 re-arm)
  COOLDOWN      = 700~1000ms (트리거 후 절대 잠금; 카드 전환 애니메이션과 일치)
  SMOOTHING     = 최근 3~5 샘플 이동평균 (또는 EMA α≈0.2)

전이:
  ARMED --(스무딩 각도 > TRIGGER_ANGLE && 쿨다운 경과)--> TRIGGERED_*
      → 콜백, 사운드/햅틱, COOLDOWN 진입
  COOLDOWN --(시간 경과)--> 중립 복귀 대기
  중립 복귀 대기 --(NEUTRAL_BAND 안에서 NEUTRAL_HOLD 지속)--> ARMED

핵심: 시간 쿨다운 + 중립 복귀 래치를 둘 다 요구해야
      "숙인 채 유지" 시 연속 트리거가 안 남.

추가:
  - 라운드 시작(카운트다운 끝) 시 현재 각도로 캘리브레이션
  - ARMED 중립 기준선은 EMA로 드리프트 추종
  - 트리거 방향 진행 상태를 UI(배경색 그라데이션)로 표시하면 오조작 감소
```

## 3. 폴백 (권한 거부 / 데스크톱)

- **탭 존**: 화면 상/하(또는 좌/우) 절반 = 정답/스킵. `pointerdown` 기준, 300ms 디바운스. 모션 실패 시 자동 활성화 + 항상 보조 입력으로 켜두기 권장.
- **키보드**: ArrowUp/ArrowDown + keyup 시 중립 복귀 + 300ms 디바운스. 데스크톱 개발/테스트용.
- **감지 3경로 모두 필요**: (1) API 부재 → 즉시 탭 모드, (2) iOS 권한 denied → 탭 모드 + 안내, (3) 권한 통과했으나 N초간 이벤트 미수신 → 탭 모드 전환.

## 4. 보조 API 지원 현황 (GitHub Pages 정적 호스팅)

| API | Chrome Android | iOS Safari | 비고 |
|---|---|---|---|
| Screen Wake Lock | ✅ | ✅ 16.4+ | 라운드 중 화면 꺼짐 방지 필수. visibilitychange 시 해제 → 재획득 로직 필요 |
| Screen Orientation 읽기 | ✅ | ✅ 16.4+ | 축 부호 보정용 |
| `screen.orientation.lock()` | ✅ (fullscreen 또는 설치 PWA 상태에서만) | ❌ 미지원 | iOS는 프로그래밍적 가로 고정 불가 → "폰을 돌려주세요" UI + `matchMedia('(orientation: portrait)')` 감지로 대응 |
| Fullscreen API | ✅ | ◐ iPhone은 임의 요소 불가(video만), iPad 가능 | Android: fullscreen → orientation lock 콤보 가능 |
| Vibration API | ✅ | ❌ 전 버전 미지원 | 진동은 Android 한정 강화 요소. iOS는 사운드로 대체 |
| Web Speech (TTS) | ✅ | ✅ 7+ | iOS 첫 발화는 제스처 후 권장 — 실기기 테스트 |
| 오디오 자동재생 | 제스처 후 허용 | 제스처 필요 | `AudioContext`는 시작 버튼 핸들러에서 `resume()`. `play()` promise의 `NotAllowedError` 처리 |

**설계 시사점**: "게임 시작" 버튼 탭 하나로 (1) 모션 권한 요청, (2) AudioContext resume, (3) Wake Lock 획득, (4) (Android) fullscreen + orientation lock을 **한 제스처에 묶어 처리**하는 것이 정석.

## 5. PWA on GitHub Pages (프로젝트 페이지 = 서브패스)

- **Service Worker 스코프**: 기본 스코프 = 스크립트 위치 디렉터리. 더 넓은 스코프는 `Service-Worker-Allowed` 헤더가 필요한데 GitHub Pages는 커스텀 헤더 불가 → **SW를 배포 루트에 두고 상대 경로 등록**. 자산 경로 전부 상대 경로 또는 Vite `base: '/app.wordGuess/'`.
- **Manifest**: `start_url: "./"`, `scope: "./"` (상대 URL은 manifest 파일 위치 기준 해석. `"/"`는 스코프 밖으로 새어나감).
- **iOS Add to Home Screen**: `display: standalone` 지원. manifest `orientation` 필드 무시됨(가로 고정 불가). `beforeinstallprompt` 없음. Safari 탭과 설치 앱 간 스토리지 미공유. `apple-touch-icon` 별도 제공 필수. standalone 모드의 모션 권한 프롬프트 동작은 실기기 테스트 필요.
- **추후 Capacitor 패키징 대비**: `@capacitor/motion` 플러그인이 웹 DeviceMotion/Orientation API를 그대로 래핑 → 지금 웹 표준 API로 구현하면 코드 대부분 재사용. 네이티브 셸에서는 orientation lock, iOS 햅틱이 해결되므로 웹 제약의 탈출구.

## 6. 실기기 테스트 필요 목록

1. iOS 권한 "거부" 후 재프롬프트 가능 시점 (세션/사이트 단위 지속 정책).
2. iOS standalone(홈 화면) 모드에서 `requestPermission()` 프롬프트 정상 표시 여부.
3. `accelerationIncludingGravity.z` 부호 방향 및 iOS/Android 간 beta/gamma 부호 차이 — 캘리브레이션+델타 설계로 흡수 권장.
4. iOS `speechSynthesis` 첫 발화의 제스처 요구 여부.
5. 기기별 이벤트 발화 주기 (스무딩 윈도 크기 튜닝에 영향).

## 7. 종합 결론

기술적으로 충분히 실현 가능. 핵심 리스크와 우회로:
- **(a) iOS 권한 UX** → 시작 버튼 제스처에 묶으면 해결.
- **(b) 수직 자세의 오일러 각 불안정** → 중력 z축 방식 또는 캘리브레이션+델타 방식으로 해결.
- **(c) iOS 가로 고정·진동 불가** → 안내 UI·사운드로 대체, Capacitor 전환 시 해소.
