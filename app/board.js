import { get, apiPath, items, nextCursor } from './api.js';
import { escapeHTML as e, number, dollars, pot, lifecycle, badge, countdown, bountyURL, encoded, arrow, title, empty, paging, deadline } from './ui.js';

const SIZE = 6;
export function boardTotals(bounties, now = Date.now()) {
  const open = bounties.filter(bounty => lifecycle(bounty, now) === 'open');
  return { open: open.length, pot: open.reduce((total, bounty) => total + pot(bounty), 0) };
}
function category(bounty) { return String(bounty.category?.name ?? bounty.category ?? 'Code'); }
function card(bounty) {
  const state = lifecycle(bounty);
  return `<article class="bounty-card"><div class="card-top"><span class="category">${e(category(bounty))}</span>${badge(bounty)}</div>
    <h2><a href="${bountyURL(bounty.slug)}">${e(bounty.title)}</a></h2>
    <p class="card-summary">${e(bounty.summary || 'Build with your agent. Compete on a published metric.')}</p>
    <div class="card-money"><strong>${dollars(pot(bounty))}</strong><span>live pot <span class="currency">USDC</span></span></div>
    <div class="card-foot"><span class="fee">${Number(bounty.entryFeeUsd) > 0 ? `${dollars(bounty.entryFeeUsd, true)} entry` : 'Free entry'}</span><span>${number(bounty.submissionCount)} entries</span>${countdown(bounty)}</div>
    <a class="card-arrow" href="${bountyURL(bounty.slug)}" aria-label="View ${e(bounty.title)}">${arrow}</a>
    </article>`;
}

