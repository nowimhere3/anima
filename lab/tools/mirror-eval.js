(async () => {
  const out = [], cvs = document.getElementById('labCanvas'), x = cvs.getContext('2d');
  const s = AnimaLab.scene; s.layers.forEach(l => l.spec.visible = l.spec.id === 'bed');
  const Wc = cvs.width, Hc = cvs.height, q = Wc / s.W, cx = s.cx * q, cy = s.cy * q, R = s.R * q;
  for (const N of [2, 6, 10, 24]) {
    s.folds = N; AnimaLab.renderNow();
    const img = x.getImageData(0, 0, Wc, Hc).data, al = Math.PI / N;
    const at = (px, py) => { let r = 0, g = 0, b = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = (((py | 0) + dy) * Wc + ((px | 0) + dx)) * 4; r += img[i]; g += img[i + 1]; b += img[i + 2]; } return [r / 25, g / 25, b / 25]; };
    let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const test = (axisAngle) => {
      let good = 0, n = 0;
      for (let i = 0; i < 4000; i++) {
        const r = R * (.12 + rnd() * .85), phi = rnd() * Math.PI * 2;
        const phi2 = 2 * axisAngle - phi;
        // skip samples within 3px of any mirror line (anti-aliased lead / ribs)
        const d = Math.abs(((phi / al) % 1 + 1) % 1); if (Math.min(d, 1 - d) * al * r < 4) continue;
        const a = at(cx + r * Math.cos(phi), cy + r * Math.sin(phi)), b = at(cx + r * Math.cos(phi2), cy + r * Math.sin(phi2));
        n++; if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 45) good++;
      }
      return +(good / n).toFixed(4);
    };
    out.push({ N, axis0: test(0), axisAlpha: test(al), axis2alpha: test(2 * al) });
  }
  return JSON.stringify({ viewport: [s.W, s.H], canvas: [Wc, Hc], out });
})()
