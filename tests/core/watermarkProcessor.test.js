import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { calculateAlphaMap } from '../../src/core/alphaMap.js';
import { processWatermarkImageData } from '../../src/core/watermarkProcessor.js';
import { interpolateAlphaMap, warpAlphaMap, computeRegionSpatialCorrelation } from '../../src/core/adaptiveDetector.js';
import { decodeImageDataInNode } from '../../scripts/sample-benchmark.js';
import {
    applySyntheticWatermark,
    createPatternImageData,
    createSyntheticAlphaMap
} from './syntheticWatermarkTestUtils.js';

test('processWatermarkImageData should run in Node without asset imports and record multi-pass meta', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const position = { x: 320 - 32 - 48, y: 320 - 32 - 48, width: 48, height: 48 };
    applySyntheticWatermark(imageData, alpha48, position, 2);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        maxPasses: 4
    });

    assert.equal(result.imageData.width, 320);
    assert.ok(result.meta.applied);
    assert.ok(result.meta.passCount >= 1, `passCount=${result.meta.passCount}`);
    assert.equal(result.meta.passStopReason, 'residual-low');
    assert.ok(Array.isArray(result.meta.passes));
    assert.ok(result.meta.detection.processedSpatialScore < 0.25, `score=${result.meta.detection.processedSpatialScore}`);
});

test('processWatermarkImageData should not attempt extra passes when the first pass already clears a single watermark layer', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const position = { x: 320 - 32 - 48, y: 320 - 32 - 48, width: 48, height: 48 };
    applySyntheticWatermark(imageData, alpha48, position, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        maxPasses: 4
    });

    assert.equal(result.meta.passCount, 1, `passCount=${result.meta.passCount}`);
    assert.equal(result.meta.attemptedPassCount, 1, `attemptedPassCount=${result.meta.attemptedPassCount}`);
    assert.equal(result.meta.passStopReason, 'residual-low');
    assert.equal(result.meta.passes.length, 1, `passes=${JSON.stringify(result.meta.passes)}`);
});

test('processWatermarkImageData should interpolate adaptive alpha maps when getAlphaMap is omitted', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(1008, 1071);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96
    });

    assert.equal(result.meta.applied, false);
    assert.equal(result.meta.skipReason, 'no-watermark-detected');
});

test('processWatermarkImageData should apply detected template warp to the first restoration pass', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const position = { x: 320 - 32 - 48, y: 320 - 32 - 48, width: 48, height: 48 };
    const embeddedWarpedAlpha = warpAlphaMap(alpha48, 48, { dx: -1, dy: 2, scale: 0.95 });
    applySyntheticWatermark(imageData, embeddedWarpedAlpha, position, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1
    });

    assert.ok(result.meta.applied);
    assert.ok(result.meta.templateWarp, 'expected template warp to be detected');

    const alignedAlpha = warpAlphaMap(alpha48, 48, result.meta.templateWarp);
    const residual = computeRegionSpatialCorrelation({
        imageData: result.imageData,
        alphaMap: alignedAlpha,
        region: { x: position.x, y: position.y, size: position.width }
    });

    assert.ok(
        residual <= -0.18,
        `expected first pass to use aligned template, residual=${residual}, warp=${JSON.stringify(result.meta.templateWarp)}`
    );
});

test('processWatermarkImageData should allow alpha gain to compete as a first-pass candidate', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const position = { x: 320 - 32 - 48, y: 320 - 32 - 48, width: 48, height: 48 };
    applySyntheticWatermark(imageData, alpha48, position, 1.05);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1
    });

    assert.ok(result.meta.applied);
    assert.ok(result.meta.alphaGain > 1, `expected first-pass alpha gain candidate, got ${result.meta.alphaGain}`);
    assert.ok(
        result.meta.detection.processedSpatialScore < 0.25,
        `expected first-pass gain candidate to suppress residual, got ${result.meta.detection.processedSpatialScore}`
    );
    assert.ok(
        result.meta.passes[0].afterSpatialScore < 0.25,
        `expected first recorded pass to use gain candidate, got ${result.meta.passes[0].afterSpatialScore}`
    );
});

