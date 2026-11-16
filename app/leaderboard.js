// Surface 3 (loaded on demand via import()): Bounty leaderboard with 50-row pagination, phase toggle & handle links.

import { avatarHtml, bytesHuman, dateUtc, durationHuman, esc, intFmt, microExact, microRate, microUsd, money, paginateRows, resolveMediaUrl } from './format.js';

function selectDisplayColumns(columns) {
  if (!Array.isArray(columns) || !columns.length) return [];
  const visible = columns.filter((c) => !c.hidden);
  const hasJudgeInterval = visible.some((c) => c.key === 'judge') && visible.some((c) => c.key === 'judge_low');
  const filtered = hasJudgeInterval
    ? visible.filter((c) => c.key !== 'judge_low' && c.key !== 'judge_high')
    : visible;
  return filtered.slice(0, 4);
}

function formatCell(col, row) {
  const rawVal = row?.values?.[col.key];
  const dispVal = row?.display?.[col.key];
  const src = col.source || '';

  if (col.key === 'judge' && src.endsWith('win_rate_micro')) {
    if (rawVal === null || rawVal === undefined) return '<span class="muted-cell">—</span>';
    const low = row?.values?.judge_low;
    const high = row?.values?.judge_high;
    const ci = low !== null && low !== undefined && high !== null && high !== undefined
      ? `<span class="ci-sub" title="90% confidence interval: ${esc(microExact(low))} – ${esc(microExact(high))}">${esc(microRate(low))}–${esc(microRate(high))}</span>`
      : '';
    const record = row?.judge && Number.isFinite(row.judge.matches)
      ? `<span class="ci-sub">${intFmt(row.judge.wins)}W·${intFmt(row.judge.draws)}D·${intFmt(row.judge.losses)}L</span>`
      : '';
    return `<strong class="score-primary" title="Exact rate: ${esc(microExact(rawVal))}">${esc(microRate(rawVal))}</strong>${ci || record}`;
  }

  if (src.endsWith('_micro')) {
    return rawVal !== null && rawVal !== undefined ? `<strong>${esc(microRate(rawVal))}</strong>` : '<span class="muted-cell">—</span>';
  }
  if (col.key === 'bytes' || src.endsWith('_bytes')) {
    return rawVal !== null && rawVal !== undefined ? `<span>${esc(bytesHuman(rawVal))}</span>` : '<span class="muted-cell">—</span>';
  }
  if (col.key === 'valid') {
    if (rawVal === 1 || dispVal === '1') return '<span class="pill pill-open">Valid</span>';
    if (rawVal === 0 || dispVal === '0') return '<span class="pill pill-judging">Invalid</span>';
    return `<span class="muted-cell">${esc(dispVal ?? rawVal ?? '—')}</span>`;
  }

  const text = dispVal ?? rawVal;
  if (text === null || text === undefined || text === '') return '<span class="muted-cell">—</span>';
  return `<strong>${esc(text)}</strong>`;
}

function rewardMapFromPreview(preview) {
  const map = new Map();
  if (Array.isArray(preview?.rewardsNow)) {
    for (const r of preview.rewardsNow) map.set(Number(r.place), Number(r.amountUsd));
  } else if (preview?.rewards && typeof preview.rewards === 'object') {
    for (const [k, v] of Object.entries(preview.rewards)) map.set(Number(k), Number(v));
  }
  return map;
}

