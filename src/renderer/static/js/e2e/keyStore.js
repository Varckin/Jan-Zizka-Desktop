import { KeyHelper, FingerprintGenerator, b64, unb64, SignalProtocolAddress } from './crypto.js';
import { RecordStore } from './store_impl.js';
import * as vault from './vault.js';
import * as API from './api.js';

const PREKEY_BATCH = 100;
const PREKEY_LOW = 20;
const PREKEY_TOPUP = 50;
const PREKEY_ID_BASE = 100000;
const PREKEY_ID_RANGE = 900000;
const SAFETY_ITERATIONS = 5200;
const CONSUMED_QUEUE_LIMIT = 500;

export class NewDeviceWarning extends Error {
    constructor() {
        super('New device detected');
        this.code = 'new_device_warning';
    }
}

let _consumedQueue = [];
let _consumedTimer = null;

export function queueConsumedPreKey(keyId) {
    if (_consumedQueue.length >= CONSUMED_QUEUE_LIMIT) return;
    _consumedQueue.push(keyId);
    if (_consumedTimer == null) {
        _consumedTimer = setTimeout(flushConsumedPreKeys, 2000);
    }
}

export async function flushConsumedPreKeys() {
    if (_consumedTimer != null) {
        clearTimeout(_consumedTimer);
        _consumedTimer = null;
    }
    if (!_consumedQueue.length) return;
    const ids = _consumedQueue.splice(0, _consumedQueue.length);
    try {
        await API.consumePreKeys(ids);
    } catch {
        _consumedQueue = ids.concat(_consumedQueue).slice(0, CONSUMED_QUEUE_LIMIT);
        if (_consumedTimer == null) {
            _consumedTimer = setTimeout(flushConsumedPreKeys, 5000);
        }
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
        if (!_consumedQueue.length) return;
        const ids = _consumedQueue.splice(0, _consumedQueue.length);
        try {
            fetch('/e2e/api/devices/me/prekeys/consumed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key_ids: ids }),
                keepalive: true,
            }).catch(() => {});
        } catch {}
    });
}

class LocalStorageStore extends RecordStore {
    constructor(record) {
        super(record, rec => saveRecord(rec));
        this.onPreKeyConsumed = queueConsumedPreKey;
    }
}

function loadRecord() {
    return vault.getRecord();
}

function saveRecord(record) {
    vault.setRecord(record);
}

export function clearSessionsFor(usernames) {
    const record = loadRecord();
    if (!record || !record.sessions) return;
    for (const name of usernames) {
        const address = new SignalProtocolAddress(name, 1).toString();
        delete record.sessions[address];
    }
    saveRecord(record);
}

export function getIdentityWarning(store) {
    return (store && store.record && store.record.identityWarning) || null;
}

export function acceptIdentityWarning(store) {
    const warning = getIdentityWarning(store);
    if (!warning || !store) return null;
    store.record.identities = store.record.identities || {};
    store.record.identities[warning.address] = warning.incoming;
    delete store.record.identityWarning;
    if (store.record.sessions) delete store.record.sessions[warning.address];
    store._persist();
    return warning;
}

export function dismissIdentityWarning(store) {
    if (!store || !store.record) return;
    delete store.record.identityWarning;
    store._persist();
}

export function getStoredIdentity(store, username) {
    const record = store && store.record;
    if (!record || !record.identities) return null;
    return record.identities[`${username}.1`] || null;
}

export async function safetyNumber(store, localUsername, remoteUsername, remoteIdentityB64) {
    const ownPub = store && store.record ? store.record.identityKeyPub : null;
    const remotePub = remoteIdentityB64 || getStoredIdentity(store, remoteUsername);
    if (!ownPub || !remotePub || !localUsername || !remoteUsername) return null;
    try {
        const generator = new FingerprintGenerator(SAFETY_ITERATIONS);
        return await generator.createFor(localUsername, unb64(ownPub), remoteUsername, unb64(remotePub));
    } catch {
        return null;
    }
}

export function formatSafetyNumber(digits) {
    return digits ? String(digits).replace(/(.{5})/g, '$1 ').trim() : '';
}

function makeBaseKeyId() {
    return PREKEY_ID_BASE + Math.floor(Math.random() * PREKEY_ID_RANGE);
}

async function generateFreshRecord() {
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);

    const baseId = makeBaseKeyId();
    const prekeys = await Promise.all(
        Array.from({ length: PREKEY_BATCH }, (_, i) => KeyHelper.generatePreKey(baseId + i))
    );

    return {
        identityKeyPub: b64(identityKeyPair.pubKey),
        identityKeyPriv: b64(identityKeyPair.privKey),
        registrationId,
        signedPreKeyId: signedPreKey.keyId,
        signedPreKeyPub: b64(signedPreKey.keyPair.pubKey),
        signedPreKeyPriv: b64(signedPreKey.keyPair.privKey),
        signedPreKeySig: b64(signedPreKey.signature),
        prekeys: prekeys.map(pk => ({
            keyId: pk.keyId,
            pubKey: b64(pk.keyPair.pubKey),
            privKey: b64(pk.keyPair.privKey),
        })),
        lastPreKeyId: baseId + PREKEY_BATCH - 1,
        identities: {},
        sessions: {},
    };
}

async function registerRecord(record) {
    await API.registerDevice({
        identity_key: record.identityKeyPub,
        registration_id: record.registrationId,
        signed_prekey: record.signedPreKeyPub,
        signed_prekey_signature: record.signedPreKeySig,
        signed_prekey_id: record.signedPreKeyId,
        prekeys: record.prekeys.map(pk => ({
            key_id: pk.keyId,
            public_key: pk.pubKey,
        })),
    });
}

async function serverHasChats() {
    try {
        const chats = await API.listChats();
        return Array.isArray(chats) && chats.length > 0;
    } catch {
        return false;
    }
}

async function ensurePreKeyTopUp(store, record) {
    try {
        const { count } = await API.getPreKeyCount();
        if (count >= PREKEY_LOW) return;

        const nextId = (record.lastPreKeyId || makeBaseKeyId()) + 1;
        const fresh = await Promise.all(
            Array.from({ length: PREKEY_TOPUP }, (_, i) => KeyHelper.generatePreKey(nextId + i))
        );
        store._persistSuspended = true;
        try {
            for (const preKey of fresh) {
                await store.storePreKey(preKey.keyId, preKey.keyPair);
            }
        } finally {
            store._persistSuspended = false;
        }
        record.lastPreKeyId = nextId + PREKEY_TOPUP - 1;
        store._persist();

        await API.uploadPreKeys(
            fresh.map(pk => ({
                key_id: pk.keyId,
                public_key: b64(pk.keyPair.pubKey),
            }))
        );
    } catch (e) {
        console.warn('Prekey top-up failed:', e);
    }
}

export async function ensureRegistered({ confirmNewDevice = false } = {}) {
    let record = loadRecord();
    let serverDevice = null;
    try {
        serverDevice = await API.getMyDevice();
    } catch {}

    const localMatchesServer =
        record &&
        serverDevice &&
        serverDevice.registered &&
        serverDevice.identity_key === record.identityKeyPub;

    if (localMatchesServer) {
        const store = new LocalStorageStore(record);
        await ensurePreKeyTopUp(store, record);
        return store;
    }

    const serverRegistered = !!(serverDevice && serverDevice.registered);

    if (!confirmNewDevice && serverRegistered) {
        if (await serverHasChats()) throw new NewDeviceWarning();
    }

    record = await generateFreshRecord();
    saveRecord(record);
    await registerRecord(record);
    return new LocalStorageStore(record);
}
