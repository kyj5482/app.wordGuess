# Word Guess — 단어 DB 스펙

> 작성일: 2026-08-03 · 상태: 확정 (PoC 기준)

## 1. 설계 원칙

- **단어가 중심, 카테고리는 뷰(view)다.** 단어에 다중 태그를 붙이고, 카테고리는 태그 질의로 단어를 가져온다. 같은 단어가 여러 카테고리에 자연스럽게 등장한다 (예: "elephant" → Animals, Zoo, Africa).
- **텍스트 힌트가 기본, 그림 힌트는 선택.** 모든 단어는 텍스트 힌트를 반드시 갖는다. 그림 힌트는 표현 가능한 것만 갖는다 (PoC에서는 이모지, 추후 일러스트 교체 가능).
- **대상: 미국 초등학생.** 저학년(K–2)과 고학년(3–5) 두 레벨로 시작하고, 추후 유아/중고생/성인 레벨로 확장한다.

## 2. 단어 레코드 스키마

```jsonc
{
  "word": "elephant",            // 표시 형태 그대로 (소문자, 구는 공백 포함: "ice cream")
  "level": 1,                    // 1 = K-2 (저학년), 2 = Grades 3-5 (고학년)
                                 // 확장 예약: 0 = 유아, 3 = 중고생, 4 = 성인
  "tags": ["animals", "zoo", "wild-animals"],  // 3~6개, 최소 1개는 §3 기본 카테고리 태그
  "textHint": "A very big gray animal with a long trunk and huge ears.",
                                 // 필수. 단어 자체를 포함하지 않는 1문장 영어 설명
  "emoji": "🐘"                  // 선택. 단어를 직관적으로 나타내는 이모지 1개. 없으면 생략
}
```

- 힌트 노출 규칙 (게임): 1회차 힌트 = `emoji`가 있으면 그림(이모지), 없으면 바로 `textHint`. 2회차 힌트 = `textHint` (+이미 표시된 그림 유지).
- 추후 이미지 교체: `emoji` 대신/추가로 `image: "hints/elephant.webp"` 필드를 붙일 수 있게 스키마는 확장 개방.

## 3. 기본 카테고리 태그 (controlled vocabulary)

카테고리 화면에 노출되는 1차 태그. 단어마다 이 중 최소 1개 필수. 이 외의 자유 태그(예: `africa`, `flying`, `round`)는 얼마든지 추가 가능하며 추후 서브카테고리/스마트 덱 구성에 사용.

| 태그 | 카테고리명 (표시) | 예시 |
|---|---|---|
| `animals` | Animals | dog, elephant, penguin |
| `food` | Food & Drinks | pizza, ice cream, broccoli |
| `school` | School Life | pencil, teacher, recess |
| `home` | Around the House | sofa, spoon, pillow |
| `body` | My Body | elbow, knee, eyebrow |
| `clothes` | Clothes | jacket, sneakers, mittens |
| `jobs` | Jobs & People | firefighter, dentist, chef |
| `places` | Places | library, beach, airport |
| `transport` | Things That Go | bicycle, submarine, rocket |
| `nature` | Nature & Weather | rainbow, volcano, acorn |
| `space` | Space | moon, astronaut, comet |
| `sports` | Sports & Games | soccer, hide and seek, gymnastics |
| `toys` | Toys & Fun | teddy bear, kite, puzzle |
| `music` | Music | drum, violin, choir |
| `holidays` | Holidays & Parties | birthday cake, fireworks, costume |
| `story` | Stories & Characters | dragon, pirate, mermaid |
| `actions` | Actions (verbs) | jump, whisper, stretch |
| `feelings` | Feelings | happy, nervous, proud |
| `concepts` | Colors & Shapes & More | triangle, purple, shadow |
| `science` | Science & Discovery | magnet, dinosaur, fossil |

## 4. 레벨 판정 가이드

- **Level 1 (K–2, 5~8세)**: 아이가 일상에서 보고 말하는 단어. 사이트 워드/기초 어휘 수준. 예: dog, apple, run, red, bus.
- **Level 2 (Grades 3–5, 8~11세)**: 학교 교과·독서에서 접하는 단어, 다음절어. 예: volcano, gymnastics, microscope, ancestor.
- 판정 기준: Dolch/Fry 리스트, 미국 초등 교과 어휘를 참고. 애매하면 "2학년이 설명을 듣고 맞출 수 있는가"로 판단 (이 게임은 읽기가 아니라 **맞추기**이므로 듣고 아는 단어면 충분).

## 5. 파일 구조와 검증 규칙

```
data/words/
  animals-nature.json      // 도메인별 분할 파일. 형식: {"words": [ ...레코드... ]}
  food-drink.json
  everyday-life.json
  school-jobs-places.json
  play-culture.json
  actions-concepts.json
```

- 빌드/로드 시 전 파일을 병합. **`word` 값은 전체에서 유일해야 함** (병합 시 중복 검사, 중복이면 태그를 합침).
- 검증 스크립트(`scripts/validate-words.mjs`)가 확인할 것:
  1. 필수 필드 존재 (`word`, `level`, `tags`, `textHint`)
  2. `tags`에 §3 기본 태그 최소 1개 포함
  3. `textHint`에 `word` 문자열 미포함 (대소문자 무시)
  4. `level` ∈ {1, 2}
  5. 파일 간 중복 단어 리포트
- 목표 규모: PoC 1,000+ 단어, 레벨 1:2 비율 대략 5:5, 이모지 보유율 50% 이상 (저학년 단어는 이모지 표현이 쉬움).

## 6. 카테고리 → 단어 질의 (게임 로직)

```js
// 카테고리 = 태그 + 레벨 필터
const deck = words.filter(w => w.tags.includes(selectedTag) && w.level <= playerLevel);
// 스마트 덱(추후): 다중 태그 AND/OR 조합, 그룹 캘리브레이션 결과로 레벨 믹스 조정
```
