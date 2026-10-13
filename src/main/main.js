const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');
const { DEFAULT_SERVER_URL, APP_PROTOCOL } = require('./config');

const settings = require('./settings');
const localServer = require('./localServer');
const windowManager = require('./window');
const tray = require('./tray');
const ipc = require('./ipc');
const proxy = require('./proxy');
const deepLink = require('./deepLink');
const templates = require('./templates');
const desktopStrings = require('./desktopStrings');
const notifications = require('./notifications');
const cookieJar = require('./cookieJar');

let serverInfo = null;
let pendingDeepLink = null;

async function purgeMediaCache() {
    const { session } = require('electron');
    const ses = session.defaultSession;
    await ses.clearCache();
    try {
        await ses.clearStorageData({ storages: ['cachestorage', 'shadercache'] });
    } catch {
    }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    bootstrap();
}

function applyProtocol() {
    if (process.platform === 'win32') {
        const args = process.defaultApp ? [path.resolve(process.argv[1]), '--'] : ['--'];
        app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, args);
    } else {
        app.setAsDefaultProtocolClient(APP_PROTOCOL);
    }
}

function buildMenu() {
    const template = [
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'close' },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function syncLocaleStrings() {
    try {
        await templates.buildDictionary(true);
        desktopStrings.setLocale(detectLocaleSafe());
    } catch {
    }
}

function detectLocaleSafe() {
    const forced = settings.get('locale');
    if (forced && desktopStrings.SUPPORTED.includes(forced)) return forced;
    const fromCookie = cookieJar.getCookie('locale');
    if (fromCookie && desktopStrings.SUPPORTED.includes(fromCookie)) return fromCookie;
    const candidate = String(app.getLocale() || 'en').split('-')[0].toLowerCase();
    return desktopStrings.SUPPORTED.includes(candidate) ? candidate : 'en';
}

async function bootstrap() {
    applyProtocol();
    buildMenu();
    app.setAppUserModelId('jan.messenger.desktop');

    await app.whenReady();

    ipc.applyAutoStart(settings.get('autoStart'));
    await syncLocaleStrings();

    serverInfo = await localServer.start({
        onLoggedIn: () => {
            syncLocaleStrings();
            tray.create();
        },
        onLoggedOut: () => {
            tray.setUnread(0);
        },
        onError: err => {
            console.error('[localServer]', err);
        },
    });

    ipc.register(serverInfo.origin);

    const updater = require('./updater');
    let updateNotified = false;
    updater.initUpdater(st => {
        windowManager.broadcast('desktop:update-state', st);
        tray.refresh();
        if (st.status === 'downloaded' && !updateNotified) {
            updateNotified = true;
            notifications.show({
                title: desktopStrings.s('notif_update_ready'),
                body: desktopStrings.s('notif_update_ready_body'),
                data: {},
            });
        }
    });

    if ((settings.get('privacy') || {}).clearCacheOnQuit !== false) {
        try {
            await purgeMediaCache();
        } catch {
        }
    }

    proxy.events.on('unauthorized', () => {
        cookieJar.removeCookie('session');
        tray.setUnread(0);
        windowManager.navigate('/auth');
    });

    const win = windowManager.createMainWindow(serverInfo.origin);

    if (settings.get('tray.enabled')) tray.create();

    win.webContents.on('did-finish-load', () => {
        syncLocaleStrings().then(() => {
            const url = new URL(win.webContents.getURL());
            if (url.pathname === '/app') tray.create();
        });
    });

    const startupUrl = deepLink.extractUrlFromArgv(process.argv);
    if (startupUrl) pendingDeepLink = startupUrl;
    if (pendingDeepLink) {
        const link = pendingDeepLink;
        pendingDeepLink = null;
        setTimeout(() => deepLink.handleUrl(link), 800);
    }

    app.on('second-instance', (event, argv) => {
        windowManager.show();
        const url = deepLink.extractUrlFromArgv(argv);
        if (url) deepLink.handleUrl(url);
    });

    app.on('open-url', (event, url) => {
        event.preventDefault();
        if (windowManager.getWindow()) deepLink.handleUrl(url);
        else pendingDeepLink = url;
    });

    app.on('before-quit', () => {
        windowManager.setQuitting(true);
    });

    let cachePurgedOnQuit = false;
    app.on('will-quit', event => {
        const current = settings.get('privacy') || {};
        if (cachePurgedOnQuit || current.clearCacheOnQuit === false) return;
        event.preventDefault();
        cachePurgedOnQuit = true;
        purgeMediaCache().catch(() => { }).finally(() => app.exit(0));
    });

    app.on('window-all-closed', () => {
        if (!settings.get('window.closeToTray') || !settings.get('tray.enabled')) app.quit();
    });

    app.on('activate', () => {
        if (!windowManager.getWindow() && serverInfo) {
            windowManager.createMainWindow(serverInfo.origin);
        } else {
            windowManager.show();
        }
    });
}

process.on('uncaughtException', err => {
    console.error('[main] uncaught', err);
});

process.on('unhandledRejection', reason => {
    console.error('[main] unhandled rejection', reason);
});
