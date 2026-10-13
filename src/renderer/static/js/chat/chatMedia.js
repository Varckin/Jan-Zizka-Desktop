import { STATE } from './state.js';
import { i18n } from './dom.js';
import { t, formatFileSize } from './format.js';
import * as API from './api.js';
import { showMediaViewer, showNotification } from './dialogs.js';
import { scrollToMessage } from './chatMessages.js';
import { closeModalFx } from './modalFx.js';
import { nicknameByUsername } from './contacts.js';

const STAGGER_CAP = 14;
const CHAT_SWITCH_WAIT_MS = 600;

const ICON_IMAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
const ICON_VIDEO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';
const ICON_AUDIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const ICON_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const ICON_GO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>';

const CATEGORIES = [
    { key: 'image', icon: ICON_IMAGE, labelKey: 'attachments_images', fallback: 'Photos' },
    { key: 'video', icon: ICON_VIDEO, labelKey: 'attachments_videos', fallback: 'Videos' },
    { key: 'audio', icon: ICON_AUDIO, labelKey: 'attachments_audio', fallback: 'Audio' },
    { key: 'document', icon: ICON_DOC, labelKey: 'attachments_documents', fallback: 'Documents' },
];

function applyStagger(el, idx) {
    el.style.setProperty('--i', String(Math.min(idx, STAGGER_CAP)));
    el.addEventListener('animationend', () => { el.style.animation = 'none'; }, { once: true });
}

function attachmentName(item) {
    return item.file_name || String(item.file_url || '').split('/').pop() || '';
}

function attachmentSenderLabel(item) {
    const nickname = nicknameByUsername(item.sender_username);
    if (nickname) return nickname;
    const full = [item.sender_first_name, item.sender_last_name]
        .filter(n => n && String(n).trim())
        .join(' ')
        .trim();
    return full || item.sender_username || '';
}

function formatFullTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
    if (sameDay) return `${t('today', 'Today')} · ${hm}`;
    const datePart = d.toLocaleDateString(
        undefined,
        d.getFullYear() === now.getFullYear()
            ? { day: 'numeric', month: 'short' }
            : { day: 'numeric', month: 'short', year: 'numeric' }
    );
    return `${datePart}, ${hm}`;
}

function buildMetaText(item) {
    const parts = [];
    const sender = attachmentSenderLabel(item);
    if (sender) parts.push(sender);
    const when = formatFullTime(item.created_at);
    if (when) parts.push(when);
    if (item.file_size) parts.push(formatFileSize(item.file_size));
    return parts.join(' · ');
}

function fileExtension(name) {
    const clean = String(name || '').split('/').pop();
    const dot = clean.lastIndexOf('.');
    if (dot < 0 || dot === clean.length - 1) return '';
    return clean.slice(dot + 1).toLowerCase().slice(0, 5);
}

async function goToMessage(ctx, messageId) {
    if (messageId == null) return;
    const modal = ctx.browserEl.closest ? ctx.browserEl.closest('.modal') : null;
    if (modal) closeModalFx(modal);
    if (ctx.chatId != null && ctx.chatId !== STATE.currentChatId) {
        const item = document.querySelector(`.chat-item[data-chat-id="${ctx.chatId}"]`);
        if (item) item.click();
        await new Promise(resolve => setTimeout(resolve, CHAT_SWITCH_WAIT_MS));
    }
    const found = await scrollToMessage(messageId);
    if (!found) showNotification(t('message_not_found', i18n.message_not_found || 'Message not found in this chat.'));
}

function createGoButton(ctx, item) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-media-action-btn';
    btn.title = t('go_to_message', 'Go to message');
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = ICON_GO;
    btn.addEventListener('click', e => {
        e.stopPropagation();
        goToMessage(ctx, item.message_id);
    });
    return btn;
}

