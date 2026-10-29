import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9580;
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'anima-diag-fidelity-'));
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
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
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

  console.log('=== STARTING ART LAB VS FUSION FIDELITY DIAGNOSTIC ===');

  // Helper expression to hash canvas
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

  // 1. Open Art Lab, create a specific controlled preset with Graphene
  const labUrl = pathToFileURL(path.resolve('./anima-main/kaleidoscope-lab.html')).href + '?still=1&ui=0';
  await send('Page.navigate', { url: labUrl });
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    const ready = await evalInPage('typeof AnimaLab !== "undefined" && AnimaLab.ready && AnimaLab.ready()');
    if (ready) break;
  }
  await evalInPage(hashHelperExpr);
  await evalInPage('AnimaLab.selectWorkspace("images")');
  await sleep(300);

  // Setup controlled scene in Art Lab
  const labSceneSetup = await evalInPage(`(async () => {
    const rec = await AnimaLab.resolveSavedImageMemoryRecord('bundled-graphene');
    // Add two distinct layers
    AnimaLab.scene.layers = [];
    const l1 = AnimaLab.addImageLayer(rec.id, {
      name: 'Layer 1 Backlit',
      dir: 'cw', speed: 1.0, scale: 1.0,
      light: { mode: 'backlight', strength: 1.0 },
      pulse: { amount: 0, period: 20 },
      orbit: { rx: 0, ry: 0, period: 120 },
      sampleSpin: 0
    });
    const l2 = AnimaLab.addImageLayer(rec.id, {
      name: 'Layer 2 Overlay',
      dir: 'ccw', speed: 1.0, scale: 0.85,
      opacity: 0.9, blend: 'screen',
      clip: { inner: 0.15, outer: 0.95 },
      light: { mode: 'direct', strength: 0 },
      pulse: { amount: 0, period: 20 },
      orbit: { rx: 0, ry: 0, period: 120 },
      sampleSpin: 0
    });
    AnimaLab.scene.folds = 8;
    AnimaLab.scene.motionMultiplier = 1.0;
    AnimaLab.scene.light.preset = 'chroma-spectrum';
    AnimaLab.scene.light.speed = 0.5;
    AnimaLab.renderNow();

    // Save as test preset "DIAG_PRESET"
    const saved = await window.ImagePresets.savePreset('DIAG_PRESET', AnimaLab.scene);
    return {
      presetId: saved.id,
      labW: AnimaLab.state.W,
      labH: AnimaLab.state.H,
      labR: AnimaLab.scene.R,
      labExtentL1: AnimaLab.scene.layers[0].E,
      labExtentL2: AnimaLab.scene.layers[1].E,
      labPprL1: AnimaLab.scene.layers[0].ppr,
      labCanvasHash: window.__hashCanvas(document.getElementById('labCanvas'))
    };
  })()`);

  console.log('ART LAB SCENE SETUP:', JSON.stringify(labSceneSetup, null, 2));
  await capturePng('diag-lab-canvas.png');

  // 2. Open Fusion with the SAME preset
  const fusionUrl = pathToFileURL(path.resolve('./anima-main/kaleidoscope-fusion.html')).href + '?still=1&ui=0';
  await send('Page.navigate', { url: fusionUrl });
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    const ready = await evalInPage('typeof AnimaFusion !== "undefined" && AnimaFusion.ready && AnimaFusion.ready()');
    if (ready) break;
  }
  await evalInPage(hashHelperExpr);

  // Load DIAG_PRESET into Fusion Stage 1
  const fusionLoaded = await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    const opt = Array.from(sel.options).find(o => o.text.includes('DIAG_PRESET'));
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
    window.confirm = () => true;
    await AnimaFusion.onLoadPreset();

    // Freeze Stage 2 motion
    AnimaFusion.setStage2Playing(false);
    AnimaFusion.renderNow();

    const s1Canvas = AnimaFusion.stage1Canvas;
    const fusionDisplay = AnimaFusion.fusionCanvas;
    const s = AnimaFusion.scene;

    return {
      stage1Size: AnimaFusion.state.stage1Size,
      s1W: s.W,
      s1H: s.H,
      s1R: s.R,
      s1ExtentL1: s.layers[0].E,
      s1ExtentL2: s.layers[1].E,
      s1PprL1: s.layers[0].ppr,
      s1ProjW_L1: s.layers[0].proj.width,
      s1ProjW_L2: s.layers[1].proj.width,
      s1CanvasHash: window.__hashCanvas(s1Canvas),
      fusionDisplayHash: window.__hashCanvas(fusionDisplay),
      stage2Mode: AnimaFusion.state.sandbox.mode
    };
  })()`);

  console.log('FUSION LOADED STATE:', JSON.stringify(fusionLoaded, null, 2));
  await capturePng('diag-fusion-display-stage2-paused.png');

  // Capture Stage 1 offscreen canvas directly
  const s1DataUrl = await evalInPage('AnimaFusion.stage1Canvas.toDataURL("image/png")');
  fs.writeFileSync(path.join(capturesDir, 'diag-fusion-stage1-canvas.png'), Buffer.from(s1DataUrl.split(',')[1], 'base64'));

  // Test Direct Stage 1 bypass onto fusionCanvas
  const bypassTest = await evalInPage(`(() => {
    const fc = AnimaFusion.fusionCanvas;
    const fctx = fc.getContext('2d');
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fc.width, fc.height);
    // Draw stage1Canvas centered with aspect preservation or full screen
    const k = Math.min(fc.width / 512, fc.height / 512);
    const dw = 512 * k, dh = 512 * k;
    fctx.drawImage(AnimaFusion.stage1Canvas, (fc.width - dw)/2, (fc.height - dh)/2, dw, dh);
    return window.__hashCanvas(fc);
  })()`);
  await capturePng('diag-fusion-stage1-direct-bypass.png');

  // Test Full-Viewport Stage 1 rendering in Fusion (i.e. if Stage 1 renders at display resolution when Sandbox is OFF)
  const fullResStage1Test = await evalInPage(`(() => {
    const fc = AnimaFusion.fusionCanvas;
    const fctx = fc.getContext('2d');
    const s = AnimaFusion.scene;
    // Re-layout scene at full display dimensions (1280x720)
    AnimaFusion.compositor.layout(s, fc.width, fc.height, 1);
    AnimaFusion.compositor.prepareScene(s, { lightCanvas: document.createElement('canvas'), lightRev: 1 });
    AnimaFusion.compositor.renderScene(s, fctx, { lightCanvas: document.createElement('canvas'), lightRev: 1 });
    return {
      fullResR: s.R,
      fullResExtentL1: s.layers[0].E,
      hash: window.__hashCanvas(fc)
    };
  })()`);
  console.log('FULL RES STAGE 1 DIRECT RENDER:', JSON.stringify(fullResStage1Test, null, 2));
  await capturePng('diag-fusion-fullres-stage1-render.png');

  // Compare Lab Canvas vs Fusion Full-Res Stage 1 Render
  console.log('COMPARISON SUMMARY:');
  console.log('1. Lab Canvas Hash:', labSceneSetup.labCanvasHash.hash);
  console.log('2. Fusion Stage 2 Paused (Kaleido-Rings active):', fusionLoaded.fusionDisplayHash.hash);
  console.log('3. Fusion Stage 1 512x512 Canvas Hash:', fusionLoaded.s1CanvasHash.hash);
  console.log('4. Fusion Stage 1 Direct Bypass Hash:', bypassTest.hash);
  console.log('5. Fusion Full-Res Stage 1 Render Hash:', fullResStage1Test.hash.hash);

  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

run().catch(e => {
  console.error(e);
  chrome.kill();
  process.exit(1);
});
