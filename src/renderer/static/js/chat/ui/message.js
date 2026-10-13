import { STATE } from '../state.js';
import { DOM, i18n } from '../dom.js';
import { isMyMessage, createUserDisplay, createVerifiedBadge, renderMessageContent, getDateKey, getDateLabel, formatFileSize, systemEventParts } from '../format.js';
import { showContextMenu } from './contextMenu.js';
import { showMediaViewer, showLinkConfirm } from '../dialogs.js';
import { contactNickname, nicknameByUsername } from '../contacts.js';
import { createMsgChecks } from '../../core_chat/checks.js';

export function createDateSeparator(isoString) {
    const wrap = document.createElement('div');
    wrap.className = 'date-separator';
    const label = document.createElement('span');
    label.className = 'date-separator-label';
    label.textContent = getDateLabel(isoString);
    wrap.appendChild(label);
    return wrap;
}

const SYSTEM_ICONS = {
    group_created: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    member_joined: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
    member_left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
    member_removed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/></svg>',
};

export function createSystemMessageElement(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'system-message';
    wrap.dataset.msgId = msg.id;
    wrap.dataset.dateKey = getDateKey(msg.created_at);

    const pill = document.createElement('div');
    pill.className = 'system-message-pill';

    const icon = document.createElement('span');
    icon.className = 'system-message-icon';
    icon.innerHTML = SYSTEM_ICONS[(msg.system && msg.system.event) || 'member_joined'] || SYSTEM_ICONS.member_joined;
    pill.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'system-message-text';
    systemEventParts(msg.system).forEach(part => {
        if (part.user !== undefined) {
            const userSpan = document.createElement('span');
            userSpan.className = 'system-user';
            userSpan.textContent = part.user;
            text.appendChild(userSpan);
        } else if (part.text) {
            text.appendChild(document.createTextNode(part.text));
        }
    });
    pill.appendChild(text);

    const time = document.createElement('span');
    time.className = 'system-message-time';
    time.textContent = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    pill.appendChild(time);

    wrap.appendChild(pill);
    return wrap;
}

export function createMessageAvatar(msg) {
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar is-clickable';
    if (msg.sender_id != null) avatarDiv.dataset.userId = String(msg.sender_id);
    const fullName = [msg.sender_first_name, msg.sender_last_name]
        .filter(n => n && String(n).trim())
        .join(' ')
        .trim();
    const label = contactNickname(msg.sender_id) || fullName || msg.sender_username || '?';
    avatarDiv.title = label;
    avatarDiv.setAttribute('aria-hidden', 'true');
    if (msg.sender_avatar) {
        const img = document.createElement('img');
        img.src = msg.sender_avatar;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            if (avatarDiv.querySelector('img') !== img) return;
            img.remove();
            avatarDiv.textContent = label.charAt(0).toUpperCase();
        }, { once: true });
        avatarDiv.appendChild(img);
    } else {
        avatarDiv.textContent = label.charAt(0).toUpperCase();
    }
    return avatarDiv;
}

const MSG_PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
const MSG_AUDIO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const MSG_DOWNLOAD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const PIN_BADGE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

export function createPinBadge() {
    const badge = document.createElement('span');
    badge.className = 'pin-badge';
    badge.title = i18n.pinned_message || 'Pinned message';
    badge.innerHTML = PIN_BADGE_SVG;
    return badge;
}

export function setMessagePinnedUI(messageId, pinned) {
    const el = document.querySelector(`.message[data-msg-id="${messageId}"]`);
    if (!el) return;
    const timeDiv = el.querySelector('.time');
    const badge = el.querySelector('.pin-badge');
    if (pinned) {
        el.dataset.pinned = '1';
        if (!badge && timeDiv) timeDiv.prepend(createPinBadge());
    } else {
        delete el.dataset.pinned;
        if (badge) badge.remove();
    }
}

function attachmentName(a) {
    return a.file_name || String(a.file_url || '').split('/').pop() || '';
}

function attachmentExt(name) {
    const clean = String(name || '');
    const dot = clean.lastIndexOf('.');
    if (dot < 0 || dot === clean.length - 1) return '';
    return clean.slice(dot + 1).toLowerCase().slice(0, 5);
}

