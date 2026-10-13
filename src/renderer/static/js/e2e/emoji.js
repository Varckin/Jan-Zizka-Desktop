import { DOM } from './dom.js';
import { createEmojiPicker } from '../core_chat/emoji.js';

let picker = null;

export function initEmoji() {
    if (picker) return picker;
    picker = createEmojiPicker({
        button: DOM.emojiBtn,
        popup: DOM.emojiPopup,
        grid: DOM.emojiGrid,
        input: DOM.messageInput,
    }).init();
    return picker;
}

export function closeEmoji() {
    if (picker) picker.hide();
}
