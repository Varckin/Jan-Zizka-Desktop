const path = require('path');
const nunjucks = require('nunjucks');
const { resolveRenderer, resolveFromApp } = require('./paths');
const settings = require('./settings');
const remote = require('./remote');
const cookieJar = require('./cookieJar');

const VIEWS_DIR = resolveRenderer('views');
const LOCALES_DIR = resolveRenderer('locales');
const DESKTOP_LOCALES_DIR = resolveFromApp('src', 'main', 'desktopLocales');
const SUPPORTED = ['en', 'ru', 'es', 'de'];
const NAMESPACES = ['common', 'auth', 'chat', 'channels', 'e2e', 'profile', 'privacy', 'users', 'push', 'service'];
const CACHE_TTL_MS = 60000;

const env = nunjucks.configure([VIEWS_DIR, LOCALES_DIR], {
    autoescape: true,
    trimBlocks: true,
    lstripBlocks: true,
    watch: false,
});

env.addFilter('json', value => JSON.stringify(value === undefined ? null : value));
env.addFilter('upper_first', value => {
    const text = String(value || '');
    return text.charAt(0).toUpperCase() + text.slice(1);
});

const bundledCache = new Map();
let state = { locale: 'en', dict: {}, builtAt: 0, building: null };

function loadBundledDict(locale) {
    if (bundledCache.has(locale)) return bundledCache.get(locale);
    const dict = {};
    for (const ns of NAMESPACES) {
        try {
            const file = path.join(LOCALES_DIR, locale, `${ns}.json`);
            Object.assign(dict, JSON.parse(require('fs').readFileSync(file, 'utf8')));
        } catch {
        }
    }
    bundledCache.set(locale, dict);
    return dict;
}

const desktopCache = new Map();

function loadDesktopDict(locale) {
    if (desktopCache.has(locale)) return desktopCache.get(locale);
    let dict = {};
    try {
        dict = JSON.parse(require('fs').readFileSync(path.join(DESKTOP_LOCALES_DIR, `${locale}.json`), 'utf8'));
    } catch {
        dict = {};
    }
    desktopCache.set(locale, dict);
    return dict;
}

function parseTranslationsJs(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

function detectLocale() {
    const fromCookie = cookieJar.getCookie('locale');
    if (fromCookie && SUPPORTED.includes(fromCookie)) return fromCookie;
    const forced = settings.get('locale');
    if (forced && SUPPORTED.includes(forced)) return forced;
    try {
        const { app } = require('electron');
        const candidate = String(app.getLocale() || 'en').split('-')[0].toLowerCase();
        if (SUPPORTED.includes(candidate)) return candidate;
    } catch {
    }
    return 'en';
}

async function fetchRemoteDict() {
    try {
        const res = await remote.requestText('GET', '/i18n/translations.js');
        if (res.status !== 200 || typeof res.text !== 'string') return null;
        return parseTranslationsJs(res.text);
    } catch {
        return null;
    }
}

async function buildDictionary(force = false) {
    if (!force && state.builtAt && Date.now() - state.builtAt < CACHE_TTL_MS) return state;
    if (state.building) return state.building;
    state.building = (async () => {
        const locale = detectLocale();
        const remoteDict = await fetchRemoteDict();
        const dict = Object.assign(
            {},
            loadBundledDict('en'),
            loadBundledDict(locale),
            remoteDict || {},
            loadDesktopDict('en'),
            loadDesktopDict(locale),
        );
        state = { locale, dict, builtAt: Date.now(), building: null };
        return state;
    })();
    try {
        return await state.building;
    } finally {
        state.building = null;
    }
}

function invalidate() {
    state.builtAt = 0;
}

function makeTranslator() {
    return function t(key, params) {
        let value = state.dict ? state.dict[key] : undefined;
        if (value === undefined) value = loadBundledDict('en')[key];
        if (value === undefined) value = key;
        value = String(value);
        if (params && typeof params === 'object') {
            value = value.replace(/\{(\w+)\}/g, (match, name) => (
                params[name] === undefined ? match : String(params[name])
            ));
        }
        return value;
    };
}

function baseContext(extra) {
    const pkg = require(resolveFromApp('package.json'));
    const serverUrl = remote.serverOrigin();
    let serverHost = serverUrl;
    try {
        serverHost = new URL(serverUrl).host;
    } catch {
    }
    return Object.assign({
        t: makeTranslator(),
        locale: state.locale,
        appVersion: pkg.version,
        appName: pkg.productName,
        year: new Date().getFullYear(),
        serverUrl,
        serverHost,
    }, extra || {});
}

async function renderAsync(template, context, forceRebuild = true) {
    await buildDictionary(forceRebuild);
    return env.render(template, baseContext(context));
}

module.exports = {
    env,
    renderAsync,
    buildDictionary,
    invalidate,
    makeTranslator,
    SUPPORTED,
};
