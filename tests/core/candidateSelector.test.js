import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
    assessReferenceTextureAlignment,
    evaluateRestorationCandidate,
    pickBetterCandidate,
    selectInitialCandidate
} from '../../src/core/candidateSelector.js';
import { calculateAlphaMap } from '../../src/core/alphaMap.js';
import { interpolateAlphaMap, warpAlphaMap } from '../../src/core/adaptiveDetector.js';
import { decodeImageDataInNode } from '../../scripts/sample-benchmark.js';
import {
    applySyntheticWatermark,
    createPatternImageData,
    createSyntheticAlphaMap
} from './syntheticWatermarkTestUtils.js';

test('selectInitialCandidate should return a skipped result when no standard trials can be built', () => {
    const imageData = createPatternImageData(456, 142);
    const config = {
        logoSize: 125,
        marginRight: 32,
        marginBottom: 32
    };
    const position = {
        x: imageData.width - config.marginRight - config.logoSize,
        y: imageData.height - config.marginBottom - config.logoSize,
        width: config.logoSize,
        height: config.logoSize
    };

    const result = selectInitialCandidate({
        originalImageData: imageData,
        config,
        position,
        alpha48: null,
        alpha96: null,
        getAlphaMap: () => null,
        allowAdaptiveSearch: false,
        alphaGainCandidates: [1]
    });

    assert.equal(result.selectedTrial, null);
    assert.equal(result.source, 'skipped');
    assert.equal(result.decisionTier, 'insufficient');
    assert.equal(result.standardSpatialScore, null);
    assert.equal(result.standardGradientScore, null);
});

test('selectInitialCandidate should not require eager adaptive search when the standard candidate is already strong', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const config = {
        logoSize: 48,
        marginRight: 32,
        marginBottom: 32
    };
    const position = {
        x: imageData.width - config.marginRight - config.logoSize,
        y: imageData.height - config.marginBottom - config.logoSize,
        width: config.logoSize,
        height: config.logoSize
    };

    applySyntheticWatermark(imageData, alpha48, position, 1);

    const result = selectInitialCandidate({
        originalImageData: imageData,
        config,
        position,
        alpha48,
        alpha96: null,
        getAlphaMap: () => null,
        allowAdaptiveSearch: true,
        alphaGainCandidates: [1]
    });

    assert.ok(result.selectedTrial, 'expected standard candidate to be selected');
    assert.ok(result.source.startsWith('standard'), `source=${result.source}`);
    assert.equal(result.position.x, position.x);
    assert.equal(result.position.y, position.y);
});

test('evaluateRestorationCandidate should add texture penalty when restoration becomes darker than the local reference region', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const position = {
        x: 240,
        y: 240,
        width: 48,
        height: 48
    };

    applySyntheticWatermark(imageData, alpha48, position, 1);

    const candidate = evaluateRestorationCandidate({
        originalImageData: imageData,
        alphaMap: alpha48,
        position,
        source: 'standard',
        config: {
            logoSize: 48,
            marginRight: 32,
            marginBottom: 32
        },
        baselineNearBlackRatio: 0,
        alphaGain: 1.05
    });

    const baseValidationCost =
        Math.abs(candidate.processedSpatialScore) +
        Math.max(0, candidate.processedGradientScore) * 0.6 +
        Math.max(0, candidate.nearBlackIncrease) * 3;

    assert.equal(candidate.accepted, true);
    assert.ok(candidate.validationCost > baseValidationCost, 'expected local texture penalty to increase validation cost');
    assert.ok(candidate.texturePenalty > 0, `texturePenalty=${candidate.texturePenalty}`);
});

