// Local check of the plan's flows against dist/ with a stubbed incident API (no real acks are sent).
// Usage: npm run build && node scripts/check.mjs
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = join('dist', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(path)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const incidents = [
  { id: 'INC-2', service: 'auth', region: 'eu-west', summary: '<b>not markup</b>', severity: 'sev2', openedAt: '2026-11-12T03:03:00.000Z' },
  { id: 'INC-1', service: 'exports', region: 'us-west', summary: 'slow', severity: 'sev3', openedAt: '2026-11-12T02:00:00.000Z' },
];
let fail = 0;
const ok = (cond, what) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) fail++; };

const browser = await chromium.launch({ channel: 'chrome' });
for (const [locale, timezoneId, expected] of [
  ['de-DE', 'Europe/Berlin', '12.11.2026, 04:03'],
  ['en-NZ', 'Pacific/Auckland', '12/11/2026, 16:03'],
  ['en-US', 'America/New_York', '11/11/2026, 22:03'],
]) {
  const ctx = await browser.newContext({ locale, timezoneId });
  const page = await ctx.newPage();
  const live = [...incidents];
  let acks = 0;
  await page.route('**/challenges/show-me-when/api/incidents**', async (route) => {
    await new Promise((r) => setTimeout(r, 400)); // loader must be visible meanwhile
    route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents: live, cursor: 'c' } });
  });
  await page.route('**/challenges/show-me-when/api/ack**', (route) => {
    acks++;
    const id = new URL(route.request().url()).searchParams.get('id');
    route.fulfill({ json: { id, ackedAt: new Date().toISOString(), receipt: 'r' } });
  });

  await page.goto(base);
  ok(await page.getByTestId('loader').isVisible(), `${locale}: loader on open`);
  await page.getByTestId('incident-row').first().waitFor();
  ok((await page.getByTestId('loader').count()) === 0, `${locale}: loader gone once incidents load`);
  ok((await page.locator('meta[name=build]').getAttribute('content')) === (await page.getByTestId('build-sha').textContent()), `${locale}: meta build = footer sha`);
  const t = page.locator('[data-id="INC-2"] time');
  ok((await t.getAttribute('datetime')) === '2026-11-12T03:03:00.000Z', `${locale}: full UTC in datetime`);
  const shown = await t.textContent();
  ok(shown.startsWith(expected), `${locale}: local time "${shown}" starts with "${expected}"`);
  ok((await page.locator('[data-id="INC-2"] b').count()) === 0, `${locale}: summary rendered as text`);

  // Product decision: Ack asks to confirm, naming the incident id.
  await page.locator('[data-id="INC-2"]').getByTestId('ack').click();
  ok((await page.getByTestId('confirm').innerText()).includes('INC-2'), `${locale}: confirm names INC-2`);
  await page.getByTestId('confirm-cancel').click();
  await page.waitForTimeout(300);
  ok(acks === 0 && !(await page.getByTestId('confirm').isVisible()), `${locale}: Cancel closes the confirm, no ack sent`);
  await page.locator('[data-id="INC-1"]').getByTestId('ack').click();
  ok((await page.getByTestId('confirm').innerText()).includes('INC-1'), `${locale}: confirm names INC-1`);
  await page.getByTestId('confirm-ack').click();
  await page.locator('[data-id="INC-1"]').getByTestId('acked').waitFor();
  ok(acks === 1 && !(await page.getByTestId('confirm').isVisible()), `${locale}: confirm-ack sends one ack for INC-1`);

  live.unshift({ id: 'INC-3', service: 'payments', region: 'us-east', summary: 'new one', severity: 'sev1', openedAt: '2026-11-12T03:10:00.000Z' });
  await page.locator('[data-id="INC-3"]').waitFor({ timeout: 4000 });
  const order = await page.getByTestId('incident-row').evaluateAll((r) => r.map((x) => x.dataset.id));
  ok(order.join() === 'INC-3,INC-2,INC-1', `${locale}: new incident on top without reload (${order})`);
  ok((await page.locator('[data-id="INC-1"]').getByTestId('acked').count()) === 1, `${locale}: ack mark survives refresh`);
  await ctx.close();
}
// Empty night: loader goes, the empty state shows.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**/challenges/show-me-when/api/incidents**', (route) => route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents: [], cursor: 'c' } }));
  await page.goto(base);
  await page.getByTestId('empty').waitFor();
  ok((await page.getByTestId('loader').count()) === 0, 'empty night: loader gone, empty state shown');
  await ctx.close();
}
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
