const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const settings = require('./settings');
const { IS_PACKAGED } = require('./paths');
const { UPDATE_OWNER, UPDATE_REPO } = require('./config');
const { verifyUpdateSignature } = require('./updateSig');

const BASE_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 45 * 1000;
const JITTER = 0.25;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const SIG_ASSET_NAME = 'update.sig';

const state = {
    supported: false,
    status: 'unsupported',
    version: null,
    progress: 0,
    error: null,
    lastCheckedAt: null,
};

let emitter = null;
let timer = null;
let backoff = 1;
let busy = false;
let lastEtag = null;
let lastRelease = null;
let signatureNotified = false;

function publish() {
    if (emitter) emitter(Object.assign({}, state));
}

function setStatus(status, extra) {
    state.status = status;
    if (extra && typeof extra === 'object') Object.assign(state, extra);
    publish();
}

function nextDelay() {
    const factor = 1 + (Math.random() * 2 - 1) * JITTER;
    return Math.min(MAX_BACKOFF_MS, BASE_INTERVAL_MS * factor * backoff);
}

function schedule(delayMs) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        poll();
    }, delayMs);
}

function enabled() {
    const value = settings.get('autoUpdate.enabled');
    return value !== false;
}

async function fetchLatestRelease() {
    const url = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;
    const headers = {
        'accept': 'application/vnd.github+json',
        'user-agent': `JanDesktop/${app.getVersion()}`,
    };
    if (lastEtag) headers['if-none-match'] = lastEtag;
    const res = await fetch(url, { headers });
    if (res.status === 304) return { notModified: true };
    if (res.status === 404) return { missing: true };
    if (!res.ok) {
        const err = new Error(`release api ${res.status}`);
        err.backoff = res.status === 403 || res.status === 429;
        throw err;
    }
    const etag = res.headers.get('etag');
    if (etag) lastEtag = etag;
    const data = await res.json();
    lastRelease = data;
    return { release: data };
}

function releaseHasNewerVersion(release) {
    if (!release || !release.tag_name) return false;
    const remote = String(release.tag_name).replace(/^v/i, '');
    const current = app.getVersion();
    if (remote === current) return false;
    const parse = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
    const a = parse(remote);
    const b = parse(current);
    for (let i = 0; i < 3; i++) {
        if ((a[i] || 0) > (b[i] || 0)) return true;
        if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
}

async function poll() {
    if (!state.supported || busy) return;
    if (!enabled()) {
        schedule(BASE_INTERVAL_MS);
        return;
    }
    try {
        const result = await fetchLatestRelease();
        state.lastCheckedAt = Date.now();
        if (result.notModified || result.missing || !releaseHasNewerVersion(result.release)) {
            backoff = 1;
            if (state.status === 'idle' || state.status === 'error') setStatus('up-to-date');
            publish();
            if (enabled()) schedule(nextDelay());
            return;
        }
        await runCheck();
    } catch (err) {
        state.lastCheckedAt = Date.now();
        if (err && err.backoff) backoff = Math.min(4, backoff * 2);
        setStatus('error', { error: String(err && err.message || err) });
        if (enabled()) schedule(nextDelay());
    }
}

async function runCheck() {
    if (busy) return;
    busy = true;
    setStatus('checking');
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        backoff = Math.min(4, backoff * 2);
        setStatus('error', { error: String(err && err.message || err) });
    } finally {
        busy = false;
        state.lastCheckedAt = Date.now();
        if (enabled()) schedule(nextDelay());
        publish();
    }
}

function sigAssetUrl(release) {
    const assets = release && Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find(a => a.name === SIG_ASSET_NAME);
    return asset ? asset.browser_download_url : null;
}

async function fetchReleaseByTag(tag) {
    const url = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/tags/${encodeURIComponent(tag)}`;
    const res = await fetch(url, { headers: { 'accept': 'application/vnd.github+json', 'user-agent': `JanDesktop/${app.getVersion()}` } });
    if (!res.ok) {
        const err = new Error(`release api ${res.status}`);
        err.backoff = res.status === 403 || res.status === 429;
        throw err;
    }
    return res.json();
}

async function resolveUpdateRelease(info) {
    const tag = info && info.tag != null ? String(info.tag) : null;
    if (tag) {
        if (lastRelease && lastRelease.tag_name === tag) return lastRelease;
        return fetchReleaseByTag(tag);
    }
    if (lastRelease) return lastRelease;
    return (await fetchLatestRelease()).release;
}

async function verifyPendingUpdate(info) {
    const release = await resolveUpdateRelease(info);
    if (!release) throw new Error('update release info not available');
    const expectedVersion = info && info.version != null ? String(info.version) : null;
    if (expectedVersion && release.tag_name && String(release.tag_name).replace(/^v/i, '') !== expectedVersion) {
        throw new Error(`release tag ${release.tag_name} does not match update version ${expectedVersion}`);
    }
    const url = sigAssetUrl(release);
    if (!url) throw new Error('update signature asset not found');
    const res = await fetch(url, { headers: { 'user-agent': `JanDesktop/${app.getVersion()}`, 'accept': 'application/octet-stream' } });
    if (!res.ok) throw new Error(`signature fetch failed: ${res.status}`);
    const sig = (await res.text()).trim();
    const file = info && Array.isArray(info.files) && info.files[0] ? info.files[0] : null;
    const fields = {
        version: String(info.version),
        sha512: String(file ? file.sha512 : ''),
        size: String(file ? file.size : 0),
        path: String(info.path || (file ? file.url : '')),
    };
    if (!verifyUpdateSignature(sig, fields)) throw new Error('update signature verification failed');
}

function initUpdater(onState) {
    emitter = onState || null;
    state.supported = IS_PACKAGED;
    if (!state.supported) {
        setStatus('unsupported');
        return state;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.requestHeaders = { 'user-agent': `JanDesktop/${app.getVersion()}` };

    autoUpdater.on('update-not-available', () => {
        backoff = 1;
        setStatus('up-to-date');
    });
    autoUpdater.on('update-available', info => {
        backoff = 1;
        setStatus('available', { version: info.version });
        verifyPendingUpdate(info)
            .then(() => {
                setStatus('downloading', { version: info.version, progress: 0 });
                return autoUpdater.downloadUpdate();
            })
            .catch(err => {
                setStatus('error', { error: String(err && err.message || err) });
            });
    });
    autoUpdater.on('download-progress', progress => {
        setStatus('downloading', { progress: progress && progress.percent ? Math.round(progress.percent) : state.progress });
    });
    autoUpdater.on('update-downloaded', info => {
        setStatus('downloaded', { version: info.version });
    });
    autoUpdater.on('error', err => {
        if (state.status === 'checking' || state.status === 'downloading' || state.status === 'available') {
            backoff = Math.min(4, backoff * 2);
            setStatus('error', { error: String(err && err.message || err) });
        }
    });

    setStatus('idle');
    if (enabled()) schedule(FIRST_CHECK_DELAY_MS);
    return state;
}

function check(manual) {
    if (!state.supported) {
        publish();
        return Promise.resolve(getState());
    }
    return (manual ? runCheck() : poll()).then(() => getState());
}

function quitAndInstall() {
    if (!state.supported || state.status !== 'downloaded') return false;
    const windowManager = require('./window');
    windowManager.setQuitting(true);
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
}

function getState() {
    return Object.assign({}, state);
}

module.exports = { initUpdater, check, quitAndInstall, getState };
