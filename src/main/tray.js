const { app, Menu, Tray, nativeImage } = require('electron');
const windowManager = require('./window');
const settings = require('./settings');
const desktopStrings = require('./desktopStrings');

let tray = null;
let unreadTotal = 0;

function trayImage() {
    const img = windowManager.iconPath();
    if (!img) return nativeImage.createEmpty();
    const resized = img.resize({ width: 18, height: 18 });
    return resized.isEmpty() ? img : resized;
}

function buildUpdateItem() {
    const updater = require('./updater');
    const st = updater.getState();
    if (st.status === 'downloaded') {
        return {
            label: desktopStrings.s('tray_update_install'),
            click: () => updater.quitAndInstall(),
        };
    }
    if (st.status === 'downloading') {
        return {
            label: `${desktopStrings.s('tray_update_progress')} ${st.progress || 0}%`,
            enabled: false,
        };
    }
    return { type: 'separator' };
}

function buildMenu() {
    const template = [
        {
            label: unreadTotal > 0
                ? `${desktopStrings.s('tray_unread')}: ${unreadTotal}`
                : app.getName(),
            enabled: false,
        },
        { type: 'separator' },
        {
            label: desktopStrings.s('tray_chats'),
            click: () => {
                windowManager.show();
                windowManager.broadcast('desktop:navigate', { view: 'chat' });
            },
        },
        {
            label: desktopStrings.s('tray_vault'),
            click: () => {
                windowManager.show();
                windowManager.broadcast('desktop:navigate', { view: 'e2e' });
            },
        },
        {
            label: desktopStrings.s('tray_profile'),
            click: () => {
                windowManager.show();
                windowManager.broadcast('desktop:navigate', { view: 'profile' });
            },
        },
        {
            label: desktopStrings.s('tray_settings'),
            click: () => {
                windowManager.show();
                windowManager.broadcast('desktop:navigate', { view: 'settings' });
            },
        },
        { type: 'separator' },
        {
            label: desktopStrings.s('tray_mute_notifications'),
            type: 'checkbox',
            checked: !settings.get('notifications.enabled'),
            click: item => {
                settings.set({ notifications: { enabled: !item.checked } });
                windowManager.broadcast('desktop:settings-changed', settings.all());
            },
        },
        { type: 'separator' },
        buildUpdateItem(),
        { type: 'separator' },
        {
            label: desktopStrings.s('tray_quit'),
            click: () => {
                windowManager.setQuitting(true);
                app.quit();
            },
        },
    ];
    return Menu.buildFromTemplate(template);
}

function refresh() {
    if (!tray) return;
    tray.setContextMenu(buildMenu());
    const base = app.getName();
    tray.setToolTip(unreadTotal > 0 ? `${base} — ${unreadTotal}` : base);
}

function create() {
    if (tray || !settings.get('tray.enabled')) return;
    const image = trayImage();
    if (image.isEmpty()) return;
    tray = new Tray(image);
    refresh();
    tray.on('click', () => {
        const win = windowManager.getWindow();
        if (win && win.isVisible() && !win.isMinimized()) windowManager.hide();
        else windowManager.show();
    });
    tray.on('double-click', () => windowManager.show());
}

function destroy() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}

function setUnread(count) {
    unreadTotal = Math.max(0, parseInt(count, 10) || 0);
    refresh();
}

module.exports = { create, destroy, setUnread, refresh };
