(async () => {
  AnimaLab.setPlaying(false);
  const C = AnimaLab.compositor, s = AnimaLab.scene, out = {};
  const frame = { lightCanvas: document.createElement('canvas'), lightRev: 100 }; frame.lightCanvas.width = frame.lightCanvas.height = 256;
  const lc = frame.lightCanvas.getContext('2d'); lc.fillStyle = '#f80'; lc.fillRect(0, 0, 256, 256);
  const t = (name, fn, n = 5) => { const a = performance.now(); for (let i = 0; i < n; i++) fn(i); out[name] = +((performance.now() - a) / n).toFixed(2); };
  const rt = s.layers.find(r => r.spec.id === 'lancets');
  t('reproject lit layer (ensureLayer)', i => { frame.lightRev++; C.ensureLayer(s, rt, frame); });
  const ctx = document.getElementById('labCanvas').getContext('2d');
  t('renderScene only (draw 6 layers)', () => C.renderScene(s, ctx, frame));
  for (const r of s.layers) { const keep = r.spec.visible; s.layers.forEach(l => l.spec.visible = l === r); t('draw ' + r.spec.id, () => { C.renderScene(s, ctx, frame); ctx.getImageData(0,0,1,1); }, 3); s.layers.forEach(l => l.spec.visible = true); }
  const ctx2 = ctx; t('readback sync (forces raster flush) after render', () => { C.renderScene(s, ctx, frame); ctx.getImageData(0, 0, 1, 1); }, 3);
  return JSON.stringify(out);
})()
