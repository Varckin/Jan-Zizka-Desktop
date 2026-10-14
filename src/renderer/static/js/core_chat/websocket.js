import { isWindowActive, onWindowActiveChange } from './windowActivity.js';

const RESUME_PROBE_GRACE_MS = 10000;

export function wsUrl(path) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${path}`;
}

export function createManagedSocket(options) {
    const {
        url,
        onMessage,
        onOpen,
        onClose,
        pingInterval = 30000,
        pongTimeout = 0,
        pingOnlyWhenActive = false,
        reconnectDelay = 3000,
        openTimeout = 5000,
        shouldReconnect = () => true,
        logPrefix = 'WS',
    } = options;

    let ws = null;
    let manualClose = false;
    let pingTimer = null;
    let reconnectTimer = null;
    let settleFn = null;
    let lastPongAt = 0;
    let visibilityHandler = null;
    let detachActivity = null;

    function settle(value) {
        if (settleFn) {
            const resolve = settleFn;
            settleFn = null;
            resolve(value);
        }
    }

    function clearPing() {
        if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
        }
    }

    function clearVisibility() {
        if (visibilityHandler) {
            document.removeEventListener('visibilitychange', visibilityHandler);
            visibilityHandler = null;
        }
        if (detachActivity) {
            try { detachActivity(); } catch { }
            detachActivity = null;
        }
    }

    function pingsAllowed() {
        return !pingOnlyWhenActive || isWindowActive();
    }

    function socketIsStale() {
        if (pongTimeout <= 0 || lastPongAt <= 0) return false;
        if (!pingsAllowed()) return false;
        return Date.now() - lastPongAt > pongTimeout;
    }

    function sendPing(socket) {
        try {
            socket.send(JSON.stringify({ type: 'ping' }));
        } catch { }
    }

    function handleActivityResumed() {
        const socket = ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        if (pongTimeout > 0) {
            lastPongAt = Date.now() - Math.max(0, pongTimeout - RESUME_PROBE_GRACE_MS);
        }
        sendPing(socket);
    }

    function attachVisibility() {
        if (pingOnlyWhenActive) {
            if (pingInterval <= 0 || detachActivity) return;
            detachActivity = onWindowActiveChange(resumed => {
                if (resumed) handleActivityResumed();
            });
            return;
        }
        if (pongTimeout <= 0 || visibilityHandler) return;
        visibilityHandler = () => {
            if (document.visibilityState !== 'visible') return;
            const socket = ws;
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            if (socketIsStale()) {
                try { socket.close(); } catch { }
                return;
            }
            lastPongAt = Date.now();
            try {
                socket.send(JSON.stringify({ type: 'ping' }));
            } catch { }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
    }

    function connect() {
        return new Promise(resolve => {
            manualClose = false;
            let settled = false;
            let timeoutId = null;
            settleFn = (value) => {
                if (settled) return;
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                resolve(value);
            };

            const socket = new WebSocket(url);
            ws = socket;

            if (openTimeout > 0) {
                timeoutId = setTimeout(() => {
                    console.warn(`${logPrefix} connect timeout`, url);
                    try { socket.close(); } catch { }
                    settle(null);
                }, openTimeout);
            }

            socket.onopen = () => {
                manualClose = false;
                lastPongAt = Date.now();
                clearPing();
                if (pingInterval > 0) {
                    pingTimer = setInterval(() => {
                        if (socket.readyState !== WebSocket.OPEN) return;
                        if (socketIsStale()) {
                            console.warn(`${logPrefix} pong timeout, forcing reconnect`, url);
                            try { socket.close(); } catch { }
                            return;
                        }
                        if (!pingsAllowed()) return;
                        sendPing(socket);
                    }, pingInterval);
                }
                attachVisibility();
                try {
                    if (onOpen) onOpen(socket);
                } catch (err) {
                    console.error(`${logPrefix} onOpen error:`, err);
                }
                settle(socket);
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data && data.type === 'pong') {
                        lastPongAt = Date.now();
                        return;
                    }
                    if (onMessage) onMessage(data);
                } catch (err) {
                    console.error(`${logPrefix} parse error:`, err);
                }
            };

            socket.onclose = (event) => {
                clearPing();
                settle(null);
                try {
                    if (onClose) onClose(event);
                } catch (err) {
                    console.error(`${logPrefix} onClose error:`, err);
                }
                if (manualClose) {
                    clearVisibility();
                    ws = null;
                    return;
                }
                let reconnect = true;
                try {
                    reconnect = shouldReconnect(event);
                } catch {
                    reconnect = false;
                }
                if (!reconnect) {
                    clearVisibility();
                    ws = null;
                    return;
                }
                if (reconnectTimer) clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    connect();
                }, reconnectDelay);
            };

            socket.onerror = () => settle(null);
        });
    }

    function send(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
            return true;
        }
        return false;
    }

    function close() {
        return new Promise(resolve => {
            manualClose = true;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            clearPing();
            clearVisibility();
            if (!ws) {
                resolve();
                return;
            }
            const socket = ws;
            if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
                ws = null;
                resolve();
                return;
            }
            socket.onclose = () => {
                ws = null;
                resolve();
            };
            try {
                socket.close();
            } catch {
                ws = null;
                resolve();
            }
        });
    }

    function isOpen() {
        return !!ws && ws.readyState === WebSocket.OPEN;
    }

    return {
        connect,
        send,
        close,
        isOpen,
        get raw() { return ws; },
    };
}

export function isNormalClosure(event) {
    return event && (event.code === 1000 || event.code === 1001 || event.code === 1008);
}
