(async (MIN) => {
  let errors = 0; window.addEventListener('error', () => errors++); window.addEventListener('unhandledrejection', () => errors++);
  AnimaLab.setPlaying(true);
  const samples = []; const C = AnimaLab.compositor;
  const actions = [
    () => AnimaLab.patchLayer('lancets', { speed: 2.5 }),
    () => AnimaLab.patchLayer('inner', { dir: 'cw' }),
    () => { AnimaLab.scene.folds = 12; },
    () => AnimaLab.patchLayer('border', { frozen: true }),
    () => AnimaLab.patchLayer('border', { frozen: false }),
    () => AnimaLab.setPlaying(false),
    () => AnimaLab.setPlaying(true),
    () => { AnimaLab.scene.folds = 8; },
    () => AnimaLab.patchLayer('lancets', { light: { mode: 'light', strength: .6 } }),
    () => AnimaLab.patchLayer('lancets', { light: { mode: 'direct', strength: 0 } }),
    () => AnimaLab.patchLayer('collar', { opacity: .5 }),
    () => AnimaLab.patchLayer('collar', { opacity: .95 }),
  ];
  for (let m = 0; m < MIN; m++) {
    if (m % 1 === 0 && actions[m % actions.length]) actions[m % actions.length]();
    const iv = []; let last = 0; const t0 = performance.now();
    await new Promise(res => { function f(ts) { if (last) iv.push(ts - last); last = ts; if (performance.now() - t0 < 60000) requestAnimationFrame(f); else res(); } requestAnimationFrame(f); });
    const s = iv.slice().sort((a, b) => a - b);
    samples.push({ min: m + 1, p50: +s[Math.floor(s.length * .5)].toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), max: +s[s.length - 1].toFixed(0), jsHeapMiB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, appMiB: +(C.memoryBytes(AnimaLab.scene) / 1048576).toFixed(1), errors, canvases: document.getElementsByTagName('canvas').length });
  }
  return JSON.stringify(samples);
})(20)
