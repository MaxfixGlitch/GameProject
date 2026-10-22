import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/flappy/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="flappy.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/flappy/flappy.js`, 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};

const CASINO_KEYS = ['casino.wallet.v1', 'casino.history.v1', 'casino.stats.v1', 'casino.pending.v1',
  'casino.sound.v1', 'casino.progress.v1', 'casino.topup.v1', 'casino.mini.v1'];

// Каждое окно jsdom — отдельный localStorage, поэтому «перезагрузку»
// эмулируем переносом ключей, как в остальных тестах.
function boot(seed) {
  // jsdom без пакета canvas ругается на getContext — для теста это шум.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    url: 'https://example.org/games/flappy/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    virtualConsole,
  });
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
  return { dom, window: dom.window, doc: dom.window.document, api: dom.window.__FLAPPY_TEST__ };
}

const balanceOf = (win) => win.Casino.getBalance();

/** Держит фишку в воздухе: взмахивает, когда она начинает падать. */
function fly(api, seconds, slice = 1 / 120) {
  let left = seconds;
  while (left > 0) {
    if (api.state.chipV > 40) api.flap();
    api.step(Math.min(slice, left));
    left -= slice;
    if (api.state.phase !== 'run') break;
  }
}

const { window: win, doc, api } = boot();

// ---------- Стартовый экран ----------
console.log('• Стартовый экран');
check(api.attemptsLeft === undefined, 'хук не отдаёт лишнего');
check(api.state.attempts === 3, `на старте 3 попытки, получено ${api.state.attempts}`);
check(api.state.phase === 'idle', 'игра ждёт старта');
check(doc.querySelector('#flapBtn').textContent === 'Играть', 'кнопка зовёт играть');
check(doc.querySelector('#flapAttempts').textContent === '3 / 3', 'счётчик попыток 3 / 3');
check(doc.querySelector('#flapBadge').textContent === '3 попытки', `бейдж склоняется: ${doc.querySelector('#flapBadge').textContent}`);
check(!doc.querySelector('#flapOverlay').classList.contains('hidden'), 'стартовый экран виден');
check(doc.querySelector('#flapHud').hidden, 'счёт на поле спрятан');
check(balanceOf(win) === 1000, 'баланс не тронут');

// ---------- Правила сложности ----------
console.log('• Сложность');
check(api.speedFor(0) === 185, `стартовая скорость 185, получено ${api.speedFor(0)}`);
check(api.speedFor(30) === api.speedFor(200), 'после 30 труб скорость упирается в предел');
check(api.speedFor(30) <= 335, `предел скорости 335, получено ${api.speedFor(30)}`);
check(api.gapFor(0) === 184, `стартовый проход 184, получено ${api.gapFor(0)}`);
check(api.gapFor(100) === 140, `минимальный проход 140, получено ${api.gapFor(100)}`);
check(api.COIN === 1, 'за трубу платят 1 ₽');
check(api.ATTEMPTS_MAX === 3 && api.COOLDOWN === 180000, '3 попытки и 3 минуты перезарядки');

// ---------- Старт полёта ----------
console.log('• Старт полёта');
doc.querySelector('#flapBtn').click();
check(api.state.phase === 'run', 'кнопка начала полёт');
check(api.state.attempts === 2, `попытка списана при старте, осталось ${api.state.attempts}`);
check(doc.querySelector('#flapOverlay').classList.contains('hidden'), 'стартовый экран скрылся');
check(!doc.querySelector('#flapHud').hidden, 'счёт на поле показан');
const startY = api.state.chipY;
check(startY > 0 && startY < api.H - api.GROUND, `фишка стартует в поле: ${Math.round(startY)}`);

const vBefore = api.state.chipV;
api.flap();
check(api.state.chipV === -420, `взмах даёт −420 по вертикали, получено ${api.state.chipV}`);
check(api.state.chipV < vBefore, 'взмах толкает вверх');

