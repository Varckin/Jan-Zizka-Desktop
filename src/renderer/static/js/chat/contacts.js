import { STATE } from './state.js';
import { DOM, i18n } from './dom.js';
import { appendVerifiedBadge, createVerifiedBadge, formatLastSeen, localizedError, t, tf } from './format.js';
import * as API from './api.js';
import { showNotification, showConfirm, showPrompt } from './dialogs.js';
import { clampToViewport } from '../core_chat/dom.js';
import { updateMenuLink, createMenuLink } from './ui/menuLink.js';

let contactsMenuEl = null;
let contactsMenuCloser = null;
let popupSession = 0;
let resizeTimer = null;
let contactsInFlight = null;

function isFinePointer() {
    return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
}

export function isContactNow(userId) {
    return STATE.contacts.some(c => c.user_id === userId);
}

export function contactNickname(userId) {
    if (userId == null) return null;
    const contact = STATE.contacts.find(c => c.user_id === userId);
    return (contact && contact.nickname) || null;
}

export function nicknameByUsername(username) {
    if (!username) return null;
    const needle = String(username).toLowerCase();
    const contact = STATE.contacts.find(c => (c.username || '').toLowerCase() === needle);
    return (contact && contact.nickname) || null;
}

export function contactDisplayName(userId, fallback) {
    return contactNickname(userId) || fallback;
}

export function chatDisplayName(chat) {
    if (chat && chat.type === 'direct') {
        const nickname = contactNickname(chat.other_user_id);
        if (nickname) return nickname;
    }
    return chat ? chat.name : '';
}

export function syncChatItemNames() {
    document.querySelectorAll('.chat-item[data-type="direct"]').forEach(item => {
        const userId = parseInt(item.dataset.otherUserId, 10);
        const chat = STATE.chatsMap[item.dataset.chatId];
        const name = contactNickname(userId) || (chat && chat.name) || '';
        if (!name) return;
        const nameEl = item.querySelector('.name-text');
        if (nameEl) nameEl.textContent = name;
        const avatarDiv = item.querySelector('.avatar');
        if (avatarDiv) avatarDiv.textContent = name.charAt(0).toUpperCase();
        if (chat && String(chat.id) === String(STATE.currentChatId) && DOM.chatNameSpan) {
            DOM.chatNameSpan.textContent = name;
            appendVerifiedBadge(DOM.chatNameSpan, chat);
        }
    });
}

export function loadContacts() {
    if (contactsInFlight) return contactsInFlight;
    contactsInFlight = performLoadContacts().finally(() => {
        contactsInFlight = null;
    });
    return contactsInFlight;
}

async function performLoadContacts() {
    try {
        const contacts = await API.fetchContacts();
        STATE.contacts = Array.isArray(contacts) ? contacts : [];
        STATE.contactsLoaded = true;
    } catch (err) {
        console.warn('Failed to load contacts:', err);
    }
    syncChatItemContactLinks();
    syncChatItemNames();
    import('./ui/message.js')
        .then(m => m.syncMessageSenderNames())
        .catch(() => {});
    return STATE.contacts;
}

export function initContactsPopup() {
    if (!DOM.contactsBtn || !DOM.contactsPopup) return;
    DOM.contactsBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleContactsPopup();
    });
    DOM.contactsPopupClose.addEventListener('click', hideContactsPopup);
    DOM.contactsSearchInput.addEventListener('input', () => renderContactsList());
    DOM.contactsSearchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            hideContactsPopup();
        }
    });
    document.addEventListener('click', e => {
        if (!isContactsPopupOpen()) return;
        if (DOM.contactsPopup.contains(e.target) || DOM.contactsBtn.contains(e.target)) return;
        if (contactsMenuEl && contactsMenuEl.contains(e.target)) return;
        if (DOM.dialogOverlay && DOM.dialogOverlay.contains(e.target)) return;
        hideContactsPopup();
    }, true);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && isContactsPopupOpen()) hideContactsPopup();
    });
    window.addEventListener('resize', () => {
        if (!isContactsPopupOpen()) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            if (isContactsPopupOpen()) positionContactsPopup();
        }, 120);
    });
    window.addEventListener('orientationchange', () => {
        if (isContactsPopupOpen()) positionContactsPopup();
    });
}

