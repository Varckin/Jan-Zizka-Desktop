import { STATE } from './state.js';
import { DOM } from './dom.js';
import * as API from './api.js';
import { SessionCipher, unb64, toArrayBuffer } from './crypto.js';
import {
    ensureRegistered, NewDeviceWarning,
    getIdentityWarning, acceptIdentityWarning, dismissIdentityWarning,
    getStoredIdentity, safetyNumber, formatSafetyNumber,
} from './keyStore.js';
import qrFactory from '../qrcode/index.js';
import { sendWs, closeChatSocket, connectGlobalSocket } from './ws.js';
import { toast } from './toast.js';
import { createNotificationAudioFromSettings } from '../desktop/notify.js';
import { confirmDialog } from '../desktop/confirm.js';
import {
    isMine, findMessage, upsertMessage, rememberPlaintext,
    forgetPlaintext, addressFor, messagePreviewText, sortChatsByRecent, t, tf,
} from './utils.js';
import { parseDecrypted, decryptEnvelope } from './session.js';
import {
    updateChatOnlineDot, applyOnlineStatusToHeader,
    updateChatListItem, appendMessageNode, rerenderMessage, updateMessageReadMarks,
    renderFilePreview, updateReplyIndicator,
} from './render.js';
import {
    loadChats, openChat, loadMessages, loadOlderMessages,
    isNearMessagesTop, sendCurrentMessage, confirmEdit,
    deleteCurrentChat, handleChatDeleted, notifyIncoming,
    handleCtxAction, setChatWsHandler, setIdentityCheckHandler,
} from './chat.js';
import { initContextMenu } from './contextMenu.js';
import { initEffects } from './effects.js';
import { E2E_ALLOWED_FILE_TYPES } from './constants.js';
import { initEmoji, closeEmoji } from './emoji.js';
import { initSearch } from './search.js';
import { initFileDropZone } from '../core_chat/dragdrop.js';
import { gateVault, initVaultUi } from './vaultUi.js';
import * as vault from './vault.js';

const _inflightDecrypt = new Set();
let _bootDone = false;

