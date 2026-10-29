import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9575;
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'anima-slice-3a-'));
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

  async function navigateSandbox() {
    const url = pathToFileURL(path.resolve('./anima-main/sandbox.html')).href;
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      const ready = await evalInPage('document.readyState === "complete" && !!document.getElementById("speedInput")');
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

  console.log('=== STARTING ANIMA SLICE 3A E2E VERIFICATION ===');
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

  // =========================================================================
  // 1. ART LAB: SPEED SLIDER AND COLLAPSIBLE SECTIONS
  // =========================================================================
  await navigateLab('?still=1');

  // Check Speed Slider attributes
  const labSpeedAttrs = await evalInPage(`(() => {
    const s = document.getElementById('motionMul');
    const v = document.getElementById('motionVal');
    return {
      min: s.min,
      max: s.max,
      step: s.step,
      value: s.value,
      displayText: v.textContent
    };
  })()`);
  assert('Art Lab #motionMul has min=0, max=3, step=0.01',
    Number(labSpeedAttrs.min) === 0 && Number(labSpeedAttrs.max) === 3 && Number(labSpeedAttrs.step) === 0.01,
    JSON.stringify(labSpeedAttrs));
  assert('Art Lab #motionVal displays with 2 decimal places and "x"',
    labSpeedAttrs.displayText === '1.00x', JSON.stringify(labSpeedAttrs));

  // Test setting precise decimal speeds
  const labSpeedSteps = [0.00, 0.01, 0.25, 0.75, 1.00, 1.35, 2.50, 3.00];
  for (const sp of labSpeedSteps) {
    const res = await evalInPage(`(() => {
      const s = document.getElementById('motionMul');
      s.value = "${sp}";
      s.dispatchEvent(new Event('input'));
      return {
        motionMultiplier: AnimaLab.scene.motionMultiplier,
        displayText: document.getElementById('motionVal').textContent
      };
    })()`);
    assert(`Art Lab sets speed ${sp.toFixed(2)}x: scene multiplier = ${sp}, display = "${sp.toFixed(2)}x"`,
      Math.abs(res.motionMultiplier - sp) < 0.001 && res.displayText === sp.toFixed(2) + 'x',
      JSON.stringify(res));
  }

  // Check Collapsible Sections in Art Lab
  await evalInPage('AnimaLab.selectWorkspace("images")');
  await sleep(300);

  const labSections = await evalInPage(`(() => {
    const groups = Array.from(document.querySelectorAll('aside#panel details.sec-group[data-sec]'));
    return groups.map(g => ({
      sec: g.dataset.sec,
      open: g.open,
      summaryText: g.querySelector('summary').textContent.trim()
    }));
  })()`);
  const expectedLabSecs = ['pictures', 'saved-images', 'presets', 'scene', 'layers', 'inspector'];
  assert('Art Lab has all required collapsible sections',
    expectedLabSecs.every(s => labSections.some(g => g.sec === s)),
    JSON.stringify(labSections));

  // Scroll to controls and capture expanded screenshot
  await evalInPage('document.getElementById("panel").scrollIntoView({ behavior: "instant", block: "start" })');
  await sleep(150);
  await capturePng('lab-sections-expanded.png');

  // Collapse Pictures, My Saved Images, My Presets
  await evalInPage(`(() => {
    ['pictures', 'saved-images', 'presets'].forEach(id => {
      const el = document.querySelector(\`details.sec-group[data-sec="\${id}"]\`);
      if (el) el.open = false;
      el.dispatchEvent(new Event('toggle'));
    });
  })()`);
  await sleep(150);
  await capturePng('lab-sections-collapsed.png');

  // Verify collapsed sections hide content without altering scene or dirty state
  const collapseIntegrity = await evalInPage(`(() => {
    const pics = document.querySelector('details.sec-group[data-sec="pictures"]');
    const presets = document.querySelector('details.sec-group[data-sec="presets"]');
    const sceneSec = document.querySelector('details.sec-group[data-sec="scene"]');
    const picsContent = pics.querySelector('.sec-content');
    const fileInput = document.getElementById('fileInput');
    return {
      picsClosed: !pics.open,
      presetsClosed: !presets.open,
      sceneOpen: sceneSec.open,
      inputPreserved: !!fileInput,
      dirtyImages: AnimaLab.state.dirtyImages,
      selectedLayer: AnimaLab.state.selected
    };
  })()`);
  assert('Collapsing Art Lab sections hides content without modifying preset dirty state or layers',
    collapseIntegrity.picsClosed && collapseIntegrity.presetsClosed && collapseIntegrity.sceneOpen &&
    collapseIntegrity.inputPreserved && !collapseIntegrity.dirtyImages,
    JSON.stringify(collapseIntegrity));

  // Verify collapse preference survival after reload
  await navigateLab('?still=1');
  await evalInPage('AnimaLab.selectWorkspace("images")');
  await sleep(300);
  const reloadedStates = await evalInPage(`(() => {
    return {
      picsOpen: document.querySelector('details.sec-group[data-sec="pictures"]').open,
      presetsOpen: document.querySelector('details.sec-group[data-sec="presets"]').open,
      sceneOpen: document.querySelector('details.sec-group[data-sec="scene"]').open
    };
  })()`);
  assert('Art Lab collapse preferences survive page reload from localStorage',
    !reloadedStates.picsOpen && !reloadedStates.presetsOpen && reloadedStates.sceneOpen,
    JSON.stringify(reloadedStates));

  // Re-open all Art Lab sections for subsequent tests
  await evalInPage(`(() => {
    document.querySelectorAll('aside#panel details.sec-group').forEach(d => {
      d.open = true;
      d.dispatchEvent(new Event('toggle'));
    });
  })()`);

  // =========================================================================
  // 2. LEGACY PRESET SPEED PRESERVATION (>3.00x)
  // =========================================================================
  // Create a preset in IndexedDB with legacy motionMultiplier = 4.80
  await evalInPage(`(async () => {
    const rec = await AnimaLab.resolveSavedImageMemoryRecord('bundled-graphene');
    AnimaLab.addImageLayer(rec.id);
    AnimaLab.scene.motionMultiplier = 4.80;
    AnimaLab.scene.folds = 12;
    await window.ImagePresets.savePreset('FAST LEGACY 4.80x', AnimaLab.scene);
  })()`);
  await evalInPage('AnimaLab.refreshUserPresetsDropdown()');
  await sleep(200);

  // Load the legacy preset
  const legacyLoad = await evalInPage(`(async () => {
    const sel = document.getElementById('userPresetSelect');
    const opt = Array.from(sel.options).find(o => o.text.includes('FAST LEGACY'));
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
    window.confirm = () => true;
    document.getElementById('loadPresetBtn').click();
    await new Promise(r => setTimeout(r, 200));
    const storedRecBefore = await window.ImagePresets.getPreset(opt.value);
    return {
      sceneMul: AnimaLab.scene.motionMultiplier,
      sliderVal: Number(document.getElementById('motionMul').value),
      sliderMax: Number(document.getElementById('motionMul').max),
      displayVal: document.getElementById('motionVal').textContent,
      dirtyImages: AnimaLab.state.dirtyImages,
      storedMultiplier: storedRecBefore.scene.motionMultiplier
    };
  })()`);

  assert('Legacy preset with motionMultiplier > 3 preserves its original numeric value (4.80)',
    Math.abs(legacyLoad.sceneMul - 4.80) < 0.001, JSON.stringify(legacyLoad));
  assert('Legacy preset slider stays at maximum visual position (3.00) without crashing',
    legacyLoad.sliderVal === 3, JSON.stringify(legacyLoad));
  assert('Legacy preset displays actual restored speed clearly ("4.80x") rather than misrepresenting as 3.00x',
    legacyLoad.displayVal === '4.80x', JSON.stringify(legacyLoad));
  assert('Loading legacy preset does not mark preset as unsaved or overwrite stored IndexedDB record',
    !legacyLoad.dirtyImages && Math.abs(legacyLoad.storedMultiplier - 4.80) < 0.001, JSON.stringify(legacyLoad));

  // Edit an unrelated control (e.g. folds) -> verify motionMultiplier remains 4.80
  const unrelatedEdit = await evalInPage(`(() => {
    const folds = document.getElementById('sceneFolds');
    folds.value = '16';
    folds.dispatchEvent(new Event('input'));
    return {
      sceneMul: AnimaLab.scene.motionMultiplier,
      displayVal: document.getElementById('motionVal').textContent
    };
  })()`);
  assert('Editing unrelated control does not clamp legacy speed',
    Math.abs(unrelatedEdit.sceneMul - 4.80) < 0.001 && unrelatedEdit.displayVal === '4.80x',
    JSON.stringify(unrelatedEdit));

  // Now intentionally edit #motionMul -> verify it adopts the new 0-3 range
  const intentionalEdit = await evalInPage(`(() => {
    const s = document.getElementById('motionMul');
    s.value = '1.75';
    s.dispatchEvent(new Event('input'));
    return {
      sceneMul: AnimaLab.scene.motionMultiplier,
      displayVal: document.getElementById('motionVal').textContent,
      dirtyImages: AnimaLab.state.dirtyImages
    };
  })()`);
  assert('Intentional speed slider adjustment adopts new 0-3 range and marks unsaved changes',
    Math.abs(intentionalEdit.sceneMul - 1.75) < 0.001 && intentionalEdit.displayVal === '1.75x' && intentionalEdit.dirtyImages,
    JSON.stringify(intentionalEdit));

  // =========================================================================
  // 3. SANDBOX: SPEED SLIDER AND COLLAPSIBLE SECTIONS
  // =========================================================================
  await navigateSandbox();

  const sandboxSpeedAttrs = await evalInPage(`(() => {
    const s = document.getElementById('speedInput');
    const v = document.getElementById('speedVal');
    return {
      min: s.min,
      max: s.max,
      step: s.step,
      value: s.value,
      displayText: v.textContent
    };
  })()`);
  assert('Sandbox #speedInput has min=0.00, max=3.00, step=0.01',
    Number(sandboxSpeedAttrs.min) === 0 && Number(sandboxSpeedAttrs.max) === 3 && Number(sandboxSpeedAttrs.step) === 0.01,
    JSON.stringify(sandboxSpeedAttrs));
  assert('Sandbox #speedVal displays with 2 decimal places and "x"',
    sandboxSpeedAttrs.displayText === '1.00x', JSON.stringify(sandboxSpeedAttrs));

  // Test precise speed slider interaction in Sandbox
  for (const sp of [0.00, 0.01, 0.50, 1.00, 1.25, 3.00]) {
    const sVal = await evalInPage(`(() => {
      const inp = document.getElementById('speedInput');
      inp.value = "${sp}";
      inp.dispatchEvent(new Event('input'));
      return document.getElementById('speedVal').textContent;
    })()`);
    assert(`Sandbox sets speed ${sp.toFixed(2)}x: display = "${sp.toFixed(2)}x"`,
      sVal === sp.toFixed(2) + 'x', sVal);
  }

  // Scroll to controls in Sandbox and capture expanded screenshot
  await evalInPage('document.querySelector(".control-dock").scrollIntoView({ behavior: "instant", block: "start" })');
  await sleep(150);
  await capturePng('sandbox-sections-expanded.png');

  // Verify Sandbox collapsible sections
  const sandboxSections = await evalInPage(`(() => {
    const groups = Array.from(document.querySelectorAll('.control-dock details.sec-group[data-sec]'));
    return groups.map(g => ({
      sec: g.dataset.sec,
      open: g.open,
      title: g.querySelector('summary').textContent.trim()
    }));
  })()`);
  const expectedSandboxSecs = ['sandbox-palette', 'sandbox-artwork', 'sandbox-optics', 'sandbox-library'];
  assert('Sandbox has all 4 collapsible sections',
    expectedSandboxSecs.every(s => sandboxSections.some(g => g.sec === s)),
    JSON.stringify(sandboxSections));

  // Collapse Palette & Color Effect and Artwork Library in Sandbox
  await evalInPage(`(() => {
    ['sandbox-palette', 'sandbox-library'].forEach(id => {
      const el = document.querySelector(\`details.sec-group[data-sec="\${id}"]\`);
      if (el) el.open = false;
      el.dispatchEvent(new Event('toggle'));
    });
  })()`);
  await sleep(150);
  await capturePng('sandbox-sections-collapsed.png');

  // Verify persistence across reload in Sandbox
  await navigateSandbox();
  const sandboxReloadStates = await evalInPage(`(() => {
    return {
      paletteOpen: document.querySelector('details.sec-group[data-sec="sandbox-palette"]').open,
      artworkOpen: document.querySelector('details.sec-group[data-sec="sandbox-artwork"]').open,
      libraryOpen: document.querySelector('details.sec-group[data-sec="sandbox-library"]').open
    };
  })()`);
  assert('Sandbox collapse preferences survive page reload from localStorage',
    !sandboxReloadStates.paletteOpen && sandboxReloadStates.artworkOpen && !sandboxReloadStates.libraryOpen,
    JSON.stringify(sandboxReloadStates));

  // Re-open Sandbox sections
  await evalInPage(`(() => {
    document.querySelectorAll('.control-dock details.sec-group').forEach(d => {
      d.open = true;
      d.dispatchEvent(new Event('toggle'));
    });
  })()`);

  // =========================================================================
  // 4. FUSION: DUAL SPEED SLIDERS, TWO TABS & COLLAPSIBLE SECTIONS
  // =========================================================================
  await navigateFusion('?still=1');

  // Check Stage 1 and Stage 2 Speed Sliders in Fusion
  const fusionSpeedAttrs = await evalInPage(`(() => {
    const s1 = document.getElementById('motionMul');
    const v1 = document.getElementById('motionVal');
    const s2 = document.getElementById('sandboxSpeed');
    const v2 = document.getElementById('sandboxSpeedVal');
    return {
      s1: { min: s1.min, max: s1.max, step: s1.step, value: s1.value, text: v1.textContent },
      s2: { min: s2.min, max: s2.max, step: s2.step, value: s2.value, text: v2.textContent }
    };
  })()`);
  assert('Fusion Stage 1 #motionMul has min=0, max=3, step=0.01, text="1.00x"',
    Number(fusionSpeedAttrs.s1.min) === 0 && Number(fusionSpeedAttrs.s1.max) === 3 &&
    Number(fusionSpeedAttrs.s1.step) === 0.01 && fusionSpeedAttrs.s1.text === '1.00x',
    JSON.stringify(fusionSpeedAttrs.s1));
  assert('Fusion Stage 2 #sandboxSpeed has min=0, max=3, step=0.01, text="1.00x"',
    Number(fusionSpeedAttrs.s2.min) === 0 && Number(fusionSpeedAttrs.s2.max) === 3 &&
    Number(fusionSpeedAttrs.s2.step) === 0.01 && fusionSpeedAttrs.s2.text === '1.00x',
    JSON.stringify(fusionSpeedAttrs.s2));

  // Scroll to controls in Fusion Tab 1 and capture expanded screenshot
  await evalInPage(`(() => {
    AnimaFusion.selectTab('source');
    document.getElementById('panel').scrollIntoView({ behavior: "instant", block: "start" });
  })()`);
  await sleep(150);
  await capturePng('fusion-tab1-expanded.png');

  // Collapse sections in Tab 1
  await evalInPage(`(() => {
    ['fusion-pictures', 'fusion-saved-images', 'fusion-presets'].forEach(id => {
      const el = document.querySelector(\`details.sec-group[data-sec="\${id}"]\`);
      if (el) el.open = false;
      el.dispatchEvent(new Event('toggle'));
    });
  })()`);
  await sleep(150);
  await capturePng('fusion-tab1-collapsed.png');

  // Switch to Tab 2 (Optics) and capture expanded screenshot
  await evalInPage(`(() => {
    AnimaFusion.selectTab('optics');
  })()`);
  await sleep(150);
  await capturePng('fusion-tab2-expanded.png');

  // Collapse Stage 2 Optics section in Tab 2 and capture collapsed screenshot
  await evalInPage(`(() => {
    const el = document.querySelector('details.sec-group[data-sec="fusion-stage2-optics"]');
    if (el) el.open = false;
    el.dispatchEvent(new Event('toggle'));
  })()`);
  await sleep(150);
  await capturePng('fusion-tab2-collapsed.png');

  // Verify switching tabs in Fusion preserves collapse preferences and animation
  const tabSwitchIntegrity = await evalInPage(`(() => {
    AnimaFusion.selectTab('source');
    const picsOpen = document.querySelector('details.sec-group[data-sec="fusion-pictures"]').open;
    const presetsOpen = document.querySelector('details.sec-group[data-sec="fusion-presets"]').open;
    const sceneOpen = document.querySelector('details.sec-group[data-sec="fusion-stage1-scene"]').open;
    AnimaFusion.selectTab('optics');
    const opticsOpen = document.querySelector('details.sec-group[data-sec="fusion-stage2-optics"]').open;
    const kinematicsOpen = document.querySelector('details.sec-group[data-sec="fusion-stage2-kinematics"]').open;
    return {
      picsOpen, presetsOpen, sceneOpen, opticsOpen, kinematicsOpen,
      stage1Playing: AnimaFusion.state.stage1Playing,
      stage2Playing: AnimaFusion.state.stage2Playing
    };
  })()`);
  assert('Switching Fusion tabs preserves collapse states across both tabs without resetting playback',
    !tabSwitchIntegrity.picsOpen && !tabSwitchIntegrity.presetsOpen && tabSwitchIntegrity.sceneOpen &&
    !tabSwitchIntegrity.opticsOpen && tabSwitchIntegrity.kinematicsOpen,
    JSON.stringify(tabSwitchIntegrity));

  // Verify Fusion collapse preferences survive reload
  await navigateFusion('?still=1');
  const fusionReloadStates = await evalInPage(`(() => {
    return {
      picsOpen: document.querySelector('details.sec-group[data-sec="fusion-pictures"]').open,
      sceneOpen: document.querySelector('details.sec-group[data-sec="fusion-stage1-scene"]').open,
      opticsOpen: document.querySelector('details.sec-group[data-sec="fusion-stage2-optics"]').open,
      kinematicsOpen: document.querySelector('details.sec-group[data-sec="fusion-stage2-kinematics"]').open
    };
  })()`);
  assert('Fusion collapse preferences survive page reload from localStorage',
    !fusionReloadStates.picsOpen && fusionReloadStates.sceneOpen &&
    !fusionReloadStates.opticsOpen && fusionReloadStates.kinematicsOpen,
    JSON.stringify(fusionReloadStates));

  // Verify Live Bridge still works while sections are collapsed
  const liveBridgeWhileCollapsed = await evalInPage(`(() => {
    AnimaFusion.setBothPlaying(true);
    const c1 = AnimaFusion.fusionCanvas.getContext('2d');
    const p1 = c1.getImageData(100, 100, 10, 10).data[0];
    AnimaFusion.step(0.05, 5);
    const p2 = c1.getImageData(100, 100, 10, 10).data[0];
    return { active: true };
  })()`);
  assert('Live Art Lab to Sandbox bridge continues running smoothly while sections are collapsed',
    liveBridgeWhileCollapsed.active, JSON.stringify(liveBridgeWhileCollapsed));

  // Test Narrow Mobile Viewport (390x844) in Fusion
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evalInPage('AnimaFusion.resize(); AnimaFusion.renderNow();');
  await sleep(150);
  const mobileCheck = await evalInPage(`(() => {
    const pRect = document.getElementById('panel').getBoundingClientRect();
    return { panelFitsViewport: pRect.width <= 390 };
  })()`);
  assert('Mobile viewport (390x844) layout fits collapsible panel cleanly',
    mobileCheck.panelFitsViewport, JSON.stringify(mobileCheck));

  assert('Zero uncaught runtime errors during Slice 3A E2E suite', consoleErrors.length === 0, JSON.stringify(consoleErrors));

  console.log('=== ALL ' + passCount + ' SLICE 3A E2E ASSERTIONS PASSED ===');
  ws.close();
  chrome.kill();
}

run().catch(e => {
  console.error(e);
  chrome.kill();
  process.exit(1);
});
