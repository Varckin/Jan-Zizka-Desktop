import { bindLoginForm, bindRegisterForm } from './forms.js';
import { bindVerifyForm, bindResendLink, bindCodeAutoSubmit } from './verify.js';
import { bindRipples, bindSwitchLinks } from './effects.js';
import { switchMode } from './mode.js';

export function init() {
    bindLoginForm();
    bindRegisterForm();
    bindVerifyForm();
    bindResendLink();
    bindCodeAutoSubmit();
    bindRipples();
    bindSwitchLinks();
    window.addEventListener('popstate', () => {
        const mode = new URLSearchParams(window.location.search).get('mode') || 'login';
        switchMode(mode, false, false);
    });
}
