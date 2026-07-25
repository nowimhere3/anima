/* ============================================================
   MAIN — wiring + render loop
   ------------------------------------------------------------
   Pipeline every frame:

       World.update/render  ->  ArtworkMask.render  ->  KaleidoscopeEngine.renderFrame

   main.js is the only file that knows all three stages exist.
   Each stage only knows the shape of what it receives, not who
   produced it — that's what makes future Worlds (Plasma, Fire,
   Clouds, Water, Nebula, ...) a drop-in: implement update()/
   render() with World's signature, point ACTIVE_WORLD at it.
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

    const worldTileCanvas = document.createElement('canvas');
    const worldCtx = worldTileCanvas.getContext('2d');
    const flippedTileCanvas = document.createElement('canvas');
    const flippedCtx = flippedTileCanvas.getContext('2d');

    KaleidoscopeEngine.init(canvas);

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
        worldTileCanvas.width = Math.max(1, Math.round(scaledWidth));
        worldTileCanvas.height = Math.max(1, Math.round(scaledHeight));
        flippedTileCanvas.width = worldTileCanvas.width;
        flippedTileCanvas.height = worldTileCanvas.height;
        ArtworkMask.resize(worldTileCanvas.width, worldTileCanvas.height);
    }

    function applySettings() {
        getUserInputs();
        KaleidoscopeEngine.setCanvasSize(canvasWidth, canvasHeight);
        KaleidoscopeEngine.setNumTiles(numTiles);
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

    // ---- artwork upload (Stage 2 input) ----
    imageInput.addEventListener('change', function () {
        const file = imageInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (event) {
            const img = new Image();
            img.onload = function () {
                actualWidth = img.width;
                actualHeight = img.height;
                ArtworkMask.setArtwork(img);
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
    screenshotButton.addEventListener('click', () => KaleidoscopeEngine.saveImage());

    // ---- hotkeys (screenshot only; play/pause & video export are out of
    // scope here since videoExportFunctions.js was not part of the source
    // repo this build is based on) ----
    document.addEventListener('keydown', function (event) {
        if (event.key === 's') KaleidoscopeEngine.saveImage();
    });

    // ---- render loop ----
    function loop() {
        World.update(0.01, masterSpeed);
        World.render(worldCtx, worldTileCanvas.width, worldTileCanvas.height);

        const maskedTile = ArtworkMask.render(worldTileCanvas, worldTileCanvas.width, worldTileCanvas.height);
        flipHorizontal(maskedTile, flippedCtx, flippedTileCanvas);

        KaleidoscopeEngine.setSpeed(masterSpeed);
        KaleidoscopeEngine.renderFrame(maskedTile, flippedTileCanvas);

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