test('processWatermarkImageData should select adaptive candidate directly when it beats the default position', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const truePosition = { x: 320 - 36 - 48, y: 320 - 20 - 48, width: 48, height: 48 };
    applySyntheticWatermark(imageData, alpha48, truePosition, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        maxPasses: 1
    });

    assert.ok(result.meta.applied);
    assert.ok(
        result.meta.source.startsWith('adaptive'),
        `expected adaptive candidate to be selected, got ${result.meta.source}`
    );
    assert.ok(Math.abs(result.meta.position.x - truePosition.x) <= 2, `x=${result.meta.position.x}`);
    assert.ok(Math.abs(result.meta.position.y - truePosition.y) <= 2, `y=${result.meta.position.y}`);
    assert.ok(Math.abs(result.meta.position.width - truePosition.width) <= 2, `width=${result.meta.position.width}`);
    assert.ok(
        result.meta.detection.processedSpatialScore < 0.22,
        `expected adaptive candidate to suppress residual, got ${result.meta.detection.processedSpatialScore}`
    );
});

test('processWatermarkImageData should recover near-official scaled anchor without adaptive search', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const alpha125 = interpolateAlphaMap(alpha96, 96, 125);
    const imageData = createPatternImageData(1000, 1792);
    const truePosition = { x: 792, y: 1584, width: 125, height: 125 };
    applySyntheticWatermark(imageData, alpha125, truePosition, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1
    });

    assert.ok(result.meta.applied, `skipReason=${result.meta.skipReason}`);
    assert.ok(
        Math.abs(result.meta.position.x - truePosition.x) <= 8,
        `x=${result.meta.position.x}`
    );
    assert.ok(
        Math.abs(result.meta.position.y - truePosition.y) <= 8,
        `y=${result.meta.position.y}`
    );
    assert.ok(
        Math.abs(result.meta.position.width - truePosition.width) <= 6,
        `width=${result.meta.position.width}`
    );
    assert.ok(
        result.meta.detection.processedSpatialScore < 0.22,
        `expected scaled standard candidate to suppress residual, got ${result.meta.detection.processedSpatialScore}`
    );
});

test('processWatermarkImageData should recover small default-anchor size drift without adaptive search', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const alpha54 = interpolateAlphaMap(alpha96, 96, 54);
    const imageData = createPatternImageData(320, 320);
    const truePosition = {
        x: 320 - 32 - 54,
        y: 320 - 32 - 54,
        width: 54,
        height: 54
    };
    applySyntheticWatermark(imageData, alpha54, truePosition, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size)
    });

    const residual = computeRegionSpatialCorrelation({
        imageData: result.imageData,
        alphaMap: alpha54,
        region: { x: truePosition.x, y: truePosition.y, size: truePosition.width }
    });

    assert.ok(result.meta.applied, `skipReason=${result.meta.skipReason}`);
    assert.ok(
        Math.abs(result.meta.position.x - truePosition.x) <= 4,
        `x=${result.meta.position.x}`
    );
    assert.ok(
        Math.abs(result.meta.position.y - truePosition.y) <= 4,
        `y=${result.meta.position.y}`
    );
    assert.ok(
        Math.abs(result.meta.position.width - truePosition.width) <= 2,
        `width=${result.meta.position.width}`
    );
    assert.ok(
        residual < 0.22,
        `expected true-region residual < 0.22, got ${residual}, source=${result.meta.source}`
    );
});

