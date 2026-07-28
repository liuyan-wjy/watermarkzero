import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readdir } from 'node:fs/promises';

import sharp from 'sharp';

const SUPPORTED_INPUT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

function resolvePathFlavor(filePath) {
    if (typeof filePath !== 'string') {
        return path;
    }

    if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\') || filePath.includes('\\')) {
        return path.win32;
    }

    return path.posix;
}

export function buildWebpOutputPath(inputPath, { outputDirName = 'webp' } = {}) {
    const pathFlavor = resolvePathFlavor(inputPath);
    const parsed = pathFlavor.parse(inputPath);
    return pathFlavor.join(parsed.dir, outputDirName, `${parsed.name}.webp`);
}

async function listInputImages(inputDir) {
    const entries = await readdir(inputDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(inputDir, entry.name))
        .filter((filePath) => SUPPORTED_INPUT_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
        .sort((a, b) => a.localeCompare(b));
}

export async function convertImageToWebp(inputPath, { quality = 80 } = {}) {
    const outputPath = buildWebpOutputPath(inputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });

    await sharp(inputPath)
        .webp({ quality })
        .toFile(outputPath);

    return {
        inputPath,
        outputPath
    };
}

export async function convertDirectoryToWebp(inputDir, { quality = 80 } = {}) {
    const files = await listInputImages(inputDir);
    const results = [];

    for (const filePath of files) {
        results.push(await convertImageToWebp(filePath, { quality }));
    }

    return results;
}

function parseCliArgs(argv) {
    const args = [...argv];
    let quality = 80;
    let inputDir = 'src/assets/samples';

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--quality' || arg === '-q') {
            const nextValue = Number.parseInt(args[index + 1] || '', 10);
            if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 100) {
                throw new Error('quality must be an integer between 1 and 100');
            }
            quality = nextValue;
            index += 1;
            continue;
        }

        if (!arg.startsWith('-')) {
            inputDir = arg;
            continue;
        }

        throw new Error(`unknown argument: ${arg}`);
    }

    return {
        inputDir: path.resolve(inputDir),
        quality
    };
}

async function runCli() {
    const { inputDir, quality } = parseCliArgs(process.argv.slice(2));
    const results = await convertDirectoryToWebp(inputDir, { quality });

    for (const item of results) {
        console.log(`${path.basename(item.inputPath)} -> ${path.relative(inputDir, item.outputPath)}`);
    }

    console.log(`converted ${results.length} file(s) under ${inputDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runCli().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
