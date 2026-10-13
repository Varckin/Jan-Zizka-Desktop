import { STATE } from './state.js';
import { DOM } from './dom.js';
import {
    formatTime, displayName, isMine, senderLabel,
    getDateKey, getDateLabel, t, formatLastSeen
} from './utils.js';
import { loadAttachmentImage, downloadAttachment } from './files.js';
import { fileLabel } from '../core_chat/files.js';
import { createMsgChecks, setMsgChecksRead } from '../core_chat/checks.js';
import { showContextMenu } from './contextMenu.js';

const SCROLL_STICK_PX = 120;

let _lazyImageObserver = null;

function getLazyImageObserver() {
    if (_lazyImageObserver) return _lazyImageObserver;
    _lazyImageObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const img = entry.target;
            _lazyImageObserver.unobserve(img);
            loadAttachmentImage(
                Number(img.dataset.attId),
                img.dataset.key,
                img.dataset.iv,
                img.dataset.mime,
                img
            );
        }
    }, { root: DOM.messages, rootMargin: '300px 0px' });
    return _lazyImageObserver;
}

function setEmptyMessage(container, text) {
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'e2e-empty';
    el.textContent = text;
    container.appendChild(el);
}

function isNearBottom() {
    if (!DOM.messages) return true;
    return DOM.messages.scrollHeight - DOM.messages.scrollTop - DOM.messages.clientHeight < SCROLL_STICK_PX;
}

export function applyOnlineStatusToHeader(chat) {
    if (!DOM.onlineStatus) return;
    if (!chat) {
        DOM.onlineStatus.classList.add('is-hidden');
        DOM.onlineStatus.classList.remove('e2e-online--text');
        DOM.onlineStatus.textContent = '';
        return;
    }
    DOM.onlineStatus.classList.remove('is-hidden');
    if (chat.other_online) {
        DOM.onlineStatus.classList.remove('e2e-online--text');
        DOM.onlineStatus.textContent = '';
    } else {
        DOM.onlineStatus.classList.add('e2e-online--text');
        DOM.onlineStatus.textContent = formatLastSeen(chat.other_last_seen);
    }
}

export function updateChatOnlineDot(chatId, isOnline) {
    if (!DOM.chatList) return;
    const item = DOM.chatList.querySelector(
        `.e2e-chat-item[data-chat-id="${chatId}"]`
    );
    if (!item) return;
    const wrapper = item.querySelector('.e2e-chat-avatar-wrapper');
    if (!wrapper) return;

    const existing = wrapper.querySelector('.e2e-online-dot');
    if (isOnline && !existing) {
        const dot = document.createElement('span');
        dot.className = 'e2e-online-dot';
        wrapper.appendChild(dot);
    } else if (!isOnline && existing) {
        existing.remove();
    }
}

