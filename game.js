// Design Ref: §3 State Machine — explicit screen states
const SCREENS = {
  MENU: 'MENU',
  GAME: 'GAME',
  LEVEL_CLEAR: 'LEVEL_CLEAR',
  RESULT: 'RESULT',
  WORDLIST: 'WORDLIST',
  SETTINGS: 'SETTINGS',
  STATS: 'STATS',
};

// Design Ref: §4.2 Level Config — speed 40→140 px/s across 10 levels
const LEVEL_CONFIG = [
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

const FONT = `'Malgun Gothic', 'Apple SD Gothic Neo', 'NanumGothic', sans-serif`;

// DOM refs
const canvas   = document.getElementById('canvas');
const ctx      = canvas.getContext('2d');
const inputArea = document.getElementById('input-area');
const wordInput = document.getElementById('word-input');

// Game state
const state = {
  screen: SCREENS.MENU,
  level: 1,
  score: 0,
  lives: 3,
  combo: 0,
  maxCombo: 0,
  words: [],
  input: '',
  isComposing: false,
  victoryFlag: false,
  stats: { attempted: 0, correct: 0, startTime: null },
  settings: { volume: 0.7, lang: 'ko', bgm: true, startLevel: 1 },
  playerName: 'Player',
  spawn: { lastTime: 0, interval: 2000 },
  usedWords: new Set(),
  stars: [],
};

// UI hover tracking
let menuHover      = null;
let resultHover    = null;
let settingsHover  = null;
let wordlistHover  = null;
let statsHover     = null;
let volDragging    = false;

function getWordPool() {
  return state.settings.lang === 'en' ? WORDS_EN : WORDS;
}

// 언어별 텍스트 헬퍼
function t(ko, en) { return state.settings.lang === 'en' ? en : ko; }

// Stars background
for (let i = 0; i < 80; i++) {
  state.stars.push({
    x: Math.random() * 800,
    y: Math.random() * 600,
    r: Math.random() * 1.5 + 0.5,
    a: Math.random() * 0.5 + 0.3,
  });
}

// Web Audio API for synthetic sound effects (no external files needed)
// Design Ref: §9 Sound Plan
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
document.addEventListener('click',   () => audioCtx.resume(), { once: true });
document.addEventListener('keydown', () => audioCtx.resume(), { once: true });

function playSound(type) {
  if (state.settings.volume === 0) return;
  const v   = state.settings.volume * 0.28;
  const now = audioCtx.currentTime;

  function note(freq, t, dur, wave = 'sine') {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(v, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  if (type === 'success')    { note(523, now, 0.08); note(659, now + 0.07, 0.13); }
  if (type === 'fail')       { note(180, now, 0.28, 'sawtooth'); }
  if (type === 'levelclear') { [523, 659, 784, 1047].forEach((f, i) => note(f, now + i * 0.1, 0.2)); }
  if (type === 'gameover')   { [392, 330, 262, 196].forEach((f, i) => note(f, now + i * 0.2, 0.3, 'triangle')); }
}

// BGM — simple arpeggio loop via Web Audio API
let bgmTimer = null;
let bgmStep  = 0;
const BGM_NOTES = [220, 261.63, 329.63, 392, 440, 392, 329.63, 261.63];

function playBGMNote() {
  if (state.settings.volume === 0) return;
  const v   = state.settings.volume * 0.06;
  const now = audioCtx.currentTime;
  const freq = BGM_NOTES[bgmStep % BGM_NOTES.length];
  bgmStep++;

  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(v, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}

function startBGM() {
  if (bgmTimer || !state.settings.bgm) return;
  bgmStep = 0;
  playBGMNote();
  bgmTimer = setInterval(playBGMNote, 380);
}

function stopBGM() {
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
}

// ── localStorage 기록 ─────────────────────────────────────────────
function loadRecords() {
  try { return JSON.parse(localStorage.getItem('kd_records') || '[]'); }
  catch { return []; }
}

function buildRecord() {
  const elapsed = state.stats.startTime ? (Date.now() - state.stats.startTime) / 60000 : 0.01;
  const mins    = Math.max(elapsed, 0.01);
  const wpm     = Math.round(state.stats.correct / mins);
  const acc     = state.stats.attempted > 0
    ? Math.round(state.stats.correct / state.stats.attempted * 100) : 0;
  return {
    name: state.playerName,
    score: state.score,
    level: state.level,
    acc, wpm,
    maxCombo: state.maxCombo,
    victory: state.victoryFlag,
    date: new Date().toISOString().slice(0, 10),
  };
}

function saveRecord(rec) {
  const records = loadRecords();
  records.push(rec);
  if (records.length > 200) records.splice(0, records.length - 200);
  localStorage.setItem('kd_records', JSON.stringify(records));
}

// ── 이름 팝업 ─────────────────────────────────────────────────────
const namePopup = document.getElementById('name-popup');
const nameInput = document.getElementById('name-input');
const nameOkBtn = document.getElementById('name-ok');

function showNamePopup() {
  nameInput.value = state.playerName === 'Player' ? '' : state.playerName;
  namePopup.classList.add('active');
  setTimeout(() => nameInput.focus(), 30);
}

function hideNamePopup() {
  namePopup.classList.remove('active');
}

function confirmName() {
  const n = nameInput.value.trim();
  state.playerName = n || 'Player';
  hideNamePopup();
  startGame();
}

nameOkBtn.addEventListener('click', confirmName);
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.stopPropagation(); confirmName(); }
  if (e.key === 'Escape') hideNamePopup();
});

// Screen transitions
function gotoMenu() {
  stopBGM();
  state.screen = SCREENS.MENU;
  inputArea.style.display = 'none';
  wordInput.value = '';
  state.input = '';
  menuHover = null;
}

function startGame() {
  state.screen     = SCREENS.GAME;
  state.level      = state.settings.startLevel;
  state.score      = 0;
  state.lives      = 3;
  state.combo      = 0;
  state.maxCombo   = 0;
  state.words      = [];
  state.input      = '';
  state.victoryFlag = false;
  state.usedWords  = new Set();
  state.spawn.lastTime = 0;
  state.spawn.interval = 2000;
  state.stats      = { attempted: 0, correct: 0, startTime: Date.now() };
  inputArea.style.display = 'block';
  wordInput.value  = '';
  wordInput.focus();
  startBGM();
}

function triggerLevelClear() {
  state.screen = SCREENS.LEVEL_CLEAR;
  inputArea.style.display = 'none';
  state.words  = [];
  playSound('levelclear');

  if (state.level >= 10) {
    state.victoryFlag = true;
    stopBGM();
    saveRecord(buildRecord());
    setTimeout(() => { state.screen = SCREENS.RESULT; }, 2500);
  } else {
    setTimeout(() => {
      state.level++;
      state.usedWords      = new Set();
      state.spawn.lastTime = 0;
      state.screen         = SCREENS.GAME;
      inputArea.style.display = 'block';
      wordInput.value  = '';
      state.input      = '';
      wordInput.focus();
    }, 2000);
  }
}

function triggerGameOver() {
  state.screen = SCREENS.RESULT;
  state.victoryFlag = false;
  inputArea.style.display = 'none';
  stopBGM();
  playSound('gameover');
  saveRecord(buildRecord());
}

// Word spawning — Design Ref: §5.2
function spawnWord(now) {
  if (state.screen !== SCREENS.GAME) return;
  const cfg = LEVEL_CONFIG[state.level - 1];
  if (state.words.length >= cfg.max) return;
  if (now - state.spawn.lastTime < state.spawn.interval) return;

  const pool = getWordPool()[cfg.tier].filter(w => !state.usedWords.has(w));
  if (pool.length === 0) { state.usedWords.clear(); return; }

  const text = pool[Math.floor(Math.random() * pool.length)];
  state.usedWords.add(text);

  ctx.save();
  ctx.font = `24px ${FONT}`;
  const tw = ctx.measureText(text).width;
  ctx.restore();
  const x  = Math.max(10, Math.random() * (780 - tw));

  state.words.push({ id: now + Math.random(), text, x, y: -35, speed: cfg.speed, matched: false });
  state.spawn.lastTime = now;
  state.spawn.interval = 1500 + Math.random() * 1500;
}

function updateWords(delta) {
  const dt = delta / 1000;
  state.words.forEach(w => { w.y += w.speed * dt; });
}

// Plan SC: SC-01 — 바닥 도달 시 목숨 차감, 0이 되면 게임 오버
function checkCollisions() {
  if (state.screen !== SCREENS.GAME) return;
  const dead = state.words.filter(w => w.y > 522);
  if (!dead.length) return;
  state.words = state.words.filter(w => w.y <= 522);
  dead.forEach(() => {
    state.lives--;
    state.combo = 0;
    playSound('fail');
  });
  if (state.lives <= 0) triggerGameOver();
}

function updateMatching() {
  state.words.forEach(w => { w.matched = false; });
  if (!state.input) return;
  const match = state.words.find(w => w.text.startsWith(state.input));
  if (match) match.matched = true;
}

// Plan SC: SC-02 — compositionend 후에만 제출, 조합 중 Enter 무시
function submitInput() {
  const input = state.input;
  if (!input || state.screen !== SCREENS.GAME) return;
  state.stats.attempted++;

  const idx = state.words.findIndex(w => w.text === input);
  if (idx !== -1) {
    const word = state.words.splice(idx, 1)[0];
    const mult = state.combo >= 10 ? 3 : state.combo >= 5 ? 2 : 1;
    state.score   += word.text.length * 10 * mult;
    state.combo++;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.stats.correct++;
    playSound('success');
    if (state.score >= LEVEL_CONFIG[state.level - 1].target) triggerLevelClear();
  } else {
    state.combo = 0;
  }
}

// Rendering
function drawBg() {
  const g = ctx.createLinearGradient(0, 0, 0, 600);
  g.addColorStop(0, '#07071e');
  g.addColorStop(1, '#101030');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 800, 600);
  state.stars.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.fill();
  });
}

