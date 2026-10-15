import { STATE } from './state.js';
import { DOM, i18n, setTextContent } from './dom.js';
import * as API from './api.js';
import { createVerifiedBadge, formatSubscribersCount, localizedError, t, tf } from './format.js';
import { contactNickname } from './contacts.js';
import { showNotification, showConfirm } from './dialogs.js';
import { loadChats } from './chatList.js';
import { abortPendingLoads } from './chatMessages.js';
import { closeWs } from './websocket.js';
import { updateChatUI, updateChatOnlineStatus } from './ui/onlineStatus.js';
import { openModalFx, closeModalFx } from './modalFx.js';
import { mountChatMediaBrowser } from './chatMedia.js';
import { openUserProfileModal, openChatCrop } from './modals.js';

let channelSettingsId = null;
let channelAvatarCropped = null;
let channelAvatarPreviewUrl = null;

function setChannelAvatarPreview(file) {
    if (channelAvatarPreviewUrl) {
        URL.revokeObjectURL(channelAvatarPreviewUrl);
        channelAvatarPreviewUrl = null;
    }
    const preview = document.getElementById('channel-avatar-preview');
    if (!preview) return;
    if (file) {
        channelAvatarPreviewUrl = URL.createObjectURL(file);
        preview.src = channelAvatarPreviewUrl;
        preview.classList.remove('is-hidden');
    } else {
        preview.src = 'data:,';
        preview.classList.add('is-hidden');
    }
}

export function resetChannelAvatarSelection() {
    channelAvatarCropped = null;
    const input = document.getElementById('channel-avatar-file');
    if (input) input.value = '';
    setChannelAvatarPreview(null);
}

export async function handleChannelAvatarSelect(e) {
    const file = e.target.files[0];
    if (!file) { channelAvatarCropped = null; setChannelAvatarPreview(null); return; }
    try {
        channelAvatarCropped = await openChatCrop(file);
        setChannelAvatarPreview(channelAvatarCropped);
        showNotification(i18n.avatar_selected_click_create || 'Avatar selected. Click "Create" to finish.');
    } catch (err) {
        if (err.message !== 'Cancelled') showNotification((i18n.crop_failed || 'Failed to crop avatar') + ': ' + err.message);
        e.target.value = '';
        channelAvatarCropped = null;
        setChannelAvatarPreview(null);
    }
}

export async function handleChannelSettingsAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file || !channelSettingsId) return;
    try {
        const cropped = await openChatCrop(file);
        const data = await API.uploadChannelAvatar(channelSettingsId, cropped);
        const preview = document.getElementById('ch-settings-avatar-preview');
        if (data && data.avatar && preview) {
            preview.src = data.avatar + '?v=' + Date.now();
            preview.classList.remove('is-hidden');
        }
        showNotification(i18n.avatar_updated || 'Avatar updated');
        loadChats(false);
    } catch (err) {
        if (err.message !== 'Cancelled') showNotification((i18n.avatar_upload_failed || 'Failed to upload avatar') + ': ' + err.message);
    }
    e.target.value = '';
}

