import { STATE } from './state.js';
import { DOM, i18n } from './dom.js';
import { isMyMessage, renderMessageContent } from './format.js';
import { renderAttachments, setMessagePinnedUI } from './ui/message.js';
import { createMsgChecks, setMsgChecksRead } from '../core_chat/checks.js';
import * as UI from './ui/onlineStatus.js';
import { showNotification, showLinkConfirm } from './dialogs.js';
import * as API from './api.js';
import {
    updateChatBadge,
    updateDocumentTitle,
    updateChatItemTime,
    updateChatLastMessage,
    updateChatActions,
    loadChats,
    addChatToList,
    renderChatHeaderName,
    markChatRead,
    moveChatItemToTop,
} from './chatList.js';
import { appendMessage, updateTyping, showToast, abortPendingLoads } from './chatMessages.js';
import { closeWs } from './websocket.js';
import { animateRemoval } from './ui/scroll.js';
import { closeChatDropdown, updateMentionBadge, syncLastMessageMeta, updateChatItemLastMessage, markChatItemLastMessageRead } from './ui/chatItem.js';
import { handleContactStatus, contactNickname } from './contacts.js';
import { invalidateMentionMembers } from './handlers/mentions.js';
import { handleChatMuteUpdated, isChatMuted } from './muteModal.js';
import { handleChatPinUpdated } from './pinChat.js';
import { handleFoldersUpdated } from './folders.js';
import { refreshPinnedBar, hidePinnedBar } from './ui/pinnedBar.js';
import { handleIncomingCallEvent, handleCallStartedEvent, handleCallEndedEvent } from './voice_call/ui.js';
import { handleGroupVoiceUpdate, handleGroupVoiceEnded } from './group_voice/ui.js';
import { notifyMessage, isDesktopBackground } from '../desktop/notify.js';

const _pendingChatFetches = new Set();

function applyLastMessageToItem(chatId, msg) {
    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!chatItem) return;
    const chatData = STATE.chatsMap[chatId];
    if (chatData && msg) syncLastMessageMeta(chatData, msg);
    updateChatItemLastMessage(chatId);
    moveChatItemToTop(chatId);
    updateChatItemTime(chatId);
}

export function handleWsMessage(data) {
    if (STATE.currentChatType === 'channel' && (data.type === 'typing' || data.type === 'members_updated')) return;
    switch (data.type) {
        case 'typing': updateTyping(data.user_id, data.is_typing, data.chat_id, data.username); break;
        case 'message_edited': handleMessageEdited(data.data); break;
        case 'message_deleted': handleMessageDeleted(data.data); break;
        case 'chat_updated': handleChatUpdated(data.data); break;
        case 'chat_deleted': handleChatDeleted(data.data); break;
        case 'chat_removed': handleChatRemoved(data.data); break;
        case 'members_updated': showNotification('Chat members have been updated.'); invalidateMentionMembers(STATE.currentChatId); if (STATE.currentChatId) { updateChatActions(STATE.currentChatId); UI.refreshGroupMembersCount(STATE.currentChatId); } break;
        case 'media_added': handleMediaAdded(data.data); break;
        case 'rate_limited':
            if (data.action === 'mark_read' && data.retry_via === 'rest') {
                const chatId = STATE.currentChatId;
                if (chatId) {
                    API.markChatRead(chatId).catch(() => {});
                }
            }
            break;
        default: console.log('Unknown ws message', data);
    }
}

