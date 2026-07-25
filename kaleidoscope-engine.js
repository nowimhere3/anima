/* ============================================================
   STAGE 3 — KALEIDOSCOPE ENGINE
   ------------------------------------------------------------
   This is the original Colliding Scopes algorithm (credit: Luke
   Hannam, https://www.pepperoni.blog/canvas-kaleidoscope/),
   preserved as closely as possible:
     - mirror math
     - triangle generation
     - pattern generation
     - tile() replication

   The ONLY structural change: the original built a canvas
   pattern ONCE from a static <img>, then just translated it
   frame to frame. Here the pattern source (Stage 2's masked
   artwork canvas) is itself animating every frame, so the
   pattern is rebuilt from the current tile canvas each frame
   instead of once at setup. Everything downstream of that
   (fn(), tile(), the offset/rotation math) is untouched.

   This engine has no idea a "World" or an "Artwork Mask" exist.
   It only knows: "give me a tile canvas + its horizontal flip,
   I'll mirror and tile it." That's the seam that keeps future
   Worlds pluggable without ever touching this file again.
   ============================================================ */

const KaleidoscopeEngine = (function () {
    "use strict";

    const SqrtOf3_4 = Math.sqrt(3) / 2;

    let canvas, ctx;
    let animationWidth = 800;
    let animationHeight = 800;
    let numTiles = 5;
    let patDim = 400;

    // larger value give longer animation before restarting loop (unchanged from original)
    const animationLength = 600;
    // larger values give larger movement between animation frames (unchanged from original)
    const animationStep = 1.5;

    let animationSpeed = 2000; // larger value gives slower animation
    let counter = animationSpeed * 0.5; // animation start point

    function init(targetCanvas) {
        canvas = targetCanvas;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
    }

    function setCanvasSize(w, h) {
        animationWidth = w;
        animationHeight = h;
        canvas.width = w;
        canvas.height = h;
    }

    function setNumTiles(n) {
        numTiles = n;
    }

    function getMaxImageWidth() {
        return Math.ceil(animationWidth / numTiles);
    }

    // Single master-speed control (0..2, same range as the RPG engine's
    // speed slider) mapped onto the original animationSpeed formula,
    // which used a 1..15 "speedInputValue". larger animationSpeed = slower.
    function setSpeed(masterSpeed) {
        const speedInputValue = Math.max(0.1, masterSpeed) * 5; // 0..2 -> 0.5..10, matches original 1..15 feel
        animationSpeed = 8000 / speedInputValue * (numTiles / 2.5);
    }

    // tileCanvas / flippedTileCanvas: the current frame's masked-artwork
    // tile and its horizontal mirror (both produced upstream by Stage 2).
    function renderFrame(tileCanvas, flippedTileCanvas) {
        patDim = tileCanvas.width;
        const height = SqrtOf3_4 * patDim;

        const pat = ctx.createPattern(tileCanvas, "repeat");
        const patR = ctx.createPattern(flippedTileCanvas, "repeat");

        const offset = Math.sin(counter / animationSpeed * Math.PI) * animationLength; // forward then backward
        counter++;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(-0.5 * patDim, 0);

        const fn = function (alternateMode) {
            let i = 0;

            // draw kaleidoscope first row.
            ctx.save();
            ctx.fillStyle = pat;
            ctx.translate(0, offset);
            while (i <= 3) {
                ctx.beginPath();
                ctx.moveTo(0, -offset);
                ctx.lineTo(patDim, -offset);
                ctx.lineTo(0.5 * patDim, height - offset);
                ctx.closePath();
                ctx.fill();
                if (i % 3 == 0) {
                    ctx.translate(patDim, -offset);
                    ctx.rotate(-120 * Math.PI / 180);
                    ctx.translate(-patDim, offset);
                }
                else if (i % 3 == 1) {
                    if (alternateMode) {
                        ctx.rotate(120 * Math.PI / 180);
                        ctx.translate(-3 * patDim, 0);
                        ctx.rotate(-120 * Math.PI / 180);
                    }
                    ctx.translate(0.5 * patDim, height - offset);
                    ctx.rotate(-120 * Math.PI / 180);
                    ctx.translate(-0.5 * patDim, -height + offset);
                }
                else if (i % 3 == 2) {
                    ctx.translate(0, -offset);
                    ctx.rotate(-120 * Math.PI / 180);
                    ctx.translate(0, offset);
                }
                i++;
            }

            ctx.restore();
            ctx.save();
            ctx.scale(-1, -1);
            ctx.fillStyle = patR;
            ctx.translate((-i + (i % 3 == 0 ? 0.5 : i % 3 == 1 ? 1.5 : -0.5)) * patDim, -height + offset);
            ctx.translate(0, -offset);
            ctx.rotate(120 * Math.PI / 180);
            ctx.translate(0, offset);

            let j = 0;
            while (j < i + 1) {
                ctx.beginPath();
                if (j > 0 || !alternateMode) {
                    ctx.moveTo(0, -offset);
                    ctx.lineTo(patDim, -offset);
                    ctx.lineTo(0.5 * patDim, height - offset);
                    ctx.closePath();
                    ctx.fill();
                }
                if (j % 3 == 1) {
                    ctx.translate(patDim, -offset);
                    ctx.rotate(-120 * Math.PI / 180);
                    ctx.translate(-patDim, offset);
                }
                else if (j % 3 == 2) {
                    ctx.translate(0.5 * patDim, height - offset);
                    ctx.rotate(-120 * Math.PI / 180);
                    ctx.translate(-0.5 * patDim, -height + offset);
                }
                else if (j % 3 == 0) {
                    ctx.translate(0, -offset);
                    ctx.rotate(-120 * Math.PI / 180);
                    ctx.translate(0, offset);
                }
                j++;
            }

            ctx.restore();
        };

        const patternHeight = Math.floor(SqrtOf3_4 * patDim * 2);

        // tile function makes the animation fill up the whole canvas width/height
        const tile = function () {
            const rowData = ctx.getImageData(0, 0, patDim * 3, patternHeight);
            for (let i = 0; patternHeight * i < animationHeight + SqrtOf3_4 * patDim; i++) {
                for (let j = 0; j * patDim < animationWidth + patDim; j += 3) {
                    ctx.putImageData(rowData, j * patDim, i * patternHeight);
                }
            }
        };

        fn(false);
        ctx.translate(animationStep * patDim, height);
        fn(true);
        ctx.translate(animationStep * -1 * patDim, -height);
        tile();

        ctx.restore();
    }

    // screenshot of current canvas state, unchanged from original saveImage()
    function saveImage() {
        const link = document.createElement('a');
        link.href = canvas.toDataURL();
        const date = new Date();
        link.download = `kaleidoscope_${date.toLocaleDateString()}_${date.toLocaleTimeString()}.png`;
        link.click();
    }

    return {
        init,
        setCanvasSize,
        setNumTiles,
        setSpeed,
        getMaxImageWidth,
        renderFrame,
        saveImage
    };
})();
