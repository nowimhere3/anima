/* ============================================================
   LAB OPTICS — explicit-input projections (no global clock, no singleton)
   Adapted from the sandbox radial algorithm (sandbox/optics.js):
   N rotational repeats => alpha = PI/N and 2N sectors. Sector k maps with
   R(k*alpha) when even and R((k+1)*alpha)*S(1,-1) when odd, so alternate
   sectors are genuine mirror images, not merely rotated copies.
   ============================================================ */
const LabOptics = (function () {
    "use strict";

    /** transform for sector k: returns {angle, flip} */
    function sectorTransform(k, N) {
        const a = Math.PI / N;
        return (k & 1) ? { angle: (k + 1) * a, flip: true } : { angle: k * a, flip: false };
    }

    /**
     * Fill dst (square, origin at centre) with the 2N mirrored sectors of the
     * canonical wedge [0, PI/N] of the source planes.
     * o: { N, pivot:{x,y}, sample:{x,y,rot,scale}, overlapPx }
     * Never advances time; clears only dst (an owned surface).
     */
    /** Source-space bounding rect (px, integer) of the canonical wedge, so only the needed pixels are drawn per sector. */
    function wedgeRect(N, R, sample, pivot, srcW, srcH, e) {
        const al = Math.PI / N, rr = R * 1.4143 / Math.cos(al / 2) * 1.002, sa = Math.sin(al), ca = Math.cos(al);
        const pts = [[0, -e], [rr, -e], [-sa * e + rr * ca, ca * e + rr * sa], [-sa * e, ca * e]];
        const S = sample, cr = Math.cos(-S.rot), sr = Math.sin(-S.rot), k = 1 / S.scale;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const p of pts) {
            const dx = p[0] - S.x, dy = p[1] - S.y;
            const sx = pivot.x + k * (dx * cr - dy * sr), sy = pivot.y + k * (dx * sr + dy * cr);
            x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
        }
        x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
        x1 = Math.min(srcW, Math.ceil(x1) + 2); y1 = Math.min(srcH, Math.ceil(y1) + 2);
        return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    }

    function projectRadial(dst, planes, o) {
        const N = o.N, al = Math.PI / N, ctx = dst.getContext('2d');
        const R = dst.width / 2, S = o.sample || { x: 0, y: 0, rot: 0, scale: 1 };
        const e = o.overlapPx == null ? 0.75 : o.overlapPx;          // constant-width seam overlap in pixels (perpendicular to each wedge edge)
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, dst.width, dst.height);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        const rr = R * 1.4143 / Math.cos(al / 2) * 1.002;
        const sa = Math.sin(al), ca = Math.cos(al);
        const rect = wedgeRect(N, R, S, o.pivot, planes[0].width, planes[0].height, e);
        if (rect.w <= 0 || rect.h <= 0) return;
        for (let k = 0; k < 2 * N; k++) {
            const t = sectorTransform(k, N);
            ctx.save();
            ctx.translate(R, R);
            ctx.rotate(t.angle);
            if (t.flip) ctx.scale(1, -1);
            ctx.beginPath();
            ctx.moveTo(0, -e); ctx.lineTo(rr, -e);
            ctx.lineTo(-sa * e + rr * ca, ca * e + rr * sa);
            ctx.lineTo(-sa * e, ca * e);
            ctx.closePath();
            ctx.clip();
            ctx.translate(S.x, S.y); ctx.rotate(S.rot); ctx.scale(S.scale, S.scale);
            ctx.translate(-o.pivot.x, -o.pivot.y);
            for (const p of planes) ctx.drawImage(p, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
            ctx.restore();
        }
    }

    /** identity: straight copy of the planes, centred, same resolution */
    function projectIdentity(dst, planes, o) {
        const ctx = dst.getContext('2d'), S = o.sample || { x: 0, y: 0, rot: 0, scale: 1 };
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, dst.width, dst.height);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.save();
        ctx.translate(dst.width / 2 + S.x, dst.height / 2 + S.y); ctx.rotate(S.rot); ctx.scale(S.scale, S.scale);
        ctx.translate(-o.pivot.x, -o.pivot.y);
        for (const p of planes) ctx.drawImage(p, 0, 0);
        ctx.restore();
    }

    /** Annulus clip in the current (R-unit) local frame; inner/outer in R units */
    function annulusPath(inner, outer) {
        const p = new Path2D();
        p.arc(0, 0, outer, 0, Math.PI * 2);
        if (inner > 0) p.arc(0, 0, inner, 0, Math.PI * 2, true);
        return p;
    }

    /** Keep only the annulus [inner, outer] (px from the centre) of a projected surface. */
    function bakeAnnulus(dst, inner, outer) {
        const ctx = dst.getContext('2d'), c = dst.width / 2;
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-in';
        const p = new Path2D(); p.arc(c, c, outer, 0, Math.PI * 2); if (inner > 0) p.arc(c, c, inner, 0, Math.PI * 2, true);
        ctx.fill(p, 'evenodd'); ctx.restore();
    }

    return { bakeAnnulus, sectorTransform, wedgeRect, projectRadial, projectIdentity, annulusPath };
})();