export function isContactsPopupOpen() {
    return DOM.contactsPopup.classList.contains('show');
}

export function toggleContactsPopup() {
    if (isContactsPopupOpen()) hideContactsPopup();
    else showContactsPopup();
}

export async function showContactsPopup() {
    const session = ++popupSession;
    DOM.contactsPopup.classList.remove('is-hidden');
    positionContactsPopup();
    requestAnimationFrame(() => {
        if (session === popupSession) DOM.contactsPopup.classList.add('show');
    });
    DOM.contactsBtn.classList.add('is-active');
    DOM.contactsBtn.setAttribute('aria-expanded', 'true');
    if (!STATE.contactsLoaded) {
        renderContactsList('loading');
        await loadContacts();
        if (session === popupSession) renderContactsList();
    } else {
        renderContactsList();
        const previous = STATE.contacts.map(c => ({ ...c }));
        loadContacts().then(() => {
            if (session === popupSession) applyContactsRefresh(previous);
        });
    }
    setTimeout(() => {
        if (session === popupSession && isFinePointer()) DOM.contactsSearchInput.focus();
    }, 60);
}

export function hideContactsPopup() {
    popupSession++;
    if (!DOM.contactsPopup.classList.contains('show') && DOM.contactsPopup.classList.contains('is-hidden')) return;
    DOM.contactsPopup.classList.remove('show');
    DOM.contactsBtn.classList.remove('is-active');
    DOM.contactsBtn.setAttribute('aria-expanded', 'false');
    closeContactsItemMenu();
    setTimeout(() => {
        if (!DOM.contactsPopup.classList.contains('show')) DOM.contactsPopup.classList.add('is-hidden');
    }, 220);
}

function positionContactsPopup() {
    const rect = DOM.contactsBtn.getBoundingClientRect();
    const popup = DOM.contactsPopup;
    const width = Math.min(340, window.innerWidth - 20);
    popup.style.width = width + 'px';
    popup.classList.remove('is-hidden');
    popup.style.visibility = 'hidden';
    const height = popup.offsetHeight || 300;
    popup.style.visibility = '';
    let top = rect.top - height - 10;
    if (top < 10) top = rect.bottom + 10;
    const pos = clampToViewport(rect.left, top, width, height, 10);
    popup.style.left = pos.x + 'px';
    popup.style.top = pos.y + 'px';
}

function initialOf(contact) {
    const source = contact.display_name || contact.username || '?';
    return source.charAt(0).toUpperCase();
}

function filterContacts(query) {
    const q = (query || '').trim().toLowerCase();
    const contacts = STATE.contacts || [];
    if (!q) return contacts;
    return contacts.filter(c =>
        (c.display_name || '').toLowerCase().includes(q)
        || (c.username || '').toLowerCase().includes(q)
        || (c.nickname || '').toLowerCase().includes(q));
}

export function renderContactsList(status = 'ready') {
    const list = DOM.contactsList;
    if (!list) return;
    list.innerHTML = '';
    if (status === 'loading') {
        const div = document.createElement('div');
        div.className = 'contacts-popup-loading';
        div.textContent = i18n.loading || 'Loading...';
        list.appendChild(div);
        return;
    }
    const contacts = filterContacts(DOM.contactsSearchInput ? DOM.contactsSearchInput.value : '');
    if (!contacts.length) {
        const div = document.createElement('div');
        div.className = 'contacts-popup-empty';
        const hasQuery = !!(DOM.contactsSearchInput && DOM.contactsSearchInput.value.trim());
        div.textContent = hasQuery
            ? (i18n.no_contacts_found || 'Nothing found')
            : (i18n.no_contacts || 'No contacts yet');
        list.appendChild(div);
        return;
    }
    contacts.forEach(c => list.appendChild(buildContactItem(c)));
}

function applyContactsRefresh(previous) {
    const prevMap = new Map(previous.map(c => [c.user_id, c]));
    let structural = previous.length !== STATE.contacts.length;
    if (!structural) {
        for (const c of STATE.contacts) {
            const p = prevMap.get(c.user_id);
            if (!p
                || p.username !== c.username
                || p.display_name !== c.display_name
                || (p.nickname || null) !== (c.nickname || null)
                || (p.avatar || null) !== (c.avatar || null)
                || !!p.is_mutual !== !!c.is_mutual
                || (p.note || null) !== (c.note || null)) {
                structural = true;
                break;
            }
        }
    }
    if (structural) {
        renderContactsList();
        return;
    }
    for (const c of STATE.contacts) {
        const p = prevMap.get(c.user_id);
        if (p && (!!p.is_online !== !!c.is_online || (p.last_seen || null) !== (c.last_seen || null))) {
            handleContactStatus(c.user_id, !!c.is_online, c.last_seen || null);
        }
    }
}

