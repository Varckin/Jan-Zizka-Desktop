import { DOM, i18n } from './dom.js';
import { t, tf, localizedError, formatCompactCount, createVerifiedBadge } from './format.js';
import * as API from './api.js';
import { openModalFx, closeModalFx } from './modalFx.js';
import { openUserProfileModal } from './modals.js';
import { openChannelInfo } from './channels.js';
import { contactNickname } from './contacts.js';

const DISCOVER_DEBOUNCE_MS = 300;
const DISCOVER_STAGGER_CAP = 12;

const DISCOVER_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const DISCOVER_GO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>';
const DISCOVER_ERROR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.6" fill="currentColor"/></svg>';

let _discoverTimer = null;
let _discoverSeq = 0;

export function bindDiscoverEvents() {
    if (!DOM.discoverInput) return;
    DOM.discoverInput.addEventListener('input', handleDiscoverInput);
    DOM.discoverInput.addEventListener('keydown', handleDiscoverKeydown);
    if (DOM.discoverClear) DOM.discoverClear.addEventListener('click', clearDiscover);
}

export function openDiscoverModal() {
    clearTimeout(_discoverTimer);
    _discoverSeq++;
    openModalFx(DOM.discoverModal);
    DOM.discoverInput.value = '';
    setDiscoverSpinner(false);
    renderDiscoverIdleState();
    setDiscoverStatus(t('discover_hint', 'Start typing to search users and channels'), '');
    setTimeout(() => DOM.discoverInput.focus(), 120);
}

export function closeDiscoverModal() {
    _discoverSeq++;
    clearTimeout(_discoverTimer);
    setDiscoverSpinner(false);
    closeModalFx(DOM.discoverModal);
}

export function clearDiscover() {
    _discoverSeq++;
    clearTimeout(_discoverTimer);
    DOM.discoverInput.value = '';
    setDiscoverSpinner(false);
    renderDiscoverIdleState();
    setDiscoverStatus(t('discover_hint', 'Start typing to search users and channels'), '');
    DOM.discoverInput.focus();
}

function handleDiscoverInput() {
    const q = this.value.trim();
    syncDiscoverFieldUI();
    clearTimeout(_discoverTimer);
    if (!q) {
        _discoverSeq++;
        setDiscoverSpinner(false);
        renderDiscoverIdleState();
        setDiscoverStatus(t('discover_hint', 'Start typing to search users and channels'), '');
        return;
    }
    _discoverTimer = setTimeout(async () => {
        const mySeq = ++_discoverSeq;
        setDiscoverSpinner(true);
        setDiscoverStatus(t('loading', 'Loading...'), 'is-busy');
        const [usersRes, channelsRes] = await Promise.allSettled([
            API.searchUsers(q),
            API.searchChannels(q),
        ]);
        if (mySeq !== _discoverSeq) return;
        setDiscoverSpinner(false);
        if (usersRes.status === 'rejected' && channelsRes.status === 'rejected') {
            const err = usersRes.reason || channelsRes.reason;
            renderDiscoverError(localizedError(err, i18n.error_user_search || 'Failed to search'));
            return;
        }
        const users = usersRes.status === 'fulfilled' ? (usersRes.value || []) : [];
        const channels = channelsRes.status === 'fulfilled' ? (channelsRes.value || []) : [];
        renderDiscoverResults(users, channels, q);
        if (!users.length && !channels.length) {
            setDiscoverStatus(t('no_results', 'No results'), '');
        } else {
            setDiscoverStatus(tf('discover_results_summary', 'Users: {users} · Channels: {channels}', {
                users: users.length,
                channels: channels.length,
            }), '');
        }
    }, DISCOVER_DEBOUNCE_MS);
}

