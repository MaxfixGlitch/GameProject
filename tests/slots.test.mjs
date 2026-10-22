import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/slots/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="slots.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/slots/slots.js`, 'utf8');

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
    url: 'https://example.org/games/slots/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const store = dom.window.localStorage;
  if (seed) {
    CASINO_KEYS.forEach((key) => {
      const value = seed.getItem(key);
      if (value !== null) store.setItem(key, value);
    });
  }
  dom.window.eval(rawCasino);
  dom.window.eval(rawGame);
  return { dom, window: dom.window, doc: dom.window.document, api: dom.window.__SLOTS_TEST__ };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const balanceOf = (win) => win.Casino.getBalance();

const { window: win, doc, api } = boot();
api.setTiming({ reel: 1, gap: 0, settle: 1 });

// ---------- Набор символов ----------
console.log('• Символы и линии');
check(Object.keys(api.SYMBOLS).length === 7, `семь символов, получено ${Object.keys(api.SYMBOLS).length}`);
check(api.STRIP.length === 40, `в ленте 40 ячеек, получено ${api.STRIP.length}`);
check(api.LINES.length === 5, 'пять линий');
check(api.SYMBOLS.seven.pay === 140 && api.SYMBOLS.wild.pay === 280, 'семёрка ×140, фишка ×280');
check(api.SYMBOLS.cherry.pay === 6 && api.SYMBOLS.diamond.pay === 40, 'вишня ×6, алмаз ×40');

const counts = {};
api.STRIP.forEach((sym) => { counts[sym] = (counts[sym] || 0) + 1; });
check(counts.cherry === 10 && counts.lemon === 9, `частоты вишни и лимона: ${counts.cherry}/${counts.lemon}`);
check(counts.wild === 2 && counts.seven === 2, 'по две фишки и семёрки в ленте');
check(Object.values(counts).reduce((a, b) => a + b, 0) === 40, 'лента ровно 40 ячеек');

// ---------- Правила линий ----------
console.log('• Правила линий');
check(api.lineResult(['cherry', 'cherry', 'cherry']).mult === 6, 'три вишни платят ×6');
check(api.lineResult(['seven', 'seven', 'seven']).mult === 140, 'три семёрки платят ×140');
check(api.lineResult(['wild', 'seven', 'seven']).sym === 'seven', 'фишка заменяет семёрку');
check(api.lineResult(['cherry', 'wild', 'wild']).mult === 6, 'две фишки и вишня платят по вишне');
check(api.lineResult(['wild', 'wild', 'wild']).sym === 'wild', 'три фишки — свой символ');
check(api.lineResult(['wild', 'wild', 'wild']).mult === 280, 'три фишки платят ×280');
check(api.lineResult(['cherry', 'lemon', 'cherry']) === null, 'разные символы не платят');
check(api.lineResult(['seven', 'seven', 'cherry']) === null, 'две семёрки без третьей не платят');

// ---------- Выплаты сетки ----------
console.log('• Выплаты');
const middles = [
  ['cherry', 'seven', 'lemon'],
  ['star', 'seven', 'bell'],
  ['diamond', 'seven', 'lemon'],
];
const one = api.evaluate(middles, 20);
check(one.wins.length === 1, `выигрывает одна линия, получено ${one.wins.length}`);
check(one.wins[0].line.id === 1, 'выиграла средняя линия');
check(one.payout === 140 * 20, `выплата 2 800, получено ${one.payout}`);

const allSevens = [['seven', 'seven', 'seven'], ['seven', 'seven', 'seven'], ['seven', 'seven', 'seven']];
const five = api.evaluate(allSevens, 50);
check(five.wins.length === 5, `все пять линий, получено ${five.wins.length}`);
check(five.payout === 5 * 140 * 50, `выплата 35 000, получено ${five.payout}`);
check(five.wins.every((w) => w.cells.length === 3), 'у каждой линии три клетки');

// ---------- Возврат ----------
console.log('• Возврат игроку');
{
  let payout = 0;
  for (let a = 0; a < 40; a++) {
    for (let b = 0; b < 40; b++) {
      for (let c = 0; c < 40; c++) {
        payout += api.evaluate(api.gridFromStops([a, b, c]), 1).payout;
      }
    }
  }
  const rtp = payout / (64000 * 5);
  check(Math.abs(rtp - 0.9421) < 0.001, `возврат 94,21%, получено ${(rtp * 100).toFixed(2)}%`);
}

// ---------- Спин с выигрышем ----------
console.log('• Спин с выигрышем');
api.setBet(100);
check(api.state.bet === 100, 'ставка 100');
check(doc.querySelector('#betTotal').textContent.replace(/\u00a0/g, ' ') === '100 ₽', 'ставка на панели');
check(balanceOf(win) === 1000, 'баланс до спина');

