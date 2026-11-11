/* ============================================================
   PANEL POP-OUT — detach an entire live control card into a window.
   Mode "pip":   Document Picture-in-Picture (Chromium, needs a user gesture).
   Mode "float": in-page draggable/resizable panel when PiP is unavailable or refused.
   The card node itself is MOVED, never cloned: listeners, control values, accordion
   state and scene bindings stay exactly as they are. Only UI geometry is stored.
   Page attributes that CSS reads from <body> (e.g. data-ftab) are mirrored one-way
   from the main body into the PiP body; the page keeps the only tab state.
   ============================================================ */
const PanelPopout = (function () {
    "use strict";
    const FORWARD_KEYS = new Set([' ', 'h', 'H', 'd', 'D', '1', '2', '[', ']']);
    const MIN_W = 300, MIN_H = 240;

    let opts = null, mode = 'docked', opening = false;
    let panel = null, btn = null, note = null, away = null;
    let pipWin = null, floatEl = null, floatRO = null, bodyObserver = null;

    const make = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };
    const dockBtn = () => {
        const b = make('button', 'btn panel-dock-btn', 'Dock Back');
        b.type = 'button';
        b.addEventListener('click', dock);
        return b;
    };
    const setNote = msg => { if (note) note.textContent = msg || ''; };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    /* Resolves ids for controls that currently live in the PiP document. */
    function find(id) {
        return mode === 'pip' && pipWin && !pipWin.closed ? pipWin.document.getElementById(id) : null;
    }

    function init(options) {
        opts = Object.assign({
            panelSelector: '#panel', buttonId: 'panelPopoutBtn', noteId: 'panelPopoutNote',
            title: 'Settings', storageKey: 'anima_panel_float', mirrorBodyData: []
        }, options);
        panel = document.querySelector(opts.panelSelector);
        btn = document.getElementById(opts.buttonId);
        note = document.getElementById(opts.noteId);
        if (!panel || !btn) return;
        btn.addEventListener('click', () => (mode === 'docked' ? popOut() : dock()));
    }

    async function popOut() {
        if (mode !== 'docked' || opening) return;
        opening = true;
        try {
            const dpip = window.documentPictureInPicture;
            if (dpip && typeof dpip.requestWindow === 'function') {
                try {
                    await openPip(dpip);
                    return;
                } catch (err) {
                    setNote('Picture-in-Picture was not granted (' + (err && err.name || 'error') + ') — opened an in-page floating window instead.');
                }
            } else {
                setNote('Picture-in-Picture is not available in this browser — opened an in-page floating window instead.');
            }
            openFloat();
        } finally {
            opening = false;
        }
    }

    function makeAway() {
        away = make('div', 'panel-away');
        away.append(make('span', null, opts.title + ' settings are popped out.'), dockBtn());
        panel.parentNode.insertBefore(away, panel);
    }

    async function openPip(dpip) {
        const sw = window.screen && screen.availWidth || 1280, sh = window.screen && screen.availHeight || 800;
        const win = await dpip.requestWindow({ width: Math.min(520, Math.max(320, sw - 40)), height: Math.min(700, Math.max(360, sh - 80)) });
        const doc = win.document;
        doc.title = opts.title + ' — Anima';
        // The PiP document starts at about:blank, so stylesheet links must be absolute.
        document.querySelectorAll('link[rel="stylesheet"], style').forEach(n => {
            if (n.tagName === 'LINK') {
                const l = doc.createElement('link');
                l.rel = 'stylesheet';
                l.href = n.href;
                doc.head.appendChild(l);
            } else {
                doc.head.appendChild(n.cloneNode(true));
            }
        });
        doc.body.className = document.body.className.replace(/\bhide-ui\b/g, '').trim();
        mirrorBodyData(doc.body);

        makeAway();
        panel.classList.add('panel-popped');
        doc.body.appendChild(panel);
        pipWin = win;
        mode = 'pip';
        btn.textContent = 'Dock Back';
        setNote('');

        // Keep the PiP body's data-* in step with the page's single source of truth.
        if (opts.mirrorBodyData.length) {
            bodyObserver = new MutationObserver(() => mirrorBodyData(doc.body));
            bodyObserver.observe(document.body, { attributes: true, attributeFilter: opts.mirrorBodyData.map(k => 'data-' + k) });
        }
        doc.addEventListener('keydown', forwardKey);
        win.addEventListener('pagehide', dock);      // native X or navigation: bring the card home
    }

    function mirrorBodyData(target) {
        for (const k of opts.mirrorBodyData) {
            const v = document.body.dataset[k];
            if (v == null) delete target.dataset[k]; else target.dataset[k] = v;
        }
    }

    function openFloat() {
        if (mode !== 'docked') return;
        makeAway();
        floatEl = make('div', 'panel-float');
        const bar = make('div', 'panel-float-bar');
        bar.append(make('strong', null, opts.title), dockBtn());
        const body = make('div', 'panel-float-body');
        floatEl.append(bar, body);
        document.body.appendChild(floatEl);
        applyGeom(loadGeom());
        panel.classList.add('panel-popped');
        body.appendChild(panel);
        mode = 'float';
        btn.textContent = 'Dock Back';

        bar.addEventListener('pointerdown', e => startDrag(e, bar));
        floatRO = new ResizeObserver(() => saveGeom());
        floatRO.observe(floatEl);
        window.addEventListener('resize', clampFloat);
    }

    function dock() {
        if (mode === 'docked') return;
        const prev = mode;
        mode = 'docked';
        panel.classList.remove('panel-popped');
        if (away && away.parentNode) { away.parentNode.insertBefore(panel, away); away.remove(); }
        away = null;
        btn.textContent = 'Pop Out';
        if (prev === 'pip') {
            if (bodyObserver) bodyObserver.disconnect();
            bodyObserver = null;
            if (pipWin) pipWin.document.removeEventListener('keydown', forwardKey);
            if (pipWin && !pipWin.closed) pipWin.close();
            pipWin = null;
        } else if (prev === 'float') {
            if (floatRO) floatRO.disconnect();
            window.removeEventListener('resize', clampFloat);
            if (floatEl) floatEl.remove();
            floatEl = null; floatRO = null;
        }
    }

    /* Keys typed in the PiP window reach the page's shortcut handler. Form controls and
       buttons keep their native keys so sliders, selects and checkboxes behave normally. */
    function forwardKey(e) {
        const t = e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) return;
        if (e.ctrlKey || e.metaKey || e.altKey || !FORWARD_KEYS.has(e.key)) return;
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }));
    }

    /* ---------- in-page floating window: geometry, drag, clamp ---------- */
    function loadGeom() {
        try { return JSON.parse(localStorage.getItem(opts.storageKey)) || null; } catch (e) { return null; }
    }
    let saveTimer = 0;
    function saveGeom() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            if (!floatEl) return;
            const r = floatEl.getBoundingClientRect();
            try { localStorage.setItem(opts.storageKey, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })); } catch (e) {}
        }, 150);
    }
    function applyGeom(g) {
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = clamp(g && g.w || 480, MIN_W, Math.max(MIN_W, vw - 16));
        const h = clamp(g && g.h || Math.round(vh * 0.8), MIN_H, Math.max(MIN_H, vh - 16));
        floatEl.style.width = w + 'px';
        floatEl.style.height = h + 'px';
        place(g && g.x != null ? g.x : vw - w - 16, g && g.y != null ? g.y : 16);
    }
    function place(x, y) {
        if (!floatEl) return;
        const w = floatEl.offsetWidth, h = floatEl.offsetHeight;
        floatEl.style.left = clamp(x, 0, Math.max(0, window.innerWidth - w)) + 'px';
        floatEl.style.top = clamp(y, 0, Math.max(0, window.innerHeight - h)) + 'px';
        floatEl.style.right = 'auto';
    }
    function clampFloat() {
        if (!floatEl) return;
        const r = floatEl.getBoundingClientRect();
        floatEl.style.width = Math.min(r.width, window.innerWidth - 16) + 'px';
        floatEl.style.height = Math.min(r.height, window.innerHeight - 16) + 'px';
        place(r.left, r.top);
    }
    function startDrag(e, bar) {
        if (e.button !== 0 || (e.target.closest && e.target.closest('button'))) return;
        const r = floatEl.getBoundingClientRect();
        const dx = e.clientX - r.left, dy = e.clientY - r.top;
        bar.setPointerCapture(e.pointerId);
        const move = ev => place(ev.clientX - dx, ev.clientY - dy);
        const up = () => {
            bar.removeEventListener('pointermove', move);
            bar.removeEventListener('pointerup', up);
            bar.removeEventListener('pointercancel', up);
            saveGeom();
        };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', up);
        bar.addEventListener('pointercancel', up);
    }

    return { init, find, popOut, dock, get mode() { return mode; } };
})();