function drawMenu() {
  drawBg();
  ctx.save();
  ctx.textAlign = 'center';

  ctx.font      = `bold 52px ${FONT}`;
  ctx.fillStyle = '#FFD700';
  ctx.shadowColor = '#FFD700';
  ctx.shadowBlur  = 28;
  ctx.fillText('타자 연습 게임', 400, 132);

  ctx.shadowBlur  = 0;
  ctx.font        = `20px ${FONT}`;
  ctx.fillStyle   = 'rgba(255,255,255,0.65)';
  ctx.fillText(t('한글/영어 낙하 타자 연습 게임', 'Korean/English Typing Drop Game'), 400, 168);

  const items = [
    { id: 'start',    label: '게임 시작',  y: 230 },
    { id: 'stats',    label: '통    계',   y: 286 },
    { id: 'settings', label: '설    정',   y: 342 },
    { id: 'quit',     label: '종    료',   y: 398 },
  ];
  items.forEach(item => {
    const h = menuHover === item.id;
    ctx.font      = `${h ? 'bold ' : ''}26px ${FONT}`;
    ctx.fillStyle = h ? '#FFD700' : '#FFFFFF';
    ctx.shadowColor = h ? '#FFD700' : 'transparent';
    ctx.shadowBlur  = h ? 14 : 0;
    ctx.fillText(item.label, 400, item.y);
  });

  ctx.shadowBlur  = 0;
  ctx.fillStyle   = 'rgba(255,255,255,0.3)';
  ctx.font        = `14px ${FONT}`;
  ctx.fillText('Enter 키로 바로 시작', 400, 534);
  ctx.restore();
}