const spin = await api.spin(middles);
check(spin.payout === 140 * 20, `выплата за среднюю линию: ${spin.payout}`);
check(spin.net === 2800 - 100, `чистыми 2 700, получено ${spin.net}`);
check(balanceOf(win) === 1000 - 100 + 2800, `баланс после спина: ${balanceOf(win)}`);
check(win.Casino.stats('slots').spins === 1, 'спин записан в статистику');
check(win.Casino.stats('slots').wins === 1, 'победа записана');
check(win.Casino.stats('slots').wagered === 100, 'оборот ставок 100');
check(win.Casino.stats('slots').net === 2700, 'итог игры 2 700');
check(win.Casino.stats('slots').bestWin === 2700, 'лучший спин 2 700');
check(win.Casino.stats('slots').lines === 1, 'одна выигрышная линия');
check(win.Casino.history('slots').length === 1, 'спин попал в историю');
check(win.Casino.history('slots')[0].grid.length === 3, 'в истории лежит сетка');
check(win.Casino.history('slots')[0].summary.includes('Линия 1'), `описание спина: ${win.Casino.history('slots')[0].summary}`);
const badgeText = doc.querySelector('#winBadge').textContent.replace(/\u00a0/g, ' ');
check(badgeText.includes('2 800'), `бейдж выигрыша: ${badgeText}`);
check(!doc.querySelector('#winBadge').hidden, 'бейдж выигрыша виден');
check(doc.querySelectorAll('.line-chip.active').length === 1, 'подсвечена одна линия');
check(doc.querySelectorAll('.reel-cell.win').length === 3, 'подсвечены три клетки');
check(doc.querySelector('#message').className.includes('win'), 'сообщение зелёное');
check(doc.querySelectorAll('#spinsList .spin-card').length === 1, 'спин виден в истории на странице');
check(win.Casino.getPending('slots') === 0, 'незавершённая ставка снята');

// ---------- Проигрыш ----------
console.log('• Проигрыш');
const loseGrid = [
  ['cherry', 'lemon', 'star'],
  ['bell', 'diamond', 'seven'],
  ['lemon', 'star', 'cherry'],
];
const balanceBefore = balanceOf(win);
const bad = await api.spin(loseGrid);
check(bad.wins.length === 0 && bad.payout === 0, 'совпадений нет');
check(bad.net === -100, `чистыми −100, получено ${bad.net}`);
check(balanceOf(win) === balanceBefore - 100, 'ставка списана');
check(win.Casino.stats('slots').losses === 1, 'поражение записано');
check(win.Casino.history('slots').length === 2, 'второй спин в истории');
check(win.Casino.history('slots')[0].summary === 'Совпадений нет', 'описание проигрыша');
check(doc.querySelector('#winBadge').hidden, 'бейдж выигрыша спрятан');
check(doc.querySelectorAll('.line-chip.active').length === 0, 'линии не подсвечены');
check(doc.querySelector('#message').className.includes('lose'), 'сообщение красное');

// ---------- Страховка ----------
console.log('• Страховка');
{
  const insured = boot();
  insured.window.Casino.setBalance(1000);
  insured.window.localStorage.setItem('casino.progress.v1', JSON.stringify({ shields: 2, claimed: [], net: 0 }));
  insured.window.Casino.load();
  check(insured.window.Casino.shields() === 2, 'две страховки на месте');
  insured.api.setBet(100);
  const res = await insured.api.spin(loseGrid);
  check(res.insurance === 50, `страховка вернула 50, получено ${res.insurance}`);
  check(res.net === -50, `чистыми −50, получено ${res.net}`);
  check(insured.window.Casino.shields() === 1, 'страховка сгорела');
  check(balanceOf(insured.window) === 950, `баланс после страховки: ${balanceOf(insured.window)}`);
}

// ---------- Мало денег ----------
console.log('• Мало денег');
win.Casino.setBalance(10);
api.setBet(100);
api.updateUI();
check(doc.querySelector('#betHint').hidden === false, 'подсказка про нехватку денег');
check(doc.querySelector('#spinBtn').disabled, 'кнопка спина заблокирована');
const blocked = await api.spin(middles);
check(blocked === null, 'спин без денег не начинается');
check(balanceOf(win) === 10, 'баланс не ушёл в минус');

// ---------- Ставки ----------
console.log('• Ставки');
win.Casino.setBalance(5000);
api.setBet(250);
check(api.state.bet === 250, 'ставка 250');
check(doc.querySelector('[data-chip="250"]').classList.contains('on'), 'фишка 250 подсвечена');
api.setBet(7);
check(api.state.bet === 25, `ставка не ниже 25, получено ${api.state.bet}`);
api.setBet(99999);
check(api.state.bet === 2500, `ставка не выше 2 500, получено ${api.state.bet}`);
doc.querySelector('[data-chip="500"]').click();
check(api.state.bet === 500, 'клик по фишке меняет ставку');
doc.querySelector('#maxBetBtn').click();
check(api.state.bet === 2500, `«Максимум» ставит 2 500, получено ${api.state.bet}`);
win.Casino.setBalance(320);
doc.querySelector('#maxBetBtn').click();
check(api.state.bet === 250, `«Максимум» при 320 ₽ — фишка 250, получено ${api.state.bet}`);
api.setBet(100);

// ---------- Сброс ----------
console.log('• Сброс');
doc.querySelector('#statsBtn').click();
check(!doc.querySelector('#overlay').hidden, 'статистика открывается');
check(doc.querySelector('.modal-body').textContent.includes('Фактический возврат'), 'в статистике виден фактический возврат');
doc.querySelector('[data-action="reset"]').click();
check(win.Casino.stats('slots').spins === 0, 'статистика обнулена');
check(win.Casino.history('slots').length === 0, 'история очищена');
check(doc.querySelectorAll('#spinsList .spin-card').length === 0, 'история на странице пуста');
check(doc.querySelector('#overlay').hidden, 'окно закрылось');

// ---------- Клавиатура ----------
console.log('• Клавиатура');
{
  const kbd = boot();
  kbd.api.setTiming({ reel: 1, gap: 0, settle: 1 });
  kbd.window.Casino.setBalance(1000);
  kbd.api.setBet(100);
  kbd.doc.dispatchEvent(new kbd.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
  await sleep(30);
  check(kbd.window.Casino.stats('slots').spins === 1, 'пробел делает спин');
  check(kbd.window.Casino.stats('slots').wagered === 100, 'ставка списана');
}

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
