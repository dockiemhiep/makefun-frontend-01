import test from 'node:test';
import assert from 'node:assert/strict';
import { lifecycle, countdown, markdown, dollars, avatar } from '../app/ui.js';
import { boardTotals } from '../app/board.js';
import { scoreText } from '../app/bounty.js';

const NOW = Date.parse('2026-11-17T06:00:00Z');
const bounty = (changes = {}) => ({ status: 'open', opensAt: '2026-11-16T00:00:00Z', deadline: '2026-11-18T00:00:00Z', potUsd: '125.50', ...changes });

test('open totals exclude future openings and stale API-open deadlines', () => {
  const data = [bounty(), bounty({ opensAt: '2026-11-18T00:00:00Z', potUsd: '900' }), bounty({ deadline: '2026-11-17T05:59:59Z', potUsd: '1000' }), bounty({ status: 'closed', potUsd: '500' })];
  assert.deepEqual(boardTotals(data, NOW), { open: 1, pot: 125.5 });
});

test('lifecycle changes at the exact opening and deadline', () => {
  const entry = bounty({ opensAt: new Date(NOW).toISOString(), deadline: new Date(NOW + 1000).toISOString() });
  assert.equal(lifecycle(entry, NOW - 1), 'upcoming');
  assert.equal(lifecycle(entry, NOW), 'open');
  assert.equal(lifecycle(entry, NOW + 999), 'open');
  assert.equal(lifecycle(entry, NOW + 1000), 'judging');
  assert.equal(lifecycle(bounty({ status: 'cancelled' }), NOW), 'cancelled');
});

test('unknown dates and zero rewards stay readable', () => {
  assert.doesNotThrow(() => countdown({ status: 'closed' }));
  assert.equal(dollars(0), '$0');
  assert.equal(dollars(null), '—');
});

test('live judge columns convert millionths to percentages without treating other rates as millionths', () => {
  assert.equal(scoreText(956066, { key: 'judge', title: 'Judge win rate', source: 'performance.judge.win_rate_micro' }), '95.6%');
  assert.equal(scoreText(938805, { key: 'judge_low', title: 'Interval low', source: 'performance.judge.interval_low_micro' }), '93.9%');
  assert.equal(scoreText(0, { source: 'performance.judge.win_rate_micro' }), '0.0%');
  assert.equal(scoreText(null, { source: 'performance.judge.win_rate_micro' }), '—');
  assert.equal(scoreText(0.75, { key: 'rate', title: 'Win rate' }), '75.0%');
  assert.equal(scoreText(936439, { key: 'bytes', title: 'Size' }), '936,439');
});

test('live avatar fields resolve to make.fun with CORS enabled before the source', () => {
  const html = avatar({ handle: 'builder', image: '/api/avatars/fallback.webp', avatar: { url_small: '/api/avatars/small.webp' } });
  assert.ok(html.includes('crossorigin="anonymous" src="https://make.fun/api/avatars/small.webp"'));
  assert.ok(avatar({ handle: 'builder' }).includes('BU'));
});

test('untrusted description HTML and link schemes cannot execute', () => {
  const rendered = markdown('# Task\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n- **Safe** `code`');
  assert.ok(!rendered.includes('<script>'));
  assert.ok(!rendered.includes('href="javascript:'));
  assert.ok(rendered.includes('<strong>Safe</strong>'));
  assert.ok(rendered.includes('<code>code</code>'));
});

test('weak ETags are reused verbatim; fresh reads and concurrent reads reuse data', async () => {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let now = NOW;
  let requests = [];
  Date.now = () => now;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    if (requests.length === 1) return new Response('{"items":[{"slug":"one"}]}', { headers: { ETag: 'W/"minute-bound"' } });
    assert.equal(options.headers['If-None-Match'], 'W/"minute-bound"');
    return new Response(null, { status: 304 });
  };
  try {
    const { get } = await import('../app/api.js?etag-regression');
    const first = await get('/competitions?activity=times');
    assert.equal(first.items[0].slug, 'one');
    await get('/competitions?activity=times');
    assert.equal(requests.length, 1);
    now += 31000;
    const [second, third] = await Promise.all([get('/competitions?activity=times'), get('/competitions?activity=times')]);
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
    assert.equal(requests.length, 2);
    await get('/competitions?activity=times', { force: true });
    assert.equal(requests.length, 3);
    await assert.rejects(get('//other-origin/api'), /Invalid public API path/);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
});

test('cursor helpers preserve opaque server cursors', async () => {
  const { nextCursor, apiPath } = await import('../app/api.js');
  const cursor = 'opaque+/== &after';
  const path = apiPath('/rankings', { cursor });
  assert.equal(new URL(path, 'https://make.fun/api').searchParams.get('cursor'), cursor);
  assert.equal(nextCursor({ items: [], next_cursor: cursor }), cursor);
  assert.equal(nextCursor({ items: [], next_cursor: null }), null);
});
