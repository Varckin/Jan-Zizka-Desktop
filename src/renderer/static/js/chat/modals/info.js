import { STATE } from '../state.js';
import { DOM, i18n } from '../dom.js';
import { createUserDisplay, createVerifiedBadge, formatLastSeen, localizedError, pluralT, t } from '../format.js';
import * as API from '../api.js';
import { showNotification } from '../dialogs.js';
import { loadChats } from '../chatList.js';
import { renderGroupMembersCount } from '../ui/onlineStatus.js';
import { contactNickname, isContactNow, loadContacts, isContactsPopupOpen, renderContactsList } from '../contacts.js';
import { openModalFx, closeModalFx } from '../modalFx.js';
import { mountChatMediaBrowser } from '../chatMedia.js';

export async function openInfoModal() {
    if (!STATE.currentChatId) return;
    const chatData = STATE.chatsMap[STATE.currentChatId];
    if (!chatData) return;
    if (chatData.type === 'channel') {
        const { openChannelInfo } = await import('../channels.js');
        openChannelInfo(STATE.currentChatId);
        return;
    }

    _infoProfileSeq++;
    resetInfoModalFields();

    const isGroup = chatData.type === 'group';
    if (isGroup) await renderGroupInfo(chatData);
    else {
        const ok = await renderDirectInfo();
        if (!ok) return;
    }
    openModalFx(DOM.infoModal);
}

let _infoProfileSeq = 0;

function resetInfoModalFields() {
    DOM.infoAvatar.src = 'data:,';
    DOM.infoAvatar.classList.add('is-hidden');
    DOM.infoAvatarPlaceholder.classList.add('is-hidden');
    DOM.infoAvatarInitials.textContent = '';
    DOM.infoDisplayName.textContent = '';
    DOM.infoUsername.textContent = '';
    DOM.infoUsername.classList.add('is-hidden');
    DOM.infoSubtitle.textContent = '';
    DOM.infoSubtitle.classList.remove('is-online');
    DOM.infoBioContainer.innerHTML = '';
    DOM.infoBioContainer.classList.add('is-hidden');
    DOM.infoJoined.textContent = '';
    DOM.infoLastLogin.textContent = '';
    DOM.infoGeo.textContent = '';
    DOM.infoGeoItem.classList.add('is-hidden');
    DOM.infoLang.textContent = '';
    DOM.infoLangItem.classList.add('is-hidden');
    DOM.infoDescriptionItem.classList.add('is-hidden');
    DOM.infoDescriptionText.textContent = '';
    DOM.infoMembersSection.classList.add('is-hidden');
    DOM.infoMembersList.innerHTML = '';
    DOM.infoMembersCount.textContent = '';
    DOM.infoActions.innerHTML = '';
    DOM.infoActions.classList.add('is-hidden');
    DOM.infoActions.classList.remove('is-visible');
    DOM.infoMediaSection.classList.add('is-hidden');
    DOM.infoMediaBrowser.innerHTML = '';
    delete DOM.infoMediaSection.dataset.chatId;
    const infoContent = DOM.infoModal.querySelector('.info-modal-content');
    if (infoContent) infoContent.classList.remove('has-media');
    const joinedItem = DOM.infoJoined.closest('.info-meta-item');
    if (joinedItem) joinedItem.classList.add('is-hidden');
    const lastLoginItem = DOM.infoLastLogin.closest('.info-meta-item');
    if (lastLoginItem) lastLoginItem.classList.add('is-hidden');
}

function setInfoAvatar(url, label) {
    if (url) {
        DOM.infoAvatar.src = url;
        DOM.infoAvatar.classList.remove('is-hidden');
        DOM.infoAvatarPlaceholder.classList.add('is-hidden');
    } else {
        DOM.infoAvatar.src = 'data:,';
        DOM.infoAvatar.classList.add('is-hidden');
        DOM.infoAvatarPlaceholder.classList.remove('is-hidden');
        DOM.infoAvatarInitials.textContent = (label || '?').charAt(0).toUpperCase();
    }
}

function restartInfoSwapAnimation() {
    const content = DOM.infoModal.querySelector('.info-modal-content');
    if (!content) return;
    content.classList.remove('is-swapping');
    void content.offsetWidth;
    content.classList.add('is-swapping');
}

