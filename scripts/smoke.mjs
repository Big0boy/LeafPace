/**
 * LeafPace end-to-end smoke check.
 *
 * Drives the running dev server (default http://localhost:5173) in headless
 * Chromium over CDP:
 *   1. loads the app and records console errors/exceptions
 *   2. clicks "Synthesize Trail" and waits for the AI briefing
 *   3. captures route stats
 *   4. opens the hand-off modal and downloads the .gpx, validating its XML
 *   5. samples speech synthesis state after clicking "Listen"
 *
 * Usage:  CHROME_BIN=/usr/bin/chromium node scripts/smoke.mjs
 * Exits non-zero when a step fails.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BIN = process.env.CHROME_BIN || 'google-chrome';
const PORT = 9333;
const APP = process.env.APP_URL || 'http://localhost:5173/';
const DOWNLOAD_DIR = '/tmp/leafpace-downloads';

rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
mkdirSync(DOWNLOAD_DIR, { recursive: true });

const chrome = spawn(
  BIN,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--user-data-dir=/tmp/leafpace-cdp-profile',
    '--window-size=390,844',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`✗ ${msg}`);
};
const ok = (msg) => console.log(`✓ ${msg}`);

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
const consoleLines = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const line =
      `[${msg.params.type}] ` +
      msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    consoleLines.push(line);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push(
      `[EXCEPTION] ${msg.params.exceptionDetails.text} ` +
        (msg.params.exceptionDetails.exception?.description || '')
    );
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

const waitFor = async (expression, tries = 30, delayMs = 1000) => {
  for (let i = 0; i < tries; i++) {
    try {
      if (await evaluate(expression)) return true;
    } catch {}
    await sleep(delayMs);
  }
  return false;
};

await send('Runtime.enable');
await send('Page.enable');
try {
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
} catch {}

// ── GPS: fake a position; permission is granted after the app loads ──────
// Headless Chromium auto-denies geolocation, which previously hid the whole
// GPS code path behind the "permission denied" fallback.  Grants issued while
// the page is still about:blank do not reliably stick after navigation, so
// Browser.grantPermissions is called later, once the app origin is live.
// Deliberately far from the app's default location (Golden Gate Park) so
// "GPS locked" also proves the marker moved and the map re-centred on it.
await send('Emulation.setGeolocationOverride', {
  latitude: 37.7765,
  longitude: -122.4385,
  accuracy: 25,
});

await send('Page.navigate', { url: APP });
await sleep(3500);

// ── 1. Page load ────────────────────────────────────────────────────────
const shell = await evaluate(`({
  title: document.title,
  hasRoot: !!document.querySelector('#root > div'),
  header: (document.querySelector('h1') || {}).textContent || null,
  webgpuBadge: [...document.querySelectorAll('span')].map(s => s.textContent)
    .find(t => t && (t.includes('Local WebGPU') || t.includes('WebGPU Active'))) || null
})`);
console.log('shell:', JSON.stringify(shell));
shell.hasRoot ? ok('app shell rendered') : fail('app shell did not render');
shell.header?.includes('LeafPace') ? ok('header renders LeafPace') : fail('header missing');

// Map tiles must render from the keyless OSM server (CARTO now returns a
// static "API key required" placeholder image for every tile).
const tilesOk = await waitFor(
  `[...document.querySelectorAll('img.leaflet-tile')]
      .filter(i => i.src.includes('tile.openstreetmap.org') && i.complete && i.naturalWidth > 0)
      .length >= 3`,
  20,
  500
);
if (tilesOk) {
  ok('map tiles loaded from tile.openstreetmap.org');
} else {
  const tileInfo = await evaluate(`[...document.querySelectorAll('img.leaflet-tile')]
    .slice(0, 5).map(i => ({ src: i.src, w: i.naturalWidth }))`);
  console.log('tiles:', JSON.stringify(tileInfo));
  fail('map tiles did not load from tile.openstreetmap.org');
}

// ── GPS: grant permission (app origin is live now), then tap "My GPS" ────
// The app auto-attempts geolocation on mount, which lands before any grant
// and is auto-denied by headless Chromium; those mount-time warnings are
// expected and excluded by slicing the console log from this point on.
let geoGranted = false;
try {
  const ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
  const bws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    bws.onopen = res;
    bws.onerror = rej;
  });
  let bid = 0;
  const bsend = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++bid;
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === mid) {
          bws.removeEventListener('message', onMsg);
          m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
        }
      };
      bws.addEventListener('message', onMsg);
      bws.send(JSON.stringify({ id: mid, method, params }));
    });
  await bsend('Browser.grantPermissions', {
    permissions: ['geolocation'],
    origin: new URL(APP).origin,
    setting: 'granted',
  });
  geoGranted = true;
  // Intentionally keep the browser websocket open: closing it immediately
  // after the grant can race the permission commit.
} catch (err) {
  console.log('geolocation grant failed:', err.message);
}

const geoLogStart = consoleLines.length;
const gpsBtn = await evaluate(
  `!![...document.querySelectorAll('button')].find(b => b.textContent.includes('My GPS'))`
);
if (gpsBtn) {
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('My GPS')).click()`
  );
} else {
  fail('My GPS button not found');
}
const gpsLocked = await waitFor(
  `document.body.innerText.includes('GPS locked')`,
  12,
  500
);
const geoWarnings = consoleLines.slice(geoLogStart).filter((l) =>
  l.includes('Geolocation lookup notice')
);
if (!geoGranted) {
  fail('could not grant geolocation permission via CDP (Browser.grantPermissions)');
} else if (gpsLocked && geoWarnings.length === 0) {
  ok('GPS locked via the My GPS button (permission granted, position applied)');
} else {
  geoWarnings.forEach((l) => console.log(l));
  fail(gpsLocked ? 'geolocation warnings after grant' : 'GPS never locked – location banner missing');
}

// The map must re-centre on the locked start point (fake coords differ from
// the app default, so an un-recentred map would leave the marker off-centre).
const markerCentered = await waitFor(
  `(() => {
    const m = document.querySelector('.user-marker');
    const c = document.querySelector('.leaflet-container');
    if (!m || !c) return false;
    const mr = m.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    const dx = (mr.left + mr.width / 2) - (cr.left + cr.width / 2);
    const dy = (mr.top + mr.height / 2) - (cr.top + cr.height / 2);
    return Math.hypot(dx, dy) < 60;
  })()`,
  10,
  500
);
markerCentered
  ? ok('map re-centred on the locked start point')
  : fail('start point is not centred on the map');

// ── 2. Generate a route ─────────────────────────────────────────────────
const genBtn = await waitFor(
  `!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Synthesize Trail'))`,
  20,
  500
);
if (!genBtn) {
  fail('Synthesize Trail button not found');
  console.log('body:', (await evaluate(`document.body.innerText`)).slice(0, 600));
  console.log('console:', consoleLines.slice(-20));
  chrome.kill();
  process.exit(1);
}
ok('Synthesize Trail button present');

await evaluate(
  `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Synthesize Trail')).click()`
);
console.log('clicked Synthesize Trail…');

const briefingReady = await waitFor(
  `!!document.body.innerText.match(/Naturalist Trail Briefing/)`,
  60,
  1000
);
briefingReady ? ok('trail briefing rendered') : fail('trail briefing never rendered');

// ── 3. Route stats ──────────────────────────────────────────────────────
const stats = await evaluate(`({
  stats: [...document.querySelectorAll('.grid-cols-4 > div')].map(d =>
    d.innerText.replace(/\\n/g, ' = ')),
  greenSpaces: (document.body.innerText.match(/Green Spaces[^\\n]*/i) || [null])[0]
})`);
console.log('route stats:', JSON.stringify(stats));
if (stats.stats.length === 4) {
  const distance = (stats.stats.find((s) => /km|m\b/i.test(s)) || '').replace(/[^\d.,]/g, '');
  if (distance && parseFloat(distance.replace(',', '.')) > 0) ok('distance stat populated');
  else fail('distance stat empty: ' + JSON.stringify(stats.stats));
} else {
  fail('expected 4 route stat tiles, got ' + stats.stats.length);
}

// ── 4. Text-to-speech briefing ─────────────────────────────────────────
const listenBtn = await waitFor(
  `!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Listen'))`,
  20,
  500
);
if (!listenBtn) {
  fail('Listen (TTS) button not found');
} else {
  const voices = await evaluate(`speechSynthesis.getVoices().length`);
  console.log(`speech voices available: ${voices}`);
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Listen')).click()`
  );
  await sleep(2500);
  const tts = await evaluate(`({
    speaking: speechSynthesis.speaking,
    pending: speechSynthesis.pending,
    button: ([...document.querySelectorAll('button')]
      .find(b => /Listen|Stop/.test(b.textContent)) || {}).textContent || null,
    errorShown: (document.body.innerText.match(
      /No speech voices[^*]{0,120}|Speech unavailable[^*]{0,120}|Speech did not start[^*]{0,120}/) || [null])[0]
  })`);
  console.log('tts state:', JSON.stringify(tts));
  if (voices === 0) {
    // Headless CI boxes usually have no speech-dispatcher/espeak installed.
    // The app must surface a clear explanation rather than hang on "Stop".
    tts.errorShown
      ? ok('no TTS voices on host – app degrades with a clear message (env limitation)')
      : fail('no voices and no user-facing explanation – Listen button would hang');
  } else {
    tts.errorShown
      ? fail('TTS error surfaced: ' + tts.errorShown.trim())
      : tts.speaking || tts.pending || tts.button?.includes('Stop')
        ? ok('TTS started speaking')
        : fail('TTS did not start (no voices / silent ignore)');
  }
  // Stop playback so it cannot leak into the export step
  await evaluate(`speechSynthesis.cancel()`);
  await sleep(300);
}