test('evaluateRestorationCandidate should support scoring without materializing a full candidate image', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const position = {
        x: 240,
        y: 240,
        width: 48,
        height: 48
    };

    applySyntheticWatermark(imageData, alpha48, position, 1);

    const fullCandidate = evaluateRestorationCandidate({
        originalImageData: imageData,
        alphaMap: alpha48,
        position,
        source: 'standard',
        config: {
            logoSize: 48,
            marginRight: 32,
            marginBottom: 32
        },
        baselineNearBlackRatio: 0,
        alphaGain: 1,
        includeImageData: true
    });

    const scoreOnlyCandidate = evaluateRestorationCandidate({
        originalImageData: imageData,
        alphaMap: alpha48,
        position,
        source: 'standard',
        config: {
            logoSize: 48,
            marginRight: 32,
            marginBottom: 32
        },
        baselineNearBlackRatio: 0,
        alphaGain: 1,
        includeImageData: false
    });

    assert.ok(fullCandidate.imageData, 'expected full candidate image data to exist');
    assert.equal(scoreOnlyCandidate.imageData, null);
    assert.equal(scoreOnlyCandidate.accepted, fullCandidate.accepted);
    assert.equal(scoreOnlyCandidate.processedSpatialScore, fullCandidate.processedSpatialScore);
    assert.equal(scoreOnlyCandidate.processedGradientScore, fullCandidate.processedGradientScore);
    assert.equal(scoreOnlyCandidate.validationCost, fullCandidate.validationCost);
});

test('pickBetterCandidate should keep the default anchor when a local shift loses strong original watermark evidence', () => {
    const defaultAnchorCandidate = {
        accepted: true,
        source: 'standard+validated',
        provenance: null,
        validationCost: 0.3265185265738402,
        improvement: 0.5431154601023849,
        originalSpatialScore: 0.29710616867610046,
        originalGradientScore: 0.4998777626082937
    };
    const driftedLocalShiftCandidate = {
        accepted: true,
        source: 'standard+local+validated',
        provenance: { localShift: true },
        validationCost: 0.06597234178943942,
        improvement: 0.19065682410462825,
        originalSpatialScore: 0.17313940579433085,
        originalGradientScore: -0.0250843744728948
    };

    const selected = pickBetterCandidate(defaultAnchorCandidate, driftedLocalShiftCandidate, 0.002);

    assert.equal(selected, defaultAnchorCandidate);
});

test('pickBetterCandidate should still allow a local shift when the default anchor lacks strong evidence', () => {
    const defaultAnchorCandidate = {
        accepted: true,
        source: 'standard+validated',
        provenance: null,
        validationCost: 0.4040296852241377,
        improvement: 0.9692938044339201,
        originalSpatialScore: 0.751216569797702,
        originalGradientScore: -0.12768919590607608
    };
    const recoveredLocalShiftCandidate = {
        accepted: true,
        source: 'standard+local+validated',
        provenance: { localShift: true },
        validationCost: 0.03650774301387135,
        improvement: 0.8620228530471932,
        originalSpatialScore: 0.8669310438820185,
        originalGradientScore: -0.10895911933638856
    };

    const selected = pickBetterCandidate(defaultAnchorCandidate, recoveredLocalShiftCandidate, 0.002);

    assert.equal(selected, recoveredLocalShiftCandidate);
});

test('pickBetterCandidate should preserve a clean default anchor when a local shift leaves higher residual gradient', () => {
    const defaultAnchorCandidate = {
        accepted: true,
        source: 'standard+validated',
        provenance: null,
        validationCost: 0.2696465723466803,
        improvement: 0.5531471532886425,
        originalSpatialScore: 0.2873281605142487,
        originalGradientScore: 0.5278399164629114,
        processedSpatialScore: -0.26581899277439386,
        processedGradientScore: 0.00637929928714411
    };
    const driftedLocalShiftCandidate = {
        accepted: true,
        source: 'standard+local+validated',
        provenance: { localShift: true },
        validationCost: 0.13556486383737498,
        improvement: 0.1927215257713466,
        originalSpatialScore: 0.16967136619110074,
        originalGradientScore: -0.02446231186883343,
        processedSpatialScore: -0.023050159580245855,
        processedGradientScore: 0.06599672931743743
    };

    const selected = pickBetterCandidate(defaultAnchorCandidate, driftedLocalShiftCandidate, 0.002);

    assert.equal(selected, defaultAnchorCandidate);
});

