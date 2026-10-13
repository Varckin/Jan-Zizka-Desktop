import { DOM, i18n, clearErrors } from './core.js';
import { showVerification } from './mode.js';

async function submitForm(form, url, submitBtn, validate) {
    const errorEl = form.querySelector('.form-error');
    clearErrors(form);
    const originalText = submitBtn.textContent;
    let finalized = false;
    submitBtn.disabled = true;
    submitBtn.textContent = i18n.loading || 'Loading...';
    try {
        const data = Object.fromEntries(new FormData(form).entries());
        if (validate) validate(data);
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            console.error('Non-JSON response:', (await res.text()).substring(0, 500));
            throw new Error(i18n.server_error || 'Server error. Please try again later.');
        }
        const result = await res.json();
        if (res.ok) {
            if (result.status === 'verification_required') {
                finalized = true;
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                showVerification(result.email);
                return;
            }
            finalized = true;
            if (result.redirect) window.location.href = result.redirect;
            else window.location.reload();
            return;
        }
        let message = result.detail || i18n.error || 'An error occurred';
        if (Array.isArray(message)) message = message.map(e => e.msg).join('. ');
        errorEl.textContent = message;
        errorEl.classList.add('show');
    } catch (err) {
        console.error('Request error:', err);
        errorEl.textContent = err.message || i18n.network_error || 'Network error';
        errorEl.classList.add('show');
    } finally {
        if (!finalized) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }
}

export function bindLoginForm() {
    DOM.loginForm.addEventListener('submit', e => {
        e.preventDefault();
        submitForm(DOM.loginForm, '/auth/login', DOM.loginSubmit);
    });
}

export function bindRegisterForm() {
    DOM.registerForm.addEventListener('submit', e => {
        e.preventDefault();
        submitForm(DOM.registerForm, '/auth/register', DOM.registerSubmit, data => {
            if (!data.first_name || !data.first_name.trim()) throw new Error(i18n.first_name_required || 'First name is required');
            if (data.password !== data.password_confirm) throw new Error(i18n.password_mismatch || 'Passwords do not match');
            if (data.password.length < 8) throw new Error(i18n.password_too_short || 'Password must be at least 8 characters');
        });
    });
}