// ── 5. GPX hand-off export ──────────────────────────────────────────────
const opened = await waitFor(
  `!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Touch Grass'))`,
  15,
  500
);
if (!opened) {
  fail('no hand-off / Touch Grass button found');
} else {
  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Touch Grass')).click()`
  );
  const modalUp = await waitFor(`document.body.innerText.includes('Trail Handoff')`, 10, 500);
  modalUp ? ok('hand-off modal opened') : fail('hand-off modal did not open');

  if (modalUp) {
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Download .GPX')).click()`
    );
    let file = null;
    for (let i = 0; i < 20 && !file; i++) {
      await sleep(300);
      const files = readdirSync(DOWNLOAD_DIR).filter((f) => f.endsWith('.gpx'));
      if (files.length) file = join(DOWNLOAD_DIR, files[0]);
    }
    if (!file) {
      fail('no .gpx file downloaded');
    } else {
      const xml = readFileSync(file, 'utf8');
      const checks = {
        gpxRoot: /<gpx[^>]*version="1\.1"/.test(xml),
        track: /<trk>/.test(xml),
        trackpoints: (xml.match(/<trkpt /g) || []).length,
        closesLoop: (() => {
          const pts = [...xml.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)];
          if (pts.length < 2) return false;
          const a = pts[0].slice(1);
          const b = pts[pts.length - 1].slice(1);
          return Math.abs(+a[0] - +b[0]) < 1e-4 && Math.abs(+a[1] - +b[1]) < 1e-4;
        })(),
      };
      console.log('gpx checks:', JSON.stringify(checks));
      checks.gpxRoot ? ok('GPX 1.1 root element') : fail('missing GPX 1.1 root');
      checks.track ? ok('<trk> present') : fail('missing <trk>');
      checks.trackpoints >= 10
        ? ok(`${checks.trackpoints} trackpoints`)
        : fail('too few trackpoints: ' + checks.trackpoints);
      checks.closesLoop
        ? ok('loop closes at start point')
        : fail('GPX loop does not close');
    }

    // Screen-dim hand-off
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => /Dim Screen/.test(b.textContent))?.click()`
    );
    await sleep(600);
    const dimmed = await evaluate(`document.body.innerText.includes('Screen in Pocket')`);
    dimmed ? ok('screen-dim "Touch Grass" state works') : fail('screen-dim state missing');
    await evaluate(`document.elementFromPoint(195, 400)?.click()`);
    await sleep(300);
  }
}

console.log('== console output ==');
// Verify the two open-geospatial integrations actually responded
const overpassOk = consoleLines.some((l) =>
  l.includes('green-space lookup succeeded')
);
const routed = consoleLines.some(
  (l) => l.includes('OSRM foot route via') || l.includes('Valhalla pedestrian route')
);
overpassOk ? ok('real OSM green spaces returned (Overpass or Nominatim)') : fail('all green-space lookups fell back to synthetic parks');
routed ? ok('foot routing produced a real path') : fail('no foot-routing engine responded');
const errors = consoleLines.filter((l) => l.startsWith('[error]') || l.startsWith('[EXCEPTION]'));
console.log(consoleLines.join('\n') || '(none)');
if (errors.length) fail(`${errors.length} console error(s)/exception(s)`);
else ok('no console errors or exceptions');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll smoke checks passed');
chrome.kill();
process.exit(failures ? 1 : 0);
