export async function renderBounty(ctx, slug, { peek = false } = {}) {
  const { bounty, requirements, standings } = await loadBounty(ctx, slug);
  if (!ctx.alive()) return;
  noteLive(bounty.slug ?? slug, { pot: bounty.potUsd, entries: bounty.submissionCount });
  const sheet = readSheet(bounty, requirements, standings);
  ctx.el.innerHTML = peek ? peekHTML(sheet) : pageHTML(sheet);
  if (!peek) setTitle(bounty.title || slug);
}

function rewardsTable(places, { peek = false } = {}) {
  if (!places.length) return '<p class="b-none">Prizes not announced.</p>';
  const cents = places.some(place => !Number.isInteger(place.amount));
  const rows = peek ? places.slice(0, 5).map(place => [place]) : groupPlaces(places);
  const body = rows.map(group => {
    const first = group[0], last = group[group.length - 1];
    const podium = first.place <= 3;
    const where = group.length > 1 ? `${ordinal(first.place)}–${ordinal(last.place)}` : ordinal(first.place);
    const prize = podium ? `<span class="tag">${usd(first.amount, cents)}</span>` : `<b>${usd(first.amount, cents)}</b>${group.length > 1 ? ' <small>each</small>' : ''}`;
    return `<tr${podium ? ' class="podium"' : ''}><th scope="row">${where}${group.length > 1 ? ` <small>${group.length} places</small>` : ''}</th><td class="r">${prize}</td></tr>`;
  }).join('');
  const rest = peek && places.length > 5 ? places.slice(5) : [];
  const more = rest.length ? `<p class="b-more">+${rest.length} more · ${priceSpan(rest, cents)}</p>` : '';
  return `<table class="grid b-rewards"><thead><tr><th scope="col">Place</th><th scope="col" class="r">Prize</th></tr></thead><tbody>${body}</tbody></table>${more}`;
}

function datesList(sheet, { clock = true } = {}) {
  const { bounty, deadlines } = sheet;
  const finished = bounty.resolvedAt ?? bounty.resolved_at;
  const rows = [
    ['Opened', bounty.opensAt ?? bounty.publishedAt],
    ['Entries close', deadlines.entries_close ?? bounty.deadline],
    finished ? ['Results posted', finished] : ['Results due', deadlines.result_due],
  ];
  return `<dl class="kv b-dates">${rows.map(([name, iso]) => `<dt>${name}</dt><dd>${esc(whenUTC(iso, clock))}</dd>`).join('')}</dl>`;
}

function topStandings(sheet, limit = 5, { titles = true } = {}) {
  const { standings, score, paid, slug } = sheet;
  const rows = standings.rows.slice(0, limit);
  if (!rows.length) return `<p class="b-none">${standings.failed ? 'Standings did not load.' : 'No ranked entries yet.'}</p>`;
  const body = rows.map(row => {
    const place = Number(row.prize_rank ?? row.rank);
    const top = !(Number.isFinite(place) && place >= 1 && place <= paid) ? '' : place <= 3 ? ' top podium' : ' top';
    const handle = String(row.handle ?? '');
    const who = handle
      ? `<a class="who" href="${hrefProfile(handle)}">${avatarHTML(row, 28)}<span>${esc(handle)}</span></a>`
      : `<span class="who">${avatarHTML(row, 28)}<span>Anonymous</span></span>`;
    const entry = titles && row.title ? `<small class="b-entry">${esc(row.title)}</small>` : '';
    return `<tr><td><span class="rank${top}">${esc(row.rank ?? '—')}</span></td><td class="b-who">${who}${entry}</td><td class="r"><b>${score.format(row)}</b></td></tr>`;
  }).join('');
  return `<table class="grid b-top"><thead><tr><th scope="col">#</th><th scope="col">Builder</th><th scope="col" class="r">${esc(score.title)}</th></tr></thead><tbody>${body}</tbody></table>`;
}

import { esc, count, usd, potOf, feeOf, noteLive, phaseOf, whenUTC, statusHTML, countdownHTML, avatarHTML, setTitle, hrefBounty, hrefLeaderboard, hrefProfile, safeLink } from './app.js';
import { getRevalidated, getPage } from './api.js';

