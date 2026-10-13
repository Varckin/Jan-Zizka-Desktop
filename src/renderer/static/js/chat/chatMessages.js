import { STATE, hasPermission } from './state.js';
import { DOM, i18n } from './dom.js';
import { isMyMessage, formatTypingText, getDateKey, isServiceChat } from './format.js';
import * as API from './api.js';
import * as WS from './websocket.js';
import { createMessageElement, createDateSeparator, regroupMessages } from './ui/message.js';
import { processSelectedFiles } from './ui/filePreview.js';
import { showNotification } from './dialogs.js';
import { scrollToBottom, scrollToBottomIfNear, preserveScrollOnPrepend, isNearBottom, pinToBottom } from './ui/scroll.js';
import { updateChatTypingIndicator, markChatRead } from './chatList.js';
import { appendPendingNode, rerenderPendingNode, removePendingNode, appendPendingNodesFor } from './ui/pending.js';
import { showToast } from '../core_chat/toast.js';
import { isChatMuted } from './muteModal.js';
import { contactNickname } from './contacts.js';
import { notifyMessage, isDesktopBackground, createNotificationAudioFromSettings } from '../desktop/notify.js';

export { showToast };

let _requestSeq = 0;
const BOTTOM_THRESHOLD = 80;
let _scrollReadTimer = null;
const SCROLL_READ_DEBOUNCE_MS = 400;

function getLastMessageDateKey() {
    const nodes = DOM.messagesContainer.querySelectorAll('[data-date-key]');
    return nodes.length > 0 ? nodes[nodes.length - 1].dataset.dateKey : null;
}

function getFirstMessageDateKey() {
    const node = DOM.messagesContainer.querySelector('.message[data-date-key]');
    return node ? node.dataset.dateKey : null;
}

function buildMessagesFragment(messages) {
    const fragment = document.createDocumentFragment();
    let prevKey = null;
    for (const msg of messages) {
        msg.chat_type = STATE.currentChatType;
        msg.chat_id = STATE.currentChatId;
        const key = getDateKey(msg.created_at);
        if (key && key !== prevKey) {
            fragment.appendChild(createDateSeparator(msg.created_at));
        }
        prevKey = key;
        fragment.appendChild(createMessageElement(msg));
    }
    return fragment;
}

function mergeAdjacentDateSeparators() {
    const children = DOM.messagesContainer.children;
    for (let i = 0; i < children.length - 1; i++) {
        const a = children[i];
        const b = children[i + 1];
        if (a.classList.contains('date-separator') && b.classList.contains('date-separator')) {
            a.remove();
            i--;
        }
    }
}

export async function loadMessages(chatId, reset = false) {
    if (!chatId || chatId !== STATE.currentChatId) return;
    if (STATE.isLoading || (!STATE.hasMore && !reset)) return;

    const mySeq = ++_requestSeq;
    STATE.isLoading = true;
    const off = reset ? 0 : STATE.offset;

    try {
        const messages = await API.fetchMessages(chatId, STATE.limit, off);
        if (mySeq !== _requestSeq || chatId !== STATE.currentChatId) return;

        if (reset) DOM.messagesContainer.innerHTML = '';

        if ((!messages || messages.length === 0) && reset) {
            DOM.messagesContainer.innerHTML = `<div class="empty-state">${i18n.no_messages || 'No messages yet. Start chatting!'}</div>`;
            appendPendingNodesFor(chatId);
            STATE.isLoading = false;
            return;
        }

        const ordered = (messages || []).slice().reverse();
        const fragment = buildMessagesFragment(ordered);

        if (reset) {
            DOM.messagesContainer.appendChild(fragment);
            appendPendingNodesFor(chatId);
            regroupMessages(DOM.messagesContainer);
            STATE.offset += messages.length;
            STATE.hasMore = messages.length === STATE.limit;
            STATE.isLoading = false;
            requestAnimationFrame(() => {
                scrollToBottom(false);
                pinToBottom(700);
            });
        } else {
            const wasNearBottom = isNearBottom();
            const firstExistingKey = getFirstMessageDateKey();
            const firstNewKey = ordered.length > 0 ? getDateKey(ordered[0].created_at) : null;
            preserveScrollOnPrepend(() => {
                DOM.messagesContainer.prepend(fragment);
                if (firstExistingKey && firstNewKey && firstExistingKey === firstNewKey) {
                    mergeAdjacentDateSeparators();
                }
                regroupMessages(DOM.messagesContainer);
            });
            STATE.offset += messages.length;
            STATE.hasMore = messages.length === STATE.limit;
            STATE.isLoading = false;
            if (wasNearBottom) requestAnimationFrame(() => scrollToBottom(false));
        }

        if (chatId === STATE.currentChatId) {
            const lastSeen = getLastRenderedMessageId();
            if (WS.isWsOpen()) {
                WS.sendWsMessage({ type: 'mark_read', last_seen_id: lastSeen });
            } else {
                API.markChatRead(chatId, lastSeen).catch(err => {
                    console.warn('Failed to mark chat as read via REST:', err);
                });
            }
        }
        markChatRead(chatId);
    } catch (err) {
        console.error('Failed to load messages:', err);
        if (mySeq === _requestSeq && chatId === STATE.currentChatId) {
            STATE.isLoading = false;
            const msg = err && err.message ? err.message : String(err);
            showNotification((i18n.failed_load_messages || 'Failed to load messages') + ': ' + msg);
        }
    }
}

