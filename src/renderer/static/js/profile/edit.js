import { DOM, LANGUAGES, COUNTRIES, i18n } from './core.js';
import { showToast } from './toast.js';

function setCodeTag(el, code, name, fallback) {
    if (!el) return;
    const cleanCode = String(code || '').trim().toUpperCase();
    el.textContent = '';
    if (!cleanCode) {
        el.textContent = fallback || '';
        return;
    }
    const badge = document.createElement('span');
    badge.className = 'code-badge';
    badge.textContent = cleanCode;
    el.appendChild(badge);
    if (name) el.appendChild(document.createTextNode(' ' + name));
}

async function loadProfile() {
    try {
        const res = await fetch('/profile/me');
        if (!res.ok) return;
        const profile = await res.json();
        document.getElementById('edit-first-name').value = profile.first_name || '';
        document.getElementById('edit-last-name').value = profile.last_name || '';
        document.getElementById('edit-username').value = profile.username || '';
        document.getElementById('edit-email').value = profile.email || '';
        document.getElementById('edit-bio').value = profile.bio || '';
    } catch (err) {
        console.error('Failed to load profile data:', err);
        document.getElementById('edit-username').value = document.getElementById('view-username').textContent;
        document.getElementById('edit-email').value = document.getElementById('view-email').textContent;
    }
}

function updateViewFromResult(result) {
    const user = result.user;
    document.getElementById('view-username').textContent = user.username;
    document.getElementById('view-email').textContent = user.email;
    document.getElementById('view-bio').textContent = user.bio || i18n.no_bio || 'No bio yet';

    const newFullName = [user.first_name, user.last_name].filter(n => n && n.trim()).join(' ').trim();
    const fullnameEl = document.getElementById('profile-fullname');
    const usernameSmallEl = document.getElementById('profile-username-small');
    const viewFullnameEl = document.getElementById('view-fullname');

    if (fullnameEl) fullnameEl.textContent = newFullName || user.username;
    if (usernameSmallEl) {
        if (newFullName) {
            usernameSmallEl.textContent = '@' + user.username;
            usernameSmallEl.hidden = false;
        } else {
            usernameSmallEl.hidden = true;
        }
    }
    if (viewFullnameEl) viewFullnameEl.textContent = newFullName || i18n.not_specified || 'Not specified';

    DOM.initials.textContent = user.username.slice(0, 1).toUpperCase();

    const viewLang = document.getElementById('view-lang');
    setCodeTag(viewLang, user.lang, LANGUAGES[user.lang] ? LANGUAGES[user.lang].name : '', i18n.not_specified || 'Not specified');

    const viewGeo = document.getElementById('view-geo');
    setCodeTag(viewGeo, user.geo_code, COUNTRIES[user.geo_code] ? COUNTRIES[user.geo_code].name : '', i18n.not_specified || 'Not specified');

    lockGeoField(user.geo_code);
}

function lockGeoField(geoCode) {
    const code = String(geoCode || '').trim();
    if (!code) return;
    const geoSelectEdit = document.getElementById('edit-geo');
    if (!geoSelectEdit) return;
    const wrapper = geoSelectEdit.closest('.form-group');
    if (!wrapper) return;
    const geoInfo = COUNTRIES[code] || null;
    wrapper.textContent = '';
    const label = document.createElement('label');
    label.textContent = i18n.location || 'Location';
    wrapper.appendChild(label);
    const readonly = document.createElement('div');
    readonly.className = 'readonly-field';
    const span = document.createElement('span');
    setCodeTag(span, code, geoInfo ? geoInfo.name : '', '');
    readonly.appendChild(span);
    const hint = document.createElement('small');
    hint.className = 'hint';
    hint.textContent = i18n.location_locked || 'Location cannot be changed after it is set';
    readonly.appendChild(hint);
    wrapper.appendChild(readonly);
}