function buildContactItem(contact) {
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.dataset.userId = contact.user_id;

    const avatar = document.createElement('div');
    avatar.className = 'contact-avatar';
    if (contact.avatar) {
        const img = document.createElement('img');
        img.src = contact.avatar;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            if (avatar.querySelector('img') !== img) return;
            img.remove();
            avatar.appendChild(document.createTextNode(initialOf(contact)));
        }, { once: true });
        avatar.appendChild(img);
    } else {
        avatar.textContent = initialOf(contact);
    }
    if (contact.is_online) {
        const dot = document.createElement('span');
        dot.className = 'contact-online-dot';
        avatar.appendChild(dot);
    }
    item.appendChild(avatar);

    const info = document.createElement('div');
    info.className = 'contact-info';
    const name = document.createElement('div');
    name.className = 'contact-name';
    name.textContent = contact.display_name || contact.username;
    if (contact.is_admin) name.appendChild(createVerifiedBadge('staff'));
    info.appendChild(name);
    const status = document.createElement('div');
    status.className = 'contact-status' + (contact.is_online ? ' is-online' : '');
    status.textContent = contact.is_online ? t('status_online', 'online') : formatLastSeen(contact.last_seen);
    info.appendChild(status);
    item.appendChild(info);

    if (contact.is_mutual) {
        const mutual = document.createElement('span');
        mutual.className = 'contact-mutual';
        mutual.textContent = '⇄';
        mutual.title = i18n.mutual_contact || 'Mutual contact';
        item.appendChild(mutual);
    }

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'contact-menu-btn';
    menuBtn.innerHTML = '⋮';
    menuBtn.title = i18n.more || 'More';
    menuBtn.setAttribute('aria-label', i18n.more || 'More');
    menuBtn.addEventListener('click', e => {
        e.stopPropagation();
        openContactsItemMenu(contact, menuBtn);
    });
    item.appendChild(menuBtn);

    item.addEventListener('click', () => openContactChat(contact));
    return item;
}

function openContactsItemMenu(contact, anchorBtn) {
    closeContactsItemMenu();
    const menu = document.createElement('div');
    menu.className = 'contacts-item-menu';

    const rename = createMenuLink('renameContact', i18n.rename_contact || 'Rename', 'edit');
    rename.addEventListener('click', e => {
        e.stopPropagation();
        closeContactsItemMenu();
        handleRenameContact(contact);
    });
    menu.appendChild(rename);

    const remove = createMenuLink('removeContact', i18n.remove_from_contacts || 'Remove from contacts', 'trash');
    remove.classList.add('danger');
    remove.addEventListener('click', e => {
        e.stopPropagation();
        closeContactsItemMenu();
        handleRemoveContact(contact);
    });
    menu.appendChild(remove);

    document.body.appendChild(menu);
    const rect = anchorBtn.getBoundingClientRect();
    const pos = clampToViewport(rect.right - menu.offsetWidth, rect.bottom + 4, menu.offsetWidth, menu.offsetHeight, 8);
    menu.style.left = pos.x + 'px';
    menu.style.top = pos.y + 'px';
    contactsMenuEl = menu;
    contactsMenuCloser = (e) => {
        if (contactsMenuEl && contactsMenuEl.contains(e.target)) return;
        closeContactsItemMenu();
    };
    setTimeout(() => document.addEventListener('click', contactsMenuCloser, { capture: true }), 0);
}

function closeContactsItemMenu() {
    if (contactsMenuEl) {
        contactsMenuEl.remove();
        contactsMenuEl = null;
    }
    if (contactsMenuCloser) {
        document.removeEventListener('click', contactsMenuCloser, { capture: true });
        contactsMenuCloser = null;
    }
}

