const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { URL } = require('url');
const templates = require('./templates');
const proxy = require('./proxy');
const wsProxy = require('./wsProxy');
const cookieJar = require('./cookieJar');
const settings = require('./settings');
const remote = require('./remote');
const { resolveRenderer, resolveModuleFile, resolveFromApp } = require('./paths');
const { PROXY_PATHS, WS_PROXY_PREFIXES } = require('./config');
const localesData = require('./localesData.json');

const STATIC_DIR = resolveRenderer('static');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
};

const ZXCVBN_UMD_FALLBACKS = {
    'core.js': path.join('@zxcvbn-ts', 'core', 'dist', 'zxcvbn-ts.js'),
    'language-common.js': path.join('@zxcvbn-ts', 'language-common', 'dist', 'zxcvbn-ts.js'),
    'language-en.js': path.join('@zxcvbn-ts', 'language-en', 'dist', 'zxcvbn-ts.js'),
};

const ZXCVBN_ESM_SHIM = `import { loadZxcvbnUmd } from '/static/js/desktop/zxcvbn-loader.js';
loadZxcvbnUmd().catch(() => { });
let instance = null;
function getInstance() {
    if (instance) return instance;
    const ns = typeof window !== 'undefined' ? window.zxcvbnts : null;
    if (!ns || !ns.core || !ns['language-en'] || !ns['language-common']) return null;
    instance = new ns.core.ZxcvbnFactory({
        translations: ns['language-en'].translations,
        graphs: ns['language-common'].adjacencyGraphs,
        dictionary: Object.assign({}, ns['language-common'].dictionary, ns['language-en'].dictionary),
    });
    return instance;
}
export function passphraseScore(passphrase) {
    try {
        const inst = getInstance();
        if (!inst) return 0;
        return inst.check(String(passphrase === undefined || passphrase === null ? '' : passphrase)).score;
    } catch (err) {
        return 0;
    }
}
export default { passphraseScore };
`;

let server = null;
let baseOrigin = null;
let eventSink = null;
let lastAppContext = null;
const upgradeSockets = new Set();

const CSP_BASE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' ws://127.0.0.1:* wss: https:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";
const CSP_APP = CSP_BASE.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");

const HTML_SECURITY_HEADERS = {
    'referrer-policy': 'strict-origin-when-cross-origin',
};

function send(res, status, body, headers = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    const merged = Object.assign({
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(payload.length),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
    }, headers);
    if (String(merged['content-type']).includes('text/html')) {
        Object.assign(merged, HTML_SECURITY_HEADERS);
        if (merged['x-csp']) {
            merged['content-security-policy'] = merged['x-csp'];
            delete merged['x-csp'];
        }
    }
    res.writeHead(status, merged);
    res.end(payload);
}

function sendJson(res, status, data) {
    send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8' });
}

function redirect(res, location, status = 302) {
    res.writeHead(status, { location, 'content-length': '0' });
    res.end();
}

