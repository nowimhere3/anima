import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9568;
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'anima-package-a-'));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--allow-file-access-from-files', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  let tab;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' });
      tab = await r.json();
      break;
    } catch {
      await sleep(250);
    }
  }
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');

  async function evalInPage(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  }

  async function navigate() {
    const url = pathToFileURL(path.resolve('./anima-main/kaleidoscope-lab.html')).href + '?still=1';
    await send('Page.navigate', { url });
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      const ready = await evalInPage('typeof AnimaLab !== "undefined" && AnimaLab.ready && AnimaLab.ready()');
      if (ready) break;
    }
  }

  console.log('--- STARTING PACKAGE A UI VERIFICATION ---');
  let passCount = 0;
  function assert(desc, cond, detail = '') {
    if (cond) {
      console.log('PASS: ' + desc);
      passCount++;
    } else {
      console.error('FAIL: ' + desc + ' ' + detail);
      throw new Error('Assertion failed: ' + desc + ' ' + detail);
    }
  }

  await navigate();
  await evalInPage('AnimaLab.selectWorkspace("images")');

  // Verify initial dropdown
  let opts = await evalInPage('Array.from(document.getElementById("userPresetSelect").options).map(o => ({ value: o.value, text: o.text }))');
  assert('Initial dropdown has default option only', opts.length === 1 && opts[0].value === '');

  // Import an image
  await evalInPage(`(async () => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0055'; ctx.fillRect(10, 10, 100, 100);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    const f = new File([b], 'ruby.png', { type: 'image/png' });
    await AnimaLab.importFiles([f]);
  })()`);

  // Configure Preset Alpha settings via UI/scene
  await evalInPage(`(() => {
    AnimaLab.scene.folds = 12;
    AnimaLab.scene.motionMultiplier = 3.5;
    AnimaLab.scene.layers[0].spec.speed = 2.0;
    AnimaLab.scene.layers[0].spec.light = { mode: 'backlight', strength: 0.9 };
    AnimaLab.syncSceneControls();
    AnimaLab.syncAll();
  })()`);

  // 1. Save Preset Alpha via actual UI button click
  await evalInPage(`(() => {
    window.prompt = () => 'Preset Alpha';
    document.getElementById('savePresetBtn').click();
  })()`);
  await sleep(400);

  let statusText = await evalInPage('document.getElementById("presetStatus").textContent');
  assert('Status reports preset Alpha saved', statusText.includes('Saved preset "Preset Alpha"'), statusText);

  opts = await evalInPage('Array.from(document.getElementById("userPresetSelect").options).map(o => ({ value: o.value, text: o.text, selected: o.selected }))');
  assert('Preset Alpha appears in dropdown and is selected', opts.length === 2 && opts[1].text.includes('Preset Alpha') && opts[1].selected === true);
  const alphaId = opts[1].value;

  // 2. Configure Preset Beta settings and click Save Preset
  await evalInPage(`(() => {
    AnimaLab.scene.folds = 6;
    AnimaLab.scene.motionMultiplier = 1.5;
    AnimaLab.scene.layers[0].spec.speed = 0.5;
    AnimaLab.scene.layers[0].spec.light = { mode: 'direct', strength: 0 };
    AnimaLab.syncSceneControls();
    AnimaLab.syncAll();
    window.prompt = () => 'Preset Beta';
    document.getElementById('savePresetBtn').click();
  })()`);
  await sleep(400);

  statusText = await evalInPage('document.getElementById("presetStatus").textContent');
  assert('Status reports preset Beta saved', statusText.includes('Saved preset "Preset Beta"'), statusText);

  opts = await evalInPage('Array.from(document.getElementById("userPresetSelect").options).map(o => ({ value: o.value, text: o.text, selected: o.selected }))');
  assert('BOTH presets appear in dropdown', opts.length === 3 && opts.some(o => o.text.includes('Preset Alpha')) && opts.some(o => o.text.includes('Preset Beta')));
  const betaId = opts.find(o => o.text.includes('Preset Beta')).value;

  // 3. Reload the page (clean browser reload in isolated profile)
  await navigate();
  await evalInPage('AnimaLab.selectWorkspace("images")');
  await sleep(400);

  opts = await evalInPage('Array.from(document.getElementById("userPresetSelect").options).map(o => ({ value: o.value, text: o.text }))');
  assert('Both presets remain selectable after reload', opts.length === 3 && opts.some(o => o.text.includes('Preset Alpha')) && opts.some(o => o.text.includes('Preset Beta')));

  // 4. Load Preset Alpha via UI interaction
  await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    sel.value = "${alphaId}";
    sel.dispatchEvent(new Event('change'));
    document.getElementById('loadPresetBtn').click();
  })()`);
  await sleep(500);

  let alphaRestored = await evalInPage(`(() => {
    const s = AnimaLab.scene;
    return {
      folds: s.folds,
      motionMul: s.motionMultiplier,
      speed: s.layers[0]?.spec?.speed,
      lightMode: s.layers[0]?.spec?.light?.mode
    };
  })()`);
  assert('Preset Alpha loaded via UI: folds=12, speed=2, backlight', alphaRestored.folds === 12 && alphaRestored.speed === 2 && alphaRestored.lightMode === 'backlight', JSON.stringify(alphaRestored));

  // 5. Load Preset Beta via UI interaction
  await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    sel.value = "${betaId}";
    sel.dispatchEvent(new Event('change'));
    document.getElementById('loadPresetBtn').click();
  })()`);
  await sleep(500);

  let betaRestored = await evalInPage(`(() => {
    const s = AnimaLab.scene;
    return {
      folds: s.folds,
      motionMul: s.motionMultiplier,
      speed: s.layers[0]?.spec?.speed,
      lightMode: s.layers[0]?.spec?.light?.mode
    };
  })()`);
  assert('Preset Beta loaded via UI: folds=6, speed=0.5, direct', betaRestored.folds === 6 && betaRestored.speed === 0.5 && betaRestored.lightMode === 'direct', JSON.stringify(betaRestored));

  // 6. Update Preset Beta via UI button
  await evalInPage(`(async () => {
    AnimaLab.scene.folds = 18;
    AnimaLab.syncSceneControls();
    window.confirm = () => true;
    document.getElementById('updatePresetBtn').click();
  })()`);
  await sleep(400);

  let updatedCheck = await evalInPage(`(async () => {
    const p = await ImagePresets.getPreset("${betaId}");
    return p.scene.folds;
  })()`);
  assert('Update preset updated settings to folds=18', updatedCheck === 18, `folds=${updatedCheck}`);

  // 7. Rename Preset Alpha via UI button
  await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    sel.value = "${alphaId}";
    sel.dispatchEvent(new Event('change'));
    window.prompt = () => 'Renamed Alpha';
    document.getElementById('renamePresetBtn').click();
  })()`);
  await sleep(400);

  opts = await evalInPage('Array.from(document.getElementById("userPresetSelect").options).map(o => ({ value: o.value, text: o.text }))');
  assert('Rename preset refreshed dropdown option text', opts.some(o => o.text.includes('Renamed Alpha')), JSON.stringify(opts));

  // 8. Delete Preset Alpha via UI button and confirm Beta survives
  await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    sel.value = "${alphaId}";
    sel.dispatchEvent(new Event('change'));
    window.confirm = () => true;
    document.getElementById('deletePresetBtn').click();
  })()`);
  await sleep(400);

  opts = await evalInPage('Array.from(document.getElementById("userPresetSelect").options).map(o => ({ value: o.value, text: o.text }))');
  assert('Delete removed Alpha while Beta survived in dropdown', !opts.some(o => o.text.includes('Renamed Alpha')) && opts.some(o => o.text.includes('Preset Beta')), JSON.stringify(opts));

  // 9. Confirm referenced image asset remains intact in IndexedDB
  const assetsCount = await evalInPage(`(async () => {
    const db = await ImagePresets.openDB();
    return new Promise(res => {
      const tx = db.transaction('assets', 'readonly');
      const req = tx.objectStore('assets').count();
      req.onsuccess = () => res(req.result);
    });
  })()`);
  assert('Shared image asset remains intact in assets store', assetsCount >= 1, `count=${assetsCount}`);

  console.log(`========================================\nPACKAGE A PASSED: ${passCount} / ${passCount} UI TESTS OK\n========================================`);

  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}

run().catch(e => {
  console.error('PACKAGE A ERROR:', e);
  try { chrome.kill(); } catch (_) {}
  process.exit(1);
});
