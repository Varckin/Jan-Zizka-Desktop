import { STATE } from '../state.js';
import { showToast } from '../../core_chat/toast.js';
import { showConfirm } from '../dialogs.js';
import { request } from '../../core_chat/api.js';
import { fullNameOf } from '../format.js';
import { chatDisplayName } from '../contacts.js';
import { groupVoice, GV_PHASE } from './engine.js';

const t = (key, fallback) => (window.i18n && window.i18n[key]) || fallback;

function tt(key, fallback, vars) {
    let text = t(key, fallback);
    if (vars) {
        for (const [name, value] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(value));
        }
    }
    return text;
}

const ICON_JOIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
const ICON_LEAVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.4 19.4 0 0 1-8.46-1.92 19.4 19.4 0 0 1-6.77-5.34A19.5 19.5 0 0 1 2 9.81a19.4 19.4 0 0 1-1.92-8.46 2 2 0 0 1 2-2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="17" y1="1" x2="23" y2="7"/><line x1="23" y1="1" x2="17" y2="7"/></svg>';
const ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
const ICON_MIC_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_KICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
const ICON_MUTE_ALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
const ICON_SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';

let overlay = null;
let els = {};
let durationTimer = null;
let refreshSeq = 0;
let closeTimer = null;
let lastIdentities = new Set();
let lastIconState = new Map();

const current = {
    chatId: null,
    state: null,
    canManage: false,
    configured: true,
    joined: false,
    modalOpen: false,
    connecting: false,
};

function fmtDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

function displayNameOf(p) {
    const name = fullNameOf({ first_name: p.first_name, last_name: p.last_name, username: p.username });
    return name || p.username || `user${p.user_id || ''}`;
}

function roleLabel(role) {
    if (role === 'owner') return t('gv_owner', 'owner');
    if (role === 'admin') return t('gv_admin', 'admin');
    if (role === 'moderator') return t('gv_moderator', 'moderator');
    return '';
}

function qualityLabel(quality) {
    switch (quality) {
        case 'excellent': return t('gv_quality_excellent', 'Excellent');
        case 'good': return t('gv_quality_good', 'Good');
        case 'poor': return t('gv_quality_poor', 'Poor');
        case 'lost': return t('gv_quality_lost', 'Lost');
        default: return t('gv_quality_unknown', '—');
    }
}

function isActive() {
    return !!(current.state && current.state.active);
}

function myIdentity() {
    return `u${STATE.currentUserId}`;
}

function myMuteLocked() {
    if (groupVoice.muteLocked) return true;
    if (!current.state || !Array.isArray(current.state.participants)) return false;
    const me = current.state.participants.find(x => x.identity === myIdentity());
    return !!(me && me.mute_locked);
}

function participantCount() {
    if (current.joined) return Math.max(mergedParticipants().length, backendCount());
    return backendCount();
}

function backendCount() {
    return isActive() && Array.isArray(current.state.participants) ? current.state.participants.length : 0;
}

function mergedParticipants() {
    const map = new Map();
    if (isActive() && Array.isArray(current.state.participants)) {
        for (const p of current.state.participants) map.set(p.identity, { ...p });
    }
    if (current.joined) {
        for (const p of groupVoice.participantsView()) {
            const base = map.get(p.identity) || {};
            const merged = { ...base, ...p };
            for (const key of ['user_id', 'username', 'first_name', 'last_name', 'avatar']) {
                if (!p[key] && base[key]) merged[key] = base[key];
            }
            merged.role = base.role || p.role || 'member';
            merged.muted = p.isLocal ? p.muted : (p.muted ?? base.muted);
            map.set(p.identity, merged);
        }
    }
    return [...map.values()].sort((a, b) => {
        if (a.isLocal) return -1;
        if (b.isLocal) return 1;
        return (a.joined_at || 0) - (b.joined_at || 0);
    });
}

