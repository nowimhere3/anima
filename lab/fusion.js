/* ============================================================
   ANIMA FUSION — Two-Stage Live Kaleidoscope Pipeline
   Stage 1: Art Lab (My Images + RPG World Light) -> stage1Canvas
   Bridge : stage1Canvas -> sourceCanvas + flippedCanvas
   Stage 2: Sandbox OpticalEngine (Pass-Through RGB) -> #fusionCanvas
   ============================================================ */
(function () {
    "use strict";
    const C = LabCompositor;
    const $ = id => document.getElementById(id);
    const qs = new URLSearchParams(location.search);

    /* ---------- Canvases ---------- */
    const fusionCanvas = $('fusionCanvas');
    const fusionCtx = fusionCanvas ? fusionCanvas.getContext('2d') : null;
    const stage1PreviewCanvas = $('stage1PreviewCanvas');
    const stage1PreviewCtx = stage1PreviewCanvas ? stage1PreviewCanvas.getContext('2d') : null;

    const stage1Canvas = document.createElement('canvas');
    stage1Canvas.width = 512;
    stage1Canvas.height = 512;
    const stage1Ctx = stage1Canvas.getContext('2d', { alpha: true });

    const sourceCanvas = document.createElement('canvas');
    const sourceCtx = sourceCanvas.getContext('2d', { alpha: true });

    const flippedCanvas = document.createElement('canvas');
    const flippedCtx = flippedCanvas.getContext('2d', { alpha: true });

    const lightCanvas = document.createElement('canvas');
    lightCanvas.width = lightCanvas.height = 256;
    const lightCtx = lightCanvas.getContext('2d');

    /* ---------- State ---------- */
    const state = {
        activeTab: 'source',
        sandboxOpticsEnabled: false,
        scene: null,
        selected: null,
        stage1Size: 512,
        stage1Playing: true,
        stage2Playing: true,
        stage1Dirty: true,
        stage2NeedsRender: true,
        dirtyImages: false,
        lightAcc: 0,
        building: 0,
        W: 800,
        H: 600,
        tileSize: 160,
        sandbox: {
            mode: 'kaleido-rings',
            numTiles: 5,
            radialFolds: 6,
            ringCount: 6,
            speed: 1.0,
            orbitRate: 1.0,
            orbitAmount: 0.35,
            spinRate: 1.0,
            ringRate: 1.0,
            ringBreath: 0.025
        },
        stats: { work: [], s1Work: [], s2Work: [], frames: 0, fps: 60, lastFpsTs: 0, framesSinceFps: 0, dbg: false }
    };

    const frame = { lightCanvas, lightRev: 0 };
    const LIGHT_HZ = 20;

    const IMAGES_PRESET = {
        id: 'images', name: 'My Images', folds: 8, detail: 0, seed: 1,
        palette: ['#0a0a12', '#3a3a5a', '#7a7a9a', '#caa860', '#fff4d8'],
        metal: '#caa860', lead: '#0a0a10', leadW: .006,
        background: '#05060c',
        light: { preset: 'chroma-spectrum', speed: .5 },
        layers: []
    };

    const scene = () => state.scene;
    const markStage1Dirty = (markPresetUnsaved) => {
        state.stage1Dirty = true;
        state.stage2NeedsRender = true;
        if (markPresetUnsaved) state.dirtyImages = true;
    };

    function busy(on, msg) {
        state.building += on ? 1 : -1;
        if ($('busy')) {
            $('busy').textContent = msg || 'Preparing…';
            $('busy').classList.toggle('on', state.building > 0);
        }
    }

    /* ---------- Sizing & Bridge ---------- */
    function pickDisplayQ(W, H) {
        const dpr = window.devicePixelRatio || 1;
        const px = W * H;
        return Math.max(0.5, Math.min(dpr, 1.25, Math.sqrt(2.2e6 / px)));
    }

    function syncDirectStage1Layout() {
        const W = state.W;
        const H = state.H;
        const q = (fusionCanvas.width && W) ? (fusionCanvas.width / W) : 1;
        if (state.scene) {
            C.layout(state.scene, W, H, q);
        }
        state.stage1Dirty = true;
    }

    function syncStage1Layout() {
        const sz = state.stage1Size;
        if (stage1Canvas.width !== sz || stage1Canvas.height !== sz) {
            stage1Canvas.width = sz;
            stage1Canvas.height = sz;
        }
        if (state.scene) {
            C.layout(state.scene, sz, sz, 1);
        }
        state.stage1Dirty = true;
        state.stage2NeedsRender = true;
    }

    function syncBridgeSize() {
        const displayW = fusionCanvas.width || 800;
        const rawTile = Math.ceil(displayW / Math.max(2, state.sandbox.numTiles));
        // Classic mode relies on source dimensions to size triangular tessellations.
        // Radial, Rings, and Kaleido-Rings use full Stage 1 resolution for maximum clarity without downsampling blur.
        const tileSize = state.sandbox.mode === 'classic'
            ? Math.max(64, Math.min(state.stage1Size, rawTile))
            : state.stage1Size;
        state.tileSize = tileSize;
        if (sourceCanvas.width !== tileSize || sourceCanvas.height !== tileSize) {
            sourceCanvas.width = tileSize;
            sourceCanvas.height = tileSize;
            flippedCanvas.width = tileSize;
            flippedCanvas.height = tileSize;
        }
        state.stage1Dirty = true;
        state.stage2NeedsRender = true;
    }

    function resize() {
        const W = Math.max(320, window.innerWidth);
        const H = Math.max(240, window.innerHeight);
        const q = pickDisplayQ(W, H);
        const cw = Math.round(W * q);
        const ch = Math.round(H * q);
        state.W = W;
        state.H = H;
        if (fusionCanvas.width !== cw || fusionCanvas.height !== ch) {
            fusionCanvas.width = cw;
            fusionCanvas.height = ch;
        }
        OpticalEngine.setCanvasSize(cw, ch);
        OpticalEngine.setNumTiles(state.sandbox.numTiles);
        syncBridgeSize();

        if (!state.sandboxOpticsEnabled) {
            syncDirectStage1Layout();
        } else {
            syncStage1Layout();
        }
    }

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { resize(); renderNow(); }, 100);
    });

    /* ---------- Stage 1 Light Field (World, once per frame) ---------- */
    function updateLight(dt) {
        const s = scene();
        if (!s || !C.sceneUsesLight(s)) return;
        World.update(dt * 0.6, s.light.speed);
        state.lightAcc += dt;
        if (state.lightAcc >= 1 / LIGHT_HZ || !frame.lightRev) {
            state.lightAcc = 0;
            World.render(lightCtx, 256, 256);
            frame.lightRev++;
        }
    }

    /* ---------- Bridge Blit (Stage 1 -> Stage 2 Source + Flipped) ---------- */
    function updateBridgeCanvases() {
        const ts = state.tileSize;
        sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
        sourceCtx.globalCompositeOperation = 'source-over';
        sourceCtx.imageSmoothingEnabled = true;
        sourceCtx.imageSmoothingQuality = 'high';
        sourceCtx.clearRect(0, 0, ts, ts);
        sourceCtx.drawImage(stage1Canvas, 0, 0, ts, ts);

        flippedCtx.setTransform(1, 0, 0, 1, 0, 0);
        flippedCtx.globalCompositeOperation = 'source-over';
        flippedCtx.imageSmoothingEnabled = true;
        flippedCtx.imageSmoothingQuality = 'high';
        flippedCtx.clearRect(0, 0, ts, ts);
        flippedCtx.save();
        flippedCtx.translate(ts, 0);
        flippedCtx.scale(-1, 1);
        flippedCtx.drawImage(sourceCanvas, 0, 0);
        flippedCtx.restore();

        if (stage1PreviewCtx) {
            stage1PreviewCtx.clearRect(0, 0, 64, 64);
            stage1PreviewCtx.drawImage(stage1Canvas, 0, 0, 64, 64);
        }
    }

    /* ---------- Render & Tick ---------- */
    function renderDirectStage1Now() {
        const s = scene();
        if (!s || !fusionCtx) return;
        if (C.sceneUsesLight(s) && !frame.lightRev) updateLight(0);
        C.prepareScene(s, frame);
        C.renderScene(s, fusionCtx, frame);
        state.stage1Dirty = false;
        if (stage1PreviewCtx) {
            stage1PreviewCtx.clearRect(0, 0, 64, 64);
            stage1PreviewCtx.drawImage(fusionCanvas, 0, 0, 64, 64);
        }
    }

    function renderStage1Now() {
        const s = scene();
        if (!s) return;
        if (C.sceneUsesLight(s) && !frame.lightRev) updateLight(0);
        C.prepareScene(s, frame);
        C.renderScene(s, stage1Ctx, frame);
        updateBridgeCanvases();
        state.stage1Dirty = false;
        state.stage2NeedsRender = true;
    }

    function renderStage2Now(dt) {
        const stepDt = Number.isFinite(dt) ? dt : 0;
        OpticalEngine.renderFrame(sourceCanvas, flippedCanvas, stepDt);
        state.stage2NeedsRender = false;
    }

    function renderNow() {
        if (!state.sandboxOpticsEnabled) {
            renderDirectStage1Now();
        } else {
            renderStage1Now();
            renderStage2Now(0);
        }
    }

    function setSandboxOpticsEnabled(enabled) {
        state.sandboxOpticsEnabled = !!enabled;
        if (state.sandboxOpticsEnabled) {
            syncStage1Layout();
            syncBridgeSize();
            state.stage1Dirty = true;
            state.stage2NeedsRender = true;
        } else {
            syncDirectStage1Layout();
            state.stage1Dirty = true;
        }
        updateOpticsToggleUI();
        renderNow();
    }

    function updateOpticsToggleUI() {
        const on = !!state.sandboxOpticsEnabled;
        const btn = $('sandboxOpticsToggleBtn');
        if (btn) {
            btn.innerHTML = `<span class="optics-toggle-indicator">${on ? '●' : '○'}</span> Sandbox Optics: ${on ? 'ON' : 'OFF'}`;
            btn.classList.toggle('optics-on', on);
            btn.classList.toggle('optics-off', !on);
            btn.setAttribute('aria-pressed', String(on));
        }
        const status = $('opticsModeStatus');
        if (status) {
            status.textContent = on ? 'Fusion — Sandbox optics active' : 'Pure Art Lab — Sandbox optics bypassed';
        }
        const inlineBtn = $('stage2OpticsInlineToggleBtn');
        if (inlineBtn) {
            inlineBtn.textContent = on ? 'Bypass Sandbox Optics (Art Lab View)' : 'Enable Sandbox Optics';
            inlineBtn.classList.toggle('optics-on', on);
        }
        const meta = $('stageMonitorMeta');
        if (meta) {
            meta.textContent = on
                ? 'Stage 1 (Art Lab) continuously feeds Stage 2 (Sandbox Optics) every frame.'
                : 'Sandbox optics bypassed — Stage 1 renders directly at full viewport resolution.';
        }
    }

    function tick(dt) {
        const s = scene();
        if (!s) return;

        const tS1Start = performance.now();
        if (state.stage1Playing) {
            s.playing = true;
            C.advanceScene(s, dt);
            updateLight(dt);
            state.stage1Dirty = true;
        } else {
            s.playing = false;
            if (C.sceneUsesLight(s) && !frame.lightRev) {
                updateLight(0);
                state.stage1Dirty = true;
            }
        }

        if (!state.sandboxOpticsEnabled) {
            if (state.stage1Dirty) {
                renderDirectStage1Now();
            }
        } else {
            if (state.stage1Dirty) {
                renderStage1Now();
            }
        }
        const tS1 = performance.now() - tS1Start;

        const tS2Start = performance.now();
        if (state.sandboxOpticsEnabled) {
            if (state.stage2Playing || state.stage2NeedsRender) {
                renderStage2Now(state.stage2Playing ? dt : 0);
            }
        }
        const tS2 = performance.now() - tS2Start;

        const st = state.stats;
        st.s1Work.push(tS1); if (st.s1Work.length > 240) st.s1Work.shift();
        st.s2Work.push(tS2); if (st.s2Work.length > 240) st.s2Work.shift();
    }

    let last = 0;
    function loop(ts) {
        const t0 = performance.now();
        if (!last) last = ts;
        const dt = Math.min(0.1, Math.max(0, (ts - last) / 1000));
        last = ts;

        if (!state.building) tick(dt);

        const w = performance.now() - t0;
        const st = state.stats;
        st.work.push(w); if (st.work.length > 240) st.work.shift();
        st.frames++;
        st.framesSinceFps++;
        if (!st.lastFpsTs) st.lastFpsTs = ts;
        else if (ts - st.lastFpsTs >= 500) {
            st.fps = Math.round((st.framesSinceFps * 1000) / (ts - st.lastFpsTs));
            st.framesSinceFps = 0;
            st.lastFpsTs = ts;
        }
        if (st.dbg && st.frames % 15 === 0) updateStats();
        requestAnimationFrame(loop);
    }
    document.addEventListener('visibilitychange', () => { last = 0; });

    function updateStats() {
        const st = state.stats;
        const a = st.work.slice().sort((x, y) => x - y);
        const p95 = a.length ? a[Math.floor(a.length * 0.95)] : 0;
        const s1Avg = st.s1Work.length ? (st.s1Work.reduce((x, y) => x + y, 0) / st.s1Work.length) : 0;
        const s2Avg = st.s2Work.length ? (st.s2Work.reduce((x, y) => x + y, 0) / st.s2Work.length) : 0;
        $('stats').textContent = `${st.fps} fps · p95 ${p95.toFixed(1)}ms (S1 ${s1Avg.toFixed(1)}ms + S2 ${s2Avg.toFixed(1)}ms) · S1 ${state.stage1Size}² → Tile ${state.tileSize}² → S2 ${fusionCanvas.width}×${fusionCanvas.height}`;
    }

    /* ---------- Playback Controls ---------- */
    function updateTransportUI() {
        const s1 = state.stage1Playing;
        const s2 = state.stage2Playing;
        const b1 = $('stage1PlayBtn');
        const b2 = $('stage2PlayBtn');
        const bm = $('masterPlayBtn');
        if (b1) {
            b1.textContent = s1 ? '❚❚ Stage 1: Playing' : '▶ Stage 1: Paused';
            b1.setAttribute('aria-pressed', String(!s1));
            b1.classList.toggle('stage-on', s1);
            b1.classList.toggle('stage-paused', !s1);
        }
        if (b2) {
            b2.textContent = s2 ? '❚❚ Stage 2: Playing' : '▶ Stage 2: Paused';
            b2.setAttribute('aria-pressed', String(!s2));
            b2.classList.toggle('stage-on', s2);
            b2.classList.toggle('stage-paused', !s2);
        }
        if (bm) {
            const anyPlaying = s1 || s2;
            bm.textContent = anyPlaying ? '❚❚ Pause Both' : '▶ Play Both';
            bm.setAttribute('aria-pressed', String(!anyPlaying));
        }
        const meta = $('stageMonitorMeta');
        if (meta) {
            const s1Txt = s1 ? 'Stage 1 animating' : 'Stage 1 paused';
            const s2Txt = s2 ? `Stage 2 (${state.sandbox.mode}) animating` : `Stage 2 (${state.sandbox.mode}) paused`;
            meta.textContent = `${s1Txt} · ${s2Txt} · Source ${state.stage1Size}×${state.stage1Size}`;
        }
    }

    function setStage1Playing(v) {
        state.stage1Playing = !!v;
        if (state.scene) state.scene.playing = state.stage1Playing;
        if (state.stage1Playing) state.stage1Dirty = true;
        updateTransportUI();
    }

    function setStage2Playing(v) {
        state.stage2Playing = !!v;
        if (state.stage2Playing) state.stage2NeedsRender = true;
        updateTransportUI();
    }

    function setBothPlaying(v) {
        setStage1Playing(v);
        setStage2Playing(v);
    }

    /* ---------- Engine Tab Switching ---------- */
    function selectTab(tabName) {
        if (tabName !== 'source' && tabName !== 'optics') return;
        state.activeTab = tabName;
        document.body.dataset.ftab = tabName;
        document.querySelectorAll('#fusionTabs button').forEach(b => {
            b.setAttribute('aria-selected', String(b.dataset.ftab === tabName));
        });
    }

    /* ---------- Stage 1 Scene Setup & Sync ---------- */
    function buildStage1Scene() {
        const s = C.createScene(IMAGES_PRESET, { workspace: 'images' });
        if (!state.sandboxOpticsEnabled) {
            const q = (fusionCanvas.width && state.W) ? (fusionCanvas.width / state.W) : 1;
            C.layout(s, state.W || 800, state.H || 600, q);
        } else {
            C.layout(s, state.stage1Size, state.stage1Size, 1);
        }
        s.playing = state.stage1Playing;
        s.motionMultiplier = parseFloat($('motionMul').value) || 1.0;
        return s;
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
        if ($('stage1Bg')) { $('stage1Bg').value = s.background === 'transparent' ? 'transparent' : '#05060c'; }
        if (s.light) {
            if ($('lightPreset') && s.light.preset) {
                $('lightPreset').value = s.light.preset;
                World.setActiveRGB(s.light.preset);
            }
            if ($('lightSpeed') && s.light.speed != null) {
                $('lightSpeed').value = s.light.speed;
                $('lightVal').textContent = Number(s.light.speed).toFixed(2);
            }
        }
    }

    function syncSandboxControls() {
        const sb = state.sandbox;
        if ($('symmetryMode')) $('symmetryMode').value = sb.mode;
        if ($('numTilesInput')) $('numTilesInput').value = sb.numTiles;
        if ($('numTilesNumberInput')) $('numTilesNumberInput').value = sb.numTiles;
        if ($('radialFolds')) { $('radialFolds').value = sb.radialFolds; $('radialFoldsVal').textContent = sb.radialFolds; }
        if ($('ringCount')) { $('ringCount').value = sb.ringCount; $('ringCountVal').textContent = sb.ringCount; }
        if ($('sandboxSpeed')) {
            const sp = sb.speed != null ? sb.speed : 1.0;
            $('sandboxSpeed').value = Math.min(3, Math.max(0, sp));
            $('sandboxSpeedVal').textContent = sp.toFixed(2) + 'x';
        }
        if ($('sandboxOrbitRate')) { $('sandboxOrbitRate').value = sb.orbitRate; $('sandboxOrbitRateVal').textContent = sb.orbitRate.toFixed(2) + '×'; }
        if ($('sandboxOrbitAmount')) { $('sandboxOrbitAmount').value = sb.orbitAmount; $('sandboxOrbitAmountVal').textContent = sb.orbitAmount.toFixed(2); }
        if ($('sandboxSpinRate')) { $('sandboxSpinRate').value = sb.spinRate; $('sandboxSpinRateVal').textContent = sb.spinRate.toFixed(2) + '×'; }
        if ($('sandboxRingRate')) { $('sandboxRingRate').value = sb.ringRate; $('sandboxRingRateVal').textContent = sb.ringRate.toFixed(2) + '×'; }
        if ($('sandboxRingBreath')) { $('sandboxRingBreath').value = sb.ringBreath; $('sandboxRingBreathVal').textContent = sb.ringBreath.toFixed(3); }
    }

    function applySandboxStateToEngine() {
        const sb = state.sandbox;
        OpticalEngine.setSymmetryMode(sb.mode);
        OpticalEngine.setNumTiles(sb.numTiles);
        OpticalEngine.setRadialFolds(sb.radialFolds);
        OpticalEngine.setRingCount(sb.ringCount);
        OpticalEngine.setSpeed(sb.speed);
        if (OpticalEngine.setOrbitRate) OpticalEngine.setOrbitRate(sb.orbitRate);
        if (OpticalEngine.setOrbitAmount) OpticalEngine.setOrbitAmount(sb.orbitAmount);
        if (OpticalEngine.setSpinRate) OpticalEngine.setSpinRate(sb.spinRate);
        if (OpticalEngine.setRingRate) OpticalEngine.setRingRate(sb.ringRate);
        if (OpticalEngine.setRingBreath) OpticalEngine.setRingBreath(sb.ringBreath);
        syncBridgeSize();
        updateTransportUI();
    }

    function resetSandboxDefaults() {
        Object.assign(state.sandbox, {
            mode: 'kaleido-rings',
            numTiles: 5,
            radialFolds: 6,
            ringCount: 6,
            speed: 1.0,
            orbitRate: 1.0,
            orbitAmount: 0.35,
            spinRate: 1.0,
            ringRate: 1.0,
            ringBreath: 0.025
        });
        syncSandboxControls();
        applySandboxStateToEngine();
        renderStage2Now(0);
    }

    /* ---------- Layer Editing (never resets phases) ---------- */
    const selLayer = () => { const s = scene(); return s && s.layers.find(r => r.spec.id === state.selected); };

    function patchLayer(id, partial) {
        const s = scene();
        const rt = s && s.layers.find(r => r.spec.id === id);
        if (!rt) return;
        markStage1Dirty(true);
        for (const k in partial) {
            const v = partial[k];
            if (v && typeof v === 'object' && !Array.isArray(v) && rt.spec[k] && typeof rt.spec[k] === 'object') {
                Object.assign(rt.spec[k], v);
            } else {
                rt.spec[k] = v;
            }
        }
    }

    /* ---------- UI Builders ---------- */
    function el(tag, attrs, kids) {
        const e = document.createElement(tag);
        for (const k in (attrs || {})) {
            if (k === 'text') e.textContent = attrs[k];
            else if (k === 'on') for (const ev in attrs.on) e.addEventListener(ev, attrs.on[ev]);
            else e.setAttribute(k, attrs[k]);
        }
        for (const c of (kids || [])) e.appendChild(c);
        return e;
    }

    function slider(label, min, max, step, value, fmt, onInput, id) {
        const out = el('output', { text: fmt(value) });
        const inp = el('input', { type: 'range', min, max, step, value, 'aria-label': label });
        if (id) inp.id = id;
        inp.addEventListener('input', () => {
            const v = parseFloat(inp.value);
            out.textContent = fmt(v);
            onInput(v);
        });
        return el('label', { class: 'row' }, [el('span', { text: label }), inp, out]);
    }

    function select(label, opts, value, onChange, id) {
        const sel = el('select', { 'aria-label': label });
        if (id) sel.id = id;
        for (const [v, t] of opts) {
            const o = el('option', { value: v, text: t });
            if (String(v) === String(value)) o.selected = true;
            sel.appendChild(o);
        }
        sel.addEventListener('change', () => onChange(sel.value));
        return el('label', { class: 'row' }, [el('span', { text: label }), sel]);
    }

    function seg(label, opts, value, onPick) {
        const wrap = el('div', { class: 'seg', role: 'group', 'aria-label': label });
        for (const [v, t] of opts) {
            const b = el('button', { type: 'button', text: t, 'aria-pressed': String(v === value) });
            b.addEventListener('click', () => {
                onPick(v);
                wrap.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            });
            wrap.appendChild(b);
        }
        return el('div', { class: 'row' }, [el('span', { text: label }), wrap]);
    }

    function check(label, value, onChange, id) {
        const i = el('input', { type: 'checkbox' });
        i.checked = !!value;
        if (id) i.id = id;
        i.addEventListener('change', () => onChange(i.checked));
        return el('label', { class: 'row chk' }, [i, el('span', { text: label })]);
    }

    function syncAll() {
        buildLayerList();
        buildInspector();
        buildAssets();
        const s = scene();
        $('emptyMsg').classList.toggle('on', !(s && s.layers.length));
        updateTransportUI();
    }

    function buildLayerList() {
        const box = $('layerList');
        if (!box) return;
        box.textContent = '';
        const s = scene();
        if (!s) return;
        const rows = s.layers.slice().reverse();
        for (const rt of rows) {
            const sp = rt.spec;
            const dirTxt = sp.frozen ? '❄' : sp.dir === 'cw' ? '↻' : sp.dir === 'ccw' ? '↺' : '•';
            const row = el('div', {
                class: 'lrow' + (sp.id === state.selected ? ' sel' : ''),
                'data-layer-id': sp.id,
                tabindex: '0',
                role: 'option',
                'aria-selected': String(sp.id === state.selected)
            });
            const vis = el('input', { type: 'checkbox', 'aria-label': 'Visible: ' + sp.name });
            vis.checked = sp.visible;
            vis.addEventListener('click', e => e.stopPropagation());
            vis.addEventListener('change', () => { sp.visible = vis.checked; markStage1Dirty(true); });
            row.appendChild(vis);
            row.appendChild(el('span', { class: 'ln', text: sp.name }));
            row.appendChild(el('span', { class: 'ld', text: dirTxt, title: 'direction' }));
            const isLit = sp.light && (sp.light.mode === 'light' || sp.light.mode === 'backlight' || sp.light.mode === 'both') && sp.light.strength > 0;
            row.appendChild(el('span', { class: 'ld', text: isLit ? '✦' : '', title: isLit ? sp.light.mode : '' }));
            row.addEventListener('click', () => selectLayer(sp.id));
            row.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLayer(sp.id); }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); stepSelection(e.key === 'ArrowDown' ? 1 : -1, true); }
            });
            box.appendChild(row);
        }
    }

    function selectLayer(id) {
        state.selected = id;
        buildLayerList();
        buildInspector();
    }

    function stepSelection(d, focus) {
        const s = scene();
        if (!s || !s.layers.length) return;
        const ids = s.layers.slice().reverse().map(r => r.spec.id);
        let i = ids.indexOf(state.selected);
        i = (i + d + ids.length) % ids.length;
        selectLayer(ids[i]);
        if (focus) {
            const r = document.querySelector(`[data-layer-id="${ids[i]}"]`);
            if (r) r.focus();
        }
    }

    function buildInspector() {
        const box = $('inspector');
        if (!box) return;
        box.textContent = '';
        const rt = selLayer();
        if (!rt) {
            box.appendChild(el('p', { class: 'hint', text: 'Select a Stage 1 layer to edit it.' }));
            return;
        }
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
        const lightOpts = [['direct', 'Direct'], ['light', 'Color Tint'], ['backlight', 'Backlight']];
        if (sp.light && sp.light.mode === 'both') lightOpts.push(['both', 'Both']);
        box.appendChild(seg('Lighting', lightOpts, sp.light.mode, v => {
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
        box.appendChild(slider('Sample zoom', .4, 3, .01, im.zoom, v => v.toFixed(2), v => { im.zoom = v; markStage1Dirty(true); }));
        box.appendChild(slider('Sample pan X', -1, 1, .01, im.panX, v => v.toFixed(2), v => { im.panX = v; markStage1Dirty(true); }));
        box.appendChild(slider('Sample pan Y', -1, 1, .01, im.panY, v => v.toFixed(2), v => { im.panY = v; markStage1Dirty(true); }));
        box.appendChild(slider('Sample rotate °', -180, 180, 1, im.rot, v => v.toFixed(0), v => { im.rot = v; markStage1Dirty(true); }));
        box.appendChild(slider('Source spin °/s', -8, 8, .1, sp.sampleSpin, v => v.toFixed(1), v => { sp.sampleSpin = v; markStage1Dirty(true); }));
        box.appendChild(slider('Outer radius', .3, 2.2, .01, sp.clip ? sp.clip.outer : 0, v => v.toFixed(2), v => { sp.clip = { inner: sp.clip ? sp.clip.inner : 0, outer: v }; markStage1Dirty(true); }));
        box.appendChild(slider('Inner radius', 0, 1.5, .01, sp.clip ? sp.clip.inner : 0, v => v.toFixed(2), v => { sp.clip = { inner: v, outer: sp.clip ? sp.clip.outer : 1 }; markStage1Dirty(true); }));
        box.appendChild(el('h4', { text: 'Picture' }));
        const rebuild = () => { rt.srcKey = ''; markStage1Dirty(true); };
        box.appendChild(select('Fit', [['cover', 'Cover'], ['contain', 'Contain']], im.fit, v => { im.fit = v; rebuild(); }));
        box.appendChild(check('Mirror X', im.mirrorX, v => { im.mirrorX = v; rebuild(); }));
        box.appendChild(check('Mirror Y', im.mirrorY, v => { im.mirrorY = v; rebuild(); }));
        box.appendChild(select('Alpha', [['original', 'Original (preserve)'], ['legacy-luma', 'Legacy luma']], im.alphaMode, v => { im.alphaMode = v; rebuild(); }));
        const tint = el('input', { type: 'color', value: im.tint || '#ffffff', 'aria-label': 'Tint color' });
        tint.addEventListener('input', () => { im.tint = tint.value; rebuild(); });
        box.appendChild(el('label', { class: 'row' }, [el('span', { text: 'Tint' }), tint]));
        box.appendChild(slider('Tint strength', 0, 1, .01, im.tintStrength, v => v.toFixed(2), v => { im.tintStrength = v; rebuild(); }));
        box.appendChild(el('button', {
            type: 'button',
            class: 'btn danger',
            text: 'Remove layer',
            on: {
                click: () => {
                    const s = scene();
                    s.layers = s.layers.filter(r => r.spec.id !== id);
                    state.selected = s.layers.length ? s.layers[0].spec.id : null;
                    markStage1Dirty(true);
                    syncAll();
                }
            }
        }));
    }

    /* ---------- Pictures & Assets ---------- */
    function buildAssets() {
        const box = $('assetList');
        if (!box) return;
        box.textContent = '';
        for (const a of ImageArtEngine.assets.values()) {
            const th = el('canvas', { width: 48, height: 48 });
            const t = th.getContext('2d');
            const k = Math.max(48 / a.width, 48 / a.height);
            t.drawImage(a.source, (48 - a.width * k) / 2, (48 - a.height * k) / 2, a.width * k, a.height * k);
            const add = el('button', { type: 'button', class: 'btn', text: 'Add as layer', on: { click: () => addImageLayer(a.id) } });
            const saveLib = el('button', { type: 'button', class: 'btn', text: '★ Save', title: 'Save image to library', on: { click: () => onSaveAssetToLibrary(a.id) } });
            const rm = el('button', { type: 'button', class: 'btn danger', text: '✕', 'aria-label': 'Remove asset', on: { click: () => removeAsset(a.id) } });
            box.appendChild(el('div', { class: 'arow' }, [th, el('span', { class: 'ln', text: a.name + ' · ' + a.width + '×' + a.height }), add, saveLib, rm]));
        }
    }

    async function importFiles(files) {
        for (const f of files) {
            try { await ImageArtEngine.importFile(f); }
            catch (e) { console.warn(e); $('note').textContent = String(e.message || e); }
        }
        buildAssets();
        const s = scene(), ids = [...ImageArtEngine.assets.keys()];
        if (s && s.layers.length === 0 && ids.length) {
            addImageLayer(ids[0]);
            if (ids[1]) addImageLayer(ids[1]);
        }
        markStage1Dirty(true);
    }

    function addImageLayer(assetId, customSpec) {
        const s = scene();
        if (!s) return null;
        if (s.layers.length >= 6) {
            $('note').textContent = 'Six-layer limit.';
            return null;
        }
        const n = s.layers.length;
        const asset = ImageArtEngine.assets.get(assetId);
        const assetName = asset ? asset.name.slice(0, 18) : 'Layer';
        const spec = Object.assign({
            id: 'image' + (++state.imgSeq || (state.imgSeq = 1)),
            name: 'Image ' + (n + 1) + ' · ' + assetName,
            visible: true, engine: 'image', z: n, proj: 'radial', folds: null,
            extent: n === 0 ? 'full' : .95,
            clip: n === 0 ? null : { inner: .16, outer: .95 },
            opacity: n === 0 ? 1 : .88,
            blend: 'source-over',
            dir: n % 2 ? 'ccw' : 'cw',
            speed: n === 0 ? .65 : .95,
            frozen: false,
            scale: 1, x: 0, y: 0,
            light: { mode: 'direct', strength: 0 },
            pulse: { amount: 0, period: 20 },
            orbit: { rx: 0, ry: 0, period: 120 },
            sampleSpin: 0,
            params: {},
            image: {
                assetId, crop: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover',
                mirrorX: false, mirrorY: false, alphaMode: 'original',
                tint: null, tintStrength: 0, repeat: 'mirror-repeat',
                zoom: 1, panX: n === 0 ? 0 : .05 * n, panY: 0, tileR: 1.9, rot: n * 17
            }
        }, customSpec || {});
        const rt = C.makeRuntime(spec);
        s.layers.push(rt);
        markStage1Dirty(true);
        state.selected = spec.id;
        syncAll();
        return rt;
    }

    function removeAsset(id) {
        const s = scene();
        s.layers = s.layers.filter(r => !(r.spec.image && r.spec.image.assetId === id));
        ImageArtEngine.removeAsset(id);
        markStage1Dirty(true);
        state.selected = s.layers.length ? s.layers[0].spec.id : null;
        syncAll();
    }

    /* ---------- User Presets (My Images) ---------- */
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
        const s = scene();
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
            const proceed = window.confirm('You have unsaved edits in your current Stage 1 composition. Discard and load preset?');
            if (!proceed) return;
        }
        try {
            const s = scene();
            const record = await ImagePresets.restorePreset(id, s);
            if (!state.sandboxOpticsEnabled) {
                syncDirectStage1Layout();
            } else {
                C.layout(s, state.stage1Size, state.stage1Size, 1);
            }
            s.playing = state.stage1Playing;
            state.dirtyImages = false;
            state.stage1Dirty = true;
            state.stage2NeedsRender = true;
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
        const ok = window.confirm(`Overwrite preset "${preset.name}" with current Stage 1 settings?`);
        if (!ok) return;
        try {
            const s = scene();
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
        if (newName === null || !newName.trim()) return;
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

    /* ---------- Saved Images Library ---------- */
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
            for (const [, rec] of ImageArtEngine.assets.entries()) {
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
        for (const [, rec] of ImageArtEngine.assets.entries()) {
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
            renderNow();
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
            const s = scene();
            if (!s.layers.length) {
                addImageLayer(rec.id);
            } else {
                const rt = selLayer();
                if (rt && rt.spec.image) {
                    rt.spec.image.assetId = rec.id;
                    const baseName = rt.spec.name.split('·')[0].trim() || 'Image';
                    rt.spec.name = `${baseName} · ${rec.name.slice(0, 18)}`;
                    rt.srcKey = '';
                    markStage1Dirty(true);
                    syncAll();
                } else {
                    addImageLayer(rec.id);
                }
            }
            buildAssets();
            renderNow();
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

    /* ---------- Backup / Restore ---------- */
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

    function screenshot() {
        renderNow();
        fusionCanvas.toBlob(b => {
            if (!b) return;
            const a = el('a', { href: URL.createObjectURL(b), download: `anima-fusion-${state.sandbox.mode}-${Date.now()}.png` });
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        }, 'image/png');
    }

    /* ---------- Wiring ---------- */
    function wire() {
        $('fusionTabs').querySelectorAll('button').forEach(b => {
            b.addEventListener('click', () => selectTab(b.dataset.ftab));
        });

        $('stage1PlayBtn').addEventListener('click', () => setStage1Playing(!state.stage1Playing));
        $('stage2PlayBtn').addEventListener('click', () => setStage2Playing(!state.stage2Playing));
        $('masterPlayBtn').addEventListener('click', () => {
            const anyPlaying = state.stage1Playing || state.stage2Playing;
            setBothPlaying(!anyPlaying);
        });
        $('shot').addEventListener('click', screenshot);

        if ($('sandboxOpticsToggleBtn')) {
            $('sandboxOpticsToggleBtn').addEventListener('click', () => {
                setSandboxOpticsEnabled(!state.sandboxOpticsEnabled);
            });
        }
        if ($('stage2OpticsInlineToggleBtn')) {
            $('stage2OpticsInlineToggleBtn').addEventListener('click', () => {
                setSandboxOpticsEnabled(!state.sandboxOpticsEnabled);
            });
        }

        /* Stage 1 Scene controls */
        $('motionMul').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            $('motionVal').textContent = v.toFixed(2) + 'x';
            if (state.scene) state.scene.motionMultiplier = v;
            markStage1Dirty(true);
        });
        $('sceneFolds').addEventListener('input', e => {
            const v = parseInt(e.target.value, 10);
            $('foldsVal').textContent = v;
            if (state.scene) state.scene.folds = v;
            markStage1Dirty(true);
        });
        $('lightSpeed').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            $('lightVal').textContent = v.toFixed(2);
            if (state.scene) state.scene.light.speed = v;
            markStage1Dirty(true);
        });
        const lp = $('lightPreset');
        World.rgbList.forEach(n => lp.appendChild(el('option', { value: n, text: n })));
        lp.addEventListener('change', () => {
            if (state.scene) state.scene.light.preset = lp.value;
            World.setActiveRGB(lp.value);
            frame.lightRev = 0;
            markStage1Dirty(true);
        });
        $('stage1Bg').addEventListener('change', e => {
            if (state.scene) state.scene.background = e.target.value;
            markStage1Dirty(true);
        });
        $('stage1Res').addEventListener('change', e => {
            state.stage1Size = parseInt(e.target.value, 10) || 512;
            syncStage1Layout();
            syncBridgeSize();
            renderNow();
            updateTransportUI();
        });

        /* Stage 2 Sandbox Controls */
        $('symmetryMode').addEventListener('change', e => {
            state.sandbox.mode = e.target.value;
            OpticalEngine.setSymmetryMode(state.sandbox.mode);
            state.stage2NeedsRender = true;
            updateTransportUI();
        });

        function onTilesChanged(val) {
            const clamped = Math.max(2, Math.min(25, Math.round(Number(val) || 5)));
            state.sandbox.numTiles = clamped;
            $('numTilesInput').value = clamped;
            $('numTilesNumberInput').value = clamped;
            OpticalEngine.setNumTiles(clamped);
            syncBridgeSize();
        }
        $('numTilesInput').addEventListener('input', e => onTilesChanged(e.target.value));
        $('numTilesNumberInput').addEventListener('input', e => onTilesChanged(e.target.value));

        $('radialFolds').addEventListener('input', e => {
            const v = parseInt(e.target.value, 10);
            state.sandbox.radialFolds = v;
            $('radialFoldsVal').textContent = v;
            OpticalEngine.setRadialFolds(v);
            state.stage2NeedsRender = true;
        });
        $('ringCount').addEventListener('input', e => {
            const v = parseInt(e.target.value, 10);
            state.sandbox.ringCount = v;
            $('ringCountVal').textContent = v;
            OpticalEngine.setRingCount(v);
            state.stage2NeedsRender = true;
        });
        $('sandboxSpeed').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            state.sandbox.speed = v;
            $('sandboxSpeedVal').textContent = v.toFixed(2) + 'x';
            OpticalEngine.setSpeed(v);
            state.stage2NeedsRender = true;
        });
        $('sandboxOrbitRate').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            state.sandbox.orbitRate = v;
            $('sandboxOrbitRateVal').textContent = v.toFixed(2) + '×';
            if (OpticalEngine.setOrbitRate) OpticalEngine.setOrbitRate(v);
            state.stage2NeedsRender = true;
        });
        $('sandboxOrbitAmount').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            state.sandbox.orbitAmount = v;
            $('sandboxOrbitAmountVal').textContent = v.toFixed(2);
            if (OpticalEngine.setOrbitAmount) OpticalEngine.setOrbitAmount(v);
            state.stage2NeedsRender = true;
        });
        $('sandboxSpinRate').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            state.sandbox.spinRate = v;
            $('sandboxSpinRateVal').textContent = v.toFixed(2) + '×';
            if (OpticalEngine.setSpinRate) OpticalEngine.setSpinRate(v);
            state.stage2NeedsRender = true;
        });
        $('sandboxRingRate').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            state.sandbox.ringRate = v;
            $('sandboxRingRateVal').textContent = v.toFixed(2) + '×';
            if (OpticalEngine.setRingRate) OpticalEngine.setRingRate(v);
            state.stage2NeedsRender = true;
        });
        $('sandboxRingBreath').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            state.sandbox.ringBreath = v;
            $('sandboxRingBreathVal').textContent = v.toFixed(3);
            if (OpticalEngine.setRingBreath) OpticalEngine.setRingBreath(v);
            state.stage2NeedsRender = true;
        });
        $('resetSandboxBtn').addEventListener('click', resetSandboxDefaults);

        /* Presets & Saved Images Library */
        const pSel = $('userPresetSelect');
        if (pSel) pSel.addEventListener('change', updatePresetUIButtons);
        if ($('savePresetBtn')) $('savePresetBtn').addEventListener('click', onSavePreset);
        if ($('loadPresetBtn')) $('loadPresetBtn').addEventListener('click', onLoadPreset);
        if ($('updatePresetBtn')) $('updatePresetBtn').addEventListener('click', onUpdatePreset);
        if ($('renamePresetBtn')) $('renamePresetBtn').addEventListener('click', onRenamePreset);
        if ($('deletePresetBtn')) $('deletePresetBtn').addEventListener('click', onDeletePreset);

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

        /* Scroll / FAB / Keyboard */
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
        window.addEventListener('dragover', e => e.preventDefault());
        window.addEventListener('drop', e => {
            e.preventDefault();
            importFiles([...e.dataTransfer.files].filter(f => /^image\//.test(f.type)));
        });

        window.addEventListener('keydown', e => {
            const t = e.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !(t.type === 'checkbox' || t.type === 'range')) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (t && t.type === 'range') return;
            if (e.key === ' ' && !(t && t.tagName === 'BUTTON')) {
                e.preventDefault();
                const anyPlaying = state.stage1Playing || state.stage2Playing;
                setBothPlaying(!anyPlaying);
            } else if (e.key === 'h' || e.key === 'H') {
                const hiding = !document.body.classList.contains('hide-ui');
                document.body.classList.toggle('hide-ui', hiding);
                if (hiding) window.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (e.key === '1') {
                selectTab('source');
            } else if (e.key === '2') {
                selectTab('optics');
            } else if (e.key === '[') {
                stepSelection(-1);
            } else if (e.key === ']') {
                stepSelection(1);
            } else if (e.key === 'd' || e.key === 'D') {
                state.stats.dbg = !state.stats.dbg;
                $('stats').classList.toggle('on', state.stats.dbg);
            }
        });
    }

    /* ---------- Initial Graphene Lattice Seed ---------- */
    async function seedDefaultGrapheneScene() {
        try {
            const rec = await resolveSavedImageMemoryRecord('bundled-graphene');
            if (!rec) return;
            const s = scene();
            if (!s || s.layers.length > 0) return;

            addImageLayer(rec.id, {
                name: 'Image 1 · Graphene Backlit',
                dir: 'cw',
                speed: 0.85,
                scale: 1.05,
                light: { mode: 'backlight', strength: 1.0 },
                pulse: { amount: 0.015, period: 18 },
                orbit: { rx: 0.015, ry: 0.015, period: 45 },
                sampleSpin: 0
            });
            addImageLayer(rec.id, {
                name: 'Image 2 · Graphene Counter',
                dir: 'ccw',
                speed: 1.15,
                scale: 0.92,
                opacity: 0.85,
                blend: 'screen',
                clip: { inner: 0.14, outer: 0.96 },
                light: { mode: 'direct', strength: 0 },
                pulse: { amount: 0.012, period: 14 },
                sampleSpin: 0
            });
            state.dirtyImages = false;
            buildAssets();
            syncSceneControls();
            syncAll();
            renderNow();
        } catch (e) {
            console.warn('Could not seed default Graphene Lattice:', e);
        }
    }

    /* ---------- Collapsible Sections Memory ---------- */
    function initCollapsibleSections() {
        const key = 'anima_fusion_section_states';
        let saved = {};
        try {
            const raw = localStorage.getItem(key);
            if (raw) saved = JSON.parse(raw);
        } catch (e) {}
        const groups = document.querySelectorAll('aside#panel details.sec-group[data-sec]');
        groups.forEach(details => {
            const id = details.dataset.sec;
            if (!id) return;
            if (saved && typeof saved[id] === 'boolean') {
                details.open = saved[id];
            }
            details.addEventListener('toggle', () => {
                saved[id] = details.open;
                try {
                    localStorage.setItem(key, JSON.stringify(saved));
                } catch (e) {}
            });
        });
    }

    /* ---------- Art Lab Handoff Restoration (Create First, Fuse Second) ---------- */
    async function restoreHandoffPayload(payload) {
        if (!payload || !payload.scene) throw new Error('Empty handoff payload');
        const IP = getImagePresets();
        const db = await (IP ? IP.openDB() : null);
        const storageToMemoryId = new Map();

        // Map existing memory records first
        for (const [memId, rec] of ImageArtEngine.assets.entries()) {
            if (rec.storageId) storageToMemoryId.set(rec.storageId, memId);
        }

        // Collect all storageIds referenced by layers
        const neededStorageIds = new Set();
        for (const lspec of (payload.scene.layers || [])) {
            if (lspec.image && lspec.image.storageId) {
                neededStorageIds.add(lspec.image.storageId);
            }
        }

        // Load any needed assets not yet in memory
        for (const sId of neededStorageIds) {
            if (!storageToMemoryId.has(sId)) {
                let assetRec = null;
                if (db) {
                    assetRec = await new Promise((res, rej) => {
                        const tx = db.transaction('assets', 'readonly');
                        const req = tx.objectStore('assets').get(sId);
                        req.onsuccess = () => res(req.result || null);
                        req.onerror = () => rej(tx.error);
                    });
                }
                if ((!assetRec || !assetRec.blob) && typeof window !== 'undefined' && Array.isArray(window.AnimaBundledImages)) {
                    const b = window.AnimaBundledImages.find(x => x.id === sId);
                    if (b && b.dataUrl) {
                        const r = await fetch(b.dataUrl);
                        assetRec = { id: b.id, name: b.name, blob: await r.blob() };
                    }
                }
                if (!assetRec || !assetRec.blob) {
                    throw new Error('Image asset could not be retrieved from storage for: ' + sId);
                }
                const memRec = await ImageArtEngine.importFile(assetRec.blob);
                if (assetRec.libraryName || assetRec.name) memRec.name = assetRec.libraryName || assetRec.name;
                memRec.storageId = sId;
                storageToMemoryId.set(sId, memRec.id);
            }
        }

        // Reconstruct scene settings
        const sc = payload.scene;
        state.scene.folds = sc.folds;
        state.scene.motionMultiplier = sc.motionMultiplier != null ? sc.motionMultiplier : 1.0;
        state.scene.background = sc.background || '#05060c';
        state.scene.light = Object.assign({}, sc.light);
        if (state.scene.light && state.scene.light.preset && window.World) {
            World.setActiveRGB(state.scene.light.preset);
        }

        // Release old runtime projections to free memory
        for (const rt of state.scene.layers) {
            C.release(rt);
        }
        state.scene.layers = [];

        // Build new layer runtimes and restore phase states
        const layerStates = (payload.runtime && payload.runtime.layerStates) || [];
        for (let i = 0; i < (sc.layers || []).length; i++) {
            const lspec = JSON.parse(JSON.stringify(sc.layers[i]));
            if (lspec.image && lspec.image.storageId) {
                const memId = storageToMemoryId.get(lspec.image.storageId);
                if (memId) lspec.image.assetId = memId;
            }
            const rt = C.makeRuntime(lspec);

            // Restore runtime phase state for Level 2 Phase Fidelity
            const savedState = layerStates.find(x => x.id === lspec.id) || layerStates[i];
            if (savedState && savedState.st) {
                rt.st.theta = Number(savedState.st.theta) || 0;
                rt.st.orbit = Number(savedState.st.orbit) || 0;
                rt.st.pulse = Number(savedState.st.pulse) || 0;
                rt.st.spin = Number(savedState.st.spin) || 0;
            }
            state.scene.layers.push(rt);
        }

        // Restore runtime scene time
        if (payload.runtime && typeof payload.runtime.time === 'number') {
            state.scene.time = payload.runtime.time;
        }

        // Restore playback state
        state.stage1Playing = payload.stage1Playing !== false;
        setStage1Playing(state.stage1Playing);

        // Ensure Sandbox Optics starts OFF (Create First, Fuse Second)
        setSandboxOpticsEnabled(false);

        // Update UI
        state.selected = state.scene.layers.length ? state.scene.layers[0].spec.id : null;
        syncSceneControls();
        syncAll();
        resize();
        renderNow();

        // Safely clean up transfer assets that are not saved in library and not in saved presets
        if (payload.transferAssetIds && payload.transferAssetIds.length && db) {
            try {
                const allPresets = await (IP.getAllPresets ? IP.getAllPresets() : []);
                const preservedAssetIds = new Set();
                allPresets.forEach(p => (p.assetIds || []).forEach(aId => preservedAssetIds.add(aId)));

                for (const tId of payload.transferAssetIds) {
                    if (!preservedAssetIds.has(tId)) {
                        const aRec = await (IP.getAsset ? IP.getAsset(tId) : null);
                        if (aRec && !aRec.savedInLibrary) {
                            await new Promise(res => {
                                const tx = db.transaction('assets', 'readwrite');
                                tx.objectStore('assets').delete(tId);
                                tx.oncomplete = () => res(true);
                                tx.onerror = () => res(false);
                            });
                        }
                    }
                }
            } catch (cleanErr) {
                console.warn('Transfer cleanup notice:', cleanErr);
            }
        }
    }

    async function checkHandoff() {
        let raw = null;
        try {
            raw = sessionStorage.getItem('anima_fusion_handoff');
        } catch (e) {
            console.warn('Unable to access sessionStorage for handoff:', e);
        }
        if (!raw) return false;

        let payload = null;
        try {
            payload = JSON.parse(raw);
        } catch (e) {
            console.error('Invalid handoff payload:', e);
            sessionStorage.removeItem('anima_fusion_handoff');
            return false;
        }

        if (!payload || !payload.scene) return false;

        // Verify freshness (within last 30 minutes)
        if (Date.now() - (payload.timestamp || 0) > 30 * 60 * 1000) {
            sessionStorage.removeItem('anima_fusion_handoff');
            return false;
        }

        busy(true, 'Transferring from Art Lab…');
        try {
            await restoreHandoffPayload(payload);
            sessionStorage.removeItem('anima_fusion_handoff');
            busy(false);
            if ($('presetStatus')) {
                $('presetStatus').textContent = 'Transferred from Art Lab — Sandbox Optics are OFF.';
            }
            return true;
        } catch (err) {
            console.error('Failed to restore handoff in Fusion:', err);
            busy(false);
            if ($('presetStatus')) {
                $('presetStatus').textContent = 'Handoff load error: ' + err.message;
            }
            return false;
        }
    }

    /* ---------- Boot ---------- */
    async function boot() {
        if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
        window.scrollTo(0, 0);

        OpticalEngine.init(fusionCanvas);
        wire();
        initCollapsibleSections();

        const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        const still = qs.get('still') === '1';
        state.stage1Playing = !reduce && !still;
        state.stage2Playing = !reduce && !still;

        // Default to Sandbox Optics OFF (Create First, Fuse Second)
        state.sandboxOpticsEnabled = false;
        setSandboxOpticsEnabled(false);

        state.scene = buildStage1Scene();
        World.setActiveRGB(state.scene.light.preset);
        resize();
        syncSandboxControls();
        applySandboxStateToEngine();
        syncSceneControls();
        syncAll();

        if (qs.get('ui') === '0') document.body.classList.add('hide-ui');
        if (qs.get('stats') === '1') { state.stats.dbg = true; $('stats').classList.add('on'); }
        if (qs.get('tab') === 'optics') selectTab('optics');

        await Promise.all([
            refreshUserPresetsDropdown(),
            refreshSavedImagesDropdown()
        ]);

        let handoffLoaded = false;
        if (qs.get('empty') !== '1') {
            handoffLoaded = await checkHandoff();
            if (!handoffLoaded) {
                await seedDefaultGrapheneScene();
            }
        } else {
            renderNow();
        }

        updateTransportUI();
        updateOpticsToggleUI();
        document.body.dataset.ready = '1';
        requestAnimationFrame(loop);
    }

    /* ---------- Test & Inspection Hooks ---------- */
    window.AnimaFusion = {
        get state() { return state; },
        get scene() { return scene(); },
        get stage1Canvas() { return stage1Canvas; },
        get sourceCanvas() { return sourceCanvas; },
        get flippedCanvas() { return flippedCanvas; },
        get fusionCanvas() { return fusionCanvas; },
        compositor: C,
        opticalEngine: OpticalEngine,
        selectTab,
        setStage1Playing,
        setStage2Playing,
        setBothPlaying,
        setSandboxOpticsEnabled,
        restoreHandoffPayload,
        checkHandoff,
        patchLayer,
        addImageLayer,
        importFiles,
        renderNow,
        renderDirectStage1Now,
        renderStage1Now,
        renderStage2Now,
        resize,
        syncAll,
        syncSceneControls,
        syncSandboxControls,
        applySandboxStateToEngine,
        resetSandboxDefaults,
        initCollapsibleSections,
        refreshUserPresetsDropdown,
        refreshSavedImagesDropdown,
        resolveSavedImageMemoryRecord,
        onLoadPreset,
        step(dt, n) {
            const count = n || 1;
            const stepDt = Number.isFinite(dt) ? dt : 1 / 60;
            for (let i = 0; i < count; i++) {
                tick(stepDt);
            }
        },
        ready() { return document.body.dataset.ready === '1'; },
        captureOfflineSnapshot() {
            return AnimaOfflineRenderer.capture(scene(), {
                kind: 'fusion', lightAcc: state.lightAcc, frame, world: World.getState(),
                fusion: { enabled: state.sandboxOpticsEnabled, stage1Playing: state.stage1Playing,
                    stage2Playing: state.stage2Playing, stage1Size: state.stage1Size, optics: OpticalEngine.getState() }
            });
        }
    };

    boot();
})();
