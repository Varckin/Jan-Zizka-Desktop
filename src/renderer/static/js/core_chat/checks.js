const SVG_NS = 'http://www.w3.org/2000/svg';

const TICK_FIRST_D = 'M1.6 6.2 L4.7 9.3 L10.7 2.7';
const TICK_SECOND_D = 'M7 6.2 L10.1 9.3 L16.1 2.7';

const CHECKS_SELECTOR = '.msg-checks';

export function createMsgChecks(isRead) {
    const wrap = document.createElement('span');
    wrap.className = isRead ? 'msg-checks is-read' : 'msg-checks';
    wrap.setAttribute('aria-hidden', 'true');

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'msg-checks__svg');
    svg.setAttribute('viewBox', '0 0 18 12');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '12');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');

    const first = document.createElementNS(SVG_NS, 'path');
    first.setAttribute('class', 'msg-checks__tick msg-checks__tick--first');
    first.setAttribute('d', TICK_FIRST_D);

    const second = document.createElementNS(SVG_NS, 'path');
    second.setAttribute('class', 'msg-checks__tick msg-checks__tick--second');
    second.setAttribute('d', TICK_SECOND_D);

    svg.appendChild(first);
    svg.appendChild(second);
    wrap.appendChild(svg);
    return wrap;
}

export function findMsgChecks(root) {
    if (!root) return null;
    if (root.matches && root.matches(CHECKS_SELECTOR)) return root;
    return root.querySelector ? root.querySelector(CHECKS_SELECTOR) : null;
}

export function setMsgChecksRead(el, isRead = true) {
    if (!el) return false;
    const next = !!isRead;
    if (el.classList.contains('is-read') === next) return false;
    el.classList.toggle('is-read', next);
    return true;
}

export function markMsgChecksRead(root, isRead = true) {
    return setMsgChecksRead(findMsgChecks(root), isRead);
}