export async function openChannelInfo(channelId) {
    const modal = document.getElementById('channel-info-modal');
    if (!modal) return;
    openModalFx(modal);
    const avatarEl = document.getElementById('channel-info-avatar');
    const nameEl = document.getElementById('channel-info-name');
    const usernameEl = document.getElementById('channel-info-username');
    const subsEl = document.getElementById('channel-info-subs');
    const createdEl = DOM.channelInfoCreated;
    const descEl = document.getElementById('channel-info-description');
    const actionsEl = document.getElementById('channel-info-actions');
    const adminsSection = document.getElementById('channel-info-admins');
    const adminsList = document.getElementById('channel-admins-list');
    avatarEl.innerHTML = '';
    nameEl.textContent = '';
    usernameEl.textContent = '';
    subsEl.textContent = '';
    if (createdEl) {
        createdEl.textContent = '';
        createdEl.classList.add('is-hidden');
    }
    descEl.textContent = '';
    actionsEl.innerHTML = '';
    actionsEl.classList.remove('is-visible');
    adminsSection.classList.add('is-hidden');
    adminsList.innerHTML = '';
    const mediaSection = document.getElementById('channel-media-section');
    const mediaBrowser = document.getElementById('channel-media-browser');
    const contentEl = modal.querySelector('.channel-info-content');
    if (mediaSection) {
        mediaSection.classList.add('is-hidden');
        delete mediaSection.dataset.chatId;
    }
    if (mediaBrowser) mediaBrowser.innerHTML = '';
    if (contentEl) contentEl.classList.remove('has-media');
    try {
        const ch = await API.getChannel(channelId);
        if (ch.avatar) {
            const img = document.createElement('img');
            img.src = ch.avatar;
            avatarEl.appendChild(img);
        } else avatarEl.textContent = (ch.name || '?')[0].toUpperCase();
        nameEl.textContent = ch.name;
        if (ch.username) usernameEl.textContent = '@' + ch.username;
        subsEl.textContent = `${formatSubscribersCount(ch.subscribers_count)} ${i18n.subscribers || 'subscribers'}`;
        if (createdEl && ch.created_at) {
            const createdDate = new Date(ch.created_at);
            if (!isNaN(createdDate.getTime())) {
                createdEl.textContent = tf(
                    'created_on',
                    'Created on {date}',
                    { date: createdDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) }
                );
                createdEl.classList.remove('is-hidden');
            }
        }
        descEl.textContent = ch.description || '';
        descEl.classList.toggle('is-hidden', !ch.description);
        renderChannelActions(actionsEl, subsEl, ch, channelId);
        mountChatMediaBrowser(mediaSection, mediaBrowser, contentEl, channelId);
        if (ch.permissions && ch.permissions.view_admins) loadChannelInfoAdmins(channelId);
    } catch (err) {
        showNotification(localizedError(err));
        closeModalFx(modal);
    }
}

async function loadChannelInfoAdmins(channelId) {
    const section = document.getElementById('channel-info-admins');
    const list = document.getElementById('channel-admins-list');
    if (!section || !list) return;
    try {
        const admins = await API.getChannelAdmins(channelId);
        if (!admins || !admins.length) {
            section.classList.add('is-hidden');
            return;
        }
        list.innerHTML = '';
        admins.forEach(a => list.appendChild(buildChannelInfoAdminRow(a)));
        section.classList.remove('is-hidden');
    } catch (err) {
        section.classList.add('is-hidden');
        list.innerHTML = '';
    }
}

function buildChannelInfoAdminRow(a) {
    const row = document.createElement('div');
    row.className = 'channel-admin-item';
    const av = document.createElement('div');
    av.className = 'channel-admin-avatar';
    if (a.avatar_url) {
        const img = document.createElement('img');
        img.src = a.avatar_url;
        img.alt = a.username || '';
        av.appendChild(img);
    } else av.textContent = (a.username || '?')[0].toUpperCase();
    row.appendChild(av);
    const info = document.createElement('div');
    info.className = 'channel-admin-info';
    const name = document.createElement('div');
    name.className = 'channel-admin-name';
    const fullName = [a.first_name, a.last_name].filter(Boolean).join(' ').trim();
    name.textContent = contactNickname(a.user_id) || fullName || a.username;
    name.title = '@' + a.username;
    info.appendChild(name);
    row.appendChild(info);
    const role = document.createElement('span');
    role.className = 'channel-admin-role';
    role.textContent = i18n['role_' + a.role] || a.role;
    row.appendChild(role);
    return row;
}

