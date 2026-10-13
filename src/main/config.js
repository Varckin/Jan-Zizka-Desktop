const DEFAULT_SERVER_URL = 'https://chat.varckin.xyz';

const PROXY_PATHS = [
    '/auth',
    '/chat',
    '/e2e',
    '/profile',
    '/contacts',
    '/api',
    '/media',
    '/set-locale',
    '/i18n',
    '/voice',
    '/admin',
];

const WS_PROXY_PREFIXES = [
    '/chat/ws/',
    '/e2e/ws/',
    '/voice/ws/',
];

const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

const APP_PROTOCOL = 'jan';

const UPDATE_OWNER = 'varckin';
const UPDATE_REPO = 'jan-messenger-desktop';

const VIEW_NAMES = ['chat', 'e2e', 'settings'];

function sanitizeServerUrl(value) {
    let raw = String(value || DEFAULT_SERVER_URL).replace(/\/+$/, '');
    try {
        const parsed = new URL(raw);
        const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';
        if (parsed.protocol === 'http:' && !loopback) {
            parsed.protocol = 'https:';
            raw = parsed.toString().replace(/\/+$/, '');
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            raw = DEFAULT_SERVER_URL;
        }
    } catch {
        raw = DEFAULT_SERVER_URL;
    }
    return raw;
}

module.exports = {
    sanitizeServerUrl,
    UPDATE_OWNER,
    UPDATE_REPO,
    DEFAULT_SERVER_URL,
    PROXY_PATHS,
    WS_PROXY_PREFIXES,
    HOP_BY_HOP_HEADERS,
    APP_PROTOCOL,
    VIEW_NAMES,
};
