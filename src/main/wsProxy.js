const { WebSocketServer, WebSocket } = require('ws');
const cookieJar = require('./cookieJar');
const settings = require('./settings');

const wss = new WebSocketServer({ noServer: true });

function upstreamBase() {
    const raw = String(settings.get('serverUrl') || 'https://chat.varckin.xyz').replace(/\/+$/, '');
    return raw.replace(/^http/, 'ws');
}

function buildUpstreamHeaders(req) {
    const headers = {};
    const cookie = cookieJar.headerValue();
    if (cookie) headers.Cookie = cookie;
    headers['User-Agent'] = 'JanDesktop/1.0';
    headers['Accept-Language'] = req.headers['accept-language'] || 'en-US,en;q=0.9';
    const proto = req.headers['sec-websocket-protocol'];
    if (proto) headers['Sec-WebSocket-Protocol'] = proto;
    return headers;
}

function handleUpgrade(req, socket, head) {
    if (!cookieJar.isAuthorized()) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }
    const url = upstreamBase() + req.url;
    const upstream = new WebSocket(url, {
        headers: buildUpstreamHeaders(req),
        perMessageDeflate: false,
        handshakeTimeout: 15000,
        maxPayload: 16 * 1024 * 1024,
    });

    let client = null;
    let closed = false;

    const closePair = (code, reason) => {
        if (closed) return;
        closed = true;
        try { if (client && client.readyState !== WebSocket.CLOSED) client.close(code, reason); } catch { }
        try { if (upstream.readyState !== WebSocket.CLOSED) upstream.close(code, reason); } catch { }
    };

    upstream.on('open', () => {
        wss.handleUpgrade(req, socket, head, ws => {
            client = ws;

            client.on('message', (data, isBinary) => {
                if (upstream.readyState === WebSocket.OPEN) {
                    try { upstream.send(data, { binary: isBinary }); } catch { }
                }
            });
            client.on('close', (code, reason) => closePair(code, reason));
            client.on('error', () => closePair(1011, 'client error'));
        });
    });

    upstream.on('message', (data, isBinary) => {
        if (client && client.readyState === WebSocket.OPEN) {
            try { client.send(data, { binary: isBinary }); } catch { }
        }
    });

    upstream.on('close', (code, reason) => {
        if (!client) {
            socket.destroy();
            return;
        }
        try { client.close(code >= 1000 && code <= 4999 ? code : 1006, reason); } catch { }
    });

    upstream.on('error', () => {
        if (!client) {
            try {
                socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            } catch { }
            socket.destroy();
            return;
        }
        closePair(1011, 'upstream error');
    });

    socket.on('error', () => closePair(1006, 'socket error'));
    socket.on('close', () => closePair(1001, 'socket closed'));
}

module.exports = { handleUpgrade };
