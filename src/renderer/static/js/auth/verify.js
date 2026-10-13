import { STATE, DOM, i18n, clearErrors } from './core.js';
import { startResendCooldown } from './mode.js';

function shakeCodeInput() {
    if (!DOM.verifyCode) return;
    DOM.verifyCode.classList.remove('shake');
    void DOM.verifyCode.offsetWidth;
    DOM.verifyCode.classList.add('shake');
    setTimeout(() => DOM.verifyCode.classList.remove('shake'), 500);
}

export function bindVerifyForm() {
    DOM.verifyForm.addEventListener('submit', async e => {
        e.preventDefault();
        const errorEl = DOM.verifyForm.querySelector('.form-error');
        if (STATE.verifyAttempts >= STATE.maxVerifyAttempts) {
            if (errorEl) { errorEl.textContent = i18n.too_many_attempts || 'Too many attempts. Please request a new code.'; errorEl.classList.add('show'); }
            DOM.verifySubmit.disabled = true;
            return;
        }
        const originalText = DOM.verifySubmit.textContent;
        let finalized = false;
        clearErrors(DOM.verifyForm);
        DOM.verifySubmit.disabled = true;
        DOM.verifySubmit.textContent = i18n.loading || 'Loading...';
        try {
            const formData = new FormData(DOM.verifyForm);
            const res = await fetch('/auth/verify-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: STATE.pendingEmail, code: formData.get('code') }),
            });
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                console.error('Non-JSON response:', (await res.text()).substring(0, 500));
                throw new Error(i18n.server_error || 'Server error');
            }
            const result = await res.json();
            if (res.ok) {
                finalized = true;
                if (result.redirect) window.location.href = result.redirect;
                else window.location.reload();
                return;
            }
            STATE.verifyAttempts++;
            const attemptsLeft = STATE.maxVerifyAttempts - STATE.verifyAttempts;
            if (errorEl) {
                const base = result.detail || i18n.error || 'Verification failed';
                errorEl.textContent = attemptsLeft > 0 ? `${base}. ${i18n.attempts_left || 'Attempts left'}: ${attemptsLeft}` : (i18n.too_many_attempts || 'Too many attempts');
                errorEl.classList.add('show');
            }
            if (attemptsLeft <= 0) finalized = true;
            shakeCodeInput();
            if (DOM.verifyCode) DOM.verifyCode.value = '';
            if (finalized) {
                if (DOM.verifyCode) DOM.verifyCode.disabled = true;
            } else if (DOM.verifyCode) {
                DOM.verifyCode.focus();
            }
        } catch (err) {
            console.error('Verification error:', err);
            if (errorEl) { errorEl.textContent = err.message || i18n.network_error || 'Network error'; errorEl.classList.add('show'); }
        } finally {
            if (!finalized) {
                DOM.verifySubmit.disabled = false;
                DOM.verifySubmit.textContent = originalText;
            }
        }
    });
}

export function bindCodeAutoSubmit() {
    if (!DOM.verifyCode || !DOM.verifyForm) return;
    DOM.verifyCode.addEventListener('input', () => {
        const digits = DOM.verifyCode.value.replace(/\D/g, '').slice(0, 6);
        if (digits !== DOM.verifyCode.value) DOM.verifyCode.value = digits;
        if (digits.length < 6) return;
        if (DOM.verifySubmit.disabled || DOM.verifyCode.disabled) return;
        if (STATE.verifyAttempts >= STATE.maxVerifyAttempts) return;
        DOM.verifyForm.requestSubmit();
    });
}

export function bindResendLink() {
    if (!DOM.resendLink) return;
    DOM.resendLink.addEventListener('click', async e => {
        e.preventDefault();
        if (STATE.resendCooldown > 0 || STATE.resendPending) return;
        STATE.resendPending = true;
        DOM.resendLink.classList.add('link-disabled');
        const errorEl = DOM.verifyForm.querySelector('.form-error');
        if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('show'); }
        try {
            const res = await fetch('/auth/resend-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: STATE.pendingEmail }),
            });
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                console.error('Non-JSON response:', (await res.text()).substring(0, 500));
                throw new Error(i18n.server_error || 'Server error');
            }
            const result = await res.json();
            if (res.ok) {
                STATE.verifyAttempts = 0;
                DOM.verifySubmit.disabled = false;
                DOM.verifySubmit.textContent = i18n.email_verification_button || 'Verify';
                if (DOM.verifyCode) {
                    DOM.verifyCode.value = '';
                    DOM.verifyCode.disabled = false;
                    DOM.verifyCode.focus();
                }
                if (errorEl) {
                    errorEl.textContent = i18n.email_verification_resent || 'New code sent!';
                    errorEl.classList.add('show', 'success');
                    setTimeout(() => { errorEl.textContent = ''; errorEl.classList.remove('show', 'success'); }, 3000);
                }
                STATE.resendPending = false;
                startResendCooldown(60);
            } else {
                STATE.resendPending = false;
                DOM.resendLink.classList.remove('link-disabled');
                if (errorEl) {
                    errorEl.textContent = result.detail || i18n.error || 'Failed to resend code';
                    errorEl.classList.add('show');
                }
            }
        } catch (err) {
            console.error('Resend error:', err);
            STATE.resendPending = false;
            DOM.resendLink.classList.remove('link-disabled');
            if (errorEl) { errorEl.textContent = err.message || i18n.network_error || 'Network error'; errorEl.classList.add('show'); }
        }
    });
}
