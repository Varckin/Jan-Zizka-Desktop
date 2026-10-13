import { STATE } from '../state.js';
import { DOM, i18n } from '../dom.js';
import * as API from '../api.js';
import { showNotification } from '../dialogs.js';
import { loadChats } from '../chatList.js';
import { openModalFx, closeModalFx } from '../modalFx.js';

const ANIMATED_IMAGE_TYPES = ['image/gif'];

let chatCropper = null;
let chatCropFile = null;
let chatCropResolve = null;
let chatCropReject = null;

export function isAnimatedImage(file) {
    return !!(file && ANIMATED_IMAGE_TYPES.includes(file.type));
}

export function initChatAvatarCrop() {
    DOM.chatAvatarCropCancel.addEventListener('click', closeChatCrop);
    DOM.chatAvatarCropConfirm.addEventListener('click', confirmChatCrop);
    DOM.chatAvatarCropModal.addEventListener('click', e => { if (e.target === DOM.chatAvatarCropModal) closeChatCrop(); });
}

export function openChatCrop(file) {
    if (isAnimatedImage(file)) {
        return Promise.resolve(file);
    }
    return new Promise((resolve, reject) => {
        chatCropResolve = resolve;
        chatCropReject = reject;
        const reader = new FileReader();
        reader.onload = e => {
            DOM.chatAvatarCropImage.src = e.target.result;
            openModalFx(DOM.chatAvatarCropModal);
            if (chatCropper) { chatCropper.destroy(); chatCropper = null; }
            setTimeout(() => {
                chatCropper = new Cropper(DOM.chatAvatarCropImage, {
                    aspectRatio: 1, viewMode: 1, autoCropArea: 1,
                    cropBoxResizable: true, dragMode: 'move', background: false
                });
            }, 100);
        };
        reader.readAsDataURL(file);
        chatCropFile = file;
    });
}

function closeChatCrop() {
    if (chatCropper) { chatCropper.destroy(); chatCropper = null; }
    closeModalFx(DOM.chatAvatarCropModal);
    DOM.chatAvatarCropImage.src = 'data:,';
    chatCropFile = null;
    if (chatCropReject) {
        chatCropReject(new Error('Cancelled'));
        chatCropReject = null;
    }
    chatCropResolve = null;
}

function confirmChatCrop() {
    if (!chatCropper) { closeChatCrop(); return; }
    const canvas = chatCropper.getCroppedCanvas({ width: 300, height: 300, imageSmoothingQuality: 'high' });
    if (!canvas) {
        showNotification(i18n.crop_failed || 'Failed to crop image');
        closeChatCrop();
        return;
    }
    canvas.toBlob(blob => {
        if (!blob) {
            showNotification(i18n.crop_failed || 'Failed to crop image');
            closeChatCrop();
            return;
        }
        const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
        if (chatCropResolve) {
            chatCropResolve(file);
            chatCropResolve = null;
        }
        if (chatCropper) { chatCropper.destroy(); chatCropper = null; }
        closeModalFx(DOM.chatAvatarCropModal);
        DOM.chatAvatarCropImage.src = 'data:,';
        chatCropFile = null;
        chatCropReject = null;
    }, 'image/jpeg', 0.92);
}

export async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const croppedFile = await openChatCrop(file);
        const chatId = STATE.settingsChatId;
        if (!chatId) { showNotification('No chat selected'); return; }
        const data = await API.uploadAvatar(chatId, croppedFile);
        if (data.avatar) {
            DOM.chatSettingsAvatarPreview.src = data.avatar;
            DOM.chatSettingsAvatarPreview.classList.remove('is-hidden');
            showNotification('Avatar updated');
            loadChats(false);
        }
    } catch (err) {
        if (err.message !== 'Cancelled') showNotification('Failed to upload avatar: ' + err.message);
    }
    e.target.value = '';
}
