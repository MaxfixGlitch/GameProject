import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/durak/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="durak.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/durak/durak.js`, 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

const CASINO_KEYS = ['casino.wallet.v1', 'casino.history.v1', 'casino.stats.v1', 'casino.pending.v1',
  'casino.sound.v1', 'casino.progress.v1', 'casino.topup.v1', 'casino.mini.v1'];

function boot(seed) {
  const dom = new JSDOM(html, {
    url: 'https://example.org/games/durak/?preview=1',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const store = dom.window.localStorage;
  if (seed && seed.getItem) {
    CASINO_KEYS.forEach((key) => {
      const value = seed.getItem(key);
      if (value !== null) store.setItem(key, value);
    });
  } else if (seed) {
    Object.entries(seed).forEach(([key, value]) => store.setItem(key, value));
  }
  dom.window.eval(rawCasino);
  dom.window.eval(rawGame);
  return { dom, window: dom.window, doc: dom.window.document, api: dom.window.__DURAK_TEST__ };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const balanceOf = (win) => win.Casino.getBalance();

const { window: win, doc, api } = boot();
api.setTiming({ bot: 1 });

// ---------- Колода ----------
console.log('• Колода');
check(api.RANKS.join('') === '678910JQKA', `ранги 6–A, получено ${api.RANKS.join(',')}`);
check(api.RANKS.length === 9 && api.SUITS.length === 4, '36 карт: девять рангов на четыре масти');
check(api.HAND_SIZE === 6, 'по шесть карт на руку');
check(api.MAX_PAIRS === 6, 'не больше шести пар за заход');

// ---------- Правила старшинства ----------
console.log('• Старшинство');
const card = (r, s) => ({ id: `${s}-${r}`, r, s });
api.startGame(1, 25);
const trump = api.state.trumpSuit;
const other = (trump + 1) % 4;
check(api.beats(card('7', other), card('6', other)), 'старшая карта той же масти бьёт младшую');
check(!api.beats(card('6', other), card('7', other)), 'младшая карту не бьёт');
check(!api.beats(card('A', other), card('6', other + 1 > 3 ? 0 : other + 1)), 'чужая масть не бьёт');
check(api.beats(card('6', trump), card('A', other)), 'младший козырь бьёт старшую чужую масть');
check(!api.beats(card('A', other), card('6', trump)), 'чужая масть козырь не бьёт');
check(api.rankVal('A') === 14 && api.rankVal('6') === 6, 'туз старше шестёрки');

// ---------- Раздача ----------
console.log('• Раздача');
const fresh = boot();
fresh.window.Casino.setBalance(1000);
fresh.api.setTiming({ bot: 1 });
const st = fresh.api.startGame(1, 100);
check(st.screen === 'playing', 'партия началась');
check(st.players.length === 2, 'один бот за столом');
check(st.players.every((p) => p.hand.length === 6), 'по шесть карт каждому');
const onHands = st.players.reduce((sum, p) => sum + p.hand.length, 0);
check(onHands + st.deck.length === 36, `всего 36 карт, получено ${onHands + st.deck.length}`);
check(st.trumpCard && st.trumpCard.s === st.trumpSuit, 'козырь — нижняя карта колоды');
check(st.round && st.round.attacker !== st.round.defender, 'атакующий и защитник — разные игроки');
check(fresh.window.Casino.getBalance() === 900, `ставка списана: 900, получено ${fresh.window.Casino.getBalance()}`);
check(fresh.window.Casino.getPending('durak') === 100, 'ставка помечена как «в игре»');

// Младший козырь ходит первым.
{
  let bestRank = 99;
  let who = -1;
  st.players.forEach((player, index) => {
    player.hand.forEach((c) => {
      if (c.s !== st.trumpSuit) return;
      const rank = fresh.api.rankVal(c.r);
      if (rank < bestRank) { bestRank = rank; who = index; }
    });
  });
  check(who === -1 || fresh.api.firstAttacker() === who,
    `первым ходит тот, у кого младший козырь (${who}), получено ${fresh.api.firstAttacker()}`);
  check(who === -1 || st.round.attacker === who, 'атакующий — владелец младшего козыря');
}

// ---------- Розыгрыш до конца ----------
console.log('• Партия до конца');

async function playOut(game, limit = 4000) {
  let steps = 0;
  while (game.api.state.screen === 'playing' && steps < limit) {
    const pending = game.api.state.pending;
    if (pending && pending.actor === 0) {
      const player = game.api.state.players[0];
      let played = false;
      if (pending.type === 'beat') {
        const pair = game.api.openPair();
        const answer = pair ? player.hand.find((c) => game.api.beats(c, pair.attack)) : null;
        if (answer) played = game.api.humanPlay(answer.id);
        if (!played) game.api.humanTake();
      } else {
        const option = player.hand.find((c) => game.api.humanCanPlay(c));
        if (option) played = game.api.humanPlay(option.id);
        if (!played && pending.type === 'add') game.api.humanBito();
      }
    }
    await sleep(2);
    steps += 1;
    if (game.api.state.screen !== 'playing') break;
  }
  return steps;
}

const budget = 900;
const played = await playOut(fresh, 40000);
check(played < 40000, 'партия дошла до конца без зависания');
check(fresh.api.state.screen === 'over', `партия закончилась, экран: ${fresh.api.state.screen}`);
check(fresh.api.state.result !== null, 'итог посчитан');

// После партии карты не потерялись: руки + отбой + колода = 36.
const left = fresh.api.state.players.reduce((sum, p) => sum + p.hand.length, 0);
const table = fresh.api.state.discard.length;
check(left + table + fresh.api.state.deck.length === 36,
  `после партии 36 карт, получено ${left + table + fresh.api.state.deck.length}`);

const finalBalance = fresh.window.Casino.getBalance();
const result = fresh.api.state.result;
check(finalBalance === 900 + result.payout,
  `баланс = 900 + выплата ${result.payout}, получено ${finalBalance}`);
if (result.won) {
  check(result.payout === Math.round(100 * fresh.api.winMultiplier(1)), 'при победе выплата ×1,9');
} else {
  check(result.payout === 0, 'за дурака выплаты нет');
}
check(fresh.window.Casino.history('durak').length === 1, 'партия попала в историю');
check(fresh.window.Casino.stats('durak').rounds === 1, 'статистика учла партию');
check(fresh.window.Casino.getPending('durak') === 0, 'ставка больше не «в игре»');

// ---------- Коэффициенты ----------
console.log('• Коэффициенты');
check(Math.abs(api.winMultiplier(1) - 1.9) < 1e-9, 'один бот — ×1,9');
check(Math.abs(api.winMultiplier(2) - 1.45) < 1e-9, 'два бота — ×1,45');
check(Math.abs(api.winMultiplier(5) - 1.18) < 1e-9, 'пять ботов — ×1,18');
check(api.multLabel(1) === '×1,9' && api.multLabel(5) === '×1,18', 'подписи коэффициентов');

// ---------- Один–пять ботов ----------
console.log('• Число ботов');
for (const bots of [1, 3, 5]) {
  const game = boot();
  game.window.Casino.setBalance(5000);
  game.api.setTiming({ bot: 0 });
  const started = game.api.startGame(bots, 100);
  check(started.players.length === bots + 1, `${bots} бота: за столом ${started.players.length} игроков`);
  const seatCards = Math.min(6, Math.floor(35 / (bots + 1)));
  check(started.players.every((p) => p.hand.length === seatCards),
    `${bots} бота: по ${seatCards} карт, получено ${started.players.map((p) => p.hand.length).join(',')}`);
  const total = started.players.reduce((sum, p) => sum + p.hand.length, 0) + started.deck.length;
  check(total === 36, `${bots} бота: колода целая, получено ${total}`);
  check(started.deck.length >= 1, `${bots} бота: в колоде осталась карта-козырь`);
  check(started.trumpCard && started.deck.length >= 1, `${bots} бота: козырь виден`);
  check(started.round.limit >= 1 && started.round.limit <= 6, `${bots} бота: лимит пар 1–6`);

  // Один круг ходов не должен ломать стол.
  await sleep(40);
  check(game.api.state.players.length === bots + 1, `${bots} бота: ходы не теряют игроков`);
  check(game.api.state.screen === 'playing', `${bots} бота: партия ещё идёт`);
}

// ---------- Подкидывание ----------
console.log('• Подкидывание');
{
  const game = boot();
  game.window.Casino.setBalance(5000);
  game.api.setTiming({ bot: 100000 });
  const started = game.api.startGame(1, 100);

  // Ставим конкретную руку человеку и боту, чтобы проверить подкидывание.
  const trumpSuit = started.trumpSuit;
  const otherSuit = (trumpSuit + 1) % 4;
  started.players[0].hand = [card('7', otherSuit), card('7', (otherSuit + 1) % 4), card('K', otherSuit)];
  started.players[1].hand = [card('8', otherSuit), card('10', otherSuit)];
  started.round = { attacker: 0, defender: 1, pairs: [], limit: 6, taking: false, order: [], cursor: 0, passed: 0 };
  started.pending = { type: 'attack', actor: 0 };
  game.api.render();

  // В начале захода можно ходить любой картой.
  check(game.api.canAttackWith(started.players[0].hand[2]), 'первой картой — любой');

  game.api.humanPlay(card('7', otherSuit).id);
  check(game.api.state.pending.type === 'beat', 'после атаки отбивается защитник');
  check(game.api.state.round.pairs.length === 1, 'на столе одна пара');

  // Бот ставит защиту.
  const pair = game.api.state.round.pairs[0];
  check(pair.attack.r === '7', 'атакует семёрка');
  game.api.playDefense(1, started.players[1].hand.find((c) => game.api.beats(c, pair.attack)));
  check(game.api.state.pending.type === 'add', 'пара отбита — фаза подкидывания');

  // Подкидывать можно только тот же ранг.
  const seven = started.players[0].hand.find((c) => c.r === '7');
  const king = started.players[0].hand.find((c) => c.r === 'K');
  check(game.api.canAttackWith(seven), 'вторую семёрку подкинуть можно');
  check(!game.api.canAttackWith(king), 'короля подкинуть нельзя — такого ранга на столе нет');

  game.api.humanPlay(seven.id);
  check(game.api.state.round.pairs.length === 2, 'вторая пара на столе');

  // Бот не может отбиться — забирает.
  const botHand = started.players[1].hand;
  const canBeat = botHand.some((c) => game.api.beats(c, seven));
  if (!canBeat) {
    game.api.botAct(1);
    check(game.api.state.round === null || game.api.state.round.taking, 'бот сказал «взять»');
  }
}

// ---------- Ставка и баланс ----------
console.log('• Ставка');
{
  const game = boot();
  game.window.Casino.setBalance(1000);
  game.api.setTiming({ bot: 100000 });
  check(game.api.startGame(1, 100) !== null, 'партия начинается при достаточном балансе');
  const poor = boot();
  poor.window.Casino.setBalance(10);
  check(poor.api.startGame(1, 100) === null, 'без денег партия не начинается');
  check(poor.window.Casino.getBalance() === 10, 'баланс не ушёл в минус');
}

// ---------- История и окно ----------
console.log('• История');
{
  doc.querySelector('#historyBtn').click();
  check(!doc.querySelector('#overlay').hidden, 'история открывается');
  check(doc.querySelector('#modalBody').textContent.includes('История партий'), 'заголовок истории');
  const shown = doc.querySelectorAll('#modalBody .round-card').length;
  check(shown === win.Casino.history('durak').length,
    `в окне истории столько же партий, сколько в данных: ${shown} и ${win.Casino.history('durak').length}`);
  check(doc.querySelector('#modalBody .modal-scroll'), 'прокручивается только список');
  doc.querySelector('#modalClose').click();
  check(doc.querySelector('#overlay').hidden, 'история закрывается');
}

// ---------- Правила ----------
console.log('• Правила');
{
  doc.querySelector('#rulesBtn').click();
  const text = doc.querySelector('#modalBody').textContent;
  check(text.includes('Правила «Дурака»'), 'окно правил открывается');
  check(text.includes('36 картах'), 'правила упоминают 36 карт');
  check(text.includes('козырь'), 'правила объясняют козырь');
  doc.querySelector('#modalClose').click();
}

// ---------- Статистика ----------
console.log('• Статистика');
{
  doc.querySelector('#statsBtn').click();
  const text = doc.querySelector('#modalBody').textContent;
  check(text.includes('Статистика дурака'), 'статистика открывается');
  check(text.includes('Партий'), 'в статистике есть число партий');
  doc.querySelector('[data-action="reset"]').click();
  check(win.Casino.stats('durak').rounds === 0, 'статистика обнулена');
  check(win.Casino.history('durak').length === 0, 'история очищена');
  check(doc.querySelectorAll('#roundsList .round-card').length === 0, 'история на странице пуста');
}

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
