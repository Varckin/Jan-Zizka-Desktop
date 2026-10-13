import { DOM } from './dom.js';
import { STATE } from './state.js';
import { isMine } from './utils.js';
import {
    openMenuAt,
    closeMenu,
    applyMenuVisibility,
    setMenuDanger,
    bindMenuAutoHide,
} from '../core_chat/contextMenu.js';

let actionHandler = null;

export function showContextMenu(x, y, msg) {
    STATE.ctxTarget = msg;
    const menu = DOM.ctxMenu;
    if (!menu) return;

    const mine = isMine(msg);
    const canReply = !msg.deleted;
    const isPhoneSmall = window.innerWidth < 480;
    const hasText = !msg.deleted && !!(msg.payload?.text || msg.text);
    const canCopy = isPhoneSmall && hasText;
    const canEdit = mine && !msg.deleted && !(msg.payload && msg.payload.file);
    const canDelete = mine && !msg.deleted;

    if (!canReply && !canEdit && !canDelete && !canCopy) {
        hideContextMenu();
        return;
    }

    applyMenuVisibility(menu, {
        reply: canReply,
        copy: canCopy,
        edit: canEdit,
        delete: canDelete,
    });
    setMenuDanger(menu, 'delete', canDelete);

    openMenuAt(menu, x, y, 8);
}

export function hideContextMenu() {
    closeMenu(DOM.ctxMenu);
    STATE.ctxTarget = null;
}

export function initContextMenu(onAction) {
    actionHandler = onAction;

    DOM.ctxMenu.addEventListener('click', e => {
        const item = e.target.closest('.context-menu-item');
        if (!item) return;
        const action = item.dataset.action;
        const target = STATE.ctxTarget;
        hideContextMenu();
        if (actionHandler && target) actionHandler(action, target);
    });

    bindMenuAutoHide(DOM.ctxMenu, hideContextMenu);
}
