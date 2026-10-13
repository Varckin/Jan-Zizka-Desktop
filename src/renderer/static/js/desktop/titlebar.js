let bound = false;

function syncMaxIcon(maximized) {
    const btn = document.getElementById('tb-max');
    if (!btn) return;
    btn.classList.toggle('is-maximized', !!maximized);
    btn.title = maximized ? 'Restore' : 'Maximize';
}

export function initTitlebar() {
    if (bound) return;
    bound = true;
    const min = document.getElementById('tb-min');
    const max = document.getElementById('tb-max');
    const close = document.getElementById('tb-close');
    if (min) min.addEventListener('click', () => window.desktopAPI && window.desktopAPI.minimize());
    if (max) max.addEventListener('click', () => window.desktopAPI && window.desktopAPI.toggleMaximize());
    if (close) close.addEventListener('click', () => window.desktopAPI && window.desktopAPI.close());
    if (window.desktopAPI) {
        window.desktopAPI.on('desktop:maximized-changed', maximized => syncMaxIcon(maximized));
        window.desktopAPI.isMaximized().then(syncMaxIcon).catch(() => { });
    }
}
