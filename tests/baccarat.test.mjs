import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/baccarat/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="baccarat.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/baccarat/baccarat.js`, 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

const CASINO_KEYS = ['casino.wallet.v1', 'casino.history.v1', 'casino.stats.v1', 'casino.pending.v1',
  'casino.sound.v1', 'casino.progress.v1', 'casino.topup.v1'];

function boot(seed) {
  const dom = new JSDOM(html, { url: 'https://example.org/games/baccarat/?preview=1', pretendToBeVisual: true, runScripts: 'outside-only' });
  const store = dom.window.localStorage;
  if (seed && seed.localStorage) {
    CASINO_KEYS.forEach((key) => {
      const value = seed.localStorage.getItem(key);
      if (value !== null) store.setItem(key, value);
    });
  } else if (seed) {
    Object.entries(seed).forEach(([key, value]) => store.setItem(key, value));
  }
  dom.window.eval(rawCasino);
  dom.window.eval(rawGame);
  return { dom, window: dom.window, doc: dom.window.document, api: dom.window.__BAC_TEST__ };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { window, doc, api } = boot();
api.setTiming({ deal: 1, settle: 1 });

const balance = () => window.Casino.getBalance();
const selectChip = (targetDoc, value = 100) => {
  const chip = targetDoc.querySelector(`[data-chip="${value}"]`);
  if (!chip) throw new Error(`Нет фишки ${value}`);
  chip.click();
};
selectChip(doc, 100);

const spot = (key) => doc.querySelector(`[data-bet="${key}"]`);

// ---------- Стоимость карт ----------
console.log('• Стоимость карт');
check(api.cardValue('A') === 1, 'туз — 1');
check(api.cardValue('9') === 9, 'девятка — 9');
check(api.cardValue('10') === 0 && api.cardValue('J') === 0, 'десятка и валет — 0');
check(api.cardValue('Q') === 0 && api.cardValue('K') === 0, 'дама и король — 0');
{
  const cards = (...ranks) => ranks.map((rank) => ({ rank }));
  check(api.handTotal(cards('9', '7')) === 6, '9 + 7 = 16 → 6');
  check(api.handTotal(cards('K', 'A')) === 1, 'король + туз → 1');
  check(api.handTotal(cards('4', '6', '5')) === 5, '4 + 6 + 5 = 15 → 5');
  check(api.handTotal(cards('10', '10')) === 0, 'две картинки → 0');
}

// ---------- Правила третьей карты ----------
console.log('• Правила третьей карты');
{
  // Игрок остановился: банкир тянет на 0–5.
  check(api.bankerDraws(0, null) && api.bankerDraws(5, null), 'без третьей карты игрока банкир тянет на 0–5');
  check(!api.bankerDraws(6, null) && !api.bankerDraws(7, null), 'на 6–7 банкир стоит');

  // Банкир 3: тянет всегда, кроме третьей карты 8.
  check(api.bankerDraws(3, 7) && api.bankerDraws(3, 0), 'банкир 3 тянет почти всегда');
  check(!api.bankerDraws(3, 8), 'банкир 3 стоит при восьмёрке игрока');

  // Банкир 4: тянет на 2–7.
  check(!api.bankerDraws(4, 0) && !api.bankerDraws(4, 1), 'банкир 4 стоит на 0–1');
  check(api.bankerDraws(4, 2) && api.bankerDraws(4, 7), 'банкир 4 тянет на 2–7');
  check(!api.bankerDraws(4, 8) && !api.bankerDraws(4, 9), 'банкир 4 стоит на 8–9');

  // Банкир 5: тянет на 4–7.
  check(!api.bankerDraws(5, 3), 'банкир 5 стоит на 3');
  check(api.bankerDraws(5, 4) && api.bankerDraws(5, 7), 'банкир 5 тянет на 4–7');
  check(!api.bankerDraws(5, 8), 'банкир 5 стоит на 8');

  // Банкир 6: тянет только на 6–7.
  check(!api.bankerDraws(6, 5), 'банкир 6 стоит на 5');
  check(api.bankerDraws(6, 6) && api.bankerDraws(6, 7), 'банкир 6 тянет на 6–7');

  // Банкир 7 и больше — всегда стоит.
  check(!api.bankerDraws(7, 6) && !api.bankerDraws(7, 0), 'банкир 7 всегда стоит');
  check(!api.bankerDraws(9, 6), 'банкир 9 стоит');
  check(api.bankerDraws(0, 9) && api.bankerDraws(1, 9) && api.bankerDraws(2, 9), 'банкир 0–2 тянет при любой третьей');
}

// ---------- Выплаты ----------
console.log('• Выплаты');
check(api.payoutFor('player', 100, 'player') === 200, 'игрок платит 1:1');
check(api.payoutFor('banker', 100, 'banker') === 195, 'банкир платит 0,95:1 (комиссия 5%)');
check(api.payoutFor('banker', 25, 'banker') === 49, 'с 25 ₽ банкир отдаёт 49 ₽ (округление)');
check(api.payoutFor('tie', 100, 'tie') === 900, 'ничья платит 8:1');
check(api.payoutFor('player', 100, 'banker') === 0, 'проигравшая ставка не платит');
check(api.payoutFor('tie', 100, 'player') === 0, 'ставка на ничью проигрывает при победе игрока');
check(api.payoutFor('player', 100, 'tie') === 100, 'при ничьей ставка на игрока возвращается');
check(api.payoutFor('banker', 100, 'tie') === 100, 'при ничьей ставка на банкира возвращается');

{
  const { payout, wins } = api.settleBets({ player: 100, tie: 50 }, 'tie');
  check(payout === 100 + 450, `при ничьей возврат игрока и выплата ничьей, получено ${payout}`);
  check(wins.length === 1 && wins[0] === 'tie', 'выиграла только ставка на ничью');

  const both = api.settleBets({ player: 100, banker: 100 }, 'player');
  check(both.payout === 200, `при победе игрока банкир не платит, получено ${both.payout}`);
  check(both.wins.length === 1 && both.wins[0] === 'player', 'выиграла ставка на игрока');
}

// ---------- Поле и ставки ----------
console.log('• Поле ставок');
check(doc.querySelectorAll('[data-bet]').length === 3, 'на поле три ставки');
check(!!spot('player') && !!spot('tie') && !!spot('banker'), 'игрок, ничья и банкир');
check(balance() === 1000, `стартовый баланс 1000, получено ${balance()}`);
check(doc.querySelector('#dealBtn').disabled, '«Раздать» заблокирована без ставки');

spot('player').click();
check(balance() === 900, `после фишки 100 баланс 900, получено ${balance()}`);
check(api.totalBet() === 100, `ставка 100, получено ${api.totalBet()}`);
check(!spot('player').querySelector('.spot-chip').hidden, 'на поле видна фишка');
check(spot('player').classList.contains('has-bet'), 'поле помечено ставкой');
check(spot('player').querySelector('.spot-chip').textContent === '100', 'на фишке сумма');
check(!doc.querySelector('#dealBtn').disabled, '«Раздать» активна');

spot('banker').click();
check(api.totalBet() === 200 && balance() === 800, 'вторая ставка добавилась');
{
  // Подсказка о «зеркальных» ставках считает оба исхода честно.
  const hint = doc.querySelector('#betHint');
  check(!hint.hidden, 'подсказка о взаимных ставках показана');
  check(hint.textContent.includes('при победе игрока') && hint.textContent.includes('при победе банкира'),
    'в подсказке есть оба исхода');
  check(hint.textContent.includes('−5'), `комиссия банкира учтена в подсказке: ${hint.textContent}`);
}
api.undoBet();
check(api.totalBet() === 100 && balance() === 900, 'отмена возвращает последнюю фишку');

spot('tie').click();
check(api.totalBet() === 200, 'ставка на ничью добавлена');
api.clearBets();
check(api.totalBet() === 0 && balance() === 1000, 'очистка возвращает все фишки');
check(JSON.parse(window.localStorage.getItem('casino.pending.v1')).baccarat === undefined,
  'после очистки долг по ставке снят');

// ---------- Победа игрока ----------
console.log('• Победа игрока: 9 и 4 у игрока, 3 и 2 у банкира');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  // Игрок: 9 + 4 = 13 → 3, тянет третью (≤5) — короля, снова 3.
  // Банкир: 3 + 2 = 5, третья карта игрока 0 → по правилу 5 стоит.
  game.api.setShoe(['9', '3', '4', '2', 'K']);
  game.doc.querySelector('[data-bet="player"]').click();
  await game.api.deal();
  await sleep(5);

  const history = game.window.Casino.history('baccarat');
  check(history.length === 1, 'в истории одна раздача');
  check(history[0].playerTotal === 3, `у игрока 3, получено ${history[0].playerTotal}`);
  check(history[0].bankerTotal === 5, `у банкира 5, получено ${history[0].bankerTotal}`);
  check(history[0].playerCards.length === 3, 'игрок добрал третью карту');
  check(history[0].bankerCards.length === 2, 'банкир остался на двух картах');
  check(history[0].result === 'banker', `победил банкир, получено ${history[0].result}`);
  check(game.window.Casino.getBalance() === 900, `ставка проиграла, баланс ${game.window.Casino.getBalance()}`);
  check(game.api.state.player.length === 3 && game.api.state.banker.length === 2,
    'на столе столько же карт, сколько в истории');
}

