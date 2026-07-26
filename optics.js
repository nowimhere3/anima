/* ============================================================
   OPTICAL ENGINE
   ------------------------------------------------------------
   Performs optical transforms — kaleidoscope today, and room for
   teleidoscope / mirror / tunnel modes later. Its ONLY input is a
   generic Source Canvas (plus that canvas's horizontal flip). It
   never knows about RPG colors, palettes, World, or Mask — it
   doesn't know a "color engine" or an "artwork PNG" exist. As far
   as this file is concerned, a Source Canvas could have come from
   any World, through any Mask, or from nowhere at all.

   That's the whole point: this engine is reusable for every
   future World without ever being touched again.

   The current mode, "kaleidoscope," is the original Colliding
   Scopes algorithm (credit: Luke Hannam,
   https://www.pepperoni.blog/canvas-kaleidoscope/), preserved as
   closely as possible:
     - mirror math
     - triangle generation
     - pattern generation
     - tile() replication

   The ONLY structural change from the original: it used to build
   a canvas pattern ONCE from a static <img>, then just translate
   it frame to frame. Here the Source Canvas is itself animating
   every frame (it came from a World via a Mask), so the pattern
   is rebuilt from the current Source Canvas each frame instead of
   once at setup. Everything downstream of that (fn(), tile(), the
   offset/rotation math) is untouched.

   Pipeline: World -> Mask -> Optics -> Display
   ============================================================ */

const OpticalEngine = (function () {
    "use strict";

    // Only one mode exists today. Future modes (teleidoscope, mirror
    // tunnels, etc.) would be added as siblings to renderFrame() /
    // selected via a setMode()-style entry point, without changing
    // the fact that this engine only ever consumes a Source Canvas.
    const MODE = 'kaleidoscope';

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

    // sourceCanvas / flippedSourceCanvas: this frame's Source Canvas and
    // its horizontal mirror. Where they came from is none of this
    // engine's business — could be World -> Mask, could be anything else
    // that produces a canvas.
    function renderFrame(sourceCanvas, flippedSourceCanvas) {
        patDim = sourceCanvas.width;
        const height = SqrtOf3_4 * patDim;

        const pat = ctx.createPattern(sourceCanvas, "repeat");
        const patR = ctx.createPattern(flippedSourceCanvas, "repeat");

        const offset = Math.sin(counter / animationSpeed * Math.PI) * animationLength; // forward then backward
        counter++;

        // The original algorithm never cleared between frames — it could
        // rely on every pixel in the pattern-fill region being fully
        // opaque every frame (photos have no alpha), so each frame's
        // fill()/tile() fully overwrote the last. Our Source Canvas can
        // now be partially transparent (Stage 2's artwork mask), so
        // without this clear, transparent regions of the pattern would
        // leave old opaque pixels showing underneath forever — the
        // canvas would visually "fill in" solid and the mirrored
        // structure would stop being distinguishable from a flat
        // masked color field. Clearing
