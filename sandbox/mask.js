/* ============================================================
   MASK
   ------------------------------------------------------------
   Takes whatever a World rendered this frame and reveals it
   only through the alpha channel of the uploaded artwork PNG.
   Transparent artwork pixels stay transparent, opaque pixels
   show full animated color, semi-transparent pixels blend
   proportionally â€” a stained-glass-window effect, not a flat
   color overlay.

   If no artwork has been uploaded yet, render() passes the
   World's frame through untouched (fully opaque) so the app is
   usable immediately, before the user drops in a PNG.

   Mask doesn't know which World produced its input, and it
   doesn't know Optics will consume its output â€” it just knows
   "canvas in, masked canvas out."

   Pipeline: World -> Mask -> Optics -> Display
   ============================================================ */

const Mask = (function () {
    "use strict";

    let artworkImg = null;
    let ready = false;
    let luminanceEnabled = false;
    let luminanceArtwork = null;

    // This one-time readback happens only on artwork changes or first enable,
    // never in the animation loop. Retain original alpha when deriving coverage.
    function prepareLuminanceArtwork() {
        if (!artworkImg || luminanceArtwork) return;
        const processed = document.createElement('canvas');
        processed.width = artworkImg.naturalWidth || artworkImg.width;
        processed.height = artworkImg.naturalHeight || artworkImg.height;
        const c = processed.getContext('2d', { willReadFrequently: true });
        c.drawImage(artworkImg, 0, 0);
        const pixels = c.getImageData(0, 0, processed.width, processed.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
            const luminance = (0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2]) / 255;
            pixels.data[i + 3] = Math.round(pixels.data[i + 3] * luminance);
        }
        c.putImageData(pixels, 0, 0);
        luminanceArtwork = processed;
    }
    function setLuminanceEnabled(enabled) {
        luminanceEnabled = Boolean(enabled);
        if (luminanceEnabled) prepareLuminanceArtwork();
    }

    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d');

    function setArtwork(imgElement) {
        artworkImg = imgElement;
        luminanceArtwork = null;
        if (luminanceEnabled) prepareLuminanceArtwork();
        ready = true;
    }

    function clearArtwork() {
        artworkImg = null;
        luminanceArtwork = null;
        ready = false;
    }

    function resize(w, h) {
        maskCanvas.width = w;
        maskCanvas.height = h;
    }

    // worldCanvas: the offscreen canvas the current World just painted into.
    // Returns maskCanvas: the animated, color-filled artwork tile.
    function render(worldCanvas, width, height) {
        if (maskCanvas.width !== width || maskCanvas.height !== height) {
            resize(width, height);
        }

        maskCtx.clearRect(0, 0, width, height);

        if (!ready || !artworkImg) {
            // Pass-through: no artwork yet, show the raw animated World.
            maskCtx.globalCompositeOperation = 'source-over';
            maskCtx.drawImage(worldCanvas, 0, 0, width, height);
            return maskCanvas;
        }

        // 1. Draw the artwork â€” this defines shape + alpha (the "glass").
        maskCtx.globalCompositeOperation = 'source-over';
        maskCtx.drawImage(luminanceEnabled ? luminanceArtwork : artworkImg, 0, 0, width, height);

        // 2. Draw the animated World, keeping only pixels that overlap
        //    the artwork's alpha ("source-in": result alpha = artwork
        //    alpha * world alpha, result color = world color). This is
        //    the "moving light behind the glass" step.
        maskCtx.globalCompositeOperation = 'source-in';
        maskCtx.drawImage(worldCanvas, 0, 0, width, height);

        maskCtx.globalCompositeOperation = 'source-over';
        return maskCanvas;
    }

    return {
        setArtwork,
        setLuminanceEnabled,
        clearArtwork,
        resize,
        render,
        get ready() { return ready; }
    };
})();