export async function openUserProfileModal(user) {
    if (!user || !user.username) return;
    const seq = ++_infoProfileSeq;
    const wasOpen = DOM.infoModal.classList.contains('is-open');
    resetInfoModalFields();

    const userId = user.userId != null ? user.userId : null;
    const nickname = userId != null ? contactNickname(userId) : null;
    const fallbackLabel = nickname
        || [user.firstName, user.lastName].filter(n => n && String(n).trim()).join(' ').trim()
        || user.username;

    if (nickname) DOM.infoDisplayName.textContent = nickname;
    else DOM.infoDisplayName.appendChild(createUserDisplay(user.firstName, user.lastName, user.username));

    DOM.infoUsername.textContent = '@' + user.username;
    DOM.infoUsername.classList.remove('is-hidden');

    DOM.infoSubtitle.classList.remove('is-online');
    if (user.online === true) {
        DOM.infoSubtitle.textContent = t('status_online', 'online');
        DOM.infoSubtitle.classList.add('is-online');
    } else if (user.online === false) {
        DOM.infoSubtitle.textContent = formatLastSeen(user.lastSeen);
    } else {
        DOM.infoSubtitle.textContent = t('user', 'User');
    }

    setInfoAvatar(user.avatarUrl || null, fallbackLabel);
    renderInfoUserActions(userId, user.username);

    openModalFx(DOM.infoModal);
    if (wasOpen) restartInfoSwapAnimation();

    try {
        const profile = await API.getPublicProfile(user.username);
        if (seq !== _infoProfileSeq) return;
        if (!nickname) {
            DOM.infoDisplayName.textContent = '';
            DOM.infoDisplayName.appendChild(createUserDisplay(profile.first_name, profile.last_name, profile.username));
        }
        const label = nickname
            || [profile.first_name, profile.last_name].filter(n => n && String(n).trim()).join(' ').trim()
            || profile.username;
        setInfoAvatar(profile.avatar || user.avatarUrl || null, label);
        if (profile.bio) {
            DOM.infoBioContainer.textContent = profile.bio;
            DOM.infoBioContainer.classList.remove('is-hidden');
        }
        if (profile.geo_code) {
            setInfoTag(DOM.infoGeo, profile.geo_code, geoTagName(profile.geo_code));
            DOM.infoGeoItem.classList.remove('is-hidden');
        }
        if (profile.lang) {
            setInfoTag(DOM.infoLang, profile.lang, langTagName(profile.lang));
            DOM.infoLangItem.classList.remove('is-hidden');
        }
        if (profile.is_service) {
            const serviceFull = [profile.first_name, profile.last_name]
                .filter(n => n && String(n).trim())
                .join(' ')
                .trim();
            DOM.infoDisplayName.textContent = serviceFull || profile.username;
            DOM.infoDisplayName.appendChild(createVerifiedBadge());
            DOM.infoUsername.textContent = profile.username;
            DOM.infoSubtitle.textContent = '';
            DOM.infoSubtitle.classList.add('is-hidden');
            DOM.infoSubtitle.classList.remove('is-online');
            DOM.infoActions.innerHTML = '';
            DOM.infoActions.classList.add('is-hidden');
            DOM.infoActions.classList.remove('is-visible');
            DOM.infoMediaSection.classList.add('is-hidden');
            DOM.infoMediaBrowser.innerHTML = '';
            delete DOM.infoMediaSection.dataset.chatId;
            const serviceContentEl = DOM.infoModal.querySelector('.info-modal-content');
            if (serviceContentEl) serviceContentEl.classList.remove('has-media');
        } else if (profile.is_admin) {
            DOM.infoDisplayName.appendChild(createVerifiedBadge('staff'));
        }
    } catch (err) {
        if (seq !== _infoProfileSeq) return;
        showNotification(localizedError(err, i18n.error_get_profile || 'Failed to get profile'));
    }

    if (user.online === undefined && userId != null && STATE.currentChatId && STATE.currentChatType === 'group') {
        try {
            const members = await API.getMembers(STATE.currentChatId);
            if (seq !== _infoProfileSeq) return;
            const member = members.find(mm => mm.user_id === userId);
            if (member) {
                DOM.infoSubtitle.classList.toggle('is-online', !!member.online);
                DOM.infoSubtitle.textContent = member.online
                    ? t('status_online', 'online')
                    : formatLastSeen(member.last_seen);
            }
        } catch {
            if (seq !== _infoProfileSeq) return;
        }
    }
}

