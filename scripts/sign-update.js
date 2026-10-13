const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const { signUpdateString } = require(path.join(ROOT, 'src', 'main', 'updateSig.js'));

function findExe(dir) {
    const candidates = fs.readdirSync(dir).filter(f => f.endsWith('.exe'));
    if (candidates.length !== 1) {
        throw new Error(`expected exactly one exe in ${dir}, found: ${candidates.join(', ') || 'none'}`);
    }
    return candidates[0];
}

function main() {
    const key = process.env.UPDATE_SIGN_KEY;
    if (!key) {
        console.error('UPDATE_SIGN_KEY is not set');
        process.exit(1);
    }
    const outDir = process.argv[2] || path.join(ROOT, 'release');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const version = String(process.env.UPDATE_VERSION || pkg.version).replace(/^v/i, '');
    const exeName = findExe(outDir);
    const exePath = path.join(outDir, exeName);
    const bytes = fs.readFileSync(exePath);
    const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
    const size = bytes.length;

    const yml = [
        `version: ${version}`,
        'files:',
        `  - url: ${exeName}`,
        `    sha512: ${sha512}`,
        `    size: ${size}`,
        `path: ${exeName}`,
        `sha512: ${sha512}`,
        `size: ${size}`,
        `releaseDate: '${new Date().toISOString()}'`,
        '',
    ].join('\n');

    const ymlPath = process.argv[3] || path.join(outDir, 'latest.yml');
    fs.writeFileSync(ymlPath, yml, 'utf8');

    const fields = { version, sha512, size: String(size), path: exeName };
    const sig = signUpdateString(key, fields);
    const sigPath = process.argv[4] || path.join(outDir, 'update.sig');
    fs.writeFileSync(sigPath, sig + '\n', 'utf8');

    console.log('update meta prepared and signed:', version, exeName, `${size} bytes`);
}

main();
