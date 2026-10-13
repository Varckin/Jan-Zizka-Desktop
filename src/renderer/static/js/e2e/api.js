import { t } from './utils.js';
import {
    request as coreRequest,
    sendFormData,
} from '../core_chat/api.js';

const fallbackError = () => t('error', 'Request failed');

async function request(method, url, options = {}) {
    return coreRequest(method, url, { fallbackError: fallbackError(), ...options });
}

export const getMyDevice = () => request('GET', '/e2e/api/devices/me');

export const registerDevice = payload =>
    request('POST', '/e2e/api/devices', { body: payload });

export const getPreKeyCount = () =>
    request('GET', '/e2e/api/devices/me/prekeys/count');

export const uploadPreKeys = prekeys =>
    request('POST', '/e2e/api/devices/me/prekeys', { body: { prekeys } });

export const consumePreKeys = keyIds =>
    request('POST', '/e2e/api/devices/me/prekeys/consumed', { body: { key_ids: keyIds } });

export const getUserBundle = username =>
    request('GET', `/e2e/api/users/${encodeURIComponent(username)}/bundle`);

export const listChats = () => request('GET', '/e2e/api/chats');

export const startDirectChat = targetUsername =>
    request('POST', '/e2e/api/chats/direct', {
        body: { target_username: targetUsername },
    });

export const deleteChat = chatId =>
    request('DELETE', `/e2e/api/chats/${chatId}`);

export const listMessages = (chatId, limit = 50, offset = 0, sinceId = null, beforeId = null) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (sinceId != null) params.set('since_id', String(sinceId));
    if (beforeId != null) params.set('before_id', String(beforeId));
    return request('GET', `/e2e/api/chats/${chatId}/messages?${params.toString()}`);
};

export const sendMessage = payload =>
    request('POST', '/e2e/api/messages', { body: payload });

export const editMessage = (messageId, payload) =>
    request('PUT', `/e2e/api/messages/${messageId}`, { body: payload });

export const deleteMessage = messageId =>
    request('DELETE', `/e2e/api/messages/${messageId}`);

export const markRead = chatId =>
    request('POST', `/e2e/api/chats/${chatId}/read`);

export async function uploadAttachment(messageId, blob, filename) {
    const fd = new FormData();
    fd.append('file', blob, filename);
    return sendFormData(`/e2e/api/messages/${messageId}/attachments`, fd, {
        fallbackError: fallbackError(),
    });
}

export async function fetchAttachment(attachmentId) {
    const res = await fetch(`/e2e/api/media/${attachmentId}`);
    if (!res.ok) throw new Error('Failed to fetch attachment');
    return await res.arrayBuffer();
}