async function handleChatWsMessage(data) {
    if (data.type === '__ws_open__') {
        const chat = STATE.chats.find(c => c.id === STATE.currentChatId);
        if (chat) {
            const since = STATE.lastLoadedAt[chat.id] || 0;
            if (Date.now() - since >= 1500) {
                try { await loadMessages(chat, 'sync'); } catch {}
            }
            if (document.visibilityState === 'visible') API.markRead(chat.id).catch(() => {});
        }
        return;
    }
    const chatId = STATE.currentChatId;
    if (!chatId) return;
    const chat = STATE.chats.find(c => c.id === chatId);
    if (!chat) return;

    if (data.type === 'e2e_new_message' && data.data.chat_id === chatId) {
        const rawId = data.data.id;
        if (findMessage(chatId, rawId) || _inflightDecrypt.has(rawId)) return;
        _inflightDecrypt.add(rawId);
        let decrypted;
        try {
            decrypted = await decryptEnvelope(chat, data.data);
        } finally {
            _inflightDecrypt.delete(rawId);
        }
        const raced = findMessage(chatId, rawId);
        if (raced) {
            Object.assign(raced, decrypted);
            if (STATE.currentChatId === chatId) rerenderMessage(chat, raced);
        } else {
            upsertMessage(chatId, decrypted);
            if (STATE.currentChatId === chatId) appendMessageNode(chat, decrypted);
        }
        if (STATE.currentChatId === chatId && !isMine(decrypted) && document.visibilityState === 'visible') {
            API.markRead(chatId).catch(() => {});
        }
        if (!isMine(decrypted)) {
            notifyIncoming(chatId, messagePreviewText(decrypted));
        }
        if (decrypted.errorKind === 'identity') checkIdentityWarning(chatId);
        chat.last_message_at = data.data.created_at;
        sortChatsByRecent();
        updateChatListItem(chatId);
    } else if (data.type === 'e2e_message_edited' && data.data.chat_id === chatId) {
        const existing = findMessage(chatId, data.data.id);
        if (!existing || isMine(existing)) return;
        try {
            const address = addressFor(chat);
            const cipher = new SessionCipher(STATE.store, address);
            const body = unb64(data.data.ciphertext);
            const asPrekey = data.data.message_type === 'prekey';
            let plaintext;
            try {
                plaintext = asPrekey
                    ? await cipher.decryptPreKeyWhisperMessage(body, 'binary')
                    : await cipher.decryptWhisperMessage(body, 'binary');
            } catch {
                plaintext = asPrekey
                    ? await cipher.decryptWhisperMessage(body, 'binary')
                    : await cipher.decryptPreKeyWhisperMessage(body, 'binary');
            }
            const buf = await toArrayBuffer(plaintext);
            const text = new TextDecoder().decode(buf);
            rememberPlaintext(chatId, data.data.id, text);
            const updated = parseDecrypted({ ...existing, edited_at: data.data.edited_at }, text);
            upsertMessage(chatId, updated);
            if (STATE.currentChatId === chatId) rerenderMessage(chat, updated);
        } catch (e) {
            console.error('Edit decrypt failed', e);
        }
    } else if (data.type === 'e2e_attachment_added' && data.data.chat_id === chatId) {
        const msg = findMessage(chatId, data.data.message_id);
        if (!msg) return;
        msg.attachments = (msg.attachments || []).concat(data.data.attachments);
        if (STATE.currentChatId === chatId) rerenderMessage(chat, msg);
    } else if (data.type === 'e2e_typing' && data.chat_id === chatId && data.user_id !== STATE.currentUserId) {
        if (data.is_typing) {
            DOM.typingIndicator.textContent = tf('typing_is', '{name} is typing...', { name: data.username });
            DOM.typingIndicator.classList.remove('is-hidden');
        } else {
            DOM.typingIndicator.classList.add('is-hidden');
        }
    } else if (data.type === 'e2e_message_deleted' && data.data.chat_id === chatId) {
        const msg = findMessage(chatId, data.data.id);
        if (msg) {
            msg.deleted = true;
            msg.text = null;
            msg.payload = null;
            forgetPlaintext(chatId, msg.id);
            rerenderMessage(chat, msg);
        }
    } else if (data.type === 'e2e_messages_read') {
        if (data.user_id === STATE.currentUserId) return;
        let changed = false;
        for (const id of data.message_ids || []) {
            const m = findMessage(chatId, id);
            if (m && isMine(m) && !m.is_read) {
                m.is_read = true;
                changed = true;
            }
        }
        if (changed && STATE.currentChatId === chatId) {
            updateMessageReadMarks(data.message_ids);
        }
    }
}

function handleGlobalWsMessage(data) {
    if (data.type === '__ws_open__') {
        loadChats().catch(() => {});
        return;
    }
    if (data.type === 'e2e_new_message_signal') {
        const { chat_id } = data.data;
        const chat = STATE.chats.find(c => c.id === chat_id);
        if (chat) {
            chat.last_message_at = new Date().toISOString();
            if (STATE.currentChatId !== chat_id) {
                chat.unread_count = (chat.unread_count || 0) + 1;
                sortChatsByRecent();
                updateChatListItem(chat_id);
                notifyIncoming(chat_id, t('e2e_new_encrypted_message', 'New message'));
            } else {
                const wsOpen = STATE.chatWs && STATE.chatWs.readyState === WebSocket.OPEN;
                if (!wsOpen) {
                    loadMessages(chat, 'sync').catch(() => {});
                    notifyIncoming(chat_id, t('e2e_new_encrypted_message', 'New message'));
                }
            }
        } else {
            loadChats();
        }
    } else if (data.type === 'e2e_chat_deleted') {
        handleChatDeleted(data.data.chat_id);
    } else if (data.type === 'user_status_batch') {
        const byUser = new Map();
        for (const c of STATE.chats) {
            if (c.other_user_id != null) byUser.set(c.other_user_id, c);
        }
        let currentPeerTouched = false;
        for (const entry of data.data || []) {
            const chat = byUser.get(entry.user_id);
            if (!chat) continue;
            chat.other_online = entry.status === 'online';
            if (!chat.other_online && entry.last_seen) {
                chat.other_last_seen = entry.last_seen;
            }
            updateChatOnlineDot(chat.id, chat.other_online);
            if (STATE.currentChatId === chat.id) currentPeerTouched = true;
        }
        if (currentPeerTouched) {
            const current = STATE.chats.find(c => c.id === STATE.currentChatId);
            if (current) applyOnlineStatusToHeader(current);
        }
    } else if (data.type === 'user_status') {
        const { user_id, status, last_seen } = data.data;
        const chat = STATE.chats.find(c => c.other_user_id === user_id);
        if (!chat) return;
        chat.other_online = status === 'online';
        if (!chat.other_online && last_seen) {
            chat.other_last_seen = last_seen;
        }
        updateChatOnlineDot(chat.id, chat.other_online);
        if (STATE.currentChatId === chat.id) {
            applyOnlineStatusToHeader(chat);
        }
    }
}

