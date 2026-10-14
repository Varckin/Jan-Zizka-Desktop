import { STATE } from './state.js';
import { DOM, i18n } from './dom.js';
import * as API from './api.js';
import { showNotification, showConfirm } from './dialogs.js';
import { openModalFx, closeModalFx, isModalVisible } from './modalFx.js';
import { chatDisplayName } from './contacts.js';
import {
    FOLDER_ICON_NAMES,
    FOLDER_COLORS,
    ALL_CHATS_ICON_SVG,
    ADD_FOLDER_ICON_SVG,
    folderIconSvg,
} from './folderIcons.js';

const MAX_FOLDERS = 8;
const MAX_FOLDER_CHATS = 20;
const ADD_CHAT_RESULT_LIMIT = 20;
const ADD_CHAT_DEBOUNCE_MS = 250;
const MOBILE_BREAKPOINT_QUERY = '(max-width: 768px)';
const RAIL_RESIZE_DEBOUNCE_MS = 120;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 12;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_HOLD_MS = 250;
const DRAG_START_DISTANCE = 5;
const CLICK_SUPPRESS_MS = 300;
const DRAG_EDGE_SCROLL_PX = 28;
const WS_SYNC_SUPPRESS_MS = 1500;

const PIN_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const CLOSE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const CHEVRON_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
const SUBMENU_ROW_HEIGHT = 34;
const SUBMENU_MAX_HEIGHT = 264;
const SUBMENU_MIN_WIDTH = 180;

let modalFolderId = null;
let modalIcon = null;
let modalColor = null;
let addChatTimer = null;
let railResizeTimer = null;
let railPlacementBound = false;
let railLongPressTimer = null;
let railHoldTimer = null;
let dragCandidate = null;
let dragState = null;
let lastTapAt = 0;
let lastTapFolderId = null;
let railClickSuppressUntil = 0;
let lastLocalFolderSync = 0;
let touchPressActive = false;

export function findFolder(folderId) {
    if (folderId == null) return null;
    return STATE.folders.find(f => f.id === folderId) || null;
}

export function getActiveFolder() {
    return findFolder(STATE.activeFolderId);
}

export function folderChatOrder(folder) {
    if (!folder) return [];
    return sortedFolderItems(folder).map(item => item.chat_id);
}

export function sortedFolderItems(folder) {
    if (!folder || !Array.isArray(folder.items)) return [];
    return folder.items.slice().sort((a, b) => {
        const pinDiff = (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0);
        if (pinDiff !== 0) return pinDiff;
        if (a.is_pinned && b.is_pinned) {
            return (new Date(b.pinned_at || 0)) - (new Date(a.pinned_at || 0));
        }
        return (a.position || 0) - (b.position || 0);
    });
}

export function findFolderItem(folder, chatId) {
    if (!folder || !Array.isArray(folder.items)) return null;
    return folder.items.find(item => item.chat_id === chatId) || null;
}

export function isChatInActiveFolder(chatId) {
    const folder = getActiveFolder();
    return !!findFolderItem(folder, chatId);
}

export function isPinnedInActiveFolder(chatId) {
    const item = findFolderItem(getActiveFolder(), chatId);
    return !!(item && item.is_pinned);
}

export function filterChatsForFolderView(chats) {
    const folder = getActiveFolder();
    if (!folder) return chats;
    const byId = {};
    chats.forEach(chat => { byId[chat.id] = chat; });
    return folderChatOrder(folder).map(id => byId[id]).filter(Boolean);
}

export function initFolders() {
    if (!DOM.folderRail) return;
    DOM.folderRail.addEventListener('click', handleRailClick);
    DOM.folderRail.addEventListener('contextmenu', handleRailContextMenu);
    DOM.folderRail.addEventListener('pointerdown', handleRailPointerDown);
    DOM.folderRail.addEventListener('touchmove', handleRailTouchMove, { passive: false });
    window.addEventListener('pointermove', handleRailPointerMove);
    window.addEventListener('pointerup', handleRailPointerUp);
    window.addEventListener('pointercancel', handleRailPointerCancel);
    bindFolderModalEvents();
    applyRailPlacement();
    bindRailPlacementListeners();
    renderFolderRail();
    loadFolders(false);
}

function bindRailPlacementListeners() {
    if (railPlacementBound) return;
    railPlacementBound = true;
    const mq = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    if (mq.addEventListener) mq.addEventListener('change', applyRailPlacement);
    else if (mq.addListener) mq.addListener(applyRailPlacement);
    window.addEventListener('resize', () => {
        clearTimeout(railResizeTimer);
        railResizeTimer = setTimeout(applyRailPlacement, RAIL_RESIZE_DEBOUNCE_MS);
    });
    window.addEventListener('load', applyRailPlacement);
}

