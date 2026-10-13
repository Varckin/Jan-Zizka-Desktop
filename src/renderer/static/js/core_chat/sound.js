export const NOTIFICATION_SOUND_URL = '/static/sound/notification.mp3';

export function createNotificationAudio(url = NOTIFICATION_SOUND_URL) {
    const audio = new Audio(url);
    audio.preload = 'auto';
    return audio;
}

export function playSound(audio) {
    if (!audio) return;
    try {
        audio.currentTime = 0;
        const promise = audio.play();
        if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch {
    }
}
