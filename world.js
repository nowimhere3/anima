/* ============================================================
   WORLD
   ------------------------------------------------------------
   This is the "RPG" color engine — one specific World (palettes /
   RGB base layer, minus the fractal overlay layer), ported
   unchanged in behavior from the source lighting-engine prototype.
   It's the first of what will eventually be many Worlds.

   Contract every World must implement:
     - update(dt, speedMultiplier)   -> advances internal time
     - render(ctx, width, height)    -> paints the current frame
                                          into the given 2D context

   A World has no idea who consumes its output — it doesn't know
   Mask or Optics exist. That's what makes future Worlds (Plasma,
   Fire, Clouds, Water, Nebula, ...) swappable in main.js: point
   the pipeline at a different object implementing this same
   update()/render() shape.

   Pipeline: World -> Mask -> Optics -> Display
   ============================================================ */

const World = (function () {
    "use strict";

    // ---- preset list (RGB base layer, "palette" selection) ----
    const rgbList = [
        'chroma-spectrum',
        'chroma-pulse',
        'chroma-aurora',
        'chroma-hypershift',
        'chroma-breathing',
        'rainbow-wave',
        'spiral-rainbow',
        'cascading-rainbow',
        'logi-lightsync',
        'msi-mystic',
        'nzxt-cam',
        'breath-spectrum'
    ];

    // state for chroma-breathing's hue-shift-on-exhale behavior
    let currentBreathHue = 135;
    let prevBreathCycle = -1;

    let activeRGB = 'chroma-spectrum';
    let isMasterAllMode = false;
    let masterModeType = null; // 'smooth' | 'chaos'
    let time = 0;

    function setActiveRGB(id) {
        if (rgbList.includes(id)) {
            disableMasterMode();
            activeRGB = id;
        }
    }

    function toggleMasterMode(type) {
        if (isMasterAllMode && masterModeType === type) {
            disableMasterMode();
        } else {
            isMasterAllMode = true;
            masterModeType = type;
        }
    }

    function disableMasterMode() {
        isMasterAllMode = false;
        masterModeType = null;
    }

    function updateMasterAllCycle() {
        const stepTime = 5; // change preset every 5s (unscaled world-time)
        const step = Math.floor(time / stepTime);

        if (masterModeType === 'smooth') {
            activeRGB = rgbList[step % rgbList.length];
        } else { // chaos
            const seedR = Math.abs(Math.sin(step * 91.3));
            activeRGB = rgbList[Math.floor(seedR * rgbList.length)];
        }
    }

    function update(dt, speedMultiplier) {
        time += dt * Math.max(speedMultiplier, 0);
        if (isMasterAllMode) updateMasterAllCycle();
    }

    /* ------------------------------------------------------------------
       RGB BASE LAYERS (verbatim logic from the source prototype,
       parameterized on ctx/width/height/time instead of closured globals)
    ------------------------------------------------------------------ */
    function drawRGBBase(type, c, width, height) {
        switch (type) {
            case 'chroma-spectrum': {
                const hue = (time * 80) % 360;
                const gradS = c.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, Math.max(width, height) * 0.7);
                gradS.addColorStop(0, `hsl(${hue}, 100%, 65%)`);
                gradS.addColorStop(0.5, `hsl(${(hue + 40) % 360}, 100%, 45%)`);
                gradS.addColorStop(1, `hsl(${(hue + 90) % 360}, 100%, 25%)`);
                c.fillStyle = gradS; c.fillRect(0, 0, width, height);
                break;
            }

            case 'chroma-pulse': {
                c.fillStyle = '#030308'; c.fillRect(0, 0, width, height);
                const baseHueP = (time * 70) % 360;
                for (let i = 5; i >= 1; i--) {
                    const radius = (Math.max(width, height) * 0.6 / 5) * i * (Math.sin(time * 2.5 + i * 0.8) * 0.2 + 1);
                    const gradP = c.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius);
                    gradP.addColorStop(0, `hsla(${(baseHueP + i * 45) % 360}, 100%, 60%, 0.8)`);
                    gradP.addColorStop(1, 'transparent');
                    c.fillStyle = gradP; c.beginPath(); c.arc(width / 2, height / 2, radius, 0, Math.PI * 2); c.fill();
                }
                break;
            }

            case 'chroma-aurora': {
                c.fillStyle = '#020206'; c.fillRect(0, 0, width, height);
                const h1 = (time * 50) % 360, h2 = (h1 + 120) % 360;
                const x1 = width * 0.3 + Math.sin(time * 1.2) * (width * 0.2), y1 = height * 0.4 + Math.cos(time * 0.8) * (height * 0.2);
                const x2 = width * 0.7 + Math.cos(time * 1.5) * (width * 0.2), y2 = height * 0.6 + Math.sin(time * 1.1) * (height * 0.2);
                const g1 = c.createRadialGradient(x1, y1, 20, x1, y1, width * 0.55); g1.addColorStop(0, `hsla(${h1}, 100%, 60%, 0.85)`); g1.addColorStop(1, 'transparent');
                const g2 = c.createRadialGradient(x2, y2, 20, x2, y2, width * 0.55); g2.addColorStop(0, `hsla(${h2}, 100%, 55%, 0.85)`); g2.addColorStop(1, 'transparent');
                c.fillStyle = g1; c.fillRect(0, 0, width, height); c.fillStyle = g2; c.fillRect(0, 0, width, height);
                break;
            }

            case 'chroma-hypershift': {
                const baseHueH = (time * 110) % 360;
                const gradH = c.createRadialGradient(width * 0.5 + Math.sin(time * 2) * (width * 0.3), height * 0.5 + Math.cos(time * 2) * (height * 0.3), 10, width / 2, height / 2, Math.max(width, height));
                gradH.addColorStop(0, `hsl(${baseHueH}, 100%, 65%)`); gradH.addColorStop(0.5, `hsl(${(baseHueH + 120) % 360}, 100%, 50%)`); gradH.addColorStop(1, `hsl(${(baseHueH + 240) % 360}, 100%, 35%)`);
                c.fillStyle = gradH; c.fillRect(0, 0, width, height);
                break;
            }

            case 'rainbow-wave': {
                const angle = time * 0.5;
                const gradW = c.createLinearGradient(width / 2 + Math.cos(angle) * width, height / 2 + Math.sin(angle) * height, width / 2 - Math.cos(angle) * width, height / 2 - Math.sin(angle) * height);
                for (let i = 0; i <= 10; i++) gradW.addColorStop(i / 10, `hsl(${((time * 60) + i * 36) % 360}, 100%, 55%)`);
                c.fillStyle = gradW; c.fillRect(0, 0, width, height);
                break;
            }

            case 'spiral-rainbow': {
                const gradSp = c.createConicGradient(time * 1.5, width / 2, height / 2);
                for (let i = 0; i <= 12; i++) gradSp.addColorStop(i / 12, `hsl(${((time * 75) + i * 30) % 360}, 100%, 55%)`);
                c.fillStyle = gradSp; c.fillRect(0, 0, width, height);
                break;
            }

            case 'cascading-rainbow': {
                const gradC = c.createLinearGradient(0, 0, width * 0.5, height);
                for (let i = 0; i <= 10; i++) gradC.addColorStop(i / 10, `hsl(${((time * 80) + i * 36) % 360}, 100%, 55%)`);
                c.fillStyle = gradC; c.fillRect(0, 0, width, height);
                break;
            }

            case 'chroma-breathing': {
                const breathVal = Math.sin(time * 2);
                const bLum = Math.max(0, breathVal);
                const breathCycleIndex = Math.floor(time * 2 / (Math.PI * 2));

                if (breathCycleIndex !== prevBreathCycle && breathVal < -0.95) {
                    currentBreathHue = (currentBreathHue + 75 + Math.floor(Math.random() * 120)) % 360;
                    prevBreathCycle = breathCycleIndex;
                }

                const bGrad = c.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, Math.max(width, height) * 0.7);
                bGrad.addColorStop(0, `hsla(${currentBreathHue}, 100%, ${65 * bLum}%, 1)`);
                bGrad.addColorStop(1, `hsla(${currentBreathHue}, 100%, ${10 * bLum}%, 1)`);
