import { getRevalidated, nextCursorOf, rowsOf, withQuery } from './api.js';
import { esc, count, usd, whenUTC, avatarHTML, emptyHTML, pagerHTML, setTitle, hrefBounty, hrefProfile, safeLink } from './app.js';

export async function renderProfile(ctx, handle) {
  setTitle('@' + handle);
  const path = `/profiles/${encodeURIComponent(handle)}`;
  let body;
  try {
    body = await getRevalidated(path, { force: ctx.force });
  } catch (failure) {
    throw failure.status === 404 ? new Error(`No public profile for @${handle}`) : failure;
  }
  if (!ctx.alive()) return;

  const who = body.handle || handle;
  const name = body.display_name || who;
  const record = body.record ?? {};
  const loaded = [...pickSolutions(body)];
  let cursor = cursorOf(body, null);
  let page = 1;
  let busy = false;
  const pages = () => Math.max(1, Math.ceil(loaded.length / ENTRY_PAGE));
  const figure = value => value === null || value === undefined || value === '' ? '—' : count(value);
  const earned = Number(record.prize_usd);
  const prizeHTML = record.prize_usd === null || record.prize_usd === undefined || !Number.isFinite(earned) ? '—' : `<span class="tag">${usd(earned)}</span>`;
  const joined = Date.parse(body.joined_at ?? '');

  ctx.el.innerHTML = `<article class="pf" data-profile="${esc(who)}">
    <header class="pf-head">
      ${avatarHTML({ ...body, display_name: name, handle: who }, 72)}
      <div class="pf-who">
        <p class="label pf-handle">@${esc(who)}</p>
        <h1 class="title">${esc(name)}</h1>
        ${body.bio ? `<p class="lede">${esc(body.bio)}</p>` : ''}
        <p class="pf-links">${linksOf(body, who)}${Number.isFinite(joined) ? `<span class="label">Joined ${esc(whenUTC(body.joined_at, false))}</span>` : ''}</p>
      </div>
    </header>
    <div class="stats pf-stats">
      <div class="stat"><span class="label">Entered</span><b>${figure(record.competitions_entered)}</b></div>
      <div class="stat"><span class="label">Placed</span><b>${figure(record.competitions_placed)}</b></div>
      <div class="stat"><span class="label">Wins</span><b>${figure(record.competitions_won)}</b></div>
      <div class="stat"><span class="label">Podiums</span><b>${figure(record.podium_finishes)}</b></div>
      <div class="stat"><span class="label">Best finish</span><b>${figure(record.best_placement)}</b></div>
      <div class="stat pf-money"><span class="label">Prize money</span><b>${prizeHTML}</b></div>
    </div>
    <section class="pf-entries" aria-labelledby="pf-entries-h">
      <div class="pf-bar"><h2 class="h2" id="pf-entries-h">Entries</h2><span class="label" data-total></span></div>
      <div data-rows></div>
      <div data-pager></div>
      <p class="pf-note" role="alert" data-note hidden></p>
    </section>
  </article>`;

  const rowsEl = ctx.el.querySelector('[data-rows]');
  const pagerEl = ctx.el.querySelector('[data-pager]');
  const totalEl = ctx.el.querySelector('[data-total]');
  const noteEl = ctx.el.querySelector('[data-note]');

  function draw() {
    const start = (page - 1) * ENTRY_PAGE;
    totalEl.textContent = `${count(loaded.length)}${cursor ? '+' : ''} public ${loaded.length === 1 ? 'entry' : 'entries'}`;
    rowsEl.innerHTML = loaded.length
      ? entriesTable(loaded.slice(start, start + ENTRY_PAGE))
      : emptyHTML('No public entries yet.', `@${who} has not entered a bounty in public.`, '<a class="btn primary" href="#/">Open the board</a>');
    pagerEl.innerHTML = pages() > 1 || cursor ? pagerHTML({ page, pages: pages(), more: Boolean(cursor), noun: 'Page' }) : '';
  }

  ctx.on(ctx.el, 'click', async event => {
    const button = event.target.closest('[data-page]');
    if (!button || busy || button.disabled) return;
    const want = Number(button.dataset.page);
    busy = true;
    noteEl.hidden = true;
    try {
      while (want > pages() && cursor) {
        button.disabled = true;
        button.textContent = 'Loading…';
        const more = await followNextCursor(path, {}, cursor, pickSolutions);
        if (!ctx.alive()) return;
        loaded.push(...more.rows);
        cursor = more.next;
      }
    } catch (failure) {
      noteEl.textContent = failure.message || 'The next page did not load.';
      noteEl.hidden = false;
    } finally {
      busy = false;
    }
    page = Math.min(Math.max(1, want), pages());
    draw();
    ctx.el.querySelector('.pf-bar')?.scrollIntoView({ block: 'nearest' });
    ctx.announce(`Entries page ${page} of ${pages()}`);
  });

  draw();
  ctx.announce(`Public profile of @${who}, ${loaded.length} entries`);
}