test('pickBetterCandidate should preserve a strong default anchor against weak size-jitter evidence', () => {
    const defaultAnchorCandidate = {
        accepted: true,
        source: 'standard+validated',
        provenance: null,
        validationCost: 0.312,
        improvement: 0.61,
        originalSpatialScore: 0.41,
        originalGradientScore: 0.58,
        processedSpatialScore: -0.21,
        processedGradientScore: 0.018
    };
    const weakSizeJitterCandidate = {
        accepted: true,
        source: 'standard+size+validated',
        provenance: { sizeJitter: true },
        validationCost: 0.09,
        improvement: 0.19,
        originalSpatialScore: 0.16,
        originalGradientScore: 0.06,
        processedSpatialScore: -0.02,
        processedGradientScore: 0.071
    };

    const selected = pickBetterCandidate(defaultAnchorCandidate, weakSizeJitterCandidate, 0.002);

    assert.equal(selected, defaultAnchorCandidate);
});

test('pickBetterCandidate should preserve a clean default anchor against weaker warp evidence', () => {
    const defaultAnchorCandidate = {
        accepted: true,
        source: 'standard',
        provenance: null,
        validationCost: 0.27,
        improvement: 0.55,
        originalSpatialScore: 0.29,
        originalGradientScore: 0.53,
        processedSpatialScore: -0.26,
        processedGradientScore: 0.006
    };
    const weakWarpCandidate = {
        accepted: true,
        source: 'standard+warp',
        provenance: null,
        validationCost: 0.19,
        improvement: 0.18,
        originalSpatialScore: 0.17,
        originalGradientScore: 0.04,
        processedSpatialScore: -0.03,
        processedGradientScore: 0.041
    };

    const selected = pickBetterCandidate(defaultAnchorCandidate, weakWarpCandidate, 0.002);

    assert.equal(selected, defaultAnchorCandidate);
});

test('assessReferenceTextureAlignment should mark a candidate unsafe when it is both darker and flatter than the local reference', () => {
    const width = 96;
    const height = 96;
    const data = new Uint8ClampedArray(width * height * 4);
    const candidateData = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i + 3] = 255;
        candidateData[i + 3] = 255;
    }

    const referenceRegion = { x: 24, y: 0, width: 48, height: 48 };
    const position = { x: 24, y: 48, width: 48, height: 48 };

    for (let row = 0; row < 48; row++) {
        for (let col = 0; col < 48; col++) {
            const refIdx = ((referenceRegion.y + row) * width + (referenceRegion.x + col)) * 4;
            const posIdx = ((position.y + row) * width + (position.x + col)) * 4;
            const value = (row + col) % 2 === 0 ? 40 : 180;
            data[refIdx] = value;
            data[refIdx + 1] = value;
            data[refIdx + 2] = value;
            candidateData[posIdx] = 18;
            candidateData[posIdx + 1] = 18;
            candidateData[posIdx + 2] = 18;
        }
    }

    const originalImageData = { width, height, data };
    const candidateImageData = { width, height, data: candidateData };
    const assessment = assessReferenceTextureAlignment({
        originalImageData,
        candidateImageData,
        position
    });

    assert.equal(assessment.tooDark, true);
    assert.equal(assessment.tooFlat, true);
    assert.ok(assessment.texturePenalty > 0, `texturePenalty=${assessment.texturePenalty}`);
    assert.equal(assessment.hardReject, true);
});