function drawGame() {
  drawBg();

  // Falling words
  state.words.forEach(w => {
    ctx.save();
    if (w.matched) {
      ctx.fillStyle   = '#FFD700';
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur  = 18;
      ctx.font        = `bold 28px ${FONT}`;
    } else {
      ctx.fillStyle  = '#FFFFFF';
      ctx.shadowBlur = 0;
      ctx.font       = `24px ${FONT}`;
    }
    ctx.fillText(w.text, w.x, w.y);
    ctx.restore();
  });

  // Danger zone line
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 80, 80, 0.35)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(0, 522);
  ctx.lineTo(800, 522);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // HUD background
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.fillRect(0, 0, 800, 76);

  const cfg = LEVEL_CONFIG[state.level - 1];

  // Level & Score
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.font      = `16px ${FONT}`;
  ctx.fillText(`${t('레벨', 'Level')} ${state.level}`, 16, 26);
  ctx.fillText(`${state.score} / ${cfg.target}${t('점', 'pts')}`, 16, 50);

  // Hearts
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FF6B6B';
  ctx.font      = `22px sans-serif`;
  ctx.fillText('♥'.repeat(state.lives) + '♡'.repeat(3 - state.lives), 784, 28);

  // Combo
  if (state.combo >= 2) {
    const mult = state.combo >= 10 ? 3 : state.combo >= 5 ? 2 : 1;
    ctx.textAlign   = 'center';
    ctx.fillStyle   = '#FFD700';
    ctx.font        = `bold 15px ${FONT}`;
    ctx.fillText(`🔥 ${state.combo}${t('연속', 'x')}  ×${mult} ${t('콤보', 'combo')}`, 400, 24);
  }

  // Progress bar
  const p = Math.min(state.score / cfg.target, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(16, 58, 768, 8);
  ctx.fillStyle = p >= 0.75 ? '#4CAF50' : p >= 0.4 ? '#FFC107' : '#2196F3';
  ctx.fillRect(16, 58, 768 * p, 8);

  ctx.restore();
}

function drawLevelClear() {
  drawBg();
  ctx.save();
  ctx.textAlign   = 'center';
  ctx.font        = `bold 52px ${FONT}`;
  ctx.fillStyle   = '#FFD700';
  ctx.shadowColor = '#FFD700';
  ctx.shadowBlur  = 32;
  ctx.fillText(t('레벨 클리어! 🎉', 'Level Clear! 🎉'), 400, 260);
  ctx.shadowBlur  = 0;
  ctx.font        = `24px ${FONT}`;
  ctx.fillStyle   = '#FFFFFF';
  // victoryFlag 기준이 아닌 level 값으로 판단 (타이밍 안전)
  const isLast = state.level >= 10;
  ctx.fillText(
    isLast
      ? t('모든 레벨을 완주했습니다!', 'All levels complete!')
      : t(`레벨 ${state.level + 1}로 이동합니다...`, `Moving to Level ${state.level + 1}...`),
    400, 325
  );
  ctx.restore();
}

