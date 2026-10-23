/* ============================================================
   Сапёр: поле 5×5, мины и растущий множитель
   Вероятность пройти k клеток без мины — C(25−m, k) / C(25, k).
   Множитель = 0,945 × обратная вероятность, поэтому возврат
   не выше 94,5% при любой стратегии игрока.
   ============================================================ */
(() => {
  'use strict';

  const Casino = window.Casino;
  const $ = (sel) => document.querySelector(sel);
  const GAME_ID = 'mines';

  // Закрытая игра не запускается: прямо по адресу тоже стоит замок.
  if (!Casino.isUnlocked(GAME_ID)) {
    Casino.showLocked(GAME_ID);
    return;
  }

  const SIZE = 5;
  const CELLS = SIZE * SIZE;      // 25
  const MINES_OPTIONS = [2, 3, 5];
  const RTP = 0.945;
  const DEFAULT_MINES = 3;

  const BET_STEPS = [25, 100, 250, 500, 1000, 2500];
  const MIN_BET = 25;
  // Лимит стола растёт с закрытыми целями — как в остальных играх.
  const maxBet = () => Casino.maxBet();
  const HISTORY_SHOWN = 12;

  const el = {
    bankroll: $('#bankroll'),
    deltaLayer: $('#deltaLayer'),
    board: $('#minesBoard'),
    currentMult: $('#currentMult'),
    minesLeft: $('#minesLeft'),
    playBtn: $('#playBtn'),
    maxBetBtn: $('#maxBetBtn'),
    message: $('#message'),
    chipsRow: $('#chipsRow'),
    betTotal: $('#betTotal'),
    betLimit: $('#betLimit'),
    betHint: $('#betHint'),
    mineOptions: $('#mineOptions'),
    nextMult: $('#nextMult'),
    cashoutValue: $('#cashoutValue'),
    roundsList: $('#roundsList'),
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
  const multLabel = (m) => `×${m.toFixed(2).replace('.', ',')}`;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // ---------- Математика ----------
  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    let result = 1;
    for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
    return Math.round(result);
  }

  /** Во сколько раз честная выплата больше ставки после k открытых клеток. */
  const fairMult = (mines, k) => comb(CELLS, k) / comb(CELLS - mines, k);

  /** Множитель с запасом казино: округляем вниз до копеек. */
  function multFor(mines, k) {
    if (k <= 0) return 1;
    return Math.max(1, Math.floor(RTP * fairMult(mines, k) * 100) / 100);
  }

  const maxPicks = (mines) => CELLS - mines;

  // ---------- Состояние ----------
  const state = {
    bet: MIN_BET,
    mines: DEFAULT_MINES,
    phase: 'idle',      // idle | playing
    layout: [],         // индексы мин
    opened: [],         // открытые игроком клетки
    picks: 0,
    mult: 1,
    lastMult: null,
    lastHit: null,
    revealed: false,
  };

  let rng = Math.random;
  const setRng = (fn) => { rng = typeof fn === 'function' ? fn : Math.random; };

  const shuffle = (list) => {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  };

  const placeMines = (count) => shuffle(Array.from({ length: CELLS }, (_, i) => i)).slice(0, count);

  // ---------- Иконки ----------
  const ICON_BASE = '../../shared/brand/icons/';
  const icon = (name) => `<img class="cell-icon" src="${ICON_BASE}${name}.png" alt="" draggable="false">`;
  const COIN_PNG = icon('chip-f');
  const MINE_PNG = icon('bomb');
  const MINE_HIT_PNG = icon('bomb-hit');

  // Греем кеш, чтобы первая открытая клетка не мигала пустотой.
  ['chip-f', 'bomb', 'bomb-hit'].forEach((name) => {
    const img = new Image();
    img.src = `${ICON_BASE}${name}.png`;
  });

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

  function cellLabel(index) {
    return `Клетка ${Math.floor(index / SIZE) + 1}-${(index % SIZE) + 1}`;
  }

  function buildBoard() {
    if (!el.board) return;
    el.board.innerHTML = Array.from({ length: CELLS }, (_, index) => `
      <button class="cell" type="button" data-cell="${index}" role="gridcell" aria-label="${cellLabel(index)}"></button>
    `).join('');
    el.board.addEventListener('click', (event) => {
      const cell = event.target.closest('[data-cell]');
      if (!cell) return;
      pick(Number(cell.dataset.cell));
    });
  }

  function renderBoard() {
    if (!el.board) return;
    const playing = state.phase === 'playing';
    el.board.querySelectorAll('[data-cell]').forEach((node) => {
      const index = Number(node.dataset.cell);
      const isOpened = state.opened.includes(index);
      const isMine = state.layout.includes(index);
      const showMine = isMine && (state.revealed || isOpened);
      const classes = ['cell'];

      if (isOpened) {
        classes.push('open', isMine ? 'mine' : 'safe');
        if (state.lastHit === index) classes.push('hit');
      } else if (state.revealed && isMine) {
        classes.push('open', 'mine');
      }

      node.className = classes.join(' ');
      node.disabled = playing && isOpened;
      node.setAttribute('aria-label', `${cellLabel(index)}${isOpened ? (isMine ? ', мина' : ', пусто') : ''}`);

      if (isOpened || (state.revealed && isMine)) {
        node.innerHTML = isMine ? (state.lastHit === index ? MINE_HIT_PNG : MINE_PNG) : COIN_PNG;
      } else {
        node.innerHTML = '';
      }
    });
  }

  function renderMineOptions() {
    if (el.mineOptions) {
      el.mineOptions.querySelectorAll('[data-mines]').forEach((btn) => {
        const value = Number(btn.dataset.mines);
        btn.classList.toggle('on', value === state.mines);
        btn.disabled = state.phase === 'playing';
      });
    }
    if (el.minesLeft) el.minesLeft.textContent = `мин на поле: ${state.mines}`;
  }

  function updateUI() {
    renderBalance();
    const playing = state.phase === 'playing';
    if (el.betTotal) el.betTotal.textContent = fmt(state.bet);
    if (el.betLimit) el.betLimit.textContent = `из ${fmt(maxBet())}`;

    if (el.chipsRow) {
      el.chipsRow.querySelectorAll('[data-chip]').forEach((chip) => {
        chip.classList.toggle('on', Number(chip.dataset.chip) === state.bet);
        chip.disabled = playing;
      });
    }

    const short = Casino.getBalance() < state.bet;
    if (el.betHint) {
      el.betHint.hidden = !short || playing;
      el.betHint.textContent = short
        ? 'На балансе меньше ставки — уменьшите ставку или заберите бонус на главной.'
        : '';
    }

    if (el.currentMult) {
      el.currentMult.textContent = multLabel(playing ? state.mult : 1);
    }

    const next = playing ? state.picks + 1 : 1;
    if (el.nextMult) el.nextMult.textContent = multLabel(multFor(state.mines, next));

    const cashout = playing ? Math.round(state.bet * state.mult) : 0;
    if (el.cashoutValue) el.cashoutValue.textContent = cashout ? fmt(cashout) : '0\u00A0₽';

    if (el.playBtn) {
      el.playBtn.disabled = !playing && short;
      el.playBtn.textContent = playing ? `Забрать ${fmt(cashout)}` : 'Начать игру';
    }

    renderMineOptions();
    renderBoard();
  }

  function setBet(value) {
    if (state.phase === 'playing') return;
    const next = Math.max(MIN_BET, Math.min(maxBet(), Math.round(value / 5) * 5));
    state.bet = next;
    sfx('chip');
    updateUI();
    setMessage(`Ставка ${fmt(state.bet)}`);
  }

  function setMines(value) {
    if (state.phase === 'playing') return;
    const next = MINES_OPTIONS.includes(Number(value)) ? Number(value) : DEFAULT_MINES;
    state.mines = next;
    sfx('chip');
    updateUI();
    setMessage(`${next} ${plural(next, ['мина', 'мины', 'мин'])} на поле · следующий шаг ${multLabel(multFor(next, 1))}`);
    if (el.cashoutValue) el.cashoutValue.textContent = '0\u00A0₽';
  }

  function plural(n, forms) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last === 1) return forms[0];
    if (last >= 2 && last <= 4) return forms[1];
    return forms[2];
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
      case 'chip': beep({ freq: 520, dur: 0.05, type: 'square', gain: 0.018 }); break;
      case 'start': beep({ freq: 300, dur: 0.1, type: 'sine', gain: 0.022, slide: 120 }); break;
      case 'open':
        [640, 820].forEach((f, i) => beep({ freq: f, dur: 0.06, type: 'triangle', gain: 0.026, at: i * 0.05 }));
        break;
      case 'win':
        [659.25, 783.99, 1046.5].forEach((f, i) => beep({ freq: f, dur: 0.13, type: 'sine', gain: 0.045, at: i * 0.08 }));
        break;
      case 'jackpot':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => beep({ freq: f, dur: 0.16, type: 'triangle', gain: 0.05, at: i * 0.07 }));
        break;
      case 'boom':
        beep({ freq: 150, dur: 0.32, type: 'sawtooth', gain: 0.05, slide: -100 });
        break;
      default: break;
    }
  }

  // ---------- Заход ----------
  function start(forcedLayout) {
    if (state.phase === 'playing') return null;
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

    Casino.stake(GAME_ID, bet);
    Casino.setPending(GAME_ID, bet);
    Casino.save();

    state.phase = 'playing';
    state.layout = Array.isArray(forcedLayout) && forcedLayout.length
      ? forcedLayout.slice(0, state.mines)
      : placeMines(state.mines);
    state.opened = [];
    state.picks = 0;
    state.mult = 1;
    state.revealed = false;
    state.lastHit = null;
    sfx('start');
    updateUI();
    setMessage(`Заход на ${fmt(bet)} · ищите монеты, мин ${state.mines}`);
    return { layout: state.layout.slice(), mines: state.mines, bet };
  }

  function pick(index) {
    if (state.phase !== 'playing') {
      const started = start();
      if (!started) return null;
    }
    const cell = Number(index);
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return null;
    if (state.opened.includes(cell)) return null;

    if (state.layout.includes(cell)) {
      state.opened.push(cell);
      state.lastHit = cell;
      return finish(true);
    }

    state.opened.push(cell);
    state.picks += 1;
    state.mult = multFor(state.mines, state.picks);
    sfx('open');

    if (state.picks >= maxPicks(state.mines)) {
      return finish(false, true);
    }

    updateUI();
    setMessage(`Открыто ${state.picks} · множитель ${multLabel(state.mult)} · можно забрать ${fmt(Math.round(state.bet * state.mult))}`, 'info');
    return { safe: true, picks: state.picks, mult: state.mult, cell };
  }

  function cashOut() {
    if (state.phase !== 'playing') return null;
    if (state.picks === 0) {
      setMessage('Откройте хотя бы одну клетку', 'lose');
      return null;
    }
    return finish(false);
  }

  function finish(byMine, fullClear = false) {
    const bet = state.bet;
    const mines = state.mines;
    const mult = state.mult;
    const payout = byMine ? 0 : Math.round(bet * mult);
    const baseNet = payout - bet;

    let insurance = 0;
    if (baseNet < 0 && Casino.shields() > 0 && Casino.useShield()) {
      insurance = Math.ceil(-baseNet / 2);
    }
    const net = baseNet + insurance;

    if (payout > 0) Casino.payout(GAME_ID, payout);
    if (insurance > 0) Casino.payout(GAME_ID, insurance);

    const stats = Casino.stats(GAME_ID);
    stats.rounds += 1;
    stats.wagered += bet;
    stats.net += net;
    // Ядро казино хранит статистику целыми числами, поэтому лучший
    // множитель пишем в сотых: 141 — это ×1,41.
    const multHundredths = Math.round(mult * 100);
    if (!byMine && multHundredths > stats.topMult) stats.topMult = multHundredths;
    if (net > 0) {
      stats.wins += 1;
      stats.bestWin = Math.max(stats.bestWin, net);
    } else if (net < 0) {
      stats.losses += 1;
    } else {
      stats.pushes += 1;
    }

    const summary = byMine
      ? `Мина на ${state.picks + 1}-й клетке — ставка сгорела`
      : fullClear
        ? `Поле очищено: ${state.picks} клеток, ${multLabel(mult)}`
        : `Забрал ${multLabel(mult)} после ${state.picks} ${plural(state.picks, ['клетки', 'клеток', 'клеток'])}`;

    Casino.pushHistory(GAME_ID, {
      ts: Date.now(),
      bet,
      net,
      payout: payout + insurance,
      insurance,
      mult: byMine ? 0 : mult,
      mines,
      picks: state.picks,
      summary,
    });
    Casino.setPending(GAME_ID, 0);
    Casino.save();

    state.phase = 'idle';
    state.revealed = true;
    state.lastMult = byMine ? 0 : mult;
    renderBalance(net);
    updateUI();
    renderRounds();

    if (byMine) {
      sfx('boom');
      if (insurance > 0) {
        setMessage(`Мина! Страховка вернула ${fmt(insurance)} · чистыми ${signed(net)}`, 'info');
      } else {
        setMessage(`Мина на ${state.picks + 1}-й клетке · минус ${fmt(bet)}`, 'lose');
      }
    } else {
      sfx(mult >= 3 ? 'jackpot' : 'win');
      setMessage(`${summary} · выплата ${fmt(payout)} · чистыми ${signed(net)}`, 'win');
    }

    return { byMine, fullClear, picks: state.picks, mult: byMine ? 0 : mult, payout, net, insurance, bet, mines };
  }

  // ---------- История ----------

  function roundCardHTML(entry) {
    const net = Number(entry.net) || 0;
    const cls = net > 0 ? 'win' : net < 0 ? 'lose' : '';
    const mult = Number(entry.mult) || 0;
    const badge = mult > 0 ? multLabel(mult) : 'мина';
    return `
      <article class="spin-card ${cls}">
        <span class="spin-mult ${mult <= 0 ? 'low' : ''}">${badge}</span>
        <div class="spin-text">
          <b class="${net > 0 ? 'plus' : net < 0 ? 'minus' : ''}">${net === 0 ? 'ровно' : signed(net)}</b>
          <span>ставка ${fmt(entry.bet || 0)} · ${entry.picks || 0} ${plural(entry.picks || 0, ['клетка', 'клетки', 'клеток'])} · ${entry.mines || 0} ${plural(entry.mines || 0, ['мина', 'мины', 'мин'])}${Casino.insuranceTagHTML(entry)}</span>
        </div>
        <time class="round-time">${Casino.timeLabel(entry.ts)}</time>
      </article>
    `;
  }

  function renderRounds() {
    if (!el.roundsList) return;
    const list = Casino.history(GAME_ID).slice(0, HISTORY_SHOWN);
    el.roundsList.innerHTML = list.length
      ? list.map(roundCardHTML).join('')
      : '<p class="roll-empty">Заходов пока нет. Начните игру и открывайте клетки.</p>';
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
        state.phase = 'idle';
        state.layout = [];
        state.opened = [];
        state.picks = 0;
        state.mult = 1;
        state.revealed = false;
        state.lastHit = null;
        updateUI();
        renderRounds();
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
    const rows = MINES_OPTIONS.map((m) => {
      const first = multFor(m, 1).toFixed(2).replace('.', ',');
      const third = multFor(m, Math.min(3, maxPicks(m))).toFixed(2).replace('.', ',');
      return `<li>${m} ${plural(m, ['мина', 'мины', 'мин'])} — первая клетка ×${first}, третья ×${third}</li>`;
    }).join('');
    openModal(`
      <h2>Правила сапёра</h2>
      <p>Поле 5×5. Вы делаете ставку, и на поле прячутся мины. Открывайте клетки
        по одной: каждая монета поднимает множитель, мина забирает всю ставку.
        В любой момент можно забрать выплату.</p>
      <h3>Мины</h3>
      <ul>${rows}</ul>
      <h3>Поле до конца</h3>
      <p>Чем больше клеток открыто, тем выше множитель. Если открыть все
        безопасные клетки, заход заканчивается сам и платит по последнему
        множителю — копить дальше уже нечего.</p>
      <h3>Страховка</h3>
      <p>Страховки приходят за цели. Если попали на мину, страховка срабатывает
        сама и возвращает половину ставки. Сгорает не больше одной за заход.</p>
      <div class="modal-actions"><button class="primary-btn" data-close>Понятно</button></div>
    `);
  }

  function openStats() {
    const s = Casino.stats(GAME_ID);
    const decided = s.wins + s.losses;
    const winRate = decided > 0 ? Math.round((s.wins / decided) * 100) : 0;
    const rtp = s.wagered > 0 ? Math.round(((s.wagered + s.net) / s.wagered) * 1000) / 10 : 0;
    openModal(`
      <h2>Статистика сапёра</h2>
      <div class="stat-grid">
        <span>Заходов</span><span>${numFmt.format(s.rounds)}</span>
        <span>Побед</span><span>${numFmt.format(s.wins)}</span>
        <span>Подрывов</span><span>${numFmt.format(s.losses)}</span>
        <span>Ничьих</span><span>${numFmt.format(s.pushes)}</span>
        <span>Лучший множитель</span><span>${s.topMult ? `×${(s.topMult / 100).toFixed(2).replace('.', ',')}` : '—'}</span>
        <span>Доля побед</span><span>${winRate}%</span>
        <span>Оборот ставок</span><span>${fmt(s.wagered)}</span>
        <span>Фактический возврат</span><span>${s.wagered > 0 ? `${rtp}%` : '—'}</span>
        <span>Лучший заход</span><span>${fmt(s.bestWin)}</span>
        <span>Итог игры</span><span>${signed(s.net)}</span>
        <span>Общий баланс</span><span>${fmt(Casino.getBalance())}</span>
      </div>
      <p class="goals-note">Статистика других игр считается отдельно — она в их собственных окнах.</p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="reset">Сбросить сапёр</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  function openHistory() {
    const list = Casino.history(GAME_ID);
    openModal(`
      <h2>История заходов</h2>
      ${list.length
        ? `<div class="rolls-list rolls-history-full">${list.map(roundCardHTML).join('')}</div>`
        : '<p class="roll-empty">Заходов пока нет.</p>'}
      <div class="modal-actions"><button class="primary-btn" data-close>Закрыть</button></div>
    `);
  }

  // ---------- События ----------
  if (el.mineOptions) {
    el.mineOptions.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-mines]');
      if (!btn) return;
      setMines(Number(btn.dataset.mines));
    });
  }

  if (el.chipsRow) {
    el.chipsRow.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-chip]');
      if (!chip) return;
      setBet(Number(chip.dataset.chip));
    });
  }

  if (el.playBtn) {
    el.playBtn.addEventListener('click', () => {
      if (state.phase === 'playing') cashOut();
      else start();
    });
  }

  if (el.maxBetBtn) {
    el.maxBetBtn.addEventListener('click', () => {
      if (state.phase === 'playing') return;
      const affordable = Math.min(maxBet(), Math.floor(Casino.getBalance() / 5) * 5);
      if (affordable < MIN_BET) {
        setMessage('На балансе меньше минимальной ставки', 'lose');
        return;
      }
      // Выше самой крупной фишки «Максимум» ставит весь доступный лимит.
      const top = BET_STEPS[BET_STEPS.length - 1];
      const step = affordable > top
        ? affordable
        : BET_STEPS.filter((value) => value <= affordable).pop() || MIN_BET;
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
    // Удержание клавиши не должно запускать игру и тут же забирать выигрыш.
    if (event.repeat) return;
    const key = Casino.keyOf(event);
    if (el.overlay && !el.overlay.hidden) {
      if (key === 'escape') closeModal();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (key === ' ' || key === 'enter') {
      event.preventDefault();
      if (state.phase === 'playing') cashOut();
      else start();
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
    renderRounds();
  });

  // ---------- Старт ----------
  buildBoard();
  Casino.setSoundIcon(el.soundBtn, Casino.getSound());
  renderRounds();
  updateUI();
  setMessage('Выберите ставку и начните заход');

  // ---------- Тестовый хук ----------
  window.__MINES_TEST__ = {
    SIZE, CELLS, MINES_OPTIONS, RTP, MIN_BET, maxBet,
    state,
    comb,
    fairMult,
    multFor,
    maxPicks,
    setRng,
    setBet,
    setMines,
    start,
    pick,
    cashOut,
    placeMines,
    updateUI,
    renderRounds,
  };
})();
