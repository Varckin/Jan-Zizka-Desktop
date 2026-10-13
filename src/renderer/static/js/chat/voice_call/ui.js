import { STATE } from '../state.js';
import { fullNameOf } from '../format.js';
import { showToast } from '../../core_chat/toast.js';
import { createNotificationAudio, playSound } from '../../core_chat/sound.js';
import { request } from '../../core_chat/api.js';
import { voiceEngine, CALL_PHASE } from './engine.js';

const t = (key, fallback) => (window.i18n && window.i18n[key]) || fallback;

const ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const ICON_HANGUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
const ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
const ICON_MIC_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

let overlay = null;
let els = {};
let ringtone = null;
let ringTimer = null;
let durationTimer = null;
let overlayCloseTimer = null;
let pendingIncoming = null;
let pendingResume = null;
let currentPeer = null;

function fmtDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function peerFromState(state, meId) {
    const peer = (state.participants || []).find(p => p.user_id !== meId);
    return peer ? peer.display : null;
}

function peerFromChatData(chatId) {
    const chat = STATE.chatsMap[chatId];
    if (!chat) return { username: '', first_name: '', last_name: '', avatar: null };
    return {
        username: chat.other_user_username || '',
        first_name: chat.other_user_first_name || '',
        last_name: chat.other_user_last_name || '',
        avatar: chat.type === 'direct' ? chat.avatar : null,
    };
}

function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'vc-overlay is-hidden';
    overlay.id = 'vc-overlay';
    overlay.innerHTML = `
        <div class="vc-modal" role="dialog" aria-modal="true" aria-label="${t('call_button', 'Voice call')}">
            <div class="vc-peer">
                <div class="vc-avatar" id="vc-avatar"><span id="vc-avatar-initials"></span></div>
                <div class="vc-name" id="vc-name"></div>
                <div class="vc-status" id="vc-status"></div>
                <div class="vc-timer is-hidden" id="vc-timer">0:00</div>
            </div>
            <div class="vc-quality is-hidden" id="vc-quality" data-tone="good">
                <i></i><i></i><i></i><i></i>
            </div>
            <div class="vc-muted-note is-hidden" id="vc-muted-note"></div>
            <div class="vc-tech is-hidden" id="vc-tech">
                <div class="vc-tech-row"><span>${t('call_rtt', 'Latency')}</span><b id="vc-rtt">—</b></div>
                <div class="vc-tech-row"><span>${t('call_loss', 'Loss')}</span><b id="vc-loss">—</b></div>
                <div class="vc-tech-row"><span>${t('call_jitter', 'Jitter')}</span><b id="vc-jitter">—</b></div>
                <div class="vc-tech-row"><span>${t('call_bitrate', 'Bitrate')}</span><b id="vc-bitrate">—</b></div>
                <div class="vc-tech-row"><span>${t('call_link', 'Link')}</span><b id="vc-link">—</b></div>
                <div class="vc-tech-row"><span>${t('call_codec', 'Codec')}</span><b>Opus 48 kHz</b></div>
            </div>
            <audio id="vc-audio" autoplay playsinline></audio>
            <button type="button" class="vc-hint is-hidden" id="vc-hint">${t('call_tap_sound', 'Tap to enable sound')}</button>
            <div class="vc-controls" id="vc-controls"></div>
        </div>`;
    document.body.appendChild(overlay);
    els = {
        avatar: overlay.querySelector('#vc-avatar'),
        initials: overlay.querySelector('#vc-avatar-initials'),
        name: overlay.querySelector('#vc-name'),
        status: overlay.querySelector('#vc-status'),
        timer: overlay.querySelector('#vc-timer'),
        quality: overlay.querySelector('#vc-quality'),
        mutedNote: overlay.querySelector('#vc-muted-note'),
        tech: overlay.querySelector('#vc-tech'),
        rtt: overlay.querySelector('#vc-rtt'),
        loss: overlay.querySelector('#vc-loss'),
        jitter: overlay.querySelector('#vc-jitter'),
        bitrate: overlay.querySelector('#vc-bitrate'),
        link: overlay.querySelector('#vc-link'),
        audio: overlay.querySelector('#vc-audio'),
        hint: overlay.querySelector('#vc-hint'),
        controls: overlay.querySelector('#vc-controls'),
    };
    els.hint.addEventListener('click', () => {
        els.audio.play().then(() => els.hint.classList.add('is-hidden')).catch(() => {});
    });
}