export function abortPendingLoads() {
    _requestSeq++;
}

export function sendMessage() {
    const content = DOM.messageInput.value.trim();
    const files = STATE.selectedFiles.slice();
    if (!content && files.length === 0) return;
    if (!STATE.currentChatId) return;
    if (isServiceChat(STATE.chatsMap[STATE.currentChatId])) return;

    if (STATE.currentChatType === 'channel') return sendToChannel(content);

    enqueueOutgoing({ content, files, kind: 'message' });
}

export function sendGif(gifUrl) {
    if (!gifUrl) return;
    if (!STATE.currentChatId) return;
    if (isServiceChat(STATE.chatsMap[STATE.currentChatId])) return;

    if (STATE.currentChatType === 'channel') {
        return sendGifToChannel(gifUrl.trim());
    }

    enqueueOutgoing({ content: gifUrl.trim(), files: [], kind: 'message' });
}

function sendGifToChannel(gifUrl) {
    if (!hasPermission('post_messages')) {
        showNotification(i18n.only_admins_can_post || 'Only admins can post to this channel');
        return;
    }
    enqueueOutgoing({ content: gifUrl.trim(), files: [], kind: 'channel' });
}

function sendToChannel(content) {
    if (!hasPermission('post_messages')) {
        showNotification(i18n.only_admins_can_post || 'Only admins can post to this channel');
        return;
    }
    const files = STATE.selectedFiles.slice();
    enqueueOutgoing({ content, files, kind: 'channel' });
}

export function enqueueOutgoing({ content, files, kind }) {
    const chatId = STATE.currentChatId;
    if (!chatId) return null;
    const parentId = STATE.replyTo ? STATE.replyTo.id : null;

    clearInputState();

    STATE.pendingSeq = (STATE.pendingSeq || 0) + 1;
    const entry = {
        tmpId: -STATE.pendingSeq,
        chatId,
        content: content || '',
        files: files || [],
        parentId,
        kind: kind || 'message',
        status: 'sending',
        error: null,
    };
    const list = (STATE.pendingSends[chatId] = STATE.pendingSends[chatId] || []);
    list.push(entry);
    if (STATE.currentChatId === chatId) appendPendingNode(entry);
    flushPendingEntry(entry);
    return entry;
}

