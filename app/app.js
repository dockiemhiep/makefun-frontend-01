import { onStats } from './api.js';

const boardRoute = [/^\/$/, () => import('./board.js'), 'mountBoard'];
const bountyRoute = [/^\/bounty\/([^/]+)$/, () => import('./bounty.js'), 'renderBounty'];
const leaderboardRoute = [/^\/bounty\/([^/]+)\/leaderboard$/, () => import('./leaderboard.js'), 'renderLeaderboard'];
const profileRoute = [/^\/u\/([^/]+)$/, () => import('./profile.js'), 'renderProfile'];
const buildersRoute = [/^\/builders$/, () => import('./profile.js'), 'renderBuilders'];
const ROUTES = { board: boardRoute, bounty: bountyRoute, leaderboard: leaderboardRoute, profile: profileRoute, builders: buildersRoute };

export const hrefBounty = slug => `#/bounty/${encodeURIComponent(slug)}`;
export const hrefLeaderboard = slug => `${hrefBounty(slug)}/leaderboard`;
export const hrefProfile = handle => `#/u/${encodeURIComponent(handle)}`;

export const esc = text => String(text ?? '').replace(/[&<>"']/g, mark => `&#${mark.charCodeAt(0)};`);
export const count = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US');

export function usd(value, cents = false) {
  const amount = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(amount)) return '—';
  const digits = cents || !Number.isInteger(amount) ? 2 : 0;
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 });
}

// The list endpoint lags a bounty's own page. A view that has just read the page shares its pot and entry count,
// and for five minutes the board row shows that reading, so both panes post one figure.
const liveFacts = new Map();
export function noteLive(slug, { pot, entries } = {}) {
  const known = liveFacts.get(slug);
  const reading = value => value === null || value === undefined || value === '' ? NaN : Number(value);
  const next = { pot: reading(pot), entries: reading(entries), at: Date.now() };
  liveFacts.set(slug, next);
  if (!Object.is(known?.pot, next.pot) || !Object.is(known?.entries, next.entries)) dispatchEvent(new CustomEvent('tote:live', { detail: slug }));
}
const liveFact = (bounty, name) => {
  const fact = liveFacts.get(bounty.slug);
  return fact && Date.now() - fact.at < 300000 && Number.isFinite(fact[name]) ? fact[name] : null;
};
export const potOf = bounty => liveFact(bounty, 'pot') ?? (Number(bounty.potUsd ?? bounty.rewardAmount ?? 0) || 0);
export const entriesOf = bounty => liveFact(bounty, 'entries') ?? (Number(bounty.submissionCount) || 0);
export const feeOf = bounty => Math.max(0, Number(bounty.entryFeeUsd ?? bounty.entry_fee_usd) || 0);
export const opensAt = bounty => Date.parse(bounty.opensAt ?? bounty.opens_at ?? '');
export const closesAt = bounty => Date.parse(bounty.deadline ?? bounty.closes_at ?? '');

const VOID = ['cancelled', 'canceled'];
const DONE = ['resolved', 'closed', 'completed', 'finalized', 'finished'];
export const PHASE_LABEL = { open: 'Open', soon: 'Opens soon', closed: 'Entries closed', done: 'Finished', void: 'Cancelled' };

// The API may keep saying "open" after the deadline until results post, so the clock decides.
export function phaseOf(bounty, now = Date.now()) {
  if (VOID.includes(bounty.status)) return 'void';
  if (DONE.includes(bounty.status)) return 'done';
  if (now >= closesAt(bounty)) return 'closed';
  if (now < opensAt(bounty) || bounty.status === 'draft') return 'soon';
  return bounty.status === 'open' ? 'open' : 'closed';
}