const PHASE_NAMES = { intake: 'When you enter', transcripts: 'Transcripts', grading: 'Grading', claim: 'Claiming a prize', claim_request: 'Claim request' };

async function loadBounty(ctx, slug) {
  const base = `/competitions/${encodeURIComponent(slug)}`;
  const options = { force: ctx.force };
  const [bounty, requirements, standings] = await Promise.all([
    getRevalidated(`${base}?submissions=summary`, options).catch(failure => {
      if (failure.status === 404) throw new Error(`make.fun has no bounty called “${slug}”.`);
      throw failure;
    }),
    // The page still stands without rules or standings, so those two fail soft.
    getRevalidated(`${base}/requirements`, options).catch(() => ({})),
    getPage(`${base}/leaderboard`, { rows: 'first' }).then(page => ({ rows: page.rows, body: page.body }), () => ({ rows: [], body: {}, failed: true })),
  ]);
  if (!bounty || typeof bounty !== 'object') throw new Error('make.fun sent an unreadable bounty.');
  return { bounty, requirements: requirements ?? {}, standings };
}

function readSheet(bounty, requirements, standings) {
  const places = placesOf(bounty, requirements);
  const ranked = standings.rows.filter(row => !row.house && !row.baseline && row.ranked !== false);
  return {
    bounty,
    slug: bounty.slug ?? '',
    phase: phaseOf(bounty),
    fee: feeOf(bounty),
    places,
    paid: places.filter(place => place.amount > 0).length,
    deadlines: requirements.deadlines ?? {},
    checks: (requirements.checks ?? []).filter(check => check.applies !== false),
    standings: { ...standings, rows: ranked },
    score: scoreOf(standings.body ?? {}),
  };
}

// The live payout curve already folds each place's share of the entry fees into its prize.
function placesOf(bounty, requirements) {
  const curve = requirements.payout_curve?.places;
  const live = bounty.rewardsNow;
  let list = [];
  if (Array.isArray(curve) && curve.length) list = curve.map(item => ({ place: item.place, amount: item.amount_usd }));
  else if (Array.isArray(live) && live.length) list = live.map(item => ({ place: item.place, amount: item.amountUsd ?? item.baseUsd }));
  else if (bounty.rewards && typeof bounty.rewards === 'object') list = Object.entries(bounty.rewards).map(([place, amount]) => ({ place, amount }));
  return list
    .map(item => ({ place: Number(item.place), amount: Number(item.amount) }))
    .filter(item => Number.isFinite(item.place) && Number.isFinite(item.amount))
    .sort((a, b) => a.place - b.place);
}

function groupPlaces(places) {
  const groups = [];
  for (const place of places) {
    const last = groups[groups.length - 1];
    if (place.place > 3 && last && last[0].place > 3 && last[0].amount === place.amount && last[last.length - 1].place === place.place - 1) last.push(place);
    else groups.push([place]);
  }
  return groups;
}

function priceSpan(places, cents) {
  const amounts = places.map(place => place.amount);
  const low = Math.min(...amounts), high = Math.max(...amounts);
  return low === high ? `${usd(low, cents)} each` : `${usd(low, cents)}–${usd(high, cents)}`;
}

