# Design: Korean Drop — 한글 낙하 타자 연습 게임

**Feature ID**: korean-drop  
**Created**: 2026-04-29  
**Phase**: Design  
**Architecture**: Option A — 심플 단일 파일 (Electron + Vanilla JS + Canvas)

---

## Context Anchor

| 항목 | 내용 |
|------|------|
| **WHY** | 재미없는 타자 연습을 게임화하여 꾸준한 학습 동기 부여 |
| **WHO** | 한글 타자 연습이 필요한 초보자~중급자 (학생, 한국어 학습자 포함) |
| **RISK** | 한글 IME 조합 처리(자모 분리) 복잡도, Electron 빌드 환경 설정 |
| **SUCCESS** | 레벨 1~10 전 스테이지 플레이 가능, 타이핑 통계 정상 기록, 사운드 정상 재생 |
| **SCOPE** | Electron 앱, 레벨별 단어장, 게임 루프, 통계, 사운드 — 온라인 랭킹·멀티플레이 제외 |

---

## 1. Overview

### 1.1 선택된 아키텍처: Option A

Electron이 `index.html`을 로드하며, 모든 게임 로직은 `game.js`에 집중. 빌드 시스템 없이 `electron .` 으로 즉시 실행 가능. Canvas API로 낙하 단어를 렌더링하며, 하단 DOM `<input>` 요소가 한글 IME 입력을 처리.

### 1.2 핵심 설계 원칙

- **단순성 우선**: 외부 라이브러리는 Howler.js (사운드) 하나만
- **게임 루프 분리**: `requestAnimationFrame` 루프와 입력 이벤트 핸들러 명확히 분리
- **IME 안전 입력**: 조합 중 Enter 무시 → 조합 완료 후에만 제출
- **상태 머신**: 화면 전환을 명시적 상태(MENU / GAME / RESULT / WORDLIST / SETTINGS)로 관리

---

## 2. 파일 구조

```
korean-drop/
├── package.json          (electron, electron-builder 의존성)
├── main.js               (Electron main process — BrowserWindow 생성)
├── preload.js            (contextBridge: 필요 시 IPC 노출)
├── index.html            (게임 UI 전체 + CSS 인라인)
├── game.js               (게임 엔진 전체 — 상태, 루프, 입력, 렌더링)
├── words.js              (레벨별 단어 데이터)
├── sounds/
│   ├── success.mp3       (단어 입력 성공)
│   ├── fail.mp3          (단어 바닥 도달)
│   ├── levelclear.mp3    (레벨 클리어)
│   └── gameover.mp3      (게임 오버)
└── assets/
    └── howler.min.js     (로컬 번들 — CDN 의존 없음)
```

---

## 3. 상태 머신 (Game State Machine)

```
MENU ──[게임 시작]──► GAME
MENU ──[단어장]────► WORDLIST ──[뒤로]──► MENU
MENU ──[설정]──────► SETTINGS ──[뒤로]──► MENU

GAME ──[레벨 클리어]──► LEVEL_CLEAR ──[자동 2초]──► GAME (다음 레벨)
GAME ──[레벨 10 클리어]──► RESULT (승리)
GAME ──[목숨 0]────────► RESULT (게임 오버)

RESULT ──[재시작]──► GAME (레벨 1)
RESULT ──[메뉴]────► MENU
```

### 상태 변수

```js
const state = {
  screen: 'MENU',        // 'MENU' | 'GAME' | 'LEVEL_CLEAR' | 'RESULT' | 'WORDLIST' | 'SETTINGS'
  level: 1,
  score: 0,
  lives: 3,              // 단어 바닥 도달 횟수 (3회 → 게임 오버)
  combo: 0,
  maxCombo: 0,
  words: [],             // 낙하 중인 단어 객체 배열
  input: '',             // 현재 입력값
  isComposing: false,    // IME 조합 중 여부
  stats: {
    attempted: 0,        // 제출 횟수
    correct: 0,          // 성공 횟수
    startTime: null,
  },
  settings: {
    volume: 0.7,
    fontSize: 24,
  },
};
```

---

## 4. 데이터 모델

### 4.1 낙하 단어 객체 (Word Object)

