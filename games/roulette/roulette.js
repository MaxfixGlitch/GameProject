/* ============================================================
   Европейская рулетка — колесо, стол и расчёт ставок
   ============================================================ */
(() => {
  'use strict';

  // ---------- Данные колеса ----------
  // Порядок чисел на реальном европейском колесе (одно зеро).
  const WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30,
    8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
    28, 12, 35, 3, 26,
  ];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const SEG = 360 / WHEEL_ORDER.length;
  const SLOTS = WHEEL_ORDER.length;

  const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
  const colorLabel = (n) => (n === 0 ? 'зеро' : RED.has(n) ? 'красное' : 'чёрное');

  // ---------- Ставки ----------
  // Множитель = полная выплата вместе со ставкой: 35:1 → ×36.
  function multiplier(key) {
    const type = String(key).split(':')[0];
    if (type === 'straight') return 36;
    if (type === 'dozen' || type === 'column') return 3;
    return 2;
  }

  function betWins(key, n) {
    const [type, arg] = String(key).split(':');
    switch (type) {
      case 'straight': return Number(arg) === n;
      case 'red': return n !== 0 && RED.has(n);
      case 'black': return n !== 0 && !RED.has(n);
      case 'even': return n !== 0 && n % 2 === 0;
      case 'odd': return n !== 0 && n % 2 === 1;
      case 'low': return n >= 1 && n <= 18;
      case 'high': return n >= 19 && n <= 36;
      case 'dozen': return n >= 1 && Math.ceil(n / 12) === Number(arg);
      case 'column': return n >= 1 && ((n - 1) % 3) + 1 === Number(arg);
      default: return false;
    }
  }

  // ---------- Кошелёк ----------
  const Casino = window.Casino;
  const GAME_ID = 'roulette';
  const MIN_BET = Casino.MIN_BET;
  // Лимит стола растёт с достигнутыми целями.
  const maxBet = () => Casino.maxBet();

  const state = {
    bets: {},          // ключ ставки -> сумма
    stack: [],         // история кликов для «Отменить»
    lastBets: null,    // для «Повторить»
    chip: 25,
    spinning: false,
    settled: false,
    highlight: new Set(),
    numbers: [],       // последние выпавшие числа
    hubNumber: null,   // число в ступице колеса (последнее выпавшее)
    sound: true,
    wheelAngle: 0,
    ballAngle: 0,
    ballRadius: 168,
  };

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const el = {
    wheel: $('#wheel'),
    ball: null,
    rotor: null,
    badge: $('#resultBadge'),
    message: $('#message'),
    betTotal: $('#betTotal'),
    betLimit: $('#betLimit'),
    betHint: $('#betHint'),
    chipsRow: $('#chipsRow'),
    table: $('#betTable'),
    spinBtn: $('#spinBtn'),
    undoBtn: $('#undoBtn'),
    clearBtn: $('#clearBtn'),
    repeatBtn: $('#repeatBtn'),
    bankroll: $('#bankroll'),
    deltaLayer: $('#deltaLayer'),
    soundBtn: $('#soundBtn'),
    rulesBtn: $('#rulesBtn'),
    statsBtn: $('#statsBtn'),
    historyTopBtn: $('#historyTopBtn'),
    overlay: $('#overlay'),
    modalBody: $('#modalBody'),
    modalClose: $('#modalClose'),
    numbersStrip: $('#numbersStrip'),
    spinsList: $('#spinsList'),
    historyBtn: $('#historyBtn'),
    chips: [...document.querySelectorAll('.chip')],
  };

  const numFmt = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => `${numFmt.format(Math.round(n))} ₽`;
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

  // ---------- Звук ----------
  let audioCtx = null;

  function getAudio() {
    if (!state.sound) return null;
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
    const ctx = getAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function sfx(name) {
    switch (name) {
      case 'chip':
        beep({ freq: 880, dur: 0.045, type: 'square', gain: 0.02 });
        beep({ freq: 1320, dur: 0.05, type: 'square', gain: 0.014, at: 0.03 });
        break;
      case 'tick':
        beep({ freq: 1500, dur: 0.02, type: 'square', gain: 0.008 });
        break;
      case 'spin':
        beep({ freq: 180, dur: 0.5, type: 'sawtooth', gain: 0.02, slide: 320 });
        break;
      case 'win':
        [523.25, 659.25, 783.99].forEach((f, i) => beep({ freq: f, dur: 0.16, type: 'sine', gain: 0.05, at: i * 0.09 }));
        break;
      case 'lose':
        beep({ freq: 220, dur: 0.26, type: 'sine', gain: 0.045, slide: -70 });
        break;
      case 'push':
        beep({ freq: 440, dur: 0.13, type: 'sine', gain: 0.04 });
        beep({ freq: 440, dur: 0.13, type: 'sine', gain: 0.04, at: 0.16 });
        break;
      default: break;
    }
  }

  // ---------- Утилиты ----------
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const smoothstep = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const mod = (v, m) => ((v % m) + m) % m;

  function randomInt(max) {
    if (window.crypto && window.crypto.getRandomValues) {
      const limit = Math.floor(0xffffffff / max) * max;
      let x;
      do {
        x = window.crypto.getRandomValues(new Uint32Array(1))[0];
      } while (x >= limit);
      return x % max;
    }
    return Math.floor(Math.random() * max);
  }

  const totalBet = () => Object.values(state.bets).reduce((sum, v) => sum + v, 0);

  // Сколько стол вернёт при каждом из 37 исходов. Нужно, чтобы честно
  // предупредить игрока: «зеркальные» комбинации выиграть не могут.
  function payoutFor(n) {
    return Object.entries(state.bets).reduce((sum, [key, amount]) => (
      betWins(key, n) ? sum + amount * multiplier(key) : sum
    ), 0);
  }

  function analyzeBets() {
    const total = totalBet();
    if (total <= 0) return null;
    const payouts = [];
    for (let n = 0; n <= 36; n++) payouts.push(payoutFor(n));
    const max = Math.max(...payouts);
    const zero = payouts[0];
    const restSame = payouts.slice(1).every((p) => p === payouts[1]);
    return {
      total,
      max,
      // При любом числе, кроме зеро, возвращается ровно ставка.
      neutral: zero < total && restSame && payouts[1] === total,
      // Даже лучший исход не покрывает ставку.
      cannotWin: max <= total,
    };
  }

  // ---------- Сообщения ----------
  function setMessage(text, cls = '') {
    el.message.textContent = text;
    el.message.className = `message ${cls}`.trim();
  }

  // ---------- Колесо ----------
  const CX = 200;
  const CY = 200;
  const R_RIM = 198;       // деревянный обод
  const R_TRACK_OUT = 186; // внешняя дорожка шарика
  const R_APRON = 160;     // металлическое зеркало к карманам
  const R_OUT = 150;       // внешний край карманов
  const R_IN = 92;         // дно карманов
  const R_FRET = 84;       // конус к центру
  const R_LABEL = 134;
  const R_ORBIT = 176;
  const R_POCKET = 119;

  const px = (angle, radius) => CX + radius * Math.sin((angle * Math.PI) / 180);
  const py = (angle, radius) => CY - radius * Math.cos((angle * Math.PI) / 180);

  function wedgePath(a1, a2, rOut, rIn) {
    const x1 = px(a1, rOut);
    const y1 = py(a1, rOut);
    const x2 = px(a2, rOut);
    const y2 = py(a2, rOut);
    const x3 = px(a2, rIn);
    const y3 = py(a2, rIn);
    const x4 = px(a1, rIn);
    const y4 = py(a1, rIn);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rOut} ${rOut} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
      + ` L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${rIn} ${rIn} 0 0 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
  }

  function buildWheel() {
    const wedges = WHEEL_ORDER.map((number, i) => {
      const center = i * SEG;
      const color = colorOf(number);
      const fill = color === 'green'
        ? 'url(#pocketGreen)'
        : color === 'red' ? 'url(#pocketRed)' : 'url(#pocketBlack)';
      return `<path class="wedge ${color}" data-number="${number}"
        d="${wedgePath(center - SEG / 2, center + SEG / 2, R_OUT, R_IN)}"
        fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width="0.8"></path>`;
    }).join('');

    const labels = WHEEL_ORDER.map((number, i) => {
      const center = i * SEG;
      const x = px(center, R_LABEL).toFixed(2);
      const y = py(center, R_LABEL).toFixed(2);
      return `<text class="wedge-label" x="${x}" y="${y}" dy="0.35em" font-size="10.5"
        text-anchor="middle" transform="rotate(${center.toFixed(2)} ${x} ${y})">${number}</text>`;
    }).join('');

    const frets = WHEEL_ORDER.map((_, i) => {
      const a = (i + 0.5) * SEG;
      return `<line x1="${px(a, R_IN).toFixed(2)}" y1="${py(a, R_IN).toFixed(2)}"
        x2="${px(a, R_OUT).toFixed(2)}" y2="${py(a, R_OUT).toFixed(2)}"
        stroke="rgba(0,0,0,.45)" stroke-width="1.1"></line>`;
    }).join('');

    const diamonds = Array.from({ length: 8 }, (_, i) => {
      const angle = i * 45 + 22.5;
      const x = px(angle, 192);
      const y = py(angle, 194);
      return `<rect x="-3.2" y="-3.2" width="6.4" height="6.4" rx="1"
        transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(45)"
        fill="rgba(247,231,182,.85)"></rect>`;
    }).join('');

    el.wheel.innerHTML = `
      <defs>
        <radialGradient id="rimWood" cx="50%" cy="35%" r="70%">
          <stop offset="0" stop-color="#a3652f"></stop>
          <stop offset="0.55" stop-color="#6b3d1c"></stop>
          <stop offset="1" stop-color="#331a0b"></stop>
        </radialGradient>
        <radialGradient id="hubGold" cx="40%" cy="30%" r="75%">
          <stop offset="0" stop-color="#f7e7b6"></stop>
          <stop offset="0.6" stop-color="#b98f33"></stop>
          <stop offset="1" stop-color="#5c4212"></stop>
        </radialGradient>
        <radialGradient id="pocketRed" cx="42%" cy="28%" r="80%">
          <stop offset="0" stop-color="#e0453f"></stop>
          <stop offset="1" stop-color="#8f1a1f"></stop>
        </radialGradient>
        <radialGradient id="pocketBlack" cx="42%" cy="28%" r="80%">
          <stop offset="0" stop-color="#4b5563"></stop>
          <stop offset="1" stop-color="#0d1014"></stop>
        </radialGradient>
        <radialGradient id="pocketGreen" cx="42%" cy="28%" r="80%">
          <stop offset="0" stop-color="#3ecf7a"></stop>
          <stop offset="1" stop-color="#0f5c33"></stop>
        </radialGradient>
        <linearGradient id="apronMetal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#cfd8dc"></stop>
          <stop offset="0.35" stop-color="#8b98a0"></stop>
          <stop offset="0.55" stop-color="#e8eef2"></stop>
          <stop offset="0.8" stop-color="#7b8890"></stop>
          <stop offset="1" stop-color="#b6c1c7"></stop>
        </linearGradient>
        <radialGradient id="hubMetal" cx="40%" cy="32%" r="75%">
          <stop offset="0" stop-color="#f2f6f8"></stop>
          <stop offset="0.5" stop-color="#aeb9c0"></stop>
          <stop offset="1" stop-color="#5f6b73"></stop>
        </radialGradient>
        <radialGradient id="ballSteel" cx="35%" cy="30%" r="75%">
          <stop offset="0" stop-color="#ffffff"></stop>
          <stop offset="0.55" stop-color="#e8eef2"></stop>
          <stop offset="1" stop-color="#9aa8b2"></stop>
        </radialGradient>
      </defs>
      <circle cx="${CX}" cy="${CY}" r="${R_RIM}" fill="url(#rimWood)"></circle>
      <circle cx="${CX}" cy="${CY}" r="${R_RIM}" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="2"></circle>
      <circle cx="${CX}" cy="${CY}" r="${R_TRACK_OUT}" fill="#0a1a12"></circle>
      <circle cx="${CX}" cy="${CY}" r="${R_TRACK_OUT - 5}" fill="none"
        stroke="rgba(255,255,255,.05)" stroke-width="3"></circle>
      <circle cx="${CX}" cy="${CY}" r="${R_APRON}" fill="url(#apronMetal)"></circle>
      <g id="wheelRotor">
        <circle cx="${CX}" cy="${CY}" r="${R_OUT}" fill="#120a06"></circle>
        ${wedges}
        ${frets}
        ${labels}
      </g>
      <!-- Ступица не вращается: надписи в центре всегда стоят ровно. -->
      <g id="wheelHub">
        <circle cx="${CX}" cy="${CY}" r="${R_IN}" fill="url(#hubGold)"></circle>
        <circle cx="${CX}" cy="${CY}" r="${R_FRET}" fill="url(#hubMetal)"></circle>
        <circle cx="${CX}" cy="${CY}" r="${R_FRET - 6}" fill="#0b2418" stroke="rgba(233,196,106,.5)" stroke-width="1.5"></circle>
        <text x="${CX}" y="${CY - 26}" text-anchor="middle"
          font-family="Georgia, serif" font-size="8" letter-spacing="2.4"
          fill="rgba(233,196,106,.55)">FAKRAP</text>
        <text id="hubNumber" x="${CX}" y="${CY}" dy="0.35em" text-anchor="middle"
          font-family="Georgia, serif" font-size="26" font-weight="700"
          fill="${hubColor(state.hubNumber)}">${hubNumberText()}</text>
        <text id="hubCaption" x="${CX}" y="${CY + 32}" text-anchor="middle"
          font-family="Georgia, serif" font-size="8" letter-spacing="2.4"
          fill="rgba(233,196,106,.45)">${Number.isInteger(state.hubNumber) ? 'ВЫПАЛО' : 'ROULETTE'}</text>
      </g>
      ${diamonds}
      <circle id="ball" cx="${px(state.ballAngle, state.ballRadius).toFixed(2)}"
        cy="${py(state.ballAngle, state.ballRadius).toFixed(2)}" r="7.5" fill="url(#ballSteel)"></circle>
    `;

    el.rotor = el.wheel.querySelector('#wheelRotor');
    el.ball = el.wheel.querySelector('#ball');
  }

  // ---------- Число в ступице ----------
  // Раньше в центре всегда стояло «21» — его легко было принять за результат.
  // Теперь там последнее выпавшее число, а до первого спина — прочерк.
  function hubNumberText() {
    return Number.isInteger(state.hubNumber) ? String(state.hubNumber) : '—';
  }

  function hubColor(number) {
    if (!Number.isInteger(number)) return 'rgba(247,231,182,.4)';
    const color = colorOf(number);
    if (color === 'red') return '#f4908a';
    if (color === 'black') return '#d7dee8';
    return '#86e3ae';
  }

  function updateHub() {
    if (!el.wheel) return;
    const number = el.wheel.querySelector('#hubNumber');
    const caption = el.wheel.querySelector('#hubCaption');
    if (number) {
      number.textContent = hubNumberText();
      number.setAttribute('fill', hubColor(state.hubNumber));
    }
    if (caption) caption.textContent = Number.isInteger(state.hubNumber) ? 'ВЫПАЛО' : 'ROULETTE';
  }

  function drawWheel() {
    if (!el.rotor) return;
    el.rotor.setAttribute('transform', `rotate(${state.wheelAngle.toFixed(3)} ${CX} ${CY})`);
    el.ball.setAttribute('cx', px(state.ballAngle, state.ballRadius).toFixed(2));
    el.ball.setAttribute('cy', py(state.ballAngle, state.ballRadius).toFixed(2));
  }

  function highlightWedge(number) {
    el.wheel.querySelectorAll('.wedge').forEach((node) => {
      node.classList.toggle('win', Number(node.dataset.number) === number);
    });
  }

  // ---------- Стол ----------
  // Сумма в чипе должна влезать в узкую клетку, поэтому крупные ставки
  // сокращаются: 1 000 → «1k», 2 500 → «2,5k».
  function chipAmount(amount) {
    if (amount < 1000) return String(amount);
    const k = amount / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1).replace('.', ',')}k`;
  }

  function cellHTML({ key, label, className, style }) {
    const amount = state.bets[key] || 0;
    const chip = amount
      ? `<span class="cell-chip" title="${numFmt.format(amount)} ₽">${chipAmount(amount)}</span>`
      : '';
    const winning = state.highlight.has(key);
    const losing = state.highlight.size > 0 && amount > 0 && !winning;
    const cls = ['cell', className, winning ? 'is-win' : '', losing ? 'is-lose' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-bet="${key}" style="${style}"
      ${state.spinning ? 'disabled' : ''} aria-label="${label}">`
      + `<span class="cell-num">${label}</span>${chip}</button>`;
  }

  function renderTable() {
    const cells = [];

    cells.push(cellHTML({
      key: 'straight:0',
      label: '0',
      className: 'num green zero',
      style: '',
    }));

    for (let n = 1; n <= 36; n++) {
      const col = 2 + Math.floor((n - 1) / 3);
      const row = 3 - ((n - 1) % 3);
      cells.push(cellHTML({
        key: `straight:${n}`,
        label: String(n),
        className: `num ${colorOf(n)}`,
        style: `grid-column:${col};grid-row:${row}`,
      }));
    }

    for (let k = 1; k <= 3; k++) {
      cells.push(cellHTML({
        key: `column:${k}`,
        label: '2:1',
        className: 'col2',
        style: `grid-column:14;grid-row:${4 - k}`,
      }));
    }

    for (let d = 1; d <= 3; d++) {
      const from = (d - 1) * 12 + 1;
      cells.push(cellHTML({
        key: `dozen:${d}`,
        label: `${from}–${from + 11}`,
        className: 'dozen',
        style: `grid-column:${2 + (d - 1) * 4}/span 4;grid-row:4`,
      }));
    }

    const outside = [
      { key: 'low', label: '1–18', col: 2 },
      { key: 'even', label: 'ЧЁТ', col: 4 },
      { key: 'red', label: 'КРАСНОЕ', col: 6, className: 'red-bet' },
      { key: 'black', label: 'ЧЁРНОЕ', col: 8, className: 'black-bet' },
      { key: 'odd', label: 'НЕЧЁТ', col: 10 },
      { key: 'high', label: '19–36', col: 12 },
    ];
    outside.forEach((bet) => {
      cells.push(cellHTML({
        key: bet.key,
        label: bet.label,
        className: `outside ${bet.className || ''}`,
        style: `grid-column:${bet.col}/span 2;grid-row:5`,
      }));
    });

    el.table.innerHTML = cells.join('');
  }

  // ---------- Интерфейс ----------
  function renderBalance(bump) {
    const balance = Casino.getBalance();
    el.bankroll.textContent = fmt(balance);
    if (bump) {
      const node = document.createElement('span');
      node.className = `delta ${bump > 0 ? 'plus' : 'minus'}`;
      node.textContent = signed(bump);
      el.deltaLayer.appendChild(node);
      setTimeout(() => node.remove(), 1500);
    }
  }

  // Подсказка не мешает ставить: правила разрешают любые комбинации,
  // но о бессмысленных лучше сказать заранее.
  function renderBetHint() {
    if (!el.betHint) return;
    // Во время спина и показа результата подсказка только мешает.
    if (state.spinning || state.settled) {
      el.betHint.hidden = true;
      return;
    }
    const info = analyzeBets();
    let text = '';
    if (info && info.neutral) {
      text = 'Зеркальные ставки уравновешивают друг друга: при любом числе, кроме зеро, '
        + 'вы вернёте ровно ставку, а зеро забирает всё.';
    } else if (info && info.cannotWin) {
      text = `Такая комбинация не может выиграть: максимум вернётся ${fmt(info.max)} `
        + `из ${fmt(info.total)}.`;
    }
    el.betHint.textContent = text;
    el.betHint.hidden = !text;
  }

  function updateUI(bump) {
    const total = totalBet();
    el.betTotal.textContent = fmt(total);
    el.betTotal.classList.toggle('full', total >= maxBet());
    if (el.betLimit) el.betLimit.textContent = `из ${fmt(maxBet())}`;
    renderBetHint();
    const locked = state.spinning || state.settled;
    el.spinBtn.disabled = locked || total < MIN_BET;
    el.undoBtn.disabled = locked || state.stack.length === 0;
    el.clearBtn.disabled = locked || total === 0;
    el.repeatBtn.hidden = locked || !state.lastBets || total > 0;

    el.chips.forEach((chip) => {
      const value = Number(chip.dataset.chip);
      chip.classList.toggle('selected', value === state.chip);
      chip.disabled = locked || Casino.getBalance() < value;
    });

    renderBalance(bump);
    renderTable();
    renderNumbersStrip();
    renderSound();
  }

  function renderSound() {
    const on = Casino.getSound();
    Casino.setSoundIcon(el.soundBtn, on);
  }

  function renderNumbersStrip() {
    if (!el.numbersStrip) return;
    if (!state.numbers.length) {
      el.numbersStrip.innerHTML = '<span class="strip-empty">Здесь появятся последние числа</span>';
      return;
    }
    el.numbersStrip.innerHTML = state.numbers
      .map((n) => `<span class="strip-num ${colorOf(n)}">${n}</span>`)
      .join('');
  }

  // ---------- Ставки ----------
  function placeBet(key, value = state.chip) {
    if (state.spinning || state.settled) return false;
    if (Casino.getBalance() < value) {
      setMessage('Недостаточно фишек для этой ставки', 'lose');
      return false;
    }
    if (totalBet() + value > maxBet()) {
      setMessage(`Максимальная ставка — ${fmt(maxBet())}`, 'lose');
      return false;
    }

    Casino.stake(GAME_ID, value);
    state.bets[key] = (state.bets[key] || 0) + value;
    state.stack.push({ key, value });
    state.highlight.clear();
    Casino.setPending(GAME_ID, totalBet());
    Casino.save();
    sfx('chip');
    setMessage(`Ставка ${fmt(totalBet())} на столе`);
    updateUI(-value);
    return true;
  }

  function refundBets() {
    const total = totalBet();
    if (total > 0) Casino.addBalance(total);
    state.bets = {};
    state.stack = [];
    state.highlight.clear();
    Casino.setPending(GAME_ID, 0);
    Casino.save();
    return total;
  }

  function undoBet() {
    if (state.spinning || state.settled) return;
    const last = state.stack.pop();
    if (!last) return;
    state.bets[last.key] = (state.bets[last.key] || 0) - last.value;
    if (state.bets[last.key] <= 0) delete state.bets[last.key];
    Casino.addBalance(last.value);
    Casino.setPending(GAME_ID, totalBet());
    Casino.save();
    setMessage(totalBet() ? `Ставка ${fmt(totalBet())} на столе` : 'Ставок нет');
    updateUI(last.value);
  }

  function clearBets() {
    if (state.spinning || state.settled) return;
    const refunded = refundBets();
    if (refunded) sfx('chip');
    setMessage('Ставки сняты, фишки вернулись на баланс');
    updateUI(refunded);
  }

  function repeatBets() {
    if (state.spinning || !state.lastBets) return;
    const needed = Object.values(state.lastBets).reduce((s, v) => s + v, 0);
    if (Casino.getBalance() < needed) {
      setMessage('Не хватает фишек, чтобы повторить ставку', 'lose');
      return;
    }
    refundBets();
    Object.entries(state.lastBets).forEach(([key, value]) => placeBet(key, value));
    setMessage(`Ставка ${fmt(totalBet())} повторена`);
    updateUI();
  }

  // ---------- Вращение ----------
  // Длительности вынесены в let: тесты прогоняют спин без ожидания.
  let spinMs = 5600;
  let settleMs = 1400;

  function pickNumber() {
    return WHEEL_ORDER[randomInt(WHEEL_ORDER.length)];
  }

  // Профиль скорости колеса: короткий разгон, затем трение вплоть до остановки.
  // Возвращает долю пройденного пути 0..1 для доли времени 0..1.
  // Кривая строится один раз и нормируется, поэтому колесо останавливается
  // ровно в нужный момент, а не «дотягивается» до него.
  function buildWheelCurve(samples = 240) {
    const table = new Float64Array(samples + 1);
    let acc = 0;
    for (let i = 1; i <= samples; i++) {
      const u = i / samples;
      const ramp = 1 - Math.exp(-u * 22); // раскрутка за первые ~10% времени
      const friction = (1 - u) ** 1.15;   // трение растёт к концу вращения
      acc += ramp * friction;
      table[i] = acc;
    }
    const total = table[samples] || 1;
    for (let i = 0; i <= samples; i++) table[i] /= total;

    return (u) => {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      const pos = u * samples;
      const i = Math.floor(pos);
      const frac = pos - i;
      return table[i] * (1 - frac) + table[i + 1] * frac;
    };
  }

  // Шарик по дорожке тормозит быстрее колеса, но к моменту падения ещё катится.
  const ballCurve = (u) => 1 - (1 - clamp(u, 0, 1)) ** 2.4;

  // Подскоки в кармане и затухающее покачивание, когда шарик устраивается.
  const bounceRadius = (after) => Math.abs(Math.sin(after / 62)) * 5.5 * Math.exp(-after / 130);
  const settleWobble = (after) => Math.sin(after / 55) * 1.5 * Math.exp(-after / 260);

  async function spin() {
    if (state.spinning || state.settled) return;
    const total = totalBet();
    if (total < MIN_BET) {
      setMessage('Сначала поставьте фишки на стол', 'lose');
      return;
    }

    state.spinning = true;
    state.highlight.clear();
    state.lastBets = Object.assign({}, state.bets);
    el.badge.hidden = true;
    highlightWedge(-1);
    setMessage('Колесо крутится…');
    updateUI();
    sfx('spin');

    const number = pickNumber();
    const index = WHEEL_ORDER.indexOf(number);
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Сила броска: от неё зависят и число оборотов, и длительность вращения,
    // поэтому слабый и сильный спин выглядят по-разному.
    const power = Math.random();
    const wheelTurns = 4.5 + power * 7;                          // 4.5–11.5 оборота
    const duration = reduced ? 1 : Math.max(80, spinMs * (0.78 + power * 0.34));
    const landRatio = 0.78 + Math.random() * 0.1;                 // когда шарик падает
    const landTime = duration * landRatio;
    const ballTurns = 7 + Math.round(power * 6);                  // только целое число!

    const wheelFrom = state.wheelAngle;
    const wheelTo = wheelFrom + wheelTurns * 360;
    const wheelCurve = buildWheelCurve();
    const wheelAt = (t) => wheelFrom + (wheelTo - wheelFrom) * wheelCurve(clamp(t / duration, 0, 1));
    const wheelAtLand = wheelAt(landTime);

    // Карман, в котором шарик должен оказаться в момент приземления.
    const landAngle = wheelAtLand + index * SEG;
    const ballFrom = state.ballAngle;
    // Целое число оборотов против часовой стрелки плюс точная поправка на карман.
    const ballTravel = mod(ballFrom - landAngle, 360) + ballTurns * 360;

    state.lastSpin = { duration, wheelTurns, ballTurns, landRatio, number };

    let lastTickAngle = ballFrom;

    const animate = () => new Promise((resolve) => {
      const start = performance.now();

      const frame = (now) => {
        const elapsed = Math.min(Math.max(0, now - start), duration);
        const t = elapsed / duration;

        state.wheelAngle = wheelAt(elapsed);

        if (elapsed < landTime) {
          const v = elapsed / landTime;
          // Лёгкое дрожание на внешней дорожке, к моменту падения сходит на нет.
          const wobble = Math.sin(v * 26) * 0.9 * (1 - v) ** 3;
          state.ballAngle = ballFrom - ballTravel * ballCurve(v) + wobble;
          // Падение в карман: радиус уменьшается с ускорением, как под уклоном.
          const drop = smoothstep(0.76, 1, v);
          state.ballRadius = R_ORBIT + (R_POCKET - R_ORBIT) * drop * drop;
        } else {
          const after = elapsed - landTime;
          // После падения шарик едет вместе с колесом и подпрыгивает в кармане.
          state.ballAngle = landAngle + (state.wheelAngle - wheelAtLand) + settleWobble(after);
          state.ballRadius = R_POCKET + bounceRadius(after);
        }

        // Щелчки по границам секторов — только на замедлении.
        if (t > 0.35) {
          const crossed = Math.floor(Math.abs(state.ballAngle - lastTickAngle) / SEG);
          if (crossed > 0) {
            lastTickAngle = state.ballAngle;
            sfx('tick');
          }
        }

        drawWheel();
        if (elapsed < duration) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });

    await animate();

    // Точная фиксация: шарик ровно в центре выпавшего кармана.
    state.wheelAngle = wheelTo;
    state.ballAngle = wheelTo + index * SEG;
    state.ballRadius = R_POCKET;
    drawWheel();

    await finishSpin(number, total);
  }

  async function finishSpin(number, total) {
    const color = colorOf(number);
    const winKeys = [];
    let payout = 0;

    Object.entries(state.bets).forEach(([key, amount]) => {
      if (betWins(key, number)) {
        winKeys.push(key);
        payout += amount * multiplier(key);
      }
    });

    const baseNet = payout - total;

    // Страховка из целей: при проигрыше возвращает половину потерь.
    let insurance = 0;
    if (baseNet < 0 && Casino.shields() > 0 && Casino.useShield()) {
      insurance = Math.ceil(-baseNet / 2);
    }
    const net = baseNet + insurance;

    // Баланс и статистика
    if (payout > 0) Casino.payout(GAME_ID, payout);
    if (insurance > 0) Casino.payout(GAME_ID, insurance);
    const stats = Casino.stats(GAME_ID);
    stats.spins += 1;
    stats.wagered += total;
    stats.net += net;
    if (net > 0) {
      stats.wins += 1;
      stats.bestWin = Math.max(stats.bestWin, net);
    } else if (net < 0) {
      stats.losses += 1;
    } else {
      stats.pushes += 1;
    }

    state.numbers.unshift(number);
    if (state.numbers.length > 12) state.numbers.length = 12;

    Casino.pushHistory(GAME_ID, {
      ts: Date.now(),
      bet: total,
      net,
      number,
      color,
      bets: Object.assign({}, state.bets),
      wins: winKeys,
      payout: payout + insurance,
      insurance,
      summary: `Выпало ${number} · ${colorLabel(number)}`,
    });
    Casino.setPending(GAME_ID, 0);
    Casino.save();

    // Подсветка выигравших клеток
    state.highlight = new Set(winKeys);
    highlightWedge(number);

    state.hubNumber = number;
    updateHub();

    el.badge.hidden = false;
    el.badge.className = `result-badge ${color}`;
    el.badge.textContent = String(number);
    // перезапуск анимации появления
    el.badge.style.animation = 'none';
    void el.badge.offsetWidth;
    el.badge.style.animation = '';

    let message;
    let messageClass = '';
    if (net > 0) {
      message = `Выпало ${number} — выигрыш ${fmt(net)}`;
      messageClass = 'win';
      sfx('win');
    } else if (net < 0) {
      message = `Выпало ${number} — проигрыш ${fmt(-net)}`;
      if (insurance > 0) message += ` · страховка вернула ${fmt(insurance)}`;
      messageClass = 'lose';
      sfx('lose');
    } else {
      message = `Выпало ${number} — ставка возвращена`;
      messageClass = 'push';
      sfx('push');
    }

    // Достигнутые цели: награда уже на балансе, сообщаем игроку.
    const reached = Casino.checkGoals();
    const goalReward = reached.reduce((sum, goal) => sum + goal.reward, 0);
    if (reached.length) {
      const best = reached[reached.length - 1];
      message += ` · цель ${fmt(best.target)}: +${fmt(goalReward)}, звание «${best.title}»`;
      messageClass = 'win';
    }

    setMessage(message, messageClass);

    // Ставки уже разыграны, но на 1,4 секунды остаются на столе:
    // так видно, какие клетки выиграли.
    state.spinning = false;
    state.settled = true;
    updateUI(net + goalReward);
    renderSpins();

    await sleep(Math.max(1, settleMs));

    state.settled = false;
    state.bets = {};
    state.stack = [];
    state.highlight.clear();
    highlightWedge(-1);
    updateUI();
  }

  // ---------- История спинов ----------
  // Короткая лента на странице и полная — в окне.
  const SPINS_PREVIEW = 6;

  function timeLabel(ts) {
    const d = new Date(Number(ts) || Date.now());
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? time
      : `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${time}`;
  }

  // Один спин: что выпало, что было выбрано (выигравшие ставки — в зелёной рамке)
  // и сколько в итоге вышло.
  function spinRowHTML(entry) {
    const number = Number(entry.number);
    const hasNumber = entry.number !== null && entry.number !== undefined
      && entry.number !== '' && Number.isFinite(number);
    const color = entry.color || (hasNumber ? colorOf(number) : '');
    const bet = Number(entry.bet) || 0;
    const net = Number(entry.net) || 0;
    const payout = Number.isFinite(Number(entry.payout))
      ? Number(entry.payout)
      : Math.max(0, bet + net);
    const sign = net > 0 ? 'plus' : net < 0 ? 'minus' : 'zero';
    const tags = Casino.betTagsHTML(entry.bets, entry.wins);
    const title = hasNumber ? `Выпало ${number} · ${colorLabel(number)}` : 'Спин';

    return `<article class="spin-row ${sign}">
      <span class="spin-num ${color}${hasNumber ? '' : ' empty'}">${hasNumber ? number : '—'}</span>
      <div class="spin-main">
        <div class="spin-head">
          <span class="spin-title">${title}</span>
          <span class="spin-net ${sign}">${signed(net)}</span>
        </div>
        ${tags}
        <div class="spin-foot">
          <span>ставка ${fmt(bet)}</span>
          <span>выплата ${fmt(payout)}</span>
          <time>${timeLabel(entry.ts)}</time>
        </div>
      </div>
    </article>`;
  }

  function renderSpins() {
    if (!el.spinsList) return;
    const list = Casino.history(GAME_ID);
    if (!list.length) {
      el.spinsList.innerHTML = '<p class="spin-empty">Спинов пока нет. Поставьте фишки на стол '
        + 'и нажмите «Крутить» — здесь появится, что вы выбрали, что выпало и сколько выиграли.</p>';
      return;
    }
    el.spinsList.innerHTML = list.slice(0, SPINS_PREVIEW).map(spinRowHTML).join('');
  }

  function openHistory() {
    const list = Casino.history(GAME_ID);
    openModal(`
      <h2>История спинов</h2>
      ${list.length
        ? `<div class="spins-list spin-history-full">${list.map(spinRowHTML).join('')}</div>`
        : '<p class="spin-empty">Спинов пока нет.</p>'}
      <div class="modal-actions">
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  // ---------- События ----------
  el.table.addEventListener('click', (event) => {
    const cell = event.target.closest('[data-bet]');
    if (!cell || state.spinning || state.settled) return;
    placeBet(cell.dataset.bet);
  });

  el.chipsRow.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip || chip.disabled) return;
    state.chip = Number(chip.dataset.chip);
    sfx('chip');
    updateUI();
  });

  el.spinBtn.addEventListener('click', spin);
  el.undoBtn.addEventListener('click', undoBet);
  el.clearBtn.addEventListener('click', clearBets);
  el.repeatBtn.addEventListener('click', repeatBets);

  el.soundBtn.addEventListener('click', () => {
    Casino.setSound(!Casino.getSound());
    Casino.save();
    state.sound = Casino.getSound();
    renderSound();
    if (state.sound) sfx('chip');
  });

  document.addEventListener('keydown', (event) => {
    // Casino.keyOf смотрит на физическую клавишу, поэтому русская
    // раскладка не ломает Space, C и H.
    const key = Casino.keyOf(event);
    if (!el.overlay.hidden) {
      if (key === 'escape') closeModal();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (key === ' ' || key === 'enter') {
      event.preventDefault();
      if (!el.spinBtn.disabled) spin();
    } else if (key === 'c') {
      if (!el.clearBtn.disabled) clearBets();
    } else if (key === 'u' || key === 'z') {
      if (!el.undoBtn.disabled) undoBet();
    } else if (key === 'h') {
      openHistory();
    }
  });

  // ---------- Окна ----------
  let lastFocused = null;

  function openModal(html) {
    lastFocused = document.activeElement;
    el.modalBody.innerHTML = html;
    el.overlay.hidden = false;
    el.modalClose.focus({ preventScroll: true });
    el.modalBody.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
    const reset = el.modalBody.querySelector('[data-action="reset"]');
    if (reset) {
      reset.addEventListener('click', () => {
        Casino.resetGame(GAME_ID);
        state.numbers = [];
        Casino.save();
        closeModal();
        updateUI();
        renderSpins();
        setMessage('Статистика рулетки сброшена');
      });
    }
  }

  function closeModal() {
    el.overlay.hidden = true;
    el.modalBody.innerHTML = '';
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus({ preventScroll: true });
  }

  el.modalClose.addEventListener('click', closeModal);
  el.overlay.addEventListener('click', (event) => {
    if (event.target === el.overlay) closeModal();
  });

  function openRules() {
    openModal(`
      <h2>Правила рулетки</h2>
      <p>Европейское колесо: <span class="accent">37 секторов</span> — числа от 0 до 36.
      Ноль зелёный и играет против всех внешних ставок.</p>

      <h3>Ставки и выплаты</h3>
      <ul>
        <li><span class="accent">Число</span> (включая 0) — 35 : 1.</li>
        <li><span class="accent">Красное / чёрное</span>, <span class="accent">чёт / нечет</span>,
        <span class="accent">1–18 / 19–36</span> — 1 : 1.</li>
        <li><span class="accent">Дюжины</span> (1–12, 13–24, 25–36) и <span class="accent">колонки</span> — 2 : 1.</li>
      </ul>

      <h3>Как играть</h3>
      <ul>
        <li>Выберите номинал фишки и кликайте по клеткам стола.</li>
        <li>Можно ставить на несколько клеток сразу — сумма на столе показана сверху.</li>
        <li>«Отменить» убирает последнюю фишку, «Очистить» возвращает все.</li>
        <li>Нажмите «Крутить» (или <kbd>Space</kbd>) — колесо остановится на выпавшем числе.</li>
        <li>После спина можно нажать «Повторить», чтобы вернуть те же ставки.</li>
        <li>Под столом — история спинов: что выпало, какие ставки были и что выиграло
        (выигравшие обведены зелёным). Клавиша <kbd>H</kbd> открывает всю историю.</li>
      </ul>

      <h3>Лимиты и комбинации</h3>
      <ul>
        <li>Минимальная ставка — 25 ₽, максимум на один спин — ${fmt(maxBet())}
        в сумме по всем клеткам (лимит стола).</li>
        <li>Правила рулетки не запрещают ставить на любые клетки в любом сочетании:
        можно накрыть несколько чисел, красное и чёт, дюжину и колонку — всё сразу.</li>
        <li>Но «зеркальные» ставки (красное + чёрное, чёт + нечет, 1–18 + 19–36)
        выиграть не могут: при любом числе, кроме зеро, вы вернёте ровно поставленное,
        а зеро забирает всё.</li>
        <li>Если накрыть все 37 чисел по 25 ₽ — это 925 ₽ ставки и 900 ₽ выплаты,
        то есть минус 25 ₽ при любом исходе. Стол предупредит о таких комбинациях.</li>
      </ul>

      <h3>Про баланс</h3>
      <p>Баланс общий для всего казино, а статистика и история — отдельные по каждой игре.</p>
      <p>Лимит <b>${fmt(maxBet())}</b> действует на <b>один спин</b>, а не на вечер.
      Бесплатный бонус на главной странице можно забирать раз в 30 минут — сколько угодно
      раз за вечер, поэтому суммарно можно проиграть заметно больше: как в казино, где
      лимит стола ограничивает одну ставку, а не все ставки за ночь.</p>

      <h3>Бонус и цели</h3>
      <ul>
        <li>Бесплатные <span class="accent">+1 000 ₽</span> — раз в 30 минут, на главной странице.</li>
        <li>Цели считаются по чистому выигрышу за всё время. За каждую: деньги,
        звание, страховка и <span class="accent">+1 000 ₽</span> к лимиту стола.</li>
        <li>Страховка при проигрыше возвращает половину потерь и тратится автоматически.</li>
      </ul>

      <div class="modal-actions">
        <button class="primary-btn" data-close>Понятно</button>
      </div>
    `);
  }

  function openStats() {
    const s = Casino.stats(GAME_ID);
    const spinCount = s.spins || 0;
    const winRate = s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 100) : 0;

    openModal(`
      <h2>Статистика рулетки</h2>
      <div class="stat-grid">
        <span>Спинов</span><span>${numFmt.format(spinCount)}</span>
        <span>Побед</span><span>${numFmt.format(s.wins)}</span>
        <span>Поражений</span><span>${numFmt.format(s.losses)}</span>
        <span>Ничьих</span><span>${numFmt.format(s.pushes)}</span>
        <span>Доля побед</span><span>${winRate}%</span>
        <span>Оборот ставок</span><span>${fmt(s.wagered)}</span>
        <span>Лучший спин</span><span>${fmt(s.bestWin)}</span>
        <span>Итог игры</span><span>${signed(s.net)}</span>
        <span>Общий баланс</span><span>${fmt(Casino.getBalance())}</span>
      </div>
      <p style="margin-top:14px;font-size:12px;color:var(--muted)">
        Статистика блэкджека считается отдельно — она в игре «21».
      </p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="reset">Сбросить рулетку</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  el.rulesBtn.addEventListener('click', openRules);
  el.statsBtn.addEventListener('click', openStats);
  el.historyBtn.addEventListener('click', openHistory);
  el.historyTopBtn.addEventListener('click', openHistory);

  // ---------- Тестовый хук ----------
  window.__RL_TEST__ = {
    state,
    WHEEL_ORDER,
    RED,
    SEG,
    R_POCKET,
    R_ORBIT,
    colorOf,
    colorLabel,
    betWins,
    multiplier,
    totalBet,
    placeBet,
    clearBets,
    undoBet,
    spin,
    buildWheel,
    renderSpins,
    analyzeBets,
    payoutFor,
    chipAmount,
    spinRowHTML,
    setTiming({ spin: nextSpin, settle: nextSettle } = {}) {
      if (Number.isFinite(nextSpin)) spinMs = nextSpin;
      if (Number.isFinite(nextSettle)) settleMs = nextSettle;
    },
    /** Подменяет генератор случайных чисел, чтобы выпало нужное число. */
    forceNumber(number) {
      const index = WHEEL_ORDER.indexOf(number);
      if (index < 0) throw new Error(`Нет числа ${number} на колесе`);
      window.crypto.getRandomValues = (array) => {
        array[0] = index;
        return array;
      };
      return index;
    },
  };

  // ---------- Старт ----------
  // Ставки, «зависшие» в незавершённом спине, возвращаются на баланс.
  Casino.settlePending(GAME_ID);
  state.sound = Casino.getSound();

  const lastNumbers = Casino.history(GAME_ID)
    .slice(0, 12)
    .map((entry) => Number(entry.number))
    .filter((n) => Number.isFinite(n));
  state.numbers = lastNumbers;
  // После перезагрузки в центре колеса — последнее число из истории,
  // а не случайное и не всегдашняя «21».
  state.hubNumber = lastNumbers.length ? lastNumbers[0] : null;

  buildWheel();
  drawWheel();

  updateUI();
  renderSpins();
  setMessage('Выберите фишку и поставьте на стол');

  if (Casino.getBalance() < MIN_BET) {
    setMessage('Баланс пуст — пополните его на главной странице', 'lose');
  }
})();
