const VIEWS = ['chat', 'e2e', 'profile', 'settings'];

const state = {
    current: null,
    initialized: new Set(),
    activators: { chat: [], e2e: [], profile: [], settings: [] },
};

export function onView(name, handler) {
    if (!VIEWS.includes(name)) return;
    state.activators[name].push(handler);
}

export function switchView(name, options = {}) {
    if (!VIEWS.includes(name)) return;
    const previous = state.current;
    state.current = name;

    for (const view of VIEWS) {
        const el = document.getElementById(`view-${view}`);
        if (el) el.classList.toggle('is-active', view === name);
        const btn = document.getElementById(`rail-btn-${view}`);
        if (btn) btn.classList.toggle('is-active', view === name);
    }

    const scroller = document.getElementById(`view-${name}`);
    if (scroller) scroller.scrollTop = 0;

    const firstActivation = !state.initialized.has(name);
    state.initialized.add(name);

    for (const handler of state.activators[name]) {
        try {
            handler({ firstActivation, previous, options });
        } catch (err) {
            console.error('view activator error', name, err);
        }
    }
}

export function currentView() {
    return state.current;
}

function readInitialView() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('view');
    return VIEWS.includes(requested) ? requested : 'chat';
}

function bindRail() {
    for (const view of VIEWS) {
        const btn = document.getElementById(`rail-btn-${view}`);
        if (btn) {
            btn.addEventListener('click', () => switchView(view));
        }
    }
    const userBtn = document.getElementById('rail-user-btn');
    if (userBtn) userBtn.addEventListener('click', () => switchView('profile'));
}

function bindDesktopEvents() {
    if (!window.desktopAPI) return;
    window.desktopAPI.on('desktop:navigate', payload => {
        const target = payload || {};
        switchView(VIEWS.includes(target.view) ? target.view : 'chat', { navigate: target });
    });
}

function bindShortcuts() {
    document.addEventListener('keydown', event => {
        if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
        const map = { Digit1: 'chat', Digit2: 'e2e', Digit3: 'profile', Digit4: 'settings' };
        const view = map[event.code];
        if (view) {
            event.preventDefault();
            switchView(view);
        }
    });
}

export function init() {
    bindRail();
    bindDesktopEvents();
    bindShortcuts();
    switchView(readInitialView(), { initial: true });
}
