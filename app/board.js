export async function mountBoard(pane, opts) {
  const { params = null, selected = '', force = false, alive = () => true, setQuery = null } = opts;
  try {
    if (params) readQuery(params);
    board.onBoard = Boolean(params);
    board.params = params;
    board.setQuery = setQuery;
    if (!board.wired) wireBoard(pane);
    if (!board.list.size) {
      pane.innerHTML = '<div class="loading" role="status">Reading the board…</div>';
      board.built = false;
    }
    const read = await readBoard(force);
    if (!alive()) return { featured: null };
    Object.assign(board, read);
    const featured = pickFeatured(params);
    board.reveal = selected && selected !== board.highlight ? selected : '';
    board.highlight = selected || (params && WIDE_RAIL.matches ? featured ?? '' : '');
    if (!board.built) buildBoard(pane);
    paintBoard();
    return { featured };
  } catch (failure) {
    if (!alive()) return { featured: null };
    try {
      board.built = false;
      pane.innerHTML = `<p class="label bd-kicker">The bounty board</p>${emptyHTML('The board did not load.', failure?.message || 'Check the connection and try again.', '<button class="btn primary" type="button" data-retry>Try again</button>')}`;
    } catch {
      // A pane that cannot even show an error is left as it was.
    }
    return { featured: null };
  }
}

export function boardTotals(bounties, now = Date.now()) {
  const live = bounties.filter(bounty => phaseOf(bounty, now) === 'open');
  const pot = live.reduce((sum, bounty) => sum + potOf(bounty), 0);
  const timed = live.filter(bounty => Number.isFinite(closesAt(bounty)));
  const next = timed.reduce((soonest, bounty) => (!soonest || closesAt(bounty) < closesAt(soonest) ? bounty : soonest), null);
  return { open: live.length, pot: Math.round(pot * 100) / 100, next };
}

// The next moment a bounty changes phase by the clock alone: an upcoming one opens or an open one closes. It is
// read from the whole list, not from the rows on screen, and app.js re-renders once when it passes.
export function nextFlip(bounties, now = Date.now()) {
  let soonest = Infinity;
  for (const bounty of bounties) {
    const phase = phaseOf(bounty, now);
    const at = phase === 'soon' ? opensAt(bounty) : phase === 'open' ? closesAt(bounty) : NaN;
    if (at > now && at < soonest) soonest = at;
  }
  return soonest;
}

function patchRowsInPlace(list, shown, highlight) {
  let cursor = list.firstElementChild;
  for (const bounty of shown) {
    let row = rowCache.get(bounty.slug);
    if (!row) {
      row = makeRow();
      rowCache.set(bounty.slug, row);
    }
    fillRow(row, bounty);
    if (bounty.slug === highlight) row.setAttribute('aria-current', 'page');
    else row.removeAttribute('aria-current');
    if (row === cursor) cursor = cursor.nextElementSibling;
    else list.insertBefore(row, cursor);
  }
  while (cursor) {
    const after = cursor.nextElementSibling;
    cursor.remove();
    cursor = after;
  }
}

import { getPage, getRevalidated, withQuery } from './api.js';
import { closesAt, count, countdownHTML, emptyHTML, entriesOf, esc, feeOf, hrefBounty, opensAt, pagerHTML, phaseOf, potOf, renderRoute, usd, watchFlip } from './app.js';

const BOARD_API = '/competitions';
const QUERY = { activity: 'times' };
const PER_PAGE = 12;
const VIEWS = [
  { id: 'open', name: 'Open now', phases: ['open'] },
  { id: 'soon', name: 'Opening soon', phases: ['soon'] },
  { id: 'closed', name: 'Entries closed', phases: ['closed'] },
  { id: 'done', name: 'Finished', phases: ['done', 'void'] },
  { id: 'all', name: 'All', phases: null },
];
const SORTS = { closing: 'Closing soon', pot: 'Biggest pot', entries: 'Most entries' };
const PHASE_ORDER = { open: 0, soon: 1, closed: 2, done: 3, void: 4 };
const WIDE_RAIL = globalThis.matchMedia?.('(min-width: 1000px)') ?? { matches: false };
const rowCache = new Map();

// One board for the whole session: the pane persists across routes, so its state does too.
const board = {
  wired: false, built: false, list: new Map(), cursors: [], next: null, loadingMore: false, moreFailed: false,
  view: 'open', q: '', sort: 'closing', page: 1, onBoard: false, params: null, setQuery: null, highlight: '', reveal: '', parts: null,
};