export function handleDiscoverKeydown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        closeDiscoverModal();
        return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    const items = Array.from(DOM.discoverResults.querySelectorAll('.discover-item'));
    if (!items.length) return;
    e.preventDefault();
    if (e.key === 'Enter') {
        const active = DOM.discoverResults.querySelector('.discover-item.is-active') || items[0];
        active.click();
        return;
    }
    let idx = items.findIndex(item => item.classList.contains('is-active'));
    if (e.key === 'ArrowDown') idx = idx + 1 >= items.length ? 0 : idx + 1;
    else idx = idx <= 0 ? items.length - 1 : idx - 1;
    activateDiscoverItem(items, idx);
}

function activateDiscoverItem(items, idx) {
    items.forEach((item, i) => {
        item.classList.toggle('is-active', i === idx);
        item.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    if (items[idx]) items[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function setDiscoverStatus(text, tone) {
    const el = DOM.discoverStatus;
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-busy', 'is-error');
    if (tone) el.classList.add(tone);
}

function setDiscoverSpinner(on) {
    if (DOM.discoverSpinner) DOM.discoverSpinner.classList.toggle('is-visible', !!on);
    syncDiscoverFieldUI();
}

function syncDiscoverFieldUI() {
    if (!DOM.discoverClear) return;
    const hasText = DOM.discoverInput.value.length > 0;
    const busy = DOM.discoverSpinner && DOM.discoverSpinner.classList.contains('is-visible');
    DOM.discoverClear.classList.toggle('is-visible', hasText && !busy);
}

function renderDiscoverResults(users, channels, q) {
    const container = DOM.discoverResults;
    container.innerHTML = '';
    if (!users.length && !channels.length) {
        renderDiscoverEmptyState(t('no_results', 'No results'));
        return;
    }
    const frag = document.createDocumentFragment();
    let index = 0;
    if (users.length) {
        frag.appendChild(buildDiscoverGroup(t('users_section', 'Users'), users.length));
        users.forEach(u => { frag.appendChild(createDiscoverUserItem(u, q, index)); index++; });
    }
    if (channels.length) {
        frag.appendChild(buildDiscoverGroup(t('channels_section', 'Channels'), channels.length));
        channels.forEach(ch => { frag.appendChild(createDiscoverChannelItem(ch, q, index)); index++; });
    }
    container.appendChild(frag);
    container.scrollTop = 0;
}

function buildDiscoverGroup(title, count) {
    const group = document.createElement('div');
    group.className = 'discover-group';
    const header = document.createElement('div');
    header.className = 'discover-group-title';
    header.appendChild(document.createTextNode(title));
    const badge = document.createElement('span');
    badge.className = 'discover-group-count';
    badge.textContent = String(count);
    header.appendChild(badge);
    group.appendChild(header);
    return group;
}

function createDiscoverItemShell(index) {
    const item = document.createElement('div');
    item.className = 'discover-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.style.setProperty('--i', String(Math.min(index, DISCOVER_STAGGER_CAP)));
    item.addEventListener('animationend', () => { item.style.animation = 'none'; }, { once: true });
    item.addEventListener('mouseenter', () => {
        const items = Array.from(DOM.discoverResults.querySelectorAll('.discover-item'));
        const idx = items.indexOf(item);
        if (idx >= 0) activateDiscoverItem(items, idx);
    });
    return item;
}

function createDiscoverAvatar(url, label, isChannel) {
    const avatar = document.createElement('div');
    avatar.className = 'discover-avatar' + (isChannel ? ' is-channel' : '');
    avatar.setAttribute('aria-hidden', 'true');
    if (url) {
        const img = document.createElement('img');
        img.src = url;
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

function appendDiscoverGoHint(item) {
    const go = document.createElement('span');
    go.className = 'discover-go';
    go.setAttribute('aria-hidden', 'true');
    go.innerHTML = DISCOVER_GO_SVG;
    item.appendChild(go);
}

function createDiscoverUserItem(user, q, index) {
    const nickname = contactNickname(user.id);
    const fullName = [user.first_name, user.last_name].filter(n => n && String(n).trim()).join(' ').trim();
    const label = nickname || fullName || user.username;
    const item = createDiscoverItemShell(index);
    item.appendChild(createDiscoverAvatar(user.avatar, label, false));

    const body = document.createElement('div');
    body.className = 'discover-body';
    const top = document.createElement('div');
    top.className = 'discover-top';
    const name = document.createElement('span');
    name.className = 'discover-name';
    name.appendChild(buildHighlightedText(label, q));
    name.title = label;
    if (user.is_admin) name.appendChild(createVerifiedBadge('staff'));
    const meta = document.createElement('span');
    meta.className = 'discover-meta';
    meta.appendChild(buildHighlightedText('@' + user.username, q));
    top.append(name, meta);
    body.appendChild(top);
    if (nickname && fullName) {
        const desc = document.createElement('div');
        desc.className = 'discover-desc';
        desc.textContent = fullName;
        body.appendChild(desc);
    }
    item.appendChild(body);
    appendDiscoverGoHint(item);

    item.addEventListener('click', () => {
        closeDiscoverModal();
        openUserProfileModal({
            userId: user.id,
            username: user.username,
            firstName: user.first_name,
            lastName: user.last_name,
            avatarUrl: user.avatar,
        });
    });
    return item;
}

function createDiscoverChannelItem(channel, q, index) {
    const label = channel.name || channel.username || '?';
    const item = createDiscoverItemShell(index);
    item.appendChild(createDiscoverAvatar(channel.avatar, label, true));

    const body = document.createElement('div');
    body.className = 'discover-body';
    const top = document.createElement('div');
    top.className = 'discover-top';
    const name = document.createElement('span');
    name.className = 'discover-name';
    name.appendChild(buildHighlightedText(label, q));
    name.title = label;
    const metaParts = [];
    if (channel.username) metaParts.push(buildHighlightedText('@' + channel.username, q));
    const subsText = `${formatCompactCount(channel.subscribers_count || 0)} ${t('subscribers', 'subscribers')}`;
    const meta = document.createElement('span');
    meta.className = 'discover-meta';
    metaParts.forEach((part, i) => {
        if (i > 0) meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(part);
    });
    if (!metaParts.length) meta.textContent = subsText;
    else meta.title = subsText;
    top.append(name, meta);
    body.appendChild(top);

    const desc = document.createElement('div');
    desc.className = 'discover-desc';
    if (channel.description) desc.appendChild(buildHighlightedText(channel.description, q));
    else desc.textContent = subsText;
    body.appendChild(desc);

    item.appendChild(body);
    appendDiscoverGoHint(item);

    item.addEventListener('click', () => {
        closeDiscoverModal();
        openChannelInfo(channel.id);
    });
    return item;
}

function escapeRegExpSource(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHighlightedText(text, query) {
    const frag = document.createDocumentFragment();
    const value = String(text == null ? '' : text);
    const q = String(query || '').trim();
    if (!q || !value) {
        frag.appendChild(document.createTextNode(value));
        return frag;
    }
    const parts = value.split(new RegExp(`(${escapeRegExpSource(q)})`, 'gi'));
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
    return frag;
}

function renderDiscoverEmptyState(text, opts = {}) {
    const container = DOM.discoverResults;
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'discover-empty' + (opts.error ? ' is-error' : '');
    const icon = document.createElement('div');
    icon.className = 'discover-empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = opts.error ? DISCOVER_ERROR_SVG : DISCOVER_ICON_SVG;
    el.appendChild(icon);
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    if (opts.hotkeys) el.appendChild(buildDiscoverHotkeys());
    container.appendChild(el);
}

function buildDiscoverHotkeys() {
    const wrap = document.createElement('p');
    wrap.className = 'discover-hotkeys';
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

function renderDiscoverIdleState() {
    renderDiscoverEmptyState(t('discover_hint', 'Start typing to search users and channels'), { hotkeys: true });
}

function renderDiscoverError(text) {
    renderDiscoverEmptyState(text, { error: true });
    setDiscoverStatus(text, 'is-error');
}