export function renderChatList() {
    DOM.chatList.innerHTML = '';
    if (!STATE.chats.length) {
        setEmptyMessage(DOM.chatList, t('e2e_no_chats', 'No E2E chats yet'));
        return;
    }
    const listFragment = document.createDocumentFragment();
    STATE.chats.forEach((chat, index) => {
        const el = document.createElement('div');
        el.className = 'e2e-chat-item';
        el.dataset.chatId = chat.id;
        if (STATE.currentChatId === chat.id) el.classList.add('active');

        el.classList.add('e2e-chat-item--enter');
        el.style.animationDelay = `${Math.min(index * 20, 220)}ms`;
        el.addEventListener('animationend', () => {
            el.classList.remove('e2e-chat-item--enter');
            el.style.animationDelay = '';
        }, { once: true });

        const avatarWrapper = document.createElement('div');
        avatarWrapper.className = 'e2e-chat-avatar-wrapper';

        const avatar = document.createElement('div');
        avatar.className = 'e2e-chat-avatar';
        if (chat.other_avatar) {
            const img = document.createElement('img');
            img.src = chat.other_avatar;
            img.alt = chat.other_username;
            avatar.appendChild(img);
        } else {
            avatar.textContent = (chat.other_username || '?')[0].toUpperCase();
        }
        avatarWrapper.appendChild(avatar);

        if (chat.other_online) {
            const dot = document.createElement('span');
            dot.className = 'e2e-online-dot';
            avatarWrapper.appendChild(dot);
        }
        el.appendChild(avatarWrapper);

        const info = document.createElement('div');
        info.className = 'e2e-chat-info';

        const name = document.createElement('div');
        name.className = 'e2e-chat-name';
        const lockIcon = document.createElement('span');
        lockIcon.setAttribute('aria-hidden', 'true');
        lockIcon.textContent = '🔒 ';
        name.appendChild(lockIcon);
        name.appendChild(document.createTextNode(displayName(chat)));
        info.appendChild(name);

        const sub = document.createElement('div');
        sub.className = 'e2e-chat-sub';
        const preview = document.createElement('span');
        preview.className = 'preview';
        preview.textContent = chat.has_device
            ? t('e2e_encrypted', 'Encrypted')
            : t('e2e_peer_no_device', 'Peer has no E2E device');
        sub.appendChild(preview);
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = formatTime(chat.last_message_at);
        sub.appendChild(time);
        info.appendChild(sub);
        el.appendChild(info);

        if (chat.unread_count > 0) {
            const badge = document.createElement('span');
            badge.className = 'e2e-badge';
            badge.textContent = chat.unread_count;
            el.appendChild(badge);
        }

        el.addEventListener('click', () => {
            import('./chat.js').then(m => m.openChat(chat));
        });
        listFragment.appendChild(el);
    });
    DOM.chatList.appendChild(listFragment);
}

function createDateSeparator(iso) {
    const wrap = document.createElement('div');
    wrap.className = 'e2e-date-separator';
    const label = document.createElement('span');
    label.className = 'e2e-date-separator-label';
    label.textContent = getDateLabel(iso);
    wrap.appendChild(label);
    return wrap;
}

export function renderMessages(chatId, options = {}) {
    const { preserveScroll = false } = options;
    const messages = STATE.messages[chatId] || [];
    const chat = STATE.chats.find(c => c.id === chatId);
    DOM.messages.innerHTML = '';
    if (!messages.length) {
        setEmptyMessage(DOM.messages, t('e2e_no_messages', 'No messages yet. Say hi 👋'));
        appendPendingNodesFor(chatId);
        return;
    }
    const fragment = document.createDocumentFragment();
    let prevKey = null;
    for (const m of messages) {
        const key = getDateKey(m.created_at);
        if (key && key !== prevKey) {
            fragment.appendChild(createDateSeparator(m.created_at));
            prevKey = key;
        }
        fragment.appendChild(renderMessage(m, chat));
    }
    DOM.messages.appendChild(fragment);
    appendPendingNodesFor(chatId);
    if (!preserveScroll) {
        DOM.messages.scrollTop = DOM.messages.scrollHeight;
    }
}

export function updateChatListItem(chatId) {
    if (!DOM.chatList) return;
    const chat = STATE.chats.find(c => c.id === chatId);
    if (!chat) return;
    const item = DOM.chatList.querySelector(`.e2e-chat-item[data-chat-id="${chatId}"]`);
    if (!item) { renderChatList(); return; }

    const timeEl = item.querySelector('.e2e-chat-sub .time');
    if (timeEl) timeEl.textContent = formatTime(chat.last_message_at);

    const previewEl = item.querySelector('.e2e-chat-sub .preview');
    if (previewEl) {
        previewEl.textContent = chat.has_device
            ? t('e2e_encrypted', 'Encrypted')
            : t('e2e_peer_no_device', 'Peer has no E2E device');
    }

    let badge = item.querySelector('.e2e-badge');
    if (chat.unread_count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'e2e-badge';
            item.appendChild(badge);
        }
        badge.textContent = chat.unread_count;
    } else if (badge) {
        badge.remove();
    }

    updateChatOnlineDot(chatId, !!chat.other_online);

    if (DOM.chatList.firstElementChild !== item) DOM.chatList.prepend(item);
}

