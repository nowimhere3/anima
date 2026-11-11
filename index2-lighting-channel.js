// Passive lighting transport. Only the original pair requester publishes.
const Index2LightingChannel = (() => {
    const name = 'anima-index2-lighting-v1';
    function publisher(read) {
        let channel;
        try { channel = new BroadcastChannel(name); }
        catch { return { start(){}, changed(){}, stop(){} }; }
        let session = null, seq = 0;
        function publish() { if (session) channel.postMessage({ type:'snapshot', session, seq:++seq, state:read() }); }
        channel.onmessage = ({data}) => { if (data?.type === 'query') publish(); };
        setInterval(publish, 1000);
        return {
            start() { session = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'); seq=0; setTimeout(publish,0); },
            changed: publish,
            stop() { if (session) channel.postMessage({type:'end',session}); session=null; }
        };
    }
    function subscriber(changed) {
        const channel = new BroadcastChannel(name);
        let wanted=false, current=null, seen=0;
        const retired = new Set();
        function leave() { wanted=false; current=null; changed(null,false); }
        channel.onmessage = ({data:m}) => {
            if (!wanted || !m || typeof m.session !== 'string' || retired.has(m.session)) return;
            if (m.type === 'end') {
                retired.add(m.session);
                if (current?.session === m.session) leave();
            } else if (m.type === 'snapshot' && m.state?.color && Number.isFinite(m.seq)) {
                if (current && (current.session !== m.session || current.seq >= m.seq)) return;
                current=m; seen=Date.now(); changed(m.state,true);
            }
        };
        setInterval(() => {
            if (current && Date.now()-seen>5000) { retired.add(current.session); leave(); }
            else if (wanted && !current) channel.postMessage({type:'query'});
        },1000);
        window.addEventListener('pagehide',leave);
        return { join() { wanted=true; changed(null,true); channel.postMessage({type:'query'}); }, leave };
    }
    return { publisher, subscriber };
})();
