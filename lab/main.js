/* ============================================================
   LAB MAIN — scene state, UI, loading, RAF and viewport handling.
   Reuses world.js (unchanged) once per frame as the shared light field.
   ============================================================ */
(function () {
    "use strict";
    const C = LabCompositor;
    const $ = id => document.getElementById(id);
    const qs = new URLSearchParams(location.search);

    const canvas = $('labCanvas'), ctx = canvas.getContext('2d', { alpha: false });
    const lightCanvas = document.createElement('canvas'); lightCanvas.width = lightCanvas.height = 256;
    const lightCtx = lightCanvas.getContext('2d');

    const state = {
        workspace: 'native', scenes: { native: null, images: null }, presetId: 'cathedral',
        selected: null, quality: 'auto', lightRev: 0, lightAcc: 0, building: 0,
        stats: { work: [], frames: 0, last: 0 }, W: 0, H: 0, dirtyImages: false
    };
    const markDirtyImages = () => { if (state.workspace === 'images') state.dirtyImages = true; };
    const frame = { lightCanvas, lightRev: 0 };
    const LIGHT_HZ = 20;

    const IMAGES_PRESET = {
        id: 'images', name: 'My Images', folds: 8, detail: 0, seed: 1,
        palette: ['#0a0a12', '#3a3a5a', '#7a7a9a', '#caa860', '#fff4d8'], metal: '#caa860', lead: '#0a0a10', leadW: .006,
        background: '#05060c', light: { preset: 'chroma-spectrum', speed: .5 }, layers: []
    };

    const scene = () => state.scenes[state.workspace];

    /* ---------- canvas / quality ---------- */
    function pickQ(W, H) {
        const dpr = window.devicePixelRatio || 1, px = W * H;
        let q;
        if (state.quality === 'low') q = Math.min(dpr, 1, Math.sqrt(1.5e6 / px));
        else if (state.quality === 'high') q = Math.min(dpr, 2, Math.sqrt(6e6 / px));
        else q = Math.min(dpr, 1.25, Math.sqrt(2.5e6 / px));
        return Math.max(.5, q);
    }
    function resize() {
        const W = Math.max(320, window.innerWidth), H = Math.max(240, window.innerHeight);
        const q = pickQ(W, H);
        const cw = Math.round(W * q), ch = Math.round(H * q);
        if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
        state.W = W; state.H = H;
        for (const k in state.scenes) if (state.scenes[k]) C.layout(state.scenes[k], W, H, cw / W);
    }
    let resizeTimer = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { resize(); renderNow(); }, 120); });

    /* ---------- light field (World, once per frame) ---------- */
    function updateLight(dt) {
        const s = scene();
        if (!s || !C.sceneUsesLight(s)) return;
        World.update(dt * .6, s.light.speed);
        state.lightAcc += dt;
        if (state.lightAcc >= 1 / LIGHT_HZ || !frame.lightRev) {
            state.lightAcc = 0;
            World.render(lightCtx, 256, 256);
            frame.lightRev++;
        }
    }

    /* ---------- frame ---------- */
    function renderNow() {
        const s = scene(); if (!s) return;
        C.prepareScene(s, frame);
        C.renderScene(s, ctx, frame);
    }
    function tick(dt) {
        const s = scene(); if (!s) return;
        if (s.playing) { C.advanceScene(s, dt); updateLight(dt); }
        else if (C.sceneUsesLight(s) && !frame.lightRev) updateLight(0);
        renderNow();
    }
    let last = 0;
    function loop(ts) {
        const t0 = performance.now();
        if (!last) last = ts;
        const dt = Math.min(.1, Math.max(0, (ts - last) / 1000)); last = ts;
        if (!state.building) tick(dt);
        const w = performance.now() - t0, st = state.stats;
        st.work.push(w); if (st.work.length > 300) st.work.shift();
        st.frames++;
        if (st.dbg && st.frames % 20 === 0) updateStats();
        requestAnimationFrame(loop);
    }
    document.addEventListener('visibilitychange', () => { last = 0; });

    function updateStats() {
        const a = state.stats.work.slice().sort((x, y) => x - y);
        const p95 = a.length ? a[Math.floor(a.length * .95)] : 0;
        const mb = (C.memoryBytes(scene()) / 1048576).toFixed(0);
        $('stats').textContent = `render p95 ${p95.toFixed(1)}ms · ${state.W}×${state.H} q${(canvas.width / state.W).toFixed(2)} · ~${mb} MiB`;
    }

    /* ---------- scenes ---------- */
    function buildScene(preset, workspace) {
        const s = C.createScene(preset, { workspace });
        C.layout(s, state.W, state.H, canvas.width / state.W);
        s.playing = state.playing !== false;
        s.motionMultiplier = parseFloat($('motionMul').value) || 1.0;
        return s;
    }
    function busy(on, msg) {
        state.building += on ? 1 : -1;
        $('busy').textContent = msg || 'Painting…'; $('busy').classList.toggle('on', state.building > 0);
    }
    function loadPreset(id, opts) {
        opts = opts || {};
        const preset = LabPresets.byId(id); if (!preset) return;
        const token = ++state.token || (state.token = 1);
        state.presetId = id;
        busy(true);
        setTimeout(() => {
            if (token !== state.token) { busy(false); return; }
            const s = buildScene(preset, 'native');
            if (opts.detail != null) s.detail = opts.detail;
            C.prepareScene(s, frame);                // fully resolved before it replaces the visible scene
            state.scenes.native = s;
            if (state.workspace === 'native') { state.selected = s.layers.length > 1 ? s.layers[1].spec.id : null; syncAll(); }
            World.setActiveRGB(s.light.preset);
            busy(false);
            if (opts.done) opts.done();
        }, 16);
    }
    function syncSceneControls() {
        const s = scene();
        if (!s) return;
        if ($('sceneFolds')) { $('sceneFolds').value = s.folds; $('foldsVal').textContent = s.folds; }
        if ($('motionMul')) {
            const m = s.motionMultiplier != null ? s.motionMultiplier : 1.0;
            $('motionMul').value = Math.min(3, Math.max(0, m));
            $('motionVal').textContent = m.toFixed(2) + 'x';
        }
        if (s.light) {
            if ($('lightPreset') && s.light.preset) {
                $('lightPreset').value = s.light.preset;
                World.setActiveRGB(s.light.preset);
            }
            if ($('lightSpeed') && s.light.speed != null) {
                $('lightSpeed').value = s.light.speed;
                $('lightVal').textContent = s.light.speed.toFixed(2);
            }
        }
    }
    function selectWorkspace(name) {
        state.workspace = name;
        document.body.dataset.workspace = name;
        document.querySelectorAll('#engineTabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.ws === name));
        const s = scene();
        state.selected = s && s.layers.length ? s.layers[0].spec.id : null;
        if (s) World.setActiveRGB(s.light.preset);
        syncSceneControls();
        syncAll();
        if (name === 'images') {
            refreshUserPresetsDropdown();
            refreshSavedImagesDropdown();
        }
    }

    /* ---------- layer editing (never resets phases) ---------- */
    const selLayer = () => { const s = scene(); return s && s.layers.find(r => r.spec.id === state.selected); };
    function patchLayer(id, partial) {
        const s = scene(); const rt = s.layers.find(r => r.spec.id === id); if (!rt) return;
        markDirtyImages();
        for (const k in partial) {
            const v = partial[k];
            if (v && typeof v === 'object' && !Array.isArray(v) && rt.spec[k] && typeof rt.spec[k] === 'object') Object.assign(rt.spec[k], v);
            else rt.spec[k] = v;
        }
    }

    /* ---------- UI ---------- */
    function el(tag, attrs, kids) {
        const e = document.createElement(tag);
        for (const k in (attrs || {})) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'on') for (const ev in attrs.on) e.addEventListener(ev, attrs.on[ev]); else e.setAttribute(k, attrs[k]); }
        for (const c of (kids || [])) e.appendChild(c);
        return e;
    }
    function slider(label, min, max, step, value, fmt, onInput, id) {
        const out = el('output', { text: fmt(value) });
        const inp = el('input', { type: 'range', min, max, step, value, 'aria-label': label });
        if (id) inp.id = id;
        inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v); onInput(v); });
        return el('label', { class: 'row' }, [el('span', { text: label }), inp, out]);
    }
    function select(label, opts, value, onChange, id) {
        const sel = el('select', { 'aria-label': label });
        if (id) sel.id = id;
        for (const [v, t] of opts) { const o = el('option', { value: v, text: t }); if (String(v) === String(value)) o.selected = true; sel.appendChild(o); }
        sel.addEventListener('change', () => onChange(sel.value));
        return el('label', { class: 'row' }, [el('span', { text: label }), sel]);
    }
    function seg(label, opts, value, onPick) {
        const wrap = el('div', { class: 'seg', role: 'group', 'aria-label': label });
        for (const [v, t] of opts) {
            const b = el('button', { type: 'button', text: t, 'aria-pressed': String(v === value) });
            b.addEventListener('click', () => { onPick(v); wrap.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
            wrap.appendChild(b);
        }
        return el('div', { class: 'row' }, [el('span', { text: label }), wrap]);
    }
    function check(label, value, onChange, id) {
        const i = el('input', { type: 'checkbox' }); i.checked = !!value; if (id) i.id = id;
        i.addEventListener('change', () => onChange(i.checked));
        return el('label', { class: 'row chk' }, [i, el('span', { text: label })]);
    }

    function syncAll() { buildPresetCards(); buildLayerList(); buildInspector(); buildAssets(); $('emptyMsg').classList.toggle('on', state.workspace === 'images' && !(scene() && scene().layers.length)); }

    function buildPresetCards() {
        const box = $('presetSelect'); box.textContent = '';
        for (const p of LabPresets.list) {
            const b = el('button', { type: 'button', class: 'card', 'data-preset': p.id, 'aria-pressed': String(p.id === state.presetId), role: 'radio', 'aria-checked': String(p.id === state.presetId) });
            const sw = el('span', { class: 'sw' }); p.palette.forEach(c => sw.appendChild(el('i', { style: 'background:' + c })));
            b.appendChild(sw); b.appendChild(el('b', { text: p.name })); b.appendChild(el('small', { text: p.tag }));
            b.addEventListener('click', () => loadPreset(p.id));
            box.appendChild(b);
        }
    }

    function buildLayerList() {
        const box = $('layerList'); box.textContent = '';
        const s = scene(); if (!s) return;
        const rows = s.layers.slice().reverse();
        for (const rt of rows) {
            const sp = rt.spec;
            const dirTxt = sp.frozen ? '❄' : sp.dir === 'cw' ? '↻' : sp.dir === 'ccw' ? '↺' : '•';
            const row = el('div', { class: 'lrow' + (sp.id === state.selected ? ' sel' : ''), 'data-layer-id': sp.id, tabindex: '0', role: 'option', 'aria-selected': String(sp.id === state.selected) });
            const vis = el('input', { type: 'checkbox', 'aria-label': 'Visible: ' + sp.name }); vis.checked = sp.visible;
            vis.addEventListener('click', e => e.stopPropagation());
            vis.addEventListener('change', () => { sp.visible = vis.checked; });
            row.appendChild(vis);
            row.appendChild(el('span', { class: 'ln', text: sp.name }));
            row.appendChild(el('span', { class: 'ld', text: dirTxt, title: 'direction' }));
            row.appendChild(el('span', { class: 'ld', text: sp.light && (sp.light.mode === 'light' || sp.light.mode === 'backlight' || sp.light.mode === 'both') && sp.light.strength > 0 ? '✦' : '', title: sp.light && sp.light.mode === 'backlight' ? 'backlit' : 'light-powered' }));
            row.addEventListener('click', () => selectLayer(sp.id));
            row.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLayer(sp.id); }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); stepSelection(e.key === 'ArrowDown' ? 1 : -1, true); }
            });
            box.appendChild(row);
        }
    }
    function selectLayer(id) { state.selected = id; buildLayerList(); buildInspector(); }
    function stepSelection(d, focus) {
        const s = scene(); if (!s || !s.layers.length) return;
        const ids = s.layers.slice().reverse().map(r => r.spec.id);
        let i = ids.indexOf(state.selected); i = (i + d + ids.length) % ids.length;
        selectLayer(ids[i]);
        if (focus) { const r = document.querySelector(`[data-layer-id="${ids[i]}"]`); if (r) r.focus(); }
    }

    function buildInspector() {
        const box = $('inspector'); box.textContent = '';
        const rt = selLayer(); if (!rt) { box.appendChild(el('p', { class: 'hint', text: 'Select a layer to edit it.' })); return; }
        const sp = rt.spec, id = sp.id, s = scene();
        box.appendChild(el('h3', { text: sp.name }));
        // Motion
        box.appendChild(el('h4', { text: 'Motion' }));
        box.appendChild(seg('Rotation', [['cw', '↻ CW'], ['ccw', '↺ CCW'], ['still', 'Still']], sp.dir, v => { patchLayer(id, { dir: v }); buildLayerList(); }));
        box.appendChild(slider('Speed °/s', 0, 4, .01, sp.speed, v => v.toFixed(2), v => patchLayer(id, { speed: v }), 'layerSpeed'));
        box.appendChild(check('Freeze layer', sp.frozen, v => { patchLayer(id, { frozen: v }); buildLayerList(); }));
        box.appendChild(slider('Breath %', 0, 3, .1, (sp.pulse.amount || 0) * 100, v => v.toFixed(1), v => patchLayer(id, { pulse: { amount: v / 100, period: sp.pulse.period || 20 } })));
        box.appendChild(slider('Orbit R', 0, .1, .005, sp.orbit.rx || 0, v => v.toFixed(3), v => patchLayer(id, { orbit: { rx: v, ry: v, period: sp.orbit.period || 90 } })));
        // Placement
        box.appendChild(el('h4', { text: 'Placement' }));
        box.appendChild(slider('Scale', .4, 1.8, .01, sp.scale, v => v.toFixed(2), v => patchLayer(id, { scale: v }), 'layerScale'));
        box.appendChild(slider('X', -.5, .5, .005, sp.x, v => v.toFixed(3), v => patchLayer(id, { x: v }), 'layerX'));
        box.appendChild(slider('Y', -.5, .5, .005, sp.y, v => v.toFixed(3), v => patchLayer(id, { y: v }), 'layerY'));
        // Appearance
        box.appendChild(el('h4', { text: 'Appearance' }));
        box.appendChild(slider('Opacity', 0, 1, .01, sp.opacity, v => v.toFixed(2), v => patchLayer(id, { opacity: v }), 'layerOpacity'));
        box.appendChild(select('Blend', [['source-over', 'Normal'], ['screen', 'Screen'], ['multiply', 'Multiply']], sp.blend, v => patchLayer(id, { blend: v })));
        box.appendChild(seg('Lighting', [['direct', 'Direct'], ['light', 'Color Tint'], ['backlight', 'Backlight']], sp.light.mode, v => {
            let nextStr = typeof sp.light.strength === 'number' ? sp.light.strength : 0;
            if (v !== 'direct' && !(nextStr > 0)) {
                nextStr = v === 'backlight' ? 1.0 : 0.3;
            }
            patchLayer(id, { light: { mode: v, strength: nextStr } });
            buildLayerList();
            buildInspector();
        }));
        box.appendChild(slider('Light strength', 0, 1, .01, sp.light.strength, v => v.toFixed(2), v => { patchLayer(id, { light: { strength: v } }); buildLayerList(); }, 'layerLightStrength'));
        // Optics
        box.appendChild(el('h4', { text: 'Optics' }));
        box.appendChild(select('Projection', [['radial', 'Mirrored radial'], ['identity', 'Identity']], sp.proj, v => patchLayer(id, { proj: v })));
        box.appendChild(select('Folds', [['', 'Inherit (' + s.folds + ')']].concat(Array.from({ length: 23 }, (_, i) => [i + 2, String(i + 2)])), sp.folds == null ? '' : sp.folds, v => patchLayer(id, { folds: v === '' ? null : parseInt(v) }), 'layerFolds'));
        if (sp.engine === 'image') imageInspector(box, rt);
    }

    function imageInspector(box, rt) {
        const sp = rt.spec, im = sp.image, id = sp.id;
        box.appendChild(slider('Sample zoom', .4, 3, .01, im.zoom, v => v.toFixed(2), v => { im.zoom = v; markDirtyImages(); }));
        box.appendChild(slider('Sample pan X', -1, 1, .01, im.panX, v => v.toFixed(2), v => { im.panX = v; markDirtyImages(); }));
        box.appendChild(slider('Sample pan Y', -1, 1, .01, im.panY, v => v.toFixed(2), v => { im.panY = v; markDirtyImages(); }));
        box.appendChild(slider('Sample rotate °', -180, 180, 1, im.rot, v => v.toFixed(0), v => { im.rot = v; markDirtyImages(); }));
        box.appendChild(slider('Source spin °/s', -8, 8, .1, sp.sampleSpin, v => v.toFixed(1), v => { sp.sampleSpin = v; markDirtyImages(); }));
        box.appendChild(slider('Outer radius', .3, 2.2, .01, sp.clip ? sp.clip.outer : 0, v => v.toFixed(2), v => { sp.clip = { inner: sp.clip ? sp.clip.inner : 0, outer: v }; markDirtyImages(); }));
        box.appendChild(slider('Inner radius', 0, 1.5, .01, sp.clip ? sp.clip.inner : 0, v => v.toFixed(2), v => { sp.clip = { inner: v, outer: sp.clip ? sp.clip.outer : 1 }; markDirtyImages(); }));
        box.appendChild(el('h4', { text: 'Picture' }));
        const rebuild = () => { rt.srcKey = ''; markDirtyImages(); };
        box.appendChild(select('Fit', [['cover', 'Cover'], ['contain', 'Contain']], im.fit, v => { im.fit = v; rebuild(); }));
        box.appendChild(check('Mirror X', im.mirrorX, v => { im.mirrorX = v; rebuild(); }));
        box.appendChild(check('Mirror Y', im.mirrorY, v => { im.mirrorY = v; rebuild(); }));
        box.appendChild(select('Alpha', [['original', 'Original (preserve)'], ['legacy-luma', 'Legacy luma']], im.alphaMode, v => { im.alphaMode = v; rebuild(); }));
        const tint = el('input', { type: 'color', value: im.tint || '#ffffff', 'aria-label': 'Tint color' });
        tint.addEventListener('input', () => { im.tint = tint.value; rebuild(); });
        box.appendChild(el('label', { class: 'row' }, [el('span', { text: 'Tint' }), tint]));
        box.appendChild(slider('Tint strength', 0, 1, .01, im.tintStrength, v => v.toFixed(2), v => { im.tintStrength = v; rebuild(); }));
        box.appendChild(el('button', { type: 'button', class: 'btn danger', text: 'Remove layer', on: { click: () => { const s = scene(); s.layers = s.layers.filter(r => r.spec.id !== id); state.selected = s.layers.length ? s.layers[0].spec.id : null; markDirtyImages(); syncAll(); } } }));
    }

    /* ---------- images workspace ---------- */
    function buildAssets() {
        const box = $('assetList'); box.textContent = '';
        for (const a of ImageArtEngine.assets.values()) {
            const th = el('canvas', { width: 48, height: 48 });
            const t = th.getContext('2d'); const k = Math.max(48 / a.width, 48 / a.height);
            t.drawImage(a.source, (48 - a.width * k) / 2, (48 - a.height * k) / 2, a.width * k, a.height * k);
            const add = el('button', { type: 'button', class: 'btn', text: 'Add as layer', on: { click: () => addImageLayer(a.id) } });
            const saveLib = el('button', { type: 'button', class: 'btn', text: '★ Save', title: 'Save image to library', on: { click: () => onSaveAssetToLibrary(a.id) } });
            const rm = el('button', { type: 'button', class: 'btn danger', text: '✕', 'aria-label': 'Remove asset', on: { click: () => removeAsset(a.id) } });
            box.appendChild(el('div', { class: 'arow' }, [th, el('span', { class: 'ln', text: a.name + ' · ' + a.width + '×' + a.height }), add, saveLib, rm]));
        }
    }
    async function importFiles(files) {
        for (const f of files) {
            try { await ImageArtEngine.importFile(f); } catch (e) { console.warn(e); $('note').textContent = String(e.message || e); }
        }
        // convenience: first two imports populate the scene as two independent layers
        buildAssets();
        const s = state.scenes.images, ids = [...ImageArtEngine.assets.keys()];
        if (s && s.layers.length === 0 && ids.length) { addImageLayer(ids[0]); if (ids[1]) addImageLayer(ids[1]); }
    }
    function addImageLayer(assetId, overrides = {}) {
        const s = state.scenes.images; if (s.layers.length >= 6) { $('note').textContent = 'Six-layer limit.'; return; }
        const n = s.layers.length;
        const spec = Object.assign({
            id: 'image' + (++state.imgSeq || (state.imgSeq = 1)), name: 'Image ' + (n + 1) + ' · ' + ImageArtEngine.assets.get(assetId).name.slice(0, 18),
            visible: true, engine: 'image', z: n, proj: 'radial', folds: null,
            extent: n === 0 ? 'full' : .95, clip: n === 0 ? null : { inner: .16, outer: .95 },
            opacity: n === 0 ? 1 : .88, blend: 'source-over', dir: n % 2 ? 'ccw' : 'cw', speed: n === 0 ? .6 : .9, frozen: false,
            scale: 1, x: 0, y: 0, light: { mode: 'direct', strength: 0 }, pulse: { amount: 0, period: 20 }, orbit: { rx: 0, ry: 0, period: 120 }, sampleSpin: 0, params: {},
            image: { assetId, crop: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover', mirrorX: false, mirrorY: false, alphaMode: 'original', tint: null, tintStrength: 0, repeat: 'mirror-repeat', zoom: 1, panX: n === 0 ? 0 : .05 * n, panY: 0, tileR: 1.9, rot: n * 17 }
        }, overrides);
        if (overrides.image) Object.assign(spec.image, overrides.image);
        if (overrides.light) spec.light = Object.assign({}, overrides.light);
        if (overrides.clip) spec.clip = Object.assign({}, overrides.clip);
        if (overrides.pulse) spec.pulse = Object.assign({}, overrides.pulse);
        if (overrides.orbit) spec.orbit = Object.assign({}, overrides.orbit);
        const rt = C.makeRuntime(spec); s.layers.push(rt);
        markDirtyImages();
        state.selected = spec.id; syncAll();
        return rt;
    }
    function removeAsset(id) {
        const s = state.scenes.images;
        s.layers = s.layers.filter(r => !(r.spec.image && r.spec.image.assetId === id));
        ImageArtEngine.removeAsset(id);
        markDirtyImages();
        state.selected = s.layers.length ? s.layers[0].spec.id : null; syncAll();
    }

    /* ---------- wiring ---------- */
    function wire() {
        $('engineTabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => selectWorkspace(b.dataset.ws)));
        $('playBtn').addEventListener('click', () => setPlaying(!scene().playing));
        $('motionMul').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            $('motionVal').textContent = v.toFixed(2) + 'x';
            for (const k in state.scenes) if (state.scenes[k]) state.scenes[k].motionMultiplier = v;
            markDirtyImages();
        });
        $('sceneFolds').addEventListener('input', e => { const v = parseInt(e.target.value); $('foldsVal').textContent = v; scene().folds = v; markDirtyImages(); });
        $('lightSpeed').addEventListener('input', e => { const v = parseFloat(e.target.value); $('lightVal').textContent = v.toFixed(2); scene().light.speed = v; markDirtyImages(); });
        const lp = $('lightPreset'); World.rgbList.forEach(n => lp.appendChild(el('option', { value: n, text: n })));
        lp.addEventListener('change', () => { scene().light.preset = lp.value; World.setActiveRGB(lp.value); markDirtyImages(); });
        $('quality').addEventListener('change', e => { state.quality = e.target.value; resize(); renderNow(); });
        $('detail').addEventListener('change', e => { const s = scene(); s.detail = parseInt(e.target.value); });
        $('variation').addEventListener('click', () => { const s = state.scenes.native; if (!s) return; s.preset = Object.assign({}, s.preset, { id: s.preset.id, seed: s.preset.seed + 977 }); });
        $('shot').addEventListener('click', screenshot);

        const pSel = $('userPresetSelect');
        if (pSel) pSel.addEventListener('change', updatePresetUIButtons);
        if ($('savePresetBtn')) $('savePresetBtn').addEventListener('click', onSavePreset);
        if ($('loadPresetBtn')) $('loadPresetBtn').addEventListener('click', onLoadPreset);
        if ($('updatePresetBtn')) $('updatePresetBtn').addEventListener('click', onUpdatePreset);
        if ($('renamePresetBtn')) $('renamePresetBtn').addEventListener('click', onRenamePreset);
        if ($('deletePresetBtn')) $('deletePresetBtn').addEventListener('click', onDeletePreset);
        if ($('continueInFusionBtn')) $('continueInFusionBtn').addEventListener('click', onContinueInFusion);

        const sImgSel = $('savedImageSelect');
        if (sImgSel) sImgSel.addEventListener('change', updateSavedImageUIButtons);
        if ($('useImageSelectedLayerBtn')) $('useImageSelectedLayerBtn').addEventListener('click', onUseSavedImageInSelectedLayer);
        if ($('addImageAsLayerBtn')) $('addImageAsLayerBtn').addEventListener('click', onAddSavedImageAsLayer);
        if ($('renameSavedImageBtn')) $('renameSavedImageBtn').addEventListener('click', onRenameSavedImage);
        if ($('downloadSavedImageBtn')) $('downloadSavedImageBtn').addEventListener('click', onDownloadSavedImage);
        if ($('removeSavedImageBtn')) $('removeSavedImageBtn').addEventListener('click', onRemoveSavedImage);

        if ($('exportBackupBtn')) $('exportBackupBtn').addEventListener('click', onExportBackup);
        if ($('importBackupInput')) $('importBackupInput').addEventListener('change', e => {
            const f = e.target.files && e.target.files[0];
            if (f) onImportBackup(f);
            e.target.value = '';
        });
        function updateFab() {
            const isScrolled = window.scrollY > window.innerHeight * 0.35;
            const btn = $('hideBtn');
            if (!btn) return;
            if (isScrolled) {
                btn.textContent = '▲';
                btn.title = 'Scroll to artwork (or H to hide)';
            } else {
                btn.textContent = '☰';
                btn.title = 'Scroll to controls (or H to hide)';
            }
        }
        window.addEventListener('scroll', updateFab, { passive: true });
        $('hideBtn').addEventListener('click', () => {
            if (document.body.classList.contains('hide-ui')) {
                document.body.classList.remove('hide-ui');
                return;
            }
            const isScrolled = window.scrollY > window.innerHeight * 0.35;
            if (isScrolled) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                const p = $('panel');
                if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
        $('fileInput').addEventListener('change', e => { importFiles([...e.target.files]); e.target.value = ''; });
        window.addEventListener('dragover', e => { if (state.workspace === 'images') e.preventDefault(); });
        window.addEventListener('drop', e => { if (state.workspace === 'images') { e.preventDefault(); importFiles([...e.dataTransfer.files].filter(f => /^image\//.test(f.type))); } });
        window.addEventListener('keydown', e => {
            const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !(t.type === 'checkbox' || t.type === 'range') ) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (t && t.type === 'range') return;
            if (e.key === ' ' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); setPlaying(!scene().playing); }
            else if (e.key === 'h' || e.key === 'H') {
                const hiding = !document.body.classList.contains('hide-ui');
                document.body.classList.toggle('hide-ui', hiding);
                if (hiding) window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            else if (e.key === '[') stepSelection(-1); else if (e.key === ']') stepSelection(1);
            else if (e.key === 'd' || e.key === 'D') { state.stats.dbg = !state.stats.dbg; $('stats').classList.toggle('on', state.stats.dbg); }
        });
        document.body.dataset.workspace = 'native';
    }
    function setPlaying(v) {
        for (const k in state.scenes) if (state.scenes[k]) state.scenes[k].playing = v;
        state.playing = v; $('playBtn').textContent = v ? '❚❚ Pause' : '▶ Play'; $('playBtn').setAttribute('aria-pressed', String(!v));
    }
    function screenshot() {
        renderNow();
        canvas.toBlob(b => { const a = el('a', { href: URL.createObjectURL(b), download: 'anima-lab-' + (scene().id) + '.png' }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png');
    }

    /* ---------- user presets (My Images) ---------- */
    const getImagePresets = () => (typeof window !== 'undefined' && window.ImagePresets) || (typeof ImagePresets !== 'undefined' ? ImagePresets : null);

    async function refreshUserPresetsDropdown(selectedId) {
        const sel = $('userPresetSelect');
        const IP = getImagePresets();
        if (!sel || !IP) return;
        try {
            const presets = await IP.getAllPresets();
            sel.innerHTML = '<option value="">— Select Saved Preset —</option>';
            for (const p of presets) {
                const count = (p.scene && p.scene.layers ? p.scene.layers.length : 0);
                const opt = el('option', { value: p.id, text: `${p.name} (${count} layer${count === 1 ? '' : 's'})` });
                if (selectedId && p.id === selectedId) opt.selected = true;
                sel.appendChild(opt);
            }
            updatePresetUIButtons();
        } catch (e) {
            console.error('Failed to load presets list:', e);
        }
    }

    function updatePresetUIButtons() {
        const sel = $('userPresetSelect');
        const hasSel = !!(sel && sel.value);
        if ($('loadPresetBtn')) $('loadPresetBtn').disabled = !hasSel;
        if ($('presetActionsRow')) $('presetActionsRow').style.display = hasSel ? 'flex' : 'none';
    }

    async function onSavePreset() {
        const s = state.scenes.images;
        if (!s || !s.layers || s.layers.length === 0) {
            $('presetStatus').textContent = 'Add at least one image layer before saving.';
            return;
        }
        const defaultName = 'Preset ' + (new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        const name = window.prompt('Name this preset:', defaultName);
        if (name === null) return;
        try {
            const record = await ImagePresets.savePreset(name.trim() || 'Untitled Preset', s);
            state.dirtyImages = false;
            await refreshUserPresetsDropdown(record.id);
            $('presetStatus').textContent = `Saved preset "${record.name}".`;
        } catch (e) {
            console.error(e);
            $('presetStatus').textContent = 'Error saving preset: ' + e.message;
        }
    }

    async function onLoadPreset(overrideId) {
        const sel = $('userPresetSelect');
        const id = (typeof overrideId === 'string' && overrideId) ? overrideId : (sel && sel.value);
        if (!id) return;
        if (state.dirtyImages) {
            const proceed = window.confirm('You have unsaved edits in your current composition. Discard and load preset?');
            if (!proceed) return;
        }
        try {
            const s = state.scenes.images;
            const record = await ImagePresets.restorePreset(id, s);
            state.dirtyImages = false;
            state.selected = s.layers.length ? s.layers[0].spec.id : null;
            syncSceneControls();
            syncAll();
            renderNow();
            $('presetStatus').textContent = `Loaded preset "${record.name}".`;
        } catch (e) {
            console.error(e);
            $('presetStatus').textContent = 'Error loading preset: ' + e.message;
        }
    }

    async function onUpdatePreset() {
        const sel = $('userPresetSelect');
        const id = sel && sel.value;
        if (!id) return;
        const preset = await ImagePresets.getPreset(id);
        if (!preset) return;
        const ok = window.confirm(`Overwrite preset "${preset.name}" with current settings?`);
        if (!ok) return;
        try {
            const s = state.scenes.images;
            const updated = await ImagePresets.updatePreset(id, s);
            state.dirtyImages = false;
            await refreshUserPresetsDropdown(id);
            $('presetStatus').textContent = `Updated preset "${updated.name}".`;
        } catch (e) {
            console.error(e);
            $('presetStatus').textContent = 'Error updating preset: ' + e.message;
        }
    }

    async function onRenamePreset() {
        const sel = $('userPresetSelect');
        const id = sel && sel.value;
        if (!id) return;
        const preset = await ImagePresets.getPreset(id);
        if (!preset) return;
        const newName = window.prompt('Rename preset:', preset.name);
        if (newName === null) return;
        if (!newName.trim()) return;
        try {
            const updated = await ImagePresets.renamePreset(id, newName.trim());
            await refreshUserPresetsDropdown(id);
            $('presetStatus').textContent = `Renamed to "${updated.name}".`;
        } catch (e) {
            console.error(e);
            $('presetStatus').textContent = 'Error renaming preset: ' + e.message;
        }
    }

    async function onDeletePreset() {
        const sel = $('userPresetSelect');
        const id = sel && sel.value;
        if (!id) return;
        const preset = await ImagePresets.getPreset(id);
        if (!preset) return;
        const ok = window.confirm(`Delete preset "${preset.name}"? This cannot be undone.`);
        if (!ok) return;
        try {
            await ImagePresets.deletePreset(id);
            await refreshUserPresetsDropdown();
            $('presetStatus').textContent = `Deleted preset "${preset.name}".`;
        } catch (e) {
            console.error(e);
            $('presetStatus').textContent = 'Error deleting preset: ' + e.message;
        }
    }

    async function onContinueInFusion() {
        const s = scene();
        if (!s || !s.layers || s.layers.length === 0) {
            if ($('presetStatus')) $('presetStatus').textContent = 'Please add or select at least one layer before continuing in Fusion.';
            else window.alert('Please add or select at least one layer before continuing in Fusion.');
            return;
        }

        const IP = getImagePresets();
        if (!IP) {
            if ($('presetStatus')) $('presetStatus').textContent = 'Error: Preset storage engine unavailable.';
            return;
        }

        busy(true, 'Preparing Fusion handoff…');

        try {
            const transferAssetIds = [];
            const assetIdMap = new Map();

            // Store any unpersisted image assets safely in IndexedDB assets store
            for (const rt of s.layers) {
                const aId = rt.spec.image && rt.spec.image.assetId;
                if (aId && !assetIdMap.has(aId)) {
                    const rec = ImageArtEngine.assets.get(aId);
                    if (!rec) throw new Error('Asset not found in memory: ' + aId);
                    let sId = rec.storageId;
                    if (!sId) {
                        sId = await IP.storeAsset(rec);
                        rec.storageId = sId;
                        transferAssetIds.push(sId);
                    }
                    assetIdMap.set(aId, sId);
                }
            }

            // Snapshot layer specs with storageIds mapped
            const layersSnapshot = s.layers.map(rt => {
                const sp = JSON.parse(JSON.stringify(rt.spec));
                if (sp.image && sp.image.assetId) {
                    sp.image.storageId = assetIdMap.get(sp.image.assetId) || rt.spec.image.storageId;
                }
                return sp;
            });

            // Capture runtime phase state for Level 2 Phase Fidelity
            const layerStates = s.layers.map(rt => ({
                id: rt.spec.id,
                st: {
                    theta: rt.st ? rt.st.theta : 0,
                    orbit: rt.st ? rt.st.orbit : 0,
                    pulse: rt.st ? rt.st.pulse : 0,
                    spin: rt.st ? rt.st.spin : 0
                }
            }));

            const payload = {
                version: 1,
                timestamp: Date.now(),
                source: 'kaleidoscope-lab',
                workspace: state.workspace || 'images',
                sandboxOpticsEnabled: false,
                stage1Playing: s.playing !== false,
                scene: {
                    folds: s.folds,
                    motionMultiplier: s.motionMultiplier,
                    background: s.background || '#05060c',
                    light: Object.assign({}, s.light),
                    layers: layersSnapshot
                },
                runtime: {
                    time: s.time || 0,
                    activeRGBPreset: (s.light && s.light.preset) || 'chroma-spectrum',
                    layerStates: layerStates
                },
                transferAssetIds: transferAssetIds
            };

            sessionStorage.setItem('anima_fusion_handoff', JSON.stringify(payload));
            window.location.href = 'kaleidoscope-fusion.html';
        } catch (err) {
            console.error('Failed to prepare Continue in Fusion handoff:', err);
            busy(false);
            if ($('presetStatus')) {
                $('presetStatus').textContent = 'Handoff error: ' + err.message;
            } else {
                window.alert('Handoff error: ' + err.message);
            }
        }
    }

    /* ---------- saved images library ---------- */
    async function refreshSavedImagesDropdown(selectedId) {
        const sel = $('savedImageSelect');
        const IP = getImagePresets();
        if (!sel || !IP || !IP.getSavedImages) return;
        try {
            const list = await IP.getSavedImages();
            sel.innerHTML = '<option value="">— Select Saved Image —</option>';
            for (const img of list) {
                const opt = el('option', { value: img.id, text: `${img.name} (${img.width}×${img.height})` });
                if (img.isBundled) opt.setAttribute('data-bundled', '1');
                if (selectedId && img.id === selectedId) opt.selected = true;
                sel.appendChild(opt);
            }
            updateSavedImageUIButtons();
        } catch (e) {
            console.error('Failed to load saved images list:', e);
        }
    }

    function updateSavedImageUIButtons() {
        const sel = $('savedImageSelect');
        const hasSel = !!(sel && sel.value);
        const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
        const isBundled = !!(opt && opt.getAttribute('data-bundled') === '1');

        if ($('useImageSelectedLayerBtn')) $('useImageSelectedLayerBtn').disabled = !hasSel;
        if ($('addImageAsLayerBtn')) $('addImageAsLayerBtn').disabled = !hasSel;
        if ($('savedImageActionsRow')) {
            $('savedImageActionsRow').style.display = hasSel ? 'flex' : 'none';
            if ($('renameSavedImageBtn')) $('renameSavedImageBtn').style.display = isBundled ? 'none' : '';
            if ($('removeSavedImageBtn')) $('removeSavedImageBtn').style.display = isBundled ? 'none' : '';
        }
    }

    async function resolveSavedImageMemoryRecord(imgId) {
        if (!imgId) return null;
        const bundledList = (typeof window !== 'undefined' && window.AnimaBundledImages) || [];
        const bundled = bundledList.find(b => b.id === imgId);
        if (bundled) {
            for (const [memId, rec] of ImageArtEngine.assets.entries()) {
                if (rec.storageId === bundled.id) return rec;
            }
            const res = await fetch(bundled.dataUrl);
            const blob = await res.blob();
            const rec = await ImageArtEngine.importFile(blob);
            rec.name = bundled.name;
            rec.storageId = bundled.id;
            return rec;
        }

        const IP = getImagePresets();
        if (!IP) return null;

        for (const [memId, rec] of ImageArtEngine.assets.entries()) {
            if (rec.storageId === imgId) return rec;
        }

        const assetRec = await IP.getAsset(imgId);
        if (!assetRec || !assetRec.blob) throw new Error('Image asset not found in storage: ' + imgId);
        const memRec = await ImageArtEngine.importFile(assetRec.blob);
        memRec.name = assetRec.libraryName || assetRec.name || 'image';
        memRec.storageId = imgId;
        return memRec;
    }

    async function onAddSavedImageAsLayer() {
        const sel = $('savedImageSelect');
        const id = sel && sel.value;
        if (!id) return;
        try {
            const rec = await resolveSavedImageMemoryRecord(id);
            if (!rec) return;
            addImageLayer(rec.id);
            buildAssets();
            $('savedImageStatus').textContent = `Added layer using "${rec.name}".`;
        } catch (e) {
            console.error(e);
            $('savedImageStatus').textContent = 'Error adding layer: ' + e.message;
        }
    }

    async function onUseSavedImageInSelectedLayer() {
        const sel = $('savedImageSelect');
        const id = sel && sel.value;
        if (!id) return;
        try {
            const rec = await resolveSavedImageMemoryRecord(id);
            if (!rec) return;
            const s = state.scenes.images;
            if (!s.layers.length) {
                addImageLayer(rec.id);
            } else {
                const rt = selLayer();
                if (rt && rt.spec.image) {
                    rt.spec.image.assetId = rec.id;
                    const baseName = rt.spec.name.split('·')[0].trim() || 'Image';
                    rt.spec.name = `${baseName} · ${rec.name.slice(0, 18)}`;
                    markDirtyImages();
                    syncAll();
                    renderNow();
                } else {
                    addImageLayer(rec.id);
                }
            }
            buildAssets();
            $('savedImageStatus').textContent = `Updated layer with "${rec.name}".`;
        } catch (e) {
            console.error(e);
            $('savedImageStatus').textContent = 'Error updating layer: ' + e.message;
        }
    }

    async function onSaveAssetToLibrary(assetId) {
        const a = ImageArtEngine.assets.get(assetId);
        if (!a || !a.blob) return;
        const IP = getImagePresets();
        if (!IP || !IP.saveImageToLibrary) return;
        const defaultName = a.name ? a.name.replace(/\.[^.]+$/, '') : 'Saved Image';
        const name = window.prompt('Name this image for your library:', defaultName);
        if (name === null) return;
        try {
            const rec = await IP.saveImageToLibrary(name.trim() || defaultName, a.blob, { width: a.width, height: a.height });
            a.storageId = rec.id;
            await refreshSavedImagesDropdown(rec.id);
            $('savedImageStatus').textContent = `Saved "${rec.libraryName || rec.name}" to library.`;
        } catch (e) {
            console.error(e);
            $('savedImageStatus').textContent = 'Error saving to library: ' + e.message;
        }
    }

    async function onRenameSavedImage() {
        const sel = $('savedImageSelect');
        const id = sel && sel.value;
        if (!id) return;
        const IP = getImagePresets();
        if (!IP || !IP.getAsset) return;
        const asset = await IP.getAsset(id);
        if (!asset) return;
        const newName = window.prompt('Rename saved image:', asset.libraryName || asset.name);
        if (newName === null || !newName.trim()) return;
        try {
            const updated = await IP.renameLibraryImage(id, newName.trim());
            await refreshSavedImagesDropdown(id);
            $('savedImageStatus').textContent = `Renamed to "${updated.libraryName}".`;
        } catch (e) {
            console.error(e);
            $('savedImageStatus').textContent = 'Error renaming: ' + e.message;
        }
    }

    async function onDownloadSavedImage() {
        const sel = $('savedImageSelect');
        const id = sel && sel.value;
        if (!id) return;
        const bundledList = (typeof window !== 'undefined' && window.AnimaBundledImages) || [];
        const bundled = bundledList.find(b => b.id === id);
        if (bundled) {
            const a = el('a', { href: bundled.dataUrl, download: bundled.fileName || 'graphene.png' });
            a.click();
            return;
        }
        const IP = getImagePresets();
        if (!IP) return;
        const asset = await IP.getAsset(id);
        if (!asset || !asset.blob) return;
        const ext = asset.type === 'image/avif' ? '.avif' : asset.type === 'image/jpeg' ? '.jpg' : asset.type === 'image/webp' ? '.webp' : '.png';
        const filename = (asset.libraryName || asset.name || 'image').replace(/\.[^.]+$/, '') + ext;
        const url = URL.createObjectURL(asset.blob);
        const a = el('a', { href: url, download: filename });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function onRemoveSavedImage() {
        const sel = $('savedImageSelect');
        const id = sel && sel.value;
        if (!id) return;
        const IP = getImagePresets();
        if (!IP || !IP.getAsset) return;
        const asset = await IP.getAsset(id);
        if (!asset) return;
        const ok = window.confirm(`Remove "${asset.libraryName || asset.name}" from your library?`);
        if (!ok) return;
        try {
            const res = await IP.removeLibraryImage(id);
            await refreshSavedImagesDropdown();
            $('savedImageStatus').textContent = `Removed "${asset.libraryName || asset.name}" from library.` + (res.preservedForPresets ? ' (Preserved for presets)' : '');
        } catch (e) {
            console.error(e);
            $('savedImageStatus').textContent = 'Error removing from library: ' + e.message;
        }
    }

    /* ---------- backup / restore ---------- */
    async function onExportBackup() {
        const IP = getImagePresets();
        if (!IP || !IP.exportBackup) return;
        try {
            const b = await IP.exportBackup();
            $('presetStatus').textContent = `Exported backup (${b.presetsCount} presets, ${b.assetsCount} images).`;
        } catch (e) {
            console.error(e);
            $('presetStatus').textContent = 'Error exporting backup: ' + e.message;
        }
    }

    async function onImportBackup(file) {
        const IP = getImagePresets();
        if (!IP || !IP.importBackup) return;
        try {
            const text = await new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onload = () => res(fr.result);
                fr.onerror = () => rej(new Error('Failed to read file'));
                fr.readAsText(file);
            });
            const json = JSON.parse(text);
            const res = await IP.importBackup(json);
            await refreshUserPresetsDropdown();
            await refreshSavedImagesDropdown();
            $('presetStatus').textContent = `Imported ${res.importedPresets} presets and ${res.importedAssets} images.`;
        } catch (e) {
            console.error(e);
            $('presetStatus').textContent = 'Error importing backup: ' + e.message;
        }
    }

    /* ---------- collapsible sections memory ---------- */
    function initCollapsibleSections() {
        const key = 'anima_lab_section_states';
        let saved = {};
        try {
            const raw = localStorage.getItem(key);
            if (raw) saved = JSON.parse(raw);
        } catch (e) {}
        const groups = document.querySelectorAll('aside#panel details.sec-group[data-sec]');
        groups.forEach(details => {
            const secId = details.dataset.sec;
            if (!secId) return;
            if (saved && typeof saved[secId] === 'boolean') {
                details.open = saved[secId];
            }
            details.addEventListener('toggle', () => {
                saved[secId] = details.open;
                try {
                    localStorage.setItem(key, JSON.stringify(saved));
                } catch (e) {}
            });
        });
    }

    /* ---------- boot ---------- */
    function boot() {
        if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
        window.scrollTo(0, 0);
        wire();
        initCollapsibleSections();
        refreshUserPresetsDropdown();
        refreshSavedImagesDropdown();
        const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        state.playing = !reduce && qs.get('still') !== '1';
        $('playBtn').textContent = state.playing ? '❚❚ Pause' : '▶ Play';
        resize();
        state.scenes.images = buildScene(IMAGES_PRESET, 'images');
        if (qs.get('ui') === '0') document.body.classList.add('hide-ui');
        if (qs.get('stats') === '1') { state.stats.dbg = true; $('stats').classList.add('on'); }
        const pid = qs.get('preset') || 'cathedral';
        if (qs.get('folds')) { /* applied after load */ }
        loadPreset(pid, {
            done() {
                const f = parseInt(qs.get('folds')); if (f >= 2 && f <= 24) { scene().folds = f; $('sceneFolds').value = f; $('foldsVal').textContent = f; }
                const t = parseFloat(qs.get('t'));
                if (t > 0) { const sc = scene(), was = sc.playing; sc.playing = true; const n = Math.ceil(t / .25); for (let i = 0; i < n; i++) C.advanceScene(sc, .25); sc.playing = was; if (C.sceneUsesLight(sc)) { World.update(t * .6, sc.light.speed); World.render(lightCtx, 256, 256); frame.lightRev++; } }
                $('sceneFolds').value = scene().folds; $('foldsVal').textContent = scene().folds;
                const m = scene().motionMultiplier != null ? scene().motionMultiplier : 1.0;
                $('motionMul').value = Math.min(3, Math.max(0, m)); $('motionVal').textContent = m.toFixed(2) + 'x';
                $('lightSpeed').value = scene().light.speed; $('lightVal').textContent = scene().light.speed.toFixed(2);
                $('lightPreset').value = scene().light.preset;
                document.body.dataset.ready = '1';
            }
        });
        state.playing ? setPlaying(true) : setPlaying(false);
        requestAnimationFrame(loop);
    }

    /* test / verification hooks */
    window.AnimaLab = {
        get state() { return state; }, get scene() { return scene(); },
        compositor: C, loadPreset, selectWorkspace, patchLayer, setPlaying, renderNow, importFiles, addImageLayer, resize, syncAll,
        step(dt, n) { const s = scene(); for (let i = 0; i < (n || 1); i++) { C.advanceScene(s, dt); } updateLight(dt); renderNow(); },
        ready() { return document.body.dataset.ready === '1'; },
        // Synchronous capture point: no await between phase/light/image snapshots.
        captureOfflineSnapshot() {
            return AnimaOfflineRenderer.capture(scene(), {
                kind: 'lab', lightAcc: state.lightAcc, frame, world: World.getState()
            });
        },
        get imagePresets() { return getImagePresets(); },
        refreshUserPresetsDropdown,
        refreshSavedImagesDropdown,
        resolveSavedImageMemoryRecord,
        syncSceneControls,
        continueInFusion: onContinueInFusion
    };

    boot();
})();
