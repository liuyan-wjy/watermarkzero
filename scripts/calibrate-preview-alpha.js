import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

import { calculateAlphaMap } from '../src/core/alphaMap.js';
import { interpolateAlphaMap } from '../src/core/adaptiveDetector.js';
import {
    aggregatePreviewAlphaMaps,
    fitPreviewOnlyRenderModel,
    estimatePreviewAlphaMap,
    fitConstrainedPreviewAlphaModel
} from '../src/core/previewAlphaCalibration.js';
import { processWatermarkImageData } from '../src/core/watermarkProcessor.js';

const DEFAULT_OUTPUT_PATH = path.resolve('.artifacts/preview-alpha-map/preview-alpha-map.json');

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

async function resizeImageDataInNode(filePath, width, height) {
    const { data, info } = await sharp(filePath)
        .resize(width, height, { fit: 'fill' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    return {
        width: info.width,
        height: info.height,
        data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
    };
}

function serializeAlphaMap(alphaMap) {
    return [...alphaMap].map((value) => Number(value.toFixed(6)));
}

export function buildPreviewAlphaOutputPath({ outputRoot, size }) {
    return path.resolve(outputRoot, `preview-alpha-map-${size}.json`);
}

export function parsePreviewAlphaCalibrationCliArgs(args) {
    const parsed = {
        pairs: [],
        outputPath: DEFAULT_OUTPUT_PATH
    };

    const pending = [...args];
    while (pending.length > 0) {
        const arg = pending.shift();
        if (arg === '--output') {
            parsed.outputPath = path.resolve(pending.shift() || parsed.outputPath);
            continue;
        }
        if (arg === '--pair') {
            const sourcePath = pending.shift();
            const previewPath = pending.shift();
            if (!sourcePath || !previewPath) {
                throw new Error('--pair requires <sourcePath> <previewPath>');
            }
            parsed.pairs.push({
                sourcePath: path.resolve(sourcePath),
                previewPath: path.resolve(previewPath)
            });
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    return parsed;
}

export async function calibratePreviewAlphaPairs({
    pairs,
    outputPath = DEFAULT_OUTPUT_PATH
}) {
    if (!Array.isArray(pairs) || pairs.length === 0) {
        throw new Error('calibratePreviewAlphaPairs requires at least one source/preview pair');
    }

    const alpha48 = calculateAlphaMap(await decodeImageDataInNode(path.resolve('src/assets/bg_48.png')));
    const alpha96 = calculateAlphaMap(await decodeImageDataInNode(path.resolve('src/assets/bg_96.png')));
    const getAlphaMap = (size) => size === 48 ? alpha48 : size === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, size);

    const freeformBuckets = new Map();
    const constrainedBuckets = new Map();
    const pairReports = [];

    for (const pair of pairs) {
        const previewImageData = await decodeImageDataInNode(pair.previewPath);
        const sourceImageData = await resizeImageDataInNode(
            pair.sourcePath,
            previewImageData.width,
            previewImageData.height
        );
        const processed = processWatermarkImageData(previewImageData, {
            alpha48,
            alpha96,
            adaptiveMode: 'never',
            maxPasses: 4,
            getAlphaMap
        });
        const position = processed.meta.position;
        if (!position) {
            throw new Error(`Failed to detect preview watermark region for ${pair.previewPath}`);
        }

        const estimatedAlphaMap = estimatePreviewAlphaMap({
            sourceImageData,
            previewImageData,
            position
        });
        const standardAlphaMap = getAlphaMap(position.width);
        const constrained = fitConstrainedPreviewAlphaModel({
            sourceImageData,
            previewImageData,
            standardAlphaMap,
            position
        });
        const previewOnly = fitPreviewOnlyRenderModel({
            previewImageData,
            standardAlphaMap,
            position,
            blendStrengthCandidates: [0.55, 0.7, 0.85, 1],
            priorRadiusCandidates: [4, 6, 8, 10],
            boundaryContinuityWeight: 12
        });
        const freeformBucket = freeformBuckets.get(position.width) ?? [];
        freeformBucket.push(estimatedAlphaMap);
        freeformBuckets.set(position.width, freeformBucket);

        const constrainedBucket = constrainedBuckets.get(position.width) ?? [];
        constrainedBucket.push(constrained.alphaMap);
        constrainedBuckets.set(position.width, constrainedBucket);

        pairReports.push({
            sourcePath: pair.sourcePath,
            previewPath: pair.previewPath,
            position,
            source: processed.meta.source,
            passStopReason: processed.meta.passStopReason,
            constrainedFit: {
                alphaGain: constrained.alphaGain,
                score: Number(constrained.score.toFixed(6)),
                shift: constrained.params.shift,
                blurRadius: constrained.params.blurRadius
            },
            previewOnlyFit: {
                alphaGain: previewOnly.alphaGain,
                score: Number(previewOnly.score.toFixed(6)),
                shift: previewOnly.params.shift,
                alphaBlurRadius: previewOnly.params.alphaBlurRadius,
                compositeBlurRadius: previewOnly.params.compositeBlurRadius,
                blendStrength: previewOnly.params.blendStrength,
                priorRadius: previewOnly.params.priorRadius
            },
            previewOnlyDiagnostics: {
                forwardScore: Number((previewOnly.diagnostics?.forwardScore ?? 0).toFixed(6)),
                inverseScore: Number((previewOnly.diagnostics?.inverseScore ?? 0).toFixed(6)),
                boundaryScore: Number((previewOnly.diagnostics?.boundaryScore ?? 0).toFixed(6)),
                boundaryRawScore: Number((previewOnly.diagnostics?.boundaryRawScore ?? 0).toFixed(6)),
                boundaryPreviewScore: Number((previewOnly.diagnostics?.boundaryPreviewScore ?? 0).toFixed(6)),
                boundaryContrastScore: Number((previewOnly.diagnostics?.boundaryContrastScore ?? 0).toFixed(6)),
                boundaryNormalizer: Number((previewOnly.diagnostics?.boundaryNormalizer ?? 1).toFixed(6))
            }
        });
    }

    const bucketEntries = [...freeformBuckets.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([size, alphaMaps]) => {
            const aggregated = aggregatePreviewAlphaMaps(alphaMaps);
            return {
                size,
                sampleCount: alphaMaps.length,
                alphaMap: serializeAlphaMap(aggregated)
            };
        });
    const constrainedBucketEntries = [...constrainedBuckets.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([size, alphaMaps]) => {
            const aggregated = aggregatePreviewAlphaMaps(alphaMaps);
            return {
                size,
                sampleCount: alphaMaps.length,
                alphaMap: serializeAlphaMap(aggregated)
            };
        });

    const payload = {
        generatedAt: new Date().toISOString(),
        bucketCount: bucketEntries.length,
        buckets: bucketEntries,
        constrainedBucketCount: constrainedBucketEntries.length,
        constrainedBuckets: constrainedBucketEntries,
        pairs: pairReports
    };

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);

    return {
        outputPath,
        payload
    };
}

async function runCli() {
    const parsed = parsePreviewAlphaCalibrationCliArgs(process.argv.slice(2));
    const result = await calibratePreviewAlphaPairs(parsed);
    console.log(`preview alpha map written to ${result.outputPath}`);
    for (const bucket of result.payload.buckets) {
        console.log(`freeform size ${bucket.size}: ${bucket.sampleCount} sample(s)`);
    }
    for (const bucket of result.payload.constrainedBuckets || []) {
        console.log(`constrained size ${bucket.size}: ${bucket.sampleCount} sample(s)`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runCli().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
