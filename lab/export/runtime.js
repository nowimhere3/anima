/* Engine runtime in a dedicated same-origin document. Frame zero is BEFORE advance.
 * One next() call produces i/fps. 300 frames at 30fps cover [0,10), last at 299/30.
 * No RAF and no wall clock is used to advance content. Canvas is reused, not retained.
 */
window.AnimaOfflineHost = (() => {
    'use strict';
    const C = LabCompositor;
    let scene, output, ctx, frame, lightAcc, config, fusion, index = 0;
    let stage1, source, flipped, seedState, lightUpdates = 0;
    const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    function seeded() {
        seedState = (seedState + 0x6D2B79F5) >>> 0;
        let t = seedState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function init(snapshot, options) {
        config = options; seedState = options.seed >>> 0;
        scene = structuredClone(snapshot.scene);
        scene.layers = scene.layers.map(rt => Object.assign(C.makeRuntime(rt.spec), { st: rt.st }));
        for (const a of snapshot.assets) {
            const src = canvas(a.width, a.height); src.getContext('2d').drawImage(a.source, 0, 0);
            ImageArtEngine.assets.set(a.id, { ...a, source: src });
        }
        World.restoreState(snapshot.world); World.setRandomSource(seeded);
        const lightCanvas = canvas(snapshot.lightCanvas.width, snapshot.lightCanvas.height);
        lightCanvas.getContext('2d').drawImage(snapshot.lightCanvas, 0, 0);
        frame = { lightCanvas, lightRev: snapshot.lightRev }; lightAcc = snapshot.lightAcc;
        output = canvas(config.width, config.height);
        ctx = output.getContext('2d', { alpha: true, willReadFrequently: false });
        fusion = snapshot.kind === 'fusion' ? snapshot.fusion : null;
        // Lab export animates even when the editor is paused. Fusion honors separate clocks.
        scene.playing = options.stage1Playing ?? (fusion ? fusion.stage1Playing : true);
        if (fusion) fusion.stage2Playing = options.stage2Playing ?? fusion.stage2Playing;
        if (fusion?.enabled) {
            const size = fusion.stage1Size;
            stage1 = canvas(size, size);
            const ts = fusion.optics.mode === 'classic' ? Math.max(64, Math.min(size, Math.ceil(config.width / Math.max(2, fusion.optics.numTiles)))) : size;
            source = canvas(ts, ts); flipped = canvas(ts, ts);
            C.layout(scene, size, size, 1);
            OpticalEngine.init(output); OpticalEngine.setCanvasSize(config.width, config.height); OpticalEngine.restoreState(fusion.optics);
        } else C.layout(scene, config.width, config.height, 1);
    }
    function updateLight(dt) {
        if (!C.sceneUsesLight(scene)) return;
        World.update(dt * .6, scene.light.speed); lightAcc += dt;
        if (lightAcc >= .05 || !frame.lightRev) {
            lightAcc = 0;
            World.render(frame.lightCanvas.getContext('2d'), frame.lightCanvas.width, frame.lightCanvas.height);
            frame.lightRev++; lightUpdates++;
        }
    }
    function next() {
        if (!scene) throw new Error('Offline renderer not initialized');
        const start = performance.now(), dt = index === 0 ? 0 : 1 / config.fps;
        if (scene.playing) { C.advanceScene(scene, dt); updateLight(dt); }
        else if (!frame.lightRev) updateLight(0);
        const advanced = performance.now();
        C.prepareScene(scene, frame);
        if (!fusion?.enabled) C.renderScene(scene, ctx, frame);
        else {
            C.renderScene(scene, stage1.getContext('2d'), frame);
            const s = source.getContext('2d'); s.clearRect(0, 0, source.width, source.height);
            s.imageSmoothingQuality = 'high'; s.drawImage(stage1, 0, 0, source.width, source.height);
            const f = flipped.getContext('2d'); f.setTransform(-1, 0, 0, 1, flipped.width, 0);
            f.clearRect(0, 0, flipped.width, flipped.height); f.drawImage(source, 0, 0);
            OpticalEngine.renderFrame(source, flipped, fusion.stage2Playing ? dt : 0);
        }
        const rendered = performance.now(), frameIndex = index++;
        return { canvas: output, index: frameIndex, time: frameIndex / config.fps,
            timestampUs: Math.round(frameIndex * 1e6 / config.fps),
            durationUs: Math.round((frameIndex + 1) * 1e6 / config.fps) - Math.round(frameIndex * 1e6 / config.fps),
            metrics: { advanceMs: advanced - start, renderMs: rendered - advanced, totalMs: rendered - start } };
    }
    function inspect() {
        return { nextIndex: index, time: index ? (index - 1) / config.fps : 0, sceneTime: scene.time,
            phases: structuredClone(scene.layers.map(rt => rt.st)), world: World.getState(), lightRev: frame.lightRev,
            lightUpdates, randomState: seedState, optics: fusion?.enabled ? OpticalEngine.getState() : null,
            width: output.width, height: output.height, center: { x: scene.cx, y: scene.cy }, radius: scene.R,
            projectionSides: scene.layers.map(rt => rt.proj?.width || 0) };
    }
    function dispose() {
        for (const rt of scene.layers) C.release(rt);
        ImageArtEngine.assets.clear(); scene = null; output = null; frame = null; stage1 = source = flipped = null;
    }
    return { init, next, inspect, dispose, get canvas() { return output; } };
})();