function createDownloadButton(item) {
    const link = document.createElement('a');
    link.className = 'chat-media-action-btn';
    link.href = item.file_url;
    link.download = attachmentName(item);
    link.title = t('download_file', 'Download');
    link.setAttribute('aria-label', link.title);
    link.innerHTML = ICON_DOWNLOAD;
    link.addEventListener('click', e => e.stopPropagation());
    return link;
}

function buildImageGrid(items, ctx) {
    const grid = document.createElement('div');
    grid.className = 'chat-media-grid';
    const viewerItems = items.map(i => ({ kind: 'image', url: i.file_url, name: attachmentName(i) }));
    items.forEach((item, idx) => {
        const cell = document.createElement('div');
        cell.className = 'chat-media-thumb';
        cell.title = [attachmentName(item), buildMetaText(item)].filter(Boolean).join('\n');
        applyStagger(cell, idx);
        const img = document.createElement('img');
        img.src = item.file_url;
        img.alt = attachmentName(item);
        img.loading = 'lazy';
        cell.appendChild(img);
        const meta = document.createElement('div');
        meta.className = 'chat-media-thumb-meta';
        meta.textContent = buildMetaText(item);
        cell.appendChild(meta);
        const go = createGoButton(ctx, item);
        go.classList.add('chat-media-corner-btn');
        cell.appendChild(go);
        cell.addEventListener('click', () => showMediaViewer(viewerItems, idx));
        grid.appendChild(cell);
    });
    return grid;
}

function buildVideoGrid(items, ctx) {
    const grid = document.createElement('div');
    grid.className = 'chat-media-grid is-video';
    const viewerItems = items.map(i => ({ kind: 'video', url: i.file_url, name: attachmentName(i) }));
    items.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'chat-media-video';
        applyStagger(card, idx);
        const preview = document.createElement('video');
        preview.preload = 'metadata';
        preview.muted = true;
        preview.playsInline = true;
        preview.tabIndex = -1;
        preview.src = item.file_url;
        card.appendChild(preview);
        const play = document.createElement('span');
        play.className = 'chat-media-play';
        play.innerHTML = ICON_PLAY;
        card.appendChild(play);
        const info = document.createElement('div');
        info.className = 'chat-media-video-info';
        const name = document.createElement('div');
        name.className = 'chat-media-video-name';
        name.textContent = attachmentName(item);
        info.appendChild(name);
        const meta = document.createElement('div');
        meta.className = 'chat-media-video-meta';
        meta.textContent = buildMetaText(item);
        info.appendChild(meta);
        card.appendChild(info);
        const go = createGoButton(ctx, item);
        go.classList.add('chat-media-corner-btn');
        card.appendChild(go);
        card.addEventListener('click', () => showMediaViewer(viewerItems, idx));
        grid.appendChild(card);
    });
    return grid;
}

function buildAudioList(items, ctx) {
    const list = document.createElement('div');
    list.className = 'chat-media-list';
    items.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'chat-media-audio';
        applyStagger(row, idx);
        const icon = document.createElement('span');
        icon.className = 'chat-media-audio-icon';
        icon.innerHTML = ICON_AUDIO;
        row.appendChild(icon);
        const main = document.createElement('div');
        main.className = 'chat-media-audio-main';
        const name = document.createElement('div');
        name.className = 'chat-media-audio-name';
        name.textContent = attachmentName(item);
        name.title = attachmentName(item);
        main.appendChild(name);
        const meta = document.createElement('div');
        meta.className = 'chat-media-audio-meta';
        meta.textContent = buildMetaText(item);
        main.appendChild(meta);
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.src = item.file_url;
        main.appendChild(audio);
        row.appendChild(main);
        const actions = document.createElement('div');
        actions.className = 'chat-media-actions';
        actions.appendChild(createDownloadButton(item));
        actions.appendChild(createGoButton(ctx, item));
        row.appendChild(actions);
        list.appendChild(row);
    });
    return list;
}

