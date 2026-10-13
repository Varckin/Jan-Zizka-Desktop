import { i18n, openModal, closeModal } from './core.js';
import { showToast } from './toast.js';

const MAX_ATTEMPTS = 5;
const LOGOUT_REDIRECT = '/auth/?mode=login';

const els = {};
const state = {
    pendingEmail: null,
    password: '',
    attempts: 0,
    confirming: false,
    cooldownLeft: 0,
    cooldownTimer: null,
};

function cacheDom() {
    els.modal = document.getElementById('email-change-modal');
    els.closeBtn = document.getElementById('email-change-close');
    els.stepIdentity = document.getElementById('email-change-step-identity');
    els.stepRequest = document.getElementById('email-change-step-request');
    els.stepCode = document.getElementById('email-change-step-code');
    els.stepSuccess = document.getElementById('email-change-step-success');
    els.identityForm = document.getElementById('email-change-identity-form');
    els.passwordInput = document.getElementById('email-change-password');
    els.identityError = document.getElementById('email-change-identity-error');
    els.identityCancel = document.getElementById('email-change-identity-cancel');
    els.backBtn = document.getElementById('email-change-back-btn');
    els.requestForm = document.getElementById('email-change-request-form');
    els.newEmail = document.getElementById('email-change-new-email');
    els.sendBtn = document.getElementById('email-change-send-btn');
    els.requestCancel = document.getElementById('email-change-request-cancel');
    els.requestError = document.getElementById('email-change-request-error');
    els.targetEmail = document.getElementById('email-change-target-email');
    els.otpInputs = Array.from(document.querySelectorAll('#email-change-otp input'));
    els.codeError = document.getElementById('email-change-code-error');
    els.resendBtn = document.getElementById('email-change-resend-btn');
    els.cancelBtn = document.getElementById('email-change-cancel-btn');
    els.editEmail = document.getElementById('edit-email');
    els.viewEmail = document.getElementById('view-email');
    els.changeBtn = document.getElementById('change-email-btn');
}

async function postJSON(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    return { ok: res.ok, data };
}

function showStep(step) {
    const steps = {
        identity: els.stepIdentity,
        request: els.stepRequest,
        code: els.stepCode,
        success: els.stepSuccess,
    };
    for (const [key, el] of Object.entries(steps)) {
        const active = key === step;
        el.classList.toggle('is-hidden', !active);
        if (active) {
            el.classList.remove('step-in');
            void el.offsetWidth;
            el.classList.add('step-in');
        }
    }
}

function showError(el, message, isSuccess = false) {
    el.textContent = message;
    el.classList.toggle('success', isSuccess);
    el.classList.add('show');
}

function hideError(el) {
    el.textContent = '';
    el.classList.remove('show', 'success');
}

