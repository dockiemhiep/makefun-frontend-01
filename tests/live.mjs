import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = process.env.MAKEFUN_QA_PORT || '0';
let base;
const modulePath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(modulePath);
const temporary = await mkdtemp(join(tmpdir(), 'makefun-live-'));
const server = spawn(process.execPath, ['serve.ts'], { cwd: root, env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverError = '';
server.stderr.on('data', chunk => { serverError += chunk; });
let browser;
const errors = [], failures = [], apiRequests = [];
const apiResponses = new Map();
const results = [];
const usd = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Number(value));
async function apiData(path) {
  const match = [...apiResponses].find(([url]) => new URL(url).pathname === '/api' + path);
  assert.ok(match, `Missing live API response for ${path}`);
  return match[1];
}
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Static server did not start. ' + serverError)), 10000);
    let output = '';
    server.stdout.on('data', chunk => {
      output += chunk;
      const address = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
      if (address) { base = address[0] + '/'; clearTimeout(timer); resolve(); }
    });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Static server exited ${code}. ${serverError}`)); });
  });
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('requestfailed', request => failures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', response => {
    if (response.status() >= 400) failures.push(`HTTP ${response.status()} ${response.url()}`);
    if (response.status() === 200 && response.url().startsWith('https://make.fun/api/')) {
      apiResponses.set(response.url(), response.json().catch(() => null));
    }
  });
  page.on('request', request => {
    if (request.url().startsWith('https://make.fun/api/')) { apiRequests.push(request.url()); assert.equal(request.method(), 'GET'); }
  });
  async function visit(path) {
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 30000 });
    assert.ok(!await page.getByRole('heading', { name: 'Couldn’t load this page.' }).count(), `API error at ${path}`);
    assert.equal(await page.locator('main h1').count(), 1, `Missing page heading at ${path}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${path}`);
    await page.waitForFunction(() => [...document.images].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0;
    }).every(image => image.complete && image.naturalWidth > 0), undefined, { timeout: 15000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    results.push({ route: path, viewport: page.viewportSize(), heading: await page.locator('main h1').innerText() });
  }
  const shots = JSON.parse(await readFile(join(root, 'shots.json'), 'utf8'));
  for (const shot of shots) {
    await page.setViewportSize(shot.viewport);
    await visit(shot.path);
    if (shot.path === '#/') assert.ok(await page.locator('.bounty-card').count() > 0, 'The board must show live bounties.');
    if (shot.path.endsWith('/leaderboard')) {
      const data = await apiData('/competitions/makefun-frontend-01/leaderboard');
      assert.ok(data.entries.length > 0, 'The leaderboard must show live entries.');
      assert.equal(await page.locator('.leaderboard .primary-score').first().innerText(), `${(data.entries[0].values.judge / 10000).toFixed(1)}%`, 'The live judge score must render, in percent');
      assert.equal(await page.locator('.leaderboard th').nth(2).innerText(), data.columns[0].title);
      assert.equal(await page.locator('.leaderboard tbody tr').count(), Math.min(25, data.entries.length));
    } else if (shot.path.startsWith('#/bounty/')) {
      const data = await apiData('/competitions/makefun-frontend-01/requirements');
      assert.equal(await page.locator('.reward-table tbody tr').count(), data.payout_curve.places.length);
      assert.equal(await page.locator('.reward-table tbody td').nth(1).innerText(), usd(data.payout_curve.places[0].amount_usd));
      assert.ok((await page.locator('.schedule-panel').innerText()).includes('Nov 17, 2026'));
    }
    await page.screenshot({ path: join(temporary, shot.file), type: 'jpeg', quality: 80 });
  }
  let profileLink = await page.locator('.builder-link').first().getAttribute('href').catch(() => null);
  if (!profileLink) {
    await visit('#/builders');
    profileLink = await page.locator('.person').first().getAttribute('href');
  }
  assert.ok(profileLink, 'A public profile must be reachable by link.');
  await visit(profileLink);
  assert.ok(await page.locator('.profile-stats').count(), 'Profile statistics must render.');
  const profile = await apiData('/profiles/' + decodeURIComponent(profileLink.split('/').pop()));
  assert.deepEqual(await page.locator('.profile-stats dd').allInnerTexts(), [profile.record.competitions_entered, profile.record.competitions_placed, profile.record.competitions_won].map(value => Number(value).toLocaleString('en-US')).concat(usd(profile.record.prize_usd)));
  assert.equal(await page.locator('.solution').count(), Math.min(20, profile.solutions.length));
  assert.ok(!(await page.locator('.solutions').innerText()).includes('Not announced'), 'Solution dates must use entered_at');
  await page.screenshot({ path: join(temporary, 'desktop-profile.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [index, path] of ['#/', shots[1].path, shots[2].path, profileLink].entries()) {
    await visit(path);
    await page.screenshot({ path: join(temporary, `mobile-${['board', 'bounty', 'leaderboard', 'profile'][index]}.png`), fullPage: index === 3 });
  }
  assert.deepEqual(errors, [], 'Console errors');
  assert.deepEqual(failures, [], 'Failed requests');
  assert.ok(apiRequests.length >= 4, 'Live make.fun API requests must be observed.');
  for (const shot of shots) {
    const bytes = await readFile(join(temporary, shot.file));
    assert.ok(bytes.length <= 262144, `${shot.file} exceeds the screenshot cap`);
  }
  for (const name of await readdir(join(root, 'screenshots'))) {
    if (!shots.some(shot => shot.file === name) && /\.(png|jpe?g)$/i.test(name)) await rm(join(root, 'screenshots', name));
  }
  for (const shot of shots) await copyFile(join(temporary, shot.file), join(root, 'screenshots', shot.file));
  const report = { checkedAt: new Date().toISOString(), browser: await browser.version(), server: base, results, consoleErrors: errors, failedRequests: failures, liveApiRequests: apiRequests.length, screenshots: shots.map(shot => shot.file) };
  await writeFile(join(temporary, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidenceDirectory: temporary }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