export async function renderBoard(ctx) {
  title('Bounty board');
  let response = await get('/competitions?activity=times', { force: ctx.force });
  if (!ctx.current()) return;
  let bounties = items(response);
  let cursor = nextCursor(response);
  const params = ctx.route.searchParams;
  let view = ['open', 'upcoming', 'judging', 'finished', 'all'].includes(params.get('view')) ? params.get('view') : 'open';
  let query = params.get('q') || '';
  let selectedCategory = params.get('category') || '';
  let sort = params.get('sort') || 'closing';
  let page = Math.max(1, Number(params.get('page')) || 1);
  let busy = false;
  const initialTotals = boardTotals(bounties);
  ctx.show(`<section class="board-intro"><div><p class="eyebrow">The bounty board</p><h1>Find your next<br><span>thing worth building.</span></h1><p class="intro-copy">Real challenges. Live rewards. Let your agent cook.</p></div>
    <div class="board-numbers"><div><span class="live-label"><i></i>Open now</span><strong id="open-total">${number(initialTotals.open)}</strong></div><div><span>Live rewards <span class="currency">USDC</span></span><strong id="pot-total">${dollars(initialTotals.pot)}</strong></div></div></section>
    <section class="board-workspace" aria-label="Explore bounties"><div class="board-tabs" role="group" aria-label="Bounty status">${[['open', 'Open now'], ['upcoming', 'Upcoming'], ['judging', 'Judging'], ['finished', 'Finished'], ['all', 'All bounties']].map(([key, label]) => `<button type="button" data-view="${key}" aria-pressed="${view === key}">${label}<span data-count="${key}"></span></button>`).join('')}</div>
    <div class="toolbar"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span class="sr-only">Search bounties</span><input type="search" placeholder="Search something worth building…" value="${e(query)}" autocomplete="off"><kbd>/</kbd></label><label class="select"><span class="sr-only">Category</span><select id="category"><option value="">All categories</option></select></label><label class="select"><span class="sr-only">Sort bounties</span><select id="sort"><option value="closing">Closing soon</option><option value="pot">Highest reward</option><option value="entries">Most entries</option><option value="newest">Newest first</option></select></label></div>
    <div class="results-heading"><h2 id="results-label">Open opportunities</h2><span id="result-count"></span></div><div id="board-results"></div></section>`);
  const root = ctx.el;
  const categorySelect = root.querySelector('#category');
  const sortSelect = root.querySelector('#sort');
  sortSelect.value = sort;
  function sync() {
    const state = new URLSearchParams();
    if (view !== 'open') state.set('view', view);
    if (query) state.set('q', query);
    if (selectedCategory) state.set('category', selectedCategory);
    if (sort !== 'closing') state.set('sort', sort);
    if (page > 1) state.set('page', page);
    ctx.replace(state);
  }
  function filtered() {
    const needle = query.trim().toLowerCase();
    return bounties.filter(bounty => (view === 'all' || lifecycle(bounty) === view) && (!selectedCategory || category(bounty) === selectedCategory) && (!needle || `${bounty.title} ${bounty.summary} ${category(bounty)}`.toLowerCase().includes(needle))).sort((a, b) => sort === 'pot' ? pot(b) - pot(a) : sort === 'entries' ? Number(b.submissionCount) - Number(a.submissionCount) : sort === 'newest' ? Date.parse(b.opensAt) - Date.parse(a.opensAt) : (deadline(a) || Infinity) - (deadline(b) || Infinity));
  }
  function draw() {
    if (!ctx.current()) return;
    const totals = boardTotals(bounties);
    root.querySelector('#open-total').textContent = number(totals.open);
    root.querySelector('#pot-total').textContent = dollars(totals.pot);
    root.querySelector('.board-numbers').title = cursor ? 'Totals across loaded bounties. Next loads more from make.fun.' : 'Only bounties currently accepting entries.';
    for (const button of root.querySelectorAll('[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
      button.querySelector('span').textContent = number(button.dataset.view === 'all' ? bounties.length : bounties.filter(bounty => lifecycle(bounty) === button.dataset.view).length);
    }
    const categories = [...new Set(bounties.map(category))].sort();
    categorySelect.innerHTML = '<option value="">All categories</option>' + categories.map(name => `<option value="${e(name)}">${e(name)}</option>`).join('');
    categorySelect.value = selectedCategory;
    const list = filtered();
    const maxPage = Math.max(1, Math.ceil(list.length / SIZE));
    if (!cursor) page = Math.min(page, maxPage);
    root.querySelector('#results-label').textContent = { open: 'Open opportunities', upcoming: 'Opening next', judging: 'In the hands of the judges', finished: 'The finished work', all: 'Every challenge' }[view];
    root.querySelector('#result-count').textContent = `${number(list.length)} ${list.length === 1 ? 'bounty' : 'bounties'}${cursor ? ' loaded' : ''}`;
    root.querySelector('#board-results').innerHTML = (list.length ? `<div class="bounty-grid">${list.slice((page - 1) * SIZE, page * SIZE).map(card).join('')}</div>` : empty(query ? 'No matching bounties.' : `No ${view === 'open' ? 'open' : view} bounties right now.`, query ? 'Try a shorter search or a different category.' : 'Explore the other status tabs to see what’s happening.', '<button type="button" class="button" data-reset>Explore all bounties</button>')) + paging(page, list.length, SIZE, Boolean(cursor));
    sync();
  }
  async function loadNext() {
    if (!cursor || busy) return;
    busy = true;
    const button = root.querySelector('[data-page]:last-child');
    if (button) { button.disabled = true; button.textContent = 'Loading…'; }
    try {
      response = await get(apiPath('/competitions', { activity: 'times', cursor }));
      if (!ctx.current()) return;
      bounties = [...new Map([...bounties, ...items(response)].map(bounty => [bounty.slug, bounty])).values()];
      const next = nextCursor(response);
      cursor = next === cursor ? null : next;
    } catch (error) { ctx.problem(error.message); }
    finally { busy = false; }
  }
  ctx.listen(root, 'click', async event => {
    const tab = event.target.closest('[data-view]');
    if (tab) { view = tab.dataset.view; page = 1; draw(); }
    if (event.target.closest('[data-reset]')) { view = 'all'; query = ''; selectedCategory = ''; page = 1; root.querySelector('input').value = ''; draw(); }
    const target = event.target.closest('[data-page]');
    if (target && !busy) {
      const requested = Number(target.dataset.page);
      if (requested > Math.ceil(filtered().length / SIZE) && cursor) await loadNext();
      if (!ctx.current()) return;
      page = Math.max(1, Math.min(requested, Math.max(1, Math.ceil(filtered().length / SIZE))));
      draw();
      ctx.announce(`Page ${page} of bounties`);
      root.querySelector('.results-heading').scrollIntoView({ block: 'start' });
    }
  });
  ctx.listen(root.querySelector('input'), 'input', event => { query = event.target.value; page = 1; draw(); });
  ctx.listen(categorySelect, 'change', event => { selectedCategory = event.target.value; page = 1; draw(); });
  ctx.listen(sortSelect, 'change', event => { sort = event.target.value; page = 1; draw(); });
  draw();
  ctx.announce(`${initialTotals.open} open bounties loaded`);
}