```js
{
  id: number,        // 고유 ID (Date.now() + random)
  text: string,      // 단어 (예: '사과')
  x: number,         // Canvas X 좌표 (px)
  y: number,         // Canvas Y 좌표 (px) — 시작: 음수 (화면 위)
  speed: number,     // 초당 낙하 픽셀 (레벨에 따라 증가)
  matched: boolean,  // 현재 입력과 매칭 중 여부 (하이라이트)
}
```

### 4.2 레벨 설정 (Level Config)

```js
const LEVEL_CONFIG = [
  // level, targetScore, maxConcurrent, speedPx/s, wordTier
  { level: 1,  target: 100,  max: 1, speed: 40,  tier: 'basic'    },
  { level: 2,  target: 200,  max: 2, speed: 50,  tier: 'basic'    },
  { level: 3,  target: 300,  max: 2, speed: 60,  tier: 'basic'    },
  { level: 4,  target: 400,  max: 2, speed: 70,  tier: 'mid'      },
  { level: 5,  target: 500,  max: 3, speed: 80,  tier: 'mid'      },
  { level: 6,  target: 600,  max: 3, speed: 90,  tier: 'mid'      },
  { level: 7,  target: 700,  max: 3, speed: 100, tier: 'mid'      },
  { level: 8,  target: 800,  max: 4, speed: 110, tier: 'advanced' },
  { level: 9,  target: 900,  max: 5, speed: 120, tier: 'advanced' },
  { level: 10, target: 1000, max: 6, speed: 140, tier: 'advanced' },
];
```

### 4.3 단어 데이터 구조 (words.js)

```js
const WORDS = {
  basic: [
    '사과', '하늘', '공책', '바다', '나무', '강아지', '고양이', '학교',
    '친구', '음악', '책상', '의자', '창문', '시계', '전화', '사랑',
    '행복', '자동차', '비행기', '도서관', /* ... 총 30개 */
  ],
  mid: [
    '컴퓨터', '사랑해요', '대학교', '도서관에', '음식점', '선생님',
    '학생들', '수영장', '놀이터', '운동장', '교과서', '칠판이', /* ... */
  ],
  advanced: [
    '대한민국', '프로그래밍', '인터넷', '스마트폰', '대통령이', '사회주의',
    '민주주의', '과학기술', '환경오염', '지구온난화', /* ... */
  ],
};
```

---

## 5. 핵심 알고리즘

### 5.1 게임 루프

```
gameLoop(timestamp):
  delta = timestamp - lastTimestamp
  lastTimestamp = timestamp

  if state.screen == 'GAME':
    updateWords(delta)      // 위치 업데이트
    spawnWords()            // 새 단어 생성 (타이머 기반)
    checkCollisions()       // 바닥 도달 체크
    updateMatching()        // 입력과 단어 매칭 갱신
    render()                // Canvas 재렌더링

  requestAnimationFrame(gameLoop)
```

### 5.2 단어 생성 (Spawning)

```
spawnWords():
  cfg = LEVEL_CONFIG[state.level - 1]
  if state.words.length >= cfg.max: return
  if Date.now() - lastSpawn < spawnInterval: return

  word = pickRandomWord(cfg.tier, usedWords)
  x = random(50, canvasWidth - 100)
  push { id, text: word, x, y: -40, speed: cfg.speed, matched: false }
  lastSpawn = Date.now()
  spawnInterval = random(1500, 3000) // ms
```

### 5.3 한글 IME 입력 처리 (핵심 리스크 R-01)

```
input.addEventListener('compositionstart', () => {
  state.isComposing = true;
});

input.addEventListener('compositionend', (e) => {
  state.isComposing = false;
  state.input = e.target.value;
  updateMatching();
});

input.addEventListener('input', (e) => {
  if (!state.isComposing) {
    state.input = e.target.value;
    updateMatching();
  }
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !state.isComposing) {
    submitInput();
    e.target.value = '';
    state.input = '';
  }
});
```

### 5.4 단어 매칭 & 제출

```
updateMatching():
  // 현재 입력이 prefix인 단어 찾기
  match = state.words.find(w => w.text.startsWith(state.input) && state.input.length > 0)
  state.words.forEach(w => w.matched = false)
  if match: match.matched = true

submitInput():
  state.stats.attempted++
  target = state.words.find(w => w.text === state.input)
  if target:
    // 성공
    removeWord(target.id)
    addScore(target.text.length * 10 * comboMultiplier())
    state.combo++
    state.maxCombo = max(state.maxCombo, state.combo)
    state.stats.correct++
    sounds.success.play()
    checkLevelClear()
  else:
    // 실패 (단어 없음 — 입력 오류)
    state.combo = 0
```

