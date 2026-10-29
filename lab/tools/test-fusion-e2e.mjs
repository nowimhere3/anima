import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9572;
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'anima-fusion-e2e-'));
const capturesDir = path.resolve('./anima-main/lab/captures');
fs.mkdirSync(capturesDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  '--allow-file-access-from-files',
  '--window-size=1280,720',
  '--no-first-run',
  'about:blank'
], { stdio: 'ignore' });

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
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(JSON.stringify(m.params.exceptionDetails));
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  async function evalInPage(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  }

  async function capturePng(filename) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const outPath = path.join(capturesDir, filename);
    fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
    return outPath;
  }

  async function navigateLab(query = '?still=1') {
    const url = pathToFileURL(path.resolve('./anima-main/kaleidoscope-lab.html')).href + query;
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      const ready = await evalInPage('typeof AnimaLab !== "undefined" && AnimaLab.ready && AnimaLab.ready()');
      if (ready) break;
    }
  }

  async function navigateFusion(query = '?still=1') {
    const url = pathToFileURL(path.resolve('./anima-main/kaleidoscope-fusion.html')).href + query;
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      const ready = await evalInPage('typeof AnimaFusion !== "undefined" && AnimaFusion.ready && AnimaFusion.ready()');
      if (ready) break;
    }
  }

  console.log('=== STARTING ANIMA FUSION E2E VERIFICATION ===');
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

  // Helper expression to hash both Stage 1 and Stage 2 canvases in the page
  const hashHelperExpr = `
    window.__hashCanvas = function(c) {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261, nonEmpty = 0, rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      const step = Math.max(4, Math.floor(d.length / 16000) * 4);
      for (let i = 0; i < d.length; i += step) {
        h ^= d[i]; h = Math.imul(h, 16777619);
        h ^= d[i+1]; h = Math.imul(h, 16777619);
        h ^= d[i+2]; h = Math.imul(h, 16777619);
        h ^= d[i+3]; h = Math.imul(h, 16777619);
        if (d[i] > 10 || d[i+1] > 10 || d[i+2] > 10) nonEmpty++;
        rSum += d[i]; gSum += d[i+1]; bSum += d[i+2]; aSum += d[i+3];
      }
      return { hash: (h >>> 0).toString(16), nonEmpty, rSum, gSum, bSum, aSum };
    };
  `;

  // =========================================================================
  // PRE-STEP: Create Saved Presets ("PRESET ONE", "PRESET TWO") & Saved Image
  // in kaleidoscope-lab.html first to verify cross-page sharing with Fusion!
  // =========================================================================
  await navigateLab('?still=1');
  await evalInPage('AnimaLab.selectWorkspace("images")');
  await sleep(300);
  await evalInPage(`(async () => {
    const rec = await AnimaLab.resolveSavedImageMemoryRecord('bundled-graphene');
    AnimaLab.addImageLayer(rec.id);
    AnimaLab.addImageLayer(rec.id);
    AnimaLab.scene.folds = 10;
    AnimaLab.scene.light.preset = 'neon-sunset';
    AnimaLab.scene.layers[0].spec.light = { mode: 'backlight', strength: 1.0 };
    AnimaLab.scene.layers[1].spec.light = { mode: 'light', strength: 0.6 };
    await window.ImagePresets.savePreset('PRESET ONE', AnimaLab.scene);

    AnimaLab.scene.folds = 12;
    AnimaLab.scene.light.preset = 'emerald-aurora';
    await window.ImagePresets.savePreset('PRESET TWO', AnimaLab.scene);
  })()`);

  // =========================================================================
  // TEST A — LIVE SOURCE (Stage 1 continuously feeds Stage 2)
  // =========================================================================
  await navigateFusion('?still=1');
  await evalInPage(hashHelperExpr);
  await evalInPage('AnimaFusion.setBothPlaying(true); AnimaFusion.setSandboxOpticsEnabled(true); AnimaFusion.renderNow();');

  // Capture Screenshot 1: fusion-first-fold.png
  await capturePng('fusion-first-fold.png');

  const testA = await evalInPage(`(() => {
    const s1_t0 = window.__hashCanvas(AnimaFusion.stage1Canvas);
    const s2_t0 = window.__hashCanvas(AnimaFusion.fusionCanvas);
    AnimaFusion.step(0.05, 6);
    const s1_t1 = window.__hashCanvas(AnimaFusion.stage1Canvas);
    const s2_t1 = window.__hashCanvas(AnimaFusion.fusionCanvas);
    AnimaFusion.step(0.05, 6);
    const s1_t2 = window.__hashCanvas(AnimaFusion.stage1Canvas);
    const s2_t2 = window.__hashCanvas(AnimaFusion.fusionCanvas);
    return { s1_t0, s1_t1, s1_t2, s2_t0, s2_t1, s2_t2 };
  })()`);

  assert('Test A.1: Stage 1 source canvas renders non-empty artwork', testA.s1_t0.nonEmpty > 100, JSON.stringify(testA.s1_t0));
  assert('Test A.2: Stage 2 Fusion display canvas renders non-empty artwork', testA.s2_t0.nonEmpty > 100, JSON.stringify(testA.s2_t0));
  assert('Test A.3: Stage 1 source canvas continuously changes across t0 -> t1 -> t2',
    testA.s1_t0.hash !== testA.s1_t1.hash && testA.s1_t1.hash !== testA.s1_t2.hash,
    JSON.stringify([testA.s1_t0.hash, testA.s1_t1.hash, testA.s1_t2.hash]));
  assert('Test A.4: Stage 2 Fusion display canvas continuously changes across t0 -> t1 -> t2',
    testA.s2_t0.hash !== testA.s2_t1.hash && testA.s2_t1.hash !== testA.s2_t2.hash,
    JSON.stringify([testA.s2_t0.hash, testA.s2_t1.hash, testA.s2_t2.hash]));

  // =========================================================================
  // TEST B — INDEPENDENT MOTION (4 States of Stage 1 & Stage 2 Play/Pause)
  // =========================================================================
  // Case 1: Both playing
  const case1 = await evalInPage(`(() => {
    AnimaFusion.setStage1Playing(true);
    AnimaFusion.setStage2Playing(true);
    const s1_a = window.__hashCanvas(AnimaFusion.stage1Canvas).hash;
    const s2_a = window.__hashCanvas(AnimaFusion.fusionCanvas).hash;
    const p_a = AnimaFusion.opticalEngine.getState().ringTime;
    AnimaFusion.step(0.04, 5);
    const s1_b = window.__hashCanvas(AnimaFusion.stage1Canvas).hash;
    const s2_b = window.__hashCanvas(AnimaFusion.fusionCanvas).hash;
    const p_b = AnimaFusion.opticalEngine.getState().ringTime;
    return { s1Changed: s1_a !== s1_b, s2Changed: s2_a !== s2_b, phaseAdvanced: p_b !== p_a };
  })()`);
  assert('Test B.1 (Both Playing): Stage 1 and Stage 2 both advance and render new frames',
    case1.s1Changed && case1.s2Changed && case1.phaseAdvanced, JSON.stringify(case1));

  // Case 2: Stage 1 paused, Stage 2 playing
  const case2 = await evalInPage(`(() => {
    AnimaFusion.setStage1Playing(false);
    AnimaFusion.setStage2Playing(true);
    AnimaFusion.step(0.04, 1);
    const s1_a = window.__hashCanvas(AnimaFusion.stage1Canvas).hash;
    const s2_a = window.__hashCanvas(AnimaFusion.fusionCanvas).hash;
    const p_a = AnimaFusion.opticalEngine.getState().ringTime;
    AnimaFusion.step(0.04, 6);
    const s1_b = window.__hashCanvas(AnimaFusion.stage1Canvas).hash;
    const s2_b = window.__hashCanvas(AnimaFusion.fusionCanvas).hash;
    const p_b = AnimaFusion.opticalEngine.getState().ringTime;
    return { s1Frozen: s1_a === s1_b, s2Changed: s2_a !== s2_b, phaseAdvanced: p_b !== p_a, s1_a, s1_b, s2_a, s2_b };
  })()`);
  assert('Test B.2 (Stage 1 Paused, Stage 2 Playing): Stage 1 stays frozen while Stage 2 continues moving its optics',
    case2.s1Frozen && case2.s2Changed && case2.phaseAdvanced, JSON.stringify(case2));

  // Capture Screenshot 9: fusion-stage1-paused-stage2-playing.png (scrolled to transport bar)
  await evalInPage('document.getElementById("panel").scrollIntoView({ behavior: "instant", block: "start" })');
  await sleep(150);
  await capturePng('fusion-stage1-paused-stage2-playing.png');
  await evalInPage('window.scrollTo({ top: 0, behavior: "instant" })');
  await sleep(100);

  // Case 3: Stage 2 paused, Stage 1 playing
  const case3 = await evalInPage(`(() => {
    AnimaFusion.setStage1Playing(true);
    AnimaFusion.setStage2Playing(false);
    AnimaFusion.step(0.04, 1);
    const s1_a = window.__hashCanvas(AnimaFusion.stage1Canvas).hash;
    const s2_a = window.__hashCanvas(AnimaFusion.fusionCanvas).hash;
    const st_a = AnimaFusion.opticalEngine.getState();
    AnimaFusion.step(0.04, 6);
    const s1_b = window.__hashCanvas(AnimaFusion.stage1Canvas).hash;
    const s2_b = window.__hashCanvas(AnimaFusion.fusionCanvas).hash;
    const st_b = AnimaFusion.opticalEngine.getState();
    const phaseFrozen = (st_a.orbitPhase === st_b.orbitPhase && st_a.spinPhase === st_b.spinPhase && st_a.ringTime === st_b.ringTime);
    return { s1Changed: s1_a !== s1_b, s2Changed: s2_a !== s2_b, phaseFrozen, s1_a, s1_b, s2_a, s2_b };
  })()`);
  assert('Test B.3 (Stage 2 Paused, Stage 1 Playing): Stage 2 optical phases stay frozen while live Stage 1 updates still flow through Stage 2',
    case3.s1Changed && case3.s2Changed && case3.phaseFrozen, JSON.stringify(case3));

  // Case 4: Both paused + live parameter update without reload
  const case4 = await evalInPage(`(() => {
    AnimaFusion.setStage1Playing(false);
    AnimaFusion.setStage2Playing(false);
    AnimaFusion.step(0.04, 1);
    const s1_a = window.__hashCanvas(AnimaFusion.stage1Canvas).hash;
    const s2_a = window.__hashCanvas(AnimaFusion.fusionCanvas).hash;
    AnimaFusion.step(0.04, 5);
    const s1_b = window.__hashCanvas(AnimaFusion.stage1Canvas).hash;
    const s2_b = window.__hashCanvas(AnimaFusion.fusionCanvas).hash;
    // Now edit a Stage 2 control while both are paused
    const rf = document.getElementById('radialFolds');
    rf.value = '14';
    rf.dispatchEvent(new Event('input'));
    AnimaFusion.step(0, 1);
    const s2_afterEdit = window.__hashCanvas(AnimaFusion.fusionCanvas).hash;
    return { bothFrozen: s1_a === s1_b && s2_a === s2_b, updatedOnEdit: s2_afterEdit !== s2_b };
  })()`);
  assert('Test B.4 (Both Paused): Both stages freeze cleanly and update immediately when a control is adjusted',
    case4.bothFrozen && case4.updatedOnEdit, JSON.stringify(case4));

  await evalInPage('AnimaFusion.resetSandboxDefaults(); AnimaFusion.setBothPlaying(true);');

  // =========================================================================
  // TEST C — ALL FOUR SANDBOX OPTICS MODES (classic, radial, rings, kaleido-rings)
  // =========================================================================
  const modeHashes = {};
  const modes = [
    ['classic', 'fusion-classic.png'],
    ['radial', 'fusion-radial.png'],
    ['rings', 'fusion-rings.png'],
    ['kaleido-rings', 'fusion-kaleido-rings.png']
  ];
  for (const [m, file] of modes) {
    const info = await evalInPage(`(() => {
      const sel = document.getElementById('symmetryMode');
      sel.value = '${m}';
      sel.dispatchEvent(new Event('change'));
      AnimaFusion.step(0.03, 2);
      return window.__hashCanvas(AnimaFusion.fusionCanvas);
    })()`);
    await sleep(100);
    await capturePng(file);
    modeHashes[m] = info;
    assert(`Test C (${m}): Renders non-empty live Fusion frame`, info.nonEmpty > 100, JSON.stringify(info));
  }
  const uniqueHashes = new Set(Object.values(modeHashes).map(x => x.hash));
  assert('Test C.5: All 4 Sandbox symmetry modes produce distinct optical projections from the live Stage 1 feed',
    uniqueHashes.size === 4, JSON.stringify(modeHashes));

  // =========================================================================
  // TEST D — SAVED PRESETS & SAVED IMAGES IN FUSION
  // =========================================================================
  const dropdownCheck = await evalInPage(`(() => {
    const pOpts = Array.from(document.getElementById('userPresetSelect').options).map(o => ({ value: o.value, text: o.text }));
    const iOpts = Array.from(document.getElementById('savedImageSelect').options).map(o => ({ value: o.value, text: o.text, bundled: o.dataset.bundled }));
    return { pOpts, iOpts };
  })()`);
  assert('Test D.1: Saved Presets dropdown in Fusion lists PRESET ONE and PRESET TWO',
    dropdownCheck.pOpts.some(o => o.text.includes('PRESET ONE')) && dropdownCheck.pOpts.some(o => o.text.includes('PRESET TWO')),
    JSON.stringify(dropdownCheck.pOpts));
  assert('Test D.2: Saved Images dropdown in Fusion lists bundled Graphene Lattice',
    dropdownCheck.iOpts.some(o => o.text.includes('Graphene Lattice') && o.bundled === '1'),
    JSON.stringify(dropdownCheck.iOpts));

  // Load PRESET ONE in Fusion and verify Stage 1 and Stage 2 update without mutating stored preset
  const presetLoadTest = await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    const p1 = Array.from(sel.options).find(o => o.text.includes('PRESET ONE'));
    const beforeRec = await window.ImagePresets.getPreset(p1.value);
    sel.value = p1.value;
    sel.dispatchEvent(new Event('change'));
    window.confirm = () => true;
    await AnimaFusion.onLoadPreset();
    const afterRec = await window.ImagePresets.getPreset(p1.value);
    return {
      folds: AnimaFusion.scene.folds,
      lightPreset: AnimaFusion.scene.light.preset,
      layer0Mode: AnimaFusion.scene.layers[0].spec.light.mode,
      statusText: document.getElementById('presetStatus').textContent,
      unmutated: beforeRec.updatedAt === afterRec.updatedAt && JSON.stringify(beforeRec.scene) === JSON.stringify(afterRec.scene)
    };
  })()`);
  assert('Test D.3: Loading PRESET ONE in Fusion restores Stage 1 folds, light preset, and Backlight mode and leaves stored record unmutated',
    presetLoadTest.folds === 10 && presetLoadTest.lightPreset === 'neon-sunset' && presetLoadTest.layer0Mode === 'backlight' && presetLoadTest.unmutated,
    JSON.stringify(presetLoadTest));

  // Capture Screenshot 8: fusion-graphene-backlight.png (Graphene Lattice with Stage 1 Backlight flowing through Stage 2 Sandbox optics)
  await evalInPage('window.scrollTo({ top: 0, behavior: "instant" }); AnimaFusion.step(0.04, 4);');
  await sleep(120);
  await capturePng('fusion-graphene-backlight.png');

  // =========================================================================
  // TEST E — COLOR PRESERVATION & CLEAN TRANSPARENCY
  // =========================================================================
  const colorTest = await evalInPage(`(() => {
    // Compare Direct mode vs Backlight mode in Stage 1 and verify Stage 2 reflects the color change
    const l0 = AnimaFusion.scene.layers[0].spec;
    AnimaFusion.patchLayer(l0.id, { light: { mode: 'direct', strength: 0 } });
    AnimaFusion.scene.layers[1].spec.visible = false;
    AnimaFusion.renderNow();
    const directStage2 = window.__hashCanvas(AnimaFusion.fusionCanvas);

    AnimaFusion.patchLayer(l0.id, { light: { mode: 'backlight', strength: 1.0 } });
    AnimaFusion.renderNow();
    const backlitStage2 = window.__hashCanvas(AnimaFusion.fusionCanvas);

    // Also test clean transparent Stage 1 background option
    const bgSel = document.getElementById('stage1Bg');
    bgSel.value = 'transparent';
    bgSel.dispatchEvent(new Event('change'));
    AnimaFusion.patchLayer(l0.id, { light: { mode: 'direct', strength: 0 } });
    AnimaFusion.renderNow();
    const transStage1 = window.__hashCanvas(AnimaFusion.stage1Canvas);
    const transStage2 = window.__hashCanvas(AnimaFusion.fusionCanvas);

    // Restore Studio Dark and layer 2 visibility
    bgSel.value = '#05060c';
    bgSel.dispatchEvent(new Event('change'));
    AnimaFusion.patchLayer(l0.id, { light: { mode: 'backlight', strength: 1.0 } });
    AnimaFusion.scene.layers[1].spec.visible = true;
    AnimaFusion.renderNow();

    return {
      directHash: directStage2.hash,
      backlitHash: backlitStage2.hash,
      backlitBrighter: (backlitStage2.rSum + backlitStage2.gSum + backlitStage2.bSum) > (directStage2.rSum + directStage2.gSum + directStage2.bSum),
      transStage2NonEmpty: transStage2.nonEmpty > 50,
      hasTransparentPixelsInStage1: transStage1.aSum < (512 * 512 / 4) * 255
    };
  })()`);
  assert('Test E.1: Stage 2 Pass-Through RGB preserves Stage 1 Backlight vs Direct color differences and clean alpha',
    colorTest.directHash !== colorTest.backlitHash && colorTest.backlitBrighter && colorTest.transStage2NonEmpty && colorTest.hasTransparentPixelsInStage1,
    JSON.stringify(colorTest));

  // =========================================================================
  // TEST F — UI, SCROLL-AWAY LAYOUT, AND TAB SWITCHING
  // =========================================================================
  const layoutInitial = await evalInPage(`(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const cRect = document.getElementById('fusionCanvas').getBoundingClientRect();
    const pRect = document.getElementById('panel').getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      canvasW: cRect.width,
      canvasH: cRect.height,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      panelTop: pRect.top
    };
  })()`);
  assert('Test F.1: Initial view is unobstructed full-viewport artwork with controls below the fold',
    layoutInitial.scrollY === 0 && layoutInitial.canvasW === layoutInitial.innerW && layoutInitial.canvasH === layoutInitial.innerH && layoutInitial.panelTop >= layoutInitial.innerH,
    JSON.stringify(layoutInitial));

  // Scroll to controls and capture Screenshot 2: fusion-tab1-art-lab-source.png
  await evalInPage(`(() => {
    AnimaFusion.selectTab('source');
    document.getElementById('panel').scrollIntoView({ behavior: 'instant', block: 'start' });
  })()`);
  await sleep(150);
  await capturePng('fusion-tab1-art-lab-source.png');

  // Switch to Tab 2 (Sandbox / Optics), verify animation state was not reset, and capture Screenshot 3: fusion-tab2-sandbox-optics.png
  const tabSwitchCheck = await evalInPage(`(() => {
    const beforePhase = AnimaFusion.opticalEngine.getState().ringTime;
    const beforeLayerAngle = AnimaFusion.scene.layers[0].angle;
    document.getElementById('tabBtnOptics').click();
    const afterPhase = AnimaFusion.opticalEngine.getState().ringTime;
    const afterLayerAngle = AnimaFusion.scene.layers[0].angle;
    const tab2Visible = getComputedStyle(document.querySelector('.ftab-optics')).display !== 'none';
    const tab1Hidden = getComputedStyle(document.querySelector('.ftab-source')).display === 'none';
    return {
      noReset: beforePhase === afterPhase && beforeLayerAngle === afterLayerAngle,
      tab2Visible,
      tab1Hidden
    };
  })()`);
  assert('Test F.2: Switching between Tab 1 and Tab 2 toggles control panels cleanly without resetting Stage 1 or Stage 2 animation phases',
    tabSwitchCheck.noReset && tabSwitchCheck.tab2Visible && tabSwitchCheck.tab1Hidden,
    JSON.stringify(tabSwitchCheck));

  await sleep(150);
  await capturePng('fusion-tab2-sandbox-optics.png');

  // Test H shortcut to hide UI
  const hideCheck = await evalInPage(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    const hidden = document.body.classList.contains('hide-ui') && getComputedStyle(document.getElementById('panel')).display === 'none';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    const restored = !document.body.classList.contains('hide-ui') && getComputedStyle(document.getElementById('panel')).display !== 'none';
    return { hidden, restored };
  })()`);
  assert('Test F.3: H key toggles hide-ui cleanly', hideCheck.hidden && hideCheck.restored, JSON.stringify(hideCheck));

  // Test Narrow Mobile Viewport (390x844)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evalInPage('AnimaFusion.resize(); AnimaFusion.renderNow();');
  await sleep(150);
  const mobileCheck = await evalInPage(`(() => {
    const pRect = document.getElementById('panel').getBoundingClientRect();
    return { panelFitsViewport: pRect.width <= 390, nonEmpty: window.__hashCanvas(AnimaFusion.fusionCanvas).nonEmpty > 100 };
  })()`);
  assert('Test F.4: Narrow mobile viewport (390x844) renders cleanly and fits panel within viewport width',
    mobileCheck.panelFitsViewport && mobileCheck.nonEmpty, JSON.stringify(mobileCheck));

  // Restore desktop viewport and measure live frame timing benchmark
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await evalInPage('AnimaFusion.resize(); AnimaFusion.setBothPlaying(true);');
  const perfStats = await evalInPage(`(() => {
    const t0 = performance.now();
    const N = 60;
    for (let i = 0; i < N; i++) {
      AnimaFusion.step(1/60, 1);
    }
    const elapsed = performance.now() - t0;
    const avgFrameMs = elapsed / N;
    return { avgFrameMs: Number(avgFrameMs.toFixed(2)), equivalentFps: Math.min(60, Math.round(1000 / Math.max(1, avgFrameMs))) };
  })()`);
  console.log('PERF BENCHMARK (60 dual-stage frames @ 1280x720):', JSON.stringify(perfStats));
  assert('Test F.5: Dual-stage frame render time is well within 60fps budget (<16.6ms/frame)',
    perfStats.avgFrameMs < 16.6, JSON.stringify(perfStats));

  assert('Zero uncaught runtime errors during E2E suite', consoleErrors.length === 0, JSON.stringify(consoleErrors));

  console.log('=== ALL ' + passCount + ' ANIMA FUSION E2E ASSERTIONS PASSED ===');
  ws.close();
  chrome.kill();
}

run().catch(e => {
  console.error(e);
  chrome.kill();
  process.exit(1);
});
