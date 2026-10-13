const path = require('path');
const { BrowserWindow, shell, nativeImage, session } = require('electron');
const settings = require('./settings');
const { resolveFromApp, IS_PACKAGED } = require('./paths');

let mainWindow = null;
let isQuitting = false;
let isFocused = true;
let isMaximizedState = false;

function iconPath() {
    const candidates = [
        path.join(resolveFromApp('build'), 'icon.ico'),
        path.join(resolveFromApp('src', 'renderer', 'static', 'img'), 'logo.png'),
    ];
    for (const file of candidates) {
        try {
            const img = nativeImage.createFromPath(file);
            if (!img.isEmpty()) return img;
        } catch {
        }
    }
    return undefined;
}

function createMainWindow(localOrigin) {
    const saved = settings.get('window') || {};
    const bounds = saved.bounds && typeof saved.bounds === 'object' ? saved.bounds : null;

    mainWindow = new BrowserWindow({
        width: bounds && bounds.width ? bounds.width : 1280,
        height: bounds && bounds.height ? bounds.height : 820,
        x: bounds && typeof bounds.x === 'number' ? bounds.x : undefined,
        y: bounds && typeof bounds.y === 'number' ? bounds.y : undefined,
        minWidth: 940,
        minHeight: 600,
        show: false,
        backgroundColor: '#12121f',
        title: 'Jan Messenger',
        icon: iconPath(),
        autoHideMenuBar: true,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(resolveFromApp('src', 'preload'), 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            spellcheck: false,
            backgroundThrottling: false,
            webSecurity: true,
            devTools: true,
        },
    });

    if (saved.maximized) {
        mainWindow.maximize();
    }

    mainWindow.once('ready-to-show', () => {
        if (!settings.get('window.startMinimized')) mainWindow.show();
        else mainWindow.minimize();
    });

    mainWindow.on('resize', persistBounds);
    mainWindow.on('move', persistBounds);
    mainWindow.on('maximize', () => {
        isMaximizedState = true;
        settings.set({ window: { maximized: true } });
        emitMaximized();
    });
    mainWindow.on('unmaximize', () => {
        isMaximizedState = false;
        settings.set({ window: { maximized: false } });
        emitMaximized();
    });

    mainWindow.on('focus', () => {
        isFocused = true;
        mainWindow.flashFrame(false);
        broadcast('desktop:focus-changed', true);
    });
    mainWindow.on('blur', () => {
        isFocused = false;
        broadcast('desktop:focus-changed', false);
    });

    mainWindow.on('close', event => {
        if (isQuitting) return;
        if (settings.get('window.closeToTray') && settings.get('tray.enabled')) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    if (IS_PACKAGED) {
        mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.type !== 'keyDown') return;
            const combo = `${input.control ? 'ctrl' : ''}${input.shift ? 'shift' : ''}${input.meta ? 'meta' : ''}${input.key.toLowerCase()}`;
            if (combo === 'ctrlshifti' || combo === 'f12' || combo === 'ctrlshiftc') event.preventDefault();
        });
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(localOrigin)) {
            event.preventDefault();
            if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        }
    });

    mainWindow.webContents.on('page-title-updated', (event, title) => {
        broadcast('desktop:title-changed', title);
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ['media', 'mediaKeySystem', 'audioCapture', 'notifications', 'fullscreen', 'clipboard-sanitized-write'];
        callback(allowed.includes(permission));
    });

    attachDownloads(mainWindow);

    mainWindow.loadURL(localOrigin + '/');
    return mainWindow;
}

let persistTimer = null;

function persistBounds() {
    if (!mainWindow || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = null;
        if (!mainWindow || mainWindow.isMaximized()) return;
        settings.set({ window: { bounds: mainWindow.getBounds() } });
    }, 400);
}

function attachDownloads(win) {
    win.webContents.session.on('will-download', (event, item) => {
        const total = item.getTotalBytes();
        item.on('updated', (e, state) => {
            if (state === 'progressing' && total > 0 && !win.isDestroyed()) {
                win.setProgressBar(Math.min(1, item.getReceivedBytes() / total));
            }
        });
        item.once('done', (e, state) => {
            if (!win.isDestroyed()) win.setProgressBar(-1);
            if (state === 'completed') {
                broadcast('desktop:download-completed', {
                    filename: item.getFilename(),
                    path: item.getSavePath(),
                });
            }
        });
    });
}

function emitMaximized() {
    broadcast('desktop:maximized-changed', isMaximizedState);
}

function broadcast(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

function getWindow() {
    return mainWindow;
}

function show() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function hide() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function toggleMaximize() {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
}

function minimize() {
    if (mainWindow) mainWindow.minimize();
}

function closeWindow() {
    if (mainWindow) mainWindow.close();
}

function navigate(pathAndQuery) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const origin = mainWindow.webContents.getURL();
    if (!origin) return;
    mainWindow.loadURL(new URL(pathAndQuery, origin).toString());
}

function setQuitting(value) {
    isQuitting = !!value;
}

function quitting() {
    return isQuitting;
}

function focused() {
    return isFocused && !!mainWindow && !mainWindow.isMinimized();
}

function maximized() {
    return isMaximizedState;
}

function flash() {
    if (mainWindow && !mainWindow.isDestroyed() && !isFocused) {
        mainWindow.flashFrame(true);
    }
}

function setOverlayIcon(image, description) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOverlayIcon(image || null, description || '');
    }
}

module.exports = {
    createMainWindow,
    getWindow,
    show,
    hide,
    minimize,
    toggleMaximize,
    closeWindow,
    navigate,
    setQuitting,
    quitting,
    focused,
    maximized,
    flash,
    broadcast,
    setOverlayIcon,
    iconPath,
};
