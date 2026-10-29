/* Sandbox optical engine: source canvas in, display canvas out. */
const OpticalEngine = (function () {
    "use strict";
    const TAU = Math.PI * 2, TRI = Math.sqrt(3) / 2;
    let canvas, ctx, cellCanvas, cellCtx, radialCanvas, radialCtx;
    let animationWidth = 800, animationHeight = 800, numTiles = 5;
    let mode = 'classic', radialFolds = 6, ringCount = 6, speed = 1;
    let orbitRate = 1, orbitAmount = 0.35, spinRate = 1, ringRate = 1, ringBreath = 0.025;
    let orbitPhase = 0, spinPhase = 0, ringTime = 0;
    function init(targetCanvas) {
        canvas = targetCanvas; ctx = canvas.getContext('2d');
        cellCanvas = document.createElement('canvas'); cellCtx = cellCanvas.getContext('2d');
        radialCanvas = document.createElement('canvas'); radialCtx = radialCanvas.getContext('2d');
    }
    function setCanvasSize(w, h) {
        animationWidth = Math.max(1, Math.round(w)); animationHeight = Math.max(1, Math.round(h));
        canvas.width = animationWidth; canvas.height = animationHeight;
    }
    function setNumTiles(n) { numTiles = Math.max(2, Math.round(Number(n) || 2)); }
    function getMaxImageWidth() { return Math.ceil(animationWidth / numTiles); }
    function setSpeed(n) { speed = Math.max(0, Math.min(5, Number(n) ?? 0)); }
    function setOrbitRate(n) { orbitRate = Math.max(0, Math.min(4, Number.isFinite(Number(n)) ? Number(n) : 1)); }
    function setOrbitAmount(n) { orbitAmount = Math.max(0, Math.min(0.8, Number.isFinite(Number(n)) ? Number(n) : 0.35)); }
    function setSpinRate(n) { spinRate = Math.max(-4, Math.min(4, Number.isFinite(Number(n)) ? Number(n) : 1)); }
    function setRingRate(n) { ringRate = Math.max(-4, Math.min(4, Number.isFinite(Number(n)) ? Number(n) : 1)); }
    function setRingBreath(n) { ringBreath = Math.max(0, Math.min(0.15, Number.isFinite(Number(n)) ? Number(n) : 0.025)); }
    function setSymmetryMode(value) { if (['classic','radial','rings','kaleido-rings'].includes(value)) mode = value; }
    function setRadialFolds(n) { radialFolds = Math.max(2, Math.min(24, Math.round(Number(n) || 2))); }
    function setRingCount(n) { ringCount = Math.max(1, Math.min(16, Math.round(Number(n) || 1))); }
    function getState() {
        return {
            mode, numTiles, radialFolds, ringCount, speed,
            orbitRate, orbitAmount, spinRate, ringRate, ringBreath,
            orbitPhase, spinPhase, ringTime, animationWidth, animationHeight
        };
    }
    // Export uses its own document/engine instance; restoring never touches the live engine.
    function restoreState(s) {
        if (!s || ![s.orbitPhase, s.spinPhase, s.ringTime].every(Number.isFinite)) throw new Error('Invalid optics snapshot');
        setSymmetryMode(s.mode); setNumTiles(s.numTiles); setRadialFolds(s.radialFolds); setRingCount(s.ringCount);
        setSpeed(s.speed); setOrbitRate(s.orbitRate); setOrbitAmount(s.orbitAmount); setSpinRate(s.spinRate); setRingRate(s.ringRate); setRingBreath(s.ringBreath);
        orbitPhase = s.orbitPhase; spinPhase = s.spinPhase; ringTime = s.ringTime;
    }
    function clear(c, w, h) { c.setTransform(1,0,0,1,0,0); c.globalCompositeOperation = 'source-over'; c.clearRect(0,0,w,h); }
    function sampleMatrix(w, h) {
        const x = w/2, y = h/2, dx = orbitAmount*w*Math.cos(orbitPhase), dy = orbitAmount*h*Math.sin(orbitPhase);
        const cs = Math.cos(spinPhase), sn = Math.sin(spinPhase);
        return new DOMMatrix([cs,sn,-sn,cs,x+dx-cs*x+sn*y,y+dy-sn*x-cs*y]);
    }
    function renderClassic(source, flipped, matrix) {
        const patDim = source.width, height = TRI * patDim, offset = 0;
        const width = 3 * patDim, patternHeight = Math.max(1, Math.floor(2 * height));
        if (cellCanvas.width !== width || cellCanvas.height !== patternHeight) {
            cellCanvas.width = width; cellCanvas.height = patternHeight;
        }
        clear(cellCtx, width, patternHeight);
        const pat = cellCtx.createPattern(source, 'repeat');
        const patR = cellCtx.createPattern(flipped, 'repeat');
        if (!pat || !patR) return;
        pat.setTransform(matrix);
        const flip = new DOMMatrix([-1,0,0,1,patDim,0]);
        patR.setTransform(flip.multiply(matrix).multiply(flip));
        cellCtx.save(); cellCtx.translate(-0.5 * patDim, 0);
        const fn = function (alternateMode) {
            let i = 0;

            // draw kaleidoscope first row.
            cellCtx.save();
            cellCtx.fillStyle = pat;
            cellCtx.translate(0, offset);
            while (i <= 3) {
                cellCtx.beginPath();
                cellCtx.moveTo(0, -offset);
                cellCtx.lineTo(patDim, -offset);
                cellCtx.lineTo(0.5 * patDim, height - offset);
                cellCtx.closePath();
                cellCtx.fill();
                if (i % 3 == 0) {
                    cellCtx.translate(patDim, -offset);
                    cellCtx.rotate(-120 * Math.PI / 180);
                    cellCtx.translate(-patDim, offset);
                }
                else if (i % 3 == 1) {
                    if (alternateMode) {
                        cellCtx.rotate(120 * Math.PI / 180);
                        cellCtx.translate(-3 * patDim, 0);
                        cellCtx.rotate(-120 * Math.PI / 180);
                    }
                    cellCtx.translate(0.5 * patDim, height - offset);
                    cellCtx.rotate(-120 * Math.PI / 180);
                    cellCtx.translate(-0.5 * patDim, -height + offset);
                }
                else if (i % 3 == 2) {
                    cellCtx.translate(0, -offset);
                    cellCtx.rotate(-120 * Math.PI / 180);
                    cellCtx.translate(0, offset);
                }
                i++;
            }

            cellCtx.restore();
            cellCtx.save();
            cellCtx.scale(-1, -1);
            cellCtx.fillStyle = patR;
            cellCtx.translate((-i + (i % 3 == 0 ? 0.5 : i % 3 == 1 ? 1.5 : -0.5)) * patDim, -height + offset);
            cellCtx.translate(0, -offset);
            cellCtx.rotate(120 * Math.PI / 180);
            cellCtx.translate(0, offset);

            let j = 0;
            while (j < i + 1) {
                cellCtx.beginPath();
                if (j > 0 || !alternateMode) {
                    cellCtx.moveTo(0, -offset);
                    cellCtx.lineTo(patDim, -offset);
                    cellCtx.lineTo(0.5 * patDim, height - offset);
                    cellCtx.closePath();
                    cellCtx.fill();
                }
                if (j % 3 == 1) {
                    cellCtx.translate(patDim, -offset);
                    cellCtx.rotate(-120 * Math.PI / 180);
                    cellCtx.translate(-patDim, offset);
                }
                else if (j % 3 == 2) {
                    cellCtx.translate(0.5 * patDim, height - offset);
                    cellCtx.rotate(-120 * Math.PI / 180);
                    cellCtx.translate(-0.5 * patDim, -height + offset);
                }
                else if (j % 3 == 0) {
                    cellCtx.translate(0, -offset);
                    cellCtx.rotate(-120 * Math.PI / 180);
                    cellCtx.translate(0, offset);
                }
                j++;
            }

            cellCtx.restore();
        };

        fn(false);
        cellCtx.translate(1.5 * patDim, height);
        fn(true);
        cellCtx.restore();
        for (let y = 0; y < animationHeight; y += patternHeight)
            for (let x = 0; x < animationWidth; x += width)
                ctx.drawImage(cellCanvas, x, y);
    }
    function renderRadial(target, width, height, source, matrix) {
        clear(target, width, height);
        const pat = target.createPattern(source, 'repeat');
        if (!pat) return;
        pat.setTransform(matrix);
        const alpha = Math.PI / radialFolds;
        const radius = Math.hypot(width, height) + 2;
        for (let k = 0; k < 2 * radialFolds; k++) {
            target.save(); target.translate(width/2, height/2); target.rotate(k * alpha);
            if (k % 2) { target.rotate(alpha); target.scale(1,-1); }
            target.beginPath(); target.moveTo(0,0); target.arc(0,0,radius,0,alpha); target.closePath();
            target.fillStyle = pat; target.fill(); target.restore();
        }
    }
    function renderRings(source) {
        const cx = animationWidth/2, cy = animationHeight/2;
        const radius = Math.hypot(cx, cy) + 2;
        // Cover the full bounding square despite rotation, breathing and drift.
        const baseScale = 2 * radius / Math.min(source.width, source.height) * 1.15;
        const ringDrift = orbitAmount * (0.025 / 0.35);
        for (let i = 0; i < ringCount; i++) {
            const outer = radius * (i+1) / ringCount, inner = radius * i / ringCount;
            const direction = i % 2 ? -1 : 1;
            const angle = direction * ringTime * (0.08 + i * 0.025);
            const breathing = 1 + ringBreath * Math.sin(ringTime * 0.35 + i * 0.7);
            ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, outer, 0, TAU);
            if (inner > 0) { ctx.moveTo(cx + inner, cy); ctx.arc(cx, cy, inner, 0, TAU); }
            ctx.clip('evenodd');
            ctx.translate(cx, cy); ctx.rotate(angle);
            ctx.scale(baseScale * breathing, baseScale * breathing);
            ctx.translate(ringDrift * source.width * Math.cos(orbitPhase), ringDrift * source.height * Math.sin(orbitPhase));
            ctx.drawImage(source, -source.width/2, -source.height/2); ctx.restore();
        }
    }
    function renderFrame(source, flipped, deltaSeconds = 1/60) {
        if (!source || !flipped || !source.width || !source.height) return;
        const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(.05, deltaSeconds)) : 0;
        orbitPhase = (orbitPhase + (.35 * orbitRate * speed * dt) + TAU) % TAU;
        spinPhase = (spinPhase + (.12 * spinRate * speed * dt) + TAU) % TAU;
        // Reducing the period avoids indefinitely growing angles. Multipliers are rational.
        ringTime = (ringTime + (ringRate * speed * dt) + (TAU * 800)) % (TAU * 800);
        clear(ctx, animationWidth, animationHeight);
        const matrix = sampleMatrix(source.width, source.height);
        if (mode === 'classic') renderClassic(source, flipped, matrix);
        else if (mode === 'radial') renderRadial(ctx, animationWidth, animationHeight, source, matrix);
        else if (mode === 'rings') renderRings(source);
        else {
            const side = Math.ceil(Math.hypot(animationWidth, animationHeight)) + 4;
            if (radialCanvas.width !== side || radialCanvas.height !== side) { radialCanvas.width = side; radialCanvas.height = side; }
            renderRadial(radialCtx, side, side, source, matrix);
            renderRings(radialCanvas);
        }
    }
    function saveImage() {
        const link = document.createElement('a'); link.href = canvas.toDataURL();
        link.download = `kaleidoscope_${Date.now()}.png`; link.click();
    }
    return {
        init, setCanvasSize, setNumTiles, getMaxImageWidth, setSpeed,
        setOrbitRate, setOrbitAmount, setSpinRate, setRingRate, setRingBreath,
        setSymmetryMode, setRadialFolds, setRingCount, getState, restoreState, renderFrame, saveImage
    };
})();
