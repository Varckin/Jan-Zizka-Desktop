import { STATE, hasPermission } from '../state.js';
import { DOM, i18n } from '../dom.js';
import { isServiceChat } from '../format.js';
import { processSelectedFiles } from '../ui/filePreview.js';
import { showNotification } from '../dialogs.js';
import { initFileDropZone } from '../../core_chat/dragdrop.js';

export function initDragAndDrop() {
    initFileDropZone({
        zone: DOM.chatMain,
        label: i18n.drop_files_here || 'Drop files to send',
        canDrop: () => {
            if (!STATE.currentChatId) return i18n.select_chat_first || 'Select a chat first';
            if (isServiceChat(STATE.chatsMap[STATE.currentChatId])) return i18n.service_chat_readonly || 'This chat does not accept messages';
            const isChannel = STATE.currentChatType === 'channel';
            const canPost = !isChannel || hasPermission('post_messages');
            if (!canPost) return i18n.only_admins_can_post || 'Only admins can post to this channel';
            return null;
        },
        onBlocked: message => showNotification(message),
        onFiles: files => processSelectedFiles(files, 'append'),
    });
}
