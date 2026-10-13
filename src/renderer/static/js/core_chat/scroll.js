export function createScrollController(getEl, options = {}) {
    const { bottomThreshold = 80 } = options;
    let pinCancel = null;

    function isNearBottom() {
        const el = getEl();
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < bottomThreshold;
    }

    function scrollToBottom(smooth = false) {
        const el = getEl();
        if (!el) return;
        if (smooth) {
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        } else {
            el.scrollTop = el.scrollHeight;
        }
    }

    function scrollToBottomIfNear(smooth = false) {
        if (isNearBottom()) scrollToBottom(smooth);
    }

    function pinToBottom(maxMs = 600) {
        const el = getEl();
        if (!el) return;

        if (pinCancel) {
            pinCancel();
            pinCancel = null;
        }

        const start = performance.now();
        let cancelled = false;

        const onUserInteract = () => {
            cancelled = true;
            if (pinCancel) {
                pinCancel();
                pinCancel = null;
            }
        };

        el.addEventListener('wheel', onUserInteract);
        el.addEventListener('touchstart', onUserInteract);
        el.addEventListener('keydown', onUserInteract, { once: true });

        pinCancel = () => {
            cancelled = true;
            el.removeEventListener('wheel', onUserInteract);
            el.removeEventListener('touchstart', onUserInteract);
            el.removeEventListener('keydown', onUserInteract);
        };

        el.scrollTop = el.scrollHeight;

        const step = () => {
            if (cancelled) return;
            if (performance.now() - start > maxMs) {
                pinCancel = null;
                return;
            }
            el.scrollTop = el.scrollHeight;
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    function cancelPin() {
        if (pinCancel) {
            pinCancel();
            pinCancel = null;
        }
    }

    function preserveScrollOnPrepend(mutate) {
        const el = getEl();
        if (!el) return mutate();
        const prevHeight = el.scrollHeight;
        const prevTop = el.scrollTop;
        const result = mutate();
        requestAnimationFrame(() => {
            const delta = el.scrollHeight - prevHeight;
            if (delta > 0) el.scrollTop = prevTop + delta;
        });
        return result;
    }

    return {
        isNearBottom,
        scrollToBottom,
        scrollToBottomIfNear,
        pinToBottom,
        cancelPin,
        preserveScrollOnPrepend,
    };
}