export function renderAttachments(attachmentsDiv, attachments) {
    attachmentsDiv.innerHTML = '';
    const mediaItems = [];
    (attachments || []).forEach(a => {
        const fileType = a.file_type || 'document';
        const el = createMsgAttachment(a);
        if (fileType === 'image' || fileType === 'video') {
            el.dataset.mediaIndex = String(mediaItems.length);
            mediaItems.push({ kind: fileType === 'video' ? 'video' : 'image', url: a.file_url, name: attachmentName(a) });
        }
        attachmentsDiv.appendChild(el);
    });
    attachmentsDiv.querySelectorAll('[data-media-index]').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            showMediaViewer(mediaItems, parseInt(el.dataset.mediaIndex, 10) || 0);
        });
    });
}

function createMsgAttachment(a) {
    const fileType = a.file_type || 'document';
    const name = attachmentName(a);
    if (fileType === 'image') {
        const figure = document.createElement('div');
        figure.className = 'msg-attach-image';
        const img = document.createElement('img');
        img.src = a.file_url;
        img.alt = name || 'attachment';
        img.title = name;
        img.loading = 'lazy';
        figure.appendChild(img);
        return figure;
    }
    if (fileType === 'video') {
        const card = document.createElement('div');
        card.className = 'msg-attach-video';
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.tabIndex = -1;
        video.src = a.file_url;
        card.appendChild(video);
        const play = document.createElement('span');
        play.className = 'msg-attach-play';
        play.innerHTML = MSG_PLAY_SVG;
        card.appendChild(play);
        if (name) {
            const label = document.createElement('span');
            label.className = 'msg-attach-video-name';
            label.textContent = name;
            card.appendChild(label);
        }
        return card;
    }
    if (fileType === 'audio') {
        const row = document.createElement('div');
        row.className = 'msg-attach-audio';
        const icon = document.createElement('span');
        icon.className = 'msg-attach-audio-icon';
        icon.innerHTML = MSG_AUDIO_SVG;
        row.appendChild(icon);
        const main = document.createElement('div');
        main.className = 'msg-attach-main';
        if (name) {
            const nameEl = document.createElement('div');
            nameEl.className = 'msg-attach-name';
            nameEl.textContent = name;
            nameEl.title = name;
            main.appendChild(nameEl);
        }
        if (a.file_size) {
            const sizeEl = document.createElement('div');
            sizeEl.className = 'msg-attach-meta';
            sizeEl.textContent = formatFileSize(a.file_size);
            main.appendChild(sizeEl);
        }
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.src = a.file_url;
        main.appendChild(audio);
        row.appendChild(main);
        return row;
    }
    const row = document.createElement('div');
    row.className = 'msg-attach-file';
    const ext = document.createElement('span');
    ext.className = 'msg-attach-ext';
    const extLabel = attachmentExt(name);
    ext.dataset.ext = extLabel;
    ext.textContent = extLabel || 'file';
    row.appendChild(ext);
    const main = document.createElement('div');
    main.className = 'msg-attach-main';
    const nameEl = document.createElement('div');
    nameEl.className = 'msg-attach-name';
    nameEl.textContent = name || 'file';
    nameEl.title = name;
    main.appendChild(nameEl);
    if (a.file_size) {
        const sizeEl = document.createElement('div');
        sizeEl.className = 'msg-attach-meta';
        sizeEl.textContent = formatFileSize(a.file_size);
        main.appendChild(sizeEl);
    }
    row.appendChild(main);
    const download = document.createElement('a');
    download.className = 'msg-attach-download';
    download.href = a.file_url;
    download.download = name || '';
    download.title = i18n.download_file || 'Download';
    download.innerHTML = MSG_DOWNLOAD_SVG;
    download.addEventListener('click', e => e.stopPropagation());
    row.appendChild(download);
    return row;
}

