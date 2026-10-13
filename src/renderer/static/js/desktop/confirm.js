import { showConfirm, showNotification, showPrompt } from '../chat/dialogs.js';

export function confirmDialog(message) {
    return showConfirm(message);
}

export function alertDialog(message) {
    return showNotification(message);
}

export function promptDialog(message, defaultValue) {
    return showPrompt(message, defaultValue);
}
