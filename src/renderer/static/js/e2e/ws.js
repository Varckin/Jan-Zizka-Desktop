import { STATE } from './state.js';
import { createManagedSocket, wsUrl } from '../core_chat/websocket.js';

const PONG_TIMEOUT_MS = 105000;

let chatSocket = null;
let globalSocket = null;
let currentChatId = null;
let currentCallback = null;
let globalOpenedOnce = false;

export function connectChatSocket(chatId, onMessage) {
    if (chatSocket) chatSocket.close();
    currentChatId = chatId;
    currentCallback = onMessage;

    chatSocket = createManagedSocket({
        url: wsUrl(`/e2e/ws/${chatId}`),
        logPrefix: 'E2E WS',
        pongTimeout: PONG_TIMEOUT_MS,
        onMessage: (data) => {
            if (typeof onMessage === 'function') onMessage(data);
        },
        onOpen: (raw) => {
            STATE.chatWs = raw;
            if (document.visibilityState === 'visible') sendWs({ type: 'mark_read' });
            if (typeof onMessage === 'function') {
                try {
                    onMessage({ type: '__ws_open__' });
                } catch { }
            }
        },
        onClose: () => {
            if (STATE.chatWs && STATE.chatWs.readyState === WebSocket.CLOSED) {
                STATE.chatWs = null;
            }
        },
        shouldReconnect: (event) => {
            if (event && event.code === 1008) return false;
            return STATE.currentChatId === chatId && !!currentCallback;
        },
    });

    const connecting = chatSocket.connect();
    STATE.chatWs = chatSocket.raw;
    return connecting;
}

export function closeChatSocket() {
    currentChatId = null;
    currentCallback = null;
    if (chatSocket) {
        chatSocket.close();
        chatSocket = null;
    }
    STATE.chatWs = null;
}

export function sendWs(payload) {
    if (chatSocket) chatSocket.send(payload);
}

export function connectGlobalSocket(onMessage) {
    if (globalSocket) globalSocket.close();
    globalOpenedOnce = false;

    globalSocket = createManagedSocket({
        url: wsUrl('/e2e/ws/global'),
        logPrefix: 'E2E global WS',
        pongTimeout: PONG_TIMEOUT_MS,
        onMessage: (data) => {
            if (typeof onMessage === 'function') onMessage(data);
        },
        onOpen: (raw) => {
            STATE.globalWs = raw;
            if (!globalOpenedOnce) {
                globalOpenedOnce = true;
                return;
            }
            if (typeof onMessage === 'function') {
                try {
                    onMessage({ type: '__ws_open__' });
                } catch { }
            }
        },
        shouldReconnect: (event) => !(event && event.code === 1008),
    });

    globalSocket.connect();
    STATE.globalWs = globalSocket.raw;
    return globalSocket.raw;
}

export function closeGlobalSocket() {
    if (!globalSocket) return;
    globalSocket.close();
    globalSocket = null;
    globalOpenedOnce = false;
    STATE.globalWs = null;
}
