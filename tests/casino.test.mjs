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
const wheelHtml = fs.readFileSync(`${root}games/wheel/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="wheel.js"></script>', '');
const rawWheel = fs.readFileSync(`${root}games/wheel/wheel.js`, 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

const KEYS = ['casino.wallet.v1', 'casino.history.v1', 'casino.stats.v1', 'casino.pending.v1',
  'casino.sound.v1', 'casino.progress.v1', 'casino.topup.v1', 'casino.mini.v1', 'bj21.save.v1'];

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
check(cards.length === 9, `на хабе 9 карточек, получено ${cards.length}`);
check(cards.filter((c) => c.classList.contains('live')).length === 9, 'девять играбельных игр');
check(cards.every((card) => card.classList.contains('live')), 'заглушек «скоро» не осталось');
check(win.document.querySelector('[href="games/blackjack/index.html"]'), 'ссылка на блэкджек');
check(win.document.querySelector('[href="games/roulette/index.html"]'), 'ссылка на рулетку');
check(win.document.querySelector('[href="games/dice/index.html"]'), 'ссылка на кости');
check(win.document.querySelector('[href="games/baccarat/index.html"]'), 'ссылка на баккару');
const slotsCard = win.document.querySelector('.game-card[href="games/slots/index.html"]');
check(!!slotsCard, 'на хабе есть карточка слотов');
check(slotsCard.textContent.includes('Слоты'), 'карточка слотов подписана');
check(slotsCard.querySelector('img').getAttribute('src') === 'shared/brand/icons/slots.png', 'у слотов своя иконка');
const wheelCard = win.document.querySelector('.game-card[href="games/wheel/index.html"]');
check(!!wheelCard, 'на хабе есть карточка колеса');
check(wheelCard.textContent.includes('Колесо'), 'карточка колеса подписана');
check(wheelCard.querySelector('img').getAttribute('src') === 'shared/brand/icons/wheel.png', 'у колеса своя иконка');
const plinkoCard = win.document.querySelector('.game-card[href="games/plinko/index.html"]');
check(!!plinkoCard, 'на хабе есть карточка плинко');
check(plinkoCard.textContent.includes('Плинко'), 'карточка плинко подписана');
check(plinkoCard.querySelector('img').getAttribute('src') === 'shared/brand/icons/plinko.png', 'у плинко своя иконка');
check(fs.existsSync(`${root}shared/brand/icons/plinko.png`), 'файл иконки плинко на месте');
const minesCard = win.document.querySelector('.game-card[href="games/mines/index.html"]');
check(!!minesCard, 'на хабе есть карточка сапёра');
check(minesCard.textContent.includes('Сапёр'), 'карточка сапёра подписана');
check(minesCard.querySelector('img').getAttribute('src') === 'shared/brand/icons/mines.png', 'у сапёра своя иконка');
check(fs.existsSync(`${root}shared/brand/icons/mines.png`), 'файл иконки сапёра на месте');
check(win.document.querySelector('#bankroll').textContent.replace(/\s/g, '').includes('1000'), 'баланс на хабе');
check(win.document.querySelector('#historyBtn'), 'кнопка истории на хабе');

// Мини-игра: запасной фарм живёт в окне пополнения, а не лентой на хабе.
check(!win.document.querySelector('.mini-strip'), 'ленты мини-игры на хабе больше нет');
check(!win.document.querySelector('.game-card[href="games/flappy/index.html"]'), 'мини-игра не попадает в сетку ставок');
win.document.querySelector('#topUpBtn').click();
check(!win.document.querySelector('#overlay').hidden, 'окно пополнения открывается');
const depositMini = win.document.querySelector('.deposit-mini');
check(!!depositMini, 'в окне пополнения есть блок мини-игры');
check(!!depositMini.querySelector('[href="games/flappy/index.html"]'), 'ссылка на «Летящую фишку»');
check(depositMini.textContent.includes('3 / 3'), 'в блоке видны три полёта');
const miniCopy = depositMini.textContent.replace(/\s+/g, ' ');
check(miniCopy.includes('Если баланс на нуле'), 'у блока понятный заголовок');
check(miniCopy.includes('1 ₽'), 'в блоке сказано, сколько даёт труба');
check(miniCopy.includes('3 минуты'), 'в блоке сказано про перезарядку');
win.document.querySelector('#modalClose').click();
win.Casino.mini.set('flappy', { best: 12, total: 34, attempts: 1 });
win.Casino.resetAll();
win.document.querySelector('#topUpBtn').click();
const miniText = win.document.querySelector('.deposit-mini').textContent.replace(/\s+/g, ' ');
check(!miniText.includes('12'), 'сброс казино обнулил рекорд мини-игры');
check(miniText.includes('3 / 3'), 'сброс казино вернул три полёта');
win.document.querySelector('#modalClose').click();

// ---------- Подписи ставок ----------
console.log('• Подписи ставок');
check(win.Casino.rouletteBetLabel('straight:0') === '0', 'ставка на число читается как число');
check(win.Casino.rouletteBetLabel('red') === 'КРАСНОЕ', 'красное');
check(win.Casino.rouletteBetLabel('odd') === 'НЕЧЁТ', 'нечёт');
check(win.Casino.rouletteBetLabel('low') === '1–18', 'половина');
check(win.Casino.rouletteBetLabel('dozen:3') === '25–36', 'третья дюжина');
check(win.Casino.diceBetLabel('sum:7') === 'сумма 7', 'ставка на сумму костей');
check(win.Casino.diceBetLabel('pair:4') === 'дубль 4–4', 'ставка на точный дубль');
check(win.Casino.diceBetLabel('double') === 'ЛЮБОЙ ДУБЛЬ', 'ставка на любой дубль');
check(win.Casino.diceBetLabel('over') === 'БОЛЬШЕ 7', 'ставка «больше 7»');
check(win.Casino.betLabel('sum:9') === 'сумма 9', 'общая подпись понимает кости');
check(win.Casino.betLabel('straight:17') === '17', 'общая подпись понимает рулетку');
check(win.Casino.baccaratBetLabel('player') === 'ИГРОК', 'ставка на игрока');
check(win.Casino.baccaratBetLabel('banker') === 'БАНКИР', 'ставка на банкира');
check(win.Casino.baccaratBetLabel('tie') === 'НИЧЬЯ', 'ставка на ничью');
check(win.Casino.betLabel('banker') === 'БАНКИР', 'общая подпись понимает баккару');
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
hub.Casino.pushHistory('blackjack', { ts: 5000, bet: 100, net: -100, insurance: 50, summary: 'Дилер 20 · ваши: 18' });
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
check(hub.document.querySelectorAll('[data-filter]').length === 10, 'фильтры: все + девять игр');
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
// Все записи в истории начинаются с собственного времени.
hub.document.querySelector('[data-filter="all"]').click();
const hubTimes = [...hub.document.querySelectorAll('.history-round .round-time')];
check(hubTimes.length === 3, `у каждой записи своё время, найдено ${hubTimes.length}`);
check(hubTimes.every((node) => node.textContent.trim().length > 0), 'время на хабе заполнено');
// Сработавшая страховка видна и в общей истории: значок щита и сумма возврата.
const hubIns = hub.document.querySelector('.ins-tag');
check(!!hubIns && hubIns.textContent.includes('50'), 'на хабе видна страховка в истории');
check(hubIns.querySelector('img').getAttribute('src') === 'shared/brand/icons/shield.png',
  'на хабе у значка страховки верный путь к иконке');
hub.document.querySelector('[data-filter="roulette"]').click();
// Старая запись без ставок не ломает карточку.
check(hub.document.querySelectorAll('.history-round')[1].querySelectorAll('.bet-tag').length === 0,
  'запись без подробностей рисуется без ставок');

hub.document.querySelector('[data-filter="all"]').click();
check(hub.document.querySelectorAll('.history-round').length === 3, 'фильтр «все» вернул все записи');
hub.document.querySelector('#modalClose').click();
check(hub.document.querySelector('#overlay').hidden, 'история закрывается');

// ---------- Бонус раз в 30 минут ----------
console.log('• Бонус и кулдаун');
{
  // Часы двигаем вручную, иначе ждать полчаса.
  const clockDom = new JSDOM(hubHtml, {
    url: 'https://example.org/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  let clock = Date.now();
  clockDom.window.Date.now = () => clock;
  clockDom.window.eval(rawCasino);
  clockDom.window.eval(rawHub);
  const bonus = clockDom.window.Casino;

  const first = bonus.getTopUp();
  check(first.ready === true, 'первый бонус доступен сразу');
  check(first.amount === 1000, 'бонус — 1 000 ₽');
  check(first.cooldown === 30 * 60 * 1000, 'кулдаун 30 минут');

  const claim = bonus.claimTopUp();
  check(claim.ok === true, 'бонус получен');
  check(bonus.getBalance() === 2000, `баланс вырос до 2 000, получено ${bonus.getBalance()}`);
  check(bonus.getTopUp().ready === false, 'сразу второй бонус недоступен');
  check(Math.round(bonus.getTopUp().remaining / 60000) === 30, 'после получения ждать 30 минут');

  const tooEarly = bonus.claimTopUp();
  check(tooEarly.ok === false, 'повторный бонус отклонён');
  check(bonus.getBalance() === 2000, 'баланс не изменился');

  clock += 10 * 60 * 1000;
  check(Math.round(bonus.getTopUp().remaining / 60000) === 20, 'через 10 минут остаётся 20');

  clock += 21 * 60 * 1000;
  check(bonus.getTopUp().ready === true, 'через 31 минуту бонус снова доступен');
  check(bonus.claimTopUp().ok === true, 'второй бонус получен');

  // Часы назад не сокращают ожидание.
  clock -= 60 * 60 * 1000;
  check(bonus.getTopUp().remaining >= 30 * 60 * 1000, 'перевод часов назад не ускоряет бонус');

  // Кулдаун переживает перезагрузку: localStorage + cookie.
  bonus.save();
  const reload = new JSDOM(hubHtml, {
    url: 'https://example.org/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  reload.window.Date.now = () => clock;
  ['casino.wallet.v1', 'casino.progress.v1', 'casino.topup.v1'].forEach((key) => {
    reload.window.localStorage.setItem(key, clockDom.window.localStorage.getItem(key));
  });
  reload.window.document.cookie = clockDom.window.document.cookie;
  reload.window.eval(rawCasino);
  check(reload.window.Casino.getTopUp().ready === false, 'после перезагрузки кулдаун сохраняется');

  // Очистка localStorage не сбрасывает таймер: остаётся cookie.
  const cookieOnly = new JSDOM(hubHtml, {
    url: 'https://example.org/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  cookieOnly.window.Date.now = () => clock;
  cookieOnly.window.document.cookie = clockDom.window.document.cookie;
  cookieOnly.window.eval(rawCasino);
  check(cookieOnly.window.Casino.getTopUp().ready === false,
    'без localStorage кулдаун читается из cookie');
}

// ---------- Окно пополнения ----------
console.log('• Пополнение: способы оплаты и бонус');
{
  const shop = open(hubHtml, [rawCasino, rawHub], {});
  const doc = shop.document;
  const topUpBtn = doc.querySelector('#topUpBtn');

  check(topUpBtn.textContent.includes('Пополнить баланс'), 'кнопка называется «Пополнить баланс»');
  check(topUpBtn.disabled === false, 'кнопка пополнения всегда доступна');
  check(topUpBtn.classList.contains('has-bonus'), 'на кнопке точка: бонус доступен');

  topUpBtn.click();
  check(!doc.querySelector('#overlay').hidden, 'окно пополнения открывается');
  check(doc.querySelector('#modalBody h2').textContent.includes('Пополнить баланс'), 'заголовок окна');

  const methods = [...doc.querySelectorAll('.pay-method')];
  check(methods.length === 6, `шесть способов оплаты, получено ${methods.length}`);
  const names = methods.map((m) => m.querySelector('b').textContent);
  ['СБП', 'СберБанк', 'Т-Банк', 'Альфа-Банк', 'ЮMoney', 'Банковская карта'].forEach((name) => {
    check(names.includes(name), `есть способ «${name}»`);
  });
  check(!names.some((name) => name.toLowerCase().includes('мобильный')),
    'мобильного платежа нет');
  check(methods.every((m) => m.querySelector('.pay-icon img, .pay-icon svg')),
    'у каждого способа настоящий логотип, а не эмодзи');
  check(doc.querySelector('.deposit-disclaimer').textContent.toLowerCase().includes('реальные деньги не принимаются'),
    'в окне честно сказано, что деньги не принимаются');

  // Любой способ оплаты отвечает, что он недоступен.
  const answer = doc.querySelector('#payAnswer');
  check(answer.hidden, 'сначала ответа нет');
  doc.querySelector('[data-pay="sbp"]').click();
  check(!answer.hidden, 'после клика появился ответ');
  check(answer.textContent.includes('СБП'), 'в ответе назван выбранный способ');
  check(answer.textContent.includes('недоступен'), 'в ответе сказано, что способ недоступен');
  check(answer.textContent.includes('бонус'), 'ответ отправляет к бесплатному бонусу');
  check(!answer.textContent.includes('демо-казино'), 'фразы про демо-казино в ответе нет');
  check(doc.querySelector('[data-pay="sbp"]').classList.contains('shake'), 'плитка дрогнула');

  doc.querySelector('[data-pay="card"]').click();
  check(answer.textContent.includes('Банковская карта'), 'ответ обновился на новый способ');
  check(!doc.querySelector('[data-pay="sbp"]').classList.contains('shake'), 'старая плитка сброшена');

  // Бонус живёт в том же окне.
  const bonusBlock = doc.querySelector('#depositBonus');
  check(bonusBlock !== null, 'внизу окна блок бонуса');
  check(bonusBlock.classList.contains('ready'), 'бонус помечен доступным');
  const claim = doc.querySelector('#claimBonusBtn');
  check(claim.textContent.includes('Забрать'), 'кнопка предлагает забрать бонус');

  claim.click();
  check(shop.Casino.getBalance() === 2000, `бонус зачислен: 2 000, получено ${shop.Casino.getBalance()}`);
  check(claim.disabled, 'после получения кнопка заблокирована');
  check(claim.textContent.includes('Бонус через'), 'на кнопке обратный отсчёт');
  check(answer.textContent.includes('зачислено'), 'в окне подтверждение зачисления');
  check(!topUpBtn.classList.contains('has-bonus'), 'точка на кнопке погасла');

  // Кнопка бонуса и кнопка пополнения — разные вещи.
  check(doc.querySelectorAll('.pay-method.tried').length === 1, 'помечен только один способ');

  doc.querySelector('#modalClose').click();
  check(doc.querySelector('#overlay').hidden, 'окно пополнения закрывается');
  topUpBtn.click();
  check(!doc.querySelector('#overlay').hidden, 'окно открывается снова');
  check(doc.querySelector('#claimBonusBtn').disabled, 'после перезагрузки окна бонус всё ещё на кулдауне');
  doc.querySelector('#modalClose').click();
}

// ---------- Цели и звания ----------
console.log('• Цели, звания и бонусы');
{
  const win = open(hubHtml, [rawCasino, rawHub], {});
  const profile = win.Casino.profile();
  check(profile.title === 'Новичок', 'стартовое звание — Новичок');
  check(profile.shields === 0, 'страховок пока нет');
  check(profile.maxBet === 2500, 'лимит стола 2 500 ₽');
  check(profile.bestNet === 0, 'рекорд выигрыша в профиле начинается с нуля');
  check(profile.goals.length === 8, 'восемь целей — по числу званий');
  check(profile.goals[0].target === 2000, 'первая цель — 2 000 ₽');
  check(profile.goals[0].title === 'Фиш', 'первое звание — Фиш');
  check(profile.goals[7].title === 'Барон удачи', 'последнее звание — Барон удачи');
  check(profile.goals.every((g) => !g.claimed), 'ни одна цель ещё не достигнута');

  // Чистый выигрыш 12 000 ₽ закрывает первые три цели.
  win.Casino.stats('roulette').net = 12000;
  const reached = win.Casino.checkGoals();
  check(reached.length === 3, `закрылись три цели, получено ${reached.length}`);
  check(win.Casino.getBalance() === 1000 + 200 + 500 + 1200,
    `награда 1 900 ₽ на балансе, получено ${win.Casino.getBalance()}`);
  check(win.Casino.goalTitle() === 'Лудоман', 'звание сменилось на Лудоман');
  check(win.Casino.shields() === 3, 'три страховки за три цели');
  check(win.Casino.maxBet() === 5500, `лимит вырос до 5 500, получено ${win.Casino.maxBet()}`);
  check(win.Casino.checkGoals().length === 0, 'повторно цели не начисляются');
  check(win.Casino.profile().bestNet === 12000, `в профиле рекорд 12 000, получено ${win.Casino.profile().bestNet}`);

  const goals = win.Casino.goals();
  check(goals[0].claimed && goals[1].claimed && goals[2].claimed, 'первые три цели отмечены полученными');
  check(goals[3].progress === 12000, 'у следующей цели виден прогресс');

  check(win.Casino.takeGoalNotices().length === 3, 'уведомления о целях созданы');
  check(win.Casino.takeGoalNotices().length === 0, 'уведомления выдаются один раз');

  check(win.Casino.useShield() === true, 'страховка тратится');
  check(win.Casino.shields() === 2, 'осталось две страховки');

  // Экран целей показывает прогресс и звание.
  win.document.querySelector('#goalsBtn').click();
  check(!win.document.querySelector('#overlay').hidden, 'окно целей открывается');
  // Будущие цели скрыты: видно только полученные и одну следующую.
  check(win.document.querySelectorAll('.goal-card').length === 4,
    `в окне три полученные и одна следующая цель, получено ${win.document.querySelectorAll('.goal-card').length}`);
  check(win.document.querySelectorAll('.goal-card.claimed').length === 3, 'три цели отмечены выполненными');
  check(win.document.querySelectorAll('.goal-card.current').length === 1, 'следующая цель подсвечена');
  const goalText = win.document.querySelector('.goal-list').textContent.replace(/\s+/g, ' ');
  check(goalText.includes('25 000'), 'следующая цель — 25 000 ₽');
  check(goalText.includes('Отбивала'), 'у следующей цели видно её звание');
  check(!goalText.includes('Кэшаут-мастер'), 'названия будущих целей скрыты');
  check(!goalText.includes('400 000'), 'условия дальних целей не видны');
  check(!!win.document.querySelector('.goals-veiled'), 'есть подсказка, что цели ещё будут');
  check(win.document.querySelector('.title-chip.big').textContent.includes('Лудоман'),
    'в окне видно звание');
  win.document.querySelector('#modalClose').click();

  // Сброс обнуляет цели, но не кулдаун бонуса.
  win.Casino.resetAll();
  check(win.Casino.goalTitle() === 'Новичок', 'сброс вернул звание Новичок');
  check(win.Casino.shields() === 0, 'сброс убрал страховки');
  check(win.Casino.maxBet() === 2500, 'сброс вернул лимит 2 500 ₽');

  // После сброса игрок видит только первую цель.
  win.document.querySelector('#goalsBtn').click();
  check(win.document.querySelectorAll('.goal-card').length === 1, 'новичку видна только первая цель');
  check(win.document.querySelector('.goal-card.current .goal-target').textContent.replace(/\s+/g, ' ').includes('2 000'),
    'это цель на 2 000 ₽');
  win.document.querySelector('#modalClose').click();
}

// ---------- Хаб: карточки со статистикой ----------
console.log('• Горячие клавиши при русской раскладке');
{
  const dom = open(hubHtml, [rawCasino, rawHub]);
  const Casino = dom.window.Casino;
  const keyOf = (event) => Casino.keyOf(event);

  // На русской раскладке event.key для клавиши C — «с», а физическая та же.
  check(keyOf({ key: 'с', code: 'KeyC' }) === 'c', 'C на русской раскладке — это c');
  check(keyOf({ key: 'р', code: 'KeyH' }) === 'h', 'H на русской раскладке — это h');
  check(keyOf({ key: 'я', code: 'KeyZ' }) === 'z', 'Z на русской раскладке — это z');
  check(keyOf({ key: ' ', code: 'Space' }) === ' ', 'пробел определяется по code');
  check(keyOf({ key: 'Enter', code: 'NumpadEnter' }) === 'enter', 'Enter с цифрового блока');
  check(keyOf({ key: 'Escape' }) === 'escape', 'Escape без code тоже работает');
  check(keyOf({ key: 'H' }) === 'h', 'заглавная буква без code приводится к строчной');
  check(keyOf({ key: 'ArrowDown' }) === 'arrowdown', 'стрелки распознаются');
  check(keyOf({ key: 'с' }) === 'с', 'если code нет, остаётся исходный символ');
  check(keyOf(null) === '', 'пустое событие не ломает обработчик');
}

console.log('• Общая статистика');
{
  const statsHub = open(hubHtml, [rawCasino, rawHub], {});
  statsHub.document.querySelector('#statsBtn').click();
  check(!statsHub.document.querySelector('#overlay').hidden, 'статистика открывается');
  check(statsHub.document.querySelectorAll('.stat-game').length === 9, 'в статистике девять игр');
  check(statsHub.document.querySelectorAll('.stat-sep:not(.total)').length === 8,
    'между играми восемь разделительных черт');
  check(statsHub.document.querySelectorAll('.stat-sep.total').length === 1, 'перед итогами отдельная черта');
  const text = statsHub.document.querySelector('.stat-grid').textContent.replace(/\s+/g, ' ');
  check(text.includes('0 спинов') && text.includes('0 раундов') && text.includes('0 бросков')
    && text.includes('0 раздач') && text.includes('0 дропов') && text.includes('0 заходов'),
    'счётчики игр склоняются верно');
  statsHub.document.querySelector('#modalClose').click();
}

console.log('• Карточки игр');
// Статистика засевается до загрузки страницы: карточки рисуются при старте.
const board = open(hubHtml, [rawCasino, rawHub], {
  'casino.stats.v1': JSON.stringify({
    roulette: { spins: 7, net: -350 },
    baccarat: { rounds: 2, net: -10 },
  }),
});
const rouletteCard = [...board.document.querySelectorAll('.game-card')]
  .find((card) => card.getAttribute('href') === 'games/roulette/index.html');
check(rouletteCard.textContent.includes('7'), 'на карточке рулетки число спинов');
check(rouletteCard.textContent.includes('−350'), 'на карточке рулетки итог со знаком минус');
check(rouletteCard.textContent.includes('спинов'), 'счётчик склоняется: 7 спинов');

const diceCard = [...board.document.querySelectorAll('.game-card')]
  .find((card) => card.getAttribute('href') === 'games/dice/index.html');
check(!!diceCard, 'на хабе есть карточка костей');
check(diceCard.textContent.includes('0 бросков'), 'на карточке костей подпись счётчика');
check(diceCard.classList.contains('live'), 'карточка костей играбельная, а не «скоро»');
check(![...board.document.querySelectorAll('.game-card.soon')]
  .some((card) => card.textContent.includes('Кости')), 'кости убраны из «скоро»');

const baccaratCard = [...board.document.querySelectorAll('.game-card')]
  .find((card) => card.getAttribute('href') === 'games/baccarat/index.html');
check(!!baccaratCard, 'на хабе есть карточка баккары');
check(baccaratCard.textContent.includes('2 раздачи'), `на карточке баккары счётчик склоняется: ${baccaratCard.textContent.replace(/\s+/g, ' ').trim()}`);
check(baccaratCard.classList.contains('live'), 'карточка баккары играбельная, а не «скоро»');
check(board.document.querySelectorAll('.game-card.soon').length === 0, '«скоро» на хабе больше нет');


console.log('• Открытие игр');
{
  const fresh = open(hubHtml, [rawCasino, rawHub], {});
  check(fresh.Casino.isUnlocked('blackjack'), 'блэкджек открыт всегда');
  check(fresh.Casino.isUnlocked('roulette'), 'рулетка открыта всегда');
  check(!fresh.Casino.isUnlocked('dice'), 'кости закрыты на старте');
  check(!fresh.Casino.isUnlocked('mines'), 'сапёр закрыт на старте');
  check(fresh.Casino.unlockThreshold('blackjack') === 0, 'у открытой игры порога нет');
  check(fresh.Casino.unlockThreshold('dice') === 1000, 'кости — 1 000 ₽');
  check(fresh.Casino.unlockThreshold('baccarat') === 1500, 'баккара — 1 500 ₽');
  check(fresh.Casino.unlockThreshold('slots') === 2500, 'слоты — 2 500 ₽');
  check(fresh.Casino.unlockThreshold('wheel') === 4000, 'колесо — 4 000 ₽');
  check(fresh.Casino.unlockThreshold('plinko') === 6000, 'плинко — 6 000 ₽');
  check(fresh.Casino.unlockThreshold('mines') === 9000, 'сапёр — 9 000 ₽');
  // Каждая следующая игра дороже примерно в полтора раза.
  const thresholds = fresh.Casino.unlockPlan().map((item) => item.threshold);
  check(thresholds.every((value, i) => i === 0 || value / thresholds[i - 1] >= 1.4),
    `пороги растут не меньше чем в 1,4 раза: ${thresholds.join(', ')}`);
  check(fresh.Casino.unlockPlan().map((item) => item.id).join(',') === 'dice,baccarat,slots,wheel,plinko,mines',
    'порядок открытия совпадает с порядком игр');
  check(fresh.Casino.unlockedCount() === 3, 'на старте открыто три игры');

  const lockedCards = [...fresh.document.querySelectorAll('.game-card.locked')];
  check(lockedCards.length === 6, `закрыто шесть карточек, получено ${lockedCards.length}`);
  check(fresh.document.querySelectorAll('.game-card.live').length === 9, 'карточки остаются на витрине');
  check(fresh.document.querySelector('.game-card.locked .game-card-blur'), 'у закрытой карточки блюр');
  check(fresh.document.querySelector('.game-card.locked .game-card-lock'), 'у закрытой карточки замок');
  check(!fresh.document.querySelector('.game-card[href="games/dice/index.html"] .game-card-lock') === false,
    'кости под замком');
  check(!fresh.document.querySelector('.game-card[href="games/roulette/index.html"] .game-card-lock'),
    'рулетка без замка');
  const strip = fresh.document.querySelector('#unlockStrip').textContent.replace(/\s+/g, ' ');
  check(strip.includes('3 из 9'), `в строке прогресса 3 из 9: ${strip}`);
  check(strip.includes('1 000 ₽'), 'в строке прогресса порог 1 000 ₽');

  // Клик по закрытой карточке не уводит на страницу, а объясняет правила.
  fresh.document.querySelector('.game-card[href="games/dice/index.html"]').click();
  check(!fresh.document.querySelector('#overlay').hidden, 'по клику открывается пояснение');
  check(fresh.document.querySelector('.modal-body').textContent.includes('Кости ещё закрыты'),
    'в пояснении название игры и форма слова');
  check(fresh.document.querySelector('.modal-body').textContent.includes('Порядок открытия'), 'виден порядок открытия');
  check(!!fresh.document.querySelector('[data-preview]'), 'в пояснении есть режим проверки');
  fresh.document.querySelector('#modalClose').click();
}

{
  // Чистый выигрыш 1 000 ₽ открывает кости, но не баккару.
  const one = open(hubHtml, [rawCasino, rawHub], {
    'casino.stats.v1': JSON.stringify({ roulette: { spins: 10, net: 1000 } }),
  });
  check(one.Casino.bestNet() === 1000, `планка 1 000 ₽, получено ${one.Casino.bestNet()}`);
  check(one.Casino.isUnlocked('dice'), 'кости открылись на 1 000 ₽');
  check(!one.Casino.isUnlocked('baccarat'), 'баккара ещё закрыта');
  check(one.document.querySelectorAll('.game-card.locked').length === 5, 'закрытых карточек пять');
  const strip = one.document.querySelector('#unlockStrip').textContent.replace(/\s+/g, ' ');
  check(strip.includes('4 из 9') && strip.includes('1 500 ₽'), `следующая цель 1 500 ₽: ${strip}`);

  // Проигрыш не закрывает уже открытую игру: планка только растёт.
  one.Casino.stats('roulette').net = -500;
  check(one.Casino.isUnlocked('dice'), 'после проигрыша кости остаются открытыми');
  check(one.Casino.bestNet() === 1000, 'планка не падает');

  // Бонус и пополнение в чистый выигрыш не входят.
  one.Casino.addBalance(5000);
  check(one.Casino.bestNet() === 1000, 'пополнение не открывает игры');
}

{
  // Всё открыто, когда набрано 6 000 ₽.
  const all = open(hubHtml, [rawCasino, rawHub], {
    'casino.progress.v1': JSON.stringify({ bestNet: 9000 }),
  });
  check(all.Casino.unlockedCount() === 9, 'открыты все девять игр');
  check(all.document.querySelectorAll('.game-card.locked').length === 0, 'блюра больше нет');
  const strip = all.document.querySelector('#unlockStrip').textContent.replace(/\s+/g, ' ');
  check(strip === '', `строка прогресса исчезла: ${strip}`);
  check(!all.document.body.textContent.includes('Блюр снят'), 'фразы «Блюр снят» больше нет');
}

{
  // Прямая ссылка на закрытую игру упирается в замок.
  const lockedPage = new JSDOM(wheelHtml, {
    url: 'https://example.org/games/wheel/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  lockedPage.window.eval(rawCasino);
  lockedPage.window.eval(rawWheel);
  check(!lockedPage.window.__WHEEL_TEST__, 'закрытая игра не запускается');
  const screen = lockedPage.window.document.querySelector('.locked-card');
  check(!!screen, 'вместо игры экран с замком');
  check(screen.textContent.includes('Колесо фортуны ещё закрыто'), 'на экране название игры');
  check(screen.textContent.replace(/\u00a0/g, ' ').includes('4 000 ₽'), 'на экране нужная сумма');
  check(!!lockedPage.window.document.querySelector('a[href="../../index.html"]'), 'есть путь назад к играм');
}

{
  // ?preview=1 в адресе снимает блюр: так игры можно проверять.
  const previewPage = new JSDOM(wheelHtml, {
    url: 'https://example.org/games/wheel/?preview=1',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  previewPage.window.eval(rawCasino);
  previewPage.window.eval(rawWheel);
  check(previewPage.window.Casino.previewMode(), 'режим проверки включён ссылкой');
  check(!!previewPage.window.__WHEEL_TEST__, 'в режиме проверки игра запускается');
  check(!previewPage.window.document.querySelector('.locked-card'), 'замка нет');
  check(previewPage.window.Casino.isUnlocked('mines'), 'в режиме проверки открыто всё');
}

{
  // Время в истории прижато к правому нижнему углу одной и той же плашкой.
  const css = fs.readFileSync(`${root}shared/hud.css`, 'utf8');
  const block = css.slice(css.indexOf('.round-time {'), css.indexOf('.round-time {') + 400);
  check(block.includes('position: absolute') && block.includes('right:') && block.includes('bottom:'),
    'плашка времени стоит в правом нижнем углу');
  check(block.includes('font-variant-numeric: tabular-nums'), 'цифры времени не дёргаются');
  const relativeAt = css.indexOf('.spin-card,\n.spin-row,\n.roll-row,\n.round-row,\n.history-round { position: relative; }');
  check(relativeAt !== -1, 'все виды карточек истории держат время в углу');

  // У блэкджека своя оболочка: общие мелочи шапки и истории он обязан брать тоже.
  const pages = ['index.html', ...fs.readdirSync(`${root}games`).map((dir) => `games/${dir}/index.html`)];
  pages.forEach((page) => {
    const html = fs.readFileSync(`${root}${page}`, 'utf8');
    check(html.includes('hud.css'), `${page}: подключены общие стили шапки и истории`);
  });
  check(css.includes('.modal-body .spin-history-full'), 'в окне истории прокручивается только окно');
  check(css.includes('flex: 0 0 auto;') && css.includes('width: 15px'),
    'значок страховок не раздувается в тесной шапке');

  // Статус цели и её звание стоят столбиком, а не разъезжаются по краям.
  const casinoCss = fs.readFileSync(`${root}shared/casino.css`, 'utf8');
  const meta = casinoCss.slice(casinoCss.indexOf('.goal-meta {'), casinoCss.indexOf('.goal-meta {') + 200);
  check(meta.includes('flex-direction: column'), 'в плашке цели звание всегда под статусом');
}

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