async function handleRemoveContact(contact) {
    const name = contact.display_name || contact.username;
    const confirmed = await showConfirm(tf('confirm_remove_contact', 'Remove {name} from contacts?', { name }));
    if (!confirmed) return;
    try {
        await API.removeContact(contact.user_id);
        showNotification(i18n.contact_removed || 'Contact removed');
        await loadContacts();
        if (isContactsPopupOpen()) renderContactsList();
    } catch (err) {
        showNotification(localizedError(err));
    }
}

async function handleRenameContact(contact) {
    const nickname = await showPrompt(
        i18n.enter_contact_nickname || 'Nickname (leave empty to reset)',
        contact.nickname || ''
    );
    if (nickname === null) return;
    try {
        await API.renameContact(contact.user_id, nickname.trim() || null);
        showNotification(i18n.contact_renamed || 'Contact updated');
        await loadContacts();
        if (isContactsPopupOpen()) renderContactsList();
    } catch (err) {
        showNotification(localizedError(err));
    }
}

export async function openContactChat(contact) {
    hideContactsPopup();
    const existing = Object.values(STATE.chatsMap).find(
        c => c.type === 'direct' && c.other_user_id === contact.user_id
    );
    if (existing) {
        const item = document.querySelector(`.chat-item[data-chat-id="${existing.id}"]`);
        if (item) {
            item.click();
            return;
        }
    }
    try {
        const data = await API.startDirectChat(contact.username);
        const { loadChats } = await import('./chatList.js');
        await loadChats(false);
        const item = document.querySelector(`.chat-item[data-chat-id="${data.chat_id}"]`);
        if (item) item.click();
    } catch (err) {
        showNotification(localizedError(err));
    }
}

export async function addContactFromChat(chat) {
    const userId = chat.other_user_id;
    if (!userId) return;
    try {
        await API.addContact(userId, null);
        showNotification(i18n.contact_added || 'Contact added');
        await loadContacts();
        if (isContactsPopupOpen()) renderContactsList();
    } catch (err) {
        showNotification(localizedError(err));
    }
}

export async function removeContactFromChat(chat) {
    const userId = chat.other_user_id;
    if (!userId) return;
    const contact = STATE.contacts.find(c => c.user_id === userId);
    const name = (contact && contact.display_name) || chat.name;
    const confirmed = await showConfirm(tf('confirm_remove_contact', 'Remove {name} from contacts?', { name }));
    if (!confirmed) return;
    try {
        await API.removeContact(userId);
        showNotification(i18n.contact_removed || 'Contact removed');
        await loadContacts();
        if (isContactsPopupOpen()) renderContactsList();
    } catch (err) {
        showNotification(localizedError(err));
    }
}

export function syncChatItemContactLinks() {
    document.querySelectorAll('.chat-item[data-type="direct"]').forEach(item => {
        const link = item.querySelector('a[data-action="addToContacts"], a[data-action="removeFromContacts"]');
        if (!link) return;
        const userId = parseInt(item.dataset.otherUserId, 10);
        const contact = isContactNow(userId);
        updateMenuLink(
            link,
            contact
                ? (i18n.remove_from_contacts || 'Remove from contacts')
                : (i18n.add_to_contacts || 'Add to contacts'),
            contact ? 'userMinus' : 'userPlus'
        );
        link.dataset.action = contact ? 'removeFromContacts' : 'addToContacts';
    });
}

export function handleContactStatus(userId, isOnline, lastSeen) {
    const contact = STATE.contacts.find(c => c.user_id === userId);
    if (contact) {
        contact.is_online = isOnline;
        if (!isOnline && lastSeen) contact.last_seen = lastSeen;
    }
    if (!isContactsPopupOpen()) return;
    const item = DOM.contactsList.querySelector(`.contact-item[data-user-id="${userId}"]`);
    if (!item) return;
    const avatar = item.querySelector('.contact-avatar');
    let dot = item.querySelector('.contact-online-dot');
    if (isOnline && !dot && avatar) {
        dot = document.createElement('span');
        dot.className = 'contact-online-dot';
        avatar.appendChild(dot);
    } else if (!isOnline && dot) {
        dot.remove();
    }
    const status = item.querySelector('.contact-status');
    if (status) {
        status.classList.toggle('is-online', isOnline);
        status.textContent = isOnline
            ? t('status_online', 'online')
            : formatLastSeen(contact ? contact.last_seen : null);
    }
}
