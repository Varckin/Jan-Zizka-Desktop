const STRINGS = {
    en: {
        logout_confirm: 'Log out of this device?',
        connection_restored: 'Reconnected to server',
        connection_lost: 'Connection lost. Reconnecting…',
        e2e_lib_missing: 'E2E libraries are missing. Copy libsignal into src/renderer/static/js/libsignal',
        settings_saved: 'Settings saved',
        download_done: 'Download completed',
        open_failed: 'Failed to open file',
        vault_locked_hint: 'Vault is locked',
        desktop_update_state_idle: 'Up to date check pending',
        desktop_update_state_checking: 'Checking for updates…',
        desktop_update_state_available: 'Update found',
        desktop_update_state_verifying: 'Verifying update signature…',
        desktop_update_state_downloading: 'Downloading update',
        desktop_update_state_downloaded: 'Update ready, restart to apply',
        desktop_update_state_up_to_date: 'Up to date',
        desktop_update_state_error: 'Update error',
        desktop_update_state_unsupported: 'Updates unavailable in this build',
    },
    ru: {
        logout_confirm: 'Выйти из аккаунта на этом устройстве?',
        connection_restored: 'Соединение с сервером восстановлено',
        connection_lost: 'Соединение потеряно. Переподключение…',
        e2e_lib_missing: 'Библиотеки E2E не найдены. Скопируйте libsignal в src/renderer/static/js/libsignal',
        settings_saved: 'Настройки сохранены',
        download_done: 'Загрузка завершена',
        open_failed: 'Не удалось открыть файл',
        vault_locked_hint: 'Хранилище заблокировано',
        desktop_update_state_idle: 'Ожидание проверки обновлений',
        desktop_update_state_checking: 'Проверка обновлений…',
        desktop_update_state_available: 'Найдено обновление',
        desktop_update_state_verifying: 'Проверка подписи обновления…',
        desktop_update_state_downloading: 'Загрузка обновления',
        desktop_update_state_downloaded: 'Обновление готово, нужен перезапуск',
        desktop_update_state_up_to_date: 'Актуальная версия',
        desktop_update_state_error: 'Ошибка обновления',
        desktop_update_state_unsupported: 'Обновления недоступны в этой сборке',
    },
    es: {
        logout_confirm: '¿Cerrar sesión en este dispositivo?',
        connection_restored: 'Reconectado al servidor',
        connection_lost: 'Conexión perdida. Reconectando…',
        e2e_lib_missing: 'Faltan las librerías E2E. Copia libsignal a src/renderer/static/js/libsignal',
        settings_saved: 'Ajustes guardados',
        download_done: 'Descarga completada',
        open_failed: 'No se pudo abrir el archivo',
        vault_locked_hint: 'La bóveda está bloqueada',
        desktop_update_state_idle: 'Esperando la comprobación',
        desktop_update_state_checking: 'Comprobando actualizaciones…',
        desktop_update_state_available: 'Actualización encontrada',
        desktop_update_state_verifying: 'Verificando la firma…',
        desktop_update_state_downloading: 'Descargando actualización',
        desktop_update_state_downloaded: 'Actualización lista, reinicie',
        desktop_update_state_up_to_date: 'Versión actualizada',
        desktop_update_state_error: 'Error de actualización',
        desktop_update_state_unsupported: 'Actualizaciones no disponibles en esta compilación',
    },
    de: {
        logout_confirm: 'Auf diesem Gerät abmelden?',
        connection_restored: 'Wieder mit dem Server verbunden',
        connection_lost: 'Verbindung verloren. Verbinde erneut…',
        e2e_lib_missing: 'E2E-Bibliotheken fehlen. libsignal nach src/renderer/static/js/libsignal kopieren',
        settings_saved: 'Einstellungen gespeichert',
        download_done: 'Download abgeschlossen',
        open_failed: 'Datei konnte nicht geöffnet werden',
        vault_locked_hint: 'Tresor ist gesperrt',
        desktop_update_state_idle: 'Warte auf Update-Prüfung',
        desktop_update_state_checking: 'Suche nach Updates…',
        desktop_update_state_available: 'Update gefunden',
        desktop_update_state_verifying: 'Prüfe Update-Signatur…',
        desktop_update_state_downloading: 'Update wird geladen',
        desktop_update_state_downloaded: 'Update bereit, Neustart nötig',
        desktop_update_state_up_to_date: 'Aktuelle Version',
        desktop_update_state_error: 'Update-Fehler',
        desktop_update_state_unsupported: 'Updates in diesem Build nicht verfügbar',
    },
};

const SUPPORTED = ['en', 'ru', 'es', 'de'];

function currentLocale() {
    const fromHtml = document.documentElement.lang;
    if (fromHtml && SUPPORTED.includes(fromHtml.split('-')[0])) return fromHtml.split('-')[0];
    const nav = String(navigator.language || 'en').split('-')[0].toLowerCase();
    return SUPPORTED.includes(nav) ? nav : 'en';
}

export function s(key, fallback) {
    const locale = currentLocale();
    const table = STRINGS[locale] || STRINGS.en;
    if (table[key] !== undefined) return table[key];
    if (STRINGS.en[key] !== undefined) return STRINGS.en[key];
    return fallback !== undefined ? fallback : key;
}
