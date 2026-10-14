import { STATE } from './state.js';
import { DOM, i18n } from './dom.js';
import { formatRelativeTime, formatTypingText, isServiceChat, appendVerifiedBadge } from './format.js';
import * as API from './api.js';
import { createChatItem, updateMentionBadge, syncLastMessageMeta, updateChatItemLastMessage } from './ui/chatItem.js';
import { updateChatOnlineStatus, updateChatUI, renderGroupMembersCount, refreshGroupMembersCount } from './ui/onlineStatus.js';
import { chatDisplayName } from './contacts.js';
import { showNotification } from './dialogs.js';
import { loadMessages, handleWsMessage, abortPendingLoads } from './chatMessages.js';
import { connectWebSocket } from './websocket.js';
import { isChatMuted } from './muteModal.js';
import { isChatPinned } from './pinChat.js';
import { filterChatsForFolderView, getActiveFolder, folderChatOrder, isChatInActiveFolder, refreshFolderBadges } from './folders.js';
import { refreshPinnedBar, hidePinnedBar, updatePinnedBarControls } from './ui/pinnedBar.js';
import { resyncVoiceCall } from './voice_call/ui.js';
import { refreshGroupVoiceBar } from './group_voice/ui.js';

let hasRenderedChats = false;
let _loadChatsSeq = 0;
const JUST_READ_TTL = 5000;

export function markChatRead(chatId) {
    if (!chatId) return;
    const hadUnread = (STATE.unreadCounts[chatId] || 0) > 0;
    STATE.unreadCounts[chatId] = 0;
    STATE._justReadIds.set(chatId, Date.now() + JUST_READ_TTL);
    updateMentionBadge(chatId, false);
    if (hadUnread) {
        updateChatBadge(chatId);
        updateDocumentTitle();
    }
}

export function renderChatHeaderName(chat, fallbackName) {
    const name = (chat && chatDisplayName(chat)) || fallbackName || '';
    DOM.chatNameSpan.textContent = name;
    appendVerifiedBadge(DOM.chatNameSpan, chat);
}

export async function loadChats(silent = false, query = '') {
    const mySeq = ++_loadChatsSeq;
    updateBlockedButton();
    try {
        const chats = await API.fetchChats(query);

        if (mySeq !== _loadChatsSeq) return;

        if (query) {
            const q = query.trim().toLowerCase();
            const nickIds = new Set(
                STATE.contacts
                    .filter(c => c.nickname && c.nickname.toLowerCase().includes(q))
                    .map(c => c.user_id)
            );
            if (nickIds.size) {
                const known = new Set(chats.map(c => c.id));
                for (const prev of Object.values(STATE.chatsMap)) {
                    if (prev.type === 'direct' && nickIds.has(prev.other_user_id) && !known.has(prev.id)) {
                        chats.push(prev);
                        known.add(prev.id);
                    }
                }
            }
        }

        chats.sort((a, b) => (new Date(b.last_message_time || 0)) - (new Date(a.last_message_time || 0)));
        chats.sort((a, b) => {
            const pinDiff = (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0);
            if (pinDiff !== 0) return pinDiff;
            if (a.is_pinned) return (new Date(b.pinned_at || 0)) - (new Date(a.pinned_at || 0));
            return 0;
        });
        const currentId = STATE.currentChatId;

        STATE.chatsMap = {};
        const now = Date.now();
        for (const chat of chats) {
            STATE.chatsMap[chat.id] = chat;
            const serverCount = chat.unread_count || 0;
            const localCount = STATE.unreadCounts[chat.id] || 0;
            const justReadUntil = STATE._justReadIds.get(chat.id);
            if (justReadUntil && justReadUntil > now) {
                STATE.unreadCounts[chat.id] = localCount;
            } else {
                if (justReadUntil) STATE._justReadIds.delete(chat.id);
                STATE.unreadCounts[chat.id] = Math.max(serverCount, localCount);
            }
        }
        for (const id of Object.keys(STATE.unreadCounts)) {
            if (!STATE.chatsMap[id]) {
                delete STATE.unreadCounts[id];
                STATE._justReadIds.delete(id);
            }
        }

        const visibleChats = filterChatsForFolderView(chats);
        const inFolderView = !!getActiveFolder();
        const savedScrollTop = DOM.chatList.scrollTop;
        DOM.chatList.innerHTML = '';
        if (visibleChats.length === 0) {
            const emptyText = (inFolderView && !query)
                ? (i18n.folders_empty || 'No chats in this folder yet')
                : (i18n.no_chats || 'No chats yet');
            DOM.chatList.innerHTML = `<div class="empty-state">${emptyText}</div>`;
            if (!silent) resetEmptyState();
            return;
        }
        const animate = !hasRenderedChats;
        visibleChats.forEach((chat, index) => {
            const item = createChatItem(chat);
            if (animate) {
                item.classList.add('chat-item--enter');
                item.style.animationDelay = `${Math.min(index * 20, 220)}ms`;
                item.addEventListener('animationend', () => {
                    item.classList.remove('chat-item--enter');
                    item.style.animationDelay = '';
                }, { once: true });
            }
            item.addEventListener('click', () => selectChat(chat.id, chat.name));
            DOM.chatList.appendChild(item);
        });
        DOM.chatList.scrollTop = savedScrollTop;
        hasRenderedChats = true;
        if (currentId && STATE.chatsMap[currentId]) {
            const activeItem = document.querySelector(`.chat-item[data-chat-id="${currentId}"]`);
            if (activeItem) activeItem.classList.add('active');
            if (!silent) {
                const chatData = STATE.chatsMap[currentId];
                renderChatHeaderName(chatData, chatData.name);
                if (!DOM.messagesContainer.querySelector('.message') && !DOM.messagesContainer.querySelector('.loading')) {
                    loadMessages(currentId, true);
                }
                if (isServiceChat(chatData)) DOM.inputArea.classList.add('is-hidden');
                else DOM.inputArea.classList.remove('is-hidden');
                updateChatOnlineStatus(currentId, chatData.type === 'direct' && chatData.other_user_online);
            } else {
                renderGroupMembersCount(currentId);
            }
        } else if (!silent) {
            resetEmptyState();
        } else {
            document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
        }
        if (STATE.currentChatId && STATE.typingUsers[STATE.currentChatId] && Object.keys(STATE.typingUsers[STATE.currentChatId]).length > 0) {
            updateChatTypingIndicator(STATE.currentChatId);
        }
        updateDocumentTitle();
    } catch (err) {
        console.error('Failed to load chats:', err);
        if (!silent && mySeq === _loadChatsSeq) {
            showNotification((i18n.failed_load_chats || 'Failed to load chats') + ': ' + err.message);
        }
    }
}