function controlButton(kind, icon, label, onClick) {
    const wrap = document.createElement('div');
    wrap.className = 'vc-ctl';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `vc-btn vc-btn-${kind}`;
    btn.innerHTML = icon;
    btn.addEventListener('click', onClick);
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(btn);
    wrap.appendChild(span);
    return { wrap, btn, label: span };
}

function setControls(mode) {
    els.controls.innerHTML = '';
    if (mode === 'incoming') {
        els.controls.appendChild(controlButton('decline', ICON_HANGUP, t('call_decline', 'Decline'), () => onDecline()).wrap);
        els.controls.appendChild(controlButton('answer', ICON_PHONE, t('call_answer', 'Answer'), () => onAnswer()).wrap);
        return;
    }
    if (mode === 'rejoin') {
        els.controls.appendChild(controlButton('hangup', ICON_HANGUP, t('call_hangup', 'End call'), () => onHangup()).wrap);
        els.controls.appendChild(controlButton('answer', ICON_PHONE, t('call_join', 'Join'), () => onJoin()).wrap);
        return;
    }
    const mute = controlButton('mute', ICON_MIC, t('call_mute', 'Mute'), () => onToggleMute());
    const info = controlButton('info', ICON_INFO, t('call_info', 'Connection info'), () => onToggleTech());
    const hangup = controlButton('hangup', ICON_HANGUP, t('call_hangup', 'End call'), () => onHangup());
    els.controls.appendChild(mute.wrap);
    els.controls.appendChild(info.wrap);
    els.controls.appendChild(hangup.wrap);
    els.muteBtn = mute.btn;
    els.muteLabel = mute.label;
}

function setPeer(display) {
    currentPeer = display || currentPeer;
    if (!currentPeer) return;
    const name = fullNameOf({
        first_name: currentPeer.first_name,
        last_name: currentPeer.last_name,
        username: currentPeer.username,
    }) || currentPeer.username || '';
    els.name.textContent = name;
    els.avatar.querySelectorAll('img').forEach(img => img.remove());
    if (currentPeer.avatar) {
        const img = document.createElement('img');
        img.src = currentPeer.avatar;
        img.alt = '';
        img.addEventListener('error', () => img.remove());
        els.avatar.prepend(img);
        els.initials.textContent = '';
    } else {
        els.initials.textContent = (name[0] || '?').toUpperCase();
    }
}

function setStatus(text) {
    els.status.textContent = text;
}

function startRingtone() {
    stopRingtone();
    if (!ringtone) ringtone = createNotificationAudio();
    playSound(ringtone);
    ringTimer = setInterval(() => playSound(ringtone), 2500);
}

function stopRingtone() {
    if (ringTimer) {
        clearInterval(ringTimer);
        ringTimer = null;
    }
    if (ringtone) {
        try { ringtone.pause(); } catch { }
    }
}

function startDurationTimer() {
    stopDurationTimer();
    const tick = () => {
        if (!voiceEngine.startedAt) return;
        els.timer.textContent = fmtDuration(Date.now() - voiceEngine.startedAt);
    };
    tick();
    durationTimer = setInterval(tick, 1000);
}

function stopDurationTimer() {
    if (durationTimer) {
        clearInterval(durationTimer);
        durationTimer = null;
    }
}

