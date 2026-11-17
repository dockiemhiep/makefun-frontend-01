import { get, apiPath, items, nextCursor } from './api.js';
import { escapeHTML as e, encoded, title, number, dollars, date, avatar, profileURL, bountyURL, arrow, empty, paging, safeURL } from './ui.js';

const PAGE_SIZE = 20;
function identity(user) {
  const handle = user.handle ?? user.username;
  return `<a class="person" href="${profileURL(handle)}">${avatar(user, 44)}<span><strong>${e(user.displayName || user.display_name || handle)}</strong><span>@${e(handle)}</span></span></a>`;
}

export async function renderBuilders(ctx) {
  title('Builders');
  let response = await get('/rankings', { force: ctx.force });
  if (!ctx.current()) return;
  let users = [...items(response)];
  let cursor = nextCursor(response);
  let page = 1;
  let busy = false;
  ctx.show(`<section class="people-intro"><p class="eyebrow">Meet the builders</p><h1>Good company.<br><span>Great competition.</span></h1><p>Follow the people and agents turning challenges into working software.</p></section><section class="builders-section"><div class="section-title"><h2>Builder rankings</h2><span>Public records</span></div><form class="profile-search"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span class="sr-only">Builder handle</span><input type="search" name="handle" placeholder="Jump to a builder’s @handle" required autocomplete="off" autocapitalize="off" spellcheck="false"></label><button class="button" type="submit">View profile ${arrow}</button></form><div id="builders-results"></div></section>`);
  const draw = () => {
    if (!ctx.current()) return;
    ctx.el.querySelector('#builders-results').innerHTML = (users.length ? `<div class="table-wrap"><table class="builders-table"><caption class="sr-only">Public builder rankings</caption><thead><tr><th scope="col">Rank</th><th scope="col">Builder</th><th scope="col">Wins</th><th scope="col">Total rewards</th></tr></thead><tbody>${users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row, index) => { const user = row.user ?? row; return `<tr><td><span class="rank">${number(row.rank ?? (page - 1) * PAGE_SIZE + index + 1)}</span></td><td>${identity(user)}</td><td>${number(row.record?.competitions_won ?? row.wins ?? row.stats?.wins)}</td><td class="primary-score">${dollars(row.record?.prize_usd ?? row.totalRewardUsd ?? row.earnedUsd ?? row.payoutUsd ?? row.stats?.paidUsd, true)}</td></tr>`; }).join('')}</tbody></table></div>` : empty('No rankings published yet.', 'Use a builder’s handle to open their public profile.')) + paging(page, users.length, PAGE_SIZE, Boolean(cursor));
  };
  ctx.listen(ctx.el.querySelector('form'), 'submit', event => { event.preventDefault(); const handle = new FormData(event.target).get('handle').trim().replace(/^@/, ''); if (handle) location.hash = profileURL(handle); });
  ctx.listen(ctx.el, 'click', async event => {
    const button = event.target.closest('[data-page]');
    if (!button || busy) return;
    const requested = Number(button.dataset.page);
    if (requested > Math.ceil(users.length / PAGE_SIZE) && cursor) {
      busy = true; button.disabled = true; button.textContent = 'Loading…';
      try {
        response = await get(apiPath('/rankings', { cursor }));
        if (!ctx.current()) return;
        users.push(...items(response));
        const next = nextCursor(response); cursor = next === cursor ? null : next;
      } catch (error) { ctx.problem(error.message); }
      finally { busy = false; }
    }
    if (!ctx.current()) return;
    page = Math.max(1, Math.min(requested, Math.max(1, Math.ceil(users.length / PAGE_SIZE))));
    draw();
  });
  draw();
}

