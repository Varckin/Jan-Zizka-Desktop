const ADMIN_MODAL_SELECTOR = '#group-modal, #chat-settings-modal, #channel-modal, #channel-settings-modal, #channel-info-modal';
const COUNTER_IDS = ['ch-subscribers-count', 'channel-info-subs'];
const COUNT_DURATION_MS = 650;

function inAdminModal(el) {
    return !!(el && el.closest && el.closest(ADMIN_MODAL_SELECTOR));
}

function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function initTabThumbs() {
    document.querySelectorAll(ADMIN_MODAL_SELECTOR).forEach(modal => {
        modal.querySelectorAll('.settings-tabs').forEach(tabs => {
            if (tabs.dataset.amBound === '1') return;
            tabs.dataset.amBound = '1';
            tabs.classList.add('am-has-thumb');
            const thumb = document.createElement('span');
            thumb.className = 'am-tab-thumb';
            tabs.appendChild(thumb);

            const place = (animate) => {
                if (!animate) thumb.style.transition = 'none';
                const active = Array.from(tabs.querySelectorAll('.settings-tab'))
                    .find(btn => btn.classList.contains('active') && !btn.classList.contains('is-hidden'));
                if (!active || active.offsetWidth === 0) {
                    thumb.style.opacity = '0';
                } else {
                    thumb.style.width = `${active.offsetWidth}px`;
                    thumb.style.height = `${active.offsetHeight}px`;
                    thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
                    thumb.style.opacity = '1';
                }
                if (!animate) {
                    void thumb.offsetWidth;
                    thumb.style.transition = '';
                }
            };
            place(false);

            let raf = 0;
            const schedule = () => {
                if (raf) return;
                raf = requestAnimationFrame(() => { raf = 0; place(true); });
            };
            new MutationObserver(schedule).observe(tabs, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['class'],
            });
            new MutationObserver(() => {
                if (!modal.classList.contains('is-open')) return;
                tabs.dataset.amDir = 'none';
                requestAnimationFrame(() => place(false));
            }).observe(modal, { attributes: true, attributeFilter: ['class'] });
            window.addEventListener('resize', schedule);
        });
    });
}

function initTabDirection() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.settings-tab');
        if (!btn || !inAdminModal(btn)) return;
        const tabs = btn.closest('.settings-tabs');
        if (!tabs) return;
        const buttons = Array.from(tabs.querySelectorAll('.settings-tab'))
            .filter(b => !b.classList.contains('is-hidden'));
        const current = buttons.findIndex(b => b.classList.contains('active'));
        const target = buttons.indexOf(btn);
        if (current === -1 || target === -1 || current === target) {
            tabs.dataset.amDir = 'none';
            return;
        }
        tabs.dataset.amDir = target > current ? 'fwd' : 'back';
    }, true);
}

function initRipples() {
    document.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest && e.target.closest('.btn-primary, .btn-secondary, .btn-danger');
        if (!btn || btn.disabled || !inAdminModal(btn)) return;
        if (prefersReducedMotion()) return;
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const ripple = document.createElement('span');
        ripple.className = 'am-ripple';
        ripple.style.width = `${size}px`;
        ripple.style.height = `${size}px`;
        ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
        ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
        btn.appendChild(ripple);
        let removed = false;
        const remove = () => {
            if (removed) return;
            removed = true;
            ripple.remove();
        };
        ripple.addEventListener('animationend', remove);
        setTimeout(remove, 1200);
    });
}

function animateCount(el, observer) {
    const text = el.textContent || '';
    el.classList.remove('am-count-pop');
    void el.offsetWidth;
    el.classList.add('am-count-pop');
    if (prefersReducedMotion()) return;
    const match = text.match(/^(\d{1,9})([\s\S]*)$/);
    if (!match) return;
    const suffix = match[2];
    if (/^[.\d]/.test(suffix)) return;
    const target = parseInt(match[1], 10);
    if (!Number.isFinite(target) || target <= 0) return;
    observer.disconnect();
    const start = performance.now();
    const step = (now) => {
        const progress = Math.min(1, (now - start) / COUNT_DURATION_MS);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (progress < 1) {
            requestAnimationFrame(step);
            return;
        }
        el.textContent = text;
        observer.observe(el, { childList: true, characterData: true, subtree: true });
    };
    requestAnimationFrame(step);
}

function initCounters() {
    COUNTER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.dataset.amBound === '1') return;
        el.dataset.amBound = '1';
        const observer = new MutationObserver(() => animateCount(el, observer));
        observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
}

export function initAdminFx() {
    initTabThumbs();
    initTabDirection();
    initRipples();
    initCounters();
}