function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'gv-overlay is-hidden';
    overlay.id = 'gv-overlay';
    overlay.innerHTML = `
        <div class="gv-modal" role="dialog" aria-modal="true" aria-label="${t('gv_open_room', 'Group voice')}">
            <div class="gv-head">
                <div class="gv-head-avatar" id="gv-chat-avatar"></div>
                <div class="gv-head-text">
                    <div class="gv-head-title" id="gv-title"></div>
                    <div class="gv-head-sub">
                        <span class="gv-live is-hidden" id="gv-live"><i></i>${t('gv_live', 'LIVE')}</span>
                        <span class="gv-timer is-hidden" id="gv-timer">0:00</span>
                        <span class="gv-count" id="gv-count">0/20</span>
                    </div>
                </div>
                <button type="button" class="gv-icon-btn" id="gv-close" aria-label="Close">${ICON_CLOSE}</button>
            </div>
            <div class="gv-status" id="gv-status"><span class="gv-status-dot"></span><span id="gv-status-text"></span></div>
            <div class="gv-info" id="gv-info">
                <div class="gv-info-title">${t('gv_info_title', 'Connection info')}</div>
                <div class="gv-info-grid">
                    <div class="gv-info-row"><span>${t('gv_status', 'Status')}</span><b id="gv-i-status">—</b></div>
                    <div class="gv-info-row"><span>${t('gv_quality', 'Connection quality')}</span><b id="gv-i-quality">—</b></div>
                    <div class="gv-info-row"><span>${t('gv_uptime', 'Duration')}</span><b id="gv-i-uptime">—</b></div>
                    <div class="gv-info-row"><span>${t('gv_participants', 'Participants')}</span><b id="gv-i-count">—</b></div>
                    <div class="gv-info-row"><span>${t('gv_room', 'Room')}</span><b id="gv-i-room">—</b></div>
                    <div class="gv-info-row"><span>${t('gv_server', 'Server')}</span><b id="gv-i-server">—</b></div>
                    <div class="gv-info-row"><span>${t('gv_codec', 'Codec')}</span><b>Opus 48 kHz</b></div>
                    <div class="gv-info-row"><span>${t('gv_mic', 'Microphone')}</span><b id="gv-i-mic">—</b></div>
                </div>
            </div>
            <div class="gv-body">
                <div class="gv-participants" id="gv-participants"></div>
                <div class="gv-empty is-hidden" id="gv-empty">${t('gv_no_one', 'No one is in voice yet')}</div>
            </div>
            <button type="button" class="gv-hint is-hidden" id="gv-hint">${t('gv_tap_sound', 'Tap to enable sound')}</button>
            <div class="gv-controls" id="gv-controls"></div>
            <div class="gv-admin is-hidden" id="gv-admin">
                <div class="gv-admin-title">${ICON_SHIELD}<span>${t('gv_admin_panel', 'Admin controls')}</span></div>
                <div class="gv-admin-buttons" id="gv-admin-buttons"></div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    els = {
        avatar: overlay.querySelector('#gv-chat-avatar'),
        title: overlay.querySelector('#gv-title'),
        live: overlay.querySelector('#gv-live'),
        timer: overlay.querySelector('#gv-timer'),
        count: overlay.querySelector('#gv-count'),
        close: overlay.querySelector('#gv-close'),
        status: overlay.querySelector('#gv-status'),
        statusText: overlay.querySelector('#gv-status-text'),
        info: overlay.querySelector('#gv-info'),
        iStatus: overlay.querySelector('#gv-i-status'),
        iQuality: overlay.querySelector('#gv-i-quality'),
        iUptime: overlay.querySelector('#gv-i-uptime'),
        iCount: overlay.querySelector('#gv-i-count'),
        iRoom: overlay.querySelector('#gv-i-room'),
        iServer: overlay.querySelector('#gv-i-server'),
        iMic: overlay.querySelector('#gv-i-mic'),
        participants: overlay.querySelector('#gv-participants'),
        empty: overlay.querySelector('#gv-empty'),
        hint: overlay.querySelector('#gv-hint'),
        controls: overlay.querySelector('#gv-controls'),
        admin: overlay.querySelector('#gv-admin'),
        adminButtons: overlay.querySelector('#gv-admin-buttons'),
    };
    els.close.addEventListener('click', closeGroupVoiceModal);
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closeGroupVoiceModal();
    });
    els.hint.addEventListener('click', () => {
        groupVoice.retryPlayback();
        els.hint.classList.add('is-hidden');
    });
}

function avatarElement(p, sizeClass) {
    const wrap = document.createElement('div');
    wrap.className = `gv-ava ${sizeClass || ''}`;
    const name = displayNameOf(p);
    if (p.avatar) {
        const img = document.createElement('img');
        img.src = p.avatar;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => {
            img.remove();
            const span = document.createElement('span');
            span.textContent = (name[0] || '?').toUpperCase();
            wrap.appendChild(span);
        });
        wrap.appendChild(img);
    } else {
        const span = document.createElement('span');
        span.textContent = (name[0] || '?').toUpperCase();
        wrap.appendChild(span);
    }
    return wrap;
}

function buildTile(p, pop) {
    const anim = pop || {};
    const tile = document.createElement('div');
    tile.className = 'gv-tile';
    tile.dataset.identity = p.identity;
    if (p.isSpeaking && !p.muted) tile.classList.add('is-speaking');
    if (p.isLocal) tile.classList.add('is-local');

    const avaWrap = document.createElement('div');
    avaWrap.className = 'gv-tile-ava';
    avaWrap.appendChild(avatarElement(p));
    const role = roleLabel(p.role);
    if (role) {
        const badge = document.createElement('span');
        badge.className = `gv-role-badge role-${p.role}`;
        badge.textContent = role;
        avaWrap.appendChild(badge);
    }
    if (p.muted) {
        const micOff = document.createElement('span');
        micOff.className = 'gv-tile-micoff' + (anim.mic ? ' gv-pop' : '');
        micOff.innerHTML = ICON_MIC_OFF;
        avaWrap.appendChild(micOff);
    }
    if (p.mute_locked) {
        const lock = document.createElement('span');
        lock.className = 'gv-tile-lock' + (anim.lock ? ' gv-pop' : '');
        lock.innerHTML = ICON_LOCK;
        lock.title = t('gv_mute_locked', 'Your microphone is locked by an admin');
        avaWrap.appendChild(lock);
    }
    tile.appendChild(avaWrap);

    const nameEl = document.createElement('div');
    nameEl.className = 'gv-tile-name';
    nameEl.textContent = p.isLocal ? tt('gv_you_name', '{name} (you)', { name: displayNameOf(p) }) : displayNameOf(p);
    if (p.username) nameEl.title = `@${p.username}`;
    tile.appendChild(nameEl);

    if (current.canManage && !p.isLocal) {
        const actions = document.createElement('div');
        actions.className = 'gv-tile-actions';
        const muteBtn = document.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'gv-mini-btn';
        muteBtn.innerHTML = p.muted ? ICON_MIC : ICON_MIC_OFF;
        muteBtn.title = p.muted ? t('gv_unmute', 'Unmute') : t('gv_mute', 'Mute');
        muteBtn.addEventListener('click', () => adminSetMute(p, !p.muted, muteBtn));
        const kickBtn = document.createElement('button');
        kickBtn.type = 'button';
        kickBtn.className = 'gv-mini-btn danger';
        kickBtn.innerHTML = ICON_KICK;
        kickBtn.title = t('gv_kick', 'Remove from voice');
        kickBtn.addEventListener('click', () => adminKick(p, kickBtn));
        actions.appendChild(muteBtn);
        actions.appendChild(kickBtn);
        tile.appendChild(actions);
    }
    return tile;
}

function renderParticipants() {
    const people = mergedParticipants();
    els.participants.innerHTML = '';
    els.empty.classList.toggle('is-hidden', people.length > 0);
    if (!people.length) {
        els.empty.textContent = isActive()
            ? t('gv_empty_room', 'The room is empty — join to start talking')
            : t('gv_no_one', 'No one is in voice yet');
    }
    const seen = new Set();
    const iconState = new Map();
    for (const p of people) {
        const prev = lastIconState.get(p.identity);
        const pop = {
            mic: !!p.muted && !(prev && prev.mic),
            lock: !!p.mute_locked && !(prev && prev.lock),
        };
        iconState.set(p.identity, { mic: !!p.muted, lock: !!p.mute_locked });
        const tile = buildTile(p, pop);
        if (!lastIdentities.has(p.identity)) tile.classList.add('gv-enter');
        seen.add(p.identity);
        els.participants.appendChild(tile);
    }
    lastIdentities = seen;
    lastIconState = iconState;
}

function updateSpeakingTiles() {
    if (!els || !els.participants) return;
    const speaking = groupVoice.speakers instanceof Set ? groupVoice.speakers : new Set();
    els.participants.querySelectorAll('.gv-tile').forEach(tile => {
        const muted = !!tile.querySelector('.gv-tile-micoff');
        tile.classList.toggle('is-speaking', speaking.has(tile.dataset.identity) && !muted);
    });
}

function statusSnapshot() {
    if (current.joined) {
        switch (groupVoice.phase) {
            case GV_PHASE.CONNECTING: return { text: t('gv_connecting', 'Connecting…'), tone: 'warn' };
            case GV_PHASE.RECONNECTING: return { text: t('gv_reconnecting', 'Reconnecting…'), tone: 'warn' };
            default: return { text: t('gv_connected', 'Connected'), tone: 'ok' };
        }
    }
    if (current.connecting) return { text: t('gv_connecting', 'Connecting…'), tone: 'warn' };
    if (isActive() && backendCount() > 0) {
        return { text: tt('gv_people_in_voice', '{count} in voice', { count: backendCount() }), tone: 'live' };
    }
    if (isActive()) return { text: t('gv_empty_room', 'The room is empty — join to start talking'), tone: 'idle' };
    return { text: t('gv_idle', 'Voice chat is not running'), tone: 'idle' };
}

function renderStatus() {
    const snap = statusSnapshot();
    els.status.dataset.tone = snap.tone;
    els.statusText.textContent = snap.text;
}

function renderInfo() {
    const snap = statusSnapshot();
    els.iStatus.textContent = snap.text;
    els.iQuality.textContent = current.joined ? qualityLabel(groupVoice.myQuality()) : '—';
    const max = (current.state && current.state.max_participants) || 20;
    els.iCount.textContent = `${participantCount()}/${max}`;
    els.count.textContent = `${participantCount()}/${max}`;
    if (current.joined && groupVoice.connectedAt) {
        els.iUptime.textContent = fmtDuration(Date.now() - groupVoice.connectedAt);
    } else if (isActive() && current.state.started_at) {
        els.iUptime.textContent = fmtDuration(Date.now() - current.state.started_at * 1000);
    } else {
        els.iUptime.textContent = '—';
    }
    els.iRoom.textContent = (current.state && current.state.room) || '—';
    const server = groupVoice.serverInfo();
    els.iServer.textContent = server
        ? [server.edition, server.version, server.region].filter(Boolean).join(' · ') || '—'
        : '—';
    if (current.joined) {
        els.iMic.textContent = groupVoice.muted ? t('gv_mic_off', 'Off') : t('gv_mic_on', 'On');
    } else {
        els.iMic.textContent = '—';
    }
    const live = current.joined || (isActive() && backendCount() > 0);
    els.live.classList.toggle('is-hidden', !live);
    els.timer.classList.toggle('is-hidden', !(current.joined && groupVoice.connectedAt));
    if (current.joined && groupVoice.connectedAt) {
        els.timer.textContent = fmtDuration(Date.now() - groupVoice.connectedAt);
    }
}

function controlButton(kind, icon, label, onClick, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'gv-ctl';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `gv-btn gv-btn-${kind}`;
    btn.innerHTML = icon;
    if (opts.disabled) btn.disabled = true;
    btn.addEventListener('click', onClick);
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(btn);
    wrap.appendChild(span);
    return wrap;
}

function renderControls() {
    els.controls.innerHTML = '';
    if (current.joined) {
        const locked = groupVoice.muted && myMuteLocked();
        els.controls.appendChild(controlButton(
            groupVoice.muted ? 'muted' : 'mic',
            groupVoice.muted ? ICON_MIC_OFF : ICON_MIC,
            locked ? t('gv_locked', 'Locked') : (groupVoice.muted ? t('gv_unmute', 'Unmute') : t('gv_mute', 'Mute')),
            () => {
                if (locked) {
                    showToast(t('gv_mute_locked', 'Your microphone is locked by an admin'));
                    return;
                }
                groupVoice.toggleMute();
                renderControls();
                renderInfo();
                renderParticipants();
            },
            { disabled: locked },
        ));
        els.controls.appendChild(controlButton('info', ICON_INFO, t('gv_info_title', 'Connection info'), () => {
            els.info.classList.toggle('is-collapsed');
        }));
        els.controls.appendChild(controlButton('leave', ICON_LEAVE, t('gv_leave', 'Leave'), () => leaveRoom()));
        return;
    }
    const busy = current.connecting || groupVoice.phase === GV_PHASE.CONNECTING;
    const full = isActive() && backendCount() >= ((current.state && current.state.max_participants) || 20);
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'gv-join';
    join.disabled = busy || full || current.configured === false || groupVoice.isInCall();
    join.innerHTML = `${ICON_JOIN}<span>${
        busy ? t('gv_connecting', 'Connecting…')
            : (full ? t('gv_full', 'The voice room is full')
                : (current.configured === false ? t('gv_unavailable', 'Group voice is not available')
                    : (groupVoice.isInCall() ? t('gv_busy', 'You are already in another voice chat') : t('gv_join', 'Join'))))
    }</span>`;
    join.addEventListener('click', () => joinRoom());
    els.controls.appendChild(join);
}

function renderAdmin() {
    const visible = current.canManage && (isActive() || current.joined);
    els.admin.classList.toggle('is-hidden', !visible);
    if (!visible) return;
    els.adminButtons.innerHTML = '';
    const others = mergedParticipants().filter(p => !p.isLocal && !p.muted);
    const muteAll = document.createElement('button');
    muteAll.type = 'button';
    muteAll.className = 'gv-admin-btn';
    muteAll.innerHTML = `${ICON_MUTE_ALL}<span>${t('gv_mute_all', 'Mute all')}</span>`;
    muteAll.disabled = others.length === 0;
    muteAll.addEventListener('click', () => adminMuteAll(muteAll));
    const end = document.createElement('button');
    end.type = 'button';
    end.className = 'gv-admin-btn danger';
    end.innerHTML = `${ICON_LEAVE}<span>${t('gv_end_call', 'End for all')}</span>`;
    end.addEventListener('click', () => adminEndCall(end));
    els.adminButtons.appendChild(muteAll);
    els.adminButtons.appendChild(end);
}

function renderHeader() {
    const chat = STATE.chatsMap[current.chatId];
    els.title.textContent = chat ? (chatDisplayName(chat) || chat.name || t('gv_title_fallback', 'Voice chat')) : t('gv_title_fallback', 'Voice chat');
    els.avatar.innerHTML = '';
    const avatarUrl = chat && chat.avatar ? chat.avatar : null;
    if (avatarUrl) {
        const img = document.createElement('img');
        img.src = avatarUrl;
        img.alt = '';
        img.addEventListener('error', () => {
            img.remove();
            const span = document.createElement('span');
            span.textContent = (els.title.textContent[0] || '?').toUpperCase();
            els.avatar.appendChild(span);
        });
        els.avatar.appendChild(img);
    } else {
        const span = document.createElement('span');
        span.textContent = (els.title.textContent[0] || '?').toUpperCase();
        els.avatar.appendChild(span);
    }
}

function render() {
    if (!overlay) return;
    renderHeader();
    renderStatus();
    renderInfo();
    renderParticipants();
    renderControls();
    renderAdmin();
}

let durationTicks = 0;

function startDurationTimer() {
    stopDurationTimer();
    durationTicks = 0;
    durationTimer = setInterval(() => {
        if (!current.modalOpen) return;
        durationTicks += 1;
        if (!current.joined && durationTicks % 5 === 0) {
            const chatId = current.chatId;
            fetchState(chatId, { silent: true }).then((state) => {
                if (state && current.chatId === chatId && isModalFor(chatId)) render();
            });
            return;
        }
        renderInfo();
    }, 1000);
}

function stopDurationTimer() {
    if (durationTimer) {
        clearInterval(durationTimer);
        durationTimer = null;
    }
}

async function fetchState(chatId, { silent = false } = {}) {
    const seq = ++refreshSeq;
    try {
        const state = await request('GET', `/voice/group/${chatId}/state`);
        if (seq !== refreshSeq && current.chatId !== chatId) return null;
        current.state = state;
        current.canManage = !!state.can_manage;
        current.configured = state.configured !== false;
        return state;
    } catch (err) {
        if (!silent) showToast(err && err.message ? err.message : t('gv_unavailable', 'Group voice is not available'));
        return null;
    }
}

export async function openGroupVoiceModal(chatId) {
    const id = chatId || STATE.currentChatId;
    const chat = id ? STATE.chatsMap[id] : null;
    if (!id || !chat || chat.type !== 'group') return false;
    if (groupVoice.isInCall() && groupVoice.chatId !== id) {
        showToast(t('gv_busy', 'You are already in another voice chat'));
        return false;
    }
    buildOverlay();
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    overlay.classList.remove('is-closing');
    lastIdentities = new Set();
    lastIconState = new Map();
    current.chatId = id;
    current.joined = groupVoice.isInCall() && groupVoice.chatId === id;
    current.modalOpen = true;
    overlay.classList.remove('is-hidden');
    render();
    if (groupVoice.blockedEls && groupVoice.blockedEls.size) els.hint.classList.remove('is-hidden');
    if (!current.joined) {
        const state = await fetchState(id, { silent: true });
        if (state && current.modalOpen && current.chatId === id) render();
    }
    startDurationTimer();
    return true;
}

export function closeGroupVoiceModal() {
    current.modalOpen = false;
    if (overlay && !overlay.classList.contains('is-hidden')) {
        overlay.classList.add('is-closing');
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            if (overlay) {
                overlay.classList.add('is-hidden');
                overlay.classList.remove('is-closing');
            }
            closeTimer = null;
        }, 180);
    }
    els.hint && els.hint.classList.add('is-hidden');
    stopDurationTimer();
}

function isModalFor(chatId) {
    return current.modalOpen && current.chatId === chatId;
}

async function joinRoom() {
    if (current.connecting) return;
    current.connecting = true;
    renderControls();
    renderStatus();
    try {
        const payload = await groupVoice.join(current.chatId);
        current.joined = true;
        current.canManage = !!payload.can_manage;
        current.configured = true;
        if (payload.state) current.state = payload.state;
    } catch (err) {
        const msg = err && err.message ? err.message : '';

        const handledByEngine = ['mic_denied', 'mic_failed', 'connect_failed', 'publish_failed'];
        if (handledByEngine.includes(msg)) {

        } else if (msg === 'already_in_call') {
            showToast(t('gv_busy', 'You are already in another voice chat'));
        } else if (msg === 'livekit_client_unavailable') {
            showToast(t('gv_unavailable', 'Group voice is not available'));
        } else if (/full/i.test(msg)) {
            showToast(t('gv_full', 'The voice room is full'));
        } else {
            showToast(msg || t('gv_connect_failed', 'Could not connect to the voice server'));
        }
    } finally {
        current.connecting = false;
        if (isModalFor(current.chatId)) render();
        renderBar();
    }
}

async function leaveRoom() {
    await groupVoice.leave();
}

async function resyncAfterAdmin() {
    const chatId = current.chatId;
    if (chatId == null) return;
    await fetchState(chatId, { silent: true });
    if (current.chatId !== chatId) return;
    renderBar();
    if (isModalFor(chatId)) render();
}

async function adminSetMute(p, mute, btn) {
    const action = mute ? 'mute' : 'unmute';
    if (btn) btn.disabled = true;
    try {
        await request('POST', `/voice/group/${current.chatId}/${action}`, { body: { identity: p.identity } });
        if (current.state && Array.isArray(current.state.participants)) {
            const target = current.state.participants.find(x => x.identity === p.identity);
            if (target) target.muted = mute;
        }
        render();
        await resyncAfterAdmin();
    } catch (err) {
        showToast(err && err.message ? err.message : t('gv_action_failed', 'Action failed'));
        if (btn) btn.disabled = false;
    }
}

async function adminKick(p, btn) {
    const ok = await showConfirm(tt('gv_confirm_kick', 'Remove {name} from the voice chat?', { name: displayNameOf(p) }));
    if (!ok) return;
    if (btn) btn.disabled = true;
    try {
        await request('POST', `/voice/group/${current.chatId}/kick`, { body: { identity: p.identity } });
        if (current.state && Array.isArray(current.state.participants)) {
            current.state.participants = current.state.participants.filter(x => x.identity !== p.identity);
        }
        render();
        await resyncAfterAdmin();
    } catch (err) {
        showToast(err && err.message ? err.message : t('gv_action_failed', 'Action failed'));
        if (btn) btn.disabled = false;
    }
}

async function adminMuteAll(btn) {
    const ok = await showConfirm(t('gv_confirm_mute_all', 'Mute all participants?'));
    if (!ok) return;
    if (btn) btn.disabled = true;
    try {
        await request('POST', `/voice/group/${current.chatId}/mute-all`);
        await resyncAfterAdmin();
    } catch (err) {
        showToast(err && err.message ? err.message : t('gv_action_failed', 'Action failed'));
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function adminEndCall(btn) {
    const ok = await showConfirm(t('gv_confirm_end', 'End the voice chat for everyone?'));
    if (!ok) return;
    if (btn) btn.disabled = true;
    try {
        await request('POST', `/voice/group/${current.chatId}/end`);
        await resyncAfterAdmin();
    } catch (err) {
        showToast(err && err.message ? err.message : t('gv_action_failed', 'Action failed'));
    } finally {
        if (btn) btn.disabled = false;
    }
}

function barEl() {
    return document.getElementById('group-voice-bar');
}

function renderBar() {
    const bar = barEl();
    if (!bar) return;
    const inContext = current.chatId != null && current.chatId === STATE.currentChatId;
    const chat = inContext ? STATE.chatsMap[current.chatId] : null;
    const joinedHere = current.joined && inContext && groupVoice.chatId === current.chatId;
    if (!chat || chat.type !== 'group' || (!joinedHere && !(inContext && backendCount() > 0))) {
        bar.classList.add('is-hidden');
        bar.innerHTML = '';
        return;
    }
    bar.classList.remove('is-hidden');
    bar.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = `gv-bar-dot${joinedHere ? ' on' : ''}`;
    const text = document.createElement('span');
    text.className = 'gv-bar-text';
    text.textContent = joinedHere
        ? tt('gv_bar_connected', 'You are in voice · {count}', { count: participantCount() })
        : tt('gv_bar_active', 'Voice chat · {count}', { count: backendCount() });
    bar.appendChild(dot);
    bar.appendChild(text);

    if (joinedHere) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'gv-bar-btn';
        open.textContent = t('gv_open', 'Open');
        open.addEventListener('click', () => openGroupVoiceModal(current.chatId));
        const leave = document.createElement('button');
        leave.type = 'button';
        leave.className = 'gv-bar-btn danger';
        leave.textContent = t('gv_leave', 'Leave');
        leave.addEventListener('click', () => leaveRoom());
        bar.appendChild(open);
        bar.appendChild(leave);
    } else {
        const join = document.createElement('button');
        join.type = 'button';
        join.className = 'gv-bar-btn primary';
        join.textContent = t('gv_join', 'Join');
        join.disabled = groupVoice.isInCall();
        join.addEventListener('click', async () => {
            const opened = await openGroupVoiceModal(current.chatId);
            if (opened) joinRoom();
        });
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'gv-bar-btn';
        open.textContent = t('gv_open', 'Open');
        open.addEventListener('click', () => openGroupVoiceModal(current.chatId));
        bar.appendChild(join);
        bar.appendChild(open);
    }
    text.addEventListener('click', () => openGroupVoiceModal(current.chatId));
}

export async function refreshGroupVoiceBar(chatId) {
    const chat = chatId ? STATE.chatsMap[chatId] : null;
    closeGroupVoiceModalIfForeign(chatId);
    if (!chat || chat.type !== 'group') {
        renderBar();
        return;
    }
    current.chatId = chatId;
    current.joined = groupVoice.isInCall() && groupVoice.chatId === chatId;
    await fetchState(chatId, { silent: true });
    if (current.chatId === chatId) {
        renderBar();
        if (isModalFor(chatId)) render();
    }
}

function closeGroupVoiceModalIfForeign(chatId) {
    if (current.modalOpen && current.chatId !== chatId) closeGroupVoiceModal();
}

export function handleGroupVoiceUpdate(data) {
    if (!data || !data.chat_id) return;
    if (data.chat_id !== current.chatId && data.chat_id !== STATE.currentChatId) return;
    current.chatId = data.chat_id;
    current.state = data;
    current.joined = groupVoice.isInCall() && groupVoice.chatId === data.chat_id;
    if (current.joined && Array.isArray(data.participants)) {
        const me = data.participants.find(x => x.identity === myIdentity());
        if (me) groupVoice.muteLocked = !!me.mute_locked;
    }
    renderBar();
    if (isModalFor(data.chat_id)) render();
}

export function handleGroupVoiceEnded(data) {
    if (!data || !data.chat_id) return;
    const chatId = data.chat_id;
    if (chatId !== current.chatId && chatId !== STATE.currentChatId) return;
    const wasJoined = groupVoice.isInCall() && groupVoice.chatId === chatId;
    if (wasJoined) {
        groupVoice.handleExternalEnd(data.reason === 'ended_by_admin' ? 'room_deleted' : (data.reason || 'ended'));
    }
    if (chatId === current.chatId) {
        current.state = null;
        renderBar();
        if (isModalFor(chatId)) render();
    }
    if (!wasJoined && chatId === STATE.currentChatId) {

        const messages = {
            ended_by_admin: t('gv_ended_by_admin', 'An admin ended the voice chat'),
            timeout: t('gv_room_timeout', 'Voice chat ended (time limit)'),
        };
        if (messages[data.reason]) showToast(messages[data.reason]);
    }
}

function bindEngineHandlers() {
    groupVoice.on('phase', () => {
        if (isModalFor(groupVoice.chatId) || (current.modalOpen && current.chatId === groupVoice.chatId)) render();
        renderBar();
    });
    groupVoice.on('participants', () => {
        if (current.modalOpen) { renderParticipants(); renderInfo(); renderAdmin(); }
        renderBar();
    });
    groupVoice.on('speakers', () => {
        if (current.modalOpen) updateSpeakingTiles();
    });
    groupVoice.on('trackMute', ({ identity, muted, isLocal, forced }) => {
        if (isLocal && forced) {
            groupVoice.muteLocked = muted;
            showToast(muted
                ? t('gv_admin_muted_you', 'An admin muted your microphone')
                : t('gv_admin_unmuted_you', 'An admin unmuted your microphone'));
        }
        if (current.state && Array.isArray(current.state.participants)) {
            const target = current.state.participants.find(x => x.identity === identity);
            if (target) target.muted = muted;
        }
        if (current.modalOpen) { renderParticipants(); renderInfo(); renderControls(); }
    });
    groupVoice.on('muted', () => {
        if (current.modalOpen) { renderControls(); renderInfo(); renderParticipants(); }
        renderBar();
    });
    groupVoice.on('quality', () => {
        if (current.modalOpen) renderInfo();
    });
    groupVoice.on('connection', ({ state }) => {
        if (current.modalOpen) renderStatus();
        if (state === 'disconnected') renderBar();
    });
    groupVoice.on('autoplayBlocked', () => {
        if (current.modalOpen) els.hint.classList.remove('is-hidden');
    });
    groupVoice.on('autoplayRestored', () => {
        els.hint && els.hint.classList.add('is-hidden');
    });
    groupVoice.on('error', ({ message }) => {
        showToast(message === 'rate_limited' ? t('gv_rate_limited', 'Too many actions, slow down') : String(message));
    });
    groupVoice.on('ended', ({ reason, chatId }) => {
        current.joined = false;
        const messages = {
            hangup: t('gv_left', 'You left the voice chat'),
            kicked: t('gv_kicked', 'You were removed from the voice chat'),
            room_deleted: t('gv_ended_by_admin', 'An admin ended the voice chat'),
            server_shutdown: t('gv_server_shutdown', 'The voice server is restarting'),
            mic_denied: t('gv_mic_denied', 'Microphone access denied'),
            mic_failed: t('gv_mic_failed', 'Microphone is not available'),
            connect_failed: t('gv_connect_failed', 'Could not connect to the voice server'),
            publish_failed: t('gv_connect_failed', 'Could not connect to the voice server'),
            join_failed: t('gv_connect_failed', 'Could not connect to the voice server'),
            disconnected: t('gv_disconnected', 'Connection lost'),
            server_error: t('gv_server_error', 'The voice server dropped the connection. Please try joining again'),
            reconnect_storm: t('gv_reconnect_storm', 'Could not establish a stable connection to the voice server. Please try again'),
            superseded: t('gv_superseded', 'Voice chat continues in another tab or on another device'),
            superseded_tab: t('gv_superseded_tab', 'Voice chat continues in another tab'),
        };
        if (messages[reason]) showToast(messages[reason]);
        if (chatId && chatId === current.chatId) {
            fetchState(chatId, { silent: true }).then(() => {
                renderBar();
                if (isModalFor(chatId)) render();
            });
        } else {
            renderBar();
            if (current.modalOpen) render();
        }
    });
}

export function initGroupVoice() {
    buildOverlay();
    bindEngineHandlers();
    const btn = document.getElementById('group-voice-btn');
    if (btn) btn.addEventListener('click', () => openGroupVoiceModal(STATE.currentChatId));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && current.modalOpen) closeGroupVoiceModal();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') groupVoice.handleVisibilityRestored();
    });
    window.addEventListener('offline', () => {
        if (groupVoice.isInCall() && current.modalOpen) renderStatus();
    });
}
