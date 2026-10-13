import { DOM } from '../dom.js';
import { createEmojiPicker } from '../../core_chat/emoji.js';

let picker = null;

export function initEmojiPicker() {
    if (picker) return picker;
    picker = createEmojiPicker({
        button: DOM.emojiBtn,
        popup: DOM.emojiModal,
        grid: DOM.emojiGrid,
        input: DOM.messageInput,
    }).init();
    return picker;
}

export function closeEmojiPicker() {
    if (picker) picker.hide();
}
