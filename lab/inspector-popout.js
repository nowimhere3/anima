/* ============================================================
   LAYER INSPECTOR POP-OUT — detach the live #inspector into a window.
   Mode "pip":   Document Picture-in-Picture (Chromium, user gesture).
   Mode "float": in-page draggable/resizable panel when PiP is unavailable or refused.
   The #inspector node is MOVED, never cloned, so every control stays bound to the
   same scene state. Only UI geometry is stored (localStorage); presets are untouched.
   ============================================================ */
const InspectorPopout = (function () {
    "use strict";
    const FORWARD_KEYS = new Set([' ', 'h', 'H', 'd', 'D', '[', ']']);
    const MIN_W = 280, MIN_H = 200;

    let opts = null, mode = 'docked';
    let inspectorEl = null, home = null, popBtn = null, notice = null, away = null;
    let pipWin = null, floatEl = null, floatRO = null;

    const make = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };
    const dockBtn = label => {
        const b = make('button', 'btn inspector-dock-btn', label);
        b.type = 'button';
        b.addEventListener('click', dock);
        return b;
    };
    const setNote = msg => { if (notice) notice.textContent = msg || ''; };

    /* Lookup for controls that were moved into the PiP document (see $ in lab/fusion). */
    function find(id) {
        return mode === 'pip' && pipWin && !pipWin.closed ? pipWin.document.getElementById(id) : null;
    }

    function init(options) {
        opts = Object.assign({ detailsSelector: 'details[data-sec="inspector"]', title: 'Layer Inspector', storageKey: 'anima_inspector_float' }, options);
        inspectorEl = document.getElementById('inspector');
        const details = document.querySelector(opts.detailsSelector);
        if (!inspectorEl || !details) return;
        home = inspectorEl.parentElement;

        const tools = make('div', 'inspector-tools');
        popBtn = make('button', 'btn inspector-popout-btn', '⧉ Pop out');
        popBtn.type = 'button';
        popBtn.title = 'Detach the Layer Inspector into a window you can move and resize while watching the artwork';
        popBtn.addEventListener('click', () => (mode === 'docked' ? popOut() : dock()));
        notice = make('p', 'inspector-note');
        notice.setAttribute('role', 'status');
        tools.append(popBtn, notice);

        away = make('div', 'inspector-away');
        away.hidden = true;
        away.append(make('span', null, 'Layer Inspector is popped out.'), dockBtn('Dock back'));

        home.insertBefore(tools, inspectorEl);
        home.insertBefore(away, inspectorEl);
    }

    async function popOut() {
        if (mode !== 'docked') return;
        const dpip = window.documentPictureInPicture;
        if (dpip && typeof dpip.requestWindow === 'function') {
            try {
                await openPip(dpip);
                return;
            } catch (err) {
                setNote('Picture-in-Picture was not granted (' + (err && err.name || 'error') + ') — opened an in-page floating panel instead.');
            }
        } else {
            setNote('Picture-in-Picture is not available in this browser — opened an in-page floating panel instead.');
        }
        openFloat();
    }

    async function openPip(dpip) {
        const win = await dpip.requestWindow({ width: 400, height: 640 });
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
        doc.body.className = document.body.className.replace(/\bhide-ui\b/g, '').trim() + ' inspector-pip-body';

        const shell = make('div', 'inspector-pip-shell');
        const head = make('div', 'inspector-pip-head');
        head.append(make('strong', null, opts.title), dockBtn('Dock back'));
        const content = make('div', 'sec-content');
        shell.append(head, content);
        doc.body.appendChild(shell);

        pipWin = win;
        mode = 'pip';
        content.appendChild(inspectorEl);
        doc.addEventListener('keydown', forwardKey);
        win.addEventListener('pagehide', dock);   // native X or navigation: bring the controls home
        showAway(true);
        setNote('');
    }

    function openFloat() {
        if (mode !== 'docked') return;
        floatEl = make('div', 'inspector-float');
        const bar = make('div', 'inspector-float-bar');
        bar.append(make('strong', null, opts.title), dockBtn('Dock back'));
        const body = make('div', 'sec-content inspector-float-body');
        floatEl.append(bar, body);
        document.body.appendChild(floatEl);
        applyGeom(loadGeom());
        body.appendChild(inspectorEl);
        mode = 'float';
        showAway(true);
        setNote('');

        bar.addEventListener('pointerdown', e => startDrag(e, bar));
        floatRO = new ResizeObserver(() => saveGeom());
        floatRO.observe(floatEl);
        window.addEventListener('resize', clampFloat);
    }

    function dock() {
        if (mode === 'docked') return;
        const prev = mode;
        mode = 'docked';
        home.appendChild(inspectorEl);           // original section, original position
        showAway(false);
        popBtn.textContent = '⧉ Pop out';
        if (prev === 'pip') {
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

    function showAway(on) {
        away.hidden = !on;
        popBtn.textContent = on ? '⤓ Dock back' : '⧉ Pop out';
    }

    /* Keys typed in the PiP window reach the page's shortcut handler (Space, H, [, ], D).
       Form controls keep their native keys so sliders and selects behave normally. */
    function forwardKey(e) {
        const t = e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) return;
        if (e.ctrlKey || e.metaKey || e.altKey || !FORWARD_KEYS.has(e.key)) return;
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }));
    }

    /* ---------- in-page floating panel: geometry, drag, clamp ---------- */
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
        const w = clamp(g && g.w || 340, MIN_W, Math.max(MIN_W, vw - 16));
        const h = clamp(g && g.h || Math.round(vh * 0.6), MIN_H, Math.max(MIN_H, vh - 16));
        floatEl.style.width = w + 'px';
        floatEl.style.height = h + 'px';
        place(g && g.x != null ? g.x : vw - w - 16, g && g.y != null ? g.y : 72);
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
    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    return { init, find, popOut, dock, get mode() { return mode; } };
})();