function showOverlay() {
    buildOverlay();
    if (overlayCloseTimer) {
        clearTimeout(overlayCloseTimer);
        overlayCloseTimer = null;
    }
    overlay.classList.remove('is-closing');
    overlay.classList.remove('is-hidden');
}

function hideOverlay() {
    stopRingtone();
    stopDurationTimer();
    pendingIncoming = null;
    pendingResume = null;
    if (overlay && !overlay.classList.contains('is-hidden')) {
        overlay.classList.add('is-closing');
        if (overlayCloseTimer) clearTimeout(overlayCloseTimer);
        overlayCloseTimer = setTimeout(() => {
            if (overlay) {
                overlay.classList.add('is-hidden');
                overlay.classList.remove('is-closing');
            }
            overlayCloseTimer = null;
        }, 180);
    }
    els.tech && els.tech.classList.add('is-hidden');
    els.timer && els.timer.classList.add('is-hidden');
    els.quality && els.quality.classList.add('is-hidden');
    els.mutedNote && els.mutedNote.classList.add('is-hidden');
    els.hint && els.hint.classList.add('is-hidden');
    if (els.audio) els.audio.srcObject = null;
    els.avatar && els.avatar.classList.remove('vc-ringing');
    els.avatar && els.avatar.classList.remove('vc-live');
}

function enterCallMode() {
    setControls('call');
    els.avatar.classList.remove('vc-ringing');
    els.avatar.classList.add('vc-live');
    els.timer.classList.remove('is-hidden');
    els.quality.classList.remove('is-hidden');
    startDurationTimer();
}

function showIncoming(data) {
    pendingIncoming = data;
    showOverlay();
    setPeer(data.caller);
    setStatus(t('call_incoming', 'Incoming call'));
    els.avatar.classList.remove('vc-live');
    els.avatar.classList.add('vc-ringing');
    els.timer.classList.add('is-hidden');
    els.quality.classList.add('is-hidden');
    setControls('incoming');
    startRingtone();
}

function showRejoin(state, display) {
    pendingResume = state;
    showOverlay();
    setPeer(display);
    setStatus(t('call_in_progress', 'Call in progress'));
    els.timer.classList.add('is-hidden');
    els.quality.classList.add('is-hidden');
    setControls('rejoin');
}

async function onAnswer() {
    const data = pendingIncoming;
    if (!data) return;
    stopRingtone();
    pendingIncoming = null;
    setPeer(data.caller);
    setStatus(t('call_connecting', 'Connecting…'));
    setControls('call');
    try {
        await voiceEngine.acceptIncoming(data.chat_id, data.call_id);
    } catch (err) {
        console.warn('Accept call failed:', err);
        hideOverlay();
    }
}

function onDecline() {
    const data = pendingIncoming;
    stopRingtone();
    pendingIncoming = null;
    if (data) voiceEngine.declineIncoming(data.chat_id);
    hideOverlay();
}

function onHangup() {
    voiceEngine.hangup();
}

async function onJoin() {
    const state = pendingResume;
    if (!state) return;
    pendingResume = null;
    setStatus(t('call_connecting', 'Connecting…'));
    setControls('call');
    try {
        await voiceEngine.resume(state);
    } catch (err) {
        console.warn('Resume call failed:', err);
        hideOverlay();
    }
}

function onToggleMute() {
    const muted = voiceEngine.toggleMute();
    if (els.muteBtn) {
        els.muteBtn.innerHTML = muted ? ICON_MIC_OFF : ICON_MIC;
        els.muteBtn.classList.toggle('is-active', muted);
    }
    if (els.muteLabel) els.muteLabel.textContent = muted ? t('call_unmute', 'Unmute') : t('call_mute', 'Mute');
}

function onToggleTech() {
    els.tech.classList.toggle('is-hidden');
}

