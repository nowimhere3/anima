// Color-only timeline: 0.6 units/sec matches the legacy 60 Hz color rate.
function Index2ColorClock() {
    let shared = null, offset = 0, sums = [0], seed;
    const cycle = t => Math.floor((t - (Math.PI + Math.asin(0.95)) / 2) / Math.PI);
    const at = (s, wall) => s.time + (wall - s.wall) / 1000 * 0.6 * s.speed;
    function adopt(s) {
        if (!s || ![s.time,s.wall,s.speed,s.seed,s.breathTime,s.breathHue].every(Number.isFinite)) return;
        if (!shared || s.seed !== seed || s.breathTime !== shared.breathTime) sums = [0];
        seed = s.seed; shared = { ...s };
    }
    function hue(t) {
        const count = Math.max(0, cycle(t) - cycle(shared.breathTime));
        while (sums.length <= count) {
            let n = (seed ^ Math.imul(sums.length, 0x9e3779b9)) >>> 0;
            n = Math.imul(n ^ n >>> 16, 0x21f0aaad);
            n = Math.imul(n ^ n >>> 15, 0x735a2d97);
            sums.push((sums.at(-1) + 75 + ((n ^ n >>> 15) >>> 0) % 120) % 360);
        }
        return (shared.breathHue + sums[count]) % 360;
    }
    return {
        time(local, wall = Date.now()) { return shared ? at(shared, wall) : local + offset; },
        start(local, speed, breathHue) {
            const t = local + offset;
            adopt({ time:t, wall:Date.now(), speed, seed:crypto.getRandomValues(new Uint32Array(1))[0], breathTime:t, breathHue });
        },
        retime(speed) { if (shared) { const wall=Date.now(); shared={...shared,time:at(shared,wall),wall,speed}; } },
        snapshot() { return shared && { ...shared }; },
        adopt,
        hue,
        paired() { return !!shared; },
        stop(local) {
            if (!shared) return null;
            const t=at(shared,Date.now()), result={time:t,hue:hue(t)};
            offset=t-local; shared=null; return result;
        }
    };
}
