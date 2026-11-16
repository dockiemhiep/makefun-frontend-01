// Surface 4 (loaded on demand via import()): Account public profile (#/u/<handle>) and Builders directory (#/rankings).

import { avatarHtml, bountyState, dateUtc, esc, intFmt, microRate, microUsd, money, paginateRows, resolveMediaUrl, shortDateUtc } from './format.js';

function shortWallet(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatSolutionScore(score) {
  if (!score) return '—';
  const title = score?.column?.title || 'Score';
  const src = score?.column?.source || '';
  if (src.endsWith('win_rate_micro') && score.value !== null && score.value !== undefined) {
    return `${title}: ${microRate(score.value)}`;
  }
  if ((title.toLowerCase().includes('micro-usdc') || src.includes('micro_usd')) && score.value !== null && score.value !== undefined) {
    const cleanTitle = title.replace(/\s*\(micro-USDC\)/i, '');
    return `${cleanTitle}: ${microUsd(score.value)}`;
  }
  if (src.endsWith('_micro') && score.value !== null && score.value !== undefined) {
    return `${title}: ${microRate(score.value)}`;
  }
  const disp = score.display ?? score.value;
  if (disp === null || disp === undefined || disp === '') return '—';
  return `${title}: ${disp}`;
}

export function renderProfileSurface(container, prof) {
  const rec = prof.record || {};
  const solutions = Array.isArray(prof.solutions) ? prof.solutions : [];
  const payouts = Array.isArray(prof.payouts) ? prof.payouts : [];
  const avatarSrc = prof.avatar?.url || prof.image || '';

  const extLinks = [];
  if (prof.github_login) {
    extLinks.push(`<a class="ext-pill" href="https://github.com/${encodeURIComponent(prof.github_login)}" target="_blank" rel="noopener noreferrer">GitHub · @${esc(prof.github_login)}</a>`);
  }
  if (prof.x?.username) {
    const xUrl = prof.x.url || `https://x.com/${encodeURIComponent(prof.x.username)}`;
    extLinks.push(`<a class="ext-pill" href="${esc(xUrl)}" target="_blank" rel="noopener noreferrer">X · @${esc(prof.x.username)}</a>`);
  }
  if (prof.discord?.username) {
    const dLabel = prof.discord.global_name || prof.discord.username;
    extLinks.push(
      prof.discord.url
        ? `<a class="ext-pill" href="${esc(prof.discord.url)}" target="_blank" rel="noopener noreferrer">Discord · ${esc(dLabel)}</a>`
        : `<span class="ext-pill">Discord · ${esc(dLabel)}</span>`,
    );
  }
  if (prof.wallet?.address) {
    const wLabel = `Solana · ${shortWallet(prof.wallet.address)}`;
    extLinks.push(
      prof.wallet.explorer_url
        ? `<a class="ext-pill mono" href="${esc(prof.wallet.explorer_url)}" target="_blank" rel="noopener noreferrer" title="${esc(prof.wallet.address)}">${esc(wLabel)}</a>`
        : `<span class="ext-pill mono">${esc(wLabel)}</span>`,
    );
  }

  const ui = { tab: 'solutions', q: '', page: 1 };

  container.innerHTML = `
    <article class="profile-surface">
      <nav class="subnav" aria-label="Profile navigation">
        <a class="back-link" href="#/">← Bounty board</a>
        <a class="back-link" href="#/rankings">Top builders →</a>
      </nav>

      <header class="profile-card">
        <div class="profile-identity">
          ${avatarHtml(avatarSrc, prof.handle, 64)}
          <div class="profile-meta">
            <div class="profile-names">
              <h1>${esc(prof.display_name || `@${prof.handle}`)}</h1>
              ${prof.display_name ? `<span class="handle-badge">@${esc(prof.handle)}</span>` : ''}
              ${prof.house ? '<span class="tag-subtle">House account</span>' : ''}
            </div>
            ${prof.bio ? `<p class="profile-bio">${esc(prof.bio)}</p>` : ''}
            <div class="profile-subline">
              ${prof.joined_at ? `<span>Joined ${esc(shortDateUtc(prof.joined_at))}</span>` : ''}
              ${extLinks.length ? `<div class="ext-links">${extLinks.join('')}</div>` : ''}
            </div>
          </div>
        </div>

        <dl class="facts-strip profile-stats">
          <div class="fact-cell">
            <dt>Prize Money Earned</dt>
            <dd><strong class="fact-big ink-emerald">${esc(money(rec.prize_usd || 0, Number(rec.prize_usd) % 1 !== 0))}</strong><span class="fact-sub">USDC paid</span></dd>
          </div>
          <div class="fact-cell">
            <dt>Wins</dt>
            <dd><strong class="fact-big">${intFmt(rec.competitions_won)}</strong><span class="fact-sub">1st place finishes</span></dd>
          </div>
          <div class="fact-cell">
            <dt>Podiums</dt>
            <dd><strong class="fact-big">${intFmt(rec.podium_finishes)}</strong><span class="fact-sub">2nd &amp; 3rd finishes</span></dd>
          </div>
          <div class="fact-cell">
            <dt>Placed / Entered</dt>
            <dd><strong class="fact-big">${intFmt(rec.competitions_placed)} / ${intFmt(rec.competitions_entered)}</strong><span class="fact-sub">Bounties</span></dd>
          </div>
          <div class="fact-cell">
            <dt>Best Placement</dt>
            <dd><strong class="fact-big">${rec.best_placement ? `#${intFmt(rec.best_placement)}` : '—'}</strong><span class="fact-sub">All-time peak</span></dd>
          </div>
        </dl>
      </header>

      <div class="controls-bar">
        <div class="seg-tabs" role="tablist" aria-label="Profile history">
          <button type="button" role="tab" data-ptab="solutions" class="is-active">Entries &amp; Solutions <span class="tab-count">${intFmt(solutions.length)}</span></button>
          <button type="button" role="tab" data-ptab="payouts">USDC Payouts <span class="tab-count">${intFmt(payouts.length)}</span></button>
        </div>
        <div class="filter-controls">
          <label class="sr-only" for="prof-search">Filter profile history</label>
          <input id="prof-search" class="filter-input" type="search" enterkeyhint="search" placeholder="Filter entries… (/)" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">
        </div>
      </div>

      <div id="prof-results"></div>
    </article>`;

  const resultsEl = container.querySelector('#prof-results');
  const searchInput = container.querySelector('#prof-search');

  function paintTab() {
    container.querySelectorAll('[data-ptab]').forEach((b) => {
      const active = b.dataset.ptab === ui.tab;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    });

    const q = ui.q.trim().toLowerCase();

    if (ui.tab === 'payouts') {
      const filteredPayouts = payouts.filter((p) => {
        if (!q) return true;
        return `${p.competition?.title || ''} ${p.competition?.slug || ''}`.toLowerCase().includes(q);
      });
      if (!filteredPayouts.length) {
        resultsEl.innerHTML = `<div class="empty-box"><p>No published on-chain payouts match this view.</p>${q ? '<div class="error-actions"><button type="button" class="btn-secondary" data-clear-prof="1">Clear filter</button></div>' : ''}</div>`;
        return;
      }
      resultsEl.innerHTML = `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Place</th>
                <th>Bounty</th>
                <th class="num">Amount</th>
                <th class="num col-hide-sm">Paid At</th>
                <th class="num">Solana Tx</th>
              </tr>
            </thead>
            <tbody>
              ${filteredPayouts
                .map((p) => {
                  const cSlug = p.competition?.slug;
                  const rankHtml = p.place <= 3 ? `<span class="rank-badge rank-top-${p.place}">#${intFmt(p.place)}</span>` : `<span class="rank-plain">#${intFmt(p.place)}</span>`;
                  return `<tr>
                    <td>${rankHtml}</td>
                    <td>${cSlug ? `<a class="row-title" href="#/bounty/${encodeURIComponent(cSlug)}">${esc(p.competition.title || cSlug)}</a>` : esc(p.competition?.title || '—')}</td>
                    <td class="num"><strong class="ink-emerald">${esc(money(p.amount_usd, true))}</strong></td>
                    <td class="num muted-cell col-hide-sm">${esc(dateUtc(p.paid_at))}</td>
                    <td class="num">${p.explorer_url ? `<a class="mono" translate="no" href="${esc(p.explorer_url)}" target="_blank" rel="noopener noreferrer">${esc(shortWallet(p.signature || 'View'))} ↗</a>` : '—'}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`;
      return;
    }

    const filteredSolutions = solutions.filter((s) => {
      if (!q) return true;
      return `${s.title || ''} ${s.competition?.title || ''} ${s.competition?.slug || ''} ${s.competition?.category || ''}`.toLowerCase().includes(q);
    });
    const paged = paginateRows(filteredSolutions, ui.page, 25);

    if (!paged.total) {
      resultsEl.innerHTML = `<div class="empty-box"><p>No public entries match this filter.</p>${q ? '<div class="error-actions"><button type="button" class="btn-secondary" data-clear-prof="1">Clear filter</button></div>' : ''}</div>`;
      return;
    }

    const pagerHtml = paged.totalPages > 1
      ? `<nav class="pager" aria-label="Profile entries pagination">
          <span class="pager-info">Showing ${intFmt(paged.start)}–${intFmt(paged.end)} of ${intFmt(paged.total)}</span>
          <div class="pager-btns">
            <button type="button" class="btn-secondary" data-page="${paged.page - 1}" ${paged.page <= 1 ? 'disabled' : ''}>Prev</button>
            <span class="pager-page">${paged.page} / ${paged.totalPages}</span>
            <button type="button" class="btn-secondary" data-page="${paged.page + 1}" ${paged.page >= paged.totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </nav>`
      : '';

    resultsEl.innerHTML = `
      <div class="solutions-list">
        ${paged.slice
          .map((s) => {
            const comp = s.competition || {};
            const slugEnc = encodeURIComponent(comp.slug || '');
            const thumb = resolveMediaUrl(s.artifact?.preview_url || '');
            const compState = bountyState(comp);
            const placeHtml = s.placement
              ? (s.placement <= 3
                  ? `<span class="rank-badge rank-top-${s.placement}">#${intFmt(s.placement)}</span>`
                  : `<span class="rank-plain">#${intFmt(s.placement)}</span>`)
              : `<span class="pill pill-${compState.key}">${esc(compState.label)}</span>`;
            const scoreStr = formatSolutionScore(s.score);
            const prizeHtml = s.prize_usd && Number(s.prize_usd) > 0
              ? `<strong class="ink-emerald">+${esc(money(s.prize_usd, true))}</strong>`
              : '';

            return `
              <article class="solution-row">
                <div class="sol-left">
                  <div class="row-topline">
                    ${placeHtml}
                    <h2 class="row-heading"><a class="row-title" href="#/bounty/${slugEnc}">${esc(comp.title || comp.slug || 'Bounty')}</a></h2>
                    ${comp.category ? `<span class="cat-tag">${esc(comp.category)}</span>` : ''}
                  </div>
                  ${s.title ? `<p class="sol-title">${esc(s.title)}</p>` : ''}
                  <div class="entry-meta">
                    ${scoreStr !== '—' ? `<span>${esc(scoreStr)}</span>` : ''}
                    ${scoreStr !== '—' && s.entered_at ? '<span class="sep">·</span>' : ''}
                    ${s.entered_at ? `<span>Entered ${esc(dateUtc(s.entered_at))}</span>` : ''}
                  </div>
                </div>
                <div class="sol-right">
                  ${thumb ? `<img class="artifact-thumb col-hide-sm" crossorigin="anonymous" loading="lazy" width="52" height="34" alt="" src="${esc(thumb)}">` : ''}
                  ${prizeHtml}
                  <a class="btn-secondary sol-lb-btn" href="#/bounty/${slugEnc}/leaderboard">Leaderboard</a>
                </div>
              </article>`;
          })
          .join('')}
      </div>
      ${pagerHtml}`;
  }

  container.querySelectorAll('[data-ptab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ui.tab = btn.dataset.ptab;
      ui.page = 1;
      paintTab();
    });
  });
  searchInput?.addEventListener('input', () => {
    ui.q = searchInput.value;
    ui.page = 1;
    paintTab();
  });
  resultsEl.addEventListener('click', (e) => {
    const clearBtn = e.target.closest('[data-clear-prof]');
    if (clearBtn) {
      ui.q = '';
      ui.page = 1;
      if (searchInput) searchInput.value = '';
      paintTab();
      return;
    }
    const btn = e.target.closest('[data-page]');
    if (btn && !btn.disabled) {
      ui.page = Number(btn.dataset.page);
      paintTab();
    }
  });

  paintTab();
}

export function renderRankingsSurface(container, rkData, order = 'wins', fetchMore = null) {
  const allItems = Array.isArray(rkData?.items) ? [...rkData.items] : [];
  const seenHandles = new Set(allItems.map((it) => it?.handle).filter(Boolean));
  let nextCursor = rkData?.next_cursor || null;
  const total = rkData?.total ?? allItems.length;
  const ui = { q: '', page: 1, loadingMore: false, loadErr: '' };

  container.innerHTML = `
    <section class="rankings-surface">
      <div class="lb-header">
        <div>
          <h1>Top Builders</h1>
          <p class="subhead"><strong>${intFmt(total)} ranked accounts</strong> across resolved make.fun bounties.</p>
        </div>
        <div class="seg-tabs" role="group" aria-label="Rankings sort order">
          <a class="phase-btn ${order !== 'paid' ? 'is-active' : ''}" ${order !== 'paid' ? 'aria-current="page"' : ''} href="#/rankings?order=wins">Most Wins</a>
          <a class="phase-btn ${order === 'paid' ? 'is-active' : ''}" ${order === 'paid' ? 'aria-current="page"' : ''} href="#/rankings?order=paid">Most Paid USDC</a>
        </div>
      </div>

      <div class="controls-bar">
        <div class="filter-controls">
          <label class="sr-only" for="rk-search">Search builders</label>
          <input id="rk-search" class="filter-input" type="search" enterkeyhint="search" placeholder="Filter @handle… (/)" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">
        </div>
        <div id="rk-top-pager" class="pager-btns"></div>
      </div>

      <div id="rk-results"></div>
    </section>`;

  const resultsEl = container.querySelector('#rk-results');
  const topPagerEl = container.querySelector('#rk-top-pager');
  const searchEl = container.querySelector('#rk-search');

  async function loadNextServerPage(advancePage = false) {
    if (!nextCursor || !fetchMore || ui.loadingMore) return;
    ui.loadingMore = true;
    ui.loadErr = '';
    paint();
    try {
      const more = await fetchMore(nextCursor);
      const incoming = Array.isArray(more?.items) ? more.items : [];
      for (const it of incoming) {
        if (it?.handle && seenHandles.has(it.handle)) continue;
        if (it?.handle) seenHandles.add(it.handle);
        allItems.push(it);
      }
      nextCursor = more?.next_cursor || null;
      if (advancePage) ui.page += 1;
    } catch (err) {
      ui.loadErr = err?.message || 'Could not load further builders.';
    } finally {
      ui.loadingMore = false;
      paint();
    }
  }

  function paint() {
    const q = ui.q.trim().toLowerCase();
    const filtered = allItems.filter((it) => !q || `${it.handle || ''} ${it.display_name || ''}`.toLowerCase().includes(q));
    const paged = paginateRows(filtered, ui.page, 50);
    ui.page = paged.page;

    const hasMoreServer = Boolean(nextCursor && fetchMore);
    const knownTotal = q ? paged.total : Math.max(total, allItems.length);
    const knownPages = q ? paged.totalPages : Math.max(paged.totalPages, Math.ceil(knownTotal / 50));
    const canNext = paged.page < paged.totalPages || (!q && hasMoreServer);

    topPagerEl.innerHTML = paged.total
      ? `<span class="pager-info">Showing ${intFmt(paged.start)}–${intFmt(paged.end)} of ${intFmt(knownTotal)}</span>
         ${
           knownPages > 1
             ? `<button type="button" class="btn-secondary" data-page="${paged.page - 1}" ${paged.page <= 1 || ui.loadingMore ? 'disabled' : ''}>Prev</button>
                <span class="pager-page">${paged.page} / ${knownPages}</span>
                <button type="button" class="btn-secondary" data-rk-next="1" ${!canNext || ui.loadingMore ? 'disabled' : ''}>${ui.loadingMore ? 'Loading…' : 'Next'}</button>`
             : ''
         }`
      : `<span class="pager-info">0 matching (${intFmt(allItems.length)} loaded)</span>`;

    const loadMoreBtnHtml = hasMoreServer
      ? `<button type="button" class="btn-secondary" data-load-more="1" ${ui.loadingMore ? 'disabled' : ''}>${
          ui.loadingMore ? 'Loading…' : `Load more (${intFmt(allItems.length)} / ${intFmt(Math.max(total, allItems.length))} loaded)`
        }</button>`
      : '';

    const errNoteHtml = ui.loadErr
      ? `<p class="section-note" role="alert">${esc(ui.loadErr)}</p>`
      : '';

    if (!paged.total) {
      const clearBtnHtml = q ? `<button type="button" class="btn-secondary" data-clear-rk="1">Clear filter</button>` : '';
      resultsEl.innerHTML = `
        ${errNoteHtml}
        <div class="empty-box">
          <p>No loaded builders match this filter (${intFmt(allItems.length)} of ${intFmt(Math.max(total, allItems.length))} fetched).</p>
          ${clearBtnHtml || loadMoreBtnHtml ? `<div class="error-actions">${clearBtnHtml}${loadMoreBtnHtml}</div>` : ''}
        </div>`;
      return;
    }

    const pagerHtml = knownPages > 1 || hasMoreServer
      ? `<nav class="pager" aria-label="Builders pagination">
          <span class="pager-info">Showing ${intFmt(paged.start)}–${intFmt(paged.end)} of ${intFmt(knownTotal)} (${intFmt(allItems.length)} fetched)</span>
          <div class="pager-btns">
            <button type="button" class="btn-secondary" data-page="${paged.page - 1}" ${paged.page <= 1 || ui.loadingMore ? 'disabled' : ''}>Prev</button>
            <span class="pager-page">${paged.page} / ${knownPages}</span>
            <button type="button" class="btn-secondary" data-rk-next="1" ${!canNext || ui.loadingMore ? 'disabled' : ''}>${ui.loadingMore ? 'Loading…' : 'Next'}</button>
            ${loadMoreBtnHtml}
          </div>
        </nav>`
      : '';

    resultsEl.innerHTML = `
      ${errNoteHtml}
      <div class="table-scroll">
        <table class="data-table rk-table">
          <thead>
            <tr>
              <th class="rank-col">Rank</th>
              <th>Account</th>
              <th class="num">Wins</th>
              <th class="num col-hide-sm">Podiums</th>
              <th class="num col-hide-sm">Placed / Entered</th>
              <th class="num">Total Paid</th>
            </tr>
          </thead>
          <tbody>
            ${paged.slice
              .map((it) => {
                const r = it.record || {};
                const av = it.avatar?.url_small || it.image || '';
                const rankHtml = it.rank <= 3
                  ? `<span class="rank-badge rank-top-${it.rank}">#${intFmt(it.rank)}</span>`
                  : `<span class="rank-plain">#${intFmt(it.rank)}</span>`;
                return `<tr>
                  <td class="rank-cell">${rankHtml}</td>
                  <td>
                    <a class="entrant-link" href="#/u/${encodeURIComponent(it.handle)}">
                      ${avatarHtml(av, it.handle, 28)}
                      <span class="handle-text" translate="no">@${esc(it.handle)}</span>
                      ${it.display_name ? `<span class="muted-cell col-hide-sm">(${esc(it.display_name)})</span>` : ''}
                    </a>
                  </td>
                  <td class="num"><strong>${intFmt(r.competitions_won)}</strong></td>
                  <td class="num col-hide-sm">${intFmt(r.podium_finishes)}</td>
                  <td class="num col-hide-sm muted-cell">${intFmt(r.competitions_placed)} / ${intFmt(r.competitions_entered)}</td>
                  <td class="num"><strong class="ink-emerald">${esc(money(r.prize_usd || 0, true))}</strong></td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      ${pagerHtml}`;
  }

  const handlePagerAction = (e) => {
    const clearBtn = e.target.closest('[data-clear-rk]');
    if (clearBtn) {
      ui.q = '';
      ui.page = 1;
      if (searchEl) searchEl.value = '';
      paint();
      return;
    }
    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn && !pageBtn.disabled) {
      ui.page = Number(pageBtn.dataset.page);
      paint();
      resultsEl.scrollIntoView({ behavior: 'instant', block: 'nearest' });
      return;
    }
    const nextBtn = e.target.closest('[data-rk-next]');
    if (nextBtn && !nextBtn.disabled) {
      const q = ui.q.trim().toLowerCase();
      const filteredLen = allItems.filter((it) => !q || `${it.handle || ''} ${it.display_name || ''}`.toLowerCase().includes(q)).length;
      const loadedPages = Math.max(1, Math.ceil(filteredLen / 50));
      if (ui.page < loadedPages) {
        ui.page += 1;
        paint();
        resultsEl.scrollIntoView({ behavior: 'instant', block: 'nearest' });
      } else if (!q && nextCursor && fetchMore) {
        loadNextServerPage(true);
      }
      return;
    }
    const moreBtn = e.target.closest('[data-load-more]');
    if (moreBtn && !moreBtn.disabled) {
      loadNextServerPage(false);
    }
  };

  topPagerEl.addEventListener('click', handlePagerAction);
  resultsEl.addEventListener('click', handlePagerAction);
  searchEl?.addEventListener('input', () => {
    ui.q = searchEl.value;
    ui.page = 1;
    paint();
  });
  paint();
}
