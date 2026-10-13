import { STATE } from '../state.js';
import { DOM, i18n } from '../dom.js';
import { formatRelativeTime, formatLastMessageText, formatSystemEvent, localizedError, createVerifiedBadge, t } from '../format.js';
import { showConfirm, showNotification } from '../dialogs.js';
import * as API from '../api.js';
import { animateRemoval } from './scroll.js';
import { createMsgChecks, setMsgChecksRead } from '../../core_chat/checks.js';
import { updateChatUI, updateChatOnlineStatus } from './onlineStatus.js';
import { abortPendingLoads } from '../chatMessages.js';
import { updateBlockedButton } from '../chatList.js';
import { closeWs } from '../websocket.js';
import { isChatMuted, createMuteIcon, buildMuteMenuLink, openMuteModal, unmuteChatById } from '../muteModal.js';
import { isChatPinned, createPinIcon, buildPinMenuLink, toggleChatPin } from '../pinChat.js';
import { buildFolderMenuLinks, isPinnedInActiveFolder, addChatToFolderById, removeChatFromFolderById, togglePinInActiveFolder } from '../folders.js';
import { createMenuLink } from './menuLink.js';
import { hidePinnedBar } from './pinnedBar.js';
import { isContactNow, addContactFromChat, removeContactFromChat, contactNickname } from '../contacts.js';

const CHAT_TYPE_ICONS = {
    direct: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    channel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
};

function lastMessagePreview(chat) {
    let text = chat.last_message || '';
    const isSystem = !!chat.last_message_system;
    let isAttachment = false;
    if (isSystem) {
        text = formatSystemEvent(chat.last_message_system);
    } else if (text === '' && chat.last_message_time) {
        isAttachment = true;
        text = i18n.attachment || 'Attachment';
    }
    text = formatLastMessageText(text) || '';
    const isMine = !isSystem && chat.type !== 'channel' && !!chat.last_message_is_mine;
    let senderLabel = null;
    if (!isSystem && chat.type === 'group') {
        senderLabel = isMine
            ? t('last_msg_you', 'You')
            : (contactNickname(chat.last_message_sender_id) || chat.last_message_sender_name || null);
    }
    return { text, isSystem, isAttachment, isMine, isRead: !!chat.last_message_read, senderLabel };
}

function renderLastMessageInto(wrapper, chat) {
    if (!wrapper || !chat) return;
    const lastMsgEl = wrapper.querySelector('.last-msg');
    if (!lastMsgEl) return;
    const preview = lastMessagePreview(chat);
    lastMsgEl.classList.toggle('system-preview', preview.isSystem);
    lastMsgEl.classList.toggle('attachment', preview.isAttachment);
    lastMsgEl.textContent = '';
    if (preview.senderLabel) {
        const senderSpan = document.createElement('span');
        senderSpan.className = 'last-msg-sender';
        senderSpan.textContent = preview.senderLabel + ': ';
        lastMsgEl.appendChild(senderSpan);
    }
    lastMsgEl.appendChild(document.createTextNode(preview.text));

    let checksEl = wrapper.querySelector('.last-msg-checks');
    if (preview.isMine) {
        if (!checksEl) {
            checksEl = createMsgChecks(preview.isRead);
            checksEl.classList.add('last-msg-checks');
            wrapper.insertBefore(checksEl, wrapper.firstChild);
        } else {
            setMsgChecksRead(checksEl, preview.isRead);
        }
    } else if (checksEl) {
        checksEl.remove();
    }
}

export function updateChatItemLastMessage(chatId) {
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!item) return;
    renderLastMessageInto(item.querySelector('.last-msg-wrapper'), STATE.chatsMap[chatId]);
}

export function markChatItemLastMessageRead(chatId) {
    const chat = STATE.chatsMap[chatId];
    if (!chat || !chat.last_message_is_mine) return;
    chat.last_message_read = true;
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!item) return;
    const checksEl = item.querySelector('.last-msg-checks');
    if (checksEl) setMsgChecksRead(checksEl, true);
}

