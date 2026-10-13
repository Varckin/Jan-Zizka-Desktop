import { createNotificationAudio } from '../core_chat/sound.js';

const hasDesktop = () => typeof window.desktopAPI !== 'undefined';

let focusState = typeof document !== 'undefined' ? !document.hidden && document.hasFocus() : true;

if (hasDesktop()) {
    window.desktopAPI.on('desktop:focus-changed', focused => {
        focusState = !!focused;
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') focusState = document.hasFocus();
        else focusState = false;
    });
    window.addEventListener('focus', () => { focusState = true; });
    window.addEventListener('blur', () => { focusState = false; });
}

export function appSettings() {
    const data = window.APP_DATA || {};
    return data.settings || {};
}

export function notificationsEnabled() {
    const settings = appSettings();
    if (!settings.notifications) return true;
    return settings.notifications.enabled !== false;
}

export function soundEnabled() {
    const settings = appSettings();
    if (!settings.notifications) return true;
    return settings.notifications.sound !== false;
}

export function isDesktopBackground() {
    if (typeof document !== 'undefined' && document.hidden) return true;
    return !focusState;
}

export function createNotificationAudioFromSettings() {
    if (!soundEnabled()) return null;
    try {
        const audio = createNotificationAudio();
        audio.addEventListener('error', function fallbackToBundled() {
            audio.removeEventListener('error', fallbackToBundled);
            if (String(audio.src).endsWith('/notification.wav')) return;
            audio.src = '/static/sound/notification.wav';
        });
        return audio;
    } catch {
        return null;
    }
}

export function notifyMessage(payload) {
    if (!notificationsEnabled()) return Promise.resolve(false);
    const settings = appSettings();
    const onlyWhenHidden = !settings.notifications || settings.notifications.onlyWhenHidden !== false;
    if (onlyWhenHidden && !isDesktopBackground()) return Promise.resolve(false);

    if (hasDesktop()) {
        return window.desktopAPI.notify(payload).catch(() => false);
    }

    return new Promise(resolve => {
        if (!('Notification' in window) || Notification.permission !== 'granted') {
            resolve(false);
            return;
        }
        try {
            const notification = new Notification(payload.title || '', {
                body: payload.body || '',
                icon: payload.icon || '/static/img/logo.png',
                tag: payload.tag,
            });
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            resolve(true);
        } catch {
            resolve(false);
        }
    });
}

export function notifyPlain(title, body, tag) {
    return notifyMessage({ title, body, tag, data: {} });
}
