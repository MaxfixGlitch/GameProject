import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/dice/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="dice.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/dice/dice.js`, 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

const CASINO_KEYS = ['casino.wallet.v1', 'casino.history.v1', 'casino.stats.v1', 'casino.pending.v1',
  'casino.sound.v1', 'casino.progress.v1', 'casino.topup.v1'];

// Каждое окно jsdom имеет собственный localStorage, поэтому данные
// переносим вручную — как «перезагрузка вкладки».
function boot(seed) {
  const dom = new JSDOM(html, { url: 'https://example.org/games/dice/?preview=1', pretendToBeVisual: true, runScripts: 'outside-only' });
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
  return { dom, window: dom.window, doc: dom.window.document, api: dom.window.__DICE_TEST__ };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Математику выплат проверяем без побочных эффектов целей:
// все награды уже получены, баланс меняют только ставки.
const GOALS_OFF = {
  'casino.progress.v1': JSON.stringify({
    claimed: { g2000: 1, g5000: 1, g12000: 1, g25000: 1, g50000: 1, g100000: 1, g200000: 1, g400000: 1 },
    shields: 0,
    notices: [],
  }),
};

const { window, doc, api } = boot(GOALS_OFF);
api.setTiming({ roll: 1, settle: 1 });

const balance = () => window.Casino.getBalance();
const selectChip = (targetDoc, value = 100) => {
  const chip = targetDoc.querySelector(`[data-chip="${value}"]`);
  if (!chip) throw new Error(`Нет фишки ${value}`);
  chip.click();
};
selectChip(doc, 100);

const betTotal = () => api.totalBet();
const cell = (key) => doc.querySelector(`[data-bet="${key}"]`);

// ---------- Правила и выплаты ----------
console.log('• Комбинации и выплаты');
{
  const ways = {};
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) ways[a + b] = (ways[a + b] || 0) + 1;
  }
  const expected = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  Object.entries(expected).forEach(([sum, count]) => {
    check(ways[sum] === count, `сумма ${sum} выпадает ${count} способами, получено ${ways[sum]}`);
  });
  check(Object.values(ways).reduce((s, n) => s + n, 0) === 36, 'всего 36 комбинаций');

  check(api.SUM_MULT[7] === 6, 'семёрка платит ×6');
  check(api.SUM_MULT[2] === 31 && api.SUM_MULT[12] === 31, '2 и 12 платят ×31');
  check(api.multiplier('sum:7') === 6 && api.multiplier('sum:2') === 31, 'множители сумм');
  check(api.multiplier('even') === 2 && api.multiplier('over') === 2, 'внешние ставки ×2');
  check(api.multiplier('double') === 6, 'любой дубль ×6');
  check(api.multiplier('pair:4') === 31, 'точный дубль ×31');
}

console.log('• Какие ставки выигрывают');
{
  check(api.betWins('sum:7', 3, 4), 'сумма 7 на 3 и 4');
  check(!api.betWins('sum:7', 2, 4), 'сумма 6 не равна 7');
  check(api.betWins('even', 2, 2) && api.betWins('even', 6, 6), 'чётная сумма');
  check(api.betWins('odd', 3, 4) && !api.betWins('even', 3, 4), 'нечетная сумма');
  check(api.betWins('over', 6, 6) && !api.betWins('over', 3, 4), 'больше 7 только от 8');
  check(api.betWins('under', 1, 1) && !api.betWins('under', 3, 4), 'меньше 7 только до 6');
  check(!api.betWins('over', 3, 4) && !api.betWins('under', 3, 4), 'семёрка проигрывает больше и меньше');
  check(api.betWins('double', 5, 5) && !api.betWins('double', 5, 4), 'дубль только при равных костях');
  check(api.betWins('pair:5', 5, 5) && !api.betWins('pair:5', 4, 4), 'точный дубль только свой');
  check(!api.betWins('sum:7', 0, 0), 'нулевые кости не считаются');
}

// ---------- Стол ----------
console.log('• Стол и ставки');
check(doc.querySelectorAll('[data-bet]').length === 22, `на столе 22 клетки, получено ${doc.querySelectorAll('[data-bet]').length}`);
check(doc.querySelectorAll('.dice-row.sums .cell').length === 11, '11 сумм');
check(doc.querySelectorAll('.dice-row.outside .cell').length === 5, '5 внешних ставок');
check(doc.querySelectorAll('.dice-row.pairs .cell').length === 6, '6 точных дублей');
check(balance() === 1000, `стартовый баланс 1000, получено ${balance()}`);
check(doc.querySelector('#rollBtn').disabled, '«Бросить» заблокирована без ставки');

