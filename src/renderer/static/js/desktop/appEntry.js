import * as shell from './shell.js';
import * as badge from './badge.js';
import * as bridge from './bridge.js';
import { initLangSwitcher } from './i18n.js';
import { initPasswordToggles } from './passwordToggle.js';
import { initTitlebar } from './titlebar.js';
import { showToast } from '../core_chat/toast.js';
import { s } from './strings.js';

let chatApiPromise = null;
let e2eLoadPromise = null;
let e2eLoadFailed = false;
let settingsInitPromise = null;
let profileInitPromise = null;

function importChatList() {
    if (!chatApiPromise) chatApiPromise = import('../chat/chatList.js');
    return chatApiPromise;
}

function loadE2e() {
    if (e2eLoadFailed) return Promise.reject(new Error('e2e-unavailable'));
    if (!e2eLoadPromise) {
        e2eLoadPromise = import('./zxcvbn-loader.js').then(m => m.loadZxcvbnUmd()).catch(() => false).then(() => import('../e2e/main.js')).catch(err => {
            e2eLoadFailed = true;
            e2eLoadPromise = null;
            console.error('E2E module failed to load', err);
            showToast(s('e2e_lib_missing'), { icon: '🔒', type: 'error', duration: 6000 });
            throw err;
        });
    }
    return e2eLoadPromise;
}

async function loadProfileWithRetry() {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const mod = await import('../profile/init.js');
            mod.init();
            return true;
        } catch (err) {
            console.warn('profile init attempt failed', attempt + 1, err);
            await new Promise(resolve => setTimeout(resolve, 600));
        }
    }
    return false;
}

function initProfileView() {
    if (!profileInitPromise) {
        profileInitPromise = loadProfileWithRetry().then(ok => {
            if (!ok) {
                profileInitPromise = null;
                showToast(s('profile_load_failed', 'Failed to open profile'), { icon: '⚠️', type: 'error' });
            }
            return ok;
        });
    }
    return profileInitPromise;
}

function initSettingsView() {
    if (!settingsInitPromise) {
        settingsInitPromise = import('./settings-ui.js').then(m => m.init()).catch(err => {
            console.error('settings init failed', err);
            settingsInitPromise = null;
        });
    }
    return settingsInitPromise;
}

async function openInvite(code) {
    try {
        window.history.replaceState({}, '', `/app?invite=${encodeURIComponent(code)}`);
        const inviteJoin = await import('../chat/inviteJoin.js');
        await inviteJoin.handleInviteParam();
    } catch (err) {
        console.error('failed to open invite', err);
    }
}

async function openCloudChat(chatId) {
    const id = parseInt(chatId, 10);
    if (!Number.isFinite(id)) return;
    shell.switchView('chat');
    try {
        const chatList = await importChatList();
        await chatList.selectChat(id);
    } catch (err) {
        console.error('failed to open chat', err);
    }
}

async function openVaultChat(chatId) {
    const id = parseInt(chatId, 10);
    if (!Number.isFinite(id)) return;
    shell.switchView('e2e');
    try {
        await loadE2e();
        const [{ STATE }, { openChat }] = await Promise.all([
            import('../e2e/state.js'),
            import('../e2e/chat.js'),
        ]);
        const chat = STATE.chats.find(c => c.id === id);
        if (chat) await openChat(chat);
    } catch (err) {
        console.error('failed to open e2e chat', err);
    }
}

function bindNotificationRouting() {
    if (!window.desktopAPI) return;
    window.desktopAPI.on('desktop:notification-click', data => {
        if (!data) return;
        if (data.chatId !== undefined && data.chatId !== null) openCloudChat(data.chatId);
        else if (data.e2eChatId !== undefined && data.e2eChatId !== null) openVaultChat(data.e2eChatId);
    });
}

function bindNavigatePayloads() {
    shell.onView('chat', ({ options }) => {
        const nav = options && options.navigate;
        if (!nav || !nav.query) return;
        if (nav.query.chat_id) openCloudChat(nav.query.chat_id);
        if (nav.query.invite) openInvite(String(nav.query.invite));
    });
    shell.onView('e2e', ({ options }) => {
        const nav = options && options.navigate;
        if (nav && nav.query && nav.query.chat_id) openVaultChat(nav.query.chat_id);
    });
    shell.onView('profile', ({ options }) => {
        const nav = options && options.navigate;
        if (nav && nav.view === 'profile') initProfileView();
    });
}

async function main() {
    if (window.desktopAPI) initTitlebar();
    initPasswordToggles(document);
    bindNotificationRouting();
    bindNavigatePayloads();
    initLangSwitcher(document);

    shell.onView('e2e', ({ firstActivation }) => {
        if (firstActivation) loadE2e().catch(() => { });
    });
    shell.onView('profile', () => {
        initProfileView();
    });
    shell.onView('settings', () => {
        initSettingsView();
    });

    shell.init();
    badge.init();

    try {
        const chatInit = await import('../chat/init.js');
        chatInit.init();
    } catch (err) {
        console.error('chat init failed', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
