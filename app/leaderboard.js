// One bounty's standings as a virtual list: only the rows in view (plus a small buffer) exist in the DOM.
// First paint reads the light rows=first body (top 10); the whole board (rows=all) is read once, when needed.
export async function renderLeaderboard(ctx, slug) {
  const query = { phase: ctx.params.get('phase') || '', view: ctx.params.get('view') || '' };
  const path = `/competitions/${encodeURIComponent(slug)}/leaderboard`;
  const [bounty, body] = await Promise.all([
    getRevalidated(`/competitions/${encodeURIComponent(slug)}?submissions=summary`, { force: ctx.force }),
    getRevalidated(withQuery(path, { ...query, rows: 'first' }), { force: ctx.force }),
  ]);
  if (!ctx.alive()) return;
  noteLive(slug, liveOf(bounty));

  const top = rowsOf(body);
  const state = {
    ctx, slug, path, query, bounty, body,
    pool: [], keys: new Set(), shown: 0,
    full: false, loading: null, next: null, busy: false, failed: '',
    total: Array.isArray(body.rest) ? top.length + body.rest.length : Number(bounty.submissionCount) || top.length,
    q: ctx.params.get('q') || '',
    list: [], drawn: { first: -1, last: -1, list: null, height: 0 },
    columns: columnsOf(body),
    prizes: prizesOf(bounty),
  };
  addRows(state, top);
  state.shown = Math.min(PAGE_SIZE, state.pool.length);
  if (state.total <= state.pool.length) state.full = true;

  bounty.title ||= slug;
  setTitle(`Leaderboard · ${bounty.title}`);
  ctx.el.innerHTML = pageHTML(state);
  state.box = ctx.el.querySelector('.lb-box');
  state.rows = ctx.el.querySelector('.lb-body');
  state.more = ctx.el.querySelector('[data-more]');
  state.line = ctx.el.querySelector('.lb-line');
  state.none = ctx.el.querySelector('.lb-none');
  state.table = ctx.el.querySelector('.lb-table');

  const search = ctx.el.querySelector('input[type="search"]');
  ctx.on(search, 'input', () => {
    state.q = search.value.trim();
    keepQuery(state);
    if (state.q && !state.full) loadFullBoard(state).then(() => { if (ctx.alive()) refresh(state, true); });
    refresh(state, true);
  });
  ctx.on(state.box, 'scroll', () => { drawVirtualRows(state); nearEnd(state); }, { passive: true });
  ctx.on(state.box, 'keydown', event => moveFocus(state, event));
  ctx.on(window, 'resize', () => drawVirtualRows(state, true));
  ctx.on(state.more, 'click', () => followNextCursor(state));
  ctx.on(ctx.el, 'click', event => {
    if (!event.target.closest('[data-clear]')) return;
    search.value = '';
    state.q = '';
    keepQuery(state);
    refresh(state, true);
    search.focus();
  });
  for (const picker of ctx.el.querySelectorAll('select[data-pick]')) {
    ctx.on(picker, 'change', () => {
      const params = new URLSearchParams(ctx.params);
      params.set(picker.dataset.pick, picker.value);
      params.delete('q');
      location.hash = `${hrefLeaderboard(slug)}?${params}`;
    });
  }
  refresh(state, true);
  ctx.announce(`${bounty.title} leaderboard, top ${count(state.pool.length)} of ${count(state.total)}`);
  // Normal-sized boards fill in on their own (the drawn rows stay put); a search typed before the fill covers everything.
  if (state.q && !state.full) await loadFullBoard(state).then(() => { if (ctx.alive()) refresh(state, true); });
  else if (!state.full && state.total <= AUTO_FILL) await followNextCursor(state, true);
}