export async function renderBuilders(ctx) {
  setTitle('Builders');
  const cached = [];
  let page = 1;
  let busy = false;
  let total = NaN;

  async function fetchPage(index) {
    if (cached[index]) return cached[index];
    const before = cached[index - 1];
    const result = await followNextCursor('/rankings', { limit: BUILDER_PAGE }, before?.next ?? null, rowsOf, index === 0 && ctx.force);
    if (!ctx.alive()) return null;
    if (Number.isFinite(Number(result.body?.total))) total = Number(result.body.total);
    cached[index] = result;
    return result;
  }

  const first = await fetchPage(0);
  if (!first) return;

  ctx.el.innerHTML = `<section class="bl">
    <header class="bl-head">
      <p class="label">Builders</p>
      <h1 class="title">Everyone on the board</h1>
      <p class="lede" data-count></p>
      <form class="bl-lookup" role="search">
        <label class="field"><span class="sr">Builder handle</span><input type="search" name="handle" placeholder="Jump to a @handle" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"></label>
        <button class="btn primary" type="submit">View profile</button>
      </form>
    </header>
    <div data-rows></div>
    <div data-pager></div>
    <p class="pf-note" role="alert" data-note hidden></p>
  </section>`;

  const rowsEl = ctx.el.querySelector('[data-rows]');
  const pagerEl = ctx.el.querySelector('[data-pager]');
  const noteEl = ctx.el.querySelector('[data-note]');
  const countEl = ctx.el.querySelector('[data-count]');

  function draw() {
    const current = cached[page - 1];
    const known = Number.isFinite(total) ? Math.max(1, Math.ceil(total / BUILDER_PAGE)) : cached.length;
    countEl.textContent = Number.isFinite(total) ? `${count(total)} ranked by wins, then prize money. Open one for the full record.` : 'Ranked by wins, then prize money. Open one for the full record.';
    rowsEl.innerHTML = current.rows.length
      ? buildersTable(current.rows)
      : emptyHTML('No builders ranked yet.', 'Look one up by handle above.');
    // A page with no next_cursor is the last one, whatever the reported total says.
    const pages = current.next ? Math.max(known, page + 1) : page;
    pagerEl.innerHTML = pages > 1 ? pagerHTML({ page, pages, more: Boolean(current.next) && !Number.isFinite(total), noun: 'Page' }) : '';
  }

  ctx.on(ctx.el.querySelector('.bl-lookup'), 'submit', event => {
    event.preventDefault();
    const typed = String(new FormData(event.currentTarget).get('handle') ?? '').trim().replace(/^@+/, '');
    if (typed) location.hash = hrefProfile(typed);
  });

  ctx.on(ctx.el, 'click', async event => {
    const button = event.target.closest('[data-page]');
    if (!button || busy || button.disabled) return;
    const want = Math.max(1, Number(button.dataset.page));
    noteEl.hidden = true;
    busy = true;
    try {
      if (!cached[want - 1]) {
        button.disabled = true;
        button.textContent = 'Loading…';
        if (!await fetchPage(want - 1)) return;
      }
      page = want;
    } catch (failure) {
      noteEl.textContent = failure.message || 'That page did not load.';
      noteEl.hidden = false;
    } finally {
      busy = false;
    }
    draw();
    ctx.el.querySelector('.bl-head')?.scrollIntoView({ block: 'nearest' });
    ctx.announce(`Builders page ${page}`);
  });

  draw();
  ctx.announce(`Builders directory, page 1`);
}

