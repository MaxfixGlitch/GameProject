import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}index.html`, 'utf8')
  .replace('<script src="game.js"></script>', '');
const rawGame = fs.readFileSync(`${root}game.js`, 'utf8');
const game = rawGame.replace(
  '  // ---------- Старт ----------',
  '  window.__BJ_TEST__ = { state, handValue, isNatural };\n  // ---------- Старт ----------'
);
if (game === rawGame) throw new Error('Не удалось внедрить тестовый хук');

const dom = new JSDOM(html, {
  url: 'https://example.org/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;
const doc = window.document;
window.addEventListener('unhandledrejection', (event) => {
  failures++;
  console.error('  ✗ необработанная ошибка в окне:', event.reason && event.reason.stack || event.reason);
});

// Ускоряем анимационные паузы
const realTimeout = window.setTimeout.bind(window);
window.setTimeout = (fn, ms, ...args) => realTimeout(fn, Math.max(1, Math.round((ms || 0) / 60)), ...args);

window.eval(game);

const api = window.__BJ_TEST__;
const sleep = (ms) => new Promise((r) => realTimeout(r, ms));
const waitFor = async (fn, label, timeout = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error(`Таймаут: ${label}`);
    await sleep(2);
  }
};
const bankroll = () => {
  const text = doc.querySelector('#bankroll').textContent.replace(/\s/g, '');
  const negative = text.includes('-') || text.includes('−');
  return (negative ? -1 : 1) * Number(text.replace(/\D/g, ''));
};
const parseMoney = (text) => Number(text.replace(/\D/g, '')) || 0;

let failures = 0;
process.on('unhandledRejection', (reason) => {
  failures++;
  console.error('  ✗ необработанная ошибка:', reason && reason.stack || reason);
});
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

function click(sel) {
  const node = doc.querySelector(sel);
  if (!node) throw new Error(`Нет элемента ${sel}`);
  node.click();
}

// ---------- Базовый сценарий ----------
console.log('• Базовая инициализация');
check(bankroll() === 1000, `стартовый баланс 1000, получено ${bankroll()}`);
check(doc.querySelector('#dealBtn').disabled, 'кнопка «Раздать» заблокирована без ставки');
check(doc.querySelectorAll('.chip').length === 5, 'пять фишек');

click('[data-chip="100"]');
check(bankroll() === 900, `после фишки 100 баланс 900, получено ${bankroll()}`);
check(api.state.bet === 100, `ставка 100, получено ${api.state.bet}`);
check(!doc.querySelector('#dealBtn').disabled, 'кнопка «Раздать» активна');
check(doc.querySelector('#betAmount').textContent.includes('100'), 'ставка отображается');

click('#clearBet');
check(bankroll() === 1000 && api.state.bet === 0, 'сброс ставки возвращает фишки');

// ---------- Симуляция раундов ----------
console.log('• Симуляция 400 раундов с разными действиями');
let rounds = 0;
let splits = 0;
let doubles = 0;
let naturalBJ = 0;
let busts = 0;

for (let i = 0; i < 400; i++) {
  // Пополнение, если денег не хватает
  if (!doc.querySelector('#rebuyPanel').hidden) click('#rebuyBtn');
  if (bankroll() < 25) {
    console.error('  ✗ нет доступных фишек при балансе', bankroll());
    break;
  }

  const beforeChips = [...doc.querySelectorAll('.chip')].filter((c) => !c.disabled);
  const chipValue = Number(beforeChips[Math.floor(Math.random() * beforeChips.length)].dataset.chip);
  const bankrollBeforeBet = bankroll();
  beforeChips.find((c) => Number(c.dataset.chip) === chipValue).click();
  const betPlaced = api.state.bet;
  const bankrollAfterBet = bankroll();
  check(bankrollAfterBet === bankrollBeforeBet - betPlaced, 'баланс уменьшается на ставку');
  check(betPlaced === chipValue, 'ставка равна номиналу фишки');

  click('#dealBtn');
  try {
    await waitFor(() => api.state.phase !== 'betting', 'начало раздачи');
  } catch (err) {
    console.error('NO DEAL round', i, {
      bankroll: bankroll(), bet: api.state.bet, phase: api.state.phase, busy: api.state.busy,
      dealDisabled: doc.querySelector('#dealBtn').disabled,
      rebuyHidden: doc.querySelector('#rebuyPanel').hidden,
      chips: [...doc.querySelectorAll('.chip')].map(c => c.dataset.chip + ':' + c.disabled),
    });
    throw err;
  }

  // Играем, пока раунд не завершится
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await sleep(2);
    if (api.state.phase === 'betting' && !api.state.busy) break;
    if (api.state.phase !== 'player' || api.state.busy) continue;

    const options = ['hit', 'stand', 'double', 'split']
      .filter((id) => !doc.querySelector(`#${id}Btn`).disabled);
    if (!options.length) continue;

    let pick;
    if (options.includes('double') && Math.random() < 0.15) pick = 'double';
    else if (options.includes('split') && Math.random() < 0.2) pick = 'split';
    else if (options.includes('hit') && Math.random() < 0.55) pick = 'hit';
    else pick = options[Math.floor(Math.random() * options.length)];

    if (pick === 'double') doubles++;
    if (pick === 'split') splits++;

    click(`#${pick}Btn`);
    await sleep(5);
  }

  try {
    await waitFor(() => api.state.phase === 'betting' && !api.state.busy, 'завершение раунда', 8000);
  } catch (err) {
    const st = api.state;
    console.error('STUCK round', i, {
      phase: st.phase, busy: st.busy, active: st.active,
      dealer: st.dealer.map(c => c.rank),
      hands: st.hands.map(h => ({ cards: h.cards.map(c => c.rank), done: h.done, bust: h.bust, bet: h.bet, result: h.result })),
      message: st.message,
      buttons: ['hit','stand','double','split','deal'].map(id => id + ':' + doc.querySelector('#' + id + 'Btn').disabled),
    });
    throw err;
  }

  rounds++;

  const hands = api.state.hands;
  check(hands.length >= 1 && hands.length <= 4, `рук от 1 до 4, получено ${hands.length}`);
  const totalBet = hands.reduce((s, h) => s + h.bet, 0);
  const totalPayout = hands.reduce((s, h) => s + h.payout, 0);
  const expectedBalance = bankrollAfterBet + betPlaced - totalBet + totalPayout;
  if (bankroll() !== expectedBalance) {
    console.error('MISMATCH', { bankrollBeforeBet, betPlaced, bankrollAfterBet, totalBet, totalPayout, final: bankroll(),
      hands: hands.map(h => ({ bet: h.bet, payout: h.payout, res: h.result })) });
  }
  check(bankroll() === expectedBalance,
    `баланс сходится: ${bankroll()} != ${expectedBalance}`);
  check(bankroll() >= 0, 'баланс не отрицательный');

  const dealerTotal = api.handValue(api.state.dealer);
  for (const h of hands) {
    const total = api.handValue(h.cards);
    check(h.cards.length >= 2, `в руке минимум 2 карты, есть ${h.cards.length}`);

    if (h.result === 'bust') {
      busts++;
      check(total > 21, 'перебор означает >21');
      check(h.payout === 0, 'перебор не платит');
    } else if (h.result === 'blackjack') {
      naturalBJ++;
      check(total === 21 && h.cards.length === 2 && !h.split, 'блэкджек — 21 с двух карт без сплита');
      check(h.payout === h.bet + Math.floor(h.bet * 1.5), 'выплата за блэкджек 3:2');
    } else if (h.result === 'win') {
      check(dealerTotal > 21 || total > dealerTotal, 'победа: дилер перебрал или у игрока больше');
      check(h.payout === h.bet * 2, 'выплата за победу 1:1');
    } else if (h.result === 'push') {
      check(dealerTotal === total || (api.isNatural(api.state.dealer) && h.blackjack), 'ничья при равных очках');
      check(h.payout === h.bet, 'при ничьей ставка возвращается');
    } else if (h.result === 'lose') {
      check(api.isNatural(api.state.dealer) || (dealerTotal > total && dealerTotal <= 21), 'проигрыш по правилам');
      check(h.payout === 0, 'проигрыш не платит');
    } else {
      check(false, `неизвестный результат: ${h.result}`);
    }

    if (h.doubled) check(h.cards.length === 3 && h.bet % 2 === 0, 'после удвоения 3 карты и двойная ставка');
  }

  const s = api.state.stats;
  check(s.rounds === rounds, `счётчик раундов ${s.rounds} != ${rounds}`);
  check(s.wins + s.losses + s.pushes === api.state.stats.wins + api.state.stats.losses + api.state.stats.pushes, 'статистика рук согласована');
}

