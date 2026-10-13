import { bindLoginForm, bindRegisterForm } from '../auth/forms.js';
import { bindVerifyForm, bindResendLink, bindCodeAutoSubmit } from '../auth/verify.js';
import { bindRipples, bindSwitchLinks } from '../auth/effects.js';
import { switchMode } from '../auth/mode.js';
import { initLangSwitcher } from './i18n.js';
import { initPasswordToggles } from './passwordToggle.js';
import { initTitlebar } from './titlebar.js';

const i18n = window.i18n || {};

function bindForgotForm() {
    const form = document.getElementById('forgot-password-form');
    if (!form) return;
    const submitBtn = document.getElementById('reset-submit');
    const errorEl = form.querySelector('.form-error');
    const emailInput = document.getElementById('reset-email');

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!submitBtn || !errorEl || !emailInput) return;
        const originalText = submitBtn.textContent;
        errorEl.textContent = '';
        errorEl.classList.remove('show', 'success');
        submitBtn.disabled = true;
        submitBtn.textContent = i18n.sending || 'Sending...';
        try {
            const res = await fetch('/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: emailInput.value.trim() }),
            });
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                throw new Error(i18n.server_error || 'Server error');
            }
            const data = await res.json();
            if (res.ok) {
                errorEl.textContent = data.message || i18n.password_reset_sent || 'Email sent';
                errorEl.classList.add('show', 'success');
                emailInput.value = '';
            } else {
                errorEl.textContent = data.detail || i18n.error || 'Error';
                errorEl.classList.add('show');
            }
        } catch (err) {
            errorEl.textContent = err.message || i18n.network_error || 'Network error';
            errorEl.classList.add('show');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

function bindResetForm() {
    const form = document.getElementById('reset-password-form');
    if (!form) return;
    const submitBtn = document.getElementById('reset-password-submit');
    const errorEl = form.querySelector('.form-error');
    const tokenHidden = document.getElementById('reset-token');
    const tokenField = document.getElementById('reset-token-field');
    const tokenInput = document.getElementById('reset-token-input');
    const newPass = document.getElementById('new-password');
    const confirmPass = document.getElementById('confirm-password');

    if (tokenHidden && tokenHidden.value && tokenField) {
        tokenField.style.display = 'none';
    }

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!submitBtn || !errorEl) return;
        const originalText = submitBtn.textContent;
        errorEl.textContent = '';
        errorEl.classList.remove('show', 'success');

        const token = (tokenHidden && tokenHidden.value) || (tokenInput ? tokenInput.value.trim() : '');
        const newPassword = newPass ? newPass.value.trim() : '';
        const confirmPassword = confirmPass ? confirmPass.value.trim() : '';

        if (!token) {
            errorEl.textContent = i18n.reset_token_required || 'Reset token is required';
            errorEl.classList.add('show');
            return;
        }
        if (newPassword.length < 8) {
            errorEl.textContent = i18n.password_too_short || 'Password must be at least 8 characters';
            errorEl.classList.add('show');
            return;
        }
        if (newPassword !== confirmPassword) {
            errorEl.textContent = i18n.password_mismatch || 'Passwords do not match';
            errorEl.classList.add('show');
            return;
        }

        let finalized = false;
        submitBtn.disabled = true;
        submitBtn.textContent = i18n.resetting || 'Resetting...';
        try {
            const res = await fetch('/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, new_password: newPassword, confirm_password: confirmPassword }),
            });
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                throw new Error(i18n.server_error || 'Server error');
            }
            const data = await res.json();
            if (res.ok) {
                finalized = true;
                errorEl.textContent = data.message || i18n.password_reset_success || 'Password reset successful!';
                errorEl.classList.add('show', 'success');
                form.querySelectorAll('input').forEach(inp => { inp.disabled = true; });
                submitBtn.classList.add('hidden');
                setTimeout(() => switchMode('login'), 2200);
            } else {
                errorEl.textContent = data.detail || i18n.error || 'Error';
                errorEl.classList.add('show');
            }
        } catch (err) {
            errorEl.textContent = err.message || i18n.network_error || 'Network error';
            errorEl.classList.add('show');
        } finally {
            if (!finalized) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        }
    });
}

function init() {
    bindLoginForm();
    bindRegisterForm();
    bindVerifyForm();
    bindResendLink();
    bindCodeAutoSubmit();
    bindRipples();
    bindSwitchLinks();
    bindForgotForm();
    bindResetForm();
    if (window.desktopAPI) initTitlebar();
    initLangSwitcher(document);
    initPasswordToggles(document);

    window.addEventListener('popstate', () => {
        const mode = new URLSearchParams(window.location.search).get('mode') || 'login';
        switchMode(mode, false, false);
    });

    const initialMode = new URLSearchParams(window.location.search).get('mode') || 'login';
    switchMode(initialMode, false, false);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
