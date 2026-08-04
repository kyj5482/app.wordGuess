# Word Guess

이마에 폰을 대고 친구들의 설명을 듣고 단어를 맞추는 파티 게임 (PoC).

**Play**: https://kyj5482.github.io/app.wordGuess/

## 조작

| 동작 | 모션 (기본) | 탭 (폴백) |
|---|---|---|
| 정답 | 폰을 아래로 기울임 | 화면 아래쪽 탭 |
| Skip | 폰을 위로 젖힘 | 화면 위쪽 탭 |
| Hint | 설명하는 친구가 💡 버튼 탭 (그림+텍스트 함께, 그림 없으면 텍스트만, −5초) | 동일 |

- iOS는 첫 화면 "Start" 버튼에서 모션 권한을 요청합니다. 거부하면 탭 모드로 자동 전환됩니다.
- 모션 오작동 방지: 히스테리시스 + 120ms 지속 확인 + 800ms 쿨다운 + 중립 복귀 후 재인식.
- 진동(Android): 정답 = 길게 1회, Skip = 짧게 3회, 재인식 준비 완료 = 미세 진동.

## 구조

```
index.html, css/, js/     # 정적 PoC 앱 (빌드 없음, 바닐라 JS 모듈)
data/words/*.json         # 단어 DB — 다중 태그, 텍스트 힌트(필수), 이모지 힌트(선택)
scripts/validate-words.mjs # 단어 DB 검증: node scripts/validate-words.mjs
docs/                     # 요구사항·벤치마크·기술조사·DB 스펙·설계
```

## 모션 인식 검증 (Motion Lab)

실기기에서 https://kyj5482.github.io/app.wordGuess/motion-lab.html 접속:

1. **센서 시작** → 실시간 각도·상태 게이지로 동작 확인
2. **인식률 테스트** → 화면 지시(⬆SKIP/⬇정답)대로 12회 동작 → 인식률·지연 자동 집계 (목표 99%+)
3. 테스트 중 원시 센서가 자동 기록됨 → **트레이스 다운로드** → `tests/traces/`에 커밋
4. `node tests/tilt-replay.mjs` → 커밋된 실기기 트레이스를 현재 코드에 재생해 회귀 검증

합성 시뮬레이션은 `node tests/tilt-sim.mjs`. 모션 로직(`js/tilt.js`) 수정 시 두 테스트 모두 통과해야 한다.

## 로컬 실행

```bash
npx serve .   # 또는 python3 -m http.server
# 모션 센서는 HTTPS 필요 → 실기기 테스트는 GitHub Pages 배포본으로
```

## 배포

GitHub Pages — Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `/ (root)`.

## 문서

- [요구사항](docs/01-requirements.md) · [벤치마크](docs/02-benchmark.md) · [기술 조사](docs/03-tech-research.md) · [단어 DB 스펙](docs/04-word-db-spec.md) · [설계](docs/05-design.md)
