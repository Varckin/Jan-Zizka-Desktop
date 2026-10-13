import { clampToViewport } from './dom.js';

export function openMenuAt(menu, x, y, margin = 5) {
    if (!menu) return;
    menu.classList.remove('is-hidden');
    menu.style.display = 'block';
    menu.style.left = '0px';
    menu.style.top = '0px';
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const pos = clampToViewport(x, y, width, height, margin);
    menu.style.left = pos.x + 'px';
    menu.style.top = pos.y + 'px';
}

export function closeMenu(menu) {
    if (!menu) return;
    menu.style.display = 'none';
    menu.classList.add('is-hidden');
}

export function applyMenuVisibility(menu, visibility, itemSelector = '.context-menu-item') {
    if (!menu) return;
    for (const [action, visible] of Object.entries(visibility)) {
        const item = menu.querySelector(`[data-action="${action}"]`);
        if (!item) continue;
        item.classList.toggle('is-hidden', !visible);
        item.style.display = visible ? 'flex' : 'none';
    }
}

export function setMenuDanger(menu, action, danger) {
    if (!menu) return;
    const item = menu.querySelector(`[data-action="${action}"]`);
    if (!item) return;
    item.classList.toggle('danger', !!danger);
}

export function bindMenuAutoHide(menu, closeFn) {
    if (!menu) return () => {};

    const onDocClick = (e) => {
        if (menu.classList.contains('is-hidden')) return;
        if (!menu.contains(e.target)) closeFn();
    };
    const onScroll = () => closeFn();
    const onResize = () => closeFn();
    const onBlur = () => closeFn();

    document.addEventListener('click', onDocClick);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);

    return () => {
        document.removeEventListener('click', onDocClick);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('blur', onBlur);
    };
}
