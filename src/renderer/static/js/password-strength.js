(function() {
    let warned = false;
    let zxcvbnInstance = null;

    function createMeter(input) {
        const meter = document.createElement('div');
        meter.className = 'password-strength-meter';
        meter.innerHTML = '<div class="strength-bar"><div class="strength-bar-fill"></div></div><div class="strength-text"></div><div class="strength-feedback"></div>';
        const anchor = input.closest('.password-field') || input;
        anchor.parentNode.insertBefore(meter, anchor.nextSibling);
        return meter;
    }

    function updateStrength(input, meter) {
        const password = input.value || '';
        const fill = meter.querySelector('.strength-bar-fill');
        const text = meter.querySelector('.strength-text');
        const feedback = meter.querySelector('.strength-feedback');
        if (password.length === 0) {
            fill.classList.remove('s0', 's1', 's2', 's3', 's4');
            fill.style.removeProperty('--strength-width');
            text.className = 'strength-text';
            text.textContent = '';
            feedback.textContent = '';
            return;
        }
        if (typeof zxcvbnts === 'undefined' || !zxcvbnts.core || !zxcvbnts['language-en'] || !zxcvbnts['language-common']) {
            if (!warned) {
                console.warn('zxcvbn-ts is not available, password strength meter disabled');
                warned = true;
            }
            return;
        }
        if (!zxcvbnInstance) {
            zxcvbnInstance = new zxcvbnts.core.ZxcvbnFactory({
                translations: zxcvbnts['language-en'].translations,
                graphs: zxcvbnts['language-common'].adjacencyGraphs,
                dictionary: { ...zxcvbnts['language-common'].dictionary, ...zxcvbnts['language-en'].dictionary },
            });
        }
        const result = zxcvbnInstance.check(password);
        const score = result.score;
        const levels = ['Very weak', 'Weak', 'Medium', 'Strong', 'Very strong'];
        fill.classList.remove('s0', 's1', 's2', 's3', 's4');
        fill.classList.add('s' + score);
        fill.style.setProperty('--strength-width', ((score + 1) / 5 * 100) + '%');
        text.className = 'strength-text s' + score;
        text.textContent = levels[score] || levels[0];
        let feedbackText = '';
        if (result.feedback.warning) feedbackText += '⚠️ ' + result.feedback.warning;
        if (result.feedback.suggestions && result.feedback.suggestions.length) feedbackText += ' 💡 ' + result.feedback.suggestions.join(' ');
        feedback.textContent = feedbackText;
    }

    function init() {
        document.querySelectorAll('input[data-password-strength]').forEach(input => {
            const anchor = input.closest('.password-field') || input;
            if (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('password-strength-meter')) return;
            const meter = createMeter(input);
            input.addEventListener('input', () => updateStrength(input, meter));
            if (input.value) updateStrength(input, meter);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