// ---------- Натуральный банкир ----------
console.log('• Натуральные 9 у банкира: третьих карт нет');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  // игрок 4 + 1 = 5, банкир 4 + 5 = 9 — натуральная девятка, доборов нет.
  game.api.setShoe(['4', '4', '1', '5']);
  game.doc.querySelector('[data-bet="banker"]').click();
  await game.api.deal();
  await sleep(5);
  const entry = game.window.Casino.history('baccarat')[0];
  check(entry.playerTotal === 5 && entry.bankerTotal === 9, `5 против 9, получено ${entry.playerTotal}:${entry.bankerTotal}`);
  check(entry.playerCards.length === 2 && entry.bankerCards.length === 2,
    'натуральная девятка не добирает карты');
  check(entry.result === 'banker', 'банкир выиграл');
  check(game.window.Casino.getBalance() === 1095, `банкир с комиссией, баланс ${game.window.Casino.getBalance()}`);
}

// ---------- Натуральная девятка игрока ----------
console.log('• Натуральная девятка 9 против 8');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  // игрок 4 + 5 = 9, банкир 2 + 6 = 8 — натуральные руки, третьих карт нет.
  game.api.setShoe(['4', '2', '5', '6']);
  game.doc.querySelector('[data-bet="player"]').click();
  await game.api.deal();
  await sleep(5);
  const entry = game.window.Casino.history('baccarat')[0];
  check(entry.playerTotal === 9 && entry.bankerTotal === 8, `9 против 8, получено ${entry.playerTotal}:${entry.bankerTotal}`);
  check(entry.playerCards.length === 2 && entry.bankerCards.length === 2,
    'натуральные руки не добирают карты');
  check(game.window.Casino.getBalance() === 1100, `игрок платит 1:1, баланс ${game.window.Casino.getBalance()}`);
}

