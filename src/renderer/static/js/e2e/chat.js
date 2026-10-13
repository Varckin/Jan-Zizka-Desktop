import { STATE } from './state.js';
import { DOM } from './dom.js';
import * as API from './api.js';
import { SessionCipher, b64, toArrayBuffer, messageTypeLabel } from './crypto.js';
import { clearSessionsFor } from './keyStore.js';
import { toast } from './toast.js';
import {
    displayName, isMine, findMessage, upsertMessage,
    rememberPlaintext, forgetPlaintext, clearPlaintextFor, recallPlaintext,
    primePlaintextCache, sortChatsByRecent, t, tf,
} from './utils.js';
import {
    ensureSession, decryptBatch, parseDecrypted, withCryptoLock,
} from './session.js';
import {
    renderChatList, renderMessages, renderFilePreview, updateReplyIndicator,
    applyOnlineStatusToHeader,
    appendMessageNode, rerenderMessage, updateChatListItem,
    appendPendingNode, rerenderPendingNode, removePendingNode,
} from './render.js';
import { encryptBytes } from './files.js';
import { connectChatSocket, closeChatSocket } from './ws.js';
import { closeEmoji } from './emoji.js';
import { playSound } from '../core_chat/sound.js';
import { notifyMessage, isDesktopBackground } from '../desktop/notify.js';
import { confirmDialog } from '../desktop/confirm.js';

const PAGE_SIZE = 50;
const SYNC_PAGE_SIZE = 100;
const SYNC_MAX_PAGES = 20;
const SCROLL_TRIGGER_PX = 80;

function isNearMessagesBottom() {
    if (!DOM.messages) return true;
    return DOM.messages.scrollHeight - DOM.messages.scrollTop - DOM.messages.clientHeight < SCROLL_TRIGGER_PX;
}

let chatWsHandler = null;
let identityCheckHandler = null;

export function setChatWsHandler(fn) {
    chatWsHandler = fn;
}

export function setIdentityCheckHandler(fn) {
    identityCheckHandler = fn;
}

async function decryptMany(chat, raws) {
    const results = new Map();
    const todo = [];
    for (const raw of raws) {
        if (raw.deleted_at) {
            results.set(raw.id, { ...raw, text: null, error: null, errorKind: null, deleted: true, payload: null });
            continue;
        }
        const cached = recallPlaintext(chat.id, raw.id);
        if (cached != null) {
            results.set(raw.id, parseDecrypted(raw, cached));
            continue;
        }
        if (isMine(raw)) {
            results.set(raw.id, {
                ...raw,
                text: null,
                error: t('e2e_cannot_decrypt', 'Cannot decrypt'),
                errorKind: null,
                deleted: false,
                payload: null,
            });
            continue;
        }
        todo.push(raw);
    }
    if (todo.length) {
        const decrypted = await decryptBatch(chat, todo);
        let identityIssue = false;
        for (const d of decrypted) {
            results.set(d.id, d);
            if (d.errorKind === 'identity') identityIssue = true;
        }
        if (identityIssue && identityCheckHandler) identityCheckHandler(chat.id);
    }
    return raws.map(raw => results.get(raw.id)).filter(Boolean);
}

export async function loadChats() {
    try {
        STATE.chats = await API.listChats();
        renderChatList();
    } catch (e) {
        toast(tf('e2e_failed_load_chats', 'Failed to load chats: {msg}', { msg: e.message }), true);
    }
}

export async function loadMessages(chat, mode = 'initial') {
    const chatId = chat.id;
    if (STATE.loadingByChat[chatId]) return;
    STATE.loadingByChat[chatId] = true;
    try {
        await primePlaintextCache(chatId);
        if (mode === 'sync') {
            const existing = STATE.messages[chat.id] || [];
            let lastId = existing.length ? existing[existing.length - 1].id : 0;
            for (let page = 0; page < SYNC_MAX_PAGES; page++) {
                const raw = await API.listMessages(chat.id, SYNC_PAGE_SIZE, 0, lastId || null);
                if (!raw.length) break;
                const decrypted = await decryptMany(chat, raw);
                for (const m of decrypted) upsertMessage(chat.id, m);
                lastId = raw[raw.length - 1].id;
                if (raw.length < SYNC_PAGE_SIZE) break;
            }
            STATE.lastLoadedAt[chat.id] = Date.now();
            if (STATE.currentChatId === chat.id) {
                const stick = isNearMessagesBottom();
                renderMessages(chat.id, { preserveScroll: !stick });
            }
            closeEmoji();
            return;
        }
        const raw = await API.listMessages(chat.id, PAGE_SIZE, 0);
        const ordered = raw.slice().reverse();
        const decrypted = await decryptMany(chat, ordered);
        for (const m of decrypted) upsertMessage(chat.id, m);
        STATE.hasMoreByChat[chat.id] = raw.length === PAGE_SIZE;
        const list = STATE.messages[chat.id];
        STATE.oldestIdByChat[chat.id] = list.length ? list[0].id : null;
        STATE.lastLoadedAt[chat.id] = Date.now();
        if (STATE.currentChatId === chat.id) renderMessages(chat.id);
    } catch (e) {
        toast(tf('e2e_failed_load_messages', 'Failed to load messages: {msg}', { msg: e.message }), true);
    } finally {
        delete STATE.loadingByChat[chatId];
    }
}