export function syncLastMessageMeta(chatData, msg) {
    if (!chatData || !msg) return;
    const isSystem = !!msg.is_system;
    chatData.last_message = msg.content;
    chatData.last_message_time = msg.created_at;
    chatData.last_message_system = isSystem ? (msg.system || null) : null;
    chatData.last_message_id = msg.id != null ? msg.id : null;
    if (isSystem || chatData.type === 'channel') {
        chatData.last_message_sender_id = null;
        chatData.last_message_sender_name = null;
        chatData.last_message_is_mine = false;
        chatData.last_message_read = false;
        return;
    }
    const fullName = [msg.sender_first_name, msg.sender_last_name]
        .filter(x => x && String(x).trim())
        .join(' ')
        .trim();
    chatData.last_message_sender_id = msg.sender_id != null ? msg.sender_id : null;
    chatData.last_message_sender_name = fullName || msg.sender_username || null;
    chatData.last_message_is_mine = msg.sender_id != null && msg.sender_id === STATE.currentUserId;
    chatData.last_message_read = chatData.last_message_is_mine ? !!msg.is_read : false;
}

export function closeChatDropdown(dropdown) {
    if (!dropdown) return;
    dropdown.querySelectorAll('.chat-folder-submenu-wrap.is-open').forEach(w => w.classList.remove('is-open'));
    dropdown.style.display = 'none';
    dropdown.style.top = '';
    dropdown.style.left = '';
    dropdown.style.right = '';
    dropdown.style.position = '';
    dropdown.style.zIndex = '';
    if (dropdown._originalParent && dropdown.parentNode !== dropdown._originalParent) {
        dropdown._originalParent.appendChild(dropdown);
    }
    if (dropdown._item) dropdown._item.classList.remove('menu-open');
    if (STATE.openDropdown === dropdown) STATE.openDropdown = null;
    document.removeEventListener('scroll', _repositionAnyChatDropdown, true);
    window.removeEventListener('resize', _repositionAnyChatDropdown);
    document.removeEventListener('scroll', _closeAnyChatDropdown, true);
    window.removeEventListener('resize', _closeAnyChatDropdown);
}

function _closeAnyChatDropdown() {
    if (STATE.openDropdown && STATE.openDropdown._isChatDropdown) {
        closeChatDropdown(STATE.openDropdown);
    }
}

let _dropdownScrollTick = false;

function _repositionAnyChatDropdown() {
    const dropdown = STATE.openDropdown;
    if (!dropdown || !dropdown._isChatDropdown) return;
    const button = dropdown._menuBtn;
    if (!button || !document.body.contains(button)) {
        closeChatDropdown(dropdown);
        return;
    }
    const rect = button.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
        closeChatDropdown(dropdown);
        return;
    }
    if (_dropdownScrollTick) return;
    _dropdownScrollTick = true;
    requestAnimationFrame(() => {
        _dropdownScrollTick = false;
        const current = STATE.openDropdown;
        if (!current || current._isChatDropdown !== true || !current._menuBtn) return;
        positionChatDropdown(current, current._menuBtn);
    });
}

function refreshFolderLinks(dropdown, item) {
    const chatId = parseInt(item.dataset.chatId, 10);
    const chat = STATE.chatsMap[chatId];
    if (!chat) return;
    dropdown.querySelectorAll('.chat-folder-submenu-wrap, a[data-action="pinInFolder"], a[data-action="unpinInFolder"]').forEach(el => el.remove());
    buildFolderMenuLinks(chat).forEach(link => dropdown.appendChild(link));
}

function positionChatDropdown(dropdown, button) {
    const w = dropdown.offsetWidth;
    const h = dropdown.offsetHeight;
    const rect = button.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.right - w;
    if (top + h > window.innerHeight - 8) {
        top = Math.max(8, rect.top - h - 4);
    }
    if (left < 8) left = 8;
    if (left + w > window.innerWidth - 8) {
        left = window.innerWidth - w - 8;
    }
    dropdown.style.top = top + 'px';
    dropdown.style.left = left + 'px';
}

function openChatDropdown(dropdown, button, item) {
    refreshFolderLinks(dropdown, item);
    dropdown._originalParent = dropdown.parentNode;
    dropdown._isChatDropdown = true;
    dropdown._menuBtn = button;
    document.body.appendChild(dropdown);
    dropdown.style.position = 'fixed';
    dropdown.style.right = 'auto';
    dropdown.style.zIndex = '2000';
    dropdown.style.display = 'block';
    dropdown.style.visibility = 'hidden';
    positionChatDropdown(dropdown, button);
    dropdown.style.visibility = '';
    item.classList.add('menu-open');
    STATE.openDropdown = dropdown;
    document.addEventListener('scroll', _repositionAnyChatDropdown, true);
    window.addEventListener('resize', _repositionAnyChatDropdown);
}

