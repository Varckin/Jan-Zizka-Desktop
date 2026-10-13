import { bindEditMode } from './edit.js';
import { bindAvatar } from './avatar.js';
import { bindPasswordModal } from './password.js';
import { bindEmailChange } from './emailChange.js';
import { initSessions } from './sessions.js';
import { bindPushToggle } from './push.js';
import { bindPrivacySettings } from './privacy.js';

export function init() {
    bindEditMode();
    bindAvatar();
    bindPasswordModal();
    bindEmailChange();
    initSessions();
    bindPushToggle();
    bindPrivacySettings();
}