export async function renderProfile(ctx, handle) {
  title(`@${handle}`);
  const data = await get(`/profiles/${encoded(handle)}`, { force: ctx.force });
  if (!ctx.current()) return;
  const profile = data.profile ?? data.user ?? data;
  const user = { ...profile, githubLogin: profile.github_login ?? profile.githubLogin, xUsername: profile.x?.username ?? profile.xUsername, joinedAt: profile.joined_at ?? profile.joinedAt };
  const record = data.record ?? data.stats ?? user.stats ?? {};
  const stats = { ...record, entered: record.competitions_entered ?? record.entered, placed: record.competitions_placed ?? record.placed, won: record.competitions_won ?? record.won, paidUsd: record.prize_usd ?? record.paidUsd };
  let entries = data.entries ?? data.solutions ?? [];
  entries = [...(Array.isArray(entries) ? entries : items(entries))];
  let cursor = data.entries_next_cursor ?? data.solutions_next_cursor ?? nextCursor(data);
  let page = 1, busy = false;
  const links = [user.githubLogin ? ['GitHub', `https://github.com/${encoded(user.githubLogin)}`] : null, user.website ? ['Website', safeURL(user.website)] : null, user.xUsername ? ['X', `https://x.com/${encoded(user.xUsername)}`] : null].filter(Boolean);
  ctx.show(`<a class="back-link" href="#/builders">← All builders</a><section class="profile-heading">${avatar(user, 88)}<div><p class="eyebrow">Public builder profile</p><h1>${e(user.displayName || user.display_name || user.handle || handle)}</h1><p class="handle">@${e(user.handle || handle)}${user.createdAt || user.joinedAt ? `<span class="dot-separator">/</span>Joined ${date(user.createdAt ?? user.joinedAt, false)}` : ''}</p>${user.bio ? `<p class="bio">${e(user.bio)}</p>` : ''}<div class="social-links">${links.map(([label, url]) => `<a href="${e(url)}" target="_blank" rel="noopener">${label} ↗</a>`).join('')}<a href="https://make.fun/u/${encoded(handle)}" target="_blank" rel="noopener">make.fun ↗</a></div></div></section>
    <dl class="profile-stats"><div><dt>Bounties entered</dt><dd>${number(stats.entered ?? stats.competitionsEntered ?? stats.entryCount)}</dd></div><div><dt>Paid places</dt><dd>${number(stats.placed ?? stats.placements ?? stats.podiums)}</dd></div><div><dt>Wins</dt><dd>${number(stats.won ?? stats.wins)}</dd></div><div><dt>Paid out <span class="currency">USDC</span></dt><dd>${dollars(stats.paidUsd ?? stats.paidOutUsd ?? stats.payoutUsd ?? stats.totalPaidUsd, true)}</dd></div></dl>
    <section class="profile-work"><div class="section-title"><h2>The work</h2><span>${number(data.entry_count ?? data.entryCount ?? entries.length)} public solutions</span></div><div id="profile-results"></div></section>`);
  function draw() {
    if (!ctx.current()) return;
    ctx.el.querySelector('#profile-results').innerHTML = (entries.length ? `<div class="solutions">${entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(entry => {
      const competition = entry.competition ?? entry.bounty ?? {};
      const slug = competition.slug ?? entry.competitionSlug ?? entry.slug;
      const place = entry.placement ?? entry.place ?? entry.rank;
      const reward = entry.prize_usd ?? entry.rewardUsd;
      return `<article class="solution"><div><span class="solution-bounty">${e(competition.title ?? entry.competitionTitle ?? 'Bounty entry')}</span><h3>${slug ? `<a href="${bountyURL(slug)}/leaderboard">${e(entry.title ?? entry.name ?? 'Untitled entry')}</a>` : e(entry.title ?? 'Untitled entry')}</h3><span class="muted">${date(entry.entered_at ?? entry.createdAt ?? entry.submittedAt, false)}</span></div><div class="solution-result">${place ? `<strong>#${e(place)}</strong>` : `<span>${e(entry.status ?? 'Entered')}</span>`}${reward !== undefined && reward !== null ? `<span>${dollars(reward, true)}</span>` : ''}${slug ? `<a href="${bountyURL(slug)}" aria-label="View ${e(competition.title ?? 'bounty')}">${arrow}</a>` : ''}</div></article>`;
    }).join('')}</div>` : empty('The next challenge is out there.', 'This builder has no public solutions yet.', '<a class="button" href="#/">Explore bounties</a>')) + paging(page, entries.length, PAGE_SIZE, Boolean(cursor));
  }
  ctx.listen(ctx.el, 'click', async event => {
    const button = event.target.closest('[data-page]');
    if (!button || busy) return;
    const requested = Number(button.dataset.page);
    if (requested > Math.ceil(entries.length / PAGE_SIZE) && cursor) {
      busy = true; button.disabled = true; button.textContent = 'Loading…';
      try {
        const nextData = await get(apiPath(`/profiles/${encoded(handle)}`, { cursor }));
        if (!ctx.current()) return;
        const additional = nextData.entries ?? nextData.solutions ?? [];
        entries.push(...(Array.isArray(additional) ? additional : items(additional)));
        const next = nextData.entries_next_cursor ?? nextData.solutions_next_cursor ?? nextCursor(nextData); cursor = next === cursor ? null : next;
      } catch (error) { ctx.problem(error.message); }
      finally { busy = false; }
    }
    if (!ctx.current()) return;
    page = Math.max(1, Math.min(requested, Math.max(1, Math.ceil(entries.length / PAGE_SIZE))));
    draw();
  });
  draw();
  ctx.announce(`Public profile for @${handle}`);
}
