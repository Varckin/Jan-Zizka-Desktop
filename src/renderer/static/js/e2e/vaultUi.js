import * as vault from './vault.js';
import { toast } from './toast.js';
import { t, tf } from './utils.js';
import { DOM } from './dom.js';

const MODE_TEXT = {
    unlock: {
        title: () => t('e2e_vault_unlock_title', 'Unlock E2E'),
        text: () => t('e2e_vault_unlock_text', 'Enter your E2E passphrase to decrypt the keys stored on this device.'),
        submit: () => t('e2e_vault_unlock_btn', 'Unlock'),
    },
    setup: {
        title: () => t('e2e_vault_setup_title', 'Create E2E passphrase'),
        text: () => t('e2e_vault_setup_text', 'The passphrase encrypts your keys and decrypted messages on this device. It is never sent to the server and cannot be recovered.'),
        submit: () => t('e2e_vault_create_btn', 'Create'),
    },
    change: {
        title: () => t('e2e_vault_change_title', 'Change E2E passphrase'),
        text: () => '',
        submit: () => t('save', 'Save'),
    },
};

const STRENGTH_LABELS = [
    () => t('e2e_strength_weak', 'Weak'),
    () => t('e2e_strength_weak', 'Weak'),
    () => t('e2e_strength_fair', 'Fair'),
    () => t('e2e_strength_good', 'Good'),
    () => t('e2e_strength_strong', 'Strong'),
];

let _mode = 'unlock';
let _gateResolve = null;
let _gateDone = false;
let _strengthFn = null;
let _strengthTimer = null;
let _idleTimer = null;
let _lastArm = 0;
let _initialized = false;

function openOverlay(mode) {
    _mode = mode;
    const texts = MODE_TEXT[mode];
    DOM.vaultTitle.textContent = texts.title();
    DOM.vaultText.textContent = texts.text();
    DOM.vaultText.classList.toggle('is-hidden', !texts.text());
    DOM.vaultSubmit.textContent = texts.submit();
    DOM.vaultError.textContent = '';
    DOM.vaultPass.value = '';
    DOM.vaultConfirm.value = '';
    if (DOM.vaultCurrent) DOM.vaultCurrent.value = '';
    DOM.vaultCurrentField.classList.toggle('is-hidden', mode !== 'change');
    DOM.vaultConfirmField.classList.toggle('is-hidden', mode === 'unlock');
    DOM.vaultStrength.classList.toggle('is-hidden', mode === 'unlock');
    DOM.vaultCancel.classList.toggle('is-hidden', mode !== 'change');
    updateAttemptsLabel();
    setStrengthScore(-1);
    DOM.vaultOverlay.classList.remove('is-closing');
    DOM.vaultOverlay.classList.add('is-open');
    DOM.vaultCard.classList.remove('e2e-vault-card--shake');
    setTimeout(() => {
        const target = mode === 'change' ? DOM.vaultCurrent : DOM.vaultPass;
        target?.focus();
    }, 80);
}

function closeOverlay() {
    DOM.vaultOverlay.classList.add('is-closing');
    setTimeout(() => {
        DOM.vaultOverlay.classList.remove('is-open');
        DOM.vaultOverlay.classList.remove('is-closing');
    }, 220);
}

function updateAttemptsLabel() {
    if (_mode !== 'unlock') {
        DOM.vaultAttempts.textContent = '';
        return;
    }
    const used = vault.getAttempts();
    DOM.vaultAttempts.textContent = used > 0
        ? tf('e2e_vault_attempts_left', 'Attempts left: {n}', { n: String(vault.MAX_ATTEMPTS - used) })
        : '';
}

function shake(message) {
    DOM.vaultError.textContent = message;
    DOM.vaultCard.classList.remove('e2e-vault-card--shake');
    void DOM.vaultCard.offsetWidth;
    DOM.vaultCard.classList.add('e2e-vault-card--shake');
}

async function setStrengthScore(score) {
    const segments = DOM.vaultStrength.querySelectorAll('.e2e-vault-strength-seg');
    segments.forEach((seg, idx) => {
        seg.classList.toggle('is-on', score >= 0 && idx < score);
        for (let s = 0; s <= 4; s++) seg.classList.remove(`s${s}`);
        if (score >= 0 && idx < score) seg.classList.add(`s${score}`);
    });
    DOM.vaultStrengthLabel.textContent = score >= 0 ? STRENGTH_LABELS[Math.max(0, Math.min(4, score))]() : '';
}

async function loadStrengthFn() {
    if (_strengthFn) return _strengthFn;
    try {
        const mod = await import('../zxcvbn/index.js');
        _strengthFn = mod.passphraseScore;
    } catch (e) {
        console.warn('zxcvbn unavailable', e);
        _strengthFn = () => 0;
    }
    return _strengthFn;
}

function onPassInput() {
    if (_mode === 'unlock') return;
    clearTimeout(_strengthTimer);
    _strengthTimer = setTimeout(async () => {
        const value = DOM.vaultPass.value;
        if (!value) {
            setStrengthScore(-1);
            return;
        }
        const fn = await loadStrengthFn();
        setStrengthScore(fn(value));
    }, 200);
}

function validateSetup(pass, confirm) {
    if (pass.length < vault.MIN_PASSPHRASE_LENGTH) {
        shake(tf('e2e_vault_too_short', 'Minimum {n} characters', { n: String(vault.MIN_PASSPHRASE_LENGTH) }));
        return false;
    }
    if (pass !== confirm) {
        shake(t('e2e_vault_mismatch', 'Passphrases do not match'));
        return false;
    }
    return true;
}

