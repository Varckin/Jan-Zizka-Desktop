import { DOM, i18n, setTextContent } from '../dom.js';
import { sendGif } from '../chatMessages.js';
import { openModalFx, closeModalFx } from '../modalFx.js';

let gifSearchTimer = null;

export function initGifPicker() {
    DOM.gifBtn.addEventListener('click', () => {
        openModalFx(DOM.gifModal);
        DOM.gifSearchInput.value = '';
        setTextContent(DOM.gifSearchResults, i18n.search_gifs || 'Search for GIFs...', 'gif-empty');
        setTimeout(() => DOM.gifSearchInput.focus(), 100);
    });
    DOM.gifModalClose.addEventListener('click', closeGifModal);
    DOM.gifModal.addEventListener('click', e => { if (e.target === DOM.gifModal) closeGifModal(); });
    DOM.gifSearchInput.addEventListener('input', function() {
        clearTimeout(gifSearchTimer);
        const q = this.value.trim();
        gifSearchTimer = setTimeout(() => performGifSearch(q), 300);
    });
}

function closeGifModal() {
    closeModalFx(DOM.gifModal);
    clearTimeout(gifSearchTimer);
    gifSearchTimer = null;
}

async function performGifSearch(q) {
    if (q.length < 2) {
        setTextContent(DOM.gifSearchResults, i18n.search_gifs || 'Search for GIFs...', 'gif-empty');
        return;
    }
    try {
        const response = await fetch(`/chat/api/gifs/search?q=${encodeURIComponent(q)}&limit=20`, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch GIFs');
        const result = await response.json();
        const gifs = result.data || [];
        const container = DOM.gifSearchResults;
        container.innerHTML = '';
        if (gifs.length === 0) {
            setTextContent(container, i18n.no_gifs_found || 'No GIFs found', 'gif-empty');
            return;
        }
        gifs.forEach(gif => container.appendChild(buildGifItem(gif)));
    } catch (err) {
        console.error('GIF search error:', err);
        setTextContent(DOM.gifSearchResults, `${i18n.error || 'Error'}: ${err.message}`, 'gif-empty');
    }
}

function buildGifItem(gif) {
    const img = document.createElement('img');
    img.src = gif.preview || gif.original;
    img.alt = gif.title || 'GIF';
    img.className = 'gif-item';
    img.addEventListener('click', () => {
        const gifUrl = gif.original || gif.preview;
        if (!gifUrl) return;
        sendGif(gifUrl);
        closeGifModal();
    });
    return img;
}