let _safetyDigits = '';

function checkIdentityWarning(chatId) {
    if (!DOM.identityWarning) return;
    if (STATE.currentChatId !== chatId) return;
    const chat = STATE.chats.find(c => c.id === chatId);
    if (!chat || !STATE.store) {
        DOM.identityWarning.classList.add('is-hidden');
        return;
    }
    const warning = getIdentityWarning(STATE.store);
    if (warning && warning.address === `${chat.other_username}.1`) {
        DOM.identityWarningText.textContent = tf('e2e_identity_warning',
            "Security warning: {name}'s encryption key has changed. Verify the safety number before you continue.",
            { name: chat.other_username });
        DOM.identityWarning.classList.remove('is-hidden');
    } else {
        DOM.identityWarning.classList.add('is-hidden');
    }
}

async function acceptIdentityChange() {
    const chat = STATE.chats.find(c => c.id === STATE.currentChatId);
    if (!chat || !STATE.store || !DOM.identityWarning) return;
    const warning = getIdentityWarning(STATE.store);
    if (!warning) {
        DOM.identityWarning.classList.add('is-hidden');
        return;
    }
    const oldNumber = formatSafetyNumber(
        await safetyNumber(STATE.store, STATE.currentUser.username, chat.other_username, warning.stored)
    );
    const newNumber = formatSafetyNumber(
        await safetyNumber(STATE.store, STATE.currentUser.username, chat.other_username, warning.incoming)
    );
    const ok = await confirmDialog(tf('e2e_identity_accept_confirm',
        'Compare safety numbers with {name} over another channel (by phone or in person).\n\nCurrent: {old}\nNew: {new}\n\nTrust the new key and reset the session?',
        { name: chat.other_username, old: oldNumber || '?', new: newNumber || '?' }));
    if (!ok) return;
    acceptIdentityWarning(STATE.store);
    DOM.identityWarning.classList.add('is-hidden');
    STATE.messages[chat.id] = [];
    STATE.hasMoreByChat[chat.id] = true;
    STATE.oldestIdByChat[chat.id] = null;
    await loadMessages(chat, 'initial');
}

function dismissIdentityWarningBar() {
    if (STATE.store) dismissIdentityWarning(STATE.store);
    if (DOM.identityWarning) DOM.identityWarning.classList.add('is-hidden');
}

async function fillSafetySection(chat) {
    if (!DOM.profileSafety) return;
    _safetyDigits = '';
    DOM.profileSafetyQr.classList.add('is-hidden');
    DOM.profileSafetyQr.removeAttribute('src');
    const remoteIdentity = STATE.store ? getStoredIdentity(STATE.store, chat.other_username) : null;
    if (!remoteIdentity) {
        DOM.profileSafety.classList.remove('is-hidden');
        DOM.profileSafetyDigits.textContent = '';
        DOM.profileSafetyHint.textContent = t('e2e_safety_hint', 'Available after the first encrypted message');
        DOM.profileSafetyCopy.classList.add('is-hidden');
        return;
    }
    const digits = await safetyNumber(STATE.store, STATE.currentUser.username, chat.other_username, remoteIdentity);
    if (!digits) {
        DOM.profileSafety.classList.add('is-hidden');
        return;
    }
    _safetyDigits = digits;
    DOM.profileSafety.classList.remove('is-hidden');
    DOM.profileSafetyHint.textContent = '';
    DOM.profileSafetyCopy.classList.remove('is-hidden');
    DOM.profileSafetyDigits.textContent = formatSafetyNumber(digits);
    try {
        const qr = qrFactory(0, 'M');
        qr.addData(`e2e-safety:${STATE.currentUser.username}:${chat.other_username}:${digits}`);
        qr.make();
        DOM.profileSafetyQr.src = qr.createDataURL(4, 8);
        DOM.profileSafetyQr.classList.remove('is-hidden');
    } catch {
        DOM.profileSafetyQr.classList.add('is-hidden');
    }
}

