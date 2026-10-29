/* ============================================================
   LAB COMPOSITOR — independent layer phases, material stage, cached
   projections and the ordered final draw.
   Frame: advance every layer once -> (shared light field) -> resolve
   source/material/projection per layer (cached by revision key) ->
   draw each projected layer with its own pose, clip, opacity and blend.
   ============================================================ */
const LabCompositor = (function () {
    "use strict";
    const TAU = Math.PI * 2, DEG = Math.PI / 180;
    const MAX_SIDE = 2400;

    function clone(o) { return JSON.parse(JSON.stringify(o)); }

    /* ---------- layer state: accumulated phases (never elapsed*speed) ---------- */
    function newState(spec) {
        return { theta: 0, orbit: ((spec.orbit && spec.orbit.phase) || 0) * DEG, pulse: 0, spin: 0 };
    }
    function advanceLayer(spec, st, dt, mult) {
        if (spec.frozen || !spec.visible) return st;
        const sgn = spec.dir === 'cw' ? 1 : spec.dir === 'ccw' ? -1 : 0;
        st.theta = (st.theta + sgn * spec.speed * DEG * dt * mult) % TAU;
        if (spec.orbit && spec.orbit.rx + spec.orbit.ry > 0) st.orbit = (st.orbit + TAU / spec.orbit.period * dt * mult) % TAU;
        if (spec.pulse && spec.pulse.amount > 0) st.pulse = (st.pulse + TAU / spec.pulse.period * dt * mult) % TAU;
        if (spec.sampleSpin) st.spin = (st.spin + spec.sampleSpin * DEG * dt * mult) % TAU;
        return st;
    }

    /* ---------- scene ---------- */
    function createScene(preset, opts) {
        const scene = {
            preset: preset, id: preset.id, workspace: opts.workspace || 'native',
            folds: preset.folds, detail: preset.detail, background: preset.background,
            center: { x: .5, y: .5 }, motionMultiplier: 1, playing: true,
            layers: [], W: 0, H: 0, q: 1, R: 1, cx: 0, cy: 0, time: 0,
            light: Object.assign({}, preset.light)
        };
        preset.layers.forEach((spec, i) => {
            const s = clone(spec);
            s.engine = s.engine || 'native'; s.z = i;
            scene.layers.push(makeRuntime(s));
        });
        return scene;
    }
    function makeRuntime(spec) {
        return { spec, st: newState(spec), src: null, proj: null, mat: null, srcKey: '', projKey: '', E: 1, ppr: 1, bytes: 0 };
    }
    function layout(scene, W, H, q) {
        scene.W = W; scene.H = H; scene.q = q;
        scene.R = Math.min(W, H) / 2;
        scene.cx = W * scene.center.x; scene.cy = H * scene.center.y;
    }
    function extentOf(scene, spec) {
        if (spec.extent === 'full') {
            const far = Math.max(Math.hypot(scene.cx, scene.cy), Math.hypot(scene.W - scene.cx, scene.cy), Math.hypot(scene.cx, scene.H - scene.cy), Math.hypot(scene.W - scene.cx, scene.H - scene.cy));
            return Math.ceil((far / scene.R + .06) * 20) / 20;
        }
        return spec.extent;
    }
    function foldsOf(scene, spec) { return spec.folds == null ? scene.folds : spec.folds; }

    /* ---------- source + material + projection (cached) ---------- */
    function litOf(spec) {
        if (!spec || !spec.light) return false;
        const m = spec.light.mode;
        const str = typeof spec.light.strength === 'number' ? spec.light.strength : 0;
        return (m === 'light' || m === 'backlight' || m === 'both') && str > 0;
    }

    function sourceKey(scene, rt) {
        const s = rt.spec, N = foldsOf(scene, s);
        const base = s.engine === 'image' ? JSON.stringify(s.image) : (s.recipe + JSON.stringify(s.params) + scene.preset.id + scene.preset.seed + (s.recipeSeed || ''));
        return [base, N, rt.E.toFixed(2), rt.ppr.toFixed(3), scene.detail, litOf(s) ? 'L' : 'D', s.sampleSpin ? 'S' : '', s.palette || ''].join('|');
    }

    function release(rt) {
        rt.src = null; rt.mat = null; rt.proj = null; rt.srcKey = ''; rt.projKey = '';
    }

    function ensureLayer(scene, rt, frame) {
        const s = rt.spec;
        rt.E = extentOf(scene, s);
        const pxPerR = scene.R * scene.q;
        rt.ppr = Math.min(pxPerR, (MAX_SIDE / 2) / rt.E);
        const N = foldsOf(scene, s);
        const key = sourceKey(scene, rt);
        const lit = litOf(s);
        const needSrc = lit || s.engine === 'image' || s.sampleSpin;
        if (key !== rt.srcKey) {
            rt.srcKey = key; rt.projKey = '';
            rt.src = s.engine === 'image'
                ? ImageArtEngine.prepare(s.image, {})
                : NativeArtEngine.prepare(s, { preset: scene.preset, N, extent: rt.E, ppr: rt.ppr, detail: scene.detail });
            const side = Math.round(rt.E * 2 * rt.ppr);
            if (!rt.proj || rt.proj.width !== side) { rt.proj = document.createElement('canvas'); rt.proj.width = rt.proj.height = side; }
        }
        // projection key: source + light revision + sampling
        const smp = s.engine === 'image' ? [s.image.zoom, s.image.panX, s.image.panY, s.image.tileR, s.image.rot].join(',') : '';
        const modeTag = lit ? (s.light.mode || 'light') + ':' + frame.lightRev + ':' + (typeof s.light.strength === 'number' ? s.light.strength : 0) : 'D';
        const pkey = key + '|' + modeTag + '|' + smp + '|' + (s.sampleSpin ? rt.st.spin.toFixed(4) : '') + '|' + s.proj + '|' + N + '|' + JSON.stringify(s.clip || null);
        if (pkey !== rt.projKey && rt.src) {
            rt.projKey = pkey;
            let sample = { x: 0, y: 0, rot: 0, scale: 1 };
            if (s.engine === 'image') {
                const im = s.image, sc = rt.ppr * (im.tileR || 1.9) * (im.zoom || 1) / rt.src.tile;
                sample = { x: (im.panX || 0) * rt.ppr, y: (im.panY || 0) * rt.ppr, rot: ((im.rot || 0) * DEG) + rt.st.spin, scale: sc };
            } else if (s.sampleSpin) sample.rot = rt.st.spin;
            let planes = [rt.src.color];
            if (lit && frame.lightCanvas) {
                if (!rt.mat || rt.mat.width !== rt.src.width) { rt.mat = document.createElement('canvas'); rt.mat.width = rt.src.width; rt.mat.height = rt.src.height; }
                const m = rt.mat.getContext('2d');
                // only the part of the source the optics will sample (the wedge) is prepared
                const rc = s.proj === 'radial' ? LabOptics.wedgeRect(N, rt.proj.width / 2, sample, rt.src.pivot, rt.src.width, rt.src.height, .75) : { x: 0, y: 0, w: rt.src.width, h: rt.src.height };
                m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = 'source-over'; m.globalAlpha = 1;
                m.save(); m.beginPath(); m.rect(rc.x, rc.y, rc.w, rc.h); m.clip();
                m.clearRect(rc.x, rc.y, rc.w, rc.h);
                const str = typeof s.light.strength === 'number' ? s.light.strength : 0;
                const alphaStr = Math.max(0, Math.min(1, str));
                if (s.light.mode === 'backlight') {
                    // True Backlighting: Light renders BEHIND artwork
                    m.globalCompositeOperation = 'source-over';
                    m.globalAlpha = alphaStr;
                    m.drawImage(frame.lightCanvas, 0, 0, rt.mat.width, rt.mat.height);
                    m.globalCompositeOperation = 'source-over';
                    m.globalAlpha = 1;
                    m.drawImage(rt.src.color, rc.x, rc.y, rc.w, rc.h, rc.x, rc.y, rc.w, rc.h);
                } else if (s.light.mode === 'both') {
                    // Backlight + Color Tint
                    m.globalCompositeOperation = 'source-over';
                    m.globalAlpha = alphaStr;
                    m.drawImage(frame.lightCanvas, 0, 0, rt.mat.width, rt.mat.height);
                    m.globalCompositeOperation = 'source-over';
                    m.globalAlpha = 1;
                    m.drawImage(rt.src.color, rc.x, rc.y, rc.w, rc.h, rc.x, rc.y, rc.w, rc.h);
                    m.globalCompositeOperation = 'source-atop';
                    m.globalAlpha = alphaStr;
                    m.drawImage(frame.lightCanvas, 0, 0, rt.mat.width, rt.mat.height);
                } else {
                    // Existing Color Tint (mode === 'light'): Light renders on visible pixels only
                    m.drawImage(rt.src.color, rc.x, rc.y, rc.w, rc.h, rc.x, rc.y, rc.w, rc.h);
                    m.globalCompositeOperation = 'source-atop';
                    m.globalAlpha = alphaStr;
                    m.drawImage(frame.lightCanvas, 0, 0, rt.mat.width, rt.mat.height);
                }
                m.restore();
                planes = [rt.mat];
            }
            if (rt.src.finish) planes.push(rt.src.finish);
            const o = { N, pivot: rt.src.pivot, sample };
            if (s.proj === 'radial') LabOptics.projectRadial(rt.proj, planes, o);
            else LabOptics.projectIdentity(rt.proj, planes, o);
            if (s.clip) LabOptics.bakeAnnulus(rt.proj, s.clip.inner * rt.ppr, s.clip.outer * rt.ppr);   // band clip baked once, not per frame
            rt.bytes = rt.proj.width * rt.proj.height * 4 + (needSrc ? rt.src.bytes : 0) + (rt.mat ? rt.mat.width * rt.mat.height * 4 : 0);
            if (!needSrc) { rt.src = null; }   // static direct native layer: keep only the projection
        }
    }

    function poseOf(scene, rt) {
        const s = rt.spec, st = rt.st, R = scene.R;
        const ox = (s.x || 0) + (s.orbit && s.orbit.rx ? s.orbit.rx * Math.cos(st.orbit) : 0);
        const oy = (s.y || 0) + (s.orbit && s.orbit.ry ? s.orbit.ry * Math.sin(st.orbit) : 0);
        const pulse = s.pulse && s.pulse.amount ? 1 + s.pulse.amount * Math.sin(st.pulse) : 1;
        return { x: scene.cx + R * ox, y: scene.cy + R * oy, angle: st.theta, scale: s.scale || 1, pulse };
    }

    function drawLayer(scene, ctx, rt) {
        const s = rt.spec, p = poseOf(scene, rt), R = scene.R;
        if (!rt.proj) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity));
        ctx.globalCompositeOperation = s.blend || 'source-over';
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.scale(R * p.scale, R * p.scale);
        ctx.scale(p.pulse, p.pulse);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';   // cached plates are already display resolution
        ctx.drawImage(rt.proj, -rt.E, -rt.E, rt.E * 2, rt.E * 2);
        ctx.restore();
    }

    /** Resolve caches for all visible layers (may build sources) */
    function prepareScene(scene, frame) {
        for (const rt of scene.layers) {
            if (rt.spec.visible) ensureLayer(scene, rt, frame);
            else if (rt.proj && rt.spec.hiddenRelease) release(rt);
        }
    }

    function renderScene(scene, ctx, frame) {
        ctx.setTransform(scene.q, 0, 0, scene.q, 0, 0);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, scene.W, scene.H);
        if (scene.background && scene.background !== 'transparent') {
            ctx.fillStyle = scene.background;
            ctx.fillRect(0, 0, scene.W, scene.H);
        }
        const order = scene.layers.slice().sort((a, b) => (a.spec.z || 0) - (b.spec.z || 0));
        for (const rt of order) if (rt.spec.visible) { ctx.setTransform(scene.q, 0, 0, scene.q, 0, 0); drawLayer(scene, ctx, rt); }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function advanceScene(scene, dt) {
        if (!scene.playing) return;
        scene.time += dt * scene.motionMultiplier;
        for (const rt of scene.layers) advanceLayer(rt.spec, rt.st, dt, scene.motionMultiplier);
    }

    function memoryBytes(scene) { let b = 0; for (const rt of scene.layers) b += rt.bytes || 0; return b; }
    function sceneUsesLight(scene) { return scene.layers.some(rt => rt.spec.visible && litOf(rt.spec)); }

    return { createScene, layout, advanceLayer, advanceScene, prepareScene, renderScene, ensureLayer, makeRuntime, newState, memoryBytes, sceneUsesLight, release, extentOf, foldsOf, litOf, clone };
})();
