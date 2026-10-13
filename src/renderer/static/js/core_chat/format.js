export function dict() {
    return window.i18n || {};
}

export function t(key, fallback = '') {
    const value = dict()[key];
    return value || fallback || key;
}

export function tf(key, fallback, vars = {}) {
    let str = t(key, fallback);
    for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return str;
}

export function localizedError(err, fallback = '') {
    const code = err && err.code;
    const byCode = code ? t(`error_${code}`, '') : '';
    return byCode || (err && err.message) || fallback || t('error', 'Error');
}

export function pluralT(baseKey, count, fallback = '') {
    const value = Number(count) || 0;
    const lang = (document.documentElement.lang || 'en').split('-')[0];
    let rule = value === 1 ? 'one' : 'other';
    try {
        rule = new Intl.PluralRules(lang).select(value);
    } catch {
        rule = value === 1 ? 'one' : 'other';
    }
    const store = dict();
    const template = store[`${baseKey}_${rule}`]
        || store[`${baseKey}_other`]
        || store[`${baseKey}_one`]
        || fallback
        || String(value);
    return String(template).replace(/\{count\}/g, String(value));
}

export function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = (now - date) / 1000;
    if (diff < 60) return t('just_now', 'Just now');
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    if (diff < 172800) return t('yesterday', 'Yesterday');
    if (diff < 604800) return Math.floor(diff / 86400) + 'd';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const formatTime = formatRelativeTime;

export function formatLastSeen(isoString) {
    if (!isoString) return t('offline', 'offline');
    const relative = formatRelativeTime(isoString);
    if (!relative) return t('offline', 'offline');
    return t('last_seen', 'last seen') + ' ' + relative;
}

export function getDateKey(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getDateLabel(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const sameDay = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
    if (sameDay(date, now)) return t('today', 'Today');
    if (sameDay(date, yesterday)) return t('yesterday', 'Yesterday');
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatFileSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

export function formatCompactCount(count) {
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K';
    return String(count);
}

export function isGifUrl(url) {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.toLowerCase();
        if (path.endsWith('.gif')) return true;
        const host = parsed.hostname;
        return host.includes('giphy.com') || host.includes('tenor.com');
    } catch {
        return false;
    }
}

export function formatLastMessageText(text) {
    if (!text) return text;
    return isGifUrl(text.trim()) ? t('gif', 'GIF') : text;
}

export function formatTypingText(typingUsers, isGroup) {
    const names = Object.values(typingUsers || {}).filter(Boolean);
    if (names.length === 0) return '';
    if (!isGroup) return t('typing', 'typing...');
    if (names.length === 1) return tf('typing_is', '{name} is typing...', { name: names[0] });
    if (names.length === 2) {
        return tf('typing_are', '{name1} and {name2} are typing...', { name1: names[0], name2: names[1] });
    }
    return tf('typing_many', '{name} and {count} others are typing...', {
        name: names[0],
        count: String(names.length - 1),
    });
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TOKEN_PATTERN = /https?:\/\/[^\s<>"']+|@[A-Za-z0-9_]{3,32}/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const MENTION_BOUNDARY = /[\s(\[{<>"'`.,;:!?-]/;

function createLinkElement(url, onLinkClick) {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    link.className = 'message-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        let confirmed = true;
        if (typeof onLinkClick === 'function') {
            try {
                confirmed = await onLinkClick(url);
            } catch (err) {
                console.error('Link confirmation failed:', err);
                confirmed = false;
            }
        }
        if (confirmed) {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    });
    return link;
}

function createMentionElement(token) {
    const span = document.createElement('span');
    span.className = 'mention';
    span.textContent = token;
    return span;
}

export function linkifyContent(text, onLinkClick) {
    const fragment = document.createDocumentFragment();
    if (text == null) return fragment;
    const source = String(text);
    let lastIndex = 0;

    for (const match of source.matchAll(TOKEN_PATTERN)) {
        const token = match[0];

        if (token.charCodeAt(0) === 64) {
            const prevChar = match.index > 0 ? source[match.index - 1] : '';
            if (match.index !== 0 && !MENTION_BOUNDARY.test(prevChar)) continue;
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(source.slice(lastIndex, match.index)));
            }
            fragment.appendChild(createMentionElement(token));
            lastIndex = match.index + token.length;
            continue;
        }

        const rawUrl = token;
        const url = rawUrl.replace(TRAILING_PUNCTUATION, '');
        const trailing = rawUrl.slice(url.length);

        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(source.slice(lastIndex, match.index)));
        }

        if (url) {
            fragment.appendChild(createLinkElement(url, onLinkClick));
        }

        if (trailing) {
            fragment.appendChild(document.createTextNode(trailing));
        }
        lastIndex = match.index + rawUrl.length;
    }

    if (lastIndex < source.length) {
        fragment.appendChild(document.createTextNode(source.slice(lastIndex)));
    }
    return fragment;
}

export function renderMessageContent(container, content, onLinkClick) {
    if (!container) return;
    container.innerHTML = '';
    const source = content == null ? '' : String(content);
    const trimmed = source.trim();

    if (isGifUrl(trimmed)) {
        const img = document.createElement('img');
        img.src = trimmed;
        img.alt = 'GIF';
        img.className = 'message-gif';
        container.appendChild(img);
        return;
    }

    if (source) {
        container.appendChild(linkifyContent(source, onLinkClick));
    }
}

export function createUserDisplay(firstName, lastName, username) {
    const fullName = [firstName, lastName].filter(n => n && n.trim()).join(' ').trim();
    const container = document.createElement('span');
    container.className = 'user-display';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'display-name';
    nameSpan.textContent = fullName || username || '';
    container.appendChild(nameSpan);
    return container;
}

export function fullNameOf(user) {
    if (!user) return '';
    return [user.first_name ?? user.firstName, user.last_name ?? user.lastName]
        .filter(x => x && String(x).trim())
        .join(' ')
        .trim();
}
