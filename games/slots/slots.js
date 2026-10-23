/* ============================================================
   Слоты Fakrap: три барабана, пять линий
   Ставка делится на пять линий, каждая линия платит по таблице.
   Золотая фишка заменяет любой символ. Возврат — около 94%.
   ============================================================ */
(() => {
  'use strict';

  const Casino = window.Casino;
  const $ = (sel) => document.querySelector(sel);
  const GAME_ID = 'slots';

  // Закрытая игра не запускается: прямо по адресу тоже стоит замок.
  if (!Casino.isUnlocked(GAME_ID)) {
    Casino.showLocked(GAME_ID);
    return;
  }

  // ---------- Символы ----------
  // Рисуем SVG-путями: никаких эмодзи, чтобы вид не зависел от системы.
  const SYMBOLS = {
    seven: { name: 'Семёрка', pay: 140 },
    diamond: { name: 'Алмаз', pay: 40 },
    star: { name: 'Звезда', pay: 19 },
    bell: { name: 'Колокол', pay: 14 },
    lemon: { name: 'Лимон', pay: 9 },
    cherry: { name: 'Вишня', pay: 6 },
    wild: { name: 'Фишка', pay: 280 },
  };

  const ICONS = {
    cherry: `<svg class="sym" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M29 33c-2-8-8-14-16-16" fill="none" stroke="#6f9b3e" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M37 32c2-8 9-13 17-14" fill="none" stroke="#6f9b3e" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M33 22c-1-4 1-8 4-10 2 4 1 8-1 10z" fill="#7fb148"/>
      <circle cx="20" cy="45" r="11.5" fill="#cf2440"/>
      <circle cx="42" cy="48" r="11.5" fill="#ef3d57"/>
      <circle cx="16.6" cy="41" r="3.6" fill="#fff" opacity=".5"/>
      <circle cx="38.6" cy="44" r="3.6" fill="#fff" opacity=".5"/>
    </svg>`,
    lemon: `<svg class="sym" viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="35" rx="21" ry="15" fill="#e9b91f" transform="rotate(-16 32 35)"/>
      <ellipse cx="30" cy="33" rx="18" ry="11" fill="#f7d64a" transform="rotate(-16 30 33)"/>
      <ellipse cx="24" cy="28" rx="6" ry="3.4" fill="#fff6c4" opacity=".8" transform="rotate(-16 24 28)"/>
      <path d="M48 20c-5-4-12-4-17 0 6 4 12 4 17 0z" fill="#6f9b3e"/>
      <path d="M31 21c1-5 4-8 8-9" fill="none" stroke="#8a6a2a" stroke-width="2.6" stroke-linecap="round"/>
    </svg>`,
    bell: `<svg class="sym" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 9c-9 0-15 7-15 17 0 8-3 12-6 15h42c-3-3-6-7-6-15 0-10-6-17-15-17z" fill="#d9a83c"/>
      <path d="M32 11c-7 0-12 6-12 15 0 7-2 11-5 13h34c-3-2-5-6-5-13 0-9-5-15-12-15z" fill="#f2cd6b"/>
      <path d="M24 21c1-5 4-8 8-8" fill="none" stroke="#fff2bd" stroke-width="2.6" stroke-linecap="round" opacity=".8"/>
      <rect x="13" y="41" width="38" height="7" rx="3.5" fill="#b8862f"/>
      <circle cx="32" cy="54" r="5.5" fill="#b8862f"/>
      <circle cx="32" cy="53" r="3" fill="#f2cd6b"/>
    </svg>`,
    star: `<svg class="sym" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 6l7.6 16.4L57 25l-12.4 12 3 17.6L32 46.4 16.4 54.6l3-17.6L7 25l17.4-2.6z"
        fill="#f4c73f" stroke="#b8862f" stroke-width="2" stroke-linejoin="round"/>
      <path d="M32 13l5 11 11.5 1.7-8.2 8 1.9 11.6L32 39.8 21.8 45.3l1.9-11.6-8.2-8L27 24z"
        fill="#ffe083"/>
    </svg>`,
    diamond: `<svg class="sym" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 57L9 26h46z" fill="#2a8fc4"/>
      <path d="M32 57L9 26h23z" fill="#43b3e2"/>
      <path d="M9 26L20 9h24l11 17z" fill="#8fe0f7"/>
      <path d="M20 9l-11 17h23z" fill="#c9f2ff"/>
      <path d="M32 26l12-17 11 17z" fill="#a8ebff"/>
      <path d="M32 26L20 9l-11 17z" fill="#dff8ff"/>
      <path d="M32 26v31L9 26z" fill="#5ec8ee" opacity=".55"/>
      <path d="M32 26v31l23-31z" fill="#1f7aa8" opacity=".45"/>
      <path d="M32 26L20 9h24z" fill="#eafcff" opacity=".6"/>
    </svg>`,
    seven: `<svg class="sym" viewBox="0 0 64 64" aria-hidden="true">
      <text x="33.5" y="47.5" text-anchor="middle" font-family="Georgia, 'DejaVu Serif', serif"
        font-size="46" font-weight="700" fill="#5a3d0d">7</text>
      <text x="32" y="46" text-anchor="middle" font-family="Georgia, 'DejaVu Serif', serif"
        font-size="46" font-weight="700" fill="#ffde7a">7</text>
      <text x="32" y="46" text-anchor="middle" font-family="Georgia, 'DejaVu Serif', serif"
        font-size="46" font-weight="700" fill="#fff3c4" opacity=".45"
        style="clip-path: inset(0 0 55% 0)">7</text>
    </svg>`,
    wild: `<svg class="sym" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="26" fill="#a97f28"/>
      <circle cx="32" cy="32" r="26" fill="none" stroke="#ffe9ae" stroke-width="2"/>
      <circle cx="32" cy="32" r="20" fill="none" stroke="#fff3c4" stroke-width="3" stroke-dasharray="3 5"/>
      <circle cx="32" cy="32" r="15" fill="#12301f"/>
      <text x="32" y="40" text-anchor="middle" font-family="Georgia, serif"
        font-size="19" font-weight="700" fill="#f6df9a">F</text>
    </svg>`,
  };

  // ---------- Лента барабана ----------
  // 40 ячеек. Частоты: вишня 10, лимон 9, колокол 7, звезда 6,
  // алмаз 4, семёрка 2, фишка 2. Возврат при такой ленте — 94,21%.
  const STRIP = [
    'star', 'lemon', 'star', 'star', 'wild', 'bell', 'diamond', 'lemon', 'cherry', 'wild',
    'bell', 'star', 'diamond', 'lemon', 'cherry', 'bell', 'cherry', 'cherry', 'bell', 'lemon',
    'lemon', 'cherry', 'lemon', 'cherry', 'bell', 'bell', 'lemon', 'bell', 'seven', 'diamond',
    'seven', 'cherry', 'cherry', 'diamond', 'lemon', 'star', 'cherry', 'lemon', 'cherry', 'star',
  ];

  const LINES = [
    { id: 1, name: 'середина', short: 'центр', rows: [1, 1, 1] },
    { id: 2, name: 'верх', short: 'верх', rows: [0, 0, 0] },
    { id: 3, name: 'низ', short: 'низ', rows: [2, 2, 2] },
    { id: 4, name: 'диагональ ↘', short: '↘', rows: [0, 1, 2] },
    { id: 5, name: 'диагональ ↗', short: '↗', rows: [2, 1, 0] },
  ];

  const BET_STEPS = [25, 100, 250, 500, 1000, 2500];
  const MIN_BET = 25;
  const MAX_BET = 2500;
  const HISTORY_SHOWN = 12;

  // ---------- Элементы ----------
  const el = {
    bankroll: $('#bankroll'),
    deltaLayer: $('#deltaLayer'),
    reels: $('#reels'),
    winBadge: $('#winBadge'),
    lineBar: $('#lineBar'),
    message: $('#message'),
    spinBtn: $('#spinBtn'),
    maxBetBtn: $('#maxBetBtn'),
    chipsRow: $('#chipsRow'),
    betTotal: $('#betTotal'),
    betLimit: $('#betLimit'),
    betHint: $('#betHint'),
    paytable: $('#paytable'),
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

  const numFmt = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => `${numFmt.format(Math.round(n))}\u00A0₽`;
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

  // ---------- Состояние ----------
  const state = {
    bet: MIN_BET,
    spinning: false,
    grid: null,
    lastGrid: null,
    lastWins: [],
  };

  // Анимации подменяются в тестах, чтобы не ждать секунды.
  let timing = { reel: 780, gap: 240, settle: 90 };
  const setTiming = (next) => {
    timing = Object.assign({}, timing, next);
  };

  let rng = Math.random;
  const setRng = (fn) => {
    rng = typeof fn === 'function' ? fn : Math.random;
  };

  // ---------- Правила: лента, линии, выплаты ----------
  const reelAt = (stop, row) => STRIP[((stop % STRIP.length) + STRIP.length + row) % STRIP.length];

  const gridFromStops = (stops) => stops.map((stop) => [0, 1, 2].map((row) => reelAt(stop, row)));

  const drawStops = () => [0, 1, 2].map(() => Math.floor(rng() * STRIP.length));

  /** Какая выплата у линии: все три символа совпали (фишка — джокер). */
  function lineResult(cells) {
    const wilds = cells.filter((cell) => cell === 'wild').length;
    if (wilds === 3) return { sym: 'wild', mult: SYMBOLS.wild.pay };
    const rest = cells.filter((cell) => cell !== 'wild');
    if (rest.length && rest.every((cell) => cell === rest[0])) {
      return { sym: rest[0], mult: SYMBOLS[rest[0]].pay };
    }
    return null;
  }

  /** Все выигрыши сетки: линии, символы, выплаты в деньгах. */
  function evaluate(grid, lineBet) {
    const wins = [];
    let payout = 0;
    LINES.forEach((line) => {
      const cells = line.rows.map((row, reel) => grid[reel][row]);
      const hit = lineResult(cells);
      if (!hit) return;
      const amount = Math.round(hit.mult * lineBet);
      payout += amount;
      wins.push({
        line,
        sym: hit.sym,
        mult: hit.mult,
        amount,
        cells: line.rows.map((row, reel) => ({ reel, row })),
      });
    });
    return { wins, payout };
  }

  function drawResult() {
    const stops = drawStops();
    const grid = gridFromStops(stops);
    return { stops, grid };
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
      case 'spin':
        beep({ freq: 180, dur: 0.5, type: 'sawtooth', gain: 0.014, slide: 240 });
        break;
      case 'stop':
        beep({ freq: 320, dur: 0.06, type: 'square', gain: 0.02, slide: -90 });
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

  // ---------- Отрисовка барабанов ----------
  function cellHTML(sym) {
    return `<div class="reel-cell" data-sym="${sym}">${ICONS[sym]}</div>`;
  }

  function buildReels(grid) {
    if (!el.reels) return;
    el.reels.innerHTML = grid.map((column) => `
      <div class="reel"><div class="reel-strip">${column.map(cellHTML).join('')}</div></div>
    `).join('');
  }

  function cellHeight() {
    const cell = el.reels && el.reels.querySelector('.reel-cell');
    return cell ? cell.getBoundingClientRect().height || 96 : 96;
  }

  /** Наполняет барабан случайными ячейками, последние три — итог. */
  function fillStrip(strip, column, filler) {
    const cells = [];
    for (let i = 0; i < filler; i += 1) cells.push(STRIP[Math.floor(rng() * STRIP.length)]);
    strip.innerHTML = cells.concat(column).map(cellHTML).join('');
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
    return cells.length;
  }

  function spinReel(reel, column, index) {
    const strip = reel.querySelector('.reel-strip');
    // 11 случайных ячеек над итогом: лента успевает «прокрутиться».
    const filler = 11;
    fillStrip(strip, column, filler);
    const height = cellHeight();
    const duration = timing.reel + index * timing.gap;
    // Принудительный пересчёт стилей: без него браузер склеит
    // начальное и конечное состояния и анимации не будет.
    void strip.offsetHeight;
    strip.style.transition = `transform ${duration}ms cubic-bezier(.16, .72, .24, 1)`;
    strip.style.transform = `translateY(-${filler * height}px)`;
    return new Promise((resolve) => {
      setTimeout(() => {
        strip.style.transition = 'none';
        strip.innerHTML = column.map(cellHTML).join('');
        strip.style.transform = 'translateY(0)';
        sfx('stop');
        resolve();
      }, duration + timing.settle);
    });
  }

  async function animateSpin(grid) {
    if (!el.reels) return;
    // Барабаны уже стоят на экране — просто наполняем ленты заново,
    // без пересборки, иначе мелькала бы стартовая картинка.
    const reels = [...el.reels.querySelectorAll('.reel')];
    // Снова собираем, но с настоящей лентой итоговых символов.
    const jobs = reels.map((reel, index) => spinReel(reel, grid[index], index));
    await Promise.all(jobs);
  }

  // ---------- Подсветка ----------
  function highlight(wins) {
    if (!el.reels) return;
    el.reels.querySelectorAll('.reel-cell.win').forEach((cell) => cell.classList.remove('win'));
    const activeLines = new Set();
    (wins || []).forEach((win) => {
      activeLines.add(win.line.id);
      win.cells.forEach(({ reel, row }) => {
        const column = el.reels.querySelectorAll('.reel')[reel];
        if (!column) return;
        const cell = column.querySelectorAll('.reel-cell')[row];
        if (cell) cell.classList.add('win');
      });
    });
    el.lineBar.querySelectorAll('.line-chip').forEach((chip) => {
      chip.classList.toggle('active', activeLines.has(Number(chip.dataset.line)));
    });

    if (el.winBadge) {
      const total = (wins || []).reduce((sum, win) => sum + win.amount, 0);
      el.winBadge.hidden = total <= 0;
      el.winBadge.textContent = total > 0 ? `+${fmt(total)}` : '';
    }
  }

  // ---------- Интерфейс ----------
  function renderLineBar() {
    if (!el.lineBar) return;
    el.lineBar.innerHTML = LINES.map((line) => `
      <span class="line-chip" data-line="${line.id}" title="Линия ${line.id}: ${line.name}">
        <b>${line.id}</b>${line.short}
      </span>
    `).join('');
  }

  function renderPaytable() {
    if (!el.paytable) return;
    const order = ['seven', 'diamond', 'star', 'bell', 'lemon', 'cherry', 'wild'];
    el.paytable.innerHTML = order.map((id) => `
      <div class="pay-row ${id === 'wild' ? 'is-wild' : ''}">
        ${ICONS[id]}
        <span>${SYMBOLS[id].name} ×3${id === 'wild' ? ' · вместо любого' : ''}</span>
        <b>×${SYMBOLS[id].pay}</b>
      </div>
    `).join('');
  }

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
    el.chipsRow.querySelectorAll('[data-chip]').forEach((chip) => {
      chip.classList.toggle('on', Number(chip.dataset.chip) === state.bet);
    });
    const short = Casino.getBalance() < state.bet;
    if (el.betHint) {
      el.betHint.hidden = !short;
      el.betHint.textContent = short
        ? 'На балансе меньше ставки — уменьшите ставку или заберите бонус на главной.'
        : '';
    }
    if (el.spinBtn) {
      el.spinBtn.disabled = state.spinning || short;
      el.spinBtn.textContent = state.spinning ? 'Крутится…' : 'Крутить';
    }
  }

  function setBet(value) {
    if (state.spinning) return;
    const next = Math.max(MIN_BET, Math.min(MAX_BET, Math.round(value / 5) * 5));
    state.bet = next;
    sfx('chip');
    updateUI();
    setMessage(`Ставка ${fmt(state.bet)} · ${fmt(state.bet / LINES.length)} на линию`);
  }

  // ---------- История спинов ----------

  function spinCardHTML(entry) {
    const net = Number(entry.net) || 0;
    const cls = net > 0 ? 'win' : net < 0 ? 'lose' : '';
    const grid = entry.grid || [];
    const hitCells = new Set();
    (entry.wins || []).forEach((win) => {
      const line = LINES.find((l) => l.id === win.line);
      if (!line) return;
      line.rows.forEach((row, reel) => hitCells.add(`${reel}:${row}`));
    });
    const mini = [0, 1, 2].map((row) => grid.map((column, reel) => {
      const sym = column && column[row];
      if (!sym || !ICONS[sym]) return '';
      const hit = hitCells.has(`${reel}:${row}`) ? ' hit' : '';
      return `<span class="mini-sym${hit}">${ICONS[sym]}</span>`;
    }).join('')).join('');
    return `
      <article class="spin-card ${cls}">
        <div class="spin-grid" aria-hidden="true">${mini}</div>
        <div class="spin-text">
          <b class="${net > 0 ? 'plus' : net < 0 ? 'minus' : ''}">${net === 0 ? 'без выигрыша' : signed(net)}</b>
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
      : '<p class="roll-empty">Спинов пока нет. Выберите ставку и нажмите «Крутить».</p>';
  }

  // ---------- Вращение ----------
  function makeResult(grid) {
    return { stops: null, grid };
  }

  async function spin(forcedGrid) {
    if (state.spinning) return null;
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

    state.spinning = true;
    highlight([]);
    Casino.stake(GAME_ID, bet);
    Casino.setPending(GAME_ID, bet);
    Casino.save();
    updateUI();
    setMessage('Барабаны крутятся…');
    sfx('spin');

    const result = forcedGrid ? makeResult(forcedGrid) : drawResult();
    await animateSpin(result.grid);
    return finishSpin(result.grid, bet);
  }

  function finishSpin(grid, bet) {
    const lineBet = bet / LINES.length;
    const { wins, payout } = evaluate(grid, lineBet);
    const baseNet = payout - bet;

    // Страховка из целей: при проигрыше возвращает половину потерь.
    let insurance = 0;
    if (baseNet < 0 && Casino.shields() > 0 && Casino.useShield()) {
      insurance = Math.ceil(-baseNet / 2);
    }
    const net = baseNet + insurance;

    if (payout > 0) Casino.payout(GAME_ID, payout);
    if (insurance > 0) Casino.payout(GAME_ID, insurance);

    const stats = Casino.stats(GAME_ID);
    stats.spins += 1;
    stats.wagered += bet;
    stats.net += net;
    stats.lines += wins.length;
    if (net > 0) {
      stats.wins += 1;
      stats.bestWin = Math.max(stats.bestWin, net);
    } else if (net < 0) {
      stats.losses += 1;
    } else {
      stats.pushes += 1;
    }

    const summary = wins.length
      ? wins.map((win) => `Линия ${win.line.id} (${win.line.name}): ${SYMBOLS[win.sym].name.toLowerCase()} ×${win.mult}`).join(' · ')
      : 'Совпадений нет';

    Casino.pushHistory(GAME_ID, {
      ts: Date.now(),
      bet,
      net,
      payout: payout + insurance,
      insurance,
      grid,
      wins: wins.map((win) => ({ line: win.line.id, sym: win.sym, mult: win.mult })),
      summary,
    });
    Casino.setPending(GAME_ID, 0);
    Casino.save();

    state.spinning = false;
    state.lastGrid = grid;
    state.lastWins = wins;

    renderBalance(net);
    updateUI();
    highlight(wins);
    renderSpins();

    if (payout > 0) {
      const jackpot = wins.some((win) => win.sym === 'seven' || win.sym === 'wild');
      sfx(jackpot ? 'jackpot' : 'win');
      setMessage(
        `${summary}. Выплата ${fmt(payout)}${insurance ? ` · страховка вернула ${fmt(insurance)}` : ''} · чистыми ${signed(net)}`,
        'win',
      );
    } else if (insurance > 0) {
      sfx('win');
      setMessage(`Совпадений нет, но страховка вернула ${fmt(insurance)} · чистыми ${signed(net)}`, 'info');
    } else {
      sfx('lose');
      setMessage(`Совпадений нет — ставка ${fmt(bet)} ушла в кассу`, 'lose');
    }

    return { grid, wins, payout, net, insurance, bet };
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
        highlight([]);
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
      <h2>Правила слотов</h2>
      <p>На барабанах три ряда и три столбца, выигрышных линий — пять: три
        горизонтальные и две диагональные. Ставка за спин делится на пять линий,
        каждая линия платит свой множитель.</p>
      <h3>Как считается выигрыш</h3>
      <ul>
        <li>Линия выигрывает, если на всех трёх барабанах стоит один и тот же символ.</li>
        <li>Золотая фишка заменяет любой символ; три фишки — самый дорогой символ.</li>
        <li>Выплата линии: множитель × ставка на линию.</li>
        <li>Если выиграли несколько линий, выплаты складываются.</li>
      </ul>
      <h3>Таблица выплат</h3>
      <ul>
        ${['seven', 'diamond', 'star', 'bell', 'lemon', 'cherry', 'wild'].map((id) => `<li>${SYMBOLS[id].name} — ×${SYMBOLS[id].pay}</li>`).join('')}
      </ul>
      <h3>Страховка</h3>
      <p>Страховки приходят за цели. Если спин ушёл в минус, страховка
        срабатывает сама и возвращает половину потерь. На выигрыш она не
        тратится, сгорает не больше одной за спин.</p>
      <div class="modal-actions"><button class="primary-btn" data-close>Понятно</button></div>
    `);
  }

  function openStats() {
    const s = Casino.stats(GAME_ID);
    const decided = s.wins + s.losses;
    const winRate = decided > 0 ? Math.round((s.wins / decided) * 100) : 0;
    const rtp = s.wagered > 0 ? Math.round(((s.wagered + s.net) / s.wagered) * 1000) / 10 : 0;
    openModal(`
      <h2>Статистика слотов</h2>
      <div class="stat-grid">
        <span>Спинов</span><span>${numFmt.format(s.spins)}</span>
        <span>Побед</span><span>${numFmt.format(s.wins)}</span>
        <span>Поражений</span><span>${numFmt.format(s.losses)}</span>
        <span>Ничьих</span><span>${numFmt.format(s.pushes)}</span>
        <span>Выигрышных линий</span><span>${numFmt.format(s.lines)}</span>
        <span>Доля побед</span><span>${winRate}%</span>
        <span>Оборот ставок</span><span>${fmt(s.wagered)}</span>
        <span>Фактический возврат</span><span>${s.wagered > 0 ? `${rtp}%` : '—'}</span>
        <span>Лучший спин</span><span>${fmt(s.bestWin)}</span>
        <span>Итог игры</span><span>${signed(s.net)}</span>
        <span>Общий баланс</span><span>${fmt(Casino.getBalance())}</span>
      </div>
      <p class="goals-note">Статистика других игр считается отдельно — она в их собственных окнах.</p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="reset">Сбросить слоты</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  function openHistory() {
    const list = Casino.history(GAME_ID);
    openModal(`
      <h2>История спинов</h2>
      ${list.length
        ? `<div class="rolls-list rolls-history-full">${list.map(spinCardHTML).join('')}</div>`
        : '<p class="roll-empty">Спинов пока нет.</p>'}
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

  if (el.spinBtn) el.spinBtn.addEventListener('click', () => { spin(); });

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
      spin();
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
  renderLineBar();
  renderPaytable();
  Casino.setSoundIcon(el.soundBtn, Casino.getSound());
  state.grid = drawResult().grid;
  buildReels(state.grid);
  renderSpins();
  updateUI();
  setMessage('Выберите ставку и крутите барабаны');

  // ---------- Тестовый хук ----------
  window.__SLOTS_TEST__ = {
    SYMBOLS, STRIP, LINES, MIN_BET, MAX_BET,
    state,
    evaluate,
    lineResult,
    gridFromStops,
    reelAt,
    drawResult,
    drawStops,
    setRng,
    setTiming,
    spin,
    finishSpin,
    buildReels,
    updateUI,
    renderSpins,
    setBet,
    highlight,
  };
})();
