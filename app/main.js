import { renderBoard } from './board.js';
import { empty, remaining } from './ui.js';

const content = document.querySelector('#content');
let generation = 0;
let lifecycleRerender = false;
let handlers;
window.__shotReady = false;

export async function renderRoute({ force = false, preserveScroll = false } = {}) {
  const current = ++generation;
  handlers?.abort();
  handlers = new AbortController();
  const signal = handlers.signal;
  window.__shotReady = false;
  const fragment = location.hash.slice(1) || '/';
  const route = new URL(fragment, 'https://make.fun');
  let parts;
  try { parts = route.pathname.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { parts = ['not-found']; }
  for (const link of document.querySelectorAll('[data-nav]')) {
    const active = link.dataset.nav === (['u', 'builders'].includes(parts[0]) ? 'builders' : 'board');
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  const ctx = {
    el: content, route, force,
    current: () => generation === current,
    show(html) { if (generation === current) content.innerHTML = html; },
    listen(target, event, callback) { target.addEventListener(event, callback, { signal }); },
    announce(message) { if (generation === current) document.querySelector('#announcement').textContent = message; },
    problem(message) {
      if (generation !== current) return;
      const notice = document.querySelector('#notice');
      notice.hidden = false;
      notice.textContent = `${message} Use Next to try again.`;
    },
    replace(params) { route.search = params.toString(); history.replaceState(null, '', '#' + route.pathname + route.search); },
  };
  content.setAttribute('aria-busy', 'true');
  const loadingTimer = setTimeout(() => ctx.show('<div class="loading"><span class="loading-line"></span><p>Loading live make.fun data…</p></div>'), 220);
  try {
    if (!parts.length) await renderBoard(ctx);
    else if (parts[0] === 'bounty' && parts[1] && parts.length <= 3 && (!parts[2] || parts[2] === 'leaderboard')) {
      const view = await import('./bounty.js');
      await view.renderBounty(ctx, parts[1], parts[2] === 'leaderboard');
    } else if (parts[0] === 'u' && parts[1] && parts.length === 2) {
      const view = await import('./people.js');
      await view.renderProfile(ctx, parts[1]);
    } else if (parts[0] === 'builders' && parts.length === 1) {
      const view = await import('./people.js');
      await view.renderBuilders(ctx);
    } else {
      document.title = 'Page not found — make.fun';
      ctx.show(empty('This page took a wrong turn.', 'The bounty board is a good place to start.', '<a class="button primary" href="#/">Explore bounties</a>'));
    }
  } catch (error) {
    ctx.show(empty('Couldn’t load this page.', error.message || 'Check your connection and try again.', '<button type="button" class="button primary" data-retry>Try again</button><a class="button" href="#/">Bounty board</a>'));
    ctx.listen(content, 'click', event => { if (event.target.closest('[data-retry]')) renderRoute({ force: true }); });
  } finally {
    clearTimeout(loadingTimer);
    if (ctx.current()) {
      content.removeAttribute('aria-busy');
      window.__shotReady = true;
      lifecycleRerender = false;
      if (!preserveScroll) { window.scrollTo({ top: 0, behavior: 'instant' }); content.focus({ preventScroll: true }); }
    }
  }
}

function tick() {
  if (document.hidden) return;
  let crossed = false;
  for (const timer of content.querySelectorAll('[data-until]')) {
    const target = Number(timer.dataset.until);
    if (target <= Date.now()) { crossed = true; timer.removeAttribute('data-until'); }
    else {
      const label = remaining(target);
      const next = timer.dataset.kind === 'upcoming' ? `Opens in ${label.replace(' left', '')}` : label;
      if (timer.textContent !== next) timer.textContent = next;
    }
  }
  if (crossed && !lifecycleRerender) {
    lifecycleRerender = true;
    renderRoute({ preserveScroll: true });
  }
}

window.addEventListener('hashchange', () => renderRoute());
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  content.focus();
  content.scrollIntoView({ block: 'start' });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
document.querySelector('#refresh').addEventListener('click', () => renderRoute({ force: true, preserveScroll: true }));
window.addEventListener('api-state', event => {
  const notice = document.querySelector('#notice');
  notice.hidden = event.detail !== 'saved';
  notice.textContent = event.detail === 'saved' ? 'You’re viewing saved data. Use refresh to reconnect.' : '';
});
document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
}, true);
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.isComposing && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    const search = document.querySelector('input[type="search"]');
    if (search) { event.preventDefault(); search.focus(); }
  }
});
setInterval(tick, 1000);
renderRoute();
