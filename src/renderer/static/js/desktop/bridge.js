export function isDesktop() {
    return typeof window.desktopAPI !== 'undefined';
}

export function desktopAPI() {
    return window.desktopAPI;
}

export async function getSettings() {
    if (!isDesktop()) return {};
    try {
        return await window.desktopAPI.getSettings();
    } catch {
        return {};
    }
}

export async function setSettings(patch) {
    if (!isDesktop()) return null;
    try {
        return await window.desktopAPI.setSettings(patch);
    } catch {
        return null;
    }
}

export async function getAppInfo() {
    if (!isDesktop()) return null;
    try {
        return await window.desktopAPI.getAppInfo();
    } catch {
        return null;
    }
}

export function openExternal(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return;
    if (isDesktop()) window.desktopAPI.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
}

export async function logout() {
    if (isDesktop()) {
        try {
            await window.desktopAPI.logout();
        } catch {
        }
    }
    window.location.href = '/auth?mode=login';
}
