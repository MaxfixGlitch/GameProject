/* ============================================================
   «Летящая фишка» — мини-игра в стиле Flappy Bird
   Золотая фишка летит между стопками карт. Каждая пройденная
   стопка приносит 1\u00A0₽. Три полёта подряд, потом перезарядка
   3 минуты — чтобы мини-игра не стала бесконечным станком.
   ============================================================ */
(() => {
  'use strict';

  const Casino = window.Casino;
  const $ = (sel) => document.querySelector(sel);

  // ---------- Константы ----------
  // Мир рисуем в фиксированных координатах 480×640 и растягиваем
  // под размер сцены — физика и картинка не зависят от экрана.
  const W = 480;
  const H = 640;
  const GROUND = 54;
  const CHIP_X = 132;
  const CHIP_R = 17;
  const GRAVITY = 1500;
  const FLAP_V = -420;
  const MAX_FALL = 820;
  const PIPE_W = 78;
  const GAP_START = 184;
  const GAP_MIN = 140;
  const SPACING = 236;
  const SPEED_START = 185;
  const SPEED_MAX = 335;

  const ATTEMPTS_MAX = 3;
  const COOLDOWN = 3 * 60 * 1000;
  const COIN = 1; //\u00A0₽ за пройденную стопку
  const MINI_KEY = 'flappy';

  const SUITS = ['♠', '♥', '♦', '♣'];

  // ---------- Элементы ----------
  const el = {
    stage: $('#flapStage'),
    canvas: $('#flapCanvas'),
    hud: $('#flapHud'),
    score: $('#flapScore'),
    flapOverlay: $('#flapOverlay'),
    kicker: $('#flapKicker'),
    title: $('#flapTitle'),
    text: $('#flapText'),
    btn: $('#flapBtn'),
    note: $('#flapNote'),
    badge: $('#flapBadge'),
    attempts: $('#flapAttempts'),
    earned: $('#flapEarned'),
    best: $('#flapBest'),
    total: $('#flapTotal'),
    cooldown: $('#flapCooldown'),
    cooldownTime: $('#flapCooldownTime'),
    bankroll: $('#bankroll'),
    deltaLayer: $('#deltaLayer'),
    soundBtn: $('#soundBtn'),
    rulesBtn: $('#rulesBtn'),
    statsBtn: $('#statsBtn'),
    modalOverlay: $('#overlay'),
    modalBody: $('#modalBody'),
    modalClose: $('#modalClose'),
  };

  let ctx = null;
  try {
    ctx = el.canvas && el.canvas.getContext ? el.canvas.getContext('2d') : null;
  } catch (_) {
    ctx = null; // jsdom без canvas: тесты гоняют физику напрямую
  }

  const numFmt = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => `${numFmt.format(Math.round(n))}\u00A0₽`;
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
  const mmss = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // Часы вынесены в переменную: тесты подменяют их, чтобы проверить
  // перезарядку, не ожидая три реальные минуты.
  let clock = () => Date.now();
  const nowMs = () => clock();

  // ---------- Состояние ----------
  const state = {
    phase: 'idle', // idle | run | dead | pause
    chipY: H * 0.4,
    chipV: 0,
    rot: 0,
    wing: 0,
    pipes: [],
    score: 0,
    runCoins: 0,
    lastRunCoins: 0,
    attempts: ATTEMPTS_MAX,
    cooldownUntil: 0,
    best: 0,
    total: 0,
    runs: 0,
    pipesTotal: 0,
    time: 0,
    scroll: 0,
    particles: [],
    floats: [],
    shake: 0,
    flash: 0,
  };

  // ---------- Сохранение ----------
  function loadProgress() {
    const saved = Casino.mini.get(MINI_KEY, null);
    if (!saved || typeof saved !== 'object') return;
    state.best = num(saved.best);
    state.total = num(saved.total);
    state.runs = num(saved.runs);
    state.pipesTotal = num(saved.pipesTotal);
    state.attempts = Number.isFinite(saved.attempts) ? clamp(num(saved.attempts), 0, ATTEMPTS_MAX) : ATTEMPTS_MAX;
    state.cooldownUntil = num(saved.cooldownUntil);
  }

  function saveProgress() {
    Casino.mini.set(MINI_KEY, {
      best: state.best,
      total: state.total,
      runs: state.runs,
      pipesTotal: state.pipesTotal,
      attempts: state.attempts,
      cooldownUntil: state.cooldownUntil,
    });
  }

  // Если перезарядка кончилась — попытки возвращаются.
  function normalizeCooldown(now = nowMs()) {
    if (state.cooldownUntil && now >= state.cooldownUntil) {
      state.cooldownUntil = 0;
      state.attempts = ATTEMPTS_MAX;
      saveProgress();
      return true;
    }
    return false;
  }

  function cooldownLeft(now = nowMs()) {
    return state.cooldownUntil ? Math.max(0, state.cooldownUntil - now) : 0;
  }

  function canPlay(now = nowMs()) {
    normalizeCooldown(now);
    return state.attempts > 0 && cooldownLeft(now) === 0;
  }

  // ---------- Правила ----------
  const speedFor = (score) => Math.min(SPEED_MAX, SPEED_START + score * 5);
  const gapFor = (score) => Math.max(GAP_MIN, GAP_START - score * 1.5);

  // ---------- Звук ----------
  let audioCtx = null;

  function getAudio() {
    if (!Casino.getSound()) return null;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function beep({ freq = 440, dur = 0.07, type = 'sine', gain = 0.035, at = 0, slide = 0 }) {
    const audio = getAudio();
    if (!audio) return;
    const t0 = audio.currentTime + at;
    const osc = audio.createOscillator();
    const gainNode = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    gainNode.gain.setValueAtTime(0.0001, t0);
    gainNode.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gainNode).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function sfx(name) {
    switch (name) {
      case 'flap':
        beep({ freq: 620, dur: 0.06, type: 'sine', gain: 0.025, slide: 180 });
        break;
      case 'coin':
        beep({ freq: 1046, dur: 0.06, type: 'square', gain: 0.018 });
        beep({ freq: 1568, dur: 0.08, type: 'square', gain: 0.012, at: 0.05 });
        break;
      case 'hit':
        beep({ freq: 180, dur: 0.22, type: 'sawtooth', gain: 0.03, slide: -100 });
        beep({ freq: 90, dur: 0.3, type: 'sine', gain: 0.04, slide: -40 });
        break;
      case 'best':
        [659.25, 783.99, 1046.5].forEach((f, i) => beep({ freq: f, dur: 0.14, type: 'sine', gain: 0.045, at: i * 0.09 }));
        break;
      default: break;
    }
  }

  // ---------- Размер сцены ----------
  function layout() {
    if (!el.stage) return;
    const parent = el.stage.parentElement;
    const styles = window.getComputedStyle(parent);
    const gap = parseFloat(styles.columnGap || styles.gap) || 0;
    const available = parent.clientWidth - gap;
    const columnWidth = window.innerWidth > 860 ? Math.max(320, available - 320) : parent.clientWidth;
    const top = el.stage.getBoundingClientRect().top || 0;
    const heightRoom = Math.max(380, window.innerHeight - top - 24);
    const height = Math.min(640, heightRoom, columnWidth / 0.75);
    const width = height * 0.75;
    if (!Number.isFinite(width) || width <= 0) return;
    el.stage.style.width = `${Math.round(width)}px`;
    el.stage.style.height = `${Math.round(height)}px`;
    resizeCanvas();
  }

  function resizeCanvas() {
    if (!el.canvas) return;
    const rect = el.canvas.getBoundingClientRect();
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (el.canvas.width !== width) el.canvas.width = width;
    if (el.canvas.height !== height) el.canvas.height = height;
    if (ctx) ctx.setTransform(width / W, 0, 0, height / H, 0, 0);
  }

  // ---------- Полёт ----------
  function resetFlight() {
    state.pipes = [];
    state.score = 0;
    state.runCoins = 0;
    state.chipY = H * 0.42;
    state.chipV = FLAP_V * 0.55;
    state.rot = 0;
    state.particles = [];
    state.floats = [];
    state.shake = 0;
    spawnPipes();
  }

  // На стартовом экране поле не должно быть пустым: показываем
  // те же стопки карт, но они просто медленно плывут — без счёта.
  function seedIdlePipes() {
    state.pipes = [];
    for (let i = 0; i < 5; i += 1) {
      state.pipes.push({
        x: 60 + i * SPACING,
        gapY: 190 + (i % 3) * 130,
        gap: GAP_START,
        passed: true,
        demo: true,
      });
    }
  }

  function spawnPipes() {
    const last = state.pipes[state.pipes.length - 1];
    let x = last ? last.x + SPACING : W + 90;
    while (x < W + SPACING * 2) {
      const gap = gapFor(state.score);
      const top = 70 + gap / 2;
      const bottom = H - GROUND - 70 - gap / 2;
      state.pipes.push({
        x,
        gapY: top + Math.random() * Math.max(20, bottom - top),
        gap,
        passed: false,
      });
      x += SPACING;
    }
  }

  function startRun() {
    normalizeCooldown();
    if (!canPlay()) {
      renderPanel();
      renderOverlay();
      return false;
    }
    state.attempts -= 1;
    state.phase = 'run';
    state.time = 0;
    resetFlight();
    state.runs += 1;
    saveProgress();
    if (el.flapOverlay) el.flapOverlay.classList.add('hidden');
    if (el.hud) el.hud.hidden = false;
    updateScore();
    sfx('flap');
    renderPanel();
    return true;
  }

  function flap() {
    if (state.phase === 'idle' || state.phase === 'dead') return false;
    if (state.phase !== 'run') return false;
    state.chipV = FLAP_V;
    state.wing = 1;
    sfx('flap');
    for (let i = 0; i < 3; i++) {
      state.particles.push({
        x: CHIP_X - CHIP_R * 0.6,
        y: state.chipY + (Math.random() - 0.5) * CHIP_R,
        vx: -40 - Math.random() * 60,
        vy: 20 + Math.random() * 40,
        life: 0.45,
        max: 0.45,
        r: 1.6 + Math.random() * 2,
      });
    }
    return true;
  }

  function coinForPipe() {
    state.score += 1;
    state.runCoins += COIN;
    state.total += COIN;
    state.pipesTotal += 1;
    Casino.addBalance(COIN);
    saveProgress();
    updateScore();
    renderBalance(COIN);
    sfx('coin');
    state.floats.push({ y: H * 0.28, life: 0.9, max: 0.9, text: `+${COIN}\u00A0₽` });
    return state.score;
  }

  function die() {
    if (state.phase !== 'run') return;
    state.phase = 'dead';
    state.lastRunCoins = state.runCoins;
    state.shake = 1;
    state.flash = 1;
    const record = state.score > state.best;
    if (record) state.best = state.score;
    if (state.attempts <= 0) state.cooldownUntil = nowMs() + COOLDOWN;
    saveProgress();
    sfx(record && state.score > 0 ? 'best' : 'hit');
    if (el.hud) el.hud.hidden = true;
    renderPanel();
    renderOverlay();
  }

  // Физика. dt в секундах; отдельный шаг — чтобы тесты могли
  // прокручивать полёт без requestAnimationFrame.
  function step(dt) {
    const delta = clamp(dt, 0, 0.05);
    if (state.phase === 'run') {
      state.time += delta;
      state.scroll += speedFor(state.score) * delta;
      const speed = speedFor(state.score);

      state.chipV = Math.min(MAX_FALL, state.chipV + GRAVITY * delta);
      state.chipY += state.chipV * delta;
      state.rot = clamp(state.chipV / 900, -0.4, 1.15);

      if (state.chipY - CHIP_R < 0) {
        state.chipY = CHIP_R;
        state.chipV = Math.max(0, state.chipV);
      }

      const gap = gapFor(state.score);
      state.pipes.forEach((pipe) => {
        pipe.x -= speed * delta;
        if (!pipe.passed && pipe.x + PIPE_W < CHIP_X - CHIP_R) {
          pipe.passed = true;
          coinForPipe();
        }
      });
      state.pipes = state.pipes.filter((pipe) => pipe.x + PIPE_W > -40);
      spawnPipes();

      // Столкновения
      const groundTop = H - GROUND;
      if (state.chipY + CHIP_R >= groundTop) {
        state.chipY = groundTop - CHIP_R;
        die();
      } else {
        for (const pipe of state.pipes) {
          const topH = pipe.gapY - pipe.gap / 2;
          const bottomY = pipe.gapY + pipe.gap / 2;
          if (hitsRect(CHIP_X, state.chipY, CHIP_R, pipe.x, 0, PIPE_W, topH)) { die(); break; }
          if (hitsRect(CHIP_X, state.chipY, CHIP_R, pipe.x, bottomY, PIPE_W, groundTop - bottomY)) { die(); break; }
        }
      }
    } else if (state.phase === 'idle') {
      state.time += delta;
      state.scroll += 22 * delta;
      state.chipY = H * 0.2 + Math.sin(state.time * 2.2) * 9;
      state.rot = Math.sin(state.time * 2.2) * 0.08;
      // Демонстрационные стопки плывут влево и возвращаются справа.
      const rightMost = state.pipes.reduce((max, pipe) => Math.max(max, pipe.x), 0);
      state.pipes.forEach((pipe) => {
        pipe.x -= 54 * delta;
        if (pipe.x + PIPE_W < -20) pipe.x = rightMost + SPACING;
      });
    }

    // Затухание эффектов
    state.wing = Math.max(0, state.wing - delta * 3.4);
    state.shake = Math.max(0, state.shake - delta * 2.6);
    state.flash = Math.max(0, state.flash - delta * 2.2);
    state.particles.forEach((p) => {
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy += 220 * delta;
      p.life -= delta;
    });
    state.particles = state.particles.filter((p) => p.life > 0);
    state.floats.forEach((f) => {
      f.y -= 34 * delta;
      f.life -= delta;
    });
    state.floats = state.floats.filter((f) => f.life > 0);
  }

  function hitsRect(cx, cy, r, x, y, w, h) {
    if (h <= 0) return false;
    const nx = clamp(cx, x, x + w);
    const ny = clamp(cy, y, y + h);
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  // ---------- Отрисовка ----------
  const bg = { suits: [] };

  function seedBackground() {
    bg.suits = [];
    for (let i = 0; i < 14; i++) {
      bg.suits.push({
        x: Math.random() * W,
        y: 40 + Math.random() * (H - GROUND - 80),
        size: 26 + Math.random() * 46,
        suit: SUITS[i % SUITS.length],
        alpha: 0.028 + Math.random() * 0.03,
        drift: 0.16 + Math.random() * 0.2,
      });
    }
  }

  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0f3527');
    sky.addColorStop(0.55, '#0a2419');
    sky.addColorStop(1, '#061710');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Мягкое золотое свечение сверху
    const glow = ctx.createRadialGradient(W * 0.5, -60, 20, W * 0.5, -60, H * 0.7);
    glow.addColorStop(0, 'rgba(233, 196, 106, .16)');
    glow.addColorStop(1, 'rgba(233, 196, 106, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Плавающие масти на фоне (параллакс)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    bg.suits.forEach((s) => {
      const x = ((s.x - state.scroll * s.drift) % (W + 120) + W + 120) % (W + 120) - 60;
      ctx.fillStyle = `rgba(233, 196, 106, ${s.alpha})`;
      ctx.font = `${Math.round(s.size)}px Georgia, serif`;
      ctx.fillText(s.suit, x, s.y);
    });
  }

  function drawCardStack(x, y, w, h, capAtBottom, suit) {
    if (h <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, '#f2e9d3');
    grad.addColorStop(0.42, '#e6d9bb');
    grad.addColorStop(1, '#cbb994');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // Стопка: полоски-карты
    ctx.strokeStyle = 'rgba(120, 100, 60, .2)';
    ctx.lineWidth = 1.4;
    for (let yy = y + 26; yy < y + h; yy += 26) {
      ctx.beginPath();
      ctx.moveTo(x + 5, yy);
      ctx.lineTo(x + w - 5, yy);
      ctx.stroke();
    }

    // Тень у края стопки
    const shade = ctx.createLinearGradient(x, 0, x + w, 0);
    shade.addColorStop(0, 'rgba(90, 70, 30, .18)');
    shade.addColorStop(0.14, 'rgba(90, 70, 30, 0)');
    shade.addColorStop(0.86, 'rgba(90, 70, 30, 0)');
    shade.addColorStop(1, 'rgba(90, 70, 30, .22)');
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, w, h);

    // Масть у самого прохода — единственная «лицевая» карта
    const faceY = capAtBottom ? y + h - 30 : y + 30;
    ctx.fillStyle = 'rgba(176, 132, 42, .55)';
    ctx.font = '22px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(suit, x + w / 2, faceY);
    ctx.restore();

    // Золотой кант
    ctx.strokeStyle = 'rgba(233, 196, 106, .8)';
    ctx.lineWidth = 3;
    roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 9);
    ctx.stroke();

    // «Козырёк» на конце стопки
    const capH = 12;
    const capY = capAtBottom ? y + h - capH - 2 : y + 2;
    const capGrad = ctx.createLinearGradient(x, capY, x, capY + capH);
    capGrad.addColorStop(0, '#ffe9ae');
    capGrad.addColorStop(1, '#c99f3d');
    ctx.fillStyle = capGrad;
    roundRect(x + 2, capY, w - 4, capH, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 245, 210, .65)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawPipes() {
    const groundTop = H - GROUND;
    state.pipes.forEach((pipe, index) => {
      const topH = pipe.gapY - pipe.gap / 2;
      const bottomY = pipe.gapY + pipe.gap / 2;
      const suit = SUITS[index % SUITS.length];
      drawCardStack(pipe.x, -30, PIPE_W, topH + 30, true, suit);
      drawCardStack(pipe.x, bottomY, PIPE_W, groundTop - bottomY + 4, false, suit);
    });
  }

  function drawWing(angle, side) {
    const r = CHIP_R;
    ctx.save();
    ctx.rotate(angle * side);
    const grad = ctx.createLinearGradient(-r * 2.4, 0, 0, 0);
    grad.addColorStop(0, 'rgba(255, 244, 205, .95)');
    grad.addColorStop(1, 'rgba(217, 172, 74, .95)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.25);
    ctx.quadraticCurveTo(-r * 1.5, -r * 1.15, -r * 2.35, -r * 0.3);
    ctx.quadraticCurveTo(-r * 1.45, r * 0.28, -r * 0.2, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 110, 30, .5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawChip() {
    const x = CHIP_X;
    const y = state.chipY;
    const r = CHIP_R;
    const wingAngle = (state.phase === 'run' ? -0.75 + state.wing * 1.3 : Math.sin(state.time * 6) * 0.4);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(state.rot * 0.3);

    // Крылья под фишкой
    drawWing(wingAngle, 1);
    ctx.save();
    ctx.scale(-1, 1);
    drawWing(wingAngle, 1);
    ctx.restore();

    // Тень
    ctx.beginPath();
    ctx.arc(1.5, 4, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, .38)';
    ctx.fill();

    // Тело фишки
    const body = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.15, 0, 0, r * 1.2);
    body.addColorStop(0, '#ffeeb8');
    body.addColorStop(0.55, '#e9c46a');
    body.addColorStop(1, '#a97f28');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // Тёмная середина и пунктирное кольцо
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
    ctx.fillStyle = '#12301f';
    ctx.fill();

    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 240, 190, .9)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Буква бренда
    ctx.fillStyle = '#f6df9a';
    ctx.font = `700 ${Math.round(r * 1.02)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('F', 0, r * 0.06);
    ctx.restore();
  }

  function drawGround() {
    const top = H - GROUND;
    const grad = ctx.createLinearGradient(0, top, 0, H);
    grad.addColorStop(0, '#123a29');
    grad.addColorStop(1, '#07180f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, top, W, GROUND);

    ctx.strokeStyle = 'rgba(233, 196, 106, .55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, top + 1);
    ctx.lineTo(W, top + 1);
    ctx.stroke();

    ctx.fillStyle = 'rgba(233, 196, 106, .1)';
    for (let x = -((state.scroll * 0.6) % 40); x < W + 40; x += 40) {
      ctx.fillRect(x, top + 12, 18, 3);
    }
  }

  function drawParticles() {
    state.particles.forEach((p) => {
      const a = Math.max(0, p.life / p.max);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 226, 150, ${a * 0.85})`;
      ctx.fill();
    });
    state.floats.forEach((f) => {
      const a = Math.max(0, f.life / f.max);
      ctx.font = '700 22px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(140, 245, 180, ${a})`;
      ctx.fillText(f.text, W * 0.5, f.y);
    });
  }

  function draw() {
    if (!ctx) return;
    ctx.save();
    if (state.shake > 0) {
      const s = state.shake * 6;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    drawBackground();
    drawPipes();
    drawGround();
    drawChip();
    drawParticles();
    ctx.restore();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 120, 100, ${state.flash * 0.18})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- Интерфейс ----------
  function updateScore() {
    if (el.score) el.score.textContent = String(state.score);
  }

  // Монеты капают часто, поэтому всплывающие «+1 ₽» склеиваем в одно
  // число за четверть секунды — иначе они наперегонки летят из шапки.
  let deltaQueue = 0;
  let deltaTimer = 0;

  function flushDelta() {
    const value = deltaQueue;
    deltaQueue = 0;
    deltaTimer = 0;
    if (!value || !el.deltaLayer) return;
    const node = document.createElement('span');
    node.className = `delta ${value > 0 ? 'plus' : 'minus'}`;
    node.textContent = signed(value);
    el.deltaLayer.appendChild(node);
    setTimeout(() => node.remove(), 1500);
  }

  function renderBalance(bump) {
    if (el.bankroll) el.bankroll.textContent = fmt(Casino.getBalance());
    if (!bump) return;
    deltaQueue += bump;
    if (!deltaTimer) deltaTimer = setTimeout(flushDelta, 260);
  }

  let lastCooldownLabel = '';

  function renderPanel(now = nowMs()) {
    normalizeCooldown(now);
    const left = cooldownLeft(now);
    const attempts = left > 0 ? 0 : state.attempts;
    // Кэш подписи таймера: живой цикл перерисовывает панель только
    // когда меняется секунда, поэтому помним последнее показанное значение.
    lastCooldownLabel = left > 0 ? mmss(left) : '';

    if (el.badge) {
      el.badge.textContent = left > 0 ? `Перезарядка ${mmss(left)}` : `${attempts} ${plural(attempts, ['попытка', 'попытки', 'попыток'])}`;
      el.badge.classList.toggle('wait', left > 0 || attempts === 0);
    }
    if (el.attempts) el.attempts.textContent = `${attempts} / ${ATTEMPTS_MAX}`;
    if (el.earned) el.earned.textContent = fmt(state.lastRunCoins);
    if (el.best) el.best.textContent = `${state.best} ${plural(state.best, ['труба', 'трубы', 'труб'])}`;
    if (el.total) el.total.textContent = fmt(state.total);

    if (el.cooldown) {
      el.cooldown.hidden = left === 0;
      if (el.cooldownTime) el.cooldownTime.textContent = mmss(left);
    }
  }

  function plural(n, forms) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last === 1) return forms[0];
    if (last >= 2 && last <= 4) return forms[1];
    return forms[2];
  }

  function renderOverlay(now = nowMs()) {
    normalizeCooldown(now);
    const left = cooldownLeft(now);
    if (el.flapOverlay) {
      const show = state.phase === 'idle' || state.phase === 'dead' || state.phase === 'pause';
      el.flapOverlay.classList.toggle('hidden', !show);
    }
    if (state.phase === 'run') return;

    if (state.phase === 'pause') {
      if (el.kicker) el.kicker.textContent = 'Пауза';
      if (el.title) el.title.textContent = 'Передышка';
      if (el.text) el.text.textContent = 'Полёт приостановлен. Фишка никуда не денется.';
      if (el.btn) { el.btn.textContent = 'Продолжить'; el.btn.disabled = false; }
      if (el.note) el.note.textContent = `Пройдено ${state.score} · заработано ${fmt(state.runCoins)}`;
      return;
    }

    if (state.phase === 'dead') {
      const record = state.score > 0 && state.score >= state.best;
      if (el.kicker) el.kicker.textContent = record ? 'Новый рекорд' : 'Полёт окончен';
      if (el.title) {
        el.title.textContent = state.score > 0
          ? `${state.score} ${plural(state.score, ['труба', 'трубы', 'труб'])}`
          : 'Ни одной трубы';
      }
      if (el.text) {
        el.text.textContent = state.score > 0
          ? `Заработано ${fmt(state.lastRunCoins)}. Деньги уже на балансе.`
          : 'Фишка задела стопку. Попробуйте ещё раз — проход всегда есть.';
      }
      if (el.btn) {
        el.btn.disabled = left > 0 || state.attempts === 0;
        el.btn.textContent = left > 0 ? `Перезарядка ${mmss(left)}` : 'Ещё полёт';
      }
      if (el.note) {
        el.note.textContent = left > 0
          ? 'Три полёта подряд — и перезарядка на 3 минуты.'
          : `Осталось попыток: ${state.attempts} из ${ATTEMPTS_MAX}`;
      }
      return;
    }

    // Стартовый экран
    if (el.kicker) el.kicker.textContent = 'Мини-игра';
    if (el.title) el.title.textContent = 'Летящая фишка';
    if (el.text) {
      el.text.textContent = 'Нажимайте на поле или жмите пробел — фишка взмахивает крыльями. '
        + 'Пролетайте между стопками карт и получайте по 1\u00A0₽ за каждую.';
    }
    if (el.btn) {
      el.btn.disabled = left > 0 || state.attempts === 0;
      el.btn.textContent = left > 0 ? `Перезарядка ${mmss(left)}` : 'Играть';
    }
    if (el.note) {
      el.note.textContent = left > 0
        ? 'Полёты кончились — отдохните три минуты.'
        : `Попыток: ${state.attempts} из ${ATTEMPTS_MAX} · 1\u00A0₽ за трубу`;
    }
  }

  // ---------- Управление ----------
  function togglePause() {
    if (state.phase === 'run') {
      state.phase = 'pause';
      renderOverlay();
    } else if (state.phase === 'pause') {
      state.phase = 'run';
      if (el.flapOverlay) el.flapOverlay.classList.add('hidden');
    }
  }

  function primaryAction() {
    if (state.phase === 'run') return flap();
    if (state.phase === 'pause') { togglePause(); return flap(); }
    if (state.phase === 'idle' || state.phase === 'dead') return startRun();
    return false;
  }

  // ---------- Модальные окна ----------
  function openModal(html) {
    if (!el.modalBody || !el.modalOverlay) return;
    el.modalBody.innerHTML = html;
    el.modalOverlay.hidden = false;
    const close = el.modalBody.querySelector('[data-close]');
    if (close) close.addEventListener('click', closeModal);
    const reset = el.modalBody.querySelector('[data-action="reset"]');
    if (reset) {
      reset.addEventListener('click', () => {
        Casino.mini.remove(MINI_KEY);
        state.attempts = ATTEMPTS_MAX;
        state.cooldownUntil = 0;
        state.best = 0;
        state.total = 0;
        state.runs = 0;
        state.pipesTotal = 0;
        state.lastRunCoins = 0;
        state.phase = 'idle';
        state.score = 0;
        state.runCoins = 0;
        if (el.hud) el.hud.hidden = true;
        updateScore();
        renderPanel();
        renderOverlay();
        closeModal();
      });
    }
  }

  function closeModal() {
    if (!el.modalOverlay) return;
    el.modalOverlay.hidden = true;
    if (el.modalBody) el.modalBody.innerHTML = '';
  }

  function openRules() {
    openModal(`
      <h2>Правила мини-игры</h2>
      <p>Золотая фишка летит вправо между стопками карт. Каждое нажатие — взмах крыльями,
        без нажатий фишка падает.</p>
      <h3>Сколько платят</h3>
      <ul>
        <li>Каждая пройденная пара стопок — <b>1\u00A0₽</b> на баланс.</li>
        <li>Деньги начисляются сразу, даже если полёт закончился падением.</li>
        <li>Лучший полёт сохраняется как рекорд.</li>
      </ul>
      <h3>Ограничения</h3>
      <ul>
        <li>Три полёта подряд. После третьего — перезарядка <b>3 минуты</b>.</li>
        <li>Это не ставка: заработок не считается чистым выигрышем и не открывает новые игры.</li>
        <li>Попытка тратится при старте, так что перезагрузка страницы её не вернёт.</li>
        <li>Перезарядка не сбрасывается кнопкой «Сбросить казино».</li>
      </ul>
      <h3>Сложность</h3>
      <ul>
        <li>Каждая пройденная труба ускоряет полёт и сужает проход.</li>
        <li>На 30-й трубе скорость и проход выходят на максимум.</li>
      </ul>
      <h3>Клавиши</h3>
      <ul>
        <li><b>Space</b>, <b>↑</b> или <b>W</b> — взмах крыльями.</li>
        <li><b>Esc</b> — пауза.</li>
      </ul>
      <div class="modal-actions"><button class="primary-btn" data-close>Понятно</button></div>
    `);
  }

  function openStats() {
    openModal(`
      <h2>Статистика мини-игры</h2>
      <div class="stat-grid">
        <span>Полётов</span><span>${numFmt.format(state.runs)}</span>
        <span>Лучший полёт</span><span>${state.best} ${plural(state.best, ['труба', 'трубы', 'труб'])}</span>
        <span>Пройдено труб</span><span>${numFmt.format(state.pipesTotal)}</span>
        <span>Всего заработано</span><span>${fmt(state.total)}</span>
        <span>Попыток сейчас</span><span>${state.attempts} из ${ATTEMPTS_MAX}</span>
      </div>
      <p class="goals-note">Мини-игра не входит в историю ставок и статистику казино: деньги приходят не со ставки, поэтому не считаются чистым выигрышем.</p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="reset">Сбросить прогресс</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  // ---------- Цикл ----------
  let last = 0;
  let rafId = 0;

  function frame(ts) {
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    step(dt);
    draw();
    updateLiveUI();
    rafId = window.requestAnimationFrame(frame);
  }

  function updateLiveUI() {
    if (state.phase === 'run') return;
    // Таймер перезарядки перерисовываем, только когда меняется секунда.
    const label = cooldownLeft() > 0 ? mmss(cooldownLeft()) : '';
    if (label === lastCooldownLabel) return;
    lastCooldownLabel = label;
    // Последняя секунда: normalizeCooldown вернёт попытки и закроет таймер.
    normalizeCooldown();
    renderPanel();
    renderOverlay();
  }

  function resize() {
    layout();
    draw();
  }

  // ---------- События ----------
  if (el.stage) {
    el.stage.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      if (state.phase === 'run') {
        event.preventDefault();
        flap();
      } else if (state.phase === 'pause') {
        event.preventDefault();
        togglePause();
      }
    });
  }

  if (el.btn) {
    el.btn.addEventListener('click', (event) => {
      event.stopPropagation();
      primaryAction();
    });
  }
  if (el.soundBtn) {
    el.soundBtn.addEventListener('click', () => {
      Casino.setSound(!Casino.getSound());
      Casino.save();
      Casino.setSoundIcon(el.soundBtn, Casino.getSound());
      if (Casino.getSound()) sfx('flap');
    });
  }

  if (el.rulesBtn) el.rulesBtn.addEventListener('click', openRules);
  if (el.statsBtn) el.statsBtn.addEventListener('click', openStats);
  if (el.modalClose) el.modalClose.addEventListener('click', closeModal);
  if (el.modalOverlay) {
    el.modalOverlay.addEventListener('click', (event) => {
      if (event.target === el.modalOverlay) closeModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    // Casino.keyOf смотрит на физическую клавишу: русская раскладка не мешает.
    const key = Casino.keyOf(event);
    if (el.modalOverlay && !el.modalOverlay.hidden) {
      if (key === 'escape') closeModal();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (key === ' ' || key === 'enter' || key === 'arrowup' || key === 'w') {
      event.preventDefault();
      primaryAction();
    } else if (key === 'escape') {
      event.preventDefault();
      togglePause();
    }
  });

  window.addEventListener('resize', resize);

  // ---------- Старт ----------
  loadProgress();
  normalizeCooldown();
  seedBackground();
  seedIdlePipes();
  Casino.setSoundIcon(el.soundBtn, Casino.getSound());
  renderBalance();
  renderPanel();
  renderOverlay();
  layout();
  draw();

  // В jsdom нет canvas — тогда и цикл не нужен, тесты крутят step() вручную.
  if (ctx) rafId = window.requestAnimationFrame(frame);

  // ---------- Тестовый хук ----------
  window.__FLAPPY_TEST__ = {
    W, H, GROUND, CHIP_X, CHIP_R, ATTEMPTS_MAX, COOLDOWN, COIN, MINI_KEY,
    state,
    speedFor,
    gapFor,
    canPlay,
    cooldownLeft,
    normalizeCooldown,
    startRun,
    flap,
    step,
    draw,
    die,
    coinForPipe,
    renderPanel,
    renderOverlay,
    updateLiveUI,
    startTicking() {
      if (!rafId && ctx) rafId = window.requestAnimationFrame(frame);
    },
    setClock(fn) {
      clock = typeof fn === 'function' ? fn : () => Date.now();
    },
    /** Пропускает полёт на заданное время, не трогая отрисовку. */
    advance(seconds, slice = 1 / 120) {
      let left = seconds;
      while (left > 0) {
        step(Math.min(slice, left));
        left -= slice;
      }
    },
    /** Ставит трубы ровно перед фишкой — чтобы предсказуемо проверять смерть. */
    placePipeAhead(gapY, gap = 200) {
      const pipe = state.pipes.find((p) => p.x > CHIP_X) || { passed: false };
      pipe.x = CHIP_X + 20;
      pipe.gapY = gapY;
      pipe.gap = gap;
      pipe.passed = false;
      if (!state.pipes.includes(pipe)) state.pipes.push(pipe);
      return pipe;
    },
    /** Убирает все трубы, чтобы они не мешали тесту. */
    clearPipes() {
      state.pipes = [];
    },
  };
})();
