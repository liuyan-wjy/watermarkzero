import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';

import { chromium } from 'playwright';

import { calculateAlphaMap } from '../../src/core/alphaMap.js';
import { removeWatermark } from '../../src/core/blendModes.js';
import { removeRepeatedWatermarkLayers } from '../../src/core/multiPassRemoval.js';
import { processWatermarkImageData } from '../../src/core/watermarkProcessor.js';
import {
    computeRegionSpatialCorrelation,
    computeRegionGradientCorrelation,
    detectAdaptiveWatermarkRegion,
    interpolateAlphaMap,
    warpAlphaMap,
    shouldAttemptAdaptiveFallback
} from '../../src/core/adaptiveDetector.js';
import {
    hasReliableAdaptiveWatermarkSignal,
    hasReliableStandardWatermarkSignal
} from '../../src/core/watermarkPresence.js';
import {
    calculateWatermarkPosition,
    detectWatermarkConfig,
    resolveInitialStandardConfig
} from '../../src/core/watermarkConfig.js';
import {
    decodeImageDataInPage,
    inferMimeType,
    isMissingPlaywrightExecutableError
} from './sampleAssetTestUtils.js';

const ROOT_DIR = process.cwd();
const SAMPLE_DIR = path.resolve(ROOT_DIR, 'src/assets/samples');
const BG48_PATH = path.resolve(ROOT_DIR, 'src/assets/bg_48.png');
const BG96_PATH = path.resolve(ROOT_DIR, 'src/assets/bg_96.png');
const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg']);
const EXACT_OFFICIAL_48_SAMPLE_ASSETS = Object.freeze([
    '1-1.webp',
    '21-9.webp',
    '3-2.webp',
    '3-4.webp',
    '4-3.webp',
    '4-5.webp',
    '5-4.webp'
]);
const RESIDUAL_RECALIBRATION_THRESHOLD = 0.5;
const MIN_SUPPRESSION_FOR_SKIP_RECALIBRATION = 0.18;
const MIN_RECALIBRATION_SCORE_DELTA = 0.18;
const OUTLINE_REFINEMENT_THRESHOLD = 0.42;
const OUTLINE_REFINEMENT_MIN_GAIN = 1.2;
const ALPHA_GAIN_CANDIDATES = (() => {
    const candidates = [];

    for (let gain = 1.15; gain <= 1.65; gain += 0.01) {
        candidates.push(Number(gain.toFixed(2)));
    }

    for (let gain = 1.7; gain <= 2.6; gain += 0.1) {
        candidates.push(Number(gain.toFixed(2)));
    }

    return candidates;
})();
const NEAR_BLACK_THRESHOLD = 5;
const MAX_NEAR_BLACK_RATIO_INCREASE = 0.05;
const SUBPIXEL_SHIFTS = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];
const SUBPIXEL_SCALES = [0.98, 0.99, 1, 1.01, 1.02];

async function listSampleAssetFiles() {
    return (await readdir(SAMPLE_DIR))
        .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .filter((name) => !name.includes('-fix.'))
        .filter((name) => !name.includes('-after.'))
        .sort((a, b) => a.localeCompare(b));
}

test('sample asset manifest should expose at least one supported fixture image for every sample base name', async () => {
    const files = await listSampleAssetFiles();
    const variantsByBaseName = new Map();

    for (const fileName of files) {
        const ext = path.extname(fileName).toLowerCase();
        const baseName = path.basename(fileName, ext);
        const variants = variantsByBaseName.get(baseName) ?? new Set();
        variants.add(ext);
        variantsByBaseName.set(baseName, variants);
    }

    assert.ok(files.length > 0, 'expected sample asset directory to contain regression images');
    assert.ok(variantsByBaseName.size > 0, 'expected at least one sample base name');

    for (const [baseName, variants] of variantsByBaseName) {
        assert.ok(
            variants.has('.webp') || variants.has('.png'),
            `expected ${baseName} to provide at least one supported sample variant`
        );
    }
});

test('isMissingPlaywrightExecutableError should detect missing-browser launch error', () => {
    const error = new Error(
        'browserType.launch: Executable doesn\'t exist at /tmp/playwright/chrome-headless-shell'
    );
    assert.equal(isMissingPlaywrightExecutableError(error), true);
});

test('isMissingPlaywrightExecutableError should ignore unrelated errors', () => {
    const error = new Error('network timeout');
    assert.equal(isMissingPlaywrightExecutableError(error), false);
});

function cloneImageData(imageData) {
    return {
        width: imageData.width,
        height: imageData.height,
        data: new Uint8ClampedArray(imageData.data)
    };
}

