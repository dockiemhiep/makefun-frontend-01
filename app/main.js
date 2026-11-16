// make.fun static frontend: minute-bound ETag cache, router & lazy view loader for all 4 surfaces.
//   #/                            Surface 1: Live bounty board
//   #/bounty/<slug>               Surface 2: Bounty page (summary, rules, live-pot rewards, dates)
//   #/bounty/<slug>/leaderboard   Surface 3: Bounty leaderboard (paginated, phase-aware)
//   #/u/<handle>                  Surface 4: Account public profile (+ #/rankings directory)

const API_ROOT = 'https://make.fun/api';
const SESSION_CACHE_KEY = 'mf-etag-v1';
const etagCache = new Map();
const inflightRequests = new Map();
const previewBySlug = new Map();
const apiStats = { requests: 0, hits: 0, revalidated304: 0 };

const loadBoardView = () => import('./board.js');
const loadBountyView = () => import('./bounty.js');
const loadLeaderboardView = () => import('./leaderboard.js');
const loadProfileView = () => import('./profile.js');

const appEl = document.getElementById('app');
const meterEl = document.getElementById('api-meter');
const boardUiState = { tab: 'open', cat: 'All', sort: 'featured', q: '', page: 1 };
let navToken = 0;

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const minuteBucket = () => Math.floor(Date.now() / 60000);

// Hydrate current-minute ETag entries from sessionStorage so reloads inside the same minute cost 0 requests.
try {
  const saved = JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) || '[]');
  const nowMin = minuteBucket();
  for (const [k, v] of saved) {
    if (v && v.min === nowMin) etagCache.set(k, v);
  }
} catch {}

function persistSessionCache() {
  try {
    const nowMin = minuteBucket();
    const compact = [...etagCache.entries()].filter(([k, v]) => v.min === nowMin && !k.includes('/leaderboard'));
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(compact.slice(-12)));
  } catch {}
}

function syncMeter() {
  if (!meterEl) return;
  const parts = [`${apiStats.requests} GET`];
  if (apiStats.hits > 0) parts.push(`${apiStats.hits} cached`);
  if (apiStats.revalidated304 > 0) parts.push(`${apiStats.revalidated304}×304`);
  meterEl.textContent = parts.join(' · ');
}

/** GET JSON with minute-bound ETag caching, conditional If-None-Match revalidation, and inflight deduplication. */
export async function fetchCachedJson(path, { forceRevalidate = false } = {}) {
  const min = minuteBucket();
  const hit = etagCache.get(path);
  if (hit && !forceRevalidate && hit.min === min) {
    apiStats.hits++;
    syncMeter();
    return hit.data;
  }
  if (!forceRevalidate && inflightRequests.has(path)) return inflightRequests.get(path);

  const req = (async () => {
    const useEtag = !forceRevalidate && hit?.etag && hit.min !== min && !hit.etag.startsWith('W/"b1-');
    const headers = { Accept: 'application/json' };
    if (useEtag) headers['If-None-Match'] = hit.etag;
    apiStats.requests++;
    syncMeter();

    let res;
    try {
      res = await fetch(API_ROOT + path, { method: 'GET', headers, mode: 'cors', cache: 'no-store' });
    } catch (firstErr) {
      // Retry once cleanly without conditional header if an edge proxy dropped CORS on 304 or connection reset.
      try {
        res = await fetch(API_ROOT + path, { method: 'GET', headers: { Accept: 'application/json' }, mode: 'cors', cache: 'no-store' });
      } catch (err) {
        if (hit) return hit.data;
        throw new Error('Network error reaching make.fun API. Check your connection and retry.', { cause: err || firstErr });
      }
    }

    if (res.status === 304 && hit) {
      hit.min = minuteBucket();
      apiStats.revalidated304++;
      persistSessionCache();
      syncMeter();
      return hit.data;
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const b = await res.json();
        msg = b?.detail || b?.title || b?.error?.[0]?.message || msg;
      } catch {}
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }

    const data = await res.json();
    etagCache.set(path, { data, etag: res.headers.get('etag'), min: minuteBucket() });
    persistSessionCache();
    syncMeter();
    return data;
  })();

  inflightRequests.set(path, req);
  try {
    return await req;
  } finally {
    if (inflightRequests.get(path) === req) inflightRequests.delete(path);
  }
}

