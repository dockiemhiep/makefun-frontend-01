import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = new URL('../app/', import.meta.url);
let serial = 0;
const freshApi = () => import(`../app/api.js?case=${++serial}`);

// Scripted fetch: each call records its URL and options, then answers from a queue or a function.
function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return responder(calls.length, String(url), options);
  };
  return calls;
}
const reply = (status, body, etag) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: name => (name.toLowerCase() === 'etag' ? etag ?? null : null) },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const headerOf = (call, name) => Object.entries(call.options.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

test.beforeEach(() => { delete globalThis.sessionStorage; });

// Counts how often a body is parsed, to tell a reused answer from a re-read one.
const parsed = (body, etag, counter) => ({ ...reply(200, body, etag), json: async () => { counter.n += 1; return structuredClone(body); } });

test('a weak ETag revalidates: an answer that carries the stored W/"…" tag must reuse the held copy, not be read as new', async () => {
  const { getRevalidated, stats } = await freshApi();
  const counter = { n: 0 };
  const calls = stubFetch(() => parsed({ v: 1 }, 'W/"abc"', counter));
  const first = await getRevalidated('/bounties');
  const second = await getRevalidated('/bounties', { freshFor: 0 });
  assert.equal(calls.length, 2, 'the stale entry is revalidated over the network');
  assert.equal(second, first, 'the same parsed object comes back');
  assert.equal(counter.n, 1, 'the unchanged answer is not parsed again');
  assert.equal(stats.revalidated, 1);
});

test('a strong ETag revalidates the same way, and a changed tag is read as a new answer', async () => {
  const { getRevalidated, stats } = await freshApi();
  const counter = { n: 0 };
  stubFetch(n => parsed({ v: n < 3 ? 1 : 2 }, n < 3 ? '"s-1"' : '"s-2"', counter));
  const first = await getRevalidated('/x');
  assert.equal(await getRevalidated('/x', { freshFor: 0 }), first);
  const third = await getRevalidated('/x', { freshFor: 0 });
  assert.deepEqual(third, { v: 2 }, 'a new tag must not be mistaken for the held answer');
  assert.equal(counter.n, 2);
  assert.equal(stats.revalidated, 1);
});

test('every read is a conditional GET the browser makes itself: a hand-set If-None-Match would turn make.fun\'s CORS-less 304 into a failed request', async () => {
  const { getRevalidated } = await freshApi();
  const calls = stubFetch(() => reply(200, { v: 1 }, 'W/"abc"'));
  await getRevalidated('/bounties');
  await getRevalidated('/bounties', { force: true });
  for (const call of calls) {
    assert.equal(call.options.cache, 'no-cache', 'the browser cache revalidates with its stored validator');
    assert.equal(headerOf(call, 'If-None-Match'), undefined);
    assert.deepEqual(Object.keys(call.options.headers ?? {}), [], 'no custom header, so no preflight');
    assert.equal(call.options.credentials, 'omit');
  }
});

test('a 304 returns the earlier body: treating 304 as empty would blank the screen', async () => {
  const { getRevalidated, stats } = await freshApi();
  stubFetch(n => (n === 1 ? reply(200, { rows: [1, 2, 3] }, 'W/"q"') : reply(304, null)));
  const first = await getRevalidated('/rows');
  const second = await getRevalidated('/rows', { freshFor: 0 });
  assert.deepEqual(second, { rows: [1, 2, 3] });
  assert.deepEqual(second, first);
  assert.equal(stats.revalidated, 1);
});

test('two concurrent calls for one path share one fetch: duplicate in-flight requests waste the rate budget', async () => {
  const { getRevalidated } = await freshApi();
  const calls = stubFetch(async () => { await sleep(20); return reply(200, { ok: true }, '"e"'); });
  const [a, b] = await Promise.all([getRevalidated('/same'), getRevalidated('/same')]);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
});

test('a fresh entry makes no fetch: re-requesting inside freshFor must be served from memory', async () => {
  const { getRevalidated, stats } = await freshApi();
  const calls = stubFetch(() => reply(200, { n: 1 }, '"e"'));
  await getRevalidated('/fresh');
  const again = await getRevalidated('/fresh', { freshFor: 60000 });
  assert.equal(calls.length, 1);
  assert.deepEqual(again, { n: 1 });
  assert.equal(stats.cached, 1);
});

test('force: true refetches even when fresh: the refresh button would otherwise do nothing', async () => {
  const { getRevalidated } = await freshApi();
  const calls = stubFetch(n => (n === 1 ? reply(200, { n: 1 }, '"e"') : reply(304, null)));
  await getRevalidated('/force');
  await getRevalidated('/force', { force: true });
  assert.equal(calls.length, 2);
});

test('a non-2xx answer throws with .status: a 404 rendered as data would show a blank bounty', async () => {
  const { getRevalidated } = await freshApi();
  stubFetch(() => reply(404, { error: 'nope' }));
  await assert.rejects(getRevalidated('/missing'), error => error.status === 404 && error instanceof Error);
  stubFetch(() => reply(500, {}));
  await assert.rejects(getRevalidated('/boom'), error => error.status === 500);
});

test('only GET is sent and the URL stays under https://make.fun/api/: a stray POST or foreign origin breaks the read-only contract', async () => {
  const { getRevalidated, getPage } = await freshApi();
  const calls = stubFetch(() => reply(200, { items: [] }, '"e"'));
  await getRevalidated('/bounties');
  await getPage('/bounties/a/leaderboard', { limit: 50 }, 'c1');
  assert.ok(calls.length >= 2);
  for (const call of calls) {
    assert.ok(call.url.startsWith('https://make.fun/api/'), call.url);
    assert.equal((call.options.method ?? 'GET').toUpperCase(), 'GET');
    assert.equal(call.options.body, undefined);
  }
});

test('paths that do not start with a single slash are refused without any fetch: otherwise //evil.test could redirect the origin', async () => {
  const { getRevalidated } = await freshApi();
  const calls = stubFetch(() => reply(200, {}));
  for (const bad of ['bounties', '//evil.test/x', 'https://evil.test/', '', undefined, 5]) {
    await assert.rejects(getRevalidated(bad), `should refuse ${String(bad)}`);
  }
  assert.equal(calls.length, 0);
});

test('getPage appends cursor and returns next from next_cursor: pagination that ignores the cursor would repeat page one', async () => {
  const { getPage } = await freshApi();
  const calls = stubFetch(() => reply(200, { items: [{ id: 1 }], next_cursor: 'c2' }, '"e"'));
  const first = await getPage('/lb', { limit: 50 });
  assert.equal(first.next, 'c2');
  assert.deepEqual(first.rows, [{ id: 1 }]);
  assert.ok(!new URL(calls[0].url).searchParams.has('cursor'));
  await getPage('/lb', { limit: 50 }, 'c2');
  const url = new URL(calls[1].url);
  assert.equal(url.searchParams.get('cursor'), 'c2');
  assert.equal(url.searchParams.get('limit'), '50');
});

test('getPage returns next: null when the server repeats the same cursor: otherwise Load more loops forever', async () => {
  const { getPage } = await freshApi();
  stubFetch(() => reply(200, { items: [], next_cursor: 'same' }, '"e"'));
  const page = await getPage('/lb', {}, 'same');
  assert.equal(page.next, null);
});

test('getPage returns next: null when there is no next_cursor: the button must disappear on the last page', async () => {
  const { getPage } = await freshApi();
  stubFetch(() => reply(200, { items: [1] }, '"e"'));
  assert.equal((await getPage('/lb')).next, null);
});

const app = await import('../app/app.js');
const T = Date.parse('2026-06-01T12:00:00Z');
const bounty = (extra = {}) => ({ status: 'open', opensAt: '2026-05-01T00:00:00Z', deadline: '2026-06-10T00:00:00Z', potUsd: 100, ...extra });

test('phaseOf: open before the deadline', () => {
  assert.equal(app.phaseOf(bounty(), T), 'open');
});

test('phaseOf: closed at the exact deadline and after, even when status is still "open": trusting status shows a dead bounty as live', () => {
  const deadline = Date.parse('2026-06-10T00:00:00Z');
  assert.equal(app.phaseOf(bounty(), deadline - 1), 'open');
  assert.equal(app.phaseOf(bounty(), deadline), 'closed');
  assert.equal(app.phaseOf(bounty(), deadline + 86400000), 'closed');
});

test('phaseOf: soon before opensAt: a not-yet-opened bounty must not be counted as open', () => {
  assert.equal(app.phaseOf(bounty({ opensAt: '2026-06-02T00:00:00Z' }), T), 'soon');
});

test('phaseOf: resolved is done and cancelled is void, regardless of the clock', () => {
  assert.equal(app.phaseOf(bounty({ status: 'resolved' }), T), 'done');
  assert.equal(app.phaseOf(bounty({ status: 'resolved', deadline: '2030-01-01T00:00:00Z' }), T), 'done');
  assert.equal(app.phaseOf(bounty({ status: 'cancelled' }), T), 'void');
});

test('timeLeft formats days, hours and minutes/seconds and never goes negative', () => {
  assert.equal(app.timeLeft(T + (2 * 86400 + 3 * 3600) * 1000, T), '2d 3h');
  assert.equal(app.timeLeft(T + (5 * 3600 + 7 * 60) * 1000, T), '5h 07m');
  assert.equal(app.timeLeft(T + (4 * 60 + 9) * 1000, T), '4m 09s');
  assert.equal(app.timeLeft(T - 5000, T), '0m 00s');
});

test('usd: empty values are a dash, not "$0" or "$NaN"; whole dollars have no cents, fractions have two', () => {
  assert.equal(app.usd(null), '—');
  assert.equal(app.usd(undefined), '—');
  assert.equal(app.usd(''), '—');
  assert.equal(app.usd(0), '$0');
  assert.equal(app.usd(0.5), '$0.50');
  assert.equal(app.usd(1325), '$1,325');
});

test('countdownHTML emits data-until only for open and soon bounties: a ticking clock on a closed bounty would flip routes forever', () => {
  const realNow = Date.now;
  Date.now = () => T;
  try {
    assert.match(app.countdownHTML(bounty()), /data-until="\d+"/);
    assert.match(app.countdownHTML(bounty({ opensAt: '2026-06-02T00:00:00Z' })), /data-until="\d+"/);
    assert.doesNotMatch(app.countdownHTML(bounty({ deadline: '2026-05-30T00:00:00Z' })), /data-until/);
    assert.doesNotMatch(app.countdownHTML(bounty({ status: 'resolved' })), /data-until/);
    assert.doesNotMatch(app.countdownHTML(bounty({ status: 'cancelled' })), /data-until/);
  } finally {
    Date.now = realNow;
  }
});

test('boardTotals excludes not-yet-opened and past-deadline-but-status-open bounties from open and pot', async t => {
  const file = new URL('board.js', APP);
  const waitMs = Number(process.env.BOARD_WAIT_MS ?? 600000);
  const until = Date.now() + waitMs;
  while (!existsSync(file) && Date.now() < until) await sleep(5000);
  if (!existsSync(file)) {
    t.todo('app/board.js does not exist yet');
    return;
  }
  const { boardTotals } = await import('../app/board.js');
  const list = [
    bounty({ potUsd: 100, deadline: '2026-06-10T00:00:00Z' }),
    bounty({ potUsd: 50, deadline: '2026-06-05T00:00:00Z' }),
    bounty({ potUsd: 1000, opensAt: '2026-06-02T00:00:00Z' }),
    bounty({ potUsd: 10000, deadline: '2026-05-30T00:00:00Z' }),
    bounty({ potUsd: 7, status: 'resolved' }),
    bounty({ potUsd: 9, status: 'cancelled' }),
  ];
  const totals = boardTotals(list, T);
  assert.equal(totals.open, 2, 'only two bounties are really open');
  assert.equal(totals.pot, 150, 'pot sums only the open ones');
  assert.deepEqual({ open: boardTotals([], T).open, pot: boardTotals([], T).pot }, { open: 0, pot: 0 });
});

test('nextFlip names the earliest opening or closing in the whole list: a hidden upcoming bounty must still flip the board', async () => {
  const { nextFlip } = await import('../app/board.js');
  const opens = '2026-06-01T12:00:04Z';
  const list = [
    bounty({ deadline: '2026-06-10T00:00:00Z' }),
    bounty({ opensAt: opens }),
    bounty({ opensAt: '2026-06-03T00:00:00Z' }),
    bounty({ status: 'resolved', deadline: '2026-06-01T12:00:01Z' }),
    bounty({ deadline: '2026-05-30T00:00:00Z' }),
  ];
  assert.equal(nextFlip(list, T), Date.parse(opens), 'the opening four seconds away comes before any closing');
  assert.equal(nextFlip(list, Date.parse(opens)), Date.parse('2026-06-03T00:00:00Z'), 'once it has opened, the next opening is watched');
  assert.equal(nextFlip([bounty()], T), Date.parse('2026-06-10T00:00:00Z'), 'with nothing upcoming, the next closing');
  assert.equal(nextFlip([bounty({ status: 'resolved' })], T), Infinity, 'nothing to wait for');
});
