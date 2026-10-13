import { b64, unb64 } from './crypto.js';

const VAULT_KEY = 'e2e_vault';
const IDENTITY_KEY = 'e2e_identity_v3';
const SETTINGS_KEY = 'e2e_vault_settings';
const ATTEMPTS_KEY = 'e2e_vault_attempts';
const PLAINTEXT_PREFIX = 'e2e_plaintext:';
const CHANNEL_NAME = 'e2e-vault-sync';
const VERIFIER_TEXT = 'e2e-vault-verifier-v2';

export const ITERATIONS = 310000;
export const MAX_ATTEMPTS = 5;
export const MIN_PASSPHRASE_LENGTH = 8;
export const AUTOLOCK_CHOICES = [0, 1, 5, 15, 30];

let _key = null;
let _rawKey = null;
let _record = null;
let _unlocked = false;
let _channel = null;
let _writeChain = Promise.resolve();
let _recordDirty = false;
let _suppressBroadcast = false;
const _listeners = { locked: [], unlocked: [], reset: [] };

export function on(event, fn) {
    if (_listeners[event]) _listeners[event].push(fn);
}

function emit(event) {
    for (const fn of _listeners[event] || []) {
        try { fn(); } catch (e) { console.error('vault listener error', e); }
    }
}

export function isUnlocked() {
    return _unlocked;
}

export function hasVault() {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return false;
    try {
        const meta = JSON.parse(raw);
        return !!(meta && meta.v === 2 && meta.salt && meta.iv && meta.ct);
    } catch {
        return false;
    }
}

async function deriveKey(passphrase, salt) {
    const base = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

async function encryptText(key, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)
    );
    return { iv: b64(iv), ct: b64(ct) };
}

async function decryptText(key, ivB64, ctB64) {
    try {
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(unb64(ivB64)) },
            key,
            unb64(ctB64)
        );
        return new TextDecoder().decode(plain);
    } catch {
        return null;
    }
}

function readMeta() {
    try {
        const meta = JSON.parse(localStorage.getItem(VAULT_KEY));
        if (!meta || meta.v !== 2) return null;
        return meta;
    } catch {
        return null;
    }
}

function writeMeta(meta) {
    localStorage.setItem(VAULT_KEY, JSON.stringify(meta));
}

async function loadRecordFromStorage() {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) {
        _record = null;
        return;
    }
    try {
        const env = JSON.parse(raw);
        if (env && env.v === 2 && env.iv && env.ct && _key) {
            const text = await decryptText(_key, env.iv, env.ct);
            _record = text ? JSON.parse(text) : null;
        } else {
            localStorage.removeItem(IDENTITY_KEY);
            _record = null;
        }
    } catch {
        localStorage.removeItem(IDENTITY_KEY);
        _record = null;
    }
}

function broadcast(message) {
    if (_suppressBroadcast) return;
    try {
        if (_channel) _channel.postMessage(message);
    } catch {}
}

export function initChannel() {
    if (_channel || typeof BroadcastChannel === 'undefined') return;
    try {
        _channel = new BroadcastChannel(CHANNEL_NAME);
        _channel.onmessage = async (event) => {
            const data = event.data || {};
            if (data.type === 'unlocked' && !_unlocked && data.raw) {
                try {
                    _key = await crypto.subtle.importKey(
                        'raw', data.raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
                    );
                    _rawKey = data.raw;
                    _unlocked = true;
                    resetAttempts();
                    await loadRecordFromStorage();
                    _suppressBroadcast = true;
                    emit('unlocked');
                    _suppressBroadcast = false;
                } catch {
                    _unlocked = false;
                    _key = null;
                }
            } else if (data.type === 'locked' && _unlocked) {
                _suppressBroadcast = true;
                await lock();
                _suppressBroadcast = false;
            } else if (data.type === 'reset') {
                _key = null;
                _rawKey = null;
                _record = null;
                _unlocked = false;
                emit('reset');
            }
        };
    } catch {
        _channel = null;
    }
}

export async function setup(passphrase) {
    wipeAll();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    _key = await deriveKey(passphrase, salt);
    _rawKey = await crypto.subtle.exportKey('raw', _key);
    _record = null;
    const verifier = await encryptText(_key, VERIFIER_TEXT);
    writeMeta({ v: 2, salt: b64(salt), iv: verifier.iv, ct: verifier.ct });
    _unlocked = true;
    resetAttempts();
    broadcast({ type: 'unlocked', raw: _rawKey });
    emit('unlocked');
    return true;
}

export async function unlock(passphrase) {
    const meta = readMeta();
    if (!meta) return false;
    let key;
    try {
        key = await deriveKey(passphrase, unb64(meta.salt));
    } catch {
        return false;
    }
    const text = await decryptText(key, meta.iv, meta.ct);
    if (text !== VERIFIER_TEXT) return false;
    _key = key;
    try {
        _rawKey = await crypto.subtle.exportKey('raw', key);
    } catch {
        _rawKey = null;
    }
    _unlocked = true;
    resetAttempts();
    await loadRecordFromStorage();
    broadcast({ type: 'unlocked', raw: _rawKey });
    emit('unlocked');
    return true;
}

export async function lock() {
    if (!_unlocked) return;
    _unlocked = false;
    emit('locked');
    await flushWrites();
    _key = null;
    _rawKey = null;
    _record = null;
    broadcast({ type: 'locked' });
}

