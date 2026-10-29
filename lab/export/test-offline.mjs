// Node built-ins only. Runs the browser harness in a fresh Chrome profile.
// node anima-main/lab/export/test-offline.mjs [--software] [--regressions]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), site = path.resolve(here, '../..');
const software = process.argv.includes('--software'), mode = software ? 'software' : 'gpu';
const output = path.join(here, 'test-artifacts'); fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-offline-'));
const port = 9700 + Math.floor(Math.random() * 300);
const chrome = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', ...(software ? ['--disable-gpu'] : ['--enable-gpu']),
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check', 'about:blank'
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sockets = [];
async function connection(url) {
    const ws = new WebSocket(url); sockets.push(ws);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const requests = new Map();
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (requests.has(m.id)) { requests.get(m.id)(m); requests.delete(m.id); } });
    return (method, params = {}) => new Promise((resolve, reject) => {
        const i = ++id;
        requests.set(i, r => r.error ? reject(new Error(JSON.stringify(r.error))) : resolve(r.result));
        ws.send(JSON.stringify({ id: i, method, params }));
    });
}
let failed = false;
try {
    let version;
    for (let i = 0; i < 80; i++) { try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(150); } }
    if (!version) throw new Error('Chrome startup timeout');
    const browser = await connection(version.webSocketDebuggerUrl);
    const system = await browser('SystemInfo.getInfo');
    fs.writeFileSync(path.join(output, mode + '-system.json'), JSON.stringify({ browser: version.Browser, ...system }, null, 2));
    console.log('GPU:', JSON.stringify({ mode, devices: system.gpu.devices, features: system.gpu.featureStatus, renderer: system.gpu.auxAttributes?.glRenderer }));
    const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const send = await connection(tab.webSocketDebuggerUrl);
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    const evaluate = async expression => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 900000 });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
    };
    await send('Page.navigate', { url: pathToFileURL(path.join(here, 'verify.html')).href });
    let result;
    for (let i = 0; i < 1800; i++) {
        await sleep(500); result = await evaluate('window.__offlineResults');
        if (result?.done) break;
    }
    if (!result?.done) throw new Error('Offline tests exceeded 15 minutes');
    fs.writeFileSync(path.join(output, mode + '-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    const names = await evaluate('Object.keys(window.__offlineCaptures || {})');
    if (!software) for (const name of names) {
        const url = await evaluate('window.__offlineCaptures[' + JSON.stringify(name) + ']');
        fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    }
    failed = !result.pass;
    if (process.argv.includes('--regressions')) {
        const logs = [];
        for (const name of ['test-create-first-fuse-second.mjs', 'test-fusion-e2e.mjs']) {
            // Redirect old test screenshots to this run's artifacts; originals stay untouched.
            const original = fs.readFileSync(path.join(site, 'lab/tools', name), 'utf8');
            const redirected = original.replace("path.resolve('./anima-main/lab/captures')", JSON.stringify(output));
            const tempScript = path.join(output, name); fs.writeFileSync(tempScript, redirected);
            const text = await new Promise((resolve, reject) => {
                const child = spawn(process.execPath, [tempScript], { cwd: path.resolve(site, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
                let str = ''; child.stdout.on('data', c => { str += c; }); child.stderr.on('data', c => { str += c; });
                child.on('error', reject); child.on('close', code => resolve({ code, text: str }));
            });
            fs.writeFileSync(path.join(output, name + '.txt'), text.text);
            logs.push({ name, code: text.code, pass: text.code === 0 && /ALL TESTS PASSED: true|ANIMA FUSION E2E ASSERTIONS PASSED/.test(text.text) });
            fs.unlinkSync(tempScript);
        }
        // Existing lab and standalone sandbox smoke tests in the same isolated profile.
        for (const [name, url, expr] of [
            ['lab', 'lab/verify.html', 'window.__verifyDone ? window.__results : null'],
            ['sandbox', 'sandbox/verify.html', "document.getElementById('results')?.textContent?.includes('ALL PASSED') ? document.getElementById('results').textContent : null"]
        ]) {
            await send('Page.navigate', { url: pathToFileURL(path.join(site, url)).href });
            let value;
            for (let i = 0; i < 300; i++) { await sleep(100); value = await evaluate(expr); if (value) break; }
            const pass = name === 'lab' ? Array.isArray(value) && value.length > 0 && value.every(x => x.ok ?? x.pass) : typeof value === 'string' && value.includes('ALL PASSED');
            logs.push({ name, pass, value });
        }
        fs.writeFileSync(path.join(output, 'regressions.json'), JSON.stringify(logs, null, 2));
        console.log('REGRESSIONS', JSON.stringify(logs)); failed ||= logs.some(x => !x.pass);
    }
} catch (error) { failed = true; console.error(error); }
finally {
    for (const ws of sockets) ws.close(); chrome.kill();
    await sleep(800);
    // Target is the exact mkdtemp-created disposable profile, never the user's profile.
    if (path.basename(profile).startsWith('anima-offline-') && path.dirname(profile) === os.tmpdir()) {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still be closing. */ }
    }
}
process.exitCode = failed ? 1 : 0;
