import { STATE } from '../state.js';
import { request } from '../../core_chat/api.js';
import { createManagedSocket, wsUrl } from '../../core_chat/websocket.js';
import { captureVoiceStream, createVoiceProcessor } from './audio-processing.js';

export const CALL_PHASE = {
    IDLE: 'idle',
    OUTGOING: 'outgoing',
    INCOMING: 'incoming',
    CONNECTING: 'connecting',
    ACTIVE: 'active',
    RECONNECTING: 'reconnecting',
    ENDED: 'ended',
};

const PING_INTERVAL = 5000;
const PONG_TIMEOUT = 12000;
const RECONNECT_DELAY = 1500;
const OPEN_TIMEOUT = 8000;
const STATS_INTERVAL = 2000;
const STATS_REPORT_EVERY = 3;
const PC_DISCONNECT_GRACE = 5000;
const VOICE_PROCESSING = true;
const TERMINAL_WS_CODES = new Set([1000, 4001, 4002, 4404, 4409, 4413]);

function enhanceOpusSdp(sdp) {
    if (!sdp) return sdp;
    const lines = sdp.split('\r\n');
    const opusPts = [];
    for (const line of lines) {
        const m = line.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/i);
        if (m) opusPts.push(m[1]);
    }
    if (!opusPts.length) return sdp;
    return lines.map(line => {
        const m = line.match(/^a=fmtp:(\d+)\s+(.*)$/);
        if (!m || !opusPts.includes(m[1])) return line;
        const params = m[2]
            .split(';')
            .map(p => p.trim())
            .filter(p => p && !/^(useinbandfec|maxaveragebitrate|usedtx|stereo)=/i.test(p));
        params.push('stereo=0', 'useinbandfec=1', 'usedtx=1', 'maxaveragebitrate=64000');
        return `a=fmtp:${m[1]} ${params.join(';')}`;
    }).join('\r\n');
}

export class VoiceCallEngine {
    constructor() {
        this.handlers = {};
        this.reset();
    }

    reset() {
        this.chatId = null;
        this.callId = null;
        this.phase = CALL_PHASE.IDLE;
        this.isCaller = false;
        this.pc = null;
        this.localStream = null;
        this.rawStream = null;
        this.processor = null;
        this.ws = null;
        this.muted = false;
        this.peerPresent = false;
        this.peerStable = true;
        this.peerMuted = false;
        this.makingOffer = false;
        this.ignoreOffer = false;
        this.statsTimer = null;
        this.statsTick = 0;
        this.prevInbound = null;
        this.prevOutbound = null;
        this.prevStatsAt = 0;
        this.wakeLock = null;
        this.pcGraceTimer = null;
        this.startedAt = null;
        this.iceServers = null;
        this.tearingDown = false;
    }

    on(event, fn) {
        this.handlers[event] = fn;
    }

    emit(event, payload) {
        const fn = this.handlers[event];
        if (typeof fn === 'function') {
            try { fn(payload); } catch (err) { console.error('voice handler error', event, err); }
        }
    }

    isBusy() {
        return this.phase !== CALL_PHASE.IDLE && this.phase !== CALL_PHASE.ENDED;
    }

    setPhase(phase, meta = {}) {
        this.phase = phase;
        this.emit('phase', { phase, ...meta });
    }

    async loadIceConfig() {
        if (this.iceServers) return this.iceServers;
        const cfg = await request('GET', '/voice/config');
        this.iceServers = Array.isArray(cfg.ice_servers) && cfg.ice_servers.length
            ? cfg.ice_servers
            : [{ urls: ['stun:stun.l.google.com:19302'] }];
        return this.iceServers;
    }

    async acquireMic() {
        const stream = await captureVoiceStream();
        this.rawStream = stream;
        if (VOICE_PROCESSING) {
            try {
                this.processor = await createVoiceProcessor(stream);
                this.localStream = this.processor.outputStream;
            } catch (err) {
                console.warn('Voice processing unavailable, falling back to raw mic:', err);
                this.processor = null;
                this.localStream = stream;
            }
        } else {
            this.localStream = stream;
        }
        return this.localStream;
    }

