import { i18n } from './dom.js';
import {
    request as coreRequest,
    sendFormData,
} from '../core_chat/api.js';

const fallbackError = () => (window.i18n || i18n).error || 'Request failed';

async function request(method, url, options = {}) {
    return coreRequest(method, url, { fallbackError: fallbackError(), ...options });
}

export const fetchChats = (query = '') => request('GET', query ? `/chat/api/chats/search?q=${encodeURIComponent(query)}` : '/chat/api/chats');
export const markChatRead = (chatId, lastSeenMessageId = null) => request('POST', `/chat/api/chats/${chatId}/read`, lastSeenMessageId != null ? { body: { last_seen_message_id: lastSeenMessageId } } : {});
export const fetchMessages = (chatId, limit = 30, offset = 0) => request('GET', `/chat/api/messages/${chatId}?limit=${limit}&offset=${offset}`);
export const sendTextMessage = (chatId, content, parentId = null) => request('POST', '/chat/api/messages', { body: { chat_id: chatId, content, ...(parentId ? { parent_id: parentId } : {}) } });
export const startDirectChat = (username) => request('POST', `/chat/api/chats/start?target_username=${encodeURIComponent(username)}`);
export const createGroup = (name, avatar, memberIds, description = null) => request('POST', '/chat/api/chats/group', { body: { name, avatar, member_ids: memberIds, ...(description ? { description } : {}) } });
export const getMembers = (chatId) => request('GET', `/chat/api/chats/${chatId}/members`);
export const getChatStats = (chatId) => request('GET', `/chat/api/chats/${chatId}/stats`);
export const getMyPermissions = (chatId) => request('GET', `/chat/api/chats/${chatId}/my-permissions`);
export const addMember = (chatId, userId) => request('POST', `/chat/api/chats/${chatId}/members`, { body: { user_ids: [userId] } });
export const removeMember = (chatId, userId) => request('DELETE', `/chat/api/chats/${chatId}/members/${userId}`);
export const changeRole = (chatId, userId, role) => request('PUT', `/chat/api/chats/${chatId}/members/${userId}/role`, { body: { role } });
export const updateChat = (chatId, data) => request('PUT', `/chat/api/chats/${chatId}`, { body: data });
export const deleteChat = (chatId) => request('DELETE', `/chat/api/chats/${chatId}`);
export const editMessage = (messageId, content) => request('PUT', `/chat/api/messages/${messageId}`, { body: { content } });
export const deleteMessage = (messageId) => request('DELETE', `/chat/api/messages/${messageId}`);
export const searchMessages = (chatId, query, limit = 50, offset = 0) => request('GET', `/chat/api/messages/search?chat_id=${chatId}&q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`);
export const fetchChatAttachments = (chatId) => request('GET', `/chat/api/chats/${chatId}/attachments`);
export const getUserByUsername = (username) => request('GET', `/chat/by-username?username=${encodeURIComponent(username)}`);
export const getPublicProfile = (username) => request('GET', `/profile/${username}`);
export const hideChat = (chatId) => request('POST', `/chat/api/chats/${chatId}/hide`);
export const muteChat = (chatId, duration) => request('POST', `/chat/api/chats/${chatId}/mute`, { body: { duration } });
export const unmuteChat = (chatId) => request('POST', `/chat/api/chats/${chatId}/unmute`);
export const pinChat = (chatId) => request('POST', `/chat/api/chats/${chatId}/pin`);
export const unpinChat = (chatId) => request('POST', `/chat/api/chats/${chatId}/unpin`);
export const fetchPinnedMessages = (chatId, limit = 50, offset = 0) => request('GET', `/chat/api/chats/${chatId}/pinned?limit=${limit}&offset=${offset}`);
export const pinMessage = (messageId) => request('POST', `/chat/api/messages/${messageId}/pin`);
export const unpinMessage = (messageId) => request('DELETE', `/chat/api/messages/${messageId}/pin`);
export const leaveGroup = (chatId) => request('POST', `/chat/api/chats/${chatId}/leave`);
export const blockUser = (userId) => request('POST', `/profile/block/${userId}`);
export const unblockUser = (userId) => request('POST', `/profile/unblock/${userId}`);
export const getBlockedUsers = () => request('GET', '/profile/blocked');
export const searchUsers = (query) => request('GET', `/chat/api/users/search?q=${encodeURIComponent(query)}`);
export const createChannel = (data) => request('POST', '/chat/api/channels', { body: data });
export const getChannel = (channelId) => request('GET', `/chat/api/channels/${channelId}`);
export const getChannelByUsername = (username) => request('GET', `/chat/api/channels/by-username/${encodeURIComponent(username)}`);
export const updateChannel = (channelId, data) => request('PUT', `/chat/api/channels/${channelId}`, { body: data });
export const deleteChannel = (channelId) => request('DELETE', `/chat/api/channels/${channelId}`);
export const subscribeToChannel = (channelId) => request('POST', `/chat/api/channels/${channelId}/subscribe`);
export const unsubscribeFromChannel = (channelId) => request('POST', `/chat/api/channels/${channelId}/unsubscribe`);
export const searchChannels = (query) => request('GET', `/chat/api/channels/search?q=${encodeURIComponent(query)}`);
export const getMyChannels = () => request('GET', '/chat/api/channels/my');
export const getSubscribedChannels = () => request('GET', '/chat/api/channels/subscribed');
export const getChannelAdmins = (channelId) => request('GET', `/chat/api/channels/${channelId}/admins`);
export const getChannelSubscribers = (channelId) => request('GET', `/chat/api/channels/${channelId}/subscribers`);
export const addChannelAdmin = (channelId, userId, role = 'admin') => request('POST', `/chat/api/channels/${channelId}/admins/${userId}?role=${role}`);
export const removeChannelAdmin = (channelId, userId) => request('DELETE', `/chat/api/channels/${channelId}/admins/${userId}`);
export const kickChannelSubscriber = (channelId, userId) => request('POST', `/chat/api/channels/${channelId}/kick/${userId}`);
export const addChannelSubscriber = (channelId, userId) => request('POST', `/chat/api/channels/${channelId}/subscribers`, { body: { user_id: userId } });
export const fetchContacts = (q = '') => request('GET', q ? `/contacts?q=${encodeURIComponent(q)}` : '/contacts');
export const addContact = (userId, nickname = null) => request('POST', `/contacts/${userId}`, { body: { nickname } });
export const removeContact = (userId) => request('DELETE', `/contacts/${userId}`);
export const renameContact = (userId, nickname) => request('PUT', `/contacts/${userId}/nickname`, { body: { nickname } });
export const getInviteLinks = (chatId) => request('GET', `/chat/api/chats/${chatId}/invite-links`);
export const createInviteLink = (chatId, data) => request('POST', `/chat/api/chats/${chatId}/invite-links`, { body: data });
export const updateInviteLink = (chatId, linkId, data) => request('PUT', `/chat/api/chats/${chatId}/invite-links/${linkId}`, { body: data });
export const revokeInviteLink = (chatId, linkId) => request('DELETE', `/chat/api/chats/${chatId}/invite-links/${linkId}`);
export const getInviteInfo = (code) => request('GET', `/chat/api/invite/${encodeURIComponent(code)}`);
export const joinByInvite = (code) => request('POST', `/chat/api/invite/${encodeURIComponent(code)}/join`);
export const fetchFolders = () => request('GET', '/chat/api/folders');
export const createFolder = (data) => request('POST', '/chat/api/folders', { body: data });
export const updateFolder = (folderId, data) => request('PUT', `/chat/api/folders/${folderId}`, { body: data });
export const deleteFolder = (folderId) => request('DELETE', `/chat/api/folders/${folderId}`);
export const reorderFolders = (folderIds) => request('POST', '/chat/api/folders/reorder', { body: { folder_ids: folderIds } });
export const addChatToFolder = (folderId, chatId) => request('POST', `/chat/api/folders/${folderId}/chats`, { body: { chat_id: chatId } });
export const removeChatFromFolder = (folderId, chatId) => request('DELETE', `/chat/api/folders/${folderId}/chats/${chatId}`);
export const pinChatInFolder = (folderId, chatId) => request('POST', `/chat/api/folders/${folderId}/chats/${chatId}/pin`);
export const unpinChatInFolder = (folderId, chatId) => request('POST', `/chat/api/folders/${folderId}/chats/${chatId}/unpin`);

export async function sendMessageWithMedia(chatId, content, parentId, files) {
    const formData = new FormData();
    if (content) formData.append('content', content);
    if (parentId) formData.append('parent_id', parentId);
    for (const file of files) formData.append('files', file);
    return sendFormData(`/chat/api/messages/upload/${chatId}`, formData, {
        fallbackError: fallbackError(),
    });
}

export async function uploadAvatar(chatId, file) {
    const formData = new FormData();
    formData.append('file', file);
    return sendFormData(`/chat/api/chats/${chatId}/avatar`, formData, {
        fallbackError: fallbackError(),
    });
}

export async function uploadChannelAvatar(channelId, file) {
    const formData = new FormData();
    formData.append('file', file);
    return sendFormData(`/chat/api/channels/${channelId}/avatar`, formData, {
        fallbackError: fallbackError(),
    });
}
