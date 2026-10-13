import { DOM, i18n, openModal, closeModal } from './core.js';
import { showToast } from './toast.js';

function clearFormErrors(form) {
    form.querySelectorAll('.error-msg').forEach(el => {
        el.textContent = '';
        el.classList.remove('show');
    });
    const errorEl = form.querySelector('.form-error');
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('show'); }
}

function setFieldError(form, fieldId, message) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const group = el.closest('.form-group');
    if (!group) return;
    const msgEl = group.querySelector('.error-msg');
    if (msgEl) {
        msgEl.textContent = message;
        msgEl.classList.add('show');
    }
}

async function submitPassword(e) {
    e.preventDefault();
    const form = e.currentTarget;
    clearFormErrors(form);
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password-profile').value;
    const confirmPassword = document.getElementById('confirm-password-profile').value;

    if (newPassword.length < 8) {
        setFieldError(form, 'new-password-profile', i18n.password_too_short || 'Password must be at least 8 characters');
        return;
    }
    if (newPassword !== confirmPassword) {
        setFieldError(form, 'confirm-password-profile', i18n.password_mismatch || 'Passwords do not match');
        return;
    }

    try {
        const res = await fetch('/profile/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password: oldPassword, new_password: newPassword, confirm_password: confirmPassword }),
        });
        const data = await res.json();
        if (res.ok) {
            form.reset();
            closeModal(DOM.changePasswordModal);
            showToast(i18n.password_changed_success || 'Password updated successfully!', 'success');
            setTimeout(() => {
                showToast(i18n.all_sessions_terminated || 'All sessions were signed out for your security', 'info');
            }, 900);
            setTimeout(() => {
                window.location.href = data.redirect || '/auth/?mode=login';
            }, 2600);
        } else {
            const errorEl = form.querySelector('.form-error');
            errorEl.textContent = data.detail || i18n.error || 'Error';
            errorEl.classList.add('show');
            if (data.code === 'wrong_password') {
                const oldPasswordEl = document.getElementById('old-password');
                oldPasswordEl.value = '';
                oldPasswordEl.classList.remove('shake');
                void oldPasswordEl.offsetWidth;
                oldPasswordEl.classList.add('shake');
                setTimeout(() => oldPasswordEl.classList.remove('shake'), 500);
                oldPasswordEl.focus();
            }
        }
    } catch (err) {
        const errorEl = form.querySelector('.form-error');
        errorEl.textContent = i18n.network_error || 'Network error';
        errorEl.classList.add('show');
    }
}

export function bindPasswordModal() {
    if (!DOM.changePasswordBtn) return;
    DOM.changePasswordBtn.addEventListener('click', () => {
        openModal(DOM.changePasswordModal);
        DOM.changePasswordForm.reset();
        clearFormErrors(DOM.changePasswordForm);
    });
    DOM.changePasswordClose.addEventListener('click', () => closeModal(DOM.changePasswordModal));
    DOM.changePasswordModal.addEventListener('click', e => {
        if (e.target === DOM.changePasswordModal) closeModal(DOM.changePasswordModal);
    });
    DOM.changePasswordForm.addEventListener('submit', submitPassword);
}
