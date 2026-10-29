(async () => {
  const mk = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return new Promise(r => c.toBlob(b => r(new File([b], 'synthetic-' + w + '.png', { type: 'image/png' })))); };
  let sd = 7; const rnd = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
  const f1 = await mk(900, 600, (x, w, h) => {              // opaque, photo-like: sky gradient + coloured blobs
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ff9a3c'); g.addColorStop(.5, '#d6336c'); g.addColorStop(1, '#1b1464'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { x.fillStyle = `hsla(${rnd() * 360},85%,60%,.75)`; x.beginPath(); x.arc(rnd() * w, rnd() * h, 20 + rnd() * 90, 0, 7); x.fill(); }
  });
  const f2 = await mk(700, 700, (x, w, h) => {              // PNG with real transparency: rings/petals on nothing
    x.clearRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) { x.strokeStyle = `hsla(${i * 40},90%,62%,.9)`; x.lineWidth = 26; x.beginPath(); x.arc(w / 2 + (rnd() - .5) * 120, h / 2 + (rnd() - .5) * 120, 60 + i * 30, 0, 7); x.stroke(); }
    x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.arc(w / 2, h / 2, 70, 0, 7); x.fill();
  });
  AnimaLab.selectWorkspace('images');
  await AnimaLab.importFiles([f1, f2]);
  AnimaLab.step(.25, 120);
  const s = AnimaLab.scene;
  return JSON.stringify({ layers: s.layers.map(r => [r.spec.name, r.spec.dir, r.spec.speed, r.spec.clip, r.st.theta.toFixed(3)]), assets: [...ImageArtEngine.assets.values()].map(a => [a.name, a.width, a.height]) });
})()
