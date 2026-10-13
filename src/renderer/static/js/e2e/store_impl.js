import { b64, unb64 } from './crypto.js';

export class RecordStore {
    constructor(record, persist = null) {
        this.record = record;
        this._persistFn = persist;
        this._persistSuspended = false;
        this.consumedPreKeyIds = [];
        this.onPreKeyConsumed = null;
    }

    _persist() {
        if (this._persistSuspended || !this._persistFn) return;
        this._persistFn(this.record);
    }

    _addressKey(identifier) {
        const value = String(identifier);
        return value.includes('.') ? value : value + '.1';
    }

    adoptRecord(record) {
        this.record = record;
        this._persist();
    }

    async getIdentityKeyPair() {
        return {
            pubKey: unb64(this.record.identityKeyPub),
            privKey: unb64(this.record.identityKeyPriv),
        };
    }

    async getLocalRegistrationId() {
        return this.record.registrationId;
    }

    async isTrustedIdentity(identifier, identityKey) {
        const address = this._addressKey(identifier);
        const stored = (this.record.identities || {})[address];
        if (!stored) return true;
        const incoming = b64(identityKey);
        if (stored === incoming) return true;
        this.record.identityWarning = {
            address,
            stored,
            incoming,
            at: Date.now(),
        };
        this._persist();
        return false;
    }

    async saveIdentity(address, identityKey) {
        this.record.identities = this.record.identities || {};
        const previous = this.record.identities[address];
        const current = b64(identityKey);
        this.record.identities[address] = current;
        this._persist();
        return !!previous && previous !== current;
    }

    async loadPreKey(keyId) {
        const entry = (this.record.prekeys || []).find(p => p.keyId === keyId);
        if (!entry) return undefined;
        return { pubKey: unb64(entry.pubKey), privKey: unb64(entry.privKey) };
    }

    async storePreKey(keyId, keyPair) {
        this.record.prekeys = this.record.prekeys || [];
        const idx = this.record.prekeys.findIndex(p => p.keyId === keyId);
        const entry = {
            keyId,
            pubKey: b64(keyPair.pubKey),
            privKey: b64(keyPair.privKey),
        };
        if (idx >= 0) this.record.prekeys[idx] = entry;
        else this.record.prekeys.push(entry);
        this._persist();
    }

    async removePreKey(keyId) {
        this.record.prekeys = (this.record.prekeys || []).filter(
            p => p.keyId !== keyId
        );
        this._persist();
        if (this.onPreKeyConsumed) this.onPreKeyConsumed(keyId);
        else this.consumedPreKeyIds.push(keyId);
    }


    async loadSignedPreKey(keyId) {
        if (this.record.signedPreKeyId !== keyId) return undefined;
        return {
            pubKey: unb64(this.record.signedPreKeyPub),
            privKey: unb64(this.record.signedPreKeyPriv),
        };
    }

    async storeSignedPreKey(keyId, keyPair) {
        this.record.signedPreKeyId = keyId;
        this.record.signedPreKeyPub = b64(keyPair.pubKey);
        this.record.signedPreKeyPriv = b64(keyPair.privKey);
        this._persist();
    }



    async loadSession(address) {
        this.record.sessions = this.record.sessions || {};
        return this.record.sessions[address];
    }

    async storeSession(address, sessionRecord) {
        this.record.sessions = this.record.sessions || {};
        this.record.sessions[address] = sessionRecord;
        this._persist();
    }





    async deleteAllSessions(name) {
        if (!this.record.sessions) return;
        const prefix = name + '.';
        for (const key of Object.keys(this.record.sessions)) {
            if (key.startsWith(prefix)) delete this.record.sessions[key];
        }
        this._persist();
    }
}
