import { STATE } from '../state.js';
import { DOM } from '../dom.js';
import { formatLastSeen, pluralT } from '../format.js';
import * as API from '../api.js';

let _statsDebounceTimer = null;

export function renderGroupMembersCount(chatId) {
    const el = DOM.chatMembersCount;
    if (!el) return;
    const chatData = chatId ? STATE.chatsMap[chatId] : null;
    const isCurrentGroup = !!chatData
        && chatData.type === 'group'
        && chatId === STATE.currentChatId;
    if (!isCurrentGroup || chatData.members_count == null) {
        el.classList.add('is-hidden');
        el.textContent = '';
        return;
    }
    el.textContent = '';
    const total = document.createElement('span');
    total.className = 'members-total';
    total.textContent = pluralT('members_count', chatData.members_count, `${chatData.members_count} members`);
    el.appendChild(total);
    if (chatData.online_members_count != null) {
        const sep = document.createElement('span');
        sep.className = 'members-sep';
        sep.textContent = '·';
        el.appendChild(sep);
        const online = document.createElement('span');
        online.className = 'members-online';
        online.textContent = pluralT('online_count', chatData.online_members_count, `${chatData.online_members_count} online`);
        el.appendChild(online);
    }
    el.classList.remove('is-hidden');
}

export async function fetchGroupMembersCount(chatId) {
    if (!chatId) return;
    const chatData = STATE.chatsMap[chatId];
    if (!chatData || chatData.type !== 'group') return;
    try {
        const stats = await API.getChatStats(chatId);
        const current = STATE.chatsMap[chatId];
        if (!current) return;
        current.members_count = stats.members_count;
        current.online_members_count = stats.online_count;
        if (chatId === STATE.currentChatId) renderGroupMembersCount(chatId);
    } catch (err) {
        console.warn('Failed to load chat stats:', err);
    }
}

export function refreshGroupMembersCount(chatId, debounceMs = 0) {
    if (!chatId) return;
    const chatData = STATE.chatsMap[chatId];
    if (!chatData || chatData.type !== 'group') {
        renderGroupMembersCount(chatId);
        return;
    }
    if (debounceMs > 0) {
        if (_statsDebounceTimer) clearTimeout(_statsDebounceTimer);
        _statsDebounceTimer = setTimeout(() => {
            _statsDebounceTimer = null;
            fetchGroupMembersCount(chatId);
        }, debounceMs);
        return;
    }
    if (_statsDebounceTimer) {
        clearTimeout(_statsDebounceTimer);
        _statsDebounceTimer = null;
    }
    fetchGroupMembersCount(chatId);
}

export function updateChatOnlineStatus(chatId, isOnline) {
    const chatData = STATE.chatsMap[chatId];
    const isDirect = chatData && chatData.type === 'direct';
    const isServiceDirect = !!(chatData && chatData.other_user_is_service);

    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (chatItem) {
        const wrapper = chatItem.querySelector('.avatar-wrapper');
        if (wrapper) {
            let dot = wrapper.querySelector('.online-dot');
            if (isDirect && isOnline && !isServiceDirect) {
                if (!dot) { dot = document.createElement('span'); dot.className = 'online-dot'; wrapper.appendChild(dot); }
            } else if (dot) dot.remove();
        }
    }

    renderGroupMembersCount(chatId);

    const statusEl = document.getElementById('chat-online-status');
    if (!statusEl) return;
    if (!chatId || chatId !== STATE.currentChatId || !isDirect || isServiceDirect) {
        statusEl.classList.add('is-hidden');
        statusEl.classList.remove('last-seen-mode');
        statusEl.textContent = '';
        return;
    }
    statusEl.classList.remove('is-hidden');
    if (isOnline) {
        statusEl.classList.remove('last-seen-mode');
        statusEl.textContent = '';
    } else {
        statusEl.classList.add('last-seen-mode');
        statusEl.textContent = formatLastSeen(chatData.other_user_last_seen);
    }
}

export function updateChatUI(chatType, permissions) {
    const perms = permissions || {};
    const isGroup = chatType === 'group';
    const isChannel = chatType === 'channel';
    const canOpenSettings = (isGroup || isChannel) && !!perms.open_settings;
    if (canOpenSettings) {
        DOM.settingsBtn.classList.remove('is-hidden');
    } else {
        DOM.settingsBtn.classList.add('is-hidden');
    }
    if (chatType) {
        DOM.searchMsgBtn.classList.remove('is-hidden');
    } else {
        DOM.searchMsgBtn.classList.add('is-hidden');
    }
    const addMemberArea = document.getElementById('settings-add-member-area');
    if (addMemberArea) addMemberArea.classList.toggle('is-hidden', !(isGroup && !!perms.add_members));
    if (isChannel && DOM.inputArea) {
        if (perms.post_messages) DOM.inputArea.classList.remove('is-hidden');
        else DOM.inputArea.classList.add('is-hidden');
    }
    const chatData = STATE.currentChatId ? STATE.chatsMap[STATE.currentChatId] : null;
    if (DOM.inputArea && chatData && chatData.type === 'direct' && chatData.other_user_is_service) {
        DOM.inputArea.classList.add('is-hidden');
    }
    if (DOM.voiceCallBtn) {
        const isDirectHuman = chatType === 'direct' && !(chatData && chatData.other_user_is_service);
        DOM.voiceCallBtn.classList.toggle('is-hidden', !isDirectHuman);
    }
    if (DOM.groupVoiceBtn) {
        DOM.groupVoiceBtn.classList.toggle('is-hidden', !isGroup);
    }
    if (!isGroup && DOM.groupVoiceBar) {
        DOM.groupVoiceBar.classList.add('is-hidden');
    }
}