function drawResult() {
  drawBg();
  ctx.save();
  ctx.textAlign = 'center';

  if (state.victoryFlag) {
    ctx.fillStyle   = '#FFD700';
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur  = 22;
    ctx.font        = `bold 44px ${FONT}`;
    ctx.fillText(t('전 레벨 클리어! 🏆', 'All Clear! 🏆'), 400, 112);
  } else {
    ctx.fillStyle  = '#FF6B6B';
    ctx.shadowBlur = 0;
    ctx.font       = `bold 44px ${FONT}`;
    ctx.fillText(t('게임 오버', 'Game Over'), 400, 112);
  }
  ctx.shadowBlur = 0;

  const elapsed = state.stats.startTime ? (Date.now() - state.stats.startTime) / 60000 : 0.01;
  const mins    = Math.max(elapsed, 0.01);
  const wpm     = Math.round(state.stats.correct / mins);
  const acc     = state.stats.attempted > 0
    ? Math.round(state.stats.correct / state.stats.attempted * 100)
    : 0;

  ctx.fillStyle = '#FFFFFF';
  ctx.font      = `22px ${FONT}`;
  [
    `${t('도달 레벨', 'Level')}: ${state.level}`,
    `${t('최종 점수', 'Score')}: ${state.score}`,
    `${t('성공 단어', 'Words')}: ${state.stats.correct}${t('개', '')}`,
    `${t('정확도', 'Accuracy')}: ${acc}%`,
    `${t('평균 WPM', 'Avg WPM')}: ${wpm}`,
    `${t('최고 콤보', 'Best Combo')}: ${state.maxCombo}${t('연속', 'x')}`,
  ].forEach((line, i) => ctx.fillText(line, 400, 188 + i * 42));

  const btns = [
    { id: 'restart', label: t('재시작', 'Restart'), x: 280 },
    { id: 'menu',    label: t('메뉴로', 'Menu'),    x: 520 },
  ];
  btns.forEach(btn => {
    const h = resultHover === btn.id;
    ctx.fillStyle   = h ? '#FFD700' : '#FFFFFF';
    ctx.shadowColor = h ? '#FFD700' : 'transparent';
    ctx.shadowBlur  = h ? 14 : 0;
    ctx.font        = `${h ? 'bold ' : ''}26px ${FONT}`;
    ctx.fillText(btn.label, btn.x, 502);
  });

  ctx.shadowBlur  = 0;
  ctx.fillStyle   = 'rgba(255,255,255,0.38)';
  ctx.font        = `14px ${FONT}`;
  ctx.fillText(t('Enter: 재시작  |  ESC: 메뉴', 'Enter: Restart  |  ESC: Menu'), 400, 562);
  ctx.restore();
}

function drawWordList() {
  drawBg();
  ctx.save();

  // 제목 (좌측)
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFD700';
  ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 12;
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillText('단어장', 20, 42);
  ctx.shadowBlur = 0;

  // 언어 토글 버튼 (우측 상단)
  const koAct = state.settings.lang === 'ko';
  const enAct = state.settings.lang === 'en';
  ['한국어', 'English'].forEach((label, i) => {
    const cx = i === 0 ? 605 : 730;
    const act = i === 0 ? koAct : enAct;
    const hov = wordlistHover === (i === 0 ? 'lang-ko' : 'lang-en');
    const w = 100, h = 28, r = 6;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, 20, w, h, r);
    ctx.fillStyle = act ? '#FFD700' : hov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = act ? '#FFD700' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = act ? '#1a1a1a' : hov ? '#FFD700' : 'rgba(255,255,255,0.8)';
    ctx.font = `${act ? 'bold ' : ''}14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, 39);
  });

  // 구분선
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(10, 56); ctx.lineTo(790, 56); ctx.stroke();

  // 단어 목록
  const pool = getWordPool();
  const sections = [
    { key: 'basic',    label: koAct ? '초급 (레벨 1–3)'  : 'Basic (Lv 1–3)',    color: '#90EE90' },
    { key: 'mid',      label: koAct ? '중급 (레벨 4–7)'  : 'Mid (Lv 4–7)',      color: '#87CEEB' },
    { key: 'advanced', label: koAct ? '고급 (레벨 8–10)' : 'Advanced (Lv 8–10)', color: '#FFB6C1' },
  ];

  let y = 76;
  sections.forEach(sec => {
    ctx.textAlign = 'left';
    ctx.fillStyle = sec.color;
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillText(sec.label, 14, y);
    y += 22;
    ctx.fillStyle = '#DDEEFF';
    ctx.font = `14px ${FONT}`;
    for (let i = 0; i < pool[sec.key].length; i += 8) {
      if (y > 516) break;
      ctx.fillText(pool[sec.key].slice(i, i + 8).join('  '), 14, y);
      y += 19;
    }
    y += 8;
  });

  // 돌아가기 버튼
  const bh = wordlistHover === 'back';
  ctx.textAlign = 'center';
  ctx.fillStyle = bh ? '#FFD700' : 'rgba(255,255,255,0.65)';
  ctx.shadowColor = bh ? '#FFD700' : 'transparent'; ctx.shadowBlur = bh ? 10 : 0;
  ctx.font = `${bh ? 'bold ' : ''}18px ${FONT}`;
  ctx.fillText('← 돌아가기', 400, 562);
  ctx.shadowBlur = 0;

  ctx.restore();
}

function drawSettingsBtn(label, cx, cy, active, hoverKey) {
  const hov = settingsHover === hoverKey;
  const w = 130, h = 32, r = 8;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r);
  ctx.fillStyle = active
    ? (hov ? '#FFE44D' : '#FFD700')
    : (hov ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)');
  ctx.fill();
  ctx.strokeStyle = active ? '#FFD700' : 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = active ? '#1a1a1a' : (hov ? '#FFD700' : '#FFFFFF');
  ctx.font = `${active ? 'bold ' : ''}16px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + 6);
}

