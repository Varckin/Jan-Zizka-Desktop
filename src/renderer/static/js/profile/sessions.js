import { DOM, I18N_SESSIONS, formatSessionTime, getDeviceIcon } from './core.js';
import { confirmDialog } from '../desktop/confirm.js';
import { showToast } from './toast.js';

function buildSessionCard(s) {
    const card = document.createElement('div');
    card.className = 'session-card' + (s.is_current ? ' session-current' : '');
    card.dataset.sessionId = s.session_id;

    const device = s.device || {};
    const icon = getDeviceIcon(device.device_type);
    const geo = [device.city, device.country].filter(Boolean).join(', ');

    const iconEl = document.createElement('div');
    iconEl.className = 'session-device-icon';
    iconEl.textContent = icon;
    card.appendChild(iconEl);

    const info = document.createElement('div');
    info.className = 'session-info';

    const title = document.createElement('div');
    title.className = 'session-title';
    const browser = document.createElement('span');
    browser.className = 'session-browser';
    browser.textContent = device.browser || 'Unknown';
    title.appendChild(browser);
    const os = document.createElement('span');
    os.className = 'session-os';
    os.textContent = '· ' + (device.os || 'Unknown');
    title.appendChild(os);
    if (s.is_current) {
        const badge = document.createElement('span');
        badge.className = 'session-badge-current';
        badge.textContent = I18N_SESSIONS.current_session || 'Current';
        title.appendChild(badge);
    }
    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    if (device.ip) {
        const ip = document.createElement('span');
        ip.className = 'session-ip';
        ip.textContent = device.ip;
        meta.appendChild(ip);
        if (geo) {
            const geoEl = document.createElement('span');
            geoEl.className = 'session-geo';
            geoEl.textContent = '· ' + geo;
            meta.appendChild(geoEl);
        }
    }
    info.appendChild(meta);

    const time = document.createElement('div');
    time.className = 'session-time';
    time.textContent = (I18N_SESSIONS.last_active || 'Last active') + ': ' + formatSessionTime(s.last_active_at);
    info.appendChild(time);

    card.appendChild(info);

    if (!s.is_current) {
        const btn = document.createElement('button');
        btn.className = 'btn-terminate-session';
        btn.dataset.sessionId = s.session_id;
        btn.title = I18N_SESSIONS.terminate || 'Terminate';
        btn.textContent = '✕';
        card.appendChild(btn);
    }
    return card;
}

export function renderSessions(sessions) {
    if (!DOM.sessionsList) return;
    DOM.sessionsList.textContent = '';
    if (!sessions || sessions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sessions-empty';
        empty.textContent = I18N_SESSIONS.no_active_sessions || 'No active sessions';
        DOM.sessionsList.appendChild(empty);
        if (DOM.terminateOtherBtn) DOM.terminateOtherBtn.hidden = true;
        return;
    }
    const hasOther = sessions.some(s => !s.is_current);
    if (DOM.terminateOtherBtn) DOM.terminateOtherBtn.hidden = !hasOther;
    sessions.forEach(s => DOM.sessionsList.appendChild(buildSessionCard(s)));
    bindTerminateButtons();
}

function bindTerminateButtons() {
    document.querySelectorAll('.btn-terminate-session').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const sessionId = btn.dataset.sessionId;
            const card = btn.closest('.session-card');
            if (!await confirmDialog(I18N_SESSIONS.terminate_all_confirm || 'Terminate this session?')) return;
            try {
                const res = await fetch(`/profile/sessions/${sessionId}`, { method: 'DELETE' });
                if (!res.ok) {
                    const err = await res.json();
                    showToast((I18N_SESSIONS.error || 'Error') + ': ' + (err.detail || 'Failed'), 'error');
                    return;
                }
                if (card) {
                    card.style.transition = 'opacity 0.3s, transform 0.3s';
                    card.style.opacity = '0';
                    card.style.transform = 'translateX(20px)';
                    setTimeout(() => card.remove(), 300);
                }
                showToast(I18N_SESSIONS.session_terminated || 'Session terminated', 'success');
                setTimeout(() => loadSessions(), 350);
            } catch (err) {
                showToast((I18N_SESSIONS.error || 'Error') + ': ' + err.message, 'error');
            }
        });
    });
}

async function loadSessions() {
    try {
        const res = await fetch('/profile/sessions');
        if (!res.ok) return;
        const sessions = await res.json();
        window.ACTIVE_SESSIONS = sessions;
        renderSessions(sessions);
    } catch (err) {
        console.error('Failed to load sessions:', err);
    }
}

function bindTerminateOther() {
    if (!DOM.terminateOtherBtn) return;
    DOM.terminateOtherBtn.addEventListener('click', async () => {
        if (!await confirmDialog(I18N_SESSIONS.terminate_all_confirm || 'Terminate all other sessions?')) return;
        try {
            const res = await fetch('/profile/sessions', { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json();
                showToast((I18N_SESSIONS.error || 'Error') + ': ' + (err.detail || 'Failed'), 'error');
                return;
            }
            showToast(I18N_SESSIONS.session_terminated || 'Sessions terminated', 'success');
            loadSessions();
        } catch (err) {
            showToast((I18N_SESSIONS.error || 'Error') + ': ' + err.message, 'error');
        }
    });
}

export function initSessions() {
    renderSessions(window.ACTIVE_SESSIONS || []);
    bindTerminateOther();
}