    async startOutgoing(chatId) {
        if (this.isBusy()) throw new Error('already_in_call');
        await this.loadIceConfig();
        const res = await request('POST', `/voice/calls/${chatId}/start`);
        this.chatId = chatId;
        this.callId = res.call_id;
        this.isCaller = true;
        this.startedAt = null;
        this.setPhase(CALL_PHASE.OUTGOING);
        try {
            await this.acquireMic();
        } catch (err) {
            request('POST', `/voice/calls/${chatId}/end`).catch(() => {});
            this.teardown('mic_denied');
            throw err;
        }
        this.openSignaling();
        return res;
    }

    async acceptIncoming(chatId, callId) {
        if (this.isBusy()) return;
        await this.loadIceConfig();
        this.chatId = chatId;
        this.callId = callId;
        this.isCaller = false;
        this.setPhase(CALL_PHASE.CONNECTING);
        try {
            await this.acquireMic();
        } catch (err) {
            request('POST', `/voice/calls/${chatId}/decline`).catch(() => {});
            this.teardown('mic_denied');
            throw err;
        }
        this.openSignaling();
    }

    async resume(state) {
        if (this.isBusy()) return;
        await this.loadIceConfig();
        this.chatId = state.chat_id;
        this.callId = state.call_id;
        this.isCaller = state.caller_id === STATE.currentUserId;
        this.startedAt = state.started_at ? state.started_at * 1000 : null;
        this.setPhase(state.phase === 'active' ? CALL_PHASE.CONNECTING : CALL_PHASE.OUTGOING);
        try {
            await this.acquireMic();
        } catch (err) {
            this.teardown('mic_denied');
            throw err;
        }
        this.openSignaling();
    }

    declineIncoming(chatId) {
        request('POST', `/voice/calls/${chatId}/decline`).catch(() => {});
        this.teardown('declined');
    }

    hangup() {
        if (this.chatId) request('POST', `/voice/calls/${this.chatId}/end`).catch(() => {});
        this.teardown('hangup');
    }

    openSignaling() {
        if (this.ws) this.ws.close().catch(() => {});
        this.ws = createManagedSocket({
            url: wsUrl(`/voice/ws/${this.chatId}`),
            logPrefix: 'VoiceWS',
            pingInterval: PING_INTERVAL,
            pongTimeout: PONG_TIMEOUT,
            reconnectDelay: RECONNECT_DELAY,
            openTimeout: OPEN_TIMEOUT,
            shouldReconnect: (event) => {
                if (event && TERMINAL_WS_CODES.has(event.code)) {
                    if (event.code === 4002) this.teardown('superseded');
                    else if (event.code === 4001) this.teardown('kicked');
                    else if (event.code === 4404 || event.code === 4409) this.teardown('ended');
                    return false;
                }
                return this.isBusy();
            },
            onOpen: () => {
                this.ws.send({ type: 'join', call_id: this.callId });
            },
            onMessage: (data) => this.onSignalMessage(data),
            onClose: () => {
                if (this.isBusy() && this.phase !== CALL_PHASE.RECONNECTING) {
                    this.emit('signaling_lost', {});
                }
            },
        });
        this.ws.connect();
    }

    wsSend(payload) {
        if (this.ws && this.ws.isOpen()) return this.ws.send(payload);
        return false;
    }

    onSignalMessage(msg) {
        if (!msg || !msg.type) return;
        switch (msg.type) {
            case 'room_state': this.handleRoomState(msg.data); break;
            case 'peer_joined': this.handlePeerJoined(msg.data); break;
            case 'peer_unstable': this.handlePeerUnstable(msg.data); break;
            case 'call_started': this.handleCallStarted(msg.data); break;
            case 'call_ended': this.teardown((msg.data && msg.data.reason) || 'ended'); break;
            case 'signal': this.handleSignalPayload(msg.data); break;
            case 'renegotiate': this.handleRenegotiateRequest(); break;
            case 'peer_muted':
                this.peerMuted = !!(msg.data && msg.data.muted);
                this.emit('peerMuted', { muted: this.peerMuted });
                break;
            case 'rate_limited': break;
            case 'error':
                if (msg.detail) this.emit('error', { message: String(msg.detail) });
                break;
            default: break;
        }
    }

