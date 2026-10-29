/* Browser-only fixtures, selected captures and completion-synchronized benchmarks.
 * readback and PNG serialization live here, never in the renderer hot path.
 */
(async () => {
    'use strict';
    const checks = [], captures = {}, benchmarks = [];
    window.__offlineResults = { done: false }; window.__offlineCaptures = captures;
    function check(name, value, detail) {
        checks.push({ name, pass: !!value, detail });
        document.getElementById('results').textContent = checks.map(x => (x.pass ? 'PASS ' : 'FAIL ') + x.name).join('\n');
        if (!value) throw new Error(name + ': ' + JSON.stringify(detail));
    }
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ef = document.getElementById('editor');
    async function ready(kind = 'AnimaLab') {
        for (let i = 0; i < 200; i++) { if (ef.contentWindow[kind]?.ready()) return ef.contentWindow; await wait(50); }
        throw new Error('Editor ready timeout');
    }
    async function hash(c) {
        const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const bytes = await crypto.subtle.digest('SHA-256', data);
        return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const sceneJSON = s => JSON.stringify({ ...s, layers: s.layers.map(r => ({ spec: r.spec, st: r.st })) });
    const summarize = (values, key) => {
        const a = values.map(x => x[key]).sort((x, y) => x - y);
        return { mean: a.reduce((x, y) => x + y, 0) / a.length, p95: a[Math.floor(a.length * .95)] };
    };
    try {
        let f = await ready(), app = f.AnimaLab, api = f.AnimaOfflineRenderer;
        const w = f.eval('World'), originalRandom = f.Math.random;
        app.setPlaying(true); app.step(1 / 30, 17); app.setPlaying(false);
        app.scene.motionMultiplier = 1.35;
        app.patchLayer('inner', { opacity: .77, speed: .63, orbit: { rx: .01, ry: .007, period: 27 } });
        app.renderNow();
        const snap = app.captureOfflineSnapshot(), original = sceneJSON(app.scene), worldBefore = JSON.stringify(w.getState());
        const live0 = await hash(f.document.getElementById('labCanvas'));
        captures['live-current'] = f.document.getElementById('labCanvas').toDataURL('image/png');
        const first = await api.create(snap, { width: 1920, height: 1080, fps: 30, seed: 711 });
        const frames = {}, states = {}, t0 = performance.now();
        await first.run(300, async frame => {
            checkFrameTime(frame);
            if ([0, 150, 299].includes(frame.index)) {
                frames[frame.index] = await hash(frame.canvas); states[frame.index] = first.state;
                if (frame.index === 0) {
                    const live = f.document.getElementById('labCanvas');
                    const a = live.getContext('2d').getImageData(0, 0, live.width, live.height).data;
                    const b = frame.canvas.getContext('2d').getImageData(0, 0, frame.canvas.width, frame.canvas.height).data;
                    let changes = 0, max = 0; for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) { changes++; max = Math.max(max, Math.abs(a[j] - b[j])); }
                    states.diff = { changes, max, liveSize: [live.width, live.height], sceneSize: [snap.scene.W, snap.scene.H, snap.scene.q], exportSize: [frame.canvas.width, frame.canvas.height] };
                }
                captures['lab-1080p-' + frame.index] = frame.canvas.toDataURL('image/png');
            }
        });
        const proofMs = performance.now() - t0;
        check('300 frames cover [0,10), last sample 299/30', first.state.nextIndex === 300 && first.state.time === 299 / 30);
        check('POC generated independently in less than 10 seconds', proofMs < 10000, { proofMs });
        check('Frame zero matches current artwork within GPU raster tolerance', states.diff.max <= 2 && states.diff.changes < 1920 * 1080 * 4 * .0001, { live0, frame0: frames[0], ...states.diff });
        check('Frame zero preserves captured runtime phases', JSON.stringify(states[0].phases) === JSON.stringify(snap.scene.layers.map(r => r.st)));
        check('Artwork actually changes at virtual timestamps', frames[0] !== frames[150] && frames[150] !== frames[299]);
        check('Live paused scene and World were not mutated', sceneJSON(app.scene) === original && JSON.stringify(w.getState()) === worldBefore);
        check('Export did not replace editor Math.random', f.Math.random === originalRandom);
        check('Clean canvas excludes conspicuous DOM overlay', !first.canvas.isConnected && f.document.getElementById('panel').isConnected);
        check('Full-resolution output is independent of viewport', first.canvas.width === 1920 && first.canvas.height === 1080);
        const replica = await api.create(snap, { width: 1920, height: 1080, fps: 30, seed: 711 });
        const second = {};
        await replica.run(300, async frame => { if (frame.index in frames) second[frame.index] = await hash(frame.canvas); });
        check('Identical snapshot/seed/sequence reproduces pixels', JSON.stringify(frames) === JSON.stringify(second), { frames, second });
        first.dispose(); replica.dispose();
        check('Export documents are released', f.document.querySelectorAll('iframe').length === 0);
        for (const [width, height] of [[1280, 720], [1080, 1920]]) {
            const job = await api.create(snap, { width, height }); job.next();
            check('Geometry ' + width + 'x' + height, job.state.radius === Math.min(width, height) / 2 && job.state.center.x === width / 2 && job.state.center.y === height / 2);
            captures['lab-' + width + 'x' + height] = job.canvas.toDataURL('image/png'); job.dispose();
        }
        check('Live editor can keep playing while isolated export runs', await (async () => {
            const job = await api.create(snap, { width: 320, height: 180 });
            app.setPlaying(true); await job.run(60); app.setPlaying(false);
            const valid = job.state.nextIndex === 60 && job.state.time === 59 / 30;
            job.dispose(); return valid;
        })());
        // Saturated chroma-breathing forces several random hue transitions.
        const breath = structuredClone({ ...snap, assets: [], lightCanvas: null });
        breath.lightCanvas = snap.lightCanvas; breath.assets = snap.assets;
        breath.world.activeRGB = 'chroma-breathing'; breath.world.prevBreathCycle = -1;
        breath.scene.light = { preset: 'chroma-breathing', speed: 3 };
        breath.scene.layers[1].spec.light = { mode: 'light', strength: 1 };
        const breathHash = async seed => {
            const j = await api.create(breath, { width: 640, height: 360, seed });
            await j.run(330); const result = { hash: await hash(j.canvas), world: j.state.world, random: j.state.randomState }; j.dispose(); return result;
        };
        const b1 = await breathHash(123), b2 = await breathHash(123), b3 = await breathHash(124);
        check('Seeded breathing light is deterministic', JSON.stringify(b1) === JSON.stringify(b2));
        check('Seed affects breathing hue and pixels', b1.hash !== b3.hash && b1.random !== b3.random, { b1, b3 });
        // Same-mode exports cover every real-time lighting mode without touching its World.
        for (const mode of w.rgbList) {
            const packet = { ...breath, world: { ...breath.world, activeRGB: mode } };
            const j = await api.create(packet, { width: 320, height: 180 }); await j.run(4); j.dispose();
        }
        check('All 12 World lighting modes render in isolation', w.rgbList.length === 12);
        // Multi-image unsaved artwork, including source alpha, crop, blending and phases.
        app.selectWorkspace('images'); app.setPlaying(false);
        const E = f.eval('ImageArtEngine');
        for (const color of ['#ee4477', '#22bbaa']) {
            const cv = f.document.createElement('canvas'); cv.width = 160; cv.height = 100;
            const c = cv.getContext('2d'); c.fillStyle = color; c.fillRect(0, 0, 110, 100); c.globalAlpha = .4; c.fillRect(110, 0, 50, 60);
            const blob = await new Promise(r => cv.toBlob(r)); const a = await E.importFile(new f.File([blob], color + '.png', { type: 'image/png' }));
            app.addImageLayer(a.id);
        }
        app.scene.background = 'transparent'; app.scene.motionMultiplier = .8;
        app.scene.layers[1].spec.image.crop = { x: .1, y: .05, w: .8, h: .9 };
        app.scene.layers[1].spec.blend = 'screen'; app.scene.layers[1].st.theta = .73;
        const imageSnap = app.captureOfflineSnapshot(), imageBefore = sceneJSON(app.scene);
        check('Snapshot preserves original blobs and unsaved working pixels', imageSnap.assets.length === 2 && imageSnap.assets.every(a => a.blob.size > 0));
        const i1 = await api.create(imageSnap, { width: 640, height: 360 }); i1.next(); const imageHash = await hash(i1.canvas);
        E.assets.get(imageSnap.assets[0].id).source = f.document.createElement('canvas'); // editor edit after capture
        const i2 = await api.create(imageSnap, { width: 640, height: 360 }); i2.next();
        check('Snapshot pixels survive subsequent editor asset edits', imageHash === await hash(i2.canvas));
        await i1.run(20); check('Image composition phases/fields remain unchanged', sceneJSON(app.scene) === imageBefore);
        i1.dispose(); i2.dispose();
        // Missing assets fail loudly rather than export a preset or drop a layer.
        const missingId = app.scene.layers[0].spec.image.assetId;
        const saved = E.assets.get(missingId); E.assets.delete(missingId); let failed = false;
        try { app.captureOfflineSnapshot(); } catch { failed = true; } E.assets.set(missingId, saved);
        check('Unrepresentable missing asset rejects snapshot', failed);
        // Isolated full-resolution benchmarks. A 1px read synchronizes graphics work.
        for (const [width, height] of [[1920, 1080], [1280, 720]]) {
            for (const lit of [false, true]) {
                const p = { ...snap, scene: structuredClone(snap.scene) };
                for (const rt of p.scene.layers) rt.spec.light = { mode: lit ? 'light' : 'direct', strength: lit ? .4 : 0 };
                const job = await api.create(p, { width, height, fps: 30, seed: 111 });
                await job.run(12, x => x.canvas.getContext('2d').getImageData(0, 0, 1, 1));
                const measurements = [], start = performance.now();
                await job.run(300, x => {
                    const before = performance.now(); x.canvas.getContext('2d').getImageData(0, 0, 1, 1);
                    measurements.push({ ...x.metrics, completionMs: performance.now() - before });
                });
                const elapsedMs = performance.now() - start;
                benchmarks.push({ width, height, layers: p.scene.layers.length, lit, frames: 300, elapsedMs,
                    fps: 300000 / elapsedMs, advance: summarize(measurements, 'advanceMs'), render: summarize(measurements, 'renderMs'),
                    total: summarize(measurements, 'totalMs'), graphicsCompletion: summarize(measurements, 'completionMs') });
                job.dispose();
            }
        }
        // Fusion direct path and ON/paused semantics use the same coordinator.
        ef.src = '../../kaleidoscope-fusion.html?still=1&empty=1'; f = await ready('AnimaFusion');
        const fusion = f.AnimaFusion; api = f.AnimaOfflineRenderer;
        const assetEngine = f.eval('ImageArtEngine');
        for (const a of imageSnap.assets) {
            const src = f.document.createElement('canvas'); src.width = a.width; src.height = a.height; src.getContext('2d').drawImage(a.source, 0, 0);
            assetEngine.assets.set(a.id, { ...a, source: src });
            fusion.addImageLayer(a.id);
        }
        fusion.setBothPlaying(false); fusion.renderNow();
        const fs = fusion.captureOfflineSnapshot(), fuseOriginal = sceneJSON(fusion.scene), fuseWorld = JSON.stringify(f.eval('World').getState());
        const direct = await api.create(fs, { width: 1920, height: 1080, stage1Playing: true });
        direct.next(); const direct0 = await hash(direct.canvas);
        const labPacket = { ...fs, kind: 'lab', fusion: null };
        const pure = await api.create(labPacket, { width: 1920, height: 1080 }); pure.next();
        check('Fusion OFF matches pure Art Lab pixels', direct0 === await hash(pure.canvas));
        await direct.run(29); check('Fusion direct advances Stage 1 virtually', direct.state.sceneTime > fs.scene.time); direct.dispose(); pure.dispose();
        fusion.setSandboxOpticsEnabled(true); fusion.state.sandbox.mode = 'radial'; fusion.applySandboxStateToEngine(); fusion.renderNow();
        const onSnap = fusion.captureOfflineSnapshot(), onOriginal = sceneJSON(fusion.scene), onWorld = JSON.stringify(f.eval('World').getState());
        const on1 = await api.create(onSnap, { width: 1280, height: 720, stage1Playing: false, stage2Playing: true });
        on1.next(); const on0 = await hash(on1.canvas); await on1.run(29); const endOn = await hash(on1.canvas);
        check('Fusion ON runs while Stage 1 is paused', on1.state.sceneTime === onSnap.scene.time && endOn !== on0 && on1.state.optics.orbitPhase !== onSnap.fusion.optics.orbitPhase);
        captures['fusion-radial-29'] = on1.canvas.toDataURL('image/png');
        const on2 = await api.create(onSnap, { width: 1280, height: 720, stage1Playing: false, stage2Playing: true }); await on2.run(30);
        check('Fusion ON fixed clock reproduces pixels', endOn === await hash(on2.canvas)); on1.dispose(); on2.dispose();
        const frozen = await api.create(onSnap, { width: 640, height: 360, stage1Playing: false, stage2Playing: false });
        frozen.next(); const frozen0 = await hash(frozen.canvas); await frozen.run(5);
        check('Optics ON and motion paused still projects fixed optics', frozen0 === await hash(frozen.canvas) && frozen.state.optics.orbitPhase === onSnap.fusion.optics.orbitPhase); frozen.dispose();
        check('Fusion live phases/World remain safe', sceneJSON(fusion.scene) === onOriginal && JSON.stringify(f.eval('World').getState()) === onWorld);
        check('Micro-speed range remains 0–3', f.document.getElementById('sandboxSpeed').max === '3' && f.document.getElementById('motionMul').max === '3');
        check('Collapsible editor panels and menu remain present', f.document.querySelectorAll('details.sec-group').length >= 4 && f.document.getElementById('panel').isConnected);
        window.__offlineResults = { done: true, pass: true, checks, proofMs, frames, benchmarks };
    } catch (error) { window.__offlineResults = { done: true, pass: false, checks, error: error.stack, benchmarks }; }
    function checkFrameTime(frame) {
        if (frame.time !== frame.index / 30 || frame.timestampUs !== Math.round(frame.index * 1e6 / 30)) throw new Error('Frame timestamp mismatch');
    }
})();
