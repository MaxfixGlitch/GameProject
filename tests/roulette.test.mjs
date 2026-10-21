import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/roulette/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="roulette.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/roulette/roulette.js`, 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

const CASINO_KEYS = ['casino.wallet.v1', 'casino.history.v1', 'casino.stats.v1', 'casino.pending.v1', 'casino.sound.v1'];

// Каждое окно jsdom имеет собственный localStorage, поэтому данные
// переносим вручную — как «перезагрузка вкладки».
function boot(seed) {
  const dom = new JSDOM(html, { url: 'https://example.org/roulette/', pretendToBeVisual: true, runScripts: 'outside-only' });
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
  return { dom, window: dom.window, doc: dom.window.document, api: dom.window.__RL_TEST__ };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { window, doc, api } = boot();
api.setTiming({ spin: 1, settle: 1 });

const balance = () => window.Casino.getBalance();
// По умолчанию выбрана фишка 25 — для сценариев берём 100.
const selectChip = (targetDoc, value = 100) => {
  const chip = targetDoc.querySelector(`[data-chip="${value}"]`);
  if (!chip) throw new Error(`Нет фишки ${value}`);
  chip.click();
};
selectChip(doc, 100);
const betTotal = () => api.totalBet();
const cell = (key) => doc.querySelector(`[data-cell="${key}"]`) || doc.querySelector(`[data-bet="${key}"]`);

// ---------- Колесо ----------
console.log('• Колесо и цвета');
check(doc.querySelectorAll('#wheel .wedge').length === 37, 'на колесе 37 секторов');
check(api.WHEEL_ORDER.length === 37, 'в порядке колеса 37 чисел');
const uniqueNumbers = new Set(api.WHEEL_ORDER);
check(uniqueNumbers.size === 37, 'все числа от 0 до 36 уникальны');
check([...uniqueNumbers].every((n) => n >= 0 && n <= 36), 'числа в диапазоне 0–36');
check(api.WHEEL_ORDER[0] === 0, 'зеро стоит первым');
check(api.WHEEL_ORDER[1] === 32, 'после зеро идёт 32 — порядок европейского колеса');
check(doc.querySelector('#wheelRotor #wheelHub') === null,
  'ступица с надписями не вращается вместе с колесом');
check(doc.querySelector('#wheel #wheelHub') !== null, 'ступица на месте');

const redCount = [...uniqueNumbers].filter((n) => api.colorOf(n) === 'red').length;
const blackCount = [...uniqueNumbers].filter((n) => api.colorOf(n) === 'black').length;
check(redCount === 18 && blackCount === 18, `18 красных и 18 чёрных, получено ${redCount}/${blackCount}`);
check(api.colorOf(0) === 'green', 'зеро зелёное');
check(api.colorLabel(0) === 'зеро', 'подпись зеро');

// ---------- Правила ставок ----------
console.log('• Правила ставок и выплаты');
check(api.betWins('straight:17', 17), 'ставка на число совпадает');
check(!api.betWins('straight:17', 18), 'ставка на число не совпадает');
check(api.betWins('straight:0', 0), 'можно ставить на зеро');
check(api.betWins('red', 1) && api.betWins('red', 36), 'красное на 1 и 36');
check(!api.betWins('red', 2) && !api.betWins('black', 1), 'цвета не путаются');
check(!api.betWins('red', 0) && !api.betWins('black', 0), 'зеро проигрывает цветам');
check(!api.betWins('even', 0) && !api.betWins('odd', 0), 'зеро не чёт и не нечет');
check(api.betWins('even', 4) && api.betWins('odd', 7), 'чёт и нечет работают');
check(api.betWins('low', 1) && api.betWins('low', 18), 'нижняя половина 1–18');
check(!api.betWins('low', 19) && api.betWins('high', 19), 'верхняя половина с 19');
check(api.betWins('dozen:1', 12) && api.betWins('dozen:2', 13) && api.betWins('dozen:3', 36), 'дюжины');
check(!api.betWins('dozen:1', 13), 'дюжина не захватывает соседнюю');
for (let k = 1; k <= 3; k++) {
  const numbers = [];
  for (let n = 1; n <= 36; n++) if (api.betWins(`column:${k}`, n)) numbers.push(n);
  check(numbers.length === 12, `в колонке ${k} 12 чисел, получено ${numbers.length}`);
  check(numbers.every((n) => ((n - 1) % 3) + 1 === k), `колонка ${k} собрана верно`);
}
check(api.multiplier('straight:7') === 36, 'выплата за число 35:1 (×36)');
check(api.multiplier('dozen:2') === 3 && api.multiplier('column:1') === 3, 'дюжина и колонка 2:1 (×3)');
check(api.multiplier('red') === 2 && api.multiplier('even') === 2 && api.multiplier('low') === 2, 'внешние ставки 1:1 (×2)');

const zeroWins = ['red', 'black', 'even', 'odd', 'low', 'high', 'dozen:1', 'column:2']
  .filter((key) => api.betWins(key, 0));
check(zeroWins.length === 0, `зеро не оплачивает внешние ставки (${zeroWins.join(', ')})`);

// ---------- Ставки на столе ----------
console.log('• Ставки на столе');
check(doc.querySelectorAll('[data-bet]').length === 49, 'на столе 49 клеток');
check(balance() === 1000, `стартовый баланс 1000, получено ${balance()}`);

cell('straight:17').click();
check(balance() === 900, `после фишки 100 баланс 900, получено ${balance()}`);
check(betTotal() === 100, `ставка 100, получено ${betTotal()}`);
check(doc.querySelector('[data-bet="straight:17"] .cell-chip').textContent === '100',
  'на клетке видна сумма ставки');
check(JSON.parse(window.localStorage.getItem('casino.pending.v1')).roulette === 100,
  'ставка отложена в незавершённом спине');

cell('red').click();
cell('red').click();
check(betTotal() === 300, `на красное добавилось 200, всего ${betTotal()}`);
check(balance() === 700, `баланс 700, получено ${balance()}`);

api.undoBet();
check(betTotal() === 200 && balance() === 800, 'отмена возвращает последнюю фишку');

api.clearBets();
check(betTotal() === 0 && balance() === 1000, 'очистка возвращает все фишки');
check(JSON.parse(window.localStorage.getItem('casino.pending.v1')).roulette === undefined,
  'после очистки долг по ставке снят');

// ---------- Спин: выигрыш на число ----------
console.log('• Спин: число 17');
cell('straight:17').click();
check(betTotal() === 100 && balance() === 900, 'ставка на 17 сделана');
api.forceNumber(17);
await api.spin();
await sleep(5);

check(api.state.numbers[0] === 17, `выпало 17, получено ${api.state.numbers[0]}`);
check(api.state.bets && Object.keys(api.state.bets).length === 0, 'после расчёта ставки убраны');
check(balance() === 900 + 3600, `выплата 35:1: ожидалось 4500, получено ${balance()}`);
const stats = window.Casino.stats('roulette');
check(stats.spins === 1, `счётчик спинов 1, получено ${stats.spins}`);
check(stats.wins === 1, 'победа засчитана');
check(stats.wagered === 100, `оборот 100, получено ${stats.wagered}`);
check(stats.net === 3500, `чистый итог 3500, получено ${stats.net}`);
check(stats.bestWin === 3500, 'лучший спин записан');

const history = window.Casino.history('roulette');
check(history.length === 1, 'в истории один спин');
check(history[0].number === 17 && history[0].net === 3500, 'в истории число и итог');
check(history[0].summary.includes('17'), 'в истории есть описание');
check(JSON.parse(window.localStorage.getItem('casino.pending.v1')).roulette === undefined,
  'после спина долг снят');

// ---------- Спин: зеро против красного ----------
console.log('• Спин: зеро против красного');
cell('red').click();
check(balance() === 4400, `после ставки на красное 4400, получено ${balance()}`);
api.forceNumber(0);
await api.spin();
await sleep(5);
check(api.state.numbers[0] === 0, 'выпало зеро');
check(balance() === 4400, `зеро не платит за красное, баланс ${balance()}`);
check(window.Casino.stats('roulette').losses === 1, 'поражение засчитано');

// ---------- Спин: дюжина ----------
console.log('• Спин: дюжина');
cell('dozen:2').click();
api.forceNumber(15);
await api.spin();
await sleep(5);
check(balance() === 4400 - 100 + 300, `дюжина платит 2:1, баланс ${balance()}`);

// ---------- Спин: ничья по деньгам (1:1) ----------
console.log('• Спин: возврат при 1:1');
cell('even').click();
api.forceNumber(8);
await api.spin();
await sleep(5);
check(balance() === 4600 - 100 + 200, `чёт платит 1:1, баланс ${balance()}`);

// ---------- Перезагрузка ----------
console.log('• Сохранение между заходами');
const balanceAfter = balance();
const reloaded = boot(window);
check(reloaded.window.Casino.getBalance() === balanceAfter,
  `баланс пережил перезагрузку: ${reloaded.window.Casino.getBalance()} != ${balanceAfter}`);
check(reloaded.window.Casino.stats('roulette').spins === 4, 'статистика спинов пережила перезагрузку');
check(reloaded.window.Casino.history('roulette').length === 4, 'история пережила перезагрузку');
check(reloaded.doc.querySelectorAll('.strip-num').length === 4, 'лента последних чисел восстановлена');

// ---------- Ставка, зависшая в незавершённом спине ----------
console.log('• Возврат ставки при закрытии вкладки');
const half = boot();
half.api.setTiming({ spin: 1, settle: 1 });
selectChip(half.doc, 100);
half.doc.querySelector('[data-bet="straight:5"]').click();
half.doc.querySelector('[data-bet="black"]').click();
check(half.window.Casino.getBalance() === 800, 'две фишки списаны');
const reopened = boot(half.window);
check(reopened.window.Casino.getBalance() === 1000,
  `незавершённый спин вернул 200 ₽, получено ${reopened.window.Casino.getBalance()}`);

// ---------- Ставка на зеро ----------
console.log('• Ставка на само зеро');
const zeroGame = boot();
zeroGame.api.setTiming({ spin: 1, settle: 1 });
selectChip(zeroGame.doc, 100);
zeroGame.doc.querySelector('[data-bet="straight:0"]').click();
zeroGame.api.forceNumber(0);
await zeroGame.api.spin();
await sleep(5);
check(zeroGame.window.Casino.getBalance() === 900 + 3600, 'зеро платит 35:1');

// ---------- Приземление шарика ----------
console.log('• Шарик останавливается над выпавшим числом');
{
  // Отдельная вкладка: спин на 600 мс, чтобы анимация прошла много кадров.
  const game = boot();
  game.api.setTiming({ spin: 600, settle: 1 });
  game.window.Casino.setBalance(50000);

  const angleOf = (x, y) => ((Math.atan2(x - 200, -(y - 200)) * 180) / Math.PI + 360) % 360;
  const ball = () => game.doc.querySelector('#ball');
  const ballAngle = () => angleOf(Number(ball().getAttribute('cx')), Number(ball().getAttribute('cy')));
  const ballRadius = () => Math.hypot(
    Number(ball().getAttribute('cx')) - 200,
    Number(ball().getAttribute('cy')) - 200,
  );
  const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  // Регрессия из отзыва: на колесе было 29, а объявлялось 21.
  // Число оборотов шарика должно быть целым, иначе он не попадает в карман.
  for (const number of [21, 29, 0, 36, 17]) {
    game.api.forceNumber(number);
    game.api.placeBet(`straight:${number}`, 25);
    await game.api.spin();

    const drawn = game.api.state.numbers[0];
    const index = game.api.WHEEL_ORDER.indexOf(drawn);
    const pocket = (((game.api.state.wheelAngle + index * game.api.SEG) % 360) + 360) % 360;
    const diff = angleDiff(ballAngle(), pocket);

    check(drawn === number, `объявлено ${drawn}, ожидалось ${number}`);
    check(diff < 0.5, `шарик над сектором ${number}: расхождение ${diff.toFixed(2)}°`);
    check(Math.abs(ballRadius() - game.api.R_POCKET) < 0.6,
      `шарик лежит в кармане: радиус ${ballRadius().toFixed(1)}, ожидали ${game.api.R_POCKET}`);
  }

  // Шарик не должен «притягиваться»: последние кадры он уже в кармане и
  // заметно не перемещается, а до падения идёт по внешней дорожке.
  game.api.forceNumber(7);
  game.api.placeBet('straight:7', 25);
  const seen = [];
  const watch = setInterval(() => {
    seen.push({ a: ballAngle(), r: ballRadius() });
  }, 20);
  await game.api.spin();
  clearInterval(watch);

  const onTrack = seen.filter((p) => p.r > 160);
  const inPocket = seen.filter((p) => p.r < game.api.R_POCKET + 5);
  check(onTrack.length > 0, 'шарик какое-то время катится по внешней дорожке');
  check(inPocket.length > 0, 'шарик опускается в карман');

  const trackAngles = onTrack.map((p) => p.a);
  const travelled = trackAngles.reduce((sum, a, i) => (
    i === 0 ? 0 : sum + Math.abs(((a - trackAngles[i - 1] + 540) % 360) - 180)
  ), 0);
  check(travelled > 720, `по дорожке шарик проходит больше двух оборотов, прошёл ${travelled.toFixed(0)}°`);
}

// ---------- Случайная сила броска ----------
console.log('• Сила и длительность спина меняются');
{
  const game = boot();
  game.api.setTiming({ spin: 100, settle: 1 });
  game.window.Casino.setBalance(100000);

  const spins = [];
  for (let i = 0; i < 10; i++) {
    const number = (i * 7 + 3) % 37;
    game.api.forceNumber(number);
    game.api.placeBet(`straight:${number}`, 25);
    await game.api.spin();
    spins.push({ ...game.api.state.lastSpin });
  }

  const durations = new Set(spins.map((s) => Math.round(s.duration)));
  const turns = new Set(spins.map((s) => Math.round(s.wheelTurns * 10)));
  check(durations.size >= 6, `длительность вращения разная: ${durations.size} значений из 10`);
  check(turns.size >= 4, `сила раскрутки разная: ${turns.size} значений из 10`);
  check(Math.min(...spins.map((s) => s.wheelTurns)) < 6
    && Math.max(...spins.map((s) => s.wheelTurns)) > 8,
  'бывают и слабые, и сильные спины');
  check(spins.every((s) => Number.isInteger(s.ballTurns)),
    'число оборотов шарика целое — иначе он не попадёт в карман');
}

// ---------- История спинов ----------
console.log('• История спинов: что выбрано и что выиграло');
{
  const game = boot();
  game.api.setTiming({ spin: 120, settle: 1 });
  game.window.Casino.setBalance(10000);

  const list = game.doc.querySelector('#spinsList');
  check(list.querySelectorAll('.spin-row').length === 0, 'до первого спина история пуста');
  check(list.textContent.includes('Спинов пока нет'), 'пустая история подсказывает, что делать');

  // Три ставки, из них две выигрывают: число 17 и НЕЧЁТ. КРАСНОЕ проигрывает.
  game.api.forceNumber(17);
  game.api.placeBet('straight:17', 100);
  game.api.placeBet('red', 50);
  game.api.placeBet('odd', 25);
  await game.api.spin();
  await sleep(5);

  const row = list.querySelector('.spin-row');
  check(row !== null, 'спин появился в истории');
  check(row.querySelector('.spin-num').textContent.trim() === '17', 'в истории выпавшее число');
  check(row.querySelector('.bet-tag-label') !== null, 'в истории видны ставки');
  check(row.textContent.replace(/\s/g, '').includes('175'), 'в истории сумма всех ставок');
  check(row.textContent.includes('выплата'), 'в истории выплата');
  check(row.querySelector('.spin-net').textContent.replace(/\s/g, '').includes('+3475'),
    `итог спина +3 475, получено ${row.querySelector('.spin-net').textContent}`);

  const tags = [...row.querySelectorAll('.bet-tag')];
  check(tags.length === 3, `все три ставки в истории, получено ${tags.length}`);
  const won = tags
    .filter((tag) => tag.classList.contains('is-win'))
    .map((tag) => tag.querySelector('.bet-tag-label').textContent);
  check(won.length === 2 && won.includes('17') && won.includes('НЕЧЁТ'),
    `выиграли число и нечёт, получено: ${won.join(', ')}`);
  check(!won.includes('КРАСНОЕ'), 'проигравшее красное без зелёной рамки');
  check(row.querySelectorAll('.bet-tag.is-win').length === 2, 'выигравшие ставки обведены зелёным');
  check(row.textContent.includes('чёрное'), 'в истории цвет выпавшего числа');

  // Второй спин: только проигравшая ставка.
  game.api.forceNumber(4);
  game.api.placeBet('red', 25);
  await game.api.spin();
  await sleep(5);

  const rows = list.querySelectorAll('.spin-row');
  check(rows.length === 2, `в истории два спина, получено ${rows.length}`);
  check(rows[0].querySelectorAll('.bet-tag').length === 1, 'у второго спина одна ставка');
  check(rows[0].querySelectorAll('.bet-tag.is-win').length === 0, 'проигравшая ставка без зелёной рамки');
  check(rows[0].classList.contains('minus'), 'проигранный спин помечен минусом');

  // Полная история — в окне, открывается кнопкой и клавишей H.
  game.doc.querySelector('#historyBtn').click();
  check(!game.doc.querySelector('#overlay').hidden, 'окно истории открывается');
  check(game.doc.querySelectorAll('.spin-history-full .spin-row').length
    === game.window.Casino.history('roulette').length, 'в окне все спины');
  game.doc.querySelector('#modalClose').click();
  check(game.doc.querySelector('#overlay').hidden, 'окно истории закрывается');

  game.doc.dispatchEvent(new game.window.KeyboardEvent('keydown', { key: 'h' }));
  check(!game.doc.querySelector('#overlay').hidden, 'клавиша H открывает историю');
  game.doc.dispatchEvent(new game.window.KeyboardEvent('keydown', { key: 'Escape' }));
  check(game.doc.querySelector('#overlay').hidden, 'Escape закрывает историю');

  game.doc.querySelector('#historyTopBtn').click();
  check(!game.doc.querySelector('#overlay').hidden, 'иконка истории в шапке открывает окно');
  game.doc.querySelector('#modalClose').click();
}

// ---------- Лимиты и сочетания ставок ----------
console.log('• Лимит стола и подсказки о комбинациях');
{
  const game = boot();
  game.api.setTiming({ spin: 1, settle: 1 });
  game.window.Casino.setBalance(20000);
  const hintNode = game.doc.querySelector('#betHint');
  const hint = () => (hintNode.hidden ? '' : hintNode.textContent);

  check(game.doc.querySelector('#betLimit').textContent.replace(/\s/g, '').includes('2500'),
    'на столе виден лимит 2 500 ₽');

  // Обычная ставка — без предупреждений.
  game.api.placeBet('red', 100);
  check(hint() === '', 'на обычную ставку подсказки нет');

  // Красное + чёрное: правила разрешают, но выиграть нельзя.
  game.api.placeBet('black', 100);
  check(hint().includes('Зеркальные ставки'), `предупреждение о зеркальных ставках, получено: ${hint()}`);

  // Математика: при любом числе, кроме зеро, возвращается ровно ставка.
  check(game.api.payoutFor(17) === 200, `красное+чёрное вернут 200 на 17, получено ${game.api.payoutFor(17)}`);
  check(game.api.payoutFor(0) === 0, 'на зеро зеркальная ставка возвращает ноль');

  const start = game.window.Casino.getBalance() + 200; // до ставок
  game.api.forceNumber(17);
  await game.api.spin();
  await sleep(5);
  check(game.window.Casino.getBalance() === start, 'зеркальная ставка на 17 вернула ставку');
  game.api.clearBets();

  game.api.placeBet('red', 100);
  game.api.placeBet('black', 100);
  game.api.forceNumber(0);
  await game.api.spin();
  await sleep(5);
  check(game.window.Casino.getBalance() === start - 200, 'на зеро зеркальная ставка теряет всё');

  // Все 37 чисел: минус фишка при любом исходе.
  const all = boot();
  all.api.setTiming({ spin: 1, settle: 1 });
  all.window.Casino.setBalance(5000);
  for (let n = 0; n <= 36; n++) all.api.placeBet(`straight:${n}`, 25);
  check(all.api.totalBet() === 925, `все числа по 25 = 925 ₽, получено ${all.api.totalBet()}`);
  const allHint = all.doc.querySelector('#betHint');
  check(!allHint.hidden && allHint.textContent.includes('925') && allHint.textContent.includes('900'),
    `стол предупреждает о гарантированном минусе, получено: ${allHint.textContent}`);
  const allStart = all.window.Casino.getBalance() + 925; // до ставок
  all.api.forceNumber(7);
  await all.api.spin();
  await sleep(5);
  check(all.window.Casino.getBalance() === allStart - 25, 'все числа по 25 дают −25 ₽');

  // Лимит стола: больше 2 500 ₽ на спин поставить нельзя.
  const limit = boot();
  limit.window.Casino.setBalance(10000);
  limit.api.placeBet('red', 2500);
  check(limit.api.totalBet() === 2500, 'ставка на лимит принята');
  check(limit.api.placeBet('black', 25) === false, 'ставка сверх лимита отклонена');
  check(limit.api.totalBet() === 2500, 'сумма не превысила лимит');
  check(limit.doc.querySelector('#betTotal').classList.contains('full'), 'лимит подсвечен на столе');
}

// ---------- Сброс игры ----------
console.log('• Сброс рулетки');
doc.querySelector('#statsBtn').click();
check(doc.querySelector('#modalBody').textContent.includes('Статистика рулетки'), 'статистика открывается');
doc.querySelector('[data-action="reset"]').click();
check(window.Casino.stats('roulette').spins === 0, 'сброс обнулил спины');
check(window.Casino.history('roulette').length === 0, 'сброс обнулил историю рулетки');
check(doc.querySelectorAll('#spinsList .spin-row').length === 0, 'сброс очистил ленту спинов');
check(balance() > 0, 'сброс не тронул общий баланс');

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