export async function getCompetitions(opts) {
  const data = await fetchCachedJson('/competitions?activity=times&limit=100', opts);
  if (Array.isArray(data?.items)) {
    for (const b of data.items) if (b?.slug) previewBySlug.set(b.slug, b);
  }
  return data;
}
export const getCompetition = (slug, opts) => fetchCachedJson(`/competitions/${encodeURIComponent(slug)}`, opts);
export const getLeaderboard = (slug, phase = '', opts) =>
  fetchCachedJson(`/competitions/${encodeURIComponent(slug)}/leaderboard${phase ? `?phase=${encodeURIComponent(phase)}` : ''}`, opts);
export const getProfile = (handle, opts) => fetchCachedJson(`/profiles/${encodeURIComponent(handle)}`, opts);
export const getRankings = (order = 'wins', opts) => fetchCachedJson(`/rankings?limit=100&order=${encodeURIComponent(order)}`, opts);

export function parseRoute(hashStr = location.hash, pathStr = location.pathname) {
  const raw = hashStr && hashStr.startsWith('#') ? hashStr.slice(1) : pathStr || '/';
  const [p, q = ''] = raw.split('?');
  const params = new URLSearchParams(q);
  const path = p.startsWith('/') ? p : `/${p}`;

  let m = path.match(/^\/bounty\/([^/]+)\/leaderboard\/?$/);
  if (m) return { name: 'leaderboard', slug: decodeURIComponent(m[1]), phase: params.get('phase') || '' };
  m = path.match(/^\/bounty\/([^/]+)\/?$/);
  if (m) return { name: 'bounty', slug: decodeURIComponent(m[1]) };
  m = path.match(/^\/(?:u|profile|profiles)\/([^/]+)\/?$/);
  if (m) return { name: 'profile', handle: decodeURIComponent(m[1]).replace(/^@/, '') };
  if (path === '/rankings' || path === '/rankings/') return { name: 'rankings', order: params.get('order') || 'wins' };
  return { name: 'board' };
}

function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll('[data-deadline]').forEach((el) => {
    const diff = Date.parse(el.getAttribute('data-deadline') || '') - now;
    if (!Number.isFinite(diff)) return;
    let txt;
    let urgent = false;
    if (diff <= 0) {
      const m = Math.floor(Math.abs(diff) / 60000);
      txt = m < 60 ? `Closed ${m}m ago` : m < 2880 ? `Closed ${Math.floor(m / 60)}h ago` : `Closed ${Math.floor(m / 1440)}d ago`;
    } else {
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      urgent = diff < 21600000;
      txt = d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
    }
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle('is-urgent', urgent);
  });
}

