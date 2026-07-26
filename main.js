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

    // Browsers restore scroll position on reload by default. During dev/
    // testing you scroll down to the controls a lot, and on the next
    // refresh the browser silently puts you right back there — which
    // looks exactly like "controls are above the fold" even though the
    // layout itself is correct. Force every load to start clean at top.
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    window.scrollTo(0, 0);

    // ---- DOM ----
    const canvas = document.getElementById('animation');
    const imageInput = document.getElementById('imageInput');
    const numTilesInput = document.getElementById('numTilesInput');
    const numTilesNumberInput = document.getElementById('numTilesNumberInput');
    const canvasWidthInput = document.getElementById('canvasWidthInput');
    const canvasHeightInput = document.getElementById('canvasHeightInput');
    const speedInput = document.getElementById('speedInput');
    const speedVal = document.getElementById('speedVal');
    const screenshotButton = document.getElementById('screenshotButton');
    const toggleButton = document.getElementById('toggleControls');
    const rgbBtns = document.querySelectorAll('.btn-rgb');
    const btnAllSmooth = document.getElementById('btn-all-smooth');
    const btnAllChaos = document.getElementById('btn-all-chaos');
    const artworkFileName = document.getElementById('artworkFileName');
    const saveArtworkButton = document.getElementById('saveArtworkButton');
    const artworkLibraryGrid = document.getElementById('artworkLibraryGrid');
    const artworkLibraryEmpty = document.getElementById('artworkLibraryEmpty');

    // ---- state ----
    let canvasWidth, canvasHeight, numTiles, masterSpeed;
    let actualWidth = 400, actualHeight = 400; // placeholder aspect until artwork is uploaded
    let scaledWidth = 400, scaledHeight = 400;
    let maxImageWidth;

    // Active artwork bookkeeping (Phase 1: Persistent Artwork Library).
    // activeArtworkBlob is what Save Artwork actually persists.
    // activeArtworkId is set only when the active artwork IS a saved
    // library entry (so we know which card to highlight, and can skip
    // re-saving a duplicate). A fresh upload clears it back to null —
    // uploading never auto-saves.
    let activeArtworkBlob = null;
    let activeArtworkId = null;
    let libraryObjectURLs = [];

    const worldCanvas = document.createElement('canvas');
    const worldCtx = worldCanvas.getContext('2d');
    const flippedCanvas = document.createElement('canvas');
    const flippedCtx = flippedCanvas.getContext('2d');

    OpticalEngine.init(canvas);

    function getUserInputs() {
        canvasWidth = Number(canvasWidthInput.value);
        canvasHeight = Number(canvasHeightInput.value);
        numTiles = Number(numTilesNumberInput.value);
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

    // ---- artwork upload (Mask input) — TEMPORARY until explicitly saved ----
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

        // A fresh upload is active-but-unsaved: it disappears on reload
        // unless Save Artwork is pressed. It is NOT the same as any
        // previously-active saved library entry.
        activeArtworkBlob = file;
        activeArtworkId = null;
        saveArtworkButton.disabled = false;
        renderLibrary();
    });

    // ---- Save Artwork: persist the currently active artwork ----
    saveArtworkButton.addEventListener('click', () => {
        if (!activeArtworkBlob) return;
        const defaultName = (imageInput.files[0] && imageInput.files[0].name.replace(/\.[^.]+$/, '')) || 'Untitled Artwork';
        const name = window.prompt('Name this artwork:', defaultName);
        if (name === null) return; // cancelled
        ArtworkLibrary.saveArtwork(name.trim() || 'Untitled Artwork', activeArtworkBlob).then((record) => {
            activeArtworkId = record.id;
            saveArtworkButton.disabled = true; // already saved, nothing new to save
            renderLibrary();
        });
    });

    // ---- Artwork Library: render saved entries, wire Use/Rename/Delete ----
    function renderLibrary() {
        ArtworkLibrary.getAll().then((records) => {
            libraryObjectURLs.forEach(url => URL.revokeObjectURL(url));
            libraryObjectURLs = [];
            artworkLibraryGrid.innerHTML = '';

            if (records.length === 0) {
                artworkLibraryGrid.appendChild(artworkLibraryEmpty);
                return;
            }

            records.forEach((record) => {
                const objectUrl = URL.createObjectURL(record.blob);
                libraryObjectURLs.push(objectUrl);

                const item = document.createElement('div');
                item.className = 'library-item' + (record.id === activeArtworkId ? ' active' : '');

                const thumb = document.createElement('img');
                thumb.className = 'library-thumb';
                thumb.src = objectUrl;
                thumb.alt = record.name;

                const nameEl = document.createElement('div');
                nameEl.className = 'library-name';
                nameEl.textContent = record.name;
                nameEl.title = record.name;

                const actions = document.createElement('div');
                actions.className = 'library-actions';

                const useBtn = document.createElement('button');
                useBtn.textContent = 'Use';
                useBtn.addEventListener('click', () => useArtwork(record));

                const renameBtn = document.createElement('button');
                renameBtn.textContent = 'Rename';
                renameBtn.addEventListener('click', () => {
                    const newName = window.prompt('Rename artwork:', record.name);
                    if (newName === null) return;
                    ArtworkLibrary.rename(record.id, newName.trim() || record.name).then(renderLibrary);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.className = 'delete-btn';
                deleteBtn.addEventListener('click', () => {
                    const confirmed = window.confirm(`Delete "${record.name}"? This can't be undone.`);
                    if (!confirmed) return;
                    ArtworkLibrary.remove(record.id).then(() => {
                        if (activeArtworkId === record.id) activeArtworkId = null;
                        renderLibrary();
                    });
                });

                actions.appendChild(useBtn);
                actions.appendChild(renameBtn);
                actions.appendChild(deleteBtn);

                item.appendChild(thumb);
                item.appendChild(nameEl);
                item.appendChild(actions);
                artworkLibraryGrid.appendChild(item);
            });
        });
    }

    // Selecting a saved artwork makes it the active mask immediately,
    // no re-upload needed — same Mask.setArtwork() path as a fresh upload.
    function useArtwork(record) {
        const objectUrl = URL.createObjectURL(record.blob);
        const img = new Image();
        img.onload = function () {
            actualWidth = img.width;
            actualHeight = img.height;
            Mask.setArtwork(img);
            resizeTile();
            URL.revokeObjectURL(objectUrl);
        };
        img.src = objectUrl;

        activeArtworkBlob = record.blob;
        activeArtworkId = record.id;
        saveArtworkButton.disabled = true; // already saved
        artworkFileName.textContent = record.name;
        renderLibrary();
    }

    // ---- settings inputs ----
    [canvasWidthInput, canvasHeightInput].forEach(el => {
        el.addEventListener('change', applySettings);
    });
    // # of Tiles: number box is the default entry point, slider mirrors it
    numTilesNumberInput.addEventListener('change', () => {
        numTilesInput.value = numTilesNumberInput.value;
        applySettings();
    });
    numTilesInput.addEventListener('input', () => {
        numTilesNumberInput.value = numTilesInput.value;
        applySettings();
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

    // ---- controls dock: scroll down to reveal ----
    // The dock lives below the fold by default (pure document flow —
    // nothing needs to be hidden/shown). This button's job is just to
    // get the user there, or back to the clean fullscreen view.
    const controlSection = document.querySelector('.control-section');
    toggleButton.addEventListener('click', () => {
        const scrolledToControls = window.scrollY > window.innerHeight * 0.5;
        if (scrolledToControls) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            controlSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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
    renderLibrary();
    requestAnimationFrame(loop);
})();
