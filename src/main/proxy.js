const https = require('https');
const http = require('http');
const { URL } = require('url');
const { EventEmitter } = require('events');
const cookieJar = require('./cookieJar');
const settings = require('./settings');
const { HOP_BY_HOP_HEADERS, sanitizeServerUrl } = require('./config');

const events = new EventEmitter();

const STRIP_REQUEST_HEADERS = new Set([
    'host',
    'origin',
    'referer',
    'cookie',
    'accept-encoding',
    'connection',
    'content-length',
]);

const STRIP_RESPONSE_HEADERS = new Set([
    'set-cookie',
    'content-security-policy',
    'content-security-policy-report-only',
    'strict-transport-security',
]);

function serverOrigin() {
    return sanitizeServerUrl(settings.get('serverUrl'));
}

function buildUpstreamHeaders(req) {
    const headers = {};
    for (const key of Object.keys(req.headers)) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower) || STRIP_REQUEST_HEADERS.has(lower)) continue;
        headers[key] = req.headers[key];
    }
    const target = new URL(serverOrigin());
    headers.host = target.host;
    headers['accept-encoding'] = 'identity';
    const cookie = cookieJar.headerValue();
    if (cookie) headers.cookie = cookie;
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const length = req.headers['content-length'];
        if (length !== undefined) headers['content-length'] = length;
    }
    return headers;
}

function buildDownstreamHeaders(upstreamHeaders) {
    const headers = {};
    for (const key of Object.keys(upstreamHeaders)) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower) || STRIP_RESPONSE_HEADERS.has(lower)) continue;
        headers[key] = upstreamHeaders[key];
    }
    return headers;
}

function isHtmlRequest(req) {
    const accept = String(req.headers['accept'] || '');
    return accept.includes('text/html');
}

const AUTH_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/verify-email', '/auth/forgot-password', '/auth/reset-password', '/auth/resend-code'];

function maybeSignalUnauthorized(req, res, body) {
    if (res.statusCode !== 401) return;
    if (isHtmlRequest(req)) return;
    const pathname = String(req.url || '').split('?')[0];
    if (AUTH_ENDPOINTS.includes(pathname)) return;
    const text = body ? body.toString('utf8').slice(0, 400) : '';
    if (text.includes('Session expired') || text.includes('Not authenticated') || text.includes('Unauthorized')) {
        events.emit('unauthorized', { url: req.url });
    }
}

function proxyRequest(req, res) {
    const target = new URL(serverOrigin() + req.url);
    const lib = target.protocol === 'http:' ? http : https;
    const upstreamHeaders = buildUpstreamHeaders(req);

    const proxyReq = lib.request({
        method: req.method,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        headers: upstreamHeaders,
    }, upstreamRes => {
        cookieJar.absorbResponseHeaders(upstreamRes.headers);

        const contentType = String(upstreamRes.headers['content-type'] || '');
        const wantsJsonSniff = contentType.includes('application/json') && upstreamRes.statusCode === 401;
        let sniffed = null;
        if (wantsJsonSniff) sniffed = [];

        const downstreamHeaders = buildDownstreamHeaders(upstreamRes.headers);
        res.writeHead(upstreamRes.statusCode || 502, downstreamHeaders);

        upstreamRes.on('data', chunk => {
            if (sniffed && sniffed.length < 8) sniffed.push(chunk);
        });

        upstreamRes.on('end', () => {
            if (sniffed) maybeSignalUnauthorized(req, res, Buffer.concat(sniffed));
        });

        upstreamRes.pipe(res);
    });

    proxyReq.on('error', err => {
        if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'application/json' });
        }
        try {
            res.end(JSON.stringify({ detail: 'Upstream request failed', message: String(err && err.message || err) }));
        } catch {
            try { res.end(); } catch { }
        }
    });

    proxyReq.setTimeout(120000, () => {
        proxyReq.destroy(new Error('upstream timeout'));
    });

    req.pipe(proxyReq);
}

module.exports = { proxyRequest, events, serverOrigin };