async function saveProfile() {
    const data = {};
    const fields = {
        first_name: document.getElementById('edit-first-name'),
        last_name: document.getElementById('edit-last-name'),
        username: document.getElementById('edit-username'),
        bio: document.getElementById('edit-bio'),
        lang: document.getElementById('edit-lang'),
    };
    for (const [key, el] of Object.entries(fields)) {
        if (el) data[key] = el.value.trim();
    }
    const geoEl = document.getElementById('edit-geo');
    const sentGeoCode = geoEl ? geoEl.value.trim() : '';
    if (sentGeoCode) data.geo_code = sentGeoCode;

    if (!data.first_name) {
        showToast(i18n.first_name_required || 'First name is required', 'error');
        const firstNameEl = document.getElementById('edit-first-name');
        if (firstNameEl) firstNameEl.focus();
        return;
    }

    DOM.saveBtn.disabled = true;
    const originalHtml = DOM.saveBtn.innerHTML;
    DOM.saveBtn.innerHTML = `<span class="spinner"></span> ${i18n.saving || 'Saving...'}`;

    try {
        const res = await fetch('/profile/me', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            const message = (err && err.code && i18n[err.code])
                || (err && typeof err.detail === 'string' && err.detail)
                || i18n.update_failed || 'Update failed';
            showToast(message, 'error');
            return;
        }
        const result = await res.json();
        updateViewFromResult(result);
        if (sentGeoCode) lockGeoField(sentGeoCode);
        showToast(i18n.profile_updated || 'Profile updated successfully!', 'success');
        DOM.cancelBtn.click();
    } catch (err) {
        showToast((i18n.error || 'Error') + ': ' + err.message, 'error');
    } finally {
        DOM.saveBtn.disabled = false;
        DOM.saveBtn.innerHTML = originalHtml;
    }
}

function enterEditMode() {
    DOM.viewMode.classList.add('hidden-view');
    DOM.viewMode.setAttribute('aria-hidden', 'true');
    DOM.editMode.classList.add('visible');
    DOM.editMode.removeAttribute('aria-hidden');
    DOM.actionsView.classList.add('is-hidden');
    DOM.actionsEdit.classList.remove('is-hidden');
    DOM.avatarEditBtn.classList.add('is-visible');
}

function exitEditMode() {
    DOM.viewMode.classList.remove('hidden-view');
    DOM.viewMode.removeAttribute('aria-hidden');
    DOM.editMode.classList.remove('visible');
    DOM.editMode.setAttribute('aria-hidden', 'true');
    DOM.actionsView.classList.remove('is-hidden');
    DOM.actionsEdit.classList.add('is-hidden');
    DOM.avatarEditBtn.classList.remove('is-visible');
}

export function bindEditMode() {
    DOM.editMode.setAttribute('aria-hidden', 'true');

    DOM.editBtn.addEventListener('click', async () => {
        enterEditMode();
        await loadProfile();
    });

    DOM.cancelBtn.addEventListener('click', exitEditMode);

    DOM.saveBtn.addEventListener('click', saveProfile);
}

export async function refreshProfileView() {
    try {
        const res = await fetch('/profile/me');
        if (!res.ok) return;
        const user = await res.json();
        if (!user || typeof user !== 'object') return;
        if (typeof user.username === 'string') {
            const usernameEl = document.getElementById('view-username');
            if (usernameEl) usernameEl.textContent = user.username;
            if (DOM.initials) DOM.initials.textContent = user.username.slice(0, 1).toUpperCase();
        }
        if (typeof user.email === 'string') {
            const emailEl = document.getElementById('view-email');
            if (emailEl) emailEl.textContent = user.email;
        }
        if ('bio' in user) {
            const bioEl = document.getElementById('view-bio');
            if (bioEl) bioEl.textContent = user.bio || i18n.no_bio || 'No bio yet';
        }
        if ('first_name' in user || 'last_name' in user) {
            const newFullName = [user.first_name, user.last_name].filter(n => n && n.trim()).join(' ').trim();
            const fullnameEl = document.getElementById('profile-fullname');
            const viewFullnameEl = document.getElementById('view-fullname');
            const usernameSmallEl = document.getElementById('profile-username-small');
            if (fullnameEl) fullnameEl.textContent = newFullName || user.username || '';
            if (viewFullnameEl) viewFullnameEl.textContent = newFullName || i18n.not_specified || 'Not specified';
            if (usernameSmallEl) {
                if (newFullName) {
                    usernameSmallEl.textContent = '@' + (user.username || '');
                    usernameSmallEl.hidden = false;
                } else {
                    usernameSmallEl.hidden = true;
                }
            }
        }
        if (user.lang != null) {
            const viewLang = document.getElementById('view-lang');
            setCodeTag(viewLang, user.lang, LANGUAGES[user.lang] ? LANGUAGES[user.lang].name : '', i18n.not_specified || 'Not specified');
        }
        if (user.geo_code != null) {
            const viewGeo = document.getElementById('view-geo');
            const info = COUNTRIES[user.geo_code];
            setCodeTag(viewGeo, user.geo_code, info ? info.name : '', i18n.not_specified || 'Not specified');
        }
    } catch {
    }
}
