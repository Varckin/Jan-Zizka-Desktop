import { DOM, i18n } from '../dom.js';
import * as API from '../api.js';
import { showNotification } from '../dialogs.js';
import { loadChats } from '../chatList.js';
import { closeModalFx } from '../modalFx.js';
import { openChatCrop } from './avatarCrop.js';

let groupAvatarPreviewUrl = null;

function setGroupAvatarPreview(file) {
    if (groupAvatarPreviewUrl) {
        URL.revokeObjectURL(groupAvatarPreviewUrl);
        groupAvatarPreviewUrl = null;
    }
    const preview = DOM.groupAvatarPreview;
    if (!preview) return;
    if (file) {
        groupAvatarPreviewUrl = URL.createObjectURL(file);
        preview.src = groupAvatarPreviewUrl;
        preview.classList.remove('is-hidden');
    } else {
        preview.src = 'data:,';
        preview.classList.add('is-hidden');
    }
}

export function resetGroupAvatarSelection() {
    window.groupAvatarCropped = null;
    if (DOM.groupAvatarFile) DOM.groupAvatarFile.value = '';
    setGroupAvatarPreview(null);
}

export async function handleGroupAvatarSelect(e) {
    const file = e.target.files[0];
    if (!file) { resetGroupAvatarSelection(); return; }
    try {
        window.groupAvatarCropped = await openChatCrop(file);
        setGroupAvatarPreview(window.groupAvatarCropped);
        showNotification(i18n.avatar_selected_click_create || 'Avatar selected. Click "Create" to finish.');
    } catch (err) {
        if (err.message !== 'Cancelled') showNotification((i18n.crop_failed || 'Failed to crop avatar') + ': ' + err.message);
        e.target.value = '';
        window.groupAvatarCropped = null;
        setGroupAvatarPreview(null);
    }
}

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
        const avatarFile = window.groupAvatarCropped;
        if (avatarFile) {
            try {
                await API.uploadAvatar(chatId, avatarFile);
                showNotification(i18n.group_created_with_avatar || 'Group created with avatar.');
            } catch (err) {
                showNotification((i18n.group_created_avatar_failed || 'Group created, but avatar upload failed') + ': ' + err.message);
            }
        } else showNotification(i18n.chat_created_success || 'Group created successfully.');
        closeModalFx(DOM.groupModal);
        resetGroupAvatarSelection();
        DOM.groupName.value = '';
        DOM.groupMembersContainer.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'group-member-input';
        input.placeholder = i18n.enter_username || 'Enter username';
        input.autocomplete = 'off';
        DOM.groupMembersContainer.appendChild(input);
        DOM.groupDescription.value = '';
        await loadChats(false);
        setTimeout(() => {
            const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
            if (item) item.click();
        }, 300);
    } catch (err) { showNotification('Error: ' + err.message); }
}