function renderInfoUserActions(userId, username, isService) {
    const actions = DOM.infoActions;
    actions.innerHTML = '';
    actions.classList.remove('is-visible');
    if (isService || userId == null || userId === STATE.currentUserId) {
        actions.classList.add('is-hidden');
        return;
    }

    const dialogBtn = document.createElement('button');
    dialogBtn.type = 'button';
    dialogBtn.className = 'btn-primary info-action-btn';
    dialogBtn.textContent = t('open_direct_chat', 'Open direct chat');
    dialogBtn.addEventListener('animationend', () => { dialogBtn.style.animation = 'none'; }, { once: true });
    dialogBtn.addEventListener('click', async () => {
        dialogBtn.disabled = true;
        try {
            const existing = Object.values(STATE.chatsMap).find(c => c.type === 'direct' && c.other_user_id === userId);
            let chatId = existing ? existing.id : null;
            closeModalFx(DOM.infoModal);
            if (chatId == null) {
                const data = await API.startDirectChat(username);
                chatId = data.chat_id;
                if (data.existing) showNotification((i18n.chat_exists || 'Chat with {username} already exists. Opening it.').replace('{username}', username));
                await loadChats(false);
            }
            const item = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
            if (item) item.click();
        } catch (err) {
            showNotification(localizedError(err));
        } finally {
            dialogBtn.disabled = false;
        }
    });

    const contactBtn = document.createElement('button');
    contactBtn.type = 'button';
    contactBtn.className = 'btn-secondary info-action-btn';
    contactBtn.addEventListener('animationend', () => { contactBtn.style.animation = 'none'; }, { once: true });
    const syncContactBtn = () => {
        const inContacts = isContactNow(userId);
        contactBtn.textContent = inContacts ? t('in_contacts', 'In contacts') : t('add_to_contacts', 'Add to contacts');
        contactBtn.disabled = inContacts;
        contactBtn.classList.toggle('is-done', inContacts);
    };
    syncContactBtn();
    contactBtn.addEventListener('click', async () => {
        contactBtn.disabled = true;
        try {
            await API.addContact(userId, null);
            showNotification(i18n.contact_added || 'Contact added');
            await loadContacts();
            if (isContactsPopupOpen()) renderContactsList();
            syncContactBtn();
        } catch (err) {
            showNotification(localizedError(err));
            syncContactBtn();
        }
    });

    actions.append(dialogBtn, contactBtn);
    actions.classList.remove('is-hidden');
    actions.classList.remove('is-visible');
    void actions.offsetWidth;
    actions.classList.add('is-visible');
}

async function renderGroupInfo(chatData) {
    DOM.infoDisplayName.textContent = chatData.name || t('group_chat', 'Group');
    DOM.infoUsername.classList.add('is-hidden');
    DOM.infoSubtitle.textContent = t('group_chat', 'Group');
    DOM.infoSubtitle.classList.remove('is-hidden', 'is-online');
    if (chatData.avatar) {
        DOM.infoAvatar.src = chatData.avatar;
        DOM.infoAvatar.classList.remove('is-hidden');
        DOM.infoAvatarPlaceholder.classList.add('is-hidden');
    } else {
        DOM.infoAvatar.classList.add('is-hidden');
        DOM.infoAvatarPlaceholder.classList.remove('is-hidden');
        DOM.infoAvatarInitials.textContent = (chatData.name || '?')[0].toUpperCase();
    }
    if (chatData.description) {
        DOM.infoDescriptionItem.classList.remove('is-hidden');
        DOM.infoDescriptionText.textContent = chatData.description;
    }
    const joinedItem = DOM.infoJoined.closest('.info-meta-item');
    if (joinedItem) joinedItem.classList.add('is-hidden');
    const lastLoginItem = DOM.infoLastLogin.closest('.info-meta-item');
    if (lastLoginItem) lastLoginItem.classList.add('is-hidden');
    try {
        const members = await API.getMembers(STATE.currentChatId);
        const onlineCount = members.filter(m => m.online).length;
        DOM.infoSubtitle.textContent = formatMembersSummary(members.length, onlineCount);
        DOM.infoMembersCount.textContent = String(members.length);
        DOM.infoMembersSection.classList.remove('is-hidden');
        members.forEach(m => DOM.infoMembersList.appendChild(buildMemberLi(m)));
        chatData.members_count = members.length;
        chatData.online_members_count = onlineCount;
        renderGroupMembersCount(STATE.currentChatId);
    } catch (err) {
        DOM.infoMembersSection.classList.remove('is-hidden');
        const li = document.createElement('li');
        li.textContent = i18n.failed_load_members || 'Failed to load members';
        DOM.infoMembersList.appendChild(li);
    }
    mountChatMediaBrowser(DOM.infoMediaSection, DOM.infoMediaBrowser, DOM.infoModal.querySelector('.info-modal-content'), STATE.currentChatId);
}

