export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function setTextContent(container, message, className = '') {
    if (!container) return;
    container.innerHTML = '';
    const div = document.createElement('div');
    if (className) div.className = className;
    div.textContent = message;
    container.appendChild(div);
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function clampToViewport(x, y, width, height, margin = 5) {
    let cx = x;
    let cy = y;
    if (cx + width > window.innerWidth - margin) cx = window.innerWidth - width - margin;
    if (cy + height > window.innerHeight - margin) cy = window.innerHeight - height - margin;
    if (cx < margin) cx = margin;
    if (cy < margin) cy = margin;
    return { x: cx, y: cy };
}

export function insertAtCursor(input, text) {
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const value = input.value;
    input.value = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    input.selectionStart = input.selectionEnd = pos;
    input.focus();
}

export function animateRemoval(el, duration = 300) {
    if (!el || el.dataset.removing === '1') return;
    el.dataset.removing = '1';
    const height = el.offsetHeight;
    el.style.maxHeight = height + 'px';
    el.style.overflow = 'hidden';
    requestAnimationFrame(() => {
        el.classList.add('removing');
    });
    setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, duration);
}
