import {
    REDUCED_MOTION,
    initCursorGlow,
    initRipple,
    initSendBurst,
    initTextareaAutoResize,
    initParallax,
    initCardTilt,
    initRevealObserver,
} from '../core_chat/effects.js';

const CURSOR_GLOW_SELECTOR =
    '.e2e-btn-primary, .e2e-btn-icon, .e2e-chat-item, .context-menu-item';
const REVEAL_SELECTOR =
    '.e2e-message:not([data-revealed]), .e2e-chat-item:not([data-revealed])';

let booted = false;

function bootAll(root = document) {
    initCursorGlow(root, CURSOR_GLOW_SELECTOR);
    initRevealObserver(root, REVEAL_SELECTOR);
}

export function initEffects() {
    if (booted) return;
    booted = true;

    initRipple(document, '.e2e-btn-primary');
    initParallax('.e2e-aurora-wash', { depthStep: 6 });
    initTextareaAutoResize(document.getElementById('e2e-message-input'));
    initSendBurst(document.getElementById('e2e-send-btn'));
    initCardTilt(document.querySelector('.e2e-profile-content'));

    bootAll(document);

    if (REDUCED_MOTION) return;

    let frameScheduled = false;
    const mo = new MutationObserver(mutations => {
        if (frameScheduled) return;
        let touched = false;
        for (const m of mutations) {
            if (m.addedNodes.length) { touched = true; break; }
        }
        if (!touched) return;
        frameScheduled = true;
        requestAnimationFrame(() => {
            frameScheduled = false;
            bootAll(document);
        });
    });
    mo.observe(document.body, { childList: true, subtree: true });
}
