import { i18n, setTextContent } from './dom.js';
import { createUserDisplay, localizedError } from './format.js';
import * as API from './api.js';
import { showNotification, showConfirm } from './dialogs.js';
import { loadChats } from './chatList.js';
import { openModalFx, closeModalFx } from './modalFx.js';

async function openBlockedUsersModal() {
    const modal = document.getElementById('blocked-users-modal');
    const list = document.getElementById('blocked-users-list');
    if (!modal || !list) return;
    setTextContent(list, i18n.loading || 'Loading...', 'loading');
    openModalFx(modal);
    await renderBlockedUsersList();
}

async function renderBlockedUsersList() {
    const modal = document.getElementById('blocked-users-modal');
    const list = document.getElementById('blocked-users-list');
    if (!list) return;
    try {
        const blocked = await API.getBlockedUsers();
        if (blocked.length === 0) { closeModalFx(modal); return; }
        list.innerHTML = '';
        blocked.forEach(user => list.appendChild(buildBlockedItem(user)));
    } catch (err) {
        setTextContent(list, localizedError(err), 'error');
    }
}

function buildBlockedItem(user) {
    const item = document.createElement('div');
    item.className = 'blocked-user-item';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'blocked-user-name';
    nameSpan.appendChild(createUserDisplay(user.first_name, user.last_name, user.username));
    item.appendChild(nameSpan);
    const unblockBtn = document.createElement('button');
    unblockBtn.type = 'button';
    unblockBtn.textContent = i18n.unblock || 'Unblock';
    unblockBtn.className = 'btn-secondary';
    unblockBtn.addEventListener('click', async () => {
        const confirmed = await showConfirm(i18n.confirm_unblock || 'Are you sure you want to unblock this user?');
        if (!confirmed) return;
        try {
            await API.unblockUser(user.id);
            showNotification(i18n.user_unblocked || 'User unblocked');
            await loadChats(false);
            await renderBlockedUsersList();
        } catch (err) { showNotification(localizedError(err)); }
    });
    item.appendChild(unblockBtn);
    return item;
}

export function bindUserSearchEvents() {
    const blockedBtn = document.getElementById('blocked-users-btn');
    if (blockedBtn) blockedBtn.addEventListener('click', openBlockedUsersModal);
    const blockedModal = document.getElementById('blocked-users-modal');
    if (blockedModal) {
        const closeBtn = blockedModal.querySelector('.close');
        if (closeBtn) closeBtn.addEventListener('click', () => closeModalFx(blockedModal));
        blockedModal.addEventListener('click', e => { if (e.target === blockedModal) closeModalFx(blockedModal); });
    }
}
