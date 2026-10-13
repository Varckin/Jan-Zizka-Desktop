import { STATE, hasPermission } from '../state.js';
import { DOM, i18n, setTextContent } from '../dom.js';
import { createUserDisplay, createVerifiedBadge, t } from '../format.js';
import * as API from '../api.js';
import { showNotification, showConfirm } from '../dialogs.js';
import { loadChats } from '../chatList.js';
import { abortPendingLoads } from '../chatMessages.js';
import { closeWs } from '../websocket.js';
import { updateChatUI, updateChatOnlineStatus } from '../ui/onlineStatus.js';
import { contactNickname } from '../contacts.js';
import { openModalFx, closeModalFx } from '../modalFx.js';
import { openUserProfileModal } from './info.js';
import { loadInviteLinks } from './inviteLinks.js';

function roleDisplayText(m) {
    const role = m.is_owner ? 'owner' : (m.role || '');
    if (!role) return '';
    if (role === 'member') return i18n.group_role_member || 'member';
    return i18n['role_' + role] || role;
}

export async function openSettingsModal() {
    if (!STATE.currentChatId) return;
    if (STATE.currentChatType === 'channel') {
        const { openChannelSettings } = await import('../channels.js');
        openChannelSettings(STATE.currentChatId);
        return;
    }
    if (STATE.currentChatType !== 'group') { showNotification('Settings are only available for group chats and channels.'); return; }
    if (!hasPermission('open_settings')) { showNotification('You do not have permission to edit this chat.'); return; }
    STATE.settingsChatId = STATE.currentChatId;
    const isFullPanel = hasPermission('edit_metadata');
    const generalTabBtn = document.querySelector('#chat-settings-modal .settings-tab[data-tab="general"]');
    const membersTabBtn = document.querySelector('#chat-settings-modal .settings-tab[data-tab="members"]');
    if (generalTabBtn) generalTabBtn.classList.toggle('is-hidden', !isFullPanel);
    if (membersTabBtn) membersTabBtn.classList.toggle('is-hidden', !isFullPanel);
    if (!isFullPanel) {
        DOM.deleteChatBtn.classList.add('is-hidden');
        openModalFx(DOM.settingsModal);
        switchSettingsTab('links');
        return;
    }
    try {
        const chats = await API.fetchChats();
        const chat = chats.find(c => c.id === STATE.currentChatId);
        if (chat) {
            DOM.chatSettingsName.value = chat.name || '';
            DOM.chatSettingsDescription.value = chat.description || '';
            DOM.chatSettingsAvatarPreview.src = chat.avatar || '';
            DOM.chatSettingsAvatarPreview.classList.toggle('is-hidden', !chat.avatar);
        }
        DOM.deleteChatBtn.classList.toggle('is-hidden', !(chat && chat.is_owner));
        await loadSettingsMembers();
        openModalFx(DOM.settingsModal);
        switchSettingsTab('general');
    } catch (err) { showNotification('Failed to load chat info: ' + err.message); }
}

async function loadSettingsMembers() {
    const list = DOM.settingsMembersList;
    setTextContent(list, i18n.loading || 'Loading...', 'loading');
    try {
        const members = await API.getMembers(STATE.currentChatId);
        list.innerHTML = '';
        members.forEach(m => list.appendChild(buildSettingsMemberItem(m)));
        const addArea = document.getElementById('settings-add-member-area');
        if (addArea) addArea.classList.toggle('is-hidden', !hasPermission('add_members'));
    } catch (err) { setTextContent(list, i18n.failed_load_members || 'Failed to load members', 'error'); }
}

function buildSettingsMemberItem(m) {
    const div = document.createElement('div');
    div.className = 'member-item';
    div.dataset.userId = m.user_id;
    const info = document.createElement('div');
    info.className = 'member-info';
    const avatar = document.createElement('span');
    avatar.className = 'member-avatar is-clickable';
    if (m.avatar_url) {
        const img = document.createElement('img');
        img.src = m.avatar_url;
        img.alt = m.username;
        img.className = 'member-avatar-img';
        avatar.appendChild(img);
    } else avatar.textContent = m.username.charAt(0).toUpperCase();
    const avatarLabel = contactNickname(m.user_id)
        || [m.first_name, m.last_name].filter(n => n && String(n).trim()).join(' ').trim()
        || m.username;
    avatar.title = avatarLabel;
    avatar.setAttribute('role', 'button');
    avatar.setAttribute('tabindex', '0');
    avatar.setAttribute('aria-label', avatarLabel);
    const openMemberProfile = (e) => {
        e.stopPropagation();
        openUserProfileModal({
            userId: m.user_id,
            username: m.username,
            firstName: m.first_name,
            lastName: m.last_name,
            avatarUrl: m.avatar_url,
            online: !!m.online,
            lastSeen: m.last_seen || null,
        });
    };
    avatar.addEventListener('click', openMemberProfile);
    avatar.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMemberProfile(e); }
    });
    info.appendChild(avatar);
    const name = document.createElement('span');
    name.className = 'member-name-text';
    const settingsNickname = contactNickname(m.user_id);
    if (settingsNickname) name.textContent = settingsNickname;
    else name.appendChild(createUserDisplay(m.first_name, m.last_name, m.username));
    if (m.is_admin) name.appendChild(createVerifiedBadge('staff'));
    info.appendChild(name);
    const onlineDot = document.createElement('span');
    onlineDot.className = 'member-online-dot';
    if (!m.online) onlineDot.classList.add('is-hidden');
    info.appendChild(onlineDot);
    div.appendChild(info);
    const actions = document.createElement('div');
    actions.className = 'member-actions';
    if (m.can_manage) {
        const roleSelect = document.createElement('select');
        (m.assignable_roles || []).forEach(r => {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r === 'member' ? (i18n.group_role_member || 'member') : (i18n['role_' + r] || r);
            if (r === m.role) opt.selected = true;
            roleSelect.appendChild(opt);
        });
        roleSelect.addEventListener('change', function() {
            API.changeRole(STATE.currentChatId, m.user_id, this.value)
                .then(() => { showNotification('Role updated'); loadSettingsMembers(); })
                .catch(err => showNotification('Failed to update role: ' + err.message));
        });
        actions.appendChild(roleSelect);
        const delBtn = document.createElement('button');
        delBtn.textContent = i18n.remove || 'Remove';
        delBtn.className = 'btn-secondary';
        delBtn.type = 'button';
        delBtn.addEventListener('click', () => {
            showConfirm(`Remove ${m.username}?`).then(confirmed => {
                if (confirmed) {
                    API.removeMember(STATE.currentChatId, m.user_id)
                        .then(() => { showNotification('Removed'); loadSettingsMembers(); })
                        .catch(err => showNotification('Failed to remove: ' + err.message));
                }
            });
        });
        actions.appendChild(delBtn);
    } else {
        const roleSpan = document.createElement('span');
        roleSpan.textContent = roleDisplayText(m);
        roleSpan.className = 'member-role-plain';
        actions.appendChild(roleSpan);
    }
    div.appendChild(actions);
    return div;
}

