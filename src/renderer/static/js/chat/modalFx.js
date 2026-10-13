const CLOSE_ANIMATION_MS = 240;
const closeTimers = new WeakMap();

export function openModalFx(modal) {
    if (!modal) return;
    const timer = closeTimers.get(modal);
    if (timer) {
        clearTimeout(timer);
        closeTimers.delete(modal);
    }
    modal.classList.remove('is-closing');
    modal.classList.add('is-open');
}

export function closeModalFx(modal) {
    if (!modal) return;
    if (!modal.classList.contains('is-open') && !modal.classList.contains('is-closing')) return;
    modal.classList.remove('is-open');
    modal.classList.add('is-closing');
    const timer = setTimeout(() => {
        modal.classList.remove('is-closing');
        closeTimers.delete(modal);
    }, CLOSE_ANIMATION_MS);
    closeTimers.set(modal, timer);
}

export function isModalVisible(modal) {
    return !!modal && (modal.classList.contains('is-open') || modal.classList.contains('is-closing'));
}