### 5.5 점수 계산

```
comboMultiplier():
  if state.combo >= 10: return 3
  if state.combo >= 5:  return 2
  return 1

addScore(points):
  state.score += points
  updateHUD()
```

### 5.6 바닥 도달 처리

```
checkCollisions():
  for word in state.words:
    if word.y > canvasHeight:
      removeWord(word.id)
      state.lives--
      state.combo = 0
      sounds.fail.play()
      if state.lives <= 0:
        triggerGameOver()
```

---

## 6. 렌더링 설계 (Canvas)

### 6.1 레이어 구조

```
Canvas 렌더 순서:
1. 배경 (그라데이션 하늘 — 짙은 남색 → 검정)
2. 별 파티클 (고정 위치, 랜덤 생성)
3. 낙하 단어 (일반: 흰색, 매칭: 노란색 + 발광)
4. HUD 오버레이 (좌상: 레벨/점수, 우상: 목숨♥, 하단: 콤보)
5. DOM 레이어: 입력창 (<input> absolute positioned)
```

### 6.2 단어 렌더링

```js
function drawWord(ctx, word) {
  ctx.font = `${state.settings.fontSize}px 'Nanum Gothic', sans-serif`;
  if (word.matched) {
    ctx.fillStyle = '#FFD700';
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 12;
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowBlur = 0;
  }
  ctx.fillText(word.text, word.x, word.y);
}
```

### 6.3 화면별 UI

**MENU 화면** (Canvas 위 DOM 오버레이):
```
┌─────────────────────────────┐
│      ☁ Korean Drop ☁       │
│         한글 낙하 타자        │
│                             │
│    [  게임 시작  ]           │
│    [  단어장 보기 ]          │
│    [   설   정   ]          │
│    [   종   료   ]          │
└─────────────────────────────┘
```

**GAME 화면**:
```
┌─────────────────────────────┐
│ Lv.3   Score: 450   ♥♥♥   │  ← HUD
│         컴퓨터               │  ← 낙하 단어
│                             │
│  [하이라이트]사랑해요          │  ← 매칭된 단어 강조
│                             │
│        콤보 x2               │
│ ┌───────────────────────┐   │
│ │ 사랑해요_              │   │  ← 입력창
│ └───────────────────────┘   │
└─────────────────────────────┘
```

**RESULT 화면**:
```
┌─────────────────────────────┐
│     🎉 레벨 클리어! / 게임 오버│
│                             │
│  성공 단어: 24개              │
│  정확도: 89%                 │
│  평균 WPM: 42                │
│  최고 콤보: x3               │
│                             │
│    [ 재시작 ]  [ 메뉴로 ]    │
└─────────────────────────────┘
```

---

## 7. Electron 설정

### 7.1 main.js 핵심 설정

```js
const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Korean Drop',
  });
  win.loadFile('index.html');
  win.setMenuBarVisibility(false);
}
```

### 7.2 package.json 의존성

```json
{
  "name": "korean-drop",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  }
}
```

### 7.3 electron-builder 설정 (build 섹션)

```json
"build": {
  "appId": "com.korean-drop.app",
  "productName": "Korean Drop",
  "win": { "target": "nsis" },
  "mac": { "target": "dmg" },
  "files": ["main.js", "preload.js", "index.html", "game.js", "words.js", "sounds/**", "assets/**"]
}
```

---

## 8. 테스트 계획