function formatMembersSummary(membersCount, onlineCount) {
    const membersText = pluralT('members_count', membersCount, `${membersCount} members`);
    const onlineText = pluralT('online_count', onlineCount, `${onlineCount} online`);
    return `${membersText} · ${onlineText}`;
}

function buildMemberLi(m) {
    const li = document.createElement('li');
    li.dataset.userId = m.user_id;
    const avatarSpan = document.createElement('span');
    avatarSpan.className = 'member-avatar is-clickable';
    if (m.avatar_url) {
        const img = document.createElement('img');
        img.src = m.avatar_url;
        img.alt = m.username;
        img.className = 'member-avatar-img';
        avatarSpan.appendChild(img);
    } else avatarSpan.textContent = m.username.charAt(0).toUpperCase();
    const memberNickname = contactNickname(m.user_id);
    const avatarLabel = memberNickname
        || [m.first_name, m.last_name].filter(n => n && String(n).trim()).join(' ').trim()
        || m.username;
    avatarSpan.title = t('nav_profile', 'Profile');
    avatarSpan.setAttribute('role', 'button');
    avatarSpan.setAttribute('tabindex', '0');
    avatarSpan.setAttribute('aria-label', avatarLabel);
    const openProfile = e => {
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
    avatarSpan.addEventListener('click', openProfile);
    avatarSpan.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(e); }
    });
    li.appendChild(avatarSpan);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'member-name';
    if (memberNickname) nameSpan.textContent = memberNickname;
    else nameSpan.appendChild(createUserDisplay(m.first_name, m.last_name, m.username));
    if (m.is_admin) nameSpan.appendChild(createVerifiedBadge('staff'));
    li.appendChild(nameSpan);
    const onlineDot = document.createElement('span');
    onlineDot.className = 'member-online-dot';
    if (!m.online) onlineDot.classList.add('is-hidden');
    li.appendChild(onlineDot);
    const roleSpan = document.createElement('span');
    roleSpan.className = 'member-role';
    const memberRole = m.is_owner ? 'owner' : (m.role || '');
    if (memberRole === 'member') roleSpan.textContent = i18n.group_role_member || 'member';
    else if (memberRole) roleSpan.textContent = i18n[`role_${memberRole}`] || memberRole;
    li.appendChild(roleSpan);
    return li;
}

