// Surface 1: Live Bounty Board with deadline-verified open/judging/resolved tabs and in-place filtering.

import { avatarHtml, bountyState, countdownInfo, dateUtc, esc, intFmt, money, paginateRows, potDetails } from './format.js';

const CATEGORIES = ['All', 'Code', 'Games', 'Trading', 'Security', 'Forecasting', 'Growth', 'Automation'];

export function renderBoardSkeleton() {
  const rows = Array.from({ length: 6 }, () => `
    <div class="ledger-row skeleton-row" aria-hidden="true">
      <div class="skel-block skel-title"></div>
      <div class="skel-block skel-num"></div>
      <div class="skel-block skel-num"></div>
      <div class="skel-block skel-num"></div>
      <div class="skel-block skel-num"></div>
    </div>`).join('');
  return `
    <section class="board-surface" aria-busy="true" aria-label="Loading bounties">
      <div class="page-head">
        <h1>Live Bounties</h1>
        <p class="subhead">Fetching current pots, entry fees, and deadlines from make.fun…</p>
      </div>
      <div class="ledger">${rows}</div>
    </section>`;
}

function sortBounties(list, sortBy, nowMs) {
  const copy = [...list];
  copy.sort((a, b) => {
    const sa = bountyState(a, nowMs);
    const sb = bountyState(b, nowMs);
    if (sa.takingEntries !== sb.takingEntries) return sa.takingEntries ? -1 : 1;

    if (sortBy === 'pot') {
      const diff = potDetails(b).liveUsd - potDetails(a).liveUsd;
      if (Math.abs(diff) > 0.001) return diff;
    } else if (sortBy === 'entries') {
      const diff = (b.submissionCount || 0) - (a.submissionCount || 0);
      if (diff !== 0) return diff;
    } else if (sortBy === 'fee') {
      const fa = Number(a.entryFeeUsd || 0);
      const fb = Number(b.entryFeeUsd || 0);
      if (fb !== fa) return fb - fa;
    }

    const da = Date.parse(a.deadline || '') || 0;
    const db = Date.parse(b.deadline || '') || 0;
    if (sa.takingEntries && sb.takingEntries) {
      // Among open bounties: highlight fee-growing pots first on default sort, else soonest deadline.
      if (sortBy === 'ending') return da - db;
      const pa = potDetails(a);
      const pb = potDetails(b);
      if (pa.grew !== pb.grew && sortBy === 'featured') return pb.grew ? 1 : -1;
      return da - db;
    }
    return db - da;
  });
  return copy;
}

function renderRow(b, nowMs) {
  const state = bountyState(b, nowMs);
  const pot = potDetails(b);
  const cd = countdownInfo(b.deadline, nowMs);
  const slugUrl = `#/bounty/${encodeURIComponent(b.slug)}`;
  const lbUrl = `#/bounty/${encodeURIComponent(b.slug)}/leaderboard`;

  const feeCell = pot.feeUnitUsd > 0
    ? `<span class="pill pill-fee" title="${pot.payers ? `${intFmt(pot.payers)} paid into escrow` : 'Paid once per account into Solana escrow'}">${esc(money(pot.feeUnitUsd, true))} fee</span>`
    : `<span class="muted-cell">No fee</span>`;

  const potExtra = pot.grew
    ? `<span class="pot-growth" title="${esc(money(pot.baseUsd))} base + ${esc(money(pot.feesUsd, true))} from entry fees">+${esc(money(pot.feesUsd, !Number.isInteger(pot.feesUsd)))} fees</span>`
    : `<span class="cell-note">USDC pot</span>`;

  let timePrimary;
  let timeSecondary;
  if (state.key === 'open') {
    timePrimary = `<span class="countdown ${cd.urgent ? 'is-urgent' : ''}" data-deadline="${esc(b.deadline)}">${esc(cd.text)}</span>`;
    timeSecondary = `<span class="cell-note">${esc(dateUtc(b.deadline))}</span>`;
  } else if (state.key === 'judging') {
    timePrimary = `<span class="pill pill-judging">Past deadline</span>`;
    timeSecondary = `<span class="cell-note" data-deadline="${esc(b.deadline)}">${esc(cd.text)}</span>`;
  } else if (state.key === 'upcoming') {
    timePrimary = `<span class="pill pill-upcoming">Opens soon</span>`;
    timeSecondary = `<span class="cell-note">${esc(dateUtc(b.opensAt))}</span>`;
  } else {
    timePrimary = `<span class="pill pill-resolved">Resolved</span>`;
    timeSecondary = b.winner?.handle
      ? `<a class="winner-inline" href="#/u/${encodeURIComponent(b.winner.handle)}">${avatarHtml(b.winner.image, b.winner.handle, 16)}<span>@${esc(b.winner.handle)}</span></a>`
      : `<span class="cell-note">${esc(dateUtc(b.deadline))}</span>`;
  }

  return `
    <article class="ledger-row state-${state.key}">
      <div class="col-main">
        <div class="row-topline">
          <span class="status-dot dot-${state.key}" aria-hidden="true"></span>
          <a class="row-title" href="${slugUrl}">${esc(b.title)}</a>
          ${b.category ? `<span class="cat-tag">${esc(b.category)}</span>` : ''}
          ${b.side_bets?.trading_now ? `<span class="tag-subtle" title="On-chain side market active">Market live</span>` : ''}
        </div>
        ${b.summary ? `<p class="row-summary">${esc(b.summary)}</p>` : ''}
      </div>
      <div class="col-pot" data-label="Live Pot">
        <strong class="pot-value ${pot.grew ? 'is-growing' : ''}">${esc(pot.liveText)}</strong>
        ${potExtra}
      </div>
      <div class="col-fee" data-label="Entry Fee">
        ${feeCell}
      </div>
      <div class="col-time" data-label="Deadline">
        ${timePrimary}
        ${timeSecondary}
      </div>
      <div class="col-entries" data-label="Entries">
        <a class="entries-link" href="${lbUrl}">
          <strong>${intFmt(b.submissionCount)}</strong>
          <span>${b.submissionCount === 1 ? 'entry' : 'entries'} →</span>
        </a>
      </div>
    </article>`;
}