export async function changePassphrase(current, next) {
    const meta = readMeta();
    if (!meta || !_unlocked) return false;
    let oldKey;
    try {
        oldKey = await deriveKey(current, unb64(meta.salt));
    } catch {
        return false;
    }
    const check = await decryptText(oldKey, meta.iv, meta.ct);
    if (check !== VERIFIER_TEXT) return false;

    await flushWrites();

    const plaintextBlobs = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = String(localStorage.key(i));
        if (!key.startsWith(PLAINTEXT_PREFIX)) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
            const env = JSON.parse(raw);
            if (env && env.v === 2) {
                const text = await decryptText(oldKey, env.iv, env.ct);
                plaintextBlobs.push({ key, text });
            } else {
                plaintextBlobs.push({ key, text: null });
            }
        } catch {
            plaintextBlobs.push({ key, text: null });
        }
    }
    const recordText = _record ? JSON.stringify(_record) : null;

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const newKey = await deriveKey(next, salt);
    const verifier = await encryptText(newKey, VERIFIER_TEXT);

    _key = newKey;
    try {
        _rawKey = await crypto.subtle.exportKey('raw', newKey);
    } catch {
        _rawKey = null;
    }
    writeMeta({ v: 2, salt: b64(salt), iv: verifier.iv, ct: verifier.ct });

    if (recordText != null) {
        const env = await encryptText(newKey, recordText);
        localStorage.setItem(IDENTITY_KEY, JSON.stringify({ v: 2, iv: env.iv, ct: env.ct }));
    }
    for (const blob of plaintextBlobs) {
        if (blob.text == null) {
            localStorage.removeItem(blob.key);
            continue;
        }
        const env = await encryptText(newKey, blob.text);
        localStorage.setItem(blob.key, JSON.stringify({ v: 2, iv: env.iv, ct: env.ct }));
    }
    broadcast({ type: 'unlocked', raw: _rawKey });
    return true;
}

export function wipeAll() {
    const victims = [VAULT_KEY, IDENTITY_KEY];
    for (let i = 0; i < localStorage.length; i++) {
        const key = String(localStorage.key(i));
        if (key.startsWith(PLAINTEXT_PREFIX)) victims.push(key);
    }
    for (const key of victims) localStorage.removeItem(key);
    _record = null;
    _recordDirty = false;
}

export function wipeAndReset() {
    const wasUnlocked = _unlocked;
    _key = null;
    _rawKey = null;
    _record = null;
    _unlocked = false;
    wipeAll();
    resetAttempts();
    broadcast({ type: 'reset' });
    if (wasUnlocked) emit('locked');
    emit('reset');
}

export function getRecord() {
    return _unlocked ? _record : null;
}

export function setRecord(rec) {
    if (!_unlocked) return;
    _record = rec;
    scheduleRecordWrite();
}

function scheduleRecordWrite() {
    _recordDirty = true;
    _writeChain = _writeChain.then(async () => {
        while (_recordDirty && _key && _record) {
            _recordDirty = false;
            try {
                const env = await encryptText(_key, JSON.stringify(_record));
                localStorage.setItem(IDENTITY_KEY, JSON.stringify({ v: 2, iv: env.iv, ct: env.ct }));
            } catch (e) {
                console.warn('vault: record write failed', e);
            }
        }
    });
    return _writeChain;
}

export function flushWrites() {
    if (_record && _unlocked) return scheduleRecordWrite();
    return _writeChain;
}

export async function readWrappedJSON(storageKey) {
    if (!_unlocked || !_key) return null;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    try {
        const env = JSON.parse(raw);
        if (!env || env.v !== 2 || !env.iv || !env.ct) return null;
        const text = await decryptText(_key, env.iv, env.ct);
        return text == null ? null : JSON.parse(text);
    } catch {
        return null;
    }
}

export function writeWrappedJSON(storageKey, obj) {
    if (!_key) return;
    _writeChain = _writeChain.then(async () => {
        if (!_key) return;
        try {
            const env = await encryptText(_key, JSON.stringify(obj));
            localStorage.setItem(storageKey, JSON.stringify({ v: 2, iv: env.iv, ct: env.ct }));
        } catch (e) {
            console.warn('vault: wrapped write failed', e);
        }
    });
}

export function getSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        const minutes = Number(raw.autoLockMinutes);
        return {
            autoLockMinutes: AUTOLOCK_CHOICES.includes(minutes) ? minutes : 5,
        };
    } catch {
        return { autoLockMinutes: 5 };
    }
}

export function setAutoLockMinutes(minutes) {
    const value = AUTOLOCK_CHOICES.includes(Number(minutes)) ? Number(minutes) : 5;
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ autoLockMinutes: value }));
    } catch {}
    return value;
}

export function getAttempts() {
    try {
        return parseInt(sessionStorage.getItem(ATTEMPTS_KEY) || '0', 10) || 0;
    } catch {
        return 0;
    }
}

export function bumpAttempts() {
    const next = getAttempts() + 1;
    try {
        sessionStorage.setItem(ATTEMPTS_KEY, String(next));
    } catch {}
    return next;
}

export function resetAttempts() {
    try {
        sessionStorage.removeItem(ATTEMPTS_KEY);
    } catch {}
}
