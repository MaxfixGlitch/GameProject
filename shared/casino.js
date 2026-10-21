/* ============================================================
   Казино «Двадцать одно» — общее ядро
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
    legacy: 'bj21.save.v1',
  };

  const START_BANKROLL = 1000;
  const MIN_BET = 25;
  const MAX_BET = 2500;
  const HISTORY_MAX = 100;

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
  };

  const GAMES = {
    blackjack: {
      id: 'blackjack',
      title: 'Блэкджек 21',
      short: 'Блэкджек',
      icon: '🃏',
      href: 'games/blackjack/',
      color: '#4ade80',
      tagline: 'Классика с шестью колодами, сплитами и блэкджеком 3:2',
      counterKey: 'rounds',
      counterLabel: 'раундов',
    },
    roulette: {
      id: 'roulette',
      title: 'Европейская рулетка',
      short: 'Рулетка',
      icon: '🎡',
      href: 'games/roulette/',
      color: '#f87171',
      tagline: '37 секторов, ставки на числа, цвет, чётность и дюжины',
      counterKey: 'spins',
      counterLabel: 'спинов',
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
    sound = localStorage.getItem(KEYS.sound) !== '0';
    Object.keys(GAMES).forEach(ensureGame);
  }

  function persist() {
    writeJSON(KEYS.wallet, { bankroll: wallet });
    writeJSON(KEYS.history, history);
    writeJSON(KEYS.stats, stats);
    writeJSON(KEYS.pending, pending);
    try { localStorage.setItem(KEYS.sound, sound ? '1' : '0'); } catch (_) { /* ignore */ }
  }

  // ---------- Публичный интерфейс ----------
  const Casino = {
    START_BANKROLL,
    MIN_BET,
    MAX_BET,
    HISTORY_MAX,
    GAMES,
    STAT_TEMPLATES,

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

    // ---------- Служебное ----------
    getSound() {
      return sound;
    },

    setSound(value) {
      sound = Boolean(value);
      return sound;
    },

    save: persist,
    load,

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
      Object.keys(GAMES).forEach(ensureGame);
      persist();
    },
  };

  load();
  window.Casino = Casino;
})();
