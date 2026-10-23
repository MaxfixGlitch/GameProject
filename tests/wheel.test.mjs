import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(`${root}games/wheel/index.html`, 'utf8')
  .replace('<script src="../../shared/casino.js"></script>', '')
  .replace('<script src="wheel.js"></script>', '');
const rawCasino = fs.readFileSync(`${root}shared/casino.js`, 'utf8');
const rawGame = fs.readFileSync(`${root}games/wheel/wheel.js`, 'utf8');

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
    url: 'https://example.org/games/wheel/?preview=1',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const store = dom.window.localStorage;
  if (seed && seed.getItem) {
    CASINO_KEYS.forEach((key) => {
      const value = seed.getItem(key);
      if (value !== null) store.setItem(key, value);
    });
  } else if (seed) {
    Object.entries(seed).forEach(([key, value]) => store.setItem(key, value));
  }
  dom.window.eval(rawCasino);
  dom.window.eval(rawGame);
  return { dom, window: dom.window, doc: dom.window.document, api: dom.window.__WHEEL_TEST__ };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const balanceOf = (win) => win.Casino.getBalance();

const { window: win, doc, api } = boot();
api.setTiming({ spin: 5, settle: 5 });

// ---------- Секторы и математика ----------
console.log('• Секторы');
check(api.SEGMENTS.length === 18, `18 секторов, получено ${api.SEGMENTS.length}`);
check(Math.abs(api.SEG_ANGLE - 20) < 1e-9, `сектор 20°, получено ${api.SEG_ANGLE}`);
const counts = {};
api.SEGMENTS.forEach((m) => { counts[m] = (counts[m] || 0) + 1; });
check(counts[0] === 9, `нулей девять, получено ${counts[0]}`);
check(counts[1] === 3, 'единиц три');
check(counts[0.5] === 2, 'половин две');
check(counts[2] === 2, `секторов ×2 два, получено ${counts[2]}`);
check(counts[3] === 1 && counts[6] === 1, 'по одному сектору ×3 и ×6');
const total = api.SEGMENTS.reduce((a, b) => a + b, 0);
check(total === 17, `сумма множителей 17, получено ${total}`);
check(Math.abs(total / 18 - 17 / 18) < 1e-9, 'возврат 17/18 = 94,44%');

console.log('• Выплаты по сектору');
check(api.multiplierFor(7) === 6, 'седьмой сектор — ×6');
check(api.payoutFor(100, 7) === 600, 'ставка 100 на ×6 даёт 600');
check(api.payoutFor(100, 3) === 50, '×0,5 от 100 — 50');
check(api.payoutFor(25, 3) === 13, `×0,5 от 25 округляется до 13, получено ${api.payoutFor(25, 3)}`);
check(api.payoutFor(1000, 0) === 0, 'нулевой сектор не платит');

// ---------- Колесо на экране ----------
console.log('• Колесо');
const labels = [...doc.querySelectorAll('.wheel-label')];
check(labels.length === 18, `18 подписей, получено ${labels.length}`);
check(labels[7].textContent.includes('×6'), 'на седьмом секторе подпись ×6');
check(labels[0].classList.contains('zero'), 'нулевой сектор помечен');
check(doc.querySelector('#wheelDisc').style.background.includes('conic-gradient'), 'секторы нарисованы');
check(doc.querySelectorAll('.sector-row').length === 6, 'в панели шесть разных множителей');
check(doc.querySelectorAll('.sector-row')[0].textContent.includes('ставка сгорает'), 'нулевой сектор подписан');

// ---------- Вращение с выигрышем ----------
console.log('• Вращение');
api.setBet(100);
const spin = await api.spin(7);
check(spin.mult === 6, `выпало ×6, получено ×${spin.mult}`);
check(spin.payout === 600, `выплата 600, получено ${spin.payout}`);
check(spin.net === 500, `чистыми 500, получено ${spin.net}`);
check(balanceOf(win) === 1500, `баланс 1 500, получено ${balanceOf(win)}`);
check(win.Casino.stats('wheel').spins === 1, 'вращение записано');
check(win.Casino.stats('wheel').wins === 1, 'победа записана');
check(win.Casino.stats('wheel').topMult === 6, 'лучший множитель ×6');
check(win.Casino.stats('wheel').wagered === 100, 'оборот 100');
check(win.Casino.stats('wheel').net === 500, 'итог 500');
check(win.Casino.history('wheel').length === 1, 'вращение в истории');
check(win.Casino.history('wheel')[0].mult === 6, 'в истории множитель');
check(win.Casino.history('wheel')[0].summary.includes('×6'), `описание: ${win.Casino.history('wheel')[0].summary}`);
check(win.Casino.getPending('wheel') === 0, 'ставка не висит');
check(doc.querySelector('#resultValue').textContent.includes('600'), 'результат на экране');
check(doc.querySelector('.wheel-label.hit').dataset.index === '7', 'подсвечен седьмой сектор');
check(doc.querySelectorAll('#spinsList .spin-card').length === 1, 'вращение видно в истории на странице');
const wheelTime = doc.querySelector('#spinsList .spin-card .round-time');
check(!!wheelTime && wheelTime.textContent.trim().length > 0, 'в истории карточки время в общем виде');
check(!!doc.querySelector('.topbar .shield-pill'), 'в шапке игры виден значок страховки');
check(!doc.querySelector('.panel-note'), 'над строкой управления нет дубля описания');
check(!doc.body.textContent.includes('RTP') && !doc.body.textContent.includes('Σ'),
  'в подсказках больше нет формул возврата');