cell('sum:7').click();
check(balance() === 900, `после фишки 100 баланс 900, получено ${balance()}`);
check(betTotal() === 100, `ставка 100, получено ${betTotal()}`);
check(doc.querySelector('[data-bet="sum:7"] .cell-chip').textContent === '100',
  'на клетке видна сумма ставки');
check(!doc.querySelector('[data-bet="sum:7"] .cell-chip').parentElement
  .querySelector('.cell-num').textContent.includes('100'), 'номер суммы не заменился ставкой');
check(!doc.querySelector('#rollBtn').disabled, '«Бросить» активна');

cell('even').click();
check(betTotal() === 200 && balance() === 800, 'вторая ставка добавилась');

api.undoBet();
check(betTotal() === 100 && balance() === 900, 'отмена возвращает последнюю фишку');

cell('double').click();
check(betTotal() === 200, 'ставка на дубль добавлена');
api.clearBets();
check(betTotal() === 0 && balance() === 1000, 'очистка возвращает все фишки');
check(JSON.parse(window.localStorage.getItem('casino.pending.v1')).dice === undefined,
  'после очистки долг по ставке снят');

// Крупная ставка сокращается, чтобы чип влезал в клетку.
check(api.chipAmount(25) === '25', 'мелкая ставка без сокращений');
check(api.chipAmount(1000) === '1k' && api.chipAmount(2500) === '2,5k', 'крупные ставки сокращаются');

// ---------- Бросок: сумма ----------
console.log('• Бросок 3 и 4 — сумма 7');
cell('sum:7').click();
api.forceDice(3, 4);
await api.roll();
await sleep(5);

check(api.state.rolls[0].sum === 7, `сумма 7, получено ${api.state.rolls[0].sum}`);
check(doc.querySelector('#sumBadge').textContent === '7', 'сумма показана на фетре');
check(api.state.dice[0] === 3 && api.state.dice[1] === 4, 'на кубиках 3 и 4');
check(doc.querySelector('#message').textContent.includes('сумма 7'), 'сообщение называет сумму');
check(balance() === 900 + 600, `выплата ×6: ожидалось 1500, получено ${balance()}`);
check(window.Casino.stats('dice').wins === 1, 'победа засчитана');

const stats7 = window.Casino.stats('dice');
check(stats7.rolls === 1, `счётчик бросков 1, получено ${stats7.rolls}`);
check(stats7.wins === 1 && stats7.losses === 0, 'победа засчитана');
check(stats7.wagered === 100 && stats7.net === 500, `оборот 100, итог 500, получено ${stats7.wagered}/${stats7.net}`);
check(stats7.doubles === 0, 'дублей не было');

const history = window.Casino.history('dice');
check(history.length === 1, 'в истории один бросок');
check(history[0].sum === 7 && history[0].dice[0] === 3 && history[0].dice[1] === 4, 'в истории кости и сумма');
check(history[0].bets['sum:7'] === 100, 'в истории ставка');
check(history[0].summary.includes('3 и 4'), 'в истории описание');
check(JSON.parse(window.localStorage.getItem('casino.pending.v1')).dice === undefined,
  'после броска долг снят');

// История отрисована: обе кости и выигравшая ставка.
const row = doc.querySelector('.roll-row');
check(!!row, 'строка истории появилась');
check(row.querySelectorAll('.mini-die .pip').length === 7, `на мини-кубиках 7 точек (3+4), получено ${row.querySelectorAll('.mini-die .pip').length}`);
check(row.querySelectorAll('.bet-tag.is-win').length === 1, 'выигравшая ставка обведена зелёным');
check(row.querySelector('.roll-net').textContent.includes('500'), 'в истории итог броска');
check(!!row.querySelector('.round-time') && row.querySelector('.round-time').textContent.trim().length > 0,
  'в истории броска время в общем виде');
check(!!doc.querySelector('.topbar .shield-pill'), 'в шапке игры есть значок страховки');
check(doc.querySelectorAll('#rollsStrip .strip-roll').length === 1, 'бросок попал в ленту');

// ---------- Подсветка выигравших клеток ----------
console.log('• Подсветка выигравших клеток');
api.setTiming({ roll: 1, settle: 80 });
cell('sum:7').click();
cell('even').click();
api.forceDice(3, 4);
const litRoll = api.roll();
while (!api.state.settled) await sleep(2);
check(doc.querySelectorAll('.cell.is-win').length === 1, 'выиграла одна клетка');
check(doc.querySelector('[data-bet="sum:7"]').classList.contains('is-win'), 'это клетка семёрки');
check(doc.querySelectorAll('.cell.is-lose').length === 1, 'проигравшая ставка притушена');
await litRoll;
api.setTiming({ roll: 1, settle: 1 });

