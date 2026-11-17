import { get, apiPath, items, nextCursor } from './api.js';
import { escapeHTML as e, encoded, number, dollars, pot, badge, lifecycle, countdown, date, bountyURL, profileURL, arrow, title, empty, paging, markdown, avatar } from './ui.js';

const PAGE_SIZE = 25;
function tabs(slug, standings) {
  return `<nav class="surface-tabs" aria-label="Bounty pages"><a href="${bountyURL(slug)}" ${!standings ? 'aria-current="page"' : ''}>Overview</a><a href="${bountyURL(slug)}/leaderboard" ${standings ? 'aria-current="page"' : ''}>Leaderboard</a></nav>`;
}
function heading(bounty, standings) {
  return `<a class="back-link" href="#/">← All bounties</a><section class="bounty-heading"><div><div class="heading-meta"><span class="category">${e(bounty.category?.name ?? bounty.category ?? 'Code')}</span>${badge(bounty)}</div><h1>${e(bounty.title)}</h1><p>${e(bounty.summary || '')}</p></div><div class="heading-pot"><span>Live prize pot <span class="currency">USDC</span></span><strong>${dollars(pot(bounty))}</strong><span>${Number(bounty.entryFeeUsd) > 0 ? `${dollars(bounty.entryFeeUsd, true)} entry fee` : 'Free to enter'}<span class="dot-separator">/</span>${number(bounty.submissionCount)} entries</span></div></section>${tabs(bounty.slug, standings)}`;
}
function rewards(requirements, bounty) {
  let places = requirements.payout_curve?.places ?? bounty.rewardsNow ?? bounty.rewards ?? [];
  if (!Array.isArray(places)) places = places.places ?? [];
  if (!places.length) return '<p class="muted">The payout schedule has not been published yet.</p>';
  return `<table class="reward-table"><caption class="sr-only">Current rewards by place, including entry-fee shares</caption><thead><tr><th scope="col">Place</th><th scope="col">Reward</th></tr></thead><tbody>${places.map((reward, index) => `<tr><td><span class="place ${index < 3 ? 'top-place' : ''}">${e(reward.place ?? reward.rank ?? index + 1)}</span>${index === 0 ? '<span class="first-label">First place</span>' : ''}</td><td>${dollars(reward.amount_usd ?? reward.amountUsd ?? reward.amount ?? reward.rewardUsd, true)}</td></tr>`).join('')}</tbody></table>`;
}
function checks(requirements) {
  const rules = (requirements.checks ?? []).filter(check => check.applies);
  return rules.length ? `<section class="rules-section"><div class="section-title"><h2>Rules & checks</h2><span>${rules.length} published checks</span></div>${rules.map(rule => `<details class="rule"><summary>${e(rule.check.replaceAll('_', ' '))}<span>+</span></summary><div class="prose">${markdown(rule.description)}${rule.fix ? `<h3>How to meet it</h3>${markdown(rule.fix)}` : ''}</div></details>`).join('')}</section>` : '';
}

