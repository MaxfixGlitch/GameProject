/* ============================================================
   Баккара (пунто-банко) — раздача по правилам и расчёт ставок
   ============================================================ */
(() => {
  'use strict';

  // ---------- Карты ----------
  const SUITS = [
    { sym: '♠', red: false },
    { sym: '♥', red: true },
    { sym: '♦', red: true },
    { sym: '♣', red: false },
  ];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const DECKS = 6;
  const SHOE_REBUILD_AT = 30;

  // В баккаре десятки и картинки стоят ноль, туз — один.
  const cardValue = (rank) => {
    if (rank === 'A') return 1;
    if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;
    return Number(rank);
  };
  const handTotal = (cards) => cards.reduce((sum, card) => sum + cardValue(card.rank), 0) % 10;

  // ---------- Ставки ----------
  const BETS = ['player', 'tie', 'banker'];
  const BET_LABEL = { player: 'Игрок', tie: 'Ничья', banker: 'Банкир' };
  // Полная выплата вместе со ставкой: игрок 1:1 → ×2, ничья 8:1 → ×9.
  // У банкира 5% комиссии, поэтому ×1,95 (округление до рубля).
  const PLAYER_MULT = 2;
  const TIE_MULT = 9;
  const BANKER_RATE = 0.95;

  const Casino = window.Casino;
  const GAME_ID = 'baccarat';

  // Закрытая игра не запускается: прямо по адресу тоже стоит замок.
  if (!Casino.isUnlocked(GAME_ID)) {
    Casino.showLocked(GAME_ID);
    return;
  }
  const MIN_BET = Casino.MIN_BET;
  const maxBet = () => Casino.maxBet();

  // ---------- Состояние ----------
  const state = {
    bets: {},          // ключ ставки -> сумма
    stack: [],         // история кликов для «Отменить»
    lastBets: null,    // для «Повторить»
    chip: 25,
    dealing: false,
    settled: false,
    highlight: new Set(),
    player: [],
    banker: [],
    result: null,      // 'player' | 'banker' | 'tie'
    sound: true,
    shoe: [],
    cardSeq: 0,
    // Для тестов: если задано, шуз не перемешивается.
    fixedShoe: false,
  };

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const el = {
    felt: $('#felt'),
    shoeCount: $('#shoeCount'),
    playerHand: $('#playerHand'),
    bankerHand: $('#bankerHand'),
    playerTotal: $('#playerTotal'),
    bankerTotal: $('#bankerTotal'),
    betSpots: $('#betSpots'),
    message: $('#message'),
    betTotal: $('#betTotal'),
    betLimit: $('#betLimit'),
    betHint: $('#betHint'),
    chipsRow: $('#chipsRow'),
    dealBtn: $('#dealBtn'),
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
    bead: $('#bead'),
    roundsList: $('#roundsList'),
    historyBtn: $('#historyBtn'),
    spots: [...document.querySelectorAll('[data-bet]')],
    chips: [...document.querySelectorAll('.chip')],
  };

  const numFmt = new Intl.NumberFormat('ru-RU');
  // Неразрывный пробел: сумма и знак рубля не должны разрываться по строкам.
  const fmt = (n) => `${numFmt.format(Math.round(n))}\u00A0₽`;
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));

  // Крупные суммы в фишке сокращаются, чтобы влезали в поле ставки.
  function chipAmount(amount) {
    if (amount < 1000) return String(amount);
    const k = amount / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1).replace('.', ',')}k`;
  }

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
      case 'deal':
        beep({ freq: 1100, dur: 0.03, type: 'square', gain: 0.012 });
        break;
      case 'flip':
        beep({ freq: 700, dur: 0.04, type: 'triangle', gain: 0.018 });
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

  // ---------- Шуз ----------
  function buildShoe() {
    const cards = [];
    for (let d = 0; d < DECKS; d++) {
      for (let s = 0; s < SUITS.length; s++) {
        for (const rank of RANKS) cards.push({ id: ++state.cardSeq, rank, suit: s });
      }
    }
    // Фишер—Йетс: честное перемешивание, без смещения к началу колоды.
    for (let i = cards.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    state.shoe = cards;
  }

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

  // «1» в тестовом шузе — это туз: карта должна выглядеть как A, а не 1.
  function normalizeRank(rank) {
    const value = String(rank).toUpperCase();
    return value === '1' ? 'A' : value;
  }

  function takeCard() {
    if (!state.fixedShoe && state.shoe.length < SHOE_REBUILD_AT) buildShoe();
    const card = state.shoe.shift();
    return card || { id: ++state.cardSeq, rank: 'A', suit: 0 };
  }

  // ---------- Правила третьей карты ----------
  /**
   * Тянет ли банкир третью карту.
   * @param {number} bankerTotal — сумма банкира (0..9)
   * @param {number|null} playerThird — достоинство третьей карты игрока (0..9)
   *        или null, если игрок остановился.
   */
  function bankerDraws(bankerTotal, playerThird) {
    const b = bankerTotal;
    if (playerThird === null) return b <= 5;
    if (b <= 2) return true;
    if (b === 3) return playerThird !== 8;
    if (b === 4) return playerThird >= 2 && playerThird <= 7;
    if (b === 5) return playerThird >= 4 && playerThird <= 7;
    if (b === 6) return playerThird === 6 || playerThird === 7;
    return false;
  }

  // ---------- Выплаты ----------
  function payoutFor(key, amount, result) {
    if (!amount) return 0;
    if (result === 'tie') {
      if (key === 'tie') return amount * TIE_MULT;
      return amount; // ставки на игрока и банкира возвращаются
    }
    if (key !== result) return 0;
    if (key === 'banker') return amount + Math.round(amount * BANKER_RATE);
    return amount * PLAYER_MULT;
  }

  function settleBets(bets, result) {
    const wins = [];
    let payout = 0;
    Object.entries(bets).forEach(([key, amount]) => {
      if (!amount) return;
      const value = payoutFor(key, amount, result);
      payout += value;
      if (result === 'tie') {
        if (key === 'tie') wins.push(key);
        return;
      }
      if (key === result) wins.push(key);
    });
    return { payout, wins };
  }

  // ---------- Отрисовка карт ----------
  function cardFrontHTML(card) {
    const suit = SUITS[card.suit];
    const center = card.rank === 'A'
      ? `<b class="ace-suit">${suit.sym}</b>`
      : `<b>${card.rank}</b><i>${suit.sym}</i>`;
    return `
      <div class="card-face card-front ${suit.red ? 'red' : ''}">
        <div class="corner tl"><b>${card.rank}</b><i>${suit.sym}</i></div>
        <div class="pip">${center}</div>
        <div class="corner br"><b>${card.rank}</b><i>${suit.sym}</i></div>
      </div>
      <div class="card-face card-back"></div>`;
  }

  function makeCardEl(card) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card';
    wrapper.dataset.id = String(card.id);
    wrapper.innerHTML = `<div class="card-inner">${cardFrontHTML(card)}</div>`;
    wrapper.setAttribute('aria-label', `${card.rank}${SUITS[card.suit].sym}`);
    return wrapper;
  }

  // ---------- Сообщения ----------
  function setMessage(text, cls = '') {
    el.message.textContent = text;
    el.message.className = `message ${cls}`.trim();
  }

  // ---------- Ставки ----------
  const totalBet = () => Object.values(state.bets).reduce((sum, v) => sum + v, 0);

  // Пустые места под карты: стол не выглядит пустым до первой раздачи.
  const CARD_SLOTS = '<span class="card-slot" aria-hidden="true"></span>'
    + '<span class="card-slot" aria-hidden="true"></span>';

  // Новая ставка после раздачи убирает прошлые карты со стола:
  // как крупье, который сметает отыгранную руку перед следующей.
  function clearTable() {
    state.player = [];
    state.banker = [];
    state.result = null;
    el.playerHand.innerHTML = CARD_SLOTS;
    el.bankerHand.innerHTML = CARD_SLOTS;
    renderTotals();
  }

  function placeBet(key, value = state.chip) {
    if (state.dealing || state.settled) return false;
    if (!BETS.includes(key)) return false;
    if (Casino.getBalance() < value) {
      setMessage('Недостаточно фишек для этой ставки', 'lose');
      return false;
    }
    if (totalBet() + value > maxBet()) {
      setMessage(`Максимальная ставка — ${fmt(maxBet())}`, 'lose');
      return false;
    }

    if (!totalBet() && state.player.length) clearTable();

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
    if (state.dealing || state.settled) return;
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
    if (state.dealing || state.settled) return;
    const refunded = refundBets();
    if (refunded) sfx('chip');
    setMessage('Ставки сняты, фишки вернулись на баланс');
    updateUI(refunded);
  }

  function repeatBets() {
    if (state.dealing || !state.lastBets) return;
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

  // ---------- Подсказка о комбинациях ----------
  function renderBetHint() {
    if (!el.betHint) return;
    if (state.dealing || state.settled) {
      el.betHint.hidden = true;
      return;
    }
    let text = '';
    const player = state.bets.player || 0;
    const banker = state.bets.banker || 0;
    const tie = state.bets.tie || 0;
    if (player > 0 && banker > 0) {
      const spent = player + banker;
      const netPlayer = player * PLAYER_MULT - spent;
      const netBanker = banker + Math.round(banker * BANKER_RATE) - spent;
      text = 'Ставки на игрока и банкира гасят друг друга: '
        + `при победе игрока итог ${signed(netPlayer)}, `
        + `при победе банкира ${signed(netBanker)}, `
        + 'а при ничьей вся сумма вернётся.';
    } else if (tie > 0 && (player > 0 || banker > 0)) {
      text = 'Ничья платит 8 : 1, но выпадает редко: примерно 9,5% раздач.';
    }
    el.betHint.textContent = text;
    el.betHint.hidden = !text;
  }

  // ---------- Обновление интерфейса ----------
  function renderBalance(bump) {
    el.bankroll.textContent = fmt(Casino.getBalance());
    if (bump && el.deltaLayer) {
      const node = document.createElement('span');
      node.className = `delta ${bump > 0 ? 'plus' : 'minus'}`;
      node.textContent = signed(bump);
      el.deltaLayer.appendChild(node);
      setTimeout(() => node.remove(), 1500);
    }
  }

  function renderSound() {
    const on = Casino.getSound();
    Casino.setSoundIcon(el.soundBtn, on);
  }

  function renderSpots() {
    el.spots.forEach((spot) => {
      const key = spot.dataset.bet;
      const amount = state.bets[key] || 0;
      const node = spot.querySelector('.spot-chip');
      if (node) {
        node.hidden = amount <= 0;
        node.textContent = amount > 0 ? chipAmount(amount) : '';
        node.title = amount > 0 ? fmt(amount) : '';
      }
      spot.classList.toggle('has-bet', amount > 0);
      spot.classList.toggle('is-win', state.highlight.has(key));
      spot.classList.toggle('is-lose', state.highlight.size > 0 && amount > 0 && !state.highlight.has(key));
      spot.disabled = state.dealing || state.settled;
    });
  }

  function renderTotals() {
    const p = state.player.length ? String(handTotal(state.player)) : '';
    const b = state.banker.length ? String(handTotal(state.banker)) : '';
    el.playerTotal.textContent = p;
    el.bankerTotal.textContent = b;
    el.playerTotal.classList.toggle('win',
      state.result === 'player' && state.settled);
    el.bankerTotal.classList.toggle('win',
      state.result === 'banker' && state.settled);
  }

  function renderShoe() {
    if (el.shoeCount) el.shoeCount.textContent = String(state.shoe.length);
  }

  function updateUI(bump) {
    const total = totalBet();
    el.betTotal.textContent = fmt(total);
    el.betTotal.classList.toggle('full', total >= maxBet());
    if (el.betLimit) el.betLimit.textContent = `из ${fmt(maxBet())}`;
    renderBetHint();

    const locked = state.dealing || state.settled;
    el.dealBtn.disabled = locked || total < MIN_BET;
    el.undoBtn.disabled = locked || state.stack.length === 0;
    el.clearBtn.disabled = locked || total === 0;
    el.repeatBtn.hidden = locked || !state.lastBets || total > 0;

    el.chips.forEach((chip) => {
      const value = Number(chip.dataset.chip);
      chip.classList.toggle('selected', value === state.chip);
      chip.disabled = locked || Casino.getBalance() < value;
    });
    Casino.syncChips(el.chipsRow);

    renderBalance(bump);
    renderSpots();
    renderTotals();
    renderShoe();
    renderSound();
  }

  // ---------- Раздача ----------
  // Длительности вынесены в let: тесты прогоняют раздачу без ожидания.
  let dealMs = 420;
  let settleMs = 2200;

  async function dealCard(container, card) {
    const node = makeCardEl(card);
    node.classList.add('face-down', 'dealing');
    container.appendChild(node);
    sfx('deal');
    await sleep(dealMs * 0.55);
    node.classList.remove('face-down');
    sfx('flip');
    await sleep(dealMs * 0.45);
    return node;
  }

  async function deal() {
    if (state.dealing || state.settled) return;
    const total = totalBet();
    if (total < MIN_BET) {
      setMessage('Сначала поставьте фишки на поле', 'lose');
      return;
    }

    state.dealing = true;
    state.result = null;
    state.highlight.clear();
    state.lastBets = Object.assign({}, state.bets);
    state.player = [];
    state.banker = [];
    el.playerHand.innerHTML = '';
    el.bankerHand.innerHTML = '';
    setMessage('Раздача…');
    updateUI();

    // Порядок как в настоящей баккаре: игрок, банкир, игрок, банкир.
    const first = takeCard();
    state.player.push(first);
    await dealCard(el.playerHand, first);
    renderTotals();

    const second = takeCard();
    state.banker.push(second);
    await dealCard(el.bankerHand, second);
    renderTotals();

    const third = takeCard();
    state.player.push(third);
    await dealCard(el.playerHand, third);
    renderTotals();

    const fourth = takeCard();
    state.banker.push(fourth);
    await dealCard(el.bankerHand, fourth);
    renderTotals();

    // Натуральная восьмёрка или девятка — третьих карт нет.
    const playerNatural = handTotal(state.player) >= 8;
    const bankerNatural = handTotal(state.banker) >= 8;

    if (!playerNatural && !bankerNatural) {
      let playerThird = null;
      if (handTotal(state.player) <= 5) {
        playerThird = takeCard();
        state.player.push(playerThird);
        await dealCard(el.playerHand, playerThird);
        renderTotals();
      }

      const playerThirdValue = playerThird ? cardValue(playerThird.rank) : null;
      if (bankerDraws(handTotal(state.banker), playerThirdValue)) {
        const bankerThird = takeCard();
        state.banker.push(bankerThird);
        await dealCard(el.bankerHand, bankerThird);
        renderTotals();
      }
    }

    await finishRound(total);
  }

  async function finishRound(total) {
    const pTotal = handTotal(state.player);
    const bTotal = handTotal(state.banker);
    const result = pTotal > bTotal ? 'player' : bTotal > pTotal ? 'banker' : 'tie';
    state.result = result;

    const { payout, wins } = settleBets(state.bets, result);
    const baseNet = payout - total;

    // Страховка из целей: при проигрыше возвращает половину потерь.
    let insurance = 0;
    if (baseNet < 0 && Casino.shields() > 0 && Casino.useShield()) {
      insurance = Math.ceil(-baseNet / 2);
    }
    const net = baseNet + insurance;

    if (payout > 0) Casino.payout(GAME_ID, payout);
    if (insurance > 0) Casino.payout(GAME_ID, insurance);

    const stats = Casino.stats(GAME_ID);
    stats.rounds += 1;
    stats.wagered += total;
    stats.net += net;
    if (result === 'player') stats.playerWins += 1;
    else if (result === 'banker') stats.bankerWins += 1;
    else stats.ties += 1;
    if (net > 0) {
      stats.wins += 1;
      stats.bestWin = Math.max(stats.bestWin, net);
    } else if (net < 0) {
      stats.losses += 1;
    } else {
      stats.pushes += 1;
    }

    const resultLabel = result === 'player' ? 'победа игрока'
      : result === 'banker' ? 'победа банкира' : 'ничья';
    const summary = `Игрок ${pTotal} · Банкир ${bTotal} — ${resultLabel}`;

    Casino.pushHistory(GAME_ID, {
      ts: Date.now(),
      bet: total,
      net,
      result,
      playerTotal: pTotal,
      bankerTotal: bTotal,
      playerCards: state.player.map((card) => `${card.rank}${SUITS[card.suit].sym}`),
      bankerCards: state.banker.map((card) => `${card.rank}${SUITS[card.suit].sym}`),
      bets: Object.assign({}, state.bets),
      wins,
      payout: payout + insurance,
      insurance,
      summary,
    });
    Casino.setPending(GAME_ID, 0);
    Casino.save();

    state.highlight = new Set(wins);

    let message;
    let messageClass = '';
    const score = `Игрок ${pTotal} · Банкир ${bTotal}`;
    if (result === 'tie') {
      message = `Ничья ${pTotal} : ${bTotal}`;
      messageClass = 'push';
      if (wins.includes('tie')) {
        message += ` — выигрыш ${fmt(net > 0 ? net : payout)}`;
        messageClass = 'win';
        sfx('win');
      } else if (payout > 0) {
        message += ' — ставки на игрока и банкира возвращены';
        sfx('push');
      } else {
        message += ' — ставки проиграли';
        messageClass = 'lose';
        sfx('lose');
      }
    } else if (net > 0) {
      message = `${score} — выигрыш ${fmt(net)}`;
      messageClass = 'win';
      sfx('win');
    } else if (net < 0) {
      message = `${score} — проигрыш ${fmt(-net)}`;
      if (insurance > 0) message += ` · страховка вернула ${fmt(insurance)}`;
      messageClass = 'lose';
      sfx('lose');
    } else {
      // Ставки на игрока и банкира могут скомпенсировать друг друга.
      message = `${score} — выплата ${fmt(payout)}, ставки отбились`;
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

    // Ставки уже разыграны, но на секунду остаются на поле:
    // так видно, какая ставка сработала.
    state.dealing = false;
    state.settled = true;
    updateUI(net + goalReward);
    renderRounds();
    renderBead();

    await sleep(settleMs);

    state.settled = false;
    state.bets = {};
    state.stack = [];
    state.highlight.clear();
    state.result = null;
    updateUI();
  }

  // ---------- Дорожка ----------
  const BEAD_MAX = 24;

  function renderBead() {
    if (!el.bead) return;
    const list = Casino.history(GAME_ID).slice(0, BEAD_MAX);
    if (!list.length) {
      el.bead.innerHTML = '<span class="bead-empty">Здесь появятся последние исходы: игрок, банкир или ничья.</span>';
      return;
    }
    el.bead.innerHTML = list.map((entry) => {
      const result = entry.result === 'player' || entry.result === 'banker' || entry.result === 'tie'
        ? entry.result
        : 'tie';
      const letter = result === 'player' ? 'И' : result === 'banker' ? 'Б' : 'Н';
      const title = `${BET_LABEL[result]} · ${entry.playerTotal} : ${entry.bankerTotal}`;
      return `<span class="bead-cell ${result}" title="${title}">${letter}</span>`;
    }).join('');
  }

  // ---------- История раздач ----------
  const ROUNDS_PREVIEW = 6;


  function roundRowHTML(entry) {
    const p = Number.isFinite(Number(entry.playerTotal)) ? Number(entry.playerTotal) : 0;
    const b = Number.isFinite(Number(entry.bankerTotal)) ? Number(entry.bankerTotal) : 0;
    const result = entry.result === 'player' || entry.result === 'banker' ? entry.result : 'tie';
    const bet = Number(entry.bet) || 0;
    const net = Number(entry.net) || 0;
    const payout = Number.isFinite(Number(entry.payout))
      ? Number(entry.payout)
      : Math.max(0, bet + net);
    const sign = net > 0 ? 'plus' : net < 0 ? 'minus' : 'zero';
    const tags = Casino.betTagsHTML(entry.bets, entry.wins);
    const title = entry.summary || `${BET_LABEL[result]} · ${p} : ${b}`;
    const pc = Array.isArray(entry.playerCards) ? entry.playerCards : [];
    const bc = Array.isArray(entry.bankerCards) ? entry.bankerCards : [];
    const cards = pc.length || bc.length
      ? `<p class="round-cards">
          <span class="round-cards-hand"><b>Игрок</b> ${pc.join(' ') || '—'}</span>
          <span class="round-cards-sep">·</span>
          <span class="round-cards-hand"><i>Банкир</i> ${bc.join(' ') || '—'}</span>
        </p>`
      : '';

    return `<article class="round-row ${sign}">
      <span class="round-score"><b>${p}</b><span class="sep">:</span><i>${b}</i></span>
      <div class="round-main">
        <div class="round-head">
          <span class="round-title">${title}</span>
          <span class="round-net ${sign}">${signed(net)}</span>
        </div>
        ${tags}
        ${cards}
        <div class="round-foot">
          <span>ставка ${fmt(bet)}</span>
          <span>выплата ${fmt(payout)}${Casino.insuranceTagHTML(entry)}</span>
        </div>
      </div>
      <time class="round-time">${Casino.timeLabel(entry.ts)}</time>
    </article>`;
  }

  function renderRounds() {
    if (!el.roundsList) return;
    const list = Casino.history(GAME_ID);
    if (!list.length) {
      el.roundsList.innerHTML = '<p class="round-empty">Раздач пока нет. Поставьте фишки '
        + 'на игрока, банкира или ничью и нажмите «Раздать» — здесь появится, что вы выбрали, '
        + 'какие были карты и сколько выиграли.</p>';
      return;
    }
    el.roundsList.innerHTML = list.slice(0, ROUNDS_PREVIEW).map(roundRowHTML).join('');
  }

  function openHistory() {
    const list = Casino.history(GAME_ID);
    openModal(`
      <h2>История раздач</h2>
      <div class="modal-scroll">
        ${list.length
          ? `<div class="rounds-list rounds-history-full">${list.map(roundRowHTML).join('')}</div>`
          : '<p class="round-empty">Раздач пока нет.</p>'}
      </div>
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
    // История прокручивает только список раундов, заголовок стоит.
    el.modalBody.classList.toggle('has-scroll', Boolean(el.modalBody.querySelector('.modal-scroll')));
    el.overlay.hidden = false;
    el.modalClose.focus({ preventScroll: true });
    el.modalBody.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
    const reset = el.modalBody.querySelector('[data-action="reset"]');
    if (reset) {
      reset.addEventListener('click', () => {
        Casino.resetGame(GAME_ID);
        Casino.save();
        closeModal();
        updateUI();
        renderRounds();
        renderBead();
        setMessage('Статистика баккары сброшена');
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
      <h2>Правила баккары</h2>
      <p>Баккара (пунто-банко) — игра на две руки: <span class="accent">игрок</span> и
      <span class="accent">банкир</span>. Решения за них принимает раздача по правилам,
      а вы только выбираете, кто победит. Играет роль сумма: у кого она ближе к девяти.</p>

      <h3>Стоимость карт</h3>
      <ul>
        <li>Туз — <span class="accent">1</span>, карты 2–9 — по номиналу.</li>
        <li>10, дама, король и валет — <span class="accent">0</span>.</li>
        <li>Очки считаются по последней цифре суммы: 9 + 7 = 16, значит <span class="accent">6</span>.</li>
      </ul>

      <h3>Как идёт раздача</h3>
      <ul>
        <li>Сначала по две карты: игроку и банкиру.</li>
        <li>Если у кого-то <span class="accent">8 или 9</span> — это «натуральная» рука,
        третьи карты не выдаются.</li>
        <li>Игрок тянет третью карту при сумме <span class="accent">0–5</span> и
        останавливается на 6–7.</li>
        <li>Банкир тянет по таблице, которая зависит от его суммы и от третьей карты игрока.
        Если игрок остановился, банкир тянет на 0–5.</li>
      </ul>

      <h3>Третья карта банкира</h3>
      <div class="rules-grid">
        <span>0–2</span><span>тянет всегда</span>
        <span>3</span><span>тянет, если у игрока не 8</span>
        <span>4</span><span>тянет при 2–7 у игрока</span>
        <span>5</span><span>тянет при 4–7 у игрока</span>
        <span>6</span><span>тянет при 6–7 у игрока</span>
        <span>7</span><span>стоит</span>
      </div>
      <p>Таблица действует, когда игрок уже взял третью карту. Натуральные 8 и 9
      останавливают раздачу сразу.</p>

      <h3>Ставки и выплаты</h3>
      <ul>
        <li><span class="accent">Игрок</span> — 1 : 1.</li>
        <li><span class="accent">Банкир</span> — 0,95 : 1: казино берёт 5% комиссии,
        поэтому у банкира лучшие шансы.</li>
        <li><span class="accent">Ничья</span> — 8 : 1.</li>
        <li>При ничьей ставки на игрока и банкира <span class="accent">возвращаются</span>,
        платит только ставка на ничью.</li>
        <li>Ставить можно на несколько полей сразу — остальное посчитается само.</li>
      </ul>

      <h3>Почему банкир выгоднее</h3>
      <p>Банкир выигрывает чуть чаще игрока, потому что тянет третью карту вторым —
      он уже знает, что пришло игроку. Комиссия 5% как раз компенсирует это преимущество.</p>

      <h3>Как играть</h3>
      <ul>
        <li>Выберите номинал фишки и кликните по полю «Игрок», «Ничья» или «Банкир».</li>
        <li>«Отменить» убирает последнюю фишку, «Очистить» возвращает все.</li>
        <li>Нажмите «Раздать» (или <kbd>Space</kbd>) — карты выйдут по правилам.</li>
        <li>После раздачи можно нажать «Повторить», чтобы вернуть те же ставки.</li>
        <li>Ниже — дорожка исходов и история раздач. Клавиша <kbd>H</kbd> открывает всё.</li>
      </ul>

      <h3>Лимиты</h3>
      <ul>
        <li>Минимальная ставка — ${fmt(MIN_BET)}, максимум на одну раздачу — ${fmt(maxBet())}
        в сумме по всем полям (лимит стола).</li>
        <li>Лимит действует на <b>одну раздачу</b>, а не на вечер: как в казино,
        где лимит стола ограничивает ставку, а не все ставки за ночь.</li>
        <li>Бесплатные <span class="accent">+1 000\u00A0₽</span> — раз в 30 минут, на главной странице.
        Цели, звания и страховки общие для всех игр.</li>
      </ul>

      <h3>Страховка</h3>
      <p>Страховки приходят за цели. Если раздача ушла в минус, страховка
        срабатывает сама и возвращает половину потерь. На выигрыш она не
        тратится, сгорает не больше одной за раздачу.</p>

      <div class="modal-actions">
        <button class="primary-btn" data-close>Понятно</button>
      </div>
    `);
  }

  function openStats() {
    const s = Casino.stats(GAME_ID);
    const rounds = s.rounds || 0;
    const winRate = s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 100) : 0;

    openModal(`
      <h2>Статистика баккары</h2>
      <div class="stat-grid">
        <span>Раздач</span><span>${numFmt.format(rounds)}</span>
        <span>Побед</span><span>${numFmt.format(s.wins)}</span>
        <span>Поражений</span><span>${numFmt.format(s.losses)}</span>
        <span>Нейтральных раздач</span><span>${numFmt.format(s.pushes)}</span>
        <span>Побед игрока</span><span>${numFmt.format(s.playerWins)}</span>
        <span>Побед банкира</span><span>${numFmt.format(s.bankerWins)}</span>
        <span>Ничьих</span><span>${numFmt.format(s.ties)}</span>
        <span>Доля побед</span><span>${winRate}%</span>
        <span>Оборот ставок</span><span>${fmt(s.wagered)}</span>
        <span>Лучшая раздача</span><span>${fmt(s.bestWin)}</span>
        <span>Итог игры</span><span>${signed(s.net)}</span>
        <span>Общий баланс</span><span>${fmt(Casino.getBalance())}</span>
      </div>
      <p style="margin-top:14px;font-size:12px;color:var(--muted)">
        Статистика других игр считается отдельно — она в их собственных окнах.
      </p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="reset">Сбросить баккару</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  // ---------- События ----------
  el.betSpots.addEventListener('click', (event) => {
    const spot = event.target.closest('[data-bet]');
    if (!spot || state.dealing || state.settled) return;
    placeBet(spot.dataset.bet);
  });

  el.chipsRow.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    state.chip = Number(chip.dataset.chip);
    sfx('chip');
    updateUI();
  });

  el.dealBtn.addEventListener('click', () => deal());
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
      if (!el.dealBtn.disabled) deal();
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
  window.__BAC_TEST__ = {
    state,
    BETS,
    BET_LABEL,
    SUITS,
    cardValue,
    handTotal,
    bankerDraws,
    payoutFor,
    settleBets,
    totalBet,
    placeBet,
    clearBets,
    undoBet,
    deal,
    renderRounds,
    renderBead,
    roundRowHTML,
    chipAmount,
    setTiming({ deal: nextDeal, settle: nextSettle } = {}) {
      if (Number.isFinite(nextDeal)) dealMs = nextDeal;
      if (Number.isFinite(nextSettle)) settleMs = nextSettle;
    },
    /** Кладёт нужные карты в начало шуза (строки вида 'A', '10', 'K'). */
    setShoe(ranks) {
      state.fixedShoe = true;
      state.shoe = ranks.map((rank, index) => ({
        id: ++state.cardSeq,
        rank: normalizeRank(rank),
        suit: index % 4,
      }));
      return state.shoe.length;
    },
    /** Возвращает шуз к случайной колоде. */
    freeShoe() {
      state.fixedShoe = false;
      buildShoe();
      return state.shoe.length;
    },
  };

  // ---------- Старт ----------
  // Ставки, «зависшие» в незавершённой раздаче, возвращаются на баланс.
  Casino.settlePending(GAME_ID);
  state.sound = Casino.getSound();
  buildShoe();

  el.playerHand.innerHTML = CARD_SLOTS;
  el.bankerHand.innerHTML = CARD_SLOTS;

  updateUI();
  renderRounds();
  renderBead();
  setMessage('Выберите фишку и поставьте на игрока, банкира или ничью');

  if (Casino.getBalance() < MIN_BET) {
    setMessage('Баланс пуст — пополните его на главной странице', 'lose');
  }
})();
