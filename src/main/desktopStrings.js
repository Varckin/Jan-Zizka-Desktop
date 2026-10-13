const STRINGS = {
    en: {
        tray_show: 'Show',
        tray_hide: 'Hide',
        tray_quit: 'Quit',
        tray_chats: 'Chats',
        tray_vault: 'Encrypted vault',
        tray_profile: 'My profile',
        tray_settings: 'Settings',
        tray_mute_notifications: 'Mute notifications',
        tray_unread: 'Unread messages',
        notif_new_message: 'New message',
        notif_incoming_call: 'Incoming call',
        tray_update_install: 'Update and restart',
        tray_update_progress: 'Updating',
        notif_update_ready: 'Update ready',
        notif_update_ready_body: 'Restart the app to apply the new version.',
    },
    ru: {
        tray_show: 'Показать',
        tray_hide: 'Скрыть',
        tray_quit: 'Выйти',
        tray_chats: 'Чаты',
        tray_vault: 'Шифрованный сейф',
        tray_profile: 'Мой профиль',
        tray_settings: 'Настройки',
        tray_mute_notifications: 'Отключить уведомления',
        tray_unread: 'Непрочитанные сообщения',
        notif_new_message: 'Новое сообщение',
        notif_incoming_call: 'Входящий звонок',
        tray_update_install: 'Обновить и перезапустить',
        tray_update_progress: 'Обновление',
        notif_update_ready: 'Обновление готово',
        notif_update_ready_body: 'Перезапустите приложение, чтобы применить новую версию.',
    },
    es: {
        tray_show: 'Mostrar',
        tray_hide: 'Ocultar',
        tray_quit: 'Salir',
        tray_chats: 'Chats',
        tray_vault: 'Bóveda cifrada',
        tray_profile: 'Mi perfil',
        tray_settings: 'Ajustes',
        tray_mute_notifications: 'Silenciar notificaciones',
        tray_unread: 'Mensajes sin leer',
        notif_new_message: 'Nuevo mensaje',
        notif_incoming_call: 'Llamada entrante',
        tray_update_install: 'Actualizar y reiniciar',
        tray_update_progress: 'Actualizando',
        notif_update_ready: 'Actualización lista',
        notif_update_ready_body: 'Reinicia la aplicación para aplicar la nueva versión.',
    },
    de: {
        tray_show: 'Anzeigen',
        tray_hide: 'Ausblenden',
        tray_quit: 'Beenden',
        tray_chats: 'Chats',
        tray_vault: 'Verschlüsselter Tresor',
        tray_profile: 'Mein Profil',
        tray_settings: 'Einstellungen',
        tray_mute_notifications: 'Benachrichtigungen stummschalten',
        tray_unread: 'Ungelesene Nachrichten',
        notif_new_message: 'Neue Nachricht',
        notif_incoming_call: 'Eingehender Anruf',
        tray_update_install: 'Aktualisieren und neu starten',
        tray_update_progress: 'Aktualisierung',
        notif_update_ready: 'Update bereit',
        notif_update_ready_body: 'Starten Sie die App neu, um die neue Version zu übernehmen.',
    },
};

const SUPPORTED = ['en', 'ru', 'es', 'de'];

let activeLocale = 'en';

function setLocale(locale) {
    activeLocale = SUPPORTED.includes(locale) ? locale : 'en';
}

function s(key, fallback) {
    const table = STRINGS[activeLocale] || STRINGS.en;
    if (table[key] !== undefined) return table[key];
    if (STRINGS.en[key] !== undefined) return STRINGS.en[key];
    return fallback !== undefined ? fallback : key;
}

module.exports = { STRINGS, SUPPORTED, setLocale, s };