export function closeAnyOpenDropdown() {
    const current = STATE.openDropdown;
    if (!current) return;
    if (current._isChatDropdown) {
        closeChatDropdown(current);
        return;
    }
    if (current === DOM.createChatMenu) {
        current.style.display = 'none';
        current.classList.remove('show');
        STATE.openDropdown = null;
    }
}

export function createChatItem(chat) {
    const item = document.createElement('div');
    item.className = 'chat-item';
    const pinnedHere = isChatPinned(chat) || isPinnedInActiveFolder(chat.id);
    if (pinnedHere) item.classList.add('pinned');
    item.dataset.chatId = chat.id;
    item.dataset.type = chat.type;
    if (chat.type === 'direct' && chat.other_user_id) item.dataset.otherUserId = chat.other_user_id;

    const nickname = chat.type === 'direct' ? contactNickname(chat.other_user_id) : null;
    const listDisplayName = nickname || chat.name;
    const avatarText = listDisplayName ? listDisplayName[0].toUpperCase() : '?';
    let avatarElement;
    if (chat.avatar) {
        const img = document.createElement('img');
        img.className = 'avatar-img';
        img.src = chat.avatar;
        img.alt = 'avatar';
        avatarElement = img;
    } else {
        const div = document.createElement('div');
        div.className = 'avatar';
        div.textContent = avatarText;
        avatarElement = div;
    }

    const avatarWrapper = document.createElement('div');
    avatarWrapper.className = 'avatar-wrapper';
    avatarWrapper.appendChild(avatarElement);
    if (chat.type === 'direct' && chat.other_user_online && !chat.other_user_is_service) {
        const dot = document.createElement('span');
        dot.className = 'online-dot';
        avatarWrapper.appendChild(dot);
    }
    item.appendChild(avatarWrapper);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'name';
    const typeIcon = document.createElement('span');
    typeIcon.className = 'chat-type-icon';
    typeIcon.innerHTML = CHAT_TYPE_ICONS[chat.type] || CHAT_TYPE_ICONS.direct;
    const nameText = document.createElement('span');
    nameText.className = 'name-text';
    nameText.textContent = listDisplayName;
    nameDiv.appendChild(typeIcon);
    nameDiv.appendChild(nameText);
    if (chat.other_user_is_service) nameDiv.appendChild(createVerifiedBadge());
    else if (chat.other_user_is_admin) nameDiv.appendChild(createVerifiedBadge('staff'));
    infoDiv.appendChild(nameDiv);

    const wrapperDiv = document.createElement('div');
    wrapperDiv.className = 'last-msg-wrapper';
    const lastMsgDiv = document.createElement('div');
    lastMsgDiv.className = 'last-msg';
    wrapperDiv.appendChild(lastMsgDiv);
    renderLastMessageInto(wrapperDiv, chat);
    const muted = isChatMuted(chat);
    if (muted) wrapperDiv.appendChild(createMuteIcon());
    if (pinnedHere) wrapperDiv.appendChild(createPinIcon());
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = chat.last_message_time ? formatRelativeTime(chat.last_message_time) : '';
    wrapperDiv.appendChild(timeSpan);
    infoDiv.appendChild(wrapperDiv);
    item.appendChild(infoDiv);

    if (chat.unread_count > 0) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        if (muted) badge.classList.add('muted');
        badge.textContent = chat.unread_count;
        item.appendChild(badge);
    }

    if (chat.last_mentions_me && (chat.unread_count || 0) > 0) {
        const mentionBadge = document.createElement('span');
        mentionBadge.className = 'mention-badge';
        mentionBadge.textContent = '@';
        mentionBadge.title = i18n.mentions_you || 'You were mentioned';
        item.appendChild(mentionBadge);
    }

    const menuContainer = document.createElement('div');
    menuContainer.className = 'chat-item-menu';
    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-btn';
    menuBtn.type = 'button';
    menuBtn.innerHTML = '⋮';
    menuBtn.title = i18n.more || 'More';
    menuBtn.setAttribute('aria-label', 'Chat actions');
    menuContainer.appendChild(menuBtn);

    const dropdown = document.createElement('div');
    dropdown.className = 'chat-item-dropdown';
    dropdown.appendChild(buildPinMenuLink(chat));
    dropdown.appendChild(buildMuteMenuLink(chat));
    buildFolderMenuLinks(chat).forEach(link => dropdown.appendChild(link));

    if (chat.type === 'channel') {
        if (chat.is_owner) {
            dropdown.appendChild(createMenuLink('deleteChannel', i18n.delete_channel || 'Delete channel', 'trash', true));
        } else {
            dropdown.appendChild(createMenuLink('unsubscribeChannel', i18n.unsubscribe || 'Unsubscribe', 'logout', true));
        }
    } else if (chat.type === 'group') {
        if (chat.is_owner) {
            dropdown.appendChild(createMenuLink('deleteGroup', i18n.delete_group || 'Delete group', 'trash', true));
        } else {
            dropdown.appendChild(createMenuLink('leaveGroup', i18n.leave_group || 'Leave group', 'logout', true));
        }
    } else {
        const isService = !!chat.other_user_is_service;
        if (!isService) {
            const inContacts = chat.other_user_id ? isContactNow(chat.other_user_id) : false;
            dropdown.appendChild(createMenuLink(
                inContacts ? 'removeFromContacts' : 'addToContacts',
                inContacts
                    ? (i18n.remove_from_contacts || 'Remove from contacts')
                    : (i18n.add_to_contacts || 'Add to contacts'),
                inContacts ? 'userMinus' : 'userPlus'
            ));
        }
        dropdown.appendChild(createMenuLink('hideChat', i18n.hide_chat || 'Hide chat', 'eyeOff'));
        if (!isService) {
            dropdown.appendChild(createMenuLink('blockUser', i18n.block_user || 'Block user', 'ban', true));
        }
    }

    menuContainer.appendChild(dropdown);
    item.appendChild(menuContainer);

    dropdown._item = item;
    dropdown._menuBtn = menuBtn;

    menuBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (STATE.openDropdown === dropdown) {
            closeChatDropdown(dropdown);
            return;
        }
        closeAnyOpenDropdown();
        openChatDropdown(dropdown, menuBtn, item);
    });

    dropdown.addEventListener('click', e => {
        e.stopPropagation();
        const target = e.target.closest('a');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'toggleFolderSubmenu') {
            e.preventDefault();
            const wrap = target.closest('.chat-folder-submenu-wrap');
            if (wrap) wrap.classList.toggle('is-open');
            return;
        }
        closeChatDropdown(dropdown);
        if (action === 'pinChat' || action === 'unpinChat') toggleChatPin(chat.id);
        else if (action === 'muteChat') openMuteModal(chat);
        else if (action === 'unmuteChat') unmuteChatById(chat.id);
        else if (action === 'addToFolder') addChatToFolderById(parseInt(target.dataset.folderId, 10), chat.id);
        else if (action === 'removeFromFolder') removeChatFromFolderById(parseInt(target.dataset.folderId, 10), chat.id);
        else if (action === 'pinInFolder' || action === 'unpinInFolder') togglePinInActiveFolder(chat.id);
        else if (action === 'hideChat') handleHideChat(chat);
        else if (action === 'blockUser') handleBlockUser(chat);
        else if (action === 'deleteGroup') handleDeleteGroup(chat);
        else if (action === 'leaveGroup') handleLeaveGroup(chat);
        else if (action === 'deleteChannel') handleDeleteChannel(chat);
        else if (action === 'unsubscribeChannel') handleUnsubscribeChannel(chat);
        else if (action === 'addToContacts') addContactFromChat(chat);
        else if (action === 'removeFromContacts') removeContactFromChat(chat);
    });

    return item;
}

