import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9569;
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'anima-package-b-'));
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

  console.log('--- STARTING PACKAGE B SAVED IMAGES VERIFICATION ---');
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
  await sleep(400);

  // 1. Verify Graphene bundled image is automatically in the Saved Images dropdown
  let imgOpts = await evalInPage('Array.from(document.getElementById("savedImageSelect").options).map(o => ({ value: o.value, text: o.text, bundled: o.dataset.bundled }))');
  assert('Graphene Lattice is automatically present in Saved Images dropdown', imgOpts.some(o => o.text.includes('Graphene Lattice') && o.bundled === '1'), JSON.stringify(imgOpts));

  // 2. Select Graphene and click Add as Layer
  const grapheneVal = imgOpts.find(o => o.text.includes('Graphene Lattice')).value;
  await evalInPage(`(async () => {
    const sel = document.getElementById('savedImageSelect');
    sel.value = "${grapheneVal}";
    sel.dispatchEvent(new Event('change'));
    document.getElementById('addImageAsLayerBtn').click();
  })()`);
  await sleep(500);

  let layerCount = await evalInPage('AnimaLab.scene.layers.length');
  assert('Graphene added as layer without manual upload', layerCount === 1, `layerCount=${layerCount}`);

  // 3. Verify Canvas is NOT tainted (getImageData and screenshot work)
  const taintTest = await evalInPage(`(async () => {
    AnimaLab.renderNow();
    const c = document.getElementById('labCanvas');
    const ctx = c.getContext('2d');
    let getPixelsOk = false, toBlobOk = false;
    try {
      ctx.getImageData(0, 0, 10, 10);
      getPixelsOk = true;
    } catch (e) {
      getPixelsOk = false;
    }
    try {
      const b = await new Promise(r => c.toBlob(r, 'image/png'));
      toBlobOk = !!(b && b.size > 0);
    } catch (e) {
      toBlobOk = false;
    }
    return { getPixelsOk, toBlobOk };
  })()`);
  assert('Canvas is untainted: getImageData and toBlob screenshot succeed', taintTest.getPixelsOk && taintTest.toBlobOk, JSON.stringify(taintTest));

  // 4. Upload a custom user image and save it to library via UI ★ Save button
  await evalInPage(`(async () => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#00ffaa'; ctx.fillRect(20, 20, 120, 120);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    const f = new File([b], 'emerald-crystal.png', { type: 'image/png' });
    await AnimaLab.importFiles([f]);
  })()`);
  await sleep(300);

  // Click Save to Library on the uploaded asset
  await evalInPage(`(async () => {
    const aRows = document.querySelectorAll('#assetList .arow');
    const lastRow = aRows[aRows.length - 1];
    const saveBtn = lastRow.querySelector('button[title="Save image to library"]');
    window.prompt = () => 'Emerald Crystal';
    saveBtn.click();
  })()`);
  await sleep(400);

  imgOpts = await evalInPage('Array.from(document.getElementById("savedImageSelect").options).map(o => ({ value: o.value, text: o.text }))');
  assert('Uploaded image saved to library and appears in dropdown', imgOpts.some(o => o.text.includes('Emerald Crystal')), JSON.stringify(imgOpts));
  const emeraldVal = imgOpts.find(o => o.text.includes('Emerald Crystal')).value;

  // 5. Add Emerald Crystal as Layer 2
  await evalInPage(`(async () => {
    const sel = document.getElementById('savedImageSelect');
    sel.value = "${emeraldVal}";
    sel.dispatchEvent(new Event('change'));
    document.getElementById('addImageAsLayerBtn').click();
  })()`);
  await sleep(400);

  layerCount = await evalInPage('AnimaLab.scene.layers.length');
  assert('Two layers present: Layer 1 (Graphene), Layer 2 (Emerald)', layerCount === 2, `count=${layerCount}`);

  // 6. Save a Preset referencing both images
  await evalInPage(`(() => {
    window.prompt = () => 'Graphene & Emerald Composition';
    document.getElementById('savePresetBtn').click();
  })()`);
  await sleep(400);

  let presetOpts = await evalInPage('Array.from(document.getElementById("userPresetSelect").options).map(o => ({ value: o.value, text: o.text }))');
  assert('Saved Preset referencing both images created', presetOpts.some(o => o.text.includes('Graphene & Emerald Composition')), JSON.stringify(presetOpts));
  const compositionPresetId = presetOpts.find(o => o.text.includes('Graphene & Emerald Composition')).value;

  // 7. Reload page (clean browser reload in isolated profile)
  await navigate();
  await evalInPage('AnimaLab.selectWorkspace("images")');
  await sleep(400);

  // Verify both Graphene and Emerald survive in Saved Images dropdown after reload
  imgOpts = await evalInPage('Array.from(document.getElementById("savedImageSelect").options).map(o => ({ value: o.value, text: o.text }))');
  assert('Both Graphene and Emerald survive reload in Saved Images dropdown', imgOpts.some(o => o.text.includes('Graphene Lattice')) && imgOpts.some(o => o.text.includes('Emerald Crystal')));

  // 8. Load the saved preset
  await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    sel.value = "${compositionPresetId}";
    sel.dispatchEvent(new Event('change'));
    document.getElementById('loadPresetBtn').click();
  })()`);
  await sleep(500);

  layerCount = await evalInPage('AnimaLab.scene.layers.length');
  assert('Preset restored both layers successfully after reload', layerCount === 2, `count=${layerCount}`);

  // 9. Retention Rule 1: Delete the preset -> verify Emerald Crystal STILL SURVIVES in Saved Images Library
  await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    sel.value = "${compositionPresetId}";
    sel.dispatchEvent(new Event('change'));
    window.confirm = () => true;
    document.getElementById('deletePresetBtn').click();
  })()`);
  await sleep(400);

  imgOpts = await evalInPage('Array.from(document.getElementById("savedImageSelect").options).map(o => ({ value: o.value, text: o.text }))');
  assert('Retention Rule 1: Deleting preset did NOT delete library image Emerald Crystal', imgOpts.some(o => o.text.includes('Emerald Crystal')), JSON.stringify(imgOpts));

  // 10. Re-save a preset with Emerald Crystal to test Retention Rule 2
  await evalInPage(`(() => {
    window.prompt = () => 'Emerald Preset 2';
    document.getElementById('savePresetBtn').click();
  })()`);
  await sleep(400);
  presetOpts = await evalInPage('Array.from(document.getElementById("userPresetSelect").options).map(o => ({ value: o.value, text: o.text }))');
  const emeraldPreset2Id = presetOpts.find(o => o.text.includes('Emerald Preset 2')).value;

  // 11. Retention Rule 2: Remove Emerald Crystal from library -> unmarks savedInLibrary but preserves asset for preset!
  await evalInPage(`(async () => {
    const sel = document.getElementById('savedImageSelect');
    sel.value = "${emeraldVal}";
    sel.dispatchEvent(new Event('change'));
    window.confirm = () => true;
    document.getElementById('removeSavedImageBtn').click();
  })()`);
  await sleep(400);

  imgOpts = await evalInPage('Array.from(document.getElementById("savedImageSelect").options).map(o => ({ value: o.value, text: o.text }))');
  assert('Emerald removed from library dropdown', !imgOpts.some(o => o.text.includes('Emerald Crystal')));

  // Now reload preset 2: verify it still loads because asset was preserved in assets store!
  await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    sel.value = "${emeraldPreset2Id}";
    sel.dispatchEvent(new Event('change'));
    document.getElementById('loadPresetBtn').click();
  })()`);
  await sleep(500);

  layerCount = await evalInPage('AnimaLab.scene.layers.length');
  assert('Retention Rule 2: Preset still restores layer even after library removal', layerCount >= 1, `count=${layerCount}`);

  // 12. Export Backup & Import Backup Verification
  const exported = await evalInPage(`(async () => {
    return await ImagePresets.exportBackup();
  })()`);
  assert('Export backup produces valid JSON payload with presets and assets', exported.presetsCount >= 1 && exported.assetsCount >= 1 && exported.assets[0].dataUrl.startsWith('data:'));

  // Clean the database simulation and import the backup
  const importResult = await evalInPage(`(async () => {
    // Delete preset
    await ImagePresets.deletePreset("${emeraldPreset2Id}");
    // Import backup
    const res = await ImagePresets.importBackup(${JSON.stringify(exported)});
    await AnimaLab.refreshUserPresetsDropdown();
    await AnimaLab.refreshSavedImagesDropdown();
    return res;
  })()`);
  assert('Import backup successfully restored presets and assets', importResult.importedPresets >= 1 || importResult.totalPresets >= 1);

  console.log(`========================================\nPACKAGE B PASSED: ${passCount} / ${passCount} TESTS OK\n========================================`);

  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}

run().catch(e => {
  console.error('PACKAGE B ERROR:', e);
  try { chrome.kill(); } catch (_) {}
  process.exit(1);
});
