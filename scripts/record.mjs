// Records the deployed board in use (open-board, watch-board, ack-incident) the way a person uses it:
// the click is not re-aimed when a new incident lands. Usage: node scripts/record.mjs <url> <outdir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';

const [url, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({
  locale: 'pl-PL',
  timezoneId: 'Europe/Warsaw',
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: out, size: { width: 1280, height: 800 } },
});
// A visible pointer, because headless video has none.
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:9999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(220,30,60,.55);border:2px solid #b00020;pointer-events:none;left:-50px;top:-50px;transition:transform .1s';
    document.body.append(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; });
    addEventListener('mousedown', () => (dot.style.transform = 'scale(.6)'));
    addEventListener('mouseup', () => (dot.style.transform = ''));
  });
});

const page = await ctx.newPage();
const t0 = Date.now();
const at = () => {
  const s = Math.floor((Date.now() - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const timeline = [];
const mark = (what, extra = {}) => { const e = { at: at(), what, ...extra }; timeline.push(e); console.log(e); };

page.on('response', async (r) => {
  if (r.url().includes('/api/ack')) mark('ack reply', { status: r.status(), body: await r.json().catch(() => null) });
});
page.on('console', (m) => { if (m.type() === 'error') mark('console error', { text: m.text() }); });

const rowCount = () => page.getByTestId('incident-row').count();
const waitForNewRow = async (timeout = 30000) => {
  const before = await rowCount();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="incident-row"]').length > n, before, { timeout });
  return page.getByTestId('incident-row').first().getAttribute('data-id');
};
const underPointer = (x, y) =>
  page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id ?? null, [x, y]);

// open-board
await page.goto(url);
mark('open-board: page opened', { loader: await page.getByTestId('loader').isVisible().catch(() => false) });
await page.getByTestId('incident-row').first().waitFor();
mark('open-board: incidents on screen, loader gone', {
  loader: await page.getByTestId('loader').count(),
  rows: await rowCount(),
  sha: await page.locator('meta[name=build]').getAttribute('content'),
});

// watch-board
const first = await waitForNewRow();
mark('watch-board: new incident at the top without reload', { id: first, rows: await rowCount() });

// ack-incident, the way a person does it: look at the row, move to its Ack, click where the button was.
// The board keeps changing meanwhile; the click is not re-aimed after a new incident lands.
const target = process.env.TARGET || 'INC-7352';
const btn = page.locator(`[data-id="${target}"]`).getByTestId('ack');
const box = await btn.boundingBox();
const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
await page.mouse.move(p.x, p.y, { steps: 30 });
mark('pointer on Ack, about to click', { intended: target, underPointer: await underPointer(p.x, p.y) });
const arrived = await waitForNewRow();
await page.waitForTimeout(120); // the click was already on its way
const hit = await underPointer(p.x, p.y);
mark('ack-incident: click lands as a new incident comes in', { intended: target, arrived, underPointer: hit });
await page.mouse.down();
await page.mouse.up();
// The confirm names the row the click hit. A person reads it before going on.
await page.getByTestId('confirm').waitFor();
const named = await page.getByTestId('confirm').innerText();
mark('confirm opens, naming the incident the click hit', { intended: target, confirm: named.replace(/\s+/g, ' ').trim() });
await page.waitForTimeout(1800);
if (!named.includes(target)) {
  const cancel = await page.getByTestId('confirm-cancel').boundingBox();
  await page.mouse.move(cancel.x + cancel.width / 2, cancel.y + cancel.height / 2, { steps: 15 });
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
  mark('confirm names the wrong incident: Cancel, nothing sent', { intended: target });
  await page.waitForTimeout(1200);
  const again = await page.locator(`[data-id="${target}"]`).getByTestId('ack').boundingBox();
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2, { steps: 20 });
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
  await page.getByTestId('confirm').waitFor();
  mark('Ack on the intended row again: confirm names it', { confirm: (await page.getByTestId('confirm').innerText()).replace(/\s+/g, ' ').trim() });
  await page.waitForTimeout(1500);
}
const ok = await page.getByTestId('confirm-ack').boundingBox();
await page.mouse.move(ok.x + ok.width / 2, ok.y + ok.height / 2, { steps: 15 });
await page.waitForTimeout(300);
mark('ack-incident: confirm-ack', { intended: target });
await page.mouse.down();
await page.mouse.up();
await page.locator('[data-testid="acked"]').first().waitFor();
const ackedIds = await page.locator('[data-testid="incident-row"]:has([data-testid="acked"])').evaluateAll((r) => r.map((x) => x.dataset.id));
mark('ack-incident: row marked acked', { intended: target, acked: ackedIds });
await page.waitForTimeout(2500);
await waitForNewRow();
mark('watch-board: board still current', { rows: await rowCount(), acked: ackedIds });
await page.waitForTimeout(1500);

const video = page.video();
await ctx.close();
await browser.close();
renameSync(await video.path(), `${out}/board.webm`);
writeFileSync(`${out}/timeline.json`, JSON.stringify(timeline, null, 2));
console.log('saved', `${out}/board.webm`);
