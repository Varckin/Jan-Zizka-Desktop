const EYE_OPEN_SVG = '<svg class="pw-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED_SVG = '<svg class="pw-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function toggleLabels() {
    const dict = window.i18n || {};
    return {
        show: dict.show_password || 'Show password',
        hide: dict.hide_password || 'Hide password',
    };
}

function enhancePasswordInput(input) {
    if (input.dataset.pwToggleBound === '1') return;
    input.dataset.pwToggleBound = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'password-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle';
    const labels = toggleLabels();
    btn.setAttribute('aria-label', labels.show);
    btn.setAttribute('aria-pressed', 'false');
    btn.title = labels.show;
    btn.innerHTML = EYE_OPEN_SVG + EYE_CLOSED_SVG;
    btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.classList.toggle('is-active', show);
        btn.setAttribute('aria-pressed', String(show));
        const next = toggleLabels();
        const label = show ? next.hide : next.show;
        btn.setAttribute('aria-label', label);
        btn.title = label;
        try {
            input.focus({ preventScroll: true });
        } catch {
            input.focus();
        }
    });
    wrapper.appendChild(btn);
}

export function initPasswordToggles(root = document) {
    root.querySelectorAll('input[type="password"]').forEach(input => {
        if (input.closest('.e2e-vault-field')) return;
        enhancePasswordInput(input);
    });
}