export function createMessageElement(msg) {
    if (msg.is_system) return createSystemMessageElement(msg);
    const div = document.createElement('div');
    const mine = isMyMessage(msg);
    div.className = `message ${mine ? 'sent' : 'received'}`;
    div.dataset.msgId = msg.id;
    div.dataset.dateKey = getDateKey(msg.created_at);
    div.dataset.senderId = msg.sender_id != null ? String(msg.sender_id) : '';
    div.dataset.createdAt = msg.created_at || '';
    div.dataset.senderUsername = msg.sender_username || '';
    div.dataset.senderFirstName = msg.sender_first_name || '';
    div.dataset.senderLastName = msg.sender_last_name || '';

    const chatData = STATE.chatsMap[msg.chat_id];
    const chatType = msg.chat_type || (chatData && chatData.type) || STATE.currentChatType;
    const isChannel = chatType === 'channel';
    const isGroup = chatType === 'group';

    const senderDiv = document.createElement('div');
    senderDiv.className = 'sender' + (isChannel ? ' channel-sender' : '');
    if (isChannel) {
        senderDiv.textContent = msg.chat_name || (chatData && chatData.name) || 'Channel';
    } else {
        const senderNickname = contactNickname(msg.sender_id);
        if (senderNickname) senderDiv.textContent = senderNickname;
        else senderDiv.appendChild(createUserDisplay(msg.sender_first_name, msg.sender_last_name, msg.sender_username));
        if (!mine && chatData && chatData.type === 'direct' && (chatData.other_user_is_service || chatData.other_user_is_admin)) {
            senderDiv.appendChild(createVerifiedBadge(chatData.other_user_is_service ? 'service' : 'staff'));
        } else if (isGroup && msg.sender_is_admin) {
            senderDiv.appendChild(createVerifiedBadge('staff'));
        }
    }
    div.appendChild(senderDiv);

    if (msg.parent_id) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'reply-preview';
        replyDiv.appendChild(document.createTextNode('↳ '));
        const senderSpan = document.createElement('span');
        senderSpan.className = 'reply-sender';
        senderSpan.dataset.replySender = msg.parent_sender || '';
        senderSpan.textContent = nicknameByUsername(msg.parent_sender) || msg.parent_sender || 'User';
        replyDiv.appendChild(senderSpan);
        replyDiv.appendChild(document.createTextNode(': '));
        const contentSpan = document.createElement('span');
        contentSpan.textContent = msg.parent_content || '';
        replyDiv.appendChild(contentSpan);
        div.appendChild(replyDiv);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    const isDeleted = msg.deleted_at != null;
    if (isDeleted) {
        const em = document.createElement('em');
        em.textContent = i18n.message_deleted || 'Message deleted';
        contentDiv.appendChild(em);
    } else {
        renderMessageContent(contentDiv, msg.content, showLinkConfirm);
    }
    div.appendChild(contentDiv);

    if (msg.attachments && msg.attachments.length) {
        const attachmentsDiv = document.createElement('div');
        attachmentsDiv.className = 'attachments';
        renderAttachments(attachmentsDiv, msg.attachments);
        div.appendChild(attachmentsDiv);
    }

    const timeDiv = document.createElement('div');
    timeDiv.className = 'time';
    const date = new Date(msg.created_at);
    const timeText = date.toLocaleTimeString();

    if (isChannel) {
        timeDiv.appendChild(document.createTextNode(timeText));
        if (mine && typeof msg.read_count === 'number') {
            const readSpan = document.createElement('span');
            readSpan.className = 'read-count';
            readSpan.dataset.msgId = msg.id;
            readSpan.textContent = `👁 ${msg.read_count}`;
            timeDiv.appendChild(document.createTextNode(' '));
            timeDiv.appendChild(readSpan);
        }
    } else {
        timeDiv.appendChild(document.createTextNode(timeText));
        if (mine) timeDiv.appendChild(createMsgChecks(msg.is_read));
    }
    div.appendChild(timeDiv);

    if (msg.edited_at) {
        const editedDiv = document.createElement('span');
        editedDiv.className = 'edited';
        editedDiv.textContent = i18n.edited || 'edited';
        timeDiv.prepend(editedDiv);
    }

    if (msg.is_pinned) {
        div.dataset.pinned = '1';
        timeDiv.prepend(createPinBadge());
    }

    if (!isDeleted) {
        div.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showContextMenu(e, msg); });
        attachLongPress(div, msg);
    }

    if (isGroup && !mine) {
        const row = document.createElement('div');
        row.className = 'message-row msg-run-start msg-run-end';
        row.appendChild(createMessageAvatar(msg));
        row.appendChild(div);
        return row;
    }

    return div;
}