async function renderCurrentRoute({ forceRevalidate = false } = {}) {
  const token = ++navToken;
  window.__shotReady = false;
  const route = parseRoute();

  document.querySelectorAll('[data-nav]').forEach((a) => {
    const onBoard = a.dataset.nav === 'board' && ['board', 'bounty', 'leaderboard'].includes(route.name);
    const onRk = a.dataset.nav === 'rankings' && ['rankings', 'profile'].includes(route.name);
    a.classList.toggle('is-active', onBoard || onRk);
  });

  const opts = { forceRevalidate };
  if (!forceRevalidate && !appEl.children.length) {
    appEl.innerHTML = '<div class="skel-shell" aria-busy="true"><div class="skel-block skel-title"></div><div class="skel-block" style="height:180px;margin-top:16px"></div></div>';
  }

  try {
    if (route.name === 'board') {
      document.title = 'make.fun — Live AI Agent Bounties';
      const [mod, data] = await Promise.all([loadBoardView(), getCompetitions(opts)]);
      if (token !== navToken) return;
      if (forceRevalidate) appEl.innerHTML = '';
      const apply = (patch) => {
        Object.assign(boardUiState, patch);
        mod.renderBoardSurface(appEl, data, boardUiState, apply);
      };
      mod.renderBoardSurface(appEl, data, boardUiState, apply);
    } else if (route.name === 'bounty') {
      const preview = previewBySlug.get(route.slug) || null;
      document.title = `${preview?.title || route.slug} — make.fun`;
      const [mod, b] = await Promise.all([loadBountyView(), getCompetition(route.slug, opts)]);
      if (token !== navToken) return;
      previewBySlug.set(b.slug, b);
      document.title = `${b.title} — make.fun`;
      mod.renderBountySurface(appEl, b);
    } else if (route.name === 'leaderboard') {
      const preview = previewBySlug.get(route.slug) || null;
      document.title = `Leaderboard · ${preview?.title || route.slug} — make.fun`;
      const [mod, lb] = await Promise.all([loadLeaderboardView(), getLeaderboard(route.slug, route.phase, opts)]);
      if (token !== navToken) return;
      document.title = `Leaderboard · ${lb?.competition?.title || route.slug} — make.fun`;
      mod.renderLeaderboardSurface(appEl, lb, route.slug, preview, (nextPhase) => {
        location.hash = `#/bounty/${encodeURIComponent(route.slug)}/leaderboard${nextPhase ? `?phase=${encodeURIComponent(nextPhase)}` : ''}`;
      });
    } else if (route.name === 'profile') {
      document.title = `@${route.handle} — make.fun`;
      const [mod, prof] = await Promise.all([loadProfileView(), getProfile(route.handle, opts)]);
      if (token !== navToken) return;
      document.title = `${prof.display_name ? `${prof.display_name} (@${prof.handle})` : `@${prof.handle}`} — make.fun`;
      mod.renderProfileSurface(appEl, prof);
    } else {
      document.title = 'Top Builders — make.fun';
      const [mod, rk] = await Promise.all([loadProfileView(), getRankings(route.order, opts)]);
      if (token !== navToken) return;
      mod.renderRankingsSurface(appEl, rk, route.order);
    }
    if (!forceRevalidate) window.scrollTo(0, 0);
  } catch (err) {
    if (token !== navToken) return;
    appEl.innerHTML = `<section class="error-box" role="alert"><h1>${err?.status === 404 ? 'Not found on make.fun' : 'Could not load live data'}</h1><p>${escHtml(err?.message || 'Unexpected error.')}</p><div class="error-actions"><button type="button" class="btn-primary" id="retry-btn">Try again</button><a class="btn-secondary" href="#/">Back to board</a></div></section>`;
    document.getElementById('retry-btn')?.addEventListener('click', () => renderCurrentRoute({ forceRevalidate: true }));
  } finally {
    if (token === navToken) {
      syncMeter();
      requestAnimationFrame(() => {
        if (token === navToken) window.__shotReady = true;
      });
    }
  }
}

document.addEventListener(
  'error',
  (ev) => {
    const img = ev.target;
    if (img instanceof HTMLImageElement && img.dataset.avatar) {
      const s = document.createElement('span');
      s.className = 'avatar-fallback';
      s.style.cssText = `width:${img.width || 28}px;height:${img.height || 28}px`;
      s.textContent = img.dataset.avatar;
      img.replaceWith(s);
    }
  },
  true,
);

document.getElementById('profile-jump')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = document.getElementById('profile-input');
  const h = (inp?.value || '').trim().replace(/^@/, '');
  if (!h) return;
  inp.value = '';
  location.hash = `#/u/${encodeURIComponent(h)}`;
});

document.getElementById('refresh-btn')?.addEventListener('click', () => renderCurrentRoute({ forceRevalidate: true }));

try {
  const t = localStorage.getItem('mf-theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch {}

document.getElementById('theme-btn')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('mf-theme', next);
  } catch {}
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '')) {
    const inp = document.querySelector('.filter-input');
    if (inp) {
      e.preventDefault();
      inp.focus();
    }
  }
});

window.addEventListener('hashchange', () => renderCurrentRoute());
setInterval(tickCountdowns, 15000);
renderCurrentRoute();
