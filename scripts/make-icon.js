const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const png2icons = require('png2icons');

const ROOT = path.resolve(__dirname, '..');
const inputPath = process.argv[2] || path.join(ROOT, 'src', 'renderer', 'static', 'img', 'logo.png');
const outputPath = process.argv[3] || path.join(ROOT, 'build', 'icon.ico');

function padToSquare(pngBuffer) {
    const src = PNG.sync.read(pngBuffer);
    if (src.width === src.height) {
        return { buffer: pngBuffer, width: src.width, height: src.height, padded: false };
    }
    const side = Math.max(src.width, src.height);
    const out = new PNG({ width: side, height: side });
    PNG.bitblt(src, out, 0, 0, src.width, src.height, Math.floor((side - src.width) / 2), Math.floor((side - src.height) / 2));
    return { buffer: PNG.sync.write(out), width: side, height: side, padded: true };
}

function parseIco(buffer) {
    const count = buffer.readUInt16LE(4);
    const sizes = [];
    for (let i = 0; i < count; i++) {
        const offset = 6 + i * 16;
        sizes.push(buffer[offset] === 0 ? 256 : buffer[offset]);
    }
    return sizes;
}

function main() {
    if (!fs.existsSync(inputPath)) {
        console.error('input PNG not found:', inputPath);
        process.exit(1);
    }
    const squared = padToSquare(fs.readFileSync(inputPath));
    if (squared.padded) {
        console.log(`padded to square ${squared.width}x${squared.height}`);
    }
    if (Math.min(squared.width, squared.height) < 256) {
        console.warn(`warning: source is smaller than 256x256 (${squared.width}x${squared.height}), small sizes may look blurry`);
    }
    const ico = png2icons.createICO(squared.buffer, png2icons.BICUBIC, 0, true);
    if (!ico) {
        console.error('failed to create ICO');
        process.exit(1);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, ico);
    console.log('created', outputPath, `${ico.length} bytes`, 'sizes:', parseIco(ico).join(','));
}

main();
