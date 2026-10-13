import { ALLOWED_FILE_TYPES } from './constants.js';
import { formatFileSize } from './format.js';

export { formatFileSize };

export function getFileKind(fileOrMime) {
    const mime = typeof fileOrMime === 'string'
        ? fileOrMime
        : (fileOrMime?.type || '');
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
}

const KIND_ICONS = { image: '🖼️', video: '🎥', audio: '🎵', document: '📄' };

export function getFileIcon(fileOrMime) {
    return KIND_ICONS[getFileKind(fileOrMime)] || '📎';
}

export function fileLabel(file) {
    if (!file) return '';
    const size = formatFileSize(file.size);
    return size ? `${file.name} · ${size}` : file.name;
}

export function validateFiles(files, rules = ALLOWED_FILE_TYPES, slotsLeft = null) {
    const valid = [];
    const errors = [];
    const slots = slotsLeft == null
        ? (rules.maxFiles ?? Infinity)
        : Math.max(0, slotsLeft);

    if (slots === 0) {
        errors.push(`Maximum ${rules.maxFiles} files allowed`);
        return { valid, errors };
    }

    let accepted = 0;
    for (const file of files) {
        if (accepted >= slots) {
            errors.push(`Only ${slots} more file(s) allowed, extra files skipped`);
            break;
        }
        if (rules.maxSize && file.size > rules.maxSize) {
            errors.push(`File "${file.name}" exceeds ${formatFileSize(rules.maxSize)}`);
            continue;
        }
        const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
        const mimeOk = (rules.mime || []).includes(file.type);
        const extOk = (rules.extensions || []).includes(ext);
        if (!mimeOk && !extOk) {
            errors.push(`File "${file.name}" has unsupported type`);
            continue;
        }
        valid.push(file);
        accepted++;
    }
    return { valid, errors };
}
