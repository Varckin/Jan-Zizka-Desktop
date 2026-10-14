const { execFile } = require('child_process');
const { ipcMain, shell, app, nativeImage, powerSaveBlocker, dialog } = require('electron');
const windowManager = require('./window');
const settings = require('./settings');
const cookieJar = require('./cookieJar');
const notifications = require('./notifications');
const tray = require('./tray');
const remote = require('./remote');
const templates = require('./templates');

let keepAwakeId = null;

function send(channel, payload) {
    windowManager.broadcast(channel, payload);
}

function register(localOrigin) {
    ipcMain.handle('window:minimize', () => windowManager.minimize());
    ipcMain.handle('window:toggle-maximize', () => windowManager.toggleMaximize());
    ipcMain.handle('window:close', () => windowManager.closeWindow());
    ipcMain.handle('window:is-maximized', () => windowManager.maximized());
    ipcMain.handle('window:is-focused', () => windowManager.focused());

    ipcMain.handle('notify:show', (event, payload) => {
        const result = notifications.show(payload || {});
        return !!result;
    });

    ipcMain.handle('unread:set', (event, count) => {
        const value = Math.max(0, parseInt(count, 10) || 0);
        tray.setUnread(value);
        return value;
    });

    ipcMain.handle('badge:set', (event, dataUrl, description) => {
        let image = null;
        if (dataUrl) {
            image = nativeImage.createFromDataURL(String(dataUrl));
            if (image.isEmpty()) image = null;
        }
        windowManager.setOverlayIcon(image, description || '');
        return true;
    });

    ipcMain.handle('settings:get', () => settings.all());
    ipcMain.handle('settings:set', (event, patch) => {
        const clean = Object.assign({}, patch || {});
        delete clean.serverUrl;
        const next = settings.set(clean);
        applyAutoStart(next.autoStart);
        send('desktop:settings-changed', next);
        return next;
    });

    ipcMain.handle('app:info', () => ({
        version: app.getVersion(),
        name: app.getName(),
        serverUrl: remote.serverOrigin(),
        platform: process.platform,
    }));

    ipcMain.handle('shell:open-external', (event, url) => {
        if (!/^https?:\/\//i.test(String(url || ''))) return false;
        shell.openExternal(String(url));
        return true;
    });

    ipcMain.handle('power:keep-awake-start', () => {
        if (keepAwakeId !== null) return keepAwakeId;
        keepAwakeId = powerSaveBlocker.start('prevent-display-sleep');
        return keepAwakeId;
    });

    ipcMain.handle('power:keep-awake-stop', () => {
        if (keepAwakeId === null) return false;
        if (powerSaveBlocker.isStarted(keepAwakeId)) powerSaveBlocker.stop(keepAwakeId);
        keepAwakeId = null;
        return true;
    });

    ipcMain.handle('session:logout', async () => {
        try {
            await remote.requestJson('GET', '/auth/logout');
        } catch {
        }
        cookieJar.clear();
        templates.invalidate();
        return true;
    });

    ipcMain.handle('updater:state', () => require('./updater').getState());
    ipcMain.handle('updater:check', () => require('./updater').check(true));
    ipcMain.handle('updater:install', () => require('./updater').quitAndInstall());

    ipcMain.handle('app:quit', () => {
        windowManager.setQuitting(true);
        app.quit();
    });

}

const AUTOSTART_ENTRY_NAME = 'jan.messenger.desktop';
const AUTOSTART_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTOSTART_APPROVED_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

function runReg(args) {
    try {
        execFile('reg', args, { windowsHide: true }, () => { });
    } catch {
    }
}

function applyAutoStart(enabled) {
    if (!app.isPackaged || process.platform !== 'win32') return;
    if (enabled) {
        runReg(['add', AUTOSTART_RUN_KEY, '/v', AUTOSTART_ENTRY_NAME, '/t', 'REG_SZ', '/d', `"${process.execPath}"`, '/f']);
        runReg(['delete', AUTOSTART_APPROVED_KEY, '/v', AUTOSTART_ENTRY_NAME, '/f']);
    } else {
        runReg(['delete', AUTOSTART_RUN_KEY, '/v', AUTOSTART_ENTRY_NAME, '/f']);
        runReg(['delete', AUTOSTART_APPROVED_KEY, '/v', AUTOSTART_ENTRY_NAME, '/f']);
    }
}

module.exports = { register, applyAutoStart, send };