function entriesTable(rows) {
  const body = rows.map(entry => {
    const bounty = entry.competition ?? {};
    const prize = Number(entry.prize_usd);
    const placed = entry.placement !== null && entry.placement !== undefined && entry.placement !== '';
    const title = bounty.title || bounty.slug || 'Bounty';
    const link = bounty.slug ? `<a href="${hrefBounty(bounty.slug)}">${esc(title)}</a>` : esc(title);
    return `<tr>
      <td class="pf-bounty">${link}${entry.title ? `<span class="pf-sub">${esc(entry.title)}</span>` : ''}</td>
      <td class="pf-place">${placed ? `<span class="rank${prize > 0 ? ' top' : ''}">${esc(entry.placement)}</span>` : '<span class="pf-none">—</span>'}</td>
      <td class="pf-prize r">${prize > 0 ? `<span class="tag">${usd(prize)}</span>` : '<span class="pf-none">—</span>'}</td>
      <td class="pf-when r">${esc(whenUTC(entry.entered_at, false))}</td>
    </tr>`;
  }).join('');
  return `<table class="grid pf-table"><thead><tr><th scope="col">Bounty</th><th scope="col">Place</th><th scope="col" class="r">Prize</th><th scope="col" class="r pf-when">Entered</th></tr></thead><tbody>${body}</tbody></table>`;
}

// One cursor hop: the same path and filters, plus the cursor the last page handed back.
async function followNextCursor(path, query, cursor, pick, force = false) {
  const body = await getRevalidated(withQuery(path, cursor ? { ...query, cursor } : query), { force });
  const next = cursorOf(body, cursor);
  return { rows: [...pick(body)], next, body };
}

function cursorOf(body, spent) {
  const next = nextCursorOf(body) ?? body?.solutions_next_cursor ?? null;
  return next && next !== spent ? next : null;
}

function pickSolutions(body) {
  return Array.isArray(body?.solutions) ? body.solutions : rowsOf(body);
}

function buildersTable(rows) {
  const body = rows.map(row => {
    const handle = row.handle ?? '';
    const name = row.display_name || handle;
    const record = row.record ?? {};
    const earned = Number(record.prize_usd);
    return `<tr data-builder="${esc(handle)}">
      <td class="bl-rank"><span class="rank${row.rank <= 3 ? ' top podium' : ' top'}">${count(row.rank)}</span></td>
      <td class="bl-who"><a class="who" href="${hrefProfile(handle)}">${avatarHTML(row, 36)}<span class="bl-names"><b>${esc(name)}</b>${row.display_name ? `<small>@${esc(handle)}</small>` : ''}</span></a></td>
      <td class="r bl-opt">${count(record.competitions_entered)}</td>
      <td class="r">${count(record.competitions_won)}</td>
      <td class="r bl-opt">${count(record.podium_finishes)}</td>
      <td class="r bl-prize">${Number.isFinite(earned) && record.prize_usd !== null ? `<span class="tag">${usd(earned)}</span>` : '—'}</td>
    </tr>`;
  }).join('');
  return `<table class="grid bl-table"><thead><tr><th scope="col">Rank</th><th scope="col">Builder</th><th scope="col" class="r bl-opt">Entered</th><th scope="col" class="r">Wins</th><th scope="col" class="r bl-opt">Podiums</th><th scope="col" class="r">Earned</th></tr></thead><tbody>${body}</tbody></table>`;
}

function linksOf(body, handle) {
  const found = [];
  if (body.github_login) found.push(['GitHub', `https://github.com/${encodeURIComponent(body.github_login)}`]);
  if (body.x) found.push(['X', body.x.url ?? (body.x.username ? `https://x.com/${encodeURIComponent(body.x.username)}` : '')]);
  if (body.discord?.url) found.push(['Discord', body.discord.url]);
  if (body.website) found.push(['Website', body.website]);
  found.push(['make.fun', `https://make.fun/u/${encodeURIComponent(handle)}`]);
  return found
    .map(([label, url]) => [label, safeLink(url)])
    .filter(([, url]) => url)
    .map(([label, url]) => `<a class="btn pf-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`)
    .join('');
}

const ENTRY_PAGE = 10;
const BUILDER_PAGE = 25;
