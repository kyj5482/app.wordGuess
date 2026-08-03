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

## 로컬 실행

```bash
npx serve .   # 또는 python3 -m http.server
# 모션 센서는 HTTPS 필요 → 실기기 테스트는 GitHub Pages 배포본으로
```

## 배포

GitHub Pages — Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `/ (root)`.

## 문서

- [요구사항](docs/01-requirements.md) · [벤치마크](docs/02-benchmark.md) · [기술 조사](docs/03-tech-research.md) · [단어 DB 스펙](docs/04-word-db-spec.md) · [설계](docs/05-design.md)