export async function renderBounty(ctx, slug, standings = false) {
  const bounty = await get(`/competitions/${encoded(slug)}?submissions=summary`, { force: ctx.force });
  if (!ctx.current()) return;
  title(standings ? `${bounty.title} · Leaderboard` : bounty.title);
  if (standings) return renderLeaderboard(ctx, bounty);
  const requirements = await get(`/competitions/${encoded(slug)}/requirements`, { force: ctx.force });
  if (!ctx.current()) return;
  const deadlines = requirements.deadlines ?? {};
  const potNow = requirements.payout_curve?.total_usd ?? pot(bounty);
  const description = bounty.description || '';
  const rules = bounty.rules ?? bounty.rulesMarkdown ?? '';
  ctx.show(`${heading(bounty, false)}<dl class="bounty-dates"><div><dt>Entries open</dt><dd>${date(bounty.opensAt)}</dd></div><div><dt>Entries close</dt><dd>${date(bounty.deadline || deadlines.entries_close)} · ${countdown(bounty)}</dd></div></dl><div class="detail-layout"><div class="detail-main"><section class="task-section"><h2>The challenge</h2><div class="prose">${markdown(description || bounty.summary)}</div></section>${rules ? `<section class="rules-section"><h2>Competition rules</h2><details class="rule"><summary>Read the full competition rules<span>+</span></summary><div class="prose">${markdown(typeof rules === 'string' ? rules : JSON.stringify(rules, null, 2))}</div></details></section>` : ''}${checks(requirements)}</div>
    <aside class="detail-aside"><section class="prize-panel"><div class="section-title"><h2>The rewards</h2><span>USDC</span></div><div class="prize-total"><span>Current pot</span><strong>${dollars(potNow)}</strong></div><p class="prize-note">${Number(bounty.entryFeeUsd) > 0 ? 'Entry fees grow the pot. Current shares are included below.' : 'Rewards paid to the highest-ranked eligible entries.'}</p>${rewards(requirements, bounty)}</section>
    <section class="schedule-panel"><h2>The timeline</h2><dl><div><dt>Entries open</dt><dd>${date(bounty.opensAt)}</dd></div><div class="deadline-date"><dt>Entries close</dt><dd>${date(bounty.deadline || deadlines.entries_close)}<br>${countdown(bounty)}</dd></div>${deadlines.final_window_start ? `<div><dt>Final starts</dt><dd>${date(deadlines.final_window_start)}</dd></div>` : ''}${deadlines.result_due ? `<div><dt>Result due</dt><dd>${date(deadlines.result_due)}</dd></div>` : ''}</dl></section><a class="button primary full" href="${bountyURL(slug)}/leaderboard">View leaderboard ${arrow}</a><a class="external-link" href="https://make.fun/bounty/${encoded(slug)}" target="_blank" rel="noopener">Open on make.fun ↗</a></aside></div>`);
  ctx.announce(`${bounty.title}, ${lifecycle(bounty)}`);
}