export function applyRailPlacement() {
    const rail = DOM.folderRail;
    if (!rail || !DOM.chatList) return;
    if (window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches) {
        rail.style.top = '';
        if (rail.parentNode !== DOM.chatList.parentNode || rail.nextElementSibling !== DOM.chatList) {
            DOM.chatList.parentNode.insertBefore(rail, DOM.chatList);
        }
    } else {
        if (DOM.chatApp && rail.parentNode !== DOM.chatApp) {
            DOM.chatApp.insertBefore(rail, DOM.chatApp.firstChild);
        }
        syncRailTop();
    }
}

function syncRailTop() {
    if (!DOM.folderRail || !DOM.chatList) return;
    DOM.folderRail.style.top = `${DOM.chatList.offsetTop}px`;
}

export async function loadFolders(rerenderChats = true) {
    try {
        const data = await API.fetchFolders();
        STATE.folders = (data && data.folders) || [];
    } catch (err) {
        console.error('Failed to load chat folders:', err);
    }
    if (STATE.activeFolderId != null && !findFolder(STATE.activeFolderId)) {
        STATE.activeFolderId = null;
    }
    renderFolderRail();
    if (modalFolderId != null && isModalVisible(DOM.folderModal)) {
        const modalFolder = findFolder(modalFolderId);
        if (modalFolder) renderFolderChats(modalFolder);
        else closeFolderModal();
    }
    if (rerenderChats) {
        const { loadChats } = await import('./chatList.js');
        loadChats(true);
    }
}

export function handleFoldersUpdated() {
    if (Date.now() - lastLocalFolderSync < WS_SYNC_SUPPRESS_MS) return;
    loadFolders(true);
}

export function renderFolderRail() {
    const rail = DOM.folderRail;
    if (!rail) return;
    const savedScrollTop = rail.scrollTop;
    rail.innerHTML = '';
    rail.classList.remove('is-hidden');
    const hasFolders = STATE.folders.length > 0;

    if (hasFolders) {
        const allTab = document.createElement('button');
        allTab.type = 'button';
        allTab.className = 'folder-tab folder-tab-all' + (STATE.activeFolderId == null ? ' active' : '');
        allTab.dataset.folderId = '';
        allTab.title = i18n.folders_all_chats || 'All chats';
        allTab.setAttribute('aria-label', allTab.title);
        allTab.innerHTML = `<span class="folder-tab-icon">${ALL_CHATS_ICON_SVG}</span>`;
        rail.appendChild(allTab);

        STATE.folders.forEach(folder => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'folder-tab' + (STATE.activeFolderId === folder.id ? ' active' : '');
            tab.dataset.folderId = folder.id;
            tab.title = folder.title;
            tab.setAttribute('aria-label', folder.title);
            const icon = document.createElement('span');
            icon.className = 'folder-tab-icon';
            if (folder.color) icon.style.color = folder.color;
            icon.innerHTML = folderIconSvg(folder.icon);
            tab.appendChild(icon);
            const unread = folderUnreadCount(folder);
            if (unread > 0) {
                const badge = document.createElement('span');
                badge.className = 'folder-tab-badge';
                badge.textContent = unread > 99 ? '99+' : String(unread);
                tab.appendChild(badge);
            }
            rail.appendChild(tab);
        });
    }

    if (STATE.folders.length < MAX_FOLDERS) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'folder-tab folder-tab-add';
        addBtn.title = i18n.folders_new || 'New folder';
        addBtn.setAttribute('aria-label', addBtn.title);
        addBtn.innerHTML = `<span class="folder-tab-icon">${ADD_FOLDER_ICON_SVG}</span>`;
        rail.appendChild(addBtn);
    }
    rail.scrollTop = savedScrollTop;
}

function folderUnreadCount(folder) {
    let total = 0;
    folderChatOrder(folder).forEach(chatId => {
        total += STATE.unreadCounts[chatId] || 0;
    });
    return total;
}

export function refreshFolderBadges() {
    if (!DOM.folderRail || DOM.folderRail.classList.contains('is-hidden')) return;
    STATE.folders.forEach(folder => {
        const tab = DOM.folderRail.querySelector(`.folder-tab[data-folder-id="${folder.id}"]`);
        if (!tab) return;
        const unread = folderUnreadCount(folder);
        let badge = tab.querySelector('.folder-tab-badge');
        if (unread > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'folder-tab-badge';
                tab.appendChild(badge);
            }
            badge.textContent = unread > 99 ? '99+' : String(unread);
        } else if (badge) {
            badge.remove();
        }
    });
}

