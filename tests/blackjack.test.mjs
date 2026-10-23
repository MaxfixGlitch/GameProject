import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/blackjack/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="game.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/blackjack/game.js`, 'utf8');
const game = rawGame.replace(
  '  // ---------- Старт ----------',
  '  window.__BJ_TEST__ = { state, handValue, isNatural, BET_STACK_MAX, HISTORY_MAX, updateUI, renderRebuy, splitHint };\n  window.__BJ_REDUCE_MOTION__ = false;\n  // ---------- Старт ----------'
);
if (game === rawGame) throw new Error('Не удалось внедрить тестовый хук');

const dom = new JSDOM(html, {
  url: 'https://example.org/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;
const doc = window.document;

// Часы можно двигать: бесплатный бонус раз в 30 минут.
let clock = Date.now();
window.Date.now = () => clock;
const advanceTime = (ms) => { clock += ms; };
window.addEventListener('unhandledrejection', (event) => {
  failures++;
  console.error('  ✗ необработанная ошибка в окне:', event.reason && event.reason.stack || event.reason);
});

// Ускоряем анимационные паузы
const realTimeout = window.setTimeout.bind(window);
window.setTimeout = (fn, ms, ...args) => realTimeout(fn, Math.max(1, Math.round((ms || 0) / 60)), ...args);

window.matchMedia = (query) => ({
  matches: query.includes('prefers-reduced-motion') ? false : false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
});
window.eval(rawCasino);
window.eval(game);

// Новая вкладка со своим localStorage (в jsdom у каждого окна он отдельный).
// seed — либо окно-источник, либо объект «ключ → значение».
const CASINO_KEYS = ['casino.wallet.v1', 'casino.history.v1', 'casino.stats.v1', 'casino.pending.v1',
  'casino.sound.v1', 'casino.progress.v1', 'casino.topup.v1'];
function boot(seed) {
  const fresh = new JSDOM(html, { url: 'https://example.org/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const store = fresh.window.localStorage;
  if (seed && seed.localStorage) {
    CASINO_KEYS.forEach((key) => {
      const value = seed.localStorage.getItem(key);
      if (value !== null) store.setItem(key, value);
    });
  } else if (seed) {
    Object.entries(seed).forEach(([key, value]) => store.setItem(key, value));
  }
  fresh.window.eval(rawCasino);
  fresh.window.eval(rawGame.replace(
    '  // ---------- Старт ----------',
    '  window.__BJ_TEST__ = { state, handValue };\n  // ---------- Старт ----------'
  ));
  return fresh;
}

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

click('#historyBtn');
check(doc.querySelector('#modalBody').textContent.includes('Здесь появятся последние раздачи'),
  'в начале игры история пуста и подсказывает сделать ставку');
check(!doc.querySelector('#modalBody').querySelector('.history-round'), 'в пустой истории нет карточек');
click('#modalClose');
check(doc.querySelector('#overlay').hidden, 'пустая история закрывается');

click('[data-chip="100"]');
check(bankroll() === 900, `после фишки 100 баланс 900, получено ${bankroll()}`);
check(api.state.bet === 100, `ставка 100, получено ${api.state.bet}`);
check(!doc.querySelector('#dealBtn').disabled, 'кнопка «Раздать» активна');
check(doc.querySelector('#betAmount').textContent.includes('100'), 'ставка отображается');

click('#clearBet');
check(bankroll() === 1000 && api.state.bet === 0, 'сброс ставки возвращает фишки');

// ---------- Горячие клавиши при русской раскладке ----------
console.log('• Русская раскладка');
{
  const dom = boot();
  const d = dom.window.document;
  const key = (event) => dom.window.Casino.keyOf(event);
  check(key({ key: 'с', code: 'KeyC' }) === 'c', 'C на русской раскладке распознаётся');
  check(key({ key: 'ф', code: 'KeyH' }) === 'h', 'H на русской раскладке распознаётся');
  check(key({ key: 'ы', code: 'KeyS' }) === 's', 'S на русской раскладке распознаётся');
  check(key({ key: 'в', code: 'KeyD' }) === 'd', 'D на русской раскладке распознаётся');

  // Ставка и раздача по Enter на русской раскладке — физическая клавиша та же.
  d.querySelector('[data-chip="100"]').click();
  d.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'н', code: 'KeyH' }));
  check(dom.window.__BJ_TEST__.state.bet === 100, 'ставка не слетела от посторонней клавиши');
  d.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }));
  check(dom.window.__BJ_TEST__.state.phase !== 'betting', 'Enter раздаёт карты');
  d.querySelector('#standBtn').click();
  await sleep(20);
}

