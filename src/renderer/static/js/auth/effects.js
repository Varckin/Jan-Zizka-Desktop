import { switchMode } from './mode.js';

export function bindRipples() {
    document.querySelectorAll('.auth-button').forEach(btn => {
        btn.addEventListener('pointerdown', e => {
            const rect = btn.getBoundingClientRect();
            const ripple = document.createElement('span');
            ripple.className = 'ripple';
            ripple.style.setProperty('--ripple-x', (e.clientX - rect.left) + 'px');
            ripple.style.setProperty('--ripple-y', (e.clientY - rect.top) + 'px');
            btn.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        });
    });
}

export function bindSwitchLinks() {
    document.querySelectorAll('.switch-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const mode = link.dataset.mode;
            if (mode) switchMode(mode);
        });
    });
}
