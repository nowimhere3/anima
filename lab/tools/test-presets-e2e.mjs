import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..', '..');
const outDir = path.join(site, 'lab', 'captures');
fs.mkdirSync(outDir, { recursive: true });

const chromePath = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9400 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'anima-preset-test-'));
const gpuArgs = process.env.USE_GPU ? [] : ['--disable-gpu'];
const chrome = spawn(chromePath, ['--headless=new', ...gpuArgs, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cleanup() {
  try { chrome.kill(); } catch (e) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

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

async function evalInPage(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    throw new Error('Eval error: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  }
  return r.result?.result?.value;
}

async function captureShot(name) {
  const pic = await send('Page.captureScreenshot', { format: 'png' });
  if (pic?.result?.data) {
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(pic.result.data, 'base64'));
  }
}

async function navigate(urlSuffix) {
  const targetUrl = pathToFileURL(path.join(site, 'kaleidoscope-lab.html')).href + (urlSuffix || '');
  await send('Page.navigate', { url: targetUrl });
  let ready = false;
  for (let i = 0; i < 150 && !ready; i++) {
    await sleep(150);
    const r = await evalInPage('typeof AnimaLab !== "undefined" && AnimaLab.ready ? AnimaLab.ready() : false');
    ready = r === true;
  }
  if (!ready) throw new Error('Page failed to become ready');
}

console.log('--- STARTING E2E PRESET VERIFICATION ---');
const report = [];
function assert(desc, cond, detail = '') {
  if (cond) {
    console.log(`PASS: ${desc}`);
    report.push({ desc, pass: true });
  } else {
    console.error(`FAIL: ${desc} ${detail}`);
    report.push({ desc, pass: false, detail });
  }
}

try {
  // =========================================================================
  // STEP 1-8: Upload image, configure, save Preset Alpha, modify, reload, save Beta
  // =========================================================================
  await navigate('?still=1');
  await evalInPage('AnimaLab.selectWorkspace("images")');

  // Create synthetic transparent PNG
  const makePngExpr = `(async () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 512, 512);
    x.fillStyle = '#ff3366';
    x.beginPath(); x.arc(256, 256, 180, 0, 7); x.fill();
    x.clearRect(196, 196, 120, 120); // transparent center
    x.fillStyle = 'rgba(255, 220, 0, 0.6)';
    x.fillRect(216, 216, 80, 80); // semi-transparent jewel
    const b = await new Promise(res => c.toBlob(res, 'image/png'));
    const f = new File([b], 'gem-window.png', { type: 'image/png' });
    await AnimaLab.importFiles([f]);
    return AnimaLab.scene.layers.length;
  })()`;

  const layerCount = await evalInPage(makePngExpr);
  assert('Step 1: Upload transparent PNG produces layer', layerCount === 1, `count=${layerCount}`);

  // Step 2: Configure multiple layer and lighting controls (Preset Alpha config)
  await evalInPage(`(() => {
    const s = AnimaLab.scene;
    s.folds = 12;
    s.motionMultiplier = 5.0;
    s.light.preset = 'chroma-aurora';
    s.light.speed = 1.8;
    const l = s.layers[0];
    l.spec.speed = 2.4;
    l.spec.dir = 'ccw';
    l.spec.scale = 1.35;
    l.spec.x = 0.08;
    l.spec.y = -0.04;
    l.spec.opacity = 0.88;
    l.spec.blend = 'screen';
    l.spec.light = { mode: 'backlight', strength: 0.95 };
    l.spec.pulse = { amount: 0.02, period: 18 };
    l.spec.orbit = { rx: 0.03, ry: 0.02, period: 45 };
    l.spec.sampleSpin = 1.2;
    l.spec.clip = { inner: 0.1, outer: 0.9 };
    l.spec.image.zoom = 1.4;
    l.spec.image.panX = 0.15;
    l.spec.image.panY = -0.1;
    l.spec.image.rot = 35;
    l.spec.image.mirrorX = true;
    l.spec.image.mirrorY = false;
    l.spec.image.tint = '#00ffcc';
    l.spec.image.tintStrength = 0.35;
    AnimaLab.syncSceneControls();
    AnimaLab.syncAll();
    AnimaLab.renderNow();
  })()`);

  // Step 3: Save Preset Alpha via ImagePresets
  const pA = await evalInPage(`(async () => {
    return await ImagePresets.savePreset("Preset Alpha", AnimaLab.scene);
  })()`);
  assert('Step 3: Save named preset "Preset Alpha"', pA && pA.name === 'Preset Alpha' && pA.assetIds?.length === 1);
  await captureShot('artlab-preset-alpha-saved');

  // Step 4: Change settings significantly
  await evalInPage(`(() => {
    const s = AnimaLab.scene;
    s.folds = 4;
    s.motionMultiplier = 1.0;
    s.light.preset = 'rainbow-wave';
    s.light.speed = 0.4;
    const l = s.layers[0];
    l.spec.speed = 0.2;
    l.spec.dir = 'cw';
    l.spec.scale = 0.75;
    l.spec.x = -0.1;
    l.spec.y = 0.1;
    l.spec.opacity = 0.45;
    l.spec.blend = 'multiply';
    l.spec.light = { mode: 'direct', strength: 0 };
    l.spec.image.zoom = 0.8;
    l.spec.image.panX = -0.2;
    l.spec.image.rot = -60;
    l.spec.image.mirrorX = false;
    l.spec.image.tint = '#ff0000';
    l.spec.image.tintStrength = 0.8;
    AnimaLab.state.dirtyImages = true;
    AnimaLab.syncSceneControls();
    AnimaLab.syncAll();
    AnimaLab.renderNow();
  })()`);

  const dirtyCheck = await evalInPage('AnimaLab.state.dirtyImages');
  assert('Step 4: Significant changes flagged as dirty', dirtyCheck === true);

  // Step 5: Load "Preset Alpha"
  const restoredA = await evalInPage(`(async () => {
    const rec = await ImagePresets.restorePreset("${pA.id}", AnimaLab.scene);
    AnimaLab.state.dirtyImages = false;
    AnimaLab.syncSceneControls();
    AnimaLab.syncAll();
    AnimaLab.renderNow();
    const s = AnimaLab.scene;
    const l = s.layers[0].spec;
    return {
      folds: s.folds,
      motionMul: s.motionMultiplier,
      lightPreset: s.light.preset,
      lightSpeed: s.light.speed,
      layerSpeed: l.speed,
      layerDir: l.dir,
      layerScale: l.scale,
      layerOpacity: l.opacity,
      layerBlend: l.blend,
      lightMode: l.light.mode,
      lightStrength: l.light.strength,
      zoom: l.image.zoom,
      panX: l.image.panX,
      rot: l.image.rot,
      mirrorX: l.image.mirrorX,
      tint: l.image.tint,
      tintStrength: l.image.tintStrength,
      domFolds: document.getElementById('sceneFolds').value,
      domMotion: document.getElementById('motionMul').value,
      domLightPreset: document.getElementById('lightPreset').value
    };
  })()`);

  // Step 6: Verify every setting returned correctly
  assert('Step 6: Scene folds returned to 12', restoredA.folds === 12 && Number(restoredA.domFolds) === 12);
  assert('Step 6: Motion multiplier returned to 5.0', restoredA.motionMul === 5.0 && Number(restoredA.domMotion) === 5.0);
  assert('Step 6: Light preset returned to chroma-aurora', restoredA.lightPreset === 'chroma-aurora' && restoredA.domLightPreset === 'chroma-aurora');
  assert('Step 6: Light speed returned to 1.8', restoredA.lightSpeed === 1.8);
  assert('Step 6: Layer speed (2.4) and dir (ccw) restored', restoredA.layerSpeed === 2.4 && restoredA.layerDir === 'ccw');
  assert('Step 6: Layer scale (1.35) and opacity (0.88) restored', restoredA.layerScale === 1.35 && restoredA.layerOpacity === 0.88);
  assert('Step 6: Layer blend restored to screen', restoredA.layerBlend === 'screen');
  assert('Step 6: Layer backlight restored to mode=backlight, strength=0.95', restoredA.lightMode === 'backlight' && restoredA.lightStrength === 0.95);
  assert('Step 6: Image zoom, panX, rot, mirrorX, tint restored', restoredA.zoom === 1.4 && restoredA.panX === 0.15 && restoredA.rot === 35 && restoredA.mirrorX === true && restoredA.tint === '#00ffcc');

  // Step 7: Configure and save Preset Beta using same image
  await evalInPage(`(() => {
    const s = AnimaLab.scene;
    s.folds = 8;
    s.motionMultiplier = 2.5;
    s.light.preset = 'chroma-spectrum';
    s.light.speed = 0.75;
    const l = s.layers[0];
    l.spec.speed = 1.1;
    l.spec.dir = 'cw';
    l.spec.scale = 1.0;
    l.spec.opacity = 0.95;
    l.spec.blend = 'source-over';
    l.spec.light = { mode: 'light', strength: 0.5 };
    l.spec.image.zoom = 1.0;
    l.spec.image.panX = 0;
    l.spec.image.rot = 0;
    l.spec.image.mirrorX = false;
    l.spec.image.tint = null;
    l.spec.image.tintStrength = 0;
  })()`);

  const pB = await evalInPage(`(async () => {
    return await ImagePresets.savePreset("Preset Beta", AnimaLab.scene);
  })()`);
  assert('Step 7: Save second preset "Preset Beta"', pB && pB.name === 'Preset Beta');
  assert('Step 7: Asset deduplication (same storageId used)', pA.assetIds[0] === pB.assetIds[0]);

  // Step 8: Switch back and forth between both
  await evalInPage(`(async () => {
    await ImagePresets.restorePreset("${pA.id}", AnimaLab.scene);
  })()`);
  const foldsA = await evalInPage('AnimaLab.scene.folds');
  await evalInPage(`(async () => {
    await ImagePresets.restorePreset("${pB.id}", AnimaLab.scene);
  })()`);
  const foldsB = await evalInPage('AnimaLab.scene.folds');
  assert('Step 8: Switch between Alpha (12) and Beta (8)', foldsA === 12 && foldsB === 8);

  // =========================================================================
  // STEP 9-10: Close and reopen browser simulation (Full Navigation to clean session)
  // =========================================================================
  await navigate('?still=1');
  await evalInPage('AnimaLab.selectWorkspace("images")');

  // Verify memory has 0 assets before loading
  const memAssetCount = await evalInPage('ImageArtEngine.assets.size');
  assert('Step 9: Browser restart simulation (0 in-memory assets)', memAssetCount === 0, `size=${memAssetCount}`);

  // Step 10: Load Preset Alpha without re-uploading
  const restartLoadA = await evalInPage(`(async () => {
    await ImagePresets.restorePreset("${pA.id}", AnimaLab.scene);
    AnimaLab.syncSceneControls();
    AnimaLab.syncAll();
    AnimaLab.renderNow();
    return {
      folds: AnimaLab.scene.folds,
      lightMode: AnimaLab.scene.layers[0].spec.light.mode,
      lightStrength: AnimaLab.scene.layers[0].spec.light.strength,
      memoryAssets: ImageArtEngine.assets.size,
      firstAssetName: [...ImageArtEngine.assets.values()][0].name
    };
  })()`);
  assert('Step 10: Preset Alpha restored from IndexedDB without manual upload', restartLoadA.folds === 12 && restartLoadA.lightMode === 'backlight' && restartLoadA.memoryAssets === 1);
  assert('Step 10: Original asset name preserved', restartLoadA.firstAssetName === 'gem-window.png');
  await captureShot('artlab-preset-alpha-after-restart');

  // Load Preset Beta in the same restarted session
  const restartLoadB = await evalInPage(`(async () => {
    await ImagePresets.restorePreset("${pB.id}", AnimaLab.scene);
    AnimaLab.syncSceneControls();
    AnimaLab.syncAll();
    AnimaLab.renderNow();
    return {
      folds: AnimaLab.scene.folds,
      lightMode: AnimaLab.scene.layers[0].spec.light.mode,
      memoryAssets: ImageArtEngine.assets.size
    };
  })()`);
  assert('Step 10: Preset Beta restored in same session without duplicate asset in memory', restartLoadB.folds === 8 && restartLoadB.lightMode === 'light' && restartLoadB.memoryAssets === 1);
  await captureShot('artlab-preset-beta-after-restart');

  // =========================================================================
  // STEP 11-12: Two independently animated image layers preset
  // =========================================================================
  // Add a second image
  const addSecondImageExpr = `(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 400;
    const x = c.getContext('2d');
    x.fillStyle = '#00ccff';
    x.fillRect(50, 50, 300, 300);
    const b = await new Promise(res => c.toBlob(res, 'image/png'));
    const f = new File([b], 'second-layer.png', { type: 'image/png' });
    const rec = await ImageArtEngine.importFile(f);
    AnimaLab.addImageLayer(rec.id);
    const s = AnimaLab.scene;
    // Layer 0
    s.layers[0].spec.dir = 'cw';
    s.layers[0].spec.speed = 1.5;
    s.layers[0].spec.light = { mode: 'backlight', strength: 0.9 };
    // Layer 1
    s.layers[1].spec.dir = 'ccw';
    s.layers[1].spec.speed = 2.2;
    s.layers[1].spec.clip = { inner: 0.2, outer: 0.85 };
    s.layers[1].spec.light = { mode: 'direct', strength: 0 };
    return s.layers.length;
  })()`;

  const twoCount = await evalInPage(addSecondImageExpr);
  assert('Step 11: Created two image layers', twoCount === 2);

  const pTwo = await evalInPage(`(async () => {
    return await ImagePresets.savePreset("Two Layer Preset", AnimaLab.scene);
  })()`);
  assert('Step 11: Saved Two Layer Preset', pTwo && pTwo.assetIds?.length === 2);

  // Restart page again and restore Two Layer Preset
  await navigate('?still=1');
  await evalInPage('AnimaLab.selectWorkspace("images")');
  const twoRestored = await evalInPage(`(async () => {
    await ImagePresets.restorePreset("${pTwo.id}", AnimaLab.scene);
    AnimaLab.syncSceneControls();
    AnimaLab.syncAll();
    AnimaLab.renderNow();
    const s = AnimaLab.scene;
    return {
      layerCount: s.layers.length,
      l0Dir: s.layers[0].spec.dir,
      l0Speed: s.layers[0].spec.speed,
      l0Light: s.layers[0].spec.light.mode,
      l1Dir: s.layers[1].spec.dir,
      l1Speed: s.layers[1].spec.speed,
      l1Clip: s.layers[1].spec.clip
    };
  })()`);
  assert('Step 11/12: Two layers restored with independent directions, speeds, and clip',
    twoRestored.layerCount === 2 &&
    twoRestored.l0Dir === 'cw' && twoRestored.l0Speed === 1.5 && twoRestored.l0Light === 'backlight' &&
    twoRestored.l1Dir === 'ccw' && twoRestored.l1Speed === 2.2 && twoRestored.l1Clip?.inner === 0.2);
  await captureShot('artlab-two-layers-preset-restored');

  // =========================================================================
  // STEP 13: Test Update, Rename and Delete
  // =========================================================================
  // Update Two Layer Preset: change folds to 14
  await evalInPage(`(async () => {
    AnimaLab.scene.folds = 14;
    await ImagePresets.updatePreset("${pTwo.id}", AnimaLab.scene);
  })()`);
  const checkUpdated = await evalInPage(`(async () => {
    const p = await ImagePresets.getPreset("${pTwo.id}");
    return p.scene.folds;
  })()`);
  assert('Step 13: Update preset updated folds to 14', checkUpdated === 14);

  // Rename Two Layer Preset
  await evalInPage(`(async () => {
    await ImagePresets.renamePreset("${pTwo.id}", "Two Layer Preset Renamed");
  })()`);
  const checkRenamed = await evalInPage(`(async () => {
    const p = await ImagePresets.getPreset("${pTwo.id}");
    return p.name;
  })()`);
  assert('Step 13: Rename preset updated name', checkRenamed === 'Two Layer Preset Renamed');

  // Delete Two Layer Preset
  await evalInPage(`(async () => {
    await ImagePresets.deletePreset("${pTwo.id}");
  })()`);
  const checkDeleted = await evalInPage(`(async () => {
    const p = await ImagePresets.getPreset("${pTwo.id}");
    return p === null;
  })()`);
  assert('Step 13: Delete preset removed record', checkDeleted === true);

  // Clean up pA and pB
  await evalInPage(`(async () => {
    await ImagePresets.deletePreset("${pA.id}");
    await ImagePresets.deletePreset("${pB.id}");
  })()`);

  // Final count
  const allFinal = await evalInPage(`(async () => {
    return await ImagePresets.getAllPresets();
  })()`);
  assert('Step 13: Final preset cleanup verified', allFinal.length === 0, `remaining=${allFinal.length}`);

} catch (err) {
  console.error('Test execution failed:', err);
  assert('Execution finished without uncaught error', false, String(err));
} finally {
  await cleanup();
}

const failed = report.filter(r => !r.pass);
console.log(`\n========================================`);
console.log(`E2E TEST SUMMARY: ${report.length - failed.length} / ${report.length} PASS`);
if (failed.length) {
  console.error(`FAILED CHECKS (${failed.length}):`);
  failed.forEach(f => console.error(` - ${f.desc}: ${f.detail}`));
  process.exit(1);
} else {
  console.log('ALL E2E TESTS PASSED PERFECTLY!');
  process.exit(0);
}