export async function loadOlderMessages() {
    const chatId = STATE.currentChatId;
    if (!chatId) return;
    if (STATE.loadingOlder || STATE.loadingByChat[chatId]) return;
    if (STATE.hasMoreByChat[chatId] === false) return;
    const oldestId = STATE.oldestIdByChat[chatId];
    if (!oldestId) return;

    const chat = STATE.chats.find(c => c.id === chatId);
    if (!chat) return;

    STATE.loadingOlder = true;
    await primePlaintextCache(chatId);
    const indicator = showOlderLoader();

    const container = DOM.messages;
    const prevHeight = container.scrollHeight;
    const prevTop = container.scrollTop;

    try {
        const raw = await API.listMessages(chatId, PAGE_SIZE, 0, null, oldestId);
        if (STATE.currentChatId !== chatId) return;

        if (!raw.length) {
            STATE.hasMoreByChat[chatId] = false;
            return;
        }

        const ordered = raw.slice().reverse();
        const decrypted = await decryptMany(chat, ordered);
        if (STATE.currentChatId !== chatId) return;

        const existing = STATE.messages[chatId] || [];
        const existingIds = new Set(existing.map(m => m.id));
        const fresh = decrypted.filter(m => !existingIds.has(m.id));
        if (!fresh.length) {
            STATE.hasMoreByChat[chatId] = false;
            return;
        }

        STATE.messages[chatId] = fresh.concat(existing);
        STATE.messages[chatId].sort((a, b) => a.id - b.id);
        STATE.oldestIdByChat[chatId] = STATE.messages[chatId][0].id;
        STATE.hasMoreByChat[chatId] = raw.length === PAGE_SIZE;

        renderMessages(chatId, { preserveScroll: true });

        const delta = container.scrollHeight - prevHeight;
        if (delta > 0) container.scrollTop = prevTop + delta;
    } catch (e) {
        toast(tf('e2e_failed_load_older', 'Failed to load older messages: {msg}', { msg: e.message }), true);
    } finally {
        STATE.loadingOlder = false;
        indicator?.remove();
    }
}

function showOlderLoader() {
    if (!DOM.messages) return null;
    const el = document.createElement('div');
    el.className = 'e2e-load-older';
    const spin = document.createElement('span');
    spin.className = 'e2e-load-older-spinner';
    el.appendChild(spin);
    const txt = document.createElement('span');
    txt.textContent = t('e2e_loading_older', 'Loading older messages...');
    el.appendChild(txt);
    DOM.messages.prepend(el);
    return el;
}

export function isNearMessagesTop() {
    if (!DOM.messages) return false;
    return DOM.messages.scrollTop < SCROLL_TRIGGER_PX;
}

