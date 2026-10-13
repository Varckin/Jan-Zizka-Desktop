const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const FILE_NAME = 'client-settings.json';

const DEFAULTS = {
    serverUrl: 'https://chat.varckin.xyz',
    locale: null,
    notifications: {
        enabled: true,
        sound: true,
        preview: true,
        onlyWhenHidden: true,
    },
    window: {
        bounds: null,
        maximized: false,
        closeToTray: true,
        startMinimized: false,
    },
    tray: {
        enabled: true,
    },
    privacy: {
        clearCacheOnQuit: true,
    },
    autoUpdate: {
        enabled: true,
    },
    autoStart: false,
};

let cache = null;
let filePath = null;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, patch) {
    const out = clone(base);
    for (const key of Object.keys(patch || {})) {
        const value = patch[key];
        if (value === undefined) continue;
        if (isPlainObject(value) && isPlainObject(out[key])) {
            out[key] = mergeDeep(out[key], value);
        } else {
            out[key] = clone(value);
        }
    }
    return out;
}

function settingsFile() {
    if (!filePath) filePath = path.join(app.getPath('userData'), FILE_NAME);
    return filePath;
}

function decode(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.__enc === 1 && typeof parsed.data === 'string' && safeStorage.isEncryptionAvailable()) {
            return JSON.parse(safeStorage.decryptString(Buffer.from(parsed.data, 'base64')));
        }
        if (parsed && parsed.__enc !== 1) return parsed;
        return null;
    } catch {
        return null;
    }
}

function encode(data) {
    if (safeStorage.isEncryptionAvailable()) {
        try {
            const sealed = safeStorage.encryptString(JSON.stringify(data));
            return JSON.stringify({ __enc: 1, data: sealed.toString('base64') });
        } catch {
            return JSON.stringify(data);
        }
    }
    return JSON.stringify(data);
}

function load() {
    if (cache) return cache;
    let raw = null;
    try {
        raw = fs.readFileSync(settingsFile(), 'utf8');
    } catch {
        raw = null;
    }
    const parsed = decode(raw);
    cache = mergeDeep(DEFAULTS, parsed || {});
    return cache;
}

function all() {
    return clone(load());
}

function get(keyPath) {
    const parts = String(keyPath).split('.');
    let node = load();
    for (const part of parts) {
        if (!node || typeof node !== 'object') return undefined;
        node = node[part];
    }
    return node === undefined ? undefined : clone(node);
}

let writeTimer = null;

function persist() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
        writeTimer = null;
        try {
            fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
            const tmp = settingsFile() + '.tmp';
            fs.writeFileSync(tmp, encode(cache || DEFAULTS), 'utf8');
            fs.renameSync(tmp, settingsFile());
        } catch {
        }
    }, 60);
}

function set(patch) {
    cache = mergeDeep(load(), patch || {});
    persist();
    return clone(cache);
}

function reset() {
    cache = clone(DEFAULTS);
    persist();
    return clone(cache);
}

module.exports = { all, get, set, reset, DEFAULTS, clone };
