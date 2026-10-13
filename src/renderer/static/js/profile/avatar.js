import { DOM, i18n, openModal, closeModal } from './core.js';
import { showToast } from './toast.js';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ANIMATED_IMAGE_TYPES = ['image/gif'];

let cropper = null;

function isAnimatedImage(file) {
    return !!(file && ANIMATED_IMAGE_TYPES.includes(file.type));
}

function openCropModal(file) {
    const reader = new FileReader();
    reader.onload = e => {
        DOM.cropImage.src = e.target.result;
        openModal(DOM.cropModal);
        if (cropper) { cropper.destroy(); cropper = null; }
        setTimeout(() => {
            cropper = new Cropper(DOM.cropImage, {
                aspectRatio: 1,
                viewMode: 1,
                autoCropArea: 1,
                cropBoxResizable: true,
                dragMode: 'move',
                background: false,
            });
        }, 120);
    };
    reader.readAsDataURL(file);
}

function closeCropModal() {
    if (cropper) { cropper.destroy(); cropper = null; }
    closeModal(DOM.cropModal);
    setTimeout(() => { DOM.cropImage.src = 'data:,'; }, 260);
}

function restoreAvatar() {
    if (DOM.avatarImg.dataset.oldSrc) {
        DOM.avatarImg.src = DOM.avatarImg.dataset.oldSrc;
        DOM.avatarImg.hidden = false;
        DOM.placeholder.hidden = true;
    } else {
        DOM.avatarImg.hidden = true;
        DOM.placeholder.hidden = false;
    }
}

async function uploadAvatarFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    DOM.avatarImg.classList.add('loading');
    try {
        const res = await fetch('/profile/avatar', { method: 'POST', body: formData });
        let data = null;
        try { data = await res.json(); } catch { data = null; }
        if (!res.ok) {
            const detail = data && data.detail;
            const message = typeof detail === 'string' && detail
                ? detail
                : (i18n.avatar_upload_failed || 'Avatar upload failed');
            showToast(message, 'error');
            restoreAvatar();
            closeCropModal();
            return;
        }
        DOM.avatarImg.src = data.avatar + '?' + Date.now();
        DOM.avatarImg.dataset.oldSrc = data.avatar;
        DOM.avatarImg.hidden = false;
        DOM.placeholder.hidden = true;
        showToast(i18n.avatar_updated || 'Avatar updated!', 'success');
        closeCropModal();
    } catch (err) {
        showToast((i18n.error || 'Error') + ': ' + err.message, 'error');
        restoreAvatar();
        closeCropModal();
    } finally {
        DOM.avatarImg.classList.remove('loading');
    }
}

function previewAvatar(file) {
    const reader = new FileReader();
    reader.onload = e => {
        DOM.avatarImg.src = e.target.result;
        DOM.avatarImg.hidden = false;
        DOM.placeholder.hidden = true;
    };
    reader.readAsDataURL(file);
}

function handleAvatarFile(file) {
    if (isAnimatedImage(file)) {
        if (file.size > MAX_AVATAR_BYTES) {
            showToast(i18n.avatar_too_large || 'Animated avatar is too large (max 5 MB)', 'error');
            return;
        }
        previewAvatar(file);
        uploadAvatarFile(file);
        return;
    }
    previewAvatar(file);
    openCropModal(file);
}

async function uploadCropped() {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({ width: 300, height: 300, imageSmoothingQuality: 'high' });
    if (!canvas) {
        showToast(i18n.crop_failed || 'Failed to crop image', 'error');
        return;
    }
    canvas.toBlob(blob => {
        if (!blob) {
            showToast(i18n.crop_failed || 'Failed to crop image', 'error');
            return;
        }
        const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
        uploadAvatarFile(file);
    }, 'image/jpeg', 0.92);
}

export function bindAvatar() {
    if (DOM.avatarImg.src && !DOM.avatarImg.src.startsWith('data:')) {
        DOM.avatarImg.dataset.oldSrc = DOM.avatarImg.src;
    }

    DOM.avatarImg.addEventListener('error', () => {
        DOM.avatarImg.hidden = true;
        DOM.placeholder.hidden = false;
    });

    DOM.cropCancel.addEventListener('click', closeCropModal);
    DOM.cropConfirm.addEventListener('click', uploadCropped);

    DOM.avatarInput.addEventListener('change', function() {
        const file = this.files[0];
        this.value = '';
        if (!file) return;
        handleAvatarFile(file);
    });

    DOM.cropModal.addEventListener('click', e => {
        if (e.target === DOM.cropModal) closeCropModal();
    });
}