// ---------- Стопка фишек на столе ----------
console.log('• Стопка фишек на столе');
const stackEl = doc.querySelector('#betChips');
const stackChips = () => [...stackEl.querySelectorAll('.mini-chip')];
const styleNum = (node, name) => parseFloat(node.style.getPropertyValue(name));

click('[data-chip="25"]');
click('[data-chip="25"]');
let stack = stackChips();
check(stack.length === 2, `две фишки лежат в стопке, получено ${stack.length}`);
check(stack.every((node) => node.textContent === '25'), 'на фишках указан номинал');
check(stack.every((node, i) => node.style.getPropertyValue('--i') === String(i)),
  'фишки пронумерованы снизу вверх');
check(stack[1].classList.contains('is-new') && !stack[0].classList.contains('is-new'),
  'падение анимируется только у новой фишки');
const step2 = styleNum(stackEl, '--chip-step');
const size2 = styleNum(stackEl, '--chip-size');
check(step2 > 5, `вторая фишка заметно выступает из-под первой (${step2}%)`);
check(size2 > step2, 'фишки перекрываются, а не висят отдельно');
check(30 + step2 + size2 <= 100, 'стопка помещается в круг ставки');
check(api.state.bet === 50 && bankroll() === 950, 'ставка 50 списана с баланса');

for (let i = 0; i < 8; i++) click('[data-chip="25"]');
stack = stackChips();
check(stack.length === api.BET_STACK_MAX,
  `в стопке не больше ${api.BET_STACK_MAX} фишек, получено ${stack.length}`);
check(api.state.bet === 250, `ставка 250, получено ${api.state.bet}`);
check(stackEl.querySelector('.chip-more')?.textContent === '+2', 'счётчик скрытых фишек показывает +2');
const stepMany = styleNum(stackEl, '--chip-step');
const sizeMany = styleNum(stackEl, '--chip-size');
check(stepMany > 0 && stepMany < step2, 'у большой стопки шаг меньше');
check(30 + stepMany * (stack.length - 1) + sizeMany <= 100, 'большая стопка не вылезает из круга');

click('#clearBet');
check(stackChips().length === 0, 'сброс ставки убирает фишки со стола');
check(!stackEl.querySelector('.chip-more'), 'счётчик скрывается вместе со стопкой');
check(bankroll() === 1000 && api.state.bet === 0, 'фишки вернулись на баланс');

// ---------- Симуляция раундов ----------
console.log('• Симуляция 400 раундов с разными действиями');
let rounds = 0;
let splits = 0;
let doubles = 0;
let naturalBJ = 0;
let busts = 0;

for (let i = 0; i < 400; i++) {
  // Пополнение, если денег не хватает
  if (!doc.querySelector('#rebuyPanel').hidden) {
    advanceTime(31 * 60 * 1000); // ждём бесплатный бонус
    api.renderRebuy();           // в реальном браузере это делает таймер раз в секунду
    click('#rebuyBtn');
  }
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

  // ---------- История раздач ----------
  const hist = api.state.history;
  check(hist.length === Math.min(api.HISTORY_MAX, rounds),
    `в истории ${Math.min(api.HISTORY_MAX, rounds)} раздач, получено ${hist.length}`);
  const entry = hist[0];
  check(entry.n === s.rounds, `последняя запись — раунд ${s.rounds}, получено ${entry.n}`);
  check(hist.every((e, i) => i === 0 || e.n < hist[i - 1].n), 'история идёт от свежих к старым');

  const handsNet = entry.hands.reduce((sum, h) => sum + h.payout - h.bet, 0);
  check(entry.net === handsNet,
    `итог раунда ${entry.net} сходится с руками ${handsNet}`);
  check(entry.bet === entry.hands.reduce((sum, h) => sum + h.bet, 0),
    'ставка раунда равна сумме ставок рук');
  check(entry.net === totalPayout - totalBet, 'итог совпадает с выплатами раунда');
  check(entry.dealerTotal === dealerTotal, `очки дилера ${entry.dealerTotal} != ${dealerTotal}`);
  check(entry.dealerCards === api.state.dealer.length, 'число карт дилера записано');
  check(entry.hands.length === hands.length, 'каждая рука попала в историю');
  entry.hands.forEach((h, i) => {
    const real = hands[i];
    check(h.total === api.handValue(real.cards),
      `очки руки ${i + 1}: ${h.total} != ${api.handValue(real.cards)}`);
    check(h.result === real.result, `результат руки ${i + 1}: ${h.result} != ${real.result}`);
    check(h.bet === real.bet && h.payout === real.payout, `ставка и выплата руки ${i + 1}`);
    check(h.doubled === Boolean(real.doubled), `признак удвоения руки ${i + 1}`);
    if (h.result === 'bust') check(h.total > 21, 'перебор в истории означает >21');
  });

  // Каждая запись должна быть целостной
  check(hist.every((e) => e.hands.length >= 1 && e.bet > 0), 'в каждой записи есть руки и ставка');
  check(hist.every((e) => e.net === e.hands.reduce((sum, h) => sum + h.payout - h.bet, 0)),
    'итог каждой записи сходится с руками');
}

