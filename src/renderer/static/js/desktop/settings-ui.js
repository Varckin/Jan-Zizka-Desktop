import * as bridge from './bridge.js';
import { initLangSwitcher } from './i18n.js';
import { loadZxcvbnUmd } from './zxcvbn-loader.js';
import { showToast } from '../core_chat/toast.js';
import { s } from './strings.js';
import { confirmDialog } from './confirm.js';

const TOGGLES = [
    { id: 'desktop-notif-enabled', key: value => ({ notifications: { enabled: value } }) },
    { id: 'desktop-notif-sound', key: value => ({ notifications: { sound: value } }) },
    { id: 'desktop-notif-preview', key: value => ({ notifications: { preview: value } }) },
    { id: 'desktop-notif-hidden', key: value => ({ notifications: { onlyWhenHidden: value } }) },
    { id: 'desktop-close-to-tray', key: value => ({ window: { closeToTray: value } }) },
    { id: 'desktop-tray-enabled', key: value => ({ tray: { enabled: value } }) },
    { id: 'desktop-auto-start', key: value => ({ autoStart: value }) },
    { id: 'desktop-clear-cache', key: value => ({ privacy: { clearCacheOnQuit: value } }) },
    { id: 'desktop-auto-update', key: value => ({ autoUpdate: { enabled: value } }) },
    { id: 'desktop-start-minimized', key: value => ({ window: { startMinimized: value } }) },
];

let bound = false;

function readValue(settings, id) {
    const map = {
        'desktop-notif-enabled': () => settings.notifications && settings.notifications.enabled !== false,
        'desktop-notif-sound': () => settings.notifications && settings.notifications.sound !== false,
        'desktop-notif-preview': () => settings.notifications && settings.notifications.preview !== false,
        'desktop-notif-hidden': () => settings.notifications && settings.notifications.onlyWhenHidden !== false,
        'desktop-close-to-tray': () => !settings.window || settings.window.closeToTray !== false,
        'desktop-tray-enabled': () => !settings.tray || settings.tray.enabled !== false,
        'desktop-auto-start': () => !!settings.autoStart,
        'desktop-clear-cache': () => !settings.privacy || settings.privacy.clearCacheOnQuit !== false,
        'desktop-auto-update': () => !settings.autoUpdate || settings.autoUpdate.enabled !== false,
        'desktop-start-minimized': () => !!(settings.window && settings.window.startMinimized),
    };
    const fn = map[id];
    return fn ? fn(settings) : false;
}

async function refreshToggles() {
    const settings = await bridge.getSettings();
    for (const entry of TOGGLES) {
        const el = document.getElementById(entry.id);
        if (el) el.checked = readValue(settings, entry.id);
    }
}

async function fillAbout() {
    const info = await bridge.getAppInfo();
    const versionEl = document.getElementById('about-version');
    if (versionEl) versionEl.textContent = info ? `${info.version}` : (window.APP_DATA ? window.APP_DATA.version : '—');
}

async function handleLogout() {
    const ok = await confirmDialog(s('logout_confirm'));
    if (!ok) return;
    await bridge.logout();
}

const UPDATE_STATE_KEYS = {
    idle: 'desktop_update_state_idle',
    checking: 'desktop_update_state_checking',
    available: 'desktop_update_state_available',
    verifying: 'desktop_update_state_verifying',
    downloading: 'desktop_update_state_downloading',
    downloaded: 'desktop_update_state_downloaded',
    'up-to-date': 'desktop_update_state_up_to_date',
    error: 'desktop_update_state_error',
    unsupported: 'desktop_update_state_unsupported',
};

function renderUpdaterState(st) {
    const stateEl = document.getElementById('about-update-state');
    const installBtn = document.getElementById('about-update-install');
    const checkBtn = document.getElementById('about-update-check');
    if (!stateEl) return;
    const key = UPDATE_STATE_KEYS[st.status] || 'desktop_update_state_idle';
    let text = s(key);
    if (st.status === 'downloading') text = `${text} — ${st.progress || 0}%`;
    if (st.status === 'downloaded' || st.status === 'available') text = `${text} (${st.version || '?'})`;
    if (st.status === 'error' && st.error) text = `${text}: ${st.error}`;
    stateEl.textContent = text;
    if (installBtn) installBtn.classList.toggle('is-hidden', st.status !== 'downloaded');
    if (checkBtn) checkBtn.disabled = st.status === 'checking' || st.status === 'downloading';
}

function bindUpdaterUi() {
    const stateEl = document.getElementById('about-update-state');
    const checkBtn = document.getElementById('about-update-check');
    const installBtn = document.getElementById('about-update-install');
    if (window.desktopAPI) {
        window.desktopAPI.updaterState().then(renderUpdaterState).catch(() => { });
        window.desktopAPI.on('desktop:update-state', renderUpdaterState);
    } else if (stateEl) {
        stateEl.textContent = s('desktop_update_state_unsupported');
    }
    if (checkBtn) {
        checkBtn.addEventListener('click', () => {
            if (!window.desktopAPI) return;
            window.desktopAPI.updaterCheck().then(renderUpdaterState).catch(() => { });
        });
    }
    if (installBtn) {
        installBtn.addEventListener('click', () => {
            if (!window.desktopAPI) return;
            window.desktopAPI.updaterInstall().catch(() => { });
        });
    }
}

export async function init() {
    initLangSwitcher(document.getElementById('view-settings') || document);
    loadZxcvbnUmd().catch(() => { });
    await refreshToggles();
    await fillAbout();

    if (bound) return;
    bound = true;

    for (const entry of TOGGLES) {
        const el = document.getElementById(entry.id);
        if (!el) continue;
        el.addEventListener('change', async function () {
            const patch = entry.key(this.checked);
            const next = await bridge.setSettings(patch);
            if (next) {
                window.APP_DATA = window.APP_DATA || {};
                window.APP_DATA.settings = next;
            }
            showToast(s('settings_saved'), { icon: '⚙️', type: 'success' });
        });
    }

    const logoutBtn = document.getElementById('about-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    bindUpdaterUi();

    window.__desktopSettingsBound = true;

    if (window.desktopAPI) {
        window.desktopAPI.on('desktop:settings-changed', settings => {
            if (!settings) return;
            window.APP_DATA = window.APP_DATA || {};
            window.APP_DATA.settings = settings;
            refreshToggles();
        });
        window.desktopAPI.on('desktop:download-completed', payload => {
            if (!payload || !payload.path) return;
            showToast(s('download_done'), { icon: '📥', type: 'success' });
        });
    }
}
