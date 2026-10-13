import { RecordStore } from './store_impl.js';
import { SessionCipher, SignalProtocolAddress, toArrayBuffer, unb64 } from './crypto.js';

self.onmessage = async (event) => {
    const data = event.data || {};
    if (data.op !== 'decrypt-batch') return;

    const store = new RecordStore(data.record);
    const address = new SignalProtocolAddress(data.username, 1);
    const cipher = new SessionCipher(store, address);
    const results = [];

    for (const m of data.messages) {
        try {
            const body = unb64(m.ciphertext);
            const asPrekey = m.message_type === 'prekey';
            let plaintext;
            try {
                plaintext = asPrekey
                    ? await cipher.decryptPreKeyWhisperMessage(body, 'binary')
                    : await cipher.decryptWhisperMessage(body, 'binary');
            } catch {
                plaintext = asPrekey
                    ? await cipher.decryptWhisperMessage(body, 'binary')
                    : await cipher.decryptPreKeyWhisperMessage(body, 'binary');
            }
            const buf = await toArrayBuffer(plaintext);
            results.push({ id: m.id, ok: true, text: new TextDecoder().decode(buf) });
        } catch (err) {
            const message = String((err && err.message) || '');
            const identity =
                /identity key changed|unknown identity key/i.test(message) ||
                !!(store.record.identityWarning &&
                   store.record.identityWarning.address === address.toString());
            results.push({ id: m.id, ok: false, identity });
        }
    }

    self.postMessage({
        op: 'decrypt-batch',
        id: data.id,
        results,
        record: store.record,
        consumed: store.consumedPreKeyIds,
    });
};
