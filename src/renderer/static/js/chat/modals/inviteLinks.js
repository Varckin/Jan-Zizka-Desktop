import { STATE } from '../state.js';
import { DOM, i18n, setTextContent } from '../dom.js';
import { t, tf, formatRelativeTime } from '../format.js';
import * as API from '../api.js';
import { showNotification, showConfirm } from '../dialogs.js';

const EXPIRE_OPTIONS = ['1h', '12h', '24h', '7d', '30d', 'forever'];
const MAX_USAGE_LIMIT = 1000;

export function inviteLinkUrl(code) {
    return `${window.location.origin}/chat/join/${code}`;
}

function currentLinksChatId() {
    return STATE.settingsChatId || STATE.currentChatId;
}

function formatInviteDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
}

function inviteStatusText(status) {
    return t(`invite_status_${status}`, status);
}

async function copyTextToClipboard(text) {
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

export async function loadInviteLinks(chatId) {
    const list = DOM.inviteLinksList;
    if (!list) return;
    const targetChatId = chatId || currentLinksChatId();
    if (!targetChatId) return;
    setTextContent(list, i18n.loading || 'Loading...', 'loading');
    try {
        const links = await API.getInviteLinks(targetChatId);
        list.innerHTML = '';
        if (!links.length) {
            setTextContent(list, t('invite_no_links', 'No invite links yet'), 'empty-state');
            return;
        }
        links.forEach(link => list.appendChild(buildInviteLinkItem(link, targetChatId)));
    } catch (err) {
        setTextContent(list, t('invite_failed_load', 'Failed to load invite links') + ': ' + err.message, 'error');
    }
}

function buildInviteMeta(link) {
    const meta = document.createElement('div');
    meta.className = 'invite-link-meta';
    const created = document.createElement('span');
    created.textContent = tf('invite_created_at', 'Created {date}', { date: formatRelativeTime(link.created_at) });
    meta.appendChild(created);
    const expires = document.createElement('span');
    expires.textContent = link.expires_at
        ? tf('invite_expires_at', 'Expires {date}', { date: formatInviteDate(link.expires_at) })
        : t('invite_never_expires', 'No expiration');
    meta.appendChild(expires);
    const usage = document.createElement('span');
    usage.textContent = link.usage_limit
        ? tf('invite_used_of', '{used} of {limit} used', { used: link.used_count, limit: link.usage_limit })
        : tf('invite_used_total', '{used} used', { used: link.used_count });
    meta.appendChild(usage);
    if (link.creator_username) {
        const creator = document.createElement('span');
        creator.textContent = tf('invite_created_by', 'Created by {name}', { name: link.creator_username });
        meta.appendChild(creator);
    }
    return meta;
}

function buildInviteEditForm(link, chatId, item) {
    const form = document.createElement('div');
    form.className = 'invite-edit-form is-hidden';
    const expiresSelect = document.createElement('select');
    const keepOption = document.createElement('option');
    keepOption.value = '';
    keepOption.textContent = '—';
    expiresSelect.appendChild(keepOption);
    EXPIRE_OPTIONS.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = t(`invite_expire_${value}`, value);
        expiresSelect.appendChild(option);
    });
    const limitInput = document.createElement('input');
    limitInput.type = 'number';
    limitInput.min = '0';
    limitInput.max = String(MAX_USAGE_LIMIT);
    limitInput.step = '1';
    limitInput.placeholder = link.usage_limit ? String(link.usage_limit) : t('invite_unlimited', 'Unlimited');
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = i18n.save || 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = i18n.cancel || 'Cancel';
    saveBtn.addEventListener('click', async () => {
        const payload = {};
        if (expiresSelect.value) payload.expires_in = expiresSelect.value;
        const rawLimit = limitInput.value.trim();
        if (rawLimit !== '') {
            const limit = parseInt(rawLimit, 10);
            if (Number.isNaN(limit) || limit < 0 || limit > MAX_USAGE_LIMIT) {
                showNotification(t('invite_invalid_limit', 'Usage limit must be between 0 and 1000'));
                return;
            }
            payload.usage_limit = limit;
        }
        if (!Object.keys(payload).length) {
            form.classList.add('is-hidden');
            return;
        }
        try {
            await API.updateInviteLink(chatId, link.id, payload);
            showNotification(t('invite_updated', 'Invite link updated'));
            loadInviteLinks(chatId);
        } catch (err) {
            showNotification(t('invite_failed_update', 'Failed to update invite link') + ': ' + err.message);
        }
    });
    cancelBtn.addEventListener('click', () => form.classList.add('is-hidden'));
    form.append(expiresSelect, limitInput, saveBtn, cancelBtn);
    item._toggleEditForm = () => form.classList.toggle('is-hidden');
    return form;
}