// ---------- Бросок: дубль ----------
console.log('• Бросок 5 и 5 — дубль');
const beforeDoubles = balance();
cell('double').click();
cell('pair:5').click();
cell('even').click();
api.forceDice(5, 5);
await api.roll();
await sleep(5);

check(balance() === beforeDoubles - 300 + 600 + 3100 + 200,
  `выплаты дубля, точного дубля и чёта, баланс ${balance()}`);
check(window.Casino.stats('dice').doubles === 1, 'дубль учтён в статистике');

// ---------- Семёрка против больше/меньше ----------
console.log('• Семёрка против «больше» и «меньше»');
const game2 = boot();
game2.api.setTiming({ roll: 1, settle: 1 });
selectChip(game2.doc, 100);
game2.doc.querySelector('[data-bet="over"]').click();
game2.doc.querySelector('[data-bet="under"]').click();
const hint = game2.doc.querySelector('#betHint');
check(!hint.hidden && hint.textContent.includes('7'), `стол предупреждает о дыре на семёрке: «${hint.textContent}»`);
game2.api.forceDice(3, 4);
await game2.api.roll();
await sleep(5);
check(game2.window.Casino.getBalance() === 800, `семёрка забирает обе ставки, баланс ${game2.window.Casino.getBalance()}`);
check(game2.api.state.rolls[0].sum === 7, 'выпала семёрка');

// ---------- Зеркальные ставки ----------
console.log('• Чёт и нечет одновременно');
const game3 = boot();
game3.api.setTiming({ roll: 1, settle: 1 });
selectChip(game3.doc, 100);
game3.doc.querySelector('[data-bet="even"]').click();
game3.doc.querySelector('[data-bet="odd"]').click();
const hint3 = game3.doc.querySelector('#betHint');
check(!hint3.hidden && hint3.textContent.includes('уравновешивают'),
  `подсказка про зеркальные ставки: «${hint3.textContent}»`);
game3.api.forceDice(2, 5);
await game3.api.roll();
await sleep(5);
check(game3.window.Casino.getBalance() === 1000, `вернулась ровно ставка, баланс ${game3.window.Casino.getBalance()}`);

// ---------- Страховка при проигрыше ----------
console.log('• Страховка');
const insured = boot({
  'casino.wallet.v1': JSON.stringify({ bankroll: 1000 }),
  'casino.progress.v1': JSON.stringify({ claimed: {}, shields: 1, notices: [] }),
  'casino.stats.v1': JSON.stringify({}),
  'casino.history.v1': JSON.stringify({}),
  'casino.pending.v1': JSON.stringify({}),
});
insured.api.setTiming({ roll: 1, settle: 1 });
selectChip(insured.doc, 100);
insured.doc.querySelector('[data-bet="sum:12"]').click();
insured.api.forceDice(3, 3);
await insured.api.roll();
await sleep(5);
check(insured.window.Casino.getBalance() === 950, `страховка вернула половину, баланс ${insured.window.Casino.getBalance()}`);
check(insured.window.Casino.shields() === 0, 'страховка потрачена');
check(insured.doc.querySelector('#message').textContent.includes('страховка'), 'сообщение говорит о страховке');

// ---------- Лимит стола ----------
console.log('• Лимит стола');
const limited = boot({ 'casino.wallet.v1': JSON.stringify({ bankroll: 10000 }) });
limited.api.setTiming({ roll: 1, settle: 1 });
selectChip(limited.doc, 500);
const limit = limited.window.Casino.maxBet();
for (let i = 0; i < 20; i++) limited.doc.querySelector('[data-bet="sum:7"]').click();
check(limited.api.totalBet() === limit, `лимит ${limit}, на столе ${limited.api.totalBet()}`);
limited.doc.querySelector('[data-bet="sum:8"]').click();
check(limited.api.totalBet() === limit, 'сверх лимита ставка не принимается');
check(limited.window.Casino.getBalance() === 10000 - limit, 'списано ровно по ставкам');