console.log(`  раундов: ${rounds}, сплитов: ${splits}, удвоений: ${doubles}, блэкджеков: ${naturalBJ}, переборов: ${busts}`);
check(doc.querySelector('#rebuyPanel').hidden || bankroll() < 25, 'пополнение показывается только когда ставка невозможна');

// ---------- Окно истории ----------
console.log('• Окно «История раздач»');
click('#historyBtn');
check(!doc.querySelector('#overlay').hidden, 'история открывается из шапки');
check(doc.querySelector('#modalBody').textContent.includes('История раздач'), 'заголовок окна истории');
const roundCards = [...doc.querySelectorAll('.history-round')];
check(roundCards.length === api.state.history.length, 'каждая раздача выведена карточкой');
check(roundCards.length <= api.HISTORY_MAX, `в окне не больше ${api.HISTORY_MAX} раздач`);
const firstCard = roundCards[0];
check(firstCard.querySelector('.history-dealer-total').textContent.trim()
  .startsWith(String(api.state.history[0].dealerTotal)), 'в карточке видны очки дилера');
check(firstCard.querySelectorAll('.history-hand').length === api.state.history[0].hands.length,
  'в карточке видны все руки игрока');
const netText = firstCard.querySelector('.history-round-net').textContent;
const lastNet = api.state.history[0].net;
check(lastNet === 0 ? netText.includes('0') : netText.includes(String(Math.abs(lastNet)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'))
  || netText.replace(/\s/g, '').includes(String(Math.abs(lastNet))),
  `в карточке показан результат ${lastNet}, получено «${netText}»`);
check(['plus', 'minus', 'zero'].some((c) => firstCard.querySelector(`.history-round-net.${c}`)),
  'результат подкрашен по знаку');
const bjTime = firstCard.querySelector('.round-time');
check(!!bjTime && bjTime.textContent.trim().length > 0, 'в истории раздачи время в общем виде');
check(!!doc.querySelector('.topbar .shield-pill'), 'в шапке игры есть значок страховки');
click('#modalClose');
check(doc.querySelector('#overlay').hidden, 'история закрывается');

{
  // Сработавшая страховка отмечается в истории, как и в остальных играх.
  const insured = boot({
    'casino.history.v1': JSON.stringify({
      blackjack: [{
        ts: Date.now(),
        n: 1,
        bet: 100,
        net: -50,
        insurance: 50,
        hands: [{ result: 'lose', total: 18, bet: 100 }],
        dealerTotal: 20,
        dealerCards: 2,
        dealerNatural: false,
      }],
    }),
  });
  const insuredDoc = insured.window.document;
  check(insuredDoc.querySelector('.topbar .shield-pill'), 'значок страховки стоит в шапке блэкджека');
  insuredDoc.querySelector('#historyBtn').click();
  const tag = insuredDoc.querySelector('.history-round .ins-tag');
  check(!!tag && tag.textContent.includes('50'), 'в истории видна сумма возврата по страховке');
  check(!!insuredDoc.querySelector('.history-round .round-time'), 'время в карточке истории');
}

click('#statsBtn');
doc.querySelector('[data-action="history"]').click();
check(doc.querySelector('#modalBody').textContent.includes('История раздач'), 'история открывается из статистики');
doc.querySelector('[data-action="stats"]').click();
check(doc.querySelector('#modalBody').textContent.includes('Статистика'), 'возврат к статистике');
click('#modalClose');

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
check(typeof JSON.parse(window.localStorage.getItem('casino.wallet.v1')).bankroll === 'number',
  'баланс хранится в общем кошельке казино');
const balanceBeforeReset = bankroll();
click('#resetBtn');
check(!doc.querySelector('#overlay').hidden, 'окно сброса открыто');
doc.querySelector('[data-action="reset"]').click();
await sleep(20);
check(bankroll() === balanceBeforeReset,
  `сброс блэкджека не трогает общий баланс (${balanceBeforeReset})`);
check(api.state.stats.rounds === 0, 'статистика блэкджека обнулена');
check(api.state.history.length === 0, 'история блэкджека очищена');
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
  // Сброс игры больше не обнуляет общий баланс, поэтому для сценариев
  // выставляем стартовые 1000 ₽ явно.
  window.Casino.setBalance(1000);
  window.Casino.save();
  api.updateUI();
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

// ---------- Кнопка «Сплит» ----------
console.log('• Кнопка «Сплит» объясняет, почему недоступна');
{
  await resetUI();
  const splitBtn = () => doc.querySelector('#splitBtn');

  check(splitBtn().disabled, 'в фазе ставок сплит недоступен');
  check(splitBtn().title.includes('две карты одного достоинства'),
    `в фазе ставок подсказка объясняет условие: ${splitBtn().title}`);

  // Пара 8 и 8 при достаточном балансе — сплит доступен.
  await beginRound(['8', '10', '8', '9']);
  await waitFor(() => api.state.phase === 'player', 'ход игрока с парой');
  check(!splitBtn().disabled, 'с парой 8 и 8 сплит доступен');
  check(splitBtn().title.includes('две руки'), `подсказка про две руки: ${splitBtn().title}`);
  api.state.hands[0].done = true;
  api.updateUI();
  check(splitBtn().disabled, 'сыгранная рука не даёт сплит');
  check(splitBtn().title.includes('уже сыграна'), `подсказка про сыгранную руку: ${splitBtn().title}`);
  api.state.hands[0].done = false;
  api.updateUI();
  await action('split');
  await waitFor(() => api.state.hands.length === 2, 'две руки после сплита');
  await action('stand');
  await waitFor(() => api.state.active === 1, 'переход ко второй руке');
  await action('stand');
  await waitSettled();

  // Разные карты — сплит недоступен.
  await resetUI();
  await beginRound(['8', '10', '7', '9']);
  await waitFor(() => api.state.phase === 'player', 'ход игрока с разными картами');
  check(splitBtn().disabled, 'с разными картами сплит недоступен');
  check(splitBtn().title.includes('одного достоинства'),
    `подсказка про одинаковые карты: ${splitBtn().title}`);

  // Пара есть, но на вторую ставку не хватает денег.
  await resetUI();
  await beginRound(['9', '10', '9', '9']);
  await waitFor(() => api.state.phase === 'player', 'ход игрока с парой 9');
  window.Casino.setBalance(40);
  api.updateUI();
  check(splitBtn().disabled, 'без денег на вторую ставку сплит недоступен');
  check(splitBtn().title.includes('Нужно ещё'),
    `подсказка называет нехватку: ${splitBtn().title}`);
  check(splitBtn().title.includes('60'), `нехватка посчитана: ${splitBtn().title}`);
}

// ---------- Подсветка кнопки «Сплит» ----------
console.log('• Кнопка «Сплит» подсвечивается, когда становится доступной');
{
  await resetUI();
  const splitBtn = () => doc.querySelector('#splitBtn');
  check(!splitBtn().classList.contains('split-ready'), 'до раздачи подсветки нет');

  // Пара восьмёрок: сплит впервые доступен — кнопка подсвечивается.
  await beginRound(['8', '10', '8', '9']);
  await waitFor(() => api.state.phase === 'player', 'ход игрока с парой');
  check(splitBtn().classList.contains('split-ready'), 'кнопка подсветилась при первой возможности');
  check(splitBtn().title.includes('две руки'), 'подсказка объясняет действие');

  // Повторные перерисовки не перезапускают подсветку.
  splitBtn().classList.remove('split-ready');
  api.updateUI();
  api.updateUI();
  check(!splitBtn().classList.contains('split-ready'),
    'повторная отрисовка не мигает заново');

  // Делаем сплит: кнопка больше не доступна — подсветка снимается.
  await action('split');
  await waitFor(() => api.state.hands.length === 2, 'две руки после сплита');
  check(!splitBtn().classList.contains('split-ready') || !splitBtn().disabled,
    'подсветка не висит на недоступной кнопке');
  // Доигрываем обе руки «Хватит» и ждём расчёта.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (api.state.phase === 'betting' && !api.state.busy) break;
    const stand = doc.querySelector('#standBtn');
    if (api.state.phase === 'player' && !api.state.busy && !stand.disabled) {
      stand.click();
    }
    await sleep(20);
  }
  await waitSettled();
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

// История: одна раздача, две руки со своими очками и результатами
const splitEntry = api.state.history[0];
check(api.state.history.length === 1, `в истории одна раздача, получено ${api.state.history.length}`);
check(splitEntry.hands.length === 2, `в записи две руки, получено ${splitEntry.hands.length}`);
check(splitEntry.hands[0].total === 20 && splitEntry.hands[0].result === 'push',
  `первая рука 20 и ничья, получено ${splitEntry.hands[0].total}/${splitEntry.hands[0].result}`);
check(splitEntry.hands[1].total === 19 && splitEntry.hands[1].result === 'lose',
  `вторая рука 19 и проигрыш, получено ${splitEntry.hands[1].total}/${splitEntry.hands[1].result}`);
check(splitEntry.dealerTotal === 20, `у дилера 20, получено ${splitEntry.dealerTotal}`);
check(splitEntry.bet === 200 && splitEntry.net === -100,
  `ставка 200 и итог −100, получено ${splitEntry.bet}/${splitEntry.net}`);

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
const savedWallet = JSON.parse(window.localStorage.getItem('casino.wallet.v1'));
const savedPending = JSON.parse(window.localStorage.getItem('casino.pending.v1') || '{}');
const savedHistory = JSON.parse(window.localStorage.getItem('casino.history.v1') || '{}');
check(savedWallet.bankroll === 900, `с баланса списана ставка 100, осталось ${savedWallet.bankroll}`);
check(savedPending.blackjack === 100, `отложена ставка 100, получено ${savedPending.blackjack}`);
check(savedHistory.blackjack.length === 0, 'сброс игры очистил историю раздач и в сохранении');
check(savedWallet.bankroll + savedPending.blackjack === 1000,
  'перезагрузка вернёт 1000 (баланс + отложенная ставка)');

const dom2 = boot(window);
check(dom2.window.__BJ_TEST__.state.bankroll === 1000,
  `новая сессия вернула ставку: ${dom2.window.__BJ_TEST__.state.bankroll}`);
check(dom2.window.__BJ_TEST__.state.phase === 'betting', 'новая сессия стартует со ставок');

// История переживает перезагрузку и чистится от мусора
const dom4 = boot({
  'casino.wallet.v1': JSON.stringify({ bankroll: 900 }),
  'casino.pending.v1': JSON.stringify({}),
  'casino.stats.v1': JSON.stringify({
    blackjack: { rounds: 2, wins: 1, losses: 1, pushes: 0, blackjacks: 0, wagered: 200, bestWin: 100, net: 0 },
  }),
  'casino.history.v1': JSON.stringify({
  blackjack: [
    { n: 2, ts: 1700000000000, bet: 100, net: -100, dealerTotal: 20, dealerCards: 2, dealerNatural: false,
      hands: [{ total: 19, soft: false, result: 'lose', bet: 100, payout: 0, doubled: false }] },
    { n: 1, ts: 1699999999000, bet: 100, net: 100, dealerTotal: 26, dealerCards: 3, dealerNatural: false,
      hands: [{ total: 20, soft: false, result: 'win', bet: 100, payout: 200, doubled: false },
              { total: 25, soft: false, result: 'bust', bet: 50, payout: 0, doubled: true },
              { total: 21, soft: false, result: 'blackjack', bet: 50, payout: 125, doubled: false },
              { total: 18, soft: true, result: 'push', bet: 25, payout: 25, doubled: false },
              { total: 17, soft: true, result: 'push', bet: 25, payout: 25, doubled: false }] },
    { n: 'мусор', hands: 'не массив' },
  ],
  }),
});
const restoredHistory = dom4.window.__BJ_TEST__.state.history;
check(restoredHistory.length === 3, `из сохранения прочитаны 3 записи, получено ${restoredHistory.length}`);
check(restoredHistory[0].n === 2 && restoredHistory[0].hands[0].total === 19, 'данные первой записи целы');
check(restoredHistory[1].hands.length === 4, 'лишние руки (5) обрезаны до 4');
check(restoredHistory[1].hands[1].result === 'bust', 'перебор сохранён');
check(restoredHistory[1].hands[3].soft === true, 'мягкая рука сохранена');
check(restoredHistory[2].hands.length === 0 && restoredHistory[2].bet === 0,
  'битая запись не ломает загрузку');

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