test('processWatermarkImageData should recover preview-sized bottom-right watermark without adaptive search', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const alpha34 = interpolateAlphaMap(alpha96, 96, 34);
    const imageData = createPatternImageData(1024, 559);
    const truePosition = {
        x: 1024 - 24 - 34,
        y: 559 - 24 - 34,
        width: 34,
        height: 34
    };
    applySyntheticWatermark(imageData, alpha34, truePosition, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size)
    });

    const residual = computeRegionSpatialCorrelation({
        imageData: result.imageData,
        alphaMap: alpha34,
        region: { x: truePosition.x, y: truePosition.y, size: truePosition.width }
    });

    assert.ok(result.meta.applied, `skipReason=${result.meta.skipReason}`);
    assert.ok(
        result.meta.source.startsWith('standard+preview-anchor'),
        `expected preview anchor recovery, got ${result.meta.source}`
    );
    assert.equal(result.meta.position.width, truePosition.width);
    assert.equal(result.meta.position.x, truePosition.x);
    assert.equal(result.meta.position.y, truePosition.y);
    assert.ok(
        residual < 0.22,
        `expected preview-anchor residual < 0.22, got ${residual}, source=${result.meta.source}`
    );
});

test('processWatermarkImageData should keep preview-anchor removals to a single pass by default', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const alpha34 = interpolateAlphaMap(alpha96, 96, 34);
    const imageData = createPatternImageData(1024, 559);
    const truePosition = {
        x: 1024 - 24 - 34,
        y: 559 - 24 - 34,
        width: 34,
        height: 34
    };
    applySyntheticWatermark(imageData, alpha34, truePosition, 2);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size)
    });

    assert.ok(result.meta.applied, `skipReason=${result.meta.skipReason}`);
    assert.equal(result.meta.passCount, 1, `passCount=${result.meta.passCount}`);
    assert.equal(result.meta.attemptedPassCount, 1, `attemptedPassCount=${result.meta.attemptedPassCount}`);
    assert.ok(
        !String(result.meta.source).includes('+multipass'),
        `expected preview-anchor removal to skip multipass, source=${result.meta.source}`
    );
});

test('processWatermarkImageData should expose candidate selection debug summary in meta', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const alpha54 = interpolateAlphaMap(alpha96, 96, 54);
    const imageData = createPatternImageData(320, 320);
    const truePosition = {
        x: 320 - 32 - 54,
        y: 320 - 32 - 54,
        width: 54,
        height: 54
    };
    applySyntheticWatermark(imageData, alpha54, truePosition, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size)
    });

    assert.ok(result.meta.applied, `skipReason=${result.meta.skipReason}`);
    assert.ok(result.meta.selectionDebug, 'expected selectionDebug to be present');
    assert.equal(result.meta.selectionDebug.usedSizeJitter, true);
    assert.equal(typeof result.meta.selectionDebug.texturePenalty, 'number');
    assert.equal(typeof result.meta.selectionDebug.tooDark, 'boolean');
    assert.equal(typeof result.meta.selectionDebug.tooFlat, 'boolean');
    assert.equal(typeof result.meta.selectionDebug.hardReject, 'boolean');
    assert.deepEqual(result.meta.selectionDebug.initialConfig, { logoSize: 48, marginRight: 32, marginBottom: 32 });
    assert.deepEqual(result.meta.selectionDebug.initialPosition, { x: 240, y: 240, width: 48, height: 48 });
    assert.deepEqual(result.meta.selectionDebug.finalConfig, result.meta.config);
    assert.deepEqual(result.meta.selectionDebug.finalPosition, result.meta.position);
});

test('processWatermarkImageData should expose local shift provenance for tall portrait anchor recovery', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(768, 1376);
    const truePosition = {
        x: 768 - 59 - 96,
        y: 1376 - 59 - 96,
        width: 96,
        height: 96
    };
    applySyntheticWatermark(imageData, alpha96, truePosition, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1
    });

    assert.ok(result.meta.applied, `skipReason=${result.meta.skipReason}`);
    assert.equal(result.meta.selectionDebug?.usedLocalShift, true);
    assert.equal(result.meta.selectionDebug?.usedCatalogVariant, false);
    assert.deepEqual(result.meta.selectionDebug?.initialConfig, { logoSize: 96, marginRight: 64, marginBottom: 64 });
    assert.deepEqual(result.meta.selectionDebug?.initialPosition, { x: 608, y: 1216, width: 96, height: 96 });
    assert.deepEqual(result.meta.selectionDebug?.finalPosition, result.meta.position);
});

