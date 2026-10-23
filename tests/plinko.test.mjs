import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/plinko/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="plinko.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/plinko/plinko.js`, 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

function boot() {
  const dom = new JSDOM(html, {
    url: 'https://example.org/games/plinko/?preview=1',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  dom.window.eval(rawCasino);
  dom.window.eval(rawGame);
  return { dom, window: dom.window, doc: dom.window.document, api: dom.window.__PLINKO_TEST__ };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const balanceOf = (win) => win.Casino.getBalance();

const { window: win, doc, api } = boot();
api.setTiming({ drop: 5, settle: 5 });

const binom = (n, k) => {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
};

// ---------- Математика доски ----------
console.log('• Доска');
check(api.ROWS === 8, `восемь рядов, получено ${api.ROWS}`);
check(api.MULT.length === 9, `девять слотов, получено ${api.MULT.length}`);
check(api.MULT.every((m, i) => m === api.MULT[api.MULT.length - 1 - i]), 'таблица множителей симметрична');
check(api.MULT[0] === 20 && api.MULT[8] === 20, 'крайние слоты платят ×20');
check(api.MULT[4] < 1, 'центральный слот платит меньше ставки');

// Сумма вероятностей слотов — ровно 256/256.
const weights = [];
for (let k = 0; k <= api.ROWS; k += 1) weights.push(binom(api.ROWS, k));
check(weights.join(',') === '1,8,28,56,70,56,28,8,1', `веса слотов, получено ${weights.join(',')}`);
check(weights.reduce((a, b) => a + b, 0) === 256, 'сумма весов 256');

const weighted = api.MULT.reduce((sum, m, k) => sum + m * weights[k], 0);
check(Math.abs(weighted - 242) < 1e-9, `Σ весов × множитель = 242, получено ${weighted}`);
const rtp = weighted / 256;
check(Math.abs(rtp - 0.9453125) < 1e-9, `возврат 94,53%, получено ${(rtp * 100).toFixed(3)}%`);

// При выплате round(bet × mult) возврат на крупных ставках не меняется.
for (const bet of [100, 250, 500, 1000, 2500]) {
  let paid = 0;
  for (let k = 0; k <= api.ROWS; k += 1) paid += weights[k] * api.payoutFor(bet, k);
  const actual = paid / (256 * bet);
  check(Math.abs(actual - rtp) < 1e-12, `возврат при ставке ${bet} равен 94,53%, получено ${(actual * 100).toFixed(4)}%`);
}
{
  let paid = 0;
  for (let k = 0; k <= api.ROWS; k += 1) paid += weights[k] * api.payoutFor(25, k);
  const actual = paid / (256 * 25);
  check(actual >= rtp, `на минимальной ставке возврат не ниже 94,53%, получено ${(actual * 100).toFixed(2)}%`);
}

// ---------- Пути шарика ----------
console.log('• Путь шарика');
check(api.slotCenter(4) === 280, 'центр доски — середина');
check(api.slotCenter(0) < api.slotCenter(4) && api.slotCenter(8) > api.slotCenter(4), 'слоты идут слева направо');
const allRight = api.drawBits(8);
check(allRight.length === 8 && allRight.every((b) => b === 1), 'форс вправо даёт восемь единиц');
check(api.slotFor(allRight) === 8, 'восемь правых отскоков — крайний правый слот');
check(api.slotFor(api.drawBits(0)) === 0, 'форс влево — крайний левый слот');
check(api.slotFor(api.drawBits(3)) === 3, 'форс на три — третий слот');

const path = api.pathFor(allRight);
check(path.pts.length === api.ROWS + 2, 'в пути старт, восемь колышков и слот');
check(path.hits.length === api.ROWS, 'восемь касаний колышков');
check(path.hits[0].j === 0 && path.hits[7].j === 7, 'индексы колышков растут вместе с шариком');
const end = api.ballAt(path.pts, 1);
check(Math.abs(end.x - api.slotCenter(8)) < 1e-9, 'в конце шарик над правым слотом');
const start = api.ballAt(path.pts, 0);
check(Math.abs(start.x - 280) < 1e-9 && start.y < 30, 'старт по центру доски');

// Куда попадает серия битов: 256 комбинаций дают биномиальное распределение.
const tally = Array(9).fill(0);
for (let mask = 0; mask < 256; mask += 1) {
  const bits = Array.from({ length: 8 }, (_, i) => (mask >> i) & 1);
  tally[api.slotFor(bits)] += 1;
}
check(tally.join(',') === weights.join(','), 'все комбинации дают биномиальные веса');
check(tally[0] === 1 && tally[4] === 70 && tally[8] === 1, 'крайние слоты по одному, центр — 70');

// Генератор с фиксированным зерном даёт предсказуемые отскоки.
const seq = [0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9];
let seqIndex = 0;
api.setRng(() => seq[seqIndex++ % seq.length]);
const shuffled = api.drawBits();
check(shuffled.join('') === '01010101', `генератор дал 01010101, получено ${shuffled.join('')}`);
api.setRng(Math.random);

// ---------- Дроп с выигрышем ----------
console.log('• Дроп');
api.setBet(100);
const jackpot = await api.drop(8);
check(jackpot.slot === 8, `шарик в крайнем слоте, получено ${jackpot.slot}`);
check(jackpot.mult === 20, `множитель ×20, получено ${jackpot.mult}`);
check(jackpot.payout === 2000, `выплата 2 000, получено ${jackpot.payout}`);
check(jackpot.net === 1900, `чистыми 1 900, получено ${jackpot.net}`);
check(balanceOf(win) === 2900, `баланс 2 900, получено ${balanceOf(win)}`);
check(win.Casino.stats('plinko').drops === 1, 'дроп записан');
check(win.Casino.stats('plinko').wins === 1, 'победа записана');
check(win.Casino.stats('plinko').wagered === 100, 'оборот 100');
check(win.Casino.stats('plinko').net === 1900, 'итог 1 900');
check(win.Casino.stats('plinko').topMult === 20, 'лучший множитель ×20');
check(win.Casino.stats('plinko').bestWin === 1900, 'лучший дроп 1 900');
check(win.Casino.history('plinko').length === 1, 'дроп в истории');
check(win.Casino.history('plinko')[0].bits.length === 8, 'в истории сохранены отскоки');
check(win.Casino.history('plinko')[0].summary.includes('×20'), `описание: ${win.Casino.history('plinko')[0].summary}`);
check(win.Casino.getPending('plinko') === 0, 'ставка не висит');
check(api.state.highlight === 8, 'подсвечен восьмой слот');
check(doc.querySelector('#message').className.includes('win'), 'сообщение зелёное');
check(doc.querySelectorAll('#spinsList .spin-card').length === 1, 'дроп виден в истории на странице');
const plinkoTime = doc.querySelector('#spinsList .spin-card .round-time');
check(!!plinkoTime && plinkoTime.textContent.trim().length > 0, 'в истории дропа время в общем виде');
check(!!doc.querySelector('.topbar .shield-pill'), 'в шапке игры виден значок страховки');
check(!doc.querySelector('.panel-note'), 'над строкой управления нет дубля описания');
check(doc.querySelector('#spinsList .spin-card').classList.contains('win'), 'выигрышная карточка обведена');

// ---------- Дроп с проигрышем ----------
console.log('• Проигрыш');
const before = balanceOf(win);
const low = await api.drop(4);
check(low.slot === 4 && low.mult === 0.2, `центр — ×0,2, получено ×${low.mult}`);
check(low.payout === 20, `выплата 20, получено ${low.payout}`);
check(low.net === -80, `чистыми −80, получено ${low.net}`);
check(balanceOf(win) === before - 80, 'баланс уменьшился на 80');
check(win.Casino.stats('plinko').losses === 1, 'поражение записано');
check(win.Casino.stats('plinko').pushes === 0, 'ничьих нет');
check(win.Casino.history('plinko').length === 2, 'второй дроп в истории');
check(doc.querySelector('#message').className.includes('lose'), 'сообщение красное');

// ---------- Страховка ----------
console.log('• Страховка');
{
  const insured = boot();
  insured.api.setTiming({ drop: 5 });
  insured.window.Casino.setBalance(1000);
  insured.window.localStorage.setItem('casino.progress.v1', JSON.stringify({ shields: 2, claimed: [], net: 0 }));
  insured.window.Casino.load();
  insured.api.setBet(100);
  const res = await insured.api.drop(4);
  check(res.insurance === 40, `страховка вернула 40, получено ${res.insurance}`);
  check(res.net === -40, `чистыми −40, получено ${res.net}`);
  check(insured.window.Casino.shields() === 1, 'страховка сгорела');
  check(balanceOf(insured.window) === 960, `баланс 960, получено ${balanceOf(insured.window)}`);
}

// ---------- Мало денег ----------
console.log('• Мало денег');
win.Casino.setBalance(10);
api.setBet(100);
api.updateUI();
check(!doc.querySelector('#betHint').hidden, 'подсказка про нехватку денег');
check(doc.querySelector('#dropBtn').disabled, 'кнопка заблокирована');
check(await api.drop(8) === null, 'дроп без денег не начинается');
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

// ---------- Таблица слотов ----------
console.log('• Таблица слотов');
const rows = [...doc.querySelectorAll('#slotTable .slot-row')];
check(rows.length === 5, `пять разных множителей, получено ${rows.length}`);
check(rows[0].textContent.includes('×0,2'), 'первая строка — ×0,2');
check(rows[4].textContent.includes('×20'), 'последняя строка — ×20');
check(rows[0].textContent.includes('27,3%'), 'шанс центрального слота 27,3%');
check(rows[4].textContent.includes('0,8%'), 'шанс крайних слотов 0,8%');

// ---------- Сброс ----------
console.log('• Сброс');
doc.querySelector('#statsBtn').click();
check(!doc.querySelector('#overlay').hidden, 'статистика открывается');
check(doc.querySelector('.modal-body').textContent.includes('Фактический возврат'), 'возврат в статистике');
doc.querySelector('[data-action="reset"]').click();
check(win.Casino.stats('plinko').drops === 0, 'статистика обнулена');
check(win.Casino.history('plinko').length === 0, 'история очищена');
check(doc.querySelectorAll('#spinsList .spin-card').length === 0, 'история на странице пуста');
check(doc.querySelector('#overlay').hidden, 'окно закрылось');

// ---------- Клавиатура ----------
console.log('• Клавиатура');
{
  const kbd = boot();
  kbd.api.setTiming({ drop: 5 });
  kbd.window.Casino.setBalance(1000);
  kbd.api.setBet(100);
  kbd.doc.dispatchEvent(new kbd.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
  await sleep(80);
  check(kbd.window.Casino.stats('plinko').drops === 1, 'пробел бросает шарик');
  check(kbd.window.Casino.stats('plinko').wagered === 100, 'ставка списана');
  kbd.doc.dispatchEvent(new kbd.window.KeyboardEvent('keydown', { key: 'р', code: 'KeyH', bubbles: true }));
  check(!kbd.doc.querySelector('#overlay').hidden, 'H на русской раскладке открывает историю');
  kbd.doc.dispatchEvent(new kbd.window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  check(kbd.doc.querySelector('#overlay').hidden, 'Escape закрывает окно');
}

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
