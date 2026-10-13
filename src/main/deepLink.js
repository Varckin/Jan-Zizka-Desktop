const windowManager = require('./window');

function parseDeepLink(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let url;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== 'jan:') return null;
    const host = url.hostname || '';
    const parts = url.pathname.split('/').filter(Boolean);

    if (host === 'invite' || (host === '' && parts[0] === 'invite')) {
        const code = host === 'invite' ? parts[0] : parts[1];
        if (code) return { view: 'chat', query: { invite: code } };
    }
    if (host === 'chat' && parts[0]) {
        return { view: 'chat', query: { chat_id: parts[0] } };
    }
    if (host === 'e2e' && parts[0]) {
        return { view: 'e2e', query: { chat_id: parts[0] } };
    }
    if (host === 'settings') {
        return { view: 'settings', query: {} };
    }
    if (host === 'profile') {
        return { view: 'profile', query: {} };
    }
    if (host === 'auth') {
        const query = Object.fromEntries(url.searchParams.entries());
        if (parts[0] === 'reset' && !query.mode) query.mode = 'reset';
        return { view: 'auth', query };
    }
    return { view: 'chat', query: {} };
}

function navigate(target) {
    if (!target) return;
    windowManager.show();
    if (target.view === 'auth') {
        const params = new URLSearchParams(target.query || {});
        const query = params.toString();
        windowManager.navigate('/auth' + (query ? `?${query}` : ''));
        return;
    }
    windowManager.broadcast('desktop:navigate', target);
}

function handleUrl(raw) {
    const target = parseDeepLink(raw);
    if (!target) return false;
    navigate(target);
    return true;
}

function extractUrlFromArgv(argv) {
    if (!Array.isArray(argv)) return null;
    return argv.find(arg => typeof arg === 'string' && arg.startsWith('jan://')) || null;
}

module.exports = { parseDeepLink, handleUrl, navigate, extractUrlFromArgv };