// Rebuilds only the visible window; rows that stay in view keep their nodes (and their loaded avatars).
function drawVirtualRows(state, force = false) {
  const { box, rows, list } = state;
  const height = rowHeightOf(box);
  const head = box.querySelector('.lb-head').offsetHeight;
  // On the two-pane layout the box fills the pane; what is left under its last whole row becomes margin, so the
  // sheet always ends on a row edge instead of slicing a row in half.
  if (FILLS_PANE.matches && !box.classList.contains('lb-fit')) {
    const room = box.clientHeight + (parseFloat(box.style.marginBottom) || 0) - head;
    box.style.marginBottom = `${room % height}px`;
  } else if (box.style.marginBottom) box.style.marginBottom = '';
  const seen = box.classList.contains('lb-fit') ? list.length : Math.ceil(box.clientHeight / height);
  const top = Math.max(0, box.scrollTop - head);
  const first = Math.max(0, Math.floor(top / height) - BUFFER);
  const last = Math.min(list.length, Math.floor(top / height) + seen + BUFFER);
  const drawn = state.drawn;
  if (!force && drawn.list === list && drawn.first === first && drawn.last === last && drawn.height === height) return;
  Object.assign(drawn, { first, last, list, height });
  box.style.setProperty('--row', `${height}px`);

  if (!rows.firstElementChild) rows.append(spacer(), spacer());
  const lead = rows.firstElementChild;
  const tail = rows.lastElementChild;
  lead.style.height = `${first * height}px`;
  tail.style.height = `${(list.length - last) * height}px`;
  const wanted = new Set();
  for (let index = first; index < last; index += 1) wanted.add(list[index].key);
  const kept = new Map();
  for (const node of [...rows.querySelectorAll('[data-key]')]) {
    if (wanted.has(node.dataset.key)) kept.set(node.dataset.key, node);
    else node.remove();
  }
  const fresh = [];
  for (let index = first; index < last; index += 1) if (!kept.has(list[index].key)) fresh.push(rowHTML(state, list[index], index));
  const holder = document.createElement('div');
  holder.innerHTML = fresh.join('');
  // Kept rows never move (moving a node drops its focus); new rows slot in around them.
  let cursor = lead.nextElementSibling;
  for (let index = first; index < last; index += 1) {
    const node = kept.get(list[index].key) ?? holder.firstElementChild;
    node.setAttribute('aria-rowindex', index + 2);
    if (node !== cursor) rows.insertBefore(node, cursor);
    else cursor = cursor.nextElementSibling;
  }
}

// Reveals the next 50 ranks: reads the full board once if only the top 10 are in, follows a next_cursor if the API
// sends one, and otherwise shows rows already in memory. Nothing is refetched.
async function followNextCursor(state, quiet = false) {
  const { ctx } = state;
  if (state.busy || state.q) return;
  const from = state.shown;
  if (!state.full) await loadFullBoard(state);
  else if (state.shown >= state.pool.length && state.next) {
    state.busy = true;
    state.failed = '';
    paintStatus(state);
    try {
      const page = await getPage(state.path, { ...state.query, rows: 'all' }, state.next, { force: ctx.force });
      if (!ctx.alive()) return;
      addRows(state, page.rows);
      state.next = page.next;
    } catch (failure) {
      if (!ctx.alive()) return;
      state.failed = failure.message || 'make.fun did not answer.';
    } finally {
      state.busy = false;
    }
  }
  if (!ctx.alive()) return;
  state.shown = Math.min(state.pool.length, Math.ceil((state.shown + 1) / PAGE_SIZE) * PAGE_SIZE);
  refresh(state);
  if (state.shown > from && !quiet) ctx.announce(`Ranks ${from + 1} to ${state.shown} loaded`);
}

const ROW_HEIGHT = 36;
const PAGE_SIZE = 50;
const BUFFER = 6;
const FILLS_PANE = globalThis.matchMedia?.('(min-width: 1000px)') ?? { matches: false };
const PHONE_ROW = 44;
const NARROW = 560;
const AUTO_FILL = 2000;
const VIEW_LABEL = { overall: 'Overall', performance: 'Performance', cost: 'Cost', efficiency: 'Efficiency' };