function handleRailClick(e) {
    if (Date.now() < railClickSuppressUntil) return;
    const tab = e.target.closest('.folder-tab');
    if (!tab) return;
    if (tab.classList.contains('folder-tab-add')) {
        openCreateFolderModal();
        return;
    }
    const rawId = tab.dataset.folderId;
    if (rawId === '') {
        selectFolder(null);
        return;
    }
    selectFolder(parseInt(rawId, 10));
}

function handleRailContextMenu(e) {
    if (touchPressActive || dragState) {
        e.preventDefault();
        return;
    }
    const tab = e.target.closest('.folder-tab');
    if (!tab || tab.dataset.folderId === '' || tab.classList.contains('folder-tab-add')) return;
    e.preventDefault();
    openFolderModal(parseInt(tab.dataset.folderId, 10));
}

function handleRailPointerDown(e) {
    if (dragState) return;
    const tab = e.target.closest('.folder-tab');
    if (!tab || tab.dataset.folderId === '' || tab.classList.contains('folder-tab-add')) return;
    const isMouse = e.pointerType === 'mouse';
    if (isMouse && e.button !== 0) return;
    const folderId = parseInt(tab.dataset.folderId, 10);
    if (Number.isNaN(folderId)) return;
    cancelRailGestures();
    touchPressActive = !isMouse;
    const isSecondTap = touchPressActive
        && Date.now() - lastTapAt <= DOUBLE_TAP_MS
        && lastTapFolderId === folderId;
    dragCandidate = {
        folderId,
        tab,
        startX: e.clientX,
        startY: e.clientY,
        isMouse,
        startTime: Date.now(),
    };
    if (isMouse) return;
    if (isSecondTap) {
        railHoldTimer = setTimeout(() => {
            railHoldTimer = null;
            beginRailDrag(dragCandidate.startX, dragCandidate.startY);
        }, DOUBLE_TAP_HOLD_MS);
    } else {
        railLongPressTimer = setTimeout(() => {
            railLongPressTimer = null;
            dragCandidate = null;
            railClickSuppressUntil = Date.now() + CLICK_SUPPRESS_MS;
            if (navigator.vibrate) navigator.vibrate(15);
            openFolderModal(folderId);
        }, LONG_PRESS_MS);
    }
}

function handleRailPointerMove(e) {
    if (dragState) {
        moveRailDrag(e);
        return;
    }
    if (!dragCandidate) return;
    const dx = e.clientX - dragCandidate.startX;
    const dy = e.clientY - dragCandidate.startY;
    if (dragCandidate.isMouse) {
        if (Math.hypot(dx, dy) >= DRAG_START_DISTANCE) {
            beginRailDrag(dragCandidate.startX, dragCandidate.startY);
            moveRailDrag(e);
        }
        return;
    }
    if (Math.abs(dx) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(dy) > LONG_PRESS_MOVE_TOLERANCE) {
        cancelRailGestures();
    }
}

function handleRailPointerUp() {
    touchPressActive = false;
    if (dragState) {
        finishRailDrag();
        return;
    }
    if (dragCandidate && !dragCandidate.isMouse && Date.now() - dragCandidate.startTime <= DOUBLE_TAP_MS) {
        lastTapAt = Date.now();
        lastTapFolderId = dragCandidate.folderId;
    }
    cancelRailGestures();
}

function handleRailPointerCancel() {
    touchPressActive = false;
    if (dragState) {
        finishRailDrag();
        return;
    }
    cancelRailGestures();
}

function handleRailTouchMove(e) {
    if (dragState && e.cancelable) e.preventDefault();
}

function cancelRailGestures() {
    clearTimeout(railLongPressTimer);
    railLongPressTimer = null;
    clearTimeout(railHoldTimer);
    railHoldTimer = null;
    dragCandidate = null;
}

function beginRailDrag(x, y) {
    const cand = dragCandidate;
    if (!cand || dragState) return;
    dragCandidate = null;
    clearTimeout(railLongPressTimer);
    railLongPressTimer = null;
    clearTimeout(railHoldTimer);
    railHoldTimer = null;
    const tab = cand.tab;
    if (!tab.isConnected) return;
    const rect = tab.getBoundingClientRect();
    const clone = tab.cloneNode(true);
    clone.classList.add('folder-tab-drag-clone');
    clone.classList.remove('active');
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    document.body.appendChild(clone);
    tab.classList.add('dragging');
    document.body.classList.add('folder-drag-active');
    if (navigator.vibrate) navigator.vibrate(15);
    dragState = {
        tab,
        clone,
        grabX: x - rect.left,
        grabY: y - rect.top,
        horizontal: window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches,
    };
}