function handleMessageEdited(payload) {
    const editedMsg = document.querySelector(`.message[data-msg-id="${payload.id}"]`);
    if (editedMsg) {
        renderMessageContent(editedMsg.querySelector('.content'), payload.content, showLinkConfirm);
        if (!editedMsg.querySelector('.edited')) {
            const timeDiv = editedMsg.querySelector('.time');
            if (timeDiv) {
                const editedDiv = document.createElement('span');
                editedDiv.className = 'edited';
                editedDiv.textContent = i18n.edited || 'edited';
                timeDiv.prepend(editedDiv);
            }
        }
    }
    const allMessages = DOM.messagesContainer.querySelectorAll('.message');
    const lastEl = allMessages[allMessages.length - 1];
    if (lastEl && parseInt(lastEl.dataset.msgId, 10) === payload.id) {
        const chatData = STATE.chatsMap[STATE.currentChatId];
        if (chatData) {
            chatData.last_message = payload.content;
            chatData.last_message_time = new Date().toISOString();
        }
        updateChatItemLastMessage(STATE.currentChatId);
    }
}

function handleMessageDeleted(payload) {
    const delMsg = document.querySelector(`.message[data-msg-id="${payload.id}"]`);
    if (delMsg) {
        const contentDiv = delMsg.querySelector('.content');
        if (contentDiv) {
            contentDiv.innerHTML = '';
            const em = document.createElement('em');
            em.textContent = i18n.message_deleted || 'Message deleted';
            contentDiv.appendChild(em);
        }
        ['delete-btn', 'reply-btn', 'edit-btn'].forEach(cls => {
            const el = delMsg.querySelector('.' + cls);
            if (el) el.remove();
        });
        const allMessages = DOM.messagesContainer.querySelectorAll('.message');
        const lastEl = allMessages[allMessages.length - 1];
        if (lastEl && parseInt(lastEl.dataset.msgId, 10) === payload.id) {
            updateChatLastMessage(STATE.currentChatId);
        }
    } else {
        updateChatLastMessage(STATE.currentChatId);
    }
}

function handleChatUpdated(payload) {
    if (payload.name) {
        const chat = STATE.chatsMap[STATE.currentChatId];
        const nickname = chat && chat.type === 'direct' ? contactNickname(chat.other_user_id) : null;
        const display = nickname || payload.name;
        if (chat) chat.name = payload.name;
        renderChatHeaderName(chat, display);
        const item = document.querySelector(`.chat-item[data-chat-id="${STATE.currentChatId}"] .name-text`);
        if (item) item.textContent = display;
    }
    if (payload.avatar) {
        const avatarImg = document.querySelector(`.chat-item[data-chat-id="${STATE.currentChatId}"] .avatar-img`);
        if (avatarImg) avatarImg.src = payload.avatar;
    }
}

function handleChatDeleted(payload) {
    const deletedId = payload.id;
    const wasCurrent = STATE.currentChatId === deletedId;
    const deletedItem = document.querySelector(`.chat-item[data-chat-id="${deletedId}"]`);

    if (STATE.openDropdown && STATE.openDropdown._isChatDropdown && STATE.openDropdown._item === deletedItem) {
        closeChatDropdown(STATE.openDropdown);
    }

    delete STATE.chatsMap[deletedId];
    delete STATE.unreadCounts[deletedId];
    delete STATE.pendingSends[deletedId];
    STATE._justReadIds.delete(deletedId);

    if (STATE.typingUsers[deletedId]) delete STATE.typingUsers[deletedId];
    if (STATE._typingTimers[deletedId]) {
        Object.values(STATE._typingTimers[deletedId]).forEach(t => clearTimeout(t));
        delete STATE._typingTimers[deletedId];
    }

    if (deletedItem) animateRemoval(deletedItem);

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
        UI.updateChatUI(null, null);
        UI.updateChatOnlineStatus(null, false);
    }
    updateDocumentTitle();
}

function handleChatRemoved(payload) {
    if (!payload || !payload.id) return;
    const chat = STATE.chatsMap[payload.id];
    const isChannel = !!(chat && chat.type === 'channel');
    handleChatDeleted(payload);
    if (payload.reason === 'kicked') {
        showToast(isChannel
            ? (i18n.removed_from_channel || 'You were removed from the channel')
            : (i18n.removed_from_group || 'You were removed from the group'));
    }
}