export async function openChat(chat) {
    if (STATE.currentChatId === chat.id) {
        if (window.innerWidth <= 768) {
            DOM.sidebar.classList.add('hidden');
            DOM.main.classList.remove('hidden');
            DOM.main.classList.add('show-chat');
        }
        return;
    }

    closeEmoji();
    const myGen = ++STATE.loadGeneration;

    STATE.currentChatId = chat.id;
    STATE.messages[chat.id] = [];
    STATE.hasMoreByChat[chat.id] = true;
    STATE.oldestIdByChat[chat.id] = null;
    STATE.replyTo = null;
    STATE.pendingFiles = [];
    updateReplyIndicator();
    renderFilePreview();

    DOM.chatName.textContent = displayName(chat);
    DOM.inputArea.classList.remove('is-hidden');
    DOM.deleteBtn.classList.remove('is-hidden');
    DOM.searchMsgBtn?.classList.remove('is-hidden');
    DOM.messages.innerHTML = '';
    const loadingEl = document.createElement('div');
    loadingEl.className = 'e2e-loading';
    loadingEl.textContent = t('loading', 'Loading...');
    DOM.messages.appendChild(loadingEl);
    applyOnlineStatusToHeader(chat);

    document.querySelectorAll('.e2e-chat-item').forEach(el => el.classList.remove('active'));
    const active = document.querySelector(`.e2e-chat-item[data-chat-id="${chat.id}"]`);
    if (active) active.classList.add('active');

    if (window.innerWidth <= 768) {
        DOM.sidebar.classList.add('hidden');
        DOM.main.classList.remove('hidden');
        DOM.main.classList.add('show-chat');
    }

    try {
        await ensureSession(chat);
    } catch (e) {
        DOM.messages.innerHTML = '';
        const errEl = document.createElement('div');
        errEl.className = 'e2e-empty';
        errEl.textContent = t('e2e_cannot_establish_session', 'Cannot establish session: ') + e.message;
        DOM.messages.appendChild(errEl);
        if (identityCheckHandler) identityCheckHandler(chat.id);
        return;
    }

    if (myGen !== STATE.loadGeneration) return;

    connectChatSocket(chat.id, chatWsHandler);
    await loadMessages(chat, 'initial');

    if (myGen !== STATE.loadGeneration) return;

    API.markRead(chat.id).catch(() => {});
    chat.unread_count = 0;
    renderChatList();
    if (identityCheckHandler) identityCheckHandler(chat.id);
}

export function sendCurrentMessage() {
    const text = DOM.messageInput.value.trim();
    const files = STATE.pendingFiles.slice();
    if (!text && files.length === 0) return;
    const chatId = STATE.currentChatId;
    if (!chatId) return;
    const chat = STATE.chats.find(c => c.id === chatId);
    if (!chat) return;

    const parentId = STATE.replyTo ? STATE.replyTo.id : null;

    DOM.messageInput.value = '';
    DOM.messageInput.style.height = 'auto';
    STATE.replyTo = null;
    STATE.pendingFiles = [];
    DOM.fileInput.value = '';
    updateReplyIndicator();
    renderFilePreview();

    STATE.pendingSeq = (STATE.pendingSeq || 0) + 1;
    const entry = {
        tmpId: -STATE.pendingSeq,
        chatId,
        text,
        files,
        parentId,
        prepared: null,
        status: 'sending',
        error: null,
    };
    const list = (STATE.pendingSends[chatId] = STATE.pendingSends[chatId] || []);
    list.push(entry);
    if (STATE.currentChatId === chatId) appendPendingNode(chat, entry);
    flushPendingEntry(entry);
}

