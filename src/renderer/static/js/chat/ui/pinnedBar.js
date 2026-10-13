import { STATE, hasPermission } from '../state.js';
import { DOM, i18n } from '../dom.js';
import * as API from '../api.js';
import { showNotification } from '../dialogs.js';
import { scrollToMessage } from '../chatMessages.js';
import { setMessagePinnedUI } from './message.js';
import { contactNickname } from '../contacts.js';

let currentPins = [];
let pinIndex = 0;
let loadedChatId = null;

export function canManagePins() {
    const type = STATE.currentChatType;
    if (type === 'group' || type === 'channel') {
        return hasPermission('pin_messages');
    }
    const chatData = STATE.chatsMap[STATE.currentChatId];
    return !(chatData && chatData.type === 'direct' && chatData.other_user_is_service);
}

export async function refreshPinnedBar(chatId) {
    if (!chatId) {
        hidePinnedBar();
        return;
    }
    loadedChatId = chatId;
    try {
        const pins = await API.fetchPinnedMessages(chatId);
        if (loadedChatId !== chatId || chatId !== STATE.currentChatId) return;
        currentPins = Array.isArray(pins) ? pins : [];
        pinIndex = 0;
        renderPinnedBar();
    } catch (err) {
        console.error('Failed to load pinned messages:', err);
    }
}

export function hidePinnedBar() {
    currentPins = [];
    pinIndex = 0;
    loadedChatId = null;
    if (!DOM.pinnedBar) return;
    DOM.pinnedBar.classList.add('is-hidden');
    delete DOM.pinnedBar.dataset.messageId;
}

function senderLabel(pin) {
    const chatData = STATE.chatsMap[STATE.currentChatId];
    if (STATE.currentChatType === 'channel' || (chatData && chatData.type === 'channel')) {
        return (chatData && chatData.name) || 'Channel';
    }
    const nickname = contactNickname(pin.sender_id);
    if (nickname) return nickname;
    const fullName = [pin.sender_first_name, pin.sender_last_name].filter(n => n && String(n).trim()).join(' ').trim();
    return fullName || pin.sender_username || '';
}

function previewText(pin) {
    const content = (pin.content || '').trim();
    if (content) return content;
    if (pin.attachments && pin.attachments.length) return i18n.attachment || 'Attachment';
    return '';
}

function renderPinnedBar() {
    const bar = DOM.pinnedBar;
    if (!bar) return;
    if (!currentPins.length) {
        hidePinnedBar();
        return;
    }
    if (pinIndex < 0) pinIndex = currentPins.length - 1;
    if (pinIndex >= currentPins.length) pinIndex = 0;
    const pin = currentPins[pinIndex];
    bar.dataset.messageId = String(pin.message_id);
    DOM.pinnedBarSender.textContent = senderLabel(pin);
    DOM.pinnedBarPreview.textContent = previewText(pin);
    const multiple = currentPins.length > 1;
    DOM.pinnedBarCounter.textContent = multiple ? `${pinIndex + 1}/${currentPins.length}` : '';
    DOM.pinnedBarCounter.classList.toggle('is-hidden', !multiple);
    DOM.pinnedBarPrev.classList.toggle('is-hidden', !multiple);
    DOM.pinnedBarNext.classList.toggle('is-hidden', !multiple);
    bar.classList.remove('is-hidden');
    updatePinnedBarControls();
}

export function updatePinnedBarControls() {
    if (!DOM.pinnedBar || DOM.pinnedBar.classList.contains('is-hidden')) return;
    DOM.pinnedBarClose.classList.toggle('is-hidden', !canManagePins());
}

function cyclePin(delta) {
    if (currentPins.length < 2) return;
    pinIndex = (pinIndex + delta + currentPins.length) % currentPins.length;
    renderPinnedBar();
}

async function unpinCurrent() {
    const messageId = parseInt(DOM.pinnedBar && DOM.pinnedBar.dataset.messageId, 10);
    if (!Number.isFinite(messageId) || messageId <= 0) return;
    try {
        await API.unpinMessage(messageId);
        setMessagePinnedUI(messageId, false);
        currentPins = currentPins.filter(p => p.message_id !== messageId);
        pinIndex = 0;
        renderPinnedBar();
        showNotification(i18n.message_unpinned || 'Message unpinned');
    } catch (err) {
        showNotification((i18n.error_unpin_message || 'Failed to unpin message') + ': ' + err.message);
    }
}

export function initPinnedBar() {
    const bar = DOM.pinnedBar;
    if (!bar || bar.dataset.bound === '1') return;
    bar.dataset.bound = '1';
    bar.addEventListener('click', e => {
        if (e.target.closest('#pinned-bar-close') || e.target.closest('#pinned-bar-prev') || e.target.closest('#pinned-bar-next')) return;
        const messageId = parseInt(bar.dataset.messageId, 10);
        if (Number.isFinite(messageId) && messageId > 0) scrollToMessage(messageId);
    });
    DOM.pinnedBarPrev.addEventListener('click', e => {
        e.stopPropagation();
        cyclePin(-1);
    });
    DOM.pinnedBarNext.addEventListener('click', e => {
        e.stopPropagation();
        cyclePin(1);
    });
    DOM.pinnedBarClose.addEventListener('click', e => {
        e.stopPropagation();
        unpinCurrent();
    });
}
