const path = require('path');
const { app } = require('electron');

const IS_PACKAGED = app.isPackaged;

function appDir() {
    return process.env.JAN_APP_DIR || app.getAppPath();
}

function resolveFromApp(...segments) {
    return path.join(appDir(), ...segments);
}

function resolveRenderer(...segments) {
    return resolveFromApp('src', 'renderer', ...segments);
}

function resolveModuleFile(...segments) {
    return path.join(appDir(), 'node_modules', ...segments);
}

function resourcesPath(...segments) {
    return path.join(process.resourcesPath, ...segments);
}

module.exports = {
    IS_PACKAGED,
    resolveFromApp,
    resolveRenderer,
    resolveModuleFile,
    resourcesPath,
};