async function handleSubmit(event) {
    event.preventDefault();
    const pass = DOM.vaultPass.value;
    DOM.vaultSubmit.disabled = true;
    try {
        if (_mode === 'unlock') {
            const ok = await vault.unlock(pass);
            if (ok) {
                DOM.vaultCard.classList.add('e2e-vault-card--success');
                setTimeout(() => {
                    DOM.vaultCard.classList.remove('e2e-vault-card--success');
                    closeOverlay();
                }, 260);
                finishGate();
                return;
            }
            const used = vault.bumpAttempts();
            if (used >= vault.MAX_ATTEMPTS) {
                vault.wipeAndReset();
                toast(t('e2e_vault_wiped', 'Too many failed attempts — local E2E data was erased'), true);
                openOverlay('setup');
                return;
            }
            updateAttemptsLabel();
            shake(tf('e2e_vault_wrong', 'Wrong passphrase. Attempts left: {n}', { n: String(vault.MAX_ATTEMPTS - used) }));
            DOM.vaultPass.value = '';
            DOM.vaultPass.focus();
            return;
        }
        const confirm = DOM.vaultConfirm.value;
        if (_mode === 'setup') {
            if (!validateSetup(pass, confirm)) return;
            await vault.setup(pass);
            closeOverlay();
            finishGate();
            return;
        }
        if (_mode === 'change') {
            const current = DOM.vaultCurrent.value;
            if (!validateSetup(pass, confirm)) return;
            const ok = await vault.changePassphrase(current, pass);
            if (!ok) {
                shake(t('e2e_vault_change_wrong', 'Current passphrase is wrong'));
                return;
            }
            closeOverlay();
            toast(t('e2e_vault_changed', 'Passphrase changed'));
        }
    } finally {
        DOM.vaultSubmit.disabled = false;
    }
}

function finishGate() {
    if (_gateDone) return;
    _gateDone = true;
    if (_gateResolve) {
        const resolve = _gateResolve;
        _gateResolve = null;
        resolve();
    }
}

export function gateVault() {
    vault.initChannel();
    return new Promise(resolve => {
        _gateResolve = resolve;
        _gateDone = false;
        if (!vault.hasVault()) {
            vault.wipeAll();
            openOverlay('setup');
        } else {
            openOverlay('unlock');
        }
        vault.on('unlocked', () => {
            if (_gateDone) return;
            if (DOM.vaultOverlay.classList.contains('is-open')) closeOverlay();
            finishGate();
        });
    });
}

function armIdle() {
    clearTimeout(_idleTimer);
    _idleTimer = null;
    const minutes = vault.getSettings().autoLockMinutes;
    if (!minutes || !vault.isUnlocked()) return;
    _idleTimer = setTimeout(() => {
        vault.lock();
    }, minutes * 60 * 1000);
}

function onActivity() {
    const now = Date.now();
    if (now - _lastArm < 1000) return;
    _lastArm = now;
    if (vault.isUnlocked()) armIdle();
}

function closeMenu() {
    DOM.vaultMenu.classList.remove('is-open');
    DOM.vaultBtn.setAttribute('aria-expanded', 'false');
}

function toggleMenu() {
    const open = DOM.vaultMenu.classList.toggle('is-open');
    DOM.vaultBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) syncMenuState();
}

function syncMenuState() {
    const minutes = vault.getSettings().autoLockMinutes;
    DOM.vaultMenu.querySelectorAll('[data-minutes]').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.minutes) === minutes);
    });
    DOM.vaultLockNow.disabled = !vault.isUnlocked();
    DOM.vaultChangePass.disabled = !vault.isUnlocked();
}

function renderSegments() {
    const wrap = DOM.vaultAutolockSegments;
    wrap.innerHTML = '';
    for (const minutes of vault.AUTOLOCK_CHOICES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.minutes = String(minutes);
        btn.textContent = minutes === 0
            ? t('e2e_vault_autolock_off', 'Off')
            : `${minutes} ${t('e2e_vault_min', 'min')}`;
        btn.setAttribute('role', 'menuitemradio');
        btn.addEventListener('click', () => {
            vault.setAutoLockMinutes(minutes);
            syncMenuState();
            armIdle();
        });
        wrap.appendChild(btn);
    }
}

function updateLockedIndicator() {
    DOM.vaultBtn?.classList.toggle('is-locked', !vault.isUnlocked());
}

export function initVaultUi() {
    if (_initialized) return;
    _initialized = true;

    DOM.vaultForm.addEventListener('submit', handleSubmit);
    DOM.vaultPass.addEventListener('input', onPassInput);
    DOM.vaultCancel.addEventListener('click', () => {
        if (_mode === 'change') closeOverlay();
    });

    DOM.vaultBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleMenu();
    });
    DOM.vaultMenu.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => closeMenu());
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeMenu();
    });

    renderSegments();
    DOM.vaultLockNow.addEventListener('click', () => {
        closeMenu();
        vault.lock();
    });
    DOM.vaultChangePass.addEventListener('click', () => {
        closeMenu();
        if (!vault.isUnlocked()) return;
        openOverlay('change');
    });

    vault.on('unlocked', () => {
        updateLockedIndicator();
        armIdle();
    });
    vault.on('locked', () => {
        clearTimeout(_idleTimer);
        updateLockedIndicator();
        if (_gateDone && !DOM.vaultOverlay.classList.contains('is-open')) {
            openOverlay('unlock');
        }
    });
    vault.on('reset', () => {
        if (_gateDone) location.reload();
    });

    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
        document.addEventListener(ev, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            _lastArm = 0;
            onActivity();
        }
    });

    updateLockedIndicator();
}