// ---------- Ничья ----------
console.log('• Ничья: ставка возвращается');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  // игрок 3 + 4 = 7, банкир 2 + 5 = 7 — оба стоят.
  game.api.setShoe(['3', '2', '4', '5']);
  game.doc.querySelector('[data-bet="player"]').click();
  await game.api.deal();
  await sleep(5);
  const entry = game.window.Casino.history('baccarat')[0];
  check(entry.result === 'tie', 'ничья');
  check(entry.playerTotal === 7 && entry.bankerTotal === 7, '7 и 7');
  check(game.window.Casino.getBalance() === 1000, `ставка вернулась, баланс ${game.window.Casino.getBalance()}`);
  check(entry.net === 0, 'итог раздачи нулевой');
  check(game.window.Casino.stats('baccarat').pushes === 1, 'ничья учтена в статистике');
}

// ---------- Ничья со ставкой на ничью ----------
console.log('• Ничья 8:1');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  game.api.setShoe(['3', '2', '4', '5']);
  game.doc.querySelector('[data-bet="tie"]').click();
  await game.api.deal();
  await sleep(5);
  check(game.window.Casino.getBalance() === 900 + 900,
    `ничья платит 8:1, баланс ${game.window.Casino.getBalance()}`);
  check(game.window.Casino.stats('baccarat').wins === 1, 'победа засчитана');
  check(game.window.Casino.stats('baccarat').ties === 1, 'ничья засчитана в раздачах');
}