| ID | 테스트 항목 | 방법 | 기대 결과 |
|----|------------|------|----------|
| T-01 | 한글 조합 입력 — '프로그래밍' | 직접 입력 | 조합 중 중복 제출 없음, Enter로 정상 제출 |
| T-02 | 단어 낙하 속도 — 레벨 1 vs 10 | 육안 비교 | 레벨 10이 현저히 빠름 |
| T-03 | 바닥 도달 시 목숨 감소 | 입력 안 함 | ♥ 3 → 2 → 1 → 게임 오버 |
| T-04 | 콤보 배수 적용 | 5연속 성공 | x2 콤보 UI 표시 + 점수 2배 |
| T-05 | 레벨 클리어 → 다음 레벨 | 목표 점수 달성 | LEVEL_CLEAR 화면 → 자동 이동 |
| T-06 | 레벨 10 클리어 | 목표 점수 달성 | 승리 RESULT 화면 |
| T-07 | 소리 효과 4종 재생 | 각 이벤트 트리거 | 해당 효과음 재생 (볼륨 0이 아닐 때) |
| T-08 | 통계 계산 정확도 | 10단어 입력 (8성공) | 정확도 80%, WPM 계산 |
| T-09 | Electron 앱 빌드 | npm run build | 실행 가능한 exe/dmg 생성 |
| T-10 | 창 크기 800×600 고정 | 창 크기 변경 시도 | 리사이즈 불가 |

---

## 9. 사운드 에셋 계획

| 파일 | 용도 | 길이 | 출처 |
|------|------|------|------|
| `success.mp3` | 단어 성공 | ~0.3초 | freesound.org CC0 |
| `fail.mp3` | 바닥 도달 | ~0.5초 | freesound.org CC0 |
| `levelclear.mp3` | 레벨 클리어 | ~1.5초 | freesound.org CC0 |
| `gameover.mp3` | 게임 오버 | ~2초 | freesound.org CC0 |

Howler.js로 로드:
```js
const sounds = {
  success: new Howl({ src: ['sounds/success.mp3'], volume: state.settings.volume }),
  fail:    new Howl({ src: ['sounds/fail.mp3'],    volume: state.settings.volume }),
  // ...
};
```

---

## 10. 성공 기준 매핑

| SC | 성공 기준 | 설계 보장 요소 |
|----|----------|--------------|
| SC-01 | 레벨 1~10 전 스테이지 플레이 | LEVEL_CONFIG 10개 항목, 상태 머신 전환 |
| SC-02 | 한글 조합 입력 처리 | isComposing 플래그 + compositionend 처리 |
| SC-03 | 레벨별 낙하 속도 증가 | LEVEL_CONFIG.speed 40→140 px/s |
| SC-04 | 게임 종료 후 통계 표시 | stats 객체 + RESULT 화면 렌더링 |
| SC-05 | 소리 효과 4종 재생 | Howler.js + 4개 mp3 파일 |
| SC-06 | Electron 앱 빌드 | electron-builder 설정 |

---

## 11. 구현 가이드 (Session Guide)

### 11.1 모듈 맵

| 모듈 | 파일 | 담당 기능 |
|------|------|----------|
| M-1 | `package.json`, `main.js`, `preload.js` | Electron 셋업 |
| M-2 | `index.html` (기본 구조 + CSS) | UI 레이아웃 |
| M-3 | `words.js` | 단어 데이터 (150개) |
| M-4 | `game.js` — 상태 머신 + 메뉴 화면 | MENU 화면 동작 |
| M-5 | `game.js` — 게임 루프 + Canvas 렌더링 | 낙하 단어 렌더링 |
| M-6 | `game.js` — 한글 입력 + 매칭 | IME 처리 + 단어 제거 |
| M-7 | `game.js` — 레벨 시스템 + 점수 + 통계 | 레벨 클리어, 결과 화면 |
| M-8 | `sounds/` + Howler.js 연동 | 사운드 효과 |

### 11.2 구현 순서 (추천)

```
Session 1: M-1 + M-2 + M-3
  → Electron 창 뜨고 index.html 로드 확인
  → words.js 데이터 콘솔 출력 확인

Session 2: M-4 + M-5
  → MENU 화면 + 게임 시작 시 Canvas에 단어 낙하 확인

Session 3: M-6
  → 한글 입력 → 단어 매칭 하이라이트 → Enter로 제거 확인

Session 4: M-7 + M-8
  → 레벨 클리어, 게임 오버, 결과 화면, 소리 확인
```

### 11.3 Session Guide

구현을 세션별로 나눌 경우 `--scope` 파라미터 활용:

```
/pdca do korean-drop --scope module-1,module-2,module-3   # Session 1
/pdca do korean-drop --scope module-4,module-5             # Session 2
/pdca do korean-drop --scope module-6                      # Session 3
/pdca do korean-drop --scope module-7,module-8             # Session 4
```