function safeStaticPath(urlPath) {
    const rel = urlPath.replace(/^\/static\//, '');
    const decoded = decodeURIComponent(rel);
    const full = path.normalize(path.join(STATIC_DIR, decoded));
    if (!full.startsWith(STATIC_DIR + path.sep) && full !== STATIC_DIR) return null;
    return full;
}

function serveRangeAware(res, filePath, stat, contentType) {
    const range = res.req && res.req.headers ? res.req.headers.range : null;
    const headers = {
        'content-type': contentType,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
    };
    if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
        if (match) {
            let start = match[1] === '' ? NaN : parseInt(match[1], 10);
            let end = match[2] === '' ? NaN : parseInt(match[2], 10);
            if (Number.isNaN(start) && !Number.isNaN(end)) start = Math.max(0, stat.size - end);
            if (Number.isNaN(start)) start = 0;
            if (Number.isNaN(end) || end > stat.size - 1) end = stat.size - 1;
            if (start > end || start >= stat.size) {
                res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
                res.end();
                return;
            }
            headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
            headers['content-length'] = String(end - start + 1);
            res.writeHead(206, headers);
            if (res.req.method === 'HEAD') { res.end(); return; }
            fs.createReadStream(filePath, { start, end }).pipe(res);
            return;
        }
    }
    headers['content-length'] = String(stat.size);
    res.writeHead(200, headers);
    if (res.req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
}

async function serveStatic(res, urlPath) {
    const filePath = safeStaticPath(urlPath);
    if (!filePath) {
        send(res, 403, 'Forbidden');
        return true;
    }
    try {
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) throw new Error('not a file');
        serveRangeAware(res, filePath, stat, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        return true;
    } catch {
        return false;
    }
}

async function serveVendorFile(res, moduleRelPath, contentType) {
    try {
        const filePath = resolveModuleFile(...moduleRelPath.split(/[\\/]/));
        const stat = await fsp.stat(filePath);
        serveRangeAware(res, filePath, stat, contentType || MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        return true;
    } catch {
        send(res, 404, 'Not found');
        return false;
    }
}

async function gatherAppContext() {
    const me = await remote.getJson('/profile/me');
    if (me.status === 401 || me.status === 403) return { unauthorized: true };
    if (me.status !== 200 || !me.data || me.data.id === undefined) {
        return { error: true, status: me.status };
    }
    const user = me.data;

    const [sessionsRes, privacyRes, publicRes] = await Promise.all([
        remote.getJson('/profile/sessions').catch(() => null),
        remote.getJson('/api/privacy').catch(() => null),
        remote.getJson(`/profile/${encodeURIComponent(user.username)}`).catch(() => null),
    ]);

    const sessions = sessionsRes && sessionsRes.status === 200 && Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
    const privacy = privacyRes && privacyRes.status === 200 && privacyRes.data ? privacyRes.data : { last_seen: 'everyone', who_can_message: 'everyone' };
    const isAdmin = !!(publicRes && publicRes.status === 200 && publicRes.data && publicRes.data.is_admin);

    const LANGUAGES = localesData.LANGUAGES || {};
    const COUNTRIES = localesData.COUNTRIES || {};
    const langInfo = LANGUAGES[user.lang];
    const geoInfo = COUNTRIES[user.geo_code];
    const t = templates.makeTranslator();
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();

    let joinedDisplay = '';
    if (user.created_at) {
        const d = new Date(user.created_at);
        if (!Number.isNaN(d.getTime())) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            joinedDisplay = `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        }
    }

    return {
        unauthorized: false,
        user,
        active_sessions: sessions,
        privacy_settings: privacy,
        LANGUAGES,
        COUNTRIES,
        user_lang_code: user.lang || '',
        user_lang_name: langInfo ? langInfo.name : '',
        user_geo_code: user.geo_code || '',
        user_geo_name: geoInfo ? geoInfo.name : '',
        full_name: fullName || user.username,
        has_full_name: !!fullName,
        user_initial: String(user.username || '?').charAt(0).toUpperCase(),
        role_label_key: isAdmin ? 'admin_role' : 'user_role',
        joined_display: joinedDisplay,
    };
}

async function sessionIsValid() {
    try {
        const res = await remote.getJson('/profile/me');
        return res.status === 200 && !!res.data && res.data.id !== undefined;
    } catch {
        return false;
    }
}

async function handleAuthPage(req, res, url) {
    if (cookieJar.isAuthorized() && await sessionIsValid()) {
        redirect(res, '/app');
        return;
    }
    const mode = url.searchParams.get('mode') || 'login';
    const token = url.searchParams.get('token') || '';
    const html = await templates.renderAsync('auth.njk', { mode, token, resetError: false, cspMeta: CSP_BASE });
    send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'x-csp': CSP_BASE + "; frame-ancestors 'none'" });
}

async function handleAppPage(req, res, url) {
    if (!cookieJar.isAuthorized()) {
        redirect(res, '/auth');
        return;
    }
    let ctx;
    try {
        ctx = await gatherAppContext();
    } catch (err) {
        const message = String((err && err.message) || err);
        const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Jan Messenger</title>'
            + '<style>body{background:#12121f;color:#e0e0e0;font-family:Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{text-align:center}a{color:#7eb4ff}</style>'
            + '</head><body><main><h2>Server unavailable</h2><p>' + message + '</p><p><a href="/app">Retry</a></p></main></body></html>';
        send(res, 502, html, { 'content-type': 'text/html; charset=utf-8' });
        return;
    }
    if (ctx.unauthorized) {
        cookieJar.removeCookie('session');
        redirect(res, '/auth');
        return;
    }
    if (ctx.error) {
        send(res, 502, 'Failed to load profile data from server');
        return;
    }
    ctx.view = url.searchParams.get('view') || 'chat';
    ctx.invite = url.searchParams.get('invite') || '';
    ctx.query = url.search;
    ctx.has_geo = !!(ctx.user.geo_code && String(ctx.user.geo_code).trim());
    lastAppContext = ctx;
    ctx.cspMeta = CSP_APP;
    const html = await templates.renderAsync('app.njk', ctx);
    send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'x-csp': CSP_APP + "; frame-ancestors 'none'" });
}

function handleProfileData(req, res) {
    const ctx = lastAppContext;
    if (!ctx || !ctx.user) {
        send(res, 404, 'Not available');
        return;
    }
    const t = templates.makeTranslator();
    const payload = {
        LANGUAGES: ctx.LANGUAGES,
        COUNTRIES: ctx.COUNTRIES,
        ACTIVE_SESSIONS: ctx.active_sessions,
        I18N_SESSIONS: {
            current_session: t('current_session'),
            terminate: t('terminate'),
            terminate_all_confirm: t('terminate_all_confirm'),
            session_terminated: t('session_terminated'),
            last_active: t('last_active'),
            no_active_sessions: t('no_active_sessions'),
            just_now: t('just_now'),
            minutes_ago: t('minutes_ago'),
            hours_ago: t('hours_ago'),
            days_ago: t('days_ago'),
            yesterday: t('yesterday'),
            error: t('error'),
        },
        PROFILE_USER: ctx.user,
        ROLE_LABEL: t(ctx.role_label_key),
    };
    send(res, 200, `window.LANGUAGES = ${JSON.stringify(payload.LANGUAGES)};\nwindow.COUNTRIES = ${JSON.stringify(payload.COUNTRIES)};\nwindow.ACTIVE_SESSIONS = ${JSON.stringify(payload.ACTIVE_SESSIONS)};\nwindow.I18N_SESSIONS = ${JSON.stringify(payload.I18N_SESSIONS)};\nwindow.PROFILE_USER = ${JSON.stringify(payload.PROFILE_USER)};\nwindow.ROLE_LABEL = ${JSON.stringify(payload.ROLE_LABEL)};`, {
        'content-type': 'text/javascript; charset=utf-8',
    });
}

function handleAppData(req, res) {
    const pkg = require(resolveFromApp('package.json'));
    const payload = {
        version: pkg.version,
        productName: pkg.productName,
        serverUrl: remote.serverOrigin(),
        settings: settings.all(),
    };
    send(res, 200, `window.APP_DATA = ${JSON.stringify(payload)};`, {
        'content-type': 'text/javascript; charset=utf-8',
    });
}

function isProxiedPath(pathname) {
    return PROXY_PATHS.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
}

function isWsPath(pathname) {
    return WS_PROXY_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

async function handleStaticWithFallbacks(req, res, url) {
    const pathname = url.pathname;

    if (pathname.startsWith('/vendor/cropper/')) {
        const name = pathname.slice('/vendor/cropper/'.length);
        if (name === 'cropper.min.js') return serveVendorFile(res, 'cropperjs/dist/cropper.min.js', 'text/javascript; charset=utf-8');
        if (name === 'cropper.min.css') return serveVendorFile(res, 'cropperjs/dist/cropper.min.css', 'text/css; charset=utf-8');
        send(res, 404, 'Not found');
        return;
    }

    if (pathname.startsWith('/static/js/zxcvbn-umd/')) {
        const served = await serveStatic(res, pathname);
        if (served) return;
        const name = pathname.slice('/static/js/zxcvbn-umd/'.length);
        const rel = ZXCVBN_UMD_FALLBACKS[name];
        if (rel) {
            await serveVendorFile(res, rel, 'text/javascript; charset=utf-8');
            return;
        }
        send(res, 404, 'Not found');
        return;
    }

    if (pathname === '/static/js/zxcvbn/index.js') {
        const served = await serveStatic(res, pathname);
        if (served) return;
        send(res, 200, ZXCVBN_ESM_SHIM, { 'content-type': 'text/javascript; charset=utf-8' });
        return;
    }

    const served = await serveStatic(res, pathname);
    if (served) return;
    send(res, 404, 'Not found');
}

function createLocalServer(hooks) {
    eventSink = hooks || {};

    server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const pathname = url.pathname;

        try {
            if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE' && req.method !== 'HEAD' && req.method !== 'PATCH' && req.method !== 'OPTIONS') {
                send(res, 405, 'Method not allowed');
                return;
            }

            if (pathname === '/health') {
                sendJson(res, 200, { ok: true });
                return;
            }

            if (pathname === '/') {
                const loggedIn = cookieJar.isAuthorized() && await sessionIsValid();
                redirect(res, loggedIn ? '/app' + url.search : '/auth');
                return;
            }

            if (pathname === '/favicon.ico') {
                const served = await serveStatic(res, '/static/img/logo.png');
                if (!served) send(res, 404, '');
                return;
            }

            if (pathname === '/auth' || pathname === '/auth/') {
                await handleAuthPage(req, res, url);
                return;
            }

            if (pathname === '/app' || pathname === '/app/') {
                await handleAppPage(req, res, url);
                return;
            }

            if (pathname === '/desktop/app-data.js') {
                handleAppData(req, res);
                return;
            }

            if (pathname === '/desktop/profile-data.js') {
                handleProfileData(req, res);
                return;
            }

            if (pathname === '/i18n/translations.js') {
                templates.invalidate();
                await templates.buildDictionary(true);
                proxy.proxyRequest(req, res);
                return;
            }

            if (pathname === '/set-locale') {
                templates.invalidate();
                const requestedLang = url.searchParams.get('lang');
                proxy.proxyRequest(req, res);
                if (requestedLang && templates.SUPPORTED.includes(requestedLang)) {
                    res.on('finish', () => {
                        cookieJar.setCookie('locale', requestedLang);
                        templates.invalidate();
                    });
                }
                return;
            }

            if (pathname === '/chat' || pathname === '/chat/') {
                redirect(res, '/app' + (url.search || ''));
                return;
            }

            if (pathname === '/e2e' || pathname === '/e2e/') {
                redirect(res, '/app?view=e2e');
                return;
            }

            if (pathname === '/profile' || pathname === '/profile/') {
                redirect(res, '/app?view=settings');
                return;
            }

            if (pathname.startsWith('/static/') || pathname.startsWith('/vendor/')) {
                await handleStaticWithFallbacks(req, res, url);
                return;
            }

            if (isProxiedPath(pathname)) {
                proxy.proxyRequest(req, res);
                if (pathname === '/auth/logout') {
                    res.on('finish', () => {
                        if (!cookieJar.isAuthorized() && eventSink.onLoggedOut) eventSink.onLoggedOut();
                    });
                }
                if (pathname === '/auth/login' || pathname === '/auth/verify-email') {
                    res.on('finish', () => {
                        if (cookieJar.isAuthorized() && eventSink.onLoggedIn) eventSink.onLoggedIn();
                    });
                }
                return;
            }

            send(res, 404, 'Not found');
        } catch (err) {
            if (!res.headersSent) send(res, 500, 'Internal error');
            else try { res.end(); } catch { }
            if (eventSink.onError) eventSink.onError(err);
        }
    });

    server.on('upgrade', (req, socket, head) => {
        upgradeSockets.add(socket);
        socket.on('close', () => upgradeSockets.delete(socket));
        socket.on('error', () => upgradeSockets.delete(socket));
        const url = new URL(req.url, 'http://127.0.0.1');
        if (isWsPath(url.pathname)) {
            wsProxy.handleUpgrade(req, socket, head);
            return;
        }
        socket.destroy();
    });

    return server;
}

function start(hooks) {
    return new Promise((resolve, reject) => {
        const srv = createLocalServer(hooks);
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const address = srv.address();
            baseOrigin = `http://127.0.0.1:${address.port}`;
            resolve({ server: srv, origin: baseOrigin, port: address.port });
        });
    });
}

function stop() {
    return new Promise(resolve => {
        if (!server) { resolve(); return; }
        for (const socket of upgradeSockets) {
            try { socket.destroy(); } catch { }
        }
        upgradeSockets.clear();
        if (server.closeAllConnections) server.closeAllConnections();
        server.close(() => resolve());
        setTimeout(resolve, 1500);
    });
}

function origin() {
    return baseOrigin;
}

module.exports = { start, stop, origin, gatherAppContext };
