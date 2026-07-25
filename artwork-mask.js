/* ============================================================
   STAGE 2 — ARTWORK MASK
   ------------------------------------------------------------
   Takes whatever a World (Stage 1) rendered this frame and
   reveals it only through the alpha channel of the uploaded
   artwork PNG. Transparent artwork pixels stay transparent,
   opaque pixels show full animated color, semi-transparent
   pixels blend proportionally — a stained-glass-window effect,
   not a flat color overlay.

   If no artwork has been uploaded yet, render() passes the
   World's frame through untouched (fully opaque) so the app is
   usable immediately, before the user drops in a PNG.
   ============================================================ */

const ArtworkMask = (function () {
    "use strict";

    let artworkImg = null;
    let ready = false;

    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

    function setArtwork(imgElement) {
        artworkImg = imgElement;
        ready = true;
    }

    function clearArtwork() {
        artworkImg = null;
        ready = false;
    }

    function resize(w, h) {
        maskCanvas.width = w;
        maskCanvas.height = h;
    }

    // worldCanvas: the offscreen canvas Stage 1 just painted into.
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

        // 1. Draw the artwork — this defines shape + alpha (the "glass").
        maskCtx.globalCompositeOperation = 'source-over';
        maskCtx.drawImage(artworkImg, 0, 0, width, height);

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
        clearArtwork,
        resize,
        render,
        get ready() { return ready; }
    };
})();
