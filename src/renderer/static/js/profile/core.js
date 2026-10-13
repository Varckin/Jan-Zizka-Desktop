export const i18n = window.i18n || {};
export const I18N_SESSIONS = window.I18N_SESSIONS || {};
export const LANGUAGES = window.LANGUAGES || {};
export const COUNTRIES = window.COUNTRIES || {};

export const DOM = {
    viewMode: document.querySelector('.view-mode'),
    editMode: document.getElementById('edit-mode'),
    editBtn: document.getElementById('edit-profile-btn'),
    saveBtn: document.getElementById('save-profile-btn'),
    cancelBtn: document.getElementById('cancel-edit-btn'),
    actionsView: document.getElementById('actions-view'),
    actionsEdit: document.getElementById('actions-edit'),
    avatarEditBtn: document.getElementById('avatar-edit-btn'),
    avatarInput: document.getElementById('avatar-input'),
    avatarImg: document.getElementById('profile-avatar'),
    placeholder: document.getElementById('avatar-placeholder'),
    initials: document.getElementById('avatar-initials'),
    cropModal: document.getElementById('avatar-crop-modal'),
    cropImage: document.getElementById('avatar-crop-image'),
    cropCancel: document.getElementById('avatar-crop-cancel'),
    cropConfirm: document.getElementById('avatar-crop-confirm'),
    changePasswordBtn: document.getElementById('change-password-btn'),
    changePasswordModal: document.getElementById('change-password-modal'),
    changePasswordClose: document.getElementById('change-password-close'),
    changePasswordForm: document.getElementById('change-password-form'),
    sessionsList: document.getElementById('sessions-list'),
    terminateOtherBtn: document.getElementById('terminate-other-btn'),
    pushToggle: document.getElementById('push-toggle'),
    lastSeenSelect: document.getElementById('last-seen-select'),
    whoCanMessageSelect: document.getElementById('who-can-message-select'),
};

export function formatSessionTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diff = (now - date) / 1000;
    if (diff < 60) return I18N_SESSIONS.just_now || 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' ' + (I18N_SESSIONS.minutes_ago || 'min ago');
    if (diff < 86400) return Math.floor(diff / 3600) + ' ' + (I18N_SESSIONS.hours_ago || 'h ago');
    if (diff < 172800) return I18N_SESSIONS.yesterday || 'Yesterday';
    if (diff < 604800) return Math.floor(diff / 86400) + ' ' + (I18N_SESSIONS.days_ago || 'd ago');
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function getDeviceIcon(deviceType) {
    if (deviceType === 'mobile') return '📱';
    if (deviceType === 'tablet') return '📲';
    return '🖥️';
}

export function openModal(modal) {
    modal.classList.remove('is-closing');
    modal.classList.add('is-open');
}

export function closeModal(modal) {
    if (!modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.classList.add('is-closing');
    setTimeout(() => modal.classList.remove('is-closing'), 260);
}
