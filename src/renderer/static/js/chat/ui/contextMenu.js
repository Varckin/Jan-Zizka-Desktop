import { STATE, hasPermission } from '../state.js';
import { DOM, i18n } from '../dom.js';
import { isMyMessage } from '../format.js';
import {
    openMenuAt,
    closeMenu,
    applyMenuVisibility,
    setMenuDanger,
} from '../../core_chat/contextMenu.js';

const PIN_MENU_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

function ensurePinMenuItem(menu) {
    if (menu.querySelector('[data-action="pin"]')) return;
    const item = document.createElement('div');
    item.className = 'context-menu-item';
    item.dataset.action = 'pin';
    item.innerHTML = PIN_MENU_ICON_SVG + '<span></span>';
    const label = item.querySelector('span');
    label.textContent = i18n.pin_message || 'Pin';
    const editItem = menu.querySelector('[data-action="edit"]');
    if (editItem) menu.insertBefore(item, editItem);
    else menu.appendChild(item);
}

export function showContextMenu(e, msg) {
    const menu = DOM.messageContextMenu;
    if (!menu) return;

    const isOwn = isMyMessage(msg);
    const isDeleted = msg.deleted_at != null;

    const isChannel = STATE.currentChatType === 'channel';
    const isGroup = STATE.currentChatType === 'group';
    const canPost = !isChannel || hasPermission('post_messages');
    const canModerate = hasPermission('delete_other_messages');
    const canPinHere = hasPermission('pin_messages');

    const chatData = STATE.chatsMap[STATE.currentChatId];
    const isServiceDirect = !!(chatData && chatData.type === 'direct' && chatData.other_user_is_service);

    const canReply = !isDeleted && canPost && !isServiceDirect;
    const canEdit = isOwn && !isDeleted && canPost;
    const canDelete = !isDeleted && (
        (isOwn && canPost) ||
        (!isOwn && canModerate && (isGroup || isChannel))
    );
    const canPin = !isDeleted && !msg.is_system && (
        (isGroup || isChannel) ? canPinHere : (canPost && !isServiceDirect)
    );

    const msgEl = document.querySelector(`.message[data-msg-id="${msg.id}"]`);
    const pinnedNow = msgEl ? msgEl.dataset.pinned === '1' : !!msg.is_pinned;

    const isPhoneSmall = window.innerWidth < 480;
    const hasContent = !isDeleted
        && typeof msg.content === 'string'
        && msg.content.trim().length > 0;
    const canCopy = isPhoneSmall && hasContent;

    if (!canReply && !canEdit && !canDelete && !canCopy && !canPin) {
        closeMenu(menu);
        return;
    }

    ensurePinMenuItem(menu);
    const pinItem = menu.querySelector('[data-action="pin"]');
    if (pinItem) {
        const pinLabel = pinItem.querySelector('span');
        if (pinLabel) pinLabel.textContent = pinnedNow ? (i18n.unpin_message || 'Unpin') : (i18n.pin_message || 'Pin');
    }

    applyMenuVisibility(menu, {
        copy: canCopy,
        reply: canReply,
        pin: canPin,
        edit: canEdit,
        delete: canDelete,
    });
    setMenuDanger(menu, 'delete', canDelete);

    menu.dataset.msgId = msg.id;
    menu.dataset.sender = msg.sender_username;
    menu.dataset.senderId = msg.sender_id != null ? String(msg.sender_id) : '';
    menu.dataset.content = msg.content;
    menu.dataset.pinned = pinnedNow ? '1' : '';

    openMenuAt(menu, e.clientX, e.clientY);
}

export function hideContextMenu() {
    closeMenu(DOM.messageContextMenu);
}