function createSolidImageData(width, height, value = 32) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        data[idx] = value;
        data[idx + 1] = value;
        data[idx + 2] = value;
        data[idx + 3] = 255;
    }

    return { width, height, data };
}

function shouldRecalibrateAlphaStrength({ originalScore, processedScore, suppressionGain }) {
    return originalScore >= 0.6 &&
        processedScore >= RESIDUAL_RECALIBRATION_THRESHOLD &&
        suppressionGain <= MIN_SUPPRESSION_FOR_SKIP_RECALIBRATION;
}

function recalibrateAlphaStrength({
    originalImageData,
    alphaMap,
    position,
    originalSpatialScore,
    processedSpatialScore,
    originalNearBlackRatio
}) {
    let bestScore = processedSpatialScore;
    let bestGain = 1;
    let bestImageData = null;
    const maxAllowedNearBlackRatio = Math.min(1, originalNearBlackRatio + MAX_NEAR_BLACK_RATIO_INCREASE);

    for (const alphaGain of ALPHA_GAIN_CANDIDATES) {
        const candidate = cloneImageData(originalImageData);
        removeWatermark(candidate, alphaMap, position, { alphaGain });
        const candidateNearBlackRatio = calculateNearBlackRatio(candidate, position);
        if (candidateNearBlackRatio > maxAllowedNearBlackRatio) {
            continue;
        }

        const score = computeRegionSpatialCorrelation({
            imageData: candidate,
            alphaMap,
            region: {
                x: position.x,
                y: position.y,
                size: position.width
            }
        });

        if (score < bestScore) {
            bestScore = score;
            bestGain = alphaGain;
            bestImageData = candidate;
        }
    }

    const scoreDelta = processedSpatialScore - bestScore;
    if (!bestImageData || scoreDelta < MIN_RECALIBRATION_SCORE_DELTA) {
        return null;
    }

    return {
        imageData: bestImageData,
        alphaGain: bestGain,
        processedSpatialScore: bestScore,
        suppressionGain: originalSpatialScore - bestScore
    };
}

function calculateNearBlackRatio(imageData, position) {
    let nearBlack = 0;
    let total = 0;
    for (let row = 0; row < position.height; row++) {
        for (let col = 0; col < position.width; col++) {
            const idx = ((position.y + row) * imageData.width + (position.x + col)) * 4;
            const r = imageData.data[idx];
            const g = imageData.data[idx + 1];
            const b = imageData.data[idx + 2];
            if (r <= NEAR_BLACK_THRESHOLD && g <= NEAR_BLACK_THRESHOLD && b <= NEAR_BLACK_THRESHOLD) {
                nearBlack++;
            }
            total++;
        }
    }

    return total > 0 ? nearBlack / total : 0;
}

function measureRegionDelta(originalImageData, processedImageData, position) {
    let changedPixels = 0;
    let totalPixels = 0;
    let totalAbsoluteDelta = 0;

    for (let row = 0; row < position.height; row++) {
        for (let col = 0; col < position.width; col++) {
            const idx = ((position.y + row) * originalImageData.width + (position.x + col)) * 4;
            let pixelChanged = false;

            for (let channel = 0; channel < 3; channel++) {
                const delta = Math.abs(processedImageData.data[idx + channel] - originalImageData.data[idx + channel]);
                totalAbsoluteDelta += delta;
                if (delta > 0) pixelChanged = true;
            }

            if (pixelChanged) changedPixels++;
            totalPixels++;
        }
    }

    return {
        changedPixels,
        totalPixels,
        changedRatio: totalPixels > 0 ? changedPixels / totalPixels : 0,
        avgAbsoluteDeltaPerChannel: totalPixels > 0 ? totalAbsoluteDelta / (totalPixels * 3) : 0
    };
}

function getRegionStats(imageData, region) {
    let sum = 0;
    let sq = 0;
    let total = 0;

    for (let row = 0; row < region.height; row++) {
        for (let col = 0; col < region.width; col++) {
            const idx = ((region.y + row) * imageData.width + (region.x + col)) * 4;
            const lum =
                0.2126 * imageData.data[idx] +
                0.7152 * imageData.data[idx + 1] +
                0.0722 * imageData.data[idx + 2];
            sum += lum;
            sq += lum * lum;
            total++;
        }
    }

    const meanLum = total > 0 ? sum / total : 0;
    const variance = total > 0 ? Math.max(0, sq / total - meanLum * meanLum) : 0;

    return {
        meanLum,
        stdLum: Math.sqrt(variance)
    };
}

