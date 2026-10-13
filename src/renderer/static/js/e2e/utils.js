import { STATE } from './state.js';
import { SignalProtocolAddress } from './crypto.js';
import * as vault from './vault.js';
import { t } from '../core_chat/format.js';

export {
    t,
    tf,
    formatTime,
    formatLastSeen,
    getDateKey,
    getDateLabel,
} from '../core_chat/format.js';

export function displayName(chat) {
    const full = [chat.other_first_name, chat.other_last_name]
        .filter(x => x && x.trim())
        .join(' ')
        .trim();
    return full || chat.other_username || t('e2e_unknown_user', 'Unknown');
}

export function senderLabel(msg, chat) {
    if (!chat) return t('e2e_unknown_user', 'Unknown');
    if (Number(msg.sender_id) === STATE.currentUserId) {
        const me = STATE.currentUser;
        const full = [me.firstName, me.lastName].filter(x => x && x.trim()).join(' ').trim();
        return {
            name: full || me.username || t('e2e_you', 'You'),
            username: full && me.username ? '@' + me.username : '',
        };
    }
    const full = [chat.other_first_name, chat.other_last_name]
        .filter(x => x && x.trim())
        .join(' ')
        .trim();
    return {
        name: full || chat.other_username || t('e2e_unknown_user', 'Unknown'),
        username: full && chat.other_username ? '@' + chat.other_username : '',
    };
}

export function isMine(msg) {
    return Number(msg.sender_id) === STATE.currentUserId;
}

export function messagePreviewText(m) {
    if (m && m.payload) {
        if (m.payload.file) {
            return '📎 ' + (m.payload.file.name || t('e2e_file_short', 'file'));
        }
        if (m.payload.text) {
            return m.payload.text.length > 120
                ? m.payload.text.slice(0, 117) + '...'
                : m.payload.text;
        }
    }
    if (m && m.text && m.text.length < 200) return m.text;
    return t('e2e_new_encrypted_message', 'New encrypted message');
}

export function addressFor(chat) {
    return new SignalProtocolAddress(chat.other_username, 1);
}

export function findMessage(chatId, messageId) {
    return (STATE.messages[chatId] || []).find(m => m.id === messageId);
}

export function sortChatsByRecent() {
    STATE.chats.sort((a, b) =>
        (b.last_message_at || '').localeCompare(a.last_message_at || '')
    );
}

export function upsertMessage(chatId, msg) {
    const list = (STATE.messages[chatId] = STATE.messages[chatId] || []);
    const idx = list.findIndex(m => m.id === msg.id);
    if (idx >= 0) {
        const prev = list[idx];
        if (prev.is_read && !msg.is_read) msg = { ...msg, is_read: true };
        list[idx] = msg;
    } else list.push(msg);
    list.sort((a, b) => a.id - b.id);
}

function plaintextKey(chatId) {
    return `e2e_plaintext:${chatId}`;
}

const _plainCache = new Map();
const _plainTimers = new Map();

function flushPlaintextWrite(chatId) {
    const timer = _plainTimers.get(chatId);
    if (timer) {
        clearTimeout(timer);
        _plainTimers.delete(chatId);
    }
    const map = _plainCache.get(chatId);
    if (map) vault.writeWrappedJSON(plaintextKey(chatId), map);
}

function savePlaintextMap(chatId, map) {
    _plainCache.set(chatId, map);
    const timer = _plainTimers.get(chatId);
    if (timer) clearTimeout(timer);
    _plainTimers.set(chatId, setTimeout(() => {
        _plainTimers.delete(chatId);
        vault.writeWrappedJSON(plaintextKey(chatId), map);
    }, 400));
}

export async function primePlaintextCache(chatId) {
    if (_plainCache.has(chatId)) return;
    const obj = await vault.readWrappedJSON(plaintextKey(chatId));
    if (!_plainCache.has(chatId)) {
        _plainCache.set(chatId, obj && typeof obj === 'object' ? obj : {});
    }
}

export function getPlaintextSnapshot(chatId) {
    return _plainCache.get(chatId) || {};
}

export function rememberPlaintext(chatId, messageId, text) {
    if (!vault.isUnlocked()) return;
    const map = _plainCache.get(chatId) || {};
    map[messageId] = text;
    savePlaintextMap(chatId, map);
}

export function forgetPlaintext(chatId, messageId) {
    const map = _plainCache.get(chatId);
    if (map && messageId in map) {
        delete map[messageId];
        savePlaintextMap(chatId, map);
    }
}

export function recallPlaintext(chatId, messageId) {
    const map = _plainCache.get(chatId);
    return map ? map[messageId] : undefined;
}

export function clearPlaintextFor(chatId) {
    _plainCache.delete(chatId);
    const timer = _plainTimers.get(chatId);
    if (timer) {
        clearTimeout(timer);
        _plainTimers.delete(chatId);
    }
    localStorage.removeItem(plaintextKey(chatId));
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            for (const chatId of Array.from(_plainTimers.keys())) flushPlaintextWrite(chatId);
        }
    });
}

vault.on('locked', () => {
    for (const chatId of Array.from(_plainTimers.keys())) flushPlaintextWrite(chatId);
    _plainCache.clear();
});