function moveRailDrag(e) {
    const st = dragState;
    if (!st) return;
    if (!st.tab.isConnected) {
        finishRailDrag();
        return;
    }
    st.clone.style.left = `${e.clientX - st.grabX}px`;
    st.clone.style.top = `${e.clientY - st.grabY}px`;
    const rail = DOM.folderRail;
    const tabs = Array.from(rail.querySelectorAll('.folder-tab'))
        .filter(t => t.dataset.folderId !== '' && !t.classList.contains('folder-tab-add'));
    const coord = st.horizontal ? e.clientX : e.clientY;
    let reference = null;
    for (const t of tabs) {
        if (t === st.tab) continue;
        const r = t.getBoundingClientRect();
        const mid = st.horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
        if (coord < mid) {
            reference = t;
            break;
        }
    }
    const anchor = reference || rail.querySelector('.folder-tab-add');
    if (anchor) {
        if (anchor.previousElementSibling !== st.tab) rail.insertBefore(st.tab, anchor);
    } else if (rail.lastElementChild !== st.tab) {
        rail.appendChild(st.tab);
    }
    const railRect = rail.getBoundingClientRect();
    if (st.horizontal) {
        if (e.clientX < railRect.left + DRAG_EDGE_SCROLL_PX) rail.scrollLeft -= 10;
        else if (e.clientX > railRect.right - DRAG_EDGE_SCROLL_PX) rail.scrollLeft += 10;
    } else {
        if (e.clientY < railRect.top + DRAG_EDGE_SCROLL_PX) rail.scrollTop -= 10;
        else if (e.clientY > railRect.bottom - DRAG_EDGE_SCROLL_PX) rail.scrollTop += 10;
    }
}

function finishRailDrag() {
    const st = dragState;
    if (!st) return;
    dragState = null;
    dragCandidate = null;
    st.clone.remove();
    st.tab.classList.remove('dragging');
    document.body.classList.remove('folder-drag-active');
    railClickSuppressUntil = Date.now() + CLICK_SUPPRESS_MS;
    const ids = currentDomFolderIds();
    const previous = STATE.folders.map(f => f.id);
    if (ids.length !== previous.length) {
        loadFolders(true);
        return;
    }
    if (ids.every((id, index) => id === previous[index])) return;
    const byId = new Map(STATE.folders.map(f => [f.id, f]));
    STATE.folders = ids.map(id => byId.get(id)).filter(Boolean);
    renderFolderRail();
    API.reorderFolders(ids).then(() => {
        lastLocalFolderSync = Date.now();
    }).catch(err => {
        showNotification((i18n.folders_error_save || 'Failed to update folder') + ': ' + err.message);
        loadFolders(true);
    });
}

function currentDomFolderIds() {
    if (!DOM.folderRail) return [];
    return Array.from(DOM.folderRail.querySelectorAll('.folder-tab'))
        .filter(t => t.dataset.folderId !== '' && !t.classList.contains('folder-tab-add'))
        .map(t => parseInt(t.dataset.folderId, 10))
        .filter(id => !Number.isNaN(id));
}

export async function selectFolder(folderId) {
    const changed = STATE.activeFolderId !== folderId;
    STATE.activeFolderId = folderId;
    if (changed) renderFolderRail();
    if (window.innerWidth <= 768 && DOM.chatMain && DOM.chatMain.classList.contains('show-chat')) {
        DOM.chatSidebar.classList.remove('hidden');
        DOM.chatMain.classList.remove('show-chat');
        DOM.chatMain.classList.add('hidden');
    }
    if (!changed) return;
    const { loadChats } = await import('./chatList.js');
    loadChats(true);
}

function bindFolderModalEvents() {
    if (!DOM.folderModal) return;
    DOM.folderForm.addEventListener('submit', handleFolderSubmit);
    DOM.folderModalClose.addEventListener('click', closeFolderModal);
    DOM.folderDeleteBtn.addEventListener('click', handleFolderDelete);
    DOM.folderNameInput.addEventListener('input', renderFolderPreview);
    DOM.folderIconGrid.addEventListener('click', handleIconPick);
    DOM.folderColorSwatches.addEventListener('click', handleColorPick);
    DOM.folderColorCustom.addEventListener('input', handleCustomColor);
    DOM.folderChatsList.addEventListener('click', handleFolderChatsListClick);
    DOM.folderAddChatInput.addEventListener('input', () => {
        clearTimeout(addChatTimer);
        addChatTimer = setTimeout(renderAddChatResults, ADD_CHAT_DEBOUNCE_MS);
    });
    DOM.folderAddChatResults.addEventListener('click', handleAddChatResultClick);
}

