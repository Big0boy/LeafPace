/**
 * Loads the running LeafPace dev server and exercises each external
 * geospatial endpoint from inside the page, printing HTTP status or the
 * browser-level error. Useful for telling "endpoint down" apart from
 * "browser blocked by CORS/network".
 *
 * Usage: CHROME_BIN=/usr/bin/chromium node scripts/netcheck.mjs
 */
import { spawn } from 'node:child_process';

const BIN = process.env.CHROME_BIN || 'google-chrome';
const PORT = 9334;
const APP = process.env.APP_URL || 'http://localhost:5173/';

const chrome = spawn(
  BIN,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--user-data-dir=/tmp/leafpace-netcheck-profile',
    '--window-size=390,844',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP target not found');
}

const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
const netEvents = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Network.responseReceived') {
    const { response } = msg.params;
    if (/routing\.openstreetmap\.de|project-osrm/.test(response.url)) {
      netEvents.push({
        kind: 'response',
        url: response.url,
        status: response.status,
        headers: response.headers,
      });
    }
  }
  if (msg.method === 'Network.loadingFailed') {
    netEvents.push({ kind: 'failed', ...msg.params });
  }
  if (msg.method === 'Network.requestWillBeSent') {
    const { request } = msg.params;
    if (/routing\.openstreetmap\.de/.test(request.url)) {
      netEvents.push({ kind: 'request', url: request.url, headers: request.headers });
    }
  }
};

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    throw new Error(
      r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')
    );
  return r.result.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Page.navigate', { url: APP });
await sleep(3000);

const probes = await evaluate(`(async () => {
  const out = {};
  const probe = async (name, fn, ms = 15000) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    const t0 = performance.now();
    try {
      const res = await fn(ctl.signal);
      out[name] = { status: res.status, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      out[name] = { error: String(e), ms: Math.round(performance.now() - t0) };
    }
    clearTimeout(timer);
  };

  const query = '[out:json][timeout:10];(nwr["leisure"="park"](around:1500,37.7694,-122.4862););out center 5;';
  await probe('overpass-api.de', (signal) =>
    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
    }));
  await probe('mail.ru overpass', (signal) =>
    fetch('https://maps.mail.ru/osm/tools/overpass/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
    }));
  await probe('osrm routed-foot', (signal) =>
    fetch('https://routing.openstreetmap.de/route/v1/foot/-122.490000,37.760000;-122.480000,37.770000?overview=false', { signal }));
  await probe('osm tiles', (signal) =>
    fetch('https://tile.openstreetmap.org/12/655/1583.png', { signal }));
  await probe('osrm root (no-cors)', (signal) =>
    fetch('https://routing.openstreetmap.de/', { mode: 'no-cors', signal }));
  await probe('osrm foot (no-cors)', (signal) =>
    fetch('https://routing.openstreetmap.de/route/v1/foot/-122.490000,37.760000;-122.480000,37.770000?overview=false', { mode: 'no-cors', signal }));
  await probe('osrm foot (cors, cache-bust)', (signal) =>
    fetch('https://routing.openstreetmap.de/route/v1/foot/-122.490000,37.760000;-122.480000,37.770000?overview=false&x=' + Date.now(), { signal }));
  await probe('project-osrm driving', (signal) =>
    fetch('https://router.project-osrm.org/route/v1/driving/-122.490000,37.760000;-122.480000,37.770000?overview=false', { signal }));
  return out;
})()`);

console.log(JSON.stringify(probes, null, 2));
console.log('\n== network events ==');
console.log(JSON.stringify(netEvents, null, 2));
chrome.kill();
process.exit(0);