function updateQuality(stats) {
    const level = Math.max(0, Math.min(4, stats.quality));
    els.quality.dataset.level = String(level);
    els.quality.dataset.tone = level >= 3 ? 'good' : (level === 2 ? 'fair' : 'poor');
    const bars = els.quality.querySelectorAll('i');
    bars.forEach((bar, idx) => bar.classList.toggle('on', idx < level));
    els.rtt.textContent = stats.rtt != null ? `${stats.rtt} ms` : '—';
    els.loss.textContent = stats.loss != null ? `${stats.loss}%` : '—';
    els.jitter.textContent = stats.jitter != null ? `${stats.jitter} ms` : '—';
    els.bitrate.textContent = stats.bitrate != null ? `${stats.bitrate} kbps` : '—';
    els.link.textContent = stats.relay ? t('call_link_relay', 'via relay (TURN)') : t('call_link_p2p', 'direct (P2P)');
}

function updatePeerNote() {
    const parts = [];
    if (!voiceEngine.peerStable) parts.push(t('call_peer_reconnecting', 'Peer is reconnecting…'));
    if (voiceEngine.peerMuted) parts.push(t('call_peer_muted', 'Peer microphone is off'));
    if (voiceEngine.muted) parts.push(t('call_self_muted', 'Your microphone is off'));
    if (parts.length) {
        els.mutedNote.textContent = parts.join(' · ');
        els.mutedNote.classList.remove('is-hidden');
    } else {
        els.mutedNote.classList.add('is-hidden');
    }
}

function bindEngineHandlers() {
    voiceEngine.on('phase', ({ phase }) => {
        if (phase === CALL_PHASE.OUTGOING) {
            showOverlay();
            if (!pendingIncoming && !pendingResume) setControls('call');
            setStatus(t('call_calling', 'Calling…'));
            els.avatar.classList.remove('vc-live');
            els.avatar.classList.add('vc-ringing');
        } else if (phase === CALL_PHASE.CONNECTING) {
            showOverlay();
            setStatus(t('call_connecting', 'Connecting…'));
        } else if (phase === CALL_PHASE.ACTIVE) {
            showOverlay();
            enterCallMode();
            setStatus(t('call_active', 'In call'));
        } else if (phase === CALL_PHASE.RECONNECTING) {
            setStatus(t('call_reconnecting', 'Reconnecting…'));
        }
    });
    voiceEngine.on('peer', ({ display }) => {
        if (display && display.username) setPeer(display);
        updatePeerNote();
    });
    voiceEngine.on('peerState', () => updatePeerNote());
    voiceEngine.on('peerMuted', () => updatePeerNote());
    voiceEngine.on('muted', () => updatePeerNote());
    voiceEngine.on('remoteStream', (stream) => {
        els.audio.srcObject = stream;
        els.hint.classList.add('is-hidden');
        const p = els.audio.play();
        if (p && typeof p.catch === 'function') {
            p.catch(() => els.hint.classList.remove('is-hidden'));
        }
    });
    voiceEngine.on('stats', (stats) => updateQuality(stats));
    voiceEngine.on('connected', () => {
        if (voiceEngine.phase === CALL_PHASE.ACTIVE) setStatus(t('call_active', 'In call'));
    });
    voiceEngine.on('signaling_lost', () => {
        setStatus(t('call_reconnecting', 'Reconnecting…'));
    });
    voiceEngine.on('error', ({ message }) => {
        showToast(message === 'rate_limited' ? t('call_rate_limited', 'Too many actions, slow down') : String(message));
    });
    voiceEngine.on('ended', ({ reason }) => {
        hideOverlay();
        const messages = {
            hangup: t('call_ended_hangup', 'Call ended'),
            declined: t('call_ended_declined', 'Call declined'),
            missed: t('call_ended_missed', 'Missed call'),
            cancelled: t('call_ended_hangup', 'Call ended'),
            peer_left: t('call_ended_peer_left', 'Peer left the call'),
            timeout: t('call_ended_hangup', 'Call ended'),
            kicked: t('call_ended_hangup', 'Call ended'),
            superseded: t('call_superseded', 'Call continues on another device'),
            mic_denied: t('call_mic_denied', 'Microphone access denied'),
            ended: t('call_ended_hangup', 'Call ended'),
        };
        showToast(messages[reason] || messages.ended);
    });
}

