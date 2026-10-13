import { EMOJI_CATEGORIES } from './constants.js';
import { insertAtCursor, clampToViewport } from './dom.js';
import { t } from './format.js';

const hasHover = () =>
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export function createEmojiPicker(config) {
    const {
        button,
        popup,
        grid,
        input,
        emojis = null,
        categories = null,
        itemClass = 'emoji-item',
        onPick,
        openDelay = 90,
        closeDelay = 260,
        hitboxPad = 28,
        popupWidth = 320,
    } = config;

    let visible = false;
    let openTimer = null;
    let closeTimer = null;
    let hideTimeout = null;
    const mouse = { x: -1, y: -1 };

    function resolveCategories() {
        if (Array.isArray(categories) && categories.length > 0) return categories;
        if (Array.isArray(emojis) && emojis.length > 0) {
            return [{ id: 'all', icon: '😀', fallback: 'Emoji', emojis }];
        }
        return EMOJI_CATEGORIES;
    }

    function buildGrid() {
        if (!grid || grid.children.length > 0) return;
        const cats = resolveCategories();
        grid.classList.remove('emoji-popup-content');
        grid.classList.add('emoji-picker-root');

        const tabs = document.createElement('div');
        tabs.className = 'emoji-categories';
        const sections = document.createElement('div');
        sections.className = 'emoji-sections';
        const tabButtons = [];

        function setActiveTab(id) {
            tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.cat === id));
        }

        cats.forEach(cat => {
            const label = t('emoji_cat_' + cat.id, cat.fallback || cat.id);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'emoji-cat-btn';
            btn.dataset.cat = cat.id;
            btn.textContent = cat.icon || '😀';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const section = sections.querySelector(`.emoji-section[data-cat="${cat.id}"]`);
                if (!section) return;
                setActiveTab(cat.id);
                const top = Math.max(0, section.offsetTop - tabs.offsetHeight - 8);
                try {
                    popup.scrollTo({ top, behavior: 'smooth' });
                } catch {
                    popup.scrollTop = top;
                }
            });
            tabs.appendChild(btn);
            tabButtons.push(btn);

            const section = document.createElement('div');
            section.className = 'emoji-section';
            section.dataset.cat = cat.id;

            const title = document.createElement('div');
            title.className = 'emoji-section-title';
            title.textContent = label;
            section.appendChild(title);

            const cell = document.createElement('div');
            cell.className = 'emoji-popup-content';
            for (const emoji of (cat.emojis || [])) {
                const span = document.createElement('span');
                span.className = itemClass;
                span.textContent = emoji;
                span.addEventListener('click', (e) => {
                    e.stopPropagation();
                    pick(emoji);
                });
                cell.appendChild(span);
            }
            section.appendChild(cell);
            sections.appendChild(section);
        });

        popup.addEventListener('scroll', () => {
            const offset = popup.scrollTop + tabs.offsetHeight + 16;
            let currentId = null;
            sections.querySelectorAll('.emoji-section').forEach(section => {
                if (section.offsetTop <= offset) currentId = section.dataset.cat;
            });
            if (currentId) setActiveTab(currentId);
        });

        grid.appendChild(tabs);
        grid.appendChild(sections);
        if (tabButtons.length > 0) tabButtons[0].classList.add('active');
    }

    function pick(emoji) {
        insertAtCursor(input, emoji);
        if (typeof onPick === 'function') onPick(emoji);
        hide();
    }

    function position() {
        const rect = button.getBoundingClientRect();
        const width = Math.min(popupWidth, window.innerWidth - 20);
        popup.style.width = width + 'px';
        popup.classList.remove('is-hidden');
        popup.style.visibility = 'hidden';
        const height = popup.offsetHeight;
        popup.style.visibility = '';

        let left = rect.right - width;
        let top = rect.top - height - 10;
        if (top < 10) top = rect.bottom + 10;
        const clamped = clampToViewport(left, top, width, height, 10);
        popup.style.left = clamped.x + 'px';
        popup.style.top = clamped.y + 'px';
    }

    function clearTimers() {
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    }

    function getHitbox() {
        if (!button || !popup) return null;
        const b = button.getBoundingClientRect();
        const p = popup.getBoundingClientRect();
        return {
            left: Math.min(b.left, p.left) - hitboxPad,
            right: Math.max(b.right, p.right) + hitboxPad,
            top: Math.min(b.top, p.top) - hitboxPad,
            bottom: Math.max(b.bottom, p.bottom) + hitboxPad,
        };
    }

    function isInsideHitbox(x, y) {
        const box = getHitbox();
        if (!box) return false;
        return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    }

    function scheduleCloseCheck() {
        if (closeTimer) return;
        closeTimer = setTimeout(() => {
            closeTimer = null;
            if (!visible) return;
            if (isInsideHitbox(mouse.x, mouse.y)) return;
            hide();
        }, closeDelay);
    }

    function onGlobalMouseMove(e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        if (!visible) return;
        if (isInsideHitbox(e.clientX, e.clientY)) {
            clearTimers();
            return;
        }
        scheduleCloseCheck();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') hide();
    }

    function onPointerDown(e) {
        if (popup.contains(e.target)) return;
        if (button.contains(e.target)) return;
        hide();
    }

    function onResize() {
        if (visible) hide();
    }

    function onScroll(e) {
        if (popup.contains(e.target)) return;
        if (visible) hide();
    }

    function attachGlobalListeners() {
        document.addEventListener('mousemove', onGlobalMouseMove);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onScroll, true);
    }

    function detachGlobalListeners() {
        document.removeEventListener('mousemove', onGlobalMouseMove);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('scroll', onScroll, true);
    }

    function show() {
        clearTimers();
        if (visible) return;
        buildGrid();
        position();
        requestAnimationFrame(() => popup.classList.add('show'));
        visible = true;
        attachGlobalListeners();
    }

    function hide() {
        clearTimers();
        if (!visible) return;
        visible = false;
        popup.classList.remove('show');
        detachGlobalListeners();
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => {
            hideTimeout = null;
            if (!visible) popup.classList.add('is-hidden');
        }, 220);
    }

    function toggle() {
        if (visible) hide();
        else show();
    }

    function scheduleOpen() {
        clearTimers();
        if (visible) return;
        openTimer = setTimeout(() => {
            openTimer = null;
            if (button.matches(':hover')) show();
        }, openDelay);
    }

    function cancelScheduledOpen() {
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    }

    function init() {
        if (!button || !popup) return api;

        if (hasHover()) {
            button.addEventListener('mouseenter', scheduleOpen);
            button.addEventListener('mouseleave', cancelScheduledOpen);
            popup.addEventListener('mouseenter', clearTimers);
            popup.addEventListener('mouseleave', scheduleCloseCheck);
        }

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });

        return api;
    }

    const api = {
        init,
        show,
        hide,
        toggle,
        isVisible: () => visible,
    };
    return api;
}