function renderChannelActions(container, subsEl, ch, channelId) {
    if (ch.permissions && ch.permissions.can_subscribe === false) return;

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn-primary channel-action-btn';
    openBtn.textContent = t('open_channel', 'Open channel');
    openBtn.addEventListener('animationend', () => { openBtn.style.animation = 'none'; }, { once: true });

    const subBtn = document.createElement('button');
    subBtn.type = 'button';
    subBtn.className = 'btn-secondary channel-action-btn';
    subBtn.addEventListener('animationend', () => { subBtn.style.animation = 'none'; }, { once: true });

    const applyState = () => {
        subBtn.textContent = ch.is_subscribed ? t('unsubscribe', 'Unsubscribe') : t('subscribe', 'Subscribe');
        subBtn.classList.toggle('is-done', !!ch.is_subscribed);
    };
    applyState();

    const updateSubs = () => {
        subsEl.textContent = `${formatSubscribersCount(ch.subscribers_count || 0)} ${i18n.subscribers || 'subscribers'}`;
    };

    subBtn.addEventListener('click', async () => {
        subBtn.disabled = true;
        try {
            if (ch.is_subscribed) {
                await API.unsubscribeFromChannel(channelId);
                ch.is_subscribed = false;
                ch.subscribers_count = Math.max(0, (ch.subscribers_count || 1) - 1);
            } else {
                await API.subscribeToChannel(channelId);
                ch.is_subscribed = true;
                ch.subscribers_count = (ch.subscribers_count || 0) + 1;
            }
            applyState();
            updateSubs();
            await loadChats(true);
        } catch (err) {
            showNotification(localizedError(err));
        } finally {
            subBtn.disabled = false;
        }
    });

    openBtn.addEventListener('click', async () => {
        openBtn.disabled = true;
        try {
            if (!ch.is_subscribed) {
                await API.subscribeToChannel(channelId);
                ch.is_subscribed = true;
                ch.subscribers_count = (ch.subscribers_count || 0) + 1;
                applyState();
                updateSubs();
            }
            const modal = document.getElementById('channel-info-modal');
            closeModalFx(modal);
            await loadChats(true);
            const item = document.querySelector(`.chat-item[data-chat-id="${channelId}"]`);
            if (item) item.click();
            else showNotification(t('channel_open_hint', 'Channel opened. Find it in your chat list.'));
        } catch (err) {
            showNotification(localizedError(err));
        } finally {
            openBtn.disabled = false;
        }
    });

    container.append(openBtn, subBtn);
    container.classList.add('is-visible');
}

export async function openChannelSettings(channelId) {
    const modal = document.getElementById('channel-settings-modal');
    if (!modal) return;
    channelSettingsId = channelId;
    openModalFx(modal);
    switchChannelSettingsTab('ch-general');
    try {
        const ch = await API.getChannel(channelId);
        const perms = ch.permissions || {};
        document.getElementById('ch-settings-name').value = ch.name || '';
        const usernameInput = document.getElementById('ch-settings-username');
        usernameInput.value = ch.username || '';
        usernameInput.disabled = !perms.change_username;
        usernameInput.title = perms.change_username ? '' : (i18n.channel_username_owner_only || 'Only the owner can change the public link');
        document.getElementById('ch-settings-description').value = ch.description || '';
        const avatarGroup = document.getElementById('ch-settings-avatar-group');
        if (avatarGroup) avatarGroup.classList.toggle('is-hidden', !perms.upload_avatar);
        const avatarPreview = document.getElementById('ch-settings-avatar-preview');
        if (avatarPreview) {
            avatarPreview.src = ch.avatar ? ch.avatar + '?v=' + Date.now() : 'data:,';
            avatarPreview.classList.toggle('is-hidden', !ch.avatar);
        }
        const deleteBtn = document.getElementById('delete-channel-btn');
        deleteBtn.classList.toggle('is-hidden', !perms.delete_chat);
        const adminsTab = modal.querySelector('.settings-tab[data-tab="ch-admins"]');
        const subsTab = modal.querySelector('.settings-tab[data-tab="ch-subscribers"]');
        if (adminsTab) adminsTab.classList.toggle('is-hidden', !perms.view_admins);
        if (subsTab) subsTab.classList.toggle('is-hidden', !perms.view_admins);
        if (perms.view_admins) loadChannelAdminsTab(channelId, !!perms.manage_admins);
    } catch (err) {
        showNotification(localizedError(err));
        closeModalFx(modal);
    }
}