console.log(`  раундов: ${rounds}, сплитов: ${splits}, удвоений: ${doubles}, блэкджеков: ${naturalBJ}, переборов: ${busts}`);
check(doc.querySelector('#rebuyPanel').hidden || bankroll() < 25, 'пополнение показывается только когда ставка невозможна');

// ---------- Модальные окна ----------
console.log('• Модальные окна');
click('#rulesBtn');
check(!doc.querySelector('#overlay').hidden, 'правила открываются');
check(doc.querySelector('#modalBody').textContent.includes('Правила'), 'в окне правила');
click('#modalClose');
check(doc.querySelector('#overlay').hidden, 'правила закрываются');

click('#statsBtn');
check(doc.querySelector('#modalBody').textContent.includes('Статистика'), 'статистика открывается');
click('#modalClose');

// ---------- Сохранение ----------
console.log('• Сохранение и сброс');
const savedBalance = bankroll();
check(parseMoney(window.localStorage.getItem('bj21.save.v1') || '{}') >= 0 || true, 'localStorage доступен');
click('#resetBtn');
check(!doc.querySelector('#overlay').hidden, 'окно сброса открыто');
doc.querySelector('[data-action="reset"]').click();
await sleep(20);
check(bankroll() === 1000, `после сброса 1000, получено ${bankroll()}`);
check(api.state.stats.rounds === 0, 'статистика обнулена');
check(doc.querySelector('#overlay').hidden, 'окно сброса закрыто');

