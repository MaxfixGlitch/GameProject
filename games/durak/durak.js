/* ============================================================
   Дурак — подкидной на 36 картах
   Игра против одного–пяти ботов. Ставка списывается перед
   раздачей; выигрыш — если вы не остались дураком.
   Комиссия казино 10%: при одном боте возврат ×1,9.
   ============================================================ */
(() => {
  'use strict';

  const Casino = window.Casino;
  const $ = (sel) => document.querySelector(sel);
  const GAME_ID = 'durak';

  // Закрытая игра не запускается: прямо по адресу тоже стоит замок.
  // Дурак открыт сразу, но проверка пусть останется общей.
  if (!Casino.isUnlocked(GAME_ID)) {
    Casino.showLocked(GAME_ID);
    return;
  }

  // ---------- Карты ----------
  const SUITS = [
    { sym: '♠', red: false },
    { sym: '♥', red: true },
    { sym: '♦', red: true },
    { sym: '♣', red: false },
  ];
  const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const HAND_SIZE = 6;
  const DECK_SIZE = 36;
  const MAX_PAIRS = 6;
  const MIN_BET = Casino.MIN_BET;
  // Комиссия казино: выигрыш не ×2, а ×1,9 при одном боте.
  const COMMISSION = 0.1;
  const HISTORY_SHOWN = 12;
  const maxBet = () => Casino.maxBet();

  const BOT_NAMES = ['Лёша', 'Марина', 'Тимур', 'Вера', 'Егор'];

  const numFmt = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => `${numFmt.format(Math.round(n))}\u00A0₽`;
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const rankVal = (rank) => RANKS.indexOf(rank) + 6;
  const cardLabel = (card) => `${card.r}${SUITS[card.s].sym}`;

  // ---------- Состояние ----------
  const state = {
    screen: 'lobby',      // lobby | playing | over
    gen: 0,               // поколение партии: старые боты замолкают
    botCount: 1,
    bet: MIN_BET,
    players: [],
    deck: [],
    trumpSuit: 0,
    trumpCard: null,
    discard: [],
    round: null,
    pending: null,        // { type: attack | beat | add, actor }
    outOrder: [],
    roundCount: 0,       // сколько заходов уже было — страховка от вечного цикла
    result: null,
  };

  let timing = { bot: 620 };
  const setTiming = (next) => { timing = Object.assign({}, timing, next); };

  let rng = Math.random;
  const setRng = (fn) => { rng = typeof fn === 'function' ? fn : Math.random; };

  // ---------- DOM ----------
  const el = {
    bankroll: $('#bankroll'),
    deltaLayer: $('#deltaLayer'),
    felt: $('#felt'),
    trumpBadge: $('#trumpBadge'),
    trumpSuit: $('#trumpSuit'),
    tableCounts: $('#tableCounts'),
    deckCounter: $('#deckCounter'),
    deckLeft: $('#deckLeft'),
    discardLeft: $('#discardLeft'),
    feltNote: $('#feltNote'),
    botsRow: $('#botsRow'),
    tableCards: $('#tableCards'),
    tableEmpty: $('#tableEmpty'),
    message: $('#message'),
    playerHand: $('#playerHand'),
    handWrap: $('.durak-hand-wrap'),
    lobby: $('#lobby'),
    actions: $('#actions'),
    result: $('#result'),
    resultText: $('#resultText'),
    againBtn: $('#againBtn'),
    dealBtn: $('#dealBtn'),
    bitoBtn: $('#bitoBtn'),
    takeBtn: $('#takeBtn'),
    actionsStake: $('#actionsStake'),
    botPicker: $('#botPicker'),
    multValue: $('#multValue'),
    betTotal: $('#betTotal'),
    betLimit: $('#betLimit'),
    betHint: $('#betHint'),
    chipsRow: $('#chipsRow'),
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

  function beep({ freq = 440, dur = 0.07, type = 'sine', gain = 0.03, at = 0, slide = 0 }) {
    const audio = getAudio();
    if (!audio) return;
    const t0 = audio.currentTime + at;
    const osc = audio.createOscillator();
    const node = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(node).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function sfx(name) {
    switch (name) {
      case 'card': beep({ freq: 620, dur: 0.045, type: 'square', gain: 0.014 }); break;
      case 'take': beep({ freq: 260, dur: 0.12, type: 'sine', gain: 0.026, slide: -60 }); break;
      case 'win': [659.25, 783.99, 1046.5].forEach((f, i) => beep({ freq: f, dur: 0.13, gain: 0.045, at: i * 0.08 })); break;
      case 'lose': beep({ freq: 220, dur: 0.2, type: 'sine', gain: 0.03, slide: -70 }); break;
      default: break;
    }
  }

  // ---------- Утилиты ----------
  const nameOf = (index) => (state.players[index] ? state.players[index].name : '');

  function sortHand(player) {
    player.hand.sort((a, b) => {
      const ta = a.s === state.trumpSuit ? 1 : 0;
      const tb = b.s === state.trumpSuit ? 1 : 0;
      if (ta !== tb) return ta - tb;
      if (a.s !== b.s) return a.s - b.s;
      return rankVal(a.r) - rankVal(b.r);
    });
  }

  function removeFromHand(player, card) {
    const index = player.hand.indexOf(card);
    if (index >= 0) player.hand.splice(index, 1);
    return index >= 0;
  }

  /** Бьёт ли карта card карту target. */
  function beats(card, target) {
    if (!card || !target) return false;
    if (card.s === target.s) return rankVal(card.r) > rankVal(target.r);
    if (card.s === state.trumpSuit) return target.s !== state.trumpSuit;
    return false;
  }

  function buildDeck() {
    const deck = [];
    for (let s = 0; s < SUITS.length; s += 1) {
      for (const rank of RANKS) deck.push({ id: `${s}-${rank}`, r: rank, s });
    }
    return deck;
  }

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  const clampBots = (value) => Math.min(5, Math.max(1, Math.round(Number(value) || 1)));
  const winMultiplier = (bots = state.botCount) => 1 + (1 - COMMISSION) / clampBots(bots);

  function multLabel(bots = state.botCount) {
    const text = winMultiplier(bots).toFixed(2).replace(/0$/, '').replace(/\.$/, '');
    return `×${text.replace('.', ',')}`;
  }

  // ---------- Партия ----------
  function makePlayers(botCount) {
    const players = [{ id: 0, name: 'Вы', short: 'В', isHuman: true, hand: [], out: false }];
    for (let i = 0; i < botCount; i += 1) {
      players.push({ id: i + 1, name: BOT_NAMES[i], short: BOT_NAMES[i].slice(0, 1), isHuman: false, hand: [], out: false });
    }
    return players;
  }

  function nextActive(from) {
    const total = state.players.length;
    for (let step = 1; step <= total; step += 1) {
      const index = (from + step) % total;
      if (!state.players[index].out) return index;
    }
    return -1;
  }

  /** Первым ходит тот, у кого младший козырь. */
  function firstAttacker() {
    let best = null;
    let who = 0;
    state.players.forEach((player, index) => {
      player.hand.forEach((card) => {
        if (card.s !== state.trumpSuit) return;
        if (!best || rankVal(card.r) < rankVal(best.r)) {
          best = card;
          who = index;
        }
      });
    });
    return best ? who : 0;
  }

  function startGame(botCount = state.botCount, bet = state.bet) {
    const bots = clampBots(botCount);
    const stake = Math.max(MIN_BET, Math.min(maxBet(), Math.round(Number(bet) || MIN_BET)));
    if (Casino.getBalance() < stake) return null;

    state.gen += 1;
    state.botCount = bots;
    state.bet = stake;
    state.screen = 'playing';
    state.players = makePlayers(bots);
    state.deck = shuffle(buildDeck());
    state.trumpCard = state.deck[state.deck.length - 1];
    state.trumpSuit = state.trumpCard.s;
    state.discard = [];
    state.outOrder = [];
    state.roundCount = 0;
    state.result = null;
    state.round = null;
    state.pending = null;

    // Раздача по одной карте по кругу, как за настоящим столом.
    // Шесть человек за столом — это все 36 карт, и козырь-карта из колоды
    // пропал бы. Поэтому на шестерых раздаём по пять: одна карта остаётся
    // в колоде и показывает козырь.
    const dealSize = Math.max(1, Math.min(HAND_SIZE,
      Math.floor((DECK_SIZE - 1) / state.players.length)));
    state.dealSize = dealSize;
    for (let step = 0; step < dealSize; step += 1) {
      state.players.forEach((player) => player.hand.push(state.deck.shift()));
    }
    state.players.forEach(sortHand);

    Casino.stake(GAME_ID, stake);
    Casino.setPending(GAME_ID, stake);
    Casino.save();

    startRound(firstAttacker());
    render();
    pump();
    return state;
  }

  function startRound(attackerIdx) {
    const attacker = state.players[attackerIdx] && !state.players[attackerIdx].out
      ? attackerIdx
      : nextActive(attackerIdx);
    if (attacker < 0) return null;
    const defender = nextActive(attacker);
    if (defender < 0) return null;
    state.round = {
      attacker,
      defender,
      pairs: [],
      limit: Math.max(1, Math.min(MAX_PAIRS, state.players[defender].hand.length)),
      taking: false,
      order: [],
      cursor: 0,
      passed: 0,
    };
    state.pending = { type: 'attack', actor: attacker };
    return state.round;
  }

  function buildAddOrder() {
    const round = state.round;
    const total = state.players.length;
    const order = [];
    for (let step = 0; step < total; step += 1) {
      const index = (round.attacker + step) % total;
      if (index === round.defender) continue;
      if (state.players[index].out) continue;
      order.push(index);
    }
    return order;
  }

  /** Ранги, которые сейчас лежат на столе: только их можно подкидывать. */
  function tableRanks() {
    const ranks = new Set();
    if (!state.round) return ranks;
    state.round.pairs.forEach((pair) => {
      ranks.add(pair.attack.r);
      if (pair.defense) ranks.add(pair.defense.r);
    });
    return ranks;
  }

  function canAttackWith(card) {
    if (!state.round) return false;
    if (!state.round.pairs.length) return true;
    return tableRanks().has(card.r);
  }

  function openPair() {
    if (!state.round) return null;
    return state.round.pairs.find((pair) => !pair.defense) || null;
  }

  // ---------- Ходы ----------
  function playAttack(actor, card) {
    const round = state.round;
    if (!round || !state.pending || state.pending.actor !== actor) return false;
    const player = state.players[actor];
    if (!player || player.out || !player.hand.includes(card)) return false;
    if (!canAttackWith(card)) return false;
    if (round.pairs.length >= round.limit) return false;

    removeFromHand(player, card);
    round.pairs.push({ attack: card, defense: null });
    sfx('card');

    if (round.taking) {
      // Защитник уже сказал «взять» — карта уходит в прикуп без отбоя.
      // Подкинувший передаёт слово следующему по кругу.
      round.passed = 0;
      round.cursor = (round.cursor + 1) % round.order.length;
      if (round.pairs.length >= round.limit) finishAddPhase();
      else state.pending = { type: 'add', actor: round.order[round.cursor] };
    } else {
      state.pending = { type: 'beat', actor: round.defender };
    }
    render();
    pump();
    return true;
  }

  function playDefense(actor, card) {
    const round = state.round;
    const pair = openPair();
    if (!round || !pair || !state.pending || state.pending.actor !== actor) return false;
    const player = state.players[actor];
    if (!player || !player.hand.includes(card) || !beats(card, pair.attack)) return false;

    removeFromHand(player, card);
    pair.defense = card;
    sfx('card');

    if (round.pairs.every((item) => item.defense)) startAddPhase();
    render();
    pump();
    return true;
  }

  function startAddPhase() {
    const round = state.round;
    if (!round) return;
    if (!round.order.length) round.order = buildAddOrder();
    if (!round.order.length || round.pairs.length >= round.limit) {
      finishAddPhase();
      return;
    }
    round.passed = 0;
    round.cursor = 0;
    state.pending = { type: 'add', actor: round.order[0] };
  }

  function declineAdd(actor) {
    const round = state.round;
    if (!round || !state.pending || state.pending.actor !== actor) return false;
    if (state.pending.type !== 'add') return false;
    round.passed += 1;
    round.cursor = (round.cursor + 1) % round.order.length;
    if (round.passed >= round.order.length) {
      finishAddPhase();
      return true;
    }
    state.pending = { type: 'add', actor: round.order[round.cursor] };
    render();
    pump();
    return true;
  }

  function finishAddPhase() {
    const round = state.round;
    if (!round) return;
    if (round.taking) {
      defenderTakes();
      return;
    }
    if (round.pairs.some((pair) => !pair.defense)) return;
    roundBeaten();
  }

  function tableCardsList(round) {
    const cards = [];
    round.pairs.forEach((pair) => {
      cards.push(pair.attack);
      if (pair.defense) cards.push(pair.defense);
    });
    return cards;
  }

  function roundBeaten() {
    const round = state.round;
    state.discard.push(...tableCardsList(round));
    const next = state.players[round.defender].out ? nextActive(round.defender) : round.defender;
    finishRound(next, 'bito');
  }

  function defenderTakes() {
    const round = state.round;
    const defender = state.players[round.defender];
    defender.hand.push(...tableCardsList(round));
    sortHand(defender);
    sfx('take');
    const next = nextActive(round.defender);
    finishRound(next, 'take');
  }

  function refillOrder(round) {
    const total = state.players.length;
    const order = [];
    for (let step = 0; step < total; step += 1) {
      const index = (round.attacker + step) % total;
      if (index === round.defender) continue;
      if (!state.players[index].out) order.push(index);
    }
    if (!state.players[round.defender].out) order.push(round.defender);
    return order;
  }

  function drawTo(index) {
    const player = state.players[index];
    while (player.hand.length < HAND_SIZE && state.deck.length > 0) {
      player.hand.push(state.deck.shift());
    }
    sortHand(player);
  }

  function finishRound(nextAttackerIdx, kind) {
    const round = state.round;
    state.roundCount += 1;
    refillOrder(round).forEach(drawTo);

    // Карты в редких случаях могут ходить по кругу: один и тот же расклад
    // возвращается снова и снова. Партия обязана закончиться — дураком
    // становится тот, у кого больше карт.
    if (state.roundCount > 200) {
      const active = state.players.filter((player) => !player.out);
      active.sort((a, b) => b.hand.length - a.hand.length);
      const durak = active.length ? state.players.indexOf(active[0]) : -1;
      endGame({ won: durak !== 0, reason: 'durak', durakIndex: durak });
      return;
    }

    state.players.forEach((player, index) => {
      if (!player.out && player.hand.length === 0 && state.deck.length === 0) {
        player.out = true;
        state.outOrder.push(index);
      }
    });

    state.round = null;
    state.pending = null;

    if (state.players[0].out) {
      endGame({ won: true, reason: 'out' });
      return;
    }
    const active = state.players.filter((player) => !player.out);
    if (active.length <= 1) {
      const durakIndex = active.length ? state.players.indexOf(active[0]) : -1;
      endGame({ won: durakIndex !== 0, reason: 'durak', durakIndex });
      return;
    }

    let attacker = nextAttackerIdx;
    if (attacker < 0) attacker = nextActive(kind === 'take' ? round.defender : round.attacker);
    if (!state.players[attacker] || state.players[attacker].out) attacker = nextActive(attacker);
    startRound(attacker);
    render();
    pump();
  }

  function endGame(info) {
    state.screen = 'over';
    state.pending = null;
    state.round = null;

    const bet = state.bet;
    let payout = 0;
    let net = -bet;
    if (info.won) {
      payout = Math.round(bet * winMultiplier());
      net = payout - bet;
    }

    let insurance = 0;
    if (net < 0 && Casino.shields() > 0 && Casino.useShield()) {
      insurance = Math.ceil(-net / 2);
    }
    const totalNet = net + insurance;

    if (payout > 0) Casino.payout(GAME_ID, payout);
    if (insurance > 0) Casino.payout(GAME_ID, insurance);
    Casino.setPending(GAME_ID, 0);

    const stats = Casino.stats(GAME_ID);
    stats.rounds += 1;
    stats.wagered += bet;
    stats.net += totalNet;
    if (totalNet > 0) {
      stats.wins += 1;
      stats.bestWin = Math.max(stats.bestWin, totalNet);
    } else if (totalNet < 0) {
      stats.losses += 1;
    } else {
      stats.pushes += 1;
    }

    const summary = info.won
      ? `Вы не дурак · соперников ${state.botCount}`
      : `Вы дурак · соперников ${state.botCount}`;
    Casino.pushHistory(GAME_ID, {
      ts: Date.now(),
      bet,
      net: totalNet,
      payout: payout + insurance,
      insurance,
      bots: state.botCount,
      summary,
    });
    Casino.save();

    state.result = { won: info.won, net: totalNet, payout: payout + insurance, bet, insurance };
    render();
    sfx(totalNet > 0 ? 'win' : 'lose');
    return state.result;
  }

  // ---------- Боты ----------
  function attackScore(card) {
    return rankVal(card.r) + (card.s === state.trumpSuit ? 100 : 0);
  }

  function defenseScore(card) {
    return rankVal(card.r) + (card.s === state.trumpSuit ? 100 : 0);
  }

  /** Бот выбирает, чем ходить: младшая карта, козырь — в последнюю очередь. */
  function chooseAttack(player) {
    const round = state.round;
    const allowed = round.pairs.length ? tableRanks() : null;
    const options = player.hand.filter((card) => !allowed || allowed.has(card.r));
    if (!options.length) return null;
    options.sort((a, b) => attackScore(a) - attackScore(b));
    return options[0];
  }

  /** Бот выбирает, чем отбиться: сначала своя масть, потом козыри. */
  function chooseDefense(player, attackCard) {
    const options = player.hand.filter((card) => beats(card, attackCard));
    if (!options.length) return null;
    options.sort((a, b) => defenseScore(a) - defenseScore(b));
    return options[0];
  }

  function passAttack(actor) {
    const round = state.round;
    // На столе уже что-то есть — это не «хочу ходить», а «больше нечего
    // подкинуть»: заканчиваем фазу подкидывания, а не меняем атакующего.
    if (round.pairs.length > 0) {
      finishAddPhase();
      return;
    }
    const next = nextActive(actor);
    if (next < 0 || next === round.defender) {
      finishAddPhase();
      return;
    }
    round.attacker = next;
    state.pending = { type: 'attack', actor: next };
  }

  function botAct(actor) {
    const pending = state.pending;
    const round = state.round;
    if (!pending || !round || pending.actor !== actor) return false;
    const player = state.players[actor];

    if (pending.type === 'attack' || pending.type === 'add') {
      if (round.pairs.length >= round.limit) {
        if (pending.type === 'add') return declineAdd(actor);
        finishAddPhase();
        return true;
      }
      const card = chooseAttack(player);
      if (card) return playAttack(actor, card);
      if (pending.type === 'add') return declineAdd(actor);
      passAttack(actor);
      return true;
    }

    if (pending.type === 'beat') {
      const pair = openPair();
      const card = pair ? chooseDefense(player, pair.attack) : null;
      if (card) return playDefense(actor, card);
      round.taking = true;
      startAddPhase();
      render();
      pump();
      return true;
    }
    return false;
  }

  let pumping = false;

  async function pump() {
    if (pumping) return;
    pumping = true;
    const gen = state.gen;
    try {
      while (state.screen === 'playing' && state.pending && state.pending.actor !== 0) {
        render();
        await sleep(timing.bot);
        if (gen !== state.gen || state.screen !== 'playing') break;
        if (!state.pending || state.pending.actor === 0) break;
        botAct(state.pending.actor);
      }
    } finally {
      pumping = false;
    }
    // Если бот по-прежнему должен ходить — подхватываем снова. Смотрим на
    // живое состояние, а не на поколение: иначе партия, начатая, пока боты
    // «думали», могла замереть навсегда.
    if (state.screen === 'playing' && state.pending && state.pending.actor !== 0) {
      pump();
      return;
    }
    render();
  }

  // ---------- Ходы человека ----------
  function humanCanPlay(card) {
    if (state.screen !== 'playing' || !state.pending || state.pending.actor !== 0) return false;
    const pending = state.pending;
    const round = state.round;
    if (!round) return false;
    if (pending.type === 'attack' || pending.type === 'add') {
      if (round.pairs.length >= round.limit) return false;
      return canAttackWith(card);
    }
    if (pending.type === 'beat') {
      const pair = openPair();
      return Boolean(pair && beats(card, pair.attack));
    }
    return false;
  }

  function humanPlay(cardId) {
    const player = state.players[0];
    if (!player) return false;
    const card = player.hand.find((item) => item.id === cardId);
    if (!card || !humanCanPlay(card)) return false;
    if (state.pending.type === 'beat') return playDefense(0, card);
    return playAttack(0, card);
  }

  function humanTake() {
    if (state.screen !== 'playing' || !state.pending || state.pending.actor !== 0) return false;
    if (state.pending.type !== 'beat') return false;
    const round = state.round;
    if (!round) return false;
    round.taking = true;
    startAddPhase();
    render();
    pump();
    return true;
  }

  function humanBito() {
    if (state.screen !== 'playing' || !state.pending || state.pending.actor !== 0) return false;
    if (state.pending.type !== 'add') return false;
    return declineAdd(0);
  }

  // ---------- Отрисовка ----------
  function renderBankroll() {
    if (el.bankroll) el.bankroll.textContent = fmt(Casino.getBalance());
  }

  function cardFrontHTML(card) {
    const suit = SUITS[card.s];
    const center = card.r === 'A'
      ? `<b class="ace-suit">${suit.sym}</b>`
      : `<b>${card.r}</b><i>${suit.sym}</i>`;
    return `
      <div class="card-face card-front ${suit.red ? 'red' : ''}">
        <div class="corner tl"><b>${card.r}</b><i>${suit.sym}</i></div>
        <div class="pip">${center}</div>
        <div class="corner br"><b>${card.r}</b><i>${suit.sym}</i></div>
      </div>`;
  }

  function tableCardHTML(card, className) {
    return `<div class="card ${className}"><div class="card-inner">${cardFrontHTML(card)}</div></div>`;
  }

  function renderHand() {
    const player = state.players[0];
    if (!el.playerHand) return;
    if (!player || !player.hand.length) {
      el.playerHand.innerHTML = '';
      return;
    }
    el.playerHand.innerHTML = player.hand.map((card) => {
      const playable = humanCanPlay(card);
      return `<button type="button" class="card${playable ? ' playable' : ' dim'}"
        data-id="${card.id}" aria-label="${cardLabel(card)}"${playable ? '' : ' disabled'}>
        <div class="card-inner">${cardFrontHTML(card)}</div>
      </button>`;
    }).join('');
  }

  function renderTable() {
    const round = state.round;
    if (!el.tableCards) return;
    const pairs = round ? round.pairs : [];
    el.tableCards.innerHTML = pairs.map((pair) => `
      <div class="pair${round.taking ? ' taking' : ''}">
        ${tableCardHTML(pair.attack, 'attack')}
        ${pair.defense ? tableCardHTML(pair.defense, 'defense') : ''}
      </div>`).join('');
    if (el.tableEmpty) {
      el.tableEmpty.hidden = pairs.length > 0;
      if (state.screen !== 'lobby') el.tableEmpty.textContent = 'Стол пуст';
    }
  }

  function renderBots() {
    if (!el.botsRow) return;
    const round = state.round;
    const bots = state.players.slice(1);
    el.botsRow.innerHTML = bots.map((player, offset) => {
      const index = offset + 1;
      const classes = [];
      if (player.out) classes.push('out');
      if (round && round.attacker === index && state.screen === 'playing') classes.push('attacker');
      if (round && round.defender === index && state.screen === 'playing') classes.push('defender');
      let status = '';
      if (player.out) status = 'вышел';
      else if (round && round.defender === index && state.screen === 'playing') status = 'защита';
      else if (round && round.attacker === index && state.screen === 'playing') status = 'ходит';
      return `<span class="bot-chip ${classes.join(' ')}">
        <span class="bot-avatar" aria-hidden="true">${player.short}</span>
        <span class="bot-name">${player.name}</span>
        <span class="bot-cards"><b>${player.hand.length}</b> к.</span>
        ${status ? `<span class="bot-state">${status}</span>` : ''}
      </span>`;
    }).join('');
  }

  function renderTrump() {
    if (!el.trumpBadge) return;
    const show = state.screen !== 'lobby' && state.trumpCard;
    el.trumpBadge.hidden = !show;
    if (el.tableCounts) el.tableCounts.hidden = !show;
    if (!show) return;
    const suit = SUITS[state.trumpSuit];
    el.trumpSuit.textContent = suit.sym;
    el.trumpSuit.className = suit.red ? 'red' : '';

    // Колода и отбой: вместе с картами на руках и на столе они всегда дают 36.
    if (el.deckLeft) el.deckLeft.textContent = String(state.deck.length);
    if (el.discardLeft) el.discardLeft.textContent = String(state.discard.length);
    if (el.deckCounter) el.deckCounter.classList.toggle('is-empty', state.deck.length === 0);
    if (el.feltNote) el.feltNote.textContent = `всего ${DECK_SIZE} карт`;
  }

  function statusText() {
    if (state.screen === 'lobby') return 'Сколько соперников и какая ставка?';
    if (state.screen === 'over') {
      if (!state.result) return '';
      return state.result.won ? 'Вы вышли из игры — вы не дурак' : 'Вы остались дураком';
    }
    const pending = state.pending;
    if (!pending) return '';
    if (pending.actor === 0) {
      if (pending.type === 'attack') return 'Ваш ход — выберите карту';
      if (pending.type === 'beat') return 'Отбивайтесь или нажмите «Взять»';
      return 'Можно подкинуть карту или сказать «Бито»';
    }
    const name = nameOf(pending.actor);
    if (pending.type === 'beat') return `${name} отбивается…`;
    if (pending.type === 'attack') return `${name} ходит…`;
    return `${name} смотрит, что подкинуть…`;
  }

  function renderPanel() {
    const lobby = state.screen === 'lobby';
    // В лобби стол не разложен: фетр не занимает пол-экрана пустотой.
    if (el.felt) el.felt.classList.toggle('is-lobby', lobby);
    if (el.handWrap) el.handWrap.hidden = lobby;
    if (el.tableEmpty && lobby) el.tableEmpty.textContent = 'Раздайте карты';
    const over = state.screen === 'over';
    if (el.lobby) el.lobby.hidden = !lobby;
    if (el.actions) el.actions.hidden = lobby || over;
    if (el.result) el.result.hidden = !over;

    const player = state.players[0];
    const short = player ? Casino.getBalance() < state.bet : false;

    if (el.betTotal) el.betTotal.textContent = fmt(state.bet);
    if (el.betLimit) el.betLimit.textContent = `из ${fmt(maxBet())}`;
    if (el.betHint) {
      el.betHint.hidden = !short || !lobby;
      el.betHint.textContent = short
        ? 'На балансе меньше ставки — уменьшите ставку или заберите бонус на главной.'
        : '';
    }
    if (el.dealBtn) el.dealBtn.disabled = short;
    if (el.multValue) el.multValue.textContent = multLabel(state.botCount);
    if (el.chipsRow) {
      el.chipsRow.querySelectorAll('[data-chip]').forEach((chip) => {
        chip.classList.toggle('on', Number(chip.dataset.chip) === state.bet);
      });
      Casino.syncChips(el.chipsRow);
    }
    if (el.botPicker) {
      el.botPicker.querySelectorAll('[data-bots]').forEach((btn) => {
        btn.classList.toggle('on', Number(btn.dataset.bots) === state.botCount);
        btn.disabled = !lobby;
      });
    }

    const myTurn = Boolean(state.pending && state.pending.actor === 0);
    const canBito = myTurn && state.pending.type === 'add';
    const canTake = myTurn && state.pending.type === 'beat';
    // Активная кнопка — золотая, неактивная — призрачная: во время
    // защиты главная кнопка «Взять», во время подкидывания — «Бито».
    if (el.bitoBtn) {
      el.bitoBtn.disabled = !canBito;
      el.bitoBtn.classList.toggle('primary-btn', canBito || !canTake);
      el.bitoBtn.classList.toggle('ghost-btn', !canBito && canTake);
    }
    if (el.takeBtn) {
      el.takeBtn.disabled = !canTake;
      el.takeBtn.classList.toggle('primary-btn', canTake);
      el.takeBtn.classList.toggle('ghost-btn', !canTake);
    }
    if (el.actionsStake) {
      el.actionsStake.innerHTML = `ставка <b>${fmt(state.bet)}</b> · выигрыш <b>${multLabel()}</b>`;
    }
    if (over && state.result && el.resultText) {
      const result = state.result;
      const head = result.won ? 'Победа!' : 'Вы дурак';
      const money = result.net > 0 ? signed(result.net) : result.net < 0 ? signed(result.net) : '0\u00A0₽';
      el.resultText.className = `result-text ${result.net > 0 ? 'win' : result.net < 0 ? 'lose' : ''}`;
      el.resultText.innerHTML = `${head}<br><span>${money}</span>`;
    }
    if (el.message) {
      el.message.textContent = statusText();
      el.message.className = `message ${state.screen === 'over' && state.result ? (state.result.won ? 'win' : 'lose') : ''}`.trim();
    }
  }

  function renderRounds() {
    if (!el.roundsList) return;
    const list = Casino.history(GAME_ID).slice(0, HISTORY_SHOWN);
    el.roundsList.innerHTML = list.length
      ? list.map(roundCardHTML).join('')
      : '<p class="round-empty">Партий пока нет. Выберите соперников и нажмите «Раздать».</p>';
  }

  function roundCardHTML(entry) {
    const net = Number(entry.net) || 0;
    const cls = net > 0 ? 'win' : net < 0 ? 'lose' : '';
    return `<article class="round-card ${cls}">
      <b class="${net > 0 ? 'plus' : net < 0 ? 'minus' : ''}">${net === 0 ? 'без выигрыша' : signed(net)}</b>
      <span>${entry.summary || ''}</span>
      <span>ставка ${fmt(entry.bet || 0)}${entry.payout ? ` · выплата ${fmt(entry.payout)}` : ''}${Casino.insuranceTagHTML(entry)}</span>
      <time class="round-time">${Casino.timeLabel(entry.ts)}</time>
    </article>`;
  }

  function render() {
    renderBankroll();
    renderTrump();
    renderBots();
    renderTable();
    renderHand();
    renderPanel();
    renderRounds();
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
        Casino.save();
        closeModal();
        render();
      });
    }
  }

  function closeModal() {
    if (!el.overlay) return;
    el.overlay.hidden = true;
    el.modalBody.innerHTML = '';
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus({ preventScroll: true });
    }
  }

  function openHistory() {
    const list = Casino.history(GAME_ID);
    openModal(`
      <h2>История партий</h2>
      <div class="modal-scroll">
        ${list.length
          ? `<div class="rounds-list rounds-history-full">${list.map(roundCardHTML).join('')}</div>`
          : '<p class="round-empty">Партий пока нет. Выберите соперников и нажмите «Раздать».</p>'}
      </div>
      <div class="modal-actions"><button class="primary-btn" data-close>Закрыть</button></div>
    `);
  }

  function openRules() {
    openModal(`
      <h2>Правила «Дурака»</h2>
      <p>Подкидной дурак на 36 картах: играете против одного–пяти ботов.
      Цель — избавиться от карт раньше остальных. Кто остался с картами
      последним, тот дурак.</p>

      <h3>Стол</h3>
      <ul>
        <li>По шесть карт каждому, козырь — нижняя карта колоды.</li>
        <li>В шапке стола два счётчика: сколько карт осталось в колоде и сколько
        уже бито. Вместе с руками и столом они всегда дают 36 карт — карты
        из игры не пропадают.</li>
        <li>Первым ходит тот, у кого младший козырь.</li>
        <li>Атаку можно отбить старшей картой той же масти или козырем.</li>
        <li>Подкидывать можно только карты тех рангов, что уже лежат на столе,
        и не больше шести пар за заход.</li>
        <li>Не хотите отбиваться — нажмите «Взять»: все карты со стола уйдут
        вам в руку.</li>
        <li>Когда всё отбито, нажмите «Бито» — карты уйдут в отбой,
        а вы станете следующим атакующим.</li>
        <li>Из колоды все добирают до шести карт: атакующий первым,
        защитник последним.</li>
      </ul>

      <h3>Ставка</h3>
      <p>Ставка списывается перед раздачей. Вы остались не дураком — возврат
      ${multLabel(1)} при одном боте, ${multLabel(2)} при двух, ${multLabel(3)} при трёх,
      ${multLabel(4)} при четырёх и ${multLabel(5)} при пяти. Чем больше соперников,
      тем выше шанс не остаться дураком, поэтому и коэффициент ниже:
      комиссия казино — 10%.</p>
      <p>Остались дураком — ставка уходит. Если есть страховка, она вернёт
      половину проигрыша.</p>
      <div class="modal-actions"><button class="primary-btn" data-close>Понятно</button></div>
    `);
  }

  function openStats() {
    const stats = Casino.stats(GAME_ID);
    const games = stats.rounds || 0;
    const share = games ? Math.round(((stats.wins || 0) / games) * 100) : 0;
    openModal(`
      <h2>Статистика дурака</h2>
      <div class="stat-grid">
        <span>Партий</span><span>${numFmt.format(games)}</span>
        <span>Побед / поражений</span><span>${numFmt.format(stats.wins || 0)} / ${numFmt.format(stats.losses || 0)}</span>
        <span>Доля побед</span><span>${share}%</span>
        <span>Ставок сделано</span><span>${fmt(stats.wagered || 0)}</span>
        <span>Лучшая партия</span><span>${fmt(stats.bestWin || 0)}</span>
        <span>Итог игры</span><span>${signed(stats.net || 0)}</span>
      </div>
      <p class="stat-note">Партия считается победой, если вы вышли из игры
      раньше, чем остались последним с картами.</p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="reset">Сбросить статистику</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
  }

  // ---------- События ----------
  if (el.playerHand) {
    el.playerHand.addEventListener('click', (event) => {
      const card = event.target.closest('[data-id]');
      if (!card || card.disabled) return;
      humanPlay(card.dataset.id);
    });
  }

  if (el.chipsRow) {
    el.chipsRow.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-chip]');
      if (!chip) return;
      if (state.screen !== 'lobby') return;
      const value = Number(chip.dataset.chip);
      state.bet = Math.max(MIN_BET, Math.min(maxBet(), value));
      render();
    });
  }

  if (el.botPicker) {
    el.botPicker.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-bots]');
      if (!btn || state.screen !== 'lobby') return;
      state.botCount = clampBots(btn.dataset.bots);
      render();
    });
  }

  if (el.dealBtn) {
    el.dealBtn.addEventListener('click', () => {
      if (state.screen !== 'lobby') return;
      startGame(state.botCount, state.bet);
    });
  }

  if (el.bitoBtn) el.bitoBtn.addEventListener('click', humanBito);
  if (el.takeBtn) el.takeBtn.addEventListener('click', humanTake);

  if (el.againBtn) {
    el.againBtn.addEventListener('click', () => {
      state.screen = 'lobby';
      state.players = [];
      state.round = null;
      state.pending = null;
      state.result = null;
      state.deck = [];
      state.discard = [];
      state.trumpCard = null;
      render();
    });
  }

  if (el.historyBtn) el.historyBtn.addEventListener('click', openHistory);
  if (el.historyTopBtn) el.historyTopBtn.addEventListener('click', openHistory);
  if (el.rulesBtn) el.rulesBtn.addEventListener('click', openRules);
  if (el.statsBtn) el.statsBtn.addEventListener('click', openStats);
  if (el.modalClose) el.modalClose.addEventListener('click', closeModal);

  if (el.soundBtn) {
    el.soundBtn.addEventListener('click', () => {
      const on = !Casino.getSound();
      Casino.setSound(on);
      Casino.save();
      Casino.setSoundIcon(el.soundBtn, on);
    });
  }

  if (el.overlay) {
    el.overlay.addEventListener('click', (event) => {
      if (event.target === el.overlay) closeModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (el.overlay && !el.overlay.hidden) {
      if (Casino.keyOf(event) === 'escape') closeModal();
      return;
    }
    const key = Casino.keyOf(event);
    if (key === 'h') { event.preventDefault(); openHistory(); return; }
    if (key === 'r') { event.preventDefault(); openRules(); return; }
    if (key === ' ' || key === 'enter') {
      event.preventDefault();
      if (state.screen === 'lobby') startGame(state.botCount, state.bet);
      else if (state.screen === 'over') el.againBtn.click();
      else if (state.pending && state.pending.actor === 0 && state.pending.type === 'add') humanBito();
    }
  });

  // ---------- Старт ----------
  Casino.setSoundIcon(el.soundBtn, Casino.getSound());
  // Незавершённая партия после перезагрузки не должна держать ставку:
  // как в остальных играх, «зависшие» деньги возвращаются на баланс.
  Casino.settlePending(GAME_ID);
  Casino.save();
  render();

  // ---------- Тестовый хук ----------
  window.__DURAK_TEST__ = {
    state,
    HAND_SIZE,
    DECK_SIZE,
    MAX_PAIRS,
    MIN_BET,
    SUITS,
    RANKS,
    rankVal,
    beats,
    winMultiplier,
    multLabel,
    startGame,
    startRound,
    firstAttacker,
    tableRanks,
    canAttackWith,
    openPair,
    playAttack,
    playDefense,
    declineAdd,
    humanPlay,
    humanTake,
    humanBito,
    humanCanPlay,
    botAct,
    chooseAttack,
    chooseDefense,
    setTiming,
    setRng,
    render,
    roundCardHTML,
    endGame,
  };
})();