export function renderLeaderboardSurface(container, lb, slug, preview, onSwitchPhase) {
  const compTitle = lb?.competition?.title || preview?.title || slug;
  const slugEnc = encodeURIComponent(slug);
  const currentPhase = lb?.phase?.key || 'dev';
  const allEntries = Array.isArray(lb?.entries) ? lb.entries : [];
  const cols = selectDisplayColumns(lb?.columns);
  const rewardsByPlace = rewardMapFromPreview(preview);

  const ui = { q: '', hideHouse: false, page: 1 };
  const hasHouse = allEntries.some((r) => r.house || r.baseline);

  container.innerHTML = `
    <section class="leaderboard-surface">
      <nav class="subnav" aria-label="Bounty navigation">
        <a class="back-link" href="#/">← Board</a>
        <div class="surface-tabs">
          <a class="surface-tab" href="#/bounty/${slugEnc}">Overview &amp; Rules</a>
          <a class="surface-tab is-active" href="#/bounty/${slugEnc}/leaderboard" aria-current="page">Leaderboard <span class="tab-count">${intFmt(allEntries.length)}</span></a>
        </div>
      </nav>

      <header class="lb-header">
        <div>
          <h1>${esc(compTitle)} — Leaderboard</h1>
          <p class="subhead">
            <strong>${esc(lb?.phase?.title || currentPhase)} phase</strong>
            <span class="sep">·</span>
            <span>${intFmt(allEntries.length)} ${allEntries.length === 1 ? 'entry' : 'entries'}</span>
            ${lb?.phase?.placements_held ? `<span class="sep">·</span><span>Provisional standings (official places finalize after deadline)</span>` : ''}
            ${lb?.phase?.finalized_at ? `<span class="sep">·</span><span>Finalized ${esc(dateUtc(lb.phase.finalized_at))}</span>` : ''}
          </p>
        </div>

        <div class="seg-tabs" role="group" aria-label="Competition phase">
          <button type="button" class="phase-btn ${currentPhase === 'dev' ? 'is-active' : ''}" aria-pressed="${currentPhase === 'dev'}" data-phase="dev">Development</button>
          <button type="button" class="phase-btn ${currentPhase === 'final' ? 'is-active' : ''}" aria-pressed="${currentPhase === 'final'}" data-phase="final">Final</button>
        </div>
      </header>

      <div class="controls-bar">
        <div class="filter-controls">
          <label class="sr-only" for="lb-search">Filter entries by handle or title</label>
          <input id="lb-search" class="filter-input" type="search" enterkeyhint="search" placeholder="Filter @handle or title… (/)" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">
          ${
            hasHouse
              ? `<label class="check-toggle">
                  <input id="lb-hide-house" type="checkbox">
                  <span>Entrants only</span>
                </label>`
              : ''
          }
        </div>
        <div id="lb-top-pager" class="pager-btns"></div>
      </div>

      <div id="lb-results"></div>
    </section>`;

  container.querySelectorAll('[data-phase]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetPhase = btn.dataset.phase;
      if (targetPhase && targetPhase !== currentPhase) onSwitchPhase(targetPhase);
    });
  });

  const searchInput = container.querySelector('#lb-search');
  const houseCheck = container.querySelector('#lb-hide-house');
  const topPagerEl = container.querySelector('#lb-top-pager');
  const resultsEl = container.querySelector('#lb-results');

  function paintRows() {
    const q = ui.q.trim().toLowerCase();
    const filtered = allEntries.filter((r) => {
      if (ui.hideHouse && (r.house || r.baseline)) return false;
      if (!q) return true;
      return `${r.handle || ''} ${r.title || ''}`.toLowerCase().includes(q);
    });

    const paged = paginateRows(filtered, ui.page, 50);
    topPagerEl.innerHTML = paged.total
      ? `<span class="pager-info">Showing ${intFmt(paged.start)}–${intFmt(paged.end)} of ${intFmt(paged.total)}</span>
         ${
           paged.totalPages > 1
             ? `<button type="button" class="btn-secondary" data-page="${paged.page - 1}" ${paged.page <= 1 ? 'disabled' : ''}>Prev</button>
                <span class="pager-page">${paged.page} / ${paged.totalPages}</span>
                <button type="button" class="btn-secondary" data-page="${paged.page + 1}" ${paged.page >= paged.totalPages ? 'disabled' : ''}>Next</button>`
             : ''
         }`
      : '<span class="pager-info">0 matching entries</span>';

    if (paged.total === 0) {
      const reason = allEntries.length === 0
        ? (lb?.phase?.scores_visible === false
            ? 'Scores for this phase are sealed until judging completes. Switch to Development phase to inspect provisional entries.'
            : 'No ranked entries in this phase yet.')
        : 'No entries match your current filter.';
      const resetHtml = allEntries.length > 0 && (ui.q || ui.hideHouse)
        ? `<div class="error-actions"><button type="button" class="btn-secondary" data-clear-lb="1">Clear filter</button></div>`
        : '';
      resultsEl.innerHTML = `<div class="empty-box"><p>${esc(reason)}</p>${resetHtml}</div>`;
      return;
    }

    const rowsHtml = paged.slice
      .map((row, i) => {
        const displayRank = row.rank ?? paged.start + i;
        const prizePlace = row.prize_rank;
        const estReward = prizePlace && rewardsByPlace.has(prizePlace) ? rewardsByPlace.get(prizePlace) : null;
        const thumbRaw = row.judge?.artifact?.preview_url || row.work?.url || '';
        const thumbUrl = resolveMediaUrl(thumbRaw);

        const handleCell = row.handle
          ? `<a class="entrant-link" href="#/u/${encodeURIComponent(row.handle)}">
              ${avatarHtml(row.image, row.handle, 26)}
              <span class="handle-text" translate="no">@${esc(row.handle)}</span>
            </a>`
          : `<span class="entrant-link">${avatarHtml('', 'H', 26)}<span class="muted-cell">House</span></span>`;

        const costStr = microUsd(row.cost?.micro_usd);
        const wallStr = durationHuman(row.build_wall_ms);
        const metaParts = [];
        if (row.house || row.baseline) metaParts.push('<span class="tag-subtle">House anchor</span>');
        if (costStr !== '—') metaParts.push(`<span>Cost ${esc(costStr)}</span>`);
        if (wallStr !== '—') metaParts.push(`<span>Built in ${esc(wallStr)}</span>`);
        const dateExtra = row.received_at
          ? `<span class="col-hide-sm">${metaParts.length ? '<span class="sep">·</span>' : ''}${esc(dateUtc(row.received_at))}</span>`
          : '';

        const rankHtml = displayRank <= 3 && !row.house
          ? `<span class="rank-badge rank-top-${displayRank}">#${intFmt(displayRank)}</span>`
          : `<span class="rank-plain">#${intFmt(displayRank)}</span>`;

        return `
          <tr class="${displayRank <= 3 && !row.house ? `podium-row podium-${displayRank}` : ''}">
            <td class="rank-cell">
              ${rankHtml}
              ${estReward ? `<span class="est-prize" title="Place ${prizePlace} reward at current pot">${esc(money(estReward, !Number.isInteger(estReward)))}</span>` : ''}
            </td>
            <td class="entrant-cell">
              <div class="entrant-wrap">
                ${thumbUrl ? `<img class="artifact-thumb col-hide-sm" crossorigin="anonymous" loading="lazy" width="44" height="28" alt="" src="${esc(thumbUrl)}">` : ''}
                <div class="entrant-body">
                  <div class="entrant-top">${handleCell}</div>
                  ${row.title ? `<div class="entry-title">${esc(row.title)}</div>` : ''}
                  ${metaParts.length || dateExtra ? `<div class="entry-meta">${metaParts.join('<span class="sep">·</span>')}${dateExtra}</div>` : ''}
                </div>
              </div>
            </td>
            ${cols.map((col, idx) => `<td class="num metric-cell ${idx > 0 ? 'col-hide-sm' : ''}" data-label="${esc(col.title)}">${formatCell(col, row)}</td>`).join('')}
          </tr>`;
      })
      .join('');

    const pagerHtml = paged.totalPages > 1
      ? `<nav class="pager" aria-label="Leaderboard pagination">
          <span class="pager-info">Showing ${intFmt(paged.start)}–${intFmt(paged.end)} of ${intFmt(paged.total)}</span>
          <div class="pager-btns">
            <button type="button" class="btn-secondary" data-page="${paged.page - 1}" ${paged.page <= 1 ? 'disabled' : ''}>Prev</button>
            <span class="pager-page">${paged.page} / ${paged.totalPages}</span>
            <button type="button" class="btn-secondary" data-page="${paged.page + 1}" ${paged.page >= paged.totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </nav>`
      : '';

    resultsEl.innerHTML = `
      <div class="table-scroll">
        <table class="data-table lb-table">
          <thead>
            <tr>
              <th class="rank-col">Rank</th>
              <th>Entrant &amp; Entry</th>
              ${cols.map((col, idx) => `<th class="num ${idx > 0 ? 'col-hide-sm' : ''}">${esc(col.title)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      ${pagerHtml}`;
  }

  searchInput?.addEventListener('input', () => {
    ui.q = searchInput.value;
    ui.page = 1;
    paintRows();
  });
  houseCheck?.addEventListener('change', () => {
    ui.hideHouse = houseCheck.checked;
    ui.page = 1;
    paintRows();
  });
  const handlePageClick = (e) => {
    const clearBtn = e.target.closest('[data-clear-lb]');
    if (clearBtn) {
      ui.q = '';
      ui.hideHouse = false;
      ui.page = 1;
      if (searchInput) searchInput.value = '';
      if (houseCheck) houseCheck.checked = false;
      paintRows();
      return;
    }
    const btn = e.target.closest('[data-page]');
    if (btn && !btn.disabled) {
      ui.page = Number(btn.dataset.page);
      paintRows();
      resultsEl.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    }
  };
  topPagerEl.addEventListener('click', handlePageClick);
  resultsEl.addEventListener('click', handlePageClick);

  paintRows();
}
