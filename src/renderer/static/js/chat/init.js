import { STATE } from './state.js';
import { DOM } from './dom.js';
import { ALLOWED_FILE_TYPES } from './constants.js';
import * as WS from './websocket.js';
import { loadChats } from './chatList.js';
import { sendMessage, handleInputKeydown, handleTyping, cancelReplyHandler, handleFileSelect, handleWsMessage, handleGlobalWsMessage, loadMessages, initScrollReadTracker } from './chatMessages.js';
import { initChatAvatarCrop, initGroupMembersInput, handleGroupSubmit, handleGroupAvatarSelect, resetGroupAvatarSelection, openSettingsModal, openSearchModal, closeSearchModal, clearMsgSearch, handleMsgSearch, handleMsgSearchKeydown, handleChatSettingsSubmit, handleAvatarUpload, handleDeleteChat, openInfoModal, openUserProfileModal, bindSettingsModalEvents, bindInviteLinksEvents } from './modals.js';
import { bindInviteJoinEvents, handleInviteParam } from './inviteJoin.js';
import { bindUserSearchEvents } from './userSearchModal.js';
import { bindChannelEvents, resetChannelAvatarSelection } from './channels.js';
import { openDiscoverModal, closeDiscoverModal, bindDiscoverEvents } from './discoverModal.js';
import { openModalFx, closeModalFx } from './modalFx.js';
import { initDragAndDrop } from './handlers/dragdrop.js';
import { initContextMenu } from './handlers/contextMenuInit.js';
import { initEmojiPicker } from './handlers/emoji.js';
import { initGifPicker } from './handlers/gif.js';
import { initMuteModal } from './muteModal.js';
import { initPinnedBar } from './ui/pinnedBar.js';
import { initFolders } from './folders.js';
import { initAdminFx } from './modals/adminFx.js';
import { initContactsPopup, loadContacts } from './contacts.js';
import { initMentions } from './handlers/mentions.js';
import { toggleVoiceRecording, cancelVoiceRecording } from './voice.js';
import { initVoiceCall } from './voice_call/ui.js';
import { initGroupVoice } from './group_voice/ui.js';
import { closeChatDropdown, closeAnyOpenDropdown } from './ui/chatItem.js';
import { createNotificationAudioFromSettings } from '../desktop/notify.js';
import { initTextareaAutoResize } from '../core_chat/effects.js';

export function init() {
    loadChats();
    loadMySignature();
    loadContacts();
    window.groupAvatarCropped = null;
    initMentions();
    bindEvents();
    if (DOM.fileInput) DOM.fileInput.accept = ALLOWED_FILE_TYPES.accept;
    initDragAndDrop();
    initScrollReadTracker();
    initChatAvatarCrop();
    initGroupMembersInput();
    initContextMenu();
    initEmojiPicker();
    initGifPicker();
    initMuteModal();
    initPinnedBar();
    initFolders();
    initAdminFx();
    initContactsPopup();
    bindSettingsModalEvents();
    bindInviteLinksEvents();
    bindInviteJoinEvents();
    bindUserSearchEvents();
    bindChannelEvents();
    bindDiscoverEvents();
    handleInviteParam();
    STATE.notificationSound = createNotificationAudioFromSettings();
    WS.connectGlobalWebSocket(handleGlobalWsMessage);
    DOM.voiceBtn.addEventListener('click', toggleVoiceRecording);
    DOM.voiceStopBtn.addEventListener('click', cancelVoiceRecording);
    DOM.groupAvatarFile.addEventListener('change', handleGroupAvatarSelect);
    document.addEventListener('click', handleGlobalDropdownClose, true);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (!STATE.currentChatId) return;
        const container = DOM.messagesContainer;
        if (!container) return;
        const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
        if (atBottom) {
            import('./chatMessages.js').then(m => m.markChatAsRead());
        }
    });

    initVoiceCall();
    initGroupVoice();
}

export function handleGlobalDropdownClose(e) {
    if (!STATE.openDropdown) return;
    const dropdown = STATE.openDropdown;

    if (dropdown._isChatDropdown) {
        const menuBtn = dropdown._menuBtn;
        if (dropdown.contains(e.target)) return;
        if (menuBtn && menuBtn.contains(e.target)) return;
        closeChatDropdown(dropdown);
        return;
    }

    if (dropdown === DOM.createChatMenu) {
        if (dropdown.contains(e.target)) return;
        if (DOM.createChatBtn && DOM.createChatBtn.contains(e.target)) return;
        dropdown.style.display = 'none';
        dropdown.classList.remove('show');
        STATE.openDropdown = null;
    }
}

let _chatSearchTimer = null;
const CHAT_SEARCH_DEBOUNCE_MS = 300;

