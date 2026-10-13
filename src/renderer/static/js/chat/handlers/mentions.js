import { STATE } from '../state.js';
import { DOM } from '../dom.js';
import * as API from '../api.js';
import { clampToViewport } from '../../core_chat/dom.js';
import { contactNickname } from '../contacts.js';

const QUERY_PATTERN = /(?:^|[\s(])@([A-Za-z0-9_]{0,32})$/;
const MAX_ITEMS = 8;

let popupEl = null;
let activeIndex = -1;
let mentionItems = [];
let mentionRange = null;
let inputSession = 0;

function ensurePopup() {
    if (popupEl) return popupEl;
    popupEl = document.createElement('div');
    popupEl.className = 'mention-popup is-hidden';
    popupEl.setAttribute('role', 'listbox');
    popupEl.addEventListener('mousedown', e => e.preventDefault());
    document.body.appendChild(popupEl);
    return popupEl;
}

export function initMentions() {
    if (!DOM.messageInput) return;
    DOM.messageInput.addEventListener('input', handleMentionInput);
    DOM.messageInput.addEventListener('keydown', handleMentionKeydown, true);
    DOM.messageInput.addEventListener('blur', () => setTimeout(() => {
        if (popupEl && !popupEl.matches(':hover')) hideMentionPopup();
    }, 140));
}

export function hideMentionPopup() {
    inputSession++;
    mentionRange = null;
    mentionItems = [];
    activeIndex = -1;
    if (popupEl) popupEl.classList.add('is-hidden');
}

export function invalidateMentionMembers(chatId) {
    if (chatId == null) {
        STATE.mentionMembers = {};
        return;
    }
    delete STATE.mentionMembers[chatId];
}

async function ensureMembers(chatId) {
    if (STATE.mentionMembers[chatId]) return STATE.mentionMembers[chatId];
    try {
        const members = await API.getMembers(chatId);
        STATE.mentionMembers[chatId] = Array.isArray(members) ? members : [];
    } catch (err) {
        console.warn('Failed to load members for mentions:', err);
        return [];
    }
    return STATE.mentionMembers[chatId];
}

async function handleMentionInput() {
    if (STATE.currentChatType !== 'group') {
        hideMentionPopup();
        return;
    }
    const el = DOM.messageInput;
    const pos = el.selectionStart != null ? el.selectionStart : el.value.length;
    const match = QUERY_PATTERN.exec(el.value.slice(0, pos));
    if (!match) {
        hideMentionPopup();
        return;
    }
    const chatId = STATE.currentChatId;
    const query = match[1];
    const session = ++inputSession;
    mentionRange = { start: pos - query.length - 1, end: pos };
    const members = await ensureMembers(chatId);
    if (session !== inputSession || !mentionRange || STATE.currentChatId !== chatId) return;
    renderMentionPopup(query, members);
}

function memberLabel(m) {
    return [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
}

function renderMentionPopup(query, members) {
    const q = query.toLowerCase();
    const filtered = (members || [])
        .filter(m => m.user_id !== STATE.currentUserId)
        .filter(m => (m.username || '').toLowerCase().startsWith(q)
            || memberLabel(m).toLowerCase().includes(q)
            || (contactNickname(m.user_id) || '').toLowerCase().includes(q))
        .slice(0, MAX_ITEMS);
    if (!filtered.length) {
        hideMentionPopup();
        return;
    }
    mentionItems = filtered;
    activeIndex = 0;
    const popup = ensurePopup();
    popup.innerHTML = '';
    filtered.forEach((m, idx) => popup.appendChild(buildMentionItem(m, idx)));
    popup.classList.remove('is-hidden');
    positionMentionPopup();
}

function buildMentionItem(member, idx) {
    const item = document.createElement('div');
    item.className = 'mention-popup-item' + (idx === activeIndex ? ' is-active' : '');
    item.dataset.index = idx;
    item.setAttribute('role', 'option');

    const avatar = document.createElement('div');
    avatar.className = 'mention-popup-avatar';
    if (member.avatar_url) {
        const img = document.createElement('img');
        img.src = member.avatar_url;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            if (avatar.querySelector('img') !== img) return;
            img.remove();
            avatar.textContent = (member.username || '?').charAt(0).toUpperCase();
        }, { once: true });
        avatar.appendChild(img);
    } else {
        avatar.textContent = (member.username || '?').charAt(0).toUpperCase();
    }
    item.appendChild(avatar);

    const info = document.createElement('div');
    info.className = 'mention-popup-info';
    const name = document.createElement('div');
    name.className = 'mention-popup-name';
    name.textContent = contactNickname(member.user_id) || memberLabel(member) || member.username;
    info.appendChild(name);
    const username = document.createElement('div');
    username.className = 'mention-popup-username';
    username.textContent = '@' + member.username;
    info.appendChild(username);
    item.appendChild(info);

    if (member.online) {
        const dot = document.createElement('span');
        dot.className = 'mention-popup-dot';
        item.appendChild(dot);
    }

    item.addEventListener('click', () => chooseMention(idx));
    item.addEventListener('mouseenter', () => setActive(idx));
    return item;
}

function positionMentionPopup() {
    const popup = ensurePopup();
    const rect = DOM.messageInput.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 20);
    popup.style.width = width + 'px';
    popup.style.visibility = 'hidden';
    const height = popup.offsetHeight || 200;
    popup.style.visibility = '';
    const pos = clampToViewport(rect.left, rect.top - height - 8, width, height, 10);
    popup.style.left = pos.x + 'px';
    popup.style.top = pos.y + 'px';
}

function setActive(idx) {
    if (!popupEl) return;
    activeIndex = idx;
    popupEl.querySelectorAll('.mention-popup-item').forEach(el => {
        const isActive = parseInt(el.dataset.index, 10) === idx;
        el.classList.toggle('is-active', isActive);
        if (isActive) el.scrollIntoView({ block: 'nearest' });
    });
}

function moveActive(delta) {
    if (!mentionItems.length) return;
    const next = (activeIndex + delta + mentionItems.length) % mentionItems.length;
    setActive(next);
}

function chooseMention(idx) {
    const member = mentionItems[idx];
    if (!member || !mentionRange) {
        hideMentionPopup();
        return;
    }
    const el = DOM.messageInput;
    const before = el.value.slice(0, mentionRange.start);
    const after = el.value.slice(mentionRange.end);
    const inserted = '@' + member.username + ' ';
    el.value = before + inserted + after;
    const caret = before.length + inserted.length;
    hideMentionPopup();
    el.focus();
    if (el.setSelectionRange) el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event('input'));
}

function handleMentionKeydown(e) {
    if (!popupEl || popupEl.classList.contains('is-hidden') || !mentionItems.length) return;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveActive(1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveActive(-1);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        chooseMention(activeIndex);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideMentionPopup();
    }
}