export function timeLeft(until, now = Date.now()) {
  const total = Math.max(0, Math.ceil((until - now) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor(total / 60) % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
}

export function whenUTC(iso, clock = true) {
  const at = Date.parse(iso ?? '');
  if (!Number.isFinite(at)) return 'Not announced';
  const day = new Date(at).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  return clock ? `${day} · ${new Date(at).toISOString().slice(11, 16)} UTC` : day;
}

export function statusHTML(bounty) {
  const phase = phaseOf(bounty);
  return `<span class="status ${phase}">${PHASE_LABEL[phase]}</span>`;
}

// A ticking clock: app.js rewrites every [data-until] each second and re-renders the route once when one runs out.
export function countdownHTML(bounty) {
  const phase = phaseOf(bounty);
  const until = phase === 'open' ? closesAt(bounty) : phase === 'soon' ? opensAt(bounty) : NaN;
  // No clock is posted for a time that is unknown or already past: an expired one would ask for a re-render forever.
  if (!Number.isFinite(until) || until <= Date.now()) return `<span class="until over">${phase === 'open' ? 'No deadline' : PHASE_LABEL[phase]}</span>`;
  const lead = phase === 'soon' ? 'opens in ' : '';
  const tail = phase === 'open' ? ' left' : '';
  const hot = phase === 'open' && until - Date.now() < 86400000 ? ' hot' : '';
  return `<time class="until${hot}" datetime="${new Date(until).toISOString()}" data-until="${until}" data-lead="${lead}" data-tail="${tail}">${lead}${timeLeft(until)}${tail}</time>`;
}

export function safeLink(url) {
  try {
    const link = new URL(url, 'https://make.fun');
    return /^https?:$/.test(link.protocol) ? link.href : '';
  } catch {
    return '';
  }
}

export function avatarHTML(person = {}, px = 32) {
  const name = String(person.display_name ?? person.displayName ?? person.name ?? person.handle ?? person.username ?? '?');
  const picture = person.avatar?.url_small ?? person.avatar?.url ?? person.image ?? person.avatar_url ?? person.avatarUrl ?? '';
  const src = typeof picture === 'string' && picture ? safeLink(picture) : '';
  // make.fun's images answer CORP same-origin, so crossorigin is set before src.
  const img = src ? `<img crossorigin="anonymous" src="${esc(src)}" alt="" width="${px}" height="${px}" loading="lazy" decoding="async">` : '';
  return `<span class="avatar" style="--px:${px}px" data-initials="${esc(name.replace(/^@/, '').slice(0, 2).toUpperCase())}">${img}</span>`;
}

export function emptyHTML(title, hint = '', actions = '') {
  return `<div class="empty"><h2>${esc(title)}</h2>${hint ? `<p>${esc(hint)}</p>` : ''}${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

export function pagerHTML({ page, pages, more = false, noun = 'Page' }) {
  const last = page >= pages && !more;
  return `<nav class="pager" aria-label="Pages"><button class="btn" type="button" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>← Prev</button><span class="label">${noun} ${page} of ${pages}${more ? '+' : ''}</span><button class="btn" type="button" data-page="${page + 1}"${last ? ' disabled' : ''}>Next →</button></nav>`;
}

export function setTitle(text) {
  document.title = text ? `${text} · make.fun` : 'make.fun bounty board';
}

const WIDE = globalThis.matchMedia?.('(min-width: 1000px)');
let navigation = 0;
let listeners = null;
let flipping = false;
let bar, boardPane, viewPane;

function readHash() {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  return { path: path.replace(/\/+$/, '') || '/', params: new URLSearchParams(query) };
}

export async function renderRoute({ force = false, keepScroll = false } = {}) {
  const turn = ++navigation;
  listeners?.abort();
  listeners = new AbortController();
  window.__shotReady = false;
  const { path, params } = readHash();
  let route = null, name = 'lost', arg = '';
  for (const [known, candidate] of Object.entries(ROUTES)) {
    const hit = candidate[0].exec(path);
    if (!hit) continue;
    try { arg = decodeURIComponent(hit[1] ?? ''); route = candidate; name = known; } catch { route = null; }
    break;
  }
  // Each route names its module and the export that draws it; the module is fetched the first time it is needed.
  const open = ([, load, entry], ...args) => load().then(view => view[entry](...args));
  const wide = WIDE.matches;
  document.body.dataset.route = name;
  for (const link of bar.querySelectorAll('[data-tab]')) {
    const mine = link.dataset.tab === (route === profileRoute || route === buildersRoute ? 'builders' : 'board');
    link.toggleAttribute('aria-current', mine);
  }
  const alive = () => turn === navigation;
  const signal = listeners.signal;
  const ctx = {
    el: viewPane, params, force, wide, alive,
    on: (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal }),
    setQuery(next) {
      const tail = next.toString();
      history.replaceState(null, '', `#${path}${tail ? `?${tail}` : ''}`);
    },
    announce(text) { if (alive()) document.querySelector('#say').textContent = text; },
  };
  viewPane.setAttribute('aria-busy', 'true');
  // The placeholder only replaces the previous page: a view that has already painted keeps its paint.
  const previous = viewPane.firstChild;
  const waiting = setTimeout(() => {
    if (alive() && route !== boardRoute && viewPane.firstChild === previous) viewPane.innerHTML = '<div class="loading" role="status">Reading make.fun…</div>';
  }, 250);
  try {
    const selected = route === bountyRoute || route === leaderboardRoute ? arg : '';
    const board = wide || route === boardRoute
      ? open(boardRoute, boardPane, { params: route === boardRoute ? params : null, selected, force, alive, setQuery: ctx.setQuery })
      : null;
    if (route === boardRoute) {
      // On a wide screen the board's own address posts the bounty closing next beside it.
      const { featured } = await board;
      if (!alive()) return;
      if (wide && featured) await open(bountyRoute, ctx, featured, { peek: true });
      else viewPane.replaceChildren();
      setTitle('');
    } else if (route) {
      await Promise.all([open(route, ctx, arg), board]);
    } else {
      setTitle('Not found');
      viewPane.innerHTML = emptyHTML('Nothing lives at this address.', 'The board lists every bounty.', '<a class="btn primary" href="#/">Open the board</a>');
      await board;
    }
  } catch (failure) {
    if (!alive()) return;
    viewPane.innerHTML = emptyHTML('This page did not load.', failure.message || 'Check the connection and try again.', '<button class="btn primary" type="button" data-retry>Try again</button><a class="btn" href="#/">Open the board</a>');
    ctx.on(viewPane, 'click', event => { if (event.target.closest('[data-retry]')) renderRoute({ force: true }); });
  } finally {
    clearTimeout(waiting);
    if (alive()) {
      viewPane.removeAttribute('aria-busy');
      flipping = false;
      if (!keepScroll) {
        scrollTo(0, 0);
        viewPane.scrollTop = 0;
      }
      window.__shotReady = true;
    }
  }
}

