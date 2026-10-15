import { STATE } from './state.js';
import { DOM, i18n } from './dom.js';
import { showNotification } from './dialogs.js';
import { enqueueOutgoing } from './chatMessages.js';

const AUDIO_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

function pickAudioMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    for (const candidate of AUDIO_MIME_CANDIDATES) {
        if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return '';
}

function voiceContainerInfo(mimeType) {
    const mime = String(mimeType || '').toLowerCase();
    if (mime.includes('ogg')) return { type: 'audio/ogg', ext: 'ogg' };
    if (mime.includes('mp4')) return { type: 'audio/mp4', ext: 'm4a' };
    return { type: 'audio/webm', ext: 'webm' };
}

export async function toggleVoiceRecording() {
    if (STATE.isRecording) {
        STATE.cancelRecording = false;
        stopRecording();
    } else {
        await startRecording();
    }
}

export function cancelVoiceRecording() {
    if (!STATE.isRecording) return;
    STATE.cancelRecording = true;
    stopRecording();
}

export function stopRecording() {
    if (STATE.mediaRecorder && STATE.isRecording) {
        STATE.mediaRecorder.stop();
        clearInterval(STATE.recordingTimer);
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const preferredMime = pickAudioMimeType();
        const recorder = preferredMime
            ? new MediaRecorder(stream, { mimeType: preferredMime })
            : new MediaRecorder(stream);
        STATE.mediaRecorder = recorder;
        STATE.recordedChunks = [];
        STATE.isRecording = true;
        STATE.recordingSeconds = 0;
        STATE.cancelRecording = false;

        STATE.mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) STATE.recordedChunks.push(e.data);
        };

        STATE.mediaRecorder.onstop = () => {
            const cancelled = STATE.cancelRecording;
            const chunks = STATE.recordedChunks;
            STATE.cancelRecording = false;
            STATE.recordedChunks = [];
            STATE.isRecording = false;
            clearInterval(STATE.recordingTimer);
            DOM.voiceRecordingIndicator.classList.add('is-hidden');
            DOM.voiceBtn.classList.remove('recording-active');
            stream.getTracks().forEach(track => track.stop());

            if (cancelled || chunks.length === 0) return;
            const actualMime = recorder.mimeType || preferredMime || 'audio/webm';
            const info = voiceContainerInfo(actualMime);
            const blob = new Blob(chunks, { type: actualMime });
            if (blob.size < 512) {
                showNotification(i18n.no_audio_recorded || 'No audio recorded.');
                return;
            }
            const file = new File([blob], `voice.${info.ext}`, { type: info.type });
            sendVoiceMessage(file);
        };

        STATE.mediaRecorder.start(1000);
        DOM.voiceRecordingIndicator.classList.remove('is-hidden');
        DOM.voiceTimer.textContent = '0:00';
        DOM.voiceBtn.classList.add('recording-active');

        clearInterval(STATE.recordingTimer);
        STATE.recordingTimer = setInterval(() => {
            STATE.recordingSeconds++;
            const mins = Math.floor(STATE.recordingSeconds / 60);
            const secs = STATE.recordingSeconds % 60;
            DOM.voiceTimer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            if (STATE.recordingSeconds >= 60) {
                STATE.cancelRecording = false;
                stopRecording();
            }
        }, 1000);
    } catch (err) {
        showNotification('Microphone access denied: ' + err.message);
    }
}

function sendVoiceMessage(file) {
    if (!STATE.currentChatId) {
        showNotification('No chat selected.');
        return;
    }
    enqueueOutgoing({ content: '', files: [file], kind: 'message' });
}
