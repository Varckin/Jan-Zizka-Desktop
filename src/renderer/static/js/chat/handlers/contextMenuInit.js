import { STATE } from '../state.js';
import { DOM, i18n } from '../dom.js';
import * as API from '../api.js';
import { showNotification, showConfirm, showPrompt, showLinkConfirm } from '../dialogs.js';
import { hideContextMenu } from '../ui/contextMenu.js';
import { setMessagePinnedUI } from '../ui/message.js';
import { refreshPinnedBar } from '../ui/pinnedBar.js';
import { updateChatLastMessage } from '../chatList.js';
import { renderMessageContent } from '../format.js';
import { updateChatItemLastMessage } from '../ui/chatItem.js';
import { contactNickname, nicknameByUsername } from '../contacts.js';

export function initContextMenu() {
    document.addEventListener('click', e => {
        if (DOM.messageContextMenu && !DOM.messageContextMenu.contains(e.target)) hideContextMenu();
    });
    window.addEventListener('scroll', hideContextMenu, true);
    window.addEventListener('resize', hideContextMenu);
    window.addEventListener('blur', hideContextMenu);
    const contextMenu = DOM.messageContextMenu;
    if (!contextMenu) return;
    contextMenu.addEventListener('click', async function(e) {
        const item = e.target.closest('.context-menu-item');
        if (!item) return;
        e.stopPropagation();
        const action = item.dataset.action;
        const msgId = parseInt(contextMenu.dataset.msgId);
        const sender = contextMenu.dataset.sender;
        const senderId = contextMenu.dataset.senderId ? parseInt(contextMenu.dataset.senderId, 10) : null;
        const content = contextMenu.dataset.content;
        hideContextMenu();
        if (action === 'copy') handleCopy(content);
        else if (action === 'reply') handleReply(msgId, senderId, sender, content);
        else if (action === 'edit') await handleEdit(msgId);
        else if (action === 'delete') await handleDelete(msgId);
        else if (action === 'pin') await handlePinToggle(msgId);
    });
}

async function handleCopy(content) {
    if (typeof content !== 'string') return;
    const text = content.trim();
    if (text.length === 0) return;
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.top = '-1000px';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            try {
                document.execCommand('copy');
            } finally {
                document.body.removeChild(textarea);
            }
        }
        showNotification(i18n.copied || 'Copied to clipboard');
    } catch (err) {
        showNotification((i18n.error || 'Error') + ': ' + err.message);
    }
}

function handleReply(msgId, senderId, sender, content) {
    STATE.replyTo = { id: msgId, sender, content };
    DOM.replyIndicator.classList.remove('is-hidden');
    DOM.replySender.textContent = contactNickname(senderId) || nicknameByUsername(sender) || sender;
    DOM.replyPreview.textContent = content.substring(0, 50);
}

async function handleEdit(msgId) {
    const newContent = await showPrompt('Edit message:');
    if (newContent === null || !newContent.trim()) return;
    try {
        await API.editMessage(msgId, newContent);
        const msgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
        if (msgEl) {
            renderMessageContent(msgEl.querySelector('.content'), newContent, showLinkConfirm);
            if (!msgEl.querySelector('.edited')) {
                const timeDiv = msgEl.querySelector('.time');
                if (timeDiv) {
                    const editedDiv = document.createElement('span');
                    editedDiv.className = 'edited';
                    editedDiv.textContent = i18n.edited || 'edited';
                    timeDiv.prepend(editedDiv);
                }
            }
            const allMessages = DOM.messagesContainer.querySelectorAll('.message');
            const lastEl = allMessages[allMessages.length - 1];
            if (lastEl && parseInt(lastEl.dataset.msgId, 10) === msgId) {
                const chatData = STATE.chatsMap[STATE.currentChatId];
                if (chatData) {
                    chatData.last_message = newContent;
                    chatData.last_message_time = new Date().toISOString();
                }
                updateChatItemLastMessage(STATE.currentChatId);
            }
        }
    } catch (err) {
        showNotification('Failed to edit message: ' + err.message);
    }
}

async function handleDelete(msgId) {
    if (!await showConfirm('Delete this message?')) return;
    try {
        await API.deleteMessage(msgId);
        const msgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
        if (msgEl) {
            const contentDiv = msgEl.querySelector('.content');
            if (contentDiv) {
                contentDiv.innerHTML = '';
                const em = document.createElement('em');
                em.textContent = i18n.message_deleted || 'Message deleted';
                contentDiv.appendChild(em);
            }
        }
        updateChatLastMessage(STATE.currentChatId);
    } catch (err) {
        showNotification('Failed to delete: ' + err.message);
    }
}

async function handlePinToggle(msgId) {
    const menu = DOM.messageContextMenu;
    const pinned = !!(menu && menu.dataset.pinned === '1');
    try {
        if (pinned) {
            await API.unpinMessage(msgId);
            setMessagePinnedUI(msgId, false);
            showNotification(i18n.message_unpinned || 'Message unpinned');
        } else {
            await API.pinMessage(msgId);
            setMessagePinnedUI(msgId, true);
            showNotification(i18n.message_pinned || 'Message pinned');
        }
        refreshPinnedBar(STATE.currentChatId);
    } catch (err) {
        const prefix = pinned
            ? (i18n.error_unpin_message || 'Failed to unpin message')
            : (i18n.error_pin_message || 'Failed to pin message');
        showNotification(prefix + ': ' + err.message);
    }
}