export function updateMentionBadge(chatId, show) {
    const chatData = STATE.chatsMap[chatId];
    if (chatData) chatData.last_mentions_me = !!show;
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!item) return;
    const existing = item.querySelector('.mention-badge');
    if (!show) {
        if (existing) existing.remove();
        return;
    }
    if (existing) return;
    const badge = document.createElement('span');
    badge.className = 'mention-badge';
    badge.textContent = '@';
    badge.title = i18n.mentions_you || 'You were mentioned';
    const menu = item.querySelector('.chat-item-menu');
    if (menu) item.insertBefore(badge, menu);
    else item.appendChild(badge);
}

function removeChat(chat) {
    const item = document.querySelector(`.chat-item[data-chat-id="${chat.id}"]`);
    const wasCurrent = STATE.currentChatId === chat.id;

    if (STATE.openDropdown && STATE.openDropdown._isChatDropdown && STATE.openDropdown._item === item) {
        closeChatDropdown(STATE.openDropdown);
    }

    delete STATE.chatsMap[chat.id];
    delete STATE.unreadCounts[chat.id];
    STATE._justReadIds.delete(chat.id);
    if (STATE.typingUsers[chat.id]) delete STATE.typingUsers[chat.id];
    if (STATE._typingTimers[chat.id]) {
        Object.values(STATE._typingTimers[chat.id]).forEach(t => clearTimeout(t));
        delete STATE._typingTimers[chat.id];
    }

    if (item) animateRemoval(item);

    if (wasCurrent) {
        abortPendingLoads();
        STATE.currentChatId = null;
        STATE.currentChatType = null;
        STATE.currentPermissions = {};
        STATE.isLoading = false;
        hidePinnedBar();
        DOM.chatNameSpan.textContent = i18n.select_chat || 'Select a chat';
        DOM.messagesContainer.innerHTML = `<div class="empty-state">${i18n.select_chat_prompt || 'Select a chat to start messaging'}</div>`;
        DOM.inputArea.classList.add('is-hidden');
        DOM.chatTyping.classList.add('is-hidden');
        DOM.chatTyping.textContent = '';
        closeWs();
        updateChatUI(null, null);
        updateChatOnlineStatus(null, false);
    }
    let total = 0;
    for (const id of Object.keys(STATE.unreadCounts)) {
        if (isChatMuted(STATE.chatsMap[id])) continue;
        total += STATE.unreadCounts[id] || 0;
    }
    const siteTitle = (window.i18n && window.i18n.site_title) || 'Jan Messenger';
    document.title = total > 0 ? `(${total}) ${siteTitle}` : siteTitle;
}