async function flushPendingEntry(entry) {
    const chat = STATE.chats.find(c => c.id === entry.chatId);
    if (!chat) {
        failPending(entry, 'Chat not found');
        return;
    }
    entry.status = 'sending';
    entry.error = null;
    if (STATE.currentChatId === entry.chatId) rerenderPendingNode(chat, entry);

    try {
        const address = await ensureSession(chat);
        if (!entry.prepared) {
            entry.prepared = await withCryptoLock(async () => {
                const cipher = new SessionCipher(STATE.store, address);
                const envelope = { type: entry.files.length ? 'file' : 'text', text: entry.text };
                const pendingCiphertexts = [];

                if (entry.files.length) {
                    envelope.file = null;
                    envelope.extra_files = [];
                    const metas = [];
                    for (const f of entry.files) {
                        const buf = await f.arrayBuffer();
                        const { ciphertext, keyBytes, iv } = await encryptBytes(buf);
                        metas.push({
                            name: f.name,
                            size: f.size,
                            mime: f.type || 'application/octet-stream',
                            key: b64(keyBytes),
                            iv: b64(iv),
                        });
                        pendingCiphertexts.push(ciphertext);
                    }
                    envelope.file = metas[0];
                    envelope.extra_files = metas.slice(1);
                }

                const plaintext = new TextEncoder().encode(JSON.stringify(envelope));
                const result = await cipher.encrypt(plaintext.buffer);
                const rawBody = await toArrayBuffer(result.body);
                const ciphertext = b64(rawBody);
                if (!ciphertext) throw new Error('Encryption produced empty ciphertext');
                return {
                    envelope,
                    ciphertext,
                    messageType: messageTypeLabel(result.type),
                    pendingCiphertexts,
                };
            });
        }

        const { envelope, ciphertext, messageType, pendingCiphertexts } = entry.prepared;
        const response = await API.sendMessage({
            chat_id: entry.chatId,
            ciphertext,
            message_type: messageType,
            parent_id: entry.parentId,
        });

        rememberPlaintext(entry.chatId, response.id, JSON.stringify(envelope));

        const localMsg = {
            id: response.id,
            sender_id: STATE.currentUserId,
            ciphertext,
            message_type: messageType,
            created_at: response.created_at,
            edited_at: null,
            deleted_at: null,
            parent_id: entry.parentId,
            is_read: false,
            attachments: [],
            text: JSON.stringify(envelope),
            payload: envelope,
            error: null,
            errorKind: null,
            deleted: false,
        };

        removePendingEntry(entry);
        upsertMessage(entry.chatId, localMsg);
        if (STATE.currentChatId === entry.chatId) {
            removePendingNode(entry.tmpId);
            appendMessageNode(chat, localMsg);
        }

        if (entry.files.length) {
            const results = await Promise.all(
                entry.files.map(async (f, i) => {
                    try {
                        const blob = new Blob([pendingCiphertexts[i]], {
                            type: 'application/octet-stream',
                        });
                        const att = await API.uploadAttachment(response.id, blob, f.name);
                        return { i, att };
                    } catch (e) {
                        console.error('Attachment upload failed', e);
                        return { i, att: null };
                    }
                })
            );
            for (const { i, att } of results) {
                if (!att) continue;
                localMsg.attachments.push({
                    id: att.id,
                    file_url: att.file_url,
                    file_size: att.file_size,
                });
                if (i === 0) envelope.file.attachment_id = att.id;
                else envelope.extra_files[i - 1].attachment_id = att.id;
            }
            localMsg.text = JSON.stringify(envelope);
            rememberPlaintext(entry.chatId, response.id, localMsg.text);
            if (STATE.currentChatId === entry.chatId) rerenderMessage(chat, localMsg);
        }

        chat.last_message_at = response.created_at;
        sortChatsByRecent();
        updateChatListItem(entry.chatId);
    } catch (e) {
        console.error('Send failed:', e);
        failPending(entry, e.message);
        toast(tf('e2e_failed_send', 'Send failed: {msg}', { msg: e.message }), true);
    }
}

function failPending(entry, message) {
    entry.status = 'failed';
    entry.error = message || '';
    const chat = STATE.chats.find(c => c.id === entry.chatId);
    if (chat && STATE.currentChatId === entry.chatId) rerenderPendingNode(chat, entry);
    if (identityCheckHandler && /identity key changed/i.test(String(message || ''))) {
        identityCheckHandler(entry.chatId);
    }
}

function removePendingEntry(entry) {
    const list = STATE.pendingSends[entry.chatId] || [];
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
}

export function retryPendingSend(entry) {
    if (!entry || entry.status !== 'failed') return;
    flushPendingEntry(entry);
}

export function discardPendingSend(entry) {
    if (!entry) return;
    removePendingEntry(entry);
    removePendingNode(entry.tmpId);
}

export async function confirmEdit() {
    const msg = STATE.editTarget;
    if (!msg) return;
    const text = DOM.editText.value.trim();
    if (!text) {
        DOM.editError.textContent = t('e2e_message_empty', 'Message cannot be empty');
        return;
    }
    DOM.editConfirm.disabled = true;
    try {
        const chat = STATE.chats.find(c => c.id === STATE.currentChatId);
        if (!chat) return;
        const address = await ensureSession(chat);
        const ciphertextInfo = await withCryptoLock(async () => {
            const cipher = new SessionCipher(STATE.store, address);
            const envelope = msg.payload
                ? { ...msg.payload, text }
                : { type: 'text', text };
            const plaintext = new TextEncoder().encode(JSON.stringify(envelope));
            const result = await cipher.encrypt(plaintext.buffer);
            const rawBody = await toArrayBuffer(result.body);
            return { envelope, ciphertext: b64(rawBody), messageType: messageTypeLabel(result.type) };
        });
        await API.editMessage(msg.id, {
            ciphertext: ciphertextInfo.ciphertext,
            message_type: ciphertextInfo.messageType,
        });
        rememberPlaintext(STATE.currentChatId, msg.id, JSON.stringify(ciphertextInfo.envelope));
        const m = findMessage(STATE.currentChatId, msg.id);
        if (m) {
            m.text = JSON.stringify(ciphertextInfo.envelope);
            m.payload = ciphertextInfo.envelope;
            m.edited_at = new Date().toISOString();
            rerenderMessage(chat, m);
        }
        DOM.editModal.classList.remove('is-open');
        STATE.editTarget = null;
    } catch (e) {
        DOM.editError.textContent = e.message;
        if (identityCheckHandler) identityCheckHandler(STATE.currentChatId);
    } finally {
        DOM.editConfirm.disabled = false;
    }
}