function measureAlphaBandHalo(imageData, position, alphaMap, {
    minAlpha = 0.12,
    maxAlpha = 0.35,
    outsideAlphaMax = 0.01,
    outerMargin = 3
} = {}) {
    let bandSum = 0;
    let bandSq = 0;
    let bandCount = 0;
    let outerSum = 0;
    let outerSq = 0;
    let outerCount = 0;

    for (let row = -outerMargin; row < position.height + outerMargin; row++) {
        for (let col = -outerMargin; col < position.width + outerMargin; col++) {
            const pixelX = position.x + col;
            const pixelY = position.y + row;
            if (pixelX < 0 || pixelY < 0 || pixelX >= imageData.width || pixelY >= imageData.height) {
                continue;
            }

            const pixelIndex = (pixelY * imageData.width + pixelX) * 4;
            const luminance =
                0.2126 * imageData.data[pixelIndex] +
                0.7152 * imageData.data[pixelIndex + 1] +
                0.0722 * imageData.data[pixelIndex + 2];
            const insideRegion = row >= 0 && col >= 0 && row < position.height && col < position.width;
            const alpha = insideRegion
                ? alphaMap[row * position.width + col]
                : 0;

            if (insideRegion && alpha >= minAlpha && alpha <= maxAlpha) {
                bandSum += luminance;
                bandSq += luminance * luminance;
                bandCount++;
                continue;
            }

            if (!insideRegion || alpha <= outsideAlphaMax) {
                outerSum += luminance;
                outerSq += luminance * luminance;
                outerCount++;
            }
        }
    }

    const bandMeanLum = bandCount > 0 ? bandSum / bandCount : 0;
    const outerMeanLum = outerCount > 0 ? outerSum / outerCount : 0;
    const bandStdLum = bandCount > 0 ? Math.sqrt(Math.max(0, bandSq / bandCount - bandMeanLum * bandMeanLum)) : 0;
    const outerStdLum = outerCount > 0 ? Math.sqrt(Math.max(0, outerSq / outerCount - outerMeanLum * outerMeanLum)) : 0;

    return {
        bandCount,
        outerCount,
        bandMeanLum,
        outerMeanLum,
        deltaLum: bandMeanLum - outerMeanLum,
        bandStdLum,
        outerStdLum,
        visibility: (bandMeanLum - outerMeanLum) / Math.max(1, outerStdLum)
    };
}

function refineSubpixelOutline({
    originalImageData,
    alphaMap,
    position,
    alphaGain,
    originalNearBlackRatio,
    baselineSpatialScore,
    baselineGradientScore
}) {
    const size = position.width;
    if (!size || size <= 8) return null;
    if (alphaGain < OUTLINE_REFINEMENT_MIN_GAIN) return null;

    const maxAllowedNearBlackRatio = Math.min(1, originalNearBlackRatio + MAX_NEAR_BLACK_RATIO_INCREASE);
    const gainCandidates = [alphaGain];
    const lower = Math.max(1, Number((alphaGain - 0.02).toFixed(2)));
    const upper = Number((alphaGain + 0.02).toFixed(2));
    if (lower !== alphaGain) gainCandidates.push(lower);
    if (upper !== alphaGain) gainCandidates.push(upper);

    let best = null;
    for (const scale of SUBPIXEL_SCALES) {
        for (const dy of SUBPIXEL_SHIFTS) {
            for (const dx of SUBPIXEL_SHIFTS) {
                const warped = warpAlphaMap(alphaMap, size, { dx, dy, scale });
                for (const gain of gainCandidates) {
                    const candidate = cloneImageData(originalImageData);
                    removeWatermark(candidate, warped, position, { alphaGain: gain });
                    const nearBlackRatio = calculateNearBlackRatio(candidate, position);
                    if (nearBlackRatio > maxAllowedNearBlackRatio) continue;

                    const spatialScore = computeRegionSpatialCorrelation({
                        imageData: candidate,
                        alphaMap: warped,
                        region: { x: position.x, y: position.y, size }
                    });
                    const gradientScore = computeRegionGradientCorrelation({
                        imageData: candidate,
                        alphaMap: warped,
                        region: { x: position.x, y: position.y, size }
                    });

                    const cost = Math.abs(spatialScore) * 0.6 + Math.max(0, gradientScore);
                    if (!best || cost < best.cost) {
                        best = {
                            imageData: candidate,
                            alphaMap: warped,
                            alphaGain: gain,
                            spatialScore,
                            gradientScore,
                            cost
                        };
                    }
                }
            }
        }
    }

    if (!best) return null;

    const improvedGradient = best.gradientScore <= baselineGradientScore - 0.04;
    const keptSpatial = Math.abs(best.spatialScore) <= Math.abs(baselineSpatialScore) + 0.08;
    if (!improvedGradient || !keptSpatial) return null;

    return best;
}