export function scoreText(value, column = {}) {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (/^performance\.judge\.(win_rate|interval_low|interval_high)_micro$/.test(column.source ?? '')) return `${(numeric / 10000).toFixed(1)}%`;
  const label = `${column.key ?? ''} ${column.title ?? column.label ?? column.name ?? ''}`;
  if (/percent|rate/i.test(column.format ?? label)) return `${(numeric <= 1 ? numeric * 100 : numeric).toFixed(1)}%`;
  if (/usd|reward|payout/.test(label)) return dollars(numeric, true);
  if (Number.isInteger(numeric)) return number(numeric);
  return numeric.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
function personOf(row) { return row.entrant ?? row.user ?? row.account ?? row.profile ?? row; }
function valueOf(row, column, index) { return row.values?.[column.key] ?? row.scores?.[column.key] ?? row.values?.[index] ?? row.metrics?.[column.key] ?? row[column.key] ?? null; }

async function renderLeaderboard(ctx, bounty) {
  const params = ctx.route.searchParams;
  let phase = params.get('phase') || '';
  let response = await get(apiPath(`/competitions/${encoded(bounty.slug)}/leaderboard`, { phase }), { force: ctx.force });
  if (!ctx.current()) return;
  let rows = items(response);
  let cursor = nextCursor(response);
  let page = Math.max(1, Number(params.get('page')) || 1);
  let query = params.get('q') || '';
  let busy = false;
  let columns = (response.columns ?? bounty.leaderboard?.columns ?? []).filter(column => !column.hidden);
  if (!columns.length) columns = [{ key: 'score', label: 'Score' }];
  const phases = Array.isArray(bounty.phases) ? bounty.phases : [{ name: 'dev', label: 'Development' }, { name: 'final', label: 'Final' }];
  ctx.show(`${heading(bounty, true)}<section class="standings"><div class="standings-heading"><div><p class="eyebrow">The people behind the work</p><h2>On the leaderboard.</h2></div><span class="board-note">${response.phase?.finalized_at ? 'Final standings' : 'Live standings'}</span></div><div class="toolbar"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span class="sr-only">Search entries</span><input type="search" placeholder="Search an entry or @builder" value="${e(query)}" autocomplete="off"></label><label class="select phase"><span class="sr-only">Competition phase</span><select id="phase"><option value="">Current phase</option>${phases.map(item => { const key = item.key ?? item.id ?? item.name; return `<option value="${e(key)}">${e(item.title ?? item.label ?? (key === 'dev' ? 'Development' : key === 'final' ? 'Final' : key))}</option>`; }).join('')}</select></label></div><div id="standings-results"></div></section>`);
  ctx.el.querySelector('#phase').value = phase;
  function matches() {
    const needle = query.toLowerCase().replace(/^@/, '');
    return rows.filter(row => { const user = personOf(row); return `${row.title ?? row.name ?? ''} ${user.handle ?? ''} ${user.displayName ?? ''}`.toLowerCase().includes(needle); });
  }
  function draw() {
    if (!ctx.current()) return;
    const list = matches();
    if (!cursor) page = Math.min(page, Math.max(1, Math.ceil(list.length / PAGE_SIZE)));
    const shownColumns = columns.slice(0, 4);
    ctx.el.querySelector('#standings-results').innerHTML = (list.length ? `<div class="table-wrap"><table class="leaderboard"><caption class="sr-only">${e(bounty.title)} standings</caption><thead><tr><th scope="col">Rank</th><th scope="col">Entry / builder</th>${shownColumns.map((column, index) => `<th scope="col" ${index ? 'class="secondary-score"' : ''}>${e(column.title ?? column.label ?? column.name ?? column.key)}</th>`).join('')}</tr></thead><tbody>${list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row, index) => {
      const user = personOf(row), handle = user.handle ?? user.username;
      const rank = row.rank ?? row.place;
      const displayRank = rank ?? (page - 1) * PAGE_SIZE + index + 1;
      return `<tr><td><span class="rank ${Number(displayRank) <= 3 ? 'rank-top' : ''}">${e(displayRank)}</span></td><td><div class="entry-cell">${avatar(user)}<div><strong>${e(row.title ?? row.name ?? row.submission?.title ?? 'Untitled entry')}</strong>${handle ? `<a class="builder-link" href="${profileURL(handle)}">@${e(handle)}</a>` : '<span class="muted">Entrant withheld</span>'}${row.status && !['scored', 'graded', 'complete', 'finished'].includes(row.status) ? `<span class="entry-state">${e(row.status.replaceAll('_', ' '))}</span>` : ''}</div></div></td>${shownColumns.map((column, columnIndex) => `<td ${columnIndex ? 'class="secondary-score"' : 'class="primary-score"'}>${e(scoreText(valueOf(row, column, columns.indexOf(column)), column))}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div>` : empty(query ? 'No matching entries.' : response.phase?.scores_visible === false ? 'Standings are not public yet.' : 'The leaderboard is warming up.', query ? 'Try a builder’s handle or another entry title.' : response.phase?.scores_visible === false ? 'This phase’s scores will appear when make.fun publishes them.' : 'Scored entries will appear here as make.fun publishes them.')) + paging(page, list.length, PAGE_SIZE, Boolean(cursor));
    const state = new URLSearchParams();
    if (phase) state.set('phase', phase);
    if (query) state.set('q', query);
    if (page > 1) state.set('page', page);
    ctx.replace(state);
  }
  ctx.listen(ctx.el.querySelector('input'), 'input', event => { query = event.target.value; page = 1; draw(); });
  ctx.listen(ctx.el.querySelector('#phase'), 'change', event => { location.hash = `${bountyURL(bounty.slug)}/leaderboard?phase=${encoded(event.target.value)}`; });
  ctx.listen(ctx.el, 'click', async event => {
    const button = event.target.closest('[data-page]');
    if (!button || busy) return;
    const requested = Number(button.dataset.page);
    if (requested > Math.ceil(matches().length / PAGE_SIZE) && cursor) {
      busy = true; button.disabled = true; button.textContent = 'Loading…';
      try {
        const data = await get(apiPath(`/competitions/${encoded(bounty.slug)}/leaderboard`, { phase, cursor }));
        if (!ctx.current()) return;
        rows = [...rows, ...items(data)];
        const next = nextCursor(data); cursor = next === cursor ? null : next;
      } catch (error) { ctx.problem(error.message); }
      finally { busy = false; }
    }
    if (!ctx.current()) return;
    page = Math.max(1, Math.min(requested, Math.max(1, Math.ceil(matches().length / PAGE_SIZE))));
    draw(); ctx.announce(`Leaderboard page ${page}`);
    ctx.el.querySelector('.standings').scrollIntoView({ block: 'start' });
  });
  draw();
  ctx.announce(`${number(rows.length)} leaderboard entries loaded`);
}