export function openCreateFolderModal() {
    if (STATE.folders.length >= MAX_FOLDERS) {
        showNotification(i18n.folders_limit_reached || 'Folder limit reached (8)');
        return;
    }
    openFolderModal(null);
}

export function openFolderModal(folderId) {
    if (!DOM.folderModal) return;
    const folder = findFolder(folderId);
    modalFolderId = folder ? folder.id : null;
    modalIcon = folder && folder.icon ? folder.icon : null;
    modalColor = folder && folder.color ? folder.color : null;
    DOM.folderModalTitle.textContent = folder ? (i18n.folders_edit || 'Edit folder') : (i18n.folders_new || 'New folder');
    DOM.folderNameInput.value = folder ? folder.title : '';
    DOM.folderColorCustom.value = modalColor || '#7eb4ff';
    DOM.folderDeleteBtn.classList.toggle('is-hidden', !folder);
    DOM.folderChatsSection.classList.toggle('is-hidden', !folder);
    DOM.folderAddChatInput.value = '';
    DOM.folderAddChatResults.innerHTML = '';
    setFolderError('');
    renderIconGrid();
    renderColorSwatches();
    renderFolderPreview();
    if (folder) renderFolderChats(folder);
    openModalFx(DOM.folderModal);
    setTimeout(() => DOM.folderNameInput.focus(), 60);
}

export function closeFolderModal() {
    if (!DOM.folderModal) return;
    closeModalFx(DOM.folderModal);
    modalFolderId = null;
}

function setFolderError(message) {
    if (DOM.folderModalError) DOM.folderModalError.textContent = message || '';
}

function renderIconGrid() {
    const grid = DOM.folderIconGrid;
    if (!grid) return;
    grid.innerHTML = '';
    FOLDER_ICON_NAMES.forEach((name, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'folder-icon-option' + (modalIcon === name ? ' selected' : '');
        btn.dataset.icon = name;
        btn.title = name;
        btn.style.animationDelay = `${Math.min(index * 8, 320)}ms`;
        btn.innerHTML = folderIconSvg(name);
        if (modalIcon === name && modalColor) btn.style.color = modalColor;
        grid.appendChild(btn);
    });
}

function renderColorSwatches() {
    const row = DOM.folderColorSwatches;
    if (!row) return;
    row.innerHTML = '';
    let swatchIndex = 0;
    const defaultBtn = document.createElement('button');
    defaultBtn.type = 'button';
    defaultBtn.className = 'folder-color-swatch folder-color-default' + (modalColor ? '' : ' selected');
    defaultBtn.dataset.color = '';
    defaultBtn.style.animationDelay = `${swatchIndex++ * 25}ms`;
    defaultBtn.title = i18n.folders_color_default || 'Default color';
    defaultBtn.innerHTML = CLOSE_ICON_SVG;
    row.appendChild(defaultBtn);
    FOLDER_COLORS.forEach(color => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'folder-color-swatch' + (modalColor === color ? ' selected' : '');
        btn.dataset.color = color;
        btn.style.background = color;
        btn.style.animationDelay = `${swatchIndex++ * 25}ms`;
        btn.title = color;
        row.appendChild(btn);
    });
}

function renderFolderPreview(pop = false) {
    if (!DOM.folderPreviewIcon) return;
    DOM.folderPreviewIcon.innerHTML = folderIconSvg(modalIcon);
    DOM.folderPreviewIcon.style.color = modalColor || '';
    DOM.folderPreviewName.textContent = DOM.folderNameInput.value.trim() || (i18n.folders_new || 'New folder');
    const selectedIcon = DOM.folderIconGrid.querySelector('.folder-icon-option.selected');
    if (selectedIcon) selectedIcon.style.color = modalColor || '';
    DOM.folderIconGrid.querySelectorAll('.folder-icon-option:not(.selected)').forEach(btn => { btn.style.color = ''; });
    if (pop) {
        DOM.folderPreviewIcon.classList.remove('folder-preview-pop');
        void DOM.folderPreviewIcon.offsetWidth;
        DOM.folderPreviewIcon.classList.add('folder-preview-pop');
    }
}