function ordinal(n) {
  const tens = n % 100;
  const tail = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${tail}`;
}

// Judge win rates arrive in millionths; any other ranking value shows as a plain number.
function scoreOf(board) {
  const key = board.rank_key ?? 'judge';
  const column = (board.columns ?? []).find(item => item.key === key) ?? {};
  const micro = /_micro$/.test(column.source ?? '');
  const title = String(column.title ?? 'Score').replace(/^Judge\s+/i, '');
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    format(row) {
      const value = Number(row.values?.[key]);
      if (row.values?.[key] === null || row.values?.[key] === undefined || !Number.isFinite(value)) return '—';
      return micro ? `${(value / 10000).toFixed(1)}%` : count(value);
    },
  };
}

function potHTML(sheet) {
  const { bounty, fee, phase } = sheet;
  const known = bounty.potUsd ?? bounty.rewardAmount;
  const pot = known === null || known === undefined ? '—' : usd(potOf(bounty));
  const fees = Number(bounty.entryFeesUsd);
  const reward = Number(bounty.rewardAmount);
  const parts = fee > 0 && Number.isFinite(fees) && Number.isFinite(reward)
    ? `<p class="b-parts">${usd(reward)} reward + ${usd(fees, true)} entry fees</p>`
    : '';
  const name = phase === 'open' || phase === 'soon' ? 'Live pot' : phase === 'done' ? 'Final pot' : 'Pot';
  return `<div class="b-pot"><p class="label">${name}</p><p><span class="tag big">${pot}</span></p>${parts}</div>`;
}

function statsHTML(sheet, { places = true } = {}) {
  const { bounty, fee, paid, phase } = sheet;
  // Once entries shut there is no time left to count, so the cell names the day they closed.
  const clock = phase === 'closed' || phase === 'done'
    ? ['Closed', esc(whenUTC(sheet.deadlines.entries_close ?? bounty.deadline, false).replace(`, ${new Date().getUTCFullYear()}`, ''))]
    : ['Time left', countdownHTML(bounty)];
  const cells = [
    ['Entry fee', fee > 0 ? usd(fee, true) : 'Free'],
    clock,
    ['Entries', count(bounty.submissionCount)],
  ];
  if (places) cells.push(['Places paid', paid ? count(paid) : '—']);
  return `<dl class="stats b-stats">${cells.map(([name, value]) => `<div class="stat"><dt class="label">${name}</dt><dd><b>${value}</b></dd></div>`).join('')}</dl>`;
}

function pageHTML(sheet) {
  const { bounty, slug } = sheet;
  const category = bounty.category ? `<span class="label">${esc(bounty.category)}</span>` : '';
  const sponsor = bounty.sponsor?.name ? `<span class="label">by ${esc(bounty.sponsor.name)}</span>` : '';
  return `<article class="b-page" data-bounty="${esc(slug)}">
    <header class="b-head">
      <p class="b-kicker">${statusHTML(bounty)}${category}${sponsor}</p>
      <h1 class="title">${esc(bounty.title || slug)}</h1>
      ${bounty.summary ? `<p class="lede">${esc(bounty.summary)}</p>` : ''}
    </header>
    <div class="b-money">${potHTML(sheet)}${statsHTML(sheet)}</div>
    <div class="b-nav">
      <nav class="tabs" aria-label="Bounty"><a href="${hrefBounty(slug)}" aria-current="page">Overview</a><a href="${hrefLeaderboard(slug)}">Leaderboard</a></nav>
      <a class="btn primary" href="https://make.fun/bounty/${encodeURIComponent(slug)}" target="_blank" rel="noopener">Enter on make.fun ↗</a>
    </div>
    <div class="b-cols">
      <aside class="b-side" aria-label="Rewards, dates and standings">
        <section class="b-sec"><h2 class="b-title"><span class="h2">Rewards</span><span class="label">${sheet.paid ? `${count(sheet.paid)} places${sheet.fee > 0 ? ' · fees included' : ' paid'}` : 'Not announced'}</span></h2>${rewardsTable(sheet.places)}</section>
        <section class="b-sec"><h2 class="b-title"><span class="h2">Dates</span><span class="label">UTC</span></h2>${datesList(sheet)}</section>
        <section class="b-sec"><h2 class="b-title"><span class="h2">Top 5</span><a class="label" href="${hrefLeaderboard(slug)}">Full leaderboard →</a></h2>${topStandings(sheet)}</section>
      </aside>
      <div class="b-main">
        <section class="b-sec"><h2 class="b-title"><span class="h2">Description</span></h2><div class="prose">${proseHTML(bounty.description || bounty.summary || '') || '<p>No description yet.</p>'}</div></section>
        ${rulesHTML(sheet)}
      </div>
    </div>
  </article>`;
}

function peekHTML(sheet) {
  const { bounty, slug, phase } = sheet;
  const kicker = phase === 'open' ? 'Closing next' : phase === 'soon' ? 'Opening soon' : 'Featured bounty';
  return `<article class="b-peek" data-bounty="${esc(slug)}">
    <header class="b-head">
      <p class="b-kicker"><span class="label">${kicker}${bounty.category ? ` · ${esc(bounty.category)}` : ''}</span>${statusHTML(bounty)}</p>
      <h2 class="title"><a href="${hrefBounty(slug)}">${esc(bounty.title || slug)}</a></h2>
      ${bounty.summary ? `<p class="lede">${esc(bounty.summary)}</p>` : ''}
    </header>
    <div class="b-ticket">
      ${potHTML(sheet)}
      ${statsHTML(sheet, { places: false })}
      <div class="b-stub">
        <section><h3 class="label">Rewards · ${sheet.paid ? `${count(sheet.paid)} paid` : '—'}</h3>${rewardsTable(sheet.places, { peek: true })}</section>
        <section><h3 class="label">Dates</h3>${datesList(sheet, { clock: false })}</section>
      </div>
    </div>
    <section class="b-podium"><h3 class="label">${phase === 'done' ? 'Final top 3' : 'Top 3 now'} · ${esc(sheet.score.title)}</h3>${topStandings(sheet, 3, { titles: false })}</section>
    <div class="actions"><a class="btn primary" href="${hrefBounty(slug)}">Bounty page →</a><a class="btn" href="${hrefLeaderboard(slug)}">Leaderboard →</a></div>
  </article>`;
}

function rulesHTML(sheet) {
  const { checks, bounty } = sheet;
  const phases = new Map();
  for (const check of checks) {
    const key = check.phase ?? 'other';
    if (!phases.has(key)) phases.set(key, []);
    phases.get(key).push(check);
  }
  const groups = [...phases].map(([key, list]) => `<h3 class="label b-phase">${esc(PHASE_NAMES[key] ?? key.replaceAll('_', ' '))} · ${list.length}</h3>${list.map(check => `<details class="b-rule"><summary>${esc(check.title || String(check.check ?? '').replaceAll('_', ' '))}</summary><div class="prose">${check.description ? `<p>${inlineHTML(check.description)}</p>` : ''}${check.fix ? `<p><b>How to meet it:</b> ${inlineHTML(check.fix)}</p>` : ''}</div></details>`).join('')}`).join('');
  const full = typeof bounty.rules === 'string' && bounty.rules.trim()
    ? `<details class="b-rule b-full"><summary>Read the full rules text</summary><div class="prose">${proseHTML(bounty.rules)}</div></details>`
    : '';
  if (!groups && !full) return '';
  return `<section class="b-sec"><h2 class="b-title"><span class="h2">Rules</span><span class="label">${checks.length ? `${count(checks.length)} checks` : ''}</span></h2>${checks.length ? '<p class="b-note">Each check is named for the failure it catches; open one to see what it asks for.</p>' : ''}${groups}${full}</section>`;
}

// A small markdown reader for the API's text: headings, lists, fenced code and paragraphs, escaped throughout.
function proseHTML(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null, fence = null;
  const flushPara = () => { if (para.length) out.push(`<p>${inlineHTML(para.join(' '))}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map(item => `<li>${inlineHTML(item)}</li>`).join('')}</${list.tag}>`); list = null; };
  for (const line of lines) {
    if (fence) {
      if (/^\s*```/.test(line)) { out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`); fence = null; } else fence.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) { flushPara(); flushList(); fence = []; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara(); flushList();
      const level = Math.min(4, heading[1].length + 1);
      out.push(`<h${level}>${inlineHTML(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol';
      if (list?.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((bullet ?? numbered)[1]);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  if (fence) out.push(`<pre><code>${esc(fence.join('\n'))}</code></pre>`);
  flushPara(); flushList();
  return out.join('');
}

function inlineHTML(text) {
  return String(text).split(/(`[^`]+`)/).map((piece, index) => {
    if (index % 2) return `<code>${esc(piece.slice(1, -1))}</code>`;
    let html = '', at = 0;
    const marks = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;
    for (const hit of piece.matchAll(marks)) {
      html += esc(piece.slice(at, hit.index));
      at = hit.index + hit[0].length;
      if (hit[3]) { html += `<strong>${esc(hit[3])}</strong>`; continue; }
      const label = hit[1] ?? hit[4];
      const href = safeLink(hit[2] ?? hit[4]);
      html += href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label);
    }
    return html + esc(piece.slice(at));
  }).join('');
}
