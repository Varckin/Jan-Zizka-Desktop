import { STATE } from '../state.js';
import { request } from '../../core_chat/api.js';
import { captureVoiceStream, createVoiceProcessor } from '../voice_call/audio-processing.js';

const LIVEKIT_CLIENT_VERSION = '2.22.3';
const LIVEKIT_SOURCES = [
    `/static/js/livekit/livekit-client.js`,
    `https://cdn.jsdelivr.net/npm/livekit-client@${LIVEKIT_CLIENT_VERSION}/dist/livekit-client.umd.js`,
    `https://unpkg.com/livekit-client@${LIVEKIT_CLIENT_VERSION}/dist/livekit-client.umd.js`,
];

const LIVEKIT_LOG_LEVEL = 'warn';

function livekitLogLevel() {
    try {
        if (window.localStorage && window.localStorage.getItem('gv_livekit_debug') === '1') return 'debug';
    } catch { }
    return LIVEKIT_LOG_LEVEL;
}

function applyLogLevel(LK) {
    try {
        if (LK && typeof LK.setLogLevel === 'function') LK.setLogLevel(livekitLogLevel());
    } catch { }
}

export const GV_PHASE = {
    IDLE: 'idle',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ENDED: 'ended',
};

let lkPromise = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

function ensureLiveKit() {
    if (window.LivekitClient) {
        applyLogLevel(window.LivekitClient);
        return Promise.resolve(window.LivekitClient);
    }
    if (lkPromise) return lkPromise;
    lkPromise = (async () => {
        for (const src of LIVEKIT_SOURCES) {
            try {
                await loadScript(src);
                if (window.LivekitClient) {
                    applyLogLevel(window.LivekitClient);
                    return window.LivekitClient;
                }
            } catch {  }
        }
        lkPromise = null;
        throw new Error('livekit_client_unavailable');
    })();
    return lkPromise;
}

