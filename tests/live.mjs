// Live browser check for Tote: serves app/, walks every surface at phone and desktop sizes against the real
// make.fun API, asserts content and hygiene, and (with --shots) captures the submission screenshots.
// Run: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/live.mjs [--shots]
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const takeShots = process.argv.includes('--shots');
const SLUG = 'makefun-frontend-01';
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }];
const LIMIT = 262144;

const failures = [];
const rows = [];
const net = { api: 0, apiNotModified: 0, conditional: 0, weakConditional: 0, wire304: 0 };
const problems = { console: [], pageErrors: [], failed: [], bad: [], badRequests: [], foreign: [] };

function check(label, ok, detail = '') {
  if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ''}`);
  return ok;
}

async function startServer() {
  const child = spawn(process.execPath, ['serve.ts'], { cwd: repo, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not print an address: ${log}`)), 15000);
    const onData = chunk => {
      log += chunk;
      const hit = /http:\/\/127\.0\.0\.1:\d+/.exec(log);
      if (hit) { clearTimeout(timer); resolve(hit[0]); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${log}`)); });
  });
  return { child, base };
}

async function watch(page, base, where, { staged503 = false } = {}) {
  const local = new URL(base).origin;
  // A probe that stages a 503 itself makes the browser log that answer; those lines are the probe's, not the app's.
  page.on('console', message => { if (message.type() === 'error' && !(staged503 && /status of 503/.test(message.text()))) problems.console.push(`${where}: ${message.text()}`); });
  page.on('pageerror', error => problems.pageErrors.push(`${where}: ${error.message}`));
  page.on('requestfailed', request => problems.failed.push(`${where}: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('request', request => {
    const url = request.url();
    if (url.startsWith('https://make.fun/api/') || url === 'https://make.fun/api') {
      net.api += 1;
      if (request.method() !== 'GET') problems.badRequests.push(`${where}: ${request.method()} ${url}`);
      return;
    }
    if (/^(script|stylesheet|font)$/.test(request.resourceType())) {
      const origin = new URL(url).origin;
      if (origin !== local && origin !== 'https://make.fun') problems.foreign.push(`${where}: ${request.resourceType()} ${url}`);
    }
  });
  page.on('response', response => {
    const url = response.url();
    if (response.status() >= 400 && !(staged503 && response.status() === 503)) problems.bad.push(`${where}: ${response.status()} ${url}`);
    if (url.startsWith('https://make.fun/api/') && response.status() === 304) net.apiNotModified += 1;
  });
  // What really went over the wire, read from the DevTools protocol: the validator the browser's cache attached to
  // each conditional GET, and make.fun's 304s, which the page itself only ever sees as the stored 200.
  const wire = await page.context().newCDPSession(page);
  await wire.send('Network.enable');
  const apiRequests = new Set();
  wire.on('Network.requestWillBeSentExtraInfo', event => {
    const sent = Object.fromEntries(Object.entries(event.headers).map(([name, value]) => [name.toLowerCase(), value]));
    if (sent[':authority'] !== 'make.fun' || !String(sent[':path']).startsWith('/api/')) return;
    apiRequests.add(event.requestId);
    const validator = sent['if-none-match'];
    if (!validator) return;
    net.conditional += 1;
    if (validator.startsWith('W/')) net.weakConditional += 1;
  });
  wire.on('Network.responseReceivedExtraInfo', event => {
    if (event.statusCode === 304 && apiRequests.has(event.requestId)) net.wire304 += 1;
  });
}

async function go(page, hash) {
  await page.evaluate(next => { window.__shotReady = false; location.hash = next; }, hash);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
}

async function common(page, label) {
  const wide = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  check(`${label}: no horizontal scroll`, wide.scroll <= wide.inner, `${wide.scroll} > ${wide.inner}`);
  const text = await page.evaluate(() => `${document.querySelector('#board')?.innerText ?? ''}\n${document.querySelector('#view')?.innerText ?? ''}`);
  check(`${label}: no "undefined"/"NaN" text`, !/undefined|NaN/.test(text), (/.{0,30}(undefined|NaN).{0,30}/.exec(text) ?? [''])[0]);
}

async function surface(page, label, selector, assert) {
  const found = await page.waitForSelector(selector, { timeout: 30000, state: 'attached' }).then(() => true, () => false);
  if (!check(`${label}: ${selector} present`, found)) return { ok: false, note: 'missing' };
  const before = failures.length;
  const note = await assert();
  await common(page, label);
  return { ok: failures.length === before, note };
}

async function visit(page, vp, step) {
  const label = `${vp.name} ${step.name}`;
  const started = failures.length;
  try {
    await step.run(label);
  } catch (error) {
    check(`${label}: completed`, false, error.message.split('\n')[0]);
  }
  rows.push({ viewport: vp.name, route: step.name, result: failures.length === started ? 'ok' : 'FAIL', note: step.note ?? '' });
}

async function walk(browser, base, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  await watch(page, base, vp.name);
  await page.goto(`${base}/#/`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
  let profileHref = '';

  const steps = [
    {
      name: '#/',
      run: async label => {
        await surface(page, label, '#board [data-slug]', async () => {
          const shown = await page.$$eval('#board [data-slug]', els => els.filter(el => el.offsetParent !== null).map(el => el.innerText));
          check(`${label}: at least 1 visible board row`, shown.length >= 1, `${shown.length}`);
          check(`${label}: every visible row shows a $ amount`, shown.every(text => text.includes('$')), `${shown.filter(text => !text.includes('$')).length} without`);
          check(`${label}: row has a bounty link`, (await page.$$('#board [data-slug] a[href^="#/bounty/"]')).length >= 1);
          if (vp.width < 1000) check(`${label}: phone board hides #view`, await page.$eval('#view', el => el.offsetParent === null || el.innerText.trim() === ''));
          else check(`${label}: desktop shows board and view side by side`, await page.evaluate(() => {
            const a = document.querySelector('#board').getBoundingClientRect(), b = document.querySelector('#view').getBoundingClientRect();
            return a.width > 0 && b.width > 0 && Math.abs(a.top - b.top) < 200 && (a.right <= b.left + 1 || b.right <= a.left + 1);
          }));
          return `${shown.length} rows`;
        });
      },
    },
    {
      name: `#/bounty/${SLUG}`,
      run: async label => {
        await go(page, `#/bounty/${SLUG}`);
        await surface(page, label, '#view article[data-bounty]', async () => {
          check(`${label}: pot tag`, (await page.$eval('#view .tag.big', el => el.innerText).catch(() => '')).includes('$'));
          check(`${label}: rewards table has a body row`, (await page.$$('#view table.grid tbody tr')).length >= 1);
          check(`${label}: dates shown`, (await page.$$('#view .kv')).length >= 1 && /\d{4}/.test(await page.$eval('#view .kv', el => el.innerText).catch(() => '')));
          check(`${label}: leaderboard link`, (await page.$$(`#view a[href="#/bounty/${SLUG}/leaderboard"]`)).length >= 1);
        });
      },
    },
    {
      name: `#/bounty/${SLUG}/leaderboard`,
      run: async label => {
        await go(page, `#/bounty/${SLUG}/leaderboard`);
        await surface(page, label, '#view [data-rank]', async () => {
          const count = (await page.$$('#view [data-rank]')).length;
          check(`${label}: >= 10 leaderboard rows`, count >= 10, `${count}`);
          profileHref = await page.$eval('#view a[href^="#/u/"]', el => el.getAttribute('href')).catch(() => '');
          check(`${label}: profile link`, profileHref.startsWith('#/u/'));
          check(`${label}: Load next 50 button`, await page.evaluate(() => [...document.querySelectorAll('#view button')].some(b => /load next 50/i.test(b.innerText))), 'only expected when more than 50 entrants');
        });
      },
    },
    {
      name: '#/u/<first from leaderboard>',
      run: async label => {
        check(`${label}: have a profile link to follow`, profileHref !== '');
        await go(page, profileHref);
        await surface(page, label, '#view article[data-profile]', async () => {
          check(`${label}: profile has a name`, (await page.$eval('#view article[data-profile]', el => el.innerText.trim().length)) > 3);
        });
      },
    },
    {
      name: '#/builders',
      run: async label => {
        await go(page, '#/builders');
        await surface(page, label, '#view [data-builder]', async () => {
          const count = (await page.$$('#view [data-builder]')).length;
          check(`${label}: >= 5 builders`, count >= 5, `${count}`);
        });
      },
    },
    {
      name: '#/ refreshed',
      run: async label => {
        // Back on the board, the app's own refresh button forces a re-read: the browser must send the stored weak
        // validator, and the page must still stand (make.fun's 304 has no CORS header, so a hand-set one would fail).
        await go(page, '#/');
        const before = net.weakConditional;
        await page.evaluate(() => { window.__shotReady = false; document.querySelector('#refresh').click(); });
        await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
        await page.waitForTimeout(300);
        check(`${label}: refresh sent If-None-Match with a weak W/ validator`, net.weakConditional > before, `${net.weakConditional - before}`);
        check(`${label}: header still says Live`, /live/i.test(await page.$eval('#wire', el => el.innerText).catch(() => 'Live')) || vp.width < 1000);
        await surface(page, label, '#board [data-slug]', async () => {});
      },
    },
  ];
  for (const step of steps) await visit(page, vp, step);
  await context.close();
}

// Lifecycle on the clock. The live list is passed through with two edits made in the test's own interception: one
// open bounty's deadline is moved a few seconds ahead and another gets an opening time an hour away. The board must
// leave the unopened one out of "Open now" and the live-pot sum from the start, then, when the moved deadline
// passes, flip that row to closed and lower both totals with exactly one re-render and no reload.
async function lifecycle(browser, base, vp) {
  const label = `${vp.name} lifecycle`;
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  await watch(page, base, label);
  const moved = { closing: null, unopened: null, at: 0, pots: {} };
  await page.route('https://make.fun/api/competitions?activity=times', async route => {
    const answer = await route.fetch();
    const body = await answer.json();
    const open = body.items
      .filter(item => item.status === 'open' && Date.parse(item.deadline) > Date.now() + 60000 && !(Date.parse(item.opensAt) > Date.now()))
      .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
    if (!moved.closing && open.length >= 3) {
      moved.closing = open[1].slug;
      moved.unopened = open[2].slug;
      moved.at = Date.now() + 7000;
      moved.pots = { closing: Number(open[1].potUsd ?? open[1].rewardAmount), unopened: Number(open[2].potUsd ?? open[2].rewardAmount), all: open.reduce((sum, item) => sum + Number(item.potUsd ?? item.rewardAmount), 0), count: open.length };
    }
    for (const item of body.items) {
      if (item.slug === moved.closing) item.deadline = new Date(moved.at).toISOString();
      if (item.slug === moved.unopened) item.opensAt = new Date(moved.at + 3600000).toISOString();
    }
    await route.fulfill({ response: answer, json: body });
  });
  await page.addInitScript(() => {
    let ready;
    window.__renders = 0;
    Object.defineProperty(window, '__shotReady', { get: () => ready, set: value => { if (value === false) window.__renders += 1; ready = value; } });
  });
  await page.goto(`${base}/#/`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
  if (!check(`${label}: at least three open bounties to work with`, Boolean(moved.closing))) return context.close();
  const read = () => page.evaluate(slug => ({
    open: Number(document.querySelector('#board .bd-big')?.innerText),
    pot: Number(document.querySelector('#board .bd-pots .tag')?.innerText.replace(/[$,]/g, '')),
    phase: document.querySelector(`#board [data-slug="${slug}"]`)?.dataset.phase,
    renders: window.__renders,
  }), moved.closing);
  const before = await read();
  check(`${label}: unopened bounty is not counted open`, before.open === moved.pots.count - 1, `${before.open} of ${moved.pots.count}`);
  check(`${label}: unopened bounty's pot is not in the live sum`, Math.abs(before.pot - (moved.pots.all - moved.pots.unopened)) < 5, `${before.pot} vs ${moved.pots.all - moved.pots.unopened}`);
  check(`${label}: unopened bounty has no row on the open tab`, (await page.$(`#board [data-slug="${moved.unopened}"]`)) === null);
  await page.waitForFunction(slug => document.querySelector(`#board [data-slug="${slug}"]`)?.dataset.phase === 'closed', moved.closing, { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  const after = await read();
  check(`${label}: row flips to closed at its deadline without a reload`, after.phase === 'closed', String(after.phase));
  check(`${label}: open count drops by one`, after.open === before.open - 1, `${before.open} -> ${after.open}`);
  check(`${label}: live-pot sum drops by that pot`, Math.abs(before.pot - after.pot - moved.pots.closing) < 5, `${before.pot} -> ${after.pot}`);
  check(`${label}: exactly one re-render`, after.renders === before.renders + 1, `${before.renders} -> ${after.renders}`);
  rows.push({ viewport: vp.name, route: 'deadline flip (simulated)', result: failures.some(text => text.startsWith(label)) ? 'FAIL' : 'ok', note: `${before.open}->${after.open} open` });
  await context.close();
}

// An opening on the clock. One open bounty is given an opening time a few seconds ahead, in the test's own
// interception. On the default "Open now" tab it has no row and no clock on screen, so nothing visible is counting
// down to it; the board must still count it open, add its pot and post its row when the time passes, with exactly
// one re-render, no reload and no click.
async function opening(browser, base, vp) {
  const label = `${vp.name} opening`;
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  await watch(page, base, label);
  const moved = { slug: null, at: 0, pot: 0 };
  await page.route('https://make.fun/api/competitions?activity=times', async route => {
    const answer = await route.fetch();
    const body = await answer.json();
    const open = body.items
      .filter(item => item.status === 'open' && Date.parse(item.deadline) > Date.now() + 3600000 && !(Date.parse(item.opensAt) > Date.now()))
      .sort((a, b) => Date.parse(b.deadline) - Date.parse(a.deadline));
    if (!moved.slug && open.length >= 2) Object.assign(moved, { slug: open[0].slug, at: Date.now() + 6000, pot: Number(open[0].potUsd ?? open[0].rewardAmount) });
    for (const item of body.items) if (item.slug === moved.slug) item.opensAt = new Date(moved.at).toISOString();
    await route.fulfill({ response: answer, json: body });
  });
  await page.addInitScript(() => {
    let ready;
    window.__renders = 0;
    Object.defineProperty(window, '__shotReady', { get: () => ready, set: value => { if (value === false) window.__renders += 1; ready = value; } });
  });
  await page.goto(`${base}/#/`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
  if (!check(`${label}: at least two open bounties to work with`, Boolean(moved.slug))) return context.close();
  const read = () => page.evaluate(slug => ({
    open: Number(document.querySelector('#board .bd-big')?.innerText),
    pot: Number(document.querySelector('#board .bd-pots .tag')?.innerText.replace(/[$,]/g, '')),
    soon: Number(document.querySelector('#board [data-count="soon"]')?.innerText),
    row: document.querySelector(`#board [data-slug="${slug}"]`)?.dataset.phase ?? 'no row',
    renders: window.__renders,
    at: new Date().toISOString(),
  }), moved.slug);
  const before = await read();
  check(`${label}: the upcoming bounty has no row on the open tab`, before.row === 'no row', before.row);
  check(`${label}: it is counted as opening soon`, before.soon >= 1, String(before.soon));
  check(`${label}: no clock on screen counts down to the opening`, await page.evaluate(at => !document.querySelector(`[data-until="${at}"]`), moved.at));
  await page.waitForTimeout(Math.max(0, moved.at - Date.now()) + 2500);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
  const after = await read();
  check(`${label}: opens on its own, with no click`, after.row === 'open', after.row);
  check(`${label}: open count rises by one`, after.open === before.open + 1, `${before.open} -> ${after.open}`);
  check(`${label}: live-pot sum rises by that pot`, Math.abs(after.pot - before.pot - moved.pot) < 5, `${before.pot} -> ${after.pot}`);
  check(`${label}: opening-soon count drops by one`, after.soon === before.soon - 1, `${before.soon} -> ${after.soon}`);
  check(`${label}: exactly one re-render`, after.renders === before.renders + 1, `${before.renders} -> ${after.renders}`);
  console.log(`${label}: opens ${new Date(moved.at).toISOString()} | before ${before.at} open ${before.open} pot $${before.pot} soon ${before.soon} | after ${after.at} open ${after.open} pot $${after.pot} soon ${after.soon}, ${after.renders - before.renders} re-render, no interaction`);
  rows.push({ viewport: vp.name, route: 'opening flip (simulated)', result: failures.some(text => text.startsWith(label)) ? 'FAIL' : 'ok', note: `${before.open}->${after.open} open` });
  await context.close();
}

// A bounty whose own address is not ready. Every read under /competitions/<slug> (its summary, rules and standings)
// is answered 503 board_pending here, as make.fun answers for a bounty whose board is not built yet. The featured
// pane on the cover, and the bounty's own page, must stay useful on the board list's data instead of an error.
async function pending(browser, base, vp) {
  const label = `${vp.name} pending`;
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  await watch(page, base, label, { staged503: true });
  let staged = 0;
  await page.route(url => url.href.startsWith('https://make.fun/api/competitions/'), async route => {
    staged += 1;
    await route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*', 'retry-after': '5' }, json: { error: 'The board is being built.', code: 'board_pending', retry_after: 5 } });
  });
  await page.goto(`${base}/#/`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
  const pane = () => page.evaluate(() => {
    const view = document.querySelector('#view');
    return { text: view.innerText, slug: view.querySelector('[data-bounty]')?.dataset.bounty ?? '', pot: view.querySelector('.tag.big')?.innerText ?? '', rewards: view.querySelectorAll('table.grid tbody tr').length, clock: view.querySelectorAll('[data-until]').length };
  });
  let slug = '';
  if (vp.width >= 1000) {
    const cover = await pane();
    slug = cover.slug;
    check(`${label}: the 503 was staged`, staged >= 1, String(staged));
    check(`${label}: featured pane is not an error`, !/did not load|answered 503/i.test(cover.text), cover.text.slice(0, 80));
    check(`${label}: featured pane names a bounty`, cover.slug !== '');
    check(`${label}: featured pane shows the pot`, cover.pot.includes('$'), cover.pot);
    check(`${label}: featured pane shows rewards from the list`, cover.rewards >= 1, String(cover.rewards));
    check(`${label}: featured pane keeps its countdown`, cover.clock >= 1, String(cover.clock));
    check(`${label}: featured pane says where the figures come from`, /board’s list/.test(cover.text));
    if (process.env.PENDING_SHOT) await page.screenshot({ path: process.env.PENDING_SHOT });
  } else {
    slug = await page.$eval('#board [data-slug]', el => el.dataset.slug);
  }
  await go(page, `#/bounty/${slug}`);
  const own = await pane();
  check(`${label}: bounty page is not an error`, !/did not load|answered 503/i.test(own.text), own.text.slice(0, 80));
  check(`${label}: bounty page shows pot, rewards and dates`, own.pot.includes('$') && own.rewards >= 1 && /\d{4}/.test(own.text), `${own.pot} ${own.rewards}`);
  await common(page, label);
  rows.push({ viewport: vp.name, route: 'summary 503 fallback (simulated)', result: failures.some(text => text.startsWith(label)) ? 'FAIL' : 'ok', note: slug });
  await context.close();
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const pending = [...document.images].filter(img => !img.complete);
    await Promise.all(pending.map(img => new Promise(done => { img.onload = img.onerror = done; setTimeout(done, 8000); })));
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function shoot(browser, base) {
  const list = JSON.parse(await readFile(join(repo, 'shots.json'), 'utf8'));
  check('shots.json is a non-empty array', Array.isArray(list) && list.length > 0);
  await mkdir(join(repo, 'screenshots'), { recursive: true });
  // One visit, one tab: the first shot's address is opened and refreshed once with the app's own button, and each
  // later shot is reached by navigating inside the app, so the header's request counters show a real session.
  const context = await browser.newContext({ viewport: list[0].viewport });
  const page = await context.newPage();
  await watch(page, base, 'shots');
  for (const [index, shot] of list.entries()) {
    const hash = `#/${String(shot.path).replace(/^\/?#?\/?/, '')}`;
    await page.setViewportSize({ width: shot.viewport.width, height: shot.viewport.height });
    if (index === 0) {
      await page.goto(`${base}/${hash}`);
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
      await page.evaluate(() => { window.__shotReady = false; document.querySelector('#refresh').click(); });
      await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
    } else {
      await go(page, hash);
    }
    await settle(page);
    const target = join(repo, 'screenshots', shot.file);
    let quality = 90, bytes = 0;
    for (;;) {
      await page.screenshot({ path: target, type: 'jpeg', quality });
      bytes = (await stat(target)).size;
      if (bytes <= LIMIT || quality <= 10) break;
      quality -= 8;
    }
    check(`shot ${shot.file} <= ${LIMIT} bytes`, bytes <= LIMIT, `${bytes}`);
    console.log(`shot ${shot.file}: ${bytes} bytes at quality ${quality}`);
  }
  await context.close();
}

const server = await startServer().catch(error => { console.error(error.message); return null; });
let summary = 'EXIT-SUMMARY: FAIL (server did not start)';
let code = 1;
try {
  if (!server) throw new Error('no server');
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const vp of VIEWPORTS) await walk(browser, server.base, vp);
    for (const vp of VIEWPORTS) await lifecycle(browser, server.base, vp);
    for (const vp of VIEWPORTS) await opening(browser, server.base, vp);
    for (const vp of VIEWPORTS) await pending(browser, server.base, vp);
    if (takeShots) await shoot(browser, server.base);
  } finally {
    await browser.close();
  }
  check('console errors = 0', problems.console.length === 0, problems.console.slice(0, 3).join(' | '));
  check('page errors = 0', problems.pageErrors.length === 0, problems.pageErrors.slice(0, 3).join(' | '));
  check('failed requests = 0', problems.failed.length === 0, problems.failed.slice(0, 3).join(' | '));
  check('HTTP >= 400 responses = 0', problems.bad.length === 0, problems.bad.slice(0, 3).join(' | '));
  check('every API call is GET', problems.badRequests.length === 0, problems.badRequests.join(' | '));
  check('API was called', net.api > 0);
  check('no script/style/font from foreign origins', problems.foreign.length === 0, problems.foreign.slice(0, 3).join(' | '));
  console.table(rows);
  console.log(`Conditional GETs on the wire: ${net.conditional} (weak validator: ${net.weakConditional}); 304 answers on the wire: ${net.wire304}`);
  console.log(`API GET count: ${net.api}; 304 count: ${net.apiNotModified}; console errors: ${problems.console.length}; page errors: ${problems.pageErrors.length}; failed: ${problems.failed.length}; HTTP>=400: ${problems.bad.length}`);
  for (const failure of failures) console.log(`FAILED: ${failure}`);
  code = failures.length === 0 ? 0 : 1;
  summary = `EXIT-SUMMARY: ${code === 0 ? 'PASS' : 'FAIL'} ${failures.length} failed assertion(s), ${rows.length} route checks, API GET ${net.api}, 304 ${net.apiNotModified}`;
} catch (error) {
  console.log(`ERROR: ${error.stack ?? error}`);
  summary = `EXIT-SUMMARY: FAIL (${String(error.message).split('\n')[0]})`;
} finally {
  server?.child.kill();
}
console.log(summary);
process.exit(code);