// Свободное падение без взмахов: фишка опускается, но не вылетает вверх.
api.state.chipV = 0;
const yBefore = api.state.chipY;
api.advance(0.2);
check(api.state.chipY > yBefore, 'без взмахов фишка падает');

// ---------- Монеты за трубы ----------
console.log('• Монеты за трубы');
api.clearPipes();
api.state.chipY = 260;
api.state.chipV = 0;
const pipe = api.placePipeAhead(260, 260);
check(api.state.score === 0, 'счёт начинается с нуля');
fly(api, 1.3);
check(pipe.passed, 'труба пройдена');
check(api.state.score === 1, `за трубу один балл, получено ${api.state.score}`);
check(api.state.runCoins === 1, `за полёт 1 ₽, получено ${api.state.runCoins}`);
check(balanceOf(win) === 1001, `баланс вырос на 1 ₽: ${balanceOf(win)}`);
check(win.Casino.mini.get('flappy').total === 1, 'заработок сохранён в хранилище мини-игр');
check(doc.querySelector('#flapScore').textContent === '1', 'счёт на поле обновился');

// ---------- Столкновение ----------
console.log('• Столкновение');
api.clearPipes();
api.state.chipY = 300;
api.state.chipV = 0;
api.placePipeAhead(40, 100); // проход далеко наверху — фишка врежется в стопку
fly(api, 0.4);
check(api.state.phase === 'dead', 'фишка разбилась о стопку');
check(doc.querySelector('#flapTitle').textContent.includes('труба'), `экран итогов: ${doc.querySelector('#flapTitle').textContent}`);
check(doc.querySelector('#flapBtn').textContent === 'Ещё полёт', 'кнопка предлагает ещё полёт');
check(doc.querySelector('#flapEarned').textContent === '1 ₽', `за полёт показан 1 ₽: ${doc.querySelector('#flapEarned').textContent}`);

// ---------- Земля ----------
console.log('• Земля');
doc.querySelector('#flapBtn').click();
check(api.state.phase === 'run' && api.state.attempts === 1, 'второй полёт, осталась одна попытка');
api.clearPipes();
api.state.chipY = api.H - api.GROUND - 20;
api.state.chipV = 300;
api.advance(0.2);
check(api.state.phase === 'dead', 'фишка не проваливается под пол');
check(api.state.chipY <= api.H - api.GROUND - api.CHIP_R + 0.001, 'фишка остановилась на земле');

// ---------- Перезарядка ----------
console.log('• Перезарядка');
let now = 1_700_000_000_000;
api.setClock(() => now);
check(api.canPlay(), 'пока есть попытки — играть можно');

doc.querySelector('#flapBtn').click();
check(api.state.attempts === 0, 'третья попытка израсходована');
api.state.chipY = api.H - api.GROUND - 20;
api.state.chipV = 300;
api.advance(0.2);
check(api.state.phase === 'dead', 'третий полёт закончился');
check(api.state.cooldownUntil === now + api.COOLDOWN, 'после третьего полёта включилась перезарядка');
check(!api.canPlay(), 'во время перезарядки играть нельзя');
check(doc.querySelector('#flapCooldown').hidden === false, 'блок перезарядки показан');
check(doc.querySelector('#flapCooldownTime').textContent === '3:00', `таймер 3:00, получено ${doc.querySelector('#flapCooldownTime').textContent}`);
check(doc.querySelector('#flapBadge').textContent === 'Перезарядка 3:00', `бейдж показывает таймер: ${doc.querySelector('#flapBadge').textContent}`);
check(doc.querySelector('#flapBtn').disabled, 'кнопка заблокирована на перезарядке');

check(api.startRun() === false, 'старт во время перезарядки отклонён');
check(api.state.attempts === 0, 'неудачный старт не тратит попытку');