function handleIconPick(e) {
    const btn = e.target.closest('.folder-icon-option');
    if (!btn) return;
    modalIcon = btn.dataset.icon;
    DOM.folderIconGrid.querySelectorAll('.folder-icon-option').forEach(el => el.classList.remove('selected'));
    btn.classList.add('selected');
    renderFolderPreview(true);
}

function handleColorPick(e) {
    const btn = e.target.closest('.folder-color-swatch');
    if (!btn) return;
    modalColor = btn.dataset.color || null;
    DOM.folderColorSwatches.querySelectorAll('.folder-color-swatch').forEach(el => el.classList.remove('selected'));
    btn.classList.add('selected');
    if (modalColor) DOM.folderColorCustom.value = modalColor;
    renderFolderPreview(true);
}

function handleCustomColor(e) {
    const value = (e.target.value || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) return;
    modalColor = value;
    DOM.folderColorSwatches.querySelectorAll('.folder-color-swatch').forEach(el => {
        el.classList.toggle('selected', !!el.dataset.color && el.dataset.color.toLowerCase() === value);
    });
    renderFolderPreview(true);
}

function folderChatRowName(chat, chatId) {
    if (chat) return chatDisplayName(chat) || chat.name || `Chat #${chatId}`;
    return `Chat #${chatId}`;
}

function renderFolderChats(folder) {
    const list = DOM.folderChatsList;
    if (!list) return;
    const items = sortedFolderItems(folder);
    DOM.folderChatsCount.textContent = `${items.length}/${MAX_FOLDER_CHATS}`;
    list.innerHTML = '';
    if (items.length === 0) {
        list.innerHTML = `<div class="folder-chats-empty">${i18n.folders_empty || 'No chats in this folder yet'}</div>`;
        return;
    }
    items.forEach((item, index) => {
        const chat = STATE.chatsMap[item.chat_id];
        const row = document.createElement('div');
        row.className = 'folder-chat-row';
        row.dataset.chatId = item.chat_id;
        row.style.animationDelay = `${Math.min(index * 40, 400)}ms`;

        if (chat && chat.avatar) {
            const img = document.createElement('img');
            img.className = 'folder-chat-avatar';
            img.src = chat.avatar;
            img.alt = '';
            row.appendChild(img);
        } else {
            const div = document.createElement('div');
            div.className = 'folder-chat-avatar folder-chat-avatar-placeholder';
            const name = folderChatRowName(chat, item.chat_id);
            div.textContent = name[0] ? name[0].toUpperCase() : '?';
            row.appendChild(div);
        }

        const name = document.createElement('span');
        name.className = 'folder-chat-name';
        name.textContent = folderChatRowName(chat, item.chat_id);
        row.appendChild(name);

        const pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        pinBtn.className = 'folder-chat-pin' + (item.is_pinned ? ' is-on' : '');
        pinBtn.dataset.action = item.is_pinned ? 'unpin' : 'pin';
        pinBtn.dataset.chatId = item.chat_id;
        pinBtn.title = item.is_pinned ? (i18n.folders_unpin_in || 'Unpin in folder') : (i18n.folders_pin_in || 'Pin in folder');
        pinBtn.innerHTML = PIN_ICON_SVG;
        row.appendChild(pinBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'folder-chat-remove';
        removeBtn.dataset.action = 'remove';
        removeBtn.dataset.chatId = item.chat_id;
        removeBtn.title = i18n.folders_remove_from || 'Remove from folder';
        removeBtn.innerHTML = CLOSE_ICON_SVG;
        row.appendChild(removeBtn);

        list.appendChild(row);
    });
}

function collectAddChatCandidates(query) {
    const folder = findFolder(modalFolderId);
    if (!folder) return [];
    const q = (query || '').trim().toLowerCase();
    const memberIds = new Set((folder.items || []).map(item => item.chat_id));
    const candidates = [];
    for (const chat of Object.values(STATE.chatsMap)) {
        if (memberIds.has(chat.id)) continue;
        if (q) {
            const fields = [
                chat.name || '',
                chat.other_user_username || '',
                chat.other_user_first_name || '',
                chat.other_user_last_name || '',
            ];
            if (!fields.some(value => value.toLowerCase().includes(q))) continue;
        }
        candidates.push(chat);
    }
    candidates.sort((a, b) => (new Date(b.last_message_time || 0)) - (new Date(a.last_message_time || 0)));
    return candidates.slice(0, ADD_CHAT_RESULT_LIMIT);
}

function renderAddChatResults() {
    const box = DOM.folderAddChatResults;
    if (!box) return;
    const folder = findFolder(modalFolderId);
    box.innerHTML = '';
    if (!folder) return;
    if ((folder.items || []).length >= MAX_FOLDER_CHATS) {
        box.innerHTML = `<div class="folder-add-hint">${i18n.folders_chats_limit || 'Chat limit reached (20)'}</div>`;
        return;
    }
    const candidates = collectAddChatCandidates(DOM.folderAddChatInput.value);
    if (candidates.length === 0) {
        box.innerHTML = `<div class="folder-add-hint">${i18n.folders_no_chats_to_add || 'No chats to add'}</div>`;
        return;
    }
    candidates.forEach((chat, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'folder-add-chat-row';
        row.dataset.chatId = chat.id;
        row.style.animationDelay = `${index * 25}ms`;
        const name = document.createElement('span');
        name.className = 'folder-chat-name';
        name.textContent = folderChatRowName(chat, chat.id);
        row.appendChild(name);
        box.appendChild(row);
    });
}

async function handleAddChatResultClick(e) {
    const row = e.target.closest('.folder-add-chat-row');
    if (!row || !modalFolderId) return;
    const chatId = parseInt(row.dataset.chatId, 10);
    try {
        await API.addChatToFolder(modalFolderId, chatId);
        setFolderError('');
        await refreshFoldersAfterMutation();
        const folder = findFolder(modalFolderId);
        if (folder) renderFolderChats(folder);
        renderAddChatResults();
    } catch (err) {
        setFolderError(err.message);
    }
}

async function handleFolderChatsListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !modalFolderId) return;
    const chatId = parseInt(btn.dataset.chatId, 10);
    const action = btn.dataset.action;
    try {
        if (action === 'remove') await API.removeChatFromFolder(modalFolderId, chatId);
        else if (action === 'pin') await API.pinChatInFolder(modalFolderId, chatId);
        else if (action === 'unpin') await API.unpinChatInFolder(modalFolderId, chatId);
        else return;
        setFolderError('');
        await refreshFoldersAfterMutation();
        const folder = findFolder(modalFolderId);
        if (folder) renderFolderChats(folder);
    } catch (err) {
        setFolderError(err.message);
    }
}