// ---------- Комиссия банкира ----------
console.log('• Комиссия банкира');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  // игрок 2 + 3 = 5, банкир 3 + 4 = 7 — банкир выигрывает.
  game.api.setShoe(['2', '3', '3', '4']);
  game.doc.querySelector('[data-bet="banker"]').click();
  await game.api.deal();
  await sleep(5);
  const entry = game.window.Casino.history('baccarat')[0];
  check(entry.bankerTotal === 7 && entry.playerTotal > entry.bankerTotal === false, 'банкир 7');
  check(entry.result === 'banker', 'банкир выиграл');
  check(game.window.Casino.getBalance() === 900 + 195,
    `выплата 195 ₽ с комиссией, баланс ${game.window.Casino.getBalance()}`);
}

// ---------- Третья карта банкира ----------
console.log('• Банкир добирает третью карту');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  // Игрок: 2 + 3 = 5 → тянет 6 → 1. Банкир: 4 + 3 = 7 (стоит).
  game.api.setShoe(['2', '4', '3', '3', '6']);
  game.doc.querySelector('[data-bet="player"]').click();
  await game.api.deal();
  await sleep(5);
  const entry = game.window.Casino.history('baccarat')[0];
  check(entry.playerCards.length === 3, 'игрок добрал третью карту');
  check(entry.bankerCards.length === 2, 'банкир на 7 стоит');
  check(entry.playerTotal === 1 && entry.bankerTotal === 7, `1 против 7, получено ${entry.playerTotal}:${entry.bankerTotal}`);
}
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  // Игрок: 2 + 3 = 5 → тянет 6 → 1. Банкир: 2 + 1 = 3 → по правилу 3 тянет (третья карта игрока не 8).
  game.api.setShoe(['2', '2', '3', '1', '6', '9']);
  game.doc.querySelector('[data-bet="banker"]').click();
  await game.api.deal();
  await sleep(5);
  const entry = game.window.Casino.history('baccarat')[0];
  check(entry.playerCards.length === 3, 'игрок добрал');
  check(entry.bankerCards.length === 3, 'банкир 3 тоже добрал');
  check(entry.bankerTotal === 2, `банкир 3 + 9 = 12 → 2, получено ${entry.bankerTotal}`);
}

// ---------- Лимит стола ----------
console.log('• Лимит стола');
{
  const game = boot({ 'casino.wallet.v1': JSON.stringify({ bankroll: 10000 }) });
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 500);
  const limit = game.window.Casino.maxBet();
  for (let i = 0; i < 20; i++) game.doc.querySelector('[data-bet="banker"]').click();
  check(game.api.totalBet() === limit, `лимит ${limit}, на столе ${game.api.totalBet()}`);
  game.doc.querySelector('[data-bet="player"]').click();
  check(game.api.totalBet() === limit, 'сверх лимита ставка не принимается');
  check(game.window.Casino.getBalance() === 10000 - limit, 'списано ровно по ставкам');
  const chipNode = game.doc.querySelector('[data-bet="banker"] .spot-chip');
  check(chipNode.textContent === '2,5k', `крупная сумма на фишке сокращена, получено ${chipNode.textContent}`);
  check(chipNode.title.replace(/\s/g, '').includes('2500'), 'полная сумма в title фишки');
}

// ---------- Повтор ставки ----------
console.log('• Повтор ставки');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  game.api.setShoe(['9', '3', '4', '2', '5', '5', '5']);
  game.doc.querySelector('[data-bet="player"]').click();
  await game.api.deal();
  await sleep(5);
  const repeatBtn = game.doc.querySelector('#repeatBtn');
  check(!repeatBtn.hidden, 'кнопка «Повторить» появилась');
  const before = game.window.Casino.getBalance();
  repeatBtn.click();
  check(game.api.totalBet() === 100, `повтор вернул ставку, на столе ${game.api.totalBet()}`);
  check(game.window.Casino.getBalance() === before - 100, 'повтор списал фишки');
}

// ---------- Стол очищается под новую ставку ----------
console.log('• Новый кон забирает прошлые карты');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  game.api.setShoe(['4', '4', '5', '5']);
  game.doc.querySelector('[data-bet="player"]').click();
  await game.api.deal();
  await sleep(5);
  check(game.doc.querySelectorAll('#playerHand .card').length === 2, 'после раздачи на столе карты');
  check(game.doc.querySelector('#playerTotal').textContent === '9', 'итог прошлой раздачи виден');
  game.doc.querySelector('[data-bet="banker"]').click();
  check(game.doc.querySelectorAll('#playerHand .card').length === 0, 'новая ставка убрала карты игрока');
  check(game.doc.querySelectorAll('#playerHand .card-slot').length === 2, 'вместо карт снова места под них');
  check(game.doc.querySelector('#playerTotal').textContent === '', 'итог прошлой раздачи сброшен');
}