function buildInviteLinkItem(link, chatId) {
    const item = document.createElement('div');
    item.className = 'invite-link-item';
    item.dataset.linkId = link.id;
    const main = document.createElement('div');
    main.className = 'invite-link-main';
    const top = document.createElement('div');
    top.className = 'invite-link-top';
    const url = document.createElement('span');
    url.className = 'invite-link-url';
    url.textContent = inviteLinkUrl(link.invite_code);
    url.title = url.textContent;
    top.appendChild(url);
    const badge = document.createElement('span');
    badge.className = `invite-badge invite-badge-${link.status}`;
    badge.textContent = inviteStatusText(link.status);
    top.appendChild(badge);
    main.appendChild(top);
    main.appendChild(buildInviteMeta(link));
    item.appendChild(main);
    item.appendChild(buildInviteEditForm(link, chatId, item));
    const actions = document.createElement('div');
    actions.className = 'invite-link-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-secondary';
    copyBtn.textContent = t('invite_copy', 'Copy');
    copyBtn.addEventListener('click', () => copyTextToClipboard(inviteLinkUrl(link.invite_code)));
    actions.appendChild(copyBtn);
    if (link.status !== 'revoked') {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn-secondary';
        editBtn.textContent = i18n.edit || 'Edit';
        editBtn.addEventListener('click', () => item._toggleEditForm());
        actions.appendChild(editBtn);
        const revokeBtn = document.createElement('button');
        revokeBtn.type = 'button';
        revokeBtn.className = 'btn-danger';
        revokeBtn.textContent = t('invite_revoke', 'Revoke');
        revokeBtn.addEventListener('click', async () => {
            const confirmed = await showConfirm(t('invite_revoke_confirm', 'Revoke this invite link?'));
            if (!confirmed) return;
            try {
                await API.revokeInviteLink(chatId, link.id);
                showNotification(t('invite_revoked', 'Invite link revoked'));
                loadInviteLinks(chatId);
            } catch (err) {
                showNotification(t('invite_failed_revoke', 'Failed to revoke invite link') + ': ' + err.message);
            }
        });
        actions.appendChild(revokeBtn);
    }
    item.appendChild(actions);
    return item;
}

export async function handleInviteCreate() {
    const chatId = currentLinksChatId();
    if (!chatId) return;
    const payload = { expires_in: DOM.inviteExpiresSelect.value || 'forever' };
    const rawLimit = DOM.inviteLimitInput.value.trim();
    if (rawLimit !== '') {
        const limit = parseInt(rawLimit, 10);
        if (Number.isNaN(limit) || limit < 1 || limit > MAX_USAGE_LIMIT) {
            showNotification(t('invite_invalid_limit', 'Usage limit must be between 0 and 1000'));
            return;
        }
        payload.usage_limit = limit;
    }
    try {
        await API.createInviteLink(chatId, payload);
        DOM.inviteLimitInput.value = '';
        showNotification(t('invite_created', 'Invite link created'));
        loadInviteLinks(chatId);
    } catch (err) {
        showNotification(t('invite_failed_create', 'Failed to create invite link') + ': ' + err.message);
    }
}

export function bindInviteLinksEvents() {
    if (DOM.inviteCreateBtn) DOM.inviteCreateBtn.addEventListener('click', handleInviteCreate);
}
