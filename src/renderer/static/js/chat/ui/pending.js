import { STATE } from '../state.js';
import { DOM, i18n } from '../dom.js';
import { isNearBottom, scrollToBottom } from './scroll.js';

export function renderPendingMessage(entry) {
    const div = document.createElement('div');
    div.className = 'message sent message--pending';
    div.dataset.pendingId = String(entry.tmpId);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    if (entry.files && entry.files.length) {
        const names = entry.files.map(f => f.name).join(', ');
        contentDiv.textContent = entry.content
            ? entry.content + ' · 📎 ' + names
            : '📎 ' + names;
    } else {
        contentDiv.textContent = entry.content || '';
    }
    div.appendChild(contentDiv);

    const timeDiv = document.createElement('div');
    timeDiv.className = 'time';
    if (entry.status === 'failed') {
        const warn = document.createElement('span');
        warn.className = 'pending-failed';
        warn.textContent = '⚠ ' + (i18n.pending_failed || 'Not sent — tap to retry');
        warn.title = entry.error || (i18n.retry || 'Retry');
        warn.setAttribute('role', 'button');
        warn.addEventListener('click', () => {
            import('../chatMessages.js').then(m => m.retryPendingSend(entry));
        });
        timeDiv.appendChild(warn);
        const discard = document.createElement('button');
        discard.type = 'button';
        discard.className = 'pending-discard';
        discard.textContent = '✕';
        discard.setAttribute('aria-label', i18n.discard || 'Discard');
        discard.addEventListener('click', () => {
            import('../chatMessages.js').then(m => m.discardPendingSend(entry));
        });
        timeDiv.appendChild(discard);
    } else {
        const clock = document.createElement('span');
        clock.className = 'pending-clock';
        clock.textContent = '🕓 ' + (i18n.pending_sending || 'Sending…');
        timeDiv.appendChild(clock);
    }
    div.appendChild(timeDiv);

    return div;
}

export function appendPendingNode(entry) {
    if (!DOM.messagesContainer) return;
    removePendingNode(entry.tmpId);
    const emptyState = DOM.messagesContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    const stick = isNearBottom();
    DOM.messagesContainer.appendChild(renderPendingMessage(entry));
    if (stick) scrollToBottom(false);
}

export function rerenderPendingNode(entry) {
    if (!DOM.messagesContainer) return;
    const el = DOM.messagesContainer.querySelector(`.message[data-pending-id="${entry.tmpId}"]`);
    if (!el) {
        if (STATE.currentChatId === entry.chatId) appendPendingNode(entry);
        return;
    }
    el.replaceWith(renderPendingMessage(entry));
}

export function removePendingNode(tmpId) {
    if (!DOM.messagesContainer) return;
    const el = DOM.messagesContainer.querySelector(`.message[data-pending-id="${tmpId}"]`);
    if (el) el.remove();
}

export function appendPendingNodesFor(chatId) {
    if (!DOM.messagesContainer) return;
    if (STATE.currentChatId !== chatId) return;
    const entries = STATE.pendingSends[chatId] || [];
    if (!entries.length) return;
    const emptyState = DOM.messagesContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    for (const entry of entries) {
        DOM.messagesContainer.appendChild(renderPendingMessage(entry));
    }
}