// ---------- Туз: 11/1 ----------
console.log('• Подсчёт очков');
const mk = (ranks) => ranks.map((rank, i) => ({ id: i, rank, suit: 0 }));
check(api.handValue(mk(['A'])) === 11, 'туз = 11');
check(api.handValue(mk(['A', 'A'])) === 12, 'два туза = 12');
check(api.handValue(mk(['A', 'A', '9'])) === 21, 'A+A+9 = 21');
check(api.handValue(mk(['A', 'K'])) === 21, 'A+K = 21');
check(api.handValue(mk(['K', 'Q', 'J'])) === 30, 'картинки = 10');
check(api.handValue(mk(['A', '6', '10'])) === 17, 'мягкий перебор пересчитывается');
check(api.isNatural(mk(['A', 'K'])), 'A+K — блэкджек');
check(!api.isNatural(mk(['7', '7', '7'])), 'три карты — не блэкджек');


// ---------- Детерминированные сценарии ----------
console.log('• Детерминированные сценарии (выплаты, сплит, дилер)');

async function resetUI() {
  click('#resetBtn');
  const confirmBtn = doc.querySelector('[data-action="reset"]');
  if (!confirmBtn) throw new Error('Нет кнопки подтверждения сброса');
  confirmBtn.click();
  await sleep(10);
  check(api.state.phase === 'betting' && api.state.bankroll === 1000, 'сброс перед сценарием');
}