export function switchSettingsTab(tab) {
    document.querySelectorAll('.settings-tab').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(el => el.classList.add('is-hidden'));
    if (tab === 'general') {
        document.querySelector('.settings-tab[data-tab="general"]').classList.add('active');
        DOM.settingsTabGeneral.classList.remove('is-hidden');
    } else if (tab === 'members') {
        document.querySelector('.settings-tab[data-tab="members"]').classList.add('active');
        DOM.settingsTabMembers.classList.remove('is-hidden');
        loadSettingsMembers();
    } else if (tab === 'links') {
        document.querySelector('.settings-tab[data-tab="links"]').classList.add('active');
        DOM.settingsTabLinks.classList.remove('is-hidden');
        loadInviteLinks(STATE.settingsChatId || STATE.currentChatId);
    }
}

export async function handleChatSettingsSubmit(e) {
    e.preventDefault();
    const name = DOM.chatSettingsName.value.trim();
    const description = DOM.chatSettingsDescription.value.trim();
    const payload = {};
    if (name) payload.name = name;
    if (description) payload.description = description;
    try {
        await API.updateChat(STATE.settingsChatId, payload);
        showNotification('Chat updated');
        closeModalFx(DOM.settingsModal);
        loadChats(false);
        if (STATE.currentChatId === STATE.settingsChatId) DOM.chatNameSpan.textContent = name;
    } catch (err) { showNotification('Failed to update chat: ' + err.message); }
}

export async function handleDeleteChat() {
    if (!STATE.settingsChatId) return;
    const confirmed = await showConfirm(i18n.delete_chat_confirm || 'Are you sure you want to delete this chat? This cannot be undone.');
    if (!confirmed) return;
    const deletedId = STATE.settingsChatId;
    const wasCurrent = STATE.currentChatId === deletedId;
    try {
        await API.deleteChat(deletedId);
        showNotification('Chat deleted');
        closeModalFx(DOM.settingsModal);
        delete STATE.chatsMap[deletedId];
        delete STATE.unreadCounts[deletedId];
        STATE._justReadIds.delete(deletedId);
        if (STATE.typingUsers[deletedId]) delete STATE.typingUsers[deletedId];
        if (STATE._typingTimers[deletedId]) {
            Object.values(STATE._typingTimers[deletedId]).forEach(t => clearTimeout(t));
            delete STATE._typingTimers[deletedId];
        }
        STATE.settingsChatId = null;
        if (wasCurrent) {
            abortPendingLoads();
            STATE.currentChatId = null;
            STATE.currentChatType = null;
            STATE.currentPermissions = {};
            STATE.isLoading = false;
            DOM.chatNameSpan.textContent = i18n.select_chat || 'Select a chat';
            DOM.messagesContainer.innerHTML = `<div class="empty-state">${i18n.select_chat_prompt || 'Select a chat to start messaging'}</div>`;
            DOM.inputArea.classList.add('is-hidden');
            DOM.chatTyping.classList.add('is-hidden');
            DOM.chatTyping.textContent = '';
            closeWs();
            updateChatUI(null, null);
            updateChatOnlineStatus(null, false);
        }
        await loadChats(false);
    } catch (err) {
        showNotification('Failed to delete chat: ' + err.message);
    }
}

export async function handleSettingsAddMember() {
    const username = DOM.settingsAddMemberInput.value.trim();
    if (!username || !STATE.currentChatId) return;
    try {
        const data = await API.getUserByUsername(username);
        await API.addMember(STATE.currentChatId, data.id);
        showNotification(i18n.member_added || 'Member added');
        DOM.settingsAddMemberInput.value = '';
        loadSettingsMembers();
    } catch (err) { showNotification('Error: ' + err.message); }
}

export function bindSettingsModalEvents() {
    document.querySelectorAll('.settings-tab').forEach(btn => {
        btn.addEventListener('click', function() { switchSettingsTab(this.dataset.tab); });
    });
    DOM.settingsAddMemberBtn.addEventListener('click', handleSettingsAddMember);
    DOM.settingsModalClose.addEventListener('click', () => closeModalFx(DOM.settingsModal));
    DOM.settingsModal.addEventListener('click', function(e) { if (e.target === this) closeModalFx(this); });
}