function setButtonLoading(btn, loading, loadingText) {
    if (loading) {
        btn.dataset.originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> ${loadingText}`;
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
    }
}

function stopCooldown() {
    if (state.cooldownTimer) clearInterval(state.cooldownTimer);
    state.cooldownTimer = null;
    state.cooldownLeft = 0;
}

function updateResendLabel() {
    const base = i18n.resend_code || 'Resend code';
    els.resendBtn.textContent = state.cooldownLeft > 0 ? `${base} (${state.cooldownLeft}s)` : base;
}

function startCooldown(seconds) {
    stopCooldown();
    state.cooldownLeft = seconds;
    els.resendBtn.disabled = true;
    updateResendLabel();
    state.cooldownTimer = setInterval(() => {
        state.cooldownLeft -= 1;
        if (state.cooldownLeft <= 0) {
            stopCooldown();
            els.resendBtn.disabled = false;
        }
        updateResendLabel();
    }, 1000);
}

function clearOtp() {
    els.otpInputs.forEach(input => {
        input.value = '';
        input.disabled = false;
        input.classList.remove('filled');
    });
}

function currentCode() {
    return els.otpInputs.map(input => input.value).join('');
}

function shakeEl(el) {
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 500);
}

function shakeOtp() {
    shakeEl(els.otpInputs[0].parentElement);
}

function resetAll() {
    stopCooldown();
    state.pendingEmail = null;
    state.password = '';
    state.attempts = 0;
    state.confirming = false;
    clearOtp();
    if (els.passwordInput) els.passwordInput.value = '';
    hideError(els.identityError);
    hideError(els.requestError);
    hideError(els.codeError);
    els.resendBtn.disabled = false;
    updateResendLabel();
}

function applyEmail(email) {
    if (els.editEmail) els.editEmail.value = email;
    if (els.viewEmail) els.viewEmail.textContent = email;
}

function submitIdentity(e) {
    e.preventDefault();
    hideError(els.identityError);
    const password = els.passwordInput.value;
    if (!password) {
        showError(els.identityError, i18n.current_password_required || 'Enter your current password');
        shakeEl(els.passwordInput);
        return;
    }
    state.password = password;
    showStep('request');
    setTimeout(() => els.newEmail.focus(), 350);
}

function backToIdentity(message) {
    state.password = '';
    els.passwordInput.value = '';
    hideError(els.requestError);
    if (message) showError(els.identityError, message);
    showStep('identity');
    setTimeout(() => {
        els.passwordInput.focus();
        if (message) shakeEl(els.passwordInput);
    }, 350);
}

function enterCodeStep(email, cooldown) {
    state.pendingEmail = email;
    state.attempts = 0;
    els.targetEmail.textContent = email;
    clearOtp();
    hideError(els.codeError);
    showStep('code');
    startCooldown(cooldown || 60);
    setTimeout(() => els.otpInputs[0].focus(), 350);
}

function backToRequest(message) {
    if (message) showError(els.requestError, message);
    showStep('request');
    setTimeout(() => els.newEmail.focus(), 350);
}

async function submitRequest(e) {
    e.preventDefault();
    hideError(els.requestError);
    const email = els.newEmail.value.trim();
    if (!email) return;
    if (!state.password) {
        backToIdentity(i18n.current_password_required || 'Enter your current password');
        return;
    }
    setButtonLoading(els.sendBtn, true, i18n.sending_code || 'Sending...');
    try {
        const { ok, data } = await postJSON('/profile/email-change', { new_email: email, password: state.password });
        if (!ok) {
            if (data.code === 'wrong_password') {
                backToIdentity(data.detail || i18n.current_password_incorrect || 'Current password is incorrect');
                return;
            }
            showError(els.requestError, data.detail || i18n.error || 'Error');
            shakeEl(els.newEmail);
            return;
        }
        state.password = '';
        els.passwordInput.value = '';
        enterCodeStep(data.email, data.resend_in || 60);
    } catch (err) {
        showError(els.requestError, err.message || i18n.network_error || 'Network error');
    } finally {
        setButtonLoading(els.sendBtn, false);
    }
}

function scheduleLogout(redirect) {
    setTimeout(() => {
        showToast(i18n.all_sessions_terminated || 'All sessions were signed out for your security', 'info');
    }, 900);
    setTimeout(() => {
        window.location.href = redirect || LOGOUT_REDIRECT;
    }, 2600);
}

async function submitCode() {
    if (state.confirming) return;
    state.confirming = true;
    els.otpInputs.forEach(input => (input.disabled = true));
    hideError(els.codeError);
    try {
        const { ok, data } = await postJSON('/profile/email-change/confirm', { code: currentCode() });
        if (ok) {
            applyEmail(data.email);
            showStep('success');
            showToast(i18n.email_change_success || 'Email changed successfully!', 'success');
            scheduleLogout(data.redirect);
            return;
        }
        if (data.code === 'bad_code') {
            state.attempts += 1;
            const left = MAX_ATTEMPTS - state.attempts;
            const base = data.detail || i18n.error || 'Error';
            const message = left > 0
                ? `${base}. ${i18n.attempts_left || 'Attempts left'}: ${left}`
                : (i18n.too_many_attempts || 'Too many attempts. Please request a new code.');
            showError(els.codeError, message);
            shakeOtp();
            clearOtp();
            els.otpInputs[0].focus();
            if (left <= 0) setTimeout(() => backToRequest(), 1400);
        } else if (data.code === 'no_pending' || data.code === 'too_many_attempts') {
            showError(els.codeError, data.detail || i18n.error || 'Error');
            shakeOtp();
            setTimeout(() => backToRequest(), 1400);
        } else {
            showError(els.codeError, data.detail || i18n.error || 'Error');
            shakeOtp();
            clearOtp();
            els.otpInputs[0].focus();
        }
    } catch (err) {
        showError(els.codeError, err.message || i18n.network_error || 'Network error');
        clearOtp();
    } finally {
        state.confirming = false;
        els.otpInputs.forEach(input => (input.disabled = false));
    }
}

function maybeAutoSubmit() {
    if (currentCode().length === 6) submitCode();
}

async function resendCode() {
    if (state.cooldownLeft > 0) return;
    els.resendBtn.disabled = true;
    hideError(els.codeError);
    try {
        const { ok, data } = await postJSON('/profile/email-change/resend');
        if (ok) {
            state.attempts = 0;
            clearOtp();
            showError(els.codeError, i18n.code_resent || 'New code sent!', true);
            setTimeout(() => hideError(els.codeError), 3000);
            startCooldown(data.resend_in || 60);
            els.otpInputs[0].focus();
        } else if (data.code === 'no_pending') {
            backToRequest(data.detail);
        } else {
            els.resendBtn.disabled = false;
            showError(els.codeError, data.detail || i18n.error || 'Error');
            updateResendLabel();
        }
    } catch (err) {
        els.resendBtn.disabled = false;
        showError(els.codeError, err.message || i18n.network_error || 'Network error');
        updateResendLabel();
    }
}

async function cancelChange() {
    try { await postJSON('/profile/email-change/cancel'); } catch {}
    closeModal(els.modal);
    resetAll();
    showToast(i18n.email_change_cancelled || 'Email change cancelled', 'info');
}

function hideModal() {
    closeModal(els.modal);
    stopCooldown();
    state.password = '';
    if (els.passwordInput) els.passwordInput.value = '';
}

async function openEmailChange() {
    resetAll();
    openModal(els.modal);
    showStep('identity');
    setTimeout(() => els.passwordInput.focus(), 350);
    try {
        const res = await fetch('/profile/email-change');
        if (res.ok) {
            const data = await res.json();
            if (data.pending_email) enterCodeStep(data.pending_email, 60);
        }
    } catch {}
}

function bindOtp() {
    els.otpInputs.forEach((input, index) => {
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/g, '').slice(-1);
            input.classList.toggle('filled', !!input.value);
            if (input.value && index < els.otpInputs.length - 1) els.otpInputs[index + 1].focus();
            maybeAutoSubmit();
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Backspace' && !input.value && index > 0) {
                const prev = els.otpInputs[index - 1];
                prev.focus();
                prev.value = '';
                prev.classList.remove('filled');
                e.preventDefault();
            }
            if (e.key === 'ArrowLeft' && index > 0) els.otpInputs[index - 1].focus();
            if (e.key === 'ArrowRight' && index < els.otpInputs.length - 1) els.otpInputs[index + 1].focus();
        });
        input.addEventListener('paste', e => {
            e.preventDefault();
            const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
            digits.split('').forEach((digit, i) => {
                const target = els.otpInputs[i];
                if (target) {
                    target.value = digit;
                    target.classList.add('filled');
                }
            });
            if (digits.length) els.otpInputs[Math.min(digits.length, 5)].focus();
            maybeAutoSubmit();
        });
        input.addEventListener('focus', () => input.select());
    });
}

export function bindEmailChange() {
    cacheDom();
    if (!els.modal || !els.changeBtn) return;
    updateResendLabel();
    els.changeBtn.addEventListener('click', openEmailChange);
    els.identityForm.addEventListener('submit', submitIdentity);
    els.identityCancel.addEventListener('click', hideModal);
    els.backBtn.addEventListener('click', () => backToIdentity());
    els.requestForm.addEventListener('submit', submitRequest);
    els.requestCancel.addEventListener('click', hideModal);
    els.closeBtn.addEventListener('click', hideModal);
    els.cancelBtn.addEventListener('click', cancelChange);
    els.resendBtn.addEventListener('click', resendCode);
    els.modal.addEventListener('click', e => {
        if (e.target === els.modal) hideModal();
    });
    bindOtp();
}