function parseMetadata(raw) {
    if (!raw) return {};
    try {
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

export class GroupVoiceEngine {
    constructor() {
        this.handlers = {};
        this.tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        this.channel = null;
        this.reset();
    }

    reset() {
        this.chatId = null;
        this.room = null;
        this.phase = GV_PHASE.IDLE;
        this.muted = false;
        this.processor = null;
        this.rawStream = null;
        this.localPublication = null;
        this.audioPool = null;
        this.audioEls = new Map();
        this.blockedEls = new Set();
        this.speakers = new Set();
        this.quality = new Map();
        this.connectedAt = null;
        this.wakeLock = null;
        this.leaving = false;
        this._muteIntent = false;
        this.muteLocked = false;
        this._lk = null;
        this._sessionSids = [];
    }

    on(event, fn) {
        this.handlers[event] = fn;
    }

    emit(event, payload) {
        const fn = this.handlers[event];
        if (typeof fn === 'function') {
            try { fn(payload); } catch (err) { console.error('group voice handler error', event, err); }
        }
    }

    setPhase(phase, meta = {}) {
        this.phase = phase;
        this.emit('phase', { phase, ...meta });
    }

    isInCall() {
        return this.phase === GV_PHASE.CONNECTING || this.phase === GV_PHASE.CONNECTED || this.phase === GV_PHASE.RECONNECTING;
    }

    myIdentity() {
        return `u${STATE.currentUserId}`;
    }

    ensureChannel() {
        if (this.channel || typeof BroadcastChannel === 'undefined') return this.channel;
        try {
            this.channel = new BroadcastChannel('group-voice-session');
            this.channel.onmessage = (ev) => {
                const msg = (ev && ev.data) || null;
                if (!msg || msg.tab === this.tabId) return;
                if (msg.type === 'claim' && msg.chatId === this.chatId && this.isInCall()) {
                    this.teardown('superseded_tab');
                }
            };
        } catch {
            this.channel = null;
        }
        return this.channel;
    }

    claimTab() {
        const channel = this.ensureChannel();
        if (!channel) return;
        try {
            channel.postMessage({ type: 'claim', tab: this.tabId, chatId: this.chatId });
        } catch { }
    }

    noteSession() {
        const lp = this.room && this.room.localParticipant;
        if (!lp || !lp.sid || !this.isInCall()) return;
        const now = Date.now();
        const last = this._sessionSids[this._sessionSids.length - 1];
        if (last && last.sid === lp.sid) return;
        this._sessionSids.push({ sid: lp.sid, at: now });
        this._sessionSids = this._sessionSids.filter(item => now - item.at <= 20000);
        if (this._sessionSids.length >= 3) {
            this.teardown('reconnect_storm');
        }
    }

    ensureAudioPool() {
        if (this.audioPool && this.audioPool.isConnected) return this.audioPool;
        let pool = document.getElementById('gv-audio-pool');
        if (!pool) {
            pool = document.createElement('div');
            pool.id = 'gv-audio-pool';
            pool.style.display = 'none';
            document.body.appendChild(pool);
        }
        this.audioPool = pool;
        return pool;
    }

    async acquireMic() {
        let stream;
        try {
            stream = await captureVoiceStream();
        } catch (err) {
            const name = err && err.name ? err.name : '';
            throw new Error(name === 'NotAllowedError' || name === 'SecurityError' ? 'mic_denied' : 'mic_failed');
        }
        this.rawStream = stream;
        try {
            this.processor = await createVoiceProcessor(stream);
            return this.processor.outputStream.getAudioTracks()[0];
        } catch (err) {
            console.warn('Voice processor unavailable, publishing the raw track:', err);
            this.processor = null;
            return stream.getAudioTracks()[0];
        }
    }

    publishTrackRef() {
        const lp = this.room && this.room.localParticipant;
        if (!lp) return null;
        const source = this._lk && this._lk.Track ? this._lk.Track.Source.Microphone : 'microphone';
        const getter = typeof lp.getTrackPublication === 'function' ? 'getTrackPublication' : 'getTrack';
        if (typeof lp[getter] !== 'function') return null;
        return lp[getter](source) || null;
    }

    async join(chatId) {
        if (this.isInCall()) throw new Error('already_in_call');
        this.leaving = false;
        this.chatId = chatId;
        this.setPhase(GV_PHASE.CONNECTING);
        let payload;
        try {
            payload = await request('POST', `/voice/group/${chatId}/token`);
        } catch (err) {
            this.reset();
            throw err;
        }
        let LK;
        try {
            LK = await ensureLiveKit();
        } catch (err) {
            this.reset();
            throw err;
        }
        this._lk = LK;

        const track = await this.acquireMic().catch(err => {
            this.teardown(err && err.message === 'mic_denied' ? 'mic_denied' : 'mic_failed');
            throw err;
        });
        this.muteLocked = !!(payload && payload.mute_locked);
        if (this.muteLocked) {
            try { track.enabled = false; } catch { }
        }
        const room = new LK.Room({
            adaptiveStream: false,
            dynacast: false,
            publishDefaults: { audioBitrate: 48000, dtx: true },
        });
        this.room = room;
        this.bindRoomEvents(room, LK);
        try {
            await room.connect(payload.url, payload.token);
        } catch (err) {
            console.warn('LiveKit connect failed:', err);
            this.teardown('connect_failed');
            const e = new Error('connect_failed');
            e.detail = err && err.message ? String(err.message) : '';
            throw e;
        }
        let publication = null;
        try {
            const source = LK.Track ? LK.Track.Source.Microphone : 'microphone';
            publication = await room.localParticipant.publishTrack(track, { source, dtx: true });
        } catch (err) {
            console.warn('Publish failed:', err);
            this.teardown('publish_failed');
            throw new Error('publish_failed');
        }
        this.localPublication = publication || this.publishTrackRef();
        if (this.muteLocked) {
            this._muteIntent = true;
            this.setMuted(true);
        }
        this.connectedAt = Date.now();
        this.setPhase(GV_PHASE.CONNECTED);
        this.requestWakeLock();
        this.claimTab();
        this.noteSession();
        this.emit('participants', {});
        return payload;
    }

    bindRoomEvents(room, LK) {
        const EV = LK.RoomEvent || {};
        const on = (name, fallback, fn) => room.on(EV[name] || fallback, fn);
        const localIdentity = () => (room.localParticipant ? room.localParticipant.identity : this.myIdentity());

        on('ParticipantConnected', 'participantConnected', (p) => {
            this.emit('participants', { identity: p.identity });
        });
        on('ParticipantDisconnected', 'participantDisconnected', (p) => {
            this.speakers.delete(p.identity);
            this.quality.delete(p.identity);
            this.releaseParticipantAudio(p.identity);
            this.emit('participants', { identity: p.identity });
        });
        on('ParticipantMetadataChanged', 'participantMetadataChanged', (p) => {
            this.emit('participants', { identity: p ? p.identity : null });
        });
        on('TrackSubscribed', 'trackSubscribed', (track, publication, participant) => {
            if (track.kind !== 'audio') return;
            this.attachRemoteAudio(track, participant);
        });
        on('TrackUnsubscribed', 'trackUnsubscribed', (track, publication, participant) => {
            try { track.detach().forEach(el => el.remove()); } catch { }
            if (participant) this.releaseParticipantAudio(participant.identity);
        });
        on('TrackMuted', 'trackMuted', (publication, participant) => {
            this.handleTrackMute(participant, true, localIdentity());
        });
        on('TrackUnmuted', 'trackUnmuted', (publication, participant) => {
            this.handleTrackMute(participant, false, localIdentity());
        });
        on('ActiveSpeakersChanged', 'activeSpeakersChanged', (speakers) => {
            this.speakers = new Set((speakers || []).map(p => p.identity));
            this.emit('speakers', { identities: [...this.speakers] });
        });
        on('ConnectionStateChanged', 'connectionStateChanged', (state) => {
            if (state === 'connected' && this.phase !== GV_PHASE.CONNECTED) {
                this.connectedAt = this.connectedAt || Date.now();
                this.setPhase(GV_PHASE.CONNECTED);
            } else if (state === 'reconnecting' || state === 'signal_reconnecting') {
                this.setPhase(GV_PHASE.RECONNECTING);
            }
            this.emit('connection', { state });
        });
        on('Reconnecting', 'reconnecting', () => this.setPhase(GV_PHASE.RECONNECTING));
        on('Reconnected', 'reconnected', () => {
            this.setPhase(GV_PHASE.CONNECTED);
            this.noteSession();
            this.restoreMuteState();
            this.emit('connection', { state: 'connected' });
        });
        on('LocalTrackPublished', 'localTrackPublished', (publication) => {
            if (!publication || !publication.track || publication.track.kind !== 'audio') return;
            this.localPublication = publication;
            this.restoreMuteState();
        });
        on('LocalTrackUnpublished', 'localTrackUnpublished', (publication) => {
            if (publication && this.localPublication === publication) this.localPublication = null;
        });
        on('SignalConnected', 'signalConnected', () => this.noteSession());
        on('Connected', 'connected', () => this.noteSession());
        on('ConnectionQualityChanged', 'connectionQualityChanged', (quality, participant) => {
            const identity = participant && participant.identity ? participant.identity : localIdentity();
            this.quality.set(identity, quality);
            this.emit('quality', { identity, quality });
        });
        on('MediaDevicesError', 'mediaDevicesError', (err) => {
            this.emit('error', { message: err && err.message ? err.message : 'media_devices_error' });
        });
        on('Disconnected', 'disconnected', (reason) => {
            if (this.leaving) return;
            this.teardown(this.mapDisconnectReason(reason, LK));
        });
    }

    mapDisconnectReason(reason, LK) {
        const names = (LK && LK.DisconnectReason) || null;
        const name = names && reason !== undefined && reason !== null ? names[reason] : null;
        switch (name) {
            case 'CLIENT_INITIATED': return 'hangup';
            case 'PARTICIPANT_REMOVED': return 'kicked';
            case 'ROOM_DELETED':
            case 'ROOM_CLOSED': return 'room_deleted';
            case 'SERVER_SHUTDOWN': return 'server_shutdown';
            case 'JOIN_FAILURE': return 'join_failed';
            case 'MIGRATION': return 'migration';
            case 'DUPLICATE_IDENTITY': return 'superseded';
            case 'STATE_MISMATCH': return 'server_error';
            case 'SIGNAL_CLOSE':
            case 'CONNECTION_TIMEOUT': return 'disconnected';
            default: return 'disconnected';
        }
    }

    handleTrackMute(participant, muted, localIdentity) {
        if (!participant) return;
        const isLocal = participant.identity === localIdentity;
        let forced = false;
        if (isLocal) {
            forced = muted ? this._muteIntent === false : this._muteIntent === true;
            this._muteIntent = muted;
            this.muted = muted;
        }
        this.emit('trackMute', { identity: participant.identity, muted, isLocal, forced });
    }

    attachRemoteAudio(track, participant) {
        if (!participant) return;
        this.releaseParticipantAudio(participant.identity);
        let el;
        try {
            el = track.attach();
        } catch {
            return;
        }
        el.dataset.gvIdentity = participant.identity;
        el.autoplay = true;
        el.playsInline = true;
        this.ensureAudioPool().appendChild(el);
        this.audioEls.set(participant.identity, el);
        const p = el.play();
        if (p && typeof p.catch === 'function') {
            p.catch(() => {
                this.blockedEls.add(el);
                this.emit('autoplayBlocked', {});
            });
        }
    }

    releaseParticipantAudio(identity) {
        const el = this.audioEls.get(identity);
        if (!el) return;
        this.audioEls.delete(identity);
        this.blockedEls.delete(el);
        try { el.srcObject = null; } catch { }
        el.remove();
    }

    retryPlayback() {
        for (const el of [...this.blockedEls]) {
            const p = el.play();
            if (p && typeof p.then === 'function') {
                p.then(() => this.blockedEls.delete(el)).catch(() => {});
            } else {
                this.blockedEls.delete(el);
            }
        }
        for (const el of this.audioEls.values()) {
            if (el.paused) {
                const p = el.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
        }
        if (!this.blockedEls.size) this.emit('autoplayRestored', {});
    }

    setMuted(muted) {
        if (!this.room || !this.room.localParticipant) return this.muted;
        if (this.muteLocked && !muted) return this.muted;
        const publication = this.publishTrackRef() || this.localPublication;
        this.localPublication = publication;
        if (!publication || !publication.track) return this.muted;
        this._muteIntent = !!muted;
        const op = muted ? publication.track.mute() : publication.track.unmute();
        if (op && typeof op.catch === 'function') op.catch(() => {});
        this.muted = !!muted;
        this.emit('muted', { muted: this.muted });
        return this.muted;
    }

    restoreMuteState() {
        const publication = this.publishTrackRef() || this.localPublication;
        this.localPublication = publication;
        if (!publication) return;
        const want = !!this._muteIntent;
        if (publication.isMuted === want) {
            this.muted = want;
            return;
        }
        if (!publication.track) return;
        const op = want ? publication.track.mute() : publication.track.unmute();
        if (op && typeof op.catch === 'function') op.catch(() => { });
        this.muted = want;
        this.emit('muted', { muted: this.muted });
    }

    toggleMute() {
        return this.setMuted(!this.muted);
    }

    participantsView() {
        if (!this.room) return [];
        const result = [];
        const localIdentity = this.room.localParticipant ? this.room.localParticipant.identity : this.myIdentity();
        const push = (participant, isLocal) => {
            if (!participant) return;
            const meta = parseMetadata(participant.metadata);
            result.push({
                identity: participant.identity,
                user_id: meta.user_id || null,
                username: meta.username || participant.name || '',
                first_name: meta.first_name || '',
                last_name: meta.last_name || '',
                avatar: meta.avatar || null,
                role: meta.role || 'member',
                muted: isLocal ? this.muted : this.isRemoteMuted(participant),
                isLocal,
                isSpeaking: this.speakers.has(participant.identity),
            });
        };
        push(this.room.localParticipant, true);
        const remotes = this.room.remoteParticipants instanceof Map
            ? this.room.remoteParticipants.values()
            : Object.values(this.room.remoteParticipants || {});
        for (const p of remotes) {
            if (p && p.identity !== localIdentity) push(p, false);
        }
        return result;
    }

    isRemoteMuted(participant) {
        const source = this._lk && this._lk.Track ? this._lk.Track.Source.Microphone : 'microphone';
        let publication = typeof participant.getTrackPublication === 'function'
            ? participant.getTrackPublication(source)
            : null;
        if (!publication) {
            const pubs = participant.trackPublications instanceof Map
                ? [...participant.trackPublications.values()]
                : Object.values(participant.trackPublications || {});
            const audio = pubs.filter(x => x && (x.source === source || x.kind === 'audio'));
            publication = audio[audio.length - 1] || null;
        }
        if (publication && typeof publication.isMuted === 'boolean') return publication.isMuted;
        return null;
    }

    serverInfo() {
        const info = this.room && this.room.serverInfo;
        if (!info) return null;
        return {
            edition: info.edition != null ? String(info.edition) : '',
            version: info.version || '',
            region: info.region || '',
        };
    }

    myQuality() {
        return this.quality.get(this.myIdentity()) || 'unknown';
    }

    async requestWakeLock() {
        if (!('wakeLock' in navigator)) return;
        try {
            if (!this.wakeLock) this.wakeLock = await navigator.wakeLock.request('screen');
        } catch { }
    }

    async releaseWakeLock() {
        const lock = this.wakeLock;
        this.wakeLock = null;
        if (lock) {
            try { await lock.release(); } catch { }
        }
    }

    handleVisibilityRestored() {
        if (this.isInCall()) {
            this.requestWakeLock();
            this.retryPlayback();
        }
    }

    async leave() {
        if (!this.isInCall()) return;
        this.teardown('hangup');
    }

    handleExternalEnd(reason) {
        if (!this.isInCall()) return;
        this.teardown(reason || 'ended');
    }

    teardown(reason) {
        if (reason === 'migration') return;
        this.leaving = true;
        this.releaseWakeLock();
        if (this.room) {
            const room = this.room;
            this.room = null;
            try { room.removeAllListeners(); } catch { }
            try { room.disconnect(); } catch { }
        }
        for (const el of this.audioEls.values()) {
            try { el.srcObject = null; } catch { }
            el.remove();
        }
        this.audioEls.clear();
        this.blockedEls.clear();
        if (this.processor) {
            try { this.processor.close(); } catch { }
            this.processor = null;
        }
        if (this.rawStream) {
            for (const track of this.rawStream.getTracks()) {
                try { track.stop(); } catch { }
            }
            this.rawStream = null;
        }
        const hadCall = this.phase !== GV_PHASE.IDLE && this.phase !== GV_PHASE.ENDED;
        const chatId = this.chatId;
        this.localPublication = null;
        this.connectedAt = null;
        this.speakers = new Set();
        this.quality = new Map();
        this._sessionSids = [];
        this.muted = false;
        this._muteIntent = false;
        this.muteLocked = false;
        this.phase = GV_PHASE.IDLE;
        this.chatId = null;
        this.leaving = false;
        if (hadCall) this.emit('ended', { reason, chatId });
    }
}

export const groupVoice = new GroupVoiceEngine();
