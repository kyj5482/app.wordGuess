# Word Guess — iOS/Android 앱 (Capacitor)

루트의 웹 PoC를 **단일 소스**로 재사용하는 네이티브 앱. 루트 HTML/JS는 그대로 유지되고
(GitHub Pages 배포 계속), 이 디렉토리는 앱 셸 + 앱 전용 레이어만 담는다.

```
capacitor.config.json   # appId: io.github.kyj5482.wordguess
native/native.js        # 앱 전용 레이어 (유일한 웹과의 차이)
scripts/build.mjs       # 루트 → www 복사 + native.js 주입
www/                    # 빌드 산출물 (git 미추적 — npm run build로 생성)
android/, ios/          # 네이티브 프로젝트 (커스텀 포함, git 추적)
tests/                  # 앱 테스트 스위트 (아래)
```

## 웹 PoC와의 차이 (native/native.js + 네이티브 셸)

| 항목 | 웹 | 앱 |
|---|---|---|
| iOS 진동 | 불가 (navigator.vibrate 없음) | Haptics 플러그인 폴리필 — 정답=진동 400ms, Skip=임팩트 톡톡, 재무장·클릭=LIGHT 임팩트 |
| 화면 꺼짐 방지 | navigator.wakeLock (일부 미지원) | 네이티브 (Android FLAG_KEEP_SCREEN_ON / iOS isIdleTimerDisabled) |
| Android 뒤로가기 | 브라우저 처리 | 활성 화면의 ← 버튼과 동일, 홈=최소화, 라운드 중=무시 |
| iOS 모션 권한 | Safari 프롬프트 | 동일 API + Info.plist NSMotionUsageDescription |

모션 로직(js/tilt.js)을 포함한 게임 코드는 **바이트 단위로 웹과 동일**하며 테스트로 강제된다.

## 개발 사이클

```bash
cd app
npm install
npm test          # 빌드 + 전체 테스트 (아래 5개 스위트)
npm run sync      # 빌드 + 네이티브 프로젝트에 웹 자산 반영 (cap sync)
```

## 테스트 (npm test)

| 파일 | 검증 내용 |
|---|---|
| build-parity | 앱 번들이 웹 원본과 동일(모션·게임 코드 sha256), 유일한 차이는 native.js 주입 |
| motion-parity | 루트의 모션 테스트(합성 시뮬레이션 + 실기기 트레이스 재생)를 **앱 번들 tilt.js**로 실행 — 인식률 99%+, 유령 0 기준 그대로 |
| game-logic | 라운드(점수·입력 잠금·힌트 감점·타이머), 단어 덱(레벨·카테고리·중복 방지), 그룹 캘리브레이션 |
| app-flow | jsdom에서 실제 index.html+모듈 구동, 가짜 타이머로 전체 플로우 재생 — 터치 모드 / **모션 모드(합성 deviceorientation으로 정답·Skip·재무장 진동까지)** / Auto 레벨 체크 |
| native-layer | 진동 폴리필 매핑, Android 뒤로가기 화면별 동작, 웹 환경 no-op |

모션 로직 수정 시: 루트에서 `node tests/tilt-sim.mjs && node tests/tilt-replay.mjs` 통과 후
여기서 `npm test` — build-parity가 루트와 앱의 불일치(빌드 누락)를 잡아낸다.

## 실기기 빌드 (개발자 등록 후)

**Android** (Google Play — 등록비 $25 1회)
1. Android Studio 설치 후 `npm run sync && npm run open:android`
2. 실행/디버그: 기기 연결 → Run. 모션·진동은 실기기에서 확인 (motion-lab.html도 번들에 포함됨)
3. 출시: Build → Generate Signed Bundle (AAB) → Play Console 업로드
   - 서명 키는 `android/keystore.properties`(미추적)로 관리 권장

**iOS** (App Store — 연 $99)
1. macOS + Xcode: `npm run sync && npm run open:ios`
2. Signing & Capabilities에서 팀 선택 → 실기기 실행
   - 첫 라운드 시작 시 모션 권한 프롬프트(NSMotionUsageDescription) 확인
3. 출시: Product → Archive → App Store Connect 업로드

**남은 출시 준비물** (코드 외)
- [ ] 앱 아이콘·스플래시: `npx @capacitor/assets generate` (assets/ 에 icon.png 1024² 필요)
- [ ] 스토어 등록정보: 스크린샷, 설명, 개인정보 처리방침 URL(데이터 수집 없음 명시)
- [ ] iOS App Privacy: 모션 데이터 = 게임 조작 전용, 수집·전송 없음
