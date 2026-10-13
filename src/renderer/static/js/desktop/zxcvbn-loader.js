const SCRIPTS = [
    '/static/js/zxcvbn-umd/core.js',
    '/static/js/zxcvbn-umd/language-common.js',
    '/static/js/zxcvbn-umd/language-en.js',
];

let loadPromise = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            resolve();
            return;
        }
        const tag = document.createElement('script');
        tag.src = src;
        tag.async = false;
        tag.onload = () => resolve();
        tag.onerror = () => reject(new Error('failed to load ' + src));
        document.head.appendChild(tag);
    });
}

export function loadZxcvbnUmd() {
    if (window.zxcvbnts && window.zxcvbnts.core) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    loadPromise = SCRIPTS.reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve())
        .then(() => true)
        .catch(err => {
            loadPromise = null;
            throw err;
        });
    return loadPromise;
}