async function flushPendingEntry(entry) {
    entry.status = 'sending';
    entry.error = null;
    if (STATE.currentChatId === entry.chatId) rerenderPendingNode(entry);

    try {
        if (entry.kind === 'channel') {
            const url = entry.files.length > 0
                ? `/chat/api/channels/${entry.chatId}/posts/upload`
                : `/chat/api/channels/${entry.chatId}/posts`;
            const fetchOpts = entry.files.length > 0
                ? { method: 'POST', body: buildChannelFormData(entry.content, entry.parentId, entry.files) }
                : {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: entry.chatId, content: entry.content, parent_id: entry.parentId })
                };
            const res = await fetch(url, fetchOpts);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to post');
            }
        } else {
            await (entry.files.length > 0
                ? API.sendMessageWithMedia(entry.chatId, entry.content, entry.parentId, entry.files)
                : API.sendTextMessage(entry.chatId, entry.content, entry.parentId));
        }
        removePendingEntry(entry);
    } catch (err) {
        entry.status = 'failed';
        entry.error = (err && err.message) || String(err);
        if (STATE.currentChatId === entry.chatId) rerenderPendingNode(entry);
        const prefix = entry.kind === 'channel'
            ? 'Failed to post: '
            : 'Failed to send message: ';
        showNotification(prefix + entry.error);
    }
}

function removePendingEntry(entry) {
    const list = STATE.pendingSends[entry.chatId] || [];
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
    if (STATE.currentChatId === entry.chatId) removePendingNode(entry.tmpId);
}

export function retryPendingSend(entry) {
    if (!entry || entry.status !== 'failed') return;
    flushPendingEntry(entry);
}

export function discardPendingSend(entry) {
    if (!entry) return;
    removePendingEntry(entry);
}

export function clearPendingForChat(chatId) {
    delete STATE.pendingSends[chatId];
}

function buildChannelFormData(content, parentId, files) {
    const formData = new FormData();
    if (content) formData.append('content', content);
    if (parentId) formData.append('parent_id', parentId);
    for (const file of files) formData.append('files', file);
    return formData;
}

function clearInputState() {
    DOM.messageInput.value = '';
    STATE.replyTo = null;
    DOM.replyIndicator.classList.add('is-hidden');
    STATE.selectedFiles = [];
    DOM.fileInput.value = '';
    DOM.filePreviewContainer.classList.add('is-hidden');
    DOM.filePreviewContainer.innerHTML = '';
}

export function getLastRenderedMessageId() {
    let max = 0;
    DOM.messagesContainer.querySelectorAll('.message[data-msg-id]').forEach(el => {
        const id = parseInt(el.dataset.msgId, 10);
        if (Number.isFinite(id) && id > max) max = id;
    });
    return max;
}

export function markChatAsRead() {
    if (!STATE.currentChatId) return;
    const chatId = STATE.currentChatId;
    const lastSeen = getLastRenderedMessageId();
    if (WS.isWsOpen()) {
        WS.sendWsMessage({ type: 'mark_read', last_seen_id: lastSeen });
    } else {
        API.markChatRead(chatId, lastSeen).catch(err => {
            console.warn('Failed to mark chat as read via REST:', err);
        });
    }
    markChatRead(chatId);
}

export function appendMessage(msg) {
    const chatId = STATE.currentChatId;
    if (!chatId) return;
    if (DOM.messagesContainer.querySelector(`[data-msg-id="${msg.id}"]`)) return;

    const emptyState = DOM.messagesContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    msg.chat_type = STATE.currentChatType;
    msg.chat_id = chatId;

    const wasNearBottom = isNearBottom();
    const visible = document.visibilityState === 'visible';

    const key = getDateKey(msg.created_at);
    if (key && key !== getLastMessageDateKey()) {
        DOM.messagesContainer.appendChild(createDateSeparator(msg.created_at));
    }

    const div = createMessageElement(msg);
    DOM.messagesContainer.appendChild(div);
    regroupMessages(DOM.messagesContainer);

    const mine = isMyMessage(msg);
    if (mine || wasNearBottom) {
        scrollToBottom(false);
        pinToBottom(700);
    }

    if (!mine && visible && wasNearBottom) {
        markChatAsRead();
    }

    if (!mine && !msg.is_system && !isChatMuted(STATE.chatsMap[chatId])) {
        if (STATE.notificationSound) STATE.notificationSound.play().catch(() => {});
        const senderLabel = contactNickname(msg.sender_id) || msg.sender_username;
        if (isDesktopBackground()) {
            notifyMessage({
                title: (i18n.new_message_from || 'New message from {username}').replace('{username}', senderLabel),
                body: msg.content || '',
                tag: `chat-${chatId}`,
                data: { chatId },
            });
        } else {
            showToast((i18n.new_message_from || 'New message from {username}').replace('{username}', senderLabel), {
                icon: '💬',
            });
        }
    }
}