export function findFirstUnpinnedItem() {
    if (!DOM.chatList) return null;
    const items = DOM.chatList.querySelectorAll('.chat-item');
    for (const el of items) {
        const chat = STATE.chatsMap[parseInt(el.dataset.chatId, 10)];
        if (!isChatPinned(chat)) return el;
    }
    return null;
}

export function moveChatItemToTop(chatId) {
    if (getActiveFolder()) return;
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!item || !DOM.chatList) return;
    if (isChatPinned(STATE.chatsMap[chatId])) return;
    const firstUnpinned = findFirstUnpinnedItem();
    if (!firstUnpinned) {
        DOM.chatList.appendChild(item);
        return;
    }
    if (firstUnpinned !== item) DOM.chatList.insertBefore(item, firstUnpinned);
}

export function reorderChatItems() {
    if (!DOM.chatList) return;
    const items = Array.from(DOM.chatList.querySelectorAll('.chat-item'));
    if (items.length < 2) return;
    const activeFolder = getActiveFolder();
    if (activeFolder) {
        const order = folderChatOrder(activeFolder);
        const indexOf = (item) => {
            const idx = order.indexOf(parseInt(item.dataset.chatId, 10));
            return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
        };
        items.sort((a, b) => indexOf(a) - indexOf(b));
        const folderFragment = document.createDocumentFragment();
        items.forEach(el => folderFragment.appendChild(el));
        DOM.chatList.appendChild(folderFragment);
        return;
    }
    const rank = (item) => {
        const chat = STATE.chatsMap[parseInt(item.dataset.chatId, 10)];
        return {
            pin: isChatPinned(chat) ? 0 : 1,
            pinnedTs: isChatPinned(chat) ? (new Date(chat.pinned_at || 0)).getTime() : 0,
            ts: chat ? (new Date(chat.last_message_time || 0)).getTime() : 0,
        };
    };
    items.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra.pin !== rb.pin) return ra.pin - rb.pin;
        if (ra.pin === 0 && ra.pinnedTs !== rb.pinnedTs) return rb.pinnedTs - ra.pinnedTs;
        return rb.ts - ra.ts;
    });
    const fragment = document.createDocumentFragment();
    items.forEach(el => fragment.appendChild(el));
    DOM.chatList.appendChild(fragment);
}

