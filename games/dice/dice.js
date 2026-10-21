/* ============================================================
   Кости — два кубика, ставки на сумму и расчёт выплат
   ============================================================ */
(() => {
  'use strict';

  const Casino = window.Casino;
  const GAME_ID = 'dice';
  const MIN_BET = Casino.MIN_BET;
  // Лимит стола растёт с достигнутыми целями.
  const maxBet = () => Casino.maxBet();

  // ---------- Ставки ----------
  // Множитель — полная выплата вместе со ставкой: прибыль 5:1 → ×6.
  // Суммы платят почти по настоящим шансам (36 вариантов из двух костей),
  // поэтому у стола самая низкая доля казино во всём заведении.
  const SUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const SUM_MULT = {
    2: 31, 3: 16, 4: 11, 5: 8, 6: 7, 7: 6,
    8: 7, 9: 8, 10: 11, 11: 16, 12: 31,
  };
  const PAIRS = [1, 2, 3, 4, 5, 6];
  const PAIR_MULT = 31;
  const DOUBLE_MULT = 6;

  const OUTSIDE = [
    { key: 'even', label: 'ЧЁТ', mult: 2 },
    { key: 'odd', label: 'НЕЧЁТ', mult: 2 },
    { key: 'over', label: 'БОЛЬШЕ 7', mult: 2 },
    { key: 'under', label: 'МЕНЬШЕ 7', mult: 2 },
    { key: 'double', label: 'ДУБЛЬ', mult: DOUBLE_MULT },
  ];

  function multiplier(key) {
    const [type, arg] = String(key).split(':');
    if (type === 'sum') return SUM_MULT[Number(arg)] || 2;
    if (type === 'pair') return PAIR_MULT;
    if (type === 'double') return DOUBLE_MULT;
    return 2;
  }

  // Сумма очков, которую приносит каждая ставка.
  function betWins(key, a, b) {
    const sum = a + b;
    const [type, arg] = String(key).split(':');
    switch (type) {
      case 'sum': return sum === Number(arg);
      case 'pair': return a === b && a === Number(arg);
      case 'double': return a === b;
      case 'even': return sum % 2 === 0;
      case 'odd': return sum % 2 === 1;
      case 'over': return sum > 7;
      case 'under': return sum < 7;
      default: return false;
    }
  }

  // ---------- Кубик: какая грань как повёрнута ----------
  // Противоположные грани дают 7: 1–6, 2–5, 3–4.
  const FACE_ROTATION = {
    1: { x: 0, y: 0 },
    2: { x: -90, y: 0 },
    3: { x: 0, y: -90 },
    4: { x: 0, y: 90 },
    5: { x: 90, y: 0 },
    6: { x: 0, y: 180 },
  };

  // Раскладка точек на грани: строка и столбец сетки 3×3.
  const PIP_GRID = {
    1: [[2, 2]],
    2: [[1, 1], [3, 3]],
    3: [[1, 1], [2, 2], [3, 3]],
    4: [[1, 1], [1, 3], [3, 1], [3, 3]],
    5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
    6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
  };

  function pipGridHTML(value) {
    const pips = (PIP_GRID[value] || [])
      .map(([row, col]) => `<i class="pip" style="grid-row:${row};grid-column:${col}"></i>`)
      .join('');
    return `<span class="pip-grid">${pips}</span>`;
  }

  function faceTransform(face, spins = 0) {
    const base = FACE_ROTATION[face] || FACE_ROTATION[1];
    return `rotateX(${base.x + 360 * spins}deg) rotateY(${base.y + 360 * spins}deg)`;
  }

  // ---------- Состояние ----------
  const state = {
    bets: {},          // ключ ставки -> сумма
    stack: [],         // история кликов для «Отменить»
    lastBets: null,    // для «Повторить»
    chip: 25,
    rolling: false,
    settled: false,
    highlight: new Set(),
    rolls: [],         // последние броски { dice: [a, b], sum }
    dice: [1, 1],      // что сейчас на кубиках
    sound: true,
  };

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const el = {
    stage: $('#diceStage'),
    dieA: $('#dieA'),
    dieB: $('#dieB'),
    sumBadge: $('#sumBadge'),
    message: $('#message'),
    betTotal: $('#betTotal'),
    betLimit: $('#betLimit'),
    betHint: $('#betHint'),
    chipsRow: $('#chipsRow'),
    table: $('#betTable'),
    rollBtn: $('#rollBtn'),
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
    rollsStrip: $('#rollsStrip'),
    rollsList: $('#rollsList'),
    historyBtn: $('#historyBtn'),
    chips: [...document.querySelectorAll('.chip')],
  };

  const numFmt = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => `${numFmt.format(Math.round(n))} ₽`;
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      case 'roll':
        // Кубики стучат по фетру: серия коротких щелчков, к концу реже.
        [0, 0.07, 0.15, 0.24, 0.34, 0.45, 0.58, 0.72, 0.88].forEach((at, i) => {
          beep({
            freq: 220 + i * 26,
            dur: 0.045,
            type: 'square',
            gain: 0.012 + (i > 5 ? 0.012 : 0),
            at,
          });
        });
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

  // ---------- Сообщения ----------
  function setMessage(text, cls = '') {
    el.message.textContent = text;
    el.message.className = `message ${cls}`.trim();
  }

  // ---------- Кубики ----------
  function buildDice() {
    [el.dieA, el.dieB].forEach((die) => {
      if (!die) return;
      die.innerHTML = [1, 2, 3, 4, 5, 6]
        .map((value) => `<div class="die-face" data-face="${value}">${pipGridHTML(value)}</div>`)
        .join('');
      die.style.transform = faceTransform(1, 0);
    });
  }

  function applyFaces(a, b, spinsA = 0, spinsB = 0) {
    if (el.dieA) el.dieA.style.transform = faceTransform(a, spinsA);
    if (el.dieB) el.dieB.style.transform = faceTransform(b, spinsB);
  }

  function setDice(a, b) {
    state.dice = [a, b];
    const sum = a + b;
    if (!el.sumBadge) return;
    el.sumBadge.hidden = false;
    el.sumBadge.textContent = String(sum);
    el.sumBadge.classList.toggle('is-seven', sum === 7);
    // перезапуск анимации появления
    el.sumBadge.style.animation = 'none';
    void el.sumBadge.offsetWidth;
    el.sumBadge.style.animation = '';
    if (el.stage) el.stage.setAttribute('aria-label', `Выпало ${a} и ${b}, сумма ${sum}`);
  }

  function pickDice() {
    return [randomInt(6) + 1, randomInt(6) + 1];
  }

  // Длительности вынесены в let: тесты прогоняют бросок без ожидания.
  let rollMs = 1150;
  let settleMs = 1300;

  function animateDice(a, b) {
    return new Promise((resolve) => {
      const canAnimate = rollMs > 60
        && el.stage && el.dieA && el.dieB
        && typeof window.requestAnimationFrame === 'function';

      if (!canAnimate) {
        applyFaces(a, b);
        setDice(a, b);
        resolve();
        return;
      }

      el.stage.classList.add('is-rolling');
      el.dieA.style.transition = `transform ${rollMs}ms cubic-bezier(.18, .72, .2, 1)`;
      el.dieB.style.transition = `transform ${rollMs}ms cubic-bezier(.18, .72, .2, 1)`;
      // Обороты всегда вперёд, чтобы кубик не «отматывался» назад.
      const spinsA = 2 + randomInt(3);
      const spinsB = 2 + randomInt(3);
      // Принудительный reflow: переход должен начаться с текущего положения.
      void el.dieA.offsetWidth;
      el.dieA.style.transform = faceTransform(a, spinsA);
      el.dieB.style.transform = faceTransform(b, spinsB);

      setTimeout(() => {
        el.stage.classList.remove('is-rolling');
        setDice(a, b);
        resolve();
      }, rollMs + 30);
    });
  }

  // ---------- Стол ----------
  // Крупные суммы в чипе сокращаются, чтобы влезали в узкую клетку.
  function chipAmount(amount) {
    if (amount < 1000) return String(amount);
    const k = amount / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1).replace('.', ',')}k`;
  }

  function cellHTML({ key, label, odds, className }) {
    const amount = state.bets[key] || 0;
    const chip = amount
      ? `<span class="cell-chip" title="${numFmt.format(amount)} ₽">${chipAmount(amount)}</span>`
      : '';
    const winning = state.highlight.has(key);
    const losing = state.highlight.size > 0 && amount > 0 && !winning;
    const cls = ['cell', className, winning ? 'is-win' : '', losing ? 'is-lose' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-bet="${key}"
      ${state.rolling ? 'disabled' : ''} aria-label="${label}, выплата ${odds}">`
      + `<span class="cell-num">${label}</span>`
      + `<span class="cell-odds">${odds}</span>${chip}</button>`;
  }

  function renderTable() {
    if (!el.table) return;
    const sums = SUMS.map((value) => cellHTML({
      key: `sum:${value}`,
      label: String(value),
      odds: `×${SUM_MULT[value]}`,
      className: `sum sum-${value}`,
    })).join('');

    const outside = OUTSIDE.map((bet) => cellHTML({
      key: bet.key,
      label: bet.label,
      odds: `×${bet.mult}`,
      className: 'outside',
    })).join('');

    const pairs = PAIRS.map((value) => cellHTML({
      key: `pair:${value}`,
      label: `${value}·${value}`,
      odds: `×${PAIR_MULT}`,
      className: 'pair',
    })).join('');

    el.table.innerHTML = `
      <div class="dice-row sums">${sums}</div>
      <div class="dice-row outside">${outside}</div>
      <div class="dice-row pairs">${pairs}</div>
    `;
  }

  function renderRollsStrip() {
    if (!el.rollsStrip) return;
    if (!state.rolls.length) {
      el.rollsStrip.innerHTML = '<span class="strip-empty">Здесь появятся последние броски</span>';
      return;
    }
    el.rollsStrip.innerHTML = state.rolls.map((roll) => {
      const [a, b] = roll.dice;
      const classes = ['strip-roll'];
      if (roll.sum === 7) classes.push('is-seven');
      if (a === b) classes.push('is-double');
      return `<span class="${classes.join(' ')}" title="${a} и ${b}, сумма ${roll.sum}">${roll.sum}</span>`;
    }).join('');
  }

  // ---------- Ставки ----------
  function placeBet(key, value = state.chip) {
    if (state.rolling || state.settled) return false;
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
    if (state.rolling || state.settled) return;
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
    if (state.rolling || state.settled) return;
    const refunded = refundBets();
    if (refunded) sfx('chip');
    setMessage('Ставки сняты, фишки вернулись на баланс');
    updateUI(refunded);
  }

  function repeatBets() {
    if (state.rolling || !state.lastBets) return;
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

  // Сколько стол вернёт при каждом из 36 исходов. Нужно, чтобы честно
  // предупредить игрока о «мёртвых» комбинациях.
  function payoutFor(a, b) {
    return Object.entries(state.bets).reduce((sum, [key, amount]) => (
      betWins(key, a, b) ? sum + amount * multiplier(key) : sum
    ), 0);
  }

  function analyzeBets() {
    const total = totalBet();
    if (total <= 0) return null;
    const payouts = [];
    const deadSums = new Set();
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const payout = payoutFor(a, b);
        payouts.push(payout);
        if (payout === 0) deadSums.add(a + b);
      }
    }
    const max = Math.max(...payouts);
    const min = Math.min(...payouts);
    return {
      total,
      max,
      min,
      deadSums: [...deadSums].sort((x, y) => x - y),
      // Ставки гасят друг друга: вернётся ровно ставка при любом исходе.
      neutral: min === total && max === total,
      // Даже лучший исход не покрывает ставку.
      cannotWin: max <= total,
    };
  }

  // ---------- Обновление интерфейса ----------
  function renderBalance(bump) {
    const balance = Casino.getBalance();
    el.bankroll.textContent = fmt(balance);
    if (bump && el.deltaLayer) {
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
    if (state.rolling || state.settled) {
      el.betHint.hidden = true;
      return;
    }
    const info = analyzeBets();
    let text = '';
    if (info && info.neutral) {
      text = 'Ставки уравновешивают друг друга: вернётся ровно ставка, '
        + 'выиграть при таком раскладе нельзя.';
    } else if (info && info.deadSums.length && info.deadSums.length <= 3) {
      const sums = info.deadSums.length === 1
        ? `сумма ${info.deadSums[0]}`
        : `суммы ${info.deadSums.join(', ')}`;
      text = `Не покрыта ${sums}: если выпадет ${info.deadSums.length === 1 ? 'она' : 'одна из них'}, `
        + 'все ставки проиграют.';
    } else if (info && info.cannotWin) {
      text = `Такая комбинация не может выиграть: максимум вернётся ${fmt(info.max)} `
        + `из ${fmt(info.total)}.`;
    }
    el.betHint.textContent = text;
    el.betHint.hidden = !text;
  }

  function renderSound() {
    const on = Casino.getSound();
    el.soundBtn.textContent = on ? '🔊' : '🔇';
    el.soundBtn.classList.toggle('off', !on);
    el.soundBtn.setAttribute('aria-pressed', String(on));
  }

  function updateUI(bump) {
    const total = totalBet();
    el.betTotal.textContent = fmt(total);
    el.betTotal.classList.toggle('full', total >= maxBet());
    if (el.betLimit) el.betLimit.textContent = `из ${fmt(maxBet())}`;
    renderBetHint();

    const locked = state.rolling || state.settled;
    el.rollBtn.disabled = locked || total < MIN_BET;
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
    renderRollsStrip();
    renderSound();
  }

  // ---------- Бросок ----------
  async function roll() {
    if (state.rolling || state.settled) return;
    const total = totalBet();
    if (total < MIN_BET) {
      setMessage('Сначала поставьте фишки на стол', 'lose');
      return;
    }

    state.rolling = true;
    state.highlight.clear();
    state.lastBets = Object.assign({}, state.bets);
    if (el.sumBadge) el.sumBadge.hidden = true;
    setMessage('Кости катятся…');
    updateUI();
    sfx('roll');

    const [a, b] = pickDice();
    await animateDice(a, b);
    await finishRoll(a, b, total);
  }

  async function finishRoll(a, b, total) {
    const sum = a + b;
    const winKeys = [];
    let payout = 0;

    Object.entries(state.bets).forEach(([key, amount]) => {
      if (betWins(key, a, b)) {
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
    stats.rolls += 1;
    stats.wagered += total;
    stats.net += net;
    if (a === b) stats.doubles += 1;
    if (net > 0) {
      stats.wins += 1;
      stats.bestWin = Math.max(stats.bestWin, net);
    } else if (net < 0) {
      stats.losses += 1;
    } else {
      stats.pushes += 1;
    }

    state.rolls.unshift({ dice: [a, b], sum });
    if (state.rolls.length > 10) state.rolls.length = 10;

    Casino.pushHistory(GAME_ID, {
      ts: Date.now(),
      bet: total,
      net,
      dice: [a, b],
      sum,
      bets: Object.assign({}, state.bets),
      wins: winKeys,
      payout: payout + insurance,
      insurance,
      summary: `Выпало ${a} и ${b} · сумма ${sum}`,
    });
    Casino.setPending(GAME_ID, 0);
    Casino.save();

    // Подсветка выигравших клеток
    state.highlight = new Set(winKeys);

    let message;
    let messageClass = '';
    const result = `Выпало ${a} и ${b}, сумма ${sum}`;
    if (net > 0) {
      message = `${result} — выигрыш ${fmt(net)}`;
      messageClass = 'win';
      sfx('win');
    } else if (net < 0) {
      message = `${result} — проигрыш ${fmt(-net)}`;
      if (insurance > 0) message += ` · страховка вернула ${fmt(insurance)}`;
      messageClass = 'lose';
      sfx('lose');
    } else {
      message = `${result} — ставка возвращена`;
      messageClass = 'push';
      sfx('push');
    }

    // Достигнутые цели: награда уже на балансе, сообщаем игроку.
    const reached = Casino.checkGoals();
    const goalReward = reached.reduce((obj, goal) => obj + goal.reward, 0);
    if (reached.length) {
      const best = reached[reached.length - 1];
      message += ` · цель ${fmt(best.target)}: +${fmt(goalReward)}, звание «${best.title}»`;
      messageClass = 'win';
    }

    setMessage(message, messageClass);

    // Ставки уже разыграны, но на секунду остаются на столе:
    // так видно, какие клетки выиграли.
    state.rolling = false;
    state.settled = true;
    updateUI(net + goalReward);
    renderRolls();

    await sleep(Math.max(1, settleMs));

    state.settled = false;
    state.bets = {};
    state.stack = [];
    state.highlight.clear();
    updateUI();
  }

  // ---------- История бросков ----------
  const ROLLS_PREVIEW = 6;

  function timeLabel(ts) {
    const d = new Date(Number(ts) || Date.now());
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? time
      : `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${time}`;
  }

  function miniDieHTML(value) {
    return `<span class="mini-die">${pipGridHTML(Number(value))}</span>`;
  }

  // Один бросок: что выпало, что было выбрано (выигравшие ставки —
  // в зелёной рамке) и сколько в итоге вышло.
  function rollRowHTML(entry) {
    const dice = Array.isArray(entry.dice) ? entry.dice.map(Number) : [];
    const hasDice = dice.length === 2 && dice.every((n) => n >= 1 && n <= 6);
    const sum = Number.isFinite(Number(entry.sum))
      ? Number(entry.sum)
      : (hasDice ? dice[0] + dice[1] : null);
    const bet = Number(entry.bet) || 0;
    const net = Number(entry.net) || 0;
    const payout = Number.isFinite(Number(entry.payout))
      ? Number(entry.payout)
      : Math.max(0, bet + net);
    const sign = net > 0 ? 'plus' : net < 0 ? 'minus' : 'zero';
    const tags = Casino.betTagsHTML(entry.bets, entry.wins);

    let title = 'Бросок';
    if (sum !== null) {
      const parts = [`Сумма ${sum}`, sum % 2 ? 'нечет' : 'чёт'];
      if (hasDice && dice[0] === dice[1]) parts.push('дубль');
      title = parts.join(' · ');
    }

    const faces = hasDice
      ? miniDieHTML(dice[0]) + miniDieHTML(dice[1])
      : '<span class="mini-die empty"></span><span class="mini-die empty"></span>';

    return `<article class="roll-row ${sign}">
      <span class="roll-dice">${faces}</span>
      <div class="roll-main">
        <div class="roll-head">
          <span class="roll-title">${title}</span>
          <span class="roll-net ${sign}">${signed(net)}</span>
        </div>
        ${tags}
        <div class="roll-foot">
          <span>ставка ${fmt(bet)}</span>
          <span>выплата ${fmt(payout)}</span>
          <time>${timeLabel(entry.ts)}</time>
        </div>
      </div>
    </article>`;
  }

  function renderRolls() {
    if (!el.rollsList) return;
    const list = Casino.history(GAME_ID);
    if (!list.length) {
      el.rollsList.innerHTML = '<p class="roll-empty">Бросков пока нет. Поставьте фишки на стол '
        + 'и нажмите «Бросить кости» — здесь появится, что вы выбрали, что выпало и сколько выиграли.</p>';
      return;
    }
    el.rollsList.innerHTML = list.slice(0, ROLLS_PREVIEW).map(rollRowHTML).join('');
  }

  function openHistory() {
    const list = Casino.history(GAME_ID);
    openModal(`
      <h2>История бросков</h2>
      ${list.length
        ? `<div class="rolls-list rolls-history-full">${list.map(rollRowHTML).join('')}</div>`
        : '<p class="roll-empty">Бросков пока нет.</p>'}
      <div class="modal-actions">
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

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
        state.rolls = [];
        Casino.save();
        closeModal();
        updateUI();
        renderRolls();
        setMessage('Статистика костей сброшена');
      });
    }
  }

  function closeModal() {
    el.overlay.hidden = true;
    el.modalBody.innerHTML = '';
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus({ preventScroll: true });
  }

  function openRules() {
    openModal(`
      <h2>Правила костей</h2>
      <p>Бросаются <span class="accent">две кости</span>. Сумма очков — от 2 до 12,
      всего 36 равновероятных комбинаций. Сразу несколько ставок разрешены.</p>

      <h3>Ставки на сумму</h3>
      <ul>
        <li><span class="accent">2 и 12</span> — ×31 (прибыль 30 : 1).</li>
        <li><span class="accent">3 и 11</span> — ×16, <span class="accent">4 и 10</span> — ×11,
        <span class="accent">5 и 9</span> — ×8, <span class="accent">6 и 8</span> — ×7,
        <span class="accent">7</span> — ×6.</li>
        <li>Суммы платят почти по настоящим шансам, поэтому у костей самая низкая доля
        казино: почти всё, что поставлено, возвращается игрокам.</li>
      </ul>

      <h3>Внешние ставки</h3>
      <ul>
        <li><span class="accent">Чёт / нечет</span> — ×2, то есть 1 : 1.</li>
        <li><span class="accent">Больше 7</span> и <span class="accent">меньше 7</span> — ×2.
        Семёрка проигрывает обеим ставкам — это преимущество стола.</li>
        <li><span class="accent">Любой дубль</span> (1–1, 2–2, … 6–6) — ×6.</li>
        <li><span class="accent">Точный дубль</span>: 1–1, 2–2 и так далее — ×31.</li>
      </ul>

      <h3>Как играть</h3>
      <ul>
        <li>Выберите номинал фишки и кликайте по клеткам стола.</li>
        <li>«Отменить» убирает последнюю фишку, «Очистить» возвращает все.</li>
        <li>Нажмите «Бросить кости» (или <kbd>Space</kbd>) — кубики покатятся и остановятся
        на выпавших гранях.</li>
        <li>После броска можно нажать «Повторить», чтобы вернуть те же ставки.</li>
        <li>Под столом — история бросков: что выпало, какие ставки были и что выиграло
        (выигравшие обведены зелёным). Клавиша <kbd>H</kbd> открывает всю историю.</li>
      </ul>

      <h3>Лимиты и комбинации</h3>
      <ul>
        <li>Минимальная ставка — ${fmt(MIN_BET)}, максимум на один бросок — ${fmt(maxBet())}
        в сумме по всем клеткам (лимит стола).</li>
        <li>Ставить можно на любые клетки в любом сочетании. Но «зеркальные» ставки
        (чёт + нечет) выиграть не могут: вернётся ровно поставленное.</li>
        <li>А «больше 7» + «меньше 7» оставляют дыру на семёрке: если выпадет 7,
        проигрывают обе ставки. Стол об этом предупредит.</li>
      </ul>

      <h3>Про баланс</h3>
      <p>Баланс общий для всего казино, а статистика и история — отдельные по каждой игре.</p>
      <p>Лимит <b>${fmt(maxBet())}</b> действует на <b>один бросок</b>, а не на вечер.
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
    const rollCount = s.rolls || 0;
    const winRate = s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 100) : 0;

    openModal(`
      <h2>Статистика костей</h2>
      <div class="stat-grid">
        <span>Бросков</span><span>${numFmt.format(rollCount)}</span>
        <span>Побед</span><span>${numFmt.format(s.wins)}</span>
        <span>Поражений</span><span>${numFmt.format(s.losses)}</span>
        <span>Ничьих</span><span>${numFmt.format(s.pushes)}</span>
        <span>Дублей выпало</span><span>${numFmt.format(s.doubles)}</span>
        <span>Доля побед</span><span>${winRate}%</span>
        <span>Оборот ставок</span><span>${fmt(s.wagered)}</span>
        <span>Лучший бросок</span><span>${fmt(s.bestWin)}</span>
        <span>Итог игры</span><span>${signed(s.net)}</span>
        <span>Общий баланс</span><span>${fmt(Casino.getBalance())}</span>
      </div>
      <p style="margin-top:14px;font-size:12px;color:var(--muted)">
        Статистика рулетки и блэкджека считается отдельно — она в их собственных окнах.
      </p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="reset">Сбросить кости</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  // ---------- События ----------
  el.table.addEventListener('click', (event) => {
    const cell = event.target.closest('[data-bet]');
    if (!cell || state.rolling || state.settled) return;
    placeBet(cell.dataset.bet);
  });

  el.chipsRow.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.chip = Number(chip.dataset.chip);
    sfx('chip');
    updateUI();
  });

  el.rollBtn.addEventListener('click', () => roll());
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
      if (!el.rollBtn.disabled) roll();
    } else if (key === 'c') {
      if (!el.clearBtn.disabled) clearBets();
    } else if (key === 'u' || key === 'z') {
      if (!el.undoBtn.disabled) undoBet();
    } else if (key === 'h') {
      openHistory();
    }
  });

  el.modalClose.addEventListener('click', closeModal);
  el.overlay.addEventListener('click', (event) => {
    if (event.target === el.overlay) closeModal();
  });

  el.rulesBtn.addEventListener('click', openRules);
  el.statsBtn.addEventListener('click', openStats);
  el.historyBtn.addEventListener('click', openHistory);
  el.historyTopBtn.addEventListener('click', openHistory);

  // ---------- Тестовый хук ----------
  window.__DICE_TEST__ = {
    state,
    SUMS,
    SUM_MULT,
    PAIRS,
    OUTSIDE,
    FACE_ROTATION,
    betWins,
    multiplier,
    totalBet,
    placeBet,
    clearBets,
    undoBet,
    roll,
    payoutFor,
    analyzeBets,
    renderRolls,
    rollRowHTML,
    chipAmount,
    setTiming({ roll: nextRoll, settle: nextSettle } = {}) {
      if (Number.isFinite(nextRoll)) rollMs = nextRoll;
      if (Number.isFinite(nextSettle)) settleMs = nextSettle;
    },
    /** Подменяет генератор случайных чисел, чтобы выпали нужные грани. */
    forceDice(a, b) {
      const seq = [a - 1, b - 1];
      let i = 0;
      window.crypto.getRandomValues = (array) => {
        array[0] = seq[Math.min(i, seq.length - 1)];
        i += 1;
        return array;
      };
      return seq;
    },
  };

  // ---------- Старт ----------
  // Ставки, «зависшие» в незавершённом броске, возвращаются на баланс.
  Casino.settlePending(GAME_ID);
  state.sound = Casino.getSound();

  const history = Casino.history(GAME_ID);
  state.rolls = history
    .slice(0, 10)
    .map((entry) => ({
      dice: Array.isArray(entry.dice) ? entry.dice.map(Number) : null,
      sum: Number(entry.sum),
    }))
    .filter((entry) => entry.dice && entry.dice.length === 2 && Number.isFinite(entry.sum));

  buildDice();
  const last = history[0];
  if (last && Array.isArray(last.dice) && last.dice.length === 2) {
    const [a, b] = last.dice.map(Number);
    if (a >= 1 && a <= 6 && b >= 1 && b <= 6) {
      applyFaces(a, b);
      setDice(a, b);
    }
  }

  updateUI();
  renderRolls();
  setMessage('Выберите фишку и поставьте на стол');

  if (Casino.getBalance() < MIN_BET) {
    setMessage('Баланс пуст — пополните его на главной странице', 'lose');
  }
})();
