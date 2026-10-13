export async function parseJson(res) {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        return { ok: res.ok, data: null };
    }
    try {
        return { ok: res.ok, data: await res.json() };
    } catch {
        return { ok: false, data: null };
    }
}

export function extractErrorCode(data) {
    if (!data) return null;
    if (typeof data.code === 'string' && data.code) return data.code;
    const detail = data.detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail) && typeof detail.code === 'string' && detail.code) {
        return detail.code;
    }
    return null;
}

export function buildErrorMessage(data, fallback = 'Request failed') {
    if (!data || data.detail === undefined) return fallback;
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail)) {
        const parts = data.detail.map(item => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && item.msg) return item.msg;
            return JSON.stringify(item);
        });
        return parts.join('; ') || fallback;
    }
    if (data.detail && typeof data.detail === 'object' && typeof data.detail.message === 'string') {
        return data.detail.message;
    }
    if (typeof data.detail === 'object') return JSON.stringify(data.detail);
    return String(data.detail);
}

function buildError(data, fallback) {
    const err = new Error(buildErrorMessage(data, fallback));
    err.code = extractErrorCode(data);
    return err;
}

export async function request(method, url, options = {}) {
    const { fallbackError = 'Request failed', ...rest } = options;
    const opts = { method, ...rest };
    if (opts.body && !(opts.body instanceof FormData)) {
        opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const { data } = await parseJson(res);
    if (!res.ok) throw buildError(data, fallbackError);
    return data;
}

export async function sendFormData(url, formData, options = {}) {
    const { method = 'POST', fallbackError = 'Upload failed' } = options;
    const res = await fetch(url, { method, body: formData });
    const { data } = await parseJson(res);
    if (!res.ok) throw buildError(data, fallbackError);
    return data;
}

export async function uploadFile(url, file, fieldName = 'file', fallbackError) {
    const formData = new FormData();
    formData.append(fieldName, file);
    return sendFormData(url, formData, { fallbackError });
}
