import { STATE } from './state.js';
import { DOM } from './dom.js';
import { t, findMessage, getPlaintextSnapshot, primePlaintextCache } from './utils.js';
import { renderMessages } from './render.js';

let debounceTimer = null;

function setSearchEmpty(container, text) {
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'e2e-search-empty';
    el.textContent = text;
    container.appendChild(el);
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx < 0) return escapeHtml(text);
    const before = escapeHtml(text.slice(0, idx));
    const match = escapeHtml(text.slice(idx, idx + q.length));
    const after = escapeHtml(text.slice(idx + q.length));
    return `${before}<mark>${match}</mark>${after}`;
}

function extractText(msg) {
    if (!msg) return '';
    if (msg.payload && typeof msg.payload.text === 'string') {
        return msg.payload.text;
    }
    if (typeof msg.text === 'string') {
        try {
            const parsed = JSON.parse(msg.text);
            if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
                return parsed.text;
            }
        } catch {}
        return msg.text;
    }
    return '';
}

function searchMessages(query) {
    const chatId = STATE.currentChatId;
    if (!chatId || !query.trim()) return { loaded: [], cached: [] };
    const q = query.trim().toLowerCase();
    const messages = STATE.messages[chatId] || [];
    const loaded = [];
    const seen = new Set();

    for (const m of messages) {
        if (m.deleted) continue;
        const text = extractText(m);
        if (typeof text !== 'string' || !text) continue;
        if (text.toLowerCase().includes(q)) {
            loaded.push({
                id: m.id,
                text,
                created_at: m.created_at,
                sender_id: m.sender_id,
                loaded: true,
            });
            seen.add(m.id);
        }
    }

    const cached = [];
    const cache = getPlaintextSnapshot(chatId);
    for (const [id, raw] of Object.entries(cache)) {
        const numId = Number(id);
        if (seen.has(numId)) continue;
        let text = '';
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
                text = parsed.text;
            } else if (typeof raw === 'string') {
                text = raw;
            }
        } catch {
            text = typeof raw === 'string' ? raw : '';
        }
        if (!text) continue;
        if (text.toLowerCase().includes(q)) {
            cached.push({
                id: numId,
                text,
                created_at: null,
                sender_id: null,
                loaded: false,
            });
        }
    }

    loaded.sort((a, b) => b.id - a.id);
    cached.sort((a, b) => b.id - a.id);
    return { loaded, cached };
}

function renderResults({ loaded, cached }, query) {
    const container = DOM.searchResults;
    if (!container) return;
    container.innerHTML = '';

    if (!query.trim()) {
        setSearchEmpty(container, t('e2e_search_hint', 'Start typing to search...'));
        return;
    }
    if (!loaded.length && !cached.length) {
        setSearchEmpty(container, t('e2e_no_results', 'No results'));
        return;
    }

    if (loaded.length) {
        const header = document.createElement('div');
        header.className = 'e2e-search-group-title';
        header.textContent = t('e2e_search_in_loaded', 'In loaded messages');
        container.appendChild(header);
        loaded.forEach(r => container.appendChild(buildItem(r, query, true)));
    }

    if (cached.length) {
        const header = document.createElement('div');
        header.className = 'e2e-search-group-title e2e-search-group-title--muted';
        header.textContent = t('e2e_search_older', 'Older messages');
        container.appendChild(header);
        cached.forEach(r => container.appendChild(buildItem(r, query, false)));
    }
}

function buildItem(result, query, clickable) {
    const item = document.createElement('div');
    item.className = 'e2e-search-item';
    item.dataset.msgId = result.id;
    if (!clickable) item.classList.add('e2e-search-item--disabled');

    const meta = document.createElement('div');
    meta.className = 'e2e-search-item-meta';
    meta.textContent = result.created_at
        ? new Date(result.created_at).toLocaleString([], {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit',
        })
        : '';
    item.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'e2e-search-item-body';
    body.innerHTML = highlight(result.text, query);
    item.appendChild(body);

    if (clickable) {
        item.addEventListener('click', () => goToMessage(result.id));
    } else {
        item.title = t('e2e_search_not_loaded',
            'Message is not in the loaded range. Scroll up in the chat to load older messages.');
    }
    return item;
}

async function goToMessage(msgId) {
    hideSearchModal();
    const chatId = STATE.currentChatId;
    if (!chatId) return;

    let el = document.querySelector(`.e2e-message[data-msg-id="${msgId}"]`);
    if (!el && findMessage(chatId, msgId)) {
        renderMessages(chatId);
        el = document.querySelector(`.e2e-message[data-msg-id="${msgId}"]`);
    }
    if (!el) return;

    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('e2e-message-highlight');
    setTimeout(() => el.classList.remove('e2e-message-highlight'), 2200);
}

function handleInput(e) {
    clearTimeout(debounceTimer);
    const q = e.target.value;
    debounceTimer = setTimeout(() => {
        renderResults(searchMessages(q), q);
    }, 160);
}

export function openSearchModal() {
    if (!STATE.currentChatId) return;
    if (!DOM.searchModal) return;
    DOM.searchModal.classList.add('is-open');
    if (DOM.searchInput) DOM.searchInput.value = '';
    primePlaintextCache(STATE.currentChatId).catch(() => {});
    if (DOM.searchResults) {
        setSearchEmpty(DOM.searchResults, t('e2e_search_hint', 'Start typing to search...'));
    }
    setTimeout(() => DOM.searchInput?.focus(), 80);
}

export function hideSearchModal() {
    if (!DOM.searchModal) return;
    DOM.searchModal.classList.remove('is-open');
}

export function initSearch() {
    if (!DOM.searchMsgBtn || !DOM.searchModal) return;
    DOM.searchMsgBtn.addEventListener('click', openSearchModal);
    DOM.searchInput?.addEventListener('input', handleInput);
    DOM.searchModal.addEventListener('click', e => {
        if (e.target === DOM.searchModal) hideSearchModal();
    });
    const closeBtn = DOM.searchModal.querySelector('[data-modal-close]');
    if (closeBtn) closeBtn.addEventListener('click', hideSearchModal);
}