now += 60_000;
api.renderPanel();
check(doc.querySelector('#flapCooldownTime').textContent === '2:00', `через минуту 2:00, получено ${doc.querySelector('#flapCooldownTime').textContent}`);

now += 120_000;
// Живой таймер должен сам вернуть попытки на последней секунде.
api.updateLiveUI();
check(api.state.cooldownUntil === 0, 'через три минуты перезарядка кончилась');
check(api.state.attempts === 3, 'попытки вернулись');
check(api.canPlay(), 'снова можно играть');
check(doc.querySelector('#flapCooldown').hidden, 'блок перезарядки спрятан');
check(doc.querySelector('#flapBadge').textContent === '3 попытки', 'бейдж снова про попытки');
check(!doc.querySelector('#flapBtn').disabled, 'кнопка снова активна');

// ---------- Пауза ----------
console.log('• Пауза');
api.startRun();
const yPause = api.state.chipY;
doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
check(api.state.phase === 'pause', 'Esc ставит на паузу');
check(doc.querySelector('#flapBtn').textContent === 'Продолжить', 'кнопка продолжает полёт');
api.advance(0.5);
check(api.state.chipY === yPause, 'на паузе фишка не движется');
doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
check(api.state.phase === 'run', 'пробел продолжает полёт');
check(api.state.chipV === -420, 'пробел в полёте — взмах');
api.die();
check(api.state.phase === 'dead', 'полёт завершён для проверки сохранения');

// ---------- Сохранение между сессиями ----------
console.log('• Сохранение');
api.state.best = 1;
win.Casino.mini.set('flappy', Object.assign({}, win.Casino.mini.get('flappy'), { best: 1 }));
const saved = win.localStorage.getItem('casino.mini.v1');
check(!!saved && JSON.parse(saved).flappy.best === 1, 'рекорд лежит в localStorage');

const second = boot({ localStorage: win.localStorage });
check(second.api.state.best === 1, `рекорд пережил перезагрузку: ${second.api.state.best}`);
check(second.api.state.total === 1, 'заработок пережил перезагрузку');
check(second.api.state.attempts === 2, `остаток попыток восстановлен: ${second.api.state.attempts}`);

// ---------- Полный сброс казино ----------
console.log('• Сброс казино');
second.window.Casino.resetAll();
check(second.window.Casino.mini.get('flappy', null) === null, 'сброс казино чистит прогресс мини-игры');
check(second.window.Casino.getBalance() === 1000, 'баланс вернулся к 1000');
check(second.window.localStorage.getItem('casino.mini.v1') === '{}', 'пустое хранилище записано на диск');

// ---------- Сброс внутри мини-игры ----------
console.log('• Сброс прогресса мини-игры');
const third = boot();
third.api.state.best = 7;
third.api.state.total = 7;
third.window.Casino.mini.set('flappy', { best: 7, total: 7, runs: 3, pipesTotal: 7, attempts: 0, cooldownUntil: 0 });
third.doc.querySelector('#statsBtn').click();
check(!third.doc.querySelector('#overlay').hidden, 'статистика открывается');
third.doc.querySelector('[data-action="reset"]').click();
check(third.window.Casino.mini.get('flappy', null) === null, 'кнопка сброса чистит прогресс');
check(third.api.state.attempts === 3 && third.api.state.best === 0, 'попытки и рекорд обнулены');
check(third.window.Casino.getBalance() === 1000, 'деньги сброс прогресса не трогает');

// ---------- Клавиатура и раскладка ----------
console.log('• Клавиатура');
const fourth = boot();
fourth.api.startRun();
fourth.doc.dispatchEvent(new fourth.window.KeyboardEvent('keydown', { key: 'ц', code: 'KeyW', bubbles: true }));
check(fourth.api.state.chipV === -420, 'W на русской раскладке взмахивает');
fourth.doc.dispatchEvent(new fourth.window.KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true }));
check(fourth.api.state.chipV === -420, 'стрелка вверх взмахивает');

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
