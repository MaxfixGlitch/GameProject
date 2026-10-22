/* ============================================================
   Fakrap — общее ядро казино
   Кошелёк, история раздач и статистика по каждой игре.
   ============================================================ */
(() => {
  'use strict';

  const KEYS = {
    wallet: 'casino.wallet.v1',
    history: 'casino.history.v1',
    stats: 'casino.stats.v1',
    pending: 'casino.pending.v1',
    sound: 'casino.sound.v1',
    progress: 'casino.progress.v1',
    topup: 'casino.topup.v1',
    mini: 'casino.mini.v1',
    legacy: 'bj21.save.v1',
  };

  const START_BANKROLL = 1000;
  const MIN_BET = 25;
  const MAX_BET = 2500;
  const HISTORY_MAX = 100;

  // Бесплатное пополнение: раз в 30 минут и только если баланс пуст.
  const TOPUP_AMOUNT = 1000;
  const TOPUP_COOLDOWN = 30 * 60 * 1000;
  const TOPUP_COOKIE = 'casino_topup';

  // Цели по чистому выигрышу за всё время. За каждую — деньги, звание,
  // страховка и +1 000 ₽ к лимиту ставки навсегда.
  const DEFAULT_TITLE = 'Новичок';
  const GOALS = [
    { id: 'g5000', target: 5000, reward: 500, title: 'Игрок', shields: 1 },
    { id: 'g10000', target: 10000, reward: 1000, title: 'Опытный', shields: 1 },
    { id: 'g20000', target: 20000, reward: 2000, title: 'Хайтейлер', shields: 1 },
    { id: 'g50000', target: 50000, reward: 5000, title: 'Мастер', shields: 2 },
    { id: 'g100000', target: 100000, reward: 10000, title: 'Легенда', shields: 2 },
    { id: 'g250000', target: 250000, reward: 25000, title: 'Мифический', shields: 3 },
  ];
  const LIMIT_PER_GOAL = 1000;

  // Какие поля статистики есть у каждой игры. Недостающие добиваются нулями,
  // поэтому старые сохранения и новые игры читаются одинаково.
  const STAT_TEMPLATES = {
    blackjack: {
      rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0,
      wagered: 0, bestWin: 0, net: 0,
    },
    roulette: {
      spins: 0, wins: 0, losses: 0, pushes: 0,
      wagered: 0, bestWin: 0, net: 0,
    },
    dice: {
      rolls: 0, wins: 0, losses: 0, pushes: 0, doubles: 0,
      wagered: 0, bestWin: 0, net: 0,
    },
    baccarat: {
      rounds: 0, wins: 0, losses: 0, pushes: 0,
      playerWins: 0, bankerWins: 0, ties: 0,
      wagered: 0, bestWin: 0, net: 0,
    },
    slots: {
      spins: 0, wins: 0, losses: 0, pushes: 0, lines: 0,
      wagered: 0, bestWin: 0, net: 0,
    },
    wheel: {
      spins: 0, wins: 0, losses: 0, pushes: 0, topMult: 0,
      wagered: 0, bestWin: 0, net: 0,
    },
    plinko: {
      drops: 0, wins: 0, losses: 0, pushes: 0, topMult: 0,
      wagered: 0, bestWin: 0, net: 0,
    },
    mines: {
      rounds: 0, wins: 0, losses: 0, pushes: 0, topMult: 0,
      wagered: 0, bestWin: 0, net: 0,
    },
  };

  const GAMES = {
    blackjack: {
      id: 'blackjack',
      title: 'Блэкджек 21',
      short: 'Блэкджек',
      icon: 'blackjack',
      href: 'games/blackjack/index.html',
      color: '#4ade80',
      tagline: 'Классика с шестью колодами, сплитами и блэкджеком 3:2',
      counterKey: 'rounds',
      counterLabel: 'раундов',
      counterForms: ['раунд', 'раунда', 'раундов'],
    },
    roulette: {
      id: 'roulette',
      title: 'Европейская рулетка',
      short: 'Рулетка',
      icon: 'roulette',
      href: 'games/roulette/index.html',
      color: '#f87171',
      tagline: '37 секторов, ставки на числа, цвет, чётность и дюжины',
      counterKey: 'spins',
      counterLabel: 'спинов',
      counterForms: ['спин', 'спина', 'спинов'],
    },
    dice: {
      id: 'dice',
      title: 'Кости',
      short: 'Кости',
      icon: 'dice',
      href: 'games/dice/index.html',
      color: '#fbbf24',
      tagline: 'Две кости: суммы, чётность, больше-меньше и дубли',
      counterKey: 'rolls',
      counterLabel: 'бросков',
      counterForms: ['бросок', 'броска', 'бросков'],
    },
    baccarat: {
      id: 'baccarat',
      title: 'Баккара',
      short: 'Баккара',
      icon: 'baccarat',
      href: 'games/baccarat/index.html',
      color: '#60a5fa',
      tagline: 'Игрок, банкир или ничья — у кого сумма ближе к девяти',
      counterKey: 'rounds',
      counterLabel: 'раздач',
      counterForms: ['раздача', 'раздачи', 'раздач'],
    },
    slots: {
      id: 'slots',
      title: 'Слоты',
      short: 'Слоты',
      icon: 'slots',
      href: 'games/slots/index.html',
      color: '#e9c46a',
      tagline: 'Три барабана, пять линий и золотая фишка вместо любого символа',
      counterKey: 'spins',
      counterLabel: 'спинов',
      counterForms: ['спин', 'спина', 'спинов'],
    },
    wheel: {
      id: 'wheel',
      title: 'Колесо фортуны',
      short: 'Колесо',
      icon: 'wheel',
      href: 'games/wheel/index.html',
      color: '#a78bfa',
      tagline: 'Одно вращение: множитель до ×6, восемнадцать секторов',
      counterKey: 'spins',
      counterLabel: 'вращений',
      counterForms: ['вращение', 'вращения', 'вращений'],
    },
    plinko: {
      id: 'plinko',
      title: 'Плинко',
      short: 'Плинко',
      icon: 'plinko',
      href: 'games/plinko/index.html',
      color: '#38bdf8',
      tagline: 'Шарик падает по колышкам: чем дальше слот, тем больше множитель',
      counterKey: 'drops',
      counterLabel: 'дропов',
      counterForms: ['дроп', 'дропа', 'дропов'],
    },
    mines: {
      id: 'mines',
      title: 'Сапёр',
      short: 'Сапёр',
      icon: 'mines',
      href: 'games/mines/index.html',
      color: '#f97316',
      tagline: 'Открывайте клетки, обходите мины и забирайте растущий множитель',
      counterKey: 'rounds',
      counterLabel: 'заходов',
      counterForms: ['заход', 'захода', 'заходов'],
    },
  };

  // ---------- Утилиты ----------
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : fallback;
  };

  // ---------- Чтение ----------
  let wallet = START_BANKROLL;
  let history = {};
  let stats = {};
  let pending = {};
  let sound = true;
  let progress = normalizeProgress(null);
  let topUp = { readyAt: 0, seenAt: 0, count: 0 };
  // Общее хранилище для мини-игр: попытки, перезарядки, рекорды.
  // У каждой мини-игры свой ключ, ядро в его содержимое не лезет.
  let mini = {};

  // ---------- Рулетка: чтение ставок ----------
  // Подписи и разметка живут в общем ядре, чтобы страница игры и история
  // на хабе показывали ставки одинаково.
  const ROULETTE_OUTSIDE = {
    red: 'КРАСНОЕ',
    black: 'ЧЁРНОЕ',
    even: 'ЧЁТ',
    odd: 'НЕЧЁТ',
    low: '1–18',
    high: '19–36',
  };
  const DOZEN_LABELS = ['1–12', '13–24', '25–36'];

  function rouletteBetLabel(key) {
    const raw = String(key || '');
    const [type, arg] = raw.split(':');
    const value = Number(arg);
    if (type === 'straight') return Number.isFinite(value) ? String(value) : 'число';
    if (type === 'dozen') return DOZEN_LABELS[num(arg, 1) - 1] || 'дюжина';
    if (type === 'column') return `колонка ${num(arg, 1)}`;
    return ROULETTE_OUTSIDE[type] || raw;
  }

  // ---------- Кости: чтение ставок ----------
  const DICE_OUTSIDE = {
    even: 'ЧЁТ',
    odd: 'НЕЧЁТ',
    over: 'БОЛЬШЕ 7',
    under: 'МЕНЬШЕ 7',
    double: 'ЛЮБОЙ ДУБЛЬ',
  };

  function diceBetLabel(key) {
    const raw = String(key || '');
    const [type, arg] = raw.split(':');
    const value = Number(arg);
    if (type === 'sum') return Number.isFinite(value) ? `сумма ${value}` : 'сумма';
    if (type === 'pair') return Number.isFinite(value) ? `дубль ${value}–${value}` : 'дубль';
    return DICE_OUTSIDE[type] || '';
  }

  // ---------- Баккара: чтение ставок ----------
  const BACCARAT_LABELS = {
    player: 'ИГРОК',
    banker: 'БАНКИР',
    tie: 'НИЧЬЯ',
  };

  function baccaratBetLabel(key) {
    return BACCARAT_LABELS[String(key || '')] || '';
  }

  // Ставки разных игр не пересекаются, поэтому подпись выбирается сама.
  function betLabel(key) {
    return baccaratBetLabel(key) || diceBetLabel(key) || rouletteBetLabel(key);
  }

  const moneyFmt = new Intl.NumberFormat('ru-RU');
  const money = (value) => `${moneyFmt.format(num(value))} ₽`;

  // Фишки ставок для истории: выигравшие обведены зелёным.
  function betTagsHTML(bets, wins) {
    const entries = Object.entries(bets || {}).filter(([, amount]) => num(amount) > 0);
    if (!entries.length) return '';
    const winSet = new Set((Array.isArray(wins) ? wins : []).map(String));
    const hasWins = entries.some(([key]) => winSet.has(key));
    const tags = entries.map(([key, amount]) => {
      const won = winSet.has(key);
      return `<span class="bet-tag${won ? ' is-win' : ''}"`
        + `${won ? ' title="Ставка выиграла"' : ''}>`
        + `<span class="bet-tag-label">${betLabel(key)}</span>`
        + `<span class="bet-tag-amount">${money(amount)}</span>`
        + `${won ? '<span class="bet-tag-check" aria-hidden="true">✓</span>' : ''}</span>`;
    }).join('');
    return `<div class="bet-tags${hasWins ? ' has-wins' : ''}">${tags}</div>`;
  }

  function normalizeProgress(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const claimed = {};
    if (src.claimed && typeof src.claimed === 'object') {
      GOALS.forEach((goal) => {
        if (src.claimed[goal.id]) claimed[goal.id] = num(src.claimed[goal.id], 1);
      });
    }
    return {
      claimed,
      shields: Math.max(0, num(src.shields)),
      notices: Array.isArray(src.notices) ? src.notices.filter((n) => n && n.id) : [],
      // Рекорд чистого выигрыша: только растёт, поэтому открытые игры
      // не закроются после проигрыша. Бонус сюда не попадает.
      bestNet: Math.max(0, num(src.bestNet)),
    };
  }

  const claimedCount = () => Object.keys(progress.claimed).length;

  function totalNet() {
    return Object.keys(GAMES).reduce((sum, gameId) => sum + num(ensureGame(gameId).net), 0);
  }

  function goalTitle() {
    let title = DEFAULT_TITLE;
    GOALS.forEach((goal) => {
      if (progress.claimed[goal.id]) title = goal.title;
    });
    return title;
  }

  function goalsList() {
    const net = totalNet();
    return GOALS.map((goal) => ({
      id: goal.id,
      target: goal.target,
      reward: goal.reward,
      title: goal.title,
      shields: goal.shields,
      reached: net >= goal.target,
      claimed: Boolean(progress.claimed[goal.id]),
      progress: Math.max(0, Math.min(goal.target, net)),
    }));
  }

  function maxBetValue() {
    return MAX_BET + claimedCount() * LIMIT_PER_GOAL;
  }

  function checkGoalProgress() {
    const net = totalNet();
    const claimedNow = [];
    GOALS.forEach((goal) => {
      if (progress.claimed[goal.id] || net < goal.target) return;
      progress.claimed[goal.id] = Date.now();
      wallet = Math.max(0, wallet + goal.reward);
      progress.shields += goal.shields;
      const notice = {
        id: goal.id,
        target: goal.target,
        reward: goal.reward,
        title: goal.title,
        shields: goal.shields,
      };
      progress.notices.push(notice);
      claimedNow.push(notice);
    });
    if (claimedNow.length) persist();
    return claimedNow;
  }

  function takeGoalNotices() {
    const list = progress.notices.slice();
    if (list.length) {
      progress.notices = [];
      persist();
    }
    return list;
  }

  // ---------- Открытие игр ----------
  // Без блюра только блэкджек и рулетка: с них начинается казино.
  // Остальные игры открываются по очереди: каждая следующая — за
  // очередную тысячу рублей чистого выигрыша (бонус не считается).
  const UNLOCK_ORDER = ['dice', 'baccarat', 'slots', 'wheel', 'plinko', 'mines'];
  const UNLOCK_STEP = 1000;

  const PREVIEW_KEY = 'casino.preview.v1';

  // Форма слова «закрыт» под название игры: «сапёр закрыт»,
  // «колесо закрыто», «кости закрыты».
  const CLOSED_FORMS = {
    blackjack: 'закрыт',
    roulette: 'закрыта',
    dice: 'закрыты',
    baccarat: 'закрыта',
    slots: 'закрыты',
    wheel: 'закрыто',
    plinko: 'закрыто',
    mines: 'закрыт',
  };

  const closedWord = (gameId) => CLOSED_FORMS[gameId] || 'закрыта';

  /** Чистый выигрыш по всем играм: сумма итогов, ниже нуля не падает. */
  function netWon() {
    return Object.keys(GAMES).reduce((sum, gameId) => sum + num(ensureGame(gameId).net), 0);
  }

  /**
   * Достигнутая планка: максимум чистого выигрыша за всё время.
   * Открытые игры остаются открытыми, даже если потом проиграться.
   */
  function bestNet() {
    const current = Math.max(0, netWon());
    if (current > num(progress.bestNet)) {
      progress.bestNet = current;
      persist();
    }
    return Math.max(current, num(progress.bestNet));
  }

  /** Сколько всего чистого выигрыша нужно, чтобы игра открылась. */
  function unlockThreshold(gameId) {
    const index = UNLOCK_ORDER.indexOf(gameId);
    if (index < 0) return 0;
    return UNLOCK_STEP * (index + 1);
  }

  /** Открыта ли игра. Блэкджек и рулетка открыты всегда. */
  function isUnlocked(gameId) {
    if (previewMode()) return true;
    const threshold = unlockThreshold(gameId);
    if (!threshold) return true;
    return bestNet() >= threshold;
  }

  function unlockStatus(gameId) {
    const threshold = unlockThreshold(gameId);
    const have = bestNet();
    const unlocked = isUnlocked(gameId);
    return {
      id: gameId,
      unlocked,
      threshold,
      have,
      left: unlocked ? 0 : Math.max(0, threshold - have),
      total: UNLOCK_ORDER.length,
      opened: unlockedCount(),
    };
  }

  function unlockedCount() {
    return Object.keys(GAMES).filter((gameId) => isUnlocked(gameId)).length;
  }

  /** Порядок открытия: от первой закрытой игры к последней. */
  function unlockPlan() {
    return UNLOCK_ORDER.map((gameId, index) => ({
      id: gameId,
      game: GAMES[gameId],
      threshold: UNLOCK_STEP * (index + 1),
      unlocked: isUnlocked(gameId),
    }));
  }

  /** Режим разработчика: все игры открыты, прогресс не нужен. */
  function previewMode() {
    try {
      if (sessionStorage.getItem(PREVIEW_KEY) === '1') return true;
    } catch (_) { /* приватный режим — просто смотрим на ссылку */ }
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('preview') === '1') return true;
    } catch (_) { /* без URLSearchParams считаем, что режима нет */ }
    return false;
  }

  function setPreview(value) {
    const on = Boolean(value);
    try {
      if (on) sessionStorage.setItem(PREVIEW_KEY, '1');
      else sessionStorage.removeItem(PREVIEW_KEY);
    } catch (_) { /* без sessionStorage режим живёт только в ссылке */ }
    return on;
  }

  /**
   * Заглушка закрытой игры. Страница игры не запускается, а показывает
   * замок и ссылку на хаб: обходить блюр через прямой адрес нельзя.
   */
  function showLocked(gameId) {
    const info = unlockStatus(gameId);
    const game = GAMES[gameId] || { title: 'Игра' };
    const left = moneyFmt.format(info.left);
    const body = document.body;
    if (!body) return false;
    body.innerHTML = `
      <main class="locked-screen">
        <div class="locked-card">
          <span class="locked-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="4" y="10" width="16" height="11" rx="3" fill="currentColor"/><circle cx="12" cy="15.5" r="1.6" fill="#0a1811"/></svg>
          </span>
          <h1>${game.title} ещё ${closedWord(gameId)}</h1>
          <p>Игра откроется, когда чистый выигрыш по казино дойдёт
            до ${moneyFmt.format(info.threshold)} ₽. Осталось ${left} ₽.</p>
          <div class="locked-bar"><span style="width:${Math.min(100, (info.have / info.threshold) * 100).toFixed(1)}%"></span></div>
          <p class="locked-note">Бонус и пополнение в счёт открытия не идут —
            только то, что вы выиграли за столом.</p>
          <a class="primary-btn" href="../../index.html">Вернуться к играм</a>
        </div>
      </main>
    `;
    return true;
  }

  function touchBestNet() {
    return bestNet();
  }

  function useShield() {
    if (progress.shields <= 0) return false;
    progress.shields -= 1;
    persist();
    return true;
  }

  function readCookie(name) {
    try {
      const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? decodeURIComponent(match[1]) : '';
    } catch (_) {
      return '';
    }
  }

  function writeCookie(name, value, days) {
    try {
      const expires = new Date(Date.now() + days * 864e5).toUTCString();
      document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
    } catch (_) { /* cookie недоступен — остаётся localStorage */ }
  }

  // Кулдаун храним в двух местах: обновление страницы и очистка одного
  // хранилища таймер не сбрасывают. Режим инкогнито обойдёт всё — сервера нет.
  function readTopUpStore() {
    const local = readJSON(KEYS.topup) || {};
    const cookie = readCookie(TOPUP_COOKIE);
    let remote = {};
    if (cookie) {
      const [readyAt, seenAt, count] = cookie.split('.').map((part) => num(part));
      remote = { readyAt, seenAt, count };
    }
    return {
      readyAt: Math.max(num(local.readyAt), num(remote.readyAt)),
      seenAt: Math.max(num(local.seenAt), num(remote.seenAt)),
      count: Math.max(num(local.count), num(remote.count)),
    };
  }

  function persistTopUp() {
    writeJSON(KEYS.topup, topUp);
    writeCookie(TOPUP_COOKIE, `${topUp.readyAt}.${topUp.seenAt}.${topUp.count}`, 30);
  }

  // Если часы перевели назад, считаем время от последнего известного момента.
  function topUpNow() {
    const now = Date.now();
    const seen = num(topUp.seenAt);
    const safe = now < seen - 60000 ? seen : now;
    if (safe > seen) topUp.seenAt = safe;
    return safe;
  }

  function topUpInfo() {
    // Подхватываем бонус, полученный в другой вкладке.
    const stored = readTopUpStore();
    topUp = {
      readyAt: Math.max(num(topUp.readyAt), num(stored.readyAt)),
      seenAt: Math.max(num(topUp.seenAt), num(stored.seenAt)),
      count: Math.max(num(topUp.count), num(stored.count)),
    };
    const now = topUpNow();
    const remaining = Math.max(0, num(topUp.readyAt) - now);
    return {
      ready: remaining === 0,
      remaining,
      readyAt: num(topUp.readyAt),
      count: num(topUp.count),
      amount: TOPUP_AMOUNT,
      cooldown: TOPUP_COOLDOWN,
    };
  }

  function claimTopUp() {
    // Проверяем хранилище непосредственно перед выдачей: две вкладки
    // не должны получить бонус дважды.
    topUp = readTopUpStore();
    const info = topUpInfo();
    if (!info.ready) return Object.assign({ ok: false }, info);
    const now = topUpNow();
    wallet = Math.max(0, wallet + TOPUP_AMOUNT);
    topUp.readyAt = now + TOPUP_COOLDOWN;
    topUp.seenAt = now;
    topUp.count += 1;
    persistTopUp();
    persist();
    return {
      ok: true,
      amount: TOPUP_AMOUNT,
      readyAt: topUp.readyAt,
      remaining: TOPUP_COOLDOWN,
      count: topUp.count,
    };
  }

  function readJSON(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (_) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* приватный режим — играем без сохранения */ }
  }

  function ensureGame(gameId) {
    if (!stats[gameId] || typeof stats[gameId] !== 'object') stats[gameId] = {};
    const template = STAT_TEMPLATES[gameId] || {};
    Object.keys(template).forEach((key) => {
      stats[gameId][key] = num(stats[gameId][key], template[key]);
    });
    if (!Array.isArray(history[gameId])) history[gameId] = [];
    return stats[gameId];
  }

  // Старые сохранения блэкджека (до появления хаба) переносим в общий формат.
  function migrateLegacy() {
    if (localStorage.getItem(KEYS.wallet)) return false;
    const legacy = readJSON(KEYS.legacy);
    if (!legacy || typeof legacy.bankroll !== 'number') return false;

    wallet = Math.max(0, num(legacy.bankroll) + num(legacy.pending));
    stats = { blackjack: Object.assign({}, STAT_TEMPLATES.blackjack, legacy.stats || {}) };
    history = { blackjack: Array.isArray(legacy.history) ? legacy.history : [] };
    pending = {};
    sound = legacy.sound !== false;
    persist();
    try { localStorage.removeItem(KEYS.legacy); } catch (_) { /* ignore */ }
    return true;
  }

  function load() {
    const rawProgress = readJSON(KEYS.progress);
    progress = normalizeProgress(rawProgress);
    topUp = readTopUpStore();
    topUpNow();
    persistTopUp();

    if (migrateLegacy()) return;
    const rawWallet = readJSON(KEYS.wallet);
    if (rawWallet && typeof rawWallet.bankroll === 'number') {
      wallet = Math.max(0, num(rawWallet.bankroll, START_BANKROLL));
    }
    const rawHistory = readJSON(KEYS.history);
    history = rawHistory && typeof rawHistory === 'object' ? rawHistory : {};
    const rawStats = readJSON(KEYS.stats);
    stats = rawStats && typeof rawStats === 'object' ? rawStats : {};
    const rawPending = readJSON(KEYS.pending);
    pending = rawPending && typeof rawPending === 'object' ? rawPending : {};
    const rawMini = readJSON(KEYS.mini);
    mini = rawMini && typeof rawMini === 'object' && !Array.isArray(rawMini) ? rawMini : {};
    sound = localStorage.getItem(KEYS.sound) !== '0';
    Object.keys(GAMES).forEach(ensureGame);
  }

  function persist() {
    writeJSON(KEYS.wallet, { bankroll: wallet });
    writeJSON(KEYS.history, history);
    writeJSON(KEYS.stats, stats);
    writeJSON(KEYS.pending, pending);
    writeJSON(KEYS.progress, progress);
    writeJSON(KEYS.mini, mini);
    try { localStorage.setItem(KEYS.sound, sound ? '1' : '0'); } catch (_) { /* ignore */ }
  }

  // ---------- Публичный интерфейс ----------
  const Casino = {
    START_BANKROLL,
    MIN_BET,
    MAX_BET,
    HISTORY_MAX,
    TOPUP_AMOUNT,
    TOPUP_COOLDOWN,
    GOALS,
    LIMIT_PER_GOAL,
    DEFAULT_TITLE,
    GAMES,
    STAT_TEMPLATES,

    // ---------- Мини-игры ----------
    // Простое хранилище «ключ → значение» с сохранением в localStorage.
    // Мини-игры держат здесь попытки, перезарядку и рекорды, чтобы
    // состояние переживало перезагрузку и сбрасывалось вместе с казино.
    mini: {
      get(key, fallback = null) {
        return Object.prototype.hasOwnProperty.call(mini, key) ? mini[key] : fallback;
      },
      set(key, value) {
        mini[key] = value;
        persist();
        return value;
      },
      remove(key) {
        delete mini[key];
        persist();
      },
    },

    getBalance() {
      return wallet;
    },

    setBalance(value) {
      wallet = Math.max(0, num(value));
      return wallet;
    },

    addBalance(delta) {
      wallet = Math.max(0, wallet + num(delta));
      return wallet;
    },

    // Ставка уходит с баланса и запоминается как «в игре»:
    // если закрыть вкладку, деньги вернутся при следующей загрузке.
    stake(gameId, amount) {
      const value = Math.max(0, num(amount));
      if (value <= 0) return wallet;
      wallet = Math.max(0, wallet - value);
      return wallet;
    },

    payout(gameId, amount) {
      wallet = Math.max(0, wallet + num(amount));
      return wallet;
    },

    // ---------- Статистика ----------
    stats(gameId) {
      return ensureGame(gameId);
    },

    setStats(gameId, value) {
      stats[gameId] = Object.assign({}, STAT_TEMPLATES[gameId] || {}, value || {});
      return ensureGame(gameId);
    },

    // ---------- История ----------
    history(gameId) {
      ensureGame(gameId);
      return history[gameId];
    },

    setHistory(gameId, list) {
      history[gameId] = Array.isArray(list) ? list.slice(0, HISTORY_MAX) : [];
      return history[gameId];
    },

    pushHistory(gameId, entry) {
      ensureGame(gameId);
      const item = Object.assign({ id: `${gameId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }, entry);
      history[gameId].unshift(item);
      if (history[gameId].length > HISTORY_MAX) history[gameId].length = HISTORY_MAX;
      return item;
    },

    // Все игры вместе, свежие сверху — для истории на хабе.
    allHistory(gameFilter) {
      const list = [];
      Object.keys(GAMES).forEach((gameId) => {
        if (gameFilter && gameFilter !== 'all' && gameFilter !== gameId) return;
        (history[gameId] || []).forEach((entry) => {
          list.push(Object.assign({ game: gameId }, entry));
        });
      });
      return list.sort((a, b) => num(b.ts) - num(a.ts)).slice(0, HISTORY_MAX * 2);
    },

    // ---------- Незавершённые раунды ----------
    setPending(gameId, amount) {
      const value = Math.max(0, num(amount));
      if (value) pending[gameId] = value;
      else delete pending[gameId];
    },

    getPending(gameId) {
      return num(pending[gameId]);
    },

    // Возврат ставки, «зависшей» в незавершённом раунде.
    settlePending(gameId) {
      const value = num(pending[gameId]);
      delete pending[gameId];
      if (value > 0) wallet = Math.max(0, wallet + value);
      return value;
    },

    settleAllPending() {
      let refunded = 0;
      Object.keys(pending).forEach((gameId) => {
        refunded += Casino.settlePending(gameId);
      });
      return refunded;
    },

    // ---------- Бонус и цели ----------
    getTopUp() {
      return topUpInfo();
    },

    claimTopUp,

    goals() {
      return goalsList();
    },

    checkGoals: checkGoalProgress,

    takeGoalNotices,

    goalTitle,

    totalNet,

    shields() {
      return progress.shields;
    },

    useShield,

    // ---------- Открытие игр ----------
    UNLOCK_ORDER,
    UNLOCK_STEP,
    unlockPlan,
    unlockStatus,
    unlockThreshold,
    isUnlocked,
    unlockedCount,
    closedWord,
    bestNet,
    netWon,
    previewMode,
    setPreview,
    showLocked,
    touchBestNet,

    maxBet: maxBetValue,

    profile() {
      return {
        title: goalTitle(),
        shields: progress.shields,
        net: totalNet(),
        maxBet: maxBetValue(),
        goals: goalsList(),
        topUp: topUpInfo(),
      };
    },

    // ---------- Подписи ставок ----------
    rouletteBetLabel,
    diceBetLabel,
    baccaratBetLabel,
    betLabel,
    betTagsHTML,

    // ---------- Служебное ----------
    getSound() {
      return sound;
    },

    setSound(value) {
      sound = Boolean(value);
      return sound;
    },

    /**
     * Иконка звука в шапке: у кнопки две картинки в data-атрибутах,
     * поэтому путь работает и с хаба, и из папок игр.
     * @param {Element|null} button кнопка звука
     * @param {boolean} on включён ли звук
     */
    setSoundIcon(button, on) {
      if (!button) return;
      const icon = button.querySelector('img');
      const src = on ? button.dataset.soundOn : button.dataset.soundOff;
      if (icon && src) icon.src = src;
      button.classList.toggle('off', !on);
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', on ? 'Звук включён' : 'Звук выключен');
      button.title = on ? 'Звук включён' : 'Звук выключен';
    },

    save: persist,
    load,

    /**
     * Клавиша независимо от раскладки.
     *
     * На русской раскладке event.key для клавиши C — это «с», и горячие
     * клавиши переставали работать. Физическая клавиша (event.code) от
     * раскладки не зависит, поэтому она в приоритете, а event.key — запасной
     * вариант для старых браузеров и синтетических событий.
     */
    keyOf(event) {
      if (!event) return '';
      const code = typeof event.code === 'string' ? event.code : '';
      const special = {
        Space: ' ',
        Spacebar: ' ',
        Enter: 'enter',
        NumpadEnter: 'enter',
        Escape: 'escape',
        Esc: 'escape',
        ArrowUp: 'arrowup',
        ArrowDown: 'arrowdown',
        ArrowLeft: 'arrowleft',
        ArrowRight: 'arrowright',
        Backspace: 'backspace',
      };
      if (special[code]) return special[code];
      if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
      if (/^(Digit|Numpad)\d$/.test(code)) return code.slice(code.length - 1);
      const key = typeof event.key === 'string' ? event.key : '';
      if (key === ' ' || key === 'Spacebar') return ' ';
      return key.toLowerCase();
    },

    resetGame(gameId) {
      stats[gameId] = Object.assign({}, STAT_TEMPLATES[gameId] || {});
      history[gameId] = [];
      delete pending[gameId];
    },

    resetAll() {
      wallet = START_BANKROLL;
      history = {};
      stats = {};
      pending = {};
      // Прогресс и звания обнуляются, а кулдаун бонуса — нет:
      // иначе сброс давал бы лишнюю бесплатную тысячу.
      progress = normalizeProgress(null);
      mini = {};
      Object.keys(GAMES).forEach(ensureGame);
      persist();
    },
  };

  load();
  window.Casino = Casino;
})();