function removeWatermarkLikeEngine(imageData, alpha48, alpha96) {
    const defaultConfig = detectWatermarkConfig(imageData.width, imageData.height);
    const resolvedConfig = resolveInitialStandardConfig({
        imageData,
        defaultConfig,
        alpha48,
        alpha96
    });

    const defaultPosition = calculateWatermarkPosition(imageData.width, imageData.height, resolvedConfig);
    const defaultAlphaMap = resolvedConfig.logoSize === 96 ? alpha96 : alpha48;
    const standardScore = computeRegionSpatialCorrelation({
        imageData,
        alphaMap: defaultAlphaMap,
        region: {
            x: defaultPosition.x,
            y: defaultPosition.y,
            size: defaultPosition.width
        }
    });
    const standardGradient = computeRegionGradientCorrelation({
        imageData,
        alphaMap: defaultAlphaMap,
        region: {
            x: defaultPosition.x,
            y: defaultPosition.y,
            size: defaultPosition.width
        }
    });

    const processed = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        getAlphaMap: (size) => {
            if (size === 48) return alpha48;
            if (size === 96) return alpha96;
            return interpolateAlphaMap(alpha96, 96, size);
        }
    });

    const position = processed.meta.position ?? defaultPosition;
    const alphaMap = processed.meta.size === 96
        ? alpha96
        : (processed.meta.size === 48 ? alpha48 : interpolateAlphaMap(alpha96, 96, position.width));
    const finalImageData = processed.imageData;

    if (processed.meta.applied === false) {
        const regionDelta = measureRegionDelta(imageData, imageData, position);
        return {
            beforeScore: standardScore,
            beforeGradient: standardGradient,
            afterScore: standardScore,
            afterGradient: standardGradient,
            improvement: 0,
            alphaGain: 1,
            beforeBlackRatio: calculateNearBlackRatio(imageData, position),
            afterBlackRatio: calculateNearBlackRatio(imageData, position),
            position,
            regionDelta,
            skipped: true
        };
    }

    const beforeScore = computeRegionSpatialCorrelation({
        imageData,
        alphaMap,
        region: {
            x: position.x,
            y: position.y,
            size: position.width
        }
    });
    const beforeGradient = computeRegionGradientCorrelation({
        imageData,
        alphaMap,
        region: {
            x: position.x,
            y: position.y,
            size: position.width
        }
    });

    let afterScore = computeRegionSpatialCorrelation({
        imageData: finalImageData,
        alphaMap,
        region: {
            x: position.x,
            y: position.y,
            size: position.width
        }
    });
    let afterGradient = computeRegionGradientCorrelation({
        imageData: finalImageData,
        alphaMap,
        region: {
            x: position.x,
            y: position.y,
            size: position.width
        }
    });
    let improvement = beforeScore - afterScore;
    let alphaGain = 1;

    if (shouldRecalibrateAlphaStrength({
        originalScore: beforeScore,
        processedScore: afterScore,
        suppressionGain: improvement
    })) {
        const originalNearBlackRatio = calculateNearBlackRatio(imageData, position);
        const recalibrated = recalibrateAlphaStrength({
            originalImageData: imageData,
            alphaMap,
            position,
            originalSpatialScore: beforeScore,
            processedSpatialScore: afterScore,
            originalNearBlackRatio
        });

        if (recalibrated) {
            finalImageData = recalibrated.imageData;
            afterScore = recalibrated.processedSpatialScore;
            improvement = recalibrated.suppressionGain;
            alphaGain = recalibrated.alphaGain;
            afterGradient = computeRegionGradientCorrelation({
                imageData: finalImageData,
                alphaMap,
                region: {
                    x: position.x,
                    y: position.y,
                    size: position.width
                }
            });
        }
    }

    if (afterScore <= 0.3 && afterGradient >= OUTLINE_REFINEMENT_THRESHOLD) {
        const originalNearBlackRatio = calculateNearBlackRatio(imageData, position);
        const refined = refineSubpixelOutline({
            originalImageData: imageData,
            alphaMap,
            position,
            alphaGain,
            originalNearBlackRatio,
            baselineSpatialScore: afterScore,
            baselineGradientScore: afterGradient
        });

        if (refined) {
            finalImageData = refined.imageData;
            alphaMap = refined.alphaMap;
            alphaGain = refined.alphaGain;
            afterScore = refined.spatialScore;
            afterGradient = refined.gradientScore;
            improvement = beforeScore - afterScore;
        }
    }

    const beforeBlackRatio = calculateNearBlackRatio(imageData, position);
    const afterBlackRatio = calculateNearBlackRatio(finalImageData, position);
    const regionDelta = measureRegionDelta(imageData, finalImageData, position);

    return {
        beforeScore,
        beforeGradient,
        afterScore,
        afterGradient,
        improvement,
        alphaGain: processed.meta.alphaGain ?? 1,
        beforeBlackRatio,
        afterBlackRatio,
        position,
        regionDelta,
        skipped: false
    };
}

