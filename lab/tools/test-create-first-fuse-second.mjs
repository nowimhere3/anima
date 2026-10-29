import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9588;
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'anima-cffs-test-'));
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
  console.log('=== STARTING ANIMA CREATE FIRST, FUSE SECOND TEST SUITE ===');
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
      return { hash: (h >>> 0).toString(16), nonEmpty, rSum, gSum, bSum, aSum, w: c.width, h: c.height };
    };
  `;

  async function waitForLabReady() {
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      const ready = await evalInPage('typeof AnimaLab !== "undefined" && AnimaLab.ready && AnimaLab.ready()');
      if (ready) break;
    }
    await evalInPage(hashHelperExpr);
  }

  async function waitForFusionReady() {
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      const ready = await evalInPage('typeof AnimaFusion !== "undefined" && AnimaFusion.ready && AnimaFusion.ready()');
      if (ready) break;
    }
    await evalInPage(hashHelperExpr);
  }

  async function capturePng(filename) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const outPath = path.join(capturesDir, filename);
    fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
    console.log(`[Captured] ${filename} (${fs.statSync(outPath).size} bytes)`);
    return outPath;
  }

  async function setViewport(w, h, dpr = 1) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
    await evalInPage(`if (window.AnimaLab) window.AnimaLab.resize(); if (window.AnimaFusion) window.AnimaFusion.resize();`);
    await sleep(100);
  }

  const labUrl = pathToFileURL(path.resolve('./anima-main/kaleidoscope-lab.html')).href;
  const fusionUrl = pathToFileURL(path.resolve('./anima-main/kaleidoscope-fusion.html')).href;

  const results = {
    testA: false,
    testB: false,
    testC: false,
    testD: false,
    testE: false,
    testF: false,
    testG: false,
    testH: false
  };

  try {
    // -------------------------------------------------------------
    // TEST A: PURE ART LAB VISUAL MATCH AT MULTIPLE RESOLUTIONS
    // -------------------------------------------------------------
    console.log('\n--- TEST A: Pure Art Lab Visual Match ---');
    await send('Page.navigate', { url: labUrl + '?still=1' });
    await waitForLabReady();

    // Setup a deterministic 2-layer Graphene scene with Backlight in Art Lab
    const labSetup = await evalInPage(`(async () => {
      window.AnimaLab.selectWorkspace('images');
      const s = window.AnimaLab.scene;
      s.folds = 8;
      s.background = '#05060c';
      s.motionMultiplier = 1.0;
      s.light = { mode: 'light', speed: 0.5, preset: 'chroma-spectrum' };
      if (window.World && window.World.setActiveRGB) window.World.setActiveRGB('chroma-spectrum');
      
      const rec = await window.AnimaLab.resolveSavedImageMemoryRecord('bundled-graphene');
      s.layers = [];
      window.AnimaLab.addImageLayer(rec.id, {
        name: 'Graphene Base',
        dir: 'still',
        scale: 1.0,
        light: { mode: 'backlight', strength: 0.85 }
      });
      window.AnimaLab.addImageLayer(rec.id, {
        name: 'Graphene Overlay',
        dir: 'still',
        scale: 0.95,
        blend: 'screen',
        opacity: 0.8,
        light: { mode: 'direct', strength: 0 }
      });
      
      // Save as deterministic preset
      const saved = await window.ImagePresets.savePreset('CFFS_DETERMINISTIC', s);
      window.AnimaLab.syncAll();
      window.AnimaLab.renderNow();
      
      const c = document.getElementById('labCanvas');
      const hInfo = window.__hashCanvas(c);
      return {
        presetId: saved.id,
        w: c.width,
        h: c.height,
        R: s.R,
        extent: s.layers[0].E,
        hash: hInfo.hash
      };
    })()`);
    console.log('Art Lab setup:', labSetup);
    await capturePng('evidence-1-standalone-art-lab.png');

    // Load same preset into Fusion with Sandbox OFF
    await send('Page.navigate', { url: fusionUrl + '?still=1' });
    await waitForFusionReady();

    const fusionDirect = await evalInPage(`(async () => {
      const s = window.AnimaFusion.scene;
      await window.AnimaFusion.onLoadPreset('${labSetup.presetId}');
      
      // Verify default state
      const initialOpticsState = window.AnimaFusion.state.sandboxOpticsEnabled;
      
      window.AnimaFusion.renderNow();
      const fc = document.getElementById('fusionCanvas');
      const hInfo = window.__hashCanvas(fc);
      return {
        initialOpticsState,
        w: fc.width,
        h: fc.height,
        R: window.AnimaFusion.scene.R,
        extent: window.AnimaFusion.scene.layers[0].E,
        hash: hInfo.hash
      };
    })()`);
    console.log('Fusion Direct setup (Sandbox OFF):', fusionDirect);
    await capturePng('evidence-2-fusion-sandbox-off.png');

    // Check pixel bit-for-bit match at 1280x720
    const match1280 = (labSetup.hash === fusionDirect.hash);
    console.log(`1280x720 Pixel Hash Match: ${match1280} (Art Lab: ${labSetup.hash}, Fusion: ${fusionDirect.hash})`);

    // Verify 1920x1080 and 390x844
    await setViewport(1920, 1080, 1);
    const hash1920Fusion = await evalInPage(`(() => {
      window.AnimaFusion.renderNow();
      const fc = document.getElementById('fusionCanvas');
      return window.__hashCanvas(fc).hash;
    })()`);

    await send('Page.navigate', { url: labUrl + '?still=1' });
    await waitForLabReady();
    await setViewport(1920, 1080, 1);
    const hash1920Lab = await evalInPage(`(async () => {
      window.AnimaLab.selectWorkspace('images');
      await window.AnimaLab.imagePresets.restorePreset('${labSetup.presetId}', window.AnimaLab.scene);
      window.AnimaLab.resize();
      window.AnimaLab.renderNow();
      const c = document.getElementById('labCanvas');
      return window.__hashCanvas(c).hash;
    })()`);
    console.log(`1920x1080 Pixel Hash Match: ${hash1920Lab === hash1920Fusion} (${hash1920Lab} vs ${hash1920Fusion})`);

    await setViewport(1280, 720, 1);
    results.testA = match1280 && (hash1920Lab === hash1920Fusion) && (fusionDirect.initialOpticsState === false);
    console.log('TEST A PASSED:', results.testA);

    // -------------------------------------------------------------
    // TEST B: SANDBOX OFF/ON/OFF & OPTICAL MODES
    // -------------------------------------------------------------
    console.log('\n--- TEST B: Sandbox OFF / ON / OFF & All Optical Modes ---');
    await send('Page.navigate', { url: fusionUrl + '?still=1' });
    await waitForFusionReady();
    await evalInPage(`window.AnimaFusion.onLoadPreset('${labSetup.presetId}')`);

    // Verify initial OFF state
    const isInitiallyOff = await evalInPage(`window.AnimaFusion.state.sandboxOpticsEnabled === false`);
    const statusTextOff = await evalInPage(`document.getElementById('opticsModeStatus').textContent`);
    console.log('Initially OFF:', isInitiallyOff, 'Status:', statusTextOff);

    // Turn Sandbox ON in Classic
    await evalInPage(`
      window.AnimaFusion.state.sandbox.mode = 'classic';
      window.AnimaFusion.opticalEngine.setSymmetryMode('classic');
      window.AnimaFusion.setSandboxOpticsEnabled(true);
    `);
    await sleep(150);
    await capturePng('evidence-3-sandbox-on-classic.png');
    const hashClassic = await evalInPage(`window.__hashCanvas(document.getElementById('fusionCanvas')).hash`);

    // Turn Sandbox ON in Radial
    await evalInPage(`
      window.AnimaFusion.state.sandbox.mode = 'radial';
      window.AnimaFusion.opticalEngine.setSymmetryMode('radial');
      window.AnimaFusion.setSandboxOpticsEnabled(true);
    `);
    await sleep(150);
    await capturePng('evidence-4-sandbox-on-radial.png');

    // Turn Sandbox ON in Rings
    await evalInPage(`
      window.AnimaFusion.state.sandbox.mode = 'rings';
      window.AnimaFusion.opticalEngine.setSymmetryMode('rings');
      window.AnimaFusion.setSandboxOpticsEnabled(true);
    `);
    await sleep(150);
    await capturePng('evidence-5-sandbox-on-rings.png');

    // Turn Sandbox ON in Kaleido-Rings
    await evalInPage(`
      window.AnimaFusion.state.sandbox.mode = 'kaleido-rings';
      window.AnimaFusion.opticalEngine.setSymmetryMode('kaleido-rings');
      window.AnimaFusion.setSandboxOpticsEnabled(true);
    `);
    await sleep(150);
    await capturePng('evidence-6-sandbox-on-kaleido-rings.png');
    const hashKaleidoRings = await evalInPage(`window.__hashCanvas(document.getElementById('fusionCanvas')).hash`);

    // Verify Sandbox Paused vs Sandbox OFF
    await evalInPage(`
      window.AnimaFusion.setStage2Playing(false);
      window.AnimaFusion.renderNow();
    `);
    const hashPausedStage2 = await evalInPage(`window.__hashCanvas(document.getElementById('fusionCanvas')).hash`);

    // Turn Sandbox OFF again
    await evalInPage(`window.AnimaFusion.setSandboxOpticsEnabled(false)`);
    await sleep(150);
    await capturePng('evidence-7-sandbox-off-again.png');
    const hashOffAgain = await evalInPage(`window.__hashCanvas(document.getElementById('fusionCanvas')).hash`);

    const opticsOffAgainMatches = (hashOffAgain === fusionDirect.hash);
    console.log(`Sandbox OFF again matches original pure Art Lab: ${opticsOffAgainMatches} (${hashOffAgain} vs ${fusionDirect.hash})`);
    console.log(`Stage 2 Paused differs from Stage 2 OFF: ${hashPausedStage2 !== hashOffAgain}`);

    results.testB = isInitiallyOff && opticsOffAgainMatches && (hashPausedStage2 !== hashOffAgain) && (hashClassic !== hashKaleidoRings);
    console.log('TEST B PASSED:', results.testB);

    // -------------------------------------------------------------
    // TEST C & E: LIVE HANDOFF & PHASE CONTINUITY
    // -------------------------------------------------------------
    console.log('\n--- TEST C & E: Live Handoff & Phase Continuity ---');
    await send('Page.navigate', { url: labUrl });
    await waitForLabReady();

    // Setup active moving scene in Art Lab with custom unsaved modifications
    await evalInPage(`(async () => {
      window.AnimaLab.selectWorkspace('images');
      const s = window.AnimaLab.scene;
      s.folds = 12; // Unsaved fold change
      s.motionMultiplier = 1.25;
      
      const rec = await window.AnimaLab.resolveSavedImageMemoryRecord('bundled-graphene');
      s.layers = [];
      window.AnimaLab.addImageLayer(rec.id, {
        name: 'Moving Layer 1',
        dir: 'cw',
        speed: 1.5,
        scale: 1.05,
        light: { mode: 'backlight', strength: 0.9 }
      });
      window.AnimaLab.addImageLayer(rec.id, {
        name: 'Moving Layer 2',
        dir: 'ccw',
        speed: 2.0,
        scale: 0.9,
        blend: 'screen',
        opacity: 0.75,
        light: { mode: 'direct', strength: 0 }
      });
      window.AnimaLab.syncAll();
      window.AnimaLab.renderNow();
    })()`);

    // Let it animate for 500ms to accumulate non-zero phases
    await sleep(500);

    // Capture pre-handoff state
    const preHandoff = await evalInPage(`(() => {
      const s = window.AnimaLab.scene;
      return {
        folds: s.folds,
        motionMultiplier: s.motionMultiplier,
        layersCount: s.layers.length,
        time: s.time,
        theta0: s.layers[0].st.theta,
        theta1: s.layers[1].st.theta
      };
    })()`);
    console.log('Pre-handoff state in Art Lab:', preHandoff);

    // Capture button screenshot
    await capturePng('evidence-8-continue-in-fusion-button.png');

    // Trigger Continue in Fusion
    await evalInPage(`window.AnimaLab.continueInFusion()`);
    await sleep(1500);
    await waitForFusionReady();

    // Verify current page is Fusion
    const currentUrl = await evalInPage(`window.location.href`);
    const isFusionPage = currentUrl.includes('kaleidoscope-fusion.html');
    console.log('Navigated to:', currentUrl, 'isFusionPage:', isFusionPage);

    // Verify handoff was ingested
    const postHandoff = await evalInPage(`(() => {
      const s = window.AnimaFusion.scene;
      const optEnabled = window.AnimaFusion.state.sandboxOpticsEnabled;
      return {
        optEnabled,
        folds: s.folds,
        motionMultiplier: s.motionMultiplier,
        layersCount: s.layers.length,
        time: s.time,
        theta0: s.layers[0].st.theta,
        theta1: s.layers[1].st.theta,
        statusText: document.getElementById('opticsModeStatus').textContent
      };
    })()`);
    console.log('Post-handoff state in Fusion:', postHandoff);
    await capturePng('evidence-9-fusion-handoff-success-state.png');

    // Validate Test C
    const handoffSceneMatches = (postHandoff.folds === 12) && (postHandoff.motionMultiplier === 1.25) && (postHandoff.layersCount === 2) && (postHandoff.optEnabled === false);
    results.testC = isFusionPage && handoffSceneMatches;
    console.log('TEST C PASSED:', results.testC);

    // Validate Test E: Phase continuity (non-zero phases transferred and continuing)
    const phasesTransferred = (Math.abs(postHandoff.theta0 - preHandoff.theta0) < 0.25) && (postHandoff.theta0 !== 0);
    results.testE = phasesTransferred;
    console.log('TEST E PASSED:', results.testE, `(pre: ${preHandoff.theta0.toFixed(4)}, post: ${postHandoff.theta0.toFixed(4)})`);

    // -------------------------------------------------------------
    // TEST D: UNSAVED SOURCE IMAGES TRANSFER & SAFETY
    // -------------------------------------------------------------
    console.log('\n--- TEST D: Unsaved Source Images Transfer & Safety ---');
    await send('Page.navigate', { url: labUrl });
    await waitForLabReady();

    // Create an unsaved custom image blob in memory
    const unsavedResult = await evalInPage(`(async () => {
      window.AnimaLab.selectWorkspace('images');
      
      // Generate a distinct test canvas image
      const c = document.createElement('canvas');
      c.width = 120; c.height = 120;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ff3366';
      ctx.fillRect(0, 0, 120, 120);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(60, 60, 40, 0, Math.PI * 2); ctx.fill();
      
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      blob.name = 'unsaved-circle.png';
      
      // Import directly into ImageArtEngine without saving to library
      const memRec = await ImageArtEngine.importFile(blob);
      
      // Add as layer
      const s = window.AnimaLab.scene;
      s.layers = [];
      window.AnimaLab.addImageLayer(memRec.id, {
        name: 'Unsaved Custom Layer',
        scale: 1.0
      });
      
      // Execute handoff
      await window.AnimaLab.continueInFusion();
      return { memId: memRec.id };
    })()`);
    await sleep(1500);
    await waitForFusionReady();

    const unsavedInFusion = await evalInPage(`(() => {
      const s = window.AnimaFusion.scene;
      const hasLayer = s && s.layers.length === 1 && s.layers[0].spec.name.includes('Unsaved Custom Layer');
      const assetId = s && s.layers[0].spec.image && s.layers[0].spec.image.assetId;
      const asset = ImageArtEngine.assets.get(assetId);
      return {
        hasLayer,
        assetLoaded: !!asset,
        width: asset ? asset.width : 0,
        height: asset ? asset.height : 0
      };
    })()`);
    console.log('Unsaved custom image in Fusion:', unsavedInFusion);
    results.testD = unsavedInFusion.hasLayer && unsavedInFusion.assetLoaded && (unsavedInFusion.width === 120);
    console.log('TEST D PASSED:', results.testD);

    // -------------------------------------------------------------
    // TEST F: INDEPENDENT PLAYBACK STATES
    // -------------------------------------------------------------
    console.log('\n--- TEST F: Independent Playback States ---');
    const playbackTests = await evalInPage(`(() => {
      const out = {};
      // 1. Stage 1 playing, Sandbox OFF
      window.AnimaFusion.setSandboxOpticsEnabled(false);
      window.AnimaFusion.setStage1Playing(true);
      out.s1PlayOptOff = (window.AnimaFusion.state.stage1Playing === true && window.AnimaFusion.state.sandboxOpticsEnabled === false);
      
      // 2. Stage 1 paused, Sandbox OFF
      window.AnimaFusion.setStage1Playing(false);
      out.s1PauseOptOff = (window.AnimaFusion.state.stage1Playing === false && window.AnimaFusion.state.sandboxOpticsEnabled === false);
      
      // 3. Stage 1 playing, Sandbox ON and moving
      window.AnimaFusion.setSandboxOpticsEnabled(true);
      window.AnimaFusion.setStage1Playing(true);
      window.AnimaFusion.setStage2Playing(true);
      out.bothPlayOptOn = (window.AnimaFusion.state.stage1Playing === true && window.AnimaFusion.state.stage2Playing === true && window.AnimaFusion.state.sandboxOpticsEnabled === true);
      
      // 4. Stage 1 paused, Sandbox ON and moving
      window.AnimaFusion.setStage1Playing(false);
      out.s1PauseS2Play = (window.AnimaFusion.state.stage1Playing === false && window.AnimaFusion.state.stage2Playing === true);
      
      // 5. Sandbox motion paused while optics remain ON
      window.AnimaFusion.setStage1Playing(true);
      window.AnimaFusion.setStage2Playing(false);
      out.s1PlayS2Pause = (window.AnimaFusion.state.stage1Playing === true && window.AnimaFusion.state.stage2Playing === false && window.AnimaFusion.state.sandboxOpticsEnabled === true);
      
      return out;
    })()`);
    console.log('Independent playback results:', playbackTests);
    results.testF = Object.values(playbackTests).every(Boolean);
    console.log('TEST F PASSED:', results.testF);

    // -------------------------------------------------------------
    // TEST G: PERFORMANCE MEASUREMENTS
    // -------------------------------------------------------------
    console.log('\n--- TEST G: Performance Measurements ---');
    const perfData = await evalInPage(`(() => {
      // Benchmark direct Stage 1 bypass (50 frames)
      window.AnimaFusion.setSandboxOpticsEnabled(false);
      window.AnimaFusion.setStage1Playing(true);
      const t0 = performance.now();
      window.AnimaFusion.step(1/60, 50);
      const directTime = performance.now() - t0;
      
      // Benchmark Stage 1 + Sandbox Optics (50 frames)
      window.AnimaFusion.setSandboxOpticsEnabled(true);
      window.AnimaFusion.setStage2Playing(true);
      const t1 = performance.now();
      window.AnimaFusion.step(1/60, 50);
      const opticsTime = performance.now() - t1;
      
      return {
        directMsPerFrame: directTime / 50,
        opticsMsPerFrame: opticsTime / 50
      };
    })()`);
    console.log('Performance Benchmark (ms/frame):', perfData);
    results.testG = perfData.directMsPerFrame < 35 && perfData.opticsMsPerFrame < 50;
    console.log('TEST G PASSED:', results.testG);

    // -------------------------------------------------------------
    // TEST H: REGRESSION CHECKS
    // -------------------------------------------------------------
    console.log('\n--- TEST H: Regressions & UX Constraints ---');
    const regressions = await evalInPage(`(() => {
      const out = {};
      // 1. Check speed sliders range min 0 max 3 step 0.01
      const sm = document.getElementById('motionMul');
      out.motionMulSlider = (sm.min === '0' && sm.max === '3' && sm.step === '0.01');
      
      const sbSpeed = document.getElementById('sandboxSpeed');
      out.sandboxSpeedSlider = (sbSpeed.min === '0' && sbSpeed.max === '3' && sbSpeed.step === '0.01');
      
      // 2. Check collapsible details presence
      out.hasDetails = document.querySelectorAll('aside#panel details.sec-group').length >= 4;
      
      // 3. Check first-fold element
      out.hasFirstFold = !!document.querySelector('.first-fold');
      
      return out;
    })()`);
    console.log('Regression checks:', regressions);
    results.testH = Object.values(regressions).every(Boolean);
    console.log('TEST H PASSED:', results.testH);

  } catch (err) {
    console.error('Test Suite Error:', err);
  } finally {
    try {
      ws.close();
      chrome.kill();
    } catch {}
    await sleep(500);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n=== SUMMARY OF RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
  const allPassed = Object.values(results).every(Boolean);
  console.log(`ALL TESTS PASSED: ${allPassed}`);
}

run().catch(console.error);
