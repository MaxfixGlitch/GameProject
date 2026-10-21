/* ============================================================
   Блэкджек 21 — игровая логика
   ============================================================ */
(() => {
  'use strict';

  // ---------- Константы ----------
  const SUITS = [
    { sym: '♠', red: false },
    { sym: '♥', red: true },
    { sym: '♦', red: true },
    { sym: '♣', red: false },
  ];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const DECKS = 6;
  const SHOE_REBUILD_AT = 30;

  // Кошелёк, история и статистика живут в общем ядре казино.
  const Casino = window.Casino;
  const GAME_ID = 'blackjack';
  const START_BANKROLL = Casino.START_BANKROLL;
  const MIN_BET = Casino.MIN_BET;
  const MAX_BET = Casino.MAX_BET;

  // Стопка фишек на столе: видно не больше BET_STACK_MAX штук,
  // нижняя стоит над суммой ставки, верх не выходит за круг.
  const BET_STACK_MAX = 8;
  const BET_STACK_BASE = 30;
  const BET_STACK_CEIL = 93;
  const CHIP_TILT = [-5, 3, -2, 4.5, -3.5, 2, -4, 5];
  const CHIP_SWAY = [-1.5, 1.5, 0, -2, 1, 2, -1, 0.5];

  // История раздач: храним последние HISTORY_MAX раундов (свежие сверху).
  const HISTORY_MAX = Casino.HISTORY_MAX;
  const HISTORY_RESULTS = ['win', 'blackjack', 'lose', 'bust', 'push'];
  const RESULT_LABEL = {
    win: 'Победа',
    blackjack: 'Блэкджек!',
    lose: 'Дилер сильнее',
    bust: 'Перебор',
    push: 'Ничья',
  };

  // ---------- Состояние ----------
  const state = {
    // Эти три поля живут в общем ядре казино: баланс общий на все игры,
    // история и статистика — отдельные для блэкджека.
    get bankroll() { return Casino.getBalance(); },
    set bankroll(value) { Casino.setBalance(value); },
    get stats() { return Casino.stats(GAME_ID); },
    set stats(value) { Casino.setStats(GAME_ID, value); },
    get history() { return Casino.history(GAME_ID); },
    set history(value) { Casino.setHistory(GAME_ID, value); },
    bet: 0,
    betChips: [],
    phase: 'betting', // betting | dealing | player | dealer
    dealer: [],
    dealerHidden: false,
    hands: [],
    active: 0,
    busy: false,
    sound: true,
    message: '',
    messageClass: '',
    shoe: [],
    handSeq: 0,
  };

  // Поколение игры: сброс увеличивает счётчик, чтобы незавершённые
  // асинхронные раздачи не продолжились после «Начать заново».
  let session = 0;

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const el = {
    bankroll: $('#bankroll'),
    deltaLayer: $('#deltaLayer'),
    shoeCount: $('#shoeCount'),
    dealerHand: $('#dealerHand'),
    dealerTotal: $('#dealerTotal'),
    hands: $('#hands'),
    historyBtn: $('#historyBtn'),
    message: $('#message'),
    betSpot: $('#betSpot'),
    betChips: $('#betChips'),
    betAmount: $('#betAmount'),
    chips: [...document.querySelectorAll('.chip')],
    betPanel: $('#betPanel'),
    actionPanel: $('#actionPanel'),
    rebuyPanel: $('#rebuyPanel'),
    dealBtn: $('#dealBtn'),
    clearBet: $('#clearBet'),
    hitBtn: $('#hitBtn'),
    standBtn: $('#standBtn'),
    doubleBtn: $('#doubleBtn'),
    splitBtn: $('#splitBtn'),
    rebuyBtn: $('#rebuyBtn'),
    soundBtn: $('#soundBtn'),
    rulesBtn: $('#rulesBtn'),
    statsBtn: $('#statsBtn'),
    resetBtn: $('#resetBtn'),
    overlay: $('#overlay'),
    modalBody: $('#modalBody'),
    modalClose: $('#modalClose'),
  };

  el.message.setAttribute('aria-live', 'polite');

  // ---------- Утилиты ----------
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const numFmt = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => `${numFmt.format(Math.round(n))} ₽`;
  const fmtDelta = (n) => `${n > 0 ? '+' : '−'}${numFmt.format(Math.abs(Math.round(n)))} ₽`;

  // ---------- Случайность ----------
  function randomInt(max) {
    if (window.crypto?.getRandomValues) {
      const limit = Math.floor(0xffffffff / max) * max;
      let x;
      do {
        x = window.crypto.getRandomValues(new Uint32Array(1))[0];
      } while (x >= limit);
      return x % max;
    }
    return Math.floor(Math.random() * max);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- Колода ----------
  let cardSeq = 0;

  function buildShoe() {
    state.shoe = [];
    for (let d = 0; d < DECKS; d++) {
      for (let s = 0; s < SUITS.length; s++) {
        for (const rank of RANKS) {
          state.shoe.push({ id: ++cardSeq, rank, suit: s });
        }
      }
    }
    shuffle(state.shoe);
  }

  function rankValue(rank) {
    if (rank === 'A') return 11;
    if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
    return Number(rank);
  }

  function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
      total += rankValue(card.rank);
      if (card.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return total;
  }

  const isNatural = (cards) => cards.length === 2 && handValue(cards) === 21;

  // Мягкая рука: туз ещё считается за 11. Возвращает вторую (меньшую) сумму.
  function softBase(cards) {
    if (!cards.some((card) => card.rank === 'A')) return null;
    let base = 0;
    for (const card of cards) base += card.rank === 'A' ? 1 : rankValue(card.rank);
    return base + 10 <= 21 ? base : null;
  }

  function totalLabel(cards) {
    const total = handValue(cards);
    const base = softBase(cards);
    if (base !== null && !isNatural(cards)) return `${base}/${total}`;
    return String(total);
  }

  // ---------- Сохранение ----------
  function pendingStake() {
    if (state.phase === 'betting') return state.bet;
    return state.hands.reduce((sum, h) => sum + h.bet, 0);
  }

  function save() {
    Casino.setPending(GAME_ID, pendingStake());
    Casino.setSound(state.sound);
    Casino.save();
  }

  // История из localStorage может быть старой или битой — приводим к безопасному виду.
  function sanitizeHistory(raw) {
    if (!Array.isArray(raw)) return [];
    const num = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
    return raw.slice(0, HISTORY_MAX).map((entry, index) => {
      const hands = Array.isArray(entry?.hands) ? entry.hands : [];
      return {
        n: num(entry?.n) || index + 1,
        bet: Math.max(0, num(entry?.bet)),
        net: num(entry?.net),
        dealerTotal: Math.max(0, num(entry?.dealerTotal)),
        dealerCards: Math.max(0, num(entry?.dealerCards)),
        dealerNatural: Boolean(entry?.dealerNatural),
        hands: hands.slice(0, 4).map((hand) => ({
          total: Math.max(0, num(hand?.total)),
          soft: Boolean(hand?.soft),
          softTotal: hand?.softTotal === null || hand?.softTotal === undefined
            ? null
            : Math.max(0, num(hand.softTotal)),
          result: HISTORY_RESULTS.includes(hand?.result) ? hand.result : 'lose',
          bet: Math.max(0, num(hand?.bet)),
          payout: Math.max(0, num(hand?.payout)),
          doubled: Boolean(hand?.doubled),
        })),
      };
    });
  }

  function load() {
    // Незавершённый раунд (закрытая вкладка) возвращает ставку на баланс.
    Casino.settlePending(GAME_ID);
    state.sound = Casino.getSound();
    state.history = sanitizeHistory(state.history);
    Casino.save();
  }

  // ---------- Звук ----------
  let audioCtx = null;

  function getAudio() {
    if (!state.sound) return null;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function beep({ freq = 440, dur = 0.08, type = 'sine', gain = 0.04, at = 0, slide = 0 }) {
    const ctx = getAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(50, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function sfx(name) {
    if (!state.sound) return;
    switch (name) {
      case 'deal':
        beep({ freq: 560, dur: 0.05, type: 'triangle', gain: 0.035, slide: -200 });
        break;
      case 'chip':
        beep({ freq: 900, dur: 0.045, type: 'square', gain: 0.018 });
        beep({ freq: 1340, dur: 0.05, type: 'square', gain: 0.014, at: 0.03 });
        break;
      case 'flip':
        beep({ freq: 320, dur: 0.09, type: 'triangle', gain: 0.03, slide: 240 });
        break;
      case 'win':
        [523.25, 659.25, 783.99].forEach((f, i) =>
          beep({ freq: f, dur: 0.16, type: 'sine', gain: 0.05, at: i * 0.09 }));
        break;
      case 'blackjack':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          beep({ freq: f, dur: 0.2, type: 'triangle', gain: 0.05, at: i * 0.085 }));
        break;
      case 'lose':
        beep({ freq: 220, dur: 0.26, type: 'sine', gain: 0.045, slide: -70 });
        break;
      case 'push':
        beep({ freq: 440, dur: 0.13, type: 'sine', gain: 0.04 });
        beep({ freq: 440, dur: 0.13, type: 'sine', gain: 0.04, at: 0.16 });
        break;
      default:
        break;
    }
  }

  // ---------- Сообщения ----------
  function setMessage(text, cls = '') {
    state.message = text;
    state.messageClass = cls;
    if (el.message.textContent !== text) el.message.textContent = text;
    el.message.className = `message ${cls}`.trim();
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

  function syncCards(container, cards, hiddenIndexes) {
    const existing = new Map();
    container.querySelectorAll(':scope > .card').forEach((node) => {
      existing.set(node.dataset.id, node);
    });

    cards.forEach((card, index) => {
      const key = String(card.id);
      let node = existing.get(key);
      if (node) {
        existing.delete(key);
      } else {
        node = makeCardEl(card);
        container.appendChild(node);
        node.classList.add('dealing');
        setTimeout(() => node.classList.remove('dealing'), 430);
      }
      node.classList.toggle('face-down', hiddenIndexes.includes(index));
      node.style.zIndex = String(index + 1);
    });

    existing.forEach((node) => node.remove());
    container.classList.toggle('compact', cards.length > 4);
  }

  // ---------- Отрисовка ----------
  function renderBankroll() {
    el.bankroll.textContent = fmt(state.bankroll);
  }

  function showDelta(amount) {
    if (!amount) return;
    const node = document.createElement('span');
    node.className = `delta ${amount < 0 ? 'negative' : ''}`;
    node.textContent = fmtDelta(amount);
    el.deltaLayer.appendChild(node);
    setTimeout(() => node.remove(), 1600);
  }

  function renderShoe() {
    el.shoeCount.textContent = String(state.shoe.length);
  }

  function renderDealer() {
    const hidden = state.dealerHidden && state.dealer.length > 1 ? [1] : [];
    syncCards(el.dealerHand, state.dealer, hidden);

    if (!state.dealer.length) {
      el.dealerTotal.textContent = '';
      el.dealerTotal.className = 'total-badge';
      return;
    }

    if (hidden.length) {
      el.dealerTotal.textContent = `${handValue([state.dealer[0]])} + ?`;
      el.dealerTotal.className = 'total-badge';
      return;
    }

    const total = handValue(state.dealer);
    el.dealerTotal.textContent = totalLabel(state.dealer);
    el.dealerTotal.className = `total-badge${
      total > 21 ? ' bust' : isNatural(state.dealer) ? ' blackjack' : ''
    }`;
  }

  function createSlot() {
    const slot = document.createElement('div');
    slot.className = 'hand-slot';
    slot.innerHTML = `
      <div class="hand"></div>
      <div class="hand-foot">
        <span class="hand-total"></span>
        <span class="hand-bet"></span>
      </div>
      <div class="hand-result"></div>`;
    return slot;
  }

  function renderPlayer() {
    while (el.hands.children.length < state.hands.length) {
      el.hands.appendChild(createSlot());
    }
    while (el.hands.children.length > state.hands.length) {
      el.hands.lastElementChild.remove();
    }

    state.hands.forEach((hand, index) => {
      const slot = el.hands.children[index];
      const cardsEl = slot.querySelector('.hand');
      syncCards(cardsEl, hand.cards, []);

      const isActive = state.phase === 'player' && index === state.active && !hand.done;
      slot.classList.toggle('active', isActive);
      slot.classList.toggle('done', state.phase === 'player' && hand.done);

      const total = handValue(hand.cards);
      const totalEl = slot.querySelector('.hand-total');
      totalEl.textContent = hand.cards.length ? totalLabel(hand.cards) : '';
      totalEl.classList.toggle('bust', total > 21);

      const betEl = slot.querySelector('.hand-bet');
      betEl.textContent = state.hands.length > 1 || hand.doubled ? fmt(hand.bet) : '';

      const resultEl = slot.querySelector('.hand-result');
      resultEl.textContent = hand.result ? RESULT_LABEL[hand.result] || '' : '';
      resultEl.className = `hand-result ${hand.result || ''}`.trim();
    });
  }

  // ---------- История раздач ----------
  const handTotal = (cards) => (Array.isArray(cards) ? handValue(cards) : 0);

  function recordHistoryEntry(net, totalBet) {
    const dealerCards = Array.isArray(state.dealer) ? state.dealer : [];
    const entry = {
      n: state.stats.rounds,
      ts: Date.now(),
      bet: Math.round(totalBet),
      net: Math.round(net),
      dealerTotal: handTotal(dealerCards),
      dealerCards: dealerCards.length,
      dealerNatural: isNatural(dealerCards),
      hands: (state.hands || []).map((hand) => {
        const total = handTotal(hand.cards);
        let result = hand.result || 'lose';
        // Перебор узнаём по очкам: старые сохранения могли не иметь флага.
        if (result === 'lose' && total > 21) result = 'bust';
        // Мягкая рука записывается как на столе: 7/17.
        const base = softBase(hand.cards);
        const soft = base !== null && !isNatural(hand.cards);
        return {
          total,
          soft,
          softTotal: soft ? base : null,
          result,
          bet: Math.round(hand.bet),
          payout: Math.round(hand.payout || 0),
          doubled: Boolean(hand.doubled),
        };
      }),
    };
    // Краткое описание для общей истории на хабе.
    const handTotals = entry.hands.map((h) => h.total).join(', ');
    entry.summary = entry.dealerNatural
      ? `Блэкджек у дилера · ваши: ${handTotals}`
      : `Дилер ${entry.dealerTotal} · ваши: ${handTotals}`;

    state.history.unshift(entry);
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
  }

  // Короткие подписи: в истории они стоят внутри компактных плашек.
  const HISTORY_RESULT_LABEL = {
    win: 'победа',
    blackjack: 'блэкджек',
    lose: 'проигрыш',
    bust: 'перебор',
    push: 'ничья',
  };

  function historyResultLabel(result) {
    return HISTORY_RESULT_LABEL[result] || '';
  }

  function renderHistory() {
    // Узел существует только пока открыто модальное окно.
    const body = el.modalBody.querySelector('#historyBody');
    if (!body) return;
    const history = Array.isArray(state.history) ? state.history : [];

    if (!history.length) {
      body.innerHTML = `
        <p class="history-empty">Здесь появятся последние раздачи: очки, ставка
        и результат каждого раунда. Сыграйте первую руку.</p>
      `;
      return;
    }

    const rounds = history.map((entry) => {
      const sign = entry.net > 0 ? 'plus' : entry.net < 0 ? 'minus' : 'zero';
      const netText = entry.net === 0
        ? '0 ₽'
        : `${entry.net > 0 ? '+' : '−'}${numFmt.format(Math.abs(entry.net))} ₽`;

      const hands = (entry.hands || []).map((hand) => `
        <div class="history-hand ${hand.result}">
          <span class="history-hand-total"${hand.soft ? ' title="Мягкая рука: туз считается за 11"' : ''}>${hand.soft && hand.softTotal ? `${hand.softTotal}/${hand.total}` : hand.total}</span>
          <span class="history-hand-result">${historyResultLabel(hand.result)}</span>
          <span class="history-hand-bet">${hand.doubled ? '×2 · ' : ''}${fmt(hand.bet)}</span>
        </div>
      `).join('');

      return `
        <article class="history-round">
          <header class="history-round-head">
            <span class="history-round-num">#${entry.n}</span>
            <span class="history-round-net ${sign}">${netText}</span>
            <span class="history-round-bet">ставка ${fmt(entry.bet)}</span>
          </header>
          <div class="history-dealer">
            <span class="history-dealer-label">Дилер</span>
            <span class="history-dealer-total">${entry.dealerTotal}${entry.dealerNatural ? ' · блэкджек' : ''}</span>
            <span class="history-dealer-cards">${entry.dealerCards} карт.</span>
          </div>
          <div class="history-hands">${hands}</div>
        </article>
      `;
    }).join('');

    body.innerHTML = `
      <p class="history-note">Раздач в истории: ${history.length}, свежие сверху.
      Очки показаны по каждой руке игрока.</p>
      <div class="history-list">${rounds}</div>
    `;
  }

  // ---------- Ставка и стопка фишек ----------
  let shownBetChips = null;

  function renderBetSpot() {
    const amount = state.bet;
    el.betAmount.textContent = fmt(amount);
    el.betSpot.classList.toggle('empty', amount === 0);

    const chips = state.betChips || [];
    const key = chips.join(',');
    // Пересобираем стопку только когда изменился набор фишек:
    // так анимация падения играет только у действительно новой фишки.
    if (key === shownBetChips) return;

    const grew = shownBetChips !== null
      && key.length > shownBetChips.length
      && key.startsWith(shownBetChips);
    shownBetChips = key;

    el.betChips.innerHTML = '';

    // Сверху лежат последние фишки; старые скрываем под счётчиком.
    const visible = chips.slice(-BET_STACK_MAX);
    const size = visible.length > 4 ? 32 : 36;
    const step = visible.length > 1
      ? Math.min(11, (BET_STACK_CEIL - BET_STACK_BASE - size) / (visible.length - 1))
      : 0;

    el.betChips.style.setProperty('--chip-size', `${size}%`);
    el.betChips.style.setProperty('--chip-size-n', String(size));
    el.betChips.style.setProperty('--chip-step', `${step}%`);
    el.betChips.style.setProperty('--chip-base', `${BET_STACK_BASE}%`);

    visible.forEach((value, i) => {
      const chip = document.createElement('div');
      chip.className = `mini-chip c${value}`;
      chip.style.setProperty('--i', String(i));
      chip.style.setProperty('--tilt', `${CHIP_TILT[i % CHIP_TILT.length]}deg`);
      chip.style.setProperty('--sway', `${CHIP_SWAY[i % CHIP_SWAY.length]}px`);
      chip.textContent = String(value);
      if (grew && i === visible.length - 1) chip.classList.add('is-new');
      el.betChips.appendChild(chip);
    });

    const hidden = chips.length - visible.length;
    if (hidden > 0) {
      const more = document.createElement('span');
      more.className = 'chip-more';
      more.textContent = `+${hidden}`;
      more.title = `В ставке ${chips.length} фишек`;
      el.betChips.appendChild(more);
    }
  }

  function canDouble(hand) {
    return Boolean(
      hand
      && state.phase === 'player'
      && !state.busy
      && hand.cards.length === 2
      && !hand.done
      && state.bankroll >= hand.bet
    );
  }

  function canSplit(hand) {
    if (!hand || state.phase !== 'player' || state.busy || hand.done) return false;
    if (state.hands.length >= 4) return false;
    if (hand.cards.length !== 2) return false;
    if (state.bankroll < hand.bet) return false;
    return rankValue(hand.cards[0].rank) === rankValue(hand.cards[1].rank);
  }

  function renderPanels() {
    const inRound = state.phase !== 'betting';
    const broke = state.phase === 'betting' && state.bankroll < MIN_BET && state.bet === 0;

    el.rebuyPanel.hidden = !broke;
    el.betPanel.hidden = inRound || broke;
    el.actionPanel.hidden = !inRound;

    el.chips.forEach((chip) => {
      const value = Number(chip.dataset.chip);
      chip.disabled = state.phase !== 'betting' || state.bankroll < value || state.bet + value > MAX_BET;
    });

    el.dealBtn.disabled = state.phase !== 'betting' || state.busy || state.bet < MIN_BET;
    el.clearBet.disabled = state.phase !== 'betting' || state.bet === 0;

    const hand = state.hands[state.active];
    const playerTurn = state.phase === 'player' && !state.busy;

    el.hitBtn.disabled = !playerTurn || !hand || hand.done;
    el.standBtn.disabled = !playerTurn || !hand || hand.done;
    el.doubleBtn.disabled = !canDouble(hand);
    el.splitBtn.disabled = !canSplit(hand);
  }

  function updateUI() {
    renderBankroll();
    renderShoe();
    renderDealer();
    renderPlayer();
    renderBetSpot();
    renderPanels();
    el.message.textContent = state.message;
    el.message.className = `message ${state.messageClass}`.trim();
    el.soundBtn.classList.toggle('off', !state.sound);
    el.soundBtn.textContent = state.sound ? '🔊' : '🔇';
    el.soundBtn.setAttribute('aria-pressed', String(state.sound));
    // Если история открыта во время анимации раунда — обновляем её на лету.
    if (!el.overlay.hidden) renderHistory();
  }

  // ---------- Ставки ----------
  function clearTable() {
    state.dealer = [];
    state.dealerHidden = false;
    state.hands = [];
    state.active = 0;
    el.dealerTotal.textContent = '';
  }

  function addChip(value) {
    if (state.phase !== 'betting' || state.busy) return;
    if (state.bankroll < value) return;
    if (state.bet + value > MAX_BET) {
      setMessage(`Максимальная ставка — ${fmt(MAX_BET)}`, 'lose');
      return;
    }
    if (state.hands.length) clearTable();

    state.bankroll -= value;
    state.bet += value;
    state.betChips.push(value);
    sfx('chip');
    setMessage(state.bet >= MIN_BET ? 'Ставка принята — жмите «Раздать»' : 'Добавьте фишки');
    updateUI();
    save();
  }

  function clearBet() {
    if (state.phase !== 'betting' || state.busy || state.bet === 0) return;
    state.bankroll += state.bet;
    state.bet = 0;
    state.betChips = [];
    setMessage('Поставьте фишки и нажмите «Раздать»');
    updateUI();
    save();
  }

  // ---------- Раздача ----------
  async function dealTo(target) {
    if (!Array.isArray(target)) return;
    if (!state.shoe.length) buildShoe();
    target.push(state.shoe.pop());
    renderShoe();
    renderDealer();
    renderPlayer();
    sfx('deal');
    await sleep(180);
  }

  function makeHand(bet) {
    return {
      id: ++state.handSeq,
      cards: [],
      bet,
      doubled: false,
      split: false,
      blackjack: false,
      done: false,
      bust: false,
      result: null,
      payout: 0,
    };
  }

  async function startRound() {
    if (state.busy || state.phase !== 'betting') return;
    if (state.bet < MIN_BET) {
      setMessage('Сначала сделайте ставку', 'lose');
      return;
    }
    const sid = session;
    state.busy = true;

    if (state.shoe.length < SHOE_REBUILD_AT) buildShoe();

    state.hands = [makeHand(state.bet)];
    state.dealer = [];
    state.dealerHidden = true;
    state.active = 0;
    state.phase = 'dealing';
    // Ставка уже списана при выставлении фишек — здесь только учитываем оборот.
    state.stats.wagered += state.bet;

    setMessage('Раздача…');
    updateUI();
    save();

    await dealTo(state.hands[0]?.cards);
    if (sid !== session) return;
    await dealTo(state.dealer);
    if (sid !== session) return;
    await dealTo(state.hands[0]?.cards);
    if (sid !== session) return;
    await dealTo(state.dealer);
    if (sid !== session) return;

    if (!state.hands[0]) return;
    const playerBJ = isNatural(state.hands[0].cards);
    const dealerBJ = isNatural(state.dealer);

    if (playerBJ || dealerBJ) {
      state.hands[0].blackjack = playerBJ;
      state.hands[0].done = true;
      state.dealerHidden = false;
      state.phase = 'dealer';
      setMessage(playerBJ ? 'Блэкджек!' : 'У дилера блэкджек…', 'gold');
      updateUI();
      sfx('flip');
      await sleep(750);
      if (sid !== session) return;
      settle();
      return;
    }

    state.phase = 'player';
    state.busy = false;
    setMessage('Ваш ход: «Ещё» или «Хватит»');
    updateUI();
  }

  function currentHand() {
    const hand = state.hands[state.active];
    return hand && !hand.done ? hand : null;
  }

  async function finishHand() {
    if (state.phase !== 'player') return;
    const next = state.hands.findIndex((h) => !h.done);
    if (next === -1) {
      await dealerTurn();
      return;
    }
    state.active = next;
    state.busy = false;
    setMessage(state.hands.length > 1
      ? `Рука ${next + 1} из ${state.hands.length} — ваш ход`
      : 'Ваш ход: «Ещё» или «Хватит»');
    updateUI();
  }

  async function hit() {
    if (state.busy || state.phase !== 'player') return;
    const hand = currentHand();
    if (!hand) return;

    const sid = session;
    state.busy = true;
    await dealTo(hand.cards);
    if (sid !== session) return;
    const total = handValue(hand.cards);

    if (total > 21) {
      hand.bust = true;
      hand.done = true;
      hand.result = 'bust';
      sfx('lose');
      setMessage('Перебор!', 'lose');
      updateUI();
      await sleep(850);
      await finishHand();
      return;
    }

    if (total === 21) {
      hand.done = true;
      updateUI();
      await sleep(320);
      await finishHand();
      return;
    }

    state.busy = false;
    setMessage(`У вас ${total}. Ещё или хватит?`);
    updateUI();
  }

  async function stand() {
    if (state.busy || state.phase !== 'player') return;
    const hand = currentHand();
    if (!hand) return;

    state.busy = true;
    hand.done = true;
    sfx('chip');
    updateUI();
    await sleep(220);
    await finishHand();
  }

  async function doubleDown() {
    const hand = currentHand();
    if (!canDouble(hand)) return;

    const sid = session;
    state.busy = true;
    state.bankroll -= hand.bet;
    state.stats.wagered += hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    sfx('chip');
    updateUI();
    save();

    await dealTo(hand.cards);
    if (sid !== session) return;
    const total = handValue(hand.cards);
    hand.done = true;

    if (total > 21) {
      hand.bust = true;
      hand.result = 'bust';
      sfx('lose');
      setMessage('Перебор после удвоения', 'lose');
    } else {
      setMessage(`Удвоено: ${total}. Ход переходит к дилеру`);
    }

    updateUI();
    await sleep(750);
    await finishHand();
  }

  async function splitHand() {
    const hand = currentHand();
    if (!canSplit(hand)) return;

    const sid = session;
    state.busy = true;
    state.bankroll -= hand.bet;
    state.stats.wagered += hand.bet;
    sfx('chip');

    const isAces = hand.cards[0].rank === 'A';
    const moved = hand.cards.pop();
    hand.split = true;

    const second = makeHand(hand.bet);
    second.cards.push(moved);
    second.split = true;

    state.hands.splice(state.active + 1, 0, second);
    setMessage(isAces ? 'Сплит тузов — по одной карте на руку' : 'Сплит! Играете двумя руками');
    updateUI();
    save();

    await sleep(240);
    if (sid !== session) return;
    await dealTo(hand.cards);
    if (sid !== session) return;
    await sleep(160);
    if (sid !== session) return;
    await dealTo(second.cards);
    if (sid !== session) return;

    if (isAces) {
      hand.done = true;
      second.done = true;
      updateUI();
      await sleep(550);
      await finishHand();
      return;
    }

    state.busy = false;
    setMessage(`Рука 1 из ${state.hands.length} — ваш ход`);
    updateUI();
  }

  // ---------- Дилер и расчёт ----------
  async function dealerTurn() {
    if (state.phase !== 'player') return;
    const sid = session;
    state.phase = 'dealer';
    state.busy = true;
    state.dealerHidden = false;
    setMessage('Ход дилера…');
    updateUI();
    sfx('flip');
    await sleep(480);
    if (sid !== session) return;

    const anyoneAlive = state.hands.some((h) => !h.bust);
    if (anyoneAlive) {
      while (handValue(state.dealer) < 17) {
        setMessage('Дилер добирает карту…');
        updateUI();
        await sleep(280);
        if (sid !== session) return;
        await dealTo(state.dealer);
        if (sid !== session) return;
      }
    }

    await sleep(420);
    if (sid !== session) return;
    settle();
  }

  function settle() {
    if (state.phase !== 'dealer') return;
    const dealerTotal = handValue(state.dealer);
    const dealerBJ = isNatural(state.dealer);
    const dealerBust = dealerTotal > 21;

    let totalBet = 0;
    let totalPayout = 0;

    state.hands.forEach((hand) => {
      totalBet += hand.bet;

      if (hand.bust) {
        hand.result = 'bust';
        hand.payout = 0;
        state.stats.losses++;
        return;
      }

      const playerTotal = handValue(hand.cards);
      let result;

      if (hand.blackjack && dealerBJ) result = 'push';
      else if (hand.blackjack) result = 'blackjack';
      else if (dealerBJ) result = 'lose';
      else if (dealerBust) result = 'win';
      else if (playerTotal > dealerTotal) result = 'win';
      else if (playerTotal === dealerTotal) result = 'push';
      else result = 'lose';

      hand.result = result;

      if (result === 'blackjack') {
        hand.payout = hand.bet + Math.floor(hand.bet * 1.5);
        state.stats.blackjacks++;
        state.stats.wins++;
      } else if (result === 'win') {
        hand.payout = hand.bet * 2;
        state.stats.wins++;
      } else if (result === 'push') {
        hand.payout = hand.bet;
        state.stats.pushes++;
      } else {
        hand.payout = 0;
        state.stats.losses++;
      }

      totalPayout += hand.payout;
    });

    const net = totalPayout - totalBet;

    state.bankroll += totalPayout;
    state.stats.rounds++;
    state.stats.net += net;
    if (net > 0) state.stats.bestWin = Math.max(state.stats.bestWin, net);
    recordHistoryEntry(net, totalBet);

    state.phase = 'betting';
    state.busy = false;
    state.bet = 0;
    state.betChips = [];

    // Итоговое сообщение
    const gotBlackjack = state.hands.some((h) => h.result === 'blackjack');
    const allBust = state.hands.every((h) => h.result === 'bust');

    if (gotBlackjack) {
      setMessage(`Блэкджек! Выигрыш ${fmt(net)}`, 'gold');
      sfx('blackjack');
    } else if (net > 0) {
      setMessage(state.hands.length > 1
        ? `Итог раунда: выигрыш ${fmt(net)}`
        : `Вы выиграли ${fmt(net)}`, 'win');
      sfx('win');
    } else if (net < 0) {
      if (allBust) setMessage('Перебор — ставка проиграна', 'lose');
      else if (dealerBJ) setMessage('Блэкджек у дилера — вы проиграли', 'lose');
      else if (dealerBust) setMessage('Дилер перебрал, но… увы, ставка проиграна', 'lose');
      else setMessage(`Вы проиграли ${fmt(-net)}`, 'lose');
      sfx('lose');
    } else {
      setMessage('Ничья — ставка возвращена', 'push');
      sfx('push');
    }

    showDelta(net);
    updateUI();
    save();
  }

  // ---------- Пополнение ----------
  function rebuy() {
    if (state.phase !== 'betting') return;
    Casino.addBalance(START_BANKROLL);
    setMessage('Демо-пополнение получено. Приятной игры!', 'gold');
    sfx('chip');
    updateUI();
    save();
  }

  // ---------- Модальные окна ----------
  let lastFocused = null;

  function openModal(html) {
    lastFocused = document.activeElement;
    el.modalBody.innerHTML = html;
    el.overlay.hidden = false;
    el.modalClose.focus({ preventScroll: true });

    el.modalBody.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', closeModal);
    });
    const action = el.modalBody.querySelector('[data-action="reset"]');
    if (action) {
      action.addEventListener('click', () => {
        resetGame();
        closeModal();
      });
    }
  }

  function closeModal() {
    el.overlay.hidden = true;
    el.modalBody.innerHTML = '';
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus({ preventScroll: true });
    }
  }

  function openRules() {
    openModal(`
      <h2>Правила «21»</h2>
      <p>Цель — набрать <span class="accent">21 очко</span> или больше очков, чем у дилера,
      но не превысить 21. Перебор проигрывает сразу.</p>

      <h3>Стоимость карт</h3>
      <ul>
        <li>2–10 — по номиналу;</li>
        <li>валет, дама, король — 10 очков;</li>
        <li>туз — 11 очков, но при переборе автоматически считается за 1.</li>
      </ul>

      <h3>Ход игры</h3>
      <ul>
        <li>Поставьте фишки и нажмите «Раздать».</li>
        <li>Вам и дилеру раздаётся по две карты; одна карта дилера скрыта.</li>
        <li>Вы можете брать карты или остановиться, а дилер добирает до 17 очков.</li>
        <li>Побеждает рука, которая ближе к 21 и не превышает его.</li>
      </ul>

      <h3>Действия</h3>
      <ul>
        <li><span class="accent">Ещё</span> — взять ещё одну карту.</li>
        <li><span class="accent">Хватит</span> — остановиться и передать ход дилеру.</li>
        <li><span class="accent">Удвоить</span> — удвоить ставку и получить ровно одну карту.</li>
        <li><span class="accent">Сплит</span> — разделить пару одинаковых карт на две руки
        (до 4 рук). После сплита тузов даётся по одной карте.</li>
      </ul>

      <h3>Выплаты</h3>
      <ul>
        <li>Победа — <span class="accent">1 : 1</span>.</li>
        <li>Блэкджек с первых двух карт — <span class="accent">3 : 2</span>.</li>
        <li>Ничья — ставка возвращается.</li>
      </ul>

      <h3>Правила стола</h3>
      <ul>
        <li>6 колод в шузе, перемешивание автоматическое.</li>
        <li>Дилер останавливается на 17 очках (включая мягкие 17).</li>
        <li>Блэкджек после сплита оплачивается 1 : 1.</li>
        <li>Минимальная ставка — 25 ₽, максимальная — 2 500 ₽.</li>
        <li>Игра на демо-фишки. Реальные деньги не используются.</li>
      </ul>

      <div class="modal-actions">
        <button class="primary-btn" data-close>Понятно</button>
      </div>
    `);
  }

  function openStats() {
    const s = state.stats;
    const profit = s.net;
    const winRate = s.wins + s.losses > 0
      ? Math.round((s.wins / (s.wins + s.losses)) * 100)
      : 0;

    openModal(`
      <h2>Статистика</h2>
      <div class="stat-grid">
        <span>Раундов сыграно</span><span>${numFmt.format(s.rounds)}</span>
        <span>Побед</span><span>${numFmt.format(s.wins)}</span>
        <span>Поражений</span><span>${numFmt.format(s.losses)}</span>
        <span>Ничьих</span><span>${numFmt.format(s.pushes)}</span>
        <span>Блэкджеков</span><span>${numFmt.format(s.blackjacks)}</span>
        <span>Доля побед</span><span>${winRate}%</span>
        <span>Оборот ставок</span><span>${fmt(s.wagered)}</span>
        <span>Лучший раунд</span><span>${fmt(s.bestWin)}</span>
        <span>Чистый результат</span><span>${profit >= 0 ? '+' : '−'}${fmt(Math.abs(profit))}</span>
        <span>Баланс</span><span>${fmt(state.bankroll)}</span>
      </div>
      <p style="margin-top:14px;font-size:12px;color:var(--muted)">
        Статистика хранится в этом браузере.
      </p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="history">История раздач</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
    const historyBtn = el.modalBody.querySelector('[data-action="history"]');
    if (historyBtn) historyBtn.addEventListener('click', openHistory);
  }

  function openHistory() {
    openModal(`
      <h2>История раздач</h2>
      <div id="historyBody"></div>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="stats">Общая статистика</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
    const statsBtn = el.modalBody.querySelector('[data-action="stats"]');
    if (statsBtn) statsBtn.addEventListener('click', openStats);
    renderHistory();
  }

  function openReset() {
    openModal(`
      <h2>Сбросить блэкджек?</h2>
      <p>Обнулятся <span class="accent">статистика и история раздач блэкджека</span>.
      Текущая раздача будет прервана.</p>
      <p>Общий баланс и другие игры не изменятся.</p>
      <div class="modal-actions">
        <button class="ghost-btn" data-close>Отмена</button>
        <button class="primary-btn" data-action="reset">Сбросить</button>
      </div>
    `);
  }

  function resetGame() {
    session++;
    // Ставка прерванного раунда возвращается: сброс не должен съедать деньги.
    Casino.settlePending(GAME_ID);
    state.bet = 0;
    state.betChips = [];
    Casino.resetGame(GAME_ID);
    state.phase = 'betting';
    state.busy = false;
    state.active = 0;
    clearTable();
    buildShoe();
    setMessage('Блэкджек сброшен. Поставьте фишки и нажмите «Раздать»');
    updateUI();
    save();
  }

  // ---------- События ----------
  el.chips.forEach((chip) => {
    chip.addEventListener('click', () => addChip(Number(chip.dataset.chip)));
  });

  el.clearBet.addEventListener('click', clearBet);
  el.dealBtn.addEventListener('click', startRound);
  el.hitBtn.addEventListener('click', hit);
  el.standBtn.addEventListener('click', stand);
  el.doubleBtn.addEventListener('click', doubleDown);
  el.splitBtn.addEventListener('click', splitHand);
  el.rebuyBtn.addEventListener('click', rebuy);
  el.rulesBtn.addEventListener('click', openRules);
  el.statsBtn.addEventListener('click', openStats);
  el.historyBtn.addEventListener('click', openHistory);
  el.resetBtn.addEventListener('click', openReset);
  el.modalClose.addEventListener('click', closeModal);

  el.overlay.addEventListener('click', (event) => {
    if (event.target === el.overlay) closeModal();
  });

  el.soundBtn.addEventListener('click', () => {
    state.sound = !state.sound;
    updateUI();
    save();
    if (state.sound) sfx('chip');
  });

  document.addEventListener('keydown', (event) => {
    if (!el.overlay.hidden) {
      if (event.key === 'Escape') closeModal();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key.toLowerCase();

    if (state.phase === 'betting' && (key === 'enter' || key === ' ')) {
      event.preventDefault();
      startRound();
      return;
    }
    if (state.phase === 'betting') {
      if (key === 'c') clearBet();
      return;
    }
    if (state.phase !== 'player' || state.busy) return;

    if (key === 'h' || key === 'arrowright') {
      event.preventDefault();
      hit();
    } else if (key === 's' || key === 'arrowdown') {
      event.preventDefault();
      stand();
    } else if (key === 'd') {
      doubleDown();
    } else if (key === 'p') {
      splitHand();
    }
  });

  // ---------- Старт ----------
  buildShoe();
  load();
  setMessage('Поставьте фишки и нажмите «Раздать»');
  updateUI();
})();