// One pass a second over every visible clock; a clock that runs out flips the route to its closed state once.
function tick() {
  if (document.hidden) return;
  let ranOut = false, inView = false;
  for (const clock of document.querySelectorAll('[data-until]')) {
    const until = Number(clock.dataset.until);
    if (until <= Date.now()) {
      // While a render is still under way the expired clock is left in place and picked up on the next pass.
      if (flipping) continue;
      ranOut = true;
      inView ||= viewPane.contains(clock);
      clock.removeAttribute('data-until');
      continue;
    }
    const text = clock.dataset.lead + timeLeft(until) + clock.dataset.tail;
    if (clock.textContent !== text) clock.textContent = text;
    clock.classList.toggle('hot', clock.dataset.tail !== '' && until - Date.now() < 86400000);
  }
  if (!ranOut) return;
  if (inView || document.body.dataset.route === 'board') {
    flipping = true;
    renderRoute({ keepScroll: true });
  } else {
    // Only a clock on the board rail ran out: the board re-reads the phases and patches its rows and totals,
    // and the page being read beside it keeps its scroll and its place.
    dispatchEvent(new CustomEvent('tote:live'));
  }
}

function boot() {
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = './style.css';
  const styled = new Promise(done => {
    sheet.onload = sheet.onerror = done;
    setTimeout(done, 1500);
  });
  document.head.append(sheet);
  bar = document.querySelector('#bar');
  boardPane = document.querySelector('#board');
  viewPane = document.querySelector('#view');
  boardPane.setAttribute('aria-label', 'Live bounty board');
  viewPane.tabIndex = -1;
  bar.innerHTML = `<a class="skip" href="#view">Skip to content</a>
    <a class="brand" href="#/" translate="no"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 1h4v7.5l6.5-3.8 2 3.5L16 12l6.5 3.8-2 3.5L14 15.500V23h-4v-7.500l-6.500 3.800-2-3.500L8 12 1.500 8.200l2-3.500L10 8.500Z"/></svg><b>make.fun</b><i>tote board</i></a>
    <nav aria-label="Main"><a href="#/" data-tab="board">Bounties</a><a href="#/builders" data-tab="builders">Builders</a></nav>
    <p class="wire" id="wire" title="This session: requests sent, answers revalidated as unchanged by ETag, reads served from the fresh cache"></p>
    <button class="refresh" id="refresh" type="button" aria-label="Refresh live data" title="Refresh live data"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 5v5h-5M4 19v-5h5M6.200 9a7 7 0 0 1 11.600-2.300L20 9M4 15l2.200 2.300A7 7 0 0 0 17.800 15"/></svg></button>
    <p class="sr" id="say" role="status" aria-live="polite"></p>`;
  onStats(stats => {
    document.querySelector('#wire').innerHTML = `<b class="${stats.offline ? 'off' : 'on'}">${stats.offline ? 'Offline · saved data' : 'Live'}</b> ${stats.requests} GET · ${stats.revalidated} unchanged · ${stats.cached} cached`;
  });
  addEventListener('hashchange', () => renderRoute());
  WIDE.addEventListener('change', () => renderRoute({ keepScroll: true }));
  document.querySelector('#refresh').addEventListener('click', () => renderRoute({ force: true, keepScroll: true }));
  document.addEventListener('visibilitychange', tick);
  document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement && event.target.closest('.avatar')) event.target.remove(); }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.isComposing || event.metaKey || event.ctrlKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const search = [...document.querySelectorAll('#view input[type="search"], #board input[type="search"]')].find(field => field.offsetParent);
    if (search) { event.preventDefault(); search.focus(); }
  });
  bar.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); viewPane.focus(); });
  setInterval(tick, 1000);
  styled.then(() => renderRoute());
}

if (globalThis.document) boot();
