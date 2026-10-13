import { DOM, i18n } from '../dom.js';
import * as API from '../api.js';
import { showNotification } from '../dialogs.js';
import { loadChats } from '../chatList.js';
import { closeModalFx } from '../modalFx.js';

export function initGroupMembersInput() {
    const container = DOM.groupMembersContainer;
    if (!container) return;
    if (!container.querySelector('.group-member-input')) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'group-member-input';
        input.placeholder = i18n.enter_username || 'Enter username';
        input.autocomplete = 'off';
        container.appendChild(input);
    }
    container.addEventListener('input', handleGroupMembersInput);
    container.addEventListener('keydown', handleGroupMembersKeydown);
}

function handleGroupMembersInput(e) {
    const target = e.target;
    if (!target.classList.contains('group-member-input')) return;
    const container = DOM.groupMembersContainer;
    const inputs = container.querySelectorAll('.group-member-input');
    const lastInput = inputs[inputs.length - 1];
    if (target === lastInput && target.value.trim() !== '') {
        const newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.className = 'group-member-input';
        newInput.placeholder = i18n.enter_username || 'Enter username';
        newInput.autocomplete = 'off';
        container.appendChild(newInput);
    }
    const allInputs = container.querySelectorAll('.group-member-input');
    if (allInputs.length > 1) {
        allInputs.forEach((inp, index) => {
            if (inp.value.trim() === '' && index < allInputs.length - 1) inp.remove();
        });
    }
}

function handleGroupMembersKeydown(e) {
    if (e.key !== 'Enter') return;
    const target = e.target;
    if (!target.classList.contains('group-member-input')) return;
    e.preventDefault();
    const container = DOM.groupMembersContainer;
    const inputs = container.querySelectorAll('.group-member-input');
    const lastInput = inputs[inputs.length - 1];
    if (target === lastInput && target.value.trim() !== '') {
        const newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.className = 'group-member-input';
        newInput.placeholder = i18n.enter_username || 'Enter username';
        newInput.autocomplete = 'off';
        container.appendChild(newInput);
        newInput.focus();
    } else {
        const nextInput = inputs[Array.from(inputs).indexOf(target) + 1];
        if (nextInput) nextInput.focus();
    }
}

export async function handleGroupSubmit(e) {
    e.preventDefault();
    const name = DOM.groupName.value.trim();
    const inputs = DOM.groupMembersContainer.querySelectorAll('.group-member-input');
    const usernames = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
    if (!name) { showNotification('Group name is required.'); return; }
    if (usernames.length < 1) { showNotification('Please enter at least one member besides yourself.'); return; }
    try {
        const memberIds = await Promise.all(usernames.map(async u => (await API.getUserByUsername(u)).id));
        const description = DOM.groupDescription.value.trim();
        const data = await API.createGroup(name, null, memberIds, description);
        const chatId = data.chat_id;
        if (window.groupAvatarCropped) {
            try {
                await API.uploadAvatar(chatId, window.groupAvatarCropped);
                showNotification('Group created with avatar.');
                window.groupAvatarCropped = null;
                DOM.groupAvatarFile.value = '';
            } catch (err) {
                showNotification('Group created, but avatar upload failed: ' + err.message);
            }
        } else showNotification(i18n.chat_created_success || 'Group created successfully.');
        closeModalFx(DOM.groupModal);
        DOM.groupName.value = '';
        DOM.groupMembersContainer.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'group-member-input';
        input.placeholder = i18n.enter_username || 'Enter username';
        input.autocomplete = 'off';
        DOM.groupMembersContainer.appendChild(input);
        DOM.groupAvatarFile.value = '';
        DOM.groupDescription.value = '';
        await loadChats(false);
        setTimeout(() => {
            const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
            if (item) item.click();
        }, 300);
    } catch (err) { showNotification('Error: ' + err.message); }
}
