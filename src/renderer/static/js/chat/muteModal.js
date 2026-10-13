import { STATE } from './state.js';
import { DOM, i18n } from './dom.js';
import * as API from './api.js';
import { showNotification } from './dialogs.js';
import { updateDocumentTitle } from './chatList.js';
import { openModalFx, closeModalFx } from './modalFx.js';
import { createMenuLink, updateMenuLink } from './ui/menuLink.js';

const MUTE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

let muteTargetChatId = null;

export function isChatMuted(chat) {
    if (!chat) return false;
    if (chat.mute_until) return new Date(chat.mute_until) > new Date();
    return chat.is_muted === true;
}

export function createMuteIcon() {
    const icon = document.createElement('span');
    icon.className = 'mute-icon';
    icon.title = i18n.chat_muted || 'Notifications muted';
    icon.innerHTML = MUTE_ICON_SVG;
    return icon;
}

export function buildMuteMenuLink(chat) {
    const muted = isChatMuted(chat);
    return createMenuLink(
        muted ? 'unmuteChat' : 'muteChat',
        muted ? (i18n.unmute_chat || 'Unmute chat') : (i18n.mute_chat || 'Mute chat'),
        muted ? 'unmute' : 'mute'
    );
}

export function initMuteModal() {
    if (!DOM.muteModal) return;
    DOM.muteModal.addEventListener('click', e => {
        const option = e.target.closest('.mute-duration-option');
        if (option) handleMuteDuration(option.dataset.duration);
    });
}

export function openMuteModal(chat) {
    if (!DOM.muteModal || !chat) return;
    muteTargetChatId = chat.id;
    openModalFx(DOM.muteModal);
}

export function closeMuteModal() {
    if (!DOM.muteModal) return;
    closeModalFx(DOM.muteModal);
    muteTargetChatId = null;
}

async function handleMuteDuration(duration) {
    const chatId = muteTargetChatId;
    if (!chatId || !duration) return;
    closeMuteModal();
    try {
        const data = await API.muteChat(chatId, duration);
        applyMuteState(chatId, data.mute_until);
        showNotification(i18n.chat_muted || 'Notifications muted');
    } catch (err) {
        showNotification((i18n.error_mute_chat || 'Failed to mute chat') + ': ' + err.message);
    }
}

export async function unmuteChatById(chatId) {
    if (!chatId) return;
    try {
        const data = await API.unmuteChat(chatId);
        applyMuteState(chatId, data.mute_until);
        showNotification(i18n.chat_unmuted || 'Notifications unmuted');
    } catch (err) {
        showNotification((i18n.error_unmute_chat || 'Failed to unmute chat') + ': ' + err.message);
    }
}

export function applyMuteState(chatId, muteUntil) {
    const chat = STATE.chatsMap[chatId];
    if (chat) {
        chat.mute_until = muteUntil || null;
        chat.is_muted = !!chat.mute_until && new Date(chat.mute_until) > new Date();
    }
    updateChatItemMuteUI(chatId);
    updateDocumentTitle();
}

export function handleChatMuteUpdated(payload) {
    if (!payload || !payload.chat_id) return;
    applyMuteState(payload.chat_id, payload.mute_until);
}

export function updateChatItemMuteUI(chatId) {
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!item) return;
    const muted = isChatMuted(STATE.chatsMap[chatId]);
    const wrapper = item.querySelector('.last-msg-wrapper');
    const timeEl = item.querySelector('.time');
    let icon = item.querySelector('.mute-icon');
    if (muted && !icon && wrapper) {
        icon = createMuteIcon();
        if (timeEl) wrapper.insertBefore(icon, timeEl);
        else wrapper.appendChild(icon);
    } else if (!muted && icon) {
        icon.remove();
    }
    const link = item.querySelector('.chat-item-dropdown a[data-action="muteChat"], .chat-item-dropdown a[data-action="unmuteChat"]');
    if (link) {
        updateMenuLink(link, muted ? (i18n.unmute_chat || 'Unmute chat') : (i18n.mute_chat || 'Mute chat'), muted ? 'unmute' : 'mute');
        link.dataset.action = muted ? 'unmuteChat' : 'muteChat';
    }
    const badge = item.querySelector('.badge');
    if (badge) badge.classList.toggle('muted', muted);
}
