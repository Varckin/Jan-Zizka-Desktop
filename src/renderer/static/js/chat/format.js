import { STATE } from './state.js';
import { formatCompactCount, t, tf } from '../core_chat/format.js';

export {
    t,
    tf,
    pluralT,
    localizedError,
    formatRelativeTime,
    formatTime,
    formatLastSeen,
    getDateKey,
    getDateLabel,
    formatFileSize,
    formatCompactCount,
    isGifUrl,
    formatLastMessageText,
    formatTypingText,
    linkifyContent,
    renderMessageContent,
    createUserDisplay,
    fullNameOf,
} from '../core_chat/format.js';

export const formatSubscribersCount = formatCompactCount;

export function isMyMessage(msg) {
    if (msg.chat_type === 'channel') {
        return STATE.mySignature && msg.author_signature === STATE.mySignature;
    }
    return msg.sender_id === STATE.currentUserId;
}

export function systemEventName(system) {
    if (!system) return t('unknown_user', 'User');
    const fullName = [system.first_name, system.last_name].filter(x => x && String(x).trim()).join(' ').trim();
    return fullName || system.username || t('unknown_user', 'User');
}

export function systemEventActorName(system) {
    if (!system) return t('unknown_user', 'User');
    const fullName = [system.by_first_name, system.by_last_name].filter(x => x && String(x).trim()).join(' ').trim();
    return fullName || system.by_username || t('unknown_user', 'User');
}

const SYSTEM_EVENT_TEMPLATES = {
    group_created: { key: 'system_group_created', fallback: '{name} created the group' },
    member_joined: { key: 'system_member_joined', fallback: '{name} joined the group' },
    member_left: { key: 'system_member_left', fallback: '{name} left the group' },
    member_removed: { key: 'system_member_removed', fallback: '{actor} removed {name}' },
};

function templateForEvent(system) {
    return SYSTEM_EVENT_TEMPLATES[system && system.event] || SYSTEM_EVENT_TEMPLATES.member_joined;
}

export function systemEventParts(system) {
    const { key, fallback } = templateForEvent(system);
    const template = t(key, fallback);
    const vars = { actor: systemEventActorName(system), name: systemEventName(system) };
    const parts = [];
    let rest = template;
    while (rest.length > 0) {
        let nextKey = null;
        let nextIdx = -1;
        for (const k of Object.keys(vars)) {
            const idx = rest.indexOf(`{${k}}`);
            if (idx !== -1 && (nextIdx === -1 || idx < nextIdx)) {
                nextIdx = idx;
                nextKey = k;
            }
        }
        if (nextKey === null) {
            parts.push({ text: rest });
            break;
        }
        if (nextIdx > 0) parts.push({ text: rest.slice(0, nextIdx) });
        parts.push({ user: vars[nextKey] });
        rest = rest.slice(nextIdx + nextKey.length + 2);
    }
    return parts;
}

export function formatSystemEvent(system) {
    if (!system) return '';
    const { key, fallback } = templateForEvent(system);
    return tf(key, fallback, { name: systemEventName(system), actor: systemEventActorName(system) });
}

const VERIFIED_BADGE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.6l2.55 2.06 3.23-.28 1.08 3.07 2.84 1.57-.94 3.21.94 3.21-2.84 1.57-1.08 3.07-3.23-.28L12 22.4l-2.55-2.06-3.23.28-1.08-3.07L2.3 16.0l.94-3.21-.94-3.21 2.84-1.57 1.08-3.07 3.23.28L12 1.6z"/><path d="M10.55 16.05l-3.5-3.5 1.4-1.4 2.1 2.1 4.95-4.95 1.4 1.4-6.35 6.35z" fill="#fff"/></svg>';

export function isServiceChat(chat) {
    return !!(chat && chat.type === 'direct' && chat.other_user_is_service);
}

export function isVerifiedChat(chat) {
    return !!(chat && chat.type === 'direct' && (chat.other_user_is_service || chat.other_user_is_admin));
}

export function appendVerifiedBadge(el, chat) {
    if (el && isVerifiedChat(chat)) {
        el.appendChild(createVerifiedBadge(isServiceChat(chat) ? 'service' : 'staff'));
    }
}

export function createVerifiedBadge(kind) {
    const badge = document.createElement('span');
    badge.className = 'verified-badge';
    const label = kind === 'staff'
        ? t('staff_verified_badge', 'Verified account')
        : t('service_verified_badge', 'Verified service account');
    badge.title = label;
    badge.setAttribute('aria-label', label);
    badge.innerHTML = VERIFIED_BADGE_SVG;
    return badge;
}
