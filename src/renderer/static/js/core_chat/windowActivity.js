const listeners = new Set();

let desktopFocus = null;
let active = true;
let initialized = false;

function computeActive() {
    if (typeof document === 'undefined') return true;
    if (document.visibilityState !== 'visible') return false;
    if (desktopFocus === false) return false;
    return typeof document.hasFocus === 'function' ? document.hasFocus() : true;
}

function setActive(value) {
    const next = !!value;
    if (next === active) return;
    active = next;
    for (const cb of Array.from(listeners)) {
        try {
            cb(active);
        } catch { }
    }
}

function init() {
    if (initialized) return;
    initialized = true;
    active = computeActive();

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => setActive(computeActive()));
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('focus', () => setActive(computeActive()));
        window.addEventListener('blur', () => setActive(computeActive()));
    }
    if (typeof window !== 'undefined' && window.desktopAPI && typeof window.desktopAPI.on === 'function') {
        window.desktopAPI.on('desktop:focus-changed', focused => {
            desktopFocus = !!focused;
            setActive(computeActive());
        });
    }
}

export function isWindowActive() {
    init();
    return active;
}

export function onWindowActiveChange(callback) {
    init();
    if (typeof callback !== 'function') return () => { };
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}