function readQuery(params) {
  const view = params.get('view');
  board.view = VIEWS.some(entry => entry.id === view) ? view : 'open';
  board.q = (params.get('q') ?? '').slice(0, 80);
  const sort = params.get('sort');
  board.sort = sort in SORTS ? sort : 'closing';
  board.page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
}

function writeQuery() {
  if (!board.onBoard || !board.setQuery) return;
  const next = new URLSearchParams(board.params ?? '');
  const put = (name, value, fallback) => (value && value !== fallback ? next.set(name, value) : next.delete(name));
  put('view', board.view, 'open');
  put('q', board.q.trim(), '');
  put('sort', board.sort, 'closing');
  put('page', String(board.page), '1');
  board.params = next;
  board.setQuery(next);
}

async function readBoard(force) {
  if (force) await getRevalidated(withQuery(BOARD_API, QUERY), { force: true });
  const first = await getPage(BOARD_API, QUERY);
  const list = new Map();
  for (const bounty of first.rows) if (bounty?.slug) list.set(bounty.slug, bounty);
  let next = first.next;
  const kept = [];
  for (const cursor of board.cursors) {
    try {
      const page = await getPage(BOARD_API, QUERY, cursor);
      for (const bounty of page.rows) if (bounty?.slug) list.set(bounty.slug, bounty);
      kept.push(cursor);
      next = page.next;
    } catch {
      break;
    }
  }
  // Handed back, not stored: only the newest navigation's read may replace what the board holds.
  return { list, cursors: kept, next };
}

async function readMore() {
  if (!board.next || board.loadingMore) return;
  board.loadingMore = true;
  board.moreFailed = false;
  paintMore();
  const cursor = board.next;
  try {
    const page = await getPage(BOARD_API, QUERY, cursor);
    for (const bounty of page.rows) if (bounty?.slug && !board.list.has(bounty.slug)) board.list.set(bounty.slug, bounty);
    board.cursors.push(cursor);
    board.next = page.next;
  } catch {
    board.moreFailed = true;
  } finally {
    board.loadingMore = false;
    paintBoard();
  }
}

function pickFeatured(params) {
  const wanted = params?.get('b');
  if (wanted && board.list.has(wanted)) return wanted;
  const { next } = boardTotals([...board.list.values()]);
  if (next) return next.slug;
  const first = board.list.values().next().value;
  return first?.slug ?? null;
}

function buildBoard(pane) {
  const tabs = VIEWS.map(entry => `<button type="button" data-view="${entry.id}" aria-pressed="false">${esc(entry.name)} <small class="num" data-count="${entry.id}">0</small></button>`).join('');
  const sorts = Object.entries(SORTS).map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
  pane.innerHTML = `<header class="bd-top">
      <p class="label bd-kicker">The bounty board</p>
      <dl class="bd-stats">
        <div class="bd-cell bd-open"><dt class="label">Open now</dt><dd class="bd-big num" data-total="open">0</dd></div>
        <div class="bd-cell bd-pots"><dt class="label">Live pots</dt><dd><span class="tag big" data-total="pot">$0</span></dd></div>
        <div class="bd-cell bd-next"><dt class="label">Next deadline</dt><dd><span class="bd-clock" data-total="clock"></span><span class="bd-next-title" data-total="title"></span></dd></div>
      </dl>
    </header>
    <div class="bd-controls">
      <div class="tabs bd-tabs" role="group" aria-label="Filter bounties">${tabs}</div>
      <div class="bd-find">
        <label class="field bd-search"><span class="sr">Search bounties</span><input type="search" placeholder="Search bounties" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>
        <label class="field bd-sort"><span class="sr">Sort by</span><select>${sorts}</select></label>
      </div>
    </div>
    <div class="bd-form">
      <div class="bd-head" aria-hidden="true"><span class="label">Bounty</span><span class="label">Pot</span><span class="label">Fee</span><span class="label">Time left</span><span class="label">Entries</span></div>
      <ol class="bd-rows" aria-label="Bounties"></ol>
      <div class="bd-empty" hidden></div>
    </div>
    <div class="bd-pages"></div>
    <div class="bd-more"></div>`;
  const pick = selector => pane.querySelector(selector);
  board.parts = {
    pane,
    open: pick('[data-total="open"]'), pot: pick('[data-total="pot"]'), clock: pick('[data-total="clock"]'), title: pick('[data-total="title"]'),
    tabs: [...pane.querySelectorAll('[data-view]')], counts: [...pane.querySelectorAll('[data-count]')],
    search: pick('.bd-search input'), sort: pick('.bd-sort select'), form: pick('.bd-form'), rows: pick('.bd-rows'),
    empty: pick('.bd-empty'), pages: pick('.bd-pages'), more: pick('.bd-more'),
  };
  board.built = true;
}