function bindEvents() {
    DOM.sendBtn.addEventListener('click', sendMessage);
    DOM.messageInput.addEventListener('keydown', handleInputKeydown);
    DOM.messageInput.addEventListener('input', handleTyping);
    initTextareaAutoResize(DOM.messageInput, 160);
    DOM.cancelReply.addEventListener('click', cancelReplyHandler);
    DOM.fileInput.addEventListener('change', handleFileSelect);
    DOM.toggleSidebar.addEventListener('click', handleToggleSidebar);
    DOM.createChatBtn.addEventListener('click', handleCreateChatClick);
    DOM.createChatMenu.addEventListener('click', handleCreateChatMenuClick);
    DOM.settingsBtn.addEventListener('click', openSettingsModal);
    DOM.searchMsgBtn.addEventListener('click', openSearchModal);
    DOM.chatInfo.addEventListener('click', openInfoModal);
    const chatOnlineStatus = document.getElementById('chat-online-status');
    if (chatOnlineStatus) {
        chatOnlineStatus.addEventListener('click', e => e.stopPropagation());
    }
    DOM.chatSearch.addEventListener('input', function() {
        const value = this.value.trim();
        clearTimeout(_chatSearchTimer);
        _chatSearchTimer = setTimeout(() => loadChats(false, value), CHAT_SEARCH_DEBOUNCE_MS);
    });
    DOM.messagesContainer.addEventListener('scroll', handleMessagesScroll);
    DOM.messagesContainer.addEventListener('click', handleMessageAvatarClick);
    DOM.closeBtns.forEach(btn => btn.addEventListener('click', function() { hideModal(this.closest('.modal')); }));
    window.addEventListener('click', e => { if (e.target.classList.contains('modal')) hideModal(e.target); });
    DOM.groupForm.addEventListener('submit', handleGroupSubmit);
    DOM.msgSearchInput.addEventListener('input', handleMsgSearch);
    DOM.msgSearchInput.addEventListener('keydown', handleMsgSearchKeydown);
    DOM.msgSearchClear.addEventListener('click', clearMsgSearch);
    DOM.chatSettingsForm.addEventListener('submit', handleChatSettingsSubmit);
    DOM.chatAvatarInput.addEventListener('change', handleAvatarUpload);
    DOM.deleteChatBtn.addEventListener('click', handleDeleteChat);
    DOM.infoModalClose.addEventListener('click', () => hideModal(DOM.infoModal));
}

function handleToggleSidebar(e) {
    e.stopPropagation();
    if (window.innerWidth <= 768) {
        const isHidden = DOM.chatSidebar.classList.contains('hidden');
        if (isHidden) {
            DOM.chatSidebar.classList.remove('hidden');
            DOM.chatMain.classList.remove('show-chat');
            DOM.chatMain.classList.add('hidden');
        } else {
            DOM.chatSidebar.classList.add('hidden');
            DOM.chatMain.classList.remove('hidden');
            DOM.chatMain.classList.add('show-chat');
        }
    } else DOM.chatSidebar.classList.toggle('hidden');
}

function handleCreateChatClick(e) {
    e.stopPropagation();
    const menu = DOM.createChatMenu;
    const isOpen = menu.classList.contains('show');
    if (STATE.openDropdown && STATE.openDropdown !== menu) {
        closeAnyOpenDropdown();
    }
    if (isOpen) {
        menu.classList.remove('show');
        menu.style.display = 'none';
        STATE.openDropdown = null;
    } else {
        menu.style.display = 'block';
        menu.classList.add('show');
        STATE.openDropdown = menu;
    }
}

function handleCreateChatMenuClick(e) {
    const target = e.target.closest('a[data-action]');
    if (!target) return;
    e.preventDefault();
    const action = target.dataset.action;
    if (action === 'discover') openDiscoverModal();
    else if (action === 'group') { resetGroupAvatarSelection(); openModalFx(DOM.groupModal); }
    else if (action === 'channel') { resetChannelAvatarSelection(); openModalFx(document.getElementById('channel-modal')); }
    DOM.createChatMenu.classList.remove('show');
    DOM.createChatMenu.style.display = 'none';
    STATE.openDropdown = null;
}

function handleMessagesScroll() {
    if (this.scrollTop !== 0) return;
    loadMessages(STATE.currentChatId, false);
}

function handleMessageAvatarClick(e) {
    const avatar = e.target.closest('.message-avatar.is-clickable');
    if (!avatar) return;
    if (STATE.currentChatType !== 'group') return;
    const row = avatar.closest('.message-row');
    const messageEl = row ? row.querySelector('.message') : null;
    if (!messageEl) return;
    const senderId = parseInt(messageEl.dataset.senderId, 10);
    const username = messageEl.dataset.senderUsername;
    if (!username || Number.isNaN(senderId)) return;
    openUserProfileModal({
        userId: senderId,
        username,
        firstName: messageEl.dataset.senderFirstName || '',
        lastName: messageEl.dataset.senderLastName || '',
    });
}

function hideModal(modal) {
    if (!modal) return;
    if (modal === DOM.searchModal) { closeSearchModal(); return; }
    if (modal === DOM.discoverModal) { closeDiscoverModal(); return; }
    closeModalFx(modal);
}

async function loadMySignature() {
    try {
        const res = await fetch('/chat/api/my-signature');
        if (!res.ok) return;
        const data = await res.json();
        const previous = STATE.mySignature;
        STATE.mySignature = data.signature;
        if (!previous && STATE.currentChatId && STATE.currentChatType === 'channel') {
            loadMessages(STATE.currentChatId, true);
        }
    } catch (err) {
        console.error('Failed to load author signature:', err);
    }
}
