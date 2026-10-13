import { STATE } from '../state.js';
import { DOM, i18n } from '../dom.js';
import { createVerifiedBadge, localizedError, pluralT, t } from '../format.js';
import * as API from '../api.js';
import { showNotification } from '../dialogs.js';
import { scrollToMessage } from '../chatMessages.js';
import { nicknameByUsername } from '../contacts.js';
import { openModalFx, closeModalFx } from '../modalFx.js';

const MSG_SEARCH_DEBOUNCE_MS = 300;
const MSG_SEARCH_MIN_CHARS = 2;
const MSG_SEARCH_STAGGER_CAP = 12;
const MSG_SEARCH_SNIPPET_BEFORE = 48;
const MSG_SEARCH_SNIPPET_AFTER = 96;

const MSG_SEARCH_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const MSG_SEARCH_GO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>';

let _msgSearchTimer = null;
let _msgSearchSeq = 0;

export function openSearchModal() {
    if (!STATE.currentChatId) return;
    clearTimeout(_msgSearchTimer);
    _msgSearchSeq++;
    openModalFx(DOM.searchModal);
    DOM.msgSearchInput.value = '';
    setMsgSearchSpinner(false);
    renderMsgSearchIdleState();
    setMsgSearchStatus(t('search_messages_hint', 'Type at least 2 characters to search in this chat'), '');
    setTimeout(() => DOM.msgSearchInput.focus(), 120);
}

export function closeSearchModal() {
    const modal = DOM.searchModal;
    if (!modal) return;
    if (!modal.classList.contains('is-open') && !modal.classList.contains('is-closing')) return;
    _msgSearchSeq++;
    clearTimeout(_msgSearchTimer);
    setMsgSearchSpinner(false);
    closeModalFx(modal);
}

export function clearMsgSearch() {
    _msgSearchSeq++;
    clearTimeout(_msgSearchTimer);
    DOM.msgSearchInput.value = '';
    setMsgSearchSpinner(false);
    renderMsgSearchIdleState();
    setMsgSearchStatus(t('search_messages_hint', 'Type at least 2 characters to search in this chat'), '');
    DOM.msgSearchInput.focus();
}

export function handleMsgSearch() {
    const q = this.value.trim();
    syncMsgSearchFieldUI();
    clearTimeout(_msgSearchTimer);
    if (q.length < MSG_SEARCH_MIN_CHARS) {
        _msgSearchSeq++;
        setMsgSearchSpinner(false);
        renderMsgSearchIdleState();
        setMsgSearchStatus(t('search_messages_hint', 'Type at least 2 characters to search in this chat'), '');
        return;
    }
    _msgSearchTimer = setTimeout(async () => {
        const mySeq = ++_msgSearchSeq;
        const chatId = STATE.currentChatId;
        if (!chatId) return;
        setMsgSearchSpinner(true);
        setMsgSearchStatus(t('search_messages_searching', 'Searching…'), 'is-busy');
        try {
            const results = await API.searchMessages(chatId, q);
            if (mySeq !== _msgSearchSeq || chatId !== STATE.currentChatId) return;
            setMsgSearchSpinner(false);
            renderMsgSearchResults(results, q);
            if (!results || results.length === 0) {
                setMsgSearchStatus(t('no_results', 'No results'), '');
            } else {
                setMsgSearchStatus(pluralT('search_results_count', results.length, '{count} messages found'), '');
            }
        } catch (err) {
            if (mySeq !== _msgSearchSeq || chatId !== STATE.currentChatId) return;
            setMsgSearchSpinner(false);
            console.error(err);
            renderMsgSearchError(localizedError(err, i18n.error_search_messages || 'Failed to search messages'));
        }
    }, MSG_SEARCH_DEBOUNCE_MS);
}