export function syncMessageSenderNames() {
    const container = DOM.messagesContainer;
    if (!container) return;
    container.querySelectorAll('.message[data-sender-id]').forEach(el => {
        const senderIdRaw = el.dataset.senderId;
        if (!senderIdRaw) return;
        const senderId = parseInt(senderIdRaw, 10);
        const senderDiv = el.querySelector('.sender');
        if (!senderDiv || senderDiv.classList.contains('channel-sender')) return;
        const nick = contactNickname(senderId);
        const fullName = [el.dataset.senderFirstName, el.dataset.senderLastName]
            .filter(n => n && n.trim())
            .join(' ')
            .trim();
        const username = el.dataset.senderUsername || '';
        const label = nick || fullName || username || '?';
        const badge = senderDiv.querySelector('.verified-badge');
        if (nick) {
            if (senderDiv.textContent !== nick) {
                senderDiv.textContent = nick;
                if (badge) senderDiv.appendChild(badge);
            }
        } else if (!senderDiv.querySelector('.user-display')) {
            senderDiv.textContent = '';
            senderDiv.appendChild(createUserDisplay(el.dataset.senderFirstName, el.dataset.senderLastName, username));
            if (badge) senderDiv.appendChild(badge);
        }
        const row = el.closest ? el.closest('.message-row') : null;
        const avatar = row && row.querySelector('.message-avatar');
        if (avatar) {
            avatar.title = label;
            if (!avatar.querySelector('img')) avatar.textContent = label.charAt(0).toUpperCase();
        }
        const replyEl = el.querySelector('.reply-sender[data-reply-sender]');
        if (replyEl) {
            replyEl.textContent = nicknameByUsername(replyEl.dataset.replySender) || replyEl.dataset.replySender || 'User';
        }
    });
}

const GROUP_RUN_GAP_MS = 5 * 60 * 1000;

function parseRowMeta(row) {
    const msgEl = row.querySelector('.message');
    const senderId = msgEl && msgEl.dataset.senderId ? msgEl.dataset.senderId : null;
    const createdAt = msgEl ? Date.parse(msgEl.dataset.createdAt || '') : NaN;
    return { row, senderId, createdAt };
}

function continuesRun(prev, next) {
    if (!prev || !next) return false;
    if (!prev.senderId || prev.senderId !== next.senderId) return false;
    if (isNaN(prev.createdAt) || isNaN(next.createdAt)) return true;
    const gap = next.createdAt - prev.createdAt;
    return gap >= 0 && gap <= GROUP_RUN_GAP_MS;
}

export function regroupMessages(container) {
    if (!container) return;
    const runs = [];
    let currentRun = [];
    for (const node of container.children) {
        if (node.classList && node.classList.contains('message-row')) {
            const meta = parseRowMeta(node);
            if (continuesRun(currentRun[currentRun.length - 1], meta)) {
                currentRun.push(meta);
            } else {
                if (currentRun.length) runs.push(currentRun);
                currentRun = [meta];
            }
        } else {
            if (currentRun.length) runs.push(currentRun);
            currentRun = [];
        }
    }
    if (currentRun.length) runs.push(currentRun);
    for (const run of runs) {
        for (let i = 0; i < run.length; i++) {
            run[i].row.classList.toggle('msg-run-start', i === 0);
            run[i].row.classList.toggle('msg-run-end', i === run.length - 1);
        }
    }
}

function attachLongPress(element, msg) {
    let touchTimer = null, touchStartX = 0, touchStartY = 0;
    const LONG_PRESS_MS = 500, MOVE_THRESHOLD = 10;
    element.addEventListener('touchstart', function(e) {
        if (window.innerWidth >= 640) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        element.classList.add('long-pressing');
        touchTimer = setTimeout(() => {
            touchTimer = null;
            element.classList.remove('long-pressing');
            showContextMenu({ clientX: touchStartX, clientY: touchStartY, preventDefault: () => {}, stopPropagation: () => {} }, msg);
            if (navigator.vibrate) navigator.vibrate(30);
        }, LONG_PRESS_MS);
    }, { passive: true });
    element.addEventListener('touchmove', function(e) {
        if (!touchTimer) return;
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) { clearTimeout(touchTimer); touchTimer = null; element.classList.remove('long-pressing'); }
    }, { passive: true });
    element.addEventListener('touchend', function() { if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; } element.classList.remove('long-pressing'); }, { passive: true });
    element.addEventListener('touchcancel', function() { if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; } element.classList.remove('long-pressing'); }, { passive: true });
}
