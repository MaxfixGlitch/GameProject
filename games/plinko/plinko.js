/* ============================================================
   Плинко: восемь рядов колышков, девять слотов
   Шарик на каждом ряду уходит влево или вправо с равной
   вероятностью. Крайние слоты редкие и дорогие: возврат 94,5%.
   ============================================================ */
(() => {
  'use strict';

  const Casino = window.Casino;
  const $ = (sel) => document.querySelector(sel);
  const GAME_ID = 'plinko';

  // Закрытая игра не запускается: прямо по адресу тоже стоит замок.
  if (!Casino.isUnlocked(GAME_ID)) {
    Casino.showLocked(GAME_ID);
    return;
  }

  // Мир доски рисуем в фиксированных координатах и растягиваем по CSS.
  const W = 560;
  const H = 600;
  const ROWS = 8;
  const STEP = 28;          // половина шага между колышками
  const CX = 280;           // ось симметрии
  const TOP = 60;           // y первого ряда колышков
  const ROW_H = 58;
  const SLOT_Y = TOP + ROWS * ROW_H; // 524
  const SLOT_H = 56;
  const SLOT_W = 52;
  const SLOT_GAP = 6;       // зазор между соседними слотами
  const BALL_R = 9;

  // Множители слотов. Сумма с биномиальными весами даёт 242/256 = 94,53%.
  const MULT = [20, 3, 1.5, 0.5, 0.2, 0.5, 1.5, 3, 20];
  const SLOT_STYLE = {
    20: { fill: '#f2cd6b', text: '#241a05' },
    3: { fill: '#d9ac4a', text: '#241a05' },
    1.5: { fill: '#2e8b6a', text: '#eafff4' },
    0.5: { fill: '#1b5c3d', text: '#d8ffe9' },
    0.2: { fill: '#123a29', text: '#a9d6bf' },
  };

  const BET_STEPS = [25, 100, 250, 500, 1000, 2500];
  const MIN_BET = 25;
  const MAX_BET = 2500;
  const HISTORY_SHOWN = 12;

  const el = {
    bankroll: $('#bankroll'),
    deltaLayer: $('#deltaLayer'),
    canvas: $('#plinkoCanvas'),
    flash: $('#plinkoFlash'),
    message: $('#message'),
    dropBtn: $('#dropBtn'),
    maxBetBtn: $('#maxBetBtn'),
    chipsRow: $('#chipsRow'),
    betTotal: $('#betTotal'),
    betLimit: $('#betLimit'),
    betHint: $('#betHint'),
    slotTable: $('#slotTable'),
    spinsList: $('#spinsList'),
    historyBtn: $('#historyBtn'),
    historyTopBtn: $('#historyTopBtn'),
    soundBtn: $('#soundBtn'),
    rulesBtn: $('#rulesBtn'),
    statsBtn: $('#statsBtn'),
    overlay: $('#overlay'),
    modalBody: $('#modalBody'),
    modalClose: $('#modalClose'),
  };

  let ctx = null;
  try {
    ctx = el.canvas && el.canvas.getContext ? el.canvas.getContext('2d') : null;
  } catch (_) {
    ctx = null;
  }

  const numFmt = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => `${numFmt.format(Math.round(n))}\u00A0₽`;
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
  const multLabel = (m) => (Number.isInteger(m) ? `×${m}` : `×${String(m).replace('.', ',')}`);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // ---------- Состояние ----------
  const state = {
    bet: MIN_BET,
    dropping: false,
    slot: null,
    ball: null,
    trail: [],
    flashes: [],
    highlight: -1,
    bits: null,
  };

  let timing = { drop: 1750, settle: 120 };
  const setTiming = (next) => { timing = Object.assign({}, timing, next); };

  let rng = Math.random;
  const setRng = (fn) => { rng = typeof fn === 'function' ? fn : Math.random; };

  // ---------- Геометрия ----------
  // Шаг между центрами слотов: ширина слота плюс зазор.
  const SLOT_STEP = SLOT_W + SLOT_GAP;

  const slotCenter = (index) => CX + (index - 4) * SLOT_STEP;

  const pegX = (row, j) => CX + (2 * j - row) * STEP;
  const pegY = (row) => TOP + row * ROW_H;

  function drawBits(forced) {
    if (Number.isInteger(forced)) {
      const rights = clamp(forced, 0, ROWS);
      const bits = Array(ROWS).fill(0);
      for (let i = 0; i < rights; i += 1) bits[i] = 1;
      return bits;
    }
    return Array.from({ length: ROWS }, () => (rng() < 0.5 ? 0 : 1));
  }

  const slotFor = (bits) => bits.reduce((sum, bit) => sum + bit, 0);

  /**
   * Точки пути шарика и колышки, о которые он бьётся.
   * После ряда r шарик висит над колышком j = число правых отскоков.
   */
  function pathFor(bits) {
    const pts = [{ x: CX, y: 16 }];
    const hits = [];
    let k = 0;
    for (let row = 0; row < ROWS; row += 1) {
      hits.push({ row, j: k });
      pts.push({ x: pegX(row, k), y: pegY(row) - 8 });
      k += bits[row];
    }
    pts.push({ x: slotCenter(k), y: SLOT_Y + 42 });
    return { pts, hits };
  }

  /**
   * Положение шарика на доле пути. Ускорение к низу — как у падающего
   * шарика, поэтому t возводим в степень.
   */
  function ballAt(pts, progress) {
    const p = clamp(progress, 0, 1);
    const eased = Math.pow(p, 1.22);
    const y0 = pts[0].y;
    const yEnd = pts[pts.length - 1].y;
    const y = y0 + (yEnd - y0) * eased;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      if (y <= b.y || i === pts.length - 2) {
        const span = b.y - a.y || 1;
        const f = clamp((y - a.y) / span, 0, 1);
        return { x: a.x + (b.x - a.x) * f, y, seg: i };
      }
    }
    return { x: pts[pts.length - 1].x, y: yEnd, seg: pts.length - 2 };
  }

  // ---------- Отрисовка ----------
  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
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

  function drawPegs() {
    for (let row = 0; row < ROWS; row += 1) {
      for (let j = 0; j <= row; j += 1) {
        const x = pegX(row, j);
        const y = pegY(row);
        const flash = state.flashes.find((f) => f.row === row && f.j === j);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = flash ? '#fff6dd' : '#d9ac4a';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 88, 22, .8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        if (flash) {
          ctx.beginPath();
          ctx.arc(x, y, 5 + flash.life * 10, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 226, 150, ${flash.life * 0.7})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x - 1.6, y - 1.8, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 249, 226, .8)';
        ctx.fill();
      }
    }
  }

  function drawSlots() {
    MULT.forEach((mult, index) => {
      const style = SLOT_STYLE[mult] || SLOT_STYLE[0.2];
      const x = slotCenter(index) - SLOT_W / 2;
      const active = state.highlight === index;
      if (active) {
        ctx.save();
        ctx.shadowColor = 'rgba(255, 226, 150, .85)';
        ctx.shadowBlur = 24;
      }
      roundRect(x, SLOT_Y, SLOT_W, SLOT_H, 12);
      ctx.fillStyle = style.fill;
      ctx.fill();
      if (active) ctx.restore();

      ctx.strokeStyle = active ? 'rgba(255, 246, 221, .95)' : 'rgba(0, 0, 0, .35)';
      ctx.lineWidth = active ? 2.5 : 1.5;
      roundRect(x, SLOT_Y, SLOT_W, SLOT_H, 12);
      ctx.stroke();

      ctx.fillStyle = style.text;
      ctx.font = '700 17px Georgia, "DejaVu Serif", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(multLabel(mult), slotCenter(index), SLOT_Y + 18);
    });
  }

  function drawBall() {
    // След шарика
    state.trail.forEach((point, index) => {
      const a = (index + 1) / (state.trail.length + 1);
      ctx.beginPath();
      ctx.arc(point.x, point.y, BALL_R * (0.35 + a * 0.45), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 226, 150, ${a * 0.18})`;
      ctx.fill();
    });

    if (!state.ball) return;
    const { x, y } = state.ball;
    const glow = ctx.createRadialGradient(x, y, 2, x, y, BALL_R * 2.6);
    glow.addColorStop(0, 'rgba(255, 233, 174, .55)');
    glow.addColorStop(1, 'rgba(255, 233, 174, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R * 2.6, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, BALL_R);
    grad.addColorStop(0, '#fff8df');
    grad.addColorStop(0.55, '#f0cd77');
    grad.addColorStop(1, '#b9872a');
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 60, 10, .55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    drawSlots();
    drawPegs();
    drawBall();
  }

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
      case 'chip':
        beep({ freq: 520, dur: 0.05, type: 'square', gain: 0.018 });
        break;
      case 'drop':
        beep({ freq: 320, dur: 0.09, type: 'sine', gain: 0.02, slide: 140 });
        break;
      case 'tick':
        beep({ freq: 760, dur: 0.035, type: 'square', gain: 0.012 });
        break;
      case 'win':
        [659.25, 783.99, 1046.5].forEach((f, i) => beep({ freq: f, dur: 0.13, type: 'sine', gain: 0.045, at: i * 0.08 }));
        break;
      case 'jackpot':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => beep({ freq: f, dur: 0.16, type: 'triangle', gain: 0.05, at: i * 0.07 }));
        break;
      case 'lose':
        beep({ freq: 220, dur: 0.18, type: 'sine', gain: 0.03, slide: -80 });
        break;
      default: break;
    }
  }

  // ---------- Интерфейс ----------
  function setMessage(text, kind = '') {
    if (!el.message) return;
    el.message.textContent = text;
    el.message.className = `message${kind ? ` ${kind}` : ''}`;
  }

  function renderBalance(bump) {
    const balance = Casino.getBalance();
    if (el.bankroll) el.bankroll.textContent = fmt(balance);
    if (bump && el.deltaLayer) {
      const node = document.createElement('span');
      node.className = `delta ${bump > 0 ? 'plus' : 'minus'}`;
      node.textContent = signed(bump);
      el.deltaLayer.appendChild(node);
      setTimeout(() => node.remove(), 1500);
    }
  }

  function updateUI() {
    renderBalance();
    if (el.betTotal) el.betTotal.textContent = fmt(state.bet);
    if (el.betLimit) el.betLimit.textContent = `из ${fmt(MAX_BET)}`;
    if (el.chipsRow) {
      el.chipsRow.querySelectorAll('[data-chip]').forEach((chip) => {
        chip.classList.toggle('on', Number(chip.dataset.chip) === state.bet);
      });
    }
    const short = Casino.getBalance() < state.bet;
    if (el.betHint) {
      el.betHint.hidden = !short;
      el.betHint.textContent = short
        ? 'На балансе меньше ставки — уменьшите ставку или заберите бонус на главной.'
        : '';
    }
    if (el.dropBtn) {
      el.dropBtn.disabled = state.dropping || short;
      el.dropBtn.textContent = state.dropping ? 'Шарик летит…' : 'Бросить шарик';
    }
  }

  function setBet(value) {
    if (state.dropping) return;
    const next = Math.max(MIN_BET, Math.min(MAX_BET, Math.round(value / 5) * 5));
    state.bet = next;
    sfx('chip');
    updateUI();
    setMessage(`Ставка ${fmt(state.bet)}`);
  }

  function renderSlots() {
    if (!el.slotTable) return;
    const counts = {};
    for (let rights = 0; rights <= ROWS; rights += 1) {
      counts[rights] = binomial(ROWS, rights);
    }
    const rows = MULT.map((mult, index) => ({ mult, chance: counts[Math.min(index, ROWS)] }));
    const grouped = new Map();
    rows.forEach(({ mult, chance }) => {
      grouped.set(mult, (grouped.get(mult) || 0) + chance);
    });
    const order = [...grouped.keys()].sort((a, b) => a - b);
    el.slotTable.innerHTML = order.map((mult) => {
      const chance = (grouped.get(mult) / 256) * 100;
      const chanceLabel = chance.toLocaleString('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
      return `
        <div class="slot-row">
          <i class="slot-dot" style="background:${SLOT_STYLE[mult].fill}"></i>
          <b>${multLabel(mult)}</b>
          <span class="slot-chance">${chanceLabel}%</span>
          <span class="slot-pays">${mult === 0 ? 'ставка сгорает' : `выплата ${multLabel(mult)}`}</span>
        </div>
      `;
    }).join('');
  }

  function binomial(n, k) {
    let result = 1;
    for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
    return Math.round(result);
  }

  // ---------- История ----------

  function spinCardHTML(entry) {
    const net = Number(entry.net) || 0;
    const cls = net > 0 ? 'win' : net < 0 ? 'lose' : '';
    const mult = Number(entry.mult) || 0;
    return `
      <article class="spin-card ${cls}">
        <span class="spin-mult ${mult < 1 ? 'low' : ''}">${multLabel(mult)}</span>
        <div class="spin-text">
          <b class="${net > 0 ? 'plus' : net < 0 ? 'minus' : ''}">${net === 0 ? 'ровно' : signed(net)}</b>
          <span>ставка ${fmt(entry.bet || 0)}${entry.payout ? ` · выплата ${fmt(entry.payout)}` : ''}${Casino.insuranceTagHTML(entry)}</span>
        </div>
        <time class="round-time">${Casino.timeLabel(entry.ts)}</time>
      </article>
    `;
  }

  function renderSpins() {
    if (!el.spinsList) return;
    const list = Casino.history(GAME_ID).slice(0, HISTORY_SHOWN);
    el.spinsList.innerHTML = list.length
      ? list.map(spinCardHTML).join('')
      : '<p class="roll-empty">Дропов пока нет. Выберите ставку и бросьте шарик.</p>';
  }

  // ---------- Дроп ----------
  function animateDrop(bits) {
    const { pts, hits } = pathFor(bits);
    const started = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    state.trail = [];
    let lastSeg = 0;

    return new Promise((resolve) => {
      const frame = () => {
        const now = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
        const progress = Math.min(1, (now - started) / timing.drop);
        const point = ballAt(pts, progress);

        if (point.seg !== lastSeg) {
          lastSeg = point.seg;
          const hit = hits[lastSeg - 1];
          if (hit) {
            state.flashes.push({ row: hit.row, j: hit.j, life: 1 });
            sfx('tick');
          }
        }

        state.ball = point;
        state.trail.push({ x: point.x, y: point.y });
        if (state.trail.length > 8) state.trail.shift();
        state.flashes = state.flashes.filter((f) => (f.life -= 0.08) > 0);
        draw();

        if (progress < 1) {
          window.requestAnimationFrame(frame);
        } else {
          resolve();
        }
      };
      window.requestAnimationFrame(frame);
    });
  }

  async function drop(forcedRights) {
    if (state.dropping) return null;
    const bet = state.bet;
    if (bet < MIN_BET) {
      setMessage('Ставка меньше минимальной', 'lose');
      return null;
    }
    if (Casino.getBalance() < bet) {
      setMessage('Не хватает денег на ставку', 'lose');
      updateUI();
      return null;
    }

    state.dropping = true;
    state.highlight = -1;
    if (el.flash) el.flash.hidden = true;
    Casino.stake(GAME_ID, bet);
    Casino.setPending(GAME_ID, bet);
    Casino.save();
    updateUI();
    setMessage('Шарик падает…');
    sfx('drop');

    const bits = drawBits(forcedRights);
    state.bits = bits;
    await animateDrop(bits);
    state.flashes = [];
    return finishDrop(bits, bet);
  }

  function finishDrop(bits, bet) {
    const rights = slotFor(bits);
    const mult = MULT[rights];
    const payout = Math.round(bet * mult);
    const baseNet = payout - bet;

    let insurance = 0;
    if (baseNet < 0 && Casino.shields() > 0 && Casino.useShield()) {
      insurance = Math.ceil(-baseNet / 2);
    }
    const net = baseNet + insurance;

    if (payout > 0) Casino.payout(GAME_ID, payout);
    if (insurance > 0) Casino.payout(GAME_ID, insurance);

    const stats = Casino.stats(GAME_ID);
    stats.drops += 1;
    stats.wagered += bet;
    stats.net += net;
    if (mult > stats.topMult) stats.topMult = mult;
    if (net > 0) {
      stats.wins += 1;
      stats.bestWin = Math.max(stats.bestWin, net);
    } else if (net < 0) {
      stats.losses += 1;
    } else {
      stats.pushes += 1;
    }

    const summary = `Слот ${multLabel(mult)} — выплата ${fmt(payout)}`;
    Casino.pushHistory(GAME_ID, {
      ts: Date.now(),
      bet,
      net,
      payout: payout + insurance,
      insurance,
      mult,
      slot: rights,
      bits,
      summary,
    });
    Casino.setPending(GAME_ID, 0);
    Casino.save();

    state.dropping = false;
    state.slot = rights;
    state.highlight = rights;
    state.ball = { x: slotCenter(rights), y: SLOT_Y + 42 };
    state.trail = [];
    draw();

    renderBalance(net);
    updateUI();
    renderSpins();

    if (el.flash) {
      el.flash.hidden = false;
      el.flash.textContent = mult > 0 ? multLabel(mult) : '×0';
      el.flash.style.color = net > 0 ? '#b8f5cd' : net < 0 ? '#ffb4b4' : '';
      setTimeout(() => { if (el.flash) el.flash.hidden = true; }, 1600);
    }

    if (net > 0) {
      sfx(mult >= 3 ? 'jackpot' : 'win');
      setMessage(`${summary} · чистыми ${signed(net)}`, 'win');
    } else if (insurance > 0) {
      sfx('win');
      setMessage(`Слот ${multLabel(mult)} · страховка вернула ${fmt(insurance)} · чистыми ${signed(net)}`, 'info');
    } else {
      sfx('lose');
      setMessage(`${summary} · чистыми ${signed(net)}`, 'lose');
    }

    return { slot: rights, rights, mult, payout, net, insurance, bet, bits };
  }

  // ---------- Окна ----------
  let lastFocused = null;

  function openModal(html) {
    if (!el.modalBody || !el.overlay) return;
    lastFocused = document.activeElement;
    el.modalBody.innerHTML = html;
    el.overlay.hidden = false;
    if (el.modalClose) el.modalClose.focus({ preventScroll: true });
    el.modalBody.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
    const reset = el.modalBody.querySelector('[data-action="reset"]');
    if (reset) {
      reset.addEventListener('click', () => {
        Casino.resetGame(GAME_ID);
        Casino.save();
        closeModal();
        state.highlight = -1;
        state.ball = null;
        state.trail = [];
        draw();
        updateUI();
        renderSpins();
      });
    }
  }

  function closeModal() {
    if (!el.overlay) return;
    el.overlay.hidden = true;
    if (el.modalBody) el.modalBody.innerHTML = '';
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus({ preventScroll: true });
  }

  function openRules() {
    openModal(`
      <h2>Правила плинко</h2>
      <p>Шарик падает сверху по восьми рядам колышков и на каждом отскакивает
        влево или вправо. Чем дальше слот от центра, тем выше множитель —
        и тем реже шарик туда попадает.</p>
      <h3>Слоты и выплаты</h3>
      <ul>
        ${[...new Set(MULT)].sort((a, b) => a - b).map((m) => `<li>${multLabel(m)} — выплата ${multLabel(m)} от ставки</li>`).join('')}
      </ul>
      <h3>Страховка</h3>
      <p>Страховки приходят за цели. Если дроп ушёл в минус, страховка
        срабатывает сама и возвращает половину потерь. На выигрыш она не
        тратится, сгорает не больше одной за дроп.</p>
      <div class="modal-actions"><button class="primary-btn" data-close>Понятно</button></div>
    `);
  }

  function openStats() {
    const s = Casino.stats(GAME_ID);
    const decided = s.wins + s.losses;
    const winRate = decided > 0 ? Math.round((s.wins / decided) * 100) : 0;
    const rtp = s.wagered > 0 ? Math.round(((s.wagered + s.net) / s.wagered) * 1000) / 10 : 0;
    openModal(`
      <h2>Статистика плинко</h2>
      <div class="stat-grid">
        <span>Дропов</span><span>${numFmt.format(s.drops)}</span>
        <span>Побед</span><span>${numFmt.format(s.wins)}</span>
        <span>Поражений</span><span>${numFmt.format(s.losses)}</span>
        <span>Ничьих</span><span>${numFmt.format(s.pushes)}</span>
        <span>Лучший множитель</span><span>${s.topMult ? multLabel(s.topMult) : '—'}</span>
        <span>Доля побед</span><span>${winRate}%</span>
        <span>Оборот ставок</span><span>${fmt(s.wagered)}</span>
        <span>Фактический возврат</span><span>${s.wagered > 0 ? `${rtp}%` : '—'}</span>
        <span>Лучший дроп</span><span>${fmt(s.bestWin)}</span>
        <span>Итог игры</span><span>${signed(s.net)}</span>
        <span>Общий баланс</span><span>${fmt(Casino.getBalance())}</span>
      </div>
      <p class="goals-note">Статистика других игр считается отдельно — она в их собственных окнах.</p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="reset">Сбросить плинко</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  function openHistory() {
    const list = Casino.history(GAME_ID);
    openModal(`
      <h2>История дропов</h2>
      ${list.length
        ? `<div class="rolls-list rolls-history-full">${list.map(spinCardHTML).join('')}</div>`
        : '<p class="roll-empty">Дропов пока нет.</p>'}
      <div class="modal-actions"><button class="primary-btn" data-close>Закрыть</button></div>
    `);
  }

  // ---------- События ----------
  if (el.chipsRow) {
    el.chipsRow.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-chip]');
      if (!chip) return;
      setBet(Number(chip.dataset.chip));
    });
  }

  if (el.dropBtn) el.dropBtn.addEventListener('click', () => { drop(); });

  if (el.maxBetBtn) {
    el.maxBetBtn.addEventListener('click', () => {
      const affordable = Math.min(MAX_BET, Math.floor(Casino.getBalance() / 5) * 5);
      if (affordable < MIN_BET) {
        setMessage('На балансе меньше минимальной ставки', 'lose');
        return;
      }
      const step = BET_STEPS.filter((value) => value <= affordable).pop() || MIN_BET;
      setBet(step);
    });
  }

  if (el.historyBtn) el.historyBtn.addEventListener('click', openHistory);
  if (el.historyTopBtn) el.historyTopBtn.addEventListener('click', openHistory);
  if (el.rulesBtn) el.rulesBtn.addEventListener('click', openRules);
  if (el.statsBtn) el.statsBtn.addEventListener('click', openStats);
  if (el.modalClose) el.modalClose.addEventListener('click', closeModal);
  if (el.overlay) {
    el.overlay.addEventListener('click', (event) => {
      if (event.target === el.overlay) closeModal();
    });
  }

  if (el.soundBtn) {
    el.soundBtn.addEventListener('click', () => {
      Casino.setSound(!Casino.getSound());
      Casino.save();
      Casino.setSoundIcon(el.soundBtn, Casino.getSound());
      if (Casino.getSound()) sfx('chip');
    });
  }

  document.addEventListener('keydown', (event) => {
    const key = Casino.keyOf(event);
    if (el.overlay && !el.overlay.hidden) {
      if (key === 'escape') closeModal();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (key === ' ' || key === 'enter') {
      event.preventDefault();
      drop();
    } else if (key === 'h') {
      event.preventDefault();
      openHistory();
    } else if (key === 'r') {
      event.preventDefault();
      openRules();
    } else if (key === 'escape') {
      closeModal();
    }
  });

  window.addEventListener('storage', () => {
    Casino.load();
    updateUI();
    renderSpins();
  });

  // ---------- Старт ----------
  renderSlots();
  Casino.setSoundIcon(el.soundBtn, Casino.getSound());
  renderSpins();
  updateUI();
  setMessage('Выберите ставку и бросьте шарик');
  draw();

  // ---------- Тестовый хук ----------
  window.__PLINKO_TEST__ = {
    W, H, ROWS, MULT, MIN_BET, MAX_BET, SLOT_STEP,
    state,
    slotFor,
    slotCenter,
    drawBits,
    pathFor,
    ballAt,
    multiplierFor: (rights) => MULT[rights],
    payoutFor: (bet, rights) => Math.round(bet * MULT[rights]),
    setRng,
    setTiming,
    drop,
    finishDrop,
    draw,
    renderSlots,
    updateUI,
    setBet,
  };
})();