// Row links stay out of the Tab order (an endless list would trap Tab before the Load button); arrows walk the rows.
const STEPS = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
function moveFocus(state, event) {
  const { box, list } = state;
  if (!list.length || event.altKey || event.ctrlKey || event.metaKey) return;
  const here = event.target.closest('.lb-body [role="row"]');
  const at = here ? Number(here.getAttribute('aria-rowindex')) - 2 : -1;
  let to;
  if (event.key in STEPS) to = at + STEPS[event.key];
  else if (event.key === 'Home') to = 0;
  else if (event.key === 'End') to = list.length - 1;
  else return;
  event.preventDefault();
  to = Math.max(0, Math.min(list.length - 1, to));
  const height = rowHeightOf(box);
  const head = box.querySelector('.lb-head').offsetHeight;
  const top = head + to * height;
  if (top - head < box.scrollTop) box.scrollTop = top - head;
  else if (top + height > box.scrollTop + box.clientHeight) box.scrollTop = top + height - box.clientHeight;
  drawVirtualRows(state);
  const row = state.rows.querySelector(`[aria-rowindex="${to + 2}"]`);
  (row?.querySelector('a') ?? row)?.focus({ preventScroll: true });
  nearEnd(state);
}

// The whole board (rows=all), read once; it replaces the top-10 rows, and rows still drawn keep their nodes.
function loadFullBoard(state) {
  const { ctx } = state;
  state.loading ??= (async () => {
    state.busy = true;
    state.failed = '';
    paintStatus(state);
    try {
      const page = await getPage(state.path, { ...state.query, rows: 'all' }, null, { force: ctx.force });
      if (!ctx.alive()) return;
      state.pool = [];
      state.keys = new Set();
      addRows(state, page.rows);
      state.next = page.next;
      state.full = true;
      state.total = Math.max(state.pool.length, state.next ? state.total : 0);
    } catch (failure) {
      if (!ctx.alive()) return;
      state.failed = failure.message || 'make.fun did not answer.';
      state.loading = null;
    } finally {
      state.busy = false;
    }
  })();
  return state.loading;
}

function liveOf(bounty) {
  const live = {};
  // Read straight from this detail body (potOf would prefer an earlier note), so the header and the rail agree.
  const pot = Number(bounty.potUsd ?? bounty.rewardAmount);
  const entries = Number(bounty.submissionCount);
  if (Number.isFinite(pot)) live.pot = pot;
  if (Number.isFinite(entries) && bounty.submissionCount !== null) live.entries = entries;
  return live;
}

function rowHeightOf(box) {
  return box.clientWidth < NARROW ? PHONE_ROW : ROW_HEIGHT;
}

function spacer() {
  const gap = document.createElement('div');
  gap.className = 'lb-gap';
  gap.setAttribute('aria-hidden', 'true');
  return gap;
}

function addRows(state, rows) {
  for (const row of rows) {
    const id = String(row.submission_id ?? row.id ?? `${row.handle}:${row.rank}:${state.pool.length}`);
    if (state.keys.has(id)) continue;
    state.keys.add(id);
    const key = `${id}@${row.rank ?? ''}:${row.prize_rank ?? ''}:${JSON.stringify(row.values ?? null)}`;
    const handle = String(row.handle ?? row.user?.handle ?? '');
    state.pool.push({ key, row, handle, find: `${handle} ${row.title ?? ''}`.toLowerCase() });
  }
}