export function initVoiceCall() {
    buildOverlay();
    bindEngineHandlers();
    const btn = document.getElementById('voice-call-btn');
    if (btn) btn.addEventListener('click', () => { startVoiceCallForCurrentChat(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') voiceEngine.handleVisibilityRestored();
    });
    window.addEventListener('online', () => voiceEngine.handleNetworkOnline());
    window.addEventListener('offline', () => {
        if (voiceEngine.isBusy() && !overlay.classList.contains('is-hidden')) {
            setStatus(t('call_reconnecting', 'Reconnecting…'));
        }
    });
}

export async function startVoiceCallForCurrentChat() {
    const chatId = STATE.currentChatId;
    const chat = chatId ? STATE.chatsMap[chatId] : null;
    if (!chatId || !chat || chat.type !== 'direct' || chat.other_user_is_service) return;
    if (voiceEngine.isBusy()) {
        showOverlay();
        return;
    }
    pendingIncoming = null;
    pendingResume = null;
    setPeer(peerFromChatData(chatId));
    try {
        await voiceEngine.startOutgoing(chatId);
    } catch (err) {
        hideOverlay();
        showToast(err && err.message ? err.message : t('call_unavailable', 'Call is not available'));
    }
}

export function handleIncomingCallEvent(data) {
    if (!data || !data.chat_id) return;
    if (voiceEngine.isBusy()) {
        if (voiceEngine.callId === data.call_id) return;
        request('POST', `/voice/calls/${data.chat_id}/decline`).catch(() => {});
        return;
    }
    if (!overlay || overlay.classList.contains('is-hidden')) {
        showIncoming(data);
    } else if (pendingIncoming && pendingIncoming.call_id === data.call_id) {
        return;
    } else {
        showIncoming(data);
    }
}

export function handleCallStartedEvent(data) {
    if (!data) return;
    if (voiceEngine.isBusy() && voiceEngine.callId === data.call_id) return;
    if (pendingIncoming && (!data.call_id || pendingIncoming.call_id === data.call_id)) {
        stopRingtone();
        pendingIncoming = null;
        hideOverlay();
        if (!voiceEngine.isBusy()) {
            showToast(t('call_answered_elsewhere', 'Answered on another device'));
        }
    }
}

export function handleCallEndedEvent(data) {
    if (!data) return;
    if (voiceEngine.isBusy()) {
        voiceEngine.handleExternalEnd(data);
        return;
    }
    if (pendingIncoming && (!data.call_id || pendingIncoming.call_id === data.call_id)) {
        stopRingtone();
        pendingIncoming = null;
        hideOverlay();
        if (data.reason === 'missed') {
            showToast(t('call_ended_missed', 'Missed call'));
        } else if (data.reason === 'cancelled') {
            showToast(t('call_ended_cancelled', 'Call cancelled'));
        }
    }
}

export async function resyncVoiceCall(chatId) {
    if (!chatId || voiceEngine.isBusy()) return;
    let state = null;
    try {
        state = await request('GET', `/voice/calls/${chatId}`);
    } catch {
        return;
    }
    if (!state || !state.active) return;
    const me = STATE.currentUserId;
    if (state.caller_id !== me && state.callee_id !== me) return;
    const display = peerFromState(state, me);
    if (state.phase === 'ringing' && state.callee_id === me) {
        showIncoming({ chat_id: chatId, call_id: state.call_id, caller: display });
    } else if (state.phase === 'active') {
        showRejoin(state, display);
    } else if (state.phase === 'ringing' && state.caller_id === me) {
        setPeer(display);
        voiceEngine.resume(state).catch(() => hideOverlay());
    }
}