test('selectInitialCandidate should expose structured provenance for size-jitter recovery', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const alpha54 = interpolateAlphaMap(alpha96, 96, 54);
    const imageData = createPatternImageData(320, 320);
    const config = {
        logoSize: 48,
        marginRight: 32,
        marginBottom: 32
    };
    const position = {
        x: imageData.width - config.marginRight - config.logoSize,
        y: imageData.height - config.marginBottom - config.logoSize,
        width: config.logoSize,
        height: config.logoSize
    };
    const truePosition = {
        x: 320 - 32 - 54,
        y: 320 - 32 - 54,
        width: 54,
        height: 54
    };

    applySyntheticWatermark(imageData, alpha54, truePosition, 1);

    const result = selectInitialCandidate({
        originalImageData: imageData,
        config,
        position,
        alpha48,
        alpha96,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size),
        allowAdaptiveSearch: false,
        alphaGainCandidates: [1]
    });

    assert.ok(result.selectedTrial, 'expected size-jitter candidate to be selected');
    assert.equal(result.selectedTrial.provenance?.sizeJitter, true);
});

test('selectInitialCandidate should skip expensive size-jitter search when the standard candidate already leaves low residual', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(320, 320);
    const config = {
        logoSize: 48,
        marginRight: 32,
        marginBottom: 32
    };
    const position = {
        x: imageData.width - config.marginRight - config.logoSize,
        y: imageData.height - config.marginBottom - config.logoSize,
        width: config.logoSize,
        height: config.logoSize
    };

    applySyntheticWatermark(imageData, alpha48, position, 1);

    let interpolatedAlphaRequests = 0;
    const result = selectInitialCandidate({
        originalImageData: imageData,
        config,
        position,
        alpha48,
        alpha96,
        getAlphaMap: (size) => {
            if (size !== 48 && size !== 96) {
                interpolatedAlphaRequests += 1;
            }
            return interpolateAlphaMap(alpha96, 96, size);
        },
        allowAdaptiveSearch: false,
        alphaGainCandidates: [1]
    });

    assert.ok(result.selectedTrial, 'expected standard candidate to be selected');
    assert.equal(interpolatedAlphaRequests, 0);
    assert.ok(result.source.startsWith('standard'), `source=${result.source}`);
});

test('selectInitialCandidate should reuse interpolated alpha maps across preview-anchor refinement', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(1024, 559);
    const config = {
        logoSize: 48,
        marginRight: 24,
        marginBottom: 24
    };
    const position = {
        x: imageData.width - config.marginRight - config.logoSize,
        y: imageData.height - config.marginBottom - config.logoSize,
        width: config.logoSize,
        height: config.logoSize
    };
    const truePosition = {
        x: 1024 - 24 - 34,
        y: 559 - 24 - 34,
        width: 34,
        height: 34
    };
    const alpha34 = warpAlphaMap(interpolateAlphaMap(alpha96, 96, 34), 34, {
        dx: -1,
        dy: 1,
        scale: 0.985
    });
    applySyntheticWatermark(imageData, alpha34, truePosition, 1.1);

    const requestedSizes = [];
    const result = selectInitialCandidate({
        originalImageData: imageData,
        config,
        position,
        alpha48,
        alpha96,
        getAlphaMap: (size) => {
            requestedSizes.push(size);
            return interpolateAlphaMap(alpha96, 96, size);
        },
        allowAdaptiveSearch: false,
        alphaGainCandidates: [1.04, 1.12, 1.22, 1.34]
    });

    assert.ok(result.selectedTrial, 'expected preview-anchor candidate to be selected');
    assert.ok(result.source.startsWith('standard+preview-anchor'), `source=${result.source}`);
    assert.equal(
        requestedSizes.length,
        new Set(requestedSizes).size,
        `expected preview-anchor alpha map requests to be cached by size, got ${JSON.stringify(requestedSizes)}`
    );
});