function refresh(state, toTop = false) {
  const needle = state.q.toLowerCase().replace(/^@/, '');
  state.list = needle ? state.pool.filter(item => item.find.includes(needle)) : state.pool.slice(0, state.shown);
  const empty = state.list.length === 0;
  state.table.setAttribute('aria-rowcount', String((needle ? state.list.length : totalOf(state)) + 1));
  state.box.hidden = empty;
  state.none.hidden = !empty;
  if (empty && needle && !state.full && state.loading) state.none.innerHTML = `<div class="loading" role="status">Searching all ${count(totalOf(state))} standings…</div>`;
  else if (empty) state.none.innerHTML = state.pool.length
    ? emptyHTML(`No loaded entry matches “${state.q}”.`, 'Search looks at builder handles and entry titles.', '<button class="btn" type="button" data-clear>Clear search</button>')
    : emptyHTML('No entries yet.', state.body.phase?.scores_visible === false ? 'Scores for this phase are not public yet.' : 'Ranked entries appear here as make.fun scores them.', `<a class="btn" href="${hrefBounty(state.slug)}">Read the bounty</a>`);
  if (toTop) state.box.scrollTop = 0;
  paintStatus(state);
  if (!empty) drawVirtualRows(state, true);
}

function nearEnd(state) {
  if (state.q || state.busy || !hasMore(state)) return;
  const left = state.box.scrollHeight - state.box.scrollTop - state.box.clientHeight;
  if (left < rowHeightOf(state.box) * 10) followNextCursor(state);
}

const hasMore = state => !state.full || state.shown < state.pool.length || Boolean(state.next);
const totalOf = state => !state.full || state.next ? Math.max(state.pool.length, state.total) : state.pool.length;

function paintStatus(state) {
  const total = totalOf(state);
  const plus = state.next && total <= state.pool.length ? '+' : '';
  let text;
  if (state.q) text = `${count(state.list.length)} ${state.list.length === 1 ? 'match' : 'matches'} for “${state.q}” in ${count(state.pool.length)} loaded rows`;
  else if (!state.pool.length) text = 'No ranked entries';
  else if (!state.full) text = `Showing 1–${count(state.shown)} of ${count(total)} · ${state.busy ? 'reading the full board' : 'the rest loads on request'}`;
  else if (hasMore(state)) text = `Showing 1–${count(state.shown)} of ${count(total)}${plus}`;
  else text = `Showing all ${count(state.pool.length)} ranked entries`;
  if (state.q && !state.full && state.loading) text = `Searching all ${count(total)} standings…`;
  else if (state.busy && state.full) text += ' · loading…';
  if (state.failed) text += ` · ${state.failed} Press Load to retry.`;
  state.line.textContent = text;
  state.more.hidden = state.q !== '' || !hasMore(state);
  state.more.disabled = state.busy;
  state.more.textContent = state.busy ? 'Loading…' : state.full ? `Load next ${PAGE_SIZE}` : `Load all ${count(total)} standings`;
  state.more.classList.toggle('primary', !state.full);
  // A big board waiting for its button shows a box that fits its ten rows instead of an empty sheet.
  state.box.classList.toggle('lb-fit', !state.full && state.total > AUTO_FILL);
}

function keepQuery(state) {
  const params = new URLSearchParams(state.ctx.params);
  if (state.q) params.set('q', state.q);
  else params.delete('q');
  state.ctx.setQuery(params);
}

