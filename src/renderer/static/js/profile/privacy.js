import { DOM, i18n } from './core.js';
import { showToast } from './toast.js';

const PRIVACY_CONTROLS = [
    { el: () => DOM.lastSeenSelect, field: 'last_seen' },
    { el: () => DOM.whoCanMessageSelect, field: 'who_can_message' },
];

export function bindPrivacySettings() {
    PRIVACY_CONTROLS.forEach(({ el, field }) => {
        const select = el();
        if (!select) return;
        select.dataset.value = select.value;
        select.addEventListener('change', async function () {
            const value = this.value;
            try {
                const res = await fetch('/api/privacy', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [field]: value }),
                });
                if (!res.ok) throw new Error('Failed to save');
                this.dataset.value = value;
                showToast(i18n.privacy_updated || 'Privacy settings updated', 'success');
            } catch (err) {
                this.value = this.dataset.value;
                showToast((i18n.error || 'Error') + ': ' + err.message, 'error');
            }
        });
    });
}