// ---------- Повтор ставки ----------
console.log('• Повтор ставки');
const repeat = boot();
repeat.api.setTiming({ roll: 1, settle: 1 });
selectChip(repeat.doc, 100);
repeat.doc.querySelector('[data-bet="sum:4"]').click();
repeat.doc.querySelector('[data-bet="under"]').click();
repeat.api.forceDice(1, 2);
await repeat.api.roll();
await sleep(5);
// После расчёта ставки убираются, появляется «Повторить».
const repeatBtn = repeat.doc.querySelector('#repeatBtn');
check(!repeatBtn.hidden, 'кнопка «Повторить» появилась');
const balanceAfter = repeat.window.Casino.getBalance();
repeatBtn.click();
check(repeat.api.totalBet() === 200, `повтор вернул ставки, на столе ${repeat.api.totalBet()}`);
check(repeat.window.Casino.getBalance() === balanceAfter - 200, 'повтор списал фишки');

// ---------- Незавершённый бросок ----------
console.log('• Незавершённый бросок');
const crashed = boot();
crashed.window.Casino.setPending('dice', 300);
crashed.window.Casino.save();
const restored = boot({ localStorage: crashed.window.localStorage });
check(restored.window.Casino.getBalance() === 1300,
  `зависшая ставка вернулась на баланс, получено ${restored.window.Casino.getBalance()}`);

// ---------- Русская раскладка ----------
console.log('• Русская раскладка');
const layout = boot();
layout.api.setTiming({ roll: 1, settle: 1 });
selectChip(layout.doc, 100);
layout.doc.querySelector('[data-bet="sum:7"]').click();
check(layout.api.totalBet() === 100, 'ставка сделана');
layout.doc.dispatchEvent(new layout.window.KeyboardEvent('keydown', { key: 'с', code: 'KeyC' }));
check(layout.api.totalBet() === 0, 'C на русской раскладке очищает ставки');
layout.doc.querySelector('[data-bet="sum:7"]').click();
layout.doc.dispatchEvent(new layout.window.KeyboardEvent('keydown', { key: 'р', code: 'KeyH' }));
check(!layout.doc.querySelector('#overlay').hidden, 'H на русской раскладке открывает историю');
layout.doc.dispatchEvent(new layout.window.KeyboardEvent('keydown', { key: 'Escape' }));
check(layout.doc.querySelector('#overlay').hidden, 'Escape закрывает историю');

// ---------- Окна ----------
console.log('• Окна');
doc.querySelector('#rulesBtn').click();
check(doc.querySelector('#modalBody').textContent.includes('Правила костей'), 'правила открываются');
check(doc.querySelector('#modalBody').textContent.includes('×31'), 'в правилах есть выплаты');
doc.querySelector('#modalClose').click();
check(doc.querySelector('#overlay').hidden, 'правила закрываются');

doc.querySelector('#statsBtn').click();
const statsText = doc.querySelector('#modalBody').textContent;
check(statsText.includes('Статистика костей'), 'статистика открывается');
check(statsText.includes('Дублей выпало'), 'в статистике есть дубли');
doc.querySelector('#modalClose').click();

doc.querySelector('#historyBtn').click();
check(doc.querySelectorAll('.rolls-history-full .roll-row').length
  === window.Casino.history('dice').length, 'в окне истории все броски');
doc.querySelector('#modalClose').click();

// ---------- Сброс ----------
console.log('• Сброс');
const resetGame = boot();
resetGame.api.setTiming({ roll: 1, settle: 1 });
selectChip(resetGame.doc, 100);
resetGame.doc.querySelector('[data-bet="sum:7"]').click();
resetGame.api.forceDice(1, 6);
await resetGame.api.roll();
await sleep(5);
resetGame.doc.querySelector('#statsBtn').click();
resetGame.doc.querySelector('[data-action="reset"]').click();
check(resetGame.window.Casino.stats('dice').rolls === 0, 'статистика костей обнулена');
check(resetGame.window.Casino.history('dice').length === 0, 'история костей очищена');
check(resetGame.window.Casino.stats('roulette').spins === 0, 'чужая статистика не тронута');

// ---------- Крупная фишка ----------
console.log('• Крупная фишка');
{
  // Три закрытые цели — лимит 5 500 ₽: фишка 5 000 появляется.
  const rich = boot({
    'casino.wallet.v1': JSON.stringify({ bankroll: 20000 }),
    'casino.progress.v1': JSON.stringify({ claimed: { g2000: 1, g5000: 1, g12000: 1 }, shields: 0, notices: [] }),
  });
  const big = rich.doc.querySelector('[data-chip="5000"]');
  check(!big.hidden, 'с лимитом 5 500 фишка 5 000 видна');
  big.click();
  rich.doc.querySelector('[data-bet="sum:7"]').click();
  check(rich.api.totalBet() === 5000, `фишка 5 000 ставит 5 000, получено ${rich.api.totalBet()}`);
}

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