async function copySafetyNumber() {
    if (!_safetyDigits) return;
    try {
        await navigator.clipboard.writeText(formatSafetyNumber(_safetyDigits));
        toast(t('copied', 'Copied'));
    } catch {
        toast(t('e2e_copy_failed', 'Copy failed'), true);
    }
}

function handleModalKeys(e) {
    const openModal = document.querySelector('.e2e-modal.is-open');
    if (!openModal) return;
    if (e.key === 'Escape') {
        openModal.classList.remove('is-open');
        if (openModal === DOM.editModal) STATE.editTarget = null;
        return;
    }
    if (e.key !== 'Tab') return;
    const focusables = openModal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

function handleTyping() {
    const now = Date.now();
    if (!handleTyping._last || now - handleTyping._last > 2000) {
        sendWs({ type: 'typing', is_typing: true });
        handleTyping._last = now;
    }
    clearTimeout(handleTyping._timer);
    handleTyping._timer = setTimeout(() => {
        sendWs({ type: 'stop_typing' });
        handleTyping._last = null;
    }, 2000);
}

function handleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendCurrentMessage();
    }
}

function openNewChatModal() {
    DOM.newChatModal.classList.add('is-open');
    DOM.newChatUsername.value = '';
    DOM.newChatError.textContent = '';
    setTimeout(() => DOM.newChatUsername.focus(), 50);
}

function closeNewChatModal() {
    DOM.newChatModal.classList.remove('is-open');
}

async function confirmNewChat() {
    const username = DOM.newChatUsername.value.trim().toLowerCase();
    if (!username) {
        DOM.newChatError.textContent = t('e2e_enter_username', 'Enter a username');
        return;
    }
    DOM.newChatConfirm.disabled = true;
    try {
        const result = await API.startDirectChat(username);
        closeNewChatModal();
        await loadChats();
        const chat = STATE.chats.find(c => c.id === result.chat_id);
        if (chat) await openChat(chat);
    } catch (e) {
        DOM.newChatError.textContent = e.message;
    } finally {
        DOM.newChatConfirm.disabled = false;
    }
}

async function openProfileModal() {
    if (!STATE.currentChatId) return;
    const chat = STATE.chats.find(c => c.id === STATE.currentChatId);
    if (!chat || !chat.other_username) return;

    DOM.profileName.textContent = chat.other_username;
    DOM.profileUsername.textContent = '';
    DOM.profileUsername.classList.add('is-hidden');
    DOM.profileBio.textContent = '';
    DOM.profileBio.classList.add('is-hidden');

    DOM.profileAvatar.innerHTML = '';
    if (chat.other_avatar) {
        const img = document.createElement('img');
        img.src = chat.other_avatar;
        img.alt = chat.other_username;
        DOM.profileAvatar.appendChild(img);
    } else {
        DOM.profileAvatar.textContent = (chat.other_username || '?')[0].toUpperCase();
    }

    DOM.profileModal.classList.add('is-open');
    fillSafetySection(chat);

    try {
        const res = await fetch(`/profile/${encodeURIComponent(chat.other_username)}`);
        if (!res.ok) return;
        const p = await res.json();

        const fullName = [p.first_name, p.last_name]
            .filter(x => x && x.trim())
            .join(' ')
            .trim();

        if (fullName) {
            DOM.profileName.textContent = fullName;
            DOM.profileUsername.textContent = '@' + p.username;
            DOM.profileUsername.classList.remove('is-hidden');
        } else {
            DOM.profileName.textContent = p.username;
            DOM.profileUsername.classList.add('is-hidden');
        }

        if (p.avatar) {
            DOM.profileAvatar.innerHTML = '';
            const img = document.createElement('img');
            img.src = p.avatar;
            img.alt = p.username;
            DOM.profileAvatar.appendChild(img);
        }

        if (p.bio) {
            DOM.profileBio.textContent = p.bio;
            DOM.profileBio.classList.remove('is-hidden');
        }
    } catch (e) {
        console.warn('Failed to load profile', e);
    }
}

