import { STATE } from './state.js';
import * as API from './api.js';
import { unb64 } from './crypto.js';
import { toast } from './toast.js';
import { t } from './utils.js';

const BLOB_CACHE_LIMIT = 40;

export async function encryptBytes(bytes) {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']
    );
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, cryptoKey, bytes
    );
    return { ciphertext, keyBytes, iv };
}

export async function decryptBytes(ciphertext, keyBytes, iv) {
    const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']
    );
    return await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, cryptoKey, ciphertext
    );
}

function blobCacheGet(key) {
    const url = STATE.fileBlobs.get(key);
    if (url) {
        STATE.fileBlobs.delete(key);
        STATE.fileBlobs.set(key, url);
    }
    return url;
}

function blobCachePut(key, url) {
    STATE.fileBlobs.delete(key);
    STATE.fileBlobs.set(key, url);
    while (STATE.fileBlobs.size > BLOB_CACHE_LIMIT) {
        const oldest = STATE.fileBlobs.entries().next().value;
        if (!oldest) break;
        STATE.fileBlobs.delete(oldest[0]);
        let inUse = false;
        try {
            inUse = !!document.querySelector(`img[src="${CSS.escape(oldest[1])}"]`);
        } catch {}
        if (!inUse) URL.revokeObjectURL(oldest[1]);
    }
}

export async function loadAttachmentImage(attId, keyB64, ivB64, mime, imgEl) {
    const cacheKey = String(attId);
    try {
        const cached = blobCacheGet(cacheKey);
        if (cached) {
            imgEl.classList.remove('is-lazy');
            imgEl.src = cached;
            return;
        }
        const bytes = await API.fetchAttachment(attId);
        const decrypted = await decryptBytes(bytes, unb64(keyB64), unb64(ivB64));
        const blob = new Blob([decrypted], { type: mime });
        const url = URL.createObjectURL(blob);
        blobCachePut(cacheKey, url);
        imgEl.classList.remove('is-lazy');
        imgEl.src = url;
    } catch (e) {
        console.error('Failed to load attachment', e);
        imgEl.classList.remove('is-lazy');
        imgEl.alt = t('e2e_failed_load_attachment', 'Failed to load attachment');
    }
}

export async function downloadAttachment(attId, keyB64, ivB64, mime, name) {
    try {
        const cached = blobCacheGet(String(attId));
        let url = cached;
        let revoke = false;
        if (!url) {
            const bytes = await API.fetchAttachment(attId);
            const decrypted = await decryptBytes(bytes, unb64(keyB64), unb64(ivB64));
            const blob = new Blob([decrypted], { type: mime });
            url = URL.createObjectURL(blob);
            revoke = true;
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (revoke) setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
        toast(t('e2e_download_failed', 'Download failed: ') + e.message, true);
    }
}