export function renderBoardSurface(container, data, state, onChange) {
  const allItems = Array.isArray(data?.items) ? data.items : [];
  const nowMs = Date.now();

  const buckets = { open: [], judging: [], resolved: [], all: allItems };
  let openPotSum = 0;
  let openWithFeeCount = 0;

  for (const item of allItems) {
    const st = bountyState(item, nowMs);
    if (st.key === 'open' || st.key === 'upcoming') {
      buckets.open.push(item);
      openPotSum += potDetails(item).liveUsd;
      if (Number(item.entryFeeUsd) > 0) openWithFeeCount++;
    } else if (st.key === 'judging') {
      buckets.judging.push(item);
    } else {
      buckets.resolved.push(item);
    }
  }

  const presentCategories = CATEGORIES.filter(
    (c) => c === 'All' || allItems.some((b) => b.category === c),
  );

  // Build static scaffold once per route visit so typing in search never drops focus.
  if (!container.querySelector('#board-results')) {
    container.innerHTML = `
      <section class="board-surface">
        <div class="board-header">
          <div>
            <h1>Live Bounty Board</h1>
            <p class="subhead">
              <strong>${intFmt(buckets.open.length)} open by deadline</strong>
              <span class="sep">·</span>
              <strong class="ink-emerald">${esc(money(openPotSum))}</strong> live USDC in open pots
              ${openWithFeeCount ? `<span class="sep">·</span><span>${intFmt(openWithFeeCount)} growing with entry fees</span>` : ''}
              ${buckets.judging.length ? `<span class="sep">·</span><span>${intFmt(buckets.judging.length)} past deadline in judging</span>` : ''}
            </p>
          </div>
        </div>

        <div class="controls-bar">
          <div class="seg-tabs" role="tablist" aria-label="Bounty lifecycle filter">
            <button type="button" role="tab" data-tab="open">Open now <span class="tab-count">${intFmt(buckets.open.length)}</span></button>
            <button type="button" role="tab" data-tab="judging" title="API status may still read open after deadline until results publish">Judging <span class="tab-count">${intFmt(buckets.judging.length)}</span></button>
            <button type="button" role="tab" data-tab="resolved">Resolved <span class="tab-count">${intFmt(buckets.resolved.length)}</span></button>
            <button type="button" role="tab" data-tab="all">All <span class="tab-count">${intFmt(allItems.length)}</span></button>
          </div>

          <div class="filter-controls">
            <label class="sr-only" for="board-search">Filter bounties</label>
            <input id="board-search" class="filter-input" type="search" placeholder="Filter bounties… (/)" value="${esc(state.q || '')}" autocomplete="off">
            <label class="sr-only" for="board-sort">Sort bounties</label>
            <select id="board-sort" class="filter-select">
              <option value="featured">Featured &amp; ending soon</option>
              <option value="pot">Largest live pot</option>
              <option value="ending">Closing soonest</option>
              <option value="entries">Most entries</option>
              <option value="fee">Paid-entry first</option>
            </select>
          </div>
        </div>

        <div class="cat-strip" role="group" aria-label="Category filter">
          ${presentCategories.map((cat) => `<button type="button" class="cat-pill" data-cat="${esc(cat)}">${esc(cat)}</button>`).join('')}
        </div>

        <div id="board-results"></div>
      </section>`;

    container.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => onChange({ tab: btn.dataset.tab, page: 1 }));
    });
    container.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => onChange({ cat: btn.dataset.cat, page: 1 }));
    });
    const searchEl = container.querySelector('#board-search');
    searchEl.addEventListener('input', () => onChange({ q: searchEl.value, page: 1 }));
    const sortEl = container.querySelector('#board-sort');
    sortEl.addEventListener('change', () => onChange({ sort: sortEl.value, page: 1 }));
    container.querySelector('#board-results').addEventListener('click', (e) => {
      const pageBtn = e.target.closest('[data-page]');
      if (pageBtn && !pageBtn.disabled) {
        onChange({ page: Number(pageBtn.dataset.page) });
      }
    });
  }

  // Sync active control states without touching input selection.
  const activeTab = buckets[state.tab] ? state.tab : 'open';
  container.querySelectorAll('[data-tab]').forEach((btn) => {
    const active = btn.dataset.tab === activeTab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  const activeCat = state.cat || 'All';
  container.querySelectorAll('[data-cat]').forEach((btn) => {
    const active = btn.dataset.cat === activeCat;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const sortEl = container.querySelector('#board-sort');
  if (sortEl && sortEl.value !== (state.sort || 'featured')) {
    sortEl.value = state.sort || 'featured';
  }

  const q = (state.q || '').trim().toLowerCase();
  const baseList = buckets[activeTab] || buckets.open;
  const filtered = baseList.filter((b) => {
    if (activeCat !== 'All' && b.category !== activeCat) return false;
    if (!q) return true;
    const hay = `${b.title || ''} ${b.slug || ''} ${b.summary || ''} ${b.category || ''} ${b.winner?.handle || ''}`.toLowerCase();
    return hay.includes(q);
  });

  const sorted = sortBounties(filtered, state.sort || 'featured', nowMs);
  const paged = paginateRows(sorted, state.page || 1, 25);
  const resultsEl = container.querySelector('#board-results');

  const noteHtml = activeTab === 'judging'
    ? `<p class="section-note">These bounties have passed their entry deadline; the API keeps <code>status: "open"</code> until final judging and payouts settle.</p>`
    : '';

  if (paged.total === 0) {
    resultsEl.innerHTML = `
      ${noteHtml}
      <div class="empty-box">
        <p>No bounties match the current filter.</p>
        <button type="button" class="btn-secondary" data-reset="1">Reset filters</button>
      </div>`;
    const resetBtn = resultsEl.querySelector('[data-reset]');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const inp = container.querySelector('#board-search');
        if (inp) inp.value = '';
        onChange({ tab: 'open', cat: 'All', q: '', sort: 'featured', page: 1 });
      });
    }
    return;
  }

  const pagerHtml = paged.totalPages > 1
    ? `<nav class="pager" aria-label="Board pagination">
        <span class="pager-info">Showing ${intFmt(paged.start)}–${intFmt(paged.end)} of ${intFmt(paged.total)}</span>
        <div class="pager-btns">
          <button type="button" class="btn-secondary" data-page="${paged.page - 1}" ${paged.page <= 1 ? 'disabled' : ''}>Previous</button>
          <span class="pager-page">Page ${paged.page} / ${paged.totalPages}</span>
          <button type="button" class="btn-secondary" data-page="${paged.page + 1}" ${paged.page >= paged.totalPages ? 'disabled' : ''}>Next</button>
        </div>
      </nav>`
    : '';

  resultsEl.innerHTML = `
    ${noteHtml}
    <div class="ledger" role="list">
      <div class="ledger-head" aria-hidden="true">
        <span>Bounty</span>
        <span class="num-head">Live Pot</span>
        <span class="num-head">Entry Fee</span>
        <span class="num-head">Time Left</span>
        <span class="num-head">Leaderboard</span>
      </div>
      ${paged.slice.map((b) => renderRow(b, nowMs)).join('')}
    </div>
    ${pagerHtml}`;
}
