let globalGuardBound = false;

function isFileDrag(e) {
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
}

function bindGlobalGuard() {
    if (globalGuardBound) return;
    globalGuardBound = true;
    document.addEventListener('dragover', e => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'none';
    }, false);
    document.addEventListener('drop', e => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
    }, false);
}

function createOverlay(label) {
    const overlay = document.createElement('div');
    overlay.className = 'file-drop-overlay';
    const badge = document.createElement('div');
    badge.className = 'file-drop-badge';
    badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M20 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/></svg>';
    const text = document.createElement('span');
    text.className = 'file-drop-text';
    text.textContent = label;
    badge.appendChild(text);
    overlay.appendChild(badge);
    return overlay;
}

export function initFileDropZone(options) {
    const { zone, label, canDrop, onBlocked, onFiles } = options;
    bindGlobalGuard();
    if (!zone) return;

    let overlay = null;
    let depth = 0;

    function allowed() {
        return canDrop ? canDrop() : null;
    }

    function activate() {
        if (overlay) return;
        overlay = createOverlay(label || '');
        zone.appendChild(overlay);
    }

    function deactivate() {
        depth = 0;
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
    }

    zone.addEventListener('dragenter', e => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        depth += 1;
        if (allowed() === null) activate();
    }, false);

    zone.addEventListener('dragover', e => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        if (allowed() === null) activate();
    }, false);

    zone.addEventListener('dragleave', e => {
        if (!isFileDrag(e)) return;
        depth = Math.max(0, depth - 1);
        if (depth === 0) deactivate();
    }, false);

    zone.addEventListener('drop', e => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        deactivate();
        const files = Array.from(e.dataTransfer.files || []);
        if (!files.length) return;
        const blocked = allowed();
        if (blocked) {
            if (onBlocked) onBlocked(blocked);
            return;
        }
        onFiles(files);
    }, false);
}