async function handleHideChat(chat) {
    if (!await showConfirm(i18n.confirm_hide_chat || 'Are you sure you want to hide this chat?')) return;
    try {
        await API.hideChat(chat.id);
        removeChat(chat);
    } catch (err) {
        showNotification((i18n.error || 'Error') + ': ' + err.message);
    }
}

async function handleBlockUser(chat) {
    if (!await showConfirm(i18n.confirm_block_user || 'Are you sure you want to block this user?')) return;
    try {
        await API.blockUser(chat.other_user_id);
        await API.hideChat(chat.id);
        showNotification(i18n.user_blocked || 'User blocked');
        removeChat(chat);
        updateBlockedButton();
    } catch (err) {
        showNotification(localizedError(err));
    }
}

async function handleDeleteGroup(chat) {
    if (!await showConfirm(i18n.confirm_delete_group || 'Are you sure you want to delete this group?')) return;
    try {
        await API.deleteChat(chat.id);
        removeChat(chat);
    } catch (err) {
        showNotification((i18n.error || 'Error') + ': ' + err.message);
    }
}

async function handleLeaveGroup(chat) {
    if (!await showConfirm(i18n.confirm_leave_group || 'Are you sure you want to leave this group?')) return;
    try {
        await API.leaveGroup(chat.id);
        removeChat(chat);
    } catch (err) {
        showNotification((i18n.error || 'Error') + ': ' + err.message);
    }
}

async function handleDeleteChannel(chat) {
    if (!await showConfirm(i18n.delete_channel_confirm || 'Delete this channel? This cannot be undone.')) return;
    try {
        await API.deleteChannel(chat.id);
        removeChat(chat);
    } catch (err) {
        showNotification((i18n.error || 'Error') + ': ' + err.message);
    }
}

async function handleUnsubscribeChannel(chat) {
    try {
        await API.unsubscribeFromChannel(chat.id);
        removeChat(chat);
        showNotification(i18n.unsubscribed || 'Unsubscribed');
    } catch (err) {
        showNotification((i18n.error || 'Error') + ': ' + err.message);
    }
}