export function appendMessageNode(chat, m) {
    if (!DOM.messages) return;
    if (DOM.messages.querySelector(`.e2e-message[data-msg-id="${m.id}"]`)) return;
    const stick = isMine(m) || isNearBottom();
    const placeholder = DOM.messages.querySelector('.e2e-empty, .e2e-loading');
    if (placeholder) placeholder.remove();

    const msgs = STATE.messages[chat.id] || [];
    const idx = msgs.findIndex(x => x.id === m.id);
    const prev = idx > 0 ? msgs[idx - 1] : null;
    const key = getDateKey(m.created_at);
    if (key && (!prev || getDateKey(prev.created_at) !== key)) {
        DOM.messages.appendChild(createDateSeparator(m.created_at));
    }
    DOM.messages.appendChild(renderMessage(m, chat));
    if (stick) DOM.messages.scrollTop = DOM.messages.scrollHeight;
}

export function rerenderMessage(chat, m) {
    if (!DOM.messages) return;
    const el = DOM.messages.querySelector(`.e2e-message[data-msg-id="${m.id}"]`);
    if (!el) { renderMessages(chat.id); return; }
    el.replaceWith(renderMessage(m, chat));
}

export function updateMessageReadMarks(messageIds) {
    if (!DOM.messages) return false;
    let changed = false;
    for (const id of messageIds || []) {
        const el = DOM.messages.querySelector(`.e2e-message[data-msg-id="${id}"]`);
        if (!el || !el.classList.contains('sent')) continue;
        const rd = el.querySelector('.msg-checks');
        if (rd) {
            if (setMsgChecksRead(rd, true)) changed = true;
            continue;
        }
        const meta = el.querySelector('.e2e-msg-meta');
        if (meta) {
            meta.appendChild(createMsgChecks(true));
            changed = true;
        }
    }
    return changed;
}

function renderMessage(m, chat) {
    const el = document.createElement('div');
    const mine = isMine(m);
    el.className = 'e2e-message' + (mine ? ' sent' : '');
    el.dataset.msgId = m.id;

    const sender = senderLabel(m, chat);
    if (sender.name) {
        const senderEl = document.createElement('div');
        senderEl.className = 'e2e-msg-sender';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'e2e-msg-sender-name';
        nameSpan.textContent = sender.name;
        senderEl.appendChild(nameSpan);
        if (sender.username) {
            const userSpan = document.createElement('span');
            userSpan.className = 'e2e-msg-sender-username';
            userSpan.textContent = sender.username;
            senderEl.appendChild(userSpan);
        }
        el.appendChild(senderEl);
    }

    const content = document.createElement('div');
    content.className = 'e2e-msg-content';

    if (m.deleted) {
        const em = document.createElement('em');
        em.textContent = t('message_deleted', 'Message deleted');
        content.appendChild(em);
    } else if (m.error) {
        const span = document.createElement('span');
        span.className = 'e2e-msg-error';
        span.textContent = '🔒 ' + m.error;
        content.appendChild(span);
    } else if (m.payload && (m.payload.type === 'file' || m.payload.file)) {
        content.appendChild(renderFilePayload(m));
    } else {
        content.textContent = (m.payload && m.payload.text) || m.text || '';
    }
    el.appendChild(content);

    if (m.attachments && m.attachments.length && !(m.payload && m.payload.file)) {
        const wrap = document.createElement('div');
        wrap.className = 'e2e-attachments';
        m.attachments.forEach(a => wrap.appendChild(renderAttachmentChip(a)));
        el.appendChild(wrap);
    }

    const meta = document.createElement('div');
    meta.className = 'e2e-msg-meta';
    meta.textContent = new Date(m.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
    if (m.edited_at) {
        const ed = document.createElement('span');
        ed.className = 'e2e-edited';
        ed.textContent = ' · ' + t('edited', 'edited');
        meta.appendChild(ed);
    }
    if (mine) {
        meta.appendChild(createMsgChecks(m.is_read));
    }
    el.appendChild(meta);

    if (!m.deleted) {
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, m);
        });
        attachLongPress(el, m);
    }

    return el;
}

