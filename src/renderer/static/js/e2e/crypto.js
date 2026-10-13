import * as libsignal from '../libsignal/index.js';

export const KeyHelper = libsignal.KeyHelper;
export const SignalProtocolAddress = libsignal.SignalProtocolAddress;
export const SessionBuilder = libsignal.SessionBuilder;
export const SessionCipher = libsignal.SessionCipher;
export const FingerprintGenerator = libsignal.FingerprintGenerator;

export const MESSAGE_TYPE_PREKEY = 3;

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function binaryStringToBuffer(s) {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
        bytes[i] = s.charCodeAt(i) & 0xff;
    }
    return bytes.buffer;
}

function base64ToBuffer(s) {
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export function b64(input) {
    if (input == null) return '';
    if (typeof input === 'string') return input;

    let bytes;
    if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
        bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else if (Array.isArray(input)) {
        bytes = new Uint8Array(input);
    } else {
        console.warn('b64: unsupported input', typeof input, input);
        return '';
    }

    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

export function unb64(s) {
    if (s == null) return new ArrayBuffer(0);
    if (s instanceof ArrayBuffer) return s;
    if (ArrayBuffer.isView(s)) {
        return s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength);
    }
    if (typeof s !== 'string') return new ArrayBuffer(0);

    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) > 127) return binaryStringToBuffer(s);
    }

    if (s.length % 4 === 0 && BASE64_RE.test(s)) {
        try {
            return base64ToBuffer(s);
        } catch {
            return binaryStringToBuffer(s);
        }
    }
    return binaryStringToBuffer(s);
}

export async function toArrayBuffer(input) {
    if (input == null) return new ArrayBuffer(0);
    const value = await input;
    return unb64(value);
}

export function messageTypeLabel(type) {
    return type === MESSAGE_TYPE_PREKEY ? 'prekey' : 'whisper';
}