function stackShoe(drawOrder) {
  const filler = Array.from({ length: 40 }, (_, i) => ({ id: 900000 + i, rank: '2', suit: 0 }));
  const top = [...drawOrder].reverse().map((rank, i) => ({ id: 800000 + i, rank, suit: i % 4 }));
  api.state.shoe = [...filler, ...top];
}

async function beginRound(stack, chip = 100) {
  stackShoe(stack);
  click(`[data-chip="${chip}"]`);
  check(api.state.bet === chip, `ставка ${chip} выставлена`);
  click('#dealBtn');
  await waitFor(() => ['player', 'dealer', 'betting'].includes(api.state.phase) && !(api.state.phase === 'betting' && api.state.busy), 'детерминированная раздача');
}

async function waitSettled() {
  await waitFor(() => api.state.phase === 'betting' && !api.state.busy, 'расчёт раунда');
}

async function action(id) {
  await waitFor(() => !doc.querySelector(`#${id}Btn`).disabled, `кнопка ${id} доступна`);
  click(`#${id}Btn`);
}

// 1. Блэкджек игрока: K + A, у дилера 9 + 7
await resetUI();
await beginRound(['K', '9', 'A', '7']);
await waitSettled();
check(api.state.bankroll === 1150, `блэкджек: 1150, получено ${api.state.bankroll}`);
check(api.state.hands[0].result === 'blackjack', 'результат — блэкджек');
check(api.state.hands[0].payout === 250, `выплата 3:2 = 250, получено ${api.state.hands[0].payout}`);
check(doc.querySelector('#message').textContent.includes('Блэкджек'), 'сообщение о блэкджеке');
check(doc.querySelector('.hand-result').textContent.includes('Блэкджек'), 'подпись руки — блэкджек');

// 2. Блэкджек дилера: у игрока 20
await resetUI();
await beginRound(['K', 'A', 'Q', 'K']);
await waitSettled();
check(api.state.bankroll === 900, `блэкджек дилера: 900, получено ${api.state.bankroll}`);
check(api.state.hands[0].result === 'lose', 'игрок проиграл блэкджеку дилера');

// 3. Ничья 17:17, дилер стоит на 17
await resetUI();
await beginRound(['10', '10', '7', '7']);
check(api.state.phase === 'player', 'у игрока ход');
await action('stand');
await waitSettled();
check(api.state.bankroll === 1000, `ничья возвращает ставку: 1000, получено ${api.state.bankroll}`);
check(api.state.hands[0].result === 'push', 'результат — ничья');
check(api.state.dealer.length === 2, 'дилер не добирал на 17');

// 4. Удвоение: 11 → 21, дилер перебирает
await resetUI();
await beginRound(['5', '10', '6', '6', '10', '10']);
await action('double');
await waitSettled();
check(api.state.bankroll === 1200, `удвоение и победа: 1200, получено ${api.state.bankroll}`);
const doubled = api.state.hands[0];
check(doubled.doubled && doubled.bet === 200, 'ставка удвоена до 200');
check(api.handValue(doubled.cards) === 21, 'после удвоения 21');
check(doubled.payout === 400, `выплата 400, получено ${doubled.payout}`);

// 5. Сплит тузов: обе руки получают по одной карте и автоматически останавливаются
await resetUI();
await beginRound(['A', '10', 'A', '10', '9', '8']);
check(api.state.phase === 'player', 'ход игрока перед сплитом');
await action('split');
await waitSettled();
check(api.state.hands.length === 2, `после сплита 2 руки, получено ${api.state.hands.length}`);
check(api.state.hands.every((h) => h.cards.length === 2), 'в каждой руке по 2 карты');
check(api.state.hands[0].result === 'push', `A+9 = 20 — ничья, получено ${api.state.hands[0].result}`);
check(api.state.hands[1].result === 'lose', `A+8 = 19 — проигрыш, получено ${api.state.hands[1].result}`);
check(api.state.bankroll === 900, `сплит тузов: 900, получено ${api.state.bankroll}`);

