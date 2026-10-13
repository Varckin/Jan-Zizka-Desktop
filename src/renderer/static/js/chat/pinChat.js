import { STATE } from './state.js';
import { i18n } from './dom.js';
import * as API from './api.js';
import { showNotification } from './dialogs.js';
import { reorderChatItems } from './chatList.js';
import { isPinnedInActiveFolder } from './folders.js';
import { createMenuLink, updateMenuLink } from './ui/menuLink.js';

const PIN_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

export function isChatPinned(chat) {
    return !!(chat && chat.is_pinned);
}

export function createPinIcon() {
    const icon = document.createElement('span');
    icon.className = 'pin-icon';
    icon.title = i18n.pinned_label || 'Pinned';
    icon.innerHTML = PIN_ICON_SVG;
    return icon;
}

export function buildPinMenuLink(chat) {
    const pinned = isChatPinned(chat);
    return createMenuLink(
        pinned ? 'unpinChat' : 'pinChat',
        pinned ? (i18n.unpin_chat || 'Unpin chat') : (i18n.pin_chat || 'Pin chat'),
        'pin'
    );
}

export async function toggleChatPin(chatId) {
    const chat = STATE.chatsMap[chatId];
    if (!chat) return;
    const pinning = !isChatPinned(chat);
    try {
        const data = pinning ? await API.pinChat(chatId) : await API.unpinChat(chatId);
        applyChatPinState(chatId, !!(data && data.is_pinned), data ? data.pinned_at : null);
        showNotification(pinning
            ? (i18n.chat_pinned || 'Chat pinned')
            : (i18n.chat_unpinned || 'Chat unpinned'));
    } catch (err) {
        const prefix = pinning
            ? (i18n.error_pin_chat || 'Failed to pin chat')
            : (i18n.error_unpin_chat || 'Failed to unpin chat');
        showNotification(prefix + ': ' + err.message);
    }
}

export function applyChatPinState(chatId, isPinned, pinnedAt) {
    const chat = STATE.chatsMap[chatId];
    if (chat) {
        chat.is_pinned = !!isPinned;
        chat.pinned_at = isPinned ? (pinnedAt || chat.pinned_at || new Date().toISOString()) : null;
    }
    updateChatItemPinUI(chatId);
    reorderChatItems();
}

export function handleChatPinUpdated(payload) {
    if (!payload || !payload.chat_id) return;
    applyChatPinState(payload.chat_id, payload.is_pinned, payload.pinned_at);
}

export function updateChatItemPinUI(chatId) {
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!item) return;
    const pinned = isChatPinned(STATE.chatsMap[chatId]) || isPinnedInActiveFolder(chatId);
    item.classList.toggle('pinned', pinned);
    const wrapper = item.querySelector('.last-msg-wrapper');
    const timeEl = item.querySelector('.time');
    let icon = item.querySelector('.pin-icon');
    if (pinned && !icon && wrapper) {
        icon = createPinIcon();
        if (timeEl) wrapper.insertBefore(icon, timeEl);
        else wrapper.appendChild(icon);
    } else if (!pinned && icon) {
        icon.remove();
    }
    const link = item.querySelector('.chat-item-dropdown a[data-action="pinChat"], .chat-item-dropdown a[data-action="unpinChat"]');
    if (link) {
        updateMenuLink(link, pinned ? (i18n.unpin_chat || 'Unpin chat') : (i18n.pin_chat || 'Pin chat'));
        link.dataset.action = pinned ? 'unpinChat' : 'pinChat';
    }
}