// ---------- Незавершённая раздача ----------
console.log('• Незавершённая раздача');
{
  const crashed = boot();
  crashed.window.Casino.setPending('baccarat', 200);
  crashed.window.Casino.save();
  const restored = boot({ localStorage: crashed.window.localStorage });
  check(restored.window.Casino.getBalance() === 1200,
    `зависшая ставка вернулась на баланс, получено ${restored.window.Casino.getBalance()}`);
}

// ---------- Русская раскладка ----------
console.log('• Русская раскладка');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  game.doc.querySelector('[data-bet="player"]').click();
  check(game.api.totalBet() === 100, 'ставка сделана');
  game.doc.dispatchEvent(new game.window.KeyboardEvent('keydown', { key: 'с', code: 'KeyC' }));
  check(game.api.totalBet() === 0, 'C на русской раскладке очищает ставки');
  game.doc.dispatchEvent(new game.window.KeyboardEvent('keydown', { key: 'р', code: 'KeyH' }));
  check(!game.doc.querySelector('#overlay').hidden, 'H на русской раскладке открывает историю');
  game.doc.dispatchEvent(new game.window.KeyboardEvent('keydown', { key: 'Escape' }));
  check(game.doc.querySelector('#overlay').hidden, 'Escape закрывает историю');
}

// ---------- Окна и дорожка ----------
console.log('• Окна и дорожка');
doc.querySelector('#rulesBtn').click();
check(doc.querySelector('#modalBody').textContent.includes('Правила баккары'), 'правила открываются');
check(doc.querySelector('#modalBody').textContent.includes('0,95'), 'в правилах есть комиссия банкира');
doc.querySelector('#modalClose').click();
check(doc.querySelector('#overlay').hidden, 'правила закрываются');

doc.querySelector('#statsBtn').click();
const statsText = doc.querySelector('#modalBody').textContent;
check(statsText.includes('Статистика баккары'), 'статистика открывается');
check(statsText.includes('Побед банкира'), 'в статистике есть победы банкира');
doc.querySelector('#modalClose').click();

{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  game.api.setShoe(['3', '2', '4', '5']);       // ничья
  game.doc.querySelector('[data-bet="player"]').click();
  await game.api.deal();
  await sleep(5);
  game.api.setShoe(['2', '3', '3', '4']);       // победа банкира
  game.doc.querySelector('[data-bet="banker"]').click();
  await game.api.deal();
  await sleep(5);

  const cells = [...game.doc.querySelectorAll('#bead .bead-cell')];
  check(cells.length === 2, `в дорожке два исхода, получено ${cells.length}`);
  check(cells[0].classList.contains('banker'), 'свежий исход — банкир');
  check(cells[1].classList.contains('tie'), 'предыдущий — ничья');
  check(cells[0].textContent === 'Б', 'на плитке буква Б');

  game.doc.querySelector('#historyBtn').click();
  check(game.doc.querySelectorAll('.rounds-history-full .round-row').length === 2,
    'в окне истории обе раздачи');
  game.doc.querySelector('#modalClose').click();
}

// ---------- Сброс ----------
console.log('• Сброс');
{
  const game = boot();
  game.api.setTiming({ deal: 1, settle: 1 });
  selectChip(game.doc, 100);
  game.api.setShoe(['4', '2', '5', '6']);
  game.doc.querySelector('[data-bet="player"]').click();
  await game.api.deal();
  await sleep(5);
  game.doc.querySelector('#statsBtn').click();
  game.doc.querySelector('[data-action="reset"]').click();
  check(game.window.Casino.stats('baccarat').rounds === 0, 'статистика баккары обнулена');
  check(game.window.Casino.history('baccarat').length === 0, 'история баккары очищена');
  check(game.window.Casino.stats('roulette').spins === 0, 'чужая статистика не тронута');
  check(game.doc.querySelectorAll('#bead .bead-cell').length === 0, 'дорожка очищена');
}

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