test('known Gemini sample assets should show strong watermark suppression after processing', async (t) => {
    const files = await listSampleAssetFiles();

    assert.ok(files.length > 0, 'known Gemini sample asset list should not be empty');

    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));

        for (const fileName of files) {
            const filePath = path.join(SAMPLE_DIR, fileName);
            const imageData = await decodeImageDataInPage(page, filePath);
            const result = removeWatermarkLikeEngine(imageData, alpha48, alpha96);

            assert.ok(
                !result.skipped,
                `${fileName}: expected processing pipeline to accept sample, spatial=${result.beforeScore}, gradient=${result.beforeGradient}`
            );
            assert.ok(
                result.afterScore < 0.22,
                `${fileName}: expected residual signal after processing < 0.22, got ${result.afterScore}`
            );
            assert.ok(
                result.improvement >= 0.3 || result.afterScore < 0.05,
                `${fileName}: expected strong suppression gain or near-zero residual, gain=${result.improvement}, residual=${result.afterScore}`
            );
            if (result.alphaGain > 1) {
                assert.ok(
                    result.afterBlackRatio <= result.beforeBlackRatio + 0.05,
                    `${fileName}: alphaGain=${result.alphaGain} darkening too strong, beforeBlack=${result.beforeBlackRatio}, afterBlack=${result.afterBlackRatio}`
                );
            }
            if (result.afterScore < 0.22 && result.beforeGradient >= 0) {
                assert.ok(
                    result.afterGradient <= result.beforeGradient,
                    `${fileName}: expected outline gradient to not increase, before=${result.beforeGradient}, after=${result.afterGradient}`
                );
            }
        }
    } finally {
        await browser.close();
    }
});

test('2-3.webp should not be skipped when the standard template has strong gradient evidence', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '2-3.webp');
        const imageData = await decodeImageDataInPage(page, filePath);
        const result = processWatermarkImageData(imageData, {
            alpha48,
            alpha96,
            getAlphaMap: (size) => size === 48 ? alpha48 : interpolateAlphaMap(alpha96, 96, size)
        });
        const position = result.meta.position;
        const alphaMap = result.meta.size === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, result.meta.size);
        const residual = computeRegionSpatialCorrelation({
            imageData: result.imageData,
            alphaMap,
            region: { x: position.x, y: position.y, size: position.width }
        });

        assert.equal(result.meta.applied, true, 'expected 2-3.webp to enter removal pipeline');
        assert.ok(
            result.meta.source.startsWith('standard'),
            `expected 2-3.webp to stay on a standard-template path, got ${result.meta.source}`
        );
        assert.equal(
            result.meta.decisionTier,
            'validated-match',
            `expected 2-3.webp to be accepted through restoration validation, got decisionTier=${result.meta.decisionTier}, source=${result.meta.source}`
        );
        assert.equal(result.meta.size, 96, 'expected 2-3.webp to use the 96px watermark template');
        assert.equal(result.meta.passCount, 1, `expected 2-3.webp to stop after the first safe pass, got ${result.meta.passCount}`);
        assert.ok(residual < 0.22, `expected residual watermark signal < 0.22, got ${residual}`);
    } finally {
        await browser.close();
    }
});

