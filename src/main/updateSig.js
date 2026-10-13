const crypto = require('crypto');

const UPDATE_SIGNING_PUBLIC_KEY = 'MCowBQYDK2VwAyEAt5Ea+lvXgRSYmXuz5x2Tgh2IU4al7RQ9EdUm2U9CWUI=';

function canonicalUpdateString(fields) {
    return [
        String(fields.version),
        String(fields.sha512),
        String(fields.size),
        String(fields.path),
    ].join('|');
}

function verifyUpdateSignature(signatureBase64, fields, publicKeyBase64 = UPDATE_SIGNING_PUBLIC_KEY) {
    try {
        const publicKey = crypto.createPublicKey({
            key: Buffer.from(publicKeyBase64, 'base64'),
            format: 'der',
            type: 'spki',
        });
        return crypto.verify(
            null,
            Buffer.from(canonicalUpdateString(fields), 'utf8'),
            publicKey,
            Buffer.from(String(signatureBase64 || '').trim(), 'base64'),
        );
    } catch {
        return false;
    }
}

function signUpdateString(privateKeyBase64, fields) {
    const privateKey = crypto.createPrivateKey({
        key: Buffer.from(privateKeyBase64, 'base64'),
        format: 'der',
        type: 'pkcs8',
    });
    return crypto.sign(
        null,
        Buffer.from(canonicalUpdateString(fields), 'utf8'),
        privateKey,
    ).toString('base64');
}

module.exports = {
    UPDATE_SIGNING_PUBLIC_KEY,
    canonicalUpdateString,
    verifyUpdateSignature,
    signUpdateString,
};
