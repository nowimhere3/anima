/* ============================================================
   IMAGE ART ENGINE (Engine B) — user-imported pictures
   Assets keep an immutable original Blob + decoded bitmap. Layers prepare
   non-destructive working tiles: crop / fit / mirror / alpha mode / tint.
   Original RGB and alpha are preserved by default. A mirror-repeat atlas
   (3x3 normal / flipped neighbours) keeps edge colours aligned so zooming
   out never reveals holes. Everything is session-local (no storage).
   ============================================================ */
const ImageArtEngine = (function () {
    "use strict";
    const assets = new Map();
    let nextId = 1;
    const MAX_DECODE = 2048;

    async function importFile(file) {
        if (!file || !/^image\//.test(file.type || 'image/png')) throw new Error('Not an image: ' + (file && file.name));
        let bmp, w, h;
        if (window.createImageBitmap) {
            bmp = await createImageBitmap(file);
            w = bmp.width; h = bmp.height;
        } else {
            const url = URL.createObjectURL(file);
            try {
                bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
            } finally { URL.revokeObjectURL(url); }
            w = bmp.naturalWidth; h = bmp.naturalHeight;
        }
        // bounded working copy (transient full decode is released after downsample)
        let work = bmp;
        if (Math.max(w, h) > MAX_DECODE) {
            const s = MAX_DECODE / Math.max(w, h), cv = document.createElement('canvas');
            cv.width = Math.round(w * s); cv.height = Math.round(h * s);
            cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
            if (bmp.close) bmp.close();
            work = cv; w = cv.width; h = cv.height;
        }
        const rec = { id: 'img' + (nextId++), name: file.name || 'image', blob: file, source: work, width: w, height: h };
        assets.set(rec.id, rec);
        return rec;
    }
    function removeAsset(id) {
        const a = assets.get(id);
        if (a && a.source && a.source.close) a.source.close();
        assets.delete(id);
    }

    /**
     * spec: {assetId, crop:{x,y,w,h} normalized, fit:'cover'|'contain', mirrorX, mirrorY,
     *        alphaMode:'original'|'legacy-luma', tint:'#rrggbb'|null, tintStrength, repeat:'mirror-repeat'|'none'}
     * returns packet {color, width, height, pivot, tile}
     */
    function prepare(spec, opts) {
        const a = assets.get(spec.assetId);
        if (!a) throw new Error('Unknown asset ' + spec.assetId);
        const S = opts && opts.tile || Math.min(768, Math.max(256, Math.max(a.width, a.height)));
        const crop = spec.crop || { x: 0, y: 0, w: 1, h: 1 };
        const sx = crop.x * a.width, sy = crop.y * a.height, sw = Math.max(1, crop.w * a.width), sh = Math.max(1, crop.h * a.height);
        const k = (spec.fit === 'contain' ? Math.min : Math.max)(S / sw, S / sh);
        const dw = sw * k, dh = sh * k;
        const tile = document.createElement('canvas'); tile.width = tile.height = S;
        const t = tile.getContext('2d');
        t.imageSmoothingQuality = 'high';
        t.save();
        t.translate(S / 2, S / 2); t.scale(spec.mirrorX ? -1 : 1, spec.mirrorY ? -1 : 1);
        t.drawImage(a.source, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);   // nine-argument crop in source coords
        t.restore();
        if (spec.alphaMode === 'legacy-luma') {
            const id = t.getImageData(0, 0, S, S), d = id.data;
            for (let i = 0; i < d.length; i += 4) d[i + 3] = Math.round(d[i + 3] * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
            t.putImageData(id, 0, 0);
        }
        if (spec.tint && spec.tintStrength > 0) {
            t.save(); t.globalCompositeOperation = 'source-atop'; t.globalAlpha = spec.tintStrength; t.fillStyle = spec.tint; t.fillRect(0, 0, S, S); t.restore();
        }
        let out = tile, W = S;
        if (spec.repeat !== 'none') {
            W = S * 3;
            out = document.createElement('canvas'); out.width = out.height = W;
            const o = out.getContext('2d');
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                o.save();
                o.translate(S * (dx + 1) + S / 2, S * (dy + 1) + S / 2);
                o.scale(dx ? -1 : 1, dy ? -1 : 1);
                o.drawImage(tile, -S / 2, -S / 2);
                o.restore();
            }
        }
        return { id: spec.assetId, color: out, finish: null, width: W, height: W, pivot: { x: W / 2, y: W / 2 }, tile: S, bytes: W * W * 4 + S * S * 4 };
    }

    return { assets, importFile, removeAsset, prepare };
})();
