export const STATE = {
    pendingEmail: '',
    resendCooldown: 0,
    resendTimerInterval: null,
    verifyAttempts: 0,
    maxVerifyAttempts: 5,
    focusTimerId: null,
    resendPending: false,
};

export const DOM = {
    loginContainer: document.getElementById('login-container'),
    registerContainer: document.getElementById('register-container'),
    verifyContainer: document.getElementById('verification-container'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    verifyForm: document.getElementById('verification-form'),
    verifyCode: document.getElementById('verify-code'),
    loginSubmit: document.getElementById('login-submit'),
    registerSubmit: document.getElementById('register-submit'),
    verifySubmit: document.getElementById('verify-submit'),
    verificationInfo: document.getElementById('verification-info'),
    resendLink: document.getElementById('resend-code-link'),
    mainTitle: document.getElementById('auth-main-title'),
    mainSubtitle: document.getElementById('auth-main-subtitle'),
};

export const i18n = window.i18n || {};

export function clearErrors(form) {
    form.querySelectorAll('.form-error').forEach(el => {
        el.textContent = '';
        el.classList.remove('show', 'success');
    });
}