function pageHTML(state) {
  const { bounty, body, slug } = state;
  const paid = state.prizes.size;
  const phases = Array.isArray(bounty.phases) ? bounty.phases : [];
  const views = Array.isArray(body.views) ? body.views : [];
  const phaseKey = body.phase?.key ?? '';
  const pickers = [
    phases.length > 1 ? pickerHTML('phase', 'Phase', phases.map(item => [item.key, item.title ?? item.key]), phaseKey) : '',
    views.length > 1 ? pickerHTML('view', 'View', views.map(key => [key, VIEW_LABEL[key] ?? key]), body.view ?? '') : '',
  ].join('');
  const live = body.phase?.finalized_at ? 'Final standings' : body.phase?.scores === 'live' ? 'Live scores' : 'Standings';
  const score = state.columns.primary;
  return `<article class="lb">
  <header class="lb-top">
    <p class="label">Leaderboard${body.phase?.title ? ` · ${esc(body.phase.title)} phase` : ''}</p>
    <h1 class="title"><a href="${hrefBounty(slug)}">${esc(bounty.title)}</a></h1>
    <p class="lb-strip">${statusHTML(bounty)}<span class="tag">${usd(potOf(bounty))} pot</span>${['open', 'soon'].includes(phaseOf(bounty)) ? countdownHTML(bounty) : ''}<span class="lb-fact"><b class="num">${count(bounty.submissionCount)}</b> entries</span>${paid ? `<span class="lb-fact"><b class="num">${paid}</b> paid places</span>` : ''}<span class="lb-fact">${live}</span></p>
  </header>
  <div class="lb-tools">
    <nav class="tabs" aria-label="Bounty pages"><a href="${hrefBounty(slug)}">Overview</a><a href="${hrefLeaderboard(slug)}" aria-current="page">Leaderboard</a></nav>
    <label class="field lb-search"><span class="sr">Search the leaderboard</span><input type="search" placeholder="Search @builder or entry" value="${esc(state.q)}" autocomplete="off" spellcheck="false"></label>
    ${pickers}
  </div>
  <p class="lb-line label" role="status"></p>
  <div class="lb-box" tabindex="0" role="region" aria-label="Standings: arrow keys move between rows, Enter opens a builder">
    <div class="lb-table" role="table" aria-label="${esc(bounty.title)} standings">
      <div class="lb-head" role="rowgroup"><div class="lb-row" role="row" aria-rowindex="1">
        <span role="columnheader" class="c-rank">Rank</span>
        <span role="columnheader" class="c-who">Builder</span>
        <span role="columnheader" class="c-entry">Entry</span>
        <span role="columnheader" class="c-score"><span class="lb-long">${esc(score?.title ?? 'Score')}</span><span class="lb-short" aria-hidden="true">${isMicro(score) ? 'Win %' : esc(score?.title ?? 'Score')}</span></span>
        <span role="columnheader" class="c-rec">${state.columns.record ? 'W–D–L' : ''}</span>
        <span role="columnheader" class="c-prize">Prize</span>
        <span role="columnheader" class="c-time">Submitted</span>
      </div></div>
      <div class="lb-body" role="rowgroup"></div>
    </div>
  </div>
  <div class="lb-none" hidden></div>
  <div class="lb-foot"><button class="btn" type="button" data-more>Load next ${PAGE_SIZE}</button></div>
</article>`;
}