test('processWatermarkImageData should expose normalized decision tier alongside legacy source tags', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const position = { x: 320 - 36 - 48, y: 320 - 20 - 48, width: 48, height: 48 };
    applySyntheticWatermark(imageData, alpha48, position, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        maxPasses: 1
    });

    assert.ok(result.meta.applied);
    assert.equal(typeof result.meta.decisionTier, 'string');
    assert.ok(
        ['direct-match', 'validated-match'].includes(result.meta.decisionTier),
        `decisionTier=${result.meta.decisionTier}, source=${result.meta.source}`
    );
});

test('processWatermarkImageData should avoid expanded alpha-gain search when the first-pass standard candidate is already clean', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const position = { x: 320 - 32 - 48, y: 320 - 32 - 48, width: 48, height: 48 };
    applySyntheticWatermark(imageData, alpha48, position, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1
    });

    assert.ok(result.meta.applied);
    assert.equal(result.meta.alphaGain, 1);
    assert.ok(
        !String(result.meta.source).includes('+gain'),
        `expected no expanded gain search, source=${result.meta.source}`
    );
});

test('processWatermarkImageData should avoid conservative fallback on debug1-source download sample', async () => {
    const alpha48 = calculateAlphaMap(await decodeImageDataInNode(path.resolve('src/assets/bg_48.png')));
    const alpha96 = calculateAlphaMap(await decodeImageDataInNode(path.resolve('src/assets/bg_96.png')));
    const imageData = await decodeImageDataInNode(path.resolve('src/assets/samples/debug1-source.png'));

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size)
    });

    assert.ok(result.meta.applied, `skipReason=${result.meta.skipReason}`);
    assert.ok(
        result.meta.detection.processedGradientScore < 0.12,
        `expected debug1-source residual gradient < 0.12, got ${result.meta.detection.processedGradientScore}, source=${result.meta.source}`
    );
    assert.ok(
        result.meta.position.width >= 48,
        `expected debug1-source to avoid undersized fallback candidate, got ${result.meta.position.width}`
    );
});

test('processWatermarkImageData should avoid local-shift drift on debug2-source portrait sample', async () => {
    const alpha48 = calculateAlphaMap(await decodeImageDataInNode(path.resolve('src/assets/bg_48.png')));
    const alpha96 = calculateAlphaMap(await decodeImageDataInNode(path.resolve('src/assets/bg_96.png')));
    const imageData = await decodeImageDataInNode(path.resolve('src/assets/samples/debug2-source.png'));

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        maxPasses: 1,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size)
    });

    assert.ok(result.meta.applied, `skipReason=${result.meta.skipReason}`);
    assert.equal(result.meta.source, 'standard', `expected standard anchor to win, got ${result.meta.source}`);
    assert.deepEqual(
        result.meta.position,
        { x: 688, y: 1296, width: 48, height: 48 },
        `unexpected final position=${JSON.stringify(result.meta.position)}`
    );
    assert.ok(
        result.meta.detection.processedGradientScore < 0.02,
        `expected debug2-source residual gradient < 0.02, got ${result.meta.detection.processedGradientScore}`
    );
});

test('processWatermarkImageData should expose stage timings when debugTimings is enabled', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const alpha34 = interpolateAlphaMap(alpha96, 96, 34);
    const imageData = createPatternImageData(1024, 559);
    const truePosition = {
        x: 1024 - 24 - 34,
        y: 559 - 24 - 34,
        width: 34,
        height: 34
    };
    applySyntheticWatermark(imageData, alpha34, truePosition, 1);

    const result = processWatermarkImageData(imageData, {
        alpha48,
        alpha96,
        adaptiveMode: 'never',
        debugTimings: true,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size)
    });

    assert.ok(result.debugTimings, 'expected debugTimings to be present');
    assert.equal(typeof result.debugTimings.initialSelectionMs, 'number');
    assert.equal(typeof result.debugTimings.firstPassMetricsMs, 'number');
    assert.equal(typeof result.debugTimings.totalMs, 'number');
    assert.ok(result.debugTimings.totalMs >= result.debugTimings.initialSelectionMs);
});