export function addChatToList(chat) {
    if (!chat) return false;
    if (STATE.chatsMap[chat.id]) return true;

    STATE.chatsMap[chat.id] = chat;
    const justReadUntil = STATE._justReadIds.get(chat.id);
    const now = Date.now();
    if (justReadUntil && justReadUntil > now) {
        STATE.unreadCounts[chat.id] = STATE.unreadCounts[chat.id] || 0;
    } else {
        const serverCount = chat.unread_count || 0;
        const localCount = STATE.unreadCounts[chat.id] || 0;
        STATE.unreadCounts[chat.id] = Math.max(serverCount, localCount);
    }

    const searchQuery = (DOM.chatSearch && DOM.chatSearch.value || '').trim();
    if (searchQuery) return true;
    if (getActiveFolder() && !isChatInActiveFolder(chat.id)) return true;

    const emptyState = DOM.chatList.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const item = createChatItem(chat);
    item.classList.add('chat-item--enter');
    item.addEventListener('animationend', () => {
        item.classList.remove('chat-item--enter');
    }, { once: true });
    item.addEventListener('click', () => selectChat(chat.id, chat.name));
    if (getActiveFolder()) {
        DOM.chatList.appendChild(item);
        reorderChatItems();
    } else if (isChatPinned(chat)) {
        DOM.chatList.prepend(item);
    } else {
        const firstUnpinned = findFirstUnpinnedItem();
        if (firstUnpinned) DOM.chatList.insertBefore(item, firstUnpinned);
        else DOM.chatList.appendChild(item);
    }
    return true;
}

function resetEmptyState() {
    STATE.currentChatId = null;
    hidePinnedBar();
    DOM.chatNameSpan.textContent = i18n.select_chat || 'Select a chat';
    DOM.messagesContainer.innerHTML = `<div class="empty-state">${i18n.select_chat_prompt || 'Select a chat to start messaging'}</div>`;
    DOM.inputArea.classList.add('is-hidden');
    updateChatUI(null, null);
    STATE.typingUsers = {};
    document.querySelectorAll('.typing-indicator').forEach(el => el.remove());
    document.querySelectorAll('.chat-item .last-msg, .chat-item .last-msg-checks').forEach(el => el.classList.remove('is-hidden'));
    DOM.chatTyping.classList.add('is-hidden');
    DOM.chatTyping.textContent = '';
    updateChatOnlineStatus(null, false);
}

export async function selectChat(chatId, chatName) {
    if (STATE.currentChatId === chatId) {
        if (window.innerWidth <= 768) {
            DOM.chatSidebar.classList.add('hidden');
            DOM.chatMain.classList.remove('hidden');
            DOM.chatMain.classList.add('show-chat');
        }
        return;
    }
    const oldChatId = STATE.currentChatId;
    if (oldChatId) clearTypingState(oldChatId);
    clearTypingState(chatId);
    abortPendingLoads();
    STATE.isLoading = false;
    STATE.currentChatId = chatId;
    STATE.currentPermissions = {};
    STATE.offset = 0;
    STATE.hasMore = true;
    const chatData = STATE.chatsMap[chatId];
    STATE.currentChatType = chatData ? chatData.type : null;
    renderChatHeaderName(chatData, chatName);
    if (isServiceChat(chatData)) DOM.inputArea.classList.add('is-hidden');
    else DOM.inputArea.classList.remove('is-hidden');
    DOM.messagesContainer.innerHTML = `<div class="loading">${i18n.loading_messages || 'Loading messages...'}</div>`;
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (activeItem) activeItem.classList.add('active');
    if (window.innerWidth <= 768) {
        DOM.chatSidebar.classList.add('hidden');
        DOM.chatMain.classList.remove('hidden');
        DOM.chatMain.classList.add('show-chat');
    }
    DOM.chatTyping.classList.add('is-hidden');
    DOM.chatTyping.textContent = '';
    connectWebSocket(chatId, handleWsMessage).catch(err => console.error('WebSocket connection failed:', err));
    markChatRead(chatId);
    refreshPinnedBar(chatId);
    try { await loadMessages(chatId, true); } catch (err) { console.error('Failed to load messages:', err); }
    STATE.replyTo = null;
    DOM.replyIndicator.classList.add('is-hidden');
    STATE.selectedFiles = [];
    DOM.fileInput.value = '';
    DOM.filePreviewContainer.classList.add('is-hidden');
    DOM.filePreviewContainer.innerHTML = '';
    updateChatActions(chatId);
    updateChatOnlineStatus(chatId, chatData && chatData.type === 'direct' && chatData.other_user_online);
    refreshGroupMembersCount(chatId);
    resyncVoiceCall(chatId);
    refreshGroupVoiceBar(chatId);
}

function clearTypingState(chatId) {
    if (STATE.typingUsers[chatId]) delete STATE.typingUsers[chatId];
    if (STATE._typingTimers && STATE._typingTimers[chatId]) {
        Object.values(STATE._typingTimers[chatId]).forEach(t => clearTimeout(t));
        delete STATE._typingTimers[chatId];
    }
    updateChatTypingIndicator(chatId);
}

