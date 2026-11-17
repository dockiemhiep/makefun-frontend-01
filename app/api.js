export async function getRevalidated(path, opts = {}) {
  const { force = false, freshFor = FRESH_MS } = opts;
  if (typeof path !== 'string' || path[0] !== '/' || path[1] === '/') throw new Error('Not a make.fun API path');
  const held = etagCache.get(path);
  if (held && !force && Date.now() - held.at < freshFor) return tally('cached', held.body);
  const running = inFlight.get(path);
  if (running) return running;
  const job = revalidate(path, held).finally(() => inFlight.delete(path));
  inFlight.set(path, job);
  return job;
}
export async function getPage(path, query, cursor, opts) {
  const body = await getRevalidated(withQuery(path, cursor ? { ...query, cursor } : query), opts);
  const next = nextCursorOf(body);
  return { rows: rowsOf(body), next: next && next !== cursor ? next : null, body };
}
export const nextCursorOf = body => body?.next_cursor ?? body?.pagination?.next_cursor ?? null;
export const rowsOf = body => Array.isArray(body) ? body : body?.items ?? body?.entries ?? body?.rows ?? [];
export const stats = { requests: 0, revalidated: 0, cached: 0, offline: false };

export const API = 'https://make.fun/api';
const etagCache = new Map();
const FRESH_MS = 20000;
const KEEP = 24;
const inFlight = new Map();
const watchers = new Set();

export function onStats(watcher) {
  watchers.add(watcher);
  watcher(stats);
}

export function withQuery(path, query = {}) {
  const pairs = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') pairs.set(name, value);
  }
  const tail = pairs.toString();
  return tail ? `${path}?${tail}` : path;
}

function tally(kind, body) {
  if (kind) stats[kind] += 1;
  for (const watcher of watchers) watcher(stats);
  return body;
}

// One conditional GET. `cache: 'no-cache'` has the browser revalidate its stored copy with If-None-Match, for weak
// W/"…" validators as for strong ones, and hand back the stored body on a 304. The header is left to the browser on
// purpose: make.fun's 304 carries no CORS header, so a hand-set If-None-Match would fail the read, and a plain GET
// also needs no preflight. An answer whose ETag is the one already held is the same answer: the parsed copy is
// reused, nothing is parsed again and views are told nothing changed.
async function revalidate(path, held) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 20000);
  try {
    stats.requests += 1;
    const answer = await fetch(API + path, { method: 'GET', credentials: 'omit', cache: 'no-cache', signal: stop.signal });
    stats.offline = false;
    const etag = answer.headers.get('etag');
    if (held && (answer.status === 304 || (answer.ok && etag && etag === held.etag))) {
      remember(path, { ...held, at: Date.now() });
      return tally('revalidated', held.body);
    }
    if (!answer.ok) {
      const failure = new Error(answer.status === 404 ? 'make.fun has nothing at this address.' : `make.fun answered ${answer.status}.`);
      failure.status = answer.status;
      throw failure;
    }
    const body = await answer.json();
    remember(path, { body, etag, at: Date.now() });
    return tally('', body);
  } catch (failure) {
    if (held && !failure.status) {
      stats.offline = true;
      return tally('', held.body);
    }
    throw failure.name === 'AbortError' ? new Error('make.fun took too long to answer.') : failure;
  } finally {
    clearTimeout(timer);
  }
}

// Newest last; the oldest answers fall out once the cache is full.
function remember(path, entry) {
  etagCache.delete(path);
  etagCache.set(path, entry);
  for (const oldest of etagCache.keys()) {
    if (etagCache.size <= KEEP) break;
    etagCache.delete(oldest);
  }
}
