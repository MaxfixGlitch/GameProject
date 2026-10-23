/* ============================================================
   Колесо фортуны: 18 равных секторов
   Ставка × множитель сектора. Возврат 94,44% — считается точно:
   сумма множителей 17 на 18 секторов.
   ============================================================ */
(() => {
  'use strict';

  const Casino = window.Casino;
  const $ = (sel) => document.querySelector(sel);
  const GAME_ID = 'wheel';

  // Закрытая игра не запускается: прямо по адресу тоже стоит замок.
  if (!Casino.isUnlocked(GAME_ID)) {
    Casino.showLocked(GAME_ID);
    return;
  }

  // Порядок секторов: нули чередуются с выигрышными, чтобы колесо
  // выглядело живым. Сумма множителей ровно 17 → возврат 17/18.
  // Секторов с ×2 два — по одному с каждой стороны от ×6 и ×3.
  const SEGMENTS = [0, 1, 0, 0.5, 0, 2, 0, 6, 0, 1, 0, 2, 0, 0.5, 0, 3, 0, 1];
  const SEG_ANGLE = 360 / SEGMENTS.length;

  const COLORS = {
    0: { bg: '#0b1a12', fg: 'light' },
    0.5: { bg: '#123a29', fg: 'light' },
    1: { bg: '#1b5c3d', fg: 'light' },
    2: { bg: '#b98d2c', fg: 'dark' },
    3: { bg: '#d9ac4a', fg: 'dark' },
    6: { bg: '#f2cd6b', fg: 'dark' },
  };

  const BET_STEPS = [25, 100, 250, 500, 1000, 2500];
  const MIN_BET = 25;
  // Лимит стола растёт с закрытыми целями — как в остальных играх.
  const maxBet = () => Casino.maxBet();
  const HISTORY_SHOWN = 12;

  // ---------- Элементы ----------
  const el = {
    bankroll: $('#bankroll'),
    deltaLayer: $('#deltaLayer'),
    disc: $('#wheelDisc'),
    labels: $('#wheelLabels'),
    resultLabel: $('#resultLabel'),
    resultValue: $('#resultValue'),
    message: $('#message'),
    spinBtn: $('#spinBtn'),
    maxBetBtn: $('#maxBetBtn'),
    chipsRow: $('#chipsRow'),
    betTotal: $('#betTotal'),
    betLimit: $('#betLimit'),
    betHint: $('#betHint'),
    sectorList: $('#sectorList'),
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
  const multLabel = (m) => (Number.isInteger(m) ? `×${m}` : `×${String(m).replace('.', ',')}`);

  // ---------- Состояние ----------
  const state = {
    bet: MIN_BET,
    spinning: false,
    rotation: 0,
    lastIndex: null,
  };

  let timing = { spin: 3600, settle: 120 };
  const setTiming = (next) => { timing = Object.assign({}, timing, next); };

  let rng = Math.random;
  const setRng = (fn) => { rng = typeof fn === 'function' ? fn : Math.random; };

  const drawIndex = () => Math.floor(rng() * SEGMENTS.length);
  const multiplierFor = (index) => SEGMENTS[index];
  const payoutFor = (bet, index) => Math.round(bet * SEGMENTS[index]);

  // ---------- Колесо ----------
  function conicGradient() {
    const stops = SEGMENTS.map((mult, index) => {
      const from = (index * SEG_ANGLE).toFixed(3);
      const to = ((index + 1) * SEG_ANGLE).toFixed(3);
      return `${COLORS[mult].bg} ${from}deg ${to}deg`;
    });
    return `conic-gradient(from 0deg, ${stops.join(', ')})`;
  }

  function renderWheel() {
    if (el.disc) el.disc.style.background = conicGradient();
    if (!el.labels) return;
    el.labels.innerHTML = SEGMENTS.map((mult, index) => {
      const angle = index * SEG_ANGLE + SEG_ANGLE / 2;
      const zero = mult === 0 ? ' zero' : '';
      const dark = COLORS[mult].fg === 'dark' ? ' style="color:#12200f"' : '';
      return `<div class="wheel-label${zero}" data-index="${index}" style="--a:${angle}deg">
        <span${dark}>${mult === 0 ? '×0' : multLabel(mult)}</span>
      </div>`;
    }).join('');
  }

  function highlightSegment(index) {
    if (!el.labels) return;
    el.labels.querySelectorAll('.wheel-label').forEach((label) => {
      label.classList.toggle('hit', Number(label.dataset.index) === index);
    });
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
        beep({ freq: 150, dur: 0.6, type: 'sawtooth', gain: 0.012, slide: 260 });
        break;
      case 'tick':
        beep({ freq: 900, dur: 0.03, type: 'square', gain: 0.012 });
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
    if (el.betLimit) el.betLimit.textContent = `из ${fmt(maxBet())}`;
    if (el.chipsRow) {
      el.chipsRow.querySelectorAll('[data-chip]').forEach((chip) => {
        chip.classList.toggle('on', Number(chip.dataset.chip) === state.bet);
      });
      Casino.syncChips(el.chipsRow);
    }
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

  function setResult(label, value, kind = '') {
    if (el.resultLabel) el.resultLabel.textContent = label;
    if (el.resultValue) {
      el.resultValue.textContent = value;
      el.resultValue.className = `wheel-result-value${kind ? ` ${kind}` : ''}`;
    }
  }

  function setBet(value) {
    if (state.spinning) return;
    const next = Math.max(MIN_BET, Math.min(maxBet(), Math.round(value / 5) * 5));
    state.bet = next;
    sfx('chip');
    updateUI();
    setMessage(`Ставка ${fmt(state.bet)}`);
  }

  function renderSectors() {
    if (!el.sectorList) return;
    const totals = {};
    SEGMENTS.forEach((mult) => { totals[mult] = (totals[mult] || 0) + 1; });
    const order = Object.keys(totals).map(Number).sort((a, b) => a - b);
    el.sectorList.innerHTML = order.map((mult) => `
      <div class="sector-row">
        <i class="sector-dot" style="background:${COLORS[mult].bg}"></i>
        <b>${multLabel(mult)}</b>
        <span class="sector-count">${totals[mult]} ${plural(totals[mult], ['сектор', 'сектора', 'секторов'])}</span>
        <span>${mult === 0 ? 'ставка сгорает' : `выплата ${multLabel(mult)}`}</span>
      </div>
    `).join('');
  }

  function plural(n, forms) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last === 1) return forms[0];
    if (last >= 2 && last <= 4) return forms[1];
    return forms[2];
  }

  // ---------- История ----------

  function spinCardHTML(entry) {
    const net = Number(entry.net) || 0;
    const cls = net > 0 ? 'win' : net < 0 ? 'lose' : '';
    const mult = Number(entry.mult) || 0;
    return `
      <article class="spin-card ${cls}">
        <span class="spin-mult ${mult === 0 ? 'zero' : ''}">${multLabel(mult)}</span>
        <div class="spin-text">
          <b class="${net > 0 ? 'plus' : net < 0 ? 'minus' : ''}">${net === 0 ? 'возврат ставки' : signed(net)}</b>
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
      : '<p class="roll-empty">Вращений пока нет. Выберите ставку и крутите колесо.</p>';
  }

  // ---------- Вращение ----------
  async function spin(forcedIndex) {
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
    highlightSegment(-1);
    Casino.stake(GAME_ID, bet);
    Casino.setPending(GAME_ID, bet);
    Casino.save();
    updateUI();
    setResult('Крутится', '…');
    setMessage('Колесо крутится…');
    sfx('spin');

    const index = Number.isInteger(forcedIndex) ? forcedIndex : drawIndex();
    state.lastIndex = index;

    // Сектор должен встать под указателем сверху: поворачиваем на
    // угол, при котором центр сектора смотрит в 12 часов.
    const center = index * SEG_ANGLE + SEG_ANGLE / 2;
    const currentMod = ((state.rotation % 360) + 360) % 360;
    const targetMod = ((360 - center) % 360 + 360) % 360;
    const extra = ((targetMod - currentMod) % 360 + 360) % 360;
    state.rotation += 360 * 4 + extra;

    if (el.disc) {
      el.disc.style.transition = `transform ${timing.spin}ms cubic-bezier(.11, .66, .16, 1)`;
      el.disc.style.transform = `rotate(${state.rotation}deg)`;
    }

    await new Promise((resolve) => setTimeout(resolve, timing.spin + timing.settle));
    return finishSpin(index, bet);
  }

  function finishSpin(index, bet) {
    const mult = SEGMENTS[index];
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
    stats.spins += 1;
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

    const summary = mult === 0
      ? 'Сектор ×0 — ставка сгорела'
      : `Сектор ${multLabel(mult)} — выплата ${fmt(payout)}`;

    Casino.pushHistory(GAME_ID, {
      ts: Date.now(),
      bet,
      net,
      payout: payout + insurance,
      insurance,
      mult,
      index,
      summary,
    });
    Casino.setPending(GAME_ID, 0);
    Casino.save();

    state.spinning = false;
    // Нормализуем угол: визуально ничего не меняется, но число
    // не растёт до бесконечности от спина к спину.
    state.rotation = ((state.rotation % 360) + 360) % 360;
    if (el.disc) {
      el.disc.style.transition = 'none';
      el.disc.style.transform = `rotate(${state.rotation}deg)`;
    }

    renderBalance(net);
    updateUI();
    highlightSegment(index);
    renderSpins();
    setResult(`Сектор ${multLabel(mult)}`, mult > 0 ? `+${fmt(payout)}` : '×0', net > 0 ? 'win' : net < 0 ? 'lose' : '');

    if (net > 0) {
      sfx(mult >= 2 ? 'jackpot' : 'win');
      setMessage(`${summary} · чистыми ${signed(net)}`, 'win');
    } else if (insurance > 0) {
      sfx('win');
      setMessage(`Сектор ${multLabel(mult)} · страховка вернула ${fmt(insurance)} · чистыми ${signed(net)}`, 'info');
    } else if (net === 0) {
      sfx('tick');
      setMessage(`${summary} — ставка вернулась`, 'info');
    } else {
      sfx('lose');
      setMessage(`${summary} · ставка ${fmt(bet)} ушла в кассу`, 'lose');
    }

    return { index, mult, payout, net, insurance, bet };
  }

  // ---------- Окна ----------
  let lastFocused = null;

  function openModal(html) {
    if (!el.modalBody || !el.overlay) return;
    lastFocused = document.activeElement;
    el.modalBody.innerHTML = html;
    // История прокручивает только список раундов, заголовок стоит.
    el.modalBody.classList.toggle('has-scroll', Boolean(el.modalBody.querySelector('.modal-scroll')));
    el.overlay.hidden = false;
    if (el.modalClose) el.modalClose.focus({ preventScroll: true });
    el.modalBody.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
    const reset = el.modalBody.querySelector('[data-action="reset"]');
    if (reset) {
      reset.addEventListener('click', () => {
        Casino.resetGame(GAME_ID);
        Casino.save();
        closeModal();
        highlightSegment(-1);
        setResult('Готовы?', '—');
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
      <h2>Правила колеса</h2>
      <p>На колесе восемнадцать равных секторов с множителями: ×0, ×0,5, ×1, ×2, ×3 и ×6.
        Вы делаете ставку, колесо делает оборот, и если под указателем оказывается
        сектор с множителем, ставка умножается на него.</p>
      <h3>Выплаты</h3>
      <ul>
        ${[0, 0.5, 1, 2, 3, 6].map((m) => `<li>${multLabel(m)} — ${SEGMENTS.filter((x) => x === m).length} ${plural(SEGMENTS.filter((x) => x === m).length, ['сектор', 'сектора', 'секторов'])}${m === 0 ? ' (ставка сгорает)' : `, выплата ${multLabel(m)} от ставки`}</li>`).join('')}
      </ul>
      <h3>Страховка</h3>
      <p>Страховки приходят за цели. Если вращение ушло в минус, страховка
        срабатывает сама и возвращает половину потерь. На выигрыш она не
        тратится, сгорает не больше одной за вращение.</p>
      <div class="modal-actions"><button class="primary-btn" data-close>Понятно</button></div>
    `);
  }

  function openStats() {
    const s = Casino.stats(GAME_ID);
    const decided = s.wins + s.losses;
    const winRate = decided > 0 ? Math.round((s.wins / decided) * 100) : 0;
    const rtp = s.wagered > 0 ? Math.round(((s.wagered + s.net) / s.wagered) * 1000) / 10 : 0;
    openModal(`
      <h2>Статистика колеса</h2>
      <div class="stat-grid">
        <span>Вращений</span><span>${numFmt.format(s.spins)}</span>
        <span>Побед</span><span>${numFmt.format(s.wins)}</span>
        <span>Поражений</span><span>${numFmt.format(s.losses)}</span>
        <span>Возврат ставки</span><span>${numFmt.format(s.pushes)}</span>
        <span>Лучший множитель</span><span>${s.topMult ? multLabel(s.topMult) : '—'}</span>
        <span>Доля побед</span><span>${winRate}%</span>
        <span>Оборот ставок</span><span>${fmt(s.wagered)}</span>
        <span>Фактический возврат</span><span>${s.wagered > 0 ? `${rtp}%` : '—'}</span>
        <span>Лучшее вращение</span><span>${fmt(s.bestWin)}</span>
        <span>Итог игры</span><span>${signed(s.net)}</span>
        <span>Общий баланс</span><span>${fmt(Casino.getBalance())}</span>
      </div>
      <p class="goals-note">Статистика других игр считается отдельно — она в их собственных окнах.</p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="reset">Сбросить колесо</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  function openHistory() {
    const list = Casino.history(GAME_ID);
    openModal(`
      <h2>История вращений</h2>
      <div class="modal-scroll">
        ${list.length
          ? `<div class="rolls-list rolls-history-full">${list.map(spinCardHTML).join('')}</div>`
          : '<p class="roll-empty">Вращений пока нет.</p>'}
      </div>
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
  renderWheel();
  renderSectors();
  Casino.setSoundIcon(el.soundBtn, Casino.getSound());
  renderSpins();
  updateUI();
  setResult('Готовы?', '—');
  setMessage('Выберите ставку и крутите колесо');

  // ---------- Тестовый хук ----------
  window.__WHEEL_TEST__ = {
    SEGMENTS, SEG_ANGLE, MIN_BET, maxBet, COLORS,
    state,
    multiplierFor,
    payoutFor,
    drawIndex,
    setRng,
    setTiming,
    spin,
    finishSpin,
    renderSectors,
    renderWheel,
    updateUI,
    setBet,
    highlightSegment,
  };
})();
