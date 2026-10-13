import { getCurrentUserId } from '../core_chat/store.js';

const userEl = document.getElementById('e2e-current-user');

export const STATE = {
    currentUserId: getCurrentUserId(),
    currentUser: {
        username: userEl?.dataset.username || '',
        firstName: userEl?.dataset.firstName || '',
        lastName: userEl?.dataset.lastName || '',
    },
    store: null,
    currentChatId: null,
    chats: [],
    messages: {},
    hasMoreByChat: {},
    oldestIdByChat: {},
    loadingOlder: false,
    loadingByChat: {},
    lastLoadedAt: {},
    chatWs: null,
    globalWs: null,
    replyTo: null,
    editTarget: null,
    pendingFiles: [],
    pendingSends: {},
    pendingSeq: 0,
    ctxTarget: null,
    fileBlobs: new Map(),
    notificationSound: null,
    notificationsInitialized: false,
    loadGeneration: 0,
};
