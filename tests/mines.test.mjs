import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/mines/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="mines.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/mines/mines.js`, 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

function boot(seed) {
  const dom = new JSDOM(html, {
    url: 'https://example.org/games/mines/?preview=1',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  if (seed) {
    Object.entries(seed).forEach(([key, value]) => dom.window.localStorage.setItem(key, value));
  }
  dom.window.eval(rawCasino);
  dom.window.eval(rawGame);
  return { dom, window: dom.window, doc: dom.window.document, api: dom.window.__MINES_TEST__ };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const balanceOf = (win) => win.Casino.getBalance();

const { window: win, doc, api } = boot();

// ---------- Математика ----------
console.log('• Математика');
check(api.SIZE === 5 && api.CELLS === 25, 'поле 5×5');
check(api.MINES_OPTIONS.join(',') === '2,3,5', `варианты мин: 2, 3, 5, получено ${api.MINES_OPTIONS}`);
check(Math.abs(api.RTP - 0.945) < 1e-12, 'целевой возврат 94,5%');
check(api.comb(25, 0) === 1 && api.comb(25, 1) === 25, 'биномиальные коэффициенты');
check(api.comb(25, 5) === 53130, `C(25,5) = 53 130, получено ${api.comb(25, 5)}`);
check(api.maxPicks(3) === 22, 'при трёх минах безопасных клеток 22');

for (const mines of api.MINES_OPTIONS) {
  let prev = 0;
  for (let k = 1; k <= api.maxPicks(mines); k += 1) {
    const fair = api.fairMult(mines, k);
    const mult = api.multFor(mines, k);
    const chance = 1 / fair;
    check(mult <= api.RTP * fair + 1e-9, `${mines} мин, ${k} клеток: множитель не выше честного × 0,945`);
    check(api.RTP * fair - mult < 0.01, `${mines} мин, ${k} клеток: округление не больше копейки`);
    check(mult > prev, `${mines} мин: множитель растёт на шаге ${k}`);
    check(chance > 0 && chance <= 1, `${mines} мин, ${k} клеток: вероятность в пределах 0..1`);
    prev = mult;
  }
  check(api.multFor(mines, 0) === 1, `${mines} мин: до первой клетки множитель ×1`);
}

// Точные значения, на которые опираются правила и тесты.
check(api.multFor(2, 1) === 1.02, `2 мины: первая клетка ×1,02, получено ${api.multFor(2, 1)}`);
check(api.multFor(3, 1) === 1.07, `3 мины: первая клетка ×1,07, получено ${api.multFor(3, 1)}`);
check(api.multFor(3, 3) === 1.41, `3 мины: третья клетка ×1,41, получено ${api.multFor(3, 3)}`);
check(api.multFor(5, 5) === 3.23, `5 мин: пять клеток ×3,23, получено ${api.multFor(5, 5)}`);
check(api.multFor(3, 22) === 2173.5, `3 мины: всё поле ×2173,5, получено ${api.multFor(3, 22)}`);

// ---------- Поле и разметка ----------
console.log('• Поле');
const cells = [...doc.querySelectorAll('#minesBoard .cell')];
check(cells.length === 25, `25 клеток, получено ${cells.length}`);
check(doc.querySelectorAll('#mineOptions [data-mines]').length === 3, 'три варианта мин');
check(doc.querySelector('[data-mines="3"]').classList.contains('on'), 'по умолчанию три мины');
check(doc.querySelector('#nextMult').textContent.includes('×1,07'), 'следующая клетка ×1,07');
check(doc.querySelector('#playBtn').textContent.includes('Начать'), 'кнопка запускает заход');

api.setMines(5);
check(api.state.mines === 5, 'мин можно переключить на 5');
check(doc.querySelector('[data-mines="5"]').classList.contains('on'), 'пятёрка подсвечена');
check(doc.querySelector('#nextMult').textContent.includes('×1,18'), 'для пяти мин первый шаг ×1,18');
api.setMines(3);

// ---------- Удачный заход ----------
console.log('• Заход');
api.setBet(100);
const opened = api.start([0, 1, 2]);
check(!!opened && opened.mines === 3, 'заход начался с тремя минами');
check(balanceOf(win) === 900, `ставка списана, баланс 900, получено ${balanceOf(win)}`);
check(win.Casino.getPending('mines') === 100, 'ставка висит в незавершённом заходе');
check(opened.layout.length === 3 && new Set(opened.layout).size === 3, 'мины расставлены без повторов');
check(api.state.phase === 'playing', 'идёт заход');
check(doc.querySelector('#playBtn').textContent.includes('Забрать 100'), `кнопка предлагает забрать 100: ${doc.querySelector('#playBtn').textContent}`);

const safe1 = api.pick(10);
check(safe1 && safe1.picks === 1, 'первая клетка открыта');
check(doc.querySelector('[data-cell="10"]').classList.contains('safe'), 'клетка отмечена как безопасная');
check(api.state.mult === 1.07, `множитель ×1,07, получено ${api.state.mult}`);
check(doc.querySelector('#currentMult').textContent.includes('×1,07'), 'множитель на экране');
check(doc.querySelector('#playBtn').textContent.includes('Забрать 107'), `кнопка показывает 107: ${doc.querySelector('#playBtn').textContent}`);

api.pick(11);
api.pick(12);
check(api.state.picks === 3, 'три клетки открыты');
check(doc.querySelector('#cashoutValue').textContent.includes('141'), `забрать можно 141, получено ${doc.querySelector('#cashoutValue').textContent}`);

check(api.cashOut().payout === 141, 'выплата 141');
check(balanceOf(win) === 1041, `баланс 1 041, получено ${balanceOf(win)}`);
check(win.Casino.stats('mines').rounds === 1, 'заход записан');
check(win.Casino.stats('mines').wins === 1, 'победа записана');
check(win.Casino.stats('mines').topMult === 141, 'лучший множитель хранится в сотых: 141');
check(win.Casino.stats('mines').bestWin === 41, 'лучший заход 41');
check(win.Casino.stats('mines').net === 41, 'итог 41');
check(win.Casino.getPending('mines') === 0, 'ставка больше не висит');
check(win.Casino.history('mines').length === 1, 'заход в истории');
check(win.Casino.history('mines')[0].picks === 3, 'в истории три клетки');
check(win.Casino.history('mines')[0].summary.includes('×1,41'), `описание: ${win.Casino.history('mines')[0].summary}`);
check(doc.querySelectorAll('#roundsList .spin-card').length === 1, 'заход виден в истории на странице');
const minesTime = doc.querySelector('#roundsList .spin-card .round-time');
check(!!minesTime && minesTime.textContent.trim().length > 0, 'в истории захода время в общем виде');
check(!!doc.querySelector('.topbar .shield-pill'), 'в шапке игры виден значок страховки');
check(!doc.querySelector('.panel-note'), 'над строкой управления нет дубля описания');
check(api.state.phase === 'idle', 'заход закрыт');
check(doc.querySelectorAll('#minesBoard .cell.mine.open').length === 3, 'после захода видны все три мины');
check(doc.querySelector('#message').className.includes('win'), 'сообщение зелёное');

// ---------- Подрыв ----------
console.log('• Подрыв');
const before = balanceOf(win);
check(api.cashOut() === null, 'забрать без захода нельзя');
api.start([7, 8, 9]);
const boom = api.pick(7);
check(boom.byMine === true, 'мина сработала');
check(boom.payout === 0, 'выплаты нет');
check(boom.net === -100, 'чистыми −100');
check(balanceOf(win) === before - 100, 'ставка потеряна');
check(win.Casino.stats('mines').losses === 1, 'подрыв записан');
check(win.Casino.stats('mines').net === 41 - 100, 'итог игры −59');
check(doc.querySelector('[data-cell="7"]').classList.contains('hit'), 'подорванная клетка отмечена');
check(doc.querySelector('#message').className.includes('lose'), 'сообщение красное');
check(win.Casino.history('mines')[0].mult === 0, 'в истории подрыв без множителя');

// ---------- Пустой забор ----------
console.log('• Без открытых клеток');
api.start([0, 1, 2]);
check(api.cashOut() === null, 'нельзя забрать, не открыв ни одной клетки');
check(doc.querySelector('#message').textContent.includes('хотя бы одну'), 'подсказка про первую клетку');
check(api.state.phase === 'playing', 'заход продолжается');
api.pick(5);
api.cashOut();

// ---------- Всё поле ----------
console.log('• Всё поле');
{
  const full = boot();
  full.window.Casino.setBalance(1000);
  full.api.setBet(100);
  full.api.start([0, 1, 2]);
  for (let cell = 3; cell < 25; cell += 1) full.api.pick(cell);
  const last = full.window.Casino.history('mines')[0];
  check(full.api.state.phase === 'idle', 'поле закрылось автоматически');
  check(last.mult === 2173.5, `множитель ×2173,5, получено ${last.mult}`);
  check(last.payout === 217350, `выплата 217 350, получено ${last.payout}`);
  check(full.window.Casino.getPending('mines') === 0, 'ставка закрыта');
  check(full.window.Casino.stats('mines').wins === 1, 'победа записана');
  check(full.doc.querySelector('#message').textContent.includes('Поле очищено'), 'сообщение про очистку поля');
}

// ---------- Страховка ----------
console.log('• Страховка');
{
  const insured = boot();
  insured.window.Casino.setBalance(1000);
  insured.window.localStorage.setItem('casino.progress.v1', JSON.stringify({ shields: 2, claimed: [], net: 0 }));
  insured.window.Casino.load();
  insured.api.setBet(100);
  insured.api.start([3, 4, 5]);
  const res = insured.api.pick(3);
  check(res.insurance === 50, `страховка вернула 50, получено ${res.insurance}`);
  check(res.net === -50, `чистыми −50, получено ${res.net}`);
  check(insured.window.Casino.shields() === 1, 'страховка сгорела');
  check(balanceOf(insured.window) === 950, `баланс 950, получено ${balanceOf(insured.window)}`);
}

// ---------- Мало денег ----------
console.log('• Мало денег');
win.Casino.setBalance(10);
api.setBet(100);
api.updateUI();
check(!doc.querySelector('#betHint').hidden, 'подсказка про нехватку денег');
check(doc.querySelector('#playBtn').disabled, 'кнопка заблокирована');
check(api.start() === null, 'заход без денег не начинается');
check(balanceOf(win) === 10, 'баланс не ушёл в минус');

// ---------- Ставки ----------
console.log('• Ставки');
win.Casino.setBalance(5000);
api.setBet(250);
check(api.state.bet === 250, 'ставка 250');
check(doc.querySelector('[data-chip="250"]').classList.contains('on'), 'фишка подсвечена');
api.setBet(1);
check(api.state.bet === 25, 'ставка не ниже 25');
api.setBet(99999);
check(api.state.bet === 2500, 'ставка не выше 2 500');
doc.querySelector('#maxBetBtn').click();
check(api.state.bet === 2500, '«Максимум» ставит 2 500');
win.Casino.setBalance(320);
doc.querySelector('#maxBetBtn').click();
check(api.state.bet === 250, `при 320 ₽ «Максимум» даёт 250, получено ${api.state.bet}`);

// ---------- Лимит стола ----------
console.log('• Лимит стола');
{
  // Закрытая цель поднимает лимит: 2 500 + 1 000 = 3 500.
  const grown = boot({
    'casino.progress.v1': JSON.stringify({ claimed: { g5000: 1 }, shields: 0, notices: [] }),
  });
  grown.window.Casino.setBalance(10000);
  check(grown.window.Casino.maxBet() === 3500, `лимит 3 500, получено ${grown.window.Casino.maxBet()}`);
  check(grown.doc.querySelector('#betLimit').textContent.replace(/\s/g, '').includes('3500'),
    `на столе виден новый лимит: ${grown.doc.querySelector('#betLimit').textContent}`);
  grown.api.setBet(99999);
  check(grown.api.state.bet === 3500, `ставка не выше нового лимита, получено ${grown.api.state.bet}`);
  grown.doc.querySelector('#maxBetBtn').click();
  check(grown.api.state.bet === 3500, `«Максимум» ставит весь лимит, получено ${grown.api.state.bet}`);
  grown.window.Casino.setBalance(3200);
  grown.doc.querySelector('#maxBetBtn').click();
  check(grown.api.state.bet === 3200, `«Максимум» не ставит больше баланса, получено ${grown.api.state.bet}`);
}

// ---------- Сброс ----------
console.log('• Сброс');
doc.querySelector('#statsBtn').click();
check(!doc.querySelector('#overlay').hidden, 'статистика открывается');
check(doc.querySelector('.modal-body').textContent.includes('Фактический возврат'), 'возврат в статистике');
doc.querySelector('[data-action="reset"]').click();
check(win.Casino.stats('mines').rounds === 0, 'статистика обнулена');
check(win.Casino.history('mines').length === 0, 'история очищена');
check(doc.querySelectorAll('#roundsList .spin-card').length === 0, 'история на странице пуста');
check(doc.querySelector('#overlay').hidden, 'окно закрылось');

// ---------- Клавиатура и клики ----------
console.log('• Клавиатура');
{
  const kbd = boot();
  kbd.window.Casino.setBalance(1000);
  kbd.api.setBet(100);
  kbd.doc.dispatchEvent(new kbd.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
  check(kbd.api.state.phase === 'playing', 'пробел начинает заход');
  check(kbd.window.Casino.getPending('mines') === 100, 'ставка списана');
  const free = [...kbd.doc.querySelectorAll('#minesBoard .cell')]
    .findIndex((cell, index) => !kbd.api.state.layout.includes(index));
  kbd.doc.querySelector(`[data-cell="${free}"]`).click();
  check(kbd.api.state.picks === 1, 'клик по клетке открывает её');
  kbd.doc.dispatchEvent(new kbd.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
  check(kbd.api.state.phase === 'idle', 'второй пробел забирает выплату');
  check(kbd.window.Casino.stats('mines').rounds === 1, 'заход записан');
  kbd.doc.dispatchEvent(new kbd.window.KeyboardEvent('keydown', { key: 'р', code: 'KeyR', bubbles: true }));
  check(!kbd.doc.querySelector('#overlay').hidden, 'R на русской раскладке открывает правила');
  kbd.doc.dispatchEvent(new kbd.window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  check(kbd.doc.querySelector('#overlay').hidden, 'Escape закрывает окно');
}

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