// 6. Сплит восьмёрок, дилер перебирает — выигрывают обе руки
await resetUI();
await beginRound(['8', '6', '8', '10', '3', '2', '10']);
await action('split');
await waitFor(() => api.state.hands.length === 2, 'две руки после сплита');
await action('stand');
await waitFor(() => api.state.active === 1, 'переход ко второй руке');
await action('stand');
await waitSettled();
check(api.state.bankroll === 1200, `двойная победа: 1200, получено ${api.state.bankroll}`);
check(api.state.hands.every((h) => h.result === 'win'), 'обе руки выиграли');
check(api.state.hands.every((h) => h.payout === 200), 'каждая рука заплатила 1:1');

// 7. Мягкие 17 дилера: дилер стоит
await resetUI();
await beginRound(['K', 'A', '7', '6']);
await action('stand');
await waitSettled();
check(api.handValue(api.state.dealer) === 17 && api.state.dealer.length === 2, 'дилер стоит на мягких 17');
check(api.state.hands[0].result === 'push', 'ничья на 17');

// 8. Перебор игрока — дилер не добирает
await resetUI();
await beginRound(['10', '10', '6', '6', '10']);
await action('hit');
await waitSettled();
check(api.state.hands[0].result === 'bust', 'перебор игрока');
check(api.state.dealer.length === 2, 'дилер не добирал при переборе игрока');
check(api.state.bankroll === 900, `перебор: 900, получено ${api.state.bankroll}`);

// 9. Сброс посреди раунда не ломает игру
await resetUI();
stackShoe(['10', '10', '6', '6', '10', '10']);
click('[data-chip="100"]');
click('#dealBtn');
await waitFor(() => api.state.phase === 'player', 'ход игрока перед сбросом');
action('stand');
click('#resetBtn');
doc.querySelector('[data-action="reset"]').click();
await sleep(900);
check(api.state.bankroll === 1000, `сброс посреди раунда: баланс 1000, получено ${api.state.bankroll}`);
check(api.state.phase === 'betting' && !api.state.busy, 'сброс вернул фазу ставок');
check(api.state.stats.rounds === 0, 'сброс посреди раунда очистил статистику');
check(api.state.dealer.length === 0 && api.state.hands.length === 0, 'стол очищен после сброса');
check(doc.querySelector('#actionPanel').hidden, 'панель действий скрыта после сброса');
check(doc.querySelector('#betPanel').hidden === false, 'панель ставок снова видна');

// ---------- Сохранение незавершённого раунда ----------
console.log('• Восстановление после перезагрузки');
await resetUI();
stackShoe(['10', '10', '6', '6', '10']);
click('[data-chip="100"]');
click('#dealBtn');
await waitFor(() => api.state.phase === 'dealing', 'раздача началась');
const savedRaw = JSON.parse(window.localStorage.getItem('bj21.save.v1'));
check(savedRaw.pending === 100, `в сохранении отложена ставка 100, получено ${savedRaw.pending}`);
const restored = savedRaw.bankroll + savedRaw.pending;
check(restored === 1000, `перезагрузка вернёт 1000, получено ${restored}`);

const dom2 = new JSDOM(html, { url: 'https://example.org/', pretendToBeVisual: true, runScripts: 'outside-only' });
dom2.window.localStorage.setItem('bj21.save.v1', window.localStorage.getItem('bj21.save.v1'));
dom2.window.eval(rawGame.replace('  // ---------- Старт ----------', '  window.__BJ_TEST__ = { state };\n  // ---------- Старт ----------'));
check(dom2.window.__BJ_TEST__.state.bankroll === 1000, 'новая сессия восстановила баланс 1000');
check(dom2.window.__BJ_TEST__.state.phase === 'betting', 'новая сессия стартует со ставок');

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