async function renderDirectInfo() {
    try {
        const chatData = STATE.chatsMap[STATE.currentChatId] || {};
        const members = await API.getMembers(STATE.currentChatId);
        const other = members.find(m => m.user_id !== STATE.currentUserId);
        if (!other) {
            showNotification('Could not find other user.');
            closeModalFx(DOM.infoModal);
            return false;
        }
        const profile = await API.getPublicProfile(other.username);
        const isService = !!(profile.is_service || chatData.other_user_is_service);
        const isAdmin = !isService && !!(profile.is_admin || chatData.other_user_is_admin);

        const nickname = isService ? null : contactNickname(other.user_id);
        DOM.infoDisplayName.textContent = '';
        if (nickname) {
            DOM.infoDisplayName.textContent = nickname;
        } else if (isService) {
            const serviceFull = [profile.first_name, profile.last_name]
                .filter(n => n && String(n).trim())
                .join(' ')
                .trim();
            DOM.infoDisplayName.textContent = serviceFull || profile.username;
        } else {
            DOM.infoDisplayName.appendChild(
                createUserDisplay(profile.first_name, profile.last_name, profile.username)
            );
        }
        if (isService) DOM.infoDisplayName.appendChild(createVerifiedBadge());
        else if (isAdmin) DOM.infoDisplayName.appendChild(createVerifiedBadge('staff'));

        DOM.infoUsername.textContent = isService ? profile.username : '@' + profile.username;
        DOM.infoUsername.classList.remove('is-hidden');

        if (isService) {
            DOM.infoSubtitle.textContent = '';
            DOM.infoSubtitle.classList.add('is-hidden');
            DOM.infoSubtitle.classList.remove('is-online');
        } else {
            const isOnline = other.online || !!chatData.other_user_online;
            DOM.infoSubtitle.classList.remove('is-hidden');
            if (isOnline) {
                DOM.infoSubtitle.textContent = t('status_online', 'online');
                DOM.infoSubtitle.classList.add('is-online');
            } else {
                DOM.infoSubtitle.textContent = formatLastSeen(other.last_seen || chatData.other_user_last_seen);
                DOM.infoSubtitle.classList.remove('is-online');
            }
        }

        if (profile.avatar) {
            DOM.infoAvatar.src = profile.avatar;
            DOM.infoAvatar.classList.remove('is-hidden');
            DOM.infoAvatarPlaceholder.classList.add('is-hidden');
        } else {
            DOM.infoAvatar.classList.add('is-hidden');
            DOM.infoAvatarPlaceholder.classList.remove('is-hidden');
            DOM.infoAvatarInitials.textContent = (profile.username || '?')[0].toUpperCase();
        }

        if (profile.bio) {
            DOM.infoBioContainer.textContent = profile.bio;
            DOM.infoBioContainer.classList.remove('is-hidden');
        } else {
            DOM.infoBioContainer.textContent = '';
            DOM.infoBioContainer.classList.add('is-hidden');
        }

        if (profile.geo_code) {
            setInfoTag(DOM.infoGeo, profile.geo_code, geoTagName(profile.geo_code));
            DOM.infoGeoItem.classList.remove('is-hidden');
        } else {
            DOM.infoGeo.textContent = '';
            DOM.infoGeoItem.classList.add('is-hidden');
        }

        if (profile.lang) {
            setInfoTag(DOM.infoLang, profile.lang, langTagName(profile.lang));
            DOM.infoLangItem.classList.remove('is-hidden');
        } else {
            DOM.infoLang.textContent = '';
            DOM.infoLangItem.classList.add('is-hidden');
        }

        const lastLoginItem = DOM.infoLastLogin.closest('.info-meta-item');
        if (lastLoginItem) lastLoginItem.classList.add('is-hidden');
        const joinedItem = DOM.infoJoined.closest('.info-meta-item');
        if (joinedItem) joinedItem.classList.add('is-hidden');
        DOM.infoDescriptionItem.classList.add('is-hidden');
        DOM.infoMembersSection.classList.add('is-hidden');
        renderInfoUserActions(other.user_id, profile.username, isService);
        if (!isService) {
            mountChatMediaBrowser(DOM.infoMediaSection, DOM.infoMediaBrowser, DOM.infoModal.querySelector('.info-modal-content'), STATE.currentChatId);
        }

        return true;
    } catch (err) {
        showNotification('Failed to load profile: ' + err.message);
        closeModalFx(DOM.infoModal);
        return false;
    }
}

function geoTagName(geoCode) {
    const code = String(geoCode || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (!code) return '';
    const info = (window.COUNTRIES || {})[code];
    return info && info.name ? info.name : '';
}

function langTagName(langCode) {
    const raw = String(langCode || '').trim();
    if (!raw) return '';
    const info = (window.LANGUAGES || {})[raw.toLowerCase()];
    return info && info.name ? info.name : '';
}

function setInfoTag(el, code, name) {
    if (!el) return;
    el.textContent = '';
    const cleanCode = String(code || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (!cleanCode) return;
    const badge = document.createElement('span');
    badge.className = 'code-badge';
    badge.textContent = cleanCode;
    el.appendChild(badge);
    if (name) el.appendChild(document.createTextNode(' ' + name));
}
