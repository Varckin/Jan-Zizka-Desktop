const BADGE_COLORS = {
    bg: '#ff5a5a',
    text: '#ffffff',
};

let lastCount = -1;
let observersReady = false;

function parseTitleCount(title) {
    const match = /^\((\d+)\)/.exec(String(title || ''));
    if (!match) return 0;
    const value = parseInt(match[1], 10);
    return Number.isFinite(value) ? value : 0;
}

function renderBadge(count) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const label = count > 99 ? '99+' : String(count);
    const radius = size / 2;
    ctx.beginPath();
    ctx.arc(radius, radius, radius - 2, 0, Math.PI * 2);
    ctx.fillStyle = BADGE_COLORS.bg;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(18, 18, 31, 0.9)';
    ctx.stroke();
    ctx.fillStyle = BADGE_COLORS.text;
    ctx.font = `bold ${label.length > 2 ? 24 : 34}px Segoe UI, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, radius, radius + 2);
    return canvas.toDataURL('image/png');
}

export function setUnread(count, options = {}) {
    const value = Math.max(0, parseInt(count, 10) || 0);
    if (value === lastCount) return;
    lastCount = value;

    const railBadge = document.getElementById('rail-badge-chat');
    if (railBadge) {
        railBadge.textContent = value > 99 ? '99+' : String(value);
        railBadge.classList.toggle('is-hidden', value === 0);
    }

    if (!window.desktopAPI) return;
    window.desktopAPI.setUnread(value).catch(() => { });
    if (!options.skipOverlay) {
        const dataUrl = value > 0 ? renderBadge(value) : null;
        window.desktopAPI.setBadgeIcon(dataUrl, value > 0 ? `${value} unread` : '').catch(() => { });
    }
}

export function currentUnread() {
    return lastCount < 0 ? 0 : lastCount;
}

export function init() {
    if (observersReady) return;
    observersReady = true;
    setUnread(parseTitleCount(document.title));

    const titleEl = document.querySelector('title');
    if (titleEl && typeof MutationObserver === 'function') {
        const observer = new MutationObserver(() => {
            setUnread(parseTitleCount(document.title));
        });
        observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    } else {
        setInterval(() => setUnread(parseTitleCount(document.title)), 2000);
    }
}
