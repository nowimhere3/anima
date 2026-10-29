/* ============================================================
   NATIVE ART ENGINE (Engine A)
   ------------------------------------------------------------
   Anima's own authored artwork. Geometry is only the construction
   system: every motif is painted as filled, shaded glass / enamel /
   metal / jewel material into two plates:
     color  - intrinsic RGBA (glass bodies, gradients, pools, coverage)
     finish - lead, bevels, highlights, glints (applied source-atop)
   Radial sources are authored for the canonical half-wedge
   0..PI/N (axes at 0 and PI/N); the optics stage mirrors them.
   Identity sources (collars, rosettes) paint their full ring.
   Painting happens in R units, origin at the canvas centre.
   ============================================================ */
const NativeArtEngine = (function () {
    "use strict";
    const TAU = Math.PI * 2;

    function rngFrom(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function hex(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const css = (c, a) => (a == null || a >= 1) ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
    const lite = (c, t) => mix(c, [255, 250, 236], t);
    const dark = (c, t) => mix(c, [5, 3, 14], t);
    function rgb2hsl(c) {
        const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        let h = 0, s = 0; const l = (mx + mn) / 2;
        if (mx !== mn) {
            const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
            h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
        }
        return [h, s, l];
    }
    function hsl2rgb(h, s, l) {
        const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
        if (s === 0) return [l * 255, l * 255, l * 255];
        const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
    }
    /* small hue / lightness variation so neighbouring panes of one family differ like real glass */
    function vary(c, rng, hue, lig) {
        const [h, s, l] = rgb2hsl(c);
        return hsl2rgb((h + (rng() - .5) * hue + 1) % 1, Math.min(1, s * (.92 + rng() * .2)), Math.max(.06, Math.min(.92, l + (rng() - .5) * lig)));
    }

    /* ---------- path builders (axis-local frame: x outward, y lateral) ---------- */
    function ringBand(r0, r1, t0, t1) {
        const p = new Path2D();
        p.arc(0, 0, r1, t0, t1);
        p.arc(0, 0, r0, t1, t0, true);
        p.closePath();
        return p;
    }
    function lancetPath(r0, r1, w, round) {
        const L = r1 - r0, p = new Path2D(), x = f => r0 + L * f;
        const c1 = .72 + .12 * round, c2x = .9 + .1 * round, c2y = .35 + .55 * round;
        p.moveTo(x(0), 0);
        p.bezierCurveTo(x(.04), w * .5, x(.2), w, x(.5), w);
        p.bezierCurveTo(x(c1), w, x(c2x), w * c2y, x(1), 0);
        p.bezierCurveTo(x(c2x), -w * c2y, x(c1), -w, x(.5), -w);
        p.bezierCurveTo(x(.2), -w, x(.04), -w * .5, x(0), 0);
        p.closePath();
        return p;
    }
    function circlePath(x, y, r) { const p = new Path2D(); p.arc(x, y, r, 0, TAU); return p; }
    function polyPath(pts) { const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); return p; }

    const PEARLY = [[222, 198, 240], [255, 226, 204], [196, 240, 228], [255, 255, 255]];

    /* ---------- the painter ---------- */
    function Painter(color, finish, env) { this.c = color; this.f = finish; this.env = env; this.rng = env.rng; this.lastPick = -1; }
    Painter.prototype = {
        save() { this.c.save(); this.f.save(); },
        restore() { this.c.restore(); this.f.restore(); },
        rot(a) { this.c.rotate(a); this.f.rotate(a); },
        at(angle, fn) { this.save(); this.rot(angle); fn(); this.restore(); },
        clip(path) { this.c.clip(path); this.f.clip(path); },

        occlude(path, w) {
            const f = this.f;
            f.save(); f.globalCompositeOperation = 'destination-out';
            f.fill(path);
            if (w) { f.lineWidth = w; f.lineJoin = 'round'; f.stroke(path); }
            f.restore();
        },

        pick(list) {   // list of [paletteIndex, weight]
            const pal = this.env.pal;
            let tot = 0; for (const e of list) tot += e[1];
            for (let tries = 0; tries < 3; tries++) {
                let r = this.rng() * tot, idx = list[0][0];
                for (const e of list) { r -= e[1]; if (r <= 0) { idx = e[0]; break; } }
                if (idx !== this.lastPick || tries === 2) { this.lastPick = idx; return vary(pal[idx], this.rng, .05, .16); }
            }
        },
        others(list, base) { const soft = this.env.soft; return list.filter(e => e[1] >= .1 && (soft || (e[0] !== 4 && e[0] !== 0))).map(e => this.env.pal[e[0]]); },

        metalGrad(ctx, cx, cy, rad, ang) {
            const m = this.env.metal, dx = Math.cos(ang) * rad, dy = Math.sin(ang) * rad;
            const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
            g.addColorStop(0, css(lite(m, .65))); g.addColorStop(.22, css(m)); g.addColorStop(.45, css(dark(m, .5)));
            g.addColorStop(.62, css(lite(m, .35))); g.addColorStop(.82, css(m)); g.addColorStop(1, css(dark(m, .45)));
            return g;
        },

        /* A faceted, shaded glass pane.  o: cx,cy,rad (bounds), ang, lead, sec[], pools, shade, pre, tex */
        pane(path, base, o) {
            o = o || {};
            const c = this.c, f = this.f, rng = this.rng, env = this.env;
            const rad = o.rad || .1, cx = o.cx || 0, cy = o.cy || 0;
            const lead = o.lead == null ? env.leadW : o.lead;
            const ang = o.ang == null ? rng() * TAU : o.ang;
            const dx = Math.cos(ang) * rad, dy = Math.sin(ang) * rad;
            const soft = env.soft;
            this.save();
            if (o.pre) this.clip(o.pre);
            this.occlude(path, lead);
            // body gradient
            const g = c.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
            g.addColorStop(0, css(lite(base, soft ? .6 : .2)));
            g.addColorStop(.5, css(soft ? lite(base, .14) : base));
            g.addColorStop(1, css(mix(base, env.shadow, soft ? .34 : .5)));
            c.fillStyle = g; c.fill(path);
            if (lead) { c.lineJoin = 'round'; c.lineWidth = lead; c.strokeStyle = g; c.stroke(path); }
            c.save(); c.clip(path);
            // colour pools (translucent secondary hues)
            const sec = soft ? (o.sec || []).concat(PEARLY) : (o.sec && o.sec.length ? o.sec : [lite(base, .5)]);
            const np = o.pools == null ? 3 : o.pools;
            for (let i = 0; i < np; i++) {
                const col = sec[(rng() * sec.length) | 0];
                const px = cx + (rng() - .5) * rad * 1.5, py = cy + (rng() - .5) * rad * 1.5, pr = rad * (.55 + rng() * .65);
                const rg = c.createRadialGradient(px, py, 0, px, py, pr);
                rg.addColorStop(0, css(col, soft ? .5 : .62)); rg.addColorStop(1, css(col, 0));
                c.fillStyle = rg; c.fill(path);
            }
            // glass striae: broad translucent streaks
            const ns = o.streaks == null ? 3 : o.streaks;
            for (let i = 0; i < ns; i++) {
                const y0 = cy + (rng() - .5) * rad * 1.6, a2 = (rng() - .5) * rad;
                c.beginPath();
                c.moveTo(cx - rad * 1.3, y0);
                c.bezierCurveTo(cx - rad * .4, y0 + a2, cx + rad * .4, y0 - a2, cx + rad * 1.3, y0 + a2 * .6);
                c.lineWidth = rad * (.12 + rng() * .3); c.lineCap = 'round';
                c.strokeStyle = (i & 1) ? css([255, 255, 255], .16) : css(mix(base, env.shadow, .6), .2);
                c.stroke();
            }
            // inner edge shading (stepped soft inner shadow)
            const sh = o.shade == null ? rad * .3 : o.shade;
            c.lineJoin = 'round';
            c.strokeStyle = css(mix(base, env.shadow, .85), soft ? .045 : .07);
            const steps = soft ? 12 : 9;
            for (let k = steps; k >= 1; k--) { c.lineWidth = sh * (soft ? .12 : .22) * k; c.stroke(path); }
            c.restore();
            // finish plate: bevel highlight under lead, then lead
            if (lead) {
                f.save(); f.clip(path);
                f.lineJoin = 'round';
                f.lineWidth = lead * 2.6; f.strokeStyle = 'rgba(255,248,226,.16)'; f.stroke(path);
                f.lineWidth = lead * 1.7; f.strokeStyle = 'rgba(255,248,226,.2)'; f.stroke(path);
                f.restore();
                f.lineJoin = 'round'; f.lineWidth = lead; f.strokeStyle = css(env.lead); f.stroke(path);
            }
            this.restore();
        },

        /* cabochon jewel with metal bezel */
        jewel(x, y, r, base, o) {
            o = o || {};
            const c = this.c, f = this.f, env = this.env;
            this.save();
            const bez = circlePath(x, y, r * 1.22);
            if (o.halo) {
                const hg = c.createRadialGradient(x, y, r * .8, x, y, r * 2.4);
                hg.addColorStop(0, css(lite(base, .2), .45)); hg.addColorStop(1, css(base, 0));
                c.fillStyle = hg; c.beginPath(); c.arc(x, y, r * 2.4, 0, TAU); c.fill();
            }
            this.occlude(bez, 0);
            c.fillStyle = this.metalGrad(c, x, y, r * 1.22, o.ang == null ? 2.3 : o.ang); c.fill(bez);
            // bezel bevel & outline
            f.lineWidth = r * .1; f.strokeStyle = css(dark(env.metal, .75), .95); f.stroke(bez);
            f.lineWidth = r * .05; f.strokeStyle = 'rgba(255,244,200,.55)'; f.beginPath(); f.arc(x, y, r * 1.14, 3.4, 5.0); f.stroke();
            // body
            const body = circlePath(x, y, r);
            const bg = c.createRadialGradient(x - r * .32, y - r * .36, r * .05, x, y, r * 1.05);
            bg.addColorStop(0, css(lite(base, .62))); bg.addColorStop(.32, css(lite(base, .12))); bg.addColorStop(.7, css(base)); bg.addColorStop(1, css(dark(base, .62)));
            c.fillStyle = bg; c.fill(body);
            // inner facet ring
            c.save(); c.clip(body);
            c.lineWidth = r * .11; c.strokeStyle = css(lite(base, .55), .4);
            c.beginPath(); c.arc(x, y, r * .62, 0, TAU); c.stroke();
            if (!o.simple) {
                const n = 8;
                c.lineWidth = r * .04; c.strokeStyle = css(dark(base, .5), .35);
                c.beginPath();
                for (let i = 0; i < n; i++) { const a = i * TAU / n + .2; c.moveTo(x + Math.cos(a) * r * .62, y + Math.sin(a) * r * .62); c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
                c.stroke();
            }
            c.restore();
            // dark lower crescent, off-centre highlight, glint
            f.lineCap = 'round';
            f.strokeStyle = 'rgba(0,0,12,.34)'; f.lineWidth = r * .22; f.beginPath(); f.arc(x, y, r * .86, .25, 1.45); f.stroke();
            f.save(); f.translate(x - r * .34, y - r * .4); f.rotate(-.7); f.scale(1, .58);
            const hg2 = f.createRadialGradient(0, 0, 0, 0, 0, r * .36);
            hg2.addColorStop(0, 'rgba(255,255,255,.92)'); hg2.addColorStop(.6, 'rgba(255,255,255,.35)'); hg2.addColorStop(1, 'rgba(255,255,255,0)');
            f.fillStyle = hg2; f.beginPath(); f.arc(0, 0, r * .36, 0, TAU); f.fill(); f.restore();
            f.fillStyle = 'rgba(255,255,255,.85)'; f.beginPath(); f.arc(x + r * .38, y + r * .3, r * .07, 0, TAU); f.fill();
            f.lineWidth = r * .06; f.strokeStyle = css(dark(base, .8), .55); f.stroke(body);
            this.restore();
        },

        pearl(x, y, r, tint) {
            const c = this.c, f = this.f, env = this.env;
            this.save();
            const seat = circlePath(x, y, r * 1.14);
            this.occlude(seat, 0);
            c.fillStyle = this.metalGrad(c, x, y, r * 1.14, 2.2); c.fill(seat);
            f.lineWidth = r * .07; f.strokeStyle = css(dark(env.metal, .7), .9); f.stroke(seat);
            const body = circlePath(x, y, r);
            const g = c.createRadialGradient(x - r * .32, y - r * .36, r * .05, x, y, r * 1.02);
            g.addColorStop(0, '#ffffff'); g.addColorStop(.38, css(lite(env.pal[4], .6))); g.addColorStop(.8, css(mix(env.pal[4], [150, 130, 140], .35))); g.addColorStop(1, css(mix(env.pal[4], [70, 55, 75], .55)));
            c.fillStyle = g; c.fill(body);
            const tg = c.createRadialGradient(x + r * .35, y + r * .4, 0, x + r * .35, y + r * .4, r * .9);
            tg.addColorStop(0, css(tint, .55)); tg.addColorStop(1, css(tint, 0));
            c.save(); c.clip(body); c.fillStyle = tg; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
            f.save(); f.translate(x - r * .32, y - r * .38); f.rotate(-.7); f.scale(1, .6);
            const hg = f.createRadialGradient(0, 0, 0, 0, 0, r * .4);
            hg.addColorStop(0, 'rgba(255,255,255,.95)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
            f.fillStyle = hg; f.beginPath(); f.arc(0, 0, r * .4, 0, TAU); f.fill(); f.restore();
            f.lineWidth = r * .05; f.strokeStyle = 'rgba(40,20,50,.35)'; f.stroke(body);
            this.restore();
        },

        /* metallic ring about the origin */
        ring(r, w) {
            const c = this.c, f = this.f, env = this.env, m = env.metal;
            this.save();
            const outline = new Path2D(); outline.arc(0, 0, r + w / 2, 0, TAU); outline.arc(0, 0, r - w / 2, 0, TAU, true);
            this.occlude(outline, 0);
            let g;
            if (c.createConicGradient) {
                g = c.createConicGradient(0.4, 0, 0);
                const cyc = 4;
                for (let i = 0; i <= cyc; i++) {
                    const t = i / cyc;
                    g.addColorStop(Math.min(1, t), css(m));
                    if (i < cyc) { g.addColorStop(t + .06, css(lite(m, .65))); g.addColorStop(t + .15, css(dark(m, .5))); g.addColorStop(t + .2, css(m)); }
                }
            } else g = this.metalGrad(c, 0, 0, r + w, .8);
            c.strokeStyle = g; c.lineWidth = w; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
            f.lineCap = 'butt';
            f.strokeStyle = css(env.lead, .9); f.lineWidth = w * .14;
            f.beginPath(); f.arc(0, 0, r + w / 2, 0, TAU); f.stroke();
            f.beginPath(); f.arc(0, 0, r - w / 2, 0, TAU); f.stroke();
            f.strokeStyle = 'rgba(255,246,210,.5)'; f.lineWidth = w * .1;
            f.beginPath(); f.arc(0, 0, r - w * .22, 0, TAU); f.stroke();
            this.restore();
        },

        /* small gold beads along a circle (positions given as angles) */
        beads(r, size, angles) {
            for (const a of angles) {
                const x = Math.cos(a) * r, y = Math.sin(a) * r;
                this.save();
                const p = circlePath(x, y, size);
                this.occlude(p, 0);
                const g = this.c.createRadialGradient(x - size * .3, y - size * .3, 0, x, y, size);
                g.addColorStop(0, css(lite(this.env.metal, .8))); g.addColorStop(.5, css(this.env.metal)); g.addColorStop(1, css(dark(this.env.metal, .6)));
                this.c.fillStyle = g; this.c.fill(p);
                this.f.lineWidth = size * .22; this.f.strokeStyle = css(this.env.lead, .85); this.f.stroke(p);
                this.restore();
            }
        },

        /* polar glass cell with optional diagonal facet split */
        cell(r0, r1, t0, t1, base, sec, opts) {
            opts = opts || {};
            const path = ringBand(r0, r1, t0, t1);
            const rm = (r0 + r1) / 2, tm = (t0 + t1) / 2;
            const cx = Math.cos(tm) * rm, cy = Math.sin(tm) * rm;
            const rad = Math.max(r1 - r0, rm * (t1 - t0)) * .62;
            const split = opts.facet && this.rng() < opts.facet;
            if (split) {
                const a = [Math.cos(t0) * r0, Math.sin(t0) * r0], b = [Math.cos(t1) * r0, Math.sin(t1) * r0],
                    cc = [Math.cos(t1) * r1, Math.sin(t1) * r1], d = [Math.cos(t0) * r1, Math.sin(t0) * r1];
                const flip = this.rng() < .5;
                const h1 = flip ? polyPath([a, b, cc, [(a[0] + d[0]) / 2 * 2 - a[0], 0]].slice(0, 3)) : polyPath([a, b, d]);
                const h2 = flip ? polyPath([a, cc, d]) : polyPath([b, cc, d]);
                const bw = Math.max(r1 - r0, 0.02) * 0.0;
                this.pane(h1, base, { pre: path, cx, cy, rad, sec, lead: opts.lead, pools: 1, streaks: 1, shade: rad * .25 });
                this.pane(h2, mix(base, this.rng() < .5 ? sec[0] || base : [255, 255, 255], .22), { pre: path, cx, cy, rad, sec, lead: opts.lead, pools: 1, streaks: 1, shade: rad * .25 });
                this.f.save(); this.f.lineJoin = 'round'; this.f.lineWidth = opts.lead == null ? this.env.leadW : opts.lead; this.f.strokeStyle = css(this.env.lead); this.f.stroke(path); this.f.restore();
            } else {
                this.pane(path, base, { cx, cy, rad, sec, lead: opts.lead, pools: opts.pools == null ? 2 : opts.pools, streaks: opts.streaks, shade: rad * .28 });
            }
        }
    };

    /* ======================= RECIPES ======================= */

    /* Polar tessera / mosaic ground filling the whole canvas. */
    function paintBed(g, env, p) {
        const rng = env.rng, al = env.al, E = env.E, glass = p.glass;
        const lead = env.leadW * .62;
        const c = g.c;
        // deep underlay
        c.save(); c.fillStyle = css(dark(env.pal[0], .1)); c.beginPath(); c.arc(0, 0, E + .2, 0, TAU); c.fill(); c.restore();
        let r = 0, ring = 0;
        while (r < E + .15) {
            const h = (p.h0 + rng() * p.h1) * (1 + r * p.grow);
            const nSub = p.sub[0] + ((rng() * (p.sub[1] - p.sub[0] + 1)) | 0);
            const cuts = [-0.06 * al];
            for (let k = 1; k < nSub; k++) cuts.push(al * (k + (rng() - .5) * .5) / nSub);
            cuts.push(al * 1.06);
            for (let k = 0; k < cuts.length - 1; k++) {
                const base = g.pick(glass);
                const sec = g.others(glass, base);
                g.cell(r, r + h, cuts[k], cuts[k + 1], base, sec, { facet: env.detail ? p.facets : p.facets * .5, lead, pools: 2 });
            }
            r += h; ring++;
        }
        // radial mullions on the mirror axes
        const f = g.f; f.save(); f.lineCap = 'butt';
        for (const a of [0, al]) {
            f.strokeStyle = css(env.lead); f.lineWidth = env.leadW * 1.5;
            f.beginPath(); f.moveTo(Math.cos(a) * .05, Math.sin(a) * .05); f.lineTo(Math.cos(a) * (E + .2), Math.sin(a) * (E + .2)); f.stroke();
            f.strokeStyle = 'rgba(255,246,214,.22)'; f.lineWidth = env.leadW * .5;
            f.beginPath(); f.moveTo(Math.cos(a) * .05, Math.sin(a) * .05); f.lineTo(Math.cos(a) * (E + .2), Math.sin(a) * (E + .2)); f.stroke();
        }
        f.restore();
        // vignette toward the edges
        if (p.vignette) {
            const c2 = g.c, vg = c2.createRadialGradient(0, 0, .55, 0, 0, E);
            const dc = css(mix(env.pal[0], [0, 0, 0], .5));
            const rgbs = dc.replace('rgb(', '').replace(')', '');
            vg.addColorStop(0, `rgba(${rgbs},${p.dim || 0})`); vg.addColorStop(.45, `rgba(${rgbs},${(p.dim || 0) + .1})`); vg.addColorStop(1, `rgba(${rgbs},${p.vignette})`);
            c2.save(); c2.fillStyle = vg; c2.beginPath(); c2.arc(0, 0, E + .2, 0, TAU); c2.fill(); c2.restore();
        }
    }

    /* Gothic lancet / rounded petal / leaf with an inset mosaic of glass cells. */
    function paintLancet(g, env, o) {
        const r0 = o.r0, r1 = o.r1, wm = o.wm, round = o.round || 0, L = r1 - r0;
        const lw = env.leadW, rng = env.rng, pal = env.pal;
        const frameBase = pal[o.frame == null ? 2 : o.frame];
        const outer = lancetPath(r0, r1, wm, round);
        const mid = (r0 + r1) / 2;
        const secAll = g.others(o.glass, frameBase);
        g.pane(outer, frameBase, { cx: mid, cy: 0, rad: L * .56, ang: 0, lead: lw * 1.7, sec: secAll, pools: 2, streaks: 2, shade: wm * .24 });
        const bw = Math.min(wm * .2, o.leaf ? wm * .22 : wm * .2);
        const ra = r0 + bw * 1.7, rb = r1 - bw * (round > .5 ? 1.5 : 2.2), wi = wm - bw;
        const inset = lancetPath(ra, rb, wi, round);
        g.save(); g.clip(inset);
        const nr = o.rows, ncol = o.cols;
        const edges = [ra];
        for (let i = 1; i < nr; i++) edges.push(ra + (rb - ra) * (i / nr + (rng() - .5) * .12));
        edges.push(rb + .02);
        const phi = Math.atan2(wi, ra + (rb - ra) * .42) * 1.3;
        const bounds = []; for (let k = -ncol; k <= ncol; k++) bounds.push(k * phi / ncol);
        for (let i = 0; i < nr; i++) {
            for (let k = 0; k < bounds.length - 1; k++) {
                const base = g.pick(o.glass);
                g.cell(edges[i], edges[i + 1], bounds[k], bounds[k + 1], base, g.others(o.glass, base), { facet: env.soft ? .2 : .3, lead: lw * .6, pools: 2 });
            }
        }
        // folded-petal facet: lit and shaded halves + sheen
        const c = g.c;
        const lg = c.createLinearGradient(0, -wi, 0, wi);
        lg.addColorStop(0, 'rgba(0,0,20,.26)'); lg.addColorStop(.47, 'rgba(0,0,20,.0)'); lg.addColorStop(.53, 'rgba(255,248,230,.0)'); lg.addColorStop(1, 'rgba(255,248,230,.09)');
        c.fillStyle = lg; c.fillRect(ra, -wi, rb - ra, wi * 2);
        const sg = c.createLinearGradient(ra, 0, rb, 0);
        sg.addColorStop(0, 'rgba(0,0,16,.4)'); sg.addColorStop(.3, 'rgba(0,0,16,0)'); sg.addColorStop(.85, 'rgba(255,240,200,.05)'); sg.addColorStop(1, 'rgba(255,240,200,.16)');
        c.fillStyle = sg; c.fillRect(ra, -wi, rb - ra, wi * 2);
        // specular glass streak along one shoulder
        c.save(); c.lineCap = 'round'; c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = wi * .09;
        c.beginPath(); c.moveTo(ra + (rb - ra) * .22, wi * .5); c.bezierCurveTo(ra + (rb - ra) * .45, wi * .78, ra + (rb - ra) * .62, wi * .62, ra + (rb - ra) * .78, wi * .2); c.stroke();
        c.lineWidth = wi * .03; c.strokeStyle = 'rgba(255,255,255,.55)';
        c.beginPath(); c.moveTo(ra + (rb - ra) * .26, wi * .56); c.bezierCurveTo(ra + (rb - ra) * .46, wi * .8, ra + (rb - ra) * .6, wi * .68, ra + (rb - ra) * .72, wi * .36); c.stroke();
        c.restore();
        g.restore();
        // inset lead, bevel and central vein
        const f = g.f;
        f.save(); f.lineJoin = 'round';
        f.save(); f.clip(inset); f.lineWidth = lw * 2.6; f.strokeStyle = 'rgba(255,246,214,.16)'; f.stroke(inset); f.restore();
        f.lineWidth = lw * 1.25; f.strokeStyle = css(env.lead); f.stroke(inset);
        if (o.vein) {
            f.lineWidth = lw * .8; f.beginPath(); f.moveTo(ra + (rb - ra) * .03, 0); f.lineTo(rb - (rb - ra) * .02, 0); f.stroke();
            f.lineWidth = lw * .22; f.strokeStyle = 'rgba(255,246,214,.38)'; f.beginPath(); f.moveTo(ra + (rb - ra) * .03, wi * .03); f.lineTo(rb - (rb - ra) * .05, wi * .03); f.stroke();
        }
        f.restore();
        // outer bevel highlight (on the outside, reads like a polished rim)
        f.save(); f.lineJoin = 'round'; f.lineWidth = lw * .3; f.strokeStyle = 'rgba(255,240,200,.5)'; f.stroke(lancetPath(r0 + lw, r1 - lw * 1.4, wm - lw * 1.4, round)); f.restore();
        // jewels
        const nj = o.jewel || 0;
        for (let i = 0; i < nj; i++) {
            const t = nj === 1 ? .5 : (i + .6) / (nj + .1);
            const jr = (rb - ra) * (nj > 2 ? .052 : .06) + wi * .05;
            const jx = ra + (rb - ra) * (.2 + .58 * (i / Math.max(1, nj - 1)) * (nj > 1 ? 1 : 0)) + (nj === 1 ? (rb - ra) * .25 : 0);
            const base = pal[o.jewelCols ? o.jewelCols[i % o.jewelCols.length] : (i % 2 ? 4 : 3)];
            g.jewel(jx, 0, jr, base, { simple: true, ang: 2.2 });
        }
    }

    function paintPetals(g, env, p) {
        const al = env.al, spacingHalf = al; // lateral half-spacing between same-axis motifs ~ 2*al/2
        const rMid = p.r0 + (p.r1 - p.r0) * .55;
        const wm = (p.wFrac * (p.axis === 'A' || p.angleFrac ? al : al) * rMid) * (p.axis === 'A' ? 1 : 1) * (p.leaf ? 1 : 1);
        const ang = p.angleFrac != null ? p.angleFrac * al : (p.axis === 'B' ? al : 0);
        g.save(); g.rot(ang);
        if (p.tilt) g.rot(p.tilt);
        paintLancet(g, env, { r0: p.r0, r1: p.r1, wm, round: p.round, rows: p.rows + (env.detail ? 0 : -1 + 1), cols: p.cols, frame: p.frame, glass: p.glass, jewel: env.detail || p.jewel === 0 ? p.jewel : Math.min(1, p.jewel), vein: p.vein, leaf: p.leaf });
        g.restore();
    }

    /* A four-lobed roundel with jewel centre (cathedral-style tracery medallion) */
    function paintQuatrefoil(g, env, x, y, R, glass, a0) {
        const lw = env.leadW * .8, pal = env.pal;
        g.save(); g.c.translate(x, y); g.f.translate(x, y); g.rot(a0 || 0);
        const disc = circlePath(0, 0, R * 1.14);
        g.pane(disc, dark(pal[1], .25), { cx: 0, cy: 0, rad: R * 1.1, lead: lw * 1.4, pools: 1, streaks: 0, shade: R * .2 });
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2, lx = Math.cos(a) * R * .52, ly = Math.sin(a) * R * .52;
            const base = g.pick(glass);
            g.pane(circlePath(lx, ly, R * .5), base, { cx: lx, cy: ly, rad: R * .5, lead: lw, sec: g.others(glass, base), pools: 2, streaks: 1, shade: R * .16 });
        }
        const core = g.pick(glass);
        g.pane(circlePath(0, 0, R * .42), lite(core, .1), { cx: 0, cy: 0, rad: R * .42, lead: lw, pools: 1, streaks: 1, shade: R * .12 });
        g.jewel(0, 0, R * .2, pal[env.metalJewel == null ? 3 : env.metalJewel], { simple: true });
        g.restore();
    }

    /* Decorative border band: metal rings, jewelled cell course, roundels */
    function paintBorder(g, env, p) {
        const al = env.al, lw = env.leadW, pal = env.pal, glass = p.glass;
        const r0 = p.r0, r1 = p.r1;
        const band = ringBand(r0, r1, -al * .08, al * 1.08);
        g.pane(band, dark(pal[1], .35), { cx: 0, cy: 0, rad: .12, lead: lw, pools: 0, streaks: 0, shade: .03 });
        // small mosaic course, mirror-matched
        const m = 3, rc0 = r0 + .018, rc1 = r0 + (r1 - r0) * .36;
        for (let k = 0; k < m; k++) {
            const t0 = al * k / m, t1 = al * (k + 1) / m;
            const base = g.pick(glass);
            g.cell(rc0, rc1, t0, t1, base, g.others(glass, base), { lead: lw * .6, facet: .3 });
        }
        for (let k = 0; k < m * 2; k++) {
            const t0 = al * k / (m * 2), t1 = al * (k + 1) / (m * 2);
            const base = g.pick(glass);
            g.cell(r1 - (r1 - r0) * .26, r1 - .018, t0, t1, base, g.others(glass, base), { lead: lw * .6, facet: .2 });
        }
        g.ring(r0, .026); g.ring(r1, .034);
        g.ring(r0 + (r1 - r0) * .4, .012); g.ring(r1 - (r1 - r0) * .3, .012);
        // beads on the inner metal ring (angles symmetric about axes)
        const ang = []; for (let k = 0; k <= 6; k++) ang.push(al * k / 6);
        g.beads(r0 + (r1 - r0) * .4, .0095, ang);
        // roundel on B axis, pointed lancet on A axis
        paintQuatrefoil(g, env, Math.cos(al) * (r0 + r1) / 2, Math.sin(al) * (r0 + r1) / 2, (r1 - r0) * .42, glass, al);
        g.save(); g.rot(0);
        paintLancet(g, env, { r0: r0 + (r1 - r0) * .38, r1: r1 - (r1 - r0) * .05, wm: (r1 - r0) * .26, round: 0, rows: 2, cols: 1, frame: 3, glass, jewel: 0, vein: true });
        g.restore();
    }

    /* Collar of jewels / pearls (identity, full ring) */
    function paintCollar(g, env, p) {
        const N2 = env.N * 2, pal = env.pal;
        const r = p.r;
        g.ring(r, p.big * .55);
        if (p.beadsR) {
            g.ring(p.beadsR, p.big * .3);
            const a = []; for (let k = 0; k < N2 * 2; k++) a.push((k + .5) * TAU / (N2 * 2));
            if (p.type === 'pearl') { for (const t of a) g.pearl(Math.cos(t) * p.beadsR, Math.sin(t) * p.beadsR, p.small * .62, pal[3]); }
            else g.beads(p.beadsR, p.small * .42, a);
        }
        for (let k = 0; k < N2; k++) {
            const t = k * TAU / N2, x = Math.cos(t) * r, y = Math.sin(t) * r;
            if (p.type === 'pearl') g.pearl(x, y, p.big, k % 2 ? pal[2] : pal[3]);
            else g.jewel(x, y, p.big, pal[p.glass[k % p.glass.length]], { halo: true, ang: t + 2 });
            const t2 = t + Math.PI / N2, x2 = Math.cos(t2) * r, y2 = Math.sin(t2) * r;
            if (p.type === 'pearl') g.pearl(x2, y2, p.small, pal[4 - (k % 2) * 3 === 1 ? 1 : 3]);
            else g.jewel(x2, y2, p.small, pal[p.glass[(k + 3) % p.glass.length]], { simple: true, ang: t2 + 2 });
        }
    }

    /* Nested rosette / medallion (identity) */
    function paintCenter(g, env, p) {
        const R0 = p.R, M = env.N * 2, pal = env.pal, lw = env.leadW;
        const c = g.c;
        // warm glow behind
        const GR = p.glow || R0 * 1.35;
        const gl = c.createRadialGradient(0, 0, R0 * .3, 0, 0, GR);
        gl.addColorStop(0, css(lite(pal[3], .45), p.glowA || .55)); gl.addColorStop(.35, css(lite(pal[3], .2), (p.glowA || .55) * .45)); gl.addColorStop(1, css(pal[3], 0));
        c.fillStyle = gl; c.beginPath(); c.arc(0, 0, GR, 0, TAU); c.fill();
        if (p.rays) {   // soft light rays fanning out between the mirror axes
            c.save();
            for (let k = 0; k < M; k++) {
                c.save(); c.rotate((k + .5) * TAU / M);
                const rg = c.createLinearGradient(R0, 0, GR, 0);
                rg.addColorStop(0, css(lite(pal[3], .6), .26)); rg.addColorStop(1, css(pal[3], 0));
                c.fillStyle = rg; c.beginPath(); c.moveTo(R0 * .5, 0); c.lineTo(GR, -GR * .085); c.lineTo(GR, GR * .085); c.closePath(); c.fill();
                c.restore();
            }
            c.restore();
        }
        // gold collar disc
        const disc = circlePath(0, 0, R0);
        g.occlude(disc, 0);
        c.fillStyle = g.metalGrad(c, 0, 0, R0, 2.3); c.fill(disc);
        g.f.lineWidth = lw * 1.2; g.f.strokeStyle = css(env.lead); g.f.stroke(disc);
        g.f.lineWidth = lw * .4; g.f.strokeStyle = 'rgba(255,244,200,.5)'; g.f.beginPath(); g.f.arc(0, 0, R0 * .985, 3.3, 5.4); g.f.stroke();
        const beadAng = []; for (let k = 0; k < M * 2; k++) beadAng.push((k + .5) * TAU / (M * 2));
        g.beads(R0 * .93, R0 * .028, beadAng);
        // glass ground
        g.pane(circlePath(0, 0, R0 * .875), dark(pal[1], .3), { cx: 0, cy: 0, rad: R0, lead: lw * 1.2, pools: 2, streaks: 0, shade: R0 * .1 });
        if (!p.simple) {
            // petal ring
            const pr0 = R0 * .38, pr1 = R0 * .86, wm = TAU * (pr0 + (pr1 - pr0) * .5) / M * .5 * .86;
            for (let i = 0; i < M; i++) {
                g.save(); g.rot(i * TAU / M + (p.petalsA ? 0 : 0));
                paintLancet(g, env, { r0: pr0, r1: pr1, wm, round: .35, rows: 2, cols: 1, frame: i % 2 ? 3 : 2, glass: p.glass, jewel: 0, vein: true });
                g.restore();
            }
            // inner bead ring
            const a = []; for (let k = 0; k < M; k++) a.push(k * TAU / M + Math.PI / M);
            for (let k = 0; k < M; k++) g.jewel(Math.cos(a[k]) * R0 * .36, Math.sin(a[k]) * R0 * .36, R0 * .03, pal[k % 2 ? 3 : 4], { simple: true });
        }
        // central glass star + jewel
        const cr = p.simple ? R0 * .7 : R0 * .31;
        const star = [];
        const K = M;
        for (let i = 0; i < K; i++) {
            const t0 = i * TAU / K, t1 = (i + 1) * TAU / K;
            const base = i % 2 ? lite(pal[4], .2) : lite(pal[3], .25);
            g.pane(ringBand(cr * .38, cr, t0, t1), base, { cx: Math.cos((t0 + t1) / 2) * cr * .7, cy: Math.sin((t0 + t1) / 2) * cr * .7, rad: cr * .4, lead: lw * .6, sec: [pal[3], pal[4]], pools: 1, streaks: 0, shade: cr * .1 });
        }
        g.ring(cr, R0 * .04);
        g.jewel(0, 0, cr * (p.simple ? .5 : .4), pal[p.core == null ? 3 : p.core], { halo: true, ang: 2.2 });
    }

    const recipes = { bed: paintBed, petals: paintPetals, border: paintBorder, collar: paintCollar, center: paintCenter };

    /* ---------- public API ---------- */
    function prepare(spec, ctx) {
        // spec: {recipe, params, seed}; ctx: {preset, N, extent, ppr, detail}
        const preset = ctx.preset, E = ctx.extent, ppr = ctx.ppr;
        const side = Math.max(8, Math.round(E * 2 * ppr));
        const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = side; const x = cv.getContext('2d'); x.translate(side / 2, side / 2); x.scale(ppr, ppr); x.lineCap = 'round'; return [cv, x]; };
        const [colorCv, cc] = mk(), [finishCv, fc] = mk();
        const env = {
            N: ctx.N, al: Math.PI / ctx.N, E, ppr, detail: ctx.detail,
            pal: preset.palette.map(hex), metal: hex(preset.metal), lead: hex(preset.lead),
            leadW: preset.leadW, soft: !!(spec.params && spec.params.soft),
            shadow: hex(preset.shadow || '#050310'),
            rng: rngFrom((preset.seed * 2654435761 + hashStr(spec.id)) >>> 0)
        };
        const g = new Painter(cc, fc, env);
        recipes[spec.recipe](g, env, Object.assign({}, spec.params));
        return {
            id: spec.id, color: colorCv, finish: finishCv, width: side, height: side,
            pivot: { x: side / 2, y: side / 2 }, ppr,
            bytes: side * side * 8
        };
    }
    function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

    return { prepare, util: { hex, mix, css, lite, dark, rngFrom } };
})();