test('exact-official 1K sample assets with visible 48px watermark should fall back to the 48px template', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        for (const fileName of EXACT_OFFICIAL_48_SAMPLE_ASSETS) {
            const filePath = path.join(SAMPLE_DIR, fileName);
            const imageData = await decodeImageDataInPage(page, filePath);
            const result = processWatermarkImageData(imageData, {
                alpha48,
                alpha96,
                getAlphaMap: (size) => size === 48 ? alpha48 : interpolateAlphaMap(alpha96, 96, size)
            });
            const position = result.meta.position;
            const residual = computeRegionSpatialCorrelation({
                imageData: result.imageData,
                alphaMap: alpha48,
                region: { x: position.x, y: position.y, size: position.width }
            });

            assert.equal(result.meta.applied, true, `expected ${fileName} to enter removal pipeline`);
            assert.equal(result.meta.decisionTier, 'direct-match', `expected ${fileName} to be a direct 48px match`);
            assert.equal(result.meta.size, 48, `expected ${fileName} to use a 48px watermark template, got ${result.meta.size}`);
            assert.ok(result.meta.source.startsWith('standard'), `expected ${fileName} to stay on a standard-template path, got ${result.meta.source}`);
            assert.ok(residual < 0.22, `expected ${fileName} residual watermark signal < 0.22, got ${residual}`);
        }
    } finally {
        await browser.close();
    }
});

test('9-16.webp should stop after the first pass when extra passes only reintroduce watermark edges', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '9-16.webp');
        const imageData = await decodeImageDataInPage(page, filePath);
        const firstPassOnly = processWatermarkImageData(imageData, {
            alpha48,
            alpha96,
            maxPasses: 1,
            getAlphaMap: (size) => size === 48 ? alpha48 : interpolateAlphaMap(alpha96, 96, size)
        });
        const fullResult = processWatermarkImageData(imageData, {
            alpha48,
            alpha96,
            maxPasses: 4,
            getAlphaMap: (size) => size === 48 ? alpha48 : interpolateAlphaMap(alpha96, 96, size)
        });
        const position = fullResult.meta.position;
        const alphaMap = fullResult.meta.size === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, fullResult.meta.size);
        const firstPassGradient = computeRegionGradientCorrelation({
            imageData: firstPassOnly.imageData,
            alphaMap,
            region: { x: position.x, y: position.y, size: position.width }
        });
        const finalGradient = computeRegionGradientCorrelation({
            imageData: fullResult.imageData,
            alphaMap,
            region: { x: position.x, y: position.y, size: position.width }
        });

        assert.equal(fullResult.meta.applied, true, 'expected 9-16.webp to enter removal pipeline');
        assert.equal(
            fullResult.meta.passCount,
            1,
            `expected 9-16.webp to stop after the first pass, got passCount=${fullResult.meta.passCount}, stop=${fullResult.meta.passStopReason}`
        );
        assert.ok(
            finalGradient <= firstPassGradient + 0.05,
            `expected extra passes to not reintroduce edge signal, firstPassGradient=${firstPassGradient}, finalGradient=${finalGradient}`
        );
    } finally {
        await browser.close();
    }
});

test('9-16.webp should fall back to the 48px anchor when the exact-official 96px evidence is weak', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '9-16.webp');
        const imageData = await decodeImageDataInPage(page, filePath);
        const result = processWatermarkImageData(imageData, {
            alpha48,
            alpha96,
            maxPasses: 1,
            getAlphaMap: (size) => size === 48 ? alpha48 : size === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, size)
        });

        assert.equal(result.meta.applied, true, 'expected 9-16.webp to enter removal pipeline');
        assert.equal(result.meta.size, 48, `expected 9-16.webp to fall back to the 48px template, got ${result.meta.size}`);
        assert.deepEqual(
            result.meta.selectionDebug?.initialConfig,
            { logoSize: 48, marginRight: 32, marginBottom: 32 },
            `expected initial standard config to be re-resolved to 48px, got ${JSON.stringify(result.meta.selectionDebug?.initialConfig)}`
        );
        assert.equal(
            result.meta.selectionDebug?.usedCatalogVariant,
            false,
            `expected fallback to come from the standard 48px comparison, source=${result.meta.source}`
        );
        assert.ok(
            result.meta.source.startsWith('standard'),
            `expected standard fallback path, got ${result.meta.source}`
        );
        assert.ok(
            result.meta.position.x >= 688 && result.meta.position.x <= 700,
            `expected fallback x anchor near the 48px bottom-right position, got ${result.meta.position.x}`
        );
        assert.ok(
            result.meta.position.y >= 1284 && result.meta.position.y <= 1298,
            `expected fallback y anchor near the 48px bottom-right position, got ${result.meta.position.y}`
        );
    } finally {
        await browser.close();
    }
});

