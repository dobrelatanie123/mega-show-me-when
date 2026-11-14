import { fetchIncidents, ack } from './api.js';
import { REFRESH_MS } from './config.js';

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('[data-role="status"]');

/** Rows on screen, by incident id. Rows are kept, not rebuilt, so a refresh never wipes an ack or a click. */
const rows = new Map();
/** Incidents acked from this board, by id, so the mark survives refreshes. */
const acked = new Map();

// R5: the viewer's own zone and the viewer's own date order (en-GB, de-DE, en-NZ: day first).
const timeFormat = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23', // 24h: "04:03" must never mean both 4 am and 4 pm
  timeZoneName: 'short',
});

function localTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFormat.format(d);
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text; // incident text is data, never markup
  return node;
}

function ackedMark(reply) {
  return el('span', { 'data-testid': 'acked', class: 'acked', title: `acked ${reply.ackedAt}` }, 'Acked');
}

async function onAck(incidentId, button) {
  button.disabled = true;
  button.textContent = 'Acking…';
  try {
    const reply = await ack(incidentId);
    acked.set(incidentId, reply);
    const row = rows.get(incidentId);
    row?.classList.add('is-acked');
    button.replaceWith(ackedMark(reply));
  } catch (err) {
    console.error(err);
    button.disabled = false;
    button.textContent = 'Ack';
    setStatus('ack failed, try again');
  }
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id });
  row.append(el('span', { class: 'id' }, i.id), el('span', { class: 'sev' }), el('span', { class: 'what' }), el('time'));
  updateRow(row, i);
  if (acked.has(i.id)) {
    row.classList.add('is-acked');
    row.append(ackedMark(acked.get(i.id)));
  } else {
    const button = el('button', { type: 'button', 'data-testid': 'ack', class: 'ack' }, 'Ack');
    button.addEventListener('click', () => onAck(i.id, button));
    row.append(button);
  }
  return row;
}

/** Keeps a row's text current (severity, summary, time) without touching its Ack button. */
function updateRow(row, i) {
  row.classList.remove('sev1', 'sev2', 'sev3');
  row.classList.add('row', i.severity);
  row.querySelector('.sev').textContent = i.severity;
  row.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const time = row.querySelector('time');
  if (time.getAttribute('datetime') !== i.openedAt) {
    time.setAttribute('datetime', i.openedAt);
    time.title = i.openedAt;
    time.textContent = localTime(i.openedAt);
  }
}

/** R1: new incidents go in at the top, newest first; rows already on screen stay as they are. */
function render(incidents) {
  const current = new Set(incidents.map((i) => i.id));
  for (const [id, row] of rows) {
    if (!current.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  let next = list.firstElementChild;
  for (const i of incidents) {
    let row = rows.get(i.id);
    if (!row) {
      row = buildRow(i);
      rows.set(i.id, row);
      row.classList.add('is-new');
      setTimeout(() => row.classList.remove('is-new'), 1500);
    } else {
      updateRow(row, i);
    }
    if (row !== next) list.insertBefore(row, next);
    next = row.nextElementSibling;
  }
  empty.hidden = incidents.length > 0;
}

function setStatus(text) {
  status.textContent = text ? `· ${text}` : '';
}

let loaded = false;

// R4: ask again every REFRESH_MS while the board is open. One request at a time.
async function tick() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    if (!loaded) {
      loaded = true;
      loader.remove(); // R3: gone once incidents are on screen
    }
    setStatus(`updated ${new Date(page.updatedAt).toLocaleTimeString()}`);
  } catch (err) {
    console.error(err);
    if (!loaded) loader.textContent = 'Could not load incidents, retrying…';
    setStatus('offline, retrying');
  } finally {
    setTimeout(tick, REFRESH_MS);
  }
}

tick();