function toggleSidebar() {
    if (window.innerWidth <= 768) {
        DOM.sidebar.classList.toggle('hidden');
        DOM.main.classList.toggle('show-chat');
    } else {
        DOM.sidebar.classList.toggle('hidden');
    }
}

function validatePendingFiles(files) {
    const valid = [];
    const errors = [];
    const currentCount = STATE.pendingFiles.length;
    const slots = Math.max(0, E2E_ALLOWED_FILE_TYPES.maxFiles - currentCount);

    if (slots === 0) {
        errors.push(tf('e2e_files_limit', 'Maximum {count} files allowed', { count: E2E_ALLOWED_FILE_TYPES.maxFiles }));
        return { valid, errors };
    }

    let accepted = 0;
    for (const file of files) {
        if (accepted >= slots) {
            errors.push(tf('e2e_files_limit', 'Maximum {count} files allowed', { count: E2E_ALLOWED_FILE_TYPES.maxFiles }));
            break;
        }
        if (file.size > E2E_ALLOWED_FILE_TYPES.maxSize) {
            errors.push(tf('e2e_file_too_large', 'File {name} exceeds 10 MB', { name: file.name }));
            continue;
        }
        const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
        const mimeOk = E2E_ALLOWED_FILE_TYPES.mime.includes(file.type);
        const extOk = E2E_ALLOWED_FILE_TYPES.extensions.includes(ext);
        if (!mimeOk && !extOk) {
            errors.push(tf('e2e_file_unsupported', 'File {name} has unsupported type', { name: file.name }));
            continue;
        }
        valid.push(file);
        accepted++;
    }
    return { valid, errors };
}

function addPendingFiles(files) {
    const { valid, errors } = validatePendingFiles(files);
    errors.forEach(err => toast(err, true));
    for (const f of valid) STATE.pendingFiles.push(f);
    renderFilePreview();
}

function openDeleteChatModal() {
    if (!STATE.currentChatId) return;
    DOM.deleteChatModal.classList.add('is-open');
}

async function confirmDeleteChat() {
    DOM.deleteChatConfirm.disabled = true;
    try {
        await deleteCurrentChat();
        DOM.deleteChatModal.classList.remove('is-open');
    } finally {
        DOM.deleteChatConfirm.disabled = false;
    }
}

function bindEvents() {
    DOM.sendBtn.addEventListener('click', sendCurrentMessage);
    DOM.messageInput.addEventListener('keydown', handleInputKeydown);
    DOM.messageInput.addEventListener('input', handleTyping);
    DOM.messageInput.addEventListener('focus', () => closeEmoji());
    DOM.newChatBtn.addEventListener('click', openNewChatModal);
    DOM.messages.addEventListener('scroll', () => {
        if (isNearMessagesTop()) loadOlderMessages();
    }, { passive: true });
    DOM.chatName.addEventListener('click', openProfileModal);
    DOM.chatName.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openProfileModal();
        }
    });
    if (DOM.onlineStatus) {
        DOM.onlineStatus.addEventListener('click', e => e.stopPropagation());
    }
    DOM.newChatConfirm.addEventListener('click', confirmNewChat);
    DOM.newChatUsername.addEventListener('keydown', e => {
        if (e.key === 'Enter') confirmNewChat();
    });
    DOM.deleteBtn.addEventListener('click', openDeleteChatModal);
    DOM.deleteChatConfirm.addEventListener('click', confirmDeleteChat);
    DOM.toggleSidebar.addEventListener('click', toggleSidebar);

    DOM.attachBtn.addEventListener('click', () => DOM.fileInput.click());
    DOM.fileInput.addEventListener('change', e => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        if (!STATE.currentChatId) {
            toast(t('e2e_select_chat_to_upload', 'Select a chat first'), true);
            return;
        }
        addPendingFiles(files);
    });

    initFileDropZone({
        zone: DOM.main,
        label: t('drop_files_here', 'Drop files to send'),
        canDrop: () => (STATE.currentChatId ? null : t('e2e_select_chat_to_upload', 'Select a chat first')),
        onBlocked: message => toast(message, true),
        onFiles: files => addPendingFiles(files),
    });

    DOM.cancelReply.addEventListener('click', () => {
        STATE.replyTo = null;
        updateReplyIndicator();
    });

    DOM.editConfirm.addEventListener('click', confirmEdit);
    DOM.identityAccept?.addEventListener('click', acceptIdentityChange);
    DOM.identityDismiss?.addEventListener('click', dismissIdentityWarningBar);
    DOM.profileSafetyCopy?.addEventListener('click', copySafetyNumber);
    document.addEventListener('keydown', handleModalKeys);

    document.querySelectorAll('[data-modal-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = document.getElementById(btn.dataset.modalClose);
            if (m) m.classList.remove('is-open');
        });
    });

    [DOM.newChatModal, DOM.editModal, DOM.profileModal, DOM.deleteChatModal].forEach(modal => {
        modal.addEventListener('click', e => {
            if (e.target === modal) {
                modal.classList.remove('is-open');
                if (modal === DOM.editModal) STATE.editTarget = null;
            }
        });
    });

    DOM.search.addEventListener('input', function () {
        const q = this.value.toLowerCase();
        document.querySelectorAll('.e2e-chat-item').forEach(el => {
            el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });

    window.addEventListener('beforeunload', () => {
        try { sendWs({ type: 'stop_typing' }); } catch {}
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            try { sendWs({ type: 'stop_typing' }); } catch {}
            return;
        }
        const chat = STATE.chats.find(c => c.id === STATE.currentChatId);
        if (chat) API.markRead(chat.id).catch(() => {});
    });
}

