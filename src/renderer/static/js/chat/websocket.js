import { STATE } from './state.js';
import { DOM } from './dom.js';
import { createManagedSocket, wsUrl } from '../core_chat/websocket.js';

let chatSocket = null;
let globalSocket = null;
let currentChatId = null;
let currentOnMessageCallback = null;

function lastRenderedMessageId() {
    if (!DOM.messagesContainer) return 0;
    let max = 0;
    DOM.messagesContainer.querySelectorAll('.message[data-msg-id]').forEach(el => {
        const id = parseInt(el.dataset.msgId, 10);
        if (Number.isFinite(id) && id > max) max = id;
    });
    return max;
}

export async function connectWebSocket(chatId, onMessageCallback) {
    if (chatSocket) await chatSocket.close();
    currentChatId = chatId;
    currentOnMessageCallback = onMessageCallback;

    chatSocket = createManagedSocket({
        url: wsUrl(`/chat/ws/${chatId}`),
        logPrefix: 'ChatWS',
        pingOnlyWhenActive: true,
        onMessage: (data) => {
            if (currentOnMessageCallback) currentOnMessageCallback(data);
        },
        onOpen: () => {
            if (STATE.currentChatId === chatId) {
                chatSocket.send({ type: 'mark_read', last_seen_id: lastRenderedMessageId() });
            }
        },
        shouldReconnect: (event) => {
            if (event && event.code === 1008) return false;
            return !!(currentChatId && currentOnMessageCallback);
        },
    });

    return chatSocket.connect();
}

export async function closeWs() {
    if (!chatSocket) return;
    const socket = chatSocket;
    chatSocket = null;
    await socket.close();
}

export function sendWsMessage(data) {
    if (chatSocket) chatSocket.send(data);
}

export function connectGlobalWebSocket(onMessageCallback) {
    if (globalSocket) globalSocket.close();

    globalSocket = createManagedSocket({
        url: wsUrl('/chat/ws/global'),
        logPrefix: 'GlobalWS',
        pingOnlyWhenActive: true,
        onMessage: (data) => {
            if (onMessageCallback) onMessageCallback(data);
        },
        onOpen: (raw) => {
            STATE.globalWsConnected = true;
            STATE.globalWs = raw;
        },
        onClose: () => {
            STATE.globalWsConnected = false;
        },
        shouldReconnect: (event) => !(event && event.code === 1008),
    });

    globalSocket.connect();
    STATE.globalWs = globalSocket;
    return globalSocket;
}

export function closeGlobalWs() {
    if (!globalSocket) return;
    globalSocket.close();
    globalSocket = null;
    STATE.globalWs = null;
    STATE.globalWsConnected = false;
}

export function isWsOpen() {
    return !!chatSocket && chatSocket.isOpen();
}
