const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const FILE_NAME = 'client-cookies.json';

let jar = null;
let filePath = null;
let loaded = false;

function cookieFile() {
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
        if (parsed && parsed.__enc !== 1 && parsed.cookies) return parsed;
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

function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    let raw = null;
    try {
        raw = fs.readFileSync(cookieFile(), 'utf8');
    } catch {
        raw = null;
    }
    const parsed = decode(raw);
    jar = parsed && parsed.cookies ? parsed.cookies : {};
}

function persist() {
    ensureLoaded();
    try {
        fs.mkdirSync(path.dirname(cookieFile()), { recursive: true });
        const payload = { cookies: jar, savedAt: Date.now() };
        const tmp = cookieFile() + '.tmp';
        fs.writeFileSync(tmp, encode(payload), 'utf8');
        fs.renameSync(tmp, cookieFile());
    } catch {
    }
}

function parseSetCookie(headerValue) {
    const segments = String(headerValue).split(';');
    const pair = segments.shift();
    const idx = pair.indexOf('=');
    if (idx <= 0) return null;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    const attrs = {};
    for (const seg of segments) {
        const s = seg.trim();
        if (!s) continue;
        const eq = s.indexOf('=');
        if (eq < 0) attrs[s.toLowerCase()] = true;
        else attrs[s.slice(0, eq).trim().toLowerCase()] = s.slice(eq + 1).trim();
    }
    const expired = !value || (attrs['max-age'] !== undefined && Number(attrs['max-age']) <= 0)
        || (attrs.expires !== undefined && Date.parse(attrs.expires) <= Date.now());
    return { name, value, expired };
}

function absorbResponseHeaders(headers) {
    ensureLoaded();
    const raw = headers['set-cookie'];
    if (!raw) return;
    const list = Array.isArray(raw) ? raw : [raw];
    let changed = false;
    for (const item of list) {
        const parsed = parseSetCookie(item);
        if (!parsed) continue;
        if (parsed.expired) {
            if (jar[parsed.name] !== undefined) {
                delete jar[parsed.name];
                changed = true;
            }
        } else if (jar[parsed.name] !== parsed.value) {
            jar[parsed.name] = parsed.value;
            changed = true;
        }
    }
    if (changed) persist();
}

function headerValue() {
    ensureLoaded();
    const names = Object.keys(jar);
    if (!names.length) return null;
    return names.map(name => `${name}=${jar[name]}`).join('; ');
}

function has(name) {
    ensureLoaded();
    return Object.prototype.hasOwnProperty.call(jar, name);
}

function getCookie(name) {
    ensureLoaded();
    return jar[name];
}

function setCookie(name, value) {
    ensureLoaded();
    jar[name] = value;
    persist();
}

function removeCookie(name) {
    ensureLoaded();
    if (jar[name] === undefined) return;
    delete jar[name];
    persist();
}

function clear() {
    jar = {};
    loaded = true;
    persist();
}

function isAuthorized() {
    return has('session');
}

module.exports = {
    absorbResponseHeaders,
    headerValue,
    has,
    getCookie,
    setCookie,
    removeCookie,
    clear,
    isAuthorized,
};
