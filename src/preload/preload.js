const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = {
    windowMinimize: 'window:minimize',
    windowToggleMaximize: 'window:toggle-maximize',
    windowClose: 'window:close',
    windowIsMaximized: 'window:is-maximized',
    windowIsFocused: 'window:is-focused',
    notifyShow: 'notify:show',
    unreadSet: 'unread:set',
    badgeSet: 'badge:set',
    settingsGet: 'settings:get',
    settingsSet: 'settings:set',
    appInfo: 'app:info',
    shellOpenExternal: 'shell:open-external',
    powerKeepAwakeStart: 'power:keep-awake-start',
    powerKeepAwakeStop: 'power:keep-awake-stop',
    sessionLogout: 'session:logout',
    appQuit: 'app:quit',
    updaterState: 'updater:state',
    updaterCheck: 'updater:check',
    updaterInstall: 'updater:install',
};

const EVENTS = [
    'desktop:focus-changed',
    'desktop:maximized-changed',
    'desktop:notification-click',
    'desktop:navigate',
    'desktop:settings-changed',
    'desktop:title-changed',
    'desktop:download-completed',
    'desktop:update-state',
];

const listeners = new Map();

for (const channel of EVENTS) {
    const handler = (event, payload) => {
        const callbacks = listeners.get(channel);
        if (!callbacks) return;
        for (const cb of Array.from(callbacks)) {
            try {
                cb(payload);
            } catch {
            }
        }
    };
    ipcRenderer.on(channel, handler);
}

const api = {
    platform: 'desktop',
    minimize: () => ipcRenderer.invoke(INVOKE.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(INVOKE.windowToggleMaximize),
    close: () => ipcRenderer.invoke(INVOKE.windowClose),
    isMaximized: () => ipcRenderer.invoke(INVOKE.windowIsMaximized),
    isFocused: () => ipcRenderer.invoke(INVOKE.windowIsFocused),
    notify: payload => ipcRenderer.invoke(INVOKE.notifyShow, payload),
    setUnread: count => ipcRenderer.invoke(INVOKE.unreadSet, count),
    setBadgeIcon: (dataUrl, description) => ipcRenderer.invoke(INVOKE.badgeSet, dataUrl, description),
    getSettings: () => ipcRenderer.invoke(INVOKE.settingsGet),
    setSettings: patch => ipcRenderer.invoke(INVOKE.settingsSet, patch),
    getAppInfo: () => ipcRenderer.invoke(INVOKE.appInfo),
    openExternal: url => ipcRenderer.invoke(INVOKE.shellOpenExternal, url),
    keepAwakeStart: () => ipcRenderer.invoke(INVOKE.powerKeepAwakeStart),
    keepAwakeStop: () => ipcRenderer.invoke(INVOKE.powerKeepAwakeStop),
    logout: () => ipcRenderer.invoke(INVOKE.sessionLogout),
    quit: () => ipcRenderer.invoke(INVOKE.appQuit),
    updaterState: () => ipcRenderer.invoke(INVOKE.updaterState),
    updaterCheck: () => ipcRenderer.invoke(INVOKE.updaterCheck),
    updaterInstall: () => ipcRenderer.invoke(INVOKE.updaterInstall),
    on(channel, callback) {
        if (!EVENTS.includes(channel)) return () => { };
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel).add(callback);
        return () => {
            const set = listeners.get(channel);
            if (set) set.delete(callback);
        };
    },
};

contextBridge.exposeInMainWorld('desktopAPI', api);