    handleRoomState(state) {
        if (!state) return;
        if (!this.callId) this.callId = state.call_id;
        if (state.call_id && this.callId && state.call_id !== this.callId) return;
        const me = STATE.currentUserId;
        const peer = (state.participants || []).find(p => p.user_id !== me);
        this.peerPresent = !!(peer && peer.connected);
        this.peerMuted = !!(peer && peer.muted);
        if (peer) this.emit('peer', { display: peer.display, present: this.peerPresent, muted: this.peerMuted });
        if (state.phase === 'active') {
            this.startedAt = state.started_at ? state.started_at * 1000 : (this.startedAt || Date.now());
            if (this.phase !== CALL_PHASE.ACTIVE) this.setPhase(CALL_PHASE.ACTIVE);
            this.ensurePeerConnection().then(() => {
                if (this.isCaller && this.peerPresent) this.kickNegotiation();
            }).catch(err => console.warn('PC setup failed:', err));
            this.startStatsLoop();
            this.requestWakeLock();
        } else if (state.phase === 'ringing' && this.isCaller && this.phase !== CALL_PHASE.OUTGOING) {
            this.setPhase(CALL_PHASE.OUTGOING);
        }
    }

    handlePeerJoined(data) {
        this.peerPresent = true;
        this.peerStable = true;
        this.emit('peerState', { stable: true });
        const rejoined = !!(data && data.rejoined);
        this.ensurePeerConnection().then(() => {
            if (this.isCaller) this.kickNegotiation(rejoined);
        }).catch(err => console.warn('PC setup failed:', err));
    }

    handlePeerUnstable() {
        this.peerStable = false;
        this.emit('peerState', { stable: false });
    }

    handleCallStarted(data) {
        this.startedAt = data && data.started_at ? data.started_at * 1000 : Date.now();
        if (this.phase !== CALL_PHASE.ACTIVE) this.setPhase(CALL_PHASE.ACTIVE);
        this.startStatsLoop();
        this.requestWakeLock();
    }

    async handleSignalPayload(payload) {
        if (!payload) return;
        const pc = await this.ensurePeerConnection();
        if (!pc) return;
        if (payload.sdp) {
            const desc = payload.sdp;
            const isOffer = desc.type === 'offer';
            const readyForOffer = !this.makingOffer && (pc.signalingState === 'stable' || this.ignoreOffer);
            const offerCollision = isOffer && !readyForOffer;
            this.ignoreOffer = !this.politeFlag() && offerCollision;
            if (this.ignoreOffer) return;
            try {
                if (offerCollision) await pc.setLocalDescription({ type: 'rollback' });
                await pc.setRemoteDescription(desc);
                if (isOffer) {
                    await pc.setLocalDescription();
                    this.wsSend({
                        type: 'signal',
                        data: { sdp: { type: pc.localDescription.type, sdp: enhanceOpusSdp(pc.localDescription.sdp) } },
                    });
                }
            } catch (err) {
                console.warn('SDP handling failed:', err);
                this.emit('error', { message: 'signaling_error' });
            }
        } else if (payload.candidate) {
            try {
                await pc.addIceCandidate(payload.candidate);
            } catch (err) {
                if (!this.ignoreOffer) console.warn('addIceCandidate failed:', err);
            }
        }
    }

    handleRenegotiateRequest() {
        if (!this.isCaller) return;
        this.ensurePeerConnection().then(() => this.kickNegotiation(true)).catch(() => {});
    }

    politeFlag() {
        return !this.isCaller;
    }

