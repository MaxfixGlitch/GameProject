import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawHub = fs.readFileSync(`${root}shared/hub.js`, 'utf8');
const hubHtml = fs.readFileSync(`${root}index.html`, 'utf8')
  .replace('<script src="shared/casino.js"></script>', '')
  .replace('<script src="shared/hub.js"></script>', '');
const bjHtml = fs.readFileSync(`${root}games/blackjack/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="game.js"></script>', '');
const rlHtml = fs.readFileSync(`${root}games/roulette/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="roulette.js"></script>', '');
const rawBlackjack = fs.readFileSync(`${root}games/blackjack/game.js`, 'utf8')
  .replace('  // ---------- Старт ----------', '  window.__BJ__ = { state };' + String.fromCharCode(10) + '  // ---------- Старт ----------');
const rawRoulette = fs.readFileSync(`${root}games/roulette/roulette.js`, 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

const KEYS = ['casino.wallet.v1', 'casino.history.v1', 'casino.stats.v1', 'casino.pending.v1', 'casino.sound.v1', 'bj21.save.v1'];

function open(pageHtml, scripts, seed) {
  const dom = new JSDOM(pageHtml, { url: 'https://example.org/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const store = dom.window.localStorage;
  if (seed && seed.localStorage) {
    KEYS.forEach((key) => {
      const value = seed.localStorage.getItem(key);
      if (value !== null) store.setItem(key, value);
    });
  } else if (seed) {
    Object.entries(seed).forEach(([key, value]) => store.setItem(key, value));
  }
  scripts.forEach((code) => dom.window.eval(code));
  return dom.window;
}

// ---------- Чистая установка ----------
console.log('• Чистая установка');
let win = open(hubHtml, [rawCasino, rawHub], {});
check(win.Casino.getBalance() === 1000, `стартовый баланс 1000, получено ${win.Casino.getBalance()}`);
check(win.Casino.stats('blackjack').rounds === 0, 'статистика блэкджека пуста');
check(win.Casino.stats('roulette').spins === 0, 'статистика рулетки пуста');
check(win.Casino.allHistory().length === 0, 'история пуста');

const cards = [...win.document.querySelectorAll('.game-card')];
check(cards.length === 4, `на хабе 4 карточки (2 игры + 2 «скоро»)`, );
check(cards.filter((c) => c.classList.contains('live')).length === 2, 'две играбельные игры');
check(win.document.querySelector('[href="games/blackjack/index.html"]'), 'ссылка на блэкджек');
check(win.document.querySelector('[href="games/roulette/index.html"]'), 'ссылка на рулетку');
check(win.document.querySelector('#bankroll').textContent.replace(/\s/g, '').includes('1000'), 'баланс на хабе');
check(win.document.querySelector('#historyBtn'), 'кнопка истории на хабе');

// ---------- Подписи ставок ----------
console.log('• Подписи ставок');
check(win.Casino.rouletteBetLabel('straight:0') === '0', 'ставка на число читается как число');
check(win.Casino.rouletteBetLabel('red') === 'КРАСНОЕ', 'красное');
check(win.Casino.rouletteBetLabel('odd') === 'НЕЧЁТ', 'нечёт');
check(win.Casino.rouletteBetLabel('low') === '1–18', 'половина');
check(win.Casino.rouletteBetLabel('dozen:3') === '25–36', 'третья дюжина');
check(win.Casino.rouletteBetLabel('column:2') === 'колонка 2', 'колонка');

// ---------- Кошелёк ----------
console.log('• Общий кошелёк');
win.Casino.stake('roulette', 300);
check(win.Casino.getBalance() === 700, 'ставка уходит с баланса');
win.Casino.payout('roulette', 900);
check(win.Casino.getBalance() === 1600, 'выплата возвращается на баланс');
win.Casino.setBalance(-50);
check(win.Casino.getBalance() === 0, 'баланс не уходит в минус');

// Незавершённые раунды: ставка возвращается один раз
win.Casino.setBalance(1000);
win.Casino.stake('blackjack', 100);
win.Casino.setPending('blackjack', 100);
check(win.Casino.getBalance() === 900, 'ставка списана, но помечена как незавершённая');
win.Casino.settleAllPending();
check(win.Casino.getBalance() === 1000, 'закрытие вкладки вернуло ставку');
win.Casino.settleAllPending();
check(win.Casino.getBalance() === 1000, 'повторный возврат не начисляет деньги дважды');

// ---------- История по играм ----------
console.log('• История и статистика по играм');
const w = open(hubHtml, [rawCasino, rawHub], {});
w.Casino.pushHistory('blackjack', {
  ts: 1000, bet: 100, net: -100, summary: 'Дилер 20 · ваши: 18',
  hands: [], dealerTotal: 20,
});
w.Casino.pushHistory('roulette', {
  ts: 2000, bet: 50, net: 300, number: 17, summary: 'Выпало 17 (чёрное)',
});
w.Casino.pushHistory('blackjack', {
  ts: 3000, bet: 200, net: 250, summary: 'Блэкджек у дилера · ваши: 21',
  hands: [], dealerTotal: 17,
});

check(w.Casino.history('blackjack').length === 2, 'у блэкджека своя история');
check(w.Casino.history('roulette').length === 1, 'у рулетки своя история');
const merged = w.Casino.allHistory();
check(merged.length === 3, `общая история склеивает игры, получено ${merged.length}`);
check(merged[0].ts === 3000 && merged[1].ts === 2000 && merged[2].ts === 1000, 'общая история отсортирована по времени');
check(merged.every((entry) => entry.game), 'в общей истории указана игра');
check(w.Casino.allHistory('roulette').length === 1, 'фильтр по игре работает');
check(w.Casino.allHistory('blackjack').length === 2, 'фильтр по блэкджеку');

// Статистика не пересекается
w.Casino.stats('blackjack').rounds = 5;
w.Casino.stats('blackjack').net = 500;
check(w.Casino.stats('roulette').spins === 0, 'статистика рулетки не изменилась');
check(w.Casino.stats('roulette').net === 0, 'итог рулетки отдельно');

// ---------- Общий баланс между страницами ----------
console.log('• Баланс общий для всех игр');
w.Casino.save();
const rouletteWindow = open(rlHtml, [rawCasino, rawRoulette], w);
check(rouletteWindow.Casino.getBalance() === w.Casino.getBalance(), 'рулетка видит тот же баланс');
check(rouletteWindow.Casino.history('blackjack').length === 2, 'рулетка видит историю блэкджека');
const blackjackWindow = open(bjHtml, [rawCasino, rawBlackjack], w);
check(blackjackWindow.Casino.getBalance() === w.Casino.getBalance(), 'блэкджек видит тот же баланс');

// ---------- Миграция старого сохранения ----------
console.log('• Миграция сохранения прошлой версии');
const legacy = open(hubHtml, [rawCasino, rawHub], {
  'bj21.save.v1': JSON.stringify({
    bankroll: 750,
    pending: 100,
    sound: false,
    stats: { rounds: 12, wins: 5, losses: 6, pushes: 1, blackjacks: 2, wagered: 1200, bestWin: 300, net: -150 },
    history: [{ n: 12, bet: 100, net: -100, dealerTotal: 20, dealerCards: 2, hands: [] }],
  }),
});
check(legacy.Casino.getBalance() === 850, `баланс мигрирован с возвратом ставки: ${legacy.Casino.getBalance()}`);
check(legacy.Casino.stats('blackjack').rounds === 12, 'статистика блэкджека перенесена');
check(legacy.Casino.history('blackjack').length === 1, 'история блэкджека перенесена');
check(legacy.Casino.getSound() === false, 'настройка звука перенесена');
check(legacy.localStorage.getItem('bj21.save.v1') === null, 'старый ключ удалён после миграции');
check(legacy.Casino.stats('roulette').spins === 0, 'рулетка в миграции стартует с нуля');

// ---------- Сброс ----------
console.log('• Сброс');
legacy.Casino.resetAll();
check(legacy.Casino.getBalance() === 1000, 'сброс вернул 1000');
check(legacy.Casino.history('blackjack').length === 0, 'сброс очистил историю блэкджека');
check(legacy.Casino.stats('blackjack').rounds === 0, 'сброс очистил статистику');

// ---------- Хаб: история и фильтры ----------
console.log('• Окно истории на хабе');
const hub = open(hubHtml, [rawCasino, rawHub], {});
hub.Casino.pushHistory('blackjack', { ts: 5000, bet: 100, net: -100, summary: 'Дилер 20 · ваши: 18' });
// Старая запись без подробностей должна читаться как раньше.
hub.Casino.pushHistory('roulette', { ts: 6000, bet: 50, net: 300, summary: 'Выпало 17 (чёрное)' });
// Новая запись: видно, что было выбрано и что выиграло.
hub.Casino.pushHistory('roulette', {
  ts: 7000,
  bet: 175,
  net: 3475,
  payout: 3650,
  number: 17,
  color: 'black',
  bets: { 'straight:17': 100, red: 50, odd: 25 },
  wins: ['straight:17', 'odd'],
  summary: 'Выпало 17 · чёрное',
});
hub.Casino.save();
hub.document.querySelector('#historyBtn').click();
check(!hub.document.querySelector('#overlay').hidden, 'история открывается');
check(hub.document.querySelectorAll('.history-round').length === 3, 'видны обе игры и все записи');
check(hub.document.querySelectorAll('[data-filter]').length === 3, 'фильтры: все + две игры');
hub.document.querySelector('[data-filter="roulette"]').click();
check(hub.document.querySelectorAll('.history-round').length === 2, 'фильтр оставил записи рулетки');
check(hub.document.querySelector('.history-round-summary').textContent.includes('17'),
  'в карточке описание рулетки');

// Ставки в истории: выигравшие — в зелёной рамке.
const hubTags = [...hub.document.querySelectorAll('.bet-tag')];
check(hubTags.length === 3, `в карточке все три ставки, получено ${hubTags.length}`);
const hubWon = hubTags
  .filter((tag) => tag.classList.contains('is-win'))
  .map((tag) => tag.querySelector('.bet-tag-label').textContent);
check(hubWon.length === 2 && hubWon.includes('17') && hubWon.includes('НЕЧЁТ'),
  `на хабе выиграли число и нечёт, получено: ${hubWon.join(', ')}`);
check(!hubWon.includes('КРАСНОЕ'), 'проигравшее красное на хабе без рамки');
check(hub.document.querySelector('.history-round-payout').textContent.replace(/\s/g, '').includes('3650'),
  'на хабе показана выплата');
// Старая запись без ставок не ломает карточку.
check(hub.document.querySelectorAll('.history-round')[1].querySelectorAll('.bet-tag').length === 0,
  'запись без подробностей рисуется без ставок');

hub.document.querySelector('[data-filter="all"]').click();
check(hub.document.querySelectorAll('.history-round').length === 3, 'фильтр «все» вернул все записи');
hub.document.querySelector('#modalClose').click();
check(hub.document.querySelector('#overlay').hidden, 'история закрывается');

// ---------- Хаб: карточки со статистикой ----------
console.log('• Карточки игр');
// Статистика засевается до загрузки страницы: карточки рисуются при старте.
const board = open(hubHtml, [rawCasino, rawHub], {
  'casino.stats.v1': JSON.stringify({ roulette: { spins: 7, net: -350 } }),
});
const rouletteCard = [...board.document.querySelectorAll('.game-card')]
  .find((card) => card.getAttribute('href') === 'games/roulette/index.html');
check(rouletteCard.textContent.includes('7'), 'на карточке рулетки число спинов');
check(rouletteCard.textContent.includes('−350'), 'на карточке рулетки итог со знаком минус');

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
