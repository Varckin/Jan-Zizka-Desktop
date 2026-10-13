export const REDUCED_MOTION =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initCursorGlow(root, selector, glowClass = 'cc-cursor-glow') {
    if (REDUCED_MOTION) return;

    const targets = root.querySelectorAll(selector);
    targets.forEach(el => {
        if (el.dataset.cursorTracked) return;
        el.dataset.cursorTracked = '1';
        if (glowClass) el.classList.add(glowClass);

        el.addEventListener('pointermove', e => {
            const rect = el.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            el.style.setProperty('--mx', `${x}%`);
            el.style.setProperty('--my', `${y}%`);
        });

        el.addEventListener('pointerleave', () => {
            el.style.removeProperty('--mx');
            el.style.removeProperty('--my');
        });
    });
}

export function initRipple(root, selector, rippleClass = 'cc-ripple') {
    if (REDUCED_MOTION) return;
    if (root.__ccRippleBound) return;
    root.__ccRippleBound = true;

    root.addEventListener('pointerdown', e => {
        const btn = e.target.closest(selector);
        if (!btn || btn.disabled) return;

        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const ripple = document.createElement('span');
        ripple.className = rippleClass;
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
        ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 650);
    });
}

export function initSendBurst(button, burstClass = 'cc-burst') {
    if (!button || button.dataset.burstBound) return;
    button.dataset.burstBound = '1';

    button.addEventListener('click', () => {
        if (button.disabled) return;
        button.classList.remove(burstClass);
        void button.offsetWidth;
        button.classList.add(burstClass);
    });
}

export function initTextareaAutoResize(textarea, maxHeight = 160) {
    if (!textarea || textarea.dataset.autoResize) return;
    textarea.dataset.autoResize = '1';

    const resize = () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
    };

    textarea.addEventListener('input', resize);
    resize();
}

export function initParallax(selector, options = {}) {
    if (REDUCED_MOTION) return;
    const { depthStep = 8 } = options;

    const orbs = document.querySelectorAll(selector);
    if (!orbs.length) return;

    let rafId = null;
    const pointer = { x: 0, y: 0 };

    window.addEventListener('pointermove', e => {
        pointer.x = e.clientX / window.innerWidth - 0.5;
        pointer.y = e.clientY / window.innerHeight - 0.5;

        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            const { x, y } = pointer;
            orbs.forEach((orb, i) => {
                const depth = (i + 1) * depthStep;
                orb.style.setProperty('--parallax-x', `${x * depth}px`);
                orb.style.setProperty('--parallax-y', `${y * depth}px`);
            });
            rafId = null;
        });
    });
}

export function initCardTilt(card, options = {}) {
    if (REDUCED_MOTION) return;
    if (!card || card.dataset.tilt) return;
    const { maxDeg = 4, perspective = 900 } = options;
    card.dataset.tilt = '1';

    card.addEventListener('pointermove', e => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform =
            `perspective(${perspective}px) rotateX(${-y * maxDeg}deg) rotateY(${x * maxDeg}deg)`;
    });

    card.addEventListener('pointerleave', () => {
        card.style.transform = '';
    });
}

export function initRevealObserver(root, selector, threshold = 0.08) {
    if (REDUCED_MOTION) return;
    const targets = root.querySelectorAll(selector);
    if (!targets.length) return null;

    let io = root.__ccRevealIO;
    if (!io) {
        io = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.dataset.revealed = '1';
                    io.unobserve(entry.target);
                }
            });
        }, { threshold });
        try {
            root.__ccRevealIO = io;
        } catch {}
    }

    targets.forEach(el => {
        if (el.dataset.revealed) return;
        el.dataset.revealPending = '1';
        io.observe(el);
    });
    return io;
}
