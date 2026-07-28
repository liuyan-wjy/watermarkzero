import test from 'node:test';
import assert from 'node:assert/strict';

import { createSelectionDebugSummary } from '../../src/core/selectionDebug.js';

test('createSelectionDebugSummary should mark usedSizeJitter from structured provenance', () => {
    const summary = createSelectionDebugSummary({
        selectedTrial: {
            source: 'standard+validated',
            config: { logoSize: 54, marginRight: 32, marginBottom: 32 },
            position: { x: 234, y: 234, width: 54, height: 54 },
            provenance: { sizeJitter: true },
            texturePenalty: 0.12,
            tooDark: false,
            tooFlat: false,
            hardReject: false
        },
        selectionSource: 'standard+validated',
        initialConfig: { logoSize: 48, marginRight: 32, marginBottom: 32 },
        initialPosition: { x: 240, y: 240, width: 48, height: 48 }
    });

    assert.equal(summary.usedSizeJitter, true);
    assert.equal(summary.usedCatalogVariant, false);
    assert.equal(summary.usedLocalShift, false);
    assert.equal(summary.usedAdaptive, false);
    assert.equal(summary.usedPreviewAnchor, false);
    assert.equal(summary.candidateSource, 'standard+validated');
    assert.deepEqual(summary.initialConfig, { logoSize: 48, marginRight: 32, marginBottom: 32 });
    assert.deepEqual(summary.initialPosition, { x: 240, y: 240, width: 48, height: 48 });
    assert.deepEqual(summary.finalConfig, { logoSize: 54, marginRight: 32, marginBottom: 32 });
    assert.deepEqual(summary.finalPosition, { x: 234, y: 234, width: 54, height: 54 });
});

test('createSelectionDebugSummary should not infer usedSizeJitter only from source tags', () => {
    const summary = createSelectionDebugSummary({
        selectedTrial: {
            source: 'standard+size+validated',
            config: { logoSize: 48, marginRight: 32, marginBottom: 32 },
            position: { x: 240, y: 240, width: 48, height: 48 },
            provenance: {},
            texturePenalty: 0,
            tooDark: false,
            tooFlat: false,
            hardReject: false
        },
        selectionSource: 'standard+size+validated'
    });

    assert.equal(summary.usedSizeJitter, false);
});

test('createSelectionDebugSummary should capture catalog, local shift, adaptive and preview provenance flags only from structured provenance', () => {
    const summary = createSelectionDebugSummary({
        selectedTrial: {
            source: 'adaptive+validated',
            config: { logoSize: 79, marginRight: 54, marginBottom: 46 },
            position: { x: 507, y: 515, width: 79, height: 79 },
            provenance: {
                catalogVariant: true,
                localShift: true,
                adaptive: true,
                previewAnchor: true
            },
            texturePenalty: 0.03,
            tooDark: true,
            tooFlat: false,
            hardReject: false
        },
        selectionSource: 'adaptive+validated'
    });

    assert.equal(summary.usedCatalogVariant, true);
    assert.equal(summary.usedLocalShift, true);
    assert.equal(summary.usedAdaptive, true);
    assert.equal(summary.usedPreviewAnchor, true);
});
