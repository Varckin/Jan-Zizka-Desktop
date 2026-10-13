const fs = require('fs');
const path = require('path');

const PUBLISH_KEYS = ['provider', 'owner', 'repo', 'releaseType', 'channel', 'private'];

function firstPublishConfig(packager) {
    const publish = packager.config.publish;
    if (publish == null) return null;
    const list = Array.isArray(publish) ? publish : [publish];
    const source = list.find(item => item != null && typeof item === 'object');
    if (source == null) return null;
    const result = { provider: 'github' };
    for (const key of PUBLISH_KEYS) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
            result[key] = source[key];
        }
    }
    return result;
}

function toYaml(config) {
    return Object.keys(config).map(key => `${key}: ${config[key]}`).join('\n') + '\n';
}

module.exports = async function afterPack(context) {
    if (context.electronPlatformName !== 'win32') return;
    const packager = context.packager;
    const resourcesDir = packager.getResourcesDir(context.appOutDir);
    const target = path.join(resourcesDir, 'app-update.yml');
    if (fs.existsSync(target)) return;
    const publishConfig = firstPublishConfig(packager);
    if (publishConfig == null) return;
    publishConfig.updaterCacheDirName = packager.appInfo.updaterCacheDirName;
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.writeFileSync(target, toYaml(publishConfig), 'utf8');
};
