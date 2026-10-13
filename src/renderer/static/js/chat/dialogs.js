import { DOM, i18n } from './dom.js';
import { openModalFx, closeModalFx } from './modalFx.js';

let dialogCallback = null;
let dialogType = 'alert';
let viewerKeyHandler = null;

export function showDialog(message, type, callback, defaultValue = '') {
    dialogType = type;
    DOM.dialogMessage.textContent = message;
    DOM.dialogInput.value = defaultValue || '';
    if (type === 'prompt') { DOM.dialogInputArea.classList.remove('is-hidden'); DOM.dialogBtnCancel.classList.remove('is-hidden'); }
    else if (type === 'confirm') { DOM.dialogInputArea.classList.add('is-hidden'); DOM.dialogBtnCancel.classList.remove('is-hidden'); }
    else { DOM.dialogInputArea.classList.add('is-hidden'); DOM.dialogBtnCancel.classList.add('is-hidden'); }
    dialogCallback = callback;
    clearTimeout(dialogCloseTimer);
    DOM.dialogOverlay.classList.remove('is-closing');
    DOM.dialogOverlay.classList.remove('is-hidden');
    if (type === 'prompt') setTimeout(() => DOM.dialogInput.focus(), 100);
}

let dialogCloseTimer = null;

function closeDialog() {
    dialogCallback = null;
    DOM.dialogOverlay.classList.add('is-closing');
    clearTimeout(dialogCloseTimer);
    dialogCloseTimer = setTimeout(() => {
        DOM.dialogOverlay.classList.add('is-hidden');
        DOM.dialogOverlay.classList.remove('is-closing');
    }, 220);
}

DOM.dialogBtnOk.textContent = i18n.ok || 'OK';
DOM.dialogBtnCancel.textContent = i18n.cancel || 'Cancel';

DOM.dialogBtnOk.addEventListener('click', () => {
    if (dialogType === 'prompt') { if (dialogCallback) dialogCallback(DOM.dialogInput.value); }
    else if (dialogType === 'confirm') { if (dialogCallback) dialogCallback(true); }
    else { if (dialogCallback) dialogCallback(); }
    closeDialog();
});

DOM.dialogBtnCancel.addEventListener('click', () => {
    if (dialogType === 'prompt') { if (dialogCallback) dialogCallback(null); }
    else if (dialogType === 'confirm') { if (dialogCallback) dialogCallback(false); }
    closeDialog();
});

DOM.dialogInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') DOM.dialogBtnOk.click();
    else if (e.key === 'Escape') DOM.dialogBtnCancel.click();
});

DOM.dialogOverlay.addEventListener('click', e => {
    if (e.target === DOM.dialogOverlay) {
        if (dialogType === 'prompt' || dialogType === 'confirm') DOM.dialogBtnCancel.click();
        else closeDialog();
    }
});

export function showNotification(message) { return new Promise(resolve => showDialog(message, 'alert', resolve)); }
export function showConfirm(message) { return new Promise(resolve => showDialog(message, 'confirm', resolve)); }
export function showPrompt(message, defaultValue = '') { return new Promise(resolve => showDialog(message, 'prompt', resolve, defaultValue)); }

export function showLinkConfirm(url) {
    const intro = i18n.external_link_confirm || 'You are about to open an external link:';
    const question = i18n.external_link_question || 'Continue?';
    const message = `${intro}\n\n${url}\n\n${question}`;
    return new Promise(resolve => showDialog(message, 'confirm', resolve));
}

export function showMediaViewer(items, initialIndex = 0) {
    const valid = (items || []).filter(it => it && it.url);
    if (!valid.length) return;
    const modal = DOM.photoViewerModal;
    const img = DOM.photoViewerImg;
    const video = DOM.photoViewerVideo;
    const prevBtn = DOM.photoPrev;
    const nextBtn = DOM.photoNext;
    const counter = DOM.photoCounter;
    let currentIndex = Math.min(Math.max(0, initialIndex), valid.length - 1);

    function stopVideo() {
        if (!video) return;
        try { video.pause(); } catch { }
        video.removeAttribute('src');
        try { video.load(); } catch { }
    }

    function updateMedia() {
        const item = valid[currentIndex];
        counter.textContent = `${currentIndex + 1} / ${valid.length}`;
        prevBtn.style.display = valid.length > 1 ? 'inline-block' : 'none';
        nextBtn.style.display = valid.length > 1 ? 'inline-block' : 'none';
        if (item.kind === 'video') {
            img.classList.add('is-hidden');
            img.src = 'data:,';
            if (video) {
                video.classList.remove('is-hidden');
                video.src = item.url;
                const playPromise = video.play();
                if (playPromise && playPromise.catch) playPromise.catch(() => { });
            }
        } else {
            stopVideo();
            if (video) video.classList.add('is-hidden');
            img.classList.remove('is-hidden');
            img.src = item.url;
        }
    }

    function detachKeyHandler() {
        if (viewerKeyHandler) { document.removeEventListener('keydown', viewerKeyHandler); viewerKeyHandler = null; }
    }

    function hide() { stopVideo(); closeModalFx(modal); detachKeyHandler(); }

    function keyHandler(e) {
        if (e.key === 'Escape') hide();
        else if (e.key === 'ArrowLeft' && currentIndex > 0) { currentIndex--; updateMedia(); }
        else if (e.key === 'ArrowRight' && currentIndex < valid.length - 1) { currentIndex++; updateMedia(); }
    }

    function show() {
        updateMedia();
        openModalFx(modal);
        detachKeyHandler();
        viewerKeyHandler = keyHandler;
        document.addEventListener('keydown', viewerKeyHandler);
    }

    prevBtn.onclick = () => { if (currentIndex > 0) { currentIndex--; updateMedia(); } };
    nextBtn.onclick = () => { if (currentIndex < valid.length - 1) { currentIndex++; updateMedia(); } };
    DOM.photoViewerClose.onclick = hide;
    modal.onclick = e => { if (e.target === modal) hide(); };
    show();
}

export function showImageViewer(images, initialIndex = 0) {
    showMediaViewer((images || []).map(url => ({ kind: 'image', url })), initialIndex);
}