export function handleMsgSearchKeydown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        closeSearchModal();
        return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    const items = Array.from(DOM.msgSearchResults.querySelectorAll('.msg-search-item'));
    if (!items.length) return;
    e.preventDefault();
    if (e.key === 'Enter') {
        const active = DOM.msgSearchResults.querySelector('.msg-search-item.is-active') || items[0];
        active.click();
        return;
    }
    let idx = items.findIndex(item => item.classList.contains('is-active'));
    if (e.key === 'ArrowDown') idx = idx + 1 >= items.length ? 0 : idx + 1;
    else idx = idx <= 0 ? items.length - 1 : idx - 1;
    activateMsgSearchItem(items, idx);
}

function activateMsgSearchItem(items, idx) {
    items.forEach((item, i) => {
        item.classList.toggle('is-active', i === idx);
        item.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    if (items[idx]) items[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function setMsgSearchStatus(text, tone) {
    const el = DOM.msgSearchStatus;
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-busy', 'is-error');
    if (tone) el.classList.add(tone);
}

function setMsgSearchSpinner(on) {
    if (DOM.msgSearchSpinner) DOM.msgSearchSpinner.classList.toggle('is-visible', !!on);
    syncMsgSearchFieldUI();
}

function syncMsgSearchFieldUI() {
    if (!DOM.msgSearchClear) return;
    const hasText = DOM.msgSearchInput.value.length > 0;
    const busy = DOM.msgSearchSpinner && DOM.msgSearchSpinner.classList.contains('is-visible');
    DOM.msgSearchClear.classList.toggle('is-visible', hasText && !busy);
}

function renderMsgSearchResults(results, q) {
    const container = DOM.msgSearchResults;
    container.innerHTML = '';
    if (!results || results.length === 0) {
        renderMsgSearchEmptyState(t('no_results', 'No results'));
        return;
    }
    const frag = document.createDocumentFragment();
    results.forEach((msg, i) => frag.appendChild(createMsgSearchItem(msg, q, i)));
    container.appendChild(frag);
    container.scrollTop = 0;
}

function createMsgSearchItem(msg, q, index) {
    const item = document.createElement('div');
    item.className = 'msg-search-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.dataset.msgId = String(msg.id);
    item.style.setProperty('--i', String(Math.min(index, MSG_SEARCH_STAGGER_CAP)));
    item.addEventListener('animationend', () => { item.style.animation = 'none'; }, { once: true });

    item.appendChild(createMsgSearchAvatar(msg));

    const body = document.createElement('div');
    body.className = 'msg-search-body';

    const top = document.createElement('div');
    top.className = 'msg-search-top';
    const name = document.createElement('span');
    name.className = 'msg-search-name';
    name.textContent = msgSearchLabel(msg);
    name.title = name.textContent;
    if (msg.sender_is_admin) name.appendChild(createVerifiedBadge('staff'));
    const time = document.createElement('span');
    time.className = 'msg-search-time';
    time.textContent = formatMsgSearchTime(msg.created_at);
    top.append(name, time);

    const snippet = document.createElement('div');
    snippet.className = 'msg-search-snippet';
    snippet.appendChild(buildMsgSearchSnippet(msg.content, q));

    body.append(top, snippet);
    item.appendChild(body);

    const go = document.createElement('span');
    go.className = 'msg-search-go';
    go.setAttribute('aria-hidden', 'true');
    go.innerHTML = MSG_SEARCH_GO_SVG;
    item.appendChild(go);

    item.addEventListener('mouseenter', () => {
        const items = Array.from(item.parentElement ? item.parentElement.querySelectorAll('.msg-search-item') : []);
        const idx = items.indexOf(item);
        if (idx >= 0) activateMsgSearchItem(items, idx);
    });
    item.addEventListener('click', () => openMsgSearchResult(msg));
    return item;
}

async function openMsgSearchResult(msg) {
    const found = await scrollToMessage(msg.id);
    if (found) closeSearchModal();
    else showNotification(i18n.message_not_found || 'Message not found in this chat.');
}

function createMsgSearchAvatar(msg) {
    const label = msgSearchLabel(msg);
    const avatar = document.createElement('div');
    avatar.className = 'msg-search-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.title = label;
    if (msg.sender_avatar) {
        const img = document.createElement('img');
        img.src = msg.sender_avatar;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            if (avatar.querySelector('img') !== img) return;
            img.remove();
            avatar.textContent = (label.charAt(0) || '?').toUpperCase();
        }, { once: true });
        avatar.appendChild(img);
    } else {
        avatar.textContent = (label.charAt(0) || '?').toUpperCase();
    }
    return avatar;
}

function msgSearchLabel(msg) {
    const nickname = nicknameByUsername(msg.sender_username);
    if (nickname) return nickname;
    const full = [msg.sender_first_name, msg.sender_last_name]
        .filter(n => n && String(n).trim())
        .join(' ')
        .trim();
    return full || msg.sender_username || t('unknown_user', 'User');
}

function formatMsgSearchTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const hm = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const now = new Date();
    const sameDay = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
    if (sameDay(date, now)) return `${t('today', 'Today')} · ${hm}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(date, yesterday)) return `${t('yesterday', 'Yesterday')} · ${hm}`;
    const dm = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `${dm} · ${hm}`;
}

function escapeRegExpSource(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMsgSearchSnippet(content, query) {
    const frag = document.createDocumentFragment();
    const text = String(content == null ? '' : content).replace(/\s+/g, ' ').trim();
    if (!text) return frag;
    const q = String(query || '').trim();
    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const idx = q ? lowerText.indexOf(lowerQ) : -1;
    let slice = text;
    let prefix = '';
    let suffix = '';
    if (idx >= 0 && text.length > MSG_SEARCH_SNIPPET_BEFORE + q.length + MSG_SEARCH_SNIPPET_AFTER) {
        const start = Math.max(0, idx - MSG_SEARCH_SNIPPET_BEFORE);
        const end = Math.min(text.length, idx + q.length + MSG_SEARCH_SNIPPET_AFTER);
        slice = text.slice(start, end);
        prefix = start > 0 ? '… ' : '';
        suffix = end < text.length ? ' …' : '';
    } else if (idx < 0 && text.length > 160) {
        slice = text.slice(0, 160);
        suffix = ' …';
    }
    if (prefix) frag.appendChild(document.createTextNode(prefix));
    if (q) {
        const parts = slice.split(new RegExp(`(${escapeRegExpSource(q)})`, 'gi'));
        parts.forEach((part, i) => {
            if (!part) return;
            if (i % 2 === 1) {
                const mark = document.createElement('mark');
                mark.textContent = part;
                frag.appendChild(mark);
            } else {
                frag.appendChild(document.createTextNode(part));
            }
        });
    } else {
        frag.appendChild(document.createTextNode(slice));
    }
    if (suffix) frag.appendChild(document.createTextNode(suffix));
    return frag;
}

function renderMsgSearchEmptyState(text, opts = {}) {
    const container = DOM.msgSearchResults;
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'msg-search-empty' + (opts.error ? ' is-error' : '');
    const icon = document.createElement('div');
    icon.className = 'msg-search-empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = opts.error
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.6" fill="currentColor"/></svg>'
        : MSG_SEARCH_ICON_SVG;
    el.appendChild(icon);
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    if (opts.hotkeys) el.appendChild(buildMsgSearchHotkeys());
    container.appendChild(el);
}

function buildMsgSearchHotkeys() {
    const wrap = document.createElement('p');
    wrap.className = 'msg-search-hotkeys';
    const kbd = label => {
        const k = document.createElement('kbd');
        k.textContent = label;
        return k;
    };
    wrap.append(
        kbd('↑'), kbd('↓'),
        document.createTextNode(` — ${t('search_hotkey_navigate', 'navigate')} · `),
        kbd('Enter'),
        document.createTextNode(` — ${t('search_hotkey_open', 'open')} · `),
        kbd('Esc'),
        document.createTextNode(` — ${t('close', 'close')}`),
    );
    return wrap;
}

function renderMsgSearchIdleState() {
    renderMsgSearchEmptyState(t('search_messages_hint', 'Type at least 2 characters to search in this chat'), { hotkeys: true });
}

function renderMsgSearchError(text) {
    renderMsgSearchEmptyState(text, { error: true });
    setMsgSearchStatus(text, 'is-error');
}
