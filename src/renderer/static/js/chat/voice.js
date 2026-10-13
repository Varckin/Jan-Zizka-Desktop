import { STATE } from './state.js';
import { DOM, i18n } from './dom.js';
import { showNotification } from './dialogs.js';
import { enqueueOutgoing } from './chatMessages.js';

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
        STATE.mediaRecorder = new MediaRecorder(stream);
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
            const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
            if (blob.size < 512) {
                showNotification(i18n.no_audio_recorded || 'No audio recorded.');
                return;
            }
            const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
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
