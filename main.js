/* ============================================================
   MAIN — wiring + render loop
   ------------------------------------------------------------
   Pipeline every frame:

       World  ->  Mask  ->  Optics  ->  Display

       World.update/render  ->  Mask.render  ->  OpticalEngine.renderFrame  ->  canvas on screen

   main.js is the only file that knows all three engines exist.
   Each engine only knows the shape of what it receives, not who
   produced it — Optics in particular never sees "World" or
   "Mask," only a plain Source Canvas. That's what makes future
   Worlds (Plasma, Fire, Clouds, Water, Nebula, ...) a drop-in:
   implement update()/render() with World's signature and point
   the loop below at it — Mask and Optics never need to change.
   ============================================================ */

(function () {
    "use strict";

    // ---- DOM ----
    const canvas = document.getElementById('animation');
    const imageInput = document.getElementById('imageInput');
    const numTilesInput = document.getElementById('numTilesInput');
    const canvasWidthInput = document.getElementById('canvasWidthInput');
    const canvasHeightInput = document.getElementById('canvasHeightInput');
    const speedInput = document.getElementById('speedInput');
    const speedVal = document.getElementById('speedVal');
    const screenshotButton = document.getElementById('screenshotButton');
    const toggleButton = document.getElementById('toggleControls');
    const controls = document.getElementById('stickyTable');
    const rgbBtns = document.querySelectorAll('.btn-rgb');
    const btnAllSmooth = document.getElementById('btn-all-smooth');
    const btnAllChaos = document.getElementById('btn-all-chaos');
    const artworkFileName = document.getElementById('artworkFileName');

    // ---- state ----
    let canvasWidth, canvasHeight, numTiles, masterSpeed;
    let actualWidth = 400, actualHeight = 400; // placeholder aspect until artwork is uploaded
    let scaledWidth = 400, scaledHeight = 400;
    let maxImageWidth;

    const worldCanvas = document.createElement('canvas');
    const worldCtx = worldCanvas.getContext('2d');
    const flippedCanvas = document.createElement('canvas');
    const flippedCtx = flippedCanvas.getContext('2d');

    OpticalEngine.init(canvas);

    function getUserInputs() {
        canvasWidth = Number(canvasWidthInput.value);
        canvasHeight = Number(canvasHeightInput.value);
        numTiles = Number(numTilesInput.value);
        masterSpeed = Number(speedInput.value);
        speedVal.textContent = masterSpeed.toFixed(2) + 'x';
        maxImageWidth = Math.ceil(canvasWidth / numTiles);
    }

    function resizeTile() {
        if (actualWidth > maxImageWidth) {
            scaledWidth = maxImageWidth;
            scaledHeight = actualHeight * (scaledWidth / actualWidth);
        } else {
            scaledWidth = actualWidth;
            scaledHeight = actualHeight;
        }
        worldCanvas.width = Math.max(1, Math.round(scaledWidth));
        worldCanvas.height = Math.max(1, Math.round(scaledHeight));
        flippedCanvas.width = worldCanvas.width;
        flippedCanvas.height = worldCanvas.height;
        Mask.resize(worldCanvas.width, worldCanvas.height);
    }

    function applySettings() {
        getUserInputs();
        OpticalEngine.setCanvasSize(canvasWidth, canvasHeight);
        OpticalEngine.setNumTiles(numTiles);
        resizeTile();
    }

    function flipHorizontal(srcCanvas, destCtx, destCanvas) {
        destCtx.save();
        destCtx.setTransform(1, 0, 0, 1, 0, 0);
        destCtx.clearRect(0, 0, destCanvas.width, destCanvas.height);
        destCtx.scale(-1, 1);
        destCtx.drawImage(srcCanvas, -destCanvas.width, 0);
        destCtx.restore();
    }

    // ---- artwork upload (Mask input) ----
    imageInput.addEventListener('change', function () {
        const file = imageInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (event) {
            const img = new Image();
            img.onload = function () {
                actualWidth = img.width;
                actualHeight = img.height;
                Mask.setArtwork(img);
                resizeTile();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
        artworkFileName.textContent = file.name;
    });

    // ---- settings inputs ----
    [canvasWidthInput, canvasHeightInput, numTilesInput].forEach(el => {
        el.addEventListener('change', applySettings);
    });
    speedInput.addEventListener('input', getUserInputs);

    // ---- RGB / palette preset buttons ----
    rgbBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            rgbBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            World.setActiveRGB(btn.getAttribute('data-rgb'));
            btnAllSmooth.classList.remove('active');
            btnAllChaos.classList.remove('active');
        });
    });

    function toggleMasterModeUI(type, btn) {
        World.toggleMasterMode(type);
        btnAllSmooth.classList.toggle('active', World.isMasterAllMode && World.masterModeType === 'smooth');
        btnAllChaos.classList.toggle('active', World.isMasterAllMode && World.masterModeType === 'chaos');
    }
    btnAllSmooth.addEventListener('click', () => toggleMasterModeUI('smooth', btnAllSmooth));
    btnAllChaos.addEventListener('click', () => toggleMasterModeUI('chaos', btnAllChaos));

    // ---- controls dock toggle ----
    toggleButton.addEventListener('click', () => {
        controls.classList.toggle('hidden');
    });

    // ---- screenshot ----
    screenshotButton.addEventListener('click', () => OpticalEngine.saveImage());

    // ---- hotkeys (screenshot only; play/pause & video export are out of
    // scope here since videoExportFunctions.js was not part of the source
    // repo this build is based on) ----
    document.addEventListener('keydown', function (event) {
        if (event.key === 's') OpticalEngine.saveImage();
    });

    // ---- render loop ----
    function loop() {
        World.update(0.01, masterSpeed);
        World.render(worldCtx, worldCanvas.width, worldCanvas.height);

        const sourceCanvas = Mask.render(worldCanvas, worldCanvas.width, worldCanvas.height);
        flipHorizontal(sourceCanvas, flippedCtx, flippedCanvas);

        OpticalEngine.setSpeed(masterSpeed);
        OpticalEngine.renderFrame(sourceCanvas, flippedCanvas);

        requestAnimationFrame(loop);
    }

    // ---- init ----
    canvasWidthInput.value = window.innerWidth;
    canvasHeightInput.value = window.innerHeight;
    window.addEventListener('resize', () => {
        canvasWidthInput.value = window.innerWidth;
        canvasHeightInput.value = window.innerHeight;
        applySettings();
    });

    applySettings();
    requestAnimationFrame(loop);
})();