// 설정 UI 좌표 상수 (클릭 핸들러와 공유)
const S = {
  LANG_KO:  { cx: 280, cy: 118 },
  LANG_EN:  { cx: 520, cy: 118 },
  BGM_ON:   { cx: 280, cy: 196 },
  BGM_OFF:  { cx: 520, cy: 196 },
  LVL_DEC:  { cx: 312, cy: 274 },
  LVL_INC:  { cx: 488, cy: 274 },
  VOL_BAR:  { x: 180, y: 378, w: 440, h: 14 },
  BACK:     { cx: 400, cy: 476 },
};

function drawSettings() {
  drawBg();
  ctx.save();
  ctx.textAlign = 'center';

  // 제목
  ctx.fillStyle = '#FFD700'; ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 16;
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillText('설정', 400, 50);
  ctx.shadowBlur = 0;

  // 구분선
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(60, 62); ctx.lineTo(740, 62); ctx.stroke();

  // ── 언어 선택 ──
  ctx.fillStyle = 'rgba(255,255,255,0.50)'; ctx.font = `14px ${FONT}`;
  ctx.fillText('언어 선택', 400, 88);
  drawSettingsBtn('한국어', S.LANG_KO.cx, S.LANG_KO.cy, state.settings.lang === 'ko', 'lang-ko');
  drawSettingsBtn('English', S.LANG_EN.cx, S.LANG_EN.cy, state.settings.lang === 'en', 'lang-en');

  // ── 배경음악 ──
  ctx.fillStyle = 'rgba(255,255,255,0.50)'; ctx.font = `14px ${FONT}`;
  ctx.fillText('배경음악', 400, 166);
  drawSettingsBtn('ON',  S.BGM_ON.cx,  S.BGM_ON.cy,  state.settings.bgm === true,  'bgm-on');
  drawSettingsBtn('OFF', S.BGM_OFF.cx, S.BGM_OFF.cy, state.settings.bgm === false, 'bgm-off');

  // ── 시작 레벨 ──
  ctx.fillStyle = 'rgba(255,255,255,0.50)'; ctx.font = `14px ${FONT}`;
  ctx.fillText('시작 레벨', 400, 244);

  const lh = settingsHover === 'level-dec';
  ctx.fillStyle = lh ? '#FFD700' : 'rgba(255,255,255,0.75)';
  ctx.font = `bold 24px ${FONT}`; ctx.fillText('◀', S.LVL_DEC.cx, S.LVL_DEC.cy + 8);

  ctx.fillStyle = '#FFFFFF'; ctx.font = `bold 26px ${FONT}`;
  ctx.fillText(`${state.settings.startLevel}`, 400, S.LVL_DEC.cy + 10);

  const rh = settingsHover === 'level-inc';
  ctx.fillStyle = rh ? '#FFD700' : 'rgba(255,255,255,0.75)';
  ctx.font = `bold 24px ${FONT}`; ctx.fillText('▶', S.LVL_INC.cx, S.LVL_INC.cy + 8);

  const tier = state.settings.startLevel <= 3 ? '초급' : state.settings.startLevel <= 7 ? '중급' : '고급';
  ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.font = `12px ${FONT}`;
  ctx.fillText(tier, 400, S.LVL_DEC.cy + 30);

  // ── 볼륨 ──
  ctx.fillStyle = 'rgba(255,255,255,0.50)'; ctx.font = `14px ${FONT}`;
  ctx.fillText('볼륨', 400, 346);

  const { x: bx, y: by, w: bw, h: bh2 } = S.VOL_BAR;
  const pct = state.settings.volume;

  // 트랙
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh2, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();

  // 채움
  if (pct > 0) {
    ctx.beginPath(); ctx.roundRect(bx, by, bw * pct, bh2, 7);
    ctx.fillStyle = '#FFD700'; ctx.fill();
  }

  // 핸들 (원형)
  const hx = bx + bw * pct;
  ctx.beginPath(); ctx.arc(hx, by + bh2 / 2, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 2; ctx.stroke();

  // 퍼센트 + 힌트
  ctx.fillStyle = '#FFFFFF'; ctx.font = `bold 18px ${FONT}`;
  ctx.fillText(`${Math.round(pct * 100)}%`, 400, 416);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = `12px ${FONT}`;
  ctx.fillText('← → 키 또는 바 클릭으로 조절', 400, 436);

  // ── 돌아가기 ──
  const bkh = settingsHover === 'back';
  ctx.fillStyle   = bkh ? '#FFD700' : 'rgba(255,255,255,0.70)';
  ctx.shadowColor = bkh ? '#FFD700' : 'transparent'; ctx.shadowBlur = bkh ? 10 : 0;
  ctx.font = `${bkh ? 'bold ' : ''}18px ${FONT}`;
  ctx.fillText('← 돌아가기', S.BACK.cx, S.BACK.cy);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255,255,255,0.20)'; ctx.font = `11px ${FONT}`;
  ctx.fillText('ESC', 400, 510);

  ctx.restore();
}

