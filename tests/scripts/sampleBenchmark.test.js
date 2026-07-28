import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
    classifyBenchmarkCase,
    decodeImageDataInNode,
    listBenchmarkSampleAssets,
    summarizeBenchmarkResults
} from '../../scripts/sample-benchmark.js';

test('classifyBenchmarkCase should mark skipped expected Gemini sample as missed detection', () => {
    const result = classifyBenchmarkCase({
        expectedGemini: true,
        applied: false,
        skipReason: 'no-watermark-detected',
        fileName: '2-3.png'
    });

    assert.equal(result.status, 'fail');
    assert.equal(result.bucket, 'missed-detection');
});

test('classifyBenchmarkCase should separate weak suppression from residual edge cases', () => {
    const weakSuppression = classifyBenchmarkCase({
        expectedGemini: true,
        applied: true,
        residualScore: 0.31,
        suppressionGain: 0.18,
        decisionTier: 'validated-match',
        fileName: 'weak.png'
    });
    const residualEdge = classifyBenchmarkCase({
        expectedGemini: true,
        applied: true,
        residualScore: 0.31,
        suppressionGain: 0.36,
        decisionTier: 'validated-match',
        fileName: 'edge.png'
    });

    assert.equal(weakSuppression.bucket, 'weak-suppression');
    assert.equal(residualEdge.bucket, 'residual-edge');
});

test('classifyBenchmarkCase should treat changed non-Gemini region as false positive', () => {
    const result = classifyBenchmarkCase({
        expectedGemini: false,
        applied: true,
        changedRatio: 0.08,
        avgAbsoluteDeltaPerChannel: 3.2,
        fileName: '16-9.jpg'
    });

    assert.equal(result.status, 'fail');
    assert.equal(result.bucket, 'false-positive');
});

test('listBenchmarkSampleAssets should include every primary sample image under the sample directory', async () => {
    const sampleDir = path.resolve('src/assets/samples');
    const items = await listBenchmarkSampleAssets(sampleDir);

    assert.ok(items.length > 0, 'expected benchmark sample enumeration to find sample images');
    assert.ok(items.every((item) => item.expectedGemini === true), 'expected directory-driven samples to be treated as Gemini fixtures');
    assert.ok(items.every((item) => !item.fileName.includes('-fix.')), 'expected fix snapshots to be excluded');
    assert.ok(items.every((item) => !item.fileName.includes('-after.')), 'expected derived after snapshots to be excluded');
    assert.equal(items.some((item) => item.fileName === '1-1.webp'), true);
    assert.equal(items.some((item) => item.fileName === '9-16.webp'), true);
});

test('summarizeBenchmarkResults should aggregate pass fail and bucket counts', () => {
    const summary = summarizeBenchmarkResults([
        { classification: { status: 'pass', bucket: 'pass' } },
        { classification: { status: 'fail', bucket: 'missed-detection' } },
        { classification: { status: 'fail', bucket: 'missed-detection' } },
        { classification: { status: 'fail', bucket: 'false-positive' } }
    ]);

    assert.equal(summary.total, 4);
    assert.equal(summary.passCount, 1);
    assert.equal(summary.failCount, 3);
    assert.equal(summary.buckets['missed-detection'], 2);
    assert.equal(summary.buckets['false-positive'], 1);
});

test('decodeImageDataInNode should decode sample assets without launching a browser', async () => {
    const imageData = await decodeImageDataInNode(path.resolve('src/assets/samples/1-1.webp'));

    assert.equal(imageData.width, 1024);
    assert.equal(imageData.height, 1024);
    assert.equal(imageData.data.length, 1024 * 1024 * 4);
});
