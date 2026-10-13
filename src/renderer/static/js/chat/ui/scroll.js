import { DOM } from '../dom.js';
import { createScrollController } from '../../core_chat/scroll.js';

const controller = createScrollController(() => DOM.messagesContainer, {
    bottomThreshold: 80,
});

export const isNearBottom = controller.isNearBottom;
export const scrollToBottom = controller.scrollToBottom;
export const scrollToBottomIfNear = controller.scrollToBottomIfNear;
export const pinToBottom = controller.pinToBottom;
export const cancelPin = controller.cancelPin;
export const preserveScrollOnPrepend = controller.preserveScrollOnPrepend;

export { animateRemoval } from '../../core_chat/dom.js';