function pickerHTML(name, title, options, current) {
  return `<label class="field lb-pick"><span class="label">${title}</span><select data-pick="${name}">${options.map(([key, text]) => `<option value="${esc(key)}"${key === current ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
}

function rowHTML(state, item, index) {
  const { row, handle, key } = item;
  const rank = Number(row.rank) || null;
  const place = Number(row.prize_rank) || null;
  const prize = place ? state.prizes.get(place) : undefined;
  const chip = `rank${prize !== undefined ? ' top' : ''}${prize !== undefined && rank && rank <= 3 ? ' podium' : ''}`;
  const score = scoreOf(state.columns, row);
  const record = recordOf(state.columns, row);
  const who = handle
    ? `<a class="who" href="${hrefProfile(handle)}" tabindex="-1">${avatarHTML(row, 24)}<span>${esc(handle)}</span></a>`
    : `<span class="who">${avatarHTML(row, 24)}<span>Entrant withheld</span></span>`;
  const sent = Date.parse(row.received_at ?? row.submitted_at ?? '');
  const title = row.title || 'Untitled entry';
  return `<div class="lb-row${rank ? '' : ' off'}" role="row" tabindex="-1" data-rank="${rank ?? index + 1}" data-key="${esc(key)}" aria-rowindex="${index + 2}">
    <span role="cell" class="c-rank"><span class="${chip}">${rank ?? '—'}</span></span>
    <span role="cell" class="c-who">${who}</span>
    <span role="cell" class="c-entry" title="${esc(title)}">${esc(title)}</span>
    <span role="cell" class="c-score num"><b>${esc(score.main)}</b>${score.plus ? `<small>±${esc(score.plus)}</small>` : ''}</span>
    <span role="cell" class="c-rec num"${record.games ? ` title="${esc(record.games)} games"` : ''}>${esc(record.text)}</span>
    <span role="cell" class="c-prize">${prize !== undefined ? `<span class="tag">${usd(prize)}</span>` : ''}</span>
    <span role="cell" class="c-time num">${Number.isFinite(sent) ? `<time datetime="${new Date(sent).toISOString()}" title="${esc(whenUTC(row.received_at ?? row.submitted_at))}">${shortWhen(sent)}</time>` : '—'}</span>
  </div>`;
}

// The ranking column, its interval columns, and whether the board carries a win/draw/loss record.
function columnsOf(body) {
  const all = (Array.isArray(body.columns) ? body.columns : []).filter(column => !column.hidden);
  const primary = all.find(column => column.key === body.rank_key) ?? all[0] ?? null;
  const low = all.find(column => /interval_low/.test(column.source ?? ''));
  const high = all.find(column => /interval_high/.test(column.source ?? ''));
  const keys = new Set(all.map(column => column.key));
  const tally = keys.has('wins') && keys.has('losses');
  const judged = rowsOf(body).some(row => row.judge && Number.isFinite(Number(row.judge.wins)));
  return { primary, low, high, tally, record: tally || judged };
}

const isMicro = column => /_micro$/.test(column?.source ?? '');
const percent = micro => `${(micro / 10000).toFixed(1)}%`;

function scoreOf(columns, row) {
  const column = columns.primary;
  if (!column) return { main: '—', plus: '' };
  const value = row.values?.[column.key];
  const numeric = value === null || value === undefined || value === '' ? NaN : Number(value);
  if (!Number.isFinite(numeric)) return { main: value ? String(row.display?.[column.key] ?? value) : '—', plus: '' };
  if (!isMicro(column)) {
    const digits = Math.min(3, Math.max(0, Number(column.precision) || 0));
    return { main: numeric.toLocaleString('en-US', { maximumFractionDigits: digits }), plus: '' };
  }
  const low = Number(row.interval?.low ?? row.values?.[columns.low?.key]);
  const high = Number(row.interval?.high ?? row.values?.[columns.high?.key]);
  const plus = Number.isFinite(low) && Number.isFinite(high) && high >= low ? ((high - low) / 20000).toFixed(1) : '';
  return { main: percent(numeric), plus };
}

function recordOf(columns, row) {
  const source = row.judge && Number.isFinite(Number(row.judge.wins)) ? row.judge : columns.tally ? row.values ?? {} : null;
  if (!source) return { text: '', games: '' };
  const part = value => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '0';
  };
  if (source.wins === undefined || source.wins === null) return { text: '—', games: '' };
  const games = source.matches ?? (Number(source.wins) || 0) + (Number(source.draws) || 0) + (Number(source.losses) || 0);
  return { text: `${part(source.wins)}–${part(source.draws)}–${part(source.losses)}`, games: part(games) };
}

// Place -> prize in dollars: the live amounts (fee share included) when the API has them, else the base rewards map.
function prizesOf(bounty) {
  const prizes = new Map();
  for (const [place, amount] of Object.entries(bounty.rewards ?? {})) {
    if (Number(amount) > 0) prizes.set(Number(place), Number(amount));
  }
  for (const reward of Array.isArray(bounty.rewardsNow) ? bounty.rewardsNow : []) {
    const amount = Number(reward.amountUsd ?? reward.amount_usd ?? reward.amount);
    if (Number(reward.place) && amount > 0) prizes.set(Number(reward.place), amount);
  }
  return prizes;
}

function shortWhen(at) {
  const day = new Date(at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return `${day} ${new Date(at).toISOString().slice(11, 16)}`;
}

import { getPage, getRevalidated, rowsOf, withQuery } from './api.js';
import { avatarHTML, count, countdownHTML, emptyHTML, esc, hrefBounty, hrefLeaderboard, hrefProfile, noteLive, phaseOf, potOf, setTitle, statusHTML, usd, whenUTC } from './app.js';
