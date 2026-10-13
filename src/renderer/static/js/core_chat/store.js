export function getCurrentUserId() {
    const userEl = document.getElementById('user-id');
    const fromHidden = parseInt(userEl?.textContent) || 0;
    if (fromHidden) return fromHidden;
    const e2eEl = document.getElementById('e2e-current-user');
    return parseInt(e2eEl?.dataset.id) || 0;
}

export function createEmitter() {
    const listeners = new Map();

    function on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
        return () => off(event, handler);
    }

    function once(event, handler) {
        const wrapped = (payload) => {
            off(event, wrapped);
            handler(payload);
        };
        return on(event, wrapped);
    }

    function off(event, handler) {
        listeners.get(event)?.delete(handler);
    }

    function emit(event, payload) {
        const set = listeners.get(event);
        if (!set) return;
        set.forEach(handler => {
            try {
                handler(payload);
            } catch (err) {
                console.error(err);
            }
        });
    }

    return { on, once, off, emit };
}
