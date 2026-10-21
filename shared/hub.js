/* ============================================================
   Хаб казино: витрина игр, общий баланс, история и статистика
   ============================================================ */
(() => {
  'use strict';

  const Casino = window.Casino;
  const $ = (sel) => document.querySelector(sel);

  const el = {
    bankroll: $('#bankroll'),
    heroBalance: $('#heroBalance'),
    heroTotal: $('#heroTotal'),
    deltaLayer: $('#deltaLayer'),
    gamesGrid: $('#gamesGrid'),
    topUpBtn: $('#topUpBtn'),
    heroHistoryBtn: $('#heroHistoryBtn'),
    soundBtn: $('#soundBtn'),
    historyBtn: $('#historyBtn'),
    goalsBtn: $('#goalsBtn'),
    titleChip: $('#titleChip'),
    shieldChip: $('#shieldChip'),
    goalNext: $('#goalNext'),
    statsBtn: $('#statsBtn'),
    resetBtn: $('#resetBtn'),
    overlay: $('#overlay'),
    modalBody: $('#modalBody'),
    modalClose: $('#modalClose'),
  };

  const numFmt = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => `${numFmt.format(Math.round(n))} ₽`;
  const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
  const mmss = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  let currentBalance = Casino.getBalance();

  // ---------- Звук ----------
  let audioCtx = null;
  const soundOn = () => Casino.getSound();

  function beep({ freq = 440, dur = 0.07, type = 'sine', gain = 0.035, at = 0 }) {
    if (!soundOn()) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const t0 = audioCtx.currentTime + at;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (_) { /* звук не критичен */ }
  }

  // ---------- Отрисовка ----------
  function renderBalance(bump) {
    const balance = Casino.getBalance();
    el.bankroll.textContent = fmt(balance);
    el.heroBalance.textContent = fmt(balance);

    if (bump && balance !== currentBalance) {
      const delta = balance - currentBalance;
      const node = document.createElement('span');
      node.className = `delta ${delta > 0 ? 'plus' : 'minus'}`;
      node.textContent = signed(delta);
      el.deltaLayer.appendChild(node);
      setTimeout(() => node.remove(), 1500);
      beep({ freq: delta > 0 ? 660 : 220, dur: 0.09, type: delta > 0 ? 'triangle' : 'sine' });
    }
    currentBalance = balance;

    const totalNet = Object.keys(Casino.GAMES)
      .reduce((sum, id) => sum + (Casino.stats(id).net || 0), 0);
    el.heroTotal.innerHTML = totalNet === 0
      ? 'Ставок пока не было'
      : `Итог всех игр: <span class="${totalNet > 0 ? 'plus' : 'minus'}">${signed(totalNet)}</span>`;

    renderProfile();
  }

  // ---------- Профиль: звание, страховки, бонус ----------
  function renderProfile() {
    const profile = Casino.profile();
    el.titleChip.textContent = profile.title;
    el.titleChip.title = `Звание: ${profile.title}. Открыть цели`;
    el.shieldChip.hidden = profile.shields <= 0;
    el.shieldChip.textContent = `🛡 ${profile.shields}`;
    el.shieldChip.title = `Страховок: ${profile.shields}. При проигрыше возвращают половину потерь.`;

    const next = profile.goals.find((goal) => !goal.claimed);
    el.goalNext.hidden = !next;
    if (next) {
      el.goalNext.textContent = `🎯 ${numFmt.format(next.progress)} / ${numFmt.format(next.target)} ₽`;
      el.goalNext.title = `Следующая цель: ${numFmt.format(next.target)} ₽ чистого выигрыша. `
        + `Награда: ${numFmt.format(next.reward)} ₽, звание «${next.title}» и страховка.`;
    }
    renderTopUp();
  }

  function renderTopUp() {
    const info = Casino.getTopUp();
    el.topUpBtn.disabled = !info.ready;
    el.topUpBtn.classList.toggle('waiting', !info.ready);
    el.topUpBtn.textContent = info.ready
      ? `Бонус + ${numFmt.format(info.amount)} ₽`
      : `Бонус через ${mmss(info.remaining)}`;
    el.topUpBtn.title = info.ready
      ? 'Бесплатные фишки: доступны, заберите бонус'
      : `Следующий бесплатный бонус через ${mmss(info.remaining)}`;
  }

  function gameStatsHTML(gameId) {
    const game = Casino.GAMES[gameId];
    const stats = Casino.stats(gameId);
    const count = stats[game.counterKey] || 0;
    const net = stats.net || 0;
    return `
      <span><b>${numFmt.format(count)}</b> ${game.counterLabel}</span>
      <span>итог <b class="${net > 0 ? 'plus' : net < 0 ? 'minus' : ''}">${signed(net)}</b></span>
    `;
  }

  function renderGames() {
    const cards = Object.values(Casino.GAMES).map((game) => `
      <a class="game-card live" href="${game.href}" style="--accent:${game.color}">
        <span class="game-card-icon" aria-hidden="true">${game.icon}</span>
        <h2 class="game-card-title">${game.title}</h2>
        <p class="game-card-tagline">${game.tagline}</p>
        <div class="game-card-stats">${gameStatsHTML(game.id)}</div>
        <span class="game-card-play">Играть →</span>
      </a>
    `).join('');

    const soon = [
      { icon: '🎲', title: 'Кости', tagline: 'Ставки на суммы и дубли — в планах' },
      { icon: '🂡', title: 'Баккара', tagline: 'Игра на игрока, банкира или ничью' },
    ].map((game) => `
      <div class="game-card soon">
        <span class="game-card-icon" aria-hidden="true">${game.icon}</span>
        <h2 class="game-card-title">${game.title}</h2>
        <p class="game-card-tagline">${game.tagline}</p>
        <span class="game-card-play">Скоро</span>
      </div>
    `).join('');

    el.gamesGrid.innerHTML = cards + soon;
  }

  // ---------- Окна ----------
  let lastFocused = null;

  function openModal(html) {
    lastFocused = document.activeElement;
    el.modalBody.innerHTML = html;
    el.overlay.hidden = false;
    el.modalClose.focus({ preventScroll: true });
    el.modalBody.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', closeModal);
    });
    const reset = el.modalBody.querySelector('[data-action="reset-all"]');
    if (reset) {
      reset.addEventListener('click', () => {
        Casino.resetAll();
        closeModal();
        renderBalance(true);
        renderGames();
      });
    }
  }

  function closeModal() {
    el.overlay.hidden = true;
    el.modalBody.innerHTML = '';
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus({ preventScroll: true });
    }
  }

  // ---------- История ----------
  let historyFilter = 'all';

  function timeLabel(ts) {
    const d = new Date(Number(ts) || Date.now());
    const now = new Date();
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? time : `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${time}`;
  }

  // В общей истории у рулетки показываем сами ставки: выигравшие —
  // в зелёной рамке, чтобы сразу было видно, что сработало.
  function rouletteDetails(entry) {
    const tags = Casino.betTagsHTML(entry.bets, entry.wins);
    if (!tags) return '';
    const bet = Number(entry.bet) || 0;
    const net = Number(entry.net) || 0;
    const payout = Number.isFinite(Number(entry.payout))
      ? Number(entry.payout)
      : Math.max(0, bet + net);
    return `${tags}
      <p class="history-round-payout">выплата ${fmt(payout)}</p>`;
  }

  function historyListHTML(filter) {
    const list = Casino.allHistory(filter);
    if (!list.length) {
      return `<p class="history-empty">Пока пусто. Сыграйте раздачу в блэкджеке или сделайте ставку в рулетке — всё появится здесь.</p>`;
    }
    return `<div class="history-list">${list.map((entry) => {
      const game = Casino.GAMES[entry.game] || { short: entry.game, icon: '🎲' };
      const sign = entry.net > 0 ? 'plus' : entry.net < 0 ? 'minus' : 'zero';
      return `
        <article class="history-round ${sign}">
          <header class="history-round-head">
            <span class="history-round-num">${game.icon} ${game.short}</span>
            <span class="history-round-net ${sign}">${signed(entry.net)}</span>
            <span class="history-round-bet">ставка ${fmt(entry.bet)}</span>
          </header>
          <p class="history-round-summary">${entry.summary || ''}</p>
          ${entry.game === 'roulette' ? rouletteDetails(entry) : ''}
          <header class="history-round-head" style="margin-top:4px">
            <span class="history-round-bet">${timeLabel(entry.ts)}</span>
          </header>
        </article>
      `;
    }).join('')}</div>`;
  }

  function renderHistory() {
    const body = el.modalBody.querySelector('#historyBody');
    if (!body) return;
    const filters = [
      { id: 'all', label: 'Все игры' },
      ...Object.values(Casino.GAMES).map((g) => ({ id: g.id, label: g.short })),
    ];
    body.innerHTML = `
      <div class="history-filter">
        ${filters.map((f) => `<button data-filter="${f.id}" class="${historyFilter === f.id ? 'active' : ''}">${f.label}</button>`).join('')}
      </div>
      <div id="historyList">${historyListHTML(historyFilter)}</div>
    `;
    body.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        historyFilter = btn.dataset.filter;
        renderHistory();
      });
    });
  }

  function openHistory() {
    openModal(`
      <h2>История ставок</h2>
      <div id="historyBody"></div>
      <div class="modal-actions">
        <button class="ghost-btn" data-close>Закрыть</button>
      </div>
    `);
    renderHistory();
  }

  // ---------- Статистика ----------
  function openStats() {
    const rows = Object.values(Casino.GAMES).map((game) => {
      const s = Casino.stats(game.id);
      return `
        <span>${game.icon} ${game.short}</span><span>${numFmt.format(s[game.counterKey] || 0)} ${game.counterLabel}</span>
        <span>Ставок сделано</span><span>${fmt(s.wagered || 0)}</span>
        <span>Побед / поражений</span><span>${numFmt.format(s.wins || 0)} / ${numFmt.format(s.losses || 0)}</span>
        <span>Лучший раунд</span><span>${fmt(s.bestWin || 0)}</span>
        <span>Итог игры</span><span>${signed(s.net || 0)}</span>
      `;
    }).join('');

    const totalNet = Object.values(Casino.GAMES).reduce((sum, g) => sum + (Casino.stats(g.id).net || 0), 0);
    const wagered = Object.values(Casino.GAMES).reduce((sum, g) => sum + (Casino.stats(g.id).wagered || 0), 0);

    openModal(`
      <h2>Статистика</h2>
      <div class="stat-grid">
        ${rows}
        <span>Всего ставок</span><span>${fmt(wagered)}</span>
        <span>Общий итог</span><span>${signed(totalNet)}</span>
        <span>Баланс</span><span>${fmt(Casino.getBalance())}</span>
      </div>
      <p style="margin-top:14px;font-size:12px;color:var(--muted)">
        Статистика каждой игры ведётся отдельно и хранится в этом браузере.
      </p>
      <div class="modal-actions">
        <button class="ghost-btn" data-action="history">История ставок</button>
        <button class="primary-btn" data-close>Закрыть</button>
      </div>
    `);
    const historyBtn = el.modalBody.querySelector('[data-action="history"]');
    if (historyBtn) historyBtn.addEventListener('click', openHistory);
  }

  function openReset() {
    openModal(`
      <h2>Сбросить казино?</h2>
      <p>Баланс вернётся к <span class="accent">1 000 ₽</span>, история ставок и статистика
      всех игр обнулятся. Цели, звания и страховки тоже сбросятся — а таймер бонуса
      останется, чтобы сброс не давал лишнюю бесплатную тысячу.</p>
      <div class="modal-actions">
        <button class="ghost-btn" data-close>Отмена</button>
        <button class="primary-btn" data-action="reset-all">Сбросить всё</button>
      </div>
    `);
  }

  // ---------- Цели и звания ----------
  function goalCardHTML(goal) {
    const pct = goal.target > 0 ? Math.min(100, Math.round((goal.progress / goal.target) * 100)) : 0;
    const state = goal.claimed ? 'claimed' : goal.reached ? 'reached' : '';
    const status = goal.claimed
      ? '✓ Получено'
      : goal.reached
        ? 'Цель достигнута'
        : `${numFmt.format(goal.progress)} из ${numFmt.format(goal.target)} ₽`;
    return `
      <article class="goal-card ${state}">
        <header class="goal-head">
          <span class="goal-target">${numFmt.format(goal.target)} ₽</span>
          <span class="goal-reward">+${numFmt.format(goal.reward)} ₽</span>
        </header>
        <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goal.target}"
          aria-valuenow="${goal.progress}"><i style="width:${pct}%"></i></div>
        <div class="goal-meta">
          <span>${status}</span>
          <span>${goal.title} · 🛡 ${goal.shields} · лимит +${numFmt.format(Casino.LIMIT_PER_GOAL)} ₽</span>
        </div>
      </article>
    `;
  }

  function openGoals(notices = []) {
    renderProfile();
    const profile = Casino.profile();
    const topUp = profile.topUp;
    const celebrate = notices.length
      ? `<div class="goal-celebrate">
          <b>Цель достигнута!</b>
          ${notices.map((n) => `<span>${numFmt.format(n.target)} ₽ → +${numFmt.format(n.reward)} ₽ · звание «${n.title}» · 🛡 ${n.shields}</span>`).join('')}
        </div>`
      : '';

    openModal(`
      <h2>Цели и звания</h2>
      ${celebrate}
      <div class="profile-strip">
        <span class="title-chip big">${profile.title}</span>
        <span class="shield-chip ${profile.shields ? '' : 'empty'}">🛡 ${profile.shields}</span>
        <span class="profile-stat">Чистый выигрыш: <b class="${profile.net > 0 ? 'plus' : profile.net < 0 ? 'minus' : ''}">${signed(profile.net)}</b></span>
        <span class="profile-stat">Лимит ставки: <b>${fmt(profile.maxBet)}</b></span>
        <span class="profile-stat">Бонус: <b>${topUp.ready ? 'доступен' : `через ${mmss(topUp.remaining)}`}</b></span>
      </div>
      <p class="goals-note">
        Цели считаются по чистому выигрышу за всё время: выплаты минус ставки во всех играх.
        Круговорот ставок цель не приближает — казино всегда оставляет себе 2,7%.
        Достигнутые цели не отбираются, даже если потом уйти в минус.
      </p>
      <div class="goal-list">${profile.goals.map(goalCardHTML).join('')}</div>
      <p class="goals-note">
        За каждую цель — деньги на баланс, новое звание, страховка и +1 000 ₽ к лимиту стола.
        Страховка при проигрыше возвращает половину потерь и тратится автоматически.
      </p>
      <div class="modal-actions">
        <button class="primary-btn" data-close>Понятно</button>
      </div>
    `);
  }

  // ---------- События ----------
  el.soundBtn.addEventListener('click', () => {
    Casino.setSound(!Casino.getSound());
    Casino.save();
    renderSound();
    if (Casino.getSound()) beep({ freq: 880, dur: 0.06 });
  });

  el.topUpBtn.addEventListener('click', () => {
    const result = Casino.claimTopUp();
    if (!result.ok) {
      renderTopUp();
      return;
    }
    Casino.save();
    renderBalance(true);
    renderGames();
    renderTopUp();
    beep({ freq: 880, dur: 0.08, type: 'triangle' });
  });

  el.historyBtn.addEventListener('click', openHistory);
  el.heroHistoryBtn.addEventListener('click', openHistory);
  el.statsBtn.addEventListener('click', openStats);
  el.goalsBtn.addEventListener('click', () => openGoals());
  el.titleChip.addEventListener('click', () => openGoals());
  el.goalNext.addEventListener('click', () => openGoals());
  el.resetBtn.addEventListener('click', openReset);
  el.modalClose.addEventListener('click', closeModal);
  el.overlay.addEventListener('click', (event) => {
    if (event.target === el.overlay) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (!el.overlay.hidden && event.key === 'Escape') closeModal();
  });

  function renderSound() {
    const on = Casino.getSound();
    el.soundBtn.textContent = on ? '🔊' : '🔇';
    el.soundBtn.classList.toggle('off', !on);
    el.soundBtn.setAttribute('aria-pressed', String(on));
  }

  // ---------- Старт ----------
  // Загрузка хаба = ни одна игра не идёт: возвращаем ставки, «зависшие» в раундах.
  const refunded = Casino.settleAllPending();
  Casino.checkGoals();
  Casino.save();

  const goalNotices = Casino.takeGoalNotices();

  renderSound();
  renderGames();
  renderBalance(false);
  if (goalNotices.length) setTimeout(() => openGoals(goalNotices), 220);

  // Обратный отсчёт бонуса обновляем, пока открыт хаб.
  setInterval(renderTopUp, 1000);
  if (refunded > 0) {
    setTimeout(() => {
      const node = document.createElement('div');
      node.className = 'delta plus';
      node.textContent = signed(refunded);
      el.deltaLayer.appendChild(node);
      setTimeout(() => node.remove(), 1500);
    }, 120);
  }
})();