export function updateTyping(userId, isTyping, chatId, username) {
    if (userId === STATE.currentUserId || !chatId) return;
    if (!STATE.typingUsers[chatId]) STATE.typingUsers[chatId] = {};
    if (!STATE._typingTimers[chatId]) STATE._typingTimers[chatId] = {};
    const refreshDisplay = () => {
        if (chatId === STATE.currentChatId) {
            const typingUsers = STATE.typingUsers[chatId] || {};
            const isGroup = STATE.currentChatType === 'group';
            const text = formatTypingText(typingUsers, isGroup);
            if (!text) { DOM.chatTyping.classList.add('is-hidden'); DOM.chatTyping.textContent = ''; }
            else { DOM.chatTyping.classList.remove('is-hidden'); DOM.chatTyping.textContent = text; }
        }
        updateChatTypingIndicator(chatId);
    };
    if (isTyping) {
        STATE.typingUsers[chatId][userId] = contactNickname(userId) || username || `User ${userId}`;
        if (STATE._typingTimers[chatId][userId]) clearTimeout(STATE._typingTimers[chatId][userId]);
        STATE._typingTimers[chatId][userId] = setTimeout(() => {
            delete STATE.typingUsers[chatId][userId];
            delete STATE._typingTimers[chatId][userId];
            refreshDisplay();
        }, 5000);
    } else {
        delete STATE.typingUsers[chatId][userId];
        if (STATE._typingTimers[chatId][userId]) { clearTimeout(STATE._typingTimers[chatId][userId]); delete STATE._typingTimers[chatId][userId]; }
    }
    refreshDisplay();
}

export function cancelReplyHandler() {
    STATE.replyTo = null;
    DOM.replyIndicator.classList.add('is-hidden');
}

export function handleFileSelect() {
    const files = Array.from(this.files);
    processSelectedFiles(files, 'replace');
    this.value = '';
}

export function handleTyping() {
    if (STATE.currentChatType === 'channel') return;
    const now = Date.now();
    if (!STATE._lastTypingSent || now - STATE._lastTypingSent > 2000) {
        WS.sendWsMessage({ type: 'typing', is_typing: true });
        STATE._lastTypingSent = now;
    }
    clearTimeout(STATE.typingTimeout);
    STATE.typingTimeout = setTimeout(() => {
        WS.sendWsMessage({ type: 'stop_typing' });
        STATE._lastTypingSent = null;
    }, 2000);
}

export function handleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
    }
}

export async function scrollToMessage(messageId) {
    const chatId = STATE.currentChatId;
    while (true) {
        let el = document.querySelector(`.message[data-msg-id="${messageId}"]`);
        if (el) {
            await new Promise(r => requestAnimationFrame(r));
            await new Promise(r => requestAnimationFrame(r));
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('message-highlight');
            setTimeout(() => el.classList.remove('message-highlight'), 2000);
            return true;
        }
        if (STATE.currentChatId !== chatId || !STATE.hasMore) return false;
        while (STATE.isLoading) await new Promise(r => setTimeout(r, 50));
        await loadMessages(chatId, false);
        await new Promise(r => requestAnimationFrame(r));
    }
}

export function initScrollReadTracker() {
    const el = DOM.messagesContainer;
    if (!el || el.dataset.readTrackerBound === '1') return;
    el.dataset.readTrackerBound = '1';
    el.addEventListener('scroll', () => {
        if (!STATE.currentChatId) return;
        if (document.visibilityState !== 'visible') return;
        if (!isNearBottom()) return;
        if (_scrollReadTimer) clearTimeout(_scrollReadTimer);
        _scrollReadTimer = setTimeout(() => {
            _scrollReadTimer = null;
            markChatAsRead();
        }, SCROLL_READ_DEBOUNCE_MS);
    }, { passive: true });
}

export { handleWsMessage, handleGlobalWsMessage } from './wsHandlers.js';