function switchChannelSettingsTab(tab) {
    document.querySelectorAll('#channel-settings-modal .settings-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#channel-settings-modal .settings-tab-content').forEach(c => c.classList.add('is-hidden'));
    const btn = document.querySelector(`#channel-settings-modal .settings-tab[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');
    const content = document.getElementById(`settings-tab-${tab}`);
    if (content) content.classList.remove('is-hidden');
}

export async function loadChannelAdminsTab(channelId, canManageAdmins) {
    const list = document.getElementById('ch-admins-list');
    if (!list) return;
    const addAdminArea = document.getElementById('ch-add-admin-area');
    if (addAdminArea) addAdminArea.classList.toggle('is-hidden', !canManageAdmins);
    setTextContent(list, i18n.loading || 'Loading...', 'loading');
    try {
        const admins = await API.getChannelAdmins(channelId);
        list.innerHTML = '';
        admins.forEach(a => list.appendChild(buildChannelAdminRow(a, channelId)));
    } catch (err) { setTextContent(list, err.message, 'error'); }
}

function buildChannelAdminRow(a, channelId) {
    const row = document.createElement('div');
    row.className = 'channel-admin-item';
    const av = document.createElement('div');
    av.className = 'channel-admin-avatar';
    if (a.avatar_url) {
        const img = document.createElement('img');
        img.src = a.avatar_url;
        av.appendChild(img);
    } else av.textContent = (a.username || '?')[0].toUpperCase();
    row.appendChild(av);
    const info = document.createElement('div');
    info.className = 'channel-admin-info';
    const name = document.createElement('div');
    name.className = 'channel-admin-name';
    const fullName = [a.first_name, a.last_name].filter(Boolean).join(' ').trim();
    name.textContent = contactNickname(a.user_id) || fullName || a.username;
    info.appendChild(name);
    row.appendChild(info);
    const role = document.createElement('span');
    role.className = 'channel-admin-role';
    role.textContent = i18n['role_' + a.role] || a.role;
    row.appendChild(role);
    if (a.can_demote) {
        const actions = document.createElement('div');
        actions.className = 'channel-admin-actions';
        const demoteBtn = document.createElement('button');
        demoteBtn.type = 'button';
        demoteBtn.className = 'btn-secondary';
        demoteBtn.textContent = i18n.demote || 'Demote';
        demoteBtn.addEventListener('click', async () => {
            if (!await showConfirm(i18n.confirm_demote || 'Demote this admin?')) return;
            try {
                await API.removeChannelAdmin(channelId, a.user_id);
                showNotification(i18n.admin_removed || 'Admin demoted');
                const ch = await API.getChannel(channelId);
                loadChannelAdminsTab(channelId, !!(ch.permissions && ch.permissions.manage_admins));
            } catch (err) { showNotification(err.message); }
        });
        actions.appendChild(demoteBtn);
        row.appendChild(actions);
    }
    return row;
}

export async function loadChannelSubscribersTab(channelId) {
    const list = document.getElementById('ch-subscribers-list');
    const countEl = document.getElementById('ch-subscribers-count');
    if (!list) return;
    setTextContent(list, i18n.loading || 'Loading...', 'loading');
    try {
        const ch = await API.getChannel(channelId);
        if (countEl) countEl.textContent = `${formatSubscribersCount(ch.subscribers_count)} ${i18n.subscribers || 'subscribers'}`;
        const subs = await API.getChannelSubscribers(channelId);
        list.innerHTML = '';
        if (!subs.length) { setTextContent(list, i18n.no_subscribers || 'No subscribers yet', 'empty-state'); return; }
        subs.forEach(s => list.appendChild(buildSubscriberRow(s, channelId)));
    } catch (err) { setTextContent(list, err.message, 'error'); }
}

function buildSubscriberRow(s, channelId) {
    const row = document.createElement('div');
    row.className = 'channel-subscriber-item';
    const av = document.createElement('div');
    av.className = 'channel-subscriber-avatar is-clickable';
    if (s.avatar_url) {
        const img = document.createElement('img');
        img.src = s.avatar_url;
        av.appendChild(img);
    } else av.textContent = (s.username || '?')[0].toUpperCase();
    const avatarLabel = contactNickname(s.user_id)
        || [s.first_name, s.last_name].filter(Boolean).join(' ').trim()
        || s.username;
    av.title = t('nav_profile', 'Profile');
    av.setAttribute('role', 'button');
    av.setAttribute('tabindex', '0');
    av.setAttribute('aria-label', avatarLabel);
    const openProfile = e => {
        e.stopPropagation();
        openUserProfileModal({
            userId: s.user_id,
            username: s.username,
            firstName: s.first_name,
            lastName: s.last_name,
            avatarUrl: s.avatar_url,
            online: !!s.online,
            lastSeen: s.last_seen || null,
        });
    };
    av.addEventListener('click', openProfile);
    av.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(e); }
    });
    row.appendChild(av);
    const info = document.createElement('div');
    info.className = 'channel-subscriber-info';
    const name = document.createElement('div');
    name.className = 'channel-subscriber-name';
    name.textContent = contactNickname(s.user_id) || [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || s.username;
    if (s.is_admin) name.appendChild(createVerifiedBadge('staff'));
    info.appendChild(name);
    row.appendChild(info);
    const role = document.createElement('span');
    role.className = 'channel-admin-role';
    role.textContent = i18n['role_' + s.role] || s.role;
    row.appendChild(role);
    const actions = document.createElement('div');
    actions.className = 'channel-subscriber-actions';
    if (s.can_kick) {
        const kickBtn = document.createElement('button');
        kickBtn.type = 'button';
        kickBtn.className = 'btn-secondary';
        kickBtn.textContent = i18n.kick || 'Kick';
        kickBtn.addEventListener('click', async () => {
            if (!await showConfirm(`${i18n.confirm_kick || 'Kick'} ${s.username}?`)) return;
            try {
                await API.kickChannelSubscriber(channelId, s.user_id);
                showNotification(i18n.subscriber_kicked || 'Subscriber kicked');
                loadChannelSubscribersTab(channelId);
            } catch (err) { showNotification(err.message); }
        });
        actions.appendChild(kickBtn);
    }
    row.appendChild(actions);
    return row;
}

export async function handleChannelFormSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('channel-name').value.trim();
    const username = document.getElementById('channel-username').value.trim();
    const description = document.getElementById('channel-description').value.trim();
    if (!name) { showNotification(i18n.channel_name_required || 'Channel name is required'); return; }
    try {
        const data = await API.createChannel({ name, username: username || null, description: description || null });
        const avatarFile = channelAvatarCropped;
        channelAvatarCropped = null;
        if (avatarFile) {
            try {
                await API.uploadChannelAvatar(data.channel_id, avatarFile);
                showNotification(i18n.channel_created_with_avatar || 'Channel created with avatar.');
            } catch (avatarErr) {
                showNotification((i18n.channel_created_avatar_failed || 'Channel created, but avatar upload failed') + ': ' + avatarErr.message);
            }
        } else {
            showNotification(i18n.channel_created || 'Channel created!');
        }
        closeModalFx(document.getElementById('channel-modal'));
        document.getElementById('channel-form').reset();
        setChannelAvatarPreview(null);
        await loadChats(false);
        setTimeout(() => {
            const item = document.querySelector(`.chat-item[data-chat-id="${data.channel_id}"]`);
            if (item) item.click();
        }, 300);
    } catch (err) { showNotification((i18n.error || 'Error') + ': ' + err.message); }
}

export function bindChannelEvents() {
    document.querySelectorAll('#channel-settings-modal .settings-tab').forEach(btn => {
        btn.addEventListener('click', async function() {
            const tab = this.dataset.tab;
            document.querySelectorAll('#channel-settings-modal .settings-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('#channel-settings-modal .settings-tab-content').forEach(c => c.classList.add('is-hidden'));
            this.classList.add('active');
            const content = document.getElementById(`settings-tab-${tab}`);
            if (content) content.classList.remove('is-hidden');
            if (tab === 'ch-subscribers' && channelSettingsId) await loadChannelSubscribersTab(channelSettingsId);
        });
    });
    const chSettingsForm = document.getElementById('channel-settings-form');
    if (chSettingsForm) chSettingsForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!channelSettingsId) return;
        try {
            const payload = {
                name: document.getElementById('ch-settings-name').value.trim(),
                description: document.getElementById('ch-settings-description').value.trim(),
            };
            const usernameInput = document.getElementById('ch-settings-username');
            if (usernameInput && !usernameInput.disabled) {
                payload.username = usernameInput.value.trim() || null;
            }
            await API.updateChannel(channelSettingsId, payload);
            showNotification(i18n.channel_updated || 'Channel updated');
            closeModalFx(document.getElementById('channel-settings-modal'));
            await loadChats(true);
        } catch (err) { showNotification(err.message); }
    });
    const deleteChannelBtn = document.getElementById('delete-channel-btn');
    if (deleteChannelBtn) deleteChannelBtn.addEventListener('click', async () => {
        if (!channelSettingsId) return;
        if (!await showConfirm(i18n.delete_channel_confirm || 'Delete this channel? This cannot be undone.')) return;
        const deletedId = channelSettingsId;
        const wasCurrent = STATE.currentChatId === deletedId;
        try {
            await API.deleteChannel(deletedId);
            showNotification(i18n.channel_deleted || 'Channel deleted');
            closeModalFx(document.getElementById('channel-settings-modal'));
            delete STATE.chatsMap[deletedId];
            delete STATE.unreadCounts[deletedId];
            STATE._justReadIds.delete(deletedId);
            if (STATE.typingUsers[deletedId]) delete STATE.typingUsers[deletedId];
            if (STATE._typingTimers[deletedId]) {
                Object.values(STATE._typingTimers[deletedId]).forEach(t => clearTimeout(t));
                delete STATE._typingTimers[deletedId];
            }
            channelSettingsId = null;
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
        } catch (err) { showNotification(err.message); }
    });
    const chAddAdminBtn = document.getElementById('ch-add-admin-btn');
    if (chAddAdminBtn) chAddAdminBtn.addEventListener('click', async () => {
        const username = document.getElementById('ch-add-admin-input').value.trim();
        const role = document.getElementById('ch-add-admin-role').value;
        if (!username || !channelSettingsId) return;
        try {
            const user = await API.getUserByUsername(username);
            await API.addChannelAdmin(channelSettingsId, user.id, role);
            showNotification(i18n.admin_added || 'Admin added');
            document.getElementById('ch-add-admin-input').value = '';
            const ch = await API.getChannel(channelSettingsId);
            loadChannelAdminsTab(channelSettingsId, !!(ch.permissions && ch.permissions.manage_admins));
        } catch (err) { showNotification(err.message); }
    });
    const chAddSubscriberBtn = document.getElementById('ch-add-subscriber-btn');
    if (chAddSubscriberBtn) chAddSubscriberBtn.addEventListener('click', async () => {
        const username = document.getElementById('ch-add-subscriber-input').value.trim();
        if (!username || !channelSettingsId) return;
        try {
            const target = await API.getUserByUsername(username);
            const res = await API.addChannelSubscriber(channelSettingsId, target.id);
            showNotification(res && res.added === false
                ? (i18n.already_subscribed || 'Already a subscriber')
                : (i18n.subscriber_added || 'Subscriber added'));
            document.getElementById('ch-add-subscriber-input').value = '';
            loadChannelSubscribersTab(channelSettingsId);
        } catch (err) { showNotification(localizedError(err)); }
    });
    const channelForm = document.getElementById('channel-form');
    if (channelForm) channelForm.addEventListener('submit', handleChannelFormSubmit);
    const channelAvatarFile = document.getElementById('channel-avatar-file');
    if (channelAvatarFile) channelAvatarFile.addEventListener('change', handleChannelAvatarSelect);
    const chAvatarInput = document.getElementById('ch-avatar-input');
    if (chAvatarInput) chAvatarInput.addEventListener('change', handleChannelSettingsAvatarUpload);
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = document.getElementById(btn.dataset.modalClose);
            if (modal) closeModalFx(modal);
        });
    });
}
