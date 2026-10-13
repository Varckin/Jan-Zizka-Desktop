const TOAST_MAX_VISIBLE = 4;

let _toastStack = null;

function ensureToastStack() {
    if (_toastStack && document.body.contains(_toastStack)) return _toastStack;
    _toastStack = document.createElement('div');
    _toastStack.className = 'toast-stack';
    _toastStack.setAttribute('aria-live', 'polite');
    _toastStack.setAttribute('aria-atomic', 'false');
    document.body.appendChild(_toastStack);
    return _toastStack;
}

function trimToastStack(stack) {
    const toasts = stack.querySelectorAll('.toast:not(.toast-exit)');
    if (toasts.length <= TOAST_MAX_VISIBLE) return;
    const excess = toasts.length - TOAST_MAX_VISIBLE;
    for (let i = 0; i < excess; i++) {
        const victim = toasts[i];
        if (victim && victim._toastDismiss) victim._toastDismiss();
    }
}

export function showToast(message, options = {}) {
    const {
        icon = '💬',
        duration = 3600,
        type = 'info',
    } = options;

    const stack = ensureToastStack();

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.style.setProperty('--toast-duration', `${duration}ms`);

    const iconEl = document.createElement('div');
    iconEl.className = 'toast__icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = icon;

    const body = document.createElement('div');
    body.className = 'toast__body';
    const title = document.createElement('div');
    title.className = 'toast__title';
    title.textContent = message;
    body.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast__close';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.textContent = '✕';

    const progress = document.createElement('div');
    progress.className = 'toast__progress';
    progress.setAttribute('aria-hidden', 'true');

    toast.appendChild(iconEl);
    toast.appendChild(body);
    toast.appendChild(closeBtn);
    toast.appendChild(progress);
    stack.appendChild(toast);

    void toast.offsetWidth;
    toast.classList.add('toast-enter');

    let dismissed = false;
    let idleTimeoutId = null;
    let removeTimeoutId = null;

    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        if (idleTimeoutId) clearTimeout(idleTimeoutId);
        toast.classList.remove('toast-enter', 'toast-visible');
        toast.classList.add('toast-exit');
        removeTimeoutId = setTimeout(() => {
            toast.remove();
            if (stack.children.length === 0) {
                stack.remove();
                if (_toastStack === stack) _toastStack = null;
            }
        }, 1000);
    };

    toast._toastDismiss = dismiss;
    closeBtn.addEventListener('click', dismiss);

    const onEnterEnd = (e) => {
        if (e.animationName !== 'toastLand') return;
        toast.removeEventListener('animationend', onEnterEnd);
        if (dismissed) return;
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-visible');
        idleTimeoutId = setTimeout(dismiss, duration);
    };
    toast.addEventListener('animationend', onEnterEnd);

    trimToastStack(stack);
    return dismiss;
}

export function toast(message, isError = false) {
    return showToast(message, {
        type: isError ? 'error' : 'info',
        icon: isError ? '⚠️' : '💬',
    });
}

export function dismissAllToasts() {
    if (!_toastStack) return;
    _toastStack.querySelectorAll('.toast:not(.toast-exit)').forEach(el => {
        if (el._toastDismiss) el._toastDismiss();
    });
}