function drawStats() {
  drawBg();
  ctx.save();

  const records    = loadRecords();
  const today      = new Date().toISOString().slice(0, 10);
  const todayRecs  = records.filter(r => r.date === today);

  function calcStats(recs) {
    if (!recs.length) return { games: 0, bestScore: 0, avgWpm: 0, avgAcc: 0, bestCombo: 0 };
    return {
      games:     recs.length,
      bestScore: Math.max(...recs.map(r => r.score)),
      avgWpm:    Math.round(recs.reduce((s, r) => s + r.wpm, 0) / recs.length),
      avgAcc:    Math.round(recs.reduce((s, r) => s + r.acc, 0) / recs.length),
      bestCombo: Math.max(...recs.map(r => r.maxCombo)),
    };
  }

  const ts   = calcStats(todayRecs);
  const as_  = calcStats(records);
  const top10 = [...records].sort((a, b) => b.score - a.score).slice(0, 10);

  ctx.textAlign = 'center';

  // 제목
  ctx.fillStyle = '#FFD700'; ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 14;
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillText('통계', 400, 38);
  ctx.shadowBlur = 0;

  // 구분선
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(20, 50); ctx.lineTo(780, 50); ctx.stroke();

  // 칼럼 헤더
  ctx.font = `bold 14px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillText('항목', 135, 70);
  ctx.fillStyle = '#87CEEB';                ctx.fillText('오늘',  310, 70);
  ctx.fillStyle = '#FFD700';                ctx.fillText('전체',  530, 70);

  const statRows = [
    { label: '게임 수',    tv: ts.games,     av: as_.games,     sfx: '판' },
    { label: '최고 점수',  tv: ts.bestScore, av: as_.bestScore, sfx: '점' },
    { label: '평균 WPM',   tv: ts.avgWpm,    av: as_.avgWpm,    sfx: '' },
    { label: '평균 정확도', tv: ts.avgAcc,    av: as_.avgAcc,    sfx: '%' },
    { label: '최고 콤보',  tv: ts.bestCombo, av: as_.bestCombo, sfx: '연속' },
  ];

  statRows.forEach((row, i) => {
    const y = 96 + i * 22;
    const todayStr = ts.games === 0  ? '-' : `${row.tv}${row.sfx}`;
    const allStr   = as_.games === 0 ? '-' : `${row.av}${row.sfx}`;

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.50)'; ctx.font = `13px ${FONT}`;
    ctx.fillText(row.label, 135, y);
    ctx.fillStyle = '#87CEEB'; ctx.font = `bold 13px ${FONT}`;
    ctx.fillText(todayStr, 310, y);
    ctx.fillStyle = '#FFD700';
    ctx.fillText(allStr, 530, y);
  });

  // 세로 구분선
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.moveTo(420, 58); ctx.lineTo(420, 200); ctx.stroke();

  // 가로 구분선
  ctx.beginPath(); ctx.moveTo(20, 206); ctx.lineTo(780, 206); ctx.stroke();

  // TOP 10 제목
  ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#FFD700'; ctx.font = `bold 14px ${FONT}`;
  ctx.fillText('🏆  최고 점수 TOP 10', 400, 222);
  ctx.shadowBlur = 0;

  // 테이블 헤더
  const cols = [
    { x: 42,  label: '순위' },
    { x: 105, label: '이름' },
    { x: 255, label: '점수' },
    { x: 340, label: '레벨' },
    { x: 410, label: 'WPM' },
    { x: 480, label: '정확도' },
    { x: 570, label: '날짜' },
    { x: 670, label: '결과' },
  ];
  ctx.fillStyle = 'rgba(255,255,255,0.40)'; ctx.font = `11px ${FONT}`;
  cols.forEach(c => { ctx.textAlign = 'left'; ctx.fillText(c.label, c.x, 240); });

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.moveTo(20, 246); ctx.lineTo(780, 246); ctx.stroke();

  if (top10.length === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.font = `15px ${FONT}`;
    ctx.fillText('기록이 없습니다. 게임을 시작해보세요!', 400, 370);
  } else {
    top10.forEach((rec, i) => {
      const y = 264 + i * 25;
      // 오늘 기록 하이라이트
      const isToday = rec.date === today;
      ctx.fillStyle = i === 0 ? '#FFD700' : i < 3 ? '#90EE90' : isToday ? '#ADD8E6' : 'rgba(255,255,255,0.78)';
      ctx.font = `${i < 3 ? 'bold ' : ''}12px ${FONT}`;
      ctx.textAlign = 'left';
      cols.forEach(c => ctx.fillText('', c.x, y)); // clear
      ctx.fillText(`${i + 1}.`,                42,  y);
      ctx.fillText(rec.name.slice(0, 8),       105, y);
      ctx.fillText(rec.score.toLocaleString(), 255, y);
      ctx.fillText(rec.level,                  340, y);
      ctx.fillText(rec.wpm,                    410, y);
      ctx.fillText(`${rec.acc}%`,              480, y);
      ctx.fillText(rec.date.slice(5),          570, y);
      ctx.fillText(rec.victory ? '🏆' : '💀', 670, y);
    });
  }

  // 돌아가기
  const bh = statsHover === 'back';
  ctx.textAlign = 'center';
  ctx.fillStyle   = bh ? '#FFD700' : 'rgba(255,255,255,0.65)';
  ctx.shadowColor = bh ? '#FFD700' : 'transparent'; ctx.shadowBlur = bh ? 10 : 0;
  ctx.font = `${bh ? 'bold ' : ''}16px ${FONT}`;
  ctx.fillText('← 돌아가기', 400, 566);
  ctx.shadowBlur = 0;

  ctx.restore();
}

// Input event handlers — Design Ref: §5.3 IME composition handling
wordInput.addEventListener('compositionstart', () => {
  state.isComposing = true;
});

wordInput.addEventListener('compositionend', e => {
  state.isComposing = false;
  state.input = e.target.value;
  updateMatching();
});

wordInput.addEventListener('input', () => {
  if (!state.isComposing) {
    state.input = wordInput.value;
    updateMatching();
  }
});

wordInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !state.isComposing) {
    submitInput();
    wordInput.value = '';
    state.input = '';
    updateMatching();
  }
  // ESC는 게임 중일 때만 메뉴 이동 (다른 화면에서 input에 포커스 없으므로 실질적 중복이지만 명시)
  if (e.key === 'Escape' && state.screen === SCREENS.GAME) gotoMenu();
});

// Canvas mouse interactions
const MENU_ITEMS = [
  { id: 'start',    y: 230 },
  { id: 'stats',    y: 286 },
  { id: 'settings', y: 342 },
  { id: 'quit',     y: 398 },
];
const RESULT_BTNS = [
  { id: 'restart', x: 280 },
  { id: 'menu',    x: 520 },
];

function applyVolFromX(mx) {
  const { x: bx, w: bw } = S.VOL_BAR;
  state.settings.volume = Math.max(0, Math.min(1, +((mx - bx) / bw).toFixed(2)));
}

canvas.addEventListener('mousedown', e => {
  if (state.screen !== SCREENS.SETTINGS) return;
  const r  = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const { x: bx, y: by, w: bw, h: bh } = S.VOL_BAR;
  if (mx >= bx - 10 && mx <= bx + bw + 10 && my >= by - 8 && my <= by + bh + 8) {
    volDragging = true;
    applyVolFromX(mx);
  }
});

canvas.addEventListener('mouseup', () => { volDragging = false; });
window.addEventListener('mouseup',  () => { volDragging = false; });

canvas.addEventListener('mousemove', e => {
  const r  = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;

  if (volDragging && state.screen === SCREENS.SETTINGS) {
    applyVolFromX(mx);
    return;
  }

  if (state.screen === SCREENS.MENU) {
    menuHover = MENU_ITEMS.find(b => Math.abs(my - b.y) < 22 && Math.abs(mx - 400) < 160)?.id ?? null;
    canvas.style.cursor = menuHover ? 'pointer' : 'default';
  } else if (state.screen === SCREENS.RESULT) {
    resultHover = RESULT_BTNS.find(b => Math.abs(my - 502) < 22 && Math.abs(mx - b.x) < 80)?.id ?? null;
    canvas.style.cursor = resultHover ? 'pointer' : 'default';
  } else if (state.screen === SCREENS.SETTINGS) {
    const SETTINGS_HITS = [
      { id: 'lang-ko',   cx: S.LANG_KO.cx,  cy: S.LANG_KO.cy,  dx: 65 },
      { id: 'lang-en',   cx: S.LANG_EN.cx,  cy: S.LANG_EN.cy,  dx: 65 },
      { id: 'bgm-on',    cx: S.BGM_ON.cx,   cy: S.BGM_ON.cy,   dx: 65 },
      { id: 'bgm-off',   cx: S.BGM_OFF.cx,  cy: S.BGM_OFF.cy,  dx: 65 },
      { id: 'level-dec', cx: S.LVL_DEC.cx,  cy: S.LVL_DEC.cy,  dx: 32 },
      { id: 'level-inc', cx: S.LVL_INC.cx,  cy: S.LVL_INC.cy,  dx: 32 },
      { id: 'back',      cx: S.BACK.cx,     cy: S.BACK.cy,     dx: 110 },
    ];
    settingsHover = SETTINGS_HITS.find(b => Math.abs(mx - b.cx) < b.dx && Math.abs(my - b.cy) < 22)?.id ?? null;
    canvas.style.cursor = settingsHover ? 'pointer' : 'default';
  } else if (state.screen === SCREENS.WORDLIST) {
    const WORDLIST_HITS = [
      { id: 'lang-ko', cx: 605, cy: 34, dx: 52 },
      { id: 'lang-en', cx: 730, cy: 34, dx: 52 },
      { id: 'back',    cx: 400, cy: 562, dx: 110 },
    ];
    wordlistHover = WORDLIST_HITS.find(b => Math.abs(mx - b.cx) < b.dx && Math.abs(my - b.cy) < 22)?.id ?? null;
    canvas.style.cursor = wordlistHover ? 'pointer' : 'default';
  } else if (state.screen === SCREENS.STATS) {
    statsHover = (Math.abs(mx - 400) < 110 && Math.abs(my - 566) < 22) ? 'back' : null;
    canvas.style.cursor = statsHover ? 'pointer' : 'default';
  }
});

canvas.addEventListener('click', e => {
  const r  = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;

  if (state.screen === SCREENS.GAME) { wordInput.focus(); return; }

  if (state.screen === SCREENS.MENU) {
    const hit = MENU_ITEMS.find(b => Math.abs(my - b.y) < 22 && Math.abs(mx - 400) < 160);
    if (!hit) return;
    if (hit.id === 'start')    showNamePopup();
    if (hit.id === 'stats')    { state.screen = SCREENS.STATS; statsHover = null; }
    if (hit.id === 'settings') state.screen = SCREENS.SETTINGS;
    if (hit.id === 'quit') {
      if (window.electronAPI?.quit) window.electronAPI.quit();
      else window.close();
    }
  }

  if (state.screen === SCREENS.RESULT) {
    const hit = RESULT_BTNS.find(b => Math.abs(my - 502) < 22 && Math.abs(mx - b.x) < 80);
    if (hit?.id === 'restart') startGame();
    if (hit?.id === 'menu')    gotoMenu();
  }

  if (state.screen === SCREENS.SETTINGS) {
    if (Math.abs(mx - S.LANG_KO.cx) < 65 && Math.abs(my - S.LANG_KO.cy) < 22) state.settings.lang = 'ko';
    if (Math.abs(mx - S.LANG_EN.cx) < 65 && Math.abs(my - S.LANG_EN.cy) < 22) state.settings.lang = 'en';
    if (Math.abs(mx - S.BGM_ON.cx)  < 65 && Math.abs(my - S.BGM_ON.cy)  < 22) { state.settings.bgm = true;  startBGM(); }
    if (Math.abs(mx - S.BGM_OFF.cx) < 65 && Math.abs(my - S.BGM_OFF.cy) < 22) { state.settings.bgm = false; stopBGM();  }
    if (Math.abs(mx - S.LVL_DEC.cx) < 32 && Math.abs(my - S.LVL_DEC.cy) < 24)
      state.settings.startLevel = Math.max(1, state.settings.startLevel - 1);
    if (Math.abs(mx - S.LVL_INC.cx) < 32 && Math.abs(my - S.LVL_INC.cy) < 24)
      state.settings.startLevel = Math.min(10, state.settings.startLevel + 1);
    // 볼륨 바 클릭 (드래그는 mousedown에서 처리)
    const { x: bx, y: by, w: bw, h: bh } = S.VOL_BAR;
    if (my >= by - 8 && my <= by + bh + 8 && mx >= bx - 10 && mx <= bx + bw + 10)
      applyVolFromX(mx);
    // 돌아가기
    if (Math.abs(mx - S.BACK.cx) < 110 && Math.abs(my - S.BACK.cy) < 22) gotoMenu();
  }

  if (state.screen === SCREENS.WORDLIST) {
    if (Math.abs(mx - 605) < 52 && Math.abs(my - 34) < 22) state.settings.lang = 'ko';
    if (Math.abs(mx - 730) < 52 && Math.abs(my - 34) < 22) state.settings.lang = 'en';
    if (Math.abs(mx - 400) < 110 && Math.abs(my - 562) < 22) gotoMenu();
  }

  if (state.screen === SCREENS.STATS) {
    if (Math.abs(mx - 400) < 110 && Math.abs(my - 566) < 22) gotoMenu();
  }
});

// Global keyboard shortcuts
document.addEventListener('keydown', e => {
  if (state.screen === SCREENS.MENU && e.key === 'Enter') showNamePopup();

  if (state.screen === SCREENS.RESULT) {
    if (e.key === 'Enter') startGame();
    if (e.key === 'Escape') gotoMenu();
  }

  if (state.screen === SCREENS.WORDLIST && e.key === 'Escape') gotoMenu();
  if (state.screen === SCREENS.STATS    && e.key === 'Escape') gotoMenu();

  if (state.screen === SCREENS.SETTINGS) {
    if (e.key === 'Escape') gotoMenu();
    if (e.key === 'ArrowRight') state.settings.volume = Math.min(1, +(state.settings.volume + 0.1).toFixed(1));
    if (e.key === 'ArrowLeft')  state.settings.volume = Math.max(0, +(state.settings.volume - 0.1).toFixed(1));
  }
});

// Main game loop — 60fps via requestAnimationFrame
let lastTs = 0;

function loop(ts) {
  const delta = lastTs ? Math.min(ts - lastTs, 100) : 0;
  lastTs = ts;

  switch (state.screen) {
    case SCREENS.MENU:        drawMenu(); break;
    case SCREENS.GAME:
      spawnWord(ts);
      updateWords(delta);
      checkCollisions();
      drawGame();
      break;
    case SCREENS.LEVEL_CLEAR: drawLevelClear(); break;
    case SCREENS.RESULT:      drawResult(); break;
    case SCREENS.WORDLIST:    drawWordList(); break;
    case SCREENS.SETTINGS:    drawSettings(); break;
    case SCREENS.STATS:       drawStats();    break;
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
