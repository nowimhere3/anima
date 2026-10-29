# Anima Art Lab (first build)

Open `kaleidoscope-lab.html` directly in Chrome / Edge / Firefox (no server, no build step, no dependencies).
It is additive: production `index.html` and the sandbox are untouched. `world.js` is loaded unchanged as the light engine.

- **Native Art** tab (default): Cathedral Glass, Rose Window, Pearl Lotus. No uploads needed.
- **My Images** tab: import two or more pictures (button or drag-drop), each becomes an independent layer.
- Layers: pick one in the list, then set rotation (CW / CCW / Still), speed, freeze, breath, orbit, scale, X/Y,
  opacity, blend, Direct / Light colour and strength, projection, folds override.
- Global: Play/Pause, Motion multiplier (default 4×, design speeds are very slow), Folds (2–24), Light preset/speed,
  Quality, Screenshot. Keys: `H` hide panel, `Space` play/pause, `[` `]` select layer, `D` stats.
- URL options (for capture/testing): `?preset=cathedral|rose|lotus&ui=0&still=1&t=<seconds>&folds=<n>&stats=1`.

Files: `lab/native-art.js` (Engine A), `lab/image-art.js` (Engine B), `lab/optics.js`, `lab/compositor.js`,
`lab/presets.js`, `lab/main.js`, `lab/lab.css`, `lab/verify.html` (tests), `lab/tools/` (Node + Chrome CDP capture harness,
Node built-ins only), `lab/captures/` (screenshots).

Run tests: `node lab/tools/capture.mjs lab/tools/jobs-verify.json` (needs Chrome; set `CHROME` to override the path).
