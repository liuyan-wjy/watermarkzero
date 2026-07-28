import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readdir, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

import { calculateAlphaMap } from '../src/core/alphaMap.js';
import { interpolateAlphaMap } from '../src/core/adaptiveDetector.js';
import { processWatermarkImageData } from '../src/core/watermarkProcessor.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
function resolvePathFlavor(filePath) {
    if (typeof filePath !== 'string') {
        return path;
    }

    if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\') || filePath.includes('\\')) {
        return path.win32;
    }

    return path.posix;
}

export function buildFixedOutputPath(inputPath) {
    const pathFlavor = resolvePathFlavor(inputPath);
    const parsed = pathFlavor.parse(inputPath);
    if (pathFlavor.basename(parsed.dir).toLowerCase() === 'fix') {
        return inputPath;
    }

    return pathFlavor.join(parsed.dir, 'fix', parsed.base);
}

export async function writeFixedOutput(outputPath, outputBuffer, { overwrite = true } = {}) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, outputBuffer, {
        flag: overwrite ? 'w' : 'wx'
    });
}

function inferMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.webp') return 'image/webp';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    return 'image/png';
}

async function decodeImageDataInNode(filePath) {
    const { data, info } = await sharp(filePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    return {
        width: info.width,
        height: info.height,
        data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
    };
}

async function encodeImageDataToBuffer(imageData, filePath) {
    const mimeType = inferMimeType(filePath);
    const encoder = sharp(Buffer.from(imageData.data), {
        raw: {
            width: imageData.width,
            height: imageData.height,
            channels: 4
        }
    });

    if (mimeType === 'image/webp') {
        return await encoder.webp().toBuffer();
    }
    if (mimeType === 'image/jpeg') {
        return await encoder.jpeg().toBuffer();
    }
    return await encoder.png().toBuffer();
}

async function listInputImages(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(dirPath, entry.name))
        .filter((filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            const normalizedPath = filePath.toLowerCase();
            return IMAGE_EXTENSIONS.has(ext)
                && !normalizedPath.includes('-fix.')
                && !normalizedPath.includes('-after.');
        })
        .sort((a, b) => a.localeCompare(b));
}

function resolveFixedOutputDir(inputDir) {
    const resolvedInputDir = path.resolve(inputDir);
    if (path.basename(resolvedInputDir).toLowerCase() === 'fix') {
        return resolvedInputDir;
    }

    return path.join(resolvedInputDir, 'fix');
}

export async function exportFixedSamples(inputDir, { overwrite = true } = {}) {
    const bg48Path = path.resolve('src/assets/bg_48.png');
    const bg96Path = path.resolve('src/assets/bg_96.png');
    const files = await listInputImages(inputDir);
    const results = [];

    const alpha48 = calculateAlphaMap(await decodeImageDataInNode(bg48Path));
    const alpha96 = calculateAlphaMap(await decodeImageDataInNode(bg96Path));
    const alphaResolver = (size) => {
        if (size === 48) return alpha48;
        if (size === 96) return alpha96;
        return interpolateAlphaMap(alpha96, 96, size);
    };

    for (const filePath of files) {
        const imageData = await decodeImageDataInNode(filePath);
        const outputPath = buildFixedOutputPath(filePath);
        const processed = processWatermarkImageData(imageData, {
            alpha48,
            alpha96,
            maxPasses: 4,
            getAlphaMap: alphaResolver
        });
        const outputBuffer = await encodeImageDataToBuffer(processed.imageData, filePath);
        await writeFixedOutput(outputPath, outputBuffer, { overwrite });

        results.push({
            inputPath: filePath,
            outputPath,
            meta: processed.meta
        });
    }

    return results;
}

async function runCli() {
    const args = process.argv.slice(2);
    const overwrite = !args.includes('--no-overwrite');
    const inputArg = args.find((arg) => !arg.startsWith('--'));
    const inputDir = path.resolve(inputArg || 'src/assets/samples');
    const results = await exportFixedSamples(inputDir, { overwrite });

    for (const item of results) {
        const passInfo = `${item.meta.passCount} pass(es), stop=${item.meta.passStopReason}`;
        console.log(`${path.basename(item.inputPath)} -> ${path.basename(item.outputPath)} | ${passInfo}`);
    }

    console.log(`exported ${results.length} file(s) to ${resolveFixedOutputDir(inputDir)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runCli().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