function wireBoard(pane) {
  board.wired = true;
  // A bounty page or leaderboard read a fresher pot or entry count: patch that row and the totals in place.
  addEventListener('tote:live', paintBoard);
  pane.addEventListener('click', event => {
    const hit = event.target.closest('[data-view], [data-page], [data-show-all], [data-more], [data-retry]');
    if (!hit || !pane.contains(hit)) return;
    if (hit.dataset.retry !== undefined) return void renderRoute({ force: true, keepScroll: true });
    if (hit.dataset.more !== undefined) return void readMore();
    if (hit.dataset.view) {
      board.view = hit.dataset.view;
      board.page = 1;
    } else if (hit.dataset.page) {
      board.page = Number(hit.dataset.page) || 1;
    } else {
      board.view = 'all';
      board.q = '';
      board.page = 1;
    }
    writeQuery();
    paintBoard();
    if (hit.dataset.page) board.parts?.form.scrollIntoView({ block: 'nearest' });
  });
  pane.addEventListener('input', event => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'search') return;
    board.q = event.target.value.slice(0, 80);
    board.page = 1;
    writeQuery();
    paintBoard();
  });
  pane.addEventListener('change', event => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    board.sort = event.target.value in SORTS ? event.target.value : 'closing';
    board.page = 1;
    writeQuery();
    paintBoard();
  });
}