test('9-16-preview.png should keep the preview anchor away from the extreme bottom-right corner', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '9-16-preview.png');
        const imageData = await decodeImageDataInPage(page, filePath);
        const result = processWatermarkImageData(imageData, {
            alpha48,
            alpha96,
            maxPasses: 4,
            getAlphaMap: (size) => size === 48 ? alpha48 : size === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, size)
        });

        assert.equal(result.meta.applied, true, 'expected 9-16-preview.png to enter removal pipeline');
        assert.ok(
            result.meta.source.includes('preview-anchor'),
            `expected 9-16-preview.png to use preview-anchor search, source=${result.meta.source}`
        );
        assert.ok(
            result.meta.position.width >= 34 && result.meta.position.width <= 36,
            `expected preview watermark size near 35px, got ${result.meta.position.width}`
        );
        assert.ok(
            result.meta.position.x >= 512 && result.meta.position.x <= 516,
            `expected preview watermark x anchor near the projected preview position, got ${result.meta.position.x}`
        );
        assert.ok(
            result.meta.position.y >= 964 && result.meta.position.y <= 968,
            `expected preview watermark y anchor near the projected preview position, got ${result.meta.position.y}`
        );
        assert.equal(
            result.meta.passCount,
            1,
            `expected 9-16-preview.png preview-anchor removal to stop after the first pass, got ${result.meta.passCount}`
        );
        assert.ok(
            !result.meta.source.includes('+multipass'),
            `expected 9-16-preview.png preview-anchor path to skip multipass, source=${result.meta.source}`
        );
    } finally {
        await browser.close();
    }
});

test('21-9-preview.png should use preview-anchor edge cleanup to reduce residual watermark edges', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '21-9-preview.png');
        const imageData = await decodeImageDataInPage(page, filePath);
        const result = processWatermarkImageData(imageData, {
            alpha48,
            alpha96,
            maxPasses: 4,
            getAlphaMap: (size) => size === 48 ? alpha48 : size === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, size)
        });

        assert.equal(result.meta.applied, true, 'expected 21-9-preview.png to enter removal pipeline');
        assert.ok(
            result.meta.source.includes('preview-anchor'),
            `expected 21-9-preview.png to use preview-anchor search, source=${result.meta.source}`
        );
        assert.ok(
            result.meta.source.includes('+edge-cleanup'),
            `expected 21-9-preview.png to use preview edge cleanup, source=${result.meta.source}`
        );
        assert.ok(
            result.meta.position.width >= 29 && result.meta.position.width <= 31,
            `expected preview watermark size near 30px, got ${result.meta.position.width}`
        );
        assert.ok(
            result.meta.detection.processedGradientScore < 0.11,
            `expected residual preview gradient < 0.11, got ${result.meta.detection.processedGradientScore}`
        );

        const halo = measureAlphaBandHalo(result.imageData, result.meta.position, interpolateAlphaMap(alpha96, 96, result.meta.position.width));
        assert.ok(
            halo.deltaLum < 4,
            `expected preview halo delta < 4, got ${halo.deltaLum}`
        );
    } finally {
        await browser.close();
    }
});

test('non-watermarked synthetic image should keep the candidate region unchanged', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const imageData = createSolidImageData(1408, 768, 48);
        const result = removeWatermarkLikeEngine(imageData, alpha48, alpha96);

        assert.ok(
            result.regionDelta.changedRatio <= 0.01,
            `expected weak-match region to remain unchanged, changedRatio=${result.regionDelta.changedRatio}, candidateSize=${result.position.width}`
        );
        assert.ok(
            result.regionDelta.avgAbsoluteDeltaPerChannel <= 0.5,
            `expected weak-match region delta <= 0.5, got ${result.regionDelta.avgAbsoluteDeltaPerChannel}`
        );
    } finally {
        await browser.close();
    }
});

test('16-9.webp repeated removal helper should stop after the first pass when residual is already low', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '16-9.webp');
        const imageData = await decodeImageDataInPage(page, filePath);
        const defaultConfig = detectWatermarkConfig(imageData.width, imageData.height);
        const config = resolveInitialStandardConfig({
            imageData,
            defaultConfig,
            alpha48,
            alpha96
        });
        const position = calculateWatermarkPosition(imageData.width, imageData.height, config);
        const alphaMap = config.logoSize === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, config.logoSize);

        const beforeScore = computeRegionSpatialCorrelation({
            imageData,
            alphaMap,
            region: { x: position.x, y: position.y, size: position.width }
        });
        const result = removeRepeatedWatermarkLayers({
            imageData,
            alphaMap,
            position,
            maxPasses: 4
        });
        const afterScore = computeRegionSpatialCorrelation({
            imageData: result.imageData,
            alphaMap,
            region: { x: position.x, y: position.y, size: position.width }
        });

        assert.equal(result.passCount, 1, `expected a single applied pass, got ${result.passCount}`);
        assert.equal(result.attemptedPassCount, 1, `expected no extra pass attempt, got ${result.attemptedPassCount}`);
        assert.equal(result.stopReason, 'residual-low', `unexpected stopReason=${result.stopReason}`);
        assert.ok(afterScore < beforeScore, `expected some suppression, before=${beforeScore}, after=${afterScore}`);
        assert.ok(
            beforeScore - afterScore >= 0.04,
            `expected strong suppression on 16-9.webp, before=${beforeScore}, after=${afterScore}`
        );
    } finally {
        await browser.close();
    }
});