function initNotifications() {
    if (STATE.notificationsInitialized) return;
    STATE.notificationsInitialized = true;
    try {
        STATE.notificationSound = createNotificationAudioFromSettings();
    } catch (e) {
        console.warn('Failed to load notification sound', e);
    }
}

async function reinitStoreAfterUnlock() {
    if (STATE.store) return;
    try {
        STATE.store = await ensureRegistered();
    } catch (e) {
        if (!(e instanceof NewDeviceWarning) && e.code !== 'new_device_warning') {
            toast(t('e2e_init_failed_msg', 'E2E init failed: ') + e.message, true);
        }
        return;
    }
    const chat = STATE.chats.find(c => c.id === STATE.currentChatId);
    if (chat) loadMessages(chat, 'initial').catch(() => {});
}

async function boot() {
    initVaultUi();
    await gateVault();
    vault.on('locked', () => {
        STATE.store = null;
        if (DOM.messages) DOM.messages.innerHTML = '';
    });
    vault.on('unlocked', () => {
        if (_bootDone) reinitStoreAfterUnlock();
    });
    _bootDone = true;
    try {
        STATE.store = await ensureRegistered();
    } catch (e) {
        if (e instanceof NewDeviceWarning || e.code === 'new_device_warning') {
            const ok = await confirmDialog(t('e2e_new_device_warning',
                'This looks like a new device.\n\nRegistering E2E here will permanently delete all your existing E2E chats and history on every device.\n\nContinue?'
            ));
            if (!ok) {
                toast(t('e2e_disabled_device', 'E2E disabled on this device'), true);
                return;
            }
            try {
                STATE.store = await ensureRegistered({ confirmNewDevice: true });
            } catch (e2) {
                toast(t('e2e_init_failed_msg', 'E2E init failed: ') + e2.message, true);
                return;
            }
        } else {
            toast(t('e2e_init_failed_msg', 'E2E init failed: ') + e.message, true);
            return;
        }
    }

    if (DOM.fileInput) DOM.fileInput.accept = E2E_ALLOWED_FILE_TYPES.accept;

    initEffects();
    initNotifications();
    await loadChats();
    connectGlobalSocket(handleGlobalWsMessage);
    bindEvents();
    initContextMenu(handleCtxAction);
    initEmoji();
    initSearch();

    const urlChatId = parseInt(new URLSearchParams(location.search).get('chat_id'), 10);
    if (urlChatId) {
        const chat = STATE.chats.find(c => c.id === urlChatId);
        if (chat) await openChat(chat);
    }
}

setChatWsHandler(handleChatWsMessage);
setIdentityCheckHandler(checkIdentityWarning);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
window.addEventListener('beforeunload', () => closeChatSocket());
