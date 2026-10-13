const { Notification, nativeImage } = require('electron');
const windowManager = require('./window');
const settings = require('./settings');

let lastNotification = null;

function resolveIcon(iconUrl) {
    const img = windowManager.iconPath();
    if (img && !img.isEmpty()) return img;
    return nativeImage.createEmpty();
}

function show(payload) {
    const notif = settings.get('notifications') || {};
    if (!notif.enabled) return null;
    if (!Notification.isSupported()) return null;

    const hidden = !windowManager.focused();
    if (notif.onlyWhenHidden && !hidden) return null;

    let body = String(payload.body || '');
    if (!notif.preview) {
        body = '•••';
    }

    const notification = new Notification({
        title: String(payload.title || ''),
        body,
        icon: resolveIcon(payload.icon),
        silent: !notif.sound,
        urgency: 'normal',
    });

    notification.on('click', () => {
        windowManager.show();
        windowManager.broadcast('desktop:notification-click', payload.data || {});
    });

    if (lastNotification && typeof lastNotification.close === 'function') {
        try { lastNotification.close(); } catch { }
    }
    lastNotification = notification;
    notification.show();
    windowManager.flash();
    return notification;
}

module.exports = { show };