test('16-9.webp repeated removal helper should keep the ROI out of sinkhole-like collapse', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '16-9.webp');
        const imageData = await decodeImageDataInPage(page, filePath);
        const defaultConfig = detectWatermarkConfig(imageData.width, imageData.height);
        const config = resolveInitialStandardConfig({
            imageData,
            defaultConfig,
            alpha48,
            alpha96
        });
        const position = calculateWatermarkPosition(imageData.width, imageData.height, config);
        const alphaMap = config.logoSize === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, config.logoSize);
        const result = removeRepeatedWatermarkLayers({
            imageData,
            alphaMap,
            position,
            maxPasses: 4
        });

        const refRegion = {
            x: position.x,
            y: position.y - position.height,
            width: position.width,
            height: position.height
        };
        const processedStats = getRegionStats(result.imageData, position);
        const referenceStats = getRegionStats(imageData, refRegion);

        assert.ok(
            processedStats.meanLum >= referenceStats.meanLum - 6,
            `expected processed ROI to stay near local reference brightness, processed=${processedStats.meanLum}, reference=${referenceStats.meanLum}`
        );
        assert.ok(
            processedStats.stdLum >= referenceStats.stdLum * 0.8,
            `expected processed ROI to keep local texture variance, processed=${processedStats.stdLum}, reference=${referenceStats.stdLum}`
        );
    } finally {
        await browser.close();
    }
});

test('16-9.webp metadata should report only the passes that were actually applied', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '16-9.webp');
        const imageData = await decodeImageDataInPage(page, filePath);
        const processed = processWatermarkImageData(imageData, {
            alpha48,
            alpha96,
            maxPasses: 4,
            getAlphaMap: (size) => size === 48 ? alpha48 : size === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, size)
        });

        const appliedPasses = processed.meta.passes ?? [];
        const lastAppliedIndex = appliedPasses.length > 0
            ? appliedPasses[appliedPasses.length - 1].index
            : 0;

        assert.equal(
            processed.meta.passCount,
            lastAppliedIndex,
            `passCount=${processed.meta.passCount}, lastAppliedIndex=${lastAppliedIndex}, stop=${processed.meta.passStopReason}`
        );
    } finally {
        await browser.close();
    }
});

test('16-9.webp should not ship a hard-rejected standard candidate when a safer nearby size exists', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '16-9.webp');
        const imageData = await decodeImageDataInPage(page, filePath);
        const processed = processWatermarkImageData(imageData, {
            alpha48,
            alpha96,
            maxPasses: 4,
            getAlphaMap: (size) => size === 48 ? alpha48 : size === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, size)
        });

        assert.equal(processed.meta.applied, true, 'expected 16-9.webp to enter removal pipeline');
        assert.equal(
            processed.meta.selectionDebug?.hardReject,
            false,
            `expected 16-9.webp final candidate to avoid hard-reject fallback, selectionDebug=${JSON.stringify(processed.meta.selectionDebug)}`
        );
    } finally {
        await browser.close();
    }
});

test('16-9.webp should keep canonical outline gradient from rising after standard refinement', async (t) => {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (isMissingPlaywrightExecutableError(error)) {
            t.skip('Playwright browser binaries are missing in this environment');
            return;
        }
        throw error;
    }

    const page = await browser.newPage();

    try {
        const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, BG48_PATH));
        const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, BG96_PATH));
        const filePath = path.join(SAMPLE_DIR, '16-9.webp');
        const imageData = await decodeImageDataInPage(page, filePath);
        const result = removeWatermarkLikeEngine(imageData, alpha48, alpha96);

        assert.ok(!result.skipped, 'expected 16-9.webp to be processed');
        assert.ok(
            result.afterGradient <= result.beforeGradient,
            `expected canonical outline gradient to not increase, before=${result.beforeGradient}, after=${result.afterGradient}`
        );
    } finally {
        await browser.close();
    }
});
