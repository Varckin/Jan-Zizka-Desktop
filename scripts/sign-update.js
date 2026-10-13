const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const { signUpdateString } = require(path.join(ROOT, 'src', 'main', 'updateSig.js'));

function main() {
    const key = process.env.UPDATE_SIGN_KEY;
    if (!key) {
        console.error('UPDATE_SIGN_KEY is not set');
        process.exit(1);
    }
    const ymlPath = process.argv[2] || path.join(ROOT, 'release', 'latest.yml');
    const doc = yaml.load(fs.readFileSync(ymlPath, 'utf8'));
    const fileEntry = Array.isArray(doc.files) && doc.files[0] ? doc.files[0] : null;
    if (!doc.version || !doc.sha512 || !doc.size || !fileEntry) {
        console.error('latest.yml is missing version/sha512/size/files');
        process.exit(1);
    }
    const fields = {
        version: String(doc.version),
        sha512: String(doc.sha512),
        size: String(doc.size),
        path: String(doc.path || fileEntry.url),
    };
    const sig = signUpdateString(key, fields);
    const out = process.argv[3] || path.join(path.dirname(ymlPath), 'update.sig');
    fs.writeFileSync(out, sig + '\n', 'utf8');
    console.log('signed', fields.version, '->', path.relative(ROOT, out));
}

main();