    async ensurePeerConnection() {
        if (this.pc && !['closed', 'failed'].includes(this.pc.connectionState)) return this.pc;
        if (this.pc) {
            try { this.pc.close(); } catch { }
            this.pc = null;
        }
        const pc = new RTCPeerConnection({
            iceServers: this.iceServers || [],
            iceCandidatePoolSize: 2,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
        });
        this.pc = pc;
        if (this.localStream) {
            for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
        }
        pc.onicecandidate = (e) => {
            if (e.candidate) this.wsSend({ type: 'signal', data: { candidate: e.candidate } });
        };
        pc.ontrack = (e) => {
            const stream = e.streams && e.streams[0];
            if (stream) this.emit('remoteStream', stream);
        };
        pc.onnegotiationneeded = async () => {
            if (this.politeFlag() || !this.peerPresent) return;
            try {
                this.makingOffer = true;
                await pc.setLocalDescription();
                this.wsSend({
                    type: 'signal',
                    data: { sdp: { type: pc.localDescription.type, sdp: enhanceOpusSdp(pc.localDescription.sdp) } },
                });
            } catch (err) {
                console.warn('negotiation failed:', err);
            } finally {
                this.makingOffer = false;
            }
        };
        pc.onconnectionstatechange = () => this.onPcStateChange(pc);
        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'failed') this.attemptRecovery(pc);
        };
        return pc;
    }

    kickNegotiation(forceRestart = false) {
        const pc = this.pc;
        if (!pc || this.politeFlag()) return;
        if (forceRestart || ['disconnected', 'failed'].includes(pc.connectionState)) {
            try { pc.restartIce(); } catch { }
            return;
        }
        if (pc.connectionState === 'new' && pc.signalingState === 'stable' && !this.makingOffer) {
            pc.dispatchEvent(new Event('negotiationneeded'));
        }
    }

    rebuildAndRequestOffer() {
        this.ensurePeerConnection().then(() => {
            this.wsSend({ type: 'renegotiate' });
        }).catch(() => {});
    }

    onPcStateChange(pc) {
        const st = pc.connectionState;
        if (st === 'connected') {
            this.clearPcGrace();
            if (this.phase !== CALL_PHASE.ACTIVE) this.setPhase(CALL_PHASE.ACTIVE);
            this.emit('connected', {});
        } else if (st === 'disconnected') {
            this.schedulePcGrace(pc);
        } else if (st === 'failed') {
            this.attemptRecovery(pc);
        }
    }

    schedulePcGrace(pc) {
        this.clearPcGrace();
        this.pcGraceTimer = setTimeout(() => {
            this.pcGraceTimer = null;
            if (pc === this.pc && pc.connectionState === 'disconnected') this.attemptRecovery(pc);
        }, PC_DISCONNECT_GRACE);
    }

    clearPcGrace() {
        if (this.pcGraceTimer) {
            clearTimeout(this.pcGraceTimer);
            this.pcGraceTimer = null;
        }
    }

    attemptRecovery(pc) {
        if (pc !== this.pc) return;
        if (this.isCaller) {
            try { pc.restartIce(); } catch { this.rebuildAndRequestOffer(); }
        } else {
            this.rebuildAndRequestOffer();
        }
    }

    startStatsLoop() {
        if (this.statsTimer) return;
        this.prevInbound = null;
        this.prevOutbound = null;
        this.statsTick = 0;
        this.statsTimer = setInterval(() => { this.collectStats().catch(() => {}); }, STATS_INTERVAL);
    }

    stopStatsLoop() {
        if (this.statsTimer) {
            clearInterval(this.statsTimer);
            this.statsTimer = null;
        }
    }

    async collectStats() {
        const pc = this.pc;
        if (!pc || this.phase === CALL_PHASE.IDLE) return;
        const report = await pc.getStats();
        let pair = null;
        let inbound = null;
        let outbound = null;
        report.forEach(r => {
            if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) pair = r;
            else if (r.type === 'inbound-rtp' && r.kind === 'audio' && !r.isRemote) inbound = r;
            else if (r.type === 'outbound-rtp' && r.kind === 'audio' && !r.isRemote) outbound = r;
        });
        if (!pair) {
            report.forEach(r => {
                if (!pair && r.type === 'candidate-pair' && r.state === 'succeeded') pair = r;
            });
        }
        const now = Date.now();
        let rtt = null;
        let relay = false;
        if (pair) {
            if (typeof pair.currentRoundTripTime === 'number') rtt = Math.round(pair.currentRoundTripTime * 1000);
            const local = pair.localCandidateId ? report.get(pair.localCandidateId) : null;
            const remote = pair.remoteCandidateId ? report.get(pair.remoteCandidateId) : null;
            relay = (local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay');
        }
        let loss = 0;
        let jitter = null;
        if (inbound) {
            jitter = typeof inbound.jitter === 'number' ? Math.round(inbound.jitter * 1000) : null;
            if (this.prevInbound) {
                const dLost = (inbound.packetsLost || 0) - (this.prevInbound.packetsLost || 0);
                const dRecv = (inbound.packetsReceived || 0) - (this.prevInbound.packetsReceived || 0);
                const total = dLost + dRecv;
                if (total > 0) loss = Math.max(0, Math.min(100, (dLost / total) * 100));
            }
            this.prevInbound = { packetsLost: inbound.packetsLost || 0, packetsReceived: inbound.packetsReceived || 0 };
        }
        let bitrate = null;
        if (outbound) {
            if (this.prevOutbound && now > this.prevStatsAt) {
                const dBytes = (outbound.bytesSent || 0) - this.prevOutbound.bytesSent;
                if (dBytes >= 0) bitrate = Math.round((dBytes * 8) / ((now - this.prevStatsAt) / 1000) / 1000);
            }
            this.prevOutbound = { bytesSent: outbound.bytesSent || 0 };
        }
        this.prevStatsAt = now;

        let quality = 4;
        if ((rtt != null && rtt > 250) || loss > 2) quality -= 1;
        if ((rtt != null && rtt > 400) || loss > 5 || (jitter != null && jitter > 80)) quality -= 1;
        if ((rtt != null && rtt > 700) || loss > 10) quality -= 1;
        quality = Math.max(0, Math.min(4, quality));

        const stats = { rtt, loss: Math.round(loss * 10) / 10, jitter, bitrate, relay, quality, pcState: pc.connectionState };
        this.lastStats = stats;
        this.emit('stats', stats);

        this.statsTick += 1;
        if (this.statsTick % STATS_REPORT_EVERY === 0) {
            this.wsSend({
                type: 'stats',
                data: {
                    rtt_ms: rtt,
                    loss_percent: stats.loss,
                    jitter_ms: jitter,
                    bitrate_kbps: bitrate,
                    relay,
                },
            });
        }
    }

    setMuted(muted) {
        this.muted = muted;
        if (this.localStream) {
            for (const track of this.localStream.getAudioTracks()) track.enabled = !muted;
        }
        this.wsSend({ type: 'mute', muted });
        this.emit('muted', { muted });
    }

    toggleMute() {
        this.setMuted(!this.muted);
        return this.muted;
    }

    async requestWakeLock() {
        if (window.desktopAPI && window.desktopAPI.keepAwakeStart) {
            try { await window.desktopAPI.keepAwakeStart(); } catch { }
            return;
        }
        if (!('wakeLock' in navigator)) return;
        try {
            if (!this.wakeLock) this.wakeLock = await navigator.wakeLock.request('screen');
        } catch { }
    }

    async releaseWakeLock() {
        if (window.desktopAPI && window.desktopAPI.keepAwakeStop) {
            try { await window.desktopAPI.keepAwakeStop(); } catch { }
        }
        const lock = this.wakeLock;
        this.wakeLock = null;
        if (lock) {
            try { await lock.release(); } catch { }
        }
    }

    handleVisibilityRestored() {
        if (this.isBusy() && this.phase !== CALL_PHASE.ENDED) this.requestWakeLock();
    }

    handleNetworkOnline() {
        if (!this.isBusy()) return;
        if (this.ws && !this.ws.isOpen()) this.openSignaling();
        if (this.pc && ['disconnected', 'failed'].includes(this.pc.connectionState)) this.attemptRecovery(this.pc);
    }

    handleExternalEnd(data) {
        if (!data) return;
        if (this.chatId && data.chat_id && data.chat_id !== this.chatId) return;
        if (this.isBusy()) this.teardown(data.reason || 'ended');
    }

    teardown(reason) {
        if (this.tearingDown) return;
        this.tearingDown = true;
        this.stopStatsLoop();
        this.clearPcGrace();
        this.releaseWakeLock();
        if (this.ws) {
            const ws = this.ws;
            this.ws = null;
            ws.close().catch(() => {});
        }
        if (this.pc) {
            try {
                this.pc.onconnectionstatechange = null;
                this.pc.oniceconnectionstatechange = null;
                this.pc.onnegotiationneeded = null;
                this.pc.ontrack = null;
                this.pc.onicecandidate = null;
                this.pc.close();
            } catch { }
            this.pc = null;
        }
        if (this.processor) {
            try { this.processor.close(); } catch { }
            this.processor = null;
        }
        const streams = [this.localStream, this.rawStream];
        this.localStream = null;
        this.rawStream = null;
        for (const stream of streams) {
            if (!stream) continue;
            for (const track of stream.getTracks()) {
                try { track.stop(); } catch { }
            }
        }
        const hadCall = this.phase !== CALL_PHASE.IDLE;
        const callId = this.callId;
        const chatId = this.chatId;
        this.reset();
        this.tearingDown = false;
        if (hadCall) this.emit('ended', { reason, callId, chatId });
    }
}

export const voiceEngine = new VoiceCallEngine();