function paintBoard() {
  const parts = board.parts;
  if (!board.built || !parts) return;
  const now = Date.now();
  const all = [...board.list.values()];
  const phases = new Map(all.map(bounty => [bounty.slug, phaseOf(bounty, now)]));

  watchFlip(nextFlip(all, now));
  const totals = boardTotals(all, now);
  setText(parts.open, String(totals.open));
  setText(parts.pot, usd(totals.pot));
  const nextKey = totals.next ? `${totals.next.slug}:${closesAt(totals.next)}` : 'none';
  if (parts.clock.dataset.key !== nextKey) {
    parts.clock.dataset.key = nextKey;
    parts.clock.innerHTML = totals.next ? countdownHTML(totals.next) : '<span class="until over">None open</span>';
  }
  setText(parts.title, totals.next ? totals.next.title ?? totals.next.slug : 'Check back soon');
  parts.title.title = totals.next?.title ?? '';

  for (const tab of parts.tabs) tab.setAttribute('aria-pressed', String(tab.dataset.view === board.view));
  for (const badge of parts.counts) {
    const entry = VIEWS.find(view => view.id === badge.dataset.count);
    setText(badge, count(entry.phases ? all.filter(bounty => entry.phases.includes(phases.get(bounty.slug))).length : all.length));
  }
  if (parts.search.value !== board.q && document.activeElement !== parts.search) parts.search.value = board.q;
  if (parts.sort.value !== board.sort) parts.sort.value = board.sort;

  const view = VIEWS.find(entry => entry.id === board.view) ?? VIEWS[0];
  const needle = board.q.trim().toLowerCase();
  const shown = all
    .filter(bounty => !view.phases || view.phases.includes(phases.get(bounty.slug)))
    .filter(bounty => !needle || [bounty.title, bounty.summary, bounty.category, bounty.slug].some(text => String(text ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => compareBounties(a, b, phases));
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const revealAt = board.reveal ? shown.findIndex(bounty => bounty.slug === board.reveal) : -1;
  if (revealAt >= 0) board.page = Math.floor(revealAt / PER_PAGE) + 1;
  board.reveal = '';
  board.page = Math.min(board.page, pages);
  const slice = shown.slice((board.page - 1) * PER_PAGE, board.page * PER_PAGE);

  // Under the open bounties the open tab also posts the ones whose entries just closed, while their results are
  // pending: they never join the open count or the live-pot sum, and sit below a rule that says so.
  const justClosed = view.id === 'open' && !needle && board.page === pages
    ? all.filter(bounty => phases.get(bounty.slug) === 'closed').sort((a, b) => closesAt(b) - closesAt(a)).slice(0, PER_PAGE - slice.length)
    : [];
  const posted = [...slice, ...justClosed];
  patchRowsInPlace(parts.rows, posted, board.highlight);
  for (const row of parts.rows.children) row.classList.toggle('bd-after', row.dataset.slug === justClosed[0]?.slug);
  parts.form.classList.toggle('is-empty', !posted.length);
  parts.empty.hidden = posted.length > 0;
  const emptyKey = posted.length ? '' : `${view.id}|${needle}`;
  if (parts.empty.dataset.key !== emptyKey) {
    parts.empty.dataset.key = emptyKey;
    parts.empty.innerHTML = posted.length ? '' : emptyHTML(
      needle ? `No bounty matches “${board.q.trim()}”.` : `Nothing is ${view.name.toLowerCase()} right now.`,
      needle ? 'Try a shorter word, or look across every bounty.' : 'Other bounties are on the board.',
      '<button class="btn primary" type="button" data-show-all>Show all bounties</button>',
    );
  }
  const pagerKey = pages > 1 ? `${board.page}/${pages}` : '';
  if (parts.pages.dataset.key !== pagerKey) {
    parts.pages.dataset.key = pagerKey;
    parts.pages.innerHTML = pages > 1 ? pagerHTML({ page: board.page, pages, noun: 'Page' }) : '';
  }
  paintMore();
}

function paintMore() {
  const more = board.parts?.more;
  if (!more) return;
  const key = board.next ? `${board.loadingMore}|${board.moreFailed}` : '';
  if (more.dataset.key === key) return;
  more.dataset.key = key;
  more.innerHTML = board.next
    ? `<button class="btn" type="button" data-more${board.loadingMore ? ' disabled' : ''}>${board.loadingMore ? 'Loading more…' : 'Load more bounties'}</button>${board.moreFailed ? '<span class="label">That page did not load. Try again.</span>' : ''}`
    : '';
}

function compareBounties(a, b, phases) {
  if (board.sort === 'pot') return potOf(b) - potOf(a) || closesAt(a) - closesAt(b);
  if (board.sort === 'entries') return entriesOf(b) - entriesOf(a) || potOf(b) - potOf(a);
  const pa = phases.get(a.slug), pb = phases.get(b.slug);
  if (pa !== pb) return PHASE_ORDER[pa] - PHASE_ORDER[pb];
  const at = bounty => (pa === 'open' ? closesAt(bounty) : pa === 'soon' ? opensAt(bounty) : -closesAt(bounty));
  return orderOf(at(a)) - orderOf(at(b));
}

const orderOf = value => (Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER);

function makeRow() {
  const row = document.createElement('li');
  row.className = 'bd-row';
  row.innerHTML = `<div class="bd-name"><a class="bd-title"></a><p class="bd-sub"><span class="label bd-cat"></span><span class="bd-sum"></span></p></div>
    <span class="bd-pot"><span class="tag"></span></span>
    <span class="bd-fee num"><span class="bd-key">Entry </span><b></b></span>
    <span class="bd-left"></span>
    <span class="bd-count num"><b></b><span class="bd-key"> entries</span></span>`;
  return row;
}

function fillRow(row, bounty) {
  const phase = phaseOf(bounty);
  const fee = feeOf(bounty);
  if (row.dataset.slug !== bounty.slug) row.dataset.slug = bounty.slug;
  if (row.dataset.phase !== phase) row.dataset.phase = phase;
  const link = row.querySelector('.bd-title');
  const href = hrefBounty(bounty.slug);
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  setText(link, bounty.title || bounty.slug);
  setText(row.querySelector('.bd-cat'), bounty.category ?? '');
  setText(row.querySelector('.bd-sum'), oneLine(bounty.summary ?? bounty.description));
  setText(row.querySelector('.bd-pot .tag'), usd(potOf(bounty)));
  setText(row.querySelector('.bd-fee b'), fee > 0 ? usd(fee, true) : 'Free');
  row.classList.toggle('is-free', !(fee > 0));
  setText(row.querySelector('.bd-count b'), count(entriesOf(bounty)));
  const clock = row.querySelector('.bd-left');
  const until = phase === 'open' ? closesAt(bounty) : phase === 'soon' ? opensAt(bounty) : NaN;
  const key = `${phase}:${until}`;
  if (clock.dataset.key !== key) {
    clock.dataset.key = key;
    clock.innerHTML = countdownHTML(bounty);
  }
}

function oneLine(text) {
  return String(text ?? '').replace(/[#*_`>\[\]]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}