function buildDocumentList(items, ctx) {
    const list = document.createElement('div');
    list.className = 'chat-media-list';
    items.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'chat-media-file';
        applyStagger(row, idx);
        const ext = document.createElement('span');
        ext.className = 'chat-media-ext';
        const extLabel = fileExtension(attachmentName(item));
        ext.dataset.ext = extLabel;
        ext.textContent = extLabel || 'file';
        row.appendChild(ext);
        const main = document.createElement('div');
        main.className = 'chat-media-file-main';
        const name = document.createElement('div');
        name.className = 'chat-media-file-name';
        name.textContent = attachmentName(item);
        name.title = attachmentName(item);
        main.appendChild(name);
        const meta = document.createElement('div');
        meta.className = 'chat-media-file-meta';
        meta.textContent = buildMetaText(item);
        main.appendChild(meta);
        row.appendChild(main);
        const actions = document.createElement('div');
        actions.className = 'chat-media-actions';
        actions.appendChild(createDownloadButton(item));
        actions.appendChild(createGoButton(ctx, item));
        row.appendChild(actions);
        list.appendChild(row);
    });
    return list;
}

function buildCategoryPanel(key, items, ctx) {
    if (!items.length) {
        const none = document.createElement('div');
        none.className = 'chat-media-none';
        none.textContent = t('attachments_empty_cat', 'No files in this category yet');
        return none;
    }
    if (key === 'image') return buildImageGrid(items, ctx);
    if (key === 'video') return buildVideoGrid(items, ctx);
    if (key === 'audio') return buildAudioList(items, ctx);
    return buildDocumentList(items, ctx);
}

export async function mountChatMediaBrowser(sectionEl, browserEl, contentEl, chatId) {
    if (!sectionEl || !browserEl) return;
    sectionEl.dataset.chatId = String(chatId);
    sectionEl.classList.add('is-hidden');
    browserEl.innerHTML = '';
    if (contentEl) contentEl.classList.remove('has-media');

    let items;
    try {
        items = await API.fetchChatAttachments(chatId);
    } catch {
        return;
    }
    if (sectionEl.dataset.chatId !== String(chatId)) return;
    if (!Array.isArray(items) || items.length === 0) return;

    const grouped = {};
    for (const cat of CATEGORIES) grouped[cat.key] = [];
    for (const item of items) {
        if (grouped[item.file_type]) grouped[item.file_type].push(item);
        else grouped.document.push(item);
    }

    const ctx = { browserEl, chatId };
    browserEl.innerHTML = '';
    const rail = document.createElement('div');
    rail.className = 'chat-media-rail';
    const panel = document.createElement('div');
    panel.className = 'chat-media-panel';
    const buttons = [];

    const selectCategory = (key) => {
        buttons.forEach(b => b.classList.toggle('is-active', b.dataset.cat === key));
        panel.innerHTML = '';
        panel.appendChild(buildCategoryPanel(key, grouped[key] || [], ctx));
        panel.classList.remove('is-anim');
        void panel.offsetWidth;
        panel.classList.add('is-anim');
    };

    for (const cat of CATEGORIES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-media-cat';
        btn.dataset.cat = cat.key;
        const icon = document.createElement('span');
        icon.className = 'chat-media-cat-icon';
        icon.innerHTML = cat.icon;
        btn.appendChild(icon);
        const label = document.createElement('span');
        label.className = 'chat-media-cat-label';
        label.textContent = t(cat.labelKey, cat.fallback);
        btn.appendChild(label);
        const count = document.createElement('span');
        count.className = 'chat-media-cat-count';
        const n = (grouped[cat.key] || []).length;
        count.textContent = String(n);
        if (n === 0) count.classList.add('is-empty');
        btn.appendChild(count);
        btn.addEventListener('click', () => selectCategory(cat.key));
        buttons.push(btn);
        rail.appendChild(btn);
    }

    browserEl.append(rail, panel);
    sectionEl.classList.remove('is-hidden');
    if (contentEl) contentEl.classList.add('has-media');
    const first = CATEGORIES.find(c => (grouped[c.key] || []).length) || CATEGORIES[0];
    selectCategory(first.key);
}
