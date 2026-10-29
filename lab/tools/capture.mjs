// Verification harness (Node built-ins only; drives the installed Chrome over CDP).
// Usage: node lab/tools/capture.mjs jobs.json
// jobs.json: [{ "name":"x", "url":"kaleidoscope-lab.html?preset=lotus&ui=0&still=1", "w":1920,"h":1080,"dpr":1,
//               "eval":"optional JS run after ready", "wait":300 }]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..', '..');
const outDir = path.join(site, 'lab', 'captures');
fs.mkdirSync(outDir, { recursive: true });
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const chromePath = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'anima-cap-'));
const gpuArgs = process.env.USE_GPU ? [] : ['--disable-gpu'];
const chrome = spawn(chromePath, ['--headless=new', ...gpuArgs, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }); return await r.json(); } catch { await sleep(250); }
  }
  throw new Error('chrome not reachable');
}
const tab = await connect();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description).join(' '));
  else if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');

const results = [];
for (const j of jobs) {
  const w = j.w || 1920, h = j.h || 1080;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: j.dpr || 1, mobile: false });
  logs.length = 0;
  const url = j.url.startsWith('http') || j.url.startsWith('file') ? j.url : pathToFileURL(path.join(site, j.url.split('?')[0])).href + (j.url.includes('?') ? '?' + j.url.split('?')[1] : '');
  await send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    await sleep(150);
    const r = await send('Runtime.evaluate', { expression: 'window.AnimaLab ? AnimaLab.ready() : (window.__verifyDone === true)', returnByValue: true });
    ready = r.result?.result?.value === true;
  }
  let value = null;
  if (j.eval) {
    const r = await send('Runtime.evaluate', { expression: j.eval, awaitPromise: true, returnByValue: true, timeout: j.timeout || 600000 });
    value = r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? null;
  }
  if (j.wait) await sleep(j.wait);
  if (j.shot !== false && j.name) {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(j.clip ? { clip: { ...j.clip, scale: j.clip.scale || 1 } } : {}) });
    fs.writeFileSync(path.join(outDir, j.name + '.png'), Buffer.from(r.result.data, 'base64'));
  }
  results.push({ name: j.name, ready, value, logs: logs.slice() });
  console.log(JSON.stringify({ name: j.name, ready, value, logs: logs.slice(0, 8) }));
}
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