function handleMediaAdded(payload) {
    const msgElement = document.querySelector(`.message[data-msg-id="${payload.message_id}"]`);
    if (!msgElement) return;
    let attachmentsDiv = msgElement.querySelector('.attachments');
    if (!attachmentsDiv) {
        attachmentsDiv = document.createElement('div');
        attachmentsDiv.className = 'attachments';
        const contentDiv = msgElement.querySelector('.content');
        contentDiv.insertAdjacentElement('afterend', attachmentsDiv);
    }
    renderAttachments(attachmentsDiv, payload.attachments || []);
}

function handleMessagePinned(payload) {
    if (!payload || !payload.message_id) return;
    setMessagePinnedUI(payload.message_id, true);
    if (STATE.currentChatId && (!payload.chat_id || payload.chat_id === STATE.currentChatId)) {
        refreshPinnedBar(STATE.currentChatId);
    }
}

function handleMessageUnpinned(payload) {
    if (!payload || !payload.message_id) return;
    setMessagePinnedUI(payload.message_id, false);
    if (STATE.currentChatId && (!payload.chat_id || payload.chat_id === STATE.currentChatId)) {
        refreshPinnedBar(STATE.currentChatId);
    }
}

export function handleGlobalWsMessage(data) {
    switch (data.type) {
        case 'global_new_message': handleGlobalNewMessage(data.data); break;
        case 'chat_added': handleChatAdded(data.data); break;
        case 'chat_updated': handleChatMetadataUpdate(data.data); break;
        case 'members_updated': handleChatMembersUpdate(data.data); break;
        case 'chat_deleted': handleChatDeleted(data.data); break;
        case 'chat_mute_updated': handleChatMuteUpdated(data.data); break;
        case 'chat_pin_updated': handleChatPinUpdated(data.data); break;
        case 'chat_folders_updated': handleFoldersUpdated(); break;
        case 'message_pinned': handleMessagePinned(data.data); break;
        case 'message_unpinned': handleMessageUnpinned(data.data); break;
        case 'user_avatar_updated': handleUserAvatarUpdated(data.data); break;
        case 'user_status': handleUserStatus(data.data); break;
        case 'messages_read': handleMessagesRead(data); break;
        case 'channel_messages_read': handleChannelMessagesRead(data); break;
        case 'self_chat_read': handleSelfChatRead(data.data); break;
        case 'incoming_call': handleIncomingCallEvent(data.data); break;
        case 'call_started': handleCallStartedEvent(data.data); break;
        case 'call_ended': handleCallEndedEvent(data.data); break;
        case 'group_voice_update': handleGroupVoiceUpdate(data.data); break;
        case 'group_voice_ended': handleGroupVoiceEnded(data.data); break;
        default: console.log('Unknown global ws message', data);
    }
}

function handleSelfChatRead(payload) {
    const chatId = payload && payload.chat_id;
    if (!chatId) return;
    if (chatId === STATE.currentChatId) return;
    markChatRead(chatId);
}

function handleChatMetadataUpdate(payload) {
    const chatId = payload.id ?? payload.chat_id;
    if (!chatId) return;
    const chat = STATE.chatsMap[chatId];
    if (chat) {
        if (payload.name) chat.name = payload.name;
        if (payload.avatar !== undefined) chat.avatar = payload.avatar;
        if (payload.description !== undefined) chat.description = payload.description;
    }
    const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (!item) return;
    if (payload.name) {
        const nickname = chat && chat.type === 'direct' ? contactNickname(chat.other_user_id) : null;
        const display = nickname || payload.name;
        const nameEl = item.querySelector('.name-text');
        if (nameEl) nameEl.textContent = display;
        if (chatId === STATE.currentChatId) renderChatHeaderName(chat, display);
    }
    if (payload.avatar) {
        const avatarWrapper = item.querySelector('.avatar-wrapper');
        if (avatarWrapper) {
            let img = avatarWrapper.querySelector('.avatar-img');
            if (img) {
                img.src = payload.avatar + '?t=' + Date.now();
            } else {
                const placeholder = avatarWrapper.querySelector('.avatar');
                if (placeholder) {
                    const newImg = document.createElement('img');
                    newImg.className = 'avatar-img';
                    newImg.src = payload.avatar + '?t=' + Date.now();
                    newImg.alt = 'avatar';
                    placeholder.replaceWith(newImg);
                }
            }
        }
    }
}