export async function deleteCurrentChat() {
    const chatId = STATE.currentChatId;
    if (!chatId) return;

    try {
        await API.deleteChat(chatId);
    } catch (e) {
        toast(tf('e2e_failed_delete', 'Failed to delete: {msg}', { msg: e.message }), true);
        return;
    }

    const chat = STATE.chats.find(c => c.id === chatId);
    if (chat) clearSessionsFor([chat.other_username]);

    handleChatDeleted(chatId);
    toast(t('e2e_chat_deleted', 'Chat deleted'));
}

export function handleChatDeleted(chatId) {
    delete STATE.messages[chatId];
    delete STATE.pendingSends[chatId];
    clearPlaintextFor(chatId);
    STATE.chats = STATE.chats.filter(c => c.id !== chatId);

    if (STATE.currentChatId === chatId) {
        STATE.currentChatId = null;
        closeChatSocket();
        DOM.messages.innerHTML = '';
        const goneEl = document.createElement('div');
        goneEl.className = 'e2e-empty';
        goneEl.textContent = t('e2e_chat_deleted_by_peer', 'Chat was deleted');
        DOM.messages.appendChild(goneEl);
        DOM.inputArea.classList.add('is-hidden');
        DOM.deleteBtn.classList.add('is-hidden');
        DOM.searchMsgBtn?.classList.add('is-hidden');
        DOM.chatName.textContent = t('select_chat', 'Select a chat');
        DOM.onlineStatus.classList.add('is-hidden');
        DOM.typingIndicator.classList.add('is-hidden');
        if (DOM.identityWarning) DOM.identityWarning.classList.add('is-hidden');
    }
    renderChatList();
}

export function notifyIncoming(chatId, text) {
    playSound(STATE.notificationSound);

    const chat = STATE.chats.find(c => c.id === chatId);
    const who = chat ? displayName(chat) : t('e2e_unknown_user', 'someone');

    if (isDesktopBackground()) {
        notifyMessage({
            title: who,
            body: text || t('e2e_new_encrypted_message', 'New encrypted message'),
            tag: `e2e-chat-${chatId}`,
            data: { e2eChatId: chatId },
        });
    } else {
        toast(tf('new_message_from', 'New message from {username}', { username: who }));
    }
}

export async function handleCtxAction(action, msg) {
    if (action === 'reply') {
        STATE.replyTo = msg;
        updateReplyIndicator();
    } else if (action === 'copy') {
        const text = msg.payload?.text ?? msg.text ?? '';
        try {
            await navigator.clipboard.writeText(text);
            toast(t('copied', 'Copied'));
        } catch {
            toast(t('e2e_copy_failed', 'Copy failed'), true);
        }
    } else if (action === 'edit') {
        STATE.editTarget = msg;
        DOM.editText.value = msg.payload?.text ?? msg.text ?? '';
        DOM.editError.textContent = '';
        DOM.editModal.classList.add('is-open');
        setTimeout(() => DOM.editText.focus(), 50);
    } else if (action === 'delete') {
        if (!await confirmDialog(t('e2e_delete_message_confirm', 'Delete this message?'))) return;
        try {
            await API.deleteMessage(msg.id);
            const chatId = STATE.currentChatId;
            const chat = STATE.chats.find(c => c.id === chatId);
            const m = findMessage(chatId, msg.id);
            if (m) {
                m.deleted = true;
                m.text = null;
                m.payload = null;
                forgetPlaintext(chatId, msg.id);
                if (chat) rerenderMessage(chat, m);
                else renderMessages(chatId);
            }
        } catch (e) {
            toast(tf('e2e_failed_delete', 'Failed to delete: {msg}', { msg: e.message }), true);
        }
    }
}