async function refreshFoldersAfterMutation() {
    try {
        const data = await API.fetchFolders();
        STATE.folders = (data && data.folders) || [];
        lastLocalFolderSync = Date.now();
    } catch (err) {
        console.error('Failed to refresh chat folders:', err);
    }
    if (STATE.activeFolderId != null && !findFolder(STATE.activeFolderId)) {
        STATE.activeFolderId = null;
    }
    renderFolderRail();
    const { loadChats } = await import('./chatList.js');
    loadChats(true);
}

async function handleFolderSubmit(e) {
    e.preventDefault();
    const title = DOM.folderNameInput.value.trim();
    if (!title) {
        setFolderError(i18n.folders_name_required || 'Enter a folder name');
        return;
    }
    const wasEdit = modalFolderId != null;
    const editingId = modalFolderId;
    if (!wasEdit && STATE.folders.length >= MAX_FOLDERS) {
        setFolderError(i18n.folders_limit_reached || 'Folder limit reached (8)');
        return;
    }
    const payload = { title, icon: modalIcon, color: modalColor || '' };
    try {
        let created = null;
        if (wasEdit) {
            await API.updateFolder(editingId, payload);
        } else {
            created = await API.createFolder(payload);
        }
        closeFolderModal();
        await refreshFoldersAfterMutation();
        if (created && created.folder) selectFolder(created.folder.id);
        showNotification(wasEdit ? (i18n.folders_updated || 'Folder updated') : (i18n.folders_created || 'Folder created'));
    } catch (err) {
        setFolderError(err.message);
    }
}

async function handleFolderDelete() {
    if (modalFolderId == null) return;
    const confirmed = await showConfirm(i18n.folders_delete_confirm || 'Delete this folder? Chats will not be deleted.');
    if (!confirmed) return;
    const folderId = modalFolderId;
    try {
        await API.deleteFolder(folderId);
        closeFolderModal();
        await refreshFoldersAfterMutation();
        showNotification(i18n.folders_deleted || 'Folder deleted');
    } catch (err) {
        setFolderError(err.message);
    }
}