test('selectInitialCandidate should skip preview-anchor gain search when the candidate is already clean enough', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(1024, 559);
    const config = {
        logoSize: 48,
        marginRight: 24,
        marginBottom: 24
    };
    const position = {
        x: imageData.width - config.marginRight - config.logoSize,
        y: imageData.height - config.marginBottom - config.logoSize,
        width: config.logoSize,
        height: config.logoSize
    };
    const truePosition = {
        x: 1024 - 24 - 34,
        y: 559 - 24 - 34,
        width: 34,
        height: 34
    };
    const alpha34 = warpAlphaMap(interpolateAlphaMap(alpha96, 96, 34), 34, {
        dx: -1,
        dy: 1,
        scale: 0.985
    });
    applySyntheticWatermark(imageData, alpha34, truePosition, 1.1);

    const result = selectInitialCandidate({
        originalImageData: imageData,
        config,
        position,
        alpha48,
        alpha96,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size),
        allowAdaptiveSearch: false,
        alphaGainCandidates: [1.04, 1.12, 1.22, 1.34]
    });

    assert.ok(result.selectedTrial, 'expected preview-anchor candidate to be selected');
    assert.equal(result.alphaGain, 1, `expected no extra gain search, alphaGain=${result.alphaGain}`);
    assert.ok(
        !String(result.source).includes('+gain'),
        `expected preview-anchor path to skip gain sweep for an already-clean candidate, source=${result.source}`
    );
});

test('selectInitialCandidate should keep searching nearby on tall portrait images when the initial direct match is still misaligned', () => {
    const alpha96 = createSyntheticAlphaMap(96);
    const alpha48 = interpolateAlphaMap(alpha96, 96, 48);
    const imageData = createPatternImageData(768, 1376);
    const config = {
        logoSize: 96,
        marginRight: 64,
        marginBottom: 64
    };
    const position = {
        x: imageData.width - config.marginRight - config.logoSize,
        y: imageData.height - config.marginBottom - config.logoSize,
        width: config.logoSize,
        height: config.logoSize
    };
    const truePosition = {
        x: 768 - 59 - 96,
        y: 1376 - 59 - 96,
        width: 96,
        height: 96
    };

    applySyntheticWatermark(imageData, alpha96, truePosition, 1);

    const result = selectInitialCandidate({
        originalImageData: imageData,
        config,
        position,
        alpha48,
        alpha96,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size),
        allowAdaptiveSearch: false,
        alphaGainCandidates: [1]
    });

    assert.ok(result.selectedTrial, 'expected a nearby standard candidate to be selected');
    assert.equal(result.selectedTrial.provenance?.localShift, true);
    assert.ok(
        Math.abs(result.position.x - truePosition.x) <= 1,
        `expected x to recover toward ${truePosition.x}, got ${result.position.x}`
    );
    assert.ok(
        Math.abs(result.position.y - truePosition.y) <= 1,
        `expected y to recover toward ${truePosition.y}, got ${result.position.y}`
    );
});

test('selectInitialCandidate should keep the canonical anchor for debug2-source when drifted candidates have weaker original evidence', async () => {
    const alpha48 = calculateAlphaMap(await decodeImageDataInNode(path.resolve('src/assets/bg_48.png')));
    const alpha96 = calculateAlphaMap(await decodeImageDataInNode(path.resolve('src/assets/bg_96.png')));
    const originalImageData = await decodeImageDataInNode(path.resolve('src/assets/samples/debug2-source.png'));
    const config = {
        logoSize: 48,
        marginRight: 32,
        marginBottom: 32
    };
    const position = {
        x: 688,
        y: 1296,
        width: 48,
        height: 48
    };

    const result = selectInitialCandidate({
        originalImageData,
        config,
        position,
        alpha48,
        alpha96,
        getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size),
        allowAdaptiveSearch: true,
        alphaGainCandidates: [1.05, 1.12, 1.2, 1.28, 1.36, 1.45, 1.52, 1.6]
    });

    assert.ok(result.selectedTrial, 'expected a selected standard trial');
    assert.equal(result.source, 'standard');
    assert.deepEqual(result.position, position);
    assert.equal(result.selectedTrial.provenance?.localShift, undefined);
});