// Угол поворота ставит сектор под указатель (0° сверху).
const normalized = ((api.state.rotation % 360) + 360) % 360;
const expected = (360 - (7 * 20 + 10)) % 360;
check(Math.abs(normalized - expected) < 0.001,
  `колесо встало на ${normalized.toFixed(2)}°, ожидалось ${expected.toFixed(2)}°`);

// ---------- Нулевой сектор ----------
console.log('• Нулевой сектор');
const beforeZero = balanceOf(win);
const zero = await api.spin(0);
check(zero.mult === 0 && zero.payout === 0, 'сектор ×0 ничего не платит');
check(zero.net === -100, 'чистыми −100');
check(balanceOf(win) === beforeZero - 100, 'ставка списана');
check(win.Casino.stats('wheel').losses === 1, 'поражение записано');
check(win.Casino.history('wheel').length === 2, 'второе вращение в истории');
check(doc.querySelector('#message').className.includes('lose'), 'сообщение красное');

// ---------- Возврат ставки ----------
console.log('• Сектор ×1');
const beforeOne = balanceOf(win);
const one = await api.spin(1);
check(one.net === 0, `×1 возвращает ставку, получено ${one.net}`);
check(balanceOf(win) === beforeOne, 'баланс не изменился');
check(win.Casino.stats('wheel').pushes === 1, 'возврат записан как ничья');
check(doc.querySelector('#message').className.includes('info'), 'сообщение нейтральное');

// ---------- Половина ----------
console.log('• Сектор ×0,5');
const half = await api.spin(3);
check(half.payout === 50, `выплата 50, получено ${half.payout}`);
check(half.net === -50, `чистыми −50, получено ${half.net}`);

// ---------- Страховка ----------
console.log('• Страховка');
{
  const insured = boot();
  insured.api.setTiming({ spin: 5, settle: 5 });
  insured.window.Casino.setBalance(1000);
  insured.window.localStorage.setItem('casino.progress.v1', JSON.stringify({ shields: 2, claimed: [], net: 0 }));
  insured.window.Casino.load();
  insured.api.setBet(100);
  const res = await insured.api.spin(0);
  check(res.insurance === 50, `страховка вернула 50, получено ${res.insurance}`);
  check(res.net === -50, 'чистыми −50');
  check(insured.window.Casino.shields() === 1, 'страховка сгорела');
  check(balanceOf(insured.window) === 950, `баланс 950, получено ${balanceOf(insured.window)}`);
}

// ---------- Мало денег ----------
console.log('• Мало денег');
win.Casino.setBalance(10);
api.setBet(100);
api.updateUI();
check(!doc.querySelector('#betHint').hidden, 'подсказка про нехватку денег');
check(doc.querySelector('#spinBtn').disabled, 'кнопка заблокирована');
check(await api.spin(7) === null, 'вращение без денег не начинается');
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
api.setBet(100);

// ---------- Сброс ----------
console.log('• Сброс');
doc.querySelector('#statsBtn').click();
check(!doc.querySelector('#overlay').hidden, 'статистика открывается');
check(doc.querySelector('.modal-body').textContent.includes('Фактический возврат'), 'возврат в статистике');
doc.querySelector('[data-action="reset"]').click();
check(win.Casino.stats('wheel').spins === 0, 'статистика обнулена');
check(win.Casino.history('wheel').length === 0, 'история очищена');
check(doc.querySelectorAll('#spinsList .spin-card').length === 0, 'история на странице пуста');
check(doc.querySelector('#overlay').hidden, 'окно закрылось');

// ---------- Клавиатура ----------
console.log('• Клавиатура');
{
  const kbd = boot();
  kbd.api.setTiming({ spin: 5, settle: 5 });
  kbd.window.Casino.setBalance(1000);
  kbd.api.setBet(100);
  kbd.doc.dispatchEvent(new kbd.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
  await sleep(40);
  check(kbd.window.Casino.stats('wheel').spins === 1, 'пробел крутит колесо');
  check(kbd.window.Casino.stats('wheel').wagered === 100, 'ставка списана');
}

console.log(failures === 0 ? '\n✅ Все проверки пройдены' : `\n❌ Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