export function buildFolderMenuLinks(chat) {
    const nodes = [];
    if (!chat) return nodes;
    const activeFolder = getActiveFolder();
    const activeItem = activeFolder ? findFolderItem(activeFolder, chat.id) : null;
    if (activeFolder && activeItem) {
        const pinLink = document.createElement('a');
        pinLink.textContent = activeItem.is_pinned ? (i18n.folders_unpin_in || 'Unpin in folder') : (i18n.folders_pin_in || 'Pin in folder');
        pinLink.dataset.action = activeItem.is_pinned ? 'unpinInFolder' : 'pinInFolder';
        pinLink.dataset.folderId = activeFolder.id;
        nodes.push(pinLink);
    }
    if (!STATE.folders.length) return nodes;

    const wrap = document.createElement('div');
    wrap.className = 'chat-folder-submenu-wrap';

    const parentLink = document.createElement('a');
    parentLink.dataset.action = 'toggleFolderSubmenu';
    const parentIcon = document.createElement('span');
    parentIcon.className = 'folder-menu-icon';
    parentIcon.innerHTML = ADD_FOLDER_ICON_SVG;
    const parentText = document.createElement('span');
    parentText.className = 'folder-menu-text';
    parentText.textContent = i18n.folders_add_to || 'Add to folder';
    const chevron = document.createElement('span');
    chevron.className = 'folder-menu-chevron';
    chevron.innerHTML = CHEVRON_ICON_SVG;
    parentLink.appendChild(parentIcon);
    parentLink.appendChild(parentText);
    parentLink.appendChild(chevron);

    const sub = document.createElement('div');
    sub.className = 'chat-folder-submenu';
    STATE.folders.forEach(folder => {
        const item = findFolderItem(folder, chat.id);
        const full = !item && (folder.items || []).length >= MAX_FOLDER_CHATS;
        const row = document.createElement('a');
        row.dataset.action = item ? 'removeFromFolder' : 'addToFolder';
        row.dataset.folderId = folder.id;
        if (full) {
            row.classList.add('is-disabled');
            row.title = i18n.folders_chats_limit || 'Chat limit reached (20)';
        }
        const icon = document.createElement('span');
        icon.className = 'folder-sub-icon';
        if (folder.color) icon.style.color = folder.color;
        icon.innerHTML = folderIconSvg(folder.icon);
        const title = document.createElement('span');
        title.className = 'folder-sub-title';
        title.textContent = folder.title;
        row.appendChild(icon);
        row.appendChild(title);
        if (item) {
            const check = document.createElement('span');
            check.className = 'folder-sub-check';
            check.textContent = '✓';
            row.appendChild(check);
        }
        sub.appendChild(row);
    });

    wrap.appendChild(parentLink);
    wrap.appendChild(sub);
    wrap.addEventListener('mouseenter', () => positionFolderSubmenu(wrap));
    parentLink.addEventListener('click', e => {
        e.stopPropagation();
        positionFolderSubmenu(wrap);
        wrap.classList.toggle('is-open');
    });
    nodes.push(wrap);
    return nodes;
}

export function positionFolderSubmenu(wrap) {
    const sub = wrap.querySelector('.chat-folder-submenu');
    if (!sub) return;
    sub.classList.remove('open-left', 'open-up');
    const rect = wrap.getBoundingClientRect();
    const subWidth = Math.max(sub.offsetWidth, SUBMENU_MIN_WIDTH);
    if (rect.right + subWidth + 8 > window.innerWidth) sub.classList.add('open-left');
    const estimatedHeight = Math.min(STATE.folders.length * SUBMENU_ROW_HEIGHT + 16, SUBMENU_MAX_HEIGHT);
    if (rect.top + estimatedHeight > window.innerHeight - 8) sub.classList.add('open-up');
}

export async function addChatToFolderById(folderId, chatId) {
    try {
        await API.addChatToFolder(folderId, chatId);
        await refreshFoldersAfterMutation();
        showNotification(i18n.folders_chat_added || 'Chat added to folder');
    } catch (err) {
        showNotification((i18n.folders_error_save || 'Failed to update folder') + ': ' + err.message);
    }
}

export async function removeChatFromFolderById(folderId, chatId) {
    try {
        await API.removeChatFromFolder(folderId, chatId);
        await refreshFoldersAfterMutation();
        showNotification(i18n.folders_chat_removed || 'Chat removed from folder');
    } catch (err) {
        showNotification((i18n.folders_error_save || 'Failed to update folder') + ': ' + err.message);
    }
}

export async function togglePinInActiveFolder(chatId) {
    const folder = getActiveFolder();
    const item = folder ? findFolderItem(folder, chatId) : null;
    if (!folder || !item) return;
    try {
        if (item.is_pinned) await API.unpinChatInFolder(folder.id, chatId);
        else await API.pinChatInFolder(folder.id, chatId);
        await refreshFoldersAfterMutation();
    } catch (err) {
        showNotification((i18n.folders_error_save || 'Failed to update folder') + ': ' + err.message);
    }
}
