/* ============================================================
   LAB PRESETS — versioned, authored native-art recipes
   Three first-build presets from the Art-First Kaleidoscope design:
   Cathedral Glass, Rose Window, Pearl Lotus.
   Layers are listed back to front. dir: 'cw' | 'ccw' | 'still'.
   Speeds are degrees/second (design values); the global Motion
   multiplier scales them.  palette = [ground, body1, body2, accent, highlight]
   ============================================================ */
const LabPresets = (function () {
    "use strict";

    const L = (id, name, recipe, o) => Object.assign({
        id, name, visible: true, recipe,
        proj: 'radial', folds: null, extent: 1.15, clip: null,
        opacity: 1, blend: 'source-over',
        dir: 'still', speed: 0, frozen: false,
        scale: 1, x: 0, y: 0,
        light: { mode: 'direct', strength: 0 },
        pulse: { amount: 0, period: 20 },
        orbit: { rx: 0, ry: 0, period: 120 },
        sampleSpin: 0,
        params: {}
    }, o);

    const list = [
        {
            id: 'cathedral', name: 'Cathedral Glass', tag: 'Classic stained glass',
            folds: 8, detail: 1, seed: 7301,
            palette: ['#101528', '#2449B7', '#B8274C', '#E9A93F', '#FFF0C5'],
            metal: '#D9AE55', lead: '#0b0a12', leadW: 0.0115,
            background: '#07091a',
            light: { preset: 'chroma-spectrum', speed: 0.5 },
            layers: [
                L('bed', 'Tessera bed', 'bed', {
                    extent: 'full', dir: 'still',
                    params: { h0: 0.048, h1: 0.05, grow: 0.22, sub: [3, 5], glass: [[1, .42], [2, .28], [3, .22], [4, .06], [0, .02]], facets: .3, vignette: 0.7, dim: .2, ribs: true }
                }),
                L('lancets', 'Broad lancets', 'petals', {
                    extent: 1.02, dir: 'cw', speed: 0.24, opacity: 0.97,
                    light: { mode: 'light', strength: 0.14 },
                    params: { axis: 'A', r0: 0.20, r1: 0.985, wFrac: 0.93, round: 0.0, rows: 6, cols: 3, frame: 2, glass: [[1, .42], [2, .26], [3, .24], [4, .08]], jewel: 3, vein: true, bright: 1 }
                }),
                L('inner', 'Inner petals', 'petals', {
                    extent: 0.72, dir: 'ccw', speed: 0.17, opacity: 0.95,
                    pulse: { amount: 0.008, period: 19 },
                    params: { axis: 'B', r0: 0.16, r1: 0.66, wFrac: 0.92, round: 0.25, rows: 4, cols: 3, frame: 3, glass: [[3, .45], [2, .3], [4, .15], [1, .1]], jewel: 2, vein: true }
                }),
                L('collar', 'Jewel collar', 'collar', {
                    proj: 'identity', extent: 0.70, dir: 'cw', speed: 0.43, opacity: 0.95,
                    params: { r: 0.505, big: 0.046, small: 0.026, glass: [2, 1, 3, 1, 2, 3], beadsR: 0.585 }
                }),
                L('border', 'Lead & gold border', 'border', {
                    extent: 1.17, dir: 'ccw', speed: 0.12, opacity: 0.96,
                    clip: { inner: 0.775, outer: 1.17 },
                    pulse: { amount: 0.006, period: 23 },
                    params: { r0: 0.80, r1: 1.095, glass: [[1, .5], [2, .3], [3, .2]] }
                }),
                L('rosette', 'Nested rosette', 'center', {
                    proj: 'identity', extent: 0.62, dir: 'still', speed: 0,
                    params: { R: 0.255, glass: [[1, .4], [2, .3], [3, .3]], core: 3, glow: 0.6, glowA: .6, rays: true }
                })
            ]
        },
        {
            id: 'rose', name: 'Rose Window', tag: 'Floral mandala',
            folds: 10, detail: 1, seed: 4417,
            palette: ['#25143D', '#C65B88', '#EF997E', '#46A99A', '#FFECCB'],
            metal: '#D7B26A', lead: '#150a22', leadW: 0.0098,
            background: '#120820',
            light: { preset: 'chroma-aurora', speed: 0.5 },
            layers: [
                L('bed', 'Petal mosaic', 'bed', {
                    extent: 'full',
                    params: { h0: 0.048, h1: 0.05, grow: 0.22, sub: [3, 5], glass: [[1, .3], [2, .24], [3, .26], [0, .1], [4, .1]], facets: .35, vignette: 0.7, dim: .2, ribs: true, fan: true }
                }),
                L('petals', 'Rounded petals', 'petals', {
                    extent: 1.02, dir: 'cw', speed: 0.20, opacity: 0.96,
                    pulse: { amount: 0.012, period: 17 },
                    params: { axis: 'A', r0: 0.17, r1: 0.90, wFrac: 0.95, round: 0.85, rows: 5, cols: 3, frame: 1, glass: [[1, .42], [2, .36], [4, .22]], jewel: 3, vein: true, bright: 1 }
                }),
                L('small', 'Small petals', 'petals', {
                    extent: 0.72, dir: 'ccw', speed: 0.29, opacity: 0.93,
                    light: { mode: 'light', strength: 0.2 },
                    pulse: { amount: 0.012, period: 23 },
                    params: { axis: 'B', r0: 0.12, r1: 0.62, wFrac: 0.9, round: 0.35, rows: 4, cols: 3, frame: 3, glass: [[3, .5], [4, .3], [2, .2]], jewel: 2, vein: true }
                }),
                L('leaves', 'Leaf ribbons', 'petals', {
                    extent: 1.18, dir: 'ccw', speed: 0.13, opacity: 0.92,
                    params: { axis: 'B', r0: 0.80, r1: 1.15, wFrac: 0.27, round: 0.0, rows: 3, cols: 1, frame: 3, glass: [[3, .6], [4, .15], [1, .25]], jewel: 0, vein: true, leaf: true }
                }),
                L('pearls', 'Pearl ring', 'collar', {
                    proj: 'identity', extent: 0.66, dir: 'cw', speed: 0.51, opacity: 0.92,
                    params: { type: 'pearl', r: 0.475, big: 0.036, small: 0.019, beadsR: 0.555 }
                }),
                L('flower', 'Center flower', 'center', {
                    proj: 'identity', extent: 0.56, dir: 'still',
                    params: { R: 0.25, glass: [[1, .4], [2, .3], [4, .3]], core: 2, petalsA: 1, petalsB: 2, glow: 0.54, glowA: .5, rays: true }
                })
            ]
        },
        {
            id: 'lotus', name: 'Pearl Lotus', tag: 'Minimal beauty',
            folds: 6, detail: 0, seed: 9127,
            palette: ['#103A40', '#F2DFC2', '#82B7AA', '#D78F7D', '#C9A168'],
            metal: '#C9A168', lead: '#0d1618', shadow: '#2a6a70', leadW: 0.0078,
            background: '#0a2a30',
            light: { preset: 'chroma-spectrum', speed: 0.4 },
            layers: [
                L('bed', 'Enamel backing', 'bed', {
                    extent: 'full',
                    params: { h0: 0.09, h1: 0.07, grow: 0.4, sub: [2, 3], glass: [[2, .5], [1, .32], [3, .13], [0, .05]], facets: .4, vignette: 0.45, dim: 0, ribs: true, soft: true }
                }),
                L('petals', 'Broad petals', 'petals', {
                    extent: 0.95, dir: 'cw', speed: 0.14, opacity: 0.96,
                    params: { axis: 'A', r0: 0.18, r1: 0.88, wFrac: 0.98, round: 0.1, rows: 4, cols: 3, frame: 1, glass: [[1, .55], [2, .3], [3, .15]], jewel: 0, vein: true, soft: true, bright: 1 }
                }),
                L('inner', 'Inner petals', 'petals', {
                    extent: 0.6, dir: 'ccw', speed: 0.10, opacity: 0.94,
                    pulse: { amount: 0.01, period: 21 },
                    params: { axis: 'B', r0: 0.10, r1: 0.50, wFrac: 0.95, round: 0.25, rows: 2, cols: 2, frame: 3, glass: [[3, .5], [1, .35], [4, .15]], jewel: 0, vein: true, soft: true }
                }),
                L('pearls', 'Pearl collar', 'collar', {
                    proj: 'identity', extent: 0.4, dir: 'cw', speed: 0.25, opacity: 0.96,
                    params: { type: 'pearl', r: 0.285, big: 0.030, small: 0.016, beadsR: 0.0 }
                }),
                L('core', 'Cabochon core', 'center', {
                    proj: 'identity', extent: 0.2, dir: 'still',
                    params: { R: 0.155, glass: [[3, .5], [1, .5]], core: 3, simple: true }
                })
            ]
        }
    ];

    return { version: 1, list, byId: id => list.find(p => p.id === id) };
})();
