import { STATE, DOM, i18n } from './core.js';

export function switchMode(mode, pushState = true, focus = true) {
    if (pushState) {
        const url = new URL(window.location.href);
        url.searchParams.set('mode', mode);
        window.history.pushState({}, '', url);
    }
    const isRegister = mode === 'register';
    if (DOM.mainTitle) DOM.mainTitle.textContent = i18n[isRegister ? 'auth_title_register' : 'auth_title_login'] || DOM.mainTitle.textContent;
    if (DOM.mainSubtitle) DOM.mainSubtitle.textContent = i18n[isRegister ? 'auth_subtitle_register' : 'auth_subtitle_login'] || DOM.mainSubtitle.textContent;
    DOM.loginContainer.classList.toggle('hidden-form', isRegister);
    DOM.registerContainer.classList.toggle('hidden-form', !isRegister);
    DOM.verifyContainer.classList.add('hidden-form');
    const forgotContainer = document.getElementById('forgot-container');
    const resetContainer = document.getElementById('reset-container');
    const isAux = mode === 'forgot' || mode === 'reset';
    if (forgotContainer) forgotContainer.classList.toggle('hidden-form', mode !== 'forgot');
    if (resetContainer) resetContainer.classList.toggle('hidden-form', mode !== 'reset');
    if (isAux) {
        DOM.loginContainer.classList.add('hidden-form');
        DOM.registerContainer.classList.add('hidden-form');
        const titleKey = mode === 'forgot' ? 'forgot_password_title' : 'reset_password_title';
        const subtitleKey = mode === 'forgot' ? 'forgot_password_subtitle' : 'reset_password_subtitle';
        if (DOM.mainTitle) DOM.mainTitle.textContent = i18n[titleKey] || DOM.mainTitle.textContent;
        if (DOM.mainSubtitle) DOM.mainSubtitle.textContent = i18n[subtitleKey] || '';
    } else {
        if (DOM.mainTitle) DOM.mainTitle.textContent = i18n[isRegister ? 'auth_title_register' : 'auth_title_login'] || DOM.mainTitle.textContent;
        if (DOM.mainSubtitle) DOM.mainSubtitle.textContent = i18n[isRegister ? 'auth_subtitle_register' : 'auth_subtitle_login'] || DOM.mainSubtitle.textContent;
    }
    if (STATE.focusTimerId) {
        clearTimeout(STATE.focusTimerId);
        STATE.focusTimerId = null;
    }
    if (focus) {
        STATE.focusTimerId = setTimeout(() => {
            STATE.focusTimerId = null;
            document.getElementById(isRegister ? 'reg-username' : 'login-username').focus();
        }, 400);
    }
    document.querySelectorAll('.auth-card .form-error').forEach(el => {
        el.textContent = '';
        el.classList.remove('show', 'success');
    });
}

export function showVerification(email) {
    STATE.pendingEmail = email;
    STATE.verifyAttempts = 0;
    STATE.resendPending = false;
    if (STATE.resendTimerInterval) {
        clearInterval(STATE.resendTimerInterval);
        STATE.resendTimerInterval = null;
    }
    STATE.resendCooldown = 0;
    DOM.loginContainer.classList.add('hidden-form');
    DOM.registerContainer.classList.add('hidden-form');
    DOM.verifyContainer.classList.remove('hidden-form');
    if (DOM.verificationInfo) DOM.verificationInfo.textContent = (i18n.email_verification_sent || 'Code sent to') + ' ' + email;
    if (DOM.resendLink) {
        DOM.resendLink.classList.remove('link-disabled');
        DOM.resendLink.textContent = i18n.email_verification_resend || 'Resend code';
    }
    if (DOM.verifySubmit) {
        DOM.verifySubmit.disabled = false;
        DOM.verifySubmit.textContent = i18n.email_verification_button || 'Verify';
    }
    if (STATE.focusTimerId) clearTimeout(STATE.focusTimerId);
    STATE.focusTimerId = setTimeout(() => {
        STATE.focusTimerId = null;
        document.getElementById('verify-code').focus();
    }, 400);
}

export function startResendCooldown(seconds) {
    STATE.resendCooldown = seconds;
    if (!DOM.resendLink) return;
    DOM.resendLink.classList.add('link-disabled');
    DOM.resendLink.textContent = `${i18n.email_verification_resend || 'Resend code'} (${STATE.resendCooldown}s)`;
    STATE.resendTimerInterval = setInterval(() => {
        STATE.resendCooldown--;
        if (STATE.resendCooldown <= 0) {
            clearInterval(STATE.resendTimerInterval);
            STATE.resendTimerInterval = null;
            DOM.resendLink.classList.remove('link-disabled');
            DOM.resendLink.textContent = i18n.email_verification_resend || 'Resend code';
        } else {
            DOM.resendLink.textContent = `${i18n.email_verification_resend || 'Resend code'} (${STATE.resendCooldown}s)`;
        }
    }, 1000);
}