function renderFilePayload(m) {
    const wrap = document.createElement('div');
    wrap.className = 'e2e-file-msg';
    const files = [];
    if (m.payload.file) files.push(m.payload.file);
    if (m.payload.extra_files) files.push(...m.payload.extra_files);
    const attachments = m.attachments || [];

    if (m.payload.text) {
        const txt = document.createElement('div');
        txt.className = 'e2e-file-caption';
        txt.textContent = m.payload.text;
        wrap.appendChild(txt);
    }

    files.forEach((f, idx) => {
        const attId =
            f.attachment_id || (attachments[idx] && attachments[idx].id);
        const mime = f.mime || 'application/octet-stream';
        const name = f.name || t('e2e_file_short', 'file');
        const key = f.key;
        const iv = f.iv;

        if (!attId) {
            const pending = document.createElement('div');
            pending.className = 'e2e-file-chip disabled';
            pending.textContent = '⏳ ' + name + ' (' + t('e2e_uploading', 'uploading...') + ')';
            wrap.appendChild(pending);
            return;
        }

        if (mime.startsWith('image/')) {
            const img = document.createElement('img');
            img.className = 'e2e-file-image is-lazy';
            img.alt = name;
            img.dataset.attId = String(attId);
            img.dataset.key = key || '';
            img.dataset.iv = iv || '';
            img.dataset.mime = mime;
            wrap.appendChild(img);
            getLazyImageObserver().observe(img);
        } else {
            const chip = document.createElement('div');
            chip.className = 'e2e-file-chip';
            chip.textContent = '📎 ' + name;
            chip.addEventListener('click', () =>
                downloadAttachment(attId, key, iv, mime, name)
            );
            wrap.appendChild(chip);
        }
    });
    return wrap;
}

function renderAttachmentChip(a) {
    const chip = document.createElement('div');
    chip.className = 'e2e-attach-chip';
    chip.textContent = '📎 attachment #' + a.id;
    return chip;
}

export function renderFilePreview() {
    DOM.filePreview.innerHTML = '';
    if (!STATE.pendingFiles.length) {
        DOM.filePreview.classList.add('is-hidden');
        return;
    }
    STATE.pendingFiles.forEach((f, idx) => {
        const chip = document.createElement('div');
        chip.className = 'e2e-file-chip';
        const label = document.createElement('span');
        label.textContent = fileLabel(f);
        chip.appendChild(label);
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.textContent = '✕';
        rm.setAttribute('aria-label', t('e2e_remove_file', 'Remove file'));
        rm.addEventListener('click', () => {
            STATE.pendingFiles.splice(idx, 1);
            renderFilePreview();
        });
        chip.appendChild(rm);
        DOM.filePreview.appendChild(chip);
    });
    DOM.filePreview.classList.remove('is-hidden');
}

export function updateReplyIndicator() {
    if (!STATE.replyTo) {
        DOM.replyIndicator.classList.add('is-hidden');
        return;
    }
    DOM.replyIndicator.classList.remove('is-hidden');
    const isSelf = isMine(STATE.replyTo);
    DOM.replySender.textContent = isSelf
        ? t('e2e_you', 'You')
        : (STATE.chats.find(c => c.id === STATE.currentChatId)?.other_username || 'peer');

    let previewText = '';
    if (STATE.replyTo.payload) {
        previewText = STATE.replyTo.payload.file
            ? '📎 ' + (STATE.replyTo.payload.file.name || t('e2e_file_short', 'file'))
            : STATE.replyTo.payload.text || '';
    } else {
        previewText = STATE.replyTo.text || '';
    }
    DOM.replyPreview.textContent = previewText.slice(0, 60);
}

