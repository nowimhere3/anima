/* Explicit, ephemeral two-page settings pairing. No storage or animation clock. */
function Index2Pair({ button, status, read, apply, start = () => {}, stop = () => {} }) {
    let channel;
    try { channel = new BroadcastChannel('anima-index2-settings-v1'); }
    catch { button.disabled = true; status.textContent = 'Pairing unavailable'; return { changed() {} }; }
    // getRandomValues also works on HTTP origins where randomUUID is unavailable.
    const unique = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
    const id = unique();
    let request = null, link = null, sequence = 0, revision = [0, id];
    const older = (a, b) => a.at < b.at || (a.at === b.at && a.token < b.token);
    const newer = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
    function send(type, data = {}) { channel.postMessage({ version: 1, from: id, type, ...data }); }
    function directed(type, data = {}) {
        send(type, { to: link.peer, session: link.session, ...data });
    }
    function ui() {
        button.textContent = link?.paired ? 'Unpair' : request ? 'Waiting...' : 'Pair';
        button.setAttribute('aria-pressed', String(!!link?.paired));
        status.textContent = link?.paired ? 'Paired' : '';
        button.title = request && !link?.paired ? 'Cancel pairing request' : '';
    }
    function reset(notify = true) {
        if (link && notify) directed('bye');
        if (link?.paired) stop();
        link = null; request = null; ui();
    }
    function announce() { if (request && !link) send('request', { request }); }
    button.addEventListener('click', () => {
        if (request || link) reset();
        else { request = { at: Date.now(), token: unique() }; ui(); announce(); }
    });
    channel.addEventListener('message', ({ data: m }) => {
        if (!m || m.version !== 1 || m.from === id) return;
        if (m.type === 'request') {
            if (!request || link || !m.request || !older(request, m.request)) return;
            // Only the older volunteer may reserve a peer; all others remain independent.
            link = { peer: m.from, session: unique(), paired: false, seen: Date.now(), leader: true };
            directed('offer', { requestToken: m.request.token });
            return;
        }
        if (m.to !== id) return;
        if (m.type === 'offer') {
            if (!request || link || m.requestToken !== request.token) return;
            link = { peer: m.from, session: m.session, paired: false, seen: Date.now(), leader: false };
            directed('accept'); return;
        }
        if (!link || m.from !== link.peer || m.session !== link.session) return;
        link.seen = Date.now();
        if (m.type === 'bye') { reset(false); return; }
        if (m.type === 'accept' && link.leader && !link.paired) {
            start();
            revision = [++sequence, id];
            link.paired = true; ui();
            directed('ready', { state: read(), revision });
        } else if (m.type === 'ready' && !link.leader && !link.paired) {
            apply(m.state); revision = m.revision; sequence = Math.max(sequence, revision[0]);
            link.paired = true; ui(); directed('ping');
        } else if (m.type === 'state' && link.paired && Array.isArray(m.revision)) {
            sequence = Math.max(sequence, m.revision[0]);
            if (newer(m.revision, revision)) { revision = m.revision; apply(m.state); }
        }
    });
    setInterval(() => {
        if (link) {
            if (Date.now() - link.seen > (link.paired ? 15000 : 4000)) reset();
            else if (link.paired) directed('ping');
        } else announce();
    }, 1000);
    window.addEventListener('pagehide', () => reset());
    window.addEventListener('pageshow', event => { if (event.persisted) reset(); });
    ui();
    return { changed() {
        if (!link?.paired) return;
        revision = [++sequence, id];
        directed('state', { state: read(), revision });
    } };
}
