import { createEmitter, getCurrentUserId } from '../core_chat/store.js';

export const STATE = {
    currentChatId: null,
    currentUserId: getCurrentUserId(),
    mySignature: null,
    replyTo: null,
    isLoading: false,
    offset: 0,
    limit: 30,
    hasMore: true,
    typingTimeout: null,
    typingUsers: {},
    selectedFiles: [],
    pendingSends: {},
    pendingSeq: 0,
    settingsChatId: null,
    chatsMap: {},
    currentPermissions: {},
    currentChatType: null,
    unreadCounts: {},
    folders: [],
    activeFolderId: null,
    notificationSound: null,
    globalWs: null,
    globalWsConnected: false,
    mediaRecorder: null,
    recordedChunks: [],
    isRecording: false,
    recordingTimer: null,
    recordingSeconds: 0,
    cancelRecording: false,
    openDropdown: null,
    contacts: [],
    contactsLoaded: false,
    mentionMembers: {},
    _justReadIds: new Map(),
    _typingTimers: {},
};

const emitter = createEmitter();

export function hasPermission(name) {
    return !!(STATE.currentPermissions && STATE.currentPermissions[name]);
}

export const on = emitter.on;
export const once = emitter.once;
export const off = emitter.off;
export const emit = emitter.emit;
