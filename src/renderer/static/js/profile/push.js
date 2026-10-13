import { DOM, i18n } from './core.js';
import { showToast } from './toast.js';

export function bindPushToggle() {
    if (!DOM.pushToggle) return;
    DOM.pushToggle.addEventListener('change', async function() {
        const enabled = this.checked;
        try {
            const res = await fetch('/api/push/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
            });
            if (!res.ok) throw new Error('Failed to toggle');
            const ok = enabled ? await window.subscribeToPush() : await window.unsubscribeFromPush();
            if (!ok) throw new Error(enabled ? 'Push subscription failed' : 'Push unsubscribe failed');
            const msg = enabled ? i18n.push_enabled_toast : i18n.push_disabled_toast;
            showToast(msg || (enabled ? 'Push enabled' : 'Push disabled'), 'success');
        } catch (err) {
            showToast((i18n.error || 'Error') + ': ' + err.message, 'error');
            this.checked = !enabled;
        }
    });
}