function handleChatMembersUpdate(payload) {
    const chatId = payload.chat_id ?? payload.id;
    if (!chatId) return;
    invalidateMentionMembers(chatId);
    if (chatId === STATE.currentChatId) {
        updateChatActions(chatId);
        UI.refreshGroupMembersCount(chatId);
    }
}

function handleChatAdded(chat) {
    if (!chat || !chat.id || STATE.chatsMap[chat.id]) return;
    addChatToList(chat);
    if (chat.other_user_is_service) return;
    showToast((i18n.added_to_chat || 'You were added to "{name}"').replace('{name}', chat.name || ''), {
        icon: '👥',
    });
}

async function handleGlobalNewMessage(msg) {
    const chatId = msg.chat_id;
    if (!chatId) return;

    const mine = isMyMessage(msg);
    const isSystem = !!msg.is_system;

    if (STATE.chatsMap[chatId]) {
        syncLastMessageMeta(STATE.chatsMap[chatId], msg);
    }

    if (chatId === STATE.currentChatId) {
        appendMessage(msg);
        applyLastMessageToItem(chatId, msg);
        return;
    }

    if (!mine && !isSystem) {
        STATE.unreadCounts[chatId] = (STATE.unreadCounts[chatId] || 0) + 1;
        STATE._justReadIds.delete(chatId);
        updateChatBadge(chatId);
        updateDocumentTitle();
        if (Array.isArray(msg.mention_ids) && msg.mention_ids.includes(STATE.currentUserId)) {
            updateMentionBadge(chatId, true);
        }
    }

    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (chatItem) {
        applyLastMessageToItem(chatId, msg);
    } else {
        if (_pendingChatFetches.has(chatId)) return;
        _pendingChatFetches.add(chatId);
        try {
            const chats = await API.fetchChats();
            const chat = chats.find(c => c.id === chatId);
            if (chat) {
                if (!mine && !isSystem) {
                    chat.unread_count = STATE.unreadCounts[chatId] || chat.unread_count || 0;
                } else {
                    chat.unread_count = STATE.unreadCounts[chatId] || 0;
                }
                addChatToList(chat);
            } else {
                loadChats(true);
            }
        } catch (err) {
            console.error('Failed to fetch chat metadata for new message:', err);
            loadChats(true);
        } finally {
            _pendingChatFetches.delete(chatId);
        }
    }

    if (!mine && !isSystem && !isChatMuted(STATE.chatsMap[chatId])) {
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

function handleUserAvatarUpdated(payload) {
    const { user_id, avatar_url } = payload;
    document.querySelectorAll(`.chat-item[data-type="direct"][data-other-user-id="${user_id}"]`).forEach(item => {
        const img = item.querySelector('.avatar-img');
        if (img) img.src = avatar_url + '?' + Date.now();
        else {
            const avatarDiv = item.querySelector('.avatar');
            if (avatarDiv) {
                const newImg = document.createElement('img');
                newImg.className = 'avatar-img';
                newImg.src = avatar_url + '?' + Date.now();
                newImg.alt = 'avatar';
                avatarDiv.replaceWith(newImg);
            }
        }
    });
    document.querySelectorAll(`.message-avatar[data-user-id="${user_id}"]`).forEach(avatarDiv => {
        const freshUrl = avatar_url + '?' + Date.now();
        const img = avatarDiv.querySelector('img');
        if (img) {
            img.src = freshUrl;
        } else {
            const newImg = document.createElement('img');
            newImg.src = freshUrl;
            newImg.alt = '';
            newImg.loading = 'lazy';
            const label = avatarDiv.title || avatarDiv.textContent || '?';
            newImg.addEventListener('error', () => {
                if (avatarDiv.querySelector('img') !== newImg) return;
                newImg.remove();
                avatarDiv.textContent = label.charAt(0).toUpperCase();
            }, { once: true });
            avatarDiv.textContent = '';
            avatarDiv.appendChild(newImg);
        }
    });
}

function handleUserStatus(payload) {
    const { user_id, status, last_seen } = payload;
    const isOnline = status === 'online';

    handleContactStatus(user_id, isOnline, last_seen);

    for (const chatId in STATE.chatsMap) {
        const chat = STATE.chatsMap[chatId];
        if (chat.type === 'direct' && chat.other_user_id === user_id) {
            chat.other_user_online = isOnline;
            if (!isOnline && last_seen) {
                chat.other_user_last_seen = last_seen;
            }
        }
    }

    document.querySelectorAll(
        `.chat-item[data-type="direct"][data-other-user-id="${user_id}"]`
    ).forEach(item => {
        const chatId = parseInt(item.dataset.chatId, 10);
        UI.updateChatOnlineStatus(chatId, isOnline);
    });

    if (STATE.currentChatId) {
        const current = STATE.chatsMap[STATE.currentChatId];
        if (current && current.type === 'direct' && current.other_user_id === user_id) {
            UI.updateChatOnlineStatus(STATE.currentChatId, isOnline);
        }
    }

    document.querySelectorAll(
        '#settings-members-list .member-item, #info-members-list li'
    ).forEach(el => {
        if (parseInt(el.dataset.userId, 10) === user_id) {
            const dot = el.querySelector('.member-online-dot');
            if (dot) dot.classList.toggle('is-hidden', !isOnline);
        }
    });

    if (STATE.currentChatId) {
        const currentChat = STATE.chatsMap[STATE.currentChatId];
        if (currentChat && currentChat.type === 'group') {
            UI.refreshGroupMembersCount(STATE.currentChatId, 700);
        }
    }
}

function handleMessagesRead(payload) {
    const { user_id, chat_id, message_ids } = payload;
    if (user_id === STATE.currentUserId) return;
    const chatData = STATE.chatsMap[chat_id];
    if (chatData && chatData.type === 'channel') return;

    const readIds = message_ids || [];
    if (
        chatData
        && chatData.last_message_is_mine
        && chatData.last_message_id != null
        && readIds.includes(chatData.last_message_id)
    ) {
        markChatItemLastMessageRead(chat_id);
    }

    if (chat_id !== STATE.currentChatId) return;

    readIds.forEach(id => {
        const msgElement = document.querySelector(`.message[data-msg-id="${id}"]`);
        if (!msgElement) return;
        if (!msgElement.classList.contains('sent')) return;
        const timeDiv = msgElement.querySelector('.time');
        if (!timeDiv) return;
        const checks = timeDiv.querySelector('.msg-checks');
        if (checks) {
            setMsgChecksRead(checks, true);
        } else {
            timeDiv.appendChild(createMsgChecks(true));
        }
    });
}

function handleChannelMessagesRead(payload) {
    if (!payload) return;
    const { chat_id, counts } = payload;
    if (!counts) return;
    if (chat_id !== STATE.currentChatId) return;
    if (STATE.currentChatType !== 'channel') return;

    for (const [msgId, count] of Object.entries(counts)) {
        const el = document.querySelector(`.message[data-msg-id="${msgId}"]`);
        if (!el) continue;
        if (!el.classList.contains('sent')) continue;
        const timeDiv = el.querySelector('.time');
        if (!timeDiv) continue;
        let span = timeDiv.querySelector(`.read-count[data-msg-id="${msgId}"]`);
        if (!span) {
            span = document.createElement('span');
            span.className = 'read-count';
            span.dataset.msgId = msgId;
            timeDiv.appendChild(document.createTextNode(' '));
            timeDiv.appendChild(span);
        }
        span.textContent = `👁 ${count}`;
    }
}
