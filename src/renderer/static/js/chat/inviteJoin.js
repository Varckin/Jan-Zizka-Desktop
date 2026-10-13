import { DOM } from './dom.js';
import { t, tf, formatCompactCount } from './format.js';
import * as API from './api.js';
import { showNotification } from './dialogs.js';
import { openModalFx, closeModalFx } from './modalFx.js';
import { loadChats, selectChat } from './chatList.js';

let _inviteCode = null;
let _inviteInfo = null;
let _inviteBusy = false;

function closeInviteJoinModal() {
    closeModalFx(DOM.inviteJoinModal);
    _inviteCode = null;
    _inviteInfo = null;
}

function renderInviteAvatar(info) {
    const img = DOM.inviteJoinAvatar;
    const placeholder = DOM.inviteJoinAvatarPlaceholder;
    const initials = DOM.inviteJoinInitials;
    const name = info.name || '';
    initials.textContent = name.trim() ? name.trim()[0].toUpperCase() : '?';
    if (info.avatar_url) {
        img.classList.remove('is-hidden');
        placeholder.classList.add('is-hidden');
        img.onerror = () => {
            img.classList.add('is-hidden');
            img.src = 'data:,';
            placeholder.classList.remove('is-hidden');
        };
        img.src = info.avatar_url;
    } else {
        img.classList.add('is-hidden');
        img.src = 'data:,';
        placeholder.classList.remove('is-hidden');
    }
}

function setInviteError(text) {
    DOM.inviteJoinError.textContent = text;
    DOM.inviteJoinError.classList.toggle('is-hidden', !text);
}

function inviteStatusMessage(status) {
    if (status === 'expired') return t('invite_link_expired', 'This invite link has expired');
    if (status === 'revoked') return t('invite_link_revoked', 'This invite link was revoked');
    if (status === 'exhausted') return t('invite_link_exhausted', 'This invite link has reached its usage limit');
    return t('invite_invalid', 'This invite link is invalid');
}

function renderInviteJoinModal() {
    const info = _inviteInfo;
    const confirmBtn = DOM.inviteJoinConfirm;
    const cancelBtn = DOM.inviteJoinCancel;
    DOM.inviteJoinName.textContent = info.name || '';
    renderInviteAvatar(info);
    const membersText = formatMembersCount(info.members_count);
    if (info.is_member) {
        DOM.inviteJoinMeta.textContent = `${membersText} · ${t('invite_already_member', 'You are already a member of this group')}`;
        setInviteError('');
        confirmBtn.textContent = t('invite_open_chat', 'Open chat');
        confirmBtn.classList.remove('is-hidden');
        cancelBtn.classList.remove('is-hidden');
    } else if (info.valid) {
        DOM.inviteJoinMeta.textContent = membersText;
        setInviteError('');
        confirmBtn.textContent = t('invite_join_action', 'Join');
        confirmBtn.classList.remove('is-hidden');
        cancelBtn.classList.remove('is-hidden');
    } else {
        DOM.inviteJoinMeta.textContent = membersText;
        setInviteError(inviteStatusMessage(info.status));
        confirmBtn.classList.add('is-hidden');
        cancelBtn.classList.remove('is-hidden');
    }
    if (info.description) {
        DOM.inviteJoinDescription.textContent = info.description;
        DOM.inviteJoinDescription.classList.remove('is-hidden');
    } else {
        DOM.inviteJoinDescription.textContent = '';
        DOM.inviteJoinDescription.classList.add('is-hidden');
    }
}

function formatMembersCount(count) {
    return tf('invite_members_count', '{count} members', { count: formatCompactCount(count || 0) });
}

async function openChatFromInvite(chatId, name) {
    closeInviteJoinModal();
    await loadChats(false);
    selectChat(chatId, name);
}

async function handleInviteJoinConfirm() {
    if (_inviteBusy || !_inviteInfo) return;
    if (_inviteInfo.is_member) {
        openChatFromInvite(_inviteInfo.chat_id, _inviteInfo.name);
        return;
    }
    if (!_inviteInfo.valid || !_inviteCode) return;
    _inviteBusy = true;
    DOM.inviteJoinConfirm.disabled = true;
    try {
        const data = await API.joinByInvite(_inviteCode);
        showNotification(t('invite_joined', 'You joined the group'));
        await openChatFromInvite(data.chat_id, data.name);
    } catch (err) {
        setInviteError(err.message || t('invite_join_failed', 'Failed to join the group'));
    } finally {
        _inviteBusy = false;
        DOM.inviteJoinConfirm.disabled = false;
    }
}

export async function handleInviteParam() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('invite');
    if (!code) return;
    params.delete('invite');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    _inviteCode = code;
    try {
        _inviteInfo = await API.getInviteInfo(code);
    } catch (err) {
        _inviteCode = null;
        _inviteInfo = null;
        showNotification(t('invite_invalid', 'This invite link is invalid'));
        return;
    }
    renderInviteJoinModal();
    openModalFx(DOM.inviteJoinModal);
}

export function bindInviteJoinEvents() {
    if (!DOM.inviteJoinModal) return;
    DOM.inviteJoinClose.addEventListener('click', closeInviteJoinModal);
    DOM.inviteJoinCancel.addEventListener('click', closeInviteJoinModal);
    DOM.inviteJoinConfirm.addEventListener('click', handleInviteJoinConfirm);
    DOM.inviteJoinModal.addEventListener('click', function(e) { if (e.target === this) closeInviteJoinModal(); });
}
