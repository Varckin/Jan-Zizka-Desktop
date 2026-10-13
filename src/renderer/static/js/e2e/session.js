import { STATE } from './state.js';
import * as API from './api.js';
import {
    SessionBuilder,
    SessionCipher,
    unb64,
    toArrayBuffer,
} from './crypto.js';
import { queueConsumedPreKey } from './keyStore.js';
import {
    addressFor,
    isMine,
    recallPlaintext,
    rememberPlaintext,
    t,
} from './utils.js';

let _lockChain = Promise.resolve();
let _worker = null;
let _workerBroken = false;
let _reqSeq = 0;
const _reqPending = new Map();

export function withCryptoLock(task) {
    const result = _lockChain.then(task, task);
    _lockChain = result.then(() => undefined, () => undefined);
    return result;
}

function initWorker() {
    if (_workerBroken) return null;
    if (_worker) return _worker;
    try {
        _worker = new Worker(new URL('./crypto.worker.js', import.meta.url), { type: 'module' });
        _worker.onmessage = (e) => {
            const data = e.data || {};
            const pending = _reqPending.get(data.id);
            if (!pending) return;
            _reqPending.delete(data.id);
            pending.resolve(data);
        };
        _worker.onerror = () => {
            _workerBroken = true;
            try { _worker.terminate(); } catch {}
            _worker = null;
            for (const [, pending] of _reqPending) {
                pending.reject(new Error('crypto worker failed'));
            }
            _reqPending.clear();
        };
    } catch {
        _workerBroken = true;
        return null;
    }
    return _worker;
}

export async function ensureSession(chat) {
    if (!STATE.store) throw new Error(t('e2e_vault_locked_short', 'Locked'));
    return withCryptoLock(async () => {
        const address = addressFor(chat);
        const existing = await STATE.store.loadSession(address.toString());
        if (existing) return address;

        const bundle = await API.getUserBundle(chat.other_username);
        const preKeyBundle = {
            registrationId: bundle.registration_id,
            identityKey: unb64(bundle.identity_key),
            signedPreKey: {
                keyId: bundle.signed_prekey_id,
                publicKey: unb64(bundle.signed_prekey),
                signature: unb64(bundle.signed_prekey_signature),
            },
        };
        if (bundle.prekey) {
            preKeyBundle.preKey = {
                keyId: bundle.prekey.key_id,
                publicKey: unb64(bundle.prekey.public_key),
            };
        }
        const builder = new SessionBuilder(STATE.store, address);
        await builder.processPreKey(preKeyBundle);
        return address;
    });
}

export function parseDecrypted(raw, text) {
    let payload = null;
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && parsed.type) {
            payload = parsed;
        }
    } catch {}
    return { ...raw, text, error: null, errorKind: null, deleted: false, payload };
}

function decryptFailure(chat, raw, identity) {
    if (identity == null) {
        const warning = STATE.store && STATE.store.record
            ? STATE.store.record.identityWarning
            : null;
        identity = !!(warning && warning.address === addressFor(chat).toString());
    }
    return {
        ...raw,
        text: null,
        error: identity
            ? t('e2e_identity_changed', 'Identity key changed — verification required')
            : t('e2e_cannot_decrypt', 'Cannot decrypt'),
        errorKind: identity ? 'identity' : 'crypto',
        deleted: false,
        payload: null,
    };
}

async function decryptLocal(chat, raw) {
    const address = addressFor(chat);
    const cipher = new SessionCipher(STATE.store, address);
    const body = unb64(raw.ciphertext);

    const originalPrekey = raw.message_type === 'prekey';
    const attempts = [originalPrekey, !originalPrekey];
    let lastErr = null;
    let identityFailure = null;

    for (const asPrekey of attempts) {
        try {
            const plaintext = asPrekey
                ? await cipher.decryptPreKeyWhisperMessage(body, 'binary')
                : await cipher.decryptWhisperMessage(body, 'binary');
            const buf = await toArrayBuffer(plaintext);
            const text = new TextDecoder().decode(buf);
            rememberPlaintext(chat.id, raw.id, text);
            return parseDecrypted(raw, text);
        } catch (err) {
            lastErr = err;
            if (/identity key changed|unknown identity key/i.test(String((err && err.message) || ''))) {
                identityFailure = true;
            }
        }
    }

    console.error('E2E decrypt failed:', lastErr);
    return decryptFailure(chat, raw, identityFailure);
}

export async function decryptEnvelope(chat, raw) {
    if (raw.deleted_at) {
        return { ...raw, text: null, error: null, errorKind: null, deleted: true, payload: null };
    }

    const cached = recallPlaintext(chat.id, raw.id);
    if (cached != null) return parseDecrypted(raw, cached);

    if (isMine(raw)) {
        return {
            ...raw,
            text: null,
            error: t('e2e_cannot_decrypt', 'Cannot decrypt'),
            errorKind: null,
            deleted: false,
            payload: null,
        };
    }

    if (!STATE.store) {
        return {
            ...raw,
            text: null,
            error: t('e2e_vault_locked_short', 'Locked'),
            errorKind: 'locked',
            deleted: false,
            payload: null,
        };
    }

    return withCryptoLock(() => decryptLocal(chat, raw));
}

export function decryptBatch(chat, raws) {
    const todo = raws.filter(raw => !!raw);
    if (!todo.length) return Promise.resolve([]);
    if (!STATE.store) {
        return Promise.resolve(todo.map(raw => ({
            ...raw,
            text: null,
            error: t('e2e_vault_locked_short', 'Locked'),
            errorKind: 'locked',
            deleted: false,
            payload: null,
        })));
    }

    return withCryptoLock(async () => {
        const worker = initWorker();
        if (worker) {
            try {
                const id = ++_reqSeq;
                const done = new Promise((resolve, reject) => {
                    _reqPending.set(id, { resolve, reject });
                });
                worker.postMessage({
                    op: 'decrypt-batch',
                    id,
                    record: STATE.store.record,
                    username: chat.other_username,
                    messages: todo.map(raw => ({
                        id: raw.id,
                        ciphertext: raw.ciphertext,
                        message_type: raw.message_type,
                    })),
                });
                const response = await done;
                STATE.store.adoptRecord(response.record);
                for (const keyId of response.consumed || []) {
                    queueConsumedPreKey(keyId);
                }
                const byId = new Map();
                for (const res of response.results || []) byId.set(res.id, res);
                return todo.map(raw => {
                    const res = byId.get(raw.id);
                    if (res && res.ok) {
                        rememberPlaintext(chat.id, raw.id, res.text);
                        return parseDecrypted(raw, res.text);
                    }
                    return decryptFailure(chat, raw, res ? !!res.identity : null);
                });
            } catch (e) {
                console.warn('Worker decrypt failed, falling back to main thread:', e);
            }
        }
        const out = [];
        for (const raw of todo) {
            out.push(await decryptLocal(chat, raw));
        }
        return out;
    });
}