export function renderPendingMessage(chat, entry) {
    const el = document.createElement('div');
    el.className = 'e2e-message sent e2e-message--pending';
    el.dataset.pendingId = String(entry.tmpId);

    const content = document.createElement('div');
    content.className = 'e2e-msg-content';
    if (entry.files && entry.files.length) {
        const names = entry.files.map(f => f.name).join(', ');
        content.textContent = entry.text
            ? entry.text + ' · 📎 ' + names
            : '📎 ' + names;
    } else {
        content.textContent = entry.text || '';
    }
    el.appendChild(content);

    const meta = document.createElement('div');
    meta.className = 'e2e-msg-meta';
    if (entry.status === 'failed') {
        const warn = document.createElement('span');
        warn.className = 'e2e-pending-failed';
        warn.textContent = '⚠ ' + t('e2e_pending_failed', 'Not sent — tap to retry');
        warn.title = entry.error || t('e2e_retry', 'Retry');
        warn.setAttribute('role', 'button');
        warn.addEventListener('click', () => {
            import('./chat.js').then(m => m.retryPendingSend(entry));
        });
        meta.appendChild(warn);
        const discard = document.createElement('button');
        discard.type = 'button';
        discard.className = 'e2e-pending-discard';
        discard.textContent = '✕';
        discard.setAttribute('aria-label', t('e2e_discard', 'Discard'));
        discard.addEventListener('click', () => {
            import('./chat.js').then(m => m.discardPendingSend(entry));
        });
        meta.appendChild(discard);
    } else {
        const clock = document.createElement('span');
        clock.className = 'e2e-pending-clock';
        clock.textContent = '🕓 ' + t('e2e_pending_sending', 'Sending…');
        meta.appendChild(clock);
    }
    el.appendChild(meta);
    return el;
}

export function appendPendingNode(chat, entry) {
    if (!DOM.messages) return;
    removePendingNode(entry.tmpId);
    const placeholder = DOM.messages.querySelector('.e2e-empty');
    if (placeholder) placeholder.remove();
    const stick = isNearBottom();
    DOM.messages.appendChild(renderPendingMessage(chat, entry));
    if (stick) DOM.messages.scrollTop = DOM.messages.scrollHeight;
}

export function rerenderPendingNode(chat, entry) {
    if (!DOM.messages) return;
    const el = DOM.messages.querySelector(`.e2e-message[data-pending-id="${entry.tmpId}"]`);
    if (!el) {
        if (STATE.currentChatId === entry.chatId) appendPendingNode(chat, entry);
        return;
    }
    el.replaceWith(renderPendingMessage(chat, entry));
}

export function removePendingNode(tmpId) {
    if (!DOM.messages) return;
    const el = DOM.messages.querySelector(`.e2e-message[data-pending-id="${tmpId}"]`);
    if (el) el.remove();
}

export function appendPendingNodesFor(chatId) {
    if (!DOM.messages) return;
    if (STATE.currentChatId !== chatId) return;
    const chat = STATE.chats.find(c => c.id === chatId);
    if (!chat) return;
    const entries = STATE.pendingSends[chatId] || [];
    for (const entry of entries) {
        DOM.messages.appendChild(renderPendingMessage(chat, entry));
    }
}

function attachLongPress(el, msg) {
    let timer = null;
    let sx = 0;
    let sy = 0;
    const HOLD = 500;

    el.addEventListener('touchstart', e => {
        if (window.innerWidth > 768) return;
        const t0 = e.touches[0];
        sx = t0.clientX;
        sy = t0.clientY;
        timer = setTimeout(() => {
            timer = null;
            showContextMenu(sx, sy, msg);
            if (navigator.vibrate) navigator.vibrate(20);
        }, HOLD);
    }, { passive: true });

    el.addEventListener('touchmove', e => {
        if (!timer) return;
        const t0 = e.touches[0];
        if (Math.abs(t0.clientX - sx) > 10 || Math.abs(t0.clientY - sy) > 10) {
            clearTimeout(timer);
            timer = null;
        }
    }, { passive: true });

    el.addEventListener('touchend', () => {
        if (timer) { clearTimeout(timer); timer = null; }
    }, { passive: true });

    el.addEventListener('touchcancel', () => {
        if (timer) { clearTimeout(timer); timer = null; }
    }, { passive: true });
}
