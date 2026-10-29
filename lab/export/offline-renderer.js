/* Offline coordinator. No UI, storage, encoder or editor clock changes.
 * const snapshot = AnimaLab.captureOfflineSnapshot();
 * const job = await AnimaOfflineRenderer.create(snapshot, {width:1920,height:1080,fps:30,seed:1});
 * await job.run(300, async frame => { ...consume frame.canvas before next frame... });
 * job.dispose();
 */
window.AnimaOfflineRenderer = (() => {
    'use strict';
    const hostURL = new URL('renderer-host.html', document.currentScript.src).href;
    function copyCanvas(source) {
        const c = document.createElement('canvas'); c.width = source.width; c.height = source.height;
        c.getContext('2d').drawImage(source, 0, 0); return c;
    }
    function capture(scene, context) {
        if (!scene) throw new Error('No current scene');
        // Clone all scene metadata/spec fields, but never clone or reuse live caches.
        const data = structuredClone({ ...scene, layers: scene.layers.map(rt => ({ spec: rt.spec, st: rt.st })) });
        const ids = new Set(data.layers.filter(rt => rt.spec.engine === 'image').map(rt => rt.spec.image.assetId));
        const assets = [...ids].map(id => {
            const a = ImageArtEngine.assets.get(id);
            if (!a || !a.blob || !a.source) throw new Error('Cannot snapshot image asset: ' + id);
            return { id, name: a.name, blob: a.blob, width: a.width, height: a.height, source: copyCanvas(a.source) };
        });
        return { version: 1, kind: context.kind, scene: data, assets,
            world: structuredClone(context.world), lightAcc: context.lightAcc,
            lightRev: context.frame.lightRev, lightCanvas: copyCanvas(context.frame.lightCanvas),
            fusion: context.fusion ? structuredClone(context.fusion) : null };
    }
    async function create(snapshot, options = {}) {
        const width = options.width ?? 1920, height = options.height ?? 1080, fps = options.fps ?? 30;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16777216) throw new Error('Invalid output dimensions (maximum 16M pixels)');
        if (!Number.isFinite(fps) || fps < 20 || fps > 120) throw new Error('FPS must be 20..120 (Sandbox dt is capped at 0.05s)');
        if (snapshot.version !== 1) throw new Error('Unsupported offline snapshot');
        // Freeze the caller's packet before the first await, including mutable canvas resources.
        const packet = { ...structuredClone({ ...snapshot, assets: [], lightCanvas: null }),
            lightCanvas: copyCanvas(snapshot.lightCanvas), assets: snapshot.assets.map(a => ({ ...a, source: copyCanvas(a.source) })) };
        const iframe = document.createElement('iframe');
        iframe.hidden = true; iframe.setAttribute('aria-hidden', 'true');
        let timeout;
        try {
            await new Promise((resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('Offline engine document timed out')), 15000);
                iframe.onload = resolve; iframe.onerror = () => reject(new Error('Offline engine document failed to load'));
                iframe.src = hostURL; document.body.appendChild(iframe);
            });
            clearTimeout(timeout);
            const runtime = iframe.contentWindow.AnimaOfflineHost;
            if (!runtime) throw new Error('Offline engine scripts did not load');
            runtime.init(packet, { ...options, width, height, fps, seed: options.seed ?? 1 });
            let disposed = false, running = false;
            function alive() { if (disposed) throw new Error('Renderer disposed'); }
            return {
                get canvas() { alive(); return runtime.canvas; },
                get state() { alive(); return runtime.inspect(); },
                next() { alive(); if (running) throw new Error('run() owns frame advancement'); return runtime.next(); },
                async run(count, consume, signal) {
                    alive();
                    if (running || !Number.isInteger(count) || count < 0) throw new Error('Invalid render run');
                    running = true;
                    try {
                        for (let i = 0; i < count; i++) {
                            alive();
                            if (signal?.aborted) throw new DOMException('Offline render aborted', 'AbortError');
                            const frame = runtime.next();
                            // Consumer backpressure; a future VideoFrame/encoder must own/copy pixels here.
                            if (consume) await consume(frame);
                            // Yield for cancellation/UI responsiveness, never to pace the virtual clock.
                            if ((i + 1) % 30 === 0) await new Promise(r => setTimeout(r, 0));
                        }
                    } finally { running = false; }
                },
                dispose() { if (!disposed) { disposed = true; runtime.dispose(); iframe.remove(); } }
            };
        } catch (error) { clearTimeout(timeout); iframe.remove(); throw error; }
    }
    return { capture, create };
})();
