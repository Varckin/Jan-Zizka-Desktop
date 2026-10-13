import { STATE } from '../state.js';
import { DOM, i18n } from '../dom.js';
import { ALLOWED_FILE_TYPES } from '../constants.js';
import { validateFiles as coreValidateFiles, getFileIcon, formatFileSize } from '../../core_chat/files.js';
import { showNotification } from '../dialogs.js';

export function validateFiles(files) {
    const currentCount = STATE.selectedFiles ? STATE.selectedFiles.length : 0;
    const slots = Math.max(0, ALLOWED_FILE_TYPES.maxFiles - currentCount);
    return coreValidateFiles(files, ALLOWED_FILE_TYPES, slots);
}

export function processSelectedFiles(files, mode = 'replace') {
    const { valid, errors } = validateFiles(files);
    if (errors.length) showNotification(errors.join('\n'));
    if (valid.length === 0) {
        if (mode === 'replace') {
            STATE.selectedFiles = [];
            DOM.attachBtn.classList.remove('attach-active');
            DOM.filePreviewContainer.classList.add('is-hidden');
            DOM.filePreviewContainer.innerHTML = '';
        }
        return;
    }
    if (mode === 'replace') STATE.selectedFiles = valid;
    else {
        const combined = [...STATE.selectedFiles, ...valid];
        if (combined.length > ALLOWED_FILE_TYPES.maxFiles) {
            showNotification(`Maximum ${ALLOWED_FILE_TYPES.maxFiles} files allowed`);
            STATE.selectedFiles = combined.slice(0, ALLOWED_FILE_TYPES.maxFiles);
        } else STATE.selectedFiles = combined;
    }
    DOM.attachBtn.classList.add('attach-active');
    renderFilePreviews();
}

export function renderFilePreviews() {
    DOM.filePreviewContainer.innerHTML = '';
    STATE.selectedFiles.forEach((file, index) => {
        const icon = getFileIcon(file);
        const size = formatFileSize(file.size);
        const div = document.createElement('div');
        div.className = 'file-preview';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'file-icon';
        iconSpan.textContent = icon;
        div.appendChild(iconSpan);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.title = file.name;
        nameSpan.textContent = file.name;
        div.appendChild(nameSpan);
        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'file-size';
        sizeSpan.textContent = size;
        div.appendChild(sizeSpan);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-file';
        removeBtn.dataset.index = index;
        removeBtn.textContent = '✕';
        removeBtn.title = i18n.remove || 'Remove';
        removeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const idx = parseInt(this.dataset.index);
            STATE.selectedFiles.splice(idx, 1);
            if (STATE.selectedFiles.length === 0) {
                DOM.filePreviewContainer.classList.add('is-hidden');
                DOM.filePreviewContainer.innerHTML = '';
                DOM.attachBtn.classList.remove('attach-active');
                DOM.fileInput.value = '';
            } else renderFilePreviews();
        });
        div.appendChild(removeBtn);
        DOM.filePreviewContainer.appendChild(div);
    });
    DOM.filePreviewContainer.classList.remove('is-hidden');
}
