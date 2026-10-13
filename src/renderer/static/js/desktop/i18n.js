const FLAGS = { en: 'EN', ru: 'RU', es: 'ES', de: 'DE' };
const NAMES = { en: 'English', ru: 'Русский', es: 'Español', de: 'Deutsch' };

function currentLang(switcher) {
    return switcher.dataset.current || document.documentElement.lang || 'en';
}

async function applyLocale(lang) {
    const next = window.location.pathname + window.location.search;
    try {
        await fetch(`/set-locale?lang=${encodeURIComponent(lang)}&next=${encodeURIComponent(next)}`, {
            redirect: 'manual',
        });
    } catch {
    }
    window.location.reload();
}

export function initLangSwitcher(root = document) {
    const switcher = root.querySelector('.lang-switcher');
    if (!switcher || switcher.dataset.desktopBound === '1') return;
    switcher.dataset.desktopBound = '1';

    const button = switcher.querySelector('#lang-switcher-button') || switcher.querySelector('.lang-switcher__button');
    const menu = switcher.querySelector('#lang-switcher-menu') || switcher.querySelector('.lang-switcher__menu');
    const currentFlag = switcher.querySelector('#lang-current-flag');
    const currentName = switcher.querySelector('#lang-current-name');
    const items = Array.from(switcher.querySelectorAll('.lang-switcher__item'));
    if (!button || !menu) return;

    let current = currentLang(switcher);
    let changing = false;

    const setCurrent = (lang, animate) => {
        const item = items.find(el => el.dataset.lang === lang) || items[0];
        if (!item) return;
        current = item.dataset.lang;
        switcher.dataset.current = current;
        if (currentFlag) currentFlag.textContent = FLAGS[current] || item.querySelector('.lang-switcher__flag').textContent;
        if (currentName) currentName.textContent = NAMES[current] || item.querySelector('.lang-switcher__name').textContent;
        items.forEach(el => el.classList.toggle('is-selected', el === item));
        if (animate) {
            switcher.classList.remove('just-changed');
            void switcher.offsetWidth;
            switcher.classList.add('just-changed');
        }
    };

    const open = () => {
        switcher.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
    };

    const close = () => {
        switcher.classList.remove('is-open');
        button.setAttribute('aria-expanded', 'false');
    };

    setCurrent(current, false);

    button.addEventListener('pointermove', e => {
        const rect = button.getBoundingClientRect();
        button.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
        button.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
    });

    button.addEventListener('click', e => {
        e.stopPropagation();
        if (changing) return;
        switcher.classList.contains('is-open') ? close() : open();
    });

    document.addEventListener('click', e => {
        if (!switcher.contains(e.target)) close();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') close();
    });

    items.forEach(item => {
        item.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                item.click();
            }
        });
        item.addEventListener('click', () => {
            if (changing) return;
            const lang = item.dataset.lang;
            if (lang === current) {
                close();
                return;
            }
            changing = true;
            setCurrent(lang, true);
            close();
            switcher.classList.add('is-changing');
            document.body.classList.add('lang-changing');
            const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 340;
            setTimeout(() => applyLocale(lang), delay);
        });
    });
}
