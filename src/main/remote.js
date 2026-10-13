const https = require('https');
const http = require('http');
const { URL } = require('url');
const cookieJar = require('./cookieJar');
const settings = require('./settings');
const { sanitizeServerUrl } = require('./config');

const SUPPORTED_LOCALES = ['en', 'ru', 'es', 'de'];

function acceptLanguageHeader() {
    const forced = settings.get('locale');
    let primary = '';
    if (forced && SUPPORTED_LOCALES.includes(forced)) primary = forced;
    else {
        try {
            const { app } = require('electron');
            const candidate = String(app.getLocale() || '').split('-')[0].toLowerCase();
            if (SUPPORTED_LOCALES.includes(candidate)) primary = candidate;
        } catch {
        }
    }
    if (!primary || primary === 'en') return 'en-US,en;q=0.9';
    return `${primary},${primary}-`;
}

function serverOrigin() {
    return sanitizeServerUrl(settings.get('serverUrl'));
}

function targetUrl(pathname, query) {
    const origin = serverOrigin();
    const suffix = query ? `?${query}` : '';
    return new URL(`${origin}${pathname}${suffix}`);
}

function transport(url) {
    return url.protocol === 'http:' ? http : https;
}

function buildHeaders(method, extraHeaders) {
    const headers = Object.assign({
        'accept': 'application/json, text/plain, */*',
        'accept-language': acceptLanguageHeader(),
        'user-agent': 'JanDesktop/1.0',
    }, extraHeaders || {});
    const cookie = cookieJar.headerValue();
    if (cookie) headers.cookie = cookie;
    headers['x-requested-with'] = 'JanDesktop';
    return headers;
}

function requestJson(method, pathname, options = {}) {
    return new Promise((resolve, reject) => {
        const url = targetUrl(pathname, options.query);
        const payload = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body), 'utf8');
        const headers = buildHeaders(method, options.headers);
        if (payload) {
            headers['content-type'] = 'application/json';
            headers['content-length'] = String(payload.length);
        }
        const req = transport(url).request({
            method,
            hostname: url.hostname,
            port: url.port || (url.protocol === 'http:' ? 80 : 443),
            path: `${url.pathname}${url.search}`,
            headers,
            timeout: options.timeout || 20000,
        }, res => {
            cookieJar.absorbResponseHeaders(res.headers);
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let data = null;
                try {
                    data = text ? JSON.parse(text) : null;
                } catch {
                    data = text;
                }
                resolve({ status: res.statusCode, headers: res.headers, data, text });
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function getJson(pathname, options) {
    return requestJson('GET', pathname, options);
}

function requestText(method, pathname, options = {}) {
    return requestJson(method, pathname, options);
}

module.exports = { serverOrigin, targetUrl, getJson, requestJson, requestText, buildHeaders };