export function updateChatBadge(chatId) {
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (item) {
        const muted = isChatMuted(STATE.chatsMap[chatId]);
        const badge = item.querySelector('.badge');
        const count = STATE.unreadCounts[chatId] || 0;
        if (count > 0) {
            if (badge) badge.textContent = count;
            else {
                const nb = document.createElement('span');
                nb.className = 'badge';
                nb.textContent = count;
                item.appendChild(nb);
            }
            item.querySelector('.badge').classList.toggle('muted', muted);
        } else if (badge) {
            badge.remove();
        }
    }
    refreshFolderBadges();
}

export function updateDocumentTitle() {
    let total = 0;
    for (const id of Object.keys(STATE.unreadCounts)) {
        if (isChatMuted(STATE.chatsMap[id])) continue;
        total += STATE.unreadCounts[id] || 0;
    }
    const siteTitle = (window.i18n && window.i18n.site_title) || 'Jan Messenger';
    document.title = total > 0 ? `(${total}) ${siteTitle}` : siteTitle;
}

export function updateChatItemTime(chatId) {
    const chatData = STATE.chatsMap[chatId];
    if (!chatData) return;
    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!chatItem) return;
    const timeEl = chatItem.querySelector('.time');
    if (!timeEl) return;
    timeEl.textContent = chatData.last_message_time ? formatRelativeTime(chatData.last_message_time) : '';
}

export function updateChatTypingIndicator(chatId) {
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!item) return;
    const lastMsgEl = item.querySelector('.last-msg');
    const timeEl = item.querySelector('.time');
    const checksEl = item.querySelector('.last-msg-checks');
    const typingUsers = STATE.typingUsers[chatId] || {};
    const typingCount = Object.keys(typingUsers).length;
    const chatData = STATE.chatsMap[chatId];
    const isGroup = chatData && chatData.type === 'group';
    if (typingCount > 0) {
        const text = formatTypingText(typingUsers, isGroup);
        let indicator = item.querySelector('.typing-indicator');
        if (!indicator) {
            indicator = document.createElement('span');
            indicator.className = 'typing-indicator';
            lastMsgEl.parentNode.appendChild(indicator);
        }
        indicator.textContent = text;
        if (lastMsgEl) lastMsgEl.classList.add('is-hidden');
        if (checksEl) checksEl.classList.add('is-hidden');
        if (timeEl) timeEl.classList.add('is-hidden');
    } else {
        const indicator = item.querySelector('.typing-indicator');
        if (indicator) indicator.remove();
        if (lastMsgEl) lastMsgEl.classList.remove('is-hidden');
        if (checksEl) checksEl.classList.remove('is-hidden');
        if (timeEl) timeEl.classList.remove('is-hidden');
    }
}

export function updateChatLastMessage(chatId) {
    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!chatItem) return;
    const lastMsgEl = chatItem.querySelector('.last-msg');
    if (!lastMsgEl) return;
    API.fetchMessages(chatId, 1, 0).then(messages => {
        const chatData = STATE.chatsMap[chatId];
        if (messages.length > 0) {
            const msg = messages[0];
            if (chatData) syncLastMessageMeta(chatData, msg);
            updateChatItemLastMessage(chatId);
            updateChatItemTime(chatId);
        } else {
            if (chatData) {
                chatData.last_message = null;
                chatData.last_message_time = null;
                chatData.last_message_system = null;
                chatData.last_message_id = null;
                chatData.last_message_sender_id = null;
                chatData.last_message_sender_name = null;
                chatData.last_message_is_mine = false;
                chatData.last_message_read = false;
            }
            updateChatItemLastMessage(chatId);
            const timeEl = chatItem.querySelector('.time');
            if (timeEl) timeEl.textContent = '';
        }
    }).catch(() => {});
}

export async function updateChatActions(chatId) {
    try {
        const chatData = STATE.chatsMap[chatId];
        const chatType = chatData ? chatData.type : null;
        STATE.currentChatType = chatType;
        const info = await API.getMyPermissions(chatId);
        if (chatId !== STATE.currentChatId) return;
        STATE.currentPermissions = (info && info.permissions) || {};
        updateChatUI(chatType, STATE.currentPermissions);
        updatePinnedBarControls();
    } catch (err) {
        console.error('Failed to load chat permissions:', err);
        if (chatId !== STATE.currentChatId) return;
        STATE.currentPermissions = {};
        updateChatUI(STATE.currentChatType, STATE.currentPermissions);
        updatePinnedBarControls();
    }
}

export async function updateBlockedButton() {
    const btn = document.getElementById('blocked-users-btn');
    if (!btn) return;
    try {
        const blocked = await API.getBlockedUsers();
        btn.classList.toggle('is-hidden', !(Array.isArray(blocked) && blocked.length > 0));
    } catch {
        btn.classList.add('is-hidden');
    }
}
