import { spawn } from 'node:child_process';

const BIN = process.env.CHROME_BIN || 'google-chrome';
const PORT = 9333;
const APP = 'http://localhost:5173/';

const chrome = spawn(BIN, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--user-data-dir=/tmp/cdp-profile',
  '--window-size=390,844',
  'about:blank',
], { stdio: 'ignore' });

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
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

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
    consoleLines.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push(`[EXCEPTION] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description || ''}`);
  }
};

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: APP });
await sleep(3500);

console.log('== page loaded ==');
console.log(await evaluate(`({
  hasSpeech: 'speechSynthesis' in window,
  voices: speechSynthesis.getVoices().map(v => v.name + ' (' + v.lang + ')'),
  title: document.title,
  gpsBadge: [...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>t && t.includes('Local WebGPU')) || null
})`));

// 1. Generate a route (poll: app may still be hydrating)
let genBtn = false;
for (let i = 0; i < 20; i++) {
  genBtn = await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Synthesize Trail'))`);
  if (genBtn) break;
  await sleep(500);
}
console.log('generate button present:', genBtn);
if (!genBtn) {
  console.log('body text:', (await evaluate(`document.body.innerText`)).slice(0, 600));
  console.log('console:', consoleLines.slice(-20));
  chrome.kill();
  process.exit(1);
}
await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Synthesize Trail')).click()`);
console.log('clicked Synthesize Trail, waiting for briefing…');

let briefingReady = false;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  briefingReady = await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Listen'))`);
  if (briefingReady) break;
}
console.log('briefing ready:', briefingReady);
if (!briefingReady) {
  console.log('body text:', (await evaluate(`document.body.innerText`)).slice(0, 800));
  console.log('console:', consoleLines.slice(-15));
  chrome.kill();
  process.exit(1);
}

console.log('route stats:', await evaluate(`({
  stats: [...document.querySelectorAll('.grid-cols-4 > div')].map(d => d.innerText.replace('\\n','=')),
  briefingVisible: document.body.innerText.includes('Naturalist Trail Briefing')
})`));

// 2. Click Listen and sample speech state
await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Listen')).click()`);

for (let i = 0; i < 10; i++) {
  await sleep(1000);
  console.log(`t+${i + 1}s`, await evaluate(`({
    speaking: speechSynthesis.speaking,
    pending: speechSynthesis.pending,
    paused: speechSynthesis.paused,
    queued: speechSynthesis.speaking ? 'yes' : 'no',
    button: ([...document.querySelectorAll('button')].find(b => b.textContent.includes('Listen') || b.textContent.includes('Stop')) || {}).textContent,
    errorShown: (document.body.innerText.match(/No speech voices[^*]{0,120}|Speech unavailable[^*]{0,120}|Speech did not start[^*]{0,120}/) || [null])[0]
  })`));
}

console.log('== console output ==');
console.log(consoleLines.join('\n') || '(none)');

chrome.kill();
process.exit(0);
